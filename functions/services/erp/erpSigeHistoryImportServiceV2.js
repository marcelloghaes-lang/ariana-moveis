import crypto from 'crypto';
import mongoose from 'mongoose';
import { extractCsvFilesFromZip, parseCsvBuffer } from './erpSigeMigrationService.js';

const clean = (v = '', m = 2000) => String(v ?? '').trim().slice(0, m);
const norm = (v = '') => clean(v, 500)
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();
const digits = (v = '') => String(v ?? '').replace(/\D/g, '');
const num = (v = 0) => {
  const s = String(v ?? '').trim();
  if (!s) return 0;
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) ? n : 0;
};
const money = (v = 0) => Math.round((num(v) + Number.EPSILON) * 100) / 100;
const yes = (v) => ['1', 'true', 'sim', 'yes'].includes(String(v ?? '').trim().toLowerCase());
const dt = (v) => {
  const raw = clean(v, 100);
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
};
const chunks = (arr, size = 500) => Array.from(
  { length: Math.ceil(arr.length / size) },
  (_, i) => arr.slice(i * size, (i + 1) * size)
);

function csvRows(files, names) {
  const out = [];
  for (const name of names) {
    const file = files.get(name);
    if (file) out.push(...parseCsvBuffer(file));
  }
  return out;
}

function dataset(file) {
  const files = extractCsvFilesFromZip(file.buffer);
  return {
    sales: csvRows(files, ['vendas_pedidos.csv', 'vendas.csv']),
    items: csvRows(files, ['itens_vendas.csv', 'itens_venda.csv']),
    entries: csvRows(files, ['contas_pagar_receber.csv', 'contas_receber.csv', 'contas_pagar.csv']),
    payments: csvRows(files, ['pagamentos_baixas.csv', 'pagamentos.csv'])
  };
}

function groupBy(rows, field) {
  const map = new Map();
  for (const row of rows) {
    const key = clean(row[field], 120);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function duplicateCount(rows) {
  const seen = new Set();
  const duplicates = new Set();
  for (const row of rows) {
    const id = clean(row.Id, 120);
    if (!id) continue;
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return duplicates.size;
}

async function bulk(modelOrCollection, operations, batchSize = 500) {
  let upserted = 0;
  let matched = 0;
  for (const part of chunks(operations, batchSize)) {
    if (!part.length) continue;
    const result = await modelOrCollection.bulkWrite(part, { ordered: false });
    upserted += Number(result.upsertedCount || 0);
    matched += Number(result.matchedCount || 0);
  }
  return { upserted, matched };
}

const saleSchema = new mongoose.Schema({
  sourceSystem: { type: String, default: 'sige' },
  sourceId: { type: String, required: true, index: true },
  code: String,
  customerSourceId: String,
  customerName: String,
  customerDocument: String,
  date: Date,
  status: String,
  billed: Boolean,
  sellerName: String,
  subtotal: Number,
  shipping: Number,
  total: Number,
  paymentCondition: String,
  invoiceNumber: String,
  invoiceSerie: String,
  invoiceStatus: String,
  items: [mongoose.Schema.Types.Mixed],
  metadata: mongoose.Schema.Types.Mixed
}, { timestamps: true, versionKey: false, minimize: false });
saleSchema.index({ sourceSystem: 1, sourceId: 1 }, { unique: true });

const paymentSchema = new mongoose.Schema({
  sourceSystem: { type: String, default: 'sige' },
  sourceId: { type: String, required: true, index: true },
  entrySourceId: { type: String, index: true },
  paymentDate: Date,
  paymentMethod: String,
  bankSourceId: String,
  bankAccountId: String,
  bankAccountName: String,
  value: Number,
  discounts: Number,
  increases: Number,
  paidValue: Number
}, { timestamps: true, versionKey: false });
paymentSchema.index({ sourceSystem: 1, sourceId: 1 }, { unique: true });

const runSchema = new mongoose.Schema({
  source: String,
  packageName: String,
  packageSha256: String,
  scope: String,
  status: String,
  stats: mongoose.Schema.Types.Mixed,
  warnings: [String],
  actor: String,
  startedAt: Date,
  finishedAt: Date
}, { timestamps: true, versionKey: false, minimize: false });

const mapSchema = new mongoose.Schema({
  source: String,
  entityType: String,
  sourceId: String,
  targetModel: String,
  targetId: String,
  matchType: String,
  details: mongoose.Schema.Types.Mixed,
  importedAt: Date
}, { timestamps: true, versionKey: false, minimize: false });

const SaleHistory = mongoose.models.ErpSigeSaleHistory || mongoose.model('ErpSigeSaleHistory', saleSchema);
const PaymentHistory = mongoose.models.ErpSigePaymentHistory || mongoose.model('ErpSigePaymentHistory', paymentSchema);
const Run = mongoose.models.ErpMigrationRun || mongoose.model('ErpMigrationRun', runSchema);
const MapModel = mongoose.models.ErpMigrationMap || mongoose.model('ErpMigrationMap', mapSchema);

async function migrationMap(type) {
  const rows = await MapModel.find({ source: 'sige', entityType: type })
    .select('sourceId targetId')
    .lean();
  return new Map(rows.map((row) => [String(row.sourceId), String(row.targetId)]));
}

export function createErpSigeHistoryImportService() {
  const Entry = mongoose.models.ErpFinancialEntry;
  if (!Entry) throw new Error('[erp-sige-history] ErpFinancialEntry não inicializado');

  async function preview(file) {
    if (!file?.buffer) throw new Error('Selecione o ZIP da Etapa 2.');
    const data = dataset(file);
    const [productMap, categoryMap, bankMap] = await Promise.all([
      migrationMap('product'),
      migrationMap('account_category'),
      migrationMap('bank_account')
    ]);

    const saleIds = new Set(data.sales.map((row) => clean(row.Id, 120)).filter(Boolean));
    const entryIds = new Set(data.entries.map((row) => clean(row.Id, 120)).filter(Boolean));
    let itemWithoutProductMap = 0;
    let entrySaleMissing = 0;
    let paymentEntryMissing = 0;

    for (const row of data.items) {
      const productId = clean(row.ProductId, 120);
      if (productId && !productMap.has(productId)) itemWithoutProductMap += 1;
    }
    for (const row of data.entries) {
      const saleId = clean(row.SaleID, 120);
      if (saleId && !saleIds.has(saleId)) entrySaleMissing += 1;
    }
    for (const row of data.payments) {
      const entryId = clean(row.EntryId, 120);
      if (entryId && !entryIds.has(entryId)) paymentEntryMissing += 1;
    }

    const duplicates = {
      sales: duplicateCount(data.sales),
      entries: duplicateCount(data.entries),
      payments: duplicateCount(data.payments)
    };

    return {
      counts: {
        sales: data.sales.length,
        saleItems: data.items.length,
        financialEntries: data.entries.length,
        receivables: data.entries.filter((row) => norm(row.Type) === 'income').length,
        payables: data.entries.filter((row) => norm(row.Type) === 'expense').length,
        payments: data.payments.length
      },
      links: { itemWithoutProductMap, entrySaleMissing, paymentEntryMissing },
      availableMaps: { products: productMap.size, categories: categoryMap.size, banks: bankMap.size },
      duplicates,
      safeForImport: !duplicates.sales && !duplicates.entries && !duplicates.payments && !paymentEntryMissing,
      warnings: [
        itemWithoutProductMap ? `${itemWithoutProductMap} item(ns) manterão referência histórica até a revisão dos produtos.` : '',
        entrySaleMissing ? `${entrySaleMissing} lançamento(s) serão preservados sem inventar venda ausente.` : ''
      ].filter(Boolean)
    };
  }

  async function importHistory(file, confirmation, actor = {}) {
    if (confirmation !== 'IMPORTAR_HISTORICO_SIGE') {
      throw Object.assign(new Error('Confirmação da Etapa 2 inválida.'), { statusCode: 409 });
    }
    if (!file?.buffer) throw new Error('Selecione o ZIP da Etapa 2.');

    const data = dataset(file);
    const packageSha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
    const run = await Run.create({
      source: 'sige',
      packageName: clean(file.originalname || 'sige_historico.zip', 255),
      packageSha256,
      scope: 'history-sales-finance',
      status: 'running',
      stats: { phase: 'starting' },
      warnings: [],
      actor: clean(actor.name || actor.email || 'Administrador', 180),
      startedAt: new Date()
    });

    try {
      const [productMap, categoryMap, bankMap] = await Promise.all([
        migrationMap('product'),
        migrationMap('account_category'),
        migrationMap('bank_account')
      ]);
      const itemsBySale = groupBy(data.items, 'SaleId');
      const paymentsByEntry = groupBy(data.payments, 'EntryId');

      const salesOps = data.sales
        .filter((row) => clean(row.Id, 120))
        .map((sale) => {
          const sourceId = clean(sale.Id, 120);
          const saleItems = itemsBySale.get(sourceId) || [];
          const historyItems = saleItems.map((item) => {
            const sourceProductId = clean(item.ProductId, 120);
            return {
              sourceId: clean(item.Id, 120),
              productSourceId: sourceProductId,
              productId: productMap.get(sourceProductId) || '',
              description: clean(item.Description, 300),
              quantity: num(item.Quantity),
              unitPrice: money(item.SalePrice),
              subtotal: money(item.SubTotalWithDiscount || item.SubTotal),
              cost: money(item.ValueCostTotal)
            };
          });

          return {
            updateOne: {
              filter: { sourceSystem: 'sige', sourceId },
              update: {
                $set: {
                  code: clean(sale.Code, 100),
                  customerSourceId: clean(sale.CustomerId, 120),
                  customerName: clean(sale.CustomerName, 220),
                  customerDocument: digits(sale.CustomerCpfCnpj),
                  date: dt(sale.Date) || dt(sale.CreatedAt),
                  status: clean(sale.NegociationStatus, 120),
                  billed: yes(sale.Billed),
                  sellerName: clean(sale.SellerName, 180),
                  subtotal: money(sale.SubTotal),
                  shipping: money(sale.ShippingValue),
                  total: money(sale.Total),
                  paymentCondition: clean(sale.PaymentCondition, 160),
                  invoiceNumber: clean(sale.InvoiceNumber, 80),
                  invoiceSerie: clean(sale.InvoiceSerie, 40),
                  invoiceStatus: clean(sale.InvoiceStatus, 120),
                  items: historyItems,
                  metadata: {
                    internalCode: clean(sale.InternalCode, 100),
                    saleOrigin: clean(sale.SaleOrigin, 120),
                    categoryName: clean(sale.CategoryName, 180),
                    originalCreatedAt: dt(sale.CreatedAt),
                    originalUpdatedAt: dt(sale.LastUpdate)
                  }
                },
                $setOnInsert: { sourceSystem: 'sige', sourceId }
              },
              upsert: true
            }
          };
        });

      const salesBulk = await bulk(SaleHistory, salesOps, 300);
      run.stats = { phase: 'sales_completed', sales: { source: data.sales.length, ...salesBulk } };
      await run.save();

      const entryOps = data.entries
        .filter((row) => clean(row.Id, 120))
        .map((entry) => {
          const sourceId = clean(entry.Id, 120);
          const relatedPayments = paymentsByEntry.get(sourceId) || [];
          const paidValue = money(relatedPayments.reduce((sum, payment) => sum + num(payment.PaidValue || payment.Value), 0));
          const isPaid = yes(entry.Paid);
          const isCancelled = Boolean(clean(entry.TrashTitle));
          const sourceCategoryId = clean(entry.AccountCategoryId, 120);
          const sourceBankId = clean(entry.BankAccountId, 120) || clean(relatedPayments.find((p) => p.BankAccountId)?.BankAccountId, 120);
          const paymentDates = relatedPayments
            .map((payment) => dt(payment.PaymentDate))
            .filter(Boolean)
            .sort((a, b) => b - a);

          return {
            updateOne: {
              filter: { sourceSystem: 'sige', sourceId },
              update: {
                $set: {
                  direction: norm(entry.Type) === 'expense' ? 'payable' : 'receivable',
                  personName: clean(entry.PersonName, 220) || 'Cadastro histórico SIGE',
                  personDocument: digits(entry.PersonCpfCnpj),
                  description: `SIGE ${clean(entry.Code, 80) || sourceId}`,
                  categoryId: categoryMap.get(sourceCategoryId) || '',
                  categoryName: clean(entry.AccountCategoryName, 180),
                  bankAccountId: bankMap.get(sourceBankId) || '',
                  bankAccountName: clean(entry.BankAccountName, 180),
                  paymentMethod: clean(entry.PaymentMethod, 100) || clean(relatedPayments[0]?.PaymentMethod, 100),
                  value: money(entry.Value),
                  advance: Math.max(0, money(entry.EntranceValue)),
                  competenceAt: dt(entry.Date) || dt(entry.CreatedAt) || new Date(),
                  dueAt: dt(entry.MaturityDate) || dt(entry.Date) || new Date(),
                  status: isCancelled ? 'cancelled' : (isPaid ? 'paid' : 'pending'),
                  paidAt: isPaid ? (paymentDates[0] || dt(entry.LastUpdate) || dt(entry.Date)) : null,
                  paidValue: isPaid ? (paidValue || money(entry.Value)) : paidValue,
                  notes: 'Importado do SIGE; saldo bancário atual não é recalculado retroativamente.',
                  origin: 'sige_import',
                  orderId: '',
                  sourceSystem: 'sige',
                  sourceId,
                  migration: {
                    sourcePersonId: clean(entry.PersonId, 120),
                    sourceCategoryId,
                    sourceBankAccountId: sourceBankId,
                    sourceSaleId: clean(entry.SaleID, 120),
                    relationshipType: clean(entry.RelationshipType, 120)
                  }
                },
                $setOnInsert: {
                  createdBy: 'Migração SIGE',
                  createdAt: dt(entry.CreatedAt) || dt(entry.Date) || new Date()
                }
              },
              upsert: true
            }
          };
        });

      const entryBulk = await bulk(Entry.collection, entryOps, 400);
      run.stats = {
        phase: 'financial_completed',
        sales: { source: data.sales.length, ...salesBulk },
        financial: { source: data.entries.length, ...entryBulk }
      };
      await run.save();

      const paymentOps = data.payments
        .filter((row) => clean(row.Id, 120))
        .map((payment) => {
          const sourceId = clean(payment.Id, 120);
          const sourceBankId = clean(payment.BankAccountId, 120);
          return {
            updateOne: {
              filter: { sourceSystem: 'sige', sourceId },
              update: {
                $set: {
                  entrySourceId: clean(payment.EntryId, 120),
                  paymentDate: dt(payment.PaymentDate),
                  paymentMethod: clean(payment.PaymentMethod, 100),
                  bankSourceId: sourceBankId,
                  bankAccountId: bankMap.get(sourceBankId) || '',
                  bankAccountName: clean(payment.BankAccountName, 180),
                  value: money(payment.Value),
                  discounts: money(payment.Discounts),
                  increases: money(payment.Increases),
                  paidValue: money(payment.PaidValue)
                },
                $setOnInsert: { sourceSystem: 'sige', sourceId }
              },
              upsert: true
            }
          };
        });

      const paymentBulk = await bulk(PaymentHistory, paymentOps, 500);
      const sourceSaleIds = new Set(data.sales.map((sale) => clean(sale.Id, 120)).filter(Boolean));
      const missingSales = data.entries.filter((entry) => {
        const sourceSaleId = clean(entry.SaleID, 120);
        return sourceSaleId && !sourceSaleIds.has(sourceSaleId);
      }).length;
      const unmappedItems = data.items.filter((item) => {
        const sourceProductId = clean(item.ProductId, 120);
        return sourceProductId && !productMap.has(sourceProductId);
      }).length;

      const stats = {
        phase: 'completed',
        sales: { source: data.sales.length, ...salesBulk },
        saleItems: data.items.length,
        financial: {
          source: data.entries.length,
          ...entryBulk,
          receivables: data.entries.filter((row) => norm(row.Type) === 'income').length,
          payables: data.entries.filter((row) => norm(row.Type) === 'expense').length
        },
        payments: { source: data.payments.length, ...paymentBulk },
        unmappedSaleItems: unmappedItems,
        financialWithoutSale: missingSales
      };
      const warnings = [];
      if (unmappedItems) warnings.push(`${unmappedItems} item(ns) ficaram com vínculo de produto pendente.`);
      if (missingSales) warnings.push(`${missingSales} lançamento(s) não têm venda de origem no pacote local.`);

      run.status = 'completed';
      run.stats = stats;
      run.warnings = warnings;
      run.finishedAt = new Date();
      await run.save();

      return {
        runId: String(run._id),
        status: 'completed',
        stats,
        warnings,
        safety: {
          stockMoved: false,
          bankBalanceReplayed: false,
          fiscalDocumentsImported: false
        }
      };
    } catch (error) {
      run.status = 'failed';
      run.warnings = [clean(error.message, 1000)];
      run.finishedAt = new Date();
      await run.save().catch(() => {});
      throw error;
    }
  }

  async function status() {
    const latestRun = await Run.findOne({ source: 'sige', scope: 'history-sales-finance' })
      .sort({ createdAt: -1 })
      .lean();
    const [sales, financialEntries, payments] = await Promise.all([
      SaleHistory.countDocuments({ sourceSystem: 'sige' }),
      Entry.collection.countDocuments({ sourceSystem: 'sige' }),
      PaymentHistory.countDocuments({ sourceSystem: 'sige' })
    ]);
    return { latestRun, counts: { sales, financialEntries, payments } };
  }

  return { preview, importHistory, status };
}

export default createErpSigeHistoryImportService;
