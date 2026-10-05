import express from 'express';
import mongoose from 'mongoose';
import { fetchDsliteBetoCatalog, DSLITE_BETO_APPROVED_SKUS, DSLITE_BETO_SUPPLIER_ID } from '../services/dsliteIntegrationService.js';

const app = express();
const port = Number(process.env.PORT || 10000);
const mongoUri = String(process.env.MONGODB_URI || '').trim();
const mongoDb = String(process.env.MONGODB_DB || 'ariana_moveis_db').trim();
const SHADOW_COLLECTION = 'dslite_beto_shadow_products';

app.disable('x-powered-by');

let mongoReady = false;
let lastShadowSync = null;

const shadowSchema = new mongoose.Schema({
  sku: { type: String, required: true, unique: true, index: true },
  supplierId: { type: Number, index: true },
  supplier: String,
  name: String,
  brand: String,
  category: String,
  rawCategory: String,
  supplierCost: Number,
  supplierStock: Number,
  ean: String,
  image: String,
  imageUrls: [String],
  imageCount: Number,
  parentSku: String,
  variationGroup: String,
  status: String,
  active: { type: Boolean, default: false },
  storefrontPublishEnabled: { type: Boolean, default: false },
  shadowOnly: { type: Boolean, default: true },
  fetchedAt: Date,
  syncedAt: Date
}, { strict: true, timestamps: true, collection: SHADOW_COLLECTION });

const ShadowProduct = mongoose.models.DsliteBetoShadowProduct || mongoose.model('DsliteBetoShadowProduct', shadowSchema, SHADOW_COLLECTION);

async function connectMongo() {
  if (!mongoUri) {
    console.warn('[dslite-beto-shadow] MONGODB_URI não configurada; modo somente preview.');
    return false;
  }
  if (mongoose.connection.readyState === 1) {
    mongoReady = true;
    return true;
  }
  await mongoose.connect(mongoUri, { dbName: mongoDb });
  mongoReady = true;
  console.log(`[dslite-beto-shadow] Mongo conectado em ${mongoDb}; coleção isolada ${SHADOW_COLLECTION}.`);
  return true;
}

async function recoverLastShadowSync() {
  if (!mongoReady) return null;
  const latest = await ShadowProduct.findOne({ syncedAt: { $ne: null } })
    .sort({ syncedAt: -1 })
    .select({ syncedAt: 1, updatedAt: 1, _id: 0 })
    .lean();
  if (!latest?.syncedAt) return null;
  return {
    ok: true,
    collection: SHADOW_COLLECTION,
    total: await ShadowProduct.countDocuments({}),
    approved: DSLITE_BETO_APPROVED_SKUS.length,
    syncedAt: latest.syncedAt,
    recoveredFromCollection: true,
    writesRestrictedToShadowCollection: true,
    storefrontPublishEnabled: false
  };
}

async function syncShadowCollection() {
  if (!mongoReady) await connectMongo();
  if (!mongoReady) throw new Error('Mongo shadow indisponível.');

  const catalog = await fetchDsliteBetoCatalog({ timeoutMs: 30000 });
  if (catalog.approvedCount !== DSLITE_BETO_APPROVED_SKUS.length) {
    const error = new Error(`Catálogo incompleto: ${catalog.approvedCount}/${DSLITE_BETO_APPROVED_SKUS.length} SKUs aprovados.`);
    error.code = 'DSLITE_CATALOG_INCOMPLETE';
    throw error;
  }

  let created = 0;
  let updated = 0;
  const now = new Date();
  const seenSkus = [];

  for (const item of catalog.products) {
    const sku = String(item.sku || '').trim();
    if (!sku) continue;
    seenSkus.push(sku);

    const doc = {
      sku,
      supplierId: DSLITE_BETO_SUPPLIER_ID,
      supplier: 'Beto Móveis',
      name: item.name,
      brand: item.brand || 'Beto Móveis',
      category: item.category,
      rawCategory: item.rawCategory,
      supplierCost: item.supplierCost,
      supplierStock: item.supplierStock,
      ean: item.ean || '',
      image: item.imageUrls?.[0] || '',
      imageUrls: item.imageUrls || [],
      imageCount: item.imageUrls?.length || 0,
      parentSku: item.parentSku || '',
      variationGroup: item.variationGroup || sku,
      status: item.status || 'Ativo',
      active: false,
      storefrontPublishEnabled: false,
      shadowOnly: true,
      fetchedAt: catalog.fetchedAt,
      syncedAt: now
    };

    const result = await ShadowProduct.updateOne(
      { sku },
      { $set: doc, $setOnInsert: { createdAt: now } },
      { upsert: true }
    );
    if (result.upsertedCount) created += 1;
    else if (result.matchedCount) updated += 1;
  }

  await ShadowProduct.updateMany(
    { sku: { $nin: seenSkus } },
    { $set: { supplierStock: 0, active: false, storefrontPublishEnabled: false, shadowOnly: true, syncedAt: now } }
  );

  lastShadowSync = {
    ok: true,
    collection: SHADOW_COLLECTION,
    created,
    updated,
    total: await ShadowProduct.countDocuments({}),
    approved: catalog.approvedCount,
    syncedAt: now,
    writesRestrictedToShadowCollection: true,
    storefrontPublishEnabled: false
  };
  return lastShadowSync;
}

app.get('/', async (_req, res) => {
  if (!lastShadowSync && mongoReady) lastShadowSync = await recoverLastShadowSync();
  res.json({
    ok: true,
    service: 'Ariana DSLite Beto Shadow',
    mode: 'shadow_db',
    supplier: 'Beto Móveis',
    supplierId: DSLITE_BETO_SUPPLIER_ID,
    approvedSkuCount: DSLITE_BETO_APPROVED_SKUS.length,
    tokenConfigured: Boolean(String(process.env.DSLITE_API_TOKEN || process.env.DSLITE_TOKEN || '').trim()),
    mongoConfigured: Boolean(mongoUri),
    mongoReady,
    shadowCollection: SHADOW_COLLECTION,
    writesRestrictedToShadowCollection: true,
    storefrontPublishEnabled: false,
    lastShadowSync
  });
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    mode: 'shadow_db',
    mongoReady,
    shadowCollection: SHADOW_COLLECTION,
    writesRestrictedToShadowCollection: true,
    storefrontPublishEnabled: false
  });
});

app.get('/preview', async (_req, res) => {
  try {
    const catalog = await fetchDsliteBetoCatalog({ timeoutMs: 30000 });
    const products = catalog.products.map((item) => ({
      sku: item.sku,
      name: item.name,
      brand: item.brand,
      category: item.category,
      rawCategory: item.rawCategory,
      supplierCost: item.supplierCost,
      supplierStock: item.supplierStock,
      ean: item.ean,
      image: item.imageUrls?.[0] || '',
      imageCount: item.imageUrls?.length || 0,
      parentSku: item.parentSku || '',
      variationGroup: item.variationGroup || item.sku,
      status: item.status
    }));

    res.json({
      ok: true,
      mode: 'shadow_db',
      writesRestrictedToShadowCollection: true,
      storefrontPublishEnabled: false,
      supplier: catalog.supplier,
      supplierId: catalog.supplierId,
      fetchedAt: catalog.fetchedAt,
      totalParsed: catalog.totalParsed,
      approvedCount: catalog.approvedCount,
      expectedApprovedCount: catalog.expectedApprovedCount,
      diagnostics: catalog.diagnostics,
      products
    });
  } catch (error) {
    res.status(error?.code === 'DSLITE_TOKEN_MISSING' ? 503 : 502).json({
      ok: false,
      mode: 'shadow_db',
      writesRestrictedToShadowCollection: true,
      storefrontPublishEnabled: false,
      code: error?.code || 'DSLITE_PREVIEW_ERROR',
      error: error?.message || 'Falha ao consultar catálogo DSLite.'
    });
  }
});

app.get('/shadow-status', async (_req, res) => {
  try {
    if (!mongoReady) await connectMongo();
    const total = mongoReady ? await ShadowProduct.countDocuments({}) : 0;
    const withImages = mongoReady ? await ShadowProduct.countDocuments({ image: { $ne: '' } }) : 0;
    const activePublic = mongoReady ? await ShadowProduct.countDocuments({ $or: [{ active: true }, { storefrontPublishEnabled: true }] }) : 0;
    if (!lastShadowSync && mongoReady) lastShadowSync = await recoverLastShadowSync();
    res.json({
      ok: true,
      mongoReady,
      collection: SHADOW_COLLECTION,
      total,
      withImages,
      activePublic,
      storefrontPublishEnabled: false,
      writesRestrictedToShadowCollection: true,
      lastShadowSync
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error?.message || 'Falha ao consultar shadow.' });
  }
});

app.listen(port, '0.0.0.0', async () => {
  console.log(`[dslite-beto-shadow] online na porta ${port} | coleção isolada ${SHADOW_COLLECTION} | sem publicação`);
  try {
    await connectMongo();
    if (mongoReady) {
      lastShadowSync = await recoverLastShadowSync();
      const summary = await syncShadowCollection();
      console.log('[dslite-beto-shadow] sincronização inicial concluída:', JSON.stringify(summary));
    }
  } catch (error) {
    console.error('[dslite-beto-shadow] sincronização inicial não executada:', error?.code || '', error?.message || error);
  }
});
