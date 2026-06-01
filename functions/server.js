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
import { generateProductPosterBuffer } from './poster-generator.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();


const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'ariana_enterprise_secret';
const MONGODB_URI = process.env.MONGODB_URI || '';
const MONGODB_DB = process.env.MONGODB_DB || 'ariana_moveis_db';
const APP_BASE_URL = (process.env.APP_BASE_URL || '').replace(/\/+$/, '');
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
    price: Number(body.price ?? body.preco ?? existing.price ?? 0),
    oldPrice: body.oldPrice !== undefined && body.oldPrice !== null && body.oldPrice !== '' ? Number(body.oldPrice) : (existing.oldPrice ?? null),
    pixPrice: body.pixPrice !== undefined && body.pixPrice !== null && body.pixPrice !== '' ? Number(body.pixPrice) : (existing.pixPrice ?? null),
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
const userSchema = new mongoose.Schema({ name: String, email: { type: String, index: true, unique: true, sparse: true }, passwordHash: String, cpf: String, phone: String, role: { type: String, default: 'customer', enum: ['customer', 'seller', 'admin', 'staff'] }, permissions: { type: [String], default: [] }, sellerId: { type: String, default: null }, city: String, uf: String, isActive: { type: Boolean, default: true } }, baseOptions);
const sellerSchema = new mongoose.Schema({ sellerId: { type: String, index: true, unique: true }, userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, displayName: String, storeName: String, email: String, phone: String, document: String, status: { type: String, default: 'pending' }, onboardingCompleted: { type: Boolean, default: false }, metadata: mongoose.Schema.Types.Mixed }, baseOptions);
const categorySchema = new mongoose.Schema({ name: { type: String, required: true }, slug: String, parentId: { type: String, default: null }, active: { type: Boolean, default: true }, sortOrder: { type: Number, default: 0 }, image: String }, baseOptions);
const productSchema = new mongoose.Schema({ sellerId: { type: String, index: true }, sellerName: String, name: { type: String, required: true, index: true }, slug: String, description: String, category: String, categoryId: String, categoryName: String, brand: String, sku: String, price: { type: Number, required: true, default: 0 }, oldPrice: { type: Number, default: null }, pixPrice: { type: Number, default: null }, installmentCount: { type: Number, default: 12 }, image: String, imageUrl: String, imagem: String, mainImageUrl: String, mainImagePath: String, images: [mongoose.Schema.Types.Mixed], imageUrls: [String], imagePaths: [String], stock: { type: Number, default: 0 }, active: { type: Boolean, default: true }, specs: mongoose.Schema.Types.Mixed, dimensions: mongoose.Schema.Types.Mixed, logistics: mongoose.Schema.Types.Mixed, weight: Number, length: Number, height: Number, width: Number, isOffer: { type: Boolean, default: false }, isFavorite: { type: Boolean, default: false }, isHighlight: { type: Boolean, default: false }, isBestSeller: { type: Boolean, default: false }, isNewArrival: { type: Boolean, default: false }, isRecommended: { type: Boolean, default: false }, posters: [mongoose.Schema.Types.Mixed] }, baseOptions);
productSchema.index({ name: 'text', description: 'text', category: 'text', brand: 'text' });
const bannerSchema = new mongoose.Schema({ slot: { type: String, required: true, index: true }, targetSlot: { type: String, index: true }, title: String, subtitle: String, image: String, href: String, alt: String, active: { type: Boolean, default: true }, status: { type: String, default: 'published', index: true }, source: { type: String, default: 'manual' }, draftType: String, products: [mongoose.Schema.Types.Mixed], sortOrder: { type: Number, default: 0 }, device: { type: String, default: 'all' } }, baseOptions);
const addressSchema = new mongoose.Schema({ userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }, name: String, phone: String, cep: String, logradouro: String, numero: String, bairro: String, cidade: String, uf: String, complemento: String, reference: String, isDefault: { type: Boolean, default: false } }, baseOptions);
const ticketSchema = new mongoose.Schema({ userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, default: null }, orderId: { type: String, default: null }, protocolo: { type: String, index: true }, tipo: String, assunto: String, mensagem: String, status: { type: String, default: 'Novo' }, origem: { type: String, default: 'site' }, nome: String, email: String, telefone: String, metadata: mongoose.Schema.Types.Mixed }, baseOptions);
const contactSchema = new mongoose.Schema({ name: String, email: String, phone: String, subject: String, message: String, source: { type: String, default: 'fale_conosco' }, status: { type: String, default: 'novo' } }, baseOptions);
const denunciaSchema = new mongoose.Schema({ userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, productId: { type: String, default: null }, sellerId: { type: String, default: null }, motivo: String, descricao: String, status: { type: String, default: 'nova' }, nome: String, email: String }, baseOptions);
const orderSchema = new mongoose.Schema({ userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, default: null }, sellerIds: [String], customerName: String, customerEmail: String, customerPhone: String, status: { type: String, default: 'pendente', index: true }, statusLabel: String, items: [{ productId: String, sellerId: String, name: String, sku: String, qty: Number, unitPrice: Number, totalPrice: Number, image: String }], subtotal: { type: Number, default: 0 }, shippingCost: { type: Number, default: 0 }, montagemCost: { type: Number, default: 0 }, total: { type: Number, default: 0 }, currency: { type: String, default: DEFAULT_CURRENCY }, payment: mongoose.Schema.Types.Mixed, shippingAddress: mongoose.Schema.Types.Mixed, shipping: mongoose.Schema.Types.Mixed, trackingCode: String, trackingHistory: [mongoose.Schema.Types.Mixed], notes: String, manufacturer: String, manufacturerDispatch: mongoose.Schema.Types.Mixed, status_integracao: String, whatsappNotification: mongoose.Schema.Types.Mixed, chatMeta: mongoose.Schema.Types.Mixed }, baseOptions);
const settingsSchema = new mongoose.Schema({ key: { type: String, unique: true, index: true }, value: mongoose.Schema.Types.Mixed, updatedBy: String }, baseOptions);
const integrationAuditLogSchema = new mongoose.Schema({ scope: { type: String, default: 'integration' }, eventType: { type: String, default: 'unspecified', index: true }, orderId: { type: String, default: null, index: true }, manufacturer: { type: String, default: null, index: true }, integrationId: { type: String, default: null }, queueId: { type: String, default: null }, status: String, statusCode: Number, message: String, changedKeys: [String], request: mongoose.Schema.Types.Mixed, response: mongoose.Schema.Types.Mixed, metadata: mongoose.Schema.Types.Mixed, buildId: String }, baseOptions);
const manufacturerIntegrationSchema = new mongoose.Schema({ manufacturer: { type: String, unique: true, index: true }, enabled: { type: Boolean, default: true }, endpoint: String, method: { type: String, default: 'POST' }, headers: mongoose.Schema.Types.Mixed, authType: String, authToken: String, apiKey: String, sendAs: { type: String, default: 'json', enum: ['json', 'form'] }, timeoutMs: { type: Number, default: 30000 }, metadata: mongoose.Schema.Types.Mixed }, baseOptions);
const manufacturerDispatchQueueSchema = new mongoose.Schema({ queueId: { type: String, unique: true, index: true }, orderId: { type: String, required: true, index: true }, manufacturer: { type: String, required: true, index: true }, payload: mongoose.Schema.Types.Mixed, status: { type: String, default: 'pending', index: true }, attempts: { type: Number, default: 0 }, maxAttempts: { type: Number, default: MAX_DISPATCH_ATTEMPTS }, nextAttemptAt: { type: Date, default: now, index: true }, lastAttemptAt: Date, lastError: String, lastResponse: mongoose.Schema.Types.Mixed, deadLetter: { type: Boolean, default: false } }, baseOptions);
const operationalAlertSchema = new mongoose.Schema({ alertId: { type: String, unique: true, index: true }, type: { type: String, index: true }, severity: { type: String, default: 'medium' }, status: { type: String, default: 'open', index: true }, title: String, message: String, manufacturer: String, orderId: String, queueId: String, entityKey: String, count: { type: Number, default: 1 }, metadata: mongoose.Schema.Types.Mixed, buildId: String, firstSeenAt: Date, lastSeenAt: Date, resolvedAt: Date }, baseOptions);
const whatsappWebhookSchema = new mongoose.Schema({ event: String, remoteJid: String, number: String, pushName: String, fromMe: Boolean, text: String, payload: mongoose.Schema.Types.Mixed }, baseOptions);
const notificationSchema = new mongoose.Schema({ type: String, title: String, message: String, status: { type: String, default: 'unread' }, relatedId: String, severity: { type: String, default: 'info' } }, baseOptions);
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
      severity: data.severity || 'info'
    });
  } catch (error) {
    console.error('Erro ao criar notificação administrativa:', error.message || error);
    return null;
  }
}

const PaymentEvent = mongoose.model('PaymentEvent', paymentEventSchema);


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
const WHATSAPP_EVOLUTION_DEFAULT_INSTANCE = process.env.EVOLUTION_INSTANCE || 'Ariana_SAC';
const WHATSAPP_EVOLUTION_DEFAULT_WEBHOOK_URL = process.env.EVOLUTION_WEBHOOK_URL || `${APP_BASE_URL || 'http://localhost:3000'}/api/whatsapp/webhook`;
const DEFAULT_WHATSAPP_SETTINGS = { enabled: String(process.env.EVOLUTION_ENABLED || 'true').toLowerCase() !== 'false', apiUrl: WHATSAPP_EVOLUTION_DEFAULT_API_URL, apiKey: process.env.EVOLUTION_API_KEY || '', instanceName: WHATSAPP_EVOLUTION_DEFAULT_INSTANCE, webhookUrl: WHATSAPP_EVOLUTION_DEFAULT_WEBHOOK_URL, webhookEvents: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'SEND_MESSAGE', 'CONNECTION_UPDATE'], webhookByEvents: false, webhookBase64: false, autoNotifyOrderStatus: true, chatNotifyEnabled: true, defaultCountryCode: '55', statusTemplate: 'Olá, {customerName}! Seu pedido {orderId} na Ariana Móveis agora está em: {status}.{trackingLine}', testNumber: process.env.EVOLUTION_TEST_NUMBER || '', testMessage: 'Olá! Este é um teste de integração do WhatsApp da Ariana Móveis.', adminNotifyNumbers: process.env.EVOLUTION_ADMIN_NOTIFY_NUMBERS || process.env.EVOLUTION_ADMIN_NUMBER || '' };
const DEFAULT_PAYMENTS_SETTINGS = { mercadopago: { enabled: true, accessToken: process.env.MP_ACCESS_TOKEN || '', publicKey: process.env.MP_PUBLIC_KEY || '', webhookSecret: process.env.MP_WEBHOOK_SECRET || '', splitEnabled: true }, pagarme: { enabled: true, apiKey: process.env.PAGARME_API_KEY || '', endpoint: process.env.PAGARME_API_URL || 'https://api.pagar.me/core/v5' } };
const RODOCAP_ALLOWED_CITIES = ['AGUA BOA', 'AGUANIL', 'ANGELANDIA', 'ARAUJOS', 'ARCOS', 'ARICANDUVA', 'BAMBUI', 'BELO HORIZONTE', 'BETIM', 'BOCAIUVA', 'BORDA DA MATA', 'BRASILIA DE MINAS', 'CACHOEIRA DE MINAS', 'CAETABOPOLIS', 'CAMANDUCAIA', 'CAMBUI', 'CAMBUQUIRA', 'CAMPANHA', 'CAMPO BELO', 'CANDEIAS', 'CANTAGALO', 'CAPELINHA', 'CAPIM BRANCO', 'CAPITAO ENEAS', 'CAPITOLIO', 'CARBONITA', 'CAREACU', 'CARMO DO CAJURU', 'CHAPADA DO NORTE', 'CLAUDIO', 'CONCEICAO DO PARA', 'CONCEICAO DOS OUROS', 'CONFINS', 'CONGONHAL', 'CONTAGEM', 'CORINTO', 'CORREGO FUNDO', 'COUTO DE MAGALHAES DE MINAS', 'CRISTAIS', 'CURVELO', 'DATAS', 'DIAMANTINA', 'DIVINOLANDIA DE MINAS', 'DIVINOPOLIS', 'DORES DE GUANHAES', 'ESTIVA', 'FELIXLANDIA', 'FERROS', 'FORMIGA', 'FRANCISCO SA', 'GOUVEIA', 'GUANHAES', 'IBIRITE', 'IGARATINGA', 'IGUATAMA', 'INIMUTABA', 'ITABIRA', 'ITAMARANDIBA', 'ITAUNA', 'JANAUBA', 'JANUARIA', 'JAPONVAR', 'JOSE RAYDAN', 'LAGOA DA PRATA', 'LAGOA SANTA', 'LAVRAS', 'LONTRA', 'MATERLANDIA', 'MATOZINHOS', 'MINAS NOVAS', 'MIRABELA', 'MONTES CLAROS', 'NOVA LIMA', 'NOVA PORTEIRINHA', 'NOVA SERRANA', 'OLIVEIRA', 'PAINS', 'PARA DE MINAS', 'PARAOPEBA', 'PECANHA', 'PERDIGAO', 'PERDOES', 'PIMENTA', 'PITANGUI', 'PIUMHI', 'PORTEIRINHA', 'POUSO ALEGRE', 'PRUDENTE DE MORAIS', 'RIBEIRAO DAS NEVES', 'RIO VERMELHO', 'SABARA', 'SABINOPOLIS', 'SALINAS', 'SANTA LUZIA', 'SANTA MARIA DE ITABIRA', 'SANTA MARIA DO SUACUI', 'SANTA RITA DO SAPUCAI', 'SANTANA DO JACARE', 'SAO BENTO ABADE', 'SAO GONCALO DO PARA', 'SAO JOAO EVANGELISTA', 'SAO JOSE DA LAPA', 'SAO JOSE DO JACURI', 'SAO PEDRO DO SUACUI', 'SAO SEBASTIAO DA BELA VISTA', 'SAO SEBASTIAO DO OESTE', 'SAO SEBASTIAO DO SAPUCAI', 'SARZEDO', 'SENHORA DO PORTO', 'SERRO', 'SETE LAGOAS', 'SILVIANOPOLIS', 'TAIOBEIRAS', 'TRES CORACOES', 'TURMALINA', 'VARGINHA', 'VEREDINHA', 'VESPASIANO', 'VIRGINOPOLIS', 'ARUJA', 'BARUERI', 'CAJAMAR', 'CAMPINAS', 'CARAPICUIBA', 'COTIA', 'DIADEMA', 'EMBU DAS ARTES', 'FERRAZ DE VASCONCELOS', 'GUARULHOS', 'HORTOLANDIA', 'INDAIATUBA', 'ITAPECERICA DA SERRA', 'ITAQUAQUECETUBA', 'ITUPEVA', 'JANDIRA', 'JUNDIAI', 'LOUVEIRA', 'MAUA', 'MOGI DAS CRUZES', 'OSASCO', 'POA', 'RIBEIRAO PIRES', 'SANTANA DE PARNAIBA', 'SANTO ANDRE', 'SAO BERNARDO DO CAMPO', 'SAO CAETANO DO SUL', 'SAO PAULO', 'SUZANO', 'TABOAO DA SERRA', 'VALINHOS', 'VARGEM GRANDE PAULISTA', 'VARZEA PAULISTA', 'VINHEDO'];
const DEFAULT_SHIPPING_SETTINGS = { montagemPercent: 0.12, correios: { enabled: true, origemCep: process.env.LOJA_ORIGEM_CEP || '', servicos: String(process.env.CORREIOS_SERVICOS || '03298,03328').split(',').map(s => String(s).trim()).filter(Boolean), pesoKgPadrao: 1, alturaCmPadrao: 10, larguraCmPadrao: 15, comprimentoCmPadrao: 20, valorDeclaradoPadrao: 0, maxWeightKg: 30, maxDimensionCm: 100 }, businessRules: { arianaMoveis: { enabled: true, sellerNames: ['ARIANA MOVEIS', 'ARIANA MÓVEIS'], freeCepStart: '39740-000', freeCepEnd: '39740-000', label: 'Ariana Móveis', prazo: '1 a 3 dias úteis' }, snDigital: { enabled: true, appliesToArianaLogistics: true, maxKmTier1: 40, priceTier1: 120, maxKmTier2: 70, priceTier2: 190, label: 'SN Digital', prazo: '1 a 3 dias úteis' }, rodocap: { enabled: true, appliesToArianaLogistics: true, minKmExclusive: 70, percentOfInvoice: 0.12, label: 'Rodocap', prazoPadrao: 'sob consulta', allowedCities: RODOCAP_ALLOWED_CITIES, onlyUrbanArea: true } }, carriers: { correios: { enabled: true, maxWeightKg: 30, maxDimensionCm: 100 }, totalExpress: { enabled: true, maxWeightKg: 30, maxDimensionCm: 110 }, ownDelivery: { enabled: true, tiers: [{ maxKm: 30, price: 35 }, { maxKm: 60, price: 70 }] } } };

async function getSetting(key, fallback = null) { const doc = await Setting.findOne({ key }); return doc ? doc.value : fallback; }
async function setSetting(key, value, updatedBy = 'system') { const doc = await Setting.findOneAndUpdate({ key }, { $set: { value, updatedBy } }, { upsert: true, new: true }); return doc.value; }
async function getWhatsappSettings() { const value = await getSetting('whatsapp_evolution', DEFAULT_WHATSAPP_SETTINGS); return { ...DEFAULT_WHATSAPP_SETTINGS, ...(value || {}) }; }
async function saveWhatsappSettings(data, updatedBy = 'system') { const current = await getWhatsappSettings(); const merged = { ...current, ...(data || {}) }; await setSetting('whatsapp_evolution', merged, updatedBy); return merged; }
async function getPaymentsSettings() { const value = await getSetting('payments', DEFAULT_PAYMENTS_SETTINGS); return { mercadopago: { ...DEFAULT_PAYMENTS_SETTINGS.mercadopago, ...(value?.mercadopago || {}) }, pagarme: { ...DEFAULT_PAYMENTS_SETTINGS.pagarme, ...(value?.pagarme || {}) } }; }
async function saveShippingSettings(data, updatedBy = 'system') { const current = await getShippingSettings(); const incoming = data || {}; const merged = { ...current, ...incoming, correios: { ...(current.correios || {}), ...((incoming && incoming.correios) || {}) }, businessRules: { ...(current.businessRules || {}), ...((incoming && incoming.businessRules) || {}), arianaMoveis: { ...((current.businessRules || {}).arianaMoveis || {}), ...(((incoming && incoming.businessRules) || {}).arianaMoveis || {}) }, snDigital: { ...((current.businessRules || {}).snDigital || {}), ...(((incoming && incoming.businessRules) || {}).snDigital || {}) }, rodocap: { ...((current.businessRules || {}).rodocap || {}), ...(((incoming && incoming.businessRules) || {}).rodocap || {}), allowedCities: Array.isArray((((incoming && incoming.businessRules) || {}).rodocap || {}).allowedCities) && (((incoming && incoming.businessRules) || {}).rodocap || {}).allowedCities.length ? (((incoming && incoming.businessRules) || {}).rodocap || {}).allowedCities : (((current.businessRules || {}).rodocap || {}).allowedCities || RODOCAP_ALLOWED_CITIES) } }, carriers: { ...(current.carriers || {}), ...((incoming && incoming.carriers) || {}), correios: { ...((current.carriers || {}).correios || {}), ...(((incoming && incoming.carriers) || {}).correios || {}), enabled: ((incoming && incoming.correios && incoming.correios.enabled !== undefined) ? incoming.correios.enabled : ((((incoming && incoming.carriers) || {}).correios || {}).enabled ?? ((current.carriers || {}).correios || {}).enabled)), maxWeightKg: Number((((incoming && incoming.correios) || {}).maxWeightKg) || ((((incoming && incoming.carriers) || {}).correios || {}).maxWeightKg) || (((current.carriers || {}).correios || {}).maxWeightKg) || 30), maxDimensionCm: Number((((incoming && incoming.correios) || {}).maxDimensionCm) || ((((incoming && incoming.carriers) || {}).correios || {}).maxDimensionCm) || (((current.carriers || {}).correios || {}).maxDimensionCm) || 100) } } }; await setSetting('shipping', merged, updatedBy); return merged; }
async function getShippingSettings() { const value = await getSetting('shipping', DEFAULT_SHIPPING_SETTINGS); const merged = { ...DEFAULT_SHIPPING_SETTINGS, ...(value || {}), correios: { ...(DEFAULT_SHIPPING_SETTINGS.correios || {}), ...(((value || {}).correios) || {}) }, businessRules: { ...(DEFAULT_SHIPPING_SETTINGS.businessRules || {}), ...(((value || {}).businessRules) || {}), arianaMoveis: { ...((DEFAULT_SHIPPING_SETTINGS.businessRules || {}).arianaMoveis || {}), ...((((value || {}).businessRules) || {}).arianaMoveis || {}) }, snDigital: { ...((DEFAULT_SHIPPING_SETTINGS.businessRules || {}).snDigital || {}), ...((((value || {}).businessRules) || {}).snDigital || {}) }, rodocap: { ...((DEFAULT_SHIPPING_SETTINGS.businessRules || {}).rodocap || {}), ...((((value || {}).businessRules) || {}).rodocap || {}), allowedCities: Array.isArray(((((value || {}).businessRules) || {}).rodocap || {}).allowedCities) && ((((value || {}).businessRules) || {}).rodocap || {}).allowedCities.length ? ((((value || {}).businessRules) || {}).rodocap || {}).allowedCities : (((DEFAULT_SHIPPING_SETTINGS.businessRules || {}).rodocap || {}).allowedCities || RODOCAP_ALLOWED_CITIES) } }, carriers: { ...(DEFAULT_SHIPPING_SETTINGS.carriers || {}), ...(((value || {}).carriers) || {}) } }; merged.carriers = merged.carriers || {}; merged.carriers.correios = { ...(DEFAULT_SHIPPING_SETTINGS.carriers.correios || {}), ...((merged.carriers || {}).correios || {}), enabled: merged.correios.enabled !== undefined ? merged.correios.enabled : ((merged.carriers || {}).correios || {}).enabled, maxWeightKg: Number((merged.correios.maxWeightKg !== undefined ? merged.correios.maxWeightKg : ((merged.carriers || {}).correios || {}).maxWeightKg) || 30), maxDimensionCm: Number((merged.correios.maxDimensionCm !== undefined ? merged.correios.maxDimensionCm : ((merged.carriers || {}).correios || {}).maxDimensionCm) || 100) }; return merged; }


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
function buildTrackingLine(order = {}, trackingCode = '') { const code = String(trackingCode || order.trackingCode || order.tracking_code || '').trim(); return code ? ` Código de rastreio: ${code}` : ''; }
function buildOrderStatusMessage(orderId, order = {}, settings = {}) { const template = String(settings.statusTemplate || DEFAULT_WHATSAPP_SETTINGS.statusTemplate).trim(); const replacements = { customerName: extractOrderCustomerName(order), orderId: String(orderId || order.id || order.orderId || '').trim() || '---', status: String(order.status || order.statusLabel || 'Atualizado').trim(), trackingCode: String(order.trackingCode || order.tracking_code || '').trim(), trackingLine: buildTrackingLine(order), storeName: 'Ariana Móveis' }; return template.replace(/\{(customerName|orderId|status|trackingCode|trackingLine|storeName)\}/g, (_, key) => replacements[key] || '').replace(/\n{3,}/g, '\n\n').trim(); }
function buildOrderChatMessage(orderId, order = {}, message = {}) { const senderName = String(message.senderName || 'Equipe Ariana Móveis').trim(); const senderType = String(message.senderType || 'admin').trim(); const customerName = extractOrderCustomerName(order); const base = senderType === 'customer' ? `Olá! O cliente ${senderName} enviou uma nova mensagem no pedido ${orderId} da Ariana Móveis.` : `Olá, ${customerName}! Você recebeu uma nova mensagem sobre o pedido ${orderId} na Ariana Móveis.`; const text = String(message.text || '').trim(); return `${base}\n\nMensagem: ${text}`.trim(); }
async function waSendTextMessage({ number, text, settings = null, delay = 0 }) { const cfg = settings || await getWhatsappSettings(); if (!cfg.enabled) throw new Error('Integração WhatsApp desativada.'); if (!cfg.apiUrl || !cfg.apiKey || !cfg.instanceName) throw new Error('Configuração incompleta do WhatsApp.'); const normalizedNumber = normalizePhone(number, cfg.defaultCountryCode || '55'); if (!normalizedNumber) throw new Error('Número de telefone inválido.'); const url = `${String(cfg.apiUrl).replace(/\/+$/, '')}/message/sendText/${encodeURIComponent(cfg.instanceName)}`; const response = await axios.post(url, { number: normalizedNumber, text: String(text || '').trim(), delay: Number(delay || 0) || 0, linkPreview: false }, { headers: { 'Content-Type': 'application/json', apikey: cfg.apiKey }, timeout: 30000 }); return { ok: true, url, number: normalizedNumber, instanceName: cfg.instanceName, data: response.data, status: response.status }; }

function formatMoneyBRL(value = 0) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: DEFAULT_CURRENCY }).format(Number(value || 0));
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
  const painelUrl = process.env.ADMIN_PANEL_URL || process.env.APP_ADMIN_URL || process.env.APP_BASE_URL || '';

  return [
    '🛒 *NOVA VENDA REALIZADA*',
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
    formatOrderItemsForWhatsapp(order.items || []),
    painelUrl ? `
Painel: ${painelUrl}` : ''
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
  const painelUrl = process.env.ADMIN_PANEL_URL || process.env.APP_ADMIN_URL || process.env.APP_BASE_URL || '';

  return [
    '📦 *PEDIDO ATUALIZADO*',
    '',
    `Pedido: #${orderShort}`,
    `Cliente: ${customerName}`,
    customerPhone ? `Telefone: ${customerPhone}` : 'Telefone: não informado',
    `Status anterior: ${previousStatus}`,
    `Novo status: ${nextStatus}`,
    `Valor total: ${formatMoneyBRL(order.total || 0)}`,
    trackingCode ? `Rastreio: ${trackingCode}` : '',
    painelUrl ? `Painel: ${painelUrl}` : ''
  ].filter(Boolean).join('\n');
}

async function waNotifyAdminOrderStatusChange(orderId, before = {}, after = {}, origin = 'admin_order_status_update') {
  try {
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
async function waMaybeNotifyOrderStatusChange(orderId, before = {}, after = {}, origin = 'route') { const prevStatus = String(before?.status || '').trim(); const nextStatus = String(after?.status || '').trim(); if (!nextStatus) return { skipped: true, reason: 'missing_status' }; if (prevStatus === nextStatus) return { skipped: true, reason: 'status_unchanged' }; const settings = await getWhatsappSettings(); if (!settings.enabled) return { skipped: true, reason: 'integration_disabled' }; if (!settings.autoNotifyOrderStatus) return { skipped: true, reason: 'auto_notify_disabled' }; const alreadyNotified = String(after?.whatsappNotification?.lastStatusNotified || '').trim(); if (alreadyNotified === nextStatus) return { skipped: true, reason: 'already_notified' }; const number = extractOrderPhone(after, settings.defaultCountryCode || '55'); if (!number) { await Order.findByIdAndUpdate(orderId, { $set: { whatsappNotification: { ...(after.whatsappNotification || {}), lastAttemptAt: now(), lastStatusNotified: null, lastError: 'Telefone do cliente não encontrado.', origin } } }); return { skipped: true, reason: 'missing_phone' }; } const text = buildOrderStatusMessage(orderId, after, settings); const sent = await waSendTextMessage({ number, text, settings }); await Order.findByIdAndUpdate(orderId, { $set: { whatsappNotification: { ...(after.whatsappNotification || {}), lastAttemptAt: now(), lastStatusNotified: nextStatus, lastMessage: text, lastPhone: number, lastError: null, lastResponse: redact(sent.data || null), origin } } }); await writeAuditLog({ scope: 'whatsapp_evolution', eventType: 'order_status_whatsapp_sent', orderId: String(orderId), status: 'success', request: { number, text, origin }, response: sent.data || null, metadata: { instanceName: settings.instanceName, apiUrl: settings.apiUrl } }); return { ok: true, number, text, sent }; }
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
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}
function pickPrice(item = {}) { const raw = item.pcFinal ?? item.vrServico ?? item.preco ?? item.valor ?? item.price ?? item.pcProduto ?? null; return parseMoneyBR(raw); }
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
      const resolvedPrazo = resolvedDeadlineDays ? `${resolvedDeadlineDays} dia(s) úteis` : ((coProduto === '03298') ? '3 a 7 dias úteis' : (coProduto === '03328' || coProduto === '03220') ? '1 a 3 dias úteis' : 'sob consulta');
      quotes.push({ service: coProduto, label: SERVICE_NAMES[coProduto] || coProduto, name: SERVICE_NAMES[coProduto] || coProduto, price: pickPrice(item), prazo: resolvedPrazo, deadlineDays: resolvedDeadlineDays, raw: item }); } quotes.sort((a,b) => Number(a.price ?? 1e9) - Number(b.price ?? 1e9)); return { ok: true, quotes, errors, bestQuote: quotes[0] || null, meta: { cepOrigem, cepDestino, pesoKg: pesoKgNum, dimensionsUsed: hasDims ? { comprimento: Number(comprimento), largura: Number(largura), altura: Number(altura) } : null, servicesRequested: cfg.services, limits: { maxWeightKg: Number((shippingSettings.carriers?.correios || {}).maxWeightKg || 30), maxSideCm: Number((shippingSettings.carriers?.correios || {}).maxDimensionCm || 100) } } }; }
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
      'GUANHÃES|MG': { lat: -18.7752, lon: -42.9325 }
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
function normalizeShippingText(value = '') { return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, ' ').trim().toUpperCase(); }
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
async function lookupCepInfo(cep = '') { const normalizedCep = normalizeCepValue(cep); if (!normalizedCep) return null; if (viaCepCache.has(normalizedCep)) return viaCepCache.get(normalizedCep); try { const url = `https://viacep.com.br/ws/${normalizedCep}/json/`; const response = await axios.get(url, { timeout: 10000 }); const data = response.data || {}; if (data.erro) { viaCepCache.set(normalizedCep, null); return null; } const parsed = { cep: normalizedCep, city: data.localidade || '', state: data.uf || '', neighborhood: data.bairro || '' }; viaCepCache.set(normalizedCep, parsed); return parsed; } catch (_error) { return null; } }
async function resolveDestinationLocation(body = {}) { const cep = normalizeCepValue(body.cepDestino || body.cep || body.destinationCep || body.shippingAddress?.cep || ''); const explicitCity = body.cidade || body.city || body.destinationCity || body.shippingAddress?.cidade || body.shippingAddress?.city || ''; const explicitState = body.uf || body.state || body.destinationState || body.shippingAddress?.uf || body.shippingAddress?.state || ''; if (explicitCity) return { cep, city: String(explicitCity).trim(), state: String(explicitState || '').trim(), source: 'request' }; const viaCep = await lookupCepInfo(cep); if (viaCep) return { ...viaCep, source: 'viacep' }; return { cep, city: '', state: '', source: cep ? 'cep_only' : 'unknown' }; }
function isRodocapCityAllowed(city = '', rodocapRule = {}) { const normalizedCity = normalizeShippingText(city); if (!normalizedCity) return false; const allowed = Array.isArray(rodocapRule.allowedCities) ? rodocapRule.allowedCities : []; return allowed.map(normalizeShippingText).includes(normalizedCity); }
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
  const originCep = normalizeCepValue(settings?.correios?.origemCep || process.env.LOJA_ORIGEM_CEP || '');
  const inferredDistanceKm = await getDistanceKm(originCep, destinationCep);
  const distanceKm = Number(body.distanceKm || body.km || inferredDistanceKm || 0);
  const options = [];
  const isAriana = body.shippingRule === 'ariana' || body.isArianaOrder === true || sellerCtx.isAriana;
  const isSNDigital = body.shippingRule === 'sn_digital' || sellerCtx.isSNDigital;
  const usesArianaLogistics = isAriana || body.useArianaLogistics === true || body.enableArianaLogistics === true || businessRules?.snDigital?.appliesToArianaLogistics === true || businessRules?.rodocap?.appliesToArianaLogistics === true;

  const hasArianaFree = isAriana && arianaRule.enabled !== false && destinationCep && cepInRange(destinationCep, arianaRule.freeCepStart, arianaRule.freeCepEnd);
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

  if (usesArianaLogistics && snRule.enabled !== false && !hasArianaFree && distanceKm > 0 && distanceKm <= Number(snRule.maxKmTier1 || 40)) {
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
  if (usesArianaLogistics && snRule.enabled !== false && !hasArianaFree && distanceKm > Number(snRule.maxKmTier1 || 40) && distanceKm <= Number(snRule.maxKmTier2 || 70)) {
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
  if (usesArianaLogistics && rodocapRule.enabled !== false && !hasArianaFree && distanceKm > Number(rodocapRule.minKmExclusive || 70)) {
    const allowedCity = isRodocapCityAllowed(location.city, rodocapRule);
    if (allowedCity) {
      const rodocapPrice = Number((productPrice * Number(rodocapRule.percentOfInvoice || 0.12)).toFixed(2));
      options.push(buildManualShippingOption({
        service: 'rodocap_12_percent',
        label: rodocapRule.label || 'Rodocap',
        price: rodocapPrice,
        prazo: rodocapRule.prazoPadrao || 'sob consulta',
        provider: 'configured',
        details: `Rodocap acima de ${Number(rodocapRule.minKmExclusive || 70)} km: 12% do valor da nota para cidades atendidas.`,
        metadata: { rule: 'rodocap_12_percent', distanceKm, destinationCity: location.city, destinationState: location.state, locationSource: location.source },
        deadlineDays: parsePrazoToDeadlineDays(rodocapRule.prazoPadrao || '')
      }));
    } else {
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

  const correios = settings.carriers?.correios || {};
  const correiosAllowed = !hasArianaFree && correios.enabled && weightKg > 0 && weightKg <= Number(correios.maxWeightKg || 30) && maxDimensionCm > 0 && maxDimensionCm <= Number(correios.maxDimensionCm || 100);
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
  } else if (!hasArianaFree) {
    options.push({ service: 'correios_unavailable_limits', label: 'Correios', unavailable: true, provider: 'correios', error: `Correios disponíveis somente até ${Number(correios.maxWeightKg || 30)}kg e até ${Number(correios.maxDimensionCm || 100)}cm no maior lado.`, metadata: { weightKg, maxDimensionCm } });
  }

  const totalExpress = settings.carriers?.totalExpress || {};
  if (!hasArianaFree && totalExpress.enabled && weightKg > 0 && weightKg <= Number(totalExpress.maxWeightKg || 30) && maxDimensionCm > 0 && maxDimensionCm <= Number(totalExpress.maxDimensionCm || 110)) {
    const base = Number(settings.totalExpressBasePrice || 0);
    if (base > 0) options.push(buildManualShippingOption({ service: 'total_express', label: 'Total Express', price: base, prazo: settings.totalExpressPrazo || 'sob consulta', provider: 'configured' }));
  }

  const ownDelivery = settings.carriers?.ownDelivery || {};
  if (!hasArianaFree && !isAriana && !isSNDigital && ownDelivery.enabled && Number(distanceKm || 0) > 0) {
    const own = calculateOwnDelivery(distanceKm, ownDelivery.tiers || []);
    if (own.available) options.push(buildManualShippingOption({ service: 'own_delivery', label: 'Entrega Própria', price: own.price, prazo: '1 a 3 dias úteis', provider: 'configured' }));
  }

  options.sort((a, b) => Number(a.price ?? 1e9) - Number(b.price ?? 1e9));
  const normalizedOptions = options.map((option) => ({
    ...option,
    name: option.name || option.label || 'Logística',
    prazo: option.prazo || (option.deadlineDays ? `${option.deadlineDays} dia(s) úteis` : null),
    deliveryTime: option.prazo || (option.deadlineDays ? `${option.deadlineDays} dia(s) úteis` : null),
    prazoEntrega: option.prazo || (option.deadlineDays ? `${option.deadlineDays} dia(s) úteis` : null),
    deadlineDays: option.deadlineDays || parsePrazoToDeadlineDays(option.prazo || '')
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
      isSNDigital,
      usesArianaLogistics,
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
      carriers: settings.carriers || {}
    }
  };
}
async function buildMercadoPagoHeaders() { const settings = await getPaymentsSettings(); const accessToken = settings.mercadopago?.accessToken || process.env.MP_ACCESS_TOKEN || ''; if (!accessToken) throw new Error('Mercado Pago access token não configurado.'); return { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }; }
async function createMercadoPagoPayment(payload) { const headers = await buildMercadoPagoHeaders(); const idempotencyKey = uid('mp'); const response = await axios.post('https://api.mercadopago.com/v1/payments', payload, { headers: { ...headers, 'X-Idempotency-Key': idempotencyKey }, timeout: 30000, validateStatus: () => true }); return { response, idempotencyKey }; }
async function createPagarmeOrder(payload) { const settings = await getPaymentsSettings(); const apiKey = settings.pagarme?.apiKey || process.env.PAGARME_API_KEY || ''; const endpoint = settings.pagarme?.endpoint || 'https://api.pagar.me/core/v5'; if (!apiKey) throw new Error('Pagar.me API key não configurada.'); return axios.post(`${endpoint}/orders`, payload, { auth: { username: apiKey, password: '' }, headers: { 'Content-Type': 'application/json' }, timeout: 30000, validateStatus: () => true }); }

app.get('/', (_req, res) => res.json({ ok: true, service: 'Ariana Móveis Enterprise Mongo API', buildId: BUILD_ID }));
app.get('/health', (_req, res) => res.json({ ok: true, mongo: mongoose.connection.readyState === 1 ? 'connected' : `state_${mongoose.connection.readyState}`, buildId: BUILD_ID, uptime: process.uptime(), time: new Date().toISOString() }));
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
app.post('/api/seller/partner-request', async (req, res) => { try { const body = req.body || {}; const sellerId = uid('seller'); const seller = await Seller.create({ sellerId, displayName: body.name || body.displayName || '', storeName: body.storeName || body.name || '', email: body.email || '', phone: body.phone || '', document: body.document || body.cpf || '', status: 'pending', metadata: body }); return res.json({ ok: true, id: seller.sellerId, sellerId: seller.sellerId, seller: toJSON(seller) }); } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Erro ao criar solicitação de parceiro' }); } });
app.post('/api/seller/complete-onboarding', async (req, res) => { try { const sellerId = String(req.body?.sellerId || req.body?.partner_request_id || '').trim(); if (!sellerId) return res.status(400).json({ ok: false, error: 'sellerId é obrigatório' }); const seller = await Seller.findOneAndUpdate({ sellerId }, { $set: { onboardingCompleted: true, status: 'approved', metadata: { ...(req.body || {}) } } }, { new: true }); if (!seller) return res.status(404).json({ ok: false, error: 'Seller não encontrado' }); return res.json({ ok: true, seller: toJSON(seller) }); } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Erro ao completar onboarding' }); } });

// ===== ROTAS SELLER CORRIGIDAS - ESPECÍFICAS ANTES DO CURINGA /api/seller/:sellerId =====
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
function sellerProfile(s,u){ const o=toJSON(s)||{}; return {...o,id:String(o.sellerId||o._id||''),sellerId:String(o.sellerId||''),name:o.displayName||o.storeName||u?.name||'',factoryName:o.storeName||o.displayName||u?.name||'',email:o.email||u?.email||'',active:!['bloqueado','reprovado','blocked','rejected'].includes(String(o.status||'').toLowerCase())}; }
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
app.get('/api/seller/orders',sellerAuthRequired,async(req,res)=>{try{const sid=req.sellerId; const rows=await Order.find({$or:[{sellerIds:sid},{'items.sellerId':sid}]}).sort({createdAt:-1}).limit(500); return res.json(rows.map(toJSON));}catch(e){return res.status(500).json({ok:false,error:e.message||'Erro ao listar pedidos'});}});
app.get('/api/seller/orders/:id',sellerAuthRequired,async(req,res)=>{try{const oid=normalizeObjectId(req.params.id); if(!oid)return res.status(400).json({ok:false,error:'ID inválido'}); const order=await Order.findById(oid); if(!order)return res.status(404).json({ok:false,error:'Pedido não encontrado'}); return res.json({ok:true,order:toJSON(order)});}catch(e){return res.status(500).json({ok:false,error:e.message||'Erro ao carregar pedido'});}});
app.put('/api/seller/orders/:id/status',sellerAuthRequired,async(req,res)=>{try{const oid=normalizeObjectId(req.params.id); if(!oid)return res.status(400).json({ok:false,error:'ID inválido'}); const before=await Order.findById(oid); if(!before)return res.status(404).json({ok:false,error:'Pedido não encontrado'}); const order=await Order.findByIdAndUpdate(oid,{$set:{status:req.body?.status||'processing',statusLabel:req.body?.statusLabel||req.body?.status||'processing'}},{new:true}); const customerWhatsapp=await waMaybeNotifyOrderStatusChange(String(order._id),toJSON(before),toJSON(order),'seller_status_route'); const adminWhatsapp=await waNotifyAdminOrderStatusChange(String(order._id),toJSON(before),toJSON(order),'seller_status_route_admin'); return res.json({ok:true,order:toJSON(order),whatsapp:customerWhatsapp,adminWhatsapp});}catch(e){return res.status(500).json({ok:false,error:e.message||'Erro ao atualizar status'});}});
app.post('/api/seller/orders/:id/ship',sellerAuthRequired,async(req,res)=>{try{const oid=normalizeObjectId(req.params.id); if(!oid)return res.status(400).json({ok:false,error:'ID inválido'}); const trackingCode=String(req.body?.trackingCode||req.body?.tracking||'').trim(); const carrier=String(req.body?.carrier||'').trim(); const order=await Order.findById(oid); if(!order)return res.status(404).json({ok:false,error:'Pedido não encontrado'}); order.status='shipped'; order.statusLabel='Enviado'; order.trackingCode=trackingCode||order.trackingCode; order.shipping={...(order.shipping||{}),carrier,trackingCode:trackingCode||order.trackingCode,shippedAt:now()}; order.trackingHistory=ensureArray(order.trackingHistory); order.trackingHistory.push({status:'shipped',label:'Pedido enviado pelo seller',carrier,trackingCode,date:now()}); await order.save(); return res.json({ok:true,order:toJSON(order)});}catch(e){return res.status(500).json({ok:false,error:e.message||'Erro ao marcar enviado'});}});

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
// SEO: SITEMAP E ROBOTS DINÂMICOS
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

app.get('/api/seller/products', async (req, res) => {
  try {
    const query = {};
    const sellerId = String(req.query.sellerId || req.query.seller_id || req.query.storeId || '').trim();
    if (sellerId) query.sellerId = sellerId;
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

app.get('/api/seller/products/:id', async (req, res) => {
  try {
    const oid = normalizeObjectId(req.params.id);
    let row = oid ? await Product.findById(oid) : null;
    if (!row) row = await Product.findOne({ $or: [{ sku: req.params.id }, { slug: req.params.id }] });
    if (!row) return res.status(404).json({ ok: false, error: 'Produto não encontrado' });
    return res.json(normalizeProductForResponse(row));
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar produto do seller' });
  }
});
app.post('/api/products', authRequired, async (req, res) => { try { const body = req.body || {}; const sellerId = String(body.sellerId || req.user.sellerId || '').trim(); const seller = sellerId ? await Seller.findOne({ sellerId }) : null; const images = ensureArray(body.images).filter(Boolean); const image = body.image || images[0] || null; const doc = await Product.create({ sellerId, sellerName: seller?.storeName || seller?.displayName || '', name: body.name, slug: body.slug || sanitizeIdPart(body.name), description: body.description || '', category: body.category || '', categoryId: body.categoryId || '', brand: body.brand || '', sku: body.sku || uid('sku'), price: Number(body.price || 0), oldPrice: body.oldPrice !== undefined ? Number(body.oldPrice) : null, pixPrice: body.pixPrice !== undefined ? Number(body.pixPrice) : null, installmentCount: Number(body.installmentCount || 12), image, images: image ? Array.from(new Set([image, ...images])) : images, stock: Number(body.stock || 0), active: body.active !== false, specs: body.specs || {}, dimensions: body.dimensions || {}, logistics: body.logistics || {} }); return res.json({ ok: true, product: normalizeProductForResponse(doc) }); } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Erro ao cadastrar produto' }); } });
app.put('/api/products/:id', authRequired, async (req, res) => { try { const oid = normalizeObjectId(req.params.id); if (!oid) return res.status(400).json({ ok: false, error: 'ID inválido' }); const before = await Product.findById(oid); if (!before) return res.status(404).json({ ok: false, error: 'Produto não encontrado' }); const update = { ...(req.body || {}) }; if (update.price !== undefined) update.price = Number(update.price); if (update.oldPrice !== undefined) update.oldPrice = Number(update.oldPrice); if (update.pixPrice !== undefined) update.pixPrice = Number(update.pixPrice); if (update.stock !== undefined) update.stock = Number(update.stock); const after = await Product.findByIdAndUpdate(oid, { $set: update }, { new: true }); await writeAuditLog({ scope: 'catalog', eventType: 'product_updated', status: 'success', changedKeys: changedKeys(toJSON(before), toJSON(after)), metadata: { productId: String(after._id), sellerId: after.sellerId } }); return res.json({ ok: true, product: normalizeProductForResponse(after) }); } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Erro ao editar produto' }); } });
app.delete('/api/products/:id', authRequired, async (req, res) => { const oid = normalizeObjectId(req.params.id); if (!oid) return res.status(400).json({ ok: false, error: 'ID inválido' }); await Product.findByIdAndDelete(oid); return res.json({ ok: true }); });
app.delete('/api/seller/products/:id', authRequired, async (req, res) => { const oid = normalizeObjectId(req.params.id); if (!oid) return res.status(400).json({ ok: false, error: 'ID inválido' }); await Product.findByIdAndDelete(oid); return res.json({ ok: true }); });
app.get('/api/banners', async (req, res) => {
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
  return ensureArray(body.items).map((item) => {
    const qty = Math.max(1, Number(item.qty || item.quantity || 1) || 1);
    const unitPrice = Number(item.unitPrice || item.price || 0) || 0;
    return {
      productId: String(item.productId || item._id || item.id || '').trim(),
      sellerId: String(item.sellerId || '').trim(),
      name: item.name || item.nome || '',
      sku: item.sku || '',
      qty,
      unitPrice,
      totalPrice: Number(item.totalPrice || (unitPrice * qty)),
      image: item.image || item.imageUrl || item.imagem || ''
    };
  });
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

    if (body.enqueueManufacturer !== false) await enqueueManufacturerDispatch(order);
    await createAdminNotification({
      type: 'order_created',
      title: '🛒 Nova venda recebida',
      message: `Pedido ${order._id} - ${order.customerName || 'Cliente'} - Total ${formatMoneyBRL(order.total || 0)}`,
      relatedId: String(order._id),
      severity: 'success'
    });

    const adminWhatsapp = await waNotifyAdminNewOrder(order, 'api_orders_create');
    return res.json({ ok: true, order: toJSON(order), adminWhatsapp });
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
app.get('/api/admin/orders', adminRequired, async (req, res) => res.json((await Order.find().sort({ createdAt: -1 }).limit(Math.min(Number(req.query.limit || 10), 100))).map(toJSON)));
app.get('/api/admin/notifications', adminRequired, async (_req, res) => res.json((await Notification.find().sort({ createdAt: -1 }).limit(50)).map(toJSON)));
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

function buildMercadoPagoPayer(body = {}) {
  const payer = body.payer || {};
  const cpf = String(body.cpf || body.document || (payer.identification && payer.identification.number) || '').replace(/\D/g, '');
  const firstName = String(body.first_name || body.firstName || payer.first_name || payer.firstName || 'Cliente').trim();
  const lastName = String(body.last_name || body.lastName || payer.last_name || payer.lastName || 'Ariana').trim();
  const email = String(body.email || payer.email || 'cliente@arianamoveis.com').trim();
  const payerAddress = (payer && typeof payer.address === 'object' && payer.address) ? { ...payer.address } : {};

  delete payerAddress.apartment;
  delete payerAddress.complement;
  delete payerAddress.complemento;
  delete payerAddress.city_name;
  delete payerAddress.state_name;

  const out = { ...payer, email, first_name: firstName, last_name: lastName };
  // Evita HTTP 400 do Mercado Pago por campos extras dentro de payer.
  delete out.date_of_birth;
  delete out.birthDate;
  delete out.birth_date;
  delete out.customer;
  if (Object.keys(payerAddress).length) out.address = payerAddress;
  else delete out.address;
  if (cpf) out.identification = { type: ((body.identification && body.identification.type) || (payer.identification && payer.identification.type) || 'CPF'), number: cpf };
  return out;
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
        paymentMethodId: extra.paymentMethodId || mpData?.payment_method_id || '',
        issuerId: extra.issuerId || mpData?.issuer_id || '',
        raw: redact(mpData || {})
      }
    };
    return await Order.findByIdAndUpdate(oid, { $set: patch }, { new: true });
  } catch (error) {
    console.error('Erro ao atualizar pedido com pagamento Mercado Pago:', error.message || error);
    return null;
  }
}

app.get('/api/payments/mp/public-key', async (_req, res) => { const settings = await getPaymentsSettings(); return res.json({ ok: true, publicKey: settings.mercadopago?.publicKey || '' }); });
app.post('/api/payments/mp/pix', async (req, res) => { try { const body = req.body || {}; const payload = { transaction_amount: Number(body.amount || body.total || 0), description: body.description || `Pedido Ariana Móveis`, payment_method_id: 'pix', payer: buildMercadoPagoPayer(body), metadata: { orderId: body.orderId || null }, notification_url: body.notification_url || `${APP_BASE_URL || 'http://localhost:3000'}/api/webhooks/mercadopago` }; const { response, idempotencyKey } = await createMercadoPagoPayment(payload); await writeAuditLog({ scope: 'payments', eventType: 'mercadopago_pix_created', orderId: body.orderId || null, status: response.status >= 200 && response.status < 300 ? 'success' : 'error', statusCode: response.status, request: payload, response: response.data, metadata: { provider: 'mercadopago', idempotencyKey } }); if (response.status >= 200 && response.status < 300) return res.status(response.status).json(normalizeMercadoPagoPaymentResponse(response.data)); return res.status(response.status).json({ ok: false, error: response.data?.message || response.data?.cause?.[0]?.description || 'Erro ao criar PIX', details: response.data }); } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Erro ao criar PIX no Mercado Pago' }); } });

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

  await createAdminNotification({
    type: 'payment_updated',
    title: '💳 Pagamento atualizado',
    message: `Pedido ${after._id} - ${mapped.statusLabel} - ${formatMoneyBRL(after.total || mpData?.transaction_amount || 0)}`,
    relatedId: String(after._id),
    severity: mpData?.status === 'approved' ? 'success' : 'info'
  });

  const whatsapp = await waMaybeNotifyOrderStatusChange(String(after._id), toJSON(before), toJSON(after), origin);

  await writeAuditLog({
    scope: 'payments',
    eventType: 'order_updated_from_mercadopago',
    orderId: String(after._id),
    status: 'success',
    changedKeys: changedKeys(toJSON(before), toJSON(after)),
    request: { origin, fallbackOrderId },
    response: { paymentId: mpData?.id || null, mpStatus: mpData?.status || null, orderStatus: after.status },
    metadata: { provider: 'mercadopago', whatsapp }
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

      const updatedOrder = orderUpdate?.order?._id ? await Order.findById(orderUpdate.order._id) : null;
      if (updatedOrder) {
        adminWhatsapp = await waNotifyAdminNewOrder(updatedOrder, 'mercadopago_boleto_created');
      }
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
app.post('/api/payments/pagarme/order', async (req, res) => { try { const payload = req.body || {}; const response = await createPagarmeOrder(payload); await writeAuditLog({ scope: 'payments', eventType: 'pagarme_order_created', orderId: payload.metadata?.orderId || payload.orderId || null, status: response.status >= 200 && response.status < 300 ? 'success' : 'error', statusCode: response.status, request: payload, response: response.data, metadata: { provider: 'pagarme' } }); return res.status(response.status).json({ ok: response.status >= 200 && response.status < 300, data: response.data }); } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Erro ao criar pedido no Pagar.me' }); } });
app.post('/api/webhooks/pagarme', async (req, res) => { try { const payload = req.body || {}; const event = await PaymentEvent.create({ provider: 'pagarme', eventType: payload.type || payload.event || 'unknown', externalId: payload.id ? String(payload.id) : null, orderId: payload.data?.metadata?.orderId || payload.orderId || null, payload }); await writeAuditLog({ scope: 'payments', eventType: 'pagarme_webhook_received', orderId: event.orderId || null, status: 'received', request: payload, metadata: { provider: 'pagarme' } }); return res.json({ ok: true }); } catch (_error) { return res.status(500).json({ ok: false, error: 'Erro ao processar webhook do Pagar.me' }); } });
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
    { key: 'index_sidebar_vertical', targetSlot: 'index_sidebar_vertical', title: 'Promoção especial', subtitle: 'Escolha seu produto e compre pelo WhatsApp', width: 600, height: 900, productLimit: 1, group: 'tvs', href: 'todos_produtos.html?section=offers' },

    { key: 'index_mini_1', targetSlot: 'index_mini_1', title: 'Móveis em destaque', subtitle: 'Renove sua casa com preço especial', width: 800, height: 450, productLimit: 2, group: 'moveis', href: 'categoria.html?category=Móveis' },
    { key: 'index_mini_2', targetSlot: 'index_mini_2', title: 'Som e áudio', subtitle: 'Produtos selecionados para você', width: 800, height: 450, productLimit: 2, group: 'som', href: 'categoria.html?category=Som e Áudio' },
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

async function generateAndSaveProductCreative(doc, variant = 'square', pixPercent = 17) {
  const product = normalizeProductForResponse(doc);
  const buffer = await generateProductPosterBuffer(product, { variant, pixPercent });
  const publicId = `${sanitizeIdPart(product.name || product.sku || product.id)}-${variant}-${Date.now()}`;
  const result = await uploadBufferToCloudinary(buffer, {
    folder: buildCloudinaryFolder(`posters/produtos/${variant}`),
    public_id: publicId
  });
  const poster = { variant, url: result.secure_url, public_id: result.public_id, width: result.width, height: result.height, format: result.format, createdAt: new Date().toISOString() };
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
    const poster = await generateAndSaveProductCreative(doc, variant, pixPercent);

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
        const poster = await generateAndSaveProductCreative(doc, variant, pixPercent);
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
      try { const poster = await generateAndSaveProductCreative(doc, 'square', 17); posters.push({ ok: true, productId: String(doc._id), url: poster.url }); } catch (error) { posters.push({ ok: false, productId: String(doc._id), error: error.message }); }
      try { const story = await generateAndSaveProductCreative(doc, 'story', 17); stories.push({ ok: true, productId: String(doc._id), url: story.url }); } catch (error) { stories.push({ ok: false, productId: String(doc._id), error: error.message }); }
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
      }
      await writeAuditLog({ scope: 'admin_orders', eventType: 'admin_order_updated', orderId: String(afterObj.id || afterObj._id), status: 'success', changedKeys: changed, metadata: { actor: req.admin?.email || req.admin?.id || 'admin' } }).catch(() => null);
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


app.listen(PORT, () => {
  console.log(`🚀 Ariana Enterprise Mongo rodando na porta ${PORT}`);
  console.log(`📁 Uploads em: ${uploadsDir}`);
  console.log(`🌐 Base local: http://localhost:${PORT}/api`);
});