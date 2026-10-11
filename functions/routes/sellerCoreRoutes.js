import registerSellerCoreRoutesImpl from './sellerCoreRoutesImpl.js';
import createMarketplacePricingService from '../services/marketplacePricingService.js';

function patchSellerOrderQuery(query = {}) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) return query;

  const patched = { ...query };

  if (Array.isArray(patched.$and)) {
    patched.$and = patched.$and.map((item) => patchSellerOrderQuery(item));
  }

  if (Array.isArray(patched.$or)) {
    const nextOr = patched.$or.map((item) => patchSellerOrderQuery(item));
    let sellerIdValue;
    let hasSellerIds = false;
    let hasModernItemSellerId = false;
    let hasLegacyItemSellerId = false;

    for (const clause of nextOr) {
      if (!clause || typeof clause !== 'object' || Array.isArray(clause)) continue;

      if (Object.prototype.hasOwnProperty.call(clause, 'sellerIds')) {
        hasSellerIds = true;
        if (sellerIdValue === undefined) sellerIdValue = clause.sellerIds;
      }

      if (Object.prototype.hasOwnProperty.call(clause, 'items.sellerId')) {
        hasModernItemSellerId = true;
        if (sellerIdValue === undefined) sellerIdValue = clause['items.sellerId'];
      }

      if (Object.prototype.hasOwnProperty.call(clause, 'items.seller_id')) {
        hasLegacyItemSellerId = true;
      }
    }

    if (
      hasSellerIds &&
      hasModernItemSellerId &&
      !hasLegacyItemSellerId &&
      sellerIdValue !== undefined &&
      sellerIdValue !== null &&
      String(sellerIdValue).trim()
    ) {
      nextOr.push({ 'items.seller_id': sellerIdValue });
    }

    patched.$or = nextOr;
  }

  return patched;
}

function createSellerScopedOrderModel(Order) {
  if (!Order || typeof Order.find !== 'function') return Order;

  return new Proxy(Order, {
    get(target, property, receiver) {
      if (property === 'find') {
        return function sellerScopedFind(query, ...args) {
          return target.find.call(target, patchSellerOrderQuery(query), ...args);
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

const SELLER_PROFILE_MUTATION_PATHS = new Set([
  '/api/seller/profile',
  '/api/seller/update'
]);

const SELLER_ORDER_RESPONSE_PATHS = new Set([
  '/api/seller/orders',
  '/api/seller/orders/:id',
  '/api/seller/returns',
  '/api/seller/dashboard',
  '/api/seller/orders/:id/status',
  '/api/seller/orders/:id/ship'
]);

const APPROVED_SELLER_LOGISTICS_FIELDS = [
  'cepColeta',
  'pickupCep',
  'cep_coleta',
  'tipoLogistica',
  'shippingType',
  'transpPropria',
  'ownCarrier',
  'transportadoraPropria',
  'transportadoraNome',
  'carrierName',
  'transportadoraTelefone',
  'carrierPhone',
  'transportadoraPrazo',
  'carrierDeadline',
  'freteObs',
  'shippingNotes'
];

function isApprovedSellerRequest(req = {}) {
  const status = String(
    req.seller?.status ||
    req.seller?.metadata?.status ||
    req.seller?.metadata?.approvalStatus ||
    ''
  ).trim().toLowerCase();

  return ['approved', 'aprovado', 'ativo', 'active'].includes(status);
}

function sanitizeApprovedSellerProfileMutation(req = {}) {
  if (!isApprovedSellerRequest(req) || !req.body || typeof req.body !== 'object') return;

  const safeBody = { ...req.body };
  for (const field of APPROVED_SELLER_LOGISTICS_FIELDS) {
    delete safeBody[field];
  }
  req.body = safeBody;
}

function toPlain(value) {
  if (!value) return {};
  if (typeof value.toObject === 'function') return value.toObject({ virtuals: true });
  return value;
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function sanitizeSellerAddress(value) {
  if (!value) return null;
  if (typeof value === 'string') return String(value).slice(0, 600);
  if (typeof value !== 'object' || Array.isArray(value)) return null;

  const address = {
    label: firstDefined(value.label, value.nome, value.title),
    recipient: firstDefined(value.recipient, value.receiverName, value.nomeDestinatario),
    logradouro: firstDefined(value.logradouro, value.street, value.rua, value.address),
    street: firstDefined(value.street, value.logradouro, value.rua, value.address),
    numero: firstDefined(value.numero, value.number),
    number: firstDefined(value.number, value.numero),
    complemento: firstDefined(value.complemento, value.complement),
    complement: firstDefined(value.complement, value.complemento),
    bairro: firstDefined(value.bairro, value.neighborhood),
    neighborhood: firstDefined(value.neighborhood, value.bairro),
    cidade: firstDefined(value.cidade, value.city),
    city: firstDefined(value.city, value.cidade),
    uf: firstDefined(value.uf, value.state),
    state: firstDefined(value.state, value.uf),
    cep: firstDefined(value.cep, value.zip, value.zipCode, value.postalCode),
    zip: firstDefined(value.zip, value.cep, value.zipCode, value.postalCode),
    reference: firstDefined(value.reference, value.referencia)
  };

  return Object.fromEntries(
    Object.entries(address).filter(([, fieldValue]) => fieldValue !== undefined && fieldValue !== null && fieldValue !== '')
  );
}

function sanitizeSellerShipping(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const shipping = {
    carrier: firstDefined(value.carrier, value.transportadora),
    trackingCode: firstDefined(value.trackingCode, value.tracking, value.codigoRastreio),
    service: firstDefined(value.service, value.servico),
    name: firstDefined(value.name, value.label),
    status: value.status,
    statusLabel: value.statusLabel,
    shippedAt: value.shippedAt,
    estimatedDelivery: firstDefined(value.estimatedDelivery, value.deliveryEstimate, value.previsaoEntrega),
    estimatedDays: firstDefined(value.estimatedDays, value.deliveryDays, value.prazoDias)
  };

  return Object.fromEntries(
    Object.entries(shipping).filter(([, fieldValue]) => fieldValue !== undefined && fieldValue !== null && fieldValue !== '')
  );
}

function sanitizeSellerOrderItem(itemValue = {}) {
  const item = toPlain(itemValue);
  const quantity = Math.max(1, Number(firstDefined(item.qty, item.quantity, item.quantidade, 1)) || 1);
  const unitPrice = Number(firstDefined(item.sellerBaseUnitPrice, item.seller_base_unit_price, item.unitPrice, item.price, item.preco, 0)) || 0;
  const totalPrice = Number(firstDefined(item.sellerBaseTotal, item.seller_base_total, item.totalPrice, item.total, unitPrice * quantity)) || 0;

  return {
    _id: item._id ? String(item._id) : undefined,
    id: item.id ? String(item.id) : undefined,
    productId: String(firstDefined(item.productId, item.product_id, item._id, item.id, '') || ''),
    sellerId: String(firstDefined(item.sellerId, item.seller_id, '') || ''),
    name: String(firstDefined(item.name, item.nome, item.productName, '') || ''),
    productName: String(firstDefined(item.productName, item.name, item.nome, '') || ''),
    sku: String(item.sku || ''),
    qty: quantity,
    quantity,
    unitPrice,
    price: unitPrice,
    totalPrice,
    sellerBaseUnitPrice: Number(firstDefined(item.sellerBaseUnitPrice, item.seller_base_unit_price, unitPrice)) || unitPrice,
    sellerBaseTotal: Number(firstDefined(item.sellerBaseTotal, item.seller_base_total, totalPrice)) || totalPrice,
    image: String(firstDefined(item.image, item.imageUrl, item.imagem, '') || ''),
    imageUrl: String(firstDefined(item.imageUrl, item.image, item.imagem, '') || ''),
    variation: firstDefined(item.variation, item.variacao, item.variant),
    color: firstDefined(item.color, item.cor),
    size: firstDefined(item.size, item.tamanho)
  };
}

function sanitizeSellerOrderForResponse(orderValue = {}) {
  const order = toPlain(orderValue);
  const customer = order.customer && typeof order.customer === 'object' ? order.customer : {};
  const shippingAddress = sanitizeSellerAddress(firstDefined(order.shippingAddress, order.deliveryAddress, order.enderecoEntrega, order.address));
  const customerDocument = String(firstDefined(
    order.customerDocument,
    order.customerCpf,
    order.customerCnpj,
    customer.document,
    customer.cpf,
    customer.cnpj,
    ''
  ) || '').replace(/[^0-9]/g, '').slice(0, 14);

  const safe = {
    _id: order._id ? String(order._id) : undefined,
    id: String(firstDefined(order.id, order._id, '') || ''),
    orderId: String(firstDefined(order.orderId, order._id, order.id, '') || ''),
    orderNumber: firstDefined(order.orderNumber, order.numeroPedido),
    numeroPedido: firstDefined(order.numeroPedido, order.orderNumber),
    createdAt: order.createdAt || null,
    updatedAt: order.updatedAt || null,
    status: String(order.status || ''),
    statusLabel: String(order.statusLabel || ''),
    customerName: String(firstDefined(order.customerName, customer.name, customer.nome, 'Cliente') || 'Cliente'),
    customerEmail: String(firstDefined(order.customerEmail, customer.email, '') || ''),
    customerPhone: String(firstDefined(order.customerPhone, customer.phone, customer.telefone, '') || ''),
    customerDocument: customerDocument || undefined,
    shippingAddress,
    address: shippingAddress,
    items: (Array.isArray(order.items) ? order.items : []).map(sanitizeSellerOrderItem),
    sellerIds: Array.isArray(order.sellerIds) ? order.sellerIds.map((value) => String(value || '')).filter(Boolean) : [],
    sellerOrderPartial: order.sellerOrderPartial === true,
    sellerGross: Number(order.sellerGross || 0),
    subtotal: Number(order.subtotal || 0),
    total: Number(order.total || 0),
    shippingCost: Number(order.shippingCost || 0),
    paymentMethod: String(firstDefined(order.paymentMethod, order.payment_method, '') || ''),
    paymentMethodLabel: String(firstDefined(order.paymentMethodLabel, order.payment_method_label, '') || ''),
    trackingCode: String(firstDefined(order.trackingCode, order.shipping?.trackingCode, '') || ''),
    shipping: sanitizeSellerShipping(order.shipping),
    sellerFulfillment: sanitizeSellerShipping(order.sellerFulfillment),
    returnReason: String(firstDefined(order.returnReason, order.reason, order.motivo, '') || ''),
    reason: String(firstDefined(order.reason, order.returnReason, order.motivo, '') || '')
  };

  return Object.fromEntries(
    Object.entries(safe).filter(([, value]) => value !== undefined)
  );
}

function sanitizeSellerOrderPayload(routePath, payload) {
  if (routePath === '/api/seller/orders' || routePath === '/api/seller/returns') {
    return Array.isArray(payload) ? payload.map(sanitizeSellerOrderForResponse) : payload;
  }

  if (routePath === '/api/seller/dashboard' && payload && typeof payload === 'object') {
    return {
      ...payload,
      recentOrders: Array.isArray(payload.recentOrders)
        ? payload.recentOrders.map(sanitizeSellerOrderForResponse)
        : []
    };
  }

  if (
    routePath === '/api/seller/orders/:id' ||
    routePath === '/api/seller/orders/:id/status' ||
    routePath === '/api/seller/orders/:id/ship'
  ) {
    if (payload && typeof payload === 'object' && payload.order) {
      return { ...payload, order: sanitizeSellerOrderForResponse(payload.order) };
    }
  }

  return payload;
}

function wrapSellerOrderResponseHandler(routePath, handler) {
  if (typeof handler !== 'function') return handler;

  return async function sellerOrderPrivacyBoundary(req, res, next) {
    const originalJson = res.json.bind(res);
    res.json = function sellerOrderPrivacyJson(payload) {
      return originalJson(sanitizeSellerOrderPayload(routePath, payload));
    };

    try {
      return await handler(req, res, next);
    } finally {
      res.json = originalJson;
    }
  };
}

function sellerIdsFromOrder(orderValue = {}) {
  const order = toPlain(orderValue);
  const ids = new Set();

  for (const value of Array.isArray(order.sellerIds) ? order.sellerIds : []) {
    const id = String(value || '').trim();
    if (id) ids.add(id);
  }

  for (const item of Array.isArray(order.items) ? order.items : []) {
    const id = String(item?.sellerId || item?.seller_id || '').trim();
    if (id) ids.add(id);
  }

  return Array.from(ids);
}

function supportTicketSellerIds(ticketValue = {}) {
  const ticket = toPlain(ticketValue);
  const meta = ticket.metadata && typeof ticket.metadata === 'object' ? ticket.metadata : {};
  const ids = new Set();

  [meta.sellerId, meta.seller_id].forEach((value) => {
    const id = String(value || '').trim();
    if (id) ids.add(id);
  });

  const many = Array.isArray(meta.sellerIds) ? meta.sellerIds : (meta.sellerIds ? [meta.sellerIds] : []);
  for (const value of many) {
    const id = String(value || '').trim();
    if (id) ids.add(id);
  }

  return Array.from(ids);
}

function sellerSupportTicketForResponse(ticketValue = {}) {
  const item = toPlain(ticketValue);
  const orderId = String(item.orderId || item.pedido || '').trim();
  return {
    _id: item._id ? String(item._id) : '',
    id: String(item._id || item.id || ''),
    protocolo: String(item.protocolo || ''),
    orderId,
    pedido: orderId,
    tipo: String(item.tipo || 'Suporte'),
    assunto: String(item.assunto || ''),
    mensagem: String(item.mensagem || item.message || ''),
    status: String(item.status || 'Novo'),
    origem: String(item.origem || ''),
    nome: String(item.nome || item.name || ''),
    email: String(item.email || ''),
    telefone: String(item.telefone || item.phone || ''),
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null
  };
}

function orderReferenceValues(orderValue = {}) {
  const order = toPlain(orderValue);
  return [order._id, order.id, order.orderNumber, order.numeroPedido, order.orderId]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

async function sellerSupportScope(context = {}, sellerId = '') {
  const sid = String(sellerId || '').trim();
  const Order = context.Order;
  const Ticket = context.Ticket;
  if (!sid || !Order || !Ticket) return { tickets: [], allowedIds: new Set() };

  const orderDocs = await Order.find({
    $or: [{ sellerIds: sid }, { 'items.sellerId': sid }, { 'items.seller_id': sid }]
  })
    .select('_id id orderNumber numeroPedido orderId sellerIds items.sellerId items.seller_id')
    .limit(1000);

  const referenceToOrder = new Map();
  for (const orderDoc of orderDocs) {
    for (const ref of orderReferenceValues(orderDoc)) referenceToOrder.set(ref, orderDoc);
  }

  const directTickets = await Ticket.find({
    $or: [
      { 'metadata.sellerId': sid },
      { 'metadata.seller_id': sid },
      { 'metadata.sellerIds': sid },
      { 'metadata.sellerIds': { $in: [sid] } }
    ]
  }).sort({ createdAt: -1 }).limit(250);

  const seen = new Map();
  for (const ticket of directTickets) seen.set(String(ticket?._id || ''), ticket);

  const refs = Array.from(referenceToOrder.keys());
  if (refs.length) {
    const relatedTickets = await Ticket.find({ orderId: { $in: refs } })
      .sort({ createdAt: -1 })
      .limit(250);

    for (const ticket of relatedTickets) {
      const explicitSellerIds = supportTicketSellerIds(ticket);
      if (explicitSellerIds.length) {
        if (explicitSellerIds.includes(sid)) seen.set(String(ticket?._id || ''), ticket);
        continue;
      }

      const orderRef = String(toPlain(ticket).orderId || '').trim();
      const relatedOrder = referenceToOrder.get(orderRef);
      const orderSellerIds = sellerIdsFromOrder(relatedOrder);

      // Chamado genérico de pedido multivendedor permanece com a Ariana até ser
      // direcionado explicitamente. Isso impede que um Seller leia o pós-venda
      // destinado a outro participante do mesmo pedido.
      if (orderSellerIds.length === 1 && orderSellerIds[0] === sid) {
        seen.set(String(ticket?._id || ''), ticket);
      }
    }
  }

  const tickets = Array.from(seen.values())
    .sort((a, b) => new Date(toPlain(b)?.createdAt || 0) - new Date(toPlain(a)?.createdAt || 0))
    .slice(0, 250);

  return {
    tickets,
    allowedIds: new Set(tickets.map((ticket) => String(ticket?._id || '')).filter(Boolean))
  };
}

function createSecureSellerSupportListHandler(context = {}) {
  return async function secureSellerSupportList(req, res) {
    try {
      const sid = String(req.sellerId || '').trim();
      const scope = await sellerSupportScope(context, sid);
      return res.json(scope.tickets.map(sellerSupportTicketForResponse));
    } catch (error) {
      console.error('Erro ao carregar atendimentos isolados do seller:', error);
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar atendimentos do seller' });
    }
  };
}

function createSecureSellerSupportReadHandler(context = {}) {
  return async function secureSellerSupportRead(req, res) {
    try {
      const ticketId = context.normalizeObjectId
        ? context.normalizeObjectId(req.params.id)
        : req.params.id;
      if (!ticketId) return res.status(400).json({ ok: false, error: 'Chamado inválido' });

      const sid = String(req.sellerId || '').trim();
      const scope = await sellerSupportScope(context, sid);
      if (!scope.allowedIds.has(String(ticketId))) {
        return res.status(404).json({ ok: false, error: 'Chamado não encontrado' });
      }

      const ticket = await context.Ticket.findByIdAndUpdate(
        ticketId,
        { $set: { status: 'Lido', 'metadata.sellerReadAt': context.now ? context.now() : new Date() } },
        { new: true }
      );

      return res.json({ ok: true, ticket: sellerSupportTicketForResponse(ticket) });
    } catch (error) {
      console.error('Erro ao atualizar atendimento isolado do seller:', error);
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao atualizar atendimento do seller' });
    }
  };
}

function createSellerScopedApp(app, context = {}) {
  if (!app) return app;

  return new Proxy(app, {
    get(target, property, receiver) {
      if (property === 'get' || property === 'post' || property === 'patch' || property === 'put') {
        return function sellerScopedRoute(path, ...handlers) {
          const routePath = String(path || '');

          if ((property === 'patch' || property === 'put') && SELLER_PROFILE_MUTATION_PATHS.has(routePath) && handlers.length) {
            const lastIndex = handlers.length - 1;
            const finalHandler = handlers[lastIndex];

            if (typeof finalHandler === 'function') {
              handlers[lastIndex] = function guardedSellerProfileMutation(req, res, next) {
                sanitizeApprovedSellerProfileMutation(req);
                return finalHandler(req, res, next);
              };
            }
          }

          // Mantém o middleware de autenticação original do Seller e substitui
          // somente a lógica final do suporte por uma versão que respeita pedidos
          // multivendedores e não cruza chamados entre Sellers.
          if (property === 'get' && routePath === '/api/seller/support' && handlers.length) {
            handlers[handlers.length - 1] = createSecureSellerSupportListHandler(context);
          }

          if (property === 'patch' && routePath === '/api/seller/support/:id/read' && handlers.length) {
            handlers[handlers.length - 1] = createSecureSellerSupportReadHandler(context);
          }

          // Fronteira de privacidade dos pedidos do Seller. A implementação legada
          // continua responsável por autenticação, propriedade e regras de negócio;
          // aqui apenas reduzimos a resposta a um conjunto explícito de campos.
          if (SELLER_ORDER_RESPONSE_PATHS.has(routePath) && handlers.length) {
            const lastIndex = handlers.length - 1;
            handlers[lastIndex] = wrapSellerOrderResponseHandler(routePath, handlers[lastIndex]);
          }

          return target[property].call(target, path, ...handlers);
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

export default function registerSellerCoreRoutes(app, context = {}) {
  const pricing = createMarketplacePricingService(context);

  return registerSellerCoreRoutesImpl(createSellerScopedApp(app, context), {
    ...context,
    Order: createSellerScopedOrderModel(context.Order),
    buildProductBasePriceMapForOrders: context.buildProductBasePriceMapForOrders || pricing.buildProductBasePriceMapForOrders,
    getSellerSettlementForOrder: context.getSellerSettlementForOrder || pricing.getSellerSettlementForOrder
  });
}
