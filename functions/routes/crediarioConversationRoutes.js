import crypto from 'crypto';
import {
  getCrediarioConversationModel,
  processAndReplyCrediario,
  processCrediarioConversation
} from '../services/crediarioConversationService.js';
import { getCrediarioEvolutionMediaBase64 } from '../services/crediarioEvolutionMediaService.js';

import {
  getCrediarioMediaStorageConfig,
  persistCrediarioMedia,
  createCrediarioDocumentAccessUrl,
  downloadCrediarioStoredDocument,
  verifyCrediarioStoredDocument
} from '../services/crediarioMediaStorageService.js';

function clean(value = '', max = 4000) {
  return String(value ?? '').trim().slice(0, max);
}

function digits(value = '') {
  return clean(value).replace(/\D/g, '');
}

function normalizeMimeType(value = '') {
  return clean(value, 160).toLowerCase().split(';')[0].trim();
}

function numericFileSize(value) {
  if (Number.isFinite(Number(value))) return Math.max(0, Number(value));

  if (value && typeof value === 'object') {
    if (Number.isFinite(Number(value.low))) return Math.max(0, Number(value.low));
    if (Number.isFinite(Number(value.value))) return Math.max(0, Number(value.value));
    if (typeof value.toNumber === 'function') {
      const converted = Number(value.toNumber());
      if (Number.isFinite(converted)) return Math.max(0, converted);
    }
    if (typeof value.toString === 'function') {
      const converted = Number(value.toString());
      if (Number.isFinite(converted)) return Math.max(0, converted);
    }
  }

  return 0;
}

function normalizeBase64(value = '') {
  const raw = clean(value, 75_000_000);
  if (!raw) return '';

  const commaIndex = raw.indexOf(',');
  if (raw.startsWith('data:') && commaIndex >= 0) {
    return raw.slice(commaIndex + 1).replace(/\s/g, '');
  }

  return raw.replace(/\s/g, '');
}

function estimateBase64Size(base64 = '') {
  const normalized = normalizeBase64(base64);
  if (!normalized) return 0;
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function unwrapMessage(message = {}) {
  let current = message && typeof message === 'object' ? message : {};

  for (let index = 0; index < 8; index += 1) {
    const next =
      current.ephemeralMessage?.message ||
      current.viewOnceMessage?.message ||
      current.viewOnceMessageV2?.message ||
      current.viewOnceMessageV2Extension?.message ||
      current.documentWithCaptionMessage?.message ||
      null;

    if (!next || next === current) break;
    current = next;
  }

  return current;
}

function mediaDescriptor(message = {}, data = {}, body = {}) {
  const unwrapped = unwrapMessage(message);

  const candidates = [
    ['image', unwrapped.imageMessage],
    ['document', unwrapped.documentMessage],
    ['video', unwrapped.videoMessage],
    ['audio', unwrapped.audioMessage],
    ['sticker', unwrapped.stickerMessage]
  ];

  const found = candidates.find(([, node]) => node && typeof node === 'object');
  if (!found) return {};

  const [mediaType, node] = found;

  const base64 = normalizeBase64(
    node.base64 ||
    data.base64 ||
    data.mediaBase64 ||
    data.messageBase64 ||
    body.base64 ||
    body.mediaBase64
  );

  const mediaUrl = clean(
    node.url ||
    node.mediaUrl ||
    node.downloadUrl ||
    data.mediaUrl ||
    data.url ||
    body.mediaUrl ||
    body.url,
    5000
  );

  const mimetype = normalizeMimeType(
    node.mimetype ||
    node.mimeType ||
    data.mimetype ||
    data.mimeType ||
    body.mimetype ||
    body.mimeType
  );

  const fileName = clean(
    node.fileName ||
    node.filename ||
    data.fileName ||
    data.filename ||
    body.fileName ||
    body.filename ||
    `${mediaType}-${Date.now()}`,
    240
  );

  const declaredSize = numericFileSize(
    node.fileLength ||
    node.fileSize ||
    node.size ||
    data.fileLength ||
    data.fileSize ||
    data.size ||
    body.fileLength ||
    body.fileSize ||
    body.size
  );

  const computedSize = declaredSize || estimateBase64Size(base64);

  return {
    mediaType,
    mimetype,
    mimeType: mimetype,
    fileName,
    mediaUrl,
    base64,
    fileSize: computedSize,
    size: computedSize,
    caption: clean(node.caption || '', 4000),
    mediaSha256: clean(node.fileSha256 || node.fileEncSha256 || '', 500),
    directPath: clean(node.directPath || '', 5000)
  };
}

function extractPayload(body = {}) {
  const data = body.data || body;
  const key = data.key || body.key || {};
  const rawMessage = data.message || body.message || {};
  const message = unwrapMessage(rawMessage);

  const remoteJid = clean(
    key.remoteJid ||
    data.remoteJid ||
    body.remoteJid ||
    data.sender ||
    body.sender
  );

  const phone = remoteJid
    .replace(/@s\.whatsapp\.net$/i, '')
    .replace(/@lid$/i, '')
    .replace(/\D/g, '');

  const media = mediaDescriptor(rawMessage, data, body);

  const text = clean(
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.documentMessage?.caption ||
    message.videoMessage?.caption ||
    media.caption ||
    data.messageText ||
    data.text ||
    body.text ||
    body.content
  );

  const eventId = clean(
    key.id ||
    data.messageId ||
    data.id ||
    body.messageId ||
    body.id
  );

  if (Object.keys(media).length) {
    media.providerMessageId = eventId;
  }

  return {
    phone,
    text,
    eventId,
    evolutionMessage: data,
    instanceName: clean(
      body.instance ||
      data.instance ||
      body.instanceName ||
      data.instanceName ||
      process.env.CREDIARIO_EVOLUTION_INSTANCE ||
      'Ariana_crediario',
      120
    ),
    fromMe: Boolean(key.fromMe || data.fromMe || body.fromMe),
    media
  };
}

function webhookAuthorized(req) {
  const expected = clean(process.env.CREDIARIO_WHATSAPP_WEBHOOK_TOKEN);
  if (!expected) return true;

  const received = clean(
    req.headers['x-crediario-webhook-token'] ||
    req.headers['x-webhook-token'] ||
    req.query.token
  );

  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);

  if (expectedBuffer.length !== receivedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

function getMediaValidationConfig() {
  const storage = getCrediarioMediaStorageConfig();

  return {
    maxBytes: storage.maxBytes,
    maxMb: storage.maxMb,
    allowedMimeTypes: new Set([
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'application/pdf'
    ]),
    allowedMediaTypes: new Set(['image', 'document'])
  };
}

function validateMedia(media = {}) {
  if (!media || !Object.keys(media).length) {
    return { valid: true, media: {} };
  }

  const config = getMediaValidationConfig();
  const mediaType = clean(media.mediaType, 40).toLowerCase();
  const mimetype = normalizeMimeType(media.mimetype || media.mimeType);
  const size = numericFileSize(media.fileSize || media.size);

  if (!config.allowedMediaTypes.has(mediaType)) {
    return {
      valid: false,
      status: 415,
      code: 'CREDIARIO_MEDIA_TYPE_NOT_ALLOWED',
      error: 'Envie somente imagem JPG, PNG, WEBP ou documento PDF.'
    };
  }

  if (mimetype && !config.allowedMimeTypes.has(mimetype)) {
    return {
      valid: false,
      status: 415,
      code: 'CREDIARIO_MIME_TYPE_NOT_ALLOWED',
      error: 'Formato de arquivo não permitido. Use JPG, PNG, WEBP ou PDF.'
    };
  }

  if (!media.mediaUrl && !media.base64 && !media.directPath) {
    return {
      valid: false,
      status: 422,
      code: 'CREDIARIO_MEDIA_CONTENT_MISSING',
      error: 'A mensagem informa uma mídia, mas não contém URL, base64 ou caminho para download.'
    };
  }

  if (size > config.maxBytes) {
    return {
      valid: false,
      status: 413,
      code: 'CREDIARIO_MEDIA_TOO_LARGE',
      error: `O arquivo ultrapassa o limite de ${config.maxMb} MB.`
    };
  }

  return {
    valid: true,
    media: {
      ...media,
      mimetype,
      mimeType: mimetype,
      fileSize: size,
      size
    }
  };
}


async function synchronizeConversationWithAnalysis(mongoose, session = {}) {
  if (!session?.conversationId || !session?.phone) return null;

  const collection = mongoose.connection.collection('crediario_analyses');
  const phone = digits(session.phone);
  const customerDocument = digits(session.data?.cpf);
  const now = new Date();
  const docs = session.documents || {};
  const receivedCount = ['identityFront','identityBack','selfie','addressProof','incomeProof']
    .filter((key) => documentReceived(docs[key])).length;
  const completed = session.step === 'AGUARDANDO_ANALISE' || session.status === 'CONCLUIDO';
  const documentCollectionStatus = completed ? 'DOCUMENTOS_RECEBIDOS' : receivedCount > 0 ? 'EM_COLETA' : 'COLETA_INICIADA';

  let analysis = await collection.findOne({ conversationId: session.conversationId });
  if (!analysis) {
    analysis = await collection.findOne({
      conversationId: { $in: ['', null] },
      'customer.phone': phone,
      status: { $in: ['PENDENTE_ANALISE','AGUARDANDO_DOCUMENTOS','EM_ANALISE'] }
    }, { sort: { createdAt: -1 } });
  }

  const customerSet = {
    'customer.name': clean(session.data?.name, 160),
    'customer.document': customerDocument,
    'customer.email': clean(session.data?.email, 160),
    'customer.phone': phone
  };
  Object.keys(customerSet).forEach((key) => { if (!customerSet[key]) delete customerSet[key]; });

  const set = {
    conversationId: session.conversationId,
    documentCollectionStatus,
    ...customerSet,
    'checklist.cpfChecked': Boolean(customerDocument),
    'checklist.identityDocument': documentReceived(docs.identityFront) && documentReceived(docs.identityBack),
    'checklist.residenceProof': documentReceived(docs.addressProof),
    'checklist.incomeChecked': documentReceived(docs.incomeProof),
    'checklist.contactConfirmed': Boolean(session.data?.phone || phone),
    'checklist.referenceConfirmed': Boolean(session.data?.reference1 && session.data?.reference2),
    updatedAt: now
  };

  if (completed) set.status = 'PENDENTE_ANALISE';
  else if (analysis?.status === 'PENDENTE_ANALISE' || analysis?.status === 'AGUARDANDO_DOCUMENTOS') set.status = 'AGUARDANDO_DOCUMENTOS';

  if (analysis) {
    await collection.updateOne(
      { _id: analysis._id },
      {
        $set: set,
        $push: {
          history: {
            at: now,
            action: completed ? 'DOCUMENT_COLLECTION_COMPLETED' : 'DOCUMENT_COLLECTION_UPDATED',
            fromStatus: analysis.status || '',
            toStatus: set.status || analysis.status || '',
            actorId: '',
            actorName: 'WhatsApp Crediário',
            note: '',
            metadata: { conversationId: session.conversationId, receivedDocuments: receivedCount, step: session.step }
          }
        }
      }
    );
    return collection.findOne({ _id: analysis._id });
  }

  // Conversas iniciadas diretamente pelo WhatsApp entram no painel apenas ao concluir a coleta.
  if (!completed) return null;

  const analysisId = `analise_${crypto.randomBytes(8).toString('hex')}`;
  const row = {
    analysisId,
    orderId: '',
    origin: 'WHATSAPP',
    conversationId: session.conversationId,
    documentCollectionStatus: 'DOCUMENTOS_RECEBIDOS',
    customerId: '',
    customer: {
      name: clean(session.data?.name, 160),
      document: customerDocument,
      email: clean(session.data?.email, 160),
      phone
    },
    status: 'PENDENTE_ANALISE',
    baseAmountCents: 0,
    financedAmountCents: 0,
    installmentCount: 0,
    installmentDivisor: 0,
    firstDueDate: '',
    installmentPlan: [],
    requestedDocuments: [],
    checklist: {
      cpfChecked: Boolean(customerDocument),
      identityDocument: documentReceived(docs.identityFront) && documentReceived(docs.identityBack),
      residenceProof: documentReceived(docs.addressProof),
      incomeChecked: documentReceived(docs.incomeProof),
      contactConfirmed: true,
      referenceConfirmed: Boolean(session.data?.reference1 && session.data?.reference2)
    },
    suggestion: { decision: 'ANALISAR', reasons: [], calculatedAt: null },
    internalNote: 'Solicitação iniciada diretamente pelo WhatsApp do Crediário Ariana.',
    decisionNote: '',
    approvedLimitCents: 0,
    purchase: { source: 'WHATSAPP' },
    history: [{
      at: now,
      action: 'ANALYSIS_CREATED_FROM_WHATSAPP',
      fromStatus: '',
      toStatus: 'PENDENTE_ANALISE',
      actorId: '',
      actorName: 'WhatsApp Crediário',
      note: '',
      metadata: { conversationId: session.conversationId, receivedDocuments: receivedCount }
    }],
    createdAt: now,
    updatedAt: now
  };
  await collection.insertOne(row);
  return row;
}


async function hydratePayloadMediaFromEvolution(payload = {}) {
  if (!payload.media || !Object.keys(payload.media).length) return payload;
  if (payload.media.base64) return payload;

  const downloaded = await getCrediarioEvolutionMediaBase64({
    message: payload.evolutionMessage || {},
    messageId: payload.eventId,
    instanceName: payload.instanceName
  });

  payload.media = {
    ...payload.media,
    base64: downloaded.base64,
    mediaUrl: '',
    url: '',
    downloadedFromEvolution: true
  };

  return payload;
}

async function persistPayloadMedia(payload, { documentType = '' } = {}) {
  if (!payload.media || !Object.keys(payload.media).length) return payload;

  payload.media = await persistCrediarioMedia({
    media: payload.media,
    phone: payload.phone,
    instanceName: payload.instanceName,
    eventId: payload.eventId,
    conversationId: payload.conversationId || '',
    documentType
  });

  return payload;
}


const DOCUMENT_KEYS = Object.freeze([
  'identityFront',
  'identityBack',
  'selfie',
  'addressProof',
  'incomeProof'
]);

const DOCUMENT_LABELS = Object.freeze({
  identityFront: 'Documento de identidade — frente',
  identityBack: 'Documento de identidade — verso',
  selfie: 'Selfie do cliente',
  addressProof: 'Comprovante de endereço',
  incomeProof: 'Comprovante de renda'
});

function documentReceived(document = {}) {
  return Boolean(
    document === true ||
    document?.received === true ||
    document?.storageKey ||
    document?.mediaUrl ||
    document?.url
  );
}

function sanitizeDocumentForAdmin(document = {}, key = '') {
  if (!documentReceived(document)) {
    return {
      key,
      label: DOCUMENT_LABELS[key] || key,
      received: false,
      reviewStatus: 'PENDENTE'
    };
  }

  return {
    key,
    label: DOCUMENT_LABELS[key] || key,
    received: true,
    fileName: clean(document.fileName, 240),
    mimeType: clean(document.mimeType || document.mimetype, 160),
    size: numericFileSize(document.size || document.fileSize),
    hash: clean(document.hash, 128),
    providerMessageId: clean(document.providerMessageId, 300),
    storageProvider: clean(document.storageProvider, 80),
    storageKey: clean(document.storageKey, 500),
    storageType: clean(document.storageType, 80),
    resourceType: clean(document.resourceType, 80),
    assetId: clean(document.assetId, 180),
    private: document.private === true,
    receivedAt: document.receivedAt || null,
    persistedAt: document.persistedAt || null,
    reviewStatus: clean(document.reviewStatus || document.review?.status || 'PENDENTE', 40).toUpperCase(),
    reviewedAt: document.reviewedAt || document.review?.reviewedAt || null,
    reviewedBy: clean(document.reviewedBy || document.review?.reviewedBy, 200),
    reviewNote: clean(document.reviewNote || document.review?.note, 1000)
  };
}

function getAdminActor(req = {}) {
  return clean(
    req.admin?.email ||
    req.auth?.email ||
    req.user?.email ||
    req.admin?.id ||
    req.auth?.id ||
    req.user?._id ||
    'admin',
    200
  );
}

function getClientIp(req = {}) {
  return clean(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || '', 300)
    .split(',')[0]
    .trim();
}

function getCrediarioDocumentAuditModel(mongoose) {
  if (mongoose.models.CrediarioDocumentAudit) {
    return mongoose.models.CrediarioDocumentAudit;
  }

  const schema = new mongoose.Schema({
    auditId: { type: String, required: true, unique: true, index: true },
    conversationId: { type: String, required: true, index: true },
    phone: { type: String, default: '', index: true },
    documentKey: { type: String, default: '', index: true },
    action: {
      type: String,
      enum: ['LISTED', 'ACCESS_URL_CREATED', 'VERIFIED', 'REVIEW_UPDATED'],
      required: true,
      index: true
    },
    actor: { type: String, default: '', index: true },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    success: { type: Boolean, default: true, index: true },
    error: { type: String, default: '' }
  }, {
    timestamps: true,
    versionKey: false,
    collection: 'crediario_document_audits'
  });

  return mongoose.model('CrediarioDocumentAudit', schema);
}

async function registerDocumentAudit(Audit, req, data = {}) {
  try {
    return await Audit.create({
      auditId: `cda_${crypto.randomBytes(10).toString('hex')}`,
      conversationId: clean(data.conversationId, 200),
      phone: digits(data.phone),
      documentKey: clean(data.documentKey, 80),
      action: data.action,
      actor: getAdminActor(req),
      ip: getClientIp(req),
      userAgent: clean(req.headers?.['user-agent'], 1000),
      metadata: data.metadata || {},
      success: data.success !== false,
      error: clean(data.error, 1000)
    });
  } catch (auditError) {
    console.warn('[crediario document audit]', auditError.message || auditError);
    return null;
  }
}

function findConversationQuery(mongoose, id = '') {
  const value = clean(id, 200);
  return {
    $or: [
      { conversationId: value },
      ...(mongoose.isValidObjectId(value) ? [{ _id: value }] : [])
    ]
  };
}


function extensionForMimeType(mimeType = '') {
  const map = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'application/pdf': 'pdf'
  };

  return map[normalizeMimeType(mimeType)] || 'bin';
}

function safeInlineFileName(fileName = '', mimeType = '') {
  const extension = extensionForMimeType(mimeType);
  const raw = clean(fileName, 180) || `documento.${extension}`;

  const sanitized =
    raw
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || `documento.${extension}`;

  return /\.[a-z0-9]{2,5}$/i.test(sanitized)
    ? sanitized
    : `${sanitized}.${extension}`;
}

export default function registerCrediarioConversationRoutes(
  app,
  { mongoose, adminRequired }
) {
  const DocumentAudit = getCrediarioDocumentAuditModel(mongoose);

  app.get('/api/webhooks/crediario/whatsapp/health', (_req, res) => {
    const storage = getCrediarioMediaStorageConfig();

    return res.json({
      ok: true,
      service: 'crediario_whatsapp_conversation',
      phase: '3.6',
      mediaCapture: true,
      mediaPersistence: true,
      adminDocumentAudit: true,
      temporarySignedAccess: true,
      storageProvider: storage.provider,
      privateDelivery: storage.privateDelivery,
      storageConfigured: storage.configured,
      allowedFormats: ['JPG', 'PNG', 'WEBP', 'PDF'],
      maxFileMb: storage.maxMb
    });
  });

  app.post('/api/webhooks/crediario/whatsapp', async (req, res) => {
    if (!webhookAuthorized(req)) {
      return res.status(401).json({
        ok: false,
        error: 'Webhook não autorizado.'
      });
    }

    try {
      const payload = extractPayload(req.body || {});

      if (payload.fromMe) {
        return res.json({
          ok: true,
          ignored: true,
          reason: 'fromMe'
        });
      }

      if (!payload.phone) {
        return res.status(400).json({
          ok: false,
          error: 'Telefone de origem não identificado.'
        });
      }

      await hydratePayloadMediaFromEvolution(payload);

      const validation = validateMedia(payload.media);
      if (!validation.valid) {
        return res.status(validation.status || 422).json({
          ok: false,
          code: validation.code,
          error: validation.error
        });
      }

      payload.media = validation.media;
      const result = await processAndReplyCrediario({
        mongoose,
        ...payload
      });

      const linkedAnalysis = await synchronizeConversationWithAnalysis(mongoose, result.session);

      return res.json({
        ok: true,
        duplicate: result.duplicate,
        conversationId: result.session.conversationId,
        step: result.session.step,
        status: result.session.status,
        analysisId: linkedAnalysis?.analysisId || '',
        delivery: result.delivery?.status || 'NOT_SENT',
        media: result.media && Object.keys(result.media).length
          ? {
              captured: true,
              persisted: true,
              private: result.media.private === true,
              mediaType: result.media.mediaType,
              mimeType: result.media.mimeType,
              fileName: result.media.fileName,
              fileSize: result.media.fileSize,
              storageProvider: result.media.storageProvider,
              storageKey: result.media.storageKey,
              providerMessageId: result.media.providerMessageId,
              hash: result.media.hash
            }
          : {
              captured: false,
              persisted: false
            }
      });
    } catch (error) {
      console.error('[crediario webhook 3.6]', error);

      return res.status(Number(error?.status) || 500).json({
        ok: false,
        code: error?.code || 'CREDIARIO_MEDIA_PERSISTENCE_ERROR',
        error: error.message || 'Erro ao armazenar ou processar a mídia do crediário.'
      });
    }
  });

  app.post(
    '/api/admin/crediario/conversas/simular',
    adminRequired,
    async (req, res) => {
      try {
        const payload = {
          mongoose,
          phone: req.body?.phone,
          instanceName: req.body?.instanceName || 'homologacao_local',
          text: req.body?.text || '',
          eventId: req.body?.eventId || `local-${Date.now()}`,
          media: req.body?.media || {}
        };

        const validation = validateMedia(payload.media);
        if (!validation.valid) {
          return res.status(validation.status || 422).json({
            ok: false,
            code: validation.code,
            error: validation.error
          });
        }

        payload.media = validation.media;
        const result = await processCrediarioConversation(payload);

        return res.json({
          ok: true,
          duplicate: result.duplicate,
          reply: result.reply,
          conversation: result.session,
          media: result.media && Object.keys(result.media).length
            ? {
                persisted: true,
                private: result.media.private === true,
                storageProvider: result.media.storageProvider,
                storageKey: result.media.storageKey,
                hash: result.media.hash,
                fileSize: result.media.fileSize
              }
            : {
                persisted: false
              }
        });
      } catch (error) {
        return res.status(Number(error?.status) || 400).json({
          ok: false,
          code: error?.code || 'CREDIARIO_SIMULATION_ERROR',
          error: error.message
        });
      }
    }
  );


  app.get(
    '/api/admin/crediario/conversas/:id/documentos',
    adminRequired,
    async (req, res) => {
      const Model = getCrediarioConversationModel(mongoose);
      const row = await Model.findOne(findConversationQuery(mongoose, req.params.id)).lean();

      if (!row) {
        return res.status(404).json({ ok: false, error: 'Conversa não encontrada.' });
      }

      const documents = DOCUMENT_KEYS.map((key) =>
        sanitizeDocumentForAdmin(row.documents?.[key], key)
      );

      await registerDocumentAudit(DocumentAudit, req, {
        conversationId: row.conversationId,
        phone: row.phone,
        action: 'LISTED',
        metadata: {
          total: documents.length,
          received: documents.filter((item) => item.received).length
        }
      });

      return res.json({
        ok: true,
        conversationId: row.conversationId,
        phone: row.phone,
        customerName: row.data?.name || row.customer?.name || row.customerName || '',
        status: row.status,
        step: row.step,
        summary: {
          expected: DOCUMENT_KEYS.length,
          received: documents.filter((item) => item.received).length,
          approved: documents.filter((item) => item.reviewStatus === 'APROVADO').length,
          rejected: documents.filter((item) => item.reviewStatus === 'REPROVADO').length,
          pending: documents.filter((item) => item.received && item.reviewStatus === 'PENDENTE').length
        },
        documents
      });
    }
  );

  app.post(
    '/api/admin/crediario/conversas/:id/documentos/:documentKey/acesso',
    adminRequired,
    async (req, res) => {
      const Model = getCrediarioConversationModel(mongoose);
      const documentKey = clean(req.params.documentKey, 80);

      if (!DOCUMENT_KEYS.includes(documentKey)) {
        return res.status(400).json({ ok: false, error: 'Tipo de documento inválido.' });
      }

      const row = await Model.findOne(findConversationQuery(mongoose, req.params.id)).lean();
      if (!row) return res.status(404).json({ ok: false, error: 'Conversa não encontrada.' });

      const document = row.documents?.[documentKey];
      if (!documentReceived(document) || !document?.storageKey) {
        return res.status(404).json({ ok: false, error: 'Documento armazenado não encontrado.' });
      }

      try {
        const access = createCrediarioDocumentAccessUrl(document, {
          expiresInSeconds: Math.min(900, Math.max(60, Number(req.body?.expiresInSeconds || 300)))
        });

        await registerDocumentAudit(DocumentAudit, req, {
          conversationId: row.conversationId,
          phone: row.phone,
          documentKey,
          action: 'ACCESS_URL_CREATED',
          metadata: { expiresAt: access.expiresAt }
        });

        return res.json({
          ok: true,
          conversationId: row.conversationId,
          document: sanitizeDocumentForAdmin(document, documentKey),
          access
        });
      } catch (error) {
        await registerDocumentAudit(DocumentAudit, req, {
          conversationId: row.conversationId,
          phone: row.phone,
          documentKey,
          action: 'ACCESS_URL_CREATED',
          success: false,
          error: error.message
        });

        return res.status(Number(error?.status) || 500).json({
          ok: false,
          code: error?.code || 'CREDIARIO_DOCUMENT_ACCESS_ERROR',
          error: error.message
        });
      }
    }
  );

  app.post(
    '/api/admin/crediario/conversas/:id/documentos/:documentKey/conteudo',
    adminRequired,
    async (req, res) => {
      const Model = getCrediarioConversationModel(mongoose);
      const documentKey = clean(req.params.documentKey, 80);

      if (!DOCUMENT_KEYS.includes(documentKey)) {
        return res
          .status(400)
          .json({ ok: false, error: 'Tipo de documento inválido.' });
      }

      const row = await Model.findOne(
        findConversationQuery(mongoose, req.params.id)
      ).lean();

      if (!row) {
        return res
          .status(404)
          .json({ ok: false, error: 'Conversa não encontrada.' });
      }

      const document = row.documents?.[documentKey];

      if (!documentReceived(document) || !document?.storageKey) {
        return res.status(404).json({
          ok: false,
          error: 'Documento armazenado não encontrado.'
        });
      }

      try {
        const downloaded = await downloadCrediarioStoredDocument(document, {
          timeoutMs: 30000
        });

        const mimeType =
          normalizeMimeType(downloaded.mimeType) ||
          'application/octet-stream';

        const fileName = safeInlineFileName(
          downloaded.fileName,
          mimeType
        );

        await registerDocumentAudit(DocumentAudit, req, {
          conversationId: row.conversationId,
          phone: row.phone,
          documentKey,
          action: 'ACCESS_URL_CREATED',
          metadata: {
            deliveryMode: 'BACKEND_INLINE_PROXY',
            mimeType,
            fileName,
            bytes: downloaded.size
          }
        });

        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Length', String(downloaded.size));
        res.setHeader(
          'Content-Disposition',
          `inline; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(
            fileName
          )}`
        );
        res.setHeader('Cache-Control', 'private, no-store, max-age=0');
        res.setHeader('X-Content-Type-Options', 'nosniff');

        return res.status(200).send(downloaded.buffer);
      } catch (error) {
        await registerDocumentAudit(DocumentAudit, req, {
          conversationId: row.conversationId,
          phone: row.phone,
          documentKey,
          action: 'ACCESS_URL_CREATED',
          success: false,
          error: error.message,
          metadata: {
            deliveryMode: 'BACKEND_INLINE_PROXY'
          }
        });

        return res.status(Number(error?.status) || 500).json({
          ok: false,
          code:
            error?.code ||
            'CREDIARIO_DOCUMENT_INLINE_ACCESS_ERROR',
          error: error.message || 'Erro ao abrir documento.'
        });
      }
    }
  );

  app.post(
    '/api/admin/crediario/conversas/:id/documentos/:documentKey/verificar',
    adminRequired,
    async (req, res) => {
      const Model = getCrediarioConversationModel(mongoose);
      const documentKey = clean(req.params.documentKey, 80);
      if (!DOCUMENT_KEYS.includes(documentKey)) {
        return res.status(400).json({ ok: false, error: 'Tipo de documento inválido.' });
      }

      const row = await Model.findOne(findConversationQuery(mongoose, req.params.id)).lean();
      if (!row) return res.status(404).json({ ok: false, error: 'Conversa não encontrada.' });

      const document = row.documents?.[documentKey];
      if (!documentReceived(document)) {
        return res.status(404).json({ ok: false, error: 'Documento não recebido.' });
      }

      try {
        const verification = await verifyCrediarioStoredDocument(document);
        await registerDocumentAudit(DocumentAudit, req, {
          conversationId: row.conversationId,
          phone: row.phone,
          documentKey,
          action: 'VERIFIED',
          metadata: verification
        });
        return res.json({ ok: true, verification });
      } catch (error) {
        await registerDocumentAudit(DocumentAudit, req, {
          conversationId: row.conversationId,
          phone: row.phone,
          documentKey,
          action: 'VERIFIED',
          success: false,
          error: error.message
        });
        return res.status(Number(error?.status) || 500).json({ ok: false, error: error.message });
      }
    }
  );

  app.patch(
    '/api/admin/crediario/conversas/:id/documentos/:documentKey/revisao',
    adminRequired,
    async (req, res) => {
      const Model = getCrediarioConversationModel(mongoose);
      const documentKey = clean(req.params.documentKey, 80);
      const reviewStatus = clean(req.body?.status, 40).toUpperCase();
      const reviewNote = clean(req.body?.note, 1000);

      if (!DOCUMENT_KEYS.includes(documentKey)) {
        return res.status(400).json({ ok: false, error: 'Tipo de documento inválido.' });
      }
      if (!['PENDENTE', 'APROVADO', 'REPROVADO'].includes(reviewStatus)) {
        return res.status(400).json({ ok: false, error: 'Status de revisão inválido.' });
      }

      const row = await Model.findOne(findConversationQuery(mongoose, req.params.id));
      if (!row) return res.status(404).json({ ok: false, error: 'Conversa não encontrada.' });
      if (!documentReceived(row.documents?.[documentKey])) {
        return res.status(404).json({ ok: false, error: 'Documento não recebido.' });
      }

      const current = row.documents[documentKey] || {};
      row.documents[documentKey] = {
        ...current,
        reviewStatus,
        reviewNote,
        reviewedAt: new Date().toISOString(),
        reviewedBy: getAdminActor(req),
        review: {
          ...(current.review || {}),
          status: reviewStatus,
          note: reviewNote,
          reviewedAt: new Date().toISOString(),
          reviewedBy: getAdminActor(req)
        }
      };
      row.markModified('documents');
      await row.save();

      await registerDocumentAudit(DocumentAudit, req, {
        conversationId: row.conversationId,
        phone: row.phone,
        documentKey,
        action: 'REVIEW_UPDATED',
        metadata: { reviewStatus, reviewNote }
      });

      return res.json({
        ok: true,
        conversationId: row.conversationId,
        document: sanitizeDocumentForAdmin(row.documents[documentKey], documentKey)
      });
    }
  );

  app.get(
    '/api/admin/crediario/documentos/auditoria',
    adminRequired,
    async (req, res) => {
      const query = {};
      if (req.query.conversationId) query.conversationId = clean(req.query.conversationId, 200);
      if (req.query.documentKey) query.documentKey = clean(req.query.documentKey, 80);
      if (req.query.action) query.action = clean(req.query.action, 80).toUpperCase();
      if (req.query.actor) query.actor = { $regex: clean(req.query.actor, 200), $options: 'i' };

      const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100)));
      const rows = await DocumentAudit.find(query).sort({ createdAt: -1 }).limit(limit).lean();
      return res.json({ ok: true, total: rows.length, items: rows });
    }
  );

  app.get(
    '/api/admin/crediario/conversas',
    adminRequired,
    async (req, res) => {
      const Model = getCrediarioConversationModel(mongoose);
      const query = {};

      if (req.query.status) query.status = clean(req.query.status).toUpperCase();
      if (req.query.step) query.step = clean(req.query.step).toUpperCase();
      if (req.query.phone) query.phone = { $regex: digits(req.query.phone) };

      const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
      const rows = await Model.find(query).sort({ updatedAt: -1 }).limit(limit).lean();

      return res.json({ ok: true, total: rows.length, items: rows });
    }
  );

  app.get(
    '/api/admin/crediario/conversas/:id',
    adminRequired,
    async (req, res) => {
      const Model = getCrediarioConversationModel(mongoose);
      const row = await Model.findOne({
        $or: [
          { conversationId: req.params.id },
          ...(mongoose.isValidObjectId(req.params.id) ? [{ _id: req.params.id }] : [])
        ]
      }).lean();

      if (!row) {
        return res.status(404).json({ ok: false, error: 'Conversa não encontrada.' });
      }

      return res.json({ ok: true, conversation: row });
    }
  );
}

export { extractPayload, validateMedia };
