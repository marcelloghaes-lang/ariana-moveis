const STAGES = new Set(['orcamento', 'pedido', 'venda']);
const CLOSED = new Set(['faturado', 'estornado', 'cancelado']);

const LABELS = {
  orcamento: 'Orçamento',
  pedido: 'Pedido',
  venda: 'Venda',
  faturado: 'Faturado',
  estornado: 'Estornado',
  cancelado: 'Cancelado'
};

const clean = (value = '', max = 1000) => String(value ?? '').trim().slice(0, max);
const digits = (value = '') => String(value || '').replace(/\D/g, '');
const array = (value) => Array.isArray(value) ? value : [];
const money = (value = 0) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

function fail(message, statusCode = 400, code = 'ERP_ERROR') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function actorInfo(value = {}) {
  return {
    id: String(value.id || value._id || value.userId || ''),
    name: clean(value.name || value.email || 'Operador', 160),
    email: clean(value.email || '', 180).toLowerCase()
  };
}

function serial(doc, toJSON) {
  return typeof toJSON === 'function'
    ? toJSON(doc)
    : (doc?.toObject ? doc.toObject() : doc);
}

function normalizeStage(value = 'orcamento') {
  const stage = clean(value, 40).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return STAGES.has(stage) ? stage : 'orcamento';
}

function normalizePaymentMethod(value = '') {
  const text = clean(value, 80).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (text.includes('credi')) return 'crediario';
  if (text.includes('dinheiro')) return 'dinheiro';
  if (text.includes('pix')) return 'pix';
  if (text.includes('debito')) return 'cartao_debito';
  if (text.includes('cart') || text.includes('credito')) return 'cartao_credito';
  if (text.includes('boleto')) return 'boleto';
  return text || 'outro';
}

function addMonthsSafe(date, months) {
  const d = new Date(date);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d;
}

function buildReceivables(total, payment = {}) {
  const installments = Math.max(1, Math.min(60, Number(payment.installments || 1)));
  const method = normalizePaymentMethod(payment.method || payment.paymentMethod || '');
  const explicitStatus = clean(payment.status || payment.paymentStatus || '', 40).toLowerCase();
  const financed = method === 'crediario' || method === 'boleto';
  const defaultStatus = financed ? 'pendente' : 'recebido';
  const status = explicitStatus === 'pending' || explicitStatus === 'pendente'
    ? 'pendente'
    : explicitStatus === 'paid' || explicitStatus === 'recebido' || explicitStatus === 'approved'
      ? 'recebido'
      : defaultStatus;

  const firstDue = payment.firstDueDate
    ? new Date(payment.firstDueDate)
    : financed
      ? addMonthsSafe(new Date(), 1)
      : new Date();

  if (Number.isNaN(firstDue.getTime())) throw fail('Data do primeiro vencimento inválida.', 400, 'INVALID_DUE_DATE');

  const base = Math.floor((money(total) * 100) / installments) / 100;
  let accumulated = 0;

  return Array.from({ length: installments }, (_, index) => {
    const isLast = index === installments - 1;
    const value = isLast ? money(total - accumulated) : money(base);
    accumulated = money(accumulated + value);
    const dueAt = financed ? addMonthsSafe(firstDue, index) : new Date(firstDue);
    return {
      number: index + 1,
      installments,
      value,
      dueAt,
      status,
      method,
      receivedAt: status === 'recebido' ? new Date() : null
    };
  });
}

export function createErpService(context = {}) {
  const { Order, Product, IntegrationAuditLog, toJSON, redact } = context;
  if (!Order) throw new Error('[erp] Order não informado');
  if (!Product) throw new Error('[erp] Product não informado');

  async function audit(eventType, order, metadata = {}) {
    if (!IntegrationAuditLog) return;
    try {
      await IntegrationAuditLog.create({
        scope: 'erp_ariana',
        eventType,
        orderId: String(order?._id || ''),
        status: order?.status || '',
        message: clean(metadata.message || '', 1000),
        request: redact ? redact(metadata.request || null) : metadata.request || null,
        response: redact ? redact(metadata.response || null) : metadata.response || null,
        metadata: redact ? redact(metadata.metadata || null) : metadata.metadata || null
      });
    } catch (error) {
      console.warn('[erp/audit]', error.message);
    }
  }

  async function findOrder(id) {
    let order = null;
    try { order = await Order.findById(id); } catch (_error) {}
    if (!order) {
      order = await Order.findOne({ origin: 'erp_ariana', 'televendas.erp.code': clean(id, 100) });
    }
    if (!order || order.origin !== 'erp_ariana') {
      throw fail('Venda do Ariana ERP não encontrada.', 404, 'ERP_ORDER_NOT_FOUND');
    }
    return order;
  }

  async function hydrateItems(rawItems = []) {
    if (!Array.isArray(rawItems) || !rawItems.length) {
      throw fail('Adicione pelo menos um produto.', 400, 'ITEMS_REQUIRED');
    }

    const rows = [];
    for (let index = 0; index < rawItems.length; index += 1) {
      const raw = rawItems[index] || {};
      const productId = clean(raw.productId || raw.id || raw._id || '', 120);
      if (!productId) throw fail(`Produto inválido na posição ${index + 1}.`, 400, 'PRODUCT_ID_REQUIRED');

      let product = null;
      try { product = await Product.findById(productId); } catch (_error) {}
      if (!product || product.active === false) {
        throw fail(`Produto não encontrado ou inativo: ${clean(raw.name || productId, 180)}.`, 409, 'PRODUCT_UNAVAILABLE');
      }

      const qty = Math.max(1, Math.floor(Number(raw.qty || raw.quantity || 1)));
      const unitPrice = money(raw.unitPrice ?? raw.price ?? product.price ?? 0);
      if (unitPrice <= 0) throw fail(`Preço inválido para ${product.name}.`, 400, 'INVALID_PRICE');

      rows.push({
        productId: String(product._id),
        sellerId: clean(product.sellerId || raw.sellerId || '', 120),
        name: clean(product.name || raw.name, 220),
        sku: clean(product.sku || raw.sku || '', 120),
        qty,
        unitPrice,
        totalPrice: money(unitPrice * qty),
        sellerBaseUnitPrice: money(raw.sellerBaseUnitPrice ?? product.price ?? unitPrice),
        sellerBaseTotal: money((raw.sellerBaseUnitPrice ?? product.price ?? unitPrice) * qty),
        cardMarkupUnit: money(raw.cardMarkupUnit || 0),
        cardMarkupTotal: money(raw.cardMarkupTotal || 0),
        image: clean(product.imageUrl || product.mainImageUrl || product.image || raw.image || '', 1000)
      });
    }
    return rows;
  }

  function totals(items, payload = {}, current = {}) {
    const subtotal = money(items.reduce((sum, item) => sum + Number(item.totalPrice || 0), 0));
    const shippingCost = money(payload.shippingCost ?? payload.shipping?.price ?? current.shippingCost ?? 0);
    const montagemCost = money(payload.montagemCost ?? payload.assemblyCost ?? current.montagemCost ?? 0);
    const discount = Math.max(0, money(payload.discount ?? current.discount ?? 0));
    const total = money(subtotal + shippingCost + montagemCost - discount);
    if (total <= 0) throw fail('O total da venda deve ser maior que zero.', 400, 'INVALID_TOTAL');
    return { subtotal, shippingCost, montagemCost, discount, total };
  }

  function timelineEntry(status, label, actor = {}) {
    return { status, label, at: new Date(), by: actorInfo(actor).name };
  }

  function codeFor(order) {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `ERP-${stamp}-${String(order._id).slice(-6).toUpperCase()}`;
  }

  async function createOrder(payload = {}, actor = {}) {
    const stage = normalizeStage(payload.stage || payload.status || 'orcamento');
    const items = await hydrateItems(payload.items);
    const computed = totals(items, payload);
    const op = actorInfo(actor);
    const paymentMethod = normalizePaymentMethod(payload.paymentMethod || payload.payment?.method || '');
    const installments = Math.max(1, Math.min(60, Number(payload.installments || payload.payment?.installments || 1)));

    const order = await Order.create({
      userId: payload.userId || null,
      sellerIds: [...new Set(items.map(item => item.sellerId).filter(Boolean))],
      customerName: clean(payload.customerName || payload.customer?.name || 'Consumidor', 180),
      customerEmail: clean(payload.customerEmail || payload.customer?.email || '', 180).toLowerCase(),
      customerPhone: digits(payload.customerPhone || payload.customer?.phone || ''),
      customerCpf: digits(payload.customerCpf || payload.customer?.cpf || ''),
      status: stage,
      statusLabel: LABELS[stage],
      items,
      subtotal: computed.subtotal,
      shippingCost: computed.shippingCost,
      montagemCost: computed.montagemCost,
      total: computed.total,
      currency: payload.currency || 'BRL',
      payment: {
        method: paymentMethod,
        installments,
        installmentValue: money(computed.total / installments),
        status: 'not_started',
        received: false
      },
      shippingAddress: payload.shippingAddress || payload.customer?.address || null,
      shipping: payload.shipping || null,
      notes: clean(payload.notes || '', 3000),
      origin: 'erp_ariana',
      salesChannel: 'erp_lite',
      operatorId: op.id,
      operatorName: op.name,
      operatorEmail: op.email,
      paymentStatus: 'not_started',
      analysisStatus: 'not_required',
      televendas: {
        erp: {
          code: '',
          stage,
          discount: computed.discount,
          stockStatus: 'not_moved',
          financialStatus: 'not_generated',
          fiscalStatus: 'not_generated',
          receivables: [],
          stockMovements: [],
          timeline: [timelineEntry(stage, `${LABELS[stage]} criado`, actor)]
        }
      }
    });

    order.televendas = {
      ...(order.televendas || {}),
      erp: { ...(order.televendas?.erp || {}), code: codeFor(order) }
    };
    await order.save();
    await audit('erp.order.created', order, { message: `${LABELS[stage]} criado`, request: payload });
    return serial(order, toJSON);
  }

  async function listOrders(query = {}) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 30)));
    const filter = { origin: 'erp_ariana' };
    if (query.status && query.status !== 'all') filter.status = clean(query.status, 40);
    const q = clean(query.q || query.search || '', 140);
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { customerName: rx },
        { customerEmail: rx },
        { customerPhone: rx },
        { customerCpf: rx },
        { 'televendas.erp.code': rx },
        { 'items.name': rx },
        { 'items.sku': rx }
      ];
    }
    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      Order.countDocuments(filter)
    ]);
    return {
      orders: orders.map(row => serial(row, toJSON)),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    };
  }

  async function getOrder(id) {
    return serial(await findOrder(id), toJSON);
  }

  async function updateOrder(id, payload = {}, actor = {}) {
    const order = await findOrder(id);
    if (CLOSED.has(order.status)) throw fail('Este registro já está fechado. Estorne o faturamento para reverter uma venda.', 409, 'ERP_ORDER_LOCKED');

    if (payload.items) order.items = await hydrateItems(payload.items);
    if (payload.customerName !== undefined || payload.customer?.name !== undefined) order.customerName = clean(payload.customerName || payload.customer?.name, 180);
    if (payload.customerEmail !== undefined || payload.customer?.email !== undefined) order.customerEmail = clean(payload.customerEmail || payload.customer?.email, 180).toLowerCase();
    if (payload.customerPhone !== undefined || payload.customer?.phone !== undefined) order.customerPhone = digits(payload.customerPhone || payload.customer?.phone);
    if (payload.customerCpf !== undefined || payload.customer?.cpf !== undefined) order.customerCpf = digits(payload.customerCpf || payload.customer?.cpf);
    if (payload.shippingAddress !== undefined) order.shippingAddress = payload.shippingAddress;
    if (payload.shipping !== undefined) order.shipping = payload.shipping;
    if (payload.notes !== undefined) order.notes = clean(payload.notes, 3000);

    const stage = normalizeStage(payload.stage || payload.status || order.status);
    const currentErp = order.televendas?.erp || {};
    const computed = totals(array(order.items), payload, {
      shippingCost: order.shippingCost,
      montagemCost: order.montagemCost,
      discount: currentErp.discount || 0
    });
    order.subtotal = computed.subtotal;
    order.shippingCost = computed.shippingCost;
    order.montagemCost = computed.montagemCost;
    order.total = computed.total;
    order.status = stage;
    order.statusLabel = LABELS[stage];

    const installments = Math.max(1, Math.min(60, Number(payload.installments || payload.payment?.installments || order.payment?.installments || 1)));
    order.payment = {
      ...(order.payment || {}),
      ...(payload.payment || {}),
      method: normalizePaymentMethod(payload.paymentMethod || payload.payment?.method || order.payment?.method),
      installments,
      installmentValue: money(order.total / installments)
    };
    order.televendas = {
      ...(order.televendas || {}),
      erp: {
        ...currentErp,
        stage,
        discount: computed.discount,
        timeline: [...array(currentErp.timeline), timelineEntry(stage, `${LABELS[stage]} atualizado`, actor)]
      }
    };
    await order.save();
    await audit('erp.order.updated', order, { message: `${LABELS[stage]} atualizado`, request: payload });
    return serial(order, toJSON);
  }

  async function decrementStock(order) {
    const movements = [];
    try {
      for (const item of array(order.items)) {
        const qty = Math.max(1, Number(item.qty || 1));
        const before = await Product.findOneAndUpdate(
          { _id: item.productId, active: { $ne: false }, stock: { $gte: qty } },
          { $inc: { stock: -qty } },
          { new: false }
        );
        if (!before) {
          let product = null;
          try { product = await Product.findById(item.productId); } catch (_error) {}
          const available = Number(product?.stock || 0);
          throw fail(`Estoque insuficiente para ${item.name}. Disponível: ${available}; necessário: ${qty}.`, 409, 'INSUFFICIENT_STOCK');
        }
        movements.push({
          productId: String(item.productId),
          sku: item.sku || before.sku || '',
          name: item.name || before.name || '',
          qty,
          before: Number(before.stock || 0),
          after: Number(before.stock || 0) - qty,
          at: new Date()
        });
      }
      return movements;
    } catch (error) {
      for (const movement of movements) {
        await Product.updateOne({ _id: movement.productId }, { $inc: { stock: movement.qty } }).catch(() => null);
      }
      throw error;
    }
  }

  async function faturar(id, payload = {}, actor = {}) {
    const order = await findOrder(id);
    if (order.status === 'faturado') throw fail('Esta venda já foi faturada.', 409, 'ALREADY_BILLED');
    if (order.status === 'estornado') throw fail('Venda estornada não pode ser faturada novamente neste registro.', 409, 'REVERSED_ORDER');
    if (order.status === 'cancelado') throw fail('Venda cancelada não pode ser faturada.', 409, 'CANCELLED_ORDER');

    const currentErp = order.televendas?.erp || {};
    if (currentErp.stockStatus === 'moved') throw fail('O estoque desta venda já foi baixado.', 409, 'STOCK_ALREADY_MOVED');

    const payment = {
      ...(order.payment || {}),
      ...(payload.payment || {}),
      method: normalizePaymentMethod(payload.paymentMethod || payload.payment?.method || order.payment?.method),
      installments: Math.max(1, Math.min(60, Number(payload.installments || payload.payment?.installments || order.payment?.installments || 1))),
      firstDueDate: payload.firstDueDate || payload.payment?.firstDueDate || null,
      status: payload.paymentStatus || payload.payment?.status || ''
    };
    const receivables = buildReceivables(order.total, payment);
    const movements = await decrementStock(order);

    try {
      const allReceived = receivables.every(row => row.status === 'recebido');
      order.status = 'faturado';
      order.statusLabel = LABELS.faturado;
      order.paymentStatus = allReceived ? 'approved' : 'pending';
      order.payment = {
        ...(order.payment || {}),
        method: payment.method,
        installments: payment.installments,
        installmentValue: money(order.total / payment.installments),
        status: allReceived ? 'approved' : 'pending',
        received: allReceived,
        receivedAt: allReceived ? new Date() : null
      };
      order.approvedAt = order.approvedAt || (allReceived ? new Date() : null);
      order.televendas = {
        ...(order.televendas || {}),
        erp: {
          ...currentErp,
          stage: 'faturado',
          stockStatus: 'moved',
          stockMovedAt: new Date(),
          stockMovements: movements,
          financialStatus: 'generated',
          financialGeneratedAt: new Date(),
          receivables,
          paymentMethod: payment.method,
          fiscalStatus: currentErp.fiscalStatus || 'not_generated',
          timeline: [...array(currentErp.timeline), timelineEntry('faturado', 'Venda faturada: financeiro gerado e estoque baixado', actor)]
        }
      };
      await order.save();
    } catch (error) {
      for (const movement of movements) {
        await Product.updateOne({ _id: movement.productId }, { $inc: { stock: movement.qty } }).catch(() => null);
      }
      throw error;
    }

    await audit('erp.order.billed', order, {
      message: 'Venda faturada; estoque baixado e financeiro gerado',
      request: payload,
      metadata: { movements, receivables }
    });
    return serial(order, toJSON);
  }

  async function estornar(id, payload = {}, actor = {}) {
    const order = await findOrder(id);
    if (order.status !== 'faturado') throw fail('Somente uma venda faturada pode ser estornada.', 409, 'NOT_BILLED');
    const currentErp = order.televendas?.erp || {};
    if (currentErp.stockRestoredAt) throw fail('O estoque desta venda já foi restaurado.', 409, 'ALREADY_REVERSED');

    const movements = array(currentErp.stockMovements);
    for (const movement of movements) {
      await Product.updateOne({ _id: movement.productId }, { $inc: { stock: Math.max(0, Number(movement.qty || 0)) } });
    }

    order.status = 'estornado';
    order.statusLabel = LABELS.estornado;
    order.paymentStatus = 'reversed';
    order.televendas = {
      ...(order.televendas || {}),
      erp: {
        ...currentErp,
        stage: 'estornado',
        stockStatus: 'restored',
        stockRestoredAt: new Date(),
        financialStatus: 'reversed',
        financialReversedAt: new Date(),
        reverseReason: clean(payload.reason || payload.motivo || 'Estorno da venda', 1000),
        receivables: array(currentErp.receivables).map(row => ({ ...row, status: row.status === 'recebido' ? 'estornado' : 'cancelado', reversedAt: new Date() })),
        timeline: [...array(currentErp.timeline), timelineEntry('estornado', `Venda estornada: ${clean(payload.reason || payload.motivo || 'sem motivo informado', 500)}`, actor)]
      }
    };
    await order.save();
    await audit('erp.order.reversed', order, { message: 'Venda estornada e estoque restaurado', request: payload });
    return serial(order, toJSON);
  }

  async function cancel(id, payload = {}, actor = {}) {
    const order = await findOrder(id);
    if (order.status === 'faturado') throw fail('Venda faturada deve ser estornada, não cancelada.', 409, 'USE_REVERSE');
    if (order.status === 'estornado') throw fail('Venda já estornada.', 409, 'ALREADY_REVERSED');
    if (order.status === 'cancelado') return serial(order, toJSON);
    const currentErp = order.televendas?.erp || {};
    order.status = 'cancelado';
    order.statusLabel = LABELS.cancelado;
    order.televendas = {
      ...(order.televendas || {}),
      erp: {
        ...currentErp,
        stage: 'cancelado',
        cancelReason: clean(payload.reason || payload.motivo || '', 1000),
        cancelledAt: new Date(),
        timeline: [...array(currentErp.timeline), timelineEntry('cancelado', 'Registro cancelado', actor)]
      }
    };
    await order.save();
    await audit('erp.order.cancelled', order, { message: 'Registro cancelado', request: payload });
    return serial(order, toJSON);
  }

  async function listProducts(query = {}) {
    const limit = Math.min(100, Math.max(1, Number(query.limit || 40)));
    const filter = { active: { $ne: false } };
    const q = clean(query.q || query.search || '', 140);
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { sku: rx }, { brand: rx }, { category: rx }, { categoryName: rx }];
    }
    const products = await Product.find(filter).sort({ name: 1 }).limit(limit);
    return products.map(product => {
      const row = serial(product, toJSON);
      return {
        id: String(row._id || row.id),
        name: row.name || '',
        sku: row.sku || '',
        brand: row.brand || '',
        category: row.categoryName || row.category || '',
        price: Number(row.price || 0),
        pixPrice: Number(row.pixPrice ?? row.price ?? 0),
        stock: Number(row.stock || 0),
        image: row.imageUrl || row.mainImageUrl || row.image || row.imagem || ''
      };
    });
  }

  async function dashboard() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const [todayOrders, openOrders, billedToday, lowStock, totals] = await Promise.all([
      Order.countDocuments({ origin: 'erp_ariana', createdAt: { $gte: start } }),
      Order.countDocuments({ origin: 'erp_ariana', status: { $in: ['orcamento', 'pedido', 'venda'] } }),
      Order.countDocuments({ origin: 'erp_ariana', status: 'faturado', updatedAt: { $gte: start } }),
      Product.countDocuments({ active: { $ne: false }, stock: { $lte: 5 } }),
      Order.aggregate([
        { $match: { origin: 'erp_ariana', status: 'faturado', updatedAt: { $gte: start } } },
        { $group: { _id: null, total: { $sum: '$total' } } }
      ])
    ]);
    return {
      todayOrders,
      openOrders,
      billedToday,
      lowStock,
      billedValueToday: money(totals?.[0]?.total || 0)
    };
  }

  return {
    createOrder,
    listOrders,
    getOrder,
    updateOrder,
    faturar,
    estornar,
    cancel,
    listProducts,
    dashboard
  };
}

export default createErpService;
