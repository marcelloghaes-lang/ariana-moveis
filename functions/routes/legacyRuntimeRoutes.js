import registerOrderStatusRoutes from './orderStatusRoutes.js';
import registerAdminCoreRoutes from './adminCoreRoutes.js';
import registerCouponRoutes from './couponRoutes.js';
import registerPaymentRoutes from './paymentRoutes.js';
import registerEnterpriseRoutes from './enterpriseRoutes.js';
import registerShippingRoutes from './shippingRoutes.js';
import registerOrderSupportRoutes from './orderSupportRoutes.js';
import registerLogisticsRoutes from './logisticsRoutes.js';
import registerWhatsappRoutes from './whatsappRoutes.js';
import registerAdminAtendimentoRoutes from './adminAtendimentoRoutes.js';
import registerAdminOperationalRoutes from './adminOperationalRoutes.js';
import registerCatalogHomeProductBannerRoutes from './catalogHomeProductBannerRoutes.js';
import registerSellerPartnerRoutes from './sellerPartnerRoutes.js';
import registerCoreAuthUserRoutes from './coreAuthUserRoutes.js';
import registerSellerCoreRoutes from './sellerCoreRoutes.js';
import registerAdminSigeCrediarioBotRoutes from './adminSigeCrediarioBotRoutes.js';
import registerExternalIntegrationRoutes from './externalIntegrationRoutes.js';
import createAdminOperationalController from '../controllers/adminOperationalController.js';
import createWhatsappController from '../controllers/whatsappController.js';
import createMarketplacePricingController from '../controllers/marketplacePricingController.js';

// ============================================================
// ROTAS LEGADAS - ARIANA MÓVEIS
// Arquivo extraído automaticamente do server.js original.
// Objetivo: reduzir o server.js sem mudar endpoints, regras ou respostas.
// Próximas etapas: dividir este arquivo por domínio: SIGE, Seller, Admin, Enterprise, Pagamentos etc.
// ============================================================

export default function registerLegacyRuntimeRoutes(app, context = {}) {
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

  const sellerAuthRequired = context.sellerAuthRequired || async function sellerAuthRequiredFallback(req, res, next) {
    if (typeof authRequired !== 'function') {
      return res.status(500).json({ ok: false, error: 'Middleware sellerAuthRequired não configurado.' });
    }

    return authRequired(req, res, () => {
      const role = String(req.user?.role || '').toLowerCase();
      if (!['seller', 'admin'].includes(role)) {
        return res.status(403).json({ ok: false, error: 'Acesso restrito ao seller.' });
      }
      req.sellerId = String(req.user?.sellerId || req.auth?.sellerId || '').trim();
      req.seller = req.user;
      return next();
    });
  };


registerOrderSupportRoutes(app, context);
registerAdminSigeCrediarioBotRoutes(app, context);
registerAdminAtendimentoRoutes(app, context);

const {
  BUILD_ID,
  writeAuditLog,
  upsertOperationalAlert,
  resolveOperationalAlert,
  scanOperationalAlerts
} = createAdminOperationalController(context);

const {
  redactWhatsappSettings,
  extractOrderPhone,
  extractOrderCustomerName,
  extractSellerPhone,
  parseAdminNotifyNumbers,
  buildTrackingLine,
  formatOrderStatusForCustomer,
  buildOrderStatusActionMessage,
  titleCaseCustomerName,
  buildOrderStatusMessage,
  buildOrderChatMessage,
  waSendTextMessage,
  formatMoneyBRL,
  formatOrderItemsForWhatsapp,
  buildAdminNewOrderMessage,
  waNotifyAdminNewOrder,
  buildAdminOrderStatusMessage,
  waNotifyAdminOrderStatusChange,
  waSendMediaMessage,
  waSyncWebhook,
  waParseIncomingWebhook,
  waPersistWebhook,
  buildDeliveryRatingMessage,
  scheduleDeliveryRating,
  processPendingDeliveryRatings,
  waMaybeNotifyOrderStatusChange,
  waNotifyOrderChatMessage
} = createWhatsappController({ ...context, writeAuditLog });

// ============================================================
// PREÇO MARKETPLACE / SELLER - ETAPA 22
// Helpers movidos para controllers/marketplacePricingController.js
// ============================================================
const {
  MARKETPLACE_CARD_DISCOUNT_PERCENT,
  MARKETPLACE_COMMISSION_PERCENT,
  roundMoney,
  getMarketplaceFactor,
  sellerBaseToMarketplacePrice,
  marketplacePriceToSellerBase,
  isCreditCardPayment,
  getOrderPaymentMethod,
  getChargedItemTotal,
  getItemProductId,
  getProductSellerBasePrice,
  buildProductBasePriceMapForOrders,
  getItemSellerBaseTotal,
  getSellerSettlementForOrder
} = createMarketplacePricingController(context);

// Funções avançadas de WhatsApp/notificações foram movidas para controllers/whatsappController.js na Etapa 24.

async function getManufacturerIntegration(manufacturer) { return ManufacturerIntegration.findOne({ manufacturer: String(manufacturer || '').trim() }); }
function computeNextAttempt(attempts) { const backoff = Math.pow(2, Math.max(0, attempts - 1)) * DISPATCH_RETRY_BASE_MS; return new Date(Date.now() + backoff); }
async function dispatchOrderToManufacturer(orderPayload = {}) { const manufacturer = String(orderPayload.manufacturer || orderPayload.fabricante || orderPayload.sellerIds?.[0] || orderPayload.sellerId || '').trim(); if (!manufacturer) throw new Error('Fabricante não informado no pedido.'); const integration = await getManufacturerIntegration(manufacturer); if (!integration || !integration.enabled) throw new Error(`Integração do fabricante ${manufacturer} não configurada ou desativada.`); const endpoint = String(integration.endpoint || '').trim(); if (!endpoint) throw new Error(`Endpoint do fabricante ${manufacturer} não configurado.`); const method = String(integration.method || 'POST').toUpperCase(); const sendAs = String(integration.sendAs || 'json').toLowerCase(); const headers = { ...(integration.headers || {}) }; if (integration.apiKey) headers.apikey = integration.apiKey; if (integration.authToken) headers.Authorization = `Bearer ${integration.authToken}`; let response; if (sendAs === 'form') { const body = new URLSearchParams(); Object.entries(orderPayload || {}).forEach(([k, v]) => { if (v === undefined || v === null) return; body.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v)); }); response = await axios({ url: endpoint, method, headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, data: body.toString(), timeout: Number(integration.timeoutMs || 30000), validateStatus: () => true }); } else { response = await axios({ url: endpoint, method, headers: { 'Content-Type': 'application/json', ...headers }, data: orderPayload, timeout: Number(integration.timeoutMs || 30000), validateStatus: () => true }); } const ok = response.status >= 200 && response.status < 300; await writeAuditLog({ scope: 'manufacturer_integration', eventType: 'manufacturer_dispatch_http', orderId: String(orderPayload._id || orderPayload.id || orderPayload.orderId || ''), manufacturer, status: ok ? 'success' : 'error', statusCode: response.status, request: orderPayload, response: response.data, metadata: { endpoint, method, sendAs } }); return { ok, manufacturer, endpoint, status: response.status, data: response.data, sentContentType: sendAs === 'form' ? 'application/x-www-form-urlencoded' : 'application/json' }; }

function normalizeEnterpriseManufacturerKey(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function isInternalArianaSeller(value = '') {
  const key = normalizeEnterpriseManufacturerKey(value);
  return ['arianamoveis', 'ariana_moveis', 'ariana', 'loja', 'admin', 'sndigital', 'sn_digital', 'sn'].includes(key);
}

async function resolveEnterpriseManufacturerForItem(item = {}, product = null) {
  const prod = product ? toJSON(product) : null;
  const candidates = [
    prod?.logistics?.enterpriseSync?.manufacturer,
    prod?.manufacturer,
    prod?.brand,
    item.manufacturer,
    item.fabricante,
    item.sellerId,
    prod?.sellerId
  ].filter(Boolean);

  for (const candidate of candidates) {
    const key = normalizeEnterpriseManufacturerKey(candidate);
    if (!key || isInternalArianaSeller(key)) continue;
    return key;
  }

  return '';
}

async function buildEnterpriseOutboundGroups(orderDoc = {}) {
  const order = toJSON(orderDoc) || {};
  const groups = new Map();
  const items = ensureArray(order.items);

  for (const rawItem of items) {
    const item = { ...(rawItem || {}) };
    let product = null;

    const oid = normalizeObjectId(item.productId);
    if (oid) product = await Product.findById(oid).lean().catch(() => null);
    if (!product && item.sku) product = await Product.findOne({ sku: String(item.sku).trim() }).lean().catch(() => null);

    const manufacturer = await resolveEnterpriseManufacturerForItem(item, product);
    if (!manufacturer) continue;

    if (!groups.has(manufacturer)) {
      groups.set(manufacturer, []);
    }

    groups.get(manufacturer).push({
      productId: String(item.productId || product?._id || product?.id || ''),
      sku: String(item.sku || product?.sku || '').trim(),
      name: String(item.name || product?.name || '').trim(),
      qty: Math.max(1, Number(item.qty || item.quantity || 1) || 1),
      unitPrice: Number(item.unitPrice || item.sellerBaseUnitPrice || product?.price || 0) || 0,
      totalPrice: Number(item.totalPrice || item.sellerBaseTotal || 0) || 0,
      sellerBaseUnitPrice: Number(item.sellerBaseUnitPrice || product?.price || item.unitPrice || 0) || 0,
      sellerBaseTotal: Number(item.sellerBaseTotal || item.totalPrice || 0) || 0,
      image: String(item.image || product?.imageUrl || product?.image || product?.mainImageUrl || '').trim(),
      manufacturer,
      brand: String(product?.brand || '').trim()
    });
  }

  return groups;
}

function buildEnterpriseOutboundPayload(order = {}, manufacturer = '', items = []) {
  const orderId = String(order._id || order.id || '').trim();
  return {
    source: 'ariana_marketplace',
    event: 'order_paid',
    manufacturer,
    orderId,
    externalOrderId: orderId,
    createdAt: order.createdAt || now(),
    paidAt: order.payment?.adminSaleNotifiedAt || now(),
    status: order.status || 'pago',
    statusLabel: order.statusLabel || 'Pagamento aprovado',
    currency: order.currency || DEFAULT_CURRENCY,
    customer: {
      name: order.customerName || order.shippingAddress?.name || '',
      email: order.customerEmail || '',
      phone: order.customerPhone || order.shippingAddress?.phone || ''
    },
    shippingAddress: order.shippingAddress || {},
    shipping: order.shipping || {},
    items,
    totals: {
      subtotal: Number(order.subtotal || 0) || 0,
      shippingCost: Number(order.shippingCost || 0) || 0,
      montagemCost: Number(order.montagemCost || 0) || 0,
      total: Number(order.total || 0) || 0
    },
    payment: {
      provider: order.payment?.provider || '',
      method: order.payment?.method || order.payment?.type || '',
      status: order.payment?.status || ''
    },
    notes: order.notes || ''
  };
}

async function enqueueManufacturerDispatch(orderDoc) {
  const order = toJSON(orderDoc);
  if (!order) return { skipped: true, reason: 'missing_order' };

  const orderId = String(order._id || order.id || '').trim();
  if (!orderId) return { skipped: true, reason: 'missing_order_id' };

  const groups = await buildEnterpriseOutboundGroups(order);
  if (!groups.size) {
    await writeAuditLog({
      scope: 'manufacturer_queue',
      eventType: 'manufacturer_dispatch_skipped',
      orderId,
      status: 'skipped',
      message: 'Pedido sem itens Enterprise para enviar ao fabricante',
      request: { sellerIds: order.sellerIds || [], items: order.items || [] }
    }).catch(() => null);
    return { skipped: true, reason: 'no_enterprise_items' };
  }

  const queues = [];
  for (const [manufacturer, items] of groups.entries()) {
    const existing = await ManufacturerDispatchQueue.findOne({
      orderId,
      manufacturer,
      status: { $in: ['pending', 'processing', 'retry_processing', 'retrying', 'sent'] }
    }).sort({ createdAt: -1 }).lean();

    if (existing) {
      queues.push({ ok: true, queueId: existing.queueId, manufacturer, status: existing.status, reused: true });
      continue;
    }

    const payload = buildEnterpriseOutboundPayload(order, manufacturer, items);
    const queueId = uid('mq');
    const queueRow = await ManufacturerDispatchQueue.create({
      queueId,
      orderId,
      manufacturer,
      payload,
      status: 'pending',
      attempts: 0,
      maxAttempts: MAX_DISPATCH_ATTEMPTS,
      nextAttemptAt: now()
    });

    queues.push({ ok: true, queueId: queueRow.queueId, manufacturer, status: 'pending' });

    await writeAuditLog({
      scope: 'manufacturer_queue',
      eventType: 'manufacturer_dispatch_enqueued',
      orderId,
      manufacturer,
      queueId,
      status: 'queued',
      request: payload,
      metadata: { items: items.length, origin: 'payment_approved_outbound_enterprise' }
    }).catch(() => null);
  }

  const primary = queues[0] || null;
  await Order.findByIdAndUpdate(orderId, {
    $set: {
      manufacturer: primary?.manufacturer || order.manufacturer || '',
      manufacturerDispatch: {
        ...(order.manufacturerDispatch || {}),
        outbound: {
          status: 'pending',
          queues,
          updatedAt: now()
        }
      },
      status_integracao: 'fila_pendente_fabricante'
    }
  }).catch(() => null);

  return { ok: true, totalQueues: queues.length, queues };
}

async function processSingleQueueItem(queueRow) { const row = typeof queueRow.toObject === 'function' ? queueRow : await ManufacturerDispatchQueue.findOne({ queueId: queueRow.queueId }); if (!row) return { ok: false, error: 'Queue item não encontrado' }; if (isInternalArianaSeller(row.manufacturer)) { row.status = 'skipped_internal'; row.deadLetter = false; row.nextAttemptAt = null; row.lastError = ''; row.lastResponse = { skipped: true, reason: 'internal_store_flow', message: 'Pedido de loja própria não é enviado para Enterprise externo.' }; await row.save(); await writeAuditLog({ scope: 'manufacturer_queue', eventType: 'manufacturer_dispatch_skipped_internal_store', orderId: row.orderId, manufacturer: row.manufacturer, queueId: row.queueId, status: 'skipped', message: 'Pedido de loja própria mantido no fluxo normal do marketplace.', request: row.payload || null }).catch(() => null); await Order.findByIdAndUpdate(row.orderId, { $set: { status_integracao: 'fluxo_interno_loja', 'manufacturerDispatch.outbound': { queueId: row.queueId, status: 'skipped_internal', reason: 'internal_store_flow', updatedAt: now() } } }).catch(() => null); return { ok: true, skipped: true, reason: 'internal_store_flow', queueId: row.queueId, manufacturer: row.manufacturer }; } row.status = row.attempts > 0 ? 'retry_processing' : 'processing'; row.lastAttemptAt = now(); await row.save(); try { const result = await dispatchOrderToManufacturer(row.payload || {}); row.attempts = Number(row.attempts || 0) + 1; row.lastResponse = redact(result.data || null); if (result.ok) { row.status = 'sent'; row.deadLetter = false; row.nextAttemptAt = null; await row.save(); await Order.findByIdAndUpdate(row.orderId, { $set: { status_integracao: 'enviado', manufacturerDispatch: { queueId: row.queueId, status: 'sent', attempts: row.attempts, endpoint: result.endpoint, httpStatus: result.status, response: redact(result.data || null), updatedAt: now() } } }); await resolveOperationalAlert('dispatch_dead_letter', row.queueId); await resolveOperationalAlert('dispatch_retry_pressure', row.queueId); await resolveOperationalAlert('order_dispatch_error', row.orderId); return { ok: true, result }; } row.lastError = `HTTP ${result.status}`; if (row.attempts >= Number(row.maxAttempts || MAX_DISPATCH_ATTEMPTS)) { row.status = 'dead_letter'; row.deadLetter = true; row.nextAttemptAt = null; } else { row.status = 'retrying'; row.nextAttemptAt = computeNextAttempt(row.attempts); } await row.save(); await Order.findByIdAndUpdate(row.orderId, { $set: { status_integracao: row.status === 'dead_letter' ? 'fila_erro_fabricante' : 'retry_fabricante', manufacturerDispatch: { queueId: row.queueId, status: row.status === 'dead_letter' ? 'error' : row.status, attempts: row.attempts, endpoint: result.endpoint, httpStatus: result.status, response: redact(result.data || null), updatedAt: now(), lastError: row.lastError } } }); return { ok: false, result }; } catch (error) { row.attempts = Number(row.attempts || 0) + 1; row.lastError = error.message; if (row.attempts >= Number(row.maxAttempts || MAX_DISPATCH_ATTEMPTS)) { row.status = 'dead_letter'; row.deadLetter = true; row.nextAttemptAt = null; } else { row.status = 'retrying'; row.nextAttemptAt = computeNextAttempt(row.attempts); } await row.save(); await writeAuditLog({ scope: 'manufacturer_queue', eventType: 'manufacturer_dispatch_processing_error', orderId: row.orderId, manufacturer: row.manufacturer, queueId: row.queueId, status: 'error', message: error.message, request: row.payload || null }); await Order.findByIdAndUpdate(row.orderId, { $set: { status_integracao: row.status === 'dead_letter' ? 'fila_erro_fabricante' : 'retry_fabricante', manufacturerDispatch: { queueId: row.queueId, status: row.status === 'dead_letter' ? 'error' : row.status, attempts: row.attempts, updatedAt: now(), lastError: error.message } } }); return { ok: false, error: error.message }; } }
async function processManufacturerQueue(limit = 10) { const rows = await ManufacturerDispatchQueue.find({ status: { $in: ['pending', 'retrying'] }, $or: [{ nextAttemptAt: { $lte: now() } }, { nextAttemptAt: null }] }).sort({ nextAttemptAt: 1, createdAt: 1 }).limit(Math.max(1, Number(limit || 10))); const results = []; for (const row of rows) results.push(await processSingleQueueItem(row)); return results; }

function envFirst(...keys) { for (const key of keys) { const value = process.env[key]; if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim(); } return ''; }
function normalizeDigits(value = '') { return String(value || '').replace(/\D/g, ''); }
function parseServices(raw) { return String(raw || '').split(',').map(s => String(s).trim()).filter(Boolean); }
function safeAxiosError(e) { return { status: e?.response?.status || null, message: e?.response?.data?.message || e?.message || 'Erro externo', data: e?.response?.data || null }; }
function positiveIntOrNull(v) { const n = Number(v); if (!Number.isFinite(n) || n <= 0) return null; return String(Math.round(n)); }
function toGrams(v) { const n = Number(v); if (!Number.isFinite(n) || n <= 0) return ''; return String(Math.round(n * 1000)); }
function parseMoneyBR(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 100) / 100;

  const raw = String(value).trim();
  if (!raw) return null;

  // Aceita formato brasileiro: 10,99 | 1.099,90 | R$ 10,99
  // Aceita formato JS: 10.99
  let normalized = raw.replace(/\s+/g, '').replace(/R\$/gi, '');
  const hasComma = normalized.includes(',');
  const hasDot = normalized.includes('.');

  if (hasComma) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else if (hasDot) {
    const parts = normalized.split('.');
    // 1.099 sem centavos vira 1099; 10.99 fica 10.99
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
      normalized = normalized.replace(/\./g, '');
    }
  }

  normalized = normalized.replace(/[^\d.-]/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}
function parseCorreiosPrice(value) {
  if (value === undefined || value === null || value === '') return null;

  // A API dos Correios pode devolver valores como "12,71", "12.71" ou 1271.
  // Quando vier número inteiro grande, tratamos como centavos para não virar R$ 1.271,00.
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (Number.isInteger(value) && value >= 1000) return Math.round(value) / 100;
    return Math.round(value * 100) / 100;
  }

  const raw = String(value).trim();
  if (!raw) return null;
  const digitsOnly = raw.replace(/\D/g, '');
  const hasComma = raw.includes(',');
  const hasDot = raw.includes('.');

  if (!hasComma && !hasDot && digitsOnly.length >= 4) {
    const cents = Number(digitsOnly);
    return Number.isFinite(cents) ? Math.round(cents) / 100 : null;
  }

  return parseMoneyBR(raw);
}

function pickPrice(item = {}) {
  const raw = item.pcFinal ?? item.vrServico ?? item.preco ?? item.valor ?? item.price ?? item.pcProduto ?? null;
  return parseCorreiosPrice(raw);
}
function pickDeadline(item = {}) {
  const raw = item.prazoEntrega ?? item.prazo ?? item.deadline ?? item.prazoDias ?? item.deliveryTime ?? item.delivery_time ?? item.dtPrazoEntrega ?? null;
  if (raw === null || raw === undefined || raw === '') return null;
  const direct = Number(raw);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const matches = String(raw).match(/\d+/g);
  if (!matches || !matches.length) return null;
  const n = Number(matches[matches.length - 1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}
const SERVICE_NAMES = { '03298': 'PAC', '03328': 'SEDEX', '03220': 'SEDEX Hoje', '03204': 'SEDEX 10', '03212': 'SEDEX 12' };
let correiosTokenCache = { token: null, exp: 0 };
function correiosCfg(settings = null) { const cfg = settings && settings.correios ? settings.correios : {}; return { user: envFirst('CORREIOS_USER'), pass: envFirst('CORREIOS_PASS'), cartao: envFirst('CORREIOS_CARTAO'), contrato: envFirst('CORREIOS_CONTRATO'), dr: envFirst('CORREIOS_DR') || '0', originCep: normalizeDigits(cfg.origemCep || envFirst('LOJA_ORIGEM_CEP')), services: (Array.isArray(cfg.servicos) && cfg.servicos.length ? cfg.servicos : parseServices(envFirst('CORREIOS_SERVICOS'))), pesoKgPadrao: Number(cfg.pesoKgPadrao || 1), alturaCmPadrao: Number(cfg.alturaCmPadrao || 10), larguraCmPadrao: Number(cfg.larguraCmPadrao || 15), comprimentoCmPadrao: Number(cfg.comprimentoCmPadrao || 20), valorDeclaradoPadrao: Number(cfg.valorDeclaradoPadrao || 0), tokenUrl: 'https://api.correios.com.br/token/v1/autentica/cartaopostagem', precoUrl: 'https://api.correios.com.br/preco/v1/nacional' }; }
async function getCorreiosToken(settings = null) { const cfg = correiosCfg(settings); const nowTs = Date.now(); if (correiosTokenCache.token && correiosTokenCache.exp > nowTs) return correiosTokenCache.token; const user = String(cfg.user || '').trim(); const pass = String(cfg.pass || '').trim(); if (!user || !pass) throw new Error('Correios: CORREIOS_USER/CORREIOS_PASS ausentes.'); if (!cfg.cartao) throw new Error('Correios: CORREIOS_CARTAO ausente.'); const auth = Buffer.from(`${user}:${pass}`).toString('base64'); const body = { numero: cfg.cartao, contrato: cfg.contrato || undefined, dr: cfg.dr ? Number(cfg.dr) : undefined }; const r = await axios.post(cfg.tokenUrl, body, { headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', Accept: 'application/json' }, timeout: 20000 }); const expiresIn = Number(r.data?.expires_in || 3000); const token = r.data?.token; if (!token) throw new Error('Correios: token não retornou.'); correiosTokenCache.token = token; correiosTokenCache.exp = nowTs + Math.max(60, expiresIn - 60) * 1000; return token; }
async function quoteCorreios(body = {}, settings = null) { const shippingSettings = settings || await getShippingSettings(); const cfg = correiosCfg(shippingSettings); const token = await getCorreiosToken(shippingSettings); const cepOrigem = normalizeDigits(cfg.originCep); const cepDestino = normalizeDigits(body.cepDestino || body.cep || body.destinationCep || ''); if (cepOrigem.length !== 8) throw new Error('LOJA_ORIGEM_CEP inválido (8 dígitos)'); if (cepDestino.length !== 8) throw new Error('cepDestino inválido (8 dígitos)'); const pesoKgNum = Number(body.pesoKg || body.weightKg || body.weight || cfg.pesoKgPadrao || 0); const psObjeto = toGrams(pesoKgNum); if (!psObjeto) throw new Error('pesoKg inválido (ex: 0.3, 1, 2.5)'); if (pesoKgNum > Number((shippingSettings.carriers?.correios || {}).maxWeightKg || 30)) { return { ok: true, quotes: [], errors: [{ code: 'CORREIOS_LIMIT_WEIGHT', message: 'Correios: limite máximo excedido.' }], bestQuote: null, meta: { cepOrigem, cepDestino, pesoKg: pesoKgNum } }; } let comprimento = positiveIntOrNull(body.comprimento || body.comprimentoCm || body.length || cfg.comprimentoCmPadrao); let largura = positiveIntOrNull(body.largura || body.larguraCm || body.width || cfg.larguraCmPadrao); let altura = positiveIntOrNull(body.altura || body.alturaCm || body.height || cfg.alturaCmPadrao); const hasDims = !!(comprimento && largura && altura); const maxSide = Math.max(Number(comprimento || 0), Number(largura || 0), Number(altura || 0)); if (hasDims && maxSide > Number((shippingSettings.carriers?.correios || {}).maxDimensionCm || 100)) { return { ok: true, quotes: [], errors: [{ code: 'CORREIOS_LIMIT_SIZE', message: 'Correios: maior lado acima do limite configurado.' }], bestQuote: null, meta: { cepOrigem, cepDestino, pesoKg: pesoKgNum, dimensionsUsed: { comprimento: Number(comprimento), largura: Number(largura), altura: Number(altura) } } }; } const tpObjeto = hasDims ? '2' : '1'; const parametrosProduto = (cfg.services || []).map((coProduto, idx) => { const item = { coProduto: String(coProduto), nuRequisicao: String(idx + 1).padStart(4, '0'), cepOrigem, cepDestino, psObjeto, tpObjeto, nuUnidade: '' }; if (cfg.contrato) item.nuContrato = String(cfg.contrato); const drNum = Number(cfg.dr); if (Number.isFinite(drNum) && drNum > 0) item.nuDR = drNum; if (tpObjeto === '2') { item.comprimento = comprimento; item.largura = largura; item.altura = altura; } if (Number(cfg.valorDeclaradoPadrao || 0) > 0) item.vlDeclarado = Number(cfg.valorDeclaradoPadrao || 0); return item; }); const r = await axios.post(cfg.precoUrl, { idLote: String(Date.now()), parametrosProduto }, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' }, timeout: 20000 }); const rawList = Array.isArray(r.data) ? r.data : Array.isArray(r.data?.itens) ? r.data.itens : Array.isArray(r.data?.resultado) ? r.data.resultado : Array.isArray(r.data?.parametrosProduto) ? r.data.parametrosProduto : (r.data ? [r.data] : []); const quotes = []; const errors = []; for (const item of rawList) { const coProduto = String(item?.coProduto || ''); const txErro = item?.txErro ? String(item.txErro) : ''; if (txErro) { errors.push({ service: coProduto, name: SERVICE_NAMES[coProduto] || coProduto, message: txErro, raw: item }); continue; } const resolvedDeadlineDays = pickDeadline(item);
            const resolvedPrazo = resolvedDeadlineDays
        ? `${resolvedDeadlineDays} dia(s) úteis`
        : ((coProduto === '03298')
          ? '3 a 7 dias úteis'
          : (coProduto === '03328' || coProduto === '03220')
            ? '1 a 3 dias úteis'
            : 'sob consulta');

      quotes.push({
        service: coProduto,
        label: SERVICE_NAMES[coProduto] || coProduto,
        name: SERVICE_NAMES[coProduto] || coProduto,
        price: pickPrice(item),
        prazo: resolvedPrazo,
        deadlineDays: resolvedDeadlineDays,
        provider: 'correios',
        raw: item
      });
    }

    quotes.sort((a, b) => Number(a.price ?? 1e9) - Number(b.price ?? 1e9));

    return {
      ok: true,
      quotes,
      errors,
      bestQuote: quotes[0] || null,
      meta: {
        cepOrigem,
        cepDestino,
        pesoKg: pesoKgNum,
        dimensionsUsed: hasDims
          ? {
            comprimento: Number(comprimento),
            largura: Number(largura),
            altura: Number(altura)
          }
          : null,
        servicesRequested: cfg.services,
        limits: {
          maxWeightKg: Number((shippingSettings.carriers?.correios || {}).maxWeightKg || 30),
          maxSideCm: Number((shippingSettings.carriers?.correios || {}).maxDimensionCm || 100)
        }
      }
    };
  }

const viaCepCache = new Map();
const geoCache = new Map();

async function getDistanceKm(originCep, destinationCep) {
  const origin = normalizeCepValue(originCep);
  const destination = normalizeCepValue(destinationCep);
  if (!origin || !destination || origin === destination) return 0;
  const cacheKey = `${origin}:${destination}`;
  if (geoCache.has(cacheKey)) return geoCache.get(cacheKey);
  const originInfo = await lookupCepInfo(origin);
  const destInfo = await lookupCepInfo(destination);
  if (!originInfo?.city || !destInfo?.city) {
    geoCache.set(cacheKey, 0);
    return 0;
  }
  const query = `${destInfo.city}, ${destInfo.state || ''}, Brazil`;
  try {
    const url = 'https://nominatim.openstreetmap.org/search';
    const resp = await axios.get(url, {
      params: { q: query, format: 'jsonv2', limit: 1 },
      timeout: 10000,
      headers: { 'User-Agent': 'ArianaMoveis/1.0 (shipping distance lookup)' }
    });
    const lat = Number(resp.data?.[0]?.lat);
    const lon = Number(resp.data?.[0]?.lon);
    const originMap = {
      'GUANHAES|MG': { lat: -18.7752, lon: -42.9325 },
      'GUANHÃƒES|MG': { lat: -18.7752, lon: -42.9325 }
    };
    const originKey = `${(originInfo.city || '').toUpperCase()}|${(originInfo.state || '').toUpperCase()}`;
    const originCoords = originMap[originKey] || { lat: -18.7752, lon: -42.9325 };
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      geoCache.set(cacheKey, 0);
      return 0;
    }
    const toRad = (deg) => (deg * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(lat - originCoords.lat);
    const dLon = toRad(lon - originCoords.lon);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(originCoords.lat)) * Math.cos(toRad(lat)) *
      Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const km = Number((R * c).toFixed(1));
    geoCache.set(cacheKey, km);
    return km;
  } catch (_error) {
    geoCache.set(cacheKey, 0);
    return 0;
  }
}
function calculateOwnDelivery(km, tiers = []) { const sorted = [...tiers].sort((a, b) => Number(a.maxKm || 0) - Number(b.maxKm || 0)); for (const tier of sorted) { if (Number(km || 0) <= Number(tier.maxKm || 0)) return { available: true, price: Number(tier.price || 0), service: 'own_delivery' }; } return { available: false }; }
function normalizeShippingText(value = '') { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, ' ').trim().toUpperCase(); }
function normalizeCepValue(value = '') { const digits = normalizeDigits(value); return digits.length === 8 ? digits : ''; }
function cepInRange(cep, startCep, endCep) { const cepNum = Number(normalizeCepValue(cep)); const startNum = Number(normalizeCepValue(startCep)); const endNum = Number(normalizeCepValue(endCep)); if (!Number.isFinite(cepNum) || !Number.isFinite(startNum) || !Number.isFinite(endNum)) return false; return cepNum >= startNum && cepNum <= endNum; }
function parsePrazoToDeadlineDays(prazo = '') {
  const str = String(prazo || '').trim();
  if (!str) return null;
  const matches = str.match(/\d+/g);
  if (!matches || !matches.length) return null;
  return Number(matches[matches.length - 1]) || null;
}
function buildManualShippingOption({ service, label, price, prazo, provider = 'configured', details = null, metadata = null, deadlineDays = null }) {
  const parsedDeadline = Number(deadlineDays || parsePrazoToDeadlineDays(prazo || '0') || 0) || null;
  return {
    service,
    label,
    price: Number(price || 0),
    prazo: prazo || null,
    deadlineDays: parsedDeadline,
    provider,
    details: details || null,
    metadata: metadata || null
  };
}
function getBodyWeightKg(body = {}, settings = {}) {
  const direct = Number(body.weightKg || body.pesoKg || body.weight || 0);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const items = Array.isArray(body.items) ? body.items : [];
  const sum = items.reduce((acc, item) => {
    const qty = Number(item.quantity || item.qty || 1) || 1;
    const weight = Number(item.weightKg || item.pesoKg || item.weight || 0) || 0;
    return acc + (qty * weight);
  }, 0);
  return Number(sum || settings.correios?.pesoKgPadrao || 0);
}
function getBodyMaxDimensionCm(body = {}, settings = {}) {
  const direct = Number(body.maxDimensionCm || body.dimensionCm || 0);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const base = Math.max(
    Number(body.comprimento || body.comprimentoCm || body.length || settings.correios?.comprimentoCmPadrao || 0),
    Number(body.largura || body.larguraCm || body.width || settings.correios?.larguraCmPadrao || 0),
    Number(body.altura || body.alturaCm || body.height || settings.correios?.alturaCmPadrao || 0)
  );
  if (Number.isFinite(base) && base > 0) return base;
  const items = Array.isArray(body.items) ? body.items : [];
  return items.reduce((acc, item) => Math.max(acc,
    Number(item.comprimento || item.comprimentoCm || item.length || item.dimensions?.comprimento || 0) || 0,
    Number(item.largura || item.larguraCm || item.width || item.dimensions?.largura || 0) || 0,
    Number(item.altura || item.alturaCm || item.height || item.dimensions?.altura || 0) || 0
  ), Number(settings.correios?.comprimentoCmPadrao || 0));
}
function getSellerContext(body = {}) {
  const directParts = [
    body.sellerId, body.sellerName, body.seller, body.storeName, body.manufacturer, body.vendorName, body.brand
  ].filter(Boolean);
  const itemParts = (Array.isArray(body.items) ? body.items : []).flatMap(item => [
    item?.sellerId, item?.sellerName, item?.seller, item?.storeName, item?.manufacturer, item?.vendorName, item?.brand
  ]).filter(Boolean);
  const raw = [...directParts, ...itemParts].join(' ');
  const normalized = normalizeShippingText(raw);
  return {
    raw,
    normalized,
    isAriana: normalized.includes('ARIANA') || normalized.includes('ADMIN'),
    isSNDigital: normalized.includes('SN DIGITAL') || normalized === 'SN' || normalized.includes(' SN ') || normalized.startsWith('SN ')
  };
}

function getShippingOriginCepFromBody(body = {}) {
  const direct = normalizeCepValue(
    body.originCep ||
    body.cepOrigem ||
    body.sellerOriginCep ||
    body.sellerCep ||
    body.storeOriginCep ||
    body.lojaOrigemCep ||
    body.shippingOriginCep ||
    body.shipping?.originCep ||
    body.shipping?.cepOrigem ||
    body.seller?.originCep ||
    body.seller?.cepOrigem ||
    ''
  );
  if (direct) return direct;

  const items = Array.isArray(body.items) ? body.items : [];
  for (const item of items) {
    const itemCep = normalizeCepValue(
      item?.originCep ||
      item?.cepOrigem ||
      item?.sellerOriginCep ||
      item?.sellerCep ||
      item?.storeOriginCep ||
      item?.seller?.originCep ||
      item?.seller?.cepOrigem ||
      item?.shipping?.originCep ||
      item?.shipping?.cepOrigem ||
      ''
    );
    if (itemCep) return itemCep;
  }
  return '';
}

function bodyHasPhoneProduct(body = {}) {
  const parts = [
    body.name, body.nome, body.title, body.productName, body.description, body.descricao,
    body.category, body.categoria, body.categoryName, body.brand, body.marca, body.sku
  ];
  const items = Array.isArray(body.items) ? body.items : [];
  for (const item of items) {
    parts.push(
      item?.name, item?.nome, item?.title, item?.productName, item?.description, item?.descricao,
      item?.category, item?.categoria, item?.categoryName, item?.brand, item?.marca, item?.sku
    );
  }
  const text = normalizeShippingText(parts.filter(Boolean).join(' '));
  return /SMARTPHONE|CELULAR|IPHONE|GALAXY|MOTOROLA|MOTO\s*G|XIAOMI|REDMI|SAMSUNG/.test(text);
}
async function lookupCepInfo(cep = '') { const normalizedCep = normalizeCepValue(cep); if (!normalizedCep) return null; if (viaCepCache.has(normalizedCep)) return viaCepCache.get(normalizedCep); try { const url = `https://viacep.com.br/ws/${normalizedCep}/json/`; const response = await axios.get(url, { timeout: 10000 }); const data = response.data || {}; if (data.erro) { viaCepCache.set(normalizedCep, null); return null; } const parsed = { cep: normalizedCep, city: data.localidade || '', state: data.uf || '', neighborhood: data.bairro || '' }; viaCepCache.set(normalizedCep, parsed); return parsed; } catch (_error) { return null; } }
async function resolveDestinationLocation(body = {}) { const cep = normalizeCepValue(body.cepDestino || body.cep || body.destinationCep || body.shippingAddress?.cep || ''); const explicitCity = body.cidade || body.city || body.destinationCity || body.shippingAddress?.cidade || body.shippingAddress?.city || ''; const explicitState = body.uf || body.state || body.destinationState || body.shippingAddress?.uf || body.shippingAddress?.state || ''; if (explicitCity) return { cep, city: String(explicitCity).trim(), state: String(explicitState || '').trim(), source: 'request' }; const viaCep = await lookupCepInfo(cep); if (viaCep) return { ...viaCep, source: 'viacep' }; return { cep, city: '', state: '', source: cep ? 'cep_only' : 'unknown' }; }
function isRodocapCityAllowed(city = '', rodocapRule = {}) {
  const normalizedCity = normalizeShippingText(city);
  const allowedFromRule = Array.isArray(rodocapRule.allowedCities) ? rodocapRule.allowedCities : [];
  const allowedFromContext = Array.isArray(RODOCAP_ALLOWED_CITIES) ? RODOCAP_ALLOWED_CITIES : [];
  const allowedFromEnv = String(process.env.RODOCAP_ALLOWED_CITIES || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const allowed = [...allowedFromRule, ...allowedFromContext, ...allowedFromEnv]
    .map(normalizeShippingText)
    .filter(Boolean);

  // Se nenhuma lista de cidades estiver configurada, não bloqueia a Rodocap.
  // Assim, quando Correios não atende por peso/dimensão, o sistema ainda consegue calcular Rodocap.
  if (!allowed.length) return true;

  if (!normalizedCity) return false;
  return allowed.includes(normalizedCity);
}

function normalizeFrenetNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function buildFrenetItems(body = {}, settings = {}) {
  const defaults = settings?.correios || {};
  const items = Array.isArray(body.items) && body.items.length ? body.items : [{
    qty: body.quantity || body.qty || 1,
    sku: body.sku || body.productId || '',
    category: body.category || body.categoria || '',
    weightKg: body.weightKg || body.pesoKg || body.weight,
    height: body.altura || body.alturaCm || body.height,
    length: body.comprimento || body.comprimentoCm || body.length,
    width: body.largura || body.larguraCm || body.width
  }];

  return items.map((item) => {
    const qty = normalizeFrenetNumber(item.quantity || item.qty || item.quantidade, 1);
    const weight = normalizeFrenetNumber(item.weightKg || item.pesoKg || item.weight || item.peso, Number(defaults.pesoKgPadrao || 1));
    const height = Math.max(1, Math.ceil(normalizeFrenetNumber(item.altura || item.alturaCm || item.height || item.dimensions?.altura, Number(defaults.alturaCmPadrao || 10))));
    const length = Math.max(1, Math.ceil(normalizeFrenetNumber(item.comprimento || item.comprimentoCm || item.length || item.dimensions?.comprimento, Number(defaults.comprimentoCmPadrao || 20))));
    const width = Math.max(1, Math.ceil(normalizeFrenetNumber(item.largura || item.larguraCm || item.width || item.dimensions?.largura, Number(defaults.larguraCmPadrao || 15))));const out = {
      Height: height,
      Length: length,
      Quantity: qty,
      Weight: weight,
      Width: width
    };

    const sku = String(item.sku || item.SKU || item.productId || item.id || '').trim();
    const category = String(item.category || item.categoria || item.categoryName || '').trim();
    if (sku) out.SKU = sku;
    if (category) out.Category = category;
    return out;
  });
}

function normalizeFrenetQuote(row = {}) {
  const serviceCode = String(row.ServiceCode || row.serviceCode || row.Code || row.code || '').trim();
  const carrier = String(row.Carrier || row.carrier || '').trim();
  const serviceDescription = String(row.ServiceDescription || row.serviceDescription || row.Description || row.description || carrier || 'Frenet').trim();
  const price = Number(row.ShippingPrice ?? row.shippingPrice ?? row.Price ?? row.price ?? row.OriginalShippingPrice ?? 0);
  const deliveryTime = Number(row.DeliveryTime ?? row.deliveryTime ?? row.OriginalDeliveryTime ?? 0);
  const error = row.Error === true || String(row.Error || row.error || '').toLowerCase() === 'true';
  const message = String(row.Msg || row.Message || row.message || row.ErrorMessage || '').trim();

  return {
    service: serviceCode || sanitizeIdPart(`${carrier}_${serviceDescription}`),
    label: carrier ? `${carrier} - ${serviceDescription}` : serviceDescription,
    name: carrier ? `${carrier} - ${serviceDescription}` : serviceDescription,
    price,
    prazo: deliveryTime > 0 ? `${deliveryTime} dia(s) úteis` : 'sob consulta',
    deadlineDays: deliveryTime > 0 ? deliveryTime : null,
    provider: 'frenet',
    raw: row,
    unavailable: error || !Number.isFinite(price) || price <= 0,
    error: message || (error ? 'Serviço indisponível na Frenet.' : '')
  };
}

async function quoteFrenet(body = {}, settings = null) {
  const shippingSettings = settings || await getShippingSettings();
  const cfg = shippingSettings?.carriers?.frenet || {};
  const token = String(cfg.token || process.env.FRENET_TOKEN || process.env.FRENET_API_TOKEN || '').trim();
  if (!cfg.enabled) return { ok: true, quotes: [], skipped: true, reason: 'frenet_disabled' };
  if (!token) throw new Error('FRENET_TOKEN não configurado.');

  const sellerCep = normalizeCepValue(cfg.origemCep || process.env.FRENET_ORIGIN_CEP || process.env.LOJA_ORIGEM_CEP || shippingSettings?.correios?.origemCep || '');
  const recipientCep = normalizeCepValue(body.cepDestino || body.cep || body.destinationCep || body.shippingAddress?.cep || '');
  if (!sellerCep) throw new Error('CEP de origem da Frenet não configurado.');
  if (!recipientCep) throw new Error('CEP de destino inválido para cotação Frenet.');

  const invoiceValue = Number(body.productPrice || body.price || body.valorNota || body.invoiceValue || body.subtotal || body.total || 0);
  const payload = {
    SellerCEP: sellerCep,
    RecipientCEP: recipientCep,
    ShipmentInvoiceValue: Number.isFinite(invoiceValue) && invoiceValue > 0 ? invoiceValue : 1,
    ShippingServiceCode: body.shippingServiceCode || body.serviceCode || null,
    ShippingItemArray: buildFrenetItems(body, shippingSettings),
    RecipientCountry: 'BR'
  };

  const apiUrl = String(cfg.apiUrl || process.env.FRENET_API_URL || 'https://api.frenet.com.br').replace(/\/+$/, '');
  const response = await axios.post(`${apiUrl}/shipping/quote`, payload, {
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      token
    },
    timeout: Number(process.env.FRENET_TIMEOUT_MS || 30000),
    validateStatus: () => true
  });

  const data = response.data || {};
  if (response.status < 200 || response.status >= 300) {
    const message = data?.Message || data?.message || data?.error || `Frenet HTTP ${response.status}`;
    throw new Error(String(message));
  }

  const rows =
    data.ShippingSevicesArray ||
    data.ShippingServicesArray ||
    data.shippingServicesArray ||
    data.shippingSevicesArray ||
    data.Services ||
    data.services ||
    [];

  const normalized = Array.isArray(rows) ? rows.map(normalizeFrenetQuote) : [];
  return {
    ok: true,
    quotes: normalized.filter((q) => !q.unavailable && Number.isFinite(q.price) && q.price > 0),
    errors: normalized.filter((q) => q.unavailable),
    raw: data,
    payload: { ...payload, token: '[redacted]' }
  };
}


async function calculateShipping(body = {}) {
  const settings = await getShippingSettings();
  const businessRules = settings.businessRules || {};
  const arianaRule = businessRules.arianaMoveis || {};
  const snRule = businessRules.snDigital || {};
  const rodocapRule = businessRules.rodocap || {};
  const weightKg = getBodyWeightKg(body, settings);
  const maxDimensionCm = getBodyMaxDimensionCm(body, settings);
  const productPrice = Number(body.productPrice || body.price || body.valorNota || body.invoiceValue || body.subtotal || 0);
  const destinationCep = normalizeCepValue(body.cepDestino || body.cep || body.destinationCep || body.shippingAddress?.cep || '');
  const sellerCtx = getSellerContext(body);
  const location = await resolveDestinationLocation(body);
  const configuredOriginCep = normalizeCepValue(settings?.correios?.origemCep || process.env.LOJA_ORIGEM_CEP || arianaRule.localOriginCep || arianaRule.freeCepStart || '39740000');
  const sellerOriginCep = getShippingOriginCepFromBody(body);
  const arianaLocalOriginCep = normalizeCepValue(arianaRule.localOriginCep || arianaRule.freeCepStart || '39740000');
  const originCep = sellerOriginCep || configuredOriginCep;
  const inferredDistanceKm = await getDistanceKm(arianaLocalOriginCep || originCep, destinationCep);
  const distanceKm = Number(body.distanceKm || body.km || inferredDistanceKm || 0);
  const options = [];
  const isAriana = body.shippingRule === 'ariana' || body.isArianaOrder === true || sellerCtx.isAriana;
  const isLocalSellerOrigin = Boolean(arianaLocalOriginCep && sellerOriginCep && sellerOriginCep === arianaLocalOriginCep);
  // Ariana Logística é a logística local oficial do marketplace.
  // Ela também cobre a regra antiga chamada SN Digital; para evitar duplicidade, mostramos apenas Ariana Logística.
  const usesArianaLocalRule = arianaRule.enabled !== false || isAriana || isLocalSellerOrigin || body.shippingRule === 'ariana_local' || body.useArianaLocalRule === true;
  const isSNDigital = false;
  const usesArianaLogistics = arianaRule.enabled !== false || usesArianaLocalRule || body.useArianaLogistics === true || body.enableArianaLogistics === true || businessRules?.rodocap?.appliesToArianaLogistics === true;
  const isPhoneProduct = arianaRule.phoneFlatEnabled !== false && bodyHasPhoneProduct(body);

  if (isPhoneProduct) {
    const phoneLocalFree = destinationCep && cepInRange(destinationCep, arianaRule.freeCepStart, arianaRule.freeCepEnd);
    options.push(buildManualShippingOption({
      service: phoneLocalFree ? 'celular_free_local' : 'celular_frete_fixo',
      label: phoneLocalFree ? 'Frete grátis celular' : 'Frete fixo celular',
      price: phoneLocalFree ? 0 : Number(arianaRule.phoneFlatPrice || 19.90),
      prazo: arianaRule.prazo || '1 a 3 dias úteis',
      provider: 'configured',
      details: phoneLocalFree
        ? `Frete grátis para celulares no CEP ${arianaRule.freeCepStart || '39740-000'}.`
        : 'Frete fixo para celulares para qualquer destino.',
      metadata: { rule: phoneLocalFree ? 'celular_free_local' : 'celular_frete_fixo', destinationCep },
      deadlineDays: parsePrazoToDeadlineDays(arianaRule.prazo || '1 a 3 dias úteis')
    }));
  }

  const hasPhoneFlatDelivery = isPhoneProduct;
  const hasArianaFree = !hasPhoneFlatDelivery && usesArianaLocalRule && arianaRule.enabled !== false && destinationCep && cepInRange(destinationCep, arianaRule.freeCepStart, arianaRule.freeCepEnd);
  if (hasArianaFree) {
    options.push(buildManualShippingOption({
      service: 'ariana_free_local',
      label: arianaRule.label || 'Ariana Móveis',
      price: 0,
      prazo: arianaRule.prazo || '1 a 3 dias úteis',
      provider: 'configured',
      details: `Frete grátis para o CEP ${arianaRule.freeCepStart}.`,
      metadata: { rule: 'ariana_free_local', cep: destinationCep },
      deadlineDays: parsePrazoToDeadlineDays(arianaRule.prazo || '1 a 3 dias úteis')
    }));
  }

  const arianaTier1Km = Number(arianaRule.localMaxKmTier1 || 30);
  const arianaTier1Price = Number(arianaRule.localPriceTier1 || 80);
  const arianaTier2Km = Number(arianaRule.localMaxKmTier2 || 70);
  const arianaTier2Price = Number(arianaRule.localPriceTier2 || 120);
  let hasArianaDistanceDelivery = false;

  if (usesArianaLocalRule && arianaRule.enabled !== false && !hasPhoneFlatDelivery && !hasArianaFree && Number(distanceKm || 0) > 0 && Number(distanceKm || 0) <= arianaTier1Km) {
    hasArianaDistanceDelivery = true;
    options.push(buildManualShippingOption({
      service: 'ariana_entrega_ate_30km',
      label: arianaRule.label || 'Ariana Móveis',
      price: arianaTier1Price,
      prazo: arianaRule.prazo || '1 a 3 dias úteis',
      provider: 'configured',
      details: `Entrega Ariana Móveis até ${arianaTier1Km} km a partir do CEP ${arianaRule.localOriginCep || arianaRule.freeCepStart || '39740-000'}.`,
      metadata: { rule: 'ariana_entrega_ate_30km', distanceKm, destinationCep },
      deadlineDays: parsePrazoToDeadlineDays(arianaRule.prazo || '1 a 3 dias úteis')
    }));
  }

  if (usesArianaLocalRule && arianaRule.enabled !== false && !hasPhoneFlatDelivery && !hasArianaFree && Number(distanceKm || 0) > arianaTier1Km && Number(distanceKm || 0) <= arianaTier2Km) {
    hasArianaDistanceDelivery = true;
    options.push(buildManualShippingOption({
      service: 'ariana_entrega_30_50km',
      label: arianaRule.label || 'Ariana Móveis',
      price: arianaTier2Price,
      prazo: arianaRule.prazo || '1 a 3 dias úteis',
      provider: 'configured',
      details: `Entrega Ariana Logística acima de ${arianaTier1Km} km até ${arianaTier2Km} km a partir do CEP ${arianaRule.localOriginCep || arianaRule.freeCepStart || '39740-000'}.`,
      metadata: { rule: 'ariana_entrega_30_120km', distanceKm, destinationCep },
      deadlineDays: parsePrazoToDeadlineDays(arianaRule.prazo || '1 a 3 dias úteis')
    }));
  }

  if (false && usesArianaLogistics && !usesArianaLocalRule && !hasPhoneFlatDelivery && snRule.enabled !== false && !hasArianaFree && distanceKm > 0 && distanceKm <= Number(snRule.maxKmTier1 || 40)) {
    options.push(buildManualShippingOption({
      service: 'sn_digital_ate_40km',
      label: snRule.label || 'SN Digital',
      price: Number(snRule.priceTier1 || 120),
      prazo: snRule.prazo || '1 a 3 dias úteis',
      provider: 'configured',
      details: `SN Digital até ${Number(snRule.maxKmTier1 || 40)} km.`,
      metadata: { rule: 'sn_digital_ate_40km', distanceKm },
      deadlineDays: parsePrazoToDeadlineDays(snRule.prazo || '1 a 3 dias úteis')
    }));
  }
  if (false && usesArianaLogistics && !usesArianaLocalRule && !hasPhoneFlatDelivery && snRule.enabled !== false && !hasArianaFree && distanceKm > Number(snRule.maxKmTier1 || 40) && distanceKm <= Number(snRule.maxKmTier2 || 70)) {
    options.push(buildManualShippingOption({
      service: 'sn_digital_40_70km',
      label: snRule.label || 'SN Digital',
      price: Number(snRule.priceTier2 || 190),
      prazo: snRule.prazo || '1 a 3 dias úteis',
      provider: 'configured',
      details: `SN Digital de ${Number(snRule.maxKmTier1 || 40)} até ${Number(snRule.maxKmTier2 || 70)} km.`,
      metadata: { rule: 'sn_digital_40_70km', distanceKm },
      deadlineDays: parsePrazoToDeadlineDays(snRule.prazo || '1 a 3 dias úteis')
    }));
  }
  let rodocapAvailable = false;
  let rodocapEligibleByDistance = false;
  let rodocapCityAllowed = false;
  const rodocapMinKmExclusive = Number(process.env.RODOCAP_MIN_KM_EXCLUSIVE || rodocapRule.minKmExclusive || arianaTier2Km || 70);
  const rodocapEnvFlag = String(process.env.RODOCAP_ENABLED || '').trim().toLowerCase();
  const rodocapEnabled =
    rodocapEnvFlag === 'true' ||
    (rodocapEnvFlag !== 'false' && rodocapRule.enabled !== false);

  const correiosLimitWeightKg = Number(settings.carriers?.correios?.maxWeightKg || settings.correios?.maxWeightKg || 30);
  const correiosLimitDimensionCm = Number(settings.carriers?.correios?.maxDimensionCm || settings.correios?.maxDimensionCm || 100);
  const exceedsCorreiosLimit =
    (Number(weightKg || 0) > correiosLimitWeightKg) ||
    (Number(maxDimensionCm || 0) > correiosLimitDimensionCm);

  // Rodocap entra como fallback quando Correios não atende por peso/dimensão.
  // Mantém Correios como preferência para produtos dentro do limite, mas não deixa o cálculo parar no aviso dos Correios.
  const rodocapShouldTryByCorreiosLimit = exceedsCorreiosLimit;
  const rodocapShouldTryByDistance = Number(distanceKm || 0) > rodocapMinKmExclusive;
  const shouldTryRodocap =
    usesArianaLogistics &&
    !hasPhoneFlatDelivery &&
    rodocapEnabled &&
    !hasArianaFree &&
    !hasArianaDistanceDelivery &&
    rodocapShouldTryByCorreiosLimit &&
    destinationCep;

  if (shouldTryRodocap) {
    rodocapEligibleByDistance = rodocapShouldTryByDistance || rodocapShouldTryByCorreiosLimit;
    const allowedCity = isRodocapCityAllowed(location.city, rodocapRule);
    rodocapCityAllowed = allowedCity;
    if (allowedCity) {
      const rodocapPercent = Number(rodocapRule.percentOfInvoice || 0.12);
      const rodocapPrice = Number((productPrice * rodocapPercent).toFixed(2));
      rodocapAvailable = Number.isFinite(rodocapPrice) && rodocapPrice > 0;

      if (rodocapAvailable) {
        options.push(buildManualShippingOption({
          service: 'rodocap_12_percent',
          label: rodocapRule.label || 'Rodocap',
          price: rodocapPrice,
          prazo: rodocapRule.prazoPadrao || 'sob consulta',
          provider: 'configured',
          details: `Rodocap acionada porque Correios não atende acima de ${correiosLimitWeightKg}kg ou ${correiosLimitDimensionCm}cm no maior lado.`,
          metadata: {
            rule: 'rodocap_fallback_correios_limit',
            percentOfInvoice: rodocapPercent,
            distanceKm,
            rodocapMinKmExclusive,
            exceedsCorreiosLimit,
            weightKg,
            maxDimensionCm,
            destinationCity: location.city || null,
            destinationState: location.state || null,
            destinationCep: destinationCep || null,
            locationSource: location.source
          },
          deadlineDays: parsePrazoToDeadlineDays(rodocapRule.prazoPadrao || '')
        }));
      } else {
        options.push({
          service: 'rodocap_unavailable_price',
          label: rodocapRule.label || 'Rodocap',
          unavailable: true,
          provider: 'configured',
          error: 'Rodocap não calculada porque o valor da nota/produto não foi informado.',
          metadata: { rule: 'rodocap_price_check', productPrice, destinationCep }
        });
      }
    } else if (process.env.RODOCAP_DEBUG === 'true') {
      options.push({
        service: 'rodocap_unavailable_city',
        label: rodocapRule.label || 'Rodocap',
        unavailable: true,
        provider: 'configured',
        error: location.city ? `Rodocap não atende a cidade ${location.city}.` : 'Rodocap depende da cidade do destino e essa cidade não foi identificada.',
        metadata: { rule: 'rodocap_city_check', destinationCity: location.city || null, destinationState: location.state || null, destinationCep: destinationCep || null, locationSource: location.source }
      });
    }
  }

  const frenet = settings.carriers?.frenet || {};
  const correiosMaxWeightKgForFrenet = Number(settings.carriers?.correios?.maxWeightKg || 30);
  const correiosMaxDimensionCmForFrenet = Number(settings.carriers?.correios?.maxDimensionCm || 100);
  const needsFrenetByCorreiosLimit =
    (Number(weightKg || 0) > correiosMaxWeightKgForFrenet) ||
    (Number(maxDimensionCm || 0) > correiosMaxDimensionCmForFrenet);

  // Frenet entra quando o produto estoura o limite dos Correios OU quando a Rodocap não atende o destino.
  const needsFrenetByRodocapUnavailable = rodocapEligibleByDistance && !rodocapAvailable;
  const frenetAllowed =
    !hasPhoneFlatDelivery &&
    !hasArianaFree &&
    !hasArianaDistanceDelivery &&
    !rodocapAvailable &&
    (needsFrenetByCorreiosLimit || needsFrenetByRodocapUnavailable) &&
    frenet.enabled !== false &&
    String(frenet.token || process.env.FRENET_TOKEN || process.env.FRENET_API_TOKEN || '').trim() &&
    destinationCep;

  if (frenetAllowed) {
    try {
      const quoted = await quoteFrenet(body, settings);
      if (Array.isArray(quoted.quotes)) {
        options.push(...quoted.quotes.map((q) => ({
          service: q.service,
          label: q.label || q.name || 'Frenet',
          name: q.name || q.label || 'Frenet',
          price: Number(q.price),
          prazo: q.prazo || (q.deadlineDays ? `${q.deadlineDays} dia(s) úteis` : 'sob consulta'),
          deadlineDays: q.deadlineDays || parsePrazoToDeadlineDays(q.prazo || ''),
          provider: 'frenet',
          raw: q.raw || null
        })).filter((q) => Number.isFinite(q.price) && q.price > 0));
      }
      if (Array.isArray(quoted.errors) && quoted.errors.length && process.env.FRENET_DEBUG === 'true') {
        options.push(...quoted.errors.slice(0, 3).map((q) => ({
          service: q.service || 'frenet_unavailable',
          label: q.label || 'Frenet',
          unavailable: true,
          provider: 'frenet',
          error: q.error || 'Serviço indisponível na Frenet.',
          raw: q.raw || null
        })));
      }
    } catch (error) {
      options.push({ service: 'frenet_error', label: 'Frenet', unavailable: true, provider: 'frenet', error: error.message || 'Erro ao cotar Frenet.' });
    }
  }

  const correios = settings.carriers?.correios || {};
  let correiosAvailable = false;
  let correiosAttempted = false;
  let correiosFailureReason = '';

  const correiosAllowed =
    !hasPhoneFlatDelivery &&
    !hasArianaFree &&
    !hasArianaDistanceDelivery &&
    correios.enabled !== false &&
    weightKg > 0 &&
    weightKg <= Number(correios.maxWeightKg || 30) &&
    maxDimensionCm > 0 &&
    maxDimensionCm <= Number(correios.maxDimensionCm || 100);

  if (correiosAllowed) {
    correiosAttempted = true;
    try {
      const quoted = await quoteCorreios(body, settings);
      const validCorreiosQuotes = Array.isArray(quoted.quotes)
        ? quoted.quotes
          .map(q => ({
            service: q.service,
            label: q.label || q.name || 'Correios',
            price: Number(q.price),
            prazo: q.prazo || (q.deadlineDays ? `${q.deadlineDays} dia(s) úteis` : 'sob consulta'),
            deadlineDays: q.deadlineDays || parsePrazoToDeadlineDays(q.prazo || ''),
            provider: 'correios',
            raw: q.raw || null
          }))
          .filter(q => Number.isFinite(q.price) && q.price > 0)
        : [];

      if (validCorreiosQuotes.length) {
        correiosAvailable = true;
        options.push(...validCorreiosQuotes);
      } else {
        correiosFailureReason =
          quoted?.errors?.[0]?.message ||
          quoted?.errors?.[0]?.error ||
          'Os Correios não retornaram serviço válido para este produto e CEP.';
      }
    } catch (error) {
      correiosFailureReason = error?.message || 'Erro ao consultar os Correios.';
    }
  } else if (!hasPhoneFlatDelivery && !hasArianaFree && !hasArianaDistanceDelivery) {
    correiosFailureReason = `Produto fora dos limites dos Correios: máximo de ${Number(correios.maxWeightKg || 30)} kg e ${Number(correios.maxDimensionCm || 100)} cm no maior lado.`;
  }

  // Se os Correios não se encaixarem ou não devolverem uma cotação válida,
  // tenta Rodocap a 12% do valor da mercadoria.
  if (
    !hasPhoneFlatDelivery &&
    !hasArianaFree &&
    !hasArianaDistanceDelivery &&
    !correiosAvailable &&
    !rodocapAvailable &&
    rodocapEnabled &&
    destinationCep
  ) {
    rodocapEligibleByDistance = true;
    const allowedCity = isRodocapCityAllowed(location.city, rodocapRule);
    rodocapCityAllowed = allowedCity;

    if (allowedCity) {
      const rodocapPercent = Number(rodocapRule.percentOfInvoice || 0.12);
      const rodocapPrice = Number((productPrice * rodocapPercent).toFixed(2));

      if (Number.isFinite(rodocapPrice) && rodocapPrice > 0) {
        rodocapAvailable = true;
        options.push(buildManualShippingOption({
          service: 'rodocap_12_percent',
          label: rodocapRule.label || 'Rodocap',
          price: rodocapPrice,
          prazo: rodocapRule.prazoPadrao || 'sob consulta',
          provider: 'configured',
          details: 'Rodocap acionada porque os Correios não atenderam este produto/CEP.',
          metadata: {
            rule: 'rodocap_fallback_after_correios',
            percentOfInvoice: rodocapPercent,
            correiosAttempted,
            correiosFailureReason,
            weightKg,
            maxDimensionCm,
            distanceKm,
            destinationCity: location.city || null,
            destinationState: location.state || null,
            destinationCep
          },
          deadlineDays: parsePrazoToDeadlineDays(rodocapRule.prazoPadrao || '')
        }));
      }
    }
  }

  // Total Express é o último fallback: só entra quando Ariana, Correios e Rodocap não atenderam.
  const totalExpress = settings.carriers?.totalExpress || {};
  if (
    !hasPhoneFlatDelivery &&
    !hasArianaFree &&
    !hasArianaDistanceDelivery &&
    !correiosAvailable &&
    !rodocapAvailable &&
    totalExpress.enabled !== false
  ) {
    const base = Number(
      totalExpress.basePrice ||
      settings.totalExpressBasePrice ||
      process.env.TOTAL_EXPRESS_BASE_PRICE ||
      0
    );
    if (base > 0) {
      options.push(buildManualShippingOption({
        service: 'total_express',
        label: totalExpress.label || 'Total Express',
        price: base,
        prazo: totalExpress.prazo || settings.totalExpressPrazo || 'sob consulta',
        provider: 'configured',
        metadata: {
          rule: 'total_express_last_fallback',
          correiosFailureReason,
          rodocapCityAllowed,
          weightKg,
          maxDimensionCm,
          distanceKm
        }
      }));
    }
  }

  if (
    correiosFailureReason &&
    !correiosAvailable &&
    !rodocapAvailable &&
    !options.some((o) => o && !o.unavailable)
  ) {
    options.push({
      service: 'shipping_unavailable',
      label: 'Frete',
      unavailable: true,
      provider: 'configured',
      error: correiosFailureReason,
      metadata: { weightKg, maxDimensionCm, destinationCep }
    });
  }

  const ownDelivery = settings.carriers?.ownDelivery || {};
  if (!hasPhoneFlatDelivery && !hasArianaFree && !usesArianaLocalRule && !isSNDigital && ownDelivery.enabled && Number(distanceKm || 0) > 0) {
    const own = calculateOwnDelivery(distanceKm, ownDelivery.tiers || []);
    if (own.available) options.push(buildManualShippingOption({ service: 'own_delivery', label: 'Entrega Própria', price: own.price, prazo: '1 a 3 dias úteis', provider: 'configured' }));
  }

  const shippingPriority = (option = {}) => {
    const txt = `${option.provider || ''} ${option.service || ''} ${option.label || ''} ${option.name || ''}`.toLowerCase();

    // 1) Ariana Entrega / frete local
    if (
      txt.includes('ariana') ||
      txt.includes('free_local') ||
      txt.includes('own_delivery') ||
      txt.includes('entrega propria') ||
      txt.includes('entrega própria')
    ) return 1;

    // 2) Correios: preferência depois que Ariana Entrega não se encaixar
    if (
      txt.includes('correios') ||
      txt.includes('pac') ||
      txt.includes('sedex') ||
      txt.includes('03298') ||
      txt.includes('03328') ||
      txt.includes('03220') ||
      txt.includes('03212')
    ) return 2;

    // 3) Rodocap: apenas para pesado/grande acima de 70km
    if (txt.includes('rodocap')) return 3;

    // 4) Total Express: último fallback configurado
    if (txt.includes('total_express') || txt.includes('total express')) return 4;

    // 5) Frenet: compatibilidade com a integração de transportadoras
    if (txt.includes('frenet')) return 5;

    return 99;
  };

  options.sort((a, b) => {
    const pa = shippingPriority(a);
    const pb = shippingPriority(b);
    if (pa !== pb) return pa - pb;
    return Number(a.price ?? 1e9) - Number(b.price ?? 1e9);
  });

  const normalizedOptions = options.map((option) => ({
    ...option,
    name: option.name || option.label || 'Logística',
    prazo: option.prazo || (option.deadlineDays ? `${option.deadlineDays} dia(s) úteis` : null),
    deliveryTime: option.prazo || (option.deadlineDays ? `${option.deadlineDays} dia(s) úteis` : null),
    prazoEntrega: option.prazo || (option.deadlineDays ? `${option.deadlineDays} dia(s) úteis` : null),
    deadlineDays: option.deadlineDays || parsePrazoToDeadlineDays(option.prazo || ''),
    priority: shippingPriority(option)
  }));
  const quotes = normalizedOptions.filter((o) => !o.unavailable && Number.isFinite(Number(o.price)));
  const cheapest = quotes[0] || null;
  const montagemCost = Number((productPrice * Number(settings.montagemPercent || 0.12)).toFixed(2));
  return {
    ok: true,
    options: normalizedOptions,
    quotes,
    cheapest,
    bestQuote: cheapest,
    montagemCost,
    context: {
      sellerDetected: sellerCtx.raw || null,
      isAriana,
      isLocalSellerOrigin,
      usesArianaLocalRule,
      isPhoneProduct,
      isSNDigital,
      usesArianaLogistics,
      rodocapEligibleByDistance,
      rodocapAvailable,
      rodocapCityAllowed,
      needsFrenetByCorreiosLimit,
      destinationCity: location.city || null,
      destinationState: location.state || null,
      destinationCep: destinationCep || null,
      locationSource: location.source,
      distanceKm,
      weightKg,
      maxDimensionCm
    },
    settingsUsed: {
      montagemPercent: settings.montagemPercent,
      correios: settings.correios || {},
      businessRules: settings.businessRules || {},
      carriers: settings.carriers || {}, frenet: settings.carriers?.frenet ? { ...settings.carriers.frenet, token: settings.carriers.frenet.token ? '[redacted]' : '' } : {}
    }
  };
}
async function buildMercadoPagoHeaders() { const settings = await getPaymentsSettings(); const accessToken = settings.mercadopago?.accessToken || process.env.MP_ACCESS_TOKEN || ''; if (!accessToken) throw new Error('Mercado Pago access token não configurado.'); return { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }; }
async function createMercadoPagoPayment(payload) { const headers = await buildMercadoPagoHeaders(); const idempotencyKey = uid('mp'); const response = await axios.post('https://api.mercadopago.com/v1/payments', payload, { headers: { ...headers, 'X-Idempotency-Key': idempotencyKey }, timeout: 30000, validateStatus: () => true }); return { response, idempotencyKey }; }
async function createPagarmeOrder(payload) { const settings = await getPaymentsSettings(); const apiKey = settings.pagarme?.apiKey || process.env.PAGARME_API_KEY || ''; const endpoint = settings.pagarme?.endpoint || 'https://api.pagar.me/core/v5'; if (!apiKey) throw new Error('Pagar.me API key não configurada.'); return axios.post(`${endpoint}/orders`, payload, { auth: { username: apiKey, password: '' }, headers: { 'Content-Type': 'application/json' }, timeout: 30000, validateStatus: () => true }); }

async function createPagarmeRecipient(payload) {
  const settings = await getPaymentsSettings();
  const apiKey = settings.pagarme?.apiKey || process.env.PAGARME_API_KEY || '';
  const endpoint = String(settings.pagarme?.endpoint || process.env.PAGARME_API_URL || 'https://api.pagar.me/core/v5').replace(/\/+$/, '');
  if (!apiKey) throw new Error('Pagar.me API key não configurada.');
  return axios.post(`${endpoint}/recipients`, payload, {
    auth: { username: apiKey, password: '' },
    headers: { 'Content-Type': 'application/json' },
    timeout: 30000,
    validateStatus: () => true
  });
}

function normalizePagarmeAccountType(value = '') {
  const raw = String(value || '').toLowerCase();
  if (raw.includes('poup')) return 'savings';
  if (raw.includes('saving')) return 'savings';
  return 'checking';
}

function normalizePagarmeHolderType(document = '', explicit = '') {
  const raw = String(explicit || '').toLowerCase();
  if (raw === 'company' || raw === 'corporation' || raw === 'cnpj') return 'company';
  const digits = cleanPhone(document);
  return digits.length > 11 ? 'company' : 'individual';
}

function normalizePagarmeBankCode(value = '') {
  const raw = String(value || '').trim();
  const digits = cleanPhone(raw);
  if (digits) return digits.padStart(3, '0').slice(-3);

  const normalized = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  const bankMap = {
    'itau': '341',
    'itau unibanco': '341',
    'banco do brasil': '001',
    'bb': '001',
    'bradesco': '237',
    'caixa': '104',
    'caixa economica': '104',
    'santander': '033',
    'nubank': '260',
    'nu pagamentos': '260',
    'inter': '077',
    'banco inter': '077',
    'mercado pago': '323',
    'sicredi': '748',
    'sicoob': '756'
  };

  return bankMap[normalized] || '';
}

function getSellerNormalizedBankForPagarme(meta = {}) {
  const bankObject = meta.bankAccount && typeof meta.bankAccount === 'object' ? meta.bankAccount : {};
  const legacyBankAccount = meta.bankAccount && typeof meta.bankAccount !== 'object' ? String(meta.bankAccount) : '';

  return normalizeSellerBankFields({
    bank: meta.bankCode || meta.bank || meta.bankName || meta.banco || bankObject.bank || bankObject.bankName || '',
    bankName: meta.bankName || meta.bank || meta.banco || bankObject.bankName || bankObject.bank || '',
    agency: meta.branchNumber || meta.agency || meta.agencia || meta.bankAgency || bankObject.branchNumber || bankObject.agency || bankObject.bankAgency || '',
    agencyDigit: meta.branchCheckDigit || meta.agencyDigit || meta.agenciaDigito || bankObject.branchCheckDigit || bankObject.agencyDigit || '',
    account: meta.accountNumber || meta.bankAccountNumber || meta.conta || legacyBankAccount || bankObject.accountNumber || bankObject.bankAccountNumber || bankObject.account || bankObject.number || '',
    accountDigit: meta.accountCheckDigit || meta.accountDigit || meta.contaDigito || bankObject.accountCheckDigit || bankObject.accountDigit || bankObject.contaDigito || '',
    pixKey: meta.pixKey || meta.chavePix || bankObject.pixKey || '',
    accountType: meta.accountType || meta.bankAccountType || meta.tipoConta || bankObject.accountType || bankObject.bankAccountType || ''
  });
}

function buildPagarmeRecipientPayloadFromSeller(seller = {}, body = {}) {
  const meta = { ...(seller.metadata || {}), ...(body || {}) };
  const bankFields = getSellerNormalizedBankForPagarme(meta);
  const document = cleanPhone(meta.document || meta.cpfCnpj || meta.cpf || meta.cnpj || seller.document || '');
  const holderDocument = cleanPhone(meta.bankHolderDocument || meta.holderDocument || meta.cpfCnpjTitular || meta.documentTitular || document || '');
  const holderName = String(meta.bankHolderName || meta.holderName || meta.legalName || meta.razaoSocial || meta.name || seller.storeName || seller.displayName || '').trim();
  const name = String(meta.legalName || meta.razaoSocial || meta.name || seller.storeName || seller.displayName || holderName || 'Seller Ariana Móveis').trim();
  const email = String(meta.email || seller.email || '').trim().toLowerCase();
  const bank = normalizePagarmeBankCode(meta.bankCode || meta.bank || meta.bankName || meta.banco || bankFields.bank || bankFields.bankName || '');
  const branchNumber = cleanPhone(bankFields.branchNumber || bankFields.agency || meta.branchNumber || meta.agency || meta.agencia || meta.bankAgency || '');
  const branchCheckDigit = cleanPhone(bankFields.branchCheckDigit || bankFields.agencyDigit || meta.branchCheckDigit || meta.agencyDigit || meta.agenciaDigito || '');
  const accountNumber = cleanPhone(bankFields.accountNumber || meta.accountNumber || '');
  const accountCheckDigit = cleanPhone(bankFields.accountCheckDigit || bankFields.accountDigit || meta.accountCheckDigit || meta.contaDigito || meta.accountDigit || '');
  const required = [];
  if (!document) required.push('CPF/CNPJ do seller');
  if (!email) required.push('e-mail do seller');
  if (!holderName) required.push('nome do titular da conta');
  if (!holderDocument) required.push('CPF/CNPJ do titular da conta');
  if (!bank) required.push('código do banco');
  if (!branchNumber) required.push('agência');
  if (!accountNumber) required.push('conta bancária');
  if (!accountCheckDigit) required.push('dígito da conta');
  if (required.length) {
    const err = new Error(`Dados insuficientes para criar Recipient Pagar.me: ${required.join(', ')}.`);
    err.requiredFields = required;
    throw err;
  }
  const holderType = normalizePagarmeHolderType(holderDocument, meta.holderType || meta.bankHolderType);
  const sellerType = normalizePagarmeHolderType(document, meta.type || meta.recipientType);
  const payload = {
    name: name.slice(0, 128),
    email,
    document,
    type: sellerType,
    default_bank_account: {
      holder_name: holderName.slice(0, 128),
      holder_type: holderType,
      holder_document: holderDocument,
      bank,
      branch_number: branchNumber,
      account_number: accountNumber,
      account_check_digit: accountCheckDigit,
      type: normalizePagarmeAccountType(bankFields.accountType || meta.accountType || meta.bankAccountType || meta.tipoConta || 'checking')
    },
    transfer_settings: {
      transfer_enabled: true,
      transfer_interval: String(meta.transferInterval || 'daily'),
      transfer_day: Number(meta.transferDay || 0)
    },
    metadata: {
      sellerId: String(seller.sellerId || seller._id || ''),
      platform: 'Ariana Móveis'
    }
  };
  if (branchCheckDigit) payload.default_bank_account.branch_check_digit = branchCheckDigit;
  return payload;
}

function normalizePagarmeRecipientResponse(data = {}) {
  return {
    id: String(data.id || data.recipient_id || data.recipientId || ''),
    status: String(data.status || data.registration_status || ''),
    raw: data
  };
}

function isArianaOwnSellerId(value = '') {
  const raw = String(value || '').trim();
  const norm = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return !raw || norm === 'ariana' || norm === 'ariana moveis' || norm === 'ariana_moveis' || norm === 'loja' || norm === 'loja propria';
}


// ============================================================
// SPLIT MARKETPLACE - Sellers / Pagar.me / Cielo / Mercado Pago
// Regra Ariana: seller recebe líquido, Ariana fica com comissão + etiqueta
// quando a etiqueta/logística foi gerada pelo marketplace.
// ============================================================
function round2(value = 0) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function paymentSplitCents(value = 0) {
  return Math.max(0, Math.round(Number(value || 0) * 100));
}

function getMarketplaceCommissionPercent(settings = {}, seller = null) {
  const meta = seller?.metadata || {};
  const fromSeller = meta.commissionPercent ?? meta.marketplaceCommissionPercent ?? seller?.commissionPercent;
  const fromSettings = settings?.marketplaceFeePercent ?? settings?.commissionPercent;
  return Number(fromSeller ?? fromSettings ?? process.env.MARKETPLACE_COMMISSION_PERCENT ?? 12) || 12;
}

function sellerItemGross(order = {}, sellerId = '') {
  const sid = String(sellerId || '').trim();
  const items = ensureArray(order.items);
  const sellerItems = sid ? items.filter((item) => String(item?.sellerId || item?.seller_id || '').trim() === sid) : items;

  // REGRA DO MARKETPLACE:
  // O repasse do seller sempre usa o preço base cadastrado pelo seller.
  // Não entra aqui:
  // - acréscimo de cartão/parcelamento;
  // - frete/etiqueta logística da Ariana;
  // - outros valores cobrados do cliente para cobrir operação.
  const gross = sellerItems.reduce((acc, item) => {
    const qty = Math.max(1, Number(item?.qty || item?.quantity || 1) || 1);

    const sellerBaseTotal =
      item?.sellerBaseTotal ??
      item?.seller_base_total ??
      item?.sellerBaseAmount ??
      item?.seller_base_amount ??
      null;

    if (sellerBaseTotal !== null && sellerBaseTotal !== undefined && sellerBaseTotal !== '') {
      return acc + Number(sellerBaseTotal || 0);
    }

    const sellerBaseUnit =
      item?.sellerBaseUnitPrice ??
      item?.seller_base_unit_price ??
      item?.sellerBasePrice ??
      item?.seller_base_price ??
      item?.pixPrice ??
      item?.precoPix ??
      null;

    if (sellerBaseUnit !== null && sellerBaseUnit !== undefined && sellerBaseUnit !== '') {
      return acc + (Number(sellerBaseUnit || 0) * qty);
    }

    // Último recurso para pedidos antigos: usa o total do item.
    // Em pedidos novos, sellerBaseTotal deve estar preenchido.
    const total = item?.totalPrice ?? item?.total ?? null;
    if (total !== null && total !== undefined && total !== '') return acc + Number(total || 0);
    return acc + (Number(item?.unitPrice ?? item?.price ?? 0) * qty);
  }, 0);

  return round2(gross || 0);
}

async function getMarketplaceLabelFeeForOrder(order = {}, sellerId = '') {
  try {
    const oid = String(order?._id || order?.id || '').trim();
    if (!oid || typeof LogisticsLabel === 'undefined') return 0;
    const label = await LogisticsLabel.findOne({
      $or: [
        { orderId: oid },
        ...(normalizeObjectId(oid) ? [{ orderObjectId: normalizeObjectId(oid) }] : [])
      ]
    }).sort({ createdAt: -1 });
    if (!label) return 0;
    const provider = String(label.provider || '').toLowerCase();
    const marketplaceProviders = ['manual', 'ariana_local', 'correios', 'frenet', 'rodocap', 'marketplace'];
    if (!marketplaceProviders.some((p) => provider.includes(p))) return 0;
    return round2(label.shippingCost || 0);
  } catch (_error) {
    return 0;
  }
}

async function buildSellerSplitSummary(orderDoc = null, explicitSellerId = '') {
  const order = toJSON(orderDoc) || orderDoc || {};
  const rawSellerIds = explicitSellerId ? [String(explicitSellerId).trim()] : extractSellerIdsFromOrder(order);
  const sellerIds = rawSellerIds.map((id) => String(id || '').trim()).filter((id) => id && !isArianaOwnSellerId(id));
  const settings = await getPaymentsSettings();
  const results = [];
  for (const sellerId of sellerIds) {
    const seller = await Seller.findOne({ sellerId }) || await Seller.findById(normalizeObjectId(sellerId)).catch(() => null);
    if (!seller) continue;
    const gross = sellerItemGross(order, sellerId);
    const commissionPercent = getMarketplaceCommissionPercent(settings?.pagarme || {}, seller);
    const commission = round2(gross * commissionPercent / 100);
    const labelFee = await getMarketplaceLabelFeeForOrder(order, sellerId);

    // O seller NÃO paga o frete/etiqueta da Ariana no split.
    // Seller recebe: preço base do produto - comissão.
    // Ariana recebe no split: comissão + todo o restante do pedido
    // (frete cobrado do cliente, acréscimo de cartão/parcelamento e arredondamentos).
    const marketplaceAmount = round2(commission);
    const sellerNet = round2(Math.max(0, gross - commission));
    const meta = seller?.metadata || {};
    const pagarmeRecipientId = String(
      meta.pagarmeRecipientId ||
      meta.pagarme_recipient_id ||
      meta.recipientId ||
      meta.recipient_id ||
      meta.pagarme?.recipientId ||
      meta.pagarme?.recipient_id ||
      meta.payment?.recipientId ||
      meta.payment?.recipient_id ||
      meta.paymentSplit?.recipientId ||
      meta.paymentSplit?.recipient_id ||
      seller?.pagarmeRecipientId ||
      seller?.pagarme_recipient_id ||
      seller?.recipientId ||
      seller?.recipient_id ||
      seller?.pagarme?.recipientId ||
      seller?.pagarme?.recipient_id ||
      seller?.payment?.recipientId ||
      seller?.payment?.recipient_id ||
      seller?.paymentSplit?.recipientId ||
      seller?.paymentSplit?.recipient_id ||
      ''
    ).trim();
    results.push({
      sellerId,
      sellerName: seller?.storeName || seller?.displayName || '',
      gateway: 'pagarme',
      gross,
      commissionPercent,
      commission,
      marketplaceLabelFee: labelFee,
      marketplaceAmount,
      sellerNet,
      recipients: { pagarme: pagarmeRecipientId },
      splitReady: !!pagarmeRecipientId
    });
  }
  const totalGross = round2(results.reduce((a, r) => a + r.gross, 0));
  const totalCommission = round2(results.reduce((a, r) => a + r.commission, 0));
  const totalLabelFee = round2(results.reduce((a, r) => a + r.marketplaceLabelFee, 0));
  const totalMarketplaceAmount = round2(results.reduce((a, r) => a + r.marketplaceAmount, 0));
  const totalSellerNet = round2(results.reduce((a, r) => a + r.sellerNet, 0));
  const orderTotal = round2(order.total || 0);
  const orderShippingCost = round2(order.shippingCost || order.shipping?.cost || order.shipping?.price || 0);
  const totalCardMarkup = round2(ensureArray(order.items).reduce((sum, item) => sum + Number(item?.cardMarkupTotal || 0), 0));
  const marketplaceRemainder = round2(Math.max(0, orderTotal - totalSellerNet - totalMarketplaceAmount));
  const missingPagarmeRecipients = results.filter((r) => !r.recipients?.pagarme).map((r) => ({ sellerId: r.sellerId, sellerName: r.sellerName }));
  return {
    ok: true,
    gateway: 'pagarme',
    orderId: String(order._id || order.id || ''),
    sellers: results,
    totalGross,
    totalCommission,
    totalLabelFee,
    totalMarketplaceAmount,
    totalSellerNet,
    orderTotal,
    orderShippingCost,
    totalCardMarkup,
    marketplaceRemainder,
    splitRequired: results.length > 0,
    splitReady: missingPagarmeRecipients.length === 0,
    missingPagarmeRecipients
  };
}
function getPagarmePayloadTotalCents(payload = {}) {
  const items = ensureArray(payload.items);
  const totalFromItems = items.reduce((sum, item) => {
    const amount = Number(item?.amount || 0);
    const quantity = Math.max(1, Number(item?.quantity || 1) || 1);
    return sum + (Number.isFinite(amount) ? amount * quantity : 0);
  }, 0);
  if (totalFromItems > 0) return Math.round(totalFromItems);

  const charges = ensureArray(payload.charges);
  const totalFromCharges = charges.reduce((sum, charge) => {
    const amount = Number(charge?.amount || 0);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
  if (totalFromCharges > 0) return Math.round(totalFromCharges);

  const payments = ensureArray(payload.payments);
  const totalFromPayments = payments.reduce((sum, payment) => {
    const amount = Number(payment?.amount || payment?.value || 0);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
  return Math.round(totalFromPayments || 0);
}

function applyPagarmeSplitToPayload(payload = {}, splitSummary = {}) {
  const settings = payload.settings || {};
  const marketplaceRecipientId = String(settings.marketplaceRecipientId || process.env.PAGARME_MARKETPLACE_RECIPIENT_ID || '').trim();
  const sellers = ensureArray(splitSummary.sellers);

  // Venda própria da Ariana: não precisa split de seller.
  if (!sellers.length) return payload;

  if (!marketplaceRecipientId) {
    throw new Error('PAGARME_MARKETPLACE_RECIPIENT_ID não configurado para receber a comissão da Ariana.');
  }

  const missing = sellers
    .filter((item) => !item.recipients?.pagarme)
    .map((item) => item.sellerName || item.sellerId)
    .filter(Boolean);

  if (missing.length) {
    throw new Error(`Seller sem Recipient ID Pagar.me. Configure antes de vender: ${missing.join(', ')}.`);
  }

  const payloadTotalCents = getPagarmePayloadTotalCents(payload);
  if (!payloadTotalCents || payloadTotalCents <= 0) {
    throw new Error('Total do pedido Pagar.me inválido para montar split.');
  }

  let sellerSplitItems = [];
  for (const item of sellers) {
    if (item.recipients?.pagarme && Number(item.sellerNet || 0) > 0) {
      sellerSplitItems.push({
        amount: paymentSplitCents(item.sellerNet),
        recipient_id: item.recipients.pagarme,
        type: 'flat',
        options: {
          liable: true,
          charge_processing_fee: false,
          charge_remainder_fee: false
        }
      });
    }
  }

  let marketplaceAmountCents = paymentSplitCents(splitSummary.totalMarketplaceAmount || 0);
  let rawTotalSplitCents = sellerSplitItems.reduce((sum, item) => sum + Number(item.amount || 0), 0) + marketplaceAmountCents;

  // O Pagar.me exige que a soma do split seja exatamente igual ao valor do pedido.
  // Se algum preço antigo vier inflado, o split é redimensionado proporcionalmente para o total real cobrado.
  if (rawTotalSplitCents > payloadTotalCents) {
    const factor = payloadTotalCents / rawTotalSplitCents;
    sellerSplitItems = sellerSplitItems.map((item) => ({
      ...item,
      amount: Math.max(0, Math.floor(Number(item.amount || 0) * factor))
    })).filter((item) => item.amount > 0);

    const sellerScaledCents = sellerSplitItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    marketplaceAmountCents = Math.max(0, payloadTotalCents - sellerScaledCents);
  } else if (rawTotalSplitCents < payloadTotalCents) {
    marketplaceAmountCents += payloadTotalCents - rawTotalSplitCents;
  }

  let split = [...sellerSplitItems];

  if (marketplaceAmountCents > 0) {
    split.push({
      amount: marketplaceAmountCents,
      recipient_id: marketplaceRecipientId,
      type: 'flat',
      options: {
        liable: false,
        charge_processing_fee: true,
        charge_remainder_fee: true
      }
    });
  }

  const finalTotal = split.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  if (finalTotal !== payloadTotalCents && split.length) {
    const diff = payloadTotalCents - finalTotal;
    split[split.length - 1].amount = Math.max(0, Number(split[split.length - 1].amount || 0) + diff);
  }

  split = split.filter((item) => Number(item.amount || 0) > 0);

  if (!split.length) {
    throw new Error('Split Pagar.me obrigatório, mas nenhum recebedor foi montado.');
  }

  const splitTotalCents = split.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  if (splitTotalCents !== payloadTotalCents) {
    throw new Error(`Split Pagar.me inválido: soma ${splitTotalCents} diferente do total ${payloadTotalCents}.`);
  }

  if (Array.isArray(payload.payments) && payload.payments.length) {
    payload.payments = payload.payments.map((payment) => ({ ...payment, split }));
  } else if (Array.isArray(payload.charges) && payload.charges.length) {
    payload.charges = payload.charges.map((charge) => ({ ...charge, split }));
  } else {
    payload.payments = [{ payment_method: 'credit_card', split }];
  }

  payload.metadata = {
    ...(payload.metadata || {}),
    splitApplied: true,
    splitGateway: 'pagarme',
    marketplaceRecipientId,
    marketplaceAmountCents: split.find((item) => item.recipient_id === marketplaceRecipientId)?.amount || 0,
    sellerSplitCents: split.filter((item) => item.recipient_id !== marketplaceRecipientId).reduce((sum, item) => sum + Number(item.amount || 0), 0),
    splitTotalCents,
    orderTotalCents: payloadTotalCents,
    splitRecipients: split.map((item) => item.recipient_id).join(',')
  };

  return payload;
}

async function buildCieloHeaders() {
  const settings = await getPaymentsSettings();
  const cielo = settings.cielo || {};
  const merchantId = String(cielo.merchantId || process.env.CIELO_MERCHANT_ID || '').trim();
  const merchantKey = String(cielo.merchantKey || process.env.CIELO_MERCHANT_KEY || '').trim();
  if (!merchantId || !merchantKey) throw new Error('Cielo MerchantId/MerchantKey não configurados.');
  return { MerchantId: merchantId, MerchantKey: merchantKey, 'Content-Type': 'application/json' };
}

async function createCieloSale(payload) {
  const settings = await getPaymentsSettings();
  const apiUrl = String(settings.cielo?.apiUrl || process.env.CIELO_API_URL || 'https://api.cieloecommerce.cielo.com.br').replace(/\/+$/, '');
  const headers = await buildCieloHeaders();
  return axios.post(`${apiUrl}/1/sales`, payload, { headers, timeout: 30000, validateStatus: () => true });
}

function applyCieloSplitToPayload(payload = {}, splitSummary = {}) {
  const marketplaceMerchantId = String(process.env.CIELO_MARKETPLACE_MERCHANT_ID || process.env.CIELO_SUBORDINATE_MARKETPLACE_ID || '').trim();
  const sellers = ensureArray(splitSummary.sellers);
  const splitPayments = [];
  for (const item of sellers) {
    if (item.recipients?.cielo && item.sellerNet > 0) {
      splitPayments.push({ SubordinateMerchantId: item.recipients.cielo, Amount: paymentSplitCents(item.sellerNet) });
    }
  }
  if (marketplaceMerchantId && splitSummary.totalMarketplaceAmount > 0) {
    splitPayments.push({ SubordinateMerchantId: marketplaceMerchantId, Amount: paymentSplitCents(splitSummary.totalMarketplaceAmount) });
  }
  if (splitPayments.length) {
    payload.Payment = { ...(payload.Payment || {}), SplitPayments: splitPayments };
  }
  return payload;
}


function moneyToCents(value = 0) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

function centsToMoney(value = 0) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n) / 100;
}

function splitPhoneBR(value = '') {
  const digits = cleanPhone(value || '');
  let local = digits;
  if (local.startsWith('55') && local.length >= 12) local = local.slice(2);
  const areaCode = local.length >= 10 ? local.slice(0, 2) : '';
  const number = local.length >= 10 ? local.slice(2) : local;
  return { country_code: '55', area_code: areaCode || '33', number: number || '999999999' };
}

function sanitizePagarmeStatementDescriptor(value = 'ARIANAMOVEIS') {
  return String(value || 'ARIANAMOVEIS')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .replace(/\s+/g, '')
    .slice(0, 13) || 'ARIANAMOVEIS';
}

function buildPagarmeCustomer(body = {}, order = null) {
  const customer = body.customer || {};
  const shippingAddress = order?.shippingAddress || body.address || body.shippingAddress || {};
  const name = String(customer.name || body.name || order?.customerName || 'Cliente Ariana Moveis').trim();
  const email = String(customer.email || body.email || order?.customerEmail || 'cliente@arianamoveis.com.br').trim().toLowerCase();
  const document = cleanPhone(customer.cpf || customer.document || body.cpf || order?.cpf || '');
  const phoneRaw = customer.phone || body.phone || order?.customerPhone || shippingAddress?.phone || '';
  const phone = splitPhoneBR(phoneRaw);

  return {
    name,
    email,
    document,
    type: 'individual',
    phones: {
      mobile_phone: phone
    }
  };
}

function buildPagarmeItems(body = {}, order = null) {
  const amount = moneyToCents(
    body.amount ||
    body.total ||
    body.transaction_amount ||
    body.transactionAmount ||
    order?.total ||
    order?.totalAmount ||
    order?.grandTotal ||
    order?.amount ||
    order?.orderTotal ||
    order?.summary?.total ||
    order?.payment?.amount ||
    order?.payment?.total ||
    0
  );
  const fallbackDescription = body.description || `Pedido Ariana Moveis ${String(body.orderId || order?._id || '').slice(-8)}`;
  return [{
    amount,
    description: String(fallbackDescription || 'Pedido Ariana Moveis').slice(0, 120),
    quantity: 1,
    code: String(body.orderId || order?._id || uid('order')).slice(0, 52)
  }];
}


function pickPagarmeAddressValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function buildPagarmeBillingAddress(body = {}, order = null) {
  const bodyAddress = body.billing_address || body.billingAddress || body.address || body.shippingAddress || {};
  const receiverAddress = body.receiver_address || body.receiverAddress || {};
  const orderAddress = order?.shippingAddress || order?.address || {};

  const zip = cleanPhone(pickPagarmeAddressValue(
    bodyAddress.zip_code, bodyAddress.zipCode, bodyAddress.zip, bodyAddress.cep,
    receiverAddress.zip_code, receiverAddress.zipCode, receiverAddress.zip, receiverAddress.cep,
    orderAddress.zip_code, orderAddress.zipCode, orderAddress.zip, orderAddress.cep,
    '39740000'
  )).slice(0, 8) || '39740000';

  const street = pickPagarmeAddressValue(
    bodyAddress.street_name, bodyAddress.street, bodyAddress.logradouro, bodyAddress.rua, bodyAddress.address,
    receiverAddress.street_name, receiverAddress.street, receiverAddress.logradouro, receiverAddress.rua, receiverAddress.address,
    orderAddress.street_name, orderAddress.street, orderAddress.logradouro, orderAddress.rua, orderAddress.address,
    'Olegario de Andrade'
  );

  const number = pickPagarmeAddressValue(
    bodyAddress.street_number, bodyAddress.number, bodyAddress.numero,
    receiverAddress.street_number, receiverAddress.number, receiverAddress.numero,
    orderAddress.street_number, orderAddress.number, orderAddress.numero,
    '54'
  );

  const neighborhood = pickPagarmeAddressValue(
    bodyAddress.neighborhood, bodyAddress.bairro,
    receiverAddress.neighborhood, receiverAddress.bairro,
    orderAddress.neighborhood, orderAddress.bairro,
    'Amazonas'
  );

  const city = pickPagarmeAddressValue(
    bodyAddress.city, bodyAddress.city_name, bodyAddress.cidade,
    receiverAddress.city, receiverAddress.city_name, receiverAddress.cidade,
    orderAddress.city, orderAddress.city_name, orderAddress.cidade,
    'Guanhaes'
  );

  const state = pickPagarmeAddressValue(
    bodyAddress.state, bodyAddress.federal_unit, bodyAddress.uf,
    receiverAddress.state, receiverAddress.federal_unit, receiverAddress.uf,
    orderAddress.state, orderAddress.federal_unit, orderAddress.uf,
    'MG'
  ).toUpperCase().slice(0, 2) || 'MG';

  const complement = pickPagarmeAddressValue(
    bodyAddress.line_2, bodyAddress.complement, bodyAddress.complemento, bodyAddress.apartment,
    receiverAddress.line_2, receiverAddress.complement, receiverAddress.complemento, receiverAddress.apartment,
    orderAddress.line_2, orderAddress.complement, orderAddress.complemento, orderAddress.apartment
  );

  return {
    line_1: `${number || 'S/N'}, ${street || 'Endereco'}, ${neighborhood || 'Bairro'}`.slice(0, 256),
    ...(complement ? { line_2: String(complement).slice(0, 128) } : {}),
    zip_code: zip,
    city: String(city || 'Guanhaes').slice(0, 64),
    state,
    country: 'BR'
  };
}

function getPagarmeGatewayMessage(pagarmeData = {}) {
  const charge = getPagarmeCharge(pagarmeData) || {};
  const tx = getPagarmeTransaction(pagarmeData) || {};
  const gatewayErrors = Array.isArray(tx.gateway_response?.errors)
    ? tx.gateway_response.errors.map((item) => item?.message || item?.code || '').filter(Boolean).join(' | ')
    : '';
  return String(
    tx.acquirer_message ||
    gatewayErrors ||
    tx.gateway_response?.message ||
    tx.message ||
    charge.status ||
    pagarmeData.status ||
    ''
  );
}

function getPagarmeCharge(responseData = {}) {
  const charges = Array.isArray(responseData.charges) ? responseData.charges : [];
  return charges[0] || null;
}

function getPagarmeTransaction(responseData = {}) {
  const charge = getPagarmeCharge(responseData) || {};
  const txs = Array.isArray(charge.last_transaction) ? charge.last_transaction : null;
  if (Array.isArray(txs)) return txs[0] || null;
  return charge.last_transaction || null;
}

function getPagarmeStatus(responseData = {}) {
  const charge = getPagarmeCharge(responseData) || {};
  const tx = getPagarmeTransaction(responseData) || {};
  const orderStatus = String(responseData.status || '').toLowerCase();
  const chargeStatus = String(charge.status || '').toLowerCase();
  const txStatus = String(tx.status || '').toLowerCase();
  if (orderStatus === 'paid' || chargeStatus === 'paid' || txStatus === 'captured' || txStatus === 'authorized') return 'approved';
  if (orderStatus === 'failed' || chargeStatus === 'failed' || txStatus === 'not_authorized' || txStatus === 'failed' || txStatus === 'with_error') return 'rejected';
  return orderStatus || chargeStatus || txStatus || 'pending';
}

async function updateOrderPaymentFromPagarme(orderId, pagarmeData = {}, extra = {}) {
  try {
    const oid = normalizeObjectId(orderId);
    if (!oid) return null;
    const status = getPagarmeStatus(pagarmeData);
    const approved = status === 'approved';
    const charge = getPagarmeCharge(pagarmeData) || {};
    const tx = getPagarmeTransaction(pagarmeData) || {};

    const patch = {
      status: approved ? 'pago' : (status === 'rejected' ? 'pagamento_recusado' : 'pending_payment'),
      statusLabel: approved ? 'Pagamento aprovado' : (status === 'rejected' ? 'Pagamento recusado' : 'Aguardando confirmação do pagamento'),
      payment: {
        provider: 'pagarme',
        method: extra.method || 'card',
        type: extra.type || (extra.method === 'pix' ? 'pix' : (extra.method === 'boleto' ? 'boleto' : 'credit_card')),
        paymentId: String(charge.id || tx.id || pagarmeData.id || ''),
        orderId: String(pagarmeData.id || ''),
        status,
        statusDetail: getPagarmeGatewayMessage(pagarmeData),
        installments: extra.installments || undefined,
        ticketUrl: extra.ticketUrl || undefined,
        qrCode: extra.qrCode || undefined,
        amount: centsToMoney(charge.amount || tx.amount || 0),
        raw: redact(pagarmeData || {})
      }
    };
    const updated = await Order.findByIdAndUpdate(oid, { $set: patch }, { new: true });
    if (approved) await notifySaleAfterPaymentApproved(updated, `pagarme_${extra.method || 'card'}_approved`);
    return updated;
  } catch (error) {
    console.error('Erro ao atualizar pedido com pagamento Pagar.me:', error.message || error);
    return null;
  }
}

function buildPagarmeCreditPayload(body = {}, order = null) {
  const cardToken = String(body.card_token || body.cardToken || body.token || '').trim();
  if (!cardToken) throw new Error('Token do cartão Pagar.me ausente.');
  const amount = moneyToCents(
    body.amount ||
    body.total ||
    body.transaction_amount ||
    body.transactionAmount ||
    order?.total ||
    order?.totalAmount ||
    order?.grandTotal ||
    order?.amount ||
    order?.orderTotal ||
    order?.summary?.total ||
    order?.payment?.amount ||
    order?.payment?.total ||
    0
  );
  if (!amount) throw new Error('Total inválido para cartão Pagar.me.');
  const installments = Math.max(1, Math.min(Number(body.installments || 1) || 1, 12));
  const billingAddress = buildPagarmeBillingAddress(body, order);

  return {
    code: String(body.orderId || order?._id || uid('order')).slice(0, 52),
    closed: true,
    customer: buildPagarmeCustomer(body, order),
    items: buildPagarmeItems({ ...body, amount: centsToMoney(amount) }, order),
    payments: [{
      payment_method: 'credit_card',
      credit_card: {
        installments,
        statement_descriptor: sanitizePagarmeStatementDescriptor(process.env.PAGARME_STATEMENT_DESCRIPTOR || 'ARIANAMOVEIS'),
        operation_type: 'auth_and_capture',
        card_token: cardToken,
        // IMPORTANTE: o token do cartão não leva o endereço de cobrança.
        // Com antifraude/gateway ativo, o Pagar.me exige billing_address na cobrança.
        // Mantemos em billing_address e também em card.billing_address para compatibilidade da API/gateway.
        billing_address: billingAddress,
        card: { billing_address: billingAddress }
      }
    }],
    metadata: {
      orderId: String(body.orderId || order?._id || ''),
      provider: 'pagarme',
      paymentMethod: 'card'
    }
  };
}

function buildPagarmePixPayload(body = {}, order = null) {
  const amount = moneyToCents(
    body.amount ||
    body.total ||
    body.transaction_amount ||
    body.transactionAmount ||
    order?.total ||
    order?.totalAmount ||
    order?.grandTotal ||
    order?.amount ||
    order?.orderTotal ||
    order?.summary?.total ||
    order?.payment?.amount ||
    order?.payment?.total ||
    0
  );
  if (!amount) throw new Error('Total inválido para Pix Pagar.me.');
  return {
    code: String(body.orderId || order?._id || uid('order')).slice(0, 52),
    closed: true,
    customer: buildPagarmeCustomer(body, order),
    items: buildPagarmeItems({ ...body, amount: centsToMoney(amount) }, order),
    payments: [{
      payment_method: 'pix',
      pix: { expires_in: Number(process.env.PAGARME_PIX_EXPIRES_IN || 3600) }
    }],
    metadata: { orderId: String(body.orderId || order?._id || ''), provider: 'pagarme', paymentMethod: 'pix' }
  };
}

function buildPagarmeBoletoPayload(body = {}, order = null) {
  const amount = moneyToCents(
    body.amount ||
    body.total ||
    body.transaction_amount ||
    body.transactionAmount ||
    order?.total ||
    order?.totalAmount ||
    order?.grandTotal ||
    order?.amount ||
    order?.orderTotal ||
    order?.summary?.total ||
    order?.payment?.amount ||
    order?.payment?.total ||
    0
  );
  if (!amount) throw new Error('Total inválido para boleto Pagar.me.');
  const dueAt = new Date(Date.now() + Number(process.env.PAGARME_BOLETO_DUE_DAYS || 3) * 24 * 60 * 60 * 1000);
  return {
    code: String(body.orderId || order?._id || uid('order')).slice(0, 52),
    closed: true,
    customer: buildPagarmeCustomer(body, order),
    items: buildPagarmeItems({ ...body, amount: centsToMoney(amount) }, order),
    payments: [{
      payment_method: 'boleto',
      boleto: {
        bank: String(process.env.PAGARME_BOLETO_BANK || '001'),
        instructions: String(process.env.PAGARME_BOLETO_INSTRUCTIONS || 'Não receber após o vencimento.').slice(0, 255),
        due_at: dueAt.toISOString().slice(0, 10)
      }
    }],
    metadata: { orderId: String(body.orderId || order?._id || ''), provider: 'pagarme', paymentMethod: 'boleto' }
  };
}

function normalizePagarmePixResponse(pagarmeData = {}) {
  const charge = getPagarmeCharge(pagarmeData) || {};
  const tx = getPagarmeTransaction(pagarmeData) || {};
  const qrCode = tx.qr_code || tx.qrCode || tx.pix_qr_code || tx.copy_paste || '';
  const qrCodeUrl = tx.qr_code_url || tx.qrCodeUrl || tx.url || '';
  return {
    ok: true,
    provider: 'pagarme',
    method: 'pix',
    status: getPagarmeStatus(pagarmeData),
    id: String(charge.id || tx.id || pagarmeData.id || ''),
    paymentId: String(charge.id || tx.id || pagarmeData.id || ''),
    qrCode,
    qr_code: qrCode,
    qrCodeImage: qrCodeUrl,
    ticketUrl: qrCodeUrl,
    data: pagarmeData,
    raw: pagarmeData
  };
}

function normalizePagarmeBoletoResponse(pagarmeData = {}) {
  const charge = getPagarmeCharge(pagarmeData) || {};
  const tx = getPagarmeTransaction(pagarmeData) || {};
  const ticketUrl = tx.url || tx.pdf || tx.boleto_url || '';
  const linha = tx.line || tx.digitable_line || tx.barcode || '';
  return {
    ok: true,
    provider: 'pagarme',
    method: 'boleto',
    status: getPagarmeStatus(pagarmeData),
    id: String(charge.id || tx.id || pagarmeData.id || ''),
    paymentId: String(charge.id || tx.id || pagarmeData.id || ''),
    ticketUrl,
    ticket_url: ticketUrl,
    boletoUrl: ticketUrl,
    linhaDigitavel: linha,
    digitableLine: linha,
    barcode: tx.barcode || linha,
    data: pagarmeData,
    raw: pagarmeData
  };
}



// Rotas principais, autenticação e perfil extraídas na Etapa 3.
registerCoreAuthUserRoutes(app, {
  ...context,
  BUILD_ID,
  bcrypt,
  changedKeys,
  crypto,
  EMAIL_FROM,
  EMAIL_HOST,
  EMAIL_PASS,
  EMAIL_PORT,
  EMAIL_SECURE,
  EMAIL_USER,
  FRONTEND_URL,
  GOOGLE_CLIENT_ID,
  googleClient,
  authRequired,
  JWT_SECRET,
  mongoose,
  nodemailer,
  RESET_PASSWORD_URL,
  Seller,
  signToken,
  toJSON,
  uid,
  User,
  writeAuditLog
});


function normalizePartnerRequestStatus(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (['aprovado', 'approved', 'approve', 'ativo', 'active'].includes(raw)) return 'approved';
  if (['reprovado', 'rejected', 'recusado', 'denied', 'cancelado'].includes(raw)) return 'rejected';
  if (['pendente', 'pending', 'novo', 'new'].includes(raw)) return 'pending';
  return raw || 'pending';
}

function partnerRequestPublicStatus(value = '') {
  const status = normalizePartnerRequestStatus(value);
  if (status === 'approved') return 'aprovado';
  if (status === 'rejected') return 'reprovado';
  return 'pendente';
}

function normalizePartnerRequestForResponse(doc = {}) {
  const obj = toJSON(doc) || {};
  const meta = obj.metadata || {};
  const status = normalizePartnerRequestStatus(obj.status || meta.status || 'pending');
  return {
    ...obj,
    id: String(obj.id || obj._id || obj.sellerId || ''),
    sellerId: String(obj.sellerId || ''),
    status,
    statusLabel: partnerRequestPublicStatus(status),
    storeName: String(obj.storeName || obj.displayName || meta.storeName || meta.factoryName || meta.shopName || meta.name || '').trim(),
    factoryName: String(meta.factoryName || obj.storeName || obj.displayName || '').trim(),
    ownerName: String(meta.ownerName || meta.responsavel || meta.owner || obj.displayName || meta.name || '').trim(),
    email: String(obj.email || meta.email || meta.contactEmail || '').trim(),
    phone: String(obj.phone || meta.phone || meta.whatsapp || '').trim(),
    document: String(obj.document || meta.document || meta.cnpj || meta.cpf || '').trim(),
    cnpj: String(meta.cnpj || obj.document || '').trim(),
    city: String(meta.city || meta.cidade || '').trim(),
    uf: String(meta.uf || meta.estado || '').trim(),
    requestedAt: obj.createdAt || meta.createdAt || null
  };
}

function collectPartnerNotifyNumbers(settings = {}) {
  const numbers = new Set(parseAdminNotifyNumbers(settings));
  const envValues = [
    process.env.EVOLUTION_SAC_NUMBER,
    process.env.EVOLUTION_FINANCEIRO_NUMBER,
    process.env.EVOLUTION_NOTIFICACAO_NUMBER,
    process.env.EVOLUTION_LOJA_NUMBER,
    process.env.SAC_WHATSAPP_NUMBER,
    process.env.FINANCEIRO_WHATSAPP_NUMBER,
    process.env.NOTIFICACAO_WHATSAPP_NUMBER,
    process.env.LOJA_WHATSAPP_NUMBER,
    process.env.ATENDIMENTO_LOJA_WHATSAPP,
    process.env.PARTNER_REQUEST_NOTIFY_NUMBERS
  ];
  for (const value of envValues) {
    String(value || '').split(',').forEach((item) => {
      const n = normalizePhone(item, settings.defaultCountryCode || '55');
      if (n) numbers.add(n);
    });
  }
  return Array.from(numbers).filter(Boolean);
}

function buildPartnerRequestNotifyMessage(seller = {}) {
  const s = normalizePartnerRequestForResponse(seller);
  const loja = s.storeName || s.factoryName || 'Loja parceira';
  const responsavel = s.ownerName || 'Não informado';
  const contato = [s.phone, s.email].filter(Boolean).join(' / ') || 'Não informado';
  const doc = s.document || s.cnpj || 'Não informado';
  const cidade = [s.city, s.uf].filter(Boolean).join(' / ') || 'Não informada';
  return [
    '🏪 Nova solicitação de cadastro de seller',
    '',
    `Loja: ${loja}`,
    `Responsável: ${responsavel}`,
    `Documento: ${doc}`,
    `Contato: ${contato}`,
    `Cidade: ${cidade}`,
    '',
    'Acesse o painel administrativo para aprovar ou recusar:',
    `${FRONTEND_URL}/admin_partner_requests.html`
  ].join('\n');
}

async function notifyNewPartnerRequest(seller = {}) {
  const s = normalizePartnerRequestForResponse(seller);
  const loja = s.storeName || s.factoryName || 'Loja parceira';
  const relatedId = String(s.id || s.sellerId || '');

  await createAdminNotification({
    type: 'partner_request_created',
    title: '🏪 Novo seller aguardando aprovação',
    message: `${loja} enviou uma solicitação de cadastro para o marketplace.`,
    relatedId,
    severity: 'info',
    metadata: { sellerId: s.sellerId, storeName: loja, email: s.email, phone: s.phone, document: s.document }
  });

  const settings = await getWhatsappSettings().catch(() => null);
  if (!settings || !settings.enabled) return { panel: true, whatsapp: { skipped: true, reason: 'whatsapp_disabled' } };
  const numbers = collectPartnerNotifyNumbers(settings);
  if (!numbers.length) return { panel: true, whatsapp: { skipped: true, reason: 'missing_notify_numbers' } };

  const text = buildPartnerRequestNotifyMessage(s);
  const results = [];
  for (const number of numbers) {
    try {
      const sent = await waSendTextMessage({ number, text, settings });
      results.push({ number, ok: true, status: sent.status });
    } catch (error) {
      results.push({ number, ok: false, error: error.message || String(error) });
    }
  }
  return { panel: true, whatsapp: { numbers, results } };
}

// Rotas de seller/parceiros extraídas para módulo próprio na Etapa 2.
registerSellerPartnerRoutes(app, {
  ...context,
  Seller,
  uid,
  adminRequired,
  mongoose,
  now,
  escapeRegex,
  toJSON,
  notifyNewPartnerRequest,
  normalizePartnerRequestForResponse,
  normalizePartnerRequestStatus,
  partnerRequestPublicStatus,
  createPagarmeRecipient,
  buildPagarmeRecipientPayloadFromSeller,
  normalizePagarmeRecipientResponse,
  writeAuditLog,
  redact,
  createAdminNotification
});


// Rotas principais do seller extraídas para módulo próprio na Etapa 4.
registerSellerCoreRoutes(app, {
  ...context,
  User,
  Seller,
  Product,
  Order,
  Notification,
  JWT_SECRET,
  mongoose,
  jwt,
  now,
  ensureArray,
  toJSON,
  normalizeObjectId,
  productPayloadFromBody,
  normalizeProductForResponse,
  extractSellerIdsFromOrder,
  createSellerOrderNotifications,
  createAdminNotification,
  waMaybeNotifyOrderStatusChange,
  waNotifyAdminOrderStatusChange,
  getPaymentsSettings,
  buildSellerSplitSummary,
  buildPagarmeRecipientPayloadFromSeller,
  createPagarmeRecipient,
  normalizePagarmeRecipientResponse,
  writeAuditLog,
  redact,
  formatMoneyBRL,
  cleanPhone
});


// Rotas de catálogo/home/SEO/banners/endereços extraídas para módulo próprio na Etapa 5.
registerCatalogHomeProductBannerRoutes(app, {
  ...context,
  Address,
  Banner,
  Category,
  Product,
  Seller,
  adminRequired,
  authRequired,
  axios,
  changedKeys,
  ensureArray,
  escapeRegex,
  getPaymentsSettings,
  normalizeBannerForResponse,
  normalizeBannerPayload,
  normalizeObjectId,
  normalizeProductForResponse,
  parseBannerInput,
  productPayloadFromBody,
  sanitizeIdPart,
  toJSON,
  writeAuditLog
});

// Rotas de logística extraídas para módulo próprio na Etapa 7.
registerLogisticsRoutes(app, {
  ...context,
  quoteCorreios,
  writeAuditLog,
  waMaybeNotifyOrderStatusChange,
  formatMoneyBRL,
  sellerAuthRequired,
  correiosCfg,
  normalizeCepValue
});




// Rotas de atualização de status de pedidos extraídas na Etapa 17.
registerOrderStatusRoutes(app, {
  ...context,
  Order,
  authRequired,
  normalizeObjectId,
  toJSON,
  changedKeys,
  writeAuditLog,
  createAdminNotification,
  createSellerOrderNotifications,
  waMaybeNotifyOrderStatusChange,
  waNotifyAdminOrderStatusChange
});




// Rotas admin/operacionais e fila de fabricantes extraídas para módulo próprio na Etapa 10.
registerAdminOperationalRoutes(app, {
  ...context,
  Order,
  Notification,
  OperationalAlert,
  IntegrationAuditLog,
  ManufacturerDispatchQueue,
  ManufacturerIntegration,
  adminRequired,
  authRequired,
  scanOperationalAlerts,
  processManufacturerQueue,
  isInternalArianaSeller,
  dispatchOrderToManufacturer,
  enqueueManufacturerDispatch,
  toJSON,
  redact,
  now
});


// Rotas de frete/shipping extraídas na Etapa 11.
registerShippingRoutes(app, {
  ...context,
  Order,
  adminRequired,
  calculateShipping,
  getShippingSettings,
  saveShippingSettings,
  correiosCfg,
  getCorreiosToken,
  quoteCorreios,
  safeAxiosError
});


function normalizeMercadoPagoAddress(input = {}) {
  const src = (input && typeof input === 'object') ? input : {};
  const out = {
    zip_code: String(src.zip_code || src.zip || src.cep || src.zipCode || '').replace(/\D/g, ''),
    street_name: String(src.street_name || src.street || src.logradouro || src.rua || src.address || src.endereco || '').trim(),
    street_number: String(src.street_number || src.number || src.numero || src.n || 'S/N').trim(),
    neighborhood: String(src.neighborhood || src.bairro || '').trim(),
    city: String(src.city || src.city_name || src.cidade || '').trim(),
    federal_unit: String(src.federal_unit || src.state || src.uf || src.state_name || '').trim().toUpperCase().slice(0, 2)
  };

  Object.keys(out).forEach((key) => {
    if (!out[key]) delete out[key];
  });

  return out;
}

function pickMercadoPagoAddress(body = {}) {
  const payer = body.payer || {};
  const candidates = [
    payer.address,
    body.address,
    body.customer?.address,
    body.shippingAddress,
    body.receiver_address,
    body.receiverAddress
  ];

  for (const item of candidates) {
    const normalized = normalizeMercadoPagoAddress(item || {});
    if (Object.keys(normalized).length) return normalized;
  }

  return {};
}

function buildMercadoPagoPhone(body = {}) {
  const payer = body.payer || {};
  const existingPhone = payer.phone && typeof payer.phone === 'object' ? { ...payer.phone } : {};
  const rawPhone = String(
    body.phone ||
    body.customer?.phone ||
    payer.phone?.number ||
    payer.phone ||
    ''
  ).replace(/\D/g, '');

  if (!rawPhone && Object.keys(existingPhone).length) return existingPhone;
  if (!rawPhone) return null;

  const withoutCountry = rawPhone.startsWith('55') && rawPhone.length > 11 ? rawPhone.slice(2) : rawPhone;
  return {
    area_code: withoutCountry.length >= 10 ? withoutCountry.slice(0, 2) : '',
    number: withoutCountry.length >= 10 ? withoutCountry.slice(2) : withoutCountry
  };
}

function buildMercadoPagoPayer(body = {}) {
  const payer = body.payer || {};
  const cpf = String(
    body.cpf ||
    body.document ||
    body.customer?.cpf ||
    body.customer?.document ||
    (payer.identification && payer.identification.number) ||
    ''
  ).replace(/\D/g, '');

  const firstName = String(body.first_name || body.firstName || payer.first_name || payer.firstName || 'Cliente').trim();
  const lastName = String(body.last_name || body.lastName || payer.last_name || payer.lastName || 'Ariana').trim();

  const fallbackEmail = body.orderId
    ? `cliente_${String(body.orderId).replace(/[^a-zA-Z0-9]/g, '').slice(-12)}@arianamoveis.com.br`
    : 'cliente@arianamoveis.com.br';

  const email = String(
    body.email ||
    body.customer?.email ||
    payer.email ||
    fallbackEmail
  ).trim().toLowerCase();

  const address = pickMercadoPagoAddress(body);
  const phone = buildMercadoPagoPhone(body);

  const out = {
    ...payer,
    email,
    first_name: firstName,
    last_name: lastName
  };

  // Evita HTTP 400 do Mercado Pago por campos extras dentro de payer.
  delete out.date_of_birth;
  delete out.birthDate;
  delete out.birth_date;
  delete out.customer;
  delete out.receiver_address;
  delete out.receiverAddress;

  if (Object.keys(address).length) out.address = address;
  else delete out.address;

  if (phone && Object.keys(phone).length) out.phone = phone;

  if (cpf) {
    out.identification = {
      type: ((body.identification && body.identification.type) || (payer.identification && payer.identification.type) || 'CPF'),
      number: cpf
    };
  }

  return out;
}

function buildMercadoPagoAdditionalInfo(body = {}) {
  const payer = buildMercadoPagoPayer(body);
  const receiverAddress = normalizeMercadoPagoAddress(body.receiver_address || body.receiverAddress || body.address || {});
  const payerPhone = payer.phone && typeof payer.phone === 'object'
    ? {
        area_code: String(payer.phone.area_code || ''),
        number: String(payer.phone.number || '')
      }
    : undefined;

  const additionalInfo = {
    payer: {
      first_name: payer.first_name,
      last_name: payer.last_name,
      phone: payerPhone
    },
    shipments: Object.keys(receiverAddress).length ? {
      receiver_address: {
        zip_code: String(receiverAddress.zip_code || ''),
        street_name: String(receiverAddress.street_name || ''),
        street_number: String(receiverAddress.street_number || 'S/N'),
        floor: String(body.receiver_address?.floor || ''),
        apartment: String(body.receiver_address?.apartment || ''),
        city_name: String(body.receiver_address?.city_name || receiverAddress.city_name || ''),
        state_name: String(body.receiver_address?.state_name || receiverAddress.state_name || '')
      }
    } : undefined
  };

  // A API /v1/payments do Mercado Pago rejeita campos como
  // additional_info.payer.address.city, federal_unit e neighborhood.
  // Por isso o endereço completo fica apenas no campo principal `payer.address`
  // e, dentro de additional_info, mantemos somente nome/telefone e envio.
  if (!additionalInfo.payer.phone || !additionalInfo.payer.phone.number) {
    delete additionalInfo.payer.phone;
  }

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length) {
    additionalInfo.items = items.slice(0, 50).map((item) => ({
      id: String(item.productId || item.id || item.sku || '').slice(0, 256),
      title: String(item.name || item.title || 'Produto Ariana Móveis').slice(0, 256),
      description: String(item.description || item.name || item.title || 'Produto Ariana Móveis').slice(0, 256),
      quantity: Number(item.qty || item.quantity || 1) || 1,
      unit_price: Number(item.unitPrice || item.price || item.totalPrice || 0) || 0
    }));
  }

  Object.keys(additionalInfo).forEach((key) => {
    if (additionalInfo[key] === undefined || additionalInfo[key] === null) delete additionalInfo[key];
  });

  return additionalInfo;
}

function parsePaymentAmount(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 100) / 100;
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const clean = raw
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');
  const n = Number(clean);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
function normalizeMercadoPagoPaymentResponse(data = {}) {
  const tx = (((data || {}).point_of_interaction || {}).transaction_data || {});
  const qrCodeBase64 = tx.qr_code_base64 || data.qr_code_base64 || '';
  const qrCode = tx.qr_code || data.qr_code || '';
  const qrCodeImage = tx.ticket_url || data.ticket_url || '';
  const ticketUrl = ((data.transaction_details || {}).external_resource_url) || tx.ticket_url || data.ticket_url || '';
  const barcode = ((data.barcode || {}).content) || data.barcode || '';
  return {
    ok: true,
    id: data && data.id ? String(data.id) : '',
    status: data.status || '',
    statusDetail: data.status_detail || '',
    qrCodeBase64,
    qrCode,
    qr_code: qrCode,
    qrCodeImage,
    ticketUrl,
    ticket_url: ticketUrl,
    barcode,
    linhaDigitavel: barcode,
    raw: data
  };
}



async function notifySaleAfterPaymentApproved(orderDoc, origin = 'payment_approved') {
  try {
    if (!orderDoc) return { skipped: true, reason: 'missing_order' };
    const oid = orderDoc._id || orderDoc.id;
    const fresh = await Order.findById(oid);
    if (!fresh) return { skipped: true, reason: 'order_not_found' };

    if (fresh.payment?.adminSaleNotifiedAt) {
      return { skipped: true, reason: 'already_notified' };
    }

    await Order.findByIdAndUpdate(fresh._id, {
      $set: {
        'payment.adminSaleNotifiedAt': now(),
        'payment.adminSaleNotificationOrigin': origin
      }
    });

    const updated = await Order.findById(fresh._id);

    await createAdminNotification({
      type: 'order_paid',
      title: 'Nova venda recebida',
      message: `Cliente: ${updated.customerName || 'Cliente'}\nPedido: ${updated._id}\nValor: ${formatMoneyBRL(updated.total || 0)}\nStatus: Pagamento aprovado`,
      relatedId: String(updated._id),
      severity: 'success',
      metadata: { origin, paymentStatus: updated.payment?.status || '', paymentMethod: updated.payment?.method || '' }
    });

    await createSellerOrderNotifications(updated, {
      type: 'seller_order_paid',
      title: 'Nova venda recebida',
      message: `Cliente: ${updated.customerName || 'Cliente'}\nPedido: #${String(updated._id).slice(-8).toUpperCase()}\nValor: ${formatMoneyBRL(updated.total || 0)}\nStatus: Pagamento aprovado`,
      severity: 'success',
      origin
    });

    let queue = { skipped: true, reason: 'enqueue_disabled' };
    try { queue = await enqueueManufacturerDispatch(updated); } catch (e) { queue = { ok: false, error: e.message || String(e) }; }

    // SIGE da Ariana: envia automaticamente somente produtos vendidos pela Ariana Móveis.
    // Vendas de sellers/fabricantes ficam fora do SIGE da Ariana e seguem pelo fluxo do parceiro.
    let sige = { skipped: true, reason: 'not_attempted' };
    try { sige = await arianaSigeSyncOwnOrderAfterPayment(updated, origin); } catch (e) { sige = { ok: false, error: e.message || String(e) }; }

    const adminWhatsapp = await waNotifyAdminNewOrder(updated, origin);
    return { ok: true, adminWhatsapp, queue, sige };
  } catch (error) {
    console.error('Erro ao notificar venda aprovada:', error.message || error);
    return { ok: false, error: error.message || String(error) };
  }
}

async function updateOrderPaymentFromMercadoPago(orderId, method, mpData = {}, extra = {}) {
  try {
    const oid = normalizeObjectId(orderId);
    if (!oid) return null;
    const status = String(mpData?.status || '').toLowerCase();
    const approved = status === 'approved';
    const patch = {
      status: approved ? 'pago' : 'pending_payment',
      statusLabel: approved ? 'Pagamento aprovado' : 'Aguardando confirmação do pagamento',
      payment: {
        provider: 'mercadopago',
        method,
        type: method === 'card' ? 'credit_card' : method,
        paymentId: mpData?.id ? String(mpData.id) : '',
        status: status || 'pending',
        statusDetail: mpData?.status_detail || '',
        liveMode: mpData?.live_mode === true,
        installments: extra.installments || undefined,
        ticketUrl: extra.ticketUrl || undefined,
        qrCode: extra.qrCode || undefined,
        paymentMethodId: extra.paymentMethodId || mpData?.payment_method_id || '',
        issuerId: extra.issuerId || mpData?.issuer_id || '',
        raw: redact(mpData || {})
      }
    };
    const updated = await Order.findByIdAndUpdate(oid, { $set: patch }, { new: true });
    if (approved) await notifySaleAfterPaymentApproved(updated, `mercadopago_${method}_approved`);
    return updated;
  } catch (error) {
    console.error('Erro ao atualizar pedido com pagamento Mercado Pago:', error.message || error);
    return null;
  }
}

// Rotas de pagamentos extraídas para módulo próprio na Etapa 13.
registerPaymentRoutes(app, {
...context,
  APP_BASE_URL,
  Order,
  PaymentEvent,
  adminRequired,
  getPaymentsSettings,
  getShippingSettings,
  getWhatsappSettings,
  MONGODB_DB,
  PORT,
  BUILD_ID,
  redactWhatsappSettings,
  redact,
  writeAuditLog,
  createMercadoPagoPayment,
  normalizeMercadoPagoPaymentResponse,
  updateOrderPaymentFromMercadoPago,
  buildMercadoPagoPayer,
  buildMercadoPagoAdditionalInfo,
  parsePaymentAmount,
  getMercadoPagoPaymentById: context.getMercadoPagoPaymentById,
  resolveOrderIdFromMpPayment: context.resolveOrderIdFromMpPayment,
  updateOrderFromMercadoPagoPayment: context.updateOrderFromMercadoPagoPayment,
  createPagarmeOrder,
  buildPagarmePixPayload,
  buildPagarmeBoletoPayload,
  buildPagarmeCreditPayload,
  buildSellerSplitSummary,
  applyPagarmeSplitToPayload,
  normalizePagarmePixResponse,
  normalizePagarmeBoletoResponse,
  updateOrderPaymentFromPagarme,
  getPagarmeStatus,
  getPagarmeCharge,
  getPagarmeTransaction,
  getPagarmeGatewayMessage,
  normalizeObjectId,
  toJSON
});

// ============================================================
// ADMIN CORE / UPLOAD / POSTERS / CRUD GENÉRICO - ETAPA 16
// Rotas Admin core foram movidas para routes/adminCoreRoutes.js
// ============================================================
registerAdminCoreRoutes(app, {
  ...context,
  BUILD_ID,
  writeAuditLog,
  redactWhatsappSettings,
  waMaybeNotifyOrderStatusChange,
  waNotifyAdminOrderStatusChange,
  formatMoneyBRL
});

// ============================================================
// CUPONS DE DESCONTO - ETAPA 15
// Rotas de cupons foram movidas para routes/couponRoutes.js
// ============================================================
registerCouponRoutes(app, {
  ...context,
  mongoose,
  baseOptions,
  adminRequired,
  ensureArray,
  toJSON,
  escapeRegex,
  DEFAULT_CURRENCY
});


setInterval(() => {
  processPendingDeliveryRatings(20).catch((error) => {
    console.error('[WHATSAPP AVALIACAO ENTREGA] ERRO NO PROCESSADOR', error.message || error);
  });
}, 15 * 60 * 1000);


function startSigeAutoCobrancaScheduler() {
  const enabled = String(process.env.SIGE_AUTO_COBRANCA_ENABLED || 'false').toLowerCase() === 'true';
  if (!enabled) return;
  const hour = Math.max(0, Math.min(Number(process.env.SIGE_AUTO_COBRANCA_HOUR || 9), 23));
  const minute = Math.max(0, Math.min(Number(process.env.SIGE_AUTO_COBRANCA_MINUTE || 0), 59));
  let lastRun = '';

  setInterval(async () => {
    try {
      const nowDate = new Date();
      const todayKey = nowDate.toISOString().slice(0, 10);
      if (lastRun === todayKey) return;
      const local = new Date(nowDate.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
      if (local.getHours() !== hour || local.getMinutes() < minute) return;
      lastRun = todayKey;
      console.log('🤖 Executando cobrança automática SIGE...');
      const fakeReq = { body: { limit: Number(process.env.SIGE_AUTO_COBRANCA_LIMIT || 100), maxRecords: Number(process.env.SIGE_AUTO_COBRANCA_MAX_RECORDS || 8000) } };
      // Reutiliza a lógica principal sem HTTP para evitar duplicação pesada.
      const data = await getSigeInadimplentesData({ limit: fakeReq.body.limit, maxRecords: fakeReq.body.maxRecords });
      let enviados = 0;
      for (const item of data.inadimplentes) {
        const tipo = getSigeAutoCobrancaTipo(item.diasAtraso);
        if (!tipo) continue;
        const enriched = await enrichSigeInadimplenteTelefone(item);
        const telefone = normalizePhone(enriched.telefone || '', '55');
        if (!telefone) continue;
        const uniqueKey = buildSigeAutoCobrancaKey(enriched, tipo);
        if (await CrediarioCobrancaLog.findOne({ uniqueKey }).lean()) continue;
        const mensagem = buildSigeAutoCobrancaMessage(enriched, tipo);
        try {
          const whatsapp = await waSendTextMessage({ number: telefone, text: mensagem });
          await CrediarioCobrancaLog.create({
            uniqueKey,
            origem: 'sige_auto_scheduler',
            clienteNome: enriched.nome || enriched.cliente || '',
            telefone,
            documento: String(enriched.documento || ''),
            codigoLancamento: String(enriched.codigo || enriched.id || ''),
            tipo,
            diasAtraso: Number(enriched.diasAtraso || 0),
            valor: Number((enriched.saldo && enriched.saldo > 0) ? enriched.saldo : (enriched.valor || 0)),
            dataVencimento: parseSigeDate(enriched.dataVencimento),
            enviado: true,
            enviadoEm: new Date(),
            whatsappResultado: whatsapp,
            mensagem,
            metadata: { lancamento: enriched }
          });
          enviados += 1;
        } catch (error) {
          console.error('Erro cobrança automática SIGE:', error.message || error);
        }
      }
      console.log(`🤖 Cobrança automática SIGE concluída. Enviadas: ${enviados}`);
    } catch (error) {
      console.error('Erro no agendador de cobrança SIGE:', error.message || error);
    }
  }, 60 * 1000);
}


function startEnterpriseQueueWorker() {
  const enabled = String(process.env.ENTERPRISE_QUEUE_WORKER_ENABLED || 'true').toLowerCase() !== 'false';
  if (!enabled) {
    console.log('🏭 Enterprise queue worker desativado por ENTERPRISE_QUEUE_WORKER_ENABLED=false');
    return;
  }
  const intervalMs = Math.max(15000, Number(process.env.ENTERPRISE_QUEUE_WORKER_INTERVAL_MS || 60000));
  const limit = Math.max(1, Number(process.env.ENTERPRISE_QUEUE_WORKER_LIMIT || 5));
  console.log(`🏭 Enterprise queue worker ativo: a cada ${intervalMs}ms, limite ${limit}`);
  setInterval(() => {
    processManufacturerQueue(limit).catch((error) => {
      console.error('[ENTERPRISE QUEUE WORKER] ERRO', error.message || error);
    });
  }, intervalMs);
}

function startEnterpriseCatalogSyncWorker() {
  const enabled = String(process.env.ENTERPRISE_CATALOG_SYNC_WORKER_ENABLED || 'true').toLowerCase() !== 'false';
  if (!enabled) {
    console.log('🏭 Enterprise catalog sync worker desativado por ENTERPRISE_CATALOG_SYNC_WORKER_ENABLED=false');
    return;
  }
  const intervalMs = Math.max(15000, Number(process.env.ENTERPRISE_CATALOG_SYNC_WORKER_INTERVAL_MS || 45000));
  const limit = Math.max(1, Number(process.env.ENTERPRISE_CATALOG_SYNC_WORKER_LIMIT || 3));
  console.log(`🏭 Enterprise catalog sync worker ativo: a cada ${intervalMs}ms, limite ${limit}`);
  setInterval(() => {
    processPendingEnterpriseCatalogSyncJobs(limit).catch((error) => {
      console.error('[ENTERPRISE CATALOG SYNC WORKER] ERRO', error.message || error);
    });
  }, intervalMs);
}




// ============================================================
// ENTERPRISE - ETAPA 14
// Rotas Enterprise foram movidas para routes/enterpriseRoutes.js
// ============================================================
registerEnterpriseRoutes(app, {
  ...context,
  sellerAuthRequired,
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
});


// ============================================================
// INTEGRAÇÕES EXTERNAS - ETAPA 18
// SIGE e Manufacturer Integration foram movidos para
// routes/externalIntegrationRoutes.js
// ============================================================
registerExternalIntegrationRoutes(app, {
  ...context,
  adminRequired,
  Order,
  Product,
  User,
  Setting,
  IntegrationAuditLog,
  EnterpriseBillingRecord,
  redact
});

}
