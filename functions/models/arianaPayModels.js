// Ariana Pay — modelos isolados da Fase 1.
// Este arquivo NÃO é importado pelo server.js nesta fase.
// Portanto, nenhum model abaixo participa de produção até ativação explícita.

const MONEY_MIN = 0;

export function createArianaPayModels(mongoose) {
  if (!mongoose?.Schema) throw new Error('mongoose é obrigatório.');

  const baseOptions = { timestamps: true, versionKey: false };

  const financialLedgerEntrySchema = new mongoose.Schema({
    idempotencyKey: { type: String, required: true, unique: true, index: true },
    sellerId: { type: String, required: true, index: true },
    orderId: { type: String, default: '', index: true },
    paymentId: { type: String, default: '', index: true },
    providerReference: { type: String, default: '', index: true },
    type: {
      type: String,
      required: true,
      enum: [
        'sale_credit',
        'commission_debit',
        'fee_debit',
        'reserve_hold',
        'reserve_release',
        'refund_debit',
        'chargeback_debit',
        'payout_debit',
        'adjustment_credit',
        'adjustment_debit'
      ],
      index: true
    },
    direction: { type: String, required: true, enum: ['credit', 'debit', 'transfer'], index: true },
    amount: { type: Number, required: true, min: MONEY_MIN },
    currency: { type: String, default: 'BRL' },
    status: {
      type: String,
      default: 'shadow',
      enum: ['shadow', 'pending', 'posted', 'reversed', 'void'],
      index: true
    },
    availableAt: { type: Date, default: null, index: true },
    provider: { type: String, default: 'shadow', index: true },
    reversedByEntryId: { type: String, default: '', index: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
  }, baseOptions);

  financialLedgerEntrySchema.index({ sellerId: 1, createdAt: -1 });
  financialLedgerEntrySchema.index({ sellerId: 1, availableAt: 1, status: 1 });
  financialLedgerEntrySchema.index({ orderId: 1, sellerId: 1, type: 1 });

  const sellerBalanceSnapshotSchema = new mongoose.Schema({
    sellerId: { type: String, required: true, unique: true, index: true },
    pending: { type: Number, default: 0 },
    available: { type: Number, default: 0 },
    reserved: { type: Number, default: 0 },
    paid: { type: Number, default: 0 },
    debt: { type: Number, default: 0 },
    totalEquity: { type: Number, default: 0 },
    lastLedgerCreatedAt: { type: Date, default: null },
    lastLedgerEntryId: { type: String, default: '' },
    source: { type: String, default: 'derived_ledger' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
  }, baseOptions);

  const sellerPayoutSchema = new mongoose.Schema({
    payoutId: { type: String, required: true, unique: true, index: true },
    idempotencyKey: { type: String, required: true, unique: true, index: true },
    sellerId: { type: String, required: true, index: true },
    amount: { type: Number, required: true, min: MONEY_MIN },
    currency: { type: String, default: 'BRL' },
    status: {
      type: String,
      default: 'scheduled',
      enum: ['scheduled', 'processing', 'paid', 'failed', 'cancelled'],
      index: true
    },
    provider: { type: String, default: '', index: true },
    providerReference: { type: String, default: '', index: true },
    scheduledAt: { type: Date, default: null, index: true },
    paidAt: { type: Date, default: null },
    failureReason: { type: String, default: '' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
  }, baseOptions);

  sellerPayoutSchema.index({ sellerId: 1, status: 1, scheduledAt: 1 });

  const providerReconciliationSchema = new mongoose.Schema({
    provider: { type: String, required: true, index: true },
    referenceKey: { type: String, required: true, unique: true, index: true },
    referenceDate: { type: Date, required: true, index: true },
    expectedAmount: { type: Number, required: true },
    providerAmount: { type: Number, required: true },
    difference: { type: Number, required: true },
    currency: { type: String, default: 'BRL' },
    status: {
      type: String,
      default: 'pending',
      enum: ['pending', 'matched', 'divergent', 'reviewed'],
      index: true
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
  }, baseOptions);

  providerReconciliationSchema.index({ provider: 1, referenceDate: -1 });

  const FinancialLedgerEntry =
    mongoose.models.FinancialLedgerEntry ||
    mongoose.model('FinancialLedgerEntry', financialLedgerEntrySchema);

  const SellerBalanceSnapshot =
    mongoose.models.SellerBalanceSnapshot ||
    mongoose.model('SellerBalanceSnapshot', sellerBalanceSnapshotSchema);

  const SellerPayout =
    mongoose.models.SellerPayout ||
    mongoose.model('SellerPayout', sellerPayoutSchema);

  const ProviderReconciliation =
    mongoose.models.ProviderReconciliation ||
    mongoose.model('ProviderReconciliation', providerReconciliationSchema);

  return {
    FinancialLedgerEntry,
    SellerBalanceSnapshot,
    SellerPayout,
    ProviderReconciliation
  };
}

export default createArianaPayModels;
