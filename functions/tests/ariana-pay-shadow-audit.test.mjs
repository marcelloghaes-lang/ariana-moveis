import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createArianaPayShadowAuditService,
  isFinanciallyEligibleOrder,
  summarizeProjectedAudit
} from '../services/arianaPay/arianaPayShadowAuditService.js';

function fakeOrderModel(rows = []) {
  return {
    find(filter = {}) {
      const sid = filter?.$or?.[0]?.sellerIds || '';
      const selected = sid
        ? rows.filter((order) =>
            (order.sellerIds || []).includes(sid) ||
            (order.items || []).some((item) => item.sellerId === sid || item.seller_id === sid)
          )
        : rows;

      return {
        sort() { return this; },
        limit(value) {
          this.rows = selected.slice(0, value);
          return this;
        },
        async lean() {
          return this.rows || selected;
        }
      };
    }
  };
}

function fakeSellerModel(rows = []) {
  return {
    find(filter = {}) {
      const ids = filter?.sellerId?.$in || [];
      const selected = ids.length ? rows.filter((row) => ids.includes(row.sellerId)) : rows;
      return {
        async lean() { return selected; }
      };
    }
  };
}

function baseMapBuilder() {
  return Promise.resolve(new Map());
}

function settlement(_order, sellerId) {
  if (sellerId === 'seller_a') {
    return {
      gross: 1000,
      marketplaceGross: 1000,
      commission: 120,
      net: 880,
      commissionPercent: 12,
      settlementMode: 'manual_marketplace'
    };
  }
  return {
    gross: 400,
    managedGross: 400,
    commission: 0,
    net: 400,
    settlementMode: 'manual_supplier_payable'
  };
}

test('somente pedidos financeiramente aprovados entram na auditoria', async () => {
  const Order = fakeOrderModel([
    { id: '1', status: 'pago', sellerIds: ['seller_a'] },
    { id: '2', status: 'pendente', sellerIds: ['seller_a'] },
    { id: '3', statusLabel: 'Entregue', sellerIds: ['seller_b'] }
  ]);

  const service = createArianaPayShadowAuditService({
    Order,
    Seller: fakeSellerModel([
      { sellerId: 'seller_a', metadata: { transferDeadlineDays: 0 } },
      { sellerId: 'seller_b', metadata: { transferDeadlineDays: 0 } }
    ]),
    buildProductBasePriceMapForOrders: baseMapBuilder,
    getSellerSettlementForOrder: settlement
  });

  const rows = await service.loadEligibleOrders();
  assert.deepEqual(rows.map((row) => row.id), ['1', '3']);
});

test('filtro por seller não mistura pedidos de outros sellers', async () => {
  const Order = fakeOrderModel([
    { id: '1', status: 'pago', sellerIds: ['seller_a'] },
    { id: '2', status: 'pago', sellerIds: ['seller_b'] }
  ]);

  const service = createArianaPayShadowAuditService({
    Order,
    Seller: fakeSellerModel([
      { sellerId: 'seller_a', metadata: { transferDeadlineDays: 0 } },
      { sellerId: 'seller_b', metadata: { transferDeadlineDays: 0 } }
    ]),
    buildProductBasePriceMapForOrders: baseMapBuilder,
    getSellerSettlementForOrder: settlement
  });

  const rows = await service.loadEligibleOrders({ sellerId: 'seller_b' });
  assert.deepEqual(rows.map((row) => row.id), ['2']);
});

test('auditoria calcula saldos em memória sem executar escrita', async () => {
  let writes = 0;
  const Order = fakeOrderModel([
    { id: '1', status: 'pago', sellerIds: ['seller_a'] },
    { id: '2', status: 'entregue', sellerIds: ['seller_b'] }
  ]);
  Order.create = async () => { writes += 1; };
  Order.updateOne = async () => { writes += 1; };

  const service = createArianaPayShadowAuditService({
    Order,
    Seller: fakeSellerModel([
      { sellerId: 'seller_a', metadata: { transferDeadlineDays: 0 } },
      { sellerId: 'seller_b', metadata: { transferDeadlineDays: 0 } }
    ]),
    buildProductBasePriceMapForOrders: baseMapBuilder,
    getSellerSettlementForOrder: settlement
  });

  const result = await service.audit({
    now: new Date('2026-10-03T18:00:00-03:00')
  });

  assert.equal(writes, 0);
  assert.equal(result.mode, 'shadow_read_only');
  assert.equal(result.orderCount, 2);
  assert.equal(result.sellerCount, 2);
  assert.equal(result.totals.available, 0);
  assert.equal(result.totals.pending, 1280);
  assert.equal(result.releaseStats.blocked, 2);
  assert.equal(result.releaseStats.blockedReasons.delivery_not_confirmed, 1);
  assert.equal(result.releaseStats.blockedReasons.delivery_timestamp_missing, 1);
  assert.equal(result.divergenceCount, 0);
});

test('reconhece estados financeiros usados hoje pelo marketplace', () => {
  for (const status of ['pago', 'approved', 'Pagamento Confirmado', 'enviado', 'Entregue']) {
    assert.equal(isFinanciallyEligibleOrder({ status }), true, status);
  }
  for (const status of ['pendente', 'cancelado', 'aguardando_pagamento']) {
    assert.equal(isFinanciallyEligibleOrder({ status }), false, status);
  }
});

test('sumário agrega seller sem esconder divergências', () => {
  const summary = summarizeProjectedAudit({
    projected: [
      {
        entries: [
          { sellerId: 'seller_a', type: 'sale_credit', direction: 'credit', amount: 100, status: 'shadow' },
          { sellerId: 'seller_a', type: 'commission_debit', direction: 'debit', amount: 12, status: 'shadow' }
        ]
      }
    ],
    divergences: [{ orderId: 'x', sellerId: 'seller_a', difference: 1 }]
  }, { now: new Date('2026-10-03T18:00:00-03:00') });

  assert.equal(summary.totals.available, 88);
  assert.equal(summary.divergenceCount, 1);
  assert.equal(summary.divergences[0].difference, 1);
});


test('entrega confirmada e prazo vencido libera saldo no shadow', async () => {
  const Order = fakeOrderModel([
    {
      id: '1',
      status: 'entregue',
      shipping: { deliveredAt: '2026-09-15T12:00:00Z' },
      sellerIds: ['seller_a']
    }
  ]);

  const service = createArianaPayShadowAuditService({
    Order,
    Seller: fakeSellerModel([
      { sellerId: 'seller_a', metadata: { transferDeadlineDays: 7 } }
    ]),
    buildProductBasePriceMapForOrders: baseMapBuilder,
    getSellerSettlementForOrder: settlement
  });

  const result = await service.audit({
    now: new Date('2026-10-03T18:00:00-03:00')
  });

  assert.equal(result.totals.available, 880);
  assert.equal(result.totals.pending, 0);
  assert.equal(result.releaseStats.scheduled, 1);
  assert.equal(result.releaseStats.availableNow, 1);
});

test('seller sem prazo configurado usa prazo padrão de 15 dias', async () => {
  const Order = fakeOrderModel([
    {
      id: '1',
      status: 'entregue',
      shipping: { deliveredAt: '2026-09-20T12:00:00Z' },
      sellerIds: ['seller_a']
    }
  ]);

  const service = createArianaPayShadowAuditService({
    Order,
    Seller: fakeSellerModel([{ sellerId: 'seller_a', metadata: {} }]),
    buildProductBasePriceMapForOrders: baseMapBuilder,
    getSellerSettlementForOrder: settlement
  });

  const result = await service.audit({
    now: new Date('2026-10-03T18:00:00-03:00')
  });

  assert.equal(result.totals.available, 0);
  assert.equal(result.totals.pending, 880);
  assert.equal(result.releaseStats.blocked, 0);
  assert.equal(result.releaseStats.scheduled, 1);
  assert.equal(result.releaseStats.availableNow, 0);
});


test('pedido pago depois cancelado continua na auditoria e zera recebível', async () => {
  const Order = fakeOrderModel([
    {
      id: 'cancel_1',
      status: 'cancelado',
      paymentStatus: 'approved',
      payment: { status: 'approved' },
      sellerIds: ['seller_a']
    }
  ]);

  const service = createArianaPayShadowAuditService({
    Order,
    Seller: fakeSellerModel([{ sellerId: 'seller_a', metadata: {} }]),
    buildProductBasePriceMapForOrders: baseMapBuilder,
    getSellerSettlementForOrder: settlement
  });

  const result = await service.audit({
    now: new Date('2026-10-03T18:00:00-03:00')
  });

  assert.equal(result.orderCount, 1);
  assert.equal(result.riskStats.active, 1);
  assert.equal(result.riskStats.terminal, 1);
  assert.equal(result.riskStats.byKind.cancellation, 1);
  assert.equal(result.totals.pending, 0);
  assert.equal(result.totals.available, 0);
});

test('devolução em análise mantém recebível a liberar sem zerar', async () => {
  const Order = fakeOrderModel([
    {
      id: 'return_1',
      status: 'pago',
      statusLabel: 'Devolução solicitada',
      paymentStatus: 'approved',
      sellerIds: ['seller_a']
    }
  ]);

  const service = createArianaPayShadowAuditService({
    Order,
    Seller: fakeSellerModel([{ sellerId: 'seller_a', metadata: {} }]),
    buildProductBasePriceMapForOrders: baseMapBuilder,
    getSellerSettlementForOrder: settlement
  });

  const result = await service.audit({
    now: new Date('2026-10-03T18:00:00-03:00')
  });

  assert.equal(result.riskStats.active, 1);
  assert.equal(result.riskStats.terminal, 0);
  assert.equal(result.riskStats.byKind.return_review, 1);
  assert.equal(result.totals.pending, 880);
  assert.equal(result.totals.available, 0);
});


test('preview de payout só considera saldo disponível e seller apto', async () => {
  const Order = fakeOrderModel([
    {
      id: 'payout_ready_1',
      status: 'entregue',
      paymentStatus: 'approved',
      shipping: { deliveredAt: '2026-09-10T12:00:00Z' },
      sellerIds: ['seller_a']
    }
  ]);

  const service = createArianaPayShadowAuditService({
    Order,
    Seller: fakeSellerModel([
      {
        sellerId: 'seller_a',
        status: 'approved',
        metadata: {
          bankAccount: {
            pixKey: 'financeiro@fabricante.com.br',
            holderName: 'Fabricante LTDA',
            holderDocument: '12.345.678/0001-90'
          }
        }
      }
    ]),
    buildProductBasePriceMapForOrders: baseMapBuilder,
    getSellerSettlementForOrder: settlement
  });

  const result = await service.audit({
    now: new Date('2026-10-03T18:00:00-03:00')
  });

  assert.equal(result.totals.available, 880);
  assert.equal(result.payoutPreview.payoutExecutionEnabled, false);
  assert.equal(result.payoutPreview.readySellers, 1);
  assert.equal(result.payoutPreview.readyAmount, 880);
  assert.equal(result.sellers[0].payoutPreview.ready, true);
  assert.equal(result.sellers[0].payoutPreview.destination.method, 'pix');
});


test('repasse já pago aparece como pago no shadow sem saldo pendente residual', async () => {
  const Order = fakeOrderModel([
    {
      id: 'paid_legacy_1',
      status: 'entregue',
      paymentStatus: 'approved',
      shipping: { deliveredAt: '2026-09-01T12:00:00Z' },
      sellerIds: ['seller_a'],
      sellerSettlements: {
        seller_a: {
          status: 'paid',
          amount: 880,
          paidAt: '2026-09-20T12:00:00Z',
          reference: 'PIX-001'
        }
      }
    }
  ]);

  const service = createArianaPayShadowAuditService({
    Order,
    Seller: fakeSellerModel([
      {
        sellerId: 'seller_a',
        status: 'approved',
        metadata: {
          bankAccount: {
            pixKey: 'seller@pix.com',
            holderName: 'Seller A',
            holderDocument: '12345678901'
          }
        }
      }
    ]),
    buildProductBasePriceMapForOrders: baseMapBuilder,
    getSellerSettlementForOrder: settlement
  });

  const result = await service.audit({
    now: new Date('2026-10-03T18:00:00-03:00')
  });

  assert.equal(result.totals.paid, 880);
  assert.equal(result.totals.pending, 0);
  assert.equal(result.totals.available, 0);
  assert.equal(result.totals.debt, 0);
  assert.equal(result.payoutPreview.readyAmount, 0);
});

test('reembolso após repasse já pago expõe dívida do seller e bloqueia novo payout', async () => {
  const Order = fakeOrderModel([
    {
      id: 'paid_refund_1',
      status: 'reembolsado',
      paymentStatus: 'approved',
      payment: { status: 'approved', statusDetail: 'refunded' },
      sellerIds: ['seller_a'],
      sellerSettlements: {
        seller_a: {
          status: 'paid',
          amount: 880,
          paidAt: '2026-09-20T12:00:00Z',
          reference: 'PIX-002'
        }
      }
    }
  ]);

  const service = createArianaPayShadowAuditService({
    Order,
    Seller: fakeSellerModel([
      {
        sellerId: 'seller_a',
        status: 'approved',
        metadata: {
          bankAccount: {
            pixKey: 'seller@pix.com',
            holderName: 'Seller A',
            holderDocument: '12345678901'
          }
        }
      }
    ]),
    buildProductBasePriceMapForOrders: baseMapBuilder,
    getSellerSettlementForOrder: settlement
  });

  const result = await service.audit({
    now: new Date('2026-10-03T18:00:00-03:00')
  });

  assert.equal(result.totals.paid, 880);
  assert.equal(result.totals.debt, 880);
  assert.equal(result.totals.totalEquity, -880);
  assert.equal(result.payoutPreview.readySellers, 0);
  assert.equal(result.sellers[0].payoutPreview.blockers.includes('outstanding_seller_debt'), true);
});


test('cartão sem evidência de 3DS permanece bloqueado mesmo após 15 dias', async () => {
  const Order = fakeOrderModel([
    {
      id: 'card_review_1',
      status: 'entregue',
      paymentStatus: 'approved',
      total: 2500,
      customerCpf: '12345678901',
      customerEmail: 'cliente@example.com',
      customerPhone: '31999999999',
      shippingAddress: { cep: '39700000', logradouro: 'Rua A', numero: '10' },
      shipping: { deliveredAt: '2026-09-01T12:00:00Z' },
      payment: { provider: 'mercadopago', method: 'card', status: 'approved', installments: 10 },
      sellerIds: ['seller_a']
    }
  ]);

  const service = createArianaPayShadowAuditService({
    Order,
    Seller: fakeSellerModel([
      {
        sellerId: 'seller_a',
        status: 'approved',
        metadata: {
          bankAccount: {
            pixKey: 'seller@pix.com',
            holderName: 'Seller A',
            holderDocument: '12345678901'
          }
        }
      }
    ]),
    buildProductBasePriceMapForOrders: baseMapBuilder,
    getSellerSettlementForOrder: settlement
  });

  const result = await service.audit({
    now: new Date('2026-10-03T18:00:00-03:00')
  });

  assert.equal(result.cardSecurityStats.applicable, 1);
  assert.equal(result.cardSecurityStats.highReview + result.cardSecurityStats.blocked >= 1, true);
  assert.equal(result.totals.available, 0);
  assert.equal(result.totals.pending, 880);
  assert.equal(result.payoutPreview.readyAmount, 0);
});

test('cartão com 3DS autenticado e liability shift pode seguir regra normal de 15 dias', async () => {
  const Order = fakeOrderModel([
    {
      id: 'card_safe_1',
      status: 'entregue',
      paymentStatus: 'approved',
      total: 1000,
      customerCpf: '12345678901',
      customerEmail: 'cliente@example.com',
      customerPhone: '31999999999',
      shippingAddress: { cep: '39700000', logradouro: 'Rua A', numero: '10' },
      shipping: { deliveredAt: '2026-09-01T12:00:00Z' },
      payment: {
        provider: 'mercadopago',
        method: 'card',
        status: 'approved',
        installments: 3,
        transactionSecurity: {
          validation: 'on_fraud_risk',
          liability_shift: 'required',
          status: 'AUTHENTICATED'
        }
      },
      sellerIds: ['seller_a']
    }
  ]);

  const service = createArianaPayShadowAuditService({
    Order,
    Seller: fakeSellerModel([
      {
        sellerId: 'seller_a',
        status: 'approved',
        metadata: {
          bankAccount: {
            pixKey: 'seller@pix.com',
            holderName: 'Seller A',
            holderDocument: '12345678901'
          }
        }
      }
    ]),
    buildProductBasePriceMapForOrders: baseMapBuilder,
    getSellerSettlementForOrder: settlement
  });

  const result = await service.audit({
    now: new Date('2026-10-03T18:00:00-03:00')
  });

  assert.equal(result.cardSecurityStats.low, 1);
  assert.equal(result.totals.available, 880);
  assert.equal(result.payoutPreview.readyAmount, 880);
});
