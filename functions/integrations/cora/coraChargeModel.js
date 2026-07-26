export function getCoraChargeModel(mongoose) {
  if (!mongoose) throw new Error('mongoose é obrigatório para o modelo CoraCharge.');
  if (mongoose.models.CoraCharge) return mongoose.models.CoraCharge;

  const schema = new mongoose.Schema({
    orderId: { type: String, default: '', index: true },
    source: { type: String, default: 'DIRECT', index: true },
    internalReference: { type: String, default: '', index: true },
    code: { type: String, required: true, index: true },
    environment: { type: String, default: 'stage', index: true },
    kind: { type: String, default: 'INSTALLMENT_BOOK' },
    idempotencyKey: { type: String, required: true, unique: true, index: true },
    status: { type: String, default: 'PROCESSING', index: true },
    totalAmountCents: { type: Number, required: true },
    installments: { type: Number, required: true },
    customer: { type: mongoose.Schema.Types.Mixed, default: {} },
    requestPayload: { type: mongoose.Schema.Types.Mixed, default: {} },
    documentUrl: { type: String, default: '' },
    invoices: { type: [mongoose.Schema.Types.Mixed], default: [] },
    providerResponse: { type: mongoose.Schema.Types.Mixed, default: null },
    providerRequestId: { type: String, default: '', index: true },
    providerTraceId: { type: String, default: '', index: true },
    attempts: { type: Number, default: 0 },
    lastAttemptAt: { type: Date, default: null },
    nextCheckAt: { type: Date, default: null, index: true },
    resolvedAt: { type: Date, default: null },
    webhookEvents: { type: [mongoose.Schema.Types.Mixed], default: [] },
    error: { type: mongoose.Schema.Types.Mixed, default: null },
    createdBy: { type: String, default: '' }
  }, { timestamps: true, minimize: false, collection: 'cora_charges' });

  schema.index({ orderId: 1, kind: 1, status: 1 });
  schema.index({ internalReference: 1, kind: 1, status: 1 });
  return mongoose.model('CoraCharge', schema);
}

export function getCoraAuditModel(mongoose) {
  if (!mongoose) throw new Error('mongoose é obrigatório para o modelo CoraAuditLog.');
  if (mongoose.models.CoraAuditLog) return mongoose.models.CoraAuditLog;

  const schema = new mongoose.Schema({
    chargeId: { type: String, default: '', index: true },
    action: { type: String, required: true, index: true },
    method: { type: String, default: '' },
    url: { type: String, default: '' },
    status: { type: Number, default: null },
    durationMs: { type: Number, default: 0 },
    requestId: { type: String, default: '', index: true },
    traceId: { type: String, default: '', index: true },
    idempotencyKey: { type: String, default: '', index: true },
    requestHeaders: { type: mongoose.Schema.Types.Mixed, default: {} },
    requestBody: { type: mongoose.Schema.Types.Mixed, default: null },
    responseHeaders: { type: mongoose.Schema.Types.Mixed, default: {} },
    responseBody: { type: mongoose.Schema.Types.Mixed, default: null },
    error: { type: mongoose.Schema.Types.Mixed, default: null }
  }, { timestamps: true, minimize: false, collection: 'cora_audit_logs' });

  return mongoose.model('CoraAuditLog', schema);
}
