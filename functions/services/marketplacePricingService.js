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

  const MARKETPLACE_CARD_FACTOR = Number(process.env.MARKETPLACE_CARD_FACTOR || 0.827);
  const MARKETPLACE_CARD_DISCOUNT_PERCENT = Math.round((1 - MARKETPLACE_CARD_FACTOR) * 10000) / 100;
  const MARKETPLACE_COMMISSION_PERCENT = Number(process.env.MARKETPLACE_COMMISSION_PERCENT || 12);

  function roundMoney(value = 0) {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
  }

  function getMarketplaceFactor() {
    const factor = Number(MARKETPLACE_CARD_FACTOR || 0.827);
    if (!Number.isFinite(factor) || factor <= 0 || factor >= 1) return 0.827;
    return Math.round(factor * 10000) / 10000;
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

  function getProductSettlementProfile(product = {}) {
    const ds = product?.dropshipping && typeof product.dropshipping === 'object' ? product.dropshipping : {};
    const mode = String(ds.mode || '').trim().toLowerCase();
    const managed = ds.enabled === true && ['sale_order','dropshipping','cross_docking'].includes(mode);
    const retailCashPrice = roundMoney(Number(product.pixPrice ?? product.price ?? product.preco ?? 0) || 0);
    const supplierPayable = roundMoney(Number(ds.supplierPayableUnit ?? ds.supplierPrice ?? 0) || 0);
    const marketplaceBase = getProductSellerBasePrice(product);
    return {
      managed,
      operationMode: managed ? mode : 'marketplace_pure',
      settlementBase: managed && supplierPayable > 0 ? supplierPayable : marketplaceBase,
      retailCashPrice: retailCashPrice > 0 ? retailCashPrice : marketplaceBase
    };
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
      .select('_id price preco pixPrice sellerBasePrice sellerBaseUnitPrice basePrice precoBaseSeller precoSeller sellerId dropshipping')
      .lean();

    return new Map(products.map((product) => {
      const profile = getProductSettlementProfile(product);
      return [String(product._id), {
        price: profile.settlementBase,
        settlementBase: profile.settlementBase,
        retailCashPrice: profile.retailCashPrice,
        managed: profile.managed,
        operationMode: profile.operationMode,
        sellerId: String(product.sellerId || '').trim()
      }];
    }));
  }

  function getItemSellerBaseTotal(item = {}, order = {}, productBaseMap = new Map()) {
    const qty = Math.max(1, Number(item.qty || item.quantity || 1) || 1);
    const chargedTotal = getChargedItemTotal(item);
    const productId = getItemProductId(item);
    const productBase = productBaseMap instanceof Map ? productBaseMap.get(productId) : null;

    // Regra principal: o preço cadastrado pelo seller no produto é a base real do repasse.
    // Acréscimos de cartão/parcelamento e valores operacionais da Ariana não entram
    // na base sobre a qual o seller recebe.
    if (productBase && Number(productBase.price || 0) > 0) {
      return roundMoney(Number(productBase.price || 0) * qty);
    }

    const explicitUnit = Number(item.sellerBaseUnitPrice || item.baseUnitPrice || item.basePrice || 0);
    if (explicitUnit > 0) return roundMoney(explicitUnit * qty);

    const explicitTotal = Number(item.sellerBaseTotal || item.sellerSubtotal || item.baseTotal || 0);
    if (explicitTotal > 0 && explicitTotal <= chargedTotal) return roundMoney(explicitTotal);

    const markupTotal = Number(item.cardMarkupTotal || 0);
    if (markupTotal > 0 && chargedTotal > markupTotal) return roundMoney(chargedTotal - markupTotal);

    // Compatibilidade com pedidos antigos que salvaram somente o valor final cobrado.
    if (isCreditCardPayment(getOrderPaymentMethod(order))) return marketplacePriceToSellerBase(chargedTotal);

    return roundMoney(explicitTotal > 0 ? explicitTotal : chargedTotal);
  }

  function getSellerSettlementForOrder(orderDoc = {}, sellerId = '', productBaseMap = new Map()) {
    const order = toJSON(orderDoc) || orderDoc || {};
    const sid = String(sellerId || '').trim();
    const rows = ensureArray(order.items).filter((it) => !sid || String(it?.sellerId || it?.seller_id || '').trim() === sid);

    let chargedGross = 0;
    let gross = 0;
    let retailCashGross = 0;
    let marketplaceGross = 0;
    let managedGross = 0;
    let managedMargin = 0;

    for (const it of rows) {
      const qty = Math.max(1, Number(it.qty || it.quantity || 1) || 1);
      const charged = getChargedItemTotal(it);
      const productId = getItemProductId(it);
      const profile = productBaseMap instanceof Map ? productBaseMap.get(productId) : null;
      const settlementBaseTotal = getItemSellerBaseTotal(it, order, productBaseMap);
      const retailUnit = Number(profile?.retailCashPrice || 0);
      const retailCashTotal = retailUnit > 0
        ? roundMoney(retailUnit * qty)
        : (isCreditCardPayment(getOrderPaymentMethod(order)) ? marketplacePriceToSellerBase(charged) : charged);
      const managed = profile?.managed === true;

      chargedGross += charged;
      gross += settlementBaseTotal;
      retailCashGross += retailCashTotal;
      if (managed) {
        managedGross += settlementBaseTotal;
        managedMargin += Math.max(0, retailCashTotal - settlementBaseTotal);
      } else {
        marketplaceGross += settlementBaseTotal;
      }
    }

    chargedGross = roundMoney(chargedGross);
    gross = roundMoney(gross);
    retailCashGross = roundMoney(retailCashGross);
    marketplaceGross = roundMoney(marketplaceGross);
    managedGross = roundMoney(managedGross);
    managedMargin = roundMoney(managedMargin);

    // Comissão de marketplace existe apenas na intermediação pura.
    // Venda à ordem, dropshipping e cross docking remuneram o fornecedor pelo
    // custo/valor a pagar gravado no produto; a margem comercial fica na Ariana.
    const commission = roundMoney(marketplaceGross * (MARKETPLACE_COMMISSION_PERCENT / 100));
    const cardMarkup = roundMoney(Math.max(0, chargedGross - retailCashGross));
    const cardFee = cardMarkup;

    // A etiqueta/frete da Ariana é informativa para conciliação, mas não reduz o
    // líquido do seller/fornecedor automaticamente.
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

    const net = roundMoney(Math.max(0, gross - commission));
    const onlyManaged = managedGross > 0 && marketplaceGross <= 0;
    const mixed = managedGross > 0 && marketplaceGross > 0;
    return {
      chargedGross,
      retailCashGross,
      gross,
      marketplaceGross,
      managedGross,
      managedMargin,
      cardMarkup,
      cardFee,
      commission,
      fee: commission,
      label: labelFee,
      labelDeductedFromSeller: false,
      net,
      commissionPercent: marketplaceGross > 0 ? MARKETPLACE_COMMISSION_PERCENT : 0,
      settlementMode: mixed ? 'manual_mixed' : (onlyManaged ? 'manual_supplier_payable' : 'manual_marketplace')
    };
  }

  return {
    MARKETPLACE_CARD_FACTOR,
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
    getProductSettlementProfile,
    buildProductBasePriceMapForOrders,
    getItemSellerBaseTotal,
    getSellerSettlementForOrder
  };
}
