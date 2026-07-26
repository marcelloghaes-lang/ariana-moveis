// ============================================================
// ENTERPRISE SHARED - ROUTE HELPERS
// Helpers locais extraídos de enterpriseRoutes.js sem alterar
// endpoints, regras de negócio ou respostas.
// ============================================================

export function createEnterpriseRouteHelpers(context = {}) {
  const {
    EnterpriseHomologationRequestCompat,
    mongoose,
    crypto,
    sanitizeIdPart,
    escapeRegex
  } = context;

  function enterprisePartnerGenerateKey(environment = 'sandbox', partner = {}) {
    const env = String(environment || 'sandbox').toLowerCase() === 'production' ? 'live' : 'sbx';
    const baseName = sanitizeIdPart(partner.tradeName || partner.companyName || partner.requestId || 'fabricante').slice(0, 60);
    return `ari_${env}_${baseName}_${crypto.randomBytes(8).toString('hex')}`;
  }

  async function enterprisePartnerFindCurrentDoc(portal = {}) {
    if (portal.partnerId && mongoose.Types.ObjectId.isValid(portal.partnerId)) {
      const doc = await EnterpriseHomologationRequestCompat.findById(portal.partnerId);
      if (doc) return doc;
    }
    const or = [];
    if (portal.requestId) or.push({ requestId: portal.requestId });
    if (portal.companyName) or.push({ companyName: portal.companyName });
    if (portal.tradeName) or.push({ tradeName: portal.tradeName });
    if (!or.length) return null;
    return EnterpriseHomologationRequestCompat.findOne({ $or: or });
  }

  function enterprisePartnerEnvironmentPath(environment = 'sandbox') {
    return String(environment || '').toLowerCase() === 'production' ? 'productionCredentials' : 'sandboxCredentials';
  }

  function enterpriseAdminPartnerQuery(id = '') {
    const value = String(id || '').trim();
    const or = [];
    if (mongoose.Types.ObjectId.isValid(value)) or.push({ _id: new mongoose.Types.ObjectId(value) });
    if (value) {
      or.push(
        { requestId: value },
        { partnerRequestId: value },
        { partnerId: value },
        { apiKeySandbox: value },
        { sandboxApiKey: value },
        { apiKeyProduction: value },
        { enterpriseApiKey: value },
        { 'sandboxCredentials.apiKey': value },
        { 'productionCredentials.apiKey': value },
        { 'credentials.sandbox.apiKey': value },
        { 'credentials.production.apiKey': value }
      );
    }
    return or.length ? { $or: or } : { _id: null };
  }

  async function enterpriseAdminFindPartner(id = '') {
    return EnterpriseHomologationRequestCompat.findOne(enterpriseAdminPartnerQuery(id));
  }

  function enterpriseBuildProductManufacturerQuery(manufacturer = '') {
    const value = String(manufacturer || '').trim();
    if (!value) return {};
    const escaped = escapeRegex(value);
    return {
      $or: [
        { sellerId: value },
        { sellerId: new RegExp(`^${escaped}$`, 'i') },
        { brand: new RegExp(`^${escaped}$`, 'i') },
        { sellerName: new RegExp(escaped, 'i') },
        { manufacturer: new RegExp(escaped, 'i') }
      ]
    };
  }

  return {
    enterprisePartnerGenerateKey,
    enterprisePartnerFindCurrentDoc,
    enterprisePartnerEnvironmentPath,
    enterpriseAdminPartnerQuery,
    enterpriseAdminFindPartner,
    enterpriseBuildProductManufacturerQuery
  };
}
