// ============================================================
// ROTAS ENTERPRISE - PARTNER LOGS / CERTIFICATES / DASHBOARD
// Extraído de routes/enterpriseRoutes.js sem alterar endpoints, regras ou respostas.
// ============================================================

export default function registerEnterprisePartnerLogsRoutes(app, context = {}) {
  const {
    FRONTEND_URL,
    IntegrationAuditLog,
    mongoose,
    escapeRegex,
    enterprisePartnerRequired,
    enterprisePartnerLogQuery,
    enterprisePartnerLogDTO,
    enterpriseLogsCsv
  } = context;

function buildEnterprisePartnerLogsQuery(req) {
  const baseQuery = enterprisePartnerLogQuery(req.enterprisePortal || {});
  const and = [baseQuery];
  const search = String(req.query.search || '').trim();
  const event = String(req.query.event || '').trim();
  const statusGroup = String(req.query.status || '').trim().toLowerCase();
  const dateFrom = String(req.query.from || '').trim();
  const dateTo = String(req.query.to || '').trim();

  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    and.push({
      $or: [
        { eventType: rx },
        { message: rx },
        { manufacturer: rx },
        { orderId: rx },
        { 'metadata.endpoint': rx },
        { 'metadata.path': rx },
        { 'request.path': rx }
      ]
    });
  }

  if (event) {
    const rx = new RegExp(escapeRegex(event), 'i');
    and.push({ $or: [{ eventType: rx }, { 'metadata.endpoint': rx }, { 'metadata.path': rx }, { 'request.path': rx }] });
  }

  if (statusGroup === '2xx') and.push({ statusCode: { $gte: 200, $lt: 300 } });
  if (statusGroup === '4xx') and.push({ statusCode: { $gte: 400, $lt: 500 } });
  if (statusGroup === '5xx') and.push({ statusCode: { $gte: 500, $lt: 600 } });
  if (statusGroup === 'error') {
    and.push({ $or: [{ statusCode: { $gte: 400 } }, { status: /error|failed|fail/i }] });
  }

  const createdAt = {};
  if (dateFrom) {
    const d = new Date(`${dateFrom}T00:00:00.000Z`);
    if (!Number.isNaN(d.getTime())) createdAt.$gte = d;
  }
  if (dateTo) {
    const d = new Date(`${dateTo}T23:59:59.999Z`);
    if (!Number.isNaN(d.getTime())) createdAt.$lte = d;
  }
  if (Object.keys(createdAt).length) and.push({ createdAt });

  return and.length === 1 ? baseQuery : { $and: and };
}


app.get('/api/enterprise/partner/logs', enterprisePartnerRequired, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 30), 1), 200);
    const page = Math.max(Number(req.query.page || 1), 1);
    const skip = (page - 1) * limit;
    const query = buildEnterprisePartnerLogsQuery(req);

    const [logs, total] = await Promise.all([
      IntegrationAuditLog.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      IntegrationAuditLog.countDocuments(query)
    ]);

    return res.json({
      ok: true,
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      logs: logs.map(enterprisePartnerLogDTO)
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar logs' });
  }
});

app.get('/api/enterprise/partner/logs/:id', enterprisePartnerRequired, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ ok: false, error: 'ID inválido' });
    const query = buildEnterprisePartnerLogsQuery(req);
    const log = await IntegrationAuditLog.findOne({ _id: req.params.id, $and: [query] }).lean();
    if (!log) return res.status(404).json({ ok: false, error: 'Log não encontrado' });
    return res.json({ ok: true, log: enterprisePartnerLogDTO(log) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao abrir log' });
  }
});

app.get('/api/enterprise/partner/logs/export/:format', enterprisePartnerRequired, async (req, res) => {
  try {
    const format = String(req.params.format || 'json').toLowerCase();
    const query = buildEnterprisePartnerLogsQuery(req);
    const logs = await IntegrationAuditLog.find(query).sort({ createdAt: -1 }).limit(5000).lean();
    const rows = logs.map(enterprisePartnerLogDTO);
    const stamp = new Date().toISOString().slice(0, 10);

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="ariana-enterprise-logs-${stamp}.csv"`);
      return res.send('\ufeff' + enterpriseLogsCsv(rows));
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ariana-enterprise-logs-${stamp}.json"`);
    return res.json({ ok: true, total: rows.length, logs: rows });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao exportar logs' });
  }
});

app.get('/api/enterprise/partner/certificates', enterprisePartnerRequired, async (req, res) => {
  try {
    const p = req.enterprisePortal || {};
    const approvedLogs = await IntegrationAuditLog.find({
      scope: 'enterprise',
      eventType: { $in: ['homologation_completed', 'api_explorer_full_flow', 'catalog_push', 'webhook_test'] },
      $or: [
        { manufacturer: p.requestId || '' },
        { 'metadata.companyName': p.companyName || '' },
        { 'metadata.tradeName': p.tradeName || '' }
      ]
    }).sort({ createdAt: -1 }).limit(10).lean().catch(() => []);

    return res.json({
      ok: true,
      certificates: [
        {
          id: `CERT-${String(p.requestId || 'ENTERPRISE').toUpperCase()}-SANDBOX`,
          environment: 'sandbox',
          status: 'available',
          title: 'Certificado de Homologação Sandbox',
          issuedAt: approvedLogs[0]?.createdAt || new Date(),
          modules: ['Health', 'Catálogo', 'Estoque', 'Preço', 'Pedido', 'NF-e', 'Rastreio', 'Webhook'],
          validationUrl: `${FRONTEND_URL}/enterprise_api_explorer.html`
        }
      ]
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar certificados' });
  }
});

app.get('/api/enterprise/partner/dashboard', enterprisePartnerRequired, async (req, res) => {
  try {
    const query = enterprisePartnerLogQuery(req.enterprisePortal || {});
    const logs = await IntegrationAuditLog.find(query).sort({ createdAt: -1 }).limit(200).lean();
    const total = logs.length;
    const success = logs.filter((l) => String(l.status || '').toLowerCase() === 'success' || Number(l.statusCode || 0) < 400).length;
    const errors = logs.filter((l) => Number(l.statusCode || 0) >= 400 || String(l.status || '').toLowerCase() === 'error').length;
    const last = logs[0] || null;

    return res.json({
      ok: true,
      summary: {
        calls: total,
        success,
        errors,
        successRate: total ? Math.round((success / total) * 10000) / 100 : 0,
        lastEventAt: last?.createdAt || null,
        lastEventType: last?.eventType || ''
      }
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar dashboard' });
  }
});
}
