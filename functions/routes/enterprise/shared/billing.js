// ============================================================
// ENTERPRISE SHARED - BILLING
// Funções compartilhadas de faturamento Enterprise.
// Extraído de routes/enterpriseRoutes.js sem alterar regras ou respostas.
// ============================================================

export function createEnterpriseBilling(context = {}) {
  const {
    DEFAULT_CURRENCY,
    EnterpriseBillingRecord,
    IntegrationAuditLog,
    normalizeObjectId,
    redact,
    toJSON
  } = context;

  function enterpriseBillingNormalizePayload(input = {}, order = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const invoice = source.billing || source.invoice || source.nfe || source.nf || source;
    const issuedAtRaw = invoice.issuedAt || invoice.emittedAt || invoice.issueDate || invoice.dataEmissao || invoice.emissao || source.issuedAt;
    const issuedAt = issuedAtRaw ? new Date(issuedAtRaw) : new Date();
    const amountRaw = invoice.amount ?? invoice.value ?? invoice.valor ?? invoice.total ?? invoice.totalAmount ?? source.amount ?? order.total ?? 0;
    const amount = Number(String(amountRaw).replace(/R\\$/gi, '').replace(/\s+/g, '').replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '')) || 0;

    return {
      status: String(invoice.status || source.status || 'billed').trim() || 'billed',
      invoiceNumber: String(invoice.invoiceNumber || invoice.number || invoice.numero || invoice.nfNumber || invoice.notaNumero || '').trim(),
      serie: String(invoice.serie || invoice.series || invoice.série || invoice.nfSerie || '').trim(),
      invoiceKey: String(invoice.invoiceKey || invoice.accessKey || invoice.key || invoice.chave || invoice.chaveNfe || invoice.chaveNF || '').trim(),
      amount,
      currency: String(invoice.currency || source.currency || order.currency || DEFAULT_CURRENCY || 'BRL').trim() || 'BRL',
      issuedAt: Number.isNaN(issuedAt.getTime()) ? new Date() : issuedAt,
      xmlUrl: String(invoice.xmlUrl || invoice.xmlURL || source.xmlUrl || '').trim(),
      danfeUrl: String(invoice.danfeUrl || invoice.danfeURL || invoice.pdfUrl || invoice.invoiceUrl || source.danfeUrl || '').trim(),
      pdfUrl: String(invoice.pdfUrl || invoice.danfeUrl || invoice.invoiceUrl || source.pdfUrl || '').trim(),
      protocol: String(invoice.protocol || invoice.protocolo || invoice.sefazProtocol || invoice.protocoloSefaz || '').trim(),
      raw: redact(source || {})
    };
  }

  function enterpriseBillingNormalizeResponse(record = {}) {
    const obj = toJSON(record) || {};
    return {
      id: String(obj.id || obj._id || ''),
      orderId: String(obj.orderId || ''),
      manufacturer: String(obj.manufacturer || ''),
      partnerRequestId: String(obj.partnerRequestId || ''),
      environment: String(obj.environment || 'sandbox'),
      status: String(obj.status || ''),
      invoiceNumber: String(obj.invoiceNumber || ''),
      serie: String(obj.serie || ''),
      invoiceKey: String(obj.invoiceKey || ''),
      amount: Number(obj.amount || 0),
      currency: String(obj.currency || DEFAULT_CURRENCY || 'BRL'),
      issuedAt: obj.issuedAt || null,
      xmlUrl: String(obj.xmlUrl || ''),
      danfeUrl: String(obj.danfeUrl || ''),
      pdfUrl: String(obj.pdfUrl || ''),
      protocol: String(obj.protocol || ''),
      cancelledAt: obj.cancelledAt || null,
      cancelReason: String(obj.cancelReason || ''),
      history: Array.isArray(obj.history) ? obj.history : [],
      createdAt: obj.createdAt || null,
      updatedAt: obj.updatedAt || null
    };
  }

  async function enterpriseBillingUpsert(order, payload, req, action = 'billing_registered') {
    const orderId = String(order._id || order.id || '').trim();
    const normalized = enterpriseBillingNormalizePayload(payload, order);
    if (!normalized.invoiceNumber && !normalized.invoiceKey) {
      const err = new Error('Informe invoiceNumber/number ou invoiceKey/accessKey para registrar o faturamento');
      err.statusCode = 400;
      throw err;
    }

    const partner = req.enterprisePartner || {};
    const manufacturer = String(order.manufacturer || order.manufacturerDispatch?.payload?.manufacturer || partner.requestId || partner.companyName || '').trim();
    const historyEntry = {
      action,
      status: normalized.status,
      at: new Date(),
      by: partner.requestId || partner.companyName || req.auth?.email || 'enterprise_api',
      payload: normalized.raw
    };

    const existing = await EnterpriseBillingRecord.findOne({ orderId }).sort({ updatedAt: -1 });
    let record;
    if (existing) {
      existing.set({
        orderObjectId: normalizeObjectId(orderId),
        manufacturer,
        partnerRequestId: String(partner.requestId || '').trim(),
        environment: String(partner.environment || 'sandbox').trim() || 'sandbox',
        status: normalized.status,
        invoiceNumber: normalized.invoiceNumber,
        serie: normalized.serie,
        invoiceKey: normalized.invoiceKey,
        amount: normalized.amount,
        currency: normalized.currency,
        issuedAt: normalized.issuedAt,
        xmlUrl: normalized.xmlUrl || existing.xmlUrl || '',
        danfeUrl: normalized.danfeUrl || existing.danfeUrl || '',
        pdfUrl: normalized.pdfUrl || existing.pdfUrl || '',
        protocol: normalized.protocol,
        payload: normalized.raw,
        history: [...(Array.isArray(existing.history) ? existing.history : []), historyEntry].slice(-100)
      });
      record = await existing.save();
    } else {
      record = await EnterpriseBillingRecord.create({
        orderId,
        orderObjectId: normalizeObjectId(orderId),
        manufacturer,
        partnerRequestId: String(partner.requestId || '').trim(),
        environment: String(partner.environment || 'sandbox').trim() || 'sandbox',
        status: normalized.status,
        invoiceNumber: normalized.invoiceNumber,
        serie: normalized.serie,
        invoiceKey: normalized.invoiceKey,
        amount: normalized.amount,
        currency: normalized.currency,
        issuedAt: normalized.issuedAt,
        xmlUrl: normalized.xmlUrl,
        danfeUrl: normalized.danfeUrl,
        pdfUrl: normalized.pdfUrl,
        protocol: normalized.protocol,
        payload: normalized.raw,
        history: [historyEntry]
      });
    }

    const billingResponse = enterpriseBillingNormalizeResponse(record);
    const currentDispatch = order.manufacturerDispatch || {};
    const previousHistory = Array.isArray(currentDispatch.billingHistory) ? currentDispatch.billingHistory : [];
    order.manufacturerDispatch = {
      ...currentDispatch,
      billing: billingResponse,
      billingHistory: [...previousHistory, historyEntry].slice(-100),
      billingReceivedAt: new Date(),
      invoice: {
        ...(currentDispatch.invoice || {}),
        number: normalized.invoiceNumber,
        serie: normalized.serie,
        series: normalized.serie,
        key: normalized.invoiceKey,
        accessKey: normalized.invoiceKey,
        total: normalized.amount,
        issuedAt: normalized.issuedAt,
        xmlUrl: normalized.xmlUrl || currentDispatch.invoice?.xmlUrl || '',
        danfeUrl: normalized.danfeUrl || normalized.pdfUrl || currentDispatch.invoice?.danfeUrl || '',
        raw: normalized.raw
      }
    };
    order.status = normalized.status === 'cancelled' ? 'enterprise_faturamento_cancelado' : 'enterprise_faturado';
    order.statusLabel = normalized.status === 'cancelled' ? 'Faturamento cancelado' : 'Pedido faturado';
    order.status_integracao = normalized.status === 'cancelled' ? 'billing_cancelled' : 'billed';
    await order.save();

    await IntegrationAuditLog.create({
      scope: 'enterprise',
      eventType: action,
      orderId,
      manufacturer,
      status: 'success',
      statusCode: 200,
      message: normalized.status === 'cancelled' ? 'Faturamento cancelado via Enterprise' : 'Faturamento registrado via Enterprise',
      request: normalized.raw,
      response: { ok: true, billing: billingResponse },
      metadata: {
        source: 'api_enterprise_billing',
        environment: partner.environment || 'sandbox',
        invoiceNumber: normalized.invoiceNumber,
        invoiceKey: normalized.invoiceKey
      }
    }).catch(() => null);

    return { record, billing: billingResponse, order };
  }

  return {
    enterpriseBillingNormalizePayload,
    enterpriseBillingNormalizeResponse,
    enterpriseBillingUpsert
  };
}
