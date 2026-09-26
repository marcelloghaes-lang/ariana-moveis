import test from 'node:test';
import assert from 'node:assert/strict';

process.env.LOJA_BOT_TEST_MODE = '1';
process.env.EVOLUTION_API_URL = 'http://evolution.test';
process.env.LOJA_EVOLUTION_INSTANCE = 'ariana loja';
process.env.EVOLUTION_API_KEY = 'test-key';

const calls = [];
globalThis.fetch = async (url, options = {}) => {
  calls.push({ url: String(url), options });
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
};

const { __test: bot } = await import('../scripts/loja-whatsapp-bot.js?future-intent-regression=1');

test('future product interest does not become current purchase', () => {
  const text = 'Depois mais pr frente eu vou olhar com voce um ventilador, mais deixa eu pagar tudo primeiro ai eu compro';
  assert.equal(bot.deferredFutureProductCategory(text), 'ventilador');
  assert.equal(bot.asksPausePurchaseDecision(text), true);
});

test('pagar primeiro is not first product selection', () => {
  const text = 'Deixa terminar de te pagar primeiro';
  assert.equal(bot.isPayBeforeShoppingDeferral(text), true);
  assert.equal(bot.ordinalIndex(text), -1);
  assert.equal(
    bot.currentListProductReference({
      lastProducts: [
        { id: '1', name: 'Ventilador A', price: 100 },
        { id: '2', name: 'Ventilador B', price: 200 }
      ]
    }, text).status,
    'none'
  );
});

test('legitimate ordinal selections keep working', () => {
  assert.equal(bot.ordinalIndex('o primeiro'), 0);
  assert.equal(bot.ordinalIndex('o primeiro em 10 vezes no boleto'), 0);
  assert.equal(bot.ordinalIndex('o segundo'), 1);
  assert.equal(bot.ordinalIndex('o terceiro'), 2);
});

test('full flow does not send catalog for future intent', async () => {
  bot.resetTestState();
  calls.length = 0;
  await bot.handleMessage({
    phone: '5531999990001',
    pushName: 'Marcelo',
    text: 'Depois mais pr frente eu vou olhar com voce um ventilador, mais deixa eu pagar tudo primeiro ai eu compro'
  });

  const texts = calls
    .filter(call => call.url.includes('/message/sendText/'))
    .map(call => JSON.parse(call.options.body || '{}').text || '')
    .join(' ');

  assert.match(texts, /mais pra frente/i);
  assert.doesNotMatch(texts, /Encontrei .*opç|Veja no site/i);
});
