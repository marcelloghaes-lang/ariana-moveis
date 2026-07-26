// ============================================================
// ENTERPRISE INVOICE ROUTES - ARIANA MÓVEIS
// Extraído de routes/enterpriseRoutes.js sem alterar endpoints, regras ou respostas.
// ============================================================

export default function registerEnterpriseInvoiceRoutes(app, context = {}) {
  const {
    enterpriseCompatAuth,
    enterpriseOrderOperationAuth,
    enterpriseCompatFindOrder,
    enterpriseBillingUpsert,
    enterpriseBillingNormalizeResponse,
    enterpriseNormalizeOrderForResponse,
    EnterpriseBillingRecord,
    ensureArray
  } = context;

app.post('/api/enterprise/orders/:orderId/invoice', enterpriseCompatAuth, async (req, res) => {
  try {
    const order = await enterpriseCompatFindOrder(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para anexar NF-e' });

    // Normaliza a NF-e recebida do parceiro/fabricante.
    // Aceita tanto payload direto quanto dentro de invoice/nfe/nf/billing.
    const source = req.body && typeof req.body === 'object' ? req.body : {};
    const invoiceInput = source.invoice || source.nfe || source.nf || source.billing || source;
    const invoice = {
      number: String(invoiceInput.number || invoiceInput.invoiceNumber || invoiceInput.numero || '').trim(),
      series: String(invoiceInput.series || invoiceInput.serie || invoiceInput.série || '').trim(),
      accessKey: String(invoiceInput.accessKey || invoiceInput.invoiceKey || invoiceInput.key || invoiceInput.chave || invoiceInput.chaveNfe || '').trim(),
      xmlUrl: String(invoiceInput.xmlUrl || invoiceInput.xmlURL || source.xmlUrl || '').trim(),
      danfeUrl: String(invoiceInput.danfeUrl || invoiceInput.danfeURL || invoiceInput.pdfUrl || invoiceInput.invoiceUrl || source.danfeUrl || source.pdfUrl || '').trim(),
      pdfUrl: String(invoiceInput.pdfUrl || invoiceInput.danfeUrl || invoiceInput.invoiceUrl || source.pdfUrl || '').trim(),
      total: invoiceInput.total ?? invoiceInput.amount ?? order.total ?? 0,
      issuedAt: invoiceInput.issuedAt || invoiceInput.emittedAt || invoiceInput.issueDate || new Date(),
      raw: source
    };

    order.manufacturerDispatch = {
      ...(order.manufacturerDispatch || {}),
      invoice,
      invoiceReceivedAt: new Date()
    };
    order.status = 'enterprise_nfe_recebida';
    order.statusLabel = 'NF-e recebida';
    order.status_integracao = 'invoice_received';
    await order.save();

    // Também registra/atualiza o faturamento Enterprise para liberar XML/DANFE
    // nos endpoints GET /xml e GET /danfe.
    let billing = null;
    try {
      const billingResult = await enterpriseBillingUpsert(order, {
        invoiceNumber: invoice.number,
        serie: invoice.series,
        invoiceKey: invoice.accessKey,
        amount: invoice.total,
        issuedAt: invoice.issuedAt,
        xmlUrl: invoice.xmlUrl,
        danfeUrl: invoice.danfeUrl,
        pdfUrl: invoice.pdfUrl,
        invoice
      }, req, 'enterprise_invoice_received');
      billing = billingResult.billing;
    } catch (billingError) {
      // Não quebra o recebimento da NF-e se faltar número/chave, mas registra o motivo.
      order.manufacturerDispatch = {
        ...(order.manufacturerDispatch || {}),
        invoiceBillingWarning: billingError.message || 'Faturamento não registrado automaticamente'
      };
      await order.save();
    }

    return res.json({
      ok: true,
      action: 'invoice_received',
      orderId: String(order._id),
      status: order.status,
      invoice: order.manufacturerDispatch.invoice,
      billing
    });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message || 'Erro ao anexar NF-e' });
  }
});

async function enterpriseFindInvoiceDocument(orderId) {
  const order = await enterpriseCompatFindOrder(orderId);
  if (!order) return { order: null, invoice: null, billing: null };

  const id = String(order._id || '').trim();
  const billingRecord = await EnterpriseBillingRecord.findOne({ orderId: id }).sort({ updatedAt: -1 });
  const billing = billingRecord ? enterpriseBillingNormalizeResponse(billingRecord) : (order.manufacturerDispatch?.billing || null);
  const approvedSellerInvoice = ensureArray(order.sellerInvoices).find((i) => String(i.status || '').toLowerCase() === 'aprovada') || null;
  const approvedEnterpriseInvoice = ensureArray(order.enterpriseInvoices).find((i) => String(i.status || '').toLowerCase() === 'aprovada') || null;
  const directInvoice = order.nfe || order.notaFiscal || order.fiscal?.nfe || null;
  const invoice = order.manufacturerDispatch?.invoice || directInvoice || approvedSellerInvoice || approvedEnterpriseInvoice || {};

  return { order, invoice, billing };
}

function enterpriseResolveDocumentUrl(kind, invoice = {}, billing = {}) {
  if (kind === 'xml') {
    const candidate = String(invoice.xmlUrl || invoice.xmlURL || billing?.xmlUrl || '').trim();
    return candidate.startsWith('<') ? '' : candidate;
  }
  return String(
    invoice.danfeUrl || invoice.danfeURL || invoice.pdfUrl || invoice.invoiceUrl ||
    billing?.danfeUrl || billing?.pdfUrl || ''
  ).trim();
}

function enterpriseResolveXmlContent(invoice = {}, billing = {}) {
  return String(
    invoice.xml ||
    invoice.Xml ||
    invoice.xmlContent ||
    invoice.raw?.Xml ||
    invoice.raw?.xml ||
    billing?.payload?.invoice?.xml ||
    billing?.payload?.invoice?.Xml ||
    ''
  ).trim();
}

app.get('/api/enterprise/orders/:orderId/xml', enterpriseCompatAuth, async (req, res) => {
  try {
    const { order, invoice, billing } = await enterpriseFindInvoiceDocument(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para baixar XML' });

    const xmlUrl = enterpriseResolveDocumentUrl('xml', invoice, billing);
    const xmlContent = enterpriseResolveXmlContent(invoice, billing);
    if (!xmlUrl && !xmlContent) return res.status(404).json({ ok: false, error: 'XML ainda não foi gerado para este pedido' });

    if (xmlUrl && (String(req.query.download || '').toLowerCase() === '1' || String(req.query.redirect || '').toLowerCase() === 'true')) {
      return res.redirect(xmlUrl);
    }

    if (xmlContent && (String(req.query.raw || '').toLowerCase() === '1' || String(req.query.download || '').toLowerCase() === '1')) {
      const fileName = `nfe-${invoice.number || billing?.invoiceNumber || String(order._id).slice(-8)}.xml`;
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      return res.send(xmlContent);
    }

    return res.json({
      ok: true,
      orderId: String(order._id),
      type: 'xml',
      url: xmlUrl,
      downloadUrl: xmlUrl,
      xml: xmlContent,
      hasInlineXml: Boolean(xmlContent),
      status: order.status,
      invoiceNumber: invoice.number || billing?.invoiceNumber || '',
      invoiceKey: invoice.accessKey || billing?.invoiceKey || ''
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao baixar XML Enterprise' });
  }
});

app.get('/api/enterprise/orders/:orderId/danfe', enterpriseCompatAuth, async (req, res) => {
  try {
    const { order, invoice, billing } = await enterpriseFindInvoiceDocument(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para baixar DANFE' });

    const danfeUrl = enterpriseResolveDocumentUrl('danfe', invoice, billing);
    if (!danfeUrl) return res.status(404).json({ ok: false, error: 'DANFE ainda não foi gerado para este pedido' });

    if (String(req.query.download || '').toLowerCase() === '1' || String(req.query.redirect || '').toLowerCase() === 'true') {
      return res.redirect(danfeUrl);
    }

    return res.json({
      ok: true,
      orderId: String(order._id),
      type: 'danfe',
      url: danfeUrl,
      downloadUrl: danfeUrl,
      status: order.status,
      invoiceNumber: invoice.number || billing?.invoiceNumber || '',
      invoiceKey: invoice.accessKey || billing?.invoiceKey || ''
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao baixar DANFE Enterprise' });
  }
});


app.post('/api/enterprise/invoice', enterpriseOrderOperationAuth, async (req, res) => {
  const orderId = String(req.body?.orderId || req.body?.id || req.body?.externalOrderId || '').trim();
  if (!orderId) return res.status(400).json({ ok: false, error: 'orderId obrigatório' });
  req.params.orderId = orderId;

  try {
    const order = await enterpriseCompatFindOrder(orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para anexar NF-e' });

    const invoice = req.body?.invoice || {
      number: req.body?.number || req.body?.invoiceNumber || '',
      series: req.body?.series || req.body?.serie || '',
      accessKey: req.body?.accessKey || req.body?.invoiceKey || req.body?.key || '',
      xmlUrl: req.body?.xmlUrl || '',
      danfeUrl: req.body?.danfeUrl || req.body?.pdfUrl || req.body?.invoiceUrl || '',
      total: req.body?.total ?? order.total ?? 0,
      raw: req.body || {}
    };

    order.manufacturerDispatch = { ...(order.manufacturerDispatch || {}), invoice, invoiceReceivedAt: new Date() };
    order.status = 'enterprise_nfe_recebida';
    order.statusLabel = 'NF-e recebida';
    order.status_integracao = 'invoice_received';
    await order.save();

    return res.json({ ok: true, action: 'invoice_received', orderId: String(order._id), status: order.status, invoice, order: enterpriseNormalizeOrderForResponse(order) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao anexar NF-e Enterprise' });
  }
});



// ============================================================
// ALIASES DE HOMOLOGAÇÃO / COMPATIBILIDADE ENTERPRISE
// Mantém endpoints existentes e adiciona consultas GET usadas nos testes.
// ============================================================
app.get('/api/enterprise/orders/:orderId/invoice', enterpriseCompatAuth, async (req, res) => {
  try {
    const { order, invoice, billing } = await enterpriseFindInvoiceDocument(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para consultar NF-e' });

    return res.json({
      ok: true,
      orderId: String(order._id),
      status: order.status,
      invoice: invoice || null,
      billing: billing || null,
      hasInvoice: Boolean(invoice && Object.keys(invoice).length),
      hasXml: Boolean(enterpriseResolveDocumentUrl('xml', invoice, billing) || enterpriseResolveXmlContent(invoice, billing)),
      hasDanfe: Boolean(enterpriseResolveDocumentUrl('danfe', invoice, billing))
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao consultar NF-e Enterprise' });
  }
});

app.get('/api/enterprise/orders/:orderId/nfe', enterpriseCompatAuth, async (req, res) => {
  req.url = `/api/enterprise/orders/${encodeURIComponent(req.params.orderId)}/invoice`;
  return app.handle(req, res);
});

app.get('/api/enterprise/invoices', enterpriseOrderOperationAuth, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const rows = await EnterpriseBillingRecord.find({}).sort({ updatedAt: -1, createdAt: -1 }).limit(limit).lean().catch(() => []);
    return res.json({
      ok: true,
      total: rows.length,
      invoices: rows.map((row) => enterpriseBillingNormalizeResponse(row))
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar NF-e Enterprise' });
  }
});

}
