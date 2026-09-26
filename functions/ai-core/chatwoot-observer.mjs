import fs from 'fs';

const CHATWOOT_BASE_URL = String(process.env.CHATWOOT_BASE_URL || '').replace(/\/$/, '');
const CHATWOOT_ACCOUNT_ID = Number(process.env.CHATWOOT_ACCOUNT_ID || 2);
const CHATWOOT_ACCESS_TOKEN = String(process.env.CHATWOOT_ACCESS_TOKEN || '');
const CORE_URL = String(process.env.ARIANA_AI_CORE_URL || 'http://127.0.0.1:8098').replace(/\/$/, '');
const POLL_MS = Math.max(15000, Number(process.env.ARIANA_AI_OBSERVER_POLL_MS || 30000));
const STATE_FILE = String(process.env.ARIANA_AI_OBSERVER_STATE || '/root/ariana-ai-core/observer-state.json');
const INBOX_MAP = parseInboxMap(process.env.ARIANA_AI_OBSERVER_INBOX_MAP || '');

export function parseInboxMap(raw = '') {
  const out = {};
  for (const part of String(raw).split(',').map(v => v.trim()).filter(Boolean)) {
    const [id, channel] = part.split(':').map(v => String(v || '').trim());
    if (/^\d+$/.test(id) && channel) out[Number(id)] = channel.toLowerCase();
  }
  return out;
}

export function extractConversationList(body = {}) {
  if (Array.isArray(body.payload)) return body.payload;
  if (Array.isArray(body?.data?.payload)) return body.data.payload;
  if (Array.isArray(body?.data)) return body.data;
  return [];
}

export function extractMessages(body = {}) {
  if (Array.isArray(body.payload)) return body.payload;
  if (Array.isArray(body?.data?.payload)) return body.data.payload;
  if (Array.isArray(body?.messages)) return body.messages;
  return [];
}

export function isIncomingMessage(message = {}) {
  return message.message_type === 0
    || String(message.message_type || '').toLowerCase() === 'incoming';
}

export function toShadowEnvelope(message = {}, channel = 'loja') {
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  const attachment = attachments[0] || {};
  const kind = String(attachment.file_type || attachment.type || '').toLowerCase();
  const mediaType = kind.includes('audio') ? 'audio'
    : kind.includes('image') ? 'image'
    : kind.includes('file') || kind.includes('document') ? 'document'
    : '';

  return {
    channel,
    text: String(message.content || ''),
    caption: '',
    transcription: '',
    mediaType,
    observer: {
      messageId: message.id ?? null,
      conversationId: message.conversation_id ?? null,
      createdAt: message.created_at ?? null
    }
  };
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { seen: {} }; }
}

function writeState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function getJson(path) {
  const response = await fetch(`${CHATWOOT_BASE_URL}${path}`, {
    method: 'GET',
    headers: { api_access_token: CHATWOOT_ACCESS_TOKEN }
  });
  if (!response.ok) throw new Error(`chatwoot_get_${response.status}`);
  return response.json();
}

async function postShadow(envelope) {
  const response = await fetch(`${CORE_URL}/v1/shadow/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(envelope)
  });
  if (!response.ok) throw new Error(`shadow_post_${response.status}`);
}

async function observeInbox(inboxId, channel, state) {
  const path = `/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations?status=all&inbox_id=${inboxId}&page=1`;
  const conversations = extractConversationList(await getJson(path));

  for (const conversation of conversations) {
    const conversationId = Number(conversation.id);
    if (!conversationId) continue;

    const messagesPath = `/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/messages`;
    const messages = extractMessages(await getJson(messagesPath))
      .filter(isIncomingMessage)
      .sort((a, b) => Number(a.id || 0) - Number(b.id || 0));

    const lastSeen = Number(state.seen[conversationId] || 0);
    for (const message of messages) {
      const messageId = Number(message.id || 0);
      if (!messageId || messageId <= lastSeen) continue;
      await postShadow(toShadowEnvelope(message, channel));
      state.seen[conversationId] = messageId;
      writeState(state);
    }
  }
}

export async function runOnce() {
  if (!CHATWOOT_BASE_URL || !CHATWOOT_ACCESS_TOKEN) {
    throw new Error('observer_missing_chatwoot_config');
  }
  if (!Object.keys(INBOX_MAP).length) {
    throw new Error('observer_missing_inbox_map');
  }

  const state = readState();
  for (const [inboxId, channel] of Object.entries(INBOX_MAP)) {
    await observeInbox(Number(inboxId), channel, state);
  }
}

async function loop() {
  try {
    await runOnce();
  } catch (error) {
    console.error('[ariana-ai-observer]', error?.message || error);
  } finally {
    setTimeout(loop, POLL_MS).unref();
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  console.log('[ariana-ai-observer] read-only Chatwoot observer starting');
  console.log('[ariana-ai-observer] customer outbound messaging: disabled');
  loop();
}
