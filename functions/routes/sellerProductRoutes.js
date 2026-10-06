import express from 'express';

function escapeRegex(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function collectSellerKeys(req = {}) {
  const keys = new Set();
  const seller = req.seller || {};
  const user = req.user || {};
  [
    req.sellerId,
    seller.sellerId,
    seller._id,
    seller.id,
    user.sellerId
  ].forEach((value) => {
    const clean = String(value || '').trim();
    if (clean) keys.add(clean);
  });
  return Array.from(keys);
}

function collectSellerNames(req = {}) {
  const seller = req.seller || {};
  const user = req.user || {};
  return [
    seller.storeName,
    seller.displayName,
    seller.name,
    seller.email,
    user.name,
    user.email
  ].map((value) => String(value || '').trim()).filter(Boolean);
}

function sellerProductFilter(req = {}) {
  const sellerKeys = collectSellerKeys(req);
  const or = [];
  if (sellerKeys.length) {
    or.push({ sellerId: { $in: sellerKeys } });
    or.push({ seller_id: { $in: sellerKeys } });
    or.push({ vendorId: { $in: sellerKeys } });
    or.push({ manufacturer: { $in: sellerKeys } });
  }
  if (!or.length) return { _id: null };
  return { $or: or };
}

async function findSellerProducts(Product, req, query = {}) {
  const limit = Math.min(Number(query.limit || 500), 1000);
  const sortBy = String(query.sortBy || 'updatedAt');
  const sortDir = String(query.sortDir || 'desc').toLowerCase() === 'asc' ? 1 : -1;
  const search = String(query.q || query.search || '').trim();
  const baseFilter = sellerProductFilter(req);
  const and = [baseFilter];
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    and.push({ $or: [{ name: rx }, { sku: rx }, { category: rx }, { categoryName: rx }, { brand: rx }] });
  }
  let rows = await Product.find(and.length > 1 ? { $and: and } : baseFilter).sort({ [sortBy]: sortDir }).limit(limit);

  // Fallback controlado para produtos antigos cadastrados sem sellerId,
  // usando o nome/loja/e-mail do seller. Evita tela vazia quando o dado legado existe.
  if (!rows.length) {
    const names = collectSellerNames(req);
    const nameOr = names.map((name) => {
      const rx = new RegExp(`^${escapeRegex(name)}$`, 'i');
      return { $or: [{ sellerName: rx }, { storeName: rx }, { vendorName: rx }, { manufacturer: rx }] };
    });
    if (nameOr.length) {
      rows = await Product.find({ $or: nameOr }).sort({ [sortBy]: sortDir }).limit(limit);
    }
  }
  return rows;
}

function publicSellerFilter(sellerId = '') {
  const id = String(sellerId || '').trim();
  if (!id) return { _id: null };
  const rx = new RegExp(`^${escapeRegex(id)}$`, 'i');
  return {
    active: { $ne: false },
    $or: [
      { sellerId: id },
      { seller_id: id },
      { vendorId: id },
      { manufacturer: id },
      { sellerName: rx },
      { storeName: rx },
      { vendorName: rx }
    ]
  };
}

// ============================================================
// PROTEÇÃO DE IMAGENS DO PRODUTO SELLER
// Garante que os links retornados pelo Cloudinary não sejam perdidos
// entre o frontend, productPayloadFromBody e o MongoDB.
// ============================================================
function forceProductImages(payload = {}, body = {}) {
  const images = asArray(body.images || payload.images)
    .map((img, index) => {
      if (!img) return null;

      if (typeof img === 'string') {
        const url = String(img || '').trim();
        if (!url) return null;
        return {
          url,
          path: url,
          name: `imagem_${index + 1}`,
          isMain: index === 0
        };
      }

      const url = String(img.url || img.imageUrl || img.secure_url || img.secureUrl || img.downloadURL || img.downloadUrl || img.image || '').trim();
      if (!url) return null;

      return {
        ...img,
        url,
        path: String(img.path || img.public_id || img.publicId || img.fullPath || img.filePath || url).trim(),
        name: String(img.name || img.originalname || `imagem_${index + 1}`).trim(),
        isMain: img.isMain === true || img.main === true || index === 0,
        public_id: String(img.public_id || img.publicId || '').trim(),
        contentType: String(img.contentType || img.mimetype || '').trim() || undefined
      };
    })
    .filter(Boolean);

  const flatUrls = asArray(body.imageUrls || payload.imageUrls)
    .map((url) => String(url || '').trim())
    .filter(Boolean);

  const flatPaths = asArray(body.imagePaths || payload.imagePaths)
    .map((pathValue) => String(pathValue || '').trim());

  flatUrls.forEach((url, index) => {
    if (!images.some((img) => img.url === url)) {
      images.push({
        url,
        path: flatPaths[index] || url,
        name: `imagem_${images.length + 1}`,
        isMain: images.length === 0
      });
    }
  });

  const directMainUrl = String(
    body.mainImageUrl ||
    body.imageUrl ||
    body.image ||
    body.imagem ||
    body.thumbnail ||
    payload.mainImageUrl ||
    payload.imageUrl ||
    payload.image ||
    payload.imagem ||
    payload.thumbnail ||
    ''
  ).trim();

  if (directMainUrl && !images.some((img) => img.url === directMainUrl || img.path === directMainUrl)) {
    images.unshift({
      url: directMainUrl,
      path: String(body.mainImagePath || payload.mainImagePath || directMainUrl).trim(),
      name: 'principal',
      isMain: true
    });
  }

  if (images.length && !images.some((img) => img.isMain)) {
    images[0].isMain = true;
  }

  const main = images.find((img) => img.isMain) || images[0] || null;
  const mainUrl = main?.url || directMainUrl || '';
  const mainPath = main?.path || String(body.mainImagePath || payload.mainImagePath || mainUrl || '').trim();

  payload.images = images;
  payload.imageUrls = images.map((img) => img.url).filter(Boolean);
  payload.imagePaths = images.map((img) => img.path || img.url).filter(Boolean);
  payload.image = mainUrl;
  payload.imageUrl = mainUrl;
  payload.imagem = mainUrl;
  payload.mainImageUrl = mainUrl;
  payload.mainImagePath = mainPath;
  payload.thumbnail = mainUrl;

  return payload;
}

export default function createSellerProductRoutes(deps = {}) {
  const router = express.Router();
  const {
    Product,
    sellerAuthRequired,
    toJSON = (doc) => doc,
    normalizeObjectId = () => null,
    normalizeProductForResponse = (doc) => toJSON(doc),
    productPayloadFromBody = (body) => body,
    uid = (prefix = 'id') => `${prefix}_${Date.now()}`,
    now = () => new Date()
  } = deps;

  if (!Product) throw new Error('Product não informado em sellerProductRoutes');
  if (!sellerAuthRequired) throw new Error('sellerAuthRequired não informado em sellerProductRoutes');

  router.get('/seller/products', sellerAuthRequired, async (req, res) => {
    try {
      const rows = await findSellerProducts(Product, req, req.query || {});
      return res.json(rows.map(normalizeProductForResponse));
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar produtos do seller' });
    }
  });

  router.post('/seller/products', sellerAuthRequired, async (req, res) => {
    try {
      const payload = forceProductImages(
        productPayloadFromBody(req.body || {}),
        req.body || {}
      );

      payload.sellerId = String(req.sellerId || '').trim();
      payload.sellerName = String(req.seller?.storeName || req.seller?.displayName || req.user?.name || payload.sellerName || '').trim();
      payload.sku = payload.sku || uid('sku');
      payload.updatedAt = now();

      if (!payload.name) return res.status(400).json({ ok: false, error: 'Nome do produto é obrigatório' });

      const product = await Product.create(payload);
      return res.json({ ok: true, product: normalizeProductForResponse(product) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao cadastrar produto do seller' });
    }
  });

  router.get('/seller/products/:id', sellerAuthRequired, async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      const oid = normalizeObjectId(id);
      const accessFilter = sellerProductFilter(req);
      const product = await Product.findOne({
        $and: [
          oid ? { $or: [{ _id: oid }, { id }, { sku: id }] } : { $or: [{ id }, { sku: id }, { slug: id }] },
          accessFilter
        ]
      });
      if (!product) return res.status(404).json({ ok: false, error: 'Produto não encontrado para este seller' });
      return res.json({ ok: true, product: normalizeProductForResponse(product) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar produto do seller' });
    }
  });

  router.put('/seller/products/:id', sellerAuthRequired, async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      const oid = normalizeObjectId(id);
      const accessFilter = sellerProductFilter(req);
      const existing = await Product.findOne({
        $and: [
          oid ? { $or: [{ _id: oid }, { id }, { sku: id }] } : { $or: [{ id }, { sku: id }, { slug: id }] },
          accessFilter
        ]
      });
      if (!existing) return res.status(404).json({ ok: false, error: 'Produto não encontrado para este seller' });

      const payload = forceProductImages(
        productPayloadFromBody(req.body || {}, existing),
        req.body || {}
      );

      payload.sellerId = existing.sellerId || String(req.sellerId || '').trim();
      payload.sellerName = existing.sellerName || String(req.seller?.storeName || req.seller?.displayName || req.user?.name || '').trim();
      payload.updatedAt = now();

      Object.assign(existing, payload);
      await existing.save();
      return res.json({ ok: true, product: normalizeProductForResponse(existing) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao atualizar produto do seller' });
    }
  });

  router.patch('/seller/products/:id', sellerAuthRequired, async (req, res) => {
    req.method = 'PUT';
    return router.handle(req, res);
  });

  router.delete('/seller/products/:id', sellerAuthRequired, async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      const oid = normalizeObjectId(id);
      const accessFilter = sellerProductFilter(req);
      const product = await Product.findOne({
        $and: [
          oid ? { $or: [{ _id: oid }, { id }, { sku: id }] } : { $or: [{ id }, { sku: id }, { slug: id }] },
          accessFilter
        ]
      });
      if (!product) return res.status(404).json({ ok: false, error: 'Produto não encontrado para este seller' });
      await product.deleteOne();
      return res.json({ ok: true, deleted: true, id });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao excluir produto do seller' });
    }
  });

  router.get('/seller/:sellerId/products', async (req, res) => {
    try {
      const rows = await Product.find(publicSellerFilter(req.params.sellerId)).sort({ updatedAt: -1 }).limit(Math.min(Number(req.query.limit || 500), 1000));
      return res.json(rows.map(normalizeProductForResponse));
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar produtos públicos do seller' });
    }
  });

  router.get('/sellers/:sellerId/products', async (req, res) => {
    try {
      const rows = await Product.find(publicSellerFilter(req.params.sellerId)).sort({ updatedAt: -1 }).limit(Math.min(Number(req.query.limit || 500), 1000));
      return res.json(rows.map(normalizeProductForResponse));
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar produtos públicos do seller' });
    }
  });

  return router;
}
