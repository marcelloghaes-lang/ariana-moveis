import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildShadowLedgerEntries,
  summarizeShadowLedger,
  reconcileShadowSettlement
} from '../services/arianaPay/arianaPayShadowLedgerService.js';

test('marketplace puro reproduz bruto menos comissão no shadow ledger', () => {
  const result = buildShadowLedgerEntries({
    order: { _id: 'order_1' },
    sellerId: 'seller_1',
    settlement: {
      gross: 1000,
      marketplaceGross: 1000,
      managedGross: 0,
      commission: 120,
      commissionPercent: 12,
      net: 880,
      settlementMode: 'manual_marketplace'
    }
  });

  assert.equal(result.entries.length, 2);
  assert.equal(result.summary.credits, 1000);
  assert.equal(result.summary.debits, 120);
  assert.equal(result.summary.net, 880);
  assert.equal(result.reconciliation.ok, true);
});

test('operação própria não aplica comissão no shadow ledger', () => {
  const result = buildShadowLedgerEntries({
    order: { id: 'order_2' },
    sellerId: 'supplier_1',
    settlement: {
      gross: 398.68,
      marketplaceGross: 0,
      managedGross: 398.68,
      commission: 0,
      net: 398.68,
      settlementMode: 'manual_supplier_payable'
    }
  });

  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].type, 'sale_credit');
  assert.equal(result.summary.net, 398.68);
  assert.equal(result.reconciliation.ok, true);
});

test('pedido misto preserva comissão apenas na parcela marketplace', () => {
  const result = buildShadowLedgerEntries({
    order: { id: 'order_3' },
    sellerId: 'seller_3',
    settlement: {
      gross: 1400,
      marketplaceGross: 1000,
      managedGross: 400,
      commission: 120,
      net: 1280,
      settlementMode: 'manual_mixed'
    }
  });

  assert.equal(result.summary.credits, 1400);
  assert.equal(result.summary.debits, 120);
  assert.equal(result.summary.net, 1280);
  assert.equal(result.reconciliation.ok, true);
});

test('chaves de idempotência são determinísticas por pedido seller e tipo', () => {
  const input = {
    order: { id: 'order_4' },
    sellerId: 'seller_4',
    settlement: { gross: 500, commission: 60, net: 440 }
  };
  const a = buildShadowLedgerEntries(input);
  const b = buildShadowLedgerEntries(input);

  assert.deepEqual(
    a.entries.map((item) => item.idempotencyKey),
    b.entries.map((item) => item.idempotencyKey)
  );
  assert.equal(new Set(a.entries.map((item) => item.idempotencyKey)).size, a.entries.length);
});

test('reconciliação acusa diferença sem mascarar divergência', () => {
  const rec = reconcileShadowSettlement({
    order: { id: 'order_5' },
    sellerId: 'seller_5',
    settlement: { gross: 1000, commission: 120, net: 870 }
  });

  assert.equal(rec.ok, false);
  assert.equal(rec.ledgerNet, 880);
  assert.equal(rec.expectedNet, 870);
  assert.equal(rec.difference, 10);
});

test('resumo trabalha apenas com créditos e débitos explícitos', () => {
  const result = summarizeShadowLedger([
    { direction: 'credit', amount: 300.1 },
    { direction: 'credit', amount: 0.2 },
    { direction: 'debit', amount: 30.3 }
  ]);
  assert.deepEqual(result, { credits: 300.3, debits: 30.3, net: 270 });
});

test('bloqueia comissão acima do bruto', () => {
  assert.throws(() => buildShadowLedgerEntries({
    order: { id: 'order_6' },
    sellerId: 'seller_6',
    settlement: { gross: 100, commission: 120, net: 0 }
  }), /Comissão maior/);
});
