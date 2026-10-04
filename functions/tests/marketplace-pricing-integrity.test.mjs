import test from 'node:test';
import assert from 'node:assert/strict';
import createMarketplacePricingService from '../services/marketplacePricingService.js';

function pricing(){
  return createMarketplacePricingService({
    Product:null,
    mongoose:{Types:{ObjectId:{isValid:()=>false}}},
    ensureArray:(value)=>Array.isArray(value)?value:[],
    toJSON:(value)=>value
  });
}

test('snapshot histórico do pedido tem prioridade sobre preço atual do produto',()=>{
  const service=pricing();
  const order={
    total:100,
    items:[{
      productId:'p1',sellerId:'seller_123',qty:1,
      unitPrice:100,totalPrice:100,
      sellerBaseUnitPrice:80,sellerBaseTotal:80
    }]
  };
  const current=new Map([['p1',{price:99,retailCashPrice:99,managed:false}]]);
  const result=service.getSellerSettlementForOrder(order,'seller_123',current);
  assert.equal(result.integrityBlocked,false);
  assert.equal(result.gross,80);
  assert.equal(result.commission,9.6);
  assert.equal(result.net,70.4);
});

test('preço atual maior que o cobrado não sobrescreve pedido histórico',()=>{
  const service=pricing();
  const order={
    total:100,
    items:[{productId:'p1',sellerId:'seller_123',qty:1,unitPrice:100,totalPrice:100}]
  };
  const current=new Map([['p1',{price:999,retailCashPrice:999,managed:false}]]);
  const result=service.getSellerSettlementForOrder(order,'seller_123',current);
  assert.equal(result.integrityBlocked,false);
  assert.equal(result.gross,100);
  assert.equal(result.net,88);
});

test('pedido de 58,32 com item seller de 2.198 fica zerado e bloqueado',()=>{
  const service=pricing();
  const order={
    total:58.32,
    items:[{
      productId:'p1',sellerId:'seller_123',qty:1,
      unitPrice:2198,totalPrice:2198,
      sellerBaseUnitPrice:2198,sellerBaseTotal:2198
    }]
  };
  const result=service.getSellerSettlementForOrder(order,'seller_123',new Map());
  assert.equal(result.integrityBlocked,true);
  assert.ok(result.integrityReasons.includes('seller_charged_gross_exceeds_order_total'));
  assert.equal(result.orderTotal,58.32);
  assert.equal(result.observedChargedGross,2198);
  assert.equal(result.observedGross,2198);
  assert.equal(result.gross,0);
  assert.equal(result.commission,0);
  assert.equal(result.net,0);
  assert.equal(result.settlementMode,'blocked_integrity');
});
