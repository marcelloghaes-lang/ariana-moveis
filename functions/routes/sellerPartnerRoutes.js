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

app.post('/api/seller/partner-request', async (req, res) => {
  try {
    const body = req.body || {};
    const sellerId = uid('seller');
    const seller = await Seller.create({
      sellerId,
      displayName: body.name || body.displayName || body.ownerName || '',
      storeName: body.storeName || body.factoryName || body.razaoSocial || body.legalName || body.shopName || body.name || '',
      email: body.email || body.contactEmail || '',
      phone: body.phone || body.whatsapp || '',
      document: body.document || body.cnpj || body.cpf || body.cpfCnpj || body.cpf_cnpj || '',
      status: 'pending',
      onboardingCompleted: false,
      metadata: body
    });

    const notification = await notifyNewPartnerRequest(seller).catch((error) => ({ ok: false, error: error.message || String(error) }));

    return res.json({ ok: true, id: seller.sellerId, sellerId: seller.sellerId, seller: normalizePartnerRequestForResponse(seller), notification });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao criar solicitação de parceiro' });
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
    const requests = rows.map(normalizePartnerRequestForResponse);
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

    const s = normalizePartnerRequestForResponse(seller);
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
    let user = await User.findOne({ $or: [{ email }, { sellerId }] });
    if (user) {
      user.email = email;
      user.passwordHash = passwordHash;
      user.role = 'seller';
      user.sellerId = sellerId;
      user.isActive = true;
      await user.save();
    } else {
      user = await User.create({ name: seller.displayName || seller.storeName || email, email, passwordHash, phone: seller.phone || '', cpf: seller.document || '', role: 'seller', sellerId, isActive: true });
    }
    const metadata = { ...(seller.metadata || {}) };
    delete metadata.password;
    delete metadata.senha;
    delete metadata.requestedTempPass;
    await Seller.findByIdAndUpdate(seller._id, { $set: { sellerId, userId: user._id, metadata } });
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
