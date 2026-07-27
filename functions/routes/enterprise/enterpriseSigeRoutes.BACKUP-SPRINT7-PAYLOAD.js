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

function arianaSigeVendaEndpointCandidates() {
  const envValue = String(process.env.SIGE_VENDA_CREATE_ENDPOINT || '').trim();
  const defaults = [
    'Pedidos/SalvarEFaturar',
    'Pedidos/Salvar',
    'PedidosOrcamentos/Salvar',
    'PedidoOrcamento/Salvar',
    'Vendas/Salvar'
  ];
  return Array.from(new Set([envValue, ...defaults].filter(Boolean).map((item) => String(item).replace(/^\/+/, '').trim())));
}

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

async function arianaSigeMarkOrderSkippedNonAriana(order, reason = 'no_ariana_items') {
  if (!order) return null;
  order.manufacturerDispatch = {
    ...(order.manufacturerDispatch || {}),
    sigeSkipped: true,
    sigeSkipReason: reason,
    sigeSkippedAt: new Date()
  };
  if (!order.status_integracao || String(order.status_integracao).startsWith('sige_')) {
    order.status_integracao = 'sige_skipped_non_ariana';
  }
  await order.save();
  try {
    await IntegrationAuditLog.create({
      scope: 'sige',
      eventType: 'sige.sale.skipped_non_ariana',
      orderId: String(order._id),
      manufacturer: order.manufacturer || '',
      status: 'skipped',
      message: 'Pedido nÃ£o enviado ao SIGE: nÃ£o possui itens vendidos pela Ariana MÃ³veis.',
      request: { sellerIds: order.sellerIds || [], items: order.items || [] },
      metadata: { reason }
    });
  } catch (_error) {}
  return order;
}

async function arianaSigeSyncOwnOrderAfterPayment(orderDoc, origin = 'payment_approved') {
  try {
    const orderId = String(orderDoc?._id || orderDoc?.id || '').trim();
    if (!orderId) return { skipped: true, reason: 'missing_order_id' };

    const order = await Order.findById(orderId);
    if (!order) return { skipped: true, reason: 'order_not_found' };

    const selection = arianaSigeSelectArianaOrderItems(order);
    if (!selection.hasArianaItems) {
      await arianaSigeMarkOrderSkippedNonAriana(order, 'no_ariana_items');
      return { skipped: true, reason: 'no_ariana_items', selection };
    }

    const dispatch = order.manufacturerDispatch || {};
    if (dispatch.sigePedidoNumero || dispatch.codigoVenda || dispatch.sigeVenda || dispatch.sigeSale) {
      return { skipped: true, reason: 'already_synced', codigoVenda: dispatch.sigePedidoNumero || dispatch.codigoVenda || dispatch.externalOrderId || '' };
    }

    const enabled = String(process.env.SIGE_AUTO_SYNC_ARIANA_ORDERS || 'true').toLowerCase() !== 'false';
    if (!enabled) return { skipped: true, reason: 'disabled_by_env' };

    const result = await arianaSigeCreateVendaForOrder(order, {
      faturar: true,
      origemVenda: process.env.SIGE_ORIGEM_VENDA || 'PDV',
      statusSistema: process.env.SIGE_STATUS_SISTEMA || 'Pedido Faturado',
      auto: true,
      origin
    });

    return {
      ok: true,
      action: 'sige_sale_created',
      codigoVenda: result?.venda?.codigo || result?.venda?.pedidoNumero || result?.order?.manufacturerDispatch?.sigePedidoNumero || '',
      selection
    };
  } catch (error) {
    const statusCode = Number(error.statusCode || 0);
    if (error.code === 'SIGE_NO_ARIANA_ITEMS' || statusCode === 409) {
      return { skipped: true, reason: 'no_ariana_items' };
    }
    console.error('[SIGE auto Ariana] erro:', error.message || error);
    try {
      await IntegrationAuditLog.create({
        scope: 'sige',
        eventType: 'sige.sale.auto_error',
        orderId: String(orderDoc?._id || orderDoc?.id || ''),
        status: 'error',
        statusCode: error.statusCode || 500,
        message: error.message || String(error),
        response: redact(error.responseData || null),
        metadata: { origin }
      });
    } catch (_auditError) {}
    return { ok: false, error: error.message || String(error) };
  }
}

function arianaSigeResolvePlanoConta(body = {}) {
  const raw = String(
    arianaSigeFirstValue(
      body.planoDeConta,
      body.PlanoDeConta,
      body.planoConta,
      body.PlanoConta,
      body.planoDeContas,
      body.PlanoDeContas,
      process.env.SIGE_PLANO_CONTA,
      SIGE_PLANO_CONTA,
      ''
    )
  ).trim();

  // O SIGE normalmente valida o campo PlanoDeConta pelo NOME exatamente como aparece
  // no ERP. Nos testes, o ID Mongo e a hierarquia chegaram Ã  API, mas nÃ£o foram
  // localizados como plano vÃ¡lido para faturamento. Por isso, normalizamos os
  // valores conhecidos do plano "Receitas PDV" para o nome oficial.
  const normalized = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const knownReceitasPdv = new Set([
    '637627d4cb660703e83e473c',
    '12',
    '12 receitas pdv',
    '12 - receitas pdv',
    'receitas',
    'receitas pdv',
    'recebimentos pdv',
    'receita pdv'
  ]);

  if (!raw) return '';
  if (knownReceitasPdv.has(normalized)) return 'Receitas PDV';
  return raw;
}


function arianaSigeUfCodigo(uf = '') {
  const map = {
    AC: '12', AL: '27', AP: '16', AM: '13', BA: '29', CE: '23', DF: '53',
    ES: '32', GO: '52', MA: '21', MT: '51', MS: '50', MG: '31', PA: '15',
    PB: '25', PR: '41', PE: '26', PI: '22', RJ: '33', RN: '24', RS: '43',
    RO: '11', RR: '14', SC: '42', SP: '35', SE: '28', TO: '17'
  };
  return map[String(uf || '').trim().toUpperCase()] || '';
}

function arianaSigeBuildVendaPayloadFromOrder(order = {}, body = {}) {
  const orderObj = toJSON(order) || order || {};
  const explicit = body && typeof body === 'object' ? (body.sigePayload || body.payload || {}) : {};

  // Se o usuÃ¡rio enviar payload pronto do SIGE, respeita 100%.
  if (explicit && typeof explicit === 'object' && Object.keys(explicit).length) {
    return explicit;
  }

  const arianaOrderId = String(orderObj._id || orderObj.id || body.orderId || '').trim();
  const shortCode = arianaOrderId ? Number.parseInt(arianaOrderId.replace(/\D/g, '').slice(-8), 10) || Date.now() : Date.now();
  const shippingAddress = orderObj.shippingAddress || orderObj.shipping?.address || body.shippingAddress || {};
  const payment = orderObj.payment || body.payment || {};
  const selection = arianaSigeSelectArianaOrderItems(orderObj);
  const sourceItems = selection.arianaItems;

  if (!sourceItems.length) {
    const err = new Error('Este pedido nÃ£o possui produtos vendidos pela Ariana MÃ³veis. Vendas de sellers/fabricantes nÃ£o sÃ£o enviadas ao SIGE da Ariana.');
    err.statusCode = 409;
    err.code = 'SIGE_NO_ARIANA_ITEMS';
    err.selection = selection;
    throw err;
  }

  // Se o pedido for misto, o SIGE recebe somente os itens prÃ³prios da Ariana.
  // Frete e total geral do pedido nÃ£o sÃ£o repassados ao SIGE nesse caso para nÃ£o misturar valor de seller/fabricante.
  let frete = selection.isMixed ? 0 : arianaSigeMoney(arianaSigeFirstValue(orderObj.shippingCost, orderObj.shipping?.price, body.shippingCost, 0), orderObj.total || 0);
  const subtotal = arianaSigeMoney(sourceItems.reduce((sum, item) => {
    const qty = Number(item.qty || item.quantity || 1) || 1;
    return sum + arianaSigeMoney(arianaSigeFirstValue(item.sellerBaseTotal, item.totalPrice, item.unitPrice ? Number(item.unitPrice) * qty : 0), orderObj.total || 0);
  }, 0), 0);
  const totalPedido = selection.isMixed ? 0 : arianaSigeMoney(arianaSigeFirstValue(orderObj.total, orderObj.subtotal, body.total, 0), 0);
  const totalQty = sourceItems.reduce((sum, item) => sum + (Number(item.qty || item.quantity || 1) || 1), 0) || 1;

  const items = sourceItems.map((item, index) => {
    const qty = Number(item.qty || item.quantity || 1) || 1;
    const fallbackUnitFromSubtotal = subtotal > 0 ? subtotal / totalQty : 0;
    const unitPrice = arianaSigeMoney(arianaSigeFirstValue(
      item.sellerBaseUnitPrice,
      item.pixUnitPrice,
      item.baseUnitPrice,
      item.unitPrice,
      item.price,
      fallbackUnitFromSubtotal
    ), totalPedido || subtotal || 0);
    const totalItem = arianaSigeMoney(arianaSigeFirstValue(item.sellerBaseTotal, item.totalPrice, unitPrice * qty), totalPedido || subtotal || 0);

    return {
      Codigo: String(item.sku || item.productSku || item.productId || item.codigo || `ITEM-${index + 1}`).trim(),
      Unidade: String(item.unidade || 'UN').trim(),
      Descricao: String(item.name || item.description || item.descricao || item.sku || 'Produto Ariana').trim(),
      Quantidade: qty,
      ValorUnitario: unitPrice,
      ValorFrete: 0,
      DescontoUnitario: 0,
      ValorTotal: totalItem || arianaSigeMoney(unitPrice * qty),
      PesoKG: Number(item.weight || item.pesoKg || item.PesoKG || 0) || 0,
      Comprimento: Number(item.length || item.comprimento || 0) || 0,
      Altura: Number(item.height || item.altura || 0) || 0,
      Largura: Number(item.width || item.largura || 0) || 0,
      FreteGratis: false,
      ValorUnitarioFrete: 0,
      PrazoEntregaFrete: 0,
      Seguro: 0,
      ProductGroupId: Number(item.productGroupId || item.ProductGroupId || 0) || 0
    };
  });

  const itemsTotal = arianaSigeMoney(items.reduce((sum, item) => sum + arianaSigeMoney(item.ValorTotal), 0));
  const valorFinal = totalPedido || arianaSigeMoney(itemsTotal + frete);
  const formaPagamento = arianaSigeNormalizePayment(arianaSigeFirstValue(body.formaPagamento, payment.method, payment.paymentMethod, payment.type, 'Outros'));
  const parcelas = Number(arianaSigeFirstValue(body.parcelas, payment.installments, payment.parcelas, 1)) || 1;
  const clienteDoc = arianaSigeOnlyDigits(arianaSigeFirstValue(
    body.customerDocument,
    body.clienteCpfCnpj,
    body.ClienteCNPJ,
    body.cpfCnpj,
    orderObj.customerDocument,
    orderObj.customerCpf,
    orderObj.customerCnpj,
    orderObj.cpf,
    orderObj.cnpj,
    orderObj.user?.cpf,
    shippingAddress.cpf,
    shippingAddress.cnpj
  ));

  return {
    Codigo: body.codigo || shortCode,
    OrigemVenda: body.origemVenda || process.env.SIGE_ORIGEM_VENDA || 'PDV',
    Deposito: body.deposito || process.env.SIGE_DEPOSITO || 'Deposito PDV',
    StatusSistema: body.statusSistema || process.env.SIGE_STATUS_SISTEMA || (body.faturar ? 'Pedido Faturado' : 'Pedido'),
    Status: body.status || 'Aprovado',
    Validade: arianaSigeIsoDate(orderObj.createdAt || new Date()),
    Empresa: body.empresa || process.env.SIGE_EMPRESA || 'Ariana MÃ³veis',
    Cliente: String(arianaSigeFirstValue(body.customerName, orderObj.customerName, orderObj.user?.name, orderObj.customerEmail, 'Cliente Ariana')).trim(),
    ClienteCNPJ: clienteDoc,
    ClienteEmail: String(arianaSigeFirstValue(body.customerEmail, orderObj.customerEmail, orderObj.user?.email)).trim(),
    ClienteTelefone: arianaSigeOnlyDigits(arianaSigeFirstValue(body.customerPhone, orderObj.customerPhone, orderObj.phone, orderObj.user?.phone)),
    Vendedor: body.vendedor || process.env.SIGE_VENDEDOR || '',
    FormaPagamento: formaPagamento,
    NumeroParcelas: parcelas,
    FreteMeioEnvio: Number(body.freteMeioEnvio || process.env.SIGE_FRETE_MEIO_ENVIO || 1),
    Transportadora: String(arianaSigeFirstValue(body.transportadora, orderObj.shipping?.carrier, orderObj.shipping?.provider)).trim(),
    FreteFormaEnvio: String(arianaSigeFirstValue(body.freteFormaEnvio, orderObj.shipping?.service, orderObj.shipping?.serviceName)).trim(),
    DataEnvio: body.dataEnvio || undefined,
    PrevisaoEntrega: body.previsaoEntrega || undefined,
    DataPostagem: body.dataPostagem || undefined,
    Enviado: false,
    ValorFrete: frete,
    FreteContaEmitente: frete <= 0,
    CodigoRastreio: String(arianaSigeFirstValue(orderObj.trackingCode, body.codigoRastreio)).trim(),
    EnderecoOpcional: false,
    ValorSeguro: 0,
    Descricao: body.descricao || `Pedido Ariana: ${arianaOrderId || '-'}`,
    OutrasDespesas: 0,
    ValorFinal: valorFinal,
    Finalizado: false,
    Lancado: false,
    Municipio: String(arianaSigeFirstValue(shippingAddress.cidade, shippingAddress.city, shippingAddress.municipio)).trim(),
    CodigoMunicipio: String(arianaSigeFirstValue(body.codigoMunicipio, body.CodigoMunicipio, shippingAddress.codigoMunicipio, shippingAddress.ibge, shippingAddress.cityCode)).trim(),
    Pais: String(arianaSigeFirstValue(shippingAddress.pais, shippingAddress.country, 'Brasil')).trim(),
    CEP: arianaSigeOnlyDigits(arianaSigeFirstValue(shippingAddress.cep, shippingAddress.zipCode, shippingAddress.zip, shippingAddress.postalCode)),
    UF: String(arianaSigeFirstValue(shippingAddress.uf, shippingAddress.state, shippingAddress.estado)).trim().toUpperCase(),
    UFCodigo: String(arianaSigeFirstValue(body.ufCodigo, body.UFCodigo, shippingAddress.ufCodigo, shippingAddress.codigoUf, arianaSigeUfCodigo(String(arianaSigeFirstValue(shippingAddress.uf, shippingAddress.state, shippingAddress.estado)).trim().toUpperCase()))).trim(),
    Bairro: String(arianaSigeFirstValue(shippingAddress.bairro, shippingAddress.neighborhood)).trim(),
    Logradouro: String(arianaSigeFirstValue(shippingAddress.logradouro, shippingAddress.rua, shippingAddress.street, shippingAddress.endereco, shippingAddress.address)).trim(),
    LogradouroNumero: String(arianaSigeFirstValue(shippingAddress.numero, shippingAddress.number, shippingAddress.logradouroNumero, 'S/N')).trim(),
    LogradouroComplemento: String(arianaSigeFirstValue(shippingAddress.complemento, shippingAddress.complement, shippingAddress.logradouroComplemento)).trim(),
    GruposProdutos: [{ Id: 0, Nome: 'Ariana Marketplace' }],
    Items: items,
    Data: arianaSigeIsoDate(orderObj.createdAt || new Date()),
    Pagamentos: [{
      FormaPagamento: formaPagamento,
      ValorPagamento: valorFinal,
      DataTransacao: payment.paidAt || payment.createdAt || '0001-01-01T00:00:00',
      CondicaoPagamento: Number(body.condicaoPagamento || 0),
      Parcelas: parcelas,
      PeriodoParcelas: 0,
      Adiantamento: 0
    }],
    ValorComissaoVendedor: Number(body.valorComissaoVendedor || 0),
    CodigoPedidoCliente: arianaOrderId || body.codigoPedidoCliente || '',
    DataAprovacaoPedido: arianaSigeIsoDate(orderObj.updatedAt || orderObj.createdAt || new Date()),
    PlanoDeConta: arianaSigeResolvePlanoConta(body),
    ...(body.faturar ? { DataFaturamento: arianaSigeIsoDate(new Date()) } : {})
  };
}


function arianaSigeNormalizeVendaPayloadForSige(payload = {}, body = {}) {
  const out = { ...(payload || {}) };
  const faturar = body?.faturar === true || String(body?.faturar || '').toLowerCase() === 'true';

  if (faturar) {
    out.OrigemVenda = String(body.origemVenda || process.env.SIGE_ORIGEM_VENDA || out.OrigemVenda || 'PDV').trim();
    out.StatusSistema = String(body.statusSistema || process.env.SIGE_STATUS_SISTEMA || out.StatusSistema || 'Pedido Faturado').trim();
    if (!out.StatusSistema || out.StatusSistema === 'Pedido') out.StatusSistema = 'Pedido Faturado';
    if (!out.OrigemVenda || out.OrigemVenda === 'Ariana Marketplace') out.OrigemVenda = 'PDV';
    out.DataFaturamento = out.DataFaturamento || arianaSigeIsoDate(new Date());
  }

  out.PlanoDeConta = arianaSigeResolvePlanoConta({
    ...(body || {}),
    planoDeConta: body?.planoDeConta || body?.PlanoDeConta || out.PlanoDeConta
  });

  const documento = arianaSigeOnlyDigits(arianaSigeFirstValue(
    body?.clienteCpfCnpj,
    body?.ClienteCNPJ,
    body?.cpfCnpj,
    body?.customerDocument,
    out.ClienteCNPJ
  ));
  if (documento) out.ClienteCNPJ = documento;

  if (body && Object.prototype.hasOwnProperty.call(body, 'transportadora')) {
    out.Transportadora = String(body.transportadora || '').trim();
  }
  if (body && Object.prototype.hasOwnProperty.call(body, 'freteFormaEnvio')) {
    out.FreteFormaEnvio = String(body.freteFormaEnvio || '').trim();
  }
  if (body?.formaPagamento) {
    out.FormaPagamento = arianaSigeNormalizePayment(body.formaPagamento);
  }

  if (body?.codigoMunicipio || body?.CodigoMunicipio) {
    out.CodigoMunicipio = String(body.codigoMunicipio || body.CodigoMunicipio || '').trim();
  }
  if (body?.ufCodigo || body?.UFCodigo) {
    out.UFCodigo = String(body.ufCodigo || body.UFCodigo || '').trim();
  }
  if (!out.UFCodigo && out.UF) out.UFCodigo = arianaSigeUfCodigo(out.UF);

  if (Array.isArray(out.Items)) {
    out.Items = out.Items.map((item) => {
      const clean = { ...(item || {}) };
      if (!clean.ProductGroupId || Number(clean.ProductGroupId) <= 0) delete clean.ProductGroupId;
      return clean;
    });
  }

  if (Array.isArray(out.GruposProdutos)) {
    const gruposValidos = out.GruposProdutos.filter((grupo) => Number(grupo?.Id || 0) > 0 || String(grupo?.Nome || '').trim());
    if (gruposValidos.length) out.GruposProdutos = gruposValidos;
    else delete out.GruposProdutos;
  }

  if (Array.isArray(out.Pagamentos)) {
    out.Pagamentos = out.Pagamentos.map((pagamento) => {
      const clean = { ...(pagamento || {}) };
      if (body?.formaPagamento) clean.FormaPagamento = arianaSigeNormalizePayment(body.formaPagamento);
      if (!clean.DataTransacao || clean.DataTransacao === '0001-01-01T00:00:00') clean.DataTransacao = arianaSigeIsoDate(new Date());
      if (!clean.CondicaoPagamento || Number(clean.CondicaoPagamento) <= 0) delete clean.CondicaoPagamento;
      if (!clean.PeriodoParcelas || Number(clean.PeriodoParcelas) <= 0) delete clean.PeriodoParcelas;
      if (!clean.Adiantamento || Number(clean.Adiantamento) <= 0) delete clean.Adiantamento;
      return clean;
    });
  }

  for (const key of ['CodigoMunicipio', 'UFCodigo', 'Transportadora', 'FreteFormaEnvio', 'CodigoRastreio']) {
    if (out[key] === '') delete out[key];
  }

  return out;
}


function arianaSigeCleanObjectForPayload(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => arianaSigeCleanObjectForPayload(item))
      .filter((item) => item !== undefined && item !== null && !(typeof item === 'object' && !Array.isArray(item) && !Object.keys(item).length));
  }

  if (!value || typeof value !== 'object') return value;

  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || item === null) continue;
    if (typeof item === 'string' && item.trim() === '') continue;
    const cleaned = arianaSigeCleanObjectForPayload(item);
    if (cleaned === undefined || cleaned === null) continue;
    if (typeof cleaned === 'string' && cleaned.trim() === '') continue;
    if (Array.isArray(cleaned) && !cleaned.length) continue;
    if (typeof cleaned === 'object' && !Array.isArray(cleaned) && !Object.keys(cleaned).length) continue;
    out[key] = cleaned;
  }
  return out;
}

function arianaSigeSimplifyItemsForMinimalPayload(items = []) {
  return ensureArray(items).map((item, index) => {
    const quantidade = Number(item?.Quantidade || item?.quantidade || item?.qty || 1) || 1;
    const valorUnitario = arianaSigeMoney(arianaSigeFirstValue(item?.ValorUnitario, item?.valorUnitario, item?.unitPrice, 0));
    const valorTotal = arianaSigeMoney(arianaSigeFirstValue(item?.ValorTotal, item?.valorTotal, valorUnitario * quantidade));
    return arianaSigeCleanObjectForPayload({
      Codigo: String(item?.Codigo || item?.codigo || item?.sku || `ITEM-${index + 1}`).trim(),
      Unidade: String(item?.Unidade || item?.unidade || 'UN').trim(),
      Descricao: String(item?.Descricao || item?.descricao || item?.name || `Produto ${index + 1}`).trim(),
      Quantidade: quantidade,
      ValorUnitario: valorUnitario,
      ValorTotal: valorTotal || arianaSigeMoney(valorUnitario * quantidade),
      ValorFrete: Number(item?.ValorFrete || 0) || 0,
      DescontoUnitario: Number(item?.DescontoUnitario || 0) || 0,
      PesoKG: Number(item?.PesoKG || 0) || 0,
      Comprimento: Number(item?.Comprimento || 0) || 0,
      Altura: Number(item?.Altura || 0) || 0,
      Largura: Number(item?.Largura || 0) || 0,
      FreteGratis: item?.FreteGratis === true,
      ValorUnitarioFrete: Number(item?.ValorUnitarioFrete || 0) || 0,
      PrazoEntregaFrete: Number(item?.PrazoEntregaFrete || 0) || 0,
      Seguro: Number(item?.Seguro || 0) || 0
    });
  }).filter((item) => item.Codigo || item.Descricao);
}

function arianaSigeBuildMinimalVendaPayloadForSige(payload = {}, body = {}, mode = 'minimal') {
  const faturar = body?.faturar === true || String(body?.faturar || '').toLowerCase() === 'true';
  const formaPagamento = arianaSigeNormalizePayment(body?.formaPagamento || payload.FormaPagamento || 'Boleto');
  const valorFinal = arianaSigeMoney(payload.ValorFinal || 0);
  const parcelas = Number(payload.NumeroParcelas || body?.parcelas || 1) || 1;
  const items = arianaSigeSimplifyItemsForMinimalPayload(payload.Items || []);

  const base = {
    OrigemVenda: String(payload.OrigemVenda || process.env.SIGE_ORIGEM_VENDA || 'PDV').trim(),
    Deposito: String(payload.Deposito || process.env.SIGE_DEPOSITO || '').trim(),
    StatusSistema: String(payload.StatusSistema || (faturar ? 'Pedido Faturado' : 'Pedido')).trim(),
    Status: String(payload.Status || 'Aprovado').trim(),
    Empresa: String(payload.Empresa || process.env.SIGE_EMPRESA || '').trim(),
    Cliente: String(payload.Cliente || '').trim(),
    ClienteCNPJ: arianaSigeOnlyDigits(payload.ClienteCNPJ || body?.clienteCpfCnpj || body?.cpfCnpj || body?.ClienteCNPJ || ''),
    ClienteEmail: String(payload.ClienteEmail || '').trim(),
    ClienteTelefone: arianaSigeOnlyDigits(payload.ClienteTelefone || ''),
    PlanoDeConta: String(payload.PlanoDeConta || '').trim(),
    FormaPagamento: formaPagamento,
    NumeroParcelas: parcelas,
    ValorFinal: valorFinal,
    Items: items,
    Data: payload.Data || arianaSigeIsoDate(new Date()),
    Pagamentos: [{
      FormaPagamento: formaPagamento,
      ValorPagamento: valorFinal,
      DataTransacao: arianaSigeIsoDate(new Date()),
      Parcelas: parcelas
    }],
    CodigoPedidoCliente: String(payload.CodigoPedidoCliente || body?.codigoPedidoCliente || '').trim(),
    DataAprovacaoPedido: payload.DataAprovacaoPedido || arianaSigeIsoDate(new Date()),
    ...(faturar ? { DataFaturamento: payload.DataFaturamento || arianaSigeIsoDate(new Date()) } : {})
  };

  if (mode === 'minimal-address' || mode === 'minimal-frete') {
    Object.assign(base, {
      Municipio: payload.Municipio,
      CodigoMunicipio: payload.CodigoMunicipio,
      Pais: payload.Pais || 'Brasil',
      CEP: payload.CEP,
      UF: payload.UF,
      UFCodigo: payload.UFCodigo,
      Bairro: payload.Bairro,
      Logradouro: payload.Logradouro,
      LogradouroNumero: payload.LogradouroNumero,
      LogradouroComplemento: payload.LogradouroComplemento,
      EnderecoOpcional: false
    });
  }

  if (mode === 'minimal-frete') {
    Object.assign(base, {
      FreteMeioEnvio: payload.FreteMeioEnvio,
      ValorFrete: Number(payload.ValorFrete || 0) || 0,
      FreteContaEmitente: payload.FreteContaEmitente === true,
      ValorSeguro: Number(payload.ValorSeguro || 0) || 0,
      OutrasDespesas: Number(payload.OutrasDespesas || 0) || 0
    });
  }

  return arianaSigeCleanObjectForPayload(base);
}

function arianaSigeBuildPlanoContaPayloadVariants(payload = {}) {
  const base = arianaSigeCleanObjectForPayload({ ...(payload || {}) });
  const variants = [];

  const pushVariant = (suffix, patchFn) => {
    const clone = JSON.parse(JSON.stringify(base));
    patchFn(clone);
    variants.push({ suffix, payload: arianaSigeCleanObjectForPayload(clone) });
  };

  // 1) Primeiro tenta o nome exato que aparece no SIGE.
  pushVariant('plano-nome', (clone) => {
    clone.PlanoDeConta = 'Receitas PDV';
  });

  // 2) Depois testa sem PlanoDeConta. Em algumas contas o SIGE usa o padrÃ£o do PDV/ERP
  // ou sÃ³ exige esse campo quando ele Ã© enviado com valor nÃ£o reconhecido.
  pushVariant('sem-plano', (clone) => {
    delete clone.PlanoDeConta;
  });

  // 3) MantÃ©m o payload original como Ãºltima alternativa, apenas para debug/comparaÃ§Ã£o.
  pushVariant('original', (clone) => {
    if (payload?.PlanoDeConta !== undefined && payload?.PlanoDeConta !== null) clone.PlanoDeConta = String(payload.PlanoDeConta).trim();
  });

  const seen = new Set();
  return variants.filter((variant) => {
    const key = JSON.stringify(variant.payload || {});
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function arianaSigePayloadAttemptList(fullPayload = {}, body = {}) {
  const normalizedFull = arianaSigeNormalizeVendaPayloadForSige(fullPayload, body);
  const requestedMode = String(body?.payloadMode || body?.modoPayload || process.env.SIGE_PAYLOAD_MODE || 'minimal').trim().toLowerCase();

  const baseAttempts = [];

  if (requestedMode === 'full' || requestedMode === 'completo') {
    baseAttempts.push({ mode: 'full', payload: normalizedFull });
  } else {
    baseAttempts.push(
      { mode: 'minimal', payload: arianaSigeBuildMinimalVendaPayloadForSige(normalizedFull, body, 'minimal') },
      { mode: 'minimal-address', payload: arianaSigeBuildMinimalVendaPayloadForSige(normalizedFull, body, 'minimal-address') },
      { mode: 'minimal-frete', payload: arianaSigeBuildMinimalVendaPayloadForSige(normalizedFull, body, 'minimal-frete') }
    );

    if (requestedMode === 'debug' || requestedMode === 'fallback' || requestedMode === 'all') {
      baseAttempts.push({ mode: 'full', payload: normalizedFull });
    }
  }

  const expandedAttempts = [];
  for (const attempt of baseAttempts) {
    for (const variant of arianaSigeBuildPlanoContaPayloadVariants(attempt.payload)) {
      expandedAttempts.push({
        mode: `${attempt.mode}-${variant.suffix}`,
        payload: variant.payload
      });
    }
  }

  const seen = new Set();
  return expandedAttempts.filter((attempt) => {
    const key = `${attempt.mode}:${JSON.stringify(attempt.payload || {})}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}


function arianaSigeRawText(raw = '') {
  if (raw === undefined || raw === null) return '';
  if (typeof raw === 'string') return raw;
  try { return JSON.stringify(raw); } catch (_error) { return String(raw); }
}

function arianaSigeExtractPedidoNumberFromRaw(raw = '') {
  if (raw === undefined || raw === null) return '';
  let text = arianaSigeRawText(raw).trim();
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'string') text = parsed;
    else if (parsed && typeof parsed === 'object') text = JSON.stringify(parsed);
  } catch (_error) {}
  text = String(text || '').replace(/^"|"$/g, '').trim();
  const match = text.match(/PEDIDO\s+([0-9]+)\s+SALVO\s+COM\s+SUCESSO/i) ||
    text.match(/pedido[^0-9]{0,30}([0-9]+)/i) ||
    text.match(/([0-9]{2,})/);
  return match ? String(match[1]).trim() : '';
}

function arianaSigeExtractVendaPayload(raw = {}, fallback = {}) {
  const direct = raw?.pedido || raw?.Pedido || raw?.venda || raw?.Venda || raw?.data || raw?.Dados || raw || {};
  const pedidoNumeroRaw = arianaSigeExtractPedidoNumberFromRaw(raw);
  const codigo =
    pedidoNumeroRaw ||
    sigeFindByKeyDeep(direct, ['codigoPedido', 'codigo', 'numeroPedido', 'pedido', 'numero', 'id']) ||
    String(fallback.codigo || fallback.codigoPedido || fallback.externalOrderId || '').trim();
  const id =
    String(fallback.sigeVendaId || fallback.id || '').trim() ||
    sigeFindByKeyDeep(direct, ['id', 'pedidoId', 'vendaId', 'codigoSistema']);
  const status =
    String(fallback.status || '').trim() ||
    sigeFindByKeyDeep(direct, ['status', 'situacao', 'statusSistema']) ||
    (pedidoNumeroRaw ? 'SALVO' : '');

  return {
    id,
    codigo,
    numero: codigo,
    pedidoNumero: codigo,
    status,
    raw
  };
}

function arianaSigePickCustomerName(orderObj = {}, payload = {}, body = {}) {
  return String(arianaSigeFirstValue(
    body.customerName,
    body.nomeFantasia,
    payload.Cliente,
    orderObj.customerName,
    orderObj.user?.name,
    orderObj.customerEmail,
    'Cliente Ariana'
  )).trim();
}

function arianaSigeBuildPessoaPayloadFromOrder(order = {}, vendaPayload = {}, body = {}) {
  const orderObj = toJSON(order) || order || {};
  const shippingAddress = orderObj.shippingAddress || orderObj.shipping?.address || body.shippingAddress || {};
  const nome = arianaSigePickCustomerName(orderObj, vendaPayload, body);
  const documento = arianaSigeOnlyDigits(arianaSigeFirstValue(
    body.customerDocument,
    body.cpfCnpj,
    body.cnpjCpf,
    vendaPayload.ClienteCNPJ,
    orderObj.customerDocument,
    orderObj.customerCpf,
    orderObj.customerCnpj,
    orderObj.cpf,
    orderObj.cnpj,
    orderObj.user?.cpf,
    shippingAddress.cpf,
    shippingAddress.cnpj
  ));
  const email = String(arianaSigeFirstValue(body.customerEmail, vendaPayload.ClienteEmail, orderObj.customerEmail, orderObj.user?.email)).trim();
  const telefone = arianaSigeOnlyDigits(arianaSigeFirstValue(body.customerPhone, vendaPayload.ClienteTelefone, orderObj.customerPhone, orderObj.phone, orderObj.user?.phone));
  const cidade = String(arianaSigeFirstValue(vendaPayload.Municipio, shippingAddress.cidade, shippingAddress.city, shippingAddress.municipio)).trim();
  const uf = String(arianaSigeFirstValue(vendaPayload.UF, shippingAddress.uf, shippingAddress.state, shippingAddress.estado)).trim().toUpperCase();
  const cep = arianaSigeOnlyDigits(arianaSigeFirstValue(vendaPayload.CEP, shippingAddress.cep, shippingAddress.zipCode, shippingAddress.zip, shippingAddress.postalCode));
  const logradouro = String(arianaSigeFirstValue(vendaPayload.Logradouro, shippingAddress.logradouro, shippingAddress.rua, shippingAddress.street, shippingAddress.endereco, shippingAddress.address)).trim();
  const numero = String(arianaSigeFirstValue(vendaPayload.LogradouroNumero, shippingAddress.numero, shippingAddress.number, shippingAddress.logradouroNumero, 'S/N')).trim();
  const complemento = String(arianaSigeFirstValue(vendaPayload.LogradouroComplemento, shippingAddress.complemento, shippingAddress.complement, shippingAddress.logradouroComplemento)).trim();
  const bairro = String(arianaSigeFirstValue(vendaPayload.Bairro, shippingAddress.bairro, shippingAddress.neighborhood)).trim();
  const codigoMunicipio = String(arianaSigeFirstValue(vendaPayload.CodigoMunicipio, shippingAddress.codigoMunicipio, shippingAddress.ibge, shippingAddress.cityCode)).trim();
  const codigoUf = String(arianaSigeFirstValue(vendaPayload.UFCodigo, shippingAddress.ufCodigo, shippingAddress.codigoUf, arianaSigeUfCodigo(uf))).trim();

  const enderecoPadrao = {
    Exterior: false,
    CEP: cep,
    Logradouro: logradouro,
    Uf: uf,
    CodigoUF: codigoUf,
    Cidade: cidade,
    Numero: numero,
    Complemento: complemento,
    Bairro: bairro,
    CodigoCidade: codigoMunicipio,
    Pais: 'Brasil',
    CodigoPais: '1058'
  };

  const pessoa = {
    PessoaFisica: documento.length !== 14,
    NomeFantasia: nome,
    RazaoSocial: nome,
    CNPJ_CPF: documento,
    RG: '',
    IE: '',
    Logradouro: logradouro,
    LogradouroNumero: numero,
    Complemento: complemento,
    Bairro: bairro,
    Cidade: cidade,
    CodigoMunicipio: codigoMunicipio,
    Pais: 'Brasil',
    CodigoPais: '1058',
    CEP: cep,
    UF: uf,
    CodigoUF: codigoUf,
    Telefone: telefone,
    Celular: telefone,
    Email: email,
    Cliente: true,
    Tecnico: false,
    Vendedor: false,
    Transportadora: false,
    Fonecedor: false,
    Representada: false,
    Colaborador: false,
    Fabricante: false,
    Credenciadora: false,
    EnteGovernamental: false,
    Bloqueado: false,
    EstaInadimplente: false,
    EnderecoCobranca: enderecoPadrao,
    EnderecoPadrao: enderecoPadrao,
    EnderecosEntrega: [{
      EnderecoId: '',
      Exterior: false,
      Logradouro: logradouro,
      LogradouroNumero: numero,
      Complemento: complemento,
      Bairro: bairro,
      Cidade: cidade,
      CodigoMunicipio: codigoMunicipio,
      Pais: 'Brasil',
      CodigoPais: '1058',
      CEP: cep,
      UF: uf,
      CodigoUF: codigoUf,
      EnderecoPadrao: true,
      EntregaIE: ''
    }],
    Grupo: String(process.env.SIGE_PESSOA_GRUPO || '').trim()
  };

  // Evita enviar campos vazios que algumas contas SIGE rejeitam sem necessidade.
  for (const [key, value] of Object.entries({ ...pessoa })) {
    if (value === '' || value === undefined || value === null) delete pessoa[key];
  }

  return pessoa;
}

function arianaSigeNormalizePessoaList(raw = {}) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw?.Dados)) return raw.Dados;
  if (Array.isArray(raw?.pessoas)) return raw.pessoas;
  if (Array.isArray(raw?.Pessoas)) return raw.Pessoas;
  if (raw && typeof raw === 'object' && Object.keys(raw).length) return [raw];
  return [];
}

function arianaSigePessoaMatches(pessoa = {}, search = {}) {
  const doc = arianaSigeOnlyDigits(search.documento || '');
  const nome = String(search.nome || '').trim().toLowerCase();
  const email = String(search.email || '').trim().toLowerCase();

  const pessoaDoc = arianaSigeOnlyDigits(pessoa.CNPJ_CPF || pessoa.cnpj_cpf || pessoa.cpfCnpj || pessoa.CpfCnpj || '');
  const pessoaNome = String(pessoa.NomeFantasia || pessoa.nomeFantasia || pessoa.RazaoSocial || pessoa.razaoSocial || '').trim().toLowerCase();
  const pessoaEmail = String(pessoa.Email || pessoa.email || '').trim().toLowerCase();

  if (doc && pessoaDoc && doc === pessoaDoc) return true;
  if (email && pessoaEmail && email === pessoaEmail) return true;
  if (nome && pessoaNome && nome === pessoaNome) return true;
  return false;
}

async function arianaSigePesquisarPessoa({ nome = '', documento = '', email = '' } = {}) {
  const attempts = [];
  const cleanDoc = arianaSigeOnlyDigits(documento);
  const cleanNome = String(nome || '').trim();

  if (cleanDoc) attempts.push({ cpfCnpj: cleanDoc });
  if (cleanNome) attempts.push({ nomeFantasia: cleanNome });
  if (email) attempts.push({ nomeFantasia: String(email).trim() });

  for (const params of attempts) {
    try {
      const raw = await sigeRequest('GET', 'Pessoas/Pesquisar', { params });
      const list = arianaSigeNormalizePessoaList(raw);
      const found = list.find((pessoa) => arianaSigePessoaMatches(pessoa, { nome: cleanNome, documento: cleanDoc, email }));
      if (found) return { found: true, pessoa: found, raw, params };
      if (list.length && !cleanDoc) return { found: true, pessoa: list[0], raw, params };
    } catch (error) {
      // Pesquisa sem resultado pode variar por conta SIGE. O cadastro serÃ¡ tentado em seguida.
    }
  }

  return { found: false, pessoa: null, raw: null, params: attempts[0] || {} };
}

async function arianaSigeEnsurePessoaForOrder(order, vendaPayload = {}, body = {}) {
  const pessoaPayload = arianaSigeBuildPessoaPayloadFromOrder(order, vendaPayload, body);
  const nome = pessoaPayload.NomeFantasia || pessoaPayload.RazaoSocial || vendaPayload.Cliente || '';
  const documento = pessoaPayload.CNPJ_CPF || '';
  const email = pessoaPayload.Email || '';

  if (!nome) {
    const err = new Error('NÃ£o foi possÃ­vel cadastrar cliente no SIGE: nome do cliente ausente.');
    err.statusCode = 400;
    throw err;
  }

  const search = await arianaSigePesquisarPessoa({ nome, documento, email });
  if (search.found) {
    return {
      action: 'found',
      pessoa: search.pessoa,
      payload: pessoaPayload,
      search
    };
  }

  try {
    const raw = await sigeRequest('POST', 'Pessoas/Salvar', { data: pessoaPayload });
    return {
      action: 'created',
      pessoa: raw,
      payload: pessoaPayload,
      raw,
      search
    };
  } catch (error) {
    error.message = `NÃ£o foi possÃ­vel cadastrar o cliente no SIGE antes da venda: ${error.message || String(error)}`;
    throw error;
  }
}


function arianaSigeNormalizeProdutoList(raw = {}) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw?.Dados)) return raw.Dados;
  if (Array.isArray(raw?.produtos)) return raw.produtos;
  if (Array.isArray(raw?.Produtos)) return raw.Produtos;
  if (raw && typeof raw === 'object' && Object.keys(raw).length) return [raw];
  return [];
}

function arianaSigeNormalizeCode(value = '') {
  return String(value || '').trim().toLowerCase();
}

function arianaSigeProdutoMatches(produto = {}, item = {}) {
  const codigoItem = arianaSigeNormalizeCode(item.Codigo || item.codigo || item.sku || '');
  const nomeItem = String(item.Descricao || item.descricao || item.Nome || item.nome || '').trim().toLowerCase();
  const codigosProduto = [
    produto.Codigo,
    produto.codigo,
    produto.SKU,
    produto.Sku,
    produto.Referencia,
    produto.referencia,
    produto.CodigoProduto,
    produto.codigoProduto,
    produto.CodigoInterno,
    produto.codigoInterno
  ].map(arianaSigeNormalizeCode).filter(Boolean);
  const nomesProduto = [
    produto.Nome,
    produto.nome,
    produto.Descricao,
    produto.descricao,
    produto.NomeProduto,
    produto.nomeProduto
  ].map((v) => String(v || '').trim().toLowerCase()).filter(Boolean);

  if (codigoItem && codigosProduto.includes(codigoItem)) return true;
  if (nomeItem && nomesProduto.includes(nomeItem)) return true;
  return false;
}

function arianaSigeProdutoPayloadFromItem(item = {}, index = 0) {
  const codigo = String(item.Codigo || item.codigo || item.sku || item.productId || `ARIANA-${index + 1}`).trim();
  const nome = String(item.Descricao || item.descricao || item.name || item.Nome || codigo || `Produto Ariana ${index + 1}`).trim();
  const unidade = String(item.Unidade || item.unidade || 'UN').trim() || 'UN';
  const valor = arianaSigeMoney(arianaSigeFirstValue(item.ValorUnitario, item.valorUnitario, item.unitPrice, item.price, 0));
  const grupo = String(process.env.SIGE_PRODUTO_GRUPO || process.env.SIGE_GRUPO_PRODUTO || 'Ariana Marketplace').trim();
  const categoria = String(process.env.SIGE_PRODUTO_CATEGORIA || process.env.SIGE_CATEGORIA || 'Varejo').trim();
  const ncm = String(process.env.SIGE_PRODUTO_NCM || '').replace(/\D/g, '');

  const payload = {
    Codigo: codigo,
    Nome: nome,
    Descricao: nome,
    Unidade: unidade,
    UnidadeCompra: unidade,
    UnidadeVenda: unidade,
    UnidadeComercial: unidade,
    Grupo: grupo,
    Categoria: categoria,
    Marca: String(item.Marca || item.marca || item.brand || 'Ariana Marketplace').trim(),
    PrecoVenda: valor,
    ValorVenda: valor,
    ValorUnitario: valor,
    PrecoCusto: valor,
    EstoqueAtual: Number(process.env.SIGE_PRODUTO_ESTOQUE_PADRAO || 9999),
    Estoque: Number(process.env.SIGE_PRODUTO_ESTOQUE_PADRAO || 9999),
    Ativo: true,
    Produto: true,
    Servico: false
  };

  if (ncm) payload.NCM = ncm;
  return arianaSigeCleanObjectForPayload(payload);
}

async function arianaSigePesquisarProdutoPorItem(item = {}, index = 0) {
  const codigo = String(item.Codigo || item.codigo || item.sku || '').trim();
  const nome = String(item.Descricao || item.descricao || item.name || item.Nome || '').trim();
  const attempts = [];
  if (codigo) attempts.push({ codigo });
  if (codigo) attempts.push({ Codigo: codigo });
  if (nome) attempts.push({ nome });
  if (nome) attempts.push({ Nome: nome });
  attempts.push({ pageSize: 50, skip: 0 });

  for (const params of attempts) {
    try {
      const raw = await sigeRequest('GET', 'Produtos/Pesquisar', { params });
      const list = arianaSigeNormalizeProdutoList(raw);
      const found = list.find((produto) => arianaSigeProdutoMatches(produto, item));
      if (found) return { found: true, produto: found, raw, params };
      if (list.length && codigo) {
        const loose = list.find((produto) => String(produto.Codigo || produto.codigo || '').trim() === codigo);
        if (loose) return { found: true, produto: loose, raw, params };
      }
    } catch (error) {
      // Algumas contas retornam 404/400 quando a pesquisa nÃ£o encontra nada. Nesse caso tentamos criar.
    }
  }

  return { found: false, produto: null, raw: null, params: attempts[0] || {} };
}

async function arianaSigeCriarProdutoPorItem(item = {}, index = 0) {
  const payload = arianaSigeProdutoPayloadFromItem(item, index);
  const endpoints = Array.from(new Set([
    String(process.env.SIGE_PRODUTO_CREATE_ENDPOINT || '').replace(/^\/+/, '').trim(),
    'Produtos/Salvar',
    'Produtos/Criar',
    'Produto/Salvar',
    'Produto/Criar'
  ].filter(Boolean)));

  const errors = [];
  for (const endpoint of endpoints) {
    try {
      const raw = await sigeRequest('POST', endpoint, { data: payload });
      return { action: 'created', endpoint, produto: raw, payload, raw };
    } catch (error) {
      errors.push({ endpoint, statusCode: error.statusCode || null, error: error.message || String(error), response: redact(error.responseData || null), payload: redact(payload) });
    }
  }

  const err = new Error(`NÃ£o foi possÃ­vel cadastrar produto no SIGE antes da venda: ${payload.Codigo || payload.Nome || 'produto sem cÃ³digo'}`);
  err.statusCode = errors[0]?.statusCode || 502;
  err.responseData = { attempted: errors, payloadProduto: redact(payload) };
  throw err;
}

async function arianaSigeEnsureProdutoItem(item = {}, index = 0) {
  const search = await arianaSigePesquisarProdutoPorItem(item, index);
  if (search.found) {
    return { action: 'found', item: redact(item), produto: search.produto, search };
  }

  try {
    const created = await arianaSigeCriarProdutoPorItem(item, index);
    return { ...created, item: redact(item), search };
  } catch (error) {
    error.message = `${error.message || 'Erro ao cadastrar produto no SIGE'} â€” item ${String(item.Codigo || item.Descricao || index + 1)}`;
    throw error;
  }
}

async function arianaSigeEnsureProdutosForVendaPayload(vendaPayload = {}) {
  const items = ensureArray(vendaPayload.Items || vendaPayload.Itens || vendaPayload.items);
  const results = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item) continue;
    const result = await arianaSigeEnsureProdutoItem(item, index);
    results.push(result);
  }

  return {
    action: 'ensured',
    total: items.length,
    results
  };
}


async function arianaSigeCreateVendaForOrder(order, body = {}, req = null) {
  const selection = arianaSigeSelectArianaOrderItems(order);
  if (!selection.hasArianaItems) {
    await arianaSigeMarkOrderSkippedNonAriana(order, 'no_ariana_items');
    const err = new Error('Pedido nÃ£o enviado ao SIGE: nÃ£o possui produtos vendidos pela Ariana MÃ³veis.');
    err.statusCode = 409;
    err.code = 'SIGE_NO_ARIANA_ITEMS';
    err.responseData = { selection, message: 'Vendas de sellers/fabricantes devem ser faturadas pelo prÃ³prio seller/fabricante.' };
    throw err;
  }

  const rawPayload = arianaSigeBuildVendaPayloadFromOrder(order, body);
  const normalizedPayload = arianaSigeNormalizeVendaPayloadForSige(rawPayload, body);
  const clienteSige = await arianaSigeEnsurePessoaForOrder(order, normalizedPayload, body);
  const produtosSige = await arianaSigeEnsureProdutosForVendaPayload(normalizedPayload);
  const payloadAttempts = arianaSigePayloadAttemptList(normalizedPayload, body);
  const endpoints = arianaSigeVendaEndpointCandidates();
  const errors = [];
  let lastPayload = payloadAttempts[0]?.payload || normalizedPayload;

  for (const attempt of payloadAttempts) {
    const payload = attempt.payload;
    lastPayload = payload;

    for (const endpoint of endpoints) {
      try {
        const raw = await sigeRequest('POST', endpoint, { data: payload });
        const venda = arianaSigeExtractVendaPayload(raw, payload);
        const arianaPedidoId = String(
          payload.CodigoPedidoCliente ||
          payload.CodigoPedidoExterno ||
          payload.CodigoPedido ||
          order._id ||
          ''
        ).trim();
        const sigePedidoNumero = String(venda.codigo || venda.pedidoNumero || venda.numero || '').trim();
        const externalOrderId = sigePedidoNumero || arianaPedidoId;

        order.manufacturerDispatch = {
          ...(order.manufacturerDispatch || {}),
          externalOrderId,
          arianaPedidoId,
          sigePedidoNumero,
          sigePedidoCodigo: sigePedidoNumero,
          sigeSale: {
            ...(order.manufacturerDispatch?.sigeSale || {}),
            ...venda,
            endpoint,
            externalOrderId,
            arianaPedidoId,
            sigePedidoNumero,
            createdAt: new Date(),
            payloadMode: attempt.mode,
            payload
          },
          sigeVenda: {
            ...(order.manufacturerDispatch?.sigeVenda || {}),
            ...venda,
            endpoint,
            externalOrderId,
            arianaPedidoId,
            sigePedidoNumero,
            payloadMode: attempt.mode,
            createdAt: new Date()
          },
          sigeProdutos: produtosSige,
          sigeVendaCriadaEm: new Date()
        };
        order.status_integracao = 'sige_sale_created';
        if (!order.statusLabel || String(order.statusLabel).toLowerCase().includes('recebido')) {
          order.statusLabel = 'Venda criada no SIGE Cloud';
        }
        await order.save();

        try {
          await IntegrationAuditLog.create({
            scope: 'sige',
            eventType: 'sige.sale.created',
            orderId: String(order._id),
            manufacturer: order.manufacturer || 'ariana_moveis',
            status: 'success',
            statusCode: 200,
            message: `Venda criada no SIGE Cloud para emissÃ£o manual de NF-e usando payload ${attempt.mode}`,
            request: redact({ endpoint, payloadMode: attempt.mode, payload }),
            response: redact(raw),
            metadata: { externalOrderId, arianaPedidoId, sigePedidoNumero, sigeVendaId: venda.id, sigeCodigo: venda.codigo, payloadMode: attempt.mode, arianaItemsOnly: true, totalItems: selection.totalItems, arianaItems: selection.arianaItemsCount, externalItemsIgnored: selection.externalItemsCount }
          });
        } catch (_auditError) {}

        return { order, venda, raw, payload, payloadMode: attempt.mode, endpoint, errors, clienteSige, produtosSige, payloadAttempts: payloadAttempts.map((item) => ({ mode: item.mode, payload: item.payload })) };
      } catch (error) {
        errors.push({
          endpoint,
          payloadMode: attempt.mode,
          statusCode: error.statusCode || null,
          error: error.message || String(error),
          response: redact(error.responseData || null),
          payloadEnviadoAoSige: redact(payload)
        });
      }
    }
  }

  const err = new Error('NÃ£o foi possÃ­vel criar a venda no SIGE Cloud em nenhum endpoint configurado. Configure SIGE_VENDA_CREATE_ENDPOINT conforme o Swagger/API do SIGE da sua conta.');
  err.statusCode = errors[0]?.statusCode || 502;
  err.payload = lastPayload;
  err.clienteSige = clienteSige;
  err.responseData = {
    attempted: errors,
    payloadEnviadoAoSige: redact(lastPayload),
    payloadAttempts: payloadAttempts.map((item) => ({ mode: item.mode, payload: redact(item.payload) })),
    clienteSige: redact(clienteSige),
    produtosSige: redact(typeof produtosSige !== 'undefined' ? produtosSige : null)
  };
  throw err;
}



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

// ============================================================
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
