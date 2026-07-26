// ============================================================
// ROTAS ENTERPRISE - DEVELOPER EXPERIENCE (DX)
// ============================================================

import { enterpriseVersionHeaders } from './versionRoutes.js';

export default function registerEnterpriseDxRoutes(app, _context = {}) {

  app.get('/api/enterprise/dx', (_req, res) => {
    return res.json({
      ok: true,
      module: 'enterprise-dx',
      status: 'online',
      version: 'v1',
      resources: {
        swagger: '/api/enterprise/swagger',
        openapi: '/api/enterprise/openapi.json',
        docs: '/api/enterprise/docs',
        versions: '/api/enterprise/version'
      }
    });
  });

  app.get('/api/v1/enterprise/dx', enterpriseVersionHeaders('v1'), (_req, res) => {
    return res.json({
      ok: true,
      module: 'enterprise-dx',
      requestedVersion: 'v1',
      status: 'online'
    });
  });

  app.get('/api/v2/enterprise/dx', enterpriseVersionHeaders('v2', true), (_req, res) => {
    return res.json({
      ok: true,
      module: 'enterprise-dx',
      requestedVersion: 'v2',
      status: 'preview'
    });
  });
}
