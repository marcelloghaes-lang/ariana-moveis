import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveSellerBalance,
  canSchedulePayout,
  buildPayoutPreview
} from '../services/arianaPay/arianaPayBalanceService.js';

const NOW = new Date('2026-10-03T18:00:00-03:00');

test('separa saldo pendente do disponível pela data de liberação', () => {
  const result = deriveSellerBalance([
    { type: 'sale_credit', direction: 'credit', amount: 1000, status: 'shadow', availableAt: '2026-10-04T18:00:00-03:00' },
    { type: 'commission_debit', direction: 'debit', amount: 120, status: 'shadow', availableAt: '2026-10-04T18:00:00-03:00' },
    { type: 'sale_credit', direction: 'credit', amount: 500, status: 'shadow', availableAt: '2026-10-02T18:00:00-03:00' },
    { type: 'commission_debit', direction: 'debit', amount: 60, status: 'shadow', availableAt: '2026-10-02T18:00:00-03:00' }
  ], { now: NOW });

  assert.equal(result.pending, 880);
  assert.equal(result.available, 440);
  assert.equal(result.totalEquity, 1320);
});

test('reserva move valor disponível sem reduzir patrimônio do seller', () => {
  const result = deriveSellerBalance([
    { type: 'sale_credit', direction: 'credit', amount: 1000, status: 'posted' },
    { type: 'commission_debit', direction: 'debit', amount: 120, status: 'posted' },
    { type: 'reserve_hold', direction: 'transfer', amount: 200, status: 'posted' }
  ], { now: NOW });

  assert.equal(result.available, 680);
  assert.equal(result.reserved, 200);
  assert.equal(result.totalEquity, 880);
});

test('liberação de reserva devolve saldo para disponível', () => {
  const result = deriveSellerBalance([
    { type: 'sale_credit', direction: 'credit', amount: 1000, status: 'posted' },
    { type: 'reserve_hold', direction: 'transfer', amount: 300, status: 'posted' },
    { type: 'reserve_release', direction: 'transfer', amount: 100, status: 'posted' }
  ], { now: NOW });

  assert.equal(result.available, 800);
  assert.equal(result.reserved, 200);
  assert.equal(result.totalEquity, 1000);
});

test('payout reduz disponível e registra valor pago', () => {
  const result = deriveSellerBalance([
    { type: 'sale_credit', direction: 'credit', amount: 880, status: 'posted' },
    { type: 'payout_debit', direction: 'debit', amount: 500, status: 'posted' }
  ], { now: NOW });

  assert.equal(result.available, 380);
  assert.equal(result.paid, 500);
  assert.equal(result.totalEquity, 380);
});

test('lançamentos anulados não afetam saldo', () => {
  const result = deriveSellerBalance([
    { type: 'sale_credit', direction: 'credit', amount: 1000, status: 'void' },
    { type: 'sale_credit', direction: 'credit', amount: 500, status: 'reversed' },
    { type: 'sale_credit', direction: 'credit', amount: 200, status: 'posted' }
  ], { now: NOW });

  assert.equal(result.available, 200);
  assert.equal(result.ignored, 2);
});

test('payout só pode ser agendado contra saldo disponível', () => {
  assert.deepEqual(
    canSchedulePayout({ available: 880 }, 900),
    { ok: false, requested: 900, available: 880, debt: 0, shortfall: 20 }
  );

  assert.deepEqual(
    canSchedulePayout({ available: 880 }, 800),
    { ok: true, requested: 800, available: 880, debt: 0, shortfall: 0 }
  );
});

test('preview de payout não movimenta dinheiro', () => {
  const preview = buildPayoutPreview({
    sellerId: 'seller_1',
    balance: { available: 880 },
    amount: 500,
    provider: 'sandbox'
  });

  assert.equal(preview.ok, true);
  assert.equal(preview.mode, 'preview_only');
  assert.equal(preview.availableBefore, 880);
  assert.equal(preview.availableAfter, 380);
});

test('preview bloqueia saque acima do disponível', () => {
  const preview = buildPayoutPreview({
    sellerId: 'seller_1',
    balance: { available: 100 },
    amount: 120
  });

  assert.equal(preview.ok, false);
  assert.equal(preview.reason, 'insufficient_available_balance');
  assert.equal(preview.shortfall, 20);
});


test('payout histórico consome saldo pendente sem criar disponível negativo', () => {
  const result = deriveSellerBalance([
    { type: 'sale_credit', direction: 'credit', amount: 1000, status: 'shadow', metadata: { releaseState: 'blocked' } },
    { type: 'commission_debit', direction: 'debit', amount: 120, status: 'shadow', metadata: { releaseState: 'blocked' } },
    { type: 'payout_debit', direction: 'debit', amount: 880, status: 'shadow' }
  ], { now: NOW });

  assert.equal(result.pending, 0);
  assert.equal(result.available, 0);
  assert.equal(result.paid, 880);
  assert.equal(result.debt, 0);
  assert.equal(result.totalEquity, 0);
});

test('reembolso depois de payout gera dívida do seller em vez de saldo fantasma', () => {
  const result = deriveSellerBalance([
    { type: 'sale_credit', direction: 'credit', amount: 1000, status: 'shadow', metadata: { releaseState: 'blocked' } },
    { type: 'commission_debit', direction: 'debit', amount: 120, status: 'shadow', metadata: { releaseState: 'blocked' } },
    { type: 'refund_debit', direction: 'debit', amount: 880, status: 'shadow', metadata: { releaseState: 'blocked' } },
    { type: 'payout_debit', direction: 'debit', amount: 880, status: 'shadow' }
  ], { now: NOW });

  assert.equal(result.pending, 0);
  assert.equal(result.available, 0);
  assert.equal(result.paid, 880);
  assert.equal(result.debt, 880);
  assert.equal(result.totalEquity, -880);
});

test('dívida em aberto impede novo payout', () => {
  const check = canSchedulePayout({ available: 1000, debt: 200 }, 100);
  assert.equal(check.ok, false);

  const preview = buildPayoutPreview({
    sellerId: 'seller_debt',
    balance: { available: 1000, debt: 200 },
    amount: 100
  });
  assert.equal(preview.ok, false);
  assert.equal(preview.reason, 'outstanding_seller_debt');
});
