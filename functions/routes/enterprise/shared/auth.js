// ============================================================
// ENTERPRISE SHARED - AUTH
// Funções compartilhadas de autenticação Enterprise extraídas de routes/enterpriseRoutes.js
// sem alterar regras, endpoints ou respostas.
// ============================================================

export function createEnterpriseAuth(deps = {}) {
  const {
    EnterpriseHomologationRequestCompat,
    enterpriseCompatApplyRateLimit,
    crypto
  } = deps;

  function enterpriseHashSecret(value = '') {
    return crypto.createHash('sha256').update(String(value || '')).digest('hex');
  }

  function enterpriseSecretMatches(candidate = '', plain = '', hash = '') {
    const value = String(candidate || '');
    if (!value) return false;
    if (plain && value === String(plain)) return true;
    return Boolean(hash && enterpriseHashSecret(value) === String(hash));
  }

  function getEnterpriseCompatKey(req) {
    const headerKey = String(
      req.headers['x-ariana-key'] ||
      req.headers['x-api-key'] ||
      req.headers['x-enterprise-key'] ||
      ''
    ).trim();
    if (headerKey) return headerKey;

    const auth = String(req.headers.authorization || '').trim();
    if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();

    return '';
  }

  function enterpriseCompatKeyQuery(key = '') {
    const keyHash = enterpriseHashSecret(key);
    return {
      $or: [
        { 'sandboxCredentials.apiKeyHash': keyHash },
        { 'productionCredentials.apiKeyHash': keyHash },
        { 'sandbox.apiKeyHash': keyHash },
        { 'production.apiKeyHash': keyHash },
        { 'credentials.sandbox.apiKeyHash': keyHash },
        { 'credentials.production.apiKeyHash': keyHash },
        { apiKeySandboxHash: keyHash },
        { apiKeyProductionHash: keyHash },
        // Compatibilidade temporária com credenciais legadas em texto puro.
        { 'sandboxCredentials.apiKey': key },
        { 'productionCredentials.apiKey': key },
        { 'sandbox.apiKey': key },
        { 'production.apiKey': key },
        { 'credentials.sandbox.apiKey': key },
        { 'credentials.production.apiKey': key },
        { 'metadata.sandboxCredentials.apiKey': key },
        { 'metadata.productionCredentials.apiKey': key },
        { apiKeySandbox: key },
        { sandboxApiKey: key },
        { enterpriseApiKey: key },
        { apiKey: key }
      ]
    };
  }

  function enterpriseCompatEnvFromPartner(partner = {}, key = '') {
    const keyHash = enterpriseHashSecret(key);
    const sandboxHashes = [
      partner?.sandboxCredentials?.apiKeyHash,
      partner?.sandbox?.apiKeyHash,
      partner?.credentials?.sandbox?.apiKeyHash,
      partner?.apiKeySandboxHash
    ].filter(Boolean);
    const productionHashes = [
      partner?.productionCredentials?.apiKeyHash,
      partner?.production?.apiKeyHash,
      partner?.credentials?.production?.apiKeyHash,
      partner?.apiKeyProductionHash
    ].filter(Boolean);

    if (sandboxHashes.includes(keyHash)) return 'sandbox';
    if (productionHashes.includes(keyHash)) return 'production';

    if (partner?.sandboxCredentials?.apiKey === key) return 'sandbox';
    if (partner?.sandbox?.apiKey === key) return 'sandbox';
    if (partner?.credentials?.sandbox?.apiKey === key) return 'sandbox';
    if (partner?.metadata?.sandboxCredentials?.apiKey === key) return 'sandbox';
    if (partner?.apiKeySandbox === key || partner?.sandboxApiKey === key) return 'sandbox';

    if (partner?.productionCredentials?.apiKey === key) return 'production';
    if (partner?.production?.apiKey === key) return 'production';
    if (partner?.credentials?.production?.apiKey === key) return 'production';
    if (partner?.metadata?.productionCredentials?.apiKey === key) return 'production';

    if (partner?.enterpriseApiKey === key || partner?.apiKey === key) return String(partner.environment || 'sandbox');
    return 'sandbox';
  }

  async function enterpriseMigrateLegacyApiKey(partner = {}, environment = 'sandbox', key = '') {
    if (!partner?._id || !key) return;
    const env = environment === 'production' ? 'production' : 'sandbox';
    const hash = enterpriseHashSecret(key);
    const last4 = String(key).slice(-4);
    const set = env === 'production' ? {
      'productionCredentials.apiKeyHash': hash,
      'productionCredentials.apiKeyLast4': last4,
      'production.apiKeyHash': hash,
      'credentials.production.apiKeyHash': hash,
      apiKeyProductionHash: hash
    } : {
      'sandboxCredentials.apiKeyHash': hash,
      'sandboxCredentials.apiKeyLast4': last4,
      'sandbox.apiKeyHash': hash,
      'credentials.sandbox.apiKeyHash': hash,
      apiKeySandboxHash: hash
    };
    const unset = env === 'production' ? {
      'productionCredentials.apiKey': '',
      'production.apiKey': '',
      'credentials.production.apiKey': '',
      apiKeyProduction: '',
      enterpriseApiKey: '',
      apiKey: ''
    } : {
      'sandboxCredentials.apiKey': '',
      'sandbox.apiKey': '',
      'credentials.sandbox.apiKey': '',
      apiKeySandbox: '',
      sandboxApiKey: ''
    };
    await EnterpriseHomologationRequestCompat.updateOne({ _id: partner._id }, { $set: set, $unset: unset }).catch(() => null);
  }

  async function enterpriseCompatAuth(req, res, next) {
    try {
      const key = getEnterpriseCompatKey(req);
      if (!key) return res.status(401).json({ ok: false, error: 'Chave de integração ausente' });

      const legacySecret = String(process.env.ENTERPRISE_WEBHOOK_SECRET || '').trim();
      const allowLegacySecret = String(process.env.ENTERPRISE_ALLOW_LEGACY_GLOBAL_SECRET || 'false').toLowerCase() === 'true';
      if (allowLegacySecret && legacySecret && key === legacySecret) {
        req.enterprisePartner = {
          environment: 'legacy',
          companyName: 'Chave global Enterprise',
          status: 'legacy',
          permissions: ['*']
        };
        return next();
      }

      let partner = await EnterpriseHomologationRequestCompat.findOne(enterpriseCompatKeyQuery(key)).lean();

      // Segurança: somente credenciais realmente persistidas no banco são aceitas.
      // Prefixos como ari_sbx_ identificam o ambiente, mas nunca autenticam sozinhos.

      if (!partner) {
        return res.status(401).json({
          ok: false,
          error: 'Chave de integração inválida',
          hint: 'A chave enviada no header x-ariana-key não foi encontrada nas credenciais Sandbox/Produção.'
        });
      }

      const environment = enterpriseCompatEnvFromPartner(partner, key);
      const status = String(partner.status || '').toLowerCase();

      const allowedStatus = ['sandbox', 'approved', 'production', 'active', 'homologated', 'homologado', 'aprovado', 'aprovada'];
      if (status && !allowedStatus.includes(status)) {
        return res.status(403).json({
          ok: false,
          error: 'Chave encontrada, mas a homologação ainda não está liberada para uso',
          status: partner.status
        });
      }

      const credential = environment === 'production'
        ? (partner.productionCredentials || partner.production || partner.credentials?.production || {})
        : (partner.sandboxCredentials || partner.sandbox || partner.credentials?.sandbox || {});

      if (credential && credential.active === false) {
        return res.status(403).json({ ok: false, error: 'API Key desativada' });
      }

      const rateAllowed = await enterpriseCompatApplyRateLimit(req, res, partner, credential, environment, key);
      if (!rateAllowed) return;

      const hasHash = environment === 'production'
        ? Boolean(partner.productionCredentials?.apiKeyHash || partner.production?.apiKeyHash || partner.credentials?.production?.apiKeyHash || partner.apiKeyProductionHash)
        : Boolean(partner.sandboxCredentials?.apiKeyHash || partner.sandbox?.apiKeyHash || partner.credentials?.sandbox?.apiKeyHash || partner.apiKeySandboxHash);
      if (!hasHash) await enterpriseMigrateLegacyApiKey(partner, environment, key);

      req.enterprisePartner = {
        id: String(partner._id || ''),
        requestId: partner.requestId || '',
        companyName: partner.companyName || '',
        tradeName: partner.tradeName || '',
        cnpj: partner.cnpj || '',
        email: partner.email || '',
        environment,
        status: partner.status || '',
        permissions: partner.integrationTypes || [],
        credential,
        rateLimit: req.enterpriseRateLimit || null
      };

      try {
        const prefix = environment === 'production' ? 'productionCredentials' : 'sandboxCredentials';
        await EnterpriseHomologationRequestCompat.updateOne(
          { _id: partner._id },
          {
            $set: {
              [`${prefix}.lastAccessAt`]: new Date(),
              [`${prefix}.lastAccessPath`]: req.originalUrl || req.url || '',
              [`${prefix}.lastAccessMethod`]: req.method || ''
            },
            $inc: { [`${prefix}.requestCount`]: 1 }
          }
        );
      } catch (_touchError) {}

      return next();
    } catch (error) {
      console.error('[enterpriseCompatAuth] erro:', error.message || error);
      return res.status(500).json({ ok: false, error: 'Erro ao validar chave Enterprise' });
    }
  }

  return {
    getEnterpriseCompatKey,
    enterpriseCompatKeyQuery,
    enterpriseCompatEnvFromPartner,
    enterpriseHashSecret,
    enterpriseSecretMatches,
    enterpriseCompatAuth
  };
}
