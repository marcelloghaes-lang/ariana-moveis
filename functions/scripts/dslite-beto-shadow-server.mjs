import express from 'express';
import mongoose from 'mongoose';
import { fetchDsliteBetoCatalog, DSLITE_BETO_APPROVED_SKUS, DSLITE_BETO_SUPPLIER_ID } from '../services/dsliteIntegrationService.js';

const app = express();
const port = Number(process.env.PORT || 10000);
const mongoUri = String(process.env.MONGODB_URI || '').trim();
const mongoDb = String(process.env.MONGODB_DB || 'ariana_moveis_db').trim();
const SHADOW_COLLECTION = 'dslite_beto_shadow_products';
const SHADOW_META_COLLECTION = 'dslite_beto_shadow_meta';
const PRICING_DIVISOR = 0.70;

app.disable('x-powered-by');

let mongoReady = false;
let lastShadowSync = null;

function roundMoney(value = 0) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function calculateCommercialPrice({ supplierCost = 0, stApplicable = false, stAmount = 0 } = {}) {
  const cost = roundMoney(supplierCost);
  const st = stApplicable ? roundMoney(stAmount) : 0;
  const pricingBase = roundMoney(cost + st);
  const calculatedSalePrice = pricingBase > 0 ? roundMoney(pricingBase / PRICING_DIVISOR) : 0;
  return {
    supplierCost: cost,
    stApplicable: Boolean(stApplicable),
    stAmount: st,
    pricingBase,
    pricingDivisor: PRICING_DIVISOR,
    calculatedSalePrice,
    pricingRule: '(custo + ST quando aplicável) / 0,70',
    pricingStatus: stApplicable ? 'CALCULATED_WITH_ST' : 'CALCULATED_NO_ST'
  };
}

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
  stApplicable: { type: Boolean, default: false },
  stAmount: { type: Number, default: 0 },
  pricingBase: { type: Number, default: 0 },
  pricingDivisor: { type: Number, default: PRICING_DIVISOR },
  calculatedSalePrice: { type: Number, default: 0 },
  pricingRule: String,
  pricingStatus: String,
  active: { type: Boolean, default: false },
  storefrontPublishEnabled: { type: Boolean, default: false },
  shadowOnly: { type: Boolean, default: true },
  fetchedAt: Date,
  syncedAt: Date
}, { strict: true, timestamps: true, collection: SHADOW_COLLECTION });

const shadowMetaSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, default: {} },
  updatedAt: { type: Date, default: Date.now }
}, { strict: true, collection: SHADOW_META_COLLECTION });

const ShadowProduct = mongoose.models.DsliteBetoShadowProduct || mongoose.model('DsliteBetoShadowProduct', shadowSchema, SHADOW_COLLECTION);
const ShadowMeta = mongoose.models.DsliteBetoShadowMeta || mongoose.model('DsliteBetoShadowMeta', shadowMetaSchema, SHADOW_META_COLLECTION);

async function loadLastShadowSync() {
  if (!mongoReady) return null;
  const meta = await ShadowMeta.findOne({ key: 'lastShadowSync' }).lean();
  if (meta?.value) {
    lastShadowSync = meta.value;
    return lastShadowSync;
  }
  const latest = await ShadowProduct.findOne({}).sort({ syncedAt: -1 }).lean();
  if (latest?.syncedAt) {
    lastShadowSync = {
      ok: true,
      collection: SHADOW_COLLECTION,
      total: await ShadowProduct.countDocuments({}),
      approved: DSLITE_BETO_APPROVED_SKUS.length,
      syncedAt: latest.syncedAt,
      writesRestrictedToShadowCollection: true,
      storefrontPublishEnabled: false,
      recoveredFromCollection: true
    };
  }
  return lastShadowSync;
}

async function connectMongo() {
  if (!mongoUri) {
    console.warn('[dslite-beto-shadow] MONGODB_URI não configurada; modo somente preview.');
    return false;
  }
  if (mongoose.connection.readyState === 1) {
    mongoReady = true;
    await loadLastShadowSync();
    return true;
  }
  await mongoose.connect(mongoUri, { dbName: mongoDb });
  mongoReady = true;
  await loadLastShadowSync();
  console.log(`[dslite-beto-shadow] Mongo conectado em ${mongoDb}; coleção isolada ${SHADOW_COLLECTION}.`);
  return true;
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

    // Regra comercial acordada para dropshipping/crossdocking/venda à ordem:
    // preço = (custo + ST quando aplicável) / 0,70.
    // Para o fornecedor piloto Beto Móveis, classificado no fluxo atual como móveis,
    // a sincronização entra sem ST e mantém os campos explícitos para futura regra fiscal por NCM/UF.
    const pricing = calculateCommercialPrice({
      supplierCost: item.supplierCost,
      stApplicable: false,
      stAmount: 0
    });

    const doc = {
      sku,
      supplierId: DSLITE_BETO_SUPPLIER_ID,
      supplier: 'Beto Móveis',
      name: item.name,
      brand: item.brand || 'Beto Móveis',
      category: item.category,
      rawCategory: item.rawCategory,
      supplierCost: pricing.supplierCost,
      supplierStock: item.supplierStock,
      ean: item.ean || '',
      image: item.imageUrls?.[0] || '',
      imageUrls: item.imageUrls || [],
      imageCount: item.imageUrls?.length || 0,
      parentSku: item.parentSku || '',
      variationGroup: item.variationGroup || sku,
      status: item.status || 'Ativo',
      stApplicable: pricing.stApplicable,
      stAmount: pricing.stAmount,
      pricingBase: pricing.pricingBase,
      pricingDivisor: pricing.pricingDivisor,
      calculatedSalePrice: pricing.calculatedSalePrice,
      pricingRule: pricing.pricingRule,
      pricingStatus: pricing.pricingStatus,
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
    priced: await ShadowProduct.countDocuments({ calculatedSalePrice: { $gt: 0 } }),
    pricingRule: '(custo + ST quando aplicável) / 0,70',
    pricingDivisor: PRICING_DIVISOR,
    syncedAt: now,
    writesRestrictedToShadowCollection: true,
    storefrontPublishEnabled: false
  };

  await ShadowMeta.updateOne(
    { key: 'lastShadowSync' },
    { $set: { value: lastShadowSync, updatedAt: now } },
    { upsert: true }
  );

  return lastShadowSync;
}

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'Ariana DSLite Beto Shadow',
    mode: 'shadow_db',
    supplier: 'Beto Móveis',
    supplierId: DSLITE_BETO_SUPPLIER_ID,
    approvedSkuCount: DSLITE_BETO_APPROVED_SKUS.length,
    pricingRule: '(custo + ST quando aplicável) / 0,70',
    pricingDivisor: PRICING_DIVISOR,
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
  res.json({ ok: true, mode: 'shadow_db', mongoReady, shadowCollection: SHADOW_COLLECTION, writesRestrictedToShadowCollection: true, storefrontPublishEnabled: false });
});

app.get('/preview', async (_req, res) => {
  try {
    const catalog = await fetchDsliteBetoCatalog({ timeoutMs: 30000 });
    const products = catalog.products.map((item) => {
      const pricing = calculateCommercialPrice({ supplierCost: item.supplierCost, stApplicable: false, stAmount: 0 });
      return {
        sku: item.sku,
        name: item.name,
        brand: item.brand,
        category: item.category,
        rawCategory: item.rawCategory,
        supplierCost: pricing.supplierCost,
        supplierStock: item.supplierStock,
        ean: item.ean,
        image: item.imageUrls?.[0] || '',
        imageCount: item.imageUrls?.length || 0,
        parentSku: item.parentSku || '',
        variationGroup: item.variationGroup || item.sku,
        stApplicable: pricing.stApplicable,
        stAmount: pricing.stAmount,
        pricingBase: pricing.pricingBase,
        pricingDivisor: pricing.pricingDivisor,
        calculatedSalePrice: pricing.calculatedSalePrice,
        pricingRule: pricing.pricingRule,
        status: item.status
      };
    });

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
      pricingRule: '(custo + ST quando aplicável) / 0,70',
      pricingDivisor: PRICING_DIVISOR,
      diagnostics: catalog.diagnostics,
      products
    });
  } catch (error) {
    res.status(error?.code === 'DSLITE_TOKEN_MISSING' ? 503 : 502).json({ ok: false, mode: 'shadow_db', writesRestrictedToShadowCollection: true, storefrontPublishEnabled: false, code: error?.code || 'DSLITE_PREVIEW_ERROR', error: error?.message || 'Falha ao consultar catálogo DSLite.' });
  }
});

app.get('/pricing-preview', async (_req, res) => {
  try {
    if (!mongoReady) await connectMongo();
    const products = await ShadowProduct.find({}, { _id: 0, sku: 1, name: 1, supplierCost: 1, stApplicable: 1, stAmount: 1, pricingBase: 1, pricingDivisor: 1, calculatedSalePrice: 1, pricingStatus: 1 }).sort({ name: 1 }).lean();
    res.json({
      ok: true,
      pricingRule: '(custo + ST quando aplicável) / 0,70',
      pricingDivisor: PRICING_DIVISOR,
      total: products.length,
      storefrontPublishEnabled: false,
      products
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error?.message || 'Falha ao consultar preços shadow.' });
  }
});

app.get('/shadow-status', async (_req, res) => {
  try {
    if (!mongoReady) await connectMongo();
    if (!lastShadowSync) await loadLastShadowSync();
    const total = mongoReady ? await ShadowProduct.countDocuments({}) : 0;
    const withImages = mongoReady ? await ShadowProduct.countDocuments({ image: { $ne: '' } }) : 0;
    const priced = mongoReady ? await ShadowProduct.countDocuments({ calculatedSalePrice: { $gt: 0 } }) : 0;
    const activePublic = mongoReady ? await ShadowProduct.countDocuments({ $or: [{ active: true }, { storefrontPublishEnabled: true }] }) : 0;
    res.json({
      ok: true,
      mongoReady,
      collection: SHADOW_COLLECTION,
      total,
      withImages,
      priced,
      activePublic,
      pricingRule: '(custo + ST quando aplicável) / 0,70',
      pricingDivisor: PRICING_DIVISOR,
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
      const summary = await syncShadowCollection();
      console.log('[dslite-beto-shadow] sincronização inicial concluída:', JSON.stringify(summary));
    }
  } catch (error) {
    console.error('[dslite-beto-shadow] sincronização inicial não executada:', error?.code || '', error?.message || error);
  }
});
