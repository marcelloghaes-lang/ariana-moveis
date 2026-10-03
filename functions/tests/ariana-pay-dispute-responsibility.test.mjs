import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyDisputeReason,
  classifyDisputeResponsibility,
  attachDisputeResponsibilityToRisk
} from '../services/arianaPay/arianaPayDisputeResponsibilityService.js';

test('compra não reconhecida com 3DS liability shift fica com bandeira/provedor',()=>{
  const responsibility=classifyDisputeResponsibility({
    order:{chargeback:{reason:'customer does not recognize the charge'}},
    settlement:{settlementMode:'manual_marketplace'},
    risk:{kind:'chargeback'},
    cardSecurity:{
      transactionSecurity:{
        authenticated:true,
        liabilityShiftRequired:true
      }
    }
  });
  assert.equal(responsibility.reason.code,'fraud_not_recognized');
  assert.equal(responsibility.owner,'provider_network');
  assert.equal(responsibility.sellerReversalAllowed,false);
  assert.equal(responsibility.blocksPayout,false);
});

test('chargeback desconhecido nunca vira dívida automática do seller',()=>{
  const responsibility=classifyDisputeResponsibility({
    order:{chargeback:{status:'opened'}},
    settlement:{settlementMode:'manual_marketplace'},
    risk:{kind:'chargeback'}
  });
  assert.equal(responsibility.owner,'pending_review');
  assert.equal(responsibility.sellerReversalAllowed,false);
  assert.equal(responsibility.requiresManualReview,true);
});

test('não entrega em marketplace puro vai para revisão do seller sem débito automático',()=>{
  const responsibility=classifyDisputeResponsibility({
    order:{dispute:{reason:'PNR - Produto não recebido'}},
    settlement:{settlementMode:'manual_marketplace'},
    risk:{kind:'dispute'}
  });
  assert.equal(responsibility.reason.code,'non_delivery');
  assert.equal(responsibility.owner,'seller_review');
  assert.equal(responsibility.sellerReversalAllowed,false);
  assert.equal(responsibility.requiresManualReview,true);
});

test('erro de cobrança não é jogado automaticamente no seller',()=>{
  const responsibility=classifyDisputeResponsibility({
    order:{chargeback:{reason:'duplicate charge'}},
    settlement:{settlementMode:'manual_marketplace'},
    risk:{kind:'chargeback'}
  });
  assert.equal(responsibility.reason.code,'duplicate_billing');
  assert.equal(responsibility.owner,'ariana_or_provider_review');
  assert.equal(responsibility.sellerReversalAllowed,false);
});

test('responsabilidade explícita confirmada pode autorizar reversão do seller',()=>{
  const responsibility=classifyDisputeResponsibility({
    order:{
      chargeback:{
        reason:'Produto não recebido',
        responsibility:'seller'
      }
    },
    settlement:{settlementMode:'manual_marketplace'},
    risk:{kind:'chargeback'}
  });
  assert.equal(responsibility.owner,'seller');
  assert.equal(responsibility.sellerReversalAllowed,true);
  assert.equal(responsibility.source,'explicit_order_or_provider');
});

test('risco recebe classificação sem perder dados originais',()=>{
  const result=attachDisputeResponsibilityToRisk(
    {active:true,kind:'chargeback',terminal:true},
    {
      reason:{code:'fraud_not_recognized'},
      owner:'provider_network',
      source:'3ds_liability_shift',
      sellerReversalAllowed:false,
      requiresManualReview:false
    }
  );
  assert.equal(result.kind,'chargeback');
  assert.equal(result.lossOwner,'provider_network');
  assert.equal(result.sellerReversalAllowed,false);
});
