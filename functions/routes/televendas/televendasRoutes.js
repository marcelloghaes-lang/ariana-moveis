import express from 'express';
import { createTelevendasController } from '../../controllers/televendas/televendasController.js';

export default function createTelevendasRouter(context = {}) {
  const router = express.Router();

  if (!context.Order) throw new Error('[televendas] Order não informado');
  if (!context.adminRequired) throw new Error('[televendas] adminRequired não informado');
  if (!context.axios) throw new Error('[televendas] axios não informado');

  const controller = createTelevendasController(context);

  router.post('/televendas/orders', context.adminRequired, controller.createOrder);
  router.get('/televendas/orders', context.adminRequired, controller.listOrders);
  router.get('/televendas/orders/:orderId', context.adminRequired, controller.getOrder);
  router.patch('/televendas/orders/:orderId', context.adminRequired, controller.updateOrder);
  router.patch('/televendas/orders/:orderId/status', context.adminRequired, controller.updateStatus);
  router.post('/televendas/orders/:orderId/payment-link', context.adminRequired, controller.generatePaymentLink);
  router.post('/televendas/orders/:orderId/cancel', context.adminRequired, controller.cancelOrder);
  router.post('/televendas/orders/:orderId/reconcile-payment', context.adminRequired, controller.reconcilePayment);

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
