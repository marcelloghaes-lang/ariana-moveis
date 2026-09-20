function text(value = '', max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function moneyBR(value = 0) {
  const number = Number(value || 0);
  return Number.isFinite(number)
    ? number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    : 'R$ 0,00';
}

function parseAlertNumbers() {
  const raw = String(
    process.env.ADMIN_WHATSAPP_ALERT_NUMBERS ||
    process.env.ADMIN_WHATSAPP_ALERT_NUMBER ||
    ''
  ).trim();

  return Array.from(new Set(
    raw
      .split(/[;,\s]+/)
      .map((value) => value.replace(/\D/g, ''))
      .filter(Boolean)
  ));
}

function paymentLabel(value = '') {
  const method = text(value, 80).toLowerCase();
  if (method.includes('crediario')) return 'Crediário Ariana';
  if (method.includes('pix')) return 'PIX';
  if (method.includes('boleto')) return 'Boleto';
  if (method.includes('card') || method.includes('cart')) return 'Cartão';
  return value ? text(value, 80) : 'Não informado';
}

function orderIdOf(order = {}) {
  return text(order?._id || order?.id || order?.orderId || order?.pedidoId, 120);
}

function orderStatusOf(order = {}) {
  return text(order?.status || order?.statusLabel || order?.paymentStatus, 120).toLowerCase();
}

function isOrderResolved(order = {}) {
  const status = orderStatusOf(order);
  const paymentStatus = text(order?.paymentStatus || order?.payment?.status, 120).toLowerCase();
  const combined = `${status} ${paymentStatus}`;

  return [
    'cancelado', 'cancelled', 'canceled',
    'entregue', 'delivered',
    'enviado', 'shipped',
    'faturado', 'invoiced',
    'concluido', 'concluído', 'completed',
    'reembolsado', 'refunded',
    'credit_rejected', 'reprovado', 'rejected'
  ].some((token) => combined.includes(token));
}

async function sendToAdminNumbers(waSendTextMessage, message) {
  const numbers = parseAlertNumbers();
  if (typeof waSendTextMessage !== 'function') {
    return { ok: false, skipped: true, reason: 'sender_unavailable', results: [] };
  }
  if (!numbers.length) {
    return { ok: false, skipped: true, reason: 'numbers_missing', results: [] };
  }

  const results = [];
  for (const number of numbers) {
    try {
      const response = await waSendTextMessage({ number, text: message });
      results.push({ number, ok: true, response });
    } catch (error) {
      results.push({ number, ok: false, error: text(error?.message || error, 1000) });
    }
  }

  return {
    ok: results.some((item) => item.ok),
    results
  };
}

export async function sendNewOrderWhatsappAlert({
  Order,
  waSendTextMessage,
  order,
  reminder = false
} = {}) {
  if (!Order || !order) return { ok: false, skipped: true, reason: 'order_missing' };
  if (isOrderResolved(order)) return { ok: true, skipped: true, reason: 'order_resolved' };

  const orderId = orderIdOf(order);
  if (!orderId) return { ok: false, skipped: true, reason: 'order_id_missing' };

  const shortId = orderId.slice(-8).toUpperCase();
  const customerName = text(order.customerName || order.customer?.name || 'Cliente', 160);
  const total = Number(order.total ?? order.totals?.grandTotal ?? 0);
  const method = paymentLabel(order.paymentMethod || order.payment?.method || order.totals?.paymentMethod);
  const status = text(order.statusLabel || order.status || 'Pedido recebido', 160);

  const message = reminder
    ? [
        '⏰ *LEMBRETE — PEDIDO PENDENTE*',
        '',
        `Pedido: #${shortId}`,
        `Cliente: ${customerName}`,
        `Valor: ${moneyBR(total)}`,
        `Pagamento: ${method}`,
        `Status: ${status}`,
        '',
        'Este pedido continua pendente no sistema. Confira no painel da Ariana Móveis.'
      ].join('\n')
    : [
        '🛒 *NOVO PEDIDO — ARIANA MÓVEIS*',
        '',
        `Pedido: #${shortId}`,
        `Cliente: ${customerName}`,
        `Valor: ${moneyBR(total)}`,
        `Pagamento: ${method}`,
        `Status: ${status}`,
        '',
        'Confira os detalhes no painel administrativo.'
      ].join('\n');

  const sent = await sendToAdminNumbers(waSendTextMessage, message);
  const now = new Date();

  if (sent.ok) {
    const set = {
      'whatsappNotification.adminNewOrder.lastSentAt': now,
      'whatsappNotification.adminNewOrder.lastType': reminder ? 'reminder' : 'new_order',
      'whatsappNotification.adminNewOrder.lastError': ''
    };
    if (!reminder) set['whatsappNotification.adminNewOrder.firstSentAt'] = now;

    const update = { $set: set };
    if (reminder) update.$inc = { 'whatsappNotification.adminNewOrder.reminderCount': 1 };

    await Order.updateOne({ _id: order._id || orderId }, update).catch(() => null);
  } else {
    await Order.updateOne(
      { _id: order._id || orderId },
      {
        $set: {
          'whatsappNotification.adminNewOrder.lastAttemptAt': now,
          'whatsappNotification.adminNewOrder.lastError': sent.results?.find((item) => !item.ok)?.error || sent.reason || 'send_failed'
        }
      }
    ).catch(() => null);
  }

  return sent;
}

export async function sendCreditAnalysisWhatsappAlert({
  mongoose,
  waSendTextMessage,
  analysis,
  reminder = false
} = {}) {
  if (!mongoose || !analysis) return { ok: false, skipped: true, reason: 'analysis_missing' };

  const status = text(analysis.status, 80).toUpperCase();
  if (!['PENDENTE_ANALISE', 'AGUARDANDO_DOCUMENTOS', 'EM_ANALISE'].includes(status)) {
    return { ok: true, skipped: true, reason: 'analysis_not_pending' };
  }

  const Analysis = mongoose.models?.CrediarioAnalysis;
  if (!Analysis) return { ok: false, skipped: true, reason: 'analysis_model_missing' };

  const analysisId = text(analysis.analysisId || analysis._id, 120);
  const orderId = text(analysis.orderId, 120);
  const customerName = text(analysis.customer?.name || 'Cliente', 160);
  const value = Number(analysis.baseAmountCents || analysis.financedAmountCents || 0) / 100;
  const shortOrder = orderId ? orderId.slice(-8).toUpperCase() : '';
  const statusLabel = {
    PENDENTE_ANALISE: 'Pendente de análise',
    AGUARDANDO_DOCUMENTOS: 'Aguardando documentos',
    EM_ANALISE: 'Em análise'
  }[status] || status;

  const message = reminder
    ? [
        '⏰ *LEMBRETE — ANÁLISE DE CRÉDITO PENDENTE*',
        '',
        shortOrder ? `Pedido: #${shortOrder}` : `Análise: ${analysisId}`,
        `Cliente: ${customerName}`,
        value > 0 ? `Valor: ${moneyBR(value)}` : '',
        `Status: ${statusLabel}`,
        '',
        'Esta solicitação continua pendente. Confira no Crediário Ariana.'
      ].filter(Boolean).join('\n')
    : [
        '🔎 *NOVA ANÁLISE DE CRÉDITO — ARIANA MÓVEIS*',
        '',
        shortOrder ? `Pedido: #${shortOrder}` : `Análise: ${analysisId}`,
        `Cliente: ${customerName}`,
        value > 0 ? `Valor: ${moneyBR(value)}` : '',
        `Status: ${statusLabel}`,
        '',
        'Há uma solicitação de crédito aguardando acompanhamento no painel.'
      ].filter(Boolean).join('\n');

  const sent = await sendToAdminNumbers(waSendTextMessage, message);
  const now = new Date();
  const query = analysis._id ? { _id: analysis._id } : { analysisId };

  if (sent.ok) {
    const set = {
      'adminWhatsapp.lastSentAt': now,
      'adminWhatsapp.lastType': reminder ? 'reminder' : 'analysis_requested',
      'adminWhatsapp.lastError': ''
    };
    if (!reminder) set['adminWhatsapp.firstSentAt'] = now;

    const update = { $set: set };
    if (reminder) update.$inc = { 'adminWhatsapp.reminderCount': 1 };
    await Analysis.updateOne(query, update).catch(() => null);
  } else {
    await Analysis.updateOne(query, {
      $set: {
        'adminWhatsapp.lastAttemptAt': now,
        'adminWhatsapp.lastError': sent.results?.find((item) => !item.ok)?.error || sent.reason || 'send_failed'
      }
    }).catch(() => null);
  }

  return sent;
}

export async function runAdminWhatsappReminderSweep({
  Order,
  mongoose,
  waSendTextMessage
} = {}) {
  if (!Order || !mongoose || mongoose.connection?.readyState !== 1) {
    return { ok: false, skipped: true, reason: 'database_not_ready' };
  }

  const numbers = parseAlertNumbers();
  if (!numbers.length) return { ok: false, skipped: true, reason: 'numbers_missing' };

  const reminderHours = Math.max(1, Number(process.env.ADMIN_WHATSAPP_REMINDER_HOURS || 12));
  const reminderCutoff = new Date(Date.now() - reminderHours * 60 * 60 * 1000);
  const backfillSince = new Date(Date.now() - 6 * 60 * 60 * 1000);

  let newOrderAlerts = 0;
  let orderReminders = 0;
  let analysisAlerts = 0;
  let analysisReminders = 0;

  const recentOrders = await Order.find({
    createdAt: { $gte: backfillSince },
    'whatsappNotification.adminNewOrder.firstSentAt': { $exists: false }
  }).sort({ createdAt: -1 }).limit(50).lean();

  for (const order of recentOrders) {
    if (isOrderResolved(order)) continue;
    const sent = await sendNewOrderWhatsappAlert({ Order, waSendTextMessage, order, reminder: false });
    if (sent?.ok) newOrderAlerts += 1;
  }

  const pendingOrders = await Order.find({
    'whatsappNotification.adminNewOrder.firstSentAt': { $exists: true },
    'whatsappNotification.adminNewOrder.lastSentAt': { $lte: reminderCutoff }
  }).sort({ 'whatsappNotification.adminNewOrder.lastSentAt': 1 }).limit(100).lean();

  for (const order of pendingOrders) {
    if (isOrderResolved(order)) continue;
    const sent = await sendNewOrderWhatsappAlert({ Order, waSendTextMessage, order, reminder: true });
    if (sent?.ok) orderReminders += 1;
  }

  const Analysis = mongoose.models?.CrediarioAnalysis;
  if (Analysis) {
    const pendingStatuses = ['PENDENTE_ANALISE', 'AGUARDANDO_DOCUMENTOS', 'EM_ANALISE'];

    const recentAnalyses = await Analysis.find({
      createdAt: { $gte: backfillSince },
      status: { $in: pendingStatuses },
      'adminWhatsapp.firstSentAt': { $exists: false }
    }).sort({ createdAt: -1 }).limit(50).lean();

    for (const analysis of recentAnalyses) {
      const sent = await sendCreditAnalysisWhatsappAlert({
        mongoose,
        waSendTextMessage,
        analysis,
        reminder: false
      });
      if (sent?.ok) analysisAlerts += 1;
    }

    const pendingAnalyses = await Analysis.find({
      status: { $in: pendingStatuses },
      'adminWhatsapp.firstSentAt': { $exists: true },
      'adminWhatsapp.lastSentAt': { $lte: reminderCutoff }
    }).sort({ 'adminWhatsapp.lastSentAt': 1 }).limit(100).lean();

    for (const analysis of pendingAnalyses) {
      const sent = await sendCreditAnalysisWhatsappAlert({
        mongoose,
        waSendTextMessage,
        analysis,
        reminder: true
      });
      if (sent?.ok) analysisReminders += 1;
    }
  }

  return {
    ok: true,
    newOrderAlerts,
    orderReminders,
    analysisAlerts,
    analysisReminders,
    reminderHours
  };
}

export function startAdminWhatsappReminderWorker({
  Order,
  mongoose,
  waSendTextMessage
} = {}) {
  const sweepMinutes = Math.max(5, Number(process.env.ADMIN_WHATSAPP_REMINDER_SWEEP_MINUTES || 15));
  const sweepMs = sweepMinutes * 60 * 1000;

  const run = async () => {
    try {
      const result = await runAdminWhatsappReminderSweep({ Order, mongoose, waSendTextMessage });
      if (result?.ok && (result.newOrderAlerts || result.orderReminders || result.analysisAlerts || result.analysisReminders)) {
        console.log('[admin-whatsapp-reminders]', result);
      }
    } catch (error) {
      console.error('[admin-whatsapp-reminders]', error?.message || error);
    }
  };

  const initialTimer = setTimeout(run, 45 * 1000);
  initialTimer.unref?.();

  const interval = setInterval(run, sweepMs);
  interval.unref?.();

  console.log(`📲 Lembretes administrativos WhatsApp ativos: a cada ${process.env.ADMIN_WHATSAPP_REMINDER_HOURS || 12}h (varredura ${sweepMinutes} min).`);

  return { initialTimer, interval };
}
