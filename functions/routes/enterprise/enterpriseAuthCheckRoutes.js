// ============================================================
// ENTERPRISE AUTH CHECK ROUTES
// Extraído de routes/enterpriseRoutes.js sem alterar endpoints, regras ou respostas.
// ============================================================

export default function registerEnterpriseAuthCheckRoutes(app, context = {}) {
  const { enterpriseCompatAuth } = context;

app.get('/api/enterprise/auth/check', enterpriseCompatAuth, async (req, res) => {
  return res.json({
    ok: true,
    valid: true,
    environment: req.enterprisePartner?.environment || 'sandbox',
    partner: {
      requestId: req.enterprisePartner?.requestId || '',
      companyName: req.enterprisePartner?.companyName || '',
      tradeName: req.enterprisePartner?.tradeName || '',
      status: req.enterprisePartner?.status || '',
      permissions: req.enterprisePartner?.permissions || []
    }
  });
});
}
