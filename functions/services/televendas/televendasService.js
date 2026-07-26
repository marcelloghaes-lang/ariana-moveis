import { createPaymentGatewayService } from './paymentGatewayService.js';

const STATUS_LABELS = {
  rascunho: 'Rascunho',
  link_gerado: 'Link gerado',
  cliente_acessou: 'Cliente acessou',
  aguardando_pagamento: 'Aguardando pagamento',
  pagamento_enviado: 'Pagamento enviado',
  em_analise: 'Pagamento em análise',
  aprovado: 'Pagamento aprovado',
  recusado: 'Pagamento recusado',
  cancelado: 'Pedido cancelado',
  expedido: 'Pedido expedido',
  entregue: 'Pedido entregue'
};

const ALLOWED = new Set(Object.keys(STATUS_LABELS));

const clean = (value = '', max = 500) =>
  String(value ?? '').trim().slice(0, max);

const digits = (value = '') =>
  String(value || '').replace(/\D/g, '');

const money = (value = 0) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const array = value => Array.isArray(value) ? value : [];

function error(message, statusCode = 400, code = '') {
  const exception = new Error(message);
  exception.statusCode = statusCode;
  exception.code = code;
  return exception;
}

function operator(value = {}) {
  return {
    id: String(value.id || value._id || value.sub || ''),
    name: clean(value.name || value.email || 'Atendente', 140),
    email: clean(value.email || '', 160)
  };
}

function normalizeItems(items) {
  if (!Array.isArray(items) || !items.length) {
    throw error('Adicione pelo menos um produto.', 400, 'ITEMS_REQUIRED');
  }

  return items.map((item, index) => {
    const qty = Math.max(1, Number(item.qty || item.quantity || 1));
    const unitPrice = money(item.unitPrice ?? item.price ?? 0);

    if (!clean(item.name)) {
      throw error(`Produto inválido na posição ${index + 1}.`);
    }
    if (unitPrice <= 0) {
      throw error(`Preço inválido em ${item.name}.`);
    }

    return {
      productId: clean(item.productId || item.id || item._id || '', 120),
      sellerId: clean(item.sellerId || '', 120),
      name: clean(item.name, 220),
      sku: clean(item.sku || '', 120),
      qty,
      unitPrice,
      totalPrice: money(unitPrice * qty),
      sellerBaseUnitPrice: money(item.sellerBaseUnitPrice ?? unitPrice),
      sellerBaseTotal: money((item.sellerBaseUnitPrice ?? unitPrice) * qty),
      cardMarkupUnit: money(item.cardMarkupUnit || 0),
      cardMarkupTotal: money(item.cardMarkupTotal || 0),
      image: clean(item.image || item.imageUrl || '', 1000)
    };
  });
}

function serialize(doc, toJSON) {
  return typeof toJSON === 'function'
    ? toJSON(doc)
    : (doc?.toObject ? doc.toObject() : doc);
}

function publicOrder(doc, toJSON) {
  const order = serialize(doc, toJSON);

  return {
    id: String(order._id || order.id),
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    customerPhone: order.customerPhone,
    items: order.items,
    subtotal: order.subtotal,
    shippingCost: order.shippingCost,
    montagemCost: order.montagemCost,
    total: order.total,
    currency: order.currency,
    status: order.status,
    statusLabel: order.statusLabel,
    shipping: order.shipping,
    payment: {
      method: order.payment?.method || '',
      installments: Number(order.payment?.installments || 1),
      installmentValue: Number(order.payment?.installmentValue || order.total),
      locked: order.payment?.locked === true,
      provider: order.payment?.provider || '',
      status: order.payment?.status || '',
      providerStatus: order.payment?.providerStatus || '',
      pix: order.payment?.pix
        ? {
            qrCode: order.payment.pix.qrCode || '',
            qrCodeBase64: order.payment.pix.qrCodeBase64 || '',
            ticketUrl: order.payment.pix.ticketUrl || '',
            expiresAt: order.payment.pix.expiresAt || null
          }
        : null
    },
    paymentLinkExpiresAt: order.paymentLinkExpiresAt || null
  };
}

export function createTelevendasService(context = {}) {
  const {
    Order,
    PaymentEvent,
    IntegrationAuditLog,
    axios,
    crypto,
    toJSON,
    redact,
    createAdminNotification,
    createSellerOrderNotifications,
    FRONTEND_URL,
    onTelevendasPaymentApproved
  } = context;

  const gateway = createPaymentGatewayService({
    axios,
    accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN || '',
    webhookSecret: process.env.MERCADO_PAGO_WEBHOOK_SECRET || process.env.MP_WEBHOOK_SECRET || '',
    notificationUrl: process.env.TELEVENDAS_MP_WEBHOOK_URL || '',
    secretKey: process.env.PAGARME_SECRET_KEY || ''
  });

  const token = () =>
    crypto?.randomBytes
      ? crypto.randomBytes(32).toString('hex')
      : `${Date.now()}_${Math.random().toString(36).slice(2)}`;

  async function audit(eventType, order, data = {}) {
    if (!IntegrationAuditLog) return;

    try {
      await IntegrationAuditLog.create({
        scope: 'televendas',
        eventType,
        orderId: String(order?._id || ''),
        status: order?.status || '',
        message: data.message || '',
        request: redact ? redact(data.request || null) : data.request || null,
        response: redact ? redact(data.response || null) : data.response || null,
        metadata: data.metadata || null
      });
    } catch (exception) {
      console.warn('[televendas/audit]', exception.message);
    }
  }

  async function recordPaymentEvent({
    provider,
    eventType,
    externalId,
    orderId,
    payload
  }) {
    if (!PaymentEvent) return null;

    const exists = externalId
      ? await PaymentEvent.findOne({
          provider,
          eventType,
          externalId,
          orderId: String(orderId || '')
        })
      : null;

    if (exists) return exists;

    return PaymentEvent.create({
      provider,
      eventType,
      externalId,
      orderId: String(orderId || ''),
      payload: redact ? redact(payload) : payload
    });
  }

  async function find(orderId) {
    let order = null;

    try {
      order = await Order.findById(orderId);
    } catch (_error) {}

    if (!order) {
      order = await Order.findOne({
        origin: 'televendas',
        'televendas.orderCode': clean(orderId, 100)
      });
    }

    if (!order || order.origin !== 'televendas') {
      throw error(
        'Pedido do Televendas não encontrado.',
        404,
        'ORDER_NOT_FOUND'
      );
    }

    return order;
  }

  async function findToken(value) {
    const order = await Order.findOne({
      origin: 'televendas',
      $or: [
        { paymentLinkToken: value },
        { 'payment.paymentLinkToken': value }
      ]
    });

    if (!order) {
      throw error(
        'Link de pagamento inválido.',
        404,
        'INVALID_LINK'
      );
    }

    const expires = order.paymentLinkExpiresAt || order.payment?.paymentLinkExpiresAt;
    if (expires && new Date(expires).getTime() < Date.now()) {
      throw error('Este link expirou.', 410, 'LINK_EXPIRED');
    }

    if (order.status === 'cancelado') {
      throw error(
        'Este pedido foi cancelado.',
        410,
        'ORDER_CANCELLED'
      );
    }

    return order;
  }

  async function notifyApproved(order) {
    const short = String(order._id).slice(-8).toUpperCase();

    if (createAdminNotification) {
      await createAdminNotification({
        type: 'televendas_payment_approved',
        title: '✅ Pagamento aprovado no Televendas',
        message: `Pedido #${short} de ${order.customerName} aprovado.`,
        relatedId: String(order._id),
        severity: 'success',
        metadata: {
          origin: 'televendas',
          total: order.total,
          provider: order.payment?.provider || ''
        }
      });
    }

    if (createSellerOrderNotifications) {
      await createSellerOrderNotifications(order, {
        type: 'seller_televendas_order_paid',
        title: '✅ Novo pedido pago',
        message: `Pedido #${short} aprovado e liberado.`,
        severity: 'success',
        origin: 'televendas'
      });
    }
  }

  async function executeApprovalHook(order) {
    if (typeof onTelevendasPaymentApproved !== 'function') {
      order.televendas = {
        ...(order.televendas || {}),
        postApproval: {
          status: 'pending_hook',
          message: 'Aguardando ligação do hook SIGE/Financeiro.',
          at: new Date()
        }
      };
      await order.save();
      return;
    }

    try {
      const result = await onTelevendasPaymentApproved(order);
      order.televendas = {
        ...(order.televendas || {}),
        postApproval: {
          status: 'completed',
          result: redact ? redact(result || null) : result || null,
          at: new Date()
        }
      };
      await order.save();
    } catch (exception) {
      order.televendas = {
        ...(order.televendas || {}),
        postApproval: {
          status: 'failed',
          error: clean(exception.message || 'Falha no pós-aprovação', 1000),
          at: new Date()
        }
      };
      await order.save();

      await audit('televendas.post_approval.failed', order, {
        message: exception.message || 'Falha no pós-aprovação'
      });
    }
  }

  async function applyPaymentResult(order, result = {}, source = 'gateway') {
    const normalizedStatus = clean(result.normalizedStatus || result.status || 'pending', 80);
    const previousStatus = order.status;

    order.payment = {
      ...(order.payment || {}),
      provider: clean(result.provider || order.payment?.provider || '', 80),
      method: clean(result.method || order.payment?.method || '', 40),
      externalId: clean(result.externalId || order.payment?.externalId || '', 300),
      chargeId: clean(result.chargeId || order.payment?.chargeId || '', 300),
      transactionId: clean(result.transactionId || order.payment?.transactionId || '', 300),
      providerStatus: clean(result.providerStatus || result.status || '', 100),
      lastWebhookAt: source === 'webhook' ? new Date() : order.payment?.lastWebhookAt,
      status: normalizedStatus
    };

    if (normalizedStatus === 'approved') {
      order.status = 'aprovado';
      order.statusLabel = STATUS_LABELS.aprovado;
      order.paymentStatus = 'approved';
      order.analysisStatus = order.payment.method === 'card'
        ? 'approved'
        : 'not_required';
      order.approvedAt = order.approvedAt || new Date();
      order.payment.approvedAt = order.approvedAt;
      order.payment.duplicateBlocked = true;
    } else if (normalizedStatus === 'rejected') {
      order.status = 'recusado';
      order.statusLabel = STATUS_LABELS.recusado;
      order.paymentStatus = 'rejected';
      order.analysisStatus = 'rejected';
      order.payment.rejectedAt = new Date();
      order.payment.duplicateBlocked = false;
    } else if (normalizedStatus === 'under_review') {
      order.status = 'em_analise';
      order.statusLabel = STATUS_LABELS.em_analise;
      order.paymentStatus = 'under_review';
      order.analysisStatus = 'pending';
      order.payment.duplicateBlocked = true;
    } else {
      order.status = order.payment.method === 'pix'
        ? 'aguardando_pagamento'
        : 'pagamento_enviado';
      order.statusLabel = STATUS_LABELS[order.status];
      order.paymentStatus = 'pending';
      order.payment.duplicateBlocked = true;
    }

    order.televendas = {
      ...(order.televendas || {}),
      timeline: [
        ...array(order.televendas?.timeline),
        {
          status: order.status,
          label: `${source}: ${order.statusLabel}`,
          at: new Date(),
          by: order.payment.provider || source
        }
      ]
    };

    await order.save();

    if (order.status === 'aprovado' && previousStatus !== 'aprovado') {
      await notifyApproved(order);
      await executeApprovalHook(order);
    }

    return order;
  }

  async function createOrder(payload = {}, actor = {}) {
    const items = normalizeItems(payload.items);
    const subtotal = money(items.reduce((sum, item) => sum + item.totalPrice, 0));
    const shippingCost = money(payload.shippingCost ?? payload.shipping?.price ?? 0);
    const montagemCost = money(payload.montagemCost ?? payload.warranty?.price ?? 0);
    const discount = Math.max(0, money(payload.discount || 0));
    const total = money(subtotal + shippingCost + montagemCost - discount);

    const installments = Math.max(
      1,
      Number(payload.installments || payload.payment?.installments || 1)
    );

    const order = await Order.create({
      userId: payload.userId || null,
      sellerIds: [...new Set(items.map(item => item.sellerId).filter(Boolean))],
      customerName: clean(payload.customerName || payload.customer?.name, 180),
      customerEmail: clean(payload.customerEmail || payload.customer?.email, 180).toLowerCase(),
      customerPhone: digits(payload.customerPhone || payload.customer?.phone),
      status: 'rascunho',
      statusLabel: STATUS_LABELS.rascunho,
      items,
      subtotal,
      shippingCost,
      montagemCost,
      total,
      currency: payload.currency || 'BRL',
      payment: {
        method: clean(payload.paymentMethod || payload.payment?.method, 40).toLowerCase(),
        installments,
        installmentValue: money(total / installments),
        locked: false,
        status: 'not_started'
      },
      shippingAddress: payload.shippingAddress || payload.customer?.address || null,
      shipping: payload.shipping || null,
      notes: clean(payload.notes || '', 2000),
      origin: 'televendas',
      salesChannel: 'inside_sales',
      operatorId: operator(actor).id,
      operatorName: operator(actor).name,
      operatorEmail: operator(actor).email,
      paymentStatus: 'not_started',
      analysisStatus: 'not_required',
      televendas: {
        orderCode: clean(payload.orderCode || '', 80),
        warranty: payload.warranty || null,
        discount,
        timeline: [{
          status: 'rascunho',
          label: STATUS_LABELS.rascunho,
          at: new Date(),
          by: operator(actor).name
        }]
      }
    });

    await audit('televendas.order.created', order, {
      message: 'Pedido criado',
      request: payload
    });

    return serialize(order, toJSON);
  }

  async function listOrders(query = {}) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 30)));
    const filter = { origin: 'televendas' };

    if (query.status && query.status !== 'all') {
      filter.status = clean(query.status, 60);
    }

    const search = clean(query.q || query.search || '', 140);
    if (search) {
      const expression = new RegExp(
        search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'i'
      );
      filter.$or = [
        { customerName: expression },
        { customerEmail: expression },
        { customerPhone: expression },
        { operatorName: expression }
      ];
    }

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Order.countDocuments(filter)
    ]);

    return {
      orders: orders.map(order => serialize(order, toJSON)),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  async function getOrder(id) {
    return serialize(await find(id), toJSON);
  }

  async function updateOrder(id, payload = {}, actor = {}) {
    const order = await find(id);

    if (['aprovado', 'cancelado', 'expedido', 'entregue'].includes(order.status)) {
      throw error('Este pedido está bloqueado.', 409, 'ORDER_LOCKED');
    }

    if (payload.customerName !== undefined) {
      order.customerName = clean(payload.customerName, 180);
    }
    if (payload.customerEmail !== undefined) {
      order.customerEmail = clean(payload.customerEmail, 180).toLowerCase();
    }
    if (payload.customerPhone !== undefined) {
      order.customerPhone = digits(payload.customerPhone);
    }
    if (payload.shippingAddress !== undefined) {
      order.shippingAddress = payload.shippingAddress;
    }
    if (payload.shipping !== undefined) {
      order.shipping = payload.shipping;
    }
    if (payload.notes !== undefined) {
      order.notes = clean(payload.notes, 2000);
    }
    if (Array.isArray(payload.items)) {
      order.items = normalizeItems(payload.items);
    }

    const items = normalizeItems(order.items);
    const subtotal = money(items.reduce((sum, item) => sum + item.totalPrice, 0));
    const shippingCost = money(payload.shippingCost ?? order.shippingCost);
    const montagemCost = money(payload.montagemCost ?? order.montagemCost);
    const discount = Math.max(
      0,
      money(payload.discount ?? order.televendas?.discount ?? 0)
    );

    order.items = items;
    order.subtotal = subtotal;
    order.shippingCost = shippingCost;
    order.montagemCost = montagemCost;
    order.total = money(subtotal + shippingCost + montagemCost - discount);

    const installments = Math.max(
      1,
      Number(
        payload.installments ||
        payload.payment?.installments ||
        order.payment?.installments ||
        1
      )
    );

    order.payment = {
      ...(order.payment || {}),
      ...(payload.payment || {}),
      method: clean(
        payload.paymentMethod ||
        payload.payment?.method ||
        order.payment?.method,
        40
      ).toLowerCase(),
      installments,
      installmentValue: money(order.total / installments)
    };

    order.televendas = {
      ...(order.televendas || {}),
      discount,
      timeline: [
        ...array(order.televendas?.timeline),
        {
          status: order.status,
          label: 'Pedido atualizado',
          at: new Date(),
          by: operator(actor).name
        }
      ]
    };

    await order.save();

    await audit('televendas.order.updated', order, {
      message: 'Pedido atualizado',
      request: payload
    });

    return serialize(order, toJSON);
  }

  async function generatePaymentLink(id, payload = {}, actor = {}) {
    const order = await find(id);

    if (['aprovado', 'cancelado', 'expedido', 'entregue'].includes(order.status)) {
      throw error('Não é possível gerar link para este pedido.', 409);
    }

    const value = token();
    const expiresAt = new Date(
      Date.now() +
      Math.min(168, Math.max(1, Number(payload.expiresInHours || 24))) * 3600000
    );
    const installments = Math.max(
      1,
      Number(payload.installments || order.payment?.installments || 1)
    );

    order.status = 'link_gerado';
    order.statusLabel = STATUS_LABELS.link_gerado;
    order.paymentStatus = 'awaiting_customer';
    order.paymentLinkToken = value;
    order.paymentLinkExpiresAt = expiresAt;
    order.payment = {
      ...(order.payment || {}),
      method: clean(payload.method || order.payment?.method, 40).toLowerCase(),
      installments,
      installmentValue: money(order.total / installments),
      locked: true,
      status: 'awaiting_customer',
      paymentLinkToken: value,
      paymentLinkExpiresAt: expiresAt
    };
    order.televendas = {
      ...(order.televendas || {}),
      timeline: [
        ...array(order.televendas?.timeline),
        {
          status: 'link_gerado',
          label: STATUS_LABELS.link_gerado,
          at: new Date(),
          by: operator(actor).name
        }
      ]
    };

    await order.save();

    const base = clean(
      payload.frontendUrl ||
      FRONTEND_URL ||
      'https://arianamoveis.com.br',
      1000
    ).replace(/\/+$/, '');

    const paymentLink =
      `${base}/pagamento_link.html?token=${encodeURIComponent(value)}`;

    await audit('televendas.payment_link.generated', order, {
      message: 'Link gerado',
      metadata: { expiresAt, paymentLink }
    });

    return {
      order: serialize(order, toJSON),
      paymentLink,
      token: value,
      expiresAt
    };
  }

  async function getPublicOrder(value) {
    return publicOrder(await findToken(clean(value, 300)), toJSON);
  }

  async function registerAccess(value, req = {}) {
    const order = await findToken(clean(value, 300));

    if (order.status === 'link_gerado') {
      order.status = 'cliente_acessou';
      order.statusLabel = STATUS_LABELS.cliente_acessou;
    }

    order.customerViewedAt = order.customerViewedAt || new Date();
    order.televendas = {
      ...(order.televendas || {}),
      lastPublicAccess: {
        at: new Date(),
        ip: clean(
          req.headers?.['x-forwarded-for'] ||
          req.socket?.remoteAddress ||
          '',
          120
        ),
        userAgent: clean(req.headers?.['user-agent'] || '', 500)
      },
      timeline: [
        ...array(order.televendas?.timeline),
        {
          status: 'cliente_acessou',
          label: STATUS_LABELS.cliente_acessou,
          at: new Date(),
          by: 'cliente'
        }
      ]
    };

    await order.save();
    return publicOrder(order, toJSON);
  }

  async function createPixPayment(value, payload = {}, req = {}) {
    const order = await findToken(clean(value, 300));

    if (['aprovado', 'cancelado', 'expedido', 'entregue'].includes(order.status)) {
      throw error('Pagamento bloqueado para este pedido.', 409, 'PAYMENT_BLOCKED');
    }

    if (
      order.payment?.provider === 'mercadopago' &&
      order.payment?.externalId &&
      ['pending', 'waiting_payment'].includes(order.paymentStatus)
    ) {
      return {
        reused: true,
        order: publicOrder(order, toJSON)
      };
    }

    const result = await gateway.createPix(order, payload);

    order.status = 'aguardando_pagamento';
    order.statusLabel = STATUS_LABELS.aguardando_pagamento;
    order.paymentStartedAt = new Date();
    order.paymentStatus = 'waiting_payment';
    order.analysisStatus = 'not_required';
    order.payment = {
      ...(order.payment || {}),
      method: 'pix',
      provider: 'mercadopago',
      externalId: result.externalId,
      providerStatus: result.status,
      status: 'pending',
      duplicateBlocked: true,
      customerDocument: digits(
        payload.document ||
        payload.cpf ||
        payload.payer?.document ||
        ''
      ),
      customerEmail: clean(
        payload.email ||
        payload.payer?.email ||
        order.customerEmail,
        180
      ).toLowerCase(),
      pix: {
        qrCode: result.qrCode,
        qrCodeBase64: result.qrCodeBase64,
        ticketUrl: result.ticketUrl,
        expiresAt: result.expiresAt
      }
    };
    order.televendas = {
      ...(order.televendas || {}),
      timeline: [
        ...array(order.televendas?.timeline),
        {
          status: 'aguardando_pagamento',
          label: 'PIX gerado pelo Mercado Pago',
          at: new Date(),
          by: 'mercadopago'
        }
      ]
    };

    await order.save();

    await recordPaymentEvent({
      provider: 'mercadopago',
      eventType: 'payment.created',
      externalId: result.externalId,
      orderId: order._id,
      payload: result.raw
    });

    await audit('televendas.pix.created', order, {
      message: 'PIX real gerado no Mercado Pago',
      response: result.raw,
      metadata: {
        ip: req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || ''
      }
    });

    return {
      reused: false,
      order: publicOrder(order, toJSON)
    };
  }

  async function createCardPayment(value, payload = {}, req = {}) {
    const order = await findToken(clean(value, 300));

    if (['aprovado', 'cancelado', 'expedido', 'entregue'].includes(order.status)) {
      throw error('Pagamento bloqueado para este pedido.', 409, 'PAYMENT_BLOCKED');
    }

    if (order.payment?.duplicateBlocked && order.payment?.externalId) {
      throw error(
        'Já existe uma tentativa de pagamento ativa para este pedido.',
        409,
        'DUPLICATE_PAYMENT_BLOCKED'
      );
    }

    const result = await gateway.createCard(order, payload);

    const normalizedStatus = ['paid', 'closed'].includes(
      clean(result.status, 80).toLowerCase()
    )
      ? 'approved'
      : (
          ['failed', 'canceled', 'cancelled'].includes(
            clean(result.status, 80).toLowerCase()
          )
            ? 'rejected'
            : 'under_review'
        );

    await recordPaymentEvent({
      provider: 'pagarme',
      eventType: 'order.created',
      externalId: result.externalId,
      orderId: order._id,
      payload: result.raw
    });

    await applyPaymentResult(order, {
      ...result,
      normalizedStatus,
      providerStatus: result.status
    }, 'pagarme_api');

    await audit('televendas.card.created', order, {
      message: 'Pagamento real enviado à Pagar.me',
      response: result.raw,
      metadata: {
        ip: req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || ''
      }
    });

    return {
      order: publicOrder(order, toJSON),
      gateway: {
        provider: result.provider,
        externalId: result.externalId,
        chargeId: result.chargeId,
        transactionId: result.transactionId,
        status: result.status,
        gatewayResponseCode: result.gatewayResponseCode,
        gatewayResponseMessage: result.gatewayResponseMessage
      }
    };
  }

  async function mercadoPagoWebhook(request = {}) {
    const parsed = await gateway.parseMercadoPagoWebhook(request);

    if (parsed.ignored) {
      return {
        accepted: true,
        ignored: true,
        reason: parsed.reason
      };
    }

    let order = null;
    if (parsed.orderId) {
      try {
        order = await find(parsed.orderId);
      } catch (_error) {}
    }

    if (!order) {
      order = await Order.findOne({
        origin: 'televendas',
        'payment.externalId': parsed.externalId
      });
    }

    if (!order) {
      return {
        accepted: true,
        ignored: true,
        reason: 'televendas_order_not_found'
      };
    }

    await recordPaymentEvent({
      provider: 'mercadopago',
      eventType: `payment.${parsed.providerStatus || 'updated'}`,
      externalId: parsed.externalId,
      orderId: order._id,
      payload: parsed.payload
    });

    await applyPaymentResult(order, parsed, 'webhook');

    await audit('televendas.mercadopago.webhook', order, {
      message: `Webhook Mercado Pago: ${parsed.providerStatus}`,
      request: request.body,
      response: parsed.payload
    });

    return {
      accepted: true,
      orderId: String(order._id),
      status: order.status,
      statusLabel: order.statusLabel
    };
  }

  async function pagarmeWebhook(request = {}) {
    const parsed = await gateway.parsePagarmeWebhook(request);

    let order = null;
    if (parsed.orderId) {
      try {
        order = await find(parsed.orderId);
      } catch (_error) {}
    }

    if (!order && parsed.externalId) {
      order = await Order.findOne({
        origin: 'televendas',
        'payment.externalId': parsed.externalId
      });
    }

    if (!order) {
      return {
        accepted: true,
        ignored: true,
        reason: 'televendas_order_not_found'
      };
    }

    await recordPaymentEvent({
      provider: 'pagarme',
      eventType: parsed.eventType || 'order.updated',
      externalId: parsed.externalId,
      orderId: order._id,
      payload: parsed.payload
    });

    await applyPaymentResult(order, parsed, 'webhook');

    await audit('televendas.pagarme.webhook', order, {
      message: `Webhook Pagar.me: ${parsed.eventType || parsed.providerStatus}`,
      request: request.body
    });

    return {
      accepted: true,
      orderId: String(order._id),
      status: order.status,
      statusLabel: order.statusLabel
    };
  }

  async function reconcilePayment(id, actor = {}) {
    const order = await find(id);
    const provider = clean(order.payment?.provider || '', 80).toLowerCase();
    const externalId = clean(order.payment?.externalId || '', 300);

    if (!provider || !externalId) {
      throw error(
        'O pedido ainda não possui pagamento externo para reconciliar.',
        400,
        'PAYMENT_NOT_CREATED'
      );
    }

    let parsed;

    if (provider === 'mercadopago') {
      const payment = await createPaymentGatewayService({ axios }).parseMercadoPagoWebhook;
      // A consulta direta é feita por meio do próprio gateway.
      const mpService = createPaymentGatewayService({
        axios,
        accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN || ''
      });
      // Usa um payload sintético somente para manter um caminho único de atualização.
      const mpGatewayResult = await (async () => {
        const { createMercadoPagoGateway } = await import('./gateways/mercadoPagoGateway.js');
        const mp = createMercadoPagoGateway({
          axios,
          accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN || ''
        });
        const data = await mp.getPayment(externalId);
        return {
          provider: 'mercadopago',
          method: 'pix',
          externalId: String(data.id || externalId),
          providerStatus: data.status || '',
          normalizedStatus: data.status === 'approved'
            ? 'approved'
            : (
                ['rejected', 'cancelled', 'refunded', 'charged_back'].includes(data.status)
                  ? 'rejected'
                  : (
                      ['in_process', 'in_mediation', 'authorized'].includes(data.status)
                        ? 'under_review'
                        : 'pending'
                    )
              ),
          payload: data
        };
      })();
      parsed = mpGatewayResult;
      void payment;
      void mpService;
    } else if (provider === 'pagarme') {
      const { createPagarmeGateway } = await import('./gateways/pagarmeGateway.js');
      const pg = createPagarmeGateway({
        axios,
        secretKey: process.env.PAGARME_SECRET_KEY || ''
      });
      const data = await pg.getOrder(externalId);
      const status = clean(data.status || data.charges?.[0]?.status || '', 80).toLowerCase();
      parsed = {
        provider: 'pagarme',
        method: 'card',
        externalId: String(data.id || externalId),
        providerStatus: status,
        normalizedStatus: ['paid', 'closed'].includes(status)
          ? 'approved'
          : (
              ['failed', 'canceled', 'cancelled', 'payment_failed'].includes(status)
                ? 'rejected'
                : 'under_review'
            ),
        payload: data
      };
    } else {
      throw error('Gateway não suportado para reconciliação.', 400);
    }

    await applyPaymentResult(order, parsed, 'reconciliacao_manual');

    await audit('televendas.payment.reconciled', order, {
      message: `Pagamento reconciliado por ${operator(actor).name}`,
      response: parsed.payload
    });

    return {
      order: serialize(order, toJSON),
      providerStatus: parsed.providerStatus
    };
  }

  async function updateStatus(id, payload = {}, actor = {}) {
    const order = await find(id);
    const status = clean(payload.status, 60).toLowerCase();

    if (!ALLOWED.has(status)) {
      throw error('Status inválido.');
    }

    // A aprovação manual é bloqueada na Fase 5.2.
    if (status === 'aprovado' && payload.force !== true) {
      throw error(
        'O pagamento só pode ser aprovado pelo gateway ou pela reconciliação.',
        409,
        'MANUAL_APPROVAL_BLOCKED'
      );
    }

    order.status = status;
    order.statusLabel = STATUS_LABELS[status];
    order.televendas = {
      ...(order.televendas || {}),
      timeline: [
        ...array(order.televendas?.timeline),
        {
          status,
          label: order.statusLabel,
          note: clean(payload.note || payload.reason || '', 1000),
          at: new Date(),
          by: operator(actor).name
        }
      ]
    };

    await order.save();

    await audit('televendas.order.status_changed', order, {
      message: `Status: ${status}`,
      request: payload
    });

    return serialize(order, toJSON);
  }

  async function cancelOrder(id, payload = {}, actor = {}) {
    return updateStatus(
      id,
      {
        status: 'cancelado',
        reason: payload.reason || payload.note || 'Cancelado pelo atendimento'
      },
      actor
    );
  }

  async function listMyOrders(user = {}) {
    const userId = user._id || user.id || user.userId || null;
    const email = clean(user.email || '', 180).toLowerCase();

    if (!userId && !email) {
      throw error('Cliente não identificado.', 401);
    }

    const filter = { origin: 'televendas' };
    filter.$or = [
      ...(userId ? [{ userId }] : []),
      ...(email ? [{ customerEmail: email }] : [])
    ];

    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .limit(100);

    return {
      orders: orders.map(order => publicOrder(order, toJSON))
    };
  }

  return {
    createOrder,
    listOrders,
    getOrder,
    updateOrder,
    updateStatus,
    generatePaymentLink,
    cancelOrder,
    getPublicOrder,
    registerAccess,
    createPixPayment,
    createCardPayment,
    mercadoPagoWebhook,
    pagarmeWebhook,
    reconcilePayment,
    listMyOrders
  };
}
