// ============================================================
// ENTERPRISE SHARED - PARTNER
// Utilitários de Portal, OAuth e sessões do fabricante.
// ============================================================

export function createEnterprisePartner(context = {}) {
  const {
    EnterpriseHomologationRequestCompat,
    enterpriseCompatEnvFromPartner,
    enterpriseCompatKeyQuery,
    enterpriseHashSecret,
    enterpriseSecretMatches,
    crypto,
    jwt,
    JWT_SECRET,
    sanitizeIdPart
  } = context;

  const enterpriseJwtSecret = String(process.env.ENTERPRISE_JWT_SECRET || JWT_SECRET || '').trim();
  const allowedStatus = ['sandbox', 'approved', 'production', 'active', 'homologated', 'homologado', 'aprovado', 'aprovada'];
  const defaultPermissions = ['catalog', 'stock', 'price', 'orders', 'invoice', 'tracking', 'webhooks'];

  function requireEnterpriseJwtSecret() {
    if (!enterpriseJwtSecret || enterpriseJwtSecret === 'ariana_enterprise_secret') {
      const err = new Error('Autenticação Enterprise indisponível: configure ENTERPRISE_JWT_SECRET ou JWT_SECRET seguro no ambiente.');
      err.statusCode = 503;
      throw err;
    }
    return enterpriseJwtSecret;
  }

  function enterprisePartnerStatusAllowed(partner = {}) {
    const status = String(partner.status || '').toLowerCase();
    return !status || allowedStatus.includes(status);
  }

  function enterpriseCredentialForEnvironment(partner = {}, environment = 'sandbox') {
    return environment === 'production'
      ? (partner.productionCredentials || partner.production || partner.credentials?.production || {})
      : (partner.sandboxCredentials || partner.sandbox || partner.credentials?.sandbox || {});
  }

  // Mantém compatibilidade com credenciais antigas nas quais active não existia.
  function enterpriseProductionActive(partner = {}) {
    const prod = enterpriseCredentialForEnvironment(partner, 'production');
    return prod.active !== false && (
      String(partner.environment || '').toLowerCase() === 'production' ||
      String(partner.status || '').toLowerCase() === 'production' ||
      partner.productionActive === true ||
      Boolean(partner.productionReleasedAt)
    );
  }

  function currentPartnerPermissions(partner = {}) {
    return Array.isArray(partner.integrationTypes) && partner.integrationTypes.length
      ? partner.integrationTypes.map((p) => String(p || '').toLowerCase()).filter(Boolean)
      : defaultPermissions;
  }

  function intersectPermissions(tokenPermissions = [], partner = {}) {
    const current = currentPartnerPermissions(partner);
    const token = Array.isArray(tokenPermissions)
      ? tokenPermissions.map((p) => String(p || '').toLowerCase()).filter(Boolean)
      : [];
    if (!token.length) return current;
    if (token.includes('*')) return current.includes('*') ? ['*'] : current;
    return token.filter((p) => current.includes(p));
  }

  function enterpriseCompatSafePartner(partner = {}, key = '') {
    const environment = enterpriseCompatEnvFromPartner(partner, key);
    const credential = enterpriseCredentialForEnvironment(partner, environment);
    return {
      id: String(partner._id || ''),
      requestId: String(partner.requestId || ''),
      companyName: String(partner.companyName || partner.razaoSocial || ''),
      tradeName: String(partner.tradeName || partner.nomeFantasia || partner.companyName || ''),
      cnpj: String(partner.cnpj || partner.document || ''),
      email: String(partner.email || partner.contactEmail || ''),
      status: String(partner.status || ''),
      statusLabel: String(partner.statusLabel || partner.status || ''),
      environment,
      permissions: currentPartnerPermissions(partner),
      credential: credential || {},
      createdAt: partner.createdAt || null,
      updatedAt: partner.updatedAt || null
    };
  }

  async function enterpriseCompatFindPartnerByKey(key = '') {
    key = String(key || '').trim();
    if (!key) return null;

    const legacySecret = String(process.env.ENTERPRISE_WEBHOOK_SECRET || '').trim();
    const allowLegacySecret = String(process.env.ENTERPRISE_ALLOW_LEGACY_GLOBAL_SECRET || 'false').toLowerCase() === 'true';
    if (allowLegacySecret && legacySecret && key === legacySecret) {
      return {
        id: 'legacy', requestId: 'legacy', companyName: 'Chave global Enterprise', tradeName: 'Chave global Enterprise',
        cnpj: '', email: '', status: 'active', statusLabel: 'Ativo', environment: 'legacy', permissions: ['*'],
        credential: { apiKey: key, active: true }
      };
    }

    const partner = await EnterpriseHomologationRequestCompat.findOne(enterpriseCompatKeyQuery(key)).lean();
    if (!partner) return null;

    const safe = enterpriseCompatSafePartner(partner, key);
    if (!enterprisePartnerStatusAllowed(partner)) {
      const err = new Error('Homologação ainda não liberada para acesso ao portal');
      err.statusCode = 403;
      err.partnerStatus = safe.status;
      throw err;
    }
    if (safe.credential && safe.credential.active === false) {
      const err = new Error('API Key desativada');
      err.statusCode = 403;
      throw err;
    }
    if (safe.environment === 'production' && !enterpriseProductionActive(partner)) {
      const err = new Error('Produção não está ativa para este parceiro');
      err.statusCode = 403;
      throw err;
    }
    return safe;
  }

  function enterprisePartnerSign(partner = {}) {
    return jwt.sign({
      role: 'enterprise_partner',
      partnerId: partner.id || '',
      requestId: partner.requestId || '',
      companyName: partner.companyName || '',
      tradeName: partner.tradeName || '',
      environment: partner.environment || 'sandbox',
      permissions: partner.permissions || []
    }, requireEnterpriseJwtSecret(), { expiresIn: '12h' });
  }

  function enterpriseOAuthGenerateCredentials(partner = {}, environment = 'sandbox') {
    const slug = sanitizeIdPart(partner.tradeName || partner.companyName || partner.requestId || 'partner').slice(0, 40);
    const env = environment === 'production' ? 'live' : 'sbx';
    return {
      clientId: `ari_${env}_client_${slug}_${crypto.randomBytes(5).toString('hex')}`,
      clientSecret: `ari_${env}_secret_${crypto.randomBytes(24).toString('hex')}`,
      environment,
      active: true,
      createdAt: new Date()
    };
  }

  function enterpriseOAuthQuery(clientId = '') {
    return {
      $or: [
        { 'oauth.sandbox.clientId': clientId },
        { 'oauth.production.clientId': clientId },
        { 'sandboxCredentials.oauth.clientId': clientId },
        { 'productionCredentials.oauth.clientId': clientId },
        { 'credentials.sandbox.oauth.clientId': clientId },
        { 'credentials.production.oauth.clientId': clientId },
        { oauthClientId: clientId },
        { oauthProductionClientId: clientId }
      ]
    };
  }

  function enterpriseOAuthPickCredential(partner = {}, clientId = '') {
    const candidates = [
      ['sandbox', partner.oauth?.sandbox],
      ['production', partner.oauth?.production],
      ['sandbox', partner.sandboxCredentials?.oauth],
      ['production', partner.productionCredentials?.oauth],
      ['sandbox', partner.credentials?.sandbox?.oauth],
      ['production', partner.credentials?.production?.oauth],
      ['sandbox', partner.oauthClientId ? {
        clientId: partner.oauthClientId,
        clientSecret: partner.oauthClientSecret || '',
        clientSecretHash: partner.oauthClientSecretHash || '',
        active: true,
        scopes: partner.integrationTypes || []
      } : null],
      ['production', partner.oauthProductionClientId ? {
        clientId: partner.oauthProductionClientId,
        clientSecret: partner.oauthProductionClientSecret || '',
        clientSecretHash: partner.oauthProductionClientSecretHash || '',
        active: true,
        scopes: partner.integrationTypes || []
      } : null]
    ];
    for (const [environment, credential] of candidates) {
      if (credential && credential.clientId === clientId) return { environment, credential };
    }
    return { environment: 'sandbox', credential: null };
  }

  function enterpriseOAuthSignAccessToken(partner = {}, environment = 'sandbox', scopes = [], clientId = '') {
    return jwt.sign({
      role: 'enterprise_oauth',
      partnerId: String(partner._id || ''),
      requestId: partner.requestId || '',
      companyName: partner.companyName || '',
      tradeName: partner.tradeName || '',
      environment,
      clientId: String(clientId || ''),
      scopes: Array.isArray(scopes) && scopes.length ? scopes : defaultPermissions
    }, requireEnterpriseJwtSecret(), { expiresIn: '1h' });
  }

  async function enterpriseOAuthRequired(req, res, next) {
    try {
      const header = String(req.headers.authorization || '').trim();
      const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
      if (!token) return res.status(401).json({ ok: false, error: 'Bearer Token ausente' });

      const decoded = jwt.verify(token, requireEnterpriseJwtSecret());
      if (!decoded || decoded.role !== 'enterprise_oauth') return res.status(403).json({ ok: false, error: 'Bearer Token inválido para Enterprise OAuth' });

      const partner = await EnterpriseHomologationRequestCompat.findById(decoded.partnerId).lean();
      if (!partner) return res.status(401).json({ ok: false, error: 'Parceiro OAuth não encontrado' });
      if (!enterprisePartnerStatusAllowed(partner)) return res.status(403).json({ ok: false, error: 'Parceiro suspenso ou não liberado', status: partner.status });

      const environment = String(decoded.environment || 'sandbox').toLowerCase() === 'production' ? 'production' : 'sandbox';
      const credential = enterpriseCredentialForEnvironment(partner, environment);
      const oauthCredential = partner.oauth?.[environment] || credential?.oauth || partner.credentials?.[environment]?.oauth || {};
      if (credential?.active === false || oauthCredential?.active === false) return res.status(403).json({ ok: false, error: 'Credencial OAuth desativada' });
      if (decoded.clientId && oauthCredential?.clientId && decoded.clientId !== oauthCredential.clientId) {
        return res.status(401).json({ ok: false, error: 'Bearer Token emitido por uma credencial OAuth antiga' });
      }
      if (environment === 'production' && !enterpriseProductionActive(partner)) return res.status(403).json({ ok: false, error: 'Produção não está ativa para este parceiro' });

      const permissions = intersectPermissions(decoded.scopes || [], partner);
      if (!permissions.length) return res.status(403).json({ ok: false, error: 'Bearer Token sem permissões válidas' });

      req.enterpriseOAuth = { ...decoded, scopes: permissions };
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
        credential: { oauth: true, active: true, clientId: oauthCredential?.clientId || decoded.clientId || '' },
        rateLimit: null
      };
      return next();
    } catch (error) {
      if (error?.statusCode === 503) return res.status(503).json({ ok: false, error: error.message });
      return res.status(401).json({ ok: false, error: 'Bearer Token expirado ou inválido' });
    }
  }

  async function enterprisePartnerRequired(req, res, next) {
    try {
      const header = String(req.headers.authorization || '').trim();
      const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
      if (!token) return res.status(401).json({ ok: false, error: 'Token do portal ausente' });

      const decoded = jwt.verify(token, requireEnterpriseJwtSecret());
      if (!decoded || decoded.role !== 'enterprise_partner') return res.status(403).json({ ok: false, error: 'Token do portal inválido' });

      const partner = decoded.partnerId
        ? await EnterpriseHomologationRequestCompat.findById(decoded.partnerId).lean().catch(() => null)
        : null;
      if (!partner) return res.status(401).json({ ok: false, error: 'Parceiro da sessão não encontrado' });
      if (!enterprisePartnerStatusAllowed(partner)) return res.status(403).json({ ok: false, error: 'Parceiro suspenso ou não liberado', status: partner.status });

      const environment = String(decoded.environment || 'sandbox').toLowerCase() === 'production' ? 'production' : 'sandbox';
      const credential = enterpriseCredentialForEnvironment(partner, environment);
      if (credential?.active === false) return res.status(403).json({ ok: false, error: 'Sessão vinculada a uma credencial desativada' });
      if (environment === 'production' && !enterpriseProductionActive(partner)) return res.status(403).json({ ok: false, error: 'Produção não está ativa para este parceiro' });

      const permissions = intersectPermissions(decoded.permissions || [], partner);
      if (!permissions.length) return res.status(403).json({ ok: false, error: 'Sessão sem permissões válidas' });

      req.enterprisePortal = {
        ...decoded,
        partnerId: String(partner._id || ''),
        requestId: partner.requestId || decoded.requestId || '',
        companyName: partner.companyName || decoded.companyName || '',
        tradeName: partner.tradeName || decoded.tradeName || '',
        environment,
        permissions
      };
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
        credential,
        rateLimit: null
      };
      return next();
    } catch (error) {
      if (error?.statusCode === 503) return res.status(503).json({ ok: false, error: error.message });
      return res.status(401).json({ ok: false, error: 'Sessão expirada ou inválida' });
    }
  }

  function enterprisePartnerLogQuery(partner = {}) {
    const keys = [partner.requestId, partner.companyName, partner.tradeName]
      .map((v) => String(v || '').trim())
      .filter(Boolean);
    if (!keys.length) keys.push('enterprise');
    return {
      scope: 'enterprise',
      $or: keys.flatMap((value) => [
        { manufacturer: value },
        { 'metadata.companyName': value },
        { 'metadata.tradeName': value }
      ])
    };
  }

  return {
    enterpriseCompatSafePartner,
    enterpriseCompatFindPartnerByKey,
    enterprisePartnerSign,
    enterpriseOAuthGenerateCredentials,
    enterpriseOAuthQuery,
    enterpriseOAuthPickCredential,
    enterpriseOAuthSignAccessToken,
    enterpriseOAuthRequired,
    enterprisePartnerRequired,
    enterprisePartnerLogQuery
  };
}
