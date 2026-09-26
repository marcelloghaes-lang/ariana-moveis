import test from 'node:test';
import assert from 'node:assert/strict';
import { canChannel, policyForChannel, assertChannelCapability } from './channel-policy.mjs';

test('loja pode rotear comprovante mas não confirmar pagamento', () => {
  assert.equal(canChannel('loja', 'payment-proof.route'), true);
  assert.equal(canChannel('loja', 'payment.confirm'), false);
});

test('site não acessa detalhes financeiros sensíveis', () => {
  assert.equal(canChannel('site', 'catalog.read'), true);
  assert.equal(canChannel('site', 'finance.customer-details'), false);
  assert.equal(canChannel('site', 'credit.approve'), false);
});

test('financeiro não empurra catálogo proativamente', () => {
  assert.equal(canChannel('financeiro', 'receivable.read'), true);
  assert.equal(canChannel('financeiro', 'catalog.proactive-push'), false);
  assert.equal(canChannel('financeiro', 'sale.assist'), false);
});

test('crediário prepara negociação, mas não aprova crédito', () => {
  assert.equal(canChannel('crediario', 'credit.negotiate.prepare'), true);
  assert.equal(canChannel('crediario', 'credit.approve'), false);
});

test('produção continua sem escrita pelo Core', () => {
  for (const channel of ['loja','site','televendas','sac','financeiro','crediario','ouvidoria']) {
    assert.equal(policyForChannel(channel).productionWritesEnabled, false);
  }
});

test('capacidade negada lança erro explícito', () => {
  assert.throws(
    () => assertChannelCapability('site', 'payment.confirm'),
    /channel_capability_denied/
  );
});
