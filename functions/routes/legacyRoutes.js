import registerLegacyRuntimeRoutes from './legacyRuntimeRoutes.js';

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

  if (!mongoose.models.EnterpriseSandboxProduct) {
    const sandboxProductSchema = new mongoose.Schema({
      sku: { type: String, index: true },
      sellerId: { type: String, index: true },
      sellerIds: [{ type: String }],
      sellerName: String,
      brand: String,
      name: String,
      description: String,
      price: Number,
      stock: Number,
      active: { type: Boolean, default: true },
      images: [mongoose.Schema.Types.Mixed],
      metadata: mongoose.Schema.Types.Mixed,
      status_integracao: String
    }, { timestamps: true, versionKey: false, strict: false });

    sandboxProductSchema.index({ sku: 1, sellerId: 1 }, { unique: false });
    mongoose.model('EnterpriseSandboxProduct', sandboxProductSchema, 'enterprise_sandbox_products');
  }

  if (!mongoose.models.EnterpriseSandboxOrder) {
    const sandboxOrderSchema = new mongoose.Schema({
      sellerIds: [{ type: String }],
      customerName: String,
      customerEmail: String,
      customerPhone: String,
      status: { type: String, index: true },
      statusLabel: String,
      items: [mongoose.Schema.Types.Mixed],
      subtotal: Number,
      total: Number,
      currency: String,
      shippingAddress: mongoose.Schema.Types.Mixed,
      manufacturer: { type: String, index: true },
      manufacturerDispatch: mongoose.Schema.Types.Mixed,
      status_integracao: { type: String, index: true },
      invoice: mongoose.Schema.Types.Mixed,
      tracking: mongoose.Schema.Types.Mixed,
      metadata: mongoose.Schema.Types.Mixed
    }, { timestamps: true, versionKey: false, strict: false });

    sandboxOrderSchema.index({ manufacturer: 1, 'manufacturerDispatch.externalOrderId': 1 });
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

  ensureEnterpriseSandboxModels(context);

  return {
    ...context,
    productSchema,
    orderSchema
  };
}

export default function registerLegacyRoutes(app, context = {}) {
  const runtimeContext = buildRuntimeContext(context);
  const result = registerLegacyRuntimeRoutes(app, runtimeContext);
  prioritizeSpecificAdminRoutes(app);
  return result;
}
