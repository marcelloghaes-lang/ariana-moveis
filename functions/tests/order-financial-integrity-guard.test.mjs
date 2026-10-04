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

test('bloqueia criação de pedido 58,32 contra produto atual de 2.198,00',()=>{
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

test('considera desconto explícito sem criar falso positivo na criação',()=>{
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

test('recupera histórico determinístico: pedido 58,32 não aparece mais como 2.198 ao seller',()=>{
  const p=pricing();
  const order={
    total:58.32,
    payment:{method:'pix'},
    sellerIds:['seller_123'],
    items:[{sellerId:'seller_123',qty:1,unitPrice:2198,totalPrice:2198,sellerBaseTotal:2198}]
  };
  const settlement=p.getSellerSettlementForOrder(order,'seller_123',new Map());
  assert.equal(settlement.integrityBlocked,false);
  assert.equal(settlement.integrityRecovered,true);
  assert.equal(settlement.chargedGross,58.32);
  assert.equal(settlement.gross,58.32);
  assert.equal(settlement.commission,7);
  assert.equal(settlement.net,51.32);
  assert.equal(settlement.settlementMode,'manual_marketplace_recovered');
});

test('recuperação histórica desconta frete do valor da mercadoria do seller',()=>{
  const p=pricing();
  const order={
    total:108.32,
    shippingCost:50,
    payment:{method:'pix'},
    sellerIds:['seller_123'],
    items:[{sellerId:'seller_123',qty:1,unitPrice:2198,totalPrice:2198,sellerBaseTotal:2198}]
  };
  const settlement=p.getSellerSettlementForOrder(order,'seller_123',new Map());
  assert.equal(settlement.integrityRecovered,true);
  assert.equal(settlement.chargedGross,58.32);
  assert.equal(settlement.gross,58.32);
});

test('recuperação histórica de cartão usa base do seller e nunca excede o cobrado',()=>{
  const p=pricing();
  const order={
    total:100,
    payment:{method:'credit_card'},
    sellerIds:['seller_123'],
    items:[{sellerId:'seller_123',qty:1,unitPrice:2198,totalPrice:2198,sellerBaseTotal:2198}]
  };
  const settlement=p.getSellerSettlementForOrder(order,'seller_123',new Map());
  assert.equal(settlement.integrityRecovered,true);
  assert.equal(settlement.chargedGross,100);
  assert.equal(settlement.gross,82.7);
  assert.equal(settlement.cardMarkup,17.3);
  assert.equal(settlement.net,72.78);
});

test('pedido histórico multitem com distribuição ambígua continua bloqueado',()=>{
  const p=pricing();
  const order={
    total:100,
    payment:{method:'pix'},
    sellerIds:['seller_123'],
    items:[
      {sellerId:'seller_123',qty:1,totalPrice:1000,sellerBaseTotal:1000},
      {sellerId:'seller_123',qty:1,totalPrice:1000,sellerBaseTotal:1000}
    ]
  };
  const settlement=p.getSellerSettlementForOrder(order,'seller_123',new Map());
  assert.equal(settlement.integrityBlocked,true);
  assert.equal(settlement.integrityRecovered,false);
  assert.equal(settlement.gross,0);
  assert.equal(settlement.net,0);
});

test('pedido histórico com desconto ambíguo não é inferido automaticamente',()=>{
  const p=pricing();
  const order={
    total:90,
    discountTotal:10,
    payment:{method:'pix'},
    sellerIds:['seller_123'],
    items:[{sellerId:'seller_123',qty:1,totalPrice:1000,sellerBaseTotal:1000}]
  };
  const settlement=p.getSellerSettlementForOrder(order,'seller_123',new Map());
  assert.equal(settlement.integrityBlocked,true);
  assert.equal(settlement.integrityRecovered,false);
});

test('pedido legado de seller único sem sellerId por item continua calculando corretamente',()=>{
  const p=pricing();
  const order={
    total:50,
    payment:{method:'pix'},
    sellerIds:['seller_123'],
    items:[{qty:1,totalPrice:50,sellerBaseTotal:50}]
  };
  const settlement=p.getSellerSettlementForOrder(order,'seller_123',new Map());
  assert.equal(settlement.integrityBlocked,false);
  assert.equal(settlement.gross,50);
  assert.equal(settlement.net,44);
});
