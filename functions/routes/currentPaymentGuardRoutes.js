import createMarketplacePricingService from '../services/marketplacePricingService.js';

// ============================================================
// GUARDA DE PAGAMENTOS ATUAIS - ARIANA MÓVEIS
// Operação vigente: Cielo (cartão), Mercado Pago (PIX/boleto)
// e repasse manual aos sellers, sem split automático.
//
// Este módulo NÃO remove o código histórico do Pagar.me. Ele apenas
// impede que endpoints antigos sejam usados acidentalmente enquanto
// o provedor está fora da operação comercial da Ariana.
//
// A guarda de integridade de /api/orders foi adicionada depois da
// auditoria Ariana Pay encontrar pedidos históricos em que o total
// persistido era muito menor que a soma dos itens atribuídos ao seller.
// Ela roda ANTES da rota legada e falha fechada; não grava nada.
// ============================================================

function money(value = 0) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 100) / 100 : 0;
}

function firstMoney(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    const n = Number(value);
    if (Number.isFinite(n)) return money(n);
  }
  return null;
}

export function calculateExpectedOrderFinancials(body = {}, productMap = new Map(), pricing = null) {
  const items = Array.isArray(body?.items) ? body.items : [];
  const method = String(body?.payment?.method || body?.paymentMethod || body?.totals?.paymentMethod || '').toLowerCase();
  const isCredit = typeof pricing?.isCreditCardPayment === 'function'
    ? pricing.isCreditCardPayment(method)
    : /card|cartao|cartão|credit/.test(method);

  let subtotal = 0;
  const normalizedItems = [];

  for (const item of items) {
    const qty = Math.max(1, Number(item?.qty || item?.quantity || 1) || 1);
    const productId = String(item?.productId || item?._id || item?.id || '').trim();
    const product = productMap instanceof Map ? productMap.get(productId) : null;

    let baseUnit = 0;
    if (product && typeof pricing?.getProductSellerBasePrice === 'function') {
      baseUnit = money(pricing.getProductSellerBasePrice(product));
    }

    // Quando o produto existe no banco, o servidor é a fonte do preço-base.
    // Quando não existe/é legado, mantemos apenas o valor informado para não
    // inventar preço novo — a rota original continua responsável pela validação.
    if (!(baseUnit > 0)) {
      baseUnit = money(
        item?.sellerBaseUnitPrice ||
        item?.sellerBasePrice ||
        item?.basePrice ||
        item?.pixPrice ||
        item?.price ||
        item?.preco ||
        item?.unitPrice ||
        0
      );
    }

    const chargedUnit = isCredit && typeof pricing?.sellerBaseToMarketplacePrice === 'function'
      ? money(pricing.sellerBaseToMarketplacePrice(baseUnit))
      : baseUnit;
    const totalPrice = money(chargedUnit * qty);
    subtotal = money(subtotal + totalPrice);

    normalizedItems.push({
      productId,
      qty,
      baseUnit,
      chargedUnit,
      totalPrice,
      source: product ? 'product_database' : 'request_fallback'
    });
  }

  const shippingCost = money(body?.shippingCost ?? body?.shipping?.price ?? body?.totals?.shippingCost ?? 0);
  const montagemCost = money(body?.montagemCost ?? body?.totals?.montagemCost ?? 0);
  const discount = Math.max(0, money(
    body?.discount ??
    body?.desconto ??
    body?.couponDiscount ??
    body?.cupomDesconto ??
    body?.totals?.discount ??
    body?.totals?.desconto ??
    0
  ));

  const expectedTotal = money(Math.max(0, subtotal + shippingCost + montagemCost - discount));
  const requestedTotal = firstMoney(body?.total, body?.totals?.total, body?.totals?.grandTotal, body?.grandTotal);
  const difference = requestedTotal === null ? null : money(requestedTotal - expectedTotal);

  return {
    subtotal,
    shippingCost,
    montagemCost,
    discount,
    expectedTotal,
    requestedTotal,
    difference,
    consistent: requestedTotal === null || Math.abs(difference) <= 0.01,
    items: normalizedItems
  };
}

export default function registerCurrentPaymentGuardRoutes(app, context = {}) {
  const { adminRequired, Product, mongoose } = context;

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

  // Guarda financeira pré-persistência. Como este módulo é registrado antes das
  // rotas legadas, uma divergência nunca chega ao Order.create().
  app.post('/api/orders', async (req, res, next) => {
    try {
      const body = req.body || {};
      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length || !Product || !mongoose?.Types?.ObjectId) return next();

      const ids = Array.from(new Set(
        items
          .map((item) => String(item?.productId || item?._id || item?.id || '').trim())
          .filter((id) => mongoose.Types.ObjectId.isValid(id))
      ));

      const products = ids.length
        ? await Product.find({ _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } })
            .select('_id price preco pixPrice sellerBasePrice sellerBaseUnitPrice basePrice precoBaseSeller precoSeller sellerId')
            .lean()
        : [];
      const productMap = new Map(products.map((product) => [String(product._id), product]));

      const pricing = createMarketplacePricingService({
        Product,
        mongoose,
        ensureArray: (value) => Array.isArray(value) ? value : [],
        toJSON: (value) => value
      });

      const check = calculateExpectedOrderFinancials(body, productMap, pricing);
      if (!check.consistent) {
        console.warn('[order-integrity] Pedido bloqueado antes da persistência', {
          expectedTotal: check.expectedTotal,
          requestedTotal: check.requestedTotal,
          difference: check.difference,
          itemCount: check.items.length
        });
        return res.status(409).json({
          ok: false,
          code: 'ORDER_FINANCIAL_INTEGRITY_MISMATCH',
          error: 'O total do pedido diverge do total calculado pelo servidor. Atualize o carrinho e tente novamente.',
          expectedTotal: check.expectedTotal,
          requestedTotal: check.requestedTotal,
          difference: check.difference
        });
      }

      // Não confiamos novamente no total enviado pelo navegador. Mesmo quando ele
      // confere, gravamos no body o total calculado pelo backend para que a rota
      // legada use exatamente a mesma fonte financeira.
      req.body.total = check.expectedTotal;
      if (req.body.totals && typeof req.body.totals === 'object') {
        req.body.totals.total = check.expectedTotal;
        req.body.totals.subtotal = check.subtotal;
      }
      req.orderFinancialIntegrity = {
        verified: true,
        source: 'server_product_database',
        expectedTotal: check.expectedTotal,
        verifiedAt: new Date().toISOString()
      };

      return next();
    } catch (error) {
      console.error('[order-integrity] Falha na validação; pedido bloqueado', error?.message || error);
      return res.status(503).json({
        ok: false,
        code: 'ORDER_FINANCIAL_INTEGRITY_CHECK_FAILED',
        error: 'Não foi possível validar os valores do pedido com segurança. Tente novamente.'
      });
    }
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
