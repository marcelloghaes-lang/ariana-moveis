import { Notification } from '../models/index.js';

function toJSON(doc) {
  if (!doc) return doc;
  const obj = typeof doc.toObject === 'function' ? doc.toObject({ virtuals: true }) : { ...doc };
  if (obj._id && !obj.id) obj.id = String(obj._id);
  return obj;
}

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

export async function createAdminNotification(data = {}) {
  try {
    const title = String(data.title || 'Notificação').trim();
    const message = String(data.message || '').trim();
    if (!title && !message) return null;

    return await Notification.create({
      type: String(data.type || 'system').trim(),
      title,
      message,
      status: data.status || 'unread',
      relatedId: data.relatedId ? String(data.relatedId) : '',
      severity: data.severity || 'info',
      audience: data.audience || 'admin',
      sellerId: data.sellerId ? String(data.sellerId) : '',
      metadata: data.metadata || null
    });
  } catch (error) {
    console.error('Erro ao criar notificação administrativa:', error.message || error);
    return null;
  }
}

export async function createSellerNotification(data = {}) {
  try {
    const sellerId = String(data.sellerId || '').trim();
    const title = String(data.title || 'Notificação').trim();
    const message = String(data.message || '').trim();
    if (!sellerId || (!title && !message)) return null;

    return await Notification.create({
      type: String(data.type || 'seller_system').trim(),
      title,
      message,
      status: data.status || 'unread',
      relatedId: data.relatedId ? String(data.relatedId) : '',
      severity: data.severity || 'info',
      audience: 'seller',
      sellerId,
      metadata: data.metadata || null
    });
  } catch (error) {
    console.error('Erro ao criar notificação do seller:', error.message || error);
    return null;
  }
}

export function extractSellerIdsFromOrder(order = {}) {
  const obj = toJSON(order) || order || {};
  const ids = new Set();

  ensureArray(obj.sellerIds).forEach((id) => {
    const value = String(id || '').trim();
    if (value) ids.add(value);
  });

  ensureArray(obj.items).forEach((item) => {
    const value = String(item?.sellerId || item?.seller_id || '').trim();
    if (value) ids.add(value);
  });

  if (obj.manufacturer) ids.add(String(obj.manufacturer).trim());

  return Array.from(ids).filter(Boolean);
}

export async function createSellerOrderNotifications(orderDoc = {}, data = {}) {
  const order = toJSON(orderDoc) || orderDoc || {};
  const sellerIds = extractSellerIdsFromOrder(order);
  if (!sellerIds.length) return [];

  const orderId = String(order._id || order.id || data.orderId || '').trim();
  const orderShort = orderId ? orderId.slice(-8).toUpperCase() : '---';
  const title = data.title || '📦 Pedido atualizado';
  const message = data.message || `Pedido #${orderShort} atualizado para ${order.statusLabel || order.status || 'Atualizado'}`;

  const results = [];
  for (const sellerId of sellerIds) {
    const doc = await createSellerNotification({
      sellerId,
      type: data.type || 'seller_order_updated',
      title,
      message,
      relatedId: orderId,
      severity: data.severity || 'info',
      metadata: {
        orderId,
        status: order.status || '',
        statusLabel: order.statusLabel || '',
        trackingCode: order.trackingCode || '',
        origin: data.origin || '',
        total: order.total || 0
      }
    });
    if (doc) results.push(doc);
  }
  return results;
}
