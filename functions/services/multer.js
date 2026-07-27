export default function createUploadConfig({ __dirname, fs, path, multer } = {}) {
  if (!__dirname || !fs || !path || !multer) {
    throw new Error('createUploadConfig requer __dirname, fs, path e multer.');
  }

  const uploadsDir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  const tmpUploadsDir = path.join(uploadsDir, '_tmp');
  if (!fs.existsSync(tmpUploadsDir)) fs.mkdirSync(tmpUploadsDir, { recursive: true });

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, tmpUploadsDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '');
      const base = path.basename(file.originalname || 'arquivo', ext).replace(/[^\w\-]+/g, '_');
      cb(null, `${Date.now()}-${base}${ext}`);
    }
  });

  const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

  console.log(`📁 Uploads em: ${uploadsDir}`);

  return { uploadsDir, tmpUploadsDir, storage, upload };
}
