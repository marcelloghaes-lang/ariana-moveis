// ============================================================
// ROTAS ENTERPRISE - VERSIONAMENTO DA API (v1/v2)
// Extraído de routes/enterpriseRoutes.js sem alterar endpoints, regras ou respostas.
// ============================================================

export const ENTERPRISE_API_VERSIONS = {
  current: 'v1',
  latest: 'v1',
  supported: ['v1'],
  preview: ['v2'],
  defaultVersion: 'v1',
  deprecationPolicy: 'Rotas sem versão continuam funcionando, mas novos fabricantes devem usar /api/v1/enterprise.',
  routes: {
    v1: {
      status: 'stable',
      basePath: '/api/v1/enterprise',
      releasedAt: '2026-06-26',
      notes: 'Versão estável inicial da Ariana Enterprise API.'
    },
    v2: {
      status: 'preview',
      basePath: '/api/v2/enterprise',
      releasedAt: null,
      notes: 'Prévia reservada para evoluções futuras sem quebrar integrações v1.'
    }
  }
};

export function enterpriseVersionHeaders(version = 'v1', preview = false) {
  return (_req, res, next) => {
    res.setHeader('X-Ariana-API-Version', version);
    res.setHeader('X-Ariana-API-Latest-Version', ENTERPRISE_API_VERSIONS.latest);
    res.setHeader('X-Ariana-API-Version-Status', preview ? 'preview' : 'stable');
    return next();
  };
}

export default function registerEnterpriseVersionRoutes(app, context = {}) {
  const { adminRequired } = context;

  function enterpriseVersionProxy(version = 'v1', preview = false) {
    return (req, res) => {
      res.setHeader('X-Ariana-API-Version', version);
      res.setHeader('X-Ariana-API-Latest-Version', ENTERPRISE_API_VERSIONS.latest);
      res.setHeader('X-Ariana-API-Version-Status', preview ? 'preview' : 'stable');
      res.setHeader('X-Ariana-API-Original-Path', req.originalUrl || req.url || '');
      req.url = `/api/enterprise${req.url || ''}`;
      return app.handle(req, res);
    };
  }

  app.get('/api/enterprise/version', (_req, res) => {
    return res.json({ ok: true, ...ENTERPRISE_API_VERSIONS });
  });

  app.get('/api/enterprise/versions', (_req, res) => {
    return res.json({ ok: true, ...ENTERPRISE_API_VERSIONS });
  });

  app.get('/api/v1/enterprise/version', enterpriseVersionHeaders('v1'), (_req, res) => {
    return res.json({ ok: true, ...ENTERPRISE_API_VERSIONS, requestedVersion: 'v1' });
  });

  app.get('/api/v1/enterprise/versions', enterpriseVersionHeaders('v1'), (_req, res) => {
    return res.json({ ok: true, ...ENTERPRISE_API_VERSIONS, requestedVersion: 'v1' });
  });

  app.get('/api/v2/enterprise/version', enterpriseVersionHeaders('v2', true), (_req, res) => {
    return res.json({ ok: true, ...ENTERPRISE_API_VERSIONS, requestedVersion: 'v2', warning: 'v2 ainda é preview. Use v1 para integrações em produção.' });
  });

  app.get('/api/v2/enterprise/versions', enterpriseVersionHeaders('v2', true), (_req, res) => {
    return res.json({ ok: true, ...ENTERPRISE_API_VERSIONS, requestedVersion: 'v2', warning: 'v2 ainda é preview. Use v1 para integrações em produção.' });
  });

  app.use('/api/v1/enterprise', enterpriseVersionProxy('v1'));
  app.use('/api/v2/enterprise', enterpriseVersionProxy('v2', true));

  if (typeof adminRequired === 'function') {
    app.get('/api/admin/enterprise/pro/versions', adminRequired, async (_req, res) => {
      return res.json({ ok: true, versions: ENTERPRISE_API_VERSIONS });
    });
  }
}
