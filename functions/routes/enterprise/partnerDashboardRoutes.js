// ============================================================
// ROTAS ENTERPRISE - PARTNER DASHBOARD / USAGE / METRICS
// Extraído de routes/enterpriseRoutes.js sem alterar endpoints, regras ou respostas.
// ============================================================

export default function registerEnterprisePartnerDashboardRoutes(app, context = {}) {
  const {
    IntegrationAuditLog,
    escapeRegex,
    enterprisePartnerRequired,
    enterprisePartnerLogQuery
  } = context;

app.get('/api/enterprise/partner/usage', enterprisePartnerRequired, async (req, res) => {
  try {
    const logs = await IntegrationAuditLog.find(enterprisePartnerLogQuery(req.enterprisePortal || {}))
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    const byEndpoint = {};
    const byStatus = { ok2xx: 0, bad4xx: 0, err5xx: 0, other: 0 };
    let totalMs = 0;
    let timed = 0;

    for (const log of logs) {
      const endpoint = String(log.metadata?.endpoint || log.metadata?.path || log.request?.path || log.eventType || 'unknown');
      byEndpoint[endpoint] = (byEndpoint[endpoint] || 0) + 1;
      const code = Number(log.statusCode || log.response?.status || 0);
      if (code >= 200 && code < 300) byStatus.ok2xx += 1;
      else if (code >= 400 && code < 500) byStatus.bad4xx += 1;
      else if (code >= 500) byStatus.err5xx += 1;
      else byStatus.other += 1;
      const ms = Number(log.metadata?.durationMs || log.metadata?.totalMs || 0);
      if (ms > 0) { totalMs += ms; timed += 1; }
    }

    return res.json({
      ok: true,
      usage: {
        total: logs.length,
        byStatus,
        byEndpoint: Object.entries(byEndpoint).map(([endpoint, count]) => ({ endpoint, count })).sort((a,b)=>b.count-a.count).slice(0, 20),
        avgMs: timed ? Math.round(totalMs / timed) : 0,
        generatedAt: new Date()
      }
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar consumo da API' });
  }
});


// ============================================================
// PASSO 19 - Dashboard real de consumo da API Enterprise
// Métricas por período, endpoint, status HTTP e exportação.
// ============================================================
function enterprisePartnerParseDays(value = 7) {
  const n = Number(value || 7);
  if (!Number.isFinite(n)) return 7;
  return Math.min(90, Math.max(1, Math.round(n)));
}

function enterprisePartnerMetricLogQuery(req = {}) {
  const days = enterprisePartnerParseDays(req.query?.days || 7);
  const base = enterprisePartnerLogQuery(req.enterprisePortal || {});
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const query = { ...base, createdAt: { $gte: since } };

  const statusClass = String(req.query?.statusClass || '').toLowerCase().trim();
  if (statusClass === '2xx') query.statusCode = { $gte: 200, $lt: 300 };
  if (statusClass === '4xx') query.statusCode = { $gte: 400, $lt: 500 };
  if (statusClass === '5xx') query.statusCode = { $gte: 500, $lt: 600 };

  const endpoint = String(req.query?.endpoint || '').trim();
  if (endpoint) {
    query.$and = query.$and || [];
    const rx = new RegExp(escapeRegex(endpoint), 'i');
    query.$and.push({ $or: [
      { eventType: rx },
      { 'metadata.endpoint': rx },
      { 'metadata.path': rx },
      { 'request.path': rx }
    ]});
  }

  const search = String(req.query?.q || req.query?.search || '').trim();
  if (search) {
    query.$and = query.$and || [];
    const rx = new RegExp(escapeRegex(search), 'i');
    query.$and.push({ $or: [
      { eventType: rx },
      { message: rx },
      { manufacturer: rx },
      { 'metadata.endpoint': rx },
      { 'metadata.path': rx }
    ]});
  }

  return { query, days };
}

function enterprisePartnerLogEndpoint(log = {}) {
  return String(
    log.metadata?.endpoint ||
    log.metadata?.path ||
    log.request?.path ||
    log.eventType ||
    'unknown'
  );
}

function enterprisePartnerLogMs(log = {}) {
  const ms = Number(log.metadata?.durationMs || log.metadata?.totalMs || log.response?.durationMs || 0);
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

function enterprisePartnerLogStatusCode(log = {}) {
  const code = Number(log.statusCode || log.response?.statusCode || log.response?.status || 0);
  if (Number.isFinite(code) && code > 0) return code;
  const status = String(log.status || '').toLowerCase();
  if (['success', 'ok', 'sent', 'received'].includes(status)) return 200;
  if (['error', 'failed', 'fail'].includes(status)) return 500;
  return 0;
}

app.get('/api/enterprise/partner/metrics', enterprisePartnerRequired, async (req, res) => {
  try {
    const { query, days } = enterprisePartnerMetricLogQuery(req);
    const logs = await IntegrationAuditLog.find(query).sort({ createdAt: -1 }).limit(5000).lean();

    const byStatus = { ok2xx: 0, bad4xx: 0, err5xx: 0, other: 0 };
    const byEndpointMap = new Map();
    const byDayMap = new Map();
    const byHourMap = new Map();
    let totalMs = 0;
    let timed = 0;

    for (const log of logs) {
      const code = enterprisePartnerLogStatusCode(log);
      if (code >= 200 && code < 300) byStatus.ok2xx += 1;
      else if (code >= 400 && code < 500) byStatus.bad4xx += 1;
      else if (code >= 500) byStatus.err5xx += 1;
      else byStatus.other += 1;

      const endpoint = enterprisePartnerLogEndpoint(log);
      byEndpointMap.set(endpoint, (byEndpointMap.get(endpoint) || 0) + 1);

      const d = new Date(log.createdAt || Date.now());
      const dayKey = d.toISOString().slice(0, 10);
      const hourKey = `${String(d.getHours()).padStart(2, '0')}:00`;
      byDayMap.set(dayKey, (byDayMap.get(dayKey) || 0) + 1);
      byHourMap.set(hourKey, (byHourMap.get(hourKey) || 0) + 1);

      const ms = enterprisePartnerLogMs(log);
      if (ms) { totalMs += ms; timed += 1; }
    }

    const total = logs.length;
    const successRate = total ? Math.round((byStatus.ok2xx / total) * 10000) / 100 : 0;
    const avgMs = timed ? Math.round(totalMs / timed) : 0;
    const availability = Math.max(0, Math.min(100, successRate));

    return res.json({
      ok: true,
      period: { days, from: new Date(Date.now() - days * 24 * 60 * 60 * 1000), to: new Date() },
      summary: {
        total,
        success: byStatus.ok2xx,
        errors: byStatus.bad4xx + byStatus.err5xx,
        successRate,
        availability,
        avgMs,
        lastEventAt: logs[0]?.createdAt || null,
        lastEventType: logs[0]?.eventType || ''
      },
      byStatus,
      byEndpoint: Array.from(byEndpointMap.entries()).map(([endpoint, count]) => ({ endpoint, count })).sort((a,b)=>b.count-a.count),
      byDay: Array.from(byDayMap.entries()).map(([date, count]) => ({ date, count })).sort((a,b)=>a.date.localeCompare(b.date)),
      byHour: Array.from(byHourMap.entries()).map(([hour, count]) => ({ hour, count })).sort((a,b)=>a.hour.localeCompare(b.hour))
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar métricas da API' });
  }
});

app.get('/api/enterprise/partner/export/json', enterprisePartnerRequired, async (req, res) => {
  try {
    const { query, days } = enterprisePartnerMetricLogQuery(req);
    const limit = Math.min(Math.max(Number(req.query.limit || 1000), 1), 5000);
    const logs = await IntegrationAuditLog.find(query).sort({ createdAt: -1 }).limit(limit).lean();
    return res.json({ ok: true, days, total: logs.length, logs });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao exportar JSON' });
  }
});

app.get('/api/enterprise/partner/export/csv', enterprisePartnerRequired, async (req, res) => {
  try {
    const { query } = enterprisePartnerMetricLogQuery(req);
    const limit = Math.min(Math.max(Number(req.query.limit || 2000), 1), 5000);
    const logs = await IntegrationAuditLog.find(query).sort({ createdAt: -1 }).limit(limit).lean();
    const esc = (value = '') => `"${String(value ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
    const rows = [
      ['createdAt','eventType','statusCode','status','endpoint','message','manufacturer'].map(esc).join(','),
      ...logs.map((log) => [
        log.createdAt ? new Date(log.createdAt).toISOString() : '',
        log.eventType || '',
        enterprisePartnerLogStatusCode(log) || '',
        log.status || '',
        enterprisePartnerLogEndpoint(log),
        log.message || '',
        log.manufacturer || ''
      ].map(esc).join(','))
    ];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ariana-enterprise-logs-${Date.now()}.csv"`);
    return res.send(rows.join('\n'));
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao exportar CSV' });
  }
});
}
