import express from 'express';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { ok, fail } from '../utils/http.js';
import {
  listIntegrations,
  upsertIntegration,
  enqueueManufacturerOrder,
  dispatchQueueItem,
  registerWebhookEvent,
  listEnterpriseProducts,
  upsertEnterpriseProduct,
  updateEnterpriseStock,
  updateEnterprisePrice,
  syncEnterpriseProductState,
  bulkEnterpriseProductState,
  listEnterpriseProductSyncHistory,
  bulkEnterpriseStock,
  bulkEnterprisePrices,
  bulkEnterpriseProducts,
  syncEnterpriseCatalog,
  getEnterpriseCatalogSummary,
  listEnterpriseOrders,
  receiveEnterpriseOrder,
  updateEnterpriseOrderStatus,
  updateEnterpriseOrderTracking,
  attachEnterpriseInvoice,
  listEnterpriseLogs,
  listEnterpriseQueue,
  getEnterpriseDashboard
} from '../services/manufacturerService.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'ariana_enterprise_secret';

// ============================================================
// ETAPA 10 - Solicitações públicas de homologação Enterprise
// ============================================================
const homologationRequestSchema = new mongoose.Schema({
  requestId: { type: String, unique: true, index: true },
  companyName: { type: String, required: true, index: true },
  tradeName: String,
  cnpj: { type: String, index: true },
  website: String,
  responsibleName: { type: String, required: true },
  responsibleRole: String,
  email: { type: String, required: true, index: true },
  phone: String,
  erp: String,
  integrationTypes: { type: [String], default: [] },
  productVolume: String,
  orderVolume: String,
  message: String,
  status: { type: String, default: 'pending', index: true },
  statusLabel: { type: String, default: 'Aguardando análise' },
  adminNotes: String,
  environment: { type: String, default: 'pending', index: true },
  sandboxCredentials: mongoose.Schema.Types.Mixed,
  productionCredentials: mongoose.Schema.Types.Mixed,
  statusHistory: { type: [mongoose.Schema.Types.Mixed], default: [] },
  reviewedBy: String,
  reviewedAt: Date,
  source: { type: String, default: 'developers_page' },
  metadata: mongoose.Schema.Types.Mixed
}, { timestamps: true, versionKey: false });

const EnterpriseHomologationRequest =
  mongoose.models.EnterpriseHomologationRequest ||
  mongoose.model('EnterpriseHomologationRequest', homologationRequestSchema);

function onlyDigits(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function cleanText(value = '', max = 500) {
  return String(value || '').trim().slice(0, max);
}

function createRequestId() {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `HML-${y}${m}${d}-${random}`;
}

function createSandboxCredentials(request = {}, admin = {}) {
  const cleanCompany = String(request.companyName || request.tradeName || request.requestId || 'empresa')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'empresa';

  const suffix = crypto.randomBytes(5).toString('hex');
  const apiKey = `ari_sbx_${cleanCompany}_${suffix}`;
  const webhookSecret = `whsec_sbx_${crypto.randomBytes(24).toString('hex')}`;
  const clientId = `ari_client_sbx_${crypto.randomBytes(8).toString('hex')}`;

  return {
    environment: 'sandbox',
    apiKey,
    clientId,
    webhookSecret,
    baseUrl: String(process.env.ENTERPRISE_SANDBOX_BASE_URL || process.env.APP_BASE_URL || 'https://ariana-backend.onrender.com/api').replace(/\/+$/, ''),
    docsUrl: String(process.env.ENTERPRISE_DOCS_URL || 'https://arianamoveis.com.br/developers.html').trim(),
    generatedAt: new Date(),
    generatedBy: admin?.email || admin?.id || 'admin',
    active: true
  };
}

function buildStatusHistoryEntry({ status, statusLabel, admin, note = '' } = {}) {
  return {
    status,
    label: statusLabel,
    note: cleanText(note, 1000),
    by: admin?.email || admin?.id || 'admin',
    at: new Date()
  };
}

function normalizeHomologationStatus(status = '') {
  const s = String(status || '').toLowerCase().trim();
  if (['approved', 'aprovada', 'aprovado', 'approve'].includes(s)) return { status: 'approved', statusLabel: 'Aprovada para homologação' };
  if (['rejected', 'reprovada', 'reprovado', 'reject'].includes(s)) return { status: 'rejected', statusLabel: 'Reprovada' };
  if (['in_review', 'analise', 'em_analise', 'review'].includes(s)) return { status: 'in_review', statusLabel: 'Em análise' };
  if (['sandbox', 'teste', 'testing'].includes(s)) return { status: 'sandbox', statusLabel: 'Sandbox liberado' };
  return { status: 'pending', statusLabel: 'Aguardando análise' };
}


function adminOnly(req, res, next) {
  try {
    const header = String(req.headers.authorization || '').trim();
    const token = header.toLowerCase().startsWith('bearer ')
      ? header.slice(7).trim()
      : '';

    if (!token) return fail(res, 401, 'Token ausente');

    const decoded = jwt.verify(token, JWT_SECRET);

    const role = String(decoded.role || decoded.tipo || decoded.type || '').toLowerCase().trim();
    const id = String(decoded.id || decoded.userId || decoded.uid || decoded.sub || '').trim();
    const email = String(decoded.email || '').toLowerCase().trim();
    const adminEmail = String(process.env.ADMIN_EMAIL || '').toLowerCase().trim();

    const isAdminToken =
      decoded.admin === true ||
      decoded.isAdmin === true ||
      decoded.active === true && role === 'admin' ||
      role === 'admin' ||
      role === 'staff' ||
      role === 'superadmin' ||
      id === 'env-admin' ||
      id === 'admin' ||
      Boolean(adminEmail && email === adminEmail);

    if (isAdminToken) {
      req.admin = decoded;
      req.user = decoded;
      req.auth = decoded;
      return next();
    }

    console.warn('[enterprise/adminOnly] Acesso negado para token decodificado:', {
      role,
      id,
      email,
      admin: decoded.admin,
      isAdmin: decoded.isAdmin
    });

    return fail(res, 403, 'Acesso negado');
  } catch (error) {
    console.warn('[enterprise/adminOnly] Token inválido:', error?.message || error);
    return fail(res, 401, 'Token inválido');
  }
}

function partnerKey(req, res, next) {
  const expected = String(process.env.ENTERPRISE_WEBHOOK_SECRET || '').trim();
  if (!expected) return next();
  const received = String(req.headers['x-ariana-key'] || req.query.key || '').trim();
  if (received !== expected) return fail(res, 401, 'Chave de integração inválida');
  return next();
}

function partnerKeyRequired(req, res, next) {
  const expected = String(process.env.ENTERPRISE_WEBHOOK_SECRET || '').trim();
  if (!expected) return fail(res, 403, 'Configure ENTERPRISE_WEBHOOK_SECRET no Render para liberar esta API externa');
  const received = String(req.headers['x-ariana-key'] || req.query.key || '').trim();
  if (received !== expected) return fail(res, 401, 'Chave de integração inválida');
  return next();
}

router.get('/health', (_req, res) => ok(res, { module: 'enterprise', status: 'online' }));

// ============================================================
// ETAPA 10 - Homologação Enterprise
// Formulário público + gestão no Admin Enterprise.
// ============================================================
router.post('/homologation/request', async (req, res) => {
  try {
    const body = req.body || {};
    const companyName = cleanText(body.companyName || body.razaoSocial || body.empresa, 180);
    const responsibleName = cleanText(body.responsibleName || body.responsavel || body.nome, 140);
    const email = cleanText(body.email || body.responsibleEmail, 160).toLowerCase();
    const phone = cleanText(body.phone || body.telefone || body.whatsapp, 40);
    const cnpj = onlyDigits(body.cnpj || body.document || body.documento);

    if (!companyName) return fail(res, 400, 'Empresa/Razão social é obrigatória');
    if (!responsibleName) return fail(res, 400, 'Nome do responsável é obrigatório');
    if (!email || !email.includes('@')) return fail(res, 400, 'E-mail válido é obrigatório');

    const integrationTypes = Array.isArray(body.integrationTypes)
      ? body.integrationTypes.map((v) => cleanText(v, 60)).filter(Boolean)
      : String(body.integrationTypes || '').split(',').map((v) => cleanText(v, 60)).filter(Boolean);

    const request = await EnterpriseHomologationRequest.create({
      requestId: createRequestId(),
      companyName,
      tradeName: cleanText(body.tradeName || body.nomeFantasia, 180),
      cnpj,
      website: cleanText(body.website || body.site, 220),
      responsibleName,
      responsibleRole: cleanText(body.responsibleRole || body.cargo, 120),
      email,
      phone,
      erp: cleanText(body.erp || body.erpName || body.sistema, 100),
      integrationTypes,
      productVolume: cleanText(body.productVolume || body.volumeProdutos, 80),
      orderVolume: cleanText(body.orderVolume || body.volumePedidos, 80),
      message: cleanText(body.message || body.mensagem || body.observacoes, 2000),
      source: cleanText(body.source || 'developers_page', 80),
      metadata: { userAgent: req.headers['user-agent'] || '', ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '' },
      statusHistory: [{ status: 'pending', label: 'Solicitação enviada', note: 'Solicitação criada pelo formulário público.', at: new Date(), by: 'formulario_publico' }]
    });

    return ok(res, { request: { id: String(request._id), requestId: request.requestId, status: request.status, statusLabel: request.statusLabel, companyName: request.companyName, email: request.email, createdAt: request.createdAt } }, 201);
  } catch (error) {
    return fail(res, 500, error.message || 'Erro ao registrar solicitação de homologação');
  }
});

router.get('/homologation-requests', adminOnly, async (req, res) => {
  try {
    const status = cleanText(req.query?.status || '', 40);
    const q = cleanText(req.query?.q || req.query?.search || '', 120);
    const limit = Math.min(Math.max(Number(req.query?.limit || 50), 1), 200);
    const filter = {};
    if (status) filter.status = status;
    if (q) {
      const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ requestId: regex }, { companyName: regex }, { tradeName: regex }, { email: regex }, { cnpj: regex }];
    }

    const items = await EnterpriseHomologationRequest.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    const summaryAgg = await EnterpriseHomologationRequest.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
    const summary = summaryAgg.reduce((acc, row) => { acc[row._id || 'unknown'] = row.count; return acc; }, {});
    return ok(res, { items, summary, total: items.length });
  } catch (error) {
    return fail(res, 500, error.message || 'Erro ao listar solicitações de homologação');
  }
});

router.patch('/homologation-requests/:id/status', adminOnly, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const normalized = normalizeHomologationStatus(req.body?.status);
    const adminNotes = cleanText(req.body?.adminNotes || req.body?.notes || '', 2000);
    const regenerate = req.body?.regenerate === true || String(req.body?.regenerate || '').toLowerCase() === 'true';
    const filter = mongoose.Types.ObjectId.isValid(id) ? { _id: new mongoose.Types.ObjectId(id) } : { requestId: id };

    const current = await EnterpriseHomologationRequest.findOne(filter);
    if (!current) return fail(res, 404, 'Solicitação não encontrada');

    const update = {
      status: normalized.status,
      statusLabel: normalized.statusLabel,
      adminNotes,
      reviewedBy: req.admin?.email || req.admin?.id || 'admin',
      reviewedAt: new Date()
    };

    if (normalized.status === 'sandbox') {
      update.environment = 'sandbox';
      if (!current.sandboxCredentials?.apiKey || regenerate) {
        update.sandboxCredentials = createSandboxCredentials(current, req.admin);
      }
    } else if (normalized.status === 'production') {
      update.environment = 'production';
    } else if (normalized.status === 'rejected') {
      update.environment = 'rejected';
    }

    current.set(update);
    current.statusHistory = Array.isArray(current.statusHistory) ? current.statusHistory : [];
    current.statusHistory.push(buildStatusHistoryEntry({
      status: normalized.status,
      statusLabel: normalized.statusLabel,
      admin: req.admin,
      note: adminNotes || (normalized.status === 'sandbox' ? 'Sandbox liberado e credenciais de teste geradas.' : '')
    }));

    await current.save();
    const request = current.toObject();
    return ok(res, { request });
  } catch (error) {
    return fail(res, 400, error.message || 'Erro ao atualizar solicitação');
  }
});



// ============================================================
// ETAPA 11 - Simulador Enterprise de Homologação
// Uso interno do admin para validar catálogo, estoque/preço,
// pedido, NF-e e rastreio sem depender de fábrica real.
// ============================================================
function simulatorManufacturer(body = {}) {
  return String(body.manufacturer || body.fabricante || 'ariana_demo').trim().toLowerCase() || 'ariana_demo';
}
function simulatorBaseProduct(manufacturer = 'ariana_demo') {
  return {
    manufacturer,
    sellerId: manufacturer,
    sellerName: 'Ariana Demo Sandbox',
    sku: 'AD-SBX-GEL001',
    name: 'Geladeira Demo Sandbox Ariana Enterprise',
    description: 'Produto criado automaticamente pelo Simulador Enterprise para homologação.',
    category: 'Geladeiras & Refrigeradores',
    brand: 'Ariana Demo',
    price: 2500,
    stock: 12,
    weight: 60,
    length: 70,
    height: 175,
    width: 70,
    imageUrl: 'https://placehold.co/600x600/eef2ff/1d4ed8?text=Ariana+Demo'
  };
}
async function runEnterpriseSimulatorStep(step = '', body = {}, admin = {}) {
  const manufacturer = simulatorManufacturer(body);
  const product = simulatorBaseProduct(manufacturer);
  const stamp = Date.now();
  const externalOrderId = String(body.externalOrderId || body.orderId || `ARI-SBX-${stamp}`).trim();

  if (step === 'catalog') {
    const result = await syncEnterpriseCatalog({
      manufacturer,
      sellerId: manufacturer,
      sellerName: 'Ariana Demo Sandbox',
      items: [
        product,
        { ...product, sku: 'AD-SBX-LAV001', name: 'Lavadora Demo Sandbox Ariana Enterprise', category: 'Eletrodomésticos', price: 1899, stock: 7, weight: 45, height: 100, imageUrl: 'https://placehold.co/600x600/eef2ff/1d4ed8?text=Lavadora' },
        { ...product, sku: 'AD-SBX-MIC001', name: 'Micro-ondas Demo Sandbox Ariana Enterprise', category: 'Eletroportáteis', price: 699, stock: 20, weight: 12, height: 30, imageUrl: 'https://placehold.co/600x600/eef2ff/1d4ed8?text=Microondas' }
      ]
    }, admin?.email || admin?.id || 'simulador');
    return { step, ok: true, message: 'Catálogo demo sincronizado.', result };
  }

  if (step === 'stock_price') {
    await syncEnterpriseCatalog({ manufacturer, sellerId: manufacturer, sellerName: 'Ariana Demo Sandbox', items: [product] }, admin?.email || admin?.id || 'simulador');
    const result = await syncEnterpriseProductState({
      sku: product.sku,
      sellerId: manufacturer,
      manufacturer,
      price: 2299,
      stock: 3,
      active: true,
      availability: 'available',
      status: 'updated_by_enterprise_simulator',
      payload: { source: 'enterprise_simulator', step }
    });
    return { step, ok: true, message: 'Preço e estoque atualizados.', result };
  }

  if (step === 'order') {
    await syncEnterpriseCatalog({ manufacturer, sellerId: manufacturer, sellerName: 'Ariana Demo Sandbox', items: [product] }, admin?.email || admin?.id || 'simulador');
    const order = await receiveEnterpriseOrder({
      manufacturer,
      externalOrderId,
      customerName: 'Cliente Sandbox Ariana',
      customerEmail: 'cliente.sandbox@teste.com',
      customerPhone: '31999999999',
      subtotal: 2299,
      shippingCost: 80,
      total: 2379,
      status: 'enterprise_sandbox_order',
      statusLabel: 'Pedido sandbox criado pelo simulador',
      shippingAddress: { name: 'Cliente Sandbox Ariana', phone: '31999999999', cep: '39740000', logradouro: 'Rua Teste Sandbox', numero: '100', bairro: 'Centro', cidade: 'Guanhães', uf: 'MG' },
      items: [{ sku: product.sku, name: product.name, qty: 1, unitPrice: 2299, totalPrice: 2299, sellerId: manufacturer }],
      notes: 'Pedido criado automaticamente pelo Simulador Enterprise.'
    });
    return { step, ok: true, message: 'Pedido sandbox criado.', externalOrderId, orderId: String(order?._id || order?.id || ''), order };
  }

  if (step === 'invoice') {
    let orderId = String(body.orderId || body.externalOrderId || '').trim();
    if (!orderId) {
      const created = await runEnterpriseSimulatorStep('order', { ...body, manufacturer, externalOrderId }, admin);
      orderId = created.orderId || created.externalOrderId;
    }
    const result = await attachEnterpriseInvoice({
      orderId,
      manufacturer,
      invoice: {
        number: String(100000 + Math.floor(Math.random() * 899999)),
        serie: '1',
        key: '31260600000000000000550010001234510000123456',
        xmlUrl: 'https://arianamoveis.com.br/sandbox/nfe-demo.xml',
        pdfUrl: 'https://arianamoveis.com.br/sandbox/danfe-demo.pdf',
        issuedAt: new Date()
      },
      payload: { source: 'enterprise_simulator', step }
    });
    return { step, ok: true, message: 'NF-e sandbox anexada ao pedido.', orderId, result };
  }

  if (step === 'tracking') {
    let orderId = String(body.orderId || body.externalOrderId || '').trim();
    if (!orderId) {
      const created = await runEnterpriseSimulatorStep('order', { ...body, manufacturer, externalOrderId }, admin);
      orderId = created.orderId || created.externalOrderId;
    }
    const result = await updateEnterpriseOrderTracking({
      orderId,
      manufacturer,
      trackingCode: `SBX${String(Date.now()).slice(-9)}BR`,
      carrier: 'Transportadora Sandbox Ariana',
      trackingUrl: 'https://arianamoveis.com.br/rastreamento-demo',
      payload: { source: 'enterprise_simulator', step, status: 'enviado', statusLabel: 'Pedido enviado pelo simulador' }
    });
    return { step, ok: true, message: 'Rastreio sandbox atualizado.', orderId, result };
  }

  throw new Error('Etapa do simulador inválida');
}

router.post('/simulator/:step', adminOnly, async (req, res) => {
  try {
    const step = String(req.params.step || '').toLowerCase().trim();
    if (step === 'all') {
      const manufacturer = simulatorManufacturer(req.body || {});
      const externalOrderId = `ARI-SBX-${Date.now()}`;
      const results = [];
      results.push(await runEnterpriseSimulatorStep('catalog', { ...(req.body || {}), manufacturer }, req.admin));
      results.push(await runEnterpriseSimulatorStep('stock_price', { ...(req.body || {}), manufacturer }, req.admin));
      const order = await runEnterpriseSimulatorStep('order', { ...(req.body || {}), manufacturer, externalOrderId }, req.admin);
      results.push(order);
      results.push(await runEnterpriseSimulatorStep('invoice', { ...(req.body || {}), manufacturer, orderId: order.orderId || order.externalOrderId }, req.admin));
      results.push(await runEnterpriseSimulatorStep('tracking', { ...(req.body || {}), manufacturer, orderId: order.orderId || order.externalOrderId }, req.admin));
      return ok(res, { ok: true, message: 'Homologação completa simulada com sucesso.', results, externalOrderId });
    }
    const result = await runEnterpriseSimulatorStep(step, req.body || {}, req.admin);
    return ok(res, result);
  } catch (error) {
    return fail(res, 400, error.message || 'Erro ao executar simulador Enterprise');
  }
});


router.get('/manufacturers', adminOnly, async (_req, res) => {
  try { return ok(res, { integrations: await listIntegrations() }); }
  catch (error) { return fail(res, 500, error.message || 'Erro ao listar integrações'); }
});

router.post('/manufacturers', adminOnly, async (req, res) => {
  try {
    const integration = await upsertIntegration(req.body, req.admin?.email || req.admin?.id || 'admin');
    return ok(res, { integration });
  } catch (error) {
    return fail(res, 400, error.message || 'Erro ao salvar integração');
  }
});

router.post('/manufacturers/:manufacturer/orders', adminOnly, async (req, res) => {
  try {
    const manufacturer = req.params.manufacturer;
    const orderId = req.body.orderId || req.body.id || req.body.numeroPedido;
    if (!orderId) return fail(res, 400, 'orderId é obrigatório');
    const item = await enqueueManufacturerOrder({ manufacturer, orderId, payload: req.body });
    return ok(res, { queue: item }, 201);
  } catch (error) {
    return fail(res, 400, error.message || 'Erro ao enfileirar pedido');
  }
});

router.post('/queue/:queueId/dispatch', adminOnly, async (req, res) => {
  try { return ok(res, { queue: await dispatchQueueItem(req.params.queueId) }); }
  catch (error) { return fail(res, 500, error.response?.data || error.message || 'Erro ao enviar fila'); }
});

router.post('/webhooks/:manufacturer', partnerKey, async (req, res) => {
  try {
    const event = await registerWebhookEvent({
      manufacturer: req.params.manufacturer,
      eventType: req.body?.event || req.body?.type || 'manufacturer_webhook',
      payload: req.body
    });
    return ok(res, { received: true, id: String(event._id) });
  } catch (error) {
    return fail(res, 500, error.message || 'Erro ao registrar webhook');
  }
});

// ============================================================
// ETAPA 2 - Enterprise API: produtos, estoque e preços
// ============================================================
router.get('/products', adminOnly, async (req, res) => {
  try { return ok(res, await listEnterpriseProducts(req.query)); }
  catch (error) { return fail(res, 500, error.message || 'Erro ao listar produtos enterprise'); }
});

router.post('/products/upsert', partnerKeyRequired, async (req, res) => {
  try { return ok(res, { product: await upsertEnterpriseProduct(req.body, req.body?.manufacturer || 'enterprise') }, 201); }
  catch (error) { return fail(res, 400, error.message || 'Erro ao cadastrar/atualizar produto enterprise'); }
});

router.put('/products/:sku/stock', partnerKeyRequired, async (req, res) => {
  try {
    const product = await updateEnterpriseStock({
      sku: req.params.sku,
      sellerId: req.body?.sellerId || req.query?.sellerId,
      stock: req.body?.stock ?? req.body?.quantity ?? req.body?.estoque,
      manufacturer: req.body?.manufacturer || req.query?.manufacturer,
      payload: req.body
    });
    return ok(res, { product });
  } catch (error) {
    return fail(res, 400, error.message || 'Erro ao atualizar estoque');
  }
});

router.put('/products/:sku/price', partnerKeyRequired, async (req, res) => {
  try {
    const product = await updateEnterprisePrice({
      sku: req.params.sku,
      sellerId: req.body?.sellerId || req.query?.sellerId,
      price: req.body?.price ?? req.body?.preco ?? req.body?.valor,
      manufacturer: req.body?.manufacturer || req.query?.manufacturer,
      payload: req.body
    });
    return ok(res, { product });
  } catch (error) {
    return fail(res, 400, error.message || 'Erro ao atualizar preço');
  }
});


// ============================================================
// ETAPA 7 - Enterprise API: sincronização de estoque, preço e status
// ============================================================
router.post('/products/:sku/sync', partnerKeyRequired, async (req, res) => {
  try {
    const product = await syncEnterpriseProductState({
      sku: req.params.sku,
      sellerId: req.body?.sellerId || req.query?.sellerId,
      manufacturer: req.body?.manufacturer || req.query?.manufacturer,
      price: req.body?.price ?? req.body?.preco ?? req.body?.valor,
      stock: req.body?.stock ?? req.body?.quantity ?? req.body?.estoque,
      active: req.body?.active ?? req.body?.ativo,
      availability: req.body?.availability || req.body?.disponibilidade,
      status: req.body?.status || req.body?.productStatus,
      discontinued: req.body?.discontinued ?? req.body?.descontinuado,
      payload: req.body
    });
    return ok(res, { product });
  } catch (error) {
    return fail(res, 400, error.message || 'Erro ao sincronizar produto enterprise');
  }
});

router.post('/products/bulk-sync', partnerKeyRequired, async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items || req.body?.products || req.body?.produtos)
      ? (req.body.items || req.body.products || req.body.produtos)
      : [];
    return ok(res, await bulkEnterpriseProductState(items, {
      manufacturer: req.body?.manufacturer,
      sellerId: req.body?.sellerId
    }));
  } catch (error) {
    return fail(res, 400, error.message || 'Erro ao sincronizar produtos em lote');
  }
});

router.get('/products/:sku/sync-history', adminOnly, async (req, res) => {
  try {
    return ok(res, await listEnterpriseProductSyncHistory({
      sku: req.params.sku,
      manufacturer: req.query?.manufacturer,
      limit: req.query?.limit
    }));
  } catch (error) {
    return fail(res, 500, error.message || 'Erro ao listar histórico de sincronização do produto');
  }
});

router.post('/products/bulk-stock', partnerKeyRequired, async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    return ok(res, { results: await bulkEnterpriseStock(items, { manufacturer: req.body?.manufacturer }) });
  } catch (error) {
    return fail(res, 400, error.message || 'Erro ao atualizar estoque em lote');
  }
});

router.post('/products/bulk-prices', partnerKeyRequired, async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    return ok(res, { results: await bulkEnterprisePrices(items, { manufacturer: req.body?.manufacturer }) });
  } catch (error) {
    return fail(res, 400, error.message || 'Erro ao atualizar preços em lote');
  }
});

router.post('/products/bulk-upsert', partnerKeyRequired, async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items || req.body?.products || req.body?.produtos)
      ? (req.body.items || req.body.products || req.body.produtos)
      : [];
    return ok(res, { results: await bulkEnterpriseProducts(items, { manufacturer: req.body?.manufacturer, sellerId: req.body?.sellerId, sellerName: req.body?.sellerName }) });
  } catch (error) {
    return fail(res, 400, error.message || 'Erro ao cadastrar produtos em lote');
  }
});

// ============================================================
// ETAPA 6 - Enterprise API: sincronização de catálogo
// ============================================================
router.get('/catalog/summary', adminOnly, async (req, res) => {
  try { return ok(res, await getEnterpriseCatalogSummary(req.query)); }
  catch (error) { return fail(res, 500, error.message || 'Erro ao carregar resumo do catálogo enterprise'); }
});

router.post('/catalog/sync', adminOnly, async (req, res) => {
  try { return ok(res, await syncEnterpriseCatalog(req.body, req.admin?.email || req.admin?.id || 'admin'), 201); }
  catch (error) { return fail(res, 400, error.message || 'Erro ao sincronizar catálogo enterprise'); }
});

router.post('/catalog/push', partnerKeyRequired, async (req, res) => {
  try { return ok(res, await syncEnterpriseCatalog(req.body, req.body?.manufacturer || 'partner'), 201); }
  catch (error) { return fail(res, 400, error.message || 'Erro ao receber catálogo enterprise'); }
});


// ============================================================
// ETAPA 3 - Enterprise API: pedidos, status, tracking e NF-e
// ============================================================
router.get('/orders', adminOnly, async (req, res) => {
  try { return ok(res, await listEnterpriseOrders(req.query)); }
  catch (error) { return fail(res, 500, error.message || 'Erro ao listar pedidos enterprise'); }
});

router.post('/orders', partnerKeyRequired, async (req, res) => {
  try { return ok(res, { order: await receiveEnterpriseOrder(req.body) }, 201); }
  catch (error) { return fail(res, 400, error.message || 'Erro ao receber pedido enterprise'); }
});

router.post('/orders/:orderId/status', partnerKeyRequired, async (req, res) => {
  try {
    const order = await updateEnterpriseOrderStatus({
      orderId: req.params.orderId,
      status: req.body?.status || req.body?.status_integracao,
      statusLabel: req.body?.statusLabel || req.body?.label || req.body?.mensagem,
      manufacturer: req.body?.manufacturer || req.query?.manufacturer,
      payload: req.body
    });
    return ok(res, { order });
  } catch (error) {
    return fail(res, 400, error.message || 'Erro ao atualizar status enterprise');
  }
});

router.post('/orders/:orderId/tracking', partnerKeyRequired, async (req, res) => {
  try {
    const order = await updateEnterpriseOrderTracking({
      orderId: req.params.orderId,
      trackingCode: req.body?.trackingCode || req.body?.codigoRastreio || req.body?.rastreio,
      carrier: req.body?.carrier || req.body?.transportadora,
      trackingUrl: req.body?.trackingUrl || req.body?.urlRastreio,
      manufacturer: req.body?.manufacturer || req.query?.manufacturer,
      payload: req.body
    });
    return ok(res, { order });
  } catch (error) {
    return fail(res, 400, error.message || 'Erro ao atualizar rastreio enterprise');
  }
});

router.post('/orders/:orderId/invoice', partnerKeyRequired, async (req, res) => {
  try {
    const order = await attachEnterpriseInvoice({
      orderId: req.params.orderId,
      invoice: req.body?.invoice || req.body?.nfe || req.body,
      manufacturer: req.body?.manufacturer || req.query?.manufacturer,
      payload: req.body
    });
    return ok(res, { order });
  } catch (error) {
    return fail(res, 400, error.message || 'Erro ao anexar NF-e enterprise');
  }
});


router.get('/dashboard', adminOnly, async (req, res) => {
  try { return ok(res, await getEnterpriseDashboard(req.query)); }
  catch (error) { return fail(res, 500, error.message || 'Erro ao carregar dashboard enterprise'); }
});

router.get('/logs', adminOnly, async (req, res) => {
  try { return ok(res, await listEnterpriseLogs(req.query)); }
  catch (error) { return fail(res, 500, error.message || 'Erro ao listar logs enterprise'); }
});

router.get('/queue', adminOnly, async (req, res) => {
  try { return ok(res, await listEnterpriseQueue(req.query)); }
  catch (error) { return fail(res, 500, error.message || 'Erro ao listar fila enterprise'); }
});

export default router;
