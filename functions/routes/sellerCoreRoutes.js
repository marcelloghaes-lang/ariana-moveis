import registerSellerCoreRoutesImpl from './sellerCoreRoutesImpl.js';

function patchSellerOrderQuery(query = {}) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) return query;

  const patched = { ...query };

  if (Array.isArray(patched.$and)) {
    patched.$and = patched.$and.map((item) => patchSellerOrderQuery(item));
  }

  if (Array.isArray(patched.$or)) {
    const nextOr = patched.$or.map((item) => patchSellerOrderQuery(item));
    let sellerIdValue;
    let hasSellerIds = false;
    let hasModernItemSellerId = false;
    let hasLegacyItemSellerId = false;

    for (const clause of nextOr) {
      if (!clause || typeof clause !== 'object' || Array.isArray(clause)) continue;

      if (Object.prototype.hasOwnProperty.call(clause, 'sellerIds')) {
        hasSellerIds = true;
        if (sellerIdValue === undefined) sellerIdValue = clause.sellerIds;
      }

      if (Object.prototype.hasOwnProperty.call(clause, 'items.sellerId')) {
        hasModernItemSellerId = true;
        if (sellerIdValue === undefined) sellerIdValue = clause['items.sellerId'];
      }

      if (Object.prototype.hasOwnProperty.call(clause, 'items.seller_id')) {
        hasLegacyItemSellerId = true;
      }
    }

    if (
      hasSellerIds &&
      hasModernItemSellerId &&
      !hasLegacyItemSellerId &&
      sellerIdValue !== undefined &&
      sellerIdValue !== null &&
      String(sellerIdValue).trim()
    ) {
      nextOr.push({ 'items.seller_id': sellerIdValue });
    }

    patched.$or = nextOr;
  }

  return patched;
}

function createSellerScopedOrderModel(Order) {
  if (!Order || typeof Order.find !== 'function') return Order;

  return new Proxy(Order, {
    get(target, property, receiver) {
      if (property === 'find') {
        return function sellerScopedFind(query, ...args) {
          return target.find.call(target, patchSellerOrderQuery(query), ...args);
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

export default function registerSellerCoreRoutes(app, context = {}) {
  return registerSellerCoreRoutesImpl(app, {
    ...context,
    Order: createSellerScopedOrderModel(context.Order)
  });
}
