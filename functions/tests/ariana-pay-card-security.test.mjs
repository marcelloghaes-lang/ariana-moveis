import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessCardSecurity,
  applyCardSecurityToRelease,
  buildDispatchSecurityDecision
} from '../services/arianaPay/arianaPayCardSecurityService.js';

function safeCard(extra={}){
  return {
    total:1000,
    customerCpf:'12345678901',
    customerEmail:'cliente@example.com',
    customerPhone:'31999999999',
    shippingAddress:{cep:'39700000',logradouro:'Rua A',numero:'10'},
    payment:{
      provider:'mercadopago',
      method:'card',
      installments:3,
      transactionSecurity:{
        validation:'on_fraud_risk',
        liability_shift:'required',
        status:'AUTHENTICATED'
      }
    },
    ...extra
  };
}

test('3DS autenticado com liability shift e dados completos pode ficar baixo risco',()=>{
  const a=assessCardSecurity(safeCard());
  assert.equal(a.applies,true);
  assert.equal(a.level,'low');
  assert.equal(a.blocksDispatch,false);
  assert.equal(a.blocksPayout,false);
});

test('alerta do provedor bloqueia despacho e payout imediatamente',()=>{
  const order=safeCard();
  delete order.payment.transactionSecurity;
  order.payment.statusDetail='delivery_cancellation';
  const a=assessCardSecurity(order);
  assert.equal(a.level,'blocked');
  assert.equal(a.blocksDispatch,true);
  assert.equal(a.blocksPayout,true);
  assert.equal(a.reasons.includes('provider_fraud_alert_stop_delivery'),true);
});

test('cartão legado sem prova de 3DS entra em revisão conservadora',()=>{
  const order=safeCard();
  delete order.payment.transactionSecurity;
  const a=assessCardSecurity(order);
  assert.equal(a.reasons.includes('no_3ds_evidence'),true);
  assert.equal(a.reasons.includes('legacy_mp_payments_without_3ds_proof'),true);
  assert.equal(a.blocksPayout,true);
});

test('dados incompletos e alto valor elevam risco',()=>{
  const order={
    total:6500,
    payment:{provider:'mercadopago',method:'card',installments:12}
  };
  const a=assessCardSecurity(order);
  assert.equal(a.score>=70,true);
  assert.equal(a.level,'blocked');
  assert.equal(a.blocksDispatch,true);
});

test('Pix não sofre regra de chargeback de cartão',()=>{
  const a=assessCardSecurity({
    total:5000,
    payment:{provider:'mercadopago',method:'pix'}
  });
  assert.equal(a.applies,false);
  assert.equal(a.level,'not_applicable');
});

test('segurança de cartão bloqueia release sem alterar seu histórico',()=>{
  const assessment=assessCardSecurity({
    total:3000,
    payment:{provider:'mercadopago',method:'card',installments:12}
  });
  const release=applyCardSecurityToRelease(
    {state:'scheduled',availableAt:'2026-10-20T00:00:00Z'},
    assessment
  );
  assert.equal(release.state,'blocked');
  assert.match(release.reason,/card_security_/);
});

test('decisão de despacho é somente shadow',()=>{
  const d=buildDispatchSecurityDecision({
    total:7000,
    payment:{provider:'mercadopago',method:'card',installments:12}
  });
  assert.equal(d.mode,'shadow');
  assert.equal(d.allowDispatch,false);
  assert.equal(d.requiresManualReview,true);
});
