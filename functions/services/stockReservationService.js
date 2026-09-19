// Reserva de estoque do checkout público Ariana Móveis.
// Mantém a baixa temporária até o pagamento ser aprovado, recusado/cancelado ou expirar.
// Pedidos antigos sem stockReservation não são alterados por estas rotinas.

function normalizeMethod(value = '') {
  const method = String(value || '').trim().toLowerCase();
  if (method.includes('crediario')) return 'crediario_ariana';
  if (method.includes('boleto') || method.includes('bank_slip')) return 'boleto';
  if (method.includes('pix') || method.includes('instant')) return 'pix';
  if (method.includes('card') || method.includes('cartao') || method.includes('cartão') || method.includes('credit')) return 'card';
  return method || 'unknown';
}

function positiveMinutes(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

export function getStockReservationMinutes(method = '') {
  const normalized = normalizeMethod(method);

  if (normalized === 'card') {
    return positiveMinutes(process.env.STOCK_RESERVATION_CARD_MINUTES, 45);
  }
  if (normalized === 'pix') {
    return positiveMinutes(process.env.STOCK_RESERVATION_PIX_MINUTES, 90);
  }
  if (normalized === 'boleto') {
    return positiveMinutes(process.env.STOCK_RESERVATION_BOLETO_MINUTES, 4320);
  }
  if (normalized === 'crediario_ariana') {
    return positiveMinutes(process.env.STOCK_RESERVATION_CREDIARIO_MINUTES, 1440);
  }
  return positiveMinutes(process.env.STOCK_RESERVATION_DEFAULT_MINUTES, 120);
}

export function buildStockReservation(items = [], method = '', at = new Date()) {
  const reservedAt = at instanceof Date ? at : new Date(at || Date.now());
  const minutes = getStockReservationMinutes(method);
  const expiresAt = new Date(reservedAt.getTime() + minutes * 60 * 1000);

  return {
    status: 'reserved',
    paymentMethod: normalizeMethod(method),
    reservedAt,
    expiresAt,
    committedAt: null,
    releasedAt: null,
    releaseStartedAt: null,
    releaseReason: '',
    lastReleaseError: '',
    items: (Array.isArray(items) ? items : [])
      .map((row) => ({
        productId: String(row?.productId || row?._id || row?.id || '').trim(),
        qty: Math.max(1, Number(row?.qty || row?.quantity || 1) || 1)
      }))
      .filter((row) => row.productId)
  };
}

export function isPaidOrder(order = {}) {
  const orderStatus = String(order?.status || '').trim().toLowerCase();
  const paymentStatus = String(order?.payment?.status || order?.paymentStatus || '').trim().toLowerCase();

  return [
    'pago',
    'paid',
    'approved',
    'payment_confirmed',
    'pagamento_aprovado',
    'pagamento_autorizado'
  ].includes(orderStatus) || [
    'paid',
    'approved',
    'authorized',
    'captured',
    'paymentconfirmed',
    'payment_confirmed'
  ].includes(paymentStatus);
}

export function isTerminalUnpaidPaymentStatus(status = '') {
  return [
    'denied',
    'rejected',
    'cancelled',
    'canceled',
    'cancelado',
    'aborted',
    'voided',
    'failed',
    'expired'
  ].includes(String(status || '').trim().toLowerCase());
}

export async function commitStockReservation({ Order, orderId, reason = 'payment_approved' } = {}) {
  if (!Order || !orderId) return { ok: false, skipped: true, reason: 'missing_dependency_or_order' };

  const committedAt = new Date();
  const updated = await Order.findOneAndUpdate(
    {
      _id: orderId,
      'stockReservation.status': 'reserved'
    },
    {
      $set: {
        'stockReservation.status': 'committed',
        'stockReservation.committedAt': committedAt,
        'stockReservation.commitReason': String(reason || 'payment_approved'),
        'stockReservation.lastReleaseError': ''
      }
    },
    { new: true }
  ).catch(() => null);

  if (updated) return { ok: true, committed: true, orderId: String(updated._id) };

  const current = await Order.findById(orderId).select('stockReservation').lean().catch(() => null);
  const status = String(current?.stockReservation?.status || '');
  return {
    ok: true,
    skipped: true,
    reason: status ? `reservation_${status}` : 'reservation_not_found',
    orderId: String(orderId)
  };
}

export async function releaseStockReservation({
  Order,
  Product,
  orderId,
  reason = 'payment_failed_or_expired'
} = {}) {
  if (!Order || !Product || !orderId) {
    return { ok: false, skipped: true, reason: 'missing_dependency_or_order' };
  }

  const startedAt = new Date();
  const claimed = await Order.findOneAndUpdate(
    {
      _id: orderId,
      'stockReservation.status': 'reserved'
    },
    {
      $set: {
        'stockReservation.status': 'releasing',
        'stockReservation.releaseStartedAt': startedAt,
        'stockReservation.releaseReason': String(reason || 'payment_failed_or_expired'),
        'stockReservation.lastReleaseError': ''
      }
    },
    { new: true }
  ).catch(() => null);

  if (!claimed) {
    const current = await Order.findById(orderId).select('stockReservation').lean().catch(() => null);
    const status = String(current?.stockReservation?.status || '');
    return {
      ok: true,
      skipped: true,
      reason: status ? `reservation_${status}` : 'reservation_not_found',
      orderId: String(orderId)
    };
  }

  // Fecha a pequena janela de corrida entre expiração e confirmação de pagamento.
  const fresh = await Order.findById(orderId).lean().catch(() => null);
  if (isPaidOrder(fresh || {})) {
    await Order.updateOne(
      { _id: orderId, 'stockReservation.status': 'releasing' },
      {
        $set: {
          'stockReservation.status': 'committed',
          'stockReservation.committedAt': new Date(),
          'stockReservation.commitReason': 'payment_confirmed_during_release',
          'stockReservation.lastReleaseError': ''
        }
      }
    ).catch(() => null);

    return { ok: true, skipped: true, reason: 'payment_already_confirmed', orderId: String(orderId) };
  }

  const rows = (Array.isArray(claimed?.stockReservation?.items) ? claimed.stockReservation.items : [])
    .map((row) => ({
      productId: String(row?.productId || '').trim(),
      qty: Math.max(1, Number(row?.qty || 1) || 1)
    }))
    .filter((row) => row.productId);

  const restored = [];
  const missingProducts = [];

  try {
    for (const row of rows) {
      const product = await Product.findByIdAndUpdate(
        row.productId,
        { $inc: { stock: row.qty }, $set: { updatedAt: new Date() } },
        { new: true }
      );

      if (product) restored.push(row);
      else missingProducts.push(row.productId);
    }

    await Order.updateOne(
      { _id: orderId, 'stockReservation.status': 'releasing' },
      {
        $set: {
          'stockReservation.status': 'released',
          'stockReservation.releasedAt': new Date(),
          'stockReservation.restoredItems': restored,
          'stockReservation.missingProducts': missingProducts,
          'stockReservation.lastReleaseError': ''
        }
      }
    );

    return {
      ok: true,
      released: true,
      orderId: String(orderId),
      restoredItems: restored.length,
      missingProducts
    };
  } catch (error) {
    // Se uma devolução falhar pela metade, desfaz o que já foi devolvido e recoloca a reserva
    // como reserved para uma nova tentativa segura no próximo ciclo.
    for (const row of restored.reverse()) {
      try {
        await Product.findByIdAndUpdate(
          row.productId,
          { $inc: { stock: -row.qty }, $set: { updatedAt: new Date() } }
        );
      } catch (_) {}
    }

    await Order.updateOne(
      { _id: orderId, 'stockReservation.status': 'releasing' },
      {
        $set: {
          'stockReservation.status': 'reserved',
          'stockReservation.releaseStartedAt': null,
          'stockReservation.lastReleaseError': String(error?.message || error || 'stock_release_failed')
        }
      }
    ).catch(() => null);

    throw error;
  }
}

export async function syncStockReservationForPayment({
  Order,
  Product,
  orderId,
  paymentStatus,
  reasonPrefix = 'payment'
} = {}) {
  if (!orderId) return { ok: false, skipped: true, reason: 'order_id_missing' };

  const status = String(paymentStatus || '').trim().toLowerCase();
  if ([
    'approved',
    'paid',
    'pago',
    'authorized',
    'captured',
    'paymentconfirmed',
    'payment_confirmed',
    'pagamento_aprovado',
    'pagamento_autorizado'
  ].includes(status)) {
    return commitStockReservation({
      Order,
      orderId,
      reason: `${reasonPrefix}_${status || 'approved'}`
    });
  }

  if (isTerminalUnpaidPaymentStatus(status)) {
    return releaseStockReservation({
      Order,
      Product,
      orderId,
      reason: `${reasonPrefix}_${status}`
    });
  }

  return { ok: true, skipped: true, reason: `payment_${status || 'pending'}` };
}

export async function releaseExpiredStockReservations({
  Order,
  Product,
  limit = 100,
  logger = console
} = {}) {
  if (!Order || !Product) return { ok: false, skipped: true, reason: 'missing_dependencies' };

  const now = new Date();
  const rows = await Order.find({
    'stockReservation.status': 'reserved',
    'stockReservation.expiresAt': { $lte: now }
  })
    .select('_id status payment paymentStatus stockReservation')
    .sort({ 'stockReservation.expiresAt': 1 })
    .limit(Math.max(1, Math.min(Number(limit || 100), 500)))
    .lean();

  let released = 0;
  let committed = 0;
  let failed = 0;

  for (const order of rows) {
    try {
      if (isPaidOrder(order)) {
        const result = await commitStockReservation({
          Order,
          orderId: order._id,
          reason: 'expiry_scan_payment_already_confirmed'
        });
        if (result?.committed) committed += 1;
        continue;
      }

      const result = await releaseStockReservation({
        Order,
        Product,
        orderId: order._id,
        reason: 'reservation_expired'
      });
      if (result?.released) released += 1;
    } catch (error) {
      failed += 1;
      logger?.error?.('[stock-reservation] Falha ao liberar reserva expirada:', String(order?._id || ''), error?.message || error);
    }
  }

  return { ok: true, checked: rows.length, released, committed, failed };
}
