import express from 'express';
import { createTelevendasController } from '../../controllers/televendas/televendasController.js';
import { createErpService } from '../../services/erp/erpService.js';
import { createErpFinanceService } from '../../services/erp/erpFinanceService.js';
import { createErpProductService } from '../../services/erp/erpProductService.js';
import { createErpCashService } from '../../services/erp/erpCashService.js';

const clean = (value = '', max = 1000) => String(value ?? '').trim().slice(0, max);
const digits = (value = '') => String(value || '').replace(/\D/g, '');

function chatwootConfig(body = {}) {
  const baseUrl = clean(
    process.env.CHATWOOT_BASE_URL ||
    process.env.CHATWOOT_URL ||
    '',
    1000
  ).replace(/\/+$/, '');

  const apiToken = clean(
    process.env.CHATWOOT_API_TOKEN ||
    process.env.CHATWOOT_ACCESS_TOKEN ||
    '',
    2000
  );

  const accountId = clean(
    process.env.CHATWOOT_ACCOUNT_ID || body.accountId || body.account_id || '',
    80
  );

  return { baseUrl, apiToken, accountId };
}

async function findTelevendasOrder(Order, orderId) {
  let order = null;

  try {
    order = await Order.findById(orderId);
  } catch (_error) {}

  if (!order) {
    order = await Order.findOne({
      origin: 'televendas',
      'televendas.orderCode': clean(orderId, 100)
    });
  }

  if (!order || order.origin !== 'televendas') {
    const error = new Error('Pedido do Televendas não encontrado.');
    error.statusCode = 404;
    throw error;
  }

  return order;
}

export default function createTelevendasRouter(context = {}) {
  const router = express.Router();

  if (!context.Order) throw new Error('[televendas] Order não informado');
  if (!context.Product) throw new Error('[erp] Product não informado');
  if (!context.adminRequired) throw new Error('[televendas] adminRequired não informado');
  if (!context.axios) throw new Error('[televendas] axios não informado');

  const controller = createTelevendasController(context);
  const erp = createErpService(context);
  const erpFinance = createErpFinanceService(context);
  const erpProducts = createErpProductService(context);
  const erpCash = createErpCashService(context);

  const erpHandler = (action, successStatus = 200) => async (req, res) => {
    try {
      const result = await action(req);
      return res.status(successStatus).json({
        ok: true,
        ...(result && typeof result === 'object' && !Array.isArray(result) && !result._id && !result.id
          ? result
          : { data: result })
      });
    } catch (error) {
      console.error('[erp]', error);
      return res.status(Number(error?.statusCode || 500)).json({
        ok: false,
        error: error?.message || 'Erro no Ariana ERP.',
        code: error?.code || 'ERP_ERROR'
      });
    }
  };

  const erpActor = (req) => req.admin || req.auth || req.user || {};

  // ============================================================
  // ARIANA ERP LITE
  // Fluxo próprio: orçamento -> pedido -> venda -> faturamento.
  // Faturar gera financeiro interno e baixa estoque real; estornar restaura.
  // Não chama SIGE e não depende da disponibilidade do SIGE.
  // ============================================================
  router.get('/erp/dashboard', context.adminRequired, erpHandler(async () => ({ dashboard: await erp.dashboard() })));
  router.get('/erp/products', context.adminRequired, erpHandler(async (req) => ({ products: await erpProducts.list(req.query || {}) })));
  router.get('/erp/financeiro', context.adminRequired, erpHandler(async (req) => ({ finance: await erpFinance.list(req.query || {}) })));

  // Caixa por operador: abertura, reforço, sangria, fechamento e histórico.
  router.get('/erp/caixa', context.adminRequired, erpHandler(async (req) => ({ cash: await erpCash.current(erpActor(req)) })));
  router.get('/erp/caixa/historico', context.adminRequired, erpHandler(async (req) => ({ sessions: await erpCash.history(erpActor(req), req.query || {}) })));
  router.post('/erp/caixa/abrir', context.adminRequired, erpHandler(async (req) => ({ cash: await erpCash.open(req.body || {}, erpActor(req)) }), 201));
  router.post('/erp/caixa/reforco', context.adminRequired, erpHandler(async (req) => ({ cash: await erpCash.reinforcement(req.body || {}, erpActor(req)) })));
  router.post('/erp/caixa/sangria', context.adminRequired, erpHandler(async (req) => ({ cash: await erpCash.withdrawal(req.body || {}, erpActor(req)) })));
  router.post('/erp/caixa/fechar', context.adminRequired, erpHandler(async (req) => ({ cash: await erpCash.close(req.body || {}, erpActor(req)) })));

  router.get('/erp/orders', context.adminRequired, erpHandler(async (req) => erp.listOrders(req.query || {})));
  router.post('/erp/orders', context.adminRequired, erpHandler(async (req) => {
    await erpProducts.assertItems(req.body?.items || []);
    return { order: await erp.createOrder(req.body || {}, erpActor(req)) };
  }, 201));
  router.get('/erp/orders/:orderId', context.adminRequired, erpHandler(async (req) => ({ order: await erp.getOrder(req.params.orderId) })));
  router.patch('/erp/orders/:orderId', context.adminRequired, erpHandler(async (req) => {
    if (Array.isArray(req.body?.items)) await erpProducts.assertItems(req.body.items);
    return { order: await erp.updateOrder(req.params.orderId, req.body || {}, erpActor(req)) };
  }));
  router.post('/erp/orders/:orderId/faturar', context.adminRequired, erpHandler(async (req) => {
    const actor = erpActor(req);
    if (req.body?.requireCash === true) await erpCash.requireOpen(actor);
    const order = await erp.faturar(req.params.orderId, req.body || {}, actor);
    await erpCash.registerSale(order, actor);
    return { order };
  }));
  router.post('/erp/orders/:orderId/estornar', context.adminRequired, erpHandler(async (req) => ({ order: await erp.estornar(req.params.orderId, req.body || {}, erpActor(req)) })));
  router.post('/erp/orders/:orderId/cancelar', context.adminRequired, erpHandler(async (req) => ({ order: await erp.cancel(req.params.orderId, req.body || {}, erpActor(req)) })));
  router.post('/erp/orders/:orderId/receivables/:number/receive', context.adminRequired, erpHandler(async (req) => erpFinance.receive(req.params.orderId, req.params.number, req.body || {}, erpActor(req))));

  router.post('/televendas/orders', context.adminRequired, controller.createOrder);
  router.get('/televendas/orders', context.adminRequired, controller.listOrders);
  router.get('/televendas/orders/:orderId', context.adminRequired, controller.getOrder);
  router.patch('/televendas/orders/:orderId', context.adminRequired, controller.updateOrder);
  router.patch('/televendas/orders/:orderId/status', context.adminRequired, controller.updateStatus);
  router.post('/televendas/orders/:orderId/payment-link', context.adminRequired, controller.generatePaymentLink);
  router.post('/televendas/orders/:orderId/cancel', context.adminRequired, controller.cancelOrder);
  router.post('/televendas/orders/:orderId/reconcile-payment', context.adminRequired, controller.reconcilePayment);

  // Associa a venda à conversa que originou o atendimento no Chatwoot.
  // Nenhum token do Chatwoot é exposto ao navegador.
  router.post('/televendas/orders/:orderId/chatwoot', context.adminRequired, async (req, res) => {
    try {
      const order = await findTelevendasOrder(context.Order, req.params.orderId);
      const conversationId = clean(req.body?.conversationId || req.body?.conversation_id || '', 80);
      const accountId = clean(req.body?.accountId || req.body?.account_id || '', 80);

      if (!conversationId) {
        return res.status(400).json({ ok: false, error: 'conversationId do Chatwoot é obrigatório.' });
      }

      order.televendas = {
        ...(order.televendas || {}),
        chatwoot: {
          conversationId,
          accountId,
          inboxId: clean(req.body?.inboxId || req.body?.inbox_id || '', 80),
          contactId: clean(req.body?.contactId || req.body?.contact_id || '', 80),
          contactName: clean(req.body?.contactName || req.body?.contact_name || order.customerName || '', 180),
          contactPhone: digits(req.body?.contactPhone || req.body?.contact_phone || order.customerPhone || ''),
          contactEmail: clean(req.body?.contactEmail || req.body?.contact_email || order.customerEmail || '', 180),
          agentId: clean(req.body?.agentId || req.body?.agent_id || '', 80),
          agentName: clean(req.body?.agentName || req.body?.agent_name || '', 180),
          linkedAt: new Date()
        }
      };

      await order.save();

      return res.json({
        ok: true,
        orderId: String(order._id),
        chatwoot: order.televendas.chatwoot
      });
    } catch (error) {
      console.error('[televendas/chatwoot/link]', error);
      return res.status(Number(error?.statusCode || 500)).json({
        ok: false,
        error: error?.message || 'Erro ao vincular conversa do Chatwoot.'
      });
    }
  });

  // Envia o link de pagamento diretamente na MESMA conversa do Chatwoot.
  router.post('/televendas/orders/:orderId/chatwoot/send-payment-link', context.adminRequired, async (req, res) => {
    try {
      const order = await findTelevendasOrder(context.Order, req.params.orderId);
      const chatwoot = order.televendas?.chatwoot || {};
      const conversationId = clean(chatwoot.conversationId || req.body?.conversationId || '', 80);
      const cfg = chatwootConfig({
        accountId: chatwoot.accountId || req.body?.accountId || ''
      });

      if (!cfg.baseUrl || !cfg.apiToken) {
        return res.status(503).json({
          ok: false,
          error: 'Chatwoot não configurado no backend. Configure CHATWOOT_BASE_URL e CHATWOOT_API_TOKEN.'
        });
      }

      if (!cfg.accountId) {
        return res.status(503).json({
          ok: false,
          error: 'CHATWOOT_ACCOUNT_ID não configurado e account_id não recebido da conversa.'
        });
      }

      if (!conversationId) {
        return res.status(400).json({
          ok: false,
          error: 'Esta venda ainda não está vinculada a uma conversa do Chatwoot.'
        });
      }

      const token = clean(order.paymentLinkToken || order.payment?.paymentLinkToken || '', 400);
      if (!token) {
        return res.status(409).json({ ok: false, error: 'Gere o link de pagamento antes de enviar.' });
      }

      const frontend = clean(
        req.body?.frontendUrl || context.FRONTEND_URL || process.env.FRONTEND_URL || 'https://arianamoveis.com.br',
        1000
      ).replace(/\/+$/, '');
      const paymentLink = `${frontend}/pagamento_link.html?token=${encodeURIComponent(token)}`;
      const installments = Math.max(1, Number(order.payment?.installments || 1));
      const installmentValue = Number(order.payment?.installmentValue || order.total || 0);
      const formattedInstallment = installmentValue.toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL'
      });

      const customerFirstName = clean(order.customerName || 'cliente', 180).split(/\s+/)[0] || 'cliente';
      const content = clean(
        req.body?.content ||
        `Olá, ${customerFirstName}! Segue o link de pagamento da sua compra na Ariana Móveis:\n${paymentLink}\n\nCondição definida: ${installments}x de ${formattedInstallment}.`,
        5000
      );

      const url = `${cfg.baseUrl}/api/v1/accounts/${encodeURIComponent(cfg.accountId)}/conversations/${encodeURIComponent(conversationId)}/messages`;
      const response = await context.axios.post(url, {
        content,
        message_type: 'outgoing',
        private: false,
        content_type: 'text'
      }, {
        headers: {
          'Content-Type': 'application/json',
          api_access_token: cfg.apiToken
        },
        timeout: 20000,
        validateStatus: () => true
      });

      if (response.status < 200 || response.status >= 300) {
        console.error('[televendas/chatwoot/send]', response.status, response.data);
        return res.status(502).json({
          ok: false,
          error: `Chatwoot recusou o envio (HTTP ${response.status}).`,
          providerStatus: response.status
        });
      }

      order.televendas = {
        ...(order.televendas || {}),
        chatwoot: {
          ...(order.televendas?.chatwoot || {}),
          accountId: cfg.accountId,
          conversationId,
          lastPaymentLinkSentAt: new Date(),
          lastMessageId: clean(response.data?.id || '', 120)
        }
      };
      await order.save();

      return res.json({
        ok: true,
        paymentLink,
        conversationId,
        messageId: response.data?.id || null,
        status: response.data?.status || 'sent'
      });
    } catch (error) {
      console.error('[televendas/chatwoot/send]', error);
      return res.status(Number(error?.statusCode || 500)).json({
        ok: false,
        error: error?.message || 'Erro ao enviar link pelo Chatwoot.'
      });
    }
  });

  router.get('/televendas/payment-links/:token', controller.getPublicOrder);
  router.post('/televendas/payment-links/:token/access', controller.registerAccess);

  // O cliente envia somente cardToken/cardId. Nunca envie número completo,
  // validade ou CVV do cartão para estas rotas.
  router.post('/televendas/payment-links/:token/pix', controller.createPixPayment);
  router.post('/televendas/payment-links/:token/card', controller.createCardPayment);

  // Webhooks reais dos gateways.
  router.post('/televendas/webhooks/mercadopago', controller.mercadoPagoWebhook);
  router.post('/televendas/webhooks/pagarme', controller.pagarmeWebhook);

  if (context.authRequired) {
    router.get('/televendas/my-orders', context.authRequired, controller.listMyOrders);
  }

  return router;
}
