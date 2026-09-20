import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sandboxDir = mkdtempSync(join(tmpdir(), 'ariana-loja-bot-test-'));
const sourcePath = resolve(here, '../scripts/loja-whatsapp-bot.js');
const modulePath = join(sandboxDir, 'loja-whatsapp-bot-under-test.mjs');
const statePath = join(sandboxDir, 'state.json');

process.env.LOJA_BOT_TEST_MODE = '1';
process.env.LOJA_BOT_STATE_FILE = statePath;
process.env.LOJA_MANUAL_HUMAN_PAUSE_MINUTES = '60';
process.env.LOJA_HUMAN_TTL_HOURS = '12';
process.env.ARIANA_BACKEND_URL = 'https://backend.test';
process.env.EVOLUTION_API_URL = 'https://evolution.test';
process.env.EVOLUTION_API_KEY = 'test-evolution-key';
process.env.LOJA_BOT_API_TOKEN = 'test-loja-token';
process.env.LOJA_EVOLUTION_INSTANCE = 'ariana loja';

copyFileSync(sourcePath, modulePath);
const imported = await import(pathToFileURL(modulePath).href + '?v=' + Date.now());
const bot = imported.__test;

const originalFetch = globalThis.fetch;
let catalogRows = [];
let sentTexts = [];
let sentMedia = [];
let backendEvents = [];
let requestLog = [];
let messageSeq = 0;

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    }
  };
}

function product(id, name, options = {}) {
  return {
    _id: id,
    id,
    name,
    category: options.category || '',
    brand: options.brand || '',
    price: options.price === undefined ? 1000 : options.price,
    pixPrice: options.pixPrice === undefined ? 900 : options.pixPrice,
    stock: options.stock === undefined ? 5 : options.stock,
    installmentCount: options.installmentCount || 12,
    imageUrl: options.imageUrl || ('https://img.test/' + id + '.jpg')
  };
}

function installFetchMock() {
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    const method = String(options.method || 'GET').toUpperCase();
    requestLog.push({ href, method, options });

    if (href.startsWith('https://backend.test/api/products?')) {
      return jsonResponse({ products: catalogRows });
    }

    if (href === 'https://backend.test/api/bot/atendimento/evento') {
      const body = options.body ? JSON.parse(options.body) : {};
      backendEvents.push(body);
      return jsonResponse({ ok: true });
    }

    if (href === 'https://backend.test/api/bot/crediario/analises/loja') {
      return jsonResponse({ ok: true, existing: false });
    }

    if (href === 'https://backend.test/api/bot/financeiro/carne') {
      return jsonResponse({ cliente: { nome: 'Cliente Teste' }, parcelas: [] });
    }

    if (href.startsWith('https://evolution.test/message/sendText/')) {
      const body = options.body ? JSON.parse(options.body) : {};
      const id = 'BOT-TEXT-' + (++messageSeq);
      sentTexts.push({ ...body, id });
      return jsonResponse({ key: { id } });
    }

    if (href.startsWith('https://evolution.test/message/sendMedia/')) {
      const body = options.body ? JSON.parse(options.body) : {};
      const id = 'BOT-MEDIA-' + (++messageSeq);
      sentMedia.push({ ...body, id });
      return jsonResponse({ key: { id } });
    }

    return jsonResponse({ error: 'mock_not_found', href }, 404);
  };
}

beforeEach(() => {
  bot.resetTestState();
  catalogRows = [];
  sentTexts = [];
  sentMedia = [];
  backendEvents = [];
  requestLog = [];
  messageSeq = 0;
  installFetchMock();
});

after(() => {
  globalThis.fetch = originalFetch;
  rmSync(sandboxDir, { recursive: true, force: true });
});

test('saudação natural reconhece frases comuns', () => {
  for (const value of ['Oi', 'Bom dia', 'Oi bom dia tudo bem?', 'Boa tarde, tudo bem?', 'Boa noite']) {
    assert.equal(bot.isGreeting(value), true, value);
  }
});

test('famílias equivalentes são reconhecidas corretamente', () => {
  const cases = [
    ['Tem televisão?', 'tv'],
    ['Tem televisor?', 'tv'],
    ['Tem Smart TV?', 'tv'],
    ['Tem refrigerador?', 'geladeira'],
    ['Tem freezer?', 'freezer'],
    ['Tem frigobar?', 'frigobar'],
    ['Tem roupeiro?', 'guarda-roupa'],
    ['Tem máquina de lavar?', 'máquina de lavar'],
    ['E tanquinho?', 'tanquinho'],
    ['Quero ver os tanquinhos', 'tanquinho'],
    ['Tem caixa torre?', 'caixa de som'],
    ['Tem torre de som?', 'caixa de som'],
    ['Tem forno micro-ondas?', 'micro-ondas'],
    ['Tem forninho?', 'forno elétrico'],
    ['Tem sapateira?', 'multiuso'],
    ['Tem camarim?', 'penteadeira'],
    ['Tem estante home?', 'rack/painel'],
    ['Tem painel?', 'rack/painel'],
    ['Tem cama box?', 'cama'],
    ['Tem colchão?', 'cama']
  ];

  for (const [input, expected] of cases) {
    assert.equal(bot.detectCategory(input), expected, input);
  }
});

test('geladeira não mistura freezer nem frigobar', () => {
  assert.equal(bot.matchesRequestedProductType(product('1', 'Geladeira Frost Free 400L'), 'geladeira'), true);
  assert.equal(bot.matchesRequestedProductType(product('2', 'Freezer Horizontal 300L'), 'geladeira'), false);
  assert.equal(bot.matchesRequestedProductType(product('3', 'Frigobar 90L'), 'geladeira'), false);
});

test('TV exclui rack, painel, home e suporte para TV', () => {
  const allowed = ['Smart TV Samsung 50 Polegadas', 'Televisor LED 43 Polegadas', 'Televisão Smart 32 Polegadas'];
  const blocked = ['Rack para TV 65 Polegadas', 'Painel para TV 55 Polegadas', 'Home para TV 70 Polegadas', 'Suporte Articulado para TV', 'TV Box Android 4K'];

  for (const name of allowed) {
    assert.equal(bot.matchesRequestedProductType(product(name, name), 'tv'), true, name);
  }
  for (const name of blocked) {
    assert.equal(bot.matchesRequestedProductType(product(name, name), 'tv'), false, name);
  }
});

test('máquina de lavar fica separada de tanquinho', () => {
  assert.equal(bot.matchesRequestedProductType(product('m1', 'Máquina de Lavar Automática 14kg'), 'máquina de lavar'), true);
  assert.equal(bot.matchesRequestedProductType(product('m2', 'Tanquinho Semiautomático 10kg'), 'máquina de lavar'), false);
  assert.equal(bot.matchesRequestedProductType(product('m3', 'Lavadora Semiautomática 12kg'), 'tanquinho'), true);
});

test('micro-ondas fica separado de forno elétrico', () => {
  assert.equal(bot.matchesRequestedProductType(product('f1', 'Forno Micro-ondas 32L'), 'micro-ondas'), true);
  assert.equal(bot.matchesRequestedProductType(product('f2', 'Forno Elétrico 45L'), 'micro-ondas'), false);
  assert.equal(bot.matchesRequestedProductType(product('f3', 'Forninho Elétrico 20L'), 'forno elétrico'), true);
  assert.equal(bot.matchesRequestedProductType(product('f4', 'Forno Micro-ondas 30L'), 'forno elétrico'), false);
});

test('box de cama não aceita TV Box', () => {
  assert.equal(bot.matchesRequestedProductType(product('b1', 'Cama Box Casal'), 'cama'), true);
  assert.equal(bot.matchesRequestedProductType(product('b2', 'Colchão Box Queen'), 'cama'), true);
  assert.equal(bot.matchesRequestedProductType(product('b3', 'TV Box Android 4K'), 'cama'), false);
});

test('mostrar mais tolera linguagem natural e erros de digitação', () => {
  for (const value of ['Mostrar mais', 'Mostrrar mais', 'Mostar mais', 'Mostra mais', 'Quero ver mais', 'Tem mais?', 'Manda mais', 'Outras opções', 'Outros modelos']) {
    assert.equal(bot.asksMoreProducts(value), true, value);
  }
});

test('frases naturais de compra no boleto/carnê são reconhecidas', () => {
  for (const value of ['Como faço para comprar ele no carnê?', 'Queria comprar esse no carnê', 'Quero esse no boleto', 'Faz esse no boleto pra mim', 'Faz ele no boleto', 'Pode fazer esse no boleto?', 'Quero fazer no crediário']) {
    assert.equal(bot.asksHowToBuyCredit(value), true, value);
  }
});

test('anota pra mim é reconhecido como pedido de anotação', () => {
  for (const value of ['Você anota ela pra mim fazendo favor?', 'Anota esse pra mim', 'Pode anotar ele pra mim', 'Anote esse produto para mim']) {
    assert.equal(bot.asksToWriteOnCredit(value), true, value);
  }
});

test('cálculo do crediário segue divisores e limites definidos', () => {
  const p2000 = product('c1', 'Produto 2000', { price: 2000, pixPrice: 2000 });
  const p3000 = product('c2', 'Produto 3000', { price: 3000, pixPrice: 3000 });

  const p4 = bot.creditPlan(p2000, 4);
  assert.equal(p4.divisor, 0.80);
  assert.equal(p4.total, 2500);
  assert.equal(p4.installment, 625);

  const p6 = bot.creditPlan(p2000, 6);
  assert.equal(p6.divisor, 0.75);
  assert.equal(p6.total, 2666.67);
  assert.equal(p6.installment, 444.45);

  const p10 = bot.creditPlan(p2000, 10);
  assert.equal(p10.divisor, 0.70);
  assert.equal(p10.total, 2857.14);
  assert.equal(p10.installment, 285.71);

  assert.equal(bot.creditPlan(p2000, 13).invalid, true);
  const p15 = bot.creditPlan(p3000, 15);
  assert.equal(p15.invalid, false);
  assert.equal(p15.divisor, 0.67);
  assert.equal(p15.max, 15);
});

test('entrega diferencia Guanhães de zona rural/outra cidade', () => {
  const city = bot.deliveryReply('Entrega aqui em Guanhães?');
  assert.equal(city.needsLogistics, false);
  assert.match(city.text, /24 horas/i);

  const rural = bot.deliveryReply('Entrega na zona rural?');
  assert.equal(rural.needsLogistics, true);
  assert.match(rural.text, /consultar/i);

  const other = bot.deliveryReply('Vocês entregam em outra cidade?');
  assert.equal(other.needsLogistics, true);
});

test('primeiro, segundo, terceiro e quarto mantêm índice correto', () => {
  assert.equal(bot.ordinalIndex('O primeiro'), 0);
  assert.equal(bot.ordinalIndex('Gostei da segunda'), 1);
  assert.equal(bot.ordinalIndex('Quero o terceiro'), 2);
  assert.equal(bot.ordinalIndex('O quarto'), 3);
});

test('pesquisa de TV elimina móveis/acessórios e produtos sem estoque', async () => {
  catalogRows = [
    product('tv1', 'Smart TV Samsung 50', { stock: 3 }),
    product('tv2', 'Televisor LG 43', { stock: 2 }),
    product('rack1', 'Rack para TV 65', { stock: 4 }),
    product('painel1', 'Painel para TV 55', { stock: 4 }),
    product('sup1', 'Suporte para TV', { stock: 4 }),
    product('tvzero', 'Smart TV Sem Estoque', { stock: 0 })
  ];

  const rows = await bot.searchProducts('tv', 'Tem TV?');
  assert.deepEqual(rows.map((p) => p.id).sort(), ['tv1', 'tv2']);
});

test('pesquisa junta aliases sem repetir produtos', async () => {
  catalogRows = [
    product('s1', 'Caixa de Som Bluetooth', { category: 'Áudio' }),
    product('s2', 'Torre de Som 300W', { category: 'Áudio' })
  ];

  const rows = await bot.searchProducts('caixa de som', 'Tem caixa torre?');
  assert.equal(rows.length, 2);
  assert.equal(new Set(rows.map((p) => p.id)).size, 2);
  assert.ok(requestLog.filter((r) => r.href.includes('/api/products?')).length > 2);
});

test('paginação mostra 4 por vez e continua sem repetir', async () => {
  catalogRows = Array.from({ length: 9 }, (_, i) => product('cx' + (i + 1), 'Caixa de Som Modelo ' + (i + 1), { category: 'Áudio' }));

  const phone = '5533999999999';
  const conv = bot.conversation(phone);
  await bot.showProducts(phone, conv, 'caixa de som', 'Tem caixa de som?');

  assert.equal(conv.allProductResults.length, 9);
  assert.equal(conv.lastProducts.length, 4);
  assert.equal(conv.productResultOffset, 4);
  const firstPage = conv.lastProducts.map((p) => p.id);

  await bot.showMoreProducts(phone, conv);
  assert.equal(conv.lastProducts.length, 4);
  assert.equal(conv.productResultOffset, 8);
  const secondPage = conv.lastProducts.map((p) => p.id);
  assert.equal(firstPage.some((id) => secondPage.includes(id)), false);

  await bot.showMoreProducts(phone, conv);
  assert.equal(conv.lastProducts.length, 1);
  assert.equal(conv.productResultOffset, 9);
});

test('"anota ela pra mim" com produto escolhido registra Marcelo e continua automático', async () => {
  const phone = '5533988888888';
  const chosen = bot.compactProduct(product('p1', 'Máquina de Lavar Automática 14kg'));

  bot.patchTestConversation(phone, { selectedProduct: chosen, lastProducts: [chosen], lastIntent: 'produto' });

  await bot.handleMessage({ phone, text: 'Você anota ela pra mim fazendo favor?', pushName: 'Cliente' });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /Assim que o Marcelo retornar de outro atendimento/i);
  assert.equal(backendEvents.length, 1);
  assert.match(backendEvents[0].status, /finalizar pedido no carnê/i);

  const conv = bot.conversation(phone);
  assert.equal(Boolean(conv.humanUntil && conv.humanUntil > Date.now()), false);

  await bot.handleMessage({ phone, text: 'E entrega em Guanhães?', pushName: 'Cliente' });
  assert.equal(sentTexts.length, 2);
  assert.match(sentTexts[1].text, /24 horas/i);
});

test('intervenção manual pausa o bot por 60 minutos', async () => {
  const phone = '5533977777777';

  const result = await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: { remoteJid: phone + '@s.whatsapp.net', fromMe: true, id: 'HUMAN-1' },
      message: { conversation: 'Estou verificando para você.' }
    }
  });

  assert.equal(result.humanPause, true);
  assert.equal(result.pauseMinutes, 60);

  const conv = bot.conversation(phone);
  const remaining = conv.manualHumanUntil - Date.now();
  assert.ok(remaining > 59 * 60 * 1000 && remaining <= 60 * 60 * 1000);

  await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: { remoteJid: phone + '@s.whatsapp.net', fromMe: false, id: 'CLIENT-1' },
      message: { conversation: 'Oi, ainda está aí?' }
    }
  });

  assert.equal(sentTexts.length, 0);

  bot.patchTestConversation(phone, { manualHumanUntil: Date.now() - 1 });

  await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: { remoteJid: phone + '@s.whatsapp.net', fromMe: false, id: 'CLIENT-2' },
      message: { conversation: 'Oi' }
    }
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /Ariana Móveis/i);
});

test('mensagem enviada pelo próprio bot não ativa pausa humana', async () => {
  const phone = '5533966666666';

  await bot.handleMessage({ phone, text: 'Oi', pushName: 'Cliente' });
  assert.equal(sentTexts.length, 1);

  const outbound = sentTexts[0];
  const result = await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: { remoteJid: phone + '@s.whatsapp.net', fromMe: true, id: outbound.id },
      message: { conversation: outbound.text }
    }
  });

  assert.equal(result.ignored, 'bot_outbound');
  assert.equal(Number(bot.conversation(phone).manualHumanUntil || 0), 0);
});

test('grupos e status são ignorados', async () => {
  const group = await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: { remoteJid: '120363000000000@g.us', fromMe: false, id: 'GROUP-1' },
      message: { conversation: 'Oi' }
    }
  });
  assert.equal(group.ignored, 'source');

  const status = await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: { remoteJid: 'status@broadcast', fromMe: false, id: 'STATUS-1' },
      message: { conversation: 'Oi' }
    }
  });
  assert.equal(status.ignored, 'source');
  assert.equal(sentTexts.length, 0);
});

test('contextos de clientes diferentes permanecem isolados', () => {
  const a = bot.conversation('5533911111111');
  const b = bot.conversation('5533922222222');
  a.selectedProduct = { id: 'A', name: 'Sofá A' };
  b.selectedProduct = { id: 'B', name: 'Geladeira B' };
  assert.equal(bot.conversation('5533911111111').selectedProduct.id, 'A');
  assert.equal(bot.conversation('5533922222222').selectedProduct.id, 'B');
});

test('pedido para falar com Marcelo ou receber ligação é reconhecido', () => {
  for (const value of [
    'Oi Marcelo tudo bem? Tô precisando falar com você',
    'Quero falar com o Marcelo',
    'Marcelo está aí?',
    'Teria como me ligar aqui?',
    'Pode me ligar quando puder?',
    'Preciso falar com você'
  ]) {
    assert.equal(bot.asksMarceloOrCallback(value), true, value);
  }
});

test('pedido pelo Marcelo registra retorno sem desligar o atendimento automático', async () => {
  const phone = '5533955555555';

  await bot.handleMessage({
    phone,
    text: 'Oi Marcelo tudo bem? Tô precisando falar com você',
    pushName: 'Cliente Indicado'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /Marcelo está em outro atendimento/i);
  assert.match(sentTexts[0].text, /fotos de produtos, preços e condições de pagamento/i);

  const conv = bot.conversation(phone);
  assert.equal(conv.marceloCallbackRequested, true);
  assert.equal(Boolean(conv.humanUntil && conv.humanUntil > Date.now()), false);

  assert.equal(backendEvents.length, 1);
  assert.match(backendEvents[0].status, /Aguardando retorno do Marcelo/i);

  catalogRows = [product('sf1', 'Sofá Retrátil 3 Lugares', { category: 'Sofá' })];
  await bot.handleMessage({ phone, text: 'Quero olhar sofá', pushName: 'Cliente Indicado' });

  assert.ok(sentMedia.length >= 1 || sentTexts.length >= 2, 'bot deve continuar atendendo enquanto Marcelo não retorna');
});

test('indicação e elogios da loja recebem resposta acolhedora', async () => {
  const examples = [
    'Uma amiga minha me indicou, disse que vocês vendem no carnê',
    'Peguei seu número com uma amiga que compra aí',
    'Me falaram muito bem de vocês e disseram que têm ótimos preços',
    'Disseram que vocês têm ótimos produtos',
    'Uma cliente disse que vocês são muito bons de mexer'
  ];

  for (const value of examples) {
    assert.equal(bot.isReferralOrPraise(value), true, value);
  }

  const phone = '5533944444444';
  await bot.handleMessage({
    phone,
    text: 'Uma amiga minha me indicou pra vocês, disse que vocês vendem no carnê e têm ótimos preços',
    pushName: 'Cliente'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /felizes pela indicação/i);
  assert.match(sentTexts[0].text, /crediário próprio no carnê/i);
  assert.match(sentTexts[0].text, /O que você está procurando/i);
});

test('intenções financeiras e atendimento humano genérico continuam reconhecidas', () => {
  assert.equal(bot.asksFinance('Qual o valor da minha notinha?'), true);
  assert.equal(bot.asksFinance('Quanto tenho que te passar esse mês?'), true);
  assert.equal(bot.wantsHuman('Quero um atendente'), true);
  assert.equal(bot.wantsHuman('Quero falar com uma pessoa'), true);
  assert.equal(bot.wantsHuman('Quero falar com o Marcelo'), false);
});
