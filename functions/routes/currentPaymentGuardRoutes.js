// ============================================================
// GUARDA DE PAGAMENTOS ATUAIS - ARIANA MÓVEIS
// Operação vigente: Cielo (cartão), Mercado Pago (PIX/boleto)
// e repasse manual aos sellers, sem split automático.
//
// Este módulo NÃO remove o código histórico do Pagar.me. Ele apenas
// impede que endpoints antigos sejam usados acidentalmente enquanto
// o provedor está fora da operação comercial da Ariana.
// ============================================================

export default function registerCurrentPaymentGuardRoutes(app, context = {}) {
  const { adminRequired } = context;

  const pagarmeDisabled = (_req, res) => res.status(410).json({
    ok: false,
    provider: 'pagarme',
    code: 'PAGARME_DISABLED',
    splitRequired: false,
    manualSettlement: true,
    error: 'Pagar.me está desativado na operação atual da Ariana Móveis. Cartão é processado pela Cielo; PIX e boleto pelo Mercado Pago; sellers recebem por repasse manual, sem split automático.'
  });

  const mercadoPagoCardDisabled = (_req, res) => res.status(410).json({
    ok: false,
    provider: 'mercadopago',
    code: 'MERCADOPAGO_CARD_DISABLED',
    error: 'Cartão pelo Mercado Pago está desativado na operação atual. Use a Cielo para cartão.'
  });

  // Cartão atual é exclusivamente Cielo. Mantemos os endpoints históricos do
  // Mercado Pago no código, mas impedimos uso acidental/externo antes das rotas legadas.
  app.post('/api/payments/mp/credit', mercadoPagoCardDisabled);
  app.post('/api/payments/mp/card', mercadoPagoCardDisabled);

  // Endpoints públicos legados: permanecem existentes no código histórico,
  // porém ficam bloqueados antes do registrador legado alcançar o gateway.
  app.post('/api/payments/pagarme/pix', pagarmeDisabled);
  app.post('/api/payments/pagarme/boleto', pagarmeDisabled);
  app.post('/api/payments/pagarme/credit', pagarmeDisabled);
  app.get('/api/payments/pagarme/public-key', pagarmeDisabled);

  // Criação de recipient não faz parte da operação atual sem split.
  if (typeof adminRequired === 'function') {
    app.post('/api/admin/sellers/:sellerId/pagarme-recipient', adminRequired, pagarmeDisabled);
  } else {
    app.post('/api/admin/sellers/:sellerId/pagarme-recipient', pagarmeDisabled);
  }
}
