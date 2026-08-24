// ============================================================
// ROTAS ADMIN SIGE / CREDIÁRIO / BOTS - ARIANA MÓVEIS
// Extraído de legacyRoutes.js sem alterar endpoints, regras ou respostas.
// ============================================================

export default function registerAdminSigeCrediarioBotRoutes(app, context = {}) {
  const {
    ADMIN_EMAIL,
    ADMIN_NAME,
    ADMIN_PASSWORD,
    APP_BASE_URL,
    Address,
    Banner,
    Category,
    Contact,
    CrediarioCliente,
    CrediarioCobrancaLog,
    CrediarioRecibo,
    DEFAULT_CURRENCY,
    DEFAULT_PAYMENTS_SETTINGS,
    DEFAULT_SHIPPING_SETTINGS,
    DEFAULT_WHATSAPP_SETTINGS,
    DISPATCH_RETRY_BASE_MS,
    Denuncia,
    EMAIL_FROM,
    EMAIL_HOST,
    EMAIL_PASS,
    EMAIL_PORT,
    EMAIL_SECURE,
    EMAIL_USER,
    EnterpriseBillingRecord,
    EnterpriseOccurrenceRecord,
    EnterpriseRmaRecord,
    FRONTEND_URL,
    GOOGLE_CLIENT_ID,
    IntegrationAuditLog,
    JWT_SECRET,
    LogisticsLabel,
    MAX_DISPATCH_ATTEMPTS,
    MONGODB_DB,
    MONGODB_URI,
    ManufacturerDispatchQueue,
    ManufacturerIntegration,
    Notification,
    OAuth2Client,
    OperationalAlert,
    Order,
    PORT,
    PaymentEvent,
    Product,
    RESET_PASSWORD_URL,
    RODOCAP_ALLOWED_CITIES,
    SIGE_API_URL,
    SIGE_APP,
    SIGE_PLANO_CONTA,
    SIGE_TIMEOUT_MS,
    SIGE_TOKEN,
    SIGE_USER,
    Seller,
    Setting,
    Ticket,
    User,
    WHATSAPP_EVOLUTION_DEFAULT_API_URL,
    WHATSAPP_EVOLUTION_DEFAULT_INSTANCE,
    WHATSAPP_EVOLUTION_DEFAULT_WEBHOOK_URL,
    WhatsAppWebhook,
    __dirname,
    __filename,
    addUniqueSigeRows,
    addressSchema,
    adminPermissionAllowedForRoute,
    adminRequired,
    allowedOrigins,
    authRequired,
    axios,
    bannerSchema,
    baseOptions,
    bcrypt,
    buildCloudinaryFolder,
    buildCrediarioCobrancaMessage,
    buildCrediarioReceiptMessage,
    buildPublicFileUrl,
    buildSigeImportHash,
    categorySchema,
    changedKeys,
    cleanPhone,
    cloudinary,
    contactSchema,
    cors,
    corsOptions,
    createAdminNotification,
    createSellerNotification,
    createSellerOrderNotifications,
    createSigeRoutes,
    crediarioClienteSchema,
    crediarioCobrancaLogSchema,
    crediarioReciboSchema,
    crypto,
    denunciaSchema,
    dotenv,
    dynamicAllowedOrigins,
    ensureArray,
    enterpriseBillingRecordSchema,
    enterpriseOccurrenceRecordSchema,
    enterpriseRmaRecordSchema,
    envFrontendOrigins,
    escapeRegex,
    express,
    extractSellerIdsFromOrder,
    fileURLToPath,
    filterSigeRows,
    formatCrediarioParcela,
    formatDateBR,
    fs,
    generateProductPosterBuffer,
    getPaymentsSettings,
    getSetting,
    getShippingSettings,
    getSigeLancamentosFiltered,
    getSigeLancamentosRawPages,
    getSigePessoasByQuery,
    getSigeValue,
    getWhatsappSettings,
    googleClient,
    integrationAuditLogSchema,
    isAllowedOrigin,
    isCloudinaryConfigured,
    isSigeConfigured,
    jwt,
    logisticsLabelSchema,
    makeReciboNumber,
    manufacturerDispatchQueueSchema,
    manufacturerIntegrationRoutes,
    manufacturerIntegrationSchema,
    mongoose,
    multer,
    nodemailer,
    normalizeBannerForResponse,
    normalizeBannerPayload,
    normalizeCrediarioCliente,
    normalizeCrediarioRecibo,
    normalizeImageEntry,
    normalizeIncomingImages,
    normalizeObjectId,
    normalizePhone,
    normalizeProductForResponse,
    normalizeSigeLancamento,
    normalizeSigeName,
    normalizeSigePessoa,
    notificationSchema,
    now,
    operationalAlertSchema,
    orderSchema,
    parseBannerInput,
    parsePossiblyJsonArray,
    parseSigeDate,
    parseSigeMoney,
    path,
    paymentEventSchema,
    productPayloadFromBody,
    productSchema,
    redact,
    safeUploadFolder,
    sanitizeIdPart,
    saveShippingSettings,
    saveWhatsappSettings,
    sellerSchema,
    sendCrediarioCobrancaWhatsapp,
    sendCrediarioReceiptWhatsapp,
    setSetting,
    settingsSchema,
    sigeAuthHeaders,
    sigeGet,
    signAdminToken,
    signToken,
    storage,
    ticketSchema,
    tmpUploadsDir,
    toJSON,
    uid,
    uniqueSigeLancamentos,
    upload,
    uploadToCloudinary,
    uploadsDir,
    userSchema,
    whatsappWebhookSchema
  } = context;

  function formatMoneyBRL(value = 0) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: DEFAULT_CURRENCY }).format(Number(value || 0));
  }



  // ============================================================
  // FASE 1 - GESTÃO ÚNICA DO CARNÊ DIGITAL SIGE
  // Um único registro permanente por cliente. O SIGE continua
  // sendo a fonte oficial; o MongoDB guarda o snapshot e auditoria.
  // ============================================================
  const financeiroCarneDigitalSchema = new mongoose.Schema({
    codigo: { type: String, required: true, unique: true, index: true },
    uniqueKey: { type: String, required: true, unique: true, index: true },
    fonte: { type: String, default: 'sige', index: true },
    status: { type: String, default: 'ATIVO', index: true },
    cliente: {
      nome: { type: String, default: '', index: true },
      nomeNormalizado: { type: String, default: '', index: true },
      cpf: { type: String, default: '', index: true },
      telefone: { type: String, default: '', index: true },
      cidade: { type: String, default: '' },
      uf: { type: String, default: '' }
    },
    resumo: { type: mongoose.Schema.Types.Mixed, default: {} },
    grupos: { type: [mongoose.Schema.Types.Mixed], default: [] },
    parcelas: { type: [mongoose.Schema.Types.Mixed], default: [] },
    snapshot: { type: mongoose.Schema.Types.Mixed, default: {} },

    // Vínculo permanente com a emissão Cora correta.
    coraChargeId: { type: String, default: '', index: true },
    coraCode: { type: String, default: '', index: true },
    coraInternalReference: { type: String, default: '', index: true },
    coraDocumentUrl: { type: String, default: '' },
    coraStatus: { type: String, default: '', index: true },
    coraVinculadoEm: { type: Date, default: null, index: true },
    coraVinculadoPor: { type: String, default: '' },

    ultimaSincronizacaoEm: { type: Date, default: null, index: true },
    ultimaSincronizacaoPor: { type: String, default: '' },
    criadoPor: { type: String, default: '' },
    historico: { type: [mongoose.Schema.Types.Mixed], default: [] }
  }, { timestamps: true, versionKey: false, collection: 'financeiro_carnes_digitais' });

  financeiroCarneDigitalSchema.index({
    'cliente.nome': 'text',
    'cliente.cpf': 'text',
    'cliente.telefone': 'text',
    codigo: 'text'
  }, { name: 'financeiro_carne_busca_texto' });


  const financeiroSincronizacaoLogSchema = new mongoose.Schema({
    origem: { type: String, default: 'sige', index: true },
    tipo: { type: String, default: 'MANUAL', index: true },
    status: { type: String, default: 'PROCESSANDO', index: true },
    iniciadoEm: { type: Date, default: Date.now, index: true },
    concluidoEm: { type: Date, default: null },
    solicitadoPor: { type: String, default: '' },
    totalSelecionado: { type: Number, default: 0 },
    processados: { type: Number, default: 0 },
    atualizados: { type: Number, default: 0 },
    ignorados: { type: Number, default: 0 },
    erros: { type: Number, default: 0 },
    resultados: { type: [mongoose.Schema.Types.Mixed], default: [] },
    parametros: { type: mongoose.Schema.Types.Mixed, default: {} }
  }, { timestamps: true, versionKey: false, collection: 'financeiro_sincronizacoes' });

  const FinanceiroSincronizacaoLog =
    mongoose.models.FinanceiroSincronizacaoLog ||
    mongoose.model('FinanceiroSincronizacaoLog', financeiroSincronizacaoLogSchema);


  const financeiroAuditoriaSchema = new mongoose.Schema({
    modulo: { type: String, default: 'financeiro', index: true },
    acao: { type: String, required: true, index: true },
    entidade: { type: String, default: '', index: true },
    entidadeId: { type: String, default: '', index: true },
    codigo: { type: String, default: '', index: true },
    usuario: { type: String, default: '', index: true },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    antes: { type: mongoose.Schema.Types.Mixed, default: null },
    depois: { type: mongoose.Schema.Types.Mixed, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    sucesso: { type: Boolean, default: true, index: true },
    erro: { type: String, default: '' }
  }, { timestamps: true, versionKey: false, collection: 'financeiro_auditoria' });

  const FinanceiroAuditoria =
    mongoose.models.FinanceiroAuditoria ||
    mongoose.model('FinanceiroAuditoria', financeiroAuditoriaSchema);


  const financeiroAutomacaoExecucaoSchema = new mongoose.Schema({
    uniqueKey: { type: String, required: true, unique: true, index: true },
    tipo: { type: String, default: 'DIARIA', index: true },
    dataReferencia: { type: String, required: true, index: true },
    status: {
      type: String,
      default: 'PROCESSANDO',
      enum: ['PROCESSANDO', 'CONCLUIDO', 'CONCLUIDO_COM_ERROS', 'FALHOU', 'IGNORADO'],
      index: true
    },
    iniciadoEm: { type: Date, default: Date.now, index: true },
    concluidoEm: { type: Date, default: null },
    solicitadoPor: { type: String, default: 'automacao_financeira' },
    instancia: { type: String, default: '' },
    etapas: { type: [mongoose.Schema.Types.Mixed], default: [] },
    resumo: { type: mongoose.Schema.Types.Mixed, default: {} },
    erro: { type: String, default: '' }
  }, {
    timestamps: true,
    versionKey: false,
    collection: 'financeiro_automacoes_execucoes'
  });

  const FinanceiroAutomacaoExecucao =
    mongoose.models.FinanceiroAutomacaoExecucao ||
    mongoose.model('FinanceiroAutomacaoExecucao', financeiroAutomacaoExecucaoSchema);


  const financeiroReguaWhatsappLogSchema = new mongoose.Schema({
    uniqueKey: { type: String, required: true, unique: true, index: true },
    origem: { type: String, default: 'financeiro_regua', index: true },
    tipoEvento: { type: String, required: true, index: true },
    dataReferencia: { type: String, required: true, index: true },
    filaItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'FinanceiroFilaCobranca', default: null, index: true },
    promessaId: { type: mongoose.Schema.Types.ObjectId, ref: 'FinanceiroPromessaPagamento', default: null, index: true },
    carneId: { type: mongoose.Schema.Types.ObjectId, ref: 'FinanceiroCarneDigital', default: null, index: true },
    carneCodigo: { type: String, default: '', index: true },
    clienteNome: { type: String, default: '', index: true },
    telefone: { type: String, default: '', index: true },
    parcelaLabel: { type: String, default: '' },
    documento: { type: String, default: '' },
    diasAtraso: { type: Number, default: 0 },
    valor: { type: Number, default: 0 },
    mensagem: { type: String, default: '' },
    dryRun: { type: Boolean, default: false, index: true },
    enviado: { type: Boolean, default: false, index: true },
    enviadoEm: { type: Date, default: null },
    messageId: { type: String, default: '', index: true },
    remoteJid: { type: String, default: '', index: true },
    deliveryStatus: {
      type: String,
      default: 'PENDING',
      enum: ['PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'UNKNOWN'],
      index: true
    },
    deliveryStatusUpdatedAt: { type: Date, default: null, index: true },
    sentAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    retryCount: { type: Number, default: 0 },
    lastRetryAt: { type: Date, default: null },
    ackHistory: { type: [mongoose.Schema.Types.Mixed], default: [] },
    erro: { type: String, default: '' },
    whatsappResultado: { type: mongoose.Schema.Types.Mixed, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
  }, {
    timestamps: true,
    versionKey: false,
    collection: 'financeiro_regua_whatsapp_logs'
  });

  financeiroReguaWhatsappLogSchema.index({
    clienteNome: 'text',
    telefone: 'text',
    carneCodigo: 'text',
    documento: 'text'
  }, { name: 'financeiro_regua_whatsapp_busca_texto' });

  const FinanceiroReguaWhatsappLog =
    mongoose.models.FinanceiroReguaWhatsappLog ||
    mongoose.model('FinanceiroReguaWhatsappLog', financeiroReguaWhatsappLogSchema);


  const financeiroRenegociacaoSchema = new mongoose.Schema({
    carneId: { type: mongoose.Schema.Types.ObjectId, ref: 'FinanceiroCarneDigital', required: true, index: true },
    carneCodigo: { type: String, required: true, index: true },
    clienteNome: { type: String, default: '', index: true },
    status: { type: String, default: 'PROPOSTA', index: true },
    saldoOriginal: { type: Number, default: 0 },
    multaOriginal: { type: Number, default: 0 },
    jurosOriginal: { type: Number, default: 0 },
    valorBase: { type: Number, default: 0 },
    entrada: { type: Number, default: 0 },
    saldoRenegociado: { type: Number, default: 0 },
    quantidadeParcelas: { type: Number, default: 1 },
    valorParcela: { type: Number, default: 0 },
    primeiroVencimento: { type: Date, default: null },
    vencimentos: { type: [Date], default: [] },
    observacao: { type: String, default: '' },
    criadoPor: { type: String, default: '' },
    aprovadoPor: { type: String, default: '' },
    aprovadoEm: { type: Date, default: null },
    snapshotOriginal: { type: mongoose.Schema.Types.Mixed, default: {} }
  }, { timestamps: true, versionKey: false, collection: 'financeiro_renegociacoes' });

  const FinanceiroRenegociacao =
    mongoose.models.FinanceiroRenegociacao ||
    mongoose.model('FinanceiroRenegociacao', financeiroRenegociacaoSchema);


  const financeiroFilaCobrancaSchema = new mongoose.Schema({
    uniqueKey: { type: String, required: true, unique: true, index: true },
    dataReferencia: { type: String, required: true, index: true },
    carneId: { type: mongoose.Schema.Types.ObjectId, ref: 'FinanceiroCarneDigital', required: true, index: true },
    carneCodigo: { type: String, required: true, index: true },
    clienteNome: { type: String, default: '', index: true },
    clienteCpf: { type: String, default: '', index: true },
    telefone: { type: String, default: '', index: true },
    documento: { type: String, default: '' },
    parcelaCodigo: { type: String, default: '' },
    parcelaLabel: { type: String, default: '' },
    vencimento: { type: Date, default: null, index: true },
    diasAtraso: { type: Number, default: 0, index: true },
    faixa: { type: String, default: 'SEM_FAIXA', index: true },
    prioridade: { type: String, default: 'BAIXA', index: true },
    prioridadeScore: { type: Number, default: 0, index: true },
    valorOriginal: { type: Number, default: 0 },
    multa: { type: Number, default: 0 },
    juros: { type: Number, default: 0 },
    valorAtualizado: { type: Number, default: 0 },
    primeiraParcelaAtrasada: { type: Boolean, default: false, index: true },
    totalParcelasAtrasadasCliente: { type: Number, default: 0 },
    semContato: { type: Boolean, default: false, index: true },
    status: { type: String, default: 'PENDENTE', index: true },
    responsavel: { type: String, default: '' },
    ultimaAcao: { type: String, default: '' },
    ultimaAcaoEm: { type: Date, default: null },
    proximaAcaoEm: { type: Date, default: null, index: true },
    observacao: { type: String, default: '' },
    snapshot: { type: mongoose.Schema.Types.Mixed, default: {} }
  }, { timestamps: true, versionKey: false, collection: 'financeiro_fila_cobranca' });

  financeiroFilaCobrancaSchema.index({
    clienteNome: 'text',
    clienteCpf: 'text',
    telefone: 'text',
    carneCodigo: 'text',
    documento: 'text'
  }, { name: 'financeiro_fila_busca_texto' });

  const FinanceiroFilaCobranca =
    mongoose.models.FinanceiroFilaCobranca ||
    mongoose.model('FinanceiroFilaCobranca', financeiroFilaCobrancaSchema);


  const financeiroPromessaPagamentoSchema = new mongoose.Schema({
    filaItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'FinanceiroFilaCobranca', default: null, index: true },
    carneId: { type: mongoose.Schema.Types.ObjectId, ref: 'FinanceiroCarneDigital', required: true, index: true },
    carneCodigo: { type: String, required: true, index: true },
    clienteNome: { type: String, default: '', index: true },
    clienteCpf: { type: String, default: '', index: true },
    telefone: { type: String, default: '', index: true },
    documento: { type: String, default: '' },
    parcelaCodigo: { type: String, default: '' },
    parcelaLabel: { type: String, default: '' },
    valorPrometido: { type: Number, required: true },
    dataPrometida: { type: Date, required: true, index: true },
    formaPagamento: { type: String, default: 'PIX' },
    status: {
      type: String,
      default: 'PENDENTE',
      enum: ['PENDENTE', 'CUMPRIDA', 'QUEBRADA', 'CANCELADA'],
      index: true
    },
    origem: { type: String, default: 'fila_cobranca' },
    responsavel: { type: String, default: '' },
    observacao: { type: String, default: '' },
    lembreteEnviado: { type: Boolean, default: false },
    lembreteEnviadoEm: { type: Date, default: null },
    alertaInternoEnviado: { type: Boolean, default: false, index: true },
    alertaInternoEnviadoEm: { type: Date, default: null },
    alertaInternoTentadoEm: { type: Date, default: null },
    alertaInternoErro: { type: String, default: '' },
    cumpridaEm: { type: Date, default: null },
    quebradaEm: { type: Date, default: null },
    canceladaEm: { type: Date, default: null },
    pagamentoReferencia: { type: String, default: '' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
  }, { timestamps: true, versionKey: false, collection: 'financeiro_promessas_pagamento' });

  financeiroPromessaPagamentoSchema.index({
    clienteNome: 'text',
    clienteCpf: 'text',
    telefone: 'text',
    carneCodigo: 'text',
    documento: 'text'
  }, { name: 'financeiro_promessa_busca_texto' });

  const FinanceiroPromessaPagamento =
    mongoose.models.FinanceiroPromessaPagamento ||
    mongoose.model('FinanceiroPromessaPagamento', financeiroPromessaPagamentoSchema);


  const financeiroTratativaSchema = new mongoose.Schema({
    filaItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'FinanceiroFilaCobranca', default: null, index: true },
    promessaId: { type: mongoose.Schema.Types.ObjectId, ref: 'FinanceiroPromessaPagamento', default: null, index: true },
    carneId: { type: mongoose.Schema.Types.ObjectId, ref: 'FinanceiroCarneDigital', required: true, index: true },
    carneCodigo: { type: String, required: true, index: true },
    clienteNome: { type: String, default: '', index: true },
    clienteCpf: { type: String, default: '', index: true },
    telefone: { type: String, default: '', index: true },
    documento: { type: String, default: '' },
    parcelaLabel: { type: String, default: '' },
    motivo: { type: String, required: true, index: true },
    motivoDetalhe: { type: String, default: '' },
    canal: { type: String, default: 'WHATSAPP', index: true },
    resultado: { type: String, default: 'SEM_RETORNO', index: true },
    proximaAcao: { type: String, default: 'ACOMPANHAR', index: true },
    proximaAcaoEm: { type: Date, default: null, index: true },
    responsavel: { type: String, default: '', index: true },
    observacao: { type: String, default: '' },
    concluida: { type: Boolean, default: false, index: true },
    concluidaEm: { type: Date, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
  }, { timestamps: true, versionKey: false, collection: 'financeiro_tratativas' });

  financeiroTratativaSchema.index({
    clienteNome: 'text',
    clienteCpf: 'text',
    telefone: 'text',
    carneCodigo: 'text',
    documento: 'text',
    motivoDetalhe: 'text',
    observacao: 'text'
  }, { name: 'financeiro_tratativa_busca_texto' });

  const FinanceiroTratativa =
    mongoose.models.FinanceiroTratativa ||
    mongoose.model('FinanceiroTratativa', financeiroTratativaSchema);


  const financeiroRiscoClienteSchema = new mongoose.Schema({
    customerKey: { type: String, required: true, unique: true, index: true },
    clienteNome: { type: String, default: '', index: true },
    clienteCpf: { type: String, default: '', index: true },
    telefone: { type: String, default: '', index: true },
    scoreRisco: { type: Number, default: 0, index: true },
    nivelRisco: {
      type: String,
      default: 'BAIXO',
      enum: ['BAIXO', 'MEDIO', 'ALTO', 'CRITICO'],
      index: true
    },
    decisaoAutomatica: {
      type: String,
      default: 'APROVAR',
      enum: ['APROVAR', 'REVISAR', 'BLOQUEAR'],
      index: true
    },
    statusManual: {
      type: String,
      default: 'AUTOMATICO',
      enum: ['AUTOMATICO', 'ATIVO', 'EM_REVISAO', 'BLOQUEADO'],
      index: true
    },
    limiteSugerido: { type: Number, default: 0 },
    exposicaoAtual: { type: Number, default: 0 },
    valorVencido: { type: Number, default: 0 },
    maxDiasAtraso: { type: Number, default: 0 },
    parcelasAtrasadas: { type: Number, default: 0 },
    primeiraParcelaAtrasada: { type: Boolean, default: false, index: true },
    promessasQuebradas: { type: Number, default: 0 },
    promessasCumpridas: { type: Number, default: 0 },
    tratativasSemRetorno: { type: Number, default: 0 },
    renegociacoesSolicitadas: { type: Number, default: 0 },
    contratosAtivos: { type: Number, default: 0 },
    contratosQuitados: { type: Number, default: 0 },
    motivos: { type: [String], default: [] },
    fatores: { type: [mongoose.Schema.Types.Mixed], default: [] },
    ultimaAvaliacaoEm: { type: Date, default: Date.now, index: true },
    ultimaDecisaoManualEm: { type: Date, default: null },
    ultimaDecisaoManualPor: { type: String, default: '' },
    observacaoManual: { type: String, default: '' },
    snapshot: { type: mongoose.Schema.Types.Mixed, default: {} }
  }, { timestamps: true, versionKey: false, collection: 'financeiro_risco_clientes' });

  financeiroRiscoClienteSchema.index({
    clienteNome: 'text',
    clienteCpf: 'text',
    telefone: 'text'
  }, { name: 'financeiro_risco_busca_texto' });

  const FinanceiroRiscoCliente =
    mongoose.models.FinanceiroRiscoCliente ||
    mongoose.model('FinanceiroRiscoCliente', financeiroRiscoClienteSchema);

  const FinanceiroCarneDigital =
    mongoose.models.FinanceiroCarneDigital ||
    mongoose.model('FinanceiroCarneDigital', financeiroCarneDigitalSchema);

  function normalizeCarneIdentity(value = '') {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  // Compatibilidade interna: algumas rotinas financeiras usam normalizeSearch.
  // Mantém a mesma normalização adotada para clientes e carnês.
  function normalizeSearch(value = '') {
    return normalizeCarneIdentity(value);
  }

  function buildCarneUniqueKey(carne = {}) {
    const cpf = cleanPhone(carne.cpf || '');
    if (cpf) return `sige:cpf:${cpf}`;
    const nome = normalizeCarneIdentity(carne.cliente || '');
    const telefone = cleanPhone(carne.telefone || '');
    if (telefone) return `sige:telefone:${telefone}`;
    return `sige:nome:${nome}`;
  }

  function createCarneCode() {
    const d = new Date();
    const stamp = [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0')
    ].join('');
    const random = crypto.randomBytes(3).toString('hex').toUpperCase();
    return `CARNE-${stamp}-${random}`;
  }


  function getFinanceiroActor(req = {}) {
    return String(
      req.admin?.email ||
      req.auth?.email ||
      req.user?.email ||
      req.admin?.id ||
      req.auth?.id ||
      'admin'
    );
  }

  function getFinanceiroIp(req = {}) {
    return String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || '')
      .split(',')[0]
      .trim();
  }

  async function registrarAuditoriaFinanceira({
    req = {},
    acao,
    entidade = '',
    entidadeId = '',
    codigo = '',
    antes = null,
    depois = null,
    metadata = {},
    sucesso = true,
    erro = ''
  } = {}) {
    try {
      return await FinanceiroAuditoria.create({
        modulo: 'financeiro',
        acao: String(acao || 'ACAO_NAO_INFORMADA'),
        entidade: String(entidade || ''),
        entidadeId: String(entidadeId || ''),
        codigo: String(codigo || ''),
        usuario: getFinanceiroActor(req),
        ip: getFinanceiroIp(req),
        userAgent: String(req.headers?.['user-agent'] || ''),
        antes,
        depois,
        metadata,
        sucesso: sucesso !== false,
        erro: String(erro || '')
      });
    } catch (auditError) {
      console.warn('[financeiro auditoria]', auditError.message || auditError);
      return null;
    }
  }

  function financeiroPermissionRequired(permission = 'financeiro.visualizar') {
    return (req, res, next) => {
      try {
        const auth = req.admin || req.auth || req.user || {};
        const role = String(auth.role || auth.tipo || auth.type || '').toLowerCase();
        const explicitPermissions = Array.isArray(auth.permissions)
          ? auth.permissions
          : (Array.isArray(auth.permissoes) ? auth.permissoes : null);

        // Tokens administrativos antigos continuam compatíveis.
        if (!explicitPermissions || !explicitPermissions.length) return next();
        if (['admin', 'superadmin', 'owner'].includes(role)) return next();
        if (explicitPermissions.includes('*') || explicitPermissions.includes(permission)) return next();

        return res.status(403).json({
          ok: false,
          error: 'Usuário sem permissão para esta operação financeira.',
          permission
        });
      } catch (error) {
        return res.status(403).json({ ok: false, error: 'Não foi possível validar a permissão financeira.' });
      }
    };
  }

  function getFinanceiroCalculationConfig() {
    const finePercent = Number(process.env.FINANCEIRO_FINE_PERCENT ?? 2);
    const interestMonthlyPercent = Number(process.env.FINANCEIRO_INTEREST_MONTHLY_PERCENT ?? 1);
    return {
      finePercent: Number.isFinite(finePercent) && finePercent >= 0 ? finePercent : 2,
      interestMonthlyPercent: Number.isFinite(interestMonthlyPercent) && interestMonthlyPercent >= 0
        ? interestMonthlyPercent
        : 1,
      formula: 'juros simples proporcionais aos dias: saldo × taxa mensal × dias ÷ 30',
      fonteSaldoOriginal: 'SIGE',
      calculadoNoBackend: true
    };
  }

  function calcularParcelaAtualizadaBackend(parcela = {}, referenceDate = new Date()) {
    const config = getFinanceiroCalculationConfig();
    const quitado = parcela.quitado === true || parcela.status === 'paga';
    const vencimento = parcela.dataVencimento ? new Date(parcela.dataVencimento) : null;
    const saldoOriginal = Math.max(0, Number(
      parcela.saldoParcela ??
      parcela.saldo ??
      parcela.valorParcela ??
      parcela.valor ??
      0
    ));

    const referencia = new Date(referenceDate);
    referencia.setHours(0, 0, 0, 0);
    if (vencimento && !Number.isNaN(vencimento.getTime())) vencimento.setHours(0, 0, 0, 0);

    const vencida = !quitado && vencimento && !Number.isNaN(vencimento.getTime()) && vencimento < referencia;
    const diasAtraso = vencida
      ? Math.max(0, Math.floor((referencia.getTime() - vencimento.getTime()) / 86400000))
      : 0;
    const multa = vencida ? saldoOriginal * (config.finePercent / 100) : 0;
    const juros = vencida
      ? saldoOriginal * (config.interestMonthlyPercent / 100) * (diasAtraso / 30)
      : 0;
    const valorAtualizado = quitado ? 0 : saldoOriginal + multa + juros;

    return {
      saldoOriginal: Number(saldoOriginal.toFixed(2)),
      diasAtraso,
      multa: Number(multa.toFixed(2)),
      juros: Number(juros.toFixed(2)),
      valorAtualizado: Number(valorAtualizado.toFixed(2)),
      calculadoEm: referencia.toISOString(),
      regraCalculo: {
        finePercent: config.finePercent,
        interestMonthlyPercent: config.interestMonthlyPercent,
        formula: config.formula
      }
    };
  }


  function buildMonthlyDueDates(firstDueDate, count) {
    const first = new Date(`${String(firstDueDate || '').slice(0, 10)}T12:00:00`);
    if (Number.isNaN(first.getTime())) return [];
    const day = first.getDate();
    return Array.from({ length: Math.max(1, Number(count || 1)) }, (_, index) => {
      const d = new Date(first.getFullYear(), first.getMonth() + index, 1, 12, 0, 0, 0);
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(day, lastDay));
      return d;
    });
  }

  function normalizeWhatsappText(value = '') {
    return String(value || '')
      .replace(/CarnÃª/gi, 'Carnê')
      .replace(/MÃ³veis/gi, 'Móveis')
      .replace(/OlÃ¡/gi, 'Olá')
      .replace(/CÃ³digo/gi, 'Código')
      .replace(/dÃºvidas/gi, 'dúvidas')
      .replace(/regularizaÃ§Ã£o/gi, 'regularização')
      .replace(/lanÃ§ado/gi, 'lançado')
      .replace(/ConfirmaÃ§Ã£o/gi, 'Confirmação')
      .replace(/ReferÃªncia/gi, 'Referência')
      .replace(/nÃ£o/gi, 'não')
      .replace(/jÃ¡/gi, 'já')
      .replace(/Parcelas/gi, 'Parcelas')
      .replace(/â€¢/g, '-')
      .replace(/â€”|â€“/g, '-')
      .replace(/ðŸ[^ \n]*/g, '')
      .replace(/âœ…|âš ï¸|â³/g, '')
      .replace(/\uFFFD/g, '')
      .trim();
  }

  function normalizeDocumentoComparacao(value = '') {
    return normalizeWhatsappText(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function findCarneGroupByDocumento(grupos = [], documento = '') {
    const wanted = normalizeDocumentoComparacao(documento);
    if (!wanted) return null;

    return (Array.isArray(grupos) ? grupos : []).find((grupo) => {
      const candidates = [
        grupo?.documento,
        grupo?.descricao,
        grupo?.codigo,
        grupo?.numeroDocumento,
        grupo?.pedido
      ];

      return candidates.some((candidate) => {
        const normalized = normalizeDocumentoComparacao(candidate);
        return normalized && (
          normalized === wanted ||
          normalized.includes(wanted) ||
          wanted.includes(normalized)
        );
      });
    }) || null;
  }

  function buildSavedCarneWhatsappMessage(row = {}, options = {}) {
    const carne = normalizeCarneDigital(row);
    const grupos = Array.isArray(carne.grupos) ? carne.grupos : [];
    const documentoSelecionado = String(options.documento || '').trim();
    const grupoSelecionado = documentoSelecionado
      ? findCarneGroupByDocumento(grupos, documentoSelecionado)
      : null;

    if (documentoSelecionado && !grupoSelecionado) {
      const error = new Error('A compra selecionada não foi encontrada neste carnê.');
      error.statusCode = 404;
      throw error;
    }

    const gruposParaMensagem = grupoSelecionado ? [grupoSelecionado] : grupos;
    const nomeCompleto = normalizeWhatsappText(carne.cliente?.nome || 'Cliente');
    const primeiroNome = nomeCompleto.split(/\s+/)[0] || 'Cliente';

    const lines = [
      '*ARIANA MÓVEIS - RESUMO DO CARNÊ*',
      '',
      `Olá, ${primeiroNome}.`,
      ''
    ];

    for (const grupo of gruposParaMensagem) {
      const parcelas = Array.isArray(grupo.parcelas) ? grupo.parcelas : [];

      const processadas = parcelas.map((parcela) => {
        const calc = parcela.atualizacaoFinanceira ||
          calcularParcelaAtualizadaBackend(parcela);

        const statusOriginal = String(parcela.status || '').toLowerCase();
        const paga =
          parcela.quitado === true ||
          ['paga', 'pago', 'quitada', 'quitado', 'paid'].includes(statusOriginal);

        const diasAtraso = Number(calc?.diasAtraso || 0);
        const atrasada = !paga && diasAtraso > 0;
        const valorAtualizado = Number(
          calc?.valorAtualizado ??
          parcela.saldoParcela ??
          parcela.valorParcela ??
          parcela.valor ??
          0
        );

        return {
          parcela,
          paga,
          atrasada,
          diasAtraso,
          valorAtualizado
        };
      });

      const pagas = processadas.filter((item) => item.paga);
      const atrasadas = processadas.filter((item) => item.atrasada);
      const abertas = processadas.filter((item) => !item.paga && !item.atrasada);

      lines.push(`Compra: ${normalizeWhatsappText(grupo.descricao || grupo.documento || 'Compra')}`);
      if (grupo.documento) {
        lines.push(`Pedido: ${normalizeWhatsappText(grupo.documento)}`);
      }
      lines.push('');
      lines.push(`Valor da compra: ${formatMoneyBRL(grupo.total || 0)}`);
      lines.push(`Valor já pago: ${formatMoneyBRL(grupo.pago || 0)}`);
      lines.push(`Saldo atual: *${formatMoneyBRL(grupo.saldo || 0)}*`);
      lines.push(`Parcelas pagas: ${pagas.length} de ${processadas.length}`);
      lines.push('');

      if (atrasadas.length) {
        lines.push('*PARCELAS ATRASADAS*');
        for (const item of atrasadas) {
          const parcela = item.parcela;
          const vencimento = parcela.dataVencimento
            ? formatDateBR(parcela.dataVencimento)
            : 'sem vencimento';
          lines.push(
            `${normalizeWhatsappText(parcela.parcelaLabel || 'Parcela')} | venceu em ${vencimento} | ${formatMoneyBRL(item.valorAtualizado)}`
          );
        }
        lines.push('');
      }

      if (abertas.length) {
        lines.push('*PRÓXIMAS PARCELAS*');
        for (const item of abertas) {
          const parcela = item.parcela;
          const vencimento = parcela.dataVencimento
            ? formatDateBR(parcela.dataVencimento)
            : 'sem vencimento';
          lines.push(
            `${normalizeWhatsappText(parcela.parcelaLabel || 'Parcela')} | vence em ${vencimento} | ${formatMoneyBRL(item.valorAtualizado)}`
          );
        }
        lines.push('');
      }

      if (!atrasadas.length && !abertas.length) {
        lines.push('*Todas as parcelas desta compra estão pagas.*');
        lines.push('');
      }
    }

    lines.push('Em caso de dúvida, responda esta mensagem.');
    lines.push('Financeiro Ariana Móveis');

    return lines
      .filter((line) => line !== null && line !== undefined && String(line).trim() !== '')
      .join('\n')
      .trim();
  }


  function parseFinanceiroDate(value = new Date()) {
    if (value instanceof Date) {
      const copy = new Date(value.getTime());
      return Number.isNaN(copy.getTime()) ? null : copy;
    }

    const raw = String(value ?? '').trim();
    const dateOnlyMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnlyMatch) {
      const [, year, month, day] = dateOnlyMatch;
      const localDate = new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0);
      return Number.isNaN(localDate.getTime()) ? null : localDate;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function dayOnly(value = new Date()) {
    const d = parseFinanceiroDate(value);
    if (!d) return null;
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function dateKey(value = new Date()) {
    const d = dayOnly(value);
    if (!d) return '';
    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0')
    ].join('-');
  }

  function normalizarIdentificacaoParcelas(parcelas = []) {
    const rows = Array.isArray(parcelas) ? parcelas.map((p) => ({ ...p })) : [];
    const grupos = new Map();

    for (const parcela of rows) {
      const chave = String(
        parcela.chave ||
        parcela.documento ||
        parcela.codigoVenda ||
        parcela.codigoContrato ||
        'Sem documento'
      );
      if (!grupos.has(chave)) grupos.set(chave, []);
      grupos.get(chave).push(parcela);
    }

    const resultado = [];
    for (const itens of grupos.values()) {
      itens.sort((a, b) => {
        const da = parseFinanceiroDate(a.dataVencimento)?.getTime() || 0;
        const db = parseFinanceiroDate(b.dataVencimento)?.getTime() || 0;
        return da - db;
      });

      const total = itens.length || 1;
      itens.forEach((parcela, index) => {
        const numeroAtual = Number(parcela.parcelaNumero || 0);
        const numero = numeroAtual > 0 ? numeroAtual : index + 1;
        resultado.push({
          ...parcela,
          parcelaNumero: numero,
          parcelaLabel: String(parcela.parcelaLabel || '').trim() ||
            `${String(numero).padStart(2, '0')}/${String(total).padStart(2, '0')}`
        });
      });
    }

    return resultado;
  }

  function getCobrancaFaixa(diasAtraso = 0, diasParaVencer = null) {
    const atraso = Number(diasAtraso || 0);
    if (diasParaVencer === 1) return 'VENCE_AMANHA';
    if (diasParaVencer === 0) return 'VENCE_HOJE';
    if (atraso >= 61) return 'MAIS_60';
    if (atraso >= 31) return '31_60';
    if (atraso >= 16) return '16_30';
    if (atraso >= 8) return '8_15';
    if (atraso >= 4) return '4_7';
    if (atraso >= 1) return '1_3';
    return 'SEM_FAIXA';
  }

  function getCobrancaPrioridade({
    diasAtraso = 0,
    valorAtualizado = 0,
    primeiraParcelaAtrasada = false,
    totalParcelasAtrasadasCliente = 0,
    semContato = false,
    diasParaVencer = null
  } = {}) {
    let score = 0;
    const atraso = Number(diasAtraso || 0);
    const valor = Number(valorAtualizado || 0);

    if (diasParaVencer === 1) score += 12;
    if (diasParaVencer === 0) score += 18;
    if (atraso >= 1) score += 20;
    if (atraso >= 4) score += 12;
    if (atraso >= 8) score += 15;
    if (atraso >= 16) score += 18;
    if (atraso >= 31) score += 20;
    if (atraso >= 61) score += 25;
    if (primeiraParcelaAtrasada) score += 25;
    if (Number(totalParcelasAtrasadasCliente || 0) >= 2) score += 15;
    if (Number(totalParcelasAtrasadasCliente || 0) >= 3) score += 10;
    if (valor >= 500) score += 8;
    if (valor >= 1000) score += 10;
    if (valor >= 2500) score += 12;
    if (semContato) score += 20;

    const prioridade = score >= 70 ? 'CRITICA' : (score >= 45 ? 'ALTA' : (score >= 25 ? 'MEDIA' : 'BAIXA'));
    return { prioridade, score };
  }

  function normalizeFilaCobranca(doc = {}) {
    const row = typeof doc?.toObject === 'function' ? doc.toObject() : doc;
    return {
      id: String(row._id || row.id || ''),
      uniqueKey: row.uniqueKey || '',
      dataReferencia: row.dataReferencia || '',
      carneId: String(row.carneId || ''),
      carneCodigo: row.carneCodigo || '',
      clienteNome: row.clienteNome || '',
      clienteCpf: row.clienteCpf || '',
      telefone: row.telefone || '',
      documento: row.documento || '',
      parcelaCodigo: row.parcelaCodigo || '',
      parcelaLabel: row.parcelaLabel || '',
      vencimento: row.vencimento || null,
      diasAtraso: Number(row.diasAtraso || 0),
      faixa: row.faixa || 'SEM_FAIXA',
      prioridade: row.prioridade || 'BAIXA',
      prioridadeScore: Number(row.prioridadeScore || 0),
      valorOriginal: Number(row.valorOriginal || 0),
      multa: Number(row.multa || 0),
      juros: Number(row.juros || 0),
      valorAtualizado: Number(row.valorAtualizado || 0),
      primeiraParcelaAtrasada: row.primeiraParcelaAtrasada === true,
      totalParcelasAtrasadasCliente: Number(row.totalParcelasAtrasadasCliente || 0),
      semContato: row.semContato === true,
      status: row.status || 'PENDENTE',
      responsavel: row.responsavel || '',
      ultimaAcao: row.ultimaAcao || '',
      ultimaAcaoEm: row.ultimaAcaoEm || null,
      proximaAcaoEm: row.proximaAcaoEm || null,
      observacao: row.observacao || '',
      createdAt: row.createdAt || null,
      updatedAt: row.updatedAt || null
    };
  }

  function buildFilaItemFromParcela(carne = {}, parcela = {}, referencia = new Date(), atrasadasCliente = 0) {
    const ref = dayOnly(referencia);
    const vencimento = dayOnly(parcela.dataVencimento);
    if (!ref || !vencimento) return null;

    const diff = Math.floor((ref.getTime() - vencimento.getTime()) / 86400000);
    const diasAtraso = Math.max(0, diff);
    const diasParaVencer = Math.floor((vencimento.getTime() - ref.getTime()) / 86400000);

    const quitada = parcela.status === 'paga' || parcela.quitado === true;
    const entraNaFila = !quitada && (diasAtraso > 0 || diasParaVencer === 0 || diasParaVencer === 1);
    if (!entraNaFila) return null;

    const numeroParcela = Number(parcela.parcelaNumero || 0);
    const primeiraParcelaAtrasada = diasAtraso > 0 && numeroParcela === 1;
    const atualizado = parcela.atualizacaoFinanceira || calcularParcelaAtualizadaBackend(parcela, ref);
    const telefone = normalizePhone(carne.cliente?.telefone || '', '55');
    const semContato = !telefone;
    const prioridadeInfo = getCobrancaPrioridade({
      diasAtraso,
      diasParaVencer,
      valorAtualizado: atualizado.valorAtualizado || 0,
      primeiraParcelaAtrasada,
      totalParcelasAtrasadasCliente: atrasadasCliente,
      semContato
    });

    const parcelaCodigo = String(
      parcela.codigo ||
      parcela.id ||
      parcela.codigoLancamento ||
      parcela.documento ||
      `${parcela.chave || 'parcela'}-${parcela.parcelaLabel || numeroParcela || '0'}`
    ).trim();

    return {
      dataReferencia: dateKey(ref),
      carneId: carne._id,
      carneCodigo: carne.codigo,
      clienteNome: carne.cliente?.nome || '',
      clienteCpf: cleanPhone(carne.cliente?.cpf || ''),
      telefone,
      documento: parcela.chave || parcela.documento || parcela.descricao || '',
      parcelaCodigo,
      parcelaLabel: parcela.parcelaLabel || '',
      vencimento,
      diasAtraso,
      faixa: getCobrancaFaixa(diasAtraso, diasParaVencer),
      prioridade: prioridadeInfo.prioridade,
      prioridadeScore: prioridadeInfo.score,
      valorOriginal: Number(parcela.saldoParcela || parcela.valorParcela || parcela.valor || 0),
      multa: Number(atualizado.multa || 0),
      juros: Number(atualizado.juros || 0),
      valorAtualizado: Number(atualizado.valorAtualizado || 0),
      primeiraParcelaAtrasada,
      totalParcelasAtrasadasCliente: atrasadasCliente,
      semContato,
      snapshot: {
        cliente: carne.cliente || {},
        parcela,
        resumoCarne: carne.resumo || {}
      }
    };
  }

  async function upsertCarneNaFilaCobranca(carne, referencia = new Date(), { somenteVencidas = false } = {}) {
    const ref = dayOnly(referencia);
    if (!ref || !carne?._id) {
      const error = new Error('Carnê ou data de referência inválidos.');
      error.statusCode = 400;
      throw error;
    }

    const parcelas = Array.isArray(carne.parcelas) ? carne.parcelas : [];
    const atrasadasCliente = parcelas.filter((parcela) => {
      const vencimento = dayOnly(parcela.dataVencimento);
      return parcela.status !== 'paga' && parcela.quitado !== true && vencimento && vencimento < ref;
    }).length;

    let criados = 0;
    let atualizados = 0;
    let preservados = 0;
    let totalItens = 0;

    for (const parcela of parcelas) {
      const item = buildFilaItemFromParcela(carne, parcela, ref, atrasadasCliente);
      if (!item) continue;
      if (somenteVencidas && Number(item.diasAtraso || 0) <= 0) continue;
      totalItens += 1;

      const keyBase = [
        item.dataReferencia,
        String(item.carneId),
        item.parcelaCodigo,
        item.vencimento ? new Date(item.vencimento).toISOString().slice(0, 10) : ''
      ].join('|');
      const uniqueKey = crypto.createHash('sha1').update(keyBase).digest('hex');
      const existing = await FinanceiroFilaCobranca.findOne({ uniqueKey });

      if (!existing) {
        await FinanceiroFilaCobranca.create({
          ...item,
          uniqueKey,
          status: 'PENDENTE',
          responsavel: '',
          ultimaAcao: '',
          observacao: ''
        });
        criados += 1;
        continue;
      }

      const statusPreservado = ['CONCLUIDO', 'CONTATADO', 'ADIADO', 'SEM_CONTATO'].includes(existing.status);
      existing.set({
        ...item,
        uniqueKey,
        status: statusPreservado ? existing.status : 'PENDENTE',
        responsavel: existing.responsavel || '',
        ultimaAcao: existing.ultimaAcao || '',
        ultimaAcaoEm: existing.ultimaAcaoEm || null,
        proximaAcaoEm: existing.proximaAcaoEm || null,
        observacao: existing.observacao || ''
      });
      await existing.save();
      if (statusPreservado) preservados += 1;
      else atualizados += 1;
    }

    return { totalItens, criados, atualizados, preservados };
  }

  async function gerarFilaCobrancaDia({ req = {}, dataReferencia = new Date(), limiteCarnes = 1000 } = {}) {
    const ref = dayOnly(dataReferencia);
    if (!ref) {
      const error = new Error('Data de referência inválida.');
      error.statusCode = 400;
      throw error;
    }

    const carnes = await FinanceiroCarneDigital.find({ status: 'ATIVO' })
      .sort({ 'resumo.atrasadas': -1, 'resumo.saldo': -1 })
      .limit(Math.max(1, Math.min(Number(limiteCarnes || 1000), 5000)));

    let criados = 0;
    let atualizados = 0;
    let preservados = 0;
    let totalItens = 0;

    for (const carne of carnes) {
      const resultado = await upsertCarneNaFilaCobranca(carne, ref);
      totalItens += resultado.totalItens;
      criados += resultado.criados;
      atualizados += resultado.atualizados;
      preservados += resultado.preservados;
    }

    await registrarAuditoriaFinanceira({
      req,
      acao: 'FILA_COBRANCA_GERADA',
      entidade: 'FinanceiroFilaCobranca',
      codigo: dateKey(ref),
      depois: { totalItens, criados, atualizados, preservados },
      metadata: { dataReferencia: dateKey(ref), limiteCarnes }
    });

    return {
      ok: true,
      dataReferencia: dateKey(ref),
      carnesAnalisados: carnes.length,
      totalItens,
      criados,
      atualizados,
      preservados
    };
  }


  function normalizePromessaPagamento(doc = {}) {
    const row = typeof doc?.toObject === 'function' ? doc.toObject() : doc;
    return {
      id: String(row._id || row.id || ''),
      filaItemId: row.filaItemId ? String(row.filaItemId) : '',
      carneId: row.carneId ? String(row.carneId) : '',
      carneCodigo: row.carneCodigo || '',
      clienteNome: row.clienteNome || '',
      clienteCpf: row.clienteCpf || '',
      telefone: row.telefone || '',
      documento: row.documento || '',
      parcelaCodigo: row.parcelaCodigo || '',
      parcelaLabel: row.parcelaLabel || '',
      valorPrometido: Number(row.valorPrometido || 0),
      dataPrometida: row.dataPrometida || null,
      formaPagamento: row.formaPagamento || 'PIX',
      status: row.status || 'PENDENTE',
      origem: row.origem || '',
      responsavel: row.responsavel || '',
      observacao: row.observacao || '',
      lembreteEnviado: row.lembreteEnviado === true,
      lembreteEnviadoEm: row.lembreteEnviadoEm || null,
      alertaInternoEnviado: row.alertaInternoEnviado === true,
      alertaInternoEnviadoEm: row.alertaInternoEnviadoEm || null,
      alertaInternoTentadoEm: row.alertaInternoTentadoEm || null,
      alertaInternoErro: row.alertaInternoErro || '',
      cumpridaEm: row.cumpridaEm || null,
      quebradaEm: row.quebradaEm || null,
      canceladaEm: row.canceladaEm || null,
      pagamentoReferencia: row.pagamentoReferencia || '',
      createdAt: row.createdAt || null,
      updatedAt: row.updatedAt || null
    };
  }

  function buildPromessaWhatsappMessage(promessa = {}) {
    const data = promessa.dataPrometida ? formatDateBR(promessa.dataPrometida) : 'data combinada';
    return [
      '🤝 Confirmação de promessa de pagamento',
      '',
      `Olá, ${promessa.clienteNome || 'cliente'}.`,
      '',
      `Registramos sua promessa de pagamento para ${data}.`,
      `💰 Valor combinado: ${formatMoneyBRL(promessa.valorPrometido || 0)}`,
      `💳 Forma de pagamento: ${promessa.formaPagamento || 'não informada'}`,
      promessa.parcelaLabel ? `🧾 Parcela: ${promessa.parcelaLabel}` : '',
      promessa.documento ? `📄 Referência: ${promessa.documento}` : '',
      '',
      'Caso já tenha realizado o pagamento, envie o comprovante para nosso financeiro.',
      'Ariana Móveis'
    ].filter(Boolean).join('\n');
  }

  function getPromessaAlertDateRange(dataReferencia = new Date()) {
    const config = getFinanceiroReguaWhatsappConfig();
    const referencia = parseFinanceiroDate(dataReferencia) || new Date();
    const clock = getFinanceiroAutomationClock(referencia, config.timezone);
    const inicio = dayOnly(clock.dateKey);
    const fim = new Date(inicio.getTime());
    fim.setHours(23, 59, 59, 999);
    return { inicio, fim, clock };
  }

  function getAdminWhatsappNumbers(settings = {}) {
    const raw = String(
      process.env.FINANCEIRO_PROMESSA_ALERTA_NUMBERS ||
      process.env.EVOLUTION_ADMIN_NOTIFY_NUMBERS ||
      process.env.EVOLUTION_ADMIN_NUMBER ||
      settings.adminNotifyNumbers ||
      ''
    );
    return Array.from(new Set(
      raw.split(/[\s,;|]+/)
        .map((number) => normalizePhone(number, settings.defaultCountryCode || '55'))
        .filter(Boolean)
    ));
  }

  async function getPromessasHoje(dataReferencia = new Date()) {
    const { inicio, fim, clock } = getPromessaAlertDateRange(dataReferencia);
    const rows = await FinanceiroPromessaPagamento.find({
      status: 'PENDENTE',
      dataPrometida: { $gte: inicio, $lte: fim }
    }).sort({ valorPrometido: -1, clienteNome: 1 });
    return { rows, inicio, fim, clock };
  }

  function buildPromessasHojeInternalMessage(rows = [], clock = {}) {
    const total = rows.reduce((sum, row) => sum + Number(row.valorPrometido || 0), 0);
    const lines = [
      '🔔 Promessas de pagamento para hoje',
      '',
      `Data: ${formatDateBR(clock.dateKey || new Date())}`,
      `Clientes: ${rows.length}`,
      `Valor combinado: ${formatMoneyBRL(total)}`,
      ''
    ];

    rows.slice(0, 30).forEach((row, index) => {
      const referencia = row.parcelaLabel || row.documento || row.carneCodigo || 'sem referência';
      const telefone = normalizePhone(row.telefone || '', '55');
      lines.push(
        `${index + 1}. ${row.clienteNome || 'Cliente'} — ${formatMoneyBRL(row.valorPrometido || 0)}`,
        `   ${referencia}${telefone ? ` • WhatsApp ${telefone}` : ' • sem telefone cadastrado'}`
      );
    });

    if (rows.length > 30) lines.push('', `Mais ${rows.length - 30} promessa(s) no painel.`);
    lines.push('', 'Abra Financeiro > Fila do Dia para realizar as cobranças.', 'Ariana Móveis');
    return lines.join('\n');
  }

  async function notificarPromessasHojeInternamente({ req = {}, dataReferencia = new Date(), force = false } = {}) {
    const { rows, clock } = await getPromessasHoje(dataReferencia);
    const pendentesEnvio = force ? rows : rows.filter((row) => row.alertaInternoEnviado !== true);
    const settings = await getWhatsappSettings();
    const destinatarios = getAdminWhatsappNumbers(settings);

    if (!rows.length || !pendentesEnvio.length) {
      return {
        ok: true,
        enviado: false,
        motivo: rows.length ? 'ja_notificado' : 'sem_promessas_hoje',
        totalPromessas: rows.length,
        totalPendentesNotificacao: pendentesEnvio.length,
        destinatariosConfigurados: destinatarios.length
      };
    }

    if (!destinatarios.length) {
      return {
        ok: true,
        enviado: false,
        motivo: 'sem_destinatario_interno',
        totalPromessas: rows.length,
        totalPendentesNotificacao: pendentesEnvio.length,
        destinatariosConfigurados: 0
      };
    }

    const mensagem = buildPromessasHojeInternalMessage(pendentesEnvio, clock);
    const resultados = [];
    for (const number of destinatarios) {
      try {
        const whatsapp = await waSendTextMessage({ number, text: mensagem, settings });
        resultados.push({ ok: true, number: number.slice(-4), whatsapp: redact(whatsapp || null) });
      } catch (error) {
        resultados.push({ ok: false, number: number.slice(-4), error: error.message || String(error) });
      }
    }

    const sucessos = resultados.filter((item) => item.ok).length;
    const erro = resultados.filter((item) => !item.ok).map((item) => item.error).join(' | ').slice(0, 1000);
    const ids = pendentesEnvio.map((row) => row._id);
    await FinanceiroPromessaPagamento.updateMany(
      { _id: { $in: ids } },
      {
        $set: {
          alertaInternoTentadoEm: new Date(),
          alertaInternoEnviado: sucessos > 0,
          alertaInternoEnviadoEm: sucessos > 0 ? new Date() : null,
          alertaInternoErro: erro
        }
      }
    );

    await registrarAuditoriaFinanceira({
      req,
      acao: 'PROMESSAS_HOJE_ALERTA_INTERNO',
      entidade: 'FinanceiroPromessaPagamento',
      codigo: clock.dateKey,
      depois: {
        totalPromessas: rows.length,
        totalPendentesNotificacao: pendentesEnvio.length,
        destinatariosConfigurados: destinatarios.length,
        sucessos,
        falhas: resultados.length - sucessos
      },
      sucesso: sucessos > 0,
      erro
    });

    return {
      ok: sucessos > 0,
      enviado: sucessos > 0,
      totalPromessas: rows.length,
      totalPendentesNotificacao: pendentesEnvio.length,
      destinatariosConfigurados: destinatarios.length,
      sucessos,
      falhas: resultados.length - sucessos,
      error: sucessos > 0 ? '' : (erro || 'Não foi possível enviar o alerta interno.')
    };
  }

  async function atualizarPromessasVencidas(req = {}) {
    const hoje = dayOnly(new Date());
    const rows = await FinanceiroPromessaPagamento.find({
      status: 'PENDENTE',
      dataPrometida: { $lt: hoje }
    });

    let quebradas = 0;
    for (const row of rows) {
      row.status = 'QUEBRADA';
      row.quebradaEm = new Date();
      await row.save();
      quebradas += 1;

      if (row.filaItemId) {
        await FinanceiroFilaCobranca.findByIdAndUpdate(row.filaItemId, {
          $set: {
            status: 'PENDENTE',
            prioridade: 'CRITICA',
            prioridadeScore: 100,
            ultimaAcao: 'PROMESSA_QUEBRADA',
            ultimaAcaoEm: new Date(),
            observacao: [
              String((await FinanceiroFilaCobranca.findById(row.filaItemId))?.observacao || ''),
              `Promessa quebrada em ${formatDateBR(row.dataPrometida)}.`
            ].filter(Boolean).join(' ').slice(0, 2000)
          }
        }).catch(() => null);
      }

      await registrarAuditoriaFinanceira({
        req,
        acao: 'PROMESSA_PAGAMENTO_QUEBRADA',
        entidade: 'FinanceiroPromessaPagamento',
        entidadeId: String(row._id),
        codigo: row.carneCodigo,
        depois: normalizePromessaPagamento(row)
      });
    }

    return { quebradas };
  }


  function normalizeTratativaFinanceira(doc = {}) {
    const row = typeof doc?.toObject === 'function' ? doc.toObject() : doc;
    return {
      id: String(row._id || row.id || ''),
      filaItemId: row.filaItemId ? String(row.filaItemId) : '',
      promessaId: row.promessaId ? String(row.promessaId) : '',
      carneId: row.carneId ? String(row.carneId) : '',
      carneCodigo: row.carneCodigo || '',
      clienteNome: row.clienteNome || '',
      clienteCpf: row.clienteCpf || '',
      telefone: row.telefone || '',
      documento: row.documento || '',
      parcelaLabel: row.parcelaLabel || '',
      motivo: row.motivo || '',
      motivoDetalhe: row.motivoDetalhe || '',
      canal: row.canal || 'WHATSAPP',
      resultado: row.resultado || 'SEM_RETORNO',
      proximaAcao: row.proximaAcao || 'ACOMPANHAR',
      proximaAcaoEm: row.proximaAcaoEm || null,
      responsavel: row.responsavel || '',
      observacao: row.observacao || '',
      concluida: row.concluida === true,
      concluidaEm: row.concluidaEm || null,
      createdAt: row.createdAt || null,
      updatedAt: row.updatedAt || null
    };
  }

  function getTratativaMotivosPermitidos() {
    return new Set([
      'ESQUECEU',
      'NAO_RECEBEU_COBRANCA',
      'PROBLEMA_FINANCEIRO_TEMPORARIO',
      'PERDA_DE_RENDA',
      'PRODUTO_COM_PROBLEMA',
      'DISCORDANCIA_DE_VALOR',
      'PAGAMENTO_JA_REALIZADO',
      'TELEFONE_INCORRETO',
      'SEM_RETORNO',
      'SOLICITOU_RENEGOCIACAO',
      'OUTRO'
    ]);
  }

  function getTratativaResultadosPermitidos() {
    return new Set([
      'SEM_RETORNO',
      'CLIENTE_CIENTE',
      'PAGAMENTO_PROMETIDO',
      'COMPROVANTE_ENVIADO',
      'NEGOCIACAO_SOLICITADA',
      'CONTESTACAO_ABERTA',
      'CONTATO_INVALIDO',
      'RESOLVIDO'
    ]);
  }

  function getTratativaProximasAcoesPermitidas() {
    return new Set([
      'ACOMPANHAR',
      'ENVIAR_WHATSAPP',
      'LIGAR',
      'AGUARDAR_COMPROVANTE',
      'AGUARDAR_PAGAMENTO',
      'RENEGOCIAR',
      'CORRIGIR_CADASTRO',
      'ENCAMINHAR_ASSISTENCIA',
      'ENCAMINHAR_FINANCEIRO',
      'ENCERRAR'
    ]);
  }


  function getCustomerRiskKey({ cpf = '', telefone = '', nome = '' } = {}) {
    const cpfDigits = cleanPhone(cpf);
    if (cpfDigits) return `cpf:${cpfDigits}`;
    const phoneDigits = cleanPhone(telefone);
    if (phoneDigits) return `telefone:${phoneDigits}`;
    return `nome:${normalizeSearch(nome)}`;
  }

  function normalizeRiscoCliente(doc = {}) {
    const row = typeof doc?.toObject === 'function' ? doc.toObject() : doc;
    return {
      id: String(row._id || row.id || ''),
      customerKey: row.customerKey || '',
      clienteNome: row.clienteNome || '',
      clienteCpf: row.clienteCpf || '',
      telefone: row.telefone || '',
      scoreRisco: Number(row.scoreRisco || 0),
      nivelRisco: row.nivelRisco || 'BAIXO',
      decisaoAutomatica: row.decisaoAutomatica || 'APROVAR',
      statusManual: row.statusManual || 'AUTOMATICO',
      limiteSugerido: Number(row.limiteSugerido || 0),
      exposicaoAtual: Number(row.exposicaoAtual || 0),
      valorVencido: Number(row.valorVencido || 0),
      maxDiasAtraso: Number(row.maxDiasAtraso || 0),
      parcelasAtrasadas: Number(row.parcelasAtrasadas || 0),
      primeiraParcelaAtrasada: row.primeiraParcelaAtrasada === true,
      promessasQuebradas: Number(row.promessasQuebradas || 0),
      promessasCumpridas: Number(row.promessasCumpridas || 0),
      tratativasSemRetorno: Number(row.tratativasSemRetorno || 0),
      renegociacoesSolicitadas: Number(row.renegociacoesSolicitadas || 0),
      contratosAtivos: Number(row.contratosAtivos || 0),
      contratosQuitados: Number(row.contratosQuitados || 0),
      motivos: Array.isArray(row.motivos) ? row.motivos : [],
      fatores: Array.isArray(row.fatores) ? row.fatores : [],
      ultimaAvaliacaoEm: row.ultimaAvaliacaoEm || null,
      ultimaDecisaoManualEm: row.ultimaDecisaoManualEm || null,
      ultimaDecisaoManualPor: row.ultimaDecisaoManualPor || '',
      observacaoManual: row.observacaoManual || '',
      createdAt: row.createdAt || null,
      updatedAt: row.updatedAt || null
    };
  }

  function calculateRiskDecision({
    exposicaoAtual = 0,
    valorVencido = 0,
    maxDiasAtraso = 0,
    parcelasAtrasadas = 0,
    primeiraParcelaAtrasada = false,
    promessasQuebradas = 0,
    promessasCumpridas = 0,
    tratativasSemRetorno = 0,
    renegociacoesSolicitadas = 0,
    contratosQuitados = 0,
    contratosAtivos = 0
  } = {}) {
    let score = 0;
    const fatores = [];

    const add = (points, code, label, value = null) => {
      score += points;
      fatores.push({ code, label, points, value });
    };

    if (Number(valorVencido || 0) > 0) add(20, 'VALOR_VENCIDO', 'Cliente possui saldo vencido', valorVencido);
    if (Number(valorVencido || 0) >= 500) add(8, 'VENCIDO_500', 'Saldo vencido acima de R$ 500,00', valorVencido);
    if (Number(valorVencido || 0) >= 1500) add(12, 'VENCIDO_1500', 'Saldo vencido acima de R$ 1.500,00', valorVencido);
    if (Number(maxDiasAtraso || 0) >= 8) add(10, 'ATRASO_8', 'Atraso superior a 7 dias', maxDiasAtraso);
    if (Number(maxDiasAtraso || 0) >= 16) add(12, 'ATRASO_16', 'Atraso superior a 15 dias', maxDiasAtraso);
    if (Number(maxDiasAtraso || 0) >= 31) add(18, 'ATRASO_31', 'Atraso superior a 30 dias', maxDiasAtraso);
    if (Number(maxDiasAtraso || 0) >= 61) add(20, 'ATRASO_61', 'Atraso superior a 60 dias', maxDiasAtraso);
    if (Number(parcelasAtrasadas || 0) >= 2) add(12, 'MULTIPLAS_ATRASADAS', 'Duas ou mais parcelas atrasadas', parcelasAtrasadas);
    if (Number(parcelasAtrasadas || 0) >= 3) add(10, 'TRES_ATRASADAS', 'Três ou mais parcelas atrasadas', parcelasAtrasadas);
    if (primeiraParcelaAtrasada) add(25, 'PRIMEIRA_ATRASADA', 'Primeira parcela em atraso', true);
    if (Number(promessasQuebradas || 0) >= 1) add(20, 'PROMESSA_QUEBRADA', 'Possui promessa de pagamento quebrada', promessasQuebradas);
    if (Number(promessasQuebradas || 0) >= 2) add(15, 'REINCIDENCIA_PROMESSA', 'Reincidência em promessa quebrada', promessasQuebradas);
    if (Number(tratativasSemRetorno || 0) >= 2) add(10, 'SEM_RETORNO', 'Múltiplas tratativas sem retorno', tratativasSemRetorno);
    if (Number(renegociacoesSolicitadas || 0) >= 1) add(6, 'RENEGOCIACAO', 'Solicitou renegociação', renegociacoesSolicitadas);
    if (Number(exposicaoAtual || 0) >= 3000) add(8, 'EXPOSICAO_3000', 'Exposição atual acima de R$ 3.000,00', exposicaoAtual);
    if (Number(exposicaoAtual || 0) >= 7000) add(12, 'EXPOSICAO_7000', 'Exposição atual acima de R$ 7.000,00', exposicaoAtual);

    if (Number(promessasCumpridas || 0) >= 2) {
      score -= 8;
      fatores.push({ code: 'PROMESSAS_CUMPRIDAS', label: 'Histórico positivo de promessas cumpridas', points: -8, value: promessasCumpridas });
    }
    if (Number(contratosQuitados || 0) >= 1) {
      score -= 10;
      fatores.push({ code: 'CONTRATO_QUITADO', label: 'Possui contrato quitado', points: -10, value: contratosQuitados });
    }
    if (Number(contratosQuitados || 0) >= 3) {
      score -= 8;
      fatores.push({ code: 'BOM_HISTORICO', label: 'Bom histórico de contratos quitados', points: -8, value: contratosQuitados });
    }

    score = Math.max(0, Math.min(100, Math.round(score)));

    const nivelRisco = score >= 75 ? 'CRITICO' : (score >= 50 ? 'ALTO' : (score >= 25 ? 'MEDIO' : 'BAIXO'));
    let decisaoAutomatica = 'APROVAR';
    if (nivelRisco === 'MEDIO') decisaoAutomatica = 'REVISAR';
    if (nivelRisco === 'ALTO' || nivelRisco === 'CRITICO') decisaoAutomatica = 'BLOQUEAR';

    const baseLimite = Number(process.env.FINANCEIRO_RISK_BASE_LIMIT || 3000);
    let fatorLimite = 1;
    if (nivelRisco === 'MEDIO') fatorLimite = 0.5;
    if (nivelRisco === 'ALTO') fatorLimite = 0.2;
    if (nivelRisco === 'CRITICO') fatorLimite = 0;
    const limiteSugerido = Math.max(0, Number((baseLimite * fatorLimite - Number(exposicaoAtual || 0)).toFixed(2)));

    return { score, nivelRisco, decisaoAutomatica, limiteSugerido, fatores };
  }

  async function recalculateCustomerRisk({
    req = {},
    cpf = '',
    telefone = '',
    nome = ''
  } = {}) {
    const customerKey = getCustomerRiskKey({ cpf, telefone, nome });
    const cpfDigits = cleanPhone(cpf);
    const telefoneDigits = cleanPhone(telefone);
    const normalizedName = normalizeSearch(nome);

    const carneFilter = {
      $or: [
        ...(cpfDigits ? [{ 'cliente.cpf': new RegExp(escapeRegex(cpfDigits), 'i') }] : []),
        ...(telefoneDigits ? [{ 'cliente.telefone': new RegExp(escapeRegex(telefoneDigits), 'i') }] : []),
        ...(normalizedName ? [{ 'cliente.nomeNormalizado': normalizedName }, { 'cliente.nome': new RegExp(escapeRegex(nome), 'i') }] : [])
      ]
    };

    if (!carneFilter.$or.length) {
      const error = new Error('Informe CPF, telefone ou nome para avaliar o risco.');
      error.statusCode = 400;
      throw error;
    }

    const carnes = await FinanceiroCarneDigital.find(carneFilter).lean();
    const carneIds = carnes.map((row) => row._id);
    const carneCodes = carnes.map((row) => row.codigo).filter(Boolean);

    const promiseFilter = {
      $or: [
        ...(carneIds.length ? [{ carneId: { $in: carneIds } }] : []),
        ...(cpfDigits ? [{ clienteCpf: cpfDigits }] : []),
        ...(telefoneDigits ? [{ telefone: new RegExp(escapeRegex(telefoneDigits), 'i') }] : [])
      ]
    };
    const treatmentFilter = {
      $or: [
        ...(carneIds.length ? [{ carneId: { $in: carneIds } }] : []),
        ...(cpfDigits ? [{ clienteCpf: cpfDigits }] : []),
        ...(telefoneDigits ? [{ telefone: new RegExp(escapeRegex(telefoneDigits), 'i') }] : [])
      ]
    };

    const [promessas, tratativas] = await Promise.all([
      promiseFilter.$or.length ? FinanceiroPromessaPagamento.find(promiseFilter).lean() : [],
      treatmentFilter.$or.length ? FinanceiroTratativa.find(treatmentFilter).lean() : []
    ]);

    let exposicaoAtual = 0;
    let valorVencido = 0;
    let maxDiasAtraso = 0;
    let parcelasAtrasadas = 0;
    let primeiraParcelaAtrasada = false;
    let contratosAtivos = 0;
    let contratosQuitados = 0;

    for (const carne of carnes) {
      const resumo = carne.resumo || {};
      exposicaoAtual += Number(resumo.saldo || 0);
      valorVencido += Number(
        (Array.isArray(carne.parcelas) ? carne.parcelas : [])
          .filter((p) => p.status === 'atrasada')
          .reduce((sum, p) => sum + Number(p.atualizacaoFinanceira?.valorAtualizado || p.saldoParcela || 0), 0)
      );
      parcelasAtrasadas += Number(resumo.atrasadas || 0);
      if (Number(resumo.saldo || 0) > 0) contratosAtivos += 1;
      else contratosQuitados += 1;

      for (const p of Array.isArray(carne.parcelas) ? carne.parcelas : []) {
        if (p.status !== 'atrasada') continue;
        maxDiasAtraso = Math.max(maxDiasAtraso, Number(p.atualizacaoFinanceira?.diasAtraso || 0));
        if (Number(p.parcelaNumero || 0) === 1) primeiraParcelaAtrasada = true;
      }
    }

    const promessasQuebradas = promessas.filter((row) => row.status === 'QUEBRADA').length;
    const promessasCumpridas = promessas.filter((row) => row.status === 'CUMPRIDA').length;
    const tratativasSemRetorno = tratativas.filter((row) => row.resultado === 'SEM_RETORNO').length;
    const renegociacoesSolicitadas = tratativas.filter((row) =>
      row.motivo === 'SOLICITOU_RENEGOCIACAO' || row.resultado === 'NEGOCIACAO_SOLICITADA'
    ).length;

    const calc = calculateRiskDecision({
      exposicaoAtual,
      valorVencido,
      maxDiasAtraso,
      parcelasAtrasadas,
      primeiraParcelaAtrasada,
      promessasQuebradas,
      promessasCumpridas,
      tratativasSemRetorno,
      renegociacoesSolicitadas,
      contratosQuitados,
      contratosAtivos
    });

    const existing = await FinanceiroRiscoCliente.findOne({ customerKey });
    const row = existing || new FinanceiroRiscoCliente({ customerKey });

    const firstCarne = carnes[0] || {};
    row.clienteNome = firstCarne.cliente?.nome || nome || row.clienteNome || '';
    row.clienteCpf = cleanPhone(firstCarne.cliente?.cpf || cpf || row.clienteCpf || '');
    row.telefone = normalizePhone(firstCarne.cliente?.telefone || telefone || row.telefone || '', '55');
    row.scoreRisco = calc.score;
    row.nivelRisco = calc.nivelRisco;
    row.decisaoAutomatica = calc.decisaoAutomatica;
    row.limiteSugerido = calc.limiteSugerido;
    row.exposicaoAtual = Number(exposicaoAtual.toFixed(2));
    row.valorVencido = Number(valorVencido.toFixed(2));
    row.maxDiasAtraso = maxDiasAtraso;
    row.parcelasAtrasadas = parcelasAtrasadas;
    row.primeiraParcelaAtrasada = primeiraParcelaAtrasada;
    row.promessasQuebradas = promessasQuebradas;
    row.promessasCumpridas = promessasCumpridas;
    row.tratativasSemRetorno = tratativasSemRetorno;
    row.renegociacoesSolicitadas = renegociacoesSolicitadas;
    row.contratosAtivos = contratosAtivos;
    row.contratosQuitados = contratosQuitados;
    row.fatores = calc.fatores;
    row.motivos = calc.fatores.filter((f) => Number(f.points || 0) > 0).map((f) => f.code);
    row.ultimaAvaliacaoEm = new Date();
    row.snapshot = {
      carneIds: carneIds.map(String),
      carneCodes,
      promessas: promessas.length,
      tratativas: tratativas.length
    };
    await row.save();

    await registrarAuditoriaFinanceira({
      req,
      acao: existing ? 'RISCO_CLIENTE_RECALCULADO' : 'RISCO_CLIENTE_CRIADO',
      entidade: 'FinanceiroRiscoCliente',
      entidadeId: String(row._id),
      codigo: row.clienteCpf || row.telefone || row.customerKey,
      depois: normalizeRiscoCliente(row)
    });

    return row;
  }

  function effectiveRiskDecision(row = {}) {
    const manual = String(row.statusManual || 'AUTOMATICO');
    if (manual === 'BLOQUEADO') return 'BLOQUEAR';
    if (manual === 'EM_REVISAO') return 'REVISAR';
    if (manual === 'ATIVO') return 'APROVAR';
    return row.decisaoAutomatica || 'REVISAR';
  }

  function normalizeCarneDigital(doc) {
    const row = typeof doc?.toObject === 'function' ? doc.toObject() : (doc || {});
    return {
      id: String(row._id || row.id || ''),
      codigo: row.codigo || '',
      uniqueKey: row.uniqueKey || '',
      fonte: row.fonte || 'sige',
      status: row.status || 'ATIVO',
      cliente: row.cliente || {},
      resumo: row.resumo || {},
      grupos: Array.isArray(row.grupos) ? row.grupos.map((grupo) => ({
        ...grupo,
        parcelas: normalizarIdentificacaoParcelas(grupo.parcelas || [])
      })) : [],
      parcelas: normalizarIdentificacaoParcelas(Array.isArray(row.parcelas) ? row.parcelas : []),
      snapshot: row.snapshot || {},
      coraChargeId: row.coraChargeId || '',
      coraCode: row.coraCode || '',
      coraInternalReference: row.coraInternalReference || '',
      coraDocumentUrl: row.coraDocumentUrl || '',
      coraStatus: row.coraStatus || '',
      coraVinculadoEm: row.coraVinculadoEm || null,
      coraVinculadoPor: row.coraVinculadoPor || '',
      ultimaSincronizacaoEm: row.ultimaSincronizacaoEm || null,
      ultimaSincronizacaoPor: row.ultimaSincronizacaoPor || '',
      criadoPor: row.criadoPor || '',
      createdAt: row.createdAt || null,
      updatedAt: row.updatedAt || null
    };
  }

  async function waSendTextMessage({ number, text, settings = null, delay = 0 }) {
    const cfg = settings || await getWhatsappSettings();
    if (!cfg.enabled) throw new Error('Integração WhatsApp desativada.');
    if (!cfg.apiUrl || !cfg.apiKey || !cfg.instanceName) throw new Error('Configuração incompleta do WhatsApp.');
    const normalizedNumber = normalizePhone(number, cfg.defaultCountryCode || '55');
    if (!normalizedNumber) throw new Error('Número de telefone inválido.');

    // Corrige templates/rascunhos antigos que possam ter sido salvos com
    // UTF-8 interpretado como Windows-1252 antes de enviá-los à Evolution.
    const message = normalizeWhatsappText(String(text || ''));
    if (!message) throw new Error('Mensagem de WhatsApp vazia.');

    const url = `${String(cfg.apiUrl).replace(/\/+$/, '')}/message/sendText/${encodeURIComponent(cfg.instanceName)}`;
    const response = await axios.post(url, {
      number: normalizedNumber,
      text: message,
      delay: Number(delay || 0) || 0,
      linkPreview: false
    }, {
      headers: { 'Content-Type': 'application/json', apikey: cfg.apiKey },
      timeout: 30000,
      validateStatus: () => true
    });

    if (response.status < 200 || response.status >= 300) {
      const errorMessage = typeof response.data === 'string'
        ? response.data
        : (response.data?.message || response.data?.error || `Erro Evolution API HTTP ${response.status}`);
      const err = new Error(String(errorMessage));
      err.statusCode = response.status;
      err.responseData = response.data;
      throw err;
    }

    const data = response.data || {};
    const statusText = String(data.status || data.state || data.statusMessage || '').toLowerCase();
    const hasProviderError = data.ok === false
      || data.success === false
      || data.error
      || statusText.includes('error')
      || statusText.includes('fail')
      || statusText.includes('not_found')
      || statusText.includes('disconnected')
      || statusText.includes('closed');

    if (hasProviderError) {
      const errorMessage = typeof data === 'string'
        ? data
        : (data.message || data.error || data.reason || 'Evolution API não confirmou o envio da mensagem.');
      const err = new Error(String(errorMessage));
      err.statusCode = response.status;
      err.responseData = data;
      throw err;
    }

    return { ok: true, url, number: normalizedNumber, instanceName: cfg.instanceName, data, status: response.status };
  }

  app.get('/api/admin/sige/status', adminRequired, async (_req, res) => {
    return res.json({
      ok: true,
      configured: isSigeConfigured(),
      apiUrl: SIGE_API_URL,
      user: SIGE_USER ? SIGE_USER.replace(/(.{3}).+(@.+)/, '$1***$2') : '',
      app: SIGE_APP || '',
      tokenConfigured: Boolean(SIGE_TOKEN),
      planoContaConfigured: Boolean(SIGE_PLANO_CONTA),
      planoConta: SIGE_PLANO_CONTA ? `${SIGE_PLANO_CONTA.slice(0, 6)}...${SIGE_PLANO_CONTA.slice(-4)}` : ''
    });
  });

  app.get('/api/admin/sige/clientes', adminRequired, async (req, res) => {
    try {
      const q = String(req.query.q || req.query.nome || '').trim();
      const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 200));
      const pessoas = await getSigePessoasByQuery(q, limit);
      return res.json({ ok: true, clientes: pessoas, total: pessoas.length });
    } catch (error) {
      console.error('Erro SIGE clientes:', error.message || error);
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao consultar clientes no SIGE' });
    }
  });

  function normalizeSigeProdutoForDocuments(item = {}) {
    const firstNumber = (...values) => {
      for (const value of values) {
        if (value === undefined || value === null || String(value).trim() === '') continue;
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
      }
      return null;
    };
    const firstText = (...values) => {
      for (const value of values) {
        if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
      }
      return '';
    };

    return {
      id: firstText(item.ID, item.Id, item.id, item._id),
      codigo: firstText(item.Codigo, item.codigo, item.SKU, item.sku),
      ean: firstText(item.Ean, item.EAN, item.ean, item.CodigoBarras, item.codigoBarras),
      nome: firstText(item.Nome, item.nome, item.Descricao, item.descricao),
      marca: firstText(item.Marca, item.marca, item.Fabricante, item.fabricante),
      modelo: firstText(item.Modelo, item.modelo),
      especificacao: firstText(item.Especificacao, item.especificacao, item.Descricao, item.descricao),
      unidade: firstText(item.UnidadeComercial, item.unidadeComercial, item.EstoqueUnidade, item.estoqueUnidade, item.Unidade, item.unidade, 'UN'),
      numeroSerie: firstText(item.NumeroSerie, item.numeroSerie),
      precoVenda: firstNumber(item.PrecoVenda, item.precoVenda, item.ValorVenda, item.valorVenda) ?? 0,
      precoMinimoVenda: firstNumber(item.PrecoMinimoVenda, item.precoMinimoVenda),
      estoqueSaldo: firstNumber(item.EstoqueSaldo, item.estoqueSaldo, item.EstoqueAtual, item.estoqueAtual),
      categoria: firstText(item.Categoria, item.categoria)
    };
  }

  function normalizeSigeProdutoRows(raw) {
    if (Array.isArray(raw)) return raw;
    const candidates = [raw?.items, raw?.Itens, raw?.data, raw?.Data, raw?.dados, raw?.Dados, raw?.produtos, raw?.Produtos, raw?.resultado, raw?.Resultado];
    return candidates.find(Array.isArray) || [];
  }

  app.get('/api/admin/sige/produtos', adminRequired, async (req, res) => {
    try {
      const q = String(req.query.q || req.query.nome || req.query.codigo || '').trim();
      const limit = Math.max(1, Math.min(Number(req.query.limit || 30), 100));
      if (q.length < 2) {
        return res.status(400).json({ ok: false, error: 'Informe ao menos 2 caracteres para pesquisar o produto.' });
      }

      const attempts = [{ nome: q, pageSize: limit, skip: 0 }];
      if (/^[a-zA-Z0-9._\/-]+$/.test(q)) attempts.push({ codigo: q, pageSize: limit, skip: 0 });
      if (/^\d{6,14}$/.test(q.replace(/\D/g, ''))) attempts.push({ ean: q.replace(/\D/g, ''), pageSize: limit, skip: 0 });

      const merged = [];
      for (const params of attempts) {
        try {
          const raw = await sigeGet('Produtos/Pesquisar', params);
          merged.push(...normalizeSigeProdutoRows(raw));
        } catch (error) {
          // 400/404 podem significar apenas que esse filtro não encontrou resultado.
          const status = Number(error?.statusCode || error?.status || 0);
          if (![400, 404].includes(status)) throw error;
        }
      }

      const seen = new Set();
      const produtos = merged
        .map(normalizeSigeProdutoForDocuments)
        .filter((item) => item.nome || item.codigo || item.ean)
        .filter((item) => {
          const key = item.id || item.codigo || item.ean || `${item.nome}|${item.marca}|${item.modelo}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, limit);

      return res.json({ ok: true, produtos, total: produtos.length });
    } catch (error) {
      console.error('Erro SIGE produtos:', error.message || error);
      return res.status(error.statusCode || error.status || 500).json({
        ok: false,
        error: error.message || 'Erro ao consultar produtos no SIGE'
      });
    }
  });


  // ============================================================
  // ARIANA SIGN - PONTE PRIVADA DE ARMAZENAMENTO CLOUDINARY
  // A VPS de documentos envia os arquivos pelo backend autenticado.
  // As credenciais Cloudinary permanecem somente no backend principal.
  // ============================================================
  const ARIANA_SIGN_ALLOWED_EVIDENCE_KINDS = new Set([
    'selfie',
    'documentFront',
    'documentBack',
    'documentOriginal',
    'certificate',
    'dossier',
    'signedPackage'
  ]);

  function arianaSignSafeSegment(value = '') {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 120) || 'arquivo';
  }

  function arianaSignUploadRawAuthenticated(buffer, { folder, publicId, context = {} } = {}) {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder,
          public_id: publicId,
          resource_type: 'raw',
          type: 'authenticated',
          overwrite: true,
          unique_filename: false,
          use_filename: false,
          invalidate: false,
          tags: ['ariana-sign', 'evidencia-assinatura'],
          context
        },
        (error, result) => error ? reject(error) : resolve(result)
      );
      stream.end(buffer);
    });
  }

  app.get('/api/admin/ariana-sign/storage/status', adminRequired, async (_req, res) => {
    const configured = Boolean(isCloudinaryConfigured());
    return res.json({
      ok: true,
      provider: 'cloudinary',
      configured,
      storageMode: 'raw/authenticated',
      credentialLocation: 'backend-principal'
    });
  });

  app.post('/api/admin/ariana-sign/storage/test', adminRequired, async (_req, res) => {
    try {
      if (!isCloudinaryConfigured()) {
        return res.status(503).json({ ok: false, code: 'CLOUDINARY_NOT_CONFIGURED', error: 'Cloudinary não configurado no backend principal.' });
      }
      const result = await cloudinary.api.ping();
      const ok = String(result?.status || '').toLowerCase() === 'ok';
      return res.status(ok ? 200 : 502).json({ ok, provider: 'cloudinary', status: result?.status || 'unknown' });
    } catch (error) {
      console.error('[ARIANA SIGN CLOUDINARY TEST]', error.message || error);
      return res.status(502).json({ ok: false, error: error.message || 'Falha ao validar Cloudinary no backend.' });
    }
  });

  app.post('/api/admin/ariana-sign/evidencias', adminRequired, async (req, res) => {
    try {
      if (!isCloudinaryConfigured()) {
        return res.status(503).json({ ok: false, code: 'CLOUDINARY_NOT_CONFIGURED', error: 'Cloudinary não configurado no backend principal.' });
      }

      const signatureCode = arianaSignSafeSegment(req.body?.signatureCode || '');
      const documentNumber = String(req.body?.documentNumber || '').trim().slice(0, 120);
      const kind = String(req.body?.kind || '').trim();
      const filename = arianaSignSafeSegment(req.body?.filename || kind || 'arquivo');
      const expectedSha256 = String(req.body?.sha256 || '').trim().toLowerCase();
      const base64 = String(req.body?.base64 || '').replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');

      if (!signatureCode || signatureCode === 'arquivo') {
        return res.status(400).json({ ok: false, error: 'Código da assinatura inválido.' });
      }
      if (!ARIANA_SIGN_ALLOWED_EVIDENCE_KINDS.has(kind)) {
        return res.status(400).json({ ok: false, error: 'Tipo de evidência inválido.' });
      }
      if (!base64) {
        return res.status(400).json({ ok: false, error: 'Arquivo não informado.' });
      }

      let buffer;
      try {
        buffer = Buffer.from(base64, 'base64');
      } catch (_error) {
        return res.status(400).json({ ok: false, error: 'Arquivo em base64 inválido.' });
      }

      const maxBytes = 25 * 1024 * 1024;
      if (!buffer.length || buffer.length > maxBytes) {
        return res.status(413).json({ ok: false, error: 'Arquivo vazio ou acima do limite de 25 MB.' });
      }

      const calculatedSha256 = crypto.createHash('sha256').update(buffer).digest('hex');
      if (expectedSha256 && expectedSha256 !== calculatedSha256) {
        return res.status(409).json({ ok: false, code: 'SHA256_MISMATCH', error: 'O hash SHA-256 recebido não confere com o arquivo enviado.' });
      }

      const folder = `ariana_moveis/ariana-sign/evidencias/${signatureCode}`;
      const uploaded = await arianaSignUploadRawAuthenticated(buffer, {
        folder,
        publicId: filename,
        context: {
          signature_code: signatureCode,
          document_number: documentNumber,
          evidence_kind: kind,
          sha256: calculatedSha256
        }
      });

      if (Number(uploaded?.bytes || 0) !== buffer.length) {
        return res.status(502).json({ ok: false, error: 'Cloudinary retornou tamanho divergente. O arquivo de origem deve ser preservado.' });
      }

      return res.status(201).json({
        ok: true,
        asset: {
          assetId: uploaded?.asset_id || '',
          publicId: uploaded?.public_id || `${folder}/${filename}`,
          resourceType: uploaded?.resource_type || 'raw',
          deliveryType: uploaded?.type || 'authenticated',
          format: uploaded?.format || '',
          bytes: Number(uploaded?.bytes || buffer.length),
          version: uploaded?.version || null,
          createdAt: uploaded?.created_at || new Date().toISOString(),
          sha256: calculatedSha256,
          originalFilename: filename
        }
      });
    } catch (error) {
      console.error('[ARIANA SIGN CLOUDINARY UPLOAD]', error.message || error);
      return res.status(502).json({ ok: false, error: error.message || 'Falha ao arquivar evidência no Cloudinary.' });
    }
  });

  app.post('/api/admin/ariana-sign/evidencias/url', adminRequired, async (req, res) => {
    try {
      if (!isCloudinaryConfigured()) {
        return res.status(503).json({ ok: false, error: 'Cloudinary não configurado no backend principal.' });
      }
      const publicId = String(req.body?.publicId || '').trim();
      if (!publicId) return res.status(400).json({ ok: false, error: 'publicId não informado.' });
      const ttl = Math.max(60, Math.min(Number(req.body?.ttlSeconds || 900), 3600));
      const expiresAt = Math.floor(Date.now() / 1000) + ttl;
      const url = cloudinary.url(publicId, {
        resource_type: String(req.body?.resourceType || 'raw'),
        type: String(req.body?.deliveryType || 'authenticated'),
        sign_url: true,
        secure: true,
        expires_at: expiresAt
      });
      return res.json({ ok: true, url, expiresAt: new Date(expiresAt * 1000).toISOString(), expiresInSeconds: ttl });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Não foi possível gerar URL temporária.' });
    }
  });

  app.get('/api/admin/sige/lancamentos', adminRequired, async (req, res) => {
    try {
      const lancamentos = await getSigeLancamentosFiltered({
        q: req.query.q || '',
        status: req.query.status || 'todos',
        limit: req.query.limit || 1000,
        maxRecords: req.query.maxRecords || 3000
      });
      return res.json({ ok: true, lancamentos, total: lancamentos.length });
    } catch (error) {
      console.error('Erro SIGE lançamentos:', error.message || error);
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao consultar lançamentos no SIGE' });
    }
  });


  function buildSigeCarneFromLancamentos(lancamentos = [], pessoa = null) {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const groupsMap = new Map();
    const parcelas = lancamentos
      .filter((l) => l && l.ehDespesa !== true)
      .map((l) => {
        const venc = l.dataVencimento ? new Date(l.dataVencimento) : null;
        const vencida = !l.quitado && venc && !Number.isNaN(venc.getTime()) && venc < hoje;
        const emAberto = !l.quitado && !vencida;
        const status = l.quitado ? 'paga' : (vencida ? 'atrasada' : 'aberta');
        const chave = String(l.codigoVenda && Number(l.codigoVenda) > 0 ? `Pedido ${l.codigoVenda}` : (l.codigoContrato && Number(l.codigoContrato) > 0 ? `Contrato ${l.codigoContrato}` : (l.documento || l.descricao || 'Sem documento'))).trim();
        const baseParcela = {
          ...l,
          chave,
          status,
          vencida: Boolean(vencida),
          emAberto: Boolean(emAberto),
          valorParcela: Number(l.valor || 0),
          valorPago: Number(l.totalRecebido || 0),
          saldoParcela: Math.max(0, Number(l.saldo || 0))
        };
        return {
          ...baseParcela,
          atualizacaoFinanceira: calcularParcelaAtualizadaBackend(baseParcela, hoje)
        };
      })
      .sort((a, b) => {
        const ka = String(a.chave || '').localeCompare(String(b.chave || ''), 'pt-BR');
        if (ka !== 0) return ka;
        return (new Date(a.dataVencimento || 0).getTime() || 0) - (new Date(b.dataVencimento || 0).getTime() || 0);
      });

    for (const parcela of parcelas) {
      const chave = parcela.chave || 'Sem documento';
      if (!groupsMap.has(chave)) {
        groupsMap.set(chave, {
          documento: chave,
          descricao: parcela.descricao || '',
          codigoVenda: parcela.codigoVenda || 0,
          codigoContrato: parcela.codigoContrato || 0,
          parcelas: [],
          total: 0,
          pago: 0,
          saldo: 0,
          multa: 0,
          juros: 0,
          valorAtualizado: 0,
          pagas: 0,
          abertas: 0,
          atrasadas: 0
        });
      }
      const group = groupsMap.get(chave);
      group.parcelas.push(parcela);
      group.total += Number(parcela.valorParcela || 0);
      group.pago += Number(parcela.valorPago || 0);
      group.saldo += Number(parcela.saldoParcela || 0);
      group.multa += Number(parcela.atualizacaoFinanceira?.multa || 0);
      group.juros += Number(parcela.atualizacaoFinanceira?.juros || 0);
      group.valorAtualizado += Number(parcela.atualizacaoFinanceira?.valorAtualizado || 0);
      if (parcela.status === 'paga') group.pagas += 1;
      if (parcela.status === 'aberta') group.abertas += 1;
      if (parcela.status === 'atrasada') group.atrasadas += 1;
    }

    const grupos = Array.from(groupsMap.values()).map((group) => {
      const totalParcelas = group.parcelas.length || 1;
      group.parcelas = group.parcelas.map((p, index) => ({
        ...p,
        parcelaNumero: index + 1,
        parcelaLabel: `${String(index + 1).padStart(2, '0')}/${String(totalParcelas).padStart(2, '0')}`
      }));
      group.total = Number(group.total.toFixed(2));
      group.pago = Number(group.pago.toFixed(2));
      group.saldo = Number(group.saldo.toFixed(2));
      group.multa = Number(group.multa.toFixed(2));
      group.juros = Number(group.juros.toFixed(2));
      group.valorAtualizado = Number(group.valorAtualizado.toFixed(2));
      return group;
    });

    const resumo = grupos.reduce((acc, g) => {
      acc.total += g.total;
      acc.pago += g.pago;
      acc.saldo += g.saldo;
      acc.multa += Number(g.multa || 0);
      acc.juros += Number(g.juros || 0);
      acc.valorAtualizado += Number(g.valorAtualizado || 0);
      acc.parcelas += g.parcelas.length;
      acc.pagas += g.pagas;
      acc.abertas += g.abertas;
      acc.atrasadas += g.atrasadas;
      return acc;
    }, { total: 0, pago: 0, saldo: 0, multa: 0, juros: 0, valorAtualizado: 0, parcelas: 0, pagas: 0, abertas: 0, atrasadas: 0 });
    resumo.total = Number(resumo.total.toFixed(2));
    resumo.pago = Number(resumo.pago.toFixed(2));
    resumo.saldo = Number(resumo.saldo.toFixed(2));
    resumo.multa = Number(resumo.multa.toFixed(2));
    resumo.juros = Number(resumo.juros.toFixed(2));
    resumo.valorAtualizado = Number(resumo.valorAtualizado.toFixed(2));
    resumo.calculoFinanceiro = getFinanceiroCalculationConfig();

    return {
      cliente: parcelas[0]?.cliente || pessoa?.nome || '',
      telefone: pessoa?.telefone || '',
      cpf: pessoa?.cpf || '',
      cidade: pessoa?.cidade || '',
      uf: pessoa?.uf || '',
      resumo,
      grupos,
      parcelas: normalizarIdentificacaoParcelas(
        grupos.flatMap((grupo) => Array.isArray(grupo.parcelas) ? grupo.parcelas : [])
      )
    };
  }


  function buildSigeCarneWhatsappMessage(carne = {}, options = {}) {
    const grupos = Array.isArray(carne.grupos) ? carne.grupos : [];
    const documentoSelecionado = String(options.documento || '').trim();
    const grupoSelecionado = documentoSelecionado
      ? findCarneGroupByDocumento(grupos, documentoSelecionado)
      : null;

    if (documentoSelecionado && !grupoSelecionado) {
      const error = new Error('A compra selecionada não foi encontrada neste carnê.');
      error.statusCode = 404;
      throw error;
    }

    const gruposParaMensagem = grupoSelecionado ? [grupoSelecionado] : grupos;
    const nomeCompleto = normalizeWhatsappText(carne.cliente || 'Cliente');
    const primeiroNome = nomeCompleto.split(/\s+/)[0] || 'Cliente';
    const linhas = [
      '*ARIANA MÓVEIS - RESUMO DO CARNÊ*',
      '',
      `Olá, ${primeiroNome}.`,
      ''
    ];

    for (const grupo of gruposParaMensagem) {
      const parcelas = Array.isArray(grupo.parcelas) ? grupo.parcelas : [];
      const processadas = parcelas.map((parcela) => {
        const calc = parcela.atualizacaoFinanceira ||
          calcularParcelaAtualizadaBackend(parcela);

        const statusOriginal = String(parcela.status || '').toLowerCase();
        const paga =
          parcela.quitado === true ||
          ['paga', 'pago', 'quitada', 'quitado', 'paid'].includes(statusOriginal);

        const diasAtraso = Number(calc?.diasAtraso || 0);
        const atrasada = !paga && diasAtraso > 0;
        const valorAtualizado = Number(
          calc?.valorAtualizado ??
          parcela.saldoParcela ??
          parcela.valorParcela ??
          parcela.valor ??
          0
        );

        return { parcela, paga, atrasada, valorAtualizado };
      });

      const pagas = processadas.filter((item) => item.paga);
      const atrasadas = processadas.filter((item) => item.atrasada);
      const abertas = processadas.filter((item) => !item.paga && !item.atrasada);

      linhas.push(`Compra: ${normalizeWhatsappText(grupo.descricao || grupo.documento || 'Compra')}`);
      if (grupo.documento) linhas.push(`Pedido: ${normalizeWhatsappText(grupo.documento)}`);
      linhas.push('');
      linhas.push(`Valor da compra: ${formatMoneyBRL(grupo.total || 0)}`);
      linhas.push(`Valor já pago: ${formatMoneyBRL(grupo.pago || 0)}`);
      linhas.push(`Saldo atual: *${formatMoneyBRL(grupo.saldo || 0)}*`);
      linhas.push(`Parcelas pagas: ${pagas.length} de ${processadas.length}`);
      linhas.push('');

      if (atrasadas.length) {
        linhas.push('*PARCELAS ATRASADAS*');
        for (const item of atrasadas) {
          const parcela = item.parcela;
          const vencimento = parcela.dataVencimento
            ? formatDateBR(parcela.dataVencimento)
            : 'sem vencimento';
          linhas.push(
            `${normalizeWhatsappText(parcela.parcelaLabel || 'Parcela')} | venceu em ${vencimento} | ${formatMoneyBRL(item.valorAtualizado)}`
          );
        }
        linhas.push('');
      }

      if (abertas.length) {
        linhas.push('*PRÓXIMAS PARCELAS*');
        for (const item of abertas) {
          const parcela = item.parcela;
          const vencimento = parcela.dataVencimento
            ? formatDateBR(parcela.dataVencimento)
            : 'sem vencimento';
          linhas.push(
            `${normalizeWhatsappText(parcela.parcelaLabel || 'Parcela')} | vence em ${vencimento} | ${formatMoneyBRL(item.valorAtualizado)}`
          );
        }
        linhas.push('');
      }

      if (!atrasadas.length && !abertas.length) {
        linhas.push('*Todas as parcelas desta compra estão pagas.*');
        linhas.push('');
      }
    }

    linhas.push('Em caso de dúvida, responda esta mensagem.');
    linhas.push('Financeiro Ariana Móveis');

    return linhas
      .filter((linha) => linha !== null && linha !== undefined && String(linha).trim() !== '')
      .join('\n')
      .trim();
  }


  async function getSigeCarneData(q = '', options = {}) {
    const termo = String(q || '').trim();
    if (termo.length < 2) {
      const err = new Error('Informe pelo menos 2 letras do cliente para gerar o carnê.');
      err.statusCode = 400;
      throw err;
    }

    const limit = Math.max(1, Math.min(Number(options.limit || 5000), 10000));
    let lancamentos = await getSigeLancamentosFiltered({
      q: termo,
      status: 'todos',
      limit,
      maxRecords: options.maxRecords || 20000
    });

    let pessoa = null;
    try {
      const pessoas = await getSigePessoasByQuery(termo, 10);
      pessoa = pessoas.find((p) => String(p.nome || '').toLowerCase() === termo.toLowerCase()) || pessoas[0] || null;
    } catch (innerError) {
      console.warn('Não foi possível enriquecer carnê com pessoa SIGE:', innerError.message || innerError);
    }

    if ((!lancamentos || !lancamentos.length) && pessoa?.nome && pessoa.nome.toLowerCase() !== termo.toLowerCase()) {
      lancamentos = await getSigeLancamentosFiltered({
        q: pessoa.nome,
        status: 'todos',
        limit,
        maxRecords: options.maxRecords || 20000
      });
    }

    const carne = buildSigeCarneFromLancamentos(lancamentos, pessoa);
    return {
      ok: true,
      ...carne,
      total: lancamentos.length,
      fonte: 'lancamentos_sige',
      fonteFinanceira: 'sige',
      estadoFinanceiroSomenteLeitura: true,
      mongoResponsabilidade: 'historico_recibos_whatsapp_auditoria'
    };
  }

  async function getSigeCarneDataComFallback(termos = [], options = {}) {
    const candidatos = Array.from(new Set(
      (Array.isArray(termos) ? termos : [termos])
        .map((item) => String(item || '').trim())
        .filter((item) => item.length >= 2)
    ));

    const tentativas = [];
    let ultimoResultado = null;
    let ultimoErro = null;

    for (const termo of candidatos) {
      try {
        const resultado = await getSigeCarneData(termo, options);
        const totalParcelas = Array.isArray(resultado?.parcelas) ? resultado.parcelas.length : 0;
        tentativas.push({ termo, ok: totalParcelas > 0, totalParcelas });

        if (totalParcelas > 0 || (Array.isArray(resultado?.grupos) && resultado.grupos.length > 0)) {
          return {
            ...resultado,
            parcelas: normalizarIdentificacaoParcelas(resultado.parcelas || []),
            diagnosticoConsulta: { termoUtilizado: termo, tentativas }
          };
        }

        ultimoResultado = resultado;
      } catch (error) {
        ultimoErro = error;
        tentativas.push({ termo, ok: false, error: error.message || String(error) });
      }
    }

    if (ultimoResultado) {
      return {
        ...ultimoResultado,
        parcelas: normalizarIdentificacaoParcelas(ultimoResultado.parcelas || []),
        diagnosticoConsulta: { termoUtilizado: '', tentativas }
      };
    }

    if (ultimoErro) throw ultimoErro;

    return {
      ok: true,
      cliente: '',
      cpf: '',
      telefone: '',
      resumo: {},
      grupos: [],
      parcelas: [],
      total: 0,
      fonte: 'lancamentos_sige',
      fonteFinanceira: 'sige',
      diagnosticoConsulta: { termoUtilizado: '', tentativas }
    };
  }

  async function getCrediarioAuditForSigeCarne(carne = {}) {
    const nome = String(carne.cliente || '').trim();
    const cpf = cleanPhone(carne.cpf || '');
    const telefone = normalizePhone(carne.telefone || '', '55');

    const or = [];
    if (cpf) or.push({ cpf });
    if (telefone) or.push({ telefone });
    if (nome) or.push({ nome: new RegExp(`^${escapeRegex(nome)}$`, 'i') });

    let clienteLocal = null;
    if (or.length) clienteLocal = await CrediarioCliente.findOne({ $or: or });

    const reciboFilter = {};
    if (clienteLocal?._id) {
      reciboFilter.clienteId = clienteLocal._id;
    } else {
      const reciboOr = [];
      if (cpf) reciboOr.push({ clienteCpf: cpf });
      if (telefone) reciboOr.push({ telefone });
      if (nome) reciboOr.push({ clienteNome: new RegExp(`^${escapeRegex(nome)}$`, 'i') });
      if (reciboOr.length) reciboFilter.$or = reciboOr;
    }

    let recibos = [];
    if (Object.keys(reciboFilter).length) {
      recibos = await CrediarioRecibo.find(reciboFilter)
        .sort({ dataPagamento: -1, createdAt: -1 })
        .limit(200);
    }

    const totalRecibos = recibos.reduce((sum, item) => sum + Number(item.valorPago || 0), 0);
    return {
      clienteLocal: clienteLocal ? normalizeCrediarioCliente(clienteLocal) : null,
      recibos: {
        quantidade: recibos.length,
        valorRegistrado: Number(totalRecibos.toFixed(2)),
        ultimo: recibos[0] ? normalizeCrediarioRecibo(recibos[0]) : null
      },
      observacao: 'Os recibos locais são históricos e não alteram saldo, vencimento ou status das parcelas no SIGE.'
    };
  }

  async function getUnifiedFinancialData(q = '', options = {}) {
    const carne = await getSigeCarneData(q, options);
    let auditoriaMongo = null;
    try {
      auditoriaMongo = await getCrediarioAuditForSigeCarne(carne);
    } catch (auditError) {
      console.warn('Não foi possível enriquecer financeiro com auditoria local:', auditError.message || auditError);
      auditoriaMongo = {
        clienteLocal: null,
        recibos: { quantidade: 0, valorRegistrado: 0, ultimo: null },
        erro: auditError.message || String(auditError)
      };
    }

    return {
      ...carne,
      auditoriaMongo,
      arquitetura: {
        fonteOficialParcelas: 'SIGE',
        fonteOficialSaldo: 'SIGE',
        fonteOficialPagamentos: 'SIGE',
        mongoDb: ['clientes complementares', 'recibos emitidos', 'WhatsApp', 'logs', 'auditoria']
      }
    };
  }



  async function sincronizarCarneDigitalSige(q = '', req = {}, options = {}) {
    const existenteInformado = options.existingCarne || null;
    const termos = [
      q,
      ...(Array.isArray(options.termos) ? options.termos : []),
      existenteInformado?.cliente?.cpf,
      existenteInformado?.cliente?.nome,
      existenteInformado?.cliente?.telefone
    ];

    const carneSige = await getSigeCarneDataComFallback(termos, options);
    let auditoriaMongo = null;
    try {
      auditoriaMongo = await getCrediarioAuditForSigeCarne(carneSige);
    } catch (auditError) {
      auditoriaMongo = {
        clienteLocal: null,
        recibos: { quantidade: 0, valorRegistrado: 0, ultimo: null },
        erro: auditError.message || String(auditError)
      };
    }

    const data = {
      ...carneSige,
      auditoriaMongo,
      arquitetura: {
        fonteOficialParcelas: 'SIGE',
        fonteOficialSaldo: 'SIGE',
        fonteOficialPagamentos: 'SIGE',
        mongoDb: ['clientes complementares', 'recibos emitidos', 'WhatsApp', 'logs', 'auditoria']
      }
    };

    if (!Array.isArray(data.grupos) || !data.grupos.length) {
      const existente = existenteInformado ||
        await FinanceiroCarneDigital.findOne({
          $or: [
            ...(cleanPhone(q) ? [{ 'cliente.cpf': cleanPhone(q) }] : []),
            ...(String(q || '').trim() ? [{ 'cliente.nome': new RegExp(`^${escapeRegex(String(q).trim())}$`, 'i') }] : [])
          ]
        });

      if (existente && Array.isArray(existente.parcelas) && existente.parcelas.length) {
        existente.parcelas = normalizarIdentificacaoParcelas(existente.parcelas);
        existente.grupos = Array.isArray(existente.grupos) ? existente.grupos.map((grupo) => ({
          ...grupo,
          parcelas: normalizarIdentificacaoParcelas(grupo.parcelas || [])
        })) : [];
        existente.snapshot = {
          ...(existente.snapshot || {}),
          ultimaTentativaSincronizacaoEm: new Date(),
          ultimaTentativaSincronizacaoOk: false,
          ultimaTentativaSincronizacaoErro: 'SIGE não retornou parcelas; dados existentes foram preservados.',
          diagnosticoConsulta: data.diagnosticoConsulta || null
        };
        existente.historico = Array.isArray(existente.historico) ? existente.historico : [];
        existente.historico.push({
          tipo: 'SINCRONIZACAO_PRESERVADA',
          em: new Date(),
          por: getFinanceiroActor(req),
          motivo: 'SIGE não retornou parcelas; snapshot anterior preservado.',
          diagnosticoConsulta: data.diagnosticoConsulta || null
        });
        if (existente.historico.length > 100) existente.historico = existente.historico.slice(-100);
        await existente.save();

        await registrarAuditoriaFinanceira({
          req,
          acao: 'CARNE_SINCRONIZACAO_PRESERVADA',
          entidade: 'FinanceiroCarneDigital',
          entidadeId: String(existente._id),
          codigo: existente.codigo,
          depois: existente.resumo || {},
          metadata: {
            motivo: 'SIGE_SEM_PARCELAS',
            diagnosticoConsulta: data.diagnosticoConsulta || null
          },
          sucesso: true
        });

        return {
          ok: true,
          preservado: true,
          atualizado: false,
          warning: 'O SIGE não retornou parcelas nesta tentativa. As parcelas já salvas foram preservadas.',
          diagnosticoConsulta: data.diagnosticoConsulta || null,
          carne: normalizeCarneDigital(existente)
        };
      }

      const error = new Error('Nenhuma parcela foi encontrada no SIGE para este cliente.');
      error.statusCode = 404;
      error.diagnosticoConsulta = data.diagnosticoConsulta || null;
      throw error;
    }

    data.parcelas = normalizarIdentificacaoParcelas(data.parcelas || []);
    data.grupos = (Array.isArray(data.grupos) ? data.grupos : []).map((grupo) => ({
      ...grupo,
      parcelas: normalizarIdentificacaoParcelas(grupo.parcelas || [])
    }));

    const uniqueKey = buildCarneUniqueKey(data);
    if (!uniqueKey || uniqueKey.endsWith(':')) {
      const error = new Error('Não foi possível identificar o cliente para salvar o carnê.');
      error.statusCode = 422;
      throw error;
    }

    const agora = new Date();
    const usuario = String(req.admin?.email || req.auth?.email || req.user?.email || 'admin');
    let existente = await FinanceiroCarneDigital.findOne({ uniqueKey });
    let criadoAgora = !existente;

    if (!existente) {
      let codigo = createCarneCode();
      while (await FinanceiroCarneDigital.exists({ codigo })) codigo = createCarneCode();

      existente = new FinanceiroCarneDigital({
        codigo,
        uniqueKey,
        fonte: 'sige',
        status: 'ATIVO',
        criadoPor: usuario,
        historico: []
      });
    }

    let resumoAnterior = existente.resumo || {};
    existente.cliente = {
      nome: String(data.cliente || ''),
      nomeNormalizado: normalizeCarneIdentity(data.cliente || ''),
      cpf: cleanPhone(data.cpf || ''),
      telefone: normalizePhone(data.telefone || '', '55'),
      cidade: String(data.cidade || ''),
      uf: String(data.uf || '')
    };
    existente.resumo = data.resumo || {};
    existente.grupos = Array.isArray(data.grupos) ? data.grupos : [];
    existente.parcelas = Array.isArray(data.parcelas) ? data.parcelas : [];
    existente.snapshot = {
      fonteFinanceira: data.fonteFinanceira || 'sige',
      fonte: data.fonte || 'lancamentos_sige',
      total: Number(data.total || 0),
      arquitetura: data.arquitetura || {},
      auditoriaMongo: data.auditoriaMongo || null
    };
    existente.ultimaSincronizacaoEm = agora;
    existente.ultimaSincronizacaoPor = usuario;
    existente.historico = Array.isArray(existente.historico) ? existente.historico : [];
    existente.historico.push({
      tipo: criadoAgora ? 'CRIADO' : 'SINCRONIZADO',
      em: agora,
      por: usuario,
      resumoAnterior,
      resumoAtual: data.resumo || {}
    });
    if (existente.historico.length > 100) {
      existente.historico = existente.historico.slice(-100);
    }

    try {
      await existente.save();
    } catch (saveError) {
      const duplicateUniqueKey =
        Number(saveError?.code || 0) === 11000 &&
        (
          String(saveError?.message || '').includes('uniqueKey_1') ||
          saveError?.keyPattern?.uniqueKey ||
          saveError?.keyValue?.uniqueKey
        );

      if (!duplicateUniqueKey) throw saveError;

      // Duas sincronizações podem chegar quase ao mesmo tempo.
      // O índice uniqueKey protege contra duplicidade; neste caso,
      // recuperamos o registro que venceu a corrida e o atualizamos.
      existente = await FinanceiroCarneDigital.findOne({ uniqueKey });
      if (!existente) throw saveError;

      criadoAgora = false;
      resumoAnterior = existente.resumo || {};

      existente.cliente = {
        nome: String(data.cliente || ''),
        nomeNormalizado: normalizeCarneIdentity(data.cliente || ''),
        cpf: cleanPhone(data.cpf || ''),
        telefone: normalizePhone(data.telefone || '', '55'),
        cidade: String(data.cidade || ''),
        uf: String(data.uf || '')
      };
      existente.resumo = data.resumo || {};
      existente.grupos = Array.isArray(data.grupos) ? data.grupos : [];
      existente.parcelas = Array.isArray(data.parcelas) ? data.parcelas : [];
      existente.snapshot = {
        fonteFinanceira: data.fonteFinanceira || 'sige',
        fonte: data.fonte || 'lancamentos_sige',
        total: Number(data.total || 0),
        arquitetura: data.arquitetura || {},
        auditoriaMongo: data.auditoriaMongo || null
      };
      existente.ultimaSincronizacaoEm = agora;
      existente.ultimaSincronizacaoPor = usuario;
      existente.historico = Array.isArray(existente.historico) ? existente.historico : [];
      existente.historico.push({
        tipo: 'SINCRONIZADO',
        em: agora,
        por: usuario,
        resumoAnterior,
        resumoAtual: data.resumo || {},
        recuperadoDeConcorrencia: true
      });
      if (existente.historico.length > 100) {
        existente.historico = existente.historico.slice(-100);
      }

      await existente.save();
    }

    await registrarAuditoriaFinanceira({
      req,
      acao: criadoAgora ? 'CARNE_CRIADO' : 'CARNE_SINCRONIZADO',
      entidade: 'FinanceiroCarneDigital',
      entidadeId: String(existente._id),
      codigo: existente.codigo,
      antes: resumoAnterior,
      depois: existente.resumo,
      metadata: { fonte: 'sige', uniqueKey }
    });
    return {
      ok: true,
      criadoAgora,
      atualizado: !criadoAgora,
      message: criadoAgora
        ? 'Carnê digital criado e salvo com sucesso.'
        : 'O mesmo carnê foi atualizado com os valores atuais do SIGE.',
      carne: normalizeCarneDigital(existente)
    };
  }

  app.get('/api/admin/sige/carne', adminRequired, async (req, res) => {
    try {
      const q = String(req.query.cliente || req.query.q || '').trim();
      const carne = await getSigeCarneData(q, {
        limit: req.query.limit || 5000,
        maxRecords: req.query.maxRecords || 20000
      });
      return res.json(carne);
    } catch (error) {
      console.error('Erro SIGE carnê:', error.message || error);
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao gerar carnê digital no SIGE' });
    }
  });

  // FASE A - Endpoint financeiro canônico.
  // O SIGE é a única fonte de parcelas, saldo, vencimentos e situação de pagamento.
  // O MongoDB é consultado somente para enriquecer a resposta com histórico/auditoria.
  app.get('/api/admin/financeiro/carne', adminRequired, async (req, res) => {
    try {
      const q = String(req.query.cliente || req.query.q || '').trim();
      const data = await getUnifiedFinancialData(q, {
        limit: req.query.limit || 5000,
        maxRecords: req.query.maxRecords || 20000
      });
      return res.json(data);
    } catch (error) {
      console.error('Erro financeiro unificado:', error.message || error);
      return res.status(error.statusCode || 500).json({
        ok: false,
        error: error.message || 'Erro ao consultar dados financeiros oficiais no SIGE',
        fonteFinanceira: 'sige'
      });
    }
  });



  // Cria o carnê na primeira vez e atualiza o mesmo registro nas próximas.
  app.post('/api/admin/financeiro/carnes/sincronizar', adminRequired, async (req, res) => {
    try {
      const q = String(req.body?.cliente || req.body?.q || '').trim();
      const result = await sincronizarCarneDigitalSige(q, req, {
        limit: req.body?.limit || 5000,
        maxRecords: req.body?.maxRecords || 20000
      });
      return res.status(result.criadoAgora ? 201 : 200).json(result);
    } catch (error) {
      console.error('[financeiro carnê digital sincronizar]', error.message || error);
      return res.status(error.statusCode || 500).json({
        ok: false,
        error: error.message || 'Erro ao criar ou atualizar o carnê digital.'
      });
    }
  });

  app.get('/api/admin/financeiro/carnes', adminRequired, async (req, res) => {
    try {
      const q = String(req.query.q || '').trim();
      const status = String(req.query.status || '').trim().toUpperCase();
      const situacao = String(req.query.situacao || '').trim().toUpperCase();
      const dataInicio = String(req.query.dataInicio || '').trim();
      const dataFim = String(req.query.dataFim || '').trim();
      const sort = String(req.query.sort || 'ultimaSincronizacaoEm').trim();
      const direction = String(req.query.direction || 'desc').toLowerCase() === 'asc' ? 1 : -1;
      const page = Math.max(1, Number(req.query.page || 1));
      const limit = Math.max(1, Math.min(Number(req.query.limit || 30), 100));
      const filter = {};

      if (status) filter.status = status;

      if (situacao === 'QUITADO') {
        filter['resumo.saldo'] = { $lte: 0.009 };
      } else if (situacao === 'ATRASADO') {
        filter['resumo.atrasadas'] = { $gt: 0 };
        filter['resumo.saldo'] = { $gt: 0.009 };
      } else if (situacao === 'EM_ABERTO') {
        filter['resumo.saldo'] = { $gt: 0.009 };
        filter['resumo.atrasadas'] = { $lte: 0 };
      }

      if (dataInicio || dataFim) {
        filter.ultimaSincronizacaoEm = {};
        if (dataInicio) {
          const inicio = new Date(`${dataInicio.slice(0, 10)}T00:00:00`);
          if (!Number.isNaN(inicio.getTime())) filter.ultimaSincronizacaoEm.$gte = inicio;
        }
        if (dataFim) {
          const fim = new Date(`${dataFim.slice(0, 10)}T23:59:59.999`);
          if (!Number.isNaN(fim.getTime())) filter.ultimaSincronizacaoEm.$lte = fim;
        }
        if (!Object.keys(filter.ultimaSincronizacaoEm).length) delete filter.ultimaSincronizacaoEm;
      }

      if (q) {
        const escaped = escapeRegex(q);
        const digits = cleanPhone(q);
        filter.$or = [
          { codigo: new RegExp(escaped, 'i') },
          { 'cliente.nome': new RegExp(escaped, 'i') },
          { 'grupos.documento': new RegExp(escaped, 'i') },
          { 'grupos.descricao': new RegExp(escaped, 'i') }
        ];
        if (digits) {
          filter.$or.push({ 'cliente.cpf': new RegExp(escapeRegex(digits), 'i') });
          filter.$or.push({ 'cliente.telefone': new RegExp(escapeRegex(digits), 'i') });
          filter.$or.push({ 'grupos.codigoVenda': Number(digits) || -1 });
          filter.$or.push({ 'grupos.codigoContrato': Number(digits) || -1 });
        }
      }

      const allowedSorts = new Set([
        'ultimaSincronizacaoEm',
        'createdAt',
        'updatedAt',
        'cliente.nome',
        'resumo.saldo',
        'resumo.atrasadas',
        'resumo.pagas'
      ]);
      const sortField = allowedSorts.has(sort) ? sort : 'ultimaSincronizacaoEm';
      const sortSpec = { [sortField]: direction, _id: -1 };

      const summaryPipeline = [
        { $match: filter },
        {
          $group: {
            _id: null,
            totalCarnes: { $sum: 1 },
            saldoTotal: { $sum: { $ifNull: ['$resumo.saldo', 0] } },
            totalParcelas: { $sum: { $ifNull: ['$resumo.parcelas', 0] } },
            totalPagas: { $sum: { $ifNull: ['$resumo.pagas', 0] } },
            totalAbertas: { $sum: { $ifNull: ['$resumo.abertas', 0] } },
            totalAtrasadas: { $sum: { $ifNull: ['$resumo.atrasadas', 0] } },
            quitados: {
              $sum: { $cond: [{ $lte: [{ $ifNull: ['$resumo.saldo', 0] }, 0.009] }, 1, 0] }
            },
            comAtraso: {
              $sum: { $cond: [{ $gt: [{ $ifNull: ['$resumo.atrasadas', 0] }, 0] }, 1, 0] }
            }
          }
        }
      ];

      const [rows, total, summaryRows] = await Promise.all([
        FinanceiroCarneDigital.find(filter)
          .sort(sortSpec)
          .skip((page - 1) * limit)
          .limit(limit),
        FinanceiroCarneDigital.countDocuments(filter),
        FinanceiroCarneDigital.aggregate(summaryPipeline)
      ]);

      const rawSummary = summaryRows[0] || {};
      const resumo = {
        totalCarnes: Number(rawSummary.totalCarnes || 0),
        saldoTotal: Number(Number(rawSummary.saldoTotal || 0).toFixed(2)),
        totalParcelas: Number(rawSummary.totalParcelas || 0),
        totalPagas: Number(rawSummary.totalPagas || 0),
        totalAbertas: Number(rawSummary.totalAbertas || 0),
        totalAtrasadas: Number(rawSummary.totalAtrasadas || 0),
        quitados: Number(rawSummary.quitados || 0),
        comAtraso: Number(rawSummary.comAtraso || 0)
      };

      return res.json({
        ok: true,
        carnes: rows.map(normalizeCarneDigital),
        total,
        page,
        limit,
        pages: Math.max(1, Math.ceil(total / limit)),
        resumo,
        filtros: { q, status, situacao, dataInicio, dataFim, sort: sortField, direction: direction === 1 ? 'asc' : 'desc' }
      });
    } catch (error) {
      console.error('[financeiro carnês pesquisar]', error.message || error);
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao pesquisar carnês digitais.' });
    }
  });


  app.get('/api/admin/financeiro/carnes/codigo/:codigo', adminRequired, async (req, res) => {
    try {
      const codigo = String(req.params.codigo || '').trim();
      const row = await FinanceiroCarneDigital.findOne({ codigo: new RegExp(`^${escapeRegex(codigo)}$`, 'i') });
      if (!row) return res.status(404).json({ ok: false, error: 'Carnê digital não encontrado por este código.' });
      return res.json({ ok: true, carne: normalizeCarneDigital(row) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao localizar o carnê pelo código.' });
    }
  });

  app.get('/api/admin/financeiro/carnes/:id', adminRequired, async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      const filter = mongoose.Types.ObjectId.isValid(id)
        ? { _id: new mongoose.Types.ObjectId(id) }
        : { codigo: id };
      const row = await FinanceiroCarneDigital.findOne(filter);
      if (!row) return res.status(404).json({ ok: false, error: 'Carnê digital não encontrado.' });
      return res.json({ ok: true, carne: normalizeCarneDigital(row) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao abrir o carnê digital.' });
    }
  });

  app.post('/api/admin/financeiro/carnes/:id/sincronizar', adminRequired, async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      const filter = mongoose.Types.ObjectId.isValid(id)
        ? { _id: new mongoose.Types.ObjectId(id) }
        : { codigo: id };
      const existente = await FinanceiroCarneDigital.findOne(filter);
      if (!existente) return res.status(404).json({ ok: false, error: 'Carnê digital não encontrado.' });

      const termo = String(
        req.body?.cliente ||
        existente.cliente?.nome ||
        existente.cliente?.cpf ||
        existente.cliente?.telefone ||
        ''
      ).trim();

      const result = await sincronizarCarneDigitalSige(termo, req, {
        limit: req.body?.limit || 5000,
        maxRecords: req.body?.maxRecords || 20000,
        existingCarne: existente,
        termos: [
          existente.cliente?.cpf,
          existente.cliente?.nome,
          existente.cliente?.telefone
        ]
      });
      return res.json(result);
    } catch (error) {
      console.error('[financeiro carnê digital atualizar]', error.message || error);
      return res.status(error.statusCode || 500).json({
        ok: false,
        error: error.message || 'Erro ao atualizar o carnê digital.'
      });
    }
  });

  app.get('/api/admin/financeiro/clientes', adminRequired, async (req, res) => {
    try {
      const q = String(req.query.q || req.query.nome || '').trim();
      const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 200));
      const pessoas = await getSigePessoasByQuery(q, limit);
      return res.json({
        ok: true,
        clientes: pessoas,
        total: pessoas.length,
        fonte: 'sige',
        fonteFinanceira: 'sige',
        estadoFinanceiroSomenteLeitura: true
      });
    } catch (error) {
      console.error('Erro financeiro clientes SIGE:', error.message || error);
      return res.status(error.statusCode || 500).json({
        ok: false,
        error: error.message || 'Erro ao consultar clientes financeiros no SIGE',
        fonteFinanceira: 'sige'
      });
    }
  });


  function getSyncUser(req = {}) {
    return String(req.admin?.email || req.auth?.email || req.user?.email || 'admin');
  }

  async function executarSincronizacaoCarnesSige({
    req,
    somenteDesatualizados = true,
    minutosDesatualizado = 60,
    limite = 100,
    ids = []
  } = {}) {
    const agora = new Date();
    const cutoff = new Date(agora.getTime() - Math.max(1, Number(minutosDesatualizado || 60)) * 60000);
    const filter = { status: 'ATIVO' };

    if (Array.isArray(ids) && ids.length) {
      const objectIds = ids
        .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
        .map((id) => new mongoose.Types.ObjectId(String(id)));
      filter._id = { $in: objectIds };
    } else if (somenteDesatualizados) {
      filter.$or = [
        { ultimaSincronizacaoEm: { $lt: cutoff } },
        { ultimaSincronizacaoEm: null },
        { ultimaSincronizacaoEm: { $exists: false } }
      ];
    }

    const rows = await FinanceiroCarneDigital.find(filter)
      .sort({ ultimaSincronizacaoEm: 1, updatedAt: 1 })
      .limit(Math.max(1, Math.min(Number(limite || 100), 500)));

    const log = await FinanceiroSincronizacaoLog.create({
      origem: 'sige',
      tipo: ids?.length ? 'SELECIONADOS' : (somenteDesatualizados ? 'DESATUALIZADOS' : 'TODOS'),
      status: 'PROCESSANDO',
      iniciadoEm: agora,
      solicitadoPor: getSyncUser(req),
      totalSelecionado: rows.length,
      parametros: { somenteDesatualizados, minutosDesatualizado, limite, ids: ids || [] }
    });

    const resultados = [];
    let atualizados = 0;
    let erros = 0;
    let ignorados = 0;

    for (const row of rows) {
      try {
        const termo = String(
          row.cliente?.nome ||
          row.cliente?.cpf ||
          row.cliente?.telefone ||
          ''
        ).trim();

        if (!termo) {
          ignorados += 1;
          resultados.push({
            id: String(row._id),
            codigo: row.codigo,
            ok: false,
            ignorado: true,
            motivo: 'Carnê sem CPF, nome ou telefone para consultar o SIGE.'
          });
          continue;
        }

        const result = await sincronizarCarneDigitalSige(termo, req, {
          limit: 5000,
          maxRecords: 20000,
          existingCarne: row,
          termos: [
            row.cliente?.cpf,
            row.cliente?.nome,
            row.cliente?.telefone
          ]
        });

        if (result.preservado) ignorados += 1;
        else atualizados += 1;

        resultados.push({
          id: String(row._id),
          codigo: row.codigo,
          cliente: row.cliente?.nome || '',
          ok: true,
          preservado: result.preservado === true,
          warning: result.warning || '',
          saldo: result.carne?.resumo?.saldo || 0,
          atrasadas: result.carne?.resumo?.atrasadas || 0,
          diagnosticoConsulta: result.diagnosticoConsulta || null
        });
      } catch (error) {
        erros += 1;
        resultados.push({
          id: String(row._id),
          codigo: row.codigo,
          cliente: row.cliente?.nome || '',
          ok: false,
          error: error.message || String(error)
        });
      }
    }

    log.status = erros > 0 && atualizados === 0 ? 'FALHOU' : (erros > 0 ? 'CONCLUIDO_COM_ERROS' : 'CONCLUIDO');
    log.concluidoEm = new Date();
    log.processados = resultados.length;
    log.atualizados = atualizados;
    log.ignorados = ignorados;
    log.erros = erros;
    log.resultados = resultados.slice(0, 500);
    await log.save();

    return {
      ok: true,
      sincronizacaoId: String(log._id),
      status: log.status,
      totalSelecionado: rows.length,
      processados: resultados.length,
      atualizados,
      ignorados,
      erros,
      resultados
    };
  }



  function extrairTelefoneFinanceiro(value = null, depth = 0) {
    if (depth > 5 || value === null || value === undefined) return '';

    if (typeof value === 'string' || typeof value === 'number') {
      const phone = normalizePhone(value, '55');
      return phone.length >= 12 && phone.length <= 13 ? phone : '';
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        const phone = extrairTelefoneFinanceiro(item, depth + 1);
        if (phone) return phone;
      }
      return '';
    }

    if (typeof value === 'object') {
      const preferredKeys = [
        'telefone','celular','phone','mobile','whatsapp','fone',
        'telefone1','telefone2','celular1','celular2','phoneNumber','numeroWhatsapp'
      ];

      for (const key of preferredKeys) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          const phone = extrairTelefoneFinanceiro(value[key], depth + 1);
          if (phone) return phone;
        }
      }

      for (const [key, nested] of Object.entries(value)) {
        if (/telefone|celular|phone|mobile|whatsapp|fone/i.test(key)) {
          const phone = extrairTelefoneFinanceiro(nested, depth + 1);
          if (phone) return phone;
        }
      }
    }

    return '';
  }

  function buildFinanceiroCustomerQueries(carne = {}) {
    const cliente = carne.cliente || {};
    const cpf = cleanPhone(cliente.cpf || '');
    const nome = String(cliente.nome || '').trim();

    return {
      cpf,
      nome,
      nomeNormalizado: normalizeSearch(nome),
      telefoneAtual: normalizePhone(cliente.telefone || '', '55')
    };
  }

  async function buscarTelefoneNoSigeFinanceiro({ cpf = '', nome = '' } = {}) {
    if (typeof getSigePessoasByQuery !== 'function') {
      return { telefone: '', fonte: '', detalhes: 'getSigePessoasByQuery_indisponivel' };
    }

    const tentativas = [cpf, nome].map((value) => String(value || '').trim()).filter(Boolean);

    for (const query of tentativas) {
      try {
        const response = await getSigePessoasByQuery(query);
        const rows = Array.isArray(response)
          ? response
          : (Array.isArray(response?.data) ? response.data
            : (Array.isArray(response?.rows) ? response.rows
              : (Array.isArray(response?.items) ? response.items : [])));

        for (const row of rows) {
          const phone = extrairTelefoneFinanceiro(row);
          if (phone) {
            return {
              telefone: phone,
              fonte: 'sige_pessoas',
              detalhes: { query, pessoa: redact(row) }
            };
          }
        }
      } catch (error) {
        console.warn('[financeiro telefone SIGE]', query, error.message || error);
      }
    }

    return { telefone: '', fonte: '', detalhes: 'nao_encontrado_no_sige' };
  }

  async function buscarTelefoneLocalFinanceiro({ cpf = '', nome = '' } = {}) {
    const candidates = [];

    if (CrediarioCliente) {
      const filter = { $or: [] };
      if (cpf) {
        filter.$or.push(
          { cpf },
          { documento: cpf },
          { cpfCnpj: cpf },
          { 'cliente.cpf': cpf }
        );
      }
      if (nome) {
        filter.$or.push(
          { nome: new RegExp(`^${escapeRegex(nome)}$`, 'i') },
          { clienteNome: new RegExp(`^${escapeRegex(nome)}$`, 'i') },
          { 'cliente.nome': new RegExp(`^${escapeRegex(nome)}$`, 'i') }
        );
      }

      if (filter.$or.length) {
        try {
          const row = await CrediarioCliente.findOne(filter).lean();
          if (row) candidates.push({ fonte: 'crediario_clientes', row });
        } catch (error) {
          console.warn('[financeiro telefone crediario]', error.message || error);
        }
      }
    }

    if (Order) {
      const filter = { $or: [] };
      if (cpf) {
        filter.$or.push(
          { customerCpf: cpf },
          { clienteCpf: cpf },
          { cpfCliente: cpf },
          { 'customer.cpf': cpf },
          { 'cliente.cpf': cpf },
          { 'billingAddress.cpf': cpf },
          { 'shippingAddress.cpf': cpf }
        );
      }
      if (nome) {
        filter.$or.push(
          { customerName: new RegExp(`^${escapeRegex(nome)}$`, 'i') },
          { clienteNome: new RegExp(`^${escapeRegex(nome)}$`, 'i') },
          { 'customer.name': new RegExp(`^${escapeRegex(nome)}$`, 'i') },
          { 'cliente.nome': new RegExp(`^${escapeRegex(nome)}$`, 'i') }
        );
      }

      if (filter.$or.length) {
        try {
          const row = await Order.findOne(filter).sort({ createdAt: -1 }).lean();
          if (row) candidates.push({ fonte: 'pedidos', row });
        } catch (error) {
          console.warn('[financeiro telefone pedidos]', error.message || error);
        }
      }
    }

    for (const candidate of candidates) {
      const phone = extrairTelefoneFinanceiro(candidate.row);
      if (phone) {
        return {
          telefone: phone,
          fonte: candidate.fonte,
          detalhes: redact(candidate.row)
        };
      }
    }

    return { telefone: '', fonte: '', detalhes: 'nao_encontrado_localmente' };
  }

  async function propagarTelefoneFinanceiro({
    carne,
    telefone,
    fonte = '',
    req = {}
  } = {}) {
    const normalized = normalizePhone(telefone || '', '55');
    if (!carne || !normalized) return { atualizado: false, telefone: '' };

    const antes = String(carne.cliente?.telefone || '');
    carne.cliente = carne.cliente || {};
    carne.cliente.telefone = normalized;
    carne.historico = Array.isArray(carne.historico) ? carne.historico : [];
    carne.historico.push({
      tipo: 'TELEFONE_RECUPERADO',
      em: new Date(),
      por: getFinanceiroActor(req),
      fonte,
      telefoneAnterior: antes,
      telefoneAtual: normalized
    });
    if (carne.historico.length > 100) carne.historico = carne.historico.slice(-100);
    await carne.save();

    const carneId = carne._id;
    const cpf = cleanPhone(carne.cliente?.cpf || '');
    const nome = String(carne.cliente?.nome || '');
    const riskOr = [{ customerKey: buildCarneUniqueKey({ cpf, telefone: normalized, cliente: nome }) }];
    if (cpf) riskOr.push({ clienteCpf: cpf });
    if (nome) riskOr.push({ clienteNome: new RegExp(`^${escapeRegex(nome)}$`, 'i') });

    await Promise.all([
      FinanceiroFilaCobranca.updateMany({ carneId }, { $set: { telefone: normalized, semContato: false } }),
      FinanceiroPromessaPagamento.updateMany({ carneId }, { $set: { telefone: normalized } }),
      FinanceiroTratativa.updateMany({ carneId }, { $set: { telefone: normalized } }),
      FinanceiroRiscoCliente.updateMany({ $or: riskOr }, { $set: { telefone: normalized } })
    ]);

    await registrarAuditoriaFinanceira({
      req,
      acao: 'TELEFONE_FINANCEIRO_RECUPERADO',
      entidade: 'FinanceiroCarneDigital',
      entidadeId: String(carne._id),
      codigo: carne.codigo || '',
      antes: { telefone: antes },
      depois: { telefone: normalized },
      metadata: { fonte }
    });

    return {
      atualizado: antes !== normalized,
      telefone: normalized,
      fonte
    };
  }

  async function recuperarTelefoneCarneFinanceiro({ carne, req = {}, force = false } = {}) {
    if (!carne) return { ok: false, reason: 'carne_nao_informado' };

    const dados = buildFinanceiroCustomerQueries(carne);
    if (dados.telefoneAtual && !force) {
      return {
        ok: true,
        encontrado: true,
        atualizado: false,
        telefone: dados.telefoneAtual,
        fonte: 'carne_digital'
      };
    }

    const local = await buscarTelefoneLocalFinanceiro(dados);
    if (local.telefone) {
      const propagated = await propagarTelefoneFinanceiro({
        carne,
        telefone: local.telefone,
        fonte: local.fonte,
        req
      });
      return { ok: true, encontrado: true, ...propagated };
    }

    const sige = await buscarTelefoneNoSigeFinanceiro(dados);
    if (sige.telefone) {
      const propagated = await propagarTelefoneFinanceiro({
        carne,
        telefone: sige.telefone,
        fonte: sige.fonte,
        req
      });
      return { ok: true, encontrado: true, ...propagated };
    }

    return {
      ok: true,
      encontrado: false,
      atualizado: false,
      telefone: '',
      reason: 'telefone_nao_encontrado',
      fontesConsultadas: ['carne_digital', 'crediario_clientes', 'pedidos', 'sige_pessoas']
    };
  }

  async function recuperarTelefonesFinanceiros({
    req = {},
    limite = 500,
    force = false,
    carneIds = []
  } = {}) {
    const filter = { status: 'ATIVO' };
    const ids = Array.isArray(carneIds) ? carneIds.map(normalizeObjectId).filter(Boolean) : [];

    if (ids.length) filter._id = { $in: ids };
    else if (!force) {
      filter.$or = [
        { 'cliente.telefone': { $exists: false } },
        { 'cliente.telefone': '' },
        { 'cliente.telefone': null }
      ];
    }

    const rows = await FinanceiroCarneDigital.find(filter)
      .sort({ updatedAt: 1 })
      .limit(Math.max(1, Math.min(Number(limite || 500), 5000)));

    const resultados = [];
    let encontrados = 0;
    let atualizados = 0;
    let naoEncontrados = 0;
    let erros = 0;

    for (const carne of rows) {
      try {
        const result = await recuperarTelefoneCarneFinanceiro({ carne, req, force });
        if (result.encontrado) encontrados += 1;
        if (result.atualizado) atualizados += 1;
        if (!result.encontrado) naoEncontrados += 1;

        resultados.push({
          ok: true,
          carneId: String(carne._id),
          carneCodigo: carne.codigo,
          clienteNome: carne.cliente?.nome || '',
          ...result
        });
      } catch (error) {
        erros += 1;
        resultados.push({
          ok: false,
          carneId: String(carne._id),
          carneCodigo: carne.codigo,
          clienteNome: carne.cliente?.nome || '',
          error: error.message || String(error)
        });
      }
    }

    return { ok: true, selecionados: rows.length, encontrados, atualizados, naoEncontrados, erros, resultados };
  }




  function getFinanceiroReleaseConfig() {
    return {
      ambiente: String(process.env.NODE_ENV || 'development').trim().toLowerCase(),
      deployLiberado: ['1', 'true', 'yes', 'on'].includes(
        String(process.env.FINANCEIRO_RELEASE_ENABLED || 'false').trim().toLowerCase()
      ),
      webhookRealLiberado: ['1', 'true', 'yes', 'on'].includes(
        String(process.env.FINANCEIRO_WHATSAPP_REAL_WEBHOOK_ENABLED || 'false').trim().toLowerCase()
      ),
      reguaRealLiberada: ['1', 'true', 'yes', 'on'].includes(
        String(process.env.FINANCEIRO_REGUA_WHATSAPP_ENABLED || 'false').trim().toLowerCase()
      ),
      exigirHttps: !['0', 'false', 'no', 'off'].includes(
        String(process.env.FINANCEIRO_RELEASE_REQUIRE_HTTPS || 'true').trim().toLowerCase()
      )
    };
  }

  function releaseCheckItem({
    id,
    titulo,
    ok,
    bloqueante = true,
    detalhe = '',
    acao = ''
  }) {
    return {
      id,
      titulo,
      ok: Boolean(ok),
      status: ok ? 'OK' : (bloqueante ? 'BLOQUEIO' : 'AVISO'),
      bloqueante: Boolean(bloqueante),
      detalhe,
      acao
    };
  }

  async function executarChecklistReleaseFinanceiro({ req = {} } = {}) {
    const release = getFinanceiroReleaseConfig();
    const webhookUrl = getFinanceiroWhatsappWebhookPublicUrl();
    const webhookToken = String(process.env.FINANCEIRO_WHATSAPP_WEBHOOK_TOKEN || '').trim();
    const items = [];

    items.push(releaseCheckItem({
      id: 'mongo',
      titulo: 'MongoDB conectado',
      ok: mongoose.connection.readyState === 1,
      detalhe: `readyState=${mongoose.connection.readyState}`,
      acao: 'Inicie o backend e confirme a conexão com o MongoDB.'
    }));

    items.push(releaseCheckItem({
      id: 'webhook_url',
      titulo: 'URL pública do webhook configurada',
      ok: Boolean(webhookUrl),
      detalhe: webhookUrl || 'Variável ausente.',
      acao: 'Configure FINANCEIRO_WHATSAPP_WEBHOOK_PUBLIC_URL.'
    }));

    const httpsOk = !release.exigirHttps || /^https:\/\//i.test(webhookUrl || '');
    items.push(releaseCheckItem({
      id: 'webhook_https',
      titulo: 'Webhook usa HTTPS',
      ok: httpsOk,
      detalhe: webhookUrl || 'URL não configurada.',
      acao: 'Use uma URL pública HTTPS.'
    }));

    items.push(releaseCheckItem({
      id: 'webhook_token',
      titulo: 'Token do webhook configurado',
      ok: webhookToken.length >= 20,
      detalhe: webhookToken ? `Token com ${webhookToken.length} caracteres.` : 'Token ausente.',
      acao: 'Defina FINANCEIRO_WHATSAPP_WEBHOOK_TOKEN com pelo menos 20 caracteres.'
    }));

    let whatsappOk = false;
    let whatsappDetalhe = '';
    try {
      const cfg = await getWhatsappSettings();
      whatsappOk = Boolean(cfg.apiUrl && cfg.apiKey && cfg.instanceName);
      whatsappDetalhe = whatsappOk
        ? `Instância ${cfg.instanceName} configurada.`
        : 'Configuração da Evolution API incompleta.';
    } catch (error) {
      whatsappDetalhe = error.message || String(error);
    }

    items.push(releaseCheckItem({
      id: 'evolution_config',
      titulo: 'Evolution API configurada',
      ok: whatsappOk,
      detalhe: whatsappDetalhe,
      acao: 'Confira URL, API key e nome da instância.'
    }));

    let webhookProviderOk = false;
    let webhookProviderDetalhe = 'Consulta não executada.';
    try {
      const provider = await consultarWebhookEvolutionFinanceiro();
      webhookProviderOk = Boolean(provider?.ok);
      webhookProviderDetalhe = webhookProviderOk
        ? `Evolution respondeu HTTP ${provider.status}.`
        : 'Evolution não respondeu corretamente.';
    } catch (error) {
      webhookProviderDetalhe = error.message || String(error);
    }

    items.push(releaseCheckItem({
      id: 'evolution_online',
      titulo: 'Evolution API acessível',
      ok: webhookProviderOk,
      bloqueante: false,
      detalhe: webhookProviderDetalhe,
      acao: 'Confirme se a VPS e a instância Ariana_Notificacoes estão online.'
    }));

    const [carnes, logs, semTelefone] = await Promise.all([
      FinanceiroCarneDigital.countDocuments({ status: 'ATIVO' }),
      FinanceiroReguaWhatsappLog.countDocuments({}),
      FinanceiroCarneDigital.countDocuments({
        status: 'ATIVO',
        $or: [
          { 'cliente.telefone': { $exists: false } },
          { 'cliente.telefone': '' },
          { 'cliente.telefone': null }
        ]
      })
    ]);

    items.push(releaseCheckItem({
      id: 'carnes',
      titulo: 'Carteira financeira acessível',
      ok: carnes >= 0,
      detalhe: `${carnes} carnê(s) ativo(s).`,
      acao: 'Confira a coleção financeiro_carnes_digitais.'
    }));

    items.push(releaseCheckItem({
      id: 'telefones',
      titulo: 'Cobertura de telefones',
      ok: semTelefone === 0,
      bloqueante: false,
      detalhe: `${semTelefone} carnê(s) ativo(s) sem telefone.`,
      acao: 'Execute a recuperação de telefones antes de ativar a régua.'
    }));

    items.push(releaseCheckItem({
      id: 'historico_whatsapp',
      titulo: 'Histórico do WhatsApp acessível',
      ok: logs >= 0,
      detalhe: `${logs} registro(s) localizado(s).`,
      acao: 'Confira a coleção financeiro_regua_whatsapp_logs.'
    }));

    items.push(releaseCheckItem({
      id: 'release_flag',
      titulo: 'Liberação explícita para produção',
      ok: release.deployLiberado,
      detalhe: `FINANCEIRO_RELEASE_ENABLED=${release.deployLiberado}`,
      acao: 'Mantenha false durante a homologação. Altere para true somente no deploy aprovado.'
    }));

    const bloqueios = items.filter((item) => item.bloqueante && !item.ok);
    const avisos = items.filter((item) => !item.bloqueante && !item.ok);

    const homologacaoLocalOk = items
      .filter((item) => item.id !== 'release_flag')
      .every((item) => item.ok || !item.bloqueante);

    const prontoParaProducao = homologacaoLocalOk && release.deployLiberado;

    return {
      ok: true,
      ambiente: release.ambiente,
      homologacaoLocalOk,
      prontoParaProducao,
      liberacoes: release,
      resumo: {
        total: items.length,
        ok: items.filter((item) => item.ok).length,
        bloqueios: bloqueios.length,
        avisos: avisos.length
      },
      items,
      geradoEm: new Date().toISOString(),
      solicitadoPor: getFinanceiroActor(req)
    };
  }

  function getFinanceiroWhatsappWebhookPublicUrl() {
    const explicit = String(process.env.FINANCEIRO_WHATSAPP_WEBHOOK_PUBLIC_URL || '').trim();
    if (explicit) return explicit.replace(/\/+$/, '');

    const base = String(APP_BASE_URL || process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '');
    if (!base) return '';

    return `${base}/api/webhooks/financeiro/whatsapp/status`;
  }

  function getFinanceiroWhatsappWebhookEvents() {
    return ['MESSAGES_UPDATE', 'SEND_MESSAGE'];
  }

  async function consultarWebhookEvolutionFinanceiro() {
    const cfg = await getWhatsappSettings();
    if (!cfg.apiUrl || !cfg.apiKey || !cfg.instanceName) {
      const error = new Error('Configuração da Evolution API incompleta.');
      error.statusCode = 409;
      throw error;
    }

    const url = `${String(cfg.apiUrl).replace(/\/+$/, '')}/webhook/find/${encodeURIComponent(cfg.instanceName)}`;
    const response = await axios.get(url, {
      headers: { apikey: cfg.apiKey },
      timeout: 30000,
      validateStatus: () => true
    });

    if (response.status < 200 || response.status >= 300) {
      const error = new Error(
        response.data?.message
        || response.data?.error?.message
        || response.data?.error
        || `Evolution API HTTP ${response.status}`
      );
      error.statusCode = response.status;
      error.responseData = response.data;
      throw error;
    }

    return {
      ok: true,
      url,
      instanceName: cfg.instanceName,
      data: sanitizeFinanceiroWhatsappProviderData(response.data || null),
      status: response.status
    };
  }

  // FASE 19.0.3 - Proteção de segredos e dados pessoais nas respostas administrativas.
  function sanitizeFinanceiroWhatsappProviderData(data = null) {
    const sensitiveKey = /token|authorization|apikey|api[-_]?key|secret|password/i;
    const headerContainerKey = /^headers?$/i;

    function walk(value, parentKey = '') {
      if (value === null || value === undefined) return value;

      if (Array.isArray(value)) {
        return value.map((item) => walk(item, parentKey));
      }

      if (typeof value !== 'object') {
        if (sensitiveKey.test(parentKey)) {
          return value ? 'CONFIGURADO' : '';
        }
        return value;
      }

      const output = {};
      for (const [key, item] of Object.entries(value)) {
        if (headerContainerKey.test(key) && item && typeof item === 'object') {
          output[key] = {};
          for (const headerName of Object.keys(item)) {
            output[key][headerName] = item[headerName] ? 'CONFIGURADO' : '';
          }
          continue;
        }

        if (sensitiveKey.test(key)) {
          output[key] = item ? 'CONFIGURADO' : '';
          continue;
        }

        output[key] = walk(item, key);
      }

      return output;
    }

    return walk(redact(data));
  }
  function maskFinanceiroWhatsappPhone(value = '') {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    const final = digits.slice(-4);
    return `${'*'.repeat(Math.max(4, digits.length - 4))}${final}`;
  }

  function maskFinanceiroWhatsappName(value = '') {
    const words = String(value || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '';
    return `${words[0]} ${'*'.repeat(Math.max(3, words.slice(1).join(' ').length || 3))}`;
  }

  function sanitizeFinanceiroWhatsappMonitorRecord(row = {}) {
    const item = row && typeof row.toObject === 'function' ? row.toObject() : { ...(row || {}) };
    return {
      _id: item._id,
      origem: item.origem || '',
      tipoEvento: item.tipoEvento || '',
      dataReferencia: item.dataReferencia || '',
      carneId: item.carneId ? String(item.carneId) : '',
      carneCodigo: item.carneCodigo || '',
      documento: item.documento || '',
      clienteNome: maskFinanceiroWhatsappName(item.clienteNome),
      telefone: maskFinanceiroWhatsappPhone(item.telefone),
      parcelaLabel: item.parcelaLabel || '',
      diasAtraso: Number(item.diasAtraso || 0),
      valor: Number(item.valor || 0),
      dryRun: Boolean(item.dryRun),
      enviado: Boolean(item.enviado),
      enviadoEm: item.enviadoEm || null,
      deliveryStatus: item.deliveryStatus || 'UNKNOWN',
      deliveryStatusUpdatedAt: item.deliveryStatusUpdatedAt || null,
      sentAt: item.sentAt || null,
      deliveredAt: item.deliveredAt || null,
      readAt: item.readAt || null,
      retryCount: Number(item.retryCount || 0),
      erro: item.erro ? 'REGISTRADO' : '',
      ackHistory: Array.isArray(item.ackHistory)
        ? item.ackHistory.slice(-10).map((ack) => ({
            em: ack?.em || null,
            status: ack?.status || 'UNKNOWN',
            rawStatus: ack?.rawStatus || ''
          }))
        : []
    };
  }
  async function configurarWebhookEvolutionFinanceiro({
    req = {},
    enabled = true,
    webhookUrl = '',
    dryRun = false,
    confirmacao = ''
  } = {}) {
    const confirmacaoEsperada = 'RECONFIGURAR_WEBHOOK_FINANCEIRO';
    const confirmacaoRecebida = String(confirmacao || '').trim();

    if (!dryRun && confirmacaoRecebida !== confirmacaoEsperada) {
      const error = new Error("Confirmacao obrigatoria invalida para reconfigurar o webhook financeiro.");
      error.statusCode = 400;
      throw error;
    }
    const cfg = await getWhatsappSettings();
    if (!cfg.apiUrl || !cfg.apiKey || !cfg.instanceName) {
      const error = new Error('Configuração da Evolution API incompleta.');
      error.statusCode = 409;
      throw error;
    }

    const finalUrl = String(webhookUrl || getFinanceiroWhatsappWebhookPublicUrl()).trim();
    if (!finalUrl) {
      const error = new Error(
        'Configure FINANCEIRO_WHATSAPP_WEBHOOK_PUBLIC_URL com a URL pública do backend.'
      );
      error.statusCode = 409;
      throw error;
    }

    if (!/^https?:\/\//i.test(finalUrl)) {
      const error = new Error('A URL pública do webhook deve começar com http:// ou https://.');
      error.statusCode = 400;
      throw error;
    }

    const webhookToken = String(process.env.FINANCEIRO_WHATSAPP_WEBHOOK_TOKEN || '').trim();
    const payload = {
      enabled: Boolean(enabled),
      url: finalUrl,
      events: getFinanceiroWhatsappWebhookEvents(),
      headers: webhookToken
        ? { 'x-financeiro-webhook-token': webhookToken }
        : {},
      base64: false
    };

    const url = `${String(cfg.apiUrl).replace(/\/+$/, '')}/webhook/set/${encodeURIComponent(cfg.instanceName)}`;

    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        url,
        instanceName: cfg.instanceName,
        payload: {
          webhook: {
            ...payload,
            headers: webhookToken
              ? { 'x-financeiro-webhook-token': 'CONFIGURADO' }
              : {}
          }
        }
      };
    }

    const response = await axios.post(url, { webhook: payload }, {
      headers: {
        apikey: cfg.apiKey,
        'Content-Type': 'application/json'
      },
      timeout: 30000,
      validateStatus: () => true
    });

    if (response.status < 200 || response.status >= 300) {
      const error = new Error(
        response.data?.message
        || response.data?.error?.message
        || response.data?.error
        || `Evolution API HTTP ${response.status}`
      );
      error.statusCode = response.status;
      error.responseData = response.data;
      throw error;
    }

    await registrarAuditoriaFinanceira({
      req,
      acao: enabled
        ? 'WEBHOOK_EVOLUTION_FINANCEIRO_CONFIGURADO'
        : 'WEBHOOK_EVOLUTION_FINANCEIRO_DESATIVADO',
      entidade: 'EvolutionWebhook',
      entidadeId: cfg.instanceName,
      codigo: cfg.instanceName,
      depois: {
        enabled: Boolean(enabled),
        url: finalUrl,
        events: payload.events,
        tokenHeaderConfigured: Boolean(webhookToken),
        providerResponse: sanitizeFinanceiroWhatsappProviderData(response.data || null)
      }
    });

    return {
      ok: true,
      dryRun: false,
      url,
      instanceName: cfg.instanceName,
      webhookUrl: finalUrl,
      events: payload.events,
      tokenHeaderConfigured: Boolean(webhookToken),
      data: sanitizeFinanceiroWhatsappProviderData(response.data || null),
      status: response.status
    };
  }

  async function testarWebhookFinanceiroInterno({
    req = {},
    logId = '',
    status = 'DELIVERED'
  } = {}) {
    const normalizedStatus = normalizeWhatsappDeliveryStatus(status);
    if (!['SENT', 'DELIVERED', 'READ', 'FAILED'].includes(normalizedStatus)) {
      const error = new Error('Use SENT, DELIVERED, READ ou FAILED.');
      error.statusCode = 400;
      throw error;
    }

    const log = logId
      ? await FinanceiroReguaWhatsappLog.findById(logId)
      : await FinanceiroReguaWhatsappLog.findOne({
          messageId: { $exists: true, $nin: ['', null] }
        }).sort({ createdAt: -1 });

    if (!log) {
      const error = new Error('Nenhum registro de WhatsApp disponível para o teste.');
      error.statusCode = 404;
      throw error;
    }

    const statusData = {
      messageId: log.messageId,
      remoteJid: log.remoteJid,
      rawStatus: normalizedStatus,
      status: normalizedStatus,
      payload: {
        origem: 'teste_interno_fase_14',
        logId: String(log._id)
      }
    };

    applyWhatsappDeliveryStatus(log, statusData);
    await log.save();

    await registrarAuditoriaFinanceira({
      req,
      acao: 'WEBHOOK_WHATSAPP_TESTE_INTERNO',
      entidade: 'FinanceiroReguaWhatsappLog',
      entidadeId: String(log._id),
      codigo: log.messageId || '',
      depois: {
        deliveryStatus: log.deliveryStatus,
        messageId: log.messageId
      }
    });

    return {
      ok: true,
      logId: String(log._id),
      messageId: log.messageId,
      deliveryStatus: log.deliveryStatus
    };
  }

  function normalizeWhatsappDeliveryStatus(value = '') {
  const raw = String(value ?? '').trim().toUpperCase();

  const map = {
    '0': 'PENDING',
    '1': 'FAILED',
    '2': 'PENDING',
    '3': 'SENT',
    '4': 'DELIVERED',
    '5': 'READ',
    '6': 'READ',

    PENDING: 'PENDING',

    SERVER_ACK: 'SENT',
    SERVERACK: 'SENT',
    SENT: 'SENT',

    DELIVERY_ACK: 'DELIVERED',
    DELIVERYACK: 'DELIVERED',
    DELIVERED: 'DELIVERED',

    READ: 'READ',
    READ_ACK: 'READ',
    READACK: 'READ',
    PLAYED: 'READ',

    ERROR: 'FAILED',
    FAILED: 'FAILED',
    FAILURE: 'FAILED'
  };

  return map[raw] || 'UNKNOWN';
}

  function extractWhatsappStatusPayload(payload = {}) {
  const originalData = payload?.data ?? payload?.body ?? payload;

  const data = Array.isArray(originalData)
    ? originalData[0] || {}
    : originalData || {};

  const message = data?.message || {};
  const key =
    data?.key
    || message?.key
    || payload?.key
    || {};

  const update =
    data?.update
    || data?.messageUpdate
    || message?.update
    || payload?.update
    || {};

  const messageId = String(
  key?.id
  || data?.keyId
  || data?.key_id
  || data?.messageKey?.id
  || data?.messageId
  || data?.message_id
  || data?.id
  || message?.messageId
  || message?.id
  || update?.messageId
  || update?.message_id
  || payload?.keyId
  || payload?.messageId
  || payload?.message_id
  || ''
).trim();

  const remoteJid = String(
    key?.remoteJid
    || key?.remoteJidAlt
    || data?.remoteJid
    || data?.remote_jid
    || message?.remoteJid
    || update?.remoteJid
    || payload?.remoteJid
    || ''
  ).trim();

  const rawStatusValue =
    update?.status
    ?? update?.ack
    ?? data?.status
    ?? data?.ack
    ?? message?.status
    ?? message?.ack
    ?? payload?.status
    ?? payload?.ack
    ?? '';

  const rawStatus = String(rawStatusValue ?? '').trim();

  return {
    messageId,
    remoteJid,
    rawStatus,
    status: normalizeWhatsappDeliveryStatus(rawStatus),
    payload: redact(payload)
  };
}

  function applyWhatsappDeliveryStatus(log, statusData = {}) {
    const now = new Date();
    const status = String(statusData.status || 'UNKNOWN').toUpperCase();

    const prioridade = {
      UNKNOWN: 0,
      PENDING: 1,
      SENT: 2,
      DELIVERED: 3,
      READ: 4
    };

    const statusAtual = String(log.deliveryStatus || 'UNKNOWN').toUpperCase();
    const prioridadeAtual = prioridade[statusAtual] ?? 0;
    const prioridadeNova = prioridade[status] ?? 0;

    const podeAtualizar =
      status === 'FAILED'
      || statusAtual === 'FAILED'
      || prioridadeNova >= prioridadeAtual;

    if (podeAtualizar) {
      log.deliveryStatus = status;
      log.deliveryStatusUpdatedAt = now;
    }

    if (statusData.messageId && !log.messageId) {
      log.messageId = statusData.messageId;
    }

    if (statusData.remoteJid && !log.remoteJid) {
      log.remoteJid = statusData.remoteJid;
    }

    if (status === 'SENT' && !log.sentAt) {
      log.sentAt = now;
    }

    if (status === 'DELIVERED' && !log.deliveredAt) {
      log.deliveredAt = now;
    }

    if (status === 'READ' && !log.readAt) {
      log.readAt = now;
    }

    if (status === 'FAILED') {
      log.failedAt = now;
      log.erro =
        log.erro
        || `Status WhatsApp: ${statusData.rawStatus || 'FAILED'}`;
    }

    log.ackHistory = Array.isArray(log.ackHistory)
      ? log.ackHistory
      : [];

    log.ackHistory.push({
      em: now,
      status,
      rawStatus: statusData.rawStatus || '',
      payload: statusData.payload || null
    });

    if (log.ackHistory.length > 50) {
      log.ackHistory = log.ackHistory.slice(-50);
    }
  }

  function validarWebhookFinanceiroWhatsapp(req) {
    const configured = String(
      process.env.FINANCEIRO_WHATSAPP_WEBHOOK_TOKEN || ''
    ).trim();

    if (!configured) return true;

    const informed = String(
      req.headers?.['x-financeiro-webhook-token']
      || req.headers?.['x-webhook-token']
      || req.query?.token
      || ''
    ).trim();

    return Boolean(informed && informed === configured);
  }


  async function migrarLogsAntigosWhatsappFinanceiro({
    req = {},
    limite = 1000,
    somentePendentes = false
  } = {}) {
    const max = Math.max(1, Math.min(Number(limite || 1000), 5000));

    const filter = {
      $or: [
        { deliveryStatus: { $exists: false } },
        { deliveryStatus: null },
        { deliveryStatus: '' },
        { messageId: { $exists: false } },
        { messageId: '' }
      ]
    };

    if (somentePendentes) {
      filter.enviado = true;
    }

    const rows = await FinanceiroReguaWhatsappLog.find(filter)
      .sort({ createdAt: 1 })
      .limit(max);

    let analisados = 0;
    let migrados = 0;
    let ignorados = 0;
    let erros = 0;
    const resultados = [];

    for (const log of rows) {
      analisados += 1;

      try {
        const whatsappResultado = log.whatsappResultado || {};
        const messageId = String(
          log.messageId
          || whatsappResultado?.data?.key?.id
          || whatsappResultado?.key?.id
          || ''
        );
        const remoteJid = String(
          log.remoteJid
          || whatsappResultado?.data?.key?.remoteJid
          || whatsappResultado?.key?.remoteJid
          || ''
        );
        const rawStatus = String(
          whatsappResultado?.data?.status
          || whatsappResultado?.status
          || (log.enviado ? 'PENDING' : 'FAILED')
        );

        let deliveryStatus = normalizeWhatsappDeliveryStatus(rawStatus);
        if (deliveryStatus === 'UNKNOWN') {
          deliveryStatus = log.enviado ? 'PENDING' : 'FAILED';
        }

        const jaMigrado =
          Boolean(log.deliveryStatus)
          && Boolean(log.messageId || !messageId)
          && Boolean(log.remoteJid || !remoteJid);

        if (jaMigrado) {
          ignorados += 1;
          resultados.push({
            ok: true,
            skipped: true,
            reason: 'ja_migrado',
            logId: String(log._id)
          });
          continue;
        }

        if (messageId) log.messageId = messageId;
        if (remoteJid) log.remoteJid = remoteJid;
        log.deliveryStatus = deliveryStatus;
        log.deliveryStatusUpdatedAt = log.deliveryStatusUpdatedAt || log.updatedAt || new Date();

        if (deliveryStatus === 'SENT' && !log.sentAt) {
          log.sentAt = log.enviadoEm || log.createdAt || new Date();
        }
        if (deliveryStatus === 'DELIVERED' && !log.deliveredAt) {
          log.deliveredAt = log.updatedAt || new Date();
        }
        if (deliveryStatus === 'READ' && !log.readAt) {
          log.readAt = log.updatedAt || new Date();
        }
        if (deliveryStatus === 'FAILED' && !log.failedAt) {
          log.failedAt = log.updatedAt || new Date();
        }

        log.ackHistory = Array.isArray(log.ackHistory) ? log.ackHistory : [];
        log.ackHistory.push({
          em: new Date(),
          status: deliveryStatus,
          rawStatus,
          tipo: 'MIGRACAO_FASE_13_1'
        });
        if (log.ackHistory.length > 50) log.ackHistory = log.ackHistory.slice(-50);

        await log.save();

        migrados += 1;
        resultados.push({
          ok: true,
          logId: String(log._id),
          messageId: log.messageId || '',
          remoteJid: log.remoteJid || '',
          deliveryStatus: log.deliveryStatus
        });
      } catch (error) {
        erros += 1;
        resultados.push({
          ok: false,
          logId: String(log._id),
          error: error.message || String(error)
        });
      }
    }

    await registrarAuditoriaFinanceira({
      req,
      acao: 'MIGRACAO_LOGS_WHATSAPP_FASE_13_1',
      entidade: 'FinanceiroReguaWhatsappLog',
      entidadeId: '',
      codigo: 'FASE_13_1',
      depois: {
        analisados,
        migrados,
        ignorados,
        erros
      },
      sucesso: erros === 0,
      erro: erros > 0 ? `${erros} registro(s) com falha.` : ''
    });

    return {
      ok: true,
      analisados,
      migrados,
      ignorados,
      erros,
      resultados
    };
  }

  async function resumirMonitorWhatsappFinanceiro({
    minutosPendente = 15,
    limite = 50,
    carneId = '',
    carneCodigo = '',
    telefone = ''
  } = {}) {
    const staleDate = new Date(Date.now() - Math.max(1, Number(minutosPendente || 15)) * 60000);
    const identityFilters = [];

    const carneIdNormalizado = String(carneId || '').trim();
    if (carneIdNormalizado && mongoose.Types.ObjectId.isValid(carneIdNormalizado)) {
      identityFilters.push({ carneId: new mongoose.Types.ObjectId(carneIdNormalizado) });
    }

    const carneCodigoNormalizado = String(carneCodigo || '').trim();
    if (carneCodigoNormalizado) {
      identityFilters.push({
        carneCodigo: new RegExp(`^${escapeRegex(carneCodigoNormalizado)}$`, 'i')
      });
    }

    const telefoneNormalizado = cleanPhone(telefone || '');
    if (telefoneNormalizado) {
      const telefoneFinal = telefoneNormalizado.slice(-11);
      identityFilters.push({
        telefone: new RegExp(`${escapeRegex(telefoneFinal)}$`)
      });
    }

    const applyIdentityFilter = (query = {}) => {
      if (!identityFilters.length) return query;
      return {
        $and: [
          { $or: identityFilters },
          query
        ]
      };
    };

    const [
      pending,
      stalePending,
      sent,
      delivered,
      read,
      failed,
      recent
    ] = await Promise.all([
      FinanceiroReguaWhatsappLog.countDocuments(
        applyIdentityFilter({ enviado: true, deliveryStatus: 'PENDING' })
      ),
      FinanceiroReguaWhatsappLog.countDocuments(
        applyIdentityFilter({
          enviado: true,
          deliveryStatus: 'PENDING',
          enviadoEm: { $lte: staleDate }
        })
      ),
      FinanceiroReguaWhatsappLog.countDocuments(
        applyIdentityFilter({ enviado: true, deliveryStatus: 'SENT' })
      ),
      FinanceiroReguaWhatsappLog.countDocuments(
        applyIdentityFilter({ enviado: true, deliveryStatus: 'DELIVERED' })
      ),
      FinanceiroReguaWhatsappLog.countDocuments(
        applyIdentityFilter({ enviado: true, deliveryStatus: 'READ' })
      ),
      FinanceiroReguaWhatsappLog.countDocuments(
        applyIdentityFilter({
          $or: [
            { deliveryStatus: 'FAILED' },
            { enviado: false, erro: { $ne: '' } }
          ]
        })
      ),
      FinanceiroReguaWhatsappLog.find(
        identityFilters.length ? { $or: identityFilters } : {}
      )
        .sort({ createdAt: -1 })
        .limit(Math.max(1, Math.min(Number(limite || 50), 200)))
        .lean()
    ]);

    return {
      pendentes: pending,
      pendentesAtrasados: stalePending,
      enviados: sent,
      entregues: delivered,
      lidos: read,
      falhas: failed,
      minutosPendente: Number(minutosPendente || 15),
      filtros: {
        carneId: carneIdNormalizado,
        carneCodigo: carneCodigoNormalizado,
        telefone: telefoneNormalizado ? telefoneNormalizado.slice(-4).padStart(telefoneNormalizado.length, '*') : ''
      },
      recentes: recent
    };
  }

  async function reenviarLogWhatsappFinanceiro({
    log,
    req = {},
    ignorarHorario = false
  } = {}) {
    if (!log) {
      const error = new Error('Registro de WhatsApp não encontrado.');
      error.statusCode = 404;
      throw error;
    }

    if (['DELIVERED', 'READ'].includes(log.deliveryStatus)) {
      const error = new Error('Mensagem já entregue ou lida. Reenvio bloqueado.');
      error.statusCode = 409;
      throw error;
    }

    const maxRetries = Math.max(0, Math.min(Number(process.env.FINANCEIRO_WHATSAPP_MAX_RETRIES || 3), 10));
    if (Number(log.retryCount || 0) >= maxRetries) {
      const error = new Error(`Limite de ${maxRetries} reenvio(s) atingido.`);
      error.statusCode = 409;
      throw error;
    }

    const config = getFinanceiroReguaWhatsappConfig();
    const clock = getFinanceiroAutomationClock(new Date(), config.timezone);
    if (!ignorarHorario && !horarioDentroJanela(clock.time, config.inicioPermitido, config.fimPermitido)) {
      const error = new Error(
        `Reenvio permitido somente entre ${config.inicioPermitido} e ${config.fimPermitido}.`
      );
      error.statusCode = 409;
      throw error;
    }

    const whatsapp = await waSendTextMessage({
      number: log.telefone,
      text: log.mensagem,
      delay: config.delayMs
    });

    const messageId = String(
      whatsapp?.data?.key?.id
      || whatsapp?.key?.id
      || ''
    );
    const remoteJid = String(
      whatsapp?.data?.key?.remoteJid
      || whatsapp?.key?.remoteJid
      || ''
    );
    const status = normalizeWhatsappDeliveryStatus(
      whatsapp?.data?.status || whatsapp?.status || 'PENDING'
    );

    log.retryCount = Number(log.retryCount || 0) + 1;
    log.lastRetryAt = new Date();
    log.enviado = true;
    log.enviadoEm = new Date();
    log.messageId = messageId;
    log.remoteJid = remoteJid;
    log.deliveryStatus = status === 'UNKNOWN' ? 'PENDING' : status;
    log.deliveryStatusUpdatedAt = new Date();
    log.erro = '';
    log.whatsappResultado = redact(whatsapp || null);
    log.ackHistory = Array.isArray(log.ackHistory) ? log.ackHistory : [];
    log.ackHistory.push({
      em: new Date(),
      status: log.deliveryStatus,
      rawStatus: whatsapp?.data?.status || whatsapp?.status || 'PENDING',
      tipo: 'REENVIO'
    });
    await log.save();

    await registrarAuditoriaFinanceira({
      req,
      acao: 'REGUA_WHATSAPP_REENVIADA',
      entidade: 'FinanceiroReguaWhatsappLog',
      entidadeId: String(log._id),
      codigo: log.carneCodigo || log.documento || '',
      depois: {
        retryCount: log.retryCount,
        deliveryStatus: log.deliveryStatus,
        messageId: log.messageId
      }
    });

    return log.toObject();
  }

  function getFinanceiroReguaWhatsappConfig() {
    const enabledRaw = String(process.env.FINANCEIRO_REGUA_WHATSAPP_ENABLED ?? 'false').trim().toLowerCase();
    const enabled = ['true', '1', 'on', 'yes', 'sim'].includes(enabledRaw);
    const horarioRaw = String(process.env.FINANCEIRO_REGUA_WHATSAPP_HORA || '09:00').trim();
    const horario = /^\d{2}:\d{2}$/.test(horarioRaw) ? horarioRaw : '09:00';
    const inicioRaw = String(process.env.FINANCEIRO_REGUA_WHATSAPP_INICIO || '08:00').trim();
    const fimRaw = String(process.env.FINANCEIRO_REGUA_WHATSAPP_FIM || '18:00').trim();

    return {
      enabled,
      horario,
      timezone: String(process.env.FINANCEIRO_REGUA_WHATSAPP_TIMEZONE || 'America/Sao_Paulo').trim(),
      inicioPermitido: /^\d{2}:\d{2}$/.test(inicioRaw) ? inicioRaw : '08:00',
      fimPermitido: /^\d{2}:\d{2}$/.test(fimRaw) ? fimRaw : '18:00',
      checkSeconds: Math.max(30, Math.min(Number(process.env.FINANCEIRO_REGUA_WHATSAPP_CHECK_SECONDS || 60), 3600)),
      maxEnviosDia: Math.max(1, Math.min(Number(process.env.FINANCEIRO_REGUA_WHATSAPP_MAX_DIA || 100), 1000)),
      delayMs: Math.max(0, Math.min(Number(process.env.FINANCEIRO_REGUA_WHATSAPP_DELAY_MS || 1200), 15000)),
      regrasAtraso: [1, 3, 7, 15, 30]
    };
  }

  function horarioDentroJanela(horario = '', inicio = '08:00', fim = '18:00') {
    return String(horario) >= String(inicio) && String(horario) <= String(fim);
  }

  function formatarDataFinanceiraBR(value) {
    const d = dayOnly(value);
    if (!d) return '';
    return d.toLocaleDateString('pt-BR');
  }

  function construirMensagemReguaWhatsapp(candidato = {}) {
    const nome = String(candidato.clienteNome || 'cliente').trim() || 'cliente';
    const parcela = String(candidato.parcelaLabel || '').trim();
    const documento = String(candidato.documento || candidato.carneCodigo || '').trim();
    const valor = formatMoneyBRL(Number(candidato.valor || 0));
    const vencimento = formatarDataFinanceiraBR(candidato.vencimento || candidato.dataPrometida);
    const tipo = String(candidato.tipoEvento || '');

    const rodape = [
      '',
      'Em caso de pagamento já realizado, desconsidere esta mensagem.',
      '📲 Financeiro Ariana Móveis: (31) 98514-7119'
    ];

    if (tipo === 'VENCE_AMANHA') {
      return [
        `Olá, ${nome}! Tudo bem?`,
        '',
        `Passando para lembrar que sua parcela${parcela ? ` ${parcela}` : ''} vence amanhã${vencimento ? `, ${vencimento}` : ''}.`,
        `💰 Valor: ${valor}`,
        documento ? `🧾 Referência: ${documento}` : '',
        '',
        'Agradecemos por manter seu crediário em dia. 💙',
        ...rodape
      ].filter(Boolean).join('\n');
    }

    if (tipo === 'VENCE_HOJE') {
      return [
        `Olá, ${nome}!`,
        '',
        `Sua parcela${parcela ? ` ${parcela}` : ''} vence hoje${vencimento ? ` (${vencimento})` : ''}.`,
        `💰 Valor: ${valor}`,
        documento ? `🧾 Referência: ${documento}` : '',
        '',
        'Conte com a Ariana Móveis para qualquer esclarecimento.',
        ...rodape
      ].filter(Boolean).join('\n');
    }

    if (tipo === 'PROMESSA_AMANHA') {
      return [
        `Olá, ${nome}!`,
        '',
        `Este é um lembrete da sua promessa de pagamento para amanhã${vencimento ? `, ${vencimento}` : ''}.`,
        `💰 Valor combinado: ${valor}`,
        documento ? `🧾 Referência: ${documento}` : '',
        '',
        'Agradecemos pelo compromisso assumido.',
        ...rodape
      ].filter(Boolean).join('\n');
    }

    if (tipo === 'PROMESSA_HOJE') {
      return [
        `Olá, ${nome}!`,
        '',
        `Sua promessa de pagamento está prevista para hoje${vencimento ? ` (${vencimento})` : ''}.`,
        `💰 Valor combinado: ${valor}`,
        documento ? `🧾 Referência: ${documento}` : '',
        '',
        'Caso precise falar conosco, estamos à disposição.',
        ...rodape
      ].filter(Boolean).join('\n');
    }

    if (tipo === 'PROMESSA_QUEBRADA') {
      return [
        `Olá, ${nome}.`,
        '',
        'Não identificamos o pagamento na data combinada.',
        `💰 Valor prometido: ${valor}`,
        documento ? `🧾 Referência: ${documento}` : '',
        '',
        'Pedimos que entre em contato para regularização ou novo acordo.',
        ...rodape
      ].filter(Boolean).join('\n');
    }

    const dias = Number(candidato.diasAtraso || 0);
    const urgente = dias >= 15;
    return [
      urgente ? `Olá, ${nome}. Precisamos falar sobre seu crediário.` : `Olá, ${nome}.`,
      '',
      `Identificamos uma parcela${parcela ? ` ${parcela}` : ''} com ${dias} dia(s) de atraso.`,
      `💰 Valor atualizado: ${valor}`,
      vencimento ? `📅 Vencimento: ${vencimento}` : '',
      documento ? `🧾 Referência: ${documento}` : '',
      '',
      urgente
        ? 'Entre em contato o quanto antes para evitar bloqueio interno de crédito e novos encargos.'
        : 'Pedimos a gentileza de regularizar ou falar conosco para receber orientação.',
      ...rodape
    ].filter(Boolean).join('\n');
  }

  function criarChaveReguaWhatsapp(candidato = {}, dataReferencia = '') {
    const target = String(
      candidato.filaItemId ||
      candidato.promessaId ||
      candidato.parcelaCodigo ||
      candidato.carneCodigo ||
      candidato.telefone ||
      candidato.clienteNome ||
      ''
    );
    return [
      'financeiro_regua',
      dataReferencia,
      String(candidato.tipoEvento || ''),
      target
    ].join(':');
  }

  async function obterCandidatosReguaWhatsapp({
    dataReferencia = new Date(),
    limite = 500
  } = {}) {
    const ref = dayOnly(dataReferencia);
    if (!ref) throw new Error('Data de referência inválida.');

    const dataRefKey = dateKey(ref);
    const amanha = new Date(ref.getTime());
    amanha.setDate(amanha.getDate() + 1);

    const [fila, promessas] = await Promise.all([
      FinanceiroFilaCobranca.find({
        dataReferencia: dataRefKey,
        status: { $nin: ['CONCLUIDO'] }
      }).sort({ prioridadeScore: -1, valorAtualizado: -1 }).limit(Math.max(1, Math.min(Number(limite || 500), 2000))).lean(),
      FinanceiroPromessaPagamento.find({
        status: { $in: ['PENDENTE', 'QUEBRADA'] }
      }).sort({ dataPrometida: 1 }).limit(Math.max(1, Math.min(Number(limite || 500), 2000))).lean()
    ]);

    const candidatos = [];

    for (const item of fila) {
      const diasAtraso = Number(item.diasAtraso || 0);
      let tipoEvento = '';

      if (item.faixa === 'VENCE_AMANHA') tipoEvento = 'VENCE_AMANHA';
      else if (item.faixa === 'VENCE_HOJE') tipoEvento = 'VENCE_HOJE';
      else if ([1, 3, 7, 15, 30].includes(diasAtraso)) tipoEvento = `ATRASO_${diasAtraso}`;

      if (!tipoEvento) continue;

      candidatos.push({
        tipoEvento,
        filaItemId: item._id,
        carneId: item.carneId,
        carneCodigo: item.carneCodigo || '',
        clienteNome: item.clienteNome || '',
        telefone: normalizePhone(item.telefone || '', '55'),
        parcelaLabel: item.parcelaLabel || '',
        parcelaCodigo: item.parcelaCodigo || '',
        documento: item.documento || '',
        vencimento: item.vencimento || null,
        diasAtraso,
        valor: Number(item.valorAtualizado || item.valorOriginal || 0),
        prioridadeScore: Number(item.prioridadeScore || 0)
      });
    }

    for (const promessa of promessas) {
      const dataPrometida = dayOnly(promessa.dataPrometida);
      if (!dataPrometida) continue;

      let tipoEvento = '';
      if (promessa.status === 'QUEBRADA' && dateKey(promessa.quebradaEm || promessa.updatedAt || ref) === dataRefKey) {
        tipoEvento = 'PROMESSA_QUEBRADA';
      } else if (promessa.status === 'PENDENTE' && dateKey(dataPrometida) === dateKey(amanha)) {
        tipoEvento = 'PROMESSA_AMANHA';
      } else if (promessa.status === 'PENDENTE' && dateKey(dataPrometida) === dataRefKey) {
        tipoEvento = 'PROMESSA_HOJE';
      }

      if (!tipoEvento) continue;

      candidatos.push({
        tipoEvento,
        promessaId: promessa._id,
        filaItemId: promessa.filaItemId || null,
        carneId: promessa.carneId,
        carneCodigo: promessa.carneCodigo || '',
        clienteNome: promessa.clienteNome || '',
        telefone: normalizePhone(promessa.telefone || '', '55'),
        parcelaLabel: promessa.parcelaLabel || '',
        parcelaCodigo: promessa.parcelaCodigo || '',
        documento: promessa.documento || '',
        dataPrometida,
        diasAtraso: 0,
        valor: Number(promessa.valorPrometido || 0),
        prioridadeScore: tipoEvento === 'PROMESSA_QUEBRADA' ? 100 : 60
      });
    }

    // Evita várias mensagens para o mesmo cliente no mesmo dia.
    // Mantém apenas o evento mais prioritário por telefone.
    const porTelefone = new Map();
    for (const candidato of candidatos.sort((a, b) => b.prioridadeScore - a.prioridadeScore)) {
      const key = candidato.telefone || `sem_telefone:${candidato.clienteNome}:${candidato.carneCodigo}`;
      if (!porTelefone.has(key)) porTelefone.set(key, candidato);
    }

    return Array.from(porTelefone.values());
  }

  async function executarReguaWhatsappFinanceira({
    req = {},
    dataReferencia = new Date(),
    dryRun = true,
    limite = 500,
    ignorarHorario = false
  } = {}) {
    const config = getFinanceiroReguaWhatsappConfig();
    const ref = dayOnly(dataReferencia);
    if (!ref) throw new Error('Data de referência inválida.');

    const dataRefKey = dateKey(ref);
    const clock = getFinanceiroAutomationClock(new Date(), config.timezone);

    if (!dryRun && !ignorarHorario && !horarioDentroJanela(clock.time, config.inicioPermitido, config.fimPermitido)) {
      const error = new Error(
        `Envios permitidos somente entre ${config.inicioPermitido} e ${config.fimPermitido} (${config.timezone}).`
      );
      error.statusCode = 409;
      throw error;
    }

    const jaEnviadosHoje = await FinanceiroReguaWhatsappLog.countDocuments({
      dataReferencia: dataRefKey,
      enviado: true,
      dryRun: false
    });

    const saldoDisponivel = Math.max(0, config.maxEnviosDia - jaEnviadosHoje);
    const candidatos = await obterCandidatosReguaWhatsapp({
      dataReferencia: ref,
      limite
    });

    const resultados = [];
    let enviados = 0;

    for (const candidato of candidatos) {
      if (!candidato.telefone && candidato.carneId) {
        try {
          const carneTelefone = await FinanceiroCarneDigital.findById(candidato.carneId);
          if (carneTelefone) {
            const recuperado = await recuperarTelefoneCarneFinanceiro({ carne: carneTelefone, req, force: false });
            if (recuperado.telefone) candidato.telefone = recuperado.telefone;
          }
        } catch (error) {
          console.warn('[financeiro régua recuperar telefone]', error.message || error);
        }
      }

      const uniqueKey = criarChaveReguaWhatsapp(candidato, dataRefKey);
      const existente = await FinanceiroReguaWhatsappLog.findOne({ uniqueKey }).lean();
      const mensagem = construirMensagemReguaWhatsapp(candidato);

      if (!candidato.telefone) {
        resultados.push({
          ok: false,
          skipped: true,
          reason: 'sem_telefone',
          candidato,
          mensagem
        });
        continue;
      }

      if (existente) {
        resultados.push({
          ok: true,
          skipped: true,
          reason: 'ja_processado',
          candidato,
          logId: String(existente._id)
        });
        continue;
      }

      if (!dryRun && enviados >= saldoDisponivel) {
        resultados.push({
          ok: true,
          skipped: true,
          reason: 'limite_diario_atingido',
          candidato
        });
        continue;
      }

      if (dryRun) {
        resultados.push({
          ok: true,
          dryRun: true,
          candidato,
          mensagem
        });
        continue;
      }

      try {
        const whatsapp = await waSendTextMessage({
          number: candidato.telefone,
          text: mensagem,
          delay: config.delayMs
        });

        const log = await FinanceiroReguaWhatsappLog.create({
          uniqueKey,
          tipoEvento: candidato.tipoEvento,
          dataReferencia: dataRefKey,
          filaItemId: candidato.filaItemId || null,
          promessaId: candidato.promessaId || null,
          carneId: candidato.carneId || null,
          carneCodigo: candidato.carneCodigo || '',
          clienteNome: candidato.clienteNome || '',
          telefone: candidato.telefone,
          parcelaLabel: candidato.parcelaLabel || '',
          documento: candidato.documento || '',
          diasAtraso: Number(candidato.diasAtraso || 0),
          valor: Number(candidato.valor || 0),
          mensagem,
          dryRun: false,
          enviado: true,
          enviadoEm: new Date(),
          messageId: String(whatsapp?.data?.key?.id || whatsapp?.key?.id || ''),
          remoteJid: String(whatsapp?.data?.key?.remoteJid || whatsapp?.key?.remoteJid || ''),
          deliveryStatus: normalizeWhatsappDeliveryStatus(
            whatsapp?.data?.status || whatsapp?.status || 'PENDING'
          ) === 'UNKNOWN'
            ? 'PENDING'
            : normalizeWhatsappDeliveryStatus(whatsapp?.data?.status || whatsapp?.status || 'PENDING'),
          deliveryStatusUpdatedAt: new Date(),
          sentAt: ['SENT', 'DELIVERED', 'READ'].includes(
            normalizeWhatsappDeliveryStatus(whatsapp?.data?.status || whatsapp?.status || '')
          ) ? new Date() : null,
          whatsappResultado: redact(whatsapp || null),
          ackHistory: [{
            em: new Date(),
            status: normalizeWhatsappDeliveryStatus(
              whatsapp?.data?.status || whatsapp?.status || 'PENDING'
            ) === 'UNKNOWN'
              ? 'PENDING'
              : normalizeWhatsappDeliveryStatus(whatsapp?.data?.status || whatsapp?.status || 'PENDING'),
            rawStatus: whatsapp?.data?.status || whatsapp?.status || 'PENDING',
            tipo: 'ENVIO_INICIAL'
          }],
          metadata: { candidato }
        });

        if (candidato.filaItemId) {
          await FinanceiroFilaCobranca.updateOne(
            { _id: candidato.filaItemId },
            {
              $set: {
                status: 'CONTATADO',
                ultimaAcao: `WHATSAPP_${candidato.tipoEvento}`,
                ultimaAcaoEm: new Date(),
                responsavel: getFinanceiroActor(req)
              }
            }
          );
        }

        if (candidato.promessaId && ['PROMESSA_AMANHA', 'PROMESSA_HOJE'].includes(candidato.tipoEvento)) {
          await FinanceiroPromessaPagamento.updateOne(
            { _id: candidato.promessaId },
            {
              $set: {
                lembreteEnviado: true,
                lembreteEnviadoEm: new Date()
              }
            }
          );
        }

        await registrarAuditoriaFinanceira({
          req,
          acao: 'REGUA_WHATSAPP_ENVIADA',
          entidade: 'FinanceiroReguaWhatsappLog',
          entidadeId: String(log._id),
          codigo: candidato.carneCodigo || candidato.documento || '',
          depois: {
            tipoEvento: candidato.tipoEvento,
            clienteNome: candidato.clienteNome,
            telefone: candidato.telefone,
            valor: candidato.valor
          }
        });

        enviados += 1;
        resultados.push({
          ok: true,
          enviado: true,
          logId: String(log._id),
          candidato
        });
      } catch (error) {
        const log = await FinanceiroReguaWhatsappLog.create({
          uniqueKey,
          tipoEvento: candidato.tipoEvento,
          dataReferencia: dataRefKey,
          filaItemId: candidato.filaItemId || null,
          promessaId: candidato.promessaId || null,
          carneId: candidato.carneId || null,
          carneCodigo: candidato.carneCodigo || '',
          clienteNome: candidato.clienteNome || '',
          telefone: candidato.telefone,
          parcelaLabel: candidato.parcelaLabel || '',
          documento: candidato.documento || '',
          diasAtraso: Number(candidato.diasAtraso || 0),
          valor: Number(candidato.valor || 0),
          mensagem,
          dryRun: false,
          enviado: false,
          erro: error.message || String(error),
          metadata: { candidato }
        }).catch(() => null);

        resultados.push({
          ok: false,
          enviado: false,
          logId: log ? String(log._id) : '',
          error: error.message || String(error),
          candidato
        });
      }
    }

    return {
      ok: true,
      dryRun,
      dataReferencia: dataRefKey,
      configuracao: config,
      candidatos: candidatos.length,
      resumo: {
        enviados: resultados.filter((row) => row.enviado).length,
        simulados: resultados.filter((row) => row.dryRun).length,
        ignorados: resultados.filter((row) => row.skipped).length,
        erros: resultados.filter((row) => row.ok === false && !row.skipped).length,
        semTelefone: resultados.filter((row) => row.reason === 'sem_telefone').length,
        limiteDisponivelAntes: saldoDisponivel
      },
      resultados
    };
  }

  function iniciarReguaWhatsappFinanceira() {
    const config = getFinanceiroReguaWhatsappConfig();
    const globalKey = '__ARIANA_FINANCEIRO_REGUA_WHATSAPP__';

    if (!config.enabled) {
      console.log('[financeiro régua WhatsApp] Desativada. Use FINANCEIRO_REGUA_WHATSAPP_ENABLED=true após homologação.');
      return null;
    }

    if (globalThis[globalKey]?.timer) return globalThis[globalKey];

    const state = {
      timer: null,
      running: false,
      lastCheck: null
    };

    const tick = async () => {
      if (state.running || mongoose.connection?.readyState !== 1) return;

      const clock = getFinanceiroAutomationClock(new Date(), config.timezone);
      state.lastCheck = new Date();
      if (clock.time !== config.horario) return;

      state.running = true;
      try {
        const result = await executarReguaWhatsappFinanceira({
          req: getFinanceiroAutomationReq('regua_whatsapp_agendada'),
          dataReferencia: clock.dateKey,
          dryRun: false,
          limite: config.maxEnviosDia,
          ignorarHorario: false
        });
        console.log(
          `[financeiro régua WhatsApp] ${clock.dateKey}: ${result.resumo.enviados} enviado(s), ${result.resumo.ignorados} ignorado(s), ${result.resumo.erros} erro(s).`
        );
      } catch (error) {
        console.error('[financeiro régua WhatsApp]', error.message || error);
      } finally {
        state.running = false;
      }
    };

    state.timer = setInterval(
      () => tick().catch((error) => console.error('[financeiro régua WhatsApp tick]', error.message || error)),
      config.checkSeconds * 1000
    );
    if (typeof state.timer.unref === 'function') state.timer.unref();

    globalThis[globalKey] = state;
    console.log(
      `[financeiro régua WhatsApp] Ativa: diariamente às ${config.horario} (${config.timezone}), janela ${config.inicioPermitido}-${config.fimPermitido}.`
    );
    return state;
  }

  function getFinanceiroAutomationConfig() {
    const enabledRaw = String(process.env.FINANCEIRO_AUTOMACAO_ENABLED ?? 'true').trim().toLowerCase();
    const enabled = !['false', '0', 'off', 'no', 'nao', 'não'].includes(enabledRaw);
    const horarioRaw = String(process.env.FINANCEIRO_AUTOMACAO_HORA || '05:30').trim();
    const horario = /^\d{2}:\d{2}$/.test(horarioRaw) ? horarioRaw : '05:30';

    return {
      enabled,
      horario,
      timezone: String(process.env.FINANCEIRO_AUTOMACAO_TIMEZONE || 'America/Sao_Paulo').trim(),
      checkSeconds: Math.max(30, Math.min(Number(process.env.FINANCEIRO_AUTOMACAO_CHECK_SECONDS || 60), 3600)),
      syncLimit: Math.max(1, Math.min(Number(process.env.FINANCEIRO_AUTOMACAO_SYNC_LIMIT || 500), 500)),
      riskLimit: Math.max(1, Math.min(Number(process.env.FINANCEIRO_AUTOMACAO_RISK_LIMIT || 3000), 5000)),
      startupRun: String(process.env.FINANCEIRO_AUTOMACAO_STARTUP_RUN || 'false').toLowerCase() === 'true'
    };
  }

  function getFinanceiroAutomationClock(date = new Date(), timezone = 'America/Sao_Paulo') {
    const parts = new Intl.DateTimeFormat('pt-BR', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(date);

    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
      dateKey: `${map.year}-${map.month}-${map.day}`,
      time: `${map.hour}:${map.minute}`
    };
  }

  function getFinanceiroAutomationReq(actor = 'automacao_financeira') {
    return {
      admin: {
        email: actor,
        role: 'admin',
        admin: true,
        permissions: ['*']
      },
      auth: {
        email: actor,
        role: 'admin',
        permissions: ['*']
      },
      headers: {
        'user-agent': 'Ariana-Financeiro-Automacao/1.0'
      },
      socket: {
        remoteAddress: '127.0.0.1'
      }
    };
  }

  async function recalcularCarneFinanceiroInterno(row, dataReferencia, req = {}) {
    const antes = row.resumo || {};
    const parcelas = normalizarIdentificacaoParcelas(
      Array.isArray(row.parcelas) ? row.parcelas : []
    ).map((p) => ({
      ...p,
      atualizacaoFinanceira: calcularParcelaAtualizadaBackend(p, dataReferencia)
    }));

    const gruposMap = new Map();
    for (const parcela of parcelas) {
      const chave = String(parcela.chave || parcela.documento || 'Sem documento');

      if (!gruposMap.has(chave)) {
        gruposMap.set(chave, {
          documento: chave,
          descricao: parcela.descricao || '',
          codigoVenda: parcela.codigoVenda || 0,
          codigoContrato: parcela.codigoContrato || 0,
          parcelas: [],
          total: 0,
          pago: 0,
          saldo: 0,
          multa: 0,
          juros: 0,
          valorAtualizado: 0,
          pagas: 0,
          abertas: 0,
          atrasadas: 0
        });
      }

      const grupo = gruposMap.get(chave);
      grupo.parcelas.push(parcela);
      grupo.total += Number(parcela.valorParcela || parcela.valor || 0);
      grupo.pago += Number(parcela.valorPago || parcela.totalRecebido || 0);
      grupo.saldo += Number(parcela.saldoParcela || parcela.saldo || 0);
      grupo.multa += Number(parcela.atualizacaoFinanceira?.multa || 0);
      grupo.juros += Number(parcela.atualizacaoFinanceira?.juros || 0);
      grupo.valorAtualizado += Number(parcela.atualizacaoFinanceira?.valorAtualizado || 0);

      const quitada = parcela.status === 'paga' || parcela.quitado === true;
      const diasAtraso = Number(parcela.atualizacaoFinanceira?.diasAtraso || 0);

      if (quitada) grupo.pagas += 1;
      else {
        grupo.abertas += 1;
        if (diasAtraso > 0) grupo.atrasadas += 1;
      }

      parcela.status = quitada ? 'paga' : (diasAtraso > 0 ? 'atrasada' : 'aberta');
    }

    const grupos = Array.from(gruposMap.values()).map((grupo) => ({
      ...grupo,
      total: Number(grupo.total.toFixed(2)),
      pago: Number(grupo.pago.toFixed(2)),
      saldo: Number(grupo.saldo.toFixed(2)),
      multa: Number(grupo.multa.toFixed(2)),
      juros: Number(grupo.juros.toFixed(2)),
      valorAtualizado: Number(grupo.valorAtualizado.toFixed(2))
    }));

    const resumo = grupos.reduce((acc, grupo) => {
      acc.total += grupo.total;
      acc.pago += grupo.pago;
      acc.saldo += grupo.saldo;
      acc.multa += grupo.multa;
      acc.juros += grupo.juros;
      acc.valorAtualizado += grupo.valorAtualizado;
      acc.parcelas += grupo.parcelas.length;
      acc.pagas += grupo.pagas;
      acc.abertas += grupo.abertas;
      acc.atrasadas += grupo.atrasadas;
      return acc;
    }, {
      total: 0,
      pago: 0,
      saldo: 0,
      multa: 0,
      juros: 0,
      valorAtualizado: 0,
      parcelas: 0,
      pagas: 0,
      abertas: 0,
      atrasadas: 0
    });

    for (const key of ['total', 'pago', 'saldo', 'multa', 'juros', 'valorAtualizado']) {
      resumo[key] = Number(Number(resumo[key] || 0).toFixed(2));
    }

    resumo.calculoFinanceiro = getFinanceiroCalculationConfig();
    resumo.calculadoEm = dataReferencia.toISOString();

    row.parcelas = parcelas;
    row.grupos = grupos;
    row.resumo = resumo;
    row.historico = Array.isArray(row.historico) ? row.historico : [];
    row.historico.push({
      tipo: 'RECALCULO_FINANCEIRO_AUTOMATICO',
      em: new Date(),
      dataReferencia,
      por: getFinanceiroActor(req),
      resumoAnterior: antes,
      resumoAtual: resumo
    });
    if (row.historico.length > 100) row.historico = row.historico.slice(-100);

    await row.save();
    return { antes, depois: resumo };
  }

  async function recalcularTodosCarnesFinanceiro({
    req = {},
    dataReferencia = new Date(),
    limite = 500
  } = {}) {
    const rows = await FinanceiroCarneDigital.find({ status: 'ATIVO' })
      .sort({ updatedAt: 1 })
      .limit(Math.max(1, Math.min(Number(limite || 500), 5000)));

    let atualizados = 0;
    let erros = 0;
    const resultados = [];

    for (const row of rows) {
      try {
        const result = await recalcularCarneFinanceiroInterno(row, dataReferencia, req);
        atualizados += 1;
        resultados.push({
          ok: true,
          id: String(row._id),
          codigo: row.codigo,
          resumo: result.depois
        });
      } catch (error) {
        erros += 1;
        resultados.push({
          ok: false,
          id: String(row._id),
          codigo: row.codigo,
          error: error.message || String(error)
        });
      }
    }

    return {
      selecionados: rows.length,
      atualizados,
      erros,
      resultados: resultados.slice(0, 200)
    };
  }

  async function recalcularTodosRiscosFinanceiros({ req = {}, limite = 3000 } = {}) {
    const carnes = await FinanceiroCarneDigital.find({})
      .sort({ updatedAt: -1 })
      .limit(Math.max(1, Math.min(Number(limite || 3000), 5000)))
      .lean();

    const unique = new Map();

    for (const carne of carnes) {
      const cliente = carne.cliente || {};
      const key = getCustomerRiskKey({
        cpf: cliente.cpf || '',
        telefone: cliente.telefone || '',
        nome: cliente.nome || ''
      });

      if (!unique.has(key)) {
        unique.set(key, {
          cpf: cliente.cpf || '',
          telefone: cliente.telefone || '',
          nome: cliente.nome || ''
        });
      }
    }

    let atualizados = 0;
    let erros = 0;
    const resultados = [];

    for (const cliente of unique.values()) {
      try {
        const row = await recalculateCustomerRisk({ req, ...cliente });
        atualizados += 1;
        resultados.push({ ok: true, risco: normalizeRiscoCliente(row) });
      } catch (error) {
        erros += 1;
        resultados.push({
          ok: false,
          cliente,
          error: error.message || String(error)
        });
      }
    }

    return {
      clientesAnalisados: unique.size,
      atualizados,
      erros,
      resultados: resultados.slice(0, 200)
    };
  }

  async function adquirirLockAutomacaoFinanceira({
    dataReferencia,
    tipo = 'DIARIA',
    force = false,
    actor = 'automacao_financeira'
  } = {}) {
    const instance = `${process.pid}:${process.env.RENDER_INSTANCE_ID || process.env.HOSTNAME || 'local'}`;
    const uniqueKey = force
      ? `${tipo}:${dataReferencia}:${Date.now()}:${crypto.randomBytes(3).toString('hex')}`
      : `${tipo}:${dataReferencia}`;

    try {
      const row = await FinanceiroAutomacaoExecucao.create({
        uniqueKey,
        tipo,
        dataReferencia,
        status: 'PROCESSANDO',
        iniciadoEm: new Date(),
        solicitadoPor: actor,
        instancia: instance,
        etapas: [],
        resumo: {}
      });

      return { acquired: true, row };
    } catch (error) {
      if (error?.code === 11000) {
        const existing = await FinanceiroAutomacaoExecucao.findOne({ uniqueKey }).lean();
        return {
          acquired: false,
          reason: 'already_executed_or_running',
          existing
        };
      }
      throw error;
    }
  }

  async function executarAutomacaoFinanceiraDiaria({
    actor = 'automacao_financeira',
    force = false,
    tipo = 'DIARIA',
    dataReferencia = new Date()
  } = {}) {
    const config = getFinanceiroAutomationConfig();
    const referencia = dayOnly(dataReferencia);

    if (!referencia) {
      const error = new Error('Data de referência inválida para a automação.');
      error.statusCode = 400;
      throw error;
    }

    const req = getFinanceiroAutomationReq(actor);
    const dataReferenciaKey = dateKey(referencia);
    const lock = await adquirirLockAutomacaoFinanceira({
      dataReferencia: dataReferenciaKey,
      tipo,
      force,
      actor
    });

    if (!lock.acquired) {
      return {
        ok: true,
        skipped: true,
        reason: lock.reason,
        execucao: lock.existing || null
      };
    }

    const execucao = lock.row;
    const etapas = [];
    let totalErros = 0;

    const executarEtapa = async (nome, fn) => {
      const inicio = new Date();
      try {
        const resultado = await fn();
        const etapa = {
          nome,
          status: 'CONCLUIDO',
          iniciadoEm: inicio,
          concluidoEm: new Date(),
          resultado
        };
        etapas.push(etapa);
        execucao.etapas = etapas;
        await execucao.save();
        return resultado;
      } catch (error) {
        totalErros += 1;
        const etapa = {
          nome,
          status: 'FALHOU',
          iniciadoEm: inicio,
          concluidoEm: new Date(),
          erro: error.message || String(error)
        };
        etapas.push(etapa);
        execucao.etapas = etapas;
        await execucao.save();
        return null;
      }
    };

    try {
      const sincronizacao = await executarEtapa('SINCRONIZAR_SIGE', () =>
        executarSincronizacaoCarnesSige({
          req,
          somenteDesatualizados: false,
          minutosDesatualizado: 1,
          limite: config.syncLimit,
          ids: []
        })
      );

      const telefones = await executarEtapa('RECUPERAR_TELEFONES', () =>
        recuperarTelefonesFinanceiros({ req, limite: config.syncLimit, force: false })
      );

      const recalculo = await executarEtapa('RECALCULAR_CARTEIRA', () =>
        recalcularTodosCarnesFinanceiro({
          req,
          dataReferencia: referencia,
          limite: config.syncLimit
        })
      );

      const fila = await executarEtapa('GERAR_FILA_DIA', () =>
        gerarFilaCobrancaDia({
          req,
          dataReferencia: referencia,
          limiteCarnes: 5000
        })
      );

      const promessas = await executarEtapa('PROCESSAR_PROMESSAS_VENCIDAS', () =>
        atualizarPromessasVencidas(req)
      );

      const alertasPromessas = await executarEtapa('NOTIFICAR_PROMESSAS_HOJE', () =>
        notificarPromessasHojeInternamente({
          req,
          dataReferencia: referencia,
          force: false
        })
      );

      const riscos = await executarEtapa('RECALCULAR_RISCOS', () =>
        recalcularTodosRiscosFinanceiros({
          req,
          limite: config.riskLimit
        })
      );

      const resumo = {
        sincronizacao: sincronizacao
          ? {
              status: sincronizacao.status,
              processados: sincronizacao.processados,
              atualizados: sincronizacao.atualizados,
              ignorados: sincronizacao.ignorados,
              erros: sincronizacao.erros
            }
          : null,
        telefones: telefones
          ? {
              selecionados: telefones.selecionados,
              encontrados: telefones.encontrados,
              atualizados: telefones.atualizados,
              naoEncontrados: telefones.naoEncontrados,
              erros: telefones.erros
            }
          : null,
        recalculo: recalculo
          ? {
              selecionados: recalculo.selecionados,
              atualizados: recalculo.atualizados,
              erros: recalculo.erros
            }
          : null,
        fila: fila
          ? {
              totalItens: fila.totalItens,
              criados: fila.criados,
              atualizados: fila.atualizados,
              preservados: fila.preservados
            }
          : null,
        promessas: promessas || null,
        alertasPromessas: alertasPromessas || null,
        riscos: riscos
          ? {
              clientesAnalisados: riscos.clientesAnalisados,
              atualizados: riscos.atualizados,
              erros: riscos.erros
            }
          : null,
        totalErros
      };

      execucao.status = totalErros > 0 ? 'CONCLUIDO_COM_ERROS' : 'CONCLUIDO';
      execucao.concluidoEm = new Date();
      execucao.etapas = etapas;
      execucao.resumo = resumo;
      await execucao.save();

      await registrarAuditoriaFinanceira({
        req,
        acao: 'AUTOMACAO_FINANCEIRA_DIARIA',
        entidade: 'FinanceiroAutomacaoExecucao',
        entidadeId: String(execucao._id),
        codigo: dataReferenciaKey,
        depois: resumo,
        sucesso: totalErros === 0,
        erro: totalErros > 0 ? `${totalErros} etapa(s) com falha.` : ''
      });

      return {
        ok: true,
        skipped: false,
        execucaoId: String(execucao._id),
        status: execucao.status,
        dataReferencia: dataReferenciaKey,
        etapas,
        resumo
      };
    } catch (error) {
      execucao.status = 'FALHOU';
      execucao.concluidoEm = new Date();
      execucao.etapas = etapas;
      execucao.erro = error.message || String(error);
      await execucao.save().catch(() => null);

      await registrarAuditoriaFinanceira({
        req,
        acao: 'AUTOMACAO_FINANCEIRA_DIARIA_FALHOU',
        entidade: 'FinanceiroAutomacaoExecucao',
        entidadeId: String(execucao._id),
        codigo: dataReferenciaKey,
        sucesso: false,
        erro: error.message || String(error)
      });

      throw error;
    }
  }

  function iniciarAutomacaoFinanceiraDiaria() {
    const config = getFinanceiroAutomationConfig();
    const globalKey = '__ARIANA_FINANCEIRO_AUTOMACAO_DIARIA__';

    if (!config.enabled) {
      console.log('[financeiro automação] Desativada por FINANCEIRO_AUTOMACAO_ENABLED=false.');
      return null;
    }

    if (globalThis[globalKey]?.timer) {
      return globalThis[globalKey];
    }

    const state = {
      timer: null,
      running: false,
      lastCheck: null
    };

    const tick = async ({ startup = false } = {}) => {
      if (state.running) return;
      if (mongoose.connection?.readyState !== 1) return;

      const clock = getFinanceiroAutomationClock(new Date(), config.timezone);
      state.lastCheck = new Date();

      const shouldRun = startup
        ? config.startupRun
        : clock.time === config.horario;

      if (!shouldRun) return;

      state.running = true;
      try {
        const result = await executarAutomacaoFinanceiraDiaria({
          actor: startup ? 'automacao_startup' : 'automacao_agendada',
          force: false,
          tipo: 'DIARIA',
          dataReferencia: clock.dateKey
        });

        if (result.skipped) {
          console.log(`[financeiro automação] ${clock.dateKey} já executada ou em andamento.`);
        } else {
          console.log(`[financeiro automação] ${clock.dateKey}: ${result.status}.`);
        }
      } catch (error) {
        console.error('[financeiro automação]', error.message || error);
      } finally {
        state.running = false;
      }
    };

    state.timer = setInterval(
      () => tick().catch((error) => console.error('[financeiro automação tick]', error.message || error)),
      config.checkSeconds * 1000
    );

    if (typeof state.timer.unref === 'function') state.timer.unref();

    globalThis[globalKey] = state;

    console.log(
      `[financeiro automação] Ativa: diariamente às ${config.horario} (${config.timezone}).`
    );

    setTimeout(
      () => tick({ startup: true }).catch((error) => console.error('[financeiro automação startup]', error.message || error)),
      5000
    );

    return state;
  }




  app.get(
    '/api/admin/financeiro/telefones/status',
    adminRequired,
    financeiroPermissionRequired('financeiro.visualizar'),
    async (_req, res) => {
      try {
        const [totalAtivos, comTelefone, semTelefone] = await Promise.all([
          FinanceiroCarneDigital.countDocuments({ status: 'ATIVO' }),
          FinanceiroCarneDigital.countDocuments({
            status: 'ATIVO',
            'cliente.telefone': { $exists: true, $nin: ['', null] }
          }),
          FinanceiroCarneDigital.countDocuments({
            status: 'ATIVO',
            $or: [
              { 'cliente.telefone': { $exists: false } },
              { 'cliente.telefone': '' },
              { 'cliente.telefone': null }
            ]
          })
        ]);

        return res.json({
          ok: true,
          totalAtivos,
          comTelefone,
          semTelefone,
          coberturaPercentual: totalAtivos > 0 ? Number(((comTelefone / totalAtivos) * 100).toFixed(2)) : 0,
          fontes: ['carne_digital', 'crediario_clientes', 'pedidos', 'sige_pessoas']
        });
      } catch (error) {
        return res.status(500).json({ ok: false, error: error.message || 'Erro ao consultar a cobertura de telefones.' });
      }
    }
  );

  app.post(
    '/api/admin/financeiro/telefones/recuperar',
    adminRequired,
    financeiroPermissionRequired('financeiro.cobranca'),
    async (req, res) => {
      try {
        const result = await recuperarTelefonesFinanceiros({
          req,
          limite: req.body?.limite || 500,
          force: req.body?.force === true,
          carneIds: req.body?.carneIds || []
        });
        return res.json(result);
      } catch (error) {
        return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao recuperar telefones financeiros.' });
      }
    }
  );

  app.patch(
    '/api/admin/financeiro/carnes/:id/telefone',
    adminRequired,
    financeiroPermissionRequired('financeiro.cobranca'),
    async (req, res) => {
      try {
        const carne = await FinanceiroCarneDigital.findById(req.params.id);
        if (!carne) return res.status(404).json({ ok: false, error: 'Carnê não encontrado.' });

        const telefone = normalizePhone(req.body?.telefone || '', '55');
        if (!telefone || telefone.length < 12 || telefone.length > 13) {
          return res.status(400).json({ ok: false, error: 'Informe um telefone válido com DDD.' });
        }

        const result = await propagarTelefoneFinanceiro({
          carne,
          telefone,
          fonte: 'preenchimento_manual',
          req
        });

        return res.json({
          ok: true,
          message: 'Telefone atualizado em todo o módulo financeiro.',
          carneId: String(carne._id),
          carneCodigo: carne.codigo,
          clienteNome: carne.cliente?.nome || '',
          ...result
        });
      } catch (error) {
        return res.status(500).json({ ok: false, error: error.message || 'Erro ao atualizar o telefone do carnê.' });
      }
    }
  );




  app.get(
    '/api/admin/financeiro/release/status',
    adminRequired,
    financeiroPermissionRequired('financeiro.visualizar'),
    async (req, res) => {
      try {
        const checklist = await executarChecklistReleaseFinanceiro({ req });
        return res.json(checklist);
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: error.message || 'Erro ao executar o checklist de homologação.'
        });
      }
    }
  );

  app.post(
    '/api/admin/financeiro/release/validar',
    adminRequired,
    financeiroPermissionRequired('financeiro.recalcular'),
    async (req, res) => {
      try {
        const checklist = await executarChecklistReleaseFinanceiro({ req });

        await registrarAuditoriaFinanceira({
          req,
          acao: 'CHECKLIST_RELEASE_FINANCEIRO',
          entidade: 'FinanceiroRelease',
          entidadeId: '',
          codigo: checklist.prontoParaProducao ? 'APROVADO' : 'PENDENTE',
          depois: checklist.resumo,
          sucesso: checklist.homologacaoLocalOk,
          erro: checklist.homologacaoLocalOk
            ? ''
            : 'Checklist local possui bloqueios.'
        });

        return res.json(checklist);
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: error.message || 'Erro ao validar a homologação.'
        });
      }
    }
  );

  app.get(
    '/api/webhooks/financeiro/whatsapp/status/health',
    (_req, res) => {
      return res.json({
        ok: true,
        service: 'financeiro_whatsapp_webhook',
        timestamp: new Date().toISOString()
      });
    }
  );

  app.get(
    '/api/admin/financeiro/regua-whatsapp/webhook/configuracao',
    adminRequired,
    financeiroPermissionRequired('financeiro.visualizar'),
    async (_req, res) => {
      try {
        const provider = await consultarWebhookEvolutionFinanceiro();
        const expectedUrl = getFinanceiroWhatsappWebhookPublicUrl();
        const configured = provider.data || null;
        const configuredEvents = Array.isArray(configured?.events) ? configured.events : [];
        const expectedEvents = getFinanceiroWhatsappWebhookEvents();

        return res.json({
          ok: true,
          expected: {
            url: expectedUrl,
            events: expectedEvents,
            tokenConfigured: Boolean(
              String(process.env.FINANCEIRO_WHATSAPP_WEBHOOK_TOKEN || '').trim()
            )
          },
          provider,
          compatible: Boolean(
            configured
            && configured.enabled === true
            && String(configured.url || '').replace(/\/+$/, '') === String(expectedUrl || '').replace(/\/+$/, '')
            && expectedEvents.every((event) => configuredEvents.includes(event))
          )
        });
      } catch (error) {
        return res.status(error.statusCode || 500).json({
          ok: false,
          error: error.message || 'Erro ao consultar o webhook na Evolution API.',
          providerData: redact(error.responseData || null)
        });
      }
    }
  );

  app.post(
    '/api/admin/financeiro/regua-whatsapp/webhook/configurar',
    adminRequired,
    financeiroPermissionRequired('financeiro.recalcular'),
    async (req, res) => {
      try {
        const result = await configurarWebhookEvolutionFinanceiro({
          req,
          enabled: req.body?.enabled !== false,
          webhookUrl: req.body?.webhookUrl || '',
          dryRun: req.body?.dryRun === true,
          confirmacao: req.body?.confirmacao || ''
        });
        return res.json(result);
      } catch (error) {
        return res.status(error.statusCode || 500).json({
          ok: false,
          error: error.message || 'Erro ao configurar o webhook na Evolution API.',
          providerData: redact(error.responseData || null)
        });
      }
    }
  );

  app.post(
    '/api/admin/financeiro/regua-whatsapp/webhook/testar-interno',
    adminRequired,
    financeiroPermissionRequired('financeiro.recalcular'),
    async (req, res) => {
      try {
        const result = await testarWebhookFinanceiroInterno({
          req,
          logId: req.body?.logId || '',
          status: req.body?.status || 'DELIVERED'
        });
        return res.json(result);
      } catch (error) {
        return res.status(error.statusCode || 500).json({
          ok: false,
          error: error.message || 'Erro ao testar o webhook interno.'
        });
      }
    }
  );

  app.post(
    '/api/webhooks/financeiro/whatsapp/status',
    async (req, res) => {
      try {
        if (!validarWebhookFinanceiroWhatsapp(req)) {
          return res.status(401).json({ ok: false, error: 'Webhook não autorizado.' });
        }

        const statusData = extractWhatsappStatusPayload(req.body || {});
        if (!statusData.messageId && !statusData.remoteJid) {
          return res.status(400).json({
            ok: false,
            error: 'Payload sem identificador da mensagem.'
          });
        }

        const filter = statusData.messageId
          ? { messageId: statusData.messageId }
          : { remoteJid: statusData.remoteJid };

        const log = await FinanceiroReguaWhatsappLog.findOne(filter).sort({ createdAt: -1 });
        if (!log) {
          return res.status(202).json({
            ok: true,
            matched: false,
            message: 'Evento recebido, mas nenhum log financeiro correspondente foi encontrado.'
          });
        }

        applyWhatsappDeliveryStatus(log, statusData);
        await log.save();

        return res.json({
          ok: true,
          matched: true,
          logId: String(log._id),
          deliveryStatus: log.deliveryStatus,
          messageId: log.messageId
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: error.message || 'Erro ao processar status do WhatsApp.'
        });
      }
    }
  );


  app.get(
    '/api/admin/financeiro/regua-whatsapp/migracao/status',
    adminRequired,
    financeiroPermissionRequired('financeiro.visualizar'),
    async (_req, res) => {
      try {
        const [total, antigos, modernos] = await Promise.all([
          FinanceiroReguaWhatsappLog.countDocuments({}),
          FinanceiroReguaWhatsappLog.countDocuments({
            $or: [
              { deliveryStatus: { $exists: false } },
              { deliveryStatus: null },
              { deliveryStatus: '' },
              { messageId: { $exists: false } },
              { messageId: '' }
            ]
          }),
          FinanceiroReguaWhatsappLog.countDocuments({
            deliveryStatus: { $exists: true, $nin: ['', null] },
            messageId: { $exists: true, $nin: ['', null] }
          })
        ]);

        return res.json({
          ok: true,
          total,
          antigos,
          modernos,
          migracaoNecessaria: antigos > 0
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: error.message || 'Erro ao consultar a migração dos logs.'
        });
      }
    }
  );

  app.post(
    '/api/admin/financeiro/regua-whatsapp/migrar-logs-antigos',
    adminRequired,
    financeiroPermissionRequired('financeiro.recalcular'),
    async (req, res) => {
      try {
        const result = await migrarLogsAntigosWhatsappFinanceiro({
          req,
          limite: req.body?.limite || 1000,
          somentePendentes: req.body?.somentePendentes === true
        });

        return res.json(result);
      } catch (error) {
        return res.status(error.statusCode || 500).json({
          ok: false,
          error: error.message || 'Erro ao migrar os logs antigos do WhatsApp.'
        });
      }
    }
  );

  // FASE 19.1.2.1 - Um único envio técnico controlado.
  app.post(
    '/api/admin/financeiro/regua-whatsapp/teste-real-controlado',
    adminRequired,
    financeiroPermissionRequired('financeiro.cobranca'),
    async (req, res) => {
      try {
        const confirmacao = String(req.body?.confirmacao || '').trim();
        if (confirmacao !== 'ENVIAR_UMA_MENSAGEM_DE_TESTE') {
          return res.status(400).json({
            ok: false,
            error: 'Confirmacao obrigatoria invalida para o teste real controlado.'
          });
        }

        const numero = normalizePhone(req.body?.numero || '', '55');
        if (!numero || !/^55\d{10,11}$/.test(numero)) {
          return res.status(400).json({
            ok: false,
            error: 'Numero de teste invalido. Use DDI 55, DDD e numero.'
          });
        }

        const origem = 'fase_19_1_teste_controlado';
        const mensagem = 'Teste tecnico controlado da Ariana Moveis. Nao e uma cobranca. Nenhuma acao e necessaria.';
        const agora = new Date();
        const uniqueKey = `${origem}:${agora.toISOString()}:${numero.slice(-4)}`;

        const whatsapp = await waSendTextMessage({
          number: numero,
          text: mensagem,
          delay: 0
        });

        const messageId = String(
          whatsapp?.data?.key?.id
          || whatsapp?.data?.messageId
          || whatsapp?.messageId
          || ''
        );
        const remoteJid = String(
          whatsapp?.data?.key?.remoteJid
          || whatsapp?.data?.remoteJid
          || ''
        );
        const deliveryStatus = String(
          whatsapp?.data?.status
          || whatsapp?.statusText
          || 'PENDING'
        ).toUpperCase();

        const log = await FinanceiroReguaWhatsappLog.create({
          uniqueKey,
          origem,
          tipoEvento: 'TESTE_REAL_CONTROLADO',
          dataReferencia: agora.toISOString().slice(0, 10),
          clienteNome: 'Homologacao Ariana Moveis',
          telefone: numero,
          parcelaLabel: '',
          documento: 'Teste tecnico Fase 19.1',
          diasAtraso: 0,
          valor: 0,
          mensagem,
          dryRun: false,
          enviado: true,
          enviadoEm: agora,
          erro: '',
          whatsappResultado: whatsapp,
          metadata: {
            fase: '19.1',
            controlado: true,
            solicitadoPor: getFinanceiroActor(req)
          },
          deliveryStatus,
          deliveryStatusUpdatedAt: agora,
          messageId,
          remoteJid,
          retryCount: 0,
          ackHistory: [{
            em: agora,
            status: deliveryStatus,
            rawStatus: deliveryStatus,
            payload: { origem }
          }]
        });

        await registrarAuditoriaFinanceira({
          req,
          acao: 'WHATSAPP_TESTE_REAL_CONTROLADO',
          entidade: 'FinanceiroReguaWhatsappLog',
          entidadeId: String(log._id),
          codigo: uniqueKey,
          depois: {
            origem,
            enviado: true,
            deliveryStatus,
            messageIdConfigurado: Boolean(messageId)
          },
          metadata: { numeroFinal: numero.slice(-4) }
        });

        return res.status(201).json({
          ok: true,
          enviado: true,
          limite: 1,
          origem,
          logId: String(log._id),
          messageId,
          deliveryStatus
        });
      } catch (error) {
        return res.status(error.statusCode || 500).json({
          ok: false,
          error: error.message || 'Erro ao executar o teste real controlado.'
        });
      }
    }
  );
  app.get(
    '/api/admin/financeiro/regua-whatsapp/monitor',
    adminRequired,
    financeiroPermissionRequired('financeiro.visualizar'),
    async (req, res) => {
      try {
        const monitor = await resumirMonitorWhatsappFinanceiro({
          minutosPendente: req.query.minutosPendente || 15,
          limite: req.query.limit || 50,
          carneId: req.query.carneId || '',
          carneCodigo: req.query.carneCodigo || '',
          telefone: req.query.telefone || ''
        });
        return res.json({
          ok: true,
          monitor: {
            ...monitor,
            recentes: Array.isArray(monitor?.recentes)
              ? monitor.recentes.map(sanitizeFinanceiroWhatsappMonitorRecord)
              : []
          }
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: error.message || 'Erro ao consultar o monitor de WhatsApp.'
        });
      }
    }
  );

  app.post(
    '/api/admin/financeiro/regua-whatsapp/:id/reenviar',
    adminRequired,
    financeiroPermissionRequired('financeiro.cobranca'),
    async (req, res) => {
      try {
        const log = await FinanceiroReguaWhatsappLog.findById(req.params.id);
        const atualizado = await reenviarLogWhatsappFinanceiro({
          log,
          req,
          ignorarHorario: req.body?.ignorarHorario === true
        });

        return res.json({
          ok: true,
          message: 'Mensagem reenviada com controle de tentativas.',
          log: atualizado
        });
      } catch (error) {
        return res.status(error.statusCode || 500).json({
          ok: false,
          error: error.message || 'Erro ao reenviar a mensagem.'
        });
      }
    }
  );

  app.get(
    '/api/admin/financeiro/regua-whatsapp/status',
    adminRequired,
    financeiroPermissionRequired('financeiro.visualizar'),
    async (_req, res) => {
      try {
        const config = getFinanceiroReguaWhatsappConfig();
        const clock = getFinanceiroAutomationClock(new Date(), config.timezone);
        const [enviadosHoje, falhasHoje, ultima] = await Promise.all([
          FinanceiroReguaWhatsappLog.countDocuments({
            dataReferencia: clock.dateKey,
            enviado: true,
            dryRun: false
          }),
          FinanceiroReguaWhatsappLog.countDocuments({
            dataReferencia: clock.dateKey,
            enviado: false,
            dryRun: false,
            erro: { $ne: '' }
          }),
          FinanceiroReguaWhatsappLog.findOne({}).sort({ createdAt: -1 }).lean()
        ]);

        return res.json({
          ok: true,
          configuracao: config,
          clock,
          dentroJanela: horarioDentroJanela(clock.time, config.inicioPermitido, config.fimPermitido),
          schedulerAtivo: Boolean(globalThis.__ARIANA_FINANCEIRO_REGUA_WHATSAPP__?.timer),
          schedulerExecutando: Boolean(globalThis.__ARIANA_FINANCEIRO_REGUA_WHATSAPP__?.running),
          ultimaVerificacao: globalThis.__ARIANA_FINANCEIRO_REGUA_WHATSAPP__?.lastCheck || null,
          enviadosHoje,
          falhasHoje,
          limiteRestanteHoje: Math.max(0, config.maxEnviosDia - enviadosHoje),
          ultimaExecucao: ultima || null,
          regras: [
            { evento: 'VENCE_AMANHA', descricao: 'Lembrete um dia antes do vencimento' },
            { evento: 'VENCE_HOJE', descricao: 'Aviso no dia do vencimento' },
            { evento: 'ATRASO_1', descricao: 'Cobrança com 1 dia de atraso' },
            { evento: 'ATRASO_3', descricao: 'Cobrança com 3 dias de atraso' },
            { evento: 'ATRASO_7', descricao: 'Cobrança com 7 dias de atraso' },
            { evento: 'ATRASO_15', descricao: 'Cobrança com 15 dias de atraso' },
            { evento: 'ATRASO_30', descricao: 'Cobrança com 30 dias de atraso' },
            { evento: 'PROMESSA_AMANHA', descricao: 'Lembrete de promessa para amanhã' },
            { evento: 'PROMESSA_HOJE', descricao: 'Lembrete de promessa para hoje' },
            { evento: 'PROMESSA_QUEBRADA', descricao: 'Aviso de promessa não cumprida' }
          ]
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: error.message || 'Erro ao consultar a régua de WhatsApp.'
        });
      }
    }
  );

  app.post(
    '/api/admin/financeiro/regua-whatsapp/simular',
    adminRequired,
    financeiroPermissionRequired('financeiro.cobranca'),
    async (req, res) => {
      try {
        const result = await executarReguaWhatsappFinanceira({
          req,
          dataReferencia: req.body?.dataReferencia || new Date(),
          dryRun: true,
          limite: req.body?.limite || 500,
          ignorarHorario: true
        });
        return res.json(result);
      } catch (error) {
        return res.status(error.statusCode || 500).json({
          ok: false,
          error: error.message || 'Erro ao simular a régua de WhatsApp.'
        });
      }
    }
  );

  app.post(
    '/api/admin/financeiro/regua-whatsapp/executar',
    adminRequired,
    financeiroPermissionRequired('financeiro.cobranca'),
    async (req, res) => {
      try {
        const result = await executarReguaWhatsappFinanceira({
          req,
          dataReferencia: req.body?.dataReferencia || new Date(),
          dryRun: req.body?.dryRun === true,
          limite: req.body?.limite || 500,
          ignorarHorario: req.body?.ignorarHorario === true
        });
        return res.json(result);
      } catch (error) {
        return res.status(error.statusCode || 500).json({
          ok: false,
          error: error.message || 'Erro ao executar a régua de WhatsApp.'
        });
      }
    }
  );

  app.get(
    '/api/admin/financeiro/regua-whatsapp/historico',
    adminRequired,
    financeiroPermissionRequired('financeiro.visualizar'),
    async (req, res) => {
      try {
        const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 200));
        const filter = {};
        if (req.query.dataReferencia) filter.dataReferencia = String(req.query.dataReferencia);
        if (req.query.tipoEvento) filter.tipoEvento = String(req.query.tipoEvento);
        if (req.query.enviado === 'true') filter.enviado = true;
        if (req.query.enviado === 'false') filter.enviado = false;

        const logs = await FinanceiroReguaWhatsappLog.find(filter)
          .sort({ createdAt: -1 })
          .limit(limit)
          .lean();

        return res.json({
          ok: true,
          logs,
          total: logs.length
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: error.message || 'Erro ao consultar o histórico da régua.'
        });
      }
    }
  );

  app.get(
    '/api/admin/financeiro/automacao/status',
    adminRequired,
    financeiroPermissionRequired('financeiro.visualizar'),
    async (_req, res) => {
      try {
        const config = getFinanceiroAutomationConfig();
        const [ultima, hoje] = await Promise.all([
          FinanceiroAutomacaoExecucao.findOne({}).sort({ iniciadoEm: -1 }).lean(),
          FinanceiroAutomacaoExecucao.findOne({
            uniqueKey: `DIARIA:${getFinanceiroAutomationClock(new Date(), config.timezone).dateKey}`
          }).lean()
        ]);

        return res.json({
          ok: true,
          configuracao: config,
          clock: getFinanceiroAutomationClock(new Date(), config.timezone),
          executadaHoje: Boolean(hoje),
          execucaoHoje: hoje || null,
          ultimaExecucao: ultima || null,
          schedulerAtivo: Boolean(globalThis.__ARIANA_FINANCEIRO_AUTOMACAO_DIARIA__?.timer),
          schedulerExecutando: Boolean(globalThis.__ARIANA_FINANCEIRO_AUTOMACAO_DIARIA__?.running),
          ultimaVerificacao: globalThis.__ARIANA_FINANCEIRO_AUTOMACAO_DIARIA__?.lastCheck || null
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: error.message || 'Erro ao consultar a automação financeira.'
        });
      }
    }
  );

  app.post(
    '/api/admin/financeiro/automacao/executar',
    adminRequired,
    financeiroPermissionRequired('financeiro.recalcular'),
    async (req, res) => {
      try {
        const result = await executarAutomacaoFinanceiraDiaria({
          actor: getFinanceiroActor(req),
          force: req.body?.force === true,
          tipo: req.body?.tipo || 'MANUAL',
          dataReferencia: req.body?.dataReferencia || new Date()
        });

        return res.json(result);
      } catch (error) {
        return res.status(error.statusCode || 500).json({
          ok: false,
          error: error.message || 'Erro ao executar a automação financeira.'
        });
      }
    }
  );

  app.get(
    '/api/admin/financeiro/automacao/historico',
    adminRequired,
    financeiroPermissionRequired('financeiro.visualizar'),
    async (req, res) => {
      try {
        const limit = Math.max(1, Math.min(Number(req.query.limit || 30), 100));
        const rows = await FinanceiroAutomacaoExecucao.find({})
          .sort({ iniciadoEm: -1 })
          .limit(limit)
          .lean();

        return res.json({
          ok: true,
          execucoes: rows,
          total: rows.length
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: error.message || 'Erro ao consultar o histórico da automação.'
        });
      }
    }
  );

  app.get('/api/admin/financeiro/sincronizacao/status', adminRequired, async (_req, res) => {
    try {
      const [ultimo, pendentes, total] = await Promise.all([
        FinanceiroSincronizacaoLog.findOne({ origem: 'sige' }).sort({ iniciadoEm: -1 }).lean(),
        FinanceiroCarneDigital.countDocuments({
          status: 'ATIVO',
          $or: [
            { ultimaSincronizacaoEm: { $lt: new Date(Date.now() - 60 * 60000) } },
            { ultimaSincronizacaoEm: null },
            { ultimaSincronizacaoEm: { $exists: false } }
          ]
        }),
        FinanceiroCarneDigital.countDocuments({ status: 'ATIVO' })
      ]);

      return res.json({
        ok: true,
        fonte: 'sige',
        totalCarnesAtivos: total,
        desatualizadosMaisDe60Min: pendentes,
        ultimaSincronizacao: ultimo || null,
        automaticoConfigurado: String(process.env.FINANCEIRO_SYNC_ENABLED || 'false').toLowerCase() === 'true',
        intervaloMinutos: Number(process.env.FINANCEIRO_SYNC_INTERVAL_MINUTES || 60),
        limitePorExecucao: Number(process.env.FINANCEIRO_SYNC_BATCH_LIMIT || 100)
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao consultar o status da sincronização.' });
    }
  });

  app.post('/api/admin/financeiro/sincronizacao/executar', adminRequired, async (req, res) => {
    try {
      const body = req.body || {};
      const result = await executarSincronizacaoCarnesSige({
        req,
        somenteDesatualizados: body.somenteDesatualizados !== false,
        minutosDesatualizado: body.minutosDesatualizado || 60,
        limite: body.limite || 100,
        ids: Array.isArray(body.ids) ? body.ids : []
      });
      return res.json(result);
    } catch (error) {
      console.error('[financeiro sincronização SIGE]', error.message || error);
      return res.status(error.statusCode || 500).json({
        ok: false,
        error: error.message || 'Erro ao executar a sincronização financeira.'
      });
    }
  });

  app.get('/api/admin/financeiro/sincronizacao/historico', adminRequired, async (req, res) => {
    try {
      const limit = Math.max(1, Math.min(Number(req.query.limit || 30), 100));
      const rows = await FinanceiroSincronizacaoLog.find({ origem: 'sige' })
        .sort({ iniciadoEm: -1 })
        .limit(limit)
        .lean();
      return res.json({ ok: true, sincronizacoes: rows, total: rows.length });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar o histórico de sincronizações.' });
    }
  });


  app.get(
    '/api/admin/financeiro/configuracao-calculo',
    adminRequired,
    financeiroPermissionRequired('financeiro.visualizar'),
    async (_req, res) => {
      return res.json({ ok: true, configuracao: getFinanceiroCalculationConfig() });
    }
  );

  app.post(
    '/api/admin/financeiro/carnes/:id/recalcular',
    adminRequired,
    financeiroPermissionRequired('financeiro.recalcular'),
    async (req, res) => {
      try {
        const id = String(req.params.id || '').trim();
        const dataReferencia = req.body?.dataReferencia
          ? parseFinanceiroDate(req.body.dataReferencia)
          : new Date();
        if (!dataReferencia || Number.isNaN(dataReferencia.getTime())) {
          return res.status(400).json({ ok: false, error: 'Data de referência inválida.' });
        }

        const filter = mongoose.Types.ObjectId.isValid(id)
          ? { _id: new mongoose.Types.ObjectId(id) }
          : { codigo: id };
        const row = await FinanceiroCarneDigital.findOne(filter);
        if (!row) return res.status(404).json({ ok: false, error: 'Carnê digital não encontrado.' });

        const antes = row.resumo || {};
        const parcelas = normalizarIdentificacaoParcelas(
          Array.isArray(row.parcelas) ? row.parcelas : []
        ).map((p) => ({
          ...p,
          atualizacaoFinanceira: calcularParcelaAtualizadaBackend(p, dataReferencia)
        }));

        const gruposMap = new Map();
        for (const parcela of parcelas) {
          const chave = String(parcela.chave || parcela.documento || 'Sem documento');
          if (!gruposMap.has(chave)) {
            gruposMap.set(chave, {
              documento: chave,
              descricao: parcela.descricao || '',
              codigoVenda: parcela.codigoVenda || 0,
              codigoContrato: parcela.codigoContrato || 0,
              parcelas: [],
              total: 0,
              pago: 0,
              saldo: 0,
              multa: 0,
              juros: 0,
              valorAtualizado: 0,
              pagas: 0,
              abertas: 0,
              atrasadas: 0
            });
          }
          const g = gruposMap.get(chave);
          g.parcelas.push(parcela);
          g.total += Number(parcela.valorParcela || parcela.valor || 0);
          g.pago += Number(parcela.valorPago || parcela.totalRecebido || 0);
          g.saldo += Number(parcela.saldoParcela || parcela.saldo || 0);
          g.multa += Number(parcela.atualizacaoFinanceira?.multa || 0);
          g.juros += Number(parcela.atualizacaoFinanceira?.juros || 0);
          g.valorAtualizado += Number(parcela.atualizacaoFinanceira?.valorAtualizado || 0);
          if (parcela.status === 'paga') g.pagas += 1;
          if (parcela.status === 'aberta') g.abertas += 1;
          if (parcela.status === 'atrasada') g.atrasadas += 1;
        }

        const grupos = Array.from(gruposMap.values()).map((g) => ({
          ...g,
          total: Number(g.total.toFixed(2)),
          pago: Number(g.pago.toFixed(2)),
          saldo: Number(g.saldo.toFixed(2)),
          multa: Number(g.multa.toFixed(2)),
          juros: Number(g.juros.toFixed(2)),
          valorAtualizado: Number(g.valorAtualizado.toFixed(2))
        }));

        const resumo = grupos.reduce((acc, g) => {
          acc.total += g.total;
          acc.pago += g.pago;
          acc.saldo += g.saldo;
          acc.multa += g.multa;
          acc.juros += g.juros;
          acc.valorAtualizado += g.valorAtualizado;
          acc.parcelas += g.parcelas.length;
          acc.pagas += g.pagas;
          acc.abertas += g.abertas;
          acc.atrasadas += g.atrasadas;
          return acc;
        }, { total: 0, pago: 0, saldo: 0, multa: 0, juros: 0, valorAtualizado: 0, parcelas: 0, pagas: 0, abertas: 0, atrasadas: 0 });

        for (const key of ['total', 'pago', 'saldo', 'multa', 'juros', 'valorAtualizado']) {
          resumo[key] = Number(Number(resumo[key] || 0).toFixed(2));
        }
        resumo.calculoFinanceiro = getFinanceiroCalculationConfig();
        resumo.calculadoEm = dataReferencia.toISOString();

        row.parcelas = parcelas;
        row.grupos = grupos;
        row.resumo = resumo;
        row.historico = Array.isArray(row.historico) ? row.historico : [];
        row.historico.push({
          tipo: 'RECALCULO_FINANCEIRO',
          em: new Date(),
          dataReferencia,
          por: getFinanceiroActor(req),
          resumoAnterior: antes,
          resumoAtual: resumo
        });
        if (row.historico.length > 100) row.historico = row.historico.slice(-100);
        await row.save();

        await registrarAuditoriaFinanceira({
          req,
          acao: 'CARNE_RECALCULADO',
          entidade: 'FinanceiroCarneDigital',
          entidadeId: String(row._id),
          codigo: row.codigo,
          antes,
          depois: resumo,
          metadata: { dataReferencia: dataReferencia.toISOString() }
        });

        return res.json({
          ok: true,
          message: 'Valores atualizados no backend sem criar outro carnê.',
          carne: normalizeCarneDigital(row)
        });
      } catch (error) {
        await registrarAuditoriaFinanceira({
          req,
          acao: 'CARNE_RECALCULO_FALHOU',
          entidade: 'FinanceiroCarneDigital',
          entidadeId: String(req.params.id || ''),
          sucesso: false,
          erro: error.message || String(error)
        });
        return res.status(error.statusCode || 500).json({
          ok: false,
          error: error.message || 'Erro ao recalcular o carnê.'
        });
      }
    }
  );

  app.get(
    '/api/admin/financeiro/auditoria',
    adminRequired,
    financeiroPermissionRequired('financeiro.auditoria'),
    async (req, res) => {
      try {
        const q = String(req.query.q || '').trim();
        const acao = String(req.query.acao || '').trim();
        const sucesso = String(req.query.sucesso || '').trim();
        const page = Math.max(1, Number(req.query.page || 1));
        const limit = Math.max(1, Math.min(Number(req.query.limit || 30), 100));
        const filter = { modulo: 'financeiro' };

        if (acao) filter.acao = acao;
        if (sucesso === 'true') filter.sucesso = true;
        if (sucesso === 'false') filter.sucesso = false;
        if (q) {
          const regex = new RegExp(escapeRegex(q), 'i');
          filter.$or = [
            { codigo: regex },
            { usuario: regex },
            { entidadeId: regex },
            { acao: regex }
          ];
        }

        const [rows, total] = await Promise.all([
          FinanceiroAuditoria.find(filter)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean(),
          FinanceiroAuditoria.countDocuments(filter)
        ]);

        return res.json({
          ok: true,
          auditoria: rows,
          total,
          page,
          limit,
          pages: Math.max(1, Math.ceil(total / limit))
        });
      } catch (error) {
        return res.status(500).json({ ok: false, error: error.message || 'Erro ao consultar a auditoria financeira.' });
      }
    }
  );


  app.post(
    '/api/admin/financeiro/carnes/:id/enviar-whatsapp',
    adminRequired,
    financeiroPermissionRequired('financeiro.enviar_whatsapp'),
    async (req, res) => {
      try {
        const id = String(req.params.id || '').trim();
        const filter = mongoose.Types.ObjectId.isValid(id)
          ? { _id: new mongoose.Types.ObjectId(id) }
          : { codigo: id };
        const row = await FinanceiroCarneDigital.findOne(filter);
        if (!row) return res.status(404).json({ ok: false, error: 'Carnê digital não encontrado.' });

        const telefone = normalizePhone(
          req.body?.telefone || row.cliente?.telefone || '',
          '55'
        );
        if (!telefone) {
          return res.status(400).json({ ok: false, error: 'Cliente sem WhatsApp cadastrado.' });
        }

        const documento = String(
          req.body?.documento ||
          req.body?.numeroDocumento ||
          req.body?.compra ||
          ''
        ).trim();

        if (!documento) {
          return res.status(400).json({
            ok: false,
            error: 'Escolha a compra que deseja enviar.'
          });
        }

        const text = buildSavedCarneWhatsappMessage(row, { documento });
        const whatsapp = await waSendTextMessage({ number: telefone, text });

        await registrarAuditoriaFinanceira({
          req,
          acao: 'CARNE_ENVIADO_WHATSAPP',
          entidade: 'FinanceiroCarneDigital',
          entidadeId: String(row._id),
          codigo: row.codigo,
          depois: { telefone, documento, enviado: true },
          metadata: {
            documento,
            envioIndividual: true,
            whatsapp: redact(whatsapp || null)
          }
        });

        return res.json({
          ok: true,
          message: 'Carnê da compra selecionada enviado pelo WhatsApp.',
          telefone,
          documento,
          whatsapp
        });
      } catch (error) {
        await registrarAuditoriaFinanceira({
          req,
          acao: 'CARNE_WHATSAPP_FALHOU',
          entidade: 'FinanceiroCarneDigital',
          entidadeId: String(req.params.id || ''),
          sucesso: false,
          erro: error.message || String(error)
        });
        return res.status(error.statusCode || 500).json({
          ok: false,
          error: error.message || 'Erro ao enviar o carnê pelo WhatsApp.'
        });
      }
    }
  );

  app.patch(
    '/api/admin/financeiro/carnes/:id/status',
    adminRequired,
    financeiroPermissionRequired('financeiro.alterar_status'),
    async (req, res) => {
      try {
        const id = String(req.params.id || '').trim();
        const status = String(req.body?.status || '').trim().toUpperCase();
        const allowed = new Set(['ATIVO', 'ARQUIVADO', 'BLOQUEADO']);
        if (!allowed.has(status)) {
          return res.status(400).json({ ok: false, error: 'Status inválido.' });
        }

        const filter = mongoose.Types.ObjectId.isValid(id)
          ? { _id: new mongoose.Types.ObjectId(id) }
          : { codigo: id };
        const row = await FinanceiroCarneDigital.findOne(filter);
        if (!row) return res.status(404).json({ ok: false, error: 'Carnê digital não encontrado.' });

        const anterior = row.status;
        row.status = status;
        row.historico = Array.isArray(row.historico) ? row.historico : [];
        row.historico.push({
          tipo: 'STATUS_ALTERADO',
          em: new Date(),
          por: getFinanceiroActor(req),
          statusAnterior: anterior,
          statusAtual: status,
          motivo: String(req.body?.motivo || '')
        });
        if (row.historico.length > 100) row.historico = row.historico.slice(-100);
        await row.save();

        await registrarAuditoriaFinanceira({
          req,
          acao: 'CARNE_STATUS_ALTERADO',
          entidade: 'FinanceiroCarneDigital',
          entidadeId: String(row._id),
          codigo: row.codigo,
          antes: { status: anterior },
          depois: { status },
          metadata: { motivo: String(req.body?.motivo || '') }
        });

        return res.json({
          ok: true,
          message: `Carnê alterado para ${status}.`,
          carne: normalizeCarneDigital(row)
        });
      } catch (error) {
        return res.status(500).json({ ok: false, error: error.message || 'Erro ao alterar o status do carnê.' });
      }
    }
  );

  function normalizarCoraChargeParaSegundaVia(charge = {}) {
    const invoices = Array.isArray(charge.invoices) ? charge.invoices : [];
    return {
      id: String(charge._id || charge.id || ''),
      code: String(charge.code || ''),
      internalReference: String(charge.internalReference || ''),
      orderId: String(charge.orderId || ''),
      environment: String(charge.environment || ''),
      status: String(charge.status || 'UNKNOWN'),
      documentUrl: String(charge.documentUrl || ''),
      totalAmountCents: Number(charge.totalAmountCents || 0),
      installments: Number(charge.installments || invoices.length || 0),
      createdAt: charge.createdAt || null,
      customer: {
        name: String(charge.customer?.name || ''),
        document: String(charge.customer?.document?.identity || '')
      },
      invoices: invoices.map((invoice, index) => ({
        numero: index + 1,
        id: String(invoice?.id || invoice?.invoice_id || ''),
        status: String(invoice?.status || 'UNKNOWN'),
        totalAmountCents: Number(invoice?.total_amount || invoice?.totalAmount || 0),
        totalPaidCents: Number(invoice?.total_paid || invoice?.totalPaid || 0),
        dueDate: invoice?.payment_terms?.due_date || invoice?.due_date || null,
        description: String(invoice?.services?.[0]?.name || invoice?.description || ''),
        barcode: String(invoice?.payment_options?.bank_slip?.barcode || ''),
        digitable: String(invoice?.payment_options?.bank_slip?.digitable || ''),
        ourNumber: String(invoice?.payment_options?.bank_slip?.our_number || ''),
        url: String(invoice?.payment_options?.bank_slip?.url || '')
      }))
    };
  }

  async function salvarVinculoCoraNoCarne({ row, charge, req, origem = 'MANUAL' } = {}) {
    if (!row || !charge) return null;
    const antes = {
      coraChargeId: row.coraChargeId || '',
      coraCode: row.coraCode || '',
      coraInternalReference: row.coraInternalReference || ''
    };

    row.coraChargeId = String(charge._id || charge.id || '');
    row.coraCode = String(charge.code || '');
    row.coraInternalReference = String(charge.internalReference || '');
    row.coraDocumentUrl = String(charge.documentUrl || '');
    row.coraStatus = String(charge.status || '');
    row.coraVinculadoEm = new Date();
    row.coraVinculadoPor = getFinanceiroActor(req);
    row.historico = Array.isArray(row.historico) ? row.historico : [];
    row.historico.push({
      tipo: 'CORA_VINCULADO',
      em: new Date(),
      por: getFinanceiroActor(req),
      origem,
      chargeId: row.coraChargeId,
      code: row.coraCode,
      internalReference: row.coraInternalReference
    });
    if (row.historico.length > 100) row.historico = row.historico.slice(-100);
    await row.save();

    await registrarAuditoriaFinanceira({
      req,
      acao: 'CARNE_CORA_VINCULADO',
      entidade: 'FinanceiroCarneDigital',
      entidadeId: String(row._id),
      codigo: row.codigo,
      antes,
      depois: {
        coraChargeId: row.coraChargeId,
        coraCode: row.coraCode,
        coraInternalReference: row.coraInternalReference
      },
      metadata: { origem, somenteVinculo: true }
    });
    return row;
  }

  app.post(
    '/api/admin/financeiro/carnes/:id/cora-vinculo',
    adminRequired,
    financeiroPermissionRequired('financeiro.editar'),
    async (req, res) => {
      try {
        const id = String(req.params.id || '').trim();
        const chargeId = String(req.body?.chargeId || '').trim();
        if (!chargeId) return res.status(400).json({ ok: false, error: 'Informe a emissão Cora que será vinculada.' });

        const filter = mongoose.Types.ObjectId.isValid(id)
          ? { _id: new mongoose.Types.ObjectId(id) }
          : { codigo: id };
        const row = await FinanceiroCarneDigital.findOne(filter);
        if (!row) return res.status(404).json({ ok: false, error: 'Carnê digital não encontrado.' });

        const bancoFinanceiro = mongoose.connection.client.db(
          MONGODB_DB || process.env.MONGODB_DB || mongoose.connection.db?.databaseName
        );
        const coraCharges = bancoFinanceiro.collection('cora_charges');
        const chargeFilter = mongoose.Types.ObjectId.isValid(chargeId)
          ? { _id: new mongoose.Types.ObjectId(chargeId) }
          : { $or: [{ code: chargeId }, { internalReference: chargeId }] };
        const charge = await coraCharges.findOne(chargeFilter);
        if (!charge) return res.status(404).json({ ok: false, error: 'Emissão Cora não encontrada.' });

        const cpfCarne = cleanPhone(row.cliente?.cpf || '');
        const cpfCora = cleanPhone(charge.customer?.document?.identity || '');
        if (cpfCarne && cpfCora && cpfCarne !== cpfCora && req.body?.confirmarCpfDiferente !== true) {
          return res.status(409).json({
            ok: false,
            error: 'O CPF da emissão Cora é diferente do CPF do carnê. O vínculo não foi realizado.',
            code: 'CORA_CPF_DIFERENTE'
          });
        }

        await salvarVinculoCoraNoCarne({ row, charge, req, origem: 'MANUAL_PAINEL' });
        return res.json({
          ok: true,
          message: 'Emissão Cora vinculada ao carnê com sucesso.',
          carne: normalizeCarneDigital(row),
          coraCharge: normalizarCoraChargeParaSegundaVia(charge)
        });
      } catch (error) {
        return res.status(500).json({ ok: false, error: error.message || 'Erro ao vincular a emissão Cora.' });
      }
    }
  );

  app.delete(
    '/api/admin/financeiro/carnes/:id/cora-vinculo',
    adminRequired,
    financeiroPermissionRequired('financeiro.editar'),
    async (req, res) => {
      try {
        const id = String(req.params.id || '').trim();
        const filter = mongoose.Types.ObjectId.isValid(id)
          ? { _id: new mongoose.Types.ObjectId(id) }
          : { codigo: id };
        const row = await FinanceiroCarneDigital.findOne(filter);
        if (!row) return res.status(404).json({ ok: false, error: 'Carnê digital não encontrado.' });

        const antes = {
          coraChargeId: row.coraChargeId || '',
          coraCode: row.coraCode || '',
          coraInternalReference: row.coraInternalReference || ''
        };
        row.coraChargeId = '';
        row.coraCode = '';
        row.coraInternalReference = '';
        row.coraDocumentUrl = '';
        row.coraStatus = '';
        row.coraVinculadoEm = null;
        row.coraVinculadoPor = '';
        row.historico = Array.isArray(row.historico) ? row.historico : [];
        row.historico.push({ tipo: 'CORA_DESVINCULADO', em: new Date(), por: getFinanceiroActor(req), antes });
        if (row.historico.length > 100) row.historico = row.historico.slice(-100);
        await row.save();

        await registrarAuditoriaFinanceira({
          req,
          acao: 'CARNE_CORA_DESVINCULADO',
          entidade: 'FinanceiroCarneDigital',
          entidadeId: String(row._id),
          codigo: row.codigo,
          antes,
          depois: { coraChargeId: '', coraCode: '', coraInternalReference: '' }
        });

        return res.json({ ok: true, message: 'Vínculo Cora removido.', carne: normalizeCarneDigital(row) });
      } catch (error) {
        return res.status(500).json({ ok: false, error: error.message || 'Erro ao remover o vínculo Cora.' });
      }
    }
  );

  app.get(
    '/api/admin/financeiro/carnes/:id/segunda-via',
    adminRequired,
    financeiroPermissionRequired('financeiro.visualizar'),
    async (req, res) => {
      try {
        const id = String(req.params.id || '').trim();
        const filter = mongoose.Types.ObjectId.isValid(id)
          ? { _id: new mongoose.Types.ObjectId(id) }
          : { codigo: id };
        const row = await FinanceiroCarneDigital.findOne(filter);
        if (!row) return res.status(404).json({ ok: false, error: 'Carnê digital não encontrado.' });

        const bancoFinanceiro = mongoose.connection.client.db(
          MONGODB_DB || process.env.MONGODB_DB || mongoose.connection.db?.databaseName
        );
        const coraCharges = bancoFinanceiro.collection('cora_charges');

        // 1. Um vínculo salvo sempre tem prioridade absoluta.
        let chargeVinculada = null;
        if (row.coraChargeId) {
          const linkedFilter = mongoose.Types.ObjectId.isValid(row.coraChargeId)
            ? { _id: new mongoose.Types.ObjectId(row.coraChargeId) }
            : { $or: [{ code: row.coraChargeId }, { internalReference: row.coraChargeId }] };
          chargeVinculada = await coraCharges.findOne(linkedFilter);
          if (chargeVinculada) {
            row.coraCode = String(chargeVinculada.code || row.coraCode || '');
            row.coraInternalReference = String(chargeVinculada.internalReference || row.coraInternalReference || '');
            row.coraDocumentUrl = String(chargeVinculada.documentUrl || row.coraDocumentUrl || '');
            row.coraStatus = String(chargeVinculada.status || row.coraStatus || '');
            await row.save();
          }
        }

        const cpf = cleanPhone(row.cliente?.cpf || '');
        const referencias = [
          row.codigo,
          row.uniqueKey,
          ...(Array.isArray(row.grupos) ? row.grupos.flatMap((grupo) => [
            grupo?.documento,
            grupo?.codigo,
            grupo?.codigoVenda,
            grupo?.descricao
          ]) : [])
        ].map((value) => String(value || '').trim()).filter(Boolean);

        const filtros = [];
        if (cpf) filtros.push({ 'customer.document.identity': cpf });
        for (const referencia of referencias.slice(0, 20)) {
          filtros.push({ internalReference: referencia });
          filtros.push({ code: referencia });
        }

        const rowsCora = filtros.length
          ? await coraCharges.find({ $or: filtros }).sort({ createdAt: -1 }).limit(20).toArray()
          : [];

        if (chargeVinculada && !rowsCora.some((item) => String(item._id) === String(chargeVinculada._id))) {
          rowsCora.unshift(chargeVinculada);
        }

        const tokensReferencia = referencias
          .flatMap((value) => String(value).match(/\d{3,}/g) || [])
          .filter((value, index, arr) => arr.indexOf(value) === index);

        const cobrancas = rowsCora.map((charge) => {
          const texto = JSON.stringify({
            code: charge.code,
            internalReference: charge.internalReference,
            orderId: charge.orderId,
            invoices: charge.invoices
          }).toLowerCase();
          const cpfCharge = cleanPhone(charge.customer?.document?.identity || '');
          const linked = Boolean(row.coraChargeId && String(charge._id) === String(row.coraChargeId));
          let score = linked ? 10000 : (cpf && cpfCharge === cpf ? 100 : 0);
          score += tokensReferencia.filter((token) => texto.includes(token.toLowerCase())).length * 20;
          return { score, linked, raw: charge, charge: normalizarCoraChargeParaSegundaVia(charge) };
        }).sort((a, b) => b.score - a.score || new Date(b.charge.createdAt || 0) - new Date(a.charge.createdAt || 0));

        // 2. Migração automática segura para carnês antigos:
        // somente quando há uma única emissão para o CPF, ou um vencedor inequívoco por referência.
        let vinculoAutomatico = false;
        if (!row.coraChargeId && cobrancas.length) {
          const top = cobrancas[0];
          const second = cobrancas[1];
          const unicoCpf = cobrancas.length === 1 && top.score >= 100;
          const vencedorPorReferencia = top.score >= 120 && (!second || top.score - second.score >= 20);
          if (unicoCpf || vencedorPorReferencia) {
            await salvarVinculoCoraNoCarne({ row, charge: top.raw, req, origem: 'AUTOMATICO_SEGUNDA_VIA' });
            top.linked = true;
            top.score = 10000;
            vinculoAutomatico = true;
            cobrancas.sort((a, b) => b.score - a.score);
          }
        }

        await registrarAuditoriaFinanceira({
          req,
          acao: 'CARNE_SEGUNDA_VIA_ABERTA',
          entidade: 'FinanceiroCarneDigital',
          entidadeId: String(row._id),
          codigo: row.codigo,
          metadata: {
            coraEncontrados: cobrancas.length,
            coraSelecionadoId: cobrancas[0]?.charge?.id || '',
            coraVinculadoId: row.coraChargeId || '',
            vinculoAutomatico,
            somenteConsulta: true
          }
        });

        return res.json({
          ok: true,
          carne: normalizeCarneDigital(row),
          coraCharge: cobrancas[0]?.charge || null,
          coraCharges: cobrancas.map((item) => ({ ...item.charge, linked: item.linked })),
          coraLinkedChargeId: row.coraChargeId || '',
          coraVinculoAutomatico: vinculoAutomatico,
          coraMatchAmbiguous: !row.coraChargeId && cobrancas.length > 1 && cobrancas[0].score === cobrancas[1].score,
          message: cobrancas.length
            ? (row.coraChargeId
              ? 'Segunda via aberta pela emissão Cora vinculada ao carnê.'
              : 'Segunda via localizada nos boletos Cora já emitidos.')
            : 'Carnê carregado, mas nenhum boleto Cora emitido foi localizado para este cliente.'
        });
      } catch (error) {
        return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar a segunda via.' });
      }
    }
  );

  app.post(
    '/api/admin/financeiro/carnes/:id/renegociacoes/preview',
    adminRequired,
    financeiroPermissionRequired('financeiro.renegociar'),
    async (req, res) => {
      try {
        const id = String(req.params.id || '').trim();
        const filter = mongoose.Types.ObjectId.isValid(id)
          ? { _id: new mongoose.Types.ObjectId(id) }
          : { codigo: id };
        const row = await FinanceiroCarneDigital.findOne(filter);
        if (!row) return res.status(404).json({ ok: false, error: 'Carnê digital não encontrado.' });

        const resumo = row.resumo || {};
        const valorBase = Number(
          req.body?.valorBase ??
          resumo.valorAtualizado ??
          resumo.saldo ??
          0
        );
        const entrada = Math.max(0, Number(req.body?.entrada || 0));
        const quantidadeParcelas = Math.max(1, Math.min(Number(req.body?.quantidadeParcelas || 1), 36));
        const primeiroVencimento = String(req.body?.primeiroVencimento || '').slice(0, 10);
        const saldoRenegociado = Math.max(0, valorBase - entrada);
        const valorParcela = Number((saldoRenegociado / quantidadeParcelas).toFixed(2));
        const vencimentos = buildMonthlyDueDates(primeiroVencimento, quantidadeParcelas);

        if (!Number.isFinite(valorBase) || valorBase <= 0) {
          return res.status(400).json({ ok: false, error: 'Valor base inválido para renegociação.' });
        }
        if (!vencimentos.length) {
          return res.status(400).json({ ok: false, error: 'Primeiro vencimento inválido.' });
        }

        return res.json({
          ok: true,
          preview: true,
          proposta: {
            carneId: String(row._id),
            carneCodigo: row.codigo,
            clienteNome: row.cliente?.nome || '',
            saldoOriginal: Number(resumo.saldo || 0),
            multaOriginal: Number(resumo.multa || 0),
            jurosOriginal: Number(resumo.juros || 0),
            valorBase: Number(valorBase.toFixed(2)),
            entrada: Number(entrada.toFixed(2)),
            saldoRenegociado: Number(saldoRenegociado.toFixed(2)),
            quantidadeParcelas,
            valorParcela,
            primeiroVencimento,
            vencimentos
          },
          note: 'Esta é uma proposta. O carnê original permanece preservado e não é substituído.'
        });
      } catch (error) {
        return res.status(500).json({ ok: false, error: error.message || 'Erro ao preparar a renegociação.' });
      }
    }
  );

  app.post(
    '/api/admin/financeiro/carnes/:id/renegociacoes',
    adminRequired,
    financeiroPermissionRequired('financeiro.renegociar'),
    async (req, res) => {
      try {
        const id = String(req.params.id || '').trim();
        const filter = mongoose.Types.ObjectId.isValid(id)
          ? { _id: new mongoose.Types.ObjectId(id) }
          : { codigo: id };
        const row = await FinanceiroCarneDigital.findOne(filter);
        if (!row) return res.status(404).json({ ok: false, error: 'Carnê digital não encontrado.' });

        const resumo = row.resumo || {};
        const valorBase = Number(req.body?.valorBase ?? resumo.valorAtualizado ?? resumo.saldo ?? 0);
        const entrada = Math.max(0, Number(req.body?.entrada || 0));
        const quantidadeParcelas = Math.max(1, Math.min(Number(req.body?.quantidadeParcelas || 1), 36));
        const primeiroVencimento = String(req.body?.primeiroVencimento || '').slice(0, 10);
        const saldoRenegociado = Math.max(0, valorBase - entrada);
        const valorParcela = Number((saldoRenegociado / quantidadeParcelas).toFixed(2));
        const vencimentos = buildMonthlyDueDates(primeiroVencimento, quantidadeParcelas);

        if (!Number.isFinite(valorBase) || valorBase <= 0) {
          return res.status(400).json({ ok: false, error: 'Valor base inválido.' });
        }
        if (!vencimentos.length) {
          return res.status(400).json({ ok: false, error: 'Primeiro vencimento inválido.' });
        }

        const proposta = await FinanceiroRenegociacao.create({
          carneId: row._id,
          carneCodigo: row.codigo,
          clienteNome: row.cliente?.nome || '',
          status: 'PROPOSTA',
          saldoOriginal: Number(resumo.saldo || 0),
          multaOriginal: Number(resumo.multa || 0),
          jurosOriginal: Number(resumo.juros || 0),
          valorBase: Number(valorBase.toFixed(2)),
          entrada: Number(entrada.toFixed(2)),
          saldoRenegociado: Number(saldoRenegociado.toFixed(2)),
          quantidadeParcelas,
          valorParcela,
          primeiroVencimento: vencimentos[0],
          vencimentos,
          observacao: String(req.body?.observacao || ''),
          criadoPor: getFinanceiroActor(req),
          snapshotOriginal: normalizeCarneDigital(row)
        });

        row.historico = Array.isArray(row.historico) ? row.historico : [];
        row.historico.push({
          tipo: 'RENEGOCIACAO_PROPOSTA_CRIADA',
          em: new Date(),
          por: getFinanceiroActor(req),
          renegociacaoId: String(proposta._id),
          valorBase: proposta.valorBase,
          entrada: proposta.entrada,
          saldoRenegociado: proposta.saldoRenegociado,
          quantidadeParcelas: proposta.quantidadeParcelas
        });
        if (row.historico.length > 100) row.historico = row.historico.slice(-100);
        await row.save();

        await registrarAuditoriaFinanceira({
          req,
          acao: 'RENEGOCIACAO_PROPOSTA_CRIADA',
          entidade: 'FinanceiroRenegociacao',
          entidadeId: String(proposta._id),
          codigo: row.codigo,
          depois: proposta.toObject(),
          metadata: { carneId: String(row._id) }
        });

        return res.status(201).json({
          ok: true,
          message: 'Proposta de renegociação salva sem alterar o carnê original.',
          renegociacao: proposta
        });
      } catch (error) {
        return res.status(500).json({ ok: false, error: error.message || 'Erro ao salvar a proposta de renegociação.' });
      }
    }
  );

  app.get(
    '/api/admin/financeiro/carnes/:id/renegociacoes',
    adminRequired,
    financeiroPermissionRequired('financeiro.visualizar'),
    async (req, res) => {
      try {
        const id = String(req.params.id || '').trim();
        const filter = mongoose.Types.ObjectId.isValid(id)
          ? { $or: [{ carneId: new mongoose.Types.ObjectId(id) }, { carneCodigo: id }] }
          : { carneCodigo: id };
        const rows = await FinanceiroRenegociacao.find(filter).sort({ createdAt: -1 }).lean();
        return res.json({ ok: true, renegociacoes: rows, total: rows.length });
      } catch (error) {
        return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar renegociações.' });
      }
    }
  );


  app.post(
    '/api/admin/financeiro/fila-cobranca/gerar',
    adminRequired,
    financeiroPermissionRequired('financeiro.cobranca'),
    async (req, res) => {
      try {
        const dataReferencia = req.body?.dataReferencia || new Date();
        const result = await gerarFilaCobrancaDia({
          req,
          dataReferencia,
          limiteCarnes: req.body?.limiteCarnes || 1000
        });
        return res.json(result);
      } catch (error) {
        return res.status(error.statusCode || 500).json({
          ok: false,
          error: error.message || 'Erro ao gerar a fila diária de cobrança.'
        });
      }
    }
  );

  app.post(
    '/api/admin/financeiro/fila-cobranca/adicionar-sige',
    adminRequired,
    financeiroPermissionRequired('financeiro.cobranca'),
    async (req, res) => {
      try {
        const clientes = Array.isArray(req.body?.clientes) ? req.body.clientes.slice(0, 50) : [];
        const dataReferencia = req.body?.dataReferencia || new Date();
        if (!clientes.length) {
          return res.status(400).json({ ok: false, error: 'Selecione ao menos um cliente do SIGE.' });
        }

        const resultados = [];
        let clientesAdicionados = 0;
        let tarefasCriadas = 0;
        let tarefasAtualizadas = 0;
        let tarefasPreservadas = 0;
        let erros = 0;

        for (const cliente of clientes) {
          const termo = String(cliente?.cpf || cliente?.nome || cliente?.q || '').trim();
          if (termo.length < 2) {
            erros += 1;
            resultados.push({ ok: false, nome: String(cliente?.nome || ''), error: 'Cliente sem identificação para consulta.' });
            continue;
          }

          try {
            const sincronizacao = await sincronizarCarneDigitalSige(termo, req, {
              limit: 5000,
              maxRecords: 20000,
              termos: [cliente?.nome, cliente?.cpf, cliente?.telefone]
            });
            const carneId = sincronizacao?.carne?.id;
            const carne = carneId ? await FinanceiroCarneDigital.findById(carneId) : null;
            if (!carne) throw new Error('Carnê sincronizado não foi localizado.');

            const fila = await upsertCarneNaFilaCobranca(carne, dataReferencia, { somenteVencidas: true });
            clientesAdicionados += 1;
            tarefasCriadas += fila.criados;
            tarefasAtualizadas += fila.atualizados;
            tarefasPreservadas += fila.preservados;
            resultados.push({
              ok: true,
              nome: carne.cliente?.nome || cliente?.nome || '',
              carneId: String(carne._id),
              carneCodigo: carne.codigo,
              criadoAgora: sincronizacao.criadoAgora === true,
              fila
            });
          } catch (error) {
            erros += 1;
            resultados.push({ ok: false, nome: String(cliente?.nome || termo), error: error.message || String(error) });
          }
        }

        await registrarAuditoriaFinanceira({
          req,
          acao: 'FILA_COBRANCA_IMPORTADA_SIGE',
          entidade: 'FinanceiroFilaCobranca',
          codigo: dateKey(dataReferencia),
          depois: {
            selecionados: clientes.length,
            clientesAdicionados,
            tarefasCriadas,
            tarefasAtualizadas,
            tarefasPreservadas,
            erros
          }
        });

        return res.status(clientesAdicionados > 0 ? 200 : 422).json({
          ok: clientesAdicionados > 0,
          message: clientesAdicionados > 0
            ? `${clientesAdicionados} cliente(s) do SIGE incluído(s) na Fila do Dia.`
            : 'Nenhum cliente pôde ser incluído na Fila do Dia.',
          selecionados: clientes.length,
          clientesAdicionados,
          tarefasCriadas,
          tarefasAtualizadas,
          tarefasPreservadas,
          erros,
          resultados
        });
      } catch (error) {
        return res.status(error.statusCode || 500).json({
          ok: false,
          error: error.message || 'Erro ao adicionar clientes do SIGE à Fila do Dia.'
        });
      }
    }
  );

  app.get(
    '/api/admin/financeiro/fila-cobranca',
    adminRequired,
    financeiroPermissionRequired('financeiro.visualizar'),
    async (req, res) => {
      try {
        const dataReferencia = String(req.query.dataReferencia || dateKey(new Date())).slice(0, 10);
        const q = String(req.query.q || '').trim();
        const faixa = String(req.query.faixa || '').trim().toUpperCase();
        const prioridade = String(req.query.prioridade || '').trim().toUpperCase();
        const status = String(req.query.status || '').trim().toUpperCase();
        const semContato = String(req.query.semContato || '').trim();
        const page = Math.max(1, Number(req.query.page || 1));
        const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 200));

        const filter = { dataReferencia };
        if (faixa) filter.faixa = faixa;
        if (prioridade) filter.prioridade = prioridade;
        if (status) filter.status = status;
        if (semContato === 'true') filter.semContato = true;
        if (semContato === 'false') filter.semContato = false;

        if (q) {
          const regex = new RegExp(escapeRegex(q), 'i');
          const digits = cleanPhone(q);
          filter.$or = [
            { clienteNome: regex },
            { carneCodigo: regex },
            { documento: regex }
          ];
          if (digits) {
            filter.$or.push({ clienteCpf: new RegExp(escapeRegex(digits), 'i') });
            filter.$or.push({ telefone: new RegExp(escapeRegex(digits), 'i') });
          }
        }

        const summaryPipeline = [
          { $match: filter },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              valorAtualizado: { $sum: '$valorAtualizado' },
              pendentes: { $sum: { $cond: [{ $eq: ['$status', 'PENDENTE'] }, 1, 0] } },
              concluidos: { $sum: { $cond: [{ $eq: ['$status', 'CONCLUIDO'] }, 1, 0] } },
              semContato: { $sum: { $cond: ['$semContato', 1, 0] } },
              criticos: { $sum: { $cond: [{ $eq: ['$prioridade', 'CRITICA'] }, 1, 0] } },
              altas: { $sum: { $cond: [{ $eq: ['$prioridade', 'ALTA'] }, 1, 0] } }
            }
          }
        ];

        const faixaPipeline = [
          { $match: filter },
          {
            $group: {
              _id: '$faixa',
              quantidade: { $sum: 1 },
              valorAtualizado: { $sum: '$valorAtualizado' }
            }
          },
          { $sort: { quantidade: -1 } }
        ];

        const [rows, total, summaryRows, faixas] = await Promise.all([
          FinanceiroFilaCobranca.find(filter)
            .sort({ prioridadeScore: -1, diasAtraso: -1, valorAtualizado: -1, vencimento: 1 })
            .skip((page - 1) * limit)
            .limit(limit),
          FinanceiroFilaCobranca.countDocuments(filter),
          FinanceiroFilaCobranca.aggregate(summaryPipeline),
          FinanceiroFilaCobranca.aggregate(faixaPipeline)
        ]);

        const s = summaryRows[0] || {};
        return res.json({
          ok: true,
          fila: rows.map(normalizeFilaCobranca),
          total,
          page,
          limit,
          pages: Math.max(1, Math.ceil(total / limit)),
          resumo: {
            total: Number(s.total || 0),
            valorAtualizado: Number(Number(s.valorAtualizado || 0).toFixed(2)),
            pendentes: Number(s.pendentes || 0),
            concluidos: Number(s.concluidos || 0),
            semContato: Number(s.semContato || 0),
            criticos: Number(s.criticos || 0),
            altas: Number(s.altas || 0)
          },
          faixas: faixas.map((row) => ({
            faixa: row._id || 'SEM_FAIXA',
            quantidade: Number(row.quantidade || 0),
            valorAtualizado: Number(Number(row.valorAtualizado || 0).toFixed(2))
          })),
          filtros: { dataReferencia, q, faixa, prioridade, status, semContato }
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: error.message || 'Erro ao carregar a fila diária de cobrança.'
        });
      }
    }
  );

  app.patch(
    '/api/admin/financeiro/fila-cobranca/:id',
    adminRequired,
    financeiroPermissionRequired('financeiro.cobranca'),
    async (req, res) => {
      try {
        const id = String(req.params.id || '').trim();
        if (!mongoose.Types.ObjectId.isValid(id)) {
          return res.status(400).json({ ok: false, error: 'Item da fila inválido.' });
        }

        const row = await FinanceiroFilaCobranca.findById(id);
        if (!row) return res.status(404).json({ ok: false, error: 'Item da fila não encontrado.' });

        const allowedStatus = new Set(['PENDENTE', 'EM_ATENDIMENTO', 'CONTATADO', 'CONCLUIDO', 'ADIADO', 'SEM_CONTATO']);
        const novoStatus = String(req.body?.status || row.status || '').trim().toUpperCase();
        if (!allowedStatus.has(novoStatus)) {
          return res.status(400).json({ ok: false, error: 'Status da fila inválido.' });
        }

        const antes = normalizeFilaCobranca(row);
        row.status = novoStatus;
        row.responsavel = String(req.body?.responsavel || row.responsavel || getFinanceiroActor(req));
        row.ultimaAcao = String(req.body?.ultimaAcao || req.body?.acao || novoStatus);
        row.ultimaAcaoEm = new Date();
        if (req.body?.proximaAcaoEm) {
          const next = new Date(req.body.proximaAcaoEm);
          if (Number.isNaN(next.getTime())) {
            return res.status(400).json({ ok: false, error: 'Data da próxima ação inválida.' });
          }
          row.proximaAcaoEm = next;
        }
        if (req.body?.observacao !== undefined) {
          row.observacao = String(req.body.observacao || '').slice(0, 2000);
        }
        await row.save();

        await registrarAuditoriaFinanceira({
          req,
          acao: 'FILA_COBRANCA_ATUALIZADA',
          entidade: 'FinanceiroFilaCobranca',
          entidadeId: String(row._id),
          codigo: row.carneCodigo,
          antes,
          depois: normalizeFilaCobranca(row)
        });

        return res.json({
          ok: true,
          message: 'Item da fila atualizado.',
          item: normalizeFilaCobranca(row)
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: error.message || 'Erro ao atualizar o item da fila.'
        });
      }
    }
  );

  app.get(
    '/api/admin/financeiro/fila-cobranca/faixas/resumo',
    adminRequired,
    financeiroPermissionRequired('financeiro.visualizar'),
    async (req, res) => {
      try {
        const dataReferencia = String(req.query.dataReferencia || dateKey(new Date())).slice(0, 10);
        const rows = await FinanceiroFilaCobranca.aggregate([
          { $match: { dataReferencia } },
          {
            $group: {
              _id: '$faixa',
              clientes: { $addToSet: '$carneId' },
              parcelas: { $sum: 1 },
              valorOriginal: { $sum: '$valorOriginal' },
              multa: { $sum: '$multa' },
              juros: { $sum: '$juros' },
              valorAtualizado: { $sum: '$valorAtualizado' }
            }
          }
        ]);

        return res.json({
          ok: true,
          dataReferencia,
          faixas: rows.map((row) => ({
            faixa: row._id || 'SEM_FAIXA',
            clientes: Array.isArray(row.clientes) ? row.clientes.length : 0,
            parcelas: Number(row.parcelas || 0),
            valorOriginal: Number(Number(row.valorOriginal || 0).toFixed(2)),
            multa: Number(Number(row.multa || 0).toFixed(2)),
            juros: Number(Number(row.juros || 0).toFixed(2)),
            valorAtualizado: Number(Number(row.valorAtualizado || 0).toFixed(2))
          }))
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: error.message || 'Erro ao consolidar as faixas de atraso.'
        });
      }
    }
  );


  app.post(
    '/api/admin/financeiro/promessas',
    adminRequired,
    financeiroPermissionRequired('financeiro.cobranca'),
    async (req, res) => {
      try {
        const body = req.body || {};
        const filaItemId = String(body.filaItemId || '').trim();
        const carneId = String(body.carneId || '').trim();
        const valorPrometido = Number(body.valorPrometido || 0);
        const dataPrometida = parseFinanceiroDate(body.dataPrometida);

        if (!mongoose.Types.ObjectId.isValid(carneId)) {
          return res.status(400).json({ ok: false, error: 'Carnê inválido.' });
        }
        if (!Number.isFinite(valorPrometido) || valorPrometido <= 0) {
          return res.status(400).json({ ok: false, error: 'Informe um valor prometido válido.' });
        }
        if (!dataPrometida || Number.isNaN(dataPrometida.getTime())) {
          return res.status(400).json({ ok: false, error: 'Data prometida inválida.' });
        }

        const carne = await FinanceiroCarneDigital.findById(carneId);
        if (!carne) return res.status(404).json({ ok: false, error: 'Carnê não encontrado.' });

        let filaItem = null;
        if (filaItemId && mongoose.Types.ObjectId.isValid(filaItemId)) {
          filaItem = await FinanceiroFilaCobranca.findById(filaItemId);
        }

        const inicioPromessa = dayOnly(dataPrometida);
        const fimPromessa = new Date(inicioPromessa.getTime());
        fimPromessa.setHours(23, 59, 59, 999);
        const duplicatePromiseFilter = {
          carneId: carne._id,
          status: 'PENDENTE',
          valorPrometido: Number(valorPrometido.toFixed(2)),
          dataPrometida: { $gte: inicioPromessa, $lte: fimPromessa }
        };
        if (filaItem?._id) duplicatePromiseFilter.filaItemId = filaItem._id;

        const promessaExistente = await FinanceiroPromessaPagamento.findOne(duplicatePromiseFilter);
        if (promessaExistente) {
          return res.json({
            ok: true,
            duplicate: true,
            message: 'Esta promessa já estava registrada e não foi duplicada.',
            promessa: normalizePromessaPagamento(promessaExistente),
            whatsapp: { skipped: true, reason: 'duplicate' }
          });
        }

        const promessa = await FinanceiroPromessaPagamento.create({
          filaItemId: filaItem?._id || null,
          carneId: carne._id,
          carneCodigo: carne.codigo,
          clienteNome: carne.cliente?.nome || '',
          clienteCpf: cleanPhone(carne.cliente?.cpf || ''),
          telefone: normalizePhone(body.telefone || carne.cliente?.telefone || '', '55'),
          documento: String(body.documento || filaItem?.documento || ''),
          parcelaCodigo: String(body.parcelaCodigo || filaItem?.parcelaCodigo || ''),
          parcelaLabel: String(body.parcelaLabel || filaItem?.parcelaLabel || ''),
          valorPrometido: Number(valorPrometido.toFixed(2)),
          dataPrometida,
          formaPagamento: String(body.formaPagamento || 'PIX'),
          status: 'PENDENTE',
          origem: filaItem ? 'fila_cobranca' : 'manual',
          responsavel: getFinanceiroActor(req),
          observacao: String(body.observacao || '').slice(0, 2000),
          metadata: { body }
        });

        if (filaItem) {
          filaItem.status = 'ADIADO';
          filaItem.responsavel = getFinanceiroActor(req);
          filaItem.ultimaAcao = 'PROMESSA_REGISTRADA';
          filaItem.ultimaAcaoEm = new Date();
          filaItem.proximaAcaoEm = dataPrometida;
          filaItem.observacao = [
            filaItem.observacao || '',
            `Promessa de ${formatMoneyBRL(valorPrometido)} para ${formatDateBR(dataPrometida)}.`
          ].filter(Boolean).join(' ').slice(0, 2000);
          await filaItem.save();
        }

        let whatsapp = { skipped: true };
        if (body.enviarWhatsapp !== false && promessa.telefone) {
          try {
            whatsapp = await waSendTextMessage({
              number: promessa.telefone,
              text: buildPromessaWhatsappMessage(promessa)
            });
          } catch (sendError) {
            whatsapp = { ok: false, error: sendError.message || String(sendError) };
          }
        }

        await registrarAuditoriaFinanceira({
          req,
          acao: 'PROMESSA_PAGAMENTO_CRIADA',
          entidade: 'FinanceiroPromessaPagamento',
          entidadeId: String(promessa._id),
          codigo: promessa.carneCodigo,
          depois: normalizePromessaPagamento(promessa),
          metadata: { whatsapp: redact(whatsapp || null) }
        });

        return res.status(201).json({
          ok: true,
          message: 'Promessa de pagamento registrada.',
          promessa: normalizePromessaPagamento(promessa),
          whatsapp
        });
      } catch (error) {
        return res.status(500).json({ ok: false, error: error.message || 'Erro ao registrar promessa de pagamento.' });
      }
    }
  );

  app.get(
    '/api/admin/financeiro/promessas/alertas-hoje',
    adminRequired,
    financeiroPermissionRequired('financeiro.visualizar'),
    async (req, res) => {
      try {
        const { rows, clock } = await getPromessasHoje(req.query?.dataReferencia || new Date());
        const settings = await getWhatsappSettings();
        const destinatarios = getAdminWhatsappNumbers(settings);
        const valorTotal = rows.reduce((sum, row) => sum + Number(row.valorPrometido || 0), 0);
        const pendentesNotificacao = rows.filter((row) => row.alertaInternoEnviado !== true).length;

        return res.json({
          ok: true,
          dataReferencia: clock.dateKey,
          total: rows.length,
          valorTotal: Number(valorTotal.toFixed(2)),
          pendentesNotificacao,
          notificacaoInternaConfigurada: destinatarios.length > 0,
          destinatariosConfigurados: destinatarios.length,
          promessas: rows.map(normalizePromessaPagamento)
        });
      } catch (error) {
        return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar os alertas de promessas de hoje.' });
      }
    }
  );

  app.post(
    '/api/admin/financeiro/promessas/alertas-hoje/notificar',
    adminRequired,
    financeiroPermissionRequired('financeiro.cobranca'),
    async (req, res) => {
      try {
        const result = await notificarPromessasHojeInternamente({
          req,
          dataReferencia: req.body?.dataReferencia || new Date(),
          force: req.body?.force === true
        });
        return res.status(result.ok === false ? 502 : 200).json(result);
      } catch (error) {
        return res.status(error.statusCode || 500).json({
          ok: false,
          error: error.message || 'Erro ao enviar o alerta interno de promessas.'
        });
      }
    }
  );

  app.get(
    '/api/admin/financeiro/promessas',
    adminRequired,
    financeiroPermissionRequired('financeiro.visualizar'),
    async (req, res) => {
      try {
        await atualizarPromessasVencidas(req).catch(() => null);

        const q = String(req.query.q || '').trim();
        const status = String(req.query.status || '').trim().toUpperCase();
        const dataInicio = String(req.query.dataInicio || '').trim();
        const dataFim = String(req.query.dataFim || '').trim();
        const page = Math.max(1, Number(req.query.page || 1));
        const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 200));
        const filter = {};

        if (status) filter.status = status;
        if (dataInicio || dataFim) {
          filter.dataPrometida = {};
          if (dataInicio) filter.dataPrometida.$gte = new Date(`${dataInicio.slice(0,10)}T00:00:00`);
          if (dataFim) filter.dataPrometida.$lte = new Date(`${dataFim.slice(0,10)}T23:59:59.999`);
        }
        if (q) {
          const regex = new RegExp(escapeRegex(q), 'i');
          const digits = cleanPhone(q);
          filter.$or = [
            { clienteNome: regex },
            { carneCodigo: regex },
            { documento: regex }
          ];
          if (digits) {
            filter.$or.push({ clienteCpf: new RegExp(escapeRegex(digits), 'i') });
            filter.$or.push({ telefone: new RegExp(escapeRegex(digits), 'i') });
          }
        }

        const summaryPipeline = [
          { $match: filter },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              valorTotal: { $sum: '$valorPrometido' },
              pendentes: { $sum: { $cond: [{ $eq: ['$status', 'PENDENTE'] }, 1, 0] } },
              cumpridas: { $sum: { $cond: [{ $eq: ['$status', 'CUMPRIDA'] }, 1, 0] } },
              quebradas: { $sum: { $cond: [{ $eq: ['$status', 'QUEBRADA'] }, 1, 0] } },
              canceladas: { $sum: { $cond: [{ $eq: ['$status', 'CANCELADA'] }, 1, 0] } }
            }
          }
        ];

        const [rows, total, summaryRows] = await Promise.all([
          FinanceiroPromessaPagamento.find(filter)
            .sort({ dataPrometida: 1, createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit),
          FinanceiroPromessaPagamento.countDocuments(filter),
          FinanceiroPromessaPagamento.aggregate(summaryPipeline)
        ]);

        const s = summaryRows[0] || {};
        return res.json({
          ok: true,
          promessas: rows.map(normalizePromessaPagamento),
          total,
          page,
          limit,
          pages: Math.max(1, Math.ceil(total / limit)),
          resumo: {
            total: Number(s.total || 0),
            valorTotal: Number(Number(s.valorTotal || 0).toFixed(2)),
            pendentes: Number(s.pendentes || 0),
            cumpridas: Number(s.cumpridas || 0),
            quebradas: Number(s.quebradas || 0),
            canceladas: Number(s.canceladas || 0)
          }
        });
      } catch (error) {
        return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar promessas de pagamento.' });
      }
    }
  );

  app.patch(
    '/api/admin/financeiro/promessas/:id/status',
    adminRequired,
    financeiroPermissionRequired('financeiro.cobranca'),
    async (req, res) => {
      try {
        const id = String(req.params.id || '').trim();
        if (!mongoose.Types.ObjectId.isValid(id)) {
          return res.status(400).json({ ok: false, error: 'Promessa inválida.' });
        }

        const status = String(req.body?.status || '').trim().toUpperCase();
        const allowed = new Set(['PENDENTE', 'CUMPRIDA', 'QUEBRADA', 'CANCELADA']);
        if (!allowed.has(status)) {
          return res.status(400).json({ ok: false, error: 'Status da promessa inválido.' });
        }

        const row = await FinanceiroPromessaPagamento.findById(id);
        if (!row) return res.status(404).json({ ok: false, error: 'Promessa não encontrada.' });

        const antes = normalizePromessaPagamento(row);
        row.status = status;
        row.pagamentoReferencia = String(req.body?.pagamentoReferencia || row.pagamentoReferencia || '');
        if (req.body?.observacao !== undefined) {
          row.observacao = String(req.body.observacao || '').slice(0, 2000);
        }
        if (status === 'CUMPRIDA') row.cumpridaEm = new Date();
        if (status === 'QUEBRADA') row.quebradaEm = new Date();
        if (status === 'CANCELADA') row.canceladaEm = new Date();
        await row.save();

        if (row.filaItemId) {
          const update = status === 'CUMPRIDA'
            ? { status: 'CONCLUIDO', ultimaAcao: 'PROMESSA_CUMPRIDA' }
            : (status === 'QUEBRADA'
              ? { status: 'PENDENTE', prioridade: 'CRITICA', prioridadeScore: 100, ultimaAcao: 'PROMESSA_QUEBRADA' }
              : { ultimaAcao: `PROMESSA_${status}` });
          await FinanceiroFilaCobranca.findByIdAndUpdate(row.filaItemId, {
            $set: { ...update, ultimaAcaoEm: new Date() }
          }).catch(() => null);
        }

        await registrarAuditoriaFinanceira({
          req,
          acao: `PROMESSA_PAGAMENTO_${status}`,
          entidade: 'FinanceiroPromessaPagamento',
          entidadeId: String(row._id),
          codigo: row.carneCodigo,
          antes,
          depois: normalizePromessaPagamento(row)
        });

        return res.json({
          ok: true,
          message: `Promessa alterada para ${status}.`,
          promessa: normalizePromessaPagamento(row)
        });
      } catch (error) {
        return res.status(500).json({ ok: false, error: error.message || 'Erro ao atualizar a promessa.' });
      }
    }
  );

  app.post(
    '/api/admin/financeiro/promessas/processar-vencidas',
    adminRequired,
    financeiroPermissionRequired('financeiro.cobranca'),
    async (req, res) => {
      try {
        const result = await atualizarPromessasVencidas(req);
        return res.json({ ok: true, ...result });
      } catch (error) {
        return res.status(500).json({ ok: false, error: error.message || 'Erro ao processar promessas vencidas.' });
      }
    }
  );



  app.get(
    '/api/admin/financeiro/dashboard',
    adminRequired,
    financeiroPermissionRequired('financeiro.visualizar'),
    async (req, res) => {
      try {
        const referencia = dayOnly(req.query.dataReferencia || req.query.date || new Date());
        if (!referencia) {
          return res.status(400).json({ ok: false, error: 'Data de referência inválida.' });
        }

        const amanha = new Date(referencia.getTime());
        amanha.setDate(amanha.getDate() + 1);

        const emSeteDias = new Date(referencia.getTime());
        emSeteDias.setDate(emSeteDias.getDate() + 6);

        const fimMes = new Date(
          referencia.getFullYear(),
          referencia.getMonth() + 1,
          0,
          23,
          59,
          59,
          999
        );

        const [carnes, riscos, auditoriasRecentes] = await Promise.all([
          FinanceiroCarneDigital.find({ status: 'ATIVO' }).lean(),
          FinanceiroRiscoCliente.find({}).lean(),
          FinanceiroAuditoria.find({
            acao: {
              $in: [
                'CARNE_ENVIADO_WHATSAPP',
                'CARNE_WHATSAPP_FALHOU',
                'PROMESSA_PAGAMENTO_CRIADA',
                'TRATATIVA_FINANCEIRA_CRIADA',
                'PAGAMENTO_CONFIRMADO_SIGE'
              ]
            }
          }).sort({ createdAt: -1 }).limit(20).lean()
        ]);

        const riskByKey = new Map();
        for (const risco of riscos) {
          const keys = [
            String(risco.customerKey || ''),
            cleanPhone(risco.clienteCpf || '') ? `cpf:${cleanPhone(risco.clienteCpf || '')}` : '',
            cleanPhone(risco.telefone || '') ? `telefone:${cleanPhone(risco.telefone || '')}` : '',
            normalizeSearch(risco.clienteNome || '') ? `nome:${normalizeSearch(risco.clienteNome || '')}` : ''
          ].filter(Boolean);
          for (const key of keys) riskByKey.set(key, risco);
        }

        const monthsMap = new Map();
        const customerState = {
          ADIMPLENTE: 0,
          INADIMPLENTE: 0,
          BLOQUEADO: 0,
          EM_REVISAO: 0
        };
        const riskChart = {
          ALTO: 0,
          MEDIO: 0,
          BOM: 0,
          EXCELENTE: 0
        };

        let receivableToday = 0;
        let receivableTomorrow = 0;
        let receivableWeek = 0;
        let receivableMonth = 0;
        let openPortfolio = 0;
        let overdueUpdated = 0;
        let accumulatedFine = 0;
        let accumulatedInterest = 0;
        let totalReceived = 0;
        let openInstallments = 0;
        let overdueInstallments = 0;

        const customerKeys = new Set();

        for (const carne of carnes) {
          const cpf = cleanPhone(carne.cliente?.cpf || '');
          const telefone = cleanPhone(carne.cliente?.telefone || '');
          const nome = normalizeSearch(carne.cliente?.nome || '');
          const customerKey = cpf
            ? `cpf:${cpf}`
            : (telefone ? `telefone:${telefone}` : `nome:${nome || String(carne._id)}`);
          customerKeys.add(customerKey);

          const risco = riskByKey.get(customerKey)
            || riskByKey.get(cpf ? `cpf:${cpf}` : '')
            || riskByKey.get(telefone ? `telefone:${telefone}` : '')
            || riskByKey.get(nome ? `nome:${nome}` : '');

          const parcelas = Array.isArray(carne.parcelas) ? carne.parcelas : [];
          let clienteTemAtraso = false;

          for (const parcela of parcelas) {
            const vencimento = dayOnly(parcela.dataVencimento);
            if (!vencimento) continue;

            const quitada = parcela.status === 'paga' || parcela.quitado === true;
            const financeiro = parcela.atualizacaoFinanceira
              || calcularParcelaAtualizadaBackend(parcela, referencia);

            const saldoOriginal = Number(
              financeiro.saldoOriginal
              ?? parcela.saldoParcela
              ?? parcela.valorParcela
              ?? parcela.valor
              ?? 0
            );
            const valorAtualizado = Number(
              financeiro.valorAtualizado
              ?? parcela.saldoParcela
              ?? parcela.valorParcela
              ?? parcela.valor
              ?? 0
            );
            const valorPago = Number(
              parcela.valorPago
              ?? parcela.totalRecebido
              ?? (quitada ? parcela.valorParcela : 0)
              ?? 0
            );

            const monthKey = [
              vencimento.getFullYear(),
              String(vencimento.getMonth() + 1).padStart(2, '0')
            ].join('-');

            if (!monthsMap.has(monthKey)) {
              monthsMap.set(monthKey, {
                month: monthKey,
                label: vencimento.toLocaleDateString('pt-BR', {
                  month: 'short',
                  year: '2-digit'
                }).replace('.', ''),
                plannedCents: 0,
                receivedCents: 0,
                overdueCents: 0
              });
            }

            const month = monthsMap.get(monthKey);
            month.plannedCents += Math.round(Math.max(0, saldoOriginal) * 100);
            month.receivedCents += Math.round(Math.max(0, valorPago) * 100);

            if (quitada) {
              totalReceived += Math.max(0, valorPago);
              continue;
            }

            openInstallments += 1;
            openPortfolio += Math.max(0, Number(parcela.saldoParcela ?? saldoOriginal));
            const diasAtraso = Math.max(
              0,
              Math.floor((referencia.getTime() - vencimento.getTime()) / 86400000)
            );
            const vencida = vencimento < referencia;

            if (vencida) {
              clienteTemAtraso = true;
              overdueInstallments += 1;
              overdueUpdated += Math.max(0, valorAtualizado);
              accumulatedFine += Math.max(0, Number(financeiro.multa || 0));
              accumulatedInterest += Math.max(0, Number(financeiro.juros || 0));
              month.overdueCents += Math.round(Math.max(0, valorAtualizado) * 100);
            }

            const dueKey = dateKey(vencimento);
            if (dueKey === dateKey(referencia)) receivableToday += Math.max(0, valorAtualizado);
            if (dueKey === dateKey(amanha)) receivableTomorrow += Math.max(0, valorAtualizado);
            if (vencimento >= referencia && vencimento <= emSeteDias) {
              receivableWeek += Math.max(0, valorAtualizado);
            }
            if (vencimento >= referencia && vencimento <= fimMes) {
              receivableMonth += Math.max(0, valorAtualizado);
            }
          }

          const manual = String(risco?.statusManual || 'AUTOMATICO');
          if (manual === 'BLOQUEADO') customerState.BLOQUEADO += 1;
          else if (manual === 'EM_REVISAO') customerState.EM_REVISAO += 1;
          else if (clienteTemAtraso) customerState.INADIMPLENTE += 1;
          else customerState.ADIMPLENTE += 1;

          const nivel = String(risco?.nivelRisco || 'BAIXO');
          const score = Number(risco?.scoreRisco || 0);
          if (nivel === 'CRITICO' || nivel === 'ALTO') riskChart.ALTO += 1;
          else if (nivel === 'MEDIO') riskChart.MEDIO += 1;
          else if (score === 0 && !clienteTemAtraso) riskChart.EXCELENTE += 1;
          else riskChart.BOM += 1;
        }

        const months = Array.from(monthsMap.values())
          .sort((a, b) => a.month.localeCompare(b.month))
          .slice(0, 24);

        const customers = customerKeys.size;
        const contracts = carnes.length;
        const averageTicket = contracts > 0 ? openPortfolio / contracts : 0;
        const defaultRatePercent = openPortfolio > 0
          ? Math.min(100, (overdueUpdated / openPortfolio) * 100)
          : 0;

        const recentCollections = auditoriasRecentes.map((row) => {
          const metadata = row.metadata || {};
          const depois = row.depois || {};
          return {
            createdAt: row.createdAt || null,
            customerName:
              metadata.clienteNome
              || metadata.customerName
              || depois.clienteNome
              || depois.cliente?.nome
              || '',
            phone:
              metadata.telefone
              || depois.telefone
              || depois.cliente?.telefone
              || '',
            orderId:
              metadata.documento
              || metadata.orderId
              || row.codigo
              || '—',
            eventType: row.acao || 'FINANCEIRO',
            status: row.sucesso === false ? 'FAILED' : 'SENT'
          };
        });

        return res.json({
          ok: true,
          source: 'financeiro_unificado',
          dataReferencia: dateKey(referencia),
          kpis: {
            receivableTodayCents: Math.round(receivableToday * 100),
            receivableTomorrowCents: Math.round(receivableTomorrow * 100),
            receivableWeekCents: Math.round(receivableWeek * 100),
            receivableMonthCents: Math.round(receivableMonth * 100),
            openPortfolioCents: Math.round(openPortfolio * 100),
            overdueUpdatedCents: Math.round(overdueUpdated * 100),
            accumulatedFineCents: Math.round(accumulatedFine * 100),
            accumulatedInterestCents: Math.round(accumulatedInterest * 100),
            totalReceivedCents: Math.round(totalReceived * 100),
            defaultRatePercent: Number(defaultRatePercent.toFixed(2)),
            averageTicketCents: Math.round(averageTicket * 100),
            customers,
            openInstallments,
            overdueInstallments,
            contracts
          },
          charts: {
            months,
            customerState,
            risk: riskChart
          },
          recentCollections
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: error.message || 'Erro ao montar o dashboard financeiro unificado.'
        });
      }
    }
  );

  app.get(
    '/api/admin/financeiro/recuperacao/periodo-disponivel',
    adminRequired,
    financeiroPermissionRequired('financeiro.visualizar'),
    async (_req, res) => {
      try {
        const [
          primeiraPromessa,
          ultimaPromessa,
          primeiraFila,
          ultimaFila,
          primeiraAuditoria,
          ultimaAuditoria
        ] = await Promise.all([
          FinanceiroPromessaPagamento.findOne({}).sort({ createdAt: 1 }).select({ createdAt: 1 }).lean(),
          FinanceiroPromessaPagamento.findOne({}).sort({ createdAt: -1 }).select({ createdAt: 1 }).lean(),
          FinanceiroFilaCobranca.findOne({}).sort({ dataReferencia: 1 }).select({ dataReferencia: 1 }).lean(),
          FinanceiroFilaCobranca.findOne({}).sort({ dataReferencia: -1 }).select({ dataReferencia: 1 }).lean(),
          FinanceiroAuditoria.findOne({ modulo: 'financeiro' }).sort({ createdAt: 1 }).select({ createdAt: 1 }).lean(),
          FinanceiroAuditoria.findOne({ modulo: 'financeiro' }).sort({ createdAt: -1 }).select({ createdAt: 1 }).lean()
        ]);

        const inicioCandidates = [
          primeiraPromessa?.createdAt ? dayOnly(primeiraPromessa.createdAt) : null,
          primeiraFila?.dataReferencia ? dayOnly(primeiraFila.dataReferencia) : null,
          primeiraAuditoria?.createdAt ? dayOnly(primeiraAuditoria.createdAt) : null
        ].filter(Boolean);

        const fimCandidates = [
          ultimaPromessa?.createdAt ? dayOnly(ultimaPromessa.createdAt) : null,
          ultimaFila?.dataReferencia ? dayOnly(ultimaFila.dataReferencia) : null,
          ultimaAuditoria?.createdAt ? dayOnly(ultimaAuditoria.createdAt) : null
        ].filter(Boolean);

        const hoje = dayOnly(new Date());
        const inicio = inicioCandidates.length
          ? new Date(Math.min(...inicioCandidates.map((d) => d.getTime())))
          : new Date(hoje.getFullYear(), hoje.getMonth(), 1);
        const fim = fimCandidates.length
          ? new Date(Math.max(...fimCandidates.map((d) => d.getTime())))
          : hoje;

        return res.json({
          ok: true,
          dataInicio: dateKey(new Date(inicio.getFullYear(), inicio.getMonth(), 1)),
          dataFim: dateKey(new Date(fim.getFullYear(), fim.getMonth() + 1, 0)),
          primeiraMovimentacao: dateKey(inicio),
          ultimaMovimentacao: dateKey(fim)
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: error.message || 'Erro ao identificar o período disponível.'
        });
      }
    }
  );

  app.get(
    '/api/admin/financeiro/recuperacao/dashboard',
    adminRequired,
    financeiroPermissionRequired('financeiro.visualizar'),
    async (req, res) => {
      try {
        const hoje = dayOnly(new Date());
        const dataInicioRaw = String(req.query.dataInicio || '').trim();
        const dataFimRaw = String(req.query.dataFim || '').trim();

        const inicio = dataInicioRaw
          ? new Date(`${dataInicioRaw.slice(0, 10)}T00:00:00`)
          : new Date(hoje.getFullYear(), hoje.getMonth(), 1, 0, 0, 0, 0);
        const fim = dataFimRaw
          ? new Date(`${dataFimRaw.slice(0, 10)}T23:59:59.999`)
          : new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0, 23, 59, 59, 999);

        if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime()) || inicio > fim) {
          return res.status(400).json({ ok: false, error: 'Período inválido.' });
        }

        const promessaFilter = { createdAt: { $gte: inicio, $lte: fim } };
        const filaFilter = {
          dataReferencia: {
            $gte: dateKey(inicio),
            $lte: dateKey(fim)
          }
        };
        const auditoriaFilter = {
          modulo: 'financeiro',
          createdAt: { $gte: inicio, $lte: fim }
        };

        const [
          promessaResumoRows,
          promessasCumpridas,
          promessasQuebradas,
          filaResumoRows,
          auditoriaWhatsapp,
          auditoriaPagamentos,
          auditoriaRecuperacoes,
          seriePromessas,
          serieFila
        ] = await Promise.all([
          FinanceiroPromessaPagamento.aggregate([
            { $match: promessaFilter },
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                valorPrometido: { $sum: '$valorPrometido' },
                pendentes: { $sum: { $cond: [{ $eq: ['$status', 'PENDENTE'] }, 1, 0] } },
                cumpridas: { $sum: { $cond: [{ $eq: ['$status', 'CUMPRIDA'] }, 1, 0] } },
                quebradas: { $sum: { $cond: [{ $eq: ['$status', 'QUEBRADA'] }, 1, 0] } },
                canceladas: { $sum: { $cond: [{ $eq: ['$status', 'CANCELADA'] }, 1, 0] } },
                valorCumprido: {
                  $sum: { $cond: [{ $eq: ['$status', 'CUMPRIDA'] }, '$valorPrometido', 0] }
                },
                valorQuebrado: {
                  $sum: { $cond: [{ $eq: ['$status', 'QUEBRADA'] }, '$valorPrometido', 0] }
                }
              }
            }
          ]),
          FinanceiroPromessaPagamento.find({
            ...promessaFilter,
            status: 'CUMPRIDA',
            cumpridaEm: { $ne: null }
          }).lean(),
          FinanceiroPromessaPagamento.find({
            ...promessaFilter,
            status: 'QUEBRADA',
            quebradaEm: { $ne: null }
          }).lean(),
          FinanceiroFilaCobranca.aggregate([
            { $match: filaFilter },
            {
              $group: {
                _id: null,
                tarefas: { $sum: 1 },
                valorCarteira: { $sum: '$valorAtualizado' },
                concluidas: { $sum: { $cond: [{ $eq: ['$status', 'CONCLUIDO'] }, 1, 0] } },
                contatadas: { $sum: { $cond: [{ $eq: ['$status', 'CONTATADO'] }, 1, 0] } },
                semContato: { $sum: { $cond: ['$semContato', 1, 0] } },
                criticas: { $sum: { $cond: [{ $eq: ['$prioridade', 'CRITICA'] }, 1, 0] } },
                altas: { $sum: { $cond: [{ $eq: ['$prioridade', 'ALTA'] }, 1, 0] } }
              }
            }
          ]),
          FinanceiroAuditoria.countDocuments({
            ...auditoriaFilter,
            acao: { $in: ['CARNE_ENVIADO_WHATSAPP', 'CARNE_WHATSAPP_FALHOU'] }
          }),
          FinanceiroAuditoria.countDocuments({
            ...auditoriaFilter,
            acao: 'PAGAMENTO_CONFIRMADO_SIGE',
            sucesso: true
          }),
          FinanceiroAuditoria.countDocuments({
            ...auditoriaFilter,
            acao: { $in: ['PROMESSA_PAGAMENTO_CUMPRIDA', 'PAGAMENTO_CONFIRMADO_SIGE'] },
            sucesso: true
          }),
          FinanceiroPromessaPagamento.aggregate([
            { $match: promessaFilter },
            {
              $group: {
                _id: {
                  ano: { $year: '$createdAt' },
                  mes: { $month: '$createdAt' },
                  dia: { $dayOfMonth: '$createdAt' }
                },
                total: { $sum: 1 },
                cumpridas: { $sum: { $cond: [{ $eq: ['$status', 'CUMPRIDA'] }, 1, 0] } },
                quebradas: { $sum: { $cond: [{ $eq: ['$status', 'QUEBRADA'] }, 1, 0] } },
                valorPrometido: { $sum: '$valorPrometido' },
                valorCumprido: {
                  $sum: { $cond: [{ $eq: ['$status', 'CUMPRIDA'] }, '$valorPrometido', 0] }
                }
              }
            },
            { $sort: { '_id.ano': 1, '_id.mes': 1, '_id.dia': 1 } }
          ]),
          FinanceiroFilaCobranca.aggregate([
            { $match: filaFilter },
            {
              $group: {
                _id: '$dataReferencia',
                tarefas: { $sum: 1 },
                concluidas: { $sum: { $cond: [{ $eq: ['$status', 'CONCLUIDO'] }, 1, 0] } },
                valorCarteira: { $sum: '$valorAtualizado' }
              }
            },
            { $sort: { _id: 1 } }
          ])
        ]);

        const p = promessaResumoRows[0] || {};
        const f = filaResumoRows[0] || {};

        const totalPromessas = Number(p.total || 0);
        const cumpridas = Number(p.cumpridas || 0);
        const quebradas = Number(p.quebradas || 0);
        const promessasEncerradas = cumpridas + quebradas;
        const taxaCumprimentoPromessas = promessasEncerradas > 0
          ? Number(((cumpridas / promessasEncerradas) * 100).toFixed(2))
          : 0;

        const tarefas = Number(f.tarefas || 0);
        const concluidas = Number(f.concluidas || 0);
        const taxaConclusaoFila = tarefas > 0
          ? Number(((concluidas / tarefas) * 100).toFixed(2))
          : 0;

        const temposCumprimento = promessasCumpridas
          .map((row) => {
            const criada = new Date(row.createdAt);
            const cumprida = new Date(row.cumpridaEm);
            if (Number.isNaN(criada.getTime()) || Number.isNaN(cumprida.getTime())) return null;
            return Math.max(0, (cumprida.getTime() - criada.getTime()) / 86400000);
          })
          .filter((value) => Number.isFinite(value));

        const tempoMedioCumprimentoDias = temposCumprimento.length
          ? Number((temposCumprimento.reduce((sum, value) => sum + value, 0) / temposCumprimento.length).toFixed(2))
          : 0;

        const temposQuebra = promessasQuebradas
          .map((row) => {
            const prometida = new Date(row.dataPrometida);
            const quebrada = new Date(row.quebradaEm);
            if (Number.isNaN(prometida.getTime()) || Number.isNaN(quebrada.getTime())) return null;
            return Math.max(0, (quebrada.getTime() - prometida.getTime()) / 86400000);
          })
          .filter((value) => Number.isFinite(value));

        const atrasoMedioPromessaQuebradaDias = temposQuebra.length
          ? Number((temposQuebra.reduce((sum, value) => sum + value, 0) / temposQuebra.length).toFixed(2))
          : 0;

        const valorPrometido = Number(Number(p.valorPrometido || 0).toFixed(2));
        const valorCumprido = Number(Number(p.valorCumprido || 0).toFixed(2));
        const valorQuebrado = Number(Number(p.valorQuebrado || 0).toFixed(2));
        const taxaRecuperacaoFinanceira = valorPrometido > 0
          ? Number(((valorCumprido / valorPrometido) * 100).toFixed(2))
          : 0;

        const diasMap = new Map();
        for (const row of serieFila) {
          diasMap.set(row._id, {
            data: row._id,
            tarefas: Number(row.tarefas || 0),
            concluidas: Number(row.concluidas || 0),
            valorCarteira: Number(Number(row.valorCarteira || 0).toFixed(2)),
            promessas: 0,
            promessasCumpridas: 0,
            promessasQuebradas: 0,
            valorPrometido: 0,
            valorCumprido: 0
          });
        }

        for (const row of seriePromessas) {
          const key = [
            row._id.ano,
            String(row._id.mes).padStart(2, '0'),
            String(row._id.dia).padStart(2, '0')
          ].join('-');
          const current = diasMap.get(key) || {
            data: key,
            tarefas: 0,
            concluidas: 0,
            valorCarteira: 0,
            promessas: 0,
            promessasCumpridas: 0,
            promessasQuebradas: 0,
            valorPrometido: 0,
            valorCumprido: 0
          };
          current.promessas = Number(row.total || 0);
          current.promessasCumpridas = Number(row.cumpridas || 0);
          current.promessasQuebradas = Number(row.quebradas || 0);
          current.valorPrometido = Number(Number(row.valorPrometido || 0).toFixed(2));
          current.valorCumprido = Number(Number(row.valorCumprido || 0).toFixed(2));
          diasMap.set(key, current);
        }

        const serieDiaria = Array.from(diasMap.values()).sort((a, b) => a.data.localeCompare(b.data));

        return res.json({
          ok: true,
          periodo: {
            dataInicio: inicio.toISOString(),
            dataFim: fim.toISOString()
          },
          indicadores: {
            valorPrometido,
            valorCumprido,
            valorQuebrado,
            taxaRecuperacaoFinanceira,
            totalPromessas,
            promessasPendentes: Number(p.pendentes || 0),
            promessasCumpridas: cumpridas,
            promessasQuebradas: quebradas,
            promessasCanceladas: Number(p.canceladas || 0),
            taxaCumprimentoPromessas,
            tempoMedioCumprimentoDias,
            atrasoMedioPromessaQuebradaDias,
            tarefasFila: tarefas,
            tarefasConcluidas: concluidas,
            tarefasContatadas: Number(f.contatadas || 0),
            tarefasSemContato: Number(f.semContato || 0),
            tarefasCriticas: Number(f.criticas || 0),
            tarefasAltaPrioridade: Number(f.altas || 0),
            valorCarteiraCobranca: Number(Number(f.valorCarteira || 0).toFixed(2)),
            taxaConclusaoFila,
            cobrancasWhatsappRegistradas: Number(auditoriaWhatsapp || 0),
            pagamentosConfirmadosSige: Number(auditoriaPagamentos || 0),
            eventosRecuperacao: Number(auditoriaRecuperacoes || 0)
          },
          serieDiaria
        });
      } catch (error) {
        console.error('[financeiro recuperação dashboard]', error.message || error);
        return res.status(500).json({
          ok: false,
          error: error.message || 'Erro ao calcular os indicadores de recuperação.'
        });
      }
    }
  );


  app.post(
    '/api/admin/financeiro/tratativas',
    adminRequired,
    financeiroPermissionRequired('financeiro.cobranca'),
    async (req, res) => {
      try {
        const body = req.body || {};
        const carneId = String(body.carneId || '').trim();
        if (!mongoose.Types.ObjectId.isValid(carneId)) {
          return res.status(400).json({ ok: false, error: 'Carnê inválido.' });
        }

        const motivo = String(body.motivo || '').trim().toUpperCase();
        const resultado = String(body.resultado || 'SEM_RETORNO').trim().toUpperCase();
        const proximaAcao = String(body.proximaAcao || 'ACOMPANHAR').trim().toUpperCase();

        if (!getTratativaMotivosPermitidos().has(motivo)) {
          return res.status(400).json({ ok: false, error: 'Motivo da inadimplência inválido.' });
        }
        if (!getTratativaResultadosPermitidos().has(resultado)) {
          return res.status(400).json({ ok: false, error: 'Resultado da tratativa inválido.' });
        }
        if (!getTratativaProximasAcoesPermitidas().has(proximaAcao)) {
          return res.status(400).json({ ok: false, error: 'Próxima ação inválida.' });
        }

        const carne = await FinanceiroCarneDigital.findById(carneId);
        if (!carne) return res.status(404).json({ ok: false, error: 'Carnê não encontrado.' });

        let filaItem = null;
        const filaItemId = String(body.filaItemId || '').trim();
        if (filaItemId && mongoose.Types.ObjectId.isValid(filaItemId)) {
          filaItem = await FinanceiroFilaCobranca.findById(filaItemId);
        }

        let promessa = null;
        const promessaId = String(body.promessaId || '').trim();
        if (promessaId && mongoose.Types.ObjectId.isValid(promessaId)) {
          promessa = await FinanceiroPromessaPagamento.findById(promessaId);
        }

        let proximaAcaoEm = null;
        if (body.proximaAcaoEm) {
          proximaAcaoEm = new Date(body.proximaAcaoEm);
          if (Number.isNaN(proximaAcaoEm.getTime())) {
            return res.status(400).json({ ok: false, error: 'Data da próxima ação inválida.' });
          }
        }

        const concluida = proximaAcao === 'ENCERRAR' || resultado === 'RESOLVIDO';
        const duplicateWindow = new Date(Date.now() - 2 * 60 * 1000);
        const duplicateTreatmentFilter = {
          carneId: carne._id,
          motivo,
          resultado,
          proximaAcao,
          createdAt: { $gte: duplicateWindow }
        };
        if (filaItem?._id) duplicateTreatmentFilter.filaItemId = filaItem._id;

        const tratativaExistente = await FinanceiroTratativa.findOne(duplicateTreatmentFilter);
        if (tratativaExistente) {
          return res.json({
            ok: true,
            duplicate: true,
            message: 'Esta tratativa já estava registrada e não foi duplicada.',
            tratativa: normalizeTratativaFinanceira(tratativaExistente)
          });
        }

        const tratativa = await FinanceiroTratativa.create({
          filaItemId: filaItem?._id || null,
          promessaId: promessa?._id || null,
          carneId: carne._id,
          carneCodigo: carne.codigo,
          clienteNome: carne.cliente?.nome || '',
          clienteCpf: cleanPhone(carne.cliente?.cpf || ''),
          telefone: normalizePhone(body.telefone || carne.cliente?.telefone || '', '55'),
          documento: String(body.documento || filaItem?.documento || ''),
          parcelaLabel: String(body.parcelaLabel || filaItem?.parcelaLabel || ''),
          motivo,
          motivoDetalhe: String(body.motivoDetalhe || '').slice(0, 500),
          canal: String(body.canal || 'WHATSAPP').trim().toUpperCase(),
          resultado,
          proximaAcao,
          proximaAcaoEm,
          responsavel: getFinanceiroActor(req),
          observacao: String(body.observacao || '').slice(0, 2000),
          concluida,
          concluidaEm: concluida ? new Date() : null,
          metadata: { body }
        });

        if (filaItem) {
          const filaStatus = concluida
            ? 'CONCLUIDO'
            : (resultado === 'CONTATO_INVALIDO'
              ? 'SEM_CONTATO'
              : (proximaAcaoEm ? 'ADIADO' : 'CONTATADO'));

          filaItem.status = filaStatus;
          filaItem.responsavel = getFinanceiroActor(req);
          filaItem.ultimaAcao = `TRATATIVA_${resultado}`;
          filaItem.ultimaAcaoEm = new Date();
          filaItem.proximaAcaoEm = proximaAcaoEm;
          filaItem.observacao = [
            filaItem.observacao || '',
            `Motivo: ${motivo}. Resultado: ${resultado}. Próxima ação: ${proximaAcao}.`,
            String(body.observacao || '')
          ].filter(Boolean).join(' ').slice(0, 2000);
          await filaItem.save();
        }

        if (motivo === 'SOLICITOU_RENEGOCIACAO') {
          await FinanceiroCarneDigital.findByIdAndUpdate(carne._id, {
            $push: {
              historico: {
                $each: [{
                  tipo: 'TRATATIVA_RENEGOCIACAO_SOLICITADA',
                  em: new Date(),
                  por: getFinanceiroActor(req),
                  tratativaId: String(tratativa._id)
                }],
                $slice: -100
              }
            }
          }).catch(() => null);
        }

        await registrarAuditoriaFinanceira({
          req,
          acao: 'TRATATIVA_FINANCEIRA_CRIADA',
          entidade: 'FinanceiroTratativa',
          entidadeId: String(tratativa._id),
          codigo: carne.codigo,
          depois: normalizeTratativaFinanceira(tratativa)
        });

        return res.status(201).json({
          ok: true,
          message: 'Tratativa financeira registrada.',
          tratativa: normalizeTratativaFinanceira(tratativa)
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: error.message || 'Erro ao registrar a tratativa financeira.'
        });
      }
    }
  );

  app.get(
    '/api/admin/financeiro/tratativas',
    adminRequired,
    financeiroPermissionRequired('financeiro.visualizar'),
    async (req, res) => {
      try {
        const q = String(req.query.q || '').trim();
        const motivo = String(req.query.motivo || '').trim().toUpperCase();
        const resultado = String(req.query.resultado || '').trim().toUpperCase();
        const responsavel = String(req.query.responsavel || '').trim();
        const concluida = String(req.query.concluida || '').trim();
        const dataInicio = String(req.query.dataInicio || '').trim();
        const dataFim = String(req.query.dataFim || '').trim();
        const page = Math.max(1, Number(req.query.page || 1));
        const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 200));
        const filter = {};

        if (motivo) filter.motivo = motivo;
        if (resultado) filter.resultado = resultado;
        if (responsavel) filter.responsavel = new RegExp(escapeRegex(responsavel), 'i');
        if (concluida === 'true') filter.concluida = true;
        if (concluida === 'false') filter.concluida = false;

        if (dataInicio || dataFim) {
          filter.createdAt = {};
          if (dataInicio) filter.createdAt.$gte = new Date(`${dataInicio.slice(0,10)}T00:00:00`);
          if (dataFim) filter.createdAt.$lte = new Date(`${dataFim.slice(0,10)}T23:59:59.999`);
        }

        if (q) {
          const regex = new RegExp(escapeRegex(q), 'i');
          const digits = cleanPhone(q);
          filter.$or = [
            { clienteNome: regex },
            { carneCodigo: regex },
            { documento: regex },
            { motivoDetalhe: regex },
            { observacao: regex }
          ];
          if (digits) {
            filter.$or.push({ clienteCpf: new RegExp(escapeRegex(digits), 'i') });
            filter.$or.push({ telefone: new RegExp(escapeRegex(digits), 'i') });
          }
        }

        const summaryPipeline = [
          { $match: filter },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              abertas: { $sum: { $cond: [{ $eq: ['$concluida', false] }, 1, 0] } },
              concluidas: { $sum: { $cond: [{ $eq: ['$concluida', true] }, 1, 0] } },
              semRetorno: { $sum: { $cond: [{ $eq: ['$resultado', 'SEM_RETORNO'] }, 1, 0] } },
              renegociacoes: { $sum: { $cond: [{ $eq: ['$motivo', 'SOLICITOU_RENEGOCIACAO'] }, 1, 0] } },
              contatosInvalidos: { $sum: { $cond: [{ $eq: ['$resultado', 'CONTATO_INVALIDO'] }, 1, 0] } }
            }
          }
        ];

        const reasonsPipeline = [
          { $match: filter },
          { $group: { _id: '$motivo', quantidade: { $sum: 1 } } },
          { $sort: { quantidade: -1 } }
        ];

        const [rows, total, summaryRows, motivos] = await Promise.all([
          FinanceiroTratativa.find(filter)
            .sort({ proximaAcaoEm: 1, createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit),
          FinanceiroTratativa.countDocuments(filter),
          FinanceiroTratativa.aggregate(summaryPipeline),
          FinanceiroTratativa.aggregate(reasonsPipeline)
        ]);

        const s = summaryRows[0] || {};
        return res.json({
          ok: true,
          tratativas: rows.map(normalizeTratativaFinanceira),
          total,
          page,
          limit,
          pages: Math.max(1, Math.ceil(total / limit)),
          resumo: {
            total: Number(s.total || 0),
            abertas: Number(s.abertas || 0),
            concluidas: Number(s.concluidas || 0),
            semRetorno: Number(s.semRetorno || 0),
            renegociacoes: Number(s.renegociacoes || 0),
            contatosInvalidos: Number(s.contatosInvalidos || 0)
          },
          motivos: motivos.map((row) => ({
            motivo: row._id || 'OUTRO',
            quantidade: Number(row.quantidade || 0)
          }))
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: error.message || 'Erro ao listar tratativas financeiras.'
        });
      }
    }
  );

  app.patch(
    '/api/admin/financeiro/tratativas/:id',
    adminRequired,
    financeiroPermissionRequired('financeiro.cobranca'),
    async (req, res) => {
      try {
        const id = String(req.params.id || '').trim();
        if (!mongoose.Types.ObjectId.isValid(id)) {
          return res.status(400).json({ ok: false, error: 'Tratativa inválida.' });
        }

        const row = await FinanceiroTratativa.findById(id);
        if (!row) return res.status(404).json({ ok: false, error: 'Tratativa não encontrada.' });

        const antes = normalizeTratativaFinanceira(row);

        if (req.body?.resultado) {
          const resultado = String(req.body.resultado).trim().toUpperCase();
          if (!getTratativaResultadosPermitidos().has(resultado)) {
            return res.status(400).json({ ok: false, error: 'Resultado inválido.' });
          }
          row.resultado = resultado;
        }

        if (req.body?.proximaAcao) {
          const proximaAcao = String(req.body.proximaAcao).trim().toUpperCase();
          if (!getTratativaProximasAcoesPermitidas().has(proximaAcao)) {
            return res.status(400).json({ ok: false, error: 'Próxima ação inválida.' });
          }
          row.proximaAcao = proximaAcao;
        }

        if (req.body?.proximaAcaoEm) {
          const next = new Date(req.body.proximaAcaoEm);
          if (Number.isNaN(next.getTime())) {
            return res.status(400).json({ ok: false, error: 'Data da próxima ação inválida.' });
          }
          row.proximaAcaoEm = next;
        }

        if (req.body?.observacao !== undefined) {
          row.observacao = String(req.body.observacao || '').slice(0, 2000);
        }

        if (req.body?.concluida === true) {
          row.concluida = true;
          row.concluidaEm = new Date();
        }
        if (req.body?.concluida === false) {
          row.concluida = false;
          row.concluidaEm = null;
        }

        await row.save();

        await registrarAuditoriaFinanceira({
          req,
          acao: 'TRATATIVA_FINANCEIRA_ATUALIZADA',
          entidade: 'FinanceiroTratativa',
          entidadeId: String(row._id),
          codigo: row.carneCodigo,
          antes,
          depois: normalizeTratativaFinanceira(row)
        });

        return res.json({
          ok: true,
          message: 'Tratativa atualizada.',
          tratativa: normalizeTratativaFinanceira(row)
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: error.message || 'Erro ao atualizar a tratativa.'
        });
      }
    }
  );

  app.get(
    '/api/admin/financeiro/tratativas/resumo-motivos',
    adminRequired,
    financeiroPermissionRequired('financeiro.visualizar'),
    async (req, res) => {
      try {
        const rows = await FinanceiroTratativa.aggregate([
          {
            $group: {
              _id: '$motivo',
              total: { $sum: 1 },
              concluidas: { $sum: { $cond: ['$concluida', 1, 0] } },
              abertas: { $sum: { $cond: ['$concluida', 0, 1] } }
            }
          },
          { $sort: { total: -1 } }
        ]);
        return res.json({
          ok: true,
          motivos: rows.map((row) => ({
            motivo: row._id || 'OUTRO',
            total: Number(row.total || 0),
            concluidas: Number(row.concluidas || 0),
            abertas: Number(row.abertas || 0)
          }))
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: error.message || 'Erro ao consolidar motivos de inadimplência.'
        });
      }
    }
  );


  app.post(
    '/api/admin/financeiro/risco/recalcular',
    adminRequired,
    financeiroPermissionRequired('financeiro.credito'),
    async (req, res) => {
      try {
        const body = req.body || {};
        const result = await recalculateCustomerRisk({
          req,
          cpf: body.cpf || '',
          telefone: body.telefone || '',
          nome: body.nome || ''
        });
        return res.json({
          ok: true,
          message: 'Risco financeiro recalculado.',
          risco: normalizeRiscoCliente(result)
        });
      } catch (error) {
        return res.status(error.statusCode || 500).json({
          ok: false,
          error: error.message || 'Erro ao recalcular o risco do cliente.'
        });
      }
    }
  );

  app.post(
    '/api/admin/financeiro/risco/recalcular-todos',
    adminRequired,
    financeiroPermissionRequired('financeiro.credito'),
    async (req, res) => {
      try {
        const limit = Math.max(1, Math.min(Number(req.body?.limit || 1000), 5000));
        const carnes = await FinanceiroCarneDigital.find({})
          .sort({ updatedAt: -1 })
          .limit(limit)
          .lean();

        const unique = new Map();
        for (const carne of carnes) {
          const cliente = carne.cliente || {};
          const key = getCustomerRiskKey({
            cpf: cliente.cpf || '',
            telefone: cliente.telefone || '',
            nome: cliente.nome || ''
          });
          if (!unique.has(key)) {
            unique.set(key, {
              cpf: cliente.cpf || '',
              telefone: cliente.telefone || '',
              nome: cliente.nome || ''
            });
          }
        }

        const resultados = [];
        let erros = 0;
        for (const cliente of unique.values()) {
          try {
            const row = await recalculateCustomerRisk({ req, ...cliente });
            resultados.push({ ok: true, risco: normalizeRiscoCliente(row) });
          } catch (error) {
            erros += 1;
            resultados.push({ ok: false, cliente, error: error.message || String(error) });
          }
        }

        return res.json({
          ok: true,
          clientesAnalisados: unique.size,
          atualizados: resultados.filter((r) => r.ok).length,
          erros,
          resultados: resultados.slice(0, 200)
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: error.message || 'Erro ao recalcular os riscos.'
        });
      }
    }
  );

  app.get(
    '/api/admin/financeiro/risco/clientes',
    adminRequired,
    financeiroPermissionRequired('financeiro.visualizar'),
    async (req, res) => {
      try {
        const q = String(req.query.q || '').trim();
        const nivel = String(req.query.nivel || '').trim().toUpperCase();
        const decisao = String(req.query.decisao || '').trim().toUpperCase();
        const statusManual = String(req.query.statusManual || '').trim().toUpperCase();
        const page = Math.max(1, Number(req.query.page || 1));
        const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 200));
        const filter = {};

        if (nivel) filter.nivelRisco = nivel;
        if (decisao) filter.decisaoAutomatica = decisao;
        if (statusManual) filter.statusManual = statusManual;

        if (q) {
          const regex = new RegExp(escapeRegex(q), 'i');
          const digits = cleanPhone(q);
          filter.$or = [{ clienteNome: regex }];
          if (digits) {
            filter.$or.push({ clienteCpf: new RegExp(escapeRegex(digits), 'i') });
            filter.$or.push({ telefone: new RegExp(escapeRegex(digits), 'i') });
          }
        }

        const summaryPipeline = [
          { $match: filter },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              exposicaoAtual: { $sum: '$exposicaoAtual' },
              valorVencido: { $sum: '$valorVencido' },
              baixos: { $sum: { $cond: [{ $eq: ['$nivelRisco', 'BAIXO'] }, 1, 0] } },
              medios: { $sum: { $cond: [{ $eq: ['$nivelRisco', 'MEDIO'] }, 1, 0] } },
              altos: { $sum: { $cond: [{ $eq: ['$nivelRisco', 'ALTO'] }, 1, 0] } },
              criticos: { $sum: { $cond: [{ $eq: ['$nivelRisco', 'CRITICO'] }, 1, 0] } },
              bloqueadosManuais: { $sum: { $cond: [{ $eq: ['$statusManual', 'BLOQUEADO'] }, 1, 0] } }
            }
          }
        ];

        const [rows, total, summaryRows] = await Promise.all([
          FinanceiroRiscoCliente.find(filter)
            .sort({ scoreRisco: -1, valorVencido: -1, updatedAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit),
          FinanceiroRiscoCliente.countDocuments(filter),
          FinanceiroRiscoCliente.aggregate(summaryPipeline)
        ]);

        const s = summaryRows[0] || {};
        return res.json({
          ok: true,
          clientes: rows.map((row) => ({
            ...normalizeRiscoCliente(row),
            decisaoEfetiva: effectiveRiskDecision(row)
          })),
          total,
          page,
          limit,
          pages: Math.max(1, Math.ceil(total / limit)),
          resumo: {
            total: Number(s.total || 0),
            exposicaoAtual: Number(Number(s.exposicaoAtual || 0).toFixed(2)),
            valorVencido: Number(Number(s.valorVencido || 0).toFixed(2)),
            baixos: Number(s.baixos || 0),
            medios: Number(s.medios || 0),
            altos: Number(s.altos || 0),
            criticos: Number(s.criticos || 0),
            bloqueadosManuais: Number(s.bloqueadosManuais || 0)
          },
          enforcementEnabled:
            String(process.env.FINANCEIRO_RISK_ENFORCEMENT_ENABLED || 'false').toLowerCase() === 'true'
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: error.message || 'Erro ao listar riscos de crédito.'
        });
      }
    }
  );

  app.patch(
    '/api/admin/financeiro/risco/clientes/:id/decisao',
    adminRequired,
    financeiroPermissionRequired('financeiro.credito'),
    async (req, res) => {
      try {
        const id = String(req.params.id || '').trim();
        if (!mongoose.Types.ObjectId.isValid(id)) {
          return res.status(400).json({ ok: false, error: 'Registro de risco inválido.' });
        }

        const statusManual = String(req.body?.statusManual || '').trim().toUpperCase();
        const allowed = new Set(['AUTOMATICO', 'ATIVO', 'EM_REVISAO', 'BLOQUEADO']);
        if (!allowed.has(statusManual)) {
          return res.status(400).json({ ok: false, error: 'Decisão manual inválida.' });
        }

        const row = await FinanceiroRiscoCliente.findById(id);
        if (!row) return res.status(404).json({ ok: false, error: 'Registro de risco não encontrado.' });

        const antes = normalizeRiscoCliente(row);
        row.statusManual = statusManual;
        row.ultimaDecisaoManualEm = new Date();
        row.ultimaDecisaoManualPor = getFinanceiroActor(req);
        row.observacaoManual = String(req.body?.observacao || '').slice(0, 2000);
        await row.save();

        await registrarAuditoriaFinanceira({
          req,
          acao: 'RISCO_DECISAO_MANUAL_ALTERADA',
          entidade: 'FinanceiroRiscoCliente',
          entidadeId: String(row._id),
          codigo: row.clienteCpf || row.telefone || row.customerKey,
          antes,
          depois: normalizeRiscoCliente(row)
        });

        return res.json({
          ok: true,
          message: `Situação manual alterada para ${statusManual}.`,
          risco: {
            ...normalizeRiscoCliente(row),
            decisaoEfetiva: effectiveRiskDecision(row)
          }
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: error.message || 'Erro ao alterar a decisão de risco.'
        });
      }
    }
  );

  app.post(
    '/api/admin/financeiro/risco/avaliar-venda',
    adminRequired,
    financeiroPermissionRequired('financeiro.credito'),
    async (req, res) => {
      try {
        const body = req.body || {};
        let row = await recalculateCustomerRisk({
          req,
          cpf: body.cpf || '',
          telefone: body.telefone || '',
          nome: body.nome || ''
        });

        const valorVenda = Math.max(0, Number(body.valorVenda || 0));
        const decisaoEfetiva = effectiveRiskDecision(row);
        const enforcementEnabled =
          String(process.env.FINANCEIRO_RISK_ENFORCEMENT_ENABLED || 'false').toLowerCase() === 'true';

        let resultado = decisaoEfetiva;
        const motivos = [...(row.fatores || [])];

        if (valorVenda > Number(row.limiteSugerido || 0) && decisaoEfetiva === 'APROVAR') {
          resultado = 'REVISAR';
          motivos.push({
            code: 'VALOR_ACIMA_LIMITE',
            label: 'Valor da venda acima do limite sugerido',
            points: 0,
            value: valorVenda
          });
        }

        const bloquearFluxo = enforcementEnabled && resultado === 'BLOQUEAR';

        await registrarAuditoriaFinanceira({
          req,
          acao: 'VENDA_AVALIADA_RISCO',
          entidade: 'FinanceiroRiscoCliente',
          entidadeId: String(row._id),
          codigo: row.clienteCpf || row.telefone || row.customerKey,
          depois: {
            valorVenda,
            resultado,
            bloquearFluxo,
            enforcementEnabled
          }
        });

        return res.json({
          ok: true,
          resultado,
          bloquearFluxo,
          enforcementEnabled,
          advisoryOnly: !enforcementEnabled,
          cliente: {
            nome: row.clienteNome,
            cpf: row.clienteCpf,
            telefone: row.telefone
          },
          risco: {
            ...normalizeRiscoCliente(row),
            decisaoEfetiva
          },
          valorVenda,
          motivos,
          message: enforcementEnabled
            ? (bloquearFluxo
              ? 'Venda bloqueada pela política de risco.'
              : 'Venda avaliada conforme a política de risco.')
            : 'Avaliação consultiva: o bloqueio automático está desativado.'
        });
      } catch (error) {
        return res.status(error.statusCode || 500).json({
          ok: false,
          error: error.message || 'Erro ao avaliar o risco da venda.'
        });
      }
    }
  );


  app.get(
    '/api/admin/financeiro/diagnostico',
    adminRequired,
    financeiroPermissionRequired('financeiro.visualizar'),
    async (_req, res) => {
      try {
        const [
          carnes,
          filaPendente,
          promessasPendentes,
          tratativasAbertas,
          riscos,
          ultimaSincronizacao
        ] = await Promise.all([
          FinanceiroCarneDigital.countDocuments({ status: 'ATIVO' }),
          FinanceiroFilaCobranca.countDocuments({ status: { $ne: 'CONCLUIDO' } }),
          FinanceiroPromessaPagamento.countDocuments({ status: 'PENDENTE' }),
          FinanceiroTratativa.countDocuments({ concluida: false }),
          FinanceiroRiscoCliente.countDocuments({}),
          FinanceiroSincronizacaoLog.findOne({}).sort({ createdAt: -1 }).lean()
        ]);

        let whatsappConfigured = false;
        try {
          const wa = await getWhatsappSettings();
          whatsappConfigured = Boolean(wa?.enabled && wa?.apiUrl && wa?.apiKey && wa?.instanceName);
        } catch (_error) {
          whatsappConfigured = false;
        }

        return res.json({
          ok: true,
          checkedAt: new Date().toISOString(),
          localDate: dateKey(new Date()),
          mongo: {
            connected: mongoose.connection?.readyState === 1,
            readyState: Number(mongoose.connection?.readyState || 0),
            database: mongoose.connection?.name || MONGODB_DB || ''
          },
          sige: {
            configured: Boolean(isSigeConfigured()),
            apiUrlConfigured: Boolean(SIGE_API_URL),
            tokenConfigured: Boolean(SIGE_TOKEN)
          },
          whatsapp: {
            configured: whatsappConfigured
          },
          financeiro: {
            carnes,
            filaPendente,
            promessasPendentes,
            tratativasAbertas,
            riscos
          },
          ultimaSincronizacao: ultimaSincronizacao
            ? {
                id: String(ultimaSincronizacao._id),
                status: ultimaSincronizacao.status || '',
                iniciadoEm: ultimaSincronizacao.iniciadoEm || null,
                concluidoEm: ultimaSincronizacao.concluidoEm || null,
                atualizados: Number(ultimaSincronizacao.atualizados || 0),
                erros: Number(ultimaSincronizacao.erros || 0)
              }
            : null
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: error.message || 'Erro ao executar o diagnóstico financeiro.'
        });
      }
    }
  );

  app.get('/api/admin/financeiro/status', adminRequired, async (_req, res) => {
    return res.json({
      ok: true,
      fase: 'GESTAO_CARNE_DIGITAL_1.0',
      gestaoCarneDigitalPermanente: true,
      sincronizacaoFinanceiraFase3: true,
      segurancaFinanceiraFase4: true,
      calculoFinanceiroNoBackend: true,
      auditoriaFinanceira: true,
      operacaoCompletaFase5: true,
      filaCobrancaFase6: true,
      faixasAtrasoFase6: true,
      promessasPagamentoFase7: true,
      indicadoresRecuperacaoFase8: true,
      tratativasFinanceirasFase9: true,
      motivosInadimplenciaFase9: true,
      prevencaoRiscoFase10: true,
      avaliacaoNovaVendaFase10: true,
      correcaoFusoDataFila: true,
      sincronizacaoSigeComFallback: true,
      preservacaoParcelasEmFalhaSige: true,
      identificacaoParcelasNormalizada: true,
      diagnosticoOperacional: true,
      dashboardFinanceiroUnificado: true,
      periodoRecuperacaoAutomatico: true,
      reguaWhatsappFase12: true,
      antiDuplicidadeWhatsapp: true,
      janelaSeguraWhatsapp: true,
      recuperacaoTelefoneFase12_1: true,
      propagacaoTelefoneFinanceiro: true,
      preenchimentoManualTelefone: true,
      monitorEntregaWhatsappFase13: true,
      webhookStatusWhatsapp: true,
      reenvioControladoWhatsapp: true,
      migracaoLogsWhatsappFase13_1: true,
      compatibilidadeHistoricoWhatsapp: true,
      configuracaoWebhookEvolutionFase14: true,
      testeInternoWebhookWhatsapp: true,
      eventosWhatsappMonitorados: ['MESSAGES_UPDATE', 'SEND_MESSAGE'],
      homologacaoSeguraFase15: true,
      bloqueioWebhookRealSemFlag: true,
      checklistPreDeploy: true,
      prevencaoDuplicidadePromessas: true,
      prevencaoDuplicidadeTratativas: true,
      segundaViaSemDuplicidade: true,
      renegociacaoPreservaOriginal: true,
      fonteOficial: 'sige',
      parcelas: 'sige',
      saldo: 'sige',
      pagamentos: 'sige',
      baixaSigeBackend: true,
      reciboAutomatico: true,
      whatsappAutomatico: true,
      mongoDb: 'historico_recibos_whatsapp_auditoria',
      rotasLegadasPreservadas: true
    });
  });

  // ============================================================
  // FASE C.3 - BAIXA NO SIGE + RECIBO + WHATSAPP
  // O SIGE permanece como fonte financeira oficial.
  // Somente após a confirmação da baixa, o MongoDB recebe o recibo/auditoria
  // e o WhatsApp é enviado ao cliente.
  // ============================================================
  function getSigeRequestHeaders() {
    const headers = typeof sigeAuthHeaders === 'function'
      ? sigeAuthHeaders()
      : (sigeAuthHeaders || {});

    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...headers
    };
  }

  function getSigeRequestUrl(endpoint = '') {
    const base = String(SIGE_API_URL || '').replace(/\/+$/, '');
    const path = String(endpoint || '').replace(/^\/+/, '');
    return `${base}/${path}`;
  }

  async function getSigeLancamentoByCodigo(codigo) {
    const rows = await sigeGet('Lancamentos/Get', { codigo });
    if (Array.isArray(rows)) return rows[0] || null;
    return rows || null;
  }

  function getSigeLancamentoSaldo(lancamento = {}) {
    const valor = parseSigeMoney(lancamento.Valor ?? lancamento.valor ?? 0);
    const recebido = parseSigeMoney(lancamento.TotalRecebido ?? lancamento.totalRecebido ?? 0);
    return Number(Math.max(0, valor - recebido).toFixed(2));
  }

  function hasSigePagamentoDocumento(lancamento = {}, numeroDocumento = '') {
    const documento = String(numeroDocumento || '').trim().toLowerCase();
    if (!documento) return false;

    const pagamentos = ensureArray(lancamento.Pagamentos || lancamento.pagamentos);
    return pagamentos.some((pagamento) => (
      String(pagamento?.NumeroDocumento || pagamento?.numeroDocumento || '')
        .trim()
        .toLowerCase() === documento
    ));
  }


  async function createReceiptAfterSigePayment({
    req,
    codigo,
    lancamento,
    valor,
    formaPagamento,
    numeroDocumento,
    dataPagamento,
    body
  }) {
    const nome = String(
      body.clienteNome ||
      body.nome ||
      lancamento?.Cliente ||
      lancamento?.cliente ||
      lancamento?.Pessoa ||
      ''
    ).trim();

    const telefone = normalizePhone(
      body.telefone ||
      body.whatsapp ||
      lancamento?.Telefone ||
      lancamento?.telefone ||
      '',
      '55'
    );

    const cpf = cleanPhone(
      body.cpf ||
      body.clienteCpf ||
      lancamento?.CPF ||
      lancamento?.CpfCnpj ||
      lancamento?.cpf ||
      ''
    );

    const contrato = String(
      body.contrato ||
      lancamento?.CodigoContrato ||
      lancamento?.codigoContrato ||
      lancamento?.CodigoVenda ||
      lancamento?.codigoVenda ||
      ''
    ).trim();

    const produto = String(
      body.produto ||
      body.descricao ||
      lancamento?.Descricao ||
      lancamento?.descricao ||
      'Pagamento de parcela SIGE'
    ).trim();

    const parcela = formatCrediarioParcela(String(
      body.parcela ||
      body.parcelaLabel ||
      lancamento?.NumeroDocumento ||
      lancamento?.documento ||
      ''
    ).trim());

    const observacaoBase = String(body.observacao || '').trim();
    const observacao = [
      `Pagamento confirmado no SIGE. Lançamento ${codigo}.`,
      `Documento do pagamento: ${numeroDocumento}.`,
      observacaoBase
    ].filter(Boolean).join(' ');

    const existingReceipt = await CrediarioRecibo.findOne({
      sigeCodigo: codigo,
      documento: numeroDocumento
    });

    if (existingReceipt) {
      return {
        recibo: existingReceipt,
        criadoAgora: false,
        whatsapp: existingReceipt.enviadoWhatsapp
          ? { ok: true, alreadySent: true }
          : { skipped: true, reason: 'recibo_existente_sem_reenvio_automatico' }
      };
    }

    let cliente = null;
    const clienteId = String(body.clienteId || '').trim();

    if (clienteId && mongoose.Types.ObjectId.isValid(clienteId)) {
      cliente = await CrediarioCliente.findById(clienteId);
    }

    if (cliente) {
      if (nome) cliente.nome = nome;
      if (telefone) cliente.telefone = telefone;
      if (cpf) cliente.cpf = cpf;
      if (contrato) cliente.contrato = contrato;
      cliente.ativo = true;
      await cliente.save();
    } else if (nome || telefone || cpf || contrato) {
      const query = contrato
        ? { contrato }
        : (cpf ? { cpf } : (telefone ? { telefone } : { nome }));

      cliente = await CrediarioCliente.findOneAndUpdate(
        query,
        {
          $set: {
            nome: nome || 'Cliente SIGE',
            telefone,
            cpf,
            contrato,
            ativo: true
          }
        },
        { upsert: true, new: true }
      );
    }

    let reciboNumber = makeReciboNumber();
    while (await CrediarioRecibo.exists({ recibo: reciboNumber })) {
      reciboNumber = makeReciboNumber();
    }

    const recibo = await CrediarioRecibo.create({
      recibo: reciboNumber,
      clienteId: cliente?._id || null,
      clienteNome: nome || cliente?.nome || 'Cliente SIGE',
      clienteCpf: cpf || cliente?.cpf || '',
      telefone: telefone || cliente?.telefone || '',
      contrato: contrato || cliente?.contrato || '',
      produto,
      parcela,
      valorPago: Number(valor.toFixed(2)),
      formaPagamento,
      dataPagamento,
      observacao,
      criadoPor: req.admin?.email || req.auth?.email || 'admin',
      status: 'confirmado_sige',
      origem: 'sige_baixa_automatica',
      sigeCodigo: codigo,
      documento: numeroDocumento,
      sigeDescricao: String(lancamento?.Descricao || lancamento?.descricao || produto),
      sigeDataVencimento: lancamento?.DataVencimento || lancamento?.dataVencimento || null,
      importHash: crypto
        .createHash('sha256')
        .update(`sige-baixa|${codigo}|${numeroDocumento}`)
        .digest('hex')
    });

    const enviarWhatsapp = body.enviarWhatsapp !== false;
    let whatsapp = { skipped: true, reason: 'envio_desativado' };

    if (enviarWhatsapp && recibo.telefone) {
      try {
        whatsapp = await sendCrediarioReceiptWhatsapp(recibo);
        recibo.enviadoWhatsapp = true;
        recibo.enviadoWhatsappEm = now();
        recibo.whatsappResultado = redact(whatsapp || null);
        await recibo.save();
      } catch (error) {
        whatsapp = { ok: false, error: error.message || String(error) };
        recibo.whatsappResultado = whatsapp;
        await recibo.save();
      }
    } else if (enviarWhatsapp && !recibo.telefone) {
      whatsapp = { ok: false, skipped: true, reason: 'cliente_sem_whatsapp' };
      recibo.whatsappResultado = whatsapp;
      await recibo.save();
    }

    await createAdminNotification({
      type: 'crediario_recibo_sige',
      title: '🧾 Pagamento SIGE e recibo registrados',
      message: `${recibo.recibo} - ${recibo.clienteNome} - ${formatMoneyBRL(recibo.valorPago)}`,
      relatedId: String(recibo._id),
      severity: whatsapp?.ok === false ? 'warning' : 'info',
      metadata: {
        sigeCodigo: codigo,
        numeroDocumento,
        recibo: recibo.recibo,
        clienteNome: recibo.clienteNome,
        valorPago: recibo.valorPago,
        whatsapp
      }
    });

    return { recibo, criadoAgora: true, whatsapp };
  }

  app.post('/api/admin/financeiro/lancamentos/:codigo/pagamentos', adminRequired, async (req, res) => {
    try {
      if (!isSigeConfigured()) {
        return res.status(503).json({
          ok: false,
          error: 'Integração com o SIGE não está configurada.'
        });
      }

      const codigo = Number(String(req.params.codigo || '').trim());
      const body = req.body || {};
      const valor = parseSigeMoney(body.valor ?? body.Valor ?? body.valorPago ?? 0);
      const formaPagamento = String(body.formaPagamento || body.FormaPagamento || 'PIX').trim();
      const contaBancaria = String(body.contaBancaria || body.ContaBancaria || 'ariana moveis').trim();
      const conciliado = body.conciliado !== false && body.Conciliado !== false;
      const dataInformada = body.data || body.Data || body.dataPagamento || null;
      const dataPagamento = dataInformada ? new Date(dataInformada) : new Date();
      const numeroDocumento = String(
        body.numeroDocumento ||
        body.NumeroDocumento ||
        `ARIANA-${codigo}-${Date.now()}`
      ).trim();

      if (!Number.isInteger(codigo) || codigo <= 0) {
        return res.status(400).json({ ok: false, error: 'Código do lançamento SIGE inválido.' });
      }
      if (!Number.isFinite(valor) || valor <= 0) {
        return res.status(400).json({ ok: false, error: 'Informe um valor de pagamento válido.' });
      }
      if (!formaPagamento) {
        return res.status(400).json({ ok: false, error: 'Informe a forma de pagamento.' });
      }
      if (!contaBancaria) {
        return res.status(400).json({ ok: false, error: 'Informe a conta bancária.' });
      }
      if (!numeroDocumento) {
        return res.status(400).json({ ok: false, error: 'Informe o número do documento do pagamento.' });
      }
      if (Number.isNaN(dataPagamento.getTime())) {
        return res.status(400).json({ ok: false, error: 'Data do pagamento inválida.' });
      }

      const lancamentoAntes = await getSigeLancamentoByCodigo(codigo);
      if (!lancamentoAntes || !Number(lancamentoAntes.Codigo ?? lancamentoAntes.codigo)) {
        return res.status(404).json({ ok: false, error: 'Lançamento não encontrado no SIGE.' });
      }

      const quitadoAntes = lancamentoAntes.Quitado === true || lancamentoAntes.quitado === true;
      const saldoAntes = getSigeLancamentoSaldo(lancamentoAntes);

      if (hasSigePagamentoDocumento(lancamentoAntes, numeroDocumento)) {
        return res.status(409).json({
          ok: false,
          error: 'Este pagamento já foi registrado no SIGE.',
          codigo,
          numeroDocumento
        });
      }

      if (quitadoAntes || saldoAntes <= 0) {
        return res.status(409).json({
          ok: false,
          error: 'Esta parcela já está quitada no SIGE.',
          codigo,
          saldo: saldoAntes
        });
      }

      if (valor > saldoAntes + 0.009) {
        return res.status(422).json({
          ok: false,
          error: `O pagamento não pode ultrapassar o saldo de ${formatMoneyBRL(saldoAntes)}.`,
          codigo,
          valor,
          saldo: saldoAntes
        });
      }

      const payload = {
        Codigo: codigo,
        Pagamentos: [
          {
            Data: dataPagamento.toISOString(),
            FormaPagamento: formaPagamento,
            NumeroDocumento: numeroDocumento,
            ContaBancaria: contaBancaria,
            Conciliado: conciliado,
            Valor: Number(valor.toFixed(2))
          }
        ]
      };

      const response = await axios.post(
        getSigeRequestUrl('Lancamentos/AdicionarPagamentos'),
        payload,
        {
          headers: getSigeRequestHeaders(),
          timeout: Number(SIGE_TIMEOUT_MS || 30000),
          validateStatus: () => true
        }
      );

      if (response.status < 200 || response.status >= 300) {
        const providerMessage = typeof response.data === 'string'
          ? response.data
          : (response.data?.message || response.data?.error || response.data?.Mensagem);
        const error = new Error(providerMessage || `SIGE retornou HTTP ${response.status} ao registrar o pagamento.`);
        error.statusCode = response.status >= 400 && response.status < 500 ? response.status : 502;
        error.responseData = response.data;
        throw error;
      }

      const lancamentoDepois = await getSigeLancamentoByCodigo(codigo);
      if (!lancamentoDepois) {
        const error = new Error('O SIGE recebeu a solicitação, mas não foi possível confirmar o lançamento atualizado.');
        error.statusCode = 502;
        throw error;
      }

      const pagamentoConfirmado = hasSigePagamentoDocumento(lancamentoDepois, numeroDocumento);
      const saldoDepois = getSigeLancamentoSaldo(lancamentoDepois);
      const totalAntes = parseSigeMoney(lancamentoAntes.TotalRecebido ?? lancamentoAntes.totalRecebido ?? 0);
      const totalDepois = parseSigeMoney(lancamentoDepois.TotalRecebido ?? lancamentoDepois.totalRecebido ?? 0);
      const aumentoRecebido = Number((totalDepois - totalAntes).toFixed(2));

      if (!pagamentoConfirmado || aumentoRecebido + 0.009 < valor) {
        const error = new Error('O SIGE não confirmou completamente o pagamento após a gravação.');
        error.statusCode = 502;
        error.responseData = {
          pagamentoConfirmado,
          totalAntes,
          totalDepois,
          aumentoRecebido,
          valorEsperado: valor
        };
        throw error;
      }

      let posPagamento = null;
      try {
        posPagamento = await createReceiptAfterSigePayment({
          req,
          codigo,
          lancamento: lancamentoDepois,
          valor,
          formaPagamento,
          numeroDocumento,
          dataPagamento,
          body
        });
      } catch (receiptError) {
        console.error('[financeiro SIGE C.3 pós-pagamento]', receiptError.message || receiptError);
        return res.json({
          ok: true,
          fase: 'C.3',
          message: 'Pagamento confirmado no SIGE, mas houve falha ao criar o recibo.',
          warning: true,
          fonteFinanceira: 'sige',
          codigo,
          pagamento: {
            valor: Number(valor.toFixed(2)),
            formaPagamento,
            numeroDocumento,
            contaBancaria,
            conciliado,
            data: dataPagamento.toISOString()
          },
          saldoAntes,
          saldoDepois,
          quitado: lancamentoDepois.Quitado === true || lancamentoDepois.quitado === true,
          lancamento: lancamentoDepois,
          reciboCriado: false,
          whatsappEnviado: false,
          erroPosPagamento: receiptError.message || 'Falha ao criar recibo após confirmação no SIGE.'
        });
      }

      const reciboNormalizado = posPagamento?.recibo
        ? normalizeCrediarioRecibo(posPagamento.recibo)
        : null;
      const whatsapp = posPagamento?.whatsapp || { skipped: true };
      const whatsappEnviado = whatsapp?.ok === true || posPagamento?.recibo?.enviadoWhatsapp === true;

      await registrarAuditoriaFinanceira({
        req,
        acao: 'PAGAMENTO_CONFIRMADO_SIGE',
        entidade: 'LancamentoSige',
        entidadeId: String(codigo),
        codigo: String(numeroDocumento),
        antes: { saldo: saldoAntes },
        depois: { saldo: saldoDepois, valorPago: Number(valor.toFixed(2)), quitado: lancamentoDepois.Quitado === true || lancamentoDepois.quitado === true },
        metadata: { formaPagamento, contaBancaria, recibo: reciboNormalizado?.recibo || '', whatsappEnviado }
      });

      return res.json({
        ok: true,
        fase: 'C.3',
        message: whatsappEnviado
          ? 'Pagamento confirmado no SIGE, recibo criado e enviado pelo WhatsApp.'
          : 'Pagamento confirmado no SIGE e recibo criado. O WhatsApp não foi enviado.',
        warning: !whatsappEnviado,
        fonteFinanceira: 'sige',
        codigo,
        pagamento: {
          valor: Number(valor.toFixed(2)),
          formaPagamento,
          numeroDocumento,
          contaBancaria,
          conciliado,
          data: dataPagamento.toISOString()
        },
        saldoAntes,
        saldoDepois,
        quitado: lancamentoDepois.Quitado === true || lancamentoDepois.quitado === true,
        lancamento: lancamentoDepois,
        reciboCriado: Boolean(reciboNormalizado),
        reciboNovo: posPagamento?.criadoAgora === true,
        recibo: reciboNormalizado,
        whatsappEnviado,
        whatsapp
      });
    } catch (error) {
      console.error('[financeiro SIGE pagamento C.3]', error.responseData || error.message || error);
      return res.status(error.statusCode || 500).json({
        ok: false,
        fase: 'C.3',
        error: error.message || 'Erro ao registrar pagamento no SIGE',
        detalhes: error.responseData || undefined
      });
    }
  });

  app.post('/api/admin/sige/carne/enviar-whatsapp', adminRequired, async (req, res) => {
    try {
      const q = String(req.body?.cliente || req.body?.q || '').trim();
      const telefoneManual = String(req.body?.telefone || '').trim();
      const documento = String(
        req.body?.documento ||
        req.body?.numeroDocumento ||
        req.body?.compra ||
        ''
      ).trim();

      const carne = await getSigeCarneData(q, {
        limit: req.body?.limit || 5000,
        maxRecords: req.body?.maxRecords || 20000
      });

      const telefone = normalizePhone(telefoneManual || carne.telefone || '', '55');
      if (!telefone) {
        return res.status(400).json({ ok: false, error: 'Cliente sem WhatsApp cadastrado. Informe o celular para enviar o carnê.' });
      }

      if (!Array.isArray(carne.grupos) || !carne.grupos.length) {
        return res.status(404).json({ ok: false, error: 'Nenhuma parcela encontrada para enviar no carnê.' });
      }

      if (!documento) {
        return res.status(400).json({
          ok: false,
          error: 'Escolha a compra que deseja enviar.'
        });
      }

      const text = buildSigeCarneWhatsappMessage(carne, { documento });
      const sent = await waSendTextMessage({ number: telefone, text });
      return res.json({
        ok: true,
        message: 'Carnê da compra selecionada enviado pelo WhatsApp.',
        telefone,
        documento,
        text,
        whatsapp: sent
      });
    } catch (error) {
      console.error('Erro ao enviar carnê SIGE por WhatsApp:', error.message || error);
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao enviar carnê por WhatsApp' });
    }
  });


  function getSigeAutoCobrancaTipo(diasAtraso = 0) {
    const dias = Number(diasAtraso || 0);
    if (dias >= 15) return 'urgente';
    if (dias >= 7) return 'normal';
    if (dias >= 1) return 'amigavel';
    return '';
  }

  function buildSigeAutoCobrancaKey(item = {}, tipo = 'normal') {
    const today = new Date().toISOString().slice(0, 10);
    const codigo = String(item.codigo || item.id || item.codigoLancamento || '').trim();
    const documento = String(item.documento || item.NumeroDocumento || '').trim();
    const cliente = String(item.nome || item.cliente || item.clienteNome || '').trim().toLowerCase();
    const venc = String(item.dataVencimento || '').slice(0, 10);
    return crypto.createHash('sha1').update([today, tipo, codigo, documento, cliente, venc].join('|')).digest('hex');
  }

  function buildSigeAutoCobrancaMessage(item = {}, tipo = 'amigavel') {
    const nome = String(item.nome || item.cliente || item.clienteNome || 'cliente').trim() || 'cliente';
    const documento = String(item.documento || item.codigo || '').trim();
    const descricao = String(item.descricao || 'Parcela em aberto').trim();
    const valor = Number((item.saldo && item.saldo > 0) ? item.saldo : (item.valor || 0));
    const vencimento = item.dataVencimento ? formatDateBR(item.dataVencimento) : 'não informado';
    const dias = Number(item.diasAtraso || 0);
    const tipoNorm = String(tipo || 'amigavel').toLowerCase();

    const cabecalho = tipoNorm === 'urgente'
      ? '🚨 Aviso urgente de pendência financeira'
      : (tipoNorm === 'normal' ? '🔔 Aviso de pendência financeira' : '📌 Lembrete de parcela em atraso');

    const texto = tipoNorm === 'urgente'
      ? 'Consta parcela vencida há vários dias em nosso sistema. Pedimos contato com urgência para regularização ou esclarecimentos.'
      : (tipoNorm === 'normal'
        ? 'Identificamos parcela em atraso em nosso sistema. Pedimos a gentileza de entrar em contato com nosso financeiro.'
        : 'Identificamos uma parcela vencida recentemente em nosso sistema. Caso já tenha realizado o pagamento, por favor desconsidere esta mensagem.');return [
      cabecalho,
      '',
      `Olá, ${nome}.`,
      '',
      texto,
      '',
      documento ? `🧾 Documento: ${documento}` : '',
      descricao ? `📦 Referência: ${descricao.slice(0, 160)}` : '',
      valor > 0 ? `💰 Valor: ${formatMoneyBRL(valor)}` : '',
      `📅 Vencimento: ${vencimento}`,
      dias > 0 ? `⏱️ Dias em atraso: ${dias}` : '',
      '',
      'Para mais informações ou regularização, fale com a loja:',
      '📲 WhatsApp financeiro: (31) 98514-7119',
      '',
      'Ariana Móveis'
    ].filter(Boolean).join('\n').trim();
  }

  async function enrichSigeInadimplenteTelefone(item = {}) {
    if (item.telefone) return item;
    const nome = String(item.nome || item.cliente || '').trim();
    if (!nome) return item;
    try {
      const pessoas = await getSigePessoasByQuery(nome, 3);
      const exact = pessoas.find(p => String(p.nome || '').trim().toLowerCase() === nome.toLowerCase()) || pessoas[0];
      if (exact?.telefone) {
        return { ...item, telefone: exact.telefone, cpf: item.cpf || exact.cpf || '', cidade: item.cidade || exact.cidade || '', uf: item.uf || exact.uf || '' };
      }
    } catch (error) {
      console.warn('Não foi possível buscar telefone do inadimplente:', error.message || error);
    }
    return item;
  }

  async function getSigeInadimplentesData({ q = '', limit = 1000, maxRecords = 4000 } = {}) {
    const lancamentos = await getSigeLancamentosFiltered({
      q,
      status: 'atrasado',
      limit,
      maxRecords
    });

    let pessoas = [];
    try {
      if (q) {
        const rows = await sigeGet('Pessoas/Pesquisar', { nomefantasia: q });
        pessoas = rows.map(normalizeSigePessoa).filter((p) => p.nome);
      } else {
        const rows = await sigeGet('Pessoas/ConsultaInadimplencias', {});
        pessoas = rows.map(normalizeSigePessoa).filter((p) => p.nome);
      }
    } catch (innerError) {
      console.warn('SIGE ConsultaInadimplencias indisponível; usando lançamentos vencidos:', innerError.message || innerError);
      pessoas = [];
    }

    const byName = new Map(pessoas.map((p) => [String(p.nome || '').toLowerCase(), p]));
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const inadimplentes = lancamentos.map((l) => {
      const pessoa = byName.get(String(l.cliente || '').toLowerCase()) || null;
      const vencimento = parseSigeDate(l.dataVencimento);
      let diasAtraso = 0;
      if (vencimento) {
        const vencDate = new Date(vencimento);
        vencDate.setHours(0, 0, 0, 0);
        diasAtraso = Math.max(0, Math.floor((today.getTime() - vencDate.getTime()) / 86400000));
      }
      return {
        ...l,
        nome: l.cliente,
        telefone: pessoa?.telefone || l.telefone || '',
        cpf: pessoa?.cpf || l.cpf || '',
        cidade: pessoa?.cidade || '',
        uf: pessoa?.uf || '',
        pessoaId: pessoa?.id || '',
        diasAtraso
      };
    }).sort((a, b) => Number(b.diasAtraso || 0) - Number(a.diasAtraso || 0)).slice(0, limit);

    const clientesUnicos = new Set(inadimplentes.map((item) => String(item.nome || item.cliente || '').trim().toLowerCase()).filter(Boolean));
    const valorTotal = inadimplentes.reduce((sum, item) => sum + Number(item.saldo && item.saldo > 0 ? item.saldo : item.valor || 0), 0);
    const parcelaMaisAntiga = inadimplentes.reduce((oldest, item) => {
      const dt = parseSigeDate(item.dataVencimento);
      if (!dt) return oldest;
      if (!oldest) return item;
      const oldDt = parseSigeDate(oldest.dataVencimento);
      return oldDt && oldDt <= dt ? oldest : item;
    }, null);

    return {
      inadimplentes,
      total: inadimplentes.length,
      resumo: {
        clientes: clientesUnicos.size,
        parcelas: inadimplentes.length,
        valorTotal: Number(valorTotal.toFixed(2)),
        parcelaMaisAntiga: parcelaMaisAntiga ? {
          cliente: parcelaMaisAntiga.nome || parcelaMaisAntiga.cliente || '',
          dataVencimento: parcelaMaisAntiga.dataVencimento || null,
          diasAtraso: parcelaMaisAntiga.diasAtraso || 0,
          valor: Number(parcelaMaisAntiga.saldo && parcelaMaisAntiga.saldo > 0 ? parcelaMaisAntiga.saldo : parcelaMaisAntiga.valor || 0)
        } : null
      }
    };
  }

  app.get('/api/admin/sige/inadimplentes', adminRequired, async (req, res) => {
    try {
      const q = String(req.query.q || '').trim();
      const limit = Math.max(1, Math.min(Number(req.query.limit || 1000), 2000));
      const data = await getSigeInadimplentesData({
        q,
        limit,
        maxRecords: req.query.maxRecords || 4000
      });
      return res.json({ ok: true, ...data, fonte: 'lancamentos_vencidos' });
    } catch (error) {
      console.error('Erro SIGE inadimplentes:', error.message || error);
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao consultar inadimplentes no SIGE' });
    }
  });

  app.post('/api/admin/sige/cobranca', adminRequired, async (req, res) => {
    try {
      const telefone = String(req.body.telefone || '').trim();
      const clienteNome = String(req.body.clienteNome || req.body.nome || '').trim();
      if (!clienteNome) return res.status(400).json({ ok: false, error: 'Cliente não informado' });
      if (!telefone) return res.status(400).json({ ok: false, error: 'Telefone não informado' });

      const whatsapp = await sendCrediarioCobrancaWhatsapp({
        telefone,
        clienteNome,
        produto: req.body.produto || req.body.descricao || 'Pendência financeira SIGE',
        parcela: req.body.parcela || '',
        valor: parseSigeMoney(req.body.valor || req.body.valorAtualizado || req.body.saldo || 0),
        valorOriginal: parseSigeMoney(req.body.valorOriginal || req.body.saldoOriginal || req.body.valor || 0),
        multa: parseSigeMoney(req.body.multa || 0),
        juros: parseSigeMoney(req.body.juros || 0),
        valorAtualizado: parseSigeMoney(req.body.valorAtualizado || req.body.valor || req.body.saldo || 0),
        documento: req.body.documento || req.body.codigo || '',
        contrato: req.body.contrato || '',
        tipo: req.body.tipo || 'normal'
      });

      return res.json({ ok: true, whatsapp });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao enviar cobrança SIGE' });
    }
  });


  app.get('/api/admin/sige/cobranca-automatica/config', adminRequired, async (_req, res) => {
    return res.json({
      ok: true,
      enabled: String(process.env.SIGE_AUTO_COBRANCA_ENABLED || 'false').toLowerCase() === 'true',
      hour: Number(process.env.SIGE_AUTO_COBRANCA_HOUR || 9),
      rules: [
        { minDias: 1, tipo: 'amigavel', label: '1 dia ou mais: lembrete amigável' },
        { minDias: 7, tipo: 'normal', label: '7 dias ou mais: cobrança normal' },
        { minDias: 15, tipo: 'urgente', label: '15 dias ou mais: cobrança urgente' }
      ],
      antiRepeticao: 'Não envia a mesma cobrança para a mesma parcela mais de uma vez no mesmo dia.'
    });
  });

  app.post('/api/admin/sige/cobranca-automatica/simular', adminRequired, async (req, res) => {
    try {
      const q = String(req.body?.q || req.query?.q || '').trim();
      const limit = Math.max(1, Math.min(Number(req.body?.limit || req.query?.limit || 100), 500));
      const data = await getSigeInadimplentesData({ q, limit, maxRecords: req.body?.maxRecords || 8000 });
      const candidatos = [];

      for (const item of data.inadimplentes) {
        const tipo = getSigeAutoCobrancaTipo(item.diasAtraso);
        if (!tipo) continue;
        const enriched = await enrichSigeInadimplenteTelefone(item);
        const uniqueKey = buildSigeAutoCobrancaKey(enriched, tipo);
        const existente = await CrediarioCobrancaLog.findOne({ uniqueKey }).lean();
        candidatos.push({
          ...enriched,
          tipo,
          uniqueKey,
          jaEnviadoHoje: !!existente,
          podeEnviar: !!enriched.telefone && !existente,
          motivoBloqueio: !enriched.telefone ? 'sem telefone' : (existente ? 'já enviado hoje' : '')
        });
      }

      return res.json({
        ok: true,
        candidatos,
        total: candidatos.length,
        resumo: {
          podeEnviar: candidatos.filter(c => c.podeEnviar).length,
          semTelefone: candidatos.filter(c => !c.telefone).length,
          jaEnviadoHoje: candidatos.filter(c => c.jaEnviadoHoje).length
        }
      });
    } catch (error) {
      console.error('Erro ao simular cobrança automática SIGE:', error.message || error);
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao simular cobrança automática' });
    }
  });

  app.post('/api/admin/sige/cobranca-automatica/executar', adminRequired, async (req, res) => {
    try {
      const q = String(req.body?.q || '').trim();
      const limit = Math.max(1, Math.min(Number(req.body?.limit || 100), 300));
      const dryRun = req.body?.dryRun === true;
      const data = await getSigeInadimplentesData({ q, limit, maxRecords: req.body?.maxRecords || 8000 });
      const resultados = [];

      for (const item of data.inadimplentes) {
        const tipo = getSigeAutoCobrancaTipo(item.diasAtraso);
        if (!tipo) continue;
        const enriched = await enrichSigeInadimplenteTelefone(item);
        const uniqueKey = buildSigeAutoCobrancaKey(enriched, tipo);
        const valor = Number((enriched.saldo && enriched.saldo > 0) ? enriched.saldo : (enriched.valor || 0));
        const telefone = normalizePhone(enriched.telefone || '', '55');
        const existente = await CrediarioCobrancaLog.findOne({ uniqueKey }).lean();

        if (existente) {
          resultados.push({ ok: false, skipped: true, motivo: 'já enviado hoje', cliente: enriched.nome || enriched.cliente, tipo, documento: enriched.documento, codigo: enriched.codigo });
          continue;
        }
        if (!telefone) {
          resultados.push({ ok: false, skipped: true, motivo: 'sem telefone', cliente: enriched.nome || enriched.cliente, tipo, documento: enriched.documento, codigo: enriched.codigo });
          continue;
        }

        const mensagem = buildSigeAutoCobrancaMessage(enriched, tipo);
        if (dryRun) {
          resultados.push({ ok: true, dryRun: true, cliente: enriched.nome || enriched.cliente, telefone, tipo, documento: enriched.documento, codigo: enriched.codigo, valor, mensagem });
          continue;
        }

        try {
          const whatsapp = await waSendTextMessage({ number: telefone, text: mensagem });
          await CrediarioCobrancaLog.create({
            uniqueKey,
            origem: 'sige_auto',
            clienteNome: enriched.nome || enriched.cliente || '',
            telefone,
            documento: String(enriched.documento || ''),
            codigoLancamento: String(enriched.codigo || enriched.id || ''),
            tipo,
            diasAtraso: Number(enriched.diasAtraso || 0),
            valor,
            dataVencimento: parseSigeDate(enriched.dataVencimento),
            enviado: true,
            enviadoEm: new Date(),
            whatsappResultado: whatsapp,
            mensagem,
            metadata: { lancamento: enriched }
          });
          resultados.push({ ok: true, cliente: enriched.nome || enriched.cliente, telefone, tipo, documento: enriched.documento, codigo: enriched.codigo, valor });
        } catch (sendError) {
          await CrediarioCobrancaLog.create({
            uniqueKey,
            origem: 'sige_auto',
            clienteNome: enriched.nome || enriched.cliente || '',
            telefone,
            documento: String(enriched.documento || ''),
            codigoLancamento: String(enriched.codigo || enriched.id || ''),
            tipo,
            diasAtraso: Number(enriched.diasAtraso || 0),
            valor,
            dataVencimento: parseSigeDate(enriched.dataVencimento),
            enviado: false,
            erro: sendError.message || String(sendError),
            mensagem,
            metadata: { lancamento: enriched }
          }).catch(() => null);
          resultados.push({ ok: false, cliente: enriched.nome || enriched.cliente, telefone, tipo, documento: enriched.documento, codigo: enriched.codigo, error: sendError.message || String(sendError) });
        }
      }

      return res.json({
        ok: true,
        dryRun,
        resultados,
        resumo: {
          total: resultados.length,
          enviados: resultados.filter(r => r.ok && !r.dryRun).length,
          simulados: resultados.filter(r => r.dryRun).length,
          ignorados: resultados.filter(r => r.skipped).length,
          erros: resultados.filter(r => !r.ok && !r.skipped).length
        }
      });
    } catch (error) {
      console.error('Erro ao executar cobrança automática SIGE:', error.message || error);
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao executar cobrança automática' });
    }
  });

  app.get('/api/admin/crediario/clientes', adminRequired, async (req, res) => {
    try {
      const q = String(req.query.q || '').trim();
      const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 200));
      const filter = {};
      if (q) {
        const digits = cleanPhone(q);
        filter.$or = [
          { nome: new RegExp(escapeRegex(q), 'i') },
          { contrato: new RegExp(escapeRegex(q), 'i') }
        ];
        if (digits) {
          filter.$or.push({ cpf: new RegExp(escapeRegex(digits), 'i') });
          filter.$or.push({ telefone: new RegExp(escapeRegex(digits), 'i') });
        }
      }
      const rows = await CrediarioCliente.find(filter).sort({ updatedAt: -1 }).limit(limit);
      return res.json({ ok: true, clientes: rows.map(normalizeCrediarioCliente) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar clientes do crediário' });
    }
  });

  app.post('/api/admin/crediario/clientes', adminRequired, async (req, res) => {
    try {
      const body = req.body || {};
      const nome = String(body.nome || body.name || '').trim();
      const telefone = normalizePhone(body.telefone || body.phone || '', '55');
      const cpf = cleanPhone(body.cpf || '');
      const contrato = String(body.contrato || '').trim();
      if (!nome) return res.status(400).json({ ok: false, error: 'Informe o nome do cliente' });
      if (!telefone) return res.status(400).json({ ok: false, error: 'Informe o WhatsApp do cliente' });

      const query = contrato ? { contrato } : (cpf ? { cpf } : { telefone });
      const doc = await CrediarioCliente.findOneAndUpdate(
        query,
        {
          $set: {
            nome,
            telefone,
            cpf,
            contrato,
            endereco: String(body.endereco || '').trim(),
            observacao: String(body.observacao || '').trim(),
            ativo: body.ativo !== false
          }
        },
        { upsert: true, new: true }
      );
      return res.json({ ok: true, cliente: normalizeCrediarioCliente(doc) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao salvar cliente do crediário' });
    }
  });


  // Importa clientes exportados do SIGE em Excel, lidos pelo painel no navegador.
  app.post('/api/admin/crediario/importar-sige/clientes', adminRequired, async (req, res) => {
    try {
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
      const limit = Math.min(rows.length, 5000);
      let criados = 0;
      let atualizados = 0;
      let ignorados = 0;

      for (const row of rows.slice(0, limit)) {
        const nome = normalizeSigeName(
          getSigeValue(row, ['NomeFantasia', 'Nome Fantasia', 'RazaoSocial', 'Razão Social', 'Nome', 'Cliente'])
        );
        const cpf = cleanPhone(getSigeValue(row, ['CNPJ_CPF', 'CNPJ/CPF', 'CPF', 'CNPJ']));
        const telefone = normalizePhone(
          getSigeValue(row, ['Celular', 'Telefone', 'Fone', 'WhatsApp', 'Whatsapp']),
          '55'
        );
        const cidade = String(getSigeValue(row, ['Cidade', 'Município', 'Municipio']) || '').trim();
        const uf = String(getSigeValue(row, ['UF', 'Estado']) || '').trim();
        const bairro = String(getSigeValue(row, ['Bairro']) || '').trim();
        const logradouro = String(getSigeValue(row, ['Logradouro', 'Endereço', 'Endereco']) || '').trim();
        const cep = String(getSigeValue(row, ['CEP']) || '').trim();

        if (!nome) {
          ignorados++;
          continue;
        }

        const query = cpf ? { cpf } : (telefone ? { telefone } : { nome: new RegExp(`^${escapeRegex(nome)}$`, 'i') });
        const before = await CrediarioCliente.findOne(query).select('_id');
        await CrediarioCliente.findOneAndUpdate(
          query,
          {
            $set: {
              nome,
              cpf,
              telefone,
              endereco: [logradouro, bairro, cidade && uf ? `${cidade}/${uf}` : cidade, cep].filter(Boolean).join(' - '),
              observacao: 'Importado do SIGE - clientes',
              ativo: true,
              origem: 'sige_clientes'
            }
          },
          { upsert: true, new: true }
        );
        if (before) atualizados++; else criados++;
      }

      return res.json({ ok: true, total: rows.length, processados: limit, criados, atualizados, ignorados });
    } catch (error) {
      console.error('[sige clientes import]', error);
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao importar clientes do SIGE' });
    }
  });

  // Importa pagamentos exportados do SIGE em Excel, lidos pelo painel no navegador.
  app.post('/api/admin/crediario/importar-sige/pagamentos', adminRequired, async (req, res) => {
    try {
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
      const limit = Math.min(rows.length, 5000);
      let criados = 0;
      let atualizados = 0;
      let ignorados = 0;
      let semTelefone = 0;

      for (const row of rows.slice(0, limit)) {
        const tipo = String(getSigeValue(row, ['Tipo']) || '').trim();
        const clienteNome = normalizeSigeName(getSigeValue(row, ['Cliente', 'Pessoa', 'Nome']));
        const valorPago = parseSigeMoney(getSigeValue(row, ['Valor', 'Valor Pago', 'Valor Recebido']));
        const codigo = String(getSigeValue(row, ['Código', 'Codigo', 'Cod.']) || '').trim();
        const documento = String(getSigeValue(row, ['Documento', 'Pedido', 'Número Documento', 'Numero Documento']) || '').trim();
        const descricao = String(getSigeValue(row, ['Descrição', 'Descricao', 'Histórico', 'Historico']) || '').trim();
        const formaPagamento = String(getSigeValue(row, ['Forma de Pgto.', 'Forma de Pgto', 'Forma de Pagamento', 'Pagamento']) || 'SIGE').trim();
        const dataPagamento = parseSigeDate(getSigeValue(row, ['Data Pgto.', 'Data Pgto', 'Data Pagamento', 'Data de Pagamento'])) || now();
        const dataVencimento = parseSigeDate(getSigeValue(row, ['Data Venc.', 'Data Venc', 'Data Vencimento', 'Vencimento']));
        const plano = String(getSigeValue(row, ['Plano de Conta', 'Plano Conta']) || '').trim();

        if (!clienteNome || !valorPago || valorPago <= 0) {
          ignorados++;
          continue;
        }

        // Evita importar despesas como recibo de cliente quando o relatório vier misturado.
        if (tipo && !/receita|entrada|receb/i.test(tipo)) {
          ignorados++;
          continue;
        }

        let cliente = await CrediarioCliente.findOne({ nome: new RegExp(`^${escapeRegex(clienteNome)}$`, 'i') });
        if (!cliente) {
          cliente = await CrediarioCliente.create({
            nome: clienteNome,
            telefone: '',
            cpf: '',
            observacao: 'Criado automaticamente pela importação de pagamentos do SIGE',
            origem: 'sige_pagamentos',
            ativo: true
          });
          semTelefone++;
        } else if (!cliente.telefone) {
          semTelefone++;
        }

        const produto = descricao || documento || plano || 'Pagamento registrado no SIGE';
        const hash = buildSigeImportHash([codigo, clienteNome, documento, valorPago, dataPagamento.toISOString().slice(0, 10)]);
        const existing = await CrediarioRecibo.findOne({ $or: [{ importHash: hash }, ...(codigo ? [{ sigeCodigo: codigo }] : [])] });

        if (existing) {
          existing.clienteId = cliente._id;
          existing.clienteNome = cliente.nome || clienteNome;
          existing.telefone = cliente.telefone || existing.telefone || '';
          existing.produto = produto;
          existing.valorPago = valorPago;
          existing.formaPagamento = formaPagamento;
          existing.dataPagamento = dataPagamento;
          existing.documento = documento;
          existing.sigeDescricao = descricao;
          existing.sigeDataVencimento = dataVencimento;
          existing.origem = 'sige_pagamentos';
          existing.observacao = 'Importado/atualizado pelo relatório de pagamentos do SIGE';
          await existing.save();
          atualizados++;
          continue;
        }

        let reciboNumber = makeReciboNumber();
        while (await CrediarioRecibo.exists({ recibo: reciboNumber })) reciboNumber = makeReciboNumber();

        await CrediarioRecibo.create({
          recibo: reciboNumber,
          clienteId: cliente._id,
          clienteNome: cliente.nome || clienteNome,
          clienteCpf: cliente.cpf || '',
          telefone: cliente.telefone || '',
          contrato: cliente.contrato || '',
          produto,
          parcela: documento,
          valorPago,
          formaPagamento,
          dataPagamento,
          observacao: 'Importado pelo relatório de pagamentos do SIGE',
          criadoPor: req.admin?.email || req.auth?.email || 'admin',
          status: 'importado',
          origem: 'sige_pagamentos',
          sigeCodigo: codigo,
          documento,
          sigeDescricao: descricao,
          sigeDataVencimento: dataVencimento,
          importHash: hash
        });
        criados++;
      }

      return res.json({ ok: true, total: rows.length, processados: limit, criados, atualizados, ignorados, semTelefone });
    } catch (error) {
      console.error('[sige pagamentos import]', error);
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao importar pagamentos do SIGE' });
    }
  });

  app.get('/api/admin/crediario/recibos', adminRequired, async (req, res) => {
    try {
      const q = String(req.query.q || '').trim();
      const clienteId = String(req.query.clienteId || '').trim();
      const limit = Math.max(1, Math.min(Number(req.query.limit || 80), 300));
      const filter = {};
      if (clienteId && mongoose.Types.ObjectId.isValid(clienteId)) filter.clienteId = new mongoose.Types.ObjectId(clienteId);
      if (q) {
        const digits = cleanPhone(q);
        filter.$or = [
          { recibo: new RegExp(escapeRegex(q), 'i') },
          { clienteNome: new RegExp(escapeRegex(q), 'i') },
          { contrato: new RegExp(escapeRegex(q), 'i') },
          { produto: new RegExp(escapeRegex(q), 'i') }
        ];
        if (digits) {
          filter.$or.push({ clienteCpf: new RegExp(escapeRegex(digits), 'i') });
          filter.$or.push({ telefone: new RegExp(escapeRegex(digits), 'i') });
        }
      }
      const rows = await CrediarioRecibo.find(filter).sort({ dataPagamento: -1, createdAt: -1 }).limit(limit);
      return res.json({ ok: true, recibos: rows.map(normalizeCrediarioRecibo) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar recibos' });
    }
  });

  app.post('/api/admin/crediario/recibos', adminRequired, async (req, res) => {
    try {
      const body = req.body || {};
      const clienteId = String(body.clienteId || '').trim();
      const nome = String(body.clienteNome || body.nome || '').trim();
      const telefone = normalizePhone(body.telefone || body.phone || '', '55');
      const cpf = cleanPhone(body.cpf || body.clienteCpf || '');
      const contrato = String(body.contrato || '').trim();
      const produto = String(body.produto || 'Compra na loja').trim();
      const valorPago = Number(String(body.valorPago || body.valor || '0').replace(/\./g, '').replace(',', '.'));
      const parcela = String(body.parcela || '').trim();
      const formaPagamento = String(body.formaPagamento || 'Pix').trim();
      const dataPagamento = body.dataPagamento ? new Date(body.dataPagamento) : now();
      const observacao = String(body.observacao || '').trim();
      const enviarWhatsapp = body.enviarWhatsapp !== false;

      if (!nome) return res.status(400).json({ ok: false, error: 'Informe o cliente' });
      if (!telefone) return res.status(400).json({ ok: false, error: 'Informe o WhatsApp do cliente' });
      if (!Number.isFinite(valorPago) || valorPago <= 0) return res.status(400).json({ ok: false, error: 'Informe um valor pago válido' });

      let cliente = null;
      if (clienteId && mongoose.Types.ObjectId.isValid(clienteId)) cliente = await CrediarioCliente.findById(clienteId);

      // Sempre mantém o cadastro permanente do cliente atualizado com os dados digitados no recibo.
      // Assim, ao gerar outro recibo para o mesmo cliente, celular/CPF/contrato já voltam preenchidos.
      if (cliente) {
        cliente.nome = nome || cliente.nome || '';
        if (telefone) cliente.telefone = telefone;
        if (cpf) cliente.cpf = cpf;
        if (contrato) cliente.contrato = contrato;
        cliente.ativo = true;
        await cliente.save();
      } else {
        const query = contrato ? { contrato } : (cpf ? { cpf } : { telefone });
        cliente = await CrediarioCliente.findOneAndUpdate(
          query,
          { $set: { nome, telefone, cpf, contrato, ativo: true } },
          { upsert: true, new: true }
        );
      }

      let reciboNumber = makeReciboNumber();
      while (await CrediarioRecibo.exists({ recibo: reciboNumber })) reciboNumber = makeReciboNumber();

      const recibo = await CrediarioRecibo.create({
        recibo: reciboNumber,
        clienteId: cliente?._id || null,
        clienteNome: nome || cliente?.nome || '',
        clienteCpf: cpf || cliente?.cpf || '',
        telefone,
        contrato: contrato || cliente?.contrato || '',
        produto,
        parcela: formatCrediarioParcela(parcela),
        valorPago,
        formaPagamento,
        dataPagamento: Number.isNaN(dataPagamento.getTime()) ? now() : dataPagamento,
        observacao,
        criadoPor: req.admin?.email || req.auth?.email || 'admin'
      });

      let whatsapp = { skipped: true, reason: 'envio_desativado' };
      if (enviarWhatsapp) {
        try {
          whatsapp = await sendCrediarioReceiptWhatsapp(recibo);
          recibo.enviadoWhatsapp = true;
          recibo.enviadoWhatsappEm = now();
          recibo.whatsappResultado = redact(whatsapp || null);
          await recibo.save();
        } catch (error) {
          whatsapp = { ok: false, error: error.message || String(error) };
          recibo.whatsappResultado = whatsapp;
          await recibo.save();
        }
      }

      await createAdminNotification({
        type: 'crediario_recibo',
        title: '🧾 Recibo de parcela registrado',
        message: `${recibo.recibo} - ${recibo.clienteNome} - ${formatMoneyBRL(recibo.valorPago)}`,
        relatedId: String(recibo._id),
        severity: whatsapp?.ok === false ? 'warning' : 'info',
        metadata: { recibo: recibo.recibo, clienteNome: recibo.clienteNome, valorPago: recibo.valorPago, whatsapp }
      });

      return res.json({ ok: true, recibo: normalizeCrediarioRecibo(recibo), whatsapp });
    } catch (error) {
      console.error('[crediario recibo]', error);
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao registrar recibo' });
    }
  });


  app.post('/api/admin/crediario/clientes/:id/cobranca', adminRequired, async (req, res) => {
    try {
      const cliente = await CrediarioCliente.findById(req.params.id);
      if (!cliente) return res.status(404).json({ ok: false, error: 'Cliente não encontrado' });

      const body = req.body || {};
      const telefone = normalizePhone(body.telefone || cliente.telefone || '', '55');
      if (!telefone) return res.status(400).json({ ok: false, error: 'Cliente sem WhatsApp cadastrado' });

      const whatsapp = await sendCrediarioCobrancaWhatsapp({
        telefone,
        clienteNome: cliente.nome,
        produto: body.produto || 'Pendência financeira',
        parcela: body.parcela || '',
        valor: body.valor || body.valorAtualizado || 0,
        valorOriginal: body.valorOriginal || body.valor || 0,
        multa: body.multa || 0,
        juros: body.juros || 0,
        valorAtualizado: body.valorAtualizado || body.valor || 0,
        documento: body.documento || cliente.contrato || '',
        contrato: cliente.contrato || '',
        tipo: body.tipo || body.tipoCobranca || 'normal'
      });

      if (telefone && telefone !== cliente.telefone) {
        cliente.telefone = telefone;
        await cliente.save();
      }

      await createAdminNotification({
        type: 'crediario_cobranca',
        title: '🔔 Cobrança enviada',
        message: `${cliente.nome} - aviso de pendência financeira enviado`,
        relatedId: String(cliente._id),
        severity: 'warning',
        metadata: { clienteId: String(cliente._id), telefone, whatsapp }
      });

      return res.json({ ok: true, cliente: normalizeCrediarioCliente(cliente), whatsapp });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao enviar cobrança' });
    }
  });

  app.post('/api/admin/crediario/recibos/:id/cobranca', adminRequired, async (req, res) => {
    try {
      const recibo = await CrediarioRecibo.findById(req.params.id);
      if (!recibo) return res.status(404).json({ ok: false, error: 'Recibo não encontrado' });

      const r = normalizeCrediarioRecibo(recibo);
      const telefoneEnvio = normalizePhone(req.body?.telefone || r.telefone || '', '55');
      if (!telefoneEnvio) return res.status(400).json({ ok: false, error: 'Cliente sem WhatsApp cadastrado' });

      if (telefoneEnvio && telefoneEnvio !== recibo.telefone) {
        recibo.telefone = telefoneEnvio;
        await recibo.save();
      }

      if (recibo.clienteId) {
        const cliente = await CrediarioCliente.findById(recibo.clienteId);
        if (cliente && telefoneEnvio && telefoneEnvio !== cliente.telefone) {
          cliente.telefone = telefoneEnvio;
          await cliente.save();
        }
      }

      const whatsapp = await sendCrediarioCobrancaWhatsapp({
        telefone: telefoneEnvio,
        clienteNome: r.clienteNome,
        produto: req.body?.produto || r.produto,
        parcela: req.body?.parcela || r.parcela,
        valor: req.body?.valor || req.body?.valorAtualizado || r.valorPago,
        valorOriginal: req.body?.valorOriginal || req.body?.valor || r.valorPago,
        multa: req.body?.multa || 0,
        juros: req.body?.juros || 0,
        valorAtualizado: req.body?.valorAtualizado || req.body?.valor || r.valorPago,
        documento: r.documento || r.recibo,
        recibo: r.recibo,
        contrato: r.contrato,
        tipo: req.body?.tipo || req.body?.tipoCobranca || 'normal'
      });

      await createAdminNotification({
        type: 'crediario_cobranca',
        title: '🔔 Cobrança enviada',
        message: `${r.clienteNome} - ${r.recibo}`,
        relatedId: String(recibo._id),
        severity: 'warning',
        metadata: { recibo: r.recibo, clienteNome: r.clienteNome, telefone: r.telefone, whatsapp }
      });

      return res.json({ ok: true, recibo: r, whatsapp });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao enviar cobrança' });
    }
  });

  app.post('/api/admin/crediario/recibos/:id/enviar-whatsapp', adminRequired, async (req, res) => {
    let recibo = null;
    try {
      recibo = await CrediarioRecibo.findById(req.params.id);
      if (!recibo) return res.status(404).json({ ok: false, error: 'Recibo não encontrado' });

      const telefoneEnvio = normalizePhone(req.body?.telefone || recibo.telefone || '', '55');
      if (!telefoneEnvio) return res.status(400).json({ ok: false, error: 'Cliente sem WhatsApp cadastrado' });
      if (telefoneEnvio !== recibo.telefone) recibo.telefone = telefoneEnvio;

      const whatsapp = await sendCrediarioReceiptWhatsapp(recibo);
      if (!whatsapp || whatsapp.ok === false) {
        throw new Error(whatsapp?.error || whatsapp?.message || 'Evolution API não confirmou o envio do recibo.');
      }

      recibo.enviadoWhatsapp = true;
      recibo.enviadoWhatsappEm = now();
      recibo.whatsappResultado = redact(whatsapp || null);
      await recibo.save();

      await createAdminNotification({
        type: 'crediario_recibo_whatsapp',
        title: '📲 Recibo enviado pelo WhatsApp',
        message: `${recibo.recibo} - ${recibo.clienteNome}`,
        relatedId: String(recibo._id),
        severity: 'info',
        metadata: { recibo: recibo.recibo, clienteNome: recibo.clienteNome, telefone: telefoneEnvio, whatsapp }
      }).catch(() => null);

      return res.json({ ok: true, recibo: normalizeCrediarioRecibo(recibo), whatsapp });
    } catch (error) {
      if (recibo) {
        recibo.enviadoWhatsapp = false;
        recibo.whatsappResultado = redact({ ok: false, error: error.message || String(error), response: error.responseData || null });
        await recibo.save().catch(() => null);
      }
      return res.status(error.statusCode || 500).json({
        ok: false,
        error: error.message || 'Erro ao reenviar recibo pelo WhatsApp',
        whatsapp: { ok: false, error: error.message || String(error) }
      });
    }
  });

  app.get('/api/admin/crediario/recibos/:id/html', adminRequired, async (req, res) => {
    try {
      const recibo = await CrediarioRecibo.findById(req.params.id);
      if (!recibo) return res.status(404).send('Recibo não encontrado');
      const r = normalizeCrediarioRecibo(recibo);
      const html = `<!DOCTYPE html><html lang="pt-br"><head><meta charset="UTF-8"><title>${r.recibo}</title><style>body{font-family:Arial,sans-serif;background:#f3f4f6;margin:0;padding:30px;color:#111827}.receipt{max-width:720px;margin:auto;background:#fff;border-radius:18px;padding:32px;border:1px solid #e5e7eb}.brand{font-size:26px;font-weight:900;color:#0047AB}.muted{color:#6b7280}.row{display:flex;justify-content:space-between;border-bottom:1px solid #e5e7eb;padding:12px 0}.total{font-size:24px;font-weight:900;color:#16a34a}.footer{margin-top:28px;color:#6b7280;font-size:13px}@media print{body{background:#fff}.receipt{border:none}}</style></head><body><div class="receipt"><div class="brand">Ariana Móveis</div><p class="muted">Comprovante de pagamento de parcela</p><h2>${r.recibo}</h2><div class="row"><strong>Cliente</strong><span>${r.clienteNome}</span></div><div class="row"><strong>CPF</strong><span>${r.clienteCpf || '—'}</span></div><div class="row"><strong>Telefone</strong><span>${r.telefone}</span></div><div class="row"><strong>Contrato</strong><span>${r.contrato || '—'}</span></div><div class="row"><strong>Produto</strong><span>${r.produto}</span></div><div class="row"><strong>Parcela</strong><span>${formatCrediarioParcela(r.parcela) || '—'}</span></div><div class="row"><strong>Forma</strong><span>${r.formaPagamento}</span></div><div class="row"><strong>Data</strong><span>${formatDateBR(r.dataPagamento)}</span></div><div class="row"><strong>Valor pago</strong><span class="total">${formatMoneyBRL(r.valorPago)}</span></div>${r.observacao ? `<p><strong>Observação:</strong><br>${String(r.observacao).replace(/[<>&]/g, '')}</p>` : ''}<div class="footer">Pagamento registrado no sistema da Ariana Móveis. Este comprovante confirma o recebimento da parcela informada.</div></div><script>window.print()</script></body></html>`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    } catch (error) {
      return res.status(500).send(error.message || 'Erro ao gerar comprovante');
    }
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true, status: 'online', service: 'ariana-backend', time: new Date().toISOString() }));

  app.get('/api/settings/payments', async (_req, res) => {
    try {
      const settings = await getPaymentsSettings();
      return res.json({
        ok: true,
        mercadopago: {
          enabled: !!settings?.mercadopago?.enabled,
          publicKey: settings?.mercadopago?.publicKey || '',
          splitEnabled: settings?.mercadopago?.splitEnabled !== false
        },
        pagarme: {
          enabled: !!settings?.pagarme?.enabled
        }
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar configurações de pagamento' });
    }
  });


  // ============================================================
  // ROTAS PARA BOTS DO WHATSAPP - FINANCEIRO E SAC
  // Usadas pelas automações Ariana_Financeiro e Ariana_SAC.
  // Segurança: se BOT_API_TOKEN estiver configurado no Render,
  // o bot deve enviar o mesmo valor no header x-bot-token.
  // ============================================================
  const BOT_API_TOKEN = String(
    process.env.BOT_API_TOKEN ||
    process.env.FINANCEIRO_BOT_SECRET ||
    process.env.SAC_BOT_SECRET ||
    ''
  ).trim();

  function botAccessRequired(req, res, next) {
    const incomingToken = String(
      req.headers['x-bot-token'] ||
      req.headers['x-api-key'] ||
      req.query.token ||
      ''
    ).trim();

    if (BOT_API_TOKEN && incomingToken !== BOT_API_TOKEN) {
      return res.status(401).json({ ok: false, error: 'Token do bot inválido' });
    }

    return next();
  }

  function onlyDigits(value = '') {
    return String(value || '').replace(/\D/g, '');
  }

  // Normaliza CEP para chamadas de logística/Correios.
  // Mantém somente números e limita em 8 dígitos para evitar erro no teste de etiquetas.
  function cleanCep(value = '') {
    return String(value || '').replace(/\D/g, '').slice(0, 8);
  }

  function isLikelyCpf(value = '') {
    return onlyDigits(value).length === 11;
  }

  function isLikelyPhone(value = '') {
    const digits = onlyDigits(value);
    return digits.length >= 10 && digits.length <= 13;
  }

  function shortOrderId(order = {}) {
    return String(order?._id || order?.id || '').slice(-8).toUpperCase();
  }

  function normalizeBotOrder(orderDoc = {}, channel = 'financeiro') {
    const order = toJSON(orderDoc) || orderDoc || {};
    const address = order.shippingAddress || {};
    const payment = order.payment || {};
    const items = ensureArray(order.items).map((item) => ({
      name: String(item?.name || item?.nome || item?.sku || 'Produto').trim(),
      qty: Number(item?.qty || item?.quantity || 1) || 1,
      total: Number(item?.totalPrice || item?.total || 0) || 0
    })).slice(0, 8);

    return {
      id: String(order._id || order.id || ''),
      shortId: shortOrderId(order),
      createdAt: order.createdAt || null,
      updatedAt: order.updatedAt || null,
      status: order.status || '',
      statusLabel: order.statusLabel || order.status || '',
      total: Number(order.total || 0),
      subtotal: Number(order.subtotal || 0),
      shippingCost: Number(order.shippingCost || 0),
      payment: {
        method: payment.method || payment.type || payment.provider || payment.payment_method || '',
        status: payment.status || payment.status_detail || payment.payment_status || '',
        externalId: payment.id || payment.externalId || payment.paymentId || '',
        pixCode: payment.pixCode || payment.pix_code || payment.qr_code || payment.qrCode || payment.copyPaste || payment.copiaCola || order.pixCode || order.pix_code || order.qr_code || order.qrCode || '',
        pixQrCodeBase64: payment.qr_code_base64 || payment.qrCodeBase64 || order.qr_code_base64 || order.qrCodeBase64 || ''
      },
      customer: {
        name: order.customerName || address.name || '',
        email: order.customerEmail || '',
        phone: order.customerPhone || address.phone || ''
      },
      shipping: {
        city: address.cidade || address.city || '',
        uf: address.uf || address.state || '',
        cep: address.cep || address.zipCode || '',
        trackingCode: order.trackingCode || '',
        deadline: order.shipping?.prazo || order.shipping?.deliveryTime || order.shipping?.prazoEntrega || ''
      },
      items,
      channel
    };
  }

  async function findOrdersForBot({ identifier = '', cpf = '', phone = '', orderId = '', limit = 5 } = {}) {
    const raw = String(identifier || cpf || phone || orderId || '').trim();
    const queries = [];
    const userIds = [];

    const cpfDigits = onlyDigits(cpf || (isLikelyCpf(raw) ? raw : ''));
    const rawPhoneDigits = onlyDigits(phone || (isLikelyPhone(raw) ? raw : ''));
    const phoneDigits = rawPhoneDigits ? normalizePhone(rawPhoneDigits, '55') : '';
    const requestedOrderId = String(orderId || raw || '').trim();

    function addUserId(id) {
      if (!id) return;
      const value = String(id);
      if (!userIds.some((existing) => String(existing) === value)) userIds.push(id);
    }

    function addQuery(q) {
      if (q && Object.keys(q).length) queries.push(q);
    }

    function phoneRegexFromDigits(value = '', anchored = false) {
      const digitsOnly = onlyDigits(value);
      if (!digitsOnly) return null;
      const pattern = digitsOnly.split('').map((d) => escapeRegex(d)).join('\\D*');
      return new RegExp(anchored ? `${pattern}$` : pattern, 'i');
    }

    function buildPhoneSearch(phoneValue = '') {
      const full = normalizePhone(phoneValue, '55');
      const local = full.startsWith('55') && full.length > 11 ? full.slice(2) : full;
      const candidates = new Set();

      [full, local, phoneValue, onlyDigits(phoneValue)].forEach((value) => {
        const clean = onlyDigits(value);
        if (clean) candidates.add(clean);
      });

      // Também tenta versões finais do número, pois alguns pedidos são salvos sem DDI ou com máscara.
      [8, 9, 10, 11].forEach((size) => {
        if (full.length >= size) candidates.add(full.slice(-size));
        if (local.length >= size) candidates.add(local.slice(-size));
      });

      const regexes = Array.from(candidates)
        .filter((value) => value.length >= 8)
        .map((value) => phoneRegexFromDigits(value, value.length >= 10))
        .filter(Boolean);

      return {
        full,
        local,
        candidates: Array.from(candidates).filter(Boolean),
        regexes
      };
    }

    if (cpfDigits) {
      const users = await User.find({
        $or: [
          { cpf: cpfDigits },
          { document: cpfDigits },
          { 'customer.cpf': cpfDigits }
        ]
      }).select('_id name email cpf phone').limit(20);

      users.forEach((u) => addUserId(u._id));

      addQuery({ customerCpf: cpfDigits });
      addQuery({ cpf: cpfDigits });
      addQuery({ 'customer.cpf': cpfDigits });
      addQuery({ 'shippingAddress.cpf': cpfDigits });
      addQuery({ 'payment.payer.identification.number': cpfDigits });
      addQuery({ 'payment.payer.cpf': cpfDigits });
    }

    if (phoneDigits) {
      const phoneSearch = buildPhoneSearch(phoneDigits);
      const phoneFields = [
        'customerPhone',
        'phone',
        'whatsapp',
        'telefone',
        'customer.phone',
        'customer.whatsapp',
        'shippingAddress.phone',
        'shippingAddress.telefone',
        'shippingAddress.whatsapp',
        'billingAddress.phone',
        'billingAddress.telefone',
        'payment.payer.phone',
        'payment.payer.phone.number',
        'payment.phone',
        'payment.customer.phone'
      ];

      for (const field of phoneFields) {
        for (const candidate of phoneSearch.candidates) {
          addQuery({ [field]: candidate });
        }
        for (const regex of phoneSearch.regexes) {
          addQuery({ [field]: regex });
        }
      }

      // Se o telefone estiver no cadastro do usuário ou endereço salvo, localiza os pedidos por userId.
      const userPhoneOr = [];
      for (const candidate of phoneSearch.candidates) userPhoneOr.push({ phone: candidate });
      for (const regex of phoneSearch.regexes) userPhoneOr.push({ phone: regex });

      if (userPhoneOr.length) {
        const usersByPhone = await User.find({ $or: userPhoneOr }).select('_id phone').limit(20);
        usersByPhone.forEach((u) => addUserId(u._id));

        const addressesByPhone = await Address.find({ $or: userPhoneOr }).select('userId phone').limit(50);
        addressesByPhone.forEach((a) => addUserId(a.userId));
      }
    }

    if (requestedOrderId && mongoose.Types.ObjectId.isValid(requestedOrderId)) {
      addQuery({ _id: new mongoose.Types.ObjectId(requestedOrderId) });
    }

    if (requestedOrderId && requestedOrderId.length >= 6) {
      addQuery({ orderId: requestedOrderId });
      addQuery({ externalId: requestedOrderId });
      addQuery({ 'payment.orderId': requestedOrderId });
      addQuery({ 'payment.external_reference': requestedOrderId });
    }

    if (userIds.length) addQuery({ userId: { $in: userIds } });

    if (!queries.length) return [];

    return Order.find({ $or: queries })
      .sort({ createdAt: -1 })
      .limit(Math.max(1, Math.min(Number(limit || 5), 10)));
  }

  async function botConsultaHandler(req, res, channel = 'financeiro') {
    try {
      const identifier = String(req.query.identifier || req.query.q || req.body?.identifier || req.body?.q || '').trim();
      const cpf = String(req.query.cpf || req.body?.cpf || '').trim();
      const phone = String(req.query.phone || req.query.telefone || req.body?.phone || req.body?.telefone || '').trim();
      const orderId = String(req.query.orderId || req.query.pedido || req.body?.orderId || req.body?.pedido || '').trim();
      const limit = Number(req.query.limit || req.body?.limit || 5);

      if (!identifier && !cpf && !phone && !orderId) {
        return res.status(400).json({ ok: false, error: 'Informe CPF, telefone, número do pedido ou identifier' });
      }

      const orders = await findOrdersForBot({ identifier, cpf, phone, orderId, limit });
      const normalizedOrders = orders.map((order) => normalizeBotOrder(order, channel));

      return res.json({
        ok: true,
        channel,
        found: normalizedOrders.length,
        orders: normalizedOrders,
        message: normalizedOrders.length
          ? 'Consulta realizada com sucesso.'
          : 'Nenhum pedido encontrado para os dados informados.'
      });
    } catch (error) {
      console.error(`[bot:${channel}] erro na consulta:`, error);
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao consultar pedidos' });
    }
  }

  app.get('/api/bot/financeiro/consulta', botAccessRequired, (req, res) => botConsultaHandler(req, res, 'financeiro'));
  app.post('/api/bot/financeiro/consulta', botAccessRequired, (req, res) => botConsultaHandler(req, res, 'financeiro'));

  app.get('/api/bot/sac/consulta', botAccessRequired, (req, res) => botConsultaHandler(req, res, 'sac'));
  app.post('/api/bot/sac/consulta', botAccessRequired, (req, res) => botConsultaHandler(req, res, 'sac'));


  // Inicia uma única instância do agendador financeiro por processo Node.
  iniciarAutomacaoFinanceiraDiaria();
  iniciarReguaWhatsappFinanceira();


}
