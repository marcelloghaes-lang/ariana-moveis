import registerLegacyRuntimeRoutes from './legacyRuntimeRoutes.js';
import registerStorefrontPaymentIntentGuard from './storefrontPaymentIntentGuard.js';
import registerStorefrontPaymentSecurity from './storefrontPaymentSecurity.js';
import registerStorefrontOrderSecurity from './storefrontOrderSecurity.js';
import registerStorefrontCheckoutIntegrity from './storefrontCheckoutIntegrity.js';
import registerStorefrontStockSecurity from './storefrontStockSecurity.js';
import registerRetiredPagarmeRoutes from './retiredPagarmeRoutes.js';
import registerCredentialResponseSecurity from './credentialResponseSecurity.js';
import registerHomePerformanceRoutes from './homePerformanceRoutes.js';
import registerSeoCanonicalRoutes from './seoCanonicalRoutes.js';
import { createMercadoPagoIdempotentAxios } from '../services/mercadoPagoIdempotencyTransport.js';

// ============================================================
// ROTAS LEGADAS - ARIANA MÓVEIS
// Correção da ordem das rotas administrativas específicas.
// ============================================================

function getRoutePath(layer) {
  const path = layer?.route?.path;
  if (typeof path === 'string') return path;
  if (Array.isArray(path)) return path.filter((item) => typeof item === 'string');
  return null;
}

function pathMatches(pathValue, predicate) {
  if (typeof pathValue === 'string') return predicate(pathValue);
  if (Array.isArray(pathValue)) return pathValue.some((item) => predicate(item));
  return false;
}

function isGenericAdminRoute(pathValue) {
  return pathMatches(pathValue, (routePath) => {
    const normalized = String(routePath || '').replace(/\/+$/, '');
    return (
      normalized === '/api/admin/:collection' ||
      normalized === '/api/admin/:collection/:id'
    );
  });
}

function isSpecificAdminRoute(pathValue) {
  return pathMatches(pathValue, (routePath) => {
    const normalized = String(routePath || '');
    return (
      normalized.startsWith('/api/admin/financeiro/') ||
      normalized.startsWith('/api/admin/sige/') ||
      normalized.startsWith('/api/admin/crediario/') ||
      normalized.startsWith('/api/admin/cora/') ||
      normalized.startsWith('/api/admin/bot/')
    );
  });
}

function prioritizeSpecificAdminRoutes(app) {
  const stack = app?._router?.stack;

  if (!Array.isArray(stack) || !stack.length) {
    console.warn('[legacyRoutes] Pilha do Express indisponível.');
    return;
  }

  const specificLayers = [];
  const remainingLayers = [];

  for (const layer of stack) {
    const pathValue = getRoutePath(layer);
    if (isSpecificAdminRoute(pathValue)) specificLayers.push(layer);
    else remainingLayers.push(layer);
  }

  if (!specificLayers.length) {
    console.warn('[legacyRoutes] Nenhuma rota administrativa específica localizada.');
    return;
  }

  const genericIndex = remainingLayers.findIndex((layer) =>
    isGenericAdminRoute(getRoutePath(layer))
  );

  if (genericIndex < 0) {
    console.warn('[legacyRoutes] CRUD administrativo genérico não localizado.');
    return;
  }

  remainingLayers.splice(genericIndex, 0, ...specificLayers);
  stack.splice(0, stack.length, ...remainingLayers);

  console.log(
    `[legacyRoutes] ${specificLayers.length} rota(s) específica(s) priorizada(s) antes do CRUD genérico.`
  );
}

function ensureEnterpriseSandboxModels(context = {}) {
  const mongoose = context.mongoose;
  if (!mongoose?.Schema || typeof mongoose.model !== 'function') {
    throw new Error('[legacyRoutes] Mongoose indisponível para inicializar o Sandbox Enterprise');
  }

  const sourceProductSchema = context.productSchema || context.Product?.schema || null;
  const sourceOrderSchema = context.orderSchema || context.Order?.schema || null;

  if (!sourceProductSchema) {
    throw new Error('[legacyRoutes] productSchema indisponível para inicializar o Sandbox Enterprise');
  }
  if (!sourceOrderSchema) {
    throw new Error('[legacyRoutes] orderSchema indisponível para inicializar o Sandbox Enterprise');
  }

  // O Sandbox replica o schema operacional para que todos os campos usados em
  // catálogo, preço, estoque, imagens, logística e especificações sejam realmente
  // persistidos. As coleções continuam fisicamente separadas da produção.
  if (!mongoose.models.EnterpriseSandboxProduct) {
    const sandboxProductSchema = sourceProductSchema.clone();
    sandboxProductSchema.set('strict', false);
    sandboxProductSchema.add({
      sellerIds: [{ type: String }],
      manufacturer: { type: String, index: true },
      codigo: { type: String, index: true },
      productSku: { type: String, index: true },
      metadata: mongoose.Schema.Types.Mixed,
      status_integracao: { type: String, index: true }
    });
    sandboxProductSchema.index({ sku: 1, sellerId: 1 });
    mongoose.model('EnterpriseSandboxProduct', sandboxProductSchema, 'enterprise_sandbox_products');
  }

  // Pedidos Sandbox também mantêm paridade com o pedido real: rastreio, histórico,
  // NF-e, dados fiscais, pagamento e demais campos permanecem disponíveis sem tocar
  // na coleção pública de pedidos.
  if (!mongoose.models.EnterpriseSandboxOrder) {
    const sandboxOrderSchema = sourceOrderSchema.clone();
    sandboxOrderSchema.set('strict', false);
    sandboxOrderSchema.add({
      invoice: mongoose.Schema.Types.Mixed,
      tracking: mongoose.Schema.Types.Mixed,
      metadata: mongoose.Schema.Types.Mixed
    });
    sandboxOrderSchema.index({ manufacturer: 1, 'manufacturerDispatch.externalOrderId': 1 });
    sandboxOrderSchema.index({ manufacturer: 1, 'manufacturerDispatch.idempotencyKeyHash': 1 });
    mongoose.model('EnterpriseSandboxOrder', sandboxOrderSchema, 'enterprise_sandbox_orders');
  }
}

function buildRuntimeContext(context = {}) {
  const Product = context.Product;
  const Order = context.Order;

  const productSchema = context.productSchema || Product?.schema || null;
  const orderSchema = context.orderSchema || Order?.schema || null;

  if (!productSchema) {
    throw new Error('[legacyRoutes] productSchema indisponível para inicializar o Ariana Enterprise');
  }

  if (!orderSchema) {
    throw new Error('[legacyRoutes] orderSchema indisponível para inicializar o Ariana Enterprise');
  }

  ensureEnterpriseSandboxModels({ ...context, productSchema, orderSchema });

  return {
    ...context,
    productSchema,
    orderSchema
  };
}

export default function registerLegacyRoutes(app, context = {}) {
  const runtimeContext = buildRuntimeContext(context);
  runtimeContext.axios = createMercadoPagoIdempotentAxios(runtimeContext.axios, runtimeContext.crypto);
  registerStorefrontPaymentIntentGuard(app, runtimeContext);
  const paymentSecurity = registerStorefrontPaymentSecurity(app, runtimeContext);
  Object.assign(runtimeContext, paymentSecurity || {});
  registerStorefrontOrderSecurity(app, runtimeContext);
  registerStorefrontCheckoutIntegrity(app, runtimeContext);
  registerStorefrontStockSecurity(app, runtimeContext);
  registerRetiredPagarmeRoutes(app);
  registerCredentialResponseSecurity(app, runtimeContext);
  registerHomePerformanceRoutes(app, runtimeContext);
  registerSeoCanonicalRoutes(app, runtimeContext);
  const result = registerLegacyRuntimeRoutes(app, runtimeContext);
  prioritizeSpecificAdminRoutes(app);
  return result;
}
