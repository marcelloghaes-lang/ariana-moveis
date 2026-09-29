import https from 'https';
import fs from 'fs';
import axios from 'axios';
import crypto from 'crypto';

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
    payeeCode: String(process.env[prefix + 'PAYEE_CODE'] || '').trim(),
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
    payeeCodeConfigured: Boolean(config.payeeCode),
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

export async function efiChargesRequest(options = {}) {
  const env = normalizeEnvironment(options.environment || 'homologation');
  const config = getEfiConfig(env);
  assertCredentials(config, false);
  const token = await getEfiChargesAccessToken(env);
  const response = await axios({
    method: options.method || 'get',
    url: config.chargesBaseUrl + (options.path || '/'),
    data: options.data,
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers || {})
    },
    timeout: 30000,
    validateStatus: () => true
  });
  if (response.status < 200 || response.status >= 300) throw efiHttpError(response, 'charges_request');
  return { status: response.status, data: response.data ?? null };
}

function normalizePayeeCode(value = '') {
  const payeeCode = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(payeeCode)) {
    const error = new Error('Identificador de conta (payee_code) Efí inválido.');
    error.code = 'EFI_PAYEE_CODE_INVALID';
    error.statusCode = 400;
    throw error;
  }
  return payeeCode;
}

export function buildChargesSplitPercentagePayload(options = {}) {
  const platformPercent = Number(options.platformPercent);
  const recipients = Array.isArray(options.recipients) ? options.recipients : [];
  const feeMode = Number(options.feeMode ?? 1);
  const itemName = String(options.itemName || 'Produto teste Ariana Marketplace').trim().slice(0, 255);
  const amount = Math.max(1, Math.floor(Number(options.amount || 1)));
  const unitValueCents = Math.floor(Number(options.unitValueCents || options.valueCents || 1100));

  if (!Number.isFinite(platformPercent) || platformPercent <= 0 || platformPercent >= 100) {
    throw new Error('Percentual da Ariana deve ser maior que 0 e menor que 100.');
  }
  if (!recipients.length) throw new Error('Informe ao menos um favorecido para o split.');
  if (![1, 2].includes(feeMode)) throw new Error('Modo de tarifa inválido. Use 1 ou 2.');
  if (!Number.isFinite(unitValueCents) || unitValueCents < 1) throw new Error('Valor do item é inválido.');

  const repasses = recipients.map((recipient) => {
    const percentage = Number(recipient.percentage ?? recipient.percent);
    if (!Number.isFinite(percentage) || percentage <= 0 || percentage >= 100) {
      throw new Error('Percentual do favorecido é inválido.');
    }
    return {
      payee_code: normalizePayeeCode(recipient.payeeCode || recipient.payee_code),
      percentage: Math.round(percentage * 100)
    };
  });

  const sellerTotal = repasses.reduce((sum, item) => sum + Number(item.percentage || 0), 0) / 100;
  const total = platformPercent + sellerTotal;
  if (Math.abs(total - 100) > 0.001) {
    throw new Error('Os percentuais do split devem somar 100%. Soma atual: ' + total.toFixed(2) + '%.');
  }

  return {
    items: [{
      name: itemName,
      value: unitValueCents,
      amount,
      marketplace: {
        mode: feeMode,
        repasses
      }
    }],
    metadata: {
      custom_id: String(options.customId || ('ARIANA-EFI-HOMOLOG-' + Date.now())).slice(0, 255)
    }
  };
}

export async function createChargesSplitHomologationTransaction(options = {}) {
  const environment = normalizeEnvironment(options.environment || 'homologation');
  if (environment !== 'homologation') {
    const error = new Error('Transação Split de teste permitida somente em Homologação.');
    error.code = 'EFI_HOMOLOGATION_ONLY';
    error.statusCode = 400;
    throw error;
  }
  const payload = buildChargesSplitPercentagePayload(options);
  const response = await efiChargesRequest({
    environment,
    method: 'post',
    path: '/v1/charge',
    data: payload
  });
  return { ...response, payload };
}


function futureDateIso(days = 3) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + Math.max(1, Number(days || 3)));
  return d.toISOString().slice(0, 10);
}

export async function payChargesSplitBoletoHomologation(chargeIdInput, options = {}) {
  const chargeId = String(chargeIdInput || '').replace(/\D/g, '');
  if (!chargeId) {
    const error = new Error('charge_id Efí inválido.');
    error.code = 'EFI_CHARGE_ID_INVALID';
    error.statusCode = 400;
    throw error;
  }

  const customer = options.customer && typeof options.customer === 'object'
    ? options.customer
    : {
        name: 'Gorbadoc Oldbuck',
        cpf: '94271564656',
        email: 'homologacao@arianamoveis.com.br',
        phone_number: '31985147119',
        address: {
          street: 'Avenida Juscelino Kubitschek',
          number: '909',
          neighborhood: 'Centro',
          zipcode: '39740000',
          city: 'Guanhaes',
          complement: '',
          state: 'MG'
        }
      };

  const payload = {
    payment: {
      banking_billet: {
        customer,
        expire_at: String(options.expireAt || futureDateIso(3)),
        message: String(options.message || 'Teste Boleto Split Ariana Marketplace - Homologacao').slice(0, 400)
      }
    }
  };

  const response = await efiChargesRequest({
    environment: 'homologation',
    method: 'post',
    path: '/v1/charge/' + chargeId + '/pay',
    data: payload
  });

  return { ...response, payload, chargeId };
}


export async function payChargesSplitCardHomologation(chargeIdInput, options = {}) {
  const chargeId = String(chargeIdInput || '').replace(/\D/g, '');
  if (!chargeId) {
    const error = new Error('charge_id Efí inválido.');
    error.code = 'EFI_CHARGE_ID_INVALID';
    error.statusCode = 400;
    throw error;
  }

  const paymentToken = String(options.paymentToken || options.payment_token || '').trim();
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(paymentToken)) {
    const error = new Error('payment_token Efí inválido.');
    error.code = 'EFI_PAYMENT_TOKEN_INVALID';
    error.statusCode = 400;
    throw error;
  }

  const installments = Math.max(1, Math.min(24, Math.floor(Number(options.installments || 1))));
  const customer = options.customer && typeof options.customer === 'object'
    ? options.customer
    : {
        name: 'Gorbadoc Oldbuck',
        cpf: '94271564656',
        email: 'homologacao@arianamoveis.com.br',
        birth: '1990-08-29',
        phone_number: '31985147119'
      };

  const billingAddress = options.billingAddress && typeof options.billingAddress === 'object'
    ? options.billingAddress
    : {
        street: 'Avenida Juscelino Kubitschek',
        number: '909',
        neighborhood: 'Centro',
        zipcode: '39740000',
        city: 'Guanhaes',
        complement: '',
        state: 'MG'
      };

  const payload = {
    payment: {
      credit_card: {
        customer,
        installments,
        payment_token: paymentToken,
        billing_address: billingAddress
      }
    }
  };

  const response = await efiChargesRequest({
    environment: 'homologation',
    method: 'post',
    path: '/v1/charge/' + chargeId + '/pay',
    data: payload
  });

  return { ...response, chargeId, installments };
}

export async function getChargesSplitHomologationTransaction(chargeIdInput) {
  const chargeId = String(chargeIdInput || '').replace(/\D/g, '');
  if (!chargeId) {
    const error = new Error('charge_id Efí inválido.');
    error.code = 'EFI_CHARGE_ID_INVALID';
    error.statusCode = 400;
    throw error;
  }
  return efiChargesRequest({
    environment: 'homologation',
    method: 'get',
    path: '/v1/charge/' + chargeId
  });
}

export async function cancelChargesSplitHomologationTransaction(chargeIdInput) {
  const chargeId = String(chargeIdInput || '').replace(/\D/g, '');
  if (!chargeId) {
    const error = new Error('charge_id Efí inválido.');
    error.code = 'EFI_CHARGE_ID_INVALID';
    error.statusCode = 400;
    throw error;
  }

  const response = await efiChargesRequest({
    environment: 'homologation',
    method: 'put',
    path: '/v1/charge/' + chargeId + '/cancel'
  });

  return { ...response, chargeId };
}

export async function refundChargesSplitCardHomologation(chargeIdInput, options = {}) {
  const chargeId = String(chargeIdInput || '').replace(/\D/g, '');
  if (!chargeId) {
    const error = new Error('charge_id Efí inválido.');
    error.code = 'EFI_CHARGE_ID_INVALID';
    error.statusCode = 400;
    throw error;
  }

  const amount = options.amount == null || options.amount === ''
    ? null
    : Math.floor(Number(options.amount));

  if (amount !== null && (!Number.isFinite(amount) || amount < 1)) {
    const error = new Error('Valor do estorno Efí inválido.');
    error.code = 'EFI_REFUND_AMOUNT_INVALID';
    error.statusCode = 400;
    throw error;
  }

  const payload = amount === null ? {} : { amount };
  const response = await efiChargesRequest({
    environment: 'homologation',
    method: 'post',
    path: '/v1/charge/card/' + chargeId + '/refund',
    data: payload
  });

  return { ...response, chargeId, payload };
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


function normalizeSplitConfigId(value = '') {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9]{8,80}$/.test(id)) {
    const error = new Error('ID da configuração de Split Pix inválido.');
    error.code = 'EFI_SPLIT_CONFIG_ID_INVALID';
    error.statusCode = 400;
    throw error;
  }
  return id;
}

function normalizeTxid(value = '') {
  const txid = String(value || '').trim();
  if (!/^[A-Za-z0-9]{26,35}$/.test(txid)) {
    const error = new Error('TXID Pix inválido.');
    error.code = 'EFI_PIX_TXID_INVALID';
    error.statusCode = 400;
    throw error;
  }
  return txid;
}

export async function createPixHomologationTestCharge(options = {}) {
  const environment = normalizeEnvironment(options.environment || 'homologation');
  if (environment !== 'homologation') {
    const error = new Error('Cobrança de teste permitida somente em Homologação.');
    error.code = 'EFI_HOMOLOGATION_ONLY';
    error.statusCode = 400;
    throw error;
  }

  const config = getEfiConfig(environment);
  if (!config.pixKey) {
    const error = new Error('Chave Pix Efí de Homologação não configurada.');
    error.code = 'EFI_PIX_KEY_MISSING';
    error.statusCode = 503;
    throw error;
  }

  const amount = Number(options.amount ?? 11);
  if (!Number.isFinite(amount) || amount <= 10 || amount > 1000) {
    const error = new Error('Para este teste, informe valor acima de R$ 10,00 e até R$ 1.000,00.');
    error.code = 'EFI_TEST_AMOUNT_INVALID';
    error.statusCode = 400;
    throw error;
  }

  const expiration = Math.max(60, Math.min(86400, Number(options.expiration || 3600)));
  const txid = crypto.randomBytes(16).toString('hex');
  const payload = {
    calendario: { expiracao: expiration },
    valor: { original: amount.toFixed(2) },
    chave: config.pixKey,
    solicitacaoPagador: String(options.description || 'Teste Split Pix Ariana Marketplace - Homologacao').slice(0, 140)
  };

  const response = await efiPixRequest({
    environment,
    method: 'put',
    path: '/v2/cob/' + txid,
    data: payload
  });

  return { ...response, txid, payload };
}


export async function createPixWebhookHomologationProbe(options = {}) {
  const environment = normalizeEnvironment(options.environment || 'homologation');
  if (environment !== 'homologation') {
    const error = new Error('Teste de webhook permitido somente em Homologação.');
    error.code = 'EFI_HOMOLOGATION_ONLY';
    error.statusCode = 400;
    throw error;
  }

  const config = getEfiConfig(environment);
  if (!config.pixKey) {
    const error = new Error('Chave Pix Efí de Homologação não configurada.');
    error.code = 'EFI_PIX_KEY_MISSING';
    error.statusCode = 503;
    throw error;
  }

  const amount = Number(options.amount ?? 1);
  if (!Number.isFinite(amount) || amount < 0.01 || amount > 10) {
    const error = new Error('Para o teste de webhook em Homologação, use valor entre R$ 0,01 e R$ 10,00.');
    error.code = 'EFI_WEBHOOK_PROBE_AMOUNT_INVALID';
    error.statusCode = 400;
    throw error;
  }

  const txid = crypto.randomBytes(16).toString('hex');
  const payload = {
    calendario: { expiracao: 3600 },
    valor: { original: amount.toFixed(2) },
    chave: config.pixKey,
    solicitacaoPagador: String(options.description || 'Teste Webhook Pix Ariana - Homologacao').slice(0, 140)
  };

  const response = await efiPixRequest({
    environment,
    method: 'put',
    path: '/v2/cob/' + txid,
    data: payload
  });

  return {
    ...response,
    txid,
    payload
  };
}

export async function linkPixChargeToSplit(options = {}) {
  const environment = normalizeEnvironment(options.environment || 'homologation');
  if (environment !== 'homologation') {
    const error = new Error('Vínculo de teste permitido somente em Homologação.');
    error.code = 'EFI_HOMOLOGATION_ONLY';
    error.statusCode = 400;
    throw error;
  }
  const txid = normalizeTxid(options.txid);
  const splitConfigId = normalizeSplitConfigId(options.splitConfigId);
  return efiPixRequest({
    environment,
    method: 'put',
    path: '/v2/gn/split/cob/' + txid + '/vinculo/' + splitConfigId
  });
}


export async function revisePixChargeAmount(options = {}) {
  const environment = normalizeEnvironment(options.environment || 'homologation');
  if (environment !== 'homologation') {
    const error = new Error('Revisão de teste permitida somente em Homologação.');
    error.code = 'EFI_HOMOLOGATION_ONLY';
    error.statusCode = 400;
    throw error;
  }
  const txid = normalizeTxid(options.txid);
  const amount = Number(options.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000) {
    const error = new Error('Valor inválido para revisão da cobrança Pix.');
    error.code = 'EFI_PIX_REVISE_AMOUNT_INVALID';
    error.statusCode = 400;
    throw error;
  }
  return efiPixRequest({
    environment,
    method: 'patch',
    path: '/v2/cob/' + txid,
    data: { valor: { original: amount.toFixed(2) } }
  });
}

export async function getPixSplitCharge(options = {}) {
  const environment = normalizeEnvironment(options.environment || 'homologation');
  if (environment !== 'homologation') {
    const error = new Error('Consulta de teste permitida somente em Homologação.');
    error.code = 'EFI_HOMOLOGATION_ONLY';
    error.statusCode = 400;
    throw error;
  }
  const txid = normalizeTxid(options.txid);
  return efiPixRequest({
    environment,
    method: 'get',
    path: '/v2/gn/split/cob/' + txid
  });
}

export async function runPixSplitHomologationTest(options = {}) {
  const splitConfigId = normalizeSplitConfigId(options.splitConfigId);
  const charge = await createPixHomologationTestCharge({
    environment: 'homologation',
    amount: options.amount ?? 11,
    expiration: options.expiration ?? 3600,
    description: options.description || 'Teste Split Pix Ariana Marketplace - Homologacao'
  });

  const chargeStatus = String(charge.data?.status || '').toUpperCase();
  if (chargeStatus !== 'ATIVA') {
    const error = new Error('A cobrança de Homologação não ficou ATIVA e não pode ser vinculada ao Split.');
    error.code = 'EFI_TEST_CHARGE_NOT_ACTIVE';
    error.statusCode = 409;
    error.providerData = { status: charge.data?.status || null, txid: charge.txid };
    throw error;
  }

  const link = await linkPixChargeToSplit({
    environment: 'homologation',
    txid: charge.txid,
    splitConfigId
  });

  const verification = await getPixSplitCharge({
    environment: 'homologation',
    txid: charge.txid
  });

  const data = verification.data || {};
  return {
    ok: true,
    environment: 'homologation',
    splitConfigId,
    charge: {
      httpStatus: charge.status,
      txid: charge.txid,
      status: charge.data?.status || null,
      amount: charge.data?.valor?.original || charge.payload?.valor?.original || null,
      expiration: charge.data?.calendario?.expiracao || charge.payload?.calendario?.expiracao || null,
      location: charge.data?.location || charge.data?.loc?.location || null,
      pixCopiaECola: charge.data?.pixCopiaECola || null
    },
    link: {
      httpStatus: link.status,
      linked: link.status === 204
    },
    verification: {
      httpStatus: verification.status,
      txid: data.txid || charge.txid,
      status: data.status || null,
      amount: data.valor?.original || null,
      config: data.config ? {
        id: data.config.id || splitConfigId,
        status: data.config.status || null,
        revisao: data.config.revisao ?? null,
        descricao: data.config.descricao || null,
        tipo: data.config.tipo || null
      } : { id: splitConfigId },
      splitDetected: Boolean(data.split || data.config)
    }
  };
}


export async function configurePixWebhook(options = {}) {
  const environment = normalizeEnvironment(options.environment || 'homologation');
  const config = getEfiConfig(environment);
  if (!config.pixKey) {
    const error = new Error('Chave Pix Efí não configurada.');
    error.code = 'EFI_PIX_KEY_MISSING';
    error.statusCode = 503;
    throw error;
  }
  const webhookUrl = String(options.webhookUrl || '').trim();
  if (!/^https:\/\/.+/i.test(webhookUrl)) {
    const error = new Error('URL HTTPS do webhook Efí é obrigatória.');
    error.code = 'EFI_WEBHOOK_URL_INVALID';
    error.statusCode = 400;
    throw error;
  }
  return efiPixRequest({
    environment,
    method: 'put',
    path: '/v2/webhook/' + encodeURIComponent(config.pixKey),
    data: { webhookUrl }
  });
}

export async function getPixWebhook(options = {}) {
  const environment = normalizeEnvironment(options.environment || 'homologation');
  const config = getEfiConfig(environment);
  if (!config.pixKey) {
    const error = new Error('Chave Pix Efí não configurada.');
    error.code = 'EFI_PIX_KEY_MISSING';
    error.statusCode = 503;
    throw error;
  }
  return efiPixRequest({
    environment,
    method: 'get',
    path: '/v2/webhook/' + encodeURIComponent(config.pixKey)
  });
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
