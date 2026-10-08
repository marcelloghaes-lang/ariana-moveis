import {
  DSLITE_BETO_APPROVED_SKUS,
  DSLITE_BETO_SUPPLIER_ID,
  fetchDsliteBetoCatalog,
  syncDsliteBetoShadow
} from '../services/dsliteIntegrationService.js';

export default function registerDsliteRoutes(app, context = {}) {
  const { Product, adminRequired } = context;
  if (!app || typeof app.get !== 'function') throw new Error('[dslite] Express app indisponível.');
  if (!Product) throw new Error('[dslite] Product model indisponível.');

  const guard = typeof adminRequired === 'function'
    ? adminRequired
    : (_req, res) => res.status(503).json({ ok: false, error: 'Autenticação administrativa indisponível.' });

  app.get('/api/admin/dslite/status', guard, async (_req, res) => {
    return res.json({
      ok: true,
      provider: 'dslite',
      supplier: 'Beto Móveis',
      supplierId: DSLITE_BETO_SUPPLIER_ID,
      mode: 'shadow',
      tokenConfigured: Boolean(String(process.env.DSLITE_API_TOKEN || process.env.DSLITE_TOKEN || '').trim()),
      approvedSkuCount: DSLITE_BETO_APPROVED_SKUS.length,
      writesToStorefront: false,
      pricingRequiredBeforePublish: true
    });
  });

  app.get('/api/admin/dslite/beto/preview', guard, async (_req, res) => {
    try {
      const catalog = await fetchDsliteBetoCatalog();
      return res.json({ ok: true, ...catalog });
    } catch (error) {
      console.error('[dslite][beto][preview]', error?.message || error);
      const status = error?.code === 'DSLITE_TOKEN_MISSING' ? 503 : 502;
      return res.status(status).json({
        ok: false,
        code: error?.code || 'DSLITE_PREVIEW_ERROR',
        error: error?.message || 'Falha ao consultar o catálogo DSLite.'
      });
    }
  });

  app.post('/api/admin/dslite/beto/sync-shadow', guard, async (req, res) => {
    try {
      const actor = String(req.admin?.email || req.auth?.email || req.user?.email || 'admin').trim();
      const result = await syncDsliteBetoShadow({ Product, actor });
      return res.json({
        ok: true,
        message: 'Sincronização shadow concluída. Nenhum produto foi publicado na vitrine.',
        ...result
      });
    } catch (error) {
      console.error('[dslite][beto][sync-shadow]', error?.message || error);
      const status = error?.code === 'DSLITE_TOKEN_MISSING' ? 503 : 502;
      return res.status(status).json({
        ok: false,
        code: error?.code || 'DSLITE_SYNC_SHADOW_ERROR',
        error: error?.message || 'Falha na sincronização shadow da DSLite.'
      });
    }
  });
}
