import fs from 'fs';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';

const DB_CONTAINER = String(process.env.ARIANA_AI_CHATWOOT_DB_CONTAINER || 'chatwoot-db-1');
const DB_NAME = String(process.env.ARIANA_AI_CHATWOOT_DB_NAME || 'chatwoot_production');
const ACCOUNT_ID = Number(process.env.ARIANA_AI_CHATWOOT_ACCOUNT_ID || 2);
const CORE_URL = String(process.env.ARIANA_AI_CORE_URL || 'http://127.0.0.1:8098').replace(/\/$/, '');
const POLL_MS = Math.max(10000, Number(process.env.ARIANA_AI_DB_OBSERVER_POLL_MS || 15000));
const STATE_FILE = String(process.env.ARIANA_AI_DB_OBSERVER_STATE || '/root/ariana-ai-core/db-observer-state.json');
const COMPARE_LOG = String(process.env.ARIANA_AI_COMPARE_LOG || '/root/ariana-ai-core/shadow-comparisons.ndjson');
const GUSTAVO_STATE_FILE = String(process.env.ARIANA_AI_GUSTAVO_STATE || '/root/loja-bot-state.json');

export const INBOX_CHANNELS = Object.freeze({
  5: 'sac',
  6: 'financeiro',
  7: 'loja',
  9: 'crediario'
});

export function digits(value = '') {
  return String(value).replace(/\D/g, '');
}

export function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function hashText(value = '') {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 20);
}

export function attachmentMedia(attachments = []) {
  const types = new Set((attachments || []).map(a => Number(a?.file_type)));
  if (types.has(1)) return 'audio';
  if (types.has(0)) return 'image';
  if (types.has(3)) return 'document';
  if (types.has(2)) return 'video';
  return '';
}

export function buildEnvelope(row = {}) {
  return {
    channel: INBOX_CHANNELS[Number(row.inbox_id)] || 'loja',
    text: String(row.content || ''),
    caption: '',
    transcription: '',
    mediaType: attachmentMedia(row.attachments),
    previousIntent: ''
  };
}

export function findGustavoConversation(state = {}, phone = '') {
  const wanted = digits(phone);
  if (!wanted) return null;
  const last10 = wanted.slice(-10);
  for (const [key, value] of Object.entries(state.conversations || {})) {
    const candidate = digits(key);
    if (!candidate) continue;
    if (candidate.endsWith(last10) || wanted.endsWith(candidate.slice(-10))) {
      return value || null;
    }
  }
  return null;
}

export function humanModeActive(conversationState = {}, now = Date.now()) {
  return Number(conversationState?.humanUntil || 0) > now
    || Number(conversationState?.manualHumanUntil || 0) > now;
}

export function likelyGustavoReply(row = {}, conversationState = {}) {
  if (!conversationState || humanModeActive(conversationState, Number(row.created_at_ms || Date.now()))) {
    return false;
  }
  const expected = normalizeText(conversationState.lastBotReplyText || '');
  const actual = normalizeText(row.content || '');
  if (!expected || !actual) return false;

  const expectedAt = Number(conversationState.lastBotReplyAt || 0);
  const actualAt = Number(row.created_at_ms || 0);
  if (!expectedAt || !actualAt || Math.abs(actualAt - expectedAt) > 5 * 60 * 1000) return false;

  if (expected === actual) return true;
  const prefix = expected.slice(0, Math.min(90, expected.length));
  return prefix.length >= 24 && actual.includes(prefix);
}

const PRODUCT_TERMS = [
  'geladeira', 'refrigerador', 'tv', 'televisao', 'sofa', 'guarda roupa',
  'fogao', 'lavadora', 'freezer', 'produto', 'modelo', 'estoque',
  'preco', 'valor', 'comprar', 'foto', 'fotos'
];
const FINANCE_TERMS = [
  'comprovante', 'pagamento', 'paguei', 'parcela', 'prestacao',
  'pix', 'boleto', 'quitacao', 'recibo'
];
const CREDIT_TERMS = [
  'crediario', 'carne', 'parcela', 'vencimento', 'atrasada',
  'negociacao', 'promessa de pagamento'
];

function hasAny(text, terms) {
  return terms.some(term => text.includes(term));
}

export function compareReply(route = '', reply = '') {
  const text = normalizeText(reply);
  if (!text) return { mismatch: false, reason: 'empty_reply' };

  const product = hasAny(text, PRODUCT_TERMS);
  const finance = hasAny(text, FINANCE_TERMS);
  const credit = hasAny(text, CREDIT_TERMS);

  if (route === 'FINANCEIRO' && product && !finance && !credit) {
    return { mismatch: true, reason: 'financeiro_recebeu_resposta_comercial' };
  }
  if (route === 'COMERCIAL' && (finance || credit) && !product) {
    return { mismatch: true, reason: 'comercial_recebeu_resposta_financeira' };
  }
  if (route === 'CREDIARIO' && product && !credit && !finance) {
    return { mismatch: true, reason: 'crediario_recebeu_resposta_comercial' };
  }
  return { mismatch: false, reason: 'compatible' };
}

function runSql(sql) {
  const shell = `PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "${DB_NAME}" -At`;
  const result = spawnSync('docker', ['exec', '-i', DB_CONTAINER, 'sh', '-lc', shell], {
    input: sql,
    encoding: 'utf8',
    timeout: 10000
  });
  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || 'chatwoot_db_read_failed').trim());
  }
  return String(result.stdout || '').trim();
}

function currentMaxId() {
  const out = runSql(`
    select coalesce(max(id),0)
    from messages
    where account_id=${ACCOUNT_ID}
      and inbox_id in (5,6,7,9);
  `);
  return Number(out || 0);
}

function readRows(afterId) {
  const out = runSql(`
    select json_build_object(
      'id',m.id,
      'content',coalesce(m.content,''),
      'inbox_id',m.inbox_id,
      'conversation_id',m.conversation_id,
      'message_type',m.message_type,
      'created_at_ms',(extract(epoch from m.created_at)*1000)::bigint,
      'phone_number',coalesce(ct.phone_number,''),
      'attachments',coalesce((
        select json_agg(json_build_object(
          'file_type',a.file_type,
          'extension',coalesce(a.extension,'')
        ))
        from attachments a
        where a.message_id=m.id
      ),'[]'::json)
    )::text
    from messages m
    join conversations c on c.id=m.conversation_id
    left join contacts ct on ct.id=c.contact_id
    where m.account_id=${ACCOUNT_ID}
      and m.inbox_id in (5,6,7,9)
      and m.id>${Number(afterId) || 0}
      and m.message_type in (0,1)
    order by m.id asc
    limit 200;
  `);
  if (!out) return [];
  return out.split('\n').filter(Boolean).map(line => JSON.parse(line));
}

function readJson(path, fallback) {
  try { return JSON.parse(fs.readFileSync(path, 'utf8')); }
  catch { return fallback; }
}

function writeJson(path, value) {
  fs.writeFileSync(path, JSON.stringify(value, null, 2));
}

function appendComparison(record) {
  fs.appendFileSync(COMPARE_LOG, JSON.stringify(record) + '\n');
}

async function shadowDecision(envelope) {
  const response = await fetch(`${CORE_URL}/v1/shadow/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(envelope),
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error(`shadow_http_${response.status}`);
  const body = await response.json();
  return body.audit || body.decision || {};
}

function initState() {
  const existing = readJson(STATE_FILE, null);
  if (existing && Number.isFinite(Number(existing.lastMessageId))) return existing;
  const fresh = {
    initializedAt: new Date().toISOString(),
    lastMessageId: currentMaxId(),
    pending: {}
  };
  writeJson(STATE_FILE, fresh);
  console.log('[ariana-ai-db-observer] initialized from current max id', fresh.lastMessageId);
  return fresh;
}

async function processRow(row, state) {
  const conversationKey = String(row.conversation_id);
  if (Number(row.message_type) === 0) {
    const decision = await shadowDecision(buildEnvelope(row));
    state.pending[conversationKey] = {
      incomingId: Number(row.id),
      route: String(decision.route || ''),
      reason: String(decision.reason || ''),
      at: Number(row.created_at_ms || 0),
      inputHash: hashText(row.content || ''),
      mediaType: attachmentMedia(row.attachments)
    };
    return;
  }

  const pending = state.pending[conversationKey];
  if (!pending) return;

  let origin = 'ariana_unknown';
  if (Number(row.inbox_id) === 7) {
    const gustavoState = readJson(GUSTAVO_STATE_FILE, {});
    const conversationState = findGustavoConversation(gustavoState, row.phone_number);
    if (conversationState && humanModeActive(conversationState, Number(row.created_at_ms || Date.now()))) {
      origin = 'human';
    } else if (conversationState && likelyGustavoReply(row, conversationState)) {
      origin = 'gustavo';
    }
  }

  const comparison = compareReply(pending.route, row.content || '');
  appendComparison({
    at: new Date().toISOString(),
    conversationId: Number(row.conversation_id),
    incomingId: pending.incomingId,
    outgoingId: Number(row.id),
    channel: INBOX_CHANNELS[Number(row.inbox_id)] || 'loja',
    route: pending.route,
    routeReason: pending.reason,
    mediaType: pending.mediaType,
    origin,
    mismatch: origin === 'gustavo' ? comparison.mismatch : false,
    comparisonReason: comparison.reason,
    inputHash: pending.inputHash,
    replyHash: hashText(row.content || '')
  });
  delete state.pending[conversationKey];
}

export async function runOnce() {
  const state = initState();
  const rows = readRows(state.lastMessageId);
  for (const row of rows) {
    try {
      await processRow(row, state);
    } catch (error) {
      console.error('[ariana-ai-db-observer] row', row.id, error?.message || error);
    } finally {
      state.lastMessageId = Math.max(Number(state.lastMessageId || 0), Number(row.id || 0));
      writeJson(STATE_FILE, state);
    }
  }
  return rows.length;
}

async function loop() {
  try {
    const count = await runOnce();
    if (count) console.log('[ariana-ai-db-observer] observed', count, 'new messages');
  } catch (error) {
    console.error('[ariana-ai-db-observer]', error?.message || error);
  } finally {
    setTimeout(loop, POLL_MS).unref();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('[ariana-ai-db-observer] read-only shadow observer starting');
  console.log('[ariana-ai-db-observer] monitored inboxes: 5 SAC, 6 Financeiro, 7 Loja, 9 Crediario');
  console.log('[ariana-ai-db-observer] customer outbound messaging: disabled');
  loop();
}
