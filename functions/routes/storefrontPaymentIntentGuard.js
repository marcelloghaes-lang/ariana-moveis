// ============================================================
// STOREFRONT - FORMA DE PAGAMENTO OBRIGATÓRIA
// Fecha a possibilidade de criar /api/orders sem modalidade e depois trocar
// de preço/gateway. Não altera pedidos administrativos nem rotas legadas.
// ============================================================

function pathOnly(req = {}) {
  return String(req.path || req.originalUrl || '')
    .split('?')[0]
    .replace(/\/+$/, '');
}

function normalizeMethod(value = '') {
  const method = String(value || '').trim().toLowerCase();
  if (method.includes('pix')) return 'pix';
  if (method.includes('boleto') || method === 'bolbradesco') return 'boleto';
  if (method.includes('crediario')) return 'crediario_ariana';
  if (
    method === 'card' ||
    method === 'credit' ||
    method === 'credit_card' ||
    method.includes('cartao') ||
    method.includes('cartão') ||
    method.includes('credit')
  ) return 'card';
  return '';
}

const PROVIDER_BY_METHOD = Object.freeze({
  pix: 'mercadopago',
  boleto: 'mercadopago',
  card: 'cielo',
  crediario_ariana: 'cora'
});

export default function registerStorefrontPaymentIntentGuard(app) {
  if (!app) return;

  app.use((req, res, next) => {
    if (req.method !== 'POST' || pathOnly(req) !== '/api/orders') return next();

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const payment = body.payment && typeof body.payment === 'object' ? body.payment : {};
    const method = normalizeMethod(
      payment.method ||
      payment.type ||
      body.paymentMethod ||
      body.payment_method ||
      ''
    );

    if (!method || !PROVIDER_BY_METHOD[method]) {
      return res.status(400).json({
        ok: false,
        error: 'Selecione uma forma de pagamento válida antes de criar o pedido.',
        code: 'PAYMENT_METHOD_REQUIRED'
      });
    }

    const provider = PROVIDER_BY_METHOD[method];
    body.payment = {
      ...payment,
      provider,
      gateway: provider,
      method,
      type: method === 'card' ? 'credit_card' : method
    };
    body.paymentMethod = method;
    req.body = body;
    return next();
  });
}
