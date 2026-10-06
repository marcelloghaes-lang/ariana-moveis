import fs from 'fs';
import https from 'https';
import axios from 'axios';
import crypto from 'crypto';
import { assertCoraConfigured } from './coraConfig.js';
import { clearCoraTokenCache, getCoraAccessToken } from './coraAuth.js';

function buildAgent(cfg) {
  return new https.Agent({ cert: fs.readFileSync(cfg.certPath), key: fs.readFileSync(cfg.keyPath), rejectUnauthorized: true, keepAlive: true });
}
function providerMessage(data, status) {
  if (typeof data === 'string' && data.trim()) return data.trim();
  return data?.message || data?.error_description || data?.error || `Cora respondeu HTTP ${status}`;
}
function headerValue(headers = {}, names = []) {
  for (const name of names) {
    const value = headers?.[name] ?? headers?.[name.toLowerCase()];
    if (value) return String(value);
  }
  return '';
}
function safeHeaders(headers = {}) {
  const out = { ...headers };
  if (out.Authorization) out.Authorization = '[redacted]';
  if (out.authorization) out.authorization = '[redacted]';
  return out;
}

export async function coraRequest({ method = 'GET', path = '/', data, params, idempotencyKey, timeoutMs, retryUnauthorized = true, onTrace } = {}) {
  const cfg = assertCoraConfigured();
  const accessToken = await getCoraAccessToken();
  const cleanPath = String(path || '/').startsWith('/') ? String(path || '/') : `/${path}`;
  const url = `${cfg.apiBaseUrl}${cleanPath}`;
  const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' };
  if (data !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = String(idempotencyKey);
  const startedAt = Date.now();

  let response;
  try {
    response = await axios({ method, url, data, params, headers, httpsAgent: buildAgent(cfg), timeout: Number(timeoutMs || cfg.timeoutMs), validateStatus: () => true });
  } catch (cause) {
    const trace = { method, url, durationMs: Date.now() - startedAt, requestHeaders: safeHeaders(headers), requestBody: data ?? null, responseHeaders: {}, responseBody: null, status: null, requestId: '', traceId: '', idempotencyKey: String(idempotencyKey || ''), networkError: cause.message || String(cause) };
    if (typeof onTrace === 'function') await onTrace(trace);
    const error = new Error(`Falha de comunicação com a API Cora: ${cause.message || cause}`);
    error.code = 'CORA_NETWORK_ERROR'; error.statusCode = 502; error.cause = cause; error.trace = trace;
    throw error;
  }

  const requestId = headerValue(response.headers, ['x-request-id', 'request-id', 'x-correlation-id']);
  const traceId = headerValue(response.headers, ['x-trace-id', 'trace-id', 'x-amzn-trace-id']);
  const trace = { method, url, durationMs: Date.now() - startedAt, requestHeaders: safeHeaders(headers), requestBody: data ?? null, responseHeaders: response.headers || {}, responseBody: response.data ?? null, status: response.status, requestId, traceId, idempotencyKey: String(idempotencyKey || '') };
  if (typeof onTrace === 'function') await onTrace(trace);

  if (response.status === 401 && retryUnauthorized) {
    clearCoraTokenCache();
    return coraRequest({ method, path: cleanPath, data, params, idempotencyKey, timeoutMs, retryUnauthorized: false, onTrace });
  }
  if (response.status < 200 || response.status >= 300) {
    const error = new Error(providerMessage(response.data, response.status));
    error.code = 'CORA_API_ERROR'; error.statusCode = response.status >= 500 ? 502 : 400; error.providerStatus = response.status; error.providerData = response.data; error.trace = trace;
    throw error;
  }
  return { status: response.status, headers: response.headers, data: response.data, trace };
}

export function createCoraIdempotencyKey() { return crypto.randomUUID(); }
