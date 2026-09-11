// ============================================================
// ESTOQUE - RESERVA SEGURA DO CHECKOUT
// Mantém a baixa imediata feita na criação do pedido, mas registra
// a reserva para permitir confirmação, devolução e reaquisição sem
// duplicar incremento/decremento de estoque.
// ============================================================

function normalizeMethod(value = '') {
  const method = String(value || '').trim().toLowerCase();
  if (!method) return '';
  if (method.includes('pix')) return 'pix';
  if (method.includes('boleto') || method === 'bolbradesco') return 'boleto';
  if (method === 'card' || method === 'credit' || method === 'credit_card' || method.includes('cartao') || method.includes('cartão') || method.includes('credit')) return 'card';
  if (method.includes('crediario')) return 'crediario_ariana';
  return method;
}

function positiveInt(value, fallback = 1) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.max(1, Math.floor(n));
}

function envMinutes(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function reservationTtlMs(method = '') {
  const normalized = normalizeMethod(method);
  const minutes = normalized === 'card'
    ? envMinutes('STOCK_RESERVATION_CARD_MINUTES', 30)
    : normalized === 'pix'
      ? envMinutes('STOCK_RESERVATION_PIX_MINUTES', 120)
      : normalized === 'boleto'
        ? envMinutes('STOCK_RESERVATION_BOLETO_MINUTES', 5760) // 4 dias
        : normalized === 'crediario_ariana'
          ? envMinutes('STOCK_RESERVATION_CREDIARIO_MINUTES', 2880) // 48h
          : envMinutes('STOCK_RESERVATION_DEFAULT_MINUTES', 120);
  return Math.max(5, minutes) * 60 * 1000;
}

export function buildStockReservation(items = [], method = '', at = new Date()) {
  const reservedAt = at instanceof Date ? at : new Date(at || Date.now());
  const normalizedMethod = normalizeMethod(method);
  const safeItems = (Array.isArray(items) ? items : [])
    .map((item = {}) => ({
      productId: String(item.productId || item._id || item.id || '').trim(),
      qty: positiveInt(item.qty ?? item.quantity ?? 1, 1)
    }))
    .filter((item) => item.productId);

  return {
    version: 1,
    status: 'reserved',
    method: normalizedMethod,
    reservedAt,
    expiresAt: new Date(reservedAt.getTime() + reservationTtlMs(normalizedMethod)),
    items: safeItems,
    releasedAt: null,
    committedAt: null,
    updatedAt: reservedAt
  };
}

function orderIdValue(orderId) {
  return String(orderId || '').trim();
}

function reservationItems(order = {}) {
  const source = Array.isArray(order?.stockReservation?.items) && order.stockReservation.items.length
    ? order.stockReservation.items
    : (Array.isArray(order?.items) ? order.items : []);
  return source
    .map((item = {}) => ({
      productId: String(item.productId || item._id || item.id || '').trim(),
      qty: positiveInt(item.qty ?? item.quantity ?? 1, 1)
    }))
    .filter((item) => item.productId);
}

export async function releaseStockReservation({ Order, Product, orderId, reason = 'payment_not_completed', at = new Date() } = {}) {
  if (!Order || !Product) return { ok: false, skipped: true, reason: 'models_missing' };
  const id = orderIdValue(orderId);
  if (!id) return { ok: false, skipped: true, reason: 'order_id_missing' };
  const now = at instanceof Date ? at : new Date(at || Date.now());
  const releaseToken = `${id}:${now.getTime()}:${Math.random().toString(36).slice(2, 10)}`;

  const claimed = await Order.findOneAndUpdate(
    { _id: id, 'stockReservation.status': 'reserved' },
    {
      $set: {
        'stockReservation.status': 'releasing',
        'stockReservation.releaseToken': releaseToken,
        'stockReservation.releaseReason': String(reason || '').slice(0, 200),
        'stockReservation.releaseStartedAt': now,
        'stockReservation.updatedAt': now
      }
    },
    { new: true }
  ).catch(() => null);

  if (!claimed) {
    const current = await Order.findById(id).select('stockReservation status payment.status').lean().catch(() => null);
    return {
      ok: true,
      skipped: true,
      reason: current?.stockReservation?.status || 'reservation_missing',
      status: current?.stockReservation?.status || ''
    };
  }

  const items = reservationItems(claimed);
  try {
    if (items.length) {
      await Product.bulkWrite(
        items.map((item) => ({
          updateOne: {
            filter: { _id: item.productId },
            update: { $inc: { stock: item.qty }, $set: { updatedAt: now } }
          }
        })),
        { ordered: true }
      );
    }

    await Order.updateOne(
      { _id: id, 'stockReservation.releaseToken': releaseToken, 'stockReservation.status': 'releasing' },
      {
        $set: {
          'stockReservation.status': 'released',
          'stockReservation.releasedAt': now,
          'stockReservation.updatedAt': now
        },
        $unset: { 'stockReservation.releaseToken': '', 'stockReservation.releaseStartedAt': '' }
      }
    );

    return { ok: true, released: true, items: items.length };
  } catch (error) {
    await Order.updateOne(
      { _id: id, 'stockReservation.releaseToken': releaseToken },
      {
        $set: {
          'stockReservation.status': 'release_error',
          'stockReservation.releaseError': String(error?.message || error || 'stock_release_failed').slice(0, 500),
          'stockReservation.updatedAt': new Date()
        }
      }
    ).catch(() => null);
    return { ok: false, released: false, reviewRequired: true, error: error?.message || String(error) };
  }
}

async function reacquireReleasedReservation({ Order, Product, order, reason = 'late_payment_approved' } = {}) {
  const id = orderIdValue(order?._id || order?.id);
  if (!id) return { ok: false, reason: 'order_id_missing' };
  const now = new Date();
  const token = `${id}:${now.getTime()}:${Math.random().toString(36).slice(2, 10)}`;

  const claimed = await Order.findOneAndUpdate(
    { _id: id, 'stockReservation.status': 'released' },
    {
      $set: {
        'stockReservation.status': 'reacquiring',
        'stockReservation.reacquireToken': token,
        'stockReservation.reacquireStartedAt': now,
        'stockReservation.updatedAt': now
      }
    },
    { new: true }
  ).catch(() => null);

  if (!claimed) {
    const current = await Order.findById(id).select('stockReservation').lean().catch(() => null);
    const status = String(current?.stockReservation?.status || '');
    return { ok: status === 'committed', status, reason: status || 'reacquire_not_claimed' };
  }

  const reacquired = [];
  const items = reservationItems(claimed);
  try {
    for (const item of items) {
      const product = await Product.findOneAndUpdate(
        { _id: item.productId, active: { $ne: false }, stock: { $gte: item.qty } },
        { $inc: { stock: -item.qty }, $set: { updatedAt: now } },
        { new: true }
      );
      if (!product) {
        const error = new Error(`Estoque insuficiente para revalidar o produto ${item.productId}.`);
        error.productId = item.productId;
        throw error;
      }
      reacquired.push(item);
    }

    await Order.updateOne(
      { _id: id, 'stockReservation.reacquireToken': token, 'stockReservation.status': 'reacquiring' },
      {
        $set: {
          'stockReservation.status': 'committed',
          'stockReservation.committedAt': now,
          'stockReservation.commitReason': String(reason || '').slice(0, 200),
          'stockReservation.updatedAt': now
        },
        $unset: { 'stockReservation.reacquireToken': '', 'stockReservation.reacquireStartedAt': '' }
      }
    );
    return { ok: true, committed: true, reacquired: true, items: reacquired.length };
  } catch (error) {
    for (const item of reacquired.reverse()) {
      await Product.findByIdAndUpdate(
        item.productId,
        { $inc: { stock: item.qty }, $set: { updatedAt: new Date() } }
      ).catch(() => null);
    }
    await Order.updateOne(
      { _id: id, 'stockReservation.reacquireToken': token },
      {
        $set: {
          'stockReservation.status': 'reacquire_failed',
          'stockReservation.reacquireError': String(error?.message || error || 'stock_reacquire_failed').slice(0, 500),
          'stockReservation.failedProductId': String(error?.productId || ''),
          'stockReservation.updatedAt': new Date()
        },
        $unset: { 'stockReservation.reacquireToken': '', 'stockReservation.reacquireStartedAt': '' }
      }
    ).catch(() => null);
    return { ok: false, reviewRequired: true, reason: 'stock_unavailable_after_release', error: error?.message || String(error) };
  }
}

export async function finalizeStockReservationForApprovedPayment({ Order, Product, orderId, reason = 'payment_approved' } = {}) {
  if (!Order || !Product) return { ok: false, reviewRequired: true, reason: 'models_missing' };
  const id = orderIdValue(orderId);
  if (!id) return { ok: false, reviewRequired: true, reason: 'order_id_missing' };
  const order = await Order.findById(id).select('stockReservation items status payment.status').lean().catch(() => null);
  if (!order) return { ok: false, reviewRequired: true, reason: 'order_not_found' };

  const status = String(order?.stockReservation?.status || '').trim().toLowerCase();
  // Pedidos antigos não tinham marcador. Não baixa estoque novamente para evitar dupla baixa.
  if (!status) return { ok: true, legacy: true, reason: 'legacy_order_without_reservation_marker' };
  if (status === 'committed') return { ok: true, committed: true, reused: true };
  if (status === 'released') return reacquireReleasedReservation({ Order, Product, order, reason });
  if (status !== 'reserved') return { ok: false, reviewRequired: true, reason: `reservation_${status || 'unknown'}` };

  const now = new Date();
  const committed = await Order.findOneAndUpdate(
    { _id: id, 'stockReservation.status': 'reserved' },
    {
      $set: {
        'stockReservation.status': 'committed',
        'stockReservation.committedAt': now,
        'stockReservation.commitReason': String(reason || '').slice(0, 200),
        'stockReservation.updatedAt': now
      }
    },
    { new: true }
  ).catch(() => null);

  if (committed) return { ok: true, committed: true };
  const fresh = await Order.findById(id).select('stockReservation').lean().catch(() => null);
  return { ok: String(fresh?.stockReservation?.status || '') === 'committed', status: fresh?.stockReservation?.status || '' };
}

export async function releaseStockReservationForFailedPayment({ Order, Product, orderId, reason = 'payment_failed' } = {}) {
  return releaseStockReservation({ Order, Product, orderId, reason, at: new Date() });
}

export async function sweepExpiredStockReservations({ Order, Product, limit = 50 } = {}) {
  if (!Order || !Product) return { ok: false, skipped: true, reason: 'models_missing' };
  const now = new Date();
  const rows = await Order.find({
    'stockReservation.status': 'reserved',
    'stockReservation.expiresAt': { $lte: now },
    status: { $nin: ['pago', 'paid', 'pagamento_autorizado', 'payment_review'] },
    'payment.status': { $nin: ['approved', 'paid', 'captured', 'authorized'] }
  })
    .select('_id stockReservation status payment.status')
    .sort({ 'stockReservation.expiresAt': 1 })
    .limit(Math.max(1, Math.min(Number(limit || 50), 200)))
    .lean()
    .catch(() => []);

  let released = 0;
  let reviewRequired = 0;
  for (const row of rows) {
    const result = await releaseStockReservation({
      Order,
      Product,
      orderId: row._id,
      reason: 'reservation_expired',
      at: new Date()
    });
    if (result?.released) released += 1;
    if (result?.reviewRequired) reviewRequired += 1;
  }
  return { ok: true, checked: rows.length, released, reviewRequired };
}

export function startStockReservationSweeper({ Order, Product } = {}) {
  if (!Order || !Product) return false;
  if (globalThis.__arianaStockReservationSweeperStarted) return true;
  globalThis.__arianaStockReservationSweeperStarted = true;

  const run = () => {
    sweepExpiredStockReservations({ Order, Product, limit: Number(process.env.STOCK_RESERVATION_SWEEP_LIMIT || 50) })
      .then((result) => {
        if (result?.released || result?.reviewRequired) {
          console.log('[STOCK RESERVATION]', result);
        }
      })
      .catch((error) => console.error('[STOCK RESERVATION] sweep error:', error?.message || error));
  };

  const intervalMs = Math.max(5, Number(process.env.STOCK_RESERVATION_SWEEP_MINUTES || 15)) * 60 * 1000;
  setTimeout(run, Math.min(120000, intervalMs));
  const timer = setInterval(run, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return true;
}
