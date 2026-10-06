function clean(value = '') {
  return String(value ?? '').trim();
}

function digits(value = '') {
  return clean(value).replace(/\D/g, '');
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on', 'sim'].includes(clean(value).toLowerCase());
}

export function normalizeBrazilPhone(value = '') {
  let phone = digits(value);

  if (!phone) return '';

  phone = phone.replace(/^0+/, '');

  if (phone.startsWith('55') && phone.length >= 12) {
    return phone;
  }

  if (phone.length === 10 || phone.length === 11) {
    return `55${phone}`;
  }

  return phone;
}

function joinUrl(base, path) {
  return `${clean(base).replace(/\/+$/, '')}/${clean(path).replace(/^\/+/, '')}`;
}

async function readResponse(response) {
  const raw = await response.text();
  let data = raw;

  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    // Mantém a resposta como texto quando não for JSON.
  }

  if (!response.ok) {
    const message =
      typeof data === 'string'
        ? data.slice(0, 600)
        : JSON.stringify(data).slice(0, 600);

    throw new Error(`WhatsApp respondeu ${response.status}: ${message}`);
  }

  return data;
}

function isPlaceholderUrl(value = '') {
  const normalized = clean(value).toLowerCase();

  if (!normalized) return false;

  return (
    normalized.includes('seu-endpoint-de-notificacoes') ||
    normalized.includes('seu_endpoint_de_notificacoes') ||
    normalized.includes('example.com') ||
    normalized.includes('localhost-placeholder')
  );
}

function getCrediarioBridgeUrl() {
  const bridgeUrl = clean(process.env.CREDIARIO_NOTIFICATION_URL);

  if (!bridgeUrl || isPlaceholderUrl(bridgeUrl)) {
    return '';
  }

  return bridgeUrl;
}

function getCrediarioEvolutionUrl() {
  return clean(
    process.env.CREDIARIO_EVOLUTION_API_URL ||
      process.env.EVOLUTION_API_URL ||
      process.env.EVOLUTION_URL
  );
}

function getCrediarioEvolutionInstance() {
  return clean(
    process.env.CREDIARIO_EVOLUTION_INSTANCE ||
      process.env.EVOLUTION_INSTANCE ||
      process.env.EVOLUTION_INSTANCE_NAME ||
      'Ariana_crediario'
  );
}

function getCrediarioEvolutionApiKey() {
  return clean(
    process.env.CREDIARIO_EVOLUTION_API_KEY ||
      process.env.EVOLUTION_API_KEY ||
      process.env.EVOLUTION_GLOBAL_API_KEY
  );
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
  const bridgeUrl = getCrediarioBridgeUrl();
  const evolutionUrl = getCrediarioEvolutionUrl();
  const evolutionInstance = getCrediarioEvolutionInstance();
  const evolutionApiKey = getCrediarioEvolutionApiKey();
  const chatwootWebhookUrl = clean(process.env.CREDIARIO_CHATWOOT_WEBHOOK_URL);

  const evolutionConfigured = Boolean(
    evolutionUrl && evolutionInstance && evolutionApiKey
  );

  const mode = bridgeUrl
    ? 'bridge'
    : evolutionConfigured
      ? 'evolution'
      : 'unconfigured';

  return {
    mode,
    configured: mode !== 'unconfigured',
    bridgeConfigured: Boolean(bridgeUrl),
    evolutionConfigured,
    evolutionInstance,
    chatwootMirrorConfigured: Boolean(chatwootWebhookUrl),
    sendPresence: bool(process.env.CREDIARIO_WHATSAPP_SEND_PRESENCE, false)
  };
}

async function mirrorToChatwoot(payload) {
  const url = clean(process.env.CREDIARIO_CHATWOOT_WEBHOOK_URL);

  if (!url) {
    return { ok: false, skipped: true };
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.CREDIARIO_CHATWOOT_WEBHOOK_TOKEN
          ? {
              Authorization: `Bearer ${clean(
                process.env.CREDIARIO_CHATWOOT_WEBHOOK_TOKEN
              )}`
            }
          : {})
      },
      body: JSON.stringify(payload)
    });

    const data = await readResponse(response);

    return {
      ok: true,
      response: data
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || String(error)
    };
  }
}

async function sendByBridge({
  phone,
  message,
  mediaUrl = '',
  fileName = '',
  caption = '',
  metadata = {}
}) {
  const bridgeUrl = getCrediarioBridgeUrl();

  if (!bridgeUrl) {
    throw new Error('Bridge de notificações do crediário não configurado.');
  }

  const response = await fetch(bridgeUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.CREDIARIO_NOTIFICATION_TOKEN
        ? {
            Authorization: `Bearer ${clean(
              process.env.CREDIARIO_NOTIFICATION_TOKEN
            )}`
          }
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

  return {
    provider: 'notification_bridge',
    messageId: extractMessageId(data),
    response: data
  };
}

async function sendEvolutionText({ phone, message }) {
  const base = getCrediarioEvolutionUrl();
  const instance = getCrediarioEvolutionInstance();
  const apiKey = getCrediarioEvolutionApiKey();

  if (!base || !instance || !apiKey) {
    throw new Error(
      'Evolution API do crediário não configurada corretamente.'
    );
  }

  const response = await fetch(
    joinUrl(base, `/message/sendText/${encodeURIComponent(instance)}`),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: apiKey
      },
      body: JSON.stringify({
        number: phone,
        text: message
      })
    }
  );

  const data = await readResponse(response);

  return {
    provider: 'evolution',
    messageId: extractMessageId(data),
    response: data
  };
}

async function sendEvolutionDocument({
  phone,
  mediaUrl,
  fileName,
  caption
}) {
  const base = getCrediarioEvolutionUrl();
  const instance = getCrediarioEvolutionInstance();
  const apiKey = getCrediarioEvolutionApiKey();

  if (!base || !instance || !apiKey) {
    throw new Error(
      'Evolution API do crediário não configurada corretamente.'
    );
  }

  const response = await fetch(
    joinUrl(base, `/message/sendMedia/${encodeURIComponent(instance)}`),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: apiKey
      },
      body: JSON.stringify({
        number: phone,
        mediatype: 'document',
        mimetype: 'application/pdf',
        media: mediaUrl,
        fileName: fileName || 'documento-ariana-moveis.pdf',
        caption: caption || ''
      })
    }
  );

  const data = await readResponse(response);

  return {
    provider: 'evolution',
    messageId: extractMessageId(data),
    response: data
  };
}

export async function sendCrediarioWhatsApp({
  phone,
  message,
  mediaUrl = '',
  fileName = '',
  caption = '',
  metadata = {}
}) {
  const normalizedPhone = normalizeBrazilPhone(phone);

  if (!normalizedPhone || normalizedPhone.length < 12) {
    const error = new Error('Telefone/WhatsApp inválido.');
    error.code = 'CREDIARIO_WHATSAPP_INVALID_PHONE';
    error.status = 400;
    throw error;
  }

  if (!clean(message) && !clean(mediaUrl)) {
    const error = new Error('Informe uma mensagem ou documento para envio.');
    error.code = 'CREDIARIO_WHATSAPP_EMPTY_MESSAGE';
    error.status = 400;
    throw error;
  }

  const config = getCrediarioWhatsAppConfig();

  if (!config.configured) {
    const error = new Error(
      'Evolution API e bridge de notificações não estão configurados.'
    );
    error.code = 'CREDIARIO_WHATSAPP_NOT_CONFIGURED';
    error.status = 503;
    throw error;
  }

  const attempts = [];
  let sent = null;

  async function sendByEvolutionProvider() {
    if (clean(mediaUrl)) {
      return sendEvolutionDocument({
        phone: normalizedPhone,
        mediaUrl: clean(mediaUrl),
        fileName: clean(fileName),
        caption: clean(caption || message)
      });
    }

    return sendEvolutionText({
      phone: normalizedPhone,
      message: clean(message)
    });
  }

  if (config.bridgeConfigured) {
    try {
      sent = await sendByBridge({
        phone: normalizedPhone,
        message: clean(message),
        mediaUrl: clean(mediaUrl),
        fileName: clean(fileName),
        caption: clean(caption),
        metadata
      });

      attempts.push({
        provider: 'notification_bridge',
        ok: true,
        messageId: sent.messageId || ''
      });
    } catch (error) {
      attempts.push({
        provider: 'notification_bridge',
        ok: false,
        error: error?.message || String(error)
      });
    }
  }

  if (!sent && config.evolutionConfigured) {
    try {
      sent = await sendByEvolutionProvider();

      attempts.push({
        provider: 'evolution',
        ok: true,
        messageId: sent.messageId || ''
      });
    } catch (error) {
      attempts.push({
        provider: 'evolution',
        ok: false,
        error: error?.message || String(error)
      });
    }
  }

  if (!sent) {
    const details = attempts
      .map((item) => `${item.provider}: ${item.error || 'falhou'}`)
      .join(' | ');

    const error = new Error(
      `Não foi possível enviar o WhatsApp. ${
        details || 'Nenhum provedor disponível.'
      }`
    );
    error.code = 'CREDIARIO_WHATSAPP_ALL_PROVIDERS_FAILED';
    error.status = 502;
    error.attempts = attempts;
    throw error;
  }

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

  return {
    status: 'SENT',
    ...sent,
    attempts,
    normalizedPhone,
    chatwoot
  };
}
