import fs from 'fs';
import https from 'https';
import axios from 'axios';
import { assertCoraConfigured } from './coraConfig.js';

let tokenCache = {
  accessToken: '',
  tokenType: 'Bearer',
  expiresAt: 0
};

function makeHttpsAgent(cfg) {
  return new https.Agent({
    cert: fs.readFileSync(cfg.certPath),
    key: fs.readFileSync(cfg.keyPath),
    rejectUnauthorized: true,
    keepAlive: true
  });
}

function parseProviderError(data, status) {
  if (typeof data === 'string' && data.trim()) return data.trim();
  return data?.message || data?.error_description || data?.error || `Cora respondeu HTTP ${status}`;
}

export function clearCoraTokenCache() {
  tokenCache = { accessToken: '', tokenType: 'Bearer', expiresAt: 0 };
}

export function getCoraTokenCacheStatus() {
  return {
    cached: Boolean(tokenCache.accessToken),
    expiresAt: tokenCache.expiresAt ? new Date(tokenCache.expiresAt).toISOString() : null,
    valid: Boolean(tokenCache.accessToken && tokenCache.expiresAt > Date.now())
  };
}

export async function getCoraAccessToken({ forceRefresh = false } = {}) {
  const cfg = assertCoraConfigured();
  const safetyMs = cfg.tokenSafetySeconds * 1000;

  if (!forceRefresh && tokenCache.accessToken && tokenCache.expiresAt - safetyMs > Date.now()) {
    return tokenCache.accessToken;
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: cfg.clientId
  });

  let response;
  try {
    response = await axios.post(cfg.authUrl, body.toString(), {
      httpsAgent: makeHttpsAgent(cfg),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      timeout: cfg.timeoutMs,
      validateStatus: () => true
    });
  } catch (cause) {
    const error = new Error(`Falha de comunicação com a autenticação Cora: ${cause.message || cause}`);
    error.code = 'CORA_AUTH_NETWORK_ERROR';
    error.statusCode = 502;
    error.cause = cause;
    throw error;
  }

  if (response.status < 200 || response.status >= 300) {
    const error = new Error(parseProviderError(response.data, response.status));
    error.code = 'CORA_AUTH_REJECTED';
    error.statusCode = 502;
    error.providerStatus = response.status;
    error.providerData = response.data;
    throw error;
  }

  const accessToken = String(response.data?.access_token || '').trim();
  if (!accessToken) {
    const error = new Error('A Cora não retornou access_token.');
    error.code = 'CORA_AUTH_INVALID_RESPONSE';
    error.statusCode = 502;
    throw error;
  }

  const expiresIn = Math.max(60, Number(response.data?.expires_in || 3600));
  tokenCache = {
    accessToken,
    tokenType: String(response.data?.token_type || 'Bearer'),
    expiresAt: Date.now() + expiresIn * 1000
  };

  return accessToken;
}
