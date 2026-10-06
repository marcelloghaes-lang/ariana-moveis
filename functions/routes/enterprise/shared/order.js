// ============================================================
// ENTERPRISE SHARED - ORDER
// Funções compartilhadas de pedidos/produtos Enterprise.
// Extraído de routes/enterpriseRoutes.js sem alterar regras ou respostas.
// ============================================================

export function createEnterpriseOrder(context = {}) {
  const {
    getEnterpriseCompatKey,
    enterpriseCompatAuth,
    jwt,
    JWT_SECRET,
    normalizeObjectId,
    Order,
    Product,
    normalizeProductForResponse
  } = context;

  async function enterpriseCompatFindOrder(orderId = '') {
    const id = String(orderId || '').trim();
    if (!id) return null;

    const oid = normalizeObjectId(id);
    if (oid) {
      const byId = await Order.findById(oid);
      if (byId) return byId;
    }

    return Order.findOne({
      $or: [
        { 'manufacturerDispatch.externalOrderId': id },
        { 'manufacturerDispatch.orderId': id },
        { 'manufacturerDispatch.enterpriseOrderId': id },
        { status_integracao: id },
        { trackingCode: id }
      ]
    });
  }

  async function enterpriseOrderOperationAuth(req, res, next) {
    const apiKey = getEnterpriseCompatKey(req);
    if (apiKey) return enterpriseCompatAuth(req, res, next);

    const header = String(req.headers.authorization || '').trim();
    const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
    if (!token) return res.status(401).json({ ok: false, error: 'Token ausente' });

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (!decoded || decoded.role !== 'enterprise_partner') {
        return res.status(403).json({ ok: false, error: 'Token Enterprise inválido' });
      }
      req.enterprisePortal = decoded;
      req.enterprisePartner = {
        id: decoded.partnerId || '',
        requestId: decoded.requestId || '',
        companyName: decoded.companyName || '',
        tradeName: decoded.tradeName || '',
        environment: decoded.environment || 'sandbox',
        permissions: Array.isArray(decoded.permissions) ? decoded.permissions : []
      };
      return next();
    } catch (_error) {
      return res.status(401).json({ ok: false, error: 'Token Enterprise expirado ou inválido' });
    }
  }

  function enterprisePartnerProductScope(partner = {}) {
    return [
      partner.requestId,
      partner.partnerId,
      partner.id,
      partner._id,
      partner.tradeName,
      partner.companyName
    ].map((v) => String(v || '').trim()).filter(Boolean);
  }

  function enterpriseRequirePermission(req, res, permission = '') {
    const permissions = req.enterprisePartner?.permissions || [];
    if (permissions.includes('*')) return true;
    const normalized = permissions.map((p) => String(p || '').toLowerCase());
    if (!permission || normalized.includes(String(permission).toLowerCase())) return true;
    res.status(403).json({ ok: false, error: `Permissão Enterprise ausente: ${permission}` });
    return false;
  }

  function enterpriseProductSkuFromBody(req) {
    return String(
      req.params?.sku ||
      req.body?.sku ||
      req.body?.codigo ||
      req.body?.productSku ||
      req.query?.sku ||
      ''
    ).trim();
  }

  async function enterpriseFindProductBySkuForPartner(sku = '', partner = {}) {
    const cleanSku = String(sku || '').trim();
    if (!cleanSku) return null;

    const sellerIds = enterprisePartnerProductScope(partner);
    const or = [
      { sku: cleanSku },
      { codigo: cleanSku },
      { productSku: cleanSku }
    ];

    const scoped = sellerIds.length
      ? {
          $and: [
            { $or: or },
            { $or: sellerIds.flatMap((id) => ([
              { sellerId: id },
              { manufacturer: id },
              { 'metadata.enterprisePartnerId': id }
            ])) }
          ]
        }
      : { $or: or };

    let product = await Product.findOne(scoped);
    if (product) return product;

    // Compatibilidade com produtos antigos que foram criados sem escopo correto.
    return Product.findOne({ sku: cleanSku });
  }

  function enterpriseProductResponse(productDoc = {}) {
    const obj = normalizeProductForResponse(productDoc);
    return {
      id: String(obj._id || obj.id || ''),
      sellerId: obj.sellerId || '',
      sellerName: obj.sellerName || '',
      sku: obj.sku || '',
      name: obj.name || '',
      price: obj.price || 0,
      stock: obj.stock || 0,
      active: obj.active !== false,
      updatedAt: obj.updatedAt || null
    };
  }

  return {
    enterpriseCompatFindOrder,
    enterpriseOrderOperationAuth,
    enterprisePartnerProductScope,
    enterpriseRequirePermission,
    enterpriseProductSkuFromBody,
    enterpriseFindProductBySkuForPartner,
    enterpriseProductResponse
  };
}
