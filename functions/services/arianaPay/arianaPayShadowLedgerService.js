// Ariana Pay — shadow ledger engine.
// IMPORTANT: pure/deterministic module. No database writes, no gateway calls, no payouts.
// It exists to compare a future immutable ledger with the current seller settlement calculation.

function money(value = 0) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) throw new TypeError('Valor financeiro inválido.');
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function cleanId(value = '') {
  return String(value || '').trim();
}

function cleanType(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_:-]+/g, '_');
}

function makeEntry({
  orderId,
  sellerId,
  type,
  direction,
  amount,
  availableAt = null,
  metadata = {}
}) {
  const oid = cleanId(orderId);
  const sid = cleanId(sellerId);
  const entryType = cleanType(type);
  const value = money(amount);

  if (!oid) throw new Error('orderId é obrigatório.');
  if (!sid) throw new Error('sellerId é obrigatório.');
  if (!entryType) throw new Error('type é obrigatório.');
  if (!['credit', 'debit'].includes(direction)) throw new Error('direction inválido.');
  if (value < 0) throw new Error('amount não pode ser negativo.');

  return {
    idempotencyKey: `shadow:${oid}:${sid}:${entryType}`,
    orderId: oid,
    sellerId: sid,
    type: entryType,
    direction,
    amount: value,
    currency: 'BRL',
    status: 'shadow',
    availableAt: availableAt || null,
    provider: 'shadow',
    metadata: {
      source: 'current_marketplace_settlement',
      ...metadata
    }
  };
}

export function buildShadowLedgerEntries({
  order = {},
  sellerId = '',
  settlement = {},
  availableAt = null,
  release = null
} = {}) {
  const orderId = cleanId(order._id || order.id || order.orderId);
  const sid = cleanId(sellerId);
  if (!orderId) throw new Error('Pedido sem identificador.');
  if (!sid) throw new Error('Seller sem identificador.');

  const gross = money(settlement.gross || 0);
  const commission = money(settlement.commission ?? settlement.fee ?? 0);
  const expectedNet = money(settlement.net ?? (gross - commission));

  if (gross < 0 || commission < 0 || expectedNet < 0) {
    throw new Error('Settlement contém valores negativos.');
  }
  if (commission > gross) {
    throw new Error('Comissão maior que o bruto do seller.');
  }

  const entries = [];

  if (gross > 0) {
    entries.push(makeEntry({
      orderId,
      sellerId: sid,
      type: 'sale_credit',
      direction: 'credit',
      amount: gross,
      availableAt,
      metadata: {
        settlementMode: String(settlement.settlementMode || ''),
        marketplaceGross: money(settlement.marketplaceGross || 0),
        managedGross: money(settlement.managedGross || 0),
        releaseState: String(release?.state || ''),
        releaseReason: String(release?.reason || ''),
        transferDeadlineDays: release?.transferDeadlineDays ?? null,
        deliverySource: String(release?.delivery?.source || ''),
        deliveryConfidence: String(release?.delivery?.confidence || '')
      }
    }));
  }

  if (commission > 0) {
    entries.push(makeEntry({
      orderId,
      sellerId: sid,
      type: 'commission_debit',
      direction: 'debit',
      amount: commission,
      availableAt,
      metadata: {
        commissionPercent: Number(settlement.commissionPercent || 0),
        releaseState: String(release?.state || ''),
        releaseReason: String(release?.reason || '')
      }
    }));
  }

  const summary = summarizeShadowLedger(entries);
  const difference = money(summary.net - expectedNet);

  return {
    mode: 'shadow',
    orderId,
    sellerId: sid,
    expectedNet,
    entries,
    summary,
    reconciliation: {
      ok: Math.abs(difference) < 0.01,
      difference
    }
  };
}

export function summarizeShadowLedger(entries = []) {
  let credits = 0;
  let debits = 0;

  for (const entry of Array.isArray(entries) ? entries : []) {
    const amount = money(entry?.amount || 0);
    if (entry?.direction === 'credit') credits += amount;
    else if (entry?.direction === 'debit') debits += amount;
  }

  credits = money(credits);
  debits = money(debits);

  return {
    credits,
    debits,
    net: money(credits - debits)
  };
}

export function reconcileShadowSettlement(input = {}) {
  const result = buildShadowLedgerEntries(input);
  return {
    ok: result.reconciliation.ok,
    difference: result.reconciliation.difference,
    expectedNet: result.expectedNet,
    ledgerNet: result.summary.net,
    entryCount: result.entries.length
  };
}

export const __test = {
  money,
  makeEntry
};

export default {
  buildShadowLedgerEntries,
  summarizeShadowLedger,
  reconcileShadowSettlement
};
