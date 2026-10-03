import test from 'node:test';
import assert from 'node:assert/strict';
import {
  projectOrderToShadowLedger,
  projectOrdersToShadowLedger
} from '../services/arianaPay/arianaPayShadowProjectorService.js';

function settlementBySeller(_order, sellerId) {
  if (sellerId === 'seller_a') {
    return {
      gross: 1000,
      marketplaceGross: 1000,
      managedGross: 0,
      commission: 120,
      net: 880,
      commissionPercent: 12,
      settlementMode: 'manual_marketplace'
    };
  }
  if (sellerId === 'seller_b') {
    return {
      gross: 400,
      marketplaceGross: 0,
      managedGross: 400,
      commission: 0,
      net: 400,
      commissionPercent: 0,
      settlementMode: 'manual_supplier_payable'
    };
  }
  return { gross: 0, commission: 0, net: 0 };
}

test('projeta pedido multisseller separando liquidação de cada seller', () => {
  const result = projectOrderToShadowLedger({
    order: {
      id: 'order_multi_1',
      sellerIds: ['seller_a', 'seller_b'],
      items: [
        { sellerId: 'seller_a', totalPrice: 1000 },
        { sellerId: 'seller_b', totalPrice: 500 }
      ]
    },
    getSettlement: settlementBySeller
  });

  assert.equal(result.ok, true);
  assert.equal(result.sellerCount, 2);
  assert.equal(result.sellers[0].sellerId, 'seller_a');
  assert.equal(result.sellers[0].ledgerSummary.net, 880);
  assert.equal(result.sellers[1].sellerId, 'seller_b');
  assert.equal(result.sellers[1].ledgerSummary.net, 400);
  assert.equal(result.entries.length, 3);
});

test('não duplica seller presente em sellerIds e items', () => {
  const result = projectOrderToShadowLedger({
    order: {
      id: 'order_multi_2',
      sellerIds: ['seller_a'],
      items: [
        { sellerId: 'seller_a' },
        { sellerId: 'seller_a' }
      ]
    },
    getSettlement: settlementBySeller
  });

  assert.equal(result.sellerCount, 1);
});

test('lote identifica divergência por pedido e seller', () => {
  const getSettlement = (_order, sellerId) => sellerId === 'seller_bad'
    ? { gross: 1000, commission: 120, net: 870 }
    : { gross: 500, commission: 60, net: 440 };

  const result = projectOrdersToShadowLedger({
    orders: [
      { id: 'order_ok', sellerIds: ['seller_ok'] },
      { id: 'order_bad', sellerIds: ['seller_bad'] }
    ],
    getSettlement
  });

  assert.equal(result.ok, false);
  assert.equal(result.orderCount, 2);
  assert.equal(result.divergences.length, 1);
  assert.equal(result.divergences[0].orderId, 'order_bad');
  assert.equal(result.divergences[0].sellerId, 'seller_bad');
  assert.equal(result.divergences[0].difference, 10);
});
