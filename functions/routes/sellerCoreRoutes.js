import registerSellerCoreRoutesImpl from './sellerCoreRoutesImpl.js';
import createMarketplacePricingService from '../services/marketplacePricingService.js';

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

const SELLER_PROFILE_MUTATION_PATHS = new Set([
  '/api/seller/profile',
  '/api/seller/update'
]);

const APPROVED_SELLER_LOGISTICS_FIELDS = [
  'cepColeta',
  'pickupCep',
  'cep_coleta',
  'tipoLogistica',
  'shippingType',
  'transpPropria',
  'ownCarrier',
  'transportadoraPropria',
  'transportadoraNome',
  'carrierName',
  'transportadoraTelefone',
  'carrierPhone',
  'transportadoraPrazo',
  'carrierDeadline',
  'freteObs',
  'shippingNotes'
];

function isApprovedSellerRequest(req = {}) {
  const status = String(
    req.seller?.status ||
    req.seller?.metadata?.status ||
    req.seller?.metadata?.approvalStatus ||
    ''
  ).trim().toLowerCase();

  return ['approved', 'aprovado', 'ativo', 'active'].includes(status);
}

function sanitizeApprovedSellerProfileMutation(req = {}) {
  if (!isApprovedSellerRequest(req) || !req.body || typeof req.body !== 'object') return;

  const safeBody = { ...req.body };
  for (const field of APPROVED_SELLER_LOGISTICS_FIELDS) {
    delete safeBody[field];
  }
  req.body = safeBody;
}

function createSellerScopedApp(app) {
  if (!app) return app;

  return new Proxy(app, {
    get(target, property, receiver) {
      if (property === 'patch' || property === 'put') {
        return function sellerScopedProfileMutation(path, ...handlers) {
          if (SELLER_PROFILE_MUTATION_PATHS.has(String(path || '')) && handlers.length) {
            const lastIndex = handlers.length - 1;
            const finalHandler = handlers[lastIndex];

            if (typeof finalHandler === 'function') {
              handlers[lastIndex] = function guardedSellerProfileMutation(req, res, next) {
                sanitizeApprovedSellerProfileMutation(req);
                return finalHandler(req, res, next);
              };
            }
          }

          return target[property].call(target, path, ...handlers);
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

export default function registerSellerCoreRoutes(app, context = {}) {
  const pricing = createMarketplacePricingService(context);

  return registerSellerCoreRoutesImpl(createSellerScopedApp(app), {
    ...context,
    Order: createSellerScopedOrderModel(context.Order),
    buildProductBasePriceMapForOrders: context.buildProductBasePriceMapForOrders || pricing.buildProductBasePriceMapForOrders,
    getSellerSettlementForOrder: context.getSellerSettlementForOrder || pricing.getSellerSettlementForOrder
  });
}
