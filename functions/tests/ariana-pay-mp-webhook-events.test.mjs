import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyMercadoPagoSandboxWebhook} from '../services/arianaPay/mercadoPagoSandboxWebhookEventService.js';

test('alerta de fraude vira stop-delivery sem executar ação real',()=>{
  const result=classifyMercadoPagoSandboxWebhook({queryType:'stop_delivery_op_wh',body:{}});
  assert.equal(result.kind,'fraud_alert_stop_delivery');
  assert.equal(result.blocksDispatch,true);
  assert.equal(result.blocksPayout,true);
  assert.equal(result.sellerDebitAllowed,false);
  assert.equal(result.recommendedAction,'refund_order_and_do_not_ship');
  assert.equal(result.executeAction,false);
});

test('chargeback nunca autoriza débito automático do seller',()=>{
  const result=classifyMercadoPagoSandboxWebhook({queryType:'topic_chargebacks_wh',body:{}});
  assert.equal(result.kind,'chargeback');
  assert.equal(result.blocksPayout,true);
  assert.equal(result.sellerDebitAllowed,false);
  assert.equal(result.requiresManualReview,true);
});

test('reclamação entra em revisão',()=>{
  const result=classifyMercadoPagoSandboxWebhook({queryType:'topic_claims_integration_wh',body:{}});
  assert.equal(result.kind,'claim');
  assert.equal(result.requiresManualReview,true);
});

test('order normal pede apenas conciliação',()=>{
  const result=classifyMercadoPagoSandboxWebhook({queryType:'order',body:{action:'order.processed'}});
  assert.equal(result.kind,'order');
  assert.equal(result.blocksPayout,false);
  assert.equal(result.executeAction,false);
});

test('evento desconhecido falha para revisão conservadora',()=>{
  const result=classifyMercadoPagoSandboxWebhook({queryType:'mystery',body:{}});
  assert.equal(result.kind,'unknown');
  assert.equal(result.blocksPayout,true);
  assert.equal(result.requiresManualReview,true);
});
