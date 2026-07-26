// ============================================================
// ENTERPRISE SIGE - PAYLOAD SERVICE
// Funções de montagem e normalização de payload SIGE extraídas
// de routes/enterprise/enterpriseSigeRoutes.js sem alterar regras.
// ============================================================

export function createSigePayloadService(context = {}) {
  const {
    SIGE_PLANO_CONTA,
    ensureArray,
    toJSON,
    arianaSigeOnlyDigits,
    arianaSigeMoney,
    arianaSigeFirstValue,
    arianaSigeIsoDate,
    arianaSigeNormalizePayment,
    arianaSigeSelectArianaOrderItems
  } = context;

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

  return {
    arianaSigeResolvePlanoConta,
    arianaSigeUfCodigo,
    arianaSigeBuildVendaPayloadFromOrder,
    arianaSigeNormalizeVendaPayloadForSige,
    arianaSigeCleanObjectForPayload,
    arianaSigeSimplifyItemsForMinimalPayload,
    arianaSigeBuildMinimalVendaPayloadForSige,
    arianaSigeBuildPlanoContaPayloadVariants,
    arianaSigePayloadAttemptList
  };
}
