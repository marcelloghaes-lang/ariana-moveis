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
    enterpriseFindInvoiceDocument,
    enterpriseResolveDocumentUrl,
    enterpriseResolveXmlContent,
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

// ============================================================
// ENTERPRISE SELLER / EXTERNAL INVOICE ROUTES
// Extraído para routes/enterprise/enterpriseSellerInvoiceRoutes.js sem alterar endpoints.
// ============================================================
registerEnterpriseSellerInvoiceRoutes(app, {
  ...context,
  Order,
  EnterpriseBillingRecord,
  IntegrationAuditLog,
  DEFAULT_CURRENCY,
  axios,
  crypto,
  fs,
  path,
  uploadsDir,
  upload,
  adminRequired,
  sellerAuthRequired,
  authRequired,
  enterpriseCompatAuth,
  enterpriseOrderOperationAuth,
  enterpriseCompatFindOrder,
  enterpriseNormalizeOrderForResponse,
  enterpriseBillingUpsert,
  enterpriseBillingNormalizeResponse,
  ensureArray,
  toJSON,
  redact,
  normalizeObjectId,
  sanitizeIdPart,
  buildPublicFileUrl,
  extractSellerIdsFromOrder,
  createAdminNotification,
  enterpriseFindInvoiceDocument,
  enterpriseResolveDocumentUrl,
  enterpriseResolveXmlContent
});

}