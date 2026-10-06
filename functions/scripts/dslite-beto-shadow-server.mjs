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

async function audit() {
  if (!mongoUri) throw new Error('MONGODB_URI não configurada');
  await mongoose.connect(mongoUri, { dbName: mongoDb });
  const db = mongoose.connection.db;
  const products = db.collection('products');
  const duplicates = await products.aggregate([
    { $match: { sku: { $exists: true, $nin: [null, ''] } } },
    { $group: { _id: { $toUpper: '$sku' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } }
  ]).toArray();
  report = {
    ok: true,
    status: 'audit_completed',
    cutoff: cutoff.toISOString(),
    products: {
      total: await products.countDocuments({}),
      dsliteBeto: await products.countDocuments(dsliteFilter),
      createdAfterCutoff: await products.countDocuments({ createdAt: { $gt: cutoff } }),
      createdAfterCutoffNoImage: await products.countDocuments({ $and: [{ createdAt: { $gt: cutoff } }, noImageFilter] }),
      active: await products.countDocuments({ active: true }),
      noImage: await products.countDocuments(noImageFilter),
      activeNoImage: await products.countDocuments({ $and: [{ active: true }, noImageFilter] }),
      positiveStock: await products.countDocuments({ stock: { $gt: 0 } }),
      zeroStock: await products.countDocuments({ stock: { $lte: 0 } }),
      duplicateSkuGroups: duplicates.length
    },
    dsliteCollections: (await db.listCollections().toArray()).map(x => x.name).filter(n => /dslite|beto/i.test(n)),
    auditedAt: new Date().toISOString()
  };
  console.log('[ARIANA-CATALOG-AUDIT]', JSON.stringify(report));
  await mongoose.disconnect();
}

app.get('/', (_req, res) => res.json(report));
app.get('/health', (_req, res) => res.status(report.ok ? 200 : 503).json(report));
app.get('/report', (_req, res) => res.json(report));
app.listen(port, '0.0.0.0', () => {
  console.log(`[ARIANA-CATALOG-AUDIT] listening ${port}`);
  audit().catch(async (error) => {
    report = { ok: false, status: 'audit_failed', error: error?.message || String(error) };
    console.error('[ARIANA-CATALOG-AUDIT] ERROR', error);
    try { await mongoose.disconnect(); } catch {}
  });
});
