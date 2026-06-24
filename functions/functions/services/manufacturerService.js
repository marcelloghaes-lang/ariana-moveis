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

export async function listIntegrations() {
  return ManufacturerIntegration.find({}).sort({ manufacturer: 1 }).lean();
}

export async function upsertIntegration(input = {}, user = '') {
  const manufacturer = String(input.manufacturer || input.name || '').trim().toLowerCase();
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
    manufacturer: String(manufacturer || '').toLowerCase(),
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
    manufacturer: String(manufacturer || '').toLowerCase(),
    status: 'received',
    response: payload || {},
    metadata: { receivedAt: new Date() }
  });
}
