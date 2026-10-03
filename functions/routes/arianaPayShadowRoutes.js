import createArianaPayShadowAuditService from '../services/arianaPay/arianaPayShadowAuditService.js';

function enabled() {
  return String(process.env.ARIANA_PAY_SHADOW_ENABLED || 'false').trim().toLowerCase() === 'true';
}

export default function registerArianaPayShadowRoutes(app, context = {}) {
  const {
    adminRequired,
    Order,
    Seller,
    buildProductBasePriceMapForOrders,
    getSellerSettlementForOrder
  } = context;

  if (!app?.get) throw new TypeError('Express app é obrigatório.');
  if (typeof adminRequired !== 'function') throw new TypeError('adminRequired é obrigatório.');

  const auditService = createArianaPayShadowAuditService({
    Order,
    Seller,
    buildProductBasePriceMapForOrders,
    getSellerSettlementForOrder
  });

  app.get('/api/admin/ariana-pay/shadow-audit', adminRequired, async (req, res) => {
    if (!enabled()) {
      return res.status(404).json({
        ok: false,
        code: 'ARIANA_PAY_SHADOW_DISABLED',
        error: 'Ariana Pay shadow não está habilitado neste ambiente.'
      });
    }

    try {
      const limit = Math.max(1, Math.min(Number(req.query?.limit || 500), 2000));
      const sellerId = String(req.query?.sellerId || '').trim();

      const result = await auditService.audit({
        limit,
        sellerId,
        now: new Date()
      });

      return res.json({
        ok: true,
        feature: 'ariana_pay',
        mode: 'shadow_read_only',
        writesEnabled: false,
        payoutsEnabled: false,
        interpretation: 'comparison_only_not_payout_ready',
        ...result
      });
    } catch (error) {
      console.error('[ariana-pay][shadow-audit]', error?.message || error);
      return res.status(500).json({
        ok: false,
        code: 'ARIANA_PAY_SHADOW_AUDIT_ERROR',
        error: error?.message || 'Falha na auditoria shadow da Ariana Pay.'
      });
    }
  });
}
