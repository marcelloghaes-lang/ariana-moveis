// ============================================================
// ENTERPRISE ADMIN ANALYTICS ROUTES
// Extraído de routes/enterpriseRoutes.js sem alterar endpoints, regras ou respostas.
// ============================================================

export default function registerEnterpriseAdminAnalyticsRoutes(app, context = {}) {
  const {
    Order,
    Product,
    ManufacturerIntegration,
    IntegrationAuditLog,
    ManufacturerDispatchQueue,
    ensureArray,
    enterpriseVersionHeaders
  } = context;

// ============================================================
// PASSO 37 - ANALYTICS ENTERPRISE
// BI comercial e operacional para fabricantes, pedidos, receita,
// produtos, integrações e exportações CSV/JSON.
// ============================================================
function analyticsDateRange(period = '30d') {
  const nowDate = new Date();
  const end = new Date(nowDate);
  let start = new Date(nowDate);
  const key = String(period || '30d').toLowerCase();
  if (key === 'today') start = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
  else if (key === 'yesterday') {
    start = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() - 1);
    return { start, end: new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()), period: key };
  } else if (key === '7d') start.setDate(start.getDate() - 7);
  else if (key === '90d') start.setDate(start.getDate() - 90);
  else if (key === '1y' || key === '365d') start.setDate(start.getDate() - 365);
  else start.setDate(start.getDate() - 30);
  return { start, end, period: key };
}
function analyticsDayKey(date) {
  const d = new Date(date || Date.now());
  return d.toISOString().slice(0, 10);
}
function analyticsMoney(value) {
  const n = Number(value || 0);
  return Math.round(n * 100) / 100;
}
function analyticsPercent(part, total) {
  const p = Number(part || 0), t = Number(total || 0);
  if (!t) return 0;
  return Math.round((p / t) * 10000) / 100;
}
async function buildEnterpriseAnalytics(period = '30d') {
  const { start, end } = analyticsDateRange(period);
  const orderQuery = { createdAt: { $gte: start, $lt: end } };
  const logQuery = { createdAt: { $gte: start, $lt: end } };
  const [orders, products, partners, logs, queuePending, queueDead] = await Promise.all([
    Order.find(orderQuery).lean().limit(5000),
    Product.find({}).lean().limit(5000),
    ManufacturerIntegration.find({}).lean().limit(1000).catch(() => []),
    IntegrationAuditLog.find(logQuery).sort({ createdAt: -1 }).lean().limit(5000),
    ManufacturerDispatchQueue.countDocuments({ status: 'pending' }).catch(() => 0),
    ManufacturerDispatchQueue.countDocuments({ deadLetter: true }).catch(() => 0),
  ]);

  const revenue = analyticsMoney(orders.reduce((sum, o) => sum + Number(o.total || 0), 0));
  const ordersCount = orders.length;
  const productsCount = products.length;
  const syncedProducts = products.filter(p => p.manufacturer || p.sellerId || p.sku).length;
  const apiCalls = logs.length;
  const apiErrors = logs.filter(l => Number(l.statusCode || 0) >= 400 || String(l.status || '').toLowerCase().includes('error')).length;
  const avgResponseMs = Math.round(logs.reduce((sum, l) => sum + Number(l.metadata?.responseTimeMs || l.responseTimeMs || 0), 0) / Math.max(1, logs.length));

  const byDayMap = new Map();
  for (const o of orders) {
    const k = analyticsDayKey(o.createdAt);
    const row = byDayMap.get(k) || { date: k, orders: 0, revenue: 0 };
    row.orders += 1;
    row.revenue = analyticsMoney(row.revenue + Number(o.total || 0));
    byDayMap.set(k, row);
  }
  const revenueByDay = Array.from(byDayMap.values()).sort((a,b)=>a.date.localeCompare(b.date));

  const partnerMap = new Map();
  for (const p of partners) {
    const key = String(p.manufacturer || p.name || p.displayName || 'sem_fabricante');
    partnerMap.set(key, { manufacturer: key, orders: 0, revenue: 0, apiCalls: 0, products: 0 });
  }
  for (const p of products) {
    const key = String(p.manufacturer || p.sellerName || p.sellerId || 'ariana_moveis');
    const row = partnerMap.get(key) || { manufacturer: key, orders: 0, revenue: 0, apiCalls: 0, products: 0 };
    row.products += 1;
    partnerMap.set(key, row);
  }
  for (const o of orders) {
    const key = String(o.manufacturer || ensureArray(o.sellerIds)[0] || 'ariana_moveis');
    const row = partnerMap.get(key) || { manufacturer: key, orders: 0, revenue: 0, apiCalls: 0, products: 0 };
    row.orders += 1;
    row.revenue = analyticsMoney(row.revenue + Number(o.total || 0));
    partnerMap.set(key, row);
  }
  for (const l of logs) {
    const key = String(l.manufacturer || l.metadata?.manufacturer || 'ariana_moveis');
    const row = partnerMap.get(key) || { manufacturer: key, orders: 0, revenue: 0, apiCalls: 0, products: 0 };
    row.apiCalls += 1;
    partnerMap.set(key, row);
  }
  const partnersRanking = Array.from(partnerMap.values()).sort((a,b)=>b.revenue-a.revenue || b.orders-a.orders || b.apiCalls-a.apiCalls).slice(0,20);

  const productMap = new Map();
  for (const order of orders) {
    for (const item of ensureArray(order.items)) {
      const sku = String(item.sku || item.productId || item.name || 'sem_sku');
      const row = productMap.get(sku) || { sku, name: item.name || sku, qty: 0, revenue: 0 };
      row.qty += Number(item.qty || 0);
      row.revenue = analyticsMoney(row.revenue + Number(item.totalPrice || (Number(item.unitPrice || 0) * Number(item.qty || 0)) || 0));
      productMap.set(sku, row);
    }
  }
  const topProducts = Array.from(productMap.values()).sort((a,b)=>b.revenue-a.revenue || b.qty-a.qty).slice(0,20);

  const endpointMap = new Map();
  const statusMap = { '2xx': 0, '4xx': 0, '5xx': 0 };
  for (const l of logs) {
    const endpoint = String(l.eventType || l.metadata?.endpoint || l.request?.url || 'evento');
    endpointMap.set(endpoint, (endpointMap.get(endpoint) || 0) + 1);
    const code = Number(l.statusCode || l.status || 0);
    if (code >= 500) statusMap['5xx'] += 1;
    else if (code >= 400) statusMap['4xx'] += 1;
    else statusMap['2xx'] += 1;
  }
  const endpoints = Array.from(endpointMap.entries()).map(([endpoint, calls]) => ({ endpoint, calls })).sort((a,b)=>b.calls-a.calls).slice(0,20);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    period,
    window: { from: start.toISOString(), to: end.toISOString() },
    summary: {
      revenue,
      orders: ordersCount,
      products: productsCount,
      syncedProducts,
      manufacturers: partners.length,
      apiCalls,
      apiErrors,
      successRate: analyticsPercent(apiCalls - apiErrors, apiCalls),
      avgResponseMs,
      queuePending,
      queueDead
    },
    charts: { revenueByDay, statusMap, endpoints, partnersRanking, topProducts },
    recent: {
      orders: orders.slice(0, 15).map(o => ({ id: String(o._id || o.id || ''), customerName: o.customerName, total: o.total, status: o.status, createdAt: o.createdAt, manufacturer: o.manufacturer || ensureArray(o.sellerIds)[0] || '' })),
      logs: logs.slice(0, 15).map(l => ({ eventType: l.eventType, statusCode: l.statusCode, message: l.message, manufacturer: l.manufacturer, createdAt: l.createdAt }))
    }
  };
}

app.get('/api/enterprise/analytics/overview', async (req, res) => {
  try { return res.json(await buildEnterpriseAnalytics(req.query.period || '30d')); }
  catch (error) { console.error('analytics overview error', error); return res.status(500).json({ ok:false, error:'Erro ao gerar Analytics Enterprise' }); }
});
app.get('/api/v1/enterprise/analytics/overview', enterpriseVersionHeaders('v1'), async (req, res) => {
  try { return res.json({ ...(await buildEnterpriseAnalytics(req.query.period || '30d')), requestedVersion:'v1' }); }
  catch (error) { return res.status(500).json({ ok:false, error:'Erro ao gerar Analytics Enterprise' }); }
});
app.get('/api/v2/enterprise/analytics/overview', enterpriseVersionHeaders('v2', true), async (req, res) => {
  try { return res.json({ ...(await buildEnterpriseAnalytics(req.query.period || '30d')), requestedVersion:'v2', warning:'v2 preview' }); }
  catch (error) { return res.status(500).json({ ok:false, error:'Erro ao gerar Analytics Enterprise' }); }
});
app.get('/api/enterprise/analytics/revenue', async (req, res) => {
  const data = await buildEnterpriseAnalytics(req.query.period || '30d');
  return res.json({ ok:true, generatedAt:data.generatedAt, period:data.period, revenue:data.summary.revenue, byDay:data.charts.revenueByDay });
});
app.get('/api/enterprise/analytics/products', async (req, res) => {
  const data = await buildEnterpriseAnalytics(req.query.period || '30d');
  return res.json({ ok:true, generatedAt:data.generatedAt, total:data.summary.products, synced:data.summary.syncedProducts, topProducts:data.charts.topProducts });
});
app.get('/api/enterprise/analytics/orders', async (req, res) => {
  const data = await buildEnterpriseAnalytics(req.query.period || '30d');
  return res.json({ ok:true, generatedAt:data.generatedAt, total:data.summary.orders, recent:data.recent.orders, byDay:data.charts.revenueByDay });
});
app.get('/api/enterprise/analytics/history', async (req, res) => {
  const data = await buildEnterpriseAnalytics(req.query.period || '90d');
  return res.json({ ok:true, generatedAt:data.generatedAt, period:data.period, history:data.charts.revenueByDay, partners:data.charts.partnersRanking });
});
app.get('/api/enterprise/analytics/export', async (req, res) => {
  const format = String(req.query.format || 'json').toLowerCase();
  const data = await buildEnterpriseAnalytics(req.query.period || '30d');
  if (format === 'csv') {
    const rows = [['fabricante','pedidos','receita','produtos','chamadas_api']].concat(data.charts.partnersRanking.map(p => [p.manufacturer, p.orders, p.revenue, p.products, p.apiCalls]));
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition','attachment; filename="ariana-enterprise-analytics.csv"');
    return res.send(rows.map(r => r.map(v => '"'+String(v ?? '').replace(/"/g,'""')+'"').join(',')).join('\n'));
  }
  res.setHeader('Content-Disposition','attachment; filename="ariana-enterprise-analytics.json"');
  return res.json(data);
});

}
