import registerEnterpriseSandboxRoutes from './sandboxRoutes.js';
import registerEnterpriseProductionRoutes from './productionRoutes.js';
// ============================================================
// ROTAS ADMIN ENTERPRISE PRO
// Extraído de routes/enterpriseRoutes.js sem alterar endpoints, regras ou respostas.
// ============================================================

export default function registerEnterpriseAdminProRoutes(app, context = {}) {
  const {
    adminRequired,
    EnterpriseHomologationRequestCompat,
    IntegrationAuditLog,
    ManufacturerDispatchQueue,
    mongoose,
    escapeRegex,
    redact,
    enterpriseCompatRateLimitConfig,
    enterprisePartnerGenerateKey,
    enterpriseOAuthGenerateCredentials
  } = context;

// ============================================================
// PASSO 23 - PORTAL ADMIN ENTERPRISE
// Visão administrativa consolidada de fabricantes, homologação,
// API Keys, consumo, logs, certificados e status da integração.
// Mantém as rotas antigas e adiciona endpoints exclusivos do Admin.
// ============================================================
function adminEnterpriseMaskKey(value = '') {
  const key = String(value || '').trim();
  if (!key) return '';
  if (key.length <= 16) return `${key.slice(0, 4)}...${key.slice(-4)}`;
  return `${key.slice(0, 12)}...${key.slice(-8)}`;
}

function adminEnterpriseCredentialFromPartner(partner = {}, environment = 'sandbox') {
  const env = String(environment || 'sandbox').toLowerCase() === 'production' ? 'production' : 'sandbox';
  if (env === 'production') {
    return partner.productionCredentials || partner.production || partner.credentials?.production || {};
  }
  return partner.sandboxCredentials || partner.sandbox || partner.credentials?.sandbox || {};
}

function adminEnterprisePartnerDTO(partner = {}, extra = {}) {
  const obj = typeof partner.toObject === 'function' ? partner.toObject({ virtuals: true }) : { ...(partner || {}) };
  const sandbox = adminEnterpriseCredentialFromPartner(obj, 'sandbox');
  const production = adminEnterpriseCredentialFromPartner(obj, 'production');
  const id = String(obj._id || obj.id || '');
  return {
    id,
    requestId: obj.requestId || obj.protocol || id,
    companyName: obj.companyName || obj.razaoSocial || obj.company || '',
    tradeName: obj.tradeName || obj.nomeFantasia || obj.fantasyName || '',
    cnpj: obj.cnpj || obj.document || '',
    email: obj.email || obj.responsibleEmail || '',
    phone: obj.phone || obj.responsiblePhone || '',
    responsibleName: obj.responsibleName || obj.responsavel || '',
    erp: obj.erp || obj.erpName || 'Outro',
    status: obj.status || 'pending',
    statusLabel: obj.statusLabel || obj.status || 'pending',
    environment: obj.environment || (production?.active ? 'production' : (sandbox?.active ? 'sandbox' : 'pending')),
    integrationTypes: obj.integrationTypes || obj.integrations || obj.modules || [],
    createdAt: obj.createdAt || null,
    updatedAt: obj.updatedAt || null,
    sandbox: {
      active: sandbox?.active !== false && Boolean(sandbox?.apiKey || obj.apiKeySandbox || obj.sandboxApiKey),
      apiKeyMasked: adminEnterpriseMaskKey(sandbox?.apiKey || obj.apiKeySandbox || obj.sandboxApiKey || ''),
      requestCount: Number(sandbox?.requestCount || 0),
      lastAccessAt: sandbox?.lastAccessAt || null,
      rotatedAt: sandbox?.rotatedAt || null,
      revokedAt: sandbox?.revokedAt || null
    },
    production: {
      active: production?.active === true && Boolean(production?.apiKey || obj.enterpriseApiKey || obj.apiKey),
      apiKeyMasked: adminEnterpriseMaskKey(production?.apiKey || obj.enterpriseApiKey || obj.apiKey || ''),
      requestCount: Number(production?.requestCount || 0),
      lastAccessAt: production?.lastAccessAt || null,
      rotatedAt: production?.rotatedAt || null,
      revokedAt: production?.revokedAt || null
    },
    rateLimit: {
      sandbox: enterpriseCompatRateLimitConfig(obj, sandbox, 'sandbox'),
      production: enterpriseCompatRateLimitConfig(obj, production, 'production')
    },
    oauth: {
      sandbox: {
        active: (obj.oauth?.sandbox?.active !== false) && Boolean(obj.oauth?.sandbox?.clientId || sandbox?.oauth?.clientId || obj.credentials?.sandbox?.oauth?.clientId),
        clientId: obj.oauth?.sandbox?.clientId || sandbox?.oauth?.clientId || obj.credentials?.sandbox?.oauth?.clientId || '',
        clientIdMasked: adminEnterpriseMaskKey(obj.oauth?.sandbox?.clientId || sandbox?.oauth?.clientId || obj.credentials?.sandbox?.oauth?.clientId || ''),
        createdAt: obj.oauth?.sandbox?.createdAt || sandbox?.oauth?.createdAt || null
      },
      production: {
        active: (obj.oauth?.production?.active !== false) && Boolean(obj.oauth?.production?.clientId || production?.oauth?.clientId || obj.credentials?.production?.oauth?.clientId),
        clientId: obj.oauth?.production?.clientId || production?.oauth?.clientId || obj.credentials?.production?.oauth?.clientId || '',
        clientIdMasked: adminEnterpriseMaskKey(obj.oauth?.production?.clientId || production?.oauth?.clientId || obj.credentials?.production?.oauth?.clientId || ''),
        createdAt: obj.oauth?.production?.createdAt || production?.oauth?.createdAt || null
      }
    },
    metrics: extra.metrics || { calls: 0, success: 0, errors: 0, successRate: 0, avgMs: 0, lastEventAt: null, lastEventType: '' },
    certificates: extra.certificates || []
  };
}

function adminEnterprisePartnerMatchQuery(search = '') {
  const q = String(search || '').trim();
  if (!q) return {};
  const re = new RegExp(escapeRegex(q), 'i');
  return { $or: [{ companyName: re }, { tradeName: re }, { requestId: re }, { cnpj: re }, { email: re }, { status: re }] };
}

function adminEnterprisePartnerLogQuery(partner = {}) {
  const dto = adminEnterprisePartnerDTO(partner);
  const ors = [];
  [dto.requestId, dto.companyName, dto.tradeName, dto.cnpj, dto.id].filter(Boolean).forEach((v) => {
    ors.push({ manufacturer: v });
    ors.push({ orderId: v });
    ors.push({ integrationId: v });
    ors.push({ 'metadata.requestId': v });
    ors.push({ 'metadata.companyName': v });
    ors.push({ 'metadata.tradeName': v });
    ors.push({ 'metadata.partnerId': v });
  });
  return ors.length ? { scope: 'enterprise', $or: ors } : { scope: 'enterprise' };
}

async function adminEnterpriseMetricsForPartner(partner = {}, days = 30) {
  const since = new Date(Date.now() - Math.max(1, Number(days || 30)) * 24 * 60 * 60 * 1000);
  const query = { ...adminEnterprisePartnerLogQuery(partner), createdAt: { $gte: since } };
  const logs = await IntegrationAuditLog.find(query).sort({ createdAt: -1 }).limit(2000).lean().catch(() => []);
  const calls = logs.length;
  const success = logs.filter((l) => Number(l.statusCode || l.response?.status || 0) < 400 || String(l.status || '').toLowerCase() === 'success').length;
  const errors = logs.filter((l) => Number(l.statusCode || l.response?.status || 0) >= 400 || String(l.status || '').toLowerCase() === 'error').length;
  let totalMs = 0;
  let timed = 0;
  const byEndpoint = {};
  const byStatus = { ok2xx: 0, bad4xx: 0, err5xx: 0, other: 0 };
  for (const log of logs) {
    const code = Number(log.statusCode || log.response?.status || 0);
    if (code >= 200 && code < 300) byStatus.ok2xx += 1;
    else if (code >= 400 && code < 500) byStatus.bad4xx += 1;
    else if (code >= 500) byStatus.err5xx += 1;
    else byStatus.other += 1;
    const ms = Number(log.metadata?.durationMs || log.metadata?.totalMs || log.response?.durationMs || 0);
    if (ms > 0) { totalMs += ms; timed += 1; }
    const endpoint = String(log.metadata?.endpoint || log.metadata?.path || log.request?.path || log.eventType || 'unknown');
    byEndpoint[endpoint] = (byEndpoint[endpoint] || 0) + 1;
  }
  return {
    calls,
    success,
    errors,
    successRate: calls ? Math.round((success / calls) * 10000) / 100 : 0,
    avgMs: timed ? Math.round(totalMs / timed) : 0,
    lastEventAt: logs[0]?.createdAt || null,
    lastEventType: logs[0]?.eventType || '',
    byStatus,
    byEndpoint: Object.entries(byEndpoint).map(([endpoint, count]) => ({ endpoint, count })).sort((a, b) => b.count - a.count).slice(0, 20)
  };
}

app.get('/api/admin/enterprise/pro/overview', adminRequired, async (req, res) => {
  try {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [partnersTotal, pending, sandbox, production, logs24h, errors24h, queuePending, queueDead] = await Promise.all([
      EnterpriseHomologationRequestCompat.countDocuments({}).catch(() => 0),
      EnterpriseHomologationRequestCompat.countDocuments({ status: { $in: ['pending', 'in_review', 'aguardando', 'aguardando_analise'] } }).catch(() => 0),
      EnterpriseHomologationRequestCompat.countDocuments({ $or: [{ status: 'sandbox' }, { 'sandboxCredentials.active': true }, { 'sandbox.active': true }, { apiKeySandbox: { $exists: true, $ne: '' } }] }).catch(() => 0),
      EnterpriseHomologationRequestCompat.countDocuments({ $or: [{ status: { $in: ['production', 'active'] } }, { 'productionCredentials.active': true }, { 'production.active': true }, { enterpriseApiKey: { $exists: true, $ne: '' } }] }).catch(() => 0),
      IntegrationAuditLog.countDocuments({ scope: 'enterprise', createdAt: { $gte: since24h } }).catch(() => 0),
      IntegrationAuditLog.countDocuments({ scope: 'enterprise', createdAt: { $gte: since24h }, $or: [{ status: 'error' }, { statusCode: { $gte: 400 } }] }).catch(() => 0),
      ManufacturerDispatchQueue.countDocuments({ status: { $in: ['pending', 'retry'] }, deadLetter: { $ne: true } }).catch(() => 0),
      ManufacturerDispatchQueue.countDocuments({ $or: [{ status: 'dead_letter' }, { deadLetter: true }] }).catch(() => 0)
    ]);

    const recentLogs = await IntegrationAuditLog.find({ scope: 'enterprise' }).sort({ createdAt: -1 }).limit(10).lean().catch(() => []);
    const recentPartners = await EnterpriseHomologationRequestCompat.find({}).sort({ updatedAt: -1, createdAt: -1 }).limit(8).lean().catch(() => []);

    return res.json({
      ok: true,
      summary: { partnersTotal, pending, sandbox, production, logs24h, errors24h, queuePending, queueDead, successRate24h: logs24h ? Math.round(((logs24h - errors24h) / logs24h) * 10000) / 100 : 0 },
      recentLogs: recentLogs.map((l) => ({ id: String(l._id), eventType: l.eventType, manufacturer: l.manufacturer, status: l.status, statusCode: l.statusCode, message: l.message, createdAt: l.createdAt })),
      recentPartners: recentPartners.map((p) => adminEnterprisePartnerDTO(p))
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar overview Enterprise' });
  }
});

app.get('/api/admin/enterprise/pro/partners', adminRequired, async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const status = String(req.query.status || '').trim();
    const query = adminEnterprisePartnerMatchQuery(req.query.q || '');
    if (status) query.status = status;
    const [total, docs] = await Promise.all([
      EnterpriseHomologationRequestCompat.countDocuments(query).catch(() => 0),
      EnterpriseHomologationRequestCompat.find(query).sort({ updatedAt: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean().catch(() => [])
    ]);
    const partners = [];
    for (const doc of docs) {
      const metrics = await adminEnterpriseMetricsForPartner(doc, Number(req.query.days || 30));
      partners.push(adminEnterprisePartnerDTO(doc, { metrics }));
    }
    return res.json({ ok: true, page, limit, total, pages: Math.max(1, Math.ceil(total / limit)), partners });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar fabricantes Enterprise' });
  }
});

app.get('/api/admin/enterprise/pro/partners/:id', adminRequired, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { requestId: id };
    const doc = await EnterpriseHomologationRequestCompat.findOne(query).lean();
    if (!doc) return res.status(404).json({ ok: false, error: 'Fabricante não encontrado' });
    const [metrics, logs, queue] = await Promise.all([
      adminEnterpriseMetricsForPartner(doc, Number(req.query.days || 30)),
      IntegrationAuditLog.find(adminEnterprisePartnerLogQuery(doc)).sort({ createdAt: -1 }).limit(25).lean().catch(() => []),
      ManufacturerDispatchQueue.find({ manufacturer: { $in: [doc.requestId, doc.tradeName, doc.companyName].filter(Boolean) } }).sort({ updatedAt: -1, createdAt: -1 }).limit(20).lean().catch(() => [])
    ]);
    return res.json({
      ok: true,
      partner: adminEnterprisePartnerDTO(doc, { metrics }),
      raw: redact(doc),
      logs: logs.map((l) => ({ id: String(l._id), eventType: l.eventType, manufacturer: l.manufacturer, status: l.status, statusCode: l.statusCode, message: l.message, createdAt: l.createdAt, metadata: redact(l.metadata || {}) })),
      queue: queue.map((q) => ({ id: String(q._id), queueId: q.queueId, orderId: q.orderId, manufacturer: q.manufacturer, status: q.status, attempts: q.attempts, deadLetter: q.deadLetter, lastError: q.lastError, updatedAt: q.updatedAt }))
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar fabricante Enterprise' });
  }
});

app.get('/api/admin/enterprise/pro/partners/:id/logs', adminRequired, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const queryPartner = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { requestId: id };
    const partner = await EnterpriseHomologationRequestCompat.findOne(queryPartner).lean();
    if (!partner) return res.status(404).json({ ok: false, error: 'Fabricante não encontrado' });
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const query = adminEnterprisePartnerLogQuery(partner);
    if (req.query.status) {
      const status = String(req.query.status);
      if (status === '2xx') query.statusCode = { $gte: 200, $lt: 300 };
      else if (status === '4xx') query.statusCode = { $gte: 400, $lt: 500 };
      else if (status === '5xx') query.statusCode = { $gte: 500 };
    }
    if (req.query.q) {
      const re = new RegExp(escapeRegex(String(req.query.q)), 'i');
      query.$and = [{ $or: [{ eventType: re }, { message: re }, { manufacturer: re }, { orderId: re }] }];
    }
    const [total, logs] = await Promise.all([
      IntegrationAuditLog.countDocuments(query).catch(() => 0),
      IntegrationAuditLog.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean().catch(() => [])
    ]);
    return res.json({ ok: true, page, limit, total, pages: Math.max(1, Math.ceil(total / limit)), logs: logs.map((l) => ({ id: String(l._id), eventType: l.eventType, status: l.status, statusCode: l.statusCode, message: l.message, createdAt: l.createdAt, metadata: redact(l.metadata || {}), request: redact(l.request || {}), response: redact(l.response || {}) })) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar logs do fabricante' });
  }
});

app.post('/api/admin/enterprise/pro/partners/:id/status', adminRequired, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const status = String(req.body?.status || '').trim();
    const allowed = ['pending', 'in_review', 'sandbox', 'approved', 'production', 'active', 'rejected'];
    if (!allowed.includes(status)) return res.status(400).json({ ok: false, error: 'Status inválido' });
    const query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { requestId: id };
    const doc = await EnterpriseHomologationRequestCompat.findOneAndUpdate(query, { $set: { status, statusLabel: status, environment: status === 'production' || status === 'active' ? 'production' : (status === 'sandbox' || status === 'approved' ? 'sandbox' : 'pending') }, $push: { history: { status, at: new Date(), by: req.admin?.email || req.admin?.id || 'admin', source: 'admin_enterprise_pro' } } }, { new: true });
    if (!doc) return res.status(404).json({ ok: false, error: 'Fabricante não encontrado' });
    await IntegrationAuditLog.create({ scope: 'enterprise', eventType: 'admin_partner_status_changed', manufacturer: doc.requestId || doc.tradeName || doc.companyName || '', status: 'success', statusCode: 200, message: `Status Enterprise alterado para ${status}`, metadata: { status, admin: req.admin?.email || req.admin?.id || '' } }).catch(() => null);
    return res.json({ ok: true, partner: adminEnterprisePartnerDTO(doc), message: 'Status atualizado' });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao alterar status' });
  }
});

app.post('/api/admin/enterprise/pro/partners/:id/api-keys/:environment/rotate', adminRequired, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const environment = String(req.params.environment || 'sandbox').toLowerCase() === 'production' ? 'production' : 'sandbox';
    const query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { requestId: id };
    const partner = await EnterpriseHomologationRequestCompat.findOne(query);
    if (!partner) return res.status(404).json({ ok: false, error: 'Fabricante não encontrado' });
    const key = enterprisePartnerGenerateKey(environment, partner);
    const path = enterprisePartnerEnvironmentPath(environment);
    const set = {
      [`${path}.apiKey`]: key,
      [`${path}.active`]: true,
      [`${path}.environment`]: environment,
      [`${path}.rotatedAt`]: new Date(),
      [`${path}.lastAccessAt`]: null,
      [`${path}.requestCount`]: 0
    };
    if (environment === 'sandbox') Object.assign(set, { 'sandbox.apiKey': key, 'sandbox.active': true, 'credentials.sandbox.apiKey': key, 'credentials.sandbox.active': true, apiKeySandbox: key, sandboxApiKey: key, status: partner.status || 'sandbox', environment: 'sandbox' });
    else Object.assign(set, { 'production.apiKey': key, 'production.active': true, 'credentials.production.apiKey': key, 'credentials.production.active': true, enterpriseApiKey: key, apiKey: key, status: 'production', environment: 'production' });
    await EnterpriseHomologationRequestCompat.updateOne({ _id: partner._id }, { $set: set, $push: { history: { status: `${environment}_key_rotated`, at: new Date(), by: req.admin?.email || req.admin?.id || 'admin', source: 'admin_enterprise_pro' } } });
    await IntegrationAuditLog.create({ scope: 'enterprise', eventType: 'admin_api_key_rotated', manufacturer: partner.requestId || partner.tradeName || partner.companyName || '', status: 'success', statusCode: 200, message: `API Key ${environment} renovada pelo Admin Enterprise`, metadata: { environment, admin: req.admin?.email || req.admin?.id || '' } }).catch(() => null);
    return res.json({ ok: true, environment, apiKey: key, message: 'API Key renovada' });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao renovar chave' });
  }
});

app.post('/api/admin/enterprise/pro/partners/:id/api-keys/:environment/revoke', adminRequired, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const environment = String(req.params.environment || 'sandbox').toLowerCase() === 'production' ? 'production' : 'sandbox';
    const query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { requestId: id };
    const partner = await EnterpriseHomologationRequestCompat.findOne(query);
    if (!partner) return res.status(404).json({ ok: false, error: 'Fabricante não encontrado' });
    const path = enterprisePartnerEnvironmentPath(environment);
    const set = { [`${path}.active`]: false, [`${path}.revokedAt`]: new Date() };
    if (environment === 'sandbox') Object.assign(set, { 'sandbox.active': false, 'credentials.sandbox.active': false });
    else Object.assign(set, { 'production.active': false, 'credentials.production.active': false });
    await EnterpriseHomologationRequestCompat.updateOne({ _id: partner._id }, { $set: set, $push: { history: { status: `${environment}_key_revoked`, at: new Date(), by: req.admin?.email || req.admin?.id || 'admin', source: 'admin_enterprise_pro' } } });
    await IntegrationAuditLog.create({ scope: 'enterprise', eventType: 'admin_api_key_revoked', manufacturer: partner.requestId || partner.tradeName || partner.companyName || '', status: 'success', statusCode: 200, message: `API Key ${environment} revogada pelo Admin Enterprise`, metadata: { environment, admin: req.admin?.email || req.admin?.id || '' } }).catch(() => null);
    return res.json({ ok: true, environment, message: 'API Key revogada' });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao revogar chave' });
  }
});



// ============================================================
// PASSO 24 - HOMOLOGAÇÃO AUTOMÁTICA ENTERPRISE
// Executa/registre checklist de homologação por fabricante e libera produção.
// ============================================================
const ENTERPRISE_HOMOLOGATION_STEPS = [
  { key: 'catalog', label: 'Catálogo', eventType: 'homologation_catalog', weight: 10 },
  { key: 'stock', label: 'Estoque', eventType: 'homologation_stock', weight: 10 },
  { key: 'price', label: 'Preço', eventType: 'homologation_price', weight: 10 },
  { key: 'order', label: 'Pedido', eventType: 'homologation_order', weight: 15 },
  { key: 'invoice', label: 'NF-e', eventType: 'homologation_invoice', weight: 10 },
  { key: 'xml', label: 'XML', eventType: 'homologation_xml', weight: 10 },
  { key: 'danfe', label: 'DANFE', eventType: 'homologation_danfe', weight: 10 },
  { key: 'tracking', label: 'Rastreio', eventType: 'homologation_tracking', weight: 10 },
  { key: 'webhook', label: 'Webhook', eventType: 'homologation_webhook', weight: 10 },
  { key: 'cancelation', label: 'Cancelamento', eventType: 'homologation_cancelation', weight: 3 },
  { key: 'return', label: 'Devolução', eventType: 'homologation_return', weight: 2 }
];

function adminEnterpriseDefaultHomologation(partner = {}) {
  const raw = partner.homologation || partner.enterpriseHomologation || {};
  const storedSteps = raw.steps || {};
  const steps = ENTERPRISE_HOMOLOGATION_STEPS.map((step) => {
    const current = storedSteps[step.key] || {};
    return {
      ...step,
      status: current.status || 'pending',
      statusLabel: current.statusLabel || 'Não testado',
      passed: current.passed === true,
      httpStatus: current.httpStatus || null,
      durationMs: current.durationMs || 0,
      message: current.message || '',
      testedAt: current.testedAt || null
    };
  });
  const approved = steps.filter((step) => step.passed).length;
  const score = Math.round((steps.reduce((sum, step) => sum + (step.passed ? Number(step.weight || 0) : 0), 0) / Math.max(1, ENTERPRISE_HOMOLOGATION_STEPS.reduce((sum, step) => sum + Number(step.weight || 0), 0))) * 100);
  return {
    status: raw.status || (score >= 100 ? 'approved' : 'pending'),
    statusLabel: raw.statusLabel || (score >= 100 ? 'Homologação aprovada' : 'Aguardando homologação'),
    score,
    approved,
    total: steps.length,
    startedAt: raw.startedAt || null,
    completedAt: raw.completedAt || null,
    lastRunAt: raw.lastRunAt || null,
    steps
  };
}


// PASSO 25 FIX - Sincroniza a homologação pelo histórico de logs.
// Se o checklist não estiver gravado no documento, mas os logs comprovarem
// que a homologação 100% já foi executada, reconstruímos o estado aprovado
// e persistimos no MongoDB. Isso evita bloquear a liberação de produção.
async function adminEnterpriseResolvedHomologation(partner = {}) {
  const current = adminEnterpriseDefaultHomologation(partner);
  if (Number(current.score || 0) >= 100) return current;

  try {
    const partnerId = String(partner._id || '');
    const manufacturerKeys = [partner.requestId, partner.tradeName, partner.companyName, partner.cnpj, partner.email]
      .map((v) => String(v || '').trim())
      .filter(Boolean);

    const or = [];
    if (partnerId) or.push({ integrationId: partnerId }, { 'metadata.partnerId': partnerId });
    for (const key of manufacturerKeys) {
      or.push({ manufacturer: key }, { 'metadata.requestId': key }, { 'metadata.companyName': key }, { 'metadata.tradeName': key });
    }
    if (!or.length) return current;

    const eventTypes = ENTERPRISE_HOMOLOGATION_STEPS.map((step) => step.eventType);
    const logs = await IntegrationAuditLog.find({
      scope: 'enterprise',
      eventType: { $in: eventTypes.concat(['homologation_completed']) },
      $or: or
    }).sort({ createdAt: -1 }).limit(80).lean().catch(() => []);

    const byEvent = new Map();
    for (const log of logs) {
      if (!byEvent.has(log.eventType) && Number(log.statusCode || 0) < 400) byEvent.set(log.eventType, log);
    }

    const completedLog = byEvent.get('homologation_completed');
    const allStepsPassed = ENTERPRISE_HOMOLOGATION_STEPS.every((step) => byEvent.has(step.eventType));
    if (!completedLog && !allStepsPassed) return current;

    const nowDate = completedLog?.createdAt || new Date();
    const stepsObject = {};
    for (const step of ENTERPRISE_HOMOLOGATION_STEPS) {
      const log = byEvent.get(step.eventType) || completedLog || {};
      stepsObject[step.key] = {
        key: step.key,
        label: step.label,
        status: 'approved',
        statusLabel: 'Aprovado',
        passed: true,
        httpStatus: Number(log.statusCode || (['catalog', 'order'].includes(step.key) ? 201 : 200)),
        durationMs: Number(log.metadata?.durationMs || 0),
        message: log.message || `${step.label} validado com sucesso`,
        testedAt: log.createdAt || nowDate
      };
    }

    const homologation = {
      status: 'approved',
      statusLabel: 'Homologação aprovada',
      score: 100,
      approved: ENTERPRISE_HOMOLOGATION_STEPS.length,
      total: ENTERPRISE_HOMOLOGATION_STEPS.length,
      startedAt: current.startedAt || nowDate,
      completedAt: nowDate,
      lastRunAt: nowDate,
      steps: stepsObject,
      report: {
        ok: true,
        source: 'admin_enterprise_log_sync',
        syncedAt: new Date(),
        syncedBy: 'system'
      }
    };

    if (partner._id) {
      await EnterpriseHomologationRequestCompat.updateOne(
        { _id: partner._id },
        {
          $set: {
            homologation,
            enterpriseHomologation: homologation,
            status: partner.status === 'production' ? 'production' : 'approved',
            statusLabel: partner.status === 'production' ? (partner.statusLabel || 'Produção liberada') : 'Homologação aprovada',
            environment: partner.environment === 'production' ? 'production' : 'sandbox'
          },
          $push: {
            history: { status: 'homologation_synced_from_logs', at: new Date(), by: 'system', source: 'admin_enterprise_pro' }
          }
        }
      ).catch(() => null);
    }

    return adminEnterpriseDefaultHomologation({ homologation });
  } catch (_error) {
    return current;
  }
}

async function adminEnterpriseFindPartnerOr404(id = '') {
  const value = String(id || '').trim();
  const query = mongoose.Types.ObjectId.isValid(value) ? { _id: value } : { requestId: value };
  return EnterpriseHomologationRequestCompat.findOne(query);
}

async function adminEnterpriseSaveHomologationLog(partner = {}, step = {}, statusCode = 200, durationMs = 0, message = '') {
  return IntegrationAuditLog.create({
    scope: 'enterprise',
    eventType: step.eventType || 'homologation_step',
    manufacturer: partner.requestId || partner.tradeName || partner.companyName || '',
    integrationId: String(partner._id || ''),
    status: statusCode >= 400 ? 'error' : 'success',
    statusCode,
    message: message || `${step.label} aprovado na homologação automática`,
    metadata: {
      partnerId: String(partner._id || ''),
      requestId: partner.requestId || '',
      companyName: partner.companyName || '',
      tradeName: partner.tradeName || '',
      endpoint: step.key,
      homologationStep: step.key,
      durationMs,
      source: 'admin_enterprise_homologation_auto'
    }
  }).catch(() => null);
}

// ============================================================
// ENTERPRISE SANDBOX / HOMOLOGATION ROUTES
// Extraído para routes/enterprise/sandboxRoutes.js sem alterar endpoints.
// ============================================================
registerEnterpriseSandboxRoutes(app, {
  ...context,
  adminRequired,
  crypto,
  EnterpriseHomologationRequestCompat,
  IntegrationAuditLog,
  adminEnterpriseFindPartnerOr404,
  adminEnterpriseResolvedHomologation,
  adminEnterpriseSaveHomologationLog,
  adminEnterpriseDefaultHomologation,
  adminEnterprisePartnerDTO,
  ENTERPRISE_HOMOLOGATION_STEPS
});



// ============================================================
// ENTERPRISE PRODUCTION ROUTES
// Extraído para routes/enterprise/productionRoutes.js sem alterar endpoints.
// ============================================================
registerEnterpriseProductionRoutes(app, {
  ...context,
  adminRequired,
  EnterpriseHomologationRequestCompat,
  IntegrationAuditLog,
  adminEnterpriseFindPartnerOr404,
  adminEnterpriseResolvedHomologation,
  adminEnterprisePartnerDTO,
  enterprisePartnerGenerateKey
});





// ============================================================
// PASSO 26 - ADMIN RATE LIMIT ENTERPRISE
// Configura limites por fabricante e ambiente.
// ============================================================
app.post('/api/admin/enterprise/pro/partners/:id/rate-limit', adminRequired, async (req, res) => {
  try {
    const partner = await adminEnterpriseFindPartnerOr404(req.params.id);
    if (!partner) return res.status(404).json({ ok: false, error: 'Fabricante não encontrado' });
    const environment = String(req.body?.environment || 'sandbox').toLowerCase() === 'production' ? 'production' : 'sandbox';
    const requestsPerMinute = Math.max(1, Number(req.body?.requestsPerMinute || req.body?.perMinute || 300));
    const requestsPerDay = Math.max(1, Number(req.body?.requestsPerDay || req.body?.perDay || 20000));
    const requestsPerHour = Math.max(requestsPerMinute, Number(req.body?.requestsPerHour || req.body?.perHour || requestsPerMinute * 60));
    const burst = Math.max(1, Number(req.body?.burst || requestsPerMinute));
    const rateLimit = { requestsPerMinute, requestsPerHour, requestsPerDay, burst, updatedAt: new Date(), updatedBy: req.admin?.email || req.admin?.id || 'admin' };
    const prefix = environment === 'production' ? 'productionCredentials' : 'sandboxCredentials';
    const legacyPrefix = environment === 'production' ? 'production' : 'sandbox';
    await EnterpriseHomologationRequestCompat.updateOne(
      { _id: partner._id },
      {
        $set: {
          [`${prefix}.rateLimit`]: rateLimit,
          [`${legacyPrefix}.rateLimit`]: rateLimit,
          [`credentials.${environment}.rateLimit`]: rateLimit,
          [`rateLimit.${environment}`]: rateLimit
        },
        $push: {
          history: { status: 'rate_limit_updated', environment, rateLimit, at: new Date(), by: req.admin?.email || req.admin?.id || 'admin', source: 'admin_enterprise_pro' }
        }
      }
    );
    await IntegrationAuditLog.create({
      scope: 'enterprise',
      eventType: 'rate_limit_updated',
      manufacturer: partner.requestId || partner.tradeName || partner.companyName || '',
      integrationId: String(partner._id || ''),
      status: 'success',
      statusCode: 200,
      message: `Rate limit ${environment} atualizado pelo Admin`,
      metadata: { environment, rateLimit, partnerId: String(partner._id || ''), admin: req.admin?.email || req.admin?.id || '' }
    }).catch(() => null);
    return res.json({ ok: true, environment, rateLimit, message: 'Rate limit atualizado com sucesso' });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao atualizar rate limit' });
  }
});

// ============================================================
// PASSO 25 - PRODUÇÃO ENTERPRISE
// Gestão completa de liberação, suspensão e reativação de produção.
// ============================================================

app.post('/api/admin/enterprise/pro/partners/:id/oauth/:environment/rotate', adminRequired, async (req, res) => {
  try {
    const environment = String(req.params.environment || 'sandbox').toLowerCase() === 'production' ? 'production' : 'sandbox';
    const partner = await EnterpriseHomologationRequestCompat.findById(req.params.id);
    if (!partner) return res.status(404).json({ ok: false, error: 'Fabricante não encontrado' });
    if (environment === 'production') {
      const prodActive = partner.productionCredentials?.active !== false && (partner.productionActive === true || String(partner.environment || '').toLowerCase() === 'production' || String(partner.status || '').toLowerCase() === 'production');
      if (!prodActive) return res.status(403).json({ ok: false, error: 'Libere Produção antes de gerar OAuth de produção' });
    }
    const oauth = enterpriseOAuthGenerateCredentials(partner, environment);
    const scopes = Array.isArray(req.body?.scopes) && req.body.scopes.length ? req.body.scopes : (partner.integrationTypes || ['catalog','stock','price','orders','invoice','tracking','webhooks']);
    oauth.scopes = scopes;
    await EnterpriseHomologationRequestCompat.updateOne({ _id: partner._id }, { $set: { [`oauth.${environment}`]: oauth, [`${environment}Credentials.oauth`]: oauth, [`credentials.${environment}.oauth`]: oauth }, $push: { history: { status: 'oauth_rotated', environment, at: new Date(), by: req.admin?.email || req.admin?.id || 'admin' } } });
    await IntegrationAuditLog.create({ scope: 'enterprise', eventType: 'oauth_credentials_rotated', manufacturer: partner.requestId || partner.tradeName || partner.companyName || '', integrationId: String(partner._id || ''), status: 'success', statusCode: 200, message: `OAuth ${environment} gerado pelo Admin Enterprise`, metadata: { environment, clientId: oauth.clientId, admin: req.admin?.email || req.admin?.id || '' } }).catch(() => null);
    return res.json({ ok: true, environment, oauth, message: 'Credenciais OAuth geradas com sucesso' });
  } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Erro ao gerar OAuth' }); }
});

app.post('/api/admin/enterprise/pro/partners/:id/oauth/:environment/revoke', adminRequired, async (req, res) => {
  try {
    const environment = String(req.params.environment || 'sandbox').toLowerCase() === 'production' ? 'production' : 'sandbox';
    const partner = await EnterpriseHomologationRequestCompat.findById(req.params.id);
    if (!partner) return res.status(404).json({ ok: false, error: 'Fabricante não encontrado' });
    await EnterpriseHomologationRequestCompat.updateOne({ _id: partner._id }, { $set: { [`oauth.${environment}.active`]: false, [`${environment}Credentials.oauth.active`]: false, [`credentials.${environment}.oauth.active`]: false }, $push: { history: { status: 'oauth_revoked', environment, at: new Date(), by: req.admin?.email || req.admin?.id || 'admin' } } });
    await IntegrationAuditLog.create({ scope: 'enterprise', eventType: 'oauth_credentials_revoked', manufacturer: partner.requestId || partner.tradeName || partner.companyName || '', integrationId: String(partner._id || ''), status: 'success', statusCode: 200, message: `OAuth ${environment} revogado pelo Admin Enterprise`, metadata: { environment, admin: req.admin?.email || req.admin?.id || '' } }).catch(() => null);
    return res.json({ ok: true, environment, message: 'Credenciais OAuth revogadas' });
  } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Erro ao revogar OAuth' }); }
});






}
