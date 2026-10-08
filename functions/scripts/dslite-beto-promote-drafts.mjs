import mongoose from 'mongoose';

const mongoUri = String(process.env.MONGODB_URI || '').trim();
const mongoDb = String(process.env.MONGODB_DB || 'ariana_moveis_db').trim();
const CONFIRMATION = 'CONFIRM_45_BETO_DRAFTS';
const guard = String(process.env.DSLITE_PROMOTE_PUBLIC_DRAFTS || '').trim();

if (!mongoUri) throw new Error('MONGODB_URI não configurada.');
if (guard !== CONFIRMATION) {
  throw new Error(`Promoção bloqueada. Configure DSLITE_PROMOTE_PUBLIC_DRAFTS=${CONFIRMATION} somente após validar o guard do catálogo público.`);
}

await mongoose.connect(mongoUri, { dbName: mongoDb });

const db = mongoose.connection.db;
const drafts = db.collection('dslite_beto_catalog_drafts');
const products = db.collection('products');

const rows = await drafts.find({ draftReady: true }).toArray();
if (rows.length !== 45) throw new Error(`Rascunhos incompletos: ${rows.length}/45.`);

const invalid = rows.filter((row) => row.active !== false || row.storefrontPublishEnabled !== false || !row.price || !row.image || !row.sku);
if (invalid.length) throw new Error(`Há ${invalid.length} rascunho(s) inválido(s) para promoção.`);

let created = 0;
let updated = 0;
const now = new Date();

for (const row of rows) {
  const sku = String(row.sku || '').trim();
  if (!sku.startsWith('DSLITE-BETO-')) throw new Error(`SKU fora do escopo DSLite Beto: ${sku}`);

  const existing = await products.findOne({ sku });
  if (existing && String(existing.sku || '').startsWith('DSLITE-BETO-') === false) {
    throw new Error(`Conflito de SKU com produto não DSLite: ${sku}`);
  }

  const doc = {
    name: row.name,
    description: row.description || row.name,
    sku,
    slug: row.slug,
    category: row.category,
    categoryName: row.categoryName || row.category,
    brand: row.brand || 'Beto Móveis',
    price: Number(row.price || 0),
    pixPrice: Number(row.pixPrice || 0),
    installmentCount: Number(row.installmentCount || 12),
    costPrice: Number(row.supplierCost || 0),
    costSource: 'dslite_beto',
    costNotes: 'Custo fornecedor + tributação de entrada tratados pela integração DSLite.',
    costUpdatedAt: now,
    costUpdatedBy: 'dslite-beto-shadow',
    stock: 0,
    supplierStock: Number(row.supplierStock || 0),
    image: row.image,
    imageUrl: row.imageUrl || row.image,
    imagem: row.image,
    mainImageUrl: row.image,
    images: row.images || [],
    imageUrls: row.imageUrls || [],
    active: false,
    storefrontStatus: 'draft',
    storefrontPublishEnabled: false,
    reviewRequired: true,
    source: 'dslite',
    supplier: 'Beto Móveis',
    supplierId: 41,
    sourceSku: row.sourceSku,
    parentSku: row.parentSku || '',
    variationGroup: row.variationGroup || row.sourceSku || '',
    ean: row.ean || '',
    ncm: row.ncm || '',
    cestReference: row.cestReference || '',
    originUf: row.originUf || 'SP',
    destinationUf: row.destinationUf || 'MG',
    goodsOriginType: row.goodsOriginType || 'NATIONAL_PROVISIONAL',
    taxAmount: Number(row.taxAmount || 0),
    taxRate: Number(row.taxRate || 0),
    taxStatus: row.taxStatus || '',
    pricingBase: Number(row.pricingBase || 0),
    pricingDivisor: Number(row.pricingDivisor || 0.70),
    pricingRule: row.pricingRule || '(custo + tributação de entrada aplicável) / 0,70',
    needsNfeReconciliation: row.needsNfeReconciliation !== false,
    dsliteDraftPromotedAt: now,
    updatedAt: now
  };

  const result = await products.updateOne(
    { sku },
    { $set: doc, $setOnInsert: { createdAt: now } },
    { upsert: true }
  );
  if (result.upsertedCount) created += 1;
  else if (result.matchedCount) updated += 1;
}

const activeCount = await products.countDocuments({ sku: /^DSLITE-BETO-/, active: true });
if (activeCount !== 0) throw new Error(`Falha de segurança: ${activeCount} produto(s) DSLite ficaram ativos.`);

console.log(JSON.stringify({
  ok: true,
  promoted: rows.length,
  created,
  updated,
  activePublic: activeCount,
  stockPublicZero: await products.countDocuments({ sku: /^DSLITE-BETO-/, stock: 0 }),
  storefrontPublishEnabled: false
}, null, 2));

await mongoose.disconnect();
