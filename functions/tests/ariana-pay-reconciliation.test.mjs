import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractStoredProviderPayment,
  reconcileOrderPayment,
  reconcileOrders,
  createProviderReconciliationAdapter
} from '../services/arianaPay/arianaPayReconciliationService.js';

test('concilia pagamento armazenado quando valor do provedor bate com pedido',()=>{
  const order={
    id:'o1',
    total:1000,
    payment:{
      provider:'mercadopago',
      paymentId:'pay1',
      status:'approved',
      raw:{transaction_amount:1000,currency_id:'BRL'}
    }
  };
  const rec=reconcileOrderPayment({order});
  assert.equal(rec.status,'matched');
  assert.equal(rec.matched,true);
  assert.equal(rec.difference,0);
});

test('divergência de centavos aparece e nunca é mascarada',()=>{
  const order={
    id:'o2',
    total:1000,
    payment:{
      provider:'mercadopago',
      paymentId:'pay2',
      raw:{transaction_amount:999.97}
    }
  };
  const rec=reconcileOrderPayment({order});
  assert.equal(rec.status,'divergent');
  assert.equal(rec.reason,'amount_mismatch');
  assert.equal(rec.difference,-0.03);
});

test('sem referência do provedor fica como evidência insuficiente',()=>{
  const order={id:'o3',total:500,payment:{provider:'mercadopago',raw:{transaction_amount:500}}};
  const rec=reconcileOrderPayment({order});
  assert.equal(rec.status,'insufficient_evidence');
  assert.equal(rec.reason,'missing_provider_reference');
  assert.equal(rec.matched,false);
});

test('sem valor financeiro do provedor nunca considera conciliado',()=>{
  const order={id:'o4',total:500,payment:{provider:'mercadopago',paymentId:'pay4',status:'approved'}};
  const rec=reconcileOrderPayment({order});
  assert.equal(rec.status,'insufficient_evidence');
  assert.equal(rec.reason,'missing_provider_amount');
});

test('sumário separa matched divergent e falta de evidência',()=>{
  const result=reconcileOrders([
    {id:'a',total:100,payment:{provider:'mp',paymentId:'1',raw:{transaction_amount:100}}},
    {id:'b',total:200,payment:{provider:'mp',paymentId:'2',raw:{transaction_amount:190}}},
    {id:'c',total:300,payment:{provider:'mp',paymentId:'3'}}
  ]);
  assert.equal(result.providerQueryPerformed,false);
  assert.equal(result.stats.total,3);
  assert.equal(result.stats.matched,1);
  assert.equal(result.stats.divergent,1);
  assert.equal(result.stats.insufficientEvidence,1);
  assert.equal(result.stats.totalExpected,600);
  assert.equal(result.stats.totalProvider,290);
  assert.equal(result.stats.totalDifference,-10);
});

test('extrator não inventa amount quando não existe',()=>{
  const rec=extractStoredProviderPayment({
    payment:{provider:'mercadopago',paymentId:'pay-x',raw:{status:'approved'}}
  });
  assert.equal(rec.providerAmount,null);
  assert.equal(rec.paymentId,'pay-x');
});

test('adapter de provider sem fetch real permanece explicitamente desligado',async()=>{
  const adapter=createProviderReconciliationAdapter({provider:'mercadopago'});
  const result=await adapter.fetch({});
  assert.equal(result.liveQuery,false);
  assert.equal(result.reason,'provider_fetch_not_configured');
  assert.deepEqual(result.records,[]);
});
