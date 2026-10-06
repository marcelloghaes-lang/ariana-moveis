import mongoose from 'mongoose';

const mongoUri = String(process.env.MONGODB_URI || '').trim();
const mongoDb = String(process.env.MONGODB_DB || 'ariana_moveis_db').trim();
const INCIDENT_AT = new Date('2026-10-05T17:30:56.903Z');
const PREFIX = 'DSLITE-BETO-';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const n = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

function getPath(obj, path) {
  return String(path).split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

const STOCK_PATHS = [
  'stock','estoque','qty','quantity','quantidade','availableStock','available_stock','saldoEstoque','saldo_estoque',
  'inventory','inventory.stock','inventory.quantity','logistics.stock','metadata.stock','metadata.estoque',
  'specs.stock','specs.estoque','sellerStock','supplierStock','sourceStock','dropshipping.sourceStock','dropshipping.supplierStock'
];

async function run() {
  if (!mongoUri) {
    console.log('[dslite-recovery-audit] MONGODB_URI ausente; auditoria não executada');
    return;
  }
  let conn;
  try {
    conn = await mongoose.createConnection(mongoUri, { dbName: mongoDb, serverSelectionTimeoutMS: 12000 }).asPromise();
    const db = conn.db;
    const products = db.collection('products');
    const nonDslite = { $or: [
      { sku: { $not: { $regex: `^${PREFIX}` } } },
      { sku: { $exists: false } },
      { sku: null }
    ] };

    const affected = await products.find({ ...nonDslite, recoveryIncidentAt: INCIDENT_AT }).toArray();
    const ids = affected.map((p) => p._id);
    const skus = affected.map((p) => String(p.sku || '').trim()).filter(Boolean);

    const aliasCounts = {};
    const aliasSamples = {};
    for (const path of STOCK_PATHS) {
      let count = 0;
      const samples = [];
      for (const p of affected) {
        const value = n(getPath(p, path));
        if (value != null && value > 0) {
          count += 1;
          if (samples.length < 8) samples.push({ sku: p.sku || '', name: p.name || '', value });
        }
      }
      if (count) {
        aliasCounts[path] = count;
        aliasSamples[path] = samples;
      }
    }

    const collections = await db.listCollections({}, { nameOnly: true }).toArray();
    const relevant = [];
    for (const row of collections) {
      const name = String(row.name || '');
      if (!/(product|produto|stock|estoque|invent|catalog|audit|history|movement|moviment|snapshot|backup)/i.test(name)) continue;
      const col = db.collection(name);
      let count = 0;
      let keys = [];
      try {
        count = await col.estimatedDocumentCount();
        const sample = await col.findOne({});
        keys = sample ? Object.keys(sample).slice(0, 60) : [];
      } catch {}
      relevant.push({ name, count, keys });
    }

    const candidateCollections = [];
    for (const info of relevant) {
      if (info.name === 'products' || info.name === 'dslite_recovery_backup_20261005_173056') continue;
      const col = db.collection(info.name);
      const probes = [];
      try {
        if (ids.length) {
          const q = { $or: [
            { productId: { $in: ids } }, { product: { $in: ids } }, { _id: { $in: ids } }
          ] };
          const rows = await col.find(q).limit(8).toArray();
          for (const doc of rows) probes.push(doc);
        }
      } catch {}
      try {
        if (!probes.length && skus.length) {
          const q = { $or: [
            { sku: { $in: skus } }, { productSku: { $in: skus } }, { codigo: { $in: skus } }
          ] };
          const rows = await col.find(q).limit(8).toArray();
          for (const doc of rows) probes.push(doc);
        }
      } catch {}
      if (probes.length) {
        candidateCollections.push({
          name: info.name,
          matchedSampleCount: probes.length,
          sampleKeys: [...new Set(probes.flatMap((d) => Object.keys(d)))].slice(0, 80),
          samples: probes.slice(0, 4).map((d) => {
            const out = {};
            for (const key of Object.keys(d)) {
              if (/(stock|estoque|qty|quantity|quantidade|saldo|after|before|sku|productId|name|nome|createdAt|updatedAt)/i.test(key)) out[key] = d[key];
            }
            return out;
          })
        });
      }
    }

    console.log('[dslite-recovery-audit] RESULT', JSON.stringify({
      affected: affected.length,
      positiveCurrentStock: affected.filter((p) => Number(p.stock || 0) > 0).length,
      aliasCounts,
      aliasSamples,
      relevantCollections: relevant,
      candidateCollections
    }));
  } catch (error) {
    console.error('[dslite-recovery-audit] ERROR', error?.message || error);
  } finally {
    try { await conn?.close(); } catch {}
  }
}

// Espera o processo principal subir e executa uma auditoria única, somente leitura.
setTimeout(() => { run().catch(() => {}); }, 2500);
