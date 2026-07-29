import crypto from 'crypto';
import { calculateArianaScore, suggestCreditDecision } from '../services/crediarioScoreEngine.js';
import { getCrediarioWhatsAppConfig, sendCrediarioWhatsApp } from '../services/crediarioWhatsAppService.js';

const ANALYSIS_STATUSES = [
  'PENDENTE_ANALISE',
  'EM_ANALISE',
  'AGUARDANDO_DOCUMENTOS',
  'APROVADO',
  'REPROVADO',
  'AGUARDANDO_ASSINATURA',
  'ASSINADO',
  'CANCELADO'
];

function digits(value = '') { return String(value || '').replace(/\D/g, ''); }
function text(value = '', max = 500) { return String(value || '').trim().slice(0, max); }
function cents(value = 0) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}
function publicId(prefix = 'cred') { return `${prefix}_${crypto.randomBytes(8).toString('hex')}`; }
function sha256(value = '') { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function safeUrl(value = '') { try { const u = new URL(String(value)); return ['http:', 'https:'].includes(u.protocol) ? u.toString() : ''; } catch { return ''; } }
function asObject(doc) { return typeof doc?.toObject === 'function' ? doc.toObject({ virtuals: true }) : doc; }

function envBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1','true','yes','on','sim'].includes(String(value).trim().toLowerCase());
}
function dateOnly(value) {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}
function dayDiff(from, to) {
  const a = new Date(`${dateOnly(from)}T12:00:00.000Z`);
  const b = new Date(`${dateOnly(to)}T12:00:00.000Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}
function updatedInstallmentAmount(originalCents, daysLate) {
  const original = Math.max(0, cents(originalCents));
  if (daysLate <= 0) return { originalCents: original, fineCents: 0, interestCents: 0, updatedCents: original };
  const fineCents = Math.round(original * 0.02);
  const interestCents = Math.round(original * 0.01 * (daysLate / 30));
  return { originalCents: original, fineCents, interestCents, updatedCents: original + fineCents + interestCents };
}
function moneyBR(valueCents) {
  return (Math.max(0, Number(valueCents || 0)) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function escapeRegex(value = '') { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function getModels(mongoose) {
  const historySchema = new mongoose.Schema({
    at: { type: Date, default: Date.now },
    action: { type: String, required: true },
    fromStatus: { type: String, default: '' },
    toStatus: { type: String, default: '' },
    actorId: { type: String, default: '' },
    actorName: { type: String, default: '' },
    note: { type: String, default: '' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: null }
  }, { _id: false });

  const analysisSchema = new mongoose.Schema({
    analysisId: { type: String, unique: true, index: true },
    orderId: { type: String, default: '', index: true },
    origin: { type: String, enum: ['SITE','LOJA_FISICA','WHATSAPP'], default: 'SITE', index: true },
    conversationId: { type: String, default: '', index: true },
    documentCollectionStatus: { type: String, default: 'NAO_INICIADA', index: true },
    purchase: { type: mongoose.Schema.Types.Mixed, default: null },
    customerId: { type: String, default: '', index: true },
    customer: {
      name: { type: String, default: '' },
      document: { type: String, default: '', index: true },
      email: { type: String, default: '' },
      phone: { type: String, default: '' }
    },
    status: { type: String, enum: ANALYSIS_STATUSES, default: 'PENDENTE_ANALISE', index: true },
    baseAmountCents: { type: Number, required: true },
    financedAmountCents: { type: Number, default: 0 },
    installmentCount: { type: Number, default: 0 },
    installmentDivisor: { type: Number, default: 0 },
    firstDueDate: { type: String, default: '' },
    installmentPlan: { type: [mongoose.Schema.Types.Mixed], default: [] },
    requestedDocuments: { type: [String], default: [] },
    checklist: {
      cpfChecked: { type: Boolean, default: false },
      identityDocument: { type: Boolean, default: false },
      residenceProof: { type: Boolean, default: false },
      incomeChecked: { type: Boolean, default: false },
      contactConfirmed: { type: Boolean, default: false },
      referenceConfirmed: { type: Boolean, default: false }
    },
    suggestion: {
      decision: { type: String, default: 'ANALISAR' },
      reasons: { type: [String], default: [] },
      calculatedAt: { type: Date, default: null }
    },
    internalNote: { type: String, default: '' },
    decisionNote: { type: String, default: '' },
    approvedLimitCents: { type: Number, default: 0 },
    decidedAt: { type: Date, default: null },
    decidedBy: { type: String, default: '' },
    signature: {
      status: { type: String, enum: ['NOT_REQUESTED','PENDING','SIGNED','EXPIRED','CANCELLED'], default: 'NOT_REQUESTED' },
      provider: { type: String, default: 'ariana_internal' },
      envelopeId: { type: String, default: '' },
      tokenHash: { type: String, default: '', select: false },
      signingUrl: { type: String, default: '' },
      expiresAt: { type: Date, default: null },
      requestedAt: { type: Date, default: null },
      requestedBy: { type: String, default: '' },
      documents: { type: [mongoose.Schema.Types.Mixed], default: [] },
      signerName: { type: String, default: '' },
      signerDocument: { type: String, default: '' },
      acceptedTerms: { type: Boolean, default: false },
      signedAt: { type: Date, default: null },
      ipHash: { type: String, default: '' },
      userAgentHash: { type: String, default: '' },
      evidenceId: { type: String, default: '' }
    },
    history: { type: [historySchema], default: [] }
  }, { timestamps: true, strict: false });

  const profileSchema = new mongoose.Schema({
    customerId: { type: String, default: '', index: true },
    document: { type: String, default: '', unique: true, sparse: true, index: true },
    customerName: { type: String, default: '' },
    birthDate: { type: String, default: '' },
    rg: { type: String, default: '' },
    maritalStatus: { type: String, default: '' },
    profession: { type: String, default: '' },
    employer: { type: String, default: '' },
    monthlyIncomeCents: { type: Number, default: 0 },
    employmentMonths: { type: Number, default: 0 },
    customerSinceMonths: { type: Number, default: 0 },
    phone: { type: String, default: '' },
    whatsapp: { type: String, default: '' },
    email: { type: String, default: '' },
    address: { type: mongoose.Schema.Types.Mixed, default: null },
    creditLimitCents: { type: Number, default: 0 },
    usedLimitCents: { type: Number, default: 0 },
    internalScore: { type: Number, default: 500, min: 0, max: 1000 },
    riskLevel: { type: String, default: 'MEDIO' },
    purchasesCount: { type: Number, default: 0 },
    approvedCount: { type: Number, default: 0 },
    rejectedCount: { type: Number, default: 0 },
    settledPurchasesCount: { type: Number, default: 0 },
    openPurchasesCount: { type: Number, default: 0 },
    latePurchasesCount: { type: Number, default: 0 },
    installmentsPaidOnTime: { type: Number, default: 0 },
    installmentsPaidLate: { type: Number, default: 0 },
    openOverdueInstallments: { type: Number, default: 0 },
    averageDaysLate: { type: Number, default: 0 },
    maximumDaysLate: { type: Number, default: 0 },
    renegotiationsCount: { type: Number, default: 0 },
    cancelledPurchasesCount: { type: Number, default: 0 },
    returnedPurchasesCount: { type: Number, default: 0 },
    totalFinancedCents: { type: Number, default: 0 },
    totalReceivedCents: { type: Number, default: 0 },
    lastPurchaseAt: { type: Date, default: null },
    lastPaymentAt: { type: Date, default: null },
    notes: { type: String, default: '' },
    profileStatus: { type: String, enum: ['ATIVO','EM_REVISAO','BLOQUEADO'], default: 'ATIVO', index: true },
    blockedReason: { type: String, default: '' },
    references: { type: [mongoose.Schema.Types.Mixed], default: [] },
    auditHistory: { type: [historySchema], default: [] }
  }, { timestamps: true, strict: false });


  const collectionLogSchema = new mongoose.Schema({
    logId: { type: String, unique: true, index: true },
    analysisId: { type: String, default: '', index: true },
    orderId: { type: String, default: '', index: true },
    customerId: { type: String, default: '', index: true },
    customerName: { type: String, default: '' },
    customerDocument: { type: String, default: '', index: true },
    phone: { type: String, default: '' },
    installmentNumber: { type: Number, default: 0 },
    dueDate: { type: String, default: '', index: true },
    daysRelative: { type: Number, default: 0 },
    ruleKey: { type: String, default: '', index: true },
    message: { type: String, default: '' },
    originalCents: { type: Number, default: 0 },
    fineCents: { type: Number, default: 0 },
    interestCents: { type: Number, default: 0 },
    updatedCents: { type: Number, default: 0 },
    status: { type: String, enum: ['SIMULATED','SENT','SKIPPED','ERROR','QUEUED'], default: 'SIMULATED', index: true },
    provider: { type: String, default: '' },
    providerResponse: { type: mongoose.Schema.Types.Mixed, default: null },
    error: { type: String, default: '' },
    executionDate: { type: String, default: '', index: true }
  }, { timestamps: true, strict: false });

  const renegotiationSchema = new mongoose.Schema({
    renegotiationId: { type: String, unique: true, index: true },
    originalAnalysisId: { type: String, default: '', index: true },
    originalOrderId: { type: String, default: '', index: true },
    customerDocument: { type: String, default: '', index: true },
    customerName: { type: String, default: '' },
    status: {
      type: String,
      enum: ['DRAFT','READY_FOR_APPROVAL','APPROVED','BOLETOS_PENDING','ACTIVE','CANCELLED'],
      default: 'DRAFT',
      index: true
    },
    referenceDate: { type: String, default: '' },
    originalBalanceCents: { type: Number, default: 0 },
    accumulatedFineCents: { type: Number, default: 0 },
    accumulatedInterestCents: { type: Number, default: 0 },
    negotiatedBalanceCents: { type: Number, default: 0 },
    downPaymentCents: { type: Number, default: 0 },
    newInstallmentCount: { type: Number, default: 0 },
    firstDueDate: { type: String, default: '' },
    newSchedule: { type: [mongoose.Schema.Types.Mixed], default: [] },
    newBoletos: { type: [mongoose.Schema.Types.Mixed], default: [] },
    originalContractSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    notes: { type: String, default: '' },
    createdBy: { type: String, default: '' },
    approvedBy: { type: String, default: '' },
    approvedAt: { type: Date, default: null },
    history: { type: [historySchema], default: [] }
  }, { timestamps: true, strict: false });

  const Analysis = mongoose.models.CrediarioAnalysis || mongoose.model('CrediarioAnalysis', analysisSchema, 'crediario_analyses');
  const Profile = mongoose.models.CrediarioCreditProfile || mongoose.model('CrediarioCreditProfile', profileSchema, 'crediario_credit_profiles');
  const CollectionLog = mongoose.models.CrediarioCollectionLog || mongoose.model('CrediarioCollectionLog', collectionLogSchema, 'crediario_collection_logs');
  const Renegotiation = mongoose.models.CrediarioRenegotiation || mongoose.model('CrediarioRenegotiation', renegotiationSchema, 'crediario_renegotiations');
  return { Analysis, Profile, CollectionLog, Renegotiation };
}

export default function registerCrediarioAnalysisRoutes(app, { mongoose, Order, authRequired, adminRequired } = {}) {
  if (!app || !mongoose || !Order) throw new Error('Crediário análise: dependências obrigatórias ausentes.');
  const { Analysis, Profile, CollectionLog, Renegotiation } = getModels(mongoose);

  async function findOrder(orderId) {
    const id = text(orderId, 120);
    const query = mongoose.Types.ObjectId.isValid(id)
      ? { _id: new mongoose.Types.ObjectId(id) }
      : { $or: [{ orderId: id }, { code: id }, { number: id }, { externalId: id }] };
    return Order.collection.findOne(query);
  }

  async function updateOrder(orderId, set = {}) {
    const id = text(orderId, 120);
    if (!id) return null;
    const query = mongoose.Types.ObjectId.isValid(id)
      ? { _id: new mongoose.Types.ObjectId(id) }
      : { $or: [{ orderId: id }, { code: id }, { number: id }, { externalId: id }] };
    await Order.collection.updateOne(query, { $set: { ...set, updatedAt: new Date() } });
    return Order.collection.findOne(query);
  }

  function customerOwns(order, req) {
    const userId = String(req.user?._id || req.auth?.id || '');
    const candidates = [order?.userId, order?.customerId, order?.clientId, order?.user?._id, order?.customer?._id].map(String);
    return Boolean(userId && candidates.includes(userId));
  }

  const collectionRules = [
    { key: 'DUE_MINUS_5', daysRelative: -5, label: '5 dias antes do vencimento' },
    { key: 'DUE_TODAY', daysRelative: 0, label: 'No dia do vencimento' },
    { key: 'OVERDUE_3', daysRelative: 3, label: '3 dias após o vencimento' },
    { key: 'OVERDUE_7', daysRelative: 7, label: '7 dias após o vencimento' },
    { key: 'OVERDUE_15', daysRelative: 15, label: '15 dias após o vencimento' }
  ];

  function extractInstallments(analysis, order) {
    const candidates = [
      order?.crediario?.installments,
      order?.crediario?.installmentPlan,
      order?.payment?.invoices,
      order?.cora?.invoices,
      order?.invoices,
      analysis?.installmentPlan
    ];
    const list = candidates.find(Array.isArray) || [];
    return list.map((item, index) => ({
      number: Number(item?.number || item?.installmentNumber || item?.parcela || index + 1),
      dueDate: dateOnly(item?.dueDate || item?.due_date || item?.vencimento || item?.payment_terms?.due_date),
      amountCents: cents(item?.amountCents || item?.valueCents || item?.total_amount || item?.amount || item?.valorCentavos || item?.valor),
      status: text(item?.status || item?.paymentStatus || item?.situacao || 'OPEN', 40).toUpperCase(),
      digitableLine: text(item?.digitableLine || item?.digitable || item?.payment_options?.bank_slip?.digitable, 250),
      boletoUrl: safeUrl(item?.url || item?.boletoUrl || item?.payment_options?.bank_slip?.url)
    })).filter((item) => item.dueDate && item.amountCents > 0 && !['PAID','PAGO','CANCELLED','CANCELADO'].includes(item.status));
  }

  function collectionMessage(candidate) {
    const name = candidate.customerName || 'cliente';
    const installment = `${String(candidate.installmentNumber).padStart(2, '0')}/${String(candidate.installmentCount).padStart(2, '0')}`;
    if (candidate.daysRelative === -5) return `Olá, ${name}. A parcela ${installment} do Crediário Ariana vence em 5 dias, em ${candidate.dueDateBR}. Valor: ${moneyBR(candidate.originalCents)}. ${candidate.boletoUrl ? `Segunda via: ${candidate.boletoUrl}` : ''}`.trim();
    if (candidate.daysRelative === 0) return `Olá, ${name}. Hoje vence a parcela ${installment} do Crediário Ariana. Valor: ${moneyBR(candidate.originalCents)}. ${candidate.boletoUrl ? `Segunda via: ${candidate.boletoUrl}` : ''}`.trim();
    return `Olá, ${name}. A parcela ${installment} do Crediário Ariana está em atraso há ${candidate.daysLate} dia(s). Valor original: ${moneyBR(candidate.originalCents)}. Multa: ${moneyBR(candidate.fineCents)}. Juros: ${moneyBR(candidate.interestCents)}. Valor atualizado hoje: ${moneyBR(candidate.updatedCents)}. ${candidate.boletoUrl ? `Segunda via: ${candidate.boletoUrl}` : 'Entre em contato com o financeiro para regularizar.'}`.trim();
  }

  async function buildCollectionCandidates({ q = '', limit = 200, referenceDate = new Date() } = {}) {
    const query = { status: { $in: ['ASSINADO','APROVADO','AGUARDANDO_ASSINATURA'] } };
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      query.$or = [{ orderId: rx }, { 'customer.name': rx }, { 'customer.document': digits(q) || '__none__' }];
    }
    const analyses = await Analysis.find(query).sort({ updatedAt: -1 }).limit(Math.min(500, Math.max(1, Number(limit || 200)))).lean();
    const today = dateOnly(referenceDate);
    const executionDate = today;
    const candidates = [];
    for (const analysis of analyses) {
      const order = await findOrder(analysis.orderId);
      const installments = extractInstallments(analysis, order);
      for (const installment of installments) {
        const daysRelative = dayDiff(installment.dueDate, today);
        const rule = collectionRules.find((r) => r.daysRelative === daysRelative);
        if (!rule) continue;
        const calc = updatedInstallmentAmount(installment.amountCents, Math.max(0, daysRelative));
        const phone = digits(analysis.customer?.phone || order?.customerPhone || order?.customer?.phone || order?.shippingAddress?.phone);
        const duplicate = await CollectionLog.exists({ analysisId: analysis.analysisId, installmentNumber: installment.number, ruleKey: rule.key, executionDate, status: { $in: ['SENT','QUEUED'] } });
        const candidate = {
          analysisId: analysis.analysisId,
          orderId: analysis.orderId,
          customerId: analysis.customerId,
          customerName: analysis.customer?.name || order?.customerName || '',
          customerDocument: digits(analysis.customer?.document || order?.customerDocument),
          phone,
          installmentNumber: installment.number,
          installmentCount: Number(analysis.installmentCount || installments.length || 1),
          dueDate: installment.dueDate,
          dueDateBR: installment.dueDate.split('-').reverse().join('/'),
          daysRelative,
          daysLate: Math.max(0, daysRelative),
          ruleKey: rule.key,
          ruleLabel: rule.label,
          boletoUrl: installment.boletoUrl,
          digitableLine: installment.digitableLine,
          ...calc,
          executionDate,
          canSend: Boolean(phone && !duplicate),
          blockReason: !phone ? 'Cliente sem telefone' : duplicate ? 'Cobrança já enviada nesta regra/data' : ''
        };
        candidate.message = collectionMessage(candidate);
        candidates.push(candidate);
      }
    }
    return candidates;
  }

  async function buildUpdatedInstallmentsByDocument(document, referenceDate = new Date()) {
    const normalizedDocument = digits(document);
    const analyses = await Analysis.find({
      'customer.document': normalizedDocument,
      status: { $in: ['APROVADO','AGUARDANDO_ASSINATURA','ASSINADO'] }
    }).sort({ createdAt: -1 }).lean();

    const referenceKey = dateOnly(referenceDate);
    const rows = [];

    for (const analysis of analyses) {
      const order = await findOrder(analysis.orderId);
      const installments = extractInstallments(analysis, order);

      for (const installment of installments) {
        const daysLate = Math.max(0, dayDiff(installment.dueDate, referenceKey));
        const calc = updatedInstallmentAmount(installment.amountCents, daysLate);
        rows.push({
          analysisId: analysis.analysisId,
          orderId: analysis.orderId,
          installmentNumber: installment.number,
          installmentCount: Number(analysis.installmentCount || installments.length || 1),
          dueDate: installment.dueDate,
          status: installment.status,
          daysLate,
          digitableLine: installment.digitableLine,
          boletoUrl: installment.boletoUrl,
          ...calc
        });
      }
    }

    return rows.sort((a, b) =>
      String(a.dueDate).localeCompare(String(b.dueDate)) ||
      Number(a.installmentNumber || 0) - Number(b.installmentNumber || 0)
    );
  }

  function buildRenegotiationSchedule(totalCents, count, firstDueDate) {
    const total = Math.max(0, cents(totalCents));
    const installments = Math.min(48, Math.max(1, Number(count || 1)));
    const first = new Date(`${dateOnly(firstDueDate)}T12:00:00.000Z`);
    if (Number.isNaN(first.getTime())) throw new Error('Primeiro vencimento inválido.');

    const base = Math.floor(total / installments);
    let distributed = 0;
    const schedule = [];

    for (let index = 0; index < installments; index += 1) {
      const due = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + index, 1, 12));
      const lastDay = new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth() + 1, 0, 12)).getUTCDate();
      due.setUTCDate(Math.min(first.getUTCDate(), lastDay));
      const amountCents = index === installments - 1 ? total - distributed : base;
      distributed += amountCents;
      schedule.push({
        number: index + 1,
        dueDate: due.toISOString().slice(0, 10),
        originalAmountCents: amountCents,
        status: 'PLANNED'
      });
    }
    return schedule;
  }

  async function sendCollectionMessage(candidate) {
    return sendCrediarioWhatsApp({
      phone: candidate.phone,
      message: candidate.message,
      metadata: {
        eventType: 'AUTOMATIC_COLLECTION',
        orderId: candidate.orderId,
        analysisId: candidate.analysisId,
        installmentNumber: candidate.installmentNumber,
        ruleKey: candidate.ruleKey
      }
    });
  }

  async function executeCollections({ q = '', limit = 200, dryRun = true, referenceDate = new Date() } = {}) {
    const candidates = await buildCollectionCandidates({ q, limit, referenceDate });
    const results = [];
    for (const candidate of candidates) {
      if (dryRun) { results.push({ ...candidate, status: 'SIMULATED' }); continue; }
      if (!candidate.canSend) { results.push({ ...candidate, status: 'SKIPPED' }); continue; }
      try {
        const sent = await sendCollectionMessage(candidate);
        const log = await CollectionLog.create({ logId: publicId('cobranca'), ...candidate, status: sent.status, provider: sent.provider, providerResponse: sent.response });
        results.push({ ...candidate, status: sent.status, logId: log.logId });
      } catch (error) {
        const log = await CollectionLog.create({ logId: publicId('cobranca'), ...candidate, status: 'ERROR', error: text(error.message, 1000) });
        results.push({ ...candidate, status: 'ERROR', error: error.message, logId: log.logId });
      }
    }
    return results;
  }

  app.post('/api/payments/crediario/analises', authRequired, async (req, res) => {
    try {
      const body = req.body || {};
      const orderId = text(body.orderId || body.pedidoId, 120);
      const order = await findOrder(orderId);
      if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado.' });
      if (!customerOwns(order, req)) return res.status(403).json({ ok: false, error: 'Pedido não pertence ao cliente autenticado.' });

      const existing = await Analysis.findOne({ orderId, status: { $nin: ['REPROVADO', 'CANCELADO'] } }).sort({ createdAt: -1 });
      if (existing) return res.status(200).json({ ok: true, reused: true, analysis: existing });

      const plan = body.plan || body.crediario || {};
      const baseAmountCents = cents(plan.baseAmountCents || body.baseAmountCents);
      if (baseAmountCents <= 0) {
        return res.status(400).json({ ok: false, error: 'Valor-base do pedido inválido.' });
      }

      // A escolha do plano acontece somente depois da aprovação.
      const financedAmountCents = cents(plan.financedAmountCents || body.financedAmountCents) || baseAmountCents;
      const installmentCount = Math.min(15, Math.max(0, Number(plan.installmentCount || body.installments || 0)));
      const installmentDivisor = Math.max(0, Number(plan.divisor || body.installmentDivisor || 0));
      const customer = body.customer || order.customer || {};
      const customerPhone = digits(
        customer.phone || customer.telefone || order.customerPhone || order.phone ||
        order.shippingAddress?.phone || order.billingAddress?.phone || order.customer?.phone
      );

      const analysis = await Analysis.create({
        analysisId: publicId('analise'),
        orderId,
        origin: 'SITE',
        conversationId: '',
        documentCollectionStatus: customerPhone ? 'CONVITE_ENVIADO' : 'AGUARDANDO_TELEFONE',
        customerId: String(req.user?._id || req.auth?.id || ''),
        customer: {
          name: text(customer.name || customer.nome || order.customerName || order.customer?.name, 160),
          document: digits(customer.document || customer.cpf || order.customerDocument || order.customer?.document),
          email: text(customer.email || order.customerEmail || order.customer?.email, 160),
          phone: customerPhone
        },
        status: customerPhone ? 'AGUARDANDO_DOCUMENTOS' : 'PENDENTE_ANALISE',
        baseAmountCents,
        financedAmountCents,
        installmentCount,
        installmentDivisor,
        firstDueDate: text(body.firstDueDate || plan.firstDueDate, 10),
        installmentPlan: Array.isArray(plan.installments) ? plan.installments : [],
        internalNote: text(body.note || body.observacao, 3000),
        purchase: {
          source: 'SITE',
          items: Array.isArray(body.checkoutDraft?.cart) ? body.checkoutDraft.cart.slice(0, 100) : [],
          shipping: body.checkoutDraft?.shippingQuote || null,
          totals: body.checkoutDraft?.totals || null
        },
        history: [{
          action: 'ANALYSIS_REQUESTED',
          toStatus: customerPhone ? 'AGUARDANDO_DOCUMENTOS' : 'PENDENTE_ANALISE',
          actorId: String(req.user?._id || ''),
          actorName: text(req.user?.name || 'Cliente', 120),
          note: text(body.note || body.observacao, 1000),
          metadata: { origin: 'SITE' }
        }]
      });

      await updateOrder(orderId, {
        paymentMethod: 'crediario_ariana',
        paymentStatus: 'PENDING_CREDIT_ANALYSIS',
        status: 'pending_credit_analysis',
        statusLabel: customerPhone ? 'Aguardando documentos do crediário' : 'Aguardando análise de crédito',
        'crediario.analysisId': analysis.analysisId,
        'crediario.analysisStatus': analysis.status,
        'crediario.origin': 'SITE',
        'crediario.baseAmountCents': baseAmountCents,
        'crediario.financedAmountCents': financedAmountCents,
        'crediario.installmentCount': installmentCount,
        'crediario.installmentDivisor': installmentDivisor,
        'crediario.firstDueDate': analysis.firstDueDate,
        'crediario.installmentPlan': analysis.installmentPlan
      });

      let whatsapp = null;
      if (customerPhone) {
        try {
          whatsapp = await sendCrediarioWhatsApp({
            phone: customerPhone,
            message: `Olá${analysis.customer.name ? `, ${analysis.customer.name.split(' ')[0]}` : ''}! 👋 Recebemos sua solicitação do *Crediário Ariana Móveis* referente ao pedido *${orderId}*. Para iniciar o envio seguro dos seus dados e documentos, responda *ACEITO* nesta conversa.`,
            metadata: {
              eventType: 'CREDIT_ANALYSIS_INVITE',
              origin: 'SITE',
              orderId,
              analysisId: analysis.analysisId
            }
          });
          analysis.history.push({
            action: 'WHATSAPP_INVITE_SENT',
            fromStatus: analysis.status,
            toStatus: analysis.status,
            actorName: 'Sistema',
            metadata: { provider: whatsapp.provider, messageId: whatsapp.messageId }
          });
          await analysis.save();
        } catch (sendError) {
          analysis.documentCollectionStatus = 'FALHA_NO_CONVITE';
          analysis.history.push({ action: 'WHATSAPP_INVITE_FAILED', actorName: 'Sistema', note: text(sendError.message, 1000) });
          await analysis.save();
        }
      }

      return res.status(201).json({ ok: true, analysis, whatsapp });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Falha ao solicitar análise.' });
    }
  });

  app.get('/api/payments/crediario/analises/:id', authRequired, async (req, res) => {
    const id = text(req.params.id, 120);
    const analysis = await Analysis.findOne({ $or: [{ analysisId: id }, { orderId: id }] }).sort({ createdAt: -1 });
    if (!analysis) return res.status(404).json({ ok: false, error: 'Análise não encontrada.' });

    const userId = String(req.user?._id || req.auth?.id || '');
    if (analysis.customerId && String(analysis.customerId) !== userId) {
      const order = analysis.orderId ? await findOrder(analysis.orderId) : null;
      if (!order || !customerOwns(order, req)) return res.status(403).json({ ok: false, error: 'Acesso negado.' });
    }
    return res.json({ ok: true, analysis });
  });


  app.post('/api/admin/crediario/analises/loja', adminRequired, async (req, res) => {
    try {
      const body = req.body || {};
      const phone = digits(body.phone || body.telefone);
      const baseAmountCents = cents(body.baseAmountCents || body.valorCentavos);
      const customerName = text(body.customerName || body.nome, 160);
      if (!customerName || !phone || baseAmountCents <= 0) {
        return res.status(400).json({ ok: false, error: 'Informe nome, WhatsApp e valor da compra.' });
      }

      const analysis = await Analysis.create({
        analysisId: publicId('analise'),
        orderId: text(body.orderId || body.pedidoId, 120),
        origin: 'LOJA_FISICA',
        conversationId: '',
        documentCollectionStatus: 'CONVITE_ENVIADO',
        customerId: text(body.customerId, 120),
        customer: {
          name: customerName,
          document: digits(body.document || body.cpf),
          email: text(body.email, 160),
          phone
        },
        status: 'AGUARDANDO_DOCUMENTOS',
        baseAmountCents,
        financedAmountCents: baseAmountCents,
        installmentCount: 0,
        installmentDivisor: 0,
        internalNote: text(body.note || body.observacao, 3000),
        purchase: {
          source: 'LOJA_FISICA',
          description: text(body.purchaseDescription || body.produto, 1000),
          seller: text(body.seller || body.vendedor, 160),
          storeReference: text(body.storeReference || body.referencia, 160)
        },
        history: [{
          action: 'ANALYSIS_REQUESTED',
          toStatus: 'AGUARDANDO_DOCUMENTOS',
          actorId: String(req.admin?.id || req.auth?.id || ''),
          actorName: text(req.admin?.name || req.user?.name || 'Administrador', 120),
          note: text(body.note || body.observacao, 1000),
          metadata: { origin: 'LOJA_FISICA' }
        }]
      });

      let whatsapp = null;
      try {
        whatsapp = await sendCrediarioWhatsApp({
          phone,
          message: `Olá, ${customerName.split(' ')[0]}! 👋 A equipe da *Ariana Móveis* abriu uma solicitação de crediário para sua compra${body.purchaseDescription || body.produto ? ` de *${text(body.purchaseDescription || body.produto, 180)}*` : ''}. Para iniciar o envio seguro dos seus dados e documentos, responda *ACEITO* nesta conversa.`,
          metadata: {
            eventType: 'CREDIT_ANALYSIS_INVITE',
            origin: 'LOJA_FISICA',
            orderId: analysis.orderId,
            analysisId: analysis.analysisId
          }
        });
        analysis.history.push({ action: 'WHATSAPP_INVITE_SENT', actorName: 'Sistema', metadata: { provider: whatsapp.provider, messageId: whatsapp.messageId } });
        await analysis.save();
      } catch (sendError) {
        analysis.documentCollectionStatus = 'FALHA_NO_CONVITE';
        analysis.history.push({ action: 'WHATSAPP_INVITE_FAILED', actorName: 'Sistema', note: text(sendError.message, 1000) });
        await analysis.save();
      }

      return res.status(201).json({ ok: true, analysis, whatsapp });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Falha ao abrir solicitação da loja.' });
    }
  });

  app.get('/api/admin/crediario/analises/dashboard', adminRequired, async (_req, res) => {
    const [byStatus, totals] = await Promise.all([
      Analysis.aggregate([{ $group: { _id: '$status', count: { $sum: 1 }, amountCents: { $sum: '$financedAmountCents' } } }]),
      Analysis.aggregate([{ $group: { _id: null, count: { $sum: 1 }, baseCents: { $sum: '$baseAmountCents' }, financedCents: { $sum: '$financedAmountCents' } } }])
    ]);
    return res.json({ ok: true, byStatus, totals: totals[0] || { count: 0, baseCents: 0, financedCents: 0 } });
  });

  app.get('/api/admin/crediario/analises', adminRequired, async (req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const query = {};
    if (req.query.status) query.status = text(req.query.status, 50);
    if (req.query.origin) query.origin = text(req.query.origin, 30).toUpperCase();
    const q = text(req.query.q, 120);
    if (q) query.$or = [
      { orderId: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
      { 'customer.name': new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
      { 'customer.document': digits(q) }
    ];
    const analyses = await Analysis.find(query).sort({ createdAt: -1 }).limit(limit);
    return res.json({ ok: true, count: analyses.length, analyses });
  });

  app.get('/api/admin/crediario/analises/:id', adminRequired, async (req, res) => {
    const analysis = await Analysis.findOne({ $or: [{ _id: mongoose.Types.ObjectId.isValid(req.params.id) ? new mongoose.Types.ObjectId(req.params.id) : null }, { analysisId: req.params.id }, { orderId: req.params.id }] });
    if (!analysis) return res.status(404).json({ ok: false, error: 'Análise não encontrada.' });
    let profile = analysis.customer?.document ? await Profile.findOne({ document: analysis.customer.document }) : null;
    if (!profile && analysis.customer?.document) {
      profile = await Profile.create({ document: analysis.customer.document, customerId: analysis.customerId, customerName: analysis.customer?.name || '' });
    }
    const suggestion = suggestCreditDecision({ profile: asObject(profile) || {}, financedAmountCents: analysis.financedAmountCents, checklist: analysis.checklist || {} });
    analysis.suggestion = { decision: suggestion.suggestion, reasons: suggestion.reasons, calculatedAt: new Date() };
    await analysis.save();
    return res.json({ ok: true, analysis, profile, suggestion });
  });

  app.patch('/api/admin/crediario/analises/:id/status', adminRequired, async (req, res) => {
    const nextStatus = text(req.body?.status, 50).toUpperCase();
    if (!ANALYSIS_STATUSES.includes(nextStatus)) return res.status(400).json({ ok: false, error: 'Status inválido.' });
    const analysis = await Analysis.findOne({ $or: [{ _id: mongoose.Types.ObjectId.isValid(req.params.id) ? new mongoose.Types.ObjectId(req.params.id) : null }, { analysisId: req.params.id }] });
    if (!analysis) return res.status(404).json({ ok: false, error: 'Análise não encontrada.' });
    const previous = analysis.status;
    analysis.status = nextStatus;
    analysis.internalNote = text(req.body?.internalNote ?? analysis.internalNote, 3000);
    analysis.decisionNote = text(req.body?.decisionNote ?? analysis.decisionNote, 3000);
    analysis.requestedDocuments = Array.isArray(req.body?.requestedDocuments) ? req.body.requestedDocuments.map((v) => text(v, 120)).filter(Boolean) : analysis.requestedDocuments;
    if (req.body?.checklist && typeof req.body.checklist === 'object') {
      for (const key of ['cpfChecked','identityDocument','residenceProof','incomeChecked','contactConfirmed','referenceConfirmed']) {
        if (Object.prototype.hasOwnProperty.call(req.body.checklist, key)) analysis.checklist[key] = Boolean(req.body.checklist[key]);
      }
    }
    analysis.approvedLimitCents = cents(req.body?.approvedLimitCents ?? analysis.approvedLimitCents);
    if (['APROVADO', 'REPROVADO'].includes(nextStatus)) {
      analysis.decidedAt = new Date();
      analysis.decidedBy = String(req.admin?.id || req.auth?.id || '');
    }
    analysis.history.push({
      action: 'STATUS_CHANGED', fromStatus: previous, toStatus: nextStatus,
      actorId: String(req.admin?.id || req.auth?.id || ''), actorName: text(req.admin?.name || req.user?.name || 'Administrador', 120),
      note: analysis.decisionNote || analysis.internalNote
    });
    await analysis.save();

    const orderFields = {
      'crediario.analysisStatus': nextStatus,
      paymentStatus: nextStatus === 'APROVADO' ? 'CREDIT_APPROVED' : nextStatus === 'REPROVADO' ? 'CREDIT_REJECTED' : 'PENDING_CREDIT_ANALYSIS',
      status: nextStatus === 'APROVADO' ? 'awaiting_signature' : nextStatus === 'REPROVADO' ? 'credit_rejected' : 'pending_credit_analysis',
      statusLabel: nextStatus === 'APROVADO' ? 'Crédito aprovado — aguardando assinatura' : nextStatus === 'REPROVADO' ? 'Crédito não aprovado' : 'Análise de crédito em andamento'
    };
    await updateOrder(analysis.orderId, orderFields);

    const doc = digits(analysis.customer?.document);
    if (doc) {
      let profile = await Profile.findOne({ document: doc });
      if (!profile) profile = await Profile.create({ document: doc, customerId: analysis.customerId, customerName: analysis.customer?.name || '' });
      profile.customerId = analysis.customerId;
      profile.customerName = analysis.customer?.name || profile.customerName;
      profile.lastPurchaseAt = new Date();
      if (analysis.approvedLimitCents > 0) profile.creditLimitCents = analysis.approvedLimitCents;
      if (previous !== nextStatus) {
        if (nextStatus === 'APROVADO') {
          profile.approvedCount += 1;
          profile.purchasesCount += 1;
          profile.openPurchasesCount += 1;
          profile.totalFinancedCents += analysis.financedAmountCents;
          profile.usedLimitCents += analysis.financedAmountCents;
        }
        if (nextStatus === 'REPROVADO') profile.rejectedCount += 1;
        if (previous === 'APROVADO' && nextStatus !== 'APROVADO') {
          profile.usedLimitCents = Math.max(0, profile.usedLimitCents - analysis.financedAmountCents);
          profile.openPurchasesCount = Math.max(0, profile.openPurchasesCount - 1);
        }
      }
      const scoreData = calculateArianaScore(asObject(profile));
      profile.internalScore = scoreData.score;
      profile.riskLevel = scoreData.riskLevel;
      await profile.save();
      const suggestion = suggestCreditDecision({ profile: asObject(profile), financedAmountCents: analysis.financedAmountCents, checklist: analysis.checklist || {} });
      analysis.suggestion = { decision: suggestion.suggestion, reasons: suggestion.reasons, calculatedAt: new Date() };
      await analysis.save();
    }
    return res.json({ ok: true, analysis });
  });


  app.post('/api/admin/crediario/analises/:id/assinatura/preparar', adminRequired, async (req, res) => {
    try {
      const analysis = await Analysis.findOne({ $or: [{ _id: mongoose.Types.ObjectId.isValid(req.params.id) ? new mongoose.Types.ObjectId(req.params.id) : null }, { analysisId: req.params.id }] }).select('+signature.tokenHash');
      if (!analysis) return res.status(404).json({ ok: false, error: 'Análise não encontrada.' });
      if (!['APROVADO','AGUARDANDO_ASSINATURA'].includes(analysis.status)) return res.status(409).json({ ok: false, error: 'A análise precisa estar aprovada antes da assinatura.' });
      const docs = Array.isArray(req.body?.documents) ? req.body.documents.slice(0, 10).map((doc, index) => ({
        type: text(doc?.type || `DOCUMENTO_${index + 1}`, 60).toUpperCase(),
        title: text(doc?.title || `Documento ${index + 1}`, 160),
        url: safeUrl(doc?.url),
        hash: text(doc?.hash, 128)
      })).filter((doc) => doc.url) : [];
      if (!docs.length) return res.status(400).json({ ok: false, error: 'Informe ao menos um documento válido para assinatura.' });
      const rawToken = crypto.randomBytes(32).toString('hex');
      const expiresHours = Math.min(168, Math.max(1, Number(req.body?.expiresHours || 72)));
      const baseUrl = String(process.env.FRONTEND_URL || process.env.APP_URL || '').replace(/\/$/, '');
      const relativeUrl = `/assinatura_crediario.html?token=${encodeURIComponent(rawToken)}`;
      analysis.signature = {
        status: 'PENDING', provider: 'ariana_internal', envelopeId: publicId('assinatura'),
        tokenHash: sha256(rawToken), signingUrl: baseUrl ? `${baseUrl}${relativeUrl}` : relativeUrl,
        expiresAt: new Date(Date.now() + expiresHours * 3600000), requestedAt: new Date(),
        requestedBy: String(req.admin?.id || req.auth?.id || ''), documents: docs,
        signerName: '', signerDocument: '', acceptedTerms: false, signedAt: null,
        ipHash: '', userAgentHash: '', evidenceId: ''
      };
      const previous = analysis.status;
      analysis.status = 'AGUARDANDO_ASSINATURA';
      analysis.history.push({ action: 'SIGNATURE_REQUESTED', fromStatus: previous, toStatus: analysis.status, actorId: String(req.admin?.id || req.auth?.id || ''), actorName: text(req.admin?.name || 'Administrador', 120), metadata: { envelopeId: analysis.signature.envelopeId, expiresAt: analysis.signature.expiresAt, documents: docs.map(({type,title,hash}) => ({type,title,hash})) } });
      await analysis.save();
      await updateOrder(analysis.orderId, { 'crediario.analysisStatus': analysis.status, 'crediario.signatureStatus': 'PENDING', 'crediario.signatureEnvelopeId': analysis.signature.envelopeId, paymentStatus: 'AWAITING_SIGNATURE', status: 'awaiting_signature', statusLabel: 'Aguardando assinatura eletrônica' });
      return res.status(201).json({ ok: true, signature: { ...analysis.signature.toObject?.() || analysis.signature, tokenHash: undefined, token: rawToken, signingUrl: analysis.signature.signingUrl } });
    } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Falha ao preparar assinatura.' }); }
  });

  app.get('/api/admin/crediario/analises/:id/assinatura', adminRequired, async (req, res) => {
    const analysis = await Analysis.findOne({ $or: [{ _id: mongoose.Types.ObjectId.isValid(req.params.id) ? new mongoose.Types.ObjectId(req.params.id) : null }, { analysisId: req.params.id }] });
    if (!analysis) return res.status(404).json({ ok: false, error: 'Análise não encontrada.' });
    return res.json({ ok: true, signature: analysis.signature || null, analysisId: analysis.analysisId, orderId: analysis.orderId });
  });

  app.post('/api/admin/crediario/analises/:id/assinatura/cancelar', adminRequired, async (req, res) => {
    const analysis = await Analysis.findOne({ $or: [{ _id: mongoose.Types.ObjectId.isValid(req.params.id) ? new mongoose.Types.ObjectId(req.params.id) : null }, { analysisId: req.params.id }] }).select('+signature.tokenHash');
    if (!analysis) return res.status(404).json({ ok: false, error: 'Análise não encontrada.' });
    if (analysis.signature?.status === 'SIGNED') return res.status(409).json({ ok: false, error: 'Uma assinatura concluída não pode ser cancelada.' });
    analysis.signature.status = 'CANCELLED'; analysis.signature.tokenHash = '';
    analysis.history.push({ action: 'SIGNATURE_CANCELLED', fromStatus: analysis.status, toStatus: analysis.status, actorId: String(req.admin?.id || req.auth?.id || ''), actorName: text(req.admin?.name || 'Administrador', 120), note: text(req.body?.reason, 1000) });
    await analysis.save();
    await updateOrder(analysis.orderId, { 'crediario.signatureStatus': 'CANCELLED' });
    return res.json({ ok: true, signature: analysis.signature });
  });

  app.get('/api/payments/crediario/assinaturas/:token', authRequired, async (req, res) => {
    const tokenHash = sha256(req.params.token);
    const analysis = await Analysis.findOne({ 'signature.tokenHash': tokenHash }).select('+signature.tokenHash');
    if (!analysis) return res.status(404).json({ ok: false, error: 'Solicitação de assinatura não encontrada.' });
    if (analysis.customerId && String(analysis.customerId) !== String(req.user?._id || req.auth?.id || '')) return res.status(403).json({ ok: false, error: 'Esta assinatura pertence a outro cliente.' });
    if (analysis.signature?.status === 'PENDING' && analysis.signature.expiresAt && new Date(analysis.signature.expiresAt) < new Date()) { analysis.signature.status = 'EXPIRED'; await analysis.save(); }
    return res.json({ ok: true, analysis: { analysisId: analysis.analysisId, orderId: analysis.orderId, customer: analysis.customer, financedAmountCents: analysis.financedAmountCents, installmentCount: analysis.installmentCount, firstDueDate: analysis.firstDueDate }, signature: { status: analysis.signature?.status, envelopeId: analysis.signature?.envelopeId, expiresAt: analysis.signature?.expiresAt, documents: analysis.signature?.documents || [], signedAt: analysis.signature?.signedAt } });
  });

  app.post('/api/payments/crediario/assinaturas/:token/assinar', authRequired, async (req, res) => {
    try {
      const tokenHash = sha256(req.params.token);
      const analysis = await Analysis.findOne({ 'signature.tokenHash': tokenHash }).select('+signature.tokenHash');
      if (!analysis) return res.status(404).json({ ok: false, error: 'Solicitação de assinatura não encontrada.' });
      if (analysis.customerId && String(analysis.customerId) !== String(req.user?._id || req.auth?.id || '')) return res.status(403).json({ ok: false, error: 'Esta assinatura pertence a outro cliente.' });
      if (analysis.signature?.status === 'SIGNED') return res.json({ ok: true, reused: true, signature: analysis.signature });
      if (analysis.signature?.status !== 'PENDING') return res.status(409).json({ ok: false, error: 'Esta solicitação não está disponível para assinatura.' });
      if (analysis.signature.expiresAt && new Date(analysis.signature.expiresAt) < new Date()) { analysis.signature.status = 'EXPIRED'; await analysis.save(); return res.status(410).json({ ok: false, error: 'O link de assinatura expirou.' }); }
      const signerName = text(req.body?.signerName, 160);
      const signerDocument = digits(req.body?.signerDocument);
      if (!req.body?.acceptedTerms || signerName.length < 3 || signerDocument.length < 11) return res.status(400).json({ ok: false, error: 'Confirme os termos, o nome completo e o CPF do assinante.' });
      if (analysis.customer?.document && signerDocument !== digits(analysis.customer.document)) return res.status(400).json({ ok: false, error: 'O CPF informado não corresponde ao titular do crediário.' });
      const evidenceId = publicId('evidencia');
      analysis.signature.status = 'SIGNED'; analysis.signature.signerName = signerName; analysis.signature.signerDocument = signerDocument; analysis.signature.acceptedTerms = true; analysis.signature.signedAt = new Date(); analysis.signature.ipHash = sha256(req.ip || req.headers['x-forwarded-for'] || ''); analysis.signature.userAgentHash = sha256(req.headers['user-agent'] || ''); analysis.signature.evidenceId = evidenceId; analysis.signature.tokenHash = '';
      const previous = analysis.status; analysis.status = 'ASSINADO';
      analysis.history.push({ action: 'DOCUMENTS_SIGNED', fromStatus: previous, toStatus: 'ASSINADO', actorId: String(req.user?._id || req.auth?.id || ''), actorName: signerName, metadata: { evidenceId, envelopeId: analysis.signature.envelopeId, signedAt: analysis.signature.signedAt } });
      await analysis.save();
      await updateOrder(analysis.orderId, { 'crediario.analysisStatus': 'ASSINADO', 'crediario.signatureStatus': 'SIGNED', 'crediario.signatureEvidenceId': evidenceId, 'crediario.signedAt': analysis.signature.signedAt, paymentStatus: 'SIGNED_PENDING_ISSUANCE', status: 'awaiting_cora_issuance', statusLabel: 'Contrato assinado — aguardando emissão do carnê' });
      return res.json({ ok: true, signature: { status: 'SIGNED', signedAt: analysis.signature.signedAt, evidenceId, envelopeId: analysis.signature.envelopeId }, nextStep: 'ISSUE_CORA_CARNE' });
    } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Falha ao registrar assinatura.' }); }
  });


  app.get('/api/admin/crediario/whatsapp/config', adminRequired, async (_req, res) => {
    return res.json({ ok: true, ...getCrediarioWhatsAppConfig() });
  });

  app.post('/api/admin/crediario/whatsapp/enviar', adminRequired, async (req, res) => {
    try {
      const phone = digits(req.body?.phone || req.body?.telefone);
      const message = text(req.body?.message || req.body?.mensagem, 4000);
      const eventType = text(req.body?.eventType || 'MANUAL_MESSAGE', 80).toUpperCase();
      const orderId = text(req.body?.orderId, 120);
      const analysisId = text(req.body?.analysisId, 120);
      const customerName = text(req.body?.customerName, 180);
      if (!phone || !message) return res.status(400).json({ ok: false, error: 'Informe telefone e mensagem.' });
      const sent = await sendCrediarioWhatsApp({ phone, message, metadata: { eventType, orderId, analysisId, actorId: String(req.admin?.id || req.auth?.id || '') } });
      const log = await CollectionLog.create({ logId: publicId('whatsapp'), analysisId, orderId, customerName, phone, ruleKey: eventType, eventType, message, status: sent.status, provider: sent.provider, providerMessageId: sent.messageId, providerResponse: sent.response, chatwoot: sent.chatwoot, executionDate: dateOnly(new Date()) });
      return res.json({ ok: true, status: sent.status, messageId: sent.messageId, provider: sent.provider, chatwoot: sent.chatwoot, logId: log.logId });
    } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Falha ao enviar WhatsApp.' }); }
  });

  app.post('/api/admin/crediario/whatsapp/enviar-documento', adminRequired, async (req, res) => {
    try {
      const phone = digits(req.body?.phone || req.body?.telefone);
      const mediaUrl = safeUrl(req.body?.mediaUrl || req.body?.url);
      const fileName = text(req.body?.fileName || 'documento-ariana-moveis.pdf', 180);
      const caption = text(req.body?.caption || req.body?.message || 'Documento Ariana Móveis', 2000);
      const eventType = text(req.body?.eventType || 'DOCUMENT', 80).toUpperCase();
      const orderId = text(req.body?.orderId, 120);
      const analysisId = text(req.body?.analysisId, 120);
      const customerName = text(req.body?.customerName, 180);
      if (!phone || !mediaUrl) return res.status(400).json({ ok: false, error: 'Informe telefone e URL pública do PDF.' });
      const sent = await sendCrediarioWhatsApp({ phone, message: caption, mediaUrl, fileName, caption, metadata: { eventType, orderId, analysisId, actorId: String(req.admin?.id || req.auth?.id || '') } });
      const log = await CollectionLog.create({ logId: publicId('whatsapp'), analysisId, orderId, customerName, phone, ruleKey: eventType, eventType, message: caption, mediaUrl, fileName, status: sent.status, provider: sent.provider, providerMessageId: sent.messageId, providerResponse: sent.response, chatwoot: sent.chatwoot, executionDate: dateOnly(new Date()) });
      return res.json({ ok: true, status: sent.status, messageId: sent.messageId, provider: sent.provider, chatwoot: sent.chatwoot, logId: log.logId });
    } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Falha ao enviar documento pelo WhatsApp.' }); }
  });

  app.get('/api/admin/crediario/whatsapp/historico', adminRequired, async (req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query?.limit || 100)));
    const query = { logId: /^whatsapp_/ };
    if (req.query?.q) {
      const rx = new RegExp(escapeRegex(text(req.query.q, 120)), 'i');
      query.$or = [{ customerName: rx }, { orderId: rx }, { phone: digits(req.query.q) || '__none__' }, { eventType: rx }];
    }
    const logs = await CollectionLog.find(query).sort({ createdAt: -1 }).limit(limit).lean();
    return res.json({ ok: true, logs });
  });

  app.get('/api/admin/crediario/cobranca-automatica/config', adminRequired, async (_req, res) => {
    return res.json({
      ok: true,
      enabled: envBool(process.env.CREDIARIO_AUTO_COLLECTION_ENABLED, false),
      hour: Math.min(23, Math.max(0, Number(process.env.CREDIARIO_AUTO_COLLECTION_HOUR || 9))),
      timezone: process.env.CREDIARIO_AUTO_COLLECTION_TIMEZONE || 'America/Sao_Paulo',
      providerConfigured: getCrediarioWhatsAppConfig().configured,
      whatsapp: getCrediarioWhatsAppConfig(),
      rules: collectionRules,
      finePercent: 2,
      interestPercentMonth: 1,
      antiDuplication: 'Uma cobrança por parcela, regra e data de execução.'
    });
  });

  app.post('/api/admin/crediario/cobranca-automatica/simular', adminRequired, async (req, res) => {
    try {
      const candidates = await buildCollectionCandidates({ q: text(req.body?.q, 120), limit: Number(req.body?.limit || 200), referenceDate: req.body?.referenceDate || new Date() });
      const summary = { total: candidates.length, canSend: candidates.filter((c) => c.canSend).length, withoutPhone: candidates.filter((c) => !c.phone).length, duplicate: candidates.filter((c) => c.blockReason.includes('já enviada')).length, totalUpdatedCents: candidates.reduce((sum, c) => sum + c.updatedCents, 0) };
      return res.json({ ok: true, summary, candidates });
    } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Falha ao simular cobranças.' }); }
  });

  app.post('/api/admin/crediario/cobranca-automatica/executar', adminRequired, async (req, res) => {
    try {
      const results = await executeCollections({ q: text(req.body?.q, 120), limit: Number(req.body?.limit || 200), dryRun: Boolean(req.body?.dryRun), referenceDate: req.body?.referenceDate || new Date() });
      const summary = { total: results.length, sent: results.filter((r) => r.status === 'SENT').length, queued: results.filter((r) => r.status === 'QUEUED').length, skipped: results.filter((r) => r.status === 'SKIPPED').length, errors: results.filter((r) => r.status === 'ERROR').length };
      return res.json({ ok: true, summary, results });
    } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Falha ao executar cobranças.' }); }
  });

  app.post('/api/internal/crediario/cobranca-automatica/executar', async (req, res) => {
    try {
      const expected = String(process.env.CREDIARIO_CRON_SECRET || '');
      const provided = String(req.headers['x-cron-secret'] || req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!expected) return res.status(503).json({ ok: false, error: 'CREDIARIO_CRON_SECRET não configurada.' });
      if (!crypto.timingSafeEqual(Buffer.from(sha256(provided)), Buffer.from(sha256(expected)))) return res.status(401).json({ ok: false, error: 'Credencial do agendador inválida.' });
      if (!envBool(process.env.CREDIARIO_AUTO_COLLECTION_ENABLED, false)) return res.json({ ok: true, skipped: true, reason: 'Cobrança automática desativada.' });
      const results = await executeCollections({ limit: Number(req.body?.limit || 300), dryRun: false, referenceDate: req.body?.referenceDate || new Date() });
      const summary = { total: results.length, sent: results.filter((r) => r.status === 'SENT').length, queued: results.filter((r) => r.status === 'QUEUED').length, skipped: results.filter((r) => r.status === 'SKIPPED').length, errors: results.filter((r) => r.status === 'ERROR').length };
      return res.json({ ok: true, summary });
    } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Falha na execução automática.' }); }
  });

  app.get('/api/admin/crediario/cobranca-automatica/historico', adminRequired, async (req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query?.limit || 100)));
    const query = {};
    if (req.query?.status) query.status = text(req.query.status, 30).toUpperCase();
    if (req.query?.q) {
      const rx = new RegExp(escapeRegex(text(req.query.q, 120)), 'i');
      query.$or = [{ customerName: rx }, { orderId: rx }, { customerDocument: digits(req.query.q) || '__none__' }];
    }
    const logs = await CollectionLog.find(query).sort({ createdAt: -1 }).limit(limit).lean();
    return res.json({ ok: true, logs });
  });

  app.get('/api/admin/crediario/dashboard-financeiro', adminRequired, async (req, res) => {
    try {
      const referenceDate = req.query?.date ? new Date(`${dateOnly(req.query.date)}T12:00:00.000Z`) : new Date();
      const refKey = dateOnly(referenceDate);
      const tomorrow = new Date(referenceDate); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      const weekEnd = new Date(referenceDate); weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
      const monthEnd = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth() + 1, 0, 12));
      const analyses = await Analysis.find({ status: { $in: ['APROVADO','AGUARDANDO_ASSINATURA','ASSINADO'] } }).select('analysisId orderId customer financedAmountCents installmentPlan installmentCount createdAt').sort({ createdAt: -1 }).limit(5000).lean();
      const profiles = await Profile.find({}).select('document customerName profileStatus riskLevel totalReceivedCents openOverdueInstallments').lean();

      const kpis = {
        receivableTodayCents: 0, receivableTomorrowCents: 0, receivableWeekCents: 0, receivableMonthCents: 0,
        overdueOriginalCents: 0, overdueUpdatedCents: 0, accumulatedFineCents: 0, accumulatedInterestCents: 0,
        openPortfolioCents: 0, totalReceivedCents: profiles.reduce((sum, p) => sum + cents(p.totalReceivedCents), 0),
        overdueInstallments: 0, futureInstallments: 0, openInstallments: 0, paidInstallments: 0,
        contracts: analyses.length, customers: profiles.length, averageTicketCents: 0, defaultRatePercent: 0
      };
      const monthly = new Map();
      const risk = { ALTO: 0, MEDIO: 0, BOM: 0, EXCELENTE: 0 };
      const customerState = { ADIMPLENTE: 0, INADIMPLENTE: 0, BLOQUEADO: 0, EM_REVISAO: 0 };
      for (const profile of profiles) {
        const level = text(profile.riskLevel || 'MEDIO', 20).toUpperCase();
        risk[level] = (risk[level] || 0) + 1;
        if (profile.profileStatus === 'BLOQUEADO') customerState.BLOQUEADO += 1;
        else if (profile.profileStatus === 'EM_REVISAO') customerState.EM_REVISAO += 1;
        else if (Number(profile.openOverdueInstallments || 0) > 0) customerState.INADIMPLENTE += 1;
        else customerState.ADIMPLENTE += 1;
      }

      for (const analysis of analyses) {
        const plan = Array.isArray(analysis.installmentPlan) ? analysis.installmentPlan : [];
        for (let index = 0; index < plan.length; index += 1) {
          const item = plan[index] || {};
          const dueDate = dateOnly(item.dueDate || item.due_date || item.vencimento || item.date);
          if (!dueDate) continue;
          const originalCents = cents(item.amountCents ?? item.valueCents ?? item.total_amount ?? item.amount ?? item.value ?? 0);
          const rawStatus = text(item.status || item.paymentStatus || item.situation || '', 40).toUpperCase();
          const paid = Boolean(item.paidAt || item.paid_at || item.paymentDate || ['PAID','PAGO','QUITADO','RECEIVED'].includes(rawStatus));
          const paidAmountCents = cents(item.paidAmountCents ?? item.receivedCents ?? item.amountPaidCents ?? originalCents);
          const monthKey = dueDate.slice(0, 7);
          if (!monthly.has(monthKey)) monthly.set(monthKey, { month: monthKey, expectedCents: 0, receivedCents: 0, overdueCents: 0 });
          const bucket = monthly.get(monthKey);
          if (paid) {
            kpis.paidInstallments += 1;
            bucket.receivedCents += paidAmountCents;
            continue;
          }
          kpis.openInstallments += 1;
          kpis.openPortfolioCents += originalCents;
          bucket.expectedCents += originalCents;
          if (dueDate === refKey) kpis.receivableTodayCents += originalCents;
          if (dueDate === dateOnly(tomorrow)) kpis.receivableTomorrowCents += originalCents;
          if (dueDate >= refKey && dueDate <= dateOnly(weekEnd)) kpis.receivableWeekCents += originalCents;
          if (dueDate >= refKey && dueDate <= dateOnly(monthEnd)) kpis.receivableMonthCents += originalCents;
          const daysLate = dayDiff(dueDate, referenceDate);
          if (daysLate > 0) {
            const updated = updatedInstallmentAmount(originalCents, daysLate);
            kpis.overdueInstallments += 1;
            kpis.overdueOriginalCents += updated.originalCents;
            kpis.accumulatedFineCents += updated.fineCents;
            kpis.accumulatedInterestCents += updated.interestCents;
            kpis.overdueUpdatedCents += updated.updatedCents;
            bucket.overdueCents += updated.updatedCents;
          } else {
            kpis.futureInstallments += 1;
          }
        }
      }
      const financedTotal = analyses.reduce((sum, a) => sum + cents(a.financedAmountCents), 0);
      kpis.averageTicketCents = analyses.length ? Math.round(financedTotal / analyses.length) : 0;
      kpis.defaultRatePercent = kpis.openPortfolioCents ? Number(((kpis.overdueOriginalCents / kpis.openPortfolioCents) * 100).toFixed(2)) : 0;
      const months = [...monthly.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-12);
      const recentCollections = await CollectionLog.find({ status: { $in: ['SENT','ERROR','QUEUED'] } }).sort({ createdAt: -1 }).limit(8).lean();
      return res.json({ ok: true, referenceDate: refKey, kpis, charts: { months, risk, customerState }, recentCollections });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Falha ao montar dashboard financeiro.' });
    }
  });

  app.get('/api/admin/crediario/perfis/dashboard', adminRequired, async (req, res) => {
    const [totals, risk, status] = await Promise.all([
      Profile.aggregate([{ $group: { _id: null, customers: { $sum: 1 }, totalLimitCents: { $sum: '$creditLimitCents' }, usedLimitCents: { $sum: '$usedLimitCents' }, totalFinancedCents: { $sum: '$totalFinancedCents' }, totalReceivedCents: { $sum: '$totalReceivedCents' }, overdueInstallments: { $sum: '$openOverdueInstallments' } } }]),
      Profile.aggregate([{ $group: { _id: '$riskLevel', count: { $sum: 1 } } }]),
      Profile.aggregate([{ $group: { _id: '$profileStatus', count: { $sum: 1 } } }])
    ]);
    const t = totals[0] || { customers: 0, totalLimitCents: 0, usedLimitCents: 0, totalFinancedCents: 0, totalReceivedCents: 0, overdueInstallments: 0 };
    return res.json({ ok: true, totals: { ...t, availableLimitCents: Math.max(0, Number(t.totalLimitCents || 0) - Number(t.usedLimitCents || 0)) }, risk, status });
  });

  app.get('/api/admin/crediario/perfis', adminRequired, async (req, res) => {
    const search = text(req.query?.search || req.query?.q, 180);
    const riskLevel = text(req.query?.riskLevel, 30).toUpperCase();
    const profileStatus = text(req.query?.status, 30).toUpperCase();
    const page = Math.max(1, Number(req.query?.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query?.limit || 30)));
    const query = {};
    if (riskLevel) query.riskLevel = riskLevel;
    if (profileStatus) query.profileStatus = profileStatus;
    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ customerName: regex }, { document: digits(search) || '__none__' }, { phone: regex }, { whatsapp: regex }, { email: regex }];
    }
    const [profiles, total] = await Promise.all([
      Profile.find(query).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Profile.countDocuments(query)
    ]);
    return res.json({ ok: true, profiles: profiles.map((profile) => ({ ...profile, availableLimitCents: Math.max(0, Number(profile.creditLimitCents || 0) - Number(profile.usedLimitCents || 0)) })), pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } });
  });

  app.get('/api/admin/crediario/perfis/:document', adminRequired, async (req, res) => {
    const document = digits(req.params.document);
    if (!document) return res.status(400).json({ ok: false, error: 'Documento inválido.' });
    let profile = await Profile.findOne({ document });
    if (!profile) profile = await Profile.create({ document });
    const score = calculateArianaScore(asObject(profile));
    const analyses = await Analysis.find({ 'customer.document': document }).sort({ createdAt: -1 }).limit(50);
    return res.json({ ok: true, profile, score, analyses });
  });

  app.patch('/api/admin/crediario/perfis/:document', adminRequired, async (req, res) => {
    const document = digits(req.params.document);
    if (!document) return res.status(400).json({ ok: false, error: 'Documento inválido.' });
    const allowedText = ['customerName','birthDate','rg','maritalStatus','profession','employer','phone','whatsapp','email','notes','profileStatus','blockedReason'];
    const allowedNumbers = ['monthlyIncomeCents','employmentMonths','customerSinceMonths','creditLimitCents','usedLimitCents','purchasesCount','approvedCount','rejectedCount','settledPurchasesCount','openPurchasesCount','latePurchasesCount','installmentsPaidOnTime','installmentsPaidLate','openOverdueInstallments','averageDaysLate','maximumDaysLate','renegotiationsCount','cancelledPurchasesCount','returnedPurchasesCount','totalFinancedCents','totalReceivedCents'];
    const update = {};
    for (const key of allowedText) if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) update[key] = text(req.body[key], key === 'notes' ? 3000 : 180);
    for (const key of allowedNumbers) if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) update[key] = Math.max(0, cents(req.body[key]));
    if (req.body?.address && typeof req.body.address === 'object') update.address = req.body.address;
    if (Array.isArray(req.body?.references)) update.references = req.body.references.slice(0, 5).map((r) => ({ name: text(r?.name, 160), relationship: text(r?.relationship, 100), phone: digits(r?.phone) })).filter((r) => r.name || r.phone);
    let profile = await Profile.findOneAndUpdate({ document }, { $set: update }, { upsert: true, new: true });
    const score = calculateArianaScore(asObject(profile));
    profile.internalScore = score.score;
    profile.riskLevel = score.riskLevel;
    profile.auditHistory = Array.isArray(profile.auditHistory) ? profile.auditHistory : [];
    profile.auditHistory.push({ action: 'PROFILE_UPDATED', toStatus: profile.profileStatus || 'ATIVO', actorId: String(req.admin?.id || req.auth?.id || ''), actorName: text(req.admin?.name || 'Administrador', 120), note: text(req.body?.auditNote || '', 500) });
    if (profile.auditHistory.length > 100) profile.auditHistory = profile.auditHistory.slice(-100);
    await profile.save();
    return res.json({ ok: true, profile, score, availableLimitCents: Math.max(0, Number(profile.creditLimitCents || 0) - Number(profile.usedLimitCents || 0)) });
  });

  app.get('/api/admin/crediario/perfis/:document/parcelas-atualizadas', adminRequired, async (req, res) => {
    try {
      const document = digits(req.params.document);
      if (!document) return res.status(400).json({ ok: false, error: 'Documento inválido.' });
      const referenceDate = req.query?.date || new Date();
      const installments = await buildUpdatedInstallmentsByDocument(document, referenceDate);
      const summary = installments.reduce((acc, item) => {
        acc.originalCents += Number(item.originalCents || 0);
        acc.fineCents += Number(item.fineCents || 0);
        acc.interestCents += Number(item.interestCents || 0);
        acc.updatedCents += Number(item.updatedCents || 0);
        if (Number(item.daysLate || 0) > 0) acc.overdueCount += 1;
        else acc.openCount += 1;
        return acc;
      }, { originalCents: 0, fineCents: 0, interestCents: 0, updatedCents: 0, overdueCount: 0, openCount: 0 });

      return res.json({
        ok: true,
        document,
        referenceDate: dateOnly(referenceDate),
        finePercent: 2,
        interestPercentMonth: 1,
        summary,
        installments
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Falha ao calcular parcelas atualizadas.' });
    }
  });

  app.get('/api/admin/crediario/perfis/:document/renegociacoes', adminRequired, async (req, res) => {
    const document = digits(req.params.document);
    if (!document) return res.status(400).json({ ok: false, error: 'Documento inválido.' });
    const renegotiations = await Renegotiation.find({ customerDocument: document }).sort({ createdAt: -1 }).limit(100).lean();
    return res.json({ ok: true, renegotiations });
  });

  app.post('/api/admin/crediario/perfis/:document/renegociacoes/preparar', adminRequired, async (req, res) => {
    try {
      const document = digits(req.params.document);
      if (!document) return res.status(400).json({ ok: false, error: 'Documento inválido.' });

      const profile = await Profile.findOne({ document }).lean();
      const referenceDate = req.body?.referenceDate || new Date();
      const installments = await buildUpdatedInstallmentsByDocument(document, referenceDate);
      if (!installments.length) return res.status(409).json({ ok: false, error: 'O cliente não possui parcelas abertas para renegociação.' });

      const originalBalanceCents = installments.reduce((sum, item) => sum + Number(item.originalCents || 0), 0);
      const accumulatedFineCents = installments.reduce((sum, item) => sum + Number(item.fineCents || 0), 0);
      const accumulatedInterestCents = installments.reduce((sum, item) => sum + Number(item.interestCents || 0), 0);
      const updatedBalanceCents = installments.reduce((sum, item) => sum + Number(item.updatedCents || 0), 0);
      const downPaymentCents = Math.min(updatedBalanceCents, Math.max(0, cents(req.body?.downPaymentCents || 0)));
      const negotiatedBalanceCents = Math.max(0, updatedBalanceCents - downPaymentCents);
      const newInstallmentCount = Math.min(48, Math.max(1, Number(req.body?.newInstallmentCount || 1)));
      const firstDueDate = dateOnly(req.body?.firstDueDate);
      if (!firstDueDate) return res.status(400).json({ ok: false, error: 'Informe o primeiro vencimento.' });

      const newSchedule = buildRenegotiationSchedule(negotiatedBalanceCents, newInstallmentCount, firstDueDate);
      const originalContractSnapshot = {
        document,
        customerName: profile?.customerName || '',
        capturedAt: new Date(),
        referenceDate: dateOnly(referenceDate),
        installments
      };

      const renegotiation = await Renegotiation.create({
        renegotiationId: publicId('renegociacao'),
        originalAnalysisId: text(req.body?.originalAnalysisId, 120),
        originalOrderId: text(req.body?.originalOrderId, 120),
        customerDocument: document,
        customerName: profile?.customerName || text(req.body?.customerName, 180),
        status: 'DRAFT',
        referenceDate: dateOnly(referenceDate),
        originalBalanceCents,
        accumulatedFineCents,
        accumulatedInterestCents,
        negotiatedBalanceCents,
        downPaymentCents,
        newInstallmentCount,
        firstDueDate,
        newSchedule,
        newBoletos: [],
        originalContractSnapshot,
        notes: text(req.body?.notes, 3000),
        createdBy: String(req.admin?.id || req.auth?.id || ''),
        history: [{
          action: 'RENEGOTIATION_DRAFT_PREPARED',
          toStatus: 'DRAFT',
          actorId: String(req.admin?.id || req.auth?.id || ''),
          actorName: text(req.admin?.name || 'Administrador', 120),
          metadata: {
            originalBalanceCents,
            accumulatedFineCents,
            accumulatedInterestCents,
            negotiatedBalanceCents,
            downPaymentCents,
            newInstallmentCount,
            firstDueDate
          }
        }]
      });

      await Profile.findOneAndUpdate(
        { document },
        {
          $inc: { renegotiationsCount: 1 },
          $push: {
            auditHistory: {
              action: 'RENEGOTIATION_DRAFT_PREPARED',
              toStatus: profile?.profileStatus || 'ATIVO',
              actorId: String(req.admin?.id || req.auth?.id || ''),
              actorName: text(req.admin?.name || 'Administrador', 120),
              note: `Minuta ${renegotiation.renegotiationId} preparada sem alterar o contrato original.`
            }
          }
        }
      );

      return res.status(201).json({
        ok: true,
        phase: '6.4.8_BASE_PREPARED',
        emissionExecuted: false,
        originalContractPreserved: true,
        renegotiation
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Falha ao preparar renegociação.' });
    }
  });

  app.post('/api/admin/crediario/perfis/:document/recalcular-score', adminRequired, async (req, res) => {
    const document = digits(req.params.document);
    const profile = await Profile.findOne({ document });
    if (!profile) return res.status(404).json({ ok: false, error: 'Perfil financeiro não encontrado.' });
    const score = calculateArianaScore(asObject(profile));
    profile.internalScore = score.score;
    profile.riskLevel = score.riskLevel;
    await profile.save();
    return res.json({ ok: true, profile, score });
  });

  app.patch('/api/admin/crediario/analises/:id/checklist', adminRequired, async (req, res) => {
    const analysis = await Analysis.findOne({ $or: [{ _id: mongoose.Types.ObjectId.isValid(req.params.id) ? new mongoose.Types.ObjectId(req.params.id) : null }, { analysisId: req.params.id }] });
    if (!analysis) return res.status(404).json({ ok: false, error: 'Análise não encontrada.' });
    for (const key of ['cpfChecked','identityDocument','residenceProof','incomeChecked','contactConfirmed','referenceConfirmed']) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) analysis.checklist[key] = Boolean(req.body[key]);
    }
    const profile = analysis.customer?.document ? await Profile.findOne({ document: analysis.customer.document }) : null;
    const suggestion = suggestCreditDecision({ profile: asObject(profile) || {}, financedAmountCents: analysis.financedAmountCents, checklist: analysis.checklist });
    analysis.suggestion = { decision: suggestion.suggestion, reasons: suggestion.reasons, calculatedAt: new Date() };
    analysis.history.push({ action: 'CHECKLIST_UPDATED', toStatus: analysis.status, actorId: String(req.admin?.id || req.auth?.id || ''), actorName: text(req.admin?.name || 'Administrador', 120) });
    await analysis.save();
    return res.json({ ok: true, analysis, suggestion });
  });
}

export { ANALYSIS_STATUSES };
