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
    uploadToCloudinary
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

function buildSellerProductPayload(req, existingDoc = null) {
  const body = req.body || {};
  const existing = existingDoc ? normalizeProductForResponse(existingDoc) : {};
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
    specs: body.specs ?? body.especificacoes ?? body.technicalSpecs ?? basePayload.specs ?? existing.specs ?? {},
    updatedAt: now()
  };

  // Proteção final: nunca permitir Base64/Buffer/arquivo bruto no Mongo.
  ['image', 'imageUrl', 'imagem', 'mainImageUrl', 'mainImagePath'].forEach((key) => {
    if (payload[key] && !isRemoteImageUrl(payload[key])) payload[key] = null;
  });
  payload.images = Array.isArray(payload.images) ? payload.images.filter((img) => isRemoteImageUrl(img?.url)) : [];
  payload.imageUrls = payload.images.map((img) => img.url).filter(Boolean);
  payload.imagePaths = payload.images.map((img) => img.path || img.url).filter(Boolean);

  return payload;
}

function sellerProductOwnerValues(req) {
  return Array.from(new Set([
    req.sellerId,
    req.user?.sellerId,
    req.seller?.sellerId,
    req.seller?._id ? String(req.seller._id) : '',
    req.user?._id ? String(req.user._id) : '',
    req.seller?.email,
    req.user?.email,
    req.seller?.storeName,
    req.seller?.displayName
  ].map((value) => String(value || '').trim()).filter(Boolean)));
}

function sellerProductQuery(req, extra = {}) {
  const values = sellerProductOwnerValues(req);
  const sellerOr = [];
  for (const value of values) {
    sellerOr.push({ sellerId: value });
    sellerOr.push({ seller_id: value });
    sellerOr.push({ seller: value });
    sellerOr.push({ sellerName: value });
    sellerOr.push({ sellerEmail: value });
    sellerOr.push({ manufacturer: value });
  }
  return { ...(sellerOr.length ? { $or: sellerOr } : {}), ...(extra || {}) };
}

app.post('/api/seller/products', sellerAuthRequired, async (req, res) => {
  try {
    const payload = buildSellerProductPayload(req);

    if (!payload.sellerId) {
      return res.status(400).json({ ok: false, error: 'Seller não identificado' });
    }

    if (!payload.name || !payload.price) {
      return res.status(400).json({ ok: false, error: 'Nome e preço são obrigatórios' });
    }

    const created = await Product.create(payload);
    const product = normalizeProductForResponse(created);

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

// Upload de imagens do Seller para Cloudinary. O Mongo recebe somente os links.
if (typeof uploadToCloudinary === 'function' && upload?.single) {
  app.post('/api/seller/uploads', sellerAuthRequired, upload.single('file'), uploadToCloudinary);
  app.post('/api/seller/products/upload', sellerAuthRequired, upload.single('file'), uploadToCloudinary);
}

app.get('/api/seller/returns', sellerAuthRequired, async (req, res) => {
  try {
    const sid = String(req.sellerId || '').trim();

    const orders = await Order.find({
      sellerIds: sid,
      $or: [
        { status: /devol/i },
        { status: /troca/i },
        { statusLabel: /devol/i },
        { statusLabel: /troca/i },
        { returnReason: { $exists: true, $ne: '' } },
        { reason: { $exists: true, $ne: '' } }
      ]
    }).sort({ updatedAt: -1, createdAt: -1 }).limit(100);

    return res.json(orders.map(toJSON));
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || 'Erro ao buscar devoluções'
    });
  }
});

// ===== ROTAS SELLER CORRIGIDAS - ESPECÍFICAS ANTES DO CURINGA /api/seller/:sellerId =====
async function sellerAuthRequired(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!token) return res.status(401).json({ ok: false, error: 'Token ausente' });

    const dec = jwt.verify(token, JWT_SECRET);
    const user = dec.id ? await User.findById(dec.id) : null;
    if (!user) return res.status(401).json({ ok: false, error: 'Usuário inválido' });

    const userEmail = String(user.email || '').trim().toLowerCase();
    const sid = String(user.sellerId || dec.sellerId || '').trim();

    let seller = sid ? await Seller.findOne({ sellerId: sid }) : null;
    if (!seller && user._id) seller = await Seller.findOne({ userId: user._id });
    if (!seller && userEmail) {
      seller = await Seller.findOne({
        $or: [
          { email: userEmail },
          { 'metadata.email': userEmail }
        ]
      });
    }

    if (!seller) return res.status(403).json({ ok: false, error: 'Seller não encontrado' });

    if (!user.sellerId && seller.sellerId) {
      user.sellerId = seller.sellerId;
      if (String(user.role || '').toLowerCase() !== 'seller') user.role = 'seller';
      await user.save().catch(() => null);
    }

    if (!seller.userId && user._id) {
      seller.userId = user._id;
      await seller.save().catch(() => null);
    }

    req.user = user;
    req.seller = seller;
    req.sellerId = String(seller.sellerId || user.sellerId || '');
    return next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: 'Token inválido' });
  }
}

function cleanDigitsOnly(value = '') {
  return String(value || '').replace(/\D/g, '');
}
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

function sellerProfile(s, u) {
  const o = toJSON(s) || {};
  const meta = o.metadata && typeof o.metadata === 'object' ? o.metadata : {};
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
    bankAccount,
    cepColeta: String(meta.cepColeta || meta.pickupCep || meta.cep_coleta || '').replace(/\D/g, ''),
    tipoLogistica: String(meta.tipoLogistica || meta.shippingType || (meta.transpPropria === true ? 'propria' : 'marketplace')).trim(),
    transpPropria: meta.transpPropria === true || meta.ownCarrier === true || meta.transportadoraPropria === true,
    transportadoraNome: String(meta.transportadoraNome || meta.carrierName || '').trim(),
    transportadoraTelefone: String(meta.transportadoraTelefone || meta.carrierPhone || '').trim(),
    transportadoraPrazo: String(meta.transportadoraPrazo || meta.carrierDeadline || '').trim(),
    freteObs: String(meta.freteObs || meta.shippingNotes || '').trim(),
    active: !['bloqueado', 'reprovado', 'blocked', 'rejected'].includes(status)
  };
}

app.post('/api/seller/auth/login', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'E-mail e senha são obrigatórios' });
    }

    let user = await User.findOne({ email });
    let seller = null;

    if (user?.sellerId) seller = await Seller.findOne({ sellerId: user.sellerId });
    if (!seller && user?._id) seller = await Seller.findOne({ userId: user._id });
    if (!seller) {
      seller = await Seller.findOne({
        $or: [
          { email },
          { 'metadata.email': email }
        ]
      });
    }

    if (!seller) {
      return res.status(401).json({ ok: false, error: 'Seller não encontrado' });
    }

    if (!user) {
      user = await User.create({
        name: seller.displayName || seller.storeName || email,
        email,
        passwordHash: await bcrypt.hash(password, 10),
        phone: seller.phone || '',
        cpf: seller.document || '',
        role: 'seller',
        sellerId: seller.sellerId,
        isActive: true
      });
      seller.userId = user._id;
      await seller.save();
    }

    let valid = false;

    if (user.passwordHash) {
      try {
        valid = await bcrypt.compare(password, String(user.passwordHash || ''));
      } catch (_) {
        valid = false;
      }

      if (!valid && String(user.passwordHash || '') === password) {
        valid = true;
        user.passwordHash = await bcrypt.hash(password, 10);
        await user.save();
      }
    }

    const temp = String(
      seller?.metadata?.requestedTempPass ||
      seller?.metadata?.password ||
      seller?.metadata?.senha ||
      ''
    );

    if (!valid && temp && temp === password) valid = true;

    if (!valid) {
      return res.status(401).json({ ok: false, error: 'Credenciais inválidas' });
    }

    if (String(user.role || '').toLowerCase() !== 'seller' || !user.sellerId) {
      user.role = 'seller';
      user.sellerId = seller.sellerId || user.sellerId || uid('seller');
      await user.save();
    }

    if (!seller.sellerId) seller.sellerId = user.sellerId || uid('seller');
    if (!seller.userId) seller.userId = user._id;
    await seller.save();

    return res.json({
      ok: true,
      token: signToken(user),
      seller: sellerProfile(seller, user),
      user: toJSON(user)
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'Erro no login seller' });
  }
});

app.get('/api/seller/auth/me', sellerAuthRequired, (req, res) => res.json({ ok: true, seller: sellerProfile(req.seller, req.user), user: toJSON(req.user) }));

app.get('/api/seller/profile', sellerAuthRequired, async (req, res) => {
  try {
    return res.json({ ok: true, seller: sellerProfile(req.seller, req.user), user: toJSON(req.user) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'Erro ao carregar dados cadastrais do seller' });
  }
});

async function saveSellerProfileSettings(req, res) {
  try {
    const body = req.body || {};
    const sellerUpdates = {};
    const userUpdates = {};

    const sellerStatus = String(req.seller?.status || '').trim().toLowerCase();
    const sellerApproved = ['approved', 'aprovado', 'ativo', 'active'].includes(sellerStatus);

    const metadata = { ...(req.seller?.metadata || {}) };

    const incomingFactoryName = body.factoryName ?? body.storeName ?? body.displayName;
    if (!sellerApproved && incomingFactoryName !== undefined) {
      const name = String(incomingFactoryName || '').trim();
      sellerUpdates.storeName = name;
      sellerUpdates.displayName = name || req.seller?.displayName || req.seller?.storeName || '';
      metadata.factoryName = name;
      metadata.storeName = name;
    }

    if (!sellerApproved) {
      const incomingDocument = body.cnpj ?? body.document ?? body.cpf;
      if (incomingDocument !== undefined) {
        const doc = String(incomingDocument || '').replace(/\D/g, '');
        sellerUpdates.document = doc;
        userUpdates.cpf = doc;
        metadata.cnpj = doc;
        metadata.document = doc;
      }
      if (body.email !== undefined) {
        const email = String(body.email || '').trim().toLowerCase();
        sellerUpdates.email = email;
        userUpdates.email = email;
        metadata.email = email;
      }
    }

    if (body.phone !== undefined) {
      sellerUpdates.phone = String(body.phone || '').trim();
      userUpdates.phone = sellerUpdates.phone;
      metadata.phone = sellerUpdates.phone;
    }
    if (body.city !== undefined) userUpdates.city = String(body.city || '').trim();
    if (body.uf !== undefined) userUpdates.uf = String(body.uf || '').trim().toUpperCase().slice(0, 2);

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

    return res.json({ ok: true, lockedLegalData: sellerApproved, seller: sellerProfile(seller, user), user: toJSON(user) });
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
    const produtosAtivos = await Product.countDocuments({ sellerId: sid, active: { $ne: false } });
    const orderQuery = { $or: [{ sellerIds: sid }, { 'items.sellerId': sid }] };
    const orders = await Order.find(orderQuery).sort({ createdAt: -1 }).limit(20);
    const allSellerOrders = await Order.find(orderQuery).select('status total items sellerIds createdAt');
    const pendingStatuses = new Set(['pendente', 'pending', 'processing', 'preparando', 'novo', 'new']);
    const approvedStatuses = new Set(['pago', 'approved', 'aprovado', 'paid', 'entregue', 'delivered', 'shipped']);
    let pedidosPendentes = 0;
    let vendasTotal = 0;
    for (const order of allSellerOrders) {
      const status = String(order.status || '').toLowerCase();
      if (pendingStatuses.has(status)) pedidosPendentes += 1;
      if (approvedStatuses.has(status)) {
        const sellerItems = ensureArray(order.items).filter((item) => String(item?.sellerId || '') === sid);
        const sellerTotal = sellerItems.reduce((sum, item) => sum + Number(item.totalPrice || (Number(item.unitPrice || 0) * Number(item.qty || 1)) || 0), 0);
        vendasTotal += sellerTotal || Number(order.total || 0);
      }
    }
    return res.json({ ok: true, seller: sellerProfile(req.seller, req.user), totalProdutos, produtosAtivos, pedidosPendentes, totalPedidos: allSellerOrders.length, vendasTotal, recentOrders: orders.map(toJSON) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'Erro ao carregar dashboard do seller' });
  }
});

app.get('/api/seller/notifications', sellerAuthRequired, async (req, res) => {
  try {
    const sid = String(req.sellerId || '').trim();
    const rows = await Notification.find({ audience: 'seller', sellerId: sid }).sort({ createdAt: -1 }).limit(Math.min(Number(req.query.limit || 80), 200));
    return res.json(rows.map(toJSON));
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'Erro ao listar notificações do seller' });
  }
});
app.patch('/api/seller/notifications/:id', sellerAuthRequired, async (req, res) => {
  try {
    const oid = normalizeObjectId(req.params.id);
    if (!oid) return res.status(400).json({ ok: false, error: 'ID inválido' });
    const sid = String(req.sellerId || '').trim();
    const doc = await Notification.findOneAndUpdate({ _id: oid, audience: 'seller', sellerId: sid }, { $set: { status: req.body?.status || 'read' } }, { new: true });
    if (!doc) return res.status(404).json({ ok: false, error: 'Notificação não encontrada' });
    return res.json({ ok: true, notification: toJSON(doc) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'Erro ao atualizar notificação do seller' });
  }
});
app.post('/api/seller/notifications/mark-read', sellerAuthRequired, async (req, res) => {
  try {
    const sid = String(req.sellerId || '').trim();
    await Notification.updateMany({ audience: 'seller', sellerId: sid, status: { $ne: 'read' } }, { $set: { status: 'read' } });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'Erro ao marcar notificações como lidas' });
  }
});

app.get('/api/seller/extrato', sellerAuthRequired, async (req, res) => {
  try {
    const sid = String(req.sellerId || '').trim();
    const approvedStatuses = ['pago', 'paid', 'approved', 'aprovado', 'pagamento_confirmado', 'pagamento confirmado', 'enviado', 'shipped', 'entregue', 'delivered'];
    const docs = await Order.find({ $or: [{ sellerIds: sid }, { 'items.sellerId': sid }] }).sort({ createdAt: -1 }).limit(500);
    const productBaseMap = typeof buildProductBasePriceMapForOrders === 'function' ? await buildProductBasePriceMapForOrders(docs) : new Map();
    const rows = docs.map((doc) => {
      const order = toJSON(doc);
      const statusText = String(order.statusLabel || order.status || '').toLowerCase();
      const isApproved = approvedStatuses.some((s) => statusText.includes(s));
      if (!isApproved) return null;
      const st = typeof getSellerSettlementForOrder === 'function'
        ? getSellerSettlementForOrder(order, sid, productBaseMap)
        : { gross: Number(order.total || 0), chargedGross: Number(order.total || 0), fee: 0, commission: 0, label: '', net: Number(order.total || 0), commissionPercent: 0 };
      return { id: String(order._id || order.id || ''), orderId: String(order._id || order.id || ''), createdAt: order.createdAt, status: order.status, statusLabel: order.statusLabel, gross: st.gross, chargedGross: st.chargedGross, fee: st.fee, commission: st.commission, label: st.label, net: st.net, commissionPercent: st.commissionPercent };
    }).filter(Boolean);
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar extrato' });
  }
});

app.get('/api/seller/sales', sellerAuthRequired, async (req, res) => {
  try {
    const sid = String(req.sellerId || '').trim();
    const docs = await Order.find({ $or: [{ sellerIds: sid }, { 'items.sellerId': sid }] }).sort({ createdAt: -1 }).limit(500);
    const productBaseMap = typeof buildProductBasePriceMapForOrders === 'function' ? await buildProductBasePriceMapForOrders(docs) : new Map();
    const rows = docs.map((doc) => {
      const order = toJSON(doc);
      const statusText = String(order.statusLabel || order.status || '').toLowerCase();
      const isApproved = ['pago', 'paid', 'approved', 'aprovado', 'pagamento_confirmado', 'pagamento confirmado', 'enviado', 'shipped', 'entregue', 'delivered'].some((s) => statusText.includes(s));
      if (!isApproved) return null;
      const st = typeof getSellerSettlementForOrder === 'function'
        ? getSellerSettlementForOrder(order, sid, productBaseMap)
        : { gross: Number(order.total || 0), fee: 0, label: '', net: Number(order.total || 0) };
      return { id: String(order._id || order.id || ''), createdAt: order.createdAt, status: order.status, statusLabel: order.statusLabel, total: st.gross, gross: st.gross, fee: st.fee, label: st.label, net: st.net };
    }).filter(Boolean);
    return res.json({ ok: true, items: rows, sales: rows });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar vendas' });
  }
});

app.get('/api/seller/orders', sellerAuthRequired, async (req, res) => {
  try {
    const sid = req.sellerId;
    const rows = await Order.find({ $or: [{ sellerIds: sid }, { 'items.sellerId': sid }] }).sort({ createdAt: -1 }).limit(500);
    return res.json(rows.map(toJSON));
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'Erro ao listar pedidos' });
  }
});
app.get('/api/seller/orders/:id', sellerAuthRequired, async (req, res) => {
  try {
    const oid = normalizeObjectId(req.params.id);
    if (!oid) return res.status(400).json({ ok: false, error: 'ID inválido' });
    const order = await Order.findById(oid);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado' });
    return res.json({ ok: true, order: toJSON(order) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'Erro ao carregar pedido' });
  }
});
app.put('/api/seller/orders/:id/status', sellerAuthRequired, async (req, res) => {
  try {
    const oid = normalizeObjectId(req.params.id);
    if (!oid) return res.status(400).json({ ok: false, error: 'ID inválido' });
    const before = await Order.findById(oid);
    if (!before) return res.status(404).json({ ok: false, error: 'Pedido não encontrado' });
    const sid = String(req.sellerId || '').trim();
    const allowed = extractSellerIdsFromOrder(before).includes(sid);
    if (!allowed) return res.status(403).json({ ok: false, error: 'Sem permissão para este pedido' });
    const order = await Order.findByIdAndUpdate(oid, { $set: { status: req.body?.status || 'processing', statusLabel: req.body?.statusLabel || req.body?.status || 'processing' } }, { new: true });
    await createSellerOrderNotifications(order, { type: 'seller_order_updated', title: '📦 Pedido atualizado', message: `Pedido #${String(order._id).slice(-8).toUpperCase()} atualizado para ${order.statusLabel || order.status || 'Atualizado'}`, severity: 'info', origin: 'seller_status_route' });
    await createAdminNotification({ type: 'seller_order_updated', title: 'Seller atualizou pedido', message: `Seller ${req.seller?.storeName || req.seller?.displayName || sid} atualizou o pedido ${order._id} para ${order.statusLabel || order.status || 'Atualizado'}`, relatedId: String(order._id), severity: 'info', metadata: { sellerId: sid, origin: 'seller_status_route' } });
    const customerWhatsapp = await waMaybeNotifyOrderStatusChange(String(order._id), toJSON(before), toJSON(order), 'seller_status_route');
    const adminWhatsapp = await waNotifyAdminOrderStatusChange(String(order._id), toJSON(before), toJSON(order), 'seller_status_route_admin');
    return res.json({ ok: true, order: toJSON(order), whatsapp: customerWhatsapp, adminWhatsapp });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'Erro ao atualizar status' });
  }
});
app.post('/api/seller/orders/:id/ship', sellerAuthRequired, async (req, res) => {
  try {
    const oid = normalizeObjectId(req.params.id);
    if (!oid) return res.status(400).json({ ok: false, error: 'ID inválido' });
    const trackingCode = String(req.body?.trackingCode || req.body?.tracking || '').trim();
    const carrier = String(req.body?.carrier || '').trim();
    const before = await Order.findById(oid);
    if (!before) return res.status(404).json({ ok: false, error: 'Pedido não encontrado' });
    const beforeObj = toJSON(before);
    const sid = String(req.sellerId || '').trim();
    const allowed = extractSellerIdsFromOrder(beforeObj).includes(sid);
    if (!allowed) return res.status(403).json({ ok: false, error: 'Sem permissão para este pedido' });
    const order = before;
    order.status = 'shipped';
    order.statusLabel = 'Enviado';
    order.trackingCode = trackingCode || order.trackingCode;
    order.shipping = { ...(order.shipping || {}), carrier, trackingCode: trackingCode || order.trackingCode, shippedAt: now() };
    order.trackingHistory = ensureArray(order.trackingHistory);
    order.trackingHistory.push({ status: 'shipped', label: 'Pedido enviado pelo seller', carrier, trackingCode, date: now() });
    await order.save();
    const afterObj = toJSON(order);
    await createSellerOrderNotifications(order, { type: 'seller_order_shipped', title: 'Pedido marcado como enviado', message: `Pedido #${String(order._id).slice(-8).toUpperCase()} marcado como enviado${trackingCode ? ` - Rastreio: ${trackingCode}` : ''}`, severity: 'success', origin: 'seller_ship_route' });
    await createAdminNotification({ type: 'seller_order_shipped', title: 'Seller marcou pedido como enviado', message: `Seller ${req.seller?.storeName || req.seller?.displayName || sid} marcou o pedido ${order._id} como enviado${trackingCode ? ` - Rastreio: ${trackingCode}` : ''}`, relatedId: String(order._id), severity: 'success', metadata: { sellerId: sid, origin: 'seller_ship_route' } });
    const customerWhatsapp = await waMaybeNotifyOrderStatusChange(String(order._id), beforeObj, afterObj, 'seller_ship_route');
    const adminWhatsapp = await waNotifyAdminOrderStatusChange(String(order._id), beforeObj, afterObj, 'seller_ship_route_admin');
    return res.json({ ok: true, order: afterObj, whatsapp: customerWhatsapp, adminWhatsapp });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'Erro ao marcar enviado' });
  }
});

// ===== ROTAS DE PRODUTOS DO SELLER - DEVEM VIR ANTES DE /api/seller/:sellerId =====
app.get('/api/seller/products', sellerAuthRequired, async (req, res) => {
  try {
    const query = sellerProductQuery(req);
    if (!query.$or?.length) return res.status(403).json({ ok: false, error: 'Seller não identificado' });
    if (req.query.active !== undefined) query.active = String(req.query.active) !== 'false';

    const rows = await Product.find(query).sort({ createdAt: -1, updatedAt: -1 });
    const products = rows.map(normalizeProductForResponse);
    return res.json({ ok: true, items: products, products });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar produtos do seller' });
  }
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
    const product = normalizeProductForResponse(row);
    return res.json({ ok: true, product, item: product, ...product });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar produto do seller' });
  }
});

app.delete('/api/seller/products/:id', sellerAuthRequired, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const oid = normalizeObjectId(id);
    const ownerQuery = sellerProductQuery(req);
    const idQuery = oid ? { _id: oid } : { $or: [{ sku: id }, { slug: id }, { id }] };
    const deleted = await Product.findOneAndDelete({ $and: [idQuery, ownerQuery] });
    if (!deleted) return res.status(404).json({ ok: false, error: 'Produto não encontrado para este seller' });
    return res.json({ ok: true, deleted: true, id: String(deleted._id || '') });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao excluir produto' });
  }
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
    const updated = await Product.findOneAndUpdate({ $and: [{ _id: oid }, ownerQuery] }, { $set: payload }, { new: true });
    const product = normalizeProductForResponse(updated);
    return res.json({ ok: true, product, item: product });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao salvar produto' });
  }
});

app.get('/api/seller/payment-split', sellerAuthRequired, async (req, res) => {
  try {
    const seller = req.seller || {};
    const meta = seller.metadata || {};
    const settings = await getPaymentsSettings();
    const recipientId = String(meta.pagarmeRecipientId || meta.pagarme_recipient_id || seller.pagarmeRecipientId || '').trim();
    return res.json({
      ok: true,
      gateway: 'pagarme',
      splitRequired: true,
      manualTransferEnabled: false,
      commissionPercent: Number(meta.commissionPercent || settings.pagarme?.marketplaceFeePercent || 12),
      pagarme: {
        enabled: settings.pagarme?.enabled !== false,
        connected: !!recipientId,
        recipientId,
        status: meta.pagarmeRecipientStatus || '',
        bank: {
          document: meta.document || seller.document || '',
          legalName: meta.legalName || seller.storeName || seller.displayName || '',
          bankCode: meta.bankCode || '',
          branchNumber: meta.branchNumber || '',
          branchCheckDigit: meta.branchCheckDigit || '',
          accountNumber: meta.accountNumber || '',
          accountCheckDigit: meta.accountCheckDigit || '',
          accountType: meta.accountType || 'checking',
          bankHolderName: meta.bankHolderName || meta.legalName || seller.storeName || seller.displayName || '',
          bankHolderDocument: meta.bankHolderDocument || meta.document || seller.document || ''
        }
      }
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar recebimento Pagar.me do seller' });
  }
});

app.put('/api/seller/payment-split', sellerAuthRequired, async (req, res) => {
  try {
    const body = req.body || {};
    const meta = { ...(req.seller.metadata || {}) };
    meta.paymentGateway = 'pagarme';
    meta.marketplaceSplitRequired = true;
    meta.manualTransferEnabled = false;
    meta.pagarmeRecipientId = String(body.pagarmeRecipientId || body.pagarme_recipient_id || meta.pagarmeRecipientId || '').trim();
    meta.document = cleanPhone(body.document || body.cpfCnpj || meta.document || req.seller.document || '');
    meta.legalName = String(body.legalName || body.name || meta.legalName || req.seller.storeName || req.seller.displayName || '').trim();
    meta.bankCode = cleanPhone(body.bankCode || body.bank || meta.bankCode || '');
    meta.branchNumber = cleanPhone(body.branchNumber || body.agency || meta.branchNumber || '');
    meta.branchCheckDigit = cleanPhone(body.branchCheckDigit || body.agencyDigit || meta.branchCheckDigit || '');
    meta.accountNumber = cleanPhone(body.accountNumber || body.conta || meta.accountNumber || '');
    meta.accountCheckDigit = cleanPhone(body.accountCheckDigit || body.accountDigit || meta.accountCheckDigit || '');
    meta.accountType = typeof normalizePagarmeAccountType === 'function' ? normalizePagarmeAccountType(body.accountType || meta.accountType || 'checking') : String(body.accountType || meta.accountType || 'checking');
    meta.bankHolderName = String(body.bankHolderName || meta.bankHolderName || meta.legalName || req.seller.storeName || req.seller.displayName || '').trim();
    meta.bankHolderDocument = cleanPhone(body.bankHolderDocument || meta.bankHolderDocument || meta.document || req.seller.document || '');
    if (body.commissionPercent !== undefined && body.commissionPercent !== null && body.commissionPercent !== '') meta.commissionPercent = Number(body.commissionPercent) || 12;
    const seller = await Seller.findByIdAndUpdate(req.seller._id, { $set: { metadata: meta } }, { new: true });
    return res.json({ ok: true, seller: sellerProfile(seller, req.user) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao salvar dados Pagar.me do seller' });
  }
});

app.post('/api/seller/payment-split/pagarme/recipient', sellerAuthRequired, async (req, res) => {
  try {
    const sellerDoc = req.seller;
    const payload = buildPagarmeRecipientPayloadFromSeller(sellerDoc, req.body || {});
    const response = await createPagarmeRecipient(payload);
    const data = response.data || {};
    if (response.status < 200 || response.status >= 300) return res.status(response.status).json({ ok: false, error: data?.message || data?.errors?.[0]?.message || 'Erro ao criar Recipient Pagar.me', details: data });
    const normalized = normalizePagarmeRecipientResponse(data);
    if (!normalized.id) return res.status(500).json({ ok: false, error: 'Pagar.me não retornou Recipient ID.', details: data });
    const meta = { ...(sellerDoc.metadata || {}), ...(req.body || {}) };
    meta.paymentGateway = 'pagarme';
    meta.marketplaceSplitRequired = true;
    meta.manualTransferEnabled = false;
    meta.pagarmeRecipientId = normalized.id;
    meta.pagarmeRecipientStatus = normalized.status;
    meta.pagarmeRecipientCreatedAt = new Date().toISOString();
    const seller = await Seller.findByIdAndUpdate(sellerDoc._id, { $set: { metadata: meta } }, { new: true });
    await writeAuditLog({ scope: 'payments', eventType: 'pagarme_recipient_created_by_seller', status: 'success', request: redact(payload), response: redact(data), metadata: { sellerId: seller.sellerId || String(seller._id) } });
    return res.json({ ok: true, recipientId: normalized.id, recipient: normalized, seller: sellerProfile(seller, req.user) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao criar Recipient Pagar.me', requiredFields: error.requiredFields || undefined });
  }
});

app.get('/api/seller/:sellerId', async (req, res) => {
  const seller = await Seller.findOne({ sellerId: req.params.sellerId });
  if (!seller) return res.status(404).json({ ok: false, error: 'Seller não encontrado' });
  return res.json({ ok: true, seller: toJSON(seller) });
});

app.get('/api/sellers/:sellerId', async (req, res) => {
  const seller = await Seller.findOne({ sellerId: req.params.sellerId });
  if (!seller) return res.status(404).json({ ok: false, error: 'Seller não encontrado' });
  return res.json({ ok: true, seller: toJSON(seller) });
});

}
