function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

export function riskLevelFromScore(score = 0) {
  const value = clamp(score, 0, 1000);
  if (value <= 300) return 'ALTO';
  if (value <= 600) return 'MEDIO';
  if (value <= 800) return 'BOM';
  return 'EXCELENTE';
}

export function calculateArianaScore(profile = {}) {
  let score = 500;
  const paidOnTime = Number(profile.installmentsPaidOnTime || 0);
  const paidLate = Number(profile.installmentsPaidLate || 0);
  const totalPaid = paidOnTime + paidLate;
  const lateRatio = totalPaid > 0 ? paidLate / totalPaid : 0;
  const averageDaysLate = Math.max(0, Number(profile.averageDaysLate || 0));
  const maximumDaysLate = Math.max(0, Number(profile.maximumDaysLate || 0));
  const settled = Math.max(0, Number(profile.settledPurchasesCount || 0));
  const renegotiations = Math.max(0, Number(profile.renegotiationsCount || 0));
  const cancelled = Math.max(0, Number(profile.cancelledPurchasesCount || 0));
  const returned = Math.max(0, Number(profile.returnedPurchasesCount || 0));
  const incomeCents = Math.max(0, Number(profile.monthlyIncomeCents || 0));
  const employedMonths = Math.max(0, Number(profile.employmentMonths || 0));
  const customerMonths = Math.max(0, Number(profile.customerSinceMonths || 0));
  const limit = Math.max(0, Number(profile.creditLimitCents || 0));
  const used = Math.max(0, Number(profile.usedLimitCents || 0));
  const utilization = limit > 0 ? used / limit : 0;

  score += Math.min(160, paidOnTime * 4);
  score += Math.min(100, settled * 12);
  score += Math.min(60, Math.floor(customerMonths / 3) * 3);
  score += Math.min(40, Math.floor(employedMonths / 6) * 4);
  score += incomeCents >= 500000 ? 35 : incomeCents >= 250000 ? 20 : incomeCents > 0 ? 8 : 0;

  score -= Math.round(lateRatio * 260);
  score -= Math.min(160, Math.round(averageDaysLate * 4));
  score -= Math.min(180, Math.round(maximumDaysLate * 3));
  score -= Math.min(160, renegotiations * 45);
  score -= Math.min(80, cancelled * 15);
  score -= Math.min(80, returned * 12);
  if (utilization > 1) score -= 180;
  else if (utilization > 0.9) score -= 100;
  else if (utilization > 0.75) score -= 45;
  else if (limit > 0 && utilization < 0.4) score += 25;

  const finalScore = Math.round(clamp(score, 0, 1000));
  return {
    score: finalScore,
    riskLevel: riskLevelFromScore(finalScore),
    metrics: { lateRatio, averageDaysLate, maximumDaysLate, utilization }
  };
}

export function suggestCreditDecision({ profile = {}, financedAmountCents = 0, checklist = {} } = {}) {
  const scoreData = calculateArianaScore(profile);
  const limit = Math.max(0, Number(profile.creditLimitCents || 0));
  const used = Math.max(0, Number(profile.usedLimitCents || 0));
  const available = Math.max(0, limit - used);
  const amount = Math.max(0, Number(financedAmountCents || 0));
  const missingRequired = ['cpfChecked', 'identityDocument', 'residenceProof', 'incomeChecked', 'contactConfirmed']
    .filter((key) => !checklist?.[key]);

  let suggestion = 'ANALISAR';
  const reasons = [];
  if (missingRequired.length) reasons.push(`Checklist incompleto: ${missingRequired.length} item(ns).`);
  if (profile.openOverdueInstallments > 0 || profile.maximumDaysLate >= 60) {
    suggestion = 'REPROVAR';
    reasons.push('Há atraso grave ou parcelas vencidas em aberto.');
  } else if (limit > 0 && amount > available) {
    suggestion = 'REPROVAR';
    reasons.push('O valor solicitado ultrapassa o limite disponível.');
  } else if (scoreData.score >= 601 && !missingRequired.length && (limit === 0 || amount <= available)) {
    suggestion = 'APROVAR';
    reasons.push('Score e limite compatíveis com a compra.');
  } else if (scoreData.score <= 300) {
    suggestion = 'REPROVAR';
    reasons.push('Score interno classificado como risco alto.');
  } else {
    reasons.push('Decisão manual recomendada pelo conjunto de dados disponível.');
  }

  return { suggestion, reasons, availableLimitCents: available, ...scoreData };
}
