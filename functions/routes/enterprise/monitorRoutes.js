// ============================================================
// ROTAS ENTERPRISE - MONITORAMENTO
// Extraído de routes/enterpriseRoutes.js sem alterar endpoints, regras ou respostas.
// ============================================================

export default function registerEnterpriseMonitorRoutes(app, context = {}) {
  const {
    EnterpriseHomologationRequestCompat,
    IntegrationAuditLog,
    ManufacturerDispatchQueue,
    OperationalAlert,
    enterpriseVersionHeaders
  } = context;

// ============================================================
// PASSO 35 - CONSOLE ENTERPRISE / MONITORAMENTO EM TEMPO REAL
// Métricas operacionais agregadas para Admin Enterprise e Portal.
// ============================================================
function enterpriseMonitorDateRange(req) {
  const minutes = Math.max(Number(req.query.minutes || 60), 1);
  const days = Math.max(Number(req.query.days || 1), 1);
  const from = new Date(Date.now() - (minutes ? minutes * 60 * 1000 : days * 24 * 60 * 60 * 1000));
  return from;
}

function enterpriseStatusGroup(code) {
  const n = Number(code || 0);
  if (n >= 500) return '5xx';
  if (n >= 400) return '4xx';
  if (n >= 300) return '3xx';
  if (n >= 200) return '2xx';
  return 'other';
}

function enterpriseLogDuration(log = {}) {
  const md = log.metadata || {};
  return Number(md.durationMs || md.responseTimeMs || md.elapsedMs || md.totalMs || log.durationMs || 0) || 0;
}

async function buildEnterpriseMonitorOverview(req) {
  const from = enterpriseMonitorDateRange(req);
  const from24 = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [partners, logs, queuePending, queueDead, alerts] = await Promise.all([
    EnterpriseHomologationRequestCompat.find({}).sort({ updatedAt: -1 }).limit(200).lean().catch(() => []),
    IntegrationAuditLog.find({ createdAt: { $gte: from }, $or: [{ scope: /enterprise/i }, { eventType: /enterprise|homologation|catalog|order|webhook|partner|sdk|oauth/i }] }).sort({ createdAt: -1 }).limit(800).lean().catch(() => []),
    ManufacturerDispatchQueue.countDocuments({ status: { $in: ['pending', 'retry'] }, deadLetter: { $ne: true } }).catch(() => 0),
    ManufacturerDispatchQueue.countDocuments({ $or: [{ deadLetter: true }, { status: 'dead_letter' }] }).catch(() => 0),
    OperationalAlert.find({ status: { $ne: 'resolved' } }).sort({ lastSeenAt: -1, createdAt: -1 }).limit(20).lean().catch(() => [])
  ]);

  const total = logs.length;
  const approved = logs.filter(l => Number(l.statusCode || 0) >= 200 && Number(l.statusCode || 0) < 400).length;
  const errors = logs.filter(l => Number(l.statusCode || 0) >= 400 || String(l.status || '').toLowerCase().includes('error')).length;
  const durations = logs.map(enterpriseLogDuration).filter(n => n > 0);
  const avgMs = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
  const successRate = total ? Math.round((approved / total) * 100) : 100;
  const rpm = Math.round((total / Math.max(Number(req.query.minutes || 60), 1)) * 100) / 100;

  const byStatus = logs.reduce((acc, l) => {
    const group = enterpriseStatusGroup(l.statusCode);
    acc[group] = (acc[group] || 0) + 1;
    return acc;
  }, {});

  const byEndpoint = {};
  const byMinute = {};
  const byPartner = {};
  for (const log of logs) {
    const endpoint = String(log.eventType || log.metadata?.endpoint || log.metadata?.path || log.request?.path || 'unknown');
    byEndpoint[endpoint] = (byEndpoint[endpoint] || 0) + 1;

    const d = new Date(log.createdAt || Date.now());
    const bucket = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    byMinute[bucket] = (byMinute[bucket] || 0) + 1;

    const partner = String(log.manufacturer || log.metadata?.partner || log.metadata?.companyName || log.metadata?.requestId || 'Ariana Enterprise');
    byPartner[partner] = (byPartner[partner] || 0) + 1;
  }

  const recentLogs = logs.slice(0, 25).map(log => ({
    id: String(log._id || ''),
    date: log.createdAt,
    event: log.eventType || log.metadata?.endpoint || 'log',
    statusCode: Number(log.statusCode || 0),
    status: log.status || '',
    message: log.message || '',
    manufacturer: log.manufacturer || log.metadata?.companyName || '',
    durationMs: enterpriseLogDuration(log)
  }));

  const productionPartners = partners.filter(p => String(p.environment || p.status || '').toLowerCase().includes('production') || p.productionCredentials?.active === true || p.production?.active === true).length;
  const sandboxPartners = partners.filter(p => p.sandboxCredentials?.apiKey || p.sandbox?.apiKey || String(p.status || '').toLowerCase().includes('sandbox')).length;

  return {
    ok: true,
    generatedAt: new Date(),
    window: { from, minutes: Number(req.query.minutes || 60) },
    health: errors ? (successRate >= 95 ? 'attention' : 'degraded') : 'healthy',
    metrics: {
      rpm,
      totalCalls: total,
      approved,
      errors,
      avgResponseMs: avgMs,
      successRate,
      errorRate: total ? Math.round((errors / total) * 100) : 0,
      partners: partners.length,
      sandboxPartners,
      productionPartners,
      queuePending,
      queueDead,
      activeAlerts: alerts.length
    },
    charts: {
      byMinute: Object.entries(byMinute).map(([label, value]) => ({ label, value })).slice(-30),
      byStatus: Object.entries(byStatus).map(([label, value]) => ({ label, value })),
      byEndpoint: Object.entries(byEndpoint).sort((a,b)=>b[1]-a[1]).slice(0, 12).map(([label, value]) => ({ label, value })),
      byPartner: Object.entries(byPartner).sort((a,b)=>b[1]-a[1]).slice(0, 12).map(([label, value]) => ({ label, value }))
    },
    recentLogs,
    alerts: alerts.map(a => ({
      id: a.alertId || String(a._id || ''),
      severity: a.severity || 'medium',
      title: a.title || a.type || 'Alerta',
      message: a.message || '',
      manufacturer: a.manufacturer || '',
      lastSeenAt: a.lastSeenAt || a.createdAt
    }))
  };
}

app.get('/api/enterprise/monitor/overview', async (req, res) => {
  try {
    const overview = await buildEnterpriseMonitorOverview(req);
    return res.json(overview);
  } catch (error) {
    console.error('[ENTERPRISE MONITOR] overview', error);
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar monitoramento Enterprise' });
  }
});

app.get('/api/v1/enterprise/monitor/overview', enterpriseVersionHeaders('v1'), async (req, res) => {
  try {
    const overview = await buildEnterpriseMonitorOverview(req);
    return res.json({ ...overview, requestedVersion: 'v1' });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar monitoramento Enterprise' });
  }
});

app.get('/api/v2/enterprise/monitor/overview', enterpriseVersionHeaders('v2', true), async (req, res) => {
  try {
    const overview = await buildEnterpriseMonitorOverview(req);
    return res.json({ ...overview, requestedVersion: 'v2', warning: 'v2 ainda está em preview.' });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar monitoramento Enterprise' });
  }
});




}
