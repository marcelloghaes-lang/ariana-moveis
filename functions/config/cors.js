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

export const dynamicAllowedOrigins = Array.from(new Set([...allowedOrigins, ...envFrontendOrigins]));

export function isAllowedOrigin(origin = '') {
  if (!origin) return true;
  if (dynamicAllowedOrigins.includes(origin)) return true;
  return /^https:\/\/[a-z0-9-]+\.onrender\.com$/i.test(origin);
}

export const corsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) return callback(null, true);
    return callback(new Error(`CORS bloqueado: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'x-ariana-key',
    'X-Ariana-Key',
    'x-api-key',
    'X-API-Key',
    'x-webhook-signature',
    'X-Webhook-Signature'
  ],
  exposedHeaders: ['Content-Length', 'Content-Type'],
  credentials: false,
  optionsSuccessStatus: 204,
};

export default corsOptions;
