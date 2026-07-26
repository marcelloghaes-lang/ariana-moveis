// ============================================================
// ROTAS DE PAGAMENTOS - MERCADO PAGO / PAGAR.ME / WEBHOOKS
// Extraído de legacyRoutes.js na Etapa 13.
// Objetivo: reduzir legacyRoutes.js sem alterar endpoints, regras ou respostas.
// ============================================================

export default function registerPaymentRoutes(app, context = {}) {
  const {
    APP_BASE_URL,
    Order,
    PaymentEvent,
    adminRequired,
    getPaymentsSettings,
    getShippingSettings,
    getWhatsappSettings,
    MONGODB_DB,
    PORT,
    BUILD_ID,
    redactWhatsappSettings,
    redact,
    writeAuditLog,
    createMercadoPagoPayment,
    normalizeMercadoPagoPaymentResponse,
    updateOrderPaymentFromMercadoPago,
    buildMercadoPagoPayer,
    buildMercadoPagoAdditionalInfo,
    parsePaymentAmount,
    getMercadoPagoPaymentById,
    resolveOrderIdFromMpPayment,
    updateOrderFromMercadoPagoPayment,
    createPagarmeOrder,
    buildPagarmePixPayload,
    buildPagarmeBoletoPayload,
    buildPagarmeCreditPayload,
    buildSellerSplitSummary,
    applyPagarmeSplitToPayload,
    normalizePagarmePixResponse,
    normalizePagarmeBoletoResponse,
    updateOrderPaymentFromPagarme,
    getPagarmeStatus,
    getPagarmeCharge,
    getPagarmeTransaction,
    getPagarmeGatewayMessage,
    normalizeObjectId,
    toJSON
  } = context;

app.get('/api/payments/mp/public-key', async (_req, res) => { const settings = await getPaymentsSettings(); return res.json({ ok: true, publicKey: settings.mercadopago?.publicKey || process.env.MP_PUBLIC_KEY || '' }); });
app.post('/api/payments/mp/pix', async (req, res) => { try { const body = req.body || {}; const payload = { transaction_amount: parsePaymentAmount(body.amount || body.total || body.transaction_amount || 0), description: body.description || `Pedido Ariana Móveis`, payment_method_id: 'pix', payer: buildMercadoPagoPayer(body), metadata: { orderId: body.orderId || null }, notification_url: body.notification_url || `${APP_BASE_URL || 'http://localhost:3000'}/api/webhooks/mercadopago` }; const { response, idempotencyKey } = await createMercadoPagoPayment(payload); await writeAuditLog({ scope: 'payments', eventType: 'mercadopago_pix_created', orderId: body.orderId || null, status: response.status >= 200 && response.status < 300 ? 'success' : 'error', statusCode: response.status, request: payload, response: response.data, metadata: { provider: 'mercadopago', idempotencyKey } }); if (response.status >= 200 && response.status < 300) {
  const mpNormalized = normalizeMercadoPagoPaymentResponse(response.data);

  if (body.orderId) {
    try {
      await Order.findByIdAndUpdate(body.orderId, {
        $set: {
          "payment.provider": "mercadopago",
          "payment.method": "pix",
          "payment.type": "pix",
          "payment.status": mpNormalized.status || "pending",
          "payment.statusDetail": mpNormalized.statusDetail || "",
          "payment.paymentId": mpNormalized.id || "",
          "payment.externalId": mpNormalized.id || "",
          "payment.pixCode": mpNormalized.qrCode || mpNormalized.qr_code || "",
          "payment.qr_code": mpNormalized.qrCode || mpNormalized.qr_code || "",
          "payment.qrCodeBase64": mpNormalized.qrCodeBase64 || "",
          "payment.qr_code_base64": mpNormalized.qrCodeBase64 || "",
          "payment.ticketUrl": mpNormalized.ticketUrl || mpNormalized.ticket_url || "",
          "payment.updatedAt": new Date()
        }
      });
    } catch (e) {
      console.error("Erro ao salvar PIX no pedido:", e.message || e);
    }
  }

  return res.status(response.status).json(mpNormalized);
} return res.status(response.status).json({ ok: false, error: response.data?.message || response.data?.cause?.[0]?.description || 'Erro ao criar PIX', details: response.data }); } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Erro ao criar PIX no Mercado Pago' }); } });

app.post('/api/payments/mp/credit', async (req, res) => {
  try {
    const body = req.body || {};
    const payload = {
      transaction_amount: Number(body.amount || body.total || 0),
      token: body.token,
      description: body.description || `Pedido Ariana Móveis`,
      installments: Number(body.installments || 1),
      payment_method_id: body.payment_method_id || 'visa',
      issuer_id: body.issuer_id,
      payer: buildMercadoPagoPayer(body),
      metadata: { orderId: body.orderId || null, paymentMethod: 'card', birthDate: body.birthDate || body.customer?.birthDate || null, phone: body.phone || body.customer?.phone || null },
      external_reference: body.orderId ? String(body.orderId) : undefined,
      binary_mode: false,
      additional_info: buildMercadoPagoAdditionalInfo(body),
      notification_url: body.notification_url || `${APP_BASE_URL || 'http://localhost:3000'}/api/webhooks/mercadopago`
    };
    console.log('[MP CREDIT REQUEST]', JSON.stringify({
      amount: payload.transaction_amount,
      payment_method_id: payload.payment_method_id,
      installments: payload.installments,
      hasToken: Boolean(payload.token),
      hasCpf: Boolean(payload.payer?.identification?.number),
      hasEmail: Boolean(payload.payer?.email),
      hasPhone: Boolean(payload.payer?.phone?.number),
      hasAddress: Boolean(payload.payer?.address && Object.keys(payload.payer.address).length),
      hasReceiverAddress: Boolean(payload.additional_info?.shipments?.receiver_address)
    }, null, 2));

    const { response, idempotencyKey } = await createMercadoPagoPayment(payload);
    const mpData = response.data || {};
    console.log(
  '[MP CREDIT RESPONSE]',
  JSON.stringify({
    status: response.status,
    status_mp: mpData?.status,
    status_detail: mpData?.status_detail,
    message: mpData?.message,
    cause: mpData?.cause
  }, null, 2)
);
    const approved = mpData?.status === 'approved';

    const updatedOrder = await updateOrderPaymentFromMercadoPago(body.orderId, 'card', mpData, {
      installments: Number(body.installments || 1),
      paymentMethodId: body.payment_method_id || mpData?.payment_method_id || '',
      issuerId: body.issuer_id || mpData?.issuer_id || ''
    });

    await writeAuditLog({
      scope: 'payments',
      eventType: 'mercadopago_card_created',
      orderId: body.orderId || null,
      status: response.status >= 200 && response.status < 300 ? 'success' : 'error',
      statusCode: response.status,
      request: payload,
      response: mpData,
      metadata: { provider: 'mercadopago', idempotencyKey, alias: 'credit', orderUpdated: !!updatedOrder }
    });

    return res.status(response.status).json({
      ok: response.status >= 200 && response.status < 300,
      approved,
      status: mpData?.status || '',
      statusDetail: mpData?.status_detail || '',
      id: mpData?.id ? String(mpData.id) : '',
      paymentId: mpData?.id ? String(mpData.id) : '',
      paymentMethod: 'card',
      method: 'card',
      data: mpData,
      raw: mpData,
      order: updatedOrder ? toJSON(updatedOrder) : null
    });
  } catch (error) {
    const status = error?.response?.status || 500;
    const details = error?.response?.data || null;
    return res.status(status).json({
      ok: false,
      error: details?.message || details?.cause?.[0]?.description || error.message || 'Erro ao criar pagamento cartão no Mercado Pago',
      statusDetail: details?.status_detail || '',
      details
    });
  }
});

app.post('/api/payments/mp/card', async (req, res) => {
  try {
    const body = req.body || {};
    const payload = {
      transaction_amount: Number(body.amount || body.total || 0),
      token: body.token,
      description: body.description || `Pedido Ariana Móveis`,
      installments: Number(body.installments || 1),
      payment_method_id: body.payment_method_id || 'visa',
      issuer_id: body.issuer_id,
      payer: buildMercadoPagoPayer(body),
      metadata: { orderId: body.orderId || null, paymentMethod: 'card', birthDate: body.birthDate || body.customer?.birthDate || null, phone: body.phone || body.customer?.phone || null },
      external_reference: body.orderId ? String(body.orderId) : undefined,
      binary_mode: false,
      additional_info: buildMercadoPagoAdditionalInfo(body),
      notification_url: body.notification_url || `${APP_BASE_URL || 'http://localhost:3000'}/api/webhooks/mercadopago`
    };
    const { response, idempotencyKey } = await createMercadoPagoPayment(payload);
    const mpData = response.data || {};
    const approved = mpData?.status === 'approved';

    const updatedOrder = await updateOrderPaymentFromMercadoPago(body.orderId, 'card', mpData, {
      installments: Number(body.installments || 1),
      paymentMethodId: body.payment_method_id || mpData?.payment_method_id || '',
      issuerId: body.issuer_id || mpData?.issuer_id || ''
    });

    await writeAuditLog({
      scope: 'payments',
      eventType: 'mercadopago_card_created',
      orderId: body.orderId || null,
      status: response.status >= 200 && response.status < 300 ? 'success' : 'error',
      statusCode: response.status,
      request: payload,
      response: mpData,
      metadata: { provider: 'mercadopago', idempotencyKey, alias: 'card', orderUpdated: !!updatedOrder }
    });

    return res.status(response.status).json({
      ok: response.status >= 200 && response.status < 300,
      approved,
      status: mpData?.status || '',
      statusDetail: mpData?.status_detail || '',
      id: mpData?.id ? String(mpData.id) : '',
      paymentId: mpData?.id ? String(mpData.id) : '',
      paymentMethod: 'card',
      method: 'card',
      data: mpData,
      raw: mpData,
      order: updatedOrder ? toJSON(updatedOrder) : null
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao criar pagamento cartão no Mercado Pago' });
  }
});

// Funções Mercado Pago de consulta, resolução de pedido e atualização do pedido
// foram extraídas para o context durante a refatoração. Mantemos aqui apenas as rotas.

app.post('/api/payments/mp/boleto', async (req, res) => {
  try {
    const body = req.body || {};
    const orderId = body.orderId || body.order_id || null;
    const payload = {
      transaction_amount: Number(body.amount || body.total || 0),
      description: body.description || `Pedido Ariana Móveis`,
      payment_method_id: 'bolbradesco',
      payer: buildMercadoPagoPayer(body),
      metadata: { orderId },
      external_reference: orderId ? String(orderId) : undefined,
      notification_url: body.notification_url || `${APP_BASE_URL || 'http://localhost:3000'}/api/webhooks/mercadopago`
    };

    const { response, idempotencyKey } = await createMercadoPagoPayment(payload);
    const mpData = response.data || {};

    let orderUpdate = null;
    let adminWhatsapp = null;

    if (response.status >= 200 && response.status < 300) {
      orderUpdate = await updateOrderFromMercadoPagoPayment(mpData, orderId, 'mercadopago_boleto_created');

      // Boleto criado ainda não é venda concluída. Só notifica quando o webhook confirmar pagamento aprovado.
      adminWhatsapp = { skipped: true, reason: 'waiting_boleto_payment_approval' };
    }

    await writeAuditLog({
      scope: 'payments',
      eventType: 'mercadopago_boleto_created',
      orderId: orderId || null,
      status: response.status >= 200 && response.status < 300 ? 'success' : 'error',
      statusCode: response.status,
      request: payload,
      response: mpData,
      metadata: { provider: 'mercadopago', idempotencyKey, orderUpdate, adminWhatsapp }
    });

    if (response.status >= 200 && response.status < 300) {
      return res.status(response.status).json({
        ...normalizeMercadoPagoPaymentResponse(mpData),
        orderUpdate,
        adminWhatsapp
      });
    }

    return res.status(response.status).json({
      ok: false,
      error: mpData?.message || mpData?.cause?.[0]?.description || 'Erro ao criar boleto',
      details: mpData
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao criar boleto no Mercado Pago' });
  }
});

app.post('/api/webhooks/mercadopago', async (req, res) => {
  try {
    const payload = req.body || {};
    const paymentId = payload.data?.id ? String(payload.data.id) : (payload.id ? String(payload.id) : '');
    const mpData = paymentId ? await getMercadoPagoPaymentById(paymentId) : null;
    const orderId = resolveOrderIdFromMpPayment(mpData || {}, payload.orderId || payload.external_reference || '');

    const event = await PaymentEvent.create({
      provider: 'mercadopago',
      eventType: payload.type || payload.action || 'unknown',
      externalId: paymentId || null,
      orderId: orderId || null,
      payload
    });

    let orderUpdate = null;
    if (mpData) {
      orderUpdate = await updateOrderFromMercadoPagoPayment(mpData, orderId, 'mercadopago_webhook');
    }

    await writeAuditLog({
      scope: 'payments',
      eventType: 'mercadopago_webhook_received',
      orderId: orderId || event.orderId || null,
      status: 'received',
      request: payload,
      response: mpData || null,
      metadata: { provider: 'mercadopago', orderUpdate }
    });

    return res.json({ ok: true, received: true, orderUpdate });
  } catch (error) {
    console.error('Erro ao processar webhook do Mercado Pago:', error.message || error);
    return res.status(500).json({ ok: false, error: 'Erro ao processar webhook do Mercado Pago' });
  }
});



app.post('/api/admin/sellers/:sellerId/pagarme-recipient', adminRequired, async (req, res) => {
  try {
    const sid = String(req.params.sellerId || '').trim();
    const sellerDoc = await Seller.findOne({ sellerId: sid }) || await Seller.findById(normalizeObjectId(sid)).catch(() => null);
    if (!sellerDoc) return res.status(404).json({ ok: false, error: 'Seller não encontrado.' });
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
    await writeAuditLog({ scope: 'payments', eventType: 'pagarme_recipient_created_by_admin', status: 'success', request: redact(payload), response: redact(data), metadata: { sellerId: seller.sellerId || String(seller._id), admin: req.admin?.email || '' } });
    return res.json({ ok: true, recipientId: normalized.id, recipient: normalized, seller: toJSON(seller) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao criar Recipient Pagar.me', requiredFields: error.requiredFields || undefined });
  }
});

app.get('/api/payments/split/preview/:orderId', adminRequired, async (req, res) => {
  try {
    const oid = normalizeObjectId(req.params.orderId);
    if (!oid) return res.status(400).json({ ok: false, error: 'ID inválido' });
    const order = await Order.findById(oid);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado' });
    const summary = await buildSellerSplitSummary(order, req.query.sellerId || '');
    return res.json(summary);
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao calcular split' });
  }
});

app.post('/api/payments/cielo/credit', async (_req, res) => res.status(410).json({ ok: false, provider: 'cielo', error: 'Cielo desativada. Marketplace Ariana usa Pagar.me Split obrigatório.' }));

app.post('/api/payments/pagarme/pix', async (req, res) => {
  try {
    const body = req.body || {};
    const orderId = body.orderId || body.order_id || null;
    const order = normalizeObjectId(orderId) ? await Order.findById(orderId) : null;
    let payload = buildPagarmePixPayload(body, order);
    const splitSummary = order ? await buildSellerSplitSummary(order) : { sellers: [], totalMarketplaceAmount: 0 };
    const paymentSettingsForSplit = await getPaymentsSettings();
    payload.settings = { marketplaceRecipientId: paymentSettingsForSplit.pagarme?.marketplaceRecipientId || process.env.PAGARME_MARKETPLACE_RECIPIENT_ID || '' };
    payload = applyPagarmeSplitToPayload(payload, splitSummary);
    delete payload.settings;
    const response = await createPagarmeOrder(payload);
    const pagarmeData = response.data || {};
    const normalized = normalizePagarmePixResponse(pagarmeData);
    const updatedOrder = response.status >= 200 && response.status < 300 ? await updateOrderPaymentFromPagarme(orderId, pagarmeData, { method: 'pix', type: 'pix', qrCode: normalized.qrCode }) : null;
    await writeAuditLog({ scope: 'payments', eventType: 'pagarme_pix_created', orderId: orderId || null, status: response.status >= 200 && response.status < 300 ? 'success' : 'error', statusCode: response.status, request: payload, response: pagarmeData, metadata: { provider: 'pagarme', orderUpdated: !!updatedOrder, splitSummary } });
    return res.status(response.status).json({ ...normalized, order: updatedOrder ? toJSON(updatedOrder) : null });
  } catch (error) {
    const status = error?.response?.status || 500;
    const details = error?.response?.data || null;
    return res.status(status).json({ ok: false, provider: 'pagarme', error: details?.message || details?.errors?.[0]?.message || error.message || 'Erro ao criar Pix no Pagar.me', details });
  }
});

app.post('/api/payments/pagarme/boleto', async (req, res) => {
  try {
    const body = req.body || {};
    const orderId = body.orderId || body.order_id || null;
    const order = normalizeObjectId(orderId) ? await Order.findById(orderId) : null;
    let payload = buildPagarmeBoletoPayload(body, order);
    const splitSummary = order ? await buildSellerSplitSummary(order) : { sellers: [], totalMarketplaceAmount: 0 };
    const paymentSettingsForSplit = await getPaymentsSettings();
    payload.settings = { marketplaceRecipientId: paymentSettingsForSplit.pagarme?.marketplaceRecipientId || process.env.PAGARME_MARKETPLACE_RECIPIENT_ID || '' };
    payload = applyPagarmeSplitToPayload(payload, splitSummary);
    delete payload.settings;
    const response = await createPagarmeOrder(payload);
    const pagarmeData = response.data || {};
    const normalized = normalizePagarmeBoletoResponse(pagarmeData);
    const updatedOrder = response.status >= 200 && response.status < 300 ? await updateOrderPaymentFromPagarme(orderId, pagarmeData, { method: 'boleto', type: 'boleto', ticketUrl: normalized.ticketUrl }) : null;
    await writeAuditLog({ scope: 'payments', eventType: 'pagarme_boleto_created', orderId: orderId || null, status: response.status >= 200 && response.status < 300 ? 'success' : 'error', statusCode: response.status, request: payload, response: pagarmeData, metadata: { provider: 'pagarme', orderUpdated: !!updatedOrder, splitSummary } });
    return res.status(response.status).json({ ...normalized, order: updatedOrder ? toJSON(updatedOrder) : null });
  } catch (error) {
    const status = error?.response?.status || 500;
    const details = error?.response?.data || null;
    return res.status(status).json({ ok: false, provider: 'pagarme', error: details?.message || details?.errors?.[0]?.message || error.message || 'Erro ao criar boleto no Pagar.me', details });
  }
});

app.get('/api/payments/pagarme/public-key', async (_req, res) => {
  try {
    const settings = await getPaymentsSettings();
    const publicKey = settings.pagarme?.publicKey || process.env.PAGARME_PUBLIC_KEY || '';
    if (!publicKey) return res.status(500).json({ ok: false, error: 'Pagar.me public key não configurada.' });
    return res.json({ ok: true, publicKey, endpoint: settings.pagarme?.endpoint || process.env.PAGARME_API_URL || 'https://api.pagar.me/core/v5' });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao obter public key Pagar.me.' });
  }
});

app.post('/api/payments/pagarme/credit', async (req, res) => {
  try {
    const body = req.body || {};
    const orderId = body.orderId || body.order_id || null;
    const order = normalizeObjectId(orderId) ? await Order.findById(orderId) : null;
    let payload = buildPagarmeCreditPayload(body, order);
    const splitSummary = order ? await buildSellerSplitSummary(order) : { sellers: [], totalMarketplaceAmount: 0 };
    const paymentSettingsForSplit = await getPaymentsSettings();
    payload.settings = { marketplaceRecipientId: paymentSettingsForSplit.pagarme?.marketplaceRecipientId || process.env.PAGARME_MARKETPLACE_RECIPIENT_ID || '' };
    payload = applyPagarmeSplitToPayload(payload, splitSummary);
    delete payload.settings;

    const response = await createPagarmeOrder(payload);
    const pagarmeData = response.data || {};
    const normalizedStatus = getPagarmeStatus(pagarmeData);
    const approved = normalizedStatus === 'approved';
    const charge = getPagarmeCharge(pagarmeData) || {};
    const tx = getPagarmeTransaction(pagarmeData) || {};

    const updatedOrder = response.status >= 200 && response.status < 300
      ? await updateOrderPaymentFromPagarme(orderId, pagarmeData, { installments: Number(body.installments || 1) || 1 })
      : null;

    await writeAuditLog({
      scope: 'payments',
      eventType: 'pagarme_card_created',
      orderId: orderId || null,
      status: response.status >= 200 && response.status < 300 ? 'success' : 'error',
      statusCode: response.status,
      request: payload,
      response: pagarmeData,
      metadata: { provider: 'pagarme', orderUpdated: !!updatedOrder, splitSummary }
    });

    return res.status(response.status).json({
      ok: response.status >= 200 && response.status < 300,
      approved,
      status: normalizedStatus,
      statusDetail: getPagarmeGatewayMessage(pagarmeData),
      id: String(charge.id || tx.id || pagarmeData.id || ''),
      paymentId: String(charge.id || tx.id || pagarmeData.id || ''),
      paymentMethod: 'card',
      method: 'card',
      provider: 'pagarme',
      data: pagarmeData,
      raw: pagarmeData,
      order: updatedOrder ? toJSON(updatedOrder) : null
    });
  } catch (error) {
    const status = error?.response?.status || 500;
    const details = error?.response?.data || null;
    return res.status(status).json({
      ok: false,
      provider: 'pagarme',
      error: details?.message || details?.errors?.[0]?.message || error.message || 'Erro ao criar pagamento cartão no Pagar.me',
      details
    });
  }
});

app.post('/api/payments/pagarme/order', async (req, res) => { try { const payload = req.body || {}; const response = await createPagarmeOrder(payload); await writeAuditLog({ scope: 'payments', eventType: 'pagarme_order_created', orderId: payload.metadata?.orderId || payload.orderId || null, status: response.status >= 200 && response.status < 300 ? 'success' : 'error', statusCode: response.status, request: payload, response: response.data, metadata: { provider: 'pagarme' } }); return res.status(response.status).json({ ok: response.status >= 200 && response.status < 300, data: response.data }); } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Erro ao criar pedido no Pagar.me' }); } });
app.post('/api/webhooks/pagarme', async (req, res) => {
  try {
    const payload = req.body || {};
    const data = payload.data || payload;
    const orderId = data?.metadata?.orderId || data?.order?.metadata?.orderId || payload.orderId || null;
    const event = await PaymentEvent.create({
      provider: 'pagarme',
      eventType: payload.type || payload.event || 'unknown',
      externalId: payload.id ? String(payload.id) : (data.id ? String(data.id) : null),
      orderId,
      payload
    });
    let orderUpdate = null;
    if (orderId && (data.status || data.charges || data.amount)) {
      orderUpdate = await updateOrderPaymentFromPagarme(orderId, data, { origin: 'pagarme_webhook' });
    }
    await writeAuditLog({ scope: 'payments', eventType: 'pagarme_webhook_received', orderId: event.orderId || null, status: 'received', request: payload, metadata: { provider: 'pagarme', orderUpdate } });
    return res.json({ ok: true, orderUpdate });
  } catch (_error) {
    return res.status(500).json({ ok: false, error: 'Erro ao processar webhook do Pagar.me' });
  }
});

}
