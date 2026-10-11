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
      if (property === 'get' || property === 'patch' || property === 'put') {
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
