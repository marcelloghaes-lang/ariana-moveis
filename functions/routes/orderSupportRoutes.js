import { buildStockReservation } from '../services/stockReservationService.js';
import { createAdminNotification } from '../services/notificationService.js';

// ============================================================
// ROTAS DE PEDIDOS, TICKETS, CONTATO E DENÚNCIAS
// Extraído de legacyRoutes.js na divisão de rotas - Etapa 6.
// Mantém os mesmos endpoints, regras e respostas.
// ============================================================

export default function registerOrderSupportRoutes(app, context = {}) {
  const {
    Contact,
    Denuncia,
    Order,
    Product,
    Ticket,
    User,
    authRequired,
    calculateShipping,
    getShippingSettings,
    ensureArray,
    mongoose,
    normalizeObjectId,
    now,
    toJSON
  } = context;

  const MARKETPLACE_CARD_DISCOUNT_PERCENT = Number(process.env.MARKETPLACE_CARD_DISCOUNT_PERCENT || 17);
  function roundMoney(value = 0) { return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100; }
  function onlyDigits(value = '') { return String(value || '').replace(/\D/g, ''); }
  function getMarketplaceFactor() { const p = Math.min(90, Math.max(0, Number(MARKETPLACE_CARD_DISCOUNT_PERCENT || 17))); return roundMoney((100 - p) / 100) || 0.83; }
  function sellerBaseToMarketplacePrice(basePrice = 0) { const base = Number(basePrice || 0); if (!base) return 0; return roundMoney(base / getMarketplaceFactor()); }
  function normalizePaymentMethod(method = '') {
    const m = String(method || '').trim().toLowerCase();
    if (m === 'pix' || m.includes('pix')) return 'pix';
    if (m === 'boleto' || m.includes('boleto')) return 'boleto';
    if (m.includes('crediario') || m.includes('crediário') || m.includes('cora')) return 'crediario_ariana';
    if (m.includes('card') || m.includes('cartao') || m.includes('cartão') || m.includes('credit')) return 'card';
    return '';
  }
  function isCreditCardPayment(method = '') { return normalizePaymentMethod(method) === 'card'; }
  function usesFullMarketplacePrice(method = '') {
    const m = normalizePaymentMethod(method);
    return m === 'card' || m === 'crediario_ariana';
  }
  function firstPositive(...values) {
    for (const value of values) {
      const n = Number(value || 0);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return 0;
  }
  function normalizeCouponCode(value = '') {
    return String(value || '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9_-]+/g, '').slice(0, 40);
  }
  function paidOrderQuery() {
    return {
      $or: [
        { paymentStatus: { $in: ['approved', 'paid', 'pago', 'captured', 'authorized', 'payment_approved'] } },
        { 'payment.status': { $in: ['approved', 'paid', 'pago', 'captured', 'authorized', 'payment_approved'] } },
        { status: { $in: ['approved', 'paid', 'pago', 'payment_approved', 'processing', 'preparing', 'shipped', 'delivered', 'concluido', 'concluído'] } }
      ]
    };
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

  function normalizeOrderItemsForCheckout(body = {}) {
    const method = String(body?.payment?.method || body?.paymentMethod || body?.totals?.paymentMethod || '').toLowerCase();
    const fullPrice = usesFullMarketplacePrice(method);
    const credit = isCreditCardPayment(method);
    return ensureArray(body.items).map((item) => {
      const qty = Math.max(1, Number(item.qty || item.quantity || 1) || 1);
      const rawBase = Number(item.sellerBaseUnitPrice || item.sellerBasePrice || item.basePrice || item.pixPrice || item.price || item.preco || 0) || 0;
      const baseUnit = roundMoney(rawBase);
      const cardUnit = sellerBaseToMarketplacePrice(baseUnit);
      const unitPrice = fullPrice ? cardUnit : baseUnit;
      const sellerBaseTotal = roundMoney(baseUnit * qty);
      const totalPrice = roundMoney(unitPrice * qty);
      return {
        productId: String(item.productId || item._id || item.id || '').trim(),
        sellerId: String(item.sellerId || '').trim(),
        name: item.name || item.nome || '',
        sku: item.sku || '',
        qty,
        unitPrice,
        totalPrice,
        sellerBaseUnitPrice: baseUnit,
        sellerBaseTotal,
        cardMarkupUnit: credit ? roundMoney(cardUnit - baseUnit) : 0,
        cardMarkupTotal: credit ? roundMoney(totalPrice - sellerBaseTotal) : 0,
        image: item.image || item.imageUrl || item.imagem || ''
      };
    });
  }

  async function forceOrderItemsSellerBaseFromProducts(items = [], body = {}) {
    const method = String(body?.payment?.method || body?.paymentMethod || body?.totals?.paymentMethod || '').toLowerCase();
    const fullPrice = usesFullMarketplacePrice(method);
    const credit = isCreditCardPayment(method);
    const ids = Array.from(new Set(
      ensureArray(items)
        .map((item) => String(item.productId || item._id || item.id || '').trim())
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
    ));

    if (!ids.length) return items;

    const products = await Product.find({ _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } })
      .select('_id name sku sellerId sellerName category categoryName brand image imageUrl mainImageUrl price preco pixPrice sellerBasePrice sellerBaseUnitPrice basePrice precoBaseSeller precoSeller active dimensions logistics weight length height width')
      .lean();

    const productMap = new Map(products.map((p) => [String(p._id), p]));

    for (const item of ensureArray(items)) {
      const qty = Math.max(1, Number(item.qty || item.quantity || 1) || 1);
      const productId = String(item.productId || item._id || item.id || '').trim();
      const product = productMap.get(productId);
      if (!product || product.active === false) {
        const err = new Error(`Produto indisponível no catálogo: ${item.name || productId || 'sem identificação'}`);
        err.statusCode = 409;
        err.code = 'PRODUCT_UNAVAILABLE';
        err.productId = productId || undefined;
        throw err;
      }

      const baseUnit = getProductSellerBasePrice(product);
      if (baseUnit <= 0) {
        const err = new Error(`Produto sem preço válido: ${product.name || item.name || productId}`);
        err.statusCode = 409;
        err.code = 'INVALID_PRODUCT_PRICE';
        err.productId = productId || undefined;
        throw err;
      }

      const chargedUnit = fullPrice ? sellerBaseToMarketplacePrice(baseUnit) : baseUnit;
      const sellerBaseTotal = roundMoney(baseUnit * qty);
      const totalPrice = roundMoney(chargedUnit * qty);

      item.name = item.name || product.name || '';
      item.sku = item.sku || product.sku || '';
      item.sellerId = String(product.sellerId || item.sellerId || '').trim();
      item.sellerName = product.sellerName || item.sellerName || (String(item.sellerId || '').toLowerCase() === 'admin' ? 'Ariana Móveis' : '');
      item.category = product.categoryName || product.category || item.category || '';
      item.brand = product.brand || item.brand || '';
      item.image = item.image || product.imageUrl || product.image || product.mainImageUrl || '';
      item.weightKg = firstPositive(product.logistics?.weightKg, product.logistics?.weight, product.dimensions?.weightKg, product.dimensions?.weight, product.weight);
      item.lengthCm = firstPositive(product.logistics?.lengthCm, product.logistics?.length, product.dimensions?.lengthCm, product.dimensions?.length, product.length);
      item.widthCm = firstPositive(product.logistics?.widthCm, product.logistics?.width, product.dimensions?.widthCm, product.dimensions?.width, product.width);
      item.heightCm = firstPositive(product.logistics?.heightCm, product.logistics?.height, product.dimensions?.heightCm, product.dimensions?.height, product.height);
      item.originCep = String(product.logistics?.originCep || product.logistics?.cepOrigem || '').replace(/\D/g, '').slice(0, 8);

      // Regra principal do marketplace:
      // O seller recebe sobre o preço original/base do produto cadastrado no MongoDB.
      // O acréscimo do cartão fica separado em cardMarkup e NÃO entra no repasse do seller.
      item.sellerBaseUnitPrice = baseUnit;
      item.sellerBaseTotal = sellerBaseTotal;
      item.unitPrice = chargedUnit;
      item.totalPrice = totalPrice;
      item.cardMarkupUnit = credit ? roundMoney(chargedUnit - baseUnit) : 0;
      item.cardMarkupTotal = credit ? roundMoney(totalPrice - sellerBaseTotal) : 0;
    }

    return items;
  }

  async function calculateAuthoritativeShipping(body = {}, items = [], sellerBaseSubtotal = 0) {
    if (typeof calculateShipping !== 'function') {
      const err = new Error('Cálculo de frete indisponível no servidor.');
      err.statusCode = 503;
      err.code = 'SHIPPING_CALCULATOR_UNAVAILABLE';
      throw err;
    }

    const address = body.shippingAddress || body.address || {};
    const cep = onlyDigits(address.cep || address.zip || body.cepDestino || body.cep || '').slice(0, 8);
    if (cep.length !== 8) {
      const err = new Error('CEP de entrega inválido.');
      err.statusCode = 400;
      err.code = 'INVALID_SHIPPING_CEP';
      throw err;
    }

    const shippingItems = ensureArray(items).map((item) => ({
      id: item.productId,
      productId: item.productId,
      name: item.name || '',
      sku: item.sku || '',
      sellerId: item.sellerId || '',
      sellerName: item.sellerName || '',
      category: item.category || '',
      brand: item.brand || '',
      quantity: Math.max(1, Number(item.qty || 1) || 1),
      qty: Math.max(1, Number(item.qty || 1) || 1),
      unitPrice: Number(item.sellerBaseUnitPrice || 0),
      totalPrice: Number(item.sellerBaseTotal || 0),
      pesoKg: Number(item.weightKg || 0),
      weightKg: Number(item.weightKg || 0),
      comprimentoCm: Number(item.lengthCm || 0),
      lengthCm: Number(item.lengthCm || 0),
      larguraCm: Number(item.widthCm || 0),
      widthCm: Number(item.widthCm || 0),
      alturaCm: Number(item.heightCm || 0),
      heightCm: Number(item.heightCm || 0),
      originCep: item.originCep || ''
    }));

    const payload = {
      cepDestino: cep,
      destinationCep: cep,
      cep,
      cidade: address.cidade || address.city || '',
      city: address.cidade || address.city || '',
      uf: address.uf || address.state || '',
      state: address.uf || address.state || '',
      areaType: String(address.areaType || address.tipoArea || (address.isRural === true ? 'rural' : '') || '').toLowerCase(),
      isRural: address.isRural === true || String(address.areaType || address.tipoArea || '').toLowerCase() === 'rural',
      shippingAddress: {
        cep,
        logradouro: address.logradouro || address.street || address.rua || '',
        street: address.logradouro || address.street || address.rua || '',
        numero: address.numero || address.number || '',
        number: address.numero || address.number || '',
        complemento: address.complemento || address.complement || '',
        complement: address.complemento || address.complement || '',
        bairro: address.bairro || address.neighborhood || '',
        neighborhood: address.bairro || address.neighborhood || '',
        cidade: address.cidade || address.city || '',
        city: address.cidade || address.city || '',
        uf: address.uf || address.state || '',
        state: address.uf || address.state || '',
        areaType: String(address.areaType || address.tipoArea || (address.isRural === true ? 'rural' : '') || '').toLowerCase(),
        isRural: address.isRural === true || String(address.areaType || address.tipoArea || '').toLowerCase() === 'rural'
      },
      subtotal: roundMoney(sellerBaseSubtotal),
      total: roundMoney(sellerBaseSubtotal),
      invoiceValue: roundMoney(sellerBaseSubtotal),
      valorNota: roundMoney(sellerBaseSubtotal),
      items: shippingItems
    };

    const result = await calculateShipping(payload);
    const source = Array.isArray(result?.options) && result.options.length
      ? result.options
      : (Array.isArray(result?.quotes) ? result.quotes : []);
    const available = source.filter((q) => q && q.unavailable !== true && Number.isFinite(Number(q.price)) && Number(q.price) >= 0);

    if (!available.length) {
      const err = new Error(
        result?.options?.find?.((q) => q?.unavailable)?.error ||
        'Não há modalidade de frete disponível para este endereço.'
      );
      err.statusCode = 409;
      err.code = 'SHIPPING_UNAVAILABLE';
      throw err;
    }

    const requestedService = String(body.shipping?.service || body.shipping?.name || '').trim().toLowerCase();
    let selected = null;
    if (requestedService) {
      selected = available.find((q) => {
        const service = String(q.service || '').trim().toLowerCase();
        const name = String(q.name || q.label || '').trim().toLowerCase();
        return service === requestedService || name === requestedService;
      }) || null;
      if (!selected) {
        const err = new Error('A modalidade de frete selecionada mudou. Recalcule o frete antes de finalizar.');
        err.statusCode = 409;
        err.code = 'SHIPPING_OPTION_CHANGED';
        throw err;
      }
    }

    selected = selected || result?.bestQuote || result?.cheapest || available[0];
    let price = roundMoney(Number(selected?.price || 0));

    if (typeof getShippingSettings === 'function') {
      const settings = await getShippingSettings();
      const freeAbove = Number(settings?.freeShippingAbove ?? settings?.freteGratisAcima ?? 0) || 0;
      if (freeAbove > 0 && Number(sellerBaseSubtotal || 0) >= freeAbove) price = 0;
    }

    return {
      price,
      quote: selected,
      calculation: result,
      cep
    };
  }

  async function calculateAuthoritativeCoupon({ body = {}, items = [], baseTotal = 0, userId = null, user = null } = {}) {
    const code = normalizeCouponCode(body?.totals?.couponCode || body?.couponCode || body?.coupon?.code || body?.coupon || '');
    if (!code) return { code: '', discount: 0, coupon: null };

    const paidQuery = paidOrderQuery();

    if (code === 'PRIMEIRACOMPRA05') {
      const firstPurchaseIdentities = [];
      if (userId) firstPurchaseIdentities.push({ userId });
      const email = String(user?.email || '').trim().toLowerCase();
      const cpf = onlyDigits(user?.cpf || '');
      if (email) firstPurchaseIdentities.push({ customerEmail: email });
      if (cpf) firstPurchaseIdentities.push({ customerCpf: cpf });

      const hasPreviousPurchase = firstPurchaseIdentities.length
        ? await Order.exists({ $and: [{ $or: firstPurchaseIdentities }, paidQuery] })
        : null;

      if (hasPreviousPurchase) {
        const err = new Error('O cupom PRIMEIRACOMPRA05 é exclusivo para a primeira compra.');
        err.statusCode = 409;
        err.code = 'FIRST_PURCHASE_COUPON_NOT_ELIGIBLE';
        throw err;
      }

      const discount = roundMoney(Number(baseTotal || 0) * 0.05);
      return {
        code,
        discount,
        coupon: { code, type: 'percent', value: 5, firstPurchaseOnly: true }
      };
    }

    const Coupon = mongoose.models.Coupon;
    if (!Coupon) {
      const err = new Error('Serviço de cupons indisponível no momento.');
      err.statusCode = 503;
      err.code = 'COUPON_SERVICE_UNAVAILABLE';
      throw err;
    }

    const coupon = await Coupon.findOne({ code }).lean();
    if (!coupon) {
      const err = new Error('Cupom não encontrado.');
      err.statusCode = 400;
      err.code = 'COUPON_NOT_FOUND';
      throw err;
    }

    const nowDate = new Date();
    if (coupon.active === false) {
      const err = new Error('Cupom inativo.');
      err.statusCode = 400;
      err.code = 'COUPON_INACTIVE';
      throw err;
    }
    if (coupon.startsAt && new Date(coupon.startsAt) > nowDate) {
      const err = new Error('Cupom ainda não está disponível.');
      err.statusCode = 400;
      err.code = 'COUPON_NOT_STARTED';
      throw err;
    }
    if (coupon.endsAt && new Date(coupon.endsAt) < nowDate) {
      const err = new Error('Cupom expirado.');
      err.statusCode = 400;
      err.code = 'COUPON_EXPIRED';
      throw err;
    }

    const minSubtotal = roundMoney(coupon.minSubtotal || 0);
    if (minSubtotal > 0 && Number(baseTotal || 0) < minSubtotal) {
      const err = new Error(`Valor mínimo para este cupom é R$ ${minSubtotal.toFixed(2).replace('.', ',')}.`);
      err.statusCode = 400;
      err.code = 'COUPON_MIN_SUBTOTAL';
      throw err;
    }

    const sellerIds = Array.from(new Set(items.map((item) => String(item.sellerId || '').trim()).filter(Boolean)));
    const allowed = ensureArray(coupon.allowedSellerIds).map((v) => String(v || '').trim()).filter(Boolean);
    const excluded = ensureArray(coupon.excludedSellerIds).map((v) => String(v || '').trim()).filter(Boolean);
    if (allowed.length && sellerIds.length && !sellerIds.some((id) => allowed.includes(id))) {
      const err = new Error('Cupom não disponível para os produtos deste carrinho.');
      err.statusCode = 400;
      err.code = 'COUPON_SELLER_NOT_ALLOWED';
      throw err;
    }
    if (excluded.length && sellerIds.some((id) => excluded.includes(id))) {
      const err = new Error('Cupom não disponível para um dos produtos deste carrinho.');
      err.statusCode = 400;
      err.code = 'COUPON_SELLER_EXCLUDED';
      throw err;
    }

    const usageLimit = Math.max(0, Number(coupon.usageLimit || 0) || 0);
    if (usageLimit > 0) {
      const paidUses = await Order.countDocuments({ couponCode: code, ...paidQuery });
      if (Math.max(Number(coupon.usedCount || 0), paidUses) >= usageLimit) {
        const err = new Error('Limite de uso do cupom atingido.');
        err.statusCode = 409;
        err.code = 'COUPON_USAGE_LIMIT';
        throw err;
      }
    }

    const perCustomerLimit = Math.max(0, Number(coupon.perCustomerLimit || 0) || 0);
    if (perCustomerLimit > 0 && userId) {
      const customerUses = await Order.countDocuments({ userId, couponCode: code, ...paidQuery });
      if (customerUses >= perCustomerLimit) {
        const err = new Error('Limite de uso deste cupom por cliente atingido.');
        err.statusCode = 409;
        err.code = 'COUPON_CUSTOMER_LIMIT';
        throw err;
      }
    }

    let discount = String(coupon.type || 'percent').toLowerCase() === 'fixed'
      ? roundMoney(coupon.value || 0)
      : roundMoney(Number(baseTotal || 0) * (Number(coupon.value || 0) / 100));

    const maxDiscount = roundMoney(coupon.maxDiscount || 0);
    if (maxDiscount > 0) discount = Math.min(discount, maxDiscount);
    discount = roundMoney(Math.max(0, Math.min(Number(baseTotal || 0), discount)));

    if (discount <= 0) {
      const err = new Error('Cupom sem desconto aplicável.');
      err.statusCode = 400;
      err.code = 'COUPON_NO_DISCOUNT';
      throw err;
    }

    return {
      code,
      discount,
      coupon: {
        id: String(coupon._id || ''),
        code,
        type: coupon.type || 'percent',
        value: Number(coupon.value || 0),
        maxDiscount,
        minSubtotal
      }
    };
  }

  async function reserveStockForOrderItems(items = []) {
    const reserved = [];
    try {
      for (const item of items) {
        const oid = normalizeObjectId(item.productId);
        if (!oid) {
          const err = new Error(`Produto inválido no carrinho: ${item.name || item.productId || 'sem identificação'}`);
          err.statusCode = 400;
          throw err;
        }

        const qty = Math.max(1, Number(item.qty || 1) || 1);
        const product = await Product.findOneAndUpdate(
          { _id: oid, active: { $ne: false }, stock: { $gte: qty } },
          { $inc: { stock: -qty }, $set: { updatedAt: now() } },
          { new: true }
        );

        if (!product) {
          const current = await Product.findById(oid).select('name stock active');
          const available = Number(current?.stock || 0);
          const productName = current?.name || item.name || 'Produto';
          const err = new Error(available <= 0
            ? `${productName} está sem estoque no momento.`
            : `${productName} possui apenas ${available} unidade(s) em estoque.`);
          err.statusCode = 409;
          err.code = 'INSUFFICIENT_STOCK';
          err.productId = String(oid);
          err.availableStock = available;
          throw err;
        }

        reserved.push({ productId: String(oid), qty });
        item.name = item.name || product.name || '';
        item.sku = item.sku || product.sku || '';
        item.sellerId = item.sellerId || product.sellerId || '';
        item.image = item.image || product.imageUrl || product.image || product.mainImageUrl || '';
        if (!item.sellerBaseUnitPrice) {
          item.sellerBaseUnitPrice = roundMoney(product.price || item.unitPrice || 0);
          item.sellerBaseTotal = roundMoney(item.sellerBaseUnitPrice * qty);
        }
      }
      return reserved;
    } catch (error) {
      for (const row of reserved.reverse()) {
        try {
          await Product.findByIdAndUpdate(row.productId, { $inc: { stock: row.qty }, $set: { updatedAt: now() } });
        } catch (_rollbackError) {}
      }
      throw error;
    }
  }

  app.post('/api/orders', authRequired, async (req, res) => {
    let reservedStock = [];
    try {
      const body = req.body || {};
      const requestedMethod = body.payment?.method || body.paymentMethod || body.totals?.paymentMethod || '';
      const paymentMethod = normalizePaymentMethod(requestedMethod);
      if (!paymentMethod) {
        return res.status(400).json({ ok: false, error: 'Forma de pagamento inválida.', code: 'INVALID_PAYMENT_METHOD' });
      }

      body.payment = { ...(body.payment || {}), method: paymentMethod };
      body.paymentMethod = paymentMethod;
      body.totals = { ...(body.totals || {}), paymentMethod };

      const items = normalizeOrderItemsForCheckout(body);

      if (!items.length) {
        return res.status(400).json({ ok: false, error: 'Carrinho vazio. Adicione ao menos um produto para finalizar a compra.' });
      }

      await forceOrderItemsSellerBaseFromProducts(items, body);

      const subtotal = roundMoney(items.reduce((sum, item) => sum + Number(item.totalPrice || 0), 0));
      const sellerBaseSubtotal = roundMoney(items.reduce((sum, item) => sum + Number(item.sellerBaseTotal || 0), 0));
      const fullProductsSubtotal = roundMoney(items.reduce((sum, item) => {
        const fullUnit = sellerBaseToMarketplacePrice(Number(item.sellerBaseUnitPrice || 0));
        return sum + (fullUnit * Math.max(1, Number(item.qty || 1) || 1));
      }, 0));

      const shippingResolved = await calculateAuthoritativeShipping(body, items, sellerBaseSubtotal);
      const shippingCost = roundMoney(shippingResolved.price);
      const montagemCost = 0;

      // Cupom comercial incide somente sobre os produtos.
      // Frete é uma cobrança logística separada e não recebe desconto percentual comum.
      const couponBase = subtotal;
      const couponResult = await calculateAuthoritativeCoupon({
        body,
        items,
        baseTotal: couponBase,
        userId: req.user?._id || null,
        user: req.user || null
      });
      const total = roundMoney(Math.max(0, subtotal - Number(couponResult.discount || 0)) + shippingCost + montagemCost);

      const declaredTotal = Number(body.total ?? body.totals?.grandTotal ?? 0);
      if (Number.isFinite(declaredTotal) && declaredTotal > 0 && Math.abs(roundMoney(declaredTotal) - total) > 0.05) {
        const err = new Error('Os valores do checkout foram atualizados. Revise o total e tente finalizar novamente.');
        err.statusCode = 409;
        err.code = 'CHECKOUT_PRICING_CHANGED';
        err.pricing = {
          products: subtotal,
          shipping: shippingCost,
          couponCode: couponResult.code,
          couponDiscount: couponResult.discount,
          total
        };
        throw err;
      }

      reservedStock = await reserveStockForOrderItems(items);
      const sellerIds = Array.from(new Set(items.map(item => item.sellerId).filter(Boolean)));

      const freshQuote = shippingResolved.quote || {};
      const shipping = {
        ...(body.shipping || {}),
        provider: freshQuote.provider || body.shipping?.provider || '',
        service: freshQuote.service || body.shipping?.service || '',
        name: freshQuote.name || freshQuote.label || body.shipping?.name || '',
        price: shippingCost,
        quotedPrice: roundMoney(Number(freshQuote.price || shippingCost)),
        cepDestino: shippingResolved.cep,
        deadlineDays: freshQuote.deadlineDays ?? body.shipping?.deadlineDays ?? null,
        prazo: freshQuote.prazo || freshQuote.deliveryTime || body.shipping?.prazo || body.shipping?.deliveryTime || ''
      };
      if (!shipping.prazo && shipping.deadlineDays) shipping.prazo = `${shipping.deadlineDays} dia(s) úteis`;

      const payment = {
        ...(body.payment || {}),
        method: paymentMethod,
        gateway: paymentMethod === 'card' ? 'cielo' : (paymentMethod === 'crediario_ariana' ? 'cora' : 'mercadopago')
      };
      const paymentDiscountValue = (paymentMethod === 'pix' || paymentMethod === 'boleto')
        ? roundMoney(Math.max(0, fullProductsSubtotal - sellerBaseSubtotal))
        : 0;
      const totals = {
        products: subtotal,
        productsBase: sellerBaseSubtotal,
        productsFull: fullProductsSubtotal,
        shipping: shippingCost,
        grandTotalOriginal: roundMoney(fullProductsSubtotal + shippingCost),
        paymentDiscountValue,
        couponCode: couponResult.code || '',
        couponDiscount: roundMoney(couponResult.discount || 0),
        discountValue: roundMoney(paymentDiscountValue + Number(couponResult.discount || 0)),
        grandTotal: total,
        paymentMethod
      };

      const order = await Order.create({
        userId: req.user?._id || null,
        sellerIds,
        customerName: req.user?.name || body.customerName || body.customer?.name || '',
        customerEmail: req.user?.email || body.customerEmail || body.customer?.email || '',
        customerPhone: req.user?.phone || body.customerPhone || body.customer?.phone || '',
        customerCpf: onlyDigits(req.user?.cpf || body.customerCpf || body.cpf || body.customer?.cpf),
        status: 'pending_payment',
        statusLabel: 'Aguardando pagamento',
        paymentStatus: paymentMethod === 'crediario_ariana' ? 'AWAITING_PAYMENT' : 'pending',
        items,
        subtotal,
        shippingCost,
        montagemCost,
        total,
        totals,
        couponCode: couponResult.code || '',
        coupon: couponResult.coupon || null,
        discountTotal: roundMoney(paymentDiscountValue + Number(couponResult.discount || 0)),
        pricingIntegrity: {
          source: 'server',
          verifiedAt: now(),
          declaredTotal: Number.isFinite(declaredTotal) ? roundMoney(declaredTotal) : null
        },
        payment,
        stockReservation: buildStockReservation(reservedStock, paymentMethod),
        shippingAddress: body.shippingAddress || body.address || {},
        shipping,
        notes: body.notes || '',
        manufacturer: sellerIds[0] || ''
      });

      // Pedido normal só vira "nova venda" depois do pagamento aprovado.
      // Exceção operacional: Crediário Ariana precisa chegar ao Admin antes da aprovação,
      // porque a equipe precisa analisar o crédito. Isso é alerta de pedido recebido,
      // não confirmação de venda concluída.
      if (paymentMethod === 'crediario_ariana') {
        const orderId = String(order._id || '');
        const shortId = orderId ? orderId.slice(-8).toUpperCase() : '---';
        const customerName = String(order.customerName || 'Cliente').trim();
        await createAdminNotification({
          type: 'crediario_order_received',
          title: 'Novo pedido no Crediário Ariana',
          message: `Pedido #${shortId} de ${customerName} no valor de R$ ${Number(order.total || 0).toFixed(2).replace('.', ',')} aguardando análise de crédito.`,
          relatedId: orderId,
          severity: 'warning',
          audience: 'admin',
          metadata: {
            orderId,
            paymentMethod: 'crediario_ariana',
            status: order.status,
            total: Number(order.total || 0),
            action: 'open_credit_analysis'
          }
        });
      }

      return res.json({ ok: true, order: toJSON(order), adminWhatsapp: { skipped: true, reason: 'waiting_payment_approval' } });
    } catch (error) {
      if (reservedStock.length && error?.code !== 'INSUFFICIENT_STOCK') {
        for (const row of reservedStock.reverse()) {
          try { await Product.findByIdAndUpdate(row.productId, { $inc: { stock: row.qty }, $set: { updatedAt: now() } }); } catch (_rollbackError) {}
        }
      }
      const statusCode = Number(error.statusCode || 500);
      return res.status(statusCode).json({
        ok: false,
        error: error.message || 'Erro ao criar pedido',
        code: error.code || undefined,
        productId: error.productId || undefined,
        availableStock: error.availableStock ?? undefined,
        pricing: error.pricing || undefined
      });
    }
  });

  const publicTrackingAttempts = new Map();
  function trackingRateLimit(req, res) {
    const currentTime = Date.now();
    const windowMs = 15 * 60 * 1000;
    const maximumAttempts = 12;
    const clientKey = String(req.ip || req.socket?.remoteAddress || 'unknown');
    const previous = publicTrackingAttempts.get(clientKey);
    const entry = !previous || currentTime - previous.startedAt >= windowMs
      ? { count: 0, startedAt: currentTime }
      : previous;

    entry.count += 1;
    publicTrackingAttempts.set(clientKey, entry);

    if (publicTrackingAttempts.size > 5000) {
      for (const [key, value] of publicTrackingAttempts.entries()) {
        if (currentTime - value.startedAt >= windowMs) publicTrackingAttempts.delete(key);
      }
    }

    if (entry.count > maximumAttempts) {
      const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (currentTime - entry.startedAt)) / 1000));
      res.set('Retry-After', String(retryAfterSeconds));
      res.status(429).json({ ok: false, error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' });
      return false;
    }
    return true;
  }

  function publicTrackingEvent(event = {}) {
    const description = String(event.descricao || event.description || event.label || event.status || 'Atualização do pedido')
      .trim()
      .slice(0, 200);
    const location = String(event.local || event.location || event.cidade || '')
      .trim()
      .slice(0, 120);
    return {
      descricao: description || 'Atualização do pedido',
      data: event.data || event.date || event.createdAt || event.updatedAt || null,
      local: location || undefined
    };
  }

  async function publicTrackingHandler(req, res) {
    res.set('Cache-Control', 'no-store');
    if (!trackingRateLimit(req, res)) return;

    const orderReference = String(req.query?.orderId || req.query?.id || '')
      .replace(/^#/, '')
      .trim()
      .slice(0, 120);
    const suppliedDocument = onlyDigits(req.query?.cpfCnpj || req.query?.cpf);

    if (!orderReference || ![11, 14].includes(suppliedDocument.length)) {
      return res.status(400).json({ ok: false, error: 'Informe um pedido e um CPF/CNPJ válido.' });
    }

    try {
      const referenceQuery = mongoose.Types.ObjectId.isValid(orderReference)
        ? { _id: new mongoose.Types.ObjectId(orderReference) }
        : {
            $or: [
              { trackingCode: orderReference },
              { 'televendas.orderNumber': orderReference },
              { 'televendas.orderId': orderReference },
              { 'payment.externalReference': orderReference }
            ]
          };
      const order = await Order.findOne(referenceQuery).lean();
      const genericNotFound = () => res.status(404).json({
        ok: false,
        error: 'Não foi possível encontrar um pedido com os dados informados.'
      });

      if (!order) return genericNotFound();

      let storedDocument = onlyDigits(
        order.customerCpf ||
        order.cpf ||
        order.customer?.cpf ||
        order.payment?.payer?.identification?.number ||
        order.payment?.payer?.cpf ||
        order.shippingAddress?.cpf ||
        order.televendas?.customer?.cpf
      );

      if (!storedDocument && order.userId && User) {
        const owner = await User.findById(order.userId).select('cpf').lean();
        storedDocument = onlyDigits(owner?.cpf);
      }

      if (!storedDocument || storedDocument !== suppliedDocument) return genericNotFound();

      const rawHistory = ensureArray(
        order.trackingHistory ||
        order.shipping?.trackingHistory ||
        order.manufacturerDispatch?.trackingHistory
      );
      const trackingHistory = rawHistory.map(publicTrackingEvent);
      if (!trackingHistory.length) {
        trackingHistory.push(publicTrackingEvent({
          descricao: order.statusLabel || order.status || 'Pedido recebido',
          data: order.updatedAt || order.createdAt || null
        }));
      }

      return res.json({
        ok: true,
        pedido: {
          id: String(order._id),
          orderId: String(order.televendas?.orderNumber || order._id),
          status: order.statusLabel || order.status || 'Pedido recebido',
          rastreamento: trackingHistory,
          codigoRastreio: order.trackingCode || order.shipping?.trackingCode || null,
          transportadora: order.shipping?.name || order.shipping?.carrier || null,
          prazo: order.shipping?.prazo || order.shipping?.deliveryTime || null
        }
      });
    } catch (error) {
      console.error('[PUBLIC_TRACKING]', error?.message || error);
      return res.status(500).json({ ok: false, error: 'Não foi possível consultar o pedido agora. Tente novamente.' });
    }
  }

  app.get('/api/pedidos/rastrear', publicTrackingHandler);
  app.get('/api/orders/track', publicTrackingHandler);
  app.get('/api/orders/me', authRequired, async (req, res) => res.json((await Order.find({ userId: req.user._id }).sort({ createdAt: -1 })).map(toJSON)));
  app.get('/api/pedidos/meus', authRequired, async (req, res) => res.json((await Order.find({ userId: req.user._id }).sort({ createdAt: -1 })).map(toJSON)));
  app.get('/api/users/:id/pedidos', authRequired, async (req, res) => {
    try {
      const requestedId = String(req.params.id || '').trim();
      const currentId = String(req.user._id || '').trim();
      if (req.user.role === 'customer' && requestedId && requestedId !== currentId) {
        return res.status(403).json({ ok: false, error: 'Sem permissão' });
      }
      const userObjectId = normalizeObjectId(requestedId) || req.user._id;
      return res.json((await Order.find({ userId: userObjectId }).sort({ createdAt: -1 })).map(toJSON));
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar pedidos' });
    }
  });
  app.get('/api/orders/:id', authRequired, async (req, res) => { const oid = normalizeObjectId(req.params.id); if (!oid) return res.status(400).json({ ok: false, error: 'ID inválido' }); const row = await Order.findById(oid); if (!row) return res.status(404).json({ ok: false, error: 'Pedido não encontrado' }); if (req.user.role === 'customer' && String(row.userId || '') !== String(req.user._id)) return res.status(403).json({ ok: false, error: 'Sem permissão' }); return res.json(toJSON(row)); });
  app.post('/api/tickets', async (req, res) => { const body = req.body || {}; const doc = await Ticket.create({ userId: normalizeObjectId(body.userId) || null, orderId: body.orderId || null, protocolo: body.protocolo || `TK-${Date.now()}`, tipo: body.tipo || 'Suporte', assunto: body.assunto || '', mensagem: body.mensagem || body.message || '', status: body.status || 'Novo', origem: body.origem || 'site', nome: body.nome || body.name || '', email: body.email || '', telefone: body.telefone || body.phone || '', metadata: body.metadata || {} }); return res.json({ ok: true, ticket: toJSON(doc) }); });
  app.get('/api/tickets', authRequired, async (req, res) => { const query = req.user.role === 'admin' ? {} : { userId: req.user._id }; return res.json((await Ticket.find(query).sort({ createdAt: -1 })).map(toJSON)); });
  app.post('/api/contact', async (req, res) => res.json({ ok: true, contact: toJSON(await Contact.create({ name: req.body?.name || '', email: req.body?.email || '', phone: req.body?.phone || '', subject: req.body?.subject || '', message: req.body?.message || '', source: 'fale_conosco' })) }));
  app.post('/api/denuncias', async (req, res) => res.json({ ok: true, denuncia: toJSON(await Denuncia.create({ userId: normalizeObjectId(req.body?.userId) || null, productId: req.body?.productId || null, sellerId: req.body?.sellerId || null, motivo: req.body?.motivo || '', descricao: req.body?.descricao || '', status: 'nova', nome: req.body?.nome || '', email: req.body?.email || '' })) }));
}
