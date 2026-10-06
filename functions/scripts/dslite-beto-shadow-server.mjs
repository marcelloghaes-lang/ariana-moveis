import express from 'express';
import mongoose from 'mongoose';

const app = express();
const port = Number(process.env.PORT || 10000);
const mongoUri = String(process.env.MONGODB_URI || '').trim();
const mongoDb = String(process.env.MONGODB_DB || 'ariana_moveis_db').trim();
const cutoff = new Date('2026-10-03T17:27:00.000Z');
let report = { ok: false, status: 'starting' };

const dsliteFilter = {
  $or: [
    { sku: { $regex: /^DSLITE-BETO-/i } },
    { storefrontSource: { $regex: /^dslite$/i } },
    { 'dropshipping.provider': { $regex: /^dslite$/i } },
    { 'dropshipping.supplier': { $regex: /beto/i } },
    { brand: { $regex: /^beto/i } }
  ]
};

const noImageFilter = {
  $and: [
    { $or: [{ image: { $exists: false } }, { image: null }, { image: '' }] },
    { $or: [{ imageUrl: { $exists: false } }, { imageUrl: null }, { imageUrl: '' }] },
    { $or: [{ imagem: { $exists: false } }, { imagem: null }, { imagem: '' }] },
    { $or: [{ mainImageUrl: { $exists: false } }, { mainImageUrl: null }, { mainImageUrl: '' }] },
    { $or: [{ images: { $exists: false } }, { images: { $size: 0 } }] },
    { $or: [{ imageUrls: { $exists: false } }, { imageUrls: { $size: 0 } }] },
    { $or: [{ imagePaths: { $exists: false } }, { imagePaths: { $size: 0 } }] }
  ]
};

function hasImage(p = {}) {
  return Boolean(
    String(p.image || p.imageUrl || p.imagem || p.mainImageUrl || '').trim() ||
    (Array.isArray(p.images) && p.images.length) ||
    (Array.isArray(p.imageUrls) && p.imageUrls.length) ||
    (Array.isArray(p.imagePaths) && p.imagePaths.length)
  );
}

function productScore(p = {}) {
  let score = 0;
  if (hasImage(p)) score += 10000;
  if (Number(p.stock || 0) > 0) score += 1000;
  if (String(p.name || '').trim()) score += 100;
  if (Number(p.price || 0) > 0) score += 50;
  if (String(p.description || '').trim()) score += 10;
  if (p.active !== false) score += 5;
  const created = p.createdAt ? new Date(p.createdAt).getTime() : Number.MAX_SAFE_INTEGER;
  score += Number.isFinite(created) ? Math.max(0, 1 - created / 1e16) : 0;
  return score;
}

async function removeDocsOneByOne(collection, ids = []) {
  let removed = 0;
  for (const id of ids) {
    const result = await collection.deleteOne({ _id: id });
    removed += Number(result.deletedCount || 0);
  }
  return removed;
}

async function clearCollectionOneByOne(db, name) {
  const exists = (await db.listCollections({ name }).toArray()).length > 0;
  if (!exists) return 0;
  const collection = db.collection(name);
  const ids = await collection.find({}).project({ _id: 1 }).toArray();
  return removeDocsOneByOne(collection, ids.map(x => x._id));
}

async function duplicateGroups(products) {
  return products.aggregate([
    { $match: { sku: { $exists: true, $nin: [null, ''] } } },
    { $group: { _id: { $toUpper: '$sku' }, count: { $sum: 1 }, ids: { $push: '$_id' } } },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } }
  ]).toArray();
}

async function runCleanup() {
  if (!mongoUri) throw new Error('MONGODB_URI não configurada');
  await mongoose.connect(mongoUri, { dbName: mongoDb });
  const db = mongoose.connection.db;
  const products = db.collection('products');

  const before = {
    total: await products.countDocuments({}),
    dsliteBeto: await products.countDocuments(dsliteFilter),
    createdAfterCutoff: await products.countDocuments({ createdAt: { $gt: cutoff } }),
    activeNoImage: await products.countDocuments({ $and: [{ active: true }, noImageFilter] }),
    duplicateSkuGroups: (await duplicateGroups(products)).length
  };

  const removable = await products.find({
    $or: [dsliteFilter, { createdAt: { $gt: cutoff } }]
  }).project({ _id: 1 }).toArray();
  const removedDsliteOrPostCutoff = await removeDocsOneByOne(products, removable.map(x => x._id));

  const groups = await duplicateGroups(products);
  let removedDuplicateProducts = 0;
  const duplicateDecisions = [];
  for (const group of groups) {
    const docs = await products.find({ _id: { $in: group.ids } }).toArray();
    docs.sort((a, b) => {
      const diff = productScore(b) - productScore(a);
      if (Math.abs(diff) > 0.000001) return diff;
      return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
    });
    const keep = docs[0];
    const remove = docs.slice(1);
    const removed = await removeDocsOneByOne(products, remove.map(x => x._id));
    removedDuplicateProducts += removed;
    duplicateDecisions.push({ sku: group._id, keptId: String(keep?._id || ''), removed });
  }

  const hiddenNoImage = await products.updateMany(noImageFilter, { $set: { active: false } });
  await products.updateMany({}, {
    $unset: {
      recoveryIncidentAt: '', recoveryStatus: '', recoveryUpdatedAt: '',
      recoveryStockSource: '', recoveryStockMovementAt: '', recoveryBackupCreatedAt: ''
    }
  });

  const auxiliary = [
    'dslite_beto_catalog_drafts',
    'dslite_beto_shadow_products',
    'dslite_beto_shadow_meta',
    'dslite_recovery_backup_20261005_173056'
  ];
  const clearedCollections = {};
  for (const name of auxiliary) clearedCollections[name] = await clearCollectionOneByOne(db, name);

  const afterGroups = await duplicateGroups(products);
  const collectionCounts = {};
  for (const name of auxiliary) {
    const exists = (await db.listCollections({ name }).toArray()).length > 0;
    collectionCounts[name] = exists ? await db.collection(name).countDocuments({}) : 0;
  }

  report = {
    ok: true,
    status: 'cleanup_completed',
    cutoff: cutoff.toISOString(),
    before,
    actions: {
      removedDsliteOrPostCutoff,
      removedDuplicateProducts,
      hiddenNoImageProducts: Number(hiddenNoImage.modifiedCount || 0),
      clearedCollections,
      duplicateDecisions
    },
    after: {
      total: await products.countDocuments({}),
      dsliteBeto: await products.countDocuments(dsliteFilter),
      createdAfterCutoff: await products.countDocuments({ createdAt: { $gt: cutoff } }),
      active: await products.countDocuments({ active: true }),
      activeNoImage: await products.countDocuments({ $and: [{ active: true }, noImageFilter] }),
      noImage: await products.countDocuments(noImageFilter),
      positiveStock: await products.countDocuments({ stock: { $gt: 0 } }),
      zeroStock: await products.countDocuments({ stock: { $lte: 0 } }),
      duplicateSkuGroups: afterGroups.length,
      dsliteCollectionCounts: collectionCounts
    },
    completedAt: new Date().toISOString()
  };
  console.log('[ARIANA-CATALOG-CLEANUP]', JSON.stringify(report));
  await mongoose.disconnect();
}

app.get('/', (_req, res) => res.json(report));
app.get('/health', (_req, res) => res.status(report.ok ? 200 : 503).json(report));
app.get('/report', (_req, res) => res.json(report));
app.listen(port, '0.0.0.0', () => {
  console.log(`[ARIANA-CATALOG-CLEANUP] listening ${port}`);
  runCleanup().catch(async (error) => {
    report = { ok: false, status: 'cleanup_failed', error: error?.message || String(error) };
    console.error('[ARIANA-CATALOG-CLEANUP] ERROR', error);
    try { await mongoose.disconnect(); } catch {}
  });
});
