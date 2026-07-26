// ============================================================
// ENTERPRISE SIGE - VENDA SERVICE
// Funções de criação/sincronização de venda no SIGE extraídas
// de routes/enterprise/enterpriseSigeRoutes.js sem alterar regras.
// ============================================================

export function createSigeVendaService(context = {}) {
  const {
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
  } = context;

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


  return {
    arianaSigeVendaEndpointCandidates,
    arianaSigeMarkOrderSkippedNonAriana,
    arianaSigeSyncOwnOrderAfterPayment,
    arianaSigeRawText,
    arianaSigeExtractPedidoNumberFromRaw,
    arianaSigeExtractVendaPayload,
    arianaSigeCreateVendaForOrder
  };
}
