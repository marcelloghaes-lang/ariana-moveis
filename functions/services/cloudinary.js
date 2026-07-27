import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';
import path from 'path';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

export function isCloudinaryConfigured() {
  return Boolean(
    String(process.env.CLOUDINARY_CLOUD_NAME || '').trim() &&
    String(process.env.CLOUDINARY_API_KEY || '').trim() &&
    String(process.env.CLOUDINARY_API_SECRET || '').trim()
  );
}

export function safeUploadFolder(input = '') {
  const clean = String(input || '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');

  return clean
    .split('/')
    .filter(Boolean)
    .map((part) => part.replace(/[^a-zA-Z0-9._-]/g, '_'))
    .slice(0, 5)
    .join('/');
}

export function buildCloudinaryFolder(input = '') {
  const folder = safeUploadFolder(input || 'geral') || 'geral';
  return `ariana_moveis/${folder}`;
}

function slugifyFileName(value = '') {
  const clean = String(value || 'produto')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);

  return clean || 'produto';
}

function pickOriginalName(req = {}) {
  const body = req.body || {};
  const file = req.file || {};
  const fromBody = body.name || body.nome || body.productName || body.title || body.titulo;
  const fromFile = file.originalname ? path.basename(file.originalname, path.extname(file.originalname)) : '';
  return fromBody || fromFile || 'produto';
}

function deleteTempFile(filePath = '') {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_error) {}
}

export async function uploadImageFileToCloudinary(filePath, options = {}) {
  if (!filePath) throw new Error('Arquivo temporário não informado');
  if (!isCloudinaryConfigured()) throw new Error('Cloudinary não configurado.');

  const targetFolder = buildCloudinaryFolder(options.path || options.folder || 'produtos');
  const slug = slugifyFileName(options.name || options.nome || 'produto');
  const publicId = `${slug}-${Date.now()}`;

  return cloudinary.uploader.upload(filePath, {
    folder: targetFolder,
    public_id: publicId,
    resource_type: 'image',
    overwrite: true,
    format: 'webp',
    transformation: [
      {
        width: Number(process.env.CLOUDINARY_PRODUCT_MAX_WIDTH || 1600),
        height: Number(process.env.CLOUDINARY_PRODUCT_MAX_HEIGHT || 1600),
        crop: 'limit'
      },
      {
        quality: process.env.CLOUDINARY_PRODUCT_QUALITY || 'auto:good',
        fetch_format: 'auto',
        flags: 'strip_profile'
      }
    ]
  });
}

export async function uploadToCloudinary(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'Nenhum arquivo enviado' });
    }

    if (!isCloudinaryConfigured()) {
      deleteTempFile(req.file.path);
      return res.status(500).json({ ok: false, error: 'Cloudinary não configurado.' });
    }

    const result = await uploadImageFileToCloudinary(req.file.path, {
      path: req.body?.path || req.query?.path || 'produtos',
      name: pickOriginalName(req)
    });

    deleteTempFile(req.file.path);

    return res.json({
      ok: true,
      url: result.secure_url,
      secure_url: result.secure_url,
      public_id: result.public_id,
      publicId: result.public_id,
      path: result.public_id,
      format: result.format,
      width: result.width,
      height: result.height,
      bytes: result.bytes,
      resource_type: result.resource_type,
      folder: result.folder || buildCloudinaryFolder(req.body?.path || req.query?.path || 'produtos')
    });
  } catch (error) {
    deleteTempFile(req.file?.path);
    console.error('Erro no upload Cloudinary:', error);
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao enviar imagem para o Cloudinary' });
  }
}

export default cloudinary;
