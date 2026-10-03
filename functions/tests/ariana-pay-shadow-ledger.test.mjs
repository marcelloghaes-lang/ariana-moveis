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


test('risco terminal zera o recebível efetivo sem mascarar a reconciliação original', () => {
  const result = buildShadowLedgerEntries({
    order: { id: 'order_risk_1' },
    sellerId: 'seller_risk',
    settlement: {
      gross: 1000,
      commission: 120,
      net: 880,
      commissionPercent: 12
    },
    release: {
      state: 'blocked',
      reason: 'financial_risk_refund',
      risk: {
        active: true,
        kind: 'refund',
        severity: 'high',
        terminal: true,
        reversalType: 'refund_debit'
      }
    }
  });

  assert.equal(result.reconciliation.ok, true);
  assert.equal(result.summary.net, 880);
  assert.equal(result.effectiveSummary.net, 0);
  assert.equal(result.entries.at(-1).type, 'refund_debit');
  assert.equal(result.entries.at(-1).amount, 880);
});

test('risco não terminal bloqueia liberação sem criar débito de reversão', () => {
  const result = buildShadowLedgerEntries({
    order: { id: 'order_risk_2' },
    sellerId: 'seller_risk',
    settlement: { gross: 1000, commission: 120, net: 880 },
    release: {
      state: 'blocked',
      reason: 'financial_risk_return_review',
      risk: {
        active: true,
        kind: 'return_review',
        severity: 'medium',
        terminal: false,
        reversalType: ''
      }
    }
  });

  assert.equal(result.entries.length, 2);
  assert.equal(result.effectiveSummary.net, 880);
  assert.equal(result.entries.every((entry) => entry.metadata.releaseState === 'blocked'), true);
});


test('repasse manual existente entra como payout_debit no shadow ledger', () => {
  const result = buildShadowLedgerEntries({
    order: {
      id: 'order_paid_1',
      sellerSettlements: {
        seller_1: {
          status: 'paid',
          amount: 880,
          paidAt: '2026-09-25T12:00:00Z',
          reference: 'PIX-LEGACY-1'
        }
      }
    },
    sellerId: 'seller_1',
    settlement: { gross: 1000, commission: 120, net: 880 },
    release: { state: 'blocked', reason: 'delivery_not_confirmed' }
  });

  assert.equal(result.reconciliation.ok, true);
  assert.equal(result.entries.at(-1).type, 'payout_debit');
  assert.equal(result.entries.at(-1).amount, 880);
  assert.equal(result.existingSettlement.status, 'paid');
  assert.equal(result.existingSettlement.reference, 'PIX-LEGACY-1');
  assert.equal(result.effectiveSummary.net, 0);
});

test('reembolso depois de repasse mantém reconciliação comercial e expõe efeito negativo', () => {
  const result = buildShadowLedgerEntries({
    order: {
      id: 'order_paid_refund',
      sellerSettlements: {
        seller_1: { status: 'paid', amount: 880 }
      }
    },
    sellerId: 'seller_1',
    settlement: { gross: 1000, commission: 120, net: 880 },
    release: {
      state: 'blocked',
      reason: 'financial_risk_refund',
      risk: {
        active: true,
        kind: 'refund',
        terminal: true,
        reversalType: 'refund_debit'
      }
    }
  });

  assert.equal(result.reconciliation.ok, true);
  assert.equal(result.summary.net, 880);
  assert.equal(result.effectiveSummary.net, -880);
  assert.deepEqual(result.entries.slice(-2).map((entry) => entry.type), ['refund_debit','payout_debit']);
});


test('chargeback sem responsabilidade definida não vira débito do seller', () => {
  const result = buildShadowLedgerEntries({
    order: { id: 'order_cb_pending' },
    sellerId: 'seller_cb',
    settlement: { gross: 1000, commission: 120, net: 880 },
    release: {
      state: 'blocked',
      reason: 'financial_risk_chargeback',
      risk: {
        active: true,
        kind: 'chargeback',
        terminal: true,
        reversalType: 'chargeback_debit',
        lossOwner: 'pending_review',
        sellerReversalAllowed: false
      }
    }
  });

  assert.equal(result.entries.some((entry) => entry.type === 'chargeback_debit'), false);
  assert.equal(result.effectiveSummary.net, 880);
});

test('chargeback com responsabilidade explícita do seller permite reversão', () => {
  const result = buildShadowLedgerEntries({
    order: { id: 'order_cb_seller' },
    sellerId: 'seller_cb',
    settlement: { gross: 1000, commission: 120, net: 880 },
    release: {
      state: 'blocked',
      reason: 'financial_risk_chargeback',
      risk: {
        active: true,
        kind: 'chargeback',
        terminal: true,
        reversalType: 'chargeback_debit',
        lossOwner: 'seller',
        responsibilitySource: 'explicit_order_or_provider',
        sellerReversalAllowed: true
      }
    }
  });

  assert.equal(result.entries.at(-1).type, 'chargeback_debit');
  assert.equal(result.entries.at(-1).amount, 880);
  assert.equal(result.effectiveSummary.net, 0);
});
