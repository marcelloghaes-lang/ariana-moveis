export function createSigeInvoicePersistenceService(deps = {}) {
  const {
    enterpriseBillingUpsert
  } = deps;

async function saveSigeInvoiceOnEnterpriseOrder(order, invoiceData = {}, req = null, eventType = 'sige_nfe_synced') {
  const invoice = {
    number: String(invoiceData.number || invoiceData.invoiceNumber || '').trim(),
    series: String(invoiceData.series || invoiceData.serie || '').trim(),
    accessKey: String(invoiceData.accessKey || invoiceData.invoiceKey || '').trim(),
    xmlUrl: String(invoiceData.xmlUrl || '').trim(),
    xml: String(invoiceData.xml || invoiceData.Xml || invoiceData.xmlContent || '').trim(),
    xmlContent: String(invoiceData.xmlContent || invoiceData.xml || invoiceData.Xml || '').trim(),
    danfeUrl: String(invoiceData.danfeUrl || invoiceData.pdfUrl || '').trim(),
    pdfUrl: String(invoiceData.pdfUrl || invoiceData.danfeUrl || '').trim(),
    total: invoiceData.total ?? invoiceData.amount ?? order.total ?? 0,
    issuedAt: invoiceData.issuedAt || invoiceData.emittedAt || invoiceData.issueDate || new Date(),
    protocol: String(invoiceData.protocol || '').trim(),
    status: String(invoiceData.status || '').trim(),
    provider: 'sige_cloud',
    raw: invoiceData.raw || invoiceData
  };

  const publicNfe = {
    numero: invoice.number,
    codigo: invoice.number,
    number: invoice.number,
    serie: invoice.series,
    series: invoice.series,
    chave: invoice.accessKey,
    chaveAcesso: invoice.accessKey,
    accessKey: invoice.accessKey,
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
    provider: invoice.provider,
    raw: invoice.raw
  };

  order.manufacturerDispatch = {
    ...(order.manufacturerDispatch || {}),
    invoice: {
      ...(order.manufacturerDispatch?.invoice || {}),
      ...invoice
    },
    sigeInvoice: invoice,
    invoiceReceivedAt: new Date(),
    sigeSyncedAt: new Date()
  };

  // Campos diretos para as telas do Admin/Cliente/Seller encontrarem a NF-e sem depender de manufacturerDispatch.
  order.nfe = { ...(order.nfe || {}), ...publicNfe };
  order.notaFiscal = { ...(order.notaFiscal || {}), ...publicNfe };
  order.fiscal = { ...(order.fiscal || {}), nfe: { ...((order.fiscal || {}).nfe || {}), ...publicNfe } };
  order.sige = { ...(order.sige || {}), nfe: { ...((order.sige || {}).nfe || {}), ...publicNfe }, nfeSyncedAt: new Date() };

  // NÃ£o altera mais o status pÃºblico do pedido (ex.: Em Transporte/Entregue); sÃ³ marca a integraÃ§Ã£o fiscal.
  order.status_integracao = 'sige_invoice_synced';
  await order.save();

  let billing = null;
  try {
    const result = await enterpriseBillingUpsert(order, {
      invoiceNumber: invoice.number,
      serie: invoice.series,
      invoiceKey: invoice.accessKey,
      amount: invoice.total,
      issuedAt: invoice.issuedAt,
      xmlUrl: invoice.xmlUrl,
      danfeUrl: invoice.danfeUrl,
      pdfUrl: invoice.pdfUrl,
      protocol: invoice.protocol,
      invoice
    }, req || { enterprisePartner: null, body: {} }, eventType);
    billing = result.billing;
  } catch (error) {
    order.manufacturerDispatch = {
      ...(order.manufacturerDispatch || {}),
      sigeBillingWarning: error.message || 'Faturamento Enterprise nÃ£o registrado automaticamente'
    };
    await order.save();
  }

  return { order, invoice, billing };
}

  return {
    saveSigeInvoiceOnEnterpriseOrder
  };
}
