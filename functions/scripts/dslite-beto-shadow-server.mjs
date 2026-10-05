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
const DESTINATION_UF = 'MG';
const BETO_ORIGIN_UF = 'SP';
const BETO_NCM = '9403.60.00';
const BETO_CEST_REFERENCE = '28.061.00';
const MG_INTERNAL_RATE = 0.18;
const SP_MG_INTERSTATE_RATE_NATIONAL = 0.12;
const SP_MG_INTERSTATE_RATE_IMPORTED = 0.04;

app.disable('x-powered-by');

let mongoReady = false;
let lastShadowSync = null;

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

function calculateTaxAndPrice({ supplierCost = 0, originType = 'NATIONAL_PROVISIONAL' } = {}) {
  const cost = roundMoney(supplierCost);
  const normalizedOrigin = normalizeOriginType(originType);
  const interstateRate = normalizedOrigin === 'IMPORTED_OR_OVER_40_IMPORT_CONTENT'
    ? SP_MG_INTERSTATE_RATE_IMPORTED
    : SP_MG_INTERSTATE_RATE_NATIONAL;

  // Para optante do Simples Nacional em MG, aquisição interestadual destinada à comercialização
  // sofre antecipação correspondente à diferença entre a alíquota interna e a interestadual.
  const anticipationRate = Math.max(0, MG_INTERNAL_RATE - interstateRate);
  const taxAmount = roundMoney(cost * anticipationRate);
  const pricingBase = roundMoney(cost + taxAmount);
  const calculatedSalePrice = pricingBase > 0 ? roundMoney(pricingBase / PRICING_DIVISOR) : 0;

  return {
    supplierCost: cost,
    taxType: 'ICMS_ANTECIPACAO_SIMPLES_NACIONAL',
    taxApplicable: true,
    taxAmount,
    taxRate: anticipationRate,
    internalRate: MG_INTERNAL_RATE,
    interstateRate,
    originType: normalizedOrigin,
    taxStatus: normalizedOrigin === 'NATIONAL_PROVISIONAL' ? 'AUTO_PROVISIONAL_NATIONAL' : 'AUTO_VERIFIED_BY_ORIGIN',
    taxVerified: normalizedOrigin !== 'NATIONAL_PROVISIONAL',
    taxBlockPublication: false,
    taxRuleId: 'MG_RICMS23_ART3_VII_SP_MG',
    taxReason: 'Antecipação do ICMS para optante do Simples Nacional em aquisição interestadual destinada à comercialização: diferença entre alíquota interna de MG e interestadual.',
    pricingBase,
    pricingDivisor: PRICING_DIVISOR,
    calculatedSalePrice,
    pricingRule: '(custo + tributação de entrada aplicável) / 0,70',
    pricingStatus: 'CALCULATED_WITH_ICMS_ANTICIPATION',
    needsNfeReconciliation: true
  };
}

const shadowSchema = new mongoose.Schema({
  sku: { type: String, required: true, unique: true, index: true },
  supplierId: { type: Number, index: true }, supplier: String, name: String, brand: String,
  category: String, rawCategory: String, supplierCost: Number, supplierStock: Number, ean: String,
  image: String, imageUrls: [String], imageCount: Number, parentSku: String, variationGroup: String, status: String,
  ncm: String, cestReference: String, originUf: String, destinationUf: String,
  goodsOriginType: String,
  taxType: String, taxApplicable: Boolean, taxAmount: Number, taxRate: Number,
  internalRate: Number, interstateRate: Number,
  taxVerified: { type: Boolean, default: false }, taxStatus: String, taxRuleId: String, taxReason: String,
  taxBlockPublication: { type: Boolean, default: false }, needsNfeReconciliation: { type: Boolean, default: true },
  pricingBase: Number, pricingDivisor: { type: Number, default: PRICING_DIVISOR },
  calculatedSalePrice: Number, pricingRule: String, pricingStatus: String,
  active: { type: Boolean, default: false }, storefrontPublishEnabled: { type: Boolean, default: false },
  shadowOnly: { type: Boolean, default: true }, fetchedAt: Date, syncedAt: Date
}, { strict: true, timestamps: true, collection: SHADOW_COLLECTION });

const shadowMetaSchema = new mongoose.Schema({ key: { type: String, required: true, unique: true }, value: { type: mongoose.Schema.Types.Mixed, default: {} }, updatedAt: { type: Date, default: Date.now } }, { strict: true, collection: SHADOW_META_COLLECTION });
const ShadowProduct = mongoose.models.DsliteBetoShadowProduct || mongoose.model('DsliteBetoShadowProduct', shadowSchema, SHADOW_COLLECTION);
const ShadowMeta = mongoose.models.DsliteBetoShadowMeta || mongoose.model('DsliteBetoShadowMeta', shadowMetaSchema, SHADOW_META_COLLECTION);

async function loadLastShadowSync() {
  if (!mongoReady) return null;
  const meta = await ShadowMeta.findOne({ key: 'lastShadowSync' }).lean();
  if (meta?.value) { lastShadowSync = meta.value; return lastShadowSync; }
  return null;
}

async function connectMongo() {
  if (!mongoUri) return false;
  if (mongoose.connection.readyState !== 1) await mongoose.connect(mongoUri, { dbName: mongoDb });
  mongoReady = true;
  await loadLastShadowSync();
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

  // O catálogo não traz origem fiscal completa da NF-e. Para o Beto, fabricante em SP,
  // usamos origem nacional como cálculo provisório de catálogo. Na NF-e real, a origem do item
  // deve reconciliar automaticamente 12% (nacional) ou 4% (importado/conteúdo de importação > 40%).
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
      goodsOriginType: pricing.originType,
      taxType: pricing.taxType, taxApplicable: pricing.taxApplicable, taxAmount: pricing.taxAmount, taxRate: pricing.taxRate,
      internalRate: pricing.internalRate, interstateRate: pricing.interstateRate,
      taxVerified: pricing.taxVerified, taxStatus: pricing.taxStatus, taxRuleId: pricing.taxRuleId, taxReason: pricing.taxReason,
      taxBlockPublication: pricing.taxBlockPublication, needsNfeReconciliation: pricing.needsNfeReconciliation,
      pricingBase: pricing.pricingBase, pricingDivisor: pricing.pricingDivisor,
      calculatedSalePrice: pricing.calculatedSalePrice, pricingRule: pricing.pricingRule, pricingStatus: pricing.pricingStatus,
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
    pricingRule: '(custo + tributação de entrada aplicável) / 0,70', pricingDivisor: PRICING_DIVISOR,
    taxRule: 'ICMS antecipação Simples Nacional: MG interna 18% - interestadual SP/MG 12% nacional ou 4% importado/conteúdo importado >40%',
    syncedAt: now, writesRestrictedToShadowCollection: true, storefrontPublishEnabled: false
  };
  await ShadowMeta.updateOne({ key: 'lastShadowSync' }, { $set: { value: lastShadowSync, updatedAt: now } }, { upsert: true });
  return lastShadowSync;
}

app.get('/', (_req, res) => res.json({
  ok: true, service: 'Ariana DSLite Beto Shadow', mode: 'shadow_db', supplier: 'Beto Móveis', supplierId: DSLITE_BETO_SUPPLIER_ID,
  ncm: BETO_NCM, cestReference: BETO_CEST_REFERENCE, originUf: BETO_ORIGIN_UF, destinationUf: DESTINATION_UF,
  taxRule: 'ICMS antecipação Simples Nacional: diferença entre alíquota interna MG e interestadual',
  rates: { mgInternal: MG_INTERNAL_RATE, spMgNational: SP_MG_INTERSTATE_RATE_NATIONAL, importedOrOver40ImportContent: SP_MG_INTERSTATE_RATE_IMPORTED },
  pricingRule: '(custo + tributação de entrada aplicável) / 0,70', mongoReady, storefrontPublishEnabled: false, lastShadowSync
}));

app.get('/health', (_req, res) => res.json({ ok: true, mode: 'shadow_db', mongoReady, storefrontPublishEnabled: false }));

app.get('/pricing-preview', async (_req, res) => {
  try {
    if (!mongoReady) await connectMongo();
    const products = await ShadowProduct.find({}, {
      _id: 0, sku: 1, name: 1, ncm: 1, cestReference: 1, originUf: 1, destinationUf: 1, goodsOriginType: 1,
      supplierCost: 1, taxType: 1, taxAmount: 1, taxRate: 1, internalRate: 1, interstateRate: 1,
      taxStatus: 1, needsNfeReconciliation: 1, pricingBase: 1, pricingDivisor: 1, calculatedSalePrice: 1, pricingStatus: 1
    }).sort({ name: 1 }).lean();
    res.json({
      ok: true,
      pricingRule: '(custo + tributação de entrada aplicável) / 0,70', pricingDivisor: PRICING_DIVISOR,
      taxRule: 'ICMS antecipação Simples Nacional: diferença entre alíquota interna MG e interestadual',
      total: products.length, storefrontPublishEnabled: false, products
    });
  } catch (error) { res.status(500).json({ ok: false, error: error?.message || 'Falha ao consultar preços shadow.' }); }
});

app.get('/shadow-status', async (_req, res) => {
  try {
    if (!mongoReady) await connectMongo();
    const total = await ShadowProduct.countDocuments({});
    const withImages = await ShadowProduct.countDocuments({ image: { $ne: '' } });
    const taxed = await ShadowProduct.countDocuments({ taxApplicable: true, taxAmount: { $gte: 0 } });
    const provisionalTax = await ShadowProduct.countDocuments({ taxStatus: 'AUTO_PROVISIONAL_NATIONAL' });
    const pricedFinal = await ShadowProduct.countDocuments({ calculatedSalePrice: { $gt: 0 } });
    const activePublic = await ShadowProduct.countDocuments({ $or: [{ active: true }, { storefrontPublishEnabled: true }] });
    res.json({
      ok: true, mongoReady, collection: SHADOW_COLLECTION, total, withImages, taxed, provisionalTax, pricedFinal, activePublic,
      ncm: BETO_NCM, cestReference: BETO_CEST_REFERENCE, originUf: BETO_ORIGIN_UF, destinationUf: DESTINATION_UF,
      rates: { mgInternal: MG_INTERNAL_RATE, spMgNational: SP_MG_INTERSTATE_RATE_NATIONAL, importedOrOver40ImportContent: SP_MG_INTERSTATE_RATE_IMPORTED },
      pricingRule: '(custo + tributação de entrada aplicável) / 0,70', storefrontPublishEnabled: false,
      writesRestrictedToShadowCollection: true, lastShadowSync
    });
  } catch (error) { res.status(500).json({ ok: false, error: error?.message || 'Falha ao consultar shadow.' }); }
});

app.listen(port, '0.0.0.0', async () => {
  console.log(`[dslite-beto-shadow] online ${port} | ICMS antecipação automática + divisor 0,70 | sem publicação`);
  try { await connectMongo(); if (mongoReady) await syncShadowCollection(); }
  catch (error) { console.error('[dslite-beto-shadow] sync não executado:', error?.message || error); }
});
