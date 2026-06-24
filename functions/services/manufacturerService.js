import mongoose from 'mongoose';
import axios from 'axios';
import crypto from 'crypto';

function model(name, schemaDef) {
  if (mongoose.modelNames().includes(name)) return mongoose.model(name);
  return mongoose.model(name, new mongoose.Schema(schemaDef, { timestamps: true, versionKey: false }));
}

export const ManufacturerIntegration = model('ManufacturerIntegration', {
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

export const ManufacturerDispatchQueue = model('ManufacturerDispatchQueue', {
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

export const IntegrationAuditLog = model('IntegrationAuditLog', {
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
