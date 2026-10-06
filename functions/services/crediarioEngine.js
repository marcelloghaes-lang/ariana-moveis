export const CREDIARIO_DIVISORS = Object.freeze({
  1: 0.7500, 2: 0.7400, 3: 0.7300, 4: 0.7200, 5: 0.7100,
  6: 0.7000, 7: 0.6833, 8: 0.6667, 9: 0.6500, 10: 0.6333,
  11: 0.6167, 12: 0.6000, 13: 0.5833, 14: 0.5667, 15: 0.5500
});

function integer(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export function moneyToCents(value) {
  if (Number.isInteger(value)) return value;
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100);
}

export function centsToMoney(cents) {
  return integer(cents) / 100;
}

export function getCrediarioDivisor(installmentCount) {
  const count = integer(installmentCount);
  const divisor = CREDIARIO_DIVISORS[count];
  if (!divisor) throw new Error('Quantidade de parcelas inválida. Use de 1 a 15 parcelas.');
  return divisor;
}

export function calculateCrediarioPlan({ baseAmountCents, installmentCount }) {
  const base = integer(baseAmountCents);
  const count = integer(installmentCount);
  if (base <= 0) throw new Error('Preço-base do crediário inválido.');
  const divisor = getCrediarioDivisor(count);
  const financedAmountCents = Math.round(base / divisor);
  const regularInstallmentCents = Math.floor(financedAmountCents / count);
  const installments = Array.from({ length: count }, (_, index) => ({
    number: index + 1,
    originalAmountCents: index === count - 1
      ? financedAmountCents - regularInstallmentCents * (count - 1)
      : regularInstallmentCents
  }));
  return {
    baseAmountCents: base,
    installmentCount: count,
    divisor,
    financedAmountCents,
    installments
  };
}

function dateOnly(value) {
  const date = value instanceof Date ? new Date(value) : new Date(`${String(value || '').slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

export function calculateLateAmount({ originalAmountCents, dueDate, calculationDate = new Date(), paid = false }) {
  const original = Math.max(0, integer(originalAmountCents));
  const due = dateOnly(dueDate);
  const calculation = dateOnly(calculationDate);
  if (paid || !due || !calculation || calculation <= due) {
    return { originalAmountCents: original, daysLate: 0, fineCents: 0, interestCents: 0, updatedAmountCents: original };
  }
  const daysLate = Math.max(0, Math.floor((calculation - due) / 86400000));
  const fineCents = Math.round(original * 0.02);
  const interestCents = Math.round(original * 0.01 * daysLate / 30);
  return {
    originalAmountCents: original,
    daysLate,
    fineCents,
    interestCents,
    updatedAmountCents: original + fineCents + interestCents
  };
}

export function summarizeInstallments(installments = [], calculationDate = new Date()) {
  const rows = installments.map((item) => {
    const status = String(item.status || '').toUpperCase();
    const paid = ['PAID', 'SETTLED', 'PAGA', 'QUITADO'].includes(status) || item.paid === true;
    const calc = calculateLateAmount({
      originalAmountCents: item.originalAmountCents ?? item.amountCents ?? moneyToCents(item.amount || item.valor || 0),
      dueDate: item.dueDate || item.dataVencimento,
      calculationDate,
      paid
    });
    return { ...item, ...calc, paid };
  });
  return {
    installments: rows,
    originalOpenCents: rows.filter(r => !r.paid).reduce((s, r) => s + r.originalAmountCents, 0),
    fineCents: rows.filter(r => !r.paid).reduce((s, r) => s + r.fineCents, 0),
    interestCents: rows.filter(r => !r.paid).reduce((s, r) => s + r.interestCents, 0),
    updatedOpenCents: rows.filter(r => !r.paid).reduce((s, r) => s + r.updatedAmountCents, 0),
    overdueCount: rows.filter(r => !r.paid && r.daysLate > 0).length,
    futureCount: rows.filter(r => !r.paid && r.daysLate === 0).length,
    paidCount: rows.filter(r => r.paid).length
  };
}
