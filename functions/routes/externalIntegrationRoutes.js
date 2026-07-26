// ============================================================
// ROTAS DE INTEGRAÇÕES EXTERNAS - SIGE / FABRICANTES
// Extraído de legacyRoutes.js na Etapa 18.
// Objetivo: manter o legacyRoutes.js apenas registrando módulos,
// sem chamadas diretas de app.use para integrações externas.
// ============================================================

export default function registerExternalIntegrationRoutes(app, context = {}) {
  const {
    adminRequired,
    Order,
    Product,
    User,
    Setting,
    IntegrationAuditLog,
    EnterpriseBillingRecord,
    redact,
    createSigeRoutes,
    manufacturerIntegrationRoutes
  } = context;

  // ============================================================
  // SIGE CLOUD ERP - MÓDULO ISOLADO
  // Rotas e serviços separados em routes/sige e services/sige.
  // Mantém o servidor preservado e registra apenas o módulo.
  // ============================================================
  if (typeof createSigeRoutes === 'function') {
    app.use('/api', createSigeRoutes({
      adminRequired,
      Order,
      Product,
      User,
      Setting,
      IntegrationAuditLog,
      EnterpriseBillingRecord,
      redact
    }));
  }

  // ============================================================
  // Integrações empresariais de fabricantes/sellers grandes.
  // ============================================================
  if (manufacturerIntegrationRoutes) {
    app.use('/api/enterprise', manufacturerIntegrationRoutes);
  }
}
