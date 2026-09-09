// ============================================================
// ENTERPRISE SHARED - PARTNER
// Utilitários do Portal/Fabricante Enterprise extraídos de routes/enterpriseRoutes.js
// sem alterar endpoints, regras ou respostas.
// ============================================================

export function createEnterprisePartner(context = {}) {
  const {
    EnterpriseHomologationRequestCompat,
    enterpriseCompatEnvFromPartner,
    enterpriseCompatKeyQuery,
    crypto,
    jwt,
    JWT_SECRET,
    sanitizeIdPart
  } = context;

  const enterpriseJwtSecret = String(process.env.ENTERPRISE_JWT_SECRET || JWT_SECRET || '').trim();

  function requireEnterpriseJwtSecret() {
    if (!enterpriseJwtSecret || enterpriseJwtSecret === 'ariana_enterprise_secret') {
      const err = new Error('Autenticação Enterprise indisponível: configure ENTERPRISE_JWT_SECRET ou JWT_SECRET seguro no ambiente.');
      err.statusCode = 503;
      throw err;
    }
    return enterpriseJwtSecret;
  }

// ============================================================
// PASSO 18 REFEITO - Gestão real de API Keys com persistência compatível Sandbox/Produção
// PORTAL DO FABRICANTE - ARIANA ENTERPRISE
// Login por API Key Sandbox/Produção e área exclusiva do parceiro.
// Mantém o Admin e o marketplace intactos.
// ============================================================
function enterpriseCompatSafePartner(partner = {}, key = '') {
  const environment = enterpriseCompatEnvFromPartner(partner, key);
  const credential = environment === 'production'
    ? (partner.productionCredentials || partner.production || partner.credentials?.production || {})
    : (partner.sandboxCredentials || partner.sandbox || partner.credentials?.sandbox || {});

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
    permissions: Array.isArray(partner.integrationTypes) && partner.integrationTypes.length
      ? partner.integrationTypes
      : ['catalog', 'stock', 'price', 'orders', 'invoice', 'tracking', 'webhooks'],
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
      id: 'legacy',
      requestId: 'legacy',
      companyName: 'Chave global Enterprise',
      tradeName: 'Chave global Enterprise',
      cnpj: '',
      email: '',
      status: 'active',
      statusLabel: 'Ativo',
      environment: 'legacy',
      permissions: ['*'],
      credential: { apiKey: key, active: true }
    };
  }

  let partner = await EnterpriseHomologationRequestCompat.findOne(enterpriseCompatKeyQuery(key)).lean();

  // Segurança: o Portal só aceita API Keys realmente persistidas no banco.
  // Prefixos Sandbox identificam o formato da chave, mas nunca criam parceiros automaticamente.

  if (!partner) return null;

  const safe = enterpriseCompatSafePartner(partner, key);
  const status = String(safe.status || '').toLowerCase();
  const allowedStatus = ['sandbox', 'approved', 'production', 'active', 'homologated', 'homologado', 'aprovado', 'aprovada'];
  if (status && !allowedStatus.includes(status)) {
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

  return safe;
}

function enterprisePartnerSign(partner = {}) {
  const jwtSecret = requireEnterpriseJwtSecret();
  return jwt.sign({
    role: 'enterprise_partner',
    partnerId: partner.id || '',
    requestId: partner.requestId || '',
    companyName: partner.companyName || '',
    tradeName: partner.tradeName || '',
    environment: partner.environment || 'sandbox',
    permissions: partner.permissions || []
  }, jwtSecret, { expiresIn: '12h' });
}


// ============================================================
// PASSO 27 - OAuth 2.0 Client Credentials para Ariana Enterprise
// Permite que fabricantes usem client_id/client_secret para obter
// Bearer Token temporário, além da API Key tradicional.
// ============================================================
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

function enterpriseOAuthQuery(clientId = '', clientSecret = '') {
  const or = [
    { 'oauth.sandbox.clientId': clientId },
    { 'oauth.production.clientId': clientId },
    { 'sandboxCredentials.oauth.clientId': clientId },
    { 'productionCredentials.oauth.clientId': clientId },
    { 'credentials.sandbox.oauth.clientId': clientId },
    { 'credentials.production.oauth.clientId': clientId }
  ];
  if (clientSecret) {
    return { $or: or, $and: [{ $or: [
      { 'oauth.sandbox.clientSecret': clientSecret },
      { 'oauth.production.clientSecret': clientSecret },
      { 'sandboxCredentials.oauth.clientSecret': clientSecret },
      { 'productionCredentials.oauth.clientSecret': clientSecret },
      { 'credentials.sandbox.oauth.clientSecret': clientSecret },
      { 'credentials.production.oauth.clientSecret': clientSecret }
    ] }] };
  }
  return { $or: or };
}

function enterpriseOAuthPickCredential(partner = {}, clientId = '') {
  const candidates = [
    ['sandbox', partner.oauth?.sandbox],
    ['production', partner.oauth?.production],
    ['sandbox', partner.sandboxCredentials?.oauth],
    ['production', partner.productionCredentials?.oauth],
    ['sandbox', partner.credentials?.sandbox?.oauth],
    ['production', partner.credentials?.production?.oauth]
  ];
  for (const [environment, credential] of candidates) {
    if (credential && credential.clientId === clientId) return { environment, credential };
  }
  return { environment: 'sandbox', credential: null };
}

function enterpriseOAuthSignAccessToken(partner = {}, environment = 'sandbox', scopes = []) {
  const jwtSecret = requireEnterpriseJwtSecret();
  return jwt.sign({
    role: 'enterprise_oauth',
    partnerId: String(partner._id || ''),
    requestId: partner.requestId || '',
    companyName: partner.companyName || '',
    tradeName: partner.tradeName || '',
    environment,
    scopes: Array.isArray(scopes) && scopes.length ? scopes : ['catalog', 'stock', 'price', 'orders', 'invoice', 'tracking', 'webhooks']
  }, jwtSecret, { expiresIn: '1h' });
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
    req.enterpriseOAuth = decoded;
    req.enterprisePartner = {
      id: String(partner._id || ''),
      requestId: partner.requestId || '',
      companyName: partner.companyName || '',
      tradeName: partner.tradeName || '',
      cnpj: partner.cnpj || '',
      email: partner.email || '',
      environment: decoded.environment || 'sandbox',
      status: partner.status || '',
      permissions: decoded.scopes || [],
      credential: { oauth: true, active: true },
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
    if (!decoded || decoded.role !== 'enterprise_partner') {
      return res.status(403).json({ ok: false, error: 'Token do portal inválido' });
    }

    req.enterprisePortal = decoded;
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
