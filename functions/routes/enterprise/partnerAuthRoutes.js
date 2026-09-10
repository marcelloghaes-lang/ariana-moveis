// ============================================================
// ENTERPRISE PARTNER AUTH ROUTES - ARIANA MÓVEIS
// Extraído de routes/enterpriseRoutes.js sem alterar endpoints, regras ou respostas.
// ============================================================

export default function registerEnterprisePartnerAuthRoutes(app, context = {}) {
  const {
    EnterpriseHomologationRequestCompat,
    IntegrationAuditLog,
    mongoose,
    enterpriseOAuthQuery,
    enterpriseOAuthPickCredential,
    enterpriseOAuthSignAccessToken,
    enterpriseOAuthRequired,
    enterprisePartnerRequired,
    enterpriseCompatFindPartnerByKey,
    enterpriseSecretMatches,
    enterpriseHashSecret,
    enterprisePartnerSign
  } = context;

app.post('/api/enterprise/oauth/token', async (req, res) => {
  try {
    const auth = String(req.headers.authorization || '');
    let clientId = String(req.body?.client_id || req.body?.clientId || '').trim();
    let clientSecret = String(req.body?.client_secret || req.body?.clientSecret || '').trim();
    if (auth.toLowerCase().startsWith('basic ')) {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
      const idx = decoded.indexOf(':');
      if (idx >= 0) {
        clientId = clientId || decoded.slice(0, idx);
        clientSecret = clientSecret || decoded.slice(idx + 1);
      }
    }
    const grantType = String(req.body?.grant_type || req.body?.grantType || 'client_credentials').trim();
    if (grantType !== 'client_credentials') return res.status(400).json({ ok: false, error: 'grant_type não suportado', supported: 'client_credentials' });
    if (!clientId || !clientSecret) return res.status(400).json({ ok: false, error: 'client_id e client_secret são obrigatórios' });

    const partner = await EnterpriseHomologationRequestCompat.findOne(enterpriseOAuthQuery(clientId)).lean();
    if (!partner) return res.status(401).json({ ok: false, error: 'client_id ou client_secret inválido' });

    const picked = enterpriseOAuthPickCredential(partner, clientId);
    if (!picked.credential || !enterpriseSecretMatches(clientSecret, picked.credential.clientSecret || '', picked.credential.clientSecretHash || '') || picked.credential.active === false) {
      return res.status(401).json({ ok: false, error: 'credencial OAuth desativada ou inválida' });
    }

    // Migração transparente de segredos OAuth legados em texto puro.
    if (!picked.credential.clientSecretHash && picked.credential.clientSecret) {
      const env = picked.environment === 'production' ? 'production' : 'sandbox';
      const hash = enterpriseHashSecret(clientSecret);
      const last4 = clientSecret.slice(-4);
      await EnterpriseHomologationRequestCompat.updateOne(
        { _id: partner._id },
        {
          $set: {
            [`oauth.${env}.clientSecretHash`]: hash,
            [`oauth.${env}.clientSecretLast4`]: last4,
            [`${env}Credentials.oauth.clientSecretHash`]: hash,
            [`${env}Credentials.oauth.clientSecretLast4`]: last4,
            [`credentials.${env}.oauth.clientSecretHash`]: hash,
            [`credentials.${env}.oauth.clientSecretLast4`]: last4
          },
          $unset: {
            [`oauth.${env}.clientSecret`]: '',
            [`${env}Credentials.oauth.clientSecret`]: '',
            [`credentials.${env}.oauth.clientSecret`]: '',
            ...(env === 'sandbox' ? { oauthClientSecret: '' } : { oauthProductionClientSecret: '' })
          }
        }
      ).catch(() => null);
    }
    if (picked.environment === 'production') {
      const prodActive = partner.productionCredentials?.active !== false && (partner.productionActive === true || String(partner.environment || '').toLowerCase() === 'production' || String(partner.status || '').toLowerCase() === 'production');
      if (!prodActive) return res.status(403).json({ ok: false, error: 'Produção não está ativa para este parceiro' });
    }

    const scopes = Array.isArray(picked.credential.scopes) && picked.credential.scopes.length ? picked.credential.scopes : (partner.integrationTypes || []);
    const accessToken = enterpriseOAuthSignAccessToken(partner, picked.environment, scopes);
    await IntegrationAuditLog.create({
      scope: 'enterprise', eventType: 'oauth_token_issued', manufacturer: partner.requestId || partner.tradeName || partner.companyName || '',
      integrationId: String(partner._id || ''), status: 'success', statusCode: 200, message: `OAuth token emitido para ${picked.environment}`,
      metadata: { environment: picked.environment, clientId, scopes }
    }).catch(() => null);
    return res.json({ ok: true, token_type: 'Bearer', access_token: accessToken, expires_in: 3600, scope: scopes.join(' '), environment: picked.environment });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao emitir token OAuth' });
  }
});

app.get('/api/enterprise/oauth/check', enterpriseOAuthRequired, async (req, res) => {
  return res.json({ ok: true, valid: true, environment: req.enterprisePartner?.environment || 'sandbox', partner: { requestId: req.enterprisePartner?.requestId || '', tradeName: req.enterprisePartner?.tradeName || '', scopes: req.enterpriseOAuth?.scopes || [] } });
});

app.post('/api/enterprise/partner/login', async (req, res) => {
  try {
    const apiKey = String(req.body?.apiKey || req.body?.key || req.headers['x-ariana-key'] || '').trim();
    if (!apiKey) return res.status(400).json({ ok: false, error: 'API Key obrigatória' });

    const partner = await enterpriseCompatFindPartnerByKey(apiKey);
    if (!partner) return res.status(401).json({ ok: false, error: 'API Key inválida' });

    const token = enterprisePartnerSign(partner);

    return res.json({
      ok: true,
      token,
      expiresIn: '12h',
      partner: {
        id: partner.id,
        requestId: partner.requestId,
        companyName: partner.companyName,
        tradeName: partner.tradeName,
        cnpj: partner.cnpj,
        email: partner.email,
        status: partner.status,
        statusLabel: partner.statusLabel,
        environment: partner.environment,
        permissions: partner.permissions
      }
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao acessar portal' });
  }
});

app.get('/api/enterprise/partner/me', enterprisePartnerRequired, async (req, res) => {
  const p = req.enterprisePortal || {};
  return res.json({
    ok: true,
    partner: {
      requestId: p.requestId || '',
      companyName: p.companyName || '',
      tradeName: p.tradeName || '',
      environment: p.environment || 'sandbox',
      permissions: p.permissions || []
    }
  });
});

app.get('/api/enterprise/partner/api-keys', enterprisePartnerRequired, async (req, res) => {
  try {
    const p = req.enterprisePortal || {};
    const partner = p.partnerId && mongoose.Types.ObjectId.isValid(p.partnerId)
      ? await EnterpriseHomologationRequestCompat.findById(p.partnerId).lean()
      : null;

    const mask = (value = '') => {
      value = String(value || '');
      if (!value) return '';
      if (value.length <= 12) return `${value.slice(0, 4)}••••`;
      return `${value.slice(0, 10)}••••••••${value.slice(-6)}`;
    };

    const sandbox = partner
      ? {
          ...(partner.sandbox || {}),
          ...(partner.credentials?.sandbox || {}),
          ...(partner.metadata?.sandboxCredentials || {}),
          ...(partner.sandboxCredentials || {}),
          apiKey: partner.sandboxCredentials?.apiKey || partner.sandbox?.apiKey || partner.credentials?.sandbox?.apiKey || partner.metadata?.sandboxCredentials?.apiKey || partner.apiKeySandbox || partner.sandboxApiKey || '',
          apiKeyLast4: partner.sandboxCredentials?.apiKeyLast4 || partner.sandbox?.apiKeyLast4 || partner.credentials?.sandbox?.apiKeyLast4 || ''
        }
      : {};
    const production = partner
      ? {
          ...(partner.production || {}),
          ...(partner.credentials?.production || {}),
          ...(partner.metadata?.productionCredentials || {}),
          ...(partner.productionCredentials || {}),
          apiKey: partner.productionCredentials?.apiKey || partner.production?.apiKey || partner.credentials?.production?.apiKey || partner.metadata?.productionCredentials?.apiKey || partner.enterpriseApiKey || partner.apiKey || '',
          apiKeyLast4: partner.productionCredentials?.apiKeyLast4 || partner.production?.apiKeyLast4 || partner.credentials?.production?.apiKeyLast4 || ''
        }
      : {};

    return res.json({
      ok: true,
      keys: {
        sandbox: {
          active: sandbox.active !== false,
          environment: 'sandbox',
          apiKeyMasked: sandbox.apiKey ? mask(sandbox.apiKey) : (sandbox.apiKeyLast4 ? `ari_sbx_••••••••${sandbox.apiKeyLast4}` : ''),
          lastAccessAt: sandbox.lastAccessAt || null,
          requestCount: Number(sandbox.requestCount || 0)
        },
        production: {
          active: production.active === true,
          environment: 'production',
          apiKeyMasked: production.apiKey ? mask(production.apiKey) : (production.apiKeyLast4 ? `ari_live_••••••••${production.apiKeyLast4}` : ''),
          lastAccessAt: production.lastAccessAt || null,
          requestCount: Number(production.requestCount || 0)
        }
      }
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar API Keys' });
  }
});

}
