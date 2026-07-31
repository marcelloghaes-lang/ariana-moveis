import crypto from 'crypto';
import { v2 as cloudinary } from 'cloudinary';

function clean(value = '', max = 5000) {
  return String(value ?? '').trim().slice(0, max);
}

function digits(value = '') {
  return clean(value).replace(/\D/g, '');
}

function normalizeMimeType(value = '') {
  return clean(value, 160).toLowerCase().split(';')[0].trim();
}

function numberValue(value = 0) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function isCloudinaryConfigured() {
  return Boolean(
    clean(process.env.CLOUDINARY_CLOUD_NAME) &&
    clean(process.env.CLOUDINARY_API_KEY) &&
    clean(process.env.CLOUDINARY_API_SECRET)
  );
}

function sanitizePart(value = '', fallback = 'arquivo') {
  const normalized = clean(value, 180)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);

  return normalized || fallback;
}

function extensionFromMime(mimeType = '') {
  const mime = normalizeMimeType(mimeType);
  const map = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'application/pdf': 'pdf'
  };
  return map[mime] || 'bin';
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

function assertAllowedContentType(mimeType = '') {
  const allowed = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'application/pdf'
  ]);

  const normalized = normalizeMimeType(mimeType);
  if (normalized && !allowed.has(normalized)) {
    const error = new Error('Formato não permitido para armazenamento do crediário.');
    error.code = 'CREDIARIO_STORAGE_MIME_NOT_ALLOWED';
    error.status = 415;
    throw error;
  }

  return normalized;
}

function bufferFromBase64(base64 = '') {
  const normalized = normalizeBase64(base64);
  if (!normalized) return null;

  const buffer = Buffer.from(normalized, 'base64');
  if (!buffer.length) {
    const error = new Error('Conteúdo base64 da mídia está vazio ou inválido.');
    error.code = 'CREDIARIO_INVALID_BASE64';
    error.status = 422;
    throw error;
  }

  return buffer;
}

async function downloadBuffer(url, { timeoutMs, maxBytes, headers = {} } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'image/jpeg,image/png,image/webp,application/pdf,application/octet-stream',
        ...headers
      },
      redirect: 'follow',
      signal: controller.signal
    });

    if (!response.ok) {
      const error = new Error(`Falha ao baixar a mídia recebida (${response.status}).`);
      error.code = 'CREDIARIO_MEDIA_DOWNLOAD_FAILED';
      error.status = 502;
      throw error;
    }

    const contentLength = numberValue(response.headers.get('content-length'));
    if (contentLength > maxBytes) {
      const error = new Error('O arquivo recebido ultrapassa o limite permitido.');
      error.code = 'CREDIARIO_MEDIA_TOO_LARGE';
      error.status = 413;
      throw error;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (!buffer.length) {
      const error = new Error('A mídia baixada está vazia.');
      error.code = 'CREDIARIO_MEDIA_EMPTY';
      error.status = 422;
      throw error;
    }

    if (buffer.length > maxBytes) {
      const error = new Error('O arquivo recebido ultrapassa o limite permitido.');
      error.code = 'CREDIARIO_MEDIA_TOO_LARGE';
      error.status = 413;
      throw error;
    }

    return {
      buffer,
      contentType: normalizeMimeType(response.headers.get('content-type')),
      size: buffer.length
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('Tempo esgotado ao baixar a mídia da Evolution API.');
      timeoutError.code = 'CREDIARIO_MEDIA_DOWNLOAD_TIMEOUT';
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function evolutionDownloadHeaders() {
  const apiKey = clean(
    process.env.CREDIARIO_EVOLUTION_API_KEY ||
    process.env.EVOLUTION_API_KEY ||
    process.env.AUTHENTICATION_API_KEY
  );

  return apiKey ? { apikey: apiKey } : {};
}


function detectMimeTypeFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return '';

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  if (
    buffer.length >= 12 &&
    buffer.slice(0, 4).toString('ascii') === 'RIFF' &&
    buffer.slice(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }

  if (buffer.slice(0, 5).toString('ascii') === '%PDF-') {
    return 'application/pdf';
  }

  return '';
}

function assertValidDocumentBuffer(buffer, declaredMimeType = '') {
  const detected = detectMimeTypeFromBuffer(buffer);
  const declaredRaw = normalizeMimeType(declaredMimeType);
  const declared = declaredRaw === 'image/jpg' ? 'image/jpeg' : declaredRaw;

  if (!detected) {
    const firstBytes = Buffer.isBuffer(buffer)
      ? buffer.subarray(0, 16).toString('hex')
      : '';

    const error = new Error(
      'A mídia recebida não é uma foto ou PDF válido. O conteúdo pode estar criptografado ou corrompido.'
    );
    error.code = 'CREDIARIO_MEDIA_INVALID_SIGNATURE';
    error.status = 422;
    error.metadata = { firstBytes };
    throw error;
  }

  if (declared && declared !== detected) {
    const error = new Error(
      `O formato real do arquivo (${detected}) não corresponde ao formato informado (${declared}).`
    );
    error.code = 'CREDIARIO_MEDIA_MIME_MISMATCH';
    error.status = 422;
    throw error;
  }

  return detected;
}

function cloudinaryResourceTypeForMime(mimeType = '') {
  return normalizeMimeType(mimeType).startsWith('image/')
    ? 'image'
    : 'raw';
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function uploadPrivateBuffer(buffer, {
  folder,
  publicId,
  resourceType = 'auto',
  context = {}
} = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: publicId,
        resource_type: resourceType,
        type: 'authenticated',
        overwrite: false,
        unique_filename: false,
        use_filename: false,
        invalidate: false,
        context
      },
      (error, result) => {
        if (error) return reject(error);
        return resolve(result);
      }
    );

    stream.end(buffer);
  });
}

export function getCrediarioMediaStorageConfig() {
  const maxMb = Math.min(25, Math.max(1, envNumber('CREDIARIO_MEDIA_MAX_MB', 10)));

  return {
    configured: isCloudinaryConfigured(),
    provider: 'cloudinary',
    privateDelivery: true,
    uploadType: 'authenticated',
    folder: clean(
      process.env.CREDIARIO_CLOUDINARY_FOLDER ||
      'ariana_moveis/crediario/documentos',
      300
    ).replace(/^\/+|\/+$/g, ''),
    maxMb,
    maxBytes: Math.round(maxMb * 1024 * 1024),
    downloadTimeoutMs: Math.min(
      120_000,
      Math.max(5_000, envNumber('CREDIARIO_MEDIA_DOWNLOAD_TIMEOUT_MS', 30_000))
    )
  };
}

export async function persistCrediarioMedia({
  media = {},
  phone = '',
  instanceName = '',
  eventId = '',
  conversationId = '',
  documentType = ''
} = {}) {
  if (!media || !Object.keys(media).length) return {};

  const config = getCrediarioMediaStorageConfig();
  if (!config.configured) {
    const error = new Error('Cloudinary não configurado para armazenar os documentos do crediário.');
    error.code = 'CREDIARIO_CLOUDINARY_NOT_CONFIGURED';
    error.status = 503;
    throw error;
  }

  if (
    clean(media.storageProvider).toLowerCase() === 'cloudinary' &&
    clean(media.storageKey)
  ) {
    return media;
  }

  let buffer = bufferFromBase64(media.base64);
  let downloadedMimeType = '';
  let downloadedSize = buffer?.length || 0;

  if (!buffer) {
    const mediaUrl = clean(media.mediaUrl || media.url, 5000);
    if (!mediaUrl) {
      const error = new Error('A mídia não possui base64 nem URL disponível para download.');
      error.code = 'CREDIARIO_MEDIA_SOURCE_MISSING';
      error.status = 422;
      throw error;
    }

    const downloaded = await downloadBuffer(mediaUrl, {
      timeoutMs: config.downloadTimeoutMs,
      maxBytes: config.maxBytes,
      headers: evolutionDownloadHeaders()
    });

    buffer = downloaded.buffer;
    downloadedMimeType = downloaded.contentType;
    downloadedSize = downloaded.size;
  }

  if (buffer.length > config.maxBytes) {
    const error = new Error(`O arquivo ultrapassa o limite de ${config.maxMb} MB.`);
    error.code = 'CREDIARIO_MEDIA_TOO_LARGE';
    error.status = 413;
    throw error;
  }

  const declaredMimeType = assertAllowedContentType(
    media.mimeType ||
    media.mimetype ||
    downloadedMimeType
  );

  const mimeType = assertValidDocumentBuffer(buffer, declaredMimeType);
  const extension = extensionFromMime(mimeType);
  const originalFileName = clean(
    media.fileName ||
    `documento-${Date.now()}.${extension}`,
    240
  );

  const safePhone = digits(phone).slice(-15) || 'sem-telefone';
  const safeConversation = sanitizePart(conversationId, 'sem-conversa');
  const safeDocumentType = sanitizePart(documentType || media.documentType, 'documento');
  const safeEventId = sanitizePart(
    eventId ||
    media.providerMessageId ||
    crypto.randomBytes(8).toString('hex'),
    'evento'
  );

  const cloudinaryResourceType = cloudinaryResourceTypeForMime(mimeType);

  const publicIdBase = [
    safeDocumentType,
    safeEventId,
    crypto.randomBytes(4).toString('hex')
  ].join('-');

  const publicId =
    cloudinaryResourceType === 'raw'
      ? `${publicIdBase}.${extension}`
      : publicIdBase;

  const folder = [
    config.folder,
    sanitizePart(instanceName, 'instancia'),
    safePhone,
    safeConversation
  ].join('/');

  const hash = sha256(buffer);
  const uploaded = await uploadPrivateBuffer(buffer, {
    folder,
    publicId,
    resourceType: cloudinaryResourceType,
    context: {
      modulo: 'crediario',
      telefone: safePhone,
      conversa: safeConversation,
      tipo_documento: safeDocumentType,
      evento: safeEventId,
      hash_sha256: hash,
      nome_original: originalFileName
    }
  });

  if (!uploaded?.public_id) {
    const error = new Error('O Cloudinary não retornou a identificação do arquivo armazenado.');
    error.code = 'CREDIARIO_CLOUDINARY_INVALID_RESPONSE';
    error.status = 502;
    throw error;
  }

  return {
    ...media,
    received: true,
    mediaUrl: clean(uploaded.secure_url || uploaded.url, 5000),
    url: clean(uploaded.secure_url || uploaded.url, 5000),
    storageProvider: 'cloudinary',
    storageKey: clean(uploaded.public_id, 500),
    storageType: clean(uploaded.type || 'authenticated', 80),
    resourceType: clean(uploaded.resource_type || 'auto', 80),
    assetId: clean(uploaded.asset_id, 180),
    version: numberValue(uploaded.version),
    fileName: originalFileName,
    mimeType,
    mimetype: mimeType,
    size: numberValue(uploaded.bytes || downloadedSize || buffer.length),
    fileSize: numberValue(uploaded.bytes || downloadedSize || buffer.length),
    hash,
    providerMessageId: clean(media.providerMessageId || eventId, 300),
    receivedAt: new Date().toISOString(),
    persistedAt: new Date().toISOString(),
    private: true,
    base64: ''
  };
}


export function createCrediarioDocumentAccessUrl(document = {}, { expiresInSeconds = 300 } = {}) {
  if (!isCloudinaryConfigured()) {
    const error = new Error('Cloudinary não configurado para gerar acesso ao documento.');
    error.code = 'CREDIARIO_CLOUDINARY_NOT_CONFIGURED';
    error.status = 503;
    throw error;
  }

  const publicId = clean(document.storageKey || document.publicId, 500);
  if (!publicId) {
    const error = new Error('Documento sem identificação de armazenamento.');
    error.code = 'CREDIARIO_DOCUMENT_STORAGE_KEY_MISSING';
    error.status = 422;
    throw error;
  }

  const resourceType = clean(document.resourceType || 'image', 80);
  const storageType = clean(document.storageType || 'authenticated', 80);
  const expiresAt = Math.floor(Date.now() / 1000) + Math.min(900, Math.max(60, Number(expiresInSeconds || 300)));

  const url = cloudinary.url(publicId, {
    resource_type: resourceType,
    type: storageType,
    sign_url: true,
    secure: true,
    expires_at: expiresAt
  });

  return {
    url,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
    expiresInSeconds: expiresAt - Math.floor(Date.now() / 1000)
  };
}


export async function downloadCrediarioStoredDocument(
  document = {},
  { timeoutMs = 30000 } = {}
) {
  const access = createCrediarioDocumentAccessUrl(document, {
    expiresInSeconds: 300
  });

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.min(120000, Math.max(5000, Number(timeoutMs || 30000)))
  );

  try {
    const response = await fetch(access.url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept:
          'image/jpeg,image/png,image/webp,application/pdf,application/octet-stream'
      }
    });

    if (!response.ok) {
      const error = new Error(
        `Falha ao recuperar o documento no Cloudinary (${response.status}).`
      );
      error.code =
        response.status === 404
          ? 'CREDIARIO_DOCUMENT_CLOUDINARY_NOT_FOUND'
          : 'CREDIARIO_DOCUMENT_CLOUDINARY_DOWNLOAD_FAILED';
      error.status = response.status === 404 ? 404 : 502;
      throw error;
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (!buffer.length) {
      const error = new Error('O documento armazenado está vazio.');
      error.code = 'CREDIARIO_DOCUMENT_EMPTY';
      error.status = 422;
      throw error;
    }

    return {
      buffer,
      size: buffer.length,
      mimeType: normalizeMimeType(
        document.mimeType ||
          document.mimetype ||
          response.headers.get('content-type') ||
          'application/octet-stream'
      ),
      fileName: clean(document.fileName, 240),
      access
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error(
        'Tempo esgotado ao abrir o documento armazenado.'
      );
      timeoutError.code = 'CREDIARIO_DOCUMENT_DOWNLOAD_TIMEOUT';
      timeoutError.status = 504;
      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function verifyCrediarioStoredDocument(document = {}) {
  const publicId = clean(document.storageKey || document.publicId, 500);
  if (!publicId) return { ok: false, exists: false, reason: 'storage_key_missing' };

  try {
    const result = await cloudinary.api.resource(publicId, {
      resource_type: clean(document.resourceType || 'image', 80),
      type: clean(document.storageType || 'authenticated', 80)
    });

    return {
      ok: true,
      exists: true,
      publicId: clean(result.public_id, 500),
      assetId: clean(result.asset_id, 180),
      bytes: numberValue(result.bytes),
      format: clean(result.format, 40),
      resourceType: clean(result.resource_type, 80),
      storageType: clean(result.type, 80),
      createdAt: result.created_at || null
    };
  } catch (error) {
    if (Number(error?.http_code) === 404) {
      return { ok: true, exists: false, reason: 'not_found' };
    }
    throw error;
  }
}
