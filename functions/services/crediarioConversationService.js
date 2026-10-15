import crypto from 'crypto';
import { normalizeBrazilPhone, sendCrediarioWhatsApp } from './crediarioWhatsAppService.js';
import { persistCrediarioMedia } from './crediarioMediaStorageService.js';
import {
  classifyCrediarioText,
  identifyCrediarioDocument,
  looksClearlyOffTopic,
  offTopicReply,
  validateCrediarioDocument
} from './crediarioAiValidationService.js';

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
const CREDIARIO_CANONICAL_INSTANCE = 'ariana_crediario';

const DOCUMENT_STEP_MAP = Object.freeze({
  [CREDIARIO_FLOW_STEPS.AGUARDANDO_DOCUMENTO_FRENTE]: ['identityFront', CREDIARIO_FLOW_STEPS.AGUARDANDO_DOCUMENTO_VERSO],
  [CREDIARIO_FLOW_STEPS.AGUARDANDO_DOCUMENTO_VERSO]: ['identityBack', CREDIARIO_FLOW_STEPS.AGUARDANDO_SELFIE],
  [CREDIARIO_FLOW_STEPS.AGUARDANDO_SELFIE]: ['selfie', CREDIARIO_FLOW_STEPS.AGUARDANDO_COMPROVANTE_ENDERECO],
  [CREDIARIO_FLOW_STEPS.AGUARDANDO_COMPROVANTE_ENDERECO]: ['addressProof', CREDIARIO_FLOW_STEPS.AGUARDANDO_COMPROVANTE_RENDA],
  [CREDIARIO_FLOW_STEPS.AGUARDANDO_COMPROVANTE_RENDA]: ['incomeProof', CREDIARIO_FLOW_STEPS.AGUARDANDO_REFERENCIA_1]
});

const FIELD_LABELS = Object.freeze({
  identityFront: 'frente do RG/CNH',
  identityBack: 'verso do RG/CNH',
  selfie: 'selfie com o documento',
  addressProof: 'comprovante de endereço',
  incomeProof: 'comprovante de renda'
});

function clean(value = '', max = 600) { return String(value ?? '').trim().slice(0, max); }
function digits(value = '') { return clean(value).replace(/\D/g, ''); }
function normalizeCommand(value = '') { return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase(); }
function eventHash(value = '') { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function isMedia(input = {}) {
  return Boolean(
    input.mediaType || input.mediaUrl || input.url || input.mimetype || input.mimeType ||
    input.fileName || input.storageKey || input.base64
  );
}

function normalizeCrediarioInstanceName(value = '') {
  const raw = clean(value, 120);
  if (!raw) return CREDIARIO_CANONICAL_INSTANCE;
  const comparable = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  return comparable === 'ariana crediario' ? CREDIARIO_CANONICAL_INSTANCE : raw;
}

function crediarioInstanceAliases(value = '') {
  const canonical = normalizeCrediarioInstanceName(value);
  if (canonical === CREDIARIO_CANONICAL_INSTANCE) {
    return [CREDIARIO_CANONICAL_INSTANCE, 'Ariana_crediario', 'Ariana crediario', 'ariana crediario'];
  }
  return [canonical];
}

function emptyDocument() {
  return {
    received: false,
    url: '', mediaUrl: '', storageProvider: '', storageKey: '', storageType: '', resourceType: '', assetId: '', version: 0,
    fileName: '', mimeType: '', mimetype: '', size: 0, fileSize: 0, hash: '', providerMessageId: '',
    receivedAt: null, persistedAt: null, private: false,
    reviewStatus: 'PENDENTE', reviewNote: '', reviewedBy: '', reviewedAt: null,
    review: { status: 'PENDENTE', note: '', reviewedBy: '', reviewedAt: null },
    aiValidation: null
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

function documentRecordFromMedia(media = {}, validation = {}) {
  const receivedAt = media.receivedAt ? new Date(media.receivedAt) : new Date();
  const persistedAt = media.persistedAt ? new Date(media.persistedAt) : null;
  const size = Math.max(0, Number(media.size || media.fileSize || 0));
  const prevalidated = validation?.source === 'ai' && validation?.ok === true;
  const reviewNote = clean(validation?.reason || '', 500);
  const aiValidation = validation && typeof validation === 'object' ? {
    source: clean(validation.source, 80),
    ok: validation.ok === true,
    matches: validation.matches === true,
    readable: validation.readable === true,
    confidence: Number(validation.confidence || 0),
    reviewRequired: validation.reviewRequired === true,
    reason: reviewNote
  } : null;

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
    reviewStatus: prevalidated ? 'PRE_VALIDADO_IA' : 'PENDENTE',
    reviewNote,
    reviewedBy: '',
    reviewedAt: null,
    review: { status: prevalidated ? 'PRE_VALIDADO_IA' : 'PENDENTE', note: reviewNote, reviewedBy: '', reviewedAt: null },
    aiValidation
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
  SOLTEIRO: 'SOLTEIRO', SOLTEIRA: 'SOLTEIRO', CASADO: 'CASADO', CASADA: 'CASADO',
  DIVORCIADO: 'DIVORCIADO', DIVORCIADA: 'DIVORCIADO', SEPARADO: 'SEPARADO', SEPARADA: 'SEPARADO',
  VIUVO: 'VIÚVO', VIUVA: 'VIÚVO', 'UNIAO ESTAVEL': 'UNIÃO ESTÁVEL'
});
function normalizeMaritalStatus(value = '') { return MARITAL_STATUS_MAP[normalizeCommand(value)] || ''; }
function validProfession(value = '') { const normalized = normalizeCommand(value); return clean(value, 120).length >= 3 && !MARITAL_STATUS_MAP[normalized]; }

function getModels(mongoose) {
  const auditSchema = new mongoose.Schema({
    at: { type: Date, default: Date.now }, action: { type: String, required: true },
    fromStep: { type: String, default: '' }, toStep: { type: String, default: '' },
    eventHash: { type: String, default: '' }, metadata: { type: mongoose.Schema.Types.Mixed, default: null }
  }, { _id: false });

  const schema = new mongoose.Schema({
    conversationId: { type: String, required: true, unique: true, index: true },
    phone: { type: String, required: true, index: true }, instanceName: { type: String, required: true, index: true },
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
    lastInteractionAt: { type: Date, default: Date.now, index: true }, expiresAt: { type: Date, default: null, index: true },
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
    [CREDIARIO_FLOW_STEPS.AGUARDANDO_SELFIE]: 'Envie uma *selfie com seu rosto visível, segurando o RG ou CNH ao lado do rosto*. O rosto e o documento precisam aparecer completos e nítidos.',
    [CREDIARIO_FLOW_STEPS.AGUARDANDO_COMPROVANTE_ENDERECO]: 'Envie um *comprovante de endereço emitido há no máximo 90 dias*, com nome, endereço e data legíveis.',
    [CREDIARIO_FLOW_STEPS.AGUARDANDO_COMPROVANTE_RENDA]: 'Envie seu *comprovante de renda mais recente*, completo e legível.',
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

function looksGenericGreeting(text = '') {
  let value = normalizeCommand(text).replace(/[!?.,;:]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!value || value.length > 100) return false;

  // Corrige erros simples e abreviações comuns sem transformar respostas cadastrais em saudação.
  value = value
    .replace(/\b(TUDP|TDO|TD)\b/g, 'TUDO')
    .replace(/\b(NOITR|NOIT)\b/g, 'NOITE')
    .replace(/\b(TARD|TARDEEE)\b/g, 'TARDE')
    .replace(/\b(BOMM|BOOM)\b/g, 'BOM')
    .replace(/\b(BOAA|BOAAA)\b/g, 'BOA')
    .replace(/\b(OII+|OIE|OPA)\b/g, 'OI')
    .replace(/\b(E AI|EAI)\b/g, 'OI')
    .replace(/\s+/g, ' ')
    .trim();

  const withoutGreetings = value
    .replace(/\b(OI|OLA|BOM DIA|BOA TARDE|BOA NOITE|TUDO BEM|TUDO BOM|TUDO|COMO VAI|COMO VOCE ESTA|COMO ESTA|BELEZA|BLZ)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return withoutGreetings === '';
}

function officialGreeting() {
  return 'Olá, você está falando com o *Crediário da Ariana Móveis*. Para outros assuntos, entre em contato pelo número *31 98514-7119*.';
}

function plausibleReplyForStep(step, text = '', normalizedPhone = '') {
  const command = normalizeCommand(text);
  switch (step) {
    case CREDIARIO_FLOW_STEPS.AGUARDANDO_CONSENTIMENTO: return ['ACEITO','ACEITAR','SIM','CONCORDO','NAO ACEITO','NÃO ACEITO','NAO','NÃO','RECUSO'].includes(command);
    case CREDIARIO_FLOW_STEPS.AGUARDANDO_NOME: return validName(text);
    case CREDIARIO_FLOW_STEPS.AGUARDANDO_CPF: return isValidCpf(text);
    case CREDIARIO_FLOW_STEPS.AGUARDANDO_NASCIMENTO: return Boolean(normalizeDateBR(text));
    case CREDIARIO_FLOW_STEPS.AGUARDANDO_ESTADO_CIVIL: return Boolean(normalizeMaritalStatus(text));
    case CREDIARIO_FLOW_STEPS.AGUARDANDO_PROFISSAO: return validProfession(text);
    case CREDIARIO_FLOW_STEPS.AGUARDANDO_TELEFONE: return validPhone(text) || ['ESTE NUMERO','ESSE NUMERO','MESMO NUMERO'].includes(command) || Boolean(normalizedPhone && command === 'ESTE');
    case CREDIARIO_FLOW_STEPS.AGUARDANDO_EMAIL: return validEmail(text);
    case CREDIARIO_FLOW_STEPS.AGUARDANDO_REFERENCIA_1:
    case CREDIARIO_FLOW_STEPS.AGUARDANDO_REFERENCIA_2: return validReference(text);
    case CREDIARIO_FLOW_STEPS.CONFERENCIA: return ['CONFIRMAR','CONFIRMO','ENVIAR','REINICIAR'].includes(command);
    default: return true;
  }
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

async function persistDocument({ processedMedia, normalizedPhone, instance, eventId, safeEventId, session, field, validation = {} }) {
  const stored = await persistCrediarioMedia({
    media: { ...processedMedia, mediaUrl: '', url: '' },
    phone: normalizedPhone,
    instanceName: instance,
    eventId: eventId || safeEventId,
    conversationId: session.conversationId,
    documentType: field
  });
  if (clean(stored.storageProvider).toLowerCase() !== 'cloudinary' || !clean(stored.storageKey)) {
    const storageError = new Error('O documento não foi confirmado no armazenamento seguro.');
    storageError.code = 'CREDIARIO_DOCUMENT_NOT_PERSISTED';
    storageError.status = 502;
    throw storageError;
  }
  session.documents[field] = documentRecordFromMedia(stored, validation);
  session.markModified(`documents.${field}`);
  session.markModified('documents');
  return stored;
}

export async function processCrediarioConversation({ mongoose, phone, instanceName = CREDIARIO_CANONICAL_INSTANCE, text = '', eventId = '', media = {} }) {
  const Model = getModels(mongoose);
  const normalizedPhone = normalizeBrazilPhone(phone);
  if (!normalizedPhone) throw new Error('Telefone de origem inválido.');
  const instance = normalizeCrediarioInstanceName(instanceName);
  const instanceAliases = crediarioInstanceAliases(instanceName);
  let processedMedia = media && typeof media === 'object' ? { ...media } : {};
  const mediaReceived = isMedia(processedMedia);
  const mediaFingerprint = processedMedia.providerMessageId || processedMedia.storageKey || processedMedia.mediaUrl || processedMedia.url || processedMedia.hash || '';
  const safeEventId = eventHash(eventId || `${instance}:${normalizedPhone}:${text}:${mediaFingerprint}`);
  const command = normalizeCommand(text);

  let session = await Model.findOne({ phone: normalizedPhone, instanceName: { $in: instanceAliases } }).sort({ updatedAt: -1 });

  if (!session && !mediaReceived && looksClearlyOffTopic(text)) {
    return { duplicate: false, session: null, reply: offTopicReply(), offTopic: true };
  }

  if (session && session.instanceName !== instance) {
    const duplicateCanonicalSession = await Model.findOne({ phone: normalizedPhone, instanceName: instance, _id: { $ne: session._id } });
    if (!duplicateCanonicalSession) {
      const previousInstanceName = session.instanceName;
      session.instanceName = instance;
      session.audit.push({ action: 'INSTANCE_NORMALIZED', fromStep: session.step, toStep: session.step, eventHash: safeEventId, metadata: { previousInstanceName, canonicalInstanceName: instance } });
      await session.save();
    }
  }

  if (!session) {
    session = await Model.create({
      conversationId: `credconv_${crypto.randomBytes(10).toString('hex')}`,
      phone: normalizedPhone, instanceName: instance,
      step: CREDIARIO_FLOW_STEPS.AGUARDANDO_CONSENTIMENTO,
      documents: emptyDocuments(),
      expiresAt: new Date(Date.now() + SESSION_TIMEOUT_HOURS * 3600000),
      audit: [{ action: 'CREATED', fromStep: '', toStep: CREDIARIO_FLOW_STEPS.AGUARDANDO_CONSENTIMENTO, eventHash: safeEventId }],
      processedEventHashes: [safeEventId]
    });
    if (mediaReceived) {
      return { duplicate: false, session, reply: `${officialGreeting()}\n\nAntes de receber documentos, preciso iniciar sua solicitação.\n\n${CONSENT_TEXT}` };
    }
    return { duplicate: false, session, reply: `${officialGreeting()}\n\n${CONSENT_TEXT}` };
  }

  if ((session.processedEventHashes || []).includes(safeEventId)) return { duplicate: true, session, reply: '' };

  console.log('[crediario-conversation]', {
    phone: normalizedPhone,
    receivedInstanceName: clean(instanceName, 120), normalizedInstanceName: instance,
    conversationId: session.conversationId, step: session.step, command, mediaReceived,
    eventId: safeEventId.slice(0, 12)
  });

  if (command === 'MENU' || command === 'STATUS') {
    session.processedEventHashes = [...session.processedEventHashes, safeEventId].slice(-100);
    session.lastInteractionAt = new Date(); await session.save();
    return { duplicate: false, session, reply: `📋 *Andamento da solicitação*\n\n${checklist(session)}\n\nEtapa atual: *${session.step}*\n\n${promptFor(session.step, session)}` };
  }

  if (['VOLTAR','RETORNAR','CONTINUAR'].includes(command)) {
    session.processedEventHashes = [...session.processedEventHashes, safeEventId].slice(-100);
    session.lastInteractionAt = new Date(); await session.save();
    return { duplicate: false, session, reply: promptFor(session.step, session) };
  }

  if (command === 'REINICIAR') {
    const fromStep = session.step;
    session.step = CREDIARIO_FLOW_STEPS.AGUARDANDO_CONSENTIMENTO;
    session.status = 'ATIVO';
    session.consent = { accepted: false, acceptedAt: null };
    session.data = { name: '', cpf: '', birthDate: '', maritalStatus: '', profession: '', phone: '', email: '', reference1: '', reference2: '' };
    session.documents = emptyDocuments();
    session.markModified('data'); session.markModified('documents');
    session.processedEventHashes = [safeEventId];
    session.lastInteractionAt = new Date();
    session.expiresAt = new Date(Date.now() + SESSION_TIMEOUT_HOURS * 3600000);
    session.audit.push({ action: 'RESTARTED', fromStep, toStep: CREDIARIO_FLOW_STEPS.AGUARDANDO_CONSENTIMENTO, eventHash: safeEventId });
    await session.save();
    return { duplicate: false, session, reply: `🔄 Solicitação reiniciada.\n\n${CONSENT_TEXT}` };
  }

  if (mediaReceived && !DOCUMENT_STEP_MAP[session.step]) {
    if (!processedMedia.base64) {
      await saveStep(session, session.step, safeEventId, { mediaReceived: true, mediaRejected: 'base64_missing' });
      return { duplicate: false, session, reply: `Recebi um arquivo, mas não consegui abri-lo com segurança. Envie novamente como foto ou PDF.\n\n${promptFor(session.step, session)}` };
    }

    const identified = await identifyCrediarioDocument(processedMedia);
    if (identified.ok && identified.field) {
      processedMedia = await persistDocument({ processedMedia, normalizedPhone, instance, eventId, safeEventId, session, field: identified.field, validation: { ...identified, ok: true } });
      await saveStep(session, session.step, safeEventId, { mediaReceived: true, mediaOutOfOrder: true, identifiedKind: identified.kind, identifiedField: identified.field, aiConfidence: identified.confidence });
      return {
        duplicate: false,
        session,
        reply: `✅ Recebi e guardei seu *${FIELD_LABELS[identified.field] || 'documento'}* com segurança. Ele chegou antes da etapa prevista, mas não será perdido.\n\nAgora vamos continuar de onde paramos:\n${promptFor(session.step, session)}`,
        media: processedMedia
      };
    }

    await saveStep(session, session.step, safeEventId, { mediaReceived: true, mediaOutOfOrder: true, aiIdentified: false, reason: clean(identified.reason, 300) });
    return {
      duplicate: false,
      session,
      reply: `Recebi a imagem, mas ainda não consegui associá-la com segurança a um documento do crediário. Não vou avançar a etapa para evitar cadastro errado.\n\n${promptFor(session.step, session)}`
    };
  }

  if (!mediaReceived && text && !plausibleReplyForStep(session.step, text, normalizedPhone)) {
    if (looksGenericGreeting(text)) {
      session.processedEventHashes = [...session.processedEventHashes, safeEventId].slice(-100);
      session.lastInteractionAt = new Date();
      session.audit.push({ action: 'GREETING_ACKNOWLEDGED', fromStep: session.step, toStep: session.step, eventHash: safeEventId, metadata: { source: 'greeting_rule' } });
      await session.save();
      return {
        duplicate: false,
        session,
        reply: `${officialGreeting()}\n\n${promptFor(session.step, session)}`
      };
    }

    const classification = await classifyCrediarioText(text);
    if (classification.related === false && Number(classification.confidence || 0) >= 0.55) {
      session.processedEventHashes = [...session.processedEventHashes, safeEventId].slice(-100);
      session.lastInteractionAt = new Date();
      session.audit.push({ action: 'OFF_TOPIC_REDIRECTED', fromStep: session.step, toStep: session.step, eventHash: safeEventId, metadata: { source: classification.source, confidence: classification.confidence } });
      await session.save();
      return { duplicate: false, session, reply: offTopicReply(), offTopic: true };
    }
  }

  let next = session.step;
  let reply = '';
  let validationMetadata = null;

  switch (session.step) {
    case CREDIARIO_FLOW_STEPS.AGUARDANDO_CONSENTIMENTO:
      if (['ACEITO','ACEITAR','SIM','CONCORDO'].includes(command)) {
        session.consent = { accepted: true, acceptedAt: new Date() };
        next = CREDIARIO_FLOW_STEPS.AGUARDANDO_NOME; reply = promptFor(next, session);
      } else if (['NAO ACEITO','NÃO ACEITO','NAO','NÃO','RECUSO'].includes(command)) {
        session.status = 'CANCELADO'; next = CREDIARIO_FLOW_STEPS.INICIO;
        reply = 'Tudo bem. A coleta foi encerrada e nenhum novo dado será solicitado. Para começar novamente, digite *REINICIAR*.';
      } else reply = CONSENT_TEXT;
      break;

    case CREDIARIO_FLOW_STEPS.AGUARDANDO_NOME:
      if (!validName(text)) reply = 'Informe seu nome e sobrenome, por favor.';
      else { session.data.name = clean(text, 150); next = CREDIARIO_FLOW_STEPS.AGUARDANDO_CPF; reply = promptFor(next, session); }
      break;

    case CREDIARIO_FLOW_STEPS.AGUARDANDO_CPF:
      if (!isValidCpf(text)) reply = 'Esse CPF não parece válido. Confira os 11 números e envie novamente.';
      else { session.data.cpf = digits(text); next = CREDIARIO_FLOW_STEPS.AGUARDANDO_NASCIMENTO; reply = promptFor(next, session); }
      break;

    case CREDIARIO_FLOW_STEPS.AGUARDANDO_NASCIMENTO: {
      const date = normalizeDateBR(text);
      if (!date) reply = 'Ainda preciso da sua *data de nascimento*. Envie no formato *DD/MM/AAAA*.';
      else { session.data.birthDate = date; next = CREDIARIO_FLOW_STEPS.AGUARDANDO_ESTADO_CIVIL; reply = promptFor(next, session); }
      break;
    }

    case CREDIARIO_FLOW_STEPS.AGUARDANDO_ESTADO_CIVIL: {
      const maritalStatus = normalizeMaritalStatus(text);
      if (!maritalStatus) reply = 'Estado civil inválido. Responda: *SOLTEIRO*, *CASADO*, *DIVORCIADO*, *SEPARADO*, *VIÚVO* ou *UNIÃO ESTÁVEL*.';
      else { session.data.maritalStatus = maritalStatus; next = CREDIARIO_FLOW_STEPS.AGUARDANDO_PROFISSAO; reply = promptFor(next, session); }
      break;
    }

    case CREDIARIO_FLOW_STEPS.AGUARDANDO_PROFISSAO:
      if (!validProfession(text)) reply = 'Informe sua profissão ou ocupação atual, por exemplo: vendedor, motorista, empresário ou autônomo.';
      else { session.data.profession = clean(text, 120); next = CREDIARIO_FLOW_STEPS.AGUARDANDO_TELEFONE; reply = promptFor(next, session); }
      break;

    case CREDIARIO_FLOW_STEPS.AGUARDANDO_TELEFONE:
      if (['ESTE NUMERO','ESSE NUMERO','MESMO NUMERO'].includes(command)) session.data.phone = normalizedPhone;
      else if (!validPhone(text)) { reply = 'Informe um telefone válido com DDD.'; break; }
      else session.data.phone = normalizeBrazilPhone(text);
      next = CREDIARIO_FLOW_STEPS.AGUARDANDO_EMAIL; reply = promptFor(next, session);
      break;

    case CREDIARIO_FLOW_STEPS.AGUARDANDO_EMAIL:
      if (!validEmail(text)) reply = 'Informe um e-mail válido, por exemplo: nome@email.com';
      else { session.data.email = clean(text, 180).toLowerCase(); next = CREDIARIO_FLOW_STEPS.AGUARDANDO_DOCUMENTO_FRENTE; reply = promptFor(next, session); }
      break;

    case CREDIARIO_FLOW_STEPS.AGUARDANDO_DOCUMENTO_FRENTE:
    case CREDIARIO_FLOW_STEPS.AGUARDANDO_DOCUMENTO_VERSO:
    case CREDIARIO_FLOW_STEPS.AGUARDANDO_SELFIE:
    case CREDIARIO_FLOW_STEPS.AGUARDANDO_COMPROVANTE_ENDERECO:
    case CREDIARIO_FLOW_STEPS.AGUARDANDO_COMPROVANTE_RENDA: {
      if (!mediaReceived) {
        reply = `Nesta etapa precisamos de uma imagem ou arquivo.\n\n${promptFor(session.step, session)}`;
        break;
      }
      const [field, nextStep] = DOCUMENT_STEP_MAP[session.step];
      if (!processedMedia.base64) {
        reply = `Não consegui abrir o arquivo recebido. Envie novamente como foto ou PDF.\n\n${promptFor(session.step, session)}`;
        validationMetadata = { ok: false, source: 'missing_base64' };
        break;
      }

      const validation = await validateCrediarioDocument({ step: session.step, media: processedMedia });
      validationMetadata = validation;
      if (!validation.ok) {
        reply = validation.reply || `A imagem não corresponde ao documento solicitado ou não está legível.\n\n${promptFor(session.step, session)}`;
        break;
      }

      processedMedia = await persistDocument({ processedMedia, normalizedPhone, instance, eventId, safeEventId, session, field, validation });
      next = nextStep;
      reply = validation.reviewRequired
        ? `✅ Arquivo recebido e armazenado com segurança para conferência.\n\n${promptFor(next, session)}`
        : `✅ Arquivo conferido e armazenado com segurança.\n\n${promptFor(next, session)}`;
      break;
    }

    case CREDIARIO_FLOW_STEPS.AGUARDANDO_REFERENCIA_1:
      if (!validReference(text)) reply = 'Informe nome e telefone com DDD da primeira referência.';
      else { session.data.reference1 = clean(text, 240); next = CREDIARIO_FLOW_STEPS.AGUARDANDO_REFERENCIA_2; reply = promptFor(next, session); }
      break;

    case CREDIARIO_FLOW_STEPS.AGUARDANDO_REFERENCIA_2:
      if (!validReference(text)) reply = 'Informe nome e telefone com DDD da segunda referência.';
      else { session.data.reference2 = clean(text, 240); next = CREDIARIO_FLOW_STEPS.CONFERENCIA; reply = `📋 *Confira o andamento:*\n\n${checklist(session)}\n\n${promptFor(next, session)}`; }
      break;

    case CREDIARIO_FLOW_STEPS.CONFERENCIA:
      if (['CONFIRMAR','CONFIRMO','ENVIAR'].includes(command)) {
        next = CREDIARIO_FLOW_STEPS.AGUARDANDO_ANALISE; session.status = 'CONCLUIDO'; reply = promptFor(next, session);
      } else reply = promptFor(session.step, session);
      break;

    case CREDIARIO_FLOW_STEPS.AGUARDANDO_ANALISE:
      reply = promptFor(session.step, session);
      break;

    default:
      next = CREDIARIO_FLOW_STEPS.AGUARDANDO_CONSENTIMENTO; reply = CONSENT_TEXT;
  }

  await saveStep(session, next, safeEventId, {
    mediaReceived,
    aiValidation: validationMetadata ? {
      source: clean(validationMetadata.source, 80), ok: validationMetadata.ok === true,
      confidence: Number(validationMetadata.confidence || 0), reason: clean(validationMetadata.reason, 300)
    } : null,
    ...(mediaReceived ? {
      mediaPersisted: clean(processedMedia.storageProvider).toLowerCase() === 'cloudinary' && Boolean(processedMedia.storageKey),
      storageProvider: clean(processedMedia.storageProvider, 80), storageKey: clean(processedMedia.storageKey, 500),
      providerMessageId: clean(processedMedia.providerMessageId, 300), hash: clean(processedMedia.hash, 180)
    } : {})
  });
  return { duplicate: false, session, reply, media: processedMedia };
}

export async function processAndReplyCrediario(input) {
  const result = await processCrediarioConversation(input);
  if (!result.duplicate && result.reply) {
    result.delivery = await sendCrediarioWhatsApp({
      phone: input.phone,
      message: result.reply,
      metadata: {
        conversationId: result.session?.conversationId || '',
        step: result.session?.step || '',
        offTopic: result.offTopic === true
      }
    });
  }
  return result;
}

export function getCrediarioConversationModel(mongoose) { return getModels(mongoose); }

export { documentReceived, documentRecordFromMedia, emptyDocument, emptyDocuments, normalizeCrediarioInstanceName };
