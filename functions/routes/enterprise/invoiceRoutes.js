// ============================================================
// ENTERPRISE INVOICE ROUTES - ARIANA MÓVEIS
// NF-e, XML e DANFE com isolamento Sandbox/Produção.
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
    IntegrationAuditLog,
    ensureArray
  } = context;

  function enterpriseEnvironment(partner = {}) {
    return String(partner.environment || 'sandbox').trim().toLowerCase() === 'production' ? 'production' : 'sandbox';
  }

  async function enterpriseAuditInvoiceEvidence(eventType, order = {}, req = {}, message = '', metadata = {}) {
    const partner = req.enterprisePartner || req.enterprisePortal || {};
    return IntegrationAuditLog?.create({
      scope: 'enterprise',
      eventType,
      orderId: String(order._id || ''),
      manufacturer: partner.requestId || partner.id || order.manufacturer || '',
      integrationId: String(partner.id || partner.partnerId || ''),
      status: 'success',
      statusCode: 200,
      message,
      metadata: {
        source: 'api_enterprise_invoice',
        environment: enterpriseEnvironment(partner),
        requestId: partner.requestId || '',
        ...metadata
      }
    }).catch(() => null);
  }

  app.post('/api/enterprise/orders/:orderId/invoice', enterpriseCompatAuth, async (req, res) => {
    try {
      const partner = req.enterprisePartner || req.enterprisePortal || {};
      const order = await enterpriseCompatFindOrder(req.params.orderId, partner);
      if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para anexar NF-e' });

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
        environment: enterpriseEnvironment(partner),
        invoice,
        invoiceReceivedAt: new Date()
      };
      order.status = 'enterprise_nfe_recebida';
      order.statusLabel = 'NF-e recebida';
      order.status_integracao = 'invoice_received';
      await order.save();

      if (invoice.number && invoice.accessKey) {
        await enterpriseAuditInvoiceEvidence('enterprise_invoice_received', order, req, 'NF-e recebida com número e chave de acesso', {
          invoiceNumber: invoice.number,
          invoiceKey: invoice.accessKey
        });
      }

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
        order.manufacturerDispatch = {
          ...(order.manufacturerDispatch || {}),
          invoiceBillingWarning: billingError.message || 'Faturamento não registrado automaticamente'
        };
        await order.save();
      }

      return res.json({ ok: true, action: 'invoice_received', orderId: String(order._id), status: order.status, invoice: order.manufacturerDispatch.invoice, billing });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message || 'Erro ao anexar NF-e' });
    }
  });

  async function enterpriseFindInvoiceDocument(orderId, partner = {}) {
    const order = await enterpriseCompatFindOrder(orderId, partner);
    if (!order) return { order: null, invoice: null, billing: null };

    const id = String(order._id || '').trim();
    const environment = enterpriseEnvironment(partner);
    const billingRecord = await EnterpriseBillingRecord.findOne({ orderId: id, environment }).sort({ updatedAt: -1 });
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
    return String(invoice.danfeUrl || invoice.danfeURL || invoice.pdfUrl || invoice.invoiceUrl || billing?.danfeUrl || billing?.pdfUrl || '').trim();
  }

  function enterpriseResolveXmlContent(invoice = {}, billing = {}) {
    return String(
      invoice.xml || invoice.Xml || invoice.xmlContent || invoice.raw?.Xml || invoice.raw?.xml ||
      billing?.payload?.invoice?.xml || billing?.payload?.invoice?.Xml || ''
    ).trim();
  }

  app.get('/api/enterprise/orders/:orderId/xml', enterpriseCompatAuth, async (req, res) => {
    try {
      const partner = req.enterprisePartner || req.enterprisePortal || {};
      const { order, invoice, billing } = await enterpriseFindInvoiceDocument(req.params.orderId, partner);
      if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para baixar XML' });
      const xmlUrl = enterpriseResolveDocumentUrl('xml', invoice, billing);
      const xmlContent = enterpriseResolveXmlContent(invoice, billing);
      if (!xmlUrl && !xmlContent) return res.status(404).json({ ok: false, error: 'XML ainda não foi gerado para este pedido' });

      await enterpriseAuditInvoiceEvidence('enterprise_xml_verified', order, req, 'XML da NF-e validado e disponível no ambiente correto', {
        invoiceNumber: invoice.number || billing?.invoiceNumber || '', invoiceKey: invoice.accessKey || billing?.invoiceKey || ''
      });

      if (xmlUrl && (String(req.query.download || '').toLowerCase() === '1' || String(req.query.redirect || '').toLowerCase() === 'true')) return res.redirect(xmlUrl);
      if (xmlContent && (String(req.query.raw || '').toLowerCase() === '1' || String(req.query.download || '').toLowerCase() === '1')) {
        const fileName = `nfe-${invoice.number || billing?.invoiceNumber || String(order._id).slice(-8)}.xml`;
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        return res.send(xmlContent);
      }
      return res.json({
        ok: true, orderId: String(order._id), type: 'xml', environment: enterpriseEnvironment(partner), url: xmlUrl, downloadUrl: xmlUrl,
        xml: xmlContent, hasInlineXml: Boolean(xmlContent), status: order.status,
        invoiceNumber: invoice.number || billing?.invoiceNumber || '', invoiceKey: invoice.accessKey || billing?.invoiceKey || ''
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao baixar XML Enterprise' });
    }
  });

  app.get('/api/enterprise/orders/:orderId/danfe', enterpriseCompatAuth, async (req, res) => {
    try {
      const partner = req.enterprisePartner || req.enterprisePortal || {};
      const { order, invoice, billing } = await enterpriseFindInvoiceDocument(req.params.orderId, partner);
      if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para baixar DANFE' });
      const danfeUrl = enterpriseResolveDocumentUrl('danfe', invoice, billing);
      if (!danfeUrl) return res.status(404).json({ ok: false, error: 'DANFE ainda não foi gerado para este pedido' });

      await enterpriseAuditInvoiceEvidence('enterprise_danfe_verified', order, req, 'DANFE validado e disponível no ambiente correto', {
        invoiceNumber: invoice.number || billing?.invoiceNumber || '', invoiceKey: invoice.accessKey || billing?.invoiceKey || ''
      });

      if (String(req.query.download || '').toLowerCase() === '1' || String(req.query.redirect || '').toLowerCase() === 'true') return res.redirect(danfeUrl);
      return res.json({
        ok: true, orderId: String(order._id), type: 'danfe', environment: enterpriseEnvironment(partner), url: danfeUrl, downloadUrl: danfeUrl,
        status: order.status, invoiceNumber: invoice.number || billing?.invoiceNumber || '', invoiceKey: invoice.accessKey || billing?.invoiceKey || ''
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
      const partner = req.enterprisePartner || req.enterprisePortal || {};
      const order = await enterpriseCompatFindOrder(orderId, partner);
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
      order.manufacturerDispatch = { ...(order.manufacturerDispatch || {}), environment: enterpriseEnvironment(partner), invoice, invoiceReceivedAt: new Date() };
      order.status = 'enterprise_nfe_recebida';
      order.statusLabel = 'NF-e recebida';
      order.status_integracao = 'invoice_received';
      await order.save();
      if (String(invoice.number || invoice.invoiceNumber || '').trim() && String(invoice.accessKey || invoice.invoiceKey || invoice.key || '').trim()) {
        await enterpriseAuditInvoiceEvidence('enterprise_invoice_received', order, req, 'NF-e recebida com número e chave de acesso', {
          invoiceNumber: String(invoice.number || invoice.invoiceNumber || '').trim(),
          invoiceKey: String(invoice.accessKey || invoice.invoiceKey || invoice.key || '').trim()
        });
      }
      return res.json({ ok: true, action: 'invoice_received', orderId: String(order._id), status: order.status, invoice, order: enterpriseNormalizeOrderForResponse(order) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao anexar NF-e Enterprise' });
    }
  });

  app.get('/api/enterprise/orders/:orderId/invoice', enterpriseCompatAuth, async (req, res) => {
    try {
      const partner = req.enterprisePartner || req.enterprisePortal || {};
      const { order, invoice, billing } = await enterpriseFindInvoiceDocument(req.params.orderId, partner);
      if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para consultar NF-e' });
      return res.json({
        ok: true, orderId: String(order._id), environment: enterpriseEnvironment(partner), status: order.status, invoice: invoice || null, billing: billing || null,
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
      const partner = req.enterprisePartner || req.enterprisePortal || {};
      const environment = enterpriseEnvironment(partner);
      const partnerIds = [partner.requestId, partner.partnerId, partner.id, partner.companyName, partner.tradeName].map((v) => String(v || '').trim()).filter(Boolean);
      const partnerFilter = partnerIds.length
        ? { environment, $or: [{ partnerRequestId: { $in: partnerIds } }, { manufacturer: { $in: partnerIds } }] }
        : { _id: null };
      const rows = await EnterpriseBillingRecord.find(partnerFilter).sort({ updatedAt: -1, createdAt: -1 }).limit(limit).lean().catch(() => []);
      return res.json({ ok: true, environment, total: rows.length, invoices: rows.map((row) => enterpriseBillingNormalizeResponse(row)) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar NF-e Enterprise' });
    }
  });
}
