// ============================================================
// CONTROLLER DE PREÇO MARKETPLACE / SELLER
// Etapa 23: lógica movida para services/marketplacePricingService.js.
// Mantém a mesma interface usada pelo legacyRuntimeRoutes.js.
// ============================================================

import createMarketplacePricingService from '../services/marketplacePricingService.js';

export default function createMarketplacePricingController(context = {}) {
  return createMarketplacePricingService(context);
}
