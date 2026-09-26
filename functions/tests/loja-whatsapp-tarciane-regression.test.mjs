import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

const TEST_STATE = '/tmp/gustavo-tarciane-test-state.json';
try { fs.unlinkSync(TEST_STATE); } catch {}

process.env.LOJA_BOT_TEST_MODE = '1';
process.env.LOJA_BOT_STATE_FILE = TEST_STATE;
process.env.EVOLUTION_API_URL = 'http://evolution.test';
process.env.LOJA_EVOLUTION_INSTANCE = 'ariana loja';
process.env.EVOLUTION_API_KEY = 'test-key';
process.env.ARIANA_BACKEND_URL = 'http://backend.test';

const calls = [];
globalThis.fetch = async (url, options = {}) => {
  calls.push({ url: String(url), options });
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
};

const { __test: bot } = await import('../scripts/loja-whatsapp-bot.js?tarciane-regression=1');

const fogao = {
  id: 'fogao-atlas-6b',
  name: 'Fogão 6 Bocas Branco com Mesa Inox Atlas Milão Plus Bivolt',
  category: 'fogão',
  pixPrice: 1153.89,
  price: 1390.23,
  installmentCount: 12,
  stock: 1
};

const tv = {
  id: 'tv-semp-43-roku',
  name: 'smart tv semp 43 polegadas roku tv',
  category: 'tv',
  pixPrice: 1970,
  price: 2373.48,
  installmentCount: 12,
  stock: 1
};

function sentTexts() {
  return calls
    .filter(call => call.url.includes('/message/sendText/'))
    .map(call => {
      try { return JSON.parse(call.options.body || '{}').text || ''; }
      catch { return ''; }
    });
}

function seedNegotiation(phone) {
  bot.resetTestState();
  calls.length = 0;
  const conv = bot.conversation(phone);
  bot.rememberPurchaseSelection(conv, fogao, 'test-fogao');
  bot.rememberPurchaseSelection(conv, tv, 'test-tv');
  conv.selectedProduct = { ...tv };
  conv.lastProducts = [{ ...tv }];
  conv.lastIntent = 'produto';
  conv.preferredPurchasePayment = 'credit';
  conv.desiredMonthlyPayment = 500;
  conv.creditContextUntil = Date.now() + 60 * 60 * 1000;
  conv.lastCreditPlan = {
    productId: tv.id,
    product: { ...tv },
    count: 10,
    divisor: 0.65,
    total: 3030.77,
    installment: 303.08
  };
  return conv;
}

test('memória de negociação mantém fogão e TV simultaneamente', () => {
  bot.resetTestState();
  const conv = bot.conversation('553399990001');
  bot.rememberPurchaseSelection(conv, fogao, 'fogao');
  bot.rememberPurchaseSelection(conv, tv, 'tv');

  const selected = bot.activePurchaseSelections(conv);
  assert.equal(selected.length, 2);
  assert.deepEqual(selected.map(p => p.id), [fogao.id, tv.id]);
});

test('frase real de somar resolve os dois produtos escolhidos', () => {
  const conv = seedNegotiation('553399990002');
  const text = 'Tá bem aí já soma o fogão e tbm a tv junto ta bom';
  assert.equal(bot.asksPurchaseBundleTotal(conv, text), true);
  const rows = bot.purchaseBundleProductsFromText(conv, text);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(p => p.id), [fogao.id, tv.id]);
});

test('plano combinado em 10x usa o valor dos dois produtos', () => {
  const plan = bot.creditBundlePlan([fogao, tv], 10);
  assert.equal(plan.base, 3123.89);
  assert.equal(plan.divisor, 0.65);
  assert.equal(plan.total, 4805.98);
  assert.equal(plan.installment, 480.6);
});

test('entende preferência por parcelas próximas de R$ 500', () => {
  assert.equal(
    bot.extractDesiredMonthlyPayment('Pagar parcelas aproximadas R$ 500'),
    500
  );
});

test('soma fogão + TV no carnê sem reiniciar catálogo', async () => {
  const phone = '553399990003';
  const conv = seedNegotiation(phone);

  await bot.handleMessage({
    phone,
    pushName: 'Cliente',
    text: 'Tá bem aí já soma o fogão e tbm a tv junto ta bom'
  });

  const output = sentTexts().join('\n');
  assert.match(output, /Fogão 6 Bocas/i);
  assert.match(output, /smart tv semp 43/i);
  assert.match(output, /10x de R\$\s*480,60/i);
  assert.doesNotMatch(output, /Encontrei .*opç/i);
  assert.doesNotMatch(output, /Vou te mostrar as primeiras/i);

  const bundle = bot.activeCreditBundle(conv);
  assert.ok(bundle);
  assert.equal(bundle.products.length, 2);
  assert.equal(bundle.count, 10);
});

test('pedido para falar com Marcelo sobre crédito preserva a compra dupla', async () => {
  const phone = '553399990004';
  const conv = seedNegotiation(phone);

  await bot.handleMessage({
    phone,
    pushName: 'Cliente',
    source: 'audio',
    text: 'Ô Marcelo, boa tarde, eu tô precisando comprar um fogão e uma TV aqui pra minha casa. Eu sou o marido da Tarciane. Eu queria saber se você não tem como abrir pra mim uma conta aí não, aí eu pagar você por mês.'
  });

  const output = sentTexts().join('\n');
  assert.match(output, /crediário\/carnê/i);
  assert.match(output, /Fogão 6 Bocas/i);
  assert.match(output, /smart tv semp 43/i);
  assert.match(output, /não vou reiniciar a busca/i);
  assert.doesNotMatch(output, /Encontrei .*opç/i);
  assert.doesNotMatch(output, /Qual delas você quis dizer/i);

  assert.equal(conv.marceloCallbackRequested, true);
  assert.equal(conv.preferredPurchasePayment, 'credit');
  assert.equal(bot.activePurchaseSelections(conv).length, 2);
});

test('depois de escolher carnê, parcela-alvo não volta a perguntar cartão ou carnê', async () => {
  const phone = '553399990005';
  const conv = seedNegotiation(phone);
  conv.pendingAction = 'installment_payment_method';

  await bot.handleMessage({
    phone,
    pushName: 'Cliente',
    text: 'Pagar parcelas aproximadas R$ 500'
  });

  const output = sentTexts().join('\n');
  assert.match(output, /No \*carnê\*/i);
  assert.match(output, /R\$\s*500,00/i);
  assert.match(output, /Em quantas vezes/i);
  assert.equal(conv.desiredMonthlyPayment, 500);
  assert.equal(conv.preferredPurchasePayment, 'credit');
  assert.equal(conv.pendingAction, 'credit_installments');
});

test('pedido semântico para falar com Marcelo não oferece produtos proativamente', async () => {
  bot.resetTestState();
  calls.length = 0;
  const phone = '553399990006';
  const conv = bot.conversation(phone);

  await bot.handleGeneralIntent({
    phone,
    text: 'Quero falar com o Marcelo',
    pushName: 'Cliente',
    conv,
    classification: {
      intent: 'FALAR_COM_MARCELO',
      confidence: 0.99,
      category: '',
      payment_method: 'unknown',
      installments: 0
    },
    source: 'text'
  });

  const output = sentTexts().join('\n');
  assert.match(output, /sinalizada para o Marcelo/i);
  assert.doesNotMatch(output, /posso te mostrar produtos/i);
  assert.doesNotMatch(output, /fotos de produtos/i);
});