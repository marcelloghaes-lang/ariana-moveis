import dotenv from 'dotenv';

dotenv.config();

const FRONTEND_URL = (process.env.FRONTEND_URL || process.env.SITE_URL || 'https://arianamoveis.com.br').replace(/\/+$/, '');

const ENV = {
  PORT: Number(process.env.PORT || 3000),
  JWT_SECRET: process.env.JWT_SECRET || 'ariana_enterprise_secret',
  MONGODB_URI: process.env.MONGODB_URI || '',
  MONGODB_DB: process.env.MONGODB_DB || 'ariana_moveis_db',
  APP_BASE_URL: (process.env.APP_BASE_URL || '').replace(/\/+$/, ''),
  FRONTEND_URL,
  RESET_PASSWORD_URL: (process.env.RESET_PASSWORD_URL || `${FRONTEND_URL}/redefinir_senha.html`).trim(),
  GOOGLE_CLIENT_ID: String(process.env.GOOGLE_CLIENT_ID || '').trim(),
  EMAIL_HOST: String(process.env.EMAIL_HOST || '').trim(),
  EMAIL_PORT: Number(process.env.EMAIL_PORT || 587),
  EMAIL_SECURE: String(process.env.EMAIL_SECURE || '').toLowerCase() === 'true' || Number(process.env.EMAIL_PORT || 587) === 465,
  EMAIL_USER: String(process.env.EMAIL_USER || '').trim(),
  EMAIL_PASS: String(process.env.EMAIL_PASS || '').trim(),
  EMAIL_FROM: String(process.env.EMAIL_FROM || process.env.EMAIL_USER || 'Ariana Móveis <no-reply@arianamoveis.com.br>').trim(),
  MAX_DISPATCH_ATTEMPTS: Number(process.env.MAX_DISPATCH_ATTEMPTS || 5),
  DISPATCH_RETRY_BASE_MS: Number(process.env.DISPATCH_RETRY_BASE_MS || 5 * 60 * 1000),
  DEFAULT_CURRENCY: 'BRL'
};

export const {
  PORT,
  JWT_SECRET,
  MONGODB_URI,
  MONGODB_DB,
  APP_BASE_URL,
  FRONTEND_URL,
  RESET_PASSWORD_URL,
  GOOGLE_CLIENT_ID,
  EMAIL_HOST,
  EMAIL_PORT,
  EMAIL_SECURE,
  EMAIL_USER,
  EMAIL_PASS,
  EMAIL_FROM,
  MAX_DISPATCH_ATTEMPTS,
  DISPATCH_RETRY_BASE_MS,
  DEFAULT_CURRENCY
} = ENV;

export default ENV;
