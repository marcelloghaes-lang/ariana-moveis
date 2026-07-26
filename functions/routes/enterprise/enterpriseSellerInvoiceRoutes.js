// ============================================================
// ENTERPRISE SELLER / EXTERNAL INVOICE ROUTES
// Extraído de routes/enterpriseRoutes.js sem alterar endpoints, regras ou respostas.
// Mantém NF-e de sellers, parceiros Enterprise, atalhos Admin e atalhos Cliente.
// ============================================================

export default function registerEnterpriseSellerInvoiceRoutes(app, context = {}) {
  const {
    Order,
    EnterpriseBillingRecord,
    IntegrationAuditLog,
    DEFAULT_CURRENCY,
    axios,
    crypto,
    fs,
    path,
    uploadsDir,
    upload,
    adminRequired,
    sellerAuthRequired,
    authRequired,
    enterpriseCompatAuth,
    enterpriseOrderOperationAuth,
    enterpriseCompatFindOrder,
    enterpriseNormalizeOrderForResponse,
    enterpriseBillingUpsert,
    enterpriseBillingNormalizeResponse,
    ensureArray,
    toJSON,
    redact,
    normalizeObjectId,
    sanitizeIdPart,
    buildPublicFileUrl,
    extractSellerIdsFromOrder,
    createAdminNotification,
    enterpriseFindInvoiceDocument,
    enterpriseResolveDocumentUrl,
    enterpriseResolveXmlContent
  } = context;

// NF-e DE SELLERS / FABRICANTES EXTERNOS
// Permite que sellers e parceiros Enterprise enviem a NF-e emitida
// no ERP deles. A Ariana apenas armazena, audita e vincula ao pedido.
// ============================================================
function arianaInvoiceEnsureDir() {
  const dir = path.join(uploadsDir, 'invoices');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function arianaPublicInvoiceUrl(req, filename = '') {
  const clean = String(filename || '').replace(/^\/+/, '');
  return buildPublicFileUrl(req, `invoices/${clean}`);
}

function arianaInvoiceId(prefix = 'inv') {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
}

function arianaSafeInvoiceExt(original = '', fallback = '') {
  const ext = path.extname(String(original || '')).toLowerCase();
  if (['.xml', '.pdf', '.html', '.htm'].includes(ext)) return ext;
  return fallback || '.bin';
}

async function arianaSaveInvoiceUpload(req, file, prefix, fallbackExt) {
  if (!file) return null;
  const dir = arianaInvoiceEnsureDir();
  const ext = arianaSafeInvoiceExt(file.originalname || file.filename || '', fallbackExt);
  const filename = `${sanitizeIdPart(prefix || 'nfe')}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
  const dest = path.join(dir, filename);
  if (file.path && fs.existsSync(file.path)) fs.renameSync(file.path, dest);
  else if (file.buffer) fs.writeFileSync(dest, file.buffer);
  else return null;
  return {
    filename,
    path: dest,
    url: arianaPublicInvoiceUrl(req, filename),
    originalName: file.originalname || filename,
    mimeType: file.mimetype || '',
    size: file.size || 0
  };
}

function arianaNormalizeExternalInvoice(input = {}, actor = {}) {
  const src = input.invoice || input.nfe || input.notaFiscal || input;
  const numero = String(src.numero || src.number || src.codigoNfe || src.codigoNFe || src.CodigoNFe || src.invoiceNumber || '').trim();
  const serie = String(src.serie || src.series || src.serieNfe || src.serieNFe || src.SerieNFe || '1').trim();
  const chave = String(src.chave || src.chaveAcesso || src.accessKey || src.invoiceKey || src.chaveNfe || '').replace(/\D/g, '').trim();
  const cnpjEmitente = String(src.cnpjEmitente || src.cnpjEmpresaEmissora || src.CNPJEmpresaEmissora || src.cnpj || actor.cnpj || '').replace(/\D/g, '').trim();
  const emitente = String(src.emitente || src.sellerName || actor.name || actor.sellerName || '').trim();
  return {
    invoiceId: String(src.invoiceId || src.id || '').trim() || arianaInvoiceId(actor.prefix || 'seller_nfe'),
    source: String(actor.source || src.source || 'seller').trim(),
    status: String(src.status || actor.status || 'enviada').trim(),
    numero,
    number: numero,
    codigo: numero,
    serie,
    series: serie,
    chave,
    chaveAcesso: chave,
    accessKey: chave,
    cnpjEmitente,
    emitente,
    sellerId: String(actor.sellerId || src.sellerId || '').trim(),
    manufacturer: String(actor.manufacturer || src.manufacturer || '').trim(),
    xmlUrl: String(src.xmlUrl || src.xmlURL || '').trim(),
    danfeUrl: String(src.danfeUrl || src.pdfUrl || src.invoiceUrl || '').trim(),
    pdfUrl: String(src.pdfUrl || src.danfeUrl || src.invoiceUrl || '').trim(),
    xml: String(src.xml || src.Xml || src.xmlContent || '').trim(),
    xmlContent: String(src.xmlContent || src.xml || src.Xml || '').trim(),
    protocol: String(src.protocol || src.protocolo || '').trim(),
    issuedAt: src.issuedAt || src.emitidaEm || src.dataEmissao || new Date(),
    uploadedAt: new Date(),
    approvedAt: src.approvedAt || null,
    rejectedAt: src.rejectedAt || null,
    rejectionReason: String(src.rejectionReason || '').trim(),
    raw: src.raw || src
  };
}

function arianaOrderHasSeller(order = {}, sellerId = '') {
  const sid = String(sellerId || '').trim();
  if (!sid) return false;
  return extractSellerIdsFromOrder(order).includes(sid);
}

async function arianaSaveExternalInvoiceOnOrder(order, invoiceInput = {}, req = null, actor = {}) {
  const invoice = arianaNormalizeExternalInvoice(invoiceInput, actor);
  const xmlFile = invoiceInput.xmlFile || null;
  const danfeFile = invoiceInput.danfeFile || null;
  if (xmlFile?.url) invoice.xmlUrl = xmlFile.url;
  if (danfeFile?.url) {
    invoice.danfeUrl = danfeFile.url;
    invoice.pdfUrl = danfeFile.url;
  }
  if (!invoice.numero && !invoice.chave && !invoice.xmlUrl && !invoice.xml && !invoice.danfeUrl) {
    const err = new Error('Informe nÃºmero/chave da NF-e ou envie XML/DANFE.');
    err.statusCode = 400;
    throw err;
  }
  const listKey = actor.source === 'enterprise' ? 'enterpriseInvoices' : 'sellerInvoices';
  const current = ensureArray(order[listKey]);
  const idx = current.findIndex((item) => String(item.invoiceId || '') === String(invoice.invoiceId || ''));
  if (idx >= 0) current[idx] = { ...current[idx], ...invoice };
  else current.push(invoice);
  order[listKey] = current;

  order.manufacturerDispatch = {
    ...(order.manufacturerDispatch || {}),
    externalInvoices: ensureArray(order.manufacturerDispatch?.externalInvoices).filter((i) => String(i.invoiceId || '') !== String(invoice.invoiceId)).concat(invoice),
    lastExternalInvoiceAt: new Date()
  };

  if (invoice.status === 'aprovada') {
    const publicNfe = {
      numero: invoice.numero,
      codigo: invoice.numero,
      number: invoice.numero,
      serie: invoice.serie,
      series: invoice.serie,
      chave: invoice.chave,
      chaveAcesso: invoice.chave,
      accessKey: invoice.chave,
      protocolo: invoice.protocol,
      protocol: invoice.protocol,
      status: invoice.status,
      xmlUrl: invoice.xmlUrl,
      xml: invoice.xml,
      xmlContent: invoice.xmlContent,
      danfeUrl: invoice.danfeUrl,
      pdfUrl: invoice.pdfUrl,
      emitidaEm: invoice.issuedAt,
      issuedAt: invoice.issuedAt,
      provider: invoice.source,
      sellerId: invoice.sellerId,
      manufacturer: invoice.manufacturer,
      emitente: invoice.emitente,
      invoiceId: invoice.invoiceId,
      raw: invoice.raw
    };
    order.nfe = { ...(order.nfe || {}), ...publicNfe };
    order.notaFiscal = { ...(order.notaFiscal || {}), ...publicNfe };
    order.fiscal = { ...(order.fiscal || {}), nfe: { ...((order.fiscal || {}).nfe || {}), ...publicNfe } };
  }

  order.status_integracao = invoice.status === 'aprovada' ? 'seller_invoice_approved' : 'seller_invoice_received';
  await order.save();
  return { order, invoice };
}

async function arianaProxyRemoteFile(res, url, filename, preferredContentType = '') {
  const target = String(url || '').trim();
  if (!target) return res.status(404).json({ ok: false, error: 'Arquivo nÃ£o disponÃ­vel' });
  if (/^https?:\/\//i.test(target)) {
    try {
      const upstream = await axios.get(target, { responseType: 'arraybuffer', timeout: 30000, headers: { Accept: preferredContentType || '*/*' } });
      const contentType = String(upstream.headers['content-type'] || preferredContentType || 'application/octet-stream');
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(Buffer.from(upstream.data));
    } catch (error) {
      return res.redirect(target);
    }
  }
  return res.redirect(target);
}

app.post('/api/seller/orders/:id/nfe', sellerAuthRequired, upload.fields([{ name: 'xml', maxCount: 1 }, { name: 'danfe', maxCount: 1 }, { name: 'pdf', maxCount: 1 }]), async (req, res) => {
  try {
    const oid = normalizeObjectId(req.params.id);
    if (!oid) return res.status(400).json({ ok: false, error: 'ID invÃ¡lido' });
    const order = await Order.findById(oid);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado' });
    const sid = String(req.sellerId || '').trim();
    if (!arianaOrderHasSeller(toJSON(order), sid)) return res.status(403).json({ ok: false, error: 'Sem permissÃ£o para enviar NF-e deste pedido' });

    const prefix = `seller-${sid}-${String(order._id).slice(-8)}`;
    const xmlFile = await arianaSaveInvoiceUpload(req, req.files?.xml?.[0], `${prefix}-xml`, '.xml');
    const danfeFile = await arianaSaveInvoiceUpload(req, req.files?.danfe?.[0] || req.files?.pdf?.[0], `${prefix}-danfe`, '.pdf');
    const saved = await arianaSaveExternalInvoiceOnOrder(order, { ...(req.body || {}), xmlFile, danfeFile }, req, {
      source: 'seller',
      prefix: 'seller_nfe',
      sellerId: sid,
      name: req.seller?.storeName || req.seller?.displayName || sid,
      cnpj: req.seller?.document || req.seller?.metadata?.cnpj || '',
      status: 'enviada'
    });

    await createAdminNotification({
      type: 'seller_invoice_received',
      title: 'NF-e enviada pelo seller',
      message: `Seller ${req.seller?.storeName || req.seller?.displayName || sid} enviou NF-e do pedido ${order._id}.`,
      relatedId: String(order._id),
      severity: 'success',
      metadata: { sellerId: sid, invoiceId: saved.invoice.invoiceId }
    });

    return res.json({ ok: true, action: 'seller_nfe_received', orderId: String(saved.order._id), invoice: saved.invoice, order: toJSON(saved.order) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao enviar NF-e do seller' });
  }
});

app.get('/api/seller/orders/:id/nfe', sellerAuthRequired, async (req, res) => {
  try {
    const oid = normalizeObjectId(req.params.id);
    if (!oid) return res.status(400).json({ ok: false, error: 'ID invÃ¡lido' });
    const order = await Order.findById(oid);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado' });
    const sid = String(req.sellerId || '').trim();
    if (!arianaOrderHasSeller(toJSON(order), sid)) return res.status(403).json({ ok: false, error: 'Sem permissÃ£o para consultar NF-e deste pedido' });
    const invoices = ensureArray(order.sellerInvoices).filter((i) => String(i.sellerId || '') === sid);
    return res.json({ ok: true, orderId: String(order._id), invoices });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao consultar NF-e do seller' });
  }
});

app.post('/api/admin/orders/:orderId/seller-invoices/:invoiceId/approve', adminRequired, async (req, res) => {
  try {
    const order = await enterpriseCompatFindOrder(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado' });
    const invoiceId = String(req.params.invoiceId || '').trim();
    const list = ensureArray(order.sellerInvoices).map((i) => String(i.invoiceId || '') === invoiceId ? { ...i, status: 'aprovada', approvedAt: new Date(), approvedBy: req.admin?.email || req.admin?.id || 'admin' } : i);
    const invoice = list.find((i) => String(i.invoiceId || '') === invoiceId);
    if (!invoice) return res.status(404).json({ ok: false, error: 'NF-e do seller nÃ£o encontrada' });
    order.sellerInvoices = list;
    const saved = await arianaSaveExternalInvoiceOnOrder(order, invoice, req, { source: 'seller', status: 'aprovada', sellerId: invoice.sellerId, prefix: 'seller_nfe' });
    return res.json({ ok: true, action: 'seller_invoice_approved', orderId: String(saved.order._id), invoice: saved.invoice, order: toJSON(saved.order) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao aprovar NF-e do seller' });
  }
});

app.post('/api/admin/orders/:orderId/seller-invoices/:invoiceId/reject', adminRequired, async (req, res) => {
  try {
    const order = await enterpriseCompatFindOrder(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado' });
    const invoiceId = String(req.params.invoiceId || '').trim();
    const reason = String(req.body?.reason || req.body?.motivo || '').trim();
    const list = ensureArray(order.sellerInvoices).map((i) => String(i.invoiceId || '') === invoiceId ? { ...i, status: 'reprovada', rejectedAt: new Date(), rejectionReason: reason } : i);
    order.sellerInvoices = list;
    await order.save();
    return res.json({ ok: true, action: 'seller_invoice_rejected', orderId: String(order._id), invoices: list });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao reprovar NF-e do seller' });
  }
});

app.post('/api/enterprise/orders/:orderId/nfe', enterpriseCompatAuth, upload.fields([{ name: 'xml', maxCount: 1 }, { name: 'danfe', maxCount: 1 }, { name: 'pdf', maxCount: 1 }]), async (req, res) => {
  try {
    const order = await enterpriseCompatFindOrder(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado' });
    const manufacturer = String(req.enterprisePartner?.manufacturer || req.body?.manufacturer || order.manufacturer || '').trim();
    const prefix = `enterprise-${manufacturer || 'partner'}-${String(order._id).slice(-8)}`;
    const xmlFile = await arianaSaveInvoiceUpload(req, req.files?.xml?.[0], `${prefix}-xml`, '.xml');
    const danfeFile = await arianaSaveInvoiceUpload(req, req.files?.danfe?.[0] || req.files?.pdf?.[0], `${prefix}-danfe`, '.pdf');
    const saved = await arianaSaveExternalInvoiceOnOrder(order, { ...(req.body || {}), xmlFile, danfeFile }, req, {
      source: 'enterprise',
      prefix: 'enterprise_nfe',
      manufacturer,
      status: 'enviada'
    });
    await createAdminNotification({ type: 'enterprise_invoice_received', title: 'NF-e enviada pelo parceiro Enterprise', message: `Parceiro ${manufacturer || 'Enterprise'} enviou NF-e do pedido ${order._id}.`, relatedId: String(order._id), severity: 'success', metadata: { manufacturer, invoiceId: saved.invoice.invoiceId } });
    return res.json({ ok: true, action: 'enterprise_nfe_received', orderId: String(saved.order._id), invoice: saved.invoice });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao receber NF-e Enterprise' });
  }
});


// Atalhos Admin para baixar XML/DANFE da NF-e salva no pedido.
// Ãštil para o painel administrativo da Ariana MÃ³veis.
app.get('/api/admin/orders/:orderId/nfe/xml', adminRequired, async (req, res) => {
  try {
    const { order, invoice, billing } = await enterpriseFindInvoiceDocument(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado para baixar XML' });

    const xmlUrl = enterpriseResolveDocumentUrl('xml', invoice, billing);
    const xmlContent = enterpriseResolveXmlContent(invoice, billing);
    if (!xmlUrl && !xmlContent) return res.status(404).json({ ok: false, error: 'XML ainda nÃ£o foi salvo para este pedido' });

    if (xmlUrl && String(req.query.redirect || '').toLowerCase() === 'true') return res.redirect(xmlUrl);

    if (xmlContent) {
      const fileName = `nfe-${invoice.number || billing?.invoiceNumber || String(order._id).slice(-8)}.xml`;
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      return res.send(xmlContent);
    }

    return res.json({ ok: true, orderId: String(order._id), type: 'xml', url: xmlUrl, downloadUrl: xmlUrl });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao baixar XML da NF-e' });
  }
});

app.get('/api/admin/orders/:orderId/nfe/danfe', adminRequired, async (req, res) => {
  try {
    const { order, invoice, billing } = await enterpriseFindInvoiceDocument(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado para baixar DANFE' });

    const danfeUrl = enterpriseResolveDocumentUrl('danfe', invoice, billing);
    if (!danfeUrl) return res.status(404).json({ ok: false, error: 'DANFE ainda nÃ£o foi salvo para este pedido' });

    if (String(req.query.redirect || '').toLowerCase() === 'true' || String(req.query.download || '').toLowerCase() === '1') {
      return res.redirect(danfeUrl);
    }

    return arianaProxyRemoteFile(res, danfeUrl, `danfe-${invoice.number || billing?.invoiceNumber || String(order._id).slice(-8)}.pdf`, 'application/pdf');
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao baixar DANFE da NF-e' });
  }
});


// ============================================================
// NF-e no painel Admin e no detalhe do pedido do cliente
// Exibe metadados da nota e disponibiliza XML/DANFE salvos no pedido.
// Admin usa adminRequired; cliente usa authRequired e sÃ³ acessa o prÃ³prio pedido.
// ============================================================
function arianaNfeBuildPublicInfo(order, invoice = {}, billing = {}) {
  const xmlUrl = enterpriseResolveDocumentUrl('xml', invoice, billing);
  const xmlContent = enterpriseResolveXmlContent(invoice, billing);
  const danfeUrl = enterpriseResolveDocumentUrl('danfe', invoice, billing);
  const orderId = String(order?._id || '');
  const number = String(invoice?.number || billing?.invoiceNumber || '').trim();
  const series = String(invoice?.series || invoice?.serie || billing?.serie || '').trim();
  const accessKey = String(invoice?.accessKey || invoice?.invoiceKey || billing?.invoiceKey || '').trim();
  const protocol = String(invoice?.protocol || billing?.protocol || '').trim();
  const status = String(invoice?.status || billing?.status || '').trim();

  return {
    exists: Boolean(number || accessKey || protocol || xmlUrl || xmlContent || danfeUrl),
    number,
    series,
    accessKey,
    protocol,
    status,
    issuedAt: invoice?.issuedAt || billing?.issuedAt || null,
    provider: invoice?.provider || 'sige_cloud',
    hasXml: Boolean(xmlUrl || xmlContent),
    hasDanfe: Boolean(danfeUrl),
    xmlUrl: xmlUrl || '',
    danfeUrl: danfeUrl || '',
    admin: orderId ? {
      consultar: `/api/admin/sige/orders/${orderId}/nfe`,
      xml: `/api/admin/orders/${orderId}/nfe/xml`,
      danfe: `/api/admin/orders/${orderId}/nfe/danfe`
    } : null,
    customer: orderId ? {
      consultar: `/api/orders/${orderId}/nfe`,
      xml: `/api/orders/${orderId}/xml`,
      danfe: `/api/orders/${orderId}/danfe`,
      xmlCompleto: `/api/orders/${orderId}/nfe/xml`,
      danfeCompleto: `/api/orders/${orderId}/nfe/danfe`
    } : null
  };
}

function arianaUserCanAccessOrderNfe(req, order) {
  if (!req?.user || !order) return false;
  const role = String(req.user.role || req.auth?.role || '').toLowerCase();
  if (role === 'admin' || req.auth?.admin === true) return true;

  const userId = String(req.user._id || req.user.id || req.auth?.id || '').trim();
  const orderUserId = String(order.userId || '').trim();
  if (userId && orderUserId && userId === orderUserId) return true;

  const userEmail = String(req.user.email || req.auth?.email || '').trim().toLowerCase();
  const orderEmail = String(order.customerEmail || '').trim().toLowerCase();
  return Boolean(userEmail && orderEmail && userEmail === orderEmail);
}

app.get('/api/admin/orders/:orderId/nfe', adminRequired, async (req, res) => {
  try {
    const { order, invoice, billing } = await enterpriseFindInvoiceDocument(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado para consultar NF-e' });
    const nfe = arianaNfeBuildPublicInfo(order, invoice, billing);
    return res.json({ ok: true, orderId: String(order._id), nfe, invoice, billing });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao consultar NF-e do pedido' });
  }
});

// Atalhos mais simples para o painel Admin.
app.get('/api/admin/orders/:orderId/xml', adminRequired, async (req, res) => {
  try {
    const { order, invoice, billing } = await enterpriseFindInvoiceDocument(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado para baixar XML' });

    const xmlUrl = enterpriseResolveDocumentUrl('xml', invoice, billing);
    const xmlContent = enterpriseResolveXmlContent(invoice, billing);
    if (!xmlUrl && !xmlContent) return res.status(404).json({ ok: false, error: 'XML ainda nÃ£o foi salvo para este pedido' });

    if (xmlUrl && String(req.query.redirect || '').toLowerCase() === 'true') return res.redirect(xmlUrl);

    if (xmlContent) {
      const fileName = `nfe-${invoice.number || billing?.invoiceNumber || String(order._id).slice(-8)}.xml`;
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      return res.send(xmlContent);
    }

    return res.json({ ok: true, orderId: String(order._id), type: 'xml', url: xmlUrl, downloadUrl: xmlUrl });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao baixar XML da NF-e' });
  }
});

app.get('/api/admin/orders/:orderId/danfe', adminRequired, async (req, res) => {
  try {
    const { order, invoice, billing } = await enterpriseFindInvoiceDocument(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado para baixar DANFE' });

    const danfeUrl = enterpriseResolveDocumentUrl('danfe', invoice, billing);
    if (!danfeUrl) return res.status(404).json({ ok: false, error: 'DANFE ainda nÃ£o foi salvo para este pedido' });

    if (String(req.query.redirect || '').toLowerCase() === 'true' || String(req.query.download || '').toLowerCase() === '1') {
      return res.redirect(danfeUrl);
    }

    return arianaProxyRemoteFile(res, danfeUrl, `danfe-${invoice.number || billing?.invoiceNumber || String(order._id).slice(-8)}.pdf`, 'application/pdf');
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao baixar DANFE da NF-e' });
  }
});

app.get('/api/orders/:orderId/nfe', authRequired, async (req, res) => {
  try {
    const { order, invoice, billing } = await enterpriseFindInvoiceDocument(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado para consultar NF-e' });
    if (!arianaUserCanAccessOrderNfe(req, order)) return res.status(403).json({ ok: false, error: 'VocÃª nÃ£o tem acesso Ã  NF-e deste pedido' });

    const nfe = arianaNfeBuildPublicInfo(order, invoice, billing);
    return res.json({ ok: true, orderId: String(order._id), nfe });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao consultar NF-e do pedido' });
  }
});

app.get('/api/orders/:orderId/nfe/xml', authRequired, async (req, res) => {
  try {
    const { order, invoice, billing } = await enterpriseFindInvoiceDocument(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado para baixar XML' });
    if (!arianaUserCanAccessOrderNfe(req, order)) return res.status(403).json({ ok: false, error: 'VocÃª nÃ£o tem acesso ao XML deste pedido' });

    const xmlUrl = enterpriseResolveDocumentUrl('xml', invoice, billing);
    const xmlContent = enterpriseResolveXmlContent(invoice, billing);
    if (!xmlUrl && !xmlContent) return res.status(404).json({ ok: false, error: 'XML ainda nÃ£o foi salvo para este pedido' });

    if (xmlUrl && String(req.query.redirect || '').toLowerCase() === 'true') return res.redirect(xmlUrl);

    if (xmlContent) {
      const fileName = `nfe-${invoice.number || billing?.invoiceNumber || String(order._id).slice(-8)}.xml`;
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      return res.send(xmlContent);
    }

    return res.json({ ok: true, orderId: String(order._id), type: 'xml', url: xmlUrl, downloadUrl: xmlUrl });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao baixar XML da NF-e' });
  }
});

app.get('/api/orders/:orderId/nfe/danfe', authRequired, async (req, res) => {
  try {
    const { order, invoice, billing } = await enterpriseFindInvoiceDocument(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado para baixar DANFE' });
    if (!arianaUserCanAccessOrderNfe(req, order)) return res.status(403).json({ ok: false, error: 'VocÃª nÃ£o tem acesso ao DANFE deste pedido' });

    const danfeUrl = enterpriseResolveDocumentUrl('danfe', invoice, billing);
    if (!danfeUrl) return res.status(404).json({ ok: false, error: 'DANFE ainda nÃ£o foi salvo para este pedido' });

    if (String(req.query.redirect || '').toLowerCase() === 'true' || String(req.query.download || '').toLowerCase() === '1') {
      return res.redirect(danfeUrl);
    }

    return arianaProxyRemoteFile(res, danfeUrl, `danfe-${invoice.number || billing?.invoiceNumber || String(order._id).slice(-8)}.pdf`, 'application/pdf');
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao baixar DANFE da NF-e' });
  }
});


// Atalhos compatÃ­veis para a tela antiga do cliente.
// Algumas versÃµes do front chamam /api/orders/:orderId/xml e /api/orders/:orderId/danfe.
// Mantemos esses atalhos apontando para os mesmos dados protegidos por login.
app.get('/api/orders/:orderId/xml', authRequired, async (req, res) => {
  try {
    const { order, invoice, billing } = await enterpriseFindInvoiceDocument(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado para baixar XML' });
    if (!arianaUserCanAccessOrderNfe(req, order)) return res.status(403).json({ ok: false, error: 'VocÃª nÃ£o tem acesso ao XML deste pedido' });

    const xmlUrl = enterpriseResolveDocumentUrl('xml', invoice, billing);
    const xmlContent = enterpriseResolveXmlContent(invoice, billing);
    if (!xmlUrl && !xmlContent) return res.status(404).json({ ok: false, error: 'XML ainda nÃ£o foi salvo para este pedido' });

    if (xmlUrl && String(req.query.redirect || '').toLowerCase() === 'true') return res.redirect(xmlUrl);

    if (xmlContent) {
      const fileName = `nfe-${invoice.number || billing?.invoiceNumber || String(order._id).slice(-8)}.xml`;
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      return res.send(xmlContent);
    }

    return res.json({ ok: true, orderId: String(order._id), type: 'xml', url: xmlUrl, downloadUrl: xmlUrl });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao baixar XML da NF-e' });
  }
});

app.get('/api/orders/:orderId/danfe', authRequired, async (req, res) => {
  try {
    const { order, invoice, billing } = await enterpriseFindInvoiceDocument(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado para baixar DANFE' });
    if (!arianaUserCanAccessOrderNfe(req, order)) return res.status(403).json({ ok: false, error: 'VocÃª nÃ£o tem acesso ao DANFE deste pedido' });

    const danfeUrl = enterpriseResolveDocumentUrl('danfe', invoice, billing);
    if (!danfeUrl) return res.status(404).json({ ok: false, error: 'DANFE ainda nÃ£o foi salvo para este pedido' });

    if (String(req.query.redirect || '').toLowerCase() === 'true' || String(req.query.download || '').toLowerCase() === '1') {
      return res.redirect(danfeUrl);
    }

    return arianaProxyRemoteFile(res, danfeUrl, `danfe-${invoice.number || billing?.invoiceNumber || String(order._id).slice(-8)}.pdf`, 'application/pdf');
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao baixar DANFE da NF-e' });
  }
});
}
