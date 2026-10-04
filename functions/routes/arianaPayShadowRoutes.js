import createArianaPayShadowAuditService from '../services/arianaPay/arianaPayShadowAuditService.js';
import { extractStoredProviderPayment, reconcileOrderPayment } from '../services/arianaPay/arianaPayReconciliationService.js';
import { createMpReconciliationSandboxClient } from '../services/arianaPay/mercadoPagoReconciliationSandboxService.js';
import { createMercadoPago3dsSandboxClient } from '../services/arianaPay/mercadoPagoOrders3dsSandboxService.js';
import { buildArianaPayPhase1Readiness } from '../services/arianaPay/arianaPayPhase1ReadinessService.js';

function enabled() {
  return String(process.env.ARIANA_PAY_SHADOW_ENABLED || 'false').trim().toLowerCase() === 'true';
}

function shadowDisabled(res) {
  return res.status(404).json({
    ok: false,
    code: 'ARIANA_PAY_SHADOW_DISABLED',
    error: 'Ariana Pay shadow não está habilitado neste ambiente.'
  });
}

function safeStatus(error = {}) {
  const status = Number(error?.statusCode || 500);
  return status >= 400 && status < 600 ? status : 500;
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

  if (!app?.get || !app?.post) throw new TypeError('Express app com GET/POST é obrigatório.');
  if (typeof adminRequired !== 'function') throw new TypeError('adminRequired é obrigatório.');

  const auditService = createArianaPayShadowAuditService({
    Order,
    Seller,
    buildProductBasePriceMapForOrders,
    getSellerSettlementForOrder
  });


  app.get('/api/admin/ariana-pay/readiness', adminRequired, async (req, res) => {
    try {
      let audit = null;
      if (enabled()) {
        audit = await auditService.audit({
          limit: Math.max(1, Math.min(Number(req.query?.limit || 300), 1000)),
          sellerId: String(req.query?.sellerId || '').trim(),
          now: new Date()
        });
      }

      return res.json({
        ok: true,
        feature: 'ariana_pay',
        ...buildArianaPayPhase1Readiness({ audit, env: process.env })
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        code: 'ARIANA_PAY_READINESS_ERROR',
        error: error?.message || 'Falha ao avaliar readiness da Ariana Pay.'
      });
    }
  });

  app.post('/api/admin/ariana-pay/3ds-sandbox/orders', adminRequired, async (req, res) => {
    if (!enabled()) return shadowDisabled(res);

    try {
      const body = req.body || {};
      const client = createMercadoPago3dsSandboxClient({ axios });
      const created = await client.createOrder({
        orderId: String(body.orderId || body.reference || '').trim(),
        amount: Number(body.amount || 0),
        email: String(body.email || '').trim(),
        paymentMethodId: String(body.paymentMethodId || body.payment_method_id || '').trim(),
        cardToken: String(body.cardToken || body.token || '').trim(),
        installmentCount: Number(body.installmentCount || body.installments || 1),
        idempotencyKey: String(body.idempotencyKey || '').trim()
      });

      if (!created.ok) {
        const providerStatus = Number(created.statusCode || 502);
        return res.status(providerStatus >= 400 && providerStatus < 600 ? providerStatus : 502).json({
          ok: false,
          feature: 'ariana_pay',
          mode: 'sandbox_3ds',
          code: 'MP_3DS_SANDBOX_CREATE_FAILED',
          providerStatus: created.statusCode || null,
          writesEnabled: false,
          checkoutChanged: false,
          payoutsEnabled: false,
          request: created.request,
          result: created.result
        });
      }

      return res.status(created.statusCode || 201).json({
        ok: true,
        feature: 'ariana_pay',
        mode: 'sandbox_3ds',
        providerStatus: created.statusCode,
        idempotencyKey: created.idempotencyKey,
        writesEnabled: false,
        checkoutChanged: false,
        payoutsEnabled: false,
        request: created.request,
        result: created.result
      });
    } catch (error) {
      return res.status(safeStatus(error)).json({
        ok: false,
        feature: 'ariana_pay',
        mode: 'sandbox_3ds',
        code: error?.code || 'MP_3DS_SANDBOX_CREATE_ERROR',
        error: error?.message || 'Falha ao criar order 3DS sandbox.'
      });
    }
  });

  app.get('/api/admin/ariana-pay/3ds-sandbox/orders/:providerOrderId', adminRequired, async (req, res) => {
    if (!enabled()) return shadowDisabled(res);

    try {
      const client = createMercadoPago3dsSandboxClient({ axios });
      const lookup = await client.getOrder(String(req.params?.providerOrderId || '').trim());

      return res.json({
        ok: true,
        feature: 'ariana_pay',
        mode: 'sandbox_3ds_read_only',
        providerStatus: lookup.statusCode,
        writesEnabled: false,
        checkoutChanged: false,
        payoutsEnabled: false,
        result: lookup.result
      });
    } catch (error) {
      return res.status(safeStatus(error)).json({
        ok: false,
        feature: 'ariana_pay',
        mode: 'sandbox_3ds_read_only',
        code: error?.code || 'MP_3DS_SANDBOX_LOOKUP_ERROR',
        error: error?.message || 'Falha ao consultar order 3DS sandbox.'
      });
    }
  });

  app.get('/api/admin/ariana-pay/reconcile-sandbox/:orderId', adminRequired, async (req, res) => {
    if (!enabled()) return shadowDisabled(res);

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
      return res.status(safeStatus(error)).json({
        ok: false,
        code: error?.code || 'ARIANA_PAY_RECON_SANDBOX_ERROR',
        error: error?.message || 'Falha na conciliação sandbox.'
      });
    }
  });

  app.get('/api/admin/ariana-pay/shadow-audit', adminRequired, async (req, res) => {
    if (!enabled()) return shadowDisabled(res);

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
