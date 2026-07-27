import dotenv from 'dotenv';
import { OAuth2Client } from 'google-auth-library';

dotenv.config();

export const PORT = Number(process.env.PORT || 3000);
export const JWT_SECRET = process.env.JWT_SECRET;
export const MONGODB_URI = process.env.MONGODB_URI || '';
export const MONGODB_DB = process.env.MONGODB_DB || 'ariana_moveis_db';
export const APP_BASE_URL = (process.env.APP_BASE_URL || '').replace(/\/+$/, '');
export const FRONTEND_URL = (process.env.FRONTEND_URL || process.env.SITE_URL || 'https://arianamoveis.com.br').replace(/\/+$/, '');
export const RESET_PASSWORD_URL = (process.env.RESET_PASSWORD_URL || `${FRONTEND_URL}/redefinir_senha.html`).trim();
export const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || '').trim();
export const EMAIL_HOST = String(process.env.EMAIL_HOST || '').trim();
export const EMAIL_PORT = Number(process.env.EMAIL_PORT || 587);
export const EMAIL_SECURE = String(process.env.EMAIL_SECURE || '').toLowerCase() === 'true' || EMAIL_PORT === 465;
export const EMAIL_USER = String(process.env.EMAIL_USER || '').trim();
export const EMAIL_PASS = String(process.env.EMAIL_PASS || '').trim();
export const EMAIL_FROM = String(process.env.EMAIL_FROM || EMAIL_USER || 'Ariana Móveis <no-reply@arianamoveis.com.br>').trim();
export const MAX_DISPATCH_ATTEMPTS = Number(process.env.MAX_DISPATCH_ATTEMPTS || 5);
export const DISPATCH_RETRY_BASE_MS = Number(process.env.DISPATCH_RETRY_BASE_MS || 5 * 60 * 1000);
export const DEFAULT_CURRENCY = 'BRL';

export const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

const ENV = {
  PORT, JWT_SECRET, MONGODB_URI, MONGODB_DB, APP_BASE_URL, FRONTEND_URL,
  RESET_PASSWORD_URL, GOOGLE_CLIENT_ID, EMAIL_HOST, EMAIL_PORT, EMAIL_SECURE,
  EMAIL_USER, EMAIL_PASS, EMAIL_FROM, MAX_DISPATCH_ATTEMPTS,
  DISPATCH_RETRY_BASE_MS, DEFAULT_CURRENCY, googleClient
};

export default ENV;
