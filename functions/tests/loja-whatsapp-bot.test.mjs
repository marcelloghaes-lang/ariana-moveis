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
process.env.LOJA_VISION_OPENAI_API_KEY = 'test-vision-key';
process.env.LOJA_VISION_MODEL = 'gpt-5.6-luna';
process.env.LOJA_AUDIO_TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe';
process.env.LOJA_AUDIO_MAX_SECONDS = '600';
process.env.LOJA_AUDIO_USD_PER_MINUTE = '0.003';

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
let catalogResponseStatus = 200;
let financeResponseStatus = 200;
let creditAnalysisExisting = false;
let financeResponse = {
  ok: true,
  fonteFinanceira: 'ariana_erp_financeiro_cobrancas',
  cliente: { nome: 'Cliente Teste' },
  parcelas: []
};
let audioTranscriptionText = 'Olá';
let visionClassification = {
  kind: 'unknown',
  confidence: 0.2,
  product_name: '',
  brand: '',
  model: '',
  category_hint: '',
  payment_method: 'unknown',
  payment_recipient_name: '',
  summary: 'Imagem não identificada'
};
let mediaBase64Response = {
  mimetype: 'image/jpeg',
  base64: 'ZmFrZS1pbWFnZQ=='
};

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
      if (catalogResponseStatus !== 200) {
        return jsonResponse({ error: 'catalog_unavailable' }, catalogResponseStatus);
      }
      return jsonResponse({ products: catalogRows });
    }

    if (href === 'https://backend.test/api/bot/atendimento/evento') {
      const body = options.body ? JSON.parse(options.body) : {};
      backendEvents.push(body);
      return jsonResponse({ ok: true });
    }

    if (href === 'https://backend.test/api/bot/crediario/analises/loja') {
      return jsonResponse({ ok: true, existing: creditAnalysisExisting });
    }

    if (href === 'https://backend.test/api/bot/financeiro/contas-receber') {
      return jsonResponse(financeResponse, financeResponseStatus);
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

    if (href.startsWith('https://evolution.test/chat/getBase64FromMediaMessage/')) {
      return jsonResponse(mediaBase64Response, 201);
    }

    if (href === 'https://api.openai.com/v1/responses') {
      return jsonResponse({
        output_text: JSON.stringify(visionClassification),
        usage: {
          input_tokens: 1000,
          output_tokens: 100,
          total_tokens: 1100
        }
      });
    }

    if (href === 'https://api.openai.com/v1/audio/transcriptions') {
      return jsonResponse({
        text: audioTranscriptionText
      });
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
  catalogResponseStatus = 200;
  financeResponseStatus = 200;
  creditAnalysisExisting = false;
  financeResponse = {
    ok: true,
    fonteFinanceira: 'ariana_erp_financeiro_cobrancas',
    cliente: { nome: 'Cliente Teste' },
    parcelas: []
  };
  audioTranscriptionText = 'Olá';
  visionClassification = {
    kind: 'unknown',
    confidence: 0.2,
    product_name: '',
    brand: '',
    model: '',
    category_hint: '',
    payment_method: 'unknown',
    payment_recipient_name: '',
    summary: 'Imagem não identificada'
  };
  mediaBase64Response = {
    mimetype: 'image/jpeg',
    base64: 'ZmFrZS1pbWFnZQ=='
  };
  installFetchMock();
});

after(() => {
  globalThis.fetch = originalFetch;
  rmSync(sandboxDir, { recursive: true, force: true });
});

test('saudação natural reconhece frases comuns', () => {
  for (const value of [
    'Oi',
    'Oii',
    'Oiii',
    'Oiee',
    'Oláá',
    'Bom dia',
    'Oi bom dia tudo bem?',
    'Oii boa tarde',
    'Boa tarde, tudo bem?',
    'Boa noite'
  ]) {
    assert.equal(bot.isGreeting(value), true, value);
  }

  for (const value of ['?', '??', '!!!', '...']) {
    assert.equal(bot.isGreeting(value), false, value);
  }
});

test('interrogação e chamada de presença retomam conversa sem nova saudação', async () => {
  for (const value of ['?', '??', 'Tá aí?', 'Ainda está aí?', 'Oi, está aí?']) {
    assert.equal(bot.asksPresencePing(value), true, value);
  }

  const phone = '5533903333333';
  const chosen = bot.compactProduct(product('ctx1', 'Smart TV 50 Polegadas'));
  bot.patchTestConversation(phone, {
    selectedProduct: chosen,
    lastProducts: [chosen],
    lastIntent: 'produto',
    manualHumanUntil: Date.now() - 1
  });

  await bot.handleMessage({ phone, text: '?', pushName: 'Cliente' });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /Sim, estou aqui/i);
  assert.doesNotMatch(sentTexts[0].text, /Seja bem-vindo/i);
  assert.equal(bot.conversation(phone).selectedProduct.id, 'ctx1');
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

test('saudação junto com pedido de produto é respondida antes do catálogo', async () => {
  const phone = '5533977777720';

  catalogRows = [
    product('iphone-greet-1', 'Apple iPhone 15 128GB', {
      category: 'Celulares',
      brand: 'Apple'
    })
  ];

  await bot.handleMessage({
    phone,
    text: 'Boa tarde, vocês trabalham com iPhone?',
    pushName: 'Cliente Saudação'
  });

  assert.ok(sentTexts.length >= 2);
  assert.match(sentTexts[0].text, /^Boa tarde!/i);
  assert.match(sentTexts[0].text, /bem-vindo à Ariana Móveis/i);
  assert.match(sentTexts[1].text, /Encontrei/i);
  assert.equal(sentMedia.length, 1);
  assert.match(sentMedia[0].caption || '', /iPhone 15/i);
});

test('pesquisa de celular não mistura caixa de som nem acessórios', async () => {
  catalogRows = [
    product('phone1', 'Smartphone Samsung Galaxy A15 128GB', { category: 'Celulares' }),
    product('phone2', 'Motorola Moto G54 5G', { category: 'Smartphones' }),
    product('sound1', 'CAIXA AMP AMVOX ACA181 180W', { category: 'Áudio' }),
    product('acc1', 'Carregador USB-C 25W', { category: 'Acessórios' })
  ];

  const rows = await bot.searchProducts('celular', 'Boa tarde, você vende celular?');
  assert.deepEqual(rows.map((p) => p.id).sort(), ['phone1', 'phone2']);
});

test('pedido de iPhone não retorna Android nem caixa de som', async () => {
  catalogRows = [
    product('iphone1', 'Apple iPhone 15 128GB', { category: 'Celulares', brand: 'Apple' }),
    product('galaxy1', 'Smartphone Samsung Galaxy S24', { category: 'Celulares', brand: 'Samsung' }),
    product('sound2', 'Caixa de Som Bluetooth', { category: 'Áudio' })
  ];

  const rows = await bot.searchProducts('celular', 'Boa tarde você trabalha com iPhone?');
  assert.deepEqual(rows.map((p) => p.id), ['iphone1']);
});

test('TV de 50 polegadas retorna somente TVs de 50', async () => {
  catalogRows = [
    product('tv32', 'Smart TV 32 LG Full HD 32LR6700PSA', { category: 'TVs' }),
    product('tv42', 'Semp Google TV S42', { category: 'TVs' }),
    product('tv50a', 'Smart TV LED 50 Samsung Crystal UHD', { category: 'TVs' }),
    product('tv50b', 'Smart TV TCL 50P635 4K', { category: 'TVs' }),
    product('rack50', 'Rack para TV 50 Polegadas', { category: 'Móveis' })
  ];

  const rows = await bot.searchProducts('tv', 'Boa tarde você vende tv de 50 polegadas?');
  assert.deepEqual(rows.map((p) => p.id).sort(), ['tv50a', 'tv50b']);
});

test('se não houver TV de 50 polegadas não oferece outro tamanho no lugar', async () => {
  const phone = '5533977777710';

  catalogRows = [
    product('tv32only', 'Smart TV 32 LG Full HD', { category: 'TVs' }),
    product('tv43only', 'Smart TV 43 Samsung 4K', { category: 'TVs' })
  ];

  const conv = bot.conversation(phone);
  await bot.showProducts(phone, conv, 'tv', 'Boa tarde você vende tv de 50 polegadas?');

  assert.equal(sentMedia.length, 0);
  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /TV de 50 polegadas/i);
  assert.match(sentTexts[0].text, /não encontrei/i);
});

test('"quero sim" continua oferta de outros celulares após iPhone indisponível', async () => {
  const phone = '5533977777730';

  catalogRows = [
    product('alt-phone-1', 'Smartphone Samsung A07 128GB', {
      category: 'Celulares',
      brand: 'Samsung'
    }),
    product('alt-phone-2', 'Motorola Moto G55 5G', {
      category: 'Smartphones',
      brand: 'Motorola'
    })
  ];

  const conv = bot.conversation(phone);
  await bot.showProducts(phone, conv, 'celular', 'Boa tarde vocês trabalham com iPhone?');

  assert.equal(sentMedia.length, 0);
  assert.match(sentTexts.at(-1).text, /outros celulares disponíveis/i);
  assert.equal(bot.conversation(phone).pendingAlternativeCategory, 'celular');

  sentTexts = [];
  sentMedia = [];

  await bot.handleMessage({
    phone,
    text: 'Quero sim',
    pushName: 'Cliente Alternativas'
  });

  assert.ok(sentMedia.length >= 1);
  assert.match(sentMedia[0].caption || '', /Smartphone Samsung A07/i);
  assert.doesNotMatch(sentTexts.at(-1)?.text || '', /Me conta o que você está procurando/i);
  assert.equal(bot.conversation(phone).pendingAlternativeCategory, '');
});

test('"pode me enviar fotos" continua oferta de outros tamanhos de TV', async () => {
  const phone = '5533977777731';

  catalogRows = [
    product('alt-tv-32', 'Smart TV 32 LG Full HD', { category: 'TVs' }),
    product('alt-tv-43', 'Smart TV 43 Samsung 4K', { category: 'TVs' })
  ];

  const conv = bot.conversation(phone);
  await bot.showProducts(phone, conv, 'tv', 'Boa tarde vocês vendem TV de 65 polegadas?');

  assert.equal(sentMedia.length, 0);
  assert.match(sentTexts.at(-1).text, /outros tamanhos disponíveis/i);
  assert.equal(bot.conversation(phone).pendingAlternativeCategory, 'tv');

  sentTexts = [];
  sentMedia = [];

  await bot.handleMessage({
    phone,
    text: 'Pode me enviar fotos?',
    pushName: 'Cliente TV'
  });

  assert.equal(sentMedia.length, 2);
  assert.match(sentMedia[0].caption || '', /Smart TV 32/i);
  assert.match(sentMedia[1].caption || '', /Smart TV 43/i);
  assert.doesNotMatch(sentTexts.at(-1)?.text || '', /Me conta o que você está procurando/i);
});

test('"quanto fica esse em 10x no boleto" usa o último produto mostrado', async () => {
  const phone = '5533977777738';

  const first = bot.compactProduct(product('sofa-1', 'Sofá 2 Lugares Teste', {
    category: 'Sofá',
    pixPrice: 1599,
    price: 1899
  }));
  const last = bot.compactProduct(product('sofa-2', 'Sofá 3 Lugares Retrátil e Reclinável SMP Kratos', {
    category: 'Sofá',
    pixPrice: 1779,
    price: 2134
  }));

  bot.patchTestConversation(phone, {
    lastProducts: [first, last],
    selectedProduct: null,
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'quanto fica esse em 10x no boleto?',
    pushName: 'Cliente Sofá'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /Sofá 3 Lugares Retrátil e Reclinável SMP Kratos/i);
  assert.match(sentTexts[0].text, /10x de R\$/i);
  assert.doesNotMatch(sentTexts[0].text, /Me diga qual produto/i);
  assert.equal(bot.conversation(phone).selectedProduct.id, 'sofa-2');
  assert.equal(bot.conversation(phone).lastCreditPlan.count, 10);
});

test('"E no cartão?" continua no mesmo produto após cálculo do crediário', async () => {
  const phone = '5533977777739';

  const first = bot.compactProduct(product('tv-card-1', 'Smart TV 32 Polegadas', {
    category: 'TVs',
    pixPrice: 1400,
    price: 1680
  }));
  const last = bot.compactProduct(product('tv-card-2', 'Smart TV LG 43 Polegadas', {
    category: 'TVs',
    pixPrice: 1825.17,
    price: 2190,
    installmentCount: 12
  }));

  bot.patchTestConversation(phone, {
    lastProducts: [first, last],
    selectedProduct: null,
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'Quanto fica esse último aí em 10x no boleto?',
    pushName: 'Cliente Cartão'
  });

  assert.equal(bot.conversation(phone).selectedProduct.id, 'tv-card-2');
  assert.match(sentTexts.at(-1).text, /crediário próprio/i);
  assert.match(sentTexts.at(-1).text, /Smart TV LG 43 Polegadas/i);

  await bot.handleMessage({
    phone,
    text: 'E no cartão?',
    pushName: 'Cliente Cartão'
  });

  assert.match(sentTexts.at(-1).text, /No cartão/i);
  assert.match(sentTexts.at(-1).text, /Smart TV LG 43 Polegadas/i);
  assert.doesNotMatch(sentTexts.at(-1).text, /Me conta um pouco mais/i);
  assert.equal(backendEvents.at(-1).metadata.paymentMode, 'cartao');
});


test('catálogo público mantém PIX separado do preço cheio do cartão', async () => {
  const phone = '5533977777749';

  catalogRows = [{
    _id: 'tv-public-price-1',
    name: 'Smart TV LG 43 Polegadas',
    category: 'TVs',
    price: 1825.17,
    sellerBasePrice: 1825.17,
    pixPrice: 1825.17,
    marketplacePrice: 2199,
    cardPrice: 2199,
    fullPrice: 2199,
    installmentCount: 12,
    stock: 3,
    imageUrl: 'https://img.test/tv-public-price-1.jpg'
  }];

  await bot.handleMessage({
    phone,
    text: 'Vocês têm TV?',
    pushName: 'Cliente Preço'
  });

  assert.equal(sentMedia.length, 1);
  assert.match(sentMedia[0].caption || '', /PIX: \*R\$\s*1\.825,17\*/i);
  assert.match(sentMedia[0].caption || '', /Cartão: até 12x de R\$\s*183,25/i);
  assert.doesNotMatch(sentMedia[0].caption || '', /Cartão: até 12x de R\$\s*152,10/i);

  sentTexts = [];

  await bot.handleMessage({
    phone,
    text: 'E no cartão?',
    pushName: 'Cliente Preço'
  });

  assert.match(sentTexts.at(-1).text, /12x de R\$\s*183,25/i);
  assert.match(sentTexts.at(-1).text, /total de \*R\$\s*2\.199,00\*/i);
  assert.doesNotMatch(sentTexts.at(-1).text, /R\$\s*1\.825,17.*total/i);
});


test('"esse último aí" seleciona o último produto antes de calcular o boleto', async () => {
  const phone = '5533977777732';

  const first = bot.compactProduct(product('last-1', 'Smartphone Samsung A06', {
    category: 'Celulares',
    pixPrice: 699,
    price: 839
  }));
  const second = bot.compactProduct(product('last-2', 'Smartphone Samsung A07', {
    category: 'Celulares',
    pixPrice: 739,
    price: 887
  }));

  bot.patchTestConversation(phone, {
    lastProducts: [first, second],
    selectedProduct: null,
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'Esse último ai quantos que fica parcelado no boleto?',
    pushName: 'Cliente Último'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /Smartphone Samsung A07/);
  assert.match(sentTexts[0].text, /até \*12x\*/);
  assert.match(sentTexts[0].text, /Em quantas vezes/i);
  assert.equal(bot.conversation(phone).selectedProduct.id, 'last-2');
});

test('"esse último aí qual o valor dele parcelado" pergunta cartão ou crediário sem perder o produto', async () => {
  const phone = '5533977777740';

  const first = bot.compactProduct(product('amb-1', 'Smartphone Samsung A06', {
    category: 'Celulares',
    pixPrice: 699,
    price: 839
  }));
  const last = bot.compactProduct(product('amb-2', 'Smartphone Samsung Galaxy A17', {
    category: 'Celulares',
    pixPrice: 1191.01,
    price: 1430
  }));

  bot.patchTestConversation(phone, {
    lastProducts: [first, last],
    selectedProduct: null,
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'Esse último ai qual o valor dele parcelado?',
    pushName: 'Cliente Parcelado'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /Smartphone Samsung Galaxy A17/i);
  assert.match(sentTexts[0].text, /cartão/i);
  assert.match(sentTexts[0].text, /crediário\/carnê/i);
  assert.equal(bot.conversation(phone).selectedProduct.id, 'amb-2');
});

test('após perguntar quantas parcelas, resposta "12" calcula o crediário do mesmo produto', async () => {
  const phone = '5533977777741';

  const chosen = bot.compactProduct(product('pending-12', 'Smartphone Samsung Galaxy A17', {
    category: 'Celulares',
    pixPrice: 1191.01,
    price: 1430
  }));

  bot.patchTestConversation(phone, {
    lastProducts: [chosen],
    selectedProduct: chosen,
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'Qual o valor dele parcelado no boleto?',
    pushName: 'Cliente Parcelas'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /Em quantas vezes/i);
  assert.equal(bot.conversation(phone).pendingAction, 'credit_installments');
  assert.equal(bot.conversation(phone).pendingCreditProductId, 'pending-12');

  sentTexts = [];

  await bot.handleMessage({
    phone,
    text: '12',
    pushName: 'Cliente Parcelas'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /Smartphone Samsung Galaxy A17/i);
  assert.match(sentTexts[0].text, /12x de R\$/i);
  assert.match(sentTexts[0].text, /total de/i);
  assert.equal(bot.conversation(phone).lastCreditPlan.count, 12);
  assert.equal(bot.conversation(phone).pendingAction, '');
});

test('após perguntar quantas parcelas, resposta "12x" também calcula sem cair no fallback', async () => {
  const phone = '5533977777742';

  const chosen = bot.compactProduct(product('pending-12x', 'Smartphone Samsung A07', {
    category: 'Celulares',
    pixPrice: 739,
    price: 887
  }));

  bot.patchTestConversation(phone, {
    lastProducts: [chosen],
    selectedProduct: chosen,
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'Qual o valor dele parcelado no boleto?',
    pushName: 'Cliente Parcelas X'
  });

  sentTexts = [];

  await bot.handleMessage({
    phone,
    text: '12x',
    pushName: 'Cliente Parcelas X'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /Smartphone Samsung A07/i);
  assert.match(sentTexts[0].text, /12x de R\$/i);
  assert.doesNotMatch(sentTexts[0].text, /Me conta o que você está procurando/i);
  assert.equal(bot.conversation(phone).lastCreditPlan.count, 12);
});

test('"qual o valor desse último aí no boleto" usa o último produto e não pede foto', async () => {
  const phone = '5533977777734';

  const first = bot.compactProduct(product('last-boleto-1', 'Smartphone Samsung A06', {
    category: 'Celulares',
    pixPrice: 699,
    price: 839
  }));
  const last = bot.compactProduct(product('last-boleto-2', 'Smartphone Samsung Galaxy A17', {
    category: 'Celulares',
    pixPrice: 1191.01,
    price: 1430
  }));

  bot.patchTestConversation(phone, {
    lastProducts: [first, last],
    selectedProduct: null,
    lastIntent: 'produto',
    pendingImageIntent: '',
    pendingImageIntentUntil: 0
  });

  await bot.handleMessage({
    phone,
    text: 'Qual o valor desse último aí no boleto',
    pushName: 'Cliente Último Boleto'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /Smartphone Samsung Galaxy A17/i);
  assert.match(sentTexts[0].text, /crediário próprio/i);
  assert.match(sentTexts[0].text, /Em quantas vezes/i);
  assert.doesNotMatch(sentTexts[0].text, /foto ou o print/i);
  assert.equal(bot.conversation(phone).selectedProduct.id, 'last-boleto-2');
});

test('"mansa foto por favor" continua oferta de outros tamanhos de TV', async () => {
  const phone = '5533977777735';

  catalogRows = [
    product('typo-tv-32', 'Smart TV 32 LG Full HD', { category: 'TVs' }),
    product('typo-tv-43', 'Smart TV 43 Samsung 4K', { category: 'TVs' })
  ];

  const conv = bot.conversation(phone);
  await bot.showProducts(phone, conv, 'tv', 'Boa noite vocês tem tv ai de 65 polegadas?');

  assert.equal(sentMedia.length, 0);
  assert.equal(bot.conversation(phone).pendingAlternativeCategory, 'tv');

  sentTexts = [];
  sentMedia = [];

  await bot.handleMessage({
    phone,
    text: 'Mansa foto por favor',
    pushName: 'Cliente TV'
  });

  assert.equal(sentMedia.length, 2);
  assert.match(sentMedia[0].caption || '', /Smart TV 32/i);
  assert.match(sentMedia[1].caption || '', /Smart TV 43/i);
  assert.doesNotMatch(sentTexts.at(-1)?.text || '', /Me conta o que você está procurando/i);
});

test('produto sem foto real não gera card cinza de link preview', async () => {
  const phone = '5533977777733';

  catalogRows = [
    product('placeholder-1', 'Smartphone Teste sem Foto', {
      category: 'Celulares',
      imageUrl: 'https://placehold.co/600x400/CCCCCC/000000?text=Imagem+do+Produto'
    })
  ];

  const conv = bot.conversation(phone);
  await bot.showProducts(phone, conv, 'celular', 'Quero ver celular');

  assert.equal(sentMedia.length, 0);
  assert.ok(sentTexts.length >= 2);
  const productMessage = sentTexts.find((item) => /Smartphone Teste sem Foto/i.test(item.text || ''));
  assert.ok(productMessage, 'deve enviar os dados do produto em texto');
  assert.match(productMessage.text, /Foto indisponível no momento/i);
  assert.equal(productMessage.linkPreview, false);
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

test('primeiro produto em 10 vezes no boleto seleciona e calcula na mesma resposta', async () => {
  const phone = '5533977777701';
  const first = bot.compactProduct(product('cred-ord-1', 'Guarda Roupa Primeiro', {
    category: 'Guarda Roupa',
    price: 1000,
    pixPrice: 700
  }));
  const second = bot.compactProduct(product('cred-ord-2', 'Guarda Roupa Segundo', {
    category: 'Guarda Roupa',
    price: 1200,
    pixPrice: 840
  }));

  bot.patchTestConversation(phone, {
    lastProducts: [first, second],
    selectedProduct: null,
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'Qual o valor do primeiro parcelado em 10 vezes no boleto',
    pushName: 'Cliente Crediário'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /Guarda Roupa Primeiro/);
  assert.match(sentTexts[0].text, /10x de R\$\s+100,00/);
  assert.match(sentTexts[0].text, /total de \*?R\$\s+1\.000,00/);
  assert.equal(bot.conversation(phone).selectedProduct.id, 'cred-ord-1');
  assert.equal(bot.conversation(phone).lastCreditPlan.count, 10);
});

test('erro "beto" em contexto de parcela reaproveita o último plano do boleto', async () => {
  const phone = '5533977777702';
  const first = bot.compactProduct(product('cred-beto-1', 'Guarda Roupa Teste', {
    category: 'Guarda Roupa',
    price: 1000,
    pixPrice: 700
  }));

  bot.patchTestConversation(phone, {
    lastProducts: [first],
    selectedProduct: first,
    lastIntent: 'produto',
    lastCreditPlan: {
      productId: 'cred-beto-1',
      count: 10,
      divisor: 0.70,
      total: 1000,
      installment: 100
    }
  });

  await bot.handleMessage({
    phone,
    text: 'Valor da parcela no beto',
    pushName: 'Cliente Crediário'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /Guarda Roupa Teste/);
  assert.match(sentTexts[0].text, /10x de R\$\s+100,00/);
  assert.doesNotMatch(sentTexts[0].text, /Me conta o que você está procurando/i);
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

test('fallback marca Revisar atendimento sem desligar o bot', async () => {
  const phone = '5533977777750';

  await bot.handleMessage({
    phone,
    text: 'Queria aquele negócio que te falei outro dia',
    pushName: 'Cliente Revisão'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /Quero te ajudar com isso/i);
  assert.equal(backendEvents.length, 1);
  assert.equal(backendEvents[0].status, 'Revisar atendimento');
  assert.equal(backendEvents[0].metadata.reviewNeeded, true);
  assert.equal(backendEvents[0].metadata.atendimentoAutomaticoContinua, true);

  const conv = bot.conversation(phone);
  assert.equal(conv.reviewNeeded, true);
  assert.equal(Boolean(conv.humanUntil && conv.humanUntil > Date.now()), false);
  assert.equal(Boolean(conv.manualHumanUntil && conv.manualHumanUntil > Date.now()), false);

  catalogRows = [product('review-tv-1', 'Smart TV LG 43 Polegadas', { category: 'TVs' })];

  await bot.handleMessage({
    phone,
    text: 'Me mostra uma TV',
    pushName: 'Cliente Revisão'
  });

  assert.ok(sentMedia.length >= 1, 'bot deve continuar atendendo normalmente após marcar revisão');
  assert.equal(backendEvents.at(-1).status, 'Atendimento normal • Revisar atendimento');
  assert.equal(backendEvents.at(-1).metadata.reviewNeeded, true);
});

test('consulta de produto é classificada como Atendimento normal', async () => {
  const phone = '5533977777751';

  catalogRows = [
    product('normal-sofa-1', 'Sofá Retrátil 3 Lugares', { category: 'Sofá' })
  ];

  await bot.handleMessage({
    phone,
    text: 'Quero olhar sofá',
    pushName: 'Cliente Normal'
  });

  assert.ok(sentMedia.length >= 1);
  assert.equal(backendEvents.length, 1);
  assert.equal(backendEvents[0].status, 'Atendimento normal');
  assert.equal(backendEvents[0].metadata.intent, 'catalogo');
  assert.equal(backendEvents[0].metadata.reviewNeeded, false);
});

test('consulta de condição de pagamento é classificada como Venda em andamento', async () => {
  const phone = '5533977777752';
  const chosen = bot.compactProduct(product('sale-1', 'Smartphone Samsung A17', {
    category: 'Celulares',
    price: 1430,
    pixPrice: 1191.01
  }));

  bot.patchTestConversation(phone, {
    selectedProduct: chosen,
    lastProducts: [chosen],
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'Quanto fica no cartão?',
    pushName: 'Cliente Venda'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /No cartão/i);
  assert.equal(backendEvents.length, 1);
  assert.equal(backendEvents[0].status, 'Venda em andamento');
  assert.equal(backendEvents[0].metadata.paymentMode, 'cartao');
  assert.equal(backendEvents[0].metadata.productId, 'sale-1');
});

test('início do carnê é classificado como Crediário / análise', async () => {
  const phone = '5533977777753';
  const chosen = bot.compactProduct(product('credit-status-1', 'Geladeira Teste', {
    category: 'Geladeira',
    price: 2200,
    pixPrice: 1800
  }));

  bot.patchTestConversation(phone, {
    selectedProduct: chosen,
    lastProducts: [chosen],
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'Quero fazer no carnê',
    pushName: 'Cliente Crediário'
  });

  assert.match(sentTexts.at(-1).text, /nome completo/i);
  assert.equal(backendEvents.length, 1);
  assert.equal(backendEvents[0].status, 'Crediário / análise');
  assert.match(backendEvents[0].mensagem, /Geladeira Teste/i);
});

test('envio para análise orienta cliente novo e cliente já cadastrado', async () => {
  const phone = '5533977777758';
  const chosen = bot.compactProduct(product('credit-guide-1', 'Sofá Retrátil Teste', {
    category: 'Sofá',
    price: 1800,
    pixPrice: 1500
  }));

  bot.patchTestConversation(phone, {
    selectedProduct: chosen,
    lastProducts: [chosen],
    lastIntent: 'produto',
    customerName: 'Cliente Completo'
  });

  await bot.handleMessage({
    phone,
    text: 'Quero fazer no carnê',
    pushName: 'Cliente Completo'
  });

  assert.match(sentTexts.at(-1).text, /encaminhada para análise de crédito/i);
  assert.match(sentTexts.at(-1).text, /já é cliente da Ariana Móveis.*aguardar a aprovação da compra/is);
  assert.match(sentTexts.at(-1).text, /ainda não é cliente.*dados e documentos.*Crediário Ariana Móveis.*abertura do seu crédito/is);

  sentTexts = [];
  creditAnalysisExisting = true;

  await bot.handleMessage({
    phone,
    text: 'Quero fazer no carnê',
    pushName: 'Cliente Completo'
  });

  assert.match(sentTexts.at(-1).text, /solicitação de crediário já está aberta/i);
  assert.match(sentTexts.at(-1).text, /já é cliente da Ariana Móveis.*aguardar a aprovação da compra/is);
  assert.match(sentTexts.at(-1).text, /ainda não é cliente.*dados e documentos.*Crediário Ariana Móveis.*abertura do seu crédito/is);
});

test('resposta manual do Marcelo limpa revisão e registra atendimento humano', async () => {
  const phone = '5533977777754';

  await bot.handleMessage({
    phone,
    text: 'Aquele trem lá que eu queria',
    pushName: 'Cliente Revisão Manual'
  });

  assert.equal(bot.conversation(phone).reviewNeeded, true);

  const result = await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: { remoteJid: phone + '@s.whatsapp.net', fromMe: true, id: 'HUMAN-REVIEW-1' },
      pushName: 'ariana móveis (Marcelo)',
      message: { conversation: 'Oi, voltei. Vou verificar para você.' }
    }
  });

  assert.equal(result.humanPause, true);
  assert.equal(bot.conversation(phone).reviewNeeded, false);
  assert.equal(backendEvents.at(-1).status, 'Em atendimento pelo Marcelo');
  assert.equal(backendEvents.at(-1).metadata.reviewNeeded, false);
  assert.equal(backendEvents.at(-1).metadata.manualHuman, true);
});

test('falha total do catálogo não deixa cliente sem resposta e marca revisão', async () => {
  const phone = '5533977777755';
  catalogResponseStatus = 500;

  const result = await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: { remoteJid: phone + '@s.whatsapp.net', fromMe: false, id: 'CATALOG-ERROR-1' },
      pushName: 'Cliente Erro Catálogo',
      message: { conversation: 'Quero ver uma TV' }
    }
  });

  assert.equal(result.recovered, true);
  assert.equal(result.reviewNeeded, true);
  assert.ok(sentTexts.some((item) => /Tive uma dificuldade para processar/i.test(item.text || '')));
  assert.equal(backendEvents.at(-1).status, 'Revisar atendimento');
  assert.equal(backendEvents.at(-1).metadata.reviewNeeded, true);
  assert.match(backendEvents.at(-1).metadata.reviewReason || '', /catalog_unavailable/i);

  const conv = bot.conversation(phone);
  assert.equal(conv.reviewNeeded, true);
  assert.equal(Boolean(conv.humanUntil && conv.humanUntil > Date.now()), false);
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



test('mensagem de PIX inclui alerta obrigatório do favorecido', async () => {
  const phone = '5533933333333';

  await bot.handleMessage({
    phone,
    text: 'Me passa a chave pix',
    pushName: 'Cliente PIX'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /31985147119/);
  assert.match(sentTexts[0].text, /MARCELO NUNES SILVA/);
  assert.match(sentTexts[0].text, /somente se aparecer/i);
  assert.match(sentTexts[0].text, /não realize o pagamento/i);
});

test('pedido de chave para pagar parcela do mês envia o PIX correto', async () => {
  const phone = '5533933333335';

  await bot.handleMessage({
    phone,
    text: 'Me envia sua chave pra eu fazer o pagamento da parcela desse mês',
    pushName: 'Cliente Parcela'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /31985147119/);
  assert.match(sentTexts[0].text, /MARCELO NUNES SILVA/);
  assert.match(sentTexts[0].text, /BTG/);
  assert.match(sentTexts[0].text, /somente se aparecer/i);
});

test('palavra chave fora de contexto de pagamento não é tratada como PIX', () => {
  assert.equal(
    bot.asksPixKey('Qual a chave para apertar esse parafuso?'),
    false
  );
  assert.equal(
    bot.asksPixKey('Você tem chave de fenda?'),
    false
  );
});

test('texto dizendo que pagou pede o comprovante em vez de confirmar baixa', async () => {
  const phone = '5533933333334';

  await bot.handleMessage({
    phone,
    text: 'Paguei no PIX',
    pushName: 'Cliente PIX'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /Pode enviar o comprovante/i);
  assert.equal(backendEvents.length, 0);
});


test('orçamento mensal da visão contabiliza uso real em reais', () => {
  const initial = bot.visionBudgetStatus();
  assert.equal(initial.limitBrl, 30);
  assert.equal(initial.stopAtBrl, 29.5);
  assert.equal(initial.blocked, false);

  const after = bot.recordVisionUsage({
    input_tokens: 1_000_000,
    output_tokens: 0
  });

  // US$ 0,20 de entrada x câmbio conservador R$ 6,00/US$ = R$ 1,20.
  assert.equal(after.usedBrl, 1.2);
  assert.equal(after.requests, 1);
  assert.equal(after.inputTokens, 1_000_000);
  assert.equal(after.outputTokens, 0);
});

test('visão bloqueia novas chamadas antes de ultrapassar R$ 30 no mês', async () => {
  const phone = '5533923333399';

  bot.patchTestVisionBudget({
    estimatedBrl: 29.50,
    requests: 99,
    inputTokens: 0,
    outputTokens: 0
  });

  const status = bot.visionBudgetStatus();
  assert.equal(status.limitBrl, 30);
  assert.equal(status.stopAtBrl, 29.5);
  assert.equal(status.blocked, true);

  const result = await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: {
        remoteJid: phone + '@s.whatsapp.net',
        fromMe: false,
        id: 'VISION-BUDGET-BLOCK-1'
      },
      pushName: 'Cliente',
      message: {
        imageMessage: {
          mimetype: 'image/jpeg'
        }
      }
    }
  });

  assert.equal(result.vision, 'vision_budget_blocked');
  assert.match(sentTexts.at(-1).text, /análise automática de imagens está temporariamente indisponível/i);
  assert.equal(
    requestLog.some((item) => item.href === 'https://api.openai.com/v1/responses'),
    false,
    'não pode chamar a API da OpenAI quando o limite mensal estiver bloqueado'
  );
  assert.equal(
    requestLog.some((item) => item.href.startsWith('https://evolution.test/chat/getBase64FromMediaMessage/')),
    false,
    'não precisa baixar a mídia quando a análise visual já está bloqueada'
  );
});


test('áudio recebido do cliente é transcrito e segue o mesmo atendimento de texto', async () => {
  const phone = '5533923333401';

  audioTranscriptionText = 'Quero olhar geladeira';
  mediaBase64Response = {
    mimetype: 'audio/ogg; codecs=opus',
    base64: 'T2dnUwBmYWtlLWF1ZGlv'
  };

  catalogRows = [
    product('gel-audio-1', 'Geladeira Frost Free 400L', {
      category: 'Geladeira',
      stock: 3
    })
  ];

  const result = await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: {
        remoteJid: phone + '@s.whatsapp.net',
        fromMe: false,
        id: 'AUDIO-CUSTOMER-1'
      },
      pushName: 'Cliente Áudio',
      message: {
        audioMessage: {
          mimetype: 'audio/ogg; codecs=opus',
          seconds: 12,
          ptt: true
        }
      }
    }
  });

  assert.equal(result.audio, 'audio_transcribed');
  assert.equal(result.durationSeconds, 12);
  assert.ok(
    requestLog.some((item) => item.href === 'https://api.openai.com/v1/audio/transcriptions'),
    'deve chamar a transcrição da OpenAI'
  );
  assert.ok(
    sentMedia.some((item) => /Geladeira Frost Free 400L/i.test(item.caption || '')),
    'texto transcrito deve entrar na busca normal de produtos'
  );

  const budget = bot.visionBudgetStatus();
  assert.equal(budget.audioRequests, 1);
  assert.equal(budget.audioSeconds, 12);
  assert.equal(budget.usedBrl, 0.0036);
});

test('áudio fora de venda recebe saudação e fica aguardando retorno do Marcelo', async () => {
  const phone = '5533923333410';

  audioTranscriptionText = 'Pessoal, bom dia, tudo bem? Carro saindo hoje às 11 horas, rota completa. Pode adiantar os pedidos, eu agradeço.';
  mediaBase64Response = {
    mimetype: 'audio/ogg; codecs=opus',
    base64: 'T2dnUwBmYWtlLWF1ZGlvLWZvc3Njb3Bl'
  };

  const result = await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: {
        remoteJid: phone + '@s.whatsapp.net',
        fromMe: false,
        id: 'AUDIO-OUT-OF-SALES-1'
      },
      pushName: 'Fornecedor Rota',
      message: {
        audioMessage: {
          mimetype: 'audio/ogg; codecs=opus',
          seconds: 10,
          ptt: true
        }
      }
    }
  });

  assert.equal(result.audio, 'audio_transcribed');
  assert.match(sentTexts.at(-1).text, /^Bom dia! 😊/i);
  assert.match(sentTexts.at(-1).text, /Não consigo te ajudar com esse assunto por aqui/i);
  assert.match(sentTexts.at(-1).text, /Marcelo.*retorno/i);
  assert.match(sentTexts.at(-1).text, /fotos de produtos/i);

  assert.equal(backendEvents.at(-1).status, 'Aguardando retorno do Marcelo');
  assert.equal(backendEvents.at(-1).metadata.assunto, 'fora_escopo_vendas');
  assert.equal(backendEvents.at(-1).metadata.atendimentoAutomaticoContinua, true);
  assert.equal(bot.conversation(phone).marceloCallbackRequested, true);
});

test('áudio sobre beliche continua no atendimento de venda e não vira assunto fora de escopo', async () => {
  const phone = '5533923333411';

  audioTranscriptionText = 'Bom dia, queria olhar uma beliche para minha filha e saber as condições para pagar.';
  mediaBase64Response = {
    mimetype: 'audio/ogg; codecs=opus',
    base64: 'T2dnUwBmYWtlLWF1ZGlvLWJlbGljaGU='
  };
  catalogRows = [
    product('beliche-audio-1', 'Beliche Solteiro Madeira', {
      category: 'Beliche',
      stock: 2
    })
  ];

  const result = await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: {
        remoteJid: phone + '@s.whatsapp.net',
        fromMe: false,
        id: 'AUDIO-BELICHE-SALE-1'
      },
      pushName: 'Cliente Beliche',
      message: {
        audioMessage: {
          mimetype: 'audio/ogg; codecs=opus',
          seconds: 18,
          ptt: true
        }
      }
    }
  });

  assert.equal(result.audio, 'audio_transcribed');
  assert.ok(
    sentMedia.some((item) => /Beliche Solteiro Madeira/i.test(item.caption || '')),
    'beliche deve seguir como busca de produto'
  );
  assert.equal(
    backendEvents.some((item) => item.metadata?.assunto === 'fora_escopo_vendas'),
    false,
    'venda de mercadoria não pode ser encaminhada como assunto fora de escopo'
  );
});

test('pedido comercial pouco claro pede mais detalhes e não chama Marcelo automaticamente', async () => {
  const phone = '5533923333412';

  await bot.handleMessage({
    phone,
    text: 'Quero comprar uma mercadoria mas queria entender melhor o valor e como fica para pagar',
    pushName: 'Cliente Comercial'
  });

  assert.match(sentTexts.at(-1).text, /Quero te ajudar com isso/i);
  assert.match(sentTexts.at(-1).text, /produto ou da condição/i);
  assert.equal(
    backendEvents.some((item) => item.status === 'Aguardando retorno do Marcelo'),
    false
  );
  assert.equal(bot.conversation(phone).marceloCallbackRequested, false);
});

test('áudio perguntando diretamente pelo Marcelo é reconhecido e responde com saudação', async () => {
  const phone = '5533923333413';

  audioTranscriptionText = 'Bom dia, tudo bem? Ô Marcelo, é com você que eu estou falando nesse número? Fala aqui comigo, por favor.';
  mediaBase64Response = {
    mimetype: 'audio/ogg; codecs=opus',
    base64: 'T2dnUwBmYWtlLWF1ZGlvLW1hcmNlbG8='
  };

  const result = await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: {
        remoteJid: phone + '@s.whatsapp.net',
        fromMe: false,
        id: 'AUDIO-MARCELO-DIRECT-1'
      },
      pushName: 'Rosilene',
      message: {
        audioMessage: {
          mimetype: 'audio/ogg; codecs=opus',
          seconds: 9,
          ptt: true
        }
      }
    }
  });

  assert.equal(result.audio, 'audio_transcribed');
  assert.match(sentTexts.at(-1).text, /^Bom dia! 😊/i);
  assert.match(sentTexts.at(-1).text, /O Marcelo está em outro atendimento/i);
  assert.equal(backendEvents.at(-1).status, 'Aguardando retorno do Marcelo');
});

test('áudio enviado pela própria loja não é transcrito', async () => {
  const phone = '5533923333402';

  const result = await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: {
        remoteJid: phone + '@s.whatsapp.net',
        fromMe: true,
        id: 'AUDIO-FROM-ME-1'
      },
      pushName: 'Ariana Móveis',
      message: {
        audioMessage: {
          mimetype: 'audio/ogg; codecs=opus',
          seconds: 18,
          ptt: true
        }
      }
    }
  });

  assert.equal(result.humanPause, true);
  assert.equal(
    requestLog.some((item) => item.href === 'https://api.openai.com/v1/audio/transcriptions'),
    false,
    'áudio fromMe nunca deve gerar custo de transcrição'
  );
});

test('áudio acima de 10 minutos é recusado sem chamar a API', async () => {
  const phone = '5533923333403';

  const result = await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: {
        remoteJid: phone + '@s.whatsapp.net',
        fromMe: false,
        id: 'AUDIO-LONG-1'
      },
      pushName: 'Cliente Áudio Longo',
      message: {
        audioMessage: {
          mimetype: 'audio/ogg; codecs=opus',
          seconds: 601,
          ptt: true
        }
      }
    }
  });

  assert.equal(result.audio, 'audio_too_long');
  assert.match(sentTexts.at(-1).text, /até 10 minutos/i);
  assert.equal(
    requestLog.some((item) => item.href === 'https://api.openai.com/v1/audio/transcriptions'),
    false
  );
});

test('teto mensal bloqueia transcrição de áudio sem nova cobrança', async () => {
  const phone = '5533923333404';

  bot.patchTestVisionBudget({
    estimatedBrl: 29.50,
    requests: 100,
    audioRequests: 0,
    audioSeconds: 0
  });

  const result = await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: {
        remoteJid: phone + '@s.whatsapp.net',
        fromMe: false,
        id: 'AUDIO-BUDGET-BLOCK-1'
      },
      pushName: 'Cliente',
      message: {
        audioMessage: {
          mimetype: 'audio/ogg; codecs=opus',
          seconds: 30,
          ptt: true
        }
      }
    }
  });

  assert.equal(result.audio, 'ai_budget_blocked');
  assert.match(sentTexts.at(-1).text, /transcrição automática está temporariamente indisponível/i);
  assert.equal(
    requestLog.some((item) => item.href === 'https://api.openai.com/v1/audio/transcriptions'),
    false
  );
  assert.equal(
    requestLog.some((item) => item.href.startsWith('https://evolution.test/chat/getBase64FromMediaMessage/')),
    false,
    'não deve nem baixar o áudio quando o orçamento já está bloqueado'
  );
});

test('imagem reconhecida como comprovante PIX é registrada para análise', async () => {
  const phone = '5533923333333';

  visionClassification = {
    kind: 'payment_receipt_pix',
    confidence: 0.96,
    product_name: '',
    brand: '',
    model: '',
    category_hint: '',
    payment_method: 'pix',
    payment_recipient_name: 'MARCELO NUNES SILVA',
    summary: 'Comprovante PIX'
  };

  const result = await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: {
        remoteJid: phone + '@s.whatsapp.net',
        fromMe: false,
        id: 'PIX-PROOF-VISION-1'
      },
      pushName: 'Cliente PIX',
      message: {
        imageMessage: {
          mimetype: 'image/jpeg'
        }
      }
    }
  });

  assert.equal(result.media, true);
  assert.equal(result.vision, 'payment_receipt_pix');
  assert.match(sentTexts[0].text, /pagamento está sendo analisado/i);
  assert.match(sentTexts[0].text, /comprovante da baixa do pagamento/i);

  assert.equal(backendEvents.length, 1);
  assert.match(backendEvents[0].status, /Comprovante de pagamento recebido - analisar baixa/i);
});

test('imagem reconhecida como comprovante de boleto recebe a mesma confirmação segura', async () => {
  const phone = '5533923333334';

  visionClassification = {
    kind: 'payment_receipt_boleto',
    confidence: 0.94,
    product_name: '',
    brand: '',
    model: '',
    category_hint: '',
    payment_method: 'boleto',
    payment_recipient_name: '',
    summary: 'Comprovante de pagamento de boleto'
  };

  const result = await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: {
        remoteJid: phone + '@s.whatsapp.net',
        fromMe: false,
        id: 'BOLETO-PROOF-VISION-1'
      },
      pushName: 'Cliente Boleto',
      message: {
        imageMessage: {
          mimetype: 'image/jpeg'
        }
      }
    }
  });

  assert.equal(result.vision, 'payment_receipt_boleto');
  assert.match(sentTexts[0].text, /pagamento está sendo analisado/i);
  assert.equal(backendEvents.length, 1);
  assert.match(backendEvents[0].status, /Comprovante de pagamento recebido - analisar baixa/i);
});


test('PDF de comprovante de boleto também é analisado pela visão', async () => {
  const phone = '5533923333337';

  mediaBase64Response = {
    mimetype: 'application/pdf',
    base64: 'JVBERi0xLjQKZmFrZS1wZGY='
  };

  visionClassification = {
    kind: 'payment_receipt_boleto',
    confidence: 0.95,
    product_name: '',
    brand: '',
    model: '',
    category_hint: '',
    payment_method: 'boleto',
    payment_recipient_name: '',
    summary: 'Comprovante de boleto em PDF'
  };

  const result = await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: {
        remoteJid: phone + '@s.whatsapp.net',
        fromMe: false,
        id: 'BOLETO-PDF-VISION-1'
      },
      pushName: 'Cliente PDF',
      message: {
        documentMessage: {
          mimetype: 'application/pdf',
          fileName: 'comprovante.pdf'
        }
      }
    }
  });

  assert.equal(result.vision, 'payment_receipt_boleto');
  assert.match(sentTexts[0].text, /pagamento está sendo analisado/i);
  assert.equal(backendEvents.length, 1);

  const openAiCall = requestLog.find((item) => item.href === 'https://api.openai.com/v1/responses');
  assert.ok(openAiCall, 'deve chamar a visão para o PDF');
  const body = JSON.parse(openAiCall.options.body);
  const filePart = body.input[0].content.find((item) => item.type === 'input_file');
  assert.ok(filePart, 'PDF deve ser enviado como input_file');
  assert.match(filePart.file_data, /^data:application\/pdf;base64,/);
});

test('foto de produto não é confundida com comprovante mesmo após contexto PIX', async () => {
  const phone = '5533923333335';

  await bot.handleMessage({
    phone,
    text: 'Me passa a chave pix',
    pushName: 'Cliente'
  });
  assert.equal(bot.isPixContext(bot.conversation(phone)), true);

  visionClassification = {
    kind: 'product',
    confidence: 0.93,
    product_name: 'Smart TV 43 polegadas',
    brand: 'LG',
    model: '',
    category_hint: 'tv',
    payment_method: 'unknown',
    payment_recipient_name: '',
    summary: 'Televisão LG'
  };

  catalogRows = [
    product('tv-vision-1', 'Smart TV LG 43 Polegadas', {
      category: 'TV',
      brand: 'LG',
      stock: 3
    })
  ];

  const result = await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: {
        remoteJid: phone + '@s.whatsapp.net',
        fromMe: false,
        id: 'PRODUCT-AFTER-PIX-1'
      },
      pushName: 'Cliente',
      message: {
        imageMessage: {
          mimetype: 'image/jpeg'
        }
      }
    }
  });

  assert.equal(result.vision, 'product');
  assert.equal(backendEvents.length, 0);
  assert.ok(
    sentTexts.some((item) => /Pela imagem, identifiquei/i.test(item.text)) ||
    sentMedia.some((item) => /Smart TV LG 43/i.test(item.caption || ''))
  );
});

test('cliente pergunta se vende produto e envia print: visão consulta catálogo', async () => {
  const phone = '5533923333336';

  await bot.handleMessage({
    phone,
    text: 'Marcelo você vende desse produto aqui?',
    pushName: 'Cliente Produto'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /Pode me mandar a foto ou o print/i);

  visionClassification = {
    kind: 'product',
    confidence: 0.95,
    product_name: 'Air Fryer 5 litros',
    brand: 'Mondial',
    model: 'AFN-50',
    category_hint: 'air fryer',
    payment_method: 'unknown',
    payment_recipient_name: '',
    summary: 'Air Fryer Mondial'
  };

  catalogRows = [
    product('af-vision-1', 'Air Fryer Mondial AFN-50 5L', {
      category: 'Air Fryer',
      brand: 'Mondial',
      stock: 2
    })
  ];

  await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: {
        remoteJid: phone + '@s.whatsapp.net',
        fromMe: false,
        id: 'PRODUCT-PRINT-1'
      },
      pushName: 'Cliente Produto',
      message: {
        imageMessage: {
          mimetype: 'image/jpeg'
        }
      }
    }
  });

  assert.ok(sentTexts.some((item) => /Pela imagem, identifiquei/i.test(item.text)));
  assert.ok(sentMedia.some((item) => /Air Fryer Mondial AFN-50/i.test(item.caption || '')));
  assert.equal(bot.conversation(phone).lastIntent, 'produto');
});


test('pedido de produtos parecidos após imagem usa a categoria visual e envia fotos', async () => {
  const phone = '5533923333345';

  visionClassification = {
    kind: 'product',
    confidence: 0.96,
    product_name: 'Guarda-Roupa Casal 6 Portas 4 Gavetas',
    brand: 'MadeiraMadeira',
    model: '',
    category_hint: 'guarda-roupa',
    payment_method: 'unknown',
    payment_recipient_name: '',
    summary: 'Guarda-roupa casal'
  };

  catalogRows = [];

  await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: {
        remoteJid: phone + '@s.whatsapp.net',
        fromMe: false,
        id: 'VISUAL-WARDROBE-1'
      },
      pushName: 'Cliente',
      message: {
        imageMessage: {
          mimetype: 'image/jpeg',
          caption: 'Você tem desse aqui?'
        }
      }
    }
  });

  assert.match(sentTexts.at(-1).text, /posso te mostrar/i);
  assert.match(sentTexts.at(-1).text, /guarda-roupa/i);
  assert.equal(bot.conversation(phone).awaitingSimilarOptions, true);

  const textCountBefore = sentTexts.length;
  catalogRows = [
    product('gr-visual-1', 'Guarda-Roupa Casal 6 Portas', {
      category: 'Guarda-Roupa',
      stock: 4
    }),
    product('gr-visual-2', 'Guarda-Roupa Casal 8 Portas', {
      category: 'Guarda-Roupa',
      stock: 3
    })
  ];

  await bot.handleMessage({
    phone,
    text: 'Me manda fotos do que você tem aí parecido com esse',
    pushName: 'Cliente'
  });

  const newTexts = sentTexts.slice(textCountBefore).map((item) => item.text || '').join('\n');
  assert.match(newTexts, /Vou te mostrar algumas opções de \*guarda-roupa\*/i);
  assert.doesNotMatch(newTexts, /Pela imagem, parece ser/i);
  assert.ok(sentMedia.some((item) => /Guarda-Roupa Casal 6 Portas/i.test(item.caption || '')));
  assert.ok(sentMedia.some((item) => /Guarda-Roupa Casal 8 Portas/i.test(item.caption || '')));
  assert.equal(bot.conversation(phone).awaitingSimilarOptions, false);
});

test('"manda aí" continua o pedido de similares quando o bot acabou de oferecer opções', async () => {
  const phone = '5533923333346';

  visionClassification = {
    kind: 'product',
    confidence: 0.95,
    product_name: 'Guarda-Roupa Casal 6 Portas 4 Gavetas',
    brand: 'MadeiraMadeira',
    model: '',
    category_hint: 'guarda-roupa',
    payment_method: 'unknown',
    payment_recipient_name: '',
    summary: 'Guarda-roupa casal'
  };

  catalogRows = [];

  await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: {
        remoteJid: phone + '@s.whatsapp.net',
        fromMe: false,
        id: 'VISUAL-WARDROBE-2'
      },
      pushName: 'Cliente',
      message: {
        imageMessage: {
          mimetype: 'image/jpeg',
          caption: 'Você tem desse aqui?'
        }
      }
    }
  });

  assert.equal(bot.conversation(phone).awaitingSimilarOptions, true);

  catalogRows = [
    product('gr-visual-3', 'Guarda-Roupa Casal 6 Portas Espelho', {
      category: 'Guarda-Roupa',
      stock: 2
    })
  ];

  await bot.handleMessage({
    phone,
    text: 'Manda ai',
    pushName: 'Cliente'
  });

  assert.ok(sentMedia.some((item) => /Guarda-Roupa Casal 6 Portas Espelho/i.test(item.caption || '')));
  assert.equal(bot.conversation(phone).awaitingSimilarOptions, false);
  assert.equal(
    sentTexts.some((item) => /Me conta o que você está procurando/i.test(item.text || '')),
    false,
    '"manda ai" não pode cair no fallback genérico'
  );
});

test('imagem incerta em contexto PIX não é assumida como comprovante', async () => {
  const phone = '5533913333333';

  await bot.handleMessage({
    phone,
    text: 'Me passa a chave pix',
    pushName: 'Cliente'
  });

  visionClassification = {
    kind: 'other',
    confidence: 0.45,
    product_name: '',
    brand: '',
    model: '',
    category_hint: '',
    payment_method: 'unknown',
    payment_recipient_name: '',
    summary: 'Imagem indefinida'
  };

  const result = await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: {
        remoteJid: phone + '@s.whatsapp.net',
        fromMe: false,
        id: 'MEDIA-UNCERTAIN-1'
      },
      pushName: 'Cliente',
      message: {
        imageMessage: {
          mimetype: 'image/jpeg'
        }
      }
    }
  });

  assert.equal(result.media, true);
  assert.equal(backendEvents.length, 0);
  assert.match(sentTexts.at(-1).text, /não consegui confirmar com segurança/i);
});

test('emojis positivos, de dúvida e negativos têm comportamento próprio', async () => {
  const positivePhone = '5533913333340';
  await bot.handleMessage({ phone: positivePhone, text: '👍', pushName: 'Cliente' });
  assert.equal(sentTexts.length, 0);

  await bot.handleMessage({ phone: '5533913333341', text: '🤔', pushName: 'Cliente' });
  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /estou aqui/i);

  await bot.handleMessage({ phone: '5533913333342', text: '👎', pushName: 'Cliente' });
  assert.equal(sentTexts.length, 2);
  assert.match(sentTexts[1].text, /O que aconteceu/i);
});

test('pedido para falar com Marcelo ou receber ligação é reconhecido', () => {
  for (const value of [
    'Oi Marcelo tudo bem? Tô precisando falar com você',
    'Oi macelo tudo bem teria mim ligar aqui',
    'Quero falar com o Marcelo',
    'Marcelo está aí?',
    'Teria como me ligar aqui?',
    'Teria mim ligar aqui?',
    'Pode me ligar quando puder?',
    'Liga aqui pra mim',
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
    'Disse que vocês têm ótimos preços',
    'Disseram que vocês têm ótimos produtos',
    'Disse que compra com vocês e que vocês têm ótimos produtos',
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

test('cliente que propõe pagar só parte por imprevisto é encaminhado ao Marcelo sem acordo automático', async () => {
  const phone = '5533988888820';

  await bot.handleMessage({
    phone,
    text: 'Esse mês vou te mandar somente 200 porque tive um imprevisto e precisei gastar com médico e medicamentos',
    pushName: 'Cliente Parcial'
  });

  assert.equal(sentTexts.length, 1);
  assert.equal(
    sentTexts[0].text,
    'Ok 😊 Assim que o Marcelo chegar, eu peço para ele retornar para você por aqui.'
  );

  assert.equal(backendEvents.length, 1);
  assert.equal(backendEvents[0].status, 'Aguardando retorno do Marcelo');
  assert.equal(backendEvents[0].metadata.assunto, 'negociacao_pagamento_parcial');
  assert.equal(backendEvents[0].metadata.exigeConfirmacaoMarcelo, true);

  const financeCall = requestLog.find((item) =>
    item.href === 'https://backend.test/api/bot/financeiro/contas-receber'
  );
  assert.equal(financeCall, undefined, 'não deve consultar nem alterar financeiro nessa proposta');

  const conv = bot.conversation(phone);
  assert.equal(conv.marceloCallbackRequested, true);
  assert.equal(Boolean(conv.humanUntil && conv.humanUntil > Date.now()), false);
});

test('motivos comuns de dificuldade com pagamento parcial são reconhecidos', () => {
  const examples = [
    'esse mes vou te mandar so 100 porque meu pagamento veio pouco',
    'este mês só consigo pagar 150 porque não recebi ainda',
    'esse mes posso te passar somente 200 porque tive um imprevisto',
    'vou te pagar só 120 porque precisei gastar com remedio',
    'esse mês vou enviar apenas 90 porque tive gasto com hospital'
  ];

  for (const value of examples) {
    assert.equal(bot.asksPaymentExceptionForMarcelo(value), true, value);
  }

  assert.equal(
    bot.asksPaymentExceptionForMarcelo('Quanto tenho que te passar esse mês?'),
    false,
    'consulta normal de valor não pode virar negociação'
  );
});

test('consulta financeira usa Contas a Receber do Ariana ERP e responde parcela do mês', async () => {
  const phone = '5533988888810';
  const now = new Date();
  const due = new Date(now.getFullYear(), now.getMonth(), Math.min(20, new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()));

  financeResponse = {
    ok: true,
    fonteFinanceira: 'ariana_erp_financeiro_cobrancas',
    cliente: { nome: 'Marcelo Teste' },
    resumo: { parcelasAbertas: 2, saldo: 450 },
    parcelas: [
      {
        parcelaLabel: '3/10',
        dataVencimento: due.toISOString(),
        status: 'pendente',
        quitado: false,
        vencida: false,
        emAberto: true,
        valorParcela: 150,
        valorPago: 0,
        saldoParcela: 150,
        atualizacaoFinanceira: {
          diasAtraso: 0,
          multa: 0,
          juros: 0,
          valorAtualizado: 150
        }
      },
      {
        parcelaLabel: '4/10',
        dataVencimento: new Date(now.getFullYear(), now.getMonth() + 1, 20).toISOString(),
        status: 'pendente',
        quitado: false,
        vencida: false,
        emAberto: true,
        valorParcela: 300,
        valorPago: 0,
        saldoParcela: 300,
        atualizacaoFinanceira: {
          diasAtraso: 0,
          multa: 0,
          juros: 0,
          valorAtualizado: 300
        }
      }
    ]
  };

  await bot.handleMessage({
    phone,
    text: 'quantos que tenho que te passar esse mes ?',
    pushName: 'Marcelo Teste'
  });

  const financeCall = requestLog.find((item) =>
    item.href === 'https://backend.test/api/bot/financeiro/contas-receber'
  );
  assert.ok(financeCall, 'deve consultar o Contas a Receber do ERP');
  assert.match(sentTexts.at(-1).text, /parcelas no financeiro da Ariana Móveis/i);
  assert.match(sentTexts.at(-1).text, /total em aberto/i);
  assert.match(sentTexts.at(-1).text, /R\$\s*450,00/i);
  assert.match(sentTexts.at(-1).text, /Neste mês você tem/i);
  assert.match(sentTexts.at(-1).text, /R\$\s*150,00/i);
  assert.doesNotMatch(sentTexts.at(-1).text, /carnê consultado/i);
});

test('consulta financeira sem vínculo seguro por telefone continua pedindo CPF', async () => {
  const phone = '5533988888811';

  financeResponseStatus = 409;
  financeResponse = {
    ok: false,
    identityRequired: true,
    error: 'Para proteger os dados do cliente, confirme o CPF do titular.'
  };

  await bot.handleMessage({
    phone,
    text: 'Qual o valor da minha notinha?',
    pushName: 'Cliente Financeiro'
  });

  assert.equal(bot.conversation(phone).pendingAction, 'finance_cpf');
  assert.match(sentTexts.at(-1).text, /CPF do titular com 11 números/i);

  financeResponseStatus = 200;
  financeResponse = {
    ok: true,
    fonteFinanceira: 'ariana_erp_financeiro_cobrancas',
    cliente: { nome: 'Cliente Financeiro' },
    parcelas: []
  };

  await bot.handleMessage({
    phone,
    text: '05292442682',
    pushName: 'Cliente Financeiro'
  });

  assert.equal(bot.conversation(phone).pendingAction, '');
  assert.match(sentTexts.at(-1).text, /parcelas no financeiro da Ariana Móveis/i);
  assert.match(sentTexts.at(-1).text, /Não encontrei parcelas em aberto/i);

  const calls = requestLog.filter((item) =>
    item.href === 'https://backend.test/api/bot/financeiro/contas-receber'
  );
  assert.equal(calls.length, 2);
  const cpfBody = JSON.parse(calls[1].options.body);
  assert.equal(cpfBody.cpf, '05292442682');
});

test('quando perguntam quem está falando o atendente se apresenta como Gustavo', async () => {
  const phone = '5533988888830';

  await bot.handleMessage({
    phone,
    text: 'Com quem eu estou falando?',
    pushName: 'Cliente Identidade'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /Aqui é o Gustavo/i);
  assert.match(sentTexts[0].text, /Ariana Móveis/i);
});

test('perguntas sobre Emilly ou Luana informam que não trabalham mais na loja', async () => {
  const cases = [
    ['Cadê a Emilly?', /A Emilly não trabalha mais aqui/i],
    ['A Emilly se encontra?', /A Emilly não trabalha mais aqui/i],
    ['É a Luana?', /A Luana não trabalha mais aqui/i],
    ['É a Emily ou Luana?', /A Emilly e a Luana não trabalham mais aqui/i]
  ];

  for (let i = 0; i < cases.length; i += 1) {
    const [message, expected] = cases[i];
    const phone = '553398888884' + i;
    await bot.handleMessage({
      phone,
      text: message,
      pushName: 'Cliente Funcionária'
    });
    assert.match(sentTexts.at(-1).text, expected);
    assert.match(sentTexts.at(-1).text, /Gustavo/i);
  }
});

test('"esse mês" não é confundido com referência a produto', () => {
  assert.equal(bot.asksThisShownProduct('esse mês vou te pagar somente 200'), false);
  assert.equal(bot.asksThisShownProduct('quanto fica esse em 10x no boleto?'), true);
});

test('classificação de assunto separa venda de operação interna', () => {
  assert.equal(
    bot.isCommercialTopic('Quero ver uma beliche e saber quanto fica no carnê'),
    true
  );
  assert.equal(
    bot.isCommercialTopic('Carro saindo às 11, rota completa, pode adiantar os pedidos'),
    false
  );
  assert.equal(
    bot.greetingForFallback('Pessoal, bom dia, tudo bem?'),
    'Bom dia'
  );
});

test('intenções financeiras e atendimento humano genérico continuam reconhecidas', () => {
  assert.equal(bot.asksFinance('Qual o valor da minha notinha?'), true);
  assert.equal(bot.asksFinance('Quanto tenho que te passar esse mês?'), true);
  assert.equal(bot.asksFinance('quantos que tenho que te passar esse mes ?'), true);
  assert.equal(bot.asksFinance('qual o valor tenho que te mandar ?'), true);
  assert.equal(bot.asksFinance('preciso te mandar quantos mesmo?'), true);
  assert.equal(bot.asksFinance('soma pra mim minhas notinhas ai'), true);
  assert.equal(bot.asksFinance('soma pra mim minha conta e me manda o valor aqui fazendo favor ?'), true);
  assert.equal(bot.asksFinance('soma tudo que eu te devo aí pra mim fazendo favor'), true);
  assert.equal(bot.asksFinance('esqueci o valor que tenho que te mandar'), true);
  assert.equal(bot.wantsHuman('Quero um atendente'), true);
  assert.equal(bot.wantsHuman('Quero falar com uma pessoa'), true);
  assert.equal(bot.wantsHuman('Quero falar com o Marcelo'), false);
});
