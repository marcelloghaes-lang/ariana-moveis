// ============================================================
// ROTAS DE SELLER / SOLICITAÇÕES DE PARCEIROS - ARIANA MÓVEIS
// Extraído de legacyRoutes.js na divisão de rotas - Etapa 2.
// Mantém os mesmos endpoints, regras e respostas.
// ============================================================

export default function registerSellerPartnerRoutes(app, context = {}) {
  const {
    Seller,
    User,
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

    const seller = await Seller.findOneAndUpdate(filter, {
      $set: {
        'metadata.commissionPercent': commissionPercent,
        'metadata.marketplaceCommissionPercent': commissionPercent,
        'metadata.commissionUpdatedAt': now(),
        'metadata.commissionUpdatedBy': req.admin?.email || req.user?.email || 'admin'
      }
    }, { new: true });

    if (!seller) return res.status(404).json({ ok: false, error: 'Seller não encontrado' });

    const s = normalizePartnerRequestForResponse(seller);
    await createAdminNotification({
      type: 'seller_commission_updated',
      title: '💰 Comissão do seller atualizada',
      message: `${s.storeName || s.factoryName || s.displayName || 'Seller'} agora está com comissão de ${commissionPercent}%.`,
      relatedId: s.id,
      severity: 'info',
      metadata: { sellerId: s.sellerId, commissionPercent }
    });

    return res.json({ ok: true, seller: s, request: s, commissionPercent });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao alterar comissão do seller' });
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
    return res.json({ ok: true, seller: toJSON(seller) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao completar onboarding' });
  }
});
}
