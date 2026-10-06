import mongoose from 'mongoose';

const mongoUri = String(process.env.MONGODB_URI || '').trim();
const mongoDb = String(process.env.MONGODB_DB || 'ariana_moveis_db').trim();
const INCIDENT_AT = new Date('2026-10-05T17:30:56.903Z');

async function run() {
  if (!mongoUri) return;
  let conn;
  try {
    conn = await mongoose.createConnection(mongoUri, { dbName: mongoDb, serverSelectionTimeoutMS: 12000 }).asPromise();
    const db = conn.db;
    const products = db.collection('products');
    const affected = await products.find({ recoveryIncidentAt: INCIDENT_AT, sku: { $not: /^DSLITE-BETO-/ } })
      .project({ _id: 1, sku: 1, name: 1 }).toArray();
    const ids = affected.map(x => x._id);
    const skus = affected.map(x => String(x.sku || '').trim()).filter(Boolean);

    const collections = await db.listCollections({}, { nameOnly: true }).toArray();
    const allNames = collections.map(x => x.name).sort();
    const summaries = [];

    for (const name of allNames) {
      if (['products','dslite_recovery_backup_20261005_173056'].includes(name)) continue;
      const col = db.collection(name);
      let count = 0;
      let sample = null;
      try {
        count = await col.estimatedDocumentCount();
        sample = await col.findOne({});
      } catch { continue; }
      if (!sample) continue;
      const keys = Object.keys(sample);
      const keyText = keys.join(' ');
      const interesting = /(product|produto|item|sku|stock|estoque|saldo|quantity|quantidade|inventory|inventario|purchase|compra|sale|venda|order|pedido)/i.test(`${name} ${keyText}`);
      if (!interesting) continue;

      let directMatches = 0;
      let nestedStockRows = 0;
      const probes = [];
      const ors = [];
      if (ids.length) ors.push({ productId: { $in: ids } }, { produtoId: { $in: ids } }, { 'product._id': { $in: ids } }, { 'produto._id': { $in: ids } });
      if (skus.length) ors.push({ sku: { $in: skus } }, { productSku: { $in: skus } }, { produtoSku: { $in: skus } }, { codigo: { $in: skus } }, { 'product.sku': { $in: skus } }, { 'produto.sku': { $in: skus } });
      if (ors.length) {
        try {
          directMatches = await col.countDocuments({ $or: ors });
          if (directMatches) probes.push(...await col.find({ $or: ors }).limit(5).toArray());
        } catch {}
      }
      try {
        nestedStockRows = await col.countDocuments({ $or: [
          { stock: { $exists: true } }, { estoque: { $exists: true } }, { quantity: { $exists: true } }, { quantidade: { $exists: true } },
          { 'antes.stock': { $exists: true } }, { 'depois.stock': { $exists: true } }, { 'before.stock': { $exists: true } }, { 'after.stock': { $exists: true } },
          { 'metadata.stock': { $exists: true } }, { 'payload.stock': { $exists: true } }
        ] });
      } catch {}

      summaries.push({
        name, count, keys: keys.slice(0,80), directMatches, nestedStockRows,
        probes: probes.map(doc => ({
          _id: doc._id,
          productId: doc.productId ?? doc.produtoId ?? null,
          sku: doc.sku ?? doc.productSku ?? doc.produtoSku ?? doc.codigo ?? null,
          name: doc.name ?? doc.nome ?? doc.productName ?? doc.produtoNome ?? null,
          stock: doc.stock ?? doc.estoque ?? null,
          quantity: doc.quantity ?? doc.quantidade ?? null,
          before: doc.before ?? doc.antes ?? null,
          after: doc.after ?? doc.depois ?? null,
          createdAt: doc.createdAt ?? null,
          updatedAt: doc.updatedAt ?? null
        }))
      });
    }

    const financeiro = db.collection('financeiro_auditoria');
    let financeiroStock = [];
    try {
      financeiroStock = await financeiro.find({ $or: [
        { 'antes.stock': { $exists: true } }, { 'depois.stock': { $exists: true } },
        { 'antes.estoque': { $exists: true } }, { 'depois.estoque': { $exists: true } },
        { 'metadata.stock': { $exists: true } }, { 'metadata.estoque': { $exists: true } }
      ] }).sort({ createdAt: -1 }).limit(20).toArray();
    } catch {}

    console.log('[dslite-recovery-audit2] RESULT', JSON.stringify({
      allCollectionNames: allNames,
      summaries,
      financeiroStock: financeiroStock.map(x => ({
        modulo:x.modulo, acao:x.acao, entidade:x.entidade, entidadeId:x.entidadeId, codigo:x.codigo,
        antes:x.antes, depois:x.depois, metadata:x.metadata, createdAt:x.createdAt
      }))
    }));
  } catch (error) {
    console.error('[dslite-recovery-audit2] ERROR', error?.message || error);
  } finally {
    try { await conn?.close(); } catch {}
  }
}
setTimeout(() => { run().catch(() => {}); }, 2500);
