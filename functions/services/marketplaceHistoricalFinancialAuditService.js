export function summarizeMarketplaceOrderFinancials(order = {}) {
  const items = Array.isArray(order?.items) ? order.items : [];
  const total = Number(order?.total || 0);
  const itemTotal = items.reduce((sum, item) => sum + Number(item?.totalPrice || 0), 0);
  return {
    total,
    itemTotal: Math.round((itemTotal + Number.EPSILON) * 100) / 100,
    divergent: total > 0 && itemTotal > total + 0.01
  };
}
