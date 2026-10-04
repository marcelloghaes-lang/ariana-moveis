import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSellerArianaPayShadowView } from '../services/arianaPay/arianaPaySellerViewService.js';

test('seller vê somente seus próprios saldos e revisões',()=>{
  const view=buildSellerArianaPayShadowView({
    sellers:[
      {sellerId:'a',balance:{pending:880,available:200,reserved:50,paid:500,debt:0,totalEquity:1130},payoutPreview:{ready:true,amount:200,destination:{ready:true,method:'pix'},blockers:[]}},
      {sellerId:'b',balance:{pending:999}}
    ],
    reviewCases:[
      {sellerId:'a',orderId:'o1',riskKind:'dispute',expectedNet:120,disputeReason:{label:'Produto não recebido'}},
      {sellerId:'b',orderId:'o2',riskKind:'chargeback',expectedNet:999}
    ],
    generatedAt:'2026-10-03T23:00:00.000Z'
  },'a');

  assert.equal(view.sellerId,'a');
  assert.equal(view.balance.pending,880);
  assert.equal(view.balance.available,200);
  assert.equal(view.payout.ready,true);
  assert.equal(view.payout.amount,200);
  assert.equal(view.review.count,1);
  assert.equal(view.review.cases[0].orderId,'o1');
  assert.equal(JSON.stringify(view).includes('o2'),false);
});

test('visão seller não expõe dados internos de provider ou score antifraude',()=>{
  const view=buildSellerArianaPayShadowView({
    sellers:[{sellerId:'a',balance:{available:0},payoutPreview:{ready:false,amount:0,destination:{ready:false},blockers:['security_review']}}],
    generatedAt:'2026-10-04T00:00:00.000Z',
    reviewCases:[{
      sellerId:'a',
      orderId:'o1',
      expectedNet:880,
      cardSecurity:{level:'high_review',score:87,provider:'mercadopago',reasons:['internal_reason']},
      responsibility:{source:'internal_provider_source'}
    }]
  },'a');

  const json=JSON.stringify(view);
  assert.equal(json.includes('87'),false);
  assert.equal(json.includes('mercadopago'),false);
  assert.equal(json.includes('internal_reason'),false);
  assert.equal(json.includes('internal_provider_source'),false);
});

test('seller sem movimentos recebe saldos zerados',()=>{
  const view=buildSellerArianaPayShadowView({sellers:[],reviewCases:[]},'seller-x');
  assert.deepEqual(view.balance,{pending:0,available:0,reserved:0,paid:0,debt:0,totalEquity:0});
  assert.equal(view.payout.ready,false);
  assert.equal(view.payout.executionEnabled,false);
  assert.equal(view.policy.releaseAfterDeliveryDays,15);
});
