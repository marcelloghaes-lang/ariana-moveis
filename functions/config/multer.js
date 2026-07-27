import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const uploadsDir = path.resolve(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

export const tmpUploadsDir = path.join(uploadsDir, '_tmp');
if (!fs.existsSync(tmpUploadsDir)) fs.mkdirSync(tmpUploadsDir, { recursive: true });

console.log(`📁 Uploads em: ${uploadsDir}`);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, tmpUploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '');
    const base = path.basename(file.originalname || 'arquivo', ext).replace(/[^\w\-]+/g, '_');
    cb(null, `${Date.now()}-${base}${ext}`);
  }
});

export const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

export default upload;
