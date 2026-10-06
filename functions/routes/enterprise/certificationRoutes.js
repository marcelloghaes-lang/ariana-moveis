// ============================================================
// ROTAS ENTERPRISE - CERTIFICAÇÃO
// Extraído de routes/enterpriseRoutes.js sem alterar endpoints, regras ou respostas.
// ============================================================

export default function registerEnterpriseCertificationRoutes(app, context = {}) {
  const {
    FRONTEND_URL,
    IntegrationAuditLog,
    EnterprisePartner,
    sanitizeIdPart,
    now
  } = context;

// ============================================================
// PASSO 38 - CENTRAL DE CERTIFICAÇÃO ENTERPRISE
// Certificação oficial de parceiros, trilhas, score, selo e
// comprovante público para fabricantes homologados.
// ============================================================
function certPartnerId(value = '') {
  return sanitizeIdPart(value || 'parceiro');
}

async function buildEnterpriseCertificationOverview(period = '30d') {
  const nowDate = now();
  const days = Number(String(period).replace(/\D/g, '')) || 30;
  const since = new Date(nowDate.getTime() - days * 24 * 60 * 60 * 1000);
  const partners = await EnterprisePartner.find({}).sort({ updatedAt: -1 }).limit(200).lean().catch(() => []);
  const logs = await IntegrationAuditLog.find({ createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(1000).lean().catch(() => []);
  const certs = partners.map((p) => {
    const manufacturer = String(p.manufacturer || p.companyName || p.name || p.email || 'Parceiro').trim();
    const key = certPartnerId(manufacturer);
    const pLogs = logs.filter((l) => String(l.manufacturer || '').toLowerCase() === manufacturer.toLowerCase() || String(l.manufacturer || '').toLowerCase() === key.toLowerCase());
    const total = pLogs.length;
    const ok = pLogs.filter((l) => Number(l.statusCode || 0) >= 200 && Number(l.statusCode || 0) < 300).length;
    const successRate = total ? Math.round((ok / total) * 10000) / 100 : 100;
    const production = Boolean(p.productionApiKeyActive || p.production?.active || p.productionStatus === 'active' || p.environment === 'production');
    const homologation = Number(p.homologationScore || p.homologation?.score || p.homologation?.progress || 0);
    const hScore = Math.max(0, Math.min(100, homologation || (production ? 100 : 0)));
    const score = Math.round((hScore * 0.55) + (successRate * 0.30) + (production ? 15 : 0));
    const level = score >= 95 ? 'gold' : score >= 85 ? 'silver' : score >= 70 ? 'bronze' : 'pending';
    const status = production && hScore >= 100 ? 'certified' : hScore >= 100 ? 'approved_sandbox' : 'in_progress';
    const certifiedAt = p.productionApprovedAt || p.certifiedAt || p.updatedAt || p.createdAt || nowDate;
    return {
      id: key,
      manufacturer,
      companyName: p.companyName || manufacturer,
      document: p.document || p.cnpj || '',
      email: p.email || '',
      status,
      level,
      score,
      successRate,
      homologation: hScore,
      production,
      sandbox: Boolean(p.sandboxApiKeyActive || p.sandbox?.active || p.apiKey || true),
      totalCalls: total,
      certificateId: `CERT-ARIANA-${key.toUpperCase().slice(0, 28)}-${String(new Date(certifiedAt).getFullYear() || new Date().getFullYear())}`,
      publicUrl: `${FRONTEND_URL}/enterprise_certification.html?cert=${encodeURIComponent(key)}`,
      certifiedAt,
      expiresAt: new Date(new Date(certifiedAt).getTime() + 365 * 24 * 60 * 60 * 1000)
    };
  });
  const certified = certs.filter(c => c.status === 'certified').length;
  return {
    ok: true,
    generatedAt: nowDate,
    period,
    summary: {
      partners: certs.length,
      certified,
      inProgress: certs.filter(c => c.status === 'in_progress').length,
      production: certs.filter(c => c.production).length,
      avgScore: certs.length ? Math.round(certs.reduce((a,c)=>a+c.score,0)/certs.length) : 0,
      gold: certs.filter(c => c.level === 'gold').length,
      silver: certs.filter(c => c.level === 'silver').length,
      bronze: certs.filter(c => c.level === 'bronze').length
    },
    levels: [
      { id:'gold', name:'Gold', minScore:95, description:'Parceiro com homologação completa, produção ativa e alta taxa de sucesso.' },
      { id:'silver', name:'Silver', minScore:85, description:'Parceiro aprovado com operação estável.' },
      { id:'bronze', name:'Bronze', minScore:70, description:'Parceiro em evolução com integração validada.' }
    ],
    checklist: ['Cadastro aprovado','API Key Sandbox ativa','Catálogo validado','Estoque e preço validados','Pedido validado','NF-e, XML e DANFE validados','Rastreio validado','Webhook HMAC validado','Homologação 100%','Produção liberada'],
    certificates: certs.sort((a,b)=>b.score-a.score).slice(0,100)
  };
}

app.get('/api/enterprise/certification/overview', async (req, res) => {
  try { return res.json(await buildEnterpriseCertificationOverview(req.query.period || '30d')); }
  catch (error) { console.error('certification overview error', error); return res.status(500).json({ ok:false, error:'Erro ao gerar Central de Certificação' }); }
});
app.get('/api/enterprise/certification/certificates', async (req, res) => {
  const data = await buildEnterpriseCertificationOverview(req.query.period || '30d');
  return res.json({ ok:true, generatedAt:data.generatedAt, certificates:data.certificates });
});
app.get('/api/enterprise/certification/certificates/:id', async (req, res) => {
  const data = await buildEnterpriseCertificationOverview('365d');
  const id = String(req.params.id || '').toLowerCase();
  const cert = data.certificates.find(c => String(c.id).toLowerCase() === id || String(c.certificateId).toLowerCase() === id);
  if (!cert) return res.status(404).json({ ok:false, error:'Certificado não encontrado' });
  return res.json({ ok:true, certificate:cert, checklist:data.checklist, levels:data.levels });
});
app.get('/api/enterprise/certification/export', async (req, res) => {
  const data = await buildEnterpriseCertificationOverview(req.query.period || '30d');
  const format = String(req.query.format || 'json').toLowerCase();
  if (format === 'csv') {
    const rows = [['fabricante','status','nivel','score','sucesso','homologacao','producao','certificado']].concat(data.certificates.map(c => [c.manufacturer,c.status,c.level,c.score,c.successRate,c.homologation,c.production,c.certificateId]));
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition','attachment; filename="ariana-enterprise-certificacoes.csv"');
    return res.send(rows.map(r => r.map(v => '"'+String(v ?? '').replace(/"/g,'""')+'"').join(',')).join('\n'));
  }
  res.setHeader('Content-Disposition','attachment; filename="ariana-enterprise-certificacoes.json"');
  return res.json(data);
});




}
