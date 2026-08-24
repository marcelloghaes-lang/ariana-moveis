import dotenv from 'dotenv';
dotenv.config();

import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});


import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { OAuth2Client } from 'google-auth-library';
import { generateProductPosterBuffer } from './poster-generator.js';
import manufacturerIntegrationRoutes from './routes/manufacturerIntegrationRoutes.js';
import createSigeRoutes from './routes/sige/index.js';
import registerLegacyRoutes from './routes/legacyRoutes.js';
import createWhatsappController from './controllers/whatsappController.js';
import registerCoraRoutes from './routes/coraRoutes.js';
import registerCrediarioAnalysisRoutes from './routes/crediarioAnalysisRoutes.js';
import registerCrediarioConversationRoutes from './routes/crediarioConversationRoutes.js';
import registerAdminUserRoutes from './routes/adminUserRoutes.js';
import createTelevendasRoutes from './routes/televendas/index.js';
import initModels from './models/index.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();


const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'ariana_enterprise_secret';
const MONGODB_URI = process.env.MONGODB_URI || '';
const MONGODB_DB = process.env.MONGODB_DB || 'ariana_moveis_db';
const APP_BASE_URL = (process.env.APP_BASE_URL || '').replace(/\/+$/, '');
const FRONTEND_URL = (process.env.FRONTEND_URL || process.env.SITE_URL || 'https://arianamoveis.com.br').replace(/\/+$/, '');
const RESET_PASSWORD_URL = (process.env.RESET_PASSWORD_URL || `${FRONTEND_URL}/redefinir_senha.html`).trim();
const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || '').trim();
const EMAIL_HOST = String(process.env.EMAIL_HOST || '').trim();
const EMAIL_PORT = Number(process.env.EMAIL_PORT || 587);
const EMAIL_SECURE = String(process.env.EMAIL_SECURE || '').toLowerCase() === 'true' || EMAIL_PORT === 465;
const EMAIL_USER = String(process.env.EMAIL_USER || '').trim();
const EMAIL_PASS = String(process.env.EMAIL_PASS || '').trim();
const EMAIL_FROM = String(process.env.EMAIL_FROM || EMAIL_USER || 'Ariana Móveis <no-reply@arianamoveis.com.br>').trim();
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;
const MAX_DISPATCH_ATTEMPTS = Number(process.env.MAX_DISPATCH_ATTEMPTS || 5);
const DISPATCH_RETRY_BASE_MS = Number(process.env.DISPATCH_RETRY_BASE_MS || 5 * 60 * 1000);
const DEFAULT_CURRENCY = 'BRL';

// ============================================================
// PREÇOS MARKETPLACE / PIX-CARTÃO
// Funções usadas por normalizeProductForResponse().
// Mantém a regra: PIX/BOLETO = preço base do seller;
// cartão/preço cheio = preço base convertido com margem/desconto.
// ============================================================
const MARKETPLACE_CARD_DISCOUNT_PERCENT = Number(process.env.MARKETPLACE_CARD_DISCOUNT_PERCENT || 17);

function roundMoney(value = 0) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function parseMoneyBR(value = 0) {
  if (value === null || value === undefined || value === '') return 0;

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  let text = String(value)
    .replace(/R\$/gi, '')
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(',', '.');

  const number = Number(text);

  return Number.isFinite(number) ? number : 0;
}

function getMarketplaceFactor() {
  const percent = Math.min(90, Math.max(0, Number(MARKETPLACE_CARD_DISCOUNT_PERCENT || 17)));
  const factor = (100 - percent) / 100;
  return factor > 0 ? factor : 0.83;
}

function sellerBaseToMarketplacePrice(basePrice = 0) {
  const base = Number(basePrice || 0);
  if (!Number.isFinite(base) || base <= 0) return 0;
  return roundMoney(base / getMarketplaceFactor());
}

function marketplacePriceToSellerBase(chargedPrice = 0) {
  const charged = Number(chargedPrice || 0);
  if (!Number.isFinite(charged) || charged <= 0) return 0;
  return roundMoney(charged * getMarketplaceFactor());
}

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI não configurada.');
  process.exit(1);
}

mongoose.set('strictQuery', true);
mongoose.connect(MONGODB_URI, { dbName: MONGODB_DB })
  .then(() => console.log(`✅ Mongo conectado em ${MONGODB_DB}`))
  .catch((err) => {
    console.error('❌ Erro ao conectar no Mongo:', err);
    process.exit(1);
  });

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const tmpUploadsDir = path.join(uploadsDir, '_tmp');
if (!fs.existsSync(tmpUploadsDir)) fs.mkdirSync(tmpUploadsDir, { recursive: true });
console.log(`📁 Uploads em: ${uploadsDir}`);

const allowedOrigins = [
  'http://127.0.0.1:5500',
  'http://localhost:5500',
  'http://127.0.0.1:3000',
  'http://localhost:3000',
  'https://ariana-moveis-oficial.onrender.com',
  'https://ariana-moveis.onrender.com',
  'https://arianamoveis.com.br',
  'https://www.arianamoveis.com.br',
  'https://arianamoveis.site',
  'https://www.arianamoveis.site'
];

const envFrontendOrigins = String(process.env.FRONTEND_URLS || '')
  .split(',')
  .map((item) => item.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const dynamicAllowedOrigins = Array.from(new Set(
  [...allowedOrigins, ...envFrontendOrigins]
    .map((origin) => String(origin || '').trim().replace(/\/+$/, ''))
    .filter(Boolean)
));

function normalizeCorsOrigin(origin = '') {
  return String(origin || '').trim().replace(/\/+$/, '').toLowerCase();
}

const normalizedAllowedOrigins = new Set(
  dynamicAllowedOrigins.map(normalizeCorsOrigin)
);

function isAllowedOrigin(origin = '') {
  // Requisições de servidor, Postman, webhooks e aplicativos podem não enviar Origin.
  if (!origin) return true;

  const normalized = normalizeCorsOrigin(origin);
  if (normalizedAllowedOrigins.has(normalized)) return true;

  // Domínios oficiais da Ariana Móveis.
  if (/^https:\/\/(www\.)?arianamoveis\.(com\.br|site)$/i.test(normalized)) return true;

  // Ambientes de homologação publicados na Render.
  if (/^https:\/\/[a-z0-9-]+\.onrender\.com$/i.test(normalized)) return true;

  // Desenvolvimento local em qualquer porta.
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(normalized)) return true;

  return false;
}

const corsAllowedHeaders = [
  'Origin',
  'X-Requested-With',
  'Content-Type',
  'Accept',
  'Authorization',
  'Cache-Control',
  'Pragma',
  'x-ariana-key',
  'X-Ariana-Key',
  'x-api-key',
  'X-API-Key',
  'x-webhook-signature',
  'X-Webhook-Signature'
];

const corsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) return callback(null, true);
    console.warn('[CORS BLOQUEADO]', origin);
    return callback(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: corsAllowedHeaders,
  exposedHeaders: ['Content-Length', 'Content-Type'],
  credentials: true,
  optionsSuccessStatus: 204
};

// CORS precisa vir antes de express.json() e antes de todas as rotas.
// Este middleware manual garante os cabeçalhos também nas respostas OPTIONS.
app.use((req, res, next) => {
  const origin = String(req.headers.origin || '').trim();

  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', corsAllowedHeaders.join(','));
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    if (!origin || isAllowedOrigin(origin)) return res.sendStatus(204);
    return res.status(403).json({ ok: false, error: 'Origem não autorizada pelo CORS.' });
  }

  return next();
});

app.use(cors(corsOptions));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ============================================================
// TOKEN EM LINK DE DOWNLOAD (XML/DANFE)
// Permite abrir links protegidos em nova aba quando o front envia
// ?token=JWT na URL, sem expor rotas públicas sem autenticação.
// ============================================================
app.use((req, _res, next) => {
  try {
    const hasAuth = Boolean(req.headers.authorization || req.headers.Authorization);
    const queryToken = req.query?.token || req.query?.access_token || req.query?.authToken;
    if (!hasAuth && queryToken) {
      const tokenValue = Array.isArray(queryToken) ? queryToken[0] : queryToken;
      const cleanToken = String(tokenValue || '').trim();
      if (cleanToken) req.headers.authorization = `Bearer ${cleanToken}`;
    }
  } catch (_error) {}
  next();
});
app.use('/uploads', express.static(uploadsDir, {
  setHeaders: (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=604800');
  }
}));

function buildPublicFileUrl(req, filename) {
  if (APP_BASE_URL) return `${APP_BASE_URL}/uploads/${String(filename || '').replace(/^\/+/, '')}`;
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.get('host') || '').split(',')[0].trim();
  return `${proto}://${host}/uploads/${String(filename || '').replace(/^\/+/, '')}`;
}
function now() { return new Date(); }
function uid(prefix = 'id') { return `${prefix}_${crypto.randomBytes(8).toString('hex')}`; }
function cleanPhone(value = '') { return String(value).replace(/\D/g, ''); }
function normalizePhone(value = '', defaultCountryCode = '55') {
  let digits = cleanPhone(value);
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if ((digits.length === 10 || digits.length === 11) && defaultCountryCode) digits = `${defaultCountryCode}${digits}`;
  return digits;
}
function redact(value, depth = 0) {
  if (depth > 6) return '[max-depth]';
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map(v => redact(v, depth + 1));
  if (typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const key = k.toLowerCase();
    if (key.includes('token') || key.includes('secret') || key.includes('password') || key.includes('certificate') || key.includes('private_key') || key.includes('apikey')) out[k] = '[redacted]';
    else out[k] = redact(v, depth + 1);
  }
  return out;
}
function changedKeys(before = {}, after = {}, prefix = '') {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const out = [];
  for (const key of keys) {
    const b = before ? before[key] : undefined;
    const a = after ? after[key] : undefined;
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    const bothObjects = b && a && typeof b === 'object' && typeof a === 'object' && !Array.isArray(b) && !Array.isArray(a);
    if (bothObjects) out.push(...changedKeys(b, a, nextPrefix));
    else if (JSON.stringify(b) !== JSON.stringify(a)) out.push(nextPrefix);
  }
  return out.slice(0, 200);
}
function sanitizeIdPart(value = '') {
  return String(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120) || 'item';
}

function escapeRegex(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function normalizeObjectId(id) {
  if (!id) return null;
  if (mongoose.Types.ObjectId.isValid(id)) return new mongoose.Types.ObjectId(id);
  return null;
}
function toJSON(doc) {
  if (!doc) return doc;
  const obj = typeof doc.toObject === 'function' ? doc.toObject({ virtuals: true }) : { ...doc };
  if (obj._id && !obj.id) obj.id = String(obj._id);
  return obj;
}
function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function normalizeImageEntry(img) {
  if (!img) return null;
  if (typeof img === 'string') {
    const value = String(img).trim();
    if (!value) return null;
    return { url: value, name: path.basename(value), path: value, isMain: false };
  }
  const url = String(img.url || img.imageUrl || img.downloadURL || img.downloadUrl || img.image || '').trim();
  if (!url) return null;
  return {
    url,
    name: String(img.name || path.basename(url) || 'imagem').trim(),
    path: String(img.path || img.fullPath || img.filePath || url).trim(),
    isMain: img.isMain === true,
    contentType: String(img.contentType || '').trim() || undefined,
  };
}

function normalizeProductForResponse(doc) {
  const obj = toJSON(doc) || {};
  const normalizedImages = ensureArray(obj.images).map(normalizeImageEntry).filter(Boolean);
  const fallbackUrl = String(obj.mainImageUrl || obj.imageUrl || obj.image || obj.imagem || '').trim();
  if (!normalizedImages.length && fallbackUrl) normalizedImages.push({ url: fallbackUrl, name: path.basename(fallbackUrl) || 'principal', path: String(obj.mainImagePath || fallbackUrl), isMain: true });
  if (normalizedImages.length && !normalizedImages.some((img) => img.isMain)) normalizedImages[0].isMain = true;
  const mainImage = normalizedImages.find((img) => img.isMain) || normalizedImages[0] || null;
  obj.images = normalizedImages;
  obj.image = mainImage ? mainImage.url : (fallbackUrl || '');
  obj.imageUrl = mainImage ? mainImage.url : (fallbackUrl || '');
  obj.imagem = obj.imageUrl;
  obj.mainImageUrl = mainImage ? mainImage.url : (fallbackUrl || '');
  obj.mainImagePath = mainImage ? (mainImage.path || mainImage.url) : (obj.mainImagePath || '');
  obj.imageUrls = normalizedImages.map((img) => img.url).filter(Boolean);
  obj.imagePaths = normalizedImages.map((img) => img.path || img.url).filter(Boolean);
  const sellerBasePrice = roundMoney(obj.price || obj.preco || 0);
  const marketplacePrice = sellerBaseToMarketplacePrice(sellerBasePrice);
  obj.sellerBasePrice = sellerBasePrice;
  obj.marketplacePrice = marketplacePrice;
  obj.cardPrice = marketplacePrice;
  obj.fullPrice = marketplacePrice;
  obj.pixPrice = sellerBasePrice;
  obj.pixDiscountPercent = MARKETPLACE_CARD_DISCOUNT_PERCENT;
  return obj;
}

function signToken(user) {
  return jwt.sign({ id: String(user._id), email: user.email, role: user.role || 'customer', sellerId: user.sellerId || null, admin: user.role === 'admin' }, JWT_SECRET, { expiresIn: '7d' });
}
async function authRequired(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({
      ok: false,
      error: 'Faça login para continuar.',
      code: 'admin_token_missing'
    });
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ ok: false, error: 'Usuário inválido' });
    req.user = user;
    req.auth = decoded;
    next();
  } catch (error) {
    if (error?.name === 'TokenExpiredError') {
      const header = req.headers.authorization || '';
      const expiredToken = header.startsWith('Bearer ') ? header.slice(7) : '';
      const decodedExpired = expiredToken ? jwt.decode(expiredToken) : null;
      const expiredSessionId = String(decodedExpired?.sessionId || '').trim();
      const expiredUserId = String(
        decodedExpired?.id ||
        decodedExpired?.userId ||
        decodedExpired?.uid ||
        ''
      ).trim();
      const expiredEmail = String(decodedExpired?.email || '').trim().toLowerCase();

      if (expiredSessionId && AdminSession) {
        await AdminSession.updateOne(
          { sessionId: expiredSessionId },
          {
            $set: {
              active: false,
              revokedAt: new Date(),
              revokeReason: 'token_expired'
            }
          }
        ).catch(() => null);
      }

      if (AdminLoginEvent) {
        await AdminLoginEvent.create({
          userId: expiredUserId,
          email: expiredEmail,
          event: 'token_expired',
          success: false,
          sessionId: expiredSessionId,
          ip: getClientIp(req),
          userAgent: req.headers['user-agent'] || '',
          reason: 'jwt_expired'
        }).catch(() => null);
      }

      return res.status(401).json({
        ok: false,
        error: 'Sua sessão expirou. Faça login novamente.',
        code: 'admin_token_expired'
      });
    }

    return res.status(401).json({
      ok: false,
      error: 'Token inválido',
      code: 'admin_token_invalid'
    });
  }
}

const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '').trim();
const ADMIN_NAME = String(process.env.ADMIN_NAME || 'Administrador').trim();
const SUPER_ADMIN_EMAILS = new Set(
  String(process.env.SUPER_ADMIN_EMAILS || process.env.SUPER_ADMIN_EMAIL || ADMIN_EMAIL || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);
function isSuperAdminEmail(email) {
  return SUPER_ADMIN_EMAILS.has(String(email || '').trim().toLowerCase());
}

function signAdminToken(payload = {}) {
  return jwt.sign({ role: 'admin', admin: true, active: true, isSuperAdmin: isSuperAdminEmail(payload.email), ...payload }, JWT_SECRET, { expiresIn: '7d' });
}

function adminPermissionAllowedForRoute(req, permissions = []) {
  const role = String(req.admin?.role || req.auth?.role || '').toLowerCase();
  if (role === 'admin' || req.admin?.admin === true) return true;

  const perms = new Set(Array.isArray(permissions) ? permissions : []);
  if (perms.has('*')) return true;

  const method = String(req.method || 'GET').toUpperCase();
  const pathOnly = String(req.path || req.originalUrl || '').split('?')[0];
  const has = (permission) => perms.has(permission);
  const hasAny = (...items) => items.some((item) => has(item));
  const actionPermission = (base) => {
    if (method === 'GET' || method === 'HEAD') return `${base}:read`;
    if (method === 'POST') return `${base}:create`;
    if (method === 'PUT' || method === 'PATCH') return `${base}:update`;
    if (method === 'DELETE') return `${base}:delete`;
    return '';
  };
  const allowCrud = (base, aliases = []) => {
    const wanted = actionPermission(base);
    if (wanted && has(wanted)) return true;
    return aliases.some((alias) => {
      const aliasWanted = actionPermission(alias);
      return aliasWanted && has(aliasWanted);
    });
  };

  // Identidade e sessão sempre podem ser consultadas por um colaborador autenticado.
  if (pathOnly === '/api/admin/me') return true;

  // Gestão de usuários permanece exclusiva de administradores gerais.
  if (pathOnly.startsWith('/api/admin/users')) return false;

  if (pathOnly === '/api/admin/runtime') return hasAny('dashboard:read', 'settings:read');

  if (pathOnly.startsWith('/api/admin/categories') && method === 'GET') {
    return hasAny('categories:read', 'products:read', 'products:create', 'products:update');
  }
  if (pathOnly.startsWith('/api/admin/categories')) return allowCrud('categories');

  if (pathOnly === '/api/admin/uploads' || pathOnly.startsWith('/api/admin/uploads/')) {
    if (method === 'GET') return hasAny('uploads:create', 'products:read', 'banners:read');
    return hasAny('uploads:create', 'products:create', 'products:update', 'banners:create', 'banners:update');
  }

  if (pathOnly.startsWith('/api/admin/posters/product')) return method === 'POST' && has('posters:generate');
  if (pathOnly.startsWith('/api/admin/posters/bulk') || pathOnly.startsWith('/api/admin/posters/offers')) {
    return method === 'POST' && has('posters:generate:bulk');
  }

  if (pathOnly.startsWith('/api/admin/products')) {
    if (/import/i.test(pathOnly)) return hasAny('products:import', 'products:create');
    if (/export/i.test(pathOnly)) return hasAny('products:export', 'products:read');
    if (/bulk|lote/i.test(pathOnly)) return hasAny('products:bulk', 'products:update');
    return allowCrud('products');
  }
  if (pathOnly.startsWith('/api/admin/banners')) return allowCrud('banners');
  if (pathOnly.startsWith('/api/admin/coupons')) return allowCrud('coupons');
  if (
    pathOnly.startsWith('/api/admin/marketing') ||
    pathOnly.startsWith('/api/admin/campaigns') ||
    pathOnly.startsWith('/api/admin/promotions')
  ) return allowCrud('marketing', ['banners']);

  if (pathOnly.startsWith('/api/admin/orders')) {
    if (method === 'GET') return has('orders:read');
    if (method === 'DELETE') return has('orders:cancel');
    return hasAny('orders:update', 'orders:cancel');
  }

  if (pathOnly.startsWith('/api/admin/customers') || pathOnly.startsWith('/api/admin/clients')) {
    return method === 'GET' ? has('customers:read') : has('customers:update');
  }

  if (
    pathOnly.startsWith('/api/admin/sellers') ||
    pathOnly.startsWith('/api/admin/partners') ||
    pathOnly.startsWith('/api/admin/partner-requests')
  ) {
    if (method === 'GET') return has('sellers:read');
    if (/approve|status|homolog/i.test(pathOnly)) return has('sellers:approve');
    return has('sellers:update');
  }

  if (pathOnly.startsWith('/api/admin/payments')) {
    if (method === 'GET') return has('payments:read');
    if (/refund|estorn/i.test(pathOnly)) return hasAny('payments:refund', 'payments:update');
    if (/cancel/i.test(pathOnly)) return hasAny('payments:cancel', 'payments:update');
    if (/receive|receber|confirm/i.test(pathOnly)) return hasAny('payments:receive', 'payments:update');
    return hasAny('payments:receive', 'payments:cancel', 'payments:refund', 'payments:update');
  }
  if (pathOnly.startsWith('/api/admin/finance') || pathOnly.startsWith('/api/admin/financial')) {
    if (/export/i.test(pathOnly)) return hasAny('finance:export', 'finance:read');
    if (/report|relatorio/i.test(pathOnly)) return hasAny('finance:reports', 'reports:read', 'finance:read');
    return method === 'GET' ? has('finance:read') : hasAny('finance:export', 'finance:reports', 'finance:update');
  }
  if (pathOnly.startsWith('/api/admin/crediario') || pathOnly.startsWith('/api/admin/credit')) {
    if (method === 'GET') return has('crediario:read');
    if (/reneg/i.test(pathOnly)) return hasAny('crediario:renegotiate', 'crediario:update');
    if (/parcel|receive|receber|payment/i.test(pathOnly)) return hasAny('crediario:receive', 'crediario:update');
    if (/cancel/i.test(pathOnly)) return hasAny('crediario:cancel', 'crediario:update');
    if (/document|contrato|promissoria|recibo/i.test(pathOnly)) return hasAny('crediario:documents', 'crediario:create');
    if (method === 'POST') return has('crediario:create');
    return has('crediario:update');
  }

  if (pathOnly.startsWith('/api/admin/shipping') || pathOnly.startsWith('/api/admin/logistics')) {
    if (method === 'GET') return hasAny('shipping:read', 'shipping:tracking');
    if (/quote|cot/i.test(pathOnly)) return hasAny('shipping:quote', 'shipping:create');
    if (/label|etiqueta|rotulo/i.test(pathOnly)) return hasAny('shipping:label', 'shipping:create');
    if (/dispatch|despach|enviar/i.test(pathOnly)) return hasAny('shipping:dispatch', 'shipping:update');
    if (/cancel/i.test(pathOnly)) return hasAny('shipping:cancel', 'shipping:update');
    if (/track|rastre/i.test(pathOnly)) return hasAny('shipping:tracking', 'shipping:read');
    if (/rodocap/i.test(pathOnly)) return hasAny('shipping:rodocap', 'shipping:update');
    return hasAny('shipping:quote', 'shipping:label', 'shipping:dispatch', 'shipping:create', 'shipping:update');
  }
  if (pathOnly.startsWith('/api/admin/correios')) {
    return method === 'GET' ? has('correios:read') : has('correios:create');
  }
  if (pathOnly.startsWith('/api/admin/carriers') || pathOnly.startsWith('/api/admin/transportadoras')) {
    return hasAny('carriers:manage', 'shipping:update');
  }

  if (pathOnly.startsWith('/api/admin/sige')) {
    if (method === 'GET') return has('sige:read');
    if (method === 'POST') return has('sige:create');
    return has('sige:update');
  }

  if (pathOnly.startsWith('/api/admin/enterprise') || pathOnly.startsWith('/api/enterprise')) {
    if (/sandbox/i.test(pathOnly)) return hasAny('enterprise:sandbox', 'enterprise:update');
    if (/homolog|certification/i.test(pathOnly)) return hasAny('enterprise:homologation', 'enterprise:update');
    if (/production|producao/i.test(pathOnly)) return hasAny('enterprise:production', 'enterprise:update');
    if (/logs?|history/i.test(pathOnly)) return hasAny('enterprise:logs', 'enterprise:read');
    if (/credentials?/i.test(pathOnly)) return hasAny('enterprise:credentials', 'enterprise:update');
    if (/api[-_]?keys?/i.test(pathOnly)) return hasAny('enterprise:apikeys', 'enterprise:update');
    if (/webhooks?/i.test(pathOnly)) return hasAny('enterprise:webhooks', 'enterprise:update');
    return method === 'GET' ? has('enterprise:read') : has('enterprise:update');
  }

  if (
    pathOnly.startsWith('/api/admin/reports') ||
    pathOnly.startsWith('/api/admin/analytics') ||
    pathOnly.startsWith('/api/admin/certification')
  ) {
    if (/export/i.test(pathOnly)) return hasAny('reports:export', 'reports:read');
    return has('reports:read');
  }

  if (
    pathOnly.startsWith('/api/admin/settings') ||
    pathOnly.startsWith('/api/admin/store-settings') ||
    pathOnly.startsWith('/api/admin/config')
  ) return method === 'GET' ? has('settings:read') : has('settings:update');

  if (
    pathOnly.startsWith('/api/admin/tickets') ||
    pathOnly.startsWith('/api/admin/atendimentos') ||
    pathOnly.startsWith('/api/admin/support') ||
    pathOnly.startsWith('/api/admin/ouvidoria')
  ) return method === 'GET' ? has('atendimentos:read') : has('atendimentos:update');

  if (pathOnly.startsWith('/api/admin/notifications') || pathOnly.startsWith('/api/admin/alerts')) {
    return hasAny('dashboard:read', 'atendimentos:read', 'orders:read');
  }

  // Rota administrativa não mapeada: colaboradores não recebem acesso por padrão.
  return false;
}

async function adminRequired(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({
      ok: false,
      error: 'Faça login para continuar.',
      code: 'admin_token_missing'
    });

    const decoded = jwt.verify(token, JWT_SECRET);
    const decodedRole = String(decoded.role || '').toLowerCase();

    // Compatibilidade com tokens administrativos emitidos antes do controle de sessões.
    // Na primeira requisição válida, cria uma sessão rastreável sem obrigar logout imediato.
    if (!decoded.sessionId && AdminSession) {
      const legacySessionId = `legacy-${crypto.createHash('sha256').update(token).digest('hex').slice(0, 32)}`;
      const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      const ip = forwarded || req.ip || req.socket?.remoteAddress || '';
      const userAgent = String(req.headers['user-agent'] || '');
      const browser = /Edg\//i.test(userAgent) ? 'Edge' : /Chrome\//i.test(userAgent) ? 'Chrome' : /Firefox\//i.test(userAgent) ? 'Firefox' : /Safari\//i.test(userAgent) ? 'Safari' : 'Outro';
      const os = /Windows/i.test(userAgent) ? 'Windows' : /Android/i.test(userAgent) ? 'Android' : /iPhone|iPad/i.test(userAgent) ? 'iOS' : /Mac OS/i.test(userAgent) ? 'macOS' : /Linux/i.test(userAgent) ? 'Linux' : 'Outro';
      const device = /Mobile|Android|iPhone|iPad/i.test(userAgent) ? 'Celular/Tablet' : 'Computador';
      const email = String(decoded.email || '').trim().toLowerCase();
      const decodedUserId = String(decoded.id || decoded.userId || decoded.uid || '').trim();

      // Tokens antigos do administrador do .env usavam "env-admin".
      // Quando existir um usuário administrativo cadastrado com o mesmo e-mail,
      // associa a sessão ao _id real para manter a identidade consistente.
      let resolvedUserId = decodedUserId;
      if ((!resolvedUserId || resolvedUserId === 'env-admin') && email) {
        const dbIdentity = await User.findOne({
          email,
          role: { $in: ['admin', 'staff'] }
        }).select('_id').lean().catch(() => null);
        if (dbIdentity?._id) resolvedUserId = String(dbIdentity._id);
      }
      const userId = resolvedUserId || 'env-admin';
      const expiresAt = decoded.exp
        ? new Date(Number(decoded.exp) * 1000)
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      // Upsert atômico: evita que várias requisições simultâneas criem
      // eventos session_migrated duplicados para o mesmo token antigo.
      const migrationResult = await AdminSession.updateOne(
        { sessionId: legacySessionId },
        {
          $setOnInsert: {
            sessionId: legacySessionId,
            userId,
            email,
            active: true,
            expiresAt,
            ip,
            userAgent,
            browser,
            os,
            device,
            lastSeenAt: new Date()
          },
          $set: {
            userId,
            email,
            lastSeenAt: new Date()
          }
        },
        { upsert: true }
      ).catch(() => null);

      const inserted = Boolean(
        migrationResult &&
        (migrationResult.upsertedCount === 1 || migrationResult.upsertedId)
      );

      if (inserted && AdminLoginEvent) {
        await AdminLoginEvent.create({
          userId,
          email,
          event: 'session_migrated',
          success: true,
          sessionId: legacySessionId,
          ip,
          userAgent,
          browser,
          os,
          device,
          reason: 'legacy_token'
        }).catch(() => null);
      }

      decoded.id = userId;
      decoded.userId = userId;
      decoded.uid = userId;
      decoded.sessionId = legacySessionId;
    }

    if (decoded.sessionId && AdminSession) {
      const session = await AdminSession.findOne({ sessionId: decoded.sessionId, active: true });
      if (!session || (session.expiresAt && session.expiresAt <= new Date())) {
        return res.status(401).json({ ok: false, error: 'Sessão encerrada ou expirada', code: 'admin_session_invalid' });
      }
      if (!session.lastSeenAt || Date.now() - new Date(session.lastSeenAt).getTime() > 60000) {
        session.lastSeenAt = new Date();
        await session.save().catch(() => null);
      }
      req.adminSession = session;
    }

    if (decoded && (decoded.admin === true || decodedRole === 'admin')) {
      if (decoded.id && decoded.id !== 'env-admin') {
        const dbAdmin = await User.findById(decoded.id).catch(() => null);
        if (!dbAdmin || dbAdmin.isActive === false) return res.status(403).json({ ok: false, error: 'Usuário desativado' });
        if (Number(decoded.tokenVersion || 0) !== Number(dbAdmin.tokenVersion || 0)) {
          return res.status(401).json({ ok: false, error: 'Sessão invalidada', code: 'admin_token_version_invalid' });
        }
      }
      req.admin = { ...decoded, isSuperAdmin: decoded.isSuperAdmin === true || isSuperAdminEmail(decoded.email) };
      req.user = decoded;
      req.auth = decoded;
      return next();
    }

    const user = decoded.id ? await User.findById(decoded.id) : null;
    const userRole = String(user?.role || decodedRole || '').toLowerCase();

    if (user && user.isActive === false) return res.status(403).json({ ok: false, error: 'Usuário desativado' });
    if (user && Number(decoded.tokenVersion || 0) !== Number(user.tokenVersion || 0)) {
      return res.status(401).json({ ok: false, error: 'Sessão invalidada', code: 'admin_token_version_invalid' });
    }

    if (user && userRole === 'admin') {
      req.admin = { id: String(user._id), email: user.email || '', name: user.name || ADMIN_NAME, role: 'admin', admin: true, permissions: ['*'], isSuperAdmin: isSuperAdminEmail(user.email), sessionId: decoded.sessionId || '' };
      req.user = user; req.auth = req.admin; return next();
    }

    if (user && userRole === 'staff') {
      const permissions = Array.isArray(user.permissions) ? user.permissions : [];
      req.admin = { id: String(user._id), email: user.email || '', name: user.name || 'Colaborador', role: 'staff', admin: false, permissions, sessionId: decoded.sessionId || '' };
      req.user = user; req.auth = req.admin;
      if (adminPermissionAllowedForRoute(req, permissions)) return next();
      return res.status(403).json({ ok: false, error: 'Sem permissão para esta ação', requiredPath: req.path, method: req.method });
    }
    return res.status(403).json({ ok: false, error: 'Acesso negado' });
  } catch (error) {
    if (error?.name === 'TokenExpiredError') {
      const header = req.headers.authorization || '';
      const expiredToken = header.startsWith('Bearer ') ? header.slice(7) : '';
      const decodedExpired = expiredToken ? jwt.decode(expiredToken) : null;
      const expiredSessionId = String(decodedExpired?.sessionId || '').trim();
      const expiredUserId = String(
        decodedExpired?.id ||
        decodedExpired?.userId ||
        decodedExpired?.uid ||
        ''
      ).trim();
      const expiredEmail = String(decodedExpired?.email || '').trim().toLowerCase();

      if (expiredSessionId && AdminSession) {
        await AdminSession.updateOne(
          { sessionId: expiredSessionId },
          {
            $set: {
              active: false,
              revokedAt: new Date(),
              revokeReason: 'token_expired'
            }
          }
        ).catch(() => null);
      }

      if (AdminLoginEvent) {
        await AdminLoginEvent.create({
          userId: expiredUserId,
          email: expiredEmail,
          event: 'token_expired',
          success: false,
          sessionId: expiredSessionId,
          ip: getClientIp(req),
          userAgent: req.headers['user-agent'] || '',
          reason: 'jwt_expired'
        }).catch(() => null);
      }

      return res.status(401).json({
        ok: false,
        error: 'Sua sessão expirou. Faça login novamente.',
        code: 'admin_token_expired'
      });
    }

    return res.status(401).json({
      ok: false,
      error: 'Token inválido',
      code: 'admin_token_invalid'
    });
  }
}

// Renovação automática do JWT administrativo.
// Mantém o mesmo sessionId e só renova sessões ainda válidas e ativas.
app.post('/api/admin/token/refresh', async (req, res) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

    if (!token) {
      return res.status(401).json({
        ok: false,
        error: 'Token ausente',
        code: 'admin_token_missing'
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const sessionId = String(decoded?.sessionId || '').trim();

    if (!sessionId || !AdminSession) {
      return res.status(401).json({
        ok: false,
        error: 'Sessão não registrada.',
        code: 'admin_session_invalid'
      });
    }

    const session = await AdminSession.findOne({
      sessionId,
      active: true
    });

    if (!session || (session.expiresAt && session.expiresAt <= new Date())) {
      return res.status(401).json({
        ok: false,
        error: 'Sessão encerrada ou expirada.',
        code: 'admin_session_invalid'
      });
    }

    const email = String(decoded.email || session.email || '')
      .trim()
      .toLowerCase();

    let userId = String(
      decoded.id ||
      decoded.userId ||
      decoded.uid ||
      session.userId ||
      ''
    ).trim();

    let dbUser = null;

    if (userId && userId !== 'env-admin' && mongoose.isValidObjectId(userId)) {
      dbUser = await User.findById(userId).catch(() => null);
    }

    if (!dbUser && email) {
      dbUser = await User.findOne({
        email,
        role: { $in: ['admin', 'staff'] }
      }).catch(() => null);

      if (dbUser?._id) userId = String(dbUser._id);
    }

    if (dbUser) {
      if (dbUser.isActive === false) {
        return res.status(403).json({
          ok: false,
          error: 'Usuário desativado.',
          code: 'admin_user_inactive'
        });
      }

      if (
        Number(decoded.tokenVersion || 0) !==
        Number(dbUser.tokenVersion || 0)
      ) {
        return res.status(401).json({
          ok: false,
          error: 'Sessão invalidada.',
          code: 'admin_token_version_invalid'
        });
      }
    } else if (
      userId !== 'env-admin' ||
      !ADMIN_EMAIL ||
      email !== ADMIN_EMAIL
    ) {
      return res.status(401).json({
        ok: false,
        error: 'Usuário administrativo não encontrado.',
        code: 'admin_user_not_found'
      });
    }

    const role = String(dbUser?.role || decoded.role || 'admin').toLowerCase();
    const name = String(dbUser?.name || decoded.name || ADMIN_NAME);
    const permissions =
      role === 'admin'
        ? ['*']
        : Array.isArray(dbUser?.permissions)
          ? dbUser.permissions
          : Array.isArray(decoded.permissions)
            ? decoded.permissions
            : [];

    const payload = {
      id: userId || 'env-admin',
      userId: userId || 'env-admin',
      uid: userId || 'env-admin',
      email,
      name,
      role,
      admin: role === 'admin',
      active: true,
      permissions,
      tokenVersion: Number(dbUser?.tokenVersion || decoded.tokenVersion || 0),
      sessionId
    };

    const renewedToken = signAdminToken(payload);
    const renewedDecoded = jwt.decode(renewedToken);
    const expiresAt = renewedDecoded?.exp
      ? new Date(Number(renewedDecoded.exp) * 1000)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const forwarded = String(req.headers['x-forwarded-for'] || '')
      .split(',')[0]
      .trim();
    const ip = forwarded || req.ip || req.socket?.remoteAddress || '';
    const userAgent = String(req.headers['user-agent'] || '');

    await AdminSession.updateOne(
      { sessionId, active: true },
      {
        $set: {
          userId: payload.id,
          email,
          lastSeenAt: new Date(),
          expiresAt,
          ip: ip || session.ip || '',
          userAgent: userAgent || session.userAgent || ''
        }
      }
    );

    if (AdminLoginEvent) {
      await AdminLoginEvent.create({
        userId: payload.id,
        email,
        event: 'token_renewed',
        success: true,
        sessionId,
        ip,
        userAgent,
        browser: session.browser || '',
        os: session.os || '',
        device: session.device || '',
        reason: 'automatic_refresh',
        metadata: {
          previousExpiresAt: decoded?.exp
            ? new Date(Number(decoded.exp) * 1000)
            : null,
          expiresAt
        }
      }).catch(() => null);
    }

    return res.json({
      ok: true,
      token: renewedToken,
      sessionId,
      expiresAt: expiresAt.toISOString(),
      user: {
        id: payload.id,
        email,
        name,
        role,
        admin: payload.admin,
        permissions
      }
    });
  } catch (error) {
    if (error?.name === 'TokenExpiredError') {
      return res.status(401).json({
        ok: false,
        error: 'Sua sessão expirou. Faça login novamente.',
        code: 'admin_token_expired'
      });
    }

    return res.status(401).json({
      ok: false,
      error: 'Não foi possível renovar a sessão.',
      code: 'admin_token_invalid'
    });
  }
});

function parsePossiblyJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return [trimmed];
    }
  }
  return [value];
}

function normalizeIncomingImages(body = {}, fallbackImages = []) {
  const bodyImages = parsePossiblyJsonArray(body.images);
  const bodyImageUrls = parsePossiblyJsonArray(body.imageUrls);
  const bodyImagePaths = parsePossiblyJsonArray(body.imagePaths);

  const imagesFromBody = bodyImages.map(normalizeImageEntry).filter(Boolean);
  const imagesFromFlatUrls = bodyImageUrls.map((url, index) => normalizeImageEntry({
    url,
    path: bodyImagePaths[index] || url,
    name: path.basename(String(url || '')) || `imagem_${index + 1}`,
    isMain: false,
  })).filter(Boolean);

  const merged = [...imagesFromBody, ...imagesFromFlatUrls, ...ensureArray(fallbackImages).map(normalizeImageEntry).filter(Boolean)];
  const byKey = new Map();
  for (const img of merged) {
    const key = String(img.path || img.url || img.name || '').trim();
    if (!key) continue;
    const current = byKey.get(key) || {};
    byKey.set(key, {
      ...current,
      ...img,
      url: String(img.url || current.url || '').trim(),
      path: String(img.path || current.path || img.url || '').trim(),
      name: String(img.name || current.name || path.basename(String(img.url || current.url || '')) || 'imagem').trim(),
      isMain: current.isMain === true || img.isMain === true,
    });
  }
  const normalized = Array.from(byKey.values()).filter((img) => img.url);
  const preferredMain = String(body.mainImagePath || body.mainImageUrl || body.imageUrl || body.image || body.imagem || '').trim();
  if (preferredMain) {
    normalized.forEach((img) => {
      img.isMain = img.url === preferredMain || img.path === preferredMain;
    });
  }
  if (normalized.length && !normalized.some((img) => img.isMain)) normalized[0].isMain = true;
  return normalized;
}

function productPayloadFromBody(body = {}, existingDoc = null) {
  const existing = existingDoc ? normalizeProductForResponse(existingDoc) : {};
  const imageObjects = normalizeIncomingImages(body, existing.images || []);
  const mainImageObj = imageObjects.find((img) => img.isMain) || imageObjects[0] || null;
  const fallbackMainUrl = String(body.mainImageUrl || body.imageUrl || body.image || body.imagem || existing.mainImageUrl || existing.imageUrl || existing.image || '').trim();
  const fallbackMainPath = String(body.mainImagePath || existing.mainImagePath || fallbackMainUrl || '').trim();
  const mainImageUrl = mainImageObj ? mainImageObj.url : (fallbackMainUrl || null);
  const mainImagePath = mainImageObj ? (mainImageObj.path || mainImageObj.url) : (fallbackMainPath || null);
  const skuSource = body.sku !== undefined ? body.sku : existing.sku;
  const slugSource = body.slug !== undefined ? body.slug : existing.slug;
  const nameSource = body.name ?? body.nome ?? existing.name ?? '';
  return {
    sellerId: String(body.sellerId ?? body.seller_id ?? existing.sellerId ?? '').trim(),
    sellerName: body.sellerName ?? body.seller_name ?? existing.sellerName ?? '',
    name: nameSource,
    slug: slugSource || sanitizeIdPart(nameSource || ''),
    description: body.description ?? body.descricao ?? existing.description ?? '',
    category: body.category ?? body.categoria ?? body.categoryName ?? existing.category ?? existing.categoryName ?? '',
    categoryId: body.categoryId ?? existing.categoryId ?? '',
    categoryName: body.categoryName ?? body.category ?? body.categoria ?? existing.categoryName ?? existing.category ?? '',
    brand: body.brand ?? existing.brand ?? '',
    sku: skuSource || uid('sku'),
    price: parseMoneyBR(body.price ?? body.preco ?? existing.price ?? 0) || 0,
    oldPrice: body.oldPrice !== undefined && body.oldPrice !== null && body.oldPrice !== '' ? parseMoneyBR(body.oldPrice) : (existing.oldPrice ?? null),
    pixPrice: body.pixPrice !== undefined && body.pixPrice !== null && body.pixPrice !== '' ? parseMoneyBR(body.pixPrice) : (existing.pixPrice ?? null),
    installmentCount: Number(body.installmentCount ?? existing.installmentCount ?? 12),
    image: mainImageUrl || null,
    imageUrl: mainImageUrl || null,
    imagem: mainImageUrl || null,
    mainImageUrl: mainImageUrl || null,
    mainImagePath: mainImagePath || null,
    images: imageObjects,
    imageUrls: imageObjects.map((i) => i.url).filter(Boolean),
    imagePaths: imageObjects.map((i) => i.path || i.url).filter(Boolean),
    stock: Number(body.stock ?? existing.stock ?? 0),
    active: body.active !== undefined ? body.active !== false : (existing.active !== false),
    specs: body.specs ?? existing.specs ?? {},
    dimensions: body.dimensions ?? existing.dimensions ?? {},
    logistics: body.logistics ?? existing.logistics ?? {},
    weight: body.weight !== undefined ? Number(body.weight) : existing.weight,
    length: body.length !== undefined ? Number(body.length) : existing.length,
    height: body.height !== undefined ? Number(body.height) : existing.height,
    width: body.width !== undefined ? Number(body.width) : existing.width,
    isOffer: body.isOffer !== undefined ? !!body.isOffer : !!existing.isOffer,
    isFavorite: body.isFavorite !== undefined ? !!body.isFavorite : !!existing.isFavorite,
    isHighlight: body.isHighlight !== undefined ? !!body.isHighlight : !!existing.isHighlight,
    isBestSeller: body.isBestSeller !== undefined ? !!body.isBestSeller : !!existing.isBestSeller,
    isNewArrival: body.isNewArrival !== undefined ? !!body.isNewArrival : !!existing.isNewArrival,
    isRecommended: body.isRecommended !== undefined ? !!body.isRecommended : !!existing.isRecommended,
    updatedAt: now(),
  };
}

function safeUploadFolder(input = '') {
  const clean = String(input || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  return clean.split('/').filter(Boolean).map((part) => part.replace(/[^a-zA-Z0-9._-]/g, '_')).slice(0, 5).join('/');
}



function isCloudinaryConfigured() {
  return Boolean(
    String(process.env.CLOUDINARY_CLOUD_NAME || '').trim() &&
    String(process.env.CLOUDINARY_API_KEY || '').trim() &&
    String(process.env.CLOUDINARY_API_SECRET || '').trim()
  );
}

function buildCloudinaryFolder(input = '') {
  const folder = safeUploadFolder(input || 'geral') || 'geral';
  return `ariana_moveis/${folder}`;
}

async function uploadToCloudinary(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'Nenhum arquivo enviado' });
    }

    if (!isCloudinaryConfigured()) {
      if (req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(500).json({ ok: false, error: 'Cloudinary não configurado.' });
    }

    const targetFolder = buildCloudinaryFolder(req.body?.path || req.query?.path || 'produtos');
    const nomeOriginal = req.body?.name || req.body?.nome || req.body?.productName || req.file?.originalname || 'produto';

    const slug = String(nomeOriginal || 'produto')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 90) || 'produto';

    // Pipeline Ariana Móveis:
    // - gera novo arquivo no Cloudinary com nome padronizado;
    // - limita imagens grandes a 1600x1600;
    // - remove perfil/metadados quando possível;
    // - otimiza qualidade e formato automaticamente para web.
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: targetFolder,
      public_id: `${slug}-${Date.now()}`,
      resource_type: 'image',
      overwrite: true,
      invalidate: true,
      transformation: [
        { width: 1600, height: 1600, crop: 'limit' },
        { quality: 'auto:good', fetch_format: 'auto', flags: 'strip_profile' }
      ]
    });

    if (req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

    return res.json({
      ok: true,
      url: result.secure_url,
      secure_url: result.secure_url,
      public_id: result.public_id,
      path: result.public_id,
      format: result.format,
      bytes: result.bytes,
      width: result.width,
      height: result.height,
      folder: targetFolder
    });
  } catch (error) {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error('Erro no upload:', error);
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao enviar imagem para o Cloudinary' });
  }
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, tmpUploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '');
    const base = path.basename(file.originalname || 'arquivo', ext).replace(/[^\w\-]+/g, '_');
    cb(null, `${Date.now()}-${base}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

const {
  baseOptions,
  userSchema,
  sellerSchema,
  categorySchema,
  productSchema,
  bannerSchema,
  addressSchema,
  ticketSchema,
  contactSchema,
  denunciaSchema,
  orderSchema,
  settingsSchema,
  integrationAuditLogSchema,
  manufacturerIntegrationSchema,
  manufacturerDispatchQueueSchema,
  operationalAlertSchema,
  whatsappWebhookSchema,
  notificationSchema,
  paymentEventSchema,
  enterpriseBillingRecordSchema,
  enterpriseRmaRecordSchema,
  enterpriseOccurrenceRecordSchema,
  logisticsLabelSchema,
  crediarioClienteSchema,
  crediarioReciboSchema,
  crediarioCobrancaLogSchema,
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
} = initModels({ mongoose, DEFAULT_CURRENCY, MAX_DISPATCH_ATTEMPTS, now });


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



// ============================================================
// NOTIFICAÇÕES DE NOVA VENDA DO SITE
// Garante que todo POST /api/orders concluído com sucesso:
// 1) crie uma notificação não lida no painel administrativo;
// 2) envie ao cliente a confirmação inicial pela instância Ariana_Notificacoes.
// O processamento ocorre após a resposta do pedido e nunca bloqueia a compra.
// ============================================================
function pickFirstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function extractCreatedOrderCandidate(responsePayload = {}, requestBody = {}) {
  const payload = responsePayload && typeof responsePayload === 'object' ? responsePayload : {};
  const candidate =
    payload.order || payload.pedido || payload.item || payload.data?.order || payload.data?.pedido ||
    payload.data || payload.result?.order || payload.result || payload;

  return candidate && typeof candidate === 'object'
    ? { ...(requestBody || {}), ...candidate }
    : { ...(requestBody || {}) };
}

function extractOrderPhone(order = {}, fallback = {}) {
  return pickFirstNonEmpty(
    order.customerPhone,
    order.phone,
    order.telefone,
    order.whatsapp,
    order.customer?.phone,
    order.customer?.telefone,
    order.customer?.whatsapp,
    order.client?.phone,
    order.client?.telefone,
    order.cliente?.telefone,
    order.shippingAddress?.phone,
    order.shippingAddress?.telefone,
    order.deliveryAddress?.phone,
    order.deliveryAddress?.telefone,
    order.address?.phone,
    order.address?.telefone,
    fallback.customerPhone,
    fallback.phone,
    fallback.telefone,
    fallback.whatsapp,
    fallback.customer?.phone,
    fallback.customer?.telefone,
    fallback.shippingAddress?.phone,
    fallback.shippingAddress?.telefone
  );
}

function extractOrderCustomerName(order = {}, fallback = {}) {
  return String(pickFirstNonEmpty(
    order.customerName,
    order.clientName,
    order.nomeCliente,
    order.customer?.name,
    order.customer?.nome,
    order.client?.name,
    order.client?.nome,
    order.cliente?.nome,
    order.shippingAddress?.name,
    order.shippingAddress?.nome,
    fallback.customerName,
    fallback.clientName,
    fallback.nomeCliente,
    fallback.customer?.name,
    fallback.customer?.nome
  ) || 'Cliente').trim();
}

function extractOrderTotal(order = {}, fallback = {}) {
  const value = pickFirstNonEmpty(
    order.total,
    order.totalAmount,
    order.amount,
    order.valorTotal,
    order.totals?.total,
    order.totals?.grandTotal,
    order.payment?.amount,
    fallback.total,
    fallback.totalAmount,
    fallback.amount,
    fallback.valorTotal,
    fallback.totals?.total
  );
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function buildNewOrderCustomerMessage(order = {}, requestBody = {}) {
  const orderId = String(order._id || order.id || order.orderId || order.pedidoId || '').trim();
  const shortId = orderId ? orderId.slice(-8).toUpperCase() : 'GERADO';
  const customerName = extractOrderCustomerName(order, requestBody);
  const total = extractOrderTotal(order, requestBody);
  const paymentMethod = String(pickFirstNonEmpty(
    order.paymentMethod,
    order.payment?.method,
    order.payment?.type,
    order.formaPagamento,
    requestBody.paymentMethod,
    requestBody.payment?.method,
    requestBody.formaPagamento
  ) || '').trim();

  const lines = [
    `✅ Pedido recebido pela Ariana Móveis`,
    '',
    `Olá, ${customerName}! 👋`,
    '',
    `Recebemos seu pedido #${shortId} com sucesso.`,
    total > 0 ? `💰 Valor do pedido: ${formatMoneyBRL(total)}` : '',
    paymentMethod ? `💳 Forma de pagamento: ${paymentMethod}` : '',
    '',
    'Você receberá novas mensagens por este WhatsApp sempre que houver atualização importante na compra, no pagamento ou na entrega.',
    '',
    '💙 Obrigado por comprar na Ariana Móveis.'
  ];

  return lines.filter(Boolean).join('\n');
}

async function notifyNewMarketplaceOrder(responsePayload = {}, requestBody = {}) {
  try {
    const candidate = extractCreatedOrderCandidate(responsePayload, requestBody);
    const orderId = String(candidate._id || candidate.id || candidate.orderId || candidate.pedidoId || '').trim();
    let order = candidate;

    if (orderId && mongoose.isValidObjectId(orderId)) {
      const dbOrder = await Order.findById(orderId).lean().catch(() => null);
      if (dbOrder) order = { ...(requestBody || {}), ...dbOrder };
    }

    const resolvedId = String(order._id || order.id || orderId || '').trim();
    const shortId = resolvedId ? resolvedId.slice(-8).toUpperCase() : 'NOVO';
    const customerName = extractOrderCustomerName(order, requestBody);
    const total = extractOrderTotal(order, requestBody);

    // Evita duplicação caso a mesma resposta seja processada novamente.
    const alreadyNotified = resolvedId
      ? await Notification.exists({ type: 'new_order', relatedId: resolvedId }).catch(() => false)
      : false;

    if (!alreadyNotified) {
      await createAdminNotification({
        type: 'new_order',
        title: '🛒 Nova venda no site',
        message: `Pedido #${shortId} de ${customerName}${total > 0 ? ` no valor de ${formatMoneyBRL(total)}` : ''}.`,
        status: 'unread',
        relatedId: resolvedId,
        severity: 'success',
        audience: 'admin',
        metadata: {
          orderId: resolvedId,
          customerName,
          total,
          source: 'marketplace_checkout',
          event: 'order_created'
        }
      });
    }

    const phone = extractOrderPhone(order, requestBody);
    if (!phone) {
      console.warn('[nova-venda] Pedido criado sem telefone para WhatsApp:', resolvedId || shortId);
      return { ok: true, adminNotified: !alreadyNotified, whatsapp: false, reason: 'phone_missing' };
    }

    const text = buildNewOrderCustomerMessage(order, requestBody);
    await waSendTextMessage({ number: phone, text });

    console.log('[nova-venda] Painel e cliente notificados:', resolvedId || shortId);
    return { ok: true, adminNotified: !alreadyNotified, whatsapp: true };
  } catch (error) {
    console.error('[nova-venda] Falha ao processar notificações:', error?.responseData || error?.message || error);
    return { ok: false, error: error?.message || 'notification_failed' };
  }
}


// Models de pagamentos, Enterprise, logística e crediário foram extraídos para models/index.js na Etapa 26.



function normalizeBannerPayload(input = {}, fallback = {}) {
  const source = { ...(fallback || {}), ...(input || {}) };
  const slot = String(source.slot || source.id || fallback.slot || '').trim();
  return {
    slot,
    targetSlot: String(source.targetSlot || source.slot || '').trim(),
    title: String(source.title || '').trim(),
    subtitle: String(source.subtitle || '').trim(),
    image: String(source.image || source.imageUrl || '').trim(),
    href: String(source.href || source.linkUrl || '').trim(),
    alt: String(source.alt || '').trim(),
    active: source.active === true || String(source.active).toLowerCase() == 'true',
    status: String(source.status || (source.active === false ? 'draft' : 'published')).trim(),
    source: String(source.source || 'manual').trim(),
    draftType: String(source.draftType || '').trim(),
    products: Array.isArray(source.products) ? source.products : [],
    sortOrder: Number(source.sortOrder || 0),
    device: String(source.device || 'all').trim() || 'all',
  };
}

function normalizeBannerForResponse(doc) {
  const obj = toJSON(doc) || {};
  return {
    ...obj,
    id: String(obj.slot || obj.id || obj._id || ''),
    slot: String(obj.slot || obj.id || ''),
    imageUrl: String(obj.image || obj.imageUrl || '').trim(),
    linkUrl: String(obj.href || obj.linkUrl || '').trim(),
    targetSlot: String(obj.targetSlot || obj.slot || '').trim(),
    status: String(obj.status || (obj.active === false ? 'draft' : 'published')).trim(),
    source: String(obj.source || 'manual').trim(),
    draftType: String(obj.draftType || '').trim(),
    products: Array.isArray(obj.products) ? obj.products : [],
    alt: String(obj.alt || '').trim(),
  };
}

function parseBannerInput(body = {}) {
  if (Array.isArray(body?.banners)) return body.banners;
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const values = Object.values(body);
    if (values.length && values.every((item) => item && typeof item === 'object')) return values;
  }
  return [];
}

const WHATSAPP_EVOLUTION_DEFAULT_API_URL = process.env.EVOLUTION_API_URL || 'http://167.86.108.75:8082';
const WHATSAPP_EVOLUTION_DEFAULT_INSTANCE =
  process.env.EVOLUTION_NOTIFY_INSTANCE ||
  process.env.EVOLUTION_INSTANCE_NOTIFICACOES ||
  'Ariana_Notificacoes';
const WHATSAPP_EVOLUTION_DEFAULT_WEBHOOK_URL = process.env.EVOLUTION_WEBHOOK_URL || `${APP_BASE_URL || 'http://localhost:3000'}/api/whatsapp/webhook`;
const DEFAULT_WHATSAPP_SETTINGS = { enabled: String(process.env.EVOLUTION_ENABLED || 'true').toLowerCase() !== 'false', apiUrl: WHATSAPP_EVOLUTION_DEFAULT_API_URL, apiKey: process.env.EVOLUTION_API_KEY || '', instanceName: WHATSAPP_EVOLUTION_DEFAULT_INSTANCE, webhookUrl: WHATSAPP_EVOLUTION_DEFAULT_WEBHOOK_URL, webhookEvents: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'SEND_MESSAGE', 'CONNECTION_UPDATE'], webhookByEvents: false, webhookBase64: false, autoNotifyOrderStatus: true, chatNotifyEnabled: true, defaultCountryCode: '55', statusTemplate: 'Olá, {customerName}! Seu pedido {orderId} na Ariana Móveis agora está em: {status}.{trackingLine}', testNumber: process.env.EVOLUTION_TEST_NUMBER || '', testMessage: 'Olá! Este é um teste de integração do WhatsApp da Ariana Móveis.', adminNotifyNumbers: process.env.EVOLUTION_ADMIN_NOTIFY_NUMBERS || process.env.EVOLUTION_ADMIN_NUMBER || '' };
const DEFAULT_PAYMENTS_SETTINGS = {
  mercadopago: {
    enabled: true,
    accessToken: process.env.MP_ACCESS_TOKEN || '',
    publicKey: process.env.MP_PUBLIC_KEY || '',
    webhookSecret: process.env.MP_WEBHOOK_SECRET || '',
    splitEnabled: true,
    marketplaceFeePercent: Number(process.env.MARKETPLACE_COMMISSION_PERCENT || 12)
  },
  pagarme: {
    enabled: true,
    apiKey: process.env.PAGARME_API_KEY || '',
    publicKey: process.env.PAGARME_PUBLIC_KEY || '',
    endpoint: process.env.PAGARME_API_URL || 'https://api.pagar.me/core/v5',
    marketplaceRecipientId: process.env.PAGARME_MARKETPLACE_RECIPIENT_ID || '',
    splitEnabled: true,
    marketplaceFeePercent: Number(process.env.MARKETPLACE_COMMISSION_PERCENT || 12)
  },
  cielo: {
    enabled: false,
    merchantId: process.env.CIELO_MERCHANT_ID || '',
    merchantKey: process.env.CIELO_MERCHANT_KEY || '',
    apiUrl: process.env.CIELO_API_URL || 'https://api.cieloecommerce.cielo.com.br',
    marketplaceMerchantId: process.env.CIELO_MARKETPLACE_MERCHANT_ID || process.env.CIELO_SUBORDINATE_MARKETPLACE_ID || '',
    splitEnabled: true,
    marketplaceFeePercent: Number(process.env.MARKETPLACE_COMMISSION_PERCENT || 12)
  }
};
const RODOCAP_ALLOWED_CITIES = ['AGUA BOA', 'AGUANIL', 'ANGELANDIA', 'ARAUJOS', 'ARCOS', 'ARICANDUVA', 'BAMBUI', 'BELO HORIZONTE', 'BETIM', 'BOCAIUVA', 'BORDA DA MATA', 'BRASILIA DE MINAS', 'CACHOEIRA DE MINAS', 'CAETABOPOLIS', 'CAMANDUCAIA', 'CAMBUI', 'CAMBUQUIRA', 'CAMPANHA', 'CAMPO BELO', 'CANDEIAS', 'CANTAGALO', 'CAPELINHA', 'CAPIM BRANCO', 'CAPITAO ENEAS', 'CAPITOLIO', 'CARBONITA', 'CAREACU', 'CARMO DO CAJURU', 'CHAPADA DO NORTE', 'CLAUDIO', 'CONCEICAO DO PARA', 'CONCEICAO DOS OUROS', 'CONFINS', 'CONGONHAL', 'CONTAGEM', 'CORINTO', 'CORREGO FUNDO', 'COUTO DE MAGALHAES DE MINAS', 'CRISTAIS', 'CURVELO', 'DATAS', 'DIAMANTINA', 'DIVINOLANDIA DE MINAS', 'DIVINOPOLIS', 'DORES DE GUANHAES', 'ESTIVA', 'FELIXLANDIA', 'FERROS', 'FORMIGA', 'FRANCISCO SA', 'GOUVEIA', 'GUANHAES', 'IBIRITE', 'IGARATINGA', 'IGUATAMA', 'INIMUTABA', 'ITABIRA', 'ITAMARANDIBA', 'ITAUNA', 'JANAUBA', 'JANUARIA', 'JAPONVAR', 'JOSE RAYDAN', 'LAGOA DA PRATA', 'LAGOA SANTA', 'LAVRAS', 'LONTRA', 'MATERLANDIA', 'MATOZINHOS', 'MINAS NOVAS', 'MIRABELA', 'MONTES CLAROS', 'NOVA LIMA', 'NOVA PORTEIRINHA', 'NOVA SERRANA', 'OLIVEIRA', 'PAINS', 'PARA DE MINAS', 'PARAOPEBA', 'PECANHA', 'PERDIGAO', 'PERDOES', 'PIMENTA', 'PITANGUI', 'PIUMHI', 'PORTEIRINHA', 'POUSO ALEGRE', 'PRUDENTE DE MORAIS', 'RIBEIRAO DAS NEVES', 'RIO VERMELHO', 'SABARA', 'SABINOPOLIS', 'SALINAS', 'SANTA LUZIA', 'SANTA MARIA DE ITABIRA', 'SANTA MARIA DO SUACUI', 'SANTA RITA DO SAPUCAI', 'SANTANA DO JACARE', 'SAO BENTO ABADE', 'SAO GONCALO DO PARA', 'SAO JOAO EVANGELISTA', 'SAO JOSE DA LAPA', 'SAO JOSE DO JACURI', 'SAO PEDRO DO SUACUI', 'SAO SEBASTIAO DA BELA VISTA', 'SAO SEBASTIAO DO OESTE', 'SAO SEBASTIAO DO SAPUCAI', 'SARZEDO', 'SENHORA DO PORTO', 'SERRO', 'SETE LAGOAS', 'SILVIANOPOLIS', 'TAIOBEIRAS', 'TRES CORACOES', 'TURMALINA', 'VARGINHA', 'VEREDINHA', 'VESPASIANO', 'VIRGINOPOLIS', 'ARUJA', 'BARUERI', 'CAJAMAR', 'CAMPINAS', 'CARAPICUIBA', 'COTIA', 'DIADEMA', 'EMBU DAS ARTES', 'FERRAZ DE VASCONCELOS', 'GUARULHOS', 'HORTOLANDIA', 'INDAIATUBA', 'ITAPECERICA DA SERRA', 'ITAQUAQUECETUBA', 'ITUPEVA', 'JANDIRA', 'JUNDIAI', 'LOUVEIRA', 'MAUA', 'MOGI DAS CRUZES', 'OSASCO', 'POA', 'RIBEIRAO PIRES', 'SANTANA DE PARNAIBA', 'SANTO ANDRE', 'SAO BERNARDO DO CAMPO', 'SAO CAETANO DO SUL', 'SAO PAULO', 'SUZANO', 'TABOAO DA SERRA', 'VALINHOS', 'VARGEM GRANDE PAULISTA', 'VARZEA PAULISTA', 'VINHEDO'];
const DEFAULT_SHIPPING_SETTINGS = { montagemPercent: 0.12, correios: { enabled: true, origemCep: process.env.LOJA_ORIGEM_CEP || '', servicos: String(process.env.CORREIOS_SERVICOS || '03298,03328').split(',').map(s => String(s).trim()).filter(Boolean), pesoKgPadrao: 1, alturaCmPadrao: 10, larguraCmPadrao: 15, comprimentoCmPadrao: 20, valorDeclaradoPadrao: 0, maxWeightKg: 30, maxDimensionCm: 100 }, businessRules: { arianaMoveis: { enabled: true, sellerNames: ['ARIANA MOVEIS', 'ARIANA MÓVEIS'], freeCepStart: '39740-000', freeCepEnd: '39740-000', localOriginCep: '39740-000', localMaxKmTier1: 30, localPriceTier1: 80, localMaxKmTier2: 70, localPriceTier2: 120, phoneFlatPrice: 19.90, phoneFlatEnabled: true, label: 'Ariana Entrega', prazo: '1 a 3 dias úteis' }, snDigital: { enabled: false, appliesToArianaLogistics: false, maxKmTier1: 30, priceTier1: 80, maxKmTier2: 70, priceTier2: 120, label: 'Ariana Entrega', prazo: '1 a 3 dias úteis' }, rodocap: { enabled: true, appliesToArianaLogistics: true, minKmExclusive: 70, percentOfInvoice: 0.12, label: 'Rodocap', prazoPadrao: 'sob consulta', allowedCities: RODOCAP_ALLOWED_CITIES, onlyUrbanArea: true } }, carriers: { correios: { enabled: true, maxWeightKg: 30, maxDimensionCm: 100 }, frenet: { enabled: String(process.env.FRENET_ENABLED || '').toLowerCase() === 'true' || !!process.env.FRENET_TOKEN || !!process.env.FRENET_API_TOKEN, token: process.env.FRENET_TOKEN || process.env.FRENET_API_TOKEN || '', apiUrl: process.env.FRENET_API_URL || 'https://api.frenet.com.br', origemCep: process.env.FRENET_ORIGIN_CEP || process.env.LOJA_ORIGEM_CEP || '', maxWeightKg: Number(process.env.FRENET_MAX_WEIGHT_KG || 100), maxDimensionCm: Number(process.env.FRENET_MAX_DIMENSION_CM || 200) }, totalExpress: { enabled: false, maxWeightKg: 30, maxDimensionCm: 110 }, ownDelivery: { enabled: true, tiers: [{ maxKm: 30, price: 80 }, { maxKm: 70, price: 120 }] } } };

async function getSetting(key, fallback = null) { const doc = await Setting.findOne({ key }); return doc ? doc.value : fallback; }
async function setSetting(key, value, updatedBy = 'system') { const doc = await Setting.findOneAndUpdate({ key }, { $set: { value, updatedBy } }, { upsert: true, new: true }); return doc.value; }
async function getWhatsappSettings() {
  const value = await getSetting('whatsapp_evolution', DEFAULT_WHATSAPP_SETTINGS);
  const merged = { ...DEFAULT_WHATSAPP_SETTINGS, ...(value || {}) };

  // Garante que variáveis do Render não sejam anuladas por configuração antiga/vazia salva no MongoDB.
  merged.enabled = String(process.env.EVOLUTION_ENABLED || (merged.enabled === false ? 'false' : 'true')).toLowerCase() !== 'false';
  merged.apiUrl = String(process.env.EVOLUTION_API_URL || merged.apiUrl || WHATSAPP_EVOLUTION_DEFAULT_API_URL || '').trim();
  // Usa sempre a instância de NOTIFICAÇÕES para vendas/status, sem cair na instância SAC.
  merged.instanceName = String(
    process.env.EVOLUTION_NOTIFY_INSTANCE ||
    process.env.EVOLUTION_INSTANCE_NOTIFICACOES ||
    'Ariana_Notificacoes'
  ).trim();
  merged.apiKey = String(process.env.EVOLUTION_API_KEY || merged.apiKey || '').trim();
  merged.adminNotifyNumbers = String(process.env.EVOLUTION_ADMIN_NOTIFY_NUMBERS || process.env.EVOLUTION_ADMIN_NUMBER || merged.adminNotifyNumbers || '').trim();
  merged.defaultCountryCode = String(merged.defaultCountryCode || '55').trim();
  merged.autoNotifyOrderStatus = merged.autoNotifyOrderStatus !== false;
  merged.chatNotifyEnabled = merged.chatNotifyEnabled !== false;
  return merged;
}
async function saveWhatsappSettings(data, updatedBy = 'system') { const current = await getWhatsappSettings(); const merged = { ...current, ...(data || {}) }; merged.instanceName = String(process.env.EVOLUTION_NOTIFY_INSTANCE || process.env.EVOLUTION_INSTANCE_NOTIFICACOES || 'Ariana_Notificacoes').trim(); await setSetting('whatsapp_evolution', merged, updatedBy); return merged; }

async function waSendTextMessage({ number = '', text = '', delay = 0 } = {}) {
  const settings = await getWhatsappSettings();
  if (settings.enabled === false) {
    throw new Error('WhatsApp desativado nas configurações.');
  }

  const apiUrl = String(settings.apiUrl || WHATSAPP_EVOLUTION_DEFAULT_API_URL || '').replace(/\/+$/, '');
  const instanceName = String(settings.instanceName || WHATSAPP_EVOLUTION_DEFAULT_INSTANCE || '').trim();
  const apiKey = String(settings.apiKey || process.env.EVOLUTION_API_KEY || '').trim();
  const to = normalizePhone(number || '', settings.defaultCountryCode || '55');
  const message = String(text || '').trim();

  if (!apiUrl) throw new Error('EVOLUTION_API_URL não configurada.');
  if (!instanceName) throw new Error('Instância do WhatsApp não configurada.');
  if (!apiKey) throw new Error('EVOLUTION_API_KEY não configurada.');
  if (!to) throw new Error('Número de WhatsApp inválido.');
  if (!message) throw new Error('Mensagem de WhatsApp vazia.');

  const payload = {
    number: to,
    text: message,
    delay: Number(delay || 0)
  };

  const response = await axios.post(
    `${apiUrl}/message/sendText/${encodeURIComponent(instanceName)}`,
    payload,
    {
      headers: {
        'Content-Type': 'application/json',
        apikey: apiKey
      },
      timeout: 30000,
      validateStatus: () => true
    }
  );

  if (response.status < 200 || response.status >= 300) {
    const errorMessage = typeof response.data === 'string'
      ? response.data
      : (response.data?.message || response.data?.error || `Erro Evolution API HTTP ${response.status}`);
    const err = new Error(errorMessage);
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

  return {
    ok: true,
    provider: 'evolution',
    instanceName,
    number: to,
    status: response.status,
    data: response.data
  };
}

async function getPaymentsSettings() {
  const value = await getSetting('payments', DEFAULT_PAYMENTS_SETTINGS);
  return {
    mercadopago: { ...DEFAULT_PAYMENTS_SETTINGS.mercadopago, ...(value?.mercadopago || {}) },
    pagarme: { ...DEFAULT_PAYMENTS_SETTINGS.pagarme, ...(value?.pagarme || {}) },
    cielo: { ...DEFAULT_PAYMENTS_SETTINGS.cielo, ...(value?.cielo || {}) }
  };
}
async function saveShippingSettings(data, updatedBy = 'system') { const current = await getShippingSettings(); const incoming = data || {}; const merged = { ...current, ...incoming, correios: { ...(current.correios || {}), ...((incoming && incoming.correios) || {}) }, businessRules: { ...(current.businessRules || {}), ...((incoming && incoming.businessRules) || {}), arianaMoveis: { ...((current.businessRules || {}).arianaMoveis || {}), ...(((incoming && incoming.businessRules) || {}).arianaMoveis || {}) }, snDigital: { ...((current.businessRules || {}).snDigital || {}), ...(((incoming && incoming.businessRules) || {}).snDigital || {}) }, rodocap: { ...((current.businessRules || {}).rodocap || {}), ...(((incoming && incoming.businessRules) || {}).rodocap || {}), allowedCities: Array.isArray((((incoming && incoming.businessRules) || {}).rodocap || {}).allowedCities) && (((incoming && incoming.businessRules) || {}).rodocap || {}).allowedCities.length ? (((incoming && incoming.businessRules) || {}).rodocap || {}).allowedCities : (((current.businessRules || {}).rodocap || {}).allowedCities || RODOCAP_ALLOWED_CITIES) } }, carriers: { ...(current.carriers || {}), ...((incoming && incoming.carriers) || {}), correios: { ...((current.carriers || {}).correios || {}), ...(((incoming && incoming.carriers) || {}).correios || {}), enabled: ((incoming && incoming.correios && incoming.correios.enabled !== undefined) ? incoming.correios.enabled : ((((incoming && incoming.carriers) || {}).correios || {}).enabled ?? ((current.carriers || {}).correios || {}).enabled)), maxWeightKg: Number((((incoming && incoming.correios) || {}).maxWeightKg) || ((((incoming && incoming.carriers) || {}).correios || {}).maxWeightKg) || (((current.carriers || {}).correios || {}).maxWeightKg) || 30), maxDimensionCm: Number((((incoming && incoming.correios) || {}).maxDimensionCm) || ((((incoming && incoming.carriers) || {}).correios || {}).maxDimensionCm) || (((current.carriers || {}).correios || {}).maxDimensionCm) || 100) } } }; await setSetting('shipping', merged, updatedBy); return merged; }
async function getShippingSettings() { const value = await getSetting('shipping', DEFAULT_SHIPPING_SETTINGS); const merged = { ...DEFAULT_SHIPPING_SETTINGS, ...(value || {}), correios: { ...(DEFAULT_SHIPPING_SETTINGS.correios || {}), ...(((value || {}).correios) || {}) }, businessRules: { ...(DEFAULT_SHIPPING_SETTINGS.businessRules || {}), ...(((value || {}).businessRules) || {}), arianaMoveis: { ...((DEFAULT_SHIPPING_SETTINGS.businessRules || {}).arianaMoveis || {}), ...((((value || {}).businessRules) || {}).arianaMoveis || {}) }, snDigital: { ...((DEFAULT_SHIPPING_SETTINGS.businessRules || {}).snDigital || {}), ...((((value || {}).businessRules) || {}).snDigital || {}) }, rodocap: { ...((DEFAULT_SHIPPING_SETTINGS.businessRules || {}).rodocap || {}), ...((((value || {}).businessRules) || {}).rodocap || {}), allowedCities: Array.isArray(((((value || {}).businessRules) || {}).rodocap || {}).allowedCities) && ((((value || {}).businessRules) || {}).rodocap || {}).allowedCities.length ? ((((value || {}).businessRules) || {}).rodocap || {}).allowedCities : (((DEFAULT_SHIPPING_SETTINGS.businessRules || {}).rodocap || {}).allowedCities || RODOCAP_ALLOWED_CITIES) } }, carriers: { ...(DEFAULT_SHIPPING_SETTINGS.carriers || {}), ...(((value || {}).carriers) || {}) } }; merged.carriers = merged.carriers || {}; merged.carriers.correios = { ...(DEFAULT_SHIPPING_SETTINGS.carriers.correios || {}), ...((merged.carriers || {}).correios || {}), enabled: merged.correios.enabled !== undefined ? merged.correios.enabled : ((merged.carriers || {}).correios || {}).enabled, maxWeightKg: Number((merged.correios.maxWeightKg !== undefined ? merged.correios.maxWeightKg : ((merged.carriers || {}).correios || {}).maxWeightKg) || 30), maxDimensionCm: Number((merged.correios.maxDimensionCm !== undefined ? merged.correios.maxDimensionCm : ((merged.carriers || {}).correios || {}).maxDimensionCm) || 100) };
merged.carriers.frenet = { ...(DEFAULT_SHIPPING_SETTINGS.carriers.frenet || {}), ...((merged.carriers || {}).frenet || {}) };
merged.carriers.frenet.enabled = String(process.env.FRENET_ENABLED || (merged.carriers.frenet.enabled === false ? 'false' : '')).toLowerCase() === 'false' ? false : (merged.carriers.frenet.enabled !== false);
merged.carriers.frenet.token = String(process.env.FRENET_TOKEN || process.env.FRENET_API_TOKEN || merged.carriers.frenet.token || '').trim();
merged.carriers.frenet.apiUrl = String(process.env.FRENET_API_URL || merged.carriers.frenet.apiUrl || 'https://api.frenet.com.br').replace(/\/+$/, '');
merged.carriers.frenet.origemCep = String(process.env.FRENET_ORIGIN_CEP || process.env.LOJA_ORIGEM_CEP || merged.carriers.frenet.origemCep || merged.correios.origemCep || '').trim();
return merged; }





function formatMoneyBRL(value = 0) {
  const n = Number(value || 0);
  const safe = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: DEFAULT_CURRENCY || 'BRL'
  }).format(safe);
}

function formatDateBR(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return new Date().toLocaleDateString('pt-BR');
  return d.toLocaleDateString('pt-BR');
}


function formatCrediarioParcela(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';

  // Ex.: 0312, 03-12, 03 12, 3/12 -> 03/12
  const digits = raw.replace(/\D/g, '');
  if (/^\d{4}$/.test(digits)) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  if (/^\d{3}$/.test(digits)) return `${digits.slice(0, 1).padStart(2, '0')}/${digits.slice(1)}`;

  const match = raw.match(/^(\d{1,2})\s*[\/\-\s]\s*(\d{1,2})$/);
  if (match) return `${String(match[1]).padStart(2, '0')}/${String(match[2]).padStart(2, '0')}`;

  return raw;
}

function makeReciboNumber() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `REC-${y}${m}${day}-${rand}`;
}


function getSigeValue(row = {}, keys = []) {
  const entries = Object.entries(row || {});
  const norm = (value) => String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
  const normalizedMap = new Map(entries.map(([k, v]) => [norm(k), v]));
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
    const normalized = norm(key);
    if (normalizedMap.has(normalized)) {
      const mapped = normalizedMap.get(normalized);
      if (mapped !== undefined && mapped !== null && String(mapped).trim() !== '') return mapped;
    }
  }
  return '';
}

function parseSigeMoney(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const clean = raw.replace(/R\$/gi, '').replace(/\s+/g, '').replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
  const n = Number(clean);
  return Number.isFinite(n) ? n : 0;
}

function parseSigeDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number') {
    // Excel serial date, considerando base 1899-12-30
    const d = new Date(Math.round((value - 25569) * 86400 * 1000));
    if (!Number.isNaN(d.getTime())) return d;
  }
  const raw = String(value || '').trim();
  if (!raw) return null;
  const br = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (br) {
    const year = Number(br[3].length === 2 ? `20${br[3]}` : br[3]);
    const d = new Date(year, Number(br[2]) - 1, Number(br[1]), Number(br[4] || 0), Number(br[5] || 0));
    if (!Number.isNaN(d.getTime())) return d;
  }
  const iso = new Date(raw);
  return Number.isNaN(iso.getTime()) ? null : iso;
}

function normalizeSigeName(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function buildSigeImportHash(parts = []) {
  return crypto.createHash('sha1').update(parts.map(v => String(v || '')).join('|')).digest('hex');
}

function normalizeCrediarioCliente(doc) {
  const obj = toJSON(doc) || {};
  return {
    ...obj,
    id: String(obj.id || obj._id || ''),
    nome: String(obj.nome || ''),
    cpf: String(obj.cpf || ''),
    telefone: String(obj.telefone || ''),
    contrato: String(obj.contrato || ''),
    endereco: String(obj.endereco || ''),
    observacao: String(obj.observacao || ''),
    origem: String(obj.origem || 'manual'),
    sigeCodigo: String(obj.sigeCodigo || ''),
    documento: String(obj.documento || ''),
    sigeDataVencimento: obj.sigeDataVencimento || null
  };
}

function normalizeCrediarioRecibo(doc) {
  const obj = toJSON(doc) || {};
  return {
    ...obj,
    id: String(obj.id || obj._id || ''),
    recibo: String(obj.recibo || ''),
    clienteNome: String(obj.clienteNome || ''),
    clienteCpf: String(obj.clienteCpf || ''),
    telefone: String(obj.telefone || ''),
    contrato: String(obj.contrato || ''),
    produto: String(obj.produto || ''),
    parcela: formatCrediarioParcela(obj.parcela || ''),
    valorPago: Number(obj.valorPago || 0),
    formaPagamento: String(obj.formaPagamento || ''),
    dataPagamento: obj.dataPagamento || obj.createdAt || null,
    observacao: String(obj.observacao || ''),
    enviadoWhatsapp: obj.enviadoWhatsapp === true,
    origem: String(obj.origem || 'manual'),
    sigeCodigo: String(obj.sigeCodigo || ''),
    documento: String(obj.documento || ''),
    sigeDescricao: String(obj.sigeDescricao || ''),
    sigeDataVencimento: obj.sigeDataVencimento || null
  };
}

function buildCrediarioReceiptMessage(reciboDoc = {}) {
  const r = normalizeCrediarioRecibo(reciboDoc);
  return `✅ Pagamento registrado com sucesso

Olá, ${r.clienteNome || 'cliente'}! 👋

Recebemos o pagamento da sua parcela na Ariana Móveis.

🧾 Recibo: ${r.recibo}
📦 Produto: ${r.produto || 'Compra na loja'}
💰 Valor pago: ${formatMoneyBRL(r.valorPago)}
💳 Forma de pagamento: ${r.formaPagamento || 'Não informada'}
📅 Data: ${formatDateBR(r.dataPagamento)}
📌 Parcela: ${formatCrediarioParcela(r.parcela) || 'Não informada'}
${r.contrato ? `📄 Contrato: ${r.contrato}\n` : ''}${r.observacao ? `\nObservação: ${r.observacao}\n` : ''}
Seu pagamento foi registrado com sucesso.

💙 Obrigado por escolher a Ariana Móveis.`.trim();
}


function buildCrediarioCobrancaMessage(data = {}) {
  const nome = String(data.clienteNome || data.nome || 'cliente').trim() || 'cliente';
  const tipo = String(data.tipo || data.tipoCobranca || 'normal').toLowerCase();
  const produto = String(data.produto || '').trim();
  const parcela = formatCrediarioParcela(data.parcela || '');
  const valorOriginal = Number(data.valorOriginal ?? data.valor ?? data.valorPago ?? 0);
  const multa = Math.max(0, Number(data.multa || 0));
  const juros = Math.max(0, Number(data.juros || 0));
  const valorAtualizadoInformado = Number(data.valorAtualizado ?? 0);
  const valorAtualizado = valorAtualizadoInformado > 0
    ? valorAtualizadoInformado
    : Math.max(0, valorOriginal + multa + juros);
  const possuiAtualizacao = multa > 0 || juros > 0 || valorAtualizado > valorOriginal + 0.009;
  const documento = String(data.documento || data.recibo || data.contrato || '').trim();
  const urgente = tipo.includes('urg');
  const amigavel = tipo.includes('amig');

  const cabecalho = urgente
    ? '🚨 Aviso urgente de pendência financeira'
    : (amigavel ? '💙 Lembrete de pagamento' : '🔔 Aviso de pendência financeira');
  const mensagemPrincipal = urgente
    ? 'Constam nota(s)/parcela(s) em atraso em nosso sistema. Solicitamos contato com urgência para regularização ou esclarecimentos.'
    : (amigavel
      ? 'Gostaríamos de lembrar que existe uma parcela pendente em nosso sistema.'
      : 'Informamos que existe nota/parcela em atraso em nosso sistema.');
  const fechamento = urgente
    ? 'Para evitar bloqueio interno de crédito e novos transtornos, pedimos que entre em contato com a loja o quanto antes.'
    : (amigavel
      ? 'Se o pagamento já foi realizado, envie o comprovante para conferência. Caso precise de ajuda, fale com nossa equipe financeira.'
      : 'Por favor, entre em contato com a loja para mais informações ou regularização.');

  const linhasValor = possuiAtualizacao
    ? [
        valorOriginal > 0 ? `💰 Valor original: ${formatMoneyBRL(valorOriginal)}` : '',
        multa > 0 ? `⚠️ Multa: ${formatMoneyBRL(multa)}` : '',
        juros > 0 ? `📈 Juros: ${formatMoneyBRL(juros)}` : '',
        valorAtualizado > 0 ? `✅ Valor atualizado: ${formatMoneyBRL(valorAtualizado)}` : ''
      ]
    : [valorAtualizado > 0 ? `💰 Valor: ${formatMoneyBRL(valorAtualizado)}` : ''];

  const linhas = [
    cabecalho,
    '',
    `Olá, ${nome}.`,
    '',
    mensagemPrincipal,
    '',
    produto ? `📦 Referência: ${produto}` : '',
    parcela ? `📌 Parcela: ${parcela}` : '',
    ...linhasValor,
    documento ? `🧾 Documento: ${documento}` : '',
    '',
    fechamento,
    '',
    '📲 WhatsApp financeiro:',
    '(31) 98514-7119',
    '',
    'Ariana Móveis'
  ];

  const mensagem = [];
  for (const linha of linhas) {
    if (linha === '' && (!mensagem.length || mensagem[mensagem.length - 1] === '')) continue;
    mensagem.push(linha);
  }
  while (mensagem[mensagem.length - 1] === '') mensagem.pop();
  return mensagem.join('\n');
}

async function sendCrediarioCobrancaWhatsapp({
  telefone = '',
  clienteNome = '',
  produto = '',
  parcela = '',
  valor = 0,
  valorOriginal = 0,
  multa = 0,
  juros = 0,
  valorAtualizado = 0,
  documento = '',
  recibo = '',
  contrato = '',
  tipo = 'normal'
} = {}) {
  const number = normalizePhone(telefone || '', '55');
  if (!number) throw new Error('Telefone do cliente inválido para envio da cobrança.');
  const text = buildCrediarioCobrancaMessage({
    clienteNome,
    produto,
    parcela,
    valor,
    valorOriginal,
    multa,
    juros,
    valorAtualizado,
    documento,
    recibo,
    contrato,
    tipo
  });
  return waSendTextMessage({ number, text });
}

async function sendCrediarioReceiptWhatsapp(reciboDoc = {}) {
  const recibo = normalizeCrediarioRecibo(reciboDoc);
  const number = normalizePhone(recibo.telefone || '', '55');
  if (!number) throw new Error('Telefone do cliente inválido para envio do recibo.');
  const text = buildCrediarioReceiptMessage(reciboDoc);
  return waSendTextMessage({ number, text });
}


// ============================================================
// INTEGRAÇÃO SIGE CLOUD - CONSULTA ONLINE
// Variáveis necessárias no Render:
// SIGE_API_URL=https://api.sigecloud.com.br
// SIGE_USER=marcelloghaes@hotmail.com
// SIGE_APP=API
// SIGE_TOKEN=token_novo_do_sige
// ============================================================
const SIGE_API_URL = String(process.env.SIGE_API_URL || 'https://api.sigecloud.com.br').replace(/\/+$/, '');
const SIGE_USER = String(process.env.SIGE_USER || '').trim();
const SIGE_APP = String(process.env.SIGE_APP || 'API').trim();
const SIGE_TOKEN = String(process.env.SIGE_TOKEN || process.env.SIGE_AUTHORIZATION_TOKEN || '').trim();
const SIGE_PLANO_CONTA = String(process.env.SIGE_PLANO_CONTA || '').trim();
const SIGE_TIMEOUT_MS = Number(process.env.SIGE_TIMEOUT_MS || 30000);

function isSigeConfigured() {
  return Boolean(SIGE_API_URL && SIGE_USER && SIGE_APP && SIGE_TOKEN);
}

function sigeAuthHeaders() {
  return {
    'Authorization-Token': SIGE_TOKEN,
    'User': SIGE_USER,
    'App': SIGE_APP,
    'Accept': 'application/json'
  };
}

async function sigeGet(endpoint, params = {}) {
  if (!isSigeConfigured()) {
    const err = new Error('SIGE não configurado. Configure SIGE_API_URL, SIGE_USER, SIGE_APP e SIGE_TOKEN no Render.');
    err.statusCode = 500;
    throw err;
  }

  const cleanEndpoint = String(endpoint || '').replace(/^\/+/, '');
  const url = `${SIGE_API_URL}/request/${cleanEndpoint}`;
  const response = await axios.get(url, {
    headers: sigeAuthHeaders(),
    params,
    timeout: SIGE_TIMEOUT_MS,
    validateStatus: () => true
  });

  if (response.status < 200 || response.status >= 300) {
    const err = new Error(typeof response.data === 'string' ? response.data : `Erro SIGE HTTP ${response.status}`);
    err.statusCode = response.status;
    err.responseData = response.data;
    throw err;
  }

  return Array.isArray(response.data) ? response.data : (response.data ? [response.data] : []);
}

function normalizeSigePessoa(row = {}) {
  const enderecoPadrao = row.EnderecoPadrao || {};
  const telefone = normalizePhone(row.Celular || row.Telefone || enderecoPadrao.Telefone || '', '55');
  const enderecoParts = [
    row.Logradouro || enderecoPadrao.Logradouro,
    row.LogradouroNumero || enderecoPadrao.Numero,
    row.Complemento || enderecoPadrao.Complemento,
    row.Bairro || enderecoPadrao.Bairro,
    row.Cidade || enderecoPadrao.Cidade,
    row.UF || enderecoPadrao.Uf
  ].map((v) => String(v || '').trim()).filter(Boolean);

  return {
    id: String(row.ID || row.Id || row.Codigo || ''),
    nome: String(row.NomeFantasia || row.RazaoSocial || row.Nome || '').trim(),
    razaoSocial: String(row.RazaoSocial || '').trim(),
    cpf: cleanPhone(row.CNPJ_CPF || row.CpfCnpj || row.CPF || row.CNPJ || ''),
    telefone,
    telefoneOriginal: String(row.Telefone || '').trim(),
    celularOriginal: String(row.Celular || '').trim(),
    cidade: String(row.Cidade || enderecoPadrao.Cidade || '').trim(),
    uf: String(row.UF || enderecoPadrao.Uf || '').trim(),
    endereco: enderecoParts.join(', '),
    cep: String(row.CEP || enderecoPadrao.CEP || '').trim(),
    cliente: row.Cliente === true,
    bloqueado: row.Bloqueado === true,
    inadimplente: row.EstaInadimplente === true,
    ultimaAlteracao: row.UltimaAlteracao || null,
    raw: row
  };
}

function normalizeSigeLancamento(row = {}) {
  const valor = Number(row.Valor || 0) || 0;
  const recebido = Number(row.TotalRecebido || 0) || 0;
  const quitado = row.Quitado === true;
  const vencimento = row.DataVencimento || row.DataVencimentoOriginal || null;
  const vencDate = vencimento ? new Date(vencimento) : null;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const atrasado = !quitado && vencDate && !Number.isNaN(vencDate.getTime()) && vencDate < hoje;
  const saldo = Math.max(0, valor - recebido);

  return {
    codigo: row.Codigo,
    id: String(row.Codigo || row.ID || ''),
    cliente: String(row.Cliente || '').trim(),
    documento: String(row.NumeroDocumento || row.NumeroBoleto || row.CodigoVenda || '').trim(),
    descricao: String(row.Descricao || '').trim(),
    empresa: String(row.Empresa || '').trim(),
    formaPagamento: String(row.FormaPagamento || '').trim(),
    planoDeConta: String(row.PlanoDeConta || '').trim(),
    ehDespesa: row.EhDespesa === true,
    valor,
    totalRecebido: recebido,
    saldo,
    quitado,
    atrasado: Boolean(atrasado),
    dataCompetencia: row.DataCompetencia || null,
    dataVencimento: vencimento,
    dataQuitacao: row.DataQuitacao && !String(row.DataQuitacao).startsWith('0001-') ? row.DataQuitacao : null,
    codigoVenda: row.CodigoVenda || 0,
    codigoContrato: row.CodigoContrato || 0,
    pagamentos: Array.isArray(row.Pagamentos) ? row.Pagamentos : [],
    parcelas: Array.isArray(row.Parcelas) ? row.Parcelas : [],
    raw: row
  };
}

function filterSigeRows(rows = [], q = '', fields = []) {
  const normalizeText = (value = '') => String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
  const compactText = (value = '') => normalizeText(value).replace(/[^a-z0-9]+/g, '');
  const query = normalizeText(q);
  const queryCompact = compactText(q);
  if (!query && !queryCompact) return rows;
  return rows.filter((row) => fields.some((field) => {
    const value = normalizeText(row[field] || '');
    const valueCompact = compactText(row[field] || '');
    return (query && value.includes(query)) || (queryCompact && valueCompact.includes(queryCompact));
  }));
}

async function getSigePessoasByQuery(q = '', limit = 50) {
  const params = {};
  const rawQ = String(q || '').trim();
  if (rawQ) params.nomefantasia = rawQ;
  const rows = await sigeGet('Pessoas/Pesquisar', params);
  return rows.map(normalizeSigePessoa).filter((p) => p.nome).slice(0, limit);
}

function uniqueSigeLancamentos(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const key = String(row.Codigo || row.ID || row.NumeroDocumento || JSON.stringify(row)).trim();
    if (!key) continue;
    if (!map.has(key)) map.set(key, row);
  }
  return Array.from(map.values());
}

function addUniqueSigeRows(target = [], seen = new Set(), rows = []) {
  let added = 0;
  for (const row of ensureArray(rows)) {
    const key = String(row?.Codigo || row?.ID || row?.NumeroDocumento || JSON.stringify(row)).trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    target.push(row);
    added += 1;
  }
  return added;
}

async function getSigeLancamentosRawPages({ q = '', maxRecords = 2000, maxPages = 30 } = {}) {
  const all = [];
  const seen = new Set();
  const max = Math.max(100, Math.min(Number(maxRecords || 2000), 30000));
  const pages = Math.max(1, Math.min(Number(maxPages || 80), 300));
  const pageSize = Math.max(50, Math.min(Number(process.env.SIGE_PAGE_SIZE || 1000), 1000));
  const rawQ = String(q || '').trim();

  const basePageParams = { pageSize, skip: 0 };

  // O Swagger do SIGE usa "clienteFornecedor" para buscar contas a receber por cliente.
  // Antes o código enviava "cliente", "nomeCliente" etc., e por isso retornava vazio.
  const directParamSets = rawQ ? [
    { clienteFornecedor: rawQ, ...basePageParams },
    { documento: rawQ, ...basePageParams },
    { descricao: rawQ, ...basePageParams },
    { boleto: rawQ, ...basePageParams }
  ] : [basePageParams];

  for (const params of directParamSets) {
    try {
      const rows = await sigeGet('Lancamentos/Pesquisar', params);
      addUniqueSigeRows(all, seen, rows);
      if (all.length >= max) return uniqueSigeLancamentos(all).slice(0, max);
    } catch (error) {
      console.warn('SIGE Lancamentos/Pesquisar ignorado:', error.message || error);
    }
  }

  // Paginação correta do endpoint: pageSize + skip.
  // Mantemos GetAll como fallback, mas sempre usando os parâmetros oficiais vistos no Swagger.
  const endpoints = ['Lancamentos/Pesquisar', 'Lancamentos/GetAll'];
  for (const endpoint of endpoints) {
    let previousAddedZero = false;
    for (let page = 0; page < pages; page += 1) {
      const skip = page * pageSize;
      const paramOptions = [rawQ && endpoint === 'Lancamentos/Pesquisar'
        ? { clienteFornecedor: rawQ, pageSize, skip }
        : { pageSize, skip }
      ];

      let pageHadRows = false;
      let pageAdded = 0;
      for (const params of paramOptions) {
        try {
          const rows = await sigeGet(endpoint, params);
          if (Array.isArray(rows) && rows.length) pageHadRows = true;
          pageAdded += addUniqueSigeRows(all, seen, rows);
          if (all.length >= max) return uniqueSigeLancamentos(all).slice(0, max);
        } catch (error) {
          console.warn(`SIGE ${endpoint} página ignorada:`, error.message || error);
        }
      }

      if (!pageHadRows) break;
      if (pageAdded === 0 && previousAddedZero) break;
      previousAddedZero = pageAdded === 0;
    }
  }

  return uniqueSigeLancamentos(all).slice(0, max);
}

async function getSigeLancamentosFiltered({ q = '', status = 'todos', limit = 100, maxRecords = 2000 } = {}) {
  const requestedLimit = Math.max(1, Math.min(Number(limit || 100), 3000));
  const rawLimit = Math.max(requestedLimit, Math.min(Number(maxRecords || 2000), 30000));
  const rows = await getSigeLancamentosRawPages({ q, maxRecords: rawLimit });

  let normalized = rows.map(normalizeSigeLancamento).filter((l) => l.cliente || l.descricao || l.codigo);
  normalized = filterSigeRows(normalized, q, ['cliente', 'documento', 'descricao', 'formaPagamento', 'planoDeConta']);

  const st = String(status || 'todos').toLowerCase();
  // No crediário usamos apenas receitas, não despesas.
  normalized = normalized.filter((l) => l.ehDespesa !== true);

  if (st === 'aberto' || st === 'abertos') normalized = normalized.filter((l) => !l.quitado);
  if (st === 'quitado' || st === 'quitados' || st === 'pago' || st === 'pagos') normalized = normalized.filter((l) => l.quitado);
  if (st === 'atrasado' || st === 'atrasados' || st === 'vencido' || st === 'vencidos' || st === 'inadimplente' || st === 'inadimplentes') {
    normalized = normalized.filter((l) => l.atrasado && !l.quitado && l.saldo > 0);
  }

  normalized.sort((a, b) => {
    const da = new Date(a.dataVencimento || 0).getTime() || 0;
    const db = new Date(b.dataVencimento || 0).getTime() || 0;
    return da - db;
  });

  return normalized.slice(0, requestedLimit);
}

// ============================================================
// ROTAS LEGADAS MODULARIZADAS
// O bloco grande de rotas foi movido para ./routes/legacyRoutes.js.
// Isso reduz o server.js e mantém compatibilidade com todas as rotas atuais.
// ============================================================

function normalizeCepValue(value = '') {
  return String(value || '').replace(/\D/g, '').slice(0, 8);
}

function parseServices(value = '') {
  return String(value || '03298,03328')
    .split(',')
    .map((s) => String(s).trim())
    .filter(Boolean);
}

function correiosCfg(settings = {}) {
  const cfg = settings?.correios || {};
  return {
    user: String(process.env.CORREIOS_USER || '').trim(),
    pass: String(process.env.CORREIOS_PASS || '').trim(),
    cartao: String(process.env.CORREIOS_CARTAO || '').trim(),
    contrato: String(process.env.CORREIOS_CONTRATO || '').trim(),
    dr: String(process.env.CORREIOS_DR || '0').trim(),
    originCep: normalizeCepValue(cfg.origemCep || process.env.LOJA_ORIGEM_CEP || ''),
    services: Array.isArray(cfg.servicos) && cfg.servicos.length
      ? cfg.servicos
      : parseServices(process.env.CORREIOS_SERVICOS || '03298,03328'),
    tokenUrl: 'https://api.correios.com.br/token/v1/autentica/cartaopostagem',
    precoUrl: 'https://api.correios.com.br/preco/v1/nacional'
  };
}

let correiosTokenCache = { token: null, exp: 0 };

async function getCorreiosToken(settings = {}) {
  const cfg = correiosCfg(settings);
  const nowTs = Date.now();

  if (correiosTokenCache.token && correiosTokenCache.exp > nowTs) {
    return correiosTokenCache.token;
  }

  if (!cfg.user || !cfg.pass) {
    throw new Error('Correios: CORREIOS_USER/CORREIOS_PASS ausentes.');
  }

  if (!cfg.cartao) {
    throw new Error('Correios: CORREIOS_CARTAO ausente.');
  }

  const auth = Buffer.from(`${cfg.user}:${cfg.pass}`).toString('base64');

  const body = {
    numero: cfg.cartao
  };

  if (cfg.contrato) body.contrato = cfg.contrato;
  if (cfg.dr && Number(cfg.dr) > 0) body.dr = Number(cfg.dr);

  const response = await axios.post(cfg.tokenUrl, body, {
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    timeout: 20000
  });

  const token = response.data?.token;
  const expiresIn = Number(response.data?.expires_in || 3000);

  if (!token) {
    throw new Error('Correios: token não retornou.');
  }

  correiosTokenCache.token = token;
  correiosTokenCache.exp = nowTs + Math.max(60, expiresIn - 60) * 1000;

  return token;
}


// ============================================================
// CUPOM PRIMEIRACOMPRA05 — 5% E USO ÚNICO POR CLIENTE
// Mantido aqui antes das rotas legadas para impedir que uma
// implementação antiga devolva desconto incorreto.
// ============================================================
function normalizeCouponCodeServer(value = '') {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
}

function roundCouponMoney(value = 0) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 100) / 100 : 0;
}

function couponCustomerQuery(req, body = {}) {
  const userId = String(req.user?._id || req.user?.id || req.auth?.id || body.customerId || '').trim();
  const email = String(req.user?.email || body.customerEmail || '').trim().toLowerCase();
  const cpf = String(req.user?.cpf || body.customerCpf || '').replace(/\D/g, '');

  const identities = [];
  if (userId) {
    identities.push({ userId });
    if (mongoose.Types.ObjectId.isValid(userId)) {
      identities.push({ userId: new mongoose.Types.ObjectId(userId) });
      identities.push({ customerId: new mongoose.Types.ObjectId(userId) });
    }
    identities.push({ customerId: userId });
    identities.push({ 'customer.uid': userId });
    identities.push({ 'customer.id': userId });
  }
  if (email) {
    identities.push({ customerEmail: email });
    identities.push({ 'customer.email': email });
    identities.push({ email });
  }
  if (cpf) {
    identities.push({ cpf });
    identities.push({ customerCpf: cpf });
    identities.push({ 'customer.cpf': cpf });
  }
  return identities;
}

app.post('/api/coupons/validate', async (req, res, next) => {
  const code = normalizeCouponCodeServer(req.body?.code);
  if (code !== 'PRIMEIRACOMPRA05') return next();

  try {
    // Exige cliente identificado para que o cupom não possa ser reutilizado
    // limpando o navegador ou trocando de dispositivo.
    let authenticatedUser = null;
    const authHeader = String(req.headers.authorization || '');
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        authenticatedUser = decoded?.id ? await User.findById(decoded.id) : null;
        if (authenticatedUser) {
          req.user = authenticatedUser;
          req.auth = decoded;
        }
      } catch (_) {}
    }

    const identities = couponCustomerQuery(req, req.body || {});
    if (!identities.length) {
      return res.status(401).json({
        ok: false,
        valid: false,
        code,
        discountValue: 0,
        message: 'Entre na sua conta para usar o cupom de primeira compra.'
      });
    }

    const alreadyUsed = await Order.exists({
      $and: [
        { $or: identities },
        {
          $or: [
            { 'totals.couponCode': code },
            { couponCode: code },
            { coupon: code },
            { 'coupon.code': code }
          ]
        },
        {
          status: { $nin: ['cancelled', 'canceled', 'cancelado', 'failed', 'rejected'] }
        }
      ]
    });

    if (alreadyUsed) {
      return res.status(409).json({
        ok: false,
        valid: false,
        code,
        discountValue: 0,
        message: 'Este cupom já foi utilizado nesta conta.'
      });
    }

    const subtotal = Math.max(
      0,
      Number(req.body?.subtotal ?? req.body?.total ?? 0) || 0
    );
    if (subtotal <= 0) {
      return res.status(400).json({
        ok: false,
        valid: false,
        code,
        discountValue: 0,
        message: 'Subtotal inválido para aplicar o cupom.'
      });
    }

    const discountValue = roundCouponMoney(subtotal * 0.05);
    return res.json({
      ok: true,
      valid: true,
      code,
      type: 'percentage',
      percentage: 5,
      discountPercent: 5,
      discountValue,
      value: discountValue,
      firstPurchaseOnly: true,
      message: `Cupom ${code} aplicado: 5% de desconto.`
    });
  } catch (error) {
    console.error('[coupon PRIMEIRACOMPRA05]', error);
    return res.status(500).json({
      ok: false,
      valid: false,
      code,
      discountValue: 0,
      message: 'Não foi possível validar o cupom agora.'
    });
  }
});

registerCoraRoutes(app, { adminRequired, authRequired, mongoose, Order });
registerCrediarioAnalysisRoutes(app, { adminRequired, authRequired, mongoose, Order });
registerCrediarioConversationRoutes(app, { mongoose, adminRequired });
registerAdminUserRoutes(app, { User, AdminAuditLog, AdminSession, AdminLoginEvent, adminRequired, bcrypt, mongoose, isSuperAdminEmail });

// ============================================================
// TELEVENDAS
// Registra os endpoints /api/televendas antes do bloco legado.
// Não substitui nem remove SIGE, Enterprise, Manufacturer ou demais rotas.
// ============================================================
app.use('/api', createTelevendasRoutes({
  Order,
  Product,
  User,
  PaymentEvent,
  IntegrationAuditLog,
  Notification,
  EnterpriseBillingRecord,
  adminRequired,
  authRequired,
  axios,
  crypto,
  toJSON,
  redact,
  createAdminNotification,
  createSellerOrderNotifications,
  FRONTEND_URL,
  onTelevendasPaymentApproved: async (order) => {
    const orderId = String(order?._id || order?.id || '').trim();
    console.log(
      '[televendas] Pagamento aprovado. Pós-aprovação pendente:',
      orderId || '(pedido sem id)'
    );

    return {
      ok: true,
      pending: ['sige', 'financeiro']
    };
  }
}));



// Captura a criação de pedidos do checkout sem alterar o endpoint legado.
// A resposta ao cliente é enviada normalmente; as notificações são processadas em segundo plano.
app.use((req, res, next) => {
  const pathOnly = String(req.path || req.originalUrl || '').split('?')[0].replace(/\/+$/, '');
  const isMarketplaceOrderCreation = req.method === 'POST' && pathOnly === '/api/orders';

  if (!isMarketplaceOrderCreation) return next();

  const originalJson = res.json.bind(res);
  let scheduled = false;

  res.json = function patchedOrderJson(payload) {
    if (!scheduled && res.statusCode >= 200 && res.statusCode < 300) {
      scheduled = true;
      const requestSnapshot = req.body && typeof req.body === 'object'
        ? JSON.parse(JSON.stringify(req.body))
        : {};
      const responseSnapshot = payload && typeof payload === 'object'
        ? JSON.parse(JSON.stringify(payload))
        : payload;

      setImmediate(() => {
        notifyNewMarketplaceOrder(responseSnapshot, requestSnapshot).catch((error) => {
          console.error('[nova-venda] Erro assíncrono:', error?.message || error);
        });
      });
    }

    return originalJson(payload);
  };

  return next();
});


// ============================================================
// AVALIAÇÃO PÓS-ENTREGA PELO WHATSAPP ARIANA_NOTIFICACOES
// O mesmo webhook continua processando os status financeiros.
// Somente MESSAGES_UPSERT é interceptado aqui para registrar
// a nota de 1 a 5 e responder automaticamente ao cliente.
// ============================================================
const deliveryRatingWhatsappController = createWhatsappController({
  DEFAULT_CURRENCY,
  DEFAULT_WHATSAPP_SETTINGS,
  Order,
  Ticket,
  User,
  Notification,
  OperationalAlert,
  WhatsAppWebhook,
  axios,
  cleanPhone,
  ensureArray,
  getWhatsappSettings,
  normalizePhone,
  now,
  redact,
  saveWhatsappSettings,
  toJSON,
  writeAuditLog: async () => null
});

function normalizeIncomingEvolutionEvent(body = {}) {
  return String(
    body?.event ||
    body?.type ||
    body?.data?.event ||
    body?.data?.type ||
    ''
  )
    .trim()
    .toUpperCase()
    .replace(/[.\-\s]+/g, '_');
}

function financeiroWhatsappWebhookAuthorized(req = {}) {
  const configured = String(
    process.env.FINANCEIRO_WHATSAPP_WEBHOOK_TOKEN || ''
  ).trim();

  if (!configured) return true;

  const informed = String(
    req.headers?.['x-financeiro-webhook-token'] ||
    req.headers?.['x-webhook-token'] ||
    req.query?.token ||
    ''
  ).trim();

  return Boolean(informed && informed === configured);
}

app.post(
  '/api/webhooks/financeiro/whatsapp/status',
  async (req, res, next) => {
    const event = normalizeIncomingEvolutionEvent(req.body || {});

    // MESSAGES_UPDATE e SEND_MESSAGE continuam na rota financeira original.
    if (event !== 'MESSAGES_UPSERT') return next();

    if (!financeiroWhatsappWebhookAuthorized(req)) {
      return res.status(401).json({
        ok: false,
        error: 'Token do webhook financeiro inválido.'
      });
    }

    try {
      const parsed = await deliveryRatingWhatsappController.waPersistWebhook(
        req.body || {}
      );

      return res.json({
        ok: true,
        received: true,
        event: parsed.event || event,
        rating: parsed.deliveryRating || null
      });
    } catch (error) {
      console.error(
        '[WHATSAPP AVALIACAO] Erro no webhook:',
        error.message || error
      );

      return res.status(500).json({
        ok: false,
        error: error.message || 'Erro ao processar avaliação do cliente.'
      });
    }
  }
);

async function ensureArianaNotificacoesWebhookEvents() {
  const autoSyncEnabled = String(
    process.env.EVOLUTION_NOTIFY_WEBHOOK_AUTO_SYNC ?? 'true'
  ).trim().toLowerCase() !== 'false';

  if (!autoSyncEnabled) return { skipped: true, reason: 'auto_sync_disabled' };

  const apiUrl = String(process.env.EVOLUTION_API_URL || '').trim().replace(/\/+$/, '');
  const apiKey = String(process.env.EVOLUTION_API_KEY || '').trim();
  const instanceName = String(
    process.env.EVOLUTION_NOTIFY_INSTANCE ||
    process.env.EVOLUTION_INSTANCE_NOTIFICACOES ||
    'Ariana_Notificacoes'
  ).trim();

  const webhookUrl = String(
    process.env.FINANCEIRO_WHATSAPP_WEBHOOK_PUBLIC_URL ||
    (
      APP_BASE_URL
        ? `${APP_BASE_URL}/api/webhooks/financeiro/whatsapp/status`
        : ''
    )
  ).trim();

  if (!apiUrl || !apiKey || !instanceName || !webhookUrl) {
    return {
      skipped: true,
      reason: 'missing_configuration',
      configured: {
        apiUrl: Boolean(apiUrl),
        apiKey: Boolean(apiKey),
        instanceName: Boolean(instanceName),
        webhookUrl: Boolean(webhookUrl)
      }
    };
  }

  const webhookToken = String(
    process.env.FINANCEIRO_WHATSAPP_WEBHOOK_TOKEN || ''
  ).trim();

  const events = [
    'MESSAGES_UPSERT',
    'MESSAGES_UPDATE',
    'SEND_MESSAGE'
  ];

  const response = await axios.post(
    `${apiUrl}/webhook/set/${encodeURIComponent(instanceName)}`,
    {
      webhook: {
        enabled: true,
        url: webhookUrl,
        webhookByEvents: false,
        webhookBase64: false,
        base64: false,
        events,
        headers: webhookToken
          ? { 'x-financeiro-webhook-token': webhookToken }
          : {}
      }
    },
    {
      headers: {
        apikey: apiKey,
        'Content-Type': 'application/json'
      },
      timeout: 30000,
      validateStatus: () => true
    }
  );

  if (response.status < 200 || response.status >= 300) {
    const error = new Error(
      response.data?.message ||
      response.data?.error?.message ||
      response.data?.error ||
      `Evolution API HTTP ${response.status}`
    );
    error.statusCode = response.status;
    error.responseData = response.data;
    throw error;
  }

  return {
    ok: true,
    instanceName,
    webhookUrl,
    events,
    status: response.status
  };
}

registerLegacyRoutes(app, {
  ADMIN_EMAIL,
  ADMIN_NAME,
  ADMIN_PASSWORD,
  APP_BASE_URL,
  Address,
  AdminSession,
  AdminLoginEvent,
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
  getCorreiosToken,
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
  waSendTextMessage,
  formatMoneyBRL,
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
});

app.listen(PORT, () => {
  console.log(`🚀 Ariana Enterprise Mongo rodando na porta ${PORT}`);

  setTimeout(() => {
    ensureArianaNotificacoesWebhookEvents()
      .then((result) => {
        if (result?.ok) {
          console.log(
            `📲 Webhook Ariana_Notificacoes sincronizado: ${result.events.join(', ')}`
          );
        } else {
          console.log(
            'ℹ️ Webhook Ariana_Notificacoes não sincronizado:',
            result?.reason || 'configuração incompleta'
          );
        }
      })
      .catch((error) => {
        console.error(
          '⚠️ Falha ao sincronizar webhook Ariana_Notificacoes:',
          error.message || error
        );
      });
  }, 5000);
  if (typeof startSigeAutoCobrancaScheduler === 'function') {
    startSigeAutoCobrancaScheduler();
  }

  if (typeof startEnterpriseQueueWorker === 'function') {
    startEnterpriseQueueWorker();
  }

  if (typeof startEnterpriseCatalogSyncWorker === 'function') {
    startEnterpriseCatalogSyncWorker();
  }
  console.log(`📁 Uploads em: ${uploadsDir}`);
  console.log(`🌐 Base local: http://localhost:${PORT}/api`);
  const financeiroAutoEnabled = String(process.env.FINANCEIRO_AUTOMACAO_ENABLED ?? 'true').toLowerCase() !== 'false';
  const financeiroAutoHora = String(process.env.FINANCEIRO_AUTOMACAO_HORA || '05:30');
  const financeiroAutoTimezone = String(process.env.FINANCEIRO_AUTOMACAO_TIMEZONE || 'America/Sao_Paulo');
  console.log(
    financeiroAutoEnabled
      ? `⏰ Automação financeira: ativa às ${financeiroAutoHora} (${financeiroAutoTimezone})`
      : '⏸️ Automação financeira: desativada'
  );

  const reguaWhatsappEnabled = String(process.env.FINANCEIRO_REGUA_WHATSAPP_ENABLED || 'false').toLowerCase() === 'true';
  const reguaWhatsappHora = String(process.env.FINANCEIRO_REGUA_WHATSAPP_HORA || '09:00');
  console.log(
    reguaWhatsappEnabled
      ? `📲 Régua financeira WhatsApp: ativa às ${reguaWhatsappHora}`
      : '📵 Régua financeira WhatsApp: desativada até homologação'
  );

  const webhookFinanceiroProtegido = Boolean(String(process.env.FINANCEIRO_WHATSAPP_WEBHOOK_TOKEN || '').trim());
  console.log(
    webhookFinanceiroProtegido
      ? '🔐 Webhook financeiro WhatsApp: protegido por token'
      : '⚠️ Webhook financeiro WhatsApp: sem token configurado'
  );
});
