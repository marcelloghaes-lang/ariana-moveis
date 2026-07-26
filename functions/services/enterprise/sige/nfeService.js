export function createSigeNfeService(deps = {}) {
  const {
    SIGE_API_URL,
    SIGE_TIMEOUT_MS,
    axios,
    isSigeConfigured,
    sigeAuthHeaders,
    ensureArray,
    toJSON,
    arianaSigeOnlyDigits
  } = deps;

// SIGE CLOUD -> NF-e ENTERPRISE / XML / DANFE
// MÃ³dulo incremental: consulta/emissÃ£o de NF-e no SIGE Cloud e
// grava nÃºmero, sÃ©rie, chave, XML e DANFE no pedido Enterprise.
// NÃ£o altera rotas antigas nem apaga dados existentes.
// ============================================================

function sigeNfeEndpoint(name, fallback) {
  return String(process.env[name] || fallback || '').replace(/^\/+/, '').trim();
}

async function sigeRequest(method = 'GET', endpoint = '', { params = {}, data = null } = {}) {
  if (!isSigeConfigured()) {
    const err = new Error('SIGE nÃ£o configurado. Configure SIGE_API_URL, SIGE_USER, SIGE_APP e SIGE_TOKEN no Render.');
    err.statusCode = 500;
    throw err;
  }

  const cleanEndpoint = String(endpoint || '').replace(/^\/+/, '');
  const url = `${SIGE_API_URL}/request/${cleanEndpoint}`;
  const response = await axios({
    method,
    url,
    headers: {
      ...sigeAuthHeaders(),
      'Content-Type': 'application/json'
    },
    params,
    data,
    timeout: SIGE_TIMEOUT_MS,
    validateStatus: () => true
  });

  if (response.status < 200 || response.status >= 300) {
    const err = new Error(typeof response.data === 'string' ? response.data : `Erro SIGE HTTP ${response.status}`);
    err.statusCode = response.status;
    err.responseData = response.data;
    throw err;
  }

  return response.data;
}

function sigeStringifySafe(value) {
  try {
    return JSON.stringify(value || {});
  } catch (_error) {
    return String(value || '');
  }
}

function sigeFindFirstStringDeep(input, predicate, maxDepth = 8) {
  const seen = new Set();

  function walk(value, depth) {
    if (depth > maxDepth || value === null || value === undefined) return '';
    if (typeof value === 'string' || typeof value === 'number') {
      const str = String(value).trim();
      return predicate(str) ? str : '';
    }
    if (typeof value !== 'object') return '';
    if (seen.has(value)) return '';
    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        const found = walk(item, depth + 1);
        if (found) return found;
      }
      return '';
    }

    for (const [key, val] of Object.entries(value)) {
      const k = String(key || '').toLowerCase();
      if (typeof val === 'string' || typeof val === 'number') {
        const str = String(val).trim();
        if (predicate(str, k)) return str;
      }
    }
    for (const val of Object.values(value)) {
      const found = walk(val, depth + 1);
      if (found) return found;
    }
    return '';
  }

  return walk(input, 0);
}

function sigeFindByKeyDeep(input, keyMatchers = [], maxDepth = 8) {
  const matchers = keyMatchers.map((item) => String(item || '').toLowerCase());
  const seen = new Set();

  function walk(value, depth) {
    if (depth > maxDepth || value === null || value === undefined || typeof value !== 'object') return '';
    if (seen.has(value)) return '';
    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        const found = walk(item, depth + 1);
        if (found) return found;
      }
      return '';
    }

    for (const [key, val] of Object.entries(value)) {
      const k = String(key || '').toLowerCase();
      if (matchers.some((m) => k === m || k.includes(m))) {
        if (val !== null && val !== undefined && typeof val !== 'object') {
          const str = String(val).trim();
          if (str) return str;
        }
      }
    }

    for (const val of Object.values(value)) {
      const found = walk(val, depth + 1);
      if (found) return found;
    }
    return '';
  }

  return walk(input, 0);
}

function sigeExtractInvoicePayload(raw = {}, fallback = {}) {
  const rawText = sigeStringifySafe(raw);
  const direct = raw?.invoice || raw?.nfe || raw?.notaFiscal || raw?.NotaFiscal || raw?.data || raw?.Dados || raw || {};

  const accessKey =
    String(fallback.accessKey || fallback.invoiceKey || '').trim() ||
    sigeFindByKeyDeep(direct, ['accessKey', 'invoiceKey', 'chavenfe', 'chaveacesso', 'chave', 'chaveNFe']) ||
    (rawText.match(/\b\d{44}\b/) || [''])[0];

  const xmlUrl =
    String(fallback.xmlUrl || '').trim() ||
    sigeFindByKeyDeep(direct, ['xmlUrl', 'urlXml', 'linkXml', 'downloadXml', 'arquivoXml']) ||
    sigeFindFirstStringDeep(direct, (str, key = '') => {
      const s = str.toLowerCase();
      const k = String(key || '').toLowerCase();
      return (k.includes('xml') && /^https?:\/\//i.test(str)) || (/^https?:\/\//i.test(str) && s.includes('.xml'));
    });

  const danfeUrl =
    String(fallback.danfeUrl || fallback.pdfUrl || '').trim() ||
    sigeFindByKeyDeep(direct, ['danfeUrl', 'urlDanfe', 'linkDanfe', 'downloadDanfe', 'pdfUrl', 'urlPdf', 'linkPdf', 'arquivoPdf']) ||
    sigeFindFirstStringDeep(direct, (str, key = '') => {
      const s = str.toLowerCase();
      const k = String(key || '').toLowerCase();
      return ((k.includes('danfe') || k.includes('pdf')) && /^https?:\/\//i.test(str)) || (/^https?:\/\//i.test(str) && s.includes('.pdf'));
    });

  const number =
    String(fallback.number || fallback.invoiceNumber || '').trim() ||
    sigeFindByKeyDeep(direct, ['numero', 'number', 'invoiceNumber', 'numeroNota', 'numeroNFe', 'nNF']);

  const series =
    String(fallback.series || fallback.serie || '').trim() ||
    sigeFindByKeyDeep(direct, ['serie', 'series', 'serieNota', 'serieNFe']);

  const protocol =
    String(fallback.protocol || '').trim() ||
    sigeFindByKeyDeep(direct, ['protocolo', 'protocol', 'nProt']);

  const status =
    String(fallback.status || '').trim() ||
    sigeFindByKeyDeep(direct, ['status', 'situacao', 'situacaoNota']);

  const xmlContent =
    String(fallback.xml || fallback.Xml || fallback.xmlContent || '').trim() ||
    sigeFindByKeyDeep(direct, ['xml', 'Xml', 'XML', 'xmlContent', 'conteudoXml']) ||
    '';

  return {
    number,
    series,
    accessKey,
    xmlUrl,
    xml: xmlContent,
    xmlContent,
    danfeUrl,
    pdfUrl: danfeUrl,
    protocol,
    status,
    raw
  };
}

function buildSigeNfePayloadFromOrder(order = {}, body = {}) {
  const orderObj = toJSON(order) || order || {};
  const explicit = body && typeof body === 'object' ? (body.sigePayload || body.payload || body) : {};

  // Se o usuÃ¡rio mandar um payload pronto do SIGE, respeita e apenas complementa metadados Ãºteis.
  if (explicit && typeof explicit === 'object' && (explicit.Cliente || explicit.Itens || explicit.Items || explicit.Pessoa || explicit.Empresa)) {
    return explicit;
  }

  const items = ensureArray(orderObj.items).map((item) => ({
    Codigo: item.sku || item.productId || '',
    Descricao: item.name || item.sku || 'Produto Ariana',
    Quantidade: Number(item.qty || item.quantity || 1),
    ValorUnitario: Number(item.unitPrice || item.price || 0)
  }));

  return {
    Origem: 'Ariana Enterprise',
    PedidoArianaId: String(orderObj._id || orderObj.id || ''),
    CodigoPedidoExterno: String(orderObj.manufacturerDispatch?.externalOrderId || orderObj.status_integracao || ''),
    Cliente: {
      Nome: orderObj.customerName || explicit.customerName || '',
      Email: orderObj.customerEmail || explicit.customerEmail || '',
      Telefone: orderObj.customerPhone || explicit.customerPhone || '',
      Endereco: orderObj.shippingAddress || {}
    },
    Itens: items,
    Total: Number(orderObj.total || orderObj.subtotal || 0),
    Observacoes: explicit.observacoes || explicit.notes || 'NF-e gerada a partir do mÃ³dulo Ariana Enterprise'
  };
}

function arianaSigeExtractVendaNumero(value = '') {
  if (value === undefined || value === null) return '';
  let text = '';
  if (typeof value === 'string') {
    text = value.trim();
    // O SIGE costuma responder como texto, Ã s vezes serializado: "PEDIDO 1700 SALVO COM SUCESSO!".
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed === 'string') text = parsed;
      else if (parsed && typeof parsed === 'object') text = JSON.stringify(parsed);
    } catch (_error) {}
  } else {
    try { text = JSON.stringify(value); } catch (_error) { text = String(value || ''); }
  }
  text = String(text || '').replace(/^"|"$/g, '').trim();
  const match = text.match(/PEDIDO\s+(\d+)\s+SALVO/i) ||
    text.match(/PEDIDO[^0-9]{0,30}(\d{2,})/i) ||
    text.match(/VENDA[^0-9]{0,30}(\d{2,})/i) ||
    text.match(/(\d{2,})/);
  return match ? String(match[1]).trim() : '';
}

function arianaSigeResolveCodigoVendaFromOrder(order = {}, body = {}) {
  const dispatch = order?.manufacturerDispatch || {};
  const sale = dispatch.sigeSale || dispatch.sigeVenda || dispatch.venda || {};
  const candidates = [
    body?.CodigoVenda,
    body?.codigoVenda,
    body?.sigePedidoNumero,
    body?.pedidoSige,
    dispatch.sigePedidoNumero,
    dispatch.sigePedidoCodigo,
    dispatch.codigoVenda,
    dispatch.externalOrderId,
    sale.codigo,
    sale.Codigo,
    sale.numero,
    sale.pedido,
    sale.pedidoNumero,
    sale.sigePedidoNumero,
    arianaSigeExtractVendaNumero(sale.raw),
    arianaSigeExtractVendaNumero(sale.response),
    arianaSigeExtractVendaNumero(dispatch?.sigeResponse),
    arianaSigeExtractVendaNumero(dispatch?.raw),
    arianaSigeExtractVendaNumero(dispatch?.response)
  ];
  for (const value of candidates) {
    const only = String(value || '').replace(/\D/g, '').trim();
    if (only) return only;
  }
  return '';
}

async function arianaSigeBackfillVendaNumeroOnOrder(order, rawFallback = null) {
  if (!order) return { order, codigoVenda: '', updated: false };
  const dispatch = order.manufacturerDispatch || {};
  const sale = dispatch.sigeSale || dispatch.sigeVenda || {};
  const codigoVenda = arianaSigeResolveCodigoVendaFromOrder(order, {}) ||
    arianaSigeExtractVendaNumero(rawFallback) ||
    arianaSigeExtractVendaNumero(sale.raw) ||
    arianaSigeExtractVendaNumero(dispatch.raw);

  if (!codigoVenda) return { order, codigoVenda: '', updated: false };

  const already = String(dispatch.sigePedidoNumero || dispatch.sigePedidoCodigo || dispatch.codigoVenda || '').trim();
  if (already === codigoVenda && String(dispatch.externalOrderId || '').trim() === codigoVenda) {
    return { order, codigoVenda, updated: false };
  }

  order.manufacturerDispatch = {
    ...dispatch,
    externalOrderId: codigoVenda,
    codigoVenda,
    sigePedidoNumero: codigoVenda,
    sigePedidoCodigo: codigoVenda,
    sigeSale: {
      ...(dispatch.sigeSale || {}),
      codigo: (dispatch.sigeSale || {}).codigo || codigoVenda,
      numero: (dispatch.sigeSale || {}).numero || codigoVenda,
      pedidoNumero: (dispatch.sigeSale || {}).pedidoNumero || codigoVenda,
      sigePedidoNumero: codigoVenda,
      raw: (dispatch.sigeSale || {}).raw || rawFallback || null
    },
    sigeVenda: {
      ...(dispatch.sigeVenda || {}),
      codigo: (dispatch.sigeVenda || {}).codigo || codigoVenda,
      numero: (dispatch.sigeVenda || {}).numero || codigoVenda,
      pedidoNumero: (dispatch.sigeVenda || {}).pedidoNumero || codigoVenda,
      sigePedidoNumero: codigoVenda,
      raw: (dispatch.sigeVenda || {}).raw || rawFallback || null
    },
    sigeVendaNumeroBackfilledAt: new Date()
  };
  if (!order.status_integracao) order.status_integracao = 'sige_sale_created';
  await order.save();
  return { order, codigoVenda, updated: true };
}

function arianaSigeResolveCnpjEmitente(body = {}) {
  return arianaSigeOnlyDigits(
    body?.CNPJEmpresaEmissora ||
    body?.cnpjEmpresaEmissora ||
    body?.cnpj ||
    process.env.SIGE_EMPRESA_CNPJ ||
    process.env.COMPANY_CNPJ ||
    process.env.CNPJ_EMPRESA ||
    '48126915000174'
  );
}

function arianaSigeResolveNfeParamsFromOrder(order = {}, query = {}) {
  const invoice = order?.manufacturerDispatch?.sigeInvoice || order?.manufacturerDispatch?.invoice || {};
  const codigoNfe = String(query.CodigoNFe || query.codigoNFe || query.codigo || query.numero || query.nfe || invoice.number || invoice.numero || '').replace(/\D/g, '').trim();
  const serieNfe = String(query.SerieNFe || query.serieNFe || query.serie || query.series || invoice.series || invoice.serie || '1').trim();
  const cnpj = arianaSigeResolveCnpjEmitente(query);
  return { CodigoNFe: codigoNfe, SerieNFe: serieNfe || '1', CNPJEmpresaEmissora: cnpj };
}

function arianaSigeExtractNfeFromConsultarResponse(raw = {}, fallback = {}) {
  const extracted = sigeExtractInvoicePayload(raw, {
    number: fallback.CodigoNFe || fallback.codigo || fallback.numero || '',
    series: fallback.SerieNFe || fallback.serie || '1',
    ...fallback
  });

  const rawText = typeof raw === 'string' ? raw : sigeStringifySafe(raw);
  const keyFromText = String(extracted.accessKey || '').trim() || ((rawText.match(/\b\d{44}\b/) || [])[0] || '');
  const protocolFromText = String(extracted.protocol || '').trim() || ((rawText.match(/\b\d{15}\b/) || [])[0] || '');

  return {
    ...extracted,
    accessKey: keyFromText,
    protocol: protocolFromText,
    number: String(extracted.number || fallback.CodigoNFe || fallback.codigo || '').trim(),
    series: String(extracted.series || fallback.SerieNFe || fallback.serie || '1').trim(),
    raw
  };
}

async function emitirSigeNfePorVenda(order, body = {}) {
  await arianaSigeBackfillVendaNumeroOnOrder(order);
  const codigoVenda = arianaSigeResolveCodigoVendaFromOrder(order, body);
  if (!codigoVenda) {
    const err = new Error('NÃ£o encontrei o CÃ³digoVenda do SIGE no pedido. Sincronize a venda primeiro ou informe codigoVenda no body.');
    err.statusCode = 400;
    throw err;
  }
  const endpoint = sigeNfeEndpoint('SIGE_NFE_EMIT_ENDPOINT', 'Fiscal/EmitirNFE');
  const raw = await sigeRequest('POST', endpoint, { params: { CodigoVenda: codigoVenda } });
  const invoice = arianaSigeExtractNfeFromConsultarResponse(raw, { codigoVenda });
  return { codigoVenda, endpoint, raw, invoice };
}

async function consultarSigeNfeFiscal(order, query = {}) {
  const params = arianaSigeResolveNfeParamsFromOrder(order, query);
  if (!params.CodigoNFe) {
    const err = new Error('Informe o nÃºmero da NF-e em codigo/numero ou salve a NF-e no pedido antes da consulta.');
    err.statusCode = 400;
    throw err;
  }
  if (!params.SerieNFe) params.SerieNFe = '1';
  if (!params.CNPJEmpresaEmissora) {
    const err = new Error('CNPJ da empresa emissora ausente. Configure SIGE_EMPRESA_CNPJ no Render ou envie cnpjEmpresaEmissora.');
    err.statusCode = 400;
    throw err;
  }
  const endpoint = sigeNfeEndpoint('SIGE_NFE_CONSULT_ENDPOINT', 'Fiscal/ConsultarNFE');
  const raw = await sigeRequest('GET', endpoint, { params });
  const invoice = arianaSigeExtractNfeFromConsultarResponse(raw, params);
  return { endpoint, params, raw, invoice };
}

async function searchSigeInvoiceForOrder(order, query = {}) {
  // PreferÃªncia: endpoint fiscal oficial encontrado no Swagger.
  if (query?.CodigoNFe || query?.codigoNFe || query?.codigo || query?.numero || order?.manufacturerDispatch?.invoice?.number || order?.manufacturerDispatch?.sigeInvoice?.number) {
    return await consultarSigeNfeFiscal(order, query);
  }

  // Fallback antigo para contas que possuem pesquisa fiscal por lista.
  const endpoint = sigeNfeEndpoint('SIGE_NFE_SEARCH_ENDPOINT', 'NotasFiscais/Pesquisar');
  const orderObj = toJSON(order) || order || {};
  const params = {
    ...query,
    codigoPedido: query.codigoPedido || query.orderId || String(orderObj.manufacturerDispatch?.externalOrderId || orderObj.status_integracao || orderObj._id || '')
  };

  const data = await sigeRequest('GET', endpoint, { params });
  const rows = Array.isArray(data) ? data : ensureArray(data?.items || data?.Itens || data?.data || data?.Dados || data);
  const first = rows[0] || data;
  return { raw: data, invoice: sigeExtractInvoicePayload(first || data, query), endpoint, params };
}

  return {
    sigeNfeEndpoint,
    sigeRequest,
    sigeStringifySafe,
    sigeFindFirstStringDeep,
    sigeFindByKeyDeep,
    sigeExtractInvoicePayload,
    buildSigeNfePayloadFromOrder,
    arianaSigeExtractVendaNumero,
    arianaSigeResolveCodigoVendaFromOrder,
    arianaSigeBackfillVendaNumeroOnOrder,
    arianaSigeResolveCnpjEmitente,
    arianaSigeResolveNfeParamsFromOrder,
    arianaSigeExtractNfeFromConsultarResponse,
    emitirSigeNfePorVenda,
    consultarSigeNfeFiscal,
    searchSigeInvoiceForOrder
  };
}
