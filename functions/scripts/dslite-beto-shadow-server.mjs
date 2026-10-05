import express from 'express';
import mongoose from 'mongoose';
import { fetchDsliteBetoCatalog, DSLITE_BETO_APPROVED_SKUS, DSLITE_BETO_SUPPLIER_ID } from '../services/dsliteIntegrationService.js';

const app = express();
const port = Number(process.env.PORT || 10000);
const mongoUri = String(process.env.MONGODB_URI || '').trim();
const mongoDb = String(process.env.MONGODB_DB || 'ariana_moveis_db').trim();

const SHADOW_COLLECTION = 'dslite_beto_shadow_products';
const DRAFT_COLLECTION = 'dslite_beto_catalog_drafts';
const META_COLLECTION = 'dslite_beto_shadow_meta';
const PUBLIC_COLLECTION = 'products';
const RECOVERY_BACKUP_COLLECTION = 'dslite_recovery_backup_20261005_173056';
const SKU_PREFIX = 'DSLITE-BETO-';
const PRICING_DIVISOR = 0.70;
const PIX_DISCOUNT_RATE = 0.17;
const MG_INTERNAL_RATE = 0.18;
const SP_MG_INTERSTATE_RATE = 0.12;
const SYNC_INTERVAL_MS = 12 * 60 * 1000;
const BAD_SYNC_AT = new Date('2026-10-05T17:30:56.903Z');

let db = null;
let syncRunning = false;
let lastPublicSync = null;
let lastRecovery = null;

function roundMoney(value = 0) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 100) / 100 : 0;
}

function storefrontEnabled() {
  return String(process.env.DSLITE_BETO_STOREFRONT_ENABLED || '').trim().toLowerCase() === 'true';
}

function calculatePricing(costValue = 0) {
  const supplierCost = roundMoney(costValue);
  const taxRate = MG_INTERNAL_RATE - SP_MG_INTERSTATE_RATE;
  const taxAmount = roundMoney(supplierCost * taxRate);
  const pricingBase = roundMoney(supplierCost + taxAmount);
  const price = pricingBase > 0 ? roundMoney(pricingBase / PRICING_DIVISOR) : 0;
  const pixPrice = price > 0 ? roundMoney(price * (1 - PIX_DISCOUNT_RATE)) : 0;
  return { supplierCost, taxRate, taxAmount, pricingBase, price, pixPrice };
}

async function connectMongo() {
  if (!mongoUri) throw new Error('MONGODB_URI não configurada.');
  if (mongoose.connection.readyState !== 1) await mongoose.connect(mongoUri, { dbName: mongoDb });
  db = mongoose.connection.db;
  return db;
}

function nonDsliteFilter() {
  return { $or: [
    { sku: { $not: { $regex: `^${SKU_PREFIX}` } } },
    { sku: { $exists: false } },
    { sku: null }
  ] };
}

function affectedLegacyFilter() {
  return {
    $and: [
      nonDsliteFilter(),
      { updatedAt: BAD_SYNC_AT },
      { active: false },
      { stock: 0 }
    ]
  };
}

async function recoverLegacyCatalog() {
  await connectMongo();
  const products = db.collection(PUBLIC_COLLECTION);
  const backup = db.collection(RECOVERY_BACKUP_COLLECTION);
  const meta = db.collection(META_COLLECTION);

  const previous = await meta.findOne({ key: 'legacyRecovery20261005' });
  if (previous?.value?.completed === true) {
    lastRecovery = previous.value;
    return lastRecovery;
  }

  const affected = await products.find(affectedLegacyFilter()).toArray();
  if (!affected.length) {
    lastRecovery = {
      ok: true,
      completed: true,
      affected: 0,
      restoredVisible: 0,
      restoredStockFromMovements: 0,
      backupCollection: RECOVERY_BACKUP_COLLECTION,
      note: 'Nenhum documento ainda corresponde ao carimbo exato do incidente.',
      recoveredAt: new Date()
    };
    await meta.updateOne({ key: 'legacyRecovery20261005' }, { $set: { value: lastRecovery, updatedAt: new Date() } }, { upsert: true });
    return lastRecovery;
  }

  // Cópia integral ANTES de qualquer restauração. A coleção de backup fica isolada.
  if (await backup.countDocuments({}) === 0) {
    await backup.insertMany(affected.map((doc) => ({ ...doc, recoveryBackupCreatedAt: new Date() })), { ordered: false });
  }

  // Reativa somente os documentos que receberam exatamente o timestamp do incidente.
  // Mantemos estoque 0 por padrão para não vender mercadoria sem quantidade comprovada.
  const restoreVisible = await products.updateMany(
    affectedLegacyFilter(),
    {
      $set: {
        active: true,
        storefrontStatus: 'published',
        recoveryStatus: 'VISIBILITY_RESTORED_STOCK_PENDING',
        recoveryIncidentAt: BAD_SYNC_AT,
        recoveryUpdatedAt: new Date()
      }
    }
  );

  // O ERP mantém movimentos confiáveis para alguns itens. Para esses, restauramos o último saldo "after".
  const movements = db.collection('erpstockmovements');
  const latestMovements = await movements.aggregate([
    { $sort: { createdAt: -1, _id: -1 } },
    { $group: { _id: '$productId', row: { $first: '$$ROOT' } } }
  ]).toArray();

  let restoredStockFromMovements = 0;
  const restored = [];
  for (const entry of latestMovements) {
    const movement = entry?.row || {};
    const after = Number(movement.after);
    if (!Number.isFinite(after) || after < 0) continue;

    let productId = null;
    try { productId = new mongoose.Types.ObjectId(String(movement.productId || '')); } catch {}
    const sku = String(movement.sku || '').trim();
    const match = productId ? { _id: productId } : (sku ? { sku } : null);
    if (!match) continue;

    const current = await products.findOne({ ...match, ...nonDsliteFilter() }, { projection: { _id: 1, sku: 1, name: 1 } });
    if (!current) continue;

    await products.updateOne(
      { _id: current._id },
      {
        $set: {
          stock: after,
          active: true,
          storefrontStatus: after > 0 ? 'published' : 'out_of_stock',
          recoveryStatus: 'RESTORED_FROM_ERP_STOCK_MOVEMENT',
          recoveryStockSource: 'erpstockmovements.after',
          recoveryStockMovementAt: movement.createdAt || null,
          recoveryUpdatedAt: new Date()
        }
      }
    );
    restoredStockFromMovements += 1;
    restored.push({ sku: current.sku || '', name: current.name || '', stock: after });
  }

  lastRecovery = {
    ok: true,
    completed: true,
    incidentAt: BAD_SYNC_AT,
    affected: affected.length,
    backupCollection: RECOVERY_BACKUP_COLLECTION,
    backupCount: await backup.countDocuments({}),
    restoredVisible: restoreVisible.modifiedCount,
    restoredStockFromMovements,
    restored,
    remainingStockPending: await products.countDocuments({
      $and: [
        nonDsliteFilter(),
        { recoveryIncidentAt: BAD_SYNC_AT },
        { stock: 0 },
        { recoveryStatus: 'VISIBILITY_RESTORED_STOCK_PENDING' }
      ]
    }),
    recoveredAt: new Date(),
    storefrontPublishEnabled: false
  };

  await meta.updateOne({ key: 'legacyRecovery20261005' }, { $set: { value: lastRecovery, updatedAt: new Date() } }, { upsert: true });
  return lastRecovery;
}

async function syncSourceAndDrafts() {
  await connectMongo();
  const catalog = await fetchDsliteBetoCatalog({ timeoutMs: 30000 });
  if (catalog.approvedCount !== DSLITE_BETO_APPROVED_SKUS.length) {
    throw new Error(`Catálogo incompleto: ${catalog.approvedCount}/${DSLITE_BETO_APPROVED_SKUS.length}.`);
  }

  const shadow = db.collection(SHADOW_COLLECTION);
  const drafts = db.collection(DRAFT_COLLECTION);
  const now = new Date();
  const seenSourceSkus = [];

  for (const item of catalog.products) {
    const sourceSku = String(item.sku || '').trim();
    if (!sourceSku) continue;
    seenSourceSkus.push(sourceSku);
    const sku = `${SKU_PREFIX}${sourceSku}`;
    const pricing = calculatePricing(item.supplierCost);
    const supplierStock = Math.max(0, Number(item.supplierStock || 0));
    const imageUrls = Array.isArray(item.imageUrls) ? item.imageUrls.filter(Boolean) : [];
    const image = imageUrls[0] || '';
    const category = String(item.category || 'Móveis e Decoração');
    const variationGroup = item.variationGroup || item.parentSku || sourceSku;

    const common = {
      sourceSku, sku, name: item.name, description: item.name,
      category, categoryName: category, brand: item.brand || 'Beto Móveis',
      supplier: 'Beto Móveis', supplierId: DSLITE_BETO_SUPPLIER_ID,
      supplierCost: pricing.supplierCost, supplierStock, ean: item.ean || '',
      parentSku: item.parentSku || '', variationGroup,
      image, imageUrl: image, imageUrls,
      images: imageUrls.map((url, index) => ({ url, path: url, isMain: index === 0 })),
      ncm: '9403.60.00', cestReference: '28.061.00', originUf: 'SP', destinationUf: 'MG',
      taxType: 'ICMS_ANTECIPACAO_SIMPLES_NACIONAL', taxRate: pricing.taxRate, taxAmount: pricing.taxAmount,
      pricingBase: pricing.pricingBase, pricingDivisor: PRICING_DIVISOR,
      pricingRule: '(custo + tributação de entrada aplicável) / 0,70',
      price: pricing.price, pixPrice: pricing.pixPrice, installmentCount: 12,
      needsNfeReconciliation: true, syncedAt: now
    };

    await shadow.updateOne(
      { sourceSku },
      { $set: { ...common, rawCategory: item.rawCategory || '', shadowOnly: true, active: false }, $setOnInsert: { createdAt: now } },
      { upsert: true }
    );

    await drafts.updateOne(
      { sourceKey: sku },
      {
        $set: {
          ...common, sourceKey: sku, slug: `dslite-beto-${sourceSku.toLowerCase()}`,
          stock: 0, active: false, storefrontStatus: 'draft',
          storefrontPublishEnabled: storefrontEnabled(), reviewRequired: false,
          draftReady: Boolean(item.name && image && pricing.price > 0), publicCollectionTouched: false
        },
        $setOnInsert: { createdAt: now }
      },
      { upsert: true }
    );
  }

  await shadow.updateMany({ sourceSku: { $nin: seenSourceSkus } }, { $set: { supplierStock: 0, active: false, syncedAt: now } });
  return { totalParsed: catalog.totalParsed, approvedCount: catalog.approvedCount, syncedAt: now };
}

async function syncPublicStorefront() {
  if (!storefrontEnabled()) return { ok: true, skipped: true, reason: 'storefront_disabled' };
  await connectMongo();

  const drafts = db.collection(DRAFT_COLLECTION);
  const products = db.collection(PUBLIC_COLLECTION);
  const rows = await drafts.find({ draftReady: true, sku: { $regex: `^${SKU_PREFIX}` } }).toArray();
  if (rows.length !== DSLITE_BETO_APPROVED_SKUS.length) throw new Error(`Rascunhos incompletos para vitrine: ${rows.length}/${DSLITE_BETO_APPROVED_SKUS.length}.`);

  const now = new Date();
  const liveSkus = [];
  let created = 0;
  let updated = 0;

  for (const row of rows) {
    const sku = String(row.sku || '').trim();
    if (!sku.startsWith(SKU_PREFIX)) continue;
    liveSkus.push(sku);
    const stock = Math.max(0, Number(row.supplierStock || 0));
    const active = stock > 0;
    const doc = {
      name: row.name, slug: row.slug, description: row.description || row.name,
      category: row.category, categoryName: row.categoryName || row.category,
      brand: row.brand || 'Beto Móveis', sku,
      price: Number(row.price || 0), pixPrice: Number(row.pixPrice || 0), installmentCount: 12,
      image: row.image, imageUrl: row.imageUrl || row.image, imagem: row.image, mainImageUrl: row.image,
      images: row.images || [], imageUrls: row.imageUrls || [], stock, active,
      storefrontStatus: active ? 'published' : 'out_of_stock', storefrontSource: 'dslite',
      dropshipping: {
        enabled: true, provider: 'dslite', supplier: 'Beto Móveis', supplierId: DSLITE_BETO_SUPPLIER_ID,
        sourceSku: row.sourceSku, supplierStock: stock, parentSku: row.parentSku || '',
        variationGroup: row.variationGroup || row.sourceSku || '', ean: row.ean || '',
        ncm: row.ncm || '9403.60.00', cestReference: row.cestReference || '28.061.00',
        originUf: row.originUf || 'SP', destinationUf: row.destinationUf || 'MG',
        supplierCost: Number(row.supplierCost || 0), taxAmount: Number(row.taxAmount || 0),
        taxRate: Number(row.taxRate || 0), pricingBase: Number(row.pricingBase || 0),
        pricingDivisor: Number(row.pricingDivisor || PRICING_DIVISOR),
        pricingRule: row.pricingRule || '(custo + tributação de entrada aplicável) / 0,70',
        needsNfeReconciliation: row.needsNfeReconciliation !== false, syncedAt: now
      },
      updatedAt: now
    };

    const result = await products.updateOne({ sku }, { $set: doc, $setOnInsert: { createdAt: now } }, { upsert: true });
    if (result.upsertedCount) created += 1;
    else if (result.matchedCount) updated += 1;
  }

  // Trava definitiva: somente SKUs do Beto podem ser zerados pela sincronização DSLite.
  await products.updateMany(
    { $and: [
      { sku: { $regex: `^${SKU_PREFIX}` } },
      { sku: { $nin: liveSkus } }
    ] },
    { $set: { stock: 0, active: false, storefrontStatus: 'out_of_stock', updatedAt: now } }
  );

  await drafts.updateMany({ sku: { $regex: `^${SKU_PREFIX}` } }, { $set: { publicCollectionTouched: true, syncedAt: now } });
  lastPublicSync = {
    ok: true,
    total: await products.countDocuments({ sku: { $regex: `^${SKU_PREFIX}` } }),
    active: await products.countDocuments({ sku: { $regex: `^${SKU_PREFIX}` }, active: true }),
    withStock: await products.countDocuments({ sku: { $regex: `^${SKU_PREFIX}` }, stock: { $gt: 0 } }),
    created, updated, syncedAt: now
  };
  await db.collection(META_COLLECTION).updateOne({ key: 'lastPublicSync' }, { $set: { value: lastPublicSync, updatedAt: now } }, { upsert: true });
  return lastPublicSync;
}

async function runFullSync() {
  if (syncRunning) return lastPublicSync;
  syncRunning = true;
  try {
    await syncSourceAndDrafts();
    return await syncPublicStorefront();
  } finally {
    syncRunning = false;
  }
}

app.get('/', async (_req, res) => {
  try {
    await connectMongo();
    res.json({ ok: true, service: 'Ariana DSLite Beto', mode: storefrontEnabled() ? 'storefront_sync' : 'safe_hold', storefrontPublishEnabled: storefrontEnabled(), pricingRule: '(custo + tributação de entrada aplicável) / 0,70', lastPublicSync, lastRecovery });
  } catch (error) { res.status(500).json({ ok: false, error: error.message }); }
});

app.get('/health', (_req, res) => res.json({ ok: true, storefrontPublishEnabled: storefrontEnabled(), syncRunning }));

app.get('/recovery-status', async (_req, res) => {
  try {
    await connectMongo();
    const products = db.collection(PUBLIC_COLLECTION);
    const meta = await db.collection(META_COLLECTION).findOne({ key: 'legacyRecovery20261005' });
    res.json({
      ok: true,
      storefrontPublishEnabled: storefrontEnabled(),
      recovery: meta?.value || lastRecovery || null,
      totalProducts: await products.countDocuments({}),
      dsliteBetoTotal: await products.countDocuments({ sku: { $regex: `^${SKU_PREFIX}` } }),
      nonDsliteTotal: await products.countDocuments(nonDsliteFilter()),
      nonDsliteActive: await products.countDocuments({ $and: [nonDsliteFilter(), { active: true }] }),
      nonDsliteWithStock: await products.countDocuments({ $and: [nonDsliteFilter(), { stock: { $gt: 0 } }] }),
      backupCount: await db.collection(RECOVERY_BACKUP_COLLECTION).countDocuments({})
    });
  } catch (error) { res.status(500).json({ ok: false, error: error.message }); }
});

app.get('/safety-status', async (_req, res) => {
  try {
    await connectMongo();
    const products = db.collection(PUBLIC_COLLECTION);
    res.json({
      ok: true,
      storefrontPublishEnabled: storefrontEnabled(),
      totalProducts: await products.countDocuments({}),
      dsliteBetoTotal: await products.countDocuments({ sku: { $regex: `^${SKU_PREFIX}` } }),
      nonDsliteTotal: await products.countDocuments(nonDsliteFilter()),
      nonDsliteActive: await products.countDocuments({ $and: [nonDsliteFilter(), { active: true }] }),
      nonDsliteWithStock: await products.countDocuments({ $and: [nonDsliteFilter(), { stock: { $gt: 0 } }] }),
      lastRecovery
    });
  } catch (error) { res.status(500).json({ ok: false, error: error.message }); }
});

app.get('/public-status', async (_req, res) => {
  try {
    await connectMongo();
    const products = db.collection(PUBLIC_COLLECTION);
    const filter = { sku: { $regex: `^${SKU_PREFIX}` } };
    const sample = await products.find(filter, { projection: { _id: 0, sku: 1, name: 1, price: 1, pixPrice: 1, stock: 1, active: 1, image: 1 } }).limit(5).toArray();
    res.json({ ok: true, storefrontPublishEnabled: storefrontEnabled(), total: await products.countDocuments(filter), active: await products.countDocuments({ ...filter, active: true }), withStock: await products.countDocuments({ ...filter, stock: { $gt: 0 } }), sample, lastPublicSync });
  } catch (error) { res.status(500).json({ ok: false, error: error.message }); }
});

app.get('/pricing-preview', async (_req, res) => {
  try {
    await connectMongo();
    const rows = await db.collection(DRAFT_COLLECTION).find({}, { projection: { _id: 0, sku: 1, name: 1, supplierCost: 1, taxAmount: 1, pricingBase: 1, price: 1, pixPrice: 1, supplierStock: 1 } }).sort({ name: 1 }).toArray();
    res.json({ ok: true, total: rows.length, products: rows });
  } catch (error) { res.status(500).json({ ok: false, error: error.message }); }
});

app.listen(port, '0.0.0.0', async () => {
  console.log(`[dslite-beto] online ${port} | vitrine=${storefrontEnabled() ? 'habilitada' : 'desabilitada'} | filtro isolado=${SKU_PREFIX}`);
  try {
    await connectMongo();
    lastRecovery = await recoverLegacyCatalog();
    console.log('[dslite-beto][legacy-recovery]', JSON.stringify(lastRecovery));
    await runFullSync();
  } catch (error) {
    console.error('[dslite-beto] inicialização/sincronização não executada:', error?.message || error);
  }
  setInterval(async () => {
    try { await runFullSync(); }
    catch (error) { console.error('[dslite-beto] sincronização periódica não executada:', error?.message || error); }
  }, SYNC_INTERVAL_MS).unref();
});
