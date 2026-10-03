// Ariana Pay — auditoria read-only sobre pedidos reais.
// Este serviço apenas consulta pedidos e calcula projeções em memória.
// Não grava ledger, saldo, payout, pedido ou gateway.

import { projectOrdersToShadowLedger } from './arianaPayShadowProjectorService.js';
import { deriveSellerBalance } from './arianaPayBalanceService.js';
import { buildReleaseSchedule } from './arianaPayReleaseScheduleService.js';
import { hadApprovedPayment, detectFinancialRisk, applyRiskToRelease } from './arianaPayRiskService.js';
import { buildPayoutBatchPreview } from './arianaPayPayoutPlannerService.js';

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
  return APPROVED_STATUS_TOKENS.some((token) => value.includes(token)) || hadApprovedPayment(order);
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
  Seller,
  buildProductBasePriceMapForOrders,
  getSellerSettlementForOrder
} = {}) {
  if (!Order?.find) throw new TypeError('Order model é obrigatório.');
  if (!Seller?.find) throw new TypeError('Seller model é obrigatório.');
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
    const detectedSellerIds = sellerIdsFromOrders(orders);
    const productBaseMap = await buildProductBasePriceMapForOrders(orders);

    const sellerDocs = detectedSellerIds.length
      ? await Seller.find({ sellerId: { $in: detectedSellerIds } }).lean()
      : [];
    const sellerMap = new Map(
      (Array.isArray(sellerDocs) ? sellerDocs : []).map((row) => [String(row.sellerId || '').trim(), row])
    );

    const projectedBatch = projectOrdersToShadowLedger({
      orders,
      productBaseMap,
      getSettlement: getSellerSettlementForOrder,
      availableAtForOrder,
      releaseForSeller: (order, sid) => {
        const baseRelease = buildReleaseSchedule({
          order,
          seller: sellerMap.get(String(sid || '').trim()) || {},
          sellerId: sid
        });
        const risk = detectFinancialRisk(order);
        return applyRiskToRelease(baseRelease, risk);
      }
    });

    const summary = summarizeProjectedAudit(projectedBatch, { now });
    const releaseStats = {
      blocked: 0,
      scheduled: 0,
      availableNow: 0,
      blockedReasons: {}
    };
    const riskStats = {
      active: 0,
      terminal: 0,
      byKind: {}
    };

    for (const projection of projectedBatch.projected || []) {
      for (const row of projection.sellers || []) {
        const release = row.release || {};
        const risk = release.risk || null;
        if (risk?.active) {
          riskStats.active += 1;
          if (risk.terminal) riskStats.terminal += 1;
          const kind = String(risk.kind || 'unknown');
          riskStats.byKind[kind] = Number(riskStats.byKind[kind] || 0) + 1;
        }
        if (release.state === 'blocked') {
          releaseStats.blocked += 1;
          const reason = String(release.reason || 'unknown');
          releaseStats.blockedReasons[reason] = Number(releaseStats.blockedReasons[reason] || 0) + 1;
          continue;
        }
        if (release.state === 'scheduled') {
          releaseStats.scheduled += 1;
          const when = release.availableAt ? new Date(release.availableAt) : null;
          if (when && !Number.isNaN(when.getTime()) && when.getTime() <= now.getTime()) {
            releaseStats.availableNow += 1;
          }
        }
      }
    }

    const payoutPreview = buildPayoutBatchPreview({
      sellers: Array.isArray(sellerDocs) ? sellerDocs : [],
      balances: summary.sellers
    });

    const payoutPlanMap = new Map(
      (payoutPreview.plans || []).map((plan) => [String(plan.sellerId || ''), plan])
    );

    const sellersWithPayout = summary.sellers.map((row) => ({
      ...row,
      payoutPreview: payoutPlanMap.get(String(row.sellerId || '')) || null
    }));

    return {
      ...summary,
      sellers: sellersWithPayout,
      orderCount: orders.length,
      detectedSellerIds,
      releaseStats,
      riskStats,
      payoutPreview: {
        mode: payoutPreview.mode,
        payoutExecutionEnabled: false,
        totalSellers: payoutPreview.totalSellers,
        readySellers: payoutPreview.readySellers,
        blockedSellers: payoutPreview.blockedSellers,
        readyAmount: payoutPreview.readyAmount
      },
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
