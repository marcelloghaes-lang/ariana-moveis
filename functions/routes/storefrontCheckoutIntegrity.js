// ============================================================
// CHECKOUT - INTEGRIDADE DE FRETE, CUPOM E TOTAL
// 1) A cotação pública recebe apenas IDs/quantidades confiáveis e o servidor
//    substitui peso, dimensões, seller e valor declarado pelos dados do MongoDB.
// 2) A resposta de frete recebe um comprovante HMAC curto.
// 3) /api/orders aceita somente uma cotação válida e recalcula cupom/total.
// ============================================================

export default function registerStorefrontCheckoutIntegrity(app, context = {}) {
  const {
    Product,
    mongoose,
    crypto,
    JWT_SECRET,
    getShippingSettings
  } = context;

  if (!app || !Product || !mongoose || !crypto) {
    throw new Error('[CHECKOUT INTEGRITY] app, Product, mongoose e crypto são obrigatórios.');
  }

  const quoteSecret = String(process.env.SHIPPING_QUOTE_SECRET || JWT_SECRET || '').trim();
  if (!quoteSecret) {
    throw new Error('[CHECKOUT INTEGRITY] SHIPPING_QUOTE_SECRET/JWT_SECRET não configurado.');
  }

  function pathOnly(req = {}) {
    return String(req.path || req.originalUrl || '').split('?')[0].replace(/\/+$/, '');
  }

  function digits(value = '') {
    return String(value || '').replace(/\D/g, '');
  }

  function money(value = 0) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  function positive(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  function qty(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 1) return 1;
    return Math.min(99, Math.max(1, Math.floor(n)));
  }

  function marketplaceFactor() {
    const percent = Math.min(90, Math.max(0, Number(process.env.MARKETPLACE_CARD_DISCOUNT_PERCENT || 17)));
    const factor = (100 - percent) / 100;
    return factor > 0 ? factor : 0.83;
  }

  function sellerBasePrice(product = {}) {
    const values = [
      product.sellerBasePrice,
      product.sellerBaseUnitPrice,
      product.basePrice,
      product.pixPrice,
      product.precoBaseSeller,
      product.precoSeller,
      product.preco,
      product.price
    ];
    for (const value of values) {
      const n = positive(value, 0);
      if (n > 0) return money(n);
    }
    return 0;
  }

  function marketplacePrice(base = 0) {
    const value = positive(base, 0);
    return value > 0 ? money(value / marketplaceFactor()) : 0;
  }

  function normalizePaymentMethod(value = '') {
    const method = String(value || '').trim().toLowerCase();
    if (method.includes('pix')) return 'pix';
    if (method.includes('boleto') || method === 'bolbradesco') return 'boleto';
    if (method.includes('crediario')) return 'crediario_ariana';
    if (method === 'card' || method === 'credit' || method === 'credit_card' || method.includes('cartao') || method.includes('cartão') || method.includes('credit')) return 'card';
    return method;
  }

  function readProductMetric(product = {}, names = [], fallback = 0) {
    const containers = [product.logistics || {}, product.dimensions || {}, product.specs || {}, product];
    for (const container of containers) {
      for (const name of names) {
        const n = positive(container?.[name], 0);
        if (n > 0) return n;
      }
    }
    return fallback;
  }

  async function shippingDefaults() {
    let settings = {};
    try {
      settings = typeof getShippingSettings === 'function' ? await getShippingSettings() : {};
    } catch (_error) {}
    return {
      weight: positive(settings?.defaultWeightKg ?? settings?.pesoKgPadrao, 1),
      height: positive(settings?.defaultHeightCm ?? settings?.alturaCmPadrao, 10),
      width: positive(settings?.defaultWidthCm ?? settings?.larguraCmPadrao, 15),
      length: positive(settings?.defaultLengthCm ?? settings?.comprimentoCmPadrao, 20),
      freeShippingAbove: positive(settings?.freeShippingAbove ?? settings?.freteGratisAcima, 0)
    };
  }

  function canonicalItemHash(items = []) {
    const compact = (Array.isArray(items) ? items : [])
      .map((item = {}) => ({
        id: String(item.productId || item.id || item._id || '').trim(),
        qty: qty(item.qty ?? item.quantity ?? 1)
      }))
      .filter((item) => item.id)
      .sort((a, b) => a.id.localeCompare(b.id));
    return crypto.createHash('sha256').update(JSON.stringify(compact)).digest('hex');
  }

  async function resolveProductsFromItems(items = []) {
    const input = (Array.isArray(items) ? items : [])
      .map((item = {}) => ({
        id: String(item.productId || item.id || item._id || '').trim(),
        qty: qty(item.qty ?? item.quantity ?? 1)
      }))
      .filter((item) => item.id);

    if (!input.length) {
      const error = new Error('Nenhum produto válido informado para o frete.');
      error.statusCode = 400;
      error.code = 'SHIPPING_ITEMS_REQUIRED';
      throw error;
    }
    if (input.length > 100) {
      const error = new Error('Quantidade de itens acima do limite do checkout.');
      error.statusCode = 400;
      error.code = 'SHIPPING_ITEMS_LIMIT';
      throw error;
    }

    const objectIds = [];
    const textualIds = [];
    for (const row of input) {
      if (mongoose.Types.ObjectId.isValid(row.id)) objectIds.push(new mongoose.Types.ObjectId(row.id));
      else textualIds.push(row.id);
    }

    const filters = [];
    if (objectIds.length) filters.push({ _id: { $in: objectIds } });
    if (textualIds.length) filters.push({ sku: { $in: textualIds } });
    const products = filters.length
      ? await Product.find(filters.length === 1 ? filters[0] : { $or: filters }).lean()
      : [];

    const byId = new Map();
    const bySku = new Map();
    for (const product of products) {
      byId.set(String(product._id), product);
      if (product.sku) bySku.set(String(product.sku), product);
    }

    const resolved = [];
    for (const row of input) {
      const product = byId.get(row.id) || bySku.get(row.id);
      if (!product || product.active === false) {
        const error = new Error('Um produto do carrinho não está disponível para cotação. Atualize o carrinho.');
        error.statusCode = 409;
        error.code = 'SHIPPING_PRODUCT_NOT_AVAILABLE';
        throw error;
      }
      resolved.push({ product, qty: row.qty });
    }
    return resolved;
  }

  async function trustedShippingRequest(body = {}) {
    const cep = digits(body.cepDestino || body.destinationCep || body.cep).slice(0, 8);
    if (cep.length !== 8) {
      const error = new Error('CEP de destino inválido.');
      error.statusCode = 400;
      error.code = 'SHIPPING_CEP_INVALID';
      throw error;
    }

    const resolved = await resolveProductsFromItems(body.items || []);
    const defaults = await shippingDefaults();
    let totalWeight = 0;
    let maxHeight = 0;
    let maxWidth = 0;
    let totalLength = 0;
    let declaredSubtotal = 0;
    let allAriana = true;

    const items = resolved.map(({ product, qty: quantity }) => {
      const base = sellerBasePrice(product);
      const weight = readProductMetric(product, ['pesoKg', 'weightKg', 'shippingWeightKg', 'weight'], defaults.weight);
      const height = readProductMetric(product, ['alturaCm', 'heightCm', 'height'], defaults.height);
      const width = readProductMetric(product, ['larguraCm', 'widthCm', 'width'], defaults.width);
      const length = readProductMetric(product, ['comprimentoCm', 'lengthCm', 'length'], defaults.length);
      const sellerId = String(product.sellerId || 'admin').trim() || 'admin';
      const sellerName = String(product.sellerName || (sellerId === 'admin' ? 'Ariana Móveis' : '')).trim();

      totalWeight += weight * quantity;
      maxHeight = Math.max(maxHeight, height);
      maxWidth = Math.max(maxWidth, width);
      totalLength += length * quantity;
      declaredSubtotal += base * quantity;
      if (!(sellerId.toLowerCase() === 'admin' || /ariana/i.test(sellerName))) allAriana = false;

      return {
        id: String(product._id),
        productId: String(product._id),
        name: String(product.name || 'Produto'),
        sellerId,
        sellerName,
        quantity,
        qty: quantity,
        unitPrice: base,
        totalPrice: money(base * quantity),
        pesoKg: money(weight),
        weightKg: money(weight),
        weight: money(weight),
        alturaCm: money(height),
        heightCm: money(height),
        height: money(height),
        larguraCm: money(width),
        widthCm: money(width),
        width: money(width),
        comprimentoCm: money(length),
        lengthCm: money(length),
        length: money(length)
      };
    });

    const pkg = {
      pesoKg: Math.max(0.1, money(totalWeight)),
      alturaCm: Math.max(1, Math.round(maxHeight || defaults.height)),
      larguraCm: Math.max(1, Math.round(maxWidth || defaults.width)),
      comprimentoCm: Math.max(1, Math.round(totalLength || defaults.length))
    };

    const trusted = {
      ...body,
      cepDestino: cep,
      destinationCep: cep,
      cep,
      subtotal: money(declaredSubtotal),
      total: money(declaredSubtotal),
      invoiceValue: money(declaredSubtotal),
      valorNota: money(declaredSubtotal),
      pesoKg: pkg.pesoKg,
      weightKg: pkg.pesoKg,
      weight: pkg.pesoKg,
      alturaCm: pkg.alturaCm,
      heightCm: pkg.alturaCm,
      height: pkg.alturaCm,
      larguraCm: pkg.larguraCm,
      widthCm: pkg.larguraCm,
      width: pkg.larguraCm,
      comprimentoCm: pkg.comprimentoCm,
      lengthCm: pkg.comprimentoCm,
      length: pkg.comprimentoCm,
      isArianaOrder: allAriana,
      items
    };

    return { trusted, cep, itemHash: canonicalItemHash(items), products: resolved, declaredSubtotal: money(declaredSubtotal), defaults };
  }

  function optionFrom(value = {}) {
    if (!value || typeof value !== 'object' || value.unavailable === true) return null;
    const price = Number(value.effectivePrice ?? value.price ?? value.valor ?? value.cost);
    if (!Number.isFinite(price) || price < 0) return null;
    return {
      provider: String(value.provider || value.carrier || value.transportadora || '').trim(),
      service: String(value.service || value.serviceCode || value.name || value.label || '').trim(),
      name: String(value.name || value.label || value.service || value.carrier || value.provider || 'Frete').trim(),
      price: money(price)
    };
  }

  function collectOptions(payload = {}) {
    const raw = [];
    for (const key of ['options', 'quotes', 'services', 'fretes']) {
      if (Array.isArray(payload?.[key])) raw.push(...payload[key]);
    }
    for (const key of ['cheapest', 'quote', 'best', 'selected']) {
      if (payload?.[key] && typeof payload[key] === 'object') raw.push(payload[key]);
    }
    if (!raw.length) raw.push(payload);

    const seen = new Set();
    const options = [];
    for (const row of raw) {
      const option = optionFrom(row);
      if (!option) continue;
      const key = `${option.provider}|${option.service}|${option.price}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      options.push(option);
      if (options.length >= 40) break;
    }
    return options;
  }

  function signQuoteData(data = {}) {
    return crypto.createHmac('sha256', quoteSecret).update(JSON.stringify(data)).digest('base64url');
  }

  function safeEqual(a = '', b = '') {
    const left = Buffer.from(String(a || ''));
    const right = Buffer.from(String(b || ''));
    return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
  }

  function verifySecurityProof(proof = {}) {
    if (!proof || typeof proof !== 'object') return { ok: false, reason: 'missing' };
    const token = String(proof.token || '').trim();
    const signed = {
      version: Number(proof.version || 1),
      issuedAt: Number(proof.issuedAt || 0),
      expiresAt: Number(proof.expiresAt || 0),
      cep: String(proof.cep || ''),
      itemHash: String(proof.itemHash || ''),
      options: Array.isArray(proof.options) ? proof.options : []
    };
    if (!token || !signed.issuedAt || !signed.expiresAt || !signed.cep || !signed.itemHash || !signed.options.length) {
      return { ok: false, reason: 'incomplete' };
    }
    if (Date.now() > signed.expiresAt) return { ok: false, reason: 'expired', signed };
    const expected = signQuoteData(signed);
    if (!safeEqual(token, expected)) return { ok: false, reason: 'signature', signed };
    return { ok: true, signed };
  }

  function normalizeCouponCode(value = '') {
    return String(value || '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9_-]+/g, '').slice(0, 40);
  }

  async function calculateTrustedCoupon(code, subtotal, products = []) {
    const couponCode = normalizeCouponCode(code);
    if (!couponCode) return { code: '', discount: 0 };
    const Coupon = mongoose.models.Coupon;
    if (!Coupon) {
      const error = new Error('Módulo de cupons indisponível.');
      error.statusCode = 503;
      error.code = 'COUPON_MODULE_UNAVAILABLE';
      throw error;
    }
    const coupon = await Coupon.findOne({ code: couponCode }).lean();
    if (!coupon) {
      const error = new Error('Cupom não encontrado.');
      error.statusCode = 409;
      error.code = 'COUPON_INVALID';
      throw error;
    }

    const now = new Date();
    if (coupon.active === false || (coupon.startsAt && new Date(coupon.startsAt) > now) || (coupon.endsAt && new Date(coupon.endsAt) < now)) {
      const error = new Error('Cupom inativo ou fora da validade.');
      error.statusCode = 409;
      error.code = 'COUPON_NOT_ACTIVE';
      throw error;
    }
    if (Number(coupon.usageLimit || 0) > 0 && Number(coupon.usedCount || 0) >= Number(coupon.usageLimit || 0)) {
      const error = new Error('Limite de uso do cupom atingido.');
      error.statusCode = 409;
      error.code = 'COUPON_LIMIT_REACHED';
      throw error;
    }
    const base = money(subtotal);
    if (Number(coupon.minSubtotal || 0) > 0 && base < Number(coupon.minSubtotal || 0)) {
      const error = new Error('O pedido não atingiu o valor mínimo deste cupom.');
      error.statusCode = 409;
      error.code = 'COUPON_MINIMUM_NOT_REACHED';
      throw error;
    }

    const sellerIds = products.map(({ product }) => String(product?.sellerId || 'admin').trim()).filter(Boolean);
    const allowed = Array.isArray(coupon.allowedSellerIds) ? coupon.allowedSellerIds.map(String) : [];
    const excluded = Array.isArray(coupon.excludedSellerIds) ? coupon.excludedSellerIds.map(String) : [];
    if (allowed.length && sellerIds.length && !sellerIds.some((id) => allowed.includes(id))) {
      const error = new Error('Cupom não disponível para os sellers deste carrinho.');
      error.statusCode = 409;
      error.code = 'COUPON_SELLER_NOT_ALLOWED';
      throw error;
    }
    if (excluded.length && sellerIds.some((id) => excluded.includes(id))) {
      const error = new Error('Cupom não disponível para um dos sellers deste carrinho.');
      error.statusCode = 409;
      error.code = 'COUPON_SELLER_EXCLUDED';
      throw error;
    }

    let discount = String(coupon.type || 'percent') === 'fixed'
      ? Number(coupon.value || 0)
      : base * (Number(coupon.value || 0) / 100);
    if (Number(coupon.maxDiscount || 0) > 0) discount = Math.min(discount, Number(coupon.maxDiscount));
    discount = money(Math.max(0, Math.min(base, discount)));
    if (discount <= 0) {
      const error = new Error('Cupom sem desconto aplicável.');
      error.statusCode = 409;
      error.code = 'COUPON_NO_DISCOUNT';
      throw error;
    }
    return { code: couponCode, discount, couponId: String(coupon._id) };
  }

  function optionMatches(selected = {}, option = {}) {
    const selectedProvider = String(selected.provider || '').trim().toLowerCase();
    const selectedService = String(selected.service || selected.name || '').trim().toLowerCase();
    const provider = String(option.provider || '').trim().toLowerCase();
    const service = String(option.service || option.name || '').trim().toLowerCase();
    const providerOk = !selectedProvider || !provider || selectedProvider === provider;
    const serviceOk = !selectedService || !service || selectedService === service;
    return providerOk && serviceOk;
  }

  // A cotação continua pública, porém seus dados de produto são sempre substituídos
  // pelo cadastro real antes de chegar às integrações de logística.
  app.use(async (req, res, next) => {
    if (req.method !== 'POST' || ![
      '/api/shipping/logistics/quote',
      '/shipping/logistics/quote',
      '/api/shipping/quote',
      '/shipping/quote',
      '/api/shipping/calculate',
      '/shipping/calculate'
    ].includes(pathOnly(req))) return next();

    try {
      const trusted = await trustedShippingRequest(req.body || {});
      req.body = trusted.trusted;
      req.__arianaShippingTrust = trusted;

      const originalJson = res.json.bind(res);
      let handled = false;
      res.json = function signedShippingJson(payload) {
        if (handled) return originalJson(payload);
        handled = true;
        const statusCode = Number(res.statusCode || 200);
        if (statusCode < 200 || statusCode >= 300 || !payload || typeof payload !== 'object') return originalJson(payload);

        const options = collectOptions(payload);
        if (!options.length) return originalJson(payload);
        const issuedAt = Date.now();
        const signed = {
          version: 1,
          issuedAt,
          expiresAt: issuedAt + Math.max(2, Number(process.env.SHIPPING_QUOTE_TTL_MINUTES || 15)) * 60 * 1000,
          cep: trusted.cep,
          itemHash: trusted.itemHash,
          options
        };
        payload._security = { ...signed, token: signQuoteData(signed) };
        return originalJson(payload);
      };
      return next();
    } catch (error) {
      return res.status(Number(error.statusCode || 400)).json({
        ok: false,
        error: error.message || 'Não foi possível validar os produtos para o frete.',
        code: error.code || 'SHIPPING_REQUEST_INVALID'
      });
    }
  });

  // O pedido só prossegue depois de validar a cotação assinada e recalcular o
  // total final com preços, seller e cupom vindos do banco.
  app.use(async (req, res, next) => {
    if (req.method !== 'POST' || pathOnly(req) !== '/api/orders') return next();

    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const proof = body?.shipping?.quote?._security || body?.shipping?._security || null;
      const verified = verifySecurityProof(proof);
      if (!verified.ok) {
        return res.status(409).json({
          ok: false,
          error: verified.reason === 'expired'
            ? 'A cotação de frete expirou. Volte ao endereço e calcule o frete novamente.'
            : 'O frete precisa ser recalculado pelo servidor antes de criar o pedido.',
          code: verified.reason === 'expired' ? 'SHIPPING_QUOTE_EXPIRED' : 'SHIPPING_QUOTE_NOT_VERIFIED'
        });
      }

      const cep = digits(body?.shippingAddress?.cep || body?.shipping?.cepDestino || '').slice(0, 8);
      if (cep.length !== 8 || cep !== verified.signed.cep) {
        return res.status(409).json({ ok: false, error: 'O CEP do pedido não confere com a cotação de frete.', code: 'SHIPPING_CEP_MISMATCH' });
      }

      const requestedHash = canonicalItemHash(body.items || []);
      if (!requestedHash || requestedHash !== verified.signed.itemHash) {
        return res.status(409).json({ ok: false, error: 'Os itens do pedido mudaram depois da cotação. Recalcule o frete.', code: 'SHIPPING_ITEMS_CHANGED' });
      }

      const resolved = await resolveProductsFromItems(body.items || []);
      const selected = body.shipping || {};
      const candidate = verified.signed.options.find((option) => optionMatches(selected, option));
      if (!candidate) {
        return res.status(409).json({ ok: false, error: 'A modalidade de frete escolhida não pertence à cotação válida.', code: 'SHIPPING_OPTION_MISMATCH' });
      }

      const method = normalizePaymentMethod(body?.payment?.method || body?.paymentMethod || '');
      const fullPrice = method === 'card' || method === 'crediario_ariana';
      const productsSubtotal = money(resolved.reduce((sum, { product, qty: quantity }) => {
        const base = sellerBasePrice(product);
        return sum + (fullPrice ? marketplacePrice(base) : base) * quantity;
      }, 0));

      const defaults = await shippingDefaults();
      let shippingCost = money(candidate.price);
      if (defaults.freeShippingAbove > 0 && productsSubtotal >= defaults.freeShippingAbove) shippingCost = 0;

      const couponCode = body?.totals?.couponCode || body?.payment?.coupon?.code || '';
      const coupon = await calculateTrustedCoupon(couponCode, productsSubtotal + shippingCost, resolved);
      const total = money(Math.max(0, productsSubtotal + shippingCost - Number(coupon.discount || 0)));
      if (total <= 0) {
        return res.status(409).json({ ok: false, error: 'Total calculado do pedido é inválido.', code: 'ORDER_TOTAL_INVALID' });
      }

      body.shippingCost = shippingCost;
      body.montagemCost = 0;
      body.total = total;
      body.shipping = {
        ...body.shipping,
        provider: candidate.provider || body.shipping?.provider || '',
        service: candidate.service || body.shipping?.service || '',
        name: candidate.name || body.shipping?.name || 'Frete',
        price: shippingCost,
        effectivePrice: shippingCost,
        quoteVerified: true,
        quoteVerifiedAt: new Date().toISOString(),
        quoteExpiresAt: new Date(verified.signed.expiresAt).toISOString(),
        quote: body.shipping?.quote || { _security: proof }
      };
      body.payment = {
        ...(body.payment || {}),
        coupon: coupon.code ? {
          code: coupon.code,
          discount: coupon.discount,
          couponId: coupon.couponId,
          validatedBy: 'server'
        } : undefined,
        pricingVerified: true,
        pricingVerifiedAt: new Date().toISOString()
      };
      body.totals = {
        ...(body.totals || {}),
        products: productsSubtotal,
        shipping: shippingCost,
        couponCode: coupon.code,
        couponDiscount: coupon.discount,
        grandTotal: total,
        paymentMethod: method,
        verifiedBy: 'server'
      };
      req.body = body;
      return next();
    } catch (error) {
      return res.status(Number(error.statusCode || 500)).json({
        ok: false,
        error: error.message || 'Não foi possível validar o total do pedido.',
        code: error.code || 'CHECKOUT_INTEGRITY_FAILED'
      });
    }
  });
}
