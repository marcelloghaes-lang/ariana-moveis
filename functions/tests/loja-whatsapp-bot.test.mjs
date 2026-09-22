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
let dailyDueContextResponse = { ok: true, active: false, date: '2026-09-22', status: '' };
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
    cardPrice: options.cardPrice,
    fullPrice: options.fullPrice,
    marketplacePrice: options.marketplacePrice,
    sellerBasePrice: options.sellerBasePrice,
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

    if (href === 'https://backend.test/api/bot/financeiro/vencimento-hoje/contexto') {
      return jsonResponse(dailyDueContextResponse, 200);
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
  dailyDueContextResponse = { ok: true, active: false, date: '2026-09-22', status: '' };
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

test('saudação usa somente o primeiro nome e ignora observações do contato', async () => {
  const cases = [
    ['Gaby Marcionilo Cliente', 'Gaby'],
    ['Leandro Gaby Irmã', 'Leandro'],
    ['Fátima, Gaby', 'Fátima'],
    ['Andre Gaby💥', 'Andre'],
    ['MARCELO NUNES SILVA', 'Marcelo']
  ];

  for (const [pushName, expected] of cases) {
    assert.equal(bot.customerFirstName(pushName), expected, pushName);
  }

  assert.equal(bot.customerFirstName('31985147119'), '');
  assert.equal(bot.customerFirstName('+55 33 98514-7119'), '');
  assert.equal(bot.customerFirstName('Cliente'), '');
  assert.equal(bot.customerFirstName(''), '');

  const phoneNamed = '5533977777761';
  await bot.handleMessage({
    phone: phoneNamed,
    text: 'Boa noite',
    pushName: 'Gaby Marcionilo Cliente'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /^Boa noite, Gaby! 😊/i);
  assert.doesNotMatch(sentTexts[0].text, /Marcionilo|Cliente/i);

  sentTexts = [];

  const phoneNumberOnly = '5533977777762';
  await bot.handleMessage({
    phone: phoneNumberOnly,
    text: 'Boa noite',
    pushName: '31985147119'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /^Boa noite! 😊/i);
  assert.doesNotMatch(sentTexts[0].text, /31985147119/);
});

test('saudação junto com consulta de produto também usa somente o primeiro nome', async () => {
  const phone = '5533977777763';

  catalogRows = [
    product('tv-greet-name-1', 'Smart TV Samsung 50', {
      category: 'TV',
      brand: 'Samsung'
    })
  ];

  await bot.handleMessage({
    phone,
    text: 'Boa tarde, vocês têm TV?',
    pushName: 'Gaby Marcionilo Cliente'
  });

  assert.ok(sentTexts.length >= 1);
  assert.match(sentTexts[0].text, /^Boa tarde, Gaby! 😊/i);
  assert.doesNotMatch(sentTexts[0].text, /Marcionilo|Cliente/i);
});



test('personalidade do Gustavo mantém tom natural sem depender sempre de "Claro"', () => {
  assert.equal(bot.GUSTAVO_PERSONA.name, 'Gustavo');
  assert.equal(bot.GUSTAVO_PERSONA.company, 'Ariana Móveis');
  assert.ok(bot.GUSTAVO_PERSONA.style.includes('não inventar informação'));

  const samples = new Set(
    ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((seed) => bot.gustavoLead(seed, 'helpful'))
  );
  assert.ok(samples.size >= 2, 'as aberturas naturais devem variar de forma determinística');
});

test('camada semântica entende formulação nova de identidade sem nova regex', async () => {
  const phone = '5533977777764';
  bot.patchTestIntentClassification({
    intent: 'IDENTIDADE_ATENDENTE',
    confidence: 0.97,
    category: '',
    product_reference: '',
    product_ordinal: 0,
    installments: 0,
    payment_method: 'unknown',
    location_hint: ''
  });

  await bot.handleMessage({
    phone,
    text: 'quem é que tá do outro lado aí falando comigo?',
    pushName: 'Gaby Marcionilo Cliente'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /Aqui é o Gustavo/i);
  assert.match(sentTexts[0].text, /Ariana Móveis/i);
  assert.doesNotMatch(sentTexts[0].text, /Me conta um pouco mais/i);
});

test('camada semântica busca categoria real e deixa preço/estoque para o catálogo', async () => {
  const phone = '5533977777765';
  catalogRows = [
    product('tv-sem-1', 'Smart TV Samsung 50', { category: 'TV', stock: 2 }),
    product('rack-sem-1', 'Rack para TV', { category: 'Móveis', stock: 3 })
  ];

  bot.patchTestIntentClassification({
    intent: 'BUSCAR_PRODUTO',
    confidence: 0.96,
    category: 'tv',
    product_reference: '',
    product_ordinal: 0,
    installments: 0,
    payment_method: 'unknown',
    location_hint: ''
  });

  await bot.handleMessage({
    phone,
    text: 'tô atrás de uma tela grande pra sala, tem alguma coisa aí?',
    pushName: 'Cliente Semântico'
  });

  assert.equal(sentMedia.length, 1);
  assert.match(sentMedia[0].caption || '', /Smart TV Samsung 50/i);
  assert.doesNotMatch(sentMedia[0].caption || '', /Rack para TV/i);
});

test('camada semântica usa calculadora oficial do cartão em vez de inventar valor', async () => {
  const phone = '5533977777766';
  const chosen = bot.compactProduct(product('phone-sem-card', 'Moto G Semântico', {
    category: 'Celulares',
    pixPrice: 827.20,
    price: 1000,
    cardPrice: 1200,
    installmentCount: 12
  }));

  bot.patchTestConversation(phone, {
    selectedProduct: chosen,
    lastProducts: [chosen],
    lastIntent: 'produto'
  });

  bot.patchTestIntentClassification({
    intent: 'PRECO_CARTAO',
    confidence: 0.96,
    category: '',
    product_reference: 'Moto G Semântico',
    product_ordinal: 0,
    installments: 0,
    payment_method: 'cartao',
    location_hint: ''
  });

  await bot.handleMessage({
    phone,
    text: 'se eu pagar no crédito vocês dividem como?',
    pushName: 'Cliente Semântico'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /12x de R\$\s*100,00/i);
  assert.match(sentTexts[0].text, /total de \*?R\$\s*1\.200,00\*?/i);
});

test('camada semântica de baixa confiança não toma decisão sensível', async () => {
  const phone = '5533977777767';
  const chosen = bot.compactProduct(product('low-confidence-1', 'Produto Teste', {
    pixPrice: 500,
    price: 700
  }));
  bot.patchTestConversation(phone, {
    selectedProduct: chosen,
    lastProducts: [chosen],
    lastIntent: 'produto'
  });

  bot.patchTestIntentClassification({
    intent: 'PEDIDO_DESCONTO',
    confidence: 0.60,
    category: '',
    product_reference: 'Produto Teste',
    product_ordinal: 0,
    installments: 0,
    payment_method: 'pix',
    location_hint: ''
  });

  await bot.handleMessage({
    phone,
    text: 'tem como ajeitar essa condição aí pra mim?',
    pushName: 'Cliente Semântico'
  });

  assert.equal(sentTexts.length, 1);
  assert.doesNotMatch(sentTexts[0].text, /não consigo conceder desconto adicional/i);
});

test('cartão com várias opções pergunta qual item e mantém contexto para ordinal', async () => {
  const phone = '5533977777768';
  const first = bot.compactProduct(product('tv-card-1', 'Smart TV 50 A', {
    category: 'TV',
    pixPrice: 1700,
    cardPrice: 2040,
    installmentCount: 12
  }));
  const second = bot.compactProduct(product('tv-card-2', 'Smart TV 50 B', {
    category: 'TV',
    pixPrice: 1900,
    cardPrice: 2280,
    installmentCount: 12
  }));
  const third = bot.compactProduct(product('tv-card-3', 'Smart TV 43 C', {
    category: 'TV',
    pixPrice: 1825.17,
    cardPrice: 2199.00,
    installmentCount: 12
  }));

  bot.patchTestConversation(phone, {
    selectedProduct: null,
    lastProducts: [first, second, third],
    lastIntent: 'produto'
  });

  bot.patchTestIntentClassification({
    intent: 'PRECO_CARTAO',
    confidence: 0.96,
    category: '',
    product_reference: '',
    product_ordinal: 0,
    installments: 0,
    payment_method: 'cartao',
    location_hint: ''
  });

  await bot.handleMessage({
    phone,
    text: 'se eu pagar no crédito vocês dividem como?',
    pushName: 'Marcelo Teste'
  });

  assert.equal(bot.conversation(phone).pendingAction, 'card_price_product');
  assert.match(sentTexts.at(-1).text, /qual dessas opções/i);
  assert.match(sentTexts.at(-1).text, /primeiro/i);

  await bot.handleMessage({
    phone,
    text: 'o terceiro',
    pushName: 'Marcelo Teste'
  });

  assert.equal(bot.conversation(phone).pendingAction, '');
  assert.equal(bot.conversation(phone).selectedProduct.id, 'tv-card-3');
  assert.match(sentTexts.at(-1).text, /Smart TV 43 C/i);
  assert.match(sentTexts.at(-1).text, /cartão/i);
});

test('pedido vago para melhorar condição é entendido sem inventar desconto', async () => {
  const phone = '5533977777769';
  const first = bot.compactProduct(product('tv-cond-1', 'Smart TV 50 A', {
    category: 'TV',
    pixPrice: 1700,
    cardPrice: 2040
  }));
  const second = bot.compactProduct(product('tv-cond-2', 'Smart TV 50 B', {
    category: 'TV',
    pixPrice: 1900,
    cardPrice: 2280
  }));

  bot.patchTestConversation(phone, {
    selectedProduct: null,
    lastProducts: [first, second],
    lastIntent: 'produto',
    pendingAction: 'card_price_product'
  });

  assert.equal(
    bot.asksPaymentConditionAdjustment('e tem como ajeitar essa condição aí pra mim?', bot.conversation(phone)),
    true
  );

  await bot.handleMessage({
    phone,
    text: 'e tem como ajeitar essa condição aí pra mim?',
    pushName: 'Marcelo Teste'
  });

  assert.equal(bot.conversation(phone).pendingAction, 'special_condition_product');
  assert.match(sentTexts.at(-1).text, /melhorar essa condição/i);
  assert.match(sentTexts.at(-1).text, /Marcelo analisar/i);
  assert.ok(sentTexts.at(-1).text.length < 320, 'resposta deve ser curta e conversacional');
  assert.doesNotMatch(sentTexts.at(-1).text, /desconto aprovado|consigo fazer por/i);
});

test('pedido para falar com Marcelo após condição especial usa resposta contextual e mantém bot ativo', async () => {
  const phrases = [
    'eu posso falar com ele?',
    'eu posso falar com o Marcelo?',
    'você chama o Marcelo pra mim?'
  ];

  for (let i = 0; i < phrases.length; i += 1) {
    sentTexts = [];
    backendEvents = [];

    const phone = '55339777778' + String(10 + i);
    const first = bot.compactProduct(product('tv-marcelo-' + i + '-1', 'Smart TV A', {
      category: 'TV',
      pixPrice: 1700,
      cardPrice: 2040
    }));
    const second = bot.compactProduct(product('tv-marcelo-' + i + '-2', 'Smart TV B', {
      category: 'TV',
      pixPrice: 1900,
      cardPrice: 2280
    }));

    bot.patchTestConversation(phone, {
      selectedProduct: null,
      lastProducts: [first, second],
      lastIntent: 'produto',
      pendingAction: 'special_condition_product'
    });

    assert.equal(bot.asksMarceloAfterCondition(phrases[i]), true, phrases[i]);

    await bot.handleMessage({
      phone,
      text: phrases[i],
      pushName: 'Cliente Teste'
    });

    const conv = bot.conversation(phone);
    assert.equal(conv.pendingAction, '');
    assert.equal(conv.marceloCallbackRequested, true);
    assert.equal(Boolean(conv.humanUntil && conv.humanUntil > Date.now()), false);
    assert.match(sentTexts.at(-1).text, /aguarde um instante/i);
    assert.match(sentTexts.at(-1).text, /trabalho na rua/i);
    assert.match(sentTexts.at(-1).text, /já já está de volta/i);
    assert.match(sentTexts.at(-1).text, /olhar mais algum produto/i);
    assert.equal(backendEvents.at(-1).status, 'Aguardando retorno do Marcelo');
    assert.equal(backendEvents.at(-1).metadata.atendimentoAutomaticoContinua, true);
  }
});

test('produto já selecionado mantém contexto do Marcelo e entende ele/deixa/falar/chama sem pausar o bot', async () => {
  const phrases = [
    'eu posso falar com ele?',
    'deixa eu falar com ele',
    'falar com o marcelo',
    'chama ele pra mim'
  ];

  for (let i = 0; i < phrases.length; i += 1) {
    sentTexts = [];
    backendEvents = [];

    const phone = '55339777779' + String(20 + i);
    const chosen = bot.compactProduct(product('geladeira-marcelo-' + i, 'REFRIGERADOR CONSUL 451L BRANCO 110V', {
      category: 'Geladeira',
      pixPrice: 3974,
      cardPrice: 4787.95
    }));

    bot.patchTestConversation(phone, {
      selectedProduct: chosen,
      lastProducts: [chosen],
      lastIntent: 'produto',
      pendingAction: '',
      humanUntil: 0,
      specialConditionMarceloUntil: 0
    });

    await bot.handleMessage({
      phone,
      text: 'tem como ajeitar essa condição aí pra mim?',
      pushName: 'Cliente Teste'
    });

    assert.equal(bot.hasSpecialConditionMarceloContext(bot.conversation(phone)), true);
    assert.match(sentTexts.at(-1).text, /Marcelo analisar/i);

    await bot.handleMessage({
      phone,
      text: phrases[i],
      pushName: 'Cliente Teste'
    });

    let conv = bot.conversation(phone);
    assert.equal(conv.pendingAction, '');
    assert.equal(conv.humanUntil, 0);
    assert.equal(conv.marceloCallbackRequested, true);
    assert.equal(bot.hasSpecialConditionMarceloContext(conv), true);
    assert.equal(bot.specialConditionMarceloAlreadyNotified(conv), true);
    assert.match(sentTexts.at(-1).text, /aguarde um instante/i);
    assert.match(sentTexts.at(-1).text, /trabalho na rua/i);
    assert.match(sentTexts.at(-1).text, /já já está de volta/i);
    assert.match(sentTexts.at(-1).text, /olhar mais algum produto/i);
    assert.doesNotMatch(sentTexts.at(-1).text, /atendimento humano/i);
    assert.equal(backendEvents.at(-1).status, 'Aguardando retorno do Marcelo');
    assert.equal(backendEvents.at(-1).metadata.atendimentoAutomaticoContinua, true);
    assert.equal(backendEvents.at(-1).metadata.pedidoRepetido, false);

    await bot.handleMessage({
      phone,
      text: 'eu posso falar com ele?',
      pushName: 'Cliente Teste'
    });

    conv = bot.conversation(phone);
    assert.equal(conv.humanUntil, 0);
    assert.equal(conv.marceloCallbackRequested, true);
    assert.equal(bot.hasSpecialConditionMarceloContext(conv), true);
    assert.match(sentTexts.at(-1).text, /já deixei seu atendimento sinalizado para o Marcelo/i);
    assert.match(sentTexts.at(-1).text, /assim que ele voltar/i);
    assert.match(sentTexts.at(-1).text, /mais algum produto/i);
    assert.doesNotMatch(sentTexts.at(-1).text, /me conta um pouco mais|atendimento humano/i);
    assert.equal(backendEvents.at(-1).status, 'Aguardando retorno do Marcelo');
    assert.equal(backendEvents.at(-1).metadata.atendimentoAutomaticoContinua, true);
    assert.equal(backendEvents.at(-1).metadata.pedidoRepetido, true);
  }
});

test('fluxo real: primeiro pedido pelo Marcelo usa mensagem da rua e ?/o que houve mantêm contexto', async () => {
  sentTexts = [];
  backendEvents = [];

  const phone = '5533977777999';
  const first = bot.compactProduct(product('tv-real-1', 'Smart TV 32 LG Full HD', {
    category: 'TV',
    pixPrice: 1379,
    cardPrice: 1661.45
  }));
  const second = bot.compactProduct(product('tv-real-2', 'Smart TV 43 LG', {
    category: 'TV',
    pixPrice: 1825.17,
    cardPrice: 2199
  }));

  bot.patchTestConversation(phone, {
    selectedProduct: null,
    lastProducts: [first, second],
    lastIntent: 'produto',
    pendingAction: '',
    humanUntil: 0,
    marceloCallbackRequested: true,
    marceloCallbackRequestedAt: Date.now(),
    specialConditionMarceloUntil: 0,
    specialConditionMarceloHandoffAt: 0
  });

  await bot.handleMessage({
    phone,
    text: 'tem como ajeitar essa condição aí pra mim?',
    pushName: 'Cliente Teste'
  });

  await bot.handleMessage({
    phone,
    text: 'a primeira',
    pushName: 'Cliente Teste'
  });

  await bot.handleMessage({
    phone,
    text: 'eu posso falar com ele?',
    pushName: 'Cliente Teste'
  });

  assert.match(sentTexts.at(-1).text, /aguarde um instante/i);
  assert.match(sentTexts.at(-1).text, /trabalho na rua/i);
  assert.doesNotMatch(sentTexts.at(-1).text, /já deixei seu atendimento sinalizado/i);
  assert.equal(bot.specialConditionMarceloAlreadyNotified(bot.conversation(phone)), true);

  await bot.handleMessage({
    phone,
    text: 'deixa eu falar com ele',
    pushName: 'Cliente Teste'
  });

  assert.match(sentTexts.at(-1).text, /já deixei seu atendimento sinalizado para o Marcelo/i);
  assert.doesNotMatch(sentTexts.at(-1).text, /me conta um pouco mais/i);

  await bot.handleMessage({
    phone,
    text: '?',
    pushName: 'Cliente Teste'
  });

  assert.match(sentTexts.at(-1).text, /Marcelo ainda não voltou/i);
  assert.doesNotMatch(sentTexts.at(-1).text, /continuamos de onde paramos/i);

  await bot.handleMessage({
    phone,
    text: 'oque houve?',
    pushName: 'Cliente Teste'
  });

  const conv = bot.conversation(phone);
  assert.equal(conv.humanUntil, 0);
  assert.equal(bot.hasSpecialConditionMarceloContext(conv), true);
  assert.match(sentTexts.at(-1).text, /Nada de errado/i);
  assert.match(sentTexts.at(-1).text, /ainda não voltou do trabalho na rua/i);
  assert.doesNotMatch(sentTexts.at(-1).text, /me conta um pouco mais|atendimento humano/i);
});

test('repetir pedido de condição não devolve fallback genérico idêntico', async () => {
  const phone = '5533977777770';
  const first = bot.compactProduct(product('tv-cond-r1', 'Smart TV 50 A', {
    category: 'TV',
    pixPrice: 1700,
    cardPrice: 2040
  }));
  const second = bot.compactProduct(product('tv-cond-r2', 'Smart TV 50 B', {
    category: 'TV',
    pixPrice: 1900,
    cardPrice: 2280
  }));

  bot.patchTestConversation(phone, {
    selectedProduct: null,
    lastProducts: [first, second],
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'tem como ajeitar essa condição aí pra mim?',
    pushName: 'Marcelo Teste'
  });
  const firstReply = sentTexts.at(-1).text;

  await bot.handleMessage({
    phone,
    text: 'tem como ajeitar essa condição aí pra mim?',
    pushName: 'Marcelo Teste'
  });
  const secondReply = sentTexts.at(-1).text;

  assert.match(firstReply, /melhorar essa condição/i);
  assert.match(secondReply, /qual opção|qual dessas opções|qual opção você gostou|qual dessas opções você gostou/i);
  assert.notEqual(secondReply, firstReply);
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

test('consulta sobre pedido/encomenda aguardando vai para Marcelo sem pesquisar catálogo', async () => {
  const examples = [
    'Oi bom dia vc saber q dia a beliche chega',
    'que dia minha encomenda chega?',
    'meu pedido já chegou?',
    'tem previsão do meu pedido?',
    'sabe quando a minha compra chega?'
  ];

  for (let i = 0; i < examples.length; i += 1) {
    sentTexts = [];
    backendEvents = [];
    requestLog = [];

    const phone = '553397777787' + String(i);
    assert.equal(bot.asksExistingOrderStatus(examples[i]), true, examples[i]);

    await bot.handleMessage({
      phone,
      text: examples[i],
      pushName: 'Cliente Teste'
    });

    assert.equal(sentTexts.length, 1);
    assert.match(sentTexts[0].text, /Marcelo está em outro atendimento/i);
    assert.match(sentTexts[0].text, /te dá um parecer.*seu pedido/i);
    assert.doesNotMatch(sentTexts[0].text, /Encontrei|catálogo|produto disponível/i);
    assert.equal(backendEvents.at(-1).status, 'Aguardando Marcelo - pedido/encomenda');
    assert.equal(backendEvents.at(-1).metadata.exigeParecerMarcelo, true);
    assert.equal(bot.conversation(phone).humanUntil || 0, 0);
  }
});

test('pergunta de frete antes da compra continua no fluxo normal de entrega', () => {
  assert.equal(bot.asksExistingOrderStatus('vocês entregam em Guanhães?'), false);
  assert.equal(bot.asksExistingOrderStatus('qual o valor do frete para zona rural?'), false);
  assert.equal(bot.asksDelivery('vocês entregam em Guanhães?'), true);
});

test('entrega diferencia Guanhães de zona rural/outra cidade', () => {
  const city = bot.deliveryReply('Entrega aqui em Guanhães?');
  assert.equal(city.needsLogistics, false);
  assert.match(city.text, /24 horas/i);
  assert.match(city.text, /segunda a sábado/i);
  assert.match(city.text, /12h/i);

  const rural = bot.deliveryReply('Entrega na zona rural?');
  assert.equal(rural.needsLogistics, true);
  assert.match(rural.text, /consultar/i);
  assert.match(rural.text, /segunda a sábado/i);

  const other = bot.deliveryReply('Vocês entregam em outra cidade?');
  assert.equal(other.needsLogistics, true);
});

test('entreguei exame na contabilidade não é confundido com entrega de mercadoria', async () => {
  assert.equal(bot.asksDelivery('Já entreguei o exame na contabilidade.'), false);

  const phone = '5533977777840';
  await bot.handleMessage({
    phone,
    text: 'Bom dia Marcelo tudo bem? Já entreguei o exame na contabilidade.',
    pushName: 'Emilly'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /deixar essa mensagem para o Marcelo/i);
  assert.doesNotMatch(sentTexts[0].text, /segunda a sábado|24 horas|entregas acontecem/i);
  assert.equal(bot.conversation(phone).contactRole, 'internal');
  assert.equal(backendEvents.at(-1).status, 'Mensagem interna / administrativa');
});

test('entregas são de segunda a sábado até 12h e não ocorrem no domingo', async () => {
  const phone = '5533977777756';

  await bot.handleMessage({
    phone,
    text: 'vocês entregam sábado e domingo?',
    pushName: 'Cliente Entrega'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /segunda a sábado/i);
  assert.match(sentTexts[0].text, /12h/i);
  assert.match(sentTexts[0].text, /domingo.*não realizamos entregas/i);
  assert.doesNotMatch(sentTexts[0].text, /Me conta um pouco mais/i);
});

test('perguntas gerais sobre o que a Ariana vende são reconhecidas em linguagem natural', async () => {
  const examples = [
    'com o que voces trabalha',
    'voces trabalham com qual produto',
    'voces mexe com que produto',
    'oque voces vendem'
  ];

  for (const value of examples) {
    assert.equal(bot.asksStoreAssortment(value), true, value);
  }

  const phone = '5533977777757';
  await bot.handleMessage({
    phone,
    text: 'voces mexe com que produto',
    pushName: 'Cliente Catálogo'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /móveis/i);
  assert.match(sentTexts[0].text, /eletrodomésticos/i);
  assert.match(sentTexts[0].text, /celulares/i);
  assert.doesNotMatch(sentTexts[0].text, /Me conta um pouco mais/i);
});

test('como comprar com a Ariana explica o fluxo e tolera erro de digitação', async () => {
  for (const value of [
    'como faço pra comprar com voces',
    'como eu compro com voces',
    'quro comprar com voces como faco'
  ]) {
    assert.equal(bot.asksHowToBuyFromStore(value), true, value);
  }

  const phone = '5533977777758';
  await bot.handleMessage({
    phone,
    text: 'quro comprar com voces como faco',
    pushName: 'Cliente Compra'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /arianamoveis\.com\.br/i);
  assert.match(sentTexts[0].text, /Me diga o que você procura/i);
  assert.doesNotMatch(sentTexts[0].text, /Me conta um pouco mais/i);
});

test('"quero comprar com vocês" não reutiliza produto antigo da conversa', async () => {
  const phone = '5533977777759';
  const oldProduct = bot.compactProduct(product('old-fridge-purchase', 'Refrigerador Consul 451L Branco 110V', {
    category: 'Geladeiras',
    pixPrice: 3974,
    price: 4787.95
  }));

  bot.patchTestConversation(phone, {
    selectedProduct: oldProduct,
    lastProducts: [oldProduct],
    allProductResults: [oldProduct],
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'quero comprar com voces',
    pushName: 'Cliente Compra'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /O que você está querendo comprar/i);
  assert.doesNotMatch(sentTexts[0].text, /Refrigerador Consul/i);
  assert.doesNotMatch(sentTexts[0].text, /produto\.html/i);
});

test('PIX copia e cola não cai no fallback de produto', async () => {
  const phone = '5533977777760';
  const payload = '00020101021226810014BR.GOV.BCB.PIX013656ca00e7-9171-45f5-a8df-d1e6b5e7028652020000530398654071665.475802BR5925NUBANK PAGAR FATURA6009Sao Paulo62100540900062140510ugTarPpqq6304E4C3';

  assert.equal(bot.isPixCopyPastePayload(payload), true);

  await bot.handleMessage({
    phone,
    text: payload,
    pushName: 'Cliente PIX'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /PIX copia e cola/i);
  assert.match(sentTexts[0].text, /comprovante/i);
  assert.doesNotMatch(sentTexts[0].text, /Me conta um pouco mais/i);
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

test('"tem celular?" consulta o catálogo em vez de cair no fallback', async () => {
  const phone = '5533977777750';

  catalogRows = [
    product('moto-g06-short', 'Smartphone Motorola Moto G06 128GB', {
      category: 'Celulares',
      brand: 'Motorola',
      pixPrice: 899,
      price: 1083
    }),
    product('sound-short', 'Caixa de Som Bluetooth', {
      category: 'Áudio',
      pixPrice: 399,
      price: 480
    })
  ];

  await bot.handleMessage({
    phone,
    text: 'tem celular?',
    pushName: 'Cliente Celular'
  });

  assert.equal(sentMedia.length, 1);
  assert.match(sentMedia[0].caption || '', /Moto G06/i);
  assert.doesNotMatch(sentTexts.map((item) => item.text).join('\n'), /Me conta um pouco mais/i);
});


test('pedido "manda foto dela pra eu ver" envia foto do produto já selecionado sem cair no fallback', async () => {
  const phone = '5533977777860';
  const selected = bot.compactProduct(product('party-x4000-selected', 'CAIXA AMP PHILIPS PARTY X4000 1500W', {
    category: 'Caixa de som',
    pixPrice: 1155.85,
    cardPrice: 1392.59,
    imageUrl: 'https://res.cloudinary.com/ariana/image/upload/v1790000000/ariana_moveis/produtos/party-x4000.webp'
  }));

  bot.patchTestConversation(phone, {
    selectedProduct: selected,
    lastProducts: [selected],
    lastIntent: 'produto'
  });

  assert.equal(bot.asksSelectedProductPhoto('manda foto dela pra eu ver'), true);
  assert.equal(bot.asksSelectedProductPhoto('me manda uma foto dele'), true);
  assert.equal(bot.asksSelectedProductPhoto('quero ver a foto dela'), true);

  await bot.handleMessage({
    phone,
    text: 'manda foto dela pra eu ver',
    pushName: 'Cliente Teste'
  });

  assert.equal(sentMedia.length, 1);
  assert.match(sentMedia[0].media, /c_pad,w_1000,h_1000,g_center,b_white,q_auto:good,f_jpg/);
  assert.match(sentMedia[0].caption, /CAIXA AMP PHILIPS PARTY X4000 1500W/i);
  assert.equal(sentTexts.length, 0);
  assert.equal(bot.conversation(phone).selectedProduct.id, selected.id);
  assert.equal(backendEvents.at(-1).status, 'Venda em andamento');
  assert.equal(backendEvents.at(-1).metadata.requestedProductPhoto, true);
});

test('"A vista tá qto?" mantém contexto da lista e pede qual produto', async () => {
  const phone = '5533977777753';

  const first = bot.compactProduct(product('fridge-cash-1', 'Geladeira Inox 300L', {
    category: 'Geladeiras',
    pixPrice: 1999,
    price: 2408
  }));
  const second = bot.compactProduct(product('fridge-cash-2', 'Geladeira Inox 400L', {
    category: 'Geladeiras',
    pixPrice: 2197.40,
    price: 2647.47
  }));

  bot.patchTestConversation(phone, {
    lastProducts: [first, second],
    allProductResults: [first, second],
    selectedProduct: null,
    lastIntent: 'produto'
  });

  assert.equal(bot.asksPixPrice('A vista tá qto?'), true);

  await bot.handleMessage({
    phone,
    text: 'A vista tá qto?',
    pushName: 'Cliente Geladeira'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /qual dessas opções/i);
  assert.match(sentTexts[0].text, /primeiro/i);
  assert.doesNotMatch(sentTexts[0].text, /Me conta um pouco mais/i);
  assert.equal(bot.conversation(phone).lastProducts.length, 2);
  assert.equal(bot.conversation(phone).pendingAction, 'cash_price_product');

  sentTexts = [];

  await bot.handleMessage({
    phone,
    text: 'o segundo',
    pushName: 'Cliente Geladeira'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /Geladeira Inox 400L/i);
  assert.match(sentTexts[0].text, /R\$\s*2\.197,40/i);
  assert.equal(bot.conversation(phone).selectedProduct.id, 'fridge-cash-2');
  assert.equal(bot.conversation(phone).pendingAction, '');
});


test('"à vista não tem desconto não?" explica que o PIX já contém o desconto', async () => {
  const phone = '5533977777754';
  const chosen = bot.compactProduct(product('discount-pix-1', 'Refrigerador Consul 451L Branco 110V', {
    category: 'Geladeiras',
    pixPrice: 3974,
    price: 4787.95,
    installmentCount: 12
  }));

  bot.patchTestConversation(phone, {
    selectedProduct: chosen,
    lastProducts: [chosen],
    lastIntent: 'produto'
  });

  for (const value of [
    'A vista não tem desconto não?',
    'No pix não tem desconto?',
    'Consegue melhorar esse valor à vista?'
  ]) {
    assert.equal(bot.asksCashDiscount(value), true, value);
  }

  await bot.handleMessage({
    phone,
    text: 'A vista não tem desconto não?',
    pushName: 'Cliente Desconto'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /valor no PIX já é o valor com desconto/i);
  assert.match(sentTexts[0].text, /pagamento à vista/i);
  assert.match(sentTexts[0].text, /não consigo mexer nesse valor/i);
  assert.doesNotMatch(sentTexts[0].text, /Me conta um pouco mais/i);

  assert.equal(backendEvents.length, 1);
  assert.equal(backendEvents[0].status, 'Venda em andamento');
  assert.equal(backendEvents[0].metadata.paymentMode, 'pix');
  assert.equal(backendEvents[0].metadata.productId, 'discount-pix-1');
  assert.equal(backendEvents[0].metadata.extraDiscountRequested, true);
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


test('"e no boleto?" continua no mesmo produto e pergunta as parcelas do crediário', async () => {
  const phone = '5533977777755';
  const chosen = bot.compactProduct(product('fridge-boleto-1', 'Refrigerador Consul 451L Branco 110V', {
    category: 'Geladeiras',
    pixPrice: 3974,
    price: 4787.95,
    installmentCount: 12
  }));

  bot.patchTestConversation(phone, {
    selectedProduct: chosen,
    lastProducts: [chosen],
    allProductResults: [chosen],
    lastIntent: 'produto'
  });

  assert.equal(bot.asksCreditQuote('e no boleto?'), true);
  assert.equal(bot.asksCreditQuote('e no carnê?'), true);
  assert.equal(bot.asksCreditQuote('no crediário?'), true);

  await bot.handleMessage({
    phone,
    text: 'e no boleto?',
    pushName: 'Cliente Boleto'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /Refrigerador Consul 451L Branco 110V/i);
  assert.match(sentTexts[0].text, /crediário próprio/i);
  assert.match(sentTexts[0].text, /Em quantas vezes/i);
  assert.doesNotMatch(sentTexts[0].text, /Me conta um pouco mais/i);
  assert.equal(bot.conversation(phone).pendingAction, 'credit_installments');

  sentTexts = [];

  await bot.handleMessage({
    phone,
    text: '10x',
    pushName: 'Cliente Boleto'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /10x/i);
  assert.match(sentTexts[0].text, /crediário próprio/i);
  assert.equal(bot.conversation(phone).selectedProduct.id, 'fridge-boleto-1');
  assert.equal(bot.conversation(phone).pendingAction, '');
});


test('nome/modelo recente identifica Moto G06 e calcula cartão sem pedir produto de novo', async () => {
  const phone = '5533977777751';

  const moto = bot.compactProduct(product('moto-g06-card', 'Smartphone Motorola Moto G06 128GB', {
    category: 'Celulares',
    brand: 'Motorola',
    pixPrice: 899,
    price: 1083,
    installmentCount: 12
  }));
  const samsung = bot.compactProduct(product('samsung-a17-card', 'Smartphone Samsung Galaxy A17 128GB', {
    category: 'Celulares',
    brand: 'Samsung',
    pixPrice: 1191.01,
    price: 1434.96,
    installmentCount: 12
  }));

  bot.patchTestConversation(phone, {
    lastProducts: [moto, samsung],
    allProductResults: [moto, samsung],
    selectedProduct: samsung,
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'esse moto g06 qual o valor dele no cartão?',
    pushName: 'Cliente Moto'
  });

  assert.match(sentTexts.at(-1).text, /No cartão/i);
  assert.match(sentTexts.at(-1).text, /Moto G06/i);
  assert.doesNotMatch(sentTexts.at(-1).text, /Me diga qual produto/i);
  assert.equal(bot.conversation(phone).selectedProduct.id, 'moto-g06-card');
  assert.equal(backendEvents.at(-1).metadata.productId, 'moto-g06-card');
});

test('nome/modelo sozinho seleciona produto recente da conversa', async () => {
  const phone = '5533977777752';

  const moto = bot.compactProduct(product('moto-g06-select', 'Smartphone Motorola Moto G06 128GB', {
    category: 'Celulares',
    brand: 'Motorola',
    pixPrice: 899,
    price: 1083
  }));
  const samsung = bot.compactProduct(product('samsung-a17-select', 'Smartphone Samsung Galaxy A17 128GB', {
    category: 'Celulares',
    brand: 'Samsung',
    pixPrice: 1191.01,
    price: 1434.96
  }));

  bot.patchTestConversation(phone, {
    lastProducts: [moto, samsung],
    allProductResults: [moto, samsung],
    selectedProduct: null,
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'moto g06',
    pushName: 'Cliente Moto'
  });

  assert.match(sentTexts.at(-1).text, /Você está falando de/i);
  assert.match(sentTexts.at(-1).text, /Moto G06/i);
  assert.equal(bot.conversation(phone).selectedProduct.id, 'moto-g06-select');
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

test('WhatsApp usa a primeira imagem da galeria real antes do imageUrl legado', () => {
  const normalized = bot.compactProduct({
    ...product('party-x4000', 'CAIXA AMP PHILIPS PARTY X4000 2X8 1500W', {
      category: 'Caixa de som',
      imageUrl: 'https://img.test/legado-deformado.jpg'
    }),
    imageUrl: 'https://img.test/legado-deformado.jpg',
    images: [
      'https://img.test/galeria-principal-correta.jpg',
      'https://img.test/galeria-2.jpg'
    ]
  });

  assert.equal(normalized.imageUrl, 'https://img.test/galeria-principal-correta.jpg');
  assert.equal(
    bot.productPrimaryImage({
      imageUrl: 'https://img.test/legado.jpg',
      imagens: [{ url: 'https://img.test/site-correta.jpg' }]
    }),
    'https://img.test/site-correta.jpg'
  );
});

test('foto Cloudinary enviada ao WhatsApp ganha quadro quadrado sem deformar o produto', () => {
  const original = 'https://res.cloudinary.com/ariana/image/upload/v1790000000/ariana_moveis/produtos/party-x4000.webp';
  const prepared = bot.whatsappProductImageUrl(original);

  assert.match(
    prepared,
    /\/image\/upload\/c_pad,w_1000,h_1000,g_center,b_white,q_auto:good,f_jpg\//
  );
  assert.match(prepared, /\/v1790000000\/ariana_moveis\/produtos\/party-x4000\.webp$/);
  assert.equal(
    bot.whatsappProductImageUrl('https://cdn.test/produto.jpg'),
    'https://cdn.test/produto.jpg',
    'URL que não é Cloudinary deve continuar intacta'
  );
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
  assert.match(sentTexts[0].text, /produto ou da condição/i);
  assert.doesNotMatch(sentTexts[0].text, /^Claro\s*😊/i);
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

test('fornecedor é identificado e respostas automáticas do sistema dele não geram conversa entre bots', async () => {
  const phone = '5533977777841';

  assert.equal(
    bot.isSupplierContactSignal({
      phone,
      pushName: 'Mueller Vendas',
      text: 'Lojista, oportunidade para abastecer seu estoque. Condição especial direto de fábrica. Quantas peças eu te mando?'
    }),
    true
  );
  assert.equal(
    bot.isSupplierContactSignal({
      phone: '5533977777842',
      pushName: 'Douglas Modesto',
      text: 'Bom dia, uma ótima terça-feira para nós'
    }),
    false
  );

  await bot.handleMessage({
    phone,
    pushName: 'Mueller Vendas',
    text: 'Lojista, olha essa oportunidade de abastecer seu estoque. Condição especial direto de fábrica. Quantas peças eu te mando?'
  });

  assert.equal(bot.conversation(phone).contactRole, 'supplier');
  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /proposta.*Marcelo.*compras/is);
  assert.doesNotMatch(sentTexts[0].text, /fotos de produtos|crediário|carnê/i);
  assert.equal(backendEvents.at(-1).status, 'Fornecedor / Compras');

  await bot.handleMessage({
    phone,
    pushName: 'Mueller Vendas',
    text: 'Em breve você será atendido 💜'
  });
  await bot.handleMessage({
    phone,
    pushName: 'Mueller Vendas',
    text: 'Aguardando atendimento...'
  });

  assert.equal(sentTexts.length, 1, 'mensagens automáticas do fornecedor não devem receber resposta');

  const legacyPhone = '5533977777847';
  await bot.handleMessage({
    phone: legacyPhone,
    pushName: 'Mueller Vendas',
    text: 'Aguardando atendimento...'
  });

  assert.equal(bot.conversation(legacyPhone).contactRole, 'supplier');
  assert.equal(sentTexts.length, 1, 'nome comercial forte deve impedir resposta ao robô mesmo em conversa antiga');
});

test('consultora de fornecedor com imagem é desviada para compras antes da visão de produto', async () => {
  const phone = '5533977777850';

  visionClassification = {
    kind: 'product',
    confidence: 0.99,
    product_name: 'Smartphone Samsung A07',
    brand: 'Samsung',
    model: 'A07',
    category_hint: 'celular',
    payment_method: 'unknown',
    payment_recipient_name: '',
    summary: 'Smartphones Samsung'
  };

  const result = await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: {
        remoteJid: phone + '@s.whatsapp.net',
        fromMe: false,
        id: 'SUPPLIER-IMAGE-1'
      },
      pushName: 'samira consultora martins',
      message: {
        imageMessage: {
          mimetype: 'image/jpeg',
          caption: 'Enviar as demandas de pedidos hoje 22/09, até as 18h. Preço a partir de 1 peça. Dúvidas à disposição! Boas vendas.'
        }
      }
    }
  });

  assert.equal(result.supplier, true);
  assert.equal(bot.conversation(phone).contactRole, 'supplier');
  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /proposta comercial/i);
  assert.match(sentTexts[0].text, /compras/i);
  assert.equal(sentMedia.length, 0);
  assert.equal(
    requestLog.some((item) => item.href === 'https://api.openai.com/v1/responses'),
    false,
    'fornecedor identificado antes da visão não pode gerar análise de produto'
  );
  assert.equal(
    requestLog.some((item) => item.href.startsWith('https://evolution.test/chat/getBase64FromMediaMessage/')),
    false,
    'não deve baixar a imagem para visão quando o contato já é fornecedor'
  );
  assert.equal(backendEvents.at(-1).status, 'Fornecedor / Compras');
});

test('conversa casual e pergunta pessoal não caem no discurso comercial', async () => {
  const casualPhone = '5533977777843';
  await bot.handleMessage({
    phone: casualPhone,
    pushName: 'Contato',
    text: 'bom demais?'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /Tudo certo por aqui/i);
  assert.doesNotMatch(sentTexts[0].text, /fotos de produtos|carnê|não consigo te ajudar/i);

  sentTexts = [];
  const personalPhone = '5533977777844';
  await bot.handleMessage({
    phone: personalPhone,
    pushName: 'Contato',
    text: 'Victor te chamou?'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /deixar essa mensagem para o Marcelo/i);
  assert.doesNotMatch(sentTexts[0].text, /fotos de produtos|carnê|condições de pagamento/i);
  assert.equal(backendEvents.at(-1).status, 'Mensagem interna / administrativa');
});

test('evento vazio sem mídia não inventa que recebeu foto ou arquivo', async () => {
  const phone = '5533977777845';

  const result = await bot.handleWebhook({
    event: 'MESSAGES_UPDATE',
    data: {
      key: { remoteJid: phone + '@s.whatsapp.net', fromMe: false, id: 'EDIT-EMPTY-1' },
      pushName: 'Emilly',
      update: {}
    }
  });

  assert.equal(result.ignored, 'empty_non_media');
  assert.equal(sentTexts.length, 0);
});

test('texto de mensagem editada é extraído quando o webhook traz editedMessage', async () => {
  const phone = '5533977777846';

  const result = await bot.handleWebhook({
    event: 'MESSAGES_UPDATE',
    data: {
      key: { remoteJid: phone + '@s.whatsapp.net', fromMe: false, id: 'EDIT-TEXT-1' },
      pushName: 'Emilly',
      message: {
        protocolMessage: {
          editedMessage: {
            conversation: 'Já entreguei o exame na contabilidade.'
          }
        }
      }
    }
  });

  assert.equal(result.ok, true);
  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /deixar essa mensagem para o Marcelo/i);
  assert.doesNotMatch(sentTexts[0].text, /arquivo|foto|segunda a sábado/i);
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

test('áudio com promessa condicional de pagamento é registrado para o Marcelo e não cai no fallback', async () => {
  const phone = '5533923333499';

  audioTranscriptionText = 'Marcelo, boa tarde. Olha, a mamãe falou que se ela pegar um dinheiro da Danda, tá lá que ela deixou para você, e o dia que eu receber aqui, meu amor, eu já mando para você, viu?';
  mediaBase64Response = {
    mimetype: 'audio/ogg; codecs=opus',
    base64: 'T2dnUwBmYWtlLWF1ZGlvLXByb21lc3Nh'
  };

  const result = await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: {
        remoteJid: phone + '@s.whatsapp.net',
        fromMe: false,
        id: 'AUDIO-PAYMENT-PROMISE-1'
      },
      pushName: 'Leiliane Keyla',
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
  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /atualização de pagamento registrada/i);
  assert.match(sentTexts[0].text, /Marcelo/i);
  assert.doesNotMatch(sentTexts[0].text, /Não consigo te ajudar com esse assunto|fotos de produtos|carnê/i);

  assert.equal(backendEvents.length, 1);
  assert.equal(backendEvents[0].status, 'Aguardando Marcelo - confirmar pagamento/data');
  assert.equal(backendEvents[0].metadata.assunto, 'promessa_pagamento');
  assert.equal(backendEvents[0].metadata.exigeConfirmacaoMarcelo, true);
  assert.equal(backendEvents[0].metadata.naoConfirmarAcordoAutomaticamente, true);

  const financeCall = requestLog.find((item) =>
    item.href === 'https://backend.test/api/bot/financeiro/contas-receber'
  );
  assert.equal(financeCall, undefined, 'promessa não deve alterar nem consultar o financeiro automaticamente');
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

  assert.match(sentTexts.at(-1).text, /produto ou da condição/i);
  assert.doesNotMatch(sentTexts.at(-1).text, /^Claro\s*😊/i);
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
    'Marcelo',
    'Marcelo?',
    'Macelo',
    'Marcello',
    'Oi Marcelo',
    'Olá Marcelo',
    'Bom dia Marcelo',
    'Boa tarde Marcelo',
    'O Marcelo está?',
    'Marcelo tá?',
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

test('"Oi Marcelo" recebe imediatamente a resposta de retorno do Marcelo', async () => {
  const phone = '5533955555554';

  await bot.handleMessage({
    phone,
    text: 'Oi Marcelo',
    pushName: 'Cliente Direto'
  });

  assert.equal(sentTexts.length, 1);
  assert.equal(
    sentTexts[0].text,
    'O Marcelo está em outro atendimento no momento. Assim que ele terminar, ele retorna seu contato 😊\n\nEnquanto você aguarda, gostaria de dar uma olhada em alguma coisa? Posso te mostrar fotos de produtos, preços e condições de pagamento.'
  );
  assert.doesNotMatch(sentTexts[0].text, /Me conta um pouco mais/i);

  assert.equal(backendEvents.length, 1);
  assert.equal(backendEvents[0].status, 'Aguardando retorno do Marcelo');
  assert.equal(bot.conversation(phone).marceloCallbackRequested, true);
});

test('"o Marcelo está?" também recebe a resposta de retorno sem cair no fallback', async () => {
  const phone = '5533955555553';

  await bot.handleMessage({
    phone,
    text: 'o marcelo está?',
    pushName: 'Cliente Direto'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /O Marcelo está em outro atendimento no momento/i);
  assert.match(sentTexts[0].text, /ele retorna seu contato/i);
  assert.doesNotMatch(sentTexts[0].text, /Me conta um pouco mais/i);
  assert.equal(backendEvents[0].status, 'Aguardando retorno do Marcelo');
});


test('"Marcelo" sozinho também chama o retorno humano', async () => {
  const phone = '5533955555552';

  await bot.handleMessage({
    phone,
    text: 'Marcelo',
    pushName: 'Cliente Direto'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /O Marcelo está em outro atendimento no momento/i);
  assert.match(sentTexts[0].text, /ele retorna seu contato/i);
  assert.doesNotMatch(sentTexts[0].text, /Me conta um pouco mais/i);
  assert.equal(backendEvents.length, 1);
  assert.equal(backendEvents[0].status, 'Aguardando retorno do Marcelo');
  assert.equal(bot.conversation(phone).marceloCallbackRequested, true);
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

test('promessas de pagamento com valor e nova data são reconhecidas sem confirmar acordo', () => {
  const examples = [
    'O dinheiro aq n deu certo mas essa semana e minha quinzena na sábado sem falta o 500 ta na mão fecho',
    'Tava contando com um dinheiro aq so q o cara vai me passa ate quarta, caso n der certo dnv sábado sem falta',
    'Não deu certo hoje, mas sábado sem falta te passo 500',
    'Marcelo, boa tarde. A mamãe falou que se ela pegar um dinheiro da Danda, e o dia que eu receber aqui, eu já mando para você, viu?',
    'Assim que o dinheiro cair eu te mando',
    'Quando eu receber o pagamento eu já pago para você'
  ];

  for (const value of examples) {
    assert.equal(bot.asksPaymentPromiseUpdate(value), true, value);
  }

  assert.equal(
    bot.asksPaymentPromiseUpdate('Quanto tenho que te passar esse mês?'),
    false,
    'consulta normal de valor não pode virar promessa de pagamento'
  );
});

test('atualização real de promessa de pagamento vai ao Marcelo e não cai no fallback comercial', async () => {
  const phone = '5533988888821';

  await bot.handleMessage({
    phone,
    text: 'O dinheiro aq n deu certo mas essa semana e minha quinzena na sábado sem falta o 500 ta na mão fecho',
    pushName: 'Toco'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /atualização de pagamento registrada/i);
  assert.match(sentTexts[0].text, /Marcelo/i);
  assert.doesNotMatch(sentTexts[0].text, /produto ou da condição/i);
  assert.doesNotMatch(sentTexts[0].text, /Não consigo te ajudar com esse assunto/i);

  assert.equal(backendEvents.length, 1);
  assert.equal(backendEvents[0].status, 'Aguardando Marcelo - confirmar pagamento/data');
  assert.equal(backendEvents[0].metadata.assunto, 'promessa_pagamento');
  assert.equal(backendEvents[0].metadata.exigeConfirmacaoMarcelo, true);
  assert.equal(backendEvents[0].metadata.naoConfirmarAcordoAutomaticamente, true);

  const financeCall = requestLog.find((item) =>
    item.href === 'https://backend.test/api/bot/financeiro/contas-receber'
  );
  assert.equal(financeCall, undefined, 'não deve consultar nem alterar financeiro nessa combinação');

  sentTexts = [];

  await bot.handleMessage({
    phone,
    text: 'Tava contando com um dinheiro aq so q o cara vai me passa ate quarta, caso n der certo dnv sábado sem falta',
    pushName: 'Toco'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /atualização de pagamento registrada/i);
  assert.doesNotMatch(sentTexts[0].text, /produto ou da condição/i);
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
  for (const value of [
    'Com quem eu estou falando?',
    'com quem eu to falando?',
    'com quem tô falando?',
    'quem ta falando?'
  ]) {
    assert.equal(bot.asksAttendantIdentity(value), true, value);
  }

  const phone = '5533988888830';

  await bot.handleMessage({
    phone,
    text: 'com quem eu to falando?',
    pushName: 'Cliente Identidade'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /Aqui é o Gustavo/i);
  assert.match(sentTexts[0].text, /Ariana Móveis/i);
  assert.doesNotMatch(sentTexts[0].text, /Me conta um pouco mais/i);
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


test('memória comercial leve sobrevive ao descarte da conversa curta sem guardar transcrição', async () => {
  const phone = '5533977777900';
  const item = bot.compactProduct(product('mem-tv-1', 'SMART TV LG 50 4K', {
    category: 'TV',
    pixPrice: 2199,
    cardPrice: 2649
  }));

  const conv = bot.patchTestConversation(phone, {
    selectedProduct: item,
    lastProducts: [item],
    lastIntent: 'produto'
  });

  await bot.markConversationStatus(
    phone,
    conv,
    'Venda em andamento',
    'Cliente gostou da TV e perguntou condições.',
    'Cliente Teste',
    { productId: item.id, paymentMode: 'cartao' }
  );

  const before = bot.commercialProfileSnapshot(phone);
  assert.equal(before.lastProduct.name, 'SMART TV LG 50 4K');
  assert.equal(before.contactRole, 'customer');
  assert.equal(before.salesStage, 'payment_consideration');
  assert.equal('message' in before, false);
  assert.equal('text' in before, false);

  bot.dropTestConversation(phone);
  const fresh = bot.conversation(phone);

  assert.equal(fresh.selectedProduct, null, 'memória longa não deve injetar produto velho automaticamente');
  assert.equal(fresh.contactRole, 'customer');
  assert.equal(bot.commercialProfileSnapshot(phone).lastProduct.name, 'SMART TV LG 50 4K');
});

test('referência vaga recupera produto antigo depois que a conversa curta expirou', async () => {
  const phone = '5533977777901';
  const item = bot.compactProduct(product('mem-caixa-1', 'CAIXA AMP PHILIPS PARTY X4000 1500W', {
    category: 'Caixa de som',
    pixPrice: 1155.85,
    cardPrice: 1392.59
  }));

  const conv = bot.patchTestConversation(phone, {
    selectedProduct: item,
    lastProducts: [item],
    lastIntent: 'produto'
  });
  bot.rememberCommercialInterest(phone, conv, {
    product: item,
    category: 'Caixa de som',
    stage: 'considering',
    source: 'test'
  });
  bot.dropTestConversation(phone);

  await bot.handleMessage({
    phone,
    text: 'quanto fica aquele que eu tava olhando no cartão?',
    pushName: 'Cliente Teste'
  });

  assert.equal(bot.conversation(phone).selectedProduct.id, item.id);
  assert.match(sentTexts.at(-1).text, /CAIXA AMP PHILIPS PARTY X4000/i);
  assert.match(sentTexts.at(-1).text, /cartão/i);
  assert.doesNotMatch(sentTexts.at(-1).text, /me diga qual produto/i);
});

test('referência vaga sozinha confirma o produto lembrado de forma natural', async () => {
  const phone = '5533977777902';
  const item = bot.compactProduct(product('mem-geladeira-1', 'REFRIGERADOR CONSUL 451L', {
    category: 'Geladeira',
    pixPrice: 3974,
    cardPrice: 4787.95
  }));

  const conv = bot.patchTestConversation(phone, {});
  bot.rememberCommercialInterest(phone, conv, {
    product: item,
    category: 'Geladeira',
    stage: 'considering'
  });
  bot.dropTestConversation(phone);

  await bot.handleMessage({
    phone,
    text: 'aquele que eu te falei',
    pushName: 'Cliente Teste'
  });

  assert.match(sentTexts.at(-1).text, /Você está falando de.*REFRIGERADOR CONSUL 451L/i);
  assert.match(sentTexts.at(-1).text, /Eu lembro dele/i);
  assert.equal(bot.conversation(phone).selectedProduct.id, item.id);
});

test('"o outro" recupera o interesse anterior sem confundir com o produto mais recente', async () => {
  const phone = '5533977777903';
  const tv = bot.compactProduct(product('mem-tv-old', 'SMART TV LG 43', {
    category: 'TV',
    pixPrice: 1825.17,
    cardPrice: 2199
  }));
  const caixa = bot.compactProduct(product('mem-caixa-new', 'CAIXA AMP PHILIPS PARTY X4000 1500W', {
    category: 'Caixa de som',
    pixPrice: 1155.85,
    cardPrice: 1392.59
  }));

  const conv = bot.patchTestConversation(phone, {});
  bot.rememberCommercialInterest(phone, conv, { product: tv, category: 'TV', stage: 'considering' });
  bot.rememberCommercialInterest(phone, conv, { product: caixa, category: 'Caixa de som', stage: 'considering' });
  bot.dropTestConversation(phone);

  await bot.handleMessage({
    phone,
    text: 'e o outro que eu tava olhando?',
    pushName: 'Cliente Teste'
  });

  assert.match(sentTexts.at(-1).text, /SMART TV LG 43/i);
  assert.equal(bot.conversation(phone).selectedProduct.id, tv.id);
});

test('tipo fornecedor permanece identificado mesmo após conversa curta ser descartada', async () => {
  const phone = '5533977777904';

  await bot.handleMessage({
    phone,
    text: 'Sou consultora comercial. Tenho preço direto de fábrica e condição para lojista.',
    pushName: 'Samira Consultora'
  });

  assert.equal(bot.commercialProfileSnapshot(phone).contactRole, 'supplier');
  bot.dropTestConversation(phone);
  sentTexts = [];

  await bot.handleMessage({
    phone,
    text: 'Aguardando atendimento...',
    pushName: 'Samira'
  });

  assert.equal(bot.conversation(phone).contactRole, 'supplier');
  assert.equal(sentTexts.length, 0, 'fornecedor persistido não deve cair no atendimento de varejo');
});

test('cliente que retorna depois recebe uma retomada comercial curta apenas uma vez no cooldown', async () => {
  const phone = '5533977777905';
  const item = bot.compactProduct(product('mem-sofa-1', 'SOFÁ RETRÁTIL 3 LUGARES', {
    category: 'Sofá',
    pixPrice: 1899,
    cardPrice: 2287.95
  }));

  bot.patchTestCommercialProfile(phone, {
    contactRole: 'customer',
    contactRoleAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
    lastProduct: item,
    lastProductAt: Date.now() - 24 * 60 * 60 * 1000,
    interests: [{ product: item, category: 'Sofá', at: Date.now() - 24 * 60 * 60 * 1000, source: 'test' }],
    salesStage: 'considering',
    salesStageAt: Date.now() - 24 * 60 * 60 * 1000,
    lastCommercialAt: Date.now() - 24 * 60 * 60 * 1000,
    lastResumeAt: 0
  });
  bot.dropTestConversation(phone);

  await bot.handleMessage({
    phone,
    text: 'boa tarde',
    pushName: 'Mariana Cliente'
  });

  assert.match(sentTexts.at(-1).text, /Mariana/i);
  assert.match(sentTexts.at(-1).text, /Lembro que você estava olhando.*SOFÁ RETRÁTIL 3 LUGARES/i);
  assert.equal(backendEvents.at(-1).status, 'Venda em acompanhamento');
  assert.equal(backendEvents.at(-1).metadata.proactiveMessage, false);

  sentTexts = [];
  await bot.handleMessage({
    phone,
    text: 'boa tarde',
    pushName: 'Mariana Cliente'
  });

  assert.equal(sentTexts.length, 1);
  assert.doesNotMatch(sentTexts[0].text, /Lembro que você estava olhando/i);
  assert.match(sentTexts[0].text, /Seja bem-vindo à Ariana Móveis/i);
});

test('lembrete automático de vencimento abre contexto de cobrança sem pausar Gustavo como atendimento manual', async () => {
  const phone = '5533977777790';
  const reminder = [
    'Bom dia, Cliente! Tudo bem?',
    '',
    'Passando para lembrar que hoje vence uma parcela referente à sua compra realizada aqui na Ariana Móveis.',
    '',
    'Se o pagamento já tiver sido realizado, por favor desconsidere esta mensagem.',
    '',
    'Qualquer dúvida, estamos à disposição. 💙',
    '',
    'Marcelo'
  ].join('\n');

  const outbound = await bot.handleWebhook({
    event: 'messages.upsert',
    data: {
      key: {
        remoteJid: phone + '@s.whatsapp.net',
        fromMe: true,
        id: 'DAILY-DUE-REMINDER-1'
      },
      pushName: 'Cliente Cobrança',
      message: { conversation: reminder }
    }
  });

  assert.equal(outbound.dailyDueReminder, true);
  assert.equal(bot.conversation(phone).manualHumanUntil, 0);
  assert.equal(bot.hasDailyDueCollectionContext(bot.conversation(phone)), true);

  sentTexts = [];

  await bot.handleWebhook({
    event: 'messages.upsert',
    data: {
      key: {
        remoteJid: phone + '@s.whatsapp.net',
        fromMe: false,
        id: 'DAILY-DUE-REPLY-1'
      },
      pushName: 'Cliente Cobrança',
      message: { conversation: 'Bom dia' }
    }
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /parcela que vence hoje/i);
  assert.doesNotMatch(sentTexts[0].text, /Seja bem-vindo|o que você está procurando|produtos, preços/i);
});

test('Gustavo mantém negociação de nova data dentro da cobrança e encaminha ao Marcelo sem prometer acordo', async () => {
  const phone = '5533977777791';
  bot.patchTestConversation(phone, {
    dailyDueContextUntil: Date.now() + (6 * 60 * 60 * 1000),
    dailyDueReminderAt: Date.now(),
    manualHumanUntil: 0,
    humanUntil: 0
  });

  await bot.handleMessage({
    phone,
    text: 'Hoje não consigo, posso pagar amanhã?',
    pushName: 'Cliente Cobrança'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /parcela que vence hoje/i);
  assert.match(sentTexts[0].text, /Marcelo/i);
  assert.match(sentTexts[0].text, /confirma/i);
  assert.doesNotMatch(sentTexts[0].text, /produto|catálogo|comprar/i);

  const event = backendEvents.at(-1);
  assert.equal(event.status, 'Cobrança do dia - aguardando Marcelo');
  assert.equal(event.metadata.contextoCobranca, true);
  assert.equal(event.metadata.naoConfirmarAcordoAutomaticamente, true);
});

test('Gustavo responde chave PIX no contexto da parcela do dia sem iniciar atendimento comercial', async () => {
  const phone = '5533977777792';
  bot.patchTestConversation(phone, {
    dailyDueContextUntil: Date.now() + (6 * 60 * 60 * 1000),
    dailyDueReminderAt: Date.now()
  });

  await bot.handleMessage({
    phone,
    text: 'me manda a chave pix para pagar essa parcela',
    pushName: 'Cliente Cobrança'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /Para a parcela que vence hoje/i);
  assert.match(sentTexts[0].text, /31985147119/);
  assert.match(sentTexts[0].text, /MARCELO NUNES SILVA/i);
  assert.doesNotMatch(sentTexts[0].text, /produto|catálogo/i);
});


test('contexto da cobrança sai automaticamente quando cliente inicia nova consulta clara de produto', async () => {
  const phone = '5533977777793';
  catalogRows = [
    product('geladeira-venda-apos-cobranca', 'Geladeira Consul 386L', {
      category: 'Geladeira',
      brand: 'Consul',
      stock: 3
    })
  ];

  bot.patchTestConversation(phone, {
    dailyDueContextUntil: Date.now() + (6 * 60 * 60 * 1000),
    dailyDueReminderAt: Date.now(),
    pendingAction: 'daily_due_finance_cpf'
  });

  await bot.handleMessage({
    phone,
    text: 'vocês têm geladeira?',
    pushName: 'Cliente Cobrança'
  });

  assert.equal(bot.hasDailyDueCollectionContext(bot.conversation(phone)), false);
  assert.notEqual(bot.conversation(phone).pendingAction, 'daily_due_finance_cpf');
  assert.equal(sentMedia.length, 1);
  assert.match(sentMedia[0].caption || '', /Geladeira Consul 386L/i);
  assert.doesNotMatch(sentTexts.map((item) => item.text).join('\n'), /CPF do titular|parcela que vence hoje/i);
});

test('citar o produto dentro da pergunta da parcela não tira o cliente do contexto de cobrança', () => {
  assert.equal(
    bot.asksDailyDueSubjectChange('qual o valor da parcela da geladeira que vence hoje?'),
    false
  );
  assert.equal(
    bot.asksDailyDueSubjectChange('essa parcela da TV é a que vence hoje?'),
    false
  );
  assert.equal(
    bot.asksDailyDueSubjectChange('vocês têm geladeira?'),
    true
  );
  assert.equal(
    bot.asksDailyDueSubjectChange('quanto está a TV de 50 polegadas?'),
    true
  );
  assert.equal(
    bot.asksDailyDueSubjectChange('quero comprar um sofá no crediário'),
    true
  );
});


test('Gustavo recupera do backend o contexto de cobrança do dia mesmo sem evento outbound do WhatsApp', async () => {
  const phone = '5533977777794';
  dailyDueContextResponse = {
    ok: true,
    active: true,
    date: '2026-09-22',
    status: 'sent',
    sentAt: '2026-09-22T12:00:00.000Z'
  };

  await bot.handleWebhook({
    event: 'messages.upsert',
    data: {
      key: {
        remoteJid: phone + '@s.whatsapp.net',
        fromMe: false,
        id: 'DAILY-DUE-BACKEND-CONTEXT-1'
      },
      pushName: 'Cliente Cobrança',
      message: { conversation: 'ok' }
    }
  });

  assert.equal(bot.hasDailyDueCollectionContext(bot.conversation(phone)), true);
  assert.equal(sentTexts.length, 1);
  assert.equal(sentTexts[0].text, 'Por nada 😊 Qualquer coisa estou por aqui.');
  assert.doesNotMatch(sentTexts[0].text, /produto ou da condição que você precisa|Seja bem-vindo/i);

  const lookup = requestLog.find((item) =>
    item.href === 'https://backend.test/api/bot/financeiro/vencimento-hoje/contexto'
  );
  assert.ok(lookup, 'deve consultar contexto protegido no backend');
  assert.equal(lookup.options.headers['x-loja-bot-token'], 'test-loja-token');
});

test('consulta de venda clara não é capturada pela sincronização da cobrança do dia', async () => {
  const phone = '5533977777795';
  dailyDueContextResponse = {
    ok: true,
    active: true,
    date: '2026-09-22',
    status: 'sent'
  };
  catalogRows = [
    product('geladeira-backend-context-1', 'Geladeira Brastemp 375L', {
      category: 'Geladeira',
      stock: 2
    })
  ];

  await bot.handleWebhook({
    event: 'messages.upsert',
    data: {
      key: {
        remoteJid: phone + '@s.whatsapp.net',
        fromMe: false,
        id: 'DAILY-DUE-BACKEND-SALES-1'
      },
      pushName: 'Cliente Cobrança',
      message: { conversation: 'vocês têm geladeira?' }
    }
  });

  assert.equal(bot.hasDailyDueCollectionContext(bot.conversation(phone)), false);
  assert.equal(sentMedia.length, 1);
  assert.match(sentMedia[0].caption || '', /Geladeira Brastemp 375L/i);
});


test('resolveIncomingPhone prefere o telefone real quando remoteJid usa @lid', () => {
  assert.equal(
    bot.resolveIncomingPhone({
      remoteJid: '229999999999999@lid',
      key: { remoteJidAlt: '5533988905282@s.whatsapp.net' },
      data: {},
      payload: {}
    }),
    '5533988905282'
  );

  assert.equal(
    bot.resolveIncomingPhone({
      remoteJid: '229999999999999@lid',
      key: {},
      data: { senderPn: '5533988905282@s.whatsapp.net' },
      payload: {}
    }),
    '5533988905282'
  );
});

test('contexto de cobrança funciona em conversa LID usando remoteJidAlt do telefone real', async () => {
  const phone = '5533988905282';
  dailyDueContextResponse = {
    ok: true,
    active: true,
    date: '2026-09-22',
    status: 'sent',
    sentAt: '2026-09-22T14:00:00.000Z'
  };

  await bot.handleWebhook({
    event: 'messages.upsert',
    data: {
      key: {
        remoteJid: '229999999999999@lid',
        remoteJidAlt: phone + '@s.whatsapp.net',
        fromMe: false,
        id: 'LID-DAILY-DUE-1'
      },
      pushName: 'Marcelo Teste',
      message: { conversation: 'ok' }
    }
  });

  assert.equal(bot.hasDailyDueCollectionContext(bot.conversation(phone)), true);
  assert.equal(sentTexts.length, 1);
  assert.equal(sentTexts[0].text, 'Por nada 😊 Qualquer coisa estou por aqui.');
  assert.doesNotMatch(sentTexts[0].text, /produto ou da condição que você precisa/i);

  const lookup = requestLog.find((item) =>
    item.href === 'https://backend.test/api/bot/financeiro/vencimento-hoje/contexto'
  );
  assert.ok(lookup, 'deve consultar o contexto pelo telefone real');
  assert.match(String(lookup.options.body || ''), /5533988905282/);
});


test('aliases brasileiros tratam o mesmo celular com e sem nono dígito', () => {
  assert.deepEqual(
    new Set(bot.brazilWhatsappPhoneAliases('5533988905282')),
    new Set(['5533988905282', '553388905282'])
  );

  assert.deepEqual(
    new Set(bot.brazilWhatsappPhoneAliases('553388905282')),
    new Set(['553388905282', '5533988905282'])
  );

  assert.deepEqual(
    bot.brazilWhatsappPhoneAliases('553332701234'),
    ['553332701234']
  );
});

test('JID legado sem o nono dígito resolve sem alterar o número recebido pela Evolution', () => {
  assert.equal(
    bot.resolveIncomingPhone({
      remoteJid: '553388905282@s.whatsapp.net',
      key: {},
      data: {},
      payload: {}
    }),
    '553388905282'
  );

  assert.ok(
    bot.brazilWhatsappPhoneAliases('553388905282').includes('5533988905282')
  );
});


test('emojis positivos comuns da cobrança recebem uma resposta curta sem repetir o texto financeiro', async () => {
  const phone = '5533977777796';
  bot.patchTestConversation(phone, {
    dailyDueContextUntil: Date.now() + (6 * 60 * 60 * 1000),
    dailyDueReminderAt: Date.now(),
    dailyDueCourtesyAt: 0,
    dailyDueCourtesyCount: 0
  });

  assert.equal(bot.dailyDueCourtesyIntent('😊'), 'positive_emoji');
  assert.equal(bot.dailyDueCourtesyIntent('🙏'), 'positive_emoji');
  assert.equal(bot.dailyDueCourtesyIntent('🥰'), 'positive_emoji');
  assert.equal(bot.dailyDueCourtesyIntent('😍'), 'positive_emoji');
  assert.equal(bot.dailyDueCourtesyIntent('❤️'), 'positive_emoji');
  assert.equal(bot.dailyDueCourtesyIntent('🙌'), 'positive_emoji');
  assert.equal(bot.dailyDueCourtesyIntent('👍'), 'positive_emoji');

  await bot.handleMessage({
    phone,
    text: '🙏',
    pushName: 'Cliente Cobrança'
  });

  assert.equal(sentTexts.length, 1);
  assert.equal(sentTexts[0].text, 'Por nada 😊 Qualquer coisa estou por aqui.');
  assert.doesNotMatch(sentTexts[0].text, /valor|chave PIX|comprovante|previsão de pagamento/i);
});

test('sequência de emojis positivos na cobrança não gera uma resposta para cada emoji', async () => {
  const phone = '5533977777797';
  bot.patchTestConversation(phone, {
    dailyDueContextUntil: Date.now() + (6 * 60 * 60 * 1000),
    dailyDueReminderAt: Date.now(),
    dailyDueCourtesyAt: 0,
    dailyDueCourtesyCount: 0
  });

  await bot.handleMessage({ phone, text: '😊', pushName: 'Cliente Cobrança' });
  await bot.handleMessage({ phone, text: '❤️', pushName: 'Cliente Cobrança' });
  await bot.handleMessage({ phone, text: '👍', pushName: 'Cliente Cobrança' });

  assert.equal(sentTexts.length, 1);
  assert.equal(sentTexts[0].text, 'Por nada 😊 Qualquer coisa estou por aqui.');
  assert.equal(bot.conversation(phone).dailyDueCourtesyCount, 3);
  assert.equal(bot.hasDailyDueCollectionContext(bot.conversation(phone)), true);
});


test('cobrança do dia sinaliza skipLegacy para impedir segunda resposta do fluxo antigo', async () => {
  const phone = '5533988905282';
  const alias = '553388905282';
  const contextPatch = {
    dailyDueContextUntil: Date.now() + (6 * 60 * 60 * 1000),
    dailyDueReminderAt: Date.now(),
    dailyDueCourtesyAt: 0,
    dailyDueCourtesyCount: 0
  };
  bot.patchTestConversation(phone, contextPatch);
  bot.patchTestConversation(alias, contextPatch);

  const result = await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: {
        remoteJid: '553388905282@s.whatsapp.net',
        fromMe: false,
        id: 'DAILY-DUE-SKIP-LEGACY-1'
      },
      pushName: 'Cliente Cobrança',
      message: { conversation: '👍' }
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.collectionContext, true);
  assert.equal(result.skipLegacy, true);
  assert.equal(sentTexts.length, 1);
  assert.equal(sentTexts[0].text, 'Por nada 😊 Qualquer coisa estou por aqui.');
});

test('controle de emoji positivo é compartilhado entre número com e sem nono dígito', async () => {
  const withNine = '5533988905282';
  const withoutNine = '553388905282';

  bot.patchTestConversation(withNine, {
    dailyDueContextUntil: Date.now() + (6 * 60 * 60 * 1000),
    dailyDueReminderAt: Date.now(),
    dailyDueCourtesyAt: 0,
    dailyDueCourtesyCount: 0
  });
  bot.patchTestConversation(withoutNine, {
    dailyDueContextUntil: Date.now() + (6 * 60 * 60 * 1000),
    dailyDueReminderAt: Date.now(),
    dailyDueCourtesyAt: 0,
    dailyDueCourtesyCount: 0
  });

  await bot.handleMessage({
    phone: withoutNine,
    text: '👍',
    pushName: 'Cliente Cobrança'
  });

  assert.equal(sentTexts.length, 1);
  assert.equal(sentTexts[0].text, 'Por nada 😊 Qualquer coisa estou por aqui.');

  await bot.handleMessage({
    phone: withNine,
    text: '😊',
    pushName: 'Cliente Cobrança'
  });

  assert.equal(sentTexts.length, 1, 'o segundo alias não deve responder novamente');
  assert.ok(bot.conversation(withNine).dailyDueCourtesyAt > 0);
  assert.ok(bot.conversation(withoutNine).dailyDueCourtesyAt > 0);
});

test('nova intenção de venda após cobrança continua liberada e não força skipLegacy', async () => {
  const phone = '5533977777798';
  bot.patchTestConversation(phone, {
    dailyDueContextUntil: Date.now() + (6 * 60 * 60 * 1000),
    dailyDueReminderAt: Date.now()
  });

  catalogRows = [
    product('geladeira-skip-legacy-1', 'Geladeira Electrolux 400L', {
      category: 'Geladeira',
      stock: 2
    })
  ];

  const result = await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: {
        remoteJid: phone + '@s.whatsapp.net',
        fromMe: false,
        id: 'DAILY-DUE-SALES-SWITCH-LEGACY-1'
      },
      pushName: 'Cliente Cobrança',
      message: { conversation: 'vocês têm geladeira?' }
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipLegacy, false);
  assert.equal(bot.hasDailyDueCollectionContext(bot.conversation(phone)), false);
  assert.equal(sentMedia.length, 1);
  assert.match(sentMedia[0].caption || '', /Geladeira Electrolux 400L/i);
});


test('saudação natural dentro da cobrança responde curto e permanece no contexto financeiro', async () => {
  const phone = '5533977777799';
  bot.patchTestConversation(phone, {
    dailyDueContextUntil: Date.now() + (6 * 60 * 60 * 1000),
    dailyDueReminderAt: Date.now()
  });

  const result = await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: {
        remoteJid: phone + '@s.whatsapp.net',
        fromMe: false,
        id: 'DAILY-DUE-GREETING-1'
      },
      pushName: 'Cliente Cobrança',
      message: { conversation: 'oi boa tarde' }
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.collectionContext, true);
  assert.equal(result.skipLegacy, true);
  assert.equal(sentTexts.length, 1);
  assert.equal(
    sentTexts[0].text,
    'Boa tarde 😊 Estou por aqui. Se precisar de algo sobre a parcela que vence hoje, é só me falar.'
  );
  assert.doesNotMatch(sentTexts[0].text, /valor, a chave PIX, o comprovante/i);
});

test('saudação com typo comum bopa tarde continua curta dentro da cobrança', async () => {
  const phone = '5533977777800';
  bot.patchTestConversation(phone, {
    dailyDueContextUntil: Date.now() + (6 * 60 * 60 * 1000),
    dailyDueReminderAt: Date.now()
  });

  await bot.handleMessage({
    phone,
    text: 'oi bopa tarde',
    pushName: 'Cliente Cobrança'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /^Boa tarde 😊 Estou por aqui\./);
  assert.doesNotMatch(sentTexts[0].text, /valor, a chave PIX, o comprovante/i);
});

test('pedido genérico para ver produtos sai da cobrança e entra no atendimento de vendas', async () => {
  const phone = '5533977777801';
  bot.patchTestConversation(phone, {
    dailyDueContextUntil: Date.now() + (6 * 60 * 60 * 1000),
    dailyDueReminderAt: Date.now()
  });

  const result = await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: {
        remoteJid: phone + '@s.whatsapp.net',
        fromMe: false,
        id: 'DAILY-DUE-GENERIC-CATALOG-1'
      },
      pushName: 'Cliente Cobrança',
      message: { conversation: 'queria ver sobre produtos' }
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipLegacy, false);
  assert.equal(bot.hasDailyDueCollectionContext(bot.conversation(phone)), false);
  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /Trabalhamos com \*móveis, eletrodomésticos, eletrônicos, celulares, informática e eletroportáteis\*/i);
  assert.doesNotMatch(sentTexts[0].text, /Me conta um pouco mais do produto ou da condição/i);
});

test('emoji positivo com caractere invisível continua reconhecido como reação positiva', () => {
  assert.equal(bot.emojiOnlyIntent('\u200e😊\u200f'), 'positive');
  assert.equal(bot.emojiOnlyIntent('\u2060🙏\u2060'), 'positive');
});
