import { createTelevendasService } from '../../services/televendas/televendasService.js';

const fail = (res, error, fallback) => {
  if (error?.details) {
    console.error('[televendas]', error.message, error.details);
  }

  return res.status(Number(error?.statusCode || 500)).json({
    ok: false,
    error: error?.message || fallback,
    code: error?.code || undefined
  });
};

export function createTelevendasController(context = {}) {
  const service = createTelevendasService(context);

  return {
    createOrder: async (req, res) => {
      try {
        return res.status(201).json({
          ok: true,
          order: await service.createOrder(req.body, req.admin || req.auth || req.user)
        });
      } catch (error) {
        return fail(res, error, 'Erro ao criar pedido');
      }
    },

    listOrders: async (req, res) => {
      try {
        return res.json({ ok: true, ...(await service.listOrders(req.query)) });
      } catch (error) {
        return fail(res, error, 'Erro ao listar pedidos');
      }
    },

    getOrder: async (req, res) => {
      try {
        return res.json({ ok: true, order: await service.getOrder(req.params.orderId) });
      } catch (error) {
        return fail(res, error, 'Erro ao consultar pedido');
      }
    },

    updateOrder: async (req, res) => {
      try {
        return res.json({
          ok: true,
          order: await service.updateOrder(
            req.params.orderId,
            req.body,
            req.admin || req.auth || req.user
          )
        });
      } catch (error) {
        return fail(res, error, 'Erro ao atualizar pedido');
      }
    },

    updateStatus: async (req, res) => {
      try {
        return res.json({
          ok: true,
          order: await service.updateStatus(
            req.params.orderId,
            req.body,
            req.admin || req.auth || req.user
          )
        });
      } catch (error) {
        return fail(res, error, 'Erro ao atualizar status');
      }
    },

    generatePaymentLink: async (req, res) => {
      try {
        return res.json({
          ok: true,
          ...(await service.generatePaymentLink(
            req.params.orderId,
            req.body,
            req.admin || req.auth || req.user
          ))
        });
      } catch (error) {
        return fail(res, error, 'Erro ao gerar link');
      }
    },

    cancelOrder: async (req, res) => {
      try {
        return res.json({
          ok: true,
          order: await service.cancelOrder(
            req.params.orderId,
            req.body,
            req.admin || req.auth || req.user
          )
        });
      } catch (error) {
        return fail(res, error, 'Erro ao cancelar pedido');
      }
    },

    getPublicOrder: async (req, res) => {
      try {
        return res.json({
          ok: true,
          order: await service.getPublicOrder(req.params.token)
        });
      } catch (error) {
        return fail(res, error, 'Link inválido');
      }
    },

    registerAccess: async (req, res) => {
      try {
        return res.json({
          ok: true,
          order: await service.registerAccess(req.params.token, req)
        });
      } catch (error) {
        return fail(res, error, 'Erro ao registrar acesso');
      }
    },

    createPixPayment: async (req, res) => {
      try {
        return res.status(201).json({
          ok: true,
          ...(await service.createPixPayment(req.params.token, req.body || {}, req))
        });
      } catch (error) {
        return fail(res, error, 'Erro ao gerar PIX');
      }
    },

    createCardPayment: async (req, res) => {
      try {
        return res.status(201).json({
          ok: true,
          ...(await service.createCardPayment(req.params.token, req.body || {}, req))
        });
      } catch (error) {
        return fail(res, error, 'Erro ao processar cartão');
      }
    },

    mercadoPagoWebhook: async (req, res) => {
      try {
        const result = await service.mercadoPagoWebhook({
          headers: req.headers,
          query: req.query,
          body: req.body
        });
        return res.status(200).json({ ok: true, ...result });
      } catch (error) {
        return fail(res, error, 'Erro no webhook Mercado Pago');
      }
    },

    pagarmeWebhook: async (req, res) => {
      try {
        const result = await service.pagarmeWebhook({
          headers: req.headers,
          query: req.query,
          body: req.body
        });
        return res.status(200).json({ ok: true, ...result });
      } catch (error) {
        return fail(res, error, 'Erro no webhook Pagar.me');
      }
    },

    reconcilePayment: async (req, res) => {
      try {
        return res.json({
          ok: true,
          ...(await service.reconcilePayment(
            req.params.orderId,
            req.admin || req.auth || req.user
          ))
        });
      } catch (error) {
        return fail(res, error, 'Erro ao reconciliar pagamento');
      }
    },

    listMyOrders: async (req, res) => {
      try {
        return res.json({
          ok: true,
          ...(await service.listMyOrders(req.user || req.auth))
        });
      } catch (error) {
        return fail(res, error, 'Erro ao listar pedidos');
      }
    }
  };
}
