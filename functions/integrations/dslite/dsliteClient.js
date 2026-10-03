// DSlite adapter base — branch isolada; não conectado ao server/produção.
// Credenciais nunca devem ser versionadas.

function envBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).trim().toLowerCase() === 'true';
}

export function getDsliteConfig(env = process.env) {
  return {
    enabled: envBool(env.DSLITE_ENABLED, false),
    syncEnabled: envBool(env.DSLITE_SYNC_ENABLED, false),
    apiBaseUrl: String(env.DSLITE_API_BASE_URL || '').trim().replace(/\/+$/, ''),
    token: String(env.DSLITE_TOKEN || '').trim(),
    catalogUrl: String(env.DSLITE_CATALOG_URL || '').trim()
  };
}

export function assertDsliteReadOnlyReady(config = getDsliteConfig()) {
  if (!config.enabled) throw new Error('DSlite desabilitado. DSLITE_ENABLED precisa estar true somente em ambiente autorizado.');
  if (!config.apiBaseUrl && !config.catalogUrl) {
    throw new Error('Informe DSLITE_API_BASE_URL ou DSLITE_CATALOG_URL.');
  }
  return config;
}

export function redactDsliteConfig(config = getDsliteConfig()) {
  return {
    enabled: config.enabled,
    syncEnabled: config.syncEnabled,
    apiBaseUrl: config.apiBaseUrl,
    catalogUrlConfigured: Boolean(config.catalogUrl),
    tokenConfigured: Boolean(config.token)
  };
}

// A autenticação e os endpoints concretos serão implementados após a liberação
// da chave/URL da conta Ariana e validação contra a documentação oficial.
// Isso evita assumir um formato de token incorreto e protege produção.
export default {
  getDsliteConfig,
  assertDsliteReadOnlyReady,
  redactDsliteConfig
};
