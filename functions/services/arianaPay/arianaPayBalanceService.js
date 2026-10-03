// Ariana Pay — cálculo derivado de saldos.
// Pure function: sem banco, sem gateway, sem payout real.

function money(value = 0) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) throw new TypeError('Valor financeiro inválido.');
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function asDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isFuture(value, now) {
  const d = asDate(value);
  return Boolean(d && d.getTime() > now.getTime());
}

export function deriveSellerBalance(entries = [], { now = new Date() } = {}) {
  const balance = {
    pending: 0,
    available: 0,
    reserved: 0,
    paid: 0,
    totalEquity: 0,
    ignored: 0
  };

  for (const raw of Array.isArray(entries) ? entries : []) {
    const entry = raw || {};
    const status = String(entry.status || '').toLowerCase();
    if (['reversed', 'void'].includes(status)) {
      balance.ignored += 1;
      continue;
    }

    const type = String(entry.type || '').toLowerCase();
    const amount = money(entry.amount || 0);
    if (amount === 0) continue;

    if (type === 'reserve_hold') {
      const move = Math.min(balance.available, amount);
      balance.available = money(balance.available - move);
      balance.reserved = money(balance.reserved + move);
      continue;
    }

    if (type === 'reserve_release') {
      const move = Math.min(balance.reserved, amount);
      balance.reserved = money(balance.reserved - move);
      balance.available = money(balance.available + move);
      continue;
    }

    if (type === 'payout_debit') {
      balance.available = money(balance.available - amount);
      balance.paid = money(balance.paid + amount);
      continue;
    }

    const sign = entry.direction === 'debit' ? -1 : 1;
    const value = money(amount * sign);
    const target = isFuture(entry.availableAt, now) ? 'pending' : 'available';
    balance[target] = money(balance[target] + value);
  }

  balance.totalEquity = money(balance.pending + balance.available + balance.reserved);
  return balance;
}

export function canSchedulePayout(balance = {}, amount = 0) {
  const requested = money(amount);
  const available = money(balance.available || 0);
  return {
    ok: requested > 0 && available >= requested,
    requested,
    available,
    shortfall: money(Math.max(0, requested - available))
  };
}

export function buildPayoutPreview({
  sellerId = '',
  balance = {},
  amount = 0,
  provider = 'manual'
} = {}) {
  const check = canSchedulePayout(balance, amount);
  if (!String(sellerId || '').trim()) throw new Error('sellerId é obrigatório.');
  if (!check.ok) {
    return {
      ok: false,
      reason: check.requested <= 0 ? 'invalid_amount' : 'insufficient_available_balance',
      ...check
    };
  }

  return {
    ok: true,
    mode: 'preview_only',
    sellerId: String(sellerId).trim(),
    amount: check.requested,
    provider: String(provider || 'manual'),
    availableBefore: check.available,
    availableAfter: money(check.available - check.requested)
  };
}

export const __test = { money, asDate, isFuture };

export default {
  deriveSellerBalance,
  canSchedulePayout,
  buildPayoutPreview
};
