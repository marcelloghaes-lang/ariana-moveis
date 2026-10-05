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

app.disable('x-powered-by');

let mongoReady = false;
let lastShadowSync = null;

function roundMoney(value = 0) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function boolEnv(name, fallback = false) {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'sim', 'on'].includes(raw);
}

function numberEnv(name, fallback = null) {
  const raw = String(process.env[name] ?? '').trim().replace(',', '.');
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function getTaxRuleForBeto() {
  const verified = boolEnv('DSLITE_BETO_TAX_RULE_VERIFIED', false);
  const stApplicable = boolEnv('DSLITE_BETO_ST_APPLICABLE', false);
  const stAmountPerUnit = numberEnv('DSLITE_BETO_ST_AMOUNT_PER_UNIT', null);
  const taxRuleId = String(process.env.DSLITE_BETO_TAX_RULE_ID || '').trim();

  if (!verified) {
    return {
      verified: false,
      taxStatus: 'PENDING_TAX_CLASSIFICATION',
      stApplicable: null,
      stAmountPerUnit: null,
      taxRuleId: taxRuleId || null,
      blockPublication: true,
      reason: 'NCM/UF identificados, mas a incidência e o valor tributário ainda não foram validados em regra fiscal oficial.'
    };
  }

  if (stApplicable && (stAmountPerUnit === null || stAmountPerUnit < 0)) {
    return {
      verified: false,
      taxStatus: 'TAX_RULE_INCOMPLETE',
      stApplicable: true,
      stAmountPerUnit: null,
      taxRuleId: taxRuleId || null,
      blockPublication: true,
      reason: 'Regra marcou ST como aplicável, mas não informou o valor unitário de ST calculado/validado.'
    };
  }

  return {
    verified: true,
    taxStatus: stApplicable ? 'TAX_VERIFIED_ST' : 'TAX_VERIFIED_NO_ST',
    stApplicable,
    stAmountPerUnit: stApplicable ? roundMoney(stAmountPerUnit || 0) : 0,
    taxRuleId: taxRuleId || 'MANUAL_VERIFIED_RULE',
    blockPublication: false,
    reason: 'Regra tributária marcada como validada.'
  };
}

function calculateCommercialPrice({ supplierCost = 0, taxRule } = {}) {
  const cost = roundMoney(supplierCost);
  const rule = taxRule || getTaxRuleForBeto();

  if (!rule.verified || rule.blockPublication) {
    return {
      supplierCost: cost,
      stApplicable: rule.stApplicable,
      stAmount: rule.stAmountPerUnit,
      pricingBase: null,
      pricingDivisor: PRICING_DIVISOR,
      calculatedSalePrice: null,
      preliminarySalePriceWithoutTax: cost > 0 ? roundMoney(cost / PRICING_DIVISOR) : 0,
      pricingRule: '(custo + tributação de entrada aplicável) / 0,70',
      pricingStatus: 'BLOCKED_PENDING_TAX',
      taxStatus: rule.taxStatus,
      taxVerified: false,
      taxBlockPublication: true,
      taxRuleId: rule.taxRuleId,
      taxReason: rule.reason
    };
  }

  const st = rule.stApplicable ? roundMoney(rule.stAmountPerUnit || 0) : 0;
  const pricingBase = roundMoney(cost + st);
  const calculatedSalePrice = pricingBase > 0 ? roundMoney(pricingBase / PRICING_DIVISOR) : 0;
  return {
    supplierCost: cost,
    stApplicable: Boolean(rule.stApplicable),
    stAmount: st,
    pricingBase,
    pricingDivisor: PRICING_DIVISOR,
    calculatedSalePrice,
    preliminarySalePriceWithoutTax: cost > 0 ? roundMoney(cost / PRICING_DIVISOR) : 0,
    pricingRule: '(custo + tributação de entrada aplicável) / 0,70',
    pricingStatus: rule.stApplicable ? 'CALCULATED_WITH_ST' : 'CALCULATED_NO_ST',
    taxStatus: rule.taxStatus,
    taxVerified: true,
    taxBlockPublication: false,
    taxRuleId: rule.taxRuleId,
    taxReason: rule.reason
  };
}

const shadowSchema = new mongoose.Schema({
  sku: { type: String, required: true, unique: true, index: true },
  supplierId: { type: Number, index: true }, supplier: String, name: String, brand: String,
  category: String, rawCategory: String, supplierCost: Number, supplierStock: Number, ean: String,
  image: String, imageUrls: [String], imageCount: Number, parentSku: String, variationGroup: String, status: String,
  ncm: String, cest: String, originUf: String, destinationUf: String,
  stApplicable: mongoose.Schema.Types.Mixed, stAmount: mongoose.Schema.Types.Mixed,
  taxVerified: { type: Boolean, default: false }, taxStatus: String, taxRuleId: String, taxReason: String,
  taxBlockPublication: { type: Boolean, default: true },
  pricingBase: mongoose.Schema.Types.Mixed, pricingDivisor: { type: Number, default: PRICING_DIVISOR },
  calculatedSalePrice: mongoose.Schema.Types.Mixed, preliminarySalePriceWithoutTax: Number,
  pricingRule: String, pricingStatus: String,
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
  if (catalog.approvedCount !== DSLITE_BETO_APPROVED_SKUS.length) throw new Error(`Catálogo incompleto: ${catalog.approvedCount}/${DSLITE_BETO_APPROVED_SKUS.length}.`);

  const taxRule = getTaxRuleForBeto();
  let created = 0, updated = 0;
  const now = new Date();
  const seenSkus = [];

  for (const item of catalog.products) {
    const sku = String(item.sku || '').trim();
    if (!sku) continue;
    seenSkus.push(sku);
    const pricing = calculateCommercialPrice({ supplierCost: item.supplierCost, taxRule });
    const doc = {
      sku, supplierId: DSLITE_BETO_SUPPLIER_ID, supplier: 'Beto Móveis', name: item.name,
      brand: item.brand || 'Beto Móveis', category: item.category, rawCategory: item.rawCategory,
      supplierCost: pricing.supplierCost, supplierStock: item.supplierStock, ean: item.ean || '',
      image: item.imageUrls?.[0] || '', imageUrls: item.imageUrls || [], imageCount: item.imageUrls?.length || 0,
      parentSku: item.parentSku || '', variationGroup: item.variationGroup || sku, status: item.status || 'Ativo',
      ncm: BETO_NCM, cest: '', originUf: BETO_ORIGIN_UF, destinationUf: DESTINATION_UF,
      stApplicable: pricing.stApplicable, stAmount: pricing.stAmount,
      taxVerified: pricing.taxVerified, taxStatus: pricing.taxStatus, taxRuleId: pricing.taxRuleId || '', taxReason: pricing.taxReason,
      taxBlockPublication: pricing.taxBlockPublication,
      pricingBase: pricing.pricingBase, pricingDivisor: pricing.pricingDivisor,
      calculatedSalePrice: pricing.calculatedSalePrice, preliminarySalePriceWithoutTax: pricing.preliminarySalePriceWithoutTax,
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
    taxVerified: await ShadowProduct.countDocuments({ taxVerified: true }),
    taxPending: await ShadowProduct.countDocuments({ taxVerified: false }),
    pricedFinal: await ShadowProduct.countDocuments({ calculatedSalePrice: { $gt: 0 }, taxVerified: true }),
    pricingRule: '(custo + tributação de entrada aplicável) / 0,70', pricingDivisor: PRICING_DIVISOR,
    syncedAt: now, writesRestrictedToShadowCollection: true, storefrontPublishEnabled: false
  };
  await ShadowMeta.updateOne({ key: 'lastShadowSync' }, { $set: { value: lastShadowSync, updatedAt: now } }, { upsert: true });
  return lastShadowSync;
}

app.get('/', (_req, res) => res.json({ ok: true, service: 'Ariana DSLite Beto Shadow', mode: 'shadow_db', supplier: 'Beto Móveis', supplierId: DSLITE_BETO_SUPPLIER_ID, ncm: BETO_NCM, originUf: BETO_ORIGIN_UF, destinationUf: DESTINATION_UF, pricingRule: '(custo + tributação de entrada aplicável) / 0,70', taxRule: getTaxRuleForBeto(), mongoReady, storefrontPublishEnabled: false, lastShadowSync }));
app.get('/health', (_req, res) => res.json({ ok: true, mode: 'shadow_db', mongoReady, storefrontPublishEnabled: false }));

app.get('/pricing-preview', async (_req, res) => {
  try {
    if (!mongoReady) await connectMongo();
    const products = await ShadowProduct.find({}, { _id: 0, sku: 1, name: 1, ncm: 1, originUf: 1, destinationUf: 1, supplierCost: 1, stApplicable: 1, stAmount: 1, taxVerified: 1, taxStatus: 1, taxReason: 1, taxBlockPublication: 1, preliminarySalePriceWithoutTax: 1, calculatedSalePrice: 1, pricingStatus: 1 }).sort({ name: 1 }).lean();
    res.json({ ok: true, pricingRule: '(custo + tributação de entrada aplicável) / 0,70', pricingDivisor: PRICING_DIVISOR, total: products.length, storefrontPublishEnabled: false, products });
  } catch (error) { res.status(500).json({ ok: false, error: error?.message || 'Falha ao consultar preços shadow.' }); }
});

app.get('/shadow-status', async (_req, res) => {
  try {
    if (!mongoReady) await connectMongo();
    const total = await ShadowProduct.countDocuments({});
    const withImages = await ShadowProduct.countDocuments({ image: { $ne: '' } });
    const taxVerified = await ShadowProduct.countDocuments({ taxVerified: true });
    const taxPending = await ShadowProduct.countDocuments({ taxVerified: false });
    const pricedFinal = await ShadowProduct.countDocuments({ calculatedSalePrice: { $gt: 0 }, taxVerified: true });
    const activePublic = await ShadowProduct.countDocuments({ $or: [{ active: true }, { storefrontPublishEnabled: true }] });
    res.json({ ok: true, mongoReady, collection: SHADOW_COLLECTION, total, withImages, taxVerified, taxPending, pricedFinal, activePublic, ncm: BETO_NCM, originUf: BETO_ORIGIN_UF, destinationUf: DESTINATION_UF, pricingRule: '(custo + tributação de entrada aplicável) / 0,70', storefrontPublishEnabled: false, writesRestrictedToShadowCollection: true, lastShadowSync });
  } catch (error) { res.status(500).json({ ok: false, error: error?.message || 'Falha ao consultar shadow.' }); }
});

app.listen(port, '0.0.0.0', async () => {
  console.log(`[dslite-beto-shadow] online ${port} | tributação obrigatória antes da publicação`);
  try { await connectMongo(); if (mongoReady) await syncShadowCollection(); }
  catch (error) { console.error('[dslite-beto-shadow] sync não executado:', error?.message || error); }
});
