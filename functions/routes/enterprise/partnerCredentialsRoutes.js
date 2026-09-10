// ============================================================
// ROTAS ENTERPRISE - PARTNER CREDENTIALS
// Extraído de routes/enterpriseRoutes.js sem alterar endpoints, regras ou respostas.
// ============================================================

export default function registerEnterprisePartnerCredentialsRoutes(app, context = {}) {
  const {
    EnterpriseHomologationRequestCompat,
    IntegrationAuditLog,
    adminRequired,
    enterpriseAdminFindPartner,
    enterprisePartnerGenerateKey,
    enterprisePartnerEnvironmentPath,
    enterprisePartnerFindCurrentDoc,
    enterprisePartnerRequired,
    enterpriseCreateOAuthId,
    enterpriseRandomKey,
    enterpriseCreateWebhookSecret,
    enterpriseHashSecret
  } = context;


function enterpriseAdminCredentialDTO(partner = {}) {
  const maskLast4 = (prefix, last4) => last4 ? `${prefix}••••••••${last4}` : '';
  const sandboxApiKey = partner?.sandboxCredentials?.apiKey || partner?.credentials?.sandbox?.apiKey || partner?.sandbox?.apiKey || partner?.apiKeySandbox || partner?.sandboxApiKey || '';
  const productionApiKey = partner?.productionCredentials?.apiKey || partner?.credentials?.production?.apiKey || partner?.production?.apiKey || partner?.apiKeyProduction || partner?.enterpriseApiKey || partner?.apiKey || '';
  const sandboxLast4 = partner?.sandboxCredentials?.apiKeyLast4 || partner?.credentials?.sandbox?.apiKeyLast4 || partner?.sandbox?.apiKeyLast4 || (sandboxApiKey ? sandboxApiKey.slice(-4) : '');
  const productionLast4 = partner?.productionCredentials?.apiKeyLast4 || partner?.credentials?.production?.apiKeyLast4 || partner?.production?.apiKeyLast4 || (productionApiKey ? productionApiKey.slice(-4) : '');
  const oauthSandbox = partner?.oauth?.sandbox || partner?.sandboxCredentials?.oauth || partner?.credentials?.sandbox?.oauth || {};
  const oauthProduction = partner?.oauth?.production || partner?.productionCredentials?.oauth || partner?.credentials?.production?.oauth || {};
  const webhookSecret = partner?.webhookSecret || partner?.sandboxCredentials?.webhookSecret || partner?.credentials?.sandbox?.webhookSecret || '';
  const signingSecret = partner?.signingSecret || partner?.sandboxCredentials?.signingSecret || partner?.credentials?.sandbox?.signingSecret || '';

  return {
    partnerId: String(partner?.partnerRequestId || partner?.partnerId || partner?.requestId || partner?._id || ''),
    requestId: String(partner?.requestId || ''),
    mongoId: String(partner?._id || ''),
    companyName: String(partner?.companyName || ''),
    tradeName: String(partner?.tradeName || ''),
    status: String(partner?.status || ''),
    environment: String(partner?.environment || 'sandbox'),
    sandbox: {
      apiKeyMasked: maskLast4('ari_sbx_', sandboxLast4),
      configured: Boolean(partner?.sandboxCredentials?.apiKeyHash || partner?.credentials?.sandbox?.apiKeyHash || sandboxApiKey),
      active: partner?.sandboxCredentials?.active !== false,
      environment: 'sandbox',
      createdAt: partner?.sandboxCredentials?.createdAt || partner?.createdAt || null,
      rotatedAt: partner?.sandboxCredentials?.rotatedAt || partner?.sandbox?.rotatedAt || null
    },
    production: {
      apiKeyMasked: maskLast4('ari_live_', productionLast4),
      configured: Boolean(partner?.productionCredentials?.apiKeyHash || partner?.credentials?.production?.apiKeyHash || productionApiKey),
      active: partner?.productionCredentials?.active === true || partner?.production?.active === true || partner?.credentials?.production?.active === true,
      environment: 'production',
      createdAt: partner?.productionCredentials?.createdAt || partner?.createdAt || null,
      rotatedAt: partner?.productionCredentials?.rotatedAt || partner?.production?.rotatedAt || null
    },
    oauth: {
      sandbox: {
        clientId: oauthSandbox?.clientId || partner?.oauthClientId || '',
        clientSecretConfigured: Boolean(oauthSandbox?.clientSecretHash || oauthSandbox?.clientSecret || partner?.oauthClientSecret),
        active: oauthSandbox?.active !== false,
        environment: 'sandbox',
        createdAt: oauthSandbox?.createdAt || null,
        rotatedAt: oauthSandbox?.rotatedAt || null
      },
      production: {
        clientId: oauthProduction?.clientId || '',
        clientSecretConfigured: Boolean(oauthProduction?.clientSecretHash || oauthProduction?.clientSecret),
        active: oauthProduction?.active === true,
        environment: 'production',
        createdAt: oauthProduction?.createdAt || null,
        rotatedAt: oauthProduction?.rotatedAt || null
      }
    },
    webhook: {
      configured: Boolean(webhookSecret || signingSecret),
      active: true,
      rotatedAt: partner?.webhookRotatedAt || partner?.signingRotatedAt || null
    }
  };
}

app.get('/api/enterprise/partners/:id/credentials', adminRequired, async (req, res) => {
  try {
    const partner = await enterpriseAdminFindPartner(req.params.id);
    if (!partner) return res.status(404).json({ ok: false, error: 'Parceiro Enterprise não encontrado' });
    return res.json({ ok: true, credentials: enterpriseAdminCredentialDTO(partner) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar credenciais Enterprise' });
  }
});
app.post('/api/enterprise/partners/:id/regenerate-api-key', adminRequired, async (req, res) => {
  try {
    const environment = String(req.body?.environment || req.query.environment || 'sandbox').toLowerCase() === 'production' ? 'production' : 'sandbox';
    const partner = await enterpriseAdminFindPartner(req.params.id);
    if (!partner) return res.status(404).json({ ok: false, error: 'Parceiro Enterprise não encontrado' });

    const apiKey = environment === 'production'
      ? enterprisePartnerGenerateKey('production', partner)
      : enterprisePartnerGenerateKey('sandbox', partner);
    const path = enterprisePartnerEnvironmentPath(environment);
    const apiKeyHash = enterpriseHashSecret(apiKey);
    const apiKeyLast4 = apiKey.slice(-4);
    const setPayload = {
      [`${path}.apiKeyHash`]: apiKeyHash,
      [`${path}.apiKeyLast4`]: apiKeyLast4,
      [`${path}.active`]: true,
      [`${path}.environment`]: environment,
      [`${path}.rotatedAt`]: new Date(),
      [`${path}.lastAccessAt`]: null,
      [`${path}.requestCount`]: 0
    };

    if (environment === 'sandbox') {
      Object.assign(setPayload, {
        'sandbox.apiKeyHash': apiKeyHash,
        'sandbox.apiKeyLast4': apiKeyLast4,
        'sandbox.active': true,
        'sandbox.environment': 'sandbox',
        'credentials.sandbox.apiKeyHash': apiKeyHash,
        'credentials.sandbox.apiKeyLast4': apiKeyLast4,
        'credentials.sandbox.active': true,
        'credentials.sandbox.environment': 'sandbox',
        apiKeySandboxHash: apiKeyHash
      });
    } else {
      Object.assign(setPayload, {
        'production.apiKeyHash': apiKeyHash,
        'production.apiKeyLast4': apiKeyLast4,
        'production.active': true,
        'production.environment': 'production',
        'credentials.production.apiKeyHash': apiKeyHash,
        'credentials.production.apiKeyLast4': apiKeyLast4,
        'credentials.production.active': true,
        'credentials.production.environment': 'production',
        apiKeyProductionHash: apiKeyHash
      });
    }

    const updated = await EnterpriseHomologationRequestCompat.findByIdAndUpdate(
      partner._id,
      {
        $set: setPayload,
        $unset: environment === 'sandbox'
          ? { [`${path}.apiKey`]: '', 'sandbox.apiKey': '', 'credentials.sandbox.apiKey': '', apiKeySandbox: '', sandboxApiKey: '' }
          : { [`${path}.apiKey`]: '', 'production.apiKey': '', 'credentials.production.apiKey': '', apiKeyProduction: '', enterpriseApiKey: '', apiKey: '' },
        $push: { history: { status: 'api_key_regenerated', environment, at: new Date(), by: req.admin?.email || req.admin?.id || 'admin', source: 'admin_credentials' } }
      },
      { new: true }
    );

    await IntegrationAuditLog.create({
      scope: 'enterprise',
      eventType: 'admin_api_key_regenerated',
      manufacturer: partner.requestId || partner.tradeName || partner.companyName || '',
      status: 'success',
      statusCode: 200,
      message: `API Key ${environment} regenerada pelo Admin`,
      metadata: { environment, partnerId: String(partner._id), companyName: partner.companyName || '', tradeName: partner.tradeName || '' }
    }).catch(() => null);

    return res.json({ ok: true, environment, apiKey, credentials: enterpriseAdminCredentialDTO(updated) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao regenerar API Key Enterprise' });
  }
});
app.post('/api/enterprise/partners/:id/regenerate-oauth', adminRequired, async (req, res) => {
  try {
    const environment = String(req.body?.environment || req.query.environment || 'sandbox').toLowerCase() === 'production' ? 'production' : 'sandbox';
    const partner = await enterpriseAdminFindPartner(req.params.id);
    if (!partner) return res.status(404).json({ ok: false, error: 'Parceiro Enterprise não encontrado' });

    const clientSecret = enterpriseRandomKey(24);
    const oauth = {
      clientId: enterpriseCreateOAuthId(),
      clientSecretHash: enterpriseHashSecret(clientSecret),
      clientSecretLast4: clientSecret.slice(-4),
      active: true,
      environment,
      rotatedAt: new Date(),
      createdAt: new Date()
    };

    const setPayload = environment === 'sandbox'
      ? {
          'oauth.sandbox': oauth,
          'sandboxCredentials.oauth': oauth,
          'credentials.sandbox.oauth': oauth,
          oauthClientId: oauth.clientId,
          oauthClientSecretHash: oauth.clientSecretHash
        }
      : {
          'oauth.production': oauth,
          'productionCredentials.oauth': oauth,
          'credentials.production.oauth': oauth,
          oauthProductionClientId: oauth.clientId,
          oauthProductionClientSecretHash: oauth.clientSecretHash
        };

    const updated = await EnterpriseHomologationRequestCompat.findByIdAndUpdate(
      partner._id,
      {
        $set: setPayload,
        $unset: environment === 'sandbox'
          ? {
              'oauth.sandbox.clientSecret': '',
              'sandboxCredentials.oauth.clientSecret': '',
              'credentials.sandbox.oauth.clientSecret': '',
              oauthClientSecret: ''
            }
          : {
              'oauth.production.clientSecret': '',
              'productionCredentials.oauth.clientSecret': '',
              'credentials.production.oauth.clientSecret': '',
              oauthProductionClientSecret: ''
            },
        $push: { history: { status: 'oauth_regenerated', environment, at: new Date(), by: req.admin?.email || req.admin?.id || 'admin', source: 'admin_credentials' } }
      },
      { new: true }
    );

    await IntegrationAuditLog.create({
      scope: 'enterprise',
      eventType: 'admin_oauth_regenerated',
      manufacturer: partner.requestId || partner.tradeName || partner.companyName || '',
      status: 'success',
      statusCode: 200,
      message: `OAuth ${environment} regenerado pelo Admin`,
      metadata: { environment, partnerId: String(partner._id), clientId: oauth.clientId }
    }).catch(() => null);

    return res.json({ ok: true, environment, oauth: { ...oauth, clientSecret: undefined }, oneTimeClientSecret: clientSecret, credentials: enterpriseAdminCredentialDTO(updated) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao regenerar OAuth Enterprise' });
  }
});
app.post('/api/enterprise/partners/:id/regenerate-webhook', adminRequired, async (req, res) => {
  try {
    const partner = await enterpriseAdminFindPartner(req.params.id);
    if (!partner) return res.status(404).json({ ok: false, error: 'Parceiro Enterprise não encontrado' });

    const webhookSecret = enterpriseCreateWebhookSecret();
    const signingSecret = enterpriseRandomKey(24);
    const setPayload = {
      webhookSecret,
      signingSecret,
      webhookRotatedAt: new Date(),
      signingRotatedAt: new Date(),
      'sandboxCredentials.webhookSecret': webhookSecret,
      'sandboxCredentials.signingSecret': signingSecret,
      'credentials.sandbox.webhookSecret': webhookSecret,
      'credentials.sandbox.signingSecret': signingSecret,
      'webhook.secret': webhookSecret,
      'webhook.signingSecret': signingSecret,
      'webhook.active': true
    };

    const updated = await EnterpriseHomologationRequestCompat.findByIdAndUpdate(
      partner._id,
      { $set: setPayload, $push: { history: { status: 'webhook_regenerated', at: new Date(), by: req.admin?.email || req.admin?.id || 'admin', source: 'admin_credentials' } } },
      { new: true }
    );

    await IntegrationAuditLog.create({
      scope: 'enterprise',
      eventType: 'admin_webhook_regenerated',
      manufacturer: partner.requestId || partner.tradeName || partner.companyName || '',
      status: 'success',
      statusCode: 200,
      message: 'Webhook Secret regenerado pelo Admin',
      metadata: { partnerId: String(partner._id), companyName: partner.companyName || '', tradeName: partner.tradeName || '' }
    }).catch(() => null);

    return res.json({ ok: true, webhook: { webhookSecret, signingSecret }, credentials: enterpriseAdminCredentialDTO(updated) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao regenerar Webhook Enterprise' });
  }
});
app.post('/api/enterprise/partner/api-keys/:environment/rotate', enterprisePartnerRequired, async (req, res) => {
  try {
    const environment = String(req.params.environment || 'sandbox').toLowerCase() === 'production' ? 'production' : 'sandbox';
    const partner = await enterprisePartnerFindCurrentDoc(req.enterprisePortal || {});
    if (!partner) return res.status(404).json({ ok: false, error: 'Fabricante não encontrado' });

    if (environment === 'production') {
      const status = String(partner.status || '').toLowerCase();
      const allowedProduction = ['production', 'active', 'aprovado', 'aprovada'];
      if (!allowedProduction.includes(status)) {
        return res.status(403).json({ ok: false, error: 'Produção ainda não liberada para este fabricante' });
      }
    }

    const key = enterprisePartnerGenerateKey(environment, partner);
    const keyHash = enterpriseHashSecret(key);
    const keyLast4 = key.slice(-4);
    const path = enterprisePartnerEnvironmentPath(environment);
    await EnterpriseHomologationRequestCompat.updateOne(
      { _id: partner._id },
      {
        $set: {
          [`${path}.apiKeyHash`]: keyHash,
          [`${path}.apiKeyLast4`]: keyLast4,
          [`${path}.active`]: true,
          [`${path}.environment`]: environment,
          [`${path}.rotatedAt`]: new Date(),
          [`${path}.lastAccessAt`]: null,
          [`${path}.requestCount`]: 0,
          ...(environment === 'sandbox' ? {
            'sandbox.apiKeyHash': keyHash,
            'sandbox.apiKeyLast4': keyLast4,
            'sandbox.active': true,
            'sandbox.environment': 'sandbox',
            'credentials.sandbox.apiKeyHash': keyHash,
            'credentials.sandbox.apiKeyLast4': keyLast4,
            'credentials.sandbox.active': true,
            'credentials.sandbox.environment': 'sandbox',
            apiKeySandboxHash: keyHash
          } : {
            'production.apiKeyHash': keyHash,
            'production.apiKeyLast4': keyLast4,
            'production.active': true,
            'production.environment': 'production',
            'credentials.production.apiKeyHash': keyHash,
            'credentials.production.apiKeyLast4': keyLast4,
            'credentials.production.active': true,
            'credentials.production.environment': 'production',
            apiKeyProductionHash: keyHash
          })
        },
        $unset: environment === 'sandbox'
          ? { [`${path}.apiKey`]: '', 'sandbox.apiKey': '', 'credentials.sandbox.apiKey': '', apiKeySandbox: '', sandboxApiKey: '' }
          : { [`${path}.apiKey`]: '', 'production.apiKey': '', 'credentials.production.apiKey': '', apiKeyProduction: '', enterpriseApiKey: '', apiKey: '' }
      }
    );

    await IntegrationAuditLog.create({
      scope: 'enterprise',
      eventType: 'partner_api_key_rotated',
      manufacturer: partner.requestId || partner.tradeName || partner.companyName || '',
      status: 'success',
      statusCode: 200,
      message: `API Key ${environment} renovada pelo portal do fabricante`,
      metadata: { environment, companyName: partner.companyName || '', tradeName: partner.tradeName || '' }
    }).catch(() => null);

    return res.json({ ok: true, environment, apiKey: key, message: 'API Key renovada com sucesso' });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao renovar API Key' });
  }
});
app.post('/api/enterprise/partner/api-keys/:environment/revoke', enterprisePartnerRequired, async (req, res) => {
  try {
    const environment = String(req.params.environment || 'sandbox').toLowerCase() === 'production' ? 'production' : 'sandbox';
    const partner = await enterprisePartnerFindCurrentDoc(req.enterprisePortal || {});
    if (!partner) return res.status(404).json({ ok: false, error: 'Fabricante não encontrado' });

    const path = enterprisePartnerEnvironmentPath(environment);
    await EnterpriseHomologationRequestCompat.updateOne(
      { _id: partner._id },
      {
        $set: {
          [`${path}.active`]: false,
          [`${path}.revokedAt`]: new Date(),
          ...(environment === 'sandbox' ? {
            'sandbox.active': false,
            'credentials.sandbox.active': false
          } : {
            'production.active': false,
            'credentials.production.active': false
          })
        }
      }
    );

    await IntegrationAuditLog.create({
      scope: 'enterprise',
      eventType: 'partner_api_key_revoked',
      manufacturer: partner.requestId || partner.tradeName || partner.companyName || '',
      status: 'success',
      statusCode: 200,
      message: `API Key ${environment} revogada pelo portal do fabricante`,
      metadata: { environment, companyName: partner.companyName || '', tradeName: partner.tradeName || '' }
    }).catch(() => null);

    return res.json({ ok: true, environment, message: 'API Key revogada com sucesso' });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao revogar API Key' });
  }
});
}
