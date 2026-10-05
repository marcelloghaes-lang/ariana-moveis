import express from 'express';
import mongoose from 'mongoose';
import { fetchDsliteBetoCatalog, DSLITE_BETO_APPROVED_SKUS, DSLITE_BETO_SUPPLIER_ID } from '../services/dsliteIntegrationService.js';

const app = express();
const port = Number(process.env.PORT || 10000);
const mongoUri = String(process.env.MONGODB_URI || '').trim();
const mongoDb = String(process.env.MONGODB_DB || 'ariana_moveis_db').trim();
const SHADOW_COLLECTION = 'dslite_beto_shadow_products';
const SHADOW_META_COLLECTION = 'dslite_beto_shadow_meta';
const DRAFT_COLLECTION = 'dslite_beto_catalog_drafts';
const PUBLIC_COLLECTION = 'products';

const PRICING_DIVISOR = 0.70;
const PIX_DISCOUNT_RATE = 0.17;
const DESTINATION_UF = 'MG';
const BETO_ORIGIN_UF = 'SP';
const BETO_NCM = '9403.60.00';
const BETO_CEST_REFERENCE = '28.061.00';
const MG_INTERNAL_RATE = 0.18;
const SP_MG_INTERSTATE_RATE_NATIONAL = 0.12;
const SP_MG_INTERSTATE_RATE_IMPORTED = 0.04;
const SYNC_INTERVAL_MS = 12 * 60 * 1000;

app.disable('x-powered-by');

let mongoReady = false;
let lastShadowSync = null;
let lastDraftBuild = null;
let lastPublicSync = null;
let periodicSyncRunning = false;

function roundMoney(value = 0) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function normalizeOriginType(value = '') {
  const raw = String(value || '').trim().toUpperCase();
  if (['IMPORTED', 'IMPORTADO', 'IMPORTADA', '4'].includes(raw)) return 'IMPORTED_OR_OVER_40_IMPORT_CONTENT';
  if (['NATIONAL', 'NACIONAL', '12'].includes(raw)) return 'NATIONAL';
  return 'NATIONAL_PROVISIONAL';
}

function storefrontEnabled() {
  return String(process.env.DSLITE_BETO_STOREFRONT_ENABLED || '').trim().toLowerCase() === 'true';
}

function calculateTaxAndPrice({ supplierCost = 0, originType = 'NATIONAL_PROVISIONAL' } = {}) {
  const cost = roundMoney(supplierCost);
  const normalizedOrigin = normalizeOriginType(originType);
  const interstateRate = normalizedOrigin === 'IMPORTED_OR_OVER_40_IMPORT_CONTENT'
    ? SP_MG_INTERSTATE_RATE_IMPORTED
    : SP_MG_INTERSTATE_RATE_NATIONAL;
  const anticipationRate = Math.max(0, MG_INTERNAL_RATE - interstateRate);
  const taxAmount = roundMoney(cost * anticipationRate);
  const pricingBase = roundMoney(cost + taxAmount);
  const calculatedSalePrice = pricingBase > 0 ? roundMoney(pricingBase / PRICING_DIVISOR) : 0;
  const pixPrice = calculatedSalePrice > 0 ? roundMoney(calculatedSalePrice * (1 - PIX_DISCOUNT_RATE)) : 0;

  return {
    supplierCost: cost,
    taxType: 'ICMS_ANTECIPACAO_SIMPLES_NACIONAL', taxApplicable: true,
    taxAmount, taxRate: anticipationRate, internalRate: MG_INTERNAL_RATE, interstateRate,
    originType: normalizedOrigin,
    taxStatus: normalizedOrigin === 'NATIONAL_PROVISIONAL' ? 'AUTO_PROVISIONAL_NATIONAL' : 'AUTO_VERIFIED_BY_ORIGIN',
    taxVerified: normalizedOrigin !== 'NATIONAL_PROVISIONAL', taxBlockPublication: false,
    taxRuleId: 'MG_RICMS23_ART3_VII_SP_MG',
    taxReason: 'Antecipação de ICMS provisória para precificação; reconciliar com a NF-e e a classificação fiscal real.',
    pricingBase, pricingDivisor: PRICING_DIVISOR, calculatedSalePrice, pixPrice,
    pricingRule: '(custo + tributação de entrada aplicável) / 0,70', pricingStatus: 'CALCULATED_WITH_ICMS_ANTICIPATION',
    needsNfeReconciliation: true
  };
}

const shadowSchema = new mongoose.Schema({
  sku: { type: String, required: true, unique: true, index: true },
  supplierId: { type: Number, index: true }, supplier: String, name: String, brand: String,
  category: String, rawCategory: String, supplierCost: Number, supplierStock: Number, ean: String,
  image: String, imageUrls: [String], imageCount: Number, parentSku: String, variationGroup: String, status: String,
  ncm: String, cestReference: String, originUf: String, destinationUf: String, goodsOriginType: String,
  taxType: String, taxApplicable: Boolean, taxAmount: Number, taxRate: Number, internalRate: Number, interstateRate: Number,
  taxVerified: { type: Boolean, default: false }, taxStatus: String, taxRuleId: String, taxReason: String,
  taxBlockPublication: { type: Boolean, default: false }, needsNfeReconciliation: { type: Boolean, default: true },
  pricingBase: Number, pricingDivisor: { type: Number, default: PRICING_DIVISOR }, calculatedSalePrice: Number, pixPrice: Number,
  pricingRule: String, pricingStatus: String,
  active: { type: Boolean, default: false }, storefrontPublishEnabled: { type: Boolean, default: false },
  shadowOnly: { type: Boolean, default: true }, fetchedAt: Date, syncedAt: Date
}, { strict: true, timestamps: true, collection: SHADOW_COLLECTION });

const draftSchema = new mongoose.Schema({
  sourceKey: { type: String, required: true, unique: true, index: true },
  sourceSku: String, sku: String, slug: String, name: String, description: String,
  category: String, categoryName: String, brand: String,
  price: Number, pixPrice: Number, installmentCount: { type: Number, default: 12 },
  stock: { type: Number, default: 0 }, supplierStock: Number,
  image: String, imageUrl: String, images: [mongoose.Schema.Types.Mixed], imageUrls: [String],
  active: { type: Boolean, default: false }, storefrontStatus: { type: String, default: 'draft' },
  storefrontPublishEnabled: { type: Boolean, default: false }, reviewRequired: { type: Boolean, default: true },
  publicCollectionTouched: { type: Boolean, default: false },
  supplier: String, supplierId: Number, source: String,
  parentSku: String, variationGroup: String, ean: String,
  ncm: String, cestReference: String, originUf: String, destinationUf: String, goodsOriginType: String,
  supplierCost: Number, taxAmount: Number, taxRate: Number, taxStatus: String,
  pricingBase: Number, pricingDivisor: Number, pricingRule: String,
  needsNfeReconciliation: Boolean, draftReady: Boolean,
  syncedAt: Date
}, { strict: true, timestamps: true, collection: DRAFT_COLLECTION });

const shadowMetaSchema = new mongoose.Schema({ key: { type: String, required: true, unique: true }, value: { type: mongoose.Schema.Types.Mixed, default: {} }, updatedAt: { type: Date, default: Date.now } }, { strict: true, collection: SHADOW_META_COLLECTION });
const ShadowProduct = mongoose.models.DsliteBetoShadowProduct || mongoose.model('DsliteBetoShadowProduct', shadowSchema, SHADOW_COLLECTION);
const DraftProduct = mongoose.models.DsliteBetoCatalogDraft || mongoose.model('DsliteBetoCatalogDraft', draftSchema, DRAFT_COLLECTION);
const ShadowMeta = mongoose.models.DsliteBetoShadowMeta || mongoose.model('DsliteBetoShadowMeta', shadowMetaSchema, SHADOW_META_COLLECTION);

async function loadMeta() {
  if (!mongoReady) return;
  const [syncMeta, draftMeta, publicMeta] = await Promise.all([
    ShadowMeta.findOne({ key: 'lastShadowSync' }).lean(),
    ShadowMeta.findOne({ key: 'lastDraftBuild' }).lean(),
    ShadowMeta.findOne({ key: 'lastPublicSync' }).lean()
  ]);
  lastShadowSync = syncMeta?.value || null;
  lastDraftBuild = draftMeta?.value || null;
  lastPublicSync = publicMeta?.value || null;
}

async function connectMongo() {
  if (!mongoUri) return false;
  if (mongoose.connection.readyState !== 1) await mongoose.connect(mongoUri, { dbName: mongoDb });
  mongoReady = true;
  await loadMeta();
  return true;
}

async function syncShadowCollection() {
  if (!mongoReady) await connectMongo();
  if (!mongoReady) throw new Error('Mongo shadow indisponível.');
  const catalog = await fetchDsliteBetoCatalog({ timeoutMs: 30000 });
  if (catalog.approvedCount !== DSLITE_BETO_APPROVED_SKUS.length) {
    const error = new Error(`Catálogo incompleto: ${catalog.approvedCount}/${DSLITE_BETO_APPROVED_SKUS.length}.`);
    error.code = 'DSLITE_CATALOG_INCOMPLETE';
    throw error;
  }
  const configuredOriginType = normalizeOriginType(process.env.DSLITE_BETO_GOODS_ORIGIN || 'NATIONAL_PROVISIONAL');
  let created = 0, updated = 0;
  const now = new Date();
  const seenSkus = [];

  for (const item of catalog.products) {
    const sku = String(item.sku || '').trim();
    if (!sku) continue;
    seenSkus.push(sku);
    const pricing = calculateTaxAndPrice({ supplierCost: item.supplierCost, originType: configuredOriginType });
    const doc = {
      sku, supplierId: DSLITE_BETO_SUPPLIER_ID, supplier: 'Beto Móveis', name: item.name,
      brand: item.brand || 'Beto Móveis', category: item.category, rawCategory: item.rawCategory,
      supplierCost: pricing.supplierCost, supplierStock: item.supplierStock, ean: item.ean || '',
      image: item.imageUrls?.[0] || '', imageUrls: item.imageUrls || [], imageCount: item.imageUrls?.length || 0,
      parentSku: item.parentSku || '', variationGroup: item.variationGroup || sku, status: item.status || 'Ativo',
      ncm: BETO_NCM, cestReference: BETO_CEST_REFERENCE, originUf: BETO_ORIGIN_UF, destinationUf: DESTINATION_UF,
      goodsOriginType: pricing.originType, taxType: pricing.taxType, taxApplicable: pricing.taxApplicable,
      taxAmount: pricing.taxAmount, taxRate: pricing.taxRate, internalRate: pricing.internalRate, interstateRate: pricing.interstateRate,
      taxVerified: pricing.taxVerified, taxStatus: pricing.taxStatus, taxRuleId: pricing.taxRuleId, taxReason: pricing.taxReason,
      taxBlockPublication: pricing.taxBlockPublication, needsNfeReconciliation: pricing.needsNfeReconciliation,
      pricingBase: pricing.pricingBase, pricingDivisor: pricing.pricingDivisor,
      calculatedSalePrice: pricing.calculatedSalePrice, pixPrice: pricing.pixPrice,
      pricingRule: pricing.pricingRule, pricingStatus: pricing.pricingStatus,
      active: false, storefrontPublishEnabled: false, shadowOnly: true, fetchedAt: catalog.fetchedAt, syncedAt: now
    };
    const result = await ShadowProduct.updateOne({ sku }, { $set: doc, $setOnInsert: { createdAt: now } }, { upsert: true });
    if (result.upsertedCount) created += 1; else if (result.matchedCount) updated += 1;
  }

  await ShadowProduct.updateMany({ sku: { $nin: seenSkus } }, { $set: { supplierStock: 0, active: false, storefrontPublishEnabled: false, shadowOnly: true, syncedAt: now } });
  lastShadowSync = {
    ok: true, collection: SHADOW_COLLECTION, created, updated,
    total: await ShadowProduct.countDocuments({}), approved: catalog.approvedCount,
    taxed: await ShadowProduct.countDocuments({ taxApplicable: true, taxAmount: { $gte: 0 } }),
    provisionalTax: await ShadowProduct.countDocuments({ taxStatus: 'AUTO_PROVISIONAL_NATIONAL' }),
    pricedFinal: await ShadowProduct.countDocuments({ calculatedSalePrice: { $gt: 0 } }),
    syncedAt: now, storefrontPublishEnabled: storefrontEnabled()
  };
  await ShadowMeta.updateOne({ key: 'lastShadowSync' }, { $set: { value: lastShadowSync, updatedAt: now } }, { upsert: true });
  return lastShadowSync;
}

async function buildCatalogDrafts() {
  if (!mongoReady) await connectMongo();
  const rows = await ShadowProduct.find({ calculatedSalePrice: { $gt: 0 } }).lean();
  if (rows.length !== DSLITE_BETO_APPROVED_SKUS.length) {
    throw new Error(`Shadow incompleto para rascunho: ${rows.length}/${DSLITE_BETO_APPROVED_SKUS.length}.`);
  }
  const now = new Date();
  let created = 0, updated = 0;
  for (const row of rows) {
    const sourceKey = `DSLITE-BETO-${row.sku}`;
    const slug = `dslite-beto-${String(row.sku).toLowerCase()}`;
    const images = (row.imageUrls || []).map((url, index) => ({ url, path: url, isMain: index === 0 }));
    const draftReady = Boolean(row.name && row.category && row.image && row.calculatedSalePrice > 0 && row.supplierStock > 0);
    const doc = {
      sourceKey, sourceSku: row.sku, sku: sourceKey, slug,
      name: row.name, description: row.name,
      category: row.category, categoryName: row.category, brand: row.brand || 'Beto Móveis',
      price: roundMoney(row.calculatedSalePrice), pixPrice: roundMoney(row.calculatedSalePrice * (1 - PIX_DISCOUNT_RATE)), installmentCount: 12,
      stock: 0, supplierStock: row.supplierStock,
      image: row.image, imageUrl: row.image, images, imageUrls: row.imageUrls || [],
      active: false, storefrontStatus: 'draft', storefrontPublishEnabled: storefrontEnabled(), reviewRequired: false,
      publicCollectionTouched: false,
      supplier: 'Beto Móveis', supplierId: DSLITE_BETO_SUPPLIER_ID, source: 'dslite',
      parentSku: row.parentSku || '', variationGroup: row.variationGroup || row.sku, ean: row.ean || '',
      ncm: row.ncm, cestReference: row.cestReference, originUf: row.originUf, destinationUf: row.destinationUf,
      goodsOriginType: row.goodsOriginType, supplierCost: row.supplierCost,
      taxAmount: row.taxAmount, taxRate: row.taxRate, taxStatus: row.taxStatus,
      pricingBase: row.pricingBase, pricingDivisor: row.pricingDivisor, pricingRule: row.pricingRule,
      needsNfeReconciliation: row.needsNfeReconciliation, draftReady, syncedAt: now
    };
    const result = await DraftProduct.updateOne({ sourceKey }, { $set: doc, $setOnInsert: { createdAt: now } }, { upsert: true });
    if (result.upsertedCount) created += 1; else if (result.matchedCount) updated += 1;
  }
  lastDraftBuild = {
    ok: true, collection: DRAFT_COLLECTION, created, updated,
    total: await DraftProduct.countDocuments({}), ready: await DraftProduct.countDocuments({ draftReady: true }),
    publicCollectionTouched: false, activePublic: 0, builtAt: now
  };
  await ShadowMeta.updateOne({ key: 'lastDraftBuild' }, { $set: { value: lastDraftBuild, updatedAt: now } }, { upsert: true });
  return lastDraftBuild;
}

async function syncPublicStorefront() {
  if (!storefrontEnabled()) return { ok: true, skipped: true, reason: 'storefront_disabled' };
  if (!mongoReady) await connectMongo();
  const rows = await DraftProduct.find({ draftReady: true, sku: /^DSLITE-BETO-/ }).lean();
  if (rows.length !== DSLITE_BETO_APPROVED_SKUS.length) {
    throw new Error(`Rascunhos incompletos para vitrine: ${rows.length}/${DSLITE_BETO_APPROVED_SKUS.length}.`);
  }

  const collection = mongoose.connection.db.collection(PUBLIC_COLLECTION);
  const now = new Date();
  const liveSkus = [];
  let created = 0, updated = 0;

  for (const row of rows) {
    const sku = String(row.sku || '').trim();
    if (!sku.startsWith('DSLITE-BETO-')) continue;
    liveSkus.push(sku);
    const stock = Math.max(0, Number(row.supplierStock || 0));
    const active = stock > 0;
    const doc = {
      name: row.name,
      slug: row.slug,
      description: row.description || row.name,
      category: row.category,
      categoryName: row.categoryName || row.category,
      brand: row.brand || 'Beto Móveis',
      sku,
      price: Number(row.price || 0),
      pixPrice: Number(row.pixPrice || 0),
      installmentCount: 12,
      image: row.image,
      imageUrl: row.imageUrl || row.image,
      imagem: row.image,
      mainImageUrl: row.image,
      images: row.images || [],
      imageUrls: row.imageUrls || [],
      stock,
      active,
      storefrontStatus: active ? 'published' : 'out_of_stock',
      storefrontSource: 'dslite',
      dropshipping: {
        enabled: true,
        provider: 'dslite',
        supplier: 'Beto Móveis',
        supplierId: DSLITE_BETO_SUPPLIER_ID,
        sourceSku: row.sourceSku,
        supplierStock: stock,
        parentSku: row.parentSku || '',
        variationGroup: row.variationGroup || row.sourceSku || '',
        ean: row.ean || '',
        ncm: row.ncm || BETO_NCM,
        cestReference: row.cestReference || BETO_CEST_REFERENCE,
        originUf: row.originUf || BETO_ORIGIN_UF,
        destinationUf: row.destinationUf || DESTINATION_UF,
        supplierCost: Number(row.supplierCost || 0),
        taxAmount: Number(row.taxAmount || 0),
        taxRate: Number(row.taxRate || 0),
        pricingBase: Number(row.pricingBase || 0),
        pricingDivisor: Number(row.pricingDivisor || PRICING_DIVISOR),
        pricingRule: row.pricingRule || '(custo + tributação de entrada aplicável) / 0,70',
        needsNfeReconciliation: row.needsNfeReconciliation !== false,
        syncedAt: now
      },
      updatedAt: now
    };
    const result = await collection.updateOne({ sku }, { $set: doc, $setOnInsert: { createdAt: now } }, { upsert: true });
    if (result.upsertedCount) created += 1; else if (result.matchedCount) updated += 1;
  }

  await collection.updateMany(
    { sku: /^DSLITE-BETO-/, sku: { $nin: liveSkus } },
    { $set: { stock: 0, active: false, storefrontStatus: 'out_of_stock', updatedAt: now } }
  );
  await DraftProduct.updateMany({ sku: /^DSLITE-BETO-/ }, { $set: { publicCollectionTouched: true, syncedAt: now } });

  lastPublicSync = {
    ok: true,
    total: await collection.countDocuments({ sku: /^DSLITE-BETO-/ }),
    active: await collection.countDocuments({ sku: /^DSLITE-BETO-/, active: true }),
    withStock: await collection.countDocuments({ sku: /^DSLITE-BETO-/, stock: { $gt: 0 } }),
    created, updated, syncedAt: now
  };
  await ShadowMeta.updateOne({ key: 'lastPublicSync' }, { $set: { value: lastPublicSync, updatedAt: now } }, { upsert: true });
  return lastPublicSync;
}

async function runFullSync() {
  if (periodicSyncRunning) return lastPublicSync;
  periodicSyncRunning = true;
  try {
    await syncShadowCollection();
    await buildCatalogDrafts();
    return await syncPublicStorefront();
  } finally {
    periodicSyncRunning = false;
  }
}

app.get('/', (_req, res) => res.json({
  ok: true, service: 'Ariana DSLite Beto', mode: storefrontEnabled() ? 'storefront_sync' : 'shadow_db', supplier: 'Beto Móveis', supplierId: DSLITE_BETO_SUPPLIER_ID,
  shadowCollection: SHADOW_COLLECTION, draftCollection: DRAFT_COLLECTION, publicCollection: PUBLIC_COLLECTION,
  pricingRule: '(custo + tributação de entrada aplicável) / 0,70', pixDiscountRate: PIX_DISCOUNT_RATE,
  mongoReady, storefrontPublishEnabled: storefrontEnabled(), lastShadowSync, lastDraftBuild, lastPublicSync
}));

app.get('/health', (_req, res) => res.json({ ok: true, mongoReady, storefrontPublishEnabled: storefrontEnabled(), periodicSyncRunning }));

app.get('/pricing-preview', async (_req, res) => {
  try {
    if (!mongoReady) await connectMongo();
    const products = await ShadowProduct.find({}, { _id: 0, sku: 1, name: 1, supplierCost: 1, taxAmount: 1, taxRate: 1, pricingBase: 1, calculatedSalePrice: 1, pixPrice: 1, taxStatus: 1, supplierStock: 1 }).sort({ name: 1 }).lean();
    res.json({ ok: true, total: products.length, pricingRule: '(custo + tributação de entrada aplicável) / 0,70', pixDiscountRate: PIX_DISCOUNT_RATE, storefrontPublishEnabled: storefrontEnabled(), products });
  } catch (error) { res.status(500).json({ ok: false, error: error?.message || 'Falha ao consultar preços shadow.' }); }
});

app.get('/draft-status', async (_req, res) => {
  try {
    if (!mongoReady) await connectMongo();
    const total = await DraftProduct.countDocuments({});
    const ready = await DraftProduct.countDocuments({ draftReady: true });
    const withImages = await DraftProduct.countDocuments({ image: { $ne: '' } });
    const withPrice = await DraftProduct.countDocuments({ price: { $gt: 0 } });
    const publicTouched = await DraftProduct.countDocuments({ publicCollectionTouched: true });
    res.json({ ok: true, collection: DRAFT_COLLECTION, total, ready, withImages, withPrice, publicCollectionTouched: publicTouched > 0, storefrontPublishEnabled: storefrontEnabled(), lastDraftBuild });
  } catch (error) { res.status(500).json({ ok: false, error: error?.message || 'Falha ao consultar rascunhos.' }); }
});

app.get('/public-status', async (_req, res) => {
  try {
    if (!mongoReady) await connectMongo();
    const collection = mongoose.connection.db.collection(PUBLIC_COLLECTION);
    const total = await collection.countDocuments({ sku: /^DSLITE-BETO-/ });
    const active = await collection.countDocuments({ sku: /^DSLITE-BETO-/, active: true });
    const withStock = await collection.countDocuments({ sku: /^DSLITE-BETO-/, stock: { $gt: 0 } });
    const sample = await collection.find({ sku: /^DSLITE-BETO-/ }, { projection: { _id: 0, sku: 1, name: 1, price: 1, pixPrice: 1, stock: 1, active: 1, image: 1 } }).limit(5).toArray();
    res.json({ ok: true, storefrontPublishEnabled: storefrontEnabled(), total, active, withStock, sample, lastPublicSync });
  } catch (error) { res.status(500).json({ ok: false, error: error?.message || 'Falha ao consultar catálogo público.' }); }
});

app.get('/shadow-status', async (_req, res) => {
  try {
    if (!mongoReady) await connectMongo();
    const total = await ShadowProduct.countDocuments({});
    const withImages = await ShadowProduct.countDocuments({ image: { $ne: '' } });
    const taxed = await ShadowProduct.countDocuments({ taxApplicable: true, taxAmount: { $gte: 0 } });
    const provisionalTax = await ShadowProduct.countDocuments({ taxStatus: 'AUTO_PROVISIONAL_NATIONAL' });
    const pricedFinal = await ShadowProduct.countDocuments({ calculatedSalePrice: { $gt: 0 } });
    res.json({ ok: true, mongoReady, collection: SHADOW_COLLECTION, total, withImages, taxed, provisionalTax, pricedFinal, storefrontPublishEnabled: storefrontEnabled(), lastShadowSync });
  } catch (error) { res.status(500).json({ ok: false, error: error?.message || 'Falha ao consultar shadow.' }); }
});

app.listen(port, '0.0.0.0', async () => {
  console.log(`[dslite-beto] online ${port} | vitrine=${storefrontEnabled() ? 'habilitada' : 'desabilitada'}`);
  try {
    await connectMongo();
    await runFullSync();
  } catch (error) {
    console.error('[dslite-beto] sincronização inicial não executada:', error?.message || error);
  }
  setInterval(async () => {
    try {
      await runFullSync();
    } catch (error) {
      console.error('[dslite-beto] sincronização periódica não executada:', error?.message || error);
    }
  }, SYNC_INTERVAL_MS).unref();
});
