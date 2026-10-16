import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isBilledSaleStatus,
  isCancelledSaleStatus,
  normalizeSaleStatus,
  dedupeCurrentOrders
} from '../services/erp/erpSalesReportUtils.js';

test('status de faturamento aceita apenas vendas efetivamente faturadas/entregues', () => {
  for (const status of ['Pedido Faturado', 'faturado', 'FATURADO', 'Entregue', 'entregue', 'delivered']) {
    assert.equal(isBilledSaleStatus(status), true, status);
  }
  for (const status of ['Pedido Nao Faturado', 'Pedido Não Faturado', 'Pedido', 'Aprovado', 'orcamento', 'venda']) {
    assert.equal(isBilledSaleStatus(status), false, status);
  }
});

test('cancelamentos SIGE em português nunca entram como venda ativa', () => {
  for (const status of ['Pedido Cancelado', 'cancelado', 'Cancelada', 'canceled', 'cancelled', 'estornado']) {
    assert.equal(isCancelledSaleStatus(status), true, status);
  }
  assert.equal(isCancelledSaleStatus('Pedido Faturado'), false);
  assert.equal(normalizeSaleStatus('  Pedido Não Faturado  '), 'pedido nao faturado');
});

test('deduplicação prefere Entregue a Pedido quando a compra é a mesma', () => {
  const base={customerCpf:'12345678900',customerName:'Cliente',total:100,createdAt:new Date('2026-10-01T12:00:00Z'),payment:{method:'pix'},items:[{productId:'p1',qty:1,totalPrice:100}]};
  const pedido={...base,_id:'1',status:'pedido'};
  const entregue={...base,_id:'2',status:'Entregue'};
  const result=dedupeCurrentOrders([pedido,entregue]);
  assert.equal(result.orders.length,1);
  assert.equal(result.orders[0].status,'Entregue');
  assert.equal(result.suppressed,1);
});
