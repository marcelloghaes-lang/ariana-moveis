import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getSellerPayoutDestinationReadiness,
  buildSellerPayoutPlan,
  buildPayoutBatchPreview
} from '../services/arianaPay/arianaPayPayoutPlannerService.js';

test('seller aprovado com Pix e titular válido fica pronto para preview de payout',()=>{
  const seller={
    sellerId:'s1',
    status:'approved',
    metadata:{
      bankAccount:{
        pixKey:'financeiro@fabricante.com.br',
        holderName:'Fabricante LTDA',
        holderDocument:'12.345.678/0001-90'
      }
    }
  };
  const dest=getSellerPayoutDestinationReadiness(seller);
  assert.equal(dest.ready,true);
  assert.equal(dest.method,'pix');

  const plan=buildSellerPayoutPlan({seller,balance:{available:880}});
  assert.equal(plan.ready,true);
  assert.equal(plan.amount,880);
  assert.equal(plan.mode,'preview_only');
  assert.equal(plan.provider,'unassigned');
});

test('saldo a liberar nunca entra no payout',()=>{
  const seller={
    sellerId:'s1',
    status:'approved',
    metadata:{bankAccount:{pixKey:'abc',holderName:'X',holderDocument:'12345678901'}}
  };
  const plan=buildSellerPayoutPlan({seller,balance:{pending:880,available:0}});
  assert.equal(plan.ready,false);
  assert.equal(plan.amount,0);
  assert.equal(plan.blockers.includes('no_available_balance'),true);
});

test('dados bancários incompletos bloqueiam preview de payout',()=>{
  const seller={sellerId:'s1',status:'approved',metadata:{}};
  const plan=buildSellerPayoutPlan({seller,balance:{available:500}});
  assert.equal(plan.ready,false);
  assert.equal(plan.blockers.includes('transfer_route'),true);
  assert.equal(plan.blockers.includes('holder_name'),true);
  assert.equal(plan.blockers.includes('holder_document'),true);
});

test('seller não aprovado não recebe plano pronto',()=>{
  const seller={
    sellerId:'s1',
    status:'pending',
    metadata:{bankAccount:{pixKey:'abc',holderName:'X',holderDocument:'12345678901'}}
  };
  const plan=buildSellerPayoutPlan({seller,balance:{available:500}});
  assert.equal(plan.ready,false);
  assert.equal(plan.blockers.includes('seller_not_approved'),true);
});

test('batch soma somente sellers efetivamente prontos',()=>{
  const sellers=[
    {sellerId:'a',status:'approved',metadata:{bankAccount:{pixKey:'a',holderName:'A',holderDocument:'12345678901'}}},
    {sellerId:'b',status:'approved',metadata:{}},
    {sellerId:'c',status:'approved',metadata:{bankAccount:{pixKey:'c',holderName:'C',holderDocument:'12345678901'}}}
  ];
  const balances=[
    {sellerId:'a',balance:{available:100}},
    {sellerId:'b',balance:{available:200}},
    {sellerId:'c',balance:{available:0,pending:300}}
  ];
  const batch=buildPayoutBatchPreview({sellers,balances});
  assert.equal(batch.readySellers,1);
  assert.equal(batch.blockedSellers,2);
  assert.equal(batch.readyAmount,100);
  assert.equal(batch.payoutExecutionEnabled,false);
});


test('dívida do seller bloqueia payout mesmo com saldo disponível',()=>{
  const seller={
    sellerId:'s1',
    status:'approved',
    metadata:{bankAccount:{pixKey:'abc',holderName:'X',holderDocument:'12345678901'}}
  };
  const plan=buildSellerPayoutPlan({seller,balance:{available:500,debt:100}});
  assert.equal(plan.ready,false);
  assert.equal(plan.debt,100);
  assert.equal(plan.blockers.includes('outstanding_seller_debt'),true);
});
