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

export default function registerLegacyRoutes(app, context = {}) {
  const result = registerLegacyRuntimeRoutes(app, context);
  prioritizeSpecificAdminRoutes(app);
  return result;
}
