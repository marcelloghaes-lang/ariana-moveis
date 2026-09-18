// ============================================================
// ROTAS DE SELLER / SOLICITAÇÕES DE PARCEIROS - ARIANA MÓVEIS
// Extraído de legacyRoutes.js na divisão de rotas - Etapa 2.
// Mantém os mesmos endpoints, regras e respostas.
// ============================================================

export default function registerSellerPartnerRoutes(app, context = {}) {
  const {
    Seller,
    User,
    Product,
    Notification,
    bcrypt,
    uid,
    adminRequired,
    sellerAuthRequired,
    mongoose,
    now,
    escapeRegex,
    toJSON,
    notifyNewPartnerRequest,
    normalizePartnerRequestForResponse,
    normalizePartnerRequestStatus,
    partnerRequestPublicStatus,
    createPagarmeRecipient,
    buildPagarmeRecipientPayloadFromSeller,
    normalizePagarmeRecipientResponse,
    writeAuditLog,
    redact,
    createAdminNotification
  } = context;

const SELLER_METADATA_SENSITIVE_KEYS = new Set([
  'password',
  'senha',
  'requestedtemppass',
  'confirmpassword',
  'passwordconfirmation',
  'passwordhash',
  'resetpasswordtokenhash',
  'resettoken',
  'authtoken',
  'jwt',
  'accesstoken',
  'refreshtoken',
  'apikey',
  'privatekey'
]);

function sanitizeSellerMetadata(value = {}, depth = 0) {
  if (depth > 6) return null;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeSellerMetadata(item, depth + 1));
  }
  if (!value || typeof value !== 'object') return value;

  const out = {};
  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (
      SELLER_METADATA_SENSITIVE_KEYS.has(normalizedKey) ||
      normalizedKey.includes('secret') ||
      normalizedKey.includes('privatekey')
    ) {
      continue;
    }
    out[key] = sanitizeSellerMetadata(item, depth + 1);
  }
  return out;
}

function safePartnerRequestForResponse(doc = {}) {
  const normalized = normalizePartnerRequestForResponse(doc) || {};
  return {
    ...normalized,
    metadata: sanitizeSellerMetadata(normalized.metadata || {})
  };
}

function sellerRequestEmail(body = {}, seller = {}) {
  return String(
    body.email ||
    body.contactEmail ||
    body.companyEmail ||
    seller.email ||
    seller.metadata?.email ||
    ''
  ).trim().toLowerCase();
}

function sellerStatusIsApproved(value = '') {
  return normalizePartnerRequestStatus(value) === 'approved';
}

app.post('/api/seller/partner-request', async (req, res) => {
  let createdSeller = null;
  let createdUser = null;

  try {
    const body = req.body || {};
    const email = sellerRequestEmail(body);
    const password = String(
      body.requestedTempPass ||
      body.password ||
      body.senha ||
      ''
    );

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok: false, error: 'Informe um e-mail válido para o acesso do seller.' });
    }

    if (password.length < 8) {
      return res.status(400).json({ ok: false, error: 'A senha do seller deve ter pelo menos 8 caracteres.' });
    }

    const existingSeller = await Seller.findOne({
      $or: [
        { email },
        { 'metadata.email': email },
        { 'metadata.contactEmail': email }
      ]
    }).lean();

    if (existingSeller) {
      return res.status(409).json({
        ok: false,
        code: 'SELLER_REQUEST_EXISTS',
        error: 'Já existe uma solicitação ou conta de seller vinculada a este e-mail.'
      });
    }

    const existingUser = await User.findOne({ email }).lean();
    if (existingUser) {
      return res.status(409).json({
        ok: false,
        code: 'SELLER_EMAIL_ALREADY_IN_USE',
        error: 'Este e-mail já está vinculado a uma conta. Use outro e-mail ou entre em contato com a Ariana Móveis.'
      });
    }

    const sellerId = uid('seller');
    const cleanMetadata = sanitizeSellerMetadata(body);
    const passwordHash = await bcrypt.hash(password, 10);

    createdSeller = await Seller.create({
      sellerId,
      displayName: body.name || body.displayName || body.ownerName || '',
      storeName: body.storeName || body.factoryName || body.razaoSocial || body.legalName || body.shopName || body.name || '',
      email,
      phone: body.phone || body.whatsapp || '',
      document: body.document || body.cnpj || body.cpf || body.cpfCnpj || body.cpf_cnpj || '',
      status: 'pending',
      onboardingCompleted: false,
      metadata: cleanMetadata
    });

    createdUser = await User.create({
      name: createdSeller.displayName || createdSeller.storeName || email,
      email,
      passwordHash,
      phone: createdSeller.phone || '',
      cpf: createdSeller.document || '',
      role: 'seller',
      sellerId,
      isActive: false,
      authProvider: 'password'
    });

    createdSeller.userId = createdUser._id;
    await createdSeller.save();

    const notification = await notifyNewPartnerRequest(createdSeller)
      .catch((error) => ({ ok: false, error: error.message || String(error) }));

    return res.status(201).json({
      ok: true,
      id: createdSeller.sellerId,
      sellerId: createdSeller.sellerId,
      seller: safePartnerRequestForResponse(createdSeller),
      notification
    });
  } catch (error) {
    if (createdUser?._id) {
      await User.deleteOne({ _id: createdUser._id }).catch(() => null);
    }
    if (createdSeller?._id) {
      await Seller.deleteOne({ _id: createdSeller._id }).catch(() => null);
    }

    if (error?.code === 11000) {
      return res.status(409).json({
        ok: false,
        code: 'SELLER_DUPLICATE',
        error: 'Já existe uma conta ou solicitação com estes dados.'
      });
    }

    return res.status(500).json({ ok: false, error: error.message || 'Erro ao criar solicitação de parceiro' });
  }
});

app.get('/api/seller/partner-requests/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ ok: false, error: 'Solicitação inválida' });
    const filter = mongoose.Types.ObjectId.isValid(id)
      ? { $or: [{ _id: id }, { sellerId: id }] }
      : { sellerId: id };
    const seller = await Seller.findOne(filter).select('_id sellerId status onboardingCompleted createdAt updatedAt').lean();
    if (!seller) return res.status(404).json({ ok: false, error: 'Solicitação não encontrada' });
    const status = normalizePartnerRequestStatus(seller.status || 'pending');
    return res.json({
      ok: true,
      request: {
        id: String(seller.sellerId || seller._id || ''),
        sellerId: String(seller.sellerId || ''),
        status: partnerRequestPublicStatus(status),
        statusCode: status,
        active: status === 'approved',
        onboardingCompleted: seller.onboardingCompleted === true,
        updatedAt: seller.updatedAt || null
      }
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'Erro ao consultar situação da solicitação' });
  }
});

app.get('/api/seller/partner-requests', adminRequired, async (req, res) => {
  try {
    const status = String(req.query.status || '').trim().toLowerCase();
    const q = String(req.query.q || '').trim();
    const limit = Math.min(Number(req.query.limit || 500), 1000);
    const filter = {};
    if (status && status !== 'todos' && status !== 'all') filter.status = normalizePartnerRequestStatus(status);
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      filter.$or = [
        { storeName: rx }, { displayName: rx }, { email: rx }, { phone: rx }, { document: rx },
        { 'metadata.storeName': rx }, { 'metadata.factoryName': rx }, { 'metadata.ownerName': rx }, { 'metadata.cnpj': rx }
      ];
    }
    const rows = await Seller.find(filter).sort({ createdAt: -1 }).limit(limit);
    const requests = rows.map(safePartnerRequestForResponse);
    return res.json({ ok: true, requests, items: requests, total: requests.length });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar solicitações de seller' });
  }
});

app.patch('/api/seller/partner-requests/:id/status', adminRequired, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const status = normalizePartnerRequestStatus(req.body?.status || req.body?.newStatus || 'pending');
    const active = status === 'approved';
    const filter = mongoose.Types.ObjectId.isValid(id) ? { $or: [{ _id: id }, { sellerId: id }] } : { sellerId: id };

    let seller = await Seller.findOneAndUpdate(filter, {
      $set: {
        status,
        onboardingCompleted: active ? true : false,
        'metadata.status': partnerRequestPublicStatus(status),
        'metadata.active': active,
        'metadata.reviewedAt': now(),
        'metadata.reviewedBy': req.admin?.email || req.user?.email || 'admin'
      }
    }, { new: true });

    if (!seller) return res.status(404).json({ ok: false, error: 'Solicitação não encontrada' });

    // Configurações comerciais definidas pelo admin na aprovação.
    // Isso permite tratar sellers grandes (fabricante/distribuidor/loja) com regras próprias
    // de comissão, logística, frete e uso de etiqueta Ariana.
    const marketplaceSet = {};
    const bodyCommission = req.body?.commissionPercent ?? req.body?.marketplaceCommissionPercent;
    if (bodyCommission !== undefined && bodyCommission !== null && String(bodyCommission).trim() !== '') {
      const commissionPercent = Number(String(bodyCommission).replace(',', '.'));
      if (Number.isFinite(commissionPercent) && commissionPercent >= 0 && commissionPercent <= 50) {
        marketplaceSet['metadata.commissionPercent'] = commissionPercent;
        marketplaceSet['metadata.marketplaceCommissionPercent'] = commissionPercent;
        marketplaceSet['metadata.commissionUpdatedAt'] = now();
        marketplaceSet['metadata.commissionUpdatedBy'] = req.admin?.email || req.user?.email || 'admin';
      }
    }

    const logisticsOwner = String(req.body?.logisticsOwner || req.body?.marketplaceLogisticsOwner || '').trim();
    const shippingOwner = String(req.body?.shippingOwner || req.body?.marketplaceShippingOwner || '').trim();
    const labelOwner = String(req.body?.labelOwner || req.body?.marketplaceLabelOwner || '').trim();
    const useArianaLabel = req.body?.useArianaLabel ?? req.body?.usesArianaLabel;
    const transferDeadlineDays = req.body?.transferDeadlineDays;

    if (logisticsOwner) marketplaceSet['metadata.marketplaceLogisticsOwner'] = logisticsOwner;
    if (shippingOwner) marketplaceSet['metadata.marketplaceShippingOwner'] = shippingOwner;
    if (labelOwner) marketplaceSet['metadata.marketplaceLabelOwner'] = labelOwner;
    if (useArianaLabel !== undefined) marketplaceSet['metadata.usesArianaLabel'] = useArianaLabel === true || String(useArianaLabel).toLowerCase() === 'true';
    if (transferDeadlineDays !== undefined && transferDeadlineDays !== null && String(transferDeadlineDays).trim() !== '') {
      const days = Number(String(transferDeadlineDays).replace(',', '.'));
      if (Number.isFinite(days) && days >= 0) marketplaceSet['metadata.transferDeadlineDays'] = days;
    }

    if (Object.keys(marketplaceSet).length) {
      seller = await Seller.findByIdAndUpdate(seller._id, { $set: marketplaceSet }, { new: true });
    }

    // Operação atual da Ariana: sem split automático e sem Pagar.me.
    // A aprovação do seller apenas habilita o marketplace; os pagamentos dos
    // clientes ficam na Ariana e o seller recebe por repasse manual.
    let recipient = null;
    let recipientError = null;
    if (active) {
      const meta = { ...(seller.metadata || {}) };
      meta.paymentGateway = 'manual';
      meta.marketplaceSplitRequired = false;
      meta.manualTransferEnabled = true;
      meta.checkoutGateways = { card: 'cielo', pix: 'mercado_pago', boleto: 'mercado_pago' };
      meta.pagarmeRecipientError = '';
      meta.pagarmeRecipientRequiredFields = [];
      seller = await Seller.findByIdAndUpdate(seller._id, { $set: { metadata: meta } }, { new: true });
      await writeAuditLog({
        scope: 'seller_onboarding',
        eventType: 'seller_approved_manual_settlement',
        status: 'success',
        metadata: { sellerId: seller.sellerId || String(seller._id), admin: req.admin?.email || '' }
      }).catch(() => null);
    }

    const currentMeta = seller.metadata && typeof seller.metadata === 'object'
      ? { ...seller.metadata }
      : {};
    const legacyPassword = String(
      currentMeta.requestedTempPass ||
      currentMeta.password ||
      currentMeta.senha ||
      ''
    );
    const sellerId = String(seller.sellerId || '').trim();
    const email = sellerRequestEmail({}, seller);

    let linkedUser = null;
    if (seller.userId) {
      linkedUser = await User.findById(seller.userId).catch(() => null);
    }
    if (!linkedUser && sellerId) {
      linkedUser = await User.findOne({ sellerId }).catch(() => null);
    }
    if (!linkedUser && email) {
      const emailUser = await User.findOne({ email }).catch(() => null);
      if (
        emailUser &&
        (
          String(emailUser.role || '').toLowerCase() === 'seller' ||
          String(emailUser.sellerId || '').trim() === sellerId
        )
      ) {
        linkedUser = emailUser;
      }
    }

    // Migração segura das solicitações antigas: utiliza a senha legada apenas
    // para gerar o hash e a remove imediatamente do cadastro do seller.
    if (!linkedUser && active && email && legacyPassword.length >= 6) {
      const emailConflict = await User.findOne({ email }).catch(() => null);
      if (!emailConflict) {
        linkedUser = await User.create({
          name: seller.displayName || seller.storeName || email,
          email,
          passwordHash: await bcrypt.hash(legacyPassword, 10),
          phone: seller.phone || '',
          cpf: seller.document || '',
          role: 'seller',
          sellerId,
          isActive: true,
          authProvider: 'password'
        });
      }
    }

    if (linkedUser) {
      const directLink =
        String(linkedUser.sellerId || '').trim() === sellerId ||
        String(seller.userId || '') === String(linkedUser._id || '');

      if (directLink || String(linkedUser.role || '').toLowerCase() === 'seller') {
        linkedUser.role = 'seller';
        linkedUser.sellerId = sellerId;
        linkedUser.isActive = active;
        await linkedUser.save();

        if (String(seller.userId || '') !== String(linkedUser._id || '')) {
          seller.userId = linkedUser._id;
        }
      }
    }

    const cleanMetadata = sanitizeSellerMetadata(seller.metadata || {});
    seller = await Seller.findByIdAndUpdate(
      seller._id,
      {
        $set: {
          metadata: cleanMetadata,
          ...(seller.userId ? { userId: seller.userId } : {})
        }
      },
      { new: true }
    );

    const s = safePartnerRequestForResponse(seller);
    await createAdminNotification({
      type: 'partner_request_status_updated',
      title: status === 'approved' ? '✅ Seller aprovado' : status === 'rejected' ? '❌ Seller recusado' : '⏳ Seller pendente',
      message: status === 'approved'
        ? `${s.storeName || s.factoryName || 'Seller'} foi aprovado para operar com repasse manual.`
        : `${s.storeName || s.factoryName || 'Seller'} foi marcado como ${s.statusLabel}.`,
      relatedId: s.id,
      severity: status === 'approved' ? 'success' : status === 'rejected' ? 'warning' : 'info',
      metadata: { sellerId: s.sellerId, status, settlementMode: active ? 'manual' : '' }
    });

    return res.json({ ok: true, request: s, seller: s, recipient, recipientError });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao atualizar status do seller' });
  }
});

app.post('/api/seller/partner-requests/:id/credentials', adminRequired, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const password = String(req.body?.password || '');
    if (password.length < 8) return res.status(400).json({ ok: false, error: 'A senha temporária deve ter pelo menos 8 caracteres.' });
    const filter = mongoose.Types.ObjectId.isValid(id) ? { $or: [{ _id: id }, { sellerId: id }] } : { sellerId: id };
    const seller = await Seller.findOne(filter);
    if (!seller) return res.status(404).json({ ok: false, error: 'Seller não encontrado' });
    const email = String(req.body?.email || seller.email || seller.metadata?.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ ok: false, error: 'Seller sem e-mail cadastrado.' });
    const sellerId = String(seller.sellerId || '').trim() || uid('seller');
    const passwordHash = await bcrypt.hash(password, 10);

    let user = seller.userId
      ? await User.findById(seller.userId).catch(() => null)
      : null;

    if (!user) {
      user = await User.findOne({ sellerId }).catch(() => null);
    }

    if (!user) {
      const emailUser = await User.findOne({ email }).catch(() => null);
      if (
        emailUser &&
        String(emailUser.role || '').toLowerCase() !== 'seller' &&
        String(emailUser.sellerId || '').trim() !== sellerId
      ) {
        return res.status(409).json({
          ok: false,
          code: 'SELLER_EMAIL_ACCOUNT_CONFLICT',
          error: 'Este e-mail pertence a outra conta e não pode ser convertido automaticamente em seller.'
        });
      }
      user = emailUser;
    }

    const sellerActive = sellerStatusIsApproved(seller.status || seller.metadata?.status || '');

    if (user) {
      user.email = email;
      user.passwordHash = passwordHash;
      user.role = 'seller';
      user.sellerId = sellerId;
      user.isActive = sellerActive;
      await user.save();
    } else {
      user = await User.create({
        name: seller.displayName || seller.storeName || email,
        email,
        passwordHash,
        phone: seller.phone || '',
        cpf: seller.document || '',
        role: 'seller',
        sellerId,
        isActive: sellerActive,
        authProvider: 'password'
      });
    }

    const metadata = sanitizeSellerMetadata(seller.metadata || {});
    await Seller.findByIdAndUpdate(
      seller._id,
      { $set: { sellerId, userId: user._id, metadata } }
    );
    await writeAuditLog({ scope: 'seller_credentials', eventType: 'seller_credentials_provisioned', status: 'success', metadata: { sellerId, admin: req.admin?.email || req.user?.email || 'admin' } }).catch(() => null);
    return res.json({ ok: true, sellerId, email, credentialsProvisioned: true });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao provisionar credenciais do seller' });
  }
});

app.patch('/api/seller/partner-requests/:id/commission', adminRequired, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const raw = req.body?.commissionPercent ?? req.body?.marketplaceCommissionPercent ?? req.body?.percent;
    const commissionPercent = Number(String(raw ?? '').replace(',', '.'));

    if (!id) return res.status(400).json({ ok: false, error: 'Seller inválido' });
    if (!Number.isFinite(commissionPercent) || commissionPercent < 0 || commissionPercent > 50) {
      return res.status(400).json({ ok: false, error: 'Informe uma comissão entre 0% e 50%.' });
    }

    const filter = mongoose.Types.ObjectId.isValid(id)
      ? { $or: [{ _id: id }, { sellerId: id }] }
      : { sellerId: id };

    const updates = {
      'metadata.commissionPercent': commissionPercent,
      'metadata.marketplaceCommissionPercent': commissionPercent,
      'metadata.commissionUpdatedAt': now(),
      'metadata.commissionUpdatedBy': req.admin?.email || req.user?.email || 'admin'
    };

    const logisticsOwner = String(req.body?.logisticsOwner || '').trim().toLowerCase();
    const shippingOwner = String(req.body?.shippingOwner || '').trim().toLowerCase();
    const labelOwner = String(req.body?.labelOwner || '').trim().toLowerCase();
    const useArianaLabel = req.body?.useArianaLabel;
    const transferDeadlineRaw = req.body?.transferDeadlineDays;

    if (logisticsOwner && ['seller', 'ariana', 'mixed'].includes(logisticsOwner)) {
      updates['metadata.marketplaceLogisticsOwner'] = logisticsOwner;
    }
    if (shippingOwner && ['seller', 'ariana'].includes(shippingOwner)) {
      updates['metadata.marketplaceShippingOwner'] = shippingOwner;
    }
    if (labelOwner && ['seller', 'ariana'].includes(labelOwner)) {
      updates['metadata.marketplaceLabelOwner'] = labelOwner;
    }
    if (useArianaLabel !== undefined) {
      updates['metadata.usesArianaLabel'] =
        useArianaLabel === true || String(useArianaLabel).toLowerCase() === 'true';
    }
    if (
      transferDeadlineRaw !== undefined &&
      transferDeadlineRaw !== null &&
      String(transferDeadlineRaw).trim() !== ''
    ) {
      const days = Number(String(transferDeadlineRaw).replace(',', '.'));
      if (!Number.isFinite(days) || days < 0 || days > 90) {
        return res.status(400).json({ ok: false, error: 'O prazo de repasse deve ficar entre 0 e 90 dias.' });
      }
      updates['metadata.transferDeadlineDays'] = days;
    }

    const seller = await Seller.findOneAndUpdate(
      filter,
      { $set: updates },
      { new: true }
    );

    if (!seller) return res.status(404).json({ ok: false, error: 'Seller não encontrado' });

    const s = safePartnerRequestForResponse(seller);
    await createAdminNotification({
      type: 'seller_marketplace_config_updated',
      title: 'Configuração do seller atualizada',
      message: `${s.storeName || s.factoryName || s.displayName || 'Seller'} está com comissão de ${commissionPercent}% e regras de operação atualizadas.`,
      relatedId: s.id,
      severity: 'info',
      metadata: {
        sellerId: s.sellerId,
        commissionPercent,
        logisticsOwner: updates['metadata.marketplaceLogisticsOwner'] || '',
        shippingOwner: updates['metadata.marketplaceShippingOwner'] || '',
        labelOwner: updates['metadata.marketplaceLabelOwner'] || ''
      }
    });

    return res.json({
      ok: true,
      seller: s,
      request: s,
      commissionPercent
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao alterar comissão do seller' });
  }
});


function sellerProductReviewStatus(product = {}) {
  const raw = toJSON(product) || product || {};
  const approval = raw.specs?.sellerApproval;
  if (approval && typeof approval === 'object' && approval.status) {
    return String(approval.status).trim().toLowerCase();
  }
  return raw.active === true ? 'approved' : 'pending';
}

function sellerProductReviewResponse(product = {}, sellerMap = new Map()) {
  const raw = toJSON(product) || {};
  const sid = String(raw.sellerId || '').trim();
  const seller = sellerMap.get(sid) || {};
  const approval = raw.specs?.sellerApproval && typeof raw.specs.sellerApproval === 'object'
    ? raw.specs.sellerApproval
    : {};

  return {
    ...raw,
    id: String(raw._id || raw.id || ''),
    sellerId: sid,
    sellerName: String(
      raw.sellerName ||
      seller.storeName ||
      seller.displayName ||
      sid
    ).trim(),
    reviewStatus: sellerProductReviewStatus(raw),
    reviewReason: String(approval.reason || '').trim(),
    reviewedAt: approval.reviewedAt || null,
    reviewedBy: String(approval.reviewedBy || '').trim()
  };
}

async function notifySellerProductReview(product = {}, status = '', reason = '') {
  if (!Notification?.create) return null;
  const raw = toJSON(product) || {};
  const sid = String(raw.sellerId || '').trim();
  if (!sid) return null;

  const approved = status === 'approved';
  const rejected = status === 'rejected';
  const title = approved
    ? '✅ Produto aprovado'
    : rejected
      ? '⚠️ Produto precisa de ajuste'
      : '⏳ Produto em revisão';
  const message = approved
    ? `${raw.name || 'Produto'} foi aprovado e publicado no marketplace.`
    : rejected
      ? `${raw.name || 'Produto'} foi recusado na revisão${reason ? `: ${reason}` : '.'}`
      : `${raw.name || 'Produto'} voltou para revisão da Ariana.`;

  return Notification.create({
    type: 'seller_product_review',
    title,
    message,
    status: 'unread',
    relatedId: String(raw._id || ''),
    severity: approved ? 'success' : rejected ? 'warning' : 'info',
    audience: 'seller',
    sellerId: sid,
    metadata: {
      productId: String(raw._id || ''),
      reviewStatus: status,
      reason
    }
  }).catch(() => null);
}

app.get('/api/seller/product-reviews', adminRequired, async (req, res) => {
  try {
    if (!Product) {
      return res.status(503).json({ ok: false, error: 'Catálogo indisponível.' });
    }

    const requestedStatus = String(req.query?.status || 'pending').trim().toLowerCase();
    const status = ['pending', 'approved', 'rejected', 'archived', 'all'].includes(requestedStatus)
      ? requestedStatus
      : 'pending';
    const limit = Math.min(500, Math.max(1, Number(req.query?.limit || 200)));

    const sellerRows = await Seller.find({
      sellerId: { $nin: [null, '', 'ArianaMoveis', 'ariana_moveis', 'ariana'] }
    }).select('sellerId storeName displayName').lean();

    const sellerMap = new Map(
      sellerRows
        .map((seller) => [String(seller.sellerId || '').trim(), seller])
        .filter(([sellerId]) => sellerId)
    );
    const sellerIds = Array.from(sellerMap.keys());

    if (!sellerIds.length) {
      return res.json({ ok: true, items: [], products: [], total: 0, status });
    }

    const sellerScope = { sellerId: { $in: sellerIds } };
    let query = sellerScope;

    if (status === 'pending') {
      query = {
        $and: [
          sellerScope,
          { active: { $ne: true } },
          {
            $or: [
              { 'specs.sellerApproval.status': 'pending' },
              { 'specs.sellerApproval.status': { $exists: false } }
            ]
          }
        ]
      };
    } else if (status === 'approved') {
      query = { ...sellerScope, active: true };
    } else if (status === 'rejected') {
      query = {
        ...sellerScope,
        active: { $ne: true },
        'specs.sellerApproval.status': 'rejected'
      };
    } else if (status === 'archived') {
      query = {
        ...sellerScope,
        active: { $ne: true },
        'specs.sellerApproval.status': 'archived'
      };
    }

    const rows = await Product.find(query)
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(limit);

    const products = rows.map((product) => sellerProductReviewResponse(product, sellerMap));
    return res.json({
      ok: true,
      items: products,
      products,
      total: products.length,
      status
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || 'Erro ao carregar produtos em revisão.'
    });
  }
});

app.patch('/api/seller/product-reviews/:id/status', adminRequired, async (req, res) => {
  try {
    if (!Product) {
      return res.status(503).json({ ok: false, error: 'Catálogo indisponível.' });
    }

    const id = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: 'Produto inválido.' });
    }

    const status = String(req.body?.status || '').trim().toLowerCase();
    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({
        ok: false,
        error: 'Status de revisão inválido.'
      });
    }

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ ok: false, error: 'Produto não encontrado.' });
    }

    const sellerId = String(product.sellerId || '').trim();
    const seller = sellerId
      ? await Seller.findOne({ sellerId }).lean()
      : null;

    if (!seller) {
      return res.status(403).json({
        ok: false,
        code: 'SELLER_PRODUCT_REQUIRED',
        error: 'Este produto não pertence a um seller cadastrado.'
      });
    }

    const reason = String(req.body?.reason || req.body?.motivo || '').trim().slice(0, 1000);
    const specs = product.specs && typeof product.specs === 'object'
      ? { ...product.specs }
      : {};
    const previousApproval = specs.sellerApproval && typeof specs.sellerApproval === 'object'
      ? { ...specs.sellerApproval }
      : {};

    specs.sellerApproval = {
      ...previousApproval,
      status,
      reason: status === 'rejected' ? reason : '',
      reviewedAt: now(),
      reviewedBy: req.admin?.email || req.user?.email || 'admin',
      sellerId
    };

    product.specs = specs;
    product.active = status === 'approved';
    product.markModified('specs');
    await product.save();

    await writeAuditLog({
      scope: 'seller_product_review',
      eventType: `seller_product_${status}`,
      status: 'success',
      metadata: {
        sellerId,
        productId: String(product._id),
        productName: product.name || '',
        reviewStatus: status,
        reason,
        admin: req.admin?.email || req.user?.email || 'admin'
      }
    }).catch(() => null);

    await notifySellerProductReview(product, status, reason);

    await createAdminNotification({
      type: 'seller_product_review_updated',
      title: status === 'approved'
        ? 'Produto de seller aprovado'
        : status === 'rejected'
          ? 'Produto de seller recusado'
          : 'Produto de seller devolvido para revisão',
      message: `${product.name || 'Produto'} • ${seller.storeName || seller.displayName || sellerId}`,
      relatedId: String(product._id),
      severity: status === 'approved' ? 'success' : status === 'rejected' ? 'warning' : 'info',
      metadata: { sellerId, status, reason }
    }).catch(() => null);

    const sellerMap = new Map([[sellerId, seller]]);
    return res.json({
      ok: true,
      product: sellerProductReviewResponse(product, sellerMap)
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || 'Erro ao revisar produto do seller.'
    });
  }
});

app.post('/api/seller/complete-onboarding', sellerAuthRequired, async (req, res) => {
  try {
    const sellerId = String(req.sellerId || '').trim();
    if (!sellerId) return res.status(403).json({ ok: false, error: 'Seller não autenticado' });
    const current = await Seller.findOne({ sellerId });
    if (!current) return res.status(404).json({ ok: false, error: 'Seller não encontrado' });
    const metadata = { ...(current.metadata || {}) };
    const allowed = ['bio','description','cepColeta','tipoLogistica','transpPropria','transportadoraNome','transportadoraTelefone','transportadoraPrazo','freteObs'];
    for (const key of allowed) if (req.body?.[key] !== undefined) metadata[key] = req.body[key];
    const seller = await Seller.findOneAndUpdate({ sellerId }, { $set: { onboardingCompleted: true, metadata } }, { new: true });
    return res.json({ ok: true, seller: safePartnerRequestForResponse(seller) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao completar onboarding' });
  }
});
}
