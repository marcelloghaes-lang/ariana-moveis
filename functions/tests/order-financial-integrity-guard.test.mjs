import test from 'node:test';
import assert from 'node:assert/strict';
import createMarketplacePricingService from '../services/marketplacePricingService.js';
import { calculateExpectedOrderFinancials } from '../routes/currentPaymentGuardRoutes.js';

function pricing(){
  return createMarketplacePricingService({
    Product:null,
    mongoose:{Types:{ObjectId:{isValid:()=>false}}},
    ensureArray:(value)=>Array.isArray(value)?value:[],
    toJSON:(value)=>value
  });
}

test('bloqueia cenário histórico de pedido 58,32 contra produto de 2.198,00',()=>{
  const productMap=new Map([['p1',{
    _id:'p1',sellerId:'seller_123',sellerBasePrice:2198,price:2198
  }]]);
  const result=calculateExpectedOrderFinancials({
    total:58.32,
    payment:{method:'pix'},
    items:[{productId:'p1',sellerId:'seller_123',qty:1,unitPrice:58.32,totalPrice:58.32}]
  },productMap,pricing());
  assert.equal(result.expectedTotal,2198);
  assert.equal(result.requestedTotal,58.32);
  assert.equal(result.consistent,false);
});

test('aceita pedido PIX quando total do navegador coincide com banco',()=>{
  const productMap=new Map([['p1',{_id:'p1',sellerBasePrice:100,price:100}]]);
  const result=calculateExpectedOrderFinancials({
    total:119,
    shippingCost:19,
    payment:{method:'pix'},
    items:[{productId:'p1',qty:1,price:100}]
  },productMap,pricing());
  assert.equal(result.subtotal,100);
  assert.equal(result.expectedTotal,119);
  assert.equal(result.consistent,true);
});

test('considera desconto explícito sem criar falso positivo',()=>{
  const productMap=new Map([['p1',{_id:'p1',sellerBasePrice:100,price:100}]]);
  const result=calculateExpectedOrderFinancials({
    total:90,
    discount:10,
    payment:{method:'pix'},
    items:[{productId:'p1',qty:1,price:100}]
  },productMap,pricing());
  assert.equal(result.expectedTotal,90);
  assert.equal(result.consistent,true);
});

test('cartão usa preço cheio calculado no backend',()=>{
  const p=pricing();
  const productMap=new Map([['p1',{_id:'p1',sellerBasePrice:82.7,price:82.7}]]);
  const result=calculateExpectedOrderFinancials({
    total:100,
    payment:{method:'credit_card'},
    items:[{productId:'p1',qty:1,price:82.7}]
  },productMap,p);
  assert.equal(result.expectedTotal,100);
  assert.equal(result.consistent,true);
});

test('seller com valor dos itens acima do total do pedido fica bloqueado',()=>{
  const p=pricing();
  const order={
    total:58.32,
    payment:{method:'pix'},
    items:[{sellerId:'seller_123',qty:1,unitPrice:2198,totalPrice:2198,sellerBaseTotal:2198}]
  };
  const settlement=p.getSellerSettlementForOrder(order,'seller_123',new Map());
  assert.equal(settlement.integrityBlocked,true);
  assert.equal(settlement.settlementMode,'blocked_integrity');
  assert.equal(settlement.gross,0);
  assert.equal(settlement.net,0);
  assert.ok(settlement.integrityReasons.includes('seller_charged_gross_exceeds_order_total'));
});
