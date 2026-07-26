import crypto from 'crypto';
import { getCoraConfig, getCoraSafeStatus } from '../integrations/cora/coraConfig.js';
import { getCoraAccessToken, getCoraTokenCacheStatus } from '../integrations/cora/coraAuth.js';
import { buildCoraInstallmentPayload, issueCoraInstallmentBook } from '../integrations/cora/coraInstallmentService.js';
import { getCoraAuditModel, getCoraChargeModel } from '../integrations/cora/coraChargeModel.js';
import { calculateCrediarioPlan, moneyToCents, centsToMoney, CREDIARIO_DIVISORS } from '../services/crediarioEngine.js';

function safeError(error) {
  return {
    code: error?.code || 'CORA_ERROR',
    message: error?.message || 'Falha na integração Cora',
    providerStatus: error?.providerStatus || null,
    details: error?.details || null,
    requestId: error?.trace?.requestId || '',
    traceId: error?.trace?.traceId || ''
  };
}
function digits(value = '') { return String(value || '').replace(/\D/g, ''); }
function json(doc) { return typeof doc?.toObject === 'function' ? doc.toObject() : doc; }
function buildDirectInput(body = {}) {
  return {
    code: body.code || body.internalReference || body.reference,
    totalAmount: body.totalAmount ?? body.amount ?? body.total,
    installments: body.installments ?? body.parcelas,
    firstDueDate: body.firstDueDate ?? body.primeiroVencimento,
    dueDates: body.dueDates ?? body.vencimentos,
    dayOfMonth: body.dayOfMonth ?? body.diaVencimento,
    customer: body.customer || {
      name: body.customerName ?? body.nomeCliente,
      email: body.customerEmail ?? body.emailCliente,
      document: body.customerDocument ?? body.cpfCnpj,
      address: body.customerAddress ?? body.enderecoCliente
    },
    serviceName: body.serviceName || 'Compra Ariana Móveis',
    description: body.description || 'Carnê de pagamentos Ariana Móveis',
    paymentTerms: body.paymentTerms || {},
    notification: body.notification
  };
}
function statusFromInvoices(invoices = []) {
  if (!Array.isArray(invoices) || !invoices.length) return 'OPEN';
  const statuses = invoices.map((item) => String(item?.status || '').toUpperCase());
  if (statuses.every((s) => ['PAID', 'SETTLED'].includes(s))) return 'PAID';
  if (statuses.some((s) => ['PAID', 'SETTLED'].includes(s))) return 'PARTIALLY_PAID';
  if (statuses.every((s) => ['CANCELLED', 'CANCELED'].includes(s))) return 'CANCELLED';
  return 'OPEN';
}


function resolveCrediarioBaseCents(order = {}, body = {}) {
  const direct = Number(
    body.baseAmountCents ??
    order.crediario?.baseAmountCents ??
    order.totals?.creditBaseAmountCents ??
    order.totals?.cardTotalCents ??
    0
  );
  if (Number.isFinite(direct) && direct > 0) return Math.round(direct);

  const money = Number(
    body.baseAmount ??
    order.crediario?.baseAmount ??
    order.totals?.creditBaseAmount ??
    order.totals?.grandTotalOriginal ??
    order.cardTotal ??
    order.total ??
    0
  );
  return moneyToCents(money);
}

function buildDueDates(firstDueDate, count) {
  const first = new Date(`${String(firstDueDate || '').slice(0, 10)}T12:00:00`);
  if (Number.isNaN(first.getTime())) return [];
  const day = first.getDate();
  return Array.from({ length: count }, (_, index) => {
    const d = new Date(first.getFullYear(), first.getMonth() + index, 1, 12, 0, 0, 0);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, lastDay));
    return d.toISOString().slice(0, 10);
  });
}

export default function registerCoraRoutes(app, { adminRequired, authRequired, mongoose, Order } = {}) {
  if (!app) throw new Error('registerCoraRoutes: app é obrigatório.');
  if (typeof adminRequired !== 'function') throw new Error('registerCoraRoutes: adminRequired é obrigatório.');
  const paymentRequired = typeof authRequired === 'function' ? authRequired : adminRequired;
  const CoraCharge = mongoose ? getCoraChargeModel(mongoose) : null;
  const CoraAuditLog = mongoose ? getCoraAuditModel(mongoose) : null;

  async function saveTrace(chargeId, action, trace = {}) {
    if (!CoraAuditLog) return;
    await CoraAuditLog.create({
      chargeId: String(chargeId || ''), action,
      method: trace.method || '', url: trace.url || '', status: trace.status ?? null,
      durationMs: Number(trace.durationMs || 0), requestId: trace.requestId || '', traceId: trace.traceId || '',
      idempotencyKey: trace.idempotencyKey || '', requestHeaders: trace.requestHeaders || {},
      requestBody: trace.requestBody ?? null, responseHeaders: trace.responseHeaders || {},
      responseBody: trace.responseBody ?? null,
      error: trace.networkError ? { message: trace.networkError } : null
    });
  }


  function orderIdFrom(value = '') {
    return String(value || '').trim();
  }

  function normalizeChargeForOrder(chargeDoc = {}) {
    const charge = json(chargeDoc) || {};
    return {
      provider: 'cora',
      chargeId: String(charge._id || charge.id || ''),
      code: String(charge.code || ''),
      status: String(charge.status || 'OPEN'),
      installments: Number(charge.installments || 0),
      documentUrl: String(charge.documentUrl || ''),
      invoices: Array.isArray(charge.invoices) ? charge.invoices : [],
      providerRequestId: String(charge.providerRequestId || ''),
      providerTraceId: String(charge.providerTraceId || ''),
      firstDueDate: charge.requestPayload?.installment?.due_date?.dates?.[0] || null,
      updatedAt: new Date()
    };
  }

  async function findOrderRaw(orderId) {
    const id = orderIdFrom(orderId);
    if (!Order || !id) return null;
    const query = mongoose?.Types?.ObjectId?.isValid(id)
      ? { _id: new mongoose.Types.ObjectId(id) }
      : { $or: [{ orderId: id }, { code: id }, { number: id }, { externalId: id }] };
    return Order.collection.findOne(query);
  }

  function customerCanAccessOrder(order = {}, req = {}) {
    if (req.admin?.admin === true || String(req.auth?.role || '').toLowerCase() === 'admin') return true;
    const userId = String(req.user?._id || req.auth?.id || '').trim();
    if (!userId) return false;
    const candidates = [order.userId, order.customerId, order.clientId, order.user?._id, order.customer?._id]
      .map((value) => String(value || '').trim())
      .filter(Boolean);
    return candidates.includes(userId);
  }

  async function updateOrderCora(orderId, chargeDoc, extra = {}) {
    if (!Order || !orderId) return null;
    const id = orderIdFrom(orderId);
    const query = mongoose?.Types?.ObjectId?.isValid(id)
      ? { _id: new mongoose.Types.ObjectId(id) }
      : { $or: [{ orderId: id }, { code: id }, { number: id }, { externalId: id }] };
    const crediario = normalizeChargeForOrder(chargeDoc);
    const paidStatuses = ['PAID', 'SETTLED'];
    const finalPaid = paidStatuses.includes(String(crediario.status || '').toUpperCase());
    const set = {
      paymentMethod: 'crediario_ariana',
      payment_method: 'crediario_ariana',
      paymentStatus: finalPaid ? 'PAID' : 'AWAITING_PAYMENT',
      status: finalPaid ? 'paid' : 'pending_payment',
      statusLabel: finalPaid ? 'Pago' : 'Aguardando pagamento',
      'payment.provider': 'cora',
      'payment.method': 'crediario_ariana',
      'payment.status': crediario.status,
      'payment.chargeId': crediario.chargeId,
      'payment.documentUrl': crediario.documentUrl,
      crediario: { ...crediario, ...(extra.crediario || {}) },
      updatedAt: new Date(),
      ...extra.set
    };
    await Order.collection.updateOne(query, { $set: set });
    return Order.collection.findOne(query);
  }

  function invoiceMatchesEvent(invoice = {}, event = {}) {
    const eventData = event.data || event.invoice || event;
    const ids = [eventData.id, eventData.invoice_id, eventData.invoiceId, event.id]
      .map((v) => String(v || '').trim()).filter(Boolean);
    const codes = [eventData.code, eventData.invoice_code, eventData.external_id]
      .map((v) => String(v || '').trim()).filter(Boolean);
    const invoiceIds = [invoice.id, invoice.invoice_id, invoice.invoiceId]
      .map((v) => String(v || '').trim()).filter(Boolean);
    const invoiceCodes = [invoice.code, invoice.external_id]
      .map((v) => String(v || '').trim()).filter(Boolean);
    return ids.some((id) => invoiceIds.includes(id)) || codes.some((code) => invoiceCodes.includes(code));
  }

  async function executeEmission(charge, input, action = 'ISSUE_INSTALLMENT_BOOK') {
    charge.attempts = Number(charge.attempts || 0) + 1;
    charge.lastAttemptAt = new Date();
    charge.status = 'PROCESSING';
    await charge.save();
    try {
      const result = await issueCoraInstallmentBook(input, {
        idempotencyKey: charge.idempotencyKey,
        onTrace: (trace) => saveTrace(charge._id, action, trace)
      });
      const response = result.response || {};
      charge.status = statusFromInvoices(response.result || []);
      charge.documentUrl = String(response.document_url || response.documentUrl || '');
      charge.invoices = Array.isArray(response.result) ? response.result : [];
      charge.providerResponse = response;
      charge.providerRequestId = result?.trace?.requestId || '';
      charge.providerTraceId = result?.trace?.traceId || '';
      charge.error = null;
      charge.nextCheckAt = null;
      charge.resolvedAt = new Date();
      await charge.save();
      return { ok: true, charge };
    } catch (error) {
      const providerStatus = Number(error?.providerStatus || 0);
      const uncertain = providerStatus === 504 || error?.code === 'CORA_NETWORK_ERROR';
      charge.status = uncertain ? 'PENDING_CONFIRMATION' : 'FAILED';
      charge.error = safeError(error);
      charge.providerRequestId = error?.trace?.requestId || '';
      charge.providerTraceId = error?.trace?.traceId || '';
      charge.nextCheckAt = uncertain ? new Date(Date.now() + Number(process.env.CORA_PENDING_RETRY_MS || 5 * 60 * 1000)) : null;
      await charge.save();
      error.charge = charge;
      throw error;
    }
  }

  app.get('/api/admin/cora/status', adminRequired, async (_req, res) => {
    const config = getCoraSafeStatus();
    if (!config.enabled || !config.clientIdConfigured || !config.certificateConfigured || !config.privateKeyConfigured) {
      return res.status(503).json({ ok: false, authenticated: false, config, token: getCoraTokenCacheStatus(), error: 'Integração Cora ainda não está completamente configurada.' });
    }
    try {
      await getCoraAccessToken({ forceRefresh: true });
      return res.json({ ok: true, authenticated: true, config, token: getCoraTokenCacheStatus() });
    } catch (error) {
      return res.status(Number(error.statusCode || 502)).json({ ok: false, authenticated: false, config, token: getCoraTokenCacheStatus(), error: safeError(error) });
    }
  });


  // Fase 6.3: simulação oficial no backend. O navegador nunca define o valor financiado.
  app.post('/api/payments/crediario/simular', paymentRequired, async (req, res) => {
    try {
      const orderId = orderIdFrom(req.body?.orderId || req.body?.pedidoId || '');
      let order = null;
      if (orderId) {
        order = await findOrderRaw(orderId);
        if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado.' });
        if (!customerCanAccessOrder(order, req)) return res.status(403).json({ ok: false, error: 'Este pedido não pertence ao usuário autenticado.' });
      }
      const installmentCount = Number(req.body?.installments ?? req.body?.parcelas ?? order?.crediario?.installments ?? 1);
      const baseAmountCents = resolveCrediarioBaseCents(order || {}, req.body || {});
      const plan = calculateCrediarioPlan({ baseAmountCents, installmentCount });
      const firstDueDate = req.body?.firstDueDate || req.body?.primeiroVencimento || order?.crediario?.firstDueDate || '';
      const dueDates = buildDueDates(firstDueDate, plan.installmentCount);
      return res.json({
        ok: true,
        rule: 'ARIANA_CREDIARIO_V1',
        divisors: CREDIARIO_DIVISORS,
        ...plan,
        baseAmount: centsToMoney(plan.baseAmountCents),
        financedAmount: centsToMoney(plan.financedAmountCents),
        installments: plan.installments.map((item, index) => ({
          ...item,
          amount: centsToMoney(item.originalAmountCents),
          dueDate: dueDates[index] || null
        }))
      });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message || 'Falha ao simular o crediário.' });
    }
  });

  // Fase 6.2: emissão pelo fluxo real da venda, sem Postman.
  app.post('/api/payments/cora/carne', paymentRequired, async (req, res) => {
    if (!CoraCharge) return res.status(500).json({ ok: false, error: 'mongoose não registrado na rota Cora.' });
    if (!Order) return res.status(500).json({ ok: false, error: 'Modelo Order não registrado na rota Cora.' });

    let charge;
    try {
      const orderId = orderIdFrom(req.body?.orderId || req.body?.pedidoId || req.body?.externalId);
      if (!orderId) return res.status(400).json({ ok: false, error: 'orderId é obrigatório.' });

      const order = await findOrderRaw(orderId);
      if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado.' });
      if (!customerCanAccessOrder(order, req)) return res.status(403).json({ ok: false, error: 'Este pedido não pertence ao usuário autenticado.' });

      const installmentCount = Number(req.body?.installments ?? req.body?.parcelas ?? order.crediario?.installments ?? 1);
      const baseAmountCents = resolveCrediarioBaseCents(order, req.body || {});
      const plan = calculateCrediarioPlan({ baseAmountCents, installmentCount });
      const requestedAmount = centsToMoney(plan.financedAmountCents);
      const firstDueDate = req.body?.firstDueDate || req.body?.primeiroVencimento || order.crediario?.firstDueDate || '';
      const dueDates = buildDueDates(firstDueDate, plan.installmentCount);

      const customer = req.body?.customer || order.customer || order.client || order.user || {};
      const input = buildDirectInput({
        ...req.body,
        code: req.body?.code || `ARIANA-${orderId}`.slice(0, 120),
        internalReference: orderId,
        totalAmount: requestedAmount,
        installments: plan.installmentCount,
        dueDates: dueDates.length ? dueDates : req.body?.dueDates,
        customer
      });
      const payload = buildCoraInstallmentPayload(input);
      const config = getCoraConfig();
      const internalReference = orderId;
      const idempotencyKey = String(req.headers['idempotency-key'] || req.body?.idempotencyKey || `order:${orderId}:cora:v1`);

      const duplicate = await CoraCharge.findOne({
        $or: [
          { idempotencyKey },
          { orderId, kind: 'INSTALLMENT_BOOK', status: { $in: ['PROCESSING', 'PENDING_CONFIRMATION', 'OPEN', 'PARTIALLY_PAID', 'PAID'] } }
        ]
      }).sort({ createdAt: -1 });

      if (duplicate && req.body?.forceNew !== true) {
        await updateOrderCora(orderId, duplicate);
        return res.status(200).json({ ok: true, reused: true, carne: duplicate, charge: duplicate });
      }

      charge = await CoraCharge.create({
        orderId,
        source: 'CHECKOUT',
        internalReference,
        code: payload.code,
        environment: config.environment,
        idempotencyKey,
        status: 'PROCESSING',
        totalAmountCents: payload.service.amount,
        installments: payload.installment.number_of,
        customer: payload.customer,
        requestPayload: payload,
        createdBy: String(req.user?._id || req.auth?.id || req.admin?.id || '')
      });

      await updateOrderCora(orderId, charge, {
        set: {
          paymentStatus: 'PROCESSING',
          status: 'pending_payment',
          total: requestedAmount,
          'totals.creditBaseAmount': centsToMoney(plan.baseAmountCents),
          'totals.creditBaseAmountCents': plan.baseAmountCents,
          'totals.financedAmount': requestedAmount,
          'totals.financedAmountCents': plan.financedAmountCents,
          'crediario.baseAmountCents': plan.baseAmountCents,
          'crediario.financedAmountCents': plan.financedAmountCents,
          'crediario.installmentDivisor': plan.divisor,
          'crediario.installmentCount': plan.installmentCount,
          'crediario.installmentPlan': plan.installments.map((item, index) => ({ ...item, dueDate: dueDates[index] || null, status: 'OPEN' }))
        }
      });
      const result = await executeEmission(charge, input, 'CHECKOUT_ISSUE_INSTALLMENT_BOOK');
      const updatedOrder = await updateOrderCora(orderId, result.charge);
      return res.status(201).json({ ok: true, carne: result.charge, charge: result.charge, order: updatedOrder });
    } catch (error) {
      const uncertain = Number(error?.providerStatus || 0) === 504 || error?.code === 'CORA_NETWORK_ERROR';
      const orderId = orderIdFrom(req.body?.orderId || req.body?.pedidoId || req.body?.externalId);
      if (orderId && (error?.charge || charge)) {
        await updateOrderCora(orderId, error?.charge || charge, {
          set: { paymentStatus: uncertain ? 'AWAITING_CONFIRMATION' : 'PAYMENT_ERROR', status: 'pending_payment' }
        }).catch(() => null);
      }
      return res.status(uncertain ? 202 : Number(error.statusCode || 500)).json({
        ok: false,
        pendingConfirmation: uncertain,
        message: uncertain ? 'A Cora não confirmou a resposta. O pedido permaneceu aguardando confirmação e não será emitido novamente com outra chave.' : undefined,
        carne: error?.charge || charge || null,
        charge: error?.charge || charge || null,
        error: safeError(error)
      });
    }
  });

  app.post('/api/admin/cora/carnes/preview', adminRequired, async (req, res) => {
    try { return res.json({ ok: true, payload: buildCoraInstallmentPayload(buildDirectInput(req.body || {})) }); }
    catch (error) { return res.status(Number(error.statusCode || 400)).json({ ok: false, error: safeError(error) }); }
  });

  app.post('/api/admin/cora/carnes', adminRequired, async (req, res) => {
    if (!CoraCharge) return res.status(500).json({ ok: false, error: 'mongoose não registrado na rota Cora.' });
    let charge;
    try {
      const input = buildDirectInput(req.body || {});
      const payload = buildCoraInstallmentPayload(input);
      const config = getCoraConfig();
      const internalReference = String(req.body?.internalReference || req.body?.reference || payload.code || '').trim().slice(0, 120);
      const idempotencyKey = String(req.headers['idempotency-key'] || req.body?.idempotencyKey || crypto.randomUUID());

      const duplicate = await CoraCharge.findOne({
        $or: [{ idempotencyKey }, ...(internalReference ? [{ internalReference, kind: 'INSTALLMENT_BOOK', status: { $in: ['PROCESSING', 'PENDING_CONFIRMATION', 'OPEN', 'PARTIALLY_PAID', 'PAID'] } }] : [])]
      }).sort({ createdAt: -1 });
      if (duplicate && req.body?.forceNew !== true) {
        return res.status(409).json({ ok: false, error: 'Já existe uma emissão Cora ativa ou pendente com esta referência/chave.', charge: duplicate });
      }

      charge = await CoraCharge.create({
        source: 'DIRECT', internalReference, code: payload.code, environment: config.environment,
        idempotencyKey, status: 'PROCESSING', totalAmountCents: payload.service.amount,
        installments: payload.installment.number_of, customer: payload.customer,
        requestPayload: payload, createdBy: String(req.admin?.id || req.auth?.id || req.user?._id || '')
      });
      const result = await executeEmission(charge, input);
      return res.status(201).json(result);
    } catch (error) {
      if (error?.code === 11000) return res.status(409).json({ ok: false, error: 'Requisição duplicada detectada pela chave de idempotência.' });
      const uncertain = Number(error?.providerStatus || 0) === 504 || error?.code === 'CORA_NETWORK_ERROR';
      return res.status(uncertain ? 202 : Number(error.statusCode || 500)).json({
        ok: false,
        pendingConfirmation: uncertain,
        message: uncertain ? 'A Cora não confirmou a resposta. A emissão foi mantida como pendente e não deve ser repetida com outra chave.' : undefined,
        charge: error?.charge || charge || null,
        error: safeError(error)
      });
    }
  });

  app.post('/api/admin/cora/carnes/:chargeId/retry', adminRequired, async (req, res) => {
    if (!CoraCharge) return res.status(500).json({ ok: false, error: 'mongoose não registrado na rota Cora.' });
    const charge = await CoraCharge.findById(req.params.chargeId);
    if (!charge) return res.status(404).json({ ok: false, error: 'Carnê Cora não encontrado.' });
    if (!['PENDING_CONFIRMATION', 'FAILED'].includes(String(charge.status))) {
      return res.status(409).json({ ok: false, error: `O carnê está com status ${charge.status} e não precisa de nova tentativa.`, charge });
    }
    try {
      const input = buildDirectInput({ ...json(charge.requestPayload), customer: charge.requestPayload?.customer, totalAmount: charge.totalAmountCents, installments: charge.installments, code: charge.code, dueDates: charge.requestPayload?.installment?.due_date?.dates, dayOfMonth: charge.requestPayload?.installment?.due_date?.day_of_month, serviceName: charge.requestPayload?.service?.name, description: charge.requestPayload?.service?.description, paymentTerms: charge.requestPayload?.payment_terms });
      const result = await executeEmission(charge, input, 'RETRY_SAME_IDEMPOTENCY_KEY');
      return res.json(result);
    } catch (error) {
      const uncertain = Number(error?.providerStatus || 0) === 504 || error?.code === 'CORA_NETWORK_ERROR';
      return res.status(uncertain ? 202 : Number(error.statusCode || 500)).json({ ok: false, pendingConfirmation: uncertain, charge: error?.charge || charge, error: safeError(error) });
    }
  });

  app.get('/api/admin/cora/carnes', adminRequired, async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 30)));
    const query = {};
    if (req.query.status) query.status = String(req.query.status);
    if (req.query.customerDocument) query['customer.document.identity'] = digits(req.query.customerDocument);
    if (req.query.reference) query.internalReference = String(req.query.reference);
    const charges = await CoraCharge.find(query).sort({ createdAt: -1 }).limit(limit);
    return res.json({ ok: true, count: charges.length, charges });
  });


  app.post('/api/admin/cora/carnes/reconciliar-local', adminRequired, async (req, res) => {
    if (!CoraCharge) return res.status(500).json({ ok: false, error: 'mongoose não registrado na rota Cora.' });
    try {
      const environment = String(req.body?.environment || getCoraConfig().environment || '').trim();
      const limit = Math.max(1, Math.min(Number(req.body?.limit || 100), 500));
      const filter = {
        environment,
        status: { $in: ['OPEN', 'PARTIALLY_PAID', 'PENDING_CONFIRMATION', 'PROCESSING'] }
      };

      const rows = await CoraCharge.find(filter).sort({ updatedAt: 1 }).limit(limit);
      const resultados = [];

      for (const charge of rows) {
        const anterior = String(charge.status || '');
        const calculado = statusFromInvoices(Array.isArray(charge.invoices) ? charge.invoices : []);
        if (Array.isArray(charge.invoices) && charge.invoices.length && calculado !== anterior) {
          charge.status = calculado;
          charge.resolvedAt = ['PAID', 'CANCELLED'].includes(calculado) ? new Date() : charge.resolvedAt;
          await charge.save();
          if (charge.orderId) await updateOrderCora(charge.orderId, charge).catch(() => null);
        }
        resultados.push({
          id: String(charge._id),
          code: charge.code || '',
          environment: charge.environment || '',
          statusAnterior: anterior,
          statusAtual: String(charge.status || ''),
          alterado: anterior !== String(charge.status || '')
        });
      }

      return res.json({
        ok: true,
        mode: 'local_webhook_reconciliation',
        note: 'Esta rotina reconcilia o status salvo com as parcelas já recebidas por emissão/webhook. Não substitui uma consulta externa à API da Cora.',
        total: resultados.length,
        alterados: resultados.filter((item) => item.alterado).length,
        resultados
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao reconciliar carnês Cora.' });
    }
  });

  app.get('/api/admin/cora/carnes/:chargeId/logs', adminRequired, async (req, res) => {
    const logs = await CoraAuditLog.find({ chargeId: String(req.params.chargeId) }).sort({ createdAt: 1 }).limit(100);
    return res.json({ ok: true, count: logs.length, logs });
  });

  app.get('/api/admin/cora/carnes/:chargeId', adminRequired, async (req, res) => {
    const charge = await CoraCharge.findById(req.params.chargeId);
    if (!charge) return res.status(404).json({ ok: false, error: 'Carnê Cora não encontrado.' });
    return res.json({ ok: true, charge });
  });

  // Webhook preparado. Configure CORA_WEBHOOK_SECRET quando a Cora fornecer o segredo/assinatura.
  app.post('/api/webhooks/cora', async (req, res) => {
    try {
      const event = req.body || {};
      const secret = String(process.env.CORA_WEBHOOK_SECRET || '');
      const received = String(req.headers['x-webhook-signature'] || req.headers['x-cora-signature'] || '');
      if (secret && received) {
        const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(event)).digest('hex');
        const a = Buffer.from(received); const b = Buffer.from(expected);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ ok: false, error: 'Assinatura inválida.' });
      }
      const code = String(event.code || event.invoice?.code || event.data?.code || '');
      const providerId = String(event.id || event.invoice?.id || event.data?.id || '');
      const charge = await CoraCharge.findOne({ $or: [{ code }, { 'invoices.id': providerId }, { 'invoices.invoice_id': providerId }] }).sort({ createdAt: -1 });
      if (charge) {
        charge.webhookEvents.push({ receivedAt: new Date(), event });
        const eventData = event.data || event.invoice || event;
        const incomingStatus = String(eventData.status || event.status || '').toUpperCase();
        const invoices = Array.isArray(charge.invoices) ? charge.invoices.map((item) => ({ ...(item || {}) })) : [];
        const index = invoices.findIndex((item) => invoiceMatchesEvent(item, event));
        if (index >= 0 && incomingStatus) {
          invoices[index] = {
            ...invoices[index],
            status: incomingStatus,
            paid_at: eventData.paid_at || eventData.paidAt || invoices[index].paid_at || null,
            updated_at: eventData.updated_at || eventData.updatedAt || new Date().toISOString()
          };
          charge.invoices = invoices;
          charge.markModified('invoices');
        }
        charge.status = statusFromInvoices(charge.invoices);
        if (['CANCELLED', 'CANCELED'].includes(incomingStatus) && index < 0) charge.status = 'CANCELLED';
        if (['PAID', 'SETTLED'].includes(incomingStatus) && index < 0 && charge.invoices.length === 1) {
          charge.invoices[0] = { ...charge.invoices[0], status: incomingStatus };
          charge.markModified('invoices');
          charge.status = 'PAID';
        }
        charge.resolvedAt = ['PAID', 'CANCELLED'].includes(charge.status) ? new Date() : charge.resolvedAt;
        await charge.save();
        if (charge.orderId) await updateOrderCora(charge.orderId, charge);
      }
      if (CoraAuditLog) await CoraAuditLog.create({ chargeId: charge ? String(charge._id) : '', action: 'WEBHOOK_RECEIVED', method: 'POST', url: '/api/webhooks/cora', requestHeaders: {}, requestBody: event, responseBody: { matched: Boolean(charge) }, status: 200 });
      return res.json({ ok: true, matched: Boolean(charge) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: safeError(error) });
    }
  });
}
