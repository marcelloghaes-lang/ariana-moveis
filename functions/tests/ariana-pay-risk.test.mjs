import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hadApprovedPayment,
  detectFinancialRisk,
  applyRiskToRelease
} from '../services/arianaPay/arianaPayRiskService.js';

test('reconhece pagamento aprovado mesmo se o pedido depois foi cancelado',()=>{
  const order={status:'cancelado',paymentStatus:'approved',payment:{status:'approved'}};
  assert.equal(hadApprovedPayment(order),true);
});

test('cancelamento após pagamento bloqueia liberação e pede reversão',()=>{
  const risk=detectFinancialRisk({status:'Cancelado',paymentStatus:'approved'});
  assert.equal(risk.kind,'cancellation');
  assert.equal(risk.terminal,true);
  assert.equal(risk.reversalType,'refund_debit');
  const release=applyRiskToRelease({state:'scheduled',availableAt:'2026-10-20T00:00:00Z'},risk);
  assert.equal(release.state,'blocked');
  assert.equal(release.reason,'financial_risk_cancellation');
});

test('chargeback tem prioridade máxima',()=>{
  const risk=detectFinancialRisk({
    status:'entregue',
    payment:{status:'approved',statusDetail:'chargeback'}
  });
  assert.equal(risk.kind,'chargeback');
  assert.equal(risk.severity,'critical');
  assert.equal(risk.reversalType,'chargeback_debit');
});

test('devolução em análise bloqueia sem zerar o recebível',()=>{
  const risk=detectFinancialRisk({statusLabel:'Devolução solicitada'});
  assert.equal(risk.kind,'return_review');
  assert.equal(risk.terminal,false);
  assert.equal(risk.blocksRelease,true);
  assert.equal(risk.reversalType,'');
});

test('pedido normal não cria risco',()=>{
  const risk=detectFinancialRisk({status:'entregue',paymentStatus:'approved'});
  assert.equal(risk.active,false);
  assert.equal(risk.blocksRelease,false);
});
