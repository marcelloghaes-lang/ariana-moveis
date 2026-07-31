// ============================================================
// CONTROLLER WHATSAPP / NOTIFICAÇÕES - ETAPA 21
// Extraído de routes/legacyRuntimeRoutes.js.
// Objetivo: retirar funções de WhatsApp e notificações do arquivo legado,
// preservando assinaturas, regras e respostas existentes.
// ============================================================

export default function createWhatsappController(context = {}) {
  const {
    DEFAULT_CURRENCY,
    DEFAULT_WHATSAPP_SETTINGS,
    Order,
    Ticket,
    User,
    Notification,
    OperationalAlert,
    WhatsAppWebhook,
    axios,
    cleanPhone,
    ensureArray,
    getWhatsappSettings,
    normalizePhone,
    now,
    redact,
    saveWhatsappSettings,
    toJSON,
    writeAuditLog
  } = context;

function redactWhatsappSettings(settings = {}) { const cfg = { ...(settings || {}) }; if (cfg.apiKey) cfg.apiKey = '[redacted]'; return cfg; }
function extractOrderPhone(order = {}, defaultCountryCode = '55') { const candidates = [order.whatsapp, order.telefoneWhatsapp, order.telefone, order.phone, order.customerPhone, order.customerWhatsapp, order.customer?.phone, order.customer?.whatsapp, order.shippingAddress?.phone]; for (const value of candidates) { const n = normalizePhone(value, defaultCountryCode); if (n) return n; } return ''; }
function extractOrderCustomerName(order = {}) { return String(order.customerName || order.nomeCliente || order.nome || order.customer?.name || order.customer?.nome || order.user?.name || order.customerEmail || 'Cliente').trim() || 'Cliente'; }
function extractSellerPhone(order = {}, defaultCountryCode = '55') { const candidates = [order.sellerPhone, order.sellerWhatsapp, order.seller?.phone, order.seller?.whatsapp, order.vendorPhone, order.fabricanteTelefone]; for (const value of candidates) { const n = normalizePhone(value, defaultCountryCode); if (n) return n; } return ''; }
function parseAdminNotifyNumbers(settings = {}) { return String(settings.adminNotifyNumbers || '').split(',').map(item => normalizePhone(item, settings.defaultCountryCode || '55')).filter(Boolean); }
function buildTrackingLine(order = {}, trackingCode = '') {
  const code = String(trackingCode || order.trackingCode || order.tracking_code || '').trim();
  return code ? `\n🔎 Código de rastreio: ${code}` : '';
}

function formatOrderStatusForCustomer(status = '') {
  const key = String(status || '').trim().toLowerCase();

  const map = {
    pending: 'Aguardando pagamento',
    pending_payment: 'Aguardando pagamento',
    aguardando_pagamento: 'Aguardando pagamento',
    paid: 'Pagamento confirmado',
    approved: 'Pagamento confirmado',
    pagamento_confirmado: 'Pagamento confirmado',
    processing: 'Pedido em separação',
    separacao: 'Pedido em separação',
    em_separacao: 'Pedido em separação',
    shipped: 'Pedido enviado',
    enviado: 'Pedido enviado',
    despachado: 'Pedido enviado',
    saiu_entrega: 'Saiu para entrega',
    saiu_para_entrega: 'Saiu para entrega',
    saiu_para_entrega_cliente: 'Saiu para entrega',
    em_rota: 'Saiu para entrega',
    rota_entrega: 'Saiu para entrega',
    out_for_delivery: 'Saiu para entrega',
    delivered: 'Pedido entregue',
    entregue: 'Pedido entregue',
    canceled: 'Pedido cancelado',
    cancelled: 'Pedido cancelado',
    cancelado: 'Pedido cancelado',
    rejected: 'Pagamento recusado',
    recusado: 'Pagamento recusado'
  };

  return map[key] || status || 'Atualizado';
}

function buildOrderStatusActionMessage(status = '') {
  const key = String(status || '').trim().toLowerCase();

  if (
    key.includes('pagamento confirmado') ||
    key.includes('approved') ||
    key.includes('paid') ||
    key.includes('aprovado') ||
    key.includes('pago')
  ) {
    return '✅ Pagamento confirmado com sucesso.\n\nSeu pedido já está sendo preparado para envio.';
  }

  if (
    key.includes('separacao') ||
    key.includes('separação') ||
    key.includes('processing')
  ) {
    return '📦 Seu pedido está sendo separado e conferido pela nossa equipe.';
  }

  if (
    key.includes('saiu para entrega') ||
    key.includes('saiu_entrega') ||
    key.includes('saiu_para_entrega') ||
    key.includes('out_for_delivery')
  ) {
    return '📍 Seu pedido saiu para entrega.\n\nNossa equipe está finalizando a rota e a entrega poderá ocorrer a qualquer momento.';
  }

  if (
    key.includes('enviado') ||
    key.includes('shipped') ||
    key.includes('despachado') ||
    key.includes('transporte')
  ) {
    return '🚚 Seu pedido foi despachado e está a caminho.';
  }

  if (
    key.includes('entregue') ||
    key.includes('delivered')
  ) {
    return '🎉 Pedido entregue com sucesso.\n\nEsperamos que você aproveite sua compra.';
  }

  if (
    key.includes('aguardando pagamento') ||
    key.includes('pending') ||
    key.includes('pendente') ||
    key.includes('aguard')
  ) {
    return '💳 Assim que o pagamento for confirmado, vamos iniciar a preparação do seu pedido.';
  }

  if (
    key.includes('cancel') ||
    key.includes('recus')
  ) {
    return 'ℹ️ Caso tenha dúvidas sobre esta atualização, fale com nossa equipe de atendimento.';
  }

  return '📲 Você pode acompanhar novas atualizações diretamente pelo WhatsApp.';
}

function titleCaseCustomerName(name = '') {
  return String(name || 'Cliente')
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildOrderStatusMessage(orderId, order = {}, settings = {}) {
  const customerName = titleCaseCustomerName(extractOrderCustomerName(order));
  const fullId = String(orderId || order._id || order.id || order.orderId || '').trim();
  const shortId = fullId ? fullId.slice(-8).toUpperCase() : '---';

  const rawStatus = order.statusLabel || order.status || 'Atualizado';
  const statusLabel = formatOrderStatusForCustomer(rawStatus);
  const actionMessage = buildOrderStatusActionMessage(`${rawStatus} ${statusLabel}`);
  const trackingLine = buildTrackingLine(order);

  const produto = Array.isArray(order.items) && order.items.length
    ? String(order.items[0]?.name || '').trim()
    : '';

  const valor = Number(order.total || 0);
  const valorLinha = valor > 0
    ? `\n💰 Valor: ${formatMoneyBRL(valor)}`
    : '';

  const produtoLinha = produto
    ? `\n📦 Produto: ${produto}`
    : '';

  return `
🛒 Ariana Móveis

Olá, ${customerName}! 👋

Seu pedido #${shortId} foi atualizado.

📋 Status: ${statusLabel}${produtoLinha}${valorLinha}${trackingLine}

${actionMessage}

💙 Obrigado por escolher a Ariana Móveis.

Atenciosamente,
Equipe Ariana Móveis
`.trim();
}
function buildOrderChatMessage(orderId, order = {}, message = {}) { const senderName = String(message.senderName || 'Equipe Ariana Móveis').trim(); const senderType = String(message.senderType || 'admin').trim(); const customerName = extractOrderCustomerName(order); const base = senderType === 'customer' ? `Olá! O cliente ${senderName} enviou uma nova mensagem no pedido ${orderId} da Ariana Móveis.` : `Olá, ${customerName}! Você recebeu uma nova mensagem sobre o pedido ${orderId} na Ariana Móveis.`; const text = String(message.text || '').trim(); return `${base}\n\nMensagem: ${text}`.trim(); }
async function waSendTextMessage({ number, text, settings = null, delay = 0 }) { const cfg = settings || await getWhatsappSettings(); if (!cfg.enabled) throw new Error('Integração WhatsApp desativada.'); if (!cfg.apiUrl || !cfg.apiKey || !cfg.instanceName) throw new Error('Configuração incompleta do WhatsApp.'); const normalizedNumber = normalizePhone(number, cfg.defaultCountryCode || '55'); if (!normalizedNumber) throw new Error('Número de telefone inválido.'); const url = `${String(cfg.apiUrl).replace(/\/+$/, '')}/message/sendText/${encodeURIComponent(cfg.instanceName)}`; const response = await axios.post(url, { number: normalizedNumber, text: String(text || '').trim(), delay: Number(delay || 0) || 0, linkPreview: false }, { headers: { 'Content-Type': 'application/json', apikey: cfg.apiKey }, timeout: 30000 }); return { ok: true, url, number: normalizedNumber, instanceName: cfg.instanceName, data: response.data, status: response.status }; }

function formatMoneyBRL(value = 0) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: DEFAULT_CURRENCY }).format(Number(value || 0));
}


// ============================================================
// NOTIFICAÇÕES DE PEDIDO / WEBHOOKS WHATSAPP - ETAPA 24
// Extraído de routes/legacyRuntimeRoutes.js sem alterar regras.
// ============================================================
function formatOrderItemsForWhatsapp(items = []) {
  const rows = ensureArray(items).filter(Boolean).slice(0, 12).map((item) => {
    const qty = Number(item.qty || item.quantity || 1) || 1;
    const name = String(item.name || item.nome || item.sku || 'Produto').trim();
    const total = Number(item.totalPrice || (Number(item.unitPrice || item.price || 0) * qty) || 0);
    return `• ${qty}x ${name}${total ? ` — ${formatMoneyBRL(total)}` : ''}`;
  });
  if (!rows.length) return '• Itens não informados';
  if (ensureArray(items).length > rows.length) rows.push(`• +${ensureArray(items).length - rows.length} item(ns)`);
  return rows.join('\n');
}

function buildAdminNewOrderMessage(orderDoc = {}) {
  const order = toJSON(orderDoc) || orderDoc || {};

  const orderId = String(order._id || order.id || '').slice(-8).toUpperCase() || '---';
  const customerName = String(order.customerName || order.shippingAddress?.name || 'Cliente não informado').trim();
  const customerPhone = String(order.customerPhone || order.shippingAddress?.phone || '').trim();
  const paymentMethod = String(order.payment?.method || order.payment?.payment_method || order.payment?.type || order.payment?.provider || 'Não informado').trim();
  const address = order.shippingAddress || {};
  const cidadeUf = [address.cidade || address.city, address.uf || address.state].filter(Boolean).join('/');
  const prazo = order.shipping?.prazo || order.shipping?.deliveryTime || order.shipping?.prazoEntrega || (order.shipping?.deadlineDays ? `${order.shipping.deadlineDays} dia(s) úteis` : 'Não informado');

  return [
    'ðŸ›’ *NOVA VENDA REALIZADA*',
    '',
    `Pedido: #${orderId}`,
    `Cliente: ${customerName}`,
    customerPhone ? `Telefone: ${customerPhone}` : 'Telefone: não informado',
    `Valor total: ${formatMoneyBRL(order.total || 0)}`,
    `Pagamento: ${paymentMethod}`,
    `Status: ${order.statusLabel || order.status || 'pendente'}`,
    `Prazo/Frete: ${prazo}`,
    cidadeUf ? `Cidade: ${cidadeUf}` : '',
    '',
    '*Itens:*',
    formatOrderItemsForWhatsapp(order.items || [])
  ].filter((line) => line !== '').join('\n');
}

async function waNotifyAdminNewOrder(orderDoc = {}, origin = 'order_created') {
  try {
    const settings = await getWhatsappSettings();
    const targets = parseAdminNotifyNumbers(settings);
    if (!settings.enabled) return { skipped: true, reason: 'integration_disabled' };
    if (!targets.length) return { skipped: true, reason: 'missing_admin_notify_numbers' };

    const text = buildAdminNewOrderMessage(orderDoc);
    const results = [];
    for (const number of targets) {
      try {
        const sent = await waSendTextMessage({ number, text, settings });
        results.push({ number, ok: true, status: sent.status, data: sent.data || null });
      } catch (error) {
        results.push({ number, ok: false, error: error.message || String(error) });
      }
    }

    await writeAuditLog({
      scope: 'whatsapp_evolution',
      eventType: 'admin_new_order_whatsapp_sent',
      orderId: String(orderDoc?._id || orderDoc?.id || ''),
      status: results.some((row) => row.ok) ? 'success' : 'error',
      request: { origin, numbers: targets, text },
      response: results,
      metadata: { instanceName: settings.instanceName, apiUrl: settings.apiUrl }
    });

    return { ok: results.some((row) => row.ok), results };
  } catch (error) {
    console.error('Erro ao notificar nova venda por WhatsApp:', error.message || error);
    return { ok: false, error: error.message || String(error) };
  }
}


function buildAdminOrderStatusMessage(orderId, before = {}, after = {}) {
  const order = toJSON(after) || after || {};

  const previousStatus = String(before?.statusLabel || before?.status || '---').trim();
  const nextStatus = String(order.statusLabel || order.status || 'Atualizado').trim();
  const customerName = String(order.customerName || order.shippingAddress?.name || 'Cliente não informado').trim();
  const customerPhone = String(order.customerPhone || order.shippingAddress?.phone || '').trim();
  const trackingCode = String(order.trackingCode || '').trim();
  const orderShort = String(order._id || order.id || orderId || '').slice(-8).toUpperCase() || '---';

  return [
    '📦 *PEDIDO ATUALIZADO*',
    '',
    `Pedido: #${orderShort}`,
    `Cliente: ${customerName}`,
    customerPhone ? `Telefone: ${customerPhone}` : 'Telefone: não informado',
    `Status anterior: ${previousStatus}`,
    `Novo status: ${nextStatus}`,
    `Valor total: ${formatMoneyBRL(order.total || 0)}`,
    trackingCode ? `Rastreio: ${trackingCode}` : ''
  ].filter(Boolean).join('\n');
}

async function waNotifyAdminOrderStatusChange(orderId, before = {}, after = {}, origin = 'admin_order_status_update') {
  try {
    console.log('[WHATSAPP STATUS ADMIN] INICIO', { orderId, origin, beforeStatus: before?.status, afterStatus: after?.status });
    const settings = await getWhatsappSettings();
    const targets = parseAdminNotifyNumbers(settings);
    if (!settings.enabled) return { skipped: true, reason: 'integration_disabled' };
    if (!targets.length) return { skipped: true, reason: 'missing_admin_notify_numbers' };

    const text = buildAdminOrderStatusMessage(orderId, before, after);
    const results = [];
    for (const number of targets) {
      try {
        const sent = await waSendTextMessage({ number, text, settings });
        results.push({ number, ok: true, status: sent.status, data: sent.data || null });
      } catch (error) {
        results.push({ number, ok: false, error: error.message || String(error) });
      }
    }

    await writeAuditLog({
      scope: 'whatsapp_evolution',
      eventType: 'admin_order_status_whatsapp_sent',
      orderId: String(orderId || after?._id || after?.id || ''),
      status: results.some((row) => row.ok) ? 'success' : 'error',
      request: { origin, numbers: targets, text },
      response: results,
      metadata: { instanceName: settings.instanceName, apiUrl: settings.apiUrl }
    });

    return { ok: results.some((row) => row.ok), results };
  } catch (error) {
    console.error('Erro ao notificar atualização do pedido para admin por WhatsApp:', error.message || error);
    return { ok: false, error: error.message || String(error) };
  }
}
async function waSendMediaMessage({ number, mediaUrl, caption = '', mediaType = 'image', fileName = '', settings = null, delay = 0 }) { const cfg = settings || await getWhatsappSettings(); if (!cfg.enabled) throw new Error('Integração WhatsApp desativada.'); if (!cfg.apiUrl || !cfg.apiKey || !cfg.instanceName) throw new Error('Configuração incompleta do WhatsApp.'); const normalizedNumber = normalizePhone(number, cfg.defaultCountryCode || '55'); if (!normalizedNumber) throw new Error('Número de telefone inválido.'); if (!String(mediaUrl || '').trim()) throw new Error('URL da mídia não informada.'); const url = `${String(cfg.apiUrl).replace(/\/+$/, '')}/message/sendMedia/${encodeURIComponent(cfg.instanceName)}`; const payload = { number: normalizedNumber, mediatype: String(mediaType || 'image').trim().toLowerCase(), media: String(mediaUrl || '').trim(), caption: String(caption || '').trim(), fileName: String(fileName || '').trim() || undefined, delay: Number(delay || 0) || 0 }; const response = await axios.post(url, payload, { headers: { 'Content-Type': 'application/json', apikey: cfg.apiKey }, timeout: 30000 }); return { ok: true, url, number: normalizedNumber, instanceName: cfg.instanceName, data: response.data, status: response.status, payload: redact(payload) }; }
async function waSyncWebhook(settings = null) { const cfg = settings || await getWhatsappSettings(); if (!cfg.apiUrl || !cfg.apiKey || !cfg.instanceName || !cfg.webhookUrl) throw new Error('Configuração incompleta do WhatsApp.'); const url = `${String(cfg.apiUrl).replace(/\/+$/, '')}/webhook/set/${encodeURIComponent(cfg.instanceName)}`; const body = { enabled: cfg.enabled === true, url: cfg.webhookUrl, webhookByEvents: cfg.webhookByEvents === true, webhookBase64: cfg.webhookBase64 === true, events: Array.isArray(cfg.webhookEvents) && cfg.webhookEvents.length ? cfg.webhookEvents : DEFAULT_WHATSAPP_SETTINGS.webhookEvents }; const response = await axios.post(url, body, { headers: { 'Content-Type': 'application/json', apikey: cfg.apiKey }, timeout: 30000 }); await saveWhatsappSettings({ lastWebhookSyncAt: now(), lastWebhookSyncResponse: redact(response.data || null) }, 'system'); return { ok: true, url, body, data: response.data, status: response.status }; }

function normalizeEvolutionEvent(value = '') {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[.\-\s]+/g, '_');
}

function waParseIncomingWebhook(body = {}) {
  const data = body?.data || {};
  const payload = data?.message ? data : (body?.message || data || body || {});
  const key = payload?.key || data?.key || body?.key || {};
  const rawMessage = payload?.message || data?.message || body?.message || {};
  const message =
    rawMessage?.ephemeralMessage?.message ||
    rawMessage?.viewOnceMessage?.message ||
    rawMessage?.viewOnceMessageV2?.message ||
    rawMessage;

  const text =
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption ||
    message?.videoMessage?.caption ||
    message?.documentMessage?.caption ||
    data?.messageText ||
    data?.text ||
    body?.text ||
    '';

  const remoteJid =
    key?.remoteJid ||
    payload?.key?.remoteJid ||
    data?.remoteJid ||
    body?.remoteJid ||
    data?.sender ||
    body?.sender ||
    '';

  const phoneSource = /@lid$/i.test(String(remoteJid || ''))
    ? (
        data?.senderPn ||
        body?.senderPn ||
        data?.sender ||
        body?.sender ||
        data?.from ||
        body?.from ||
        remoteJid
      )
    : (
        remoteJid ||
        data?.senderPn ||
        body?.senderPn ||
        data?.from ||
        body?.from ||
        data?.sender ||
        body?.sender ||
        ''
      );

  const number = cleanPhone(
    String(phoneSource || '').split('@')[0]
  );

  const pushName =
    payload?.pushName ||
    data?.pushName ||
    body?.pushName ||
    body?.sender?.pushName ||
    null;

  const fromMe =
    key?.fromMe === true ||
    data?.fromMe === true ||
    body?.fromMe === true;

  const event = normalizeEvolutionEvent(
    body?.event ||
    body?.type ||
    data?.event ||
    data?.type ||
    ''
  ) || null;

  const messageId = String(
    key?.id ||
    payload?.messageId ||
    data?.messageId ||
    data?.id ||
    body?.messageId ||
    body?.id ||
    ''
  ).trim();

  return {
    event,
    remoteJid,
    number,
    pushName,
    fromMe,
    text: String(text || '').trim(),
    messageId,
    raw: body
  };
}

function extractDeliveryRating(text = '') {
  const normalized = String(text || '')
    .trim()
    .replace(/\uFE0F/g, '')
    .replace(/\s+/g, ' ');

  if (/^[1-5]$/.test(normalized)) return Number(normalized);

  const withoutStars = normalized.replace(/[⭐★☆]/g, '').trim();
  if (/^[1-5](?:\s*(?:estrela|estrelas))?$/i.test(withoutStars)) {
    return Number(withoutStars.match(/[1-5]/)?.[0] || 0);
  }

  return 0;
}

function normalizeComparablePhone(value = '') {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
}

function phonesMatch(left = '', right = '') {
  const a = normalizeComparablePhone(left);
  const b = normalizeComparablePhone(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const minLength = Math.min(a.length, b.length);
  const suffixLength = minLength >= 11 ? 11 : Math.min(10, minLength);
  return suffixLength >= 8 && a.slice(-suffixLength) === b.slice(-suffixLength);
}

function deliveryRatingReplyMessage(order = {}, score = 0) {
  const firstName =
    titleCaseCustomerName(extractOrderCustomerName(order)).split(' ')[0] ||
    'Cliente';

  if (score <= 3) {
    return [
      `Obrigado por nos contar, ${firstName}.`,
      '',
      `Registramos sua avaliação de ${score} ${score === 1 ? 'estrela' : 'estrelas'}.`,
      'Sentimos que sua experiência não tenha sido como esperávamos.',
      '',
      'Nossa equipe vai analisar o atendimento. Pode nos contar, em uma mensagem, o que aconteceu?'
    ].join('\n');
  }

  return [
    `Muito obrigado, ${firstName}! 💙`,
    '',
    `Ficamos muito felizes com sua avaliação de ${score} estrelas.`,
    'Sua opinião foi registrada com sucesso e ajuda a Ariana Móveis a melhorar cada vez mais.'
  ].join('\n');
}

async function findPendingDeliveryRatingOrder(phone = '') {
  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

  const rows = await Order.find({
    'whatsappNotification.deliveryRatingSentAt': { $gte: cutoff }
  })
    .sort({ 'whatsappNotification.deliveryRatingSentAt': -1 })
    .limit(150);

  let latestMatched = null;

  for (const row of rows) {
    const order = toJSON(row) || row || {};
    const ratingPhone =
      order?.whatsappNotification?.deliveryRatingPhone ||
      extractOrderPhone(order, '55');

    if (!phonesMatch(phone, ratingPhone)) continue;
    if (!latestMatched) latestMatched = row;

    if (!order?.whatsappNotification?.deliveryRatingAnsweredAt) {
      return row;
    }
  }

  return latestMatched;
}

async function registerDeliveryRating(parsed = {}, score = 0) {
  const orderDoc = await findPendingDeliveryRatingOrder(parsed.number);
  if (!orderDoc) {
    return { handled: false, reason: 'rating_order_not_found' };
  }

  const order = toJSON(orderDoc) || {};
  const orderId = String(order._id || order.id || '').trim();
  const previousAnswerAt = order?.whatsappNotification?.deliveryRatingAnsweredAt;

  if (previousAnswerAt) {
    return {
      handled: true,
      duplicate: true,
      orderId,
      score: Number(order?.whatsappNotification?.deliveryRatingScore || score)
    };
  }

  const answeredAt = typeof now === 'function' ? now() : new Date();
  const locked = await Order.findOneAndUpdate(
    {
      _id: orderId,
      $or: [
        { 'whatsappNotification.deliveryRatingAnsweredAt': { $exists: false } },
        { 'whatsappNotification.deliveryRatingAnsweredAt': null }
      ]
    },
    {
      $set: {
        'whatsappNotification.deliveryRatingStatus': 'answered',
        'whatsappNotification.deliveryRatingScore': score,
        'whatsappNotification.deliveryRatingAnswerText': parsed.text,
        'whatsappNotification.deliveryRatingAnsweredAt': answeredAt,
        'whatsappNotification.deliveryRatingAnsweredPhone': parsed.number,
        'whatsappNotification.deliveryRatingPushName': parsed.pushName || '',
        'whatsappNotification.deliveryRatingMessageId': parsed.messageId || '',
        'whatsappNotification.deliveryRatingReplyStatus': 'pending'
      }
    },
    { new: true }
  ).catch(() => null);

  if (!locked) {
    return { handled: true, duplicate: true, orderId, score };
  }

  const lockedOrder = toJSON(locked) || order;
  const orderShort = orderId.slice(-8).toUpperCase() || '---';
  const customerName = extractOrderCustomerName(lockedOrder);
  const notificationMessage =
    `Cliente ${customerName} avaliou o pedido #${orderShort} com ${score} ` +
    `${score === 1 ? 'estrela' : 'estrelas'}.`;

  if (Notification?.create) {
    await Notification.create({
      type: 'pedido_avaliacao',
      title: score <= 3
        ? '⚠️ Avaliação baixa de pedido'
        : '⭐ Avaliação de pedido recebida',
      message: notificationMessage,
      status: 'unread',
      relatedId: orderId,
      severity: score <= 3 ? 'high' : 'info',
      audience: 'admin',
      metadata: {
        orderId,
        telefone: parsed.number,
        nota: score,
        messageId: parsed.messageId || '',
        source: 'whatsapp_delivery_rating'
      }
    }).catch((error) => {
      console.error('[WHATSAPP AVALIACAO] Falha ao criar notificação:', error.message || error);
    });
  }

  if (score <= 3 && Ticket?.create) {
    await Ticket.create({
      protocolo: `AV-${orderShort}-${Date.now()}`,
      nome: customerName || parsed.pushName || parsed.number || 'Cliente',
      email: null,
      tipo: 'Pós-venda',
      status: 'Novo',
      telefone: parsed.number || null,
      mensagem: `${notificationMessage} Aguardando relato do cliente.`,
      origem: 'whatsapp_delivery_rating',
      metadata: {
        orderId,
        nota: score,
        remoteJid: parsed.remoteJid || '',
        messageId: parsed.messageId || '',
        source: 'whatsapp_delivery_rating'
      }
    }).catch((error) => {
      console.error('[WHATSAPP AVALIACAO] Falha ao abrir atendimento:', error.message || error);
    });
  }

  if (score <= 3 && OperationalAlert?.create) {
    await OperationalAlert.create({
      alertId: `delivery_rating_low_${orderId}_${Date.now()}`,
      type: 'delivery_rating_low',
      severity: 'high',
      status: 'open',
      title: '⚠️ Avaliação baixa no pós-venda',
      message: notificationMessage,
      entityKey: orderId,
      orderId,
      metadata: {
        orderId,
        telefone: parsed.number,
        nota: score,
        source: 'whatsapp_delivery_rating'
      },
      firstSeenAt: answeredAt,
      lastSeenAt: answeredAt,
      buildId: 'whatsapp-delivery-rating-2026-07-31'
    }).catch((error) => {
      console.error('[WHATSAPP AVALIACAO] Falha ao criar alerta:', error.message || error);
    });
  }

  const replyText = deliveryRatingReplyMessage(lockedOrder, score);

  try {
    const sent = await waSendTextMessage({
      number: parsed.number,
      text: replyText
    });

    await Order.findByIdAndUpdate(orderId, {
      $set: {
        'whatsappNotification.deliveryRatingReplyStatus': 'sent',
        'whatsappNotification.deliveryRatingReplySentAt':
          typeof now === 'function' ? now() : new Date(),
        'whatsappNotification.deliveryRatingReplyText': replyText,
        'whatsappNotification.deliveryRatingReplyResponse':
          typeof redact === 'function' ? redact(sent.data || null) : (sent.data || null),
        'whatsappNotification.deliveryRatingReplyError': null
      }
    }).catch(() => null);

    if (typeof writeAuditLog === 'function') {
      await writeAuditLog({
        scope: 'whatsapp_evolution',
        eventType: 'delivery_rating_received',
        orderId,
        status: 'success',
        request: {
          number: parsed.number,
          score,
          messageId: parsed.messageId || ''
        },
        response: sent.data || null,
        metadata: { source: 'whatsapp_delivery_rating' }
      }).catch(() => null);
    }

    return {
      handled: true,
      duplicate: false,
      orderId,
      score,
      replySent: true
    };
  } catch (error) {
    await Order.findByIdAndUpdate(orderId, {
      $set: {
        'whatsappNotification.deliveryRatingReplyStatus': 'error',
        'whatsappNotification.deliveryRatingReplyText': replyText,
        'whatsappNotification.deliveryRatingReplyError':
          error.message || String(error)
      }
    }).catch(() => null);

    console.error('[WHATSAPP AVALIACAO] Avaliação registrada, mas resposta falhou:', {
      orderId,
      score,
      error: error.message || String(error)
    });

    return {
      handled: true,
      duplicate: false,
      orderId,
      score,
      replySent: false,
      replyError: error.message || String(error)
    };
  }
}

async function waPersistWebhook(body = {}) {
  const parsed = waParseIncomingWebhook(body);
  const payloadForLog =
    typeof redact === 'function' ? redact(body || null) : (body || null);

  if (WhatsAppWebhook?.create) {
    await WhatsAppWebhook.create({
      event: parsed.event || null,
      remoteJid: parsed.remoteJid || null,
      number: parsed.number || null,
      pushName: parsed.pushName || null,
      fromMe: parsed.fromMe === true,
      text: parsed.text || null,
      payload: payloadForLog
    }).catch((error) => {
      console.error('[WHATSAPP WEBHOOK] Falha ao persistir evento:', error.message || error);
    });
  }

  const isIncomingMessage =
    (!parsed.event || parsed.event === 'MESSAGES_UPSERT') &&
    !parsed.fromMe &&
    Boolean(parsed.text);

  if (!isIncomingMessage) return parsed;

  const score = extractDeliveryRating(parsed.text);
  if (score) {
    const deliveryRating = await registerDeliveryRating(parsed, score);
    if (deliveryRating.handled) {
      return { ...parsed, deliveryRating };
    }
  }

  if (Ticket?.create) {
    await Ticket.create({
      protocolo: `WA-${Date.now()}`,
      nome: parsed.pushName || parsed.number || 'WhatsApp',
      email: null,
      tipo: 'WhatsApp',
      status: 'Novo',
      telefone: parsed.number || null,
      mensagem: parsed.text,
      origem: 'evolution_webhook',
      metadata: {
        remoteJid: parsed.remoteJid || null,
        messageId: parsed.messageId || null
      }
    });
  }

  return parsed;
}

function buildDeliveryRatingMessage(order = {}) {
  const customerName = titleCaseCustomerName(extractOrderCustomerName(order)).split(" ")[0] || "Cliente";

  return `
Olá, ${customerName}! 👋

Seu pedido foi entregue com sucesso.

Como foi sua experiência com a Ariana Móveis?

⭐ 1
⭐⭐ 2
⭐⭐⭐ 3
⭐⭐⭐⭐ 4
⭐⭐⭐⭐⭐ 5

Sua opinião é muito importante para nós. 💙
`.trim();
}

async function scheduleDeliveryRating(orderId, order = {}, settings = null) {
  const rawStatus = String(order.statusLabel || order.status || "").toLowerCase();

  const isDelivered =
    rawStatus.includes("entregue") ||
    rawStatus.includes("delivered");

  if (!isDelivered) return { skipped: true, reason: "not_delivered" };

  const current = order.whatsappNotification || {};
  if (current.deliveryRatingSentAt || current.deliveryRatingDueAt) {
    return { skipped: true, reason: "already_scheduled_or_sent" };
  }

  const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await Order.findByIdAndUpdate(orderId, {
    $set: {
      "whatsappNotification.deliveryRatingDueAt": dueAt,
      "whatsappNotification.deliveryRatingStatus": "scheduled"
    }
  }).catch(() => null);

  return { ok: true, dueAt };
}

async function processPendingDeliveryRatings(limit = 20) {
  const settings = await getWhatsappSettings();
  if (!settings.enabled) return { skipped: true, reason: "whatsapp_disabled" };

  const orders = await Order.find({
    "whatsappNotification.deliveryRatingDueAt": { $lte: now() },
    "whatsappNotification.deliveryRatingSentAt": { $exists: false }
  }).sort({ "whatsappNotification.deliveryRatingDueAt": 1 }).limit(limit);

  const results = [];

  for (const order of orders) {
    const obj = toJSON(order);
    let number = extractOrderPhone(obj, settings.defaultCountryCode || "55");

    if (!number && obj?.userId) {
      try {
        const user = await User.findById(obj.userId);
        number = normalizePhone(user?.phone || user?.telefone || user?.whatsapp || "", settings.defaultCountryCode || "55");
      } catch (_error) {}
    }

    if (!number) {
      await Order.findByIdAndUpdate(obj._id || obj.id, {
        $set: {
          "whatsappNotification.deliveryRatingStatus": "error",
          "whatsappNotification.deliveryRatingError": "Telefone do cliente não encontrado"
        }
      }).catch(() => null);
      continue;
    }

    const text = buildDeliveryRatingMessage(obj);

    try {
      const sent = await waSendTextMessage({ number, text, settings });

      await Order.findByIdAndUpdate(obj._id || obj.id, {
        $set: {
          "whatsappNotification.deliveryRatingSentAt": now(),
          "whatsappNotification.deliveryRatingStatus": "sent",
          "whatsappNotification.deliveryRatingPhone": number,
          "whatsappNotification.deliveryRatingResponse": redact(sent.data || null)
        }
      }).catch(() => null);

      results.push({ ok: true, orderId: String(obj._id || obj.id), number });
    } catch (error) {
      await Order.findByIdAndUpdate(obj._id || obj.id, {
        $set: {
          "whatsappNotification.deliveryRatingStatus": "error",
          "whatsappNotification.deliveryRatingError": error.message || String(error)
        }
      }).catch(() => null);
    }
  }

  return { ok: true, processed: results.length, results };
}

async function waMaybeNotifyOrderStatusChange(orderId, before = {}, after = {}, origin = 'route') {
  const prevStatus = String(before?.status || '').trim();
  const nextStatus = String(after?.status || '').trim();
  const prevTracking = String(before?.trackingCode || before?.tracking_code || '').trim();
  const nextTracking = String(after?.trackingCode || after?.tracking_code || '').trim();
  const nextStatusLabel = String(after?.statusLabel || '').trim();

  console.log('[WHATSAPP STATUS CLIENTE] INICIO', {
    orderId,
    origin,
    beforeStatus: prevStatus,
    afterStatus: nextStatus,
    customerPhone: after?.customerPhone || '',
    shippingPhone: after?.shippingAddress?.phone || '',
    userId: after?.userId || ''
  });

  if (!nextStatus && !nextStatusLabel && !nextTracking) {
    return { skipped: true, reason: 'missing_status' };
  }

  if (
    prevStatus === nextStatus &&
    String(before?.statusLabel || '') === String(after?.statusLabel || '') &&
    prevTracking === nextTracking
  ) {
    return { skipped: true, reason: 'status_unchanged' };
  }

  const settings = await getWhatsappSettings();
  if (!settings.enabled) return { skipped: true, reason: 'integration_disabled' };
  if (!settings.autoNotifyOrderStatus) return { skipped: true, reason: 'auto_notify_disabled' };

  let number = extractOrderPhone(after, settings.defaultCountryCode || '55');

  if (!number && after?.userId) {
    try {
      const user = await User.findById(after.userId);
      number = normalizePhone(user?.phone || user?.telefone || user?.whatsapp || '', settings.defaultCountryCode || '55');
    } catch (_error) {}
  }

  if (!number) {
    await Order.findByIdAndUpdate(orderId, {
      $set: {
        whatsappNotification: {
          ...(after.whatsappNotification || {}),
          lastAttemptAt: now(),
          lastStatusNotified: null,
          lastError: 'Telefone do cliente não encontrado.',
          origin
        }
      }
    }).catch(() => null);

    console.log('[WHATSAPP STATUS CLIENTE] PULOU', { orderId, reason: 'missing_phone' });
    return { skipped: true, reason: 'missing_phone' };
  }

  const text = buildOrderStatusMessage(orderId, after, settings);

  // Chave simples e forte: evita duplicidade mesmo quando duas rotas disparam a mesma atualização.
  // Não depende do texto completo, nem da origem, para não falhar quando uma rota muda pequenos detalhes.
  const statusForKey = String(nextStatus || nextStatusLabel || 'status').trim().toLowerCase();
  const labelForKey = String(nextStatusLabel || '').trim().toLowerCase();
  const trackingForKey = String(nextTracking || '').trim().toLowerCase();
  const customerNotificationKey = `${String(orderId)}|${number}|${statusForKey}|${labelForKey}|${trackingForKey}`;

  // Se essa mesma atualização já foi enviada recentemente, não envia de novo.
  const currentOrder = await Order.findById(orderId).lean().catch(() => null);
  const currentWa = currentOrder?.whatsappNotification || {};
  if (
    currentWa.customerLastNotificationKey === customerNotificationKey ||
    currentWa.lastNotificationKey === customerNotificationKey ||
    currentWa.sendingKey === customerNotificationKey ||
    currentWa.customerSendingKey === customerNotificationKey
  ) {
    console.log('[WHATSAPP STATUS CLIENTE] DUPLICADO IGNORADO POR HISTORICO', {
      orderId,
      number,
      origin,
      customerNotificationKey
    });
    return { skipped: true, reason: 'duplicate_notification', number, customerNotificationKey };
  }

  // Trava atômica no MongoDB: só uma chamada consegue marcar esta chave como "em envio".
  const lockDoc = await Order.findOneAndUpdate(
    {
      _id: orderId,
      $and: [
        { $or: [
          { 'whatsappNotification.customerLastNotificationKey': { $ne: customerNotificationKey } },
          { 'whatsappNotification.customerLastNotificationKey': { $exists: false } }
        ] },
        { $or: [
          { 'whatsappNotification.customerSendingKey': { $ne: customerNotificationKey } },
          { 'whatsappNotification.customerSendingKey': { $exists: false } }
        ] }
      ]
    },
    {
      $set: {
        'whatsappNotification.customerSendingKey': customerNotificationKey,
        'whatsappNotification.lastAttemptAt': now(),
        'whatsappNotification.lastPhone': number,
        'whatsappNotification.origin': origin
      }
    },
    { new: true }
  ).catch(() => null);

  if (!lockDoc) {
    console.log('[WHATSAPP STATUS CLIENTE] DUPLICADO IGNORADO POR LOCK', {
      orderId,
      number,
      origin,
      customerNotificationKey
    });
    return { skipped: true, reason: 'duplicate_notification', number, customerNotificationKey };
  }

  try {
    const sent = await waSendTextMessage({ number, text, settings });

    await Order.findByIdAndUpdate(orderId, {
      $set: {
        'whatsappNotification.lastAttemptAt': now(),
        'whatsappNotification.lastSentAt': now(),
        'whatsappNotification.lastStatusNotified': nextStatus,
        'whatsappNotification.lastTrackingNotified': nextTracking,
        'whatsappNotification.customerLastNotificationKey': customerNotificationKey,
        'whatsappNotification.lastNotificationKey': customerNotificationKey,
        'whatsappNotification.lastMessage': text,
        'whatsappNotification.lastPhone': number,
        'whatsappNotification.lastError': null,
        'whatsappNotification.lastResponse': redact(sent.data || null),
        'whatsappNotification.origin': origin
      },
      $unset: {
        'whatsappNotification.customerSendingKey': '',
        'whatsappNotification.sendingKey': ''
      }
    }).catch(() => null);

    await writeAuditLog({
      scope: 'whatsapp_evolution',
      eventType: 'order_status_whatsapp_sent',
      orderId: String(orderId),
      status: 'success',
      request: { number, text, origin, customerNotificationKey },
      response: sent.data || null,
      metadata: { instanceName: settings.instanceName, apiUrl: settings.apiUrl }
    }).catch(() => null);

    await scheduleDeliveryRating(orderId, after, settings).catch((error) => {
      console.error('[WHATSAPP AVALIACAO ENTREGA] ERRO AO AGENDAR', error.message || error);
    });

    console.log('[WHATSAPP STATUS CLIENTE] ENVIADO', { orderId, number, status: sent.status, customerNotificationKey });
    return { ok: true, number, text, sent, customerNotificationKey };
  } catch (error) {
    await Order.findByIdAndUpdate(orderId, {
      $set: {
        'whatsappNotification.lastAttemptAt': now(),
        'whatsappNotification.lastStatusNotified': null,
        'whatsappNotification.lastError': error.message || String(error),
        'whatsappNotification.origin': origin
      },
      $unset: {
        'whatsappNotification.customerSendingKey': '',
        'whatsappNotification.sendingKey': ''
      }
    }).catch(() => null);

    await writeAuditLog({
      scope: 'whatsapp_evolution',
      eventType: 'order_status_whatsapp_error',
      orderId: String(orderId),
      status: 'error',
      request: { number, text, origin, customerNotificationKey },
      response: { error: error.message || String(error) },
      metadata: { instanceName: settings.instanceName, apiUrl: settings.apiUrl }
    }).catch(() => null);

    console.error('[WHATSAPP STATUS CLIENTE] ERRO', { orderId, number, error: error.message || String(error) });
    return { ok: false, number, error: error.message || String(error) };
  }
}

async function waNotifyOrderChatMessage(orderId, order = {}, message = {}, origin = 'route') { const settings = await getWhatsappSettings(); if (!settings.enabled) return { skipped: true, reason: 'integration_disabled' }; if (!settings.chatNotifyEnabled) return { skipped: true, reason: 'chat_notify_disabled' }; const senderType = String(message.senderType || '').trim() || 'customer'; const defaultCountryCode = settings.defaultCountryCode || '55'; const targets = new Set(); if (senderType === 'customer') { const sellerPhone = extractSellerPhone(order, defaultCountryCode); if (sellerPhone) targets.add(sellerPhone); for (const n of parseAdminNotifyNumbers(settings)) targets.add(n); } else { const customerPhone = extractOrderPhone(order, defaultCountryCode); if (customerPhone) targets.add(customerPhone); } const numbers = Array.from(targets).filter(Boolean); if (!numbers.length) return { skipped: true, reason: 'missing_target_phone' }; const text = buildOrderChatMessage(orderId, order, message); const results = []; for (const number of numbers) { const sent = await waSendTextMessage({ number, text, settings }); results.push({ number, status: sent.status, data: sent.data || null }); } await Order.findByIdAndUpdate(orderId, { $set: { chatMeta: { ...(order.chatMeta || {}), lastWhatsappNotifyAt: now(), lastWhatsappNotifyTargets: numbers, lastWhatsappNotifyMessage: text, lastWhatsappNotifyOrigin: origin } } }); await writeAuditLog({ scope: 'whatsapp_evolution', eventType: 'order_chat_whatsapp_sent', orderId: String(orderId), status: 'success', request: { origin, senderType, numbers, text }, response: results, metadata: { instanceName: settings.instanceName, apiUrl: settings.apiUrl } }); return { ok: true, numbers, text, results }; }


  return {
    redactWhatsappSettings,
    extractOrderPhone,
    extractOrderCustomerName,
    extractSellerPhone,
    parseAdminNotifyNumbers,
    buildTrackingLine,
    formatOrderStatusForCustomer,
    buildOrderStatusActionMessage,
    titleCaseCustomerName,
    buildOrderStatusMessage,
    buildOrderChatMessage,
    waSendTextMessage,
    formatMoneyBRL,
    formatOrderItemsForWhatsapp,
    buildAdminNewOrderMessage,
    waNotifyAdminNewOrder,
    buildAdminOrderStatusMessage,
    waNotifyAdminOrderStatusChange,
    waSendMediaMessage,
    waSyncWebhook,
    waParseIncomingWebhook,
    waPersistWebhook,
    buildDeliveryRatingMessage,
    scheduleDeliveryRating,
    processPendingDeliveryRatings,
    waMaybeNotifyOrderStatusChange,
    waNotifyOrderChatMessage
  };
}
