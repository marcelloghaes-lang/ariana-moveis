import mongoose from 'mongoose';
import { DEFAULT_CURRENCY, MAX_DISPATCH_ATTEMPTS } from '../config/env.js';

function now() { return new Date(); }

const baseOptions = { timestamps: true, versionKey: false };

const adminAuditLogSchema = new mongoose.Schema({
  actorId: { type: String, default: '', index: true },
  actorEmail: { type: String, default: '', index: true },
  action: { type: String, required: true, index: true },
  module: { type: String, default: 'users', index: true },
  targetUserId: { type: String, default: '', index: true },
  targetUserName: { type: String, default: '' },
  targetUserEmail: { type: String, default: '', index: true },
  summary: { type: String, default: '' },
  addedPermissions: { type: [String], default: [] },
  removedPermissions: { type: [String], default: [] },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  ip: { type: String, default: '' },
  userAgent: { type: String, default: '' }
}, baseOptions);

const userSchema = new mongoose.Schema({ name: String, email: { type: String, index: true, unique: true, sparse: true }, passwordHash: String, cpf: String, phone: String, role: { type: String, default: 'customer', enum: ['customer', 'seller', 'admin', 'staff'] }, permissions: { type: [String], default: [] }, sellerId: { type: String, default: null }, city: String, uf: String, isActive: { type: Boolean, default: true }, emailVerified: { type: Boolean, default: false }, googleId: { type: String, index: true, sparse: true }, authProvider: { type: String, default: 'password' }, resetPasswordTokenHash: { type: String, default: '' }, resetPasswordExpiresAt: { type: Date, default: null }, mustChangePassword: { type: Boolean, default: false }, lastLoginAt: { type: Date, default: null }, lastLoginIp: { type: String, default: '' }, lastLoginUserAgent: { type: String, default: '' }, lastLoginBrowser: { type: String, default: '' }, lastLoginOs: { type: String, default: '' }, lastLoginDevice: { type: String, default: '' }, failedLoginAttempts: { type: Number, default: 0 }, lockedUntil: { type: Date, default: null }, tokenVersion: { type: Number, default: 0 }, allowMultipleSessions: { type: Boolean, default: true }, createdBy: { type: String, default: '' }, updatedBy: { type: String, default: '' } }, baseOptions);
const sellerSchema = new mongoose.Schema({ sellerId: { type: String, index: true, unique: true }, userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, displayName: String, storeName: String, email: String, phone: String, document: String, status: { type: String, default: 'pending' }, onboardingCompleted: { type: Boolean, default: false }, metadata: mongoose.Schema.Types.Mixed }, baseOptions);
const categorySchema = new mongoose.Schema({ name: { type: String, required: true }, slug: String, parentId: { type: String, default: null }, active: { type: Boolean, default: true }, sortOrder: { type: Number, default: 0 }, image: String }, baseOptions);
const productSchema = new mongoose.Schema({ sellerId: { type: String, index: true }, sellerName: String, name: { type: String, required: true, index: true }, slug: String, description: String, category: String, categoryId: String, categoryName: String, brand: String, sku: String, price: { type: Number, required: true, default: 0 }, oldPrice: { type: Number, default: null }, pixPrice: { type: Number, default: null }, installmentCount: { type: Number, default: 12 }, image: String, imageUrl: String, imagem: String, mainImageUrl: String, mainImagePath: String, images: [mongoose.Schema.Types.Mixed], imageUrls: [String], imagePaths: [String], stock: { type: Number, default: 0 }, active: { type: Boolean, default: true }, specs: mongoose.Schema.Types.Mixed, dimensions: mongoose.Schema.Types.Mixed, logistics: mongoose.Schema.Types.Mixed, weight: Number, length: Number, height: Number, width: Number, isOffer: { type: Boolean, default: false }, isFavorite: { type: Boolean, default: false }, isHighlight: { type: Boolean, default: false }, isBestSeller: { type: Boolean, default: false }, isNewArrival: { type: Boolean, default: false }, isRecommended: { type: Boolean, default: false }, posters: [mongoose.Schema.Types.Mixed] }, baseOptions);
productSchema.index({ name: 'text', description: 'text', category: 'text', brand: 'text' });
const bannerSchema = new mongoose.Schema({ slot: { type: String, required: true, index: true }, targetSlot: { type: String, index: true }, title: String, subtitle: String, image: String, href: String, alt: String, active: { type: Boolean, default: true }, status: { type: String, default: 'published', index: true }, source: { type: String, default: 'manual' }, draftType: String, products: [mongoose.Schema.Types.Mixed], sortOrder: { type: Number, default: 0 }, device: { type: String, default: 'all' } }, baseOptions);
const addressSchema = new mongoose.Schema({ userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }, name: String, phone: String, cep: String, logradouro: String, numero: String, bairro: String, cidade: String, uf: String, complemento: String, reference: String, isDefault: { type: Boolean, default: false } }, baseOptions);
const ticketSchema = new mongoose.Schema({ userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, default: null }, orderId: { type: String, default: null }, protocolo: { type: String, index: true }, tipo: String, assunto: String, mensagem: String, status: { type: String, default: 'Novo' }, origem: { type: String, default: 'site' }, nome: String, email: String, telefone: String, metadata: mongoose.Schema.Types.Mixed }, baseOptions);
const contactSchema = new mongoose.Schema({ name: String, email: String, phone: String, subject: String, message: String, source: { type: String, default: 'fale_conosco' }, status: { type: String, default: 'novo' } }, baseOptions);
const denunciaSchema = new mongoose.Schema({ userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, productId: { type: String, default: null }, sellerId: { type: String, default: null }, motivo: String, descricao: String, status: { type: String, default: 'nova' }, nome: String, email: String }, baseOptions);
const orderSchema = new mongoose.Schema({ userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, default: null }, sellerIds: [String], customerName: String, customerEmail: String, customerPhone: String, status: { type: String, default: 'pendente', index: true }, statusLabel: String, items: [{ productId: String, sellerId: String, name: String, sku: String, qty: Number, unitPrice: Number, totalPrice: Number, sellerBaseUnitPrice: Number, sellerBaseTotal: Number, cardMarkupUnit: Number, cardMarkupTotal: Number, image: String }], subtotal: { type: Number, default: 0 }, shippingCost: { type: Number, default: 0 }, montagemCost: { type: Number, default: 0 }, total: { type: Number, default: 0 }, currency: { type: String, default: DEFAULT_CURRENCY }, payment: mongoose.Schema.Types.Mixed, shippingAddress: mongoose.Schema.Types.Mixed, shipping: mongoose.Schema.Types.Mixed, trackingCode: String, trackingHistory: [mongoose.Schema.Types.Mixed], notes: String, manufacturer: String, manufacturerDispatch: mongoose.Schema.Types.Mixed, status_integracao: String, whatsappNotification: mongoose.Schema.Types.Mixed, chatMeta: mongoose.Schema.Types.Mixed, nfe: mongoose.Schema.Types.Mixed, notaFiscal: mongoose.Schema.Types.Mixed, fiscal: mongoose.Schema.Types.Mixed, sige: mongoose.Schema.Types.Mixed, sellerInvoices: [mongoose.Schema.Types.Mixed], enterpriseInvoices: [mongoose.Schema.Types.Mixed],
  // TELEVENDAS — campos compartilhados no model Order existente.
  origin: { type: String, default: '', index: true },
  salesChannel: { type: String, default: '', index: true },
  operatorId: { type: String, default: '', index: true },
  operatorName: { type: String, default: '' },
  operatorEmail: { type: String, default: '' },
  paymentStatus: { type: String, default: 'not_started', index: true },
  analysisStatus: { type: String, default: 'not_required', index: true },
  paymentLinkToken: { type: String, default: '', index: true, sparse: true },
  paymentLinkExpiresAt: { type: Date, default: null },
  paymentStartedAt: { type: Date, default: null },
  customerViewedAt: { type: Date, default: null },
  approvedAt: { type: Date, default: null },
  televendas: { type: mongoose.Schema.Types.Mixed, default: null }
}, baseOptions);
orderSchema.index({ origin: 1, createdAt: -1 });
orderSchema.index({ origin: 1, status: 1, createdAt: -1 });
orderSchema.index({ origin: 1, customerEmail: 1, createdAt: -1 });

const settingsSchema = new mongoose.Schema({ key: { type: String, unique: true, index: true }, value: mongoose.Schema.Types.Mixed, updatedBy: String }, baseOptions);
const integrationAuditLogSchema = new mongoose.Schema({ scope: { type: String, default: 'integration' }, eventType: { type: String, default: 'unspecified', index: true }, orderId: { type: String, default: null, index: true }, manufacturer: { type: String, default: null, index: true }, integrationId: { type: String, default: null }, queueId: { type: String, default: null }, status: String, statusCode: Number, message: String, changedKeys: [String], request: mongoose.Schema.Types.Mixed, response: mongoose.Schema.Types.Mixed, metadata: mongoose.Schema.Types.Mixed, buildId: String }, baseOptions);
const manufacturerIntegrationSchema = new mongoose.Schema({ manufacturer: { type: String, unique: true, index: true }, enabled: { type: Boolean, default: true }, endpoint: String, method: { type: String, default: 'POST' }, headers: mongoose.Schema.Types.Mixed, authType: String, authToken: String, apiKey: String, sendAs: { type: String, default: 'json', enum: ['json', 'form'] }, timeoutMs: { type: Number, default: 30000 }, metadata: mongoose.Schema.Types.Mixed }, baseOptions);
const manufacturerDispatchQueueSchema = new mongoose.Schema({ queueId: { type: String, unique: true, index: true }, orderId: { type: String, required: true, index: true }, manufacturer: { type: String, required: true, index: true }, payload: mongoose.Schema.Types.Mixed, status: { type: String, default: 'pending', index: true }, attempts: { type: Number, default: 0 }, maxAttempts: { type: Number, default: MAX_DISPATCH_ATTEMPTS }, nextAttemptAt: { type: Date, default: now, index: true }, lastAttemptAt: Date, lastError: String, lastResponse: mongoose.Schema.Types.Mixed, deadLetter: { type: Boolean, default: false } }, baseOptions);
const operationalAlertSchema = new mongoose.Schema({ alertId: { type: String, unique: true, index: true }, type: { type: String, index: true }, severity: { type: String, default: 'medium' }, status: { type: String, default: 'open', index: true }, title: String, message: String, manufacturer: String, orderId: String, queueId: String, entityKey: String, count: { type: Number, default: 1 }, metadata: mongoose.Schema.Types.Mixed, buildId: String, firstSeenAt: Date, lastSeenAt: Date, resolvedAt: Date }, baseOptions);
const whatsappWebhookSchema = new mongoose.Schema({ event: String, remoteJid: String, number: String, pushName: String, fromMe: Boolean, text: String, payload: mongoose.Schema.Types.Mixed }, baseOptions);
const notificationSchema = new mongoose.Schema({ type: String, title: String, message: String, status: { type: String, default: 'unread' }, relatedId: String, severity: { type: String, default: 'info' }, audience: { type: String, default: 'admin', index: true }, sellerId: { type: String, default: '', index: true }, metadata: mongoose.Schema.Types.Mixed }, baseOptions);
const paymentEventSchema = new mongoose.Schema({ provider: { type: String, index: true }, eventType: String, externalId: String, orderId: String, payload: mongoose.Schema.Types.Mixed }, baseOptions);

// ============================================================
// ENTERPRISE BILLING / FATURAMENTO - ETAPA 3
// Registro incremental de faturamento por pedido, sem alterar
// a estrutura principal de pedidos já homologada.
// ============================================================
const enterpriseBillingRecordSchema = new mongoose.Schema({
  orderId: { type: String, required: true, index: true },
  orderObjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', index: true, default: null },
  manufacturer: { type: String, default: '', index: true },
  partnerRequestId: { type: String, default: '', index: true },
  environment: { type: String, default: 'sandbox', index: true },
  status: { type: String, default: 'billed', index: true },
  invoiceNumber: { type: String, default: '', index: true },
  serie: { type: String, default: '' },
  invoiceKey: { type: String, default: '', index: true },
  amount: { type: Number, default: 0 },
  currency: { type: String, default: DEFAULT_CURRENCY },
  issuedAt: Date,
  xmlUrl: { type: String, default: '' },
  danfeUrl: { type: String, default: '' },
  pdfUrl: { type: String, default: '' },
  protocol: { type: String, default: '' },
  cancelReason: { type: String, default: '' },
  cancelledAt: Date,
  payload: mongoose.Schema.Types.Mixed,
  history: [mongoose.Schema.Types.Mixed]
}, baseOptions);
enterpriseBillingRecordSchema.index({ orderId: 1, invoiceKey: 1 });

enterpriseBillingRecordSchema.index({ manufacturer: 1, createdAt: -1 });

// ============================================================
// ENTERPRISE RMA / DEVOLUÇÕES - ETAPA 4
// Registro incremental de solicitações de devolução/troca por pedido,
// mantendo histórico e vínculo com o pedido sem alterar rotas existentes.
// ============================================================
const enterpriseRmaRecordSchema = new mongoose.Schema({
  rmaId: { type: String, required: true, unique: true, index: true },
  orderId: { type: String, required: true, index: true },
  orderObjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', index: true, default: null },
  manufacturer: { type: String, default: '', index: true },
  partnerRequestId: { type: String, default: '', index: true },
  environment: { type: String, default: 'sandbox', index: true },
  status: { type: String, default: 'opened', index: true },
  type: { type: String, default: 'return', index: true },
  reason: { type: String, default: '' },
  reasonCode: { type: String, default: '' },
  authorizationCode: { type: String, default: '', index: true },
  customerName: { type: String, default: '' },
  customerEmail: { type: String, default: '' },
  customerPhone: { type: String, default: '' },
  items: [mongoose.Schema.Types.Mixed],
  amount: { type: Number, default: 0 },
  currency: { type: String, default: DEFAULT_CURRENCY },
  pickupRequired: { type: Boolean, default: false },
  pickup: mongoose.Schema.Types.Mixed,
  reverseLogistics: mongoose.Schema.Types.Mixed,
  attachments: [mongoose.Schema.Types.Mixed],
  notes: { type: String, default: '' },
  payload: mongoose.Schema.Types.Mixed,
  closedAt: Date,
  history: [mongoose.Schema.Types.Mixed]
}, baseOptions);
enterpriseRmaRecordSchema.index({ orderId: 1, status: 1 });
enterpriseRmaRecordSchema.index({ manufacturer: 1, createdAt: -1 });


// ============================================================
// ENTERPRISE OCCURRENCES / OCORRÊNCIAS - ETAPA 5
// Registro incremental de ocorrências operacionais/logísticas
// por pedido, mantendo histórico e vínculo com o pedido.
// ============================================================
const enterpriseOccurrenceRecordSchema = new mongoose.Schema({
  occurrenceId: { type: String, required: true, unique: true, index: true },
  orderId: { type: String, required: true, index: true },
  orderObjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', index: true, default: null },
  manufacturer: { type: String, default: '', index: true },
  partnerRequestId: { type: String, default: '', index: true },
  environment: { type: String, default: 'sandbox', index: true },
  type: { type: String, default: 'general', index: true },
  status: { type: String, default: 'open', index: true },
  code: { type: String, default: '', index: true },
  title: { type: String, default: '' },
  message: { type: String, default: '' },
  description: { type: String, default: '' },
  severity: { type: String, default: 'info', index: true },
  source: { type: String, default: 'enterprise_api', index: true },
  occurredAt: Date,
  resolvedAt: Date,
  metadata: mongoose.Schema.Types.Mixed,
  payload: mongoose.Schema.Types.Mixed,
  history: [mongoose.Schema.Types.Mixed]
}, baseOptions);
enterpriseOccurrenceRecordSchema.index({ orderId: 1, status: 1 });
enterpriseOccurrenceRecordSchema.index({ manufacturer: 1, createdAt: -1 });


const User = mongoose.model('User', userSchema);
const AdminAuditLog = mongoose.models.AdminAuditLog || mongoose.model('AdminAuditLog', adminAuditLogSchema);

const adminSessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true, index: true },
  userId: { type: String, required: true, index: true },
  email: { type: String, default: '', index: true },
  active: { type: Boolean, default: true, index: true },
  ip: { type: String, default: '' },
  userAgent: { type: String, default: '' },
  browser: { type: String, default: '' },
  os: { type: String, default: '' },
  device: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now, index: true },
  lastSeenAt: { type: Date, default: Date.now, index: true },
  expiresAt: { type: Date, default: null, index: true },
  revokedAt: { type: Date, default: null },
  revokedBy: { type: String, default: '' },
  revokeReason: { type: String, default: '' }
}, { versionKey: false });
adminSessionSchema.index({ userId: 1, active: 1, lastSeenAt: -1 });

const adminLoginEventSchema = new mongoose.Schema({
  userId: { type: String, default: '', index: true },
  email: { type: String, default: '', index: true },
  event: { type: String, required: true, index: true },
  success: { type: Boolean, default: true, index: true },
  sessionId: { type: String, default: '', index: true },
  ip: { type: String, default: '' },
  userAgent: { type: String, default: '' },
  browser: { type: String, default: '' },
  os: { type: String, default: '' },
  device: { type: String, default: '' },
  actorEmail: { type: String, default: '' },
  reason: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now, index: true }
}, { versionKey: false });
adminLoginEventSchema.index({ userId: 1, createdAt: -1 });

const AdminSession = mongoose.models.AdminSession || mongoose.model('AdminSession', adminSessionSchema);
const AdminLoginEvent = mongoose.models.AdminLoginEvent || mongoose.model('AdminLoginEvent', adminLoginEventSchema);

const Seller = mongoose.model('Seller', sellerSchema);
const Category = mongoose.model('Category', categorySchema);
const Product = mongoose.model('Product', productSchema);
const Banner = mongoose.model('Banner', bannerSchema);
const Address = mongoose.model('Address', addressSchema);
const Ticket = mongoose.model('Ticket', ticketSchema);
const Contact = mongoose.model('Contact', contactSchema);
const Denuncia = mongoose.model('Denuncia', denunciaSchema);
const Order = mongoose.model('Order', orderSchema);
const Setting = mongoose.model('Setting', settingsSchema);
const IntegrationAuditLog = mongoose.model('IntegrationAuditLog', integrationAuditLogSchema);
const ManufacturerIntegration = mongoose.model('ManufacturerIntegration', manufacturerIntegrationSchema);
const ManufacturerDispatchQueue = mongoose.model('ManufacturerDispatchQueue', manufacturerDispatchQueueSchema);
const OperationalAlert = mongoose.model('OperationalAlert', operationalAlertSchema);
const WhatsAppWebhook = mongoose.model('WhatsAppWebhook', whatsappWebhookSchema);
const Notification = mongoose.model('Notification', notificationSchema);

async function createAdminNotification(data = {}) {
  try {
    const title = String(data.title || 'Notificação').trim();
    const message = String(data.message || '').trim();
    if (!title && !message) return null;
    return await Notification.create({
      type: String(data.type || 'system').trim(),
      title,
      message,
      status: data.status || 'unread',
      relatedId: data.relatedId ? String(data.relatedId) : '',
      severity: data.severity || 'info',
      audience: data.audience || 'admin',
      sellerId: data.sellerId ? String(data.sellerId) : '',
      metadata: data.metadata || null
    });
  } catch (error) {
    console.error('Erro ao criar notificação administrativa:', error.message || error);
    return null;
  }
}

async function createSellerNotification(data = {}) {
  try {
    const sellerId = String(data.sellerId || '').trim();
    const title = String(data.title || 'Notificação').trim();
    const message = String(data.message || '').trim();
    if (!sellerId || (!title && !message)) return null;

    return await Notification.create({
      type: String(data.type || 'seller_system').trim(),
      title,
      message,
      status: data.status || 'unread',
      relatedId: data.relatedId ? String(data.relatedId) : '',
      severity: data.severity || 'info',
      audience: 'seller',
      sellerId,
      metadata: data.metadata || null
    });
  } catch (error) {
    console.error('Erro ao criar notificação do seller:', error.message || error);
    return null;
  }
}

function extractSellerIdsFromOrder(order = {}) {
  const obj = toJSON(order) || order || {};
  const ids = new Set();

  ensureArray(obj.sellerIds).forEach((id) => {
    const value = String(id || '').trim();
    if (value) ids.add(value);
  });

  ensureArray(obj.items).forEach((item) => {
    const value = String(item?.sellerId || item?.seller_id || '').trim();
    if (value) ids.add(value);
  });

  if (obj.manufacturer) ids.add(String(obj.manufacturer).trim());

  return Array.from(ids).filter(Boolean);
}

async function createSellerOrderNotifications(orderDoc = {}, data = {}) {
  const order = toJSON(orderDoc) || orderDoc || {};
  const sellerIds = extractSellerIdsFromOrder(order);
  if (!sellerIds.length) return [];

  const orderId = String(order._id || order.id || data.orderId || '').trim();
  const orderShort = orderId ? orderId.slice(-8).toUpperCase() : '---';
  const title = data.title || '📦 Pedido atualizado';
  const message = data.message || `Pedido #${orderShort} atualizado para ${order.statusLabel || order.status || 'Atualizado'}`;

  const results = [];
  for (const sellerId of sellerIds) {
    const doc = await createSellerNotification({
      sellerId,
      type: data.type || 'seller_order_updated',
      title,
      message,
      relatedId: orderId,
      severity: data.severity || 'info',
      metadata: {
        orderId,
        status: order.status || '',
        statusLabel: order.statusLabel || '',
        trackingCode: order.trackingCode || '',
        origin: data.origin || '',
        total: order.total || 0
      }
    });
    if (doc) results.push(doc);
  }
  return results;
}

const PaymentEvent = mongoose.model('PaymentEvent', paymentEventSchema);
const EnterpriseBillingRecord = mongoose.model('EnterpriseBillingRecord', enterpriseBillingRecordSchema);
const EnterpriseRmaRecord = mongoose.model('EnterpriseRmaRecord', enterpriseRmaRecordSchema);
const EnterpriseOccurrenceRecord = mongoose.model('EnterpriseOccurrenceRecord', enterpriseOccurrenceRecordSchema);

// ============================================================
// LOGÍSTICA / ETIQUETAS - ARIANA MÓVEIS
// Painel preparado para etiqueta manual, Correios, Frenet e
// transportadoras parceiras. No primeiro momento gera romaneio/
// etiqueta imprimível e salva rastreio no pedido.
// ============================================================
const logisticsLabelSchema = new mongoose.Schema({
  orderId: { type: String, required: true, index: true },
  orderObjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', index: true, default: null },
  provider: { type: String, default: 'manual', index: true },
  service: { type: String, default: '' },
  status: { type: String, default: 'gerada', index: true },
  trackingCode: { type: String, default: '', index: true },
  shippingCost: { type: Number, default: 0 },
  volumes: { type: Number, default: 1 },
  weightKg: { type: Number, default: 0 },
  heightCm: { type: Number, default: 0 },
  widthCm: { type: Number, default: 0 },
  lengthCm: { type: Number, default: 0 },
  notes: { type: String, default: '' },
  labelType: { type: String, default: 'manual_print' },
  labelHtml: { type: String, default: '' },
  labelUrl: { type: String, default: '' },
  rawProviderResponse: mongoose.Schema.Types.Mixed,
  createdBy: { type: String, default: '' },
  updatedBy: { type: String, default: '' }
}, baseOptions);

const LogisticsLabel = mongoose.model('LogisticsLabel', logisticsLabelSchema);


// ============================================================
// CREDIÁRIO / RECIBOS DE PARCELAS - ARIANA MÓVEIS
// Painel separado para loja física registrar parcelas pagas
// e enviar comprovante pelo WhatsApp Ariana Notificações.
// ============================================================
const crediarioClienteSchema = new mongoose.Schema({
  nome: { type: String, required: true, index: true },
  cpf: { type: String, default: '', index: true },
  telefone: { type: String, default: '', index: true },
  contrato: { type: String, default: '', index: true },
  endereco: { type: String, default: '' },
  observacao: { type: String, default: '' },
  ativo: { type: Boolean, default: true }
}, baseOptions);

const crediarioReciboSchema = new mongoose.Schema({
  recibo: { type: String, unique: true, index: true },
  clienteId: { type: mongoose.Schema.Types.ObjectId, ref: 'CrediarioCliente', index: true },
  clienteNome: String,
  clienteCpf: String,
  telefone: String,
  contrato: String,
  produto: String,
  parcela: String,
  valorPago: { type: Number, default: 0 },
  formaPagamento: { type: String, default: 'Pix' },
  dataPagamento: { type: Date, default: now },
  observacao: String,
  enviadoWhatsapp: { type: Boolean, default: false },
  enviadoWhatsappEm: Date,
  whatsappResultado: mongoose.Schema.Types.Mixed,
  criadoPor: String,
  status: { type: String, default: 'registrado', index: true },
  origem: { type: String, default: 'manual', index: true },
  sigeCodigo: { type: String, default: '', index: true },
  documento: { type: String, default: '' },
  sigeDescricao: { type: String, default: '' },
  sigeDataVencimento: Date,
  importHash: { type: String, default: '', index: true }
}, baseOptions);

const CrediarioCliente = mongoose.model('CrediarioCliente', crediarioClienteSchema);
const CrediarioRecibo = mongoose.model('CrediarioRecibo', crediarioReciboSchema);


const crediarioCobrancaLogSchema = new mongoose.Schema({
  uniqueKey: { type: String, unique: true, index: true },
  origem: { type: String, default: 'sige_auto', index: true },
  clienteNome: { type: String, default: '', index: true },
  telefone: { type: String, default: '', index: true },
  documento: { type: String, default: '', index: true },
  codigoLancamento: { type: String, default: '', index: true },
  tipo: { type: String, default: 'normal', index: true },
  diasAtraso: { type: Number, default: 0 },
  valor: { type: Number, default: 0 },
  dataVencimento: Date,
  enviado: { type: Boolean, default: false },
  enviadoEm: Date,
  whatsappResultado: mongoose.Schema.Types.Mixed,
  mensagem: String,
  erro: String,
  metadata: mongoose.Schema.Types.Mixed
}, baseOptions);

const CrediarioCobrancaLog = mongoose.model('CrediarioCobrancaLog', crediarioCobrancaLogSchema);

export {
  User,
  AdminAuditLog,
  AdminSession,
  AdminLoginEvent,
  Seller,
  Category,
  Product,
  Banner,
  Address,
  Ticket,
  Contact,
  Denuncia,
  Order,
  Setting,
  IntegrationAuditLog,
  ManufacturerIntegration,
  ManufacturerDispatchQueue,
  OperationalAlert,
  WhatsAppWebhook,
  Notification,
  PaymentEvent,
  EnterpriseBillingRecord,
  EnterpriseRmaRecord,
  EnterpriseOccurrenceRecord,
  LogisticsLabel,
  CrediarioCliente,
  CrediarioRecibo,
  CrediarioCobrancaLog
};

export function initModels() {
  return {
    User,
    AdminAuditLog,
    AdminSession,
    AdminLoginEvent,
    Seller,
    Category,
    Product,
    Banner,
    Address,
    Ticket,
    Contact,
    Denuncia,
    Order,
    Setting,
    IntegrationAuditLog,
    ManufacturerIntegration,
    ManufacturerDispatchQueue,
    OperationalAlert,
    WhatsAppWebhook,
    Notification,
    PaymentEvent,
    EnterpriseBillingRecord,
    EnterpriseRmaRecord,
    EnterpriseOccurrenceRecord,
    LogisticsLabel,
    CrediarioCliente,
    CrediarioRecibo,
    CrediarioCobrancaLog
  };
}

export default initModels;
