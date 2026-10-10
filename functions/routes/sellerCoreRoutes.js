// ============================================================
// ROTAS PRINCIPAIS DO SELLER - ARIANA MÓVEIS
// Extraído de legacyRoutes.js na divisão de rotas - Etapa 4.
// Mantém os mesmos endpoints, middlewares, regras e respostas.
// ============================================================

export default function registerSellerCoreRoutes(app, context = {}) {
  const {
    User,
    Seller,
    Product,
    Order,
    Notification,
    Ticket,
    JWT_SECRET,
    mongoose,
    jwt,
    bcrypt,
    signToken,
    uid,
    now,
    ensureArray,
    toJSON,
    normalizeObjectId,
    productPayloadFromBody,
    normalizeProductForResponse,
    extractSellerIdsFromOrder,
    createSellerOrderNotifications,
    createAdminNotification,
    waMaybeNotifyOrderStatusChange,
    waNotifyAdminOrderStatusChange,
    getPaymentsSettings,
    buildSellerSplitSummary,
    buildPagarmeRecipientPayloadFromSeller,
    createPagarmeRecipient,
    normalizePagarmeRecipientResponse,
    writeAuditLog,
    redact,
    formatMoneyBRL,
    cleanPhone,
    normalizePagarmeBankCode,
    normalizePagarmeAccountType,
    buildProductBasePriceMapForOrders,
    getSellerSettlementForOrder,
    upload,
    uploadToCloudinary,
    cloudinary,
    fs
  } = context;



function isRemoteImageUrl(value = '') {
  const url = String(value || '').trim();
  return /^https?:\/\//i.test(url) && !/^data:/i.test(url);
}

function sanitizeSellerImageEntry(img, index = 0) {
  if (!img) return null;
  if (typeof img === 'string') {
    const url = String(img || '').trim();
    if (!isRemoteImageUrl(url)) return null;
    return { url, path: url, name: `imagem_${index + 1}`, isMain: index === 0 };
  }

  const url = String(img.url || img.imageUrl || img.secure_url || img.downloadURL || img.downloadUrl || img.image || '').trim();
  if (!isRemoteImageUrl(url)) return null;

  const pathValue = String(img.path || img.public_id || img.publicId || img.fullPath || img.filePath || url).trim();

  return {
    url,
    path: pathValue || url,
    name: String(img.name || img.originalname || `imagem_${index + 1}`).trim(),
    isMain: img.isMain === true || index === 0,
    publicId: String(img.publicId || img.public_id || '').trim() || undefined,
    contentType: String(img.contentType || img.mimetype || '').trim() || undefined
  };
}

function normalizeSellerProductImages(body = {}, existing = {}) {
  const rawImages = [];
  if (Array.isArray(body.images)) rawImages.push(...body.images);
  if (Array.isArray(body.imageUrls)) rawImages.push(...body.imageUrls);

  [body.mainImageUrl, body.imageUrl, body.image, body.imagem].forEach((url) => {
    if (url) rawImages.unshift({ url, isMain: true, name: 'principal' });
  });

  if (!rawImages.length && Array.isArray(existing.images)) rawImages.push(...existing.images);
  if (!rawImages.length) [existing.mainImageUrl, existing.imageUrl, existing.image, existing.imagem].forEach((url) => {
    if (url) rawImages.push({ url, isMain: true, name: 'principal' });
  });

  const unique = new Map();
  rawImages.forEach((img, index) => {
    const normalized = sanitizeSellerImageEntry(img, index);
    if (!normalized) return;
    const key = normalized.path || normalized.url;
    if (!unique.has(key)) unique.set(key, normalized);
  });

  const images = Array.from(unique.values());
  if (images.length && !images.some((img) => img.isMain)) images[0].isMain = true;
  return images;
}

function normalizeSellerProductForResponse(doc = {}) {
  const product = normalizeProductForResponse(doc) || {};
  const specs = product.specs && typeof product.specs === 'object' ? product.specs : {};
  const catalog = specs.sellerCatalog && typeof specs.sellerCatalog === 'object' ? specs.sellerCatalog : {};
  const approval = specs.sellerApproval && typeof specs.sellerApproval === 'object' ? specs.sellerApproval : {};
  const approvalStatus = String(
    approval.status ||
    (product.active === true ? 'approved' : 'pending')
  ).trim().toLowerCase();

  return {
    ...product,
    categorySlug: String(product.categorySlug || catalog.categorySlug || '').trim(),
    subcategory: String(product.subcategory || catalog.subcategory || '').trim(),
    subcategoryName: String(product.subcategoryName || catalog.subcategoryName || catalog.subcategory || '').trim(),
    subcategoryId: String(product.subcategoryId || catalog.subcategoryId || '').trim(),
    subcategorySlug: String(product.subcategorySlug || catalog.subcategorySlug || '').trim(),
    approvalStatus,
    status: product.active === true
      ? 'approved'
      : approvalStatus === 'archived'
        ? 'archived'
        : approvalStatus === 'rejected'
          ? 'rejected'
          : 'pending_review'
  };
}

function buildSellerProductPayload(req, existingDoc = null) {
  const body = req.body || {};
  const existing = existingDoc ? normalizeSellerProductForResponse(existingDoc) : {};
  const basePayload = productPayloadFromBody(body, existingDoc);
  const images = normalizeSellerProductImages(body, existing);
  const mainImage = images.find((img) => img.isMain) || images[0] || null;
  const sid = String(req.sellerId || req.user?.sellerId || req.seller?.sellerId || '').trim();

  const payload = {
    ...basePayload,
    sellerId: sid,
    sellerName: String(req.seller?.storeName || req.seller?.displayName || req.user?.name || body.sellerName || existing.sellerName || 'Seller').trim(),
    name: String(body.name || body.nome || basePayload.name || existing.name || '').trim(),
    description: String(body.description ?? body.descricao ?? basePayload.description ?? existing.description ?? '').trim(),
    category: String(body.category ?? body.categoria ?? body.categoryName ?? basePayload.category ?? existing.category ?? '').trim(),
    categoryName: String(body.categoryName ?? body.category ?? body.categoria ?? basePayload.categoryName ?? existing.categoryName ?? '').trim(),
    categoryId: String(body.categoryId ?? basePayload.categoryId ?? existing.categoryId ?? '').trim(),
    subcategory: String(body.subcategory ?? body.subcategoria ?? existing.subcategory ?? '').trim(),
    subcategoryName: String(body.subcategoryName ?? body.subcategory ?? existing.subcategoryName ?? '').trim(),
    subcategorySlug: String(body.subcategorySlug ?? existing.subcategorySlug ?? '').trim(),
    sku: String(body.sku || basePayload.sku || existing.sku || uid('sku')).trim(),
    price: Number(basePayload.price || 0),
    pixPrice: body.pixPrice !== undefined && body.pixPrice !== null && body.pixPrice !== '' ? Number(basePayload.pixPrice || basePayload.price || 0) : Number(basePayload.pixPrice || basePayload.price || 0),
    stock: Number(body.stock ?? body.estoque ?? basePayload.stock ?? existing.stock ?? 0),
    active: body.active !== undefined ? body.active !== false && String(body.active).toLowerCase() !== 'false' : existing.active !== false,
    image: mainImage ? mainImage.url : null,
    imageUrl: mainImage ? mainImage.url : null,
    imagem: mainImage ? mainImage.url : null,
    mainImageUrl: mainImage ? mainImage.url : null,
    mainImagePath: mainImage ? (mainImage.path || mainImage.url) : null,
    images,
    imageUrls: images.map((img) => img.url).filter(Boolean),
    imagePaths: images.map((img) => img.path || img.url).filter(Boolean),
    weight: Number(body.weight ?? body.pesoKg ?? body.peso ?? basePayload.weight ?? existing.weight ?? 0),
    length: Number(body.length ?? body.comprimento ?? basePayload.length ?? existing.length ?? 0),
    width: Number(body.width ?? body.largura ?? basePayload.width ?? existing.width ?? 0),
    height: Number(body.height ?? body.altura ?? basePayload.height ?? existing.height ?? 0),
    specs: body.specs ?? body.especificacoes ?? body.technicalSpecs ?? body.especificacaoTecnica ?? body.specsText ?? basePayload.specs ?? existing.specs ?? {},
    updatedAt: now()
  };

  const rawSpecs = payload.specs;
  const technicalSpecsText = String(
    body.technicalSpecs ??
    body.especificacaoTecnica ??
    body.specsText ??
    (typeof body.especificacoes === 'string' ? body.especificacoes : '') ??
    ''
  ).trim();
  const originalSpecs = rawSpecs && typeof rawSpecs === 'object' && !Array.isArray(rawSpecs)
    ? { ...rawSpecs }
    : (String(rawSpecs || '').trim() ? { texto: String(rawSpecs || '').trim() } : {});
  if (technicalSpecsText && !String(originalSpecs.texto || '').trim()) {
    originalSpecs.texto = technicalSpecsText;
  }
  payload.specs = {
    ...originalSpecs,
    sellerCatalog: {
      categoryId: String(body.categoryId ?? existing.categoryId ?? '').trim(),
      categoryName: String(body.categoryName ?? body.category ?? body.categoria ?? existing.categoryName ?? existing.category ?? '').trim(),
      categorySlug: String(body.categorySlug ?? existing.categorySlug ?? '').trim(),
      subcategory: String(body.subcategory ?? body.subcategoria ?? existing.subcategory ?? '').trim(),
      subcategoryName: String(body.subcategoryName ?? body.subcategory ?? existing.subcategoryName ?? '').trim(),
      subcategoryId: String(body.subcategoryId ?? existing.subcategoryId ?? '').trim(),
      subcategorySlug: String(body.subcategorySlug ?? existing.subcategorySlug ?? '').trim()
    }
  };

  // Flags editoriais pertencem à Ariana. O seller nunca pode se autodeclarar
  // oferta, destaque, mais vendido ou recomendado por manipulação do payload.
  const editorialFlags = ['isOffer', 'isFavorite', 'isHighlight', 'isBestSeller', 'isNewArrival', 'isRecommended'];
  for (const flag of editorialFlags) {
    payload[flag] = existingDoc ? existing[flag] === true : false;
  }

  // Proteção final: nunca permitir Base64/Buffer/arquivo bruto no Mongo.
  ['image', 'imageUrl', 'imagem', 'mainImageUrl', 'mainImagePath'].forEach((key) => {
    if (payload[key] && !isRemoteImageUrl(payload[key])) payload[key] = null;
  });
  payload.images = Array.isArray(payload.images) ? payload.images.filter((img) => isRemoteImageUrl(img?.url)) : [];
  payload.imageUrls = payload.images.map((img) => img.url).filter(Boolean);
  payload.imagePaths = payload.images.map((img) => img.path || img.url).filter(Boolean);

  return payload;
}

function sellerIdsForSellerRoute(orderDoc = {}) {
  const order = toJSON(orderDoc) || orderDoc || {};
  const ids = new Set();

  ensureArray(order.sellerIds).forEach((value) => {
    const id = String(value || '').trim();
    if (id) ids.add(id);
  });

  ensureArray(order.items).forEach((item) => {
    const id = String(item?.sellerId || item?.seller_id || '').trim();
    if (id) ids.add(id);
  });

  return Array.from(ids);
}

function sellerOrderQuery(sellerId = '') {
  const sid = String(sellerId || '').trim();
  return {
    $or: [
      { sellerIds: sid },
      { 'items.sellerId': sid },
      { 'items.seller_id': sid }
    ]
  };
}

function sellerItemsForOrder(orderDoc = {}, sellerId = '') {
  const sid = String(sellerId || '').trim();
  const order = toJSON(orderDoc) || orderDoc || {};
  const items = ensureArray(order.items);
  const taggedItems = items.filter((item) => String(item?.sellerId || item?.seller_id || '').trim());
  const ownItems = taggedItems.filter((item) => String(item?.sellerId || item?.seller_id || '').trim() === sid);

  if (ownItems.length) return ownItems;

  // Compatibilidade com pedidos antigos de um único seller que não gravavam
  // sellerId em cada item.
  const sellerIds = sellerIdsForSellerRoute(order);
  if (!taggedItems.length && sellerIds.length === 1 && sellerIds[0] === sid) {
    return items;
  }

  return [];
}

function sellerItemGross(item = {}) {
  const qty = Math.max(1, Number(item.qty ?? item.quantity ?? item.quantidade ?? 1) || 1);
  const explicitTotal = item.sellerBaseTotal ?? item.seller_base_total ?? item.totalPrice ?? item.total;
  if (explicitTotal !== undefined && explicitTotal !== null && explicitTotal !== '') {
    return Number(explicitTotal || 0);
  }
  const unit = Number(item.sellerBaseUnitPrice ?? item.seller_base_unit_price ?? item.unitPrice ?? item.price ?? 0) || 0;
  return unit * qty;
}

function sellerFulfillmentForOrder(orderDoc = {}, sellerId = '') {
  const order = toJSON(orderDoc) || orderDoc || {};
  const sid = String(sellerId || '').trim();
  const sellerMap = order.shipping && typeof order.shipping === 'object'
    ? order.shipping.sellers
    : null;
  const value = sellerMap && typeof sellerMap === 'object' ? sellerMap[sid] : null;
  return value && typeof value === 'object' ? value : {};
}

function isShippedSellerStatus(value = '') {
  const status = String(value || '').trim().toLowerCase();
  return ['shipped', 'enviado', 'delivered', 'entregue'].includes(status);
}

function applySellerFulfillment(orderDoc, sellerId, update = {}) {
  const sid = String(sellerId || '').trim();
  const order = orderDoc;
  const sellerIds = sellerIdsForSellerRoute(order);
  const isMultiSeller = sellerIds.length > 1;
  const shipping = order.shipping && typeof order.shipping === 'object'
    ? { ...order.shipping }
    : {};
  const sellers = shipping.sellers && typeof shipping.sellers === 'object'
    ? { ...shipping.sellers }
    : {};
  const current = sellers[sid] && typeof sellers[sid] === 'object'
    ? { ...sellers[sid] }
    : {};

  sellers[sid] = {
    ...current,
    ...update,
    sellerId: sid,
    updatedAt: now()
  };

  shipping.sellers = sellers;

  if (!isMultiSeller) {
    if (update.carrier !== undefined) shipping.carrier = update.carrier;
    if (update.trackingCode !== undefined) shipping.trackingCode = update.trackingCode;
    if (update.shippedAt !== undefined) shipping.shippedAt = update.shippedAt;
  }

  order.shipping = shipping;

  const allShipped = sellerIds.length > 0 && sellerIds.every((id) => {
    const own = sellers[id] || {};
    return isShippedSellerStatus(own.status || own.statusLabel);
  });
  const anyShipped = sellerIds.some((id) => {
    const own = sellers[id] || {};
    return isShippedSellerStatus(own.status || own.statusLabel);
  });

  if (allShipped) {
    order.status = 'shipped';
    order.statusLabel = 'Enviado';
  } else if (anyShipped) {
    order.status = 'processing';
    order.statusLabel = 'Envio parcial';
  } else if (String(update.status || '').toLowerCase() === 'processing') {
    order.status = 'processing';
    order.statusLabel = 'Em preparação';
  }

  if (!isMultiSeller && update.trackingCode) {
    order.trackingCode = update.trackingCode;
  }

  return { sellerIds, isMultiSeller, allShipped, anyShipped };
}

function sellerOrderForResponse(orderDoc, sellerId) {
  const sid = String(sellerId || '').trim();
  const order = toJSON(orderDoc) || {};
  const items = sellerItemsForOrder(order, sid);
  const sellerIds = sellerIdsForSellerRoute(order);
  const fulfillment = sellerFulfillmentForOrder(order, sid);
  const sellerGross = Math.max(0, items.reduce((sum, item) => sum + sellerItemGross(item), 0));
  const isMultiSeller = sellerIds.length > 1;

  const safeShipping = order.shipping && typeof order.shipping === 'object'
    ? { ...order.shipping }
    : {};
  delete safeShipping.sellers;

  if (fulfillment.carrier) safeShipping.carrier = fulfillment.carrier;
  if (fulfillment.trackingCode) safeShipping.trackingCode = fulfillment.trackingCode;
  if (fulfillment.shippedAt) safeShipping.shippedAt = fulfillment.shippedAt;

  const safe = {
    ...order,
    items,
    sellerIds: sid ? [sid] : [],
    sellerOrderPartial: isMultiSeller,
    sellerGross,
    subtotal: isMultiSeller ? sellerGross : Number(order.subtotal || sellerGross),
    total: isMultiSeller ? sellerGross : Number(order.total || sellerGross),
    shippingCost: isMultiSeller ? 0 : Number(order.shippingCost || 0),
    status: fulfillment.status || order.status,
    statusLabel: fulfillment.statusLabel || order.statusLabel,
    trackingCode: fulfillment.trackingCode || (!isMultiSeller ? order.trackingCode : ''),
    shipping: safeShipping,
    sellerFulfillment: fulfillment
  };

  // Dados internos da Ariana e documentos de outros participantes não são
  // expostos no endpoint geral do seller. NF-e própria usa rota dedicada.
  [
    'payment',
    'paymentDetails',
    'gatewayResponse',
    'gatewayPayload',
    'split',
    'splitSummary',
    'marketplaceSplit',
    'card',
    'cardToken',
    'paymentToken',
    'manufacturerDispatch',
    'status_integracao',
    'whatsappNotification',
    'chatMeta',
    'sige',
    'nfe',
    'notaFiscal',
    'fiscal',
    'sellerInvoices',
    'enterpriseInvoices',
    'sellerDocuments'
  ].forEach((key) => delete safe[key]);

  return safe;
}

function sellerProductOwnerValues(req) {
  return Array.from(new Set([
    req.sellerId,
    req.user?.sellerId,
    req.seller?.sellerId,
    req.seller?._id ? String(req.seller._id) : '',
    req.user?._id ? String(req.user._id) : ''
  ].map((value) => String(value || '').trim()).filter(Boolean)));
}

function sellerProductQuery(req, extra = {}) {
  const values = sellerProductOwnerValues(req);
  const sellerOr = [];

  for (const value of values) {
    sellerOr.push({ sellerId: value });
  }

  const sellerEmail = String(req.seller?.email || req.user?.email || '').trim().toLowerCase();
  if (sellerEmail) sellerOr.push({ sellerEmail });

  return { ...(sellerOr.length ? { $or: sellerOr } : {}), ...(extra || {}) };
}

app.post('/api/seller/products', sellerAuthRequired, async (req, res) => {
  try {
    const payload = buildSellerProductPayload(req);

    if (!payload.sellerId) {
      return res.status(400).json({ ok: false, error: 'Seller não identificado' });
    }

    if (!payload.name || !Number.isFinite(payload.price) || payload.price <= 0) {
      return res.status(400).json({ ok: false, error: 'Nome e preço válido são obrigatórios' });
    }
    if (!Number.isFinite(payload.stock) || payload.stock < 0) {
      return res.status(400).json({ ok: false, error: 'Estoque inválido' });
    }
    payload.active = false;
    payload.specs = {
      ...(payload.specs && typeof payload.specs === 'object' ? payload.specs : {}),
      sellerApproval: {
        status: 'pending',
        submittedAt: now(),
        sellerId: payload.sellerId
      }
    };

    const created = await Product.create(payload);
    const product = normalizeSellerProductForResponse(created);

    return res.status(201).json({
      ok: true,
      product,
      item: product,
      id: String(created._id || product.id || '')
    });
  } catch (error) {
    console.error('Erro ao criar produto seller:', error);
    return res.status(500).json({
      ok: false,
      error: error.message || 'Erro ao publicar produto'
    });
  }
});

if (typeof uploadToCloudinary === 'function' && upload?.single) {
  app.post('/api/seller/uploads', sellerAuthRequired, upload.single('file'), uploadToCloudinary);
  app.post('/api/seller/products/upload', sellerAuthRequired, upload.single('file'), uploadToCloudinary);
}

function sellerSupportTicketForResponse(doc = {}) {
  const item = toJSON(doc) || doc || {};
  const orderId = String(item.orderId || item.pedido || '').trim();
  return {
    _id: item._id ? String(item._id) : '',
    id: String(item._id || item.id || ''),
    protocolo: String(item.protocolo || ''),
    orderId,
    pedido: orderId,
    tipo: String(item.tipo || 'Suporte'),
    assunto: String(item.assunto || ''),
    mensagem: String(item.mensagem || item.message || ''),
    status: String(item.status || 'Novo'),
    origem: String(item.origem || ''),
    nome: String(item.nome || item.name || ''),
    email: String(item.email || ''),
    telefone: String(item.telefone || item.phone || ''),
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null
  };
}

async function sellerSupportTicketsForRequest(req) {
  if (!Ticket) return [];
  const sid = String(req.sellerId || '').trim();
  if (!sid) return [];

  const directFilter = {
    $or: [
      { 'metadata.sellerId': sid },
      { 'metadata.seller_id': sid },
      { 'metadata.sellerIds': sid },
      { 'metadata.sellerIds': { $in: [sid] } }
    ]
  };

  const directTickets = await Ticket.find(directFilter).sort({ createdAt: -1 }).limit(250);
  const seen = new Map(directTickets.map((doc) => [String(doc._id), doc]));

  const orderDocs = await Order.find(sellerOrderQuery(sid))
    .select('_id id orderNumber numeroPedido orderId')
    .limit(1000);

  const refs = new Set();
  for (const orderDoc of orderDocs) {
    const order = toJSON(orderDoc) || {};
    [order._id, order.id, order.orderNumber, order.numeroPedido, order.orderId].forEach((value) => {
      const clean = String(value || '').trim();
      if (clean) refs.add(clean);
    });
  }

  if (refs.size) {
    const relatedTickets = await Ticket.find({ orderId: { $in: Array.from(refs) } })
      .sort({ createdAt: -1 })
      .limit(250);
    for (const doc of relatedTickets) seen.set(String(doc._id), doc);
  }

  return Array.from(seen.values())
    .sort((a, b) => new Date(b?.createdAt || 0) - new Date(a?.createdAt || 0))
    .slice(0, 250);
}

app.get('/api/seller/support', sellerAuthRequired, async (req, res) => {
  try {
    const docs = await sellerSupportTicketsForRequest(req);
    return res.json(docs.map(sellerSupportTicketForResponse));
  } catch (error) {
    console.error('Erro ao carregar atendimentos do seller:', error);
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar atendimentos do seller' });
  }
});

app.patch('/api/seller/support/:id/read', sellerAuthRequired, async (req, res) => {
  try {
    const ticketId = normalizeObjectId(req.params.id);
    if (!ticketId) return res.status(400).json({ ok: false, error: 'Chamado inválido' });

    const docs = await sellerSupportTicketsForRequest(req);
    const allowed = docs.some((doc) => String(doc?._id || '') === String(ticketId));
    if (!allowed) return res.status(404).json({ ok: false, error: 'Chamado não encontrado' });

    const ticket = await Ticket.findByIdAndUpdate(
      ticketId,
      { $set: { status: 'Lido', 'metadata.sellerReadAt': now() } },
      { new: true }
    );

    return res.json({ ok: true, ticket: sellerSupportTicketForResponse(ticket) });
  } catch (error) {
    console.error('Erro ao atualizar atendimento do seller:', error);
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao atualizar atendimento do seller' });
  }
});

app.get('/api/seller/returns', sellerAuthRequired, async (req, res) => {
  try {
    const sid = String(req.sellerId || '').trim();

    const orders = await Order.find({
      $and: [
        sellerOrderQuery(sid),
        { $or: [
        { status: /devol/i },
        { status: /troca/i },
        { statusLabel: /devol/i },
        { statusLabel: /troca/i },
        { returnReason: { $exists: true, $ne: '' } },
        { reason: { $exists: true, $ne: '' } }
        ] }
      ]
    }).sort({ updatedAt: -1, createdAt: -1 }).limit(100);

    return res.json(orders.map((order) => sellerOrderForResponse(order, sid)));
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || 'Erro ao buscar devoluções'
    });
  }
});

async function sellerAuthRequired(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!token) return res.status(401).json({ ok: false, error: 'Token ausente' });

    const dec = jwt.verify(token, JWT_SECRET);
    const user = dec.id ? await User.findById(dec.id) : null;
    if (!user) return res.status(401).json({ ok: false, error: 'Usuário inválido' });

    const userEmail = String(user.email || '').trim().toLowerCase();
    const userRole = String(user.role || '').trim().toLowerCase();
    const sid = String(user.sellerId || dec.sellerId || '').trim();

    let seller = null;
    let linkType = '';

    if (sid) {
      seller = await Seller.findOne({ sellerId: sid });
      if (seller) linkType = 'seller_id';
    }

    if (!seller && user._id) {
      seller = await Seller.findOne({ userId: user._id });
      if (seller) linkType = 'user_id';
    }

    if (!seller && userRole === 'seller' && userEmail) {
      const legacySeller = await Seller.findOne({
        $or: [{ email: userEmail }, { 'metadata.email': userEmail }]
      });
      if (legacySeller && (!legacySeller.userId || String(legacySeller.userId) === String(user._id))) {
        seller = legacySeller;
        linkType = 'legacy_seller_email';
      }
    }

    if (!seller) {
      return res.status(403).json({ ok: false, code: 'SELLER_ACCOUNT_NOT_LINKED', error: 'Esta conta não está vinculada a um seller.' });
    }

    const sellerStatus = String(seller.status || seller.metadata?.status || '').trim().toLowerCase();
    const blockedSellerStatuses = ['pending', 'pending_onboarding', 'pendente', 'aguardando_aprovacao', 'rejected', 'reprovado', 'blocked', 'bloqueado', 'suspended', 'suspenso', 'inactive', 'inativo'];
    if (blockedSellerStatuses.includes(sellerStatus)) {
      return res.status(403).json({
        ok: false,
        code: 'SELLER_NOT_ACTIVE',
        status: sellerStatus,
        error: ['rejected','reprovado','blocked','bloqueado','suspended','suspenso','inactive','inativo'].includes(sellerStatus)
          ? 'Acesso do seller indisponível. Entre em contato com a Ariana Móveis.'
          : 'Cadastro do seller ainda está aguardando aprovação.'
      });
    }

    if (user.isActive === false) return res.status(403).json({ ok: false, code: 'SELLER_USER_INACTIVE', error: 'Usuário do seller está inativo.' });

    const directLink =
      String(user.sellerId || '').trim() === String(seller.sellerId || '').trim() ||
      String(seller.userId || '') === String(user._id || '') ||
      linkType === 'legacy_seller_email';

    if (!directLink) return res.status(403).json({ ok: false, code: 'SELLER_ACCOUNT_LINK_MISMATCH', error: 'A conta autenticada não corresponde a este seller.' });

    let userChanged = false;
    if (String(user.role || '').toLowerCase() !== 'seller') { user.role = 'seller'; userChanged = true; }
    if (String(user.sellerId || '').trim() !== String(seller.sellerId || '').trim()) { user.sellerId = seller.sellerId; userChanged = true; }
    if (userChanged) await user.save();

    if (!seller.userId && user._id) { seller.userId = user._id; await seller.save(); }

    req.user = user;
    req.seller = seller;
    req.sellerId = String(seller.sellerId || user.sellerId || '');
    return next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: 'Token inválido' });
  }
}

function cleanDigitsOnly(value = '') { return String(value || '').replace(/\D/g, ''); }
function normalizeSellerBankFields(raw = {}) {
  const bank = raw && typeof raw === 'object' ? raw : {};
  const fullAccountRaw = String(bank.account ?? bank.number ?? bank.bankAccount ?? bank.bankAccountNumber ?? bank.accountNumber ?? '').trim();
  const fullAccountDigits = cleanDigitsOnly(fullAccountRaw);
  const explicitDigit = String(bank.accountDigit ?? bank.accountCheckDigit ?? bank.contaDigito ?? '').replace(/\D/g, '').trim();
  const accountDigit = explicitDigit || (fullAccountDigits.length > 1 ? fullAccountDigits.slice(-1) : '');
  const accountNumber = explicitDigit ? fullAccountDigits : (fullAccountDigits.length > 1 ? fullAccountDigits.slice(0, -1) : fullAccountDigits);
  const fullAccount = fullAccountDigits || fullAccountRaw;
  return {
    bank: String(bank.bank ?? bank.bankName ?? bank.banco ?? '').trim(),
    bankName: String(bank.bankName ?? bank.bank ?? bank.banco ?? '').trim(),
    bankCode: cleanDigitsOnly(bank.bankCode ?? bank.codigoBanco ?? bank.code ?? ''),
    agency: cleanDigitsOnly(bank.agency ?? bank.bankAgency ?? bank.agencia ?? bank.branchNumber ?? ''),
    branchNumber: cleanDigitsOnly(bank.branchNumber ?? bank.agency ?? bank.bankAgency ?? bank.agencia ?? ''),
    agencyDigit: cleanDigitsOnly(bank.agencyDigit ?? bank.branchCheckDigit ?? bank.agenciaDigito ?? ''),
    branchCheckDigit: cleanDigitsOnly(bank.branchCheckDigit ?? bank.agencyDigit ?? bank.agenciaDigito ?? ''),
    account: fullAccount,
    number: fullAccount,
    fullAccount,
    accountNumber,
    accountDigit,
    accountCheckDigit: accountDigit,
    pixKey: String(bank.pixKey ?? bank.chavePix ?? '').trim(),
    accountType: String(bank.accountType ?? bank.bankAccountType ?? bank.tipoConta ?? 'checking').trim(),
    holderName: String(bank.holderName ?? bank.bankHolderName ?? bank.titular ?? '').trim(),
    holderDocument: cleanDigitsOnly(bank.holderDocument ?? bank.bankHolderDocument ?? bank.documentTitular ?? bank.cpfCnpjTitular ?? '')
  };
}

function sanitizeSellerMetadataForResponse(value = {}, depth = 0) {
  if (depth > 6) return null;
  if (Array.isArray(value)) return value.map((item) => sanitizeSellerMetadataForResponse(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const sensitive = normalizedKey === 'password' || normalizedKey === 'senha' || normalizedKey === 'requestedtemppass' || normalizedKey === 'confirmpassword' || normalizedKey === 'passwordhash' || normalizedKey === 'resetpasswordtokenhash' || normalizedKey === 'resettoken' || normalizedKey === 'authtoken' || normalizedKey === 'accesstoken' || normalizedKey === 'refreshtoken' || normalizedKey === 'jwt' || normalizedKey === 'apikey' || normalizedKey.includes('secret') || normalizedKey.includes('privatekey');
    if (sensitive) continue;
    out[key] = sanitizeSellerMetadataForResponse(item, depth + 1);
  }
  return out;
}

function sellerUserForResponse(user) {
  const o = toJSON(user) || {};
  return {
    _id: o._id,
    id: String(o._id || o.id || ''),
    name: String(o.name || ''),
    email: String(o.email || ''),
    phone: String(o.phone || ''),
    cpf: String(o.cpf || ''),
    role: String(o.role || ''),
    sellerId: String(o.sellerId || ''),
    city: String(o.city || ''),
    uf: String(o.uf || ''),
    isActive: o.isActive !== false,
    emailVerified: o.emailVerified === true,
    authProvider: String(o.authProvider || 'password'),
    mustChangePassword: o.mustChangePassword === true,
    createdAt: o.createdAt || null,
    updatedAt: o.updatedAt || null
  };
}

function isApprovedSellerStatus(value = '') {
  return ['approved', 'aprovado', 'active', 'ativo'].includes(String(value || '').trim().toLowerCase());
}

function sellerFieldCanBeCompleted(isApproved, currentValue) {
  if (!isApproved) return true;
  return !String(currentValue ?? '').trim();
}

function sellerProfile(s, u) {
  const o = toJSON(s) || {};
  const meta = sanitizeSellerMetadataForResponse(o.metadata && typeof o.metadata === 'object' ? o.metadata : {});
  const rootBank = o.bankAccount && typeof o.bankAccount === 'object' ? o.bankAccount : {};
  const bankFromMeta = meta.bankAccount && typeof meta.bankAccount === 'object' ? meta.bankAccount : {};
  const legacyMetaBankAccount = meta.bankAccount && typeof meta.bankAccount !== 'object' ? String(meta.bankAccount) : '';
  const bankAccount = normalizeSellerBankFields({
    bank: rootBank.bank || rootBank.bankName || bankFromMeta.bank || bankFromMeta.bankName || meta.bank || meta.bankName || '',
    bankName: rootBank.bankName || rootBank.bank || bankFromMeta.bankName || bankFromMeta.bank || meta.bankName || meta.bank || '',
    bankCode: rootBank.bankCode || bankFromMeta.bankCode || meta.bankCode || meta.codigoBanco || '',
    agency: rootBank.agency || rootBank.bankAgency || bankFromMeta.agency || bankFromMeta.bankAgency || meta.bankAgency || meta.agency || meta.branchNumber || '',
    agencyDigit: rootBank.agencyDigit || rootBank.branchCheckDigit || bankFromMeta.agencyDigit || bankFromMeta.branchCheckDigit || meta.agencyDigit || meta.branchCheckDigit || '',
    account: rootBank.account || rootBank.accountNumber || rootBank.number || rootBank.bankAccount || bankFromMeta.account || bankFromMeta.accountNumber || bankFromMeta.number || bankFromMeta.bankAccount || meta.accountNumber || meta.bankAccountNumber || meta.conta || legacyMetaBankAccount || '',
    accountDigit: rootBank.accountDigit || rootBank.accountCheckDigit || bankFromMeta.accountDigit || bankFromMeta.accountCheckDigit || meta.accountDigit || meta.accountCheckDigit || meta.contaDigito || '',
    pixKey: rootBank.pixKey || bankFromMeta.pixKey || meta.pixKey || '',
    accountType: rootBank.accountType || bankFromMeta.accountType || meta.accountType || meta.bankAccountType || meta.tipoConta || '',
    holderName: rootBank.holderName || rootBank.bankHolderName || bankFromMeta.holderName || bankFromMeta.bankHolderName || meta.bankHolderName || meta.holderName || '',
    holderDocument: rootBank.holderDocument || rootBank.bankHolderDocument || bankFromMeta.holderDocument || bankFromMeta.bankHolderDocument || meta.bankHolderDocument || meta.holderDocument || meta.documentTitular || meta.cpfCnpjTitular || ''
  });
  const status = String(o.status || meta.status || '').toLowerCase();
  return {
    ...o,
    metadata: meta,
    id: String(o.sellerId || o._id || ''),
    sellerId: String(o.sellerId || ''),
    name: o.displayName || o.storeName || u?.name || '',
    factoryName: String(meta.factoryName || o.storeName || o.displayName || u?.name || '').trim(),
    storeName: String(o.storeName || meta.storeName || meta.factoryName || o.displayName || '').trim(),
    displayName: String(o.displayName || o.storeName || meta.factoryName || u?.name || '').trim(),
    email: o.email || u?.email || meta.email || '',
    phone: o.phone || u?.phone || meta.phone || '',
    document: o.document || u?.cpf || meta.document || meta.cnpj || '',
    cnpj: String(meta.cnpj || o.document || u?.cpf || '').trim(),
    bio: String(meta.bio || meta.description || meta.descricao || o.bio || '').trim(),
    description: String(meta.bio || meta.description || meta.descricao || o.description || '').trim(),
    cep: String(meta.cep || meta.postalCode || meta.zipCode || '').replace(/\D/g, ''),
    address: String(meta.address || meta.endereco || meta.streetAddress || '').trim(),
    endereco: String(meta.endereco || meta.address || meta.streetAddress || '').trim(),
    city: String(u?.city || meta.city || meta.cidade || '').trim(),
    cidade: String(meta.cidade || u?.city || meta.city || '').trim(),
    uf: String(u?.uf || meta.uf || meta.state || '').trim().toUpperCase().slice(0, 2),
    bankAccount,
    cepColeta: String(meta.cepColeta || meta.pickupCep || meta.cep_coleta || '').replace(/\D/g, ''),
    tipoLogistica: String(meta.tipoLogistica || meta.shippingType || (meta.transpPropria === true ? 'propria' : 'marketplace')).trim(),
    transpPropria: meta.transpPropria === true || meta.ownCarrier === true || meta.transportadoraPropria === true,
    transportadoraNome: String(meta.transportadoraNome || meta.carrierName || '').trim(),
    transportadoraTelefone: String(meta.transportadoraTelefone || meta.carrierPhone || '').trim(),
    transportadoraPrazo: String(meta.transportadoraPrazo || meta.carrierDeadline || '').trim(),
    freteObs: String(meta.freteObs || meta.shippingNotes || '').trim(),
    active: isApprovedSellerStatus(status)
  };
}

app.post('/api/seller/auth/login', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) return res.status(400).json({ ok: false, error: 'E-mail e senha são obrigatórios' });

    let user = await User.findOne({ email });
    let seller = null;
    const userRole = String(user?.role || '').trim().toLowerCase();
    if (user?.sellerId) seller = await Seller.findOne({ sellerId: user.sellerId });
    if (!seller && user?._id) seller = await Seller.findOne({ userId: user._id });
    if (!seller && (!user || userRole === 'seller')) seller = await Seller.findOne({ $or: [{ email }, { 'metadata.email': email }] });
    if (!seller) return res.status(401).json({ ok: false, error: 'Credenciais inválidas' });
    if (!user) return res.status(403).json({ ok: false, code: 'SELLER_CREDENTIALS_NOT_PROVISIONED', error: 'Seu cadastro existe, mas as credenciais de acesso ainda não foram provisionadas pela Ariana Móveis.' });

    const lockUntil = user.lockedUntil ? new Date(user.lockedUntil) : null;
    if (lockUntil && Number.isFinite(lockUntil.getTime()) && lockUntil.getTime() > Date.now()) {
      return res.status(429).json({ ok: false, code: 'SELLER_LOGIN_TEMPORARILY_LOCKED', error: 'Muitas tentativas de acesso. Aguarde alguns minutos antes de tentar novamente.' });
    }

    let valid = false;
    if (user.passwordHash) {
      try { valid = await bcrypt.compare(password, String(user.passwordHash || '')); } catch (_) { valid = false; }
      if (!valid && String(user.passwordHash || '') === password) {
        valid = true;
        user.passwordHash = await bcrypt.hash(password, 10);
      }
    }
    if (!valid) {
      const attempts = Math.max(0, Number(user.failedLoginAttempts || 0)) + 1;
      user.failedLoginAttempts = attempts;
      if (attempts >= 5) { user.lockedUntil = new Date(Date.now() + 15 * 60 * 1000); user.failedLoginAttempts = 0; }
      await user.save().catch(() => null);
      return res.status(attempts >= 5 ? 429 : 401).json({
        ok: false,
        code: attempts >= 5 ? 'SELLER_LOGIN_TEMPORARILY_LOCKED' : 'SELLER_INVALID_CREDENTIALS',
        error: attempts >= 5 ? 'Muitas tentativas de acesso. Aguarde 15 minutos antes de tentar novamente.' : 'Credenciais inválidas'
      });
    }

    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    const sellerStatus = String(seller.status || seller.metadata?.status || '').trim().toLowerCase();
    const pendingStatuses = ['pending', 'pending_onboarding', 'pendente', 'aguardando_aprovacao'];
    const blockedStatuses = ['rejected', 'reprovado', 'blocked', 'bloqueado', 'suspended', 'suspenso', 'inactive', 'inativo'];
    if (pendingStatuses.includes(sellerStatus)) { await user.save().catch(() => null); return res.status(403).json({ ok: false, code: 'SELLER_PENDING_APPROVAL', error: 'Seu cadastro ainda está aguardando aprovação da Ariana Móveis.' }); }
    if (blockedStatuses.includes(sellerStatus)) { await user.save().catch(() => null); return res.status(403).json({ ok: false, code: 'SELLER_ACCESS_BLOCKED', error: 'Acesso do seller indisponível. Entre em contato com a Ariana Móveis.' }); }
    if (user.isActive === false) { await user.save().catch(() => null); return res.status(403).json({ ok: false, code: 'SELLER_USER_INACTIVE', error: 'Usuário do seller está inativo.' }); }

    const directAccountLink = String(user.sellerId || '').trim() === String(seller.sellerId || '').trim() || String(seller.userId || '') === String(user._id || '');
    if (String(user.role || '').toLowerCase() !== 'seller' && !directAccountLink) return res.status(403).json({ ok: false, code: 'SELLER_ACCOUNT_LINK_MISMATCH', error: 'Este e-mail pertence a uma conta que não está vinculada ao seller.' });
    if (String(user.role || '').toLowerCase() !== 'seller' || !user.sellerId) { user.role = 'seller'; user.sellerId = seller.sellerId || user.sellerId || uid('seller'); }

    user.lastLoginAt = now();
    user.lastLoginIp = String(req.ip || req.headers['x-forwarded-for'] || '').split(',')[0].trim().slice(0, 120);
    user.lastLoginUserAgent = String(req.headers['user-agent'] || '').slice(0, 1000);
    await user.save();
    if (!seller.sellerId) seller.sellerId = user.sellerId || uid('seller');
    if (!seller.userId) seller.userId = user._id;
    seller.metadata = sanitizeSellerMetadataForResponse(seller.metadata || {});
    seller.markModified('metadata');
    await seller.save();

    return res.json({ ok: true, token: signToken(user), seller: sellerProfile(seller, user), user: sellerUserForResponse(user) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'Erro no login seller' });
  }
});

app.get('/api/seller/auth/me', sellerAuthRequired, (req, res) => res.json({ ok: true, seller: sellerProfile(req.seller, req.user), user: sellerUserForResponse(req.user) }));
app.get('/api/seller/profile', sellerAuthRequired, async (req, res) => {
  try { return res.json({ ok: true, seller: sellerProfile(req.seller, req.user), user: sellerUserForResponse(req.user) }); }
  catch (e) { return res.status(500).json({ ok: false, error: e.message || 'Erro ao carregar dados cadastrais do seller' }); }
});

async function saveSellerProfileSettings(req, res) {
  try {
    const body = req.body || {};
    const sellerUpdates = {};
    const userUpdates = {};
    const sellerStatus = String(req.seller?.status || '').trim().toLowerCase();
    const sellerApproved = ['approved', 'aprovado', 'ativo', 'active'].includes(sellerStatus);
    const metadata = { ...(req.seller?.metadata || {}) };

    const incomingStoreName = body.factoryName ?? body.storeName;
    if (incomingStoreName !== undefined) {
      const currentStoreName = req.seller?.storeName || metadata.storeName || metadata.factoryName || '';
      if (sellerFieldCanBeCompleted(sellerApproved, currentStoreName)) {
        const name = String(incomingStoreName || '').trim();
        sellerUpdates.storeName = name;
        metadata.factoryName = name;
        metadata.storeName = name;
      }
    }
    const incomingDisplayName = body.displayName ?? body.name;
    if (incomingDisplayName !== undefined) {
      const currentDisplayName = req.seller?.displayName || req.user?.name || '';
      if (sellerFieldCanBeCompleted(sellerApproved, currentDisplayName)) sellerUpdates.displayName = String(incomingDisplayName || '').trim();
    }
    const incomingDocument = body.cnpj ?? body.document ?? body.cpf;
    if (incomingDocument !== undefined) {
      const currentDocument = req.seller?.document || req.user?.cpf || metadata.document || metadata.cnpj || '';
      if (sellerFieldCanBeCompleted(sellerApproved, currentDocument)) {
        const doc = String(incomingDocument || '').replace(/\D/g, '');
        sellerUpdates.document = doc;
        userUpdates.cpf = doc;
        metadata.cnpj = doc;
        metadata.document = doc;
      }
    }
    if (body.email !== undefined) {
      const currentEmail = req.seller?.email || req.user?.email || metadata.email || '';
      if (sellerFieldCanBeCompleted(sellerApproved, currentEmail)) {
        const email = String(body.email || '').trim().toLowerCase();
        sellerUpdates.email = email;
        userUpdates.email = email;
        metadata.email = email;
      }
    }
    if (body.phone !== undefined) {
      const currentPhone = req.seller?.phone || req.user?.phone || metadata.phone || '';
      if (sellerFieldCanBeCompleted(sellerApproved, currentPhone)) {
        sellerUpdates.phone = String(body.phone || '').trim();
        userUpdates.phone = sellerUpdates.phone;
        metadata.phone = sellerUpdates.phone;
      }
    }
    if (body.cep !== undefined || body.postalCode !== undefined || body.zipCode !== undefined) {
      const currentCep = metadata.cep || metadata.postalCode || metadata.zipCode || '';
      if (sellerFieldCanBeCompleted(sellerApproved, currentCep)) {
        const cep = String(body.cep ?? body.postalCode ?? body.zipCode ?? '').replace(/\D/g, '').slice(0, 8);
        metadata.cep = cep;
        metadata.postalCode = cep;
      }
    }
    if (body.address !== undefined || body.endereco !== undefined || body.streetAddress !== undefined) {
      const currentAddress = metadata.address || metadata.endereco || metadata.streetAddress || '';
      if (sellerFieldCanBeCompleted(sellerApproved, currentAddress)) {
        const address = String(body.address ?? body.endereco ?? body.streetAddress ?? '').trim();
        metadata.address = address;
        metadata.endereco = address;
      }
    }
    if (body.city !== undefined || body.cidade !== undefined) {
      const currentCity = req.user?.city || metadata.city || metadata.cidade || '';
      if (sellerFieldCanBeCompleted(sellerApproved, currentCity)) {
        const city = String(body.city ?? body.cidade ?? '').trim();
        userUpdates.city = city;
        metadata.city = city;
        metadata.cidade = city;
      }
    }
    if (body.uf !== undefined || body.state !== undefined) {
      const currentUf = req.user?.uf || metadata.uf || metadata.state || '';
      if (sellerFieldCanBeCompleted(sellerApproved, currentUf)) {
        const uf = String(body.uf ?? body.state ?? '').trim().toUpperCase().slice(0, 2);
        userUpdates.uf = uf;
        metadata.uf = uf;
        metadata.state = uf;
      }
    }
    if (body.bio !== undefined || body.description !== undefined || body.descricao !== undefined) {
      metadata.bio = String(body.bio ?? body.description ?? body.descricao ?? '').trim();
      metadata.description = metadata.bio;
    }

    const bankBody = body.bankAccount && typeof body.bankAccount === 'object' ? body.bankAccount : {};
    if (body.bankAccount !== undefined || body.bankName !== undefined || body.bankCode !== undefined || body.bankAgency !== undefined || body.account !== undefined || body.accountDigit !== undefined || body.bankHolderName !== undefined || body.bankHolderDocument !== undefined) {
      const bankAccount = normalizeSellerBankFields({
        bank: bankBody.bank ?? bankBody.bankName ?? body.bankName ?? body.bank ?? '',
        bankName: bankBody.bankName ?? bankBody.bank ?? body.bankName ?? body.bank ?? '',
        bankCode: bankBody.bankCode ?? body.bankCode ?? body.codigoBanco ?? '',
        agency: bankBody.agency ?? bankBody.bankAgency ?? body.bankAgency ?? body.agency ?? '',
        agencyDigit: bankBody.agencyDigit ?? bankBody.branchCheckDigit ?? body.agencyDigit ?? body.branchCheckDigit ?? '',
        account: bankBody.account ?? bankBody.accountNumber ?? bankBody.number ?? bankBody.bankAccount ?? body.accountNumber ?? body.bankAccountNumber ?? body.account ?? '',
        accountDigit: bankBody.accountDigit ?? bankBody.accountCheckDigit ?? body.accountDigit ?? body.accountCheckDigit ?? body.contaDigito ?? '',
        pixKey: bankBody.pixKey ?? body.pixKey ?? '',
        accountType: bankBody.accountType ?? bankBody.bankAccountType ?? body.accountType ?? body.bankAccountType ?? 'checking',
        holderName: bankBody.holderName ?? bankBody.bankHolderName ?? body.bankHolderName ?? body.holderName ?? '',
        holderDocument: bankBody.holderDocument ?? bankBody.bankHolderDocument ?? body.bankHolderDocument ?? body.holderDocument ?? body.documentTitular ?? body.cpfCnpjTitular ?? ''
      });
      metadata.bankAccount = bankAccount;
      metadata.bankName = bankAccount.bankName || bankAccount.bank;
      metadata.bank = bankAccount.bank || bankAccount.bankName;
      metadata.bankCode = typeof normalizePagarmeBankCode === 'function' ? (bankAccount.bankCode || normalizePagarmeBankCode(bankAccount.bank || bankAccount.bankName || '')) : bankAccount.bankCode;
      metadata.bankAgency = bankAccount.agency;
      metadata.agency = bankAccount.agency;
      metadata.branchNumber = bankAccount.branchNumber || bankAccount.agency;
      metadata.branchCheckDigit = bankAccount.branchCheckDigit || bankAccount.agencyDigit || '';
      metadata.bankAccountNumber = bankAccount.fullAccount || bankAccount.account;
      metadata.conta = bankAccount.fullAccount || bankAccount.account;
      metadata.accountNumber = bankAccount.accountNumber || bankAccount.fullAccount || bankAccount.account;
      metadata.accountCheckDigit = bankAccount.accountCheckDigit || bankAccount.accountDigit || '';
      metadata.accountDigit = bankAccount.accountDigit || bankAccount.accountCheckDigit || '';
      metadata.pixKey = bankAccount.pixKey || metadata.pixKey || '';
      metadata.accountType = bankAccount.accountType || metadata.accountType || 'checking';
      metadata.bankAccountType = metadata.accountType;
      metadata.bankHolderName = bankAccount.holderName || metadata.bankHolderName || req.seller?.storeName || req.seller?.displayName || '';
      metadata.holderName = metadata.bankHolderName;
      metadata.bankHolderDocument = bankAccount.holderDocument || metadata.bankHolderDocument || req.seller?.document || req.user?.cpf || '';
      metadata.holderDocument = metadata.bankHolderDocument;
    }

    if (body.cepColeta !== undefined || body.pickupCep !== undefined || body.cep_coleta !== undefined) metadata.cepColeta = String(body.cepColeta ?? body.pickupCep ?? body.cep_coleta ?? '').replace(/\D/g, '');
    if (body.tipoLogistica !== undefined || body.shippingType !== undefined) {
      metadata.tipoLogistica = String(body.tipoLogistica ?? body.shippingType ?? '').trim() || 'marketplace';
      metadata.shippingType = metadata.tipoLogistica;
    }
    if (body.transpPropria !== undefined || body.ownCarrier !== undefined || body.transportadoraPropria !== undefined) {
      metadata.transpPropria = body.transpPropria === true || body.ownCarrier === true || body.transportadoraPropria === true;
      metadata.ownCarrier = metadata.transpPropria;
      metadata.transportadoraPropria = metadata.transpPropria;
      if (metadata.transpPropria && !metadata.tipoLogistica) metadata.tipoLogistica = 'propria';
    }
    if (body.transportadoraNome !== undefined || body.carrierName !== undefined) {
      metadata.transportadoraNome = String(body.transportadoraNome ?? body.carrierName ?? '').trim();
      metadata.carrierName = metadata.transportadoraNome;
    }
    if (body.transportadoraTelefone !== undefined || body.carrierPhone !== undefined) {
      metadata.transportadoraTelefone = String(body.transportadoraTelefone ?? body.carrierPhone ?? '').trim();
      metadata.carrierPhone = metadata.transportadoraTelefone;
    }
    if (body.transportadoraPrazo !== undefined || body.carrierDeadline !== undefined) {
      metadata.transportadoraPrazo = String(body.transportadoraPrazo ?? body.carrierDeadline ?? '').trim();
      metadata.carrierDeadline = metadata.transportadoraPrazo;
    }
    if (body.freteObs !== undefined || body.shippingNotes !== undefined) {
      metadata.freteObs = String(body.freteObs ?? body.shippingNotes ?? '').trim();
      metadata.shippingNotes = metadata.freteObs;
    }

    metadata.updatedFromSellerConfigAt = now();
    sellerUpdates.metadata = metadata;
    const seller = await Seller.findOneAndUpdate({ sellerId: req.sellerId }, { $set: sellerUpdates }, { new: true });
    const user = Object.keys(userUpdates).length ? await User.findByIdAndUpdate(req.user._id, { $set: userUpdates }, { new: true }) : req.user;
    return res.json({ ok: true, lockedLegalData: sellerApproved, seller: sellerProfile(seller, user), user: sellerUserForResponse(user) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'Erro ao salvar dados cadastrais do seller' });
  }
}

app.patch('/api/seller/profile', sellerAuthRequired, saveSellerProfileSettings);
app.put('/api/seller/profile', sellerAuthRequired, saveSellerProfileSettings);
app.put('/api/seller/update', sellerAuthRequired, saveSellerProfileSettings);
app.patch('/api/seller/update', sellerAuthRequired, saveSellerProfileSettings);

app.get('/api/seller/dashboard', sellerAuthRequired, async (req, res) => {
  try {
    const sid = String(req.sellerId || '').trim();
    const totalProdutos = await Product.countDocuments({ sellerId: sid });
    const produtosAtivos = await Product.countDocuments({ sellerId: sid, active: true });
    const produtosEmRevisao = await Product.countDocuments({ sellerId: sid, active: false, 'specs.sellerApproval.status': 'pending' });
    const produtosReprovados = await Product.countDocuments({ sellerId: sid, active: false, 'specs.sellerApproval.status': 'rejected' });
    const orderQuery = sellerOrderQuery(sid);
    const orders = await Order.find(orderQuery).sort({ createdAt: -1 }).limit(20);
    const allSellerOrders = await Order.find(orderQuery).select('status statusLabel total items sellerIds createdAt');
    const pendingStatuses = new Set(['pendente', 'pending', 'processing', 'preparando', 'novo', 'new']);
    const approvedStatuses = ['pago', 'approved', 'aprovado', 'paid', 'pagamento_confirmado', 'pagamento confirmado', 'enviado', 'shipped', 'entregue', 'delivered'];
    const productBaseMap = typeof buildProductBasePriceMapForOrders === 'function' ? await buildProductBasePriceMapForOrders(allSellerOrders) : new Map();
    let pedidosPendentes = 0;
    let vendasTotal = 0;
    for (const orderDoc of allSellerOrders) {
      const order = toJSON(orderDoc);
      const statusText = String(order.statusLabel || order.status || '').toLowerCase();
      if (pendingStatuses.has(String(order.status || '').toLowerCase())) pedidosPendentes += 1;
      if (approvedStatuses.some((s) => statusText.includes(s))) {
        const settlement = typeof getSellerSettlementForOrder === 'function' ? getSellerSettlementForOrder(order, sid, productBaseMap) : null;
        if (settlement) vendasTotal += Number(settlement.gross || 0);
        else {
          const sellerItems = ensureArray(order.items).filter((item) => String(item?.sellerId || item?.seller_id || '') === sid);
          vendasTotal += sellerItems.reduce((sum, item) => sum + Number(item.totalPrice || (Number(item.unitPrice || 0) * Number(item.qty || 1)) || 0), 0);
        }
      }
    }
    return res.json({ ok: true, seller: sellerProfile(req.seller, req.user), totalProdutos, produtosAtivos, produtosEmRevisao, produtosReprovados, pedidosPendentes, totalPedidos: allSellerOrders.length, vendasTotal, recentOrders: orders.map((order) => sellerOrderForResponse(order, sid)) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'Erro ao carregar dashboard do seller' });
  }
});

app.get('/api/seller/notifications', sellerAuthRequired, async (req, res) => {
  try {
    const sid = String(req.sellerId || '').trim();
    const rows = await Notification.find({ audience: 'seller', sellerId: sid }).sort({ createdAt: -1 }).limit(Math.min(Number(req.query.limit || 80), 200));
    return res.json(rows.map(toJSON));
  } catch (e) { return res.status(500).json({ ok: false, error: e.message || 'Erro ao listar notificações do seller' }); }
});
app.patch('/api/seller/notifications/:id', sellerAuthRequired, async (req, res) => {
  try {
    const oid = normalizeObjectId(req.params.id);
    if (!oid) return res.status(400).json({ ok: false, error: 'ID inválido' });
    const sid = String(req.sellerId || '').trim();
    const doc = await Notification.findOneAndUpdate({ _id: oid, audience: 'seller', sellerId: sid }, { $set: { status: req.body?.status || 'read' } }, { new: true });
    if (!doc) return res.status(404).json({ ok: false, error: 'Notificação não encontrada' });
    return res.json({ ok: true, notification: toJSON(doc) });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message || 'Erro ao atualizar notificação do seller' }); }
});
app.post('/api/seller/notifications/mark-read', sellerAuthRequired, async (req, res) => {
  try {
    const sid = String(req.sellerId || '').trim();
    await Notification.updateMany({ audience: 'seller', sellerId: sid, status: { $ne: 'read' } }, { $set: { status: 'read' } });
    return res.json({ ok: true });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message || 'Erro ao marcar notificações como lidas' }); }
});

app.get('/api/seller/extrato', sellerAuthRequired, async (req, res) => {
  try {
    const sid = String(req.sellerId || '').trim();
    const approvedStatuses = ['pago', 'paid', 'approved', 'aprovado', 'pagamento_confirmado', 'pagamento confirmado', 'enviado', 'shipped', 'entregue', 'delivered'];
    const docs = await Order.find(sellerOrderQuery(sid)).sort({ createdAt: -1 }).limit(500);
    const productBaseMap = typeof buildProductBasePriceMapForOrders === 'function' ? await buildProductBasePriceMapForOrders(docs) : new Map();
    const rows = docs.map((doc) => {
      const order = toJSON(doc);
      const statusText = String(order.statusLabel || order.status || '').toLowerCase();
      const isApproved = approvedStatuses.some((s) => statusText.includes(s));
      if (!isApproved) return null;
      const st = typeof getSellerSettlementForOrder === 'function'
        ? getSellerSettlementForOrder(order, sid, productBaseMap)
        : { gross: Number(order.total || 0), chargedGross: Number(order.total || 0), fee: 0, commission: 0, label: '', net: Number(order.total || 0), commissionPercent: 0 };
      const settlement = order.sellerSettlements && typeof order.sellerSettlements === 'object' ? (order.sellerSettlements[sid] || {}) : {};
      const settlementStatus = String(settlement.status || 'pending').toLowerCase();
      return {
        id: String(order._id || order.id || ''), orderId: String(order._id || order.id || ''), createdAt: order.createdAt,
        status: order.status, statusLabel: order.statusLabel, gross: st.gross, chargedGross: st.chargedGross, fee: st.fee,
        commission: st.commission, label: st.label, net: st.net, commissionPercent: st.commissionPercent, settlementStatus,
        payoutStatus: settlementStatus, paidAt: settlement.paidAt || null,
        paidAmount: settlementStatus === 'paid' ? Number(settlement.amount || st.net || 0) : 0,
        payoutReference: settlement.reference || ''
      };
    }).filter(Boolean);
    return res.json(rows);
  } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar extrato' }); }
});

app.get('/api/seller/sales', sellerAuthRequired, async (req, res) => {
  try {
    const sid = String(req.sellerId || '').trim();
    const docs = await Order.find(sellerOrderQuery(sid)).sort({ createdAt: -1 }).limit(500);
    const productBaseMap = typeof buildProductBasePriceMapForOrders === 'function' ? await buildProductBasePriceMapForOrders(docs) : new Map();
    const rows = docs.map((doc) => {
      const order = toJSON(doc);
      const statusText = String(order.statusLabel || order.status || '').toLowerCase();
      const isApproved = ['pago', 'paid', 'approved', 'aprovado', 'pagamento_confirmado', 'pagamento confirmado', 'enviado', 'shipped', 'entregue', 'delivered'].some((s) => statusText.includes(s));
      if (!isApproved) return null;
      const st = typeof getSellerSettlementForOrder === 'function' ? getSellerSettlementForOrder(order, sid, productBaseMap) : { gross: Number(order.total || 0), fee: 0, label: '', net: Number(order.total || 0) };
      return { id: String(order._id || order.id || ''), createdAt: order.createdAt, status: order.status, statusLabel: order.statusLabel, total: st.gross, gross: st.gross, fee: st.fee, label: st.label, net: st.net };
    }).filter(Boolean);
    return res.json({ ok: true, items: rows, sales: rows });
  } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar vendas' }); }
});

app.get('/api/seller/orders', sellerAuthRequired, async (req, res) => {
  try {
    const sid = req.sellerId;
    const rows = await Order.find(sellerOrderQuery(sid)).sort({ createdAt: -1 }).limit(500);
    return res.json(rows.map((order) => sellerOrderForResponse(order, sid)));
  } catch (e) { return res.status(500).json({ ok: false, error: e.message || 'Erro ao listar pedidos' }); }
});
app.get('/api/seller/orders/:id', sellerAuthRequired, async (req, res) => {
  try {
    const oid = normalizeObjectId(req.params.id);
    if (!oid) return res.status(400).json({ ok: false, error: 'ID inválido' });
    const order = await Order.findById(oid);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado' });
    const sid = String(req.sellerId || '').trim();
    const allowed = sellerIdsForSellerRoute(order).includes(sid);
    if (!allowed) return res.status(403).json({ ok: false, error: 'Sem permissão para este pedido' });
    return res.json({ ok: true, order: sellerOrderForResponse(order, sid) });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message || 'Erro ao carregar pedido' }); }
});

app.get('/api/seller/products', sellerAuthRequired, async (req, res) => {
  try {
    const query = sellerProductQuery(req);
    if (!query.$or?.length) return res.status(403).json({ ok: false, error: 'Seller não identificado' });
    if (req.query.active !== undefined) query.active = String(req.query.active) !== 'false';
    const rows = await Product.find(query).sort({ createdAt: -1, updatedAt: -1 });
    const products = rows.map(normalizeSellerProductForResponse);
    return res.json({ ok: true, items: products, products });
  } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar produtos do seller' }); }
});

app.get('/api/seller/products/:id', sellerAuthRequired, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const oid = normalizeObjectId(id);
    const ownerQuery = sellerProductQuery(req);
    const idQuery = oid ? { _id: oid } : { $or: [{ sku: id }, { slug: id }, { id }] };
    let row = null;
    if (oid) row = await Product.findOne({ $and: [idQuery, ownerQuery] });
    if (!row) row = await Product.findOne({ $and: [idQuery, ownerQuery] });
    if (!row) return res.status(404).json({ ok: false, error: 'Produto não encontrado para este seller' });
    const product = normalizeSellerProductForResponse(row);
    return res.json({ ok: true, product, item: product, ...product });
  } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar produto do seller' }); }
});

app.delete('/api/seller/products/:id', sellerAuthRequired, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const oid = normalizeObjectId(id);
    const ownerQuery = sellerProductQuery(req);
    const idQuery = oid ? { _id: oid } : { $or: [{ sku: id }, { slug: id }, { id }] };
    const existing = await Product.findOne({ $and: [idQuery, ownerQuery] });
    if (!existing) return res.status(404).json({ ok: false, error: 'Produto não encontrado para este seller' });
    const archived = await Product.findOneAndUpdate(
      { $and: [idQuery, ownerQuery] },
      { $set: { active: false, 'specs.sellerApproval.status': 'archived', 'specs.sellerApproval.archivedAt': now(), 'specs.sellerApproval.archivedBy': 'seller' } },
      { new: true }
    );
    await writeAuditLog({ scope: 'seller_products', eventType: 'seller_product_archived', status: 'success', metadata: { sellerId: req.sellerId, productId: String(archived?._id || existing._id || '') } }).catch(() => null);
    return res.json({ ok: true, deleted: true, archived: true, id: String(archived?._id || existing._id || '') });
  } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Erro ao excluir produto' }); }
});

app.put('/api/seller/products/:id', sellerAuthRequired, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const oid = normalizeObjectId(id);
    if (!oid) return res.status(400).json({ ok: false, error: 'ID inválido' });
    const ownerQuery = sellerProductQuery(req);
    const existing = await Product.findOne({ $and: [{ _id: oid }, ownerQuery] });
    if (!existing) return res.status(404).json({ ok: false, error: 'Produto não encontrado para este seller' });
    const payload = buildSellerProductPayload(req, existing);
    if (!payload.name || !Number.isFinite(payload.price) || payload.price <= 0) return res.status(400).json({ ok: false, error: 'Nome e preço válido são obrigatórios' });
    if (!Number.isFinite(payload.stock) || payload.stock < 0) return res.status(400).json({ ok: false, error: 'Estoque inválido' });
    payload.active = false;
    payload.specs = { ...(payload.specs && typeof payload.specs === 'object' ? payload.specs : {}), sellerApproval: { status: 'pending', submittedAt: now(), sellerId: req.sellerId } };
    const updated = await Product.findOneAndUpdate({ $and: [{ _id: oid }, ownerQuery] }, { $set: payload }, { new: true });
    const product = normalizeSellerProductForResponse(updated);
    return res.json({ ok: true, product, item: product });
  } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Erro ao salvar produto' }); }
});

function publicSellerProfile(seller) {
  const o = toJSON(seller) || {};
  const meta = o.metadata && typeof o.metadata === 'object' ? o.metadata : {};
  const status = String(o.status || meta.status || '').trim().toLowerCase();
  return {
    sellerId: String(o.sellerId || ''),
    storeName: String(o.storeName || o.displayName || meta.storeName || meta.factoryName || '').trim(),
    displayName: String(o.displayName || o.storeName || meta.factoryName || '').trim(),
    description: String(meta.bio || meta.description || o.description || '').trim(),
    city: String(o.city || meta.city || meta.cidade || '').trim(),
    uf: String(o.uf || meta.uf || '').trim().toUpperCase().slice(0, 2),
    active: isApprovedSellerStatus(status)
  };
}

app.get('/api/seller/:sellerId', async (req, res) => {
  const seller = await Seller.findOne({ sellerId: req.params.sellerId });
  if (!seller) return res.status(404).json({ ok: false, error: 'Seller não encontrado' });
  return res.json({ ok: true, seller: publicSellerProfile(seller) });
});

app.get('/api/sellers/:sellerId', async (req, res) => {
  const seller = await Seller.findOne({ sellerId: req.params.sellerId });
  if (!seller) return res.status(404).json({ ok: false, error: 'Seller não encontrado' });
  return res.json({ ok: true, seller: publicSellerProfile(seller) });
});

}
