function onlyDigits(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function rawNumber(value = 0) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = String(value ?? '').trim();
  if (!text) return 0;
  const normalized = text.includes(',')
    ? text.replace(/\./g, '').replace(',', '.')
    : text;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function money(value = 0, referenceTotal = 0) {
  let n = rawNumber(value);
  const ref = rawNumber(referenceTotal);

  // Proteção para valores salvos em centavos por engano: 1099 => 10.99,
  // 2198 => 21.98. Só aplica quando o valor fica incompatível com o total do pedido.
  if (n > 0 && ref > 0 && n > ref * 3) n = n / 100;
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function isoDate(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function firstValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function addressFromOrder(order = {}) {
  const a = order.shippingAddress || order.address || order.shipping?.address || {};
  return {
    Logradouro: String(firstValue(a.logradouro, a.rua, a.street, a.endereco, a.address)).trim(),
    LogradouroNumero: String(firstValue(a.numero, a.number, a.logradouroNumero, 'S/N')).trim(),
    LogradouroComplemento: String(firstValue(a.complemento, a.complement, a.logradouroComplemento)).trim(),
    Bairro: String(firstValue(a.bairro, a.neighborhood)).trim(),
    Municipio: String(firstValue(a.cidade, a.city, a.municipio)).trim(),
    CodigoMunicipio: String(firstValue(a.codigoMunicipio, a.ibge, a.cityCode)).trim(),
    Pais: String(firstValue(a.pais, a.country, 'Brasil')).trim(),
    CEP: onlyDigits(firstValue(a.cep, a.zipCode, a.zip, a.postalCode)),
    UF: String(firstValue(a.uf, a.state, a.estado)).trim().toUpperCase(),
    UFCodigo: String(firstValue(a.ufCodigo, a.codigoUf)).trim()
  };
}

function normalizePaymentMethod(value = '') {
  const text = String(value || '').trim().toLowerCase();
  if (text.includes('boleto')) return 'Boleto';
  if (text.includes('pix')) return 'Pix';
  if (text.includes('cart') || text.includes('credit')) return 'Cartão de Crédito';
  if (text.includes('pagar')) return 'Pagar.me';
  if (text.includes('mercado')) return 'Mercado Pago';
  return String(value || 'Outros').trim() || 'Outros';
}

function buildItems(order = {}, referenceTotal = 0) {
  const items = Array.isArray(order.items) ? order.items : [];
  const subtotal = money(order.subtotal || 0, 0);
  const totalQty = items.reduce((sum, item) => sum + (Number(item.qty || item.quantity || 1) || 1), 0) || 1;

  return items.map((item, index) => {
    const qty = Number(item.qty || item.quantity || 1) || 1;
    const fallbackUnitFromSubtotal = subtotal > 0 ? subtotal / totalQty : 0;
    const rawUnit = firstValue(
      item.sellerBaseUnitPrice,
      item.pixUnitPrice,
      item.baseUnitPrice,
      item.unitPrice,
      item.price,
      fallbackUnitFromSubtotal
    );
    const unitPrice = money(rawUnit, referenceTotal || subtotal || order.total || 0);
    const totalItem = money(firstValue(item.sellerBaseTotal, item.totalPrice, unitPrice * qty), referenceTotal || subtotal || order.total || 0);

    return {
      Codigo: String(firstValue(item.sku, item.productSku, item.productId, item.codigo, `ITEM-${index + 1}`)).trim(),
      Unidade: String(firstValue(item.unidade, 'UN')).trim(),
      Descricao: String(firstValue(item.name, item.description, item.descricao, item.sku, 'Produto Ariana')).trim(),
      Quantidade: qty,
      ValorUnitario: unitPrice,
      ValorFrete: 0,
      DescontoUnitario: 0,
      ValorTotal: totalItem || money(unitPrice * qty),
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
}

export function buildSigePedidoPayload(order = {}, options = {}) {
  const orderId = String(order._id || order.id || order.orderId || '').trim();
  const shortCode = orderId ? Number.parseInt(orderId.replace(/\D/g, '').slice(-8), 10) || Date.now() : Date.now();
  const total = money(firstValue(order.total, order.subtotal, options.total), 0);
  const frete = money(firstValue(order.shippingCost, order.shipping?.price, options.shippingCost, 0), total);
  const items = buildItems(order, total || order.subtotal || 0);
  const itemsTotal = money(items.reduce((sum, item) => sum + money(item.ValorTotal), 0));
  const valorFinal = total || money(itemsTotal + frete);
  const payment = order.payment || options.payment || {};
  const formaPagamento = normalizePaymentMethod(firstValue(options.formaPagamento, payment.method, payment.paymentMethod, payment.type, 'Outros'));
  const parcelas = Number(firstValue(options.parcelas, payment.installments, payment.parcelas, 1)) || 1;
  const endereco = addressFromOrder(order);

  const customerDoc = onlyDigits(firstValue(
    options.customerDocument,
    options.cpfCnpj,
    order.customerDocument,
    order.customerCpf,
    order.customerCnpj,
    order.cpf,
    order.cnpj,
    order.user?.cpf,
    order.shippingAddress?.cpf,
    order.shippingAddress?.cnpj
  ));

  return {
    Codigo: options.codigo || shortCode,
    OrigemVenda: options.origemVenda || 'Ariana Marketplace',
    Tabela: options.tabela || process.env.SIGE_TABELA || 'Tabela Padrão',
    Deposito: options.deposito || process.env.SIGE_DEPOSITO || 'Depósito Padrão',
    StatusSistema: options.statusSistema || 'Pedido',
    Status: options.status || 'Aprovado',
    Categoria: options.categoria || 'Varejo',
    Validade: isoDate(order.createdAt || new Date()),
    Empresa: options.empresa || process.env.SIGE_EMPRESA || 'Ariana Móveis',
    Cliente: String(firstValue(options.customerName, order.customerName, order.user?.name, order.customerEmail, 'Cliente Ariana')).trim(),
    ClienteCNPJ: customerDoc,
    ClienteEmail: String(firstValue(options.customerEmail, order.customerEmail, order.user?.email)).trim(),
    ClienteTelefone: onlyDigits(firstValue(options.customerPhone, order.customerPhone, order.phone, order.user?.phone)),
    Vendedor: options.vendedor || process.env.SIGE_VENDEDOR || '',
    PlanoDeConta: options.planoDeConta || process.env.SIGE_PLANO_CONTA || '',
    FormaPagamento: formaPagamento,
    NumeroParcelas: parcelas,
    FreteMeioEnvio: Number(options.freteMeioEnvio || process.env.SIGE_FRETE_MEIO_ENVIO || 1),
    Transportadora: String(firstValue(options.transportadora, order.shipping?.carrier, order.shipping?.provider)).trim(),
    FreteFormaEnvio: String(firstValue(options.freteFormaEnvio, order.shipping?.service, order.shipping?.serviceName)).trim(),
    DataEnvio: options.dataEnvio || undefined,
    PrevisaoEntrega: options.previsaoEntrega || undefined,
    DataPostagem: options.dataPostagem || undefined,
    Enviado: false,
    ValorFrete: frete,
    FreteContaEmitente: frete <= 0,
    CodigoRastreio: String(firstValue(order.trackingCode, options.codigoRastreio)).trim(),
    EnderecoOpcional: false,
    ValorSeguro: 0,
    Descricao: options.descricao || `Pedido Ariana: ${orderId || '-'}`,
    OutrasDespesas: 0,
    ValorFinal: valorFinal,
    Finalizado: false,
    Lancado: false,
    ...endereco,
    GruposProdutos: [{ Id: 0, Nome: 'Ariana Marketplace' }],
    Items: items,
    Data: isoDate(order.createdAt || new Date()),
    Pagamentos: [{
      FormaPagamento: formaPagamento,
      ValorPagamento: valorFinal,
      DataTransacao: payment.paidAt || payment.createdAt || '0001-01-01T00:00:00',
      CondicaoPagamento: Number(options.condicaoPagamento || 0),
      Parcelas: parcelas,
      PeriodoParcelas: 0,
      Adiantamento: 0
    }],
    ValorComissaoVendedor: Number(options.valorComissaoVendedor || 0),
    CodigoPedidoCliente: orderId || options.codigoPedidoCliente || '',
    DataAprovacaoPedido: isoDate(order.updatedAt || order.createdAt || new Date()),
    ...(options.faturar ? { DataFaturamento: isoDate(new Date()) } : {})
  };
}

export function extractInvoiceFromSige(raw = {}) {
  const data = Array.isArray(raw) ? raw[0] || {} : raw || {};
  return {
    number: String(data.NumeroNFe || data.numeroNFe || data.NFe || data.NF || data.numero || '').trim(),
    serie: String(data.SerieNFe || data.serie || data.Serie || '').trim(),
    accessKey: String(data.ChaveAcessoNFe || data.chaveAcesso || data.chave || data.Chave || '').trim(),
    protocol: String(data.ProtocoloNFe || data.protocolo || data.Protocolo || '').trim(),
    xmlUrl: String(data.XmlUrl || data.xmlUrl || data.UrlXml || data.urlXml || '').trim(),
    danfeUrl: String(data.DanfeUrl || data.danfeUrl || data.UrlDanfe || data.urlDanfe || data.PdfUrl || '').trim(),
    status: String(data.StatusNFe || data.statusNFe || data.Status || '').trim(),
    raw: data
  };
}
