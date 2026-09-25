import mongoose from 'mongoose';

const clean = (value = '', max = 1000) => String(value ?? '').trim().slice(0, max);
const money = (value = 0) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const allowedQueueStatus = new Set(['pending_purchase','ordered_with_supplier','supplier_processing','shipped','delivered','cancelled']);

function fail(message, statusCode = 400, code = 'ERP_DROPSHIPPING_ERROR') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function actorName(actor = {}) {
  return clean(actor.name || actor.email || actor.id || actor._id || 'Administrador', 180);
}

function serial(doc) {
  if (!doc) return doc;
  if (typeof doc.toObject === 'function') return doc.toObject({ virtuals: true });
  return { ...doc };
}

function validObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || ''));
}

function normalizeDropshippingProduct(row = {}) {
  const obj = serial(row) || {};
  return {
    id: String(obj._id || obj.id || ''),
    name: obj.name || '',
    sku: obj.sku || '',
    description: obj.description || '',
    brand: obj.brand || '',
    category: obj.categoryName || obj.category || '',
    price: Number(obj.price || 0),
    pixPrice: Number(obj.pixPrice ?? obj.price ?? 0),
    stock: Number(obj.stock || 0),
    active: obj.active !== false,
    storefrontStatus: obj.storefrontStatus || '',
    image: obj.mainImageUrl || obj.imageUrl || obj.image || '',
    dropshipping: obj.dropshipping || null
  };
}

export function createErpDropshippingService(context = {}) {
  const Product = context.Product || mongoose.models.Product;
  const Order = context.Order || mongoose.models.Order;
  const Supplier = mongoose.models.ErpSupplier;

  if (!Product) throw new Error('[erp-dropshipping] Product não informado');
  if (!Order) throw new Error('[erp-dropshipping] Order não informado');
  if (!Supplier) throw new Error('[erp-dropshipping] ErpSupplier não inicializado');

  async function assertSupplier(id) {
    if (!validObjectId(id)) throw fail('Fornecedor inválido.', 400, 'DROPSHIP_SUPPLIER_INVALID');
    const supplier = await Supplier.findById(id);
    if (!supplier) throw fail('Fornecedor não encontrado.', 404, 'DROPSHIP_SUPPLIER_NOT_FOUND');
    if (supplier.active === false) throw fail('Fornecedor está inativo.', 409, 'DROPSHIP_SUPPLIER_INACTIVE');
    if (String(supplier.supplierType || '') !== 'dropshipping') {
      throw fail('Este fornecedor ainda não está marcado como dropshipping.', 409, 'DROPSHIP_SUPPLIER_TYPE_REQUIRED');
    }
    return supplier;
  }

  async function listSuppliers(query = {}) {
    const filter = { supplierType: 'dropshipping' };
    if (query.active === 'true') filter.active = true;
    if (query.active === 'false') filter.active = false;
    const q = clean(query.q || query.search || '', 160);
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { tradeName: rx }, { document: rx }, { website: rx }];
    }
    return Supplier.find(filter).sort({ name: 1 }).limit(1000).lean();
  }

  async function setupAtacadum(actor = {}) {
    let supplier = await Supplier.findOne({
      $or: [
        { website: /atacadum\.com\.br/i },
        { name: /^atacadum$/i },
        { tradeName: /^atacadum$/i }
      ]
    });

    const seed = {
      name: 'Atacadum',
      tradeName: 'Atacadum',
      supplierType: 'dropshipping',
      website: 'https://atacadum.com.br',
      active: true,
      dropshipping: {
        enabled: true,
        catalogMode: 'manual',
        integrationMode: 'manual',
        integrationStatus: 'pending_commercial',
        neutralPackaging: null,
        allowsOwnLabel: null,
        shippingSlaDays: 0,
        warrantyDays: 0,
        invoiceModel: 'a_confirmar',
        returnPolicyNotes: '',
        credentialEnvName: ''
      },
      updatedBy: actorName(actor)
    };

    if (supplier) {
      Object.assign(supplier, {
        supplierType: 'dropshipping',
        website: supplier.website || seed.website,
        dropshipping: { ...seed.dropshipping, ...(supplier.dropshipping || {}), enabled: true },
        updatedBy: actorName(actor)
      });
      await supplier.save();
      return supplier.toObject();
    }

    supplier = await Supplier.create({
      ...seed,
      notes: 'Fornecedor preparado para operação dropshipping. Dados comerciais, fiscais, SLA, embalagem e integração devem ser confirmados antes da automação.',
      createdBy: actorName(actor)
    });
    return supplier.toObject();
  }

  async function listProducts(query = {}) {
    const filter = { 'dropshipping.enabled': true };
    if (query.supplierId) filter['dropshipping.supplierId'] = clean(query.supplierId, 80);
    if (query.storefrontStatus) filter.storefrontStatus = clean(query.storefrontStatus, 60);
    const q = clean(query.q || query.search || '', 160);
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { name: rx },
        { sku: rx },
        { 'dropshipping.supplierSku': rx },
        { 'dropshipping.supplierName': rx }
      ];
    }
    const rows = await Product.find(filter).sort({ updatedAt: -1 }).limit(2000);
    return rows.map(normalizeDropshippingProduct);
  }

  async function createDraftProduct(payload = {}, actor = {}) {
    const supplier = await assertSupplier(payload.supplierId);
    const name = clean(payload.name, 260);
    if (!name) throw fail('Informe o nome do produto.', 400, 'DROPSHIP_PRODUCT_NAME_REQUIRED');

    const supplierSku = clean(payload.supplierSku || payload.sku, 140);
    if (!supplierSku) throw fail('Informe o SKU/código do fornecedor.', 400, 'DROPSHIP_SUPPLIER_SKU_REQUIRED');

    const localSku = clean(payload.sku || ('DROP-' + supplierSku), 140);
    const existing = await Product.findOne({
      $or: [
        { sku: localSku },
        { 'dropshipping.supplierId': String(supplier._id), 'dropshipping.supplierSku': supplierSku }
      ]
    }).lean();

    if (existing) {
      throw fail('Este produto/SKU já está cadastrado no Ariana ERP.', 409, 'DROPSHIP_PRODUCT_EXISTS');
    }

    const externalStock = Math.max(0, Math.floor(Number(payload.externalStock || 0)));
    const costPrice = Math.max(0, money(payload.costPrice || 0));
    const price = Math.max(0, money(payload.price || 0));

    const product = await Product.create({
      sellerId: 'ArianaMoveis',
      sellerName: 'Ariana Móveis',
      name,
      sku: localSku,
      description: clean(payload.description, 5000),
      brand: clean(payload.brand, 160),
      category: clean(payload.category, 180),
      categoryName: clean(payload.categoryName || payload.category, 180),
      price,
      pixPrice: price > 0 ? price : null,
      stock: externalStock,
      active: true,
      storefrontStatus: 'pending_review',
      storefrontSource: 'dropshipping',
      storefrontSubmittedAt: new Date(),
      dropshipping: {
        enabled: true,
        supplierId: String(supplier._id),
        supplierName: supplier.name,
        supplierSku,
        costPrice,
        externalStock,
        stockMode: 'external',
        supplierProductUrl: clean(payload.supplierProductUrl, 1000),
        supplierImageUrl: clean(payload.supplierImageUrl, 1000),
        shippingSlaDays: Math.max(0, Number(payload.shippingSlaDays ?? supplier.dropshipping?.shippingSlaDays ?? 0)),
        notes: clean(payload.notes, 1500),
        lastStockSyncAt: new Date(),
        createdBy: actorName(actor)
      },
      specs: payload.specs && typeof payload.specs === 'object' ? payload.specs : {}
    });

    return normalizeDropshippingProduct(product);
  }

  async function updateProduct(id, payload = {}, actor = {}) {
    if (!validObjectId(id)) throw fail('Produto inválido.', 400, 'DROPSHIP_PRODUCT_INVALID');
    const product = await Product.findById(id);
    if (!product) throw fail('Produto não encontrado.', 404, 'DROPSHIP_PRODUCT_NOT_FOUND');

    const current = product.dropshipping && typeof product.dropshipping === 'object'
      ? { ...product.dropshipping }
      : {};

    let supplier = null;
    if (payload.supplierId || current.supplierId) {
      supplier = await assertSupplier(payload.supplierId || current.supplierId);
    }

    const next = {
      ...current,
      enabled: payload.enabled !== undefined ? payload.enabled !== false : true,
      supplierId: supplier ? String(supplier._id) : clean(current.supplierId, 80),
      supplierName: supplier ? supplier.name : clean(current.supplierName, 220),
      supplierSku: payload.supplierSku !== undefined ? clean(payload.supplierSku, 140) : clean(current.supplierSku, 140),
      costPrice: payload.costPrice !== undefined ? Math.max(0, money(payload.costPrice)) : Math.max(0, money(current.costPrice || 0)),
      externalStock: payload.externalStock !== undefined ? Math.max(0, Math.floor(Number(payload.externalStock || 0))) : Math.max(0, Number(current.externalStock || 0)),
      stockMode: 'external',
      supplierProductUrl: payload.supplierProductUrl !== undefined ? clean(payload.supplierProductUrl, 1000) : clean(current.supplierProductUrl, 1000),
      supplierImageUrl: payload.supplierImageUrl !== undefined ? clean(payload.supplierImageUrl, 1000) : clean(current.supplierImageUrl, 1000),
      shippingSlaDays: payload.shippingSlaDays !== undefined ? Math.max(0, Number(payload.shippingSlaDays || 0)) : Math.max(0, Number(current.shippingSlaDays || 0)),
      notes: payload.notes !== undefined ? clean(payload.notes, 1500) : clean(current.notes, 1500),
      lastStockSyncAt: payload.externalStock !== undefined ? new Date() : (current.lastStockSyncAt || null),
      updatedBy: actorName(actor),
      updatedAt: new Date()
    };

    product.dropshipping = next;
    if (payload.externalStock !== undefined) product.stock = next.externalStock;
    if (payload.price !== undefined) {
      const price = Math.max(0, money(payload.price));
      product.price = price;
      product.pixPrice = price > 0 ? price : null;
    }
    if (payload.name !== undefined) product.name = clean(payload.name, 260);
    if (payload.description !== undefined) product.description = clean(payload.description, 5000);
    if (payload.category !== undefined) {
      product.category = clean(payload.category, 180);
      product.categoryName = clean(payload.category, 180);
    }
    await product.save();
    return normalizeDropshippingProduct(product);
  }

  function paymentApproved(order = {}) {
    const orderStatus = clean(order.status, 60).toLowerCase();
    const paymentStatus = clean(order.paymentStatus || order.payment?.status, 60).toLowerCase();
    return ['pago','paid','aprovado','approved','processing','em_preparacao'].includes(orderStatus)
      || ['paid','approved','aprovado'].includes(paymentStatus);
  }

  async function listOrders(query = {}) {
    const limit = Math.min(1000, Math.max(1, Number(query.limit || 300)));
    const rows = await Order.find({
      $or: [
        { status: { $in: ['pago','paid','aprovado','approved','processing','em_preparacao'] } },
        { paymentStatus: { $in: ['paid','approved','aprovado'] } },
        { 'payment.status': { $in: ['paid','approved','aprovado'] } }
      ]
    }).sort({ createdAt: -1 }).limit(limit).lean();

    const productIds = [...new Set(rows.flatMap(order => (order.items || []).map(item => String(item.productId || '')).filter(validObjectId)))];
    if (!productIds.length) return [];

    const products = await Product.find({
      _id: { $in: productIds.map(id => new mongoose.Types.ObjectId(id)) },
      'dropshipping.enabled': true
    }).lean();

    const productMap = new Map(products.map(product => [String(product._id), product]));
    const statusFilter = clean(query.status || '', 60);
    const supplierFilter = clean(query.supplierId || '', 80);
    const search = clean(query.q || query.search || '', 160).toLowerCase();
    const result = [];

    for (const order of rows) {
      if (!paymentApproved(order)) continue;
      const items = (order.items || []).map(item => {
        const product = productMap.get(String(item.productId || ''));
        if (!product) return null;
        const ds = product.dropshipping || {};
        return {
          productId: String(product._id),
          name: item.name || product.name || '',
          sku: item.sku || product.sku || '',
          qty: Number(item.qty || item.quantity || 1),
          supplierId: clean(ds.supplierId, 80),
          supplierName: clean(ds.supplierName, 220),
          supplierSku: clean(ds.supplierSku, 140),
          supplierCost: money(ds.costPrice || 0),
          supplierProductUrl: clean(ds.supplierProductUrl, 1000)
        };
      }).filter(Boolean);

      if (!items.length) continue;
      if (supplierFilter && !items.some(item => item.supplierId === supplierFilter)) continue;

      const state = order.dropshipping && typeof order.dropshipping === 'object' ? order.dropshipping : {};
      const queueStatus = clean(state.status || 'pending_purchase', 60);
      if (statusFilter && statusFilter !== 'all' && queueStatus !== statusFilter) continue;

      const customerName = clean(order.customerName || order.customer?.name || 'Cliente', 220);
      if (search) {
        const haystack = [
          String(order._id || ''),
          customerName,
          clean(order.customerPhone, 80),
          ...items.flatMap(item => [item.name, item.sku, item.supplierSku, item.supplierName])
        ].join(' ').toLowerCase();
        if (!haystack.includes(search)) continue;
      }

      result.push({
        orderId: String(order._id),
        createdAt: order.createdAt,
        status: queueStatus,
        customerName,
        customerPhone: clean(order.customerPhone, 80),
        customerEmail: clean(order.customerEmail, 180),
        shippingAddress: order.shippingAddress || null,
        total: Number(order.total || 0),
        items,
        suppliers: [...new Set(items.map(item => item.supplierName).filter(Boolean))],
        supplierOrderNumber: clean(state.supplierOrderNumber, 120),
        trackingCode: clean(state.trackingCode || order.trackingCode, 160),
        trackingUrl: clean(state.trackingUrl, 1000),
        notes: clean(state.notes, 2000),
        orderedAt: state.orderedAt || null,
        shippedAt: state.shippedAt || null,
        updatedAt: state.updatedAt || null
      });
    }

    return result;
  }

  async function updateOrder(id, payload = {}, actor = {}) {
    if (!validObjectId(id)) throw fail('Pedido inválido.', 400, 'DROPSHIP_ORDER_INVALID');
    const order = await Order.findById(id);
    if (!order) throw fail('Pedido não encontrado.', 404, 'DROPSHIP_ORDER_NOT_FOUND');
    if (!paymentApproved(order)) throw fail('O pedido ainda não possui pagamento aprovado.', 409, 'DROPSHIP_PAYMENT_NOT_APPROVED');

    const status = clean(payload.status || order.dropshipping?.status || 'pending_purchase', 60);
    if (!allowedQueueStatus.has(status)) throw fail('Status dropshipping inválido.', 400, 'DROPSHIP_STATUS_INVALID');

    const previous = order.dropshipping && typeof order.dropshipping === 'object'
      ? { ...order.dropshipping }
      : {};

    const stamp = new Date();
    order.dropshipping = {
      ...previous,
      status,
      supplierOrderNumber: payload.supplierOrderNumber !== undefined ? clean(payload.supplierOrderNumber, 120) : clean(previous.supplierOrderNumber, 120),
      trackingCode: payload.trackingCode !== undefined ? clean(payload.trackingCode, 160) : clean(previous.trackingCode, 160),
      trackingUrl: payload.trackingUrl !== undefined ? clean(payload.trackingUrl, 1000) : clean(previous.trackingUrl, 1000),
      notes: payload.notes !== undefined ? clean(payload.notes, 2000) : clean(previous.notes, 2000),
      orderedAt: status === 'ordered_with_supplier' && !previous.orderedAt ? stamp : (previous.orderedAt || null),
      shippedAt: status === 'shipped' && !previous.shippedAt ? stamp : (previous.shippedAt || null),
      deliveredAt: status === 'delivered' && !previous.deliveredAt ? stamp : (previous.deliveredAt || null),
      updatedAt: stamp,
      updatedBy: actorName(actor)
    };

    if (order.dropshipping.trackingCode && ['shipped','delivered'].includes(status)) {
      const trackingCode = order.dropshipping.trackingCode;
      if (String(order.trackingCode || '') !== trackingCode) {
        order.trackingCode = trackingCode;
        order.trackingHistory = Array.isArray(order.trackingHistory) ? order.trackingHistory : [];
        order.trackingHistory.push({
          status: 'shipped',
          code: trackingCode,
          label: 'Enviado pelo fornecedor dropshipping',
          at: stamp,
          source: 'erp_dropshipping'
        });
      }
    }

    await order.save();
    return serial(order);
  }

  async function dashboard() {
    const [suppliers, products, queue] = await Promise.all([
      Supplier.countDocuments({ supplierType: 'dropshipping', active: { $ne: false } }),
      Product.countDocuments({ 'dropshipping.enabled': true }),
      listOrders({ limit: 500 })
    ]);
    return {
      suppliers,
      products,
      pendingPurchase: queue.filter(row => row.status === 'pending_purchase').length,
      ordered: queue.filter(row => ['ordered_with_supplier','supplier_processing'].includes(row.status)).length,
      shipped: queue.filter(row => row.status === 'shipped').length,
      openOrders: queue.filter(row => !['delivered','cancelled'].includes(row.status)).length
    };
  }

  return {
    listSuppliers,
    setupAtacadum,
    listProducts,
    createDraftProduct,
    updateProduct,
    listOrders,
    updateOrder,
    dashboard
  };
}

export default createErpDropshippingService;
