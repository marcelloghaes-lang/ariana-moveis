import crypto from 'crypto';
import { normalizeBrazilPhone, sendCrediarioWhatsApp } from './crediarioWhatsAppService.js';
import { persistCrediarioMedia } from './crediarioMediaStorageService.js';

export const CREDIARIO_FLOW_STEPS = Object.freeze({
  INICIO: 'INICIO',
  AGUARDANDO_CONSENTIMENTO: 'AGUARDANDO_CONSENTIMENTO',
  AGUARDANDO_NOME: 'AGUARDANDO_NOME',
  AGUARDANDO_CPF: 'AGUARDANDO_CPF',
  AGUARDANDO_NASCIMENTO: 'AGUARDANDO_NASCIMENTO',
  AGUARDANDO_ESTADO_CIVIL: 'AGUARDANDO_ESTADO_CIVIL',
  AGUARDANDO_PROFISSAO: 'AGUARDANDO_PROFISSAO',
  AGUARDANDO_TELEFONE: 'AGUARDANDO_TELEFONE',
  AGUARDANDO_EMAIL: 'AGUARDANDO_EMAIL',
  AGUARDANDO_DOCUMENTO_FRENTE: 'AGUARDANDO_DOCUMENTO_FRENTE',
  AGUARDANDO_DOCUMENTO_VERSO: 'AGUARDANDO_DOCUMENTO_VERSO',
  AGUARDANDO_SELFIE: 'AGUARDANDO_SELFIE',
  AGUARDANDO_COMPROVANTE_ENDERECO: 'AGUARDANDO_COMPROVANTE_ENDERECO',
  AGUARDANDO_COMPROVANTE_RENDA: 'AGUARDANDO_COMPROVANTE_RENDA',
  AGUARDANDO_REFERENCIA_1: 'AGUARDANDO_REFERENCIA_1',
  AGUARDANDO_REFERENCIA_2: 'AGUARDANDO_REFERENCIA_2',
  CONFERENCIA: 'CONFERENCIA',
  AGUARDANDO_ANALISE: 'AGUARDANDO_ANALISE'
});

const SESSION_TIMEOUT_HOURS = Math.max(1, Number(process.env.CREDIARIO_SESSION_TIMEOUT_HOURS || 72));
const CONSENT_TEXT = 'Para iniciar sua solicitação, precisamos coletar e armazenar seus dados e documentos exclusivamente para análise de crédito. Responda *ACEITO* para continuar ou *NÃO ACEITO* para encerrar.';

function clean(value = '', max = 600) { return String(value ?? '').trim().slice(0, max); }
function digits(value = '') { return clean(value).replace(/\D/g, ''); }
function normalizeCommand(value = '') { return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase(); }

const CREDIARIO_CANONICAL_INSTANCE = 'Ariana crediario';

function normalizeCrediarioInstanceName(value = '') {
  const raw = clean(value, 120);
  if (!raw) return CREDIARIO_CANONICAL_INSTANCE;

  const comparable = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  if (comparable === 'ariana crediario') {
    return CREDIARIO_CANONICAL_INSTANCE;
  }

  return raw;
}

function crediarioInstanceAliases(value = '') {
  const canonical = normalizeCrediarioInstanceName(value);

  if (canonical === CREDIARIO_CANONICAL_INSTANCE) {
    return [
      CREDIARIO_CANONICAL_INSTANCE,
      'Ariana_crediario',
      'ariana crediario',
      'ariana_crediario'
    ];
  }

  return [canonical];
}
function eventHash(value = '') { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function isMedia(input = {}) {
  return Boolean(
    input.mediaType || input.mediaUrl || input.url || input.mimetype || input.mimeType ||
    input.fileName || input.storageKey || input.base64
  );
}

function emptyDocument() {
  return {
    received: false,
    url: '', mediaUrl: '', storageProvider: '', storageKey: '', storageType: '', resourceType: '', assetId: '', version: 0,
    fileName: '', mimeType: '', mimetype: '', size: 0, fileSize: 0, hash: '', providerMessageId: '',
    receivedAt: null, persistedAt: null, private: false,
    reviewStatus: 'PENDENTE', reviewNote: '', reviewedBy: '', reviewedAt: null,
    review: { status: 'PENDENTE', note: '', reviewedBy: '', reviewedAt: null }
  };
}

function emptyDocuments() {
  return {
    identityFront: emptyDocument(), identityBack: emptyDocument(), selfie: emptyDocument(),
    addressProof: emptyDocument(), incomeProof: emptyDocument()
  };
}

function documentReceived(document = null) {
  if (document === true) return true;
  if (!document || typeof document !== 'object') return false;
  return Boolean(document.received || document.storageKey || document.assetId || document.mediaUrl || document.url);
}

function documentRecordFromMedia(media = {}) {
  const receivedAt = media.receivedAt ? new Date(media.receivedAt) : new Date();
  const persistedAt = media.persistedAt ? new Date(media.persistedAt) : null;
  const size = Math.max(0, Number(media.size || media.fileSize || 0));

  return {
    received: true,
    url: clean(media.url || media.mediaUrl, 5000),
    mediaUrl: clean(media.mediaUrl || media.url, 5000),
    storageProvider: clean(media.storageProvider, 80),
    storageKey: clean(media.storageKey, 500),
    storageType: clean(media.storageType, 80),
    resourceType: clean(media.resourceType, 80),
    assetId: clean(media.assetId, 180),
    version: Math.max(0, Number(media.version || 0)),
    fileName: clean(media.fileName, 240),
    mimeType: clean(media.mimeType || media.mimetype, 160).toLowerCase(),
    mimetype: clean(media.mimetype || media.mimeType, 160).toLowerCase(),
    size,
    fileSize: size,
    hash: clean(media.hash, 180),
    providerMessageId: clean(media.providerMessageId, 300),
    receivedAt: Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt,
    persistedAt: persistedAt && !Number.isNaN(persistedAt.getTime()) ? persistedAt : null,
    private: media.private === true,
    reviewStatus: 'PENDENTE',
    reviewNote: '',
    reviewedBy: '',
    reviewedAt: null,
    review: {
      status: 'PENDENTE',
      note: '',
      reviewedBy: '',
      reviewedAt: null
    }
  };
}

export function isValidCpf(value = '') {
  const cpf = digits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const calc = (size) => {
    let sum = 0;
    for (let i = 0; i < size; i += 1) sum += Number(cpf[i]) * (size + 1 - i);
    const result = (sum * 10) % 11;
    return result === 10 ? 0 : result;
  };
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
}

function normalizeDateBR(value = '') {
  const raw = clean(value, 20);
  const match = raw.match(/^(\d{2})[\/.-](\d{2})[\/.-](\d{4})$/);
  if (!match) return '';
  const [, dd, mm, yyyy] = match;
  const date = new Date(`${yyyy}-${mm}-${dd}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.getUTCDate() !== Number(dd) || date.getUTCMonth() + 1 !== Number(mm)) return '';
  if (date > new Date()) return '';
  return `${yyyy}-${mm}-${dd}`;
}

function validEmail(value = '') { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value, 180)); }
function validName(value = '') { return clean(value, 150).split(/\s+/).filter(Boolean).length >= 2; }
function validPhone(value = '') { const d = digits(value); return d.length === 10 || d.length === 11 || (d.startsWith('55') && d.length >= 12 && d.length <= 13); }
function validReference(value = '') { return clean(value, 240).length >= 8 && digits(value).length >= 10; }

const MARITAL_STATUS_MAP = Object.freeze({
  SOLTEIRO: 'SOLTEIRO',
  SOLTEIRA: 'SOLTEIRO',
  CASADO: 'CASADO',
  CASADA: 'CASADO',
  DIVORCIADO: 'DIVORCIADO',
  DIVORCIADA: 'DIVORCIADO',
  SEPARADO: 'SEPARADO',
  SEPARADA: 'SEPARADO',
  VIUVO: 'VIÚVO',
  VIUVA: 'VIÚVO',
  'UNIAO ESTAVEL': 'UNIÃO ESTÁVEL'
});

function normalizeMaritalStatus(value = '') {
  return MARITAL_STATUS_MAP[normalizeCommand(value)] || '';
}

function validProfession(value = '') {
  const normalized = normalizeCommand(value);
  return clean(value, 120).length >= 3 && !MARITAL_STATUS_MAP[normalized];
}

function getModels(mongoose) {
  const auditSchema = new mongoose.Schema({
    at: { type: Date, default: Date.now },
    action: { type: String, required: true },
    fromStep: { type: String, default: '' },
    toStep: { type: String, default: '' },
    eventHash: { type: String, default: '' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: null }
  }, { _id: false });

  const schema = new mongoose.Schema({
    conversationId: { type: String, required: true, unique: true, index: true },
    phone: { type: String, required: true, index: true },
    instanceName: { type: String, required: true, index: true },
    step: { type: String, default: CREDIARIO_FLOW_STEPS.INICIO, index: true },
    status: { type: String, enum: ['ATIVO','PAUSADO','CONCLUIDO','CANCELADO'], default: 'ATIVO', index: true },
    consent: { accepted: { type: Boolean, default: false }, acceptedAt: Date },
    data: {
      name: { type: String, default: '' }, cpf: { type: String, default: '' }, birthDate: { type: String, default: '' },
      maritalStatus: { type: String, default: '' }, profession: { type: String, default: '' }, phone: { type: String, default: '' },
      email: { type: String, default: '' }, reference1: { type: String, default: '' }, reference2: { type: String, default: '' }
    },
    documents: {
      identityFront: { type: mongoose.Schema.Types.Mixed, default: emptyDocument },
      identityBack: { type: mongoose.Schema.Types.Mixed, default: emptyDocument },
      selfie: { type: mongoose.Schema.Types.Mixed, default: emptyDocument },
      addressProof: { type: mongoose.Schema.Types.Mixed, default: emptyDocument },
      incomeProof: { type: mongoose.Schema.Types.Mixed, default: emptyDocument }
    },
    processedEventHashes: { type: [String], default: [] },
    lastInteractionAt: { type: Date, default: Date.now, index: true },
    expiresAt: { type: Date, default: null, index: true },
    audit: { type: [auditSchema], default: [] }
  }, { timestamps: true, versionKey: false, collection: 'crediario_conversations' });
  schema.index({ phone: 1, instanceName: 1 }, { unique: true });
  const modelName = 'CrediarioConversationV25';
  return mongoose.models[modelName] || mongoose.model(modelName, schema);
}

function promptFor(step, session = {}) {
  const name = session?.data?.name ? `, ${session.data.name.split(' ')[0]}` : '';
  const prompts = {
    [CREDIARIO_FLOW_STEPS.AGUARDANDO_CONSENTIMENTO]: CONSENT_TEXT,
    [CREDIARIO_FLOW_STEPS.AGUARDANDO_NOME]: 'Informe seu *nome completo*:',
    [CREDIARIO_FLOW_STEPS.AGUARDANDO_CPF]: 'Informe seu *CPF* (somente números ou no formato 000.000.000-00):',
    [CREDIARIO_FLOW_STEPS.AGUARDANDO_NASCIMENTO]: 'Informe sua *data de nascimento* no formato DD/MM/AAAA:',
    [CREDIARIO_FLOW_STEPS.AGUARDANDO_ESTADO_CIVIL]: 'Informe seu *estado civil*: SOLTEIRO, CASADO, DIVORCIADO, SEPARADO, VIÚVO ou UNIÃO ESTÁVEL.',
    [CREDIARIO_FLOW_STEPS.AGUARDANDO_PROFISSAO]: 'Informe sua *profissão ou ocupação atual*:',
    [CREDIARIO_FLOW_STEPS.AGUARDANDO_TELEFONE]: 'Informe um *telefone para contato*. Pode ser este mesmo número do WhatsApp:',
    [CREDIARIO_FLOW_STEPS.AGUARDANDO_EMAIL]: 'Informe seu *e-mail*:',
    [CREDIARIO_FLOW_STEPS.AGUARDANDO_DOCUMENTO_FRENTE]: `Agora envie uma foto nítida da *frente do RG ou CNH*${name}.`,
    [CREDIARIO_FLOW_STEPS.AGUARDANDO_DOCUMENTO_VERSO]: 'Envie uma foto nítida do *verso do RG ou CNH*.',
    [CREDIARIO_FLOW_STEPS.AGUARDANDO_SELFIE]: 'Envie uma *selfie segurando o documento ao lado do rosto*.',
    [CREDIARIO_FLOW_STEPS.AGUARDANDO_COMPROVANTE_ENDERECO]: 'Envie um *comprovante de endereço emitido há no máximo 90 dias*.',
    [CREDIARIO_FLOW_STEPS.AGUARDANDO_COMPROVANTE_RENDA]: 'Envie seu *comprovante de renda* mais recente.',
    [CREDIARIO_FLOW_STEPS.AGUARDANDO_REFERENCIA_1]: 'Informe a *primeira referência*: nome completo e telefone.',
    [CREDIARIO_FLOW_STEPS.AGUARDANDO_REFERENCIA_2]: 'Informe a *segunda referência*: nome completo e telefone.',
    [CREDIARIO_FLOW_STEPS.CONFERENCIA]: 'Recebemos os dados e documentos. Responda *CONFIRMAR* para enviar para análise ou *REINICIAR* para começar novamente.',
    [CREDIARIO_FLOW_STEPS.AGUARDANDO_ANALISE]: '✅ Seus documentos foram recebidos e enviados para análise. O prazo pode ser de até *24 horas*. O resultado será enviado por este WhatsApp.'
  };
  return prompts[step] || 'Digite *MENU* para consultar o andamento da sua solicitação.';
}

function checklist(session) {
  const d = session.data || {}; const docs = session.documents || {};
  return [
    ['Nome', Boolean(d.name)], ['CPF', Boolean(d.cpf)], ['Nascimento', Boolean(d.birthDate)], ['Estado civil', Boolean(d.maritalStatus)],
    ['Profissão', Boolean(d.profession)], ['Telefone', Boolean(d.phone)], ['E-mail', Boolean(d.email)], ['Documento frente', documentReceived(docs.identityFront)],
    ['Documento verso', documentReceived(docs.identityBack)], ['Selfie', documentReceived(docs.selfie)], ['Comprovante de endereço', documentReceived(docs.addressProof)],
    ['Comprovante de renda', documentReceived(docs.incomeProof)], ['Referência 1', Boolean(d.reference1)], ['Referência 2', Boolean(d.reference2)]
  ].map(([label, ok]) => `${ok ? '✅' : '⬜'} ${label}`).join('\n');
}

async function saveStep(session, nextStep, eventId, metadata = null) {
  const from = session.step;
  session.step = nextStep;
  session.lastInteractionAt = new Date();
  session.expiresAt = new Date(Date.now() + SESSION_TIMEOUT_HOURS * 3600000);
  if (eventId) session.processedEventHashes = [...(session.processedEventHashes || []), eventId].slice(-100);
  session.audit.push({ action: 'STEP_CHANGED', fromStep: from, toStep: nextStep, eventHash: eventId || '', metadata });
  await session.save();
}

export async function processCrediarioConversation({ mongoose, phone, instanceName = CREDIARIO_CANONICAL_INSTANCE, text = '', eventId = '', media = {} }) {
  const Model = getModels(mongoose);
  const normalizedPhone = normalizeBrazilPhone(phone);
  if (!normalizedPhone) throw new Error('Telefone de origem inválido.');
  const instance = normalizeCrediarioInstanceName(instanceName);
  const instanceAliases = crediarioInstanceAliases(instanceName);
  let processedMedia = media && typeof media === 'object' ? { ...media } : {};
  const mediaFingerprint = processedMedia.providerMessageId || processedMedia.storageKey || processedMedia.mediaUrl || processedMedia.url || processedMedia.hash || '';
  const safeEventId = eventHash(eventId || `${instance}:${normalizedPhone}:${text}:${mediaFingerprint}`);

  let session = await Model.findOne({
    phone: normalizedPhone,
    instanceName: { $in: instanceAliases }
  }).sort({ updatedAt: -1 });

  if (session && session.instanceName !== instance) {
    const duplicateCanonicalSession = await Model.findOne({
      phone: normalizedPhone,
      instanceName: instance,
      _id: { $ne: session._id }
    });

    if (!duplicateCanonicalSession) {
      const previousInstanceName = session.instanceName;
      session.instanceName = instance;
      session.audit.push({
        action: 'INSTANCE_NORMALIZED',
        fromStep: session.step,
        toStep: session.step,
        eventHash: safeEventId,
        metadata: { previousInstanceName, canonicalInstanceName: instance }
      });
      await session.save();
    }
  }
  if (!session) {
    session = await Model.create({
      conversationId: `credconv_${crypto.randomBytes(10).toString('hex')}`, phone: normalizedPhone, instanceName: instance,
      step: CREDIARIO_FLOW_STEPS.AGUARDANDO_CONSENTIMENTO,
      documents: emptyDocuments(),
      expiresAt: new Date(Date.now() + SESSION_TIMEOUT_HOURS * 3600000),
      audit: [{ action: 'CREATED', fromStep: '', toStep: CREDIARIO_FLOW_STEPS.AGUARDANDO_CONSENTIMENTO, eventHash: safeEventId }],
      processedEventHashes: [safeEventId]
    });
    return { duplicate: false, session, reply: `Olá! 👋 Você está falando com o *Crediário Ariana Móveis*.\n\n${CONSENT_TEXT}` };
  }

  if ((session.processedEventHashes || []).includes(safeEventId)) return { duplicate: true, session, reply: '' };

  const command = normalizeCommand(text);

  console.log('[crediario-conversation]', {
    phone: normalizedPhone,
    receivedInstanceName: clean(instanceName, 120),
    normalizedInstanceName: instance,
    conversationId: session.conversationId,
    step: session.step,
    command,
    eventId: safeEventId.slice(0, 12)
  });
  if (command === 'MENU' || command === 'STATUS') {
    session.processedEventHashes = [...session.processedEventHashes, safeEventId].slice(-100);
    session.lastInteractionAt = new Date(); await session.save();
    return { duplicate: false, session, reply: `📋 *Andamento da solicitação*\n\n${checklist(session)}\n\nEtapa atual: *${session.step}*\n\n${promptFor(session.step, session)}` };
  }
  if (command === 'REINICIAR') {
    const fromStep = session.step;
    session.step = CREDIARIO_FLOW_STEPS.AGUARDANDO_CONSENTIMENTO;
    session.status = 'ATIVO';
    session.consent = { accepted: false, acceptedAt: null };
    session.data = {
      name: '', cpf: '', birthDate: '', maritalStatus: '', profession: '',
      phone: '', email: '', reference1: '', reference2: ''
    };
    session.documents = emptyDocuments();
    session.markModified('data');
    session.markModified('documents');
    session.processedEventHashes = [safeEventId];
    session.lastInteractionAt = new Date();
    session.expiresAt = new Date(Date.now() + SESSION_TIMEOUT_HOURS * 3600000);
    session.audit.push({
      action: 'RESTARTED',
      fromStep,
      toStep: CREDIARIO_FLOW_STEPS.AGUARDANDO_CONSENTIMENTO,
      eventHash: safeEventId
    });
    await session.save();
    return { duplicate: false, session, reply: `🔄 Solicitação reiniciada.\n\n${CONSENT_TEXT}` };
  }

  const mediaReceived = isMedia(processedMedia);
  let next = session.step; let reply = '';

  switch (session.step) {
    case CREDIARIO_FLOW_STEPS.AGUARDANDO_CONSENTIMENTO:
      if (['ACEITO','ACEITAR','SIM','CONCORDO'].includes(command)) { session.consent = { accepted: true, acceptedAt: new Date() }; next = CREDIARIO_FLOW_STEPS.AGUARDANDO_NOME; reply = promptFor(next, session); }
      else if (['NAO ACEITO','NÃO ACEITO','NAO','NÃO','RECUSO'].includes(command)) { session.status = 'CANCELADO'; next = CREDIARIO_FLOW_STEPS.INICIO; reply = 'Tudo bem. A coleta foi encerrada e nenhum novo dado será solicitado. Para começar novamente, digite *REINICIAR*.'; }
      else reply = CONSENT_TEXT;
      break;
    case CREDIARIO_FLOW_STEPS.AGUARDANDO_NOME:
      if (!validName(text)) reply = 'Informe seu nome e sobrenome, por favor.'; else { session.data.name = clean(text, 150); next = CREDIARIO_FLOW_STEPS.AGUARDANDO_CPF; reply = promptFor(next, session); }
      break;
    case CREDIARIO_FLOW_STEPS.AGUARDANDO_CPF:
      if (!isValidCpf(text)) reply = 'Esse CPF não parece válido. Confira os 11 números e envie novamente.'; else { session.data.cpf = digits(text); next = CREDIARIO_FLOW_STEPS.AGUARDANDO_NASCIMENTO; reply = promptFor(next, session); }
      break;
    case CREDIARIO_FLOW_STEPS.AGUARDANDO_NASCIMENTO: {
      const date = normalizeDateBR(text); if (!date) reply = 'Use o formato DD/MM/AAAA e confira a data.'; else { session.data.birthDate = date; next = CREDIARIO_FLOW_STEPS.AGUARDANDO_ESTADO_CIVIL; reply = promptFor(next, session); } break;
    }
    case CREDIARIO_FLOW_STEPS.AGUARDANDO_ESTADO_CIVIL: {
      const maritalStatus = normalizeMaritalStatus(text);
      if (!maritalStatus) {
        reply = 'Estado civil inválido. Responda: *SOLTEIRO*, *CASADO*, *DIVORCIADO*, *SEPARADO*, *VIÚVO* ou *UNIÃO ESTÁVEL*.';
      } else {
        session.data.maritalStatus = maritalStatus;
        next = CREDIARIO_FLOW_STEPS.AGUARDANDO_PROFISSAO;
        reply = promptFor(next, session);
      }
      break;
    }
    case CREDIARIO_FLOW_STEPS.AGUARDANDO_PROFISSAO:
      if (!validProfession(text)) reply = 'Informe sua profissão ou ocupação atual, por exemplo: vendedor, motorista, empresário ou autônomo.'; else { session.data.profession = clean(text, 120); next = CREDIARIO_FLOW_STEPS.AGUARDANDO_TELEFONE; reply = promptFor(next, session); }
      break;
    case CREDIARIO_FLOW_STEPS.AGUARDANDO_TELEFONE:
      if (['ESTE NUMERO','ESSE NUMERO','MESMO NUMERO'].includes(command)) session.data.phone = normalizedPhone; else if (!validPhone(text)) { reply = 'Informe um telefone válido com DDD.'; break; } else session.data.phone = normalizeBrazilPhone(text);
      next = CREDIARIO_FLOW_STEPS.AGUARDANDO_EMAIL; reply = promptFor(next, session); break;
    case CREDIARIO_FLOW_STEPS.AGUARDANDO_EMAIL:
      if (!validEmail(text)) reply = 'Informe um e-mail válido, por exemplo: nome@email.com'; else { session.data.email = clean(text, 180).toLowerCase(); next = CREDIARIO_FLOW_STEPS.AGUARDANDO_DOCUMENTO_FRENTE; reply = promptFor(next, session); }
      break;
    case CREDIARIO_FLOW_STEPS.AGUARDANDO_DOCUMENTO_FRENTE:
    case CREDIARIO_FLOW_STEPS.AGUARDANDO_DOCUMENTO_VERSO:
    case CREDIARIO_FLOW_STEPS.AGUARDANDO_SELFIE:
    case CREDIARIO_FLOW_STEPS.AGUARDANDO_COMPROVANTE_ENDERECO:
    case CREDIARIO_FLOW_STEPS.AGUARDANDO_COMPROVANTE_RENDA: {
      if (!mediaReceived) { reply = `Nesta etapa precisamos de uma imagem ou arquivo.\n\n${promptFor(session.step, session)}`; break; }
      const map = {
        [CREDIARIO_FLOW_STEPS.AGUARDANDO_DOCUMENTO_FRENTE]: ['identityFront', CREDIARIO_FLOW_STEPS.AGUARDANDO_DOCUMENTO_VERSO],
        [CREDIARIO_FLOW_STEPS.AGUARDANDO_DOCUMENTO_VERSO]: ['identityBack', CREDIARIO_FLOW_STEPS.AGUARDANDO_SELFIE],
        [CREDIARIO_FLOW_STEPS.AGUARDANDO_SELFIE]: ['selfie', CREDIARIO_FLOW_STEPS.AGUARDANDO_COMPROVANTE_ENDERECO],
        [CREDIARIO_FLOW_STEPS.AGUARDANDO_COMPROVANTE_ENDERECO]: ['addressProof', CREDIARIO_FLOW_STEPS.AGUARDANDO_COMPROVANTE_RENDA],
        [CREDIARIO_FLOW_STEPS.AGUARDANDO_COMPROVANTE_RENDA]: ['incomeProof', CREDIARIO_FLOW_STEPS.AGUARDANDO_REFERENCIA_1]
      };
      const [field, nextStep] = map[session.step];

      if (!processedMedia.base64) {
        const mediaError = new Error(
          'A mídia não chegou descriptografada da Evolution API. O documento não será armazenado.'
        );
        mediaError.code = 'CREDIARIO_MEDIA_BASE64_REQUIRED';
        mediaError.status = 422;
        throw mediaError;
      }

      processedMedia = await persistCrediarioMedia({
        media: {
          ...processedMedia,
          mediaUrl: '',
          url: ''
        },
        phone: normalizedPhone,
        instanceName: instance,
        eventId: eventId || safeEventId,
        conversationId: session.conversationId,
        documentType: field
      });

      if (
        clean(processedMedia.storageProvider).toLowerCase() !== 'cloudinary' ||
        !clean(processedMedia.storageKey)
      ) {
        const storageError = new Error('O documento não foi confirmado no armazenamento seguro.');
        storageError.code = 'CREDIARIO_DOCUMENT_NOT_PERSISTED';
        storageError.status = 502;
        throw storageError;
      }

      session.documents[field] = documentRecordFromMedia(processedMedia);
      session.markModified(`documents.${field}`);
      session.markModified('documents');
      next = nextStep;
      reply = `✅ Arquivo recebido e armazenado com segurança.\n\n${promptFor(next, session)}`;
      break;
    }
    case CREDIARIO_FLOW_STEPS.AGUARDANDO_REFERENCIA_1:
      if (!validReference(text)) reply = 'Informe nome e telefone com DDD da primeira referência.'; else { session.data.reference1 = clean(text, 240); next = CREDIARIO_FLOW_STEPS.AGUARDANDO_REFERENCIA_2; reply = promptFor(next, session); }
      break;
    case CREDIARIO_FLOW_STEPS.AGUARDANDO_REFERENCIA_2:
      if (!validReference(text)) reply = 'Informe nome e telefone com DDD da segunda referência.'; else { session.data.reference2 = clean(text, 240); next = CREDIARIO_FLOW_STEPS.CONFERENCIA; reply = `📋 *Confira o andamento:*\n\n${checklist(session)}\n\n${promptFor(next, session)}`; }
      break;
    case CREDIARIO_FLOW_STEPS.CONFERENCIA:
      if (['CONFIRMAR','CONFIRMO','ENVIAR'].includes(command)) { next = CREDIARIO_FLOW_STEPS.AGUARDANDO_ANALISE; session.status = 'CONCLUIDO'; reply = promptFor(next, session); }
      else reply = promptFor(session.step, session);
      break;
    case CREDIARIO_FLOW_STEPS.AGUARDANDO_ANALISE:
      reply = promptFor(session.step, session); break;
    default:
      next = CREDIARIO_FLOW_STEPS.AGUARDANDO_CONSENTIMENTO; reply = CONSENT_TEXT;
  }

  await saveStep(session, next, safeEventId, {
    mediaReceived,
    ...(mediaReceived ? {
      mediaPersisted: clean(processedMedia.storageProvider).toLowerCase() === 'cloudinary' && Boolean(processedMedia.storageKey),
      storageProvider: clean(processedMedia.storageProvider, 80),
      storageKey: clean(processedMedia.storageKey, 500),
      providerMessageId: clean(processedMedia.providerMessageId, 300),
      hash: clean(processedMedia.hash, 180)
    } : {})
  });
  return { duplicate: false, session, reply, media: processedMedia };
}

export async function processAndReplyCrediario(input) {
  const result = await processCrediarioConversation(input);
  if (!result.duplicate && result.reply) {
    result.delivery = await sendCrediarioWhatsApp({ phone: input.phone, message: result.reply, metadata: { conversationId: result.session.conversationId, step: result.session.step } });
  }
  return result;
}

export function getCrediarioConversationModel(mongoose) { return getModels(mongoose); }

export { documentReceived, documentRecordFromMedia, emptyDocument, emptyDocuments, normalizeCrediarioInstanceName };
