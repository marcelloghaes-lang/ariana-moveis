import fs from 'fs';
import path from 'path';

const ENV_ALIASES = {
  test: 'stage',
  sandbox: 'stage',
  homologation: 'stage',
  homolog: 'stage',
  stage: 'stage',
  production: 'production',
  prod: 'production'
};

function clean(value = '') {
  return String(value || '').trim();
}

function normalizeEnvironment(value = '') {
  return ENV_ALIASES[clean(value).toLowerCase()] || 'stage';
}

function defaultUrls(environment) {
  if (environment === 'production') {
    return {
      authUrl: 'https://matls-clients.api.cora.com.br/token',
      apiBaseUrl: 'https://matls-clients.api.cora.com.br'
    };
  }

  return {
    authUrl: 'https://matls-clients.api.stage.cora.com.br/token',
    apiBaseUrl: 'https://matls-clients.api.stage.cora.com.br'
  };
}

function readableFile(filePath = '') {
  const resolved = clean(filePath);
  if (!resolved) return false;
  try {
    fs.accessSync(resolved, fs.constants.R_OK);
    return fs.statSync(resolved).isFile();
  } catch (_error) {
    return false;
  }
}

export function getCoraConfig() {
  const environment = normalizeEnvironment(process.env.CORA_ENV || 'stage');
  const defaults = defaultUrls(environment);
  const certPath = clean(process.env.CORA_CERT_PATH);
  const keyPath = clean(process.env.CORA_KEY_PATH);

  return {
    environment,
    enabled: clean(process.env.CORA_ENABLED || 'false').toLowerCase() === 'true',
    clientId: clean(process.env.CORA_CLIENT_ID),
    certPath,
    keyPath,
    certName: certPath ? path.basename(certPath) : '',
    keyName: keyPath ? path.basename(keyPath) : '',
    authUrl: clean(process.env.CORA_AUTH_URL) || defaults.authUrl,
    apiBaseUrl: (clean(process.env.CORA_API_BASE_URL) || defaults.apiBaseUrl).replace(/\/+$/, ''),
    timeoutMs: Math.max(5000, Number(process.env.CORA_TIMEOUT_MS || 60000)),
    tokenSafetySeconds: Math.max(15, Number(process.env.CORA_TOKEN_SAFETY_SECONDS || 60)),
    certificateConfigured: readableFile(certPath),
    privateKeyConfigured: readableFile(keyPath),
    clientIdConfigured: Boolean(clean(process.env.CORA_CLIENT_ID))
  };
}

export function getCoraSafeStatus() {
  const cfg = getCoraConfig();
  return {
    enabled: cfg.enabled,
    environment: cfg.environment,
    clientIdConfigured: cfg.clientIdConfigured,
    certificateConfigured: cfg.certificateConfigured,
    privateKeyConfigured: cfg.privateKeyConfigured,
    certificateFile: cfg.certName || null,
    privateKeyFile: cfg.keyName || null,
    authHost: (() => {
      try { return new URL(cfg.authUrl).host; } catch (_error) { return null; }
    })(),
    apiHost: (() => {
      try { return new URL(cfg.apiBaseUrl).host; } catch (_error) { return null; }
    })(),
    timeoutMs: cfg.timeoutMs
  };
}

export function assertCoraConfigured() {
  const cfg = getCoraConfig();
  const missing = [];
  if (!cfg.enabled) missing.push('CORA_ENABLED=true');
  if (!cfg.clientIdConfigured) missing.push('CORA_CLIENT_ID');
  if (!cfg.certificateConfigured) missing.push('CORA_CERT_PATH (arquivo legível)');
  if (!cfg.privateKeyConfigured) missing.push('CORA_KEY_PATH (arquivo legível)');

  if (missing.length) {
    const error = new Error(`Integração Cora incompleta: ${missing.join(', ')}`);
    error.code = 'CORA_NOT_CONFIGURED';
    error.statusCode = 503;
    error.details = { missing };
    throw error;
  }

  return cfg;
}
