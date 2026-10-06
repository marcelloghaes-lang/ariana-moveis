// ============================================================
// ENTERPRISE SHARED HELPERS
// Funções auxiliares extraídas de routes/enterpriseRoutes.js
// sem alterar comportamento, endpoints, regras ou respostas.
// ============================================================

export function createEnterpriseHelpers(context = {}) {
  const {
    crypto,
    uid,
    sanitizeIdPart,
    toJSON
  } = context;

  function createEnterpriseRequestId() {
    return `REQ-ENT-${Date.now()}-${Math.floor(Math.random() * 9999)}`;
  }

  function createEnterprisePartnerId() {
    return `ENT-${Date.now()}-${Math.floor(Math.random() * 9999)}`;
  }

  function enterpriseRandomKey(size = 32) {
    return crypto.randomBytes(size).toString('hex');
  }

  function enterpriseCreateApiKey(env = 'ari_sbx') {
    return `${env}_${enterpriseRandomKey(20)}`;
  }

  function enterpriseCreateOAuthId() {
    return `cli_${enterpriseRandomKey(12)}`;
  }

  function enterpriseCreateWebhookSecret() {
    return `whsec_${enterpriseRandomKey(24)}`;
  }

  function enterpriseCompatNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function enterpriseCompatProductPayload(item = {}, parent = {}, partner = {}) {
    const sku = String(item.sku || item.codigo || item.productSku || uid('ent_sku')).trim();
    const name = String(item.name || item.nome || item.title || sku).trim();
    const sellerId = String(item.sellerId || parent.sellerId || parent.manufacturer || partner.requestId || 'enterprise').trim();
    const sellerName = String(item.sellerName || parent.sellerName || partner.tradeName || partner.companyName || parent.manufacturer || 'Enterprise').trim();
    const price = enterpriseCompatNumber(item.price ?? item.preco ?? item.unitPrice, 0);
    const stock = enterpriseCompatNumber(item.stock ?? item.estoque ?? item.quantity, 0);

    return {
      sellerId,
      sellerName,
      name,
      slug: sanitizeIdPart(name),
      description: String(item.description || item.descricao || '').trim(),
      category: String(item.category || item.categoria || item.categoryName || '').trim(),
      categoryName: String(item.categoryName || item.category || item.categoria || '').trim(),
      brand: String(item.brand || item.marca || parent.manufacturer || '').trim(),
      sku,
      price,
      oldPrice: item.oldPrice !== undefined ? enterpriseCompatNumber(item.oldPrice, null) : null,
      image: String(item.imageUrl || item.image || item.imagem || '').trim(),
      imageUrl: String(item.imageUrl || item.image || item.imagem || '').trim(),
      imagem: String(item.imageUrl || item.image || item.imagem || '').trim(),
      mainImageUrl: String(item.imageUrl || item.image || item.imagem || '').trim(),
      stock,
      active: item.active !== false,
      specs: item.specs || item.especificacoes || {},
      dimensions: item.dimensions || {},
      logistics: item.logistics || {},
      weight: item.weight !== undefined ? Number(item.weight) : undefined,
      height: item.height !== undefined ? Number(item.height) : undefined,
      width: item.width !== undefined ? Number(item.width) : undefined,
      length: item.length !== undefined ? Number(item.length) : undefined,
      updatedAt: new Date()
    };
  }

  function enterpriseNormalizeOrderForResponse(orderDoc = {}) {
    const obj = toJSON(orderDoc) || {};
    return {
      ...obj,
      id: String(obj.id || obj._id || ''),
      orderId: String(obj.id || obj._id || ''),
      externalOrderId: String(obj.manufacturerDispatch?.externalOrderId || obj.status_integracao || ''),
      manufacturer: String(obj.manufacturer || obj.manufacturerDispatch?.payload?.manufacturer || ''),
      status: String(obj.status || ''),
      statusLabel: String(obj.statusLabel || obj.status || ''),
      trackingCode: String(obj.trackingCode || ''),
      items: Array.isArray(obj.items) ? obj.items : [],
      total: Number(obj.total || 0),
      subtotal: Number(obj.subtotal || 0),
      shippingCost: Number(obj.shippingCost || 0),
      customerName: String(obj.customerName || ''),
      customerEmail: String(obj.customerEmail || ''),
      customerPhone: String(obj.customerPhone || '')
    };
  }

  function enterpriseStatusLabel(status = '') {
    const key = String(status || '').toLowerCase().trim();
    const map = {
      received: 'Pedido recebido',
      enterprise_recebido: 'Pedido Enterprise recebido',
      preparing: 'Em preparação',
      accepted: 'Pedido aceito',
      confirmed: 'Pedido confirmado',
      shipped: 'Pedido enviado',
      enviado: 'Pedido enviado',
      delivered: 'Pedido entregue',
      cancelled: 'Pedido cancelado',
      canceled: 'Pedido cancelado',
      enterprise_cancelado: 'Pedido cancelado pelo Enterprise',
      enterprise_nfe_recebida: 'NF-e recebida',
      enterprise_rastreio_recebido: 'Rastreio recebido'
    };
    return map[key] || String(status || 'Atualizado');
  }

  function enterprisePartnerLogDTO(log = {}) {
    const endpoint = String(log.metadata?.endpoint || log.metadata?.path || log.request?.path || log.eventType || '').trim();
    return {
      id: String(log._id || ''),
      eventType: log.eventType || '',
      endpoint,
      status: log.status || '',
      statusCode: log.statusCode || null,
      message: log.message || '',
      manufacturer: log.manufacturer || '',
      orderId: log.orderId || '',
      createdAt: log.createdAt || null,
      request: log.request || null,
      response: log.response || null,
      metadata: log.metadata || null,
      durationMs: Number(log.metadata?.durationMs || log.metadata?.totalMs || 0)
    };
  }

  function enterpriseLogsCsv(rows = []) {
    const cols = ['createdAt', 'eventType', 'endpoint', 'statusCode', 'status', 'message', 'manufacturer', 'orderId', 'durationMs'];
    const esc = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    return [cols.join(';'), ...rows.map((r) => cols.map((c) => esc(r[c])).join(';'))].join('\n');
  }

  return {
    createEnterpriseRequestId,
    createEnterprisePartnerId,
    enterpriseRandomKey,
    enterpriseCreateApiKey,
    enterpriseCreateOAuthId,
    enterpriseCreateWebhookSecret,
    enterpriseCompatNumber,
    enterpriseCompatProductPayload,
    enterpriseNormalizeOrderForResponse,
    enterpriseStatusLabel,
    enterprisePartnerLogDTO,
    enterpriseLogsCsv
  };
}
