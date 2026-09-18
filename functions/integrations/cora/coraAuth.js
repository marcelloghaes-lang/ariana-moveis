import fs from 'fs';
import https from 'https';
import axios from 'axios';
import crypto from 'crypto';
import { assertCoraConfigured } from './coraConfig.js';

let tokenCache = {
  accessToken: '',
  tokenType: 'Bearer',
  expiresAt: 0
};

function certificateValue(cfg) {
  return cfg.certPem || fs.readFileSync(cfg.certPath);
}

function privateKeyValue(cfg) {
  return cfg.keyPem || fs.readFileSync(cfg.keyPath);
}

function makeHttpsAgent(cfg) {
  return new https.Agent({
    cert: certificateValue(cfg),
    key: privateKeyValue(cfg),
    rejectUnauthorized: true,
    keepAlive: true
  });
}

function parseProviderError(data, status) {
  if (typeof data === 'string' && data.trim()) return data.trim();
  return data?.message || data?.error_description || data?.error || `Cora respondeu HTTP ${status}`;
}

function safeAuthError(data, status) {
  return {
    status: Number(status || 0) || null,
    error: String(data?.error || data?.message || data?.error_description || '').slice(0, 160) || null
  };
}

function certificateCommonName(cfg) {
  try {
    const cert = new crypto.X509Certificate(certificateValue(cfg));
    return String(cert.subject || '').split(/\n|,/).map(part => part.trim()).find(part => part.startsWith('CN='))?.slice(3) || '';
  } catch (_error) {
    return '';
  }
}

async function authProbe(url, cfg) {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: cfg.clientId
  });
  try {
    const response = await axios.post(url, body.toString(), {
      httpsAgent: makeHttpsAgent(cfg),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      timeout: Math.min(cfg.timeoutMs, 20000),
      validateStatus: () => true
    });
    if (response.status >= 200 && response.status < 300 && response.data?.access_token) {
      return { ok: true, status: response.status, error: null };
    }
    return { ok: false, ...safeAuthError(response.data, response.status) };
  } catch (error) {
    return { ok: false, status: null, error: String(error?.code || error?.message || error).slice(0, 160) };
  }
}

export async function diagnoseCoraCredentials() {
  const cfg = assertCoraConfigured();
  const cn = certificateCommonName(cfg);
  const productionUrl = 'https://matls-clients.api.cora.com.br/token';
  const stageUrl = 'https://matls-clients.api.stage.cora.com.br/token';
  const [production, stage] = await Promise.all([
    authProbe(productionUrl, cfg),
    authProbe(stageUrl, cfg)
  ]);
  return {
    configuredEnvironment: cfg.environment,
    clientIdMatchesCertificateCn: Boolean(cn && cfg.clientId && cn === cfg.clientId),
    production,
    stage
  };
}

if (String(process.env.CORA_STARTUP_DIAGNOSTIC || '').toLowerCase() === 'true') {
  setTimeout(async () => {
    try {
      const result = await diagnoseCoraCredentials();
      console.info('[cora-auth-diagnostic]', JSON.stringify(result));
    } catch (error) {
      console.info('[cora-auth-diagnostic]', JSON.stringify({
        error: String(error?.code || error?.message || error).slice(0, 200)
      }));
    }
  }, 2500).unref?.();
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
