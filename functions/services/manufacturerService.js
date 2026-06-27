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


function escapeXml(value = '') {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function onlyXmlDigits(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function formatXmlDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function buildEnterpriseOrderLookup(orderId = '') {
  const safeOrderId = String(orderId || '').trim();
  if (!safeOrderId) throw new Error('orderId é obrigatório');

  if (mongoose.Types.ObjectId.isValid(safeOrderId)) {
    return { _id: new mongoose.Types.ObjectId(safeOrderId) };
  }

  return {
    $or: [
      { 'manufacturerDispatch.externalOrderId': safeOrderId },
      { trackingCode: safeOrderId },
      { 'manufacturerDispatch.invoice.number': safeOrderId },
      { 'manufacturerDispatch.invoice.key': safeOrderId }
    ]
  };
}

function getOrderPublicId(order = {}, fallback = '') {
  return String(
    order?.manufacturerDispatch?.externalOrderId ||
    order?._id ||
    order?.id ||
    fallback ||
    ''
  ).trim();
}

function buildEnterpriseOrderXml(order = {}, options = {}) {
  const invoice = order?.manufacturerDispatch?.invoice || {};
  const orderId = getOrderPublicId(order, options.orderId);
  const invoiceNumber = String(invoice.number || options.invoiceNumber || orderId || '').trim();
  const invoiceSerie = String(invoice.serie || invoice.series || options.serie || '1').trim();
  const invoiceKey = String(invoice.key || options.key || '').trim();
  const manufacturer = normalizeManufacturer(options.manufacturer || order.manufacturer || order?.manufacturerDispatch?.manufacturer || '');
  const issuedAt = formatXmlDate(invoice.issuedAt || options.issuedAt || new Date());
  const total = parseMoneyBR(order.total ?? 0).toFixed(2);
  const subtotal = parseMoneyBR(order.subtotal ?? 0).toFixed(2);
  const shippingCost = parseMoneyBR(order.shippingCost ?? 0).toFixed(2);
  const address = order.shippingAddress || {};
  const items = Array.isArray(order.items) ? order.items : [];

  const itemsXml = items.map((item, index) => {
    const qty = Number(item.qty || item.quantity || 1) || 1;
    const unit = parseMoneyBR(item.unitPrice ?? item.price ?? 0);
    const itemTotal = parseMoneyBR(item.totalPrice ?? (unit * qty));
    return `      <item>
        <nItem>${index + 1}</nItem>
        <sku>${escapeXml(item.sku || item.productId || '')}</sku>
        <nome>${escapeXml(item.name || item.nome || 'Produto')}</nome>
        <quantidade>${qty}</quantidade>
        <valorUnitario>${unit.toFixed(2)}</valorUnitario>
        <valorTotal>${itemTotal.toFixed(2)}</valorTotal>
        <sellerId>${escapeXml(item.sellerId || manufacturer)}</sellerId>
      </item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<arianaMarketplace>
  <enterpriseXml versao="1.0">
    <identificacao>
      <orderId>${escapeXml(orderId)}</orderId>
      <ambiente>${escapeXml(options.environment || 'sandbox')}</ambiente>
      <fabricante>${escapeXml(manufacturer || 'enterprise')}</fabricante>
      <numero>${escapeXml(invoiceNumber)}</numero>
      <serie>${escapeXml(invoiceSerie)}</serie>
      <chave>${escapeXml(invoiceKey)}</chave>
      <emitidoEm>${issuedAt}</emitidoEm>
      <status>${escapeXml(order.status || '')}</status>
      <statusIntegracao>${escapeXml(order.status_integracao || '')}</statusIntegracao>
    </identificacao>
    <cliente>
      <nome>${escapeXml(order.customerName || address.name || '')}</nome>
      <email>${escapeXml(order.customerEmail || '')}</email>
      <telefone>${escapeXml(onlyXmlDigits(order.customerPhone || address.phone || ''))}</telefone>
    </cliente>
    <entrega>
      <cep>${escapeXml(onlyXmlDigits(address.cep || ''))}</cep>
      <logradouro>${escapeXml(address.logradouro || address.street || '')}</logradouro>
      <numero>${escapeXml(address.numero || address.number || '')}</numero>
      <bairro>${escapeXml(address.bairro || address.district || '')}</bairro>
      <cidade>${escapeXml(address.cidade || address.city || '')}</cidade>
      <uf>${escapeXml(address.uf || address.state || '')}</uf>
      <complemento>${escapeXml(address.complemento || address.complement || '')}</complemento>
    </entrega>
    <itens>
${itemsXml || '      '}
    </itens>
    <totais>
      <subtotal>${subtotal}</subtotal>
      <frete>${shippingCost}</frete>
      <total>${total}</total>
      <moeda>${escapeXml(order.currency || 'BRL')}</moeda>
    </totais>
  </enterpriseXml>
</arianaMarketplace>`;
}

function buildEnterpriseXmlFilename(order = {}, fallbackOrderId = '') {
  const raw = getOrderPublicId(order, fallbackOrderId) || `pedido_${Date.now()}`;
  const safe = String(raw).replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'pedido';
  return `ariana-enterprise-${safe}.xml`;
}

export async function generateEnterpriseOrderXml({ orderId, manufacturer = '', force = false, payload = {} } = {}) {
  const Order = getOrderModel();
  const query = buildEnterpriseOrderLookup(orderId);
  const order = await Order.findOne(query).lean();
  if (!order) throw new Error('Pedido não encontrado para gerar XML');

  const currentXml = String(order?.manufacturerDispatch?.invoice?.xmlContent || '').trim();
  if (currentXml && !force) {
    const filename = buildEnterpriseXmlFilename(order, orderId);
    return {
      generated: false,
      reused: true,
      orderId: getOrderPublicId(order, orderId),
      filename,
      hash: order?.manufacturerDispatch?.invoice?.xmlHash || crypto.createHash('sha256').update(currentXml).digest('hex'),
      xml: currentXml
    };
  }

  const xml = buildEnterpriseOrderXml(order, {
    orderId,
    manufacturer: manufacturer || order.manufacturer,
    environment: payload?.environment || payload?.ambiente || 'sandbox',
    invoiceNumber: payload?.number || payload?.numero,
    serie: payload?.serie,
    key: payload?.key || payload?.chave,
    issuedAt: payload?.issuedAt || payload?.emissao
  });

  const hash = crypto.createHash('sha256').update(xml).digest('hex');
  const filename = buildEnterpriseXmlFilename(order, orderId);
  const invoicePatch = {
    ...(order?.manufacturerDispatch?.invoice || {}),
    xmlContent: xml,
    xmlHash: hash,
    xmlFilename: filename,
    xmlGeneratedAt: new Date(),
    xmlGeneratedBy: 'enterprise_api',
    xmlStatus: 'generated'
  };

  const doc = await Order.findOneAndUpdate(query, {
    $set: {
      'manufacturerDispatch.invoice': invoicePatch,
      'manufacturerDispatch.xmlGeneratedAt': new Date(),
      status_integracao: order.status_integracao || 'xml_generated',
      updatedAt: new Date()
    }
  }, { new: true }).lean();

  await IntegrationAuditLog.create({
    eventType: 'enterprise_order_xml_generated',
    manufacturer: normalizeManufacturer(manufacturer || order.manufacturer || ''),
    orderId: String(order._id || order.id || orderId),
    status: 'ok',
    request: payload,
    response: { filename, hash }
  });

  return {
    generated: true,
    reused: false,
    orderId: getOrderPublicId(doc || order, orderId),
    filename,
    hash,
    xml
  };
}

export async function getEnterpriseOrderXml({ orderId, manufacturer = '', autoGenerate = true } = {}) {
  const Order = getOrderModel();
  const query = buildEnterpriseOrderLookup(orderId);
  const order = await Order.findOne(query).lean();
  if (!order) throw new Error('Pedido não encontrado');

  const invoice = order?.manufacturerDispatch?.invoice || {};
  const xml = String(invoice.xmlContent || '').trim();
  if (!xml && autoGenerate) {
    return generateEnterpriseOrderXml({ orderId, manufacturer: manufacturer || order.manufacturer, force: false, payload: { source: 'auto_get_xml' } });
  }

  if (!xml) throw new Error('XML ainda não foi gerado para este pedido');

  return {
    generated: false,
    reused: true,
    orderId: getOrderPublicId(order, orderId),
    filename: invoice.xmlFilename || buildEnterpriseXmlFilename(order, orderId),
    hash: invoice.xmlHash || crypto.createHash('sha256').update(xml).digest('hex'),
    generatedAt: invoice.xmlGeneratedAt || null,
    xml
  };
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
