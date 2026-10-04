import createArianaPayShadowAuditService from '../services/arianaPay/arianaPayShadowAuditService.js';
import { extractStoredProviderPayment, reconcileOrderPayment } from '../services/arianaPay/arianaPayReconciliationService.js';
import { createMpReconciliationSandboxClient } from '../services/arianaPay/mercadoPagoReconciliationSandboxService.js';

function enabled() {
  return String(process.env.ARIANA_PAY_SHADOW_ENABLED || 'false').trim().toLowerCase() === 'true';
}

export default function registerArianaPayShadowRoutes(app, context = {}) {
  const {
    adminRequired,
    Order,
    Seller,
    axios,
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


  app.get('/api/admin/ariana-pay/reconcile-sandbox/:orderId', adminRequired, async (req, res) => {
    if (!enabled()) {
      return res.status(404).json({
        ok: false,
        code: 'ARIANA_PAY_SHADOW_DISABLED',
        error: 'Ariana Pay shadow não está habilitado neste ambiente.'
      });
    }

    try {
      const orderId = String(req.params?.orderId || '').trim();
      if (!orderId) return res.status(400).json({ ok: false, error: 'orderId é obrigatório.' });

      const order = await Order.findById(orderId).lean();
      if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado.' });

      const stored = extractStoredProviderPayment(order);
      if (String(stored.provider || '').toLowerCase() !== 'mercadopago') {
        return res.status(409).json({
          ok: false,
          code: 'ARIANA_PAY_PROVIDER_NOT_SUPPORTED_IN_SANDBOX',
          error: 'Esta consulta sandbox está preparada apenas para pagamentos Mercado Pago.'
        });
      }
      if (!stored.paymentId) {
        return res.status(409).json({
          ok: false,
          code: 'ARIANA_PAY_PROVIDER_REFERENCE_MISSING',
          error: 'O pedido não possui referência de pagamento para consultar no sandbox.'
        });
      }

      const client = createMpReconciliationSandboxClient({ axios });
      const lookup = await client.fetchPayment(stored.paymentId);
      const reconciliation = reconcileOrderPayment({
        order,
        providerRecord: lookup.providerRecord
      });

      return res.json({
        ok: true,
        feature: 'ariana_pay',
        mode: 'sandbox_read_only',
        providerQueryPerformed: true,
        writesEnabled: false,
        providerRecord: lookup.providerRecord,
        reconciliation
      });
    } catch (error) {
      const status = Number(error?.statusCode || 500);
      return res.status(status >= 400 && status < 600 ? status : 500).json({
        ok: false,
        code: error?.code || 'ARIANA_PAY_RECON_SANDBOX_ERROR',
        error: error?.message || 'Falha na conciliação sandbox.'
      });
    }
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
