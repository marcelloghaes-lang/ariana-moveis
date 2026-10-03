// Ariana Pay — projetor de pedidos para shadow ledger.
// Não lê banco nem chama gateway. Recebe dependências por injeção para manter a Fase 1 isolada.

import { buildShadowLedgerEntries } from './arianaPayShadowLedgerService.js';

function uniqueSellerIds(order = {}) {
  const ids = new Set();

  for (const id of Array.isArray(order.sellerIds) ? order.sellerIds : []) {
    const clean = String(id || '').trim();
    if (clean) ids.add(clean);
  }

  for (const item of Array.isArray(order.items) ? order.items : []) {
    const clean = String(item?.sellerId || item?.seller_id || '').trim();
    if (clean) ids.add(clean);
  }

  return [...ids];
}

export function projectOrderToShadowLedger({
  order = {},
  productBaseMap = new Map(),
  getSettlement,
  availableAt = null,
  releaseForSeller = null
} = {}) {
  if (typeof getSettlement !== 'function') {
    throw new TypeError('getSettlement é obrigatório.');
  }

  const orderId = String(order._id || order.id || order.orderId || '').trim();
  if (!orderId) throw new Error('Pedido sem identificador.');

  const sellerIds = uniqueSellerIds(order);
  const sellers = [];
  const entries = [];
  const divergences = [];

  for (const sellerId of sellerIds) {
    const settlement = getSettlement(order, sellerId, productBaseMap);
    const release = typeof releaseForSeller === 'function'
      ? releaseForSeller(order, sellerId, settlement)
      : null;
    const sellerAvailableAt = release?.availableAt ?? availableAt;
    const ledger = buildShadowLedgerEntries({
      order,
      sellerId,
      settlement,
      availableAt: sellerAvailableAt,
      release
    });

    sellers.push({
      sellerId,
      settlement,
      ledgerSummary: ledger.summary,
      expectedNet: ledger.expectedNet,
      reconciliation: ledger.reconciliation,
      release
    });

    entries.push(...ledger.entries);

    if (!ledger.reconciliation.ok) {
      divergences.push({
        sellerId,
        difference: ledger.reconciliation.difference,
        expectedNet: ledger.expectedNet,
        ledgerNet: ledger.summary.net
      });
    }
  }

  return {
    mode: 'shadow',
    orderId,
    sellerCount: sellerIds.length,
    sellers,
    entries,
    ok: divergences.length === 0,
    divergences
  };
}

export function projectOrdersToShadowLedger({
  orders = [],
  productBaseMap = new Map(),
  getSettlement,
  availableAtForOrder = null,
  releaseForSeller = null
} = {}) {
  const projected = [];
  const divergences = [];

  for (const order of Array.isArray(orders) ? orders : []) {
    const availableAt = typeof availableAtForOrder === 'function'
      ? availableAtForOrder(order)
      : availableAtForOrder;

    const result = projectOrderToShadowLedger({
      order,
      productBaseMap,
      getSettlement,
      availableAt,
      releaseForSeller
    });

    projected.push(result);
    divergences.push(...result.divergences.map((item) => ({
      orderId: result.orderId,
      ...item
    })));
  }

  return {
    mode: 'shadow',
    orderCount: projected.length,
    projected,
    ok: divergences.length === 0,
    divergences
  };
}

export const __test = { uniqueSellerIds };

export default {
  projectOrderToShadowLedger,
  projectOrdersToShadowLedger
};
