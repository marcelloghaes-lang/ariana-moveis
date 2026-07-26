// ============================================================
// ROTAS ENTERPRISE - CATALOG SYNC
// Extraído de routes/enterpriseRoutes.js sem alterar endpoints, regras ou respostas.
// ============================================================

export default function registerEnterpriseCatalogSyncRoutes(app, context = {}) {
  const {
    enterpriseCompatAuth,
    adminRequired,
    mongoose,
    baseOptions,
    now,
    enterpriseCompatNumber,
    enterpriseCompatProductPayload,
    Product,
    IntegrationAuditLog,
    redact,
    escapeRegex,
    toJSON
  } = context;

// ============================================================
// PASSO 40 — ENTERPRISE CATALOG SYNC QUEUE
// Sincronização assíncrona de catálogo para fabricantes/distribuidores.
// Mantém /catalog/push legado e adiciona /catalog/sync com fila, histórico e status.
// ============================================================
const enterpriseCatalogSyncJobSchema = new mongoose.Schema({
  jobId: { type: String, unique: true, index: true },
  partnerId: { type: String, index: true },
  partnerObjectId: { type: String, default: '' },
  manufacturer: { type: String, index: true },
  environment: { type: String, default: 'sandbox', index: true },
  source: { type: String, default: 'api' },
  status: { type: String, default: 'queued', index: true },
  statusLabel: { type: String, default: 'Na fila' },
  received: { type: Number, default: 0 },
  createdProducts: { type: Number, default: 0 },
  updatedProducts: { type: Number, default: 0 },
  skippedProducts: { type: Number, default: 0 },
  errorCount: { type: Number, default: 0 },
  errors: [mongoose.Schema.Types.Mixed],
  results: [mongoose.Schema.Types.Mixed],
  payload: mongoose.Schema.Types.Mixed,
  options: mongoose.Schema.Types.Mixed,
  startedAt: Date,
  finishedAt: Date,
  durationMs: { type: Number, default: 0 },
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 3 },
  nextAttemptAt: { type: Date, default: now, index: true },
  lastError: String,
  metadata: mongoose.Schema.Types.Mixed
}, baseOptions);

const EnterpriseCatalogSyncJob = mongoose.models.EnterpriseCatalogSyncJob || mongoose.model('EnterpriseCatalogSyncJob', enterpriseCatalogSyncJobSchema);

function createEnterpriseCatalogSyncJobId() {
  return `SYNC-${Date.now()}-${Math.floor(Math.random() * 9999)}`;
}

function normalizeEnterpriseCatalogSyncItems(body = {}) {
  const items = Array.isArray(body.items) ? body.items : (Array.isArray(body.products) ? body.products : (Array.isArray(body.produtos) ? body.produtos : []));
  return items.filter((item) => item && typeof item === 'object');
}

function validateEnterpriseCatalogItem(item = {}, index = 0) {
  const errors = [];
  const sku = String(item.sku || item.codigo || item.productSku || '').trim();
  const name = String(item.name || item.nome || item.title || '').trim();
  const price = enterpriseCompatNumber(item.price ?? item.preco ?? item.unitPrice, NaN);
  const stock = enterpriseCompatNumber(item.stock ?? item.estoque ?? item.quantity, NaN);

  if (!sku) errors.push('sku_required');
  if (!name && !sku) errors.push('name_required');
  if (!Number.isFinite(price) || price < 0) errors.push('invalid_price');
  if (!Number.isFinite(stock) || stock < 0) errors.push('invalid_stock');

  return { ok: errors.length === 0, index, sku, errors };
}

async function processEnterpriseCatalogSyncJob(jobId = '') {
  const job = await EnterpriseCatalogSyncJob.findOne({ jobId });
  if (!job) return null;
  if (['processing', 'completed'].includes(String(job.status))) return job;

  const startedAt = new Date();
  job.status = 'processing';
  job.statusLabel = 'Processando';
  job.startedAt = startedAt;
  job.attempts = Number(job.attempts || 0) + 1;
  await job.save();

  const items = normalizeEnterpriseCatalogSyncItems(job.payload || {});
  const partner = job.metadata?.partner || {};
  const parent = { ...(job.payload || {}), manufacturer: job.manufacturer };
  const results = [];
  const errors = [];
  let createdProducts = 0;
  let updatedProducts = 0;
  let skippedProducts = 0;

  try {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const validation = validateEnterpriseCatalogItem(item, i);
      if (!validation.ok) {
        skippedProducts += 1;
        errors.push({ index: i, sku: validation.sku || '', errors: validation.errors });
        continue;
      }

      try {
        const payload = enterpriseCompatProductPayload(item, parent, partner);
        payload.sellerId = String(payload.sellerId || job.partnerId || job.manufacturer || 'enterprise').trim();
        payload.sellerName = String(payload.sellerName || job.manufacturer || partner.tradeName || partner.companyName || 'Enterprise').trim();
        payload.metadata = { ...(payload.metadata || {}), enterpriseSyncJobId: job.jobId, enterprisePartnerId: job.partnerId, enterpriseEnvironment: job.environment };

        const filter = { sku: payload.sku, sellerId: payload.sellerId };
        const before = await Product.findOne(filter).lean();
        const product = await Product.findOneAndUpdate(
          filter,
          { $set: payload, $setOnInsert: { createdAt: new Date() } },
          { upsert: true, new: true }
        );

        if (before) updatedProducts += 1;
        else createdProducts += 1;

        results.push({ ok: true, action: before ? 'updated' : 'created', sku: payload.sku, id: String(product._id), price: product.price, stock: product.stock });
      } catch (itemError) {
        skippedProducts += 1;
        errors.push({ index: i, sku: String(item.sku || item.codigo || ''), error: itemError.message || 'item_sync_failed' });
      }
    }

    const finishedAt = new Date();
    job.status = errors.length ? (results.length ? 'completed_with_errors' : 'failed') : 'completed';
    job.statusLabel = errors.length ? (results.length ? 'Concluído com erros' : 'Falhou') : 'Concluído';
    job.createdProducts = createdProducts;
    job.updatedProducts = updatedProducts;
    job.skippedProducts = skippedProducts;
    job.errorCount = errors.length;
    job.errors = errors.slice(0, 500);
    job.results = results.slice(0, 1000);
    job.finishedAt = finishedAt;
    job.durationMs = finishedAt.getTime() - startedAt.getTime();
    job.lastError = errors.length && !results.length ? 'Todos os itens falharam na sincronização' : '';
    await job.save();

    await IntegrationAuditLog.create({
      scope: 'enterprise',
      eventType: 'catalog_sync.completed',
      manufacturer: job.manufacturer,
      integrationId: job.partnerId,
      status: job.status === 'failed' ? 'error' : 'success',
      statusCode: job.status === 'failed' ? 400 : 200,
      message: `Sync ${job.jobId}: ${createdProducts} novos, ${updatedProducts} atualizados, ${errors.length} erro(s)`,
      response: { jobId: job.jobId, received: job.received, createdProducts, updatedProducts, skippedProducts, errors: errors.length },
      metadata: { environment: job.environment, durationMs: job.durationMs }
    }).catch(() => null);

    return job;
  } catch (error) {
    const finishedAt = new Date();
    job.status = Number(job.attempts || 0) < Number(job.maxAttempts || 3) ? 'queued' : 'failed';
    job.statusLabel = job.status === 'queued' ? 'Aguardando nova tentativa' : 'Falhou';
    job.lastError = error.message || 'catalog_sync_failed';
    job.errorCount = Number(job.errorCount || 0) + 1;
    job.errors = [...(job.errors || []), { error: job.lastError, at: new Date() }].slice(-500);
    job.nextAttemptAt = new Date(Date.now() + Math.min(60, Number(job.attempts || 1)) * 60 * 1000);
    job.finishedAt = finishedAt;
    job.durationMs = finishedAt.getTime() - startedAt.getTime();
    await job.save();
    return job;
  }
}

async function processPendingEnterpriseCatalogSyncJobs(limit = 3) {
  const rows = await EnterpriseCatalogSyncJob.find({
    status: { $in: ['queued', 'retry'] },
    nextAttemptAt: { $lte: new Date() }
  }).sort({ createdAt: 1 }).limit(Math.max(1, Number(limit || 3)));
  for (const row of rows) {
    await processEnterpriseCatalogSyncJob(row.jobId);
  }
  return rows.length;
}

app.post('/api/enterprise/catalog/sync', enterpriseCompatAuth, async (req, res) => {
  try {
    const items = normalizeEnterpriseCatalogSyncItems(req.body || {});
    if (!items.length) return res.status(400).json({ ok: false, error: 'Nenhum produto enviado para sincronização' });

    const maxItems = Math.max(1, Number(process.env.ENTERPRISE_CATALOG_SYNC_MAX_ITEMS || 5000));
    if (items.length > maxItems) {
      return res.status(413).json({ ok: false, error: `Limite de ${maxItems} produtos por sincronização excedido`, maxItems });
    }

    const partner = req.enterprisePartner || {};
    const manufacturer = String(req.body?.manufacturer || partner.tradeName || partner.companyName || partner.requestId || 'enterprise').trim();
    const jobId = createEnterpriseCatalogSyncJobId();
    const processNow = req.body?.processNow === true || String(req.query.processNow || '').toLowerCase() === 'true';

    const job = await EnterpriseCatalogSyncJob.create({
      jobId,
      partnerId: partner.requestId || partner.id || manufacturer,
      partnerObjectId: partner.id || '',
      manufacturer,
      environment: partner.environment || 'sandbox',
      source: 'api',
      status: 'queued',
      statusLabel: 'Na fila',
      received: items.length,
      payload: { ...(req.body || {}), items },
      options: { processNow, maxItems },
      metadata: { partner: redact(partner), ip: req.ip, userAgent: req.headers['user-agent'] || '' }
    });

    await IntegrationAuditLog.create({
      scope: 'enterprise',
      eventType: 'catalog_sync.queued',
      manufacturer,
      integrationId: partner.requestId || partner.id || '',
      status: 'success',
      statusCode: 202,
      message: `Sincronização de catálogo enfileirada: ${items.length} produto(s)`,
      request: { total: items.length, sample: redact(items.slice(0, 3)) },
      response: { jobId },
      metadata: { environment: partner.environment || 'sandbox' }
    }).catch(() => null);

    if (processNow || items.length <= Number(process.env.ENTERPRISE_CATALOG_SYNC_INLINE_LIMIT || 50)) {
      processEnterpriseCatalogSyncJob(jobId).catch((error) => console.error('[enterprise catalog sync inline] erro:', error.message || error));
    }

    return res.status(202).json({
      ok: true,
      message: 'Sincronização recebida e enfileirada.',
      jobId,
      status: 'queued',
      received: items.length,
      statusUrl: `/api/enterprise/catalog/sync/${jobId}`
    });
  } catch (error) {
    console.error('[enterprise/catalog/sync] erro:', error.message || error);
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao enfileirar sincronização Enterprise' });
  }
});



// Lista as sincronizações do parceiro Enterprise autenticado.
// IMPORTANTE: esta rota precisa ficar antes de /api/enterprise/catalog/sync/:jobId,
// para a palavra "jobs" não ser interpretada como jobId pelo Express.
app.get('/api/enterprise/catalog/sync/jobs', enterpriseCompatAuth, async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
    const partner = req.enterprisePartner || {};

    const possiblePartnerIds = [
      partner.requestId,
      partner.partnerId,
      partner.id,
      partner._id
    ].map((v) => String(v || '').trim()).filter(Boolean);

    const query = possiblePartnerIds.length
      ? { partnerId: { $in: possiblePartnerIds } }
      : {};

    if (partner.environment !== 'legacy' && !possiblePartnerIds.length) {
      return res.status(403).json({ ok: false, error: 'Parceiro Enterprise inválido para listar sincronizações' });
    }

    if (partner.environment === 'legacy') {
      delete query.partnerId;
    }

    if (req.query.status) query.status = String(req.query.status);
    if (req.query.manufacturer) query.manufacturer = new RegExp(escapeRegex(String(req.query.manufacturer)), 'i');

    const [total, jobs] = await Promise.all([
      EnterpriseCatalogSyncJob.countDocuments(query),
      EnterpriseCatalogSyncJob.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean()
    ]);

    return res.json({
      ok: true,
      total,
      page,
      limit,
      jobs: jobs.map((job) => ({ ...job, id: String(job._id), payload: undefined }))
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar sincronizações Enterprise' });
  }
});

// Consulta um job específico usando a forma /jobs/:jobId.
app.get('/api/enterprise/catalog/sync/jobs/:jobId', enterpriseCompatAuth, async (req, res) => {
  try {
    const jobId = String(req.params.jobId || '').trim();
    const job = await EnterpriseCatalogSyncJob.findOne({ jobId }).lean();
    if (!job) return res.status(404).json({ ok: false, error: 'Sincronização não encontrada' });

    const partner = req.enterprisePartner || {};
    const possiblePartnerIds = [partner.requestId, partner.partnerId, partner.id, partner._id]
      .map((v) => String(v || '').trim())
      .filter(Boolean);
    const allowed = partner.environment === 'legacy' || !job.partnerId || possiblePartnerIds.includes(String(job.partnerId || ''));
    if (!allowed) return res.status(403).json({ ok: false, error: 'Sem permissão para consultar esta sincronização' });

    return res.json({ ok: true, job: { ...job, id: String(job._id), payload: undefined } });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao consultar sincronização' });
  }
});

// Permite o parceiro solicitar nova tentativa de uma sincronização dele.
app.post('/api/enterprise/catalog/sync/jobs/:jobId/retry', enterpriseCompatAuth, async (req, res) => {
  try {
    const jobId = String(req.params.jobId || '').trim();
    const partner = req.enterprisePartner || {};
    const possiblePartnerIds = [partner.requestId, partner.partnerId, partner.id, partner._id]
      .map((v) => String(v || '').trim())
      .filter(Boolean);

    const job = await EnterpriseCatalogSyncJob.findOne({ jobId });
    if (!job) return res.status(404).json({ ok: false, error: 'Sincronização não encontrada' });

    const allowed = partner.environment === 'legacy' || !job.partnerId || possiblePartnerIds.includes(String(job.partnerId || ''));
    if (!allowed) return res.status(403).json({ ok: false, error: 'Sem permissão para retentar esta sincronização' });

    job.status = 'queued';
    job.statusLabel = 'Na fila';
    job.nextAttemptAt = new Date();
    job.lastError = '';
    job.results = [
      ...(Array.isArray(job.results) ? job.results : []),
      { action: 'retry_requested_by_partner', at: new Date(), partnerId: possiblePartnerIds[0] || '' }
    ].slice(-1000);
    await job.save();

    processEnterpriseCatalogSyncJob(jobId).catch((error) => console.error('[enterprise sync retry] erro:', error.message || error));
    return res.json({ ok: true, job: { ...toJSON(job), payload: undefined } });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao retentar sincronização Enterprise' });
  }
});

app.get('/api/enterprise/catalog/sync/:jobId', enterpriseCompatAuth, async (req, res) => {
  try {
    const jobId = String(req.params.jobId || '').trim();
    const job = await EnterpriseCatalogSyncJob.findOne({ jobId }).lean();
    if (!job) return res.status(404).json({ ok: false, error: 'Sincronização não encontrada' });

    const partner = req.enterprisePartner || {};
    const allowed = !job.partnerId || job.partnerId === partner.requestId || job.partnerId === partner.id || partner.environment === 'legacy';
    if (!allowed) return res.status(403).json({ ok: false, error: 'Sem permissão para consultar esta sincronização' });

    return res.json({ ok: true, job: { ...job, id: String(job._id), payload: undefined } });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao consultar sincronização' });
  }
});

app.get('/api/admin/enterprise/catalog/sync-jobs', adminRequired, async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
    const query = {};
    if (req.query.status) query.status = String(req.query.status);
    if (req.query.partnerId) query.partnerId = String(req.query.partnerId);
    if (req.query.manufacturer) query.manufacturer = new RegExp(escapeRegex(String(req.query.manufacturer)), 'i');

    const [total, jobs] = await Promise.all([
      EnterpriseCatalogSyncJob.countDocuments(query),
      EnterpriseCatalogSyncJob.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean()
    ]);

    return res.json({ ok: true, total, page, limit, jobs: jobs.map((job) => ({ ...job, id: String(job._id), payload: undefined })) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar sincronizações Enterprise' });
  }
});

app.post('/api/admin/enterprise/catalog/sync-jobs/:jobId/retry', adminRequired, async (req, res) => {
  try {
    const jobId = String(req.params.jobId || '').trim();
    const job = await EnterpriseCatalogSyncJob.findOneAndUpdate(
      { jobId },
      { $set: { status: 'queued', statusLabel: 'Na fila', nextAttemptAt: new Date(), lastError: '' }, $push: { results: { action: 'retry_requested', at: new Date(), by: req.admin?.email || req.admin?.id || 'admin' } } },
      { new: true }
    );
    if (!job) return res.status(404).json({ ok: false, error: 'Sincronização não encontrada' });
    processEnterpriseCatalogSyncJob(jobId).catch((error) => console.error('[admin enterprise sync retry] erro:', error.message || error));
    return res.json({ ok: true, job: toJSON(job) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao retentar sincronização' });
  }
});


}
