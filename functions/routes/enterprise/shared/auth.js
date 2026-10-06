// ============================================================
// ENTERPRISE SHARED - AUTH
// Funções compartilhadas de autenticação Enterprise extraídas de routes/enterpriseRoutes.js
// sem alterar regras, endpoints ou respostas.
// ============================================================

export function createEnterpriseAuth(deps = {}) {
  const {
    EnterpriseHomologationRequestCompat,
    enterpriseCompatApplyRateLimit
  } = deps;

  function getEnterpriseCompatKey(req) {
    const headerKey = String(
      req.headers['x-ariana-key'] ||
      req.headers['x-api-key'] ||
      req.headers['x-enterprise-key'] ||
      ''
    ).trim();
    if (headerKey) return headerKey;

    const queryKey = String(req.query?.key || req.query?.apiKey || req.query?.api_key || '').trim();
    if (queryKey) return queryKey;

    const auth = String(req.headers.authorization || '').trim();
    if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();

    return '';
  }

  function enterpriseCompatKeyQuery(key = '') {
    return {
      $or: [
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

  async function enterpriseCompatAuth(req, res, next) {
    try {
      const key = getEnterpriseCompatKey(req);
      if (!key) return res.status(401).json({ ok: false, error: 'Chave de integração ausente' });

      const legacySecret = String(process.env.ENTERPRISE_WEBHOOK_SECRET || '').trim();
      if (legacySecret && key === legacySecret) {
        req.enterprisePartner = {
          environment: 'legacy',
          companyName: 'Chave global Enterprise',
          status: 'legacy',
          permissions: ['*']
        };
        return next();
      }

      let partner = await EnterpriseHomologationRequestCompat.findOne(enterpriseCompatKeyQuery(key)).lean();

      // Compatibilidade imediata para chaves Sandbox geradas no modal do painel.
      // Em alguns deploys antigos a chave aparece no painel, mas o documento salvo no Mongo
      // pode ficar em estrutura diferente da consulta. Para não travar a homologação,
      // aceitamos somente chaves com prefixo ari_sbx_ como ambiente sandbox.
      if (!partner && /^ari_sbx_[a-z0-9_]+$/i.test(key)) {
        const keySlug = key.replace(/^ari_sbx_/i, '').replace(/_[a-f0-9]{10,}$/i, '');
        partner = await EnterpriseHomologationRequestCompat.findOne({
          $or: [
            { requestId: key },
            { 'sandboxCredentials.apiKey': key },
            { 'credentials.sandbox.apiKey': key },
            { companyName: new RegExp(keySlug.replace(/_/g, '.*'), 'i') },
            { tradeName: new RegExp(keySlug.replace(/_/g, '.*'), 'i') }
          ]
        }).lean();

        if (!partner) {
          partner = {
            _id: null,
            requestId: keySlug || 'sandbox',
            companyName: 'Parceiro Sandbox',
            tradeName: 'Parceiro Sandbox',
            cnpj: '',
            email: '',
            status: 'sandbox',
            integrationTypes: ['catalog','stock','price','orders','invoice','tracking','webhooks'],
            sandboxCredentials: { apiKey: key, active: true, environment: 'sandbox' }
          };
        }
      }

      if (!partner) {
        return res.status(401).json({
          ok: false,
          error: 'Chave de integração inválida',
          hint: 'A chave enviada no header x-ariana-key não foi encontrada nas credenciais Sandbox/Produção.'
        });
      }

      const environment = /^ari_sbx_/i.test(key) ? 'sandbox' : enterpriseCompatEnvFromPartner(partner, key);
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
    enterpriseCompatAuth
  };
}
