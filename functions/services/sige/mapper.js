function onlyDigits(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function money(value = 0) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function isoDate(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function addressFromOrder(order = {}) {
  const a = order.shippingAddress || order.address || {};
  return {
    Logradouro: a.logradouro || a.street || a.endereco || '',
    Numero: a.numero || a.number || 'S/N',
    Complemento: a.complemento || a.complement || '',
    Bairro: a.bairro || a.neighborhood || '',
    Municipio: a.cidade || a.city || '',
    UF: a.uf || a.state || '',
    CEP: onlyDigits(a.cep || a.zipCode || '')
  };
}

export function buildSigePedidoPayload(order = {}, options = {}) {
  const orderId = String(order._id || order.id || order.orderId || '').trim();
  const shortCode = orderId ? Number.parseInt(orderId.replace(/\D/g, '').slice(-8), 10) || Date.now() : Date.now();
  const customerDoc = onlyDigits(order.customerCpf || order.cpf || order.customerDocument || order.shippingAddress?.cpf || '');
  const endereco = addressFromOrder(order);
  const items = Array.isArray(order.items) ? order.items : [];
  const paymentMethod = String(order.payment?.method || order.payment?.type || order.paymentMethod || 'Outros').trim();
  const total = money(order.total || items.reduce((s, i) => s + money(i.totalPrice || i.unitPrice * i.qty), 0));
  const frete = money(order.shippingCost || order.shipping?.price || 0);

  return {
    Codigo: options.codigo || shortCode,
    CodigoPedidoCliente: orderId || options.codigoPedidoCliente || '',
    OrigemVenda: options.origemVenda || 'Ariana Marketplace',
    Tabela: options.tabela || 'Tabela Padrão',
    Deposito: options.deposito || process.env.SIGE_DEPOSITO || 'Depósito Padrão',
    StatusSistema: options.statusSistema || 'Pedido',
    Status: options.status || 'Aprovado',
    Categoria: options.categoria || 'Varejo',
    Validade: isoDate(order.createdAt || new Date()),
    Empresa: options.empresa || process.env.SIGE_EMPRESA || 'Ariana Móveis',
    Cliente: order.customerName || order.customerEmail || 'Cliente Ariana',
    ClienteCNPJ: customerDoc,
    ClienteEmail: order.customerEmail || '',
    ClienteTelefone: onlyDigits(order.customerPhone || order.phone || ''),
    ...endereco,
    Itens: items.map((item) => ({
      Codigo: String(item.sku || item.productId || '').trim(),
      Unidade: 'UN',
      Descricao: item.name || item.description || 'Produto Ariana',
      Quantidade: Number(item.qty || item.quantity || 1),
      ValorUnitario: money(item.unitPrice || item.price || 0),
      ValorTotal: money(item.totalPrice || (Number(item.qty || 1) * money(item.unitPrice || item.price || 0)))
    })),
    Pagamentos: [{
      FormaPagamento: paymentMethod,
      Valor: total,
      Parcelas: Number(order.payment?.installments || 1),
      PeriodoParcelas: 0,
      Adiantamento: 0
    }],
    ValorFrete: frete,
    FreteContaEmitente: frete <= 0,
    Transportadora: order.shipping?.carrier || order.shipping?.provider || '',
    FreteFormaEnvio: order.shipping?.service || '',
    CodigoRastreio: order.trackingCode || '',
    Observacoes: [
      `Pedido Ariana: ${orderId || '-'}`,
      order.notes ? `Observações: ${order.notes}` : '',
      options.observacoes || ''
    ].filter(Boolean).join('\n'),
    DataAprovacaoPedido: isoDate(order.updatedAt || order.createdAt || new Date()),
    DataFaturamento: options.dataFaturamento || undefined
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
