// Adicione estes campos dentro do orderSchema existente. Não crie outro model Order.
origin: { type: String, default: 'marketplace', index: true },
salesChannel: { type: String, default: 'online', index: true },
operatorId: { type: String, default: '', index: true },
operatorName: { type: String, default: '' },
operatorEmail: { type: String, default: '' },
paymentLinkToken: { type: String, default: '', index: true, sparse: true },
paymentLinkExpiresAt: { type: Date, default: null, index: true },
paymentStatus: { type: String, default: 'not_started', index: true },
analysisStatus: { type: String, default: 'not_required', index: true },
customerViewedAt: { type: Date, default: null },
paymentStartedAt: { type: Date, default: null },
approvedAt: { type: Date, default: null },
televendas: { type: mongoose.Schema.Types.Mixed, default: null }
