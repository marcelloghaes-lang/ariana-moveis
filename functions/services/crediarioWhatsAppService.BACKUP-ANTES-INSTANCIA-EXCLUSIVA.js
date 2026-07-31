function clean(value = '') { return String(value ?? '').trim(); }
function digits(value = '') { return clean(value).replace(/\D/g, ''); }
function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on', 'sim'].includes(clean(value).toLowerCase());
}

export function normalizeBrazilPhone(value = '') {
  let phone = digits(value);
  if (!phone) return '';
  phone = phone.replace(/^0+/, '');
  if (phone.startsWith('55') && phone.length >= 12) return phone;
  if (phone.length === 10 || phone.length === 11) return `55${phone}`;
  return phone;
}

function joinUrl(base, path) {
  return `${clean(base).replace(/\/+$/, '')}/${clean(path).replace(/^\/+/, '')}`;
}

async function readResponse(response) {
  const raw = await response.text();
  let data = raw;
  try { data = raw ? JSON.parse(raw) : {}; } catch {}
  if (!response.ok) {
    const message = typeof data === 'string' ? data.slice(0, 600) : JSON.stringify(data).slice(0, 600);
    throw new Error(`WhatsApp respondeu ${response.status}: ${message}`);
  }
  return data;
}

function extractMessageId(data) {
  return clean(
    data?.key?.id ||
    data?.messageId ||
    data?.id ||
    data?.data?.key?.id ||
    data?.data?.messageId ||
    data?.response?.key?.id
  );
}

export function getCrediarioWhatsAppConfig() {
  const bridgeUrl = clean(process.env.CREDIARIO_NOTIFICATION_URL);
  const evolutionUrl = clean(process.env.EVOLUTION_API_URL || process.env.EVOLUTION_URL);
  const evolutionInstance = clean(process.env.EVOLUTION_INSTANCE || process.env.EVOLUTION_INSTANCE_NAME || 'Ariana_SAC_V2');
  const evolutionApiKey = clean(process.env.EVOLUTION_API_KEY || process.env.EVOLUTION_GLOBAL_API_KEY);
  const chatwootWebhookUrl = clean(process.env.CREDIARIO_CHATWOOT_WEBHOOK_URL);
  const mode = bridgeUrl ? 'bridge' : evolutionUrl && evolutionInstance && evolutionApiKey ? 'evolution' : 'unconfigured';
  return {
    mode,
    configured: mode !== 'unconfigured',
    bridgeConfigured: Boolean(bridgeUrl),
    evolutionConfigured: Boolean(evolutionUrl && evolutionInstance && evolutionApiKey),
    evolutionInstance,
    chatwootMirrorConfigured: Boolean(chatwootWebhookUrl),
    sendPresence: bool(process.env.CREDIARIO_WHATSAPP_SEND_PRESENCE, false)
  };
}

async function mirrorToChatwoot(payload) {
  const url = clean(process.env.CREDIARIO_CHATWOOT_WEBHOOK_URL);
  if (!url) return { ok: false, skipped: true };
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.CREDIARIO_CHATWOOT_WEBHOOK_TOKEN
          ? { Authorization: `Bearer ${clean(process.env.CREDIARIO_CHATWOOT_WEBHOOK_TOKEN)}` }
          : {})
      },
      body: JSON.stringify(payload)
    });
    const data = await readResponse(response);
    return { ok: true, response: data };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function sendByBridge({ phone, message, mediaUrl = '', fileName = '', caption = '', metadata = {} }) {
  const response = await fetch(clean(process.env.CREDIARIO_NOTIFICATION_URL), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.CREDIARIO_NOTIFICATION_TOKEN
        ? { Authorization: `Bearer ${clean(process.env.CREDIARIO_NOTIFICATION_TOKEN)}` }
        : {})
    },
    body: JSON.stringify({
      phone,
      message,
      mediaUrl,
      fileName,
      caption,
      channel: 'whatsapp',
      source: 'crediario_ariana',
      metadata
    })
  });
  const data = await readResponse(response);
  return { provider: 'notification_bridge', messageId: extractMessageId(data), response: data };
}

async function sendEvolutionText({ phone, message }) {
  const base = clean(process.env.EVOLUTION_API_URL || process.env.EVOLUTION_URL);
  const instance = clean(process.env.EVOLUTION_INSTANCE || process.env.EVOLUTION_INSTANCE_NAME || 'Ariana_SAC_V2');
  const apiKey = clean(process.env.EVOLUTION_API_KEY || process.env.EVOLUTION_GLOBAL_API_KEY);
  const response = await fetch(joinUrl(base, `/message/sendText/${encodeURIComponent(instance)}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: apiKey },
    body: JSON.stringify({ number: phone, text: message })
  });
  const data = await readResponse(response);
  return { provider: 'evolution', messageId: extractMessageId(data), response: data };
}

async function sendEvolutionDocument({ phone, mediaUrl, fileName, caption }) {
  const base = clean(process.env.EVOLUTION_API_URL || process.env.EVOLUTION_URL);
  const instance = clean(process.env.EVOLUTION_INSTANCE || process.env.EVOLUTION_INSTANCE_NAME || 'Ariana_SAC_V2');
  const apiKey = clean(process.env.EVOLUTION_API_KEY || process.env.EVOLUTION_GLOBAL_API_KEY);
  const response = await fetch(joinUrl(base, `/message/sendMedia/${encodeURIComponent(instance)}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: apiKey },
    body: JSON.stringify({
      number: phone,
      mediatype: 'document',
      mimetype: 'application/pdf',
      media: mediaUrl,
      fileName: fileName || 'documento-ariana-moveis.pdf',
      caption: caption || ''
    })
  });
  const data = await readResponse(response);
  return { provider: 'evolution', messageId: extractMessageId(data), response: data };
}

export async function sendCrediarioWhatsApp({ phone, message, mediaUrl = '', fileName = '', caption = '', metadata = {} }) {
  const normalizedPhone = normalizeBrazilPhone(phone);
  if (!normalizedPhone || normalizedPhone.length < 12) throw new Error('Telefone/WhatsApp inválido.');
  if (!clean(message) && !clean(mediaUrl)) throw new Error('Informe uma mensagem ou documento para envio.');

  const config = getCrediarioWhatsAppConfig();
  if (!config.configured) {
    return {
      status: 'QUEUED',
      provider: 'pending_configuration',
      messageId: '',
      response: { queued: true, reason: 'Evolution API ou bridge de notificações não configurada.' },
      chatwoot: { ok: false, skipped: true }
    };
  }

  const sent = config.mode === 'bridge'
    ? await sendByBridge({ phone: normalizedPhone, message: clean(message), mediaUrl: clean(mediaUrl), fileName: clean(fileName), caption: clean(caption), metadata })
    : clean(mediaUrl)
      ? await sendEvolutionDocument({ phone: normalizedPhone, mediaUrl: clean(mediaUrl), fileName: clean(fileName), caption: clean(caption || message) })
      : await sendEvolutionText({ phone: normalizedPhone, message: clean(message) });

  const chatwoot = await mirrorToChatwoot({
    event: 'crediario_whatsapp_sent',
    phone: normalizedPhone,
    message: clean(message),
    mediaUrl: clean(mediaUrl),
    fileName: clean(fileName),
    provider: sent.provider,
    providerMessageId: sent.messageId,
    metadata
  });

  return { status: 'SENT', ...sent, chatwoot };
}
