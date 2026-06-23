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
  'https://ariana-moveis-oficial.onrender.com',
  'https://ariana-moveis.onrender.com',
  'https://arianamoveis.com.br',
  'https://www.arianamoveis.com.br',
  'https://arianamoveis.site',
  'https://www.arianamoveis.site'
];

const envFrontendOrigins = String(process.env.FRONTEND_URLS || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const dynamicAllowedOrigins = Array.from(new Set([...allowedOrigins, ...envFrontendOrigins]));

function isAllowedOrigin(origin = '') {
  if (!origin) return true;
  if (dynamicAllowedOrigins.includes(origin)) return true;
  return /^https:\/\/[a-z0-9-]+\.onrender\.com$/i.test(origin);
}

const corsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) return callback(null, true);
    return callback(new Error(`CORS bloqueado: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: false,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
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
    if (!token) return res.status(401).json({ ok: false, error: 'Token ausente' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ ok: false, error: 'Usuário inválido' });
    req.user = user;
    req.auth = decoded;
    next();
  } catch (_error) {
    return res.status(401).json({ ok: false, error: 'Token inválido' });
  }
}

const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '').trim();
const ADMIN_NAME = String(process.env.ADMIN_NAME || 'Administrador').trim();

function signAdminToken(payload = {}) {
  return jwt.sign({ role: 'admin', admin: true, active: true, ...payload }, JWT_SECRET, { expiresIn: '7d' });
}

function adminPermissionAllowedForRoute(req, permissions = []) {
  const role = String(req.admin?.role || req.auth?.role || '').toLowerCase();
  if (role === 'admin' || req.admin?.admin === true) return true;

  const perms = new Set(Array.isArray(permissions) ? permissions : []);
  const method = String(req.method || 'GET').toUpperCase();
  const pathOnly = String(req.path || req.originalUrl || '').split('?')[0];

  const has = (permission) => perms.has(permission);
  const hasAny = (...items) => items.some((item) => has(item));

  if (pathOnly === '/api/admin/me') return true;

  if (pathOnly.startsWith('/api/admin/categories') && method === 'GET') {
    return hasAny('categories:read', 'products:read', 'products:create', 'products:update');
  }

  if (pathOnly === '/api/admin/uploads' && ['POST', 'DELETE'].includes(method)) {
    return hasAny('uploads:create', 'products:create', 'products:update');
  }

  if (pathOnly.startsWith('/api/admin/posters/product')) {
    return method === 'POST' && has('posters:generate');
  }

  if (pathOnly.startsWith('/api/admin/posters/bulk') || pathOnly.startsWith('/api/admin/posters/offers')) {
    return method === 'POST' && has('posters:generate:bulk');
  }

  if (pathOnly === '/api/admin/products' || pathOnly.startsWith('/api/admin/products/')) {
    if (method === 'GET') return has('products:read');
    if (method === 'POST') return has('products:create');
    if (['PATCH', 'PUT'].includes(method)) return has('products:update');
    if (method === 'DELETE') return has('products:delete');
  }

  return false;
}

async function adminRequired(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ ok: false, error: 'Token ausente' });

    const decoded = jwt.verify(token, JWT_SECRET);
    const decodedRole = String(decoded.role || '').toLowerCase();

    if (decoded && (decoded.admin === true || decodedRole === 'admin')) {
      req.admin = decoded;
      req.user = decoded;
      req.auth = decoded;
      return next();
    }

    const user = decoded.id ? await User.findById(decoded.id) : null;
    const userRole = String(user?.role || decodedRole || '').toLowerCase();

    if (user && user.isActive === false) {
      return res.status(403).json({ ok: false, error: 'Usuário desativado' });
    }

    if (user && userRole === 'admin') {
      req.admin = {
        id: String(user._id),
        email: user.email || '',
        name: user.name || ADMIN_NAME,
        role: 'admin',
        admin: true,
        permissions: ['*']
      };
      req.user = user;
      req.auth = req.admin;
      return next();
    }

    if (user && userRole === 'staff') {
      const permissions = Array.isArray(user.permissions) ? user.permissions : [];
      req.admin = {
        id: String(user._id),
        email: user.email || '',
        name: user.name || 'Colaborador',
        role: 'staff',
        admin: false,
        permissions
      };
      req.user = user;
      req.auth = req.admin;

      if (adminPermissionAllowedForRoute(req, permissions)) return next();

      return res.status(403).json({
        ok: false,
        error: 'Sem permissão para esta ação',
        requiredPath: req.path,
        method: req.method
      });
    }

    return res.status(403).json({ ok: false, error: 'Acesso negado' });
  } catch (_error) {
    return res.status(401).json({ ok: false, error: 'Token inválido' });
  }
}

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

    // Define a pasta e limpa o nome do produto para o link
    const targetFolder = buildCloudinaryFolder(req.body?.path || req.query?.path || 'geral');
    const nomeOriginal = req.body.name || req.body.nome || 'produto';
    
    const slug = nomeOriginal
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');

    // Upload com o nome do produto + timestamp
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: targetFolder,
      public_id: `${slug}-${Date.now()}`,
      resource_type: 'image',
      overwrite: true
    });

    // Limpa o arquivo temporário do servidor
    if (req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

    return res.json({
      ok: true,
      url: result.secure_url,
      public_id: result.public_id,
      format: result.format
    });
  } catch (error) {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error('Erro no upload:', error);
    return res.status(500).json({ ok: false, error: error.message });
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

const baseOptions = { timestamps: true, versionKey: false };
const userSchema = new mongoose.Schema({ name: String, email: { type: String, index: true, unique: true, sparse: true }, passwordHash: String, cpf: String, phone: String, role: { type: String, default: 'customer', enum: ['customer', 'seller', 'admin', 'staff'] }, permissions: { type: [String], default: [] }, sellerId: { type: String, default: null }, city: String, uf: String, isActive: { type: Boolean, default: true }, emailVerified: { type: Boolean, default: false }, googleId: { type: String, index: true, sparse: true }, authProvider: { type: String, default: 'password' }, resetPasswordTokenHash: { type: String, default: '' }, resetPasswordExpiresAt: { type: Date, default: null } }, baseOptions);
const sellerSchema = new mongoose.Schema({ sellerId: { type: String, index: true, unique: true }, userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, displayName: String, storeName: String, email: String, phone: String, document: String, status: { type: String, default: 'pending' }, onboardingCompleted: { type: Boolean, default: false }, metadata: mongoose.Schema.Types.Mixed }, baseOptions);
const categorySchema = new mongoose.Schema({ name: { type: String, required: true }, slug: String, parentId: { type: String, default: null }, active: { type: Boolean, default: true }, sortOrder: { type: Number, default: 0 }, image: String }, baseOptions);
const productSchema = new mongoose.Schema({ sellerId: { type: String, index: true }, sellerName: String, name: { type: String, required: true, index: true }, slug: String, description: String, category: String, categoryId: String, categoryName: String, brand: String, sku: String, price: { type: Number, required: true, default: 0 }, oldPrice: { type: Number, default: null }, pixPrice: { type: Number, default: null }, installmentCount: { type: Number, default: 12 }, image: String, imageUrl: String, imagem: String, mainImageUrl: String, mainImagePath: String, images: [mongoose.Schema.Types.Mixed], imageUrls: [String], imagePaths: [String], stock: { type: Number, default: 0 }, active: { type: Boolean, default: true }, specs: mongoose.Schema.Types.Mixed, dimensions: mongoose.Schema.Types.Mixed, logistics: mongoose.Schema.Types.Mixed, weight: Number, length: Number, height: Number, width: Number, isOffer: { type: Boolean, default: false }, isFavorite: { type: Boolean, default: false }, isHighlight: { type: Boolean, default: false }, isBestSeller: { type: Boolean, default: false }, isNewArrival: { type: Boolean, default: false }, isRecommended: { type: Boolean, default: false }, posters: [mongoose.Schema.Types.Mixed] }, baseOptions);
productSchema.index({ name: 'text', description: 'text', category: 'text', brand: 'text' });
const bannerSchema = new mongoose.Schema({ slot: { type: String, required: true, index: true }, targetSlot: { type: String, index: true }, title: String, subtitle: String, image: String, href: String, alt: String, active: { type: Boolean, default: true }, status: { type: String, default: 'published', index: true }, source: { type: String, default: 'manual' }, draftType: String, products: [mongoose.Schema.Types.Mixed], sortOrder: { type: Number, default: 0 }, device: { type: String, default: 'all' } }, baseOptions);
const addressSchema = new mongoose.Schema({ userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }, name: String, phone: String, cep: String, logradouro: String, numero: String, bairro: String, cidade: String, uf: String, complemento: String, reference: String, isDefault: { type: Boolean, default: false } }, baseOptions);
const ticketSchema = new mongoose.Schema({ userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, default: null }, orderId: { type: String, default: null }, protocolo: { type: String, index: true }, tipo: String, assunto: String, mensagem: String, status: { type: String, default: 'Novo' }, origem: { type: String, default: 'site' }, nome: String, email: String, telefone: String, metadata: mongoose.Schema.Types.Mixed }, baseOptions);
const contactSchema = new mongoose.Schema({ name: String, email: String, phone: String, subject: String, message: String, source: { type: String, default: 'fale_conosco' }, status: { type: String, default: 'novo' } }, baseOptions);
const denunciaSchema = new mongoose.Schema({ userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, productId: { type: String, default: null }, sellerId: { type: String, default: null }, motivo: String, descricao: String, status: { type: String, default: 'nova' }, nome: String, email: String }, baseOptions);
const orderSchema = new mongoose.Schema({ userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, default: null }, sellerIds: [String], customerName: String, customerEmail: String, customerPhone: String, status: { type: String, default: 'pendente', index: true }, statusLabel: String, items: [{ productId: String, sellerId: String, name: String, sku: String, qty: Number, unitPrice: Number, totalPrice: Number, sellerBaseUnitPrice: Number, sellerBaseTotal: Number, cardMarkupUnit: Number, cardMarkupTotal: Number, image: String }], subtotal: { type: Number, default: 0 }, shippingCost: { type: Number, default: 0 }, montagemCost: { type: Number, default: 0 }, total: { type: Number, default: 0 }, currency: { type: String, default: DEFAULT_CURRENCY }, payment: mongoose.Schema.Types.Mixed, shippingAddress: mongoose.Schema.Types.Mixed, shipping: mongoose.Schema.Types.Mixed, trackingCode: String, trackingHistory: [mongoose.Schema.Types.Mixed], notes: String, manufacturer: String, manufacturerDispatch: mongoose.Schema.Types.Mixed, status_integracao: String, whatsappNotification: mongoose.Schema.Types.Mixed, chatMeta: mongoose.Schema.Types.Mixed }, baseOptions);
const settingsSchema = new mongoose.Schema({ key: { type: String, unique: true, index: true }, value: mongoose.Schema.Types.Mixed, updatedBy: String }, baseOptions);
const integrationAuditLogSchema = new mongoose.Schema({ scope: { type: String, default: 'integration' }, eventType: { type: String, default: 'unspecified', index: true }, orderId: { type: String, default: null, index: true }, manufacturer: { type: String, default: null, index: true }, integrationId: { type: String, default: null }, queueId: { type: String, default: null }, status: String, statusCode: Number, message: String, changedKeys: [String], request: mongoose.Schema.Types.Mixed, response: mongoose.Schema.Types.Mixed, metadata: mongoose.Schema.Types.Mixed, buildId: String }, baseOptions);
const manufacturerIntegrationSchema = new mongoose.Schema({ manufacturer: { type: String, unique: true, index: true }, enabled: { type: Boolean, default: true }, endpoint: String, method: { type: String, default: 'POST' }, headers: mongoose.Schema.Types.Mixed, authType: String, authToken: String, apiKey: String, sendAs: { type: String, default: 'json', enum: ['json', 'form'] }, timeoutMs: { type: Number, default: 30000 }, metadata: mongoose.Schema.Types.Mixed }, baseOptions);
const manufacturerDispatchQueueSchema = new mongoose.Schema({ queueId: { type: String, unique: true, index: true }, orderId: { type: String, required: true, index: true }, manufacturer: { type: String, required: true, index: true }, payload: mongoose.Schema.Types.Mixed, status: { type: String, default: 'pending', index: true }, attempts: { type: Number, default: 0 }, maxAttempts: { type: Number, default: MAX_DISPATCH_ATTEMPTS }, nextAttemptAt: { type: Date, default: now, index: true }, lastAttemptAt: Date, lastError: String, lastResponse: mongoose.Schema.Types.Mixed, deadLetter: { type: Boolean, default: false } }, baseOptions);
const operationalAlertSchema = new mongoose.Schema({ alertId: { type: String, unique: true, index: true }, type: { type: String, index: true }, severity: { type: String, default: 'medium' }, status: { type: String, default: 'open', index: true }, title: String, message: String, manufacturer: String, orderId: String, queueId: String, entityKey: String, count: { type: Number, default: 1 }, metadata: mongoose.Schema.Types.Mixed, buildId: String, firstSeenAt: Date, lastSeenAt: Date, resolvedAt: Date }, baseOptions);
const whatsappWebhookSchema = new mongoose.Schema({ event: String, remoteJid: String, number: String, pushName: String, fromMe: Boolean, text: String, payload: mongoose.Schema.Types.Mixed }, baseOptions);
const notificationSchema = new mongoose.Schema({ type: String, title: String, message: String, status: { type: String, default: 'unread' }, relatedId: String, severity: { type: String, default: 'info' }, audience: { type: String, default: 'admin', index: true }, sellerId: { type: String, default: '', index: true }, metadata: mongoose.Schema.Types.Mixed }, baseOptions);
const paymentEventSchema = new mongoose.Schema({ provider: { type: String, index: true }, eventType: String, externalId: String, orderId: String, payload: mongoose.Schema.Types.Mixed }, baseOptions);

const User = mongoose.model('User', userSchema);
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
  const valor = Number(data.valor || data.valorPago || 0);
  const documento = String(data.documento || data.recibo || data.contrato || '').trim();
  const urgente = tipo.includes('urg');

  const cabecalho = urgente ? '🚨 Aviso urgente de pendência financeira' : '🔔 Aviso de pendência financeira';
  const mensagemPrincipal = urgente
    ? 'Constam nota(s)/parcela(s) em atraso em nosso sistema. Solicitamos contato com urgência para regularização ou esclarecimentos.'
    : 'Informamos que existe nota/parcela em atraso em nosso sistema.';
  const fechamento = urgente
    ? 'Para evitar bloqueio interno de crédito e novos transtornos, pedimos que entre em contato com a loja o quanto antes.'
    : 'Por favor, entre em contato com a loja para mais informações ou regularização.';

  const linhas = [
    cabecalho,
    '',
    `Olá, ${nome}.`,
    '',
    mensagemPrincipal,
    '',
    produto ? `📦 Referência: ${produto}` : '',
    parcela ? `📌 Parcela: ${parcela}` : '',
    valor > 0 ? `💰 Valor: ${formatMoneyBRL(valor)}` : '',
    documento ? `🧾 Documento: ${documento}` : '',
    '',
    fechamento,
    '',
    '📲 WhatsApp financeiro:',
    '(31) 98514-7119',
    '',
    'Ariana Móveis'
  ];

  return linhas.filter((linha) => linha !== '').join('\n');
}

async function sendCrediarioCobrancaWhatsapp({ telefone = '', clienteNome = '', produto = '', parcela = '', valor = 0, documento = '', recibo = '', contrato = '', tipo = 'normal' } = {}) {
  const number = normalizePhone(telefone || '', '55');
  if (!number) throw new Error('Telefone do cliente inválido para envio da cobrança.');
  const text = buildCrediarioCobrancaMessage({ clienteNome, produto, parcela, valor, documento, recibo, contrato, tipo });
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

app.get('/api/admin/sige/status', adminRequired, async (_req, res) => {
  return res.json({
    ok: true,
    configured: isSigeConfigured(),
    apiUrl: SIGE_API_URL,
    user: SIGE_USER ? SIGE_USER.replace(/(.{3}).+(@.+)/, '$1***$2') : '',
    app: SIGE_APP || '',
    tokenConfigured: Boolean(SIGE_TOKEN)
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
      return {
        ...l,
        chave,
        status,
        vencida: Boolean(vencida),
        emAberto: Boolean(emAberto),
        valorParcela: Number(l.valor || 0),
        valorPago: Number(l.totalRecebido || 0),
        saldoParcela: Math.max(0, Number(l.saldo || 0))
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
    return group;
  });

  const resumo = grupos.reduce((acc, g) => {
    acc.total += g.total;
    acc.pago += g.pago;
    acc.saldo += g.saldo;
    acc.parcelas += g.parcelas.length;
    acc.pagas += g.pagas;
    acc.abertas += g.abertas;
    acc.atrasadas += g.atrasadas;
    return acc;
  }, { total: 0, pago: 0, saldo: 0, parcelas: 0, pagas: 0, abertas: 0, atrasadas: 0 });
  resumo.total = Number(resumo.total.toFixed(2));
  resumo.pago = Number(resumo.pago.toFixed(2));
  resumo.saldo = Number(resumo.saldo.toFixed(2));

  return {
    cliente: parcelas[0]?.cliente || pessoa?.nome || '',
    telefone: pessoa?.telefone || '',
    cpf: pessoa?.cpf || '',
    cidade: pessoa?.cidade || '',
    uf: pessoa?.uf || '',
    resumo,
    grupos,
    parcelas
  };
}


function buildSigeCarneWhatsappMessage(carne = {}) {
  const resumo = carne.resumo || {};
  const grupos = Array.isArray(carne.grupos) ? carne.grupos : [];
  const linhas = [];
  linhas.push('📋 Carnê Digital Ariana Móveis');
  linhas.push('');
  linhas.push(`Olá, ${carne.cliente || 'cliente'}.`);
  linhas.push('Segue o resumo atualizado do seu carnê:');
  linhas.push('');
  linhas.push(`💰 Total lançado: ${formatMoneyBRL(resumo.total || 0)}`);
  linhas.push(`✅ Total pago: ${formatMoneyBRL(resumo.pago || 0)}`);
  linhas.push(`📌 Saldo restante: ${formatMoneyBRL(resumo.saldo || 0)}`);
  linhas.push(`🧾 Parcelas: ${resumo.parcelas || 0} total • ${resumo.pagas || 0} pagas • ${resumo.abertas || 0} abertas • ${resumo.atrasadas || 0} atrasadas`);
  linhas.push('');

  let totalListadas = 0;
  for (const grupo of grupos.slice(0, 8)) {
    linhas.push(`📄 ${grupo.documento || 'Compra'}`);
    if (grupo.descricao) linhas.push(String(grupo.descricao).slice(0, 120));

    const parcelas = Array.isArray(grupo.parcelas) ? grupo.parcelas : [];
    for (const p of parcelas.slice(0, 18)) {
      totalListadas += 1;
      const status = p.status === 'paga' ? '✅ Paga' : (p.status === 'atrasada' ? '⚠️ Atrasada' : '⏳ Em aberto');
      const venc = p.dataVencimento ? formatDateBR(p.dataVencimento) : 'sem vencimento';
      const valor = formatMoneyBRL(p.saldoParcela || p.valorParcela || p.valor || 0);
      linhas.push(`${p.parcelaLabel || ''} ${venc} - ${valor} - ${status}`.trim());
    }
    linhas.push('');
  }

  const totalParcelas = Number(resumo.parcelas || 0);
  if (totalParcelas > totalListadas) {
    linhas.push(`... e mais ${totalParcelas - totalListadas} parcela(s).`);
    linhas.push('');
  }

  linhas.push('Para dúvidas ou regularização, entre em contato com nosso financeiro:');
  linhas.push('📲 (31) 98514-7119');
  linhas.push('');
  linhas.push('Ariana Móveis');

  return linhas.filter((linha) => linha !== null && linha !== undefined).join('\n').trim();
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
  return { ok: true, ...carne, total: lancamentos.length, fonte: 'lancamentos_sige' };
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

app.post('/api/admin/sige/carne/enviar-whatsapp', adminRequired, async (req, res) => {
  try {
    const q = String(req.body?.cliente || req.body?.q || '').trim();
    const telefoneManual = String(req.body?.telefone || '').trim();
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

    const text = buildSigeCarneWhatsappMessage(carne);
    const sent = await waSendTextMessage({ number: telefone, text });
    return res.json({ ok: true, message: 'Carnê enviado pelo WhatsApp.', telefone, text, whatsapp: sent, carne });
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
      valor: parseSigeMoney(req.body.valor || req.body.saldo || 0),
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
      valor: body.valor || 0,
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
      valor: req.body?.valor || r.valorPago,
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
  try {
    const recibo = await CrediarioRecibo.findById(req.params.id);
    if (!recibo) return res.status(404).json({ ok: false, error: 'Recibo não encontrado' });
    const whatsapp = await sendCrediarioReceiptWhatsapp(recibo);
    recibo.enviadoWhatsapp = true;
    recibo.enviadoWhatsappEm = now();
    recibo.whatsappResultado = redact(whatsapp || null);
    await recibo.save();
    return res.json({ ok: true, recibo: normalizeCrediarioRecibo(recibo), whatsapp });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao reenviar recibo pelo WhatsApp' });
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


const BUILD_ID = 'enterprise-mongo-2026-04-02';
async function writeAuditLog(entry = {}) { return IntegrationAuditLog.create({ scope: entry.scope || 'integration', eventType: entry.eventType || 'unspecified', orderId: entry.orderId ? String(entry.orderId) : null, manufacturer: entry.manufacturer ? String(entry.manufacturer) : null, integrationId: entry.integrationId ? String(entry.integrationId) : null, queueId: entry.queueId ? String(entry.queueId) : null, status: entry.status || null, statusCode: Number.isFinite(Number(entry.statusCode)) ? Number(entry.statusCode) : null, message: entry.message || null, changedKeys: Array.isArray(entry.changedKeys) ? entry.changedKeys.slice(0, 200) : [], request: redact(entry.request || null), response: redact(entry.response || null), metadata: redact(entry.metadata || null), buildId: BUILD_ID }); }
async function upsertOperationalAlert(data = {}) { const manufacturer = data.manufacturer ? String(data.manufacturer) : 'global'; const type = data.type ? String(data.type) : 'generic'; const entityKey = data.entityKey ? String(data.entityKey) : `${manufacturer}_${type}`; const alertId = `${sanitizeIdPart(type)}__${sanitizeIdPart(entityKey)}`; const existing = await OperationalAlert.findOne({ alertId }); if (!existing) return OperationalAlert.create({ alertId, type, severity: data.severity || 'medium', status: data.status || 'open', title: data.title || 'Alerta operacional', message: data.message || null, manufacturer: data.manufacturer || null, orderId: data.orderId || null, queueId: data.queueId || null, entityKey, count: 1, metadata: redact(data.metadata || null), buildId: BUILD_ID, firstSeenAt: now(), lastSeenAt: now(), resolvedAt: data.status === 'resolved' ? now() : null }); existing.count = Number(existing.count || 1) + 1; existing.severity = data.severity || existing.severity; existing.status = data.status || 'open'; existing.title = data.title || existing.title; existing.message = data.message || existing.message; existing.manufacturer = data.manufacturer || existing.manufacturer; existing.orderId = data.orderId || existing.orderId; existing.queueId = data.queueId || existing.queueId; existing.metadata = redact(data.metadata || existing.metadata || null); existing.lastSeenAt = now(); existing.buildId = BUILD_ID; if (existing.status === 'resolved') existing.resolvedAt = now(); await existing.save(); return existing; }
async function resolveOperationalAlert(type, entityKey) { const alertId = `${sanitizeIdPart(type)}__${sanitizeIdPart(entityKey)}`; await OperationalAlert.findOneAndUpdate({ alertId }, { $set: { status: 'resolved', resolvedAt: now(), lastSeenAt: now(), buildId: BUILD_ID } }); }
async function scanOperationalAlerts() { const findings = []; const queueRows = await ManufacturerDispatchQueue.find().sort({ updatedAt: -1 }).limit(200); for (const row of queueRows) { const status = String(row.status || '').toLowerCase(); const attempts = Number(row.attempts || 0); if (status === 'dead_letter') { findings.push(await upsertOperationalAlert({ type: 'dispatch_dead_letter', severity: 'critical', manufacturer: row.manufacturer, orderId: row.orderId, queueId: row.queueId, entityKey: row.queueId, title: 'Pedido caiu em dead letter', message: `O pedido ${row.orderId || row.queueId} esgotou as tentativas de envio ao fabricante.`, metadata: row.toObject() })); continue; } if (['pending', 'retrying', 'retry_processing'].includes(status) && attempts >= 3) findings.push(await upsertOperationalAlert({ type: 'dispatch_retry_pressure', severity: attempts >= 5 ? 'high' : 'medium', manufacturer: row.manufacturer, orderId: row.orderId, queueId: row.queueId, entityKey: row.queueId, title: 'Fila de reenvio com muitas tentativas', message: `O pedido ${row.orderId || row.queueId} já acumula ${attempts} tentativas de envio ao fabricante.`, metadata: row.toObject() })); }
 const orders = await Order.find().sort({ updatedAt: -1 }).limit(200); for (const row of orders) { const integ = String(row.status_integracao || '').toLowerCase(); const dispatchStatus = String(row.manufacturerDispatch?.status || '').toLowerCase(); const manufacturer = row.manufacturer || row.sellerIds?.[0] || null; if (['erro_envio_fabricante', 'fila_erro_fabricante'].includes(integ) || dispatchStatus === 'error') findings.push(await upsertOperationalAlert({ type: 'order_dispatch_error', severity: 'high', manufacturer, orderId: String(row._id), queueId: row.manufacturerDispatch?.queueId || null, entityKey: String(row._id), title: 'Pedido com erro de integração', message: `O pedido ${row._id} está com falha no envio ao fabricante.`, metadata: { status_integracao: row.status_integracao || null, manufacturerDispatch: row.manufacturerDispatch || null } })); }
 const since = new Date(Date.now() - (6 * 60 * 60 * 1000)); const recentLogs = await IntegrationAuditLog.find({ createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(300); const stats = {}; for (const log of recentLogs) { const manufacturer = String(log.manufacturer || 'global'); if (!stats[manufacturer]) stats[manufacturer] = { errors: 0, success: 0 }; if (log.eventType === 'manufacturer_dispatch_http') { if (String(log.status || '').toLowerCase() === 'success' || (Number(log.statusCode) >= 200 && Number(log.statusCode) < 300)) stats[manufacturer].success += 1; else stats[manufacturer].errors += 1; } } for (const [manufacturer, stat] of Object.entries(stats)) { if (stat.errors >= 3 && stat.success === 0) findings.push(await upsertOperationalAlert({ type: 'manufacturer_outage', severity: stat.errors >= 5 ? 'critical' : 'high', manufacturer, entityKey: manufacturer, title: 'Possível indisponibilidade do fabricante', message: `Foram detectadas ${stat.errors} falhas recentes sem sucesso para ${manufacturer}.`, metadata: stat })); } return findings; }

function redactWhatsappSettings(settings = {}) { const cfg = { ...(settings || {}) }; if (cfg.apiKey) cfg.apiKey = '[redacted]'; return cfg; }
function extractOrderPhone(order = {}, defaultCountryCode = '55') { const candidates = [order.whatsapp, order.telefoneWhatsapp, order.telefone, order.phone, order.customerPhone, order.customerWhatsapp, order.customer?.phone, order.customer?.whatsapp, order.shippingAddress?.phone]; for (const value of candidates) { const n = normalizePhone(value, defaultCountryCode); if (n) return n; } return ''; }
function extractOrderCustomerName(order = {}) { return String(order.customerName || order.nomeCliente || order.nome || order.customer?.name || order.customer?.nome || order.user?.name || order.customerEmail || 'Cliente').trim() || 'Cliente'; }
function extractSellerPhone(order = {}, defaultCountryCode = '55') { const candidates = [order.sellerPhone, order.sellerWhatsapp, order.seller?.phone, order.seller?.whatsapp, order.vendorPhone, order.fabricanteTelefone]; for (const value of candidates) { const n = normalizePhone(value, defaultCountryCode); if (n) return n; } return ''; }
function parseAdminNotifyNumbers(settings = {}) { return String(settings.adminNotifyNumbers || '').split(',').map(item => normalizePhone(item, settings.defaultCountryCode || '55')).filter(Boolean); }
function buildTrackingLine(order = {}, trackingCode = '') {
  const code = String(trackingCode || order.trackingCode || order.tracking_code || '').trim();
  return code ? `\n🔎 Código de rastreio: ${code}` : '';
}

function formatOrderStatusForCustomer(status = '') {
  const key = String(status || '').trim().toLowerCase();

  const map = {
    pending: 'Aguardando pagamento',
    pending_payment: 'Aguardando pagamento',
    aguardando_pagamento: 'Aguardando pagamento',
    paid: 'Pagamento confirmado',
    approved: 'Pagamento confirmado',
    pagamento_confirmado: 'Pagamento confirmado',
    processing: 'Pedido em separação',
    separacao: 'Pedido em separação',
    em_separacao: 'Pedido em separação',
    shipped: 'Pedido enviado',
    enviado: 'Pedido enviado',
    despachado: 'Pedido enviado',
    saiu_entrega: 'Saiu para entrega',
    saiu_para_entrega: 'Saiu para entrega',
    saiu_para_entrega_cliente: 'Saiu para entrega',
    em_rota: 'Saiu para entrega',
    rota_entrega: 'Saiu para entrega',
    out_for_delivery: 'Saiu para entrega',
    delivered: 'Pedido entregue',
    entregue: 'Pedido entregue',
    canceled: 'Pedido cancelado',
    cancelled: 'Pedido cancelado',
    cancelado: 'Pedido cancelado',
    rejected: 'Pagamento recusado',
    recusado: 'Pagamento recusado'
  };

  return map[key] || status || 'Atualizado';
}

function buildOrderStatusActionMessage(status = '') {
  const key = String(status || '').trim().toLowerCase();

  if (
    key.includes('pagamento confirmado') ||
    key.includes('approved') ||
    key.includes('paid') ||
    key.includes('aprovado') ||
    key.includes('pago')
  ) {
    return '✅ Pagamento confirmado com sucesso.\n\nSeu pedido já está sendo preparado para envio.';
  }

  if (
    key.includes('separacao') ||
    key.includes('separação') ||
    key.includes('processing')
  ) {
    return '📦 Seu pedido está sendo separado e conferido pela nossa equipe.';
  }

  if (
    key.includes('saiu para entrega') ||
    key.includes('saiu_entrega') ||
    key.includes('saiu_para_entrega') ||
    key.includes('out_for_delivery')
  ) {
    return '📍 Seu pedido saiu para entrega.\n\nNossa equipe está finalizando a rota e a entrega poderá ocorrer a qualquer momento.';
  }

  if (
    key.includes('enviado') ||
    key.includes('shipped') ||
    key.includes('despachado') ||
    key.includes('transporte')
  ) {
    return '🚚 Seu pedido foi despachado e está a caminho.';
  }

  if (
    key.includes('entregue') ||
    key.includes('delivered')
  ) {
    return '🎉 Pedido entregue com sucesso.\n\nEsperamos que você aproveite sua compra.';
  }

  if (
    key.includes('aguardando pagamento') ||
    key.includes('pending') ||
    key.includes('pendente') ||
    key.includes('aguard')
  ) {
    return '💳 Assim que o pagamento for confirmado, vamos iniciar a preparação do seu pedido.';
  }

  if (
    key.includes('cancel') ||
    key.includes('recus')
  ) {
    return 'ℹ️ Caso tenha dúvidas sobre esta atualização, fale com nossa equipe de atendimento.';
  }

  return '📲 Você pode acompanhar novas atualizações diretamente pelo WhatsApp.';
}

function titleCaseCustomerName(name = '') {
  return String(name || 'Cliente')
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildOrderStatusMessage(orderId, order = {}, settings = {}) {
  const customerName = titleCaseCustomerName(extractOrderCustomerName(order));
  const fullId = String(orderId || order._id || order.id || order.orderId || '').trim();
  const shortId = fullId ? fullId.slice(-8).toUpperCase() : '---';

  const rawStatus = order.statusLabel || order.status || 'Atualizado';
  const statusLabel = formatOrderStatusForCustomer(rawStatus);
  const actionMessage = buildOrderStatusActionMessage(`${rawStatus} ${statusLabel}`);
  const trackingLine = buildTrackingLine(order);

  const produto = Array.isArray(order.items) && order.items.length
    ? String(order.items[0]?.name || '').trim()
    : '';

  const valor = Number(order.total || 0);
  const valorLinha = valor > 0
    ? `\n💰 Valor: ${formatMoneyBRL(valor)}`
    : '';

  const produtoLinha = produto
    ? `\n📦 Produto: ${produto}`
    : '';

  return `
🛒 Ariana Móveis

Olá, ${customerName}! 👋

Seu pedido #${shortId} foi atualizado.

📋 Status: ${statusLabel}${produtoLinha}${valorLinha}${trackingLine}

${actionMessage}

💙 Obrigado por escolher a Ariana Móveis.

Atenciosamente,
Equipe Ariana Móveis
`.trim();
}
function buildOrderChatMessage(orderId, order = {}, message = {}) { const senderName = String(message.senderName || 'Equipe Ariana Móveis').trim(); const senderType = String(message.senderType || 'admin').trim(); const customerName = extractOrderCustomerName(order); const base = senderType === 'customer' ? `Olá! O cliente ${senderName} enviou uma nova mensagem no pedido ${orderId} da Ariana Móveis.` : `Olá, ${customerName}! Você recebeu uma nova mensagem sobre o pedido ${orderId} na Ariana Móveis.`; const text = String(message.text || '').trim(); return `${base}\n\nMensagem: ${text}`.trim(); }
async function waSendTextMessage({ number, text, settings = null, delay = 0 }) { const cfg = settings || await getWhatsappSettings(); if (!cfg.enabled) throw new Error('Integração WhatsApp desativada.'); if (!cfg.apiUrl || !cfg.apiKey || !cfg.instanceName) throw new Error('Configuração incompleta do WhatsApp.'); const normalizedNumber = normalizePhone(number, cfg.defaultCountryCode || '55'); if (!normalizedNumber) throw new Error('Número de telefone inválido.'); const url = `${String(cfg.apiUrl).replace(/\/+$/, '')}/message/sendText/${encodeURIComponent(cfg.instanceName)}`; const response = await axios.post(url, { number: normalizedNumber, text: String(text || '').trim(), delay: Number(delay || 0) || 0, linkPreview: false }, { headers: { 'Content-Type': 'application/json', apikey: cfg.apiKey }, timeout: 30000 }); return { ok: true, url, number: normalizedNumber, instanceName: cfg.instanceName, data: response.data, status: response.status }; }

function formatMoneyBRL(value = 0) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: DEFAULT_CURRENCY }).format(Number(value || 0));
}


// ============================================================
// PREÇO MARKETPLACE / SELLER
// Regra Ariana: o seller cadastra o preço líquido/base. O site
// exibe preço parcelado/cartão com acréscimo embutido e PIX/BOLETO
// voltam ao preço base com 17% OFF. O seller nunca vê a taxa cartão.
// ============================================================
const MARKETPLACE_CARD_DISCOUNT_PERCENT = Number(process.env.MARKETPLACE_CARD_DISCOUNT_PERCENT || 17);
const MARKETPLACE_COMMISSION_PERCENT = Number(process.env.MARKETPLACE_COMMISSION_PERCENT || 12);
function roundMoney(value = 0) { return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100; }
function getMarketplaceFactor() { const p = Math.min(90, Math.max(0, Number(MARKETPLACE_CARD_DISCOUNT_PERCENT || 17))); return roundMoney((100 - p) / 100) || 0.83; }
function sellerBaseToMarketplacePrice(basePrice = 0) { const base = Number(basePrice || 0); if (!base) return 0; return roundMoney(base / getMarketplaceFactor()); }
function marketplacePriceToSellerBase(chargedPrice = 0) { const charged = Number(chargedPrice || 0); if (!charged) return 0; return roundMoney(charged * getMarketplaceFactor()); }
function isCreditCardPayment(method = '') { const m = String(method || '').toLowerCase(); return m.includes('card') || m.includes('cartao') || m.includes('cartão') || m.includes('credit'); }
function getOrderPaymentMethod(order = {}) { return String(order?.payment?.method || order?.paymentMethod || order?.method || '').toLowerCase(); }
function getChargedItemTotal(item = {}) {
  const qty = Math.max(1, Number(item.qty || item.quantity || 1) || 1);
  return roundMoney(Number(item.totalPrice || ((Number(item.unitPrice || item.price || 0) || 0) * qty) || 0));
}

function getItemProductId(item = {}) {
  return String(item.productId || item._id || item.id || '').trim();
}

function getProductSellerBasePrice(product = {}) {
  const candidates = [
    product.sellerBasePrice,
    product.sellerBaseUnitPrice,
    product.basePrice,
    product.pixPrice,
    product.precoBaseSeller,
    product.precoSeller,
    product.preco,
    product.price
  ];

  for (const value of candidates) {
    const n = Number(value || 0);
    if (n > 0) return roundMoney(n);
  }
  return 0;
}

async function buildProductBasePriceMapForOrders(orders = []) {
  const ids = Array.from(new Set(
    ensureArray(orders)
      .flatMap((order) => ensureArray((toJSON(order) || order || {}).items))
      .map(getItemProductId)
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
  ));

  if (!ids.length) return new Map();

  const products = await Product.find({ _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } })
    .select('_id price preco pixPrice sellerBasePrice sellerBaseUnitPrice basePrice precoBaseSeller precoSeller sellerId')
    .lean();

  return new Map(products.map((product) => [String(product._id), {
    price: getProductSellerBasePrice(product),
    sellerId: String(product.sellerId || '').trim()
  }]));
}

function getItemSellerBaseTotal(item = {}, order = {}, productBaseMap = new Map()) {
  const qty = Math.max(1, Number(item.qty || item.quantity || 1) || 1);
  const chargedTotal = getChargedItemTotal(item);
  const productId = getItemProductId(item);
  const productBase = productBaseMap instanceof Map ? productBaseMap.get(productId) : null;

  // Regra principal: o preço cadastrado pelo seller no produto é a base real do repasse.
  // Exemplo: seller cadastrou R$ 700,00. O site pode cobrar R$ 843/845 no cartão,
  // mas o extrato do seller precisa partir de R$ 700,00, não do valor com acréscimo.
  if (productBase && Number(productBase.price || 0) > 0) {
    return roundMoney(Number(productBase.price || 0) * qty);
  }

  const explicitUnit = Number(item.sellerBaseUnitPrice || item.baseUnitPrice || item.basePrice || 0);
  if (explicitUnit > 0) return roundMoney(explicitUnit * qty);

  const explicitTotal = Number(item.sellerBaseTotal || item.sellerSubtotal || item.baseTotal || 0);
  if (explicitTotal > 0 && explicitTotal < chargedTotal) return roundMoney(explicitTotal);

  const markupTotal = Number(item.cardMarkupTotal || 0);
  if (markupTotal > 0 && chargedTotal > markupTotal) return roundMoney(chargedTotal - markupTotal);

  // Fallback para pedidos antigos em que o método de pagamento veio como Mercado Pago/card
  // e o pedido salvou somente o valor final cobrado ao cliente.
  if (isCreditCardPayment(getOrderPaymentMethod(order))) return marketplacePriceToSellerBase(chargedTotal);

  return roundMoney(explicitTotal > 0 ? explicitTotal : chargedTotal);
}
function getSellerSettlementForOrder(orderDoc = {}, sellerId = '', productBaseMap = new Map()) {
  const order = toJSON(orderDoc) || orderDoc || {};
  const sid = String(sellerId || '').trim();
  const rows = ensureArray(order.items).filter((it) => !sid || String(it?.sellerId || it?.seller_id || '').trim() === sid);
  const chargedGross = roundMoney(rows.reduce((sum, it) => sum + getChargedItemTotal(it), 0));
  const gross = roundMoney(rows.reduce((sum, it) => sum + getItemSellerBaseTotal(it, order, productBaseMap), 0));
  const cardFee = roundMoney(Math.max(0, chargedGross - gross));
  const commission = roundMoney(gross * (MARKETPLACE_COMMISSION_PERCENT / 100));
  const labels = ensureArray(order.logisticsLabels || order.labels || []);
  let labelFee = 0;
  for (const label of labels) {
    const ls = String(label?.sellerId || '').trim();
    if (sid && ls && ls !== sid) continue;
    const marketplace = label?.marketplace === true || label?.usesMarketplaceLabel === true || label?.provider === 'correios' || label?.provider === 'frenet' || label?.provider === 'ariana_local';
    if (marketplace) labelFee += Number(label?.shippingCost || label?.cost || 0) || 0;
  }
  if (!labelFee && order.etiqueta && (order.shipping?.usesArianaLogistics || order.etiqueta?.provider)) labelFee = Number(order.etiqueta.shippingCost || 0) || 0;
  labelFee = roundMoney(labelFee);
  const net = roundMoney(gross - commission - labelFee);
  return { chargedGross, gross, cardFee, commission, fee: commission, label: labelFee, net, commissionPercent: MARKETPLACE_COMMISSION_PERCENT };
}

function formatOrderItemsForWhatsapp(items = []) {
  const rows = ensureArray(items).filter(Boolean).slice(0, 12).map((item) => {
    const qty = Number(item.qty || item.quantity || 1) || 1;
    const name = String(item.name || item.nome || item.sku || 'Produto').trim();
    const total = Number(item.totalPrice || (Number(item.unitPrice || item.price || 0) * qty) || 0);
    return `• ${qty}x ${name}${total ? ` — ${formatMoneyBRL(total)}` : ''}`;
  });
  if (!rows.length) return '• Itens não informados';
  if (ensureArray(items).length > rows.length) rows.push(`• +${ensureArray(items).length - rows.length} item(ns)`);
  return rows.join('\n');
}

function buildAdminNewOrderMessage(orderDoc = {}) {
  const order = toJSON(orderDoc) || orderDoc || {};

  const orderId = String(order._id || order.id || '').slice(-8).toUpperCase() || '---';
  const customerName = String(order.customerName || order.shippingAddress?.name || 'Cliente não informado').trim();
  const customerPhone = String(order.customerPhone || order.shippingAddress?.phone || '').trim();
  const paymentMethod = String(order.payment?.method || order.payment?.payment_method || order.payment?.type || order.payment?.provider || 'Não informado').trim();
  const address = order.shippingAddress || {};
  const cidadeUf = [address.cidade || address.city, address.uf || address.state].filter(Boolean).join('/');
  const prazo = order.shipping?.prazo || order.shipping?.deliveryTime || order.shipping?.prazoEntrega || (order.shipping?.deadlineDays ? `${order.shipping.deadlineDays} dia(s) úteis` : 'Não informado');

  return [
    'ðŸ›’ *NOVA VENDA REALIZADA*',
    '',
    `Pedido: #${orderId}`,
    `Cliente: ${customerName}`,
    customerPhone ? `Telefone: ${customerPhone}` : 'Telefone: não informado',
    `Valor total: ${formatMoneyBRL(order.total || 0)}`,
    `Pagamento: ${paymentMethod}`,
    `Status: ${order.statusLabel || order.status || 'pendente'}`,
    `Prazo/Frete: ${prazo}`,
    cidadeUf ? `Cidade: ${cidadeUf}` : '',
    '',
    '*Itens:*',
    formatOrderItemsForWhatsapp(order.items || [])
  ].filter((line) => line !== '').join('\n');
}

async function waNotifyAdminNewOrder(orderDoc = {}, origin = 'order_created') {
  try {
    const settings = await getWhatsappSettings();
    const targets = parseAdminNotifyNumbers(settings);
    if (!settings.enabled) return { skipped: true, reason: 'integration_disabled' };
    if (!targets.length) return { skipped: true, reason: 'missing_admin_notify_numbers' };

    const text = buildAdminNewOrderMessage(orderDoc);
    const results = [];
    for (const number of targets) {
      try {
        const sent = await waSendTextMessage({ number, text, settings });
        results.push({ number, ok: true, status: sent.status, data: sent.data || null });
      } catch (error) {
        results.push({ number, ok: false, error: error.message || String(error) });
      }
    }

    await writeAuditLog({
      scope: 'whatsapp_evolution',
      eventType: 'admin_new_order_whatsapp_sent',
      orderId: String(orderDoc?._id || orderDoc?.id || ''),
      status: results.some((row) => row.ok) ? 'success' : 'error',
      request: { origin, numbers: targets, text },
      response: results,
      metadata: { instanceName: settings.instanceName, apiUrl: settings.apiUrl }
    });

    return { ok: results.some((row) => row.ok), results };
  } catch (error) {
    console.error('Erro ao notificar nova venda por WhatsApp:', error.message || error);
    return { ok: false, error: error.message || String(error) };
  }
}


function buildAdminOrderStatusMessage(orderId, before = {}, after = {}) {
  const order = toJSON(after) || after || {};

  const previousStatus = String(before?.statusLabel || before?.status || '---').trim();
  const nextStatus = String(order.statusLabel || order.status || 'Atualizado').trim();
  const customerName = String(order.customerName || order.shippingAddress?.name || 'Cliente não informado').trim();
  const customerPhone = String(order.customerPhone || order.shippingAddress?.phone || '').trim();
  const trackingCode = String(order.trackingCode || '').trim();
  const orderShort = String(order._id || order.id || orderId || '').slice(-8).toUpperCase() || '---';

  return [
    '📦 *PEDIDO ATUALIZADO*',
    '',
    `Pedido: #${orderShort}`,
    `Cliente: ${customerName}`,
    customerPhone ? `Telefone: ${customerPhone}` : 'Telefone: não informado',
    `Status anterior: ${previousStatus}`,
    `Novo status: ${nextStatus}`,
    `Valor total: ${formatMoneyBRL(order.total || 0)}`,
    trackingCode ? `Rastreio: ${trackingCode}` : ''
  ].filter(Boolean).join('\n');
}

async function waNotifyAdminOrderStatusChange(orderId, before = {}, after = {}, origin = 'admin_order_status_update') {
  try {
    console.log('[WHATSAPP STATUS ADMIN] INICIO', { orderId, origin, beforeStatus: before?.status, afterStatus: after?.status });
    const settings = await getWhatsappSettings();
    const targets = parseAdminNotifyNumbers(settings);
    if (!settings.enabled) return { skipped: true, reason: 'integration_disabled' };
    if (!targets.length) return { skipped: true, reason: 'missing_admin_notify_numbers' };

    const text = buildAdminOrderStatusMessage(orderId, before, after);
    const results = [];
    for (const number of targets) {
      try {
        const sent = await waSendTextMessage({ number, text, settings });
        results.push({ number, ok: true, status: sent.status, data: sent.data || null });
      } catch (error) {
        results.push({ number, ok: false, error: error.message || String(error) });
      }
    }

    await writeAuditLog({
      scope: 'whatsapp_evolution',
      eventType: 'admin_order_status_whatsapp_sent',
      orderId: String(orderId || after?._id || after?.id || ''),
      status: results.some((row) => row.ok) ? 'success' : 'error',
      request: { origin, numbers: targets, text },
      response: results,
      metadata: { instanceName: settings.instanceName, apiUrl: settings.apiUrl }
    });

    return { ok: results.some((row) => row.ok), results };
  } catch (error) {
    console.error('Erro ao notificar atualização do pedido para admin por WhatsApp:', error.message || error);
    return { ok: false, error: error.message || String(error) };
  }
}
async function waSendMediaMessage({ number, mediaUrl, caption = '', mediaType = 'image', fileName = '', settings = null, delay = 0 }) { const cfg = settings || await getWhatsappSettings(); if (!cfg.enabled) throw new Error('Integração WhatsApp desativada.'); if (!cfg.apiUrl || !cfg.apiKey || !cfg.instanceName) throw new Error('Configuração incompleta do WhatsApp.'); const normalizedNumber = normalizePhone(number, cfg.defaultCountryCode || '55'); if (!normalizedNumber) throw new Error('Número de telefone inválido.'); if (!String(mediaUrl || '').trim()) throw new Error('URL da mídia não informada.'); const url = `${String(cfg.apiUrl).replace(/\/+$/, '')}/message/sendMedia/${encodeURIComponent(cfg.instanceName)}`; const payload = { number: normalizedNumber, mediatype: String(mediaType || 'image').trim().toLowerCase(), media: String(mediaUrl || '').trim(), caption: String(caption || '').trim(), fileName: String(fileName || '').trim() || undefined, delay: Number(delay || 0) || 0 }; const response = await axios.post(url, payload, { headers: { 'Content-Type': 'application/json', apikey: cfg.apiKey }, timeout: 30000 }); return { ok: true, url, number: normalizedNumber, instanceName: cfg.instanceName, data: response.data, status: response.status, payload: redact(payload) }; }
async function waSyncWebhook(settings = null) { const cfg = settings || await getWhatsappSettings(); if (!cfg.apiUrl || !cfg.apiKey || !cfg.instanceName || !cfg.webhookUrl) throw new Error('Configuração incompleta do WhatsApp.'); const url = `${String(cfg.apiUrl).replace(/\/+$/, '')}/webhook/set/${encodeURIComponent(cfg.instanceName)}`; const body = { enabled: cfg.enabled === true, url: cfg.webhookUrl, webhookByEvents: cfg.webhookByEvents === true, webhookBase64: cfg.webhookBase64 === true, events: Array.isArray(cfg.webhookEvents) && cfg.webhookEvents.length ? cfg.webhookEvents : DEFAULT_WHATSAPP_SETTINGS.webhookEvents }; const response = await axios.post(url, body, { headers: { 'Content-Type': 'application/json', apikey: cfg.apiKey }, timeout: 30000 }); await saveWhatsappSettings({ lastWebhookSyncAt: now(), lastWebhookSyncResponse: redact(response.data || null) }, 'system'); return { ok: true, url, body, data: response.data, status: response.status }; }
function waParseIncomingWebhook(body = {}) { const payload = body?.data || body?.message || body || {}; const key = payload?.key || body?.key || {}; const message = payload?.message || body?.message || {}; const text = message?.conversation || message?.extendedTextMessage?.text || message?.imageMessage?.caption || message?.videoMessage?.caption || body?.text || ''; const remoteJid = key?.remoteJid || payload?.key?.remoteJid || body?.remoteJid || ''; const number = cleanPhone(String(remoteJid).split('@')[0] || body?.from || ''); const pushName = payload?.pushName || body?.pushName || body?.sender?.pushName || null; const fromMe = key?.fromMe === true || body?.fromMe === true; const event = String(body?.event || body?.type || '').trim() || null; return { event, remoteJid, number, pushName, fromMe, text: String(text || '').trim(), raw: body }; }
async function waPersistWebhook(body = {}) { const parsed = waParseIncomingWebhook(body); await WhatsAppWebhook.create({ event: parsed.event || null, remoteJid: parsed.remoteJid || null, number: parsed.number || null, pushName: parsed.pushName || null, fromMe: parsed.fromMe === true, text: parsed.text || null, payload: redact(body || null) }); if ((parsed.event === 'MESSAGES_UPSERT' || !parsed.event) && !parsed.fromMe && parsed.text) await Ticket.create({ protocolo: `WA-${Date.now()}`, nome: parsed.pushName || parsed.number || 'WhatsApp', email: null, tipo: 'WhatsApp', status: 'Novo', telefone: parsed.number || null, mensagem: parsed.text, origem: 'evolution_webhook', metadata: { remoteJid: parsed.remoteJid || null } }); return parsed; }
function buildDeliveryRatingMessage(order = {}) {
  const customerName = titleCaseCustomerName(extractOrderCustomerName(order)).split(" ")[0] || "Cliente";

  return `
Olá, ${customerName}! 👋

Seu pedido foi entregue com sucesso.

Como foi sua experiência com a Ariana Móveis?

⭐ 1
⭐⭐ 2
⭐⭐⭐ 3
⭐⭐⭐⭐ 4
⭐⭐⭐⭐⭐ 5

Sua opinião é muito importante para nós. 💙
`.trim();
}

async function scheduleDeliveryRating(orderId, order = {}, settings = null) {
  const rawStatus = String(order.statusLabel || order.status || "").toLowerCase();

  const isDelivered =
    rawStatus.includes("entregue") ||
    rawStatus.includes("delivered");

  if (!isDelivered) return { skipped: true, reason: "not_delivered" };

  const current = order.whatsappNotification || {};
  if (current.deliveryRatingSentAt || current.deliveryRatingDueAt) {
    return { skipped: true, reason: "already_scheduled_or_sent" };
  }

  const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await Order.findByIdAndUpdate(orderId, {
    $set: {
      "whatsappNotification.deliveryRatingDueAt": dueAt,
      "whatsappNotification.deliveryRatingStatus": "scheduled"
    }
  }).catch(() => null);

  return { ok: true, dueAt };
}

async function processPendingDeliveryRatings(limit = 20) {
  const settings = await getWhatsappSettings();
  if (!settings.enabled) return { skipped: true, reason: "whatsapp_disabled" };

  const orders = await Order.find({
    "whatsappNotification.deliveryRatingDueAt": { $lte: now() },
    "whatsappNotification.deliveryRatingSentAt": { $exists: false }
  }).sort({ "whatsappNotification.deliveryRatingDueAt": 1 }).limit(limit);

  const results = [];

  for (const order of orders) {
    const obj = toJSON(order);
    let number = extractOrderPhone(obj, settings.defaultCountryCode || "55");

    if (!number && obj?.userId) {
      try {
        const user = await User.findById(obj.userId);
        number = normalizePhone(user?.phone || user?.telefone || user?.whatsapp || "", settings.defaultCountryCode || "55");
      } catch (_error) {}
    }

    if (!number) {
      await Order.findByIdAndUpdate(obj._id || obj.id, {
        $set: {
          "whatsappNotification.deliveryRatingStatus": "error",
          "whatsappNotification.deliveryRatingError": "Telefone do cliente não encontrado"
        }
      }).catch(() => null);
      continue;
    }

    const text = buildDeliveryRatingMessage(obj);

    try {
      const sent = await waSendTextMessage({ number, text, settings });

      await Order.findByIdAndUpdate(obj._id || obj.id, {
        $set: {
          "whatsappNotification.deliveryRatingSentAt": now(),
          "whatsappNotification.deliveryRatingStatus": "sent",
          "whatsappNotification.deliveryRatingPhone": number,
          "whatsappNotification.deliveryRatingResponse": redact(sent.data || null)
        }
      }).catch(() => null);

      results.push({ ok: true, orderId: String(obj._id || obj.id), number });
    } catch (error) {
      await Order.findByIdAndUpdate(obj._id || obj.id, {
        $set: {
          "whatsappNotification.deliveryRatingStatus": "error",
          "whatsappNotification.deliveryRatingError": error.message || String(error)
        }
      }).catch(() => null);
    }
  }

  return { ok: true, processed: results.length, results };
}

async function waMaybeNotifyOrderStatusChange(orderId, before = {}, after = {}, origin = 'route') {
  const prevStatus = String(before?.status || '').trim();
  const nextStatus = String(after?.status || '').trim();
  const prevTracking = String(before?.trackingCode || before?.tracking_code || '').trim();
  const nextTracking = String(after?.trackingCode || after?.tracking_code || '').trim();
  const nextStatusLabel = String(after?.statusLabel || '').trim();

  console.log('[WHATSAPP STATUS CLIENTE] INICIO', {
    orderId,
    origin,
    beforeStatus: prevStatus,
    afterStatus: nextStatus,
    customerPhone: after?.customerPhone || '',
    shippingPhone: after?.shippingAddress?.phone || '',
    userId: after?.userId || ''
  });

  if (!nextStatus && !nextStatusLabel && !nextTracking) {
    return { skipped: true, reason: 'missing_status' };
  }

  if (
    prevStatus === nextStatus &&
    String(before?.statusLabel || '') === String(after?.statusLabel || '') &&
    prevTracking === nextTracking
  ) {
    return { skipped: true, reason: 'status_unchanged' };
  }

  const settings = await getWhatsappSettings();
  if (!settings.enabled) return { skipped: true, reason: 'integration_disabled' };
  if (!settings.autoNotifyOrderStatus) return { skipped: true, reason: 'auto_notify_disabled' };

  let number = extractOrderPhone(after, settings.defaultCountryCode || '55');

  if (!number && after?.userId) {
    try {
      const user = await User.findById(after.userId);
      number = normalizePhone(user?.phone || user?.telefone || user?.whatsapp || '', settings.defaultCountryCode || '55');
    } catch (_error) {}
  }

  if (!number) {
    await Order.findByIdAndUpdate(orderId, {
      $set: {
        whatsappNotification: {
          ...(after.whatsappNotification || {}),
          lastAttemptAt: now(),
          lastStatusNotified: null,
          lastError: 'Telefone do cliente não encontrado.',
          origin
        }
      }
    }).catch(() => null);

    console.log('[WHATSAPP STATUS CLIENTE] PULOU', { orderId, reason: 'missing_phone' });
    return { skipped: true, reason: 'missing_phone' };
  }

  const text = buildOrderStatusMessage(orderId, after, settings);

  // Chave simples e forte: evita duplicidade mesmo quando duas rotas disparam a mesma atualização.
  // Não depende do texto completo, nem da origem, para não falhar quando uma rota muda pequenos detalhes.
  const statusForKey = String(nextStatus || nextStatusLabel || 'status').trim().toLowerCase();
  const labelForKey = String(nextStatusLabel || '').trim().toLowerCase();
  const trackingForKey = String(nextTracking || '').trim().toLowerCase();
  const customerNotificationKey = `${String(orderId)}|${number}|${statusForKey}|${labelForKey}|${trackingForKey}`;

  // Se essa mesma atualização já foi enviada recentemente, não envia de novo.
  const currentOrder = await Order.findById(orderId).lean().catch(() => null);
  const currentWa = currentOrder?.whatsappNotification || {};
  if (
    currentWa.customerLastNotificationKey === customerNotificationKey ||
    currentWa.lastNotificationKey === customerNotificationKey ||
    currentWa.sendingKey === customerNotificationKey ||
    currentWa.customerSendingKey === customerNotificationKey
  ) {
    console.log('[WHATSAPP STATUS CLIENTE] DUPLICADO IGNORADO POR HISTORICO', {
      orderId,
      number,
      origin,
      customerNotificationKey
    });
    return { skipped: true, reason: 'duplicate_notification', number, customerNotificationKey };
  }

  // Trava atômica no MongoDB: só uma chamada consegue marcar esta chave como "em envio".
  const lockDoc = await Order.findOneAndUpdate(
    {
      _id: orderId,
      $and: [
        { $or: [
          { 'whatsappNotification.customerLastNotificationKey': { $ne: customerNotificationKey } },
          { 'whatsappNotification.customerLastNotificationKey': { $exists: false } }
        ] },
        { $or: [
          { 'whatsappNotification.customerSendingKey': { $ne: customerNotificationKey } },
          { 'whatsappNotification.customerSendingKey': { $exists: false } }
        ] }
      ]
    },
    {
      $set: {
        'whatsappNotification.customerSendingKey': customerNotificationKey,
        'whatsappNotification.lastAttemptAt': now(),
        'whatsappNotification.lastPhone': number,
        'whatsappNotification.origin': origin
      }
    },
    { new: true }
  ).catch(() => null);

  if (!lockDoc) {
    console.log('[WHATSAPP STATUS CLIENTE] DUPLICADO IGNORADO POR LOCK', {
      orderId,
      number,
      origin,
      customerNotificationKey
    });
    return { skipped: true, reason: 'duplicate_notification', number, customerNotificationKey };
  }

  try {
    const sent = await waSendTextMessage({ number, text, settings });

    await Order.findByIdAndUpdate(orderId, {
      $set: {
        'whatsappNotification.lastAttemptAt': now(),
        'whatsappNotification.lastSentAt': now(),
        'whatsappNotification.lastStatusNotified': nextStatus,
        'whatsappNotification.lastTrackingNotified': nextTracking,
        'whatsappNotification.customerLastNotificationKey': customerNotificationKey,
        'whatsappNotification.lastNotificationKey': customerNotificationKey,
        'whatsappNotification.lastMessage': text,
        'whatsappNotification.lastPhone': number,
        'whatsappNotification.lastError': null,
        'whatsappNotification.lastResponse': redact(sent.data || null),
        'whatsappNotification.origin': origin
      },
      $unset: {
        'whatsappNotification.customerSendingKey': '',
        'whatsappNotification.sendingKey': ''
      }
    }).catch(() => null);

    await writeAuditLog({
      scope: 'whatsapp_evolution',
      eventType: 'order_status_whatsapp_sent',
      orderId: String(orderId),
      status: 'success',
      request: { number, text, origin, customerNotificationKey },
      response: sent.data || null,
      metadata: { instanceName: settings.instanceName, apiUrl: settings.apiUrl }
    }).catch(() => null);

    await scheduleDeliveryRating(orderId, after, settings).catch((error) => {
      console.error('[WHATSAPP AVALIACAO ENTREGA] ERRO AO AGENDAR', error.message || error);
    });

    console.log('[WHATSAPP STATUS CLIENTE] ENVIADO', { orderId, number, status: sent.status, customerNotificationKey });
    return { ok: true, number, text, sent, customerNotificationKey };
  } catch (error) {
    await Order.findByIdAndUpdate(orderId, {
      $set: {
        'whatsappNotification.lastAttemptAt': now(),
        'whatsappNotification.lastStatusNotified': null,
        'whatsappNotification.lastError': error.message || String(error),
        'whatsappNotification.origin': origin
      },
      $unset: {
        'whatsappNotification.customerSendingKey': '',
        'whatsappNotification.sendingKey': ''
      }
    }).catch(() => null);

    await writeAuditLog({
      scope: 'whatsapp_evolution',
      eventType: 'order_status_whatsapp_error',
      orderId: String(orderId),
      status: 'error',
      request: { number, text, origin, customerNotificationKey },
      response: { error: error.message || String(error) },
      metadata: { instanceName: settings.instanceName, apiUrl: settings.apiUrl }
    }).catch(() => null);

    console.error('[WHATSAPP STATUS CLIENTE] ERRO', { orderId, number, error: error.message || String(error) });
    return { ok: false, number, error: error.message || String(error) };
  }
}

async function waNotifyOrderChatMessage(orderId, order = {}, message = {}, origin = 'route') { const settings = await getWhatsappSettings(); if (!settings.enabled) return { skipped: true, reason: 'integration_disabled' }; if (!settings.chatNotifyEnabled) return { skipped: true, reason: 'chat_notify_disabled' }; const senderType = String(message.senderType || '').trim() || 'customer'; const defaultCountryCode = settings.defaultCountryCode || '55'; const targets = new Set(); if (senderType === 'customer') { const sellerPhone = extractSellerPhone(order, defaultCountryCode); if (sellerPhone) targets.add(sellerPhone); for (const n of parseAdminNotifyNumbers(settings)) targets.add(n); } else { const customerPhone = extractOrderPhone(order, defaultCountryCode); if (customerPhone) targets.add(customerPhone); } const numbers = Array.from(targets).filter(Boolean); if (!numbers.length) return { skipped: true, reason: 'missing_target_phone' }; const text = buildOrderChatMessage(orderId, order, message); const results = []; for (const number of numbers) { const sent = await waSendTextMessage({ number, text, settings }); results.push({ number, status: sent.status, data: sent.data || null }); } await Order.findByIdAndUpdate(orderId, { $set: { chatMeta: { ...(order.chatMeta || {}), lastWhatsappNotifyAt: now(), lastWhatsappNotifyTargets: numbers, lastWhatsappNotifyMessage: text, lastWhatsappNotifyOrigin: origin } } }); await writeAuditLog({ scope: 'whatsapp_evolution', eventType: 'order_chat_whatsapp_sent', orderId: String(orderId), status: 'success', request: { origin, senderType, numbers, text }, response: results, metadata: { instanceName: settings.instanceName, apiUrl: settings.apiUrl } }); return { ok: true, numbers, text, results }; }

async function getManufacturerIntegration(manufacturer) { return ManufacturerIntegration.findOne({ manufacturer: String(manufacturer || '').trim() }); }
function computeNextAttempt(attempts) { const backoff = Math.pow(2, Math.max(0, attempts - 1)) * DISPATCH_RETRY_BASE_MS; return new Date(Date.now() + backoff); }
async function dispatchOrderToManufacturer(orderPayload = {}) { const manufacturer = String(orderPayload.manufacturer || orderPayload.fabricante || orderPayload.sellerIds?.[0] || orderPayload.sellerId || '').trim(); if (!manufacturer) throw new Error('Fabricante não informado no pedido.'); const integration = await getManufacturerIntegration(manufacturer); if (!integration || !integration.enabled) throw new Error(`Integração do fabricante ${manufacturer} não configurada ou desativada.`); const endpoint = String(integration.endpoint || '').trim(); if (!endpoint) throw new Error(`Endpoint do fabricante ${manufacturer} não configurado.`); const method = String(integration.method || 'POST').toUpperCase(); const sendAs = String(integration.sendAs || 'json').toLowerCase(); const headers = { ...(integration.headers || {}) }; if (integration.apiKey) headers.apikey = integration.apiKey; if (integration.authToken) headers.Authorization = `Bearer ${integration.authToken}`; let response; if (sendAs === 'form') { const body = new URLSearchParams(); Object.entries(orderPayload || {}).forEach(([k, v]) => { if (v === undefined || v === null) return; body.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v)); }); response = await axios({ url: endpoint, method, headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, data: body.toString(), timeout: Number(integration.timeoutMs || 30000), validateStatus: () => true }); } else { response = await axios({ url: endpoint, method, headers: { 'Content-Type': 'application/json', ...headers }, data: orderPayload, timeout: Number(integration.timeoutMs || 30000), validateStatus: () => true }); } const ok = response.status >= 200 && response.status < 300; await writeAuditLog({ scope: 'manufacturer_integration', eventType: 'manufacturer_dispatch_http', orderId: String(orderPayload._id || orderPayload.id || orderPayload.orderId || ''), manufacturer, status: ok ? 'success' : 'error', statusCode: response.status, request: orderPayload, response: response.data, metadata: { endpoint, method, sendAs } }); return { ok, manufacturer, endpoint, status: response.status, data: response.data, sentContentType: sendAs === 'form' ? 'application/x-www-form-urlencoded' : 'application/json' }; }
async function enqueueManufacturerDispatch(orderDoc) { const order = toJSON(orderDoc); const manufacturer = String(order.manufacturer || order.sellerIds?.[0] || '').trim(); if (!manufacturer) return { skipped: true, reason: 'missing_manufacturer' }; const queueId = uid('mq'); const payload = { orderId: String(order._id || order.id), id: String(order._id || order.id), manufacturer, customerName: order.customerName, customerPhone: order.customerPhone, customerEmail: order.customerEmail, shippingAddress: order.shippingAddress, items: order.items, total: order.total, notes: order.notes }; const queueRow = await ManufacturerDispatchQueue.create({ queueId, orderId: String(order._id || order.id), manufacturer, payload, status: 'pending', attempts: 0, maxAttempts: MAX_DISPATCH_ATTEMPTS, nextAttemptAt: now() }); await Order.findByIdAndUpdate(order._id || order.id, { $set: { manufacturer, manufacturerDispatch: { queueId, status: 'pending', attempts: 0, updatedAt: now() }, status_integracao: 'fila_pendente_fabricante' } }); await writeAuditLog({ scope: 'manufacturer_queue', eventType: 'manufacturer_dispatch_enqueued', orderId: String(order._id || order.id), manufacturer, queueId, status: 'queued', request: payload }); return { ok: true, queueId: queueRow.queueId }; }
async function processSingleQueueItem(queueRow) { const row = typeof queueRow.toObject === 'function' ? queueRow : await ManufacturerDispatchQueue.findOne({ queueId: queueRow.queueId }); if (!row) return { ok: false, error: 'Queue item não encontrado' }; row.status = row.attempts > 0 ? 'retry_processing' : 'processing'; row.lastAttemptAt = now(); await row.save(); try { const result = await dispatchOrderToManufacturer(row.payload || {}); row.attempts = Number(row.attempts || 0) + 1; row.lastResponse = redact(result.data || null); if (result.ok) { row.status = 'sent'; row.deadLetter = false; row.nextAttemptAt = null; await row.save(); await Order.findByIdAndUpdate(row.orderId, { $set: { status_integracao: 'enviado', manufacturerDispatch: { queueId: row.queueId, status: 'sent', attempts: row.attempts, endpoint: result.endpoint, httpStatus: result.status, response: redact(result.data || null), updatedAt: now() } } }); await resolveOperationalAlert('dispatch_dead_letter', row.queueId); await resolveOperationalAlert('dispatch_retry_pressure', row.queueId); await resolveOperationalAlert('order_dispatch_error', row.orderId); return { ok: true, result }; } row.lastError = `HTTP ${result.status}`; if (row.attempts >= Number(row.maxAttempts || MAX_DISPATCH_ATTEMPTS)) { row.status = 'dead_letter'; row.deadLetter = true; row.nextAttemptAt = null; } else { row.status = 'retrying'; row.nextAttemptAt = computeNextAttempt(row.attempts); } await row.save(); await Order.findByIdAndUpdate(row.orderId, { $set: { status_integracao: row.status === 'dead_letter' ? 'fila_erro_fabricante' : 'retry_fabricante', manufacturerDispatch: { queueId: row.queueId, status: row.status === 'dead_letter' ? 'error' : row.status, attempts: row.attempts, endpoint: result.endpoint, httpStatus: result.status, response: redact(result.data || null), updatedAt: now(), lastError: row.lastError } } }); return { ok: false, result }; } catch (error) { row.attempts = Number(row.attempts || 0) + 1; row.lastError = error.message; if (row.attempts >= Number(row.maxAttempts || MAX_DISPATCH_ATTEMPTS)) { row.status = 'dead_letter'; row.deadLetter = true; row.nextAttemptAt = null; } else { row.status = 'retrying'; row.nextAttemptAt = computeNextAttempt(row.attempts); } await row.save(); await writeAuditLog({ scope: 'manufacturer_queue', eventType: 'manufacturer_dispatch_processing_error', orderId: row.orderId, manufacturer: row.manufacturer, queueId: row.queueId, status: 'error', message: error.message, request: row.payload || null }); await Order.findByIdAndUpdate(row.orderId, { $set: { status_integracao: row.status === 'dead_letter' ? 'fila_erro_fabricante' : 'retry_fabricante', manufacturerDispatch: { queueId: row.queueId, status: row.status === 'dead_letter' ? 'error' : row.status, attempts: row.attempts, updatedAt: now(), lastError: error.message } } }); return { ok: false, error: error.message }; } }
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
function isRodocapCityAllowed(city = '', rodocapRule = {}) { const normalizedCity = normalizeShippingText(city); if (!normalizedCity) return false; const allowed = Array.isArray(rodocapRule.allowedCities) ? rodocapRule.allowedCities : []; return allowed.map(normalizeShippingText).includes(normalizedCity); }

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

  // Rodocap só entra depois de 70 km quando o produto ultrapassa limite dos Correios.
  // Produto até 30kg e até 100cm deve dar preferência para Correios, mesmo se Rodocap for mais barato.
  if (usesArianaLogistics && !hasPhoneFlatDelivery && rodocapEnabled && !hasArianaFree && !hasArianaDistanceDelivery && distanceKm > rodocapMinKmExclusive && exceedsCorreiosLimit) {
    rodocapEligibleByDistance = true;
    const allowedCity = isRodocapCityAllowed(location.city, rodocapRule);
    rodocapCityAllowed = allowedCity;
    if (allowedCity) {
      const rodocapPrice = Number((productPrice * Number(rodocapRule.percentOfInvoice || 0.12)).toFixed(2));
      rodocapAvailable = true;
      options.push(buildManualShippingOption({
        service: 'rodocap_12_percent',
        label: rodocapRule.label || 'Rodocap',
        price: rodocapPrice,
        prazo: rodocapRule.prazoPadrao || 'sob consulta',
        provider: 'configured',
        details: `Rodocap acima de ${rodocapMinKmExclusive} km: 12% do valor da nota para cidades atendidas.`,
        metadata: { rule: 'rodocap_12_percent', distanceKm, destinationCity: location.city, destinationState: location.state, locationSource: location.source },
        deadlineDays: parsePrazoToDeadlineDays(rodocapRule.prazoPadrao || '')
      }));
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
  const correiosAllowed = !hasPhoneFlatDelivery && !hasArianaFree && correios.enabled && weightKg > 0 && weightKg <= Number(correios.maxWeightKg || 30) && maxDimensionCm > 0 && maxDimensionCm <= Number(correios.maxDimensionCm || 100);
  if (correiosAllowed) {
    try {
      const quoted = await quoteCorreios(body, settings);
      if (Array.isArray(quoted.quotes)) {
        options.push(...quoted.quotes
          .map(q => ({
            service: q.service,
            label: q.label || q.name || 'Correios',
            price: Number(q.price),
            prazo: q.prazo || (q.deadlineDays ? `${q.deadlineDays} dia(s) úteis` : 'sob consulta'),
            deadlineDays: q.deadlineDays || parsePrazoToDeadlineDays(q.prazo || ''),
            provider: 'correios',
            raw: q.raw || null
          }))
          .filter(q => Number.isFinite(q.price) && q.price > 0));
      }
    } catch (error) {
      options.push({ service: 'correios_error', label: 'Correios', unavailable: true, error: error.message });
    }
  } else if (!hasPhoneFlatDelivery && !hasArianaFree) {
    options.push({ service: 'correios_unavailable_limits', label: 'Correios', unavailable: true, provider: 'correios', error: `Correios disponíveis somente até ${Number(correios.maxWeightKg || 30)}kg e até ${Number(correios.maxDimensionCm || 100)}cm no maior lado.`, metadata: { weightKg, maxDimensionCm } });
  }

  const totalExpress = settings.carriers?.totalExpress || {};
  if (!hasPhoneFlatDelivery && !hasArianaFree && totalExpress.enabled && weightKg > 0 && weightKg <= Number(totalExpress.maxWeightKg || 30) && maxDimensionCm > 0 && maxDimensionCm <= Number(totalExpress.maxDimensionCm || 110)) {
    const base = Number(settings.totalExpressBasePrice || 0);
    if (base > 0) options.push(buildManualShippingOption({ service: 'total_express', label: 'Total Express', price: base, prazo: settings.totalExpressPrazo || 'sob consulta', provider: 'configured' }));
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

    // 4) Frenet: fallback quando Correios/Rodocap não atenderem
    if (txt.includes('frenet')) return 4;

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
    const pagarmeRecipientId = String(meta.pagarmeRecipientId || meta.pagarme_recipient_id || seller?.pagarmeRecipientId || '').trim();
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
  const amount = moneyToCents(body.amount || body.total || order?.total || 0);
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
  const amount = moneyToCents(body.amount || body.total || order?.total || 0);
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
  const amount = moneyToCents(body.amount || body.total || order?.total || 0);
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
  const amount = moneyToCents(body.amount || body.total || order?.total || 0);
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



app.get('/', (_req, res) => res.json({ ok: true, service: 'Ariana Móveis Enterprise Mongo API', buildId: BUILD_ID }));
app.get('/health', (_req, res) => res.json({ ok: true, mongo: mongoose.connection.readyState === 1 ? 'connected' : `state_${mongoose.connection.readyState}`, buildId: BUILD_ID, uptime: process.uptime(), time: new Date().toISOString() }));

function isEmailConfigured() {
  return Boolean(EMAIL_HOST && EMAIL_USER && EMAIL_PASS);
}

function getMailTransporter() {
  if (!isEmailConfigured()) return null;
  return nodemailer.createTransport({
    host: EMAIL_HOST,
    port: EMAIL_PORT,
    secure: EMAIL_SECURE,
    auth: { user: EMAIL_USER, pass: EMAIL_PASS }
  });
}

function buildResetPasswordUrl(token = '') {
  const base = RESET_PASSWORD_URL || `${FRONTEND_URL}/redefinir_senha.html`;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}token=${encodeURIComponent(token)}`;
}

async function sendPasswordResetEmail(user, resetUrl) {
  const transporter = getMailTransporter();
  const name = String(user?.name || user?.email || 'cliente').trim();

  const subject = 'Redefinição de senha - Ariana Móveis';
  const text = `Olá, ${name}!\n\nRecebemos uma solicitação para redefinir sua senha na Ariana Móveis.\n\nAcesse o link abaixo para criar uma nova senha. O link expira em 1 hora:\n${resetUrl}\n\nSe você não solicitou essa alteração, ignore este e-mail.`;
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
      <h2 style="color:#2E6DA4">Redefinição de senha</h2>
      <p>Olá, <strong>${name}</strong>!</p>
      <p>Recebemos uma solicitação para redefinir sua senha na Ariana Móveis.</p>
      <p>O link abaixo expira em <strong>1 hora</strong>:</p>
      <p><a href="${resetUrl}" style="display:inline-block;background:#2E6DA4;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Criar nova senha</a></p>
      <p>Se o botão não funcionar, copie e cole este link no navegador:</p>
      <p style="word-break:break-all;color:#374151">${resetUrl}</p>
      <p style="font-size:12px;color:#6b7280">Se você não solicitou essa alteração, ignore este e-mail.</p>
    </div>`;

  if (!transporter) {
    console.warn('[auth/forgot-password] SMTP não configurado. Link de redefinição:', resetUrl);
    return { ok: false, skipped: true, reason: 'email_not_configured' };
  }

  await transporter.sendMail({
    from: EMAIL_FROM,
    to: user.email,
    subject,
    text,
    html
  });
  return { ok: true };
}

function normalizePublicUserForAuth(user) {
  const obj = toJSON(user) || {};
  delete obj.passwordHash;
  delete obj.resetPasswordTokenHash;
  delete obj.resetPasswordExpiresAt;
  return obj;
}

app.get('/api/auth/google-config', (_req, res) => {
  return res.json({ ok: true, enabled: Boolean(GOOGLE_CLIENT_ID), clientId: GOOGLE_CLIENT_ID || '' });
});

app.post('/api/auth/google-login', async (req, res) => {
  try {
    if (!GOOGLE_CLIENT_ID || !googleClient) {
      return res.status(500).json({ ok: false, error: 'Login com Google não configurado no servidor.' });
    }

    const idToken = String(req.body?.credential || req.body?.idToken || req.body?.token || '').trim();
    if (!idToken) return res.status(400).json({ ok: false, error: 'Token do Google ausente.' });

    const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload() || {};
    const email = String(payload.email || '').trim().toLowerCase();
    const googleId = String(payload.sub || '').trim();
    const name = String(payload.name || payload.given_name || (email ? email.split('@')[0] : 'Cliente')).trim();

    if (!email || !googleId) return res.status(401).json({ ok: false, error: 'Conta Google inválida.' });

    let user = await User.findOne({ $or: [{ email }, { googleId }] });
    if (!user) {
      user = await User.create({
        name,
        email,
        googleId,
        emailVerified: payload.email_verified === true,
        authProvider: 'google',
        role: 'customer',
        isActive: true
      });
    } else {
      let changed = false;
      if (!user.googleId) { user.googleId = googleId; changed = true; }
      if (!user.name && name) { user.name = name; changed = true; }
      if (payload.email_verified === true && user.emailVerified !== true) { user.emailVerified = true; changed = true; }
      if (user.authProvider !== 'google') { user.authProvider = user.passwordHash ? 'password_google' : 'google'; changed = true; }
      if (changed) await user.save();
    }

    if (user.isActive === false) return res.status(403).json({ ok: false, error: 'Usuário desativado.' });

    const token = signToken(user);
    return res.json({ ok: true, token, user: normalizePublicUserForAuth(user) });
  } catch (error) {
    console.error('Erro em /api/auth/google-login:', error);
    return res.status(401).json({ ok: false, error: 'Não foi possível validar o login com Google.' });
  }
});

app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ ok: false, error: 'Informe o e-mail cadastrado.' });

    const user = await User.findOne({ email });

    // Resposta neutra para não revelar se o e-mail existe ou não.
    const neutralResponse = {
      ok: true,
      message: 'Se este e-mail estiver cadastrado, enviaremos um link para redefinir a senha.'
    };

    if (!user) return res.json(neutralResponse);

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await User.updateOne(
  { _id: user._id },
  {
    $set: {
      resetPasswordTokenHash: tokenHash,
      resetPasswordExpiresAt: new Date(Date.now() + 60 * 60 * 1000)
    }
  }
);

    const resetUrl = buildResetPasswordUrl(token);
    const emailResult = await sendPasswordResetEmail(user, resetUrl);

    await writeAuditLog({
      scope: 'auth',
      eventType: 'password_reset_requested',
      status: 'success',
      metadata: { userId: String(user._id), emailConfigured: isEmailConfigured(), emailSent: emailResult?.ok === true }
    }).catch(() => null);

    return res.json({
      ...neutralResponse,
      emailSent: emailResult?.ok === true,
      emailConfigured: isEmailConfigured(),
      debugResetUrl: String(process.env.ALLOW_DEBUG_RESET_LINK || '').toLowerCase() === 'true' ? resetUrl : undefined
    });
  } catch (error) {
    console.error('Erro em /api/auth/forgot-password:', error);
    return res.status(500).json({ ok: false, error: 'Erro ao solicitar recuperação de senha.' });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    const password = String(req.body?.password || req.body?.newPassword || '');

    if (!token) return res.status(400).json({ ok: false, error: 'Token de redefinição ausente.' });
    if (!password || password.length < 6) return res.status(400).json({ ok: false, error: 'A nova senha deve ter no mínimo 6 caracteres.' });

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({
      resetPasswordTokenHash: tokenHash,
      resetPasswordExpiresAt: { $gt: new Date() }
    });

    if (!user) return res.status(400).json({ ok: false, error: 'Link inválido ou expirado. Solicite uma nova recuperação de senha.' });

   await User.updateOne(
  { _id: user._id },
  {
    $set: {
      passwordHash: await bcrypt.hash(password, 10),
      authProvider: user.googleId ? 'password_google' : 'password'
    },
    $unset: {
      resetPasswordTokenHash: '',
      resetPasswordExpiresAt: ''
    }
  }
);

    await writeAuditLog({
      scope: 'auth',
      eventType: 'password_reset_completed',
      status: 'success',
      metadata: { userId: String(user._id) }
    }).catch(() => null);

    return res.json({ ok: true, message: 'Senha redefinida com sucesso.' });
  } catch (error) {
    console.error('Erro em /api/auth/reset-password:', error);
    return res.status(500).json({ ok: false, error: 'Erro ao redefinir senha.' });
  }
});

app.post('/api/auth/change-password', authRequired, async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || req.body?.current_password || '');
    const newPassword = String(req.body?.newPassword || req.body?.password || '');

    if (!newPassword || newPassword.length < 6) return res.status(400).json({ ok: false, error: 'A nova senha deve ter no mínimo 6 caracteres.' });

    const storedHash = String(req.user.passwordHash || '');
    if (storedHash) {
      const valid = await bcrypt.compare(currentPassword, storedHash).catch(() => false);
      if (!valid) return res.status(401).json({ ok: false, error: 'Senha atual inválida.' });
    }

    req.user.passwordHash = await bcrypt.hash(newPassword, 10);
    if (!req.user.authProvider || req.user.authProvider === 'google') req.user.authProvider = req.user.googleId ? 'password_google' : 'password';
    await req.user.save();
    return res.json({ ok: true, message: 'Senha atualizada com sucesso.' });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'Erro ao atualizar senha.' });
  }
});

app.post('/api/auth/register', async (req, res) => { try { const body = req.body || {}; const email = String(body.email || '').trim().toLowerCase(); const password = String(body.password || ''); const name = String(body.name || '').trim(); if (!email || !password || !name) return res.status(400).json({ ok: false, error: 'Nome, e-mail e senha são obrigatórios' }); const existing = await User.findOne({ email }); if (existing) return res.status(409).json({ ok: false, error: 'E-mail já cadastrado' }); const passwordHash = await bcrypt.hash(password, 10); const user = await User.create({ name, email, passwordHash, cpf: body.cpf || '', phone: body.phone || '', role: body.role === 'seller' ? 'seller' : 'customer', city: body.city || '', uf: body.uf || '' }); if (user.role === 'seller') { const sellerId = uid('seller'); await Seller.create({ sellerId, userId: user._id, displayName: name, storeName: body.storeName || name, email, phone: body.phone || '', document: body.cpf || '', status: 'pending' }); user.sellerId = sellerId; await user.save(); } const token = signToken(user); return res.json({ ok: true, token, user: toJSON(user) }); } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Erro ao registrar usuário' }); } });
app.post('/api/auth/login', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'E-mail e senha são obrigatórios' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ ok: false, error: 'Credenciais inválidas' });
    }

    const storedHash = String(user.passwordHash || '');
    let valid = false;

    if (storedHash) {
      try {
        valid = await bcrypt.compare(password, storedHash);
      } catch (_bcryptErr) {
        valid = false;
      }

      if (!valid && storedHash === password) {
        valid = true;
        user.passwordHash = await bcrypt.hash(password, 10);
        await user.save();
      }
    }

    if (!valid) {
      return res.status(401).json({ ok: false, error: 'Credenciais inválidas' });
    }

    const token = signToken(user);
    return res.json({ ok: true, token, user: toJSON(user) });
  } catch (error) {
    console.error('Erro em /api/auth/login:', error);
    return res.status(500).json({ ok: false, error: 'Erro ao fazer login' });
  }
});
app.get('/api/me', authRequired, (req, res) => res.json({ ok: true, user: toJSON(req.user) }));
app.patch('/api/users/me', authRequired, async (req, res) => { try { const allowed = ['name', 'cpf', 'phone', 'city', 'uf']; const patch = {}; for (const key of allowed) if (req.body[key] !== undefined) patch[key] = req.body[key]; const before = toJSON(req.user); const after = await User.findByIdAndUpdate(req.user._id, { $set: patch }, { new: true }); await writeAuditLog({ scope: 'user_profile', eventType: 'user_profile_updated', status: 'success', changedKeys: changedKeys(before, toJSON(after)), metadata: { userId: String(req.user._id) } }); return res.json({ ok: true, user: toJSON(after) }); } catch (_error) { return res.status(500).json({ ok: false, error: 'Erro ao atualizar perfil' }); } });
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

app.post('/api/seller/partner-request', async (req, res) => {
  try {
    const body = req.body || {};
    const sellerId = uid('seller');
    const seller = await Seller.create({
      sellerId,
      displayName: body.name || body.displayName || body.ownerName || '',
      storeName: body.storeName || body.factoryName || body.razaoSocial || body.legalName || body.shopName || body.name || '',
      email: body.email || body.contactEmail || '',
      phone: body.phone || body.whatsapp || '',
      document: body.document || body.cnpj || body.cpf || body.cpfCnpj || body.cpf_cnpj || '',
      status: 'pending',
      onboardingCompleted: false,
      metadata: body
    });

    const notification = await notifyNewPartnerRequest(seller).catch((error) => ({ ok: false, error: error.message || String(error) }));

    return res.json({ ok: true, id: seller.sellerId, sellerId: seller.sellerId, seller: normalizePartnerRequestForResponse(seller), notification });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao criar solicitação de parceiro' });
  }
});

app.post('/api/seller/products', sellerAuthRequired, async (req, res) => {
  try {
    const payload = productPayloadFromBody(req.body);

    payload.sellerId = String(req.sellerId || '').trim();
    payload.sellerName = req.seller?.storeName || req.seller?.displayName || req.user?.name || 'Seller';
    payload.active = true;

    if (!payload.sellerId) {
      return res.status(400).json({ ok: false, error: 'Seller não identificado' });
    }

    if (!payload.name || !payload.price) {
      return res.status(400).json({ ok: false, error: 'Nome e preço são obrigatórios' });
    }

    const created = await Product.create(payload);

    return res.status(201).json({
      ok: true,
      product: normalizeProductForResponse(created)
    });
  } catch (error) {
    console.error('Erro ao criar produto seller:', error);
    return res.status(500).json({
      ok: false,
      error: error.message || 'Erro ao publicar produto'
    });
  }
});

app.get('/api/seller/partner-requests', adminRequired, async (req, res) => {
  try {
    const status = String(req.query.status || '').trim().toLowerCase();
    const q = String(req.query.q || '').trim();
    const limit = Math.min(Number(req.query.limit || 500), 1000);
    const filter = {};
    if (status && status !== 'todos' && status !== 'all') filter.status = normalizePartnerRequestStatus(status);
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      filter.$or = [
        { storeName: rx }, { displayName: rx }, { email: rx }, { phone: rx }, { document: rx },
        { 'metadata.storeName': rx }, { 'metadata.factoryName': rx }, { 'metadata.ownerName': rx }, { 'metadata.cnpj': rx }
      ];
    }
    const rows = await Seller.find(filter).sort({ createdAt: -1 }).limit(limit);
    const requests = rows.map(normalizePartnerRequestForResponse);
    return res.json({ ok: true, requests, items: requests, total: requests.length });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar solicitações de seller' });
  }
});

app.patch('/api/seller/partner-requests/:id/status', adminRequired, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const status = normalizePartnerRequestStatus(req.body?.status || req.body?.newStatus || 'pending');
    const active = status === 'approved';
    const filter = mongoose.Types.ObjectId.isValid(id) ? { $or: [{ _id: id }, { sellerId: id }] } : { sellerId: id };

    let seller = await Seller.findOneAndUpdate(filter, {
      $set: {
        status,
        onboardingCompleted: active ? true : false,
        'metadata.status': partnerRequestPublicStatus(status),
        'metadata.active': active,
        'metadata.reviewedAt': now(),
        'metadata.reviewedBy': req.admin?.email || req.user?.email || 'admin'
      }
    }, { new: true });

    if (!seller) return res.status(404).json({ ok: false, error: 'Solicitação não encontrada' });

    // Configurações comerciais definidas pelo admin na aprovação.
    // Isso permite tratar sellers grandes (fabricante/distribuidor/loja) com regras próprias
    // de comissão, logística, frete e uso de etiqueta Ariana.
    const marketplaceSet = {};
    const bodyCommission = req.body?.commissionPercent ?? req.body?.marketplaceCommissionPercent;
    if (bodyCommission !== undefined && bodyCommission !== null && String(bodyCommission).trim() !== '') {
      const commissionPercent = Number(String(bodyCommission).replace(',', '.'));
      if (Number.isFinite(commissionPercent) && commissionPercent >= 0 && commissionPercent <= 50) {
        marketplaceSet['metadata.commissionPercent'] = commissionPercent;
        marketplaceSet['metadata.marketplaceCommissionPercent'] = commissionPercent;
        marketplaceSet['metadata.commissionUpdatedAt'] = now();
        marketplaceSet['metadata.commissionUpdatedBy'] = req.admin?.email || req.user?.email || 'admin';
      }
    }

    const logisticsOwner = String(req.body?.logisticsOwner || req.body?.marketplaceLogisticsOwner || '').trim();
    const shippingOwner = String(req.body?.shippingOwner || req.body?.marketplaceShippingOwner || '').trim();
    const labelOwner = String(req.body?.labelOwner || req.body?.marketplaceLabelOwner || '').trim();
    const useArianaLabel = req.body?.useArianaLabel ?? req.body?.usesArianaLabel;
    const transferDeadlineDays = req.body?.transferDeadlineDays;

    if (logisticsOwner) marketplaceSet['metadata.marketplaceLogisticsOwner'] = logisticsOwner;
    if (shippingOwner) marketplaceSet['metadata.marketplaceShippingOwner'] = shippingOwner;
    if (labelOwner) marketplaceSet['metadata.marketplaceLabelOwner'] = labelOwner;
    if (useArianaLabel !== undefined) marketplaceSet['metadata.usesArianaLabel'] = useArianaLabel === true || String(useArianaLabel).toLowerCase() === 'true';
    if (transferDeadlineDays !== undefined && transferDeadlineDays !== null && String(transferDeadlineDays).trim() !== '') {
      const days = Number(String(transferDeadlineDays).replace(',', '.'));
      if (Number.isFinite(days) && days >= 0) marketplaceSet['metadata.transferDeadlineDays'] = days;
    }

    if (Object.keys(marketplaceSet).length) {
      seller = await Seller.findByIdAndUpdate(seller._id, { $set: marketplaceSet }, { new: true });
    }

    let recipient = null;
    let recipientError = null;

    // Permite informar manualmente o Recipient ID já existente no Pagar.me.
    // Use isso quando o seller já possui recipient criado e você só quer vincular no Mongo ao aprovar.
    const manualRecipientId = String(
      req.body?.recipientId ||
      req.body?.pagarmeRecipientId ||
      req.body?.pagarme_recipient_id ||
      ''
    ).trim();

    if (active && manualRecipientId) {
      const meta = { ...(seller.metadata || {}) };
      meta.paymentGateway = 'pagarme';
      meta.marketplaceSplitRequired = true;
      meta.manualTransferEnabled = false;
      meta.pagarmeRecipientId = manualRecipientId;
      meta.recipientId = manualRecipientId;
      meta.pagarmeRecipientStatus = String(req.body?.recipientStatus || req.body?.pagarmeRecipientStatus || 'manual').trim();
      meta.pagarmeRecipientManual = true;
      meta.pagarmeRecipientManualAt = new Date().toISOString();
      meta.pagarmeRecipientManualBy = req.admin?.email || req.user?.email || 'admin';
      meta.pagarmeRecipientError = '';
      meta.pagarmeRecipientRequiredFields = [];

      seller = await Seller.findByIdAndUpdate(seller._id, { $set: { metadata: meta } }, { new: true });
      recipient = { id: manualRecipientId, status: meta.pagarmeRecipientStatus, manual: true };

      await writeAuditLog({
        scope: 'payments',
        eventType: 'pagarme_recipient_manual_on_approval',
        status: 'success',
        metadata: { sellerId: seller.sellerId || String(seller._id), recipientId: manualRecipientId, admin: req.admin?.email || '' }
      });
    }

    // Ao aprovar o seller sem Recipient manual, tenta criar automaticamente o Recipient no Pagar.me.
    // Se já existir recipient salvo no Mongo, não duplica.
    if (active && !manualRecipientId && !String(seller.metadata?.pagarmeRecipientId || seller.metadata?.recipientId || '').trim()) {
      try {
        const payload = buildPagarmeRecipientPayloadFromSeller(seller, req.body || {});
        const response = await createPagarmeRecipient(payload);
        const data = response.data || {};

        if (response.status < 200 || response.status >= 300) {
          throw new Error(data?.message || data?.errors?.[0]?.message || 'Erro ao criar Recipient Pagar.me');
        }

        const normalized = normalizePagarmeRecipientResponse(data);
        if (!normalized.id) throw new Error('Pagar.me não retornou Recipient ID.');

        const meta = { ...(seller.metadata || {}) };
        meta.paymentGateway = 'pagarme';
        meta.marketplaceSplitRequired = true;
        meta.manualTransferEnabled = false;
        meta.pagarmeRecipientId = normalized.id;
        meta.recipientId = normalized.id;
        meta.pagarmeRecipientStatus = normalized.status || 'created';
        meta.pagarmeRecipientCreatedAt = new Date().toISOString();
        meta.pagarmeRecipientError = '';

        seller = await Seller.findByIdAndUpdate(seller._id, { $set: { metadata: meta } }, { new: true });
        recipient = normalized;

        await writeAuditLog({
          scope: 'payments',
          eventType: 'pagarme_recipient_created_on_approval',
          status: 'success',
          request: redact(payload),
          response: redact(data),
          metadata: { sellerId: seller.sellerId || String(seller._id), admin: req.admin?.email || '' }
        });
      } catch (err) {
        recipientError = err.message || 'Erro ao criar Recipient Pagar.me';
        const meta = { ...(seller.metadata || {}) };
        meta.pagarmeRecipientError = recipientError;
        meta.pagarmeRecipientErrorAt = new Date().toISOString();
        meta.pagarmeRecipientRequiredFields = err.requiredFields || [];
        seller = await Seller.findByIdAndUpdate(seller._id, { $set: { metadata: meta } }, { new: true });

        await writeAuditLog({
          scope: 'payments',
          eventType: 'pagarme_recipient_created_on_approval',
          status: 'error',
          message: recipientError,
          metadata: { sellerId: seller.sellerId || String(seller._id), admin: req.admin?.email || '', requiredFields: err.requiredFields || [] }
        });
      }
    }

    const s = normalizePartnerRequestForResponse(seller);
    await createAdminNotification({
      type: 'partner_request_status_updated',
      title: status === 'approved' ? '✅ Seller aprovado' : status === 'rejected' ? '❌ Seller recusado' : '⏳ Seller pendente',
      message: recipient?.id
        ? `${s.storeName || s.factoryName || 'Seller'} foi aprovado e o Recipient Pagar.me foi criado.`
        : recipientError
          ? `${s.storeName || s.factoryName || 'Seller'} foi aprovado, mas o Recipient Pagar.me não foi criado: ${recipientError}`
          : `${s.storeName || s.factoryName || 'Seller'} foi marcado como ${s.statusLabel}.`,
      relatedId: s.id,
      severity: status === 'approved' ? (recipientError ? 'warning' : 'success') : status === 'rejected' ? 'warning' : 'info',
      metadata: { sellerId: s.sellerId, status, recipientId: recipient?.id || '', recipientError: recipientError || '' }
    });

    return res.json({ ok: true, request: s, seller: s, recipient, recipientError });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao atualizar status do seller' });
  }
});

app.patch('/api/seller/partner-requests/:id/commission', adminRequired, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const raw = req.body?.commissionPercent ?? req.body?.marketplaceCommissionPercent ?? req.body?.percent;
    const commissionPercent = Number(String(raw ?? '').replace(',', '.'));

    if (!id) return res.status(400).json({ ok: false, error: 'Seller inválido' });
    if (!Number.isFinite(commissionPercent) || commissionPercent < 0 || commissionPercent > 50) {
      return res.status(400).json({ ok: false, error: 'Informe uma comissão entre 0% e 50%.' });
    }

    const filter = mongoose.Types.ObjectId.isValid(id)
      ? { $or: [{ _id: id }, { sellerId: id }] }
      : { sellerId: id };

    const seller = await Seller.findOneAndUpdate(filter, {
      $set: {
        'metadata.commissionPercent': commissionPercent,
        'metadata.marketplaceCommissionPercent': commissionPercent,
        'metadata.commissionUpdatedAt': now(),
        'metadata.commissionUpdatedBy': req.admin?.email || req.user?.email || 'admin'
      }
    }, { new: true });

    if (!seller) return res.status(404).json({ ok: false, error: 'Seller não encontrado' });

    const s = normalizePartnerRequestForResponse(seller);
    await createAdminNotification({
      type: 'seller_commission_updated',
      title: '💰 Comissão do seller atualizada',
      message: `${s.storeName || s.factoryName || s.displayName || 'Seller'} agora está com comissão de ${commissionPercent}%.`,
      relatedId: s.id,
      severity: 'info',
      metadata: { sellerId: s.sellerId, commissionPercent }
    });

    return res.json({ ok: true, seller: s, request: s, commissionPercent });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao alterar comissão do seller' });
  }
});

app.post('/api/seller/complete-onboarding', async (req, res) => { try { const sellerId = String(req.body?.sellerId || req.body?.partner_request_id || '').trim(); if (!sellerId) return res.status(400).json({ ok: false, error: 'sellerId é obrigatório' }); const seller = await Seller.findOneAndUpdate({ sellerId }, { $set: { onboardingCompleted: true, status: 'approved', metadata: { ...(req.body || {}) } } }, { new: true }); if (!seller) return res.status(404).json({ ok: false, error: 'Seller não encontrado' }); return res.json({ ok: true, seller: toJSON(seller) }); } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Erro ao completar onboarding' }); } });

app.get('/api/seller/returns', sellerAuthRequired, async (req, res) => {
  try {
    const sid = String(req.sellerId || '').trim();

    const orders = await Order.find({
      sellerIds: sid,
      $or: [
        { status: /devol/i },
        { status: /troca/i },
        { statusLabel: /devol/i },
        { statusLabel: /troca/i },
        { returnReason: { $exists: true, $ne: '' } },
        { reason: { $exists: true, $ne: '' } }
      ]
    }).sort({ updatedAt: -1, createdAt: -1 }).limit(100);

    return res.json(orders.map(toJSON));
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || 'Erro ao buscar devoluções'
    });
  }
});

// ===== ROTAS SELLER CORRIGIDAS - ESPECÃFICAS ANTES DO CURINGA /api/seller/:sellerId =====
async function sellerAuthRequired(req,res,next){
  try{
    const h=req.headers.authorization||''; const token=h.startsWith('Bearer ')?h.slice(7):'';
    if(!token) return res.status(401).json({ok:false,error:'Token ausente'});
    const dec=jwt.verify(token,JWT_SECRET);
    const user=dec.id?await User.findById(dec.id):null;
    if(!user) return res.status(401).json({ok:false,error:'Usuário inválido'});
    let seller=user.sellerId?await Seller.findOne({sellerId:user.sellerId}):null;
    if(!seller && user.email) seller=await Seller.findOne({email:String(user.email).toLowerCase()});
    if(!seller) return res.status(403).json({ok:false,error:'Seller não encontrado'});
    req.user=user; req.seller=seller; req.sellerId=String(seller.sellerId||user.sellerId||'');
    next();
  }catch(e){ return res.status(401).json({ok:false,error:'Token inválido'}); }
}

function cleanDigitsOnly(value = '') {
  return String(value || '').replace(/\D/g, '');
}
function normalizeSellerBankFields(raw = {}) {
  const bank = raw && typeof raw === 'object' ? raw : {};
  const fullAccountRaw = String(bank.account ?? bank.number ?? bank.bankAccount ?? bank.bankAccountNumber ?? bank.accountNumber ?? '').trim();
  const fullAccountDigits = cleanDigitsOnly(fullAccountRaw);
  const explicitDigit = String(bank.accountDigit ?? bank.accountCheckDigit ?? bank.contaDigito ?? '').replace(/\D/g, '').trim();
  const accountDigit = explicitDigit || (fullAccountDigits.length > 1 ? fullAccountDigits.slice(-1) : '');
  const accountNumber = explicitDigit ? fullAccountDigits : (fullAccountDigits.length > 1 ? fullAccountDigits.slice(0, -1) : fullAccountDigits);
  const fullAccount = fullAccountDigits || fullAccountRaw;
  return {
    bank: String(bank.bank ?? bank.bankName ?? bank.banco ?? '').trim(),
    bankName: String(bank.bankName ?? bank.bank ?? bank.banco ?? '').trim(),
    bankCode: cleanDigitsOnly(bank.bankCode ?? bank.codigoBanco ?? bank.code ?? ''),
    agency: cleanDigitsOnly(bank.agency ?? bank.bankAgency ?? bank.agencia ?? bank.branchNumber ?? ''),
    branchNumber: cleanDigitsOnly(bank.branchNumber ?? bank.agency ?? bank.bankAgency ?? bank.agencia ?? ''),
    agencyDigit: cleanDigitsOnly(bank.agencyDigit ?? bank.branchCheckDigit ?? bank.agenciaDigito ?? ''),
    branchCheckDigit: cleanDigitsOnly(bank.branchCheckDigit ?? bank.agencyDigit ?? bank.agenciaDigito ?? ''),
    account: fullAccount,
    number: fullAccount,
    fullAccount,
    accountNumber,
    accountDigit,
    accountCheckDigit: accountDigit,
    pixKey: String(bank.pixKey ?? bank.chavePix ?? '').trim(),
    accountType: String(bank.accountType ?? bank.bankAccountType ?? bank.tipoConta ?? 'checking').trim(),
    holderName: String(bank.holderName ?? bank.bankHolderName ?? bank.titular ?? '').trim(),
    holderDocument: cleanDigitsOnly(bank.holderDocument ?? bank.bankHolderDocument ?? bank.documentTitular ?? bank.cpfCnpjTitular ?? '')
  };
}

function sellerProfile(s, u) {
  const o = toJSON(s) || {};
  const meta = o.metadata && typeof o.metadata === 'object' ? o.metadata : {};
  const rootBank = o.bankAccount && typeof o.bankAccount === 'object' ? o.bankAccount : {};
  const bankFromMeta = meta.bankAccount && typeof meta.bankAccount === 'object' ? meta.bankAccount : {};
  const legacyMetaBankAccount = meta.bankAccount && typeof meta.bankAccount !== 'object' ? String(meta.bankAccount) : '';
  const bankAccount = normalizeSellerBankFields({
    bank: rootBank.bank || rootBank.bankName || bankFromMeta.bank || bankFromMeta.bankName || meta.bank || meta.bankName || '',
    bankName: rootBank.bankName || rootBank.bank || bankFromMeta.bankName || bankFromMeta.bank || meta.bankName || meta.bank || '',
    bankCode: rootBank.bankCode || bankFromMeta.bankCode || meta.bankCode || meta.codigoBanco || '',
    agency: rootBank.agency || rootBank.bankAgency || bankFromMeta.agency || bankFromMeta.bankAgency || meta.bankAgency || meta.agency || meta.branchNumber || '',
    agencyDigit: rootBank.agencyDigit || rootBank.branchCheckDigit || bankFromMeta.agencyDigit || bankFromMeta.branchCheckDigit || meta.agencyDigit || meta.branchCheckDigit || '',
    account: rootBank.account || rootBank.accountNumber || rootBank.number || rootBank.bankAccount || bankFromMeta.account || bankFromMeta.accountNumber || bankFromMeta.number || bankFromMeta.bankAccount || meta.accountNumber || meta.bankAccountNumber || meta.conta || legacyMetaBankAccount || '',
    accountDigit: rootBank.accountDigit || rootBank.accountCheckDigit || bankFromMeta.accountDigit || bankFromMeta.accountCheckDigit || meta.accountDigit || meta.accountCheckDigit || meta.contaDigito || '',
    pixKey: rootBank.pixKey || bankFromMeta.pixKey || meta.pixKey || '',
    accountType: rootBank.accountType || bankFromMeta.accountType || meta.accountType || meta.bankAccountType || meta.tipoConta || '',
    holderName: rootBank.holderName || rootBank.bankHolderName || bankFromMeta.holderName || bankFromMeta.bankHolderName || meta.bankHolderName || meta.holderName || '',
    holderDocument: rootBank.holderDocument || rootBank.bankHolderDocument || bankFromMeta.holderDocument || bankFromMeta.bankHolderDocument || meta.bankHolderDocument || meta.holderDocument || meta.documentTitular || meta.cpfCnpjTitular || ''
  });
  const status = String(o.status || meta.status || '').toLowerCase();
  return {
    ...o,
    metadata: meta,
    id: String(o.sellerId || o._id || ''),
    sellerId: String(o.sellerId || ''),
    name: o.displayName || o.storeName || u?.name || '',
    factoryName: String(meta.factoryName || o.storeName || o.displayName || u?.name || '').trim(),
    storeName: String(o.storeName || meta.storeName || meta.factoryName || o.displayName || '').trim(),
    displayName: String(o.displayName || o.storeName || meta.factoryName || u?.name || '').trim(),
    email: o.email || u?.email || meta.email || '',
    phone: o.phone || u?.phone || meta.phone || '',
    document: o.document || u?.cpf || meta.document || meta.cnpj || '',
    cnpj: String(meta.cnpj || o.document || u?.cpf || '').trim(),
    bio: String(meta.bio || meta.description || meta.descricao || o.bio || '').trim(),
    description: String(meta.bio || meta.description || meta.descricao || o.description || '').trim(),
    bankAccount,
    cepColeta: String(meta.cepColeta || meta.pickupCep || meta.cep_coleta || '').replace(/\D/g, ''),
    tipoLogistica: String(meta.tipoLogistica || meta.shippingType || (meta.transpPropria === true ? 'propria' : 'marketplace')).trim(),
    transpPropria: meta.transpPropria === true || meta.ownCarrier === true || meta.transportadoraPropria === true,
    transportadoraNome: String(meta.transportadoraNome || meta.carrierName || '').trim(),
    transportadoraTelefone: String(meta.transportadoraTelefone || meta.carrierPhone || '').trim(),
    transportadoraPrazo: String(meta.transportadoraPrazo || meta.carrierDeadline || '').trim(),
    freteObs: String(meta.freteObs || meta.shippingNotes || '').trim(),
    active: !['bloqueado','reprovado','blocked','rejected'].includes(status)
  };
}
app.post('/api/seller/auth/login',async(req,res)=>{
  try{
    const email=String(req.body?.email||'').trim().toLowerCase(); const password=String(req.body?.password||'');
    if(!email||!password) return res.status(400).json({ok:false,error:'E-mail e senha são obrigatórios'});
    let user=await User.findOne({email}); let seller=user?.sellerId?await Seller.findOne({sellerId:user.sellerId}):null;
    if(!seller) seller=await Seller.findOne({email});
    const temp=String(seller?.metadata?.requestedTempPass||seller?.metadata?.password||seller?.metadata?.senha||'');
    let valid=false;
    if(user?.passwordHash){ try{valid=await bcrypt.compare(password,String(user.passwordHash||''));}catch(_){valid=false;} if(!valid&&String(user.passwordHash||'')===password){valid=true; user.passwordHash=await bcrypt.hash(password,10); await user.save();}}
    if(!valid&&temp&&temp===password) valid=true;
    if(!seller&&user&&String(user.role||'').toLowerCase()==='seller'){ const sid=user.sellerId||uid('seller'); seller=await Seller.create({sellerId:sid,userId:user._id,displayName:user.name||email,storeName:user.name||email,email,phone:user.phone||'',document:user.cpf||'',status:'aprovado',onboardingCompleted:true,metadata:{}}); user.sellerId=sid; await user.save();}
    if(!seller) return res.status(401).json({ok:false,error:'Seller não encontrado'});
    if(!valid) return res.status(401).json({ok:false,error:'Credenciais inválidas'});
    if(!user){ user=await User.create({name:seller.displayName||seller.storeName||email,email,passwordHash:await bcrypt.hash(password,10),phone:seller.phone||'',cpf:seller.document||'',role:'seller',sellerId:seller.sellerId,isActive:true}); seller.userId=user._id; await seller.save();}
    if(String(user.role||'').toLowerCase()!=='seller'||!user.sellerId){ user.role='seller'; user.sellerId=seller.sellerId; await user.save();}
    return res.json({ok:true,token:signToken(user),seller:sellerProfile(seller,user),user:toJSON(user)});
  }catch(e){return res.status(500).json({ok:false,error:e.message||'Erro no login seller'});}
});
app.get('/api/seller/auth/me',sellerAuthRequired,(req,res)=>res.json({ok:true,seller:sellerProfile(req.seller,req.user),user:toJSON(req.user)}));

app.get('/api/seller/profile', sellerAuthRequired, async (req, res) => {
  try {
    return res.json({ ok: true, seller: sellerProfile(req.seller, req.user), user: toJSON(req.user) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'Erro ao carregar dados cadastrais do seller' });
  }
});


async function saveSellerProfileSettings(req, res) {
  try {
    const body = req.body || {};
    const sellerUpdates = {};
    const userUpdates = {};

    const sellerStatus = String(req.seller?.status || '').trim().toLowerCase();
    const sellerApproved = ['approved', 'aprovado', 'ativo', 'active'].includes(sellerStatus);

    const metadata = { ...(req.seller?.metadata || {}) };

    const incomingFactoryName = body.factoryName ?? body.storeName ?? body.displayName;
    if (!sellerApproved && incomingFactoryName !== undefined) {
      const name = String(incomingFactoryName || '').trim();
      sellerUpdates.storeName = name;
      sellerUpdates.displayName = name || req.seller?.displayName || req.seller?.storeName || '';
      metadata.factoryName = name;
      metadata.storeName = name;
    }

    // Dados jurídicos continuam protegidos depois da aprovação.
    if (!sellerApproved) {
      const incomingDocument = body.cnpj ?? body.document ?? body.cpf;
      if (incomingDocument !== undefined) {
        const doc = String(incomingDocument || '').replace(/\D/g, '');
        sellerUpdates.document = doc;
        userUpdates.cpf = doc;
        metadata.cnpj = doc;
        metadata.document = doc;
      }
      if (body.email !== undefined) {
        const email = String(body.email || '').trim().toLowerCase();
        sellerUpdates.email = email;
        userUpdates.email = email;
        metadata.email = email;
      }
    }

    if (body.phone !== undefined) {
      sellerUpdates.phone = String(body.phone || '').trim();
      userUpdates.phone = sellerUpdates.phone;
      metadata.phone = sellerUpdates.phone;
    }
    if (body.city !== undefined) userUpdates.city = String(body.city || '').trim();
    if (body.uf !== undefined) userUpdates.uf = String(body.uf || '').trim().toUpperCase().slice(0, 2);

    // Campos complementares da tela seller_configuracoes.html.
    if (body.bio !== undefined || body.description !== undefined || body.descricao !== undefined) {
      metadata.bio = String(body.bio ?? body.description ?? body.descricao ?? '').trim();
      metadata.description = metadata.bio;
    }

    const bankBody = body.bankAccount && typeof body.bankAccount === 'object' ? body.bankAccount : {};
    if (body.bankAccount !== undefined || body.bankName !== undefined || body.bankCode !== undefined || body.bankAgency !== undefined || body.account !== undefined || body.accountDigit !== undefined || body.bankHolderName !== undefined || body.bankHolderDocument !== undefined) {
      const bankAccount = normalizeSellerBankFields({
        bank: bankBody.bank ?? bankBody.bankName ?? body.bankName ?? body.bank ?? '',
        bankName: bankBody.bankName ?? bankBody.bank ?? body.bankName ?? body.bank ?? '',
        bankCode: bankBody.bankCode ?? body.bankCode ?? body.codigoBanco ?? '',
        agency: bankBody.agency ?? bankBody.bankAgency ?? body.bankAgency ?? body.agency ?? '',
        agencyDigit: bankBody.agencyDigit ?? bankBody.branchCheckDigit ?? body.agencyDigit ?? body.branchCheckDigit ?? '',
        account: bankBody.account ?? bankBody.accountNumber ?? bankBody.number ?? bankBody.bankAccount ?? body.accountNumber ?? body.bankAccountNumber ?? body.account ?? '',
        accountDigit: bankBody.accountDigit ?? bankBody.accountCheckDigit ?? body.accountDigit ?? body.accountCheckDigit ?? body.contaDigito ?? '',
        pixKey: bankBody.pixKey ?? body.pixKey ?? '',
        accountType: bankBody.accountType ?? bankBody.bankAccountType ?? body.accountType ?? body.bankAccountType ?? 'checking',
        holderName: bankBody.holderName ?? bankBody.bankHolderName ?? body.bankHolderName ?? body.holderName ?? '',
        holderDocument: bankBody.holderDocument ?? bankBody.bankHolderDocument ?? body.bankHolderDocument ?? body.holderDocument ?? body.documentTitular ?? body.cpfCnpjTitular ?? ''
      });
      metadata.bankAccount = bankAccount;
      metadata.bankName = bankAccount.bankName || bankAccount.bank;
      metadata.bank = bankAccount.bank || bankAccount.bankName;
      metadata.bankCode = bankAccount.bankCode || normalizePagarmeBankCode(bankAccount.bank || bankAccount.bankName || '');
      metadata.bankAgency = bankAccount.agency;
      metadata.agency = bankAccount.agency;
      metadata.branchNumber = bankAccount.branchNumber || bankAccount.agency;
      metadata.branchCheckDigit = bankAccount.branchCheckDigit || bankAccount.agencyDigit || '';
      metadata.bankAccountNumber = bankAccount.fullAccount || bankAccount.account;
      metadata.conta = bankAccount.fullAccount || bankAccount.account;
      metadata.accountNumber = bankAccount.accountNumber || bankAccount.fullAccount || bankAccount.account;
      metadata.accountCheckDigit = bankAccount.accountCheckDigit || bankAccount.accountDigit || '';
      metadata.accountDigit = bankAccount.accountDigit || bankAccount.accountCheckDigit || '';
      metadata.pixKey = bankAccount.pixKey || metadata.pixKey || '';
      metadata.accountType = bankAccount.accountType || metadata.accountType || 'checking';
      metadata.bankAccountType = metadata.accountType;
      metadata.bankHolderName = bankAccount.holderName || metadata.bankHolderName || req.seller?.storeName || req.seller?.displayName || '';
      metadata.holderName = metadata.bankHolderName;
      metadata.bankHolderDocument = bankAccount.holderDocument || metadata.bankHolderDocument || req.seller?.document || req.user?.cpf || '';
      metadata.holderDocument = metadata.bankHolderDocument;
    }

    if (body.cepColeta !== undefined || body.pickupCep !== undefined || body.cep_coleta !== undefined) {
      metadata.cepColeta = String(body.cepColeta ?? body.pickupCep ?? body.cep_coleta ?? '').replace(/\D/g, '');
    }
    if (body.tipoLogistica !== undefined || body.shippingType !== undefined) {
      metadata.tipoLogistica = String(body.tipoLogistica ?? body.shippingType ?? '').trim() || 'marketplace';
      metadata.shippingType = metadata.tipoLogistica;
    }
    if (body.transpPropria !== undefined || body.ownCarrier !== undefined || body.transportadoraPropria !== undefined) {
      metadata.transpPropria = body.transpPropria === true || body.ownCarrier === true || body.transportadoraPropria === true;
      metadata.ownCarrier = metadata.transpPropria;
      metadata.transportadoraPropria = metadata.transpPropria;
      if (metadata.transpPropria && !metadata.tipoLogistica) metadata.tipoLogistica = 'propria';
    }
    if (body.transportadoraNome !== undefined || body.carrierName !== undefined) {
      metadata.transportadoraNome = String(body.transportadoraNome ?? body.carrierName ?? '').trim();
      metadata.carrierName = metadata.transportadoraNome;
    }
    if (body.transportadoraTelefone !== undefined || body.carrierPhone !== undefined) {
      metadata.transportadoraTelefone = String(body.transportadoraTelefone ?? body.carrierPhone ?? '').trim();
      metadata.carrierPhone = metadata.transportadoraTelefone;
    }
    if (body.transportadoraPrazo !== undefined || body.carrierDeadline !== undefined) {
      metadata.transportadoraPrazo = String(body.transportadoraPrazo ?? body.carrierDeadline ?? '').trim();
      metadata.carrierDeadline = metadata.transportadoraPrazo;
    }
    if (body.freteObs !== undefined || body.shippingNotes !== undefined) {
      metadata.freteObs = String(body.freteObs ?? body.shippingNotes ?? '').trim();
      metadata.shippingNotes = metadata.freteObs;
    }

    metadata.updatedFromSellerConfigAt = now();
    sellerUpdates.metadata = metadata;

    const seller = await Seller.findOneAndUpdate(
      { sellerId: req.sellerId },
      { $set: sellerUpdates },
      { new: true }
    );

    const user = Object.keys(userUpdates).length
      ? await User.findByIdAndUpdate(req.user._id, { $set: userUpdates }, { new: true })
      : req.user;

    return res.json({
      ok: true,
      lockedLegalData: sellerApproved,
      seller: sellerProfile(seller, user),
      user: toJSON(user)
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'Erro ao salvar dados cadastrais do seller' });
  }
}

app.patch('/api/seller/profile', sellerAuthRequired, saveSellerProfileSettings);
app.put('/api/seller/profile', sellerAuthRequired, saveSellerProfileSettings);
app.put('/api/seller/update', sellerAuthRequired, saveSellerProfileSettings);
app.patch('/api/seller/update', sellerAuthRequired, saveSellerProfileSettings);

app.get('/api/seller/dashboard', sellerAuthRequired, async (req, res) => {
  try {
    const sid = String(req.sellerId || '').trim();
    const productQuery = { sellerId: sid };
    const totalProdutos = await Product.countDocuments(productQuery);
    const produtosAtivos = await Product.countDocuments({ sellerId: sid, active: { $ne: false } });
    const orderQuery = { $or: [{ sellerIds: sid }, { 'items.sellerId': sid }] };
    const orders = await Order.find(orderQuery).sort({ createdAt: -1 }).limit(20);
    const allSellerOrders = await Order.find(orderQuery).select('status total items sellerIds createdAt');
    const pendingStatuses = new Set(['pendente', 'pending', 'processing', 'preparando', 'novo', 'new']);
    const approvedStatuses = new Set(['pago', 'approved', 'aprovado', 'paid', 'entregue', 'delivered', 'shipped']);
    let pedidosPendentes = 0;
    let vendasTotal = 0;
    for (const order of allSellerOrders) {
      const status = String(order.status || '').toLowerCase();
      if (pendingStatuses.has(status)) pedidosPendentes += 1;
      if (approvedStatuses.has(status)) {
        const sellerItems = ensureArray(order.items).filter((item) => String(item?.sellerId || '') === sid);
        const sellerTotal = sellerItems.reduce((sum, item) => sum + Number(item.totalPrice || (Number(item.unitPrice || 0) * Number(item.qty || 1)) || 0), 0);
        vendasTotal += sellerTotal || Number(order.total || 0);
      }
    }
    return res.json({
      ok: true,
      seller: sellerProfile(req.seller, req.user),
      totalProdutos,
      produtosAtivos,
      pedidosPendentes,
      totalPedidos: allSellerOrders.length,
      vendasTotal,
      recentOrders: orders.map(toJSON)
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'Erro ao carregar dashboard do seller' });
  }
});
app.get('/api/seller/notifications', sellerAuthRequired, async (req, res) => {
  try {
    const sid = String(req.sellerId || '').trim();
    const rows = await Notification.find({ audience: 'seller', sellerId: sid }).sort({ createdAt: -1 }).limit(Math.min(Number(req.query.limit || 80), 200));
    return res.json(rows.map(toJSON));
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'Erro ao listar notificações do seller' });
  }
});
app.patch('/api/seller/notifications/:id', sellerAuthRequired, async (req, res) => {
  try {
    const oid = normalizeObjectId(req.params.id);
    if (!oid) return res.status(400).json({ ok: false, error: 'ID inválido' });
    const sid = String(req.sellerId || '').trim();
    const doc = await Notification.findOneAndUpdate(
      { _id: oid, audience: 'seller', sellerId: sid },
      { $set: { status: req.body?.status || 'read' } },
      { new: true }
    );
    if (!doc) return res.status(404).json({ ok: false, error: 'Notificação não encontrada' });
    return res.json({ ok: true, notification: toJSON(doc) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'Erro ao atualizar notificação do seller' });
  }
});
app.post('/api/seller/notifications/mark-read', sellerAuthRequired, async (req, res) => {
  try {
    const sid = String(req.sellerId || '').trim();
    await Notification.updateMany({ audience: 'seller', sellerId: sid, status: { $ne: 'read' } }, { $set: { status: 'read' } });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'Erro ao marcar notificações como lidas' });
  }
});

app.get('/api/seller/extrato', sellerAuthRequired, async (req, res) => {
  try {
    const sid = String(req.sellerId || '').trim();
    const approvedStatuses = ['pago','paid','approved','aprovado','pagamento_confirmado','pagamento confirmado','enviado','shipped','entregue','delivered'];
    const docs = await Order.find({ $or: [{ sellerIds: sid }, { 'items.sellerId': sid }] }).sort({ createdAt: -1 }).limit(500);
    const productBaseMap = await buildProductBasePriceMapForOrders(docs);
    const rows = docs.map((doc) => {
      const order = toJSON(doc);
      const statusText = String(order.statusLabel || order.status || '').toLowerCase();
      const isApproved = approvedStatuses.some((s) => statusText.includes(s));
      if (!isApproved) return null;
      const st = getSellerSettlementForOrder(order, sid, productBaseMap)
      return {
        id: String(order._id || order.id || ''),
        orderId: String(order._id || order.id || ''),
        createdAt: order.createdAt,
        status: order.status,
        statusLabel: order.statusLabel,
        gross: st.gross,
        chargedGross: st.chargedGross,
        fee: st.fee,
        commission: st.commission,
        label: st.label,
        net: st.net,
        commissionPercent: st.commissionPercent
      };
    }).filter(Boolean);
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar extrato' });
  }
});

app.get('/api/seller/sales', sellerAuthRequired, async (req, res) => {
  try {
    const sid = String(req.sellerId || '').trim();
    const docs = await Order.find({ $or: [{ sellerIds: sid }, { 'items.sellerId': sid }] }).sort({ createdAt: -1 }).limit(500);
    const productBaseMap = await buildProductBasePriceMapForOrders(docs);
    const rows = docs.map((doc) => {
      const order = toJSON(doc);
      const statusText = String(order.statusLabel || order.status || '').toLowerCase();
      const isApproved = ['pago','paid','approved','aprovado','pagamento_confirmado','pagamento confirmado','enviado','shipped','entregue','delivered'].some((s) => statusText.includes(s));
      if (!isApproved) return null;
      const st = getSellerSettlementForOrder(order, sid, productBaseMap)
      return { id: String(order._id || order.id || ''), createdAt: order.createdAt, status: order.status, statusLabel: order.statusLabel, total: st.gross, gross: st.gross, fee: st.fee, label: st.label, net: st.net };
    }).filter(Boolean);
    return res.json({ ok: true, items: rows, sales: rows });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar vendas' });
  }
});

app.get('/api/seller/orders',sellerAuthRequired,async(req,res)=>{try{const sid=req.sellerId; const rows=await Order.find({$or:[{sellerIds:sid},{'items.sellerId':sid}]}).sort({createdAt:-1}).limit(500); return res.json(rows.map(toJSON));}catch(e){return res.status(500).json({ok:false,error:e.message||'Erro ao listar pedidos'});}});
app.get('/api/seller/orders/:id',sellerAuthRequired,async(req,res)=>{try{const oid=normalizeObjectId(req.params.id); if(!oid)return res.status(400).json({ok:false,error:'ID inválido'}); const order=await Order.findById(oid); if(!order)return res.status(404).json({ok:false,error:'Pedido não encontrado'}); return res.json({ok:true,order:toJSON(order)});}catch(e){return res.status(500).json({ok:false,error:e.message||'Erro ao carregar pedido'});}});
app.put('/api/seller/orders/:id/status',sellerAuthRequired,async(req,res)=>{try{const oid=normalizeObjectId(req.params.id); if(!oid)return res.status(400).json({ok:false,error:'ID inválido'}); const before=await Order.findById(oid); if(!before)return res.status(404).json({ok:false,error:'Pedido não encontrado'}); const sid=String(req.sellerId||'').trim(); const allowed=extractSellerIdsFromOrder(before).includes(sid); if(!allowed)return res.status(403).json({ok:false,error:'Sem permissão para este pedido'}); const order=await Order.findByIdAndUpdate(oid,{$set:{status:req.body?.status||'processing',statusLabel:req.body?.statusLabel||req.body?.status||'processing'}},{new:true}); await createSellerOrderNotifications(order,{type:'seller_order_updated',title:'📦 Pedido atualizado',message:`Pedido #${String(order._id).slice(-8).toUpperCase()} atualizado para ${order.statusLabel||order.status||'Atualizado'}`,severity:'info',origin:'seller_status_route'}); await createAdminNotification({type:'seller_order_updated',title:'ðŸ­ Seller atualizou pedido',message:`Seller ${req.seller?.storeName||req.seller?.displayName||sid} atualizou o pedido ${order._id} para ${order.statusLabel||order.status||'Atualizado'}`,relatedId:String(order._id),severity:'info',metadata:{sellerId:sid,origin:'seller_status_route'}}); const customerWhatsapp=await waMaybeNotifyOrderStatusChange(String(order._id),toJSON(before),toJSON(order),'seller_status_route'); const adminWhatsapp=await waNotifyAdminOrderStatusChange(String(order._id),toJSON(before),toJSON(order),'seller_status_route_admin'); return res.json({ok:true,order:toJSON(order),whatsapp:customerWhatsapp,adminWhatsapp});}catch(e){return res.status(500).json({ok:false,error:e.message||'Erro ao atualizar status'});}});
app.post('/api/seller/orders/:id/ship',sellerAuthRequired,async(req,res)=>{try{const oid=normalizeObjectId(req.params.id); if(!oid)return res.status(400).json({ok:false,error:'ID inválido'}); const trackingCode=String(req.body?.trackingCode||req.body?.tracking||'').trim(); const carrier=String(req.body?.carrier||'').trim(); const before=await Order.findById(oid); if(!before)return res.status(404).json({ok:false,error:'Pedido não encontrado'}); const beforeObj=toJSON(before); const sid=String(req.sellerId||'').trim(); const allowed=extractSellerIdsFromOrder(beforeObj).includes(sid); if(!allowed)return res.status(403).json({ok:false,error:'Sem permissão para este pedido'}); const order=before; order.status='shipped'; order.statusLabel='Enviado'; order.trackingCode=trackingCode||order.trackingCode; order.shipping={...(order.shipping||{}),carrier,trackingCode:trackingCode||order.trackingCode,shippedAt:now()}; order.trackingHistory=ensureArray(order.trackingHistory); order.trackingHistory.push({status:'shipped',label:'Pedido enviado pelo seller',carrier,trackingCode,date:now()}); await order.save(); const afterObj=toJSON(order); await createSellerOrderNotifications(order,{type:'seller_order_shipped',title:'ðŸšš Pedido marcado como enviado',message:`Pedido #${String(order._id).slice(-8).toUpperCase()} marcado como enviado${trackingCode?` - Rastreio: ${trackingCode}`:''}`,severity:'success',origin:'seller_ship_route'}); await createAdminNotification({type:'seller_order_shipped',title:'ðŸšš Seller marcou pedido como enviado',message:`Seller ${req.seller?.storeName||req.seller?.displayName||sid} marcou o pedido ${order._id} como enviado${trackingCode?` - Rastreio: ${trackingCode}`:''}`,relatedId:String(order._id),severity:'success',metadata:{sellerId:sid,origin:'seller_ship_route'}}); const customerWhatsapp=await waMaybeNotifyOrderStatusChange(String(order._id),beforeObj,afterObj,'seller_ship_route'); const adminWhatsapp=await waNotifyAdminOrderStatusChange(String(order._id),beforeObj,afterObj,'seller_ship_route_admin'); return res.json({ok:true,order:afterObj,whatsapp:customerWhatsapp,adminWhatsapp});}catch(e){return res.status(500).json({ok:false,error:e.message||'Erro ao marcar enviado'});}});


// ===== ROTAS DE PRODUTOS DO SELLER - DEVEM VIR ANTES DE /api/seller/:sellerId =====
app.get('/api/seller/products', sellerAuthRequired, async (req, res) => {
  try {
    const query = { sellerId: String(req.sellerId || '').trim() };
    if (!query.sellerId) return res.status(403).json({ ok: false, error: 'Seller não identificado' });
    if (req.query.active !== undefined) query.active = String(req.query.active) !== 'false';
    const rows = await Product.find(query).sort({ createdAt: -1 });
    return res.json(rows.map(normalizeProductForResponse));
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar produtos do seller' });
  }
});

app.get('/api/seller/products/:id', sellerAuthRequired, async (req, res) => {
  try {
    const sid = String(req.sellerId || '').trim();
    const oid = normalizeObjectId(req.params.id);
    let row = oid ? await Product.findOne({ _id: oid, sellerId: sid }) : null;
    if (!row) row = await Product.findOne({ sellerId: sid, $or: [{ sku: req.params.id }, { slug: req.params.id }] });
    if (!row) return res.status(404).json({ ok: false, error: 'Produto não encontrado para este seller' });
    return res.json(normalizeProductForResponse(row));
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar produto do seller' });
  }
});

app.delete('/api/seller/products/:id', sellerAuthRequired, async (req, res) => {
  try {
    const oid = normalizeObjectId(req.params.id);
    if (!oid) return res.status(400).json({ ok: false, error: 'ID inválido' });
    const sid = String(req.sellerId || '').trim();
    const deleted = await Product.findOneAndDelete({ _id: oid, sellerId: sid });
    if (!deleted) return res.status(404).json({ ok: false, error: 'Produto não encontrado para este seller' });
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao excluir produto' });
  }
});

app.put('/api/seller/products/:id', sellerAuthRequired, async (req, res) => {
  try {
    const oid = normalizeObjectId(req.params.id);
    if (!oid) return res.status(400).json({ ok: false, error: 'ID inválido' });

    const sid = String(req.sellerId || '').trim();
    const existing = await Product.findOne({ _id: oid, sellerId: sid });
    if (!existing) {
      return res.status(404).json({ ok: false, error: 'Produto não encontrado para este seller' });
    }

    const payload = productPayloadFromBody(req.body || {}, existing);
    payload.sellerId = sid;
    payload.sellerName = existing.sellerName || req.seller?.storeName || req.seller?.displayName || 'Seller';

    const updated = await Product.findOneAndUpdate(
      { _id: oid, sellerId: sid },
      { $set: payload },
      { new: true }
    );

    return res.json({ ok: true, product: normalizeProductForResponse(updated) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao salvar produto' });
  }
});

app.get('/api/seller/payment-split', sellerAuthRequired, async (req, res) => {
  try {
    const seller = req.seller || {};
    const meta = seller.metadata || {};
    const settings = await getPaymentsSettings();
    const recipientId = String(meta.pagarmeRecipientId || meta.pagarme_recipient_id || seller.pagarmeRecipientId || '').trim();
    return res.json({
      ok: true,
      gateway: 'pagarme',
      splitRequired: true,
      manualTransferEnabled: false,
      commissionPercent: Number(meta.commissionPercent || settings.pagarme?.marketplaceFeePercent || 12),
      pagarme: {
        enabled: settings.pagarme?.enabled !== false,
        connected: !!recipientId,
        recipientId,
        status: meta.pagarmeRecipientStatus || '',
        bank: {
          document: meta.document || seller.document || '',
          legalName: meta.legalName || seller.storeName || seller.displayName || '',
          bankCode: meta.bankCode || '',
          branchNumber: meta.branchNumber || '',
          branchCheckDigit: meta.branchCheckDigit || '',
          accountNumber: meta.accountNumber || '',
          accountCheckDigit: meta.accountCheckDigit || '',
          accountType: meta.accountType || 'checking',
          bankHolderName: meta.bankHolderName || meta.legalName || seller.storeName || seller.displayName || '',
          bankHolderDocument: meta.bankHolderDocument || meta.document || seller.document || ''
        }
      }
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar recebimento Pagar.me do seller' });
  }
});

app.put('/api/seller/payment-split', sellerAuthRequired, async (req, res) => {
  try {
    const body = req.body || {};
    const meta = { ...(req.seller.metadata || {}) };
    meta.paymentGateway = 'pagarme';
    meta.marketplaceSplitRequired = true;
    meta.manualTransferEnabled = false;
    meta.pagarmeRecipientId = String(body.pagarmeRecipientId || body.pagarme_recipient_id || meta.pagarmeRecipientId || '').trim();
    meta.document = cleanPhone(body.document || body.cpfCnpj || meta.document || req.seller.document || '');
    meta.legalName = String(body.legalName || body.name || meta.legalName || req.seller.storeName || req.seller.displayName || '').trim();
    meta.bankCode = cleanPhone(body.bankCode || body.bank || meta.bankCode || '');
    meta.branchNumber = cleanPhone(body.branchNumber || body.agency || meta.branchNumber || '');
    meta.branchCheckDigit = cleanPhone(body.branchCheckDigit || body.agencyDigit || meta.branchCheckDigit || '');
    meta.accountNumber = cleanPhone(body.accountNumber || body.conta || meta.accountNumber || '');
    meta.accountCheckDigit = cleanPhone(body.accountCheckDigit || body.accountDigit || meta.accountCheckDigit || '');
    meta.accountType = normalizePagarmeAccountType(body.accountType || meta.accountType || 'checking');
    meta.bankHolderName = String(body.bankHolderName || meta.bankHolderName || meta.legalName || req.seller.storeName || req.seller.displayName || '').trim();
    meta.bankHolderDocument = cleanPhone(body.bankHolderDocument || meta.bankHolderDocument || meta.document || req.seller.document || '');
    if (body.commissionPercent !== undefined && body.commissionPercent !== null && body.commissionPercent !== '') meta.commissionPercent = Number(body.commissionPercent) || 12;
    const seller = await Seller.findByIdAndUpdate(req.seller._id, { $set: { metadata: meta } }, { new: true });
    return res.json({ ok: true, seller: sellerProfile(seller, req.user) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao salvar dados Pagar.me do seller' });
  }
});

app.post('/api/seller/payment-split/pagarme/recipient', sellerAuthRequired, async (req, res) => {
  try {
    const sellerDoc = req.seller;
    const payload = buildPagarmeRecipientPayloadFromSeller(sellerDoc, req.body || {});
    const response = await createPagarmeRecipient(payload);
    const data = response.data || {};
    if (response.status < 200 || response.status >= 300) {
      return res.status(response.status).json({ ok: false, error: data?.message || data?.errors?.[0]?.message || 'Erro ao criar Recipient Pagar.me', details: data });
    }
    const normalized = normalizePagarmeRecipientResponse(data);
    if (!normalized.id) return res.status(500).json({ ok: false, error: 'Pagar.me não retornou Recipient ID.', details: data });
    const meta = { ...(sellerDoc.metadata || {}), ...(req.body || {}) };
    meta.paymentGateway = 'pagarme';
    meta.marketplaceSplitRequired = true;
    meta.manualTransferEnabled = false;
    meta.pagarmeRecipientId = normalized.id;
    meta.pagarmeRecipientStatus = normalized.status;
    meta.pagarmeRecipientCreatedAt = new Date().toISOString();
    const seller = await Seller.findByIdAndUpdate(sellerDoc._id, { $set: { metadata: meta } }, { new: true });
    await writeAuditLog({ scope: 'payments', eventType: 'pagarme_recipient_created_by_seller', status: 'success', request: redact(payload), response: redact(data), metadata: { sellerId: seller.sellerId || String(seller._id) } });
    return res.json({ ok: true, recipientId: normalized.id, recipient: normalized, seller: sellerProfile(seller, req.user) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao criar Recipient Pagar.me', requiredFields: error.requiredFields || undefined });
  }
});

app.get('/api/seller/:sellerId', async (req, res) => {
  const seller = await Seller.findOne({ sellerId: req.params.sellerId });
  if (!seller) return res.status(404).json({ ok: false, error: 'Seller não encontrado' });
  return res.json({ ok: true, seller: toJSON(seller) });
});

app.get('/api/sellers/:sellerId', async (req, res) => {
  const seller = await Seller.findOne({ sellerId: req.params.sellerId });
  if (!seller) return res.status(404).json({ ok: false, error: 'Seller não encontrado' });
  return res.json({ ok: true, seller: toJSON(seller) });
});

app.get('/api/home/index-data', async (_req, res) => {
  try {
    const [categories, products, banners, paymentSettings] = await Promise.all([
      Category.find({ active: true }).sort({ sortOrder: 1, name: 1 }),
      Product.find({ active: true }).sort({ createdAt: -1 }).limit(200),
      Banner.find({ active: true }).sort({ sortOrder: 1, createdAt: -1 }),
      getPaymentsSettings()
    ]);

    return res.json({
      ok: true,
      categories: categories.map(toJSON),
      products: products.map(normalizeProductForResponse),
      banners: banners.map(normalizeBannerForResponse),
      payments: {
        mercadopago: {
          enabled: !!paymentSettings?.mercadopago?.enabled,
          publicKey: paymentSettings?.mercadopago?.publicKey || '',
          splitEnabled: paymentSettings?.mercadopago?.splitEnabled !== false
        },
        pagarme: {
          enabled: !!paymentSettings?.pagarme?.enabled
        }
      }
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar dados da home' });
  }
});

app.get('/api/index-data', async (req, res) => {
  req.url = '/api/home/index-data';
  return app._router.handle(req, res, () => {});
});

app.get('/api/home', async (req, res) => {
  req.url = '/api/home/index-data';
  return app._router.handle(req, res, () => {});
});

// ==========================================
// SEO: SITEMAP E ROBOTS DINÃ‚MICOS
// ==========================================
function getPublicSiteUrl() {
  const fromEnv = String(process.env.SITE_URL || process.env.FRONTEND_URL || 'https://arianamoveis.com.br').trim();
  return fromEnv.replace(/\/+$/, '') || 'https://arianamoveis.com.br';
}

function xmlEscape(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function isoDateOnly(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString().split('T')[0];
  return date.toISOString().split('T')[0];
}

function buildProductSeoUrl(baseUrl, product = {}) {
  const id = String(product._id || product.id || '').trim();
  const slug = String(product.slug || '').trim();

  // Mantém compatível com seu site atual, que abre produto por produto.html?id=...
  // Usa o slug só se não existir _id.
  const identifier = id || slug || sanitizeIdPart(product.name || product.sku || 'produto');
  return `${baseUrl}/produto.html?id=${encodeURIComponent(identifier)}`;
}

function buildCategorySeoUrl(baseUrl, category = {}) {
  const id = String(category._id || category.id || '').trim();
  const slug = String(category.slug || category.name || '').trim();
  const identifier = id || slug;
  return `${baseUrl}/categoria.html?id=${encodeURIComponent(identifier)}`;
}

app.get('/sitemap.xml', async (_req, res) => {
  try {
    const baseUrl = getPublicSiteUrl();

    const [products, categories] = await Promise.all([
      Product.find({ active: { $ne: false } })
        .select('_id id slug name sku updatedAt createdAt active')
        .sort({ updatedAt: -1, createdAt: -1 })
        .limit(10000)
        .lean(),
      Category.find({ active: { $ne: false } })
        .select('_id id slug name updatedAt createdAt active')
        .sort({ sortOrder: 1, name: 1 })
        .limit(1000)
        .lean()
    ]);

    const urls = [];

    const addUrl = (loc, lastmod, priority = '0.8', changefreq = 'weekly') => {
      if (!loc) return;
      urls.push(
        `  <url>\n` +
        `    <loc>${xmlEscape(loc)}</loc>\n` +
        `    <lastmod>${xmlEscape(isoDateOnly(lastmod))}</lastmod>\n` +
        `    <changefreq>${xmlEscape(changefreq)}</changefreq>\n` +
        `    <priority>${xmlEscape(priority)}</priority>\n` +
        `  </url>`
      );
    };

    addUrl(`${baseUrl}/`, new Date(), '1.0', 'daily');
    addUrl(`${baseUrl}/index.html`, new Date(), '1.0', 'daily');
    addUrl(`${baseUrl}/todos_produtos.html`, new Date(), '0.9', 'daily');
    addUrl(`${baseUrl}/ofertas.html`, new Date(), '0.9', 'daily');
    addUrl(`${baseUrl}/nossas_lojas.html`, new Date(), '0.6', 'monthly');
    addUrl(`${baseUrl}/contato.html`, new Date(), '0.5', 'monthly');

    for (const category of (categories || [])) {
      addUrl(buildCategorySeoUrl(baseUrl, category), category.updatedAt || category.createdAt, '0.7', 'weekly');
    }

    for (const product of (products || [])) {
      addUrl(buildProductSeoUrl(baseUrl, product), product.updatedAt || product.createdAt, '0.8', 'weekly');
    }

    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls.join('\n') +
      `\n</urlset>\n`;

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).send(xml);
  } catch (error) {
    console.error('[sitemap] erro ao gerar sitemap dinâmico:', error);
    return res.status(500).type('text/plain').send('Erro ao gerar sitemap');
  }
});

app.get('/robots.txt', (_req, res) => {
  const baseUrl = getPublicSiteUrl();
  const txt =
    `User-agent: *\n` +
    `Allow: /\n\n` +
    `Sitemap: ${baseUrl}/sitemap.xml\n`;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.status(200).send(txt);
});


// ==========================================
// SEO: INDEXNOW (BING / EDGE)
// ==========================================
const INDEXNOW_KEY = String(process.env.INDEXNOW_KEY || 'a1b2c3d4e5f67890123456789abcdef0').trim();
const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';

function getIndexNowKeyLocation() {
  return `${getPublicSiteUrl()}/${INDEXNOW_KEY}.txt`;
}

function normalizeIndexNowUrls(urls = []) {
  return Array.from(new Set(ensureArray(urls)
    .map((url) => String(url || '').trim())
    .filter((url) => /^https?:\/\//i.test(url))
  )).slice(0, 10000);
}

async function submitIndexNowUrls(urls = []) {
  const urlList = normalizeIndexNowUrls(urls);
  if (!urlList.length) return { ok: false, skipped: true, reason: 'empty_url_list' };

  const host = new URL(getPublicSiteUrl()).host;
  const payload = {
    host,
    key: INDEXNOW_KEY,
    keyLocation: getIndexNowKeyLocation(),
    urlList
  };

  const response = await axios.post(INDEXNOW_ENDPOINT, payload, {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    timeout: 30000,
    validateStatus: () => true
  });

  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    submitted: urlList.length,
    data: response.data || null
  };
}

app.get(`/${INDEXNOW_KEY}.txt`, (_req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.status(200).send(INDEXNOW_KEY);
});

app.post('/api/indexnow/submit', adminRequired, async (req, res) => {
  try {
    const urls = req.body?.urls || req.body?.urlList || req.body?.url || [];
    const result = await submitIndexNowUrls(urls);
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (error) {
    console.error('[indexnow] erro ao enviar URLs:', error);
    return res.status(500).json({ ok: false, error: error.message || 'indexnow_submit_failed' });
  }
});

app.post('/api/indexnow/submit-all-products', adminRequired, async (_req, res) => {
  try {
    const baseUrl = getPublicSiteUrl();
    const [products, categories] = await Promise.all([
      Product.find({ active: { $ne: false } })
        .select('_id id slug name sku updatedAt createdAt active')
        .sort({ updatedAt: -1, createdAt: -1 })
        .limit(10000)
        .lean(),
      Category.find({ active: { $ne: false } })
        .select('_id id slug name updatedAt createdAt active')
        .sort({ sortOrder: 1, name: 1 })
        .limit(1000)
        .lean()
    ]);

    const urls = [
      `${baseUrl}/`,
      `${baseUrl}/index.html`,
      `${baseUrl}/todos_produtos.html`,
      `${baseUrl}/ofertas.html`,
      ...(categories || []).map((category) => buildCategorySeoUrl(baseUrl, category)),
      ...(products || []).map((product) => buildProductSeoUrl(baseUrl, product))
    ];

    const result = await submitIndexNowUrls(urls);
    return res.status(result.ok ? 200 : 400).json({ ...result, products: products.length, categories: categories.length });
  } catch (error) {
    console.error('[indexnow] erro ao enviar todos os produtos:', error);
    return res.status(500).json({ ok: false, error: error.message || 'indexnow_submit_all_failed' });
  }
});


app.get('/api/categories', async (_req, res) => res.json((await Category.find({ active: true }).sort({ sortOrder: 1, name: 1 })).map(toJSON)));
app.get('/api/products', async (req, res) => {
  try {
    const query = {};
    if (req.query.active !== undefined) query.active = String(req.query.active) !== 'false';
    if (req.query.sellerId) query.sellerId = String(req.query.sellerId);

    if (req.query.category) {
      const cat = String(req.query.category).trim();
      const catRx = new RegExp(escapeRegex(cat), 'i');
      query.$or = [
        { category: catRx },
        { categoria: catRx },
        { categoryName: catRx },
        { categorySlug: catRx },
        { categoryId: cat },
        { subcategory: catRx },
        { subcategoria: catRx },
        { subcategoryName: catRx },
        { subcategoryId: cat }
      ];
    }

    if (req.query.q) {
      const q = String(req.query.q).trim();
      const rx = new RegExp(escapeRegex(q), 'i');
      const searchOr = [
        { name: rx },
        { description: rx },
        { category: rx },
        { categoria: rx },
        { categoryName: rx },
        { brand: rx },
        { sku: rx }
      ];
      query.$and = query.$and || [];
      query.$and.push({ $or: searchOr });
    }

    const rows = await Product.find(query).sort({ createdAt: -1 }).limit(Math.min(Number(req.query.limit || 500), 1000));
    return res.json(rows.map(normalizeProductForResponse));
  } catch (error) {
    console.error('[products] erro ao listar:', error);
    return res.status(500).json({ ok: false, error: 'Erro ao listar produtos' });
  }
});
app.get('/api/products/:id', async (req, res) => { const oid = normalizeObjectId(req.params.id); let doc = oid ? await Product.findById(oid) : null; if (!doc) doc = await Product.findOne({ $or: [{ sku: req.params.id }, { slug: req.params.id }] }); if (!doc) return res.status(404).json({ ok: false, error: 'Produto não encontrado' }); return res.json(normalizeProductForResponse(doc)); });
app.get('/api/products/seller/:sellerId', async (req, res) => {
  try {
    const sellerId = String(req.params.sellerId || '').trim();
    const rows = await Product.find({ sellerId }).sort({ createdAt: -1 });
    return res.json(rows.map(normalizeProductForResponse));
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar produtos do seller' });
  }
});

app.get('/api/seller/products', sellerAuthRequired, async (req, res) => {
  try {
    const query = { sellerId: String(req.sellerId || '').trim() };
    if (!query.sellerId) return res.status(403).json({ ok: false, error: 'Seller não identificado' });
    if (req.query.active !== undefined) query.active = String(req.query.active) !== 'false';
    const rows = await Product.find(query).sort({ createdAt: -1 });
    return res.json(rows.map(normalizeProductForResponse));
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar produtos do seller' });
  }
});

app.get('/api/seller/:sellerId/products', async (req, res) => {
  try {
    const sellerId = String(req.params.sellerId || '').trim();
    const query = { sellerId };
    if (req.query.active !== undefined) query.active = String(req.query.active) !== 'false';
    const rows = await Product.find(query).sort({ createdAt: -1 });
    return res.json(rows.map(normalizeProductForResponse));
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar produtos do seller' });
  }
});

app.get('/api/sellers/:sellerId/products', async (req, res) => {
  try {
    const sellerId = String(req.params.sellerId || '').trim();
    const query = { sellerId };
    if (req.query.active !== undefined) query.active = String(req.query.active) !== 'false';
    const rows = await Product.find(query).sort({ createdAt: -1 });
    return res.json(rows.map(normalizeProductForResponse));
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar produtos do seller' });
  }
});

app.get('/api/seller/products/:id', sellerAuthRequired, async (req, res) => {
  try {
    const sid = String(req.sellerId || '').trim();
    const oid = normalizeObjectId(req.params.id);
    let row = oid ? await Product.findOne({ _id: oid, sellerId: sid }) : null;
    if (!row) row = await Product.findOne({ sellerId: sid, $or: [{ sku: req.params.id }, { slug: req.params.id }] });
    if (!row) return res.status(404).json({ ok: false, error: 'Produto não encontrado para este seller' });
    return res.json(normalizeProductForResponse(row));
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar produto do seller' });
  }
});
app.post('/api/products', authRequired, async (req, res) => {
  try {
    const body = req.body || {};
    const userRole = String(req.user?.role || '').toLowerCase();
    const sellerId = userRole === 'admin' ? String(body.sellerId || req.user.sellerId || '').trim() : String(req.user.sellerId || '').trim();
    if (userRole === 'seller' && !sellerId) return res.status(403).json({ ok: false, error: 'Seller não identificado' });
    const seller = sellerId ? await Seller.findOne({ sellerId }) : null;
    const payload = productPayloadFromBody({ ...body, sellerId, sellerName: seller?.storeName || seller?.displayName || '' });
    const doc = await Product.create(payload);
    return res.json({ ok: true, product: normalizeProductForResponse(doc) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao cadastrar produto' });
  }
});
app.put('/api/products/:id', authRequired, async (req, res) => {
  try {
    const oid = normalizeObjectId(req.params.id);
    if (!oid) return res.status(400).json({ ok: false, error: 'ID inválido' });
    const before = await Product.findById(oid);
    if (!before) return res.status(404).json({ ok: false, error: 'Produto não encontrado' });
    const userRole = String(req.user?.role || '').toLowerCase();
    if (userRole === 'seller' && String(before.sellerId || '') !== String(req.user.sellerId || '')) {
      return res.status(403).json({ ok: false, error: 'Sem permissão para editar este produto' });
    }
    const update = productPayloadFromBody(req.body || {}, before);
    if (userRole === 'seller') update.sellerId = String(req.user.sellerId || '');
    const after = await Product.findByIdAndUpdate(oid, { $set: update }, { new: true });
    await writeAuditLog({ scope: 'catalog', eventType: 'product_updated', status: 'success', changedKeys: changedKeys(toJSON(before), toJSON(after)), metadata: { productId: String(after._id), sellerId: after.sellerId } });
    return res.json({ ok: true, product: normalizeProductForResponse(after) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao editar produto' });
  }
});
app.delete('/api/products/:id', authRequired, async (req, res) => {
  try {
    const oid = normalizeObjectId(req.params.id);
    if (!oid) return res.status(400).json({ ok: false, error: 'ID inválido' });
    const userRole = String(req.user?.role || '').toLowerCase();
    const query = userRole === 'seller' ? { _id: oid, sellerId: String(req.user.sellerId || '') } : { _id: oid };
    const deleted = await Product.findOneAndDelete(query);
    if (!deleted) return res.status(404).json({ ok: false, error: 'Produto não encontrado ou sem permissão' });
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao excluir produto' });
  }
});
app.delete('/api/seller/products/:id', sellerAuthRequired, async (req, res) => {
  try {
    const oid = normalizeObjectId(req.params.id);
    if (!oid) return res.status(400).json({ ok: false, error: 'ID inválido' });
    const sid = String(req.sellerId || '').trim();
    const deleted = await Product.findOneAndDelete({ _id: oid, sellerId: sid });
    if (!deleted) return res.status(404).json({ ok: false, error: 'Produto não encontrado para este seller' });
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao excluir produto' });
  }
  const query = { active: true };
  if (req.query.slot) query.slot = String(req.query.slot);
  const rows = await Banner.find(query).sort({ sortOrder: 1, createdAt: -1 });
  return res.json(rows.map(normalizeBannerForResponse));
});

app.get('/api/index/banners', async (req, res) => {
  req.url = '/api/banners';
  return app._router.handle(req, res, () => {});
});

app.get('/api/header_category_banner', async (_req, res) => {
  try {
    const doc = await Banner.findOne({ slot: 'header_category_banner', active: true }).sort({ sortOrder: 1, createdAt: -1 });
    if (!doc) return res.status(404).json({ ok: false, error: 'Banner não encontrado' });
    return res.json(normalizeBannerForResponse(doc));
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar banner do header' });
  }
});

app.get('/api/banners/header_category_banner', async (req, res) => {
  req.url = '/api/header_category_banner';
  return app._router.handle(req, res, () => {});
});

app.get('/api/admin/banners', adminRequired, async (_req, res) => {
  const rows = await Banner.find({}).sort({ sortOrder: 1, createdAt: -1 });
  return res.json(rows.map(normalizeBannerForResponse));
});

app.get('/api/admin/banners/:id', adminRequired, async (req, res) => {
  const key = String(req.params.id || '').trim();
  const doc = await Banner.findOne({ $or: [{ slot: key }, { _id: normalizeObjectId(key) || undefined }] });
  if (!doc) return res.status(404).json({ ok: false, error: 'not_found' });
  return res.json(normalizeBannerForResponse(doc));
});

app.post('/api/admin/banners/bulk', adminRequired, async (req, res) => {
  try {
    const banners = parseBannerInput(req.body || {});
    if (!banners.length) return res.status(400).json({ ok: false, error: 'Nenhum banner enviado' });
    const saved = [];
    for (const item of banners) {
      const payload = normalizeBannerPayload(item);
      if (!payload.slot) continue;
      const doc = await Banner.findOneAndUpdate(
        { slot: payload.slot },
        { $set: payload },
        { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
      );
      saved.push(doc);
    }
    return res.json({ ok: true, count: saved.length, banners: saved.map(normalizeBannerForResponse) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'banner_bulk_save_failed' });
  }
});

app.post('/api/banners/bulk', adminRequired, async (req, res) => {
  req.url = '/api/admin/banners/bulk';
  return app._router.handle(req, res, () => {});
});

app.post('/api/admin/banners', adminRequired, async (req, res) => {
  try {
    const banners = parseBannerInput(req.body || {});
    if (banners.length) {
      req.body = { banners };
      req.url = '/api/admin/banners/bulk';
      return app._router.handle(req, res, () => {});
    }
    const payload = normalizeBannerPayload(req.body || {});
    if (!payload.slot) return res.status(400).json({ ok: false, error: 'slot_required' });
    const doc = await Banner.findOneAndUpdate(
      { slot: payload.slot },
      { $set: payload },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
    return res.json(normalizeBannerForResponse(doc));
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'banner_save_failed' });
  }
});
app.get('/api/addresses', authRequired, async (req, res) => res.json((await Address.find({ userId: req.user._id }).sort({ isDefault: -1, createdAt: -1 })).map(toJSON)));
app.post('/api/addresses', authRequired, async (req, res) => { const body = req.body || {}; if (body.isDefault) await Address.updateMany({ userId: req.user._id }, { $set: { isDefault: false } }); const doc = await Address.create({ userId: req.user._id, name: body.name || '', phone: body.phone || '', cep: body.cep || '', logradouro: body.logradouro || '', numero: body.numero || '', bairro: body.bairro || '', cidade: body.cidade || '', uf: body.uf || '', complemento: body.complemento || '', reference: body.reference || '', isDefault: body.isDefault === true }); return res.json({ ok: true, address: toJSON(doc) }); });
app.delete('/api/addresses/:id', authRequired, async (req, res) => { const oid = normalizeObjectId(req.params.id); if (!oid) return res.status(400).json({ ok: false, error: 'ID inválido' }); await Address.deleteOne({ _id: oid, userId: req.user._id }); return res.json({ ok: true }); });

function normalizeOrderItemsForCheckout(body = {}) {
  const method = String(body?.payment?.method || body?.paymentMethod || body?.totals?.paymentMethod || '').toLowerCase();
  const credit = isCreditCardPayment(method);
  return ensureArray(body.items).map((item) => {
    const qty = Math.max(1, Number(item.qty || item.quantity || 1) || 1);
    const rawBase = Number(item.sellerBaseUnitPrice || item.sellerBasePrice || item.basePrice || item.pixPrice || item.price || item.preco || 0) || 0;
    const baseUnit = roundMoney(rawBase);
    const cardUnit = sellerBaseToMarketplacePrice(baseUnit);
    const unitPrice = credit ? cardUnit : baseUnit;
    const sellerBaseTotal = roundMoney(baseUnit * qty);
    const totalPrice = roundMoney(unitPrice * qty);
    return {
      productId: String(item.productId || item._id || item.id || '').trim(),
      sellerId: String(item.sellerId || '').trim(),
      name: item.name || item.nome || '',
      sku: item.sku || '',
      qty,
      unitPrice,
      totalPrice,
      sellerBaseUnitPrice: baseUnit,
      sellerBaseTotal,
      cardMarkupUnit: credit ? roundMoney(cardUnit - baseUnit) : 0,
      cardMarkupTotal: credit ? roundMoney(totalPrice - sellerBaseTotal) : 0,
      image: item.image || item.imageUrl || item.imagem || ''
    };
  });
}

async function forceOrderItemsSellerBaseFromProducts(items = [], body = {}) {
  const method = String(body?.payment?.method || body?.paymentMethod || body?.totals?.paymentMethod || '').toLowerCase();
  const credit = isCreditCardPayment(method);
  const ids = Array.from(new Set(
    ensureArray(items)
      .map((item) => String(item.productId || item._id || item.id || '').trim())
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
  ));

  if (!ids.length) return items;

  const products = await Product.find({ _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } })
    .select('_id name sku sellerId image imageUrl mainImageUrl price preco pixPrice sellerBasePrice sellerBaseUnitPrice basePrice precoBaseSeller precoSeller')
    .lean();

  const productMap = new Map(products.map((p) => [String(p._id), p]));

  for (const item of ensureArray(items)) {
    const qty = Math.max(1, Number(item.qty || item.quantity || 1) || 1);
    const productId = String(item.productId || item._id || item.id || '').trim();
    const product = productMap.get(productId);
    if (!product) continue;

    const baseUnit = getProductSellerBasePrice(product);
    if (baseUnit <= 0) continue;

    const chargedUnit = credit ? sellerBaseToMarketplacePrice(baseUnit) : baseUnit;
    const sellerBaseTotal = roundMoney(baseUnit * qty);
    const totalPrice = roundMoney(chargedUnit * qty);

    item.name = item.name || product.name || '';
    item.sku = item.sku || product.sku || '';
    item.sellerId = item.sellerId || product.sellerId || '';
    item.image = item.image || product.imageUrl || product.image || product.mainImageUrl || '';

    // Regra principal do marketplace:
    // O seller recebe sobre o preço original/base do produto cadastrado no MongoDB.
    // O acréscimo do cartão fica separado em cardMarkup e NÃO entra no repasse do seller.
    item.sellerBaseUnitPrice = baseUnit;
    item.sellerBaseTotal = sellerBaseTotal;
    item.unitPrice = chargedUnit;
    item.totalPrice = totalPrice;
    item.cardMarkupUnit = credit ? roundMoney(chargedUnit - baseUnit) : 0;
    item.cardMarkupTotal = credit ? roundMoney(totalPrice - sellerBaseTotal) : 0;
  }

  return items;
}
async function reserveStockForOrderItems(items = []) {
  const reserved = [];
  try {
    for (const item of items) {
      const oid = normalizeObjectId(item.productId);
      if (!oid) {
        const err = new Error(`Produto inválido no carrinho: ${item.name || item.productId || 'sem identificação'}`);
        err.statusCode = 400;
        throw err;
      }

      const qty = Math.max(1, Number(item.qty || 1) || 1);
      const product = await Product.findOneAndUpdate(
        { _id: oid, active: { $ne: false }, stock: { $gte: qty } },
        { $inc: { stock: -qty }, $set: { updatedAt: now() } },
        { new: true }
      );

      if (!product) {
        const current = await Product.findById(oid).select('name stock active');
        const available = Number(current?.stock || 0);
        const productName = current?.name || item.name || 'Produto';
        const err = new Error(available <= 0
          ? `${productName} está sem estoque no momento.`
          : `${productName} possui apenas ${available} unidade(s) em estoque.`);
        err.statusCode = 409;
        err.code = 'INSUFFICIENT_STOCK';
        err.productId = String(oid);
        err.availableStock = available;
        throw err;
      }

      reserved.push({ productId: String(oid), qty });
      item.name = item.name || product.name || '';
      item.sku = item.sku || product.sku || '';
      item.sellerId = item.sellerId || product.sellerId || '';
      item.image = item.image || product.imageUrl || product.image || product.mainImageUrl || '';
      if (!item.sellerBaseUnitPrice) {
        item.sellerBaseUnitPrice = roundMoney(product.price || item.unitPrice || 0);
        item.sellerBaseTotal = roundMoney(item.sellerBaseUnitPrice * qty);
      }
    }
    return reserved;
  } catch (error) {
    for (const row of reserved.reverse()) {
      try {
        await Product.findByIdAndUpdate(row.productId, { $inc: { stock: row.qty }, $set: { updatedAt: now() } });
      } catch (_rollbackError) {}
    }
    throw error;
  }
}

app.post('/api/orders', async (req, res) => {
  let reservedStock = [];
  try {
    const body = req.body || {};
    const items = normalizeOrderItemsForCheckout(body);

    if (!items.length) {
      return res.status(400).json({ ok: false, error: 'Carrinho vazio. Adicione ao menos um produto para finalizar a compra.' });
    }

    reservedStock = await reserveStockForOrderItems(items);
    await forceOrderItemsSellerBaseFromProducts(items, body);

    const subtotal = items.reduce((sum, item) => sum + Number(item.totalPrice || 0), 0);
    const shippingCost = Number(body.shippingCost || body.shipping?.price || 0);
    const montagemCost = Number(body.montagemCost || 0);
    const total = Number(body.total || (subtotal + shippingCost + montagemCost));
    const sellerIds = Array.from(new Set(items.map(item => item.sellerId).filter(Boolean)));

    const shipping = body.shipping || {};
    if (shipping && !shipping.prazo && (shipping.deadlineDays || shipping.deliveryTime || shipping.prazoEntrega)) {
      shipping.prazo = shipping.deliveryTime || shipping.prazoEntrega || `${shipping.deadlineDays} dia(s) úteis`;
    }

    const order = await Order.create({
      userId: normalizeObjectId(body.userId) || null,
      sellerIds,
      customerName: body.customerName || body.customer?.name || '',
      customerEmail: body.customerEmail || body.customer?.email || '',
      customerPhone: body.customerPhone || body.customer?.phone || '',
      status: body.status || 'pendente',
      statusLabel: body.statusLabel || body.status || 'pendente',
      items,
      subtotal,
      shippingCost,
      montagemCost,
      total,
      payment: body.payment || {},
      shippingAddress: body.shippingAddress || {},
      shipping,
      notes: body.notes || '',
      manufacturer: body.manufacturer || sellerIds[0] || ''
    });

    // Pedido criado no checkout ainda NÃƒO é venda concluída.
    // Não notifica admin/seller/WhatsApp e não envia ao fabricante antes do pagamento aprovado.
    // A notificação de "Nova venda recebida" fica centralizada no helper notifySaleAfterPaymentApproved().
    return res.json({ ok: true, order: toJSON(order), adminWhatsapp: { skipped: true, reason: 'waiting_payment_approval' } });
  } catch (error) {
    if (reservedStock.length && error?.code !== 'INSUFFICIENT_STOCK') {
      for (const row of reservedStock.reverse()) {
        try { await Product.findByIdAndUpdate(row.productId, { $inc: { stock: row.qty }, $set: { updatedAt: now() } }); } catch (_rollbackError) {}
      }
    }
    const statusCode = Number(error.statusCode || 500);
    return res.status(statusCode).json({
      ok: false,
      error: error.message || 'Erro ao criar pedido',
      code: error.code || undefined,
      productId: error.productId || undefined,
      availableStock: error.availableStock ?? undefined
    });
  }
});
app.get('/api/orders/me', authRequired, async (req, res) => res.json((await Order.find({ userId: req.user._id }).sort({ createdAt: -1 })).map(toJSON)));
app.get('/api/pedidos/meus', authRequired, async (req, res) => res.json((await Order.find({ userId: req.user._id }).sort({ createdAt: -1 })).map(toJSON)));
app.get('/api/users/:id/pedidos', authRequired, async (req, res) => {
  try {
    const requestedId = String(req.params.id || '').trim();
    const currentId = String(req.user._id || '').trim();
    if (req.user.role === 'customer' && requestedId && requestedId !== currentId) {
      return res.status(403).json({ ok: false, error: 'Sem permissão' });
    }
    const userObjectId = normalizeObjectId(requestedId) || req.user._id;
    return res.json((await Order.find({ userId: userObjectId }).sort({ createdAt: -1 })).map(toJSON));
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar pedidos' });
  }
});
app.get('/api/orders/:id', authRequired, async (req, res) => { const oid = normalizeObjectId(req.params.id); if (!oid) return res.status(400).json({ ok: false, error: 'ID inválido' }); const row = await Order.findById(oid); if (!row) return res.status(404).json({ ok: false, error: 'Pedido não encontrado' }); if (req.user.role === 'customer' && String(row.userId || '') !== String(req.user._id)) return res.status(403).json({ ok: false, error: 'Sem permissão' }); return res.json(toJSON(row)); });
app.patch('/api/orders/:id/status', authRequired, async (req, res) => {
  try {
    const oid = normalizeObjectId(req.params.id);
    if (!oid) return res.status(400).json({ ok: false, error: 'ID inválido' });

    const before = await Order.findById(oid);
    if (!before) return res.status(404).json({ ok: false, error: 'Pedido não encontrado' });

    const previousStatus = String(before.status || '');
    const patch = {
      status: req.body?.status || before.status,
      statusLabel: req.body?.statusLabel || req.body?.status || before.statusLabel,
      trackingCode: req.body?.trackingCode !== undefined ? req.body.trackingCode : before.trackingCode
    };

    const after = await Order.findByIdAndUpdate(oid, { $set: patch }, { new: true });

    await writeAuditLog({
      scope: 'orders',
      eventType: 'order_status_updated',
      orderId: String(after._id),
      status: 'success',
      changedKeys: changedKeys(toJSON(before), toJSON(after)),
      metadata: { actorUserId: String(req.user._id) }
    });

    if (String(after.status || '') !== previousStatus || String(after.trackingCode || '') !== String(before.trackingCode || '')) {
      await createAdminNotification({
        type: 'order_updated',
        title: '📦 Pedido atualizado',
        message: `Pedido ${after._id} mudou para ${after.statusLabel || after.status || 'Atualizado'}${after.trackingCode ? ` - Rastreio: ${after.trackingCode}` : ''}`,
        relatedId: String(after._id),
        severity: 'info'
      });
      await createSellerOrderNotifications(after, {
        type: 'seller_order_updated',
        title: '📦 Pedido atualizado',
        message: `Pedido #${String(after._id).slice(-8).toUpperCase()} mudou para ${after.statusLabel || after.status || 'Atualizado'}${after.trackingCode ? ` - Rastreio: ${after.trackingCode}` : ''}`,
        severity: 'info',
        origin: 'status_route'
      });
    }

    const notifyResult = await waMaybeNotifyOrderStatusChange(String(after._id), toJSON(before), toJSON(after), 'status_route');
    const adminWhatsapp = await waNotifyAdminOrderStatusChange(String(after._id), toJSON(before), toJSON(after), 'status_route_admin');
    return res.json({ ok: true, order: toJSON(after), whatsapp: notifyResult, adminWhatsapp });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao atualizar status do pedido' });
  }
});
app.get('/api/seller/orders', authRequired, async (req, res) => { const sellerId = String(req.query.sellerId || req.user.sellerId || '').trim(); return res.json((await Order.find({ sellerIds: sellerId }).sort({ createdAt: -1 })).map(toJSON)); });
app.post('/api/tickets', async (req, res) => { const body = req.body || {}; const doc = await Ticket.create({ userId: normalizeObjectId(body.userId) || null, orderId: body.orderId || null, protocolo: body.protocolo || `TK-${Date.now()}`, tipo: body.tipo || 'Suporte', assunto: body.assunto || '', mensagem: body.mensagem || body.message || '', status: body.status || 'Novo', origem: body.origem || 'site', nome: body.nome || body.name || '', email: body.email || '', telefone: body.telefone || body.phone || '', metadata: body.metadata || {} }); return res.json({ ok: true, ticket: toJSON(doc) }); });
app.get('/api/tickets', authRequired, async (req, res) => { const query = req.user.role === 'admin' ? {} : { userId: req.user._id }; return res.json((await Ticket.find(query).sort({ createdAt: -1 })).map(toJSON)); });
app.post('/api/contact', async (req, res) => res.json({ ok: true, contact: toJSON(await Contact.create({ name: req.body?.name || '', email: req.body?.email || '', phone: req.body?.phone || '', subject: req.body?.subject || '', message: req.body?.message || '', source: 'fale_conosco' })) }));
app.post('/api/denuncias', async (req, res) => res.json({ ok: true, denuncia: toJSON(await Denuncia.create({ userId: normalizeObjectId(req.body?.userId) || null, productId: req.body?.productId || null, sellerId: req.body?.sellerId || null, motivo: req.body?.motivo || '', descricao: req.body?.descricao || '', status: 'nova', nome: req.body?.nome || '', email: req.body?.email || '' })) }));
app.get('/api/admin/stats', adminRequired, async (_req, res) => { const [totalPedidos, totalClientes, totalProdutos] = await Promise.all([Order.countDocuments(), User.countDocuments({ role: 'customer' }), Product.countDocuments()]); const faturamentoAgg = await Order.aggregate([{ $match: { status: { $in: ['pago', 'enviado', 'entregue'] } } }, { $group: { _id: null, total: { $sum: '$total' } } }]); const pendentes = await Order.countDocuments({ status: 'pendente' }); return res.json({ faturamentoTotal: faturamentoAgg[0]?.total || 0, pedidosPendentes: pendentes, totalClientes, totalPedidos, totalProdutos }); });


// ============================================================
// PAINEL DE LOGÍSTICA / GERAÇÃO DE ETIQUETAS
// Fase 1: painel manual inteligente, pronto para integrações.
// ============================================================
function normalizeLogisticsLabel(doc) {
  const obj = toJSON(doc) || {};
  return {
    ...obj,
    id: String(obj.id || obj._id || ''),
    orderId: String(obj.orderId || ''),
    provider: String(obj.provider || 'manual'),
    service: String(obj.service || ''),
    status: String(obj.status || 'gerada'),
    trackingCode: String(obj.trackingCode || ''),
    shippingCost: Number(obj.shippingCost || 0),
    volumes: Number(obj.volumes || 1),
    weightKg: Number(obj.weightKg || 0),
    heightCm: Number(obj.heightCm || 0),
    widthCm: Number(obj.widthCm || 0),
    lengthCm: Number(obj.lengthCm || 0),
    notes: String(obj.notes || ''),
    labelUrl: String(obj.labelUrl || '')
  };
}

function getOrderAddress(order = {}) {
  const a = order.shippingAddress || order.address || order.endereco || {};
  return {
    name: a.name || a.nome || order.customerName || '',
    phone: a.phone || a.telefone || order.customerPhone || '',
    cep: normalizeCepValue(a.cep || a.zip || ''),
    logradouro: a.logradouro || a.street || a.rua || '',
    numero: a.numero || a.number || '',
    bairro: a.bairro || a.district || '',
    cidade: a.cidade || a.city || '',
    uf: a.uf || a.state || '',
    complemento: a.complemento || a.complement || '',
    reference: a.reference || a.referencia || ''
  };
}

function orderItemsSummary(order = {}) {
  return ensureArray(order.items).map((item) => {
    const qty = Number(item.qty || item.quantity || 1);
    const name = String(item.name || item.nome || item.title || 'Produto').trim();
    return `${qty}x ${name}`;
  }).join(' | ');
}

function escapeHtmlBasic(value = '') {
  return String(value || '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function buildManualLogisticsLabelHtml(orderDoc = {}, labelDoc = {}) {
  const order = toJSON(orderDoc) || orderDoc || {};
  const label = normalizeLogisticsLabel(labelDoc);
  const address = getOrderAddress(order);
  const orderId = String(order.id || order._id || label.orderId || '');
  const shortId = orderId ? orderId.slice(-8).toUpperCase() : 'SEM-ID';
  const sellerNames = ensureArray(order.items).map((i) => String(i.sellerName || i.sellerId || '').trim()).filter(Boolean);
  const seller = sellerNames[0] || order.manufacturer || 'Ariana Móveis';
  const items = orderItemsSummary(order);
  const dims = [label.lengthCm, label.widthCm, label.heightCm].filter(v => Number(v) > 0).join(' x ');
  const generatedAt = new Date().toLocaleString('pt-BR');

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Etiqueta ${shortId}</title>
  <style>
    *{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;margin:0;background:#f3f4f6;color:#111827}.page{max-width:760px;margin:20px auto;background:white;border:1px solid #111;padding:18px}.top{display:flex;justify-content:space-between;gap:12px;border-bottom:2px solid #111;padding-bottom:12px}.brand{font-size:24px;font-weight:900;color:#0047AB}.tag{border:2px solid #111;padding:10px 14px;text-align:center;font-weight:900;font-size:18px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}.box{border:1px solid #111;padding:12px;min-height:110px}.box h3{margin:0 0 8px;font-size:13px;text-transform:uppercase}.line{margin:5px 0;font-size:14px}.big{font-size:22px;font-weight:900}.barcode{font-family:monospace;text-align:center;border:1px dashed #111;padding:12px;margin-top:12px;font-size:24px;letter-spacing:2px}.footer{margin-top:12px;font-size:12px;color:#374151}.actions{margin:16px auto;max-width:760px;text-align:right}.actions button{padding:10px 16px;border:0;border-radius:10px;background:#0047AB;color:white;font-weight:800;cursor:pointer}@media print{body{background:white}.page{margin:0;border:1px solid #111}.actions{display:none}}
  </style></head><body><div class="actions"><button onclick="window.print()">Imprimir etiqueta</button></div><main class="page">
    <div class="top"><div><div class="brand">Ariana Móveis</div><div>Etiqueta / Romaneio de logística</div></div><div class="tag">${escapeHtmlBasic(label.provider).toUpperCase()}<br><small>${escapeHtmlBasic(label.service || 'Manual')}</small></div></div>
    <div class="grid">
      <section class="box"><h3>Destinatário</h3><div class="big">${escapeHtmlBasic(address.name || order.customerName || 'Cliente')}</div><div class="line">${escapeHtmlBasic(address.phone || order.customerPhone || '')}</div><div class="line">${escapeHtmlBasic(address.logradouro)} ${escapeHtmlBasic(address.numero)}</div><div class="line">${escapeHtmlBasic(address.bairro)} ${address.complemento ? ' - ' + escapeHtmlBasic(address.complemento) : ''}</div><div class="line">${escapeHtmlBasic(address.cidade)} / ${escapeHtmlBasic(address.uf)} - CEP ${escapeHtmlBasic(address.cep)}</div>${address.reference ? `<div class="line">Ref.: ${escapeHtmlBasic(address.reference)}</div>` : ''}</section>
      <section class="box"><h3>Pedido / Envio</h3><div class="line"><b>Pedido:</b> #${escapeHtmlBasic(shortId)}</div><div class="line"><b>Rastreio:</b> ${escapeHtmlBasic(label.trackingCode || 'A preencher')}</div><div class="line"><b>Status:</b> ${escapeHtmlBasic(label.status)}</div><div class="line"><b>Vendedor:</b> ${escapeHtmlBasic(seller)}</div><div class="line"><b>Valor frete:</b> ${formatMoneyBRL(label.shippingCost || order.shippingCost || 0)}</div></section>
    </div>
    <section class="box" style="margin-top:12px"><h3>Produtos</h3><div class="line">${escapeHtmlBasic(items || 'Produtos do pedido')}</div></section>
    <div class="grid"><section class="box"><h3>Volumes</h3><div class="line"><b>Volumes:</b> ${label.volumes || 1}</div><div class="line"><b>Peso:</b> ${label.weightKg || 0} kg</div><div class="line"><b>Dimensões:</b> ${escapeHtmlBasic(dims || 'não informado')} cm</div></section><section class="box"><h3>Observações</h3><div class="line">${escapeHtmlBasic(label.notes || 'Sem observações.')}</div></section></div>
    <div class="barcode">*${escapeHtmlBasic(label.trackingCode || shortId)}*</div>
    <div class="footer">Gerado em ${escapeHtmlBasic(generatedAt)}. Esta etiqueta manual deixa o painel pronto para integração com Correios, Frenet e transportadoras parceiras.</div>
  </main></body></html>`;
}

function inferLogisticsProvider(order = {}) {
  const shipping = order.shipping || order.payment?.shipping || {};
  const provider = String(shipping.provider || shipping.carrier || shipping.transportadora || '').trim();
  const service = String(shipping.service || shipping.label || shipping.name || '').trim();
  const text = `${provider} ${service}`.toLowerCase();
  if (text.includes('correio') || text.includes('sedex') || text.includes('pac')) return 'correios';
  if (text.includes('frenet')) return 'frenet';
  if (text.includes('rodocap')) return 'rodocap';
  if (text.includes('ariana')) return 'ariana_local';
  return provider || 'manual';
}

function hasCorreiosPrepostagemConfig(settings = {}) {
  const cfg = correiosCfg(settings || {});
  return Boolean(cfg.user && cfg.pass && cfg.cartao && (process.env.CORREIOS_PREPOSTAGEM_URL || process.env.CORREIOS_PRE_POSTAGEM_URL));
}

function hasFrenetOrderConfig(settings = {}) {
  const frenet = settings?.carriers?.frenet || {};
  return Boolean(String(frenet.token || process.env.FRENET_TOKEN || process.env.FRENET_API_TOKEN || '').trim() && (process.env.FRENET_ORDER_URL || process.env.FRENET_ORDERS_URL));
}

function extractProviderTrackingCode(data = {}) {
  const candidates = [
    data.codigoObjeto,
    data.codigoRastreamento,
    data.trackingCode,
    data.tracking_code,
    data.TrackingCode,
    data.objectCode,
    data?.prepostagem?.codigoObjeto,
    data?.prepostagem?.codigoRastreamento,
    data?.data?.codigoObjeto,
    data?.data?.codigoRastreamento,
    data?.data?.trackingCode,
    data?.order?.trackingCode,
    data?.Order?.TrackingCode,
    data?.Shipping?.TrackingCode
  ];
  for (const item of candidates) {
    const value = String(item || '').trim();
    if (value) return value;
  }
  return '';
}

function extractProviderLabelUrl(data = {}) {
  const candidates = [
    data.labelUrl,
    data.label_url,
    data.urlRotulo,
    data.rotuloUrl,
    data.urlEtiqueta,
    data.etiquetaUrl,
    data?.prepostagem?.urlRotulo,
    data?.data?.urlRotulo,
    data?.data?.labelUrl,
    data?.order?.labelUrl,
    data?.Order?.LabelUrl,
    data?.Shipping?.LabelUrl
  ];
  for (const item of candidates) {
    const value = String(item || '').trim();
    if (value) return value;
  }
  return '';
}

function buildLogisticsShipmentPayload(orderDoc = {}, body = {}, provider = '') {
  const order = toJSON(orderDoc) || orderDoc || {};
  const address = getOrderAddress(order);
  const items = ensureArray(order.items).map((item) => ({
    productId: String(item.productId || item.id || ''),
    sku: String(item.sku || ''),
    name: String(item.name || item.nome || item.title || 'Produto'),
    quantity: Number(item.qty || item.quantity || 1),
    unitPrice: Number(item.unitPrice || item.price || 0),
    totalPrice: Number(item.totalPrice || 0)
  }));

  return {
    provider,
    orderId: String(order._id || order.id || ''),
    orderCode: String(order._id || order.id || '').slice(-8).toUpperCase(),
    service: String(body.service || body.servico || order.shipping?.service || order.shipping?.label || ''),
    invoiceValue: Number(body.invoiceValue || body.valorNota || order.total || order.subtotal || 0),
    shippingCost: Number(body.shippingCost || order.shippingCost || 0),
    volumes: Math.max(1, Number(body.volumes || 1)),
    weightKg: Number(body.weightKg || body.pesoKg || order.weightKg || 0),
    dimensions: {
      lengthCm: Number(body.lengthCm || body.comprimentoCm || order.lengthCm || 0),
      widthCm: Number(body.widthCm || body.larguraCm || order.widthCm || 0),
      heightCm: Number(body.heightCm || body.alturaCm || order.heightCm || 0)
    },
    sender: {
      name: process.env.LOJA_REMETENTE_NOME || 'Ariana Móveis',
      phone: process.env.LOJA_REMETENTE_TELEFONE || '',
      document: process.env.LOJA_REMETENTE_DOCUMENTO || process.env.CORREIOS_CNPJ || '',
      cep: normalizeCepValue(process.env.LOJA_ORIGEM_CEP || ''),
      address: process.env.LOJA_REMETENTE_ENDERECO || '',
      number: process.env.LOJA_REMETENTE_NUMERO || '',
      district: process.env.LOJA_REMETENTE_BAIRRO || '',
      city: process.env.LOJA_REMETENTE_CIDADE || 'Guanhães',
      state: process.env.LOJA_REMETENTE_UF || 'MG'
    },
    recipient: {
      name: address.name || order.customerName || 'Cliente',
      phone: address.phone || order.customerPhone || '',
      email: order.customerEmail || '',
      document: order.customerCpf || order.cpf || '',
      cep: normalizeCepValue(address.cep || ''),
      address: address.logradouro || '',
      number: address.numero || 'S/N',
      complement: address.complemento || '',
      district: address.bairro || '',
      city: address.cidade || '',
      state: address.uf || ''
    },
    items,
    notes: String(body.notes || body.observacoes || '').trim()
  };
}

function isProviderBaseUrlOnly(endpoint = '', provider = '') {
  const value = String(endpoint || '').trim().replace(/\/+$/, '');
  if (!value) return true;

  try {
    const url = new URL(value);
    const host = String(url.hostname || '').toLowerCase();
    const pathname = String(url.pathname || '').replace(/\/+$/, '');

    if (provider === 'correios') {
      return host === 'api.correios.com.br' && (!pathname || pathname === '');
    }

    if (provider === 'frenet') {
      return host === 'api.frenet.com.br' && (!pathname || pathname === '');
    }
  } catch (_error) {
    return false;
  }

  return false;
}

function stringifyProviderError(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return String(value);
  }
}

function buildProviderPreparedFallback({
  provider = 'correios',
  shipment = {},
  quote = {},
  trackingCode = '',
  payload = {},
  reason = '',
  providerError = null,
  statusCode = null,
  providerData = null
} = {}) {
  const isCorreios = provider === 'correios';
  const providerName = isCorreios ? 'Correios' : 'Frenet';
  const providerErrorText = stringifyProviderError(providerError).slice(0, 4000);

  return {
    ok: true,
    preparedOnly: true,
    providerFallback: true,
    message: `${providerName} indisponível ou endpoint oficial não configurado corretamente. Romaneio/etiqueta interna preparada para impressão manual.`,
    trackingCode: String(trackingCode || '').trim(),
    labelUrl: '',
    payload: payload || shipment,
    quote,
    raw: {
      skippedProviderCall: true,
      reason,
      statusCode,
      providerError: providerErrorText,
      providerData: providerData || null
    }
  };
}

function pickCorreiosServiceCode(body = {}, shipment = {}) {
  const raw = String(body.shippingServiceCode || body.serviceCode || body.codigoServico || body.coProduto || body.service || shipment.service || '').trim();
  if (/^\d{5}$/.test(raw)) return raw;
  const normalized = normalizeShippingText(raw);
  if (normalized.includes('SEDEX')) return '03328';
  if (normalized.includes('PAC')) return '03298';
  const cfgServices = parseServices(process.env.CORREIOS_SERVICOS || '03298,03328');
  return cfgServices[0] || '03298';
}

function splitAddressNumber(address = '', fallbackNumber = '') {
  const text = String(address || '').trim();
  const fallback = String(fallbackNumber || '').trim() || 'S/N';
  if (!text) return { logradouro: '', numero: fallback };
  const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const numero = String(parts[1] || fallback).replace(/[^0-9A-Za-z\-\/]/g, '').trim() || fallback;
    return { logradouro: parts[0], numero };
  }
  return { logradouro: text, numero: fallback };
}

function buildCorreiosPrepostagemPayload(orderDoc = {}, body = {}, shipment = {}, quote = {}) {
  const settings = body.settings || {};
  const cfg = correiosCfg(settings);
  const serviceCode = pickCorreiosServiceCode(body, shipment);
  const bestQuote = quote?.bestQuote || (Array.isArray(quote?.quotes) ? quote.quotes.find((q) => String(q.service) === serviceCode) || quote.quotes[0] : null) || {};
  const declaredValue = Number(body.valorDeclarado || body.invoiceValue || body.productPrice || shipment.invoiceValue || 0) || 0;
  const shippingPrice = Number(body.shippingCost || bestQuote.price || shipment.shippingCost || 0) || 0;
  const weightKg = Number(shipment.weightKg || body.weightKg || body.pesoKg || 1) || 1;
  const pesoGramas = Number(toGrams(weightKg) || 1000);
  const lengthCm = Number(shipment.dimensions?.lengthCm || body.lengthCm || body.comprimentoCm || 20) || 20;
  const widthCm = Number(shipment.dimensions?.widthCm || body.widthCm || body.larguraCm || 20) || 20;
  const heightCm = Number(shipment.dimensions?.heightCm || body.heightCm || body.alturaCm || 20) || 20;
  const senderAddress = splitAddressNumber(shipment.sender?.address, shipment.sender?.number);
  const recipientAddress = splitAddressNumber(shipment.recipient?.address, shipment.recipient?.number);
  const orderCode = String(shipment.orderCode || shipment.orderId || uid('ord')).slice(-20);

  const itensDeclaracaoConteudo = ensureArray(shipment.items).length ? ensureArray(shipment.items).map((item) => ({
    conteudo: String(item.name || item.sku || 'Produto').slice(0, 120),
    quantidade: String(Math.max(1, Number(item.quantity || 1))),
    valor: Number(item.totalPrice || item.unitPrice || declaredValue || 1).toFixed(2)
  })) : [{ conteudo: 'Produto Ariana Móveis', quantidade: '1', valor: Number(declaredValue || 1).toFixed(2) }];

  const payload = {
    numeroCartaoPostagem: String(cfg.cartao || process.env.CORREIOS_CARTAO || '').trim(),
    codigoServico: serviceCode,
    precoServico: Number(shippingPrice || 0).toFixed(2),
    pesoInformado: String(pesoGramas),
    codigoFormatoObjetoInformado: '2',
    alturaInformada: String(Math.round(heightCm)),
    larguraInformada: String(Math.round(widthCm)),
    comprimentoInformado: String(Math.round(lengthCm)),
    diametroInformado: '0',
    modalidadePagamento: '2',
    logisticaReversa: 'N',
    remetente: {
      nome: String(shipment.sender?.name || 'Ariana Móveis').slice(0, 60),
      cpfCnpj: normalizeDigits(shipment.sender?.document || process.env.LOJA_REMETENTE_DOCUMENTO || ''),
      telefone: normalizeDigits(shipment.sender?.phone || process.env.LOJA_REMETENTE_TELEFONE || ''),
      cep: normalizeCepValue(shipment.sender?.cep || process.env.LOJA_ORIGEM_CEP || ''),
      logradouro: senderAddress.logradouro || String(process.env.LOJA_REMETENTE_ENDERECO || '').slice(0, 80),
      numero: senderAddress.numero || String(process.env.LOJA_REMETENTE_NUMERO || 'S/N'),
      complemento: String(process.env.LOJA_REMETENTE_COMPLEMENTO || '').slice(0, 60),
      bairro: String(shipment.sender?.district || process.env.LOJA_REMETENTE_BAIRRO || '').slice(0, 60),
      cidade: String(shipment.sender?.city || process.env.LOJA_REMETENTE_CIDADE || 'Guanhães').slice(0, 60),
      uf: String(shipment.sender?.state || process.env.LOJA_REMETENTE_UF || 'MG').slice(0, 2).toUpperCase()
    },
    destinatario: {
      nome: String(shipment.recipient?.name || 'Cliente').slice(0, 60),
      cpfCnpj: normalizeDigits(shipment.recipient?.document || ''),
      telefone: normalizeDigits(shipment.recipient?.phone || ''),
      email: String(shipment.recipient?.email || '').slice(0, 80),
      cep: normalizeCepValue(shipment.recipient?.cep || ''),
      logradouro: recipientAddress.logradouro.slice(0, 80),
      numero: recipientAddress.numero || 'S/N',
      complemento: String(shipment.recipient?.complement || '').slice(0, 60),
      bairro: String(shipment.recipient?.district || '').slice(0, 60),
      cidade: String(shipment.recipient?.city || '').slice(0, 60),
      uf: String(shipment.recipient?.state || '').slice(0, 2).toUpperCase()
    },
    itensDeclaracaoConteudo,
   observacao: `Pedido ${orderCode}`.slice(0, 50),
    idAtendimento: orderCode
  };

  if (declaredValue > 0) {
    payload.listaServicoAdicional = [{ codigoServicoAdicional: '019', valorDeclarado: Number(declaredValue).toFixed(2) }];
  }

  Object.keys(payload.remetente).forEach((key) => { if (payload.remetente[key] === '') delete payload.remetente[key]; });
  Object.keys(payload.destinatario).forEach((key) => { if (payload.destinatario[key] === '') delete payload.destinatario[key]; });
  return payload;
}


async function callCorreiosPrepostagem(orderDoc = {}, body = {}) {
  const settings = await getShippingSettings();
  const endpoint = String(process.env.CORREIOS_PREPOSTAGEM_URL || process.env.CORREIOS_PRE_POSTAGEM_URL || '').trim();
  const shipment = buildLogisticsShipmentPayload(orderDoc, body, 'correios');

  const quotePayload = {
    cepDestino: shipment.recipient.cep,
    weightKg: shipment.weightKg || undefined,
    lengthCm: shipment.dimensions.lengthCm || undefined,
    widthCm: shipment.dimensions.widthCm || undefined,
    heightCm: shipment.dimensions.heightCm || undefined,
    productPrice: shipment.invoiceValue,
    shippingServiceCode: body.shippingServiceCode || body.serviceCode || body.service || undefined
  };

  const quote = await quoteCorreios(quotePayload, settings).catch((error) => ({ ok: false, error: error.message || String(error) }));

  if (!endpoint) {
    return {
      ok: true,
      preparedOnly: true,
      message: 'Pré-postagem Correios preparada no pedido. Para enviar oficialmente aos Correios, configure CORREIOS_PREPOSTAGEM_URL no Render.',
      trackingCode: String(body.trackingCode || '').trim(),
      labelUrl: '',
      payload: shipment,
      quote,
      raw: { skippedProviderCall: true, reason: 'CORREIOS_PREPOSTAGEM_URL ausente' }
    };
  }

  if (isProviderBaseUrlOnly(endpoint, 'correios')) {
    return buildProviderPreparedFallback({
      provider: 'correios',
      shipment,
      quote,
      trackingCode: body.trackingCode,
      reason: 'CORREIOS_PREPOSTAGEM_URL aponta apenas para a URL base da API. Informe o endpoint específico de pré-postagem ou deixe vazio para usar romaneio interno.'
    });
  }

  const providerPayload = body.providerPayload && typeof body.providerPayload === 'object'
    ? body.providerPayload
    : buildCorreiosPrepostagemPayload(orderDoc, body, shipment, quote);

  const remetenteDocumento = normalizeDigits(providerPayload?.remetente?.cpfCnpj || '');
  if (!remetenteDocumento) {
    return buildProviderPreparedFallback({
      provider: 'correios',
      shipment,
      quote,
      trackingCode: body.trackingCode,
      payload: providerPayload,
      reason: 'Documento do remetente ausente. Configure LOJA_REMETENTE_DOCUMENTO ou CORREIOS_CNPJ no Render.',
      providerError: 'Remetente sem CPF/CNPJ no payload da pré-postagem.',
      statusCode: 400,
      providerData: { missingField: 'remetente.cpfCnpj' }
    });
  }

  try {
    const token = await getCorreiosToken(settings);
    const response = await axios.post(endpoint, providerPayload, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      timeout: Number(process.env.CORREIOS_PREPOSTAGEM_TIMEOUT_MS || 30000),
      validateStatus: () => true
    });

    const data = response.data || {};
    if (response.status < 200 || response.status >= 300) {
      const message = data?.message || data?.mensagem || data?.erro || data?.error || data?.errors || data?.msgs || data || `Correios pré-postagem HTTP ${response.status}`;
      console.error('[Correios pré-postagem HTTP erro]', {
        status: response.status,
        data,
        payload: providerPayload
      });
      return buildProviderPreparedFallback({
        provider: 'correios',
        shipment,
        quote,
        trackingCode: body.trackingCode,
        payload: providerPayload,
        reason: 'Correios retornou erro na pré-postagem. O pedido foi salvo como preparado internamente.',
        providerError: message,
        statusCode: response.status,
        providerData: data
      });
    }

    return {
      ok: true,
      preparedOnly: false,
      message: 'Pré-postagem Correios enviada ao provedor.',
      trackingCode: extractProviderTrackingCode(data) || String(body.trackingCode || '').trim(),
      labelUrl: extractProviderLabelUrl(data),
      payload: providerPayload,
      quote,
      raw: data
    };
  } catch (error) {
    return buildProviderPreparedFallback({
      provider: 'correios',
      shipment,
      quote,
      trackingCode: body.trackingCode,
      payload: providerPayload,
      reason: 'Falha ao comunicar com a API de pré-postagem dos Correios. O pedido foi salvo como preparado internamente.',
      providerError: error?.response?.data || error?.message || String(error),
      statusCode: error?.response?.status || null,
      providerData: error?.response?.data || null
    });
  }
}

async function callFrenetOrder(orderDoc = {}, body = {}) {
  const settings = await getShippingSettings();
  const frenet = settings?.carriers?.frenet || {};
  const token = String(frenet.token || process.env.FRENET_TOKEN || process.env.FRENET_API_TOKEN || '').trim();
  const endpoint = String(process.env.FRENET_ORDER_URL || process.env.FRENET_ORDERS_URL || '').trim();
  const shipment = buildLogisticsShipmentPayload(orderDoc, body, 'frenet');

  const quote = await quoteFrenet({
    cepDestino: shipment.recipient.cep,
    weightKg: shipment.weightKg || undefined,
    lengthCm: shipment.dimensions.lengthCm || undefined,
    widthCm: shipment.dimensions.widthCm || undefined,
    heightCm: shipment.dimensions.heightCm || undefined,
    productPrice: shipment.invoiceValue,
    shippingServiceCode: body.shippingServiceCode || body.serviceCode || body.service || undefined
  }, settings).catch((error) => ({ ok: false, error: error.message || String(error) }));

  if (!token) {
    return buildProviderPreparedFallback({
      provider: 'frenet',
      shipment,
      quote,
      trackingCode: body.trackingCode,
      reason: 'FRENET_TOKEN ausente. Pedido preparado internamente.'
    });
  }

  if (!endpoint) {
    return {
      ok: true,
      preparedOnly: true,
      message: 'Pedido Frenet preparado localmente. Para comprar/emitir etiqueta pela Frenet, configure FRENET_ORDER_URL no Render.',
      trackingCode: String(body.trackingCode || '').trim(),
      labelUrl: '',
      payload: shipment,
      quote,
      raw: { skippedProviderCall: true, reason: 'FRENET_ORDER_URL ausente' }
    };
  }

  if (isProviderBaseUrlOnly(endpoint, 'frenet')) {
    return buildProviderPreparedFallback({
      provider: 'frenet',
      shipment,
      quote,
      trackingCode: body.trackingCode,
      reason: 'FRENET_ORDER_URL aponta apenas para a URL base da API. Informe o endpoint específico de emissão/compra de frete ou deixe vazio para usar romaneio interno.'
    });
  }

  const providerPayload = body.providerPayload && typeof body.providerPayload === 'object'
    ? body.providerPayload
    : buildCorreiosPrepostagemPayload(orderDoc, body, shipment, quote);

  try {
    const response = await axios.post(endpoint, providerPayload, {
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', token },
      timeout: Number(process.env.FRENET_ORDER_TIMEOUT_MS || 30000),
      validateStatus: () => true
    });

    const data = response.data || {};
    if (response.status < 200 || response.status >= 300) {
      const message = data?.Message || data?.message || data?.error || `Frenet order HTTP ${response.status}`;
      return buildProviderPreparedFallback({
        provider: 'frenet',
        shipment,
        quote,
        trackingCode: body.trackingCode,
        payload: providerPayload,
        reason: 'Frenet retornou erro na emissão. O pedido foi salvo como preparado internamente.',
        providerError: message,
        statusCode: response.status
      });
    }

    return {
      ok: true,
      preparedOnly: false,
      message: 'Pedido/etiqueta Frenet enviado ao provedor.',
      trackingCode: extractProviderTrackingCode(data) || String(body.trackingCode || '').trim(),
      labelUrl: extractProviderLabelUrl(data),
      payload: providerPayload,
      quote,
      raw: data
    };
  } catch (error) {
    return buildProviderPreparedFallback({
      provider: 'frenet',
      shipment,
      quote,
      trackingCode: body.trackingCode,
      payload: providerPayload,
      reason: 'Falha ao comunicar com a API da Frenet. O pedido foi salvo como preparado internamente.',
      providerError: error?.response?.data?.Message || error?.response?.data?.message || error?.message || String(error),
      statusCode: error?.response?.status || null
    });
  }
}

async function saveProviderLogisticsResult({ order, body = {}, provider = 'manual', providerResult = {}, actor = 'admin', labelType = 'provider_prepared', origin = 'logistica_provider' } = {}) {
  const before = toJSON(order);
  const orderId = String(order._id || order.id || body.orderId || '');
  const service = String(body.service || body.servico || providerResult?.payload?.service || provider || '').trim();
  const trackingCode = String(providerResult.trackingCode || body.trackingCode || before.trackingCode || '').trim();
  const shippingCost = Number(body.shippingCost || providerResult?.quote?.quotes?.[0]?.price || before.shippingCost || 0);
  const patch = {
    orderId,
    orderObjectId: order._id,
    provider,
    service,
    status: providerResult.preparedOnly ? 'preparada' : 'emitida',
    trackingCode,
    shippingCost,
    volumes: Math.max(1, Number(body.volumes || 1)),
    weightKg: Number(body.weightKg || body.pesoKg || 0),
    heightCm: Number(body.heightCm || body.alturaCm || 0),
    widthCm: Number(body.widthCm || body.larguraCm || 0),
    lengthCm: Number(body.lengthCm || body.comprimentoCm || 0),
    notes: String(body.notes || body.observacoes || providerResult.message || '').trim(),
    labelType,
    labelUrl: String(providerResult.labelUrl || ''),
    rawProviderResponse: redact(providerResult.raw || providerResult),
    updatedBy: actor
  };

  let label = await LogisticsLabel.findOneAndUpdate(
    { orderId },
    { $set: patch, $setOnInsert: { createdBy: actor } },
    { upsert: true, new: true }
  );
  const html = buildManualLogisticsLabelHtml(order, label);
  label = await LogisticsLabel.findByIdAndUpdate(label._id, { $set: { labelHtml: html } }, { new: true });

  const orderPatch = {
    trackingCode,
    shippingCost: shippingCost || before.shippingCost || 0,
    shipping: {
      ...(before.shipping || {}),
      provider,
      service,
      labelId: String(label._id),
      labelStatus: patch.status,
      labelType: patch.labelType,
      labelUrl: patch.labelUrl,
      providerPreparedOnly: providerResult.preparedOnly === true,
      updatedAt: new Date().toISOString()
    }
  };
  if (String(body.markStatus || '').trim()) {
    orderPatch.status = String(body.markStatus).trim();
    orderPatch.statusLabel = String(body.markStatusLabel || body.markStatus).trim();
  } else if (providerResult.preparedOnly !== true) {
    orderPatch.status = before.status === 'entregue' ? before.status : 'preparando_envio';
    orderPatch.statusLabel = before.status === 'entregue' ? before.statusLabel : 'Preparando envio';
  }

  const after = await Order.findByIdAndUpdate(orderId, { $set: orderPatch }, { new: true });

  await writeAuditLog({
    scope: 'logistics',
    eventType: `${provider}_label_prepared`,
    orderId,
    status: 'success',
    request: { provider, body: redact(body), payload: redact(providerResult.payload || null) },
    response: redact(providerResult.raw || providerResult),
    metadata: { origin, labelId: String(label._id), preparedOnly: providerResult.preparedOnly === true }
  }).catch(() => null);

  let whatsapp = { skipped: true, reason: 'notifyCustomer_false' };
  if (body.notifyCustomer === true && (trackingCode || orderPatch.status)) {
    whatsapp = await waMaybeNotifyOrderStatusChange(orderId, before, toJSON(after), origin).catch((error) => ({ ok: false, error: error.message || String(error) }));
  }

  return { ok: true, etiqueta: normalizeLogisticsLabel(label), order: toJSON(after), providerResult: redact(providerResult), whatsapp };
}

app.get('/api/admin/logistica/provedores', adminRequired, async (_req, res) => {
  const settings = await getShippingSettings().catch(() => ({}));
  const correiosIntegrated = hasCorreiosPrepostagemConfig(settings);
  const frenetIntegrated = hasFrenetOrderConfig(settings);
  return res.json({
    ok: true,
    provedores: [
      { id: 'manual', nome: 'Transportadora manual', integrado: false, enabled: true },
      { id: 'ariana_local', nome: 'Entrega Ariana / parceiro local', integrado: false, enabled: true },
      { id: 'correios', nome: 'Correios', integrado: correiosIntegrated, enabled: !!settings?.carriers?.correios?.enabled, proximaFase: correiosIntegrated ? 'Pré-postagem configurada no backend' : 'Configurar CORREIOS_PREPOSTAGEM_URL no Render' },
      { id: 'frenet', nome: 'Frenet / transportadoras', integrado: frenetIntegrated, enabled: settings?.carriers?.frenet?.enabled !== false, proximaFase: frenetIntegrated ? 'Orders Frenet configurado no backend' : 'Configurar FRENET_ORDER_URL no Render' },
      { id: 'rodocap', nome: 'Rodocap', integrado: false, enabled: settings?.businessRules?.rodocap?.enabled !== false }
    ]
  });
});

app.get('/api/admin/logistica/pedidos', adminRequired, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const status = String(req.query.status || '').trim();
    const limit = Math.max(1, Math.min(Number(req.query.limit || 100), 500));
    const filter = {};
    if (status) filter.status = status;
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      filter.$or = [
        { customerName: rx },
        { customerEmail: rx },
        { customerPhone: rx },
        { trackingCode: rx },
        { status: rx },
        { statusLabel: rx }
      ];
      if (mongoose.Types.ObjectId.isValid(q)) filter.$or.push({ _id: new mongoose.Types.ObjectId(q) });
    }
    const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    const orderIds = orders.map(o => String(o._id));
    const labels = await LogisticsLabel.find({ orderId: { $in: orderIds } }).sort({ updatedAt: -1 }).lean();
    const byOrder = new Map();
    for (const label of labels) if (!byOrder.has(String(label.orderId))) byOrder.set(String(label.orderId), normalizeLogisticsLabel(label));
    return res.json({
      ok: true,
      pedidos: orders.map((order) => {
        const obj = toJSON(order);
        const address = getOrderAddress(obj);
        return {
          ...obj,
          id: String(obj._id || obj.id || ''),
          shortId: String(obj._id || obj.id || '').slice(-8).toUpperCase(),
          logisticsProvider: inferLogisticsProvider(obj),
          address,
          itemsSummary: orderItemsSummary(obj),
          etiqueta: byOrder.get(String(obj._id || obj.id || '')) || null
        };
      })
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar pedidos para logística' });
  }
});

app.post('/api/admin/logistica/etiquetas/manual', adminRequired, async (req, res) => {
  try {
    const orderId = String(req.body?.orderId || '').trim();
    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) return res.status(400).json({ ok: false, error: 'Pedido inválido para gerar etiqueta.' });
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado.' });

    const before = toJSON(order);
    const provider = String(req.body?.provider || inferLogisticsProvider(before) || 'manual').trim();
    const service = String(req.body?.service || req.body?.servico || '').trim();
    const trackingCode = String(req.body?.trackingCode || req.body?.rastreio || before.trackingCode || '').trim();
    const patch = {
      orderId,
      orderObjectId: order._id,
      provider,
      service,
      status: String(req.body?.status || 'gerada').trim(),
      trackingCode,
      shippingCost: Number(req.body?.shippingCost || before.shippingCost || 0),
      volumes: Math.max(1, Number(req.body?.volumes || 1)),
      weightKg: Number(req.body?.weightKg || req.body?.pesoKg || 0),
      heightCm: Number(req.body?.heightCm || req.body?.alturaCm || 0),
      widthCm: Number(req.body?.widthCm || req.body?.larguraCm || 0),
      lengthCm: Number(req.body?.lengthCm || req.body?.comprimentoCm || 0),
      notes: String(req.body?.notes || req.body?.observacoes || '').trim(),
      labelType: 'manual_print',
      updatedBy: req.admin?.email || req.admin?.id || 'admin'
    };
    delete patch.createdBy;

    let label = await LogisticsLabel.findOneAndUpdate(
      { orderId },
      { $set: patch, $setOnInsert: { createdBy: req.admin?.email || req.admin?.id || 'admin' } },
      { upsert: true, new: true }
    );
    const html = buildManualLogisticsLabelHtml(order, label);
    label = await LogisticsLabel.findByIdAndUpdate(label._id, { $set: { labelHtml: html } }, { new: true });

    const updateOrder = {
      trackingCode,
      shipping: {
        ...(before.shipping || {}),
        provider,
        service,
        labelId: String(label._id),
        labelStatus: patch.status,
        labelType: patch.labelType,
        updatedAt: new Date().toISOString()
      }
    };
    if (String(req.body?.markStatus || '').trim()) {
      updateOrder.status = String(req.body.markStatus).trim();
      updateOrder.statusLabel = String(req.body.markStatusLabel || req.body.markStatus).trim();
    }
    const after = await Order.findByIdAndUpdate(orderId, { $set: updateOrder }, { new: true });

    await writeAuditLog({
      scope: 'logistica',
      eventType: 'manual_label_generated',
      orderId,
      status: 'success',
      changedKeys: changedKeys(before, toJSON(after)),
      metadata: { provider, service, trackingCode, labelId: String(label._id), actor: req.admin?.email || req.admin?.id || 'admin' }
    }).catch(() => null);

    const shouldNotify = req.body?.notifyCustomer === true;
    let whatsapp = { skipped: true, reason: 'notifyCustomer_false' };
    if (shouldNotify && (trackingCode || updateOrder.status)) {
      whatsapp = await waMaybeNotifyOrderStatusChange(orderId, before, toJSON(after), 'logistica_label_manual').catch((error) => ({ ok: false, error: error.message || String(error) }));
    }

    return res.json({ ok: true, etiqueta: normalizeLogisticsLabel(label), order: toJSON(after), whatsapp });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao gerar etiqueta manual.' });
  }
});

app.get('/api/admin/logistica/etiquetas/:orderId/html', adminRequired, async (req, res) => {
  try {
    const orderId = String(req.params.orderId || '').trim();
    const label = await LogisticsLabel.findOne({ orderId }).sort({ updatedAt: -1 });
    if (!label) return res.status(404).send('Etiqueta não encontrada para este pedido.');
    if (label.labelHtml) return res.type('html').send(label.labelHtml);
    const order = mongoose.Types.ObjectId.isValid(orderId) ? await Order.findById(orderId) : null;
    return res.type('html').send(buildManualLogisticsLabelHtml(order || {}, label));
  } catch (error) {
    return res.status(500).send(error.message || 'Erro ao abrir etiqueta.');
  }
});

app.patch('/api/admin/logistica/rastreio/:orderId', adminRequired, async (req, res) => {
  try {
    const orderId = String(req.params.orderId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(orderId)) return res.status(400).json({ ok: false, error: 'Pedido inválido.' });
    const before = await Order.findById(orderId);
    if (!before) return res.status(404).json({ ok: false, error: 'Pedido não encontrado.' });
    const patch = {
      trackingCode: String(req.body?.trackingCode || '').trim(),
      status: String(req.body?.status || before.status || '').trim(),
      statusLabel: String(req.body?.statusLabel || req.body?.status || before.statusLabel || '').trim()
    };
    const after = await Order.findByIdAndUpdate(orderId, { $set: patch }, { new: true });
    await LogisticsLabel.findOneAndUpdate({ orderId }, { $set: { trackingCode: patch.trackingCode, status: patch.status || 'atualizada', updatedBy: req.admin?.email || req.admin?.id || 'admin' } }, { new: true }).catch(() => null);
    const whatsapp = req.body?.notifyCustomer === true
      ? await waMaybeNotifyOrderStatusChange(orderId, toJSON(before), toJSON(after), 'logistica_tracking_patch').catch((error) => ({ ok: false, error: error.message || String(error) }))
      : { skipped: true, reason: 'notifyCustomer_false' };
    return res.json({ ok: true, order: toJSON(after), whatsapp });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao atualizar rastreio.' });
  }
});

app.post('/api/admin/logistica/etiquetas/correios/preparar', adminRequired, async (req, res) => {
  try {
    const orderId = String(req.body?.orderId || '').trim();
    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) return res.status(400).json({ ok: false, error: 'Pedido inválido para pré-postagem Correios.' });
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado.' });
    const providerResult = await callCorreiosPrepostagem(order, req.body || {});
    const result = await saveProviderLogisticsResult({
      order,
      body: req.body || {},
      provider: 'correios',
      providerResult,
      actor: req.admin?.email || req.auth?.email || 'admin',
      labelType: providerResult.preparedOnly ? 'correios_prepostagem_preparada' : 'correios_prepostagem_api',
      origin: 'admin_logistica_correios_preparar'
    });
    return res.json(result);
  } catch (error) {
    console.error('[logistica correios preparar]', error);
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao preparar pré-postagem Correios.' });
  }
});


app.post('/api/admin/logistica/etiquetas/correios/teste', adminRequired, async (req, res) => {
  try {
    const settings = await getShippingSettings().catch(() => ({}));
    const testPayload = {
      cepOrigem: cleanCep(req.body?.cepOrigem || settings?.correios?.origemCep || settings?.carriers?.correios?.origemCep || process.env.LOJA_ORIGEM_CEP || '39740000'),
      cepDestino: cleanCep(req.body?.cepDestino || '01001000'),
      weightKg: Number(req.body?.weightKg || 1),
      lengthCm: Number(req.body?.lengthCm || 20),
      widthCm: Number(req.body?.widthCm || 20),
      heightCm: Number(req.body?.heightCm || 20),
      productPrice: Number(req.body?.productPrice || 10),
      shippingServiceCode: req.body?.shippingServiceCode || req.body?.serviceCode || undefined
    };

    const quote = await quoteCorreios(testPayload, settings).catch((error) => ({
      ok: false,
      error: error.message || String(error)
    }));

    return res.json({
      ok: true,
      teste: true,
      provider: 'correios',
      message: 'Teste executado sem gerar pedido, sem comprar frete e sem criar pré-postagem real.',
      auth: 'admin_ok',
      correios: {
        enabled: settings?.carriers?.correios?.enabled !== false,
        prepostagemEndpointConfigured: Boolean(String(process.env.CORREIOS_PREPOSTAGEM_URL || process.env.CORREIOS_PRE_POSTAGEM_URL || '').trim()),
        tokenConfigured: Boolean(String(process.env.CORREIOS_TOKEN || process.env.CORREIOS_ACCESS_TOKEN || process.env.CORREIOS_BASIC_TOKEN || process.env.CORREIOS_USUARIO || '').trim()),
        originCep: testPayload.cepOrigem
      },
      request: testPayload,
      quote
    });
  } catch (error) {
    console.error('[logistica correios teste]', error);
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao testar Correios.' });
  }
});

app.post('/api/admin/logistica/etiquetas/frenet/preparar', adminRequired, async (req, res) => {
  try {
    const orderId = String(req.body?.orderId || '').trim();
    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) return res.status(400).json({ ok: false, error: 'Pedido inválido para emissão Frenet.' });
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado.' });
    const providerResult = await callFrenetOrder(order, req.body || {});
    const result = await saveProviderLogisticsResult({
      order,
      body: req.body || {},
      provider: 'frenet',
      providerResult,
      actor: req.admin?.email || req.auth?.email || 'admin',
      labelType: providerResult.preparedOnly ? 'frenet_order_preparado' : 'frenet_order_api',
      origin: 'admin_logistica_frenet_preparar'
    });
    return res.json(result);
  } catch (error) {
    console.error('[logistica frenet preparar]', error);
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao preparar pedido Frenet.' });
  }
});

// ============================================================
// LOGÍSTICA / ETIQUETAS - SELLER FILTRADO
// Seller só enxerga e altera pedidos que possuem seu sellerId.
// ============================================================
function sellerCanAccessOrder(orderDoc = {}, sellerId = '') {
  const sid = String(sellerId || '').trim();
  if (!sid) return false;
  return extractSellerIdsFromOrder(orderDoc).includes(sid);
}

app.get('/api/seller/logistica/provedores', sellerAuthRequired, async (_req, res) => {
  const settings = await getShippingSettings().catch(() => ({}));
  return res.json({
    ok: true,
    sellerMode: true,
    provedores: [
      { id: 'manual', nome: 'Transportadora manual', integrado: false, enabled: true },
      { id: 'ariana_local', nome: 'Entrega local / parceiro', integrado: false, enabled: true },
      { id: 'correios', nome: 'Correios', integrado: hasCorreiosPrepostagemConfig(settings), enabled: !!settings?.carriers?.correios?.enabled, proximaFase: hasCorreiosPrepostagemConfig(settings) ? 'Pré-postagem configurada no backend' : 'Configurar CORREIOS_PREPOSTAGEM_URL no Render' },
      { id: 'frenet', nome: 'Frenet / transportadoras', integrado: hasFrenetOrderConfig(settings), enabled: settings?.carriers?.frenet?.enabled !== false, proximaFase: hasFrenetOrderConfig(settings) ? 'Orders Frenet configurado no backend' : 'Configurar FRENET_ORDER_URL no Render' }
    ]
  });
});

app.get('/api/seller/logistica/pedidos', sellerAuthRequired, async (req, res) => {
  try {
    const sid = String(req.sellerId || '').trim();
    if (!sid) return res.status(403).json({ ok: false, error: 'Seller não identificado.' });

    const q = String(req.query.q || '').trim();
    const status = String(req.query.status || '').trim();
    const limit = Math.max(1, Math.min(Number(req.query.limit || 100), 300));
    const sellerFilter = { $or: [{ sellerIds: sid }, { 'items.sellerId': sid }, { manufacturer: sid }] };
    const filter = { $and: [sellerFilter] };

    if (status) filter.$and.push({ status });
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      const qFilter = {
        $or: [
          { customerName: rx },
          { customerEmail: rx },
          { customerPhone: rx },
          { trackingCode: rx },
          { status: rx },
          { statusLabel: rx }
        ]
      };
      if (mongoose.Types.ObjectId.isValid(q)) qFilter.$or.push({ _id: new mongoose.Types.ObjectId(q) });
      filter.$and.push(qFilter);
    }

    const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    const orderIds = orders.map(o => String(o._id));
    const labels = await LogisticsLabel.find({ orderId: { $in: orderIds } }).sort({ updatedAt: -1 }).lean();
    const byOrder = new Map();
    for (const label of labels) if (!byOrder.has(String(label.orderId))) byOrder.set(String(label.orderId), normalizeLogisticsLabel(label));

    return res.json({
      ok: true,
      sellerMode: true,
      pedidos: orders.map((order) => {
        const obj = toJSON(order);
        const address = getOrderAddress(obj);
        return {
          ...obj,
          id: String(obj._id || obj.id || ''),
          shortId: String(obj._id || obj.id || '').slice(-8).toUpperCase(),
          logisticsProvider: inferLogisticsProvider(obj),
          address,
          itemsSummary: orderItemsSummary(obj),
          etiqueta: byOrder.get(String(obj._id || obj.id || '')) || null
        };
      })
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar pedidos do seller para logística' });
  }
});

app.post('/api/seller/logistica/etiquetas/manual', sellerAuthRequired, async (req, res) => {
  try {
    const sid = String(req.sellerId || '').trim();
    const orderId = String(req.body?.orderId || '').trim();
    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) return res.status(400).json({ ok: false, error: 'Pedido inválido para gerar etiqueta.' });

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado.' });
    if (!sellerCanAccessOrder(order, sid)) return res.status(403).json({ ok: false, error: 'Este pedido não pertence ao seller logado.' });

    const before = toJSON(order);
    const provider = String(req.body?.provider || inferLogisticsProvider(before) || 'manual').trim();
    const service = String(req.body?.service || req.body?.servico || '').trim();
    const trackingCode = String(req.body?.trackingCode || req.body?.rastreio || before.trackingCode || '').trim();
    const patch = {
      orderId,
      orderObjectId: order._id,
      provider,
      service,
      status: String(req.body?.status || 'gerada').trim(),
      trackingCode,
      shippingCost: Number(req.body?.shippingCost || before.shippingCost || 0),
      volumes: Math.max(1, Number(req.body?.volumes || 1)),
      weightKg: Number(req.body?.weightKg || req.body?.pesoKg || 0),
      heightCm: Number(req.body?.heightCm || req.body?.alturaCm || 0),
      widthCm: Number(req.body?.widthCm || req.body?.larguraCm || 0),
      lengthCm: Number(req.body?.lengthCm || req.body?.comprimentoCm || 0),
      notes: String(req.body?.notes || req.body?.observacoes || '').trim(),
      labelType: 'seller_manual_print',
      updatedBy: req.seller?.email || req.sellerId || 'seller'
    };

    let label = await LogisticsLabel.findOneAndUpdate(
      { orderId },
      { $set: patch, $setOnInsert: { createdBy: req.seller?.email || req.sellerId || 'seller' } },
      { upsert: true, new: true }
    );
    const html = buildManualLogisticsLabelHtml(order, label);
    label = await LogisticsLabel.findByIdAndUpdate(label._id, { $set: { labelHtml: html } }, { new: true });

    const updateOrder = {
      trackingCode,
      shipping: {
        ...(before.shipping || {}),
        provider,
        service,
        labelId: String(label._id),
        labelStatus: patch.status,
        labelType: patch.labelType,
        updatedAt: new Date().toISOString()
      }
    };
    if (String(req.body?.markStatus || '').trim()) {
      updateOrder.status = String(req.body.markStatus).trim();
      updateOrder.statusLabel = String(req.body.markStatusLabel || req.body.markStatus).trim();
    }

    const after = await Order.findByIdAndUpdate(orderId, { $set: updateOrder }, { new: true });

    await createAdminNotification({
      type: 'seller_logistica_etiqueta',
      title: '🏷️ Seller gerou etiqueta',
      message: `Seller ${req.seller?.storeName || req.seller?.displayName || sid} gerou etiqueta para o pedido #${String(orderId).slice(-8).toUpperCase()}`,
      relatedId: orderId,
      severity: 'info',
      metadata: { sellerId: sid, provider, service, trackingCode, labelId: String(label._id), origin: 'seller_logistica_label' }
    }).catch(() => null);

    const shouldNotify = req.body?.notifyCustomer === true;
    let whatsapp = { skipped: true, reason: 'notifyCustomer_false' };
    if (shouldNotify && (trackingCode || updateOrder.status)) {
      whatsapp = await waMaybeNotifyOrderStatusChange(orderId, before, toJSON(after), 'seller_logistica_label_manual').catch((error) => ({ ok: false, error: error.message || String(error) }));
    }

    return res.json({ ok: true, etiqueta: normalizeLogisticsLabel(label), order: toJSON(after), whatsapp });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao gerar etiqueta do seller.' });
  }
});


app.post('/api/seller/logistica/etiquetas/correios/preparar', sellerAuthRequired, async (req, res) => {
  try {
    const sid = String(req.sellerId || '').trim();
    const orderId = String(req.body?.orderId || '').trim();
    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) return res.status(400).json({ ok: false, error: 'Pedido inválido para pré-postagem Correios.' });
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado.' });
    if (!sellerCanAccessOrder(order, sid)) return res.status(403).json({ ok: false, error: 'Este pedido não pertence ao seller logado.' });
    const providerResult = await callCorreiosPrepostagem(order, req.body || {});
    const result = await saveProviderLogisticsResult({
      order,
      body: req.body || {},
      provider: 'correios',
      providerResult,
      actor: req.seller?.email || req.sellerId || 'seller',
      labelType: providerResult.preparedOnly ? 'seller_correios_prepostagem_preparada' : 'seller_correios_prepostagem_api',
      origin: 'seller_logistica_correios_preparar'
    });
    await createAdminNotification({
      type: 'seller_logistica_correios',
      title: '📮 Seller preparou Correios',
      message: `Seller ${req.seller?.storeName || req.seller?.displayName || sid} preparou Correios para o pedido #${orderId.slice(-8).toUpperCase()}`,
      relatedId: orderId,
      severity: 'info',
      metadata: { sellerId: sid, preparedOnly: providerResult.preparedOnly === true }
    }).catch(() => null);
    return res.json(result);
  } catch (error) {
    console.error('[seller logistica correios preparar]', error);
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao preparar Correios do seller.' });
  }
});


app.post('/api/seller/logistica/etiquetas/correios/teste', sellerAuthRequired, async (req, res) => {
  try {
    const settings = await getShippingSettings().catch(() => ({}));
    const testPayload = {
      cepOrigem: cleanCep(req.body?.cepOrigem || settings?.correios?.origemCep || settings?.carriers?.correios?.origemCep || process.env.LOJA_ORIGEM_CEP || '39740000'),
      cepDestino: cleanCep(req.body?.cepDestino || '01001000'),
      weightKg: Number(req.body?.weightKg || 1),
      lengthCm: Number(req.body?.lengthCm || 20),
      widthCm: Number(req.body?.widthCm || 20),
      heightCm: Number(req.body?.heightCm || 20),
      productPrice: Number(req.body?.productPrice || 10),
      shippingServiceCode: req.body?.shippingServiceCode || req.body?.serviceCode || undefined
    };

    const quote = await quoteCorreios(testPayload, settings).catch((error) => ({
      ok: false,
      error: error.message || String(error)
    }));

    return res.json({
      ok: true,
      teste: true,
      provider: 'correios',
      message: 'Teste executado pelo seller sem gerar pedido, sem comprar frete e sem criar pré-postagem real.',
      auth: 'seller_ok',
      sellerId: req.sellerId || '',
      correios: {
        enabled: settings?.carriers?.correios?.enabled !== false,
        prepostagemEndpointConfigured: Boolean(String(process.env.CORREIOS_PREPOSTAGEM_URL || process.env.CORREIOS_PRE_POSTAGEM_URL || '').trim()),
        tokenConfigured: Boolean(String(process.env.CORREIOS_TOKEN || process.env.CORREIOS_ACCESS_TOKEN || process.env.CORREIOS_BASIC_TOKEN || process.env.CORREIOS_USUARIO || '').trim()),
        originCep: testPayload.cepOrigem
      },
      request: testPayload,
      quote
    });
  } catch (error) {
    console.error('[seller logistica correios teste]', error);
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao testar Correios do seller.' });
  }
});

app.post('/api/seller/logistica/etiquetas/frenet/preparar', sellerAuthRequired, async (req, res) => {
  try {
    const sid = String(req.sellerId || '').trim();
    const orderId = String(req.body?.orderId || '').trim();
    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) return res.status(400).json({ ok: false, error: 'Pedido inválido para emissão Frenet.' });
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado.' });
    if (!sellerCanAccessOrder(order, sid)) return res.status(403).json({ ok: false, error: 'Este pedido não pertence ao seller logado.' });
    const providerResult = await callFrenetOrder(order, req.body || {});
    const result = await saveProviderLogisticsResult({
      order,
      body: req.body || {},
      provider: 'frenet',
      providerResult,
      actor: req.seller?.email || req.sellerId || 'seller',
      labelType: providerResult.preparedOnly ? 'seller_frenet_order_preparado' : 'seller_frenet_order_api',
      origin: 'seller_logistica_frenet_preparar'
    });
    await createAdminNotification({
      type: 'seller_logistica_frenet',
      title: '🚚 Seller preparou Frenet',
      message: `Seller ${req.seller?.storeName || req.seller?.displayName || sid} preparou Frenet para o pedido #${orderId.slice(-8).toUpperCase()}`,
      relatedId: orderId,
      severity: 'info',
      metadata: { sellerId: sid, preparedOnly: providerResult.preparedOnly === true }
    }).catch(() => null);
    return res.json(result);
  } catch (error) {
    console.error('[seller logistica frenet preparar]', error);
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao preparar Frenet do seller.' });
  }
});

app.get('/api/seller/logistica/etiquetas/:orderId/html', sellerAuthRequired, async (req, res) => {
  try {
    const sid = String(req.sellerId || '').trim();
    const orderId = String(req.params.orderId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(orderId)) return res.status(400).send('Pedido inválido.');
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).send('Pedido não encontrado.');
    if (!sellerCanAccessOrder(order, sid)) return res.status(403).send('Este pedido não pertence ao seller logado.');

    const label = await LogisticsLabel.findOne({ orderId }).sort({ updatedAt: -1 });
    if (!label) return res.status(404).send('Etiqueta não encontrada para este pedido.');
    if (label.labelHtml) return res.type('html').send(label.labelHtml);
    return res.type('html').send(buildManualLogisticsLabelHtml(order, label));
  } catch (error) {
    return res.status(500).send(error.message || 'Erro ao abrir etiqueta do seller.');
  }
});

app.patch('/api/seller/logistica/rastreio/:orderId', sellerAuthRequired, async (req, res) => {
  try {
    const sid = String(req.sellerId || '').trim();
    const orderId = String(req.params.orderId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(orderId)) return res.status(400).json({ ok: false, error: 'Pedido inválido.' });
    const before = await Order.findById(orderId);
    if (!before) return res.status(404).json({ ok: false, error: 'Pedido não encontrado.' });
    if (!sellerCanAccessOrder(before, sid)) return res.status(403).json({ ok: false, error: 'Este pedido não pertence ao seller logado.' });

    const patch = {
      trackingCode: String(req.body?.trackingCode || '').trim(),
      status: String(req.body?.status || before.status || '').trim(),
      statusLabel: String(req.body?.statusLabel || req.body?.status || before.statusLabel || '').trim()
    };
    const after = await Order.findByIdAndUpdate(orderId, { $set: patch }, { new: true });
    await LogisticsLabel.findOneAndUpdate({ orderId }, { $set: { trackingCode: patch.trackingCode, status: patch.status || 'atualizada', updatedBy: req.seller?.email || req.sellerId || 'seller' } }, { new: true }).catch(() => null);

    await createAdminNotification({
      type: 'seller_logistica_rastreio',
      title: '🚚 Seller atualizou rastreio',
      message: `Seller ${req.seller?.storeName || req.seller?.displayName || sid} atualizou rastreio do pedido #${String(orderId).slice(-8).toUpperCase()}`,
      relatedId: orderId,
      severity: 'success',
      metadata: { sellerId: sid, trackingCode: patch.trackingCode, origin: 'seller_logistica_tracking' }
    }).catch(() => null);

    const whatsapp = req.body?.notifyCustomer === true
      ? await waMaybeNotifyOrderStatusChange(orderId, toJSON(before), toJSON(after), 'seller_logistica_tracking_patch').catch((error) => ({ ok: false, error: error.message || String(error) }))
      : { skipped: true, reason: 'notifyCustomer_false' };
    return res.json({ ok: true, order: toJSON(after), whatsapp });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao atualizar rastreio do seller.' });
  }
});


app.get('/api/admin/orders', adminRequired, async (req, res) => res.json((await Order.find().sort({ createdAt: -1 }).limit(Math.min(Number(req.query.limit || 10), 100))).map(toJSON)));
app.get('/api/admin/notifications', adminRequired, async (_req, res) => res.json((await Notification.find({ $or: [{ audience: { $exists: false } }, { audience: '' }, { audience: 'admin' }, { audience: 'all' }] }).sort({ createdAt: -1 }).limit(50)).map(toJSON)));

// ============================================================
// DASHBOARD DE ATENDIMENTO - ADMIN
// Rotas usadas pelo admin_painel.htm na aba Atendimentos.
// Mantém compatibilidade com os Tickets do site e, quando existir,
// também lê arquivos locais do monitor de atendimento.
// ============================================================
function readLocalJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (_error) {
    return fallback;
  }
}

function normalizeTicketForAdmin(ticketDoc = {}) {
  const ticket = toJSON(ticketDoc) || ticketDoc || {};
  return {
    ...ticket,
    id: String(ticket._id || ticket.id || ''),
    protocolo: ticket.protocolo || ticket.protocol || '',
    tipo: ticket.tipo || ticket.department || ticket.departamento || 'Atendimento',
    status: ticket.status || 'Novo',
    nome: ticket.nome || ticket.name || '',
    email: ticket.email || '',
    telefone: ticket.telefone || ticket.phone || '',
    mensagem: ticket.mensagem || ticket.message || '',
    createdAt: ticket.createdAt || ticket.data || null,
    updatedAt: ticket.updatedAt || null
  };
}

app.get('/api/admin/atendimentos', adminRequired, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit || 500), 1000));
    const rows = await Ticket.find().sort({ createdAt: -1 }).limit(limit);
    return res.json(rows.map(normalizeTicketForAdmin));
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar atendimentos' });
  }
});

app.patch('/api/admin/atendimentos/:id', adminRequired, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const status = String(req.body?.status || '').trim();
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: 'Atendimento inválido' });
    }
    const update = {};
    if (status) update.status = status;
    const doc = await Ticket.findByIdAndUpdate(id, { $set: update }, { new: true });
    if (!doc) return res.status(404).json({ ok: false, error: 'Atendimento não encontrado' });
    return res.json({ ok: true, atendimento: normalizeTicketForAdmin(doc) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao atualizar atendimento' });
  }
});



// ============================================================
// SINCRONIZAÇÃO DOS BOTS COM O PAINEL DE ATENDIMENTO
// ============================================================
app.post('/api/bot/atendimento/evento', botAccessRequired, async (req, res) => {
  try {
    const body = req.body || {};
    const protocolo = String(body.protocolo || body.protocol || '').trim();
    const telefone = cleanPhone(body.telefone || body.phone || body.number || '');
    const setor = String(body.setor || body.sector || 'sac').toLowerCase();
    const tipo = setor.includes('fin') ? 'Financeiro' : 'SAC';
    const status = String(body.status || 'Aguardando atendimento').trim();
    const mensagem = String(body.mensagem || body.message || '').trim();
    const nome = String(body.nome || body.name || '').trim();

    if (!protocolo && !telefone) {
      return res.status(400).json({ ok: false, error: 'Informe protocolo ou telefone' });
    }

    const doc = await Ticket.findOneAndUpdate(
      { protocolo: protocolo || telefone },
      {
        $set: {
          protocolo: protocolo || telefone,
          tipo,
          telefone,
          nome,
          mensagem,
          status,
          origem: 'whatsapp_bot',
          metadata: {
            ...(body.metadata || {}),
            setor,
            phone: telefone,
            source: 'bot'
          }
        }
      },
      { upsert: true, new: true }
    );

    return res.json({ ok: true, atendimento: normalizeTicketForAdmin(doc) });
  } catch (error) {
    console.error('[bot atendimento evento]', error);
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao registrar atendimento' });
  }
});

app.post('/api/bot/atendimento/avaliacao', botAccessRequired, async (req, res) => {
  try {
    const body = req.body || {};
    const protocolo = String(body.protocolo || body.protocol || '').trim();
    const telefone = cleanPhone(body.telefone || body.phone || body.number || '');
    const nota = Number(body.nota || body.rating || 0);
    const setor = String(body.setor || body.sector || '').toLowerCase();

    if (!nota || nota < 1 || nota > 5) {
      return res.status(400).json({ ok: false, error: 'Nota inválida' });
    }

    await Notification.create({
      type: 'atendimento_avaliacao',
      title: nota <= 3 ? '⚠️ Avaliação baixa recebida' : '⭐ Avaliação recebida',
      message: `Nota ${nota} recebida no ${setor || 'atendimento'}`,
      status: 'unread',
      relatedId: protocolo,
      severity: nota <= 3 ? 'high' : 'info',
      audience: 'admin',
      metadata: { protocolo, telefone, nota, setor, source: 'bot' }
    });if (protocolo || telefone) {
      await Ticket.findOneAndUpdate(
        protocolo ? { protocolo } : { telefone },
        {
          $set: {
            status: 'Avaliado',
            metadata: { protocolo, telefone, nota, setor, source: 'bot' }
          }
        },
        { new: true }
      ).catch(() => null);
    }

    return res.json({ ok: true });
  } catch (error) {
    console.error('[bot atendimento avaliacao]', error);
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao registrar avaliação' });
  }
});

app.post('/api/bot/atendimento/alerta', botAccessRequired, async (req, res) => {
  try {
    const body = req.body || {};
    const protocolo = String(body.protocolo || body.protocol || '').trim();
    const telefone = cleanPhone(body.telefone || body.phone || body.number || '');
    const setor = String(body.setor || body.sector || '').toLowerCase();
    const mensagem = String(body.mensagem || body.message || '').trim();

    await OperationalAlert.create({
      alertId: `bot_critical_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      type: 'atendimento_critico',
      severity: 'critical',
      status: 'open',
      title: '🚨 Alerta crítico de atendimento',
      message: mensagem || 'Cliente enviou mensagem crítica',
      entityKey: protocolo || telefone || String(Date.now()),
      metadata: { protocolo, telefone, setor, source: 'bot' },
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      buildId: BUILD_ID
    });

    return res.json({ ok: true });
  } catch (error) {
    console.error('[bot atendimento alerta]', error);
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao registrar alerta' });
  }
});


app.get('/api/admin/atendimento/dashboard', adminRequired, async (_req, res) => {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [openTickets, todaysTickets, criticalAlerts, notifications] = await Promise.all([
      Ticket.find({ status: { $nin: ['Resolvido', 'Fechado', 'Finalizado'] } }).sort({ createdAt: -1 }).limit(1000),
      Ticket.find({ createdAt: { $gte: startOfDay } }).sort({ createdAt: -1 }).limit(1000),
      OperationalAlert.countDocuments({ createdAt: { $gte: startOfDay }, severity: { $in: ['high', 'critical'] } }).catch(() => 0),
      Notification.find({ createdAt: { $gte: startOfDay } }).sort({ createdAt: -1 }).limit(200).catch(() => [])
    ]);

    const humanMode = readLocalJsonSafe('/root/human-mode.json', {});
    const avaliacoes = readLocalJsonSafe('/root/avaliacoes.json', []);

    const humanValues = Object.values(humanMode || {});
    const queueSacFile = humanValues.filter((x) => String(x?.sector || '').toLowerCase() === 'sac').length;
    const queueFinFile = humanValues.filter((x) => String(x?.sector || '').toLowerCase() === 'financeiro').length;

    const openNormalized = openTickets.map(normalizeTicketForAdmin);
    const sacLocal = openNormalized.filter((x) => String(x.tipo || '').toLowerCase().includes('sac')).length;
    const finLocal = openNormalized.filter((x) => String(x.tipo || '').toLowerCase().includes('fin')).length;

    const ratingsToday = Array.isArray(avaliacoes)
      ? avaliacoes.filter((a) => String(a?.data || '').slice(0, 10) === new Date().toISOString().slice(0, 10))
      : [];

    const ratingCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const item of ratingsToday) {
      const nota = Number(item?.nota);
      if (ratingCounts[nota] !== undefined) ratingCounts[nota] += 1;
    }

    const media = ratingsToday.length
      ? Number((ratingsToday.reduce((sum, item) => sum + Number(item?.nota || 0), 0) / ratingsToday.length).toFixed(2))
      : null;

    const criticalNotifications = notifications.filter((n) => {
      const text = `${n.title || ''} ${n.message || ''} ${JSON.stringify(n.metadata || {})}`.toLowerCase();
      return text.includes('procon') || text.includes('processo') || text.includes('advogado') || text.includes('chargeback') || text.includes('fraude') || text.includes('reclama');
    }).length;

    return res.json({
      ok: true,
      updatedAt: new Date().toISOString(),
      queue: {
        sac: queueSacFile || sacLocal,
        financeiro: queueFinFile || finLocal,
        total: (queueSacFile + queueFinFile) || openNormalized.length
      },
      ratings: {
        media: media === null ? '—' : media,
        totalHoje: ratingsToday.length,
        counts: ratingCounts
      },
      critical: {
        hoje: Number(criticalAlerts || 0) + Number(criticalNotifications || 0)
      },
      tempoMedioResposta: '—',
      totals: {
        atendimentosHoje: todaysTickets.length,
        abertos: openNormalized.length
      }
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar dashboard de atendimento' });
  }
});


app.get('/api/admin/alerts', adminRequired, async (_req, res) => res.json((await OperationalAlert.find().sort({ updatedAt: -1 }).limit(100)).map(toJSON)));
app.post('/api/admin/alerts/scan', adminRequired, async (_req, res) => { const results = await scanOperationalAlerts(); return res.json({ ok: true, count: results.length, alerts: results.map(toJSON) }); });
app.get('/api/admin/audit-logs', adminRequired, async (req, res) => { const limit = Math.min(Number(req.query.limit || 100), 500); const query = {}; if (req.query.scope) query.scope = String(req.query.scope); if (req.query.orderId) query.orderId = String(req.query.orderId); if (req.query.manufacturer) query.manufacturer = String(req.query.manufacturer); return res.json((await IntegrationAuditLog.find(query).sort({ createdAt: -1 }).limit(limit)).map(toJSON)); });
app.get('/api/admin/queue/manufacturers', authRequired, async (_req, res) => res.json((await ManufacturerDispatchQueue.find().sort({ updatedAt: -1 }).limit(200)).map(toJSON)));
app.post('/api/admin/queue/manufacturers/process', authRequired, async (req, res) => { const results = await processManufacturerQueue(Number(req.body?.limit || 10)); return res.json({ ok: true, processed: results.length, results }); });
app.post('/api/admin/manufacturers/integrations', authRequired, async (req, res) => { const body = req.body || {}; const manufacturer = String(body.manufacturer || '').trim(); if (!manufacturer) return res.status(400).json({ ok: false, error: 'manufacturer é obrigatório' }); const doc = await ManufacturerIntegration.findOneAndUpdate({ manufacturer }, { $set: { enabled: body.enabled !== false, endpoint: body.endpoint || '', method: body.method || 'POST', headers: body.headers || {}, authType: body.authType || '', authToken: body.authToken || '', apiKey: body.apiKey || '', sendAs: body.sendAs || 'json', timeoutMs: Number(body.timeoutMs || 30000), metadata: body.metadata || {} } }, { upsert: true, new: true }); return res.json({ ok: true, integration: toJSON(doc) }); });
app.get('/api/admin/whatsapp/settings', authRequired, async (_req, res) => { try { return res.json({ ok: true, config: redactWhatsappSettings(await getWhatsappSettings()) }); } catch (_error) { return res.status(500).json({ ok: false, error: 'Erro ao consultar configuração do WhatsApp' }); } });
app.post('/api/admin/whatsapp/settings', authRequired, async (req, res) => { try { return res.json({ ok: true, config: redactWhatsappSettings(await saveWhatsappSettings(req.body || {}, String(req.user._id))) }); } catch (_error) { return res.status(500).json({ ok: false, error: 'Erro ao salvar configuração do WhatsApp' }); } });
app.post('/api/admin/whatsapp/webhook/sync', authRequired, async (_req, res) => { try { return res.json(await waSyncWebhook()); } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Erro ao sincronizar webhook da Evolution' }); } });
app.post('/api/admin/whatsapp/test-text', authRequired, async (req, res) => { try { const settings = await getWhatsappSettings(); const target = req.body?.number || settings.testNumber || ''; const text = String(req.body?.text || settings.testMessage || '').trim(); return res.json(await waSendTextMessage({ number: target, text, settings })); } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Erro ao enviar mensagem pela Evolution' }); } });
app.post('/api/admin/whatsapp/test-media', authRequired, async (req, res) => { try { const settings = await getWhatsappSettings(); const target = req.body?.number || settings.testNumber || ''; const mediaUrl = String(req.body?.mediaUrl || req.body?.media || '').trim(); const caption = String(req.body?.caption || '').trim(); const mediaType = String(req.body?.mediaType || req.body?.mediatype || 'image').trim().toLowerCase(); const fileName = String(req.body?.fileName || '').trim(); return res.json(await waSendMediaMessage({ number: target, mediaUrl, caption, mediaType, fileName, settings })); } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Erro ao enviar mídia pela Evolution' }); } });
app.post('/api/orders/:id/notify-whatsapp', authRequired, async (req, res) => { try { const order = await Order.findById(req.params.id); if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado' }); return res.json({ ok: true, result: await waMaybeNotifyOrderStatusChange(String(order._id), { status: req.body?.previousStatus || '__manual__' }, toJSON(order), 'manual_route') }); } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Erro ao notificar status do pedido' }); } });
app.post('/api/orders/:id/chat-notify-whatsapp', authRequired, async (req, res) => { try { const order = await Order.findById(req.params.id); if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado' }); return res.json({ ok: true, result: await waNotifyOrderChatMessage(String(order._id), toJSON(order), req.body || {}, 'manual_route') }); } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Erro ao notificar chat do pedido' }); } });
app.post('/api/whatsapp/webhook', async (req, res) => { try { const parsed = await waPersistWebhook(req.body || {}); return res.json({ ok: true, received: true, event: parsed.event || null }); } catch (_error) { return res.status(500).json({ ok: false, error: 'Erro ao processar webhook da Evolution' }); } });
app.post('/api/manufacturers/orders/dispatch', adminRequired, async (req, res) => { try { const body = req.body || {}; const orderId = String(body.orderId || body.id || '').trim(); let orderPayload = body; if (orderId) { const order = await Order.findById(orderId); if (order) orderPayload = { id: String(order._id), ...toJSON(order), ...body }; } const result = await dispatchOrderToManufacturer(orderPayload); if (orderId) await Order.findByIdAndUpdate(orderId, { $set: { status_integracao: result.ok ? 'enviado' : 'erro_envio_fabricante', manufacturerDispatch: { manufacturer: result.manufacturer, endpoint: result.endpoint, httpStatus: result.status, response: redact(result.data), sentContentType: result.sentContentType, status: result.ok ? 'sent' : 'error', updatedAt: now() } } }); return res.status(result.ok ? 200 : 502).json({ ok: result.ok, manufacturer: result.manufacturer, endpoint: result.endpoint, status: result.status, response: result.data }); } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Falha ao enviar pedido ao fabricante' }); } });
app.post('/api/manufacturers/orders/enqueue', adminRequired, async (req, res) => { try { const orderId = String(req.body?.orderId || '').trim(); if (!orderId) return res.status(400).json({ ok: false, error: 'orderId é obrigatório' }); const order = await Order.findById(orderId); if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado' }); return res.json(await enqueueManufacturerDispatch(order)); } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Erro ao enfileirar pedido' }); } });
app.post('/api/shipping/calculate', async (req, res) => { try { return res.json(await calculateShipping(req.body || {})); } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Erro ao calcular frete' }); } });
app.post('/shipping/calculate', async (req, res) => { try { return res.json(await calculateShipping(req.body || {})); } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Erro ao calcular frete' }); } });
app.post('/api/shipping/quote', async (req, res) => { try { return res.json(await calculateShipping(req.body || {})); } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Erro ao calcular frete' }); } });
app.post('/shipping/quote', async (req, res) => { try { return res.json(await calculateShipping(req.body || {})); } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Erro ao calcular frete' }); } });
app.post('/api/shipping/logistics/quote', async (req, res) => {
  try {
    const result = await calculateShipping(req.body || {});
    const quotes = Array.isArray(result?.options) ? result.options.map((q) => ({
      service: q.service,
      label: q.label || q.name || 'Logística',
      name: q.label || q.name || 'Logística',
      price: Number(q.price || 0),
      prazo: q.prazo || null,
      deadlineDays: q.deadlineDays || null,
      provider: q.provider || 'configured',
      raw: q.raw || null,
      metadata: q.metadata || null
    })) : [];
    const errors = Array.isArray(result?.options) ? result.options.filter((q) => q && q.unavailable).map((q) => ({
      service: q.service || 'LOGISTICA',
      name: q.label || 'Logística',
      message: q.error || 'Indisponível',
      metadata: q.metadata || null
    })) : [];
    return res.json({ ok: true, quotes, errors, bestQuote: quotes[0] || null, context: result?.context || null });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao calcular frete logístico' });
  }
});
app.post('/shipping/logistics/quote', async (req, res) => {
  try {
    const result = await calculateShipping(req.body || {});
    const quotes = Array.isArray(result?.options) ? result.options.map((q) => ({
      service: q.service,
      label: q.label || q.name || 'Logística',
      name: q.label || q.name || 'Logística',
      price: Number(q.price || 0),
      prazo: q.prazo || null,
      deadlineDays: q.deadlineDays || null,
      provider: q.provider || 'configured',
      raw: q.raw || null,
      metadata: q.metadata || null
    })) : [];
    const errors = Array.isArray(result?.options) ? result.options.filter((q) => q && q.unavailable).map((q) => ({
      service: q.service || 'LOGISTICA',
      name: q.label || 'Logística',
      message: q.error || 'Indisponível',
      metadata: q.metadata || null
    })) : [];
    return res.json({ ok: true, quotes, errors, bestQuote: quotes[0] || null, context: result?.context || null });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao calcular frete logístico' });
  }
});
app.get('/api/admin/shipping/rules', adminRequired, async (_req, res) => res.json({ ok: true, settings: await getShippingSettings() }));
app.post('/api/admin/shipping/rules', adminRequired, async (req, res) => res.json({ ok: true, settings: await saveShippingSettings(req.body || {}, String(req.user._id)) }));

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

    const adminWhatsapp = await waNotifyAdminNewOrder(updated, origin);
    return { ok: true, adminWhatsapp, queue };
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

app.get('/api/payments/mp/public-key', async (_req, res) => { const settings = await getPaymentsSettings(); return res.json({ ok: true, publicKey: settings.mercadopago?.publicKey || process.env.MP_PUBLIC_KEY || '' }); });
app.post('/api/payments/mp/pix', async (req, res) => { try { const body = req.body || {}; const payload = { transaction_amount: parsePaymentAmount(body.amount || body.total || body.transaction_amount || 0), description: body.description || `Pedido Ariana Móveis`, payment_method_id: 'pix', payer: buildMercadoPagoPayer(body), metadata: { orderId: body.orderId || null }, notification_url: body.notification_url || `${APP_BASE_URL || 'http://localhost:3000'}/api/webhooks/mercadopago` }; const { response, idempotencyKey } = await createMercadoPagoPayment(payload); await writeAuditLog({ scope: 'payments', eventType: 'mercadopago_pix_created', orderId: body.orderId || null, status: response.status >= 200 && response.status < 300 ? 'success' : 'error', statusCode: response.status, request: payload, response: response.data, metadata: { provider: 'mercadopago', idempotencyKey } }); if (response.status >= 200 && response.status < 300) {
  const mpNormalized = normalizeMercadoPagoPaymentResponse(response.data);

  if (body.orderId) {
    try {
      await Order.findByIdAndUpdate(body.orderId, {
        $set: {
          "payment.provider": "mercadopago",
          "payment.method": "pix",
          "payment.type": "pix",
          "payment.status": mpNormalized.status || "pending",
          "payment.statusDetail": mpNormalized.statusDetail || "",
          "payment.paymentId": mpNormalized.id || "",
          "payment.externalId": mpNormalized.id || "",
          "payment.pixCode": mpNormalized.qrCode || mpNormalized.qr_code || "",
          "payment.qr_code": mpNormalized.qrCode || mpNormalized.qr_code || "",
          "payment.qrCodeBase64": mpNormalized.qrCodeBase64 || "",
          "payment.qr_code_base64": mpNormalized.qrCodeBase64 || "",
          "payment.ticketUrl": mpNormalized.ticketUrl || mpNormalized.ticket_url || "",
          "payment.updatedAt": new Date()
        }
      });
    } catch (e) {
      console.error("Erro ao salvar PIX no pedido:", e.message || e);
    }
  }

  return res.status(response.status).json(mpNormalized);
} return res.status(response.status).json({ ok: false, error: response.data?.message || response.data?.cause?.[0]?.description || 'Erro ao criar PIX', details: response.data }); } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Erro ao criar PIX no Mercado Pago' }); } });

app.post('/api/payments/mp/credit', async (req, res) => {
  try {
    const body = req.body || {};
    const payload = {
      transaction_amount: Number(body.amount || body.total || 0),
      token: body.token,
      description: body.description || `Pedido Ariana Móveis`,
      installments: Number(body.installments || 1),
      payment_method_id: body.payment_method_id || 'visa',
      issuer_id: body.issuer_id,
      payer: buildMercadoPagoPayer(body),
      metadata: { orderId: body.orderId || null, paymentMethod: 'card', birthDate: body.birthDate || body.customer?.birthDate || null, phone: body.phone || body.customer?.phone || null },
      external_reference: body.orderId ? String(body.orderId) : undefined,
      binary_mode: false,
      additional_info: buildMercadoPagoAdditionalInfo(body),
      notification_url: body.notification_url || `${APP_BASE_URL || 'http://localhost:3000'}/api/webhooks/mercadopago`
    };
    console.log('[MP CREDIT REQUEST]', JSON.stringify({
      amount: payload.transaction_amount,
      payment_method_id: payload.payment_method_id,
      installments: payload.installments,
      hasToken: Boolean(payload.token),
      hasCpf: Boolean(payload.payer?.identification?.number),
      hasEmail: Boolean(payload.payer?.email),
      hasPhone: Boolean(payload.payer?.phone?.number),
      hasAddress: Boolean(payload.payer?.address && Object.keys(payload.payer.address).length),
      hasReceiverAddress: Boolean(payload.additional_info?.shipments?.receiver_address)
    }, null, 2));

    const { response, idempotencyKey } = await createMercadoPagoPayment(payload);
    const mpData = response.data || {};
    console.log(
  '[MP CREDIT RESPONSE]',
  JSON.stringify({
    status: response.status,
    status_mp: mpData?.status,
    status_detail: mpData?.status_detail,
    message: mpData?.message,
    cause: mpData?.cause
  }, null, 2)
);
    const approved = mpData?.status === 'approved';

    const updatedOrder = await updateOrderPaymentFromMercadoPago(body.orderId, 'card', mpData, {
      installments: Number(body.installments || 1),
      paymentMethodId: body.payment_method_id || mpData?.payment_method_id || '',
      issuerId: body.issuer_id || mpData?.issuer_id || ''
    });

    await writeAuditLog({
      scope: 'payments',
      eventType: 'mercadopago_card_created',
      orderId: body.orderId || null,
      status: response.status >= 200 && response.status < 300 ? 'success' : 'error',
      statusCode: response.status,
      request: payload,
      response: mpData,
      metadata: { provider: 'mercadopago', idempotencyKey, alias: 'credit', orderUpdated: !!updatedOrder }
    });

    return res.status(response.status).json({
      ok: response.status >= 200 && response.status < 300,
      approved,
      status: mpData?.status || '',
      statusDetail: mpData?.status_detail || '',
      id: mpData?.id ? String(mpData.id) : '',
      paymentId: mpData?.id ? String(mpData.id) : '',
      paymentMethod: 'card',
      method: 'card',
      data: mpData,
      raw: mpData,
      order: updatedOrder ? toJSON(updatedOrder) : null
    });
  } catch (error) {
    const status = error?.response?.status || 500;
    const details = error?.response?.data || null;
    return res.status(status).json({
      ok: false,
      error: details?.message || details?.cause?.[0]?.description || error.message || 'Erro ao criar pagamento cartão no Mercado Pago',
      statusDetail: details?.status_detail || '',
      details
    });
  }
});

app.post('/api/payments/mp/card', async (req, res) => {
  try {
    const body = req.body || {};
    const payload = {
      transaction_amount: Number(body.amount || body.total || 0),
      token: body.token,
      description: body.description || `Pedido Ariana Móveis`,
      installments: Number(body.installments || 1),
      payment_method_id: body.payment_method_id || 'visa',
      issuer_id: body.issuer_id,
      payer: buildMercadoPagoPayer(body),
      metadata: { orderId: body.orderId || null, paymentMethod: 'card', birthDate: body.birthDate || body.customer?.birthDate || null, phone: body.phone || body.customer?.phone || null },
      external_reference: body.orderId ? String(body.orderId) : undefined,
      binary_mode: false,
      additional_info: buildMercadoPagoAdditionalInfo(body),
      notification_url: body.notification_url || `${APP_BASE_URL || 'http://localhost:3000'}/api/webhooks/mercadopago`
    };
    const { response, idempotencyKey } = await createMercadoPagoPayment(payload);
    const mpData = response.data || {};
    const approved = mpData?.status === 'approved';

    const updatedOrder = await updateOrderPaymentFromMercadoPago(body.orderId, 'card', mpData, {
      installments: Number(body.installments || 1),
      paymentMethodId: body.payment_method_id || mpData?.payment_method_id || '',
      issuerId: body.issuer_id || mpData?.issuer_id || ''
    });

    await writeAuditLog({
      scope: 'payments',
      eventType: 'mercadopago_card_created',
      orderId: body.orderId || null,
      status: response.status >= 200 && response.status < 300 ? 'success' : 'error',
      statusCode: response.status,
      request: payload,
      response: mpData,
      metadata: { provider: 'mercadopago', idempotencyKey, alias: 'card', orderUpdated: !!updatedOrder }
    });

    return res.status(response.status).json({
      ok: response.status >= 200 && response.status < 300,
      approved,
      status: mpData?.status || '',
      statusDetail: mpData?.status_detail || '',
      id: mpData?.id ? String(mpData.id) : '',
      paymentId: mpData?.id ? String(mpData.id) : '',
      paymentMethod: 'card',
      method: 'card',
      data: mpData,
      raw: mpData,
      order: updatedOrder ? toJSON(updatedOrder) : null
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao criar pagamento cartão no Mercado Pago' });
  }
});

async function getMercadoPagoPaymentById(paymentId) {
  const id = String(paymentId || '').trim();
  if (!id) return null;
  const headers = await buildMercadoPagoHeaders();
  const response = await axios.get(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(id)}`, {
    headers,
    timeout: 30000,
    validateStatus: () => true
  });
  if (response.status >= 200 && response.status < 300) return response.data || null;
  await writeAuditLog({
    scope: 'payments',
    eventType: 'mercadopago_payment_lookup_error',
    status: 'error',
    statusCode: response.status,
    request: { paymentId: id },
    response: response.data,
    metadata: { provider: 'mercadopago' }
  });
  return null;
}

function resolveOrderIdFromMpPayment(mpData = {}, fallbackOrderId = '') {
  return String(
    fallbackOrderId ||
    mpData?.metadata?.orderId ||
    mpData?.metadata?.order_id ||
    mpData?.external_reference ||
    ''
  ).trim();
}

function orderStatusFromMercadoPago(mpStatus = '', paymentMethod = '') {
  const status = String(mpStatus || '').toLowerCase();
  const method = String(paymentMethod || '').toLowerCase();
  if (status === 'approved') return { status: 'pago', statusLabel: 'Pagamento aprovado' };
  if (['pending', 'in_process', 'authorized'].includes(status)) {
    if (method === 'bolbradesco') return { status: 'aguardando_pagamento', statusLabel: 'Aguardando pagamento do boleto' };
    if (method === 'pix') return { status: 'aguardando_pagamento', statusLabel: 'Aguardando pagamento Pix' };
    return { status: 'aguardando_pagamento', statusLabel: 'Aguardando pagamento' };
  }
  if (['rejected', 'cancelled'].includes(status)) return { status: 'recusado', statusLabel: 'Pagamento recusado/cancelado' };
  if (['refunded', 'charged_back'].includes(status)) return { status: 'estornado', statusLabel: 'Pagamento estornado/contestato' };
  return { status: 'pendente', statusLabel: 'Pagamento pendente' };
}

async function updateOrderFromMercadoPagoPayment(mpData = {}, fallbackOrderId = '', origin = 'mercadopago') {
  const orderId = resolveOrderIdFromMpPayment(mpData, fallbackOrderId);
  const oid = normalizeObjectId(orderId);
  if (!oid) return { skipped: true, reason: 'missing_or_invalid_order_id', orderId };

  const before = await Order.findById(oid);
  if (!before) return { skipped: true, reason: 'order_not_found', orderId };

  const method = String(mpData?.payment_method_id || '').trim();
  const mapped = orderStatusFromMercadoPago(mpData?.status, method);
  const normalized = normalizeMercadoPagoPaymentResponse(mpData || {});

  const patch = {
    status: mapped.status,
    statusLabel: mapped.statusLabel,
    payment: {
      ...(before.payment || {}),
      provider: 'mercadopago',
      method: method === 'bolbradesco' ? 'boleto' : (method || before.payment?.method || ''),
      paymentId: mpData?.id ? String(mpData.id) : (before.payment?.paymentId || ''),
      mercadoPagoId: mpData?.id ? String(mpData.id) : (before.payment?.mercadoPagoId || ''),
      status: mpData?.status || '',
      statusDetail: mpData?.status_detail || '',
      boletoUrl: normalized.ticketUrl || before.payment?.boletoUrl || '',
      ticketUrl: normalized.ticketUrl || before.payment?.ticketUrl || '',
      linhaDigitavel: normalized.linhaDigitavel || before.payment?.linhaDigitavel || '',
      barcode: normalized.barcode || before.payment?.barcode || '',
      qrCode: normalized.qrCode || before.payment?.qrCode || '',
      updatedAt: now()
    }
  };

  const after = await Order.findByIdAndUpdate(oid, { $set: patch }, { new: true });

  let saleNotification = null;
  if (String(mpData?.status || '').toLowerCase() === 'approved') {
    saleNotification = await notifySaleAfterPaymentApproved(after, origin);
  }

  const whatsapp = await waMaybeNotifyOrderStatusChange(String(after._id), toJSON(before), toJSON(after), origin);

  await writeAuditLog({
    scope: 'payments',
    eventType: 'order_updated_from_mercadopago',
    orderId: String(after._id),
    status: 'success',
    changedKeys: changedKeys(toJSON(before), toJSON(after)),
    request: { origin, fallbackOrderId },
    response: { paymentId: mpData?.id || null, mpStatus: mpData?.status || null, orderStatus: after.status },
    metadata: { provider: 'mercadopago', whatsapp, saleNotification }
  });

  return { ok: true, order: toJSON(after), whatsapp };
}

app.post('/api/payments/mp/boleto', async (req, res) => {
  try {
    const body = req.body || {};
    const orderId = body.orderId || body.order_id || null;
    const payload = {
      transaction_amount: Number(body.amount || body.total || 0),
      description: body.description || `Pedido Ariana Móveis`,
      payment_method_id: 'bolbradesco',
      payer: buildMercadoPagoPayer(body),
      metadata: { orderId },
      external_reference: orderId ? String(orderId) : undefined,
      notification_url: body.notification_url || `${APP_BASE_URL || 'http://localhost:3000'}/api/webhooks/mercadopago`
    };

    const { response, idempotencyKey } = await createMercadoPagoPayment(payload);
    const mpData = response.data || {};

    let orderUpdate = null;
    let adminWhatsapp = null;

    if (response.status >= 200 && response.status < 300) {
      orderUpdate = await updateOrderFromMercadoPagoPayment(mpData, orderId, 'mercadopago_boleto_created');

      // Boleto criado ainda não é venda concluída. Só notifica quando o webhook confirmar pagamento aprovado.
      adminWhatsapp = { skipped: true, reason: 'waiting_boleto_payment_approval' };
    }

    await writeAuditLog({
      scope: 'payments',
      eventType: 'mercadopago_boleto_created',
      orderId: orderId || null,
      status: response.status >= 200 && response.status < 300 ? 'success' : 'error',
      statusCode: response.status,
      request: payload,
      response: mpData,
      metadata: { provider: 'mercadopago', idempotencyKey, orderUpdate, adminWhatsapp }
    });

    if (response.status >= 200 && response.status < 300) {
      return res.status(response.status).json({
        ...normalizeMercadoPagoPaymentResponse(mpData),
        orderUpdate,
        adminWhatsapp
      });
    }

    return res.status(response.status).json({
      ok: false,
      error: mpData?.message || mpData?.cause?.[0]?.description || 'Erro ao criar boleto',
      details: mpData
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao criar boleto no Mercado Pago' });
  }
});

app.post('/api/webhooks/mercadopago', async (req, res) => {
  try {
    const payload = req.body || {};
    const paymentId = payload.data?.id ? String(payload.data.id) : (payload.id ? String(payload.id) : '');
    const mpData = paymentId ? await getMercadoPagoPaymentById(paymentId) : null;
    const orderId = resolveOrderIdFromMpPayment(mpData || {}, payload.orderId || payload.external_reference || '');

    const event = await PaymentEvent.create({
      provider: 'mercadopago',
      eventType: payload.type || payload.action || 'unknown',
      externalId: paymentId || null,
      orderId: orderId || null,
      payload
    });

    let orderUpdate = null;
    if (mpData) {
      orderUpdate = await updateOrderFromMercadoPagoPayment(mpData, orderId, 'mercadopago_webhook');
    }

    await writeAuditLog({
      scope: 'payments',
      eventType: 'mercadopago_webhook_received',
      orderId: orderId || event.orderId || null,
      status: 'received',
      request: payload,
      response: mpData || null,
      metadata: { provider: 'mercadopago', orderUpdate }
    });

    return res.json({ ok: true, received: true, orderUpdate });
  } catch (error) {
    console.error('Erro ao processar webhook do Mercado Pago:', error.message || error);
    return res.status(500).json({ ok: false, error: 'Erro ao processar webhook do Mercado Pago' });
  }
});



app.post('/api/admin/sellers/:sellerId/pagarme-recipient', adminRequired, async (req, res) => {
  try {
    const sid = String(req.params.sellerId || '').trim();
    const sellerDoc = await Seller.findOne({ sellerId: sid }) || await Seller.findById(normalizeObjectId(sid)).catch(() => null);
    if (!sellerDoc) return res.status(404).json({ ok: false, error: 'Seller não encontrado.' });
    const payload = buildPagarmeRecipientPayloadFromSeller(sellerDoc, req.body || {});
    const response = await createPagarmeRecipient(payload);
    const data = response.data || {};
    if (response.status < 200 || response.status >= 300) return res.status(response.status).json({ ok: false, error: data?.message || data?.errors?.[0]?.message || 'Erro ao criar Recipient Pagar.me', details: data });
    const normalized = normalizePagarmeRecipientResponse(data);
    if (!normalized.id) return res.status(500).json({ ok: false, error: 'Pagar.me não retornou Recipient ID.', details: data });
    const meta = { ...(sellerDoc.metadata || {}), ...(req.body || {}) };
    meta.paymentGateway = 'pagarme';
    meta.marketplaceSplitRequired = true;
    meta.manualTransferEnabled = false;
    meta.pagarmeRecipientId = normalized.id;
    meta.pagarmeRecipientStatus = normalized.status;
    meta.pagarmeRecipientCreatedAt = new Date().toISOString();
    const seller = await Seller.findByIdAndUpdate(sellerDoc._id, { $set: { metadata: meta } }, { new: true });
    await writeAuditLog({ scope: 'payments', eventType: 'pagarme_recipient_created_by_admin', status: 'success', request: redact(payload), response: redact(data), metadata: { sellerId: seller.sellerId || String(seller._id), admin: req.admin?.email || '' } });
    return res.json({ ok: true, recipientId: normalized.id, recipient: normalized, seller: toJSON(seller) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao criar Recipient Pagar.me', requiredFields: error.requiredFields || undefined });
  }
});

app.get('/api/payments/split/preview/:orderId', adminRequired, async (req, res) => {
  try {
    const oid = normalizeObjectId(req.params.orderId);
    if (!oid) return res.status(400).json({ ok: false, error: 'ID inválido' });
    const order = await Order.findById(oid);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado' });
    const summary = await buildSellerSplitSummary(order, req.query.sellerId || '');
    return res.json(summary);
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao calcular split' });
  }
});

app.post('/api/payments/cielo/credit', async (_req, res) => res.status(410).json({ ok: false, provider: 'cielo', error: 'Cielo desativada. Marketplace Ariana usa Pagar.me Split obrigatório.' }));

app.post('/api/payments/pagarme/pix', async (req, res) => {
  try {
    const body = req.body || {};
    const orderId = body.orderId || body.order_id || null;
    const order = normalizeObjectId(orderId) ? await Order.findById(orderId) : null;
    let payload = buildPagarmePixPayload(body, order);
    const splitSummary = order ? await buildSellerSplitSummary(order) : { sellers: [], totalMarketplaceAmount: 0 };
    const paymentSettingsForSplit = await getPaymentsSettings();
    payload.settings = { marketplaceRecipientId: paymentSettingsForSplit.pagarme?.marketplaceRecipientId || process.env.PAGARME_MARKETPLACE_RECIPIENT_ID || '' };
    payload = applyPagarmeSplitToPayload(payload, splitSummary);
    delete payload.settings;
    const response = await createPagarmeOrder(payload);
    const pagarmeData = response.data || {};
    const normalized = normalizePagarmePixResponse(pagarmeData);
    const updatedOrder = response.status >= 200 && response.status < 300 ? await updateOrderPaymentFromPagarme(orderId, pagarmeData, { method: 'pix', type: 'pix', qrCode: normalized.qrCode }) : null;
    await writeAuditLog({ scope: 'payments', eventType: 'pagarme_pix_created', orderId: orderId || null, status: response.status >= 200 && response.status < 300 ? 'success' : 'error', statusCode: response.status, request: payload, response: pagarmeData, metadata: { provider: 'pagarme', orderUpdated: !!updatedOrder, splitSummary } });
    return res.status(response.status).json({ ...normalized, order: updatedOrder ? toJSON(updatedOrder) : null });
  } catch (error) {
    const status = error?.response?.status || 500;
    const details = error?.response?.data || null;
    return res.status(status).json({ ok: false, provider: 'pagarme', error: details?.message || details?.errors?.[0]?.message || error.message || 'Erro ao criar Pix no Pagar.me', details });
  }
});

app.post('/api/payments/pagarme/boleto', async (req, res) => {
  try {
    const body = req.body || {};
    const orderId = body.orderId || body.order_id || null;
    const order = normalizeObjectId(orderId) ? await Order.findById(orderId) : null;
    let payload = buildPagarmeBoletoPayload(body, order);
    const splitSummary = order ? await buildSellerSplitSummary(order) : { sellers: [], totalMarketplaceAmount: 0 };
    const paymentSettingsForSplit = await getPaymentsSettings();
    payload.settings = { marketplaceRecipientId: paymentSettingsForSplit.pagarme?.marketplaceRecipientId || process.env.PAGARME_MARKETPLACE_RECIPIENT_ID || '' };
    payload = applyPagarmeSplitToPayload(payload, splitSummary);
    delete payload.settings;
    const response = await createPagarmeOrder(payload);
    const pagarmeData = response.data || {};
    const normalized = normalizePagarmeBoletoResponse(pagarmeData);
    const updatedOrder = response.status >= 200 && response.status < 300 ? await updateOrderPaymentFromPagarme(orderId, pagarmeData, { method: 'boleto', type: 'boleto', ticketUrl: normalized.ticketUrl }) : null;
    await writeAuditLog({ scope: 'payments', eventType: 'pagarme_boleto_created', orderId: orderId || null, status: response.status >= 200 && response.status < 300 ? 'success' : 'error', statusCode: response.status, request: payload, response: pagarmeData, metadata: { provider: 'pagarme', orderUpdated: !!updatedOrder, splitSummary } });
    return res.status(response.status).json({ ...normalized, order: updatedOrder ? toJSON(updatedOrder) : null });
  } catch (error) {
    const status = error?.response?.status || 500;
    const details = error?.response?.data || null;
    return res.status(status).json({ ok: false, provider: 'pagarme', error: details?.message || details?.errors?.[0]?.message || error.message || 'Erro ao criar boleto no Pagar.me', details });
  }
});

app.get('/api/payments/pagarme/public-key', async (_req, res) => {
  try {
    const settings = await getPaymentsSettings();
    const publicKey = settings.pagarme?.publicKey || process.env.PAGARME_PUBLIC_KEY || '';
    if (!publicKey) return res.status(500).json({ ok: false, error: 'Pagar.me public key não configurada.' });
    return res.json({ ok: true, publicKey, endpoint: settings.pagarme?.endpoint || process.env.PAGARME_API_URL || 'https://api.pagar.me/core/v5' });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao obter public key Pagar.me.' });
  }
});

app.post('/api/payments/pagarme/credit', async (req, res) => {
  try {
    const body = req.body || {};
    const orderId = body.orderId || body.order_id || null;
    const order = normalizeObjectId(orderId) ? await Order.findById(orderId) : null;
    let payload = buildPagarmeCreditPayload(body, order);
    const splitSummary = order ? await buildSellerSplitSummary(order) : { sellers: [], totalMarketplaceAmount: 0 };
    const paymentSettingsForSplit = await getPaymentsSettings();
    payload.settings = { marketplaceRecipientId: paymentSettingsForSplit.pagarme?.marketplaceRecipientId || process.env.PAGARME_MARKETPLACE_RECIPIENT_ID || '' };
    payload = applyPagarmeSplitToPayload(payload, splitSummary);
    delete payload.settings;

    const response = await createPagarmeOrder(payload);
    const pagarmeData = response.data || {};
    const normalizedStatus = getPagarmeStatus(pagarmeData);
    const approved = normalizedStatus === 'approved';
    const charge = getPagarmeCharge(pagarmeData) || {};
    const tx = getPagarmeTransaction(pagarmeData) || {};

    const updatedOrder = response.status >= 200 && response.status < 300
      ? await updateOrderPaymentFromPagarme(orderId, pagarmeData, { installments: Number(body.installments || 1) || 1 })
      : null;

    await writeAuditLog({
      scope: 'payments',
      eventType: 'pagarme_card_created',
      orderId: orderId || null,
      status: response.status >= 200 && response.status < 300 ? 'success' : 'error',
      statusCode: response.status,
      request: payload,
      response: pagarmeData,
      metadata: { provider: 'pagarme', orderUpdated: !!updatedOrder, splitSummary }
    });

    return res.status(response.status).json({
      ok: response.status >= 200 && response.status < 300,
      approved,
      status: normalizedStatus,
      statusDetail: getPagarmeGatewayMessage(pagarmeData),
      id: String(charge.id || tx.id || pagarmeData.id || ''),
      paymentId: String(charge.id || tx.id || pagarmeData.id || ''),
      paymentMethod: 'card',
      method: 'card',
      provider: 'pagarme',
      data: pagarmeData,
      raw: pagarmeData,
      order: updatedOrder ? toJSON(updatedOrder) : null
    });
  } catch (error) {
    const status = error?.response?.status || 500;
    const details = error?.response?.data || null;
    return res.status(status).json({
      ok: false,
      provider: 'pagarme',
      error: details?.message || details?.errors?.[0]?.message || error.message || 'Erro ao criar pagamento cartão no Pagar.me',
      details
    });
  }
});

app.post('/api/payments/pagarme/order', async (req, res) => { try { const payload = req.body || {}; const response = await createPagarmeOrder(payload); await writeAuditLog({ scope: 'payments', eventType: 'pagarme_order_created', orderId: payload.metadata?.orderId || payload.orderId || null, status: response.status >= 200 && response.status < 300 ? 'success' : 'error', statusCode: response.status, request: payload, response: response.data, metadata: { provider: 'pagarme' } }); return res.status(response.status).json({ ok: response.status >= 200 && response.status < 300, data: response.data }); } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Erro ao criar pedido no Pagar.me' }); } });
app.post('/api/webhooks/pagarme', async (req, res) => {
  try {
    const payload = req.body || {};
    const data = payload.data || payload;
    const orderId = data?.metadata?.orderId || data?.order?.metadata?.orderId || payload.orderId || null;
    const event = await PaymentEvent.create({
      provider: 'pagarme',
      eventType: payload.type || payload.event || 'unknown',
      externalId: payload.id ? String(payload.id) : (data.id ? String(data.id) : null),
      orderId,
      payload
    });
    let orderUpdate = null;
    if (orderId && (data.status || data.charges || data.amount)) {
      orderUpdate = await updateOrderPaymentFromPagarme(orderId, data, { origin: 'pagarme_webhook' });
    }
    await writeAuditLog({ scope: 'payments', eventType: 'pagarme_webhook_received', orderId: event.orderId || null, status: 'received', request: payload, metadata: { provider: 'pagarme', orderUpdate } });
    return res.json({ ok: true, orderUpdate });
  } catch (_error) {
    return res.status(500).json({ ok: false, error: 'Erro ao processar webhook do Pagar.me' });
  }
});
app.get('/api/admin/runtime', adminRequired, async (_req, res) => { const whatsapp = await getWhatsappSettings(); const shipping = await getShippingSettings(); const payments = await getPaymentsSettings(); return res.json({ ok: true, buildId: BUILD_ID, runtime: { nodeEnv: process.env.NODE_ENV || 'development', port: PORT, appBaseUrl: APP_BASE_URL || null, contaboPublicUrl: process.env.CONTABO_PUBLIC_URL || null, evolutionApiUrl: whatsapp.apiUrl || null, evolutionInstance: whatsapp.instanceName || null, mongoDb: MONGODB_DB }, integrations: { whatsapp: redactWhatsappSettings(whatsapp), shipping, payments: redact(payments) } }); });
app.use((error, _req, res, _next) => { console.error('❌ Erro não tratado:', error); return res.status(500).json({ ok: false, error: error.message || 'Erro interno' }); });

app.get('/api/shipping/correios/debug', async (_req, res) => { const cfg = correiosCfg(await getShippingSettings()); return res.json({ ok: true, CORREIOS_USER: cfg.user ? 'OK' : 'MISSING', CORREIOS_PASS: cfg.pass ? 'OK' : 'MISSING', CORREIOS_CARTAO: cfg.cartao ? 'OK' : 'MISSING', CORREIOS_CONTRATO: cfg.contrato ? 'OK' : 'MISSING', CORREIOS_DR: cfg.dr || '0', CORREIOS_SERVICOS: (cfg.services || []).join(','), LOJA_ORIGEM_CEP: cfg.originCep ? 'OK' : 'MISSING' }); });
app.get('/api/shipping/correios/token-test', async (_req, res) => { try { const token = await getCorreiosToken(await getShippingSettings()); return res.json({ ok: true, tokenPreview: String(token).slice(0, 16) + '...' }); } catch (e) { const err = safeAxiosError(e); return res.status(err.status || 500).json({ ok: false, stage: 'token', error: err.message, correios: err.data }); } });
app.post('/api/shipping/correios/quote', async (req, res) => { try { return res.json(await quoteCorreios(req.body || {}, await getShippingSettings())); } catch (e) { const err = safeAxiosError(e); return res.status(err.status || 500).json({ ok: false, error: err.message, correios: err.data }); } });
app.post('/shipping/correios/quote', async (req, res) => { try { return res.json(await quoteCorreios(req.body || {}, await getShippingSettings())); } catch (e) { const err = safeAxiosError(e); return res.status(err.status || 500).json({ ok: false, error: err.message, correios: err.data }); } });
app.get('/api/shipping/correios/tracking/:code', async (req, res) => { try { const code = String(req.params.code || '').trim(); if (!code) return res.status(400).json({ ok: false, error: 'tracking_code_required' }); const order = await Order.findOne({ $or: [{ trackingCode: code }, { 'shipping.trackingCode': code }, { 'payment.externalReference': code }] }).sort({ createdAt: -1 }); if (!order) return res.status(404).json({ ok: false, error: 'tracking_not_found' }); return res.json({ ok: true, trackingCode: code, orderId: String(order._id), status: order.status || null, statusLabel: order.statusLabel || null, customerName: order.customerName || null, trackingHistory: order.trackingHistory || [], shipping: order.shipping || null }); } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'tracking_failed' }); } });
app.get('/api/shipping/correios/label/:orderId/html', async (req, res) => { try { const order = await Order.findById(req.params.orderId); if (!order) return res.status(404).send('Pedido não encontrado'); const addr = order.shippingAddress || {}; const items = Array.isArray(order.items) ? order.items : []; const html = `<!DOCTYPE html><html lang="pt-br"><head><meta charset="utf-8"><title>Etiqueta ${String(order._id)}</title><style>body{font-family:Arial,sans-serif;padding:24px} .box{border:2px solid #111;padding:24px;max-width:760px} .muted{color:#555;font-size:12px} h1{margin:0 0 12px} .row{margin:8px 0}</style></head><body><div class="box"><h1>Ariana Móveis - Etiqueta</h1><div class="row"><strong>Pedido:</strong> ${String(order._id)}</div><div class="row"><strong>Destinatário:</strong> ${String(order.customerName || addr.name || '')}</div><div class="row"><strong>Telefone:</strong> ${String(order.customerPhone || addr.phone || '')}</div><div class="row"><strong>Endereço:</strong> ${String(addr.logradouro || '')}, ${String(addr.numero || '')} - ${String(addr.bairro || '')}</div><div class="row"><strong>Cidade/UF:</strong> ${String(addr.cidade || '')}/${String(addr.uf || '')} - CEP ${String(addr.cep || '')}</div><div class="row"><strong>Itens:</strong> ${items.map(i => `${String(i.name || 'Item')} x${Number(i.qty || 1)}`).join(', ')}</div><div class="row"><strong>Código de rastreio:</strong> ${String(order.trackingCode || '') || '—'}</div><div class="muted">Etiqueta HTML de contingência. A etiqueta operacional oficial depende do fluxo contratado dos Correios.</div></div></body></html>`; res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.send(html); } catch (error) { return res.status(500).send(error.message || 'Erro ao gerar etiqueta'); } });



app.post('/api/admin/login', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || req.body?.senha || '');
    if (!email || !password) return res.status(400).json({ ok: false, error: 'email_password_required' });

    let adminUser = null;

    if (ADMIN_EMAIL && ADMIN_PASSWORD && email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
      adminUser = {
        id: 'env-admin',
        userId: 'env-admin',
        uid: 'env-admin',
        email,
        role: 'admin',
        admin: true,
        active: true,
        name: ADMIN_NAME
      };
    } else {
      const user = await User.findOne({ email });
      if (user && ['admin', 'staff'].includes(String(user.role || '').toLowerCase()) && user.isActive !== false) {
        let valid = false;

        if (user.passwordHash) {
          try {
            valid = await bcrypt.compare(password, user.passwordHash);
          } catch (_error) {
            valid = false;
          }
        }

        if (!valid && typeof user.password === 'string' && user.password) {
          valid = password === user.password;
        }

        if (!valid && typeof user.senha === 'string' && user.senha) {
          valid = password === user.senha;
        }

        if (valid) {
          const role = String(user.role || '').toLowerCase() === 'staff' ? 'staff' : 'admin';
          adminUser = {
            id: String(user._id),
            userId: String(user._id),
            uid: String(user._id),
            email: String(user.email || email).trim().toLowerCase(),
            role,
            admin: role === 'admin',
            active: user.isActive !== false,
            name: user.name || (role === 'admin' ? ADMIN_NAME : 'Colaborador'),
            permissions: Array.isArray(user.permissions) ? user.permissions : []
          };
        }
      }
    }

    if (!adminUser) {
      return res.status(401).json({
        ok: false,
        error: 'invalid_admin_credentials',
        message: 'E-mail ou senha de administrador inválidos.'
      });
    }

    const token = signAdminToken(adminUser);
    return res.json({
      ok: true,
      token,
      id: adminUser.id,
      userId: adminUser.userId,
      uid: adminUser.uid,
      email: adminUser.email,
      role: 'admin',
      admin: true,
      active: adminUser.active !== false,
      name: adminUser.name || ADMIN_NAME,
      user: adminUser
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'admin_login_failed' });
  }
});

app.get('/api/admin/me', adminRequired, async (req, res) => {
  const admin = req.admin || req.user || {};
  const role = String(admin.role || 'admin').toLowerCase();
  return res.json({
    ok: true,
    id: String(admin.id || admin.uid || admin._id || 'admin'),
    email: admin.email || '',
    role,
    admin: role === 'admin' || admin.admin === true,
    name: admin.name || (role === 'admin' ? ADMIN_NAME : 'Colaborador'),
    permissions: Array.isArray(admin.permissions) ? admin.permissions : []
  });
});

app.get('/api/admin/store-settings', adminRequired, async (_req, res) => {
  try {
    const payments = await getPaymentsSettings();
    const shipping = await getShippingSettings();
    return res.json({
      ok: true,
      settings: {
        payments: {
          mercadopago: {
            publicKey: payments?.mercadopago?.publicKey || '',
            mode: payments?.mercadopago?.mode || 'prod',
            enablePix: payments?.mercadopago?.enablePix !== false,
            enableCard: payments?.mercadopago?.enableCard !== false,
            enableBoleto: payments?.mercadopago?.enableBoleto !== false,
            enabled: payments?.mercadopago?.enabled !== false,
            splitEnabled: payments?.mercadopago?.splitEnabled !== false
          },
          pagarme: payments?.pagarme || {}
        },
        shipping: {
          ...shipping,
          correios: {
            ...(shipping?.correios || {}),
            maxKg: Number(
              shipping?.correios?.maxKg ??
              shipping?.correios?.maxWeightKg ??
              shipping?.carriers?.correios?.maxWeightKg ??
              30
            ),
            maxDimCm: Number(
              shipping?.correios?.maxDimCm ??
              shipping?.correios?.maxDimensionCm ??
              shipping?.carriers?.correios?.maxDimensionCm ??
              100
            )
          },
          heavyCarriers: Array.isArray(shipping?.heavyCarriers)
            ? shipping.heavyCarriers
            : [],
          manualRules: Array.isArray(shipping?.manualRules)
            ? shipping.manualRules
            : []
        }
      }
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'store_settings_read_failed' });
  }
});

app.put('/api/admin/store-settings', adminRequired, async (req, res) => {
  try {
    const body = req.body || {};
    const updatedBy = String((req.user && (req.user._id || req.user.id || req.user.uid || req.user.email)) || 'admin');

    let paymentsSettings = await getPaymentsSettings();
    let shippingSettings = await getShippingSettings();

    if (body.payments && body.payments.mercadopago) {
      paymentsSettings = {
        ...paymentsSettings,
        mercadopago: {
          ...(paymentsSettings?.mercadopago || {}),
          ...(body.payments.mercadopago || {})
        },
        pagarme: {
          ...(paymentsSettings?.pagarme || {})
        }
      };
      await setSetting('payments', paymentsSettings, updatedBy);
    }

    if (body.shipping) {
      const incomingShipping = body.shipping || {};
      shippingSettings = {
        ...shippingSettings,
        ...incomingShipping,
        correios: {
          ...(shippingSettings?.correios || {}),
          ...(incomingShipping.correios || {})
        },
        heavyCarriers: Array.isArray(incomingShipping.heavyCarriers)
          ? incomingShipping.heavyCarriers
          : (Array.isArray(shippingSettings?.heavyCarriers) ? shippingSettings.heavyCarriers : []),
        manualRules: Array.isArray(incomingShipping.manualRules)
          ? incomingShipping.manualRules
          : (Array.isArray(shippingSettings?.manualRules) ? shippingSettings.manualRules : [])
      };

      if (shippingSettings.correios) {
        if (shippingSettings.correios.maxKg !== undefined) {
          shippingSettings.correios.maxWeightKg = Number(shippingSettings.correios.maxKg || 30);
        }
        if (shippingSettings.correios.maxDimCm !== undefined) {
          shippingSettings.correios.maxDimensionCm = Number(shippingSettings.correios.maxDimCm || 100);
        }
      }

      await setSetting('shipping', shippingSettings, updatedBy);
    }

    const finalPayments = await getPaymentsSettings();
    const finalShipping = await getShippingSettings();

    return res.json({
      ok: true,
      settings: {
        payments: finalPayments,
        shipping: {
          ...finalShipping,
          correios: {
            ...(finalShipping?.correios || {}),
            maxKg: Number(
              finalShipping?.correios?.maxKg ??
              finalShipping?.correios?.maxWeightKg ??
              finalShipping?.carriers?.correios?.maxWeightKg ??
              30
            ),
            maxDimCm: Number(
              finalShipping?.correios?.maxDimCm ??
              finalShipping?.correios?.maxDimensionCm ??
              finalShipping?.carriers?.correios?.maxDimensionCm ??
              100
            )
          },
          heavyCarriers: Array.isArray(finalShipping?.heavyCarriers) ? finalShipping.heavyCarriers : [],
          manualRules: Array.isArray(finalShipping?.manualRules) ? finalShipping.manualRules : []
        }
      }
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'store_settings_save_failed' });
  }
});

app.patch('/api/admin/store-settings', adminRequired, async (req, res) => {
  req.method = 'PUT';
  return app._router.handle(req, res, () => {});
});




function uploadBufferToCloudinary(buffer, options = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: options.folder || 'ariana_moveis/posters',
        public_id: options.public_id,
        resource_type: 'image',
        overwrite: true,
        format: 'png'
      },
      (error, result) => {
        if (error) return reject(error);
        return resolve(result);
      }
    );
    stream.end(buffer);
  });
}



function pickProductImage(product = {}) {
  const imgs = Array.isArray(product.images) ? product.images : [];
  const main = imgs.find((img) => img && img.isMain && (img.url || img.imageUrl)) || imgs.find((img) => img && (img.url || img.imageUrl));
  return String(product.mainImageUrl || product.imageUrl || product.image || product.imagem || main?.url || main?.imageUrl || '').trim();
}

function normalizeBannerText(value = '') {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function productBannerGroup(product = {}) {
  const text = normalizeBannerText(`${product.name || ''} ${product.title || ''} ${product.category || ''} ${product.categoryName || ''} ${product.description || ''}`);
  if (/colch|cama box|travesseiro|pillow/.test(text)) return 'colchoes';
  if (/smart\s*tv|televis|\btv\b|roku|monitor/.test(text)) return 'tvs';
  if (/smartphone|celular|iphone|galaxy|motorola|moto\s*g/.test(text)) return 'celulares';
  if (/caixa de som|som|audio|amplificad|speaker|bluetooth|antena/.test(text)) return 'som';
  if (/ar condicionado|climatizador|ventilador|ventisol|turbo/.test(text)) return 'climatizacao';
  if (/notebook|computador|informatica|impressora|teclado|mouse|tablet/.test(text)) return 'informatica';
  if (/geladeira|refrigerador|freezer|lavadora|maquina de lavar|tanquinho|fogao|fogão|cooktop|forno|micro-ondas|microondas|air fryer|fritadeira|eletrodomestico|eletrodoméstico/.test(text)) return 'eletrodomesticos';
  if (/guarda[- ]?roupa|roupeiro|sofa|sof[aá]|rack|painel|mesa|cadeira|cozinha|armario|armário|comoda|cômoda|balcao|balcão|multiuso|moveis|móveis/.test(text)) return 'moveis';
  return 'geral';
}

const BANNER_GROUP_RULES = {
  moveis: /m[oó]veis|guarda[- ]?roupa|roupeiro|sof[aá]|rack|painel|mesa|cadeira|cozinha|arm[aá]rio|c[oô]moda|balc[aã]o|multiuso/i,
  eletrodomesticos: /eletrodom[eé]sticos|geladeira|refrigerador|freezer|lavadora|m[aá]quina de lavar|tanquinho|fog[aã]o|cooktop|forno|micro[- ]?ondas|air fryer|fritadeira/i,
  colchoes: /colch[oõ]es?|cama box|travesseiro|pillow/i,
  celulares: /smartphone|celular|iphone|galaxy|motorola|moto\s*g/i,
  tvs: /smart\s*tv|televis[aã]o|\btv\b|roku|monitor/i,
  som: /som|[aá]udio|caixa de som|amplificada|bluetooth|antena/i,
  climatizacao: /ar condicionado|climatizador|ventilador|ventisol|turbo/i,
  informatica: /inform[aá]tica|notebook|computador|impressora|teclado|mouse|tablet/i
};

function regexForBannerGroup(group = '') {
  return BANNER_GROUP_RULES[String(group || '').trim()] || null;
}

function bannerCopyForDefinition(def = {}, products = []) {
  const group = String(def.group || productBannerGroup(products[0] || {}) || 'geral').trim();

  // Textos de campanha por CATEGORIA, não por produto individual.
  // Assim o banner fica profissional: mostra produtos da categoria e uma chamada geral da seção.
  const copies = {
    moveis: [
      'As melhores ofertas de móveis você encontra aqui',
      'Ambientes completos, bonitos e funcionais para transformar sua casa.'
    ],
    eletrodomesticos: [
      'Eletrodomésticos com as melhores condições de pagamento',
      'Geladeiras, lavadoras, fogões e utilidades para facilitar seu dia a dia.'
    ],
    colchoes: [
      'Conforto de verdade para suas noites de descanso',
      'Colchões selecionados com qualidade, preço justo e compra segura.'
    ],
    celulares: [
      'Tecnologia que acompanha sua rotina',
      'Smartphones selecionados com ofertas especiais para você aproveitar mais.'
    ],
    tvs: [
      'Imagem de cinema para sua sala',
      'Smart TVs selecionadas para transformar seus momentos em família.'
    ],
    som: [
      'Som de qualidade para todos os momentos',
      'Caixas, áudio e acessórios selecionados com ofertas especiais.'
    ],
    climatizacao: [
      'Mais conforto para sua casa todos os dias',
      'Ventiladores e climatização com preço especial para deixar seu ambiente melhor.'
    ],
    informatica: [
      'Os melhores produtos eletrônicos e tecnologia do mercado',
      'Produtos escolhidos para transformar sua vida num verdadeiro sonho.'
    ],
    geral: [
      def.title || 'Ofertas selecionadas Ariana Móveis',
      def.subtitle || 'Produtos escolhidos com qualidade, preço especial e compra segura.'
    ]
  };

  const [title, subtitle] = copies[group] || copies.geral;
  return { title, subtitle };
}

async function loadRemoteImageAsPng(url, width, height) {
  if (!url) return null;

  try {
    const { default: sharp } = await import('sharp');
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      headers: { 'User-Agent': 'ArianaMoveisBannerBot/2.0' }
    });

    const source = Buffer.from(response.data);

    // IMPORTANTE:
    // O código anterior transformava pixels brancos em transparência.
    // Isso estragava produto branco/cinza, como guarda-roupa, geladeira, ventilador e TV.
    // Agora a imagem é tratada com fundo branco preservado, sem apagar partes do produto.
    let img = sharp(source, { failOn: 'none' })
      .rotate()
      .flatten({ background: '#ffffff' });

    // Corta somente a borda branca externa quando possível, sem remover branco do produto.
    try {
      img = img.trim({ background: '#ffffff', threshold: 10 });
    } catch (_error) {
      img = sharp(source, { failOn: 'none' }).rotate().flatten({ background: '#ffffff' });
    }

    return await img
      .resize(Math.round(width), Math.round(height), {
        fit: 'inside',
        position: 'center',
        withoutEnlargement: false,
        kernel: sharp.kernel.lanczos3,
        background: '#ffffff'
      })
      .sharpen({ sigma: 0.45, m1: 0.7, m2: 0.35 })
      .png({ quality: 100, compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
  } catch (error) {
    console.error('Erro ao carregar imagem do produto para banner:', error?.message || error);
    return null;
  }
}

function bannerDraftDefinitions() {
  return [
    { key: 'index_main', targetSlot: 'index_main', title: 'Ofertas imperdíveis', subtitle: 'Preço especial no PIX e parcelamento sem juros', width: 1920, height: 480, productLimit: 3, group: 'moveis', href: 'categoria.html?category=Móveis' },
    { key: 'index_sidebar_vertical', targetSlot: 'index_sidebar_vertical', title: 'Promoção especial', subtitle: 'Escolha seu produto e compre pelo WhatsApp', width: 600, height: 900, productLimit: 1, group: 'tvs', href: 'todos_produtos.html?section=offers' },{ key: 'index_mini_1', targetSlot: 'index_mini_1', title: 'Móveis em destaque', subtitle: 'Renove sua casa com preço especial', width: 800, height: 450, productLimit: 2, group: 'moveis', href: 'categoria.html?category=Móveis' },
    { key: 'index_mini_2', targetSlot: 'index_mini_2', title: 'Som e áudio', subtitle: 'Produtos selecionados para você', width: 800, height: 450, productLimit: 2, group: 'som', href: 'categoria.html?category=Som e Ãudio' },
    { key: 'index_mini_3', targetSlot: 'index_mini_3', title: 'Climatização', subtitle: 'Mais conforto para sua casa', width: 800, height: 450, productLimit: 2, group: 'climatizacao', href: 'categoria.html?category=Ventiladores' },
    { key: 'index_mini_4', targetSlot: 'index_mini_4', title: 'Celulares', subtitle: 'Smartphones com ofertas especiais', width: 800, height: 450, productLimit: 2, group: 'celulares', href: 'categoria.html?category=Smartphones' },
    { key: 'index_mini_5', targetSlot: 'index_mini_5', title: 'Smart TVs', subtitle: 'Imagem de cinema para sua sala', width: 800, height: 450, productLimit: 2, group: 'tvs', href: 'categoria.html?category=Smart Tv' },

    { key: 'index_duo_1', targetSlot: 'index_duo_1', title: 'Lançamentos', subtitle: 'Novidades selecionadas para sua casa', width: 1200, height: 400, productLimit: 2, group: 'moveis', href: 'categoria.html?category=Móveis' },
    { key: 'index_duo_2', targetSlot: 'index_duo_2', title: 'Recomendado pra você', subtitle: 'Produtos escolhidos para vender mais', width: 1200, height: 400, productLimit: 2, group: 'eletrodomesticos', href: 'categoria.html?category=Eletrodomésticos' },

    { key: 'index_secondary_1', targetSlot: 'index_secondary_1', title: 'Queridinhos da internet', subtitle: 'Os produtos mais procurados na Ariana Móveis', width: 1200, height: 350, productLimit: 2, group: 'eletrodomesticos', href: 'categoria.html?category=Eletrodomésticos' },
    { key: 'index_secondary_2', targetSlot: 'index_secondary_2', title: 'Promoção exclusiva', subtitle: 'Selecionamos ofertas para você economizar', width: 1200, height: 350, productLimit: 2, group: 'colchoes', href: 'categoria.html?category=Colchões' },

    { key: 'home_card_1', targetSlot: 'home_card_1', title: 'Eletrodomésticos', subtitle: 'Geladeiras, lavadoras e muito mais', width: 800, height: 800, productLimit: 2, group: 'eletrodomesticos', href: 'categoria.html?category=Eletrodomésticos' },
    { key: 'home_card_2', targetSlot: 'home_card_2', title: 'Informática', subtitle: 'Tecnologia para sua rotina', width: 800, height: 800, productLimit: 2, group: 'informatica', href: 'categoria.html?category=Informática' },
    { key: 'home_card_3', targetSlot: 'home_card_3', title: 'Móveis', subtitle: 'Ambientes bonitos e completos', width: 800, height: 800, productLimit: 2, group: 'moveis', href: 'categoria.html?category=Móveis' },

    { key: 'footer_banner', targetSlot: 'footer_banner', title: 'Mais ofertas para você', subtitle: 'Ariana Móveis: compra fácil pelo site ou WhatsApp', width: 1920, height: 400, productLimit: 3, group: 'colchoes', href: 'categoria.html?category=Colchões' },
    { key: 'header_category_banner', targetSlot: 'header_category_banner', title: 'Categorias Ariana', subtitle: 'Encontre móveis, eletros, colchões e tecnologia', width: 900, height: 520, productLimit: 2, group: 'moveis', href: 'todos_produtos.html' },

    { key: 'produto_detail_horizontal_1', targetSlot: 'produto_detail_horizontal_1', title: 'Complemente sua compra', subtitle: 'Produtos selecionados para combinar com sua casa', width: 1200, height: 350, productLimit: 2, group: 'moveis', href: 'categoria.html?category=Móveis' },
    { key: 'produto_detail_horizontal_2', targetSlot: 'produto_detail_horizontal_2', title: 'Oferta especial Ariana', subtitle: 'Condições imperdíveis por tempo limitado', width: 1200, height: 350, productLimit: 2, group: 'eletrodomesticos', href: 'categoria.html?category=Eletrodomésticos' }
  ];
}

async function selectProductsForBanner(definition, usedIds = new Set(), limit = 3) {
  const base = { active: { $ne: false } };
  const groupRx = regexForBannerGroup(definition.group) || definition.categoryRegex || null;
  const query = groupRx ? {
    ...base,
    $or: [{ category: groupRx }, { categoryName: groupRx }, { name: groupRx }, { description: groupRx }, { brand: groupRx }]
  } : base;

  let docs = await Product.find(query).sort({ isOffer: -1, isHighlight: -1, updatedAt: -1, createdAt: -1 }).limit(limit * 8);
  // Nunca completa banner de categoria com produto de outra família. Se achou só 1, usa só 1.
  docs = docs.filter((doc) => !definition.group || productBannerGroup(normalizeProductForResponse(doc)) === definition.group);

  const chosen = [];
  for (const doc of docs) {
    const id = String(doc._id);
    if (usedIds.has(id) && docs.length > limit) continue;
    chosen.push(doc);
    usedIds.add(id);
    if (chosen.length >= limit) break;
  }
  return chosen.map(normalizeProductForResponse);
}

function bannerShortName(product = '') {
  const name = String(product.name || product.title || 'Oferta especial').trim();
  return name.length > 42 ? `${name.slice(0, 39).trim()}...` : name;
}

function bannerPrice(product = {}) {
  const value = Number(product.pixPrice || product.precoPix || product.price || product.preco || 0);
  if (!Number.isFinite(value) || value <= 0) return '';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

async function generateMarketingBannerBuffer({ title, subtitle, products = [], width = 1600, height = 520, targetSlot = '', group: forcedGroup = '' }) {
  const { default: sharp } = await import('sharp');

  const W = Number(width || 1600);
  const H = Number(height || 520);
  const isVertical = H > W;
  const isSquare = Math.abs(W - H) < 60;
  const isThin = (W / H) >= 3.2;

  const group = String(forcedGroup || productBannerGroup(products[0] || { name: title, category: subtitle }) || 'geral');
  const copy = bannerCopyForDefinition({ title, subtitle, group }, products);
  const safeTitle = xmlEscape(copy.title || title || 'Ariana Móveis');
  const safeSubtitle = xmlEscape(copy.subtitle || subtitle || 'Ofertas selecionadas para você');

  const margin = Math.round(W * (isVertical ? 0.070 : 0.052));
  const R = Math.round(Math.min(W, H) * 0.045);

  const brandFs = Math.max(15, Math.round(Math.min(W, H) * (isThin ? 0.034 : isSquare ? 0.036 : 0.038)));
  const eyebrowFs = Math.max(10, Math.round(Math.min(W, H) * (isThin ? 0.023 : 0.020)));
  const titleFs = Math.max(28, Math.round(Math.min(W, H) * (isThin ? 0.070 : isSquare ? 0.060 : isVertical ? 0.057 : 0.068)));
  const subFs = Math.max(16, Math.round(Math.min(W, H) * (isThin ? 0.032 : isSquare ? 0.028 : isVertical ? 0.027 : 0.032)));
  const ctaH = Math.max(42, Math.round(H * (isThin ? 0.145 : isSquare ? 0.088 : isVertical ? 0.070 : 0.128)));
  const ctaW = Math.round(W * (isVertical ? 0.62 : isSquare ? 0.43 : isThin ? 0.25 : 0.32));
  const textW = isVertical ? Math.round(W * 0.84) : Math.round(W * (isThin ? 0.43 : isSquare ? 0.45 : 0.44));

  const brandY = Math.round(H * (isThin ? 0.14 : 0.112));
  const titleTop = Math.round(H * (isThin ? 0.240 : isSquare ? 0.150 : isVertical ? 0.160 : 0.205));
  const titleBoxH = Math.round(titleFs * (isThin ? 2.0 : isVertical ? 2.75 : 2.30));
  const subTop = Math.round(titleTop + titleBoxH + H * 0.012);
  const ctaX = margin;
  const ctaY = Math.round(H - ctaH - H * (isThin ? 0.125 : 0.085));
  const phoneFs = Math.max(10, Math.round(Math.min(W, H) * (isThin ? 0.024 : 0.019)));

  const bg = Buffer.from(`
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#003A90"/>
          <stop offset="45%" stop-color="#0057CB"/>
          <stop offset="100%" stop-color="#041D47"/>
        </linearGradient>
        <linearGradient id="shine" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.20"/>
          <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
        </linearGradient>
        <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="#001E4D" flood-opacity="0.34"/>
        </filter>
      </defs>
      <rect width="${W}" height="${H}" rx="${R}" fill="url(#bg)"/>
      <circle cx="${Math.round(W * 0.80)}" cy="${Math.round(-H * 0.08)}" r="${Math.round(Math.min(W, H) * 0.75)}" fill="url(#shine)"/>
      <circle cx="${Math.round(W * 0.96)}" cy="${Math.round(H * 0.92)}" r="${Math.round(Math.min(W, H) * 0.55)}" fill="#F7C600" opacity="0.18"/>
      <circle cx="${Math.round(W * 0.63)}" cy="${Math.round(H * 0.58)}" r="${Math.round(Math.min(W, H) * 0.25)}" fill="#ffffff" opacity="0.07"/>

      <rect x="${margin}" y="${Math.round(brandY - brandFs * 0.90)}" width="${Math.round(brandFs * 8.6)}" height="${Math.round(brandFs * 1.38)}" rx="${Math.round(brandFs * 0.40)}" fill="#ffffff" opacity="0.10"/>
      <text x="${margin + Math.round(brandFs * 0.42)}" y="${brandY}" font-family="Inter, Arial, Helvetica, sans-serif" font-size="${brandFs}" font-weight="950" fill="#F7C600">ARIANA MÓVEIS</text>
      <text x="${margin}" y="${Math.round(brandY + brandFs * 1.35)}" font-family="Inter, Arial, Helvetica, sans-serif" font-size="${eyebrowFs}" font-weight="900" fill="#DDEBFF">OFERTAS SELECIONADAS • COMPRA SEGURA</text>

      <foreignObject x="${margin}" y="${titleTop}" width="${textW}" height="${titleBoxH}">
        <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Inter,Arial,Helvetica,sans-serif;font-size:${titleFs}px;font-weight:950;line-height:1.02;color:#ffffff;letter-spacing:-1px;text-shadow:0 5px 14px rgba(0,0,0,.22);">${safeTitle}</div>
      </foreignObject>
      <foreignObject x="${margin}" y="${subTop}" width="${textW}" height="${Math.round(subFs * 4.2)}">
        <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Inter,Arial,Helvetica,sans-serif;font-size:${subFs}px;font-weight:800;line-height:1.18;color:#EAF4FF;">${safeSubtitle}</div>
      </foreignObject>

      <rect x="${ctaX}" y="${ctaY}" width="${ctaW}" height="${ctaH}" rx="${Math.round(ctaH * 0.36)}" fill="#16A34A" filter="url(#shadow)"/>
      <text x="${ctaX + ctaW / 2}" y="${Math.round(ctaY + ctaH * 0.63)}" text-anchor="middle" font-family="Inter, Arial, Helvetica, sans-serif" font-size="${Math.max(13, Math.round(ctaH * 0.36))}" font-weight="950" fill="#ffffff">COMPRE AGORA</text>
      <text x="${margin}" y="${Math.round(H * 0.935)}" font-family="Inter, Arial, Helvetica, sans-serif" font-size="${phoneFs}" font-weight="900" fill="#ffffff">WhatsApp: (31) 98514-7119</text>
    </svg>`);

  const composites = [{ input: bg, top: 0, left: 0 }];

  function productPositions(count = 1) {
    if (isVertical) {
      return count <= 1
        ? [{ left: Math.round(W * 0.12), top: Math.round(H * 0.40), width: Math.round(W * 0.76), height: Math.round(H * 0.42) }]
        : [
            { left: Math.round(W * 0.08), top: Math.round(H * 0.38), width: Math.round(W * 0.54), height: Math.round(H * 0.35) },
            { left: Math.round(W * 0.38), top: Math.round(H * 0.51), width: Math.round(W * 0.54), height: Math.round(H * 0.35) }
          ];
    }

    if (isSquare) {
      return count <= 1
        ? [{ left: Math.round(W * 0.44), top: Math.round(H * 0.20), width: Math.round(W * 0.48), height: Math.round(H * 0.50) }]
        : [
            { left: Math.round(W * 0.42), top: Math.round(H * 0.18), width: Math.round(W * 0.40), height: Math.round(H * 0.40) },
            { left: Math.round(W * 0.57), top: Math.round(H * 0.45), width: Math.round(W * 0.34), height: Math.round(H * 0.34) }
          ];
    }

    if (isThin) {
      return count <= 1
        ? [{ left: Math.round(W * 0.56), top: Math.round(H * 0.08), width: Math.round(W * 0.38), height: Math.round(H * 0.78) }]
        : [
            { left: Math.round(W * 0.49), top: Math.round(H * 0.12), width: Math.round(W * 0.21), height: Math.round(H * 0.66) },
            { left: Math.round(W * 0.65), top: Math.round(H * 0.10), width: Math.round(W * 0.21), height: Math.round(H * 0.66) },
            { left: Math.round(W * 0.79), top: Math.round(H * 0.14), width: Math.round(W * 0.18), height: Math.round(H * 0.62) }
          ];
    }

    return count <= 1
      ? [{ left: Math.round(W * 0.55), top: Math.round(H * 0.10), width: Math.round(W * 0.38), height: Math.round(H * 0.72) }]
      : [
          { left: Math.round(W * 0.47), top: Math.round(H * 0.12), width: Math.round(W * 0.28), height: Math.round(H * 0.68) },
          { left: Math.round(W * 0.68), top: Math.round(H * 0.14), width: Math.round(W * 0.25), height: Math.round(H * 0.64) }
        ];
  }

  const positions = productPositions(products.length);

  for (let i = 0; i < Math.min(products.length, positions.length); i += 1) {
    const pos = positions[i];
    const product = products[i] || {};
    const productPng = await loadRemoteImageAsPng(pickProductImage(product), pos.width, pos.height);
    if (!productPng) continue;

    const meta = await sharp(productPng).metadata();
    const left = Math.round(pos.left + (pos.width - (meta.width || pos.width)) / 2);
    const top = Math.round(pos.top + (pos.height - (meta.height || pos.height)) / 2);

    composites.push({
      input: Buffer.from(`<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="${Math.round(pos.left + pos.width / 2)}" cy="${Math.round(pos.top + pos.height * 0.94)}" rx="${Math.round(pos.width * 0.35)}" ry="${Math.round(pos.height * 0.060)}" fill="#001A3D" opacity="0.22"/>
      </svg>`),
      top: 0,
      left: 0
    });

    // Sem etiqueta individual, sem nome individual e sem preço individual em cima do produto.
    // A legenda do banner fica somente na chamada principal por categoria.
    composites.push({ input: productPng, left, top });
  }

  return sharp({ create: { width: W, height: H, channels: 4, background: '#ffffff' } })
    .composite(composites)
    .png({ quality: 100, compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

function normalizePosterSiteCtaOptions(input = {}) {
  const siteUrl = String(input.siteUrl || input.storeUrl || input.urlLoja || input.website || input.site || process.env.STORE_SITE_URL || FRONTEND_URL || 'https://arianamoveis.com.br').trim() || 'https://arianamoveis.com.br';
  const cleanSiteUrl = siteUrl.replace(/\/+$/, '');
  const siteText = String(input.siteText || input.storeText || input.textoSite || 'arianamoveis.com.br').trim() || 'arianamoveis.com.br';
  const ctaText = String(input.ctaText || input.buttonText || input.botaoTexto || 'COMPRE DIRETO DO SITE').trim() || 'COMPRE DIRETO DO SITE';
  const ctaSubtext = String(input.ctaSubtext || input.buttonSubtext || input.subtextoBotao || siteText).trim() || siteText;
  const mascotImageUrl = String(input.mascotImageUrl || input.mascoteUrl || input.avatarUrl || process.env.POSTER_MASCOT_IMAGE_URL || '').trim();

  return {
    siteUrl: cleanSiteUrl,
    storeUrl: cleanSiteUrl,
    linkUrl: cleanSiteUrl,
    siteText,
    ctaText,
    buttonText: ctaText,
    ctaSubtext,
    buttonSubtext: ctaSubtext,
    whatsappText: ctaText,
    whatsappLabel: ctaText,
    whatsappNumber: siteText,
    phoneText: siteText,
    replaceWhatsappWithSite: true,
    showWhatsapp: false,
    showSiteCta: true,
    mascotImageUrl,
    mascoteUrl: mascotImageUrl,
    removeMascotBackground: true
  };
}

async function generateAndSaveProductCreative(doc, variant = 'square', pixPercent = 17, creativeOptions = {}) {
  const product = normalizeProductForResponse(doc);
  const siteCtaOptions = normalizePosterSiteCtaOptions(creativeOptions);
  const buffer = await generateProductPosterBuffer(product, { variant, pixPercent, ...siteCtaOptions });
  const publicId = `${sanitizeIdPart(product.name || product.sku || product.id)}-${variant}-${Date.now()}`;
  const result = await uploadBufferToCloudinary(buffer, {
    folder: buildCloudinaryFolder(`posters/produtos/${variant}`),
    public_id: publicId
  });
  const poster = { variant, url: result.secure_url, public_id: result.public_id, width: result.width, height: result.height, format: result.format, siteUrl: siteCtaOptions.siteUrl, ctaText: siteCtaOptions.ctaText, createdAt: new Date().toISOString() };
  await Product.findByIdAndUpdate(doc._id, { $push: { posters: { $each: [poster], $slice: -20 } }, $set: { updatedAt: new Date() } });
  return poster;
}

app.post('/api/admin/posters/product/:id', adminRequired, async (req, res) => {
  try {
    if (!isCloudinaryConfigured()) {
      return res.status(500).json({ ok: false, error: 'Cloudinary não configurado.' });
    }

    const oid = normalizeObjectId(req.params.id);
    let doc = oid ? await Product.findById(oid) : null;
    if (!doc) doc = await Product.findOne({ $or: [{ slug: req.params.id }, { sku: req.params.id }] });
    if (!doc) return res.status(404).json({ ok: false, error: 'Produto não encontrado' });

    const variant = String(req.body?.variant || req.query?.variant || 'square').toLowerCase() === 'story' ? 'story' : 'square';
    const pixPercent = Number(req.body?.pixPercent || req.query?.pixPercent || 17);
    const poster = await generateAndSaveProductCreative(doc, variant, pixPercent, req.body || {});

    return res.json({ ok: true, productId: String(doc._id), poster, url: poster.url });
  } catch (error) {
    console.error('[posters] erro ao gerar poster do produto:', error);
    return res.status(500).json({ ok: false, error: error.message || 'poster_generate_failed' });
  }
});

app.post('/api/admin/posters/offers', adminRequired, async (req, res) => {
  try {
    const limit = Math.min(Number(req.body?.limit || req.query?.limit || 6), 8);
    const products = await Product.find({ active: { $ne: false }, isOffer: true }).sort({ updatedAt: -1, createdAt: -1 }).limit(limit);
    return res.json({ ok: true, message: 'Primeira versão instalada. Use /api/admin/posters/product/:id para gerar posters por produto.', products: products.map(normalizeProductForResponse) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'offers_poster_failed' });
  }
});


app.post('/api/admin/posters/bulk', adminRequired, async (req, res) => {
  try {
    if (!isCloudinaryConfigured()) return res.status(500).json({ ok: false, error: 'Cloudinary não configurado.' });
    const variant = String(req.body?.variant || req.query?.variant || 'square').toLowerCase() === 'story' ? 'story' : 'square';
    const limit = Math.min(Math.max(Number(req.body?.limit || req.query?.limit || 500), 1), 1000);
    const pixPercent = Number(req.body?.pixPercent || req.query?.pixPercent || 17);
    const products = await Product.find({ active: { $ne: false } }).sort({ updatedAt: -1, createdAt: -1 }).limit(limit);
    const results = [];
    for (const doc of products) {
      try {
        const poster = await generateAndSaveProductCreative(doc, variant, pixPercent, req.body || {});
        results.push({ ok: true, productId: String(doc._id), name: doc.name, url: poster.url });
      } catch (error) {
        results.push({ ok: false, productId: String(doc._id), name: doc.name, error: error.message });
      }
    }
    return res.json({ ok: true, variant, total: products.length, success: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'bulk_posters_failed' });
  }
});

app.post('/api/admin/marketing/banner-drafts/generate', adminRequired, async (req, res) => {
  try {
    if (!isCloudinaryConfigured()) return res.status(500).json({ ok: false, error: 'Cloudinary não configurado.' });
    const definitions = bannerDraftDefinitions();
    const usedIds = new Set();
    const saved = [];
    for (const def of definitions) {
      const products = await selectProductsForBanner(def, usedIds, Number(def.productLimit || 3));
      const buffer = await generateMarketingBannerBuffer({ title: def.title, subtitle: def.subtitle, products, width: def.width, height: def.height, targetSlot: def.targetSlot, group: def.group });
      const result = await uploadBufferToCloudinary(buffer, {
        folder: buildCloudinaryFolder('banners/rascunhos'),
        public_id: `draft-${def.key}-${Date.now()}`
      });
      const slot = `draft_${def.key}_${Date.now()}`;
      const doc = await Banner.create({
        slot,
        targetSlot: def.targetSlot,
        title: def.title,
        subtitle: def.subtitle,
        image: result.secure_url,
        href: def.href || (def.targetSlot.includes('categoria') ? 'categoria.html' : 'todos_produtos.html'),
        alt: def.title,
        active: false,
        status: 'draft',
        source: 'automatic',
        draftType: 'slot_banner',
        products: products.map(p => ({ id: String(p.id || p._id), name: p.name, image: p.imageUrl || p.mainImageUrl || '' })),
        sortOrder: saved.length + 1,
        device: 'all'
      });
      saved.push(doc);
    }
    return res.json({ ok: true, count: saved.length, drafts: saved.map(normalizeBannerForResponse) });
  } catch (error) {
    console.error('[marketing] erro ao gerar rascunhos:', error);
    return res.status(500).json({ ok: false, error: error.message || 'banner_drafts_generate_failed' });
  }
});

app.get('/api/admin/marketing/banner-drafts', adminRequired, async (_req, res) => {
  try {
    const rows = await Banner.find({ status: 'draft', active: false }).sort({ createdAt: -1 }).limit(100);
    return res.json({ ok: true, drafts: rows.map(normalizeBannerForResponse) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'banner_drafts_list_failed' });
  }
});

app.post('/api/admin/marketing/banner-drafts/:id/publish', adminRequired, async (req, res) => {
  try {
    const oid = normalizeObjectId(req.params.id);
    const doc = oid ? await Banner.findById(oid) : await Banner.findOne({ slot: req.params.id });
    if (!doc) return res.status(404).json({ ok: false, error: 'Rascunho não encontrado' });
    const targetSlot = String(req.body?.targetSlot || doc.targetSlot || doc.slot || '').trim();
    if (!targetSlot) return res.status(400).json({ ok: false, error: 'targetSlot_required' });
    await Banner.updateMany({ _id: { $ne: doc._id }, $or: [{ slot: targetSlot }, { targetSlot }], active: true }, { $set: { active: false, status: 'archived' } });
    doc.slot = targetSlot;
    doc.targetSlot = targetSlot;
    doc.active = true;
    doc.status = 'published';
    doc.source = doc.source || 'automatic';
    await doc.save();
    return res.json({ ok: true, banner: normalizeBannerForResponse(doc) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'banner_draft_publish_failed' });
  }
});

app.delete('/api/admin/marketing/banner-drafts/:id', adminRequired, async (req, res) => {
  try {
    const oid = normalizeObjectId(req.params.id);
    const doc = oid ? await Banner.findByIdAndDelete(oid) : await Banner.findOneAndDelete({ slot: req.params.id, status: 'draft' });
    if (!doc) return res.status(404).json({ ok: false, error: 'Rascunho não encontrado' });
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'banner_draft_delete_failed' });
  }
});

app.post('/api/admin/marketing/generate-all-drafts', adminRequired, async (req, res) => {
  try {
    if (!isCloudinaryConfigured()) return res.status(500).json({ ok: false, error: 'Cloudinary não configurado.' });
    const limit = Math.min(Math.max(Number(req.body?.limit || req.query?.limit || 500), 1), 1000);
    const products = await Product.find({ active: { $ne: false } }).sort({ updatedAt: -1, createdAt: -1 }).limit(limit);
    const posters = [];
    const stories = [];
    for (const doc of products) {
      try { const poster = await generateAndSaveProductCreative(doc, 'square', Number(req.body?.pixPercent || req.query?.pixPercent || 17), req.body || {}); posters.push({ ok: true, productId: String(doc._id), url: poster.url }); } catch (error) { posters.push({ ok: false, productId: String(doc._id), error: error.message }); }
      try { const story = await generateAndSaveProductCreative(doc, 'story', Number(req.body?.pixPercent || req.query?.pixPercent || 17), req.body || {}); stories.push({ ok: true, productId: String(doc._id), url: story.url }); } catch (error) { stories.push({ ok: false, productId: String(doc._id), error: error.message }); }
    }
    const definitions = bannerDraftDefinitions();
    const usedIds = new Set();
    const drafts = [];
    for (const def of definitions) {
      const selected = await selectProductsForBanner(def, usedIds, Number(def.productLimit || 3));
      const buffer = await generateMarketingBannerBuffer({ title: def.title, subtitle: def.subtitle, products: selected, width: def.width, height: def.height, targetSlot: def.targetSlot, group: def.group });
      const result = await uploadBufferToCloudinary(buffer, { folder: buildCloudinaryFolder('banners/rascunhos'), public_id: `draft-${def.key}-${Date.now()}` });
      const doc = await Banner.create({ slot: `draft_${def.key}_${Date.now()}`, targetSlot: def.targetSlot, title: def.title, subtitle: def.subtitle, image: result.secure_url, href: def.href || (def.targetSlot.includes('categoria') ? 'categoria.html' : 'todos_produtos.html'), alt: def.title, active: false, status: 'draft', source: 'automatic', draftType: 'slot_banner', products: selected.map(p => ({ id: String(p.id || p._id), name: p.name, image: p.imageUrl || p.mainImageUrl || '' })), sortOrder: drafts.length + 1, device: 'all' });
      drafts.push(normalizeBannerForResponse(doc));
    }
    return res.json({ ok: true, products: products.length, postersSuccess: posters.filter(x => x.ok).length, storiesSuccess: stories.filter(x => x.ok).length, bannerDrafts: drafts.length, posters, stories, drafts });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'generate_all_drafts_failed' });
  }
});

app.post('/api/upload', upload.single('file'), uploadToCloudinary);
app.post('/admin/uploads', adminRequired, upload.single('file'), uploadToCloudinary);
app.post('/api/admin/uploads', adminRequired, upload.single('file'), uploadToCloudinary);

app.delete(['/api/admin/uploads','/admin/uploads'], adminRequired, async (req, res) => {
  try {
    const rawPath = String(req.query?.path || req.body?.path || '').trim();
    if (!rawPath) return res.json({ ok: true, deleted: false });

    if (/^https?:\/\//i.test(rawPath)) {
      const m = rawPath.match(/\/upload\/(?:v\d+\/)?(.+)\.[a-zA-Z0-9]+(?:\?.*)?$/);
      const publicId = m ? m[1] : '';
      if (!publicId) return res.json({ ok: true, deleted: false, path: rawPath });
      const result = await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
      return res.json({ ok: true, deleted: result?.result === 'ok' || result?.result === 'not found', path: publicId, result });
    }

    const maybePublicId = rawPath.replace(/^\/+/, '');
    if (maybePublicId.startsWith('ariana_moveis/')) {
      const result = await cloudinary.uploader.destroy(maybePublicId, { resource_type: 'image' });
      return res.json({ ok: true, deleted: result?.result === 'ok' || result?.result === 'not found', path: maybePublicId, result });
    }

    return res.json({ ok: true, deleted: false, path: rawPath });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'delete_upload_failed' });
  }
});

app.get('/api/admin/settings/:key', adminRequired, async (req, res) => {
  try {
    const key = String(req.params.key || '').trim();
    if (!key) {
      return res.status(400).json({ ok: false, error: 'key_required' });
    }

    const value = await getSetting(key, {});
    return res.json({ ok: true, key, value: value || {} });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'settings_read_failed' });
  }
});

app.patch('/api/admin/settings/:key', adminRequired, async (req, res) => {
  try {
    const key = String(req.params.key || '').trim();
    if (!key) {
      return res.status(400).json({ ok: false, error: 'key_required' });
    }

    const current = await getSetting(key, {});
    const incoming = req.body || {};
    const merged = {
      ...(current || {}),
      ...(incoming || {}),
      updatedAt: new Date().toISOString()
    };

    await setSetting(key, merged, String((req.user && (req.user._id || req.user.id || req.user.uid)) || 'admin'));
    return res.json({ ok: true, key, value: merged });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'settings_save_failed' });
  }
});

app.put('/api/admin/settings/:key', adminRequired, async (req, res) => {
  try {
    const key = String(req.params.key || '').trim();
    if (!key) {
      return res.status(400).json({ ok: false, error: 'key_required' });
    }

    const current = await getSetting(key, {});
    const incoming = req.body || {};
    const merged = {
      ...(current || {}),
      ...(incoming || {}),
      updatedAt: new Date().toISOString()
    };

    await setSetting(key, merged, String((req.user && (req.user._id || req.user.id || req.user.uid)) || 'admin'));
    return res.json({ ok: true, key, value: merged });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'settings_save_failed' });
  }
});



app.delete(['/api/admin/uploads','/admin/uploads'], adminRequired, async (req, res) => {
  try {
    const rawPath = String(req.query?.path || req.body?.path || '').trim();
    if (!rawPath) return res.json({ ok: true, deleted: false });

    if (/^https?:\/\//i.test(rawPath)) {
      const m = rawPath.match(/\/upload\/(?:v\d+\/)?(.+)\.[a-zA-Z0-9]+(?:\?.*)?$/);
      const publicId = m ? m[1] : '';
      if (!publicId) return res.json({ ok: true, deleted: false, path: rawPath });
      const result = await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
      return res.json({ ok: true, deleted: result?.result === 'ok' || result?.result === 'not found', path: publicId, result });
    }

    const maybePublicId = rawPath.replace(/^\/+/, '');
    if (maybePublicId.startsWith('ariana_moveis/')) {
      const result = await cloudinary.uploader.destroy(maybePublicId, { resource_type: 'image' });
      return res.json({ ok: true, deleted: result?.result === 'ok' || result?.result === 'not found', path: maybePublicId, result });
    }

    const rel = safeUploadFolder(rawPath);
    if (!rel) return res.json({ ok: true, deleted: false });

    const abs = path.join(uploadsDir, rel);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) fs.unlinkSync(abs);
    return res.json({ ok: true, deleted: true, path: rel });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'delete_upload_failed' });
  }
});

const adminCollectionMap = {
  products: Product,
  categories: Category,
  orders: Order,
  users: User,
  banners: Banner,
  settings: Setting,
  atendimentos: Ticket,
  tickets: Ticket,
  notifications: Notification,
  alerts: OperationalAlert,
  sellers: Seller,
};

function buildAdminQuery(modelName, req) {
  const q = {};
  if (modelName === 'products') {
    if (req.query.where_category) q.category = String(req.query.where_category);
    if (req.query.where_sellerId) q.sellerId = String(req.query.where_sellerId);
  }
  if (modelName === 'orders' && req.query.where_status) q.status = String(req.query.where_status);
  if ((modelName === 'atendimentos' || modelName === 'tickets') && req.query.where_status) q.status = String(req.query.where_status);
  return q;
}


// ============================================================
// EXPORTAÇÃO DE PRODUTOS - PDF / EXCEL PELO PAINEL ADMIN
// Retorna todos os produtos cadastrados para relatórios internos.
// ============================================================
app.get('/api/admin/products/export/all', adminRequired, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 10000), 20000);
    const rows = await Product.find({})
      .sort({ categoryName: 1, category: 1, name: 1, updatedAt: -1 })
      .limit(limit);

    const items = rows.map((doc) => normalizeProductForResponse(doc));

    return res.json({
      ok: true,
      total: items.length,
      generatedAt: new Date().toISOString(),
      items
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'products_export_failed' });
  }
});

app.get('/api/admin/:collection', adminRequired, async (req, res, next) => {
  const key = String(req.params.collection || '').trim().toLowerCase();
  if (['login','me','uploads','stats','runtime','shipping','alerts','audit-logs','orders','notifications'].includes(key)) return next();
  const Model = adminCollectionMap[key];
  if (!Model) return res.status(404).json({ ok: false, error: 'collection_not_supported' });
  try {
    const query = buildAdminQuery(key, req);
    const limit = Math.min(Number(req.query.limit || 500), 1000);
    const sortBy = String(req.query.sortBy || 'createdAt');
    const sortDir = String(req.query.sortDir || 'desc').toLowerCase() === 'asc' ? 1 : -1;
    let rows = await Model.find(query).sort({ [sortBy]: sortDir }).limit(limit);
    if (key === 'settings') rows = rows.map((doc) => ({ id: doc.key, key: doc.key, ...(doc.value || {}), updatedAt: doc.updatedAt, createdAt: doc.createdAt }));
    else rows = rows.map((doc) => key === 'products' ? normalizeProductForResponse(doc) : toJSON(doc));
    return res.json(rows);
  } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'admin_list_failed' }); }
});

app.get('/api/admin/:collection/:id', adminRequired, async (req, res) => {
  const key = String(req.params.collection || '').trim().toLowerCase();
  const Model = adminCollectionMap[key];
  if (!Model) return res.status(404).json({ ok: false, error: 'collection_not_supported' });
  try {
    let doc;
    if (key === 'settings') {
      doc = await Setting.findOne({ key: req.params.id });
      if (!doc) return res.status(404).json({ ok: false, error: 'not_found' });
      return res.json({ id: doc.key, key: doc.key, ...(doc.value || {}), updatedAt: doc.updatedAt, createdAt: doc.createdAt });
    }
    const oid = normalizeObjectId(req.params.id);
    doc = oid ? await Model.findById(oid) : null;
    if (!doc && ['products'].includes(key)) doc = await Model.findOne({ $or: [{ slug: req.params.id }, { sku: req.params.id }] });
    if (!doc) return res.status(404).json({ ok: false, error: 'not_found' });
    return res.json(key === 'products' ? normalizeProductForResponse(doc) : toJSON(doc));
  } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'admin_read_failed' }); }
});

app.post('/api/admin/:collection', adminRequired, async (req, res) => {
  const key = String(req.params.collection || '').trim().toLowerCase();
  const Model = adminCollectionMap[key];
  if (!Model) return res.status(404).json({ ok: false, error: 'collection_not_supported' });
  try {
    let doc;
    if (key === 'products') doc = await Product.create(productPayloadFromBody(req.body || {}));
    else if (key === 'settings') {
      const settingKey = String(req.body?.key || req.body?.id || '').trim() || uid('setting');
      const value = { ...(req.body || {}) }; delete value.key; delete value.id;
      await Setting.findOneAndUpdate({ key: settingKey }, { $set: { key: settingKey, value, updatedBy: String(req.admin?.email || 'admin') } }, { upsert: true, new: true });
      const saved = await Setting.findOne({ key: settingKey });
      return res.json({ id: saved.key, key: saved.key, ...(saved.value || {}), updatedAt: saved.updatedAt, createdAt: saved.createdAt });
    } else if (key === 'atendimentos' || key === 'tickets') {
      doc = await Ticket.create({ protocolo: req.body?.protocolo || `AT-${Date.now()}`, nome: req.body?.nome || req.body?.name || '', email: req.body?.email || '', telefone: req.body?.telefone || req.body?.phone || '', tipo: req.body?.tipo || 'Atendimento', assunto: req.body?.assunto || '', mensagem: req.body?.mensagem || req.body?.message || '', status: req.body?.status || 'Novo', origem: req.body?.origem || 'admin', metadata: req.body?.metadata || {} });
    } else doc = await Model.create(req.body || {});
    return res.json(key === 'products' ? normalizeProductForResponse(doc) : toJSON(doc));
  } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'admin_create_failed' }); }
});

app.patch('/api/admin/:collection/:id', adminRequired, async (req, res) => {
  const key = String(req.params.collection || '').trim().toLowerCase();
  const Model = adminCollectionMap[key];
  if (!Model) return res.status(404).json({ ok: false, error: 'collection_not_supported' });
  try {
    if (key === 'settings') {
      const existing = await Setting.findOne({ key: req.params.id });
      const merged = { ...((existing && existing.value) || {}), ...(req.body || {}) };
      const saved = await Setting.findOneAndUpdate({ key: req.params.id }, { $set: { key: req.params.id, value: merged, updatedBy: String(req.admin?.email || 'admin') } }, { upsert: true, new: true });
      return res.json({ id: saved.key, key: saved.key, ...(saved.value || {}), updatedAt: saved.updatedAt, createdAt: saved.createdAt });
    }
    const oid = normalizeObjectId(req.params.id);
    if (!oid) return res.status(400).json({ ok: false, error: 'ID inválido' });
    const existingDoc = await Model.findById(oid);
    if (!existingDoc) return res.status(404).json({ ok: false, error: 'not_found' });
    const beforeObj = toJSON(existingDoc);
    const payload = key === 'products' ? productPayloadFromBody({ ...(req.body || {}) }, existingDoc) : (req.body || {});
    const doc = await Model.findByIdAndUpdate(oid, { $set: payload }, { new: true, runValidators: true });

    if (key === 'orders') {
      const afterObj = toJSON(doc);
      const changed = changedKeys(beforeObj, afterObj);
      const statusChanged = String(beforeObj.status || '') !== String(afterObj.status || '') || String(beforeObj.statusLabel || '') !== String(afterObj.statusLabel || '');
      const trackingChanged = String(beforeObj.trackingCode || '') !== String(afterObj.trackingCode || '');

      if (statusChanged || trackingChanged) {
        await createAdminNotification({
          type: 'order_updated',
          title: '📦 Pedido atualizado',
          message: `Pedido ${afterObj.id || afterObj._id} atualizado${afterObj.statusLabel || afterObj.status ? ` para ${afterObj.statusLabel || afterObj.status}` : ''}${afterObj.trackingCode ? ` - Rastreio: ${afterObj.trackingCode}` : ''}`,
          relatedId: String(afterObj.id || afterObj._id),
          severity: statusChanged ? 'info' : 'success'
        });
        await createSellerOrderNotifications(afterObj, {
          type: 'seller_order_updated',
          title: '📦 Pedido atualizado pela Ariana Móveis',
          message: `Pedido #${String(afterObj.id || afterObj._id).slice(-8).toUpperCase()} atualizado${afterObj.statusLabel || afterObj.status ? ` para ${afterObj.statusLabel || afterObj.status}` : ''}${afterObj.trackingCode ? ` - Rastreio: ${afterObj.trackingCode}` : ''}`,
          severity: statusChanged ? 'info' : 'success',
          origin: 'admin_generic_orders_route'
        });
      }

      await writeAuditLog({
        scope: 'admin_orders',
        eventType: 'admin_order_updated',
        orderId: String(afterObj.id || afterObj._id),
        status: 'success',
        changedKeys: changed,
        metadata: { actor: req.admin?.email || req.admin?.id || 'admin' }
      }).catch(() => null);

      // O painel admin usa esta rota genérica: PATCH /api/admin/orders/:id.
      // Por isso o WhatsApp precisa ser chamado aqui também.
      const customerWhatsapp = (statusChanged || trackingChanged)
        ? await waMaybeNotifyOrderStatusChange(String(afterObj.id || afterObj._id), beforeObj, afterObj, 'admin_generic_orders_route_customer')
        : { skipped: true, reason: 'no_status_or_tracking_change' };

      const adminWhatsapp = (statusChanged || trackingChanged)
        ? await waNotifyAdminOrderStatusChange(String(afterObj.id || afterObj._id), beforeObj, afterObj, 'admin_generic_orders_route_admin')
        : { skipped: true, reason: 'no_status_or_tracking_change' };

      return res.json({ ok: true, order: afterObj, whatsapp: customerWhatsapp, adminWhatsapp });
    }

    return res.json(key === 'products' ? normalizeProductForResponse(doc) : toJSON(doc));
  } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'admin_patch_failed' }); }
});

app.put('/api/admin/:collection/:id', adminRequired, async (req, res) => {
  req.method = 'PATCH';
  return app._router.handle(req, res, () => {});
});

app.delete('/api/admin/:collection/:id', adminRequired, async (req, res) => {
  const key = String(req.params.collection || '').trim().toLowerCase();
  const Model = adminCollectionMap[key];
  if (!Model) return res.status(404).json({ ok: false, error: 'collection_not_supported' });
  try {
    if (key === 'settings') { await Setting.deleteOne({ key: req.params.id }); return res.json({ ok: true }); }
    const oid = normalizeObjectId(req.params.id);
    if (!oid) return res.status(400).json({ ok: false, error: 'ID inválido' });
    await Model.findByIdAndDelete(oid);
    return res.json({ ok: true });
  } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'admin_delete_failed' }); }
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

app.listen(PORT, () => {
  console.log(`🚀 Ariana Enterprise Mongo rodando na porta ${PORT}`);
  startSigeAutoCobrancaScheduler();
  console.log(`📁 Uploads em: ${uploadsDir}`);
  console.log(`🌐 Base local: http://localhost:${PORT}/api`);
});