function clean(value = '', max = 5000) {
  return String(value ?? '').trim().slice(0, max);
}

function joinUrl(base, path) {
  return `${clean(base).replace(/\/+$/, '')}/${clean(path).replace(/^\/+/, '')}`;
}

function normalizeBase64(value = '') {
  const raw = clean(value, 75_000_000);
  if (!raw) return '';

  if (raw.startsWith('data:')) {
    const comma = raw.indexOf(',');
    if (comma >= 0) return raw.slice(comma + 1).replace(/\s/g, '');
  }

  return raw.replace(/\s/g, '');
}

function extractBase64(data = {}) {
  const candidates = [
    data?.base64,
    data?.data?.base64,
    data?.media?.base64,
    data?.data?.media?.base64,
    data?.response?.base64,
    data?.message?.base64,
    data?.data?.message?.base64
  ];

  for (const candidate of candidates) {
    const normalized = normalizeBase64(candidate);
    if (normalized) return normalized;
  }

  return '';
}

function getConfig(instanceName = '') {
  return {
    baseUrl: clean(
      process.env.CREDIARIO_EVOLUTION_API_URL ||
      process.env.EVOLUTION_API_URL ||
      process.env.EVOLUTION_URL
    ),
    instanceName: clean(
      instanceName ||
      process.env.CREDIARIO_EVOLUTION_INSTANCE ||
      process.env.EVOLUTION_INSTANCE ||
      process.env.EVOLUTION_INSTANCE_NAME ||
      'Ariana_crediario',
      120
    ),
    apiKey: clean(
      process.env.CREDIARIO_EVOLUTION_API_KEY ||
      process.env.EVOLUTION_API_KEY ||
      process.env.EVOLUTION_GLOBAL_API_KEY ||
      process.env.AUTHENTICATION_API_KEY
    )
  };
}

async function parseResponse(response) {
  const raw = await response.text();
  let data = raw;

  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    // Mantém texto para diagnóstico.
  }

  return { raw, data };
}

export async function getCrediarioEvolutionMediaBase64({
  message = {},
  messageId = '',
  instanceName = ''
} = {}) {
  const config = getConfig(instanceName);

  if (!config.baseUrl || !config.instanceName || !config.apiKey) {
    const error = new Error(
      'Evolution API do crediário não configurada para recuperar mídias.'
    );
    error.code = 'CREDIARIO_EVOLUTION_MEDIA_NOT_CONFIGURED';
    error.status = 503;
    throw error;
  }

  const key = message?.key || {};
  const normalizedMessage = {
    ...message,
    key: {
      ...key,
      id: clean(key.id || messageId, 300)
    }
  };

  if (!normalizedMessage.key.id) {
    const error = new Error('A mensagem de mídia não possui ID.');
    error.code = 'CREDIARIO_EVOLUTION_MESSAGE_ID_MISSING';
    error.status = 422;
    throw error;
  }

  const endpoint = joinUrl(
    config.baseUrl,
    `/chat/getBase64FromMediaMessage/${encodeURIComponent(config.instanceName)}`
  );

  const payloads = [
    { message: normalizedMessage, convertToMp4: false },
    { message: normalizedMessage },
    normalizedMessage
  ];

  let lastError = null;

  for (const payload of payloads) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: config.apiKey
        },
        body: JSON.stringify(payload)
      });

      const parsed = await parseResponse(response);

      if (!response.ok) {
        lastError = new Error(
          `Evolution API respondeu ${response.status}: ${
            typeof parsed.data === 'string'
              ? parsed.data.slice(0, 700)
              : JSON.stringify(parsed.data).slice(0, 700)
          }`
        );
        lastError.status = response.status === 404 ? 404 : 502;
        continue;
      }

      const base64 = extractBase64(parsed.data);
      if (base64) {
        return {
          base64,
          endpoint,
          instanceName: config.instanceName,
          messageId: normalizedMessage.key.id
        };
      }

      lastError = new Error(
        'A Evolution API respondeu sem o base64 descriptografado da mídia.'
      );
      lastError.status = 502;
    } catch (error) {
      lastError = error;
    }
  }

  const error = lastError || new Error(
    'Não foi possível recuperar a mídia descriptografada da Evolution API.'
  );
  error.code = error.code || 'CREDIARIO_EVOLUTION_MEDIA_DOWNLOAD_FAILED';
  error.status = Number(error.status) || 502;
  throw error;
}
