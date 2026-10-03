// Ariana Pay — auditoria read-only sobre pedidos reais.
// Este serviço apenas consulta pedidos e calcula projeções em memória.
// Não grava ledger, saldo, payout, pedido ou gateway.

import { projectOrdersToShadowLedger } from './arianaPayShadowProjectorService.js';
import { deriveSellerBalance } from './arianaPayBalanceService.js';

const APPROVED_STATUS_TOKENS = [
  'pago',
  'paid',
  'approved',
  'aprovado',
  'pagamento_confirmado',
  'pagamento confirmado',
  'enviado',
  'shipped',
  'entregue',
  'delivered'
];

function statusText(order = {}) {
  return String(order.statusLabel || order.status || '').trim().toLowerCase();
}

export function isFinanciallyEligibleOrder(order = {}) {
  const value = statusText(order);
  return APPROVED_STATUS_TOKENS.some((token) => value.includes(token));
}

function sellerIdsFromOrders(orders = []) {
  const ids = new Set();
  for (const order of Array.isArray(orders) ? orders : []) {
    for (const id of Array.isArray(order?.sellerIds) ? order.sellerIds : []) {
      const clean = String(id || '').trim();
      if (clean) ids.add(clean);
    }
    for (const item of Array.isArray(order?.items) ? order.items : []) {
      const clean = String(item?.sellerId || item?.seller_id || '').trim();
      if (clean) ids.add(clean);
    }
  }
  return [...ids];
}

export function summarizeProjectedAudit(projectedBatch = {}, { now = new Date() } = {}) {
  const bySellerEntries = new Map();

  for (const projection of Array.isArray(projectedBatch.projected) ? projectedBatch.projected : []) {
    for (const entry of Array.isArray(projection.entries) ? projection.entries : []) {
      const sellerId = String(entry?.sellerId || '').trim();
      if (!sellerId) continue;
      if (!bySellerEntries.has(sellerId)) bySellerEntries.set(sellerId, []);
      bySellerEntries.get(sellerId).push(entry);
    }
  }

  const sellers = [...bySellerEntries.entries()]
    .map(([sellerId, entries]) => ({
      sellerId,
      entryCount: entries.length,
      balance: deriveSellerBalance(entries, { now })
    }))
    .sort((a, b) => b.balance.totalEquity - a.balance.totalEquity);

  const totals = sellers.reduce((acc, seller) => {
    acc.pending += Number(seller.balance.pending || 0);
    acc.available += Number(seller.balance.available || 0);
    acc.reserved += Number(seller.balance.reserved || 0);
    acc.paid += Number(seller.balance.paid || 0);
    acc.totalEquity += Number(seller.balance.totalEquity || 0);
    return acc;
  }, { pending: 0, available: 0, reserved: 0, paid: 0, totalEquity: 0 });

  for (const key of Object.keys(totals)) {
    totals[key] = Math.round((totals[key] + Number.EPSILON) * 100) / 100;
  }

  return {
    mode: 'shadow_read_only',
    sellerCount: sellers.length,
    sellers,
    totals,
    divergenceCount: Array.isArray(projectedBatch.divergences) ? projectedBatch.divergences.length : 0,
    divergences: Array.isArray(projectedBatch.divergences) ? projectedBatch.divergences : []
  };
}

export function createArianaPayShadowAuditService({
  Order,
  buildProductBasePriceMapForOrders,
  getSellerSettlementForOrder
} = {}) {
  if (!Order?.find) throw new TypeError('Order model é obrigatório.');
  if (typeof buildProductBasePriceMapForOrders !== 'function') {
    throw new TypeError('buildProductBasePriceMapForOrders é obrigatório.');
  }
  if (typeof getSellerSettlementForOrder !== 'function') {
    throw new TypeError('getSellerSettlementForOrder é obrigatório.');
  }

  async function loadEligibleOrders({ limit = 500, sellerId = '' } = {}) {
    const safeLimit = Math.max(1, Math.min(Number(limit || 500), 2000));
    const sid = String(sellerId || '').trim();
    const filter = sid
      ? { $or: [{ sellerIds: sid }, { 'items.sellerId': sid }, { 'items.seller_id': sid }] }
      : {};

    // Query estritamente de leitura.
    const docs = await Order.find(filter)
      .sort({ createdAt: -1 })
      .limit(safeLimit)
      .lean();

    return (Array.isArray(docs) ? docs : []).filter(isFinanciallyEligibleOrder);
  }

  async function audit({ limit = 500, sellerId = '', availableAtForOrder = null, now = new Date() } = {}) {
    const orders = await loadEligibleOrders({ limit, sellerId });
    const productBaseMap = await buildProductBasePriceMapForOrders(orders);

    const projectedBatch = projectOrdersToShadowLedger({
      orders,
      productBaseMap,
      getSettlement: getSellerSettlementForOrder,
      availableAtForOrder
    });

    const summary = summarizeProjectedAudit(projectedBatch, { now });

    return {
      ...summary,
      orderCount: orders.length,
      detectedSellerIds: sellerIdsFromOrders(orders),
      generatedAt: now.toISOString()
    };
  }

  return {
    loadEligibleOrders,
    audit
  };
}

export const __test = {
  statusText,
  sellerIdsFromOrders,
  APPROVED_STATUS_TOKENS
};

export default createArianaPayShadowAuditService;
