import registerEnterpriseCatalogSyncRoutes from './enterprise/catalogSyncRoutes.js';
import registerEnterpriseCatalogRoutes from './enterprise/catalogRoutes.js';
import registerEnterpriseProductRoutes from './enterprise/enterpriseProductRoutes.js';
import registerEnterpriseSigeRoutes from './enterprise/enterpriseSigeRoutes.js';
import registerEnterpriseSellerInvoiceRoutes from './enterprise/enterpriseSellerInvoiceRoutes.js';
import registerEnterpriseHistoryRoutes from './enterprise/enterpriseHistoryRoutes.js';
import registerEnterpriseOrderRoutes from './enterprise/enterpriseOrderRoutes.js';
import registerEnterprisePartnerRequestRoutes from './enterprise/partnerRequestRoutes.js';
import registerEnterpriseAuthCheckRoutes from './enterprise/enterpriseAuthCheckRoutes.js';
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
import { createEnterpriseRouteHelpers } from './enterprise/shared/routeHelpers.js';

// ============================================================
// ROTAS ENTERPRISE - ARIANA MÃƒÆ’Ã¢â‚¬Å“VEIS
// Objetivo: isolar homologaÃƒÆ’Ã‚Â§ÃƒÆ’Ã‚Â£o, parceiros, OpenAPI, SDKs e APIs Enterprise
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
    sellerAuthRequired,
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
// CORREÃƒÆ’Ã¢â‚¬Â¡ÃƒÆ’Ã†â€™O ENTERPRISE - API KEY SANDBOX DINÃƒÆ’Ã¢â‚¬Å¡MICA
// MantÃƒÆ’Ã‚Â©m o mÃƒÆ’Ã‚Â³dulo antigo, mas garante que o API Explorer consiga
// autenticar e executar o fluxo completo usando as chaves geradas
// na homologaÃƒÆ’Ã‚Â§ÃƒÆ’Ã‚Â£o do painel.
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


const {
  enterprisePartnerGenerateKey,
  enterprisePartnerFindCurrentDoc,
  enterprisePartnerEnvironmentPath,
  enterpriseAdminPartnerQuery,
  enterpriseAdminFindPartner,
  enterpriseBuildProductManufacturerQuery
} = createEnterpriseRouteHelpers({
  EnterpriseHomologationRequestCompat,
  mongoose,
  crypto,
  sanitizeIdPart,
  escapeRegex
});

// ============================================================
// ENTERPRISE BILLING SHARED
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
// ENTERPRISE INVOICE ROUTES
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

// ============================================================
// ENTERPRISE AUTH CHECK ROUTES
// ============================================================
registerEnterpriseAuthCheckRoutes(app, {
  ...context,
  enterpriseCompatAuth
});


// ============================================================
// ENTERPRISE CATALOG SYNC ROUTES
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
// ENTERPRISE BILLING ROUTES
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
// ENTERPRISE TRACKING / LABEL ROUTES
// ============================================================
registerEnterpriseTrackingRoutes(app, {
  ...context,
  enterpriseCompatAuth,
  enterpriseOrderOperationAuth,
  enterpriseCompatFindOrder,
  enterpriseNormalizeOrderForResponse,
  LogisticsLabel
});


// ============================================================
// ETAPA 4 - ENTERPRISE RMA / DEVOLUÃƒÆ’Ã¢â‚¬Â¡ÃƒÆ’Ã¢â‚¬Â¢ES
// Rotas incrementais adicionadas sem alterar as rotas existentes.
// ============================================================


// ============================================================
// ENTERPRISE RMA ROUTES
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
// ENTERPRISE PARTNER SHARED
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

function enterprisePartnerLogStatusCode(status = '') {
  const value = String(status || '').toLowerCase();
  if (['success', 'ok', 'sent', 'delivered', 'received'].includes(value)) return 200;
  if (['queued', 'pending', 'processing'].includes(value)) return 202;
  if (['unauthorized', 'invalid_token', 'invalid_key'].includes(value)) return 401;
  if (['forbidden', 'permission_denied'].includes(value)) return 403;
  if (['not_found', 'missing'].includes(value)) return 404;
  if (['rate_limited', 'too_many_requests'].includes(value)) return 429;
  if (['error', 'failed', 'dead_letter'].includes(value)) return 500;
  return 200;
}


// ============================================================
// ENTERPRISE WEBHOOK ROUTES
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
// ENTERPRISE PARTNER AUTH ROUTES
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
// BLOCO 4 ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â CREDENCIAIS ENTERPRISE (ADMIN)
// Rotas administrativas adicionadas sem alterar as rotas jÃƒÆ’Ã‚Â¡ validadas
// do Portal do Fabricante (/api/enterprise/partner/...).
// ============================================================




// ============================================================
// ENTERPRISE ADMIN PARTNER ROUTES
// ============================================================
registerEnterpriseAdminPartnerRoutes(app, {
  ...context,
  EnterpriseHomologationRequestCompat,
  adminRequired,
  escapeRegex,
  enterpriseAdminFindPartner,
  toJSON
});


// ============================================================
// ENTERPRISE PARTNER DASHBOARD / USAGE / METRICS ROUTES
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
// ConfiguraÃƒÆ’Ã‚Â§ÃƒÆ’Ã‚Â£o de URL, Secret HMAC, teste real e reenvio.
// ============================================================


// ============================================================
// ENTERPRISE SWAGGER / OPENAPI ROUTES
// ============================================================
registerEnterpriseSwaggerRoutes(app, {
  ...context,
  FRONTEND_URL
});

// ============================================================
// ENTERPRISE ADMIN PRO ROUTES
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
// ============================================================
registerEnterpriseVersionRoutes(app, {
  ...context,
  adminRequired
});

// ============================================================
// ENTERPRISE MONITOR ROUTES
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
// ============================================================
registerEnterpriseDeveloperRoutes(app, {
  ...context,
  enterpriseVersionHeaders
});


// ============================================================
// ENTERPRISE ADMIN ANALYTICS ROUTES
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
// CORREÃƒÆ’Ã¢â‚¬Â¡ÃƒÆ’Ã†â€™O ETAPA 2 ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â ROTAS REAIS DE HISTORY E SUMMARY
// Adiciona somente as rotas faltantes, sem alterar rotas jÃƒÆ’Ã‚Â¡ homologadas.
// ============================================================


// ============================================================
// ENTERPRISE HISTORY ROUTES
// ============================================================
registerEnterpriseHistoryRoutes(app, {
  ...context,
  enterpriseOrderOperationAuth,
  IntegrationAuditLog,
  escapeRegex,
  redact
});


// ============================================================
// ENTERPRISE DX ROUTES
// ============================================================
registerEnterpriseDxRoutes(app, {
  ...context,
  enterpriseVersionHeaders
});


// ============================================================
// SIGE CLOUD -> VENDA/PEDIDO PARA EMISSÃƒÆ’Ã†â€™O MANUAL DE NF-e
// Fluxo seguro: Ariana cria a venda no SIGE, vocÃƒÆ’Ã‚Âª emite a NF-e
// manualmente no SIGE, e depois o backend sincroniza XML/DANFE.
// Este mÃƒÆ’Ã‚Â³dulo ÃƒÆ’Ã‚Â© incremental e nÃƒÆ’Ã‚Â£o altera rotas antigas.
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


