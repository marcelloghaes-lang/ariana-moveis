import registerEnterpriseCatalogSyncRoutes from './enterprise/catalogSyncRoutes.js';
import registerEnterpriseCatalogRoutes from './enterprise/catalogRoutes.js';
import registerEnterpriseProductRoutes from './enterprise/enterpriseProductRoutes.js';
import registerEnterpriseSigeRoutes from './enterprise/enterpriseSigeRoutes.js';
import registerEnterpriseHistoryRoutes from './enterprise/enterpriseHistoryRoutes.js';
import registerEnterpriseOrderRoutes from './enterprise/enterpriseOrderRoutes.js';
import registerEnterprisePartnerRequestRoutes from './enterprise/partnerRequestRoutes.js';
import registerEnterpriseBillingRoutes from './enterprise/billingRoutes.js';
import registerEnterpriseInvoiceRoutes from './enterprise/invoiceRoutes.js';
import registerEnterpriseTrackingRoutes from './enterprise/trackingRoutes.js';
import registerEnterpriseOccurrenceRoutes from './enterprise/occurrenceRoutes.js';
import registerEnterpriseRmaRoutes from './enterprise/rmaRoutes.js';
import registerEnterpriseWebhookRoutes from './enterprise/webhookRoutes.js';
import registerEnterprisePartnerAuthRoutes from './enterprise/partnerAuthRoutes.js';
import registerEnterprisePartnerLogsRoutes from './enterprise/partnerLogsRoutes.js';
import registerEnterprisePartnerCredentialsRoutes from './enterprise/partnerCredentialsRoutes.js';
import registerEnterpriseAdminPartnerRoutes from './enterprise/adminPartnerRoutes.js';
import registerEnterpriseAdminProRoutes from './enterprise/adminEnterpriseProRoutes.js';
import registerEnterpriseAdminAnalyticsRoutes from './enterprise/adminAnalyticsRoutes.js';
import registerEnterpriseDeveloperRoutes from './enterprise/developerRoutes.js';
import registerEnterpriseCertificationRoutes from './enterprise/certificationRoutes.js';
import registerEnterprisePartnerDashboardRoutes from './enterprise/partnerDashboardRoutes.js';
import registerEnterpriseProductionRoutes from './enterprise/productionRoutes.js';
import registerEnterpriseSandboxRoutes from './enterprise/sandboxRoutes.js';
import registerEnterpriseDxRoutes from './enterprise/dxRoutes.js';
import registerEnterpriseSwaggerRoutes from './enterprise/swaggerRoutes.js';
import registerEnterpriseMonitorRoutes from './enterprise/monitorRoutes.js';
import registerEnterpriseVersionRoutes, { enterpriseVersionHeaders } from './enterprise/versionRoutes.js';
import { createEnterpriseHelpers } from './enterprise/shared/helpers.js';
import { createEnterpriseAuth } from './enterprise/shared/auth.js';
import { createEnterpriseRateLimit } from './enterprise/shared/rateLimit.js';
import { createEnterprisePartner } from './enterprise/shared/partner.js';
import { createEnterpriseBilling } from './enterprise/shared/billing.js';
import { createEnterpriseOrder } from './enterprise/shared/order.js';

// ============================================================
// ROTAS ENTERPRISE - ARIANA MÃ“VEIS
// ExtraÃ­do de legacyRoutes.js na Etapa 14.
// Objetivo: isolar homologaÃ§Ã£o, parceiros, OpenAPI, SDKs e APIs Enterprise
// sem alterar endpoints, regras ou respostas.
// ============================================================

export default function registerEnterpriseRoutes(app, context = {}) {
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

  const {
    BUILD_ID,
    writeAuditLog,
    upsertOperationalAlert,
    resolveOperationalAlert,
    scanOperationalAlerts,
    waMaybeNotifyOrderStatusChange,
    waNotifyAdminNewOrder,
    waNotifyAdminOrderStatusChange,
    waNotifyOrderChatMessage,
    waSendTextMessage,
    formatMoneyBRL,
    roundMoney,
    sellerBaseToMarketplacePrice,
    marketplacePriceToSellerBase,
    getSellerSettlementForOrder,
    buildProductBasePriceMapForOrders,
    quoteCorreios
  } = context;
  const {
    createEnterpriseRequestId,
    createEnterprisePartnerId,
    enterpriseRandomKey,
    enterpriseCreateApiKey,
    enterpriseCreateOAuthId,
    enterpriseCreateWebhookSecret,
    enterpriseCompatNumber,
    enterpriseCompatProductPayload,
    enterpriseNormalizeOrderForResponse,
    enterpriseStatusLabel,
    enterprisePartnerLogDTO,
    enterpriseLogsCsv
  } = createEnterpriseHelpers({
    crypto,
    uid,
    sanitizeIdPart,
    toJSON
  });

// ============================================================
// CORREÃ‡ÃƒO ENTERPRISE - API KEY SANDBOX DINÃ‚MICA
// MantÃ©m o mÃ³dulo antigo, mas garante que o API Explorer consiga
// autenticar e executar o fluxo completo usando as chaves geradas
// na homologaÃ§Ã£o do painel.
// ============================================================
const enterpriseHomologationRequestCompatSchema = new mongoose.Schema({
  requestId: { type: String, index: true },
  companyName: String,
  tradeName: String,
  cnpj: String,
  email: String,
  status: { type: String, index: true },
  statusLabel: String,
  environment: String,
  integrationTypes: [String],
  sandboxCredentials: mongoose.Schema.Types.Mixed,
  productionCredentials: mongoose.Schema.Types.Mixed,
  sandbox: mongoose.Schema.Types.Mixed,
  production: mongoose.Schema.Types.Mixed,
  credentials: mongoose.Schema.Types.Mixed,
  metadata: mongoose.Schema.Types.Mixed
}, { timestamps: true, versionKey: false, strict: false });

const EnterpriseHomologationRequestCompat =
  mongoose.models.EnterpriseHomologationRequest ||
  mongoose.model('EnterpriseHomologationRequest', enterpriseHomologationRequestCompatSchema);


// ============================================================
// ENTERPRISE PARTNER REQUEST ROUTES
// ExtraÃ­do para routes/enterprise/partnerRequestRoutes.js sem alterar endpoints.
// ============================================================
registerEnterprisePartnerRequestRoutes(app, {
  ...context,
  adminRequired,
  crypto,
  EnterpriseHomologationRequestCompat,
  normalizePhone,
  normalizeObjectId,
  escapeRegex,
  createAdminNotification,
  IntegrationAuditLog,
  redact,
  toJSON
});


// ============================================================
// ENTERPRISE RATE LIMIT SHARED
// ExtraÃ­do para routes/enterprise/shared/rateLimit.js sem alterar regras ou respostas.
// ============================================================
const {
  EnterpriseRateLimitBucket,
  enterpriseCompatKeyHash,
  enterpriseCompatMinuteStart,
  enterpriseCompatDayStart,
  enterpriseCompatRateLimitConfig,
  enterpriseCompatIncrementBucket,
  enterpriseCompatApplyRateLimit
} = createEnterpriseRateLimit({
  mongoose,
  crypto,
  IntegrationAuditLog,
  redact
});

const {
  getEnterpriseCompatKey,
  enterpriseCompatKeyQuery,
  enterpriseCompatEnvFromPartner,
  enterpriseCompatAuth
} = createEnterpriseAuth({
  EnterpriseHomologationRequestCompat,
  enterpriseCompatApplyRateLimit
});


// ============================================================
// ENTERPRISE ORDER SHARED
// ExtraÃ­do para routes/enterprise/shared/order.js sem alterar regras ou respostas.
// ============================================================
const {
  enterpriseCompatFindOrder,
  enterpriseOrderOperationAuth,
  enterprisePartnerProductScope,
  enterpriseRequirePermission,
  enterpriseProductSkuFromBody,
  enterpriseFindProductBySkuForPartner,
  enterpriseProductResponse
} = createEnterpriseOrder({
  getEnterpriseCompatKey,
  enterpriseCompatAuth,
  jwt,
  JWT_SECRET,
  normalizeObjectId,
  Order,
  Product,
  normalizeProductForResponse
});

// ExtraÃ­do para routes/enterprise/shared/order.js sem alterar regras ou respostas: enterpriseCompatFindOrder

// ============================================================
// ENTERPRISE INVOICE ROUTES
// ExtraÃ­do para routes/enterprise/invoiceRoutes.js sem alterar endpoints.
// ============================================================
registerEnterpriseInvoiceRoutes(app, {
  ...context,
  enterpriseCompatAuth,
  enterpriseOrderOperationAuth,
  enterpriseCompatFindOrder,
  enterpriseBillingUpsert,
  enterpriseBillingNormalizeResponse,
  enterpriseNormalizeOrderForResponse,
  EnterpriseBillingRecord,
  ensureArray
});

app.get('/api/enterprise/auth/check', enterpriseCompatAuth, async (req, res) => {
  return res.json({
    ok: true,
    valid: true,
    environment: req.enterprisePartner?.environment || 'sandbox',
    partner: {
      requestId: req.enterprisePartner?.requestId || '',
      companyName: req.enterprisePartner?.companyName || '',
      tradeName: req.enterprisePartner?.tradeName || '',
      status: req.enterprisePartner?.status || '',
      permissions: req.enterprisePartner?.permissions || []
    }
  });
});


// ============================================================
// ENTERPRISE CATALOG SYNC ROUTES
// ExtraÃ­do para routes/enterprise/catalogSyncRoutes.js sem alterar endpoints.
// ============================================================
registerEnterpriseCatalogSyncRoutes(app, {
  ...context,
  enterpriseCompatAuth,
  adminRequired,
  mongoose,
  baseOptions,
  now,
  enterpriseCompatNumber,
  enterpriseCompatProductPayload,
  Product,
  IntegrationAuditLog,
  redact,
  escapeRegex,
  toJSON
});

// ============================================================
// ENTERPRISE CATALOG ROUTES
// ExtraÃ­do para routes/enterprise/catalogRoutes.js sem alterar endpoints.
// ============================================================
registerEnterpriseCatalogRoutes(app, {
  ...context,
  enterpriseCompatAuth,
  enterpriseOrderOperationAuth,
  enterpriseCompatProductPayload,
  enterpriseBuildProductManufacturerQuery,
  Product,
  IntegrationAuditLog,
  redact
});


// ============================================================
// ENTERPRISE PRODUCT ROUTES
// ExtraÃ­do para routes/enterprise/enterpriseProductRoutes.js sem alterar endpoints.
// ============================================================
registerEnterpriseProductRoutes(app, {
  ...context,
  enterpriseCompatAuth,
  enterpriseRequirePermission,
  enterpriseProductSkuFromBody,
  enterpriseCompatNumber,
  enterpriseFindProductBySkuForPartner,
  enterpriseProductResponse,
  enterpriseCompatProductPayload,
  normalizeImageEntry,
  IntegrationAuditLog,
  Product,
  redact,
  changedKeys
});

// ============================================================
// ENTERPRISE ORDER ROUTES
// ExtraÃ­do para routes/enterprise/enterpriseOrderRoutes.js sem alterar endpoints.
// ============================================================
registerEnterpriseOrderRoutes(app, {
  ...context,
  enterpriseCompatAuth,
  enterpriseOrderOperationAuth,
  enterpriseCompatFindOrder,
  enterpriseNormalizeOrderForResponse,
  enterpriseStatusLabel,
  enterpriseCompatNumber,
  DEFAULT_CURRENCY,
  Order,
  IntegrationAuditLog,
  redact
});


// ============================================================
// ENTERPRISE BILLING SHARED
// ExtraÃ­do para routes/enterprise/shared/billing.js sem alterar regras ou respostas.
// ============================================================
const {
  enterpriseBillingNormalizePayload,
  enterpriseBillingNormalizeResponse,
  enterpriseBillingUpsert
} = createEnterpriseBilling({
  DEFAULT_CURRENCY,
  EnterpriseBillingRecord,
  IntegrationAuditLog,
  normalizeObjectId,
  redact,
  toJSON
});

// ============================================================
// ENTERPRISE BILLING ROUTES
// ExtraÃ­do para routes/enterprise/billingRoutes.js sem alterar endpoints.
// ============================================================
registerEnterpriseBillingRoutes(app, {
  ...context,
  enterpriseOrderOperationAuth,
  enterpriseCompatFindOrder,
  enterpriseBillingUpsert,
  enterpriseBillingNormalizeResponse,
  enterpriseNormalizeOrderForResponse,
  EnterpriseBillingRecord,
  escapeRegex,
  redact
});


// ============================================================
// ETAPA 4 - ENTERPRISE RMA / DEVOLUÃ‡Ã•ES
// Rotas incrementais adicionadas sem alterar as rotas existentes.
// ============================================================


// ============================================================
// ENTERPRISE RMA ROUTES
// ExtraÃ­do para routes/enterprise/rmaRoutes.js sem alterar endpoints.
// ============================================================
registerEnterpriseRmaRoutes(app, {
  ...context,
  DEFAULT_CURRENCY,
  EnterpriseRmaRecord,
  IntegrationAuditLog,
  crypto,
  mongoose,
  enterpriseOrderOperationAuth,
  enterpriseCompatFindOrder,
  enterpriseNormalizeOrderForResponse,
  escapeRegex,
  redact,
  toJSON
});



// ============================================================
// ENTERPRISE OCCURRENCE ROUTES
// ExtraÃ­do para routes/enterprise/occurrenceRoutes.js sem alterar endpoints.
// ============================================================
registerEnterpriseOccurrenceRoutes(app, {
  ...context,
  crypto,
  mongoose,
  EnterpriseOccurrenceRecord,
  IntegrationAuditLog,
  enterpriseOrderOperationAuth,
  enterpriseCompatFindOrder,
  enterpriseNormalizeOrderForResponse,
  escapeRegex,
  redact,
  toJSON
});


// ============================================================
// ENTERPRISE WEBHOOK ROUTES
// ExtraÃ­do para routes/enterprise/webhookRoutes.js sem alterar endpoints.
// ============================================================
registerEnterpriseWebhookRoutes(app, {
  ...context,
  Setting,
  IntegrationAuditLog,
  axios,
  crypto,
  mongoose,
  enterpriseCompatAuth,
  enterprisePartnerRequired,
  enterprisePartnerLogQuery,
  enterprisePartnerLogStatusCode,
  sanitizeIdPart,
  redact
});


// ============================================================
// ENTERPRISE PARTNER SHARED
// ExtraÃ­do para routes/enterprise/shared/partner.js sem alterar regras ou respostas.
// ============================================================
const {
  enterpriseCompatSafePartner,
  enterpriseCompatFindPartnerByKey,
  enterprisePartnerSign,
  enterpriseOAuthGenerateCredentials,
  enterpriseOAuthQuery,
  enterpriseOAuthPickCredential,
  enterpriseOAuthSignAccessToken,
  enterpriseOAuthRequired,
  enterprisePartnerRequired,
  enterprisePartnerLogQuery
} = createEnterprisePartner({
  EnterpriseHomologationRequestCompat,
  enterpriseCompatEnvFromPartner,
  enterpriseCompatKeyQuery,
  crypto,
  jwt,
  JWT_SECRET,
  sanitizeIdPart
});


// ============================================================
// ENTERPRISE PARTNER AUTH ROUTES
// ExtraÃ­do para routes/enterprise/partnerAuthRoutes.js sem alterar endpoints.
// ============================================================
registerEnterprisePartnerAuthRoutes(app, {
  ...context,
  EnterpriseHomologationRequestCompat,
  IntegrationAuditLog,
  mongoose,
  enterpriseOAuthQuery,
  enterpriseOAuthPickCredential,
  enterpriseOAuthSignAccessToken,
  enterpriseOAuthRequired,
  enterprisePartnerRequired,
  enterpriseCompatFindPartnerByKey,
  enterprisePartnerSign
});

// ============================================================
// ENTERPRISE PARTNER CREDENTIALS ROUTES
// ExtraÃ­do para routes/enterprise/partnerCredentialsRoutes.js sem alterar endpoints.
// ============================================================
registerEnterprisePartnerCredentialsRoutes(app, {
  ...context,
  EnterpriseHomologationRequestCompat,
  IntegrationAuditLog,
  adminRequired,
  enterpriseAdminFindPartner,
  enterprisePartnerGenerateKey,
  enterprisePartnerEnvironmentPath,
  enterprisePartnerFindCurrentDoc,
  enterprisePartnerRequired,
  enterpriseCreateOAuthId,
  enterpriseRandomKey,
  enterpriseCreateWebhookSecret
});


// ============================================================
// ENTERPRISE PARTNER LOGS / CERTIFICATES / DASHBOARD ROUTES
// ExtraÃ­do para routes/enterprise/partnerLogsRoutes.js sem alterar endpoints.
// ============================================================
registerEnterprisePartnerLogsRoutes(app, {
  ...context,
  FRONTEND_URL,
  IntegrationAuditLog,
  mongoose,
  escapeRegex,
  enterprisePartnerRequired,
  enterprisePartnerLogQuery,
  enterprisePartnerLogDTO,
  enterpriseLogsCsv
});


// ============================================================
// PORTAL DO FABRICANTE - GESTÃƒO DE API KEYS / LOGS / WEBHOOKS
// Etapa 17: autoatendimento Enterprise sem acesso ao Admin.
// ============================================================
function enterprisePartnerGenerateKey(environment = 'sandbox', partner = {}) {
  const env = String(environment || 'sandbox').toLowerCase() === 'production' ? 'live' : 'sbx';
  const baseName = sanitizeIdPart(partner.tradeName || partner.companyName || partner.requestId || 'fabricante').slice(0, 60);
  return `ari_${env}_${baseName}_${crypto.randomBytes(8).toString('hex')}`;
}

async function enterprisePartnerFindCurrentDoc(portal = {}) {
  if (portal.partnerId && mongoose.Types.ObjectId.isValid(portal.partnerId)) {
    const doc = await EnterpriseHomologationRequestCompat.findById(portal.partnerId);
    if (doc) return doc;
  }
  const or = [];
  if (portal.requestId) or.push({ requestId: portal.requestId });
  if (portal.companyName) or.push({ companyName: portal.companyName });
  if (portal.tradeName) or.push({ tradeName: portal.tradeName });
  if (!or.length) return null;
  return EnterpriseHomologationRequestCompat.findOne({ $or: or });
}

function enterprisePartnerEnvironmentPath(environment = 'sandbox') {
  return String(environment || '').toLowerCase() === 'production' ? 'productionCredentials' : 'sandboxCredentials';
}



// ============================================================
// BLOCO 4 â€” CREDENCIAIS ENTERPRISE (ADMIN)
// Rotas administrativas adicionadas sem alterar as rotas jÃ¡ validadas
// do Portal do Fabricante (/api/enterprise/partner/...).
// ============================================================
function enterpriseAdminPartnerQuery(id = '') {
  const value = String(id || '').trim();
  const or = [];
  if (mongoose.Types.ObjectId.isValid(value)) or.push({ _id: new mongoose.Types.ObjectId(value) });
  if (value) {
    or.push(
      { requestId: value },
      { partnerRequestId: value },
      { partnerId: value },
      { apiKeySandbox: value },
      { sandboxApiKey: value },
      { apiKeyProduction: value },
      { enterpriseApiKey: value },
      { 'sandboxCredentials.apiKey': value },
      { 'productionCredentials.apiKey': value },
      { 'credentials.sandbox.apiKey': value },
      { 'credentials.production.apiKey': value }
    );
  }
  return or.length ? { $or: or } : { _id: null };
}

async function enterpriseAdminFindPartner(id = '') {
  return EnterpriseHomologationRequestCompat.findOne(enterpriseAdminPartnerQuery(id));
}

// ExtraÃ­do para routes/enterprise/partnerCredentialsRoutes.js sem alterar endpoints: function enterpriseAdminCredentialDTO(partner = {}) {


// ============================================================
// ENTERPRISE ADMIN PARTNER ROUTES
// ExtraÃ­do para routes/enterprise/adminPartnerRoutes.js sem alterar endpoints.
// ============================================================
registerEnterpriseAdminPartnerRoutes(app, {
  ...context,
  EnterpriseHomologationRequestCompat,
  adminRequired,
  escapeRegex,
  enterpriseAdminFindPartner,
  toJSON
});

// ExtraÃ­do para routes/enterprise/partnerCredentialsRoutes.js sem alterar endpoints: app.get('/api/enterprise/partners/:id/credentials', adminRequired, async (req, res) => {


// ExtraÃ­do para routes/enterprise/partnerCredentialsRoutes.js sem alterar endpoints: app.post('/api/enterprise/partners/:id/regenerate-api-key', adminRequired, async (req, res) => {


// ExtraÃ­do para routes/enterprise/partnerCredentialsRoutes.js sem alterar endpoints: app.post('/api/enterprise/partners/:id/regenerate-oauth', adminRequired, async (req, res) => {


// ExtraÃ­do para routes/enterprise/partnerCredentialsRoutes.js sem alterar endpoints: app.post('/api/enterprise/partners/:id/regenerate-webhook', adminRequired, async (req, res) => {


// ExtraÃ­do para routes/enterprise/partnerCredentialsRoutes.js sem alterar endpoints: app.post('/api/enterprise/partner/api-keys/:environment/rotate', enterprisePartnerRequired, async (req, res) => {


// ExtraÃ­do para routes/enterprise/partnerCredentialsRoutes.js sem alterar endpoints: app.post('/api/enterprise/partner/api-keys/:environment/revoke', enterprisePartnerRequired, async (req, res) => {


// ============================================================
// ENTERPRISE PARTNER DASHBOARD / USAGE / METRICS ROUTES
// ExtraÃ­do para routes/enterprise/partnerDashboardRoutes.js sem alterar endpoints.
// ============================================================
registerEnterprisePartnerDashboardRoutes(app, {
  ...context,
  IntegrationAuditLog,
  escapeRegex,
  enterprisePartnerRequired,
  enterprisePartnerLogQuery
});


// ============================================================
// PASSO 21 - Webhooks profissionais do Portal do Fabricante
// ConfiguraÃ§Ã£o de URL, Secret HMAC, teste real e reenvio.
// ============================================================


// ============================================================
// ENTERPRISE SWAGGER / OPENAPI ROUTES
// ExtraÃ­do para routes/enterprise/swaggerRoutes.js sem alterar endpoints.
// ============================================================
// ============================================================
// ENTERPRISE ADMIN PRO ROUTES
// ExtraÃ­do para routes/enterprise/adminEnterpriseProRoutes.js sem alterar endpoints.
// ============================================================
registerEnterpriseAdminProRoutes(app, {
  ...context,
  adminRequired,
  EnterpriseHomologationRequestCompat,
  IntegrationAuditLog,
  ManufacturerDispatchQueue,
  mongoose,
  escapeRegex,
  redact,
  enterpriseCompatRateLimitConfig,
  enterprisePartnerGenerateKey,
  enterpriseOAuthGenerateCredentials
});



// ============================================================
// ENTERPRISE VERSION ROUTES
// ExtraÃ­do para routes/enterprise/versionRoutes.js sem alterar endpoints.
// ============================================================
registerEnterpriseVersionRoutes(app, {
  ...context,
  adminRequired
});

// ============================================================
// ENTERPRISE MONITOR ROUTES
// ExtraÃ­do para routes/enterprise/monitorRoutes.js sem alterar endpoints.
// ============================================================
registerEnterpriseMonitorRoutes(app, {
  ...context,
  EnterpriseHomologationRequestCompat,
  IntegrationAuditLog,
  ManufacturerDispatchQueue,
  OperationalAlert,
  enterpriseVersionHeaders
});


// ============================================================
// ENTERPRISE DEVELOPER PORTAL ROUTES
// ExtraÃ­do para routes/enterprise/developerRoutes.js sem alterar endpoints.
// ============================================================
registerEnterpriseDeveloperRoutes(app, {
  ...context,
  enterpriseVersionHeaders
});


// ============================================================
// ENTERPRISE ADMIN ANALYTICS ROUTES
// ExtraÃ­do para routes/enterprise/adminAnalyticsRoutes.js sem alterar endpoints.
// ============================================================
registerEnterpriseAdminAnalyticsRoutes(app, {
  ...context,
  Order,
  Product,
  ManufacturerIntegration,
  IntegrationAuditLog,
  ManufacturerDispatchQueue,
  ensureArray,
  enterpriseVersionHeaders
});

// ============================================================
// ENTERPRISE CERTIFICATION ROUTES
// ExtraÃ­do para routes/enterprise/certificationRoutes.js sem alterar endpoints.
// ============================================================
registerEnterpriseCertificationRoutes(app, {
  ...context,
  FRONTEND_URL,
  IntegrationAuditLog,
  EnterprisePartner: context.EnterprisePartner,
  sanitizeIdPart,
  now
});


// ============================================================
// CORREÃ‡ÃƒO ETAPA 2 â€” ROTAS REAIS DE HISTORY E SUMMARY
// Adiciona somente as rotas faltantes, sem alterar rotas jÃ¡ homologadas.
// ============================================================
function enterpriseBuildProductManufacturerQuery(manufacturer = '') {
  const value = String(manufacturer || '').trim();
  if (!value) return {};
  const escaped = escapeRegex(value);
  return {
    $or: [
      { sellerId: value },
      { sellerId: new RegExp(`^${escaped}$`, 'i') },
      { brand: new RegExp(`^${escaped}$`, 'i') },
      { sellerName: new RegExp(escaped, 'i') },
      { manufacturer: new RegExp(escaped, 'i') }
    ]
  };
}

// ============================================================
// ENTERPRISE HISTORY ROUTES
// ExtraÃ­do para routes/enterprise/enterpriseHistoryRoutes.js sem alterar endpoints.
// ============================================================
registerEnterpriseHistoryRoutes(app, {
  ...context,
  enterpriseOrderOperationAuth,
  IntegrationAuditLog,
  escapeRegex,
  redact
});

// ExtraÃ­do para routes/enterprise/catalogRoutes.js sem alterar endpoints: app.get('/api/enterprise/catalog/summary', enterpriseOrderOperationAuth, async (req, res) => {




// ============================================================
// ENTERPRISE DX ROUTES
// ExtraÃ­do para routes/enterprise/dxRoutes.js sem alterar endpoints.
// ============================================================
registerEnterpriseDxRoutes(app, {
  ...context,
  enterpriseVersionHeaders
});


// ============================================================
// SIGE CLOUD -> VENDA/PEDIDO PARA EMISSÃƒO MANUAL DE NF-e
// Fluxo seguro: Ariana cria a venda no SIGE, vocÃª emite a NF-e
// manualmente no SIGE, e depois o backend sincroniza XML/DANFE.
// Este mÃ³dulo Ã© incremental e nÃ£o altera rotas antigas.
registerEnterpriseSigeRoutes(app, {
  ...context,
  Order,
  IntegrationAuditLog,
  EnterpriseBillingRecord,
  DEFAULT_CURRENCY,
  SIGE_API_URL,
  SIGE_APP,
  SIGE_TOKEN,
  SIGE_USER,
  SIGE_TIMEOUT_MS,
  SIGE_PLANO_CONTA,
  axios,
  crypto,
  mongoose,
  path,
  fs,
  uploadsDir,
  adminRequired,
  enterpriseCompatAuth,
  enterpriseOrderOperationAuth,
  enterpriseCompatFindOrder,
  enterpriseNormalizeOrderForResponse,
  enterpriseBillingUpsert,
  enterpriseBillingNormalizeResponse,
  ensureArray,
  toJSON,
  redact,
  isSigeConfigured,
  sigeAuthHeaders,
  sigeGet
});

// NF-e DE SELLERS / FABRICANTES EXTERNOS
// Permite que sellers e parceiros Enterprise enviem a NF-e emitida
// no ERP deles. A Ariana apenas armazena, audita e vincula ao pedido.
// ============================================================
function arianaInvoiceEnsureDir() {
  const dir = path.join(uploadsDir, 'invoices');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function arianaPublicInvoiceUrl(req, filename = '') {
  const clean = String(filename || '').replace(/^\/+/, '');
  return buildPublicFileUrl(req, `invoices/${clean}`);
}

function arianaInvoiceId(prefix = 'inv') {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
}

function arianaSafeInvoiceExt(original = '', fallback = '') {
  const ext = path.extname(String(original || '')).toLowerCase();
  if (['.xml', '.pdf', '.html', '.htm'].includes(ext)) return ext;
  return fallback || '.bin';
}

async function arianaSaveInvoiceUpload(req, file, prefix, fallbackExt) {
  if (!file) return null;
  const dir = arianaInvoiceEnsureDir();
  const ext = arianaSafeInvoiceExt(file.originalname || file.filename || '', fallbackExt);
  const filename = `${sanitizeIdPart(prefix || 'nfe')}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
  const dest = path.join(dir, filename);
  if (file.path && fs.existsSync(file.path)) fs.renameSync(file.path, dest);
  else if (file.buffer) fs.writeFileSync(dest, file.buffer);
  else return null;
  return {
    filename,
    path: dest,
    url: arianaPublicInvoiceUrl(req, filename),
    originalName: file.originalname || filename,
    mimeType: file.mimetype || '',
    size: file.size || 0
  };
}

function arianaNormalizeExternalInvoice(input = {}, actor = {}) {
  const src = input.invoice || input.nfe || input.notaFiscal || input;
  const numero = String(src.numero || src.number || src.codigoNfe || src.codigoNFe || src.CodigoNFe || src.invoiceNumber || '').trim();
  const serie = String(src.serie || src.series || src.serieNfe || src.serieNFe || src.SerieNFe || '1').trim();
  const chave = String(src.chave || src.chaveAcesso || src.accessKey || src.invoiceKey || src.chaveNfe || '').replace(/\D/g, '').trim();
  const cnpjEmitente = String(src.cnpjEmitente || src.cnpjEmpresaEmissora || src.CNPJEmpresaEmissora || src.cnpj || actor.cnpj || '').replace(/\D/g, '').trim();
  const emitente = String(src.emitente || src.sellerName || actor.name || actor.sellerName || '').trim();
  return {
    invoiceId: String(src.invoiceId || src.id || '').trim() || arianaInvoiceId(actor.prefix || 'seller_nfe'),
    source: String(actor.source || src.source || 'seller').trim(),
    status: String(src.status || actor.status || 'enviada').trim(),
    numero,
    number: numero,
    codigo: numero,
    serie,
    series: serie,
    chave,
    chaveAcesso: chave,
    accessKey: chave,
    cnpjEmitente,
    emitente,
    sellerId: String(actor.sellerId || src.sellerId || '').trim(),
    manufacturer: String(actor.manufacturer || src.manufacturer || '').trim(),
    xmlUrl: String(src.xmlUrl || src.xmlURL || '').trim(),
    danfeUrl: String(src.danfeUrl || src.pdfUrl || src.invoiceUrl || '').trim(),
    pdfUrl: String(src.pdfUrl || src.danfeUrl || src.invoiceUrl || '').trim(),
    xml: String(src.xml || src.Xml || src.xmlContent || '').trim(),
    xmlContent: String(src.xmlContent || src.xml || src.Xml || '').trim(),
    protocol: String(src.protocol || src.protocolo || '').trim(),
    issuedAt: src.issuedAt || src.emitidaEm || src.dataEmissao || new Date(),
    uploadedAt: new Date(),
    approvedAt: src.approvedAt || null,
    rejectedAt: src.rejectedAt || null,
    rejectionReason: String(src.rejectionReason || '').trim(),
    raw: src.raw || src
  };
}

function arianaOrderHasSeller(order = {}, sellerId = '') {
  const sid = String(sellerId || '').trim();
  if (!sid) return false;
  return extractSellerIdsFromOrder(order).includes(sid);
}

async function arianaSaveExternalInvoiceOnOrder(order, invoiceInput = {}, req = null, actor = {}) {
  const invoice = arianaNormalizeExternalInvoice(invoiceInput, actor);
  const xmlFile = invoiceInput.xmlFile || null;
  const danfeFile = invoiceInput.danfeFile || null;
  if (xmlFile?.url) invoice.xmlUrl = xmlFile.url;
  if (danfeFile?.url) {
    invoice.danfeUrl = danfeFile.url;
    invoice.pdfUrl = danfeFile.url;
  }
  if (!invoice.numero && !invoice.chave && !invoice.xmlUrl && !invoice.xml && !invoice.danfeUrl) {
    const err = new Error('Informe nÃºmero/chave da NF-e ou envie XML/DANFE.');
    err.statusCode = 400;
    throw err;
  }
  const listKey = actor.source === 'enterprise' ? 'enterpriseInvoices' : 'sellerInvoices';
  const current = ensureArray(order[listKey]);
  const idx = current.findIndex((item) => String(item.invoiceId || '') === String(invoice.invoiceId || ''));
  if (idx >= 0) current[idx] = { ...current[idx], ...invoice };
  else current.push(invoice);
  order[listKey] = current;

  order.manufacturerDispatch = {
    ...(order.manufacturerDispatch || {}),
    externalInvoices: ensureArray(order.manufacturerDispatch?.externalInvoices).filter((i) => String(i.invoiceId || '') !== String(invoice.invoiceId)).concat(invoice),
    lastExternalInvoiceAt: new Date()
  };

  if (invoice.status === 'aprovada') {
    const publicNfe = {
      numero: invoice.numero,
      codigo: invoice.numero,
      number: invoice.numero,
      serie: invoice.serie,
      series: invoice.serie,
      chave: invoice.chave,
      chaveAcesso: invoice.chave,
      accessKey: invoice.chave,
      protocolo: invoice.protocol,
      protocol: invoice.protocol,
      status: invoice.status,
      xmlUrl: invoice.xmlUrl,
      xml: invoice.xml,
      xmlContent: invoice.xmlContent,
      danfeUrl: invoice.danfeUrl,
      pdfUrl: invoice.pdfUrl,
      emitidaEm: invoice.issuedAt,
      issuedAt: invoice.issuedAt,
      provider: invoice.source,
      sellerId: invoice.sellerId,
      manufacturer: invoice.manufacturer,
      emitente: invoice.emitente,
      invoiceId: invoice.invoiceId,
      raw: invoice.raw
    };
    order.nfe = { ...(order.nfe || {}), ...publicNfe };
    order.notaFiscal = { ...(order.notaFiscal || {}), ...publicNfe };
    order.fiscal = { ...(order.fiscal || {}), nfe: { ...((order.fiscal || {}).nfe || {}), ...publicNfe } };
  }

  order.status_integracao = invoice.status === 'aprovada' ? 'seller_invoice_approved' : 'seller_invoice_received';
  await order.save();
  return { order, invoice };
}

async function arianaProxyRemoteFile(res, url, filename, preferredContentType = '') {
  const target = String(url || '').trim();
  if (!target) return res.status(404).json({ ok: false, error: 'Arquivo nÃ£o disponÃ­vel' });
  if (/^https?:\/\//i.test(target)) {
    try {
      const upstream = await axios.get(target, { responseType: 'arraybuffer', timeout: 30000, headers: { Accept: preferredContentType || '*/*' } });
      const contentType = String(upstream.headers['content-type'] || preferredContentType || 'application/octet-stream');
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(Buffer.from(upstream.data));
    } catch (error) {
      return res.redirect(target);
    }
  }
  return res.redirect(target);
}

app.post('/api/seller/orders/:id/nfe', sellerAuthRequired, upload.fields([{ name: 'xml', maxCount: 1 }, { name: 'danfe', maxCount: 1 }, { name: 'pdf', maxCount: 1 }]), async (req, res) => {
  try {
    const oid = normalizeObjectId(req.params.id);
    if (!oid) return res.status(400).json({ ok: false, error: 'ID invÃ¡lido' });
    const order = await Order.findById(oid);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado' });
    const sid = String(req.sellerId || '').trim();
    if (!arianaOrderHasSeller(toJSON(order), sid)) return res.status(403).json({ ok: false, error: 'Sem permissÃ£o para enviar NF-e deste pedido' });

    const prefix = `seller-${sid}-${String(order._id).slice(-8)}`;
    const xmlFile = await arianaSaveInvoiceUpload(req, req.files?.xml?.[0], `${prefix}-xml`, '.xml');
    const danfeFile = await arianaSaveInvoiceUpload(req, req.files?.danfe?.[0] || req.files?.pdf?.[0], `${prefix}-danfe`, '.pdf');
    const saved = await arianaSaveExternalInvoiceOnOrder(order, { ...(req.body || {}), xmlFile, danfeFile }, req, {
      source: 'seller',
      prefix: 'seller_nfe',
      sellerId: sid,
      name: req.seller?.storeName || req.seller?.displayName || sid,
      cnpj: req.seller?.document || req.seller?.metadata?.cnpj || '',
      status: 'enviada'
    });

    await createAdminNotification({
      type: 'seller_invoice_received',
      title: 'NF-e enviada pelo seller',
      message: `Seller ${req.seller?.storeName || req.seller?.displayName || sid} enviou NF-e do pedido ${order._id}.`,
      relatedId: String(order._id),
      severity: 'success',
      metadata: { sellerId: sid, invoiceId: saved.invoice.invoiceId }
    });

    return res.json({ ok: true, action: 'seller_nfe_received', orderId: String(saved.order._id), invoice: saved.invoice, order: toJSON(saved.order) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao enviar NF-e do seller' });
  }
});

app.get('/api/seller/orders/:id/nfe', sellerAuthRequired, async (req, res) => {
  try {
    const oid = normalizeObjectId(req.params.id);
    if (!oid) return res.status(400).json({ ok: false, error: 'ID invÃ¡lido' });
    const order = await Order.findById(oid);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado' });
    const sid = String(req.sellerId || '').trim();
    if (!arianaOrderHasSeller(toJSON(order), sid)) return res.status(403).json({ ok: false, error: 'Sem permissÃ£o para consultar NF-e deste pedido' });
    const invoices = ensureArray(order.sellerInvoices).filter((i) => String(i.sellerId || '') === sid);
    return res.json({ ok: true, orderId: String(order._id), invoices });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao consultar NF-e do seller' });
  }
});

app.post('/api/admin/orders/:orderId/seller-invoices/:invoiceId/approve', adminRequired, async (req, res) => {
  try {
    const order = await enterpriseCompatFindOrder(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado' });
    const invoiceId = String(req.params.invoiceId || '').trim();
    const list = ensureArray(order.sellerInvoices).map((i) => String(i.invoiceId || '') === invoiceId ? { ...i, status: 'aprovada', approvedAt: new Date(), approvedBy: req.admin?.email || req.admin?.id || 'admin' } : i);
    const invoice = list.find((i) => String(i.invoiceId || '') === invoiceId);
    if (!invoice) return res.status(404).json({ ok: false, error: 'NF-e do seller nÃ£o encontrada' });
    order.sellerInvoices = list;
    const saved = await arianaSaveExternalInvoiceOnOrder(order, invoice, req, { source: 'seller', status: 'aprovada', sellerId: invoice.sellerId, prefix: 'seller_nfe' });
    return res.json({ ok: true, action: 'seller_invoice_approved', orderId: String(saved.order._id), invoice: saved.invoice, order: toJSON(saved.order) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao aprovar NF-e do seller' });
  }
});

app.post('/api/admin/orders/:orderId/seller-invoices/:invoiceId/reject', adminRequired, async (req, res) => {
  try {
    const order = await enterpriseCompatFindOrder(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado' });
    const invoiceId = String(req.params.invoiceId || '').trim();
    const reason = String(req.body?.reason || req.body?.motivo || '').trim();
    const list = ensureArray(order.sellerInvoices).map((i) => String(i.invoiceId || '') === invoiceId ? { ...i, status: 'reprovada', rejectedAt: new Date(), rejectionReason: reason } : i);
    order.sellerInvoices = list;
    await order.save();
    return res.json({ ok: true, action: 'seller_invoice_rejected', orderId: String(order._id), invoices: list });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao reprovar NF-e do seller' });
  }
});

app.post('/api/enterprise/orders/:orderId/nfe', enterpriseCompatAuth, upload.fields([{ name: 'xml', maxCount: 1 }, { name: 'danfe', maxCount: 1 }, { name: 'pdf', maxCount: 1 }]), async (req, res) => {
  try {
    const order = await enterpriseCompatFindOrder(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado' });
    const manufacturer = String(req.enterprisePartner?.manufacturer || req.body?.manufacturer || order.manufacturer || '').trim();
    const prefix = `enterprise-${manufacturer || 'partner'}-${String(order._id).slice(-8)}`;
    const xmlFile = await arianaSaveInvoiceUpload(req, req.files?.xml?.[0], `${prefix}-xml`, '.xml');
    const danfeFile = await arianaSaveInvoiceUpload(req, req.files?.danfe?.[0] || req.files?.pdf?.[0], `${prefix}-danfe`, '.pdf');
    const saved = await arianaSaveExternalInvoiceOnOrder(order, { ...(req.body || {}), xmlFile, danfeFile }, req, {
      source: 'enterprise',
      prefix: 'enterprise_nfe',
      manufacturer,
      status: 'enviada'
    });
    await createAdminNotification({ type: 'enterprise_invoice_received', title: 'NF-e enviada pelo parceiro Enterprise', message: `Parceiro ${manufacturer || 'Enterprise'} enviou NF-e do pedido ${order._id}.`, relatedId: String(order._id), severity: 'success', metadata: { manufacturer, invoiceId: saved.invoice.invoiceId } });
    return res.json({ ok: true, action: 'enterprise_nfe_received', orderId: String(saved.order._id), invoice: saved.invoice });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao receber NF-e Enterprise' });
  }
});


// Atalhos Admin para baixar XML/DANFE da NF-e salva no pedido.
// Ãštil para o painel administrativo da Ariana MÃ³veis.
app.get('/api/admin/orders/:orderId/nfe/xml', adminRequired, async (req, res) => {
  try {
    const { order, invoice, billing } = await enterpriseFindInvoiceDocument(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado para baixar XML' });

    const xmlUrl = enterpriseResolveDocumentUrl('xml', invoice, billing);
    const xmlContent = enterpriseResolveXmlContent(invoice, billing);
    if (!xmlUrl && !xmlContent) return res.status(404).json({ ok: false, error: 'XML ainda nÃ£o foi salvo para este pedido' });

    if (xmlUrl && String(req.query.redirect || '').toLowerCase() === 'true') return res.redirect(xmlUrl);

    if (xmlContent) {
      const fileName = `nfe-${invoice.number || billing?.invoiceNumber || String(order._id).slice(-8)}.xml`;
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      return res.send(xmlContent);
    }

    return res.json({ ok: true, orderId: String(order._id), type: 'xml', url: xmlUrl, downloadUrl: xmlUrl });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao baixar XML da NF-e' });
  }
});

app.get('/api/admin/orders/:orderId/nfe/danfe', adminRequired, async (req, res) => {
  try {
    const { order, invoice, billing } = await enterpriseFindInvoiceDocument(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado para baixar DANFE' });

    const danfeUrl = enterpriseResolveDocumentUrl('danfe', invoice, billing);
    if (!danfeUrl) return res.status(404).json({ ok: false, error: 'DANFE ainda nÃ£o foi salvo para este pedido' });

    if (String(req.query.redirect || '').toLowerCase() === 'true' || String(req.query.download || '').toLowerCase() === '1') {
      return res.redirect(danfeUrl);
    }

    return arianaProxyRemoteFile(res, danfeUrl, `danfe-${invoice.number || billing?.invoiceNumber || String(order._id).slice(-8)}.pdf`, 'application/pdf');
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao baixar DANFE da NF-e' });
  }
});


// ============================================================
// NF-e no painel Admin e no detalhe do pedido do cliente
// Exibe metadados da nota e disponibiliza XML/DANFE salvos no pedido.
// Admin usa adminRequired; cliente usa authRequired e sÃ³ acessa o prÃ³prio pedido.
// ============================================================
function arianaNfeBuildPublicInfo(order, invoice = {}, billing = {}) {
  const xmlUrl = enterpriseResolveDocumentUrl('xml', invoice, billing);
  const xmlContent = enterpriseResolveXmlContent(invoice, billing);
  const danfeUrl = enterpriseResolveDocumentUrl('danfe', invoice, billing);
  const orderId = String(order?._id || '');
  const number = String(invoice?.number || billing?.invoiceNumber || '').trim();
  const series = String(invoice?.series || invoice?.serie || billing?.serie || '').trim();
  const accessKey = String(invoice?.accessKey || invoice?.invoiceKey || billing?.invoiceKey || '').trim();
  const protocol = String(invoice?.protocol || billing?.protocol || '').trim();
  const status = String(invoice?.status || billing?.status || '').trim();

  return {
    exists: Boolean(number || accessKey || protocol || xmlUrl || xmlContent || danfeUrl),
    number,
    series,
    accessKey,
    protocol,
    status,
    issuedAt: invoice?.issuedAt || billing?.issuedAt || null,
    provider: invoice?.provider || 'sige_cloud',
    hasXml: Boolean(xmlUrl || xmlContent),
    hasDanfe: Boolean(danfeUrl),
    xmlUrl: xmlUrl || '',
    danfeUrl: danfeUrl || '',
    admin: orderId ? {
      consultar: `/api/admin/sige/orders/${orderId}/nfe`,
      xml: `/api/admin/orders/${orderId}/nfe/xml`,
      danfe: `/api/admin/orders/${orderId}/nfe/danfe`
    } : null,
    customer: orderId ? {
      consultar: `/api/orders/${orderId}/nfe`,
      xml: `/api/orders/${orderId}/xml`,
      danfe: `/api/orders/${orderId}/danfe`,
      xmlCompleto: `/api/orders/${orderId}/nfe/xml`,
      danfeCompleto: `/api/orders/${orderId}/nfe/danfe`
    } : null
  };
}

function arianaUserCanAccessOrderNfe(req, order) {
  if (!req?.user || !order) return false;
  const role = String(req.user.role || req.auth?.role || '').toLowerCase();
  if (role === 'admin' || req.auth?.admin === true) return true;

  const userId = String(req.user._id || req.user.id || req.auth?.id || '').trim();
  const orderUserId = String(order.userId || '').trim();
  if (userId && orderUserId && userId === orderUserId) return true;

  const userEmail = String(req.user.email || req.auth?.email || '').trim().toLowerCase();
  const orderEmail = String(order.customerEmail || '').trim().toLowerCase();
  return Boolean(userEmail && orderEmail && userEmail === orderEmail);
}

app.get('/api/admin/orders/:orderId/nfe', adminRequired, async (req, res) => {
  try {
    const { order, invoice, billing } = await enterpriseFindInvoiceDocument(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado para consultar NF-e' });
    const nfe = arianaNfeBuildPublicInfo(order, invoice, billing);
    return res.json({ ok: true, orderId: String(order._id), nfe, invoice, billing });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao consultar NF-e do pedido' });
  }
});

// Atalhos mais simples para o painel Admin.
app.get('/api/admin/orders/:orderId/xml', adminRequired, async (req, res) => {
  try {
    const { order, invoice, billing } = await enterpriseFindInvoiceDocument(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado para baixar XML' });

    const xmlUrl = enterpriseResolveDocumentUrl('xml', invoice, billing);
    const xmlContent = enterpriseResolveXmlContent(invoice, billing);
    if (!xmlUrl && !xmlContent) return res.status(404).json({ ok: false, error: 'XML ainda nÃ£o foi salvo para este pedido' });

    if (xmlUrl && String(req.query.redirect || '').toLowerCase() === 'true') return res.redirect(xmlUrl);

    if (xmlContent) {
      const fileName = `nfe-${invoice.number || billing?.invoiceNumber || String(order._id).slice(-8)}.xml`;
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      return res.send(xmlContent);
    }

    return res.json({ ok: true, orderId: String(order._id), type: 'xml', url: xmlUrl, downloadUrl: xmlUrl });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao baixar XML da NF-e' });
  }
});

app.get('/api/admin/orders/:orderId/danfe', adminRequired, async (req, res) => {
  try {
    const { order, invoice, billing } = await enterpriseFindInvoiceDocument(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado para baixar DANFE' });

    const danfeUrl = enterpriseResolveDocumentUrl('danfe', invoice, billing);
    if (!danfeUrl) return res.status(404).json({ ok: false, error: 'DANFE ainda nÃ£o foi salvo para este pedido' });

    if (String(req.query.redirect || '').toLowerCase() === 'true' || String(req.query.download || '').toLowerCase() === '1') {
      return res.redirect(danfeUrl);
    }

    return arianaProxyRemoteFile(res, danfeUrl, `danfe-${invoice.number || billing?.invoiceNumber || String(order._id).slice(-8)}.pdf`, 'application/pdf');
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao baixar DANFE da NF-e' });
  }
});

app.get('/api/orders/:orderId/nfe', authRequired, async (req, res) => {
  try {
    const { order, invoice, billing } = await enterpriseFindInvoiceDocument(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado para consultar NF-e' });
    if (!arianaUserCanAccessOrderNfe(req, order)) return res.status(403).json({ ok: false, error: 'VocÃª nÃ£o tem acesso Ã  NF-e deste pedido' });

    const nfe = arianaNfeBuildPublicInfo(order, invoice, billing);
    return res.json({ ok: true, orderId: String(order._id), nfe });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao consultar NF-e do pedido' });
  }
});

app.get('/api/orders/:orderId/nfe/xml', authRequired, async (req, res) => {
  try {
    const { order, invoice, billing } = await enterpriseFindInvoiceDocument(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado para baixar XML' });
    if (!arianaUserCanAccessOrderNfe(req, order)) return res.status(403).json({ ok: false, error: 'VocÃª nÃ£o tem acesso ao XML deste pedido' });

    const xmlUrl = enterpriseResolveDocumentUrl('xml', invoice, billing);
    const xmlContent = enterpriseResolveXmlContent(invoice, billing);
    if (!xmlUrl && !xmlContent) return res.status(404).json({ ok: false, error: 'XML ainda nÃ£o foi salvo para este pedido' });

    if (xmlUrl && String(req.query.redirect || '').toLowerCase() === 'true') return res.redirect(xmlUrl);

    if (xmlContent) {
      const fileName = `nfe-${invoice.number || billing?.invoiceNumber || String(order._id).slice(-8)}.xml`;
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      return res.send(xmlContent);
    }

    return res.json({ ok: true, orderId: String(order._id), type: 'xml', url: xmlUrl, downloadUrl: xmlUrl });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao baixar XML da NF-e' });
  }
});

app.get('/api/orders/:orderId/nfe/danfe', authRequired, async (req, res) => {
  try {
    const { order, invoice, billing } = await enterpriseFindInvoiceDocument(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado para baixar DANFE' });
    if (!arianaUserCanAccessOrderNfe(req, order)) return res.status(403).json({ ok: false, error: 'VocÃª nÃ£o tem acesso ao DANFE deste pedido' });

    const danfeUrl = enterpriseResolveDocumentUrl('danfe', invoice, billing);
    if (!danfeUrl) return res.status(404).json({ ok: false, error: 'DANFE ainda nÃ£o foi salvo para este pedido' });

    if (String(req.query.redirect || '').toLowerCase() === 'true' || String(req.query.download || '').toLowerCase() === '1') {
      return res.redirect(danfeUrl);
    }

    return arianaProxyRemoteFile(res, danfeUrl, `danfe-${invoice.number || billing?.invoiceNumber || String(order._id).slice(-8)}.pdf`, 'application/pdf');
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao baixar DANFE da NF-e' });
  }
});


// Atalhos compatÃ­veis para a tela antiga do cliente.
// Algumas versÃµes do front chamam /api/orders/:orderId/xml e /api/orders/:orderId/danfe.
// Mantemos esses atalhos apontando para os mesmos dados protegidos por login.
app.get('/api/orders/:orderId/xml', authRequired, async (req, res) => {
  try {
    const { order, invoice, billing } = await enterpriseFindInvoiceDocument(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado para baixar XML' });
    if (!arianaUserCanAccessOrderNfe(req, order)) return res.status(403).json({ ok: false, error: 'VocÃª nÃ£o tem acesso ao XML deste pedido' });

    const xmlUrl = enterpriseResolveDocumentUrl('xml', invoice, billing);
    const xmlContent = enterpriseResolveXmlContent(invoice, billing);
    if (!xmlUrl && !xmlContent) return res.status(404).json({ ok: false, error: 'XML ainda nÃ£o foi salvo para este pedido' });

    if (xmlUrl && String(req.query.redirect || '').toLowerCase() === 'true') return res.redirect(xmlUrl);

    if (xmlContent) {
      const fileName = `nfe-${invoice.number || billing?.invoiceNumber || String(order._id).slice(-8)}.xml`;
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      return res.send(xmlContent);
    }

    return res.json({ ok: true, orderId: String(order._id), type: 'xml', url: xmlUrl, downloadUrl: xmlUrl });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao baixar XML da NF-e' });
  }
});

app.get('/api/orders/:orderId/danfe', authRequired, async (req, res) => {
  try {
    const { order, invoice, billing } = await enterpriseFindInvoiceDocument(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado para baixar DANFE' });
    if (!arianaUserCanAccessOrderNfe(req, order)) return res.status(403).json({ ok: false, error: 'VocÃª nÃ£o tem acesso ao DANFE deste pedido' });

    const danfeUrl = enterpriseResolveDocumentUrl('danfe', invoice, billing);
    if (!danfeUrl) return res.status(404).json({ ok: false, error: 'DANFE ainda nÃ£o foi salvo para este pedido' });

    if (String(req.query.redirect || '').toLowerCase() === 'true' || String(req.query.download || '').toLowerCase() === '1') {
      return res.redirect(danfeUrl);
    }

    return arianaProxyRemoteFile(res, danfeUrl, `danfe-${invoice.number || billing?.invoiceNumber || String(order._id).slice(-8)}.pdf`, 'application/pdf');
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao baixar DANFE da NF-e' });
  }
});

}
