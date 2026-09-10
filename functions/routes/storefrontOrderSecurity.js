// ============================================================
// SEGURANÇA DE CRIAÇÃO DE PEDIDO (LOJA)
// Executa antes da rota legada de /api/orders.
// Não altera integrações Pagar.me.
// ============================================================

export default function registerStorefrontOrderSecurity(app, context = {}) {
  const { authRequired } = context;

  if (typeof authRequired !== 'function') {
    throw new Error('[ORDER SECURITY] authRequired indisponível.');
  }

  function normalizeMethod(value = '') {
    const method = String(value || '').trim().toLowerCase();
    if (!method) return '';
    if (method === 'pix' || method.includes('pix')) return 'pix';
    if (method === 'boleto' || method.includes('boleto') || method === 'bolbradesco') return 'boleto';
    if (
      method === 'card' ||
      method === 'credit' ||
      method === 'credit_card' ||
      method.includes('cartao') ||
      method.includes('cartão') ||
      method.includes('credit')
    ) return 'card';
    if (method === 'crediario_ariana' || method.includes('crediario')) return 'crediario_ariana';
    return method;
  }

  function gatewayForMethod(method = '') {
    if (method === 'card') return 'cielo';
    if (method === 'pix' || method === 'boleto') return 'mercadopago';
    if (method === 'crediario_ariana') return 'cora';
    return '';
  }

  function safeMoney(value = 0) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) return 0;
    return Math.round((amount + Number.EPSILON) * 100) / 100;
  }

  function safeQty(value = 1) {
    const qty = Number(value);
    if (!Number.isFinite(qty) || qty < 1) return 1;
    return Math.min(999, Math.max(1, Math.floor(qty)));
  }

  // O checkout público da Ariana já exige login. A API agora exige o mesmo,
  // evitando criação anônima de pedidos para esgotar/reservar estoque.
  app.post('/api/orders', authRequired, (req, res, next) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const authenticatedUserId = String(
        req.user?._id ||
        req.user?.id ||
        req.auth?.id ||
        req.auth?.userId ||
        ''
      ).trim();

      if (!authenticatedUserId) {
        return res.status(401).json({
          ok: false,
          error: 'Faça login para finalizar a compra.',
          code: 'ORDER_AUTH_REQUIRED'
        });
      }

      // Identidade do dono do pedido vem exclusivamente da sessão autenticada.
      body.userId = authenticatedUserId;
      const authenticatedEmail = String(req.user?.email || req.auth?.email || '').trim().toLowerCase();
      if (authenticatedEmail) body.customerEmail = authenticatedEmail;

      // Nunca aceita estado financeiro/status final vindo do navegador.
      body.status = 'pendente';
      body.statusLabel = 'pendente';
      body.total = 0;

      // Custos não podem ser negativos. A validação da cotação de frete é tratada
      // separadamente; aqui eliminamos manipulação aritmética por valores negativos.
      const shippingCost = safeMoney(body.shippingCost ?? body.shipping?.price ?? 0);
      const montagemCost = safeMoney(body.montagemCost ?? 0);
      body.shippingCost = shippingCost;
      body.montagemCost = montagemCost;
      if (body.shipping && typeof body.shipping === 'object') {
        body.shipping = { ...body.shipping, price: shippingCost };
      }

      // Produto, seller e preço serão reconstruídos pelo backend a partir do Mongo.
      // O navegador informa somente a identidade do item e a quantidade desejada.
      body.items = Array.isArray(body.items)
        ? body.items.map((item = {}) => ({
            productId: String(item.productId || item._id || item.id || '').trim(),
            qty: safeQty(item.qty ?? item.quantity ?? 1)
          }))
        : [];

      // Forma/provedor são determinados pela opção escolhida; IDs, status,
      // valores e respostas de gateway enviados pelo cliente são descartados.
      const method = normalizeMethod(
        body.payment?.method ||
        body.paymentMethod ||
        body.payment_method ||
        ''
      );
      const gateway = gatewayForMethod(method);
      const installmentsRaw = Number(body.payment?.installments || body.installments || 0);
      const installments = Number.isInteger(installmentsRaw) && installmentsRaw >= 1 && installmentsRaw <= 15
        ? installmentsRaw
        : undefined;

      body.payment = {};
      if (method) {
        body.payment.method = method;
        body.payment.type = method === 'card' ? 'credit_card' : method;
      }
      if (gateway) {
        body.payment.gateway = gateway;
        body.payment.provider = gateway;
        body.payment.routing = {
          cardGateway: 'cielo',
          pixBoletoGateway: 'mercadopago',
          defaultGateway: gateway
        };
      }
      if (installments) body.payment.installments = installments;

      // Fabricante/seller do pedido não é informação confiável do cliente.
      delete body.manufacturer;

      req.body = body;
      return next();
    } catch (error) {
      console.error('[ORDER SECURITY]', error?.message || error);
      return res.status(400).json({
        ok: false,
        error: 'Não foi possível validar os dados do pedido.',
        code: 'ORDER_SECURITY_VALIDATION_FAILED'
      });
    }
  });
}
