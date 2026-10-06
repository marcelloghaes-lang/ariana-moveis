// ============================================================
// SERVICE DE PREÇO MARKETPLACE / SELLER
// Extraído de controllers/marketplacePricingController.js na Etapa 23.
// Objetivo: concentrar regras de preço, comissão, markup e repasse.
// ============================================================

export default function createMarketplacePricingService(context = {}) {
  const {
    Product,
    mongoose,
    ensureArray,
    toJSON
  } = context;

  const MARKETPLACE_CARD_DISCOUNT_PERCENT = Number(process.env.MARKETPLACE_CARD_DISCOUNT_PERCENT || 17);
  const MARKETPLACE_COMMISSION_PERCENT = Number(process.env.MARKETPLACE_COMMISSION_PERCENT || 12);

  function roundMoney(value = 0) {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
  }

  function getMarketplaceFactor() {
    const p = Math.min(90, Math.max(0, Number(MARKETPLACE_CARD_DISCOUNT_PERCENT || 17)));
    return roundMoney((100 - p) / 100) || 0.83;
  }

  function sellerBaseToMarketplacePrice(basePrice = 0) {
    const base = Number(basePrice || 0);
    if (!base) return 0;
    return roundMoney(base / getMarketplaceFactor());
  }

  function marketplacePriceToSellerBase(chargedPrice = 0) {
    const charged = Number(chargedPrice || 0);
    if (!charged) return 0;
    return roundMoney(charged * getMarketplaceFactor());
  }

  function isCreditCardPayment(method = '') {
    const m = String(method || '').toLowerCase();
    return m.includes('card') || m.includes('cartao') || m.includes('cartão') || m.includes('credit');
  }

  function getOrderPaymentMethod(order = {}) {
    return String(order?.payment?.method || order?.paymentMethod || order?.method || '').toLowerCase();
  }

  function getChargedItemTotal(item = {}) {
    const qty = Math.max(1, Number(item.qty || item.quantity || 1) || 1);
    return roundMoney(Number(item.totalPrice || ((Number(item.unitPrice || item.price || 0) || 0) * qty) || 0));
  }

  function getItemProductId(item = {}) {
    return String(item.productId || item._id || item.id || '').trim();
  }

  function getProductSellerBasePrice(product = {}) {
    const candidates = [
      product.sellerBasePrice,
      product.sellerBaseUnitPrice,
      product.basePrice,
      product.pixPrice,
      product.precoBaseSeller,
      product.precoSeller,
      product.preco,
      product.price
    ];

    for (const value of candidates) {
      const n = Number(value || 0);
      if (n > 0) return roundMoney(n);
    }
    return 0;
  }

  async function buildProductBasePriceMapForOrders(orders = []) {
    const ids = Array.from(new Set(
      ensureArray(orders)
        .flatMap((order) => ensureArray((toJSON(order) || order || {}).items))
        .map(getItemProductId)
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
    ));

    if (!ids.length) return new Map();

    const products = await Product.find({ _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } })
      .select('_id price preco pixPrice sellerBasePrice sellerBaseUnitPrice basePrice precoBaseSeller precoSeller sellerId')
      .lean();

    return new Map(products.map((product) => [String(product._id), {
      price: getProductSellerBasePrice(product),
      sellerId: String(product.sellerId || '').trim()
    }]));
  }

  function getItemSellerBaseTotal(item = {}, order = {}, productBaseMap = new Map()) {
    const qty = Math.max(1, Number(item.qty || item.quantity || 1) || 1);
    const chargedTotal = getChargedItemTotal(item);
    const productId = getItemProductId(item);
    const productBase = productBaseMap instanceof Map ? productBaseMap.get(productId) : null;

    // Regra principal: o preço cadastrado pelo seller no produto é a base real do repasse.
    // Exemplo: seller cadastrou R$ 700,00. O site pode cobrar R$ 843/845 no cartão,
    // mas o extrato do seller precisa partir de R$ 700,00, não do valor com acréscimo.
    if (productBase && Number(productBase.price || 0) > 0) {
      return roundMoney(Number(productBase.price || 0) * qty);
    }

    const explicitUnit = Number(item.sellerBaseUnitPrice || item.baseUnitPrice || item.basePrice || 0);
    if (explicitUnit > 0) return roundMoney(explicitUnit * qty);

    const explicitTotal = Number(item.sellerBaseTotal || item.sellerSubtotal || item.baseTotal || 0);
    if (explicitTotal > 0 && explicitTotal < chargedTotal) return roundMoney(explicitTotal);

    const markupTotal = Number(item.cardMarkupTotal || 0);
    if (markupTotal > 0 && chargedTotal > markupTotal) return roundMoney(chargedTotal - markupTotal);

    // Fallback para pedidos antigos em que o método de pagamento veio como Mercado Pago/card
    // e o pedido salvou somente o valor final cobrado ao cliente.
    if (isCreditCardPayment(getOrderPaymentMethod(order))) return marketplacePriceToSellerBase(chargedTotal);

    return roundMoney(explicitTotal > 0 ? explicitTotal : chargedTotal);
  }

  function getSellerSettlementForOrder(orderDoc = {}, sellerId = '', productBaseMap = new Map()) {
    const order = toJSON(orderDoc) || orderDoc || {};
    const sid = String(sellerId || '').trim();
    const rows = ensureArray(order.items).filter((it) => !sid || String(it?.sellerId || it?.seller_id || '').trim() === sid);
    const chargedGross = roundMoney(rows.reduce((sum, it) => sum + getChargedItemTotal(it), 0));
    const gross = roundMoney(rows.reduce((sum, it) => sum + getItemSellerBaseTotal(it, order, productBaseMap), 0));
    const cardFee = roundMoney(Math.max(0, chargedGross - gross));
    const commission = roundMoney(gross * (MARKETPLACE_COMMISSION_PERCENT / 100));
    const labels = ensureArray(order.logisticsLabels || order.labels || []);
    let labelFee = 0;
    for (const label of labels) {
      const ls = String(label?.sellerId || '').trim();
      if (sid && ls && ls !== sid) continue;
      const marketplace = label?.marketplace === true || label?.usesMarketplaceLabel === true || label?.provider === 'correios' || label?.provider === 'frenet' || label?.provider === 'ariana_local';
      if (marketplace) labelFee += Number(label?.shippingCost || label?.cost || 0) || 0;
    }
    if (!labelFee && order.etiqueta && (order.shipping?.usesArianaLogistics || order.etiqueta?.provider)) labelFee = Number(order.etiqueta.shippingCost || 0) || 0;
    labelFee = roundMoney(labelFee);
    const net = roundMoney(gross - commission - labelFee);
    return { chargedGross, gross, cardFee, commission, fee: commission, label: labelFee, net, commissionPercent: MARKETPLACE_COMMISSION_PERCENT };
  }

  return {
    MARKETPLACE_CARD_DISCOUNT_PERCENT,
    MARKETPLACE_COMMISSION_PERCENT,
    roundMoney,
    getMarketplaceFactor,
    sellerBaseToMarketplacePrice,
    marketplacePriceToSellerBase,
    isCreditCardPayment,
    getOrderPaymentMethod,
    getChargedItemTotal,
    getItemProductId,
    getProductSellerBasePrice,
    buildProductBasePriceMapForOrders,
    getItemSellerBaseTotal,
    getSellerSettlementForOrder
  };
}
