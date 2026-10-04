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
    const managed = ds.enabled === true && ['sale_order', 'dropshipping', 'cross_docking'].includes(mode);
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
    const tolerance = 0.01;

    // O snapshot gravado no pedido tem prioridade. O preço atual do produto
    // jamais pode sobrescrever silenciosamente um valor histórico confiável.
    const explicitTotal = Number(item.sellerBaseTotal || item.sellerSubtotal || item.baseTotal || 0);
    if (explicitTotal > 0 && explicitTotal <= chargedTotal + tolerance) {
      return roundMoney(explicitTotal);
    }

    const explicitUnit = Number(item.sellerBaseUnitPrice || item.baseUnitPrice || item.basePrice || 0);
    if (explicitUnit > 0) {
      const explicitUnitTotal = roundMoney(explicitUnit * qty);
      if (explicitUnitTotal <= chargedTotal + tolerance) return explicitUnitTotal;
    }

    const markupTotal = Number(item.cardMarkupTotal || 0);
    if (markupTotal > 0 && chargedTotal > markupTotal) {
      return roundMoney(chargedTotal - markupTotal);
    }

    // Compatibilidade com registros antigos sem snapshot. O produto atual só
    // pode ser usado como fallback se não superar o que foi efetivamente
    // cobrado no item. Caso contrário, a base atual é descartada.
    const productId = getItemProductId(item);
    const productBase = productBaseMap instanceof Map ? productBaseMap.get(productId) : null;
    if (productBase && Number(productBase.price || 0) > 0) {
      const currentBaseTotal = roundMoney(Number(productBase.price || 0) * qty);
      if (currentBaseTotal <= chargedTotal + tolerance) return currentBaseTotal;
    }

    // Compatibilidade com pedidos antigos que salvaram somente o valor final cobrado.
    if (isCreditCardPayment(getOrderPaymentMethod(order))) {
      return marketplacePriceToSellerBase(chargedTotal);
    }

    // Fail-safe: nunca ressuscitar explicitTotal inválido acima do valor cobrado.
    return roundMoney(chargedTotal);
  }

  function getOrderTotal(order = {}) {
    const candidates = [
      order?.total,
      order?.totals?.total,
      order?.totals?.grandTotal,
      order?.grandTotal,
      order?.amount
    ];
    for (const value of candidates) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) return roundMoney(n);
    }
    return 0;
  }

  function getOrderDiscount(order = {}) {
    const candidates = [
      order?.discountTotal,
      order?.discount,
      order?.desconto,
      order?.totals?.discount,
      order?.totals?.desconto
    ];
    for (const value of candidates) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) return roundMoney(n);
    }
    return 0;
  }

  function getOrderNonGoodsTotal(order = {}) {
    const shippingCandidates = [
      order?.shippingCost,
      order?.shipping?.price,
      order?.shipping?.cost,
      order?.totals?.shippingCost
    ];
    const montagemCandidates = [order?.montagemCost, order?.totals?.montagemCost];
    let shipping = 0;
    let montagem = 0;
    for (const value of shippingCandidates) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) { shipping = roundMoney(n); break; }
    }
    for (const value of montagemCandidates) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) { montagem = roundMoney(n); break; }
    }
    return { shipping, montagem, total: roundMoney(shipping + montagem) };
  }

  function getOrderSellerIds(order = {}) {
    const ids = new Set();
    ensureArray(order?.sellerIds).forEach((value) => {
      const id = String(value || '').trim();
      if (id) ids.add(id);
    });
    ensureArray(order?.items).forEach((item) => {
      const id = String(item?.sellerId || item?.seller_id || '').trim();
      if (id) ids.add(id);
    });
    return Array.from(ids);
  }

  function getSellerRows(order = {}, sellerId = '') {
    const sid = String(sellerId || '').trim();
    const allRows = ensureArray(order?.items);
    if (!sid) return allRows;

    const taggedRows = allRows.filter((item) => String(item?.sellerId || item?.seller_id || '').trim());
    const ownRows = taggedRows.filter((item) => String(item?.sellerId || item?.seller_id || '').trim() === sid);
    if (ownRows.length) return ownRows;

    // Compatibilidade com pedidos antigos de um único seller que não gravavam
    // sellerId por item.
    const sellerIds = getOrderSellerIds(order);
    if (!taggedRows.length && sellerIds.length === 1 && sellerIds[0] === sid) return allRows;
    return [];
  }

  function tryRecoverSingleItemHistoricalMismatch(order = {}, sellerId = '', rows = [], productBaseMap = new Map(), observed = {}) {
    const orderTotal = getOrderTotal(order);
    if (!(orderTotal > 0)) return null;

    // Com desconto histórico sem origem contábil do subsídio, não é seguro
    // decidir automaticamente quanto cabe ao seller.
    if (getOrderDiscount(order) > 0) return null;

    const allItems = ensureArray(order?.items);
    if (allItems.length !== 1 || rows.length !== 1) return null;

    const sellerIds = getOrderSellerIds(order);
    const sid = String(sellerId || '').trim();
    if (sellerIds.length > 1 || (sellerIds.length === 1 && sid && sellerIds[0] !== sid)) return null;

    const nonGoods = getOrderNonGoodsTotal(order);
    const recoveredChargedGross = roundMoney(orderTotal - nonGoods.total);
    if (!(recoveredChargedGross > 0) || recoveredChargedGross > orderTotal + 0.01) return null;

    const originalItem = rows[0] || {};
    const qty = Math.max(1, Number(originalItem.qty || originalItem.quantity || 1) || 1);
    const recoveredItem = {
      ...originalItem,
      unitPrice: roundMoney(recoveredChargedGross / qty),
      totalPrice: recoveredChargedGross
    };

    // Para recuperar o histórico, não usamos o preço atual do produto.
    const recoveredGross = roundMoney(getItemSellerBaseTotal(recoveredItem, order, new Map()));
    if (!(recoveredGross > 0) || recoveredGross > recoveredChargedGross + 0.01) return null;

    const productId = getItemProductId(originalItem);
    const profile = productBaseMap instanceof Map ? productBaseMap.get(productId) : null;
    const managed = profile?.managed === true;
    const recoveredRetailCashGross = isCreditCardPayment(getOrderPaymentMethod(order))
      ? recoveredGross
      : recoveredChargedGross;
    const recoveredMarketplaceGross = managed ? 0 : recoveredGross;
    const recoveredManagedGross = managed ? recoveredGross : 0;
    const recoveredManagedMargin = managed
      ? roundMoney(Math.max(0, recoveredRetailCashGross - recoveredGross))
      : 0;

    return {
      chargedGross: recoveredChargedGross,
      retailCashGross: roundMoney(recoveredRetailCashGross),
      gross: recoveredGross,
      marketplaceGross: recoveredMarketplaceGross,
      managedGross: recoveredManagedGross,
      managedMargin: recoveredManagedMargin,
      integrityRecovered: true,
      integrityRecoveryReason: 'single_item_order_total_mismatch',
      recoverySource: 'order_total_minus_shipping_and_assembly',
      orderTotal,
      observedChargedGross: roundMoney(observed.chargedGross || 0),
      observedGross: roundMoney(observed.gross || 0),
      recoveredItemCount: 1
    };
  }

  function getSellerSettlementForOrder(orderDoc = {}, sellerId = '', productBaseMap = new Map()) {
    const order = toJSON(orderDoc) || orderDoc || {};
    const sid = String(sellerId || '').trim();
    const rows = getSellerRows(order, sid);

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
      const retailCashTotal = retailUnit > 0 && roundMoney(retailUnit * qty) <= charged + 0.01
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

    const orderTotal = getOrderTotal(order);
    const integrityReasons = [];
    if (orderTotal > 0 && chargedGross > orderTotal + 0.01) {
      integrityReasons.push('seller_charged_gross_exceeds_order_total');
    }
    if (gross > chargedGross + 0.01) {
      integrityReasons.push('seller_gross_exceeds_charged_gross');
    }

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
    if (!labelFee && order.etiqueta && (order.shipping?.usesArianaLogistics || order.etiqueta?.provider)) {
      labelFee = Number(order.etiqueta.shippingCost || 0) || 0;
    }
    labelFee = roundMoney(labelFee);

    if (integrityReasons.length) {
      const recovered = integrityReasons.includes('seller_charged_gross_exceeds_order_total')
        ? tryRecoverSingleItemHistoricalMismatch(order, sid, rows, productBaseMap, { chargedGross, gross })
        : null;

      if (recovered) {
        const commission = roundMoney(recovered.marketplaceGross * (MARKETPLACE_COMMISSION_PERCENT / 100));
        const cardMarkup = roundMoney(Math.max(0, recovered.chargedGross - recovered.retailCashGross));
        const net = roundMoney(Math.max(0, recovered.gross - commission));
        const onlyManaged = recovered.managedGross > 0 && recovered.marketplaceGross <= 0;
        const mixed = recovered.managedGross > 0 && recovered.marketplaceGross > 0;
        return {
          ...recovered,
          cardMarkup,
          cardFee: cardMarkup,
          commission,
          fee: commission,
          label: labelFee,
          labelDeductedFromSeller: false,
          net,
          commissionPercent: recovered.marketplaceGross > 0 ? MARKETPLACE_COMMISSION_PERCENT : 0,
          settlementMode: mixed ? 'manual_mixed_recovered' : (onlyManaged ? 'manual_supplier_payable_recovered' : 'manual_marketplace_recovered'),
          integrityBlocked: false,
          integrityReasons: [...new Set(integrityReasons)]
        };
      }

      // Em inconsistência estrutural ambígua, não inferir nem prometer valor ao seller.
      // O pedido fica financeiramente zerado para cálculo/extrato até revisão.
      return {
        chargedGross: 0,
        retailCashGross: 0,
        gross: 0,
        marketplaceGross: 0,
        managedGross: 0,
        managedMargin: 0,
        cardMarkup: 0,
        cardFee: 0,
        commission: 0,
        fee: 0,
        label: labelFee,
        labelDeductedFromSeller: false,
        net: 0,
        commissionPercent: 0,
        settlementMode: 'blocked_integrity',
        integrityBlocked: true,
        integrityRecovered: false,
        integrityReasons: [...new Set(integrityReasons)],
        orderTotal,
        observedChargedGross: chargedGross,
        observedGross: gross
      };
    }

    // Comissão de marketplace existe apenas na intermediação pura.
    // Venda à ordem, dropshipping e cross docking remuneram o fornecedor pelo
    // custo/valor a pagar gravado no produto; a margem comercial fica na Ariana.
    const commission = roundMoney(marketplaceGross * (MARKETPLACE_COMMISSION_PERCENT / 100));
    const cardMarkup = roundMoney(Math.max(0, chargedGross - retailCashGross));
    const cardFee = cardMarkup;
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
      settlementMode: mixed ? 'manual_mixed' : (onlyManaged ? 'manual_supplier_payable' : 'manual_marketplace'),
      integrityBlocked: false,
      integrityRecovered: false,
      integrityReasons: [],
      orderTotal
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
