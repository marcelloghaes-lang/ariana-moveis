import fs from 'fs';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';

const CHATWOOT_RAILS_CONTAINER = String(process.env.ARIANA_AI_CHATWOOT_RAILS_CONTAINER || 'chatwoot-rails-1');
const SECRET_FILE = String(process.env.ARIANA_AI_SECRET_FILE || '/root/ariana-secrets.env');
const MEDIA_LOG = String(process.env.ARIANA_AI_MEDIA_LOG || '/root/ariana-ai-core/media-shadow-decisions.ndjson');
const BUDGET_FILE = String(process.env.ARIANA_AI_MEDIA_BUDGET || '/root/ariana-ai-core/media-shadow-budget.json');
const MAX_DAILY = Math.max(1, Number(process.env.ARIANA_AI_MEDIA_MAX_DAILY || 25));
const VISION_MODEL = String(process.env.ARIANA_AI_SHADOW_VISION_MODEL || process.env.LOJA_VISION_MODEL || 'gpt-5.6-luna');
const AUDIO_MODEL = String(process.env.ARIANA_AI_SHADOW_AUDIO_MODEL || process.env.LOJA_AUDIO_TRANSCRIBE_MODEL || 'gpt-transcribe');
const TIMEOUT_MS = Math.max(5000, Number(process.env.ARIANA_AI_MEDIA_TIMEOUT_MS || 25000));

function parseEnvFile(path = SECRET_FILE) {
  try {
    const out = {};
    for (const raw of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const at = line.indexOf('=');
      if (at <= 0) continue;
      const key = line.slice(0, at).trim();
      let value = line.slice(at + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function apiKey() {
  const fileEnv = parseEnvFile();
  return String(
    process.env.ARIANA_AI_SHADOW_OPENAI_API_KEY ||
    process.env.LOJA_VISION_OPENAI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    fileEnv.LOJA_VISION_OPENAI_API_KEY ||
    ''
  ).trim();
}

function dateKey(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
}

function readJson(path, fallback) {
  try { return JSON.parse(fs.readFileSync(path, 'utf8')); }
  catch { return fallback; }
}

function writeJson(path, value) {
  fs.writeFileSync(path, JSON.stringify(value, null, 2));
}

function budgetState() {
  const day = dateKey();
  const state = readJson(BUDGET_FILE, { day, requests: 0 });
  if (state.day !== day) return { day, requests: 0 };
  return state;
}

function consumeBudget() {
  const state = budgetState();
  if (Number(state.requests || 0) >= MAX_DAILY) return false;
  state.requests = Number(state.requests || 0) + 1;
  writeJson(BUDGET_FILE, state);
  return true;
}

export function blobPath(key = '') {
  const value = String(key || '').trim();
  if (!/^[a-zA-Z0-9_-]{8,}$/.test(value)) return '';
  return `/app/storage/${value.slice(0, 2)}/${value.slice(2, 4)}/${value}`;
}

export function readChatwootBlob(attachment = {}) {
  const path = blobPath(attachment.key);
  if (!path) throw new Error('invalid_blob_key');

  const maxBytes = Number(attachment.byte_size || 0) || 25 * 1024 * 1024;
  if (maxBytes > 25 * 1024 * 1024) throw new Error('media_too_large');

  const result = spawnSync(
    'docker',
    ['exec', '-i', CHATWOOT_RAILS_CONTAINER, 'cat', path],
    { encoding: null, maxBuffer: 26 * 1024 * 1024, timeout: 10000 }
  );

  if (result.status !== 0 || !result.stdout?.length) {
    throw new Error('chatwoot_blob_read_failed');
  }
  return Buffer.from(result.stdout);
}

function responseOutputText(data = {}) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
  for (const item of Array.isArray(data?.output) ? data.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (typeof content?.text === 'string' && content.text.trim()) return content.text.trim();
    }
  }
  return '';
}

async function classifyImage(buffer, attachment = {}, contextText = '') {
  const key = apiKey();
  if (!key) throw new Error('shadow_ai_not_configured');
  if (!consumeBudget()) throw new Error('shadow_media_budget_blocked');

  const mime = String(attachment.content_type || 'image/jpeg').split(';')[0].trim().toLowerCase();
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      kind: {
        type: 'string',
        enum: ['payment_receipt_pix','payment_receipt_boleto','product','personal_document','other','unknown']
      },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      category_hint: { type: 'string' },
      payment_method: { type: 'string', enum: ['pix','boleto','other','unknown'] },
      summary: { type: 'string' }
    },
    required: ['kind','confidence','category_hint','payment_method','summary']
  };

  const prompt = [
    'Você é um classificador SOMBRA da Ariana Móveis. Apenas classifique a imagem; não responda ao cliente.',
    'Diferencie com cuidado foto/print de produto de comprovante de pagamento.',
    'Nunca conclua que um pagamento foi liquidado ou que um comprovante é autêntico.',
    'Se for produto, informe apenas a categoria visível quando houver segurança.',
    'Se for documento pessoal, classifique como personal_document.',
    `Texto associado, se houver: ${String(contextText || '').slice(0, 300)}`
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        store: false,
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: prompt },
            { type: 'input_image', image_url: `data:${mime};base64,${buffer.toString('base64')}`, detail: 'high' }
          ]
        }],
        text: {
          format: {
            type: 'json_schema',
            name: 'ariana_ai_core_shadow_media',
            strict: true,
            schema
          }
        },
        max_output_tokens: 300
      })
    });
    if (!response.ok) throw new Error(`shadow_vision_http_${response.status}`);
    const data = await response.json();
    const parsed = JSON.parse(responseOutputText(data) || '{}');
    return {
      kind: String(parsed.kind || 'unknown'),
      confidence: Number(parsed.confidence || 0),
      categoryHint: String(parsed.category_hint || '').trim(),
      paymentMethod: String(parsed.payment_method || 'unknown'),
      summary: String(parsed.summary || '').trim(),
      model: VISION_MODEL
    };
  } finally {
    clearTimeout(timer);
  }
}

async function transcribeAudio(buffer, attachment = {}) {
  const key = apiKey();
  if (!key) throw new Error('shadow_ai_not_configured');
  if (!consumeBudget()) throw new Error('shadow_media_budget_blocked');

  const mime = String(attachment.content_type || 'audio/ogg').split(';')[0].trim().toLowerCase();
  const ext = mime.includes('opus') || mime.includes('ogg') ? 'ogg'
    : mime.includes('webm') ? 'webm'
    : mime.includes('wav') ? 'wav'
    : mime.includes('mpeg') || mime.includes('mp3') ? 'mp3'
    : 'ogg';

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime }), `audio-shadow.${ext}`);
  form.append('model', AUDIO_MODEL);
  form.append('response_format', 'json');
  form.append('language', 'pt');
  form.append('prompt', 'Português do Brasil. Ariana Móveis. Transcreva literalmente, preservando negações, valores, produto, parcela, prestação, PIX, boleto, carnê e comprovante.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${key}` },
      body: form
    });
    if (!response.ok) throw new Error(`shadow_audio_http_${response.status}`);
    const data = await response.json();
    return {
      text: String(data?.text || '').trim(),
      model: AUDIO_MODEL
    };
  } finally {
    clearTimeout(timer);
  }
}

function appendMediaLog(row) {
  fs.appendFileSync(MEDIA_LOG, JSON.stringify(row) + '\n');
}

export function mediaKindRoute(kind = '') {
  if (kind === 'payment_receipt_pix' || kind === 'payment_receipt_boleto') return 'FINANCEIRO';
  if (kind === 'product') return 'COMERCIAL';
  if (kind === 'personal_document') return 'DOCUMENTO_PESSOAL';
  return 'MULTIMIDIA_PENDENTE';
}

export async function interpretMediaShadow(row = {}, envelope = {}) {
  const attachment = Array.isArray(row.attachments) ? row.attachments[0] : null;
  if (!attachment) return { envelopePatch: {}, audit: null };

  const mediaType = String(envelope.mediaType || '');
  const baseAudit = {
    at: new Date().toISOString(),
    messageId: Number(row.id || 0),
    conversationId: Number(row.conversation_id || 0),
    channel: String(envelope.channel || 'loja'),
    mediaType,
    contentHash: createHash('sha256').update(String(attachment.key || '')).digest('hex').slice(0, 20)
  };

  try {
    const buffer = readChatwootBlob(attachment);

    if (mediaType === 'audio') {
      const result = await transcribeAudio(buffer, attachment);
      const audit = {
        ...baseAudit,
        status: 'interpreted',
        kind: 'audio_transcribed',
        model: result.model,
        textHash: createHash('sha256').update(result.text).digest('hex').slice(0, 20)
      };
      appendMediaLog(audit);
      return {
        envelopePatch: {
          transcription: result.text,
          mediaKind: 'audio_transcribed'
        },
        audit
      };
    }

    if (mediaType === 'image') {
      const result = await classifyImage(buffer, attachment, envelope.text || '');
      const route = mediaKindRoute(result.kind);
      const audit = {
        ...baseAudit,
        status: 'interpreted',
        kind: result.kind,
        confidence: result.confidence,
        categoryHint: result.categoryHint,
        paymentMethod: result.paymentMethod,
        route,
        model: result.model
      };
      appendMediaLog(audit);
      return {
        envelopePatch: {
          mediaKind: result.kind,
          mediaConfidence: result.confidence,
          mediaCategoryHint: result.categoryHint,
          mediaPaymentMethod: result.paymentMethod
        },
        audit
      };
    }

    const audit = { ...baseAudit, status: 'unsupported', kind: mediaType || 'unknown' };
    appendMediaLog(audit);
    return { envelopePatch: {}, audit };
  } catch (error) {
    const audit = {
      ...baseAudit,
      status: 'error',
      kind: 'unknown',
      error: String(error?.message || error).slice(0, 120)
    };
    appendMediaLog(audit);
    return { envelopePatch: {}, audit };
  }
}
