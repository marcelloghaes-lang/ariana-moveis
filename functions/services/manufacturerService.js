import mongoose from 'mongoose';
import axios from 'axios';
import crypto from 'crypto';

function buildSchema(schemaDef = {}) {
  return new mongoose.Schema(schemaDef, { timestamps: true, versionKey: false });
}

function getOrCreateModel(name, schemaDef = null) {
  if (mongoose.modelNames().includes(name)) return mongoose.model(name);
  if (!schemaDef) throw new Error(`Modelo ${name} ainda não carregado pelo server.js`);
  return mongoose.model(name, buildSchema(schemaDef));
}

function lazyModel(name, schemaDef = null) {
  return new Proxy(function LazyMongooseModelProxy() {}, {
    get(_target, prop) {
      const model = getOrCreateModel(name, schemaDef);
      const value = model[prop];
      return typeof value === 'function' ? value.bind(model) : value;
    },
    apply(_target, _thisArg, args) {
      const model = getOrCreateModel(name, schemaDef);
      return model(...args);
    }
  });
}

// Importante:
// Estes proxies NÃO compilam models no carregamento do arquivo.
// Eles apenas reutilizam os models que o server.js já criou.
// Isso evita o erro: OverwriteModelError: Cannot overwrite model once compiled.

export const ManufacturerIntegration = lazyModel('ManufacturerIntegration', {
  manufacturer: { type: String, unique: true, index: true },
  enabled: { type: Boolean, default: true },
  endpoint: String,
  method: { type: String, default: 'POST' },
  headers: mongoose.Schema.Types.Mixed,
  authType: String,
  authToken: String,
  apiKey: String,
  sendAs: { type: String, default: 'json' },
  timeoutMs: { type: Number, default: 30000 },
  metadata: mongoose.Schema.Types.Mixed
});

export const ManufacturerDispatchQueue = lazyModel('ManufacturerDispatchQueue', {
  queueId: { type: String, unique: true, index: true },
  orderId: { type: String, required: true, index: true },
  manufacturer: { type: String, required: true, index: true },
  payload: mongoose.Schema.Types.Mixed,
  status: { type: String, default: 'pending', index: true },
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 5 },
  nextAttemptAt: Date,
  lastAttemptAt: Date,
  lastError: String,
  lastResponse: mongoose.Schema.Types.Mixed,
  deadLetter: { type: Boolean, default: false }
});

export const IntegrationAuditLog = lazyModel('IntegrationAuditLog', {
  scope: { type: String, default: 'integration' },
  eventType: { type: String, default: 'unspecified', index: true },
  orderId: { type: String, default: null, index: true },
  manufacturer: { type: String, default: null, index: true },
  integrationId: { type: String, default: null },
  queueId: { type: String, default: null },
  status: String,
  statusCode: Number,
  message: String,
  request: mongoose.Schema.Types.Mixed,
  response: mongoose.Schema.Types.Mixed,
  metadata: mongoose.Schema.Types.Mixed
});

function getProductModel() {
  if (mongoose.modelNames().includes('Product')) return mongoose.model('Product');
  throw new Error('Modelo Product ainda não carregado pelo server.js');
}


function getOrderModel() {
  if (mongoose.modelNames().includes('Order')) return mongoose.model('Order');
  throw new Error('Modelo Order ainda não carregado pelo server.js');
}

function buildOrderQuery(params = {}) {
  const query = {};
  const manufacturer = normalizeManufacturer(params.manufacturer || '');
  const status = String(params.status || '').trim();
  const search = String(params.search || params.q || '').trim();
  if (manufacturer) {
    query.$or = [
      { manufacturer: new RegExp(manufacturer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
      { sellerIds: manufacturer },
      { 'items.sellerId': manufacturer }
    ];
  }
  if (status) query.status = status;
  if (search) {
    query.$and = query.$and || [];
    query.$and.push({ $or: [
      { customerName: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
      { customerEmail: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
      { trackingCode: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
      { status_integracao: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }
    ]});
  }
  return query;
}

function normalizeEnterpriseOrderItems(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const qty = Number(item.qty ?? item.quantity ?? item.quantidade ?? 1) || 1;
    const unitPrice = parseMoneyBR(item.unitPrice ?? item.price ?? item.preco ?? item.valorUnitario ?? 0);
    return {
      productId: String(item.productId || item.sku || item.codigo || '').trim(),
      sellerId: String(item.sellerId || item.manufacturer || item.fabricante || '').trim(),
      name: String(item.name || item.nome || item.title || item.sku || 'Produto').trim(),
      sku: String(item.sku || item.codigo || '').trim(),
      qty,
      unitPrice,
      totalPrice: parseMoneyBR(item.totalPrice ?? item.total ?? (unitPrice * qty)),
      sellerBaseUnitPrice: parseMoneyBR(item.sellerBaseUnitPrice ?? item.basePrice ?? unitPrice),
      sellerBaseTotal: parseMoneyBR(item.sellerBaseTotal ?? item.baseTotal ?? (unitPrice * qty)),
      image: String(item.image || item.imageUrl || '').trim()
    };
  });
}

function normalizeShippingAddress(input = {}) {
  const a = input.shippingAddress || input.enderecoEntrega || input.address || {};
  return {
    name: String(a.name || a.nome || input.customerName || '').trim(),
    phone: String(a.phone || a.telefone || input.customerPhone || '').trim(),
    cep: String(a.cep || a.zipCode || '').replace(/\D/g, ''),
    logradouro: String(a.logradouro || a.street || a.rua || '').trim(),
    numero: String(a.numero || a.number || '').trim(),
    bairro: String(a.bairro || a.district || '').trim(),
    cidade: String(a.cidade || a.city || '').trim(),
    uf: String(a.uf || a.state || '').trim().toUpperCase(),
    complemento: String(a.complemento || a.complement || '').trim(),
    reference: String(a.reference || a.referencia || '').trim()
  };
}

function parseMoneyBR(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const clean = raw.replace(/R\$/gi, '').replace(/\s+/g, '').replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
  const n = Number(clean);
  return Number.isFinite(n) ? n : 0;
}

function normalizeSku(value = '') {
  return String(value || '').trim();
}

function normalizeManufacturer(value = '') {
  return String(value || '').trim().toLowerCase();
}

function buildProductQuery(params = {}) {
  const query = {};
  const manufacturer = normalizeManufacturer(params.manufacturer || params.brand || params.marca || '');
  const sellerId = String(params.sellerId || params.seller_id || '').trim();
  const sku = normalizeSku(params.sku || '');
  const search = String(params.search || params.q || '').trim();

  if (sellerId) query.sellerId = sellerId;
  if (sku) query.sku = sku;
  if (manufacturer) {
    query.$or = [
      { brand: new RegExp(`^${manufacturer}$`, 'i') },
      { sellerName: new RegExp(manufacturer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
      { sellerId: new RegExp(manufacturer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
      { manufacturer: new RegExp(manufacturer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }
    ];
  }
  if (search) {
    query.$and = query.$and || [];
    query.$and.push({ $or: [
      { name: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
      { sku: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
      { brand: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }
    ] });
  }
  return query;
}

export async function listIntegrations() {
  return ManufacturerIntegration.find({}).sort({ manufacturer: 1 }).lean();
}

export async function upsertIntegration(input = {}, user = '') {
  const manufacturer = normalizeManufacturer(input.manufacturer || input.name || '');
  if (!manufacturer) throw new Error('manufacturer é obrigatório');
  const payload = {
    manufacturer,
    enabled: input.enabled !== false,
    endpoint: String(input.endpoint || '').trim(),
    method: String(input.method || 'POST').toUpperCase(),
    headers: input.headers || {},
    authType: String(input.authType || '').trim(),
    authToken: String(input.authToken || '').trim(),
    apiKey: String(input.apiKey || '').trim(),
    sendAs: String(input.sendAs || 'json').trim(),
    timeoutMs: Number(input.timeoutMs || 30000),
    metadata: { ...(input.metadata || {}), updatedBy: user || '' }
  };
  return ManufacturerIntegration.findOneAndUpdate({ manufacturer }, payload, { upsert: true, new: true }).lean();
}

export async function enqueueManufacturerOrder({ manufacturer, orderId, payload }) {
  const queueId = `mq_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
  const doc = await ManufacturerDispatchQueue.create({
    queueId,
    manufacturer: normalizeManufacturer(manufacturer),
    orderId: String(orderId || ''),
    payload: payload || {},
    status: 'pending',
    attempts: 0,
    nextAttemptAt: new Date()
  });
  await IntegrationAuditLog.create({ eventType: 'manufacturer_order_queued', manufacturer, orderId, queueId, status: 'pending', request: payload });
  return doc.toObject();
}

export async function dispatchQueueItem(queueId) {
  const item = await ManufacturerDispatchQueue.findOne({ queueId });
  if (!item) throw new Error('Item da fila não encontrado');
  const integration = await ManufacturerIntegration.findOne({ manufacturer: item.manufacturer, enabled: true }).lean();
  if (!integration?.endpoint) throw new Error('Integração do fabricante não configurada ou desativada');

  const headers = { ...(integration.headers || {}) };
  if (integration.authType === 'bearer' && integration.authToken) headers.Authorization = `Bearer ${integration.authToken}`;
  if (integration.apiKey) headers['x-api-key'] = integration.apiKey;

  try {
    const response = await axios.request({
      url: integration.endpoint,
      method: integration.method || 'POST',
      headers,
      timeout: Number(integration.timeoutMs || 30000),
      data: integration.sendAs === 'form' ? new URLSearchParams(item.payload).toString() : item.payload
    });

    item.status = 'sent';
    item.attempts += 1;
    item.lastAttemptAt = new Date();
    item.lastResponse = response.data;
    await item.save();

    await IntegrationAuditLog.create({ eventType: 'manufacturer_order_sent', manufacturer: item.manufacturer, orderId: item.orderId, queueId, status: 'sent', statusCode: response.status, response: response.data });
    return item.toObject();
  } catch (error) {
    item.status = 'error';
    item.attempts += 1;
    item.lastAttemptAt = new Date();
    item.lastError = error.response?.data ? JSON.stringify(error.response.data).slice(0, 2000) : String(error.message || error);
    await item.save();
    await IntegrationAuditLog.create({ eventType: 'manufacturer_order_error', manufacturer: item.manufacturer, orderId: item.orderId, queueId, status: 'error', statusCode: error.response?.status, response: error.response?.data || null, message: item.lastError });
    throw error;
  }
}

export async function registerWebhookEvent({ manufacturer, eventType, payload }) {
  return IntegrationAuditLog.create({
    eventType: eventType || 'manufacturer_webhook',
    manufacturer: normalizeManufacturer(manufacturer),
    status: 'received',
    response: payload || {},
    metadata: { receivedAt: new Date() }
  });
}

export async function listEnterpriseProducts(params = {}) {
  const Product = getProductModel();
  const page = Math.max(1, Number(params.page || 1));
  const limit = Math.min(200, Math.max(1, Number(params.limit || 50)));
  const query = buildProductQuery(params);
  const [items, total] = await Promise.all([
    Product.find(query).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Product.countDocuments(query)
  ]);
  return { items, page, limit, total, pages: Math.ceil(total / limit) };
}

export async function upsertEnterpriseProduct(input = {}, source = 'enterprise') {
  const Product = getProductModel();
  const sku = normalizeSku(input.sku || input.codigo || input.ean || '');
  if (!sku) throw new Error('sku é obrigatório');
  const sellerId = String(input.sellerId || input.seller_id || input.manufacturer || input.brand || source || '').trim();
  if (!sellerId) throw new Error('sellerId ou manufacturer é obrigatório');

  const price = input.price !== undefined ? parseMoneyBR(input.price) : undefined;
  const stock = input.stock !== undefined ? Number(input.stock) : undefined;
  const payload = {
    sellerId,
    sellerName: input.sellerName || input.manufacturer || input.brand || sellerId,
    name: input.name || input.nome || input.title || sku,
    slug: input.slug || String(input.name || input.nome || sku).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
    description: input.description || input.descricao || '',
    category: input.category || input.categoria || '',
    categoryId: input.categoryId || '',
    categoryName: input.categoryName || input.category || input.categoria || '',
    brand: input.brand || input.manufacturer || '',
    sku,
    active: input.active !== false,
    specs: input.specs || input.especificacoes || {},
    dimensions: input.dimensions || {},
    logistics: input.logistics || {},
    updatedAt: new Date()
  };
  if (price !== undefined) payload.price = price;
  if (stock !== undefined && Number.isFinite(stock)) payload.stock = stock;
  if (input.weight !== undefined) payload.weight = Number(input.weight);
  if (input.length !== undefined) payload.length = Number(input.length);
  if (input.height !== undefined) payload.height = Number(input.height);
  if (input.width !== undefined) payload.width = Number(input.width);
  if (input.image || input.imageUrl || input.imagem) {
    const image = String(input.image || input.imageUrl || input.imagem || '').trim();
    payload.image = image;
    payload.imageUrl = image;
    payload.imagem = image;
    payload.mainImageUrl = image;
  }

  const doc = await Product.findOneAndUpdate({ sku, sellerId }, { $set: payload, $setOnInsert: { createdAt: new Date() } }, { upsert: true, new: true }).lean();
  await IntegrationAuditLog.create({ eventType: 'enterprise_product_upsert', manufacturer: String(input.manufacturer || input.brand || sellerId).toLowerCase(), status: 'ok', request: input, response: { sku, sellerId } });
  return doc;
}

export async function updateEnterpriseStock({ sku, sellerId, stock, manufacturer = '', payload = {} }) {
  const Product = getProductModel();
  const query = { sku: normalizeSku(sku) };
  if (sellerId) query.sellerId = String(sellerId).trim();
  const value = Number(stock);
  if (!query.sku) throw new Error('sku é obrigatório');
  if (!Number.isFinite(value)) throw new Error('stock inválido');
  const doc = await Product.findOneAndUpdate(query, { $set: { stock: value, updatedAt: new Date() } }, { new: true }).lean();
  if (!doc) throw new Error('Produto não encontrado para atualizar estoque');
  await IntegrationAuditLog.create({ eventType: 'enterprise_stock_update', manufacturer: normalizeManufacturer(manufacturer || doc.brand || doc.sellerId), status: 'ok', request: payload, response: { sku: query.sku, stock: value } });
  return doc;
}

export async function updateEnterprisePrice({ sku, sellerId, price, manufacturer = '', payload = {} }) {
  const Product = getProductModel();
  const query = { sku: normalizeSku(sku) };
  if (sellerId) query.sellerId = String(sellerId).trim();
  const value = parseMoneyBR(price);
  if (!query.sku) throw new Error('sku é obrigatório');
  if (!Number.isFinite(value) || value <= 0) throw new Error('price inválido');
  const doc = await Product.findOneAndUpdate(query, { $set: { price: value, updatedAt: new Date() } }, { new: true }).lean();
  if (!doc) throw new Error('Produto não encontrado para atualizar preço');
  await IntegrationAuditLog.create({ eventType: 'enterprise_price_update', manufacturer: normalizeManufacturer(manufacturer || doc.brand || doc.sellerId), status: 'ok', request: payload, response: { sku: query.sku, price: value } });
  return doc;
}

export async function bulkEnterpriseStock(items = [], context = {}) {
  const results = [];
  for (const item of Array.isArray(items) ? items : []) {
    try {
      const product = await updateEnterpriseStock({ ...item, manufacturer: context.manufacturer || item.manufacturer, payload: item });
      results.push({ ok: true, sku: item.sku, id: String(product._id || product.id || '') });
    } catch (error) {
      results.push({ ok: false, sku: item.sku || '', error: error.message });
    }
  }
  return results;
}

export async function bulkEnterprisePrices(items = [], context = {}) {
  const results = [];
  for (const item of Array.isArray(items) ? items : []) {
    try {
      const product = await updateEnterprisePrice({ ...item, manufacturer: context.manufacturer || item.manufacturer, payload: item });
      results.push({ ok: true, sku: item.sku, id: String(product._id || product.id || '') });
    } catch (error) {
      results.push({ ok: false, sku: item.sku || '', error: error.message });
    }
  }
  return results;
}


// ============================================================
// ETAPA 3 - Enterprise API: pedidos, status, tracking e NF-e
// ============================================================
export async function listEnterpriseOrders(params = {}) {
  const Order = getOrderModel();
  const page = Math.max(1, Number(params.page || 1));
  const limit = Math.min(200, Math.max(1, Number(params.limit || 50)));
  const query = buildOrderQuery(params);
  const [items, total] = await Promise.all([
    Order.find(query).sort({ updatedAt: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Order.countDocuments(query)
  ]);
  return { items, page, limit, total, pages: Math.ceil(total / limit) };
}

export async function receiveEnterpriseOrder(input = {}) {
  const Order = getOrderModel();
  const manufacturer = normalizeManufacturer(input.manufacturer || input.fabricante || input.sellerId || 'enterprise');
  const externalOrderId = String(input.externalOrderId || input.orderId || input.numeroPedido || input.id || '').trim();
  if (!externalOrderId) throw new Error('externalOrderId/orderId é obrigatório');

  const items = normalizeEnterpriseOrderItems(input.items || input.produtos || []);
  if (!items.length) throw new Error('items/produtos é obrigatório');

  const subtotal = parseMoneyBR(input.subtotal ?? items.reduce((acc, item) => acc + Number(item.totalPrice || 0), 0));
  const shippingCost = parseMoneyBR(input.shippingCost ?? input.frete ?? 0);
  const total = parseMoneyBR(input.total ?? (subtotal + shippingCost));
  const sellerIds = Array.from(new Set(items.map((item) => item.sellerId || manufacturer).filter(Boolean)));

  const payload = {
    sellerIds,
    customerName: String(input.customerName || input.nomeCliente || input.customer?.name || '').trim(),
    customerEmail: String(input.customerEmail || input.emailCliente || input.customer?.email || '').trim(),
    customerPhone: String(input.customerPhone || input.telefoneCliente || input.customer?.phone || '').trim(),
    status: String(input.status || 'enterprise_received').trim(),
    statusLabel: String(input.statusLabel || 'Pedido recebido via integração enterprise').trim(),
    items,
    subtotal,
    shippingCost,
    total,
    currency: String(input.currency || 'BRL').trim(),
    payment: input.payment || { provider: 'enterprise', status: input.paymentStatus || 'external' },
    shippingAddress: normalizeShippingAddress(input),
    shipping: input.shipping || input.logistics || {},
    trackingCode: String(input.trackingCode || input.codigoRastreio || '').trim(),
    notes: String(input.notes || input.observacoes || '').trim(),
    manufacturer,
    status_integracao: String(input.status_integracao || 'received').trim(),
    manufacturerDispatch: {
      externalOrderId,
      source: 'enterprise_api',
      raw: input,
      receivedAt: new Date()
    }
  };

  const doc = await Order.findOneAndUpdate(
    { 'manufacturerDispatch.externalOrderId': externalOrderId, manufacturer },
    { $set: payload, $setOnInsert: { createdAt: new Date() } },
    { upsert: true, new: true }
  ).lean();

  await IntegrationAuditLog.create({
    eventType: 'enterprise_order_received',
    manufacturer,
    orderId: String(doc._id || doc.id || externalOrderId),
    status: 'ok',
    request: input,
    response: { externalOrderId, orderId: String(doc._id || doc.id || '') }
  });

  return doc;
}

export async function updateEnterpriseOrderStatus({ orderId, status, statusLabel = '', manufacturer = '', payload = {} }) {
  const Order = getOrderModel();
  const normalizedStatus = String(status || '').trim();
  if (!orderId) throw new Error('orderId é obrigatório');
  if (!normalizedStatus) throw new Error('status é obrigatório');

  const query = mongoose.Types.ObjectId.isValid(orderId)
    ? { _id: new mongoose.Types.ObjectId(orderId) }
    : { $or: [{ 'manufacturerDispatch.externalOrderId': String(orderId) }, { trackingCode: String(orderId) }] };

  const doc = await Order.findOneAndUpdate(query, {
    $set: {
      status: normalizedStatus,
      statusLabel: statusLabel || normalizedStatus,
      status_integracao: normalizedStatus,
      'manufacturerDispatch.lastStatusPayload': payload,
      'manufacturerDispatch.lastStatusAt': new Date(),
      updatedAt: new Date()
    }
  }, { new: true }).lean();

  if (!doc) throw new Error('Pedido não encontrado para atualizar status');
  await IntegrationAuditLog.create({ eventType: 'enterprise_order_status_update', manufacturer: normalizeManufacturer(manufacturer || doc.manufacturer || ''), orderId: String(doc._id || doc.id || orderId), status: 'ok', request: payload, response: { status: normalizedStatus } });
  return doc;
}

export async function updateEnterpriseOrderTracking({ orderId, trackingCode, carrier = '', trackingUrl = '', manufacturer = '', payload = {} }) {
  const Order = getOrderModel();
  const code = String(trackingCode || '').trim();
  if (!orderId) throw new Error('orderId é obrigatório');
  if (!code) throw new Error('trackingCode é obrigatório');

  const query = mongoose.Types.ObjectId.isValid(orderId)
    ? { _id: new mongoose.Types.ObjectId(orderId) }
    : { $or: [{ 'manufacturerDispatch.externalOrderId': String(orderId) }, { trackingCode: String(orderId) }] };

  const trackingEntry = {
    code,
    carrier: String(carrier || '').trim(),
    trackingUrl: String(trackingUrl || '').trim(),
    status: String(payload.status || 'tracking_received').trim(),
    date: new Date(),
    source: 'enterprise_api',
    raw: payload
  };

  const doc = await Order.findOneAndUpdate(query, {
    $set: {
      trackingCode: code,
      status: payload.status || 'enviado',
      statusLabel: payload.statusLabel || 'Pedido enviado',
      status_integracao: payload.status_integracao || 'tracking_received',
      'manufacturerDispatch.tracking': trackingEntry,
      updatedAt: new Date()
    },
    $push: { trackingHistory: trackingEntry }
  }, { new: true }).lean();

  if (!doc) throw new Error('Pedido não encontrado para atualizar rastreio');
  await IntegrationAuditLog.create({ eventType: 'enterprise_tracking_update', manufacturer: normalizeManufacturer(manufacturer || doc.manufacturer || ''), orderId: String(doc._id || doc.id || orderId), status: 'ok', request: payload, response: { trackingCode: code, carrier } });
  return doc;
}

export async function attachEnterpriseInvoice({ orderId, invoice = {}, manufacturer = '', payload = {} }) {
  const Order = getOrderModel();
  if (!orderId) throw new Error('orderId é obrigatório');
  const query = mongoose.Types.ObjectId.isValid(orderId)
    ? { _id: new mongoose.Types.ObjectId(orderId) }
    : { $or: [{ 'manufacturerDispatch.externalOrderId': String(orderId) }, { trackingCode: String(orderId) }] };

  const invoicePayload = {
    number: String(invoice.number || invoice.numero || invoice.nNF || '').trim(),
    serie: String(invoice.serie || invoice.series || '').trim(),
    key: String(invoice.key || invoice.chave || invoice.chaveNfe || invoice.chaveNFe || '').trim(),
    xmlUrl: String(invoice.xmlUrl || invoice.xml || '').trim(),
    pdfUrl: String(invoice.pdfUrl || invoice.danfe || '').trim(),
    issuedAt: invoice.issuedAt || invoice.emissao || new Date(),
    raw: invoice
  };

  const doc = await Order.findOneAndUpdate(query, {
    $set: {
      'manufacturerDispatch.invoice': invoicePayload,
      'manufacturerDispatch.invoiceReceivedAt': new Date(),
      status_integracao: 'invoice_received',
      updatedAt: new Date()
    }
  }, { new: true }).lean();

  if (!doc) throw new Error('Pedido não encontrado para anexar NF-e');
  await IntegrationAuditLog.create({ eventType: 'enterprise_invoice_received', manufacturer: normalizeManufacturer(manufacturer || doc.manufacturer || ''), orderId: String(doc._id || doc.id || orderId), status: 'ok', request: payload, response: { invoice: invoicePayload } });
  return doc;
}

export async function listEnterpriseLogs(params = {}) {
  const page = Math.max(1, Number(params.page || 1));
  const limit = Math.min(200, Math.max(1, Number(params.limit || 50)));
  const query = {};
  if (params.manufacturer) query.manufacturer = normalizeManufacturer(params.manufacturer);
  if (params.eventType) query.eventType = String(params.eventType);
  if (params.status) query.status = String(params.status);
  const [items, total] = await Promise.all([
    IntegrationAuditLog.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    IntegrationAuditLog.countDocuments(query)
  ]);
  return { items, page, limit, total, pages: Math.ceil(total / limit) };
}

export async function listEnterpriseQueue(params = {}) {
  const page = Math.max(1, Number(params.page || 1));
  const limit = Math.min(200, Math.max(1, Number(params.limit || 50)));
  const query = {};
  if (params.manufacturer) query.manufacturer = normalizeManufacturer(params.manufacturer);
  if (params.status) query.status = String(params.status);
  const [items, total] = await Promise.all([
    ManufacturerDispatchQueue.find(query).sort({ updatedAt: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ManufacturerDispatchQueue.countDocuments(query)
  ]);
  return { items, page, limit, total, pages: Math.ceil(total / limit) };
}


export async function getEnterpriseDashboard(params = {}) {
  const manufacturer = params.manufacturer ? normalizeManufacturer(params.manufacturer) : '';
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const orderQuery = { 'manufacturerDispatch.source': 'enterprise_api' };
  const logQuery = {};
  const queueQuery = {};
  if (manufacturer) {
    orderQuery.manufacturer = manufacturer;
    logQuery.manufacturer = manufacturer;
    queueQuery.manufacturer = manufacturer;
  }

  const Order = getOrderModel();
  const [
    totalOrders,
    ordersToday,
    sentOrders,
    invoiceReceived,
    trackingReceived,
    logsTotal,
    logsToday,
    queueTotal,
    queuePending,
    queueFailed,
    lastOrders,
    lastLogs,
    manufacturersRaw
  ] = await Promise.all([
    Order.countDocuments(orderQuery),
    Order.countDocuments({ ...orderQuery, createdAt: { $gte: startToday } }),
    Order.countDocuments({ ...orderQuery, status: 'enviado' }),
    Order.countDocuments({ ...orderQuery, status_integracao: 'invoice_received' }),
    Order.countDocuments({ ...orderQuery, trackingCode: { $nin: ['', null] } }),
    IntegrationAuditLog.countDocuments(logQuery),
    IntegrationAuditLog.countDocuments({ ...logQuery, createdAt: { $gte: startToday } }),
    ManufacturerDispatchQueue.countDocuments(queueQuery),
    ManufacturerDispatchQueue.countDocuments({ ...queueQuery, status: { $in: ['pending', 'queued'] } }),
    ManufacturerDispatchQueue.countDocuments({ ...queueQuery, $or: [{ status: 'failed' }, { deadLetter: true }] }),
    Order.find(orderQuery).sort({ updatedAt: -1, createdAt: -1 }).limit(10).lean(),
    IntegrationAuditLog.find(logQuery).sort({ createdAt: -1 }).limit(20).lean(),
    Order.aggregate([
      { $match: { 'manufacturerDispatch.source': 'enterprise_api' } },
      { $group: { _id: '$manufacturer', total: { $sum: 1 }, lastUpdate: { $max: '$updatedAt' } } },
      { $sort: { total: -1 } },
      { $limit: 50 }
    ])
  ]);

  return {
    summary: {
      totalOrders,
      ordersToday,
      sentOrders,
      trackingReceived,
      invoiceReceived,
      logsTotal,
      logsToday,
      queueTotal,
      queuePending,
      queueFailed
    },
    manufacturers: manufacturersRaw.map(item => ({
      manufacturer: item._id || 'sem_fabricante',
      total: item.total || 0,
      lastUpdate: item.lastUpdate || null
    })),
    lastOrders,
    lastLogs
  };
}
