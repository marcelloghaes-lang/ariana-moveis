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
    authRequired,
    ensureArray,
    mongoose,
    normalizeObjectId,
    now,
    toJSON
  } = context;

  const MARKETPLACE_CARD_DISCOUNT_PERCENT = Number(process.env.MARKETPLACE_CARD_DISCOUNT_PERCENT || 17);
  function roundMoney(value = 0) { return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100; }
  function getMarketplaceFactor() { const p = Math.min(90, Math.max(0, Number(MARKETPLACE_CARD_DISCOUNT_PERCENT || 17))); return roundMoney((100 - p) / 100) || 0.83; }
  function sellerBaseToMarketplacePrice(basePrice = 0) { const base = Number(basePrice || 0); if (!base) return 0; return roundMoney(base / getMarketplaceFactor()); }
  function isCreditCardPayment(method = '') { const m = String(method || '').toLowerCase(); return m.includes('card') || m.includes('cartao') || m.includes('cartão') || m.includes('credit'); }
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
    const credit = isCreditCardPayment(method);
    return ensureArray(body.items).map((item) => {
      const qty = Math.max(1, Number(item.qty || item.quantity || 1) || 1);
      const rawBase = Number(item.sellerBaseUnitPrice || item.sellerBasePrice || item.basePrice || item.pixPrice || item.price || item.preco || 0) || 0;
      const baseUnit = roundMoney(rawBase);
      const cardUnit = sellerBaseToMarketplacePrice(baseUnit);
      const unitPrice = credit ? cardUnit : baseUnit;
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
    const credit = isCreditCardPayment(method);
    const ids = Array.from(new Set(
      ensureArray(items)
        .map((item) => String(item.productId || item._id || item.id || '').trim())
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
    ));

    if (!ids.length) return items;

    const products = await Product.find({ _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } })
      .select('_id name sku sellerId image imageUrl mainImageUrl price preco pixPrice sellerBasePrice sellerBaseUnitPrice basePrice precoBaseSeller precoSeller')
      .lean();

    const productMap = new Map(products.map((p) => [String(p._id), p]));

    for (const item of ensureArray(items)) {
      const qty = Math.max(1, Number(item.qty || item.quantity || 1) || 1);
      const productId = String(item.productId || item._id || item.id || '').trim();
      const product = productMap.get(productId);
      if (!product) continue;

      const baseUnit = getProductSellerBasePrice(product);
      if (baseUnit <= 0) continue;

      const chargedUnit = credit ? sellerBaseToMarketplacePrice(baseUnit) : baseUnit;
      const sellerBaseTotal = roundMoney(baseUnit * qty);
      const totalPrice = roundMoney(chargedUnit * qty);

      item.name = item.name || product.name || '';
      item.sku = item.sku || product.sku || '';
      item.sellerId = item.sellerId || product.sellerId || '';
      item.image = item.image || product.imageUrl || product.image || product.mainImageUrl || '';

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

  app.post('/api/orders', async (req, res) => {
    let reservedStock = [];
    try {
      const body = req.body || {};
      const items = normalizeOrderItemsForCheckout(body);

      if (!items.length) {
        return res.status(400).json({ ok: false, error: 'Carrinho vazio. Adicione ao menos um produto para finalizar a compra.' });
      }

      reservedStock = await reserveStockForOrderItems(items);
      await forceOrderItemsSellerBaseFromProducts(items, body);

      const subtotal = items.reduce((sum, item) => sum + Number(item.totalPrice || 0), 0);
      const shippingCost = Number(body.shippingCost || body.shipping?.price || 0);
      const montagemCost = Number(body.montagemCost || 0);
      const total = Number(body.total || (subtotal + shippingCost + montagemCost));
      const sellerIds = Array.from(new Set(items.map(item => item.sellerId).filter(Boolean)));

      const shipping = body.shipping || {};
      if (shipping && !shipping.prazo && (shipping.deadlineDays || shipping.deliveryTime || shipping.prazoEntrega)) {
        shipping.prazo = shipping.deliveryTime || shipping.prazoEntrega || `${shipping.deadlineDays} dia(s) úteis`;
      }

      const order = await Order.create({
        userId: normalizeObjectId(body.userId) || null,
        sellerIds,
        customerName: body.customerName || body.customer?.name || '',
        customerEmail: body.customerEmail || body.customer?.email || '',
        customerPhone: body.customerPhone || body.customer?.phone || '',
        status: body.status || 'pendente',
        statusLabel: body.statusLabel || body.status || 'pendente',
        items,
        subtotal,
        shippingCost,
        montagemCost,
        total,
        payment: body.payment || {},
        shippingAddress: body.shippingAddress || {},
        shipping,
        notes: body.notes || '',
        manufacturer: body.manufacturer || sellerIds[0] || ''
      });

      // Pedido criado no checkout ainda NÃƒO é venda concluída.
      // Não notifica admin/seller/WhatsApp e não envia ao fabricante antes do pagamento aprovado.
      // A notificação de "Nova venda recebida" fica centralizada no helper notifySaleAfterPaymentApproved().
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
        availableStock: error.availableStock ?? undefined
      });
    }
  });
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
