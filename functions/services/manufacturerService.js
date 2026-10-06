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

function escapeRegExp(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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


function parseBooleanLike(value, fallback = undefined) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = String(value).trim().toLowerCase();
  if (['true','1','sim','yes','ativo','active','available','disponivel','disponível'].includes(text)) return true;
  if (['false','0','nao','não','no','inativo','inactive','unavailable','indisponivel','indisponível','descontinuado','discontinued'].includes(text)) return false;
  return fallback;
}

function availabilityToActive({ active, availability, status, discontinued, stock }) {
  const discontinuedBool = parseBooleanLike(discontinued, undefined);
  if (discontinuedBool === true) return false;

  const activeBool = parseBooleanLike(active, undefined);
  if (activeBool !== undefined) return activeBool;

  const words = [availability, status].map(v => String(v || '').trim().toLowerCase()).filter(Boolean).join(' ');
  if (words) {
    if (/(descontinuado|discontinued|inativo|inactive|bloqueado|blocked|fora de linha)/i.test(words)) return false;
    if (/(indispon[ií]vel|unavailable|sem estoque|out_of_stock|out-of-stock)/i.test(words)) return false;
    if (/(ativo|active|dispon[ií]vel|available|em estoque|in_stock|in-stock)/i.test(words)) return true;
  }

  if (stock !== undefined && stock !== null && stock !== '') {
    const n = Number(stock);
    if (Number.isFinite(n) && n <= 0) return false;
  }
  return undefined;
}

function compactObject(obj = {}) {
  const out = {};
  for (const [key, value] of Object.entries(obj || {})) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export async function syncEnterpriseProductState({ sku, sellerId, manufacturer = '', price, stock, active, availability = '', status = '', discontinued, payload = {} }) {
  console.log('========== ENTERPRISE SYNC ==========');
  console.log({
    sku,
    sellerId,
    manufacturer,
    payload
  });

  const Product = getProductModel();
  const normalizedSku = normalizeSku(sku || payload.sku || payload.codigo || payload.ean || '');
  if (!normalizedSku) throw new Error('sku é obrigatório');

  // Busca flexível: alguns produtos Enterprise antigos podem ter sido criados com sellerId
  // diferente do manufacturer, ou sem sellerId. Primeiro tentamos o filtro mais preciso;
  // se não achar, caímos para SKU puro e depois SKU case-insensitive.
  const safeSellerId = String(sellerId || payload.sellerId || payload.seller_id || '').trim();
  const safeManufacturer = String(manufacturer || payload.manufacturer || payload.fabricante || '').trim();
  const preciseQuery = { sku: normalizedSku };
  console.log('QUERY INICIAL:', preciseQuery);

  if (safeSellerId) preciseQuery.sellerId = safeSellerId;
  else if (safeManufacturer) preciseQuery.$or = [
    { sellerId: safeManufacturer },
    { sellerId: safeManufacturer.toLowerCase() },
    { sellerName: safeManufacturer },
    { brand: safeManufacturer },
    { brand: safeManufacturer.toLowerCase() }
  ];

  console.log('QUERY FINAL:', JSON.stringify(preciseQuery, null, 2));

  const skuOnlyQuery = { sku: normalizedSku };
  const skuRegexQuery = { sku: { $regex: `^${escapeRegExp(normalizedSku)}$`, $options: 'i' } };

  const set = { updatedAt: new Date() };
  const syncInfo = {
    source: 'enterprise_api',
    manufacturer: normalizeManufacturer(manufacturer || payload.manufacturer || payload.fabricante || safeSellerId || ''),
    lastSyncAt: new Date(),
    availability: String(availability || '').trim(),
    status: String(status || '').trim(),
    discontinued: parseBooleanLike(discontinued, undefined),
    raw: payload || {}
  };

  if (price !== undefined && price !== null && price !== '') {
    const value = parseMoneyBR(price);
    if (!Number.isFinite(value) || value <= 0) throw new Error('price inválido');
    set.price = value;
  }

  if (stock !== undefined && stock !== null && stock !== '') {
    const value = Number(stock);
    if (!Number.isFinite(value)) throw new Error('stock inválido');
    set.stock = value;
  }

  const nextActive = availabilityToActive({ active, availability, status, discontinued, stock: set.stock ?? stock });
  if (nextActive !== undefined) set.active = nextActive;

  set.logistics = {
    ...(payload.logistics || {}),
    enterpriseSync: syncInfo
  };

  let doc = await Product.findOneAndUpdate(preciseQuery, { $set: compactObject(set) }, { new: true }).lean();
  if (!doc) doc = await Product.findOneAndUpdate(skuOnlyQuery, { $set: compactObject(set) }, { new: true }).lean();
  if (!doc) doc = await Product.findOneAndUpdate(skuRegexQuery, { $set: compactObject(set) }, { new: true }).lean();
  if (!doc) {
    await IntegrationAuditLog.create({
      eventType: 'enterprise_product_state_sync_not_found',
      manufacturer: syncInfo.manufacturer,
      status: 'error',
      message: 'Produto não encontrado para sincronizar',
      request: { sku: normalizedSku, sellerId: safeSellerId, manufacturer: safeManufacturer, payload },
      response: { preciseQuery, skuOnlyQuery }
    }).catch(() => null);

    console.log('NÃO ENCONTROU PRODUTO');
    console.log('SKU:', normalizedSku);
    console.log('Seller:', safeSellerId);
    console.log('Manufacturer:', safeManufacturer);
    console.log('skuOnlyQuery:', skuOnlyQuery);
    console.log('skuRegexQuery:', JSON.stringify(skuRegexQuery));

    throw new Error(`Produto não encontrado para sincronizar: ${normalizedSku}`);
  }

  await IntegrationAuditLog.create({
    eventType: 'enterprise_product_state_sync',
    manufacturer: syncInfo.manufacturer || normalizeManufacturer(doc.brand || doc.sellerId || ''),
    status: 'ok',
    message: 'Produto sincronizado: estoque/preço/status',
    request: payload,
    response: {
      sku: normalizedSku,
      sellerId: doc.sellerId || safeSellerId || '',
      price: doc.price,
      stock: doc.stock,
      active: doc.active
    },
    metadata: {
      changed: Object.keys(set).filter(k => k !== 'updatedAt' && k !== 'logistics')
    }
  });

  return doc;
}

export async function bulkEnterpriseProductState(items = [], context = {}) {
  const rows = Array.isArray(items) ? items : [];
  const results = [];
  for (const item of rows) {
    try {
      const product = await syncEnterpriseProductState({
        sku: item.sku || item.codigo || item.ean,
        sellerId: item.sellerId || context.sellerId,
        manufacturer: item.manufacturer || context.manufacturer,
        price: item.price ?? item.preco ?? item.valor,
        stock: item.stock ?? item.quantity ?? item.estoque,
        active: item.active ?? item.ativo,
        availability: item.availability || item.disponibilidade,
        status: item.status || item.productStatus,
        discontinued: item.discontinued ?? item.descontinuado,
        payload: item
      });
      results.push({ ok: true, sku: item.sku || item.codigo || item.ean || '', id: String(product._id || product.id || ''), price: product.price, stock: product.stock, active: product.active });
    } catch (error) {
      results.push({ ok: false, sku: item.sku || item.codigo || item.ean || '', error: error.message });
    }
  }

  const success = results.filter(r => r.ok).length;
  const errors = results.filter(r => !r.ok).length;
  await IntegrationAuditLog.create({
    eventType: 'enterprise_product_bulk_state_sync',
    manufacturer: normalizeManufacturer(context.manufacturer || ''),
    status: errors ? 'partial' : 'ok',
    message: `Sincronização de estoque/preço/status: ${success} ok, ${errors} erro(s)`,
    request: { total: rows.length, context },
    response: { total: results.length, success, errors }
  });

  return { total: results.length, success, errors, results };
}

export async function listEnterpriseProductSyncHistory({ sku = '', manufacturer = '', limit = 20 } = {}) {
  const query = { eventType: { $in: ['enterprise_product_state_sync', 'enterprise_product_bulk_state_sync', 'enterprise_stock_update', 'enterprise_price_update', 'enterprise_catalog_sync_completed', 'enterprise_catalog_bulk_upsert'] } };
  if (manufacturer) query.manufacturer = normalizeManufacturer(manufacturer);
  if (sku) {
    const safeSku = String(sku).trim();
    query.$or = [
      { 'response.sku': safeSku },
      { 'request.sku': safeSku },
      { 'request.codigo': safeSku },
      { 'request.ean': safeSku }
    ];
  }
  const max = Math.min(100, Math.max(1, Number(limit || 20)));
  const logs = await IntegrationAuditLog.find(query).sort({ createdAt: -1 }).limit(max).lean();
  return { logs, total: logs.length };
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
// ETAPA 6 - Enterprise Catalog Sync
// Importação/sincronização de catálogo, estoque e preços em massa
// ============================================================
export async function bulkEnterpriseProducts(items = [], context = {}) {
  const rows = Array.isArray(items) ? items : [];
  const results = [];
  for (const item of rows) {
    try {
      const product = await upsertEnterpriseProduct({
        ...item,
        manufacturer: item.manufacturer || context.manufacturer,
        sellerId: item.sellerId || context.sellerId || item.manufacturer || context.manufacturer,
        sellerName: item.sellerName || context.sellerName || item.manufacturer || context.manufacturer
      }, context.manufacturer || item.manufacturer || 'enterprise');
      results.push({ ok: true, sku: item.sku || item.codigo || item.ean || '', id: String(product._id || product.id || '') });
    } catch (error) {
      results.push({ ok: false, sku: item.sku || item.codigo || item.ean || '', error: error.message });
    }
  }
  await IntegrationAuditLog.create({
    eventType: 'enterprise_catalog_bulk_upsert',
    manufacturer: normalizeManufacturer(context.manufacturer || ''),
    status: results.some(r => !r.ok) ? 'partial' : 'ok',
    request: { total: rows.length, context },
    response: {
      total: results.length,
      success: results.filter(r => r.ok).length,
      errors: results.filter(r => !r.ok).length
    }
  });
  return results;
}

export async function syncEnterpriseCatalog(input = {}, user = '') {
  const manufacturer = normalizeManufacturer(input.manufacturer || input.fabricante || input.sellerId || 'enterprise');
  if (!manufacturer) throw new Error('manufacturer é obrigatório');

  const dryRun = input.dryRun === true;
  const items = Array.isArray(input.items || input.products || input.produtos)
    ? (input.items || input.products || input.produtos)
    : [];

  if (!items.length) {
    await IntegrationAuditLog.create({
      eventType: 'enterprise_catalog_sync_empty',
      manufacturer,
      status: 'empty',
      message: 'Nenhum produto recebido para sincronizar',
      request: { manufacturer, user, dryRun }
    });
    return { manufacturer, dryRun, total: 0, success: 0, errors: 0, results: [] };
  }

  if (dryRun) {
    const preview = items.slice(0, 20).map(item => ({
      sku: item.sku || item.codigo || item.ean || '',
      name: item.name || item.nome || item.title || '',
      price: item.price ?? item.preco ?? item.valor ?? '',
      stock: item.stock ?? item.estoque ?? item.quantity ?? ''
    }));
    await IntegrationAuditLog.create({
      eventType: 'enterprise_catalog_sync_dry_run',
      manufacturer,
      status: 'preview',
      request: { total: items.length, user },
      response: { preview }
    });
    return { manufacturer, dryRun, total: items.length, success: 0, errors: 0, preview };
  }

  const results = await bulkEnterpriseProducts(items, {
    manufacturer,
    sellerId: input.sellerId || manufacturer,
    sellerName: input.sellerName || input.nomeFabricante || manufacturer
  });

  const success = results.filter(r => r.ok).length;
  const errors = results.filter(r => !r.ok).length;
  await IntegrationAuditLog.create({
    eventType: 'enterprise_catalog_sync_completed',
    manufacturer,
    status: errors ? 'partial' : 'ok',
    message: `Catálogo sincronizado: ${success} ok, ${errors} erro(s)`,
    request: { total: items.length, user },
    response: { total: results.length, success, errors }
  });

  return { manufacturer, dryRun: false, total: results.length, success, errors, results: results.slice(0, 100) };
}

export async function getEnterpriseCatalogSummary(params = {}) {
  const Product = getProductModel();
  const manufacturer = params.manufacturer ? normalizeManufacturer(params.manufacturer) : '';
  const query = {};
  if (manufacturer) {
    query.$or = [
      { sellerId: manufacturer },
      { brand: new RegExp(`^${manufacturer}$`, 'i') },
      { sellerName: new RegExp(manufacturer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }
    ];
  }

  const [totalProducts, activeProducts, outOfStock, lastProducts, byManufacturer] = await Promise.all([
    Product.countDocuments(query),
    Product.countDocuments({ ...query, active: { $ne: false } }),
    Product.countDocuments({ ...query, stock: { $lte: 0 } }),
    Product.find(query).sort({ updatedAt: -1, createdAt: -1 }).limit(20).lean(),
    Product.aggregate([
      { $match: manufacturer ? query : { sellerId: { $exists: true, $ne: '' } } },
      { $group: { _id: '$sellerId', total: { $sum: 1 }, active: { $sum: { $cond: [{ $ne: ['$active', false] }, 1, 0] } }, stock: { $sum: '$stock' }, lastUpdate: { $max: '$updatedAt' } } },
      { $sort: { total: -1 } },
      { $limit: 50 }
    ])
  ]);

  return {
    summary: { totalProducts, activeProducts, outOfStock },
    manufacturers: byManufacturer.map(item => ({ manufacturer: item._id || 'sem_seller', total: item.total || 0, active: item.active || 0, stock: item.stock || 0, lastUpdate: item.lastUpdate || null })),
    lastProducts
  };
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


function buildEnterpriseOrderLookup(orderId = '') {
  const value = String(orderId || '').trim();
  if (!value) throw new Error('orderId é obrigatório');
  return mongoose.Types.ObjectId.isValid(value)
    ? { _id: new mongoose.Types.ObjectId(value) }
    : {
        $or: [
          { 'manufacturerDispatch.externalOrderId': value },
          { trackingCode: value },
          { status_integracao: value }
        ]
      };
}

function escapeXmlValue(value = '') {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function onlyDigitsEnterpriseXml(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function compactEnterpriseXmlKey(value = '') {
  const digits = onlyDigitsEnterpriseXml(value);
  return digits || String(value || '').trim();
}

function buildEnterpriseXmlFilename(order = {}, xml = {}) {
  const key = compactEnterpriseXmlKey(xml?.invoice?.key || order?.manufacturerDispatch?.invoice?.key || '');
  const orderId = String(order?._id || order?.id || order?.manufacturerDispatch?.externalOrderId || 'pedido').replace(/[^a-zA-Z0-9_-]/g, '');
  return key ? `nfe-${key}.xml` : `enterprise-order-${orderId}.xml`;
}

function buildEnterpriseInvoicePayload(invoice = {}, order = {}) {
  const existing = order?.manufacturerDispatch?.invoice || {};
  const source = { ...existing, ...(invoice || {}) };
  return {
    number: String(source.number || source.numero || source.nNF || '').trim(),
    serie: String(source.serie || source.series || source.serieNfe || '1').trim(),
    key: String(source.key || source.chave || source.chaveNfe || source.chaveNFe || '').trim(),
    xmlUrl: String(source.xmlUrl || source.xml || '').trim(),
    pdfUrl: String(source.pdfUrl || source.danfe || '').trim(),
    issuedAt: source.issuedAt || source.emissao || source.dataEmissao || new Date(),
    total: parseMoneyBR(source.total ?? source.valor ?? order.total ?? 0),
    raw: source
  };
}

function generateEnterpriseXmlContent(order = {}, invoice = {}, context = {}) {
  const issuedAt = invoice.issuedAt ? new Date(invoice.issuedAt) : new Date();
  const emittedAt = Number.isNaN(issuedAt.getTime()) ? new Date() : issuedAt;
  const orderId = String(order._id || order.id || context.orderId || '').trim();
  const externalOrderId = String(order?.manufacturerDispatch?.externalOrderId || '').trim();
  const manufacturer = normalizeManufacturer(context.manufacturer || order.manufacturer || order.sellerIds?.[0] || 'enterprise');
  const total = parseMoneyBR(invoice.total ?? order.total ?? 0).toFixed(2);
  const items = Array.isArray(order.items) ? order.items : [];

  const itemsXml = items.map((item, index) => {
    const qty = Number(item.qty || item.quantity || 1) || 1;
    const unit = parseMoneyBR(item.unitPrice ?? item.price ?? 0).toFixed(2);
    const totalItem = parseMoneyBR(item.totalPrice ?? (qty * Number(unit))).toFixed(2);
    return [
      `      <item numero="${index + 1}">`,
      `        <sku>${escapeXmlValue(item.sku || item.productId || '')}</sku>`,
      `        <nome>${escapeXmlValue(item.name || 'Produto')}</nome>`,
      `        <quantidade>${qty}</quantidade>`,
      `        <valorUnitario>${unit}</valorUnitario>`,
      `        <valorTotal>${totalItem}</valorTotal>`,
      `        <sellerId>${escapeXmlValue(item.sellerId || manufacturer)}</sellerId>`,
      '      </item>'
    ].join('\n');
  }).join('\n');

  const address = order.shippingAddress || {};
  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeArianaEnterprise versao="1.00">
  <infNFe>
    <identificacao>
      <ambiente>${escapeXmlValue(context.environment || 'sandbox')}</ambiente>
      <pedidoId>${escapeXmlValue(orderId)}</pedidoId>
      <pedidoExterno>${escapeXmlValue(externalOrderId)}</pedidoExterno>
      <fabricante>${escapeXmlValue(manufacturer)}</fabricante>
      <numero>${escapeXmlValue(invoice.number || '')}</numero>
      <serie>${escapeXmlValue(invoice.serie || '')}</serie>
      <chave>${escapeXmlValue(invoice.key || '')}</chave>
      <dataEmissao>${emittedAt.toISOString()}</dataEmissao>
    </identificacao>
    <destinatario>
      <nome>${escapeXmlValue(order.customerName || address.name || '')}</nome>
      <email>${escapeXmlValue(order.customerEmail || '')}</email>
      <telefone>${escapeXmlValue(order.customerPhone || address.phone || '')}</telefone>
      <endereco>
        <cep>${escapeXmlValue(address.cep || '')}</cep>
        <logradouro>${escapeXmlValue(address.logradouro || '')}</logradouro>
        <numero>${escapeXmlValue(address.numero || '')}</numero>
        <bairro>${escapeXmlValue(address.bairro || '')}</bairro>
        <cidade>${escapeXmlValue(address.cidade || '')}</cidade>
        <uf>${escapeXmlValue(address.uf || '')}</uf>
        <complemento>${escapeXmlValue(address.complemento || '')}</complemento>
      </endereco>
    </destinatario>
    <itens>
${itemsXml || '      <!-- Sem itens no pedido -->'}
    </itens>
    <totais>
      <subtotal>${parseMoneyBR(order.subtotal || 0).toFixed(2)}</subtotal>
      <frete>${parseMoneyBR(order.shippingCost || 0).toFixed(2)}</frete>
      <total>${total}</total>
      <moeda>${escapeXmlValue(order.currency || 'BRL')}</moeda>
    </totais>
  </infNFe>
</nfeArianaEnterprise>`;
}

function publicEnterpriseXmlPayload(order = {}) {
  const xml = order?.manufacturerDispatch?.xml || null;
  if (!xml) return null;
  const { content, ...safeXml } = xml;
  return {
    ...safeXml,
    hasContent: Boolean(content),
    contentLength: content ? Buffer.byteLength(String(content), 'utf8') : 0,
    downloadPath: `/api/enterprise/orders/${String(order._id || order.id || '').trim()}/xml/download`
  };
}

export async function generateEnterpriseOrderXml({ orderId, invoice = {}, manufacturer = '', payload = {}, partner = null } = {}) {
  const Order = getOrderModel();
  const query = buildEnterpriseOrderLookup(orderId);
  const order = await Order.findOne(query).lean();
  if (!order) throw new Error('Pedido não encontrado para gerar XML');

  const invoicePayload = buildEnterpriseInvoicePayload(invoice, order);
  const environment = partner?.environment || payload?.environment || 'sandbox';
  const xmlContent = generateEnterpriseXmlContent(order, invoicePayload, {
    orderId,
    manufacturer: manufacturer || payload?.manufacturer || order.manufacturer,
    environment
  });
  const xmlHash = crypto.createHash('sha256').update(xmlContent).digest('hex');
  const filename = buildEnterpriseXmlFilename(order, { invoice: invoicePayload });
  const xmlPayload = {
    status: 'generated',
    filename,
    contentType: 'application/xml; charset=utf-8',
    content: xmlContent,
    xmlHash,
    invoice: invoicePayload,
    generatedAt: new Date(),
    generatedBy: partner?.requestId || partner?.companyName || 'enterprise_api',
    environment,
    source: 'enterprise_api_xml_module'
  };

  const updated = await Order.findOneAndUpdate(query, {
    $set: {
      'manufacturerDispatch.invoice': invoicePayload,
      'manufacturerDispatch.xml': xmlPayload,
      'manufacturerDispatch.xmlGeneratedAt': new Date(),
      status_integracao: 'xml_generated',
      updatedAt: new Date()
    }
  }, { new: true }).lean();

  await IntegrationAuditLog.create({
    eventType: 'enterprise_xml_generated',
    manufacturer: normalizeManufacturer(manufacturer || updated?.manufacturer || order.manufacturer || ''),
    orderId: String(updated?._id || order._id || orderId),
    status: 'ok',
    request: payload,
    response: { filename, xmlHash, invoice: invoicePayload },
    metadata: { environment, partner: partner?.requestId || '' }
  });

  return { xml: publicEnterpriseXmlPayload(updated), orderId: String(updated?._id || order._id || orderId) };
}

export async function getEnterpriseOrderXml({ orderId, manufacturer = '', partner = null } = {}) {
  const Order = getOrderModel();
  const order = await Order.findOne(buildEnterpriseOrderLookup(orderId)).lean();
  if (!order) throw new Error('Pedido não encontrado');
  const xml = publicEnterpriseXmlPayload(order);
  if (!xml) throw new Error('XML ainda não foi gerado para este pedido');

  await IntegrationAuditLog.create({
    eventType: 'enterprise_xml_consulted',
    manufacturer: normalizeManufacturer(manufacturer || order.manufacturer || ''),
    orderId: String(order._id || order.id || orderId),
    status: 'ok',
    response: { filename: xml.filename, xmlHash: xml.xmlHash },
    metadata: { partner: partner?.requestId || '' }
  }).catch(() => null);

  return { xml, orderId: String(order._id || order.id || orderId) };
}

export async function downloadEnterpriseOrderXml({ orderId, manufacturer = '', partner = null } = {}) {
  const Order = getOrderModel();
  const order = await Order.findOne(buildEnterpriseOrderLookup(orderId)).lean();
  if (!order) throw new Error('Pedido não encontrado');
  const xml = order?.manufacturerDispatch?.xml || null;
  if (!xml?.content) throw new Error('XML ainda não foi gerado para este pedido');

  await IntegrationAuditLog.create({
    eventType: 'enterprise_xml_downloaded',
    manufacturer: normalizeManufacturer(manufacturer || order.manufacturer || ''),
    orderId: String(order._id || order.id || orderId),
    status: 'ok',
    response: { filename: xml.filename || buildEnterpriseXmlFilename(order, xml), xmlHash: xml.xmlHash || '' },
    metadata: { partner: partner?.requestId || '' }
  }).catch(() => null);

  return {
    filename: xml.filename || buildEnterpriseXmlFilename(order, xml),
    xmlContent: String(xml.content || ''),
    xmlHash: xml.xmlHash || crypto.createHash('sha256').update(String(xml.content || '')).digest('hex')
  };
}

export async function regenerateEnterpriseOrderXml({ orderId, invoice = {}, manufacturer = '', payload = {}, partner = null } = {}) {
  const result = await generateEnterpriseOrderXml({ orderId, invoice, manufacturer, payload: { ...(payload || {}), regenerate: true }, partner });
  await IntegrationAuditLog.create({
    eventType: 'enterprise_xml_regenerated',
    manufacturer: normalizeManufacturer(manufacturer || payload?.manufacturer || ''),
    orderId: String(orderId || ''),
    status: 'ok',
    response: { xmlHash: result?.xml?.xmlHash || '' },
    metadata: { partner: partner?.requestId || '' }
  }).catch(() => null);
  return result;
}


function buildEnterpriseDanfeFilename(order = {}, danfe = {}) {
  const key = compactEnterpriseXmlKey(danfe?.invoice?.key || order?.manufacturerDispatch?.invoice?.key || '');
  const orderId = String(order?._id || order?.id || order?.manufacturerDispatch?.externalOrderId || 'pedido').replace(/[^a-zA-Z0-9_-]/g, '');
  return key ? `danfe-${key}.pdf` : `enterprise-order-${orderId}-danfe.pdf`;
}

function escapePdfText(value = '') {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .slice(0, 140);
}

function buildSimplePdfBuffer(lines = []) {
  const safeLines = (Array.isArray(lines) ? lines : []).slice(0, 46).map(escapePdfText);
  const contentLines = ['BT', '/F1 11 Tf', '40 800 Td'];
  safeLines.forEach((line, index) => {
    if (index > 0) contentLines.push('0 -16 Td');
    contentLines.push(`(${line}) Tj`);
  });
  contentLines.push('ET');
  const stream = contentLines.join('\n');
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream\nendobj\n`
  ];
  let pdf = '%PDF-1.4\n% Ariana Enterprise DANFE\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

function generateEnterpriseDanfePdfBuffer(order = {}, invoice = {}, context = {}) {
  const issuedAt = invoice.issuedAt ? new Date(invoice.issuedAt) : new Date();
  const emittedAt = Number.isNaN(issuedAt.getTime()) ? new Date() : issuedAt;
  const orderId = String(order._id || order.id || context.orderId || '').trim();
  const externalOrderId = String(order?.manufacturerDispatch?.externalOrderId || '').trim();
  const manufacturer = normalizeManufacturer(context.manufacturer || order.manufacturer || order.sellerIds?.[0] || 'enterprise');
  const address = order.shippingAddress || {};
  const items = Array.isArray(order.items) ? order.items : [];

  const lines = [
    'DANFE - Documento Auxiliar da NF-e',
    'Ariana Marketplace - API Enterprise',
    `Ambiente: ${context.environment || 'sandbox'}`,
    `Pedido Ariana: ${orderId}`,
    `Pedido externo: ${externalOrderId}`,
    `Fabricante/Seller: ${manufacturer}`,
    `Numero NF-e: ${invoice.number || ''}`,
    `Serie: ${invoice.serie || ''}`,
    `Chave de acesso: ${invoice.key || ''}`,
    `Data emissao: ${emittedAt.toISOString()}`,
    `Valor total: R$ ${parseMoneyBR(invoice.total ?? order.total ?? 0).toFixed(2)}`,
    '',
    'Destinatario',
    `Nome: ${order.customerName || address.name || ''}`,
    `Email: ${order.customerEmail || ''}`,
    `Telefone: ${order.customerPhone || address.phone || ''}`,
    `Endereco: ${address.logradouro || ''}, ${address.numero || ''} - ${address.bairro || ''}`,
    `Cidade/UF: ${address.cidade || ''}/${address.uf || ''} CEP ${address.cep || ''}`,
    '',
    'Itens'
  ];

  items.slice(0, 18).forEach((item, index) => {
    const qty = Number(item.qty || item.quantity || 1) || 1;
    const totalItem = parseMoneyBR(item.totalPrice ?? (qty * parseMoneyBR(item.unitPrice ?? item.price ?? 0))).toFixed(2);
    lines.push(`${index + 1}. ${item.sku || item.productId || ''} - ${item.name || 'Produto'} - Qtde ${qty} - R$ ${totalItem}`);
  });

  lines.push('');
  lines.push('Observacao: DANFE sandbox gerado pela Ariana Enterprise API para homologacao.');
  lines.push('Este documento auxiliar acompanha as informacoes de NF-e recebidas pela integracao.');
  return buildSimplePdfBuffer(lines);
}

function publicEnterpriseDanfePayload(order = {}) {
  const danfe = order?.manufacturerDispatch?.danfe || null;
  if (!danfe) return null;
  const { contentBase64, ...safeDanfe } = danfe;
  return {
    ...safeDanfe,
    hasContent: Boolean(contentBase64),
    contentLength: contentBase64 ? Buffer.byteLength(Buffer.from(String(contentBase64), 'base64')) : 0,
    downloadPath: `/api/enterprise/orders/${String(order._id || order.id || '').trim()}/danfe/download`
  };
}

export async function generateEnterpriseOrderDanfe({ orderId, invoice = {}, manufacturer = '', payload = {}, partner = null } = {}) {
  const Order = getOrderModel();
  const query = buildEnterpriseOrderLookup(orderId);
  const order = await Order.findOne(query).lean();
  if (!order) throw new Error('Pedido não encontrado para gerar DANFE');

  const invoicePayload = buildEnterpriseInvoicePayload(invoice, order);
  const environment = partner?.environment || payload?.environment || 'sandbox';
  const pdfBuffer = generateEnterpriseDanfePdfBuffer(order, invoicePayload, {
    orderId,
    manufacturer: manufacturer || payload?.manufacturer || order.manufacturer,
    environment
  });
  const pdfHash = crypto.createHash('sha256').update(pdfBuffer).digest('hex');
  const filename = buildEnterpriseDanfeFilename(order, { invoice: invoicePayload });
  const danfePayload = {
    status: 'generated',
    filename,
    contentType: 'application/pdf',
    contentBase64: pdfBuffer.toString('base64'),
    pdfHash,
    invoice: invoicePayload,
    generatedAt: new Date(),
    generatedBy: partner?.requestId || partner?.companyName || 'enterprise_api',
    environment,
    source: 'enterprise_api_danfe_module'
  };

  const updated = await Order.findOneAndUpdate(query, {
    $set: {
      'manufacturerDispatch.invoice': invoicePayload,
      'manufacturerDispatch.danfe': danfePayload,
      'manufacturerDispatch.danfeGeneratedAt': new Date(),
      status_integracao: 'danfe_generated',
      updatedAt: new Date()
    }
  }, { new: true }).lean();

  await IntegrationAuditLog.create({
    eventType: 'enterprise_danfe_generated',
    manufacturer: normalizeManufacturer(manufacturer || updated?.manufacturer || order.manufacturer || ''),
    orderId: String(updated?._id || order._id || orderId),
    status: 'ok',
    request: payload,
    response: { filename, pdfHash, invoice: invoicePayload },
    metadata: { environment, partner: partner?.requestId || '' }
  });

  return { danfe: publicEnterpriseDanfePayload(updated), orderId: String(updated?._id || order._id || orderId) };
}

export async function getEnterpriseOrderDanfe({ orderId, manufacturer = '', partner = null } = {}) {
  const Order = getOrderModel();
  const order = await Order.findOne(buildEnterpriseOrderLookup(orderId)).lean();
  if (!order) throw new Error('Pedido não encontrado');
  const danfe = publicEnterpriseDanfePayload(order);
  if (!danfe) throw new Error('DANFE ainda não foi gerado para este pedido');

  await IntegrationAuditLog.create({
    eventType: 'enterprise_danfe_consulted',
    manufacturer: normalizeManufacturer(manufacturer || order.manufacturer || ''),
    orderId: String(order._id || order.id || orderId),
    status: 'ok',
    response: { filename: danfe.filename, pdfHash: danfe.pdfHash },
    metadata: { partner: partner?.requestId || '' }
  }).catch(() => null);

  return { danfe, orderId: String(order._id || order.id || orderId) };
}

export async function downloadEnterpriseOrderDanfe({ orderId, manufacturer = '', partner = null } = {}) {
  const Order = getOrderModel();
  const order = await Order.findOne(buildEnterpriseOrderLookup(orderId)).lean();
  if (!order) throw new Error('Pedido não encontrado');
  const danfe = order?.manufacturerDispatch?.danfe || null;
  if (!danfe?.contentBase64) throw new Error('DANFE ainda não foi gerado para este pedido');

  await IntegrationAuditLog.create({
    eventType: 'enterprise_danfe_downloaded',
    manufacturer: normalizeManufacturer(manufacturer || order.manufacturer || ''),
    orderId: String(order._id || order.id || orderId),
    status: 'ok',
    response: { filename: danfe.filename || buildEnterpriseDanfeFilename(order, danfe), pdfHash: danfe.pdfHash || '' },
    metadata: { partner: partner?.requestId || '' }
  }).catch(() => null);

  const pdfBuffer = Buffer.from(String(danfe.contentBase64 || ''), 'base64');
  return {
    filename: danfe.filename || buildEnterpriseDanfeFilename(order, danfe),
    pdfBuffer,
    pdfHash: danfe.pdfHash || crypto.createHash('sha256').update(pdfBuffer).digest('hex')
  };
}

export async function regenerateEnterpriseOrderDanfe({ orderId, invoice = {}, manufacturer = '', payload = {}, partner = null } = {}) {
  const result = await generateEnterpriseOrderDanfe({ orderId, invoice, manufacturer, payload: { ...(payload || {}), regenerate: true }, partner });
  await IntegrationAuditLog.create({
    eventType: 'enterprise_danfe_regenerated',
    manufacturer: normalizeManufacturer(manufacturer || payload?.manufacturer || ''),
    orderId: String(orderId || ''),
    status: 'ok',
    response: { pdfHash: result?.danfe?.pdfHash || '' },
    metadata: { partner: partner?.requestId || '' }
  }).catch(() => null);
  return result;
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
