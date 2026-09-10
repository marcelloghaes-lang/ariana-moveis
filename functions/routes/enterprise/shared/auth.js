import jwt from 'jsonwebtoken';

// ============================================================
// ENTERPRISE SHARED - AUTH
// Autenticação unificada: API Key, Portal JWT e OAuth Bearer.
// ============================================================

export function createEnterpriseAuth(deps = {}) {
  const {
    EnterpriseHomologationRequestCompat,
    enterpriseCompatApplyRateLimit,
    crypto
  } = deps;

  const enterpriseJwtSecret = String(process.env.ENTERPRISE_JWT_SECRET || process.env.JWT_SECRET || '').trim();
  const allowedStatus = ['sandbox', 'approved', 'production', 'active', 'homologated', 'homologado', 'aprovado', 'aprovada'];
  const defaultPermissions = ['catalog', 'stock', 'price', 'orders', 'invoice', 'tracking', 'webhooks'];

  function enterpriseHashSecret(value = '') {
    return crypto.createHash('sha256').update(String(value || '')).digest('hex');
  }

  function enterpriseSecretMatches(candidate = '', plain = '', hash = '') {
    const value = String(candidate || '');
    if (!value) return false;
    if (plain && value === String(plain)) return true;
    return Boolean(hash && enterpriseHashSecret(value) === String(hash));
  }

  // Headers próprios são a forma recomendada para API Key.
  function getEnterpriseCompatKey(req) {
    return String(
      req.headers['x-ariana-key'] ||
      req.headers['x-api-key'] ||
      req.headers['x-enterprise-key'] ||
      ''
    ).trim();
  }

  function getEnterpriseBearer(req) {
    const auth = String(req.headers.authorization || '').trim();
    return auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  }

  function enterpriseBearerLooksLikeJwt(token = '') {
    const parts = String(token || '').split('.');
    return parts.length === 3 && parts.every(Boolean);
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

  function enterpriseCredentialFor(partner = {}, environment = 'sandbox') {
    return environment === 'production'
      ? (partner.productionCredentials || partner.production || partner.credentials?.production || {})
      : (partner.sandboxCredentials || partner.sandbox || partner.credentials?.sandbox || {});
  }

  function enterprisePartnerStatusAllowed(partner = {}) {
    const status = String(partner.status || '').toLowerCase();
    return !status || allowedStatus.includes(status);
  }

  // Compatibilidade com parceiros antigos: active ausente significa ativo,
  // desde que o parceiro já esteja marcado como produção.
  function enterpriseProductionActive(partner = {}) {
    const prod = partner.productionCredentials || partner.production || partner.credentials?.production || {};
    return prod.active !== false && (
      String(partner.environment || '').toLowerCase() === 'production' ||
      String(partner.status || '').toLowerCase() === 'production' ||
      partner.productionActive === true ||
      Boolean(partner.productionReleasedAt)
    );
  }

  function enterprisePermissionsForToken(partner = {}, decoded = {}) {
    const current = Array.isArray(partner.integrationTypes) && partner.integrationTypes.length
      ? partner.integrationTypes.map((p) => String(p || '').toLowerCase()).filter(Boolean)
      : defaultPermissions;
    const tokenPermissions = decoded.role === 'enterprise_oauth'
      ? (Array.isArray(decoded.scopes) ? decoded.scopes : [])
      : (Array.isArray(decoded.permissions) ? decoded.permissions : []);
    const normalizedToken = tokenPermissions.map((p) => String(p || '').toLowerCase()).filter(Boolean);
    if (!normalizedToken.length) return current;
    if (normalizedToken.includes('*')) return current.includes('*') ? ['*'] : current;
    return normalizedToken.filter((p) => current.includes(p));
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

  async function enterpriseAuthenticateBearer(req, res, token) {
    if (!enterpriseJwtSecret || enterpriseJwtSecret === 'ariana_enterprise_secret') {
      res.status(503).json({ ok: false, error: 'Autenticação Enterprise temporariamente indisponível' });
      return false;
    }

    let decoded;
    try {
      decoded = jwt.verify(token, enterpriseJwtSecret);
    } catch (_error) {
      res.status(401).json({ ok: false, error: 'Bearer Token expirado ou inválido' });
      return false;
    }

    if (!decoded || !['enterprise_partner', 'enterprise_oauth'].includes(decoded.role)) {
      res.status(403).json({ ok: false, error: 'Bearer Token inválido para Ariana Enterprise' });
      return false;
    }

    const partner = decoded.partnerId
      ? await EnterpriseHomologationRequestCompat.findById(decoded.partnerId).lean().catch(() => null)
      : null;
    if (!partner) {
      res.status(401).json({ ok: false, error: 'Parceiro do Bearer Token não encontrado' });
      return false;
    }
    if (!enterprisePartnerStatusAllowed(partner)) {
      res.status(403).json({ ok: false, error: 'Parceiro suspenso ou não liberado', status: partner.status });
      return false;
    }

    const environment = String(decoded.environment || 'sandbox').toLowerCase() === 'production' ? 'production' : 'sandbox';
    const credential = enterpriseCredentialFor(partner, environment);
    if (credential?.active === false) {
      res.status(403).json({ ok: false, error: environment === 'production' ? 'Produção desativada para este parceiro' : 'Credencial Sandbox desativada' });
      return false;
    }
    if (environment === 'production' && !enterpriseProductionActive(partner)) {
      res.status(403).json({ ok: false, error: 'Produção não está ativa para este parceiro' });
      return false;
    }

    if (decoded.role === 'enterprise_oauth') {
      const oauthCredential = partner.oauth?.[environment] || credential?.oauth || partner.credentials?.[environment]?.oauth || {};
      if (oauthCredential?.active === false) {
        res.status(403).json({ ok: false, error: 'Credencial OAuth desativada' });
        return false;
      }
    }

    const permissions = enterprisePermissionsForToken(partner, decoded);
    if (!permissions.length) {
      res.status(403).json({ ok: false, error: 'Bearer Token sem permissões válidas para este parceiro' });
      return false;
    }

    // Rate limit por parceiro/ambiente, e não por JWT individual. Renovar um
    // token não permite contornar os limites de consumo.
    const rateIdentity = `bearer:${decoded.role}:${String(partner._id || '')}:${environment}`;
    const rateAllowed = await enterpriseCompatApplyRateLimit(req, res, partner, credential || {}, environment, rateIdentity);
    if (!rateAllowed) return false;

    req.enterprisePartner = {
      id: String(partner._id || ''),
      requestId: partner.requestId || '',
      companyName: partner.companyName || '',
      tradeName: partner.tradeName || '',
      cnpj: partner.cnpj || '',
      email: partner.email || '',
      environment,
      status: partner.status || '',
      permissions,
      credential: { ...(credential || {}), bearer: true, oauth: decoded.role === 'enterprise_oauth' },
      rateLimit: req.enterpriseRateLimit || null
    };
    if (decoded.role === 'enterprise_oauth') req.enterpriseOAuth = decoded;
    if (decoded.role === 'enterprise_partner') req.enterprisePortal = decoded;
    return true;
  }

  async function enterpriseCompatAuth(req, res, next) {
    try {
      const explicitKey = getEnterpriseCompatKey(req);
      const bearer = getEnterpriseBearer(req);

      // Compatibilidade: integrações antigas que mandam a API Key como
      // Authorization: Bearer continuam funcionando. JWT/OAuth é reconhecido
      // pelo formato de três segmentos e validado como token.
      const key = explicitKey || (bearer && !enterpriseBearerLooksLikeJwt(bearer) ? bearer : '');

      if (!key && bearer) {
        const ok = await enterpriseAuthenticateBearer(req, res, bearer);
        return ok ? next() : undefined;
      }
      if (!key) return res.status(401).json({ ok: false, error: 'Chave de integração ou Bearer Token ausente' });

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

      const partner = await EnterpriseHomologationRequestCompat.findOne(enterpriseCompatKeyQuery(key)).lean();
      if (!partner) {
        return res.status(401).json({
          ok: false,
          error: 'Chave de integração inválida',
          hint: 'A credencial enviada não foi encontrada nas credenciais Sandbox/Produção.'
        });
      }
      if (!enterprisePartnerStatusAllowed(partner)) {
        return res.status(403).json({ ok: false, error: 'Chave encontrada, mas a homologação ainda não está liberada para uso', status: partner.status });
      }

      const environment = enterpriseCompatEnvFromPartner(partner, key);
      const credential = enterpriseCredentialFor(partner, environment);
      if (credential?.active === false) return res.status(403).json({ ok: false, error: 'API Key desativada' });
      if (environment === 'production' && !enterpriseProductionActive(partner)) {
        return res.status(403).json({ ok: false, error: 'Produção não está ativa para este parceiro' });
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
        permissions: Array.isArray(partner.integrationTypes) && partner.integrationTypes.length ? partner.integrationTypes : defaultPermissions,
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
      return res.status(500).json({ ok: false, error: 'Erro ao validar credencial Enterprise' });
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
