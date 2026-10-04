// ============================================================
// AUDITORIA HISTÓRICA DE INTEGRIDADE FINANCEIRA DO MARKETPLACE
// Somente leitura. Não altera pedidos, extratos ou pagamentos.
// ============================================================

function money(value = 0) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 100) / 100 : 0;
}

function firstPositive(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return money(n);
  }
  return 0;
}

function orderSellerIds(order = {}) {
  const ids = new Set();
  (Array.isArray(order?.sellerIds) ? order.sellerIds : []).forEach((value) => {
    const id = String(value || '').trim();
    if (id) ids.add(id);
  });
  (Array.isArray(order?.items) ? order.items : []).forEach((item) => {
    const id = String(item?.sellerId || item?.seller_id || '').trim();
    if (id) ids.add(id);
  });
  return Array.from(ids);
}

function chargedItemTotal(item = {}) {
  const qty = Math.max(1, Number(item?.qty || item?.quantity || 1) || 1);
  const total = Number(item?.totalPrice);
  if (Number.isFinite(total) && total > 0) return money(total);
  return money((Number(item?.unitPrice || item?.price || 0) || 0) * qty);
}

function safeFinancialDiagnostics(order = {}) {
  const shipping = firstPositive(
    order?.shippingCost,
    order?.shipping?.price,
    order?.shipping?.cost,
    order?.totals?.shippingCost
  );
  const montagem = firstPositive(order?.montagemCost, order?.totals?.montagemCost);
  const discount = firstPositive(
    order?.discountTotal,
    order?.discount,
    order?.desconto,
    order?.totals?.discount,
    order?.totals?.desconto
  );
  const items = Array.isArray(order?.items) ? order.items : [];
  return {
    itemCount: items.length,
    shipping,
    montagem,
    discount,
    nonGoodsTotal: money(shipping + montagem)
  };
}

export function summarizeMarketplaceOrderFinancials(order = {}) {
  const items = Array.isArray(order?.items) ? order.items : [];
  const total = money(order?.total || order?.totals?.total || order?.totals?.grandTotal || 0);
  const itemTotal = money(items.reduce((sum, item) => sum + chargedItemTotal(item), 0));
  const sellerIds = orderSellerIds(order);
  return {
    total,
    itemTotal,
    sellerCount: sellerIds.length,
    sellerIds,
    divergent: total > 0 && itemTotal > total + 0.01
  };
}

export async function runMarketplaceHistoricalFinancialAudit({
  Order,
  pricing,
  limit = 5000,
  sampleLimit = 60
} = {}) {
  if (!Order || typeof Order.find !== 'function') {
    throw new Error('Order model indisponível para auditoria do marketplace.');
  }
  if (!pricing || typeof pricing.getSellerSettlementForOrder !== 'function') {
    throw new Error('Pricing service indisponível para auditoria do marketplace.');
  }

  const max = Math.max(1, Math.min(Number(limit || 5000), 20000));
  const docs = await Order.find({
    $or: [
      { sellerIds: { $exists: true, $ne: [] } },
      { 'items.sellerId': { $exists: true, $nin: ['', null] } }
    ]
  })
    .select('_id sellerIds items subtotal shippingCost montagemCost shipping total totals discountTotal discount desconto payment paymentMethod method createdAt')
    .sort({ createdAt: -1 })
    .limit(max)
    .lean();

  const summary = {
    ok: true,
    mode: 'read_only',
    scannedOrders: docs.length,
    ordersWithSellers: 0,
    orderItemTotalDivergences: 0,
    recoveredSellerSettlements: 0,
    blockedSellerSettlements: 0,
    consistentSellerSettlements: 0,
    multiSellerAggregateDivergences: 0,
    blockedDiagnostics: {
      singleItem: 0,
      multiItem: 0,
      withDiscount: 0,
      nonGoodsAtOrAboveOrderTotal: 0
    },
    samples: []
  };

  for (const order of docs) {
    const base = summarizeMarketplaceOrderFinancials(order);
    if (!base.sellerIds.length) continue;
    const diagnostics = safeFinancialDiagnostics(order);
    summary.ordersWithSellers += 1;
    if (base.divergent) summary.orderItemTotalDivergences += 1;

    const settlements = [];
    for (const sellerId of base.sellerIds) {
      const settlement = pricing.getSellerSettlementForOrder(order, sellerId, new Map());
      settlements.push({ sellerId, settlement });
      if (settlement?.integrityRecovered === true) {
        summary.recoveredSellerSettlements += 1;
      } else if (settlement?.integrityBlocked === true) {
        summary.blockedSellerSettlements += 1;
        if (diagnostics.itemCount === 1) summary.blockedDiagnostics.singleItem += 1;
        if (diagnostics.itemCount > 1) summary.blockedDiagnostics.multiItem += 1;
        if (diagnostics.discount > 0) summary.blockedDiagnostics.withDiscount += 1;
        if (diagnostics.nonGoodsTotal >= base.total && base.total > 0) {
          summary.blockedDiagnostics.nonGoodsAtOrAboveOrderTotal += 1;
        }
      } else {
        summary.consistentSellerSettlements += 1;
      }
    }

    const safeChargedAcrossSellers = money(settlements.reduce((sum, row) => sum + Number(row?.settlement?.chargedGross || 0), 0));
    if (base.total > 0 && base.sellerIds.length > 1 && safeChargedAcrossSellers > base.total + 0.01) {
      summary.multiSellerAggregateDivergences += 1;
    }

    const relevant = base.divergent || settlements.some((row) => row.settlement?.integrityRecovered || row.settlement?.integrityBlocked) ||
      (base.total > 0 && base.sellerIds.length > 1 && safeChargedAcrossSellers > base.total + 0.01);

    if (relevant && summary.samples.length < sampleLimit) {
      summary.samples.push({
        orderId: String(order?._id || ''),
        createdAt: order?.createdAt || null,
        orderTotal: base.total,
        rawItemTotal: base.itemTotal,
        sellerCount: base.sellerIds.length,
        itemCount: diagnostics.itemCount,
        shipping: diagnostics.shipping,
        montagem: diagnostics.montagem,
        discount: diagnostics.discount,
        nonGoodsTotal: diagnostics.nonGoodsTotal,
        safeChargedAcrossSellers,
        sellers: settlements.map((row) => ({
          sellerId: row.sellerId,
          chargedGross: money(row.settlement?.chargedGross || 0),
          gross: money(row.settlement?.gross || 0),
          net: money(row.settlement?.net || 0),
          integrityRecovered: row.settlement?.integrityRecovered === true,
          integrityBlocked: row.settlement?.integrityBlocked === true,
          reasons: Array.isArray(row.settlement?.integrityReasons) ? row.settlement.integrityReasons : []
        }))
      });
    }
  }

  console.log('[marketplace-historical-audit] SUMMARY', JSON.stringify(summary));
  return summary;
}
