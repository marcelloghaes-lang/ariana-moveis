import https from 'https';
import fs from 'fs';
import axios from 'axios';

const tokenCache = new Map();

function normalizeEnvironment(value = '') {
  const env = String(value || '').trim().toLowerCase();
  return ['production','prod','producao','produção'].includes(env) ? 'production' : 'homologation';
}
function truthy(value) {
  return ['1','true','yes','sim','on'].includes(String(value || '').trim().toLowerCase());
}
function cleanBase64(value = '') {
  return String(value || '')
    .replace(/^data:application\/x-pkcs12;base64,/i, '')
    .replace(/^data:application\/pkcs12;base64,/i, '')
    .replace(/\s+/g, '');
}
function resolveCertificateBuffer(config = {}) {
  const base64 = cleanBase64(config.p12Base64 || '');
  if (base64) {
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length) throw new Error('Certificado P12 Efí inválido.');
    return buffer;
  }
  const filePath = String(config.p12Path || '').trim();
  if (filePath) {
    if (!fs.existsSync(filePath)) throw new Error('Arquivo de certificado P12 Efí não encontrado.');
    return fs.readFileSync(filePath);
  }
  return null;
}

export function getEfiConfig(environmentInput = process.env.EFI_ENV || 'homologation') {
  const environment = normalizeEnvironment(environmentInput);
  const production = environment === 'production';
  const prefix = production ? 'EFI_PROD_' : 'EFI_HOMOLOG_';
  return {
    provider: 'efi',
    environment,
    enabled: truthy(process.env.EFI_ENABLED || 'false'),
    clientId: String(process.env[prefix + 'CLIENT_ID'] || '').trim(),
    clientSecret: String(process.env[prefix + 'CLIENT_SECRET'] || '').trim(),
    p12Base64: String(process.env[prefix + 'P12_BASE64'] || ''),
    p12Path: String(process.env[prefix + 'P12_PATH'] || '').trim(),
    p12Passphrase: String(process.env[prefix + 'P12_PASSPHRASE'] || ''),
    pixKey: String(process.env[prefix + 'PIX_KEY'] || '').trim(),
    pixBaseUrl: production ? 'https://pix.api.efipay.com.br' : 'https://pix-h.api.efipay.com.br',
    chargesBaseUrl: production ? 'https://cobrancas.api.efipay.com.br' : 'https://cobrancas-h.api.efipay.com.br'
  };
}

export function efiConfigSummary(environmentInput) {
  const config = getEfiConfig(environmentInput);
  const certificateConfigured = Boolean(config.p12Base64 || config.p12Path);
  let certificateReadable = false;
  if (certificateConfigured) {
    try { certificateReadable = Boolean(resolveCertificateBuffer(config)?.length); } catch (_) {}
  }
  return {
    provider: 'efi',
    environment: config.environment,
    enabled: config.enabled,
    clientIdConfigured: Boolean(config.clientId),
    clientSecretConfigured: Boolean(config.clientSecret),
    certificateConfigured,
    certificateReadable,
    pixKeyConfigured: Boolean(config.pixKey),
    pixBaseUrl: config.pixBaseUrl,
    chargesBaseUrl: config.chargesBaseUrl,
    checkoutAttached: false,
    productionTrafficEnabled: false
  };
}

function assertCredentials(config, certificateRequired = false) {
  if (!config.clientId || !config.clientSecret) {
    const error = new Error('Credenciais Efí ' + config.environment + ' não configuradas.');
    error.code = 'EFI_CREDENTIALS_MISSING';
    error.statusCode = 503;
    throw error;
  }
  if (!certificateRequired) return null;
  const certificate = resolveCertificateBuffer(config);
  if (!certificate?.length) {
    const error = new Error('Certificado P12 Efí ' + config.environment + ' não configurado.');
    error.code = 'EFI_CERTIFICATE_MISSING';
    error.statusCode = 503;
    throw error;
  }
  return certificate;
}
function tokenKey(environment, api) { return normalizeEnvironment(environment) + ':' + api; }
function getCachedToken(environment, api) {
  const cached = tokenCache.get(tokenKey(environment, api));
  if (!cached?.accessToken || cached.expiresAt <= Date.now() + 30000) return '';
  return cached.accessToken;
}
function cacheToken(environment, api, data = {}) {
  const accessToken = String(data.access_token || '').trim();
  const expiresIn = Math.max(60, Number(data.expires_in || 600));
  if (!accessToken) return '';
  tokenCache.set(tokenKey(environment, api), { accessToken, expiresAt: Date.now() + expiresIn * 1000 });
  return accessToken;
}
function basicAuth(config) {
  return Buffer.from(config.clientId + ':' + config.clientSecret, 'utf8').toString('base64');
}
function efiHttpError(response, stage) {
  const data = response?.data || {};
  const message = data?.mensagem || data?.message || data?.error_description || data?.error || data?.title || ('Efí retornou HTTP ' + (response?.status || 502) + '.');
  const error = new Error(String(message));
  error.code = 'EFI_HTTP_ERROR';
  error.stage = stage;
  error.statusCode = Number(response?.status || 502);
  error.providerData = data;
  return error;
}

export async function getEfiChargesAccessToken(environment = 'homologation', options = {}) {
  const env = normalizeEnvironment(environment);
  if (!options.forceRefresh) {
    const cached = getCachedToken(env, 'charges');
    if (cached) return cached;
  }
  const config = getEfiConfig(env);
  assertCredentials(config, false);
  const response = await axios({
    method: 'post',
    url: config.chargesBaseUrl + '/v1/authorize',
    data: { grant_type: 'client_credentials' },
    headers: { Authorization: 'Basic ' + basicAuth(config), 'Content-Type': 'application/json', Accept: 'application/json' },
    timeout: 30000,
    validateStatus: () => true
  });
  if (response.status < 200 || response.status >= 300) throw efiHttpError(response, 'charges_oauth');
  const token = cacheToken(env, 'charges', response.data || {});
  if (!token) {
    const error = new Error('Efí não retornou access_token na API Cobranças.');
    error.code = 'EFI_TOKEN_MISSING'; error.statusCode = 502; throw error;
  }
  return token;
}

export async function getEfiPixAccessToken(environment = 'homologation', options = {}) {
  const env = normalizeEnvironment(environment);
  if (!options.forceRefresh) {
    const cached = getCachedToken(env, 'pix');
    if (cached) return cached;
  }
  const config = getEfiConfig(env);
  const certificate = assertCredentials(config, true);
  const httpsAgent = new https.Agent({ pfx: certificate, passphrase: config.p12Passphrase || '', keepAlive: true, minVersion: 'TLSv1.2' });
  const response = await axios({
    method: 'post',
    url: config.pixBaseUrl + '/oauth/token',
    data: { grant_type: 'client_credentials' },
    headers: { Authorization: 'Basic ' + basicAuth(config), 'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Encoding': 'identity' },
    httpsAgent,
    timeout: 30000,
    validateStatus: () => true
  });
  if (response.status < 200 || response.status >= 300) throw efiHttpError(response, 'pix_oauth');
  const token = cacheToken(env, 'pix', response.data || {});
  if (!token) {
    const error = new Error('Efí não retornou access_token na API Pix.');
    error.code = 'EFI_TOKEN_MISSING'; error.statusCode = 502; throw error;
  }
  return token;
}

export async function efiPixRequest(options = {}) {
  const env = normalizeEnvironment(options.environment || 'homologation');
  const config = getEfiConfig(env);
  const certificate = assertCredentials(config, true);
  const token = await getEfiPixAccessToken(env);
  const response = await axios({
    method: options.method || 'get',
    url: config.pixBaseUrl + (options.path || '/'),
    data: options.data,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Encoding': 'identity', ...(options.headers || {}) },
    httpsAgent: new https.Agent({ pfx: certificate, passphrase: config.p12Passphrase || '', keepAlive: true, minVersion: 'TLSv1.2' }),
    timeout: 30000,
    validateStatus: () => true
  });
  if (response.status < 200 || response.status >= 300) throw efiHttpError(response, 'pix_request');
  return { status: response.status, data: response.data ?? null };
}

function normalizeDocument(value = '') { return String(value || '').replace(/\D/g, ''); }
function buildFavorecido(recipient = {}) {
  const conta = String(recipient.conta || recipient.account || '').replace(/\D/g, '');
  const document = normalizeDocument(recipient.cnpj || recipient.cpf || recipient.document || '');
  if (!conta) throw new Error('Conta Efí do favorecido é obrigatória.');
  if (![11,14].includes(document.length)) throw new Error('CPF/CNPJ do favorecido é inválido.');
  return { conta, ...(document.length === 14 ? { cnpj: document } : { cpf: document }) };
}

export function buildPixSplitPercentagePayload(options = {}) {
  const platform = Number(options.platformPercent);
  const recipients = Array.isArray(options.recipients) ? options.recipients : [];
  const feeDivision = String(options.feeDivision || 'assumir_total');
  if (!Number.isFinite(platform) || platform <= 0 || platform >= 100) throw new Error('Percentual da Ariana deve ser maior que 0 e menor que 100.');
  if (!recipients.length) throw new Error('Informe ao menos um favorecido para o split.');
  if (!['assumir_total','proporcional'].includes(feeDivision)) throw new Error('Divisão de tarifa inválida.');
  const repasses = recipients.map((recipient) => {
    const percentage = Number(recipient.percentage ?? recipient.percent);
    if (!Number.isFinite(percentage) || percentage <= 0 || percentage >= 100) throw new Error('Percentual do favorecido é inválido.');
    return { tipo: 'porcentagem', valor: percentage.toFixed(2), favorecido: buildFavorecido(recipient) };
  });
  const total = platform + repasses.reduce((sum, item) => sum + Number(item.valor), 0);
  if (Math.abs(total - 100) > 0.001) throw new Error('Os percentuais do split devem somar 100%. Soma atual: ' + total.toFixed(2) + '%.');
  return {
    descricao: String(options.description || 'Split Ariana Marketplace').slice(0, 140),
    lancamento: { imediato: true },
    split: {
      divisaoTarifa: feeDivision,
      minhaParte: { tipo: 'porcentagem', valor: platform.toFixed(2) },
      repasses
    }
  };
}

export async function createPixSplitConfig(options = {}) {
  const payload = buildPixSplitPercentagePayload(options);
  const response = await efiPixRequest({ environment: options.environment || 'homologation', method: 'post', path: '/v2/gn/split/config', data: payload });
  return { ...response, payload };
}

export async function testEfiAuthentication(environment = 'homologation') {
  const env = normalizeEnvironment(environment);
  const chargesStarted = Date.now();
  const chargesToken = await getEfiChargesAccessToken(env, { forceRefresh: true });
  const chargesMs = Date.now() - chargesStarted;
  const pixStarted = Date.now();
  const pixToken = await getEfiPixAccessToken(env, { forceRefresh: true });
  const pixMs = Date.now() - pixStarted;
  return { ok: Boolean(chargesToken && pixToken), environment: env, charges: { ok: Boolean(chargesToken), ms: chargesMs }, pix: { ok: Boolean(pixToken), ms: pixMs } };
}
