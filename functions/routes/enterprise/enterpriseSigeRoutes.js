import { createSigePayloadService } from '../../services/enterprise/sige/payloadService.js';
import { createSigePessoaService } from '../../services/enterprise/sige/pessoaService.js';
import { createSigeProdutoService } from '../../services/enterprise/sige/produtoService.js';
import { createSigeVendaService } from '../../services/enterprise/sige/vendaService.js';
import { createSigeNfeService } from '../../services/enterprise/sige/nfeService.js';
import { createSigeInvoicePersistenceService } from '../../services/enterprise/sige/invoicePersistenceService.js';

export default function registerEnterpriseSigeRoutes(app, context = {}) {
  const {
    Order,
    IntegrationAuditLog,
    EnterpriseBillingRecord,
    DEFAULT_CURRENCY,
    SIGE_API_URL,
    SIGE_APP,
    SIGE_TOKEN,
    SIGE_USER,
    SIGE_TIMEOUT_MS,
    SIGE_PLANO_CONTA,
    axios,
    crypto,
    mongoose,
    path,
    fs,
    uploadsDir,
    adminRequired,
    enterpriseCompatAuth,
    enterpriseOrderOperationAuth,
    enterpriseCompatFindOrder,
    enterpriseNormalizeOrderForResponse,
    enterpriseBillingUpsert,
    enterpriseBillingNormalizeResponse,
    ensureArray,
    toJSON,
    redact,
    isSigeConfigured,
    sigeAuthHeaders,
    sigeGet
  } = context;

// ============================================================

function arianaSigeOnlyDigits(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function arianaSigeBuildEndereco(address = {}) {
  const a = address && typeof address === 'object' ? address : {};
  return {
    Logradouro: String(a.logradouro || a.rua || a.street || a.address || '').trim(),
    Numero: String(a.numero || a.number || '').trim(),
    Complemento: String(a.complemento || a.complement || '').trim(),
    Bairro: String(a.bairro || a.neighborhood || '').trim(),
    Cidade: String(a.cidade || a.city || '').trim(),
    UF: String(a.uf || a.estado || a.state || '').trim().toUpperCase(),
    CEP: arianaSigeOnlyDigits(a.cep || a.zip || a.postalCode || '')
  };
}

function arianaSigeRawNumber(value = 0) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = String(value ?? '').trim();
  if (!text) return 0;
  const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function arianaSigeMoney(value = 0, referenceTotal = 0) {
  let n = arianaSigeRawNumber(value);
  const ref = arianaSigeRawNumber(referenceTotal);
  if (n > 0 && ref > 0 && n > ref * 3) n = n / 100;
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function arianaSigeFirstValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function arianaSigeIsoDate(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function arianaSigeNormalizePayment(value = '') {
  const text = String(value || '').trim().toLowerCase();
  if (text.includes('boleto')) return 'Boleto BancÃ¡rio';
  if (text.includes('pix')) return 'Pagamento InstantÃ¢neo (PIX)';
  if (text.includes('debito') || text.includes('dÃ©bito')) return 'CartÃ£o de DÃ©bito';
  if (text.includes('cart') || text.includes('credit') || text.includes('crÃ©dito')) return 'CartÃ£o de CrÃ©dito';
  if (text.includes('pagar')) return 'Pagar.me';
  if (text.includes('mercado')) return 'Mercado Pago';
  return String(value || 'Outros').trim() || 'Outros';
}



// ============================================================
// SIGE: somente vendas prÃ³prias da Ariana MÃ³veis
// Pedidos de sellers/fabricantes nÃ£o sÃ£o enviados ao SIGE da Ariana.
// Em pedidos mistos, apenas os itens prÃ³prios da Ariana entram no payload.
// ============================================================
function arianaSigeNormalizeSellerKey(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function arianaSigeSellerAllowList() {
  const env = String(process.env.SIGE_ARIANA_SELLER_KEYS || process.env.ARIANA_SELLER_KEYS || '')
    .split(',')
    .map((v) => arianaSigeNormalizeSellerKey(v))
    .filter(Boolean);

  return new Set([
    'ariana',
    'ariana_moveis',
    'arianamoveis',
    'ariana_moveis_oficial',
    'loja_ariana',
    'marcelo_nunes_silva',
    'sn',
    'sn_digital',
    'sndigital',
    ...env
  ]);
}

function arianaSigeIsArianaSellerValue(value = '') {
  const key = arianaSigeNormalizeSellerKey(value);
  if (!key) return false;
  if (arianaSigeSellerAllowList().has(key)) return true;
  return key.includes('ariana') && key.includes('move');
}

function arianaSigeItemHasExternalSellerSignal(item = {}, order = {}) {
  const candidates = [
    item.sellerId,
    item.seller_id,
    item.sellerName,
    item.seller_name,
    item.storeName,
    item.store_name,
    item.fabricante,
    item.manufacturer,
    item.brand,
    order.manufacturer
  ].map((v) => String(v || '').trim()).filter(Boolean);

  if (!candidates.length) return false;
  return candidates.some((value) => !arianaSigeIsArianaSellerValue(value));
}

function arianaSigeIsArianaOrderItem(item = {}, order = {}) {
  const sellerId = String(item.sellerId || item.seller_id || '').trim();
  const sellerName = String(item.sellerName || item.seller_name || item.storeName || item.store_name || '').trim();
  const fabricante = String(item.fabricante || item.manufacturer || '').trim();

  // Produto com seller/fabricante explicitamente diferente da Ariana nÃ£o entra no SIGE.
  if (sellerId && !arianaSigeIsArianaSellerValue(sellerId)) return false;
  if (sellerName && !arianaSigeIsArianaSellerValue(sellerName)) return false;
  if (fabricante && !arianaSigeIsArianaSellerValue(fabricante)) return false;

  // Pedido marcado como fabricante/seller externo tambÃ©m nÃ£o entra, salvo item explicitamente da Ariana.
  const orderManufacturer = String(order?.manufacturer || '').trim();
  if (orderManufacturer && !arianaSigeIsArianaSellerValue(orderManufacturer) && !sellerId && !sellerName && !fabricante) {
    return false;
  }

  // Sem sellerId/sellerName/fabricante Ã© considerado produto legado/prÃ³prio da Ariana.
  return true;
}

function arianaSigeSelectArianaOrderItems(order = {}) {
  const orderObj = toJSON(order) || order || {};
  const allItems = ensureArray(orderObj.items);
  const arianaItems = allItems.filter((item) => arianaSigeIsArianaOrderItem(item, orderObj));
  return {
    allItems,
    arianaItems,
    hasArianaItems: arianaItems.length > 0,
    isMixed: arianaItems.length > 0 && arianaItems.length < allItems.length,
    totalItems: allItems.length,
    arianaItemsCount: arianaItems.length,
    externalItemsCount: Math.max(0, allItems.length - arianaItems.length)
  };
}

const {
  arianaSigeResolvePlanoConta,
  arianaSigeUfCodigo,
  arianaSigeBuildVendaPayloadFromOrder,
  arianaSigeNormalizeVendaPayloadForSige,
  arianaSigeCleanObjectForPayload,
  arianaSigeSimplifyItemsForMinimalPayload,
  arianaSigeBuildMinimalVendaPayloadForSige,
  arianaSigeBuildPlanoContaPayloadVariants,
  arianaSigePayloadAttemptList
} = createSigePayloadService({
  SIGE_PLANO_CONTA,
  ensureArray,
  toJSON,
  arianaSigeOnlyDigits,
  arianaSigeMoney,
  arianaSigeFirstValue,
  arianaSigeIsoDate,
  arianaSigeNormalizePayment,
  arianaSigeSelectArianaOrderItems
});

// ============================================================
// ============================================================
// SIGE CLOUD -> NF-e ENTERPRISE / XML / DANFE
// Lógica extraída para services/enterprise/sige/nfeService.js
// Endpoints, JSON e regras de negócio preservados.
// ============================================================
const {
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
} = createSigeNfeService({
  SIGE_API_URL,
  SIGE_TIMEOUT_MS,
  axios,
  isSigeConfigured,
  sigeAuthHeaders,
  ensureArray,
  toJSON,
  arianaSigeOnlyDigits
});



const {
  arianaSigePickCustomerName,
  arianaSigeBuildPessoaPayloadFromOrder,
  arianaSigeNormalizePessoaList,
  arianaSigePessoaMatches,
  arianaSigePesquisarPessoa,
  arianaSigeEnsurePessoaForOrder
} = createSigePessoaService({
  toJSON,
  arianaSigeFirstValue,
  arianaSigeOnlyDigits,
  arianaSigeUfCodigo,
  sigeRequest
});

const {
  arianaSigeNormalizeProdutoList,
  arianaSigeNormalizeCode,
  arianaSigeProdutoMatches,
  arianaSigeProdutoPayloadFromItem,
  arianaSigePesquisarProdutoPorItem,
  arianaSigeCriarProdutoPorItem,
  arianaSigeEnsureProdutoItem,
  arianaSigeEnsureProdutosForVendaPayload
} = createSigeProdutoService({
  ensureArray,
  redact,
  arianaSigeMoney,
  arianaSigeFirstValue,
  arianaSigeCleanObjectForPayload,
  sigeRequest
});

const {
  arianaSigeVendaEndpointCandidates,
  arianaSigeMarkOrderSkippedNonAriana,
  arianaSigeSyncOwnOrderAfterPayment,
  arianaSigeRawText,
  arianaSigeExtractPedidoNumberFromRaw,
  arianaSigeExtractVendaPayload,
  arianaSigeCreateVendaForOrder
} = createSigeVendaService({
  Order,
  IntegrationAuditLog,
  redact,
  arianaSigeSelectArianaOrderItems,
  arianaSigeBuildVendaPayloadFromOrder,
  arianaSigeNormalizeVendaPayloadForSige,
  arianaSigeEnsurePessoaForOrder,
  arianaSigeEnsureProdutosForVendaPayload,
  arianaSigePayloadAttemptList,
  sigeRequest,
  sigeFindByKeyDeep
});





app.get('/api/admin/sige/orders/:orderId/payload-preview', adminRequired, async (req, res) => {
  try {
    const order = await enterpriseCompatFindOrder(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado para preview do payload SIGE' });

    const body = {
      ...(req.query || {}),
      faturar: String(req.query?.faturar || '').toLowerCase() === 'true' || req.query?.faturar === '1'
    };
    const rawPayload = arianaSigeBuildVendaPayloadFromOrder(order, body);
    const payload = arianaSigeNormalizeVendaPayloadForSige(rawPayload, body);
    const payloadAttempts = arianaSigePayloadAttemptList(payload, body);

    return res.json({
      ok: true,
      orderId: String(order._id),
      payload: payloadAttempts[0]?.payload || payload,
      rawPayload,
      normalizedFullPayload: payload,
      payloadAttempts,
      endpoints: arianaSigeVendaEndpointCandidates()
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Erro ao gerar preview do payload SIGE',
      sigeResponse: redact(error.responseData || null)
    });
  }
});


// ============================================================
// SIGE CLOUD - DEBUG PLANO DE CONTAS
// Rota temporÃ¡ria para consultar os planos de contas usando
// exatamente os headers configurados no Render/backend.
// ============================================================
app.get('/api/admin/sige/debug/plano-contas', adminRequired, async (req, res) => {
  try {
    const somentePrimeiroNivelRaw = req.query?.somentePrimeiroNivel;
    const somentePrimeiroNivel = String(
      somentePrimeiroNivelRaw === undefined ? 'false' : somentePrimeiroNivelRaw
    ).toLowerCase() === 'true';

    const raw = await sigeGet('PlanosConta/Pesquisar', { somentePrimeiroNivel });
    const rows = Array.isArray(raw) ? raw : ensureArray(raw?.items || raw?.Itens || raw?.data || raw?.Dados || raw);
    const busca = String(req.query?.q || req.query?.busca || req.query?.nome || '').trim().toLowerCase();

    const planos = rows.map((item) => ({
      Id: item?.Id || item?.ID || item?.id || '',
      Nome: item?.Nome || item?.nome || item?.Descricao || item?.descricao || '',
      Hierarquia: item?.Hierarquia || item?.hierarquia || item?.Codigo || item?.codigo || '',
      Despesa: item?.Despesa,
      TipoDeConta: item?.TipoDeConta || item?.tipoDeConta || '',
      CodigoNatureza: item?.CodigoNatureza ?? item?.codigoNatureza ?? null,
      DesativarPlano: item?.DesativarPlano ?? item?.desativarPlano ?? false,
      raw: item
    })).filter((item) => {
      if (!busca) return true;
      const text = `${item.Id} ${item.Nome} ${item.Hierarquia} ${item.TipoDeConta}`.toLowerCase();
      return text.includes(busca);
    });

    const receitasPdv = planos.filter((item) => {
      const text = `${item.Nome} ${item.Hierarquia}`.toLowerCase();
      return text.includes('receitas pdv') || text.includes('receita pdv');
    });

    return res.json({
      ok: true,
      endpoint: 'PlanosConta/Pesquisar',
      params: { somentePrimeiroNivel },
      total: planos.length,
      receitasPdv,
      planos,
      headersUsados: {
        User: SIGE_USER,
        App: SIGE_APP,
        AuthorizationTokenConfigurado: Boolean(SIGE_TOKEN)
      }
    });
  } catch (error) {
    console.error('[SIGE debug plano-contas] erro:', error.message || error);
    return res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Erro ao consultar planos de contas no SIGE',
      endpoint: 'PlanosConta/Pesquisar',
      sigeResponse: redact(error.responseData || null),
      headersUsados: {
        User: SIGE_USER,
        App: SIGE_APP,
        AuthorizationTokenConfigurado: Boolean(SIGE_TOKEN)
      }
    });
  }
});


app.post('/api/admin/sige/orders/:orderId/cliente/ensure', adminRequired, async (req, res) => {
  try {
    const order = await enterpriseCompatFindOrder(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado para cadastrar cliente no SIGE' });

    const payload = arianaSigeBuildVendaPayloadFromOrder(order, req.body || {});
    const result = await arianaSigeEnsurePessoaForOrder(order, payload, req.body || {});

    return res.json({
      ok: true,
      action: `sige.customer.${result.action}`,
      orderId: String(order._id),
      cliente: payload.Cliente,
      customerPayload: result.payload,
      sigePessoa: result.pessoa,
      search: result.search ? {
        found: result.search.found,
        params: result.search.params
      } : null
    });
  } catch (error) {
    console.error('[SIGE ensure cliente] erro:', error.message || error);
    return res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Erro ao cadastrar cliente no SIGE Cloud',
      sigeResponse: redact(error.responseData || null)
    });
  }
});


app.post('/api/admin/sige/orders/:orderId/criar-venda', adminRequired, async (req, res) => {
  try {
    const order = await enterpriseCompatFindOrder(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado para criar venda no SIGE' });

    const result = await arianaSigeCreateVendaForOrder(order, req.body || {}, req);
    return res.status(201).json({
      ok: true,
      action: 'sige_sale_created',
      orderId: String(result.order._id),
      endpoint: result.endpoint,
      venda: result.venda,
      payloadMode: result.payloadMode,
      payload: result.payload,
      payloadAttempts: result.payloadAttempts,
      sigeResponse: result.raw,
      clienteSige: result.clienteSige,
      produtosSige: result.produtosSige,
      attemptedFallbacks: result.errors
    });
  } catch (error) {
    console.error('[SIGE criar venda] erro:', error.message || error);
    return res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Erro ao criar venda no SIGE Cloud',
      payloadEnviadoAoSige: redact(error.payload || error.responseData?.payloadEnviadoAoSige || null),
      clienteSige: redact(error.clienteSige || error.responseData?.clienteSige || null),
      produtosSige: redact(error.produtosSige || error.responseData?.produtosSige || null),
      sigeResponse: redact(error.responseData || null)
    });
  }
});


app.get('/api/admin/sige/orders/:orderId/integracao', adminRequired, async (req, res) => {
  try {
    let order = await enterpriseCompatFindOrder(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado para consultar integraÃ§Ã£o SIGE' });

    const backfilled = await arianaSigeBackfillVendaNumeroOnOrder(order);
    order = backfilled.order || order;
    const dispatch = order.manufacturerDispatch || {};
    const sale = dispatch.sigeVenda || dispatch.sigeSale || {};
    const sigePedidoNumero = dispatch.sigePedidoNumero || dispatch.sigePedidoCodigo || dispatch.codigoVenda || dispatch.externalOrderId || sale.codigo || sale.numero || arianaSigeExtractVendaNumero(sale.raw) || '';

    return res.json({
      ok: true,
      orderId: String(order._id),
      statusIntegracao: order.status_integracao || '',
      statusLabel: order.statusLabel || '',
      arianaPedidoId: dispatch.arianaPedidoId || String(order._id),
      sigePedidoNumero,
      codigoVenda: sigePedidoNumero,
      numeroCorrigidoNoMongo: Boolean(backfilled.updated),
      sigeVenda: dispatch.sigeVenda || dispatch.sigeSale || null,
      produtosSige: dispatch.sigeProdutos || null,
      invoice: dispatch.invoice || dispatch.sigeInvoice || null,
      raw: dispatch.sigeVenda?.raw || dispatch.sigeSale?.raw || null
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao consultar integraÃ§Ã£o SIGE' });
  }
});

app.get('/api/admin/sige/orders/:orderId/venda', adminRequired, async (req, res) => {
  try {
    const order = await enterpriseCompatFindOrder(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado para consultar venda SIGE' });

    return res.json({
      ok: true,
      orderId: String(order._id),
      externalOrderId: order.manufacturerDispatch?.externalOrderId || '',
      sigeSale: order.manufacturerDispatch?.sigeSale || null,
      sigeVenda: order.manufacturerDispatch?.sigeVenda || null,
      invoice: order.manufacturerDispatch?.invoice || order.manufacturerDispatch?.sigeInvoice || null
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao consultar venda SIGE' });
  }
});

app.post('/api/admin/sige/orders/:orderId/sync-nfe', adminRequired, async (req, res) => {
  try {
    const order = await enterpriseCompatFindOrder(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado para sincronizar NF-e do SIGE' });

    const sale = order.manufacturerDispatch?.sigeSale || order.manufacturerDispatch?.sigeVenda || {};
    const query = {
      ...(req.body || {}),
      codigoPedido: req.body?.codigoPedido || req.body?.sigeCodigo || sale.codigo || sale.externalOrderId || order.manufacturerDispatch?.externalOrderId || '',
      sigeVendaId: req.body?.sigeVendaId || sale.id || ''
    };

    let invoiceData = null;
    let rawSigeResponse = null;

    if (req.body?.invoice || req.body?.nfe || req.body?.xmlUrl || req.body?.danfeUrl || req.body?.pdfUrl || req.body?.accessKey || req.body?.invoiceKey) {
      invoiceData = sigeExtractInvoicePayload(req.body.invoice || req.body.nfe || req.body, req.body.invoice || req.body.nfe || req.body);
    } else {
      const result = await searchSigeInvoiceForOrder(order, query);
      rawSigeResponse = result.raw;
      invoiceData = result.invoice;
    }

    if (!invoiceData?.xmlUrl && !invoiceData?.danfeUrl && !invoiceData?.accessKey && !invoiceData?.number) {
      return res.status(404).json({
        ok: false,
        error: 'NF-e ainda nÃ£o localizada no SIGE para esta venda/pedido',
        hint: 'Emita a NF-e manualmente no SIGE a partir da venda criada. Depois rode este sync novamente. Se necessÃ¡rio, envie xmlUrl/danfeUrl/accessKey no body.',
        queryUsed: query
      });
    }

    const saved = await saveSigeInvoiceOnEnterpriseOrder(order, {
      ...invoiceData,
      total: order.total,
      raw: rawSigeResponse || invoiceData.raw || req.body
    }, req, 'sige_sale_nfe_synced');

    return res.json({
      ok: true,
      action: 'sige_sale_nfe_synced',
      orderId: String(saved.order._id),
      status: saved.order.status,
      invoice: saved.invoice,
      billing: saved.billing
    });
  } catch (error) {
    console.error('[SIGE sync NF-e venda] erro:', error.message || error);
    return res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Erro ao sincronizar NF-e da venda SIGE',
      sigeResponse: redact(error.responseData || null)
    });
  }
});

const {
  saveSigeInvoiceOnEnterpriseOrder
} = createSigeInvoicePersistenceService({
  enterpriseBillingUpsert
});

app.post('/api/admin/sige/orders/:orderId/emitir-nfe', adminRequired, async (req, res) => {
  try {
    const order = await enterpriseCompatFindOrder(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado para emissÃ£o de NF-e no SIGE' });

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    let rawSigeResponse = null;
    let invoiceData = null;
    let codigoVenda = '';
    let endpoint = '';

    // Caminho manual/assistido: se jÃ¡ tiver XML/DANFE/chave/nÃºmero no body, apenas grava no pedido.
    if (body.invoice || body.nfe || body.xmlUrl || body.danfeUrl || body.pdfUrl || body.accessKey || body.invoiceKey || body.chaveAcesso || body.numero || body.codigo) {
      invoiceData = sigeExtractInvoicePayload(body.invoice || body.nfe || body, body.invoice || body.nfe || body);
      if (body.codigo || body.numero) invoiceData.number = String(body.codigo || body.numero || invoiceData.number || '').trim();
      if (body.serie) invoiceData.series = String(body.serie || invoiceData.series || '1').trim();
    } else {
      const emitted = await emitirSigeNfePorVenda(order, body);
      rawSigeResponse = emitted.raw;
      invoiceData = emitted.invoice;
      codigoVenda = emitted.codigoVenda;
      endpoint = emitted.endpoint;
    }

    const saved = await saveSigeInvoiceOnEnterpriseOrder(order, {
      ...invoiceData,
      total: invoiceData.total ?? order.total,
      raw: rawSigeResponse || invoiceData.raw || body
    }, req, 'sige_nfe_emitted');

    return res.json({
      ok: true,
      action: rawSigeResponse ? 'sige_nfe_emitted' : 'sige_nfe_saved',
      orderId: String(saved.order._id),
      codigoVenda,
      endpoint,
      status: saved.order.status,
      invoice: saved.invoice,
      billing: saved.billing,
      sigeResponse: rawSigeResponse || null
    });
  } catch (error) {
    console.error('[SIGE NF-e emitir] erro:', error.message || error);
    return res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Erro ao emitir/salvar NF-e no SIGE',
      sigeResponse: redact(error.responseData || null)
    });
  }
});


app.get('/api/admin/sige/orders/:orderId/nfe', adminRequired, async (req, res) => {
  try {
    const order = await enterpriseCompatFindOrder(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado para consultar NF-e' });

    const current = order.manufacturerDispatch?.invoice || order.manufacturerDispatch?.sigeInvoice || null;
    let synced = null;
    let consulta = null;

    if (String(req.query.sync || '').toLowerCase() === '1' || String(req.query.sync || '').toLowerCase() === 'true') {
      consulta = await searchSigeInvoiceForOrder(order, req.query || {});
      if (consulta.invoice?.xmlUrl || consulta.invoice?.danfeUrl || consulta.invoice?.accessKey || consulta.invoice?.number || consulta.raw) {
        synced = await saveSigeInvoiceOnEnterpriseOrder(order, {
          ...consulta.invoice,
          total: order.total,
          raw: consulta.raw
        }, req, 'sige_nfe_consulted');
      }
    }

    const freshOrder = synced?.order || await enterpriseCompatFindOrder(req.params.orderId);
    return res.json({
      ok: true,
      orderId: String(freshOrder._id),
      invoice: freshOrder.manufacturerDispatch?.invoice || current,
      sigeInvoice: freshOrder.manufacturerDispatch?.sigeInvoice || null,
      synced: Boolean(synced),
      consulta: consulta ? { endpoint: consulta.endpoint, params: consulta.params, raw: consulta.raw } : null
    });
  } catch (error) {
    console.error('[SIGE NF-e consultar] erro:', error.message || error);
    return res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Erro ao consultar NF-e no SIGE',
      sigeResponse: redact(error.responseData || null)
    });
  }
});

app.post('/api/admin/sige/fiscal/salvar-nfe', adminRequired, async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const orderId = String(body.orderId || body.pedidoId || body.id || '').trim();
    if (!orderId) return res.status(400).json({ ok: false, error: 'Informe orderId para salvar a NF-e no pedido.' });

    const order = await enterpriseCompatFindOrder(orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado para salvar NF-e' });

    await arianaSigeBackfillVendaNumeroOnOrder(order);

    const query = {
      ...body,
      CodigoNFe: body.CodigoNFe || body.codigoNFe || body.codigoNfe || body.codigo || body.numero || body.nfe,
      SerieNFe: body.SerieNFe || body.serieNFe || body.serieNfe || body.serie || body.series || '1',
      CNPJEmpresaEmissora: body.CNPJEmpresaEmissora || body.cnpjEmpresaEmissora || body.cnpj || body.cnpjEmitente
    };

    const consulta = await consultarSigeNfeFiscal(order, query);
    const saved = await saveSigeInvoiceOnEnterpriseOrder(order, {
      ...consulta.invoice,
      total: order.total,
      raw: consulta.raw
    }, req, 'sige_nfe_saved');

    return res.json({
      ok: true,
      action: 'sige_nfe_saved',
      orderId: String(saved.order._id),
      endpoint: consulta.endpoint,
      params: consulta.params,
      nfe: saved.order.nfe || null,
      notaFiscal: saved.order.notaFiscal || null,
      invoice: saved.invoice,
      billing: saved.billing,
      sigeResponse: consulta.raw
    });
  } catch (error) {
    console.error('[SIGE Fiscal SalvarNFE] erro:', error.message || error);
    return res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Erro ao salvar NF-e no pedido',
      sigeResponse: redact(error.responseData || null)
    });
  }
});


app.get('/api/admin/sige/fiscal/consultar-nfe/:orderId', adminRequired, async (req, res) => {
  try {
    const order = await enterpriseCompatFindOrder(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado para consultar NF-e' });
    await arianaSigeBackfillVendaNumeroOnOrder(order);
    const consulta = await consultarSigeNfeFiscal(order, req.query || {});
    const saved = await saveSigeInvoiceOnEnterpriseOrder(order, {
      ...consulta.invoice,
      total: order.total,
      raw: consulta.raw
    }, req, 'sige_nfe_consulted');
    return res.json({ ok: true, action: 'sige_nfe_consulted', orderId: String(saved.order._id), endpoint: consulta.endpoint, params: consulta.params, invoice: saved.invoice, billing: saved.billing, sigeResponse: consulta.raw });
  } catch (error) {
    console.error('[SIGE Fiscal ConsultarNFE order] erro:', error.message || error);
    return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao consultar NF-e no SIGE', sigeResponse: redact(error.responseData || null) });
  }
});

app.post('/api/admin/sige/fiscal/emitir-nfe/:orderId', adminRequired, async (req, res) => {
  try {
    const order = await enterpriseCompatFindOrder(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado para emissÃ£o de NF-e no SIGE' });
    const emitted = await emitirSigeNfePorVenda(order, req.body || {});
    const saved = await saveSigeInvoiceOnEnterpriseOrder(order, {
      ...emitted.invoice,
      total: order.total,
      raw: emitted.raw
    }, req, 'sige_nfe_emitted');
    return res.json({ ok: true, action: 'sige_nfe_emitted', orderId: String(saved.order._id), codigoVenda: emitted.codigoVenda, endpoint: emitted.endpoint, invoice: saved.invoice, billing: saved.billing, sigeResponse: emitted.raw });
  } catch (error) {
    console.error('[SIGE Fiscal EmitirNFE] erro:', error.message || error);
    return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao emitir NF-e no SIGE', sigeResponse: redact(error.responseData || null) });
  }
});

app.get('/api/admin/sige/fiscal/consultar-nfe', adminRequired, async (req, res) => {
  try {
    let order = null;
    const orderId = String(req.query.orderId || req.query.pedidoId || '').trim();
    if (orderId) {
      order = await enterpriseCompatFindOrder(orderId);
      if (order) await arianaSigeBackfillVendaNumeroOnOrder(order);
    }
    const fakeOrder = order || { manufacturerDispatch: { invoice: { number: req.query.codigo || req.query.CodigoNFe || req.query.numero || '', series: req.query.serie || req.query.SerieNFe || '1' } } };
    const consulta = await consultarSigeNfeFiscal(fakeOrder, req.query || {});
    let saved = null;
    if (order) {
      saved = await saveSigeInvoiceOnEnterpriseOrder(order, { ...consulta.invoice, total: order.total, raw: consulta.raw }, req, 'sige_nfe_consulted');
    }
    return res.json({ ok: true, action: 'sige_nfe_consulted', orderId: order ? String(order._id) : '', endpoint: consulta.endpoint, params: consulta.params, invoice: saved?.invoice || consulta.invoice, billing: saved?.billing || null, sigeResponse: consulta.raw });
  } catch (error) {
    console.error('[SIGE Fiscal ConsultarNFE] erro:', error.message || error);
    return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao consultar NF-e no SIGE', sigeResponse: redact(error.responseData || null) });
  }
});


app.post('/api/enterprise/orders/:orderId/sige/sync-invoice', enterpriseCompatAuth, async (req, res) => {
  try {
    const order = await enterpriseCompatFindOrder(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado para sincronizar NF-e SIGE' });

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    let invoiceData = null;
    let rawSigeResponse = null;

    if (body.invoice || body.nfe || body.xmlUrl || body.danfeUrl || body.pdfUrl || body.accessKey || body.invoiceKey) {
      invoiceData = sigeExtractInvoicePayload(body.invoice || body.nfe || body, body.invoice || body.nfe || body);
    } else {
      const result = await searchSigeInvoiceForOrder(order, body);
      rawSigeResponse = result.raw;
      invoiceData = result.invoice;
    }

    if (!invoiceData?.xmlUrl && !invoiceData?.danfeUrl && !invoiceData?.accessKey && !invoiceData?.number) {
      return res.status(404).json({
        ok: false,
        error: 'NF-e nÃ£o localizada no SIGE para este pedido',
        hint: 'Envie xmlUrl/danfeUrl/accessKey no body ou configure SIGE_NFE_SEARCH_ENDPOINT conforme sua API SIGE.'
      });
    }

    const saved = await saveSigeInvoiceOnEnterpriseOrder(order, {
      ...invoiceData,
      total: order.total,
      raw: rawSigeResponse || invoiceData.raw || body
    }, req, 'enterprise_sige_invoice_synced');

    return res.json({
      ok: true,
      action: 'enterprise_sige_invoice_synced',
      orderId: String(saved.order._id),
      status: saved.order.status,
      invoice: saved.invoice,
      billing: saved.billing
    });
  } catch (error) {
    console.error('[Enterprise SIGE sync invoice] erro:', error.message || error);
    return res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Erro ao sincronizar NF-e SIGE com pedido Enterprise',
      sigeResponse: redact(error.responseData || null)
    });
  }
});




// ============================================================
}
