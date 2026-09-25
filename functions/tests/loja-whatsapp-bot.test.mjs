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
process.env.LOJA_AUDIO_TRANSCRIBE_MODEL = 'gpt-transcribe';
process.env.LOJA_AUDIO_MAX_SECONDS = '600';
process.env.LOJA_AUDIO_USD_PER_MINUTE = '0.0045';

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
    imageUrl: options.imageUrl || ('https://img.test/' + id + '.jpg'),
    images: options.images,
    imageUrls: options.imageUrls,
    sellerName: options.sellerName || 'Ariana Móveis',
    isBestSeller: options.isBestSeller === true,
    isRecommended: options.isRecommended === true,
    description: options.description || '',
    specs: options.specs || '',
    width: options.width || 0,
    height: options.height || 0,
    length: options.length || 0,
    weight: options.weight || 0
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

    if (href.startsWith('https://backend.test/api/products/')) {
      const id = decodeURIComponent(href.split('/').pop() || '');
      const row = catalogRows.find((item) => String(item.id || item._id || '') === id);
      return row ? jsonResponse(row) : jsonResponse({ error: 'not_found' }, 404);
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
  assert.match(sentTexts[0].text, /^Boa noite, Gaby! 😊 Tudo bem\?/i);
  assert.doesNotMatch(sentTexts[0].text, /Marcionilo|Cliente/i);

  sentTexts = [];

  const phoneNumberOnly = '5533977777762';
  await bot.handleMessage({
    phone: phoneNumberOnly,
    text: 'Boa noite',
    pushName: '31985147119'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /^Boa noite! 😊 Tudo bem\?/i);
  assert.doesNotMatch(sentTexts[0].text, /31985147119/);
});

test('saudação simples abre conversa humana e resposta de bem-estar pergunta o que precisa hoje', async () => {
  const examples = [
    ['Bom dia tudo bem?', 'João Cliente', /^Bom dia, João! 😊 Tudo ótimo por aqui\. E você\?/i, 'tô bem graças a Deus'],
    ['Bom dia', 'Maria Cliente', /^Bom dia, Maria! 😊 Tudo bem\?/i, 'estou bem'],
    ['Oi bom dia', 'Paulo Cliente', /^Bom dia, Paulo! 😊 Tudo bem\?/i, 'bem também'],
    ['Oi', 'Carla Cliente', /^(?:Bom dia|Boa tarde|Boa noite), Carla! 😊 Tudo bem\?/i, 'bem obrigado'],
    ['Oii', 'Rafael Cliente', /^(?:Bom dia|Boa tarde|Boa noite), Rafael! 😊 Tudo bem\?/i, 'tudo bem'],
    ['Boa tarde', 'Lúcia Cliente', /^Boa tarde, Lúcia! 😊 Tudo bem\?/i, 'tudo ótimo']
  ];

  for (let i = 0; i < examples.length; i += 1) {
    const [textValue, pushName, expected, wellbeingReply] = examples[i];
    const phone = '553397777793' + String(i);

    sentTexts = [];
    await bot.handleMessage({ phone, text: textValue, pushName });
    assert.equal(sentTexts.length, 1);
    assert.match(sentTexts[0].text, expected);
    assert.equal(bot.hasCourtesyGreetingContext(bot.conversation(phone)), true);

    sentTexts = [];
    await bot.handleMessage({
      phone,
      text: wellbeingReply,
      pushName
    });

    assert.equal(sentTexts.length, 1);
    assert.match(sentTexts[0].text, /^Ah, que bom 😊/i);
    assert.match(sentTexts[0].text, /O que você tá precisando pra hoje\?/i);
    assert.equal(bot.hasCourtesyGreetingContext(bot.conversation(phone)), false);
  }

  for (const value of examples.map((item) => item[3])) {
    assert.equal(bot.isPositiveWellbeingReply(value), true, value);
  }
});


test('boa noite tudo bem após horas não retoma TV nem pergunta antiga de parcelamento', async () => {
  const phone = '5533977777947';
  const tv = bot.compactProduct(product('tv-stale-greeting-1', 'Smart tv lg 43 polegadas', {
    category: 'TV',
    pixPrice: 1799,
    cardPrice: 2160,
    stock: 2
  }));

  bot.patchTestConversation(phone, {
    lastAt: Date.now() - 6 * 60 * 60 * 1000,
    selectedProduct: tv,
    lastProducts: [tv],
    allProductResults: [tv],
    lastProductQuery: 'tv',
    pendingAction: 'installment_payment_method',
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'boa noite tudo bem?',
    pushName: 'Marcelo'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /^Boa noite, Marcelo! 😊 Tudo ótimo por aqui\. E você\?/i);
  assert.doesNotMatch(sentTexts[0].text, /Smart tv lg 43|cartão|crediário\/carnê/i);

  const conv = bot.conversation(phone);
  assert.equal(conv.pendingAction, '');
  assert.equal(conv.selectedProduct, null);
  assert.equal(conv.lastProducts.length, 0);
  assert.equal(conv.lastIntent, '');
});

test('produto de ontem não é usado automaticamente em pergunta nova sem referência explícita', async () => {
  const phone = '5533977777946';
  const tv = bot.compactProduct(product('tv-stale-yesterday-1', 'Smart TV LG 43 polegadas', {
    category: 'TV',
    pixPrice: 1799,
    cardPrice: 2160,
    stock: 2
  }));

  bot.patchTestConversation(phone, {
    lastAt: Date.now() - 24 * 60 * 60 * 1000,
    selectedProduct: tv,
    lastProducts: [tv],
    allProductResults: [tv],
    lastProductQuery: 'tv',
    pendingAction: 'installment_payment_method',
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'quanto fica parcelado?',
    pushName: 'Marcelo'
  });

  assert.doesNotMatch(sentTexts.at(-1).text, /Smart TV LG 43/i);
  assert.match(sentTexts.at(-1).text, /produto|condição/i);
  assert.equal(bot.conversation(phone).selectedProduct, null);
  assert.equal(bot.conversation(phone).lastProducts.length, 0);
  assert.equal(bot.conversation(phone).pendingAction, '');
});

test('resposta "Tudo" após bom dia não retoma pergunta comercial antiga', async () => {
  const phone = '5533977777948';
  const chosen = bot.compactProduct(product('tv-greeting-old-1', 'Smart tv lg 43 polegadas', {
    category: 'TV',
    pixPrice: 1799,
    cardPrice: 2160,
    stock: 2
  }));

  bot.patchTestConversation(phone, {
    selectedProduct: chosen,
    lastProducts: [chosen],
    allProductResults: [chosen],
    pendingAction: 'installment_payment_method',
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'Bom dia',
    pushName: 'Marcelo'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /^Bom dia, Marcelo! 😊 Tudo bem\?/i);
  assert.equal(
    bot.conversation(phone).pendingAction,
    '',
    'nova saudação pura deve cancelar somente a pergunta comercial transitória antiga'
  );
  assert.equal(
    bot.conversation(phone).selectedProduct?.name,
    'Smart tv lg 43 polegadas',
    'produto continua lembrado sem ficar forçando a pergunta antiga'
  );

  sentTexts = [];

  await bot.handleMessage({
    phone,
    text: 'Tudo',
    pushName: 'Marcelo'
  });

  assert.equal(bot.expectedWellbeingReplyTone('Tudo'), 'positive');
  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /^Ah, que bom 😊/i);
  assert.match(sentTexts[0].text, /O que você tá precisando pra hoje\?/i);
  assert.doesNotMatch(sentTexts[0].text, /cartão|crediário|Smart tv lg 43/i);
});

test('contexto de cortesia entende respostas curtas positivas neutras e negativas', async () => {
  const groups = [
    {
      tone: 'positive',
      replies: ['Tudo', 'sim', 'bem', 'graças a Deus', 'show', 'de boa', 'suave', 'maravilha', 'td certo'],
      expected: /Ah, que bom/i
    },
    {
      tone: 'neutral',
      replies: ['indo', 'vou indo', 'levando', 'mais ou menos', 'na luta', 'empurrando'],
      expected: /Entendi 😊/i
    },
    {
      tone: 'negative',
      replies: ['não', 'mal', 'péssimo', 'horrível', 'bem ruim', 'mais pra ruim'],
      expected: /Poxa, entendi/i
    }
  ];

  let seq = 0;
  for (const group of groups) {
    for (const reply of group.replies) {
      const phone = '553397776' + String(1000 + seq++);
      sentTexts = [];

      await bot.handleMessage({
        phone,
        text: 'Oi',
        pushName: 'Cliente Teste'
      });
      assert.equal(bot.hasCourtesyGreetingContext(bot.conversation(phone)), true);

      sentTexts = [];
      await bot.handleMessage({
        phone,
        text: reply,
        pushName: 'Cliente Teste'
      });

      assert.equal(bot.expectedWellbeingReplyTone(reply), group.tone, reply);
      assert.equal(sentTexts.length, 1, reply);
      assert.match(sentTexts[0].text, group.expected, reply);
      assert.match(sentTexts[0].text, /O que você tá precisando pra hoje\?/i, reply);
      assert.equal(bot.hasCourtesyGreetingContext(bot.conversation(phone)), false, reply);
    }
  }
});

test('bem-estar junto com novo pedido reconhece a cortesia e segue para o produto', async () => {
  const cases = [
    ['tudo bem, queria ver uma geladeira', 'positive', /Que bom 😊/i],
    ['mais ou menos, mas quero ver uma geladeira', 'neutral', /Entendi 😊/i],
    ['tô mal, mas preciso ver uma geladeira', 'negative', /Poxa, entendi/i]
  ];

  catalogRows = [
    product('gel-courtesy-mixed-1', 'Geladeira Consul Frost Free 340L', {
      category: 'Geladeira',
      stock: 2
    })
  ];

  for (let i = 0; i < cases.length; i += 1) {
    const [reply, tone, expectedCourtesy] = cases[i];
    const phone = '553397777795' + String(i);
    sentTexts = [];
    sentMedia = [];

    await bot.handleMessage({
      phone,
      text: 'Bom dia',
      pushName: 'Cliente Misto'
    });

    sentTexts = [];
    sentMedia = [];

    await bot.handleMessage({
      phone,
      text: reply,
      pushName: 'Cliente Misto'
    });

    assert.equal(bot.wellbeingReplyLeadTone(reply), tone, reply);
    assert.ok(sentTexts.some((item) => expectedCourtesy.test(item.text || '')), reply);
    assert.ok(
      sentMedia.some((item) => /Geladeira Consul Frost Free 340L/i.test(item.caption || '')),
      reply
    );
  }
});

test('saudação simples não inventa bem-estar e "tudo bem?" é pergunta ao Gustavo', async () => {
  const phone = '5533977777939';

  await bot.handleMessage({
    phone,
    text: 'oi boa noite',
    pushName: 'Marcelo Cliente'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /^Boa noite, Marcelo! 😊 Tudo bem\?/i);
  assert.doesNotMatch(sentTexts[0].text, /Tudo ótimo/i);
  assert.equal(bot.hasCourtesyGreetingContext(bot.conversation(phone)), true);

  sentTexts = [];

  await bot.handleMessage({
    phone,
    text: 'tudo bem?',
    pushName: 'Marcelo Cliente'
  });

  assert.equal(bot.asksBotWellbeingQuestion('tudo bem?'), true);
  assert.equal(bot.isPositiveWellbeingReply('tudo bem?'), false);
  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /^Tudo ótimo por aqui 😊 E você\?$/i);
  assert.doesNotMatch(sentTexts[0].text, /Ah, que bom/i);
  assert.equal(bot.hasCourtesyGreetingContext(bot.conversation(phone)), true);

  sentTexts = [];

  await bot.handleMessage({
    phone,
    text: 'tô bem',
    pushName: 'Marcelo Cliente'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /^Ah, que bom 😊/i);
  assert.equal(bot.hasCourtesyGreetingContext(bot.conversation(phone)), false);
});

test('saudações enviadas em sequência rápida recebem somente uma resposta do Gustavo', async () => {
  const phone = '5533977777925';

  await bot.handleMessage({
    phone,
    text: 'oi',
    pushName: 'Marcelo Cliente'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /^(?:Olá|Bom dia|Boa tarde|Boa noite), Marcelo! 😊 Tudo bem\?/i);

  await bot.handleMessage({
    phone,
    text: 'boa noite',
    pushName: 'Marcelo Cliente'
  });

  assert.equal(
    sentTexts.length,
    1,
    'segunda saudação imediata não deve gerar uma segunda resposta automática'
  );
  assert.equal(bot.isRapidGreetingFollowup(bot.conversation(phone), 'boa noite'), true);

  await bot.handleMessage({
    phone,
    text: 'tô bem',
    pushName: 'Marcelo Cliente'
  });

  assert.equal(sentTexts.length, 2);
  assert.match(sentTexts.at(-1).text, /Ah, que bom/i);
  assert.match(sentTexts.at(-1).text, /O que você tá precisando pra hoje/i);
});

test('resposta positiva com "e você?" responde ao cliente antes de seguir para venda', async () => {
  const replies = [
    'beleza e você ?',
    'tô bem e vc?',
    'estou bem, e você?'
  ];

  for (let i = 0; i < replies.length; i += 1) {
    const phone = '5533977777936' + String(i);

    sentTexts = [];
    await bot.handleMessage({
      phone,
      text: 'oi boa noite',
      pushName: 'Marcelo Cliente'
    });

    assert.equal(sentTexts.length, 1);
    assert.match(sentTexts[0].text, /^Boa noite, Marcelo! 😊 Tudo bem\?/i);

    sentTexts = [];
    await bot.handleMessage({
      phone,
      text: replies[i],
      pushName: 'Marcelo Cliente'
    });

    assert.equal(bot.isPositiveWellbeingReply(replies[i]), true, replies[i]);
    assert.equal(bot.asksBackWellbeing(replies[i]), true, replies[i]);
    assert.equal(sentTexts.length, 1);
    assert.match(sentTexts[0].text, /^Que bom 😊 Por aqui tá tudo ótimo também\./i);
    assert.match(sentTexts[0].text, /O que você tá precisando pra hoje\?/i);
    assert.doesNotMatch(sentTexts[0].text, /^Ah, que bom/i);
    assert.equal(bot.hasCourtesyGreetingContext(bot.conversation(phone)), false);
  }
});

test('contexto curto é limitado, estruturado e não guarda transcrição bruta de áudio', () => {
  const phone = '5533977777935';
  const conv = bot.conversation(phone);

  bot.rememberShortConversationTurn(conv, 'oi boa noite');
  bot.rememberShortConversationTurn(conv, 'tô bem');
  bot.rememberShortConversationTurn(conv, 'quero uma tv');
  bot.rememberShortConversationTurn(conv, 'a primeira');
  bot.rememberShortConversationTurn(conv, 'e no cartão?');
  bot.rememberShortConversationTurn(conv, 'não, a outra');
  bot.rememberShortConversationTurn(
    conv,
    'não deu pra mandar no PIX, é o dinheiro da prestação',
    { source: 'audio' }
  );

  const turns = bot.recentShortConversationTurns(conv);
  assert.equal(turns.length, 6);
  assert.equal(turns.at(-1).source, 'audio');
  assert.equal(turns.at(-1).kind, 'finance');
  assert.equal(turns.at(-1).paymentMethod, 'pix');
  assert.equal(turns.at(-1).excerpt, '');
  assert.equal(turns.some((turn) => /dinheiro da prestação/i.test(turn.excerpt || '')), false);

  const semanticContext = bot.intentConversationContext(conv, { excludeLatest: true });
  assert.equal(semanticContext.recentTurns.length, 5);
  assert.equal(
    semanticContext.recentTurns.some((turn) => turn.reference === 'other'),
    true
  );
});

test('conversa longa mantém continuidade entre saudação, áudio, produto, troca de opção e pagamentos', async () => {
  const phone = '5533977777934';

  catalogRows = [
    product('tv-long-1', 'Smart TV 50 LG 4K', {
      category: 'TV',
      pixPrice: 1999,
      cardPrice: 2400,
      stock: 3
    }),
    product('tv-long-2', 'Smart TV 50 Samsung Crystal', {
      category: 'TV',
      pixPrice: 2199,
      cardPrice: 2640,
      stock: 2
    })
  ];

  await bot.handleMessage({
    phone,
    text: 'oi boa noite',
    pushName: 'Cliente Longo'
  });
  assert.match(sentTexts.at(-1).text, /^Boa noite! 😊 Tudo bem\?/i);

  await bot.handleMessage({
    phone,
    text: 'beleza e você?',
    pushName: 'Cliente Longo'
  });
  assert.match(sentTexts.at(-1).text, /Por aqui tá tudo ótimo também/i);

  audioTranscriptionText = 'Quero olhar uma TV de 50 polegadas';
  mediaBase64Response = {
    mimetype: 'audio/ogg; codecs=opus',
    base64: 'T2dnUwBmYWtlLWF1ZGlvLWxvbmc='
  };

  const audioResult = await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: {
        remoteJid: phone + '@s.whatsapp.net',
        fromMe: false,
        id: 'AUDIO-LONG-DIALOG-1'
      },
      pushName: 'Cliente Longo',
      message: {
        audioMessage: {
          mimetype: 'audio/ogg; codecs=opus',
          seconds: 8,
          ptt: true
        }
      }
    }
  });

  assert.equal(audioResult.audio, 'audio_transcribed');
  assert.equal(bot.conversation(phone).lastProducts.length, 2);

  await bot.handleMessage({ phone, text: 'a primeira', pushName: 'Cliente Longo' });
  assert.match(sentTexts.at(-1).text, /Smart TV 50 LG 4K/i);

  await bot.handleMessage({ phone, text: 'quanto fica no pix?', pushName: 'Cliente Longo' });
  assert.match(sentTexts.at(-1).text, /Smart TV 50 LG 4K/i);
  assert.match(sentTexts.at(-1).text, /1\.999,00/i);

  await bot.handleMessage({ phone, text: 'e no cartão?', pushName: 'Cliente Longo' });
  assert.match(sentTexts.at(-1).text, /Smart TV 50 LG 4K/i);

  await bot.handleMessage({ phone, text: 'não, a outra', pushName: 'Cliente Longo' });
  assert.match(sentTexts.at(-1).text, /outra opção/i);
  assert.match(sentTexts.at(-1).text, /Smart TV 50 Samsung Crystal/i);
  assert.equal(bot.conversation(phone).selectedProduct.name, 'Smart TV 50 Samsung Crystal');

  await bot.handleMessage({ phone, text: 'e no cartão?', pushName: 'Cliente Longo' });
  assert.match(sentTexts.at(-1).text, /Smart TV 50 Samsung Crystal/i);

  await bot.handleMessage({ phone, text: 'e no boleto?', pushName: 'Cliente Longo' });
  assert.match(sentTexts.at(-1).text, /Em quantas vezes/i);

  await bot.handleMessage({ phone, text: '10x', pushName: 'Cliente Longo' });
  assert.match(sentTexts.at(-1).text, /Smart TV 50 Samsung Crystal/i);
  assert.match(sentTexts.at(-1).text, /10x/i);

  const mediaBefore = sentMedia.length;
  await bot.handleMessage({ phone, text: 'manda foto dela pra eu ver', pushName: 'Cliente Longo' });
  assert.equal(sentMedia.length, mediaBefore + 1);
  assert.match(sentMedia.at(-1).caption || '', /Smart TV 50 Samsung Crystal/i);

  await bot.handleMessage({ phone, text: 'vou pensar', pushName: 'Cliente Longo' });
  assert.match(sentTexts.at(-1).text, /continuo com você de onde paramos/i);

  await bot.handleMessage({ phone, text: 'oi', pushName: 'Cliente Longo' });
  assert.match(sentTexts.at(-1).text, /Tudo bem\?/i);

  await bot.handleMessage({ phone, text: 'tô bem', pushName: 'Cliente Longo' });
  assert.match(sentTexts.at(-1).text, /O que você tá precisando pra hoje/i);

  await bot.handleMessage({ phone, text: 'aquele que eu vi', pushName: 'Cliente Longo' });
  assert.match(sentTexts.at(-1).text, /Smart TV 50 Samsung Crystal/i);

  await bot.handleMessage({ phone, text: 'e no pix?', pushName: 'Cliente Longo' });
  assert.match(sentTexts.at(-1).text, /Smart TV 50 Samsung Crystal/i);
  assert.match(sentTexts.at(-1).text, /2\.199,00/i);

  assert.equal(
    sentTexts.some((item) => /me conta um pouco mais do produto ou da condição/i.test(item.text || '')),
    false,
    'conversa longa não deve perder contexto e cair no fallback genérico'
  );
  assert.ok(bot.recentShortConversationTurns(bot.conversation(phone)).length <= 6);
});

test('correção natural de pagamento respeita a intenção final sem capturar aviso financeiro', async () => {
  assert.equal(
    bot.correctedPaymentMethod('não, no PIX não, eu quis dizer no cartão'),
    'card'
  );
  assert.equal(
    bot.correctedPaymentMethod('não, no cartão não, quero no PIX'),
    'pix'
  );
  assert.equal(
    bot.correctedPaymentMethod('na verdade no carnê'),
    'credit'
  );
  assert.equal(
    bot.correctedPaymentMethod('não deu pra mandar no PIX, é o dinheiro da prestação'),
    '',
    'aviso financeiro real não pode virar correção comercial de pagamento'
  );

  const phone = '5533977777933';
  const chosen = bot.compactProduct(product('tv-correction-1', 'Smart TV 55 Samsung 4K', {
    category: 'TV',
    pixPrice: 2499,
    cardPrice: 3012,
    stock: 3
  }));

  bot.patchTestConversation(phone, {
    selectedProduct: chosen,
    lastProducts: [chosen],
    allProductResults: [chosen],
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'não, no PIX não, eu quis dizer no cartão',
    pushName: 'Marina Cliente'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /quis dizer no cartão/i);
  assert.match(sentTexts[0].text, /Smart TV 55 Samsung 4K/i);
  assert.doesNotMatch(sentTexts[0].text, /No PIX/i);
  assert.doesNotMatch(sentTexts[0].text, /me conta um pouco mais/i);
});

test('áudio com autocorreção de forma de pagamento preserva negação e usa a última escolha', async () => {
  const phone = '5533977777932';
  const chosen = bot.compactProduct(product('tv-audio-correction-1', 'Smart TV 50 LG NanoCell', {
    category: 'TV',
    pixPrice: 2299,
    cardPrice: 2760,
    stock: 2
  }));

  bot.patchTestConversation(phone, {
    selectedProduct: chosen,
    lastProducts: [chosen],
    allProductResults: [chosen],
    lastIntent: 'produto'
  });

  audioTranscriptionText = 'Não, no PIX não. Eu quis dizer no cartão.';
  mediaBase64Response = {
    mimetype: 'audio/ogg; codecs=opus',
    base64: 'T2dnUwBmYWtlLWF1ZGlvLWNvcnJlY2Fv'
  };

  const result = await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: {
        remoteJid: phone + '@s.whatsapp.net',
        fromMe: false,
        id: 'AUDIO-PAYMENT-CORRECTION-1'
      },
      pushName: 'Marina Cliente',
      message: {
        audioMessage: {
          mimetype: 'audio/ogg; codecs=opus',
          seconds: 7,
          ptt: true
        }
      }
    }
  });

  assert.equal(result.audio, 'audio_transcribed');
  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /quis dizer no cartão/i);
  assert.match(sentTexts[0].text, /Smart TV 50 LG NanoCell/i);
  assert.doesNotMatch(sentTexts[0].text, /No PIX/i);

  const turns = bot.recentShortConversationTurns(bot.conversation(phone));
  assert.equal(turns.at(-1).source, 'audio');
  assert.equal(turns.at(-1).excerpt, '');
});

test('segundo diálogo longo entende correções, troca de produto e confirmação sem perder contexto', async () => {
  const phone = '5533977777931';

  catalogRows = [
    product('fridge-long-1', 'Geladeira Consul 340L Frost Free', {
      category: 'Geladeira',
      pixPrice: 2799,
      cardPrice: 3372,
      stock: 3
    }),
    product('fridge-long-2', 'Geladeira Electrolux 400L Inverter', {
      category: 'Geladeira',
      pixPrice: 3199,
      cardPrice: 3852,
      stock: 2
    })
  ];

  await bot.handleMessage({ phone, text: 'boa tarde', pushName: 'Marina Souza' });
  assert.match(sentTexts.at(-1).text, /^Boa tarde, Marina! 😊 Tudo bem\?/i);

  await bot.handleMessage({ phone, text: 'tudo ótimo e você?', pushName: 'Marina Souza' });
  assert.match(sentTexts.at(-1).text, /Por aqui tá tudo ótimo também/i);

  await bot.handleMessage({ phone, text: 'quero ver geladeira', pushName: 'Marina Souza' });
  assert.equal(bot.conversation(phone).lastProducts.length, 2);

  await bot.handleMessage({ phone, text: 'a segunda', pushName: 'Marina Souza' });
  assert.match(sentTexts.at(-1).text, /Geladeira Electrolux 400L Inverter/i);

  await bot.handleMessage({ phone, text: 'quanto fica no cartão?', pushName: 'Marina Souza' });
  assert.match(sentTexts.at(-1).text, /Geladeira Electrolux 400L Inverter/i);

  await bot.handleMessage({
    phone,
    text: 'não, no cartão não, quis dizer no pix',
    pushName: 'Marina Souza'
  });
  assert.match(sentTexts.at(-1).text, /quis dizer no PIX/i);
  assert.match(sentTexts.at(-1).text, /Geladeira Electrolux 400L Inverter/i);
  assert.match(sentTexts.at(-1).text, /3\.199,00/i);

  const mediaBefore = sentMedia.length;
  await bot.handleMessage({ phone, text: 'manda foto dela pra eu ver', pushName: 'Marina Souza' });
  assert.equal(sentMedia.length, mediaBefore + 1);
  assert.match(sentMedia.at(-1).caption || '', /Geladeira Electrolux 400L Inverter/i);

  await bot.handleMessage({ phone, text: 'não era essa, era a outra', pushName: 'Marina Souza' });
  assert.match(sentTexts.at(-1).text, /outra opção/i);
  assert.match(sentTexts.at(-1).text, /Geladeira Consul 340L Frost Free/i);
  assert.equal(bot.conversation(phone).selectedProduct.name, 'Geladeira Consul 340L Frost Free');

  await bot.handleMessage({ phone, text: 'é esse mesmo', pushName: 'Marina Souza' });
  assert.match(sentTexts.at(-1).text, /Então seguimos com/i);
  assert.match(sentTexts.at(-1).text, /Geladeira Consul 340L Frost Free/i);

  await bot.handleMessage({ phone, text: 'e no cartão?', pushName: 'Marina Souza' });
  assert.match(sentTexts.at(-1).text, /Geladeira Consul 340L Frost Free/i);

  await bot.handleMessage({ phone, text: 'vou pensar', pushName: 'Marina Souza' });
  assert.match(sentTexts.at(-1).text, /continuo com você de onde paramos/i);

  await bot.handleMessage({ phone, text: 'oi', pushName: 'Marina Souza' });
  assert.match(sentTexts.at(-1).text, /Tudo bem\?/i);

  await bot.handleMessage({ phone, text: 'tô indo', pushName: 'Marina Souza' });
  assert.match(sentTexts.at(-1).text, /O que você tá precisando pra hoje/i);
  assert.doesNotMatch(sentTexts.at(-1).text, /Ah, que bom/i);

  await bot.handleMessage({ phone, text: 'aquele que eu vi', pushName: 'Marina Souza' });
  assert.match(sentTexts.at(-1).text, /Geladeira Consul 340L Frost Free/i);

  await bot.handleMessage({ phone, text: 'na verdade no pix', pushName: 'Marina Souza' });
  assert.match(sentTexts.at(-1).text, /quis dizer no PIX/i);
  assert.match(sentTexts.at(-1).text, /Geladeira Consul 340L Frost Free/i);
  assert.match(sentTexts.at(-1).text, /2\.799,00/i);

  assert.equal(
    sentTexts.some((item) => /me conta um pouco mais do produto ou da condição/i.test(item.text || '')),
    false,
    'diálogo com correções naturais não deve cair no fallback comercial genérico'
  );
  assert.ok(bot.recentShortConversationTurns(bot.conversation(phone)).length <= 6);
});

test('mensagem com cartão e entrega responde as duas intenções sem perder o produto', async () => {
  const phone = '5533977777930';
  const first = bot.compactProduct(product('multi-tv-1', 'Smart TV 50 LG UHD', {
    category: 'TV',
    pixPrice: 1999,
    cardPrice: 2400,
    stock: 3
  }));
  const second = bot.compactProduct(product('multi-tv-2', 'Smart TV 55 Samsung Crystal', {
    category: 'TV',
    pixPrice: 2499,
    cardPrice: 3000,
    stock: 2
  }));

  bot.patchTestConversation(phone, {
    selectedProduct: null,
    lastProducts: [first, second],
    allProductResults: [first, second],
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'gostei da segunda, quanto fica no cartão e entrega aqui em Guanhães?',
    pushName: 'Marina Souza'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /Smart TV 55 Samsung Crystal/i);
  assert.match(sentTexts[0].text, /No cartão/i);
  assert.match(sentTexts[0].text, /Entrega:/i);
  assert.match(sentTexts[0].text, /24 horas/i);
  assert.doesNotMatch(sentTexts[0].text, /me conta um pouco mais/i);
  assert.equal(bot.conversation(phone).selectedProduct.id, 'multi-tv-2');
  assert.equal(backendEvents.at(-1).metadata.multiIntent, true);
  assert.equal(backendEvents.at(-1).metadata.askedDelivery, true);

  const sensitivePlan = bot.commercialMultiIntentPlan(
    'não deu pra mandar no PIX, é o dinheiro da prestação e deixei aí',
    bot.conversation(phone)
  );
  assert.equal(sensitivePlan, null);
});

test('compra com PIX e pedido de foto responde tudo sem perguntar forma de pagamento de novo', async () => {
  const phone = '5533977777929';
  const chosen = bot.compactProduct(product('multi-fridge-1', 'Geladeira Electrolux 400L Inverter', {
    category: 'Geladeira',
    pixPrice: 3199,
    cardPrice: 3852,
    stock: 2
  }));

  bot.patchTestConversation(phone, {
    selectedProduct: chosen,
    lastProducts: [chosen],
    allProductResults: [chosen],
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'quero essa no PIX e manda a foto também',
    pushName: 'Marina Souza'
  });

  assert.equal(sentMedia.length, 1);
  assert.equal(sentTexts.length, 0);
  assert.match(sentMedia[0].caption, /Geladeira Electrolux 400L Inverter/i);
  assert.match(sentMedia[0].caption, /No PIX/i);
  assert.match(sentMedia[0].caption, /3\.199,00/i);
  assert.match(sentMedia[0].caption, /continuar a compra/i);
  assert.doesNotMatch(sentMedia[0].caption, /prefere pagar no/i);
  assert.equal(backendEvents.at(-1).metadata.multiIntent, true);
  assert.equal(backendEvents.at(-1).metadata.purchaseIntent, true);
  assert.equal(backendEvents.at(-1).metadata.paymentMode, 'pix');
});

test('áudio com produto, cartão e entrega responde todas as partes na mesma continuação', async () => {
  const phone = '5533977777928';
  const first = bot.compactProduct(product('multi-audio-1', 'Smart TV 43 LG Full HD', {
    category: 'TV',
    pixPrice: 1699,
    cardPrice: 2040,
    stock: 4
  }));
  const second = bot.compactProduct(product('multi-audio-2', 'Smart TV 50 Philips 4K', {
    category: 'TV',
    pixPrice: 1899,
    cardPrice: 2280,
    stock: 3
  }));

  bot.patchTestConversation(phone, {
    selectedProduct: null,
    lastProducts: [first, second],
    allProductResults: [first, second],
    lastIntent: 'produto'
  });

  audioTranscriptionText = 'Gostei da primeira. Quanto fica no cartão e vocês entregam em Guanhães?';
  mediaBase64Response = {
    mimetype: 'audio/ogg; codecs=opus',
    base64: 'T2dnUwBmYWtlLWF1ZGlvLW11bHRp'
  };

  const result = await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: {
        remoteJid: phone + '@s.whatsapp.net',
        fromMe: false,
        id: 'AUDIO-MULTI-INTENT-1'
      },
      pushName: 'Marina Souza',
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
  assert.match(sentTexts[0].text, /Smart TV 43 LG Full HD/i);
  assert.match(sentTexts[0].text, /No cartão/i);
  assert.match(sentTexts[0].text, /Entrega:/i);
  assert.doesNotMatch(sentTexts[0].text, /me conta um pouco mais/i);
  assert.equal(bot.conversation(phone).selectedProduct.id, 'multi-audio-1');

  const turns = bot.recentShortConversationTurns(bot.conversation(phone));
  assert.equal(turns.at(-1).source, 'audio');
  assert.equal(turns.at(-1).excerpt, '');
});

test('"a outra" não usa lista velha de outra categoria depois de retomar produto lembrado', () => {
  const phone = '5533977777927';

  const tv1 = bot.compactProduct(product('cross-tv-1', 'Smart TV 50 LG 4K', {
    category: 'TV',
    pixPrice: 1999,
    cardPrice: 2400
  }));
  const tv2 = bot.compactProduct(product('cross-tv-2', 'Smart TV 55 Samsung Crystal', {
    category: 'TV',
    pixPrice: 2499,
    cardPrice: 3000
  }));
  const fridge1 = bot.compactProduct(product('cross-fridge-1', 'Geladeira Consul 340L', {
    category: 'Geladeira',
    pixPrice: 2799,
    cardPrice: 3372
  }));
  const fridge2 = bot.compactProduct(product('cross-fridge-2', 'Geladeira Electrolux 400L', {
    category: 'Geladeira',
    pixPrice: 3199,
    cardPrice: 3852
  }));

  const conv = bot.conversation(phone);
  bot.patchTestConversation(phone, {
    selectedProduct: tv2,
    lastProducts: [fridge1, fridge2],
    allProductResults: [fridge1, fridge2],
    lastIntent: 'produto'
  });

  bot.patchTestCommercialProfile(phone, {
    lastProduct: tv2,
    lastProductAt: Date.now(),
    lastCategory: 'TV',
    lastCategoryAt: Date.now(),
    lastCommercialAt: Date.now(),
    salesStage: 'considering',
    salesStageAt: Date.now(),
    interests: [
      { product: tv2, category: 'TV', at: Date.now(), source: 'resume' },
      { product: fridge1, category: 'Geladeira', at: Date.now() - 1000, source: 'browse' },
      { product: tv1, category: 'TV', at: Date.now() - 2000, source: 'older_tv' }
    ]
  });

  assert.equal(bot.immediateAlternativeProduct(bot.conversation(phone), 'a outra'), null);

  const remembered = bot.resolveRememberedProductReference(
    phone,
    'a outra',
    bot.conversation(phone)
  );

  assert.equal(remembered?.id, 'cross-tv-1');
  assert.notEqual(remembered?.id, 'cross-fridge-1');
});

test('teste de estresse mantém contexto após troca de categoria, financeiro e retomada', async () => {
  const phone = '5533977777926';

  catalogRows = [
    product('stress-tv-1', 'Smart TV 50 LG 4K', {
      category: 'TV',
      pixPrice: 1999,
      cardPrice: 2400,
      stock: 3
    }),
    product('stress-tv-2', 'Smart TV 55 Samsung Crystal', {
      category: 'TV',
      pixPrice: 2499,
      cardPrice: 3000,
      stock: 2
    }),
    product('stress-fridge-1', 'Geladeira Consul 340L Frost Free', {
      category: 'Geladeira',
      pixPrice: 2799,
      cardPrice: 3372,
      stock: 3
    }),
    product('stress-fridge-2', 'Geladeira Electrolux 400L Inverter', {
      category: 'Geladeira',
      pixPrice: 3199,
      cardPrice: 3852,
      stock: 2
    })
  ];

  financeResponse = {
    ok: true,
    fonteFinanceira: 'ariana_erp_financeiro_cobrancas',
    cliente: { nome: 'Marina Souza' },
    parcelas: [
      {
        status: 'aberta',
        quitado: false,
        dataVencimento: '2026-09-25',
        valorParcela: 180,
        saldoParcela: 180,
        atualizacaoFinanceira: { diasAtraso: 0, valorAtualizado: 180 }
      }
    ]
  };

  await bot.handleMessage({ phone, text: 'boa noite', pushName: 'Marina Souza' });
  assert.match(sentTexts.at(-1).text, /^Boa noite, Marina!/i);

  await bot.handleMessage({ phone, text: 'beleza e você?', pushName: 'Marina Souza' });
  assert.match(sentTexts.at(-1).text, /Por aqui tá tudo ótimo também/i);

  await bot.handleMessage({ phone, text: 'quero ver tv', pushName: 'Marina Souza' });
  assert.equal(bot.conversation(phone).lastProducts.length, 2);

  await bot.handleMessage({ phone, text: 'a primeira', pushName: 'Marina Souza' });
  assert.match(sentTexts.at(-1).text, /Smart TV 50 LG 4K/i);

  await bot.handleMessage({ phone, text: 'e no pix?', pushName: 'Marina Souza' });
  assert.match(sentTexts.at(-1).text, /1\.999,00/i);

  await bot.handleMessage({ phone, text: 'e no cartão?', pushName: 'Marina Souza' });
  assert.match(sentTexts.at(-1).text, /Smart TV 50 LG 4K/i);

  await bot.handleMessage({ phone, text: 'não, a outra', pushName: 'Marina Souza' });
  assert.match(sentTexts.at(-1).text, /Smart TV 55 Samsung Crystal/i);

  const tvMediaBefore = sentMedia.length;
  await bot.handleMessage({ phone, text: 'manda foto dela pra eu ver', pushName: 'Marina Souza' });
  assert.equal(sentMedia.length, tvMediaBefore + 1);
  assert.match(sentMedia.at(-1).caption || '', /Smart TV 55 Samsung Crystal/i);

  await bot.handleMessage({ phone, text: 'vou pensar', pushName: 'Marina Souza' });
  assert.match(sentTexts.at(-1).text, /de onde paramos/i);

  await bot.handleMessage({ phone, text: 'agora quero ver geladeira', pushName: 'Marina Souza' });
  assert.equal(bot.conversation(phone).lastProducts.length, 2);
  assert.match(bot.conversation(phone).lastProducts[0].name, /Geladeira/i);

  await bot.handleMessage({ phone, text: 'a primeira', pushName: 'Marina Souza' });
  assert.match(sentTexts.at(-1).text, /Geladeira Consul 340L Frost Free/i);

  await bot.handleMessage({ phone, text: 'e no cartão?', pushName: 'Marina Souza' });
  assert.match(sentTexts.at(-1).text, /Geladeira Consul 340L Frost Free/i);

  await bot.handleMessage({ phone, text: 'entrega aqui em Guanhães?', pushName: 'Marina Souza' });
  assert.match(sentTexts.at(-1).text, /24 horas/i);

  await bot.handleMessage({
    phone,
    text: 'quanto que eu tenho que pagar da minha prestação?',
    pushName: 'Marina Souza'
  });
  assert.match(sentTexts.at(-1).text, /Marina/i);
  assert.doesNotMatch(sentTexts.at(-1).text, /Geladeira Consul/i);

  await bot.handleMessage({ phone, text: 'e aquela tv que eu vi?', pushName: 'Marina Souza' });
  assert.match(sentTexts.at(-1).text, /Smart TV 55 Samsung Crystal/i);
  assert.equal(bot.conversation(phone).selectedProduct.id, 'stress-tv-2');

  await bot.handleMessage({ phone, text: 'a outra', pushName: 'Marina Souza' });
  assert.match(sentTexts.at(-1).text, /Smart TV 50 LG 4K/i);
  assert.doesNotMatch(sentTexts.at(-1).text, /Geladeira/i);
  assert.equal(bot.conversation(phone).selectedProduct.id, 'stress-tv-1');

  await bot.handleMessage({ phone, text: 'e no pix?', pushName: 'Marina Souza' });
  assert.match(sentTexts.at(-1).text, /Smart TV 50 LG 4K/i);
  assert.match(sentTexts.at(-1).text, /1\.999,00/i);

  const mediaBeforeReturn = sentMedia.length;
  await bot.handleMessage({ phone, text: 'manda foto dela', pushName: 'Marina Souza' });
  assert.equal(sentMedia.length, mediaBeforeReturn + 1);
  assert.match(sentMedia.at(-1).caption || '', /Smart TV 50 LG 4K/i);

  await bot.handleMessage({ phone, text: 'vou pensar', pushName: 'Marina Souza' });
  assert.match(sentTexts.at(-1).text, /de onde paramos/i);

  await bot.handleMessage({ phone, text: 'oi', pushName: 'Marina Souza' });
  assert.match(sentTexts.at(-1).text, /Tudo bem\?/i);

  await bot.handleMessage({ phone, text: 'tô indo', pushName: 'Marina Souza' });
  assert.match(sentTexts.at(-1).text, /O que você tá precisando pra hoje/i);

  await bot.handleMessage({ phone, text: 'aquele que eu vi', pushName: 'Marina Souza' });
  assert.match(sentTexts.at(-1).text, /Smart TV 50 LG 4K/i);

  await bot.handleMessage({ phone, text: 'e no cartão?', pushName: 'Marina Souza' });
  assert.match(sentTexts.at(-1).text, /Smart TV 50 LG 4K/i);

  assert.equal(
    sentTexts.some((item) => /me conta um pouco mais do produto ou da condição/i.test(item.text || '')),
    false,
    'teste de estresse não deve cair no fallback comercial genérico'
  );
  assert.ok(bot.recentShortConversationTurns(bot.conversation(phone)).length <= 6);
});

test('resposta neutra à pergunta de cortesia usa acolhimento curto sem "Ah, que bom"', async () => {
  const replies = [
    'mais ou menos',
    'tô indo',
    'vou levando',
    'não muito bem',
    'estou indo',
    'tô levando',
    'mais ou menos, né',
    'podia estar melhor',
    'já estive melhor',
    'levando a vida'
  ];

  for (let i = 0; i < replies.length; i += 1) {
    const phone = '553397777794' + String(i);

    sentTexts = [];
    await bot.handleMessage({
      phone,
      text: 'Boa tarde',
      pushName: 'Cliente Teste'
    });

    assert.equal(sentTexts.length, 1);
    assert.match(sentTexts[0].text, /Tudo bem\?/i);
    assert.equal(bot.hasCourtesyGreetingContext(bot.conversation(phone)), true);

    sentTexts = [];
    await bot.handleMessage({
      phone,
      text: replies[i],
      pushName: 'Cliente Teste'
    });

    assert.equal(bot.isNonPositiveWellbeingReply(replies[i]), true, replies[i]);
    assert.equal(bot.isClearlyNegativeWellbeingReply(replies[i]), false, replies[i]);
    assert.equal(sentTexts.length, 1);
    assert.match(sentTexts[0].text, /^Entendi 😊/i);
    assert.match(sentTexts[0].text, /O que você tá precisando pra hoje\?/i);
    assert.doesNotMatch(sentTexts[0].text, /Ah, que bom|Espero que melhore/i);
    assert.equal(bot.hasCourtesyGreetingContext(bot.conversation(phone)), false);
  }
});

test('resposta claramente negativa à pergunta de cortesia deseja melhora sem fazer interrogatório', async () => {
  const replies = [
    'tô mal',
    'não tô bem',
    'passando mal',
    'estou mal',
    'tô meio ruim',
    'hoje não tô legal'
  ];

  for (let i = 0; i < replies.length; i += 1) {
    const phone = '553397777796' + String(i);

    sentTexts = [];
    await bot.handleMessage({
      phone,
      text: 'Boa noite',
      pushName: 'Cliente Teste'
    });

    assert.equal(bot.hasCourtesyGreetingContext(bot.conversation(phone)), true);

    sentTexts = [];
    await bot.handleMessage({
      phone,
      text: replies[i],
      pushName: 'Cliente Teste'
    });

    assert.equal(bot.isClearlyNegativeWellbeingReply(replies[i]), true, replies[i]);
    assert.equal(bot.isNonPositiveWellbeingReply(replies[i]), true, replies[i]);
    assert.equal(sentTexts.length, 1);
    assert.match(sentTexts[0].text, /^Poxa, entendi\. Espero que melhore 😊/i);
    assert.match(sentTexts[0].text, /O que você tá precisando pra hoje\?/i);
    assert.doesNotMatch(sentTexts[0].text, /Ah, que bom/i);
    assert.equal(bot.hasCourtesyGreetingContext(bot.conversation(phone)), false);
  }
});

test('bem-estar junto com pedido de geladeira encerra cortesia e segue direto para vendas', async () => {
  const phone = '5533977777970';
  catalogRows = [
    product('courtesy-fridge-1', 'Geladeira Consul 340L', {
      category: 'Geladeira',
      pixPrice: 1899,
      cardPrice: 2287
    })
  ];

  await bot.handleMessage({
    phone,
    text: 'Boa tarde',
    pushName: 'Cliente Teste'
  });

  assert.equal(bot.hasCourtesyGreetingContext(bot.conversation(phone)), true);

  sentTexts = [];
  sentMedia = [];

  await bot.handleMessage({
    phone,
    text: 'mais ou menos, tô precisando de uma geladeira',
    pushName: 'Cliente Teste'
  });

  assert.equal(bot.hasCourtesyGreetingContext(bot.conversation(phone)), false);
  assert.ok(sentTexts.some((item) => /^Entendi 😊/i.test(item.text || '')));
  assert.ok(sentTexts.every((item) => !/O que você tá precisando pra hoje\?/i.test(item.text || '')));
  assert.equal(sentMedia.length, 1);
  assert.match(sentMedia[0].caption || '', /Geladeira Consul 340L/i);
  assert.equal(bot.conversation(phone).lastIntent, 'produto');
});

test('"bom dia Marcelo tudo bem?" é cortesia, mas "Oi Marcelo" continua pedindo o Marcelo', async () => {
  const courtesyPhone = '5533977777935';

  assert.equal(bot.isCourtesyGreeting('Bom dia Marcelo tudo bem?'), true);
  assert.equal(bot.asksMarceloOrCallback('Bom dia Marcelo tudo bem?'), false);

  await bot.handleMessage({
    phone: courtesyPhone,
    text: 'Bom dia Marcelo tudo bem?',
    pushName: 'Carlos Cliente'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /^Bom dia, Carlos! 😊 Tudo ótimo por aqui\. E você\?/i);
  assert.equal(bot.conversation(courtesyPhone).marceloCallbackRequested, false);

  sentTexts = [];
  backendEvents = [];

  const marceloPhone = '5533977777936';
  assert.equal(bot.asksMarceloOrCallback('Oi Marcelo'), true);

  await bot.handleMessage({
    phone: marceloPhone,
    text: 'Oi Marcelo',
    pushName: 'Carlos Cliente'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /Marcelo está em outro atendimento/i);
  assert.equal(bot.conversation(marceloPhone).marceloCallbackRequested, true);
});

test('saudação com assunto comercial junto não cria etapa de cortesia antes do catálogo', async () => {
  const phone = '5533977777937';
  catalogRows = [
    product('greet-direct-tv-1', 'Smart TV Samsung 50', {
      category: 'TV',
      brand: 'Samsung'
    })
  ];

  await bot.handleMessage({
    phone,
    text: 'Bom dia, vocês têm TV?',
    pushName: 'Ana Cliente'
  });

  assert.ok(sentTexts.length >= 2);
  assert.match(sentTexts[0].text, /^Bom dia, Ana! 😊/i);
  assert.doesNotMatch(sentTexts[0].text, /Tudo ótimo, e você/i);
  assert.equal(bot.hasCourtesyGreetingContext(bot.conversation(phone)), false);
  assert.equal(sentMedia.length, 1);
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

test('geladeira não mistura freezer, frigobar nem outras categorias', () => {
  assert.equal(bot.matchesRequestedProductType(product('1', 'Geladeira Frost Free 400L'), 'geladeira'), true);
  assert.equal(bot.matchesRequestedProductType(product('1b', 'Refrigerador Consul 451L'), 'geladeira'), true);
  assert.equal(bot.matchesRequestedProductType(product('2', 'Freezer Horizontal 300L'), 'geladeira'), false);
  assert.equal(bot.matchesRequestedProductType(product('3', 'Frigobar 90L'), 'geladeira'), false);
  assert.equal(
    bot.matchesRequestedProductType(product('4', 'Smart TV 55 Samsung Crystal', { category: 'TV' }), 'geladeira'),
    false
  );
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

test('cálculo do crediário segue a regra comercial fixa 0,85 / 0,65 / 0,62 até 15x', () => {
  const p2000 = product('c1', 'Produto 2000', { price: 2000, pixPrice: 2000 });

  const p4 = bot.creditPlan(p2000, 4);
  assert.equal(p4.divisor, 0.85);
  assert.equal(p4.total, 2352.94);
  assert.equal(p4.installment, 588.24);
  assert.equal(p4.max, 15);

  const p5 = bot.creditPlan(p2000, 5);
  assert.equal(p5.divisor, 0.65);
  assert.equal(p5.total, 3076.92);
  assert.equal(p5.installment, 615.38);

  const p10 = bot.creditPlan(p2000, 10);
  assert.equal(p10.divisor, 0.65);
  assert.equal(p10.total, 3076.92);
  assert.equal(p10.installment, 307.69);

  const p11 = bot.creditPlan(p2000, 11);
  assert.equal(p11.divisor, 0.62);
  assert.equal(p11.total, 3225.81);
  assert.equal(p11.installment, 293.26);

  const p15 = bot.creditPlan(p2000, 15);
  assert.equal(p15.invalid, false);
  assert.equal(p15.divisor, 0.62);
  assert.equal(p15.total, 3225.81);
  assert.equal(p15.installment, 215.05);
  assert.equal(p15.max, 15);

  assert.equal(bot.creditPlan(p2000, 16).invalid, true);
});

test('Air Fryer de R$ 399 em 12x no crediário usa divisor 0,62 e não a regra antiga', () => {
  const airFryer = product('cred-air-399', 'Air Fryer Britânia 5,5L Gold BFR51 1500W', {
    price: 480.72,
    pixPrice: 399
  });

  const plan = bot.creditPlan(airFryer, 12);
  assert.equal(plan.divisor, 0.62);
  assert.equal(plan.total, 643.55);
  assert.equal(plan.installment, 53.63);
  assert.equal(plan.max, 15);
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


test('"e no pix?" continua no produto selecionado sem cair no fallback', async () => {
  const phone = '55339777777531';
  const chosen = bot.compactProduct(product('pix-short-1', 'Smart TV 50 Samsung Crystal', {
    category: 'TV',
    pixPrice: 2199,
    cardPrice: 2640,
    stock: 2
  }));

  bot.patchTestConversation(phone, {
    selectedProduct: chosen,
    lastProducts: [chosen],
    allProductResults: [chosen],
    lastIntent: 'produto'
  });

  assert.equal(bot.asksPixPrice('e no pix?'), true);

  await bot.handleMessage({
    phone,
    text: 'e no pix?',
    pushName: 'Cliente TV'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /Smart TV 50 Samsung Crystal/i);
  assert.match(sentTexts[0].text, /2\.199,00/i);
  assert.doesNotMatch(sentTexts[0].text, /me conta um pouco mais do produto ou da condição/i);
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

test('"qual você tem?" continua oferta de outros tamanhos após TV específica indisponível', async () => {
  const phone = '5533977777924';

  catalogRows = [
    product('alt-natural-tv-32', 'Smart TV 32 LG Full HD', { category: 'TVs' }),
    product('alt-natural-tv-43', 'Smart TV 43 Samsung 4K', { category: 'TVs' })
  ];

  const conv = bot.conversation(phone);
  await bot.showProducts(phone, conv, 'tv', 'vocês têm TV de 50 polegadas?');

  assert.equal(sentMedia.length, 0);
  assert.match(sentTexts.at(-1).text, /TV de 50 polegadas/i);
  assert.equal(bot.conversation(phone).pendingAlternativeCategory, 'tv');

  assert.equal(bot.asksAcceptedAlternative('qual você tem?'), true);
  assert.equal(bot.asksAcceptedAlternative('quais vc tem aí?'), true);

  sentTexts = [];
  sentMedia = [];

  await bot.handleMessage({
    phone,
    text: 'qual você tem?',
    pushName: 'Cliente TV'
  });

  assert.equal(sentMedia.length, 2);
  assert.match(sentMedia[0].caption || '', /Smart TV 32 LG Full HD/i);
  assert.match(sentMedia[1].caption || '', /Smart TV 43 Samsung 4K/i);
  assert.doesNotMatch(
    sentTexts.map((item) => item.text || '').join(' '),
    /me conta um pouco mais do produto ou da condição/i
  );
  assert.equal(bot.conversation(phone).pendingAlternativeCategory, '');
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
  assert.match(sentTexts[0].text, /até \*15x\*/);
  assert.match(sentTexts[0].text, /Em quantas vezes/i);
  assert.equal(bot.conversation(phone).selectedProduct.id, 'last-2');
});

test('"essa sai por quantos no prazo?" mantém o último produto mostrado e pergunta cartão ou crediário', async () => {
  const phone = '5533977777918';
  const first = bot.compactProduct(product('prazo-1', 'Geladeira Consul 300 Litros', {
    category: 'Geladeiras',
    pixPrice: 2499,
    cardPrice: 3010
  }));
  const last = bot.compactProduct(product('prazo-4', 'Geladeira HQ Defrost 230 Litros Branca HQ-230RDF BRANCO', {
    category: 'Geladeiras',
    pixPrice: 2197.40,
    cardPrice: 2647.40
  }));

  bot.patchTestConversation(phone, {
    lastProducts: [first, last],
    allProductResults: [first, last],
    lastProductQuery: 'geladeira',
    selectedProduct: null,
    lastIntent: 'produto'
  });

  assert.equal(bot.asksGenericInstallmentQuote('essa sai por quantos no prazo?'), true);
  assert.equal(bot.asksThisShownProduct('essa sai por quantos no prazo?'), true);

  await bot.handleMessage({
    phone,
    text: 'essa sai por quantos no prazo?',
    pushName: 'Cliente Prazo'
  });

  assert.equal(bot.conversation(phone).selectedProduct.id, last.id);
  assert.match(sentTexts.at(-1).text, /Geladeira HQ Defrost 230 Litros/i);
  assert.match(sentTexts.at(-1).text, /cartão.*crediário\/carnê/i);
  assert.equal(sentMedia.length, 0);
  assert.doesNotMatch(sentTexts.at(-1).text, /Me conta um pouco mais|Encontrei .*opções/i);
});

test('"essa geladeira aí que você mandou qual o valor da prestação dela" não refaz a busca do catálogo', async () => {
  const phone = '5533977777919';
  const first = bot.compactProduct(product('prestacao-1', 'Geladeira Consul 300 Litros', {
    category: 'Geladeiras',
    pixPrice: 2499,
    cardPrice: 3010
  }));
  const last = bot.compactProduct(product('prestacao-4', 'Geladeira HQ Defrost 230 Litros Branca HQ-230RDF BRANCO', {
    category: 'Geladeiras',
    pixPrice: 2197.40,
    cardPrice: 2647.40
  }));

  bot.patchTestConversation(phone, {
    lastProducts: [first, last],
    allProductResults: [first, last],
    lastProductQuery: 'geladeira',
    selectedProduct: null,
    lastIntent: 'produto'
  });

  assert.equal(
    bot.asksGenericInstallmentQuote('essa geladeira aí que voce mandou qual o valor da prestação dela'),
    true
  );
  assert.equal(
    bot.asksThisShownProduct('essa geladeira aí que voce mandou qual o valor da prestação dela'),
    true
  );

  await bot.handleMessage({
    phone,
    text: 'essa geladeira aí que voce mandou qual o valor da prestação dela',
    pushName: 'Cliente Prestação'
  });

  assert.equal(bot.conversation(phone).selectedProduct.id, last.id);
  assert.match(sentTexts.at(-1).text, /Geladeira HQ Defrost 230 Litros/i);
  assert.match(sentTexts.at(-1).text, /cartão.*crediário\/carnê/i);
  assert.equal(sentMedia.length, 0);
  assert.doesNotMatch(sentTexts.map((item) => item.text).join('\n'), /Encontrei 9 opções|Me conta um pouco mais/i);
});

test('"crediário lógico" continua a pergunta "cartão ou crediário" no mesmo produto e pede quantidade de parcelas', async () => {
  const phone = '5533977777920';
  const last = bot.compactProduct(product('credito-logico-1', 'Geladeira HQ Defrost 230 Litros Branca HQ-230RDF BRANCO', {
    category: 'Geladeiras',
    pixPrice: 2197.40,
    cardPrice: 2647.40
  }));

  bot.patchTestConversation(phone, {
    lastProducts: [last],
    allProductResults: [last],
    lastProductQuery: 'geladeira',
    selectedProduct: last,
    lastIntent: 'produto',
    pendingAction: 'installment_payment_method'
  });

  await bot.handleMessage({
    phone,
    text: 'crediario logico',
    pushName: 'Cliente Crediário'
  });

  assert.equal(bot.conversation(phone).selectedProduct.id, last.id);
  assert.equal(bot.conversation(phone).pendingAction, 'credit_installments');
  assert.match(sentTexts.at(-1).text, /Geladeira HQ Defrost 230 Litros/i);
  assert.match(sentTexts.at(-1).text, /crediário próprio em até \*?15x\*?/i);
  assert.match(sentTexts.at(-1).text, /Em quantas vezes/i);
  assert.doesNotMatch(sentTexts.at(-1).text, /Me conta um pouco mais|pegar certinho/i);
});

test('resposta "no cartão mesmo" após pergunta de parcelamento calcula o mesmo produto', async () => {
  const phone = '5533977777921';
  const last = bot.compactProduct(product('cartao-mesmo-1', 'Geladeira HQ Defrost 230 Litros Branca HQ-230RDF BRANCO', {
    category: 'Geladeiras',
    pixPrice: 2197.40,
    cardPrice: 2647.40,
    installmentCount: 12
  }));

  bot.patchTestConversation(phone, {
    lastProducts: [last],
    selectedProduct: last,
    lastIntent: 'produto',
    pendingAction: 'installment_payment_method'
  });

  await bot.handleMessage({
    phone,
    text: 'no cartão mesmo',
    pushName: 'Cliente Cartão'
  });

  assert.equal(bot.conversation(phone).selectedProduct.id, last.id);
  assert.equal(bot.conversation(phone).pendingAction, '');
  assert.match(sentTexts.at(-1).text, /Geladeira HQ Defrost 230 Litros/i);
  assert.match(sentTexts.at(-1).text, /12x de R\$\s*220,62/i);
  assert.match(sentTexts.at(-1).text, /total de \*?R\$\s*2\.647,40\*?/i);
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


test('"E de 15" após 48 minutos recalcula o mesmo crediário sem ressuscitar contexto comum', async () => {
  const phone = '5533977777743';
  const airFryer = bot.compactProduct(product('credit-followup-air-399', 'Fritadeira Elétrica Air Fryer Britânia 5,5L Gold BFR51 1500W', {
    category: 'Air Fryers',
    pixPrice: 399,
    price: 480.72,
    stock: 5
  }));

  bot.patchTestConversation(phone, {
    lastAt: Date.now() - 48 * 60 * 1000,
    selectedProduct: airFryer,
    lastProducts: [airFryer],
    allProductResults: [airFryer],
    lastProductQuery: 'air fryer',
    lastIntent: 'produto',
    lastCreditPlan: {
      productId: airFryer.id,
      product: airFryer,
      count: 12,
      divisor: 0.62,
      total: 643.55,
      installment: 53.63
    },
    creditContextUntil: Date.now() + 72 * 60 * 1000
  });

  assert.equal(bot.parseCreditPlanFollowupInstallments('E de 15'), 15);

  await bot.handleMessage({
    phone,
    text: 'E de 15',
    pushName: 'Cliente Follow-up'
  });

  const conv = bot.conversation(phone);
  assert.equal(conv.lastProducts.length, 0);
  assert.equal(conv.lastProductQuery, '');
  assert.equal(conv.selectedProduct.id, 'credit-followup-air-399');
  assert.equal(conv.lastCreditPlan.count, 15);
  assert.equal(conv.lastCreditPlan.divisor, 0.62);
  assert.equal(conv.lastCreditPlan.total, 643.55);
  assert.equal(conv.lastCreditPlan.installment, 42.9);
  assert.match(sentTexts.at(-1).text, /Fritadeira Elétrica Air Fryer Britânia 5,5L Gold BFR51 1500W/i);
  assert.match(sentTexts.at(-1).text, /15x de R\$\s*42,90/i);
  assert.match(sentTexts.at(-1).text, /total de \*?R\$\s*643,55/i);
  assert.doesNotMatch(sentTexts.at(-1).text, /Não consigo te ajudar com esse assunto|Marcelo chegar/i);
});

test('retomada curta do crediário entende variações naturais de quantidade', () => {
  assert.equal(bot.parseCreditPlanFollowupInstallments('e em 15?'), 15);
  assert.equal(bot.parseCreditPlanFollowupInstallments('15x'), 15);
  assert.equal(bot.parseCreditPlanFollowupInstallments('15 parcelas'), 15);
  assert.equal(bot.parseCreditPlanFollowupInstallments('e se eu fizer em 6?'), 6);
  assert.equal(bot.parseCreditPlanFollowupInstallments('quanto fica em 10?'), 10);
  assert.equal(bot.parseCreditPlanFollowupInstallments('air fryer de 15 litros'), 0);
  assert.equal(bot.parseCreditPlanFollowupInstallments('quero ver tv 15 polegadas'), 0);
});

test('plano de crediário expirado há mais de 2 horas não é retomado por "E de 15"', async () => {
  const phone = '5533977777744';
  const oldProduct = bot.compactProduct(product('credit-expired-product', 'Produto Antigo do Crediário', {
    category: 'Eletroportáteis',
    pixPrice: 399,
    price: 480.72,
    stock: 1
  }));

  bot.patchTestConversation(phone, {
    lastAt: Date.now() - 3 * 60 * 60 * 1000,
    selectedProduct: oldProduct,
    lastProducts: [oldProduct],
    lastIntent: 'produto',
    lastCreditPlan: {
      productId: oldProduct.id,
      product: oldProduct,
      count: 12,
      divisor: 0.62,
      total: 643.55,
      installment: 53.63
    },
    creditContextUntil: Date.now() - 1
  });

  await bot.handleMessage({
    phone,
    text: 'E de 15',
    pushName: 'Cliente Expirado'
  });

  const conv = bot.conversation(phone);
  assert.equal(conv.lastCreditPlan, null);
  assert.equal(conv.selectedProduct, null);
  assert.doesNotMatch(sentTexts.map((item) => item.text).join('\n'), /Produto Antigo do Crediário|15x de R\$\s*42,90/i);
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
  assert.match(sentTexts[0].text, /10x de R\$\s+107,69/);
  assert.match(sentTexts[0].text, /total de \*?R\$\s+1\.076,92/);
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
      divisor: 0.65,
      total: 1076.92,
      installment: 107.69
    }
  });

  await bot.handleMessage({
    phone,
    text: 'Valor da parcela no beto',
    pushName: 'Cliente Crediário'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /Guarda Roupa Teste/);
  assert.match(sentTexts[0].text, /10x de R\$\s+107,69/);
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
  assert.match(sentTexts[0].text, /^(?:Bom dia|Boa tarde|Boa noite)! 😊 Tudo bem\?/i);
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


test('novo produto explícito cancela pergunta comercial antiga de outra categoria', () => {
  const phone = '5533977777968';
  const tv = bot.compactProduct(product('tv-old-switch-1', 'Smart TV LG 43 polegadas', {
    category: 'TV',
    stock: 2
  }));

  bot.patchTestConversation(phone, {
    selectedProduct: tv,
    lastProducts: [tv],
    lastProductQuery: 'tv',
    pendingAction: 'installment_payment_method',
    lastIntent: 'produto'
  });

  const conv = bot.conversation(phone);

  assert.equal(
    bot.clearTransientCommercialPromptOnTopicSwitch(
      conv,
      'Boa tarde, queria ver o valor do seu fogão. Qual que você está tendo aí?'
    ),
    true
  );
  assert.equal(conv.pendingAction, '');
  assert.equal(conv.selectedProduct?.name, 'Smart TV LG 43 polegadas');

  conv.pendingAction = 'installment_payment_method';
  assert.equal(
    bot.clearTransientCommercialPromptOnTopicSwitch(conv, 'e no cartão dessa TV?'),
    false,
    'continuação da mesma categoria não deve perder o pending'
  );
  assert.equal(conv.pendingAction, 'installment_payment_method');

  conv.pendingAction = 'finance_cpf';
  assert.equal(
    bot.clearTransientCommercialPromptOnTopicSwitch(conv, 'quero ver fogão'),
    false,
    'pendência financeira sensível não deve ser apagada por esta regra'
  );
  assert.equal(conv.pendingAction, 'finance_cpf');
});

test('áudio realista sobre fogão não é sequestrado por pending antigo de TV', async () => {
  const phone = '5533977777969';
  const tv = bot.compactProduct(product('tv-old-audio-switch-1', 'Smart TV LG 43 polegadas', {
    category: 'TV',
    stock: 2
  }));

  catalogRows = [
    product('fog-audio-switch-1', 'Fogão Atlas 4 Bocas Branco', {
      category: 'Fogão',
      stock: 3,
      pixPrice: 899,
      cardPrice: 1080
    }),
    product('fog-audio-switch-2', 'Fogão Dako 5 Bocas Preto', {
      category: 'Fogão',
      stock: 2,
      pixPrice: 1299,
      cardPrice: 1560
    })
  ];

  bot.patchTestConversation(phone, {
    selectedProduct: tv,
    lastProducts: [tv],
    allProductResults: [tv],
    lastProductQuery: 'tv',
    pendingAction: 'installment_payment_method',
    lastIntent: 'produto'
  });

  audioTranscriptionText = 'Boa tarde, queria ver o valor do seu fogão. Qual que você está tendo aí?';
  mediaBase64Response = {
    mimetype: 'audio/ogg; codecs=opus',
    base64: 'T2dnUwBmYWtlLWF1ZGlvLWZvZ2FvLXN3aXRjaA=='
  };

  bot.patchTestIntentClassification({
    intent: 'BUSCAR_PRODUTO',
    confidence: 0.97,
    category: 'fogão',
    product_reference: '',
    product_ordinal: 0,
    installments: 0,
    payment_method: 'unknown',
    location_hint: ''
  });

  const result = await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: {
        remoteJid: phone + '@s.whatsapp.net',
        fromMe: false,
        id: 'AUDIO-TOPIC-SWITCH-TV-FOGAO-1'
      },
      pushName: 'Cliente Troca',
      message: {
        audioMessage: {
          mimetype: 'audio/ogg; codecs=opus',
          seconds: 7,
          ptt: true
        }
      }
    }
  });

  assert.equal(result.audio, 'audio_transcribed');
  assert.equal(bot.conversation(phone).pendingAction, '');
  assert.ok(
    sentMedia.some((item) => /Fogão (?:Atlas|Dako)/i.test(item.caption || '')),
    'deve mostrar fogões do catálogo'
  );
  assert.equal(
    sentTexts.some((item) => /Smart TV LG 43 polegadas.*cartão.*crediário/i.test(item.text || '')),
    false,
    'não deve repetir a pergunta antiga da TV'
  );
});

test('texto sobre nova categoria também supera pergunta comercial antiga', async () => {
  const phone = '5533977777970';
  const tv = bot.compactProduct(product('tv-old-text-switch-1', 'Smart TV LG 43 polegadas', {
    category: 'TV',
    stock: 2
  }));

  catalogRows = [
    product('fog-text-switch-1', 'Fogão Atlas 4 Bocas Branco', {
      category: 'Fogão',
      stock: 3
    })
  ];

  bot.patchTestConversation(phone, {
    selectedProduct: tv,
    lastProducts: [tv],
    allProductResults: [tv],
    lastProductQuery: 'tv',
    pendingAction: 'installment_payment_method',
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'agora eu quero olhar fogão',
    pushName: 'Cliente Troca'
  });

  assert.equal(bot.conversation(phone).pendingAction, '');
  assert.ok(
    sentMedia.some((item) => /Fogão Atlas 4 Bocas Branco/i.test(item.caption || ''))
  );
  assert.equal(
    sentTexts.some((item) => /Smart TV LG 43 polegadas.*cartão.*crediário/i.test(item.text || '')),
    false
  );
});

test('áudio usa confiança mais tolerante em intenção comum sem reduzir segurança sensível', () => {
  assert.ok(
    bot.intentConfidenceRequired('BUSCAR_PRODUTO', 'audio') <
    bot.intentConfidenceRequired('BUSCAR_PRODUTO', 'text')
  );
  assert.equal(
    bot.intentConfidenceRequired('CONSULTA_FINANCEIRA', 'audio'),
    bot.intentConfidenceRequired('CONSULTA_FINANCEIRA', 'text')
  );
  assert.equal(
    bot.intentConfidenceRequired('NEGOCIACAO_PAGAMENTO', 'audio'),
    bot.intentConfidenceRequired('NEGOCIACAO_PAGAMENTO', 'text')
  );
});

test('áudio coloquial passa pela interpretação semântica antes do fallback genérico', async () => {
  const phone = '5533923333411';

  audioTranscriptionText = 'moço eu tô precisando daquele negócio grande de guardar comida gelada pra cozinha';
  mediaBase64Response = {
    mimetype: 'audio/ogg; codecs=opus',
    base64: 'T2dnUwBmYWtlLWF1ZGlvLXNlbWFudGljbw=='
  };

  catalogRows = [
    product('gel-audio-semantic-1', 'Geladeira Consul Frost Free 340L', {
      category: 'Geladeira',
      stock: 2
    })
  ];

  bot.patchTestIntentClassification({
    intent: 'BUSCAR_PRODUTO',
    confidence: 0.78,
    category: 'geladeira',
    product_reference: '',
    product_ordinal: 0,
    installments: 0,
    payment_method: 'unknown',
    location_hint: ''
  });

  const result = await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: {
        remoteJid: phone + '@s.whatsapp.net',
        fromMe: false,
        id: 'AUDIO-SEMANTIC-COLLOQUIAL-1'
      },
      pushName: 'Cliente Áudio',
      message: {
        audioMessage: {
          mimetype: 'audio/ogg; codecs=opus',
          seconds: 11,
          ptt: true
        }
      }
    }
  });

  assert.equal(result.audio, 'audio_transcribed');
  assert.ok(
    sentMedia.some((item) => /Geladeira Consul Frost Free 340L/i.test(item.caption || '')),
    'intenção semântica do áudio deve consultar a categoria correta'
  );
  assert.equal(
    sentTexts.some((item) => /me conta um pouco mais do produto ou da condição/i.test(item.text || '')),
    false,
    'áudio entendido semanticamente não deve cair no fallback comercial genérico'
  );
});

test('áudio com múltiplas intenções continua respondendo todas antes da intenção semântica única', async () => {
  const phone = '5533923333412';
  const chosen = bot.compactProduct(product('audio-multi-priority-1', 'Smart TV 50 Samsung Crystal', {
    category: 'TV',
    pixPrice: 2199,
    cardPrice: 2640,
    stock: 2
  }));

  bot.patchTestConversation(phone, {
    selectedProduct: chosen,
    lastProducts: [chosen],
    allProductResults: [chosen],
    lastIntent: 'produto'
  });

  audioTranscriptionText = 'quanto fica no cartão e entrega aqui em Guanhães';
  mediaBase64Response = {
    mimetype: 'audio/ogg; codecs=opus',
    base64: 'T2dnUwBmYWtlLWF1ZGlvLW11bHRpLXNlbWFudGlj'
  };

  bot.patchTestIntentClassification({
    intent: 'PRECO_CARTAO',
    confidence: 0.97,
    category: '',
    product_reference: 'Smart TV 50 Samsung Crystal',
    product_ordinal: 0,
    installments: 0,
    payment_method: 'cartao',
    location_hint: 'Guanhães'
  });

  const result = await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: {
        remoteJid: phone + '@s.whatsapp.net',
        fromMe: false,
        id: 'AUDIO-MULTI-SEMANTIC-PRIORITY-1'
      },
      pushName: 'Cliente Áudio',
      message: {
        audioMessage: {
          mimetype: 'audio/ogg; codecs=opus',
          seconds: 8,
          ptt: true
        }
      }
    }
  });

  assert.equal(result.audio, 'audio_transcribed');
  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /No cartão/i);
  assert.match(sentTexts[0].text, /Entrega:/i);
  assert.match(sentTexts[0].text, /24 horas/i);
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

  const transcriptionRequest = requestLog.find(
    (item) => item.href === 'https://api.openai.com/v1/audio/transcriptions'
  );
  assert.equal(transcriptionRequest.options.body.get('model'), 'gpt-transcribe');
  assert.equal(transcriptionRequest.options.body.get('language'), 'pt');
  assert.match(
    String(transcriptionRequest.options.body.get('prompt') || ''),
    /dinheiro da prestação|não deu para mandar no PIX/i
  );

  assert.ok(
    sentMedia.some((item) => /Geladeira Frost Free 400L/i.test(item.caption || '')),
    'texto transcrito deve entrar na busca normal de produtos'
  );

  const budget = bot.visionBudgetStatus();
  assert.equal(budget.audioRequests, 1);
  assert.equal(budget.audioSeconds, 12);
  assert.equal(budget.usedBrl, 0.0054);
});

test('áudio avisando que dinheiro foi deixado para pagamento vai ao financeiro e não ao fallback comercial', async () => {
  const phone = '5533923333497';

  assert.equal(
    bot.isPaymentHandoffNotice('Boa noite, a Marcelinha deixou o dinheiro aqui pra você.'),
    true
  );
  assert.equal(
    bot.isPaymentHandoffNotice('Quero pagar essa geladeira em dinheiro'),
    false,
    'intenção futura de pagar em dinheiro não é confirmação de entrega'
  );

  audioTranscriptionText = 'Boa noite, a Marcelinha deixou o dinheiro aqui pra você.';
  mediaBase64Response = {
    mimetype: 'audio/ogg; codecs=opus',
    base64: 'T2dnUwBmYWtlLWF1ZGlvLWRpbmhlaXJv'
  };

  const result = await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: {
        remoteJid: phone + '@s.whatsapp.net',
        fromMe: false,
        id: 'AUDIO-CASH-HANDOFF-1'
      },
      pushName: 'Cliente Pagamento',
      message: {
        audioMessage: {
          mimetype: 'audio/ogg; codecs=opus',
          seconds: 6,
          ptt: true
        }
      }
    }
  });

  assert.equal(result.audio, 'audio_transcribed');
  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /^Boa noite! 😊/i);
  assert.match(sentTexts[0].text, /Marcelo conferir/i);
  assert.match(sentTexts[0].text, /pagamento em dinheiro/i);
  assert.match(sentTexts[0].text, /baixa só fica confirmada depois da conferência/i);
  assert.doesNotMatch(sentTexts[0].text, /produto ou da condição|fotos de produtos|Pode enviar o comprovante/i);

  assert.equal(backendEvents.length, 1);
  assert.equal(backendEvents[0].status, 'Financeiro - conferir pagamento em dinheiro');
  assert.equal(backendEvents[0].metadata.assunto, 'pagamento_entregue_ou_pix_nao_concluido');
  assert.equal(backendEvents[0].metadata.exigeConfirmacaoMarcelo, true);
  assert.equal(backendEvents[0].metadata.naoConfirmarBaixaAutomaticamente, true);
});

test('áudio dizendo que PIX não deu certo e que é dinheiro da prestação fica no contexto financeiro', async () => {
  const phone = '5533923333498';

  assert.equal(
    bot.isPaymentHandoffNotice('Ela disse que não deu pra mandar no PIX, viu? É o dinheiro da prestação.'),
    true
  );

  audioTranscriptionText = 'Ela disse que não deu pra mandar no PIX, viu? É o dinheiro da prestação.';
  mediaBase64Response = {
    mimetype: 'audio/ogg; codecs=opus',
    base64: 'T2dnUwBmYWtlLWF1ZGlvLXBpeC1wcmVzdGFjYW8='
  };

  const result = await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: {
        remoteJid: phone + '@s.whatsapp.net',
        fromMe: false,
        id: 'AUDIO-PIX-CASH-1'
      },
      pushName: 'Cliente Pagamento',
      message: {
        audioMessage: {
          mimetype: 'audio/ogg; codecs=opus',
          seconds: 6,
          ptt: true
        }
      }
    }
  });

  assert.equal(result.audio, 'audio_transcribed');
  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /^Entendi 😊/i);
  assert.match(sentTexts[0].text, /Marcelo conferir/i);
  assert.match(sentTexts[0].text, /pagamento em dinheiro/i);
  assert.doesNotMatch(sentTexts[0].text, /produto ou da condição|fotos de produtos|Pode enviar o comprovante/i);

  assert.equal(backendEvents.length, 1);
  assert.equal(backendEvents[0].status, 'Financeiro - conferir pagamento em dinheiro');
  assert.equal(backendEvents[0].metadata.assunto, 'pagamento_entregue_ou_pix_nao_concluido');
  assert.equal(backendEvents[0].metadata.naoConfirmarBaixaAutomaticamente, true);
});

test('áudio com promessa condicional de pagamento é registrado para o Marcelo e não cai no fallback', async () => {
  const phone = '5533923333499';

  audioTranscriptionText = 'Marcelo, boa tarde. Olha, a mamãe falou que se ela pegar um dinheiro da Danda, tá lá que ela deixou para você, e o dia que eu receber aqui, meu amor, eu já mando para você, viu?';

  assert.equal(
    bot.isPaymentHandoffNotice(audioTranscriptionText),
    false,
    'promessa futura não pode ser confundida com dinheiro já entregue'
  );

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

  assert.equal(bot.asksMarceloOrCallback('Bom dia Marcelo tudo bem?'), false);
  assert.equal(bot.asksMarceloOrCallback('Oi Marcelo tudo bem? Tô precisando falar com você'), true);
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

test('memória comercial entende cotação de cartão mesmo com referência longa ao produto', () => {
  assert.equal(
    bot.rememberedProductPaymentIntent('quanto fica aquele que eu tava olhando no cartão?'),
    'card'
  );
  assert.equal(
    bot.rememberedProductPaymentIntent('qual o valor daquela geladeira que eu gostei no crédito?'),
    'card'
  );
});

test('memória comercial entende PIX e crediário em referências longas', () => {
  assert.equal(
    bot.rememberedProductPaymentIntent('quanto fica aquele que eu te falei no pix?'),
    'pix'
  );
  assert.equal(
    bot.rememberedProductPaymentIntent('aquele sofá que eu tava olhando em 10x no carnê'),
    'credit'
  );
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

test('memória comercial não confunde "aquele dia" com referência a produto antigo', () => {
  const phone = '5533977777906';
  const item = bot.compactProduct(product('mem-safe-1', 'SMART TV LG 50 4K', {
    category: 'TV',
    pixPrice: 2199,
    cardPrice: 2649
  }));

  const conv = bot.patchTestConversation(phone, {});
  bot.rememberCommercialInterest(phone, conv, {
    product: item,
    category: 'TV',
    stage: 'considering'
  });

  assert.equal(bot.rememberedProductReferenceIntent('aquele dia foi corrido demais'), false);
  assert.equal(
    bot.resolveRememberedProductReference(phone, 'aquele dia foi corrido demais', conv),
    null
  );
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

test('cliente com memória comercial recebe cortesia primeiro sem perder o produto lembrado', async () => {
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

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /^Boa tarde, Mariana! 😊 Tudo bem\?/i);
  assert.doesNotMatch(sentTexts[0].text, /Lembro que você estava olhando/i);
  assert.equal(bot.commercialProfileSnapshot(phone).lastProduct.id, item.id);

  sentTexts = [];
  await bot.handleMessage({
    phone,
    text: 'estou bem também',
    pushName: 'Mariana Cliente'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /Ah, que bom/i);
  assert.match(sentTexts[0].text, /O que você tá precisando pra hoje/i);
  assert.equal(bot.commercialProfileSnapshot(phone).lastProduct.id, item.id);
});

test('orçamento em linguagem natural é extraído sem confundir números comuns', () => {
  assert.equal(bot.extractBudgetLimit('Tenho até 2 mil para uma geladeira'), 2000);
  assert.equal(bot.extractBudgetLimit('meu orçamento é de R$ 2.500'), 2500);
  assert.equal(bot.extractBudgetLimit('posso gastar até 1.799,90'), 1799.90);
  assert.equal(bot.extractBudgetLimit('quero uma TV de 50 polegadas'), 0);
});

test('orçamento filtra catálogo e mostra somente produtos dentro do limite', async () => {
  const phone = '5533977777910';
  catalogRows = [
    product('budget-fridge-1', 'Geladeira Consul 300 Litros', { category: 'Geladeiras', pixPrice: 1899, cardPrice: 2287 }),
    product('budget-fridge-2', 'Geladeira HQ 230 Litros', { category: 'Geladeiras', pixPrice: 1599, cardPrice: 1927 }),
    product('budget-fridge-3', 'Geladeira Brastemp 375 Litros', { category: 'Geladeiras', pixPrice: 2499, cardPrice: 3010 }),
    product('budget-freezer', 'Freezer Horizontal 200 Litros', { category: 'Freezers', pixPrice: 1499, cardPrice: 1800 })
  ];

  await bot.handleMessage({
    phone,
    text: 'Tenho até 2 mil, qual geladeira você me indica?',
    pushName: 'Cliente Orçamento'
  });

  assert.equal(sentMedia.length, 2);
  assert.match(sentTexts[0].text, /orçamento de até R\$\s*2\.000,00/i);
  assert.match(sentMedia[0].caption, /Geladeira HQ 230 Litros/i);
  assert.match(sentMedia[1].caption, /Geladeira Consul 300 Litros/i);
  assert.doesNotMatch(sentMedia.map((item) => item.caption).join('\n'), /Brastemp 375/i);
  assert.doesNotMatch(sentMedia.map((item) => item.caption).join('\n'), /Freezer/i);
});

test('"quero sim" após orçamento sem resultado mostra opções acima do limite sem cair no fallback', async () => {
  const phone = '5533977777917';
  catalogRows = [
    product('budget-above-1', 'Geladeira HQ 230 Litros', {
      category: 'Geladeiras',
      pixPrice: 2197.40,
      cardPrice: 2647
    }),
    product('budget-above-2', 'Geladeira Consul 300 Litros', {
      category: 'Geladeiras',
      pixPrice: 2499,
      cardPrice: 3010
    }),
    product('budget-freezer-ignore', 'Freezer Horizontal 200 Litros', {
      category: 'Freezers',
      pixPrice: 1899,
      cardPrice: 2287
    })
  ];

  await bot.handleMessage({
    phone,
    text: 'tenho até 2 mil para uma geladeira',
    pushName: 'Cliente Orçamento'
  });

  assert.equal(sentMedia.length, 0);
  assert.match(sentTexts.at(-1).text, /não encontrei.*geladeira.*R\$\s*2\.000,00/i);
  assert.equal(bot.conversation(phone).pendingAlternativeCategory, 'geladeira');

  sentTexts = [];
  sentMedia = [];

  await bot.handleMessage({
    phone,
    text: 'quero sim',
    pushName: 'Cliente Orçamento'
  });

  assert.equal(bot.conversation(phone).pendingAlternativeCategory, '');
  assert.equal(sentMedia.length, 2);
  assert.match(sentMedia[0].caption, /Geladeira HQ 230 Litros/i);
  assert.match(sentMedia[1].caption, /Geladeira Consul 300 Litros/i);
  assert.doesNotMatch(sentMedia.map((item) => item.caption).join('\n'), /Freezer/i);
  assert.doesNotMatch(sentTexts.map((item) => item.text).join('\n'), /Só para eu pegar certinho|Me conta um pouco mais/i);
});

test('objeção de preço procura alternativas realmente mais baratas da mesma categoria', async () => {
  const phone = '5533977777911';
  const chosen = bot.compactProduct(product('cheap-base', 'Geladeira Consul 451 Litros', {
    category: 'Geladeiras',
    pixPrice: 3974,
    cardPrice: 4787.95
  }));
  bot.patchTestConversation(phone, {
    selectedProduct: chosen,
    lastProducts: [chosen],
    lastProductQuery: 'geladeira',
    lastIntent: 'produto'
  });
  catalogRows = [
    product('cheap-base', 'Geladeira Consul 451 Litros', { category: 'Geladeiras', pixPrice: 3974, cardPrice: 4787.95 }),
    product('cheap-1', 'Geladeira HQ 230 Litros', { category: 'Geladeiras', pixPrice: 2197.40, cardPrice: 2647 }),
    product('cheap-2', 'Geladeira Electrolux 310 Litros', { category: 'Geladeiras', pixPrice: 3299, cardPrice: 3974 }),
    product('cheap-expensive', 'Geladeira Premium 500 Litros', { category: 'Geladeiras', pixPrice: 4499, cardPrice: 5420 })
  ];

  await bot.handleMessage({
    phone,
    text: 'achei caro, tem uma parecida mais barata?',
    pushName: 'Cliente Preço'
  });

  assert.equal(sentMedia.length, 2);
  assert.match(sentTexts[0].text, /preço no PIX menor/i);
  assert.match(sentMedia[0].caption, /Geladeira HQ 230 Litros/i);
  assert.match(sentMedia[1].caption, /Geladeira Electrolux 310 Litros/i);
  assert.doesNotMatch(sentMedia.map((item) => item.caption).join('\n'), /Premium 500/i);
});

test('perguntas comuns de produto são reconhecidas em linguagem natural', () => {
  const checks = [
    [bot.asksProductWarranty, ['tem garantia?', 'quantos meses de garantia?']],
    [bot.asksProductVoltage, ['é bivolt?', 'qual a voltagem?']],
    [bot.asksProductDimensions, ['qual o tamanho dele?', 'quais as medidas desse produto?']],
    [bot.asksProductFit, ['cabe no meu espaço?', 'vai caber no nicho da cozinha?']],
    [bot.asksReadyStock, ['tem pronta entrega?', 'tem em estoque agora?']],
    [bot.asksDeliverySpeed, ['qual chega mais rápido?', 'qual entrega mais rápido?']],
    [bot.asksProductColor, ['tem dessa cor?', 'qual a cor dele?']],
    [bot.asksOtherModel, ['tem outro modelo?', 'tem outra opção?']],
    [bot.asksBrandQuality, ['essa marca é boa?', 'essa marca presta?']],
    [bot.asksBestSeller, ['qual vende mais?', 'qual é o mais vendido?']],
    [bot.asksProductRecommendation, ['qual você me indica?', 'qual você recomenda?']],
    [bot.asksEntryPayment, ['e se eu der entrada?', 'se eu der 500 de entrada?']],
    [bot.asksQuantityDiscount, ['tem desconto levando dois?', 'comprando 2 tem desconto?']]
  ];

  for (const [fn, phrases] of checks) {
    for (const phrase of phrases) {
      assert.equal(fn(phrase), true, phrase);
    }
  }

  assert.equal(bot.asksPixPrice('faz quanto à vista?'), true);
});

test('garantia voltagem cor e medidas usam ficha técnica detalhada real do produto', async () => {
  const phone = '5533977777983';
  const fridge = product('faq-tech-1', 'REFRIGERADOR CONSUL 451L BRANCO 110V', {
    category: 'Geladeiras & Refrigeradores',
    brand: 'Consul',
    pixPrice: 3974,
    cardPrice: 4787.95,
    stock: 2,
    width: 70,
    height: 186,
    length: 72,
    description: 'Compartimentos ajustáveis de acordo com a sua necessidade diária.',
    specs: [
      'Voltagem: 127V (110V)',
      'Cor Predominante: Branco',
      'Garantia Padrão do Fabricante: 12 meses'
    ].join('\n')
  });
  catalogRows = [fridge];
  bot.patchTestConversation(phone, {
    selectedProduct: bot.compactProduct(fridge),
    lastProducts: [bot.compactProduct(fridge)],
    lastProductQuery: 'geladeira',
    lastIntent: 'produto'
  });

  for (const [message, expected] of [
    ['tem garantia?', /garantia de \*12 meses\*/i],
    ['é bivolt?', /127V \(110V\)/i],
    ['qual a cor dele?', /\*Branco\*/i],
    ['qual o tamanho dele?', /largura \*70 cm\*.*altura \*186 cm\*.*profundidade \*72 cm\*/is]
  ]) {
    sentTexts = [];
    await bot.handleMessage({ phone, text: message, pushName: 'Cliente Ficha' });
    assert.equal(sentTexts.length, 1, message);
    assert.match(sentTexts[0].text, expected, message);
  }
});

test('voltagem divergente entre nome e ficha é sinalizada sem vazar campos concatenados', async () => {
  const phone = '5533977777993';
  const fridge = product('faq-voltage-conflict', 'GELADEIRA FROST FREE 380L TC42 BRANCA 110V', {
    category: 'Geladeiras',
    stock: 1,
    description: 'Geladeira Frost Free Continental.',
    specs: 'Voltagem: 220VTipo de Tomada: 10AEficiência Energética: CConsumo Aproximado de Energia: 55,7 kWh/mês'
  });
  catalogRows = [fridge];
  bot.patchTestConversation(phone, {
    selectedProduct: bot.compactProduct(fridge),
    lastProducts: [bot.compactProduct(fridge)],
    lastProductQuery: 'geladeira',
    lastIntent: 'produto'
  });

  const info = bot.productVoltageInfo({
    name: fridge.name,
    description: fridge.description,
    specs: fridge.specs
  });
  assert.equal(info.conflict, true);
  assert.equal(info.nameValue, '110V');
  assert.equal(info.specValue, '220V');

  await bot.handleMessage({
    phone,
    text: 'qual a voltagem dela?',
    pushName: 'Cliente Voltagem'
  });

  const reply = sentTexts.at(-1).text;
  assert.match(reply, /divergência no cadastro/i);
  assert.match(reply, /nome\/modelo indica \*110V\*/i);
  assert.match(reply, /ficha técnica indica \*220V\*/i);
  assert.doesNotMatch(reply, /Tipo de Tomada|Eficiência Energética/i);
});

test('Gustavo confere se produto cabe usando medidas informadas sem inventar dimensões', async () => {
  const phone = '5533977777984';
  const fridge = product('faq-fit-1', 'Geladeira Consul 451L', {
    category: 'Geladeiras',
    stock: 1,
    width: 70,
    height: 186,
    length: 72,
    specs: 'Garantia: 12 meses'
  });
  catalogRows = [fridge];
  bot.patchTestConversation(phone, {
    selectedProduct: bot.compactProduct(fridge),
    lastProducts: [bot.compactProduct(fridge)],
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'cabe no meu espaço? tenho largura 75, altura 190 e profundidade 80',
    pushName: 'Cliente Medidas'
  });
  assert.match(sentTexts.at(-1).text, /cabe nas dimensões comparadas/i);

  sentTexts = [];
  await bot.handleMessage({
    phone,
    text: 'cabe no meu espaço? tenho largura 65, altura 190 e profundidade 80',
    pushName: 'Cliente Medidas'
  });
  assert.match(sentTexts.at(-1).text, /não cabe/i);
  assert.match(sentTexts.at(-1).text, /largura: produto 70 cm \/ espaço 65 cm/i);
});

test('pronta entrega informa estoque sem prometer prazo e outro modelo mostra alternativas reais', async () => {
  const phone = '5533977777985';
  const current = product('faq-stock-1', 'Fogão Atlas 4 Bocas Branco', {
    category: 'Fogão',
    stock: 3
  });
  const other = product('faq-stock-2', 'Fogão Dako 5 Bocas Preto', {
    category: 'Fogão',
    stock: 2
  });
  catalogRows = [current, other];
  bot.patchTestConversation(phone, {
    selectedProduct: bot.compactProduct(current),
    lastProducts: [bot.compactProduct(current)],
    lastProductQuery: 'fogão',
    lastIntent: 'produto'
  });

  await bot.handleMessage({ phone, text: 'tem pronta entrega?', pushName: 'Cliente Estoque' });
  assert.match(sentTexts.at(-1).text, /3 unidade\(s\) em estoque/i);
  assert.match(sentTexts.at(-1).text, /prazo de entrega depende do endereço/i);

  sentTexts = [];
  sentMedia = [];
  await bot.handleMessage({ phone, text: 'tem outro modelo?', pushName: 'Cliente Estoque' });
  assert.ok(sentMedia.some((item) => /Fogão Dako 5 Bocas Preto/i.test(item.caption || '')));
  assert.equal(sentMedia.some((item) => /Fogão Atlas 4 Bocas Branco/i.test(item.caption || '')), false);
});

test('mais vendido recomendação e marca usam somente sinais confirmados do catálogo', async () => {
  const phone = '5533977777986';
  const first = bot.compactProduct(product('faq-rec-1', 'Smart TV Semp 43 Roku', {
    category: 'TVs',
    brand: 'Semp Toshiba',
    isBestSeller: true,
    stock: 2
  }));
  const second = bot.compactProduct(product('faq-rec-2', 'Smart TV LG 43', {
    category: 'TVs',
    brand: 'LG',
    isRecommended: true,
    stock: 2
  }));

  bot.patchTestConversation(phone, {
    lastProducts: [first, second],
    lastProductQuery: 'tv',
    lastIntent: 'produto'
  });

  await bot.handleMessage({ phone, text: 'qual vende mais?', pushName: 'Cliente Recomendação' });
  assert.match(sentTexts.at(-1).text, /Semp 43 Roku.*mais vendido/is);

  sentTexts = [];
  await bot.handleMessage({ phone, text: 'qual você me indica?', pushName: 'Cliente Recomendação' });
  assert.match(sentTexts.at(-1).text, /LG 43.*recomendado/is);
  assert.match(sentTexts.at(-1).text, /não vou dizer que ele é melhor em tudo/i);

  bot.patchTestConversation(phone, {
    selectedProduct: second,
    lastProducts: [second],
    lastIntent: 'produto'
  });
  sentTexts = [];
  await bot.handleMessage({ phone, text: 'essa marca é boa?', pushName: 'Cliente Recomendação' });
  assert.match(sentTexts.at(-1).text, /marca cadastrada é \*LG\*/i);
  assert.match(sentTexts.at(-1).text, /não tenho uma nota confiável de qualidade/i);
});




test('gostei do branco com mais fotos resolve o item branco da lista e usa a galeria dele', async () => {
  const phone = '5533977778010';
  const white = product('list-white-1', 'Guarda Roupa Delta 6 Pts Com Espelho Branco', {
    category: 'Guarda-Roupas',
    pixPrice: 1267.41,
    stock: 2,
    imageUrl: 'https://img.test/white-main.jpg',
    images: [
      { url: 'https://img.test/white-main.jpg', isMain: true },
      { url: 'https://img.test/white-inside.jpg' },
      { url: 'https://img.test/white-detail.jpg' }
    ]
  });
  const offWhite = product('list-offwhite-2', 'Guarda Roupa Casal 6 Portas 2 Gavetas Delta Leifer Cinamomo Off White', {
    category: 'Guarda-Roupas',
    pixPrice: 1239.51,
    stock: 2
  });
  const canadaOff = product('list-canada-3', 'Guarda Roupa Casal 6 Portas 4 Gavetas Canadá Cinamomo Off White', {
    category: 'Guarda-Roupas',
    pixPrice: 1596.66,
    stock: 2
  });
  const cinamomo = product('list-cinamomo-4', 'Guarda Roupa Canadá Cinamomo 6 Portas 4 Gavetas', {
    category: 'Guarda-Roupas',
    pixPrice: 1596.66,
    stock: 2
  });
  catalogRows = [white, offWhite, canadaOff, cinamomo];

  bot.patchTestConversation(phone, {
    lastAt: Date.now(),
    selectedProduct: null,
    lastProducts: [white, offWhite, canadaOff, cinamomo].map(bot.compactProduct),
    allProductResults: [white, offWhite, canadaOff, cinamomo].map(bot.compactProduct),
    lastProductQuery: 'guarda-roupa',
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'gostei do branco voce tem mais fotos dele pra eu ver ?',
    pushName: 'Cliente Lista'
  });

  assert.equal(bot.conversation(phone).selectedProduct.id, 'list-white-1');
  assert.equal(sentMedia.length, 2);
  assert.ok(sentMedia.some((item) => item.media === 'https://img.test/white-inside.jpg'));
  assert.ok(sentMedia.some((item) => item.media === 'https://img.test/white-detail.jpg'));
  assert.equal(sentMedia.some((item) => /offwhite|canada|cinamomo/i.test(item.media)), false);
  assert.doesNotMatch(sentTexts.map((item) => item.text).join('\n'), /pode me mandar a foto ou o print/i);
});


test('"qual o valor do branco?" usa o produto branco da lista mesmo se outro estiver selecionado', async () => {
  const phone = '5533977778014';
  const white = product('list-price-white-1', 'Guarda Roupa Delta 6 Pts Com Espelho Branco', {
    category: 'Guarda-Roupas',
    price: 1527,
    pixPrice: 1267.41,
    stock: 2
  });
  const cinamomo = product('list-price-cina-2', 'Guarda Roupa Canadá Cinamomo 6 Portas 4 Gavetas', {
    category: 'Guarda-Roupas',
    price: 1923.69,
    pixPrice: 1596.66,
    stock: 2
  });

  bot.patchTestConversation(phone, {
    lastAt: Date.now(),
    selectedProduct: bot.compactProduct(cinamomo),
    lastProducts: [white, cinamomo].map(bot.compactProduct),
    allProductResults: [white, cinamomo].map(bot.compactProduct),
    lastProductQuery: 'guarda-roupa',
    lastIntent: 'produto'
  });

  assert.equal(bot.asksGenericProductPrice('qual o valor do branco?'), true);

  await bot.handleMessage({
    phone,
    text: 'qual o valor do branco?',
    pushName: 'Cliente Lista'
  });

  assert.equal(bot.conversation(phone).selectedProduct.id, 'list-price-white-1');
  assert.match(sentTexts.at(-1).text, /Guarda Roupa Delta 6 Pts Com Espelho Branco/i);
  assert.match(sentTexts.at(-1).text, /1\.267,41/i);
  assert.match(sentTexts.at(-1).text, /12x de .*127,25/i);
  assert.match(sentTexts.at(-1).text, /1\.527,00/i);
  assert.doesNotMatch(sentTexts.at(-1).text, /Me conta um pouco mais|entender direitinho/i);
});

test('"quanto custa o com espelho?" resolve característica e responde preço do item correto', async () => {
  const phone = '5533977778015';
  const mirror = product('list-price-mirror-1', 'Guarda Roupa Delta 6 Portas Com Espelho Branco', {
    category: 'Guarda-Roupas',
    price: 1527,
    pixPrice: 1267.41,
    stock: 2
  });
  const plain = product('list-price-plain-2', 'Guarda Roupa Canadá 6 Portas 4 Gavetas Cinamomo', {
    category: 'Guarda-Roupas',
    price: 1923.69,
    pixPrice: 1596.66,
    stock: 2
  });

  bot.patchTestConversation(phone, {
    lastAt: Date.now(),
    selectedProduct: bot.compactProduct(plain),
    lastProducts: [mirror, plain].map(bot.compactProduct),
    allProductResults: [mirror, plain].map(bot.compactProduct),
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'quanto custa o com espelho?',
    pushName: 'Cliente Lista'
  });

  assert.equal(bot.conversation(phone).selectedProduct.id, 'list-price-mirror-1');
  assert.match(sentTexts.at(-1).text, /Guarda Roupa Delta 6 Portas Com Espelho Branco/i);
  assert.match(sentTexts.at(-1).text, /1\.267,41/i);
});

test('"preço do cinamomo" pede qual opção quando a cor aparece em mais de um item', async () => {
  const phone = '5533977778016';
  const a = product('list-price-cina-a', 'Guarda Roupa Delta Leifer CinamomoOff White', {
    category: 'Guarda-Roupas',
    price: 1493.39,
    pixPrice: 1239.51,
    stock: 2
  });
  const b = product('list-price-cina-b', 'Guarda Roupa Canadá cinamomooff White', {
    category: 'Guarda-Roupas',
    price: 1923.69,
    pixPrice: 1596.66,
    stock: 2
  });
  const c = product('list-price-cina-c', 'Guarda Roupa Canadá Cinamomo', {
    category: 'Guarda-Roupas',
    price: 1923.69,
    pixPrice: 1596.66,
    stock: 2
  });

  bot.patchTestConversation(phone, {
    lastAt: Date.now(),
    selectedProduct: bot.compactProduct(c),
    lastProducts: [a, b, c].map(bot.compactProduct),
    allProductResults: [a, b, c].map(bot.compactProduct),
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'preço do cinamomo',
    pushName: 'Cliente Lista'
  });

  assert.match(sentTexts.at(-1).text, /mais de uma opção.*qual delas/i);
  assert.doesNotMatch(sentTexts.at(-1).text, /1\.239,51|1\.596,66/);
});


test('após "preço do cinamomo", resposta "3" retoma a 3ª opção e responde preço sem reabrir catálogo', async () => {
  const phone = '5533977778017';
  const white = product('pending-white-1', 'Guarda Roupa Delta 6 Pts Com Espelho Branco', {
    category: 'Guarda-Roupas',
    price: 1685.54,
    pixPrice: 1399,
    stock: 1
  });
  const second = product('pending-cina-2', 'Guarda Roupa Casal 6 Portas 2 Gavetas Delta Leifer CinamomoOff White', {
    category: 'Guarda-Roupas',
    price: 1685.54,
    pixPrice: 1399,
    stock: 4
  });
  const third = product('pending-cina-3', 'Guarda Roupa Casal 6 Portas 4 Gavetas Canadá cinamomooff White', {
    category: 'Guarda-Roupas',
    price: 1923.69,
    pixPrice: 1596.66,
    stock: 2
  });
  const fourth = product('pending-cina-4', 'Guarda Roupa Canadá Cinamomo 6 Portas 4 Gavetas', {
    category: 'Guarda-Roupas',
    price: 1923.69,
    pixPrice: 1596.66,
    stock: 3
  });
  catalogRows = [white, second, third, fourth];

  bot.patchTestConversation(phone, {
    lastAt: Date.now(),
    selectedProduct: bot.compactProduct(white),
    lastProducts: [white, second, third, fourth].map(bot.compactProduct),
    allProductResults: [white, second, third, fourth].map(bot.compactProduct),
    lastProductQuery: 'guarda-roupa',
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'preço do cinamomo',
    pushName: 'Cliente Escolha'
  });

  assert.match(sentTexts.at(-1).text, /2ª opção.*3ª opção.*4ª opção/is);
  assert.equal(bot.conversation(phone).pendingListClarification.intent, 'generic_price');

  sentTexts = [];
  sentMedia = [];

  await bot.handleMessage({
    phone,
    text: '3',
    pushName: 'Cliente Escolha'
  });

  assert.equal(bot.conversation(phone).selectedProduct.id, 'pending-cina-3');
  assert.equal(bot.conversation(phone).pendingListClarification, null);
  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /Guarda Roupa Casal 6 Portas 4 Gavetas Canadá cinamomooff White/i);
  assert.match(sentTexts[0].text, /1\.596,66/);
  assert.match(sentTexts[0].text, /12x de .*160,31/i);
  assert.doesNotMatch(sentTexts[0].text, /Encontrei .*opções disponíveis|Vou te mostrar as primeiras/i);
  assert.equal(sentMedia.length, 0);
});

test('escolha pendente aceita "a terceira" e continua a intenção de preço', async () => {
  const phone = '5533977778018';
  const white = product('pending-word-white', 'Guarda Roupa Branco', {
    category: 'Guarda-Roupas',
    price: 1500,
    pixPrice: 1200,
    stock: 1
  });
  const second = product('pending-word-2', 'Guarda Roupa Delta CinamomoOff White', {
    category: 'Guarda-Roupas',
    price: 1600,
    pixPrice: 1300,
    stock: 2
  });
  const third = product('pending-word-3', 'Guarda Roupa Canadá CinamomoOff White', {
    category: 'Guarda-Roupas',
    price: 1800,
    pixPrice: 1494,
    stock: 2
  });

  bot.patchTestConversation(phone, {
    lastAt: Date.now(),
    selectedProduct: bot.compactProduct(white),
    lastProducts: [white, second, third].map(bot.compactProduct),
    allProductResults: [white, second, third].map(bot.compactProduct),
    lastIntent: 'produto'
  });

  await bot.handleMessage({ phone, text: 'preço do cinamomo', pushName: 'Cliente Escolha' });
  sentTexts = [];

  await bot.handleMessage({ phone, text: 'a terceira', pushName: 'Cliente Escolha' });

  assert.equal(bot.conversation(phone).selectedProduct.id, 'pending-word-3');
  assert.match(sentTexts.at(-1).text, /Guarda Roupa Canadá CinamomoOff White/i);
  assert.match(sentTexts.at(-1).text, /1\.494,00/i);
});


test('"o 3 você tem mais fotos dela?" seleciona a 3ª opção e envia a galeria sem perguntar de novo', async () => {
  const phone = '5533977778021';
  const first = product('air-list-1', 'Air Fryer 4L 1400W', {
    category: 'Eletroportáteis',
    stock: 2,
    imageUrl: 'https://img.test/air-1-main.jpg',
    images: [
      { url: 'https://img.test/air-1-main.jpg', isMain: true },
      { url: 'https://img.test/air-1-detail.jpg' }
    ]
  });
  const second = product('air-list-2', 'Air Fryer 5L 1500W', {
    category: 'Eletroportáteis',
    stock: 2,
    imageUrl: 'https://img.test/air-2-main.jpg',
    images: [
      { url: 'https://img.test/air-2-main.jpg', isMain: true },
      { url: 'https://img.test/air-2-detail.jpg' }
    ]
  });
  const third = product('air-list-3', 'Air Fryer 12L Oven 1800W', {
    category: 'Eletroportáteis',
    stock: 2,
    imageUrl: 'https://img.test/air-3-main.jpg',
    images: [
      { url: 'https://img.test/air-3-main.jpg', isMain: true },
      { url: 'https://img.test/air-3-inside.jpg' },
      { url: 'https://img.test/air-3-detail.jpg' }
    ]
  });
  const fourth = product('air-list-4', 'Air Fryer Britânia 5,5L Gold BFR51 1500W', {
    category: 'Eletroportáteis',
    stock: 2,
    imageUrl: 'https://img.test/air-4-main.jpg',
    images: [
      { url: 'https://img.test/air-4-main.jpg', isMain: true },
      { url: 'https://img.test/air-4-detail.jpg' }
    ]
  });
  catalogRows = [first, second, third, fourth];

  bot.patchTestConversation(phone, {
    lastAt: Date.now(),
    selectedProduct: null,
    lastProducts: [first, second, third, fourth].map(bot.compactProduct),
    allProductResults: [first, second, third, fourth].map(bot.compactProduct),
    lastProductQuery: 'air fryer',
    lastIntent: 'produto'
  });

  assert.equal(bot.explicitListOptionNumber('o 3 voce tem mais fotos dela?', 4), 3);

  await bot.handleMessage({
    phone,
    text: 'o 3 voce tem mais fotos dela?',
    pushName: 'Cliente Air Fryer'
  });

  assert.equal(bot.conversation(phone).selectedProduct.id, 'air-list-3');
  assert.equal(bot.conversation(phone).pendingListClarification, null);
  assert.ok(sentMedia.some((item) => item.media === 'https://img.test/air-3-inside.jpg'));
  assert.ok(sentMedia.some((item) => item.media === 'https://img.test/air-3-detail.jpg'));
  assert.equal(sentMedia.some((item) => item.media === 'https://img.test/air-1-detail.jpg'), false);
  assert.doesNotMatch(sentTexts.map((item) => item.text).join('\n'), /Só me diga qual das opções/i);
});

test('pedido genérico de foto em lista múltipla salva escolha pendente e "3" continua nas fotos', async () => {
  const phone = '5533977778022';
  const first = product('photo-list-1', 'Produto Um', {
    category: 'Eletroportáteis',
    stock: 2
  });
  const second = product('photo-list-2', 'Produto Dois', {
    category: 'Eletroportáteis',
    stock: 2
  });
  const third = product('photo-list-3', 'Produto Três', {
    category: 'Eletroportáteis',
    stock: 2,
    imageUrl: 'https://img.test/photo-list-3-main.jpg',
    images: [
      { url: 'https://img.test/photo-list-3-main.jpg', isMain: true },
      { url: 'https://img.test/photo-list-3-detail.jpg' }
    ]
  });
  catalogRows = [first, second, third];

  bot.patchTestConversation(phone, {
    lastAt: Date.now(),
    selectedProduct: null,
    lastProducts: [first, second, third].map(bot.compactProduct),
    allProductResults: [first, second, third].map(bot.compactProduct),
    lastProductQuery: 'air fryer',
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'voce tem mais fotos dela?',
    pushName: 'Cliente Fotos'
  });

  assert.match(sentTexts.at(-1).text, /qual das opções/i);
  assert.equal(bot.conversation(phone).pendingListClarification.intent, 'gallery_more');
  assert.equal(bot.conversation(phone).pendingListClarification.options.length, 3);

  sentTexts = [];
  sentMedia = [];

  await bot.handleMessage({
    phone,
    text: '3',
    pushName: 'Cliente Fotos'
  });

  assert.equal(bot.conversation(phone).selectedProduct.id, 'photo-list-3');
  assert.equal(bot.conversation(phone).pendingListClarification, null);
  assert.ok(sentMedia.some((item) => item.media === 'https://img.test/photo-list-3-detail.jpg'));
  assert.doesNotMatch(sentTexts.map((item) => item.text).join('\n'), /Me ajuda só com um detalhe|Me conta um pouco mais/i);
});

test('número de especificação não vira referência de posição da lista', () => {
  assert.equal(bot.explicitListOptionNumber('quero uma air fryer de 3 litros', 4), 0);
  assert.equal(bot.explicitListOptionNumber('tem uma de 3 litros?', 4), 0);
  assert.equal(bot.explicitListOptionNumber('a 3 tem mais fotos?', 4), 3);
  assert.equal(bot.explicitListOptionNumber('opção 3', 4), 3);
  assert.equal(bot.explicitListOptionNumber('quero o 3', 4), 3);
});

test('escolha pendente de "mais fotos" envia a galeria do número escolhido', async () => {
  const phone = '5533977778019';
  const white = product('pending-photo-white', 'Guarda Roupa Branco', {
    category: 'Guarda-Roupas',
    stock: 1
  });
  const second = product('pending-photo-2', 'Guarda Roupa Delta CinamomoOff White', {
    category: 'Guarda-Roupas',
    stock: 2,
    imageUrl: 'https://img.test/pending-photo-2-main.jpg',
    images: [
      { url: 'https://img.test/pending-photo-2-main.jpg', isMain: true },
      { url: 'https://img.test/pending-photo-2-inside.jpg' }
    ]
  });
  const third = product('pending-photo-3', 'Guarda Roupa Canadá CinamomoOff White', {
    category: 'Guarda-Roupas',
    stock: 2,
    imageUrl: 'https://img.test/pending-photo-3-main.jpg',
    images: [
      { url: 'https://img.test/pending-photo-3-main.jpg', isMain: true },
      { url: 'https://img.test/pending-photo-3-inside.jpg' }
    ]
  });

  catalogRows = [white, second, third];

  bot.patchTestConversation(phone, {
    lastAt: Date.now(),
    selectedProduct: bot.compactProduct(white),
    lastProducts: [white, second, third].map(bot.compactProduct),
    allProductResults: [white, second, third].map(bot.compactProduct),
    lastProductQuery: 'guarda-roupa',
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'gostei do cinamomo tem mais fotos?',
    pushName: 'Cliente Fotos'
  });

  assert.match(sentTexts.at(-1).text, /2ª opção.*3ª opção/is);
  assert.equal(bot.conversation(phone).pendingListClarification.intent, 'gallery_more');

  sentTexts = [];
  sentMedia = [];

  await bot.handleMessage({
    phone,
    text: '2',
    pushName: 'Cliente Fotos'
  });

  assert.equal(bot.conversation(phone).selectedProduct.id, 'pending-photo-2');
  assert.equal(bot.conversation(phone).pendingListClarification, null);
  assert.ok(sentMedia.some((item) => item.media === 'https://img.test/pending-photo-2-inside.jpg'));
  assert.equal(sentMedia.some((item) => item.media === 'https://img.test/pending-photo-3-inside.jpg'), false);
});

test('escolha pendente expirada é apagada e não fica presa por horas', () => {
  const phone = '5533977778020';
  bot.patchTestConversation(phone, {
    lastAt: Date.now(),
    pendingListClarification: {
      createdAt: Date.now() - 20 * 60 * 1000,
      expiresAt: Date.now() - 1,
      originalText: 'preço do cinamomo',
      intent: 'generic_price',
      options: [
        {
          optionNumber: 3,
          product: bot.compactProduct(product('expired-option-3', 'Guarda Roupa Cinamomo', {
            category: 'Guarda-Roupas',
            pixPrice: 1500,
            stock: 1
          }))
        }
      ]
    }
  });

  const conv = bot.conversation(phone);
  assert.equal(conv.pendingListClarification, null);
});

test('pergunta financeira com "valor" não vira preço genérico de produto', () => {
  assert.equal(bot.asksGenericProductPrice('qual o valor da minha parcela?'), false);
  assert.equal(bot.asksGenericProductPrice('quanto eu devo da minha notinha?'), false);
  assert.equal(bot.asksGenericProductPrice('qual o valor no pix?'), false);
  assert.equal(bot.asksGenericProductPrice('qual o valor no cartão?'), false);
});

test('referência com espelho escolhe item único da lista antes de responder', async () => {
  const phone = '5533977778009';
  const mirror = product('list-mirror-1', 'Guarda Roupa Delta 6 Portas Com Espelho Branco', {
    category: 'Guarda-Roupas',
    pixPrice: 1267,
    stock: 2
  });
  const plain = product('list-plain-2', 'Guarda Roupa Canadá 6 Portas 4 Gavetas Cinamomo', {
    category: 'Guarda-Roupas',
    pixPrice: 1596,
    stock: 2
  });
  catalogRows = [mirror, plain];

  bot.patchTestConversation(phone, {
    lastAt: Date.now(),
    selectedProduct: null,
    lastProducts: [mirror, plain].map(bot.compactProduct),
    allProductResults: [mirror, plain].map(bot.compactProduct),
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'gostei do com espelho',
    pushName: 'Cliente Lista'
  });

  assert.equal(bot.conversation(phone).selectedProduct.id, 'list-mirror-1');
  assert.match(sentTexts.at(-1).text, /Guarda Roupa Delta 6 Portas Com Espelho Branco/i);
});

test('referência ambígua por cinamomo pede qual opção em vez de escolher errado', async () => {
  const phone = '5533977778008';
  const first = product('list-cina-1', 'Guarda Roupa Casal 6 Portas 2 Gavetas Delta Leifer CinamomoOff White', {
    category: 'Guarda-Roupas',
    pixPrice: 1239,
    stock: 2
  });
  const second = product('list-cina-2', 'Guarda Roupa Casal 6 Portas 4 Gavetas Canadá cinamomooff White', {
    category: 'Guarda-Roupas',
    pixPrice: 1596,
    stock: 2
  });
  const third = product('list-cina-3', 'Guarda Roupa Canadá Cinamomo 6 Portas 4 Gavetas', {
    category: 'Guarda-Roupas',
    pixPrice: 1596,
    stock: 2
  });

  bot.patchTestConversation(phone, {
    lastAt: Date.now(),
    selectedProduct: null,
    lastProducts: [first, second, third].map(bot.compactProduct),
    allProductResults: [first, second, third].map(bot.compactProduct),
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'gostei do cinamomo tem mais fotos?',
    pushName: 'Cliente Lista'
  });

  assert.equal(bot.conversation(phone).selectedProduct, null);
  assert.match(sentTexts.at(-1).text, /mais de uma opção.*qual delas/i);
  assert.match(sentTexts.at(-1).text, /1ª opção.*Delta Leifer CinamomoOff White/i);
  assert.match(sentTexts.at(-1).text, /2ª opção.*Canadá cinamomooff White/i);
  assert.match(sentTexts.at(-1).text, /3ª opção.*Canadá Cinamomo 6 Portas/i);
  assert.equal(sentMedia.length, 0);
});

test('pedido de foto sem identificar item em lista múltipla pede qual opção e não solicita upload', async () => {
  const phone = '5533977778007';
  const a = product('list-photo-a', 'Guarda Roupa Branco', { category: 'Guarda-Roupas', stock: 2 });
  const b = product('list-photo-b', 'Guarda Roupa Cinamomo', { category: 'Guarda-Roupas', stock: 2 });

  bot.patchTestConversation(phone, {
    lastAt: Date.now(),
    selectedProduct: null,
    lastProducts: [a, b].map(bot.compactProduct),
    allProductResults: [a, b].map(bot.compactProduct),
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'tem mais fotos dele?',
    pushName: 'Cliente Lista'
  });

  assert.match(sentTexts.at(-1).text, /qual das opções.*primeira.*segunda/i);
  assert.doesNotMatch(sentTexts.at(-1).text, /mande a foto|manda a foto|print do produto/i);
  assert.equal(sentMedia.length, 0);
});

test('mais fotos do produto usa galeria completa sem repetir a principal já enviada', async () => {
  const phone = '5533977778011';
  const wardrobe = product('gallery-ward-1', 'Guarda Roupa Canadá 6 Portas 4 Gavetas Branco', {
    category: 'Guarda-Roupas',
    pixPrice: 1899,
    stock: 2,
    imageUrl: 'https://img.test/ward-main.jpg',
    images: [
      { url: 'https://img.test/ward-main.jpg', isMain: true },
      { url: 'https://img.test/ward-inside.jpg' },
      { url: 'https://img.test/ward-detail-2.jpg' },
      { url: 'https://img.test/ward-detail-3.jpg' }
    ]
  });
  catalogRows = [wardrobe];

  bot.patchTestConversation(phone, {
    selectedProduct: bot.compactProduct(wardrobe),
    lastProducts: [bot.compactProduct(wardrobe)],
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'manda foto pra eu ver',
    pushName: 'Cliente Galeria'
  });

  assert.equal(sentMedia.length, 1);
  assert.equal(sentMedia[0].media, 'https://img.test/ward-main.jpg');

  sentMedia = [];
  sentTexts = [];

  await bot.handleMessage({
    phone,
    text: 'tem mais fotos dele pra eu ver?',
    pushName: 'Cliente Galeria'
  });

  assert.equal(sentMedia.length, 3);
  assert.equal(sentMedia.some((item) => item.media === 'https://img.test/ward-main.jpg'), false);
  assert.ok(sentMedia.some((item) => item.media === 'https://img.test/ward-inside.jpg'));
  assert.ok(sentMedia.some((item) => item.media === 'https://img.test/ward-detail-2.jpg'));
  assert.match(sentTexts[0].text, /mais fotos.*imagens extras da galeria/is);
});

test('pedido por dentro ou aberto envia imagens de detalhe da galeria e não a principal', async () => {
  const phone = '5533977778012';
  const fridge = product('gallery-fridge-1', 'Geladeira Frost Free 451L Branca', {
    category: 'Geladeiras',
    pixPrice: 3999,
    stock: 2,
    imageUrl: 'https://img.test/fridge-main.jpg',
    images: [
      { url: 'https://img.test/fridge-main.jpg', isMain: true },
      { url: 'https://img.test/fridge-open.jpg' },
      { url: 'https://img.test/fridge-inside.jpg' }
    ]
  });
  catalogRows = [fridge];

  bot.patchTestConversation(phone, {
    selectedProduct: bot.compactProduct(fridge),
    lastProducts: [bot.compactProduct(fridge)],
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'tem foto dela aberta por dentro?',
    pushName: 'Cliente Interna'
  });

  assert.equal(sentMedia.length, 2);
  assert.equal(sentMedia.some((item) => item.media === 'https://img.test/fridge-main.jpg'), false);
  assert.ok(sentMedia.some((item) => item.media === 'https://img.test/fridge-open.jpg'));
  assert.ok(sentMedia.some((item) => item.media === 'https://img.test/fridge-inside.jpg'));
  assert.match(sentTexts[0].text, /parte interna\/aberta/i);
});

test('só tem essa cor lista somente variantes do mesmo modelo e não outros celulares', async () => {
  const phone = '5533977778013';
  const blue = product('color-g06-blue', 'Smartphone Motorola Moto G06 128GB 4GB RAM Tela 6.88 Octa-Core Azul', {
    category: 'Celulares',
    pixPrice: 999,
    stock: 5,
    isBestSeller: true,
    imageUrl: 'https://img.test/g06-blue.jpg'
  });
  const orange = product('color-g06-orange', 'Smartphone Motorola G06 4/128GB Laranja', {
    category: 'Celulares',
    pixPrice: 999,
    stock: 5,
    imageUrl: 'https://img.test/g06-orange.jpg'
  });
  const unrelated = product('color-a07-black', 'Smartphone Samsung Galaxy A07 128GB Preto', {
    category: 'Celulares',
    pixPrice: 899,
    stock: 5,
    imageUrl: 'https://img.test/a07-black.jpg'
  });
  catalogRows = [blue, orange, unrelated];

  bot.patchTestConversation(phone, {
    selectedProduct: bot.compactProduct(blue),
    lastProducts: [bot.compactProduct(blue)],
    lastProductQuery: 'celular',
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'só tem essa cor?',
    pushName: 'Cliente Cor'
  });

  const reply = sentTexts.at(-1).text;
  assert.match(reply, /mesmo modelo.*Laranja/is);
  assert.doesNotMatch(reply, /Samsung|A07|Preto/i);

  sentTexts = [];
  await bot.handleMessage({
    phone,
    text: 'qual cor sai mais?',
    pushName: 'Cliente Cor'
  });
  assert.match(sentTexts.at(-1).text, /Azul.*mais vendida/is);

  sentTexts = [];
  sentMedia = [];
  await bot.handleMessage({
    phone,
    text: 'me manda a laranja',
    pushName: 'Cliente Cor'
  });

  assert.equal(sentMedia.length, 1);
  assert.equal(sentMedia[0].media, 'https://img.test/g06-orange.jpg');
  assert.match(sentMedia[0].caption, /mesmo modelo.*Laranja/is);
  assert.equal(bot.conversation(phone).selectedProduct.id, 'color-g06-orange');
});

test('qual cor sai mais não inventa ranking quando nenhuma variante tem sinal de venda', async () => {
  const phone = '5533977778014';
  const white = product('color-ward-white', 'Guarda Roupa Canadá 6 Portas 4 Gavetas Branco', {
    category: 'Guarda-Roupas',
    pixPrice: 1800,
    stock: 2
  });
  const cinamomo = product('color-ward-cinamomo', 'Guarda Roupa Canadá 6 Portas 4 Gavetas Cinamomo', {
    category: 'Guarda-Roupas',
    pixPrice: 1850,
    stock: 2
  });
  catalogRows = [white, cinamomo];

  bot.patchTestConversation(phone, {
    selectedProduct: bot.compactProduct(white),
    lastProducts: [bot.compactProduct(white)],
    lastProductQuery: 'guarda-roupa',
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'qual cor vende mais?',
    pushName: 'Cliente Cor Segura'
  });

  assert.match(sentTexts.at(-1).text, /não tenho um ranking confiável.*por cor/is);
  assert.doesNotMatch(sentTexts.at(-1).text, /branco.*vende mais|cinamomo.*vende mais/is);
});

test('recomendação consultiva entende necessidade da família antes de despejar catálogo', async () => {
  const phone = '5533977777994';
  catalogRows = [
    product('consult-fridge-1', 'Geladeira Frost Free 380L', {
      category: 'Geladeiras',
      pixPrice: 3234.11,
      stock: 2,
      specs: 'Capacidade Total: 380 litros\nSistema de Degelo: Frost Free\nIluminação LED'
    }),
    product('consult-fridge-2', 'Refrigerador Consul 451L', {
      category: 'Geladeiras',
      pixPrice: 3974,
      stock: 2,
      specs: 'Capacidade Total: 451 litros\nSistema de Degelo: Frost Free\nPainel eletrônico\nFiltro antiodor'
    })
  ];

  await bot.handleMessage({
    phone,
    text: 'estou querendo uma geladeira boa pra minha casa, somos 5 pessoas. Qual você me indica?',
    pushName: 'Cliente Consultivo'
  });

  assert.equal(sentMedia.length, 0);
  assert.match(sentTexts.at(-1).text, /são \*5 pessoas\*/i);
  assert.match(sentTexts.at(-1).text, /capacidade.*tecnologia\/recursos.*economia de energia.*preço/is);
  assert.equal(bot.conversation(phone).recommendationContext.category, 'geladeira');
  assert.equal(bot.conversation(phone).recommendationContext.householdSize, 5);
});

test('recomendação consultiva usa prioridade e orçamento para indicar e explicar com dado real', async () => {
  const phone = '5533977777995';
  catalogRows = [
    product('consult-cap-1', 'Geladeira Frost Free 380L', {
      category: 'Geladeiras',
      pixPrice: 3234.11,
      stock: 2,
      specs: 'Capacidade Total: 380 litros\nSistema de Degelo: Frost Free\nIluminação LED'
    }),
    product('consult-cap-2', 'Refrigerador Consul 451L', {
      category: 'Geladeiras',
      pixPrice: 3974,
      stock: 2,
      specs: 'Capacidade Total: 451 litros\nSistema de Degelo: Frost Free\nPainel eletrônico\nFiltro antiodor'
    }),
    product('consult-cap-3', 'Geladeira Premium 500L Inverter', {
      category: 'Geladeiras',
      pixPrice: 4599,
      stock: 2,
      specs: 'Capacidade Total: 500 litros\nSistema de Degelo: Frost Free\nInverter\nPainel eletrônico'
    })
  ];

  await bot.handleMessage({
    phone,
    text: 'quero uma geladeira boa, somos 5 pessoas, qual você me indica?',
    pushName: 'Cliente Consultivo'
  });

  sentTexts = [];
  backendEvents = [];

  await bot.handleMessage({
    phone,
    text: 'priorizo capacidade e tenho até 4 mil',
    pushName: 'Cliente Consultivo'
  });

  const reply = sentTexts.at(-1).text;
  assert.match(reply, /eu começaria por \*Refrigerador Consul 451L\*/i);
  assert.match(reply, /maior capacidade confirmada.*\*451 L\*/is);
  assert.match(reply, /Preço no PIX.*R\$\s*3\.974,00/is);
  assert.doesNotMatch(reply, /Premium 500L/i);
  assert.equal(bot.conversation(phone).recommendationContext, null);
  assert.equal(bot.conversation(phone).selectedProduct.id, 'consult-cap-2');
  assert.ok(backendEvents.some((event) => event?.metadata?.consultativeRecommendation === true));
});

test('recomendação consultiva de TV prioriza tecnologia comprovada na ficha', async () => {
  const phone = '5533977777996';
  catalogRows = [
    product('consult-tv-1', 'Smart TV 43 Roku 4K', {
      category: 'TVs',
      pixPrice: 1899,
      stock: 3,
      specs: 'Resolução 4K\nSistema Roku TV'
    }),
    product('consult-tv-2', 'Smart TV 50 QLED 4K HDR Google TV', {
      category: 'TVs',
      pixPrice: 2899,
      stock: 2,
      specs: 'Tecnologia QLED\nResolução 4K\nHDR\nGoogle TV\nComando de voz'
    })
  ];

  await bot.handleMessage({
    phone,
    text: 'quero uma tv boa, qual você me indica?',
    pushName: 'Cliente TV'
  });

  assert.match(sentTexts.at(-1).text, /tamanho da tela.*tecnologia\/recursos.*preço/is);

  sentTexts = [];

  await bot.handleMessage({
    phone,
    text: 'quero mais tecnologia e tenho até 3 mil',
    pushName: 'Cliente TV'
  });

  const reply = sentTexts.at(-1).text;
  assert.match(reply, /eu começaria por \*Smart TV 50 QLED 4K HDR Google TV\*/i);
  assert.match(reply, /QLED|HDR|Google TV/i);
  assert.equal(bot.conversation(phone).selectedProduct.id, 'consult-tv-2');
});


test('recomendação de sofá considera lugares e medidas reais do ambiente', async () => {
  const phone = '5533977777997';
  catalogRows = [
    product('consult-sofa-1', 'Sofá Retrátil 3 Lugares Suede', {
      category: 'Sofás',
      pixPrice: 1999,
      stock: 2,
      width: 210,
      height: 100,
      length: 95,
      specs: '3 lugares\nRetrátil\nReclinável\nRevestimento: Suede'
    }),
    product('consult-sofa-2', 'Sofá 5 Lugares Suede', {
      category: 'Sofás',
      pixPrice: 2499,
      stock: 2,
      width: 250,
      height: 105,
      length: 100,
      specs: '5 lugares\nRevestimento: Suede'
    }),
    product('consult-sofa-3', 'Sofá Retrátil 4 Lugares Suede', {
      category: 'Sofás',
      pixPrice: 2399,
      stock: 2,
      width: 225,
      height: 100,
      length: 98,
      specs: '4 lugares\nRetrátil\nReclinável\nRevestimento: Suede'
    })
  ];

  await bot.handleMessage({
    phone,
    text: 'quero um sofá bom para 4 pessoas, minha sala tem largura 230 cm. qual você me indica?',
    pushName: 'Cliente Sofá'
  });

  const reply = sentTexts.at(-1).text;
  assert.match(reply, /eu começaria por \*Sofá Retrátil 4 Lugares Suede\*/i);
  assert.match(reply, /\*4 lugares confirmados\*/i);
  assert.match(reply, /descartei opções.*cabem nas medidas/i);
  assert.equal(bot.conversation(phone).selectedProduct.id, 'consult-sofa-3');
});

test('recomendação de guarda-roupa usa portas e gavetas em vez de critérios de eletro', async () => {
  const phone = '5533977777998';
  catalogRows = [
    product('consult-ward-1', 'Guarda-Roupa Casal 4 Portas 3 Gavetas', {
      category: 'Guarda-Roupas',
      pixPrice: 1899,
      stock: 2,
      specs: '4 portas\n3 gavetas\nMaterial: MDP'
    }),
    product('consult-ward-2', 'Guarda-Roupa Casal 6 Portas 4 Gavetas', {
      category: 'Guarda-Roupas',
      pixPrice: 2499,
      stock: 2,
      specs: '6 portas\n4 gavetas\nMaterial: MDF'
    })
  ];

  await bot.handleMessage({
    phone,
    text: 'quero um guarda roupa bom, qual você me indica?',
    pushName: 'Cliente Guarda Roupa'
  });

  assert.match(sentTexts.at(-1).text, /portas\/gavetas.*medidas.*material\/espelho.*preço/is);

  sentTexts = [];

  await bot.handleMessage({
    phone,
    text: 'quero mais espaço interno, com mais portas e gavetas, até 3 mil',
    pushName: 'Cliente Guarda Roupa'
  });

  const reply = sentTexts.at(-1).text;
  assert.match(reply, /eu começaria por \*Guarda-Roupa Casal 6 Portas 4 Gavetas\*/i);
  assert.match(reply, /\*6 porta\(s\) e 4 gaveta\(s\)\*/i);
  assert.equal(bot.conversation(phone).selectedProduct.id, 'consult-ward-2');
});

test('recomendação de air fryer usa capacidade real em litros', async () => {
  const phone = '5533977777999';
  catalogRows = [
    product('consult-air-1', 'Air Fryer 5L 1500W', {
      category: 'Eletroportáteis',
      pixPrice: 499,
      stock: 3,
      specs: 'Capacidade: 5 litros\nPotência: 1500 W\nTimer\nAntiaderente'
    }),
    product('consult-air-2', 'Air Fryer 8L 1700W', {
      category: 'Eletroportáteis',
      pixPrice: 899,
      stock: 2,
      specs: 'Capacidade: 8 litros\nPotência: 1700 W\nTimer\nPainel digital\nControle de temperatura'
    })
  ];

  await bot.handleMessage({
    phone,
    text: 'quero uma air fryer boa, qual você me indica?',
    pushName: 'Cliente Air Fryer'
  });

  assert.match(sentTexts.at(-1).text, /capacidade.*potência.*funções\/recursos.*preço/is);

  sentTexts = [];

  await bot.handleMessage({
    phone,
    text: 'priorizo capacidade e tenho até 1 mil',
    pushName: 'Cliente Air Fryer'
  });

  const reply = sentTexts.at(-1).text;
  assert.match(reply, /eu começaria por \*Air Fryer 8L 1700W\*/i);
  assert.match(reply, /maior capacidade confirmada.*\*8 L\*/is);
  assert.equal(bot.conversation(phone).selectedProduct.id, 'consult-air-2');
});

test('recomendação de celular usa armazenamento confirmado na ficha', async () => {
  const phone = '5533977778000';
  catalogRows = [
    product('consult-phone-1', 'Smartphone Galaxy A 128GB', {
      category: 'Celulares',
      pixPrice: 1599,
      stock: 3,
      specs: 'Memória interna: 128 GB\nRAM: 6 GB\nBateria: 5000 mAh\nCâmera principal: 50 MP'
    }),
    product('consult-phone-2', 'Smartphone Galaxy B 256GB', {
      category: 'Celulares',
      pixPrice: 2299,
      stock: 2,
      specs: 'Memória interna: 256 GB\nRAM: 8 GB\nBateria: 5000 mAh\nCâmera principal: 50 MP\n5G\nNFC'
    }),
    product('consult-phone-tablet', 'Tablet Positivo Vision Tab 10 128GB', {
      category: 'Celulares e Tablets',
      pixPrice: 1354.56,
      stock: 2,
      specs: 'Memória interna: 128 GB\nRAM: 4 GB\nBateria: 6000 mAh\nCâmera principal: 13 MP'
    })
  ];

  await bot.handleMessage({
    phone,
    text: 'quero um celular bom, qual você me indica?',
    pushName: 'Cliente Celular'
  });

  assert.match(sentTexts.at(-1).text, /câmera.*bateria.*armazenamento\/desempenho.*tecnologia.*preço/is);

  sentTexts = [];

  await bot.handleMessage({
    phone,
    text: 'quero mais armazenamento e tenho até 2500',
    pushName: 'Cliente Celular'
  });

  const reply = sentTexts.at(-1).text;
  assert.match(reply, /eu começaria por \*Smartphone Galaxy B 256GB\*/i);
  assert.match(reply, /maior armazenamento confirmado.*\*256 GB\*/is);
  assert.doesNotMatch(reply, /Tablet Positivo|Vision Tab/i);
  assert.equal(bot.conversation(phone).selectedProduct.id, 'consult-phone-2');
});

test('entrada guarda contexto e valor seguinte vai para análise do Marcelo sem inventar parcela', async () => {
  const phone = '5533977777987';
  const sofa = bot.compactProduct(product('faq-entry-1', 'Sofá Retrátil 3 Lugares', {
    category: 'Sofás',
    pixPrice: 1899,
    cardPrice: 2287.95,
    stock: 2
  }));
  bot.patchTestConversation(phone, {
    selectedProduct: sofa,
    lastProducts: [sofa],
    lastIntent: 'produto'
  });

  await bot.handleMessage({ phone, text: 'e se eu der entrada?', pushName: 'Cliente Entrada' });
  assert.equal(bot.conversation(phone).pendingAction, 'entry_amount_product');
  assert.match(sentTexts.at(-1).text, /Quanto você pretende dar de entrada/i);

  sentTexts = [];
  await bot.handleMessage({ phone, text: 'R$ 500', pushName: 'Cliente Entrada' });
  assert.equal(bot.conversation(phone).pendingAction, '');
  assert.match(sentTexts.at(-1).text, /R\$\s*500,00 de entrada/i);
  assert.match(sentTexts.at(-1).text, /Marcelo analisar/i);
  assert.equal(backendEvents.at(-1).metadata.entryAmount, 500);
});

test('desconto levando dois calcula somente preço oficial e não promete desconto adicional', async () => {
  const phone = '5533977777988';
  const tv = bot.compactProduct(product('faq-qty-1', 'Smart TV LG 43', {
    category: 'TVs',
    pixPrice: 1825.17,
    cardPrice: 2199,
    stock: 3
  }));
  bot.patchTestConversation(phone, {
    selectedProduct: tv,
    lastProducts: [tv],
    lastIntent: 'produto'
  });

  await bot.handleMessage({ phone, text: 'tem desconto levando dois?', pushName: 'Cliente Quantidade' });
  const reply = sentTexts.at(-1).text;
  assert.match(reply, /R\$\s*1\.825,17 por unidade/i);
  assert.match(reply, /2 unidades somam \*R\$\s*3\.650,34\*/i);
  assert.match(reply, /Desconto adicional por quantidade.*análise do Marcelo/i);
  assert.doesNotMatch(reply, /desconto de \d+%/i);
});

test('qual chega mais rápido não inventa prazo diferente por produto', async () => {
  const phone = '5533977777989';
  const first = bot.compactProduct(product('faq-delivery-1', 'Geladeira A 300L', { category: 'Geladeiras', stock: 2 }));
  const second = bot.compactProduct(product('faq-delivery-2', 'Geladeira B 400L', { category: 'Geladeiras', stock: 1 }));
  bot.patchTestConversation(phone, {
    lastProducts: [first, second],
    lastProductQuery: 'geladeira',
    lastIntent: 'produto'
  });

  await bot.handleMessage({ phone, text: 'qual chega mais rápido?', pushName: 'Cliente Entrega' });
  const reply = sentTexts.at(-1).text;
  assert.match(reply, /não registra um prazo diferente por modelo/i);
  assert.match(reply, /até \*24 horas após a confirmação do pedido\*/i);
});

test('comparação entende formas populares e frases imperfeitas do WhatsApp', () => {
  const phrases = [
    'qual a diferença desse produto por esse?',
    'qual a diferença desses dois?',
    'o que muda de um pro outro?',
    'esse é melhor que aquele?',
    'qual compensa mais?',
    'qual vale mais a pena?',
    'por que esse é mais caro?',
    'qual tem mais capacidade?',
    'qual tem a tela maior?',
    'qual é mais potente?',
    'qual parcela fica menor?',
    'qual é mais econômico?',
    'esse ou aquele?',
    'qual dos dois?',
    'esse tem o que o outro não tem?',
    'compara o primeiro com o segundo',
    'oque a primeira e a segunda faz de diferente',
    'o que esses produtos fazem de diferente?'
  ];

  for (const phrase of phrases) {
    assert.equal(bot.asksProductComparison(phrase), true, phrase);
  }
});

test('primeira e segunda compara fichas técnicas em vez de selecionar só a primeira', async () => {
  const phone = '5533977777990';
  const firstRaw = product('cmp-tech-1', 'GELADEIRA FROST FREE 380L TC42 BRANCA 110V', {
    category: 'Geladeiras & Refrigeradores',
    pixPrice: 3234.11,
    cardPrice: 3896.52,
    stock: 1,
    width: 62,
    height: 177.3,
    length: 71,
    description: 'Geladeira Frost Free com Função Turbo Freezer, prateleiras com alturas flexíveis, Gaveta HortiFruti e iluminação em LED.',
    specs: [
      'Capacidade Líquida Total: 380 Litros',
      'Tipo de Degelo: Frost Free',
      'Cor: Branco',
      'Destaques: Função Turbo Freezer, prateleiras com alturas flexíveis e iluminação em LED'
    ].join('\n')
  });
  const secondRaw = product('cmp-tech-2', 'REFRIGERADOR CONSUL 451L BRANCO 110V', {
    category: 'Geladeiras & Refrigeradores',
    brand: 'Consul',
    pixPrice: 3974,
    cardPrice: 4787.95,
    stock: 1,
    width: 70,
    height: 186,
    length: 72,
    description: 'Geladeira Consul Frost Free com Espaço Flex, Prateleira Flex Freezer 3 em 1, Função Turbo, Espaço Frio, Filtro Antiodor, Gelo Extra e iluminação em LED.',
    specs: [
      'Capacidade Total: 451 Litros',
      'Tipo de Degelo: Frost Free',
      'Cor Predominante: Branco',
      'Painel de Controle: Eletrônico (Interno)',
      'Iluminação Interna: LED'
    ].join('\n')
  });
  const thirdRaw = product('cmp-tech-3', 'Geladeira HQ 290L', {
    category: 'Geladeiras',
    pixPrice: 2398,
    cardPrice: 2890,
    stock: 1
  });
  const fourthRaw = product('cmp-tech-4', 'Geladeira HQ 230L', {
    category: 'Geladeiras',
    pixPrice: 2197.40,
    cardPrice: 2647,
    stock: 1
  });

  catalogRows = [firstRaw, secondRaw, thirdRaw, fourthRaw];
  bot.patchTestConversation(phone, {
    lastProducts: catalogRows.map((item) => bot.compactProduct(item)),
    lastProductQuery: 'geladeira',
    lastIntent: 'produto',
    selectedProduct: null
  });

  await bot.handleMessage({
    phone,
    text: 'oque a primeira e a segunda faz de diferente',
    pushName: 'Cliente Comparação Técnica'
  });

  const reply = sentTexts.at(-1).text;
  assert.match(reply, /Comparei a ficha técnica dos dois/i);
  assert.match(reply, /451 L.*380 L.*71 L a mais/is);
  assert.match(reply, /os dois são \*Frost Free\*/i);
  assert.match(reply, /1º .*62 cm L.*177\.3 cm A.*71 cm P/is);
  assert.match(reply, /2º .*70 cm L.*186 cm A.*72 cm P/is);
  assert.match(reply, /O 1º tem e o 2º não traz cadastrado:.*Gaveta HortiFruti/is);
  assert.match(reply, /O 2º tem e o 1º não traz cadastrado:.*Filtro antiodor/is);
  assert.equal(bot.conversation(phone).selectedProduct, null);
  assert.equal(bot.conversation(phone).lastComparedProducts.length, 2);
  assert.equal(bot.conversation(phone).lastComparedProducts[0].id, 'cmp-tech-1');
  assert.equal(bot.conversation(phone).lastComparedProducts[1].id, 'cmp-tech-2');
});

test('pergunta "esses produtos fazem de diferente" continua comparando o mesmo par', async () => {
  const phone = '5533977777991';
  const firstRaw = product('cmp-follow-1', 'Smart TV A 43 4K', {
    category: 'TVs',
    pixPrice: 1800,
    cardPrice: 2160,
    stock: 1,
    description: 'Smart TV 4K com HDR e Roku TV.'
  });
  const secondRaw = product('cmp-follow-2', 'Smart TV B 43 QLED 4K', {
    category: 'TVs',
    pixPrice: 2400,
    cardPrice: 2890,
    stock: 1,
    description: 'Smart TV QLED 4K com HDR, Dolby Audio, Wi-Fi e comando de voz.'
  });
  catalogRows = [firstRaw, secondRaw];

  bot.patchTestConversation(phone, {
    lastProducts: [bot.compactProduct(firstRaw), bot.compactProduct(secondRaw)],
    lastProductQuery: 'tv',
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'compara o primeiro com o segundo',
    pushName: 'Cliente Comparação'
  });

  sentTexts = [];
  await bot.handleMessage({
    phone,
    text: 'oque esses produtos fazem de diferente?',
    pushName: 'Cliente Comparação'
  });

  const reply = sentTexts.at(-1).text;
  assert.match(reply, /Smart TV A 43 4K/i);
  assert.match(reply, /Smart TV B 43 QLED 4K/i);
  assert.match(reply, /QLED|Dolby Audio|Comando de voz/i);
  assert.equal(bot.conversation(phone).lastComparedProducts.length, 2);
});

test('gostei dessa mas queria uma melhor procura o mesmo tipo com mais tecnologia comprovada', async () => {
  const phone = '5533977777992';
  const baselineRaw = product('advanced-base', 'Smart TV LG 43 4K', {
    category: 'TVs',
    brand: 'LG',
    pixPrice: 1825.17,
    cardPrice: 2199,
    stock: 2,
    description: 'Smart TV 4K com HDR.'
  });
  const richerRaw = product('advanced-rich', 'Smart TV Samsung 43 QLED 4K', {
    category: 'TVs',
    brand: 'Samsung',
    pixPrice: 2699,
    cardPrice: 3250,
    stock: 2,
    description: 'Smart TV QLED 4K com HDR, Dolby Audio, Wi-Fi, Bluetooth e comando de voz.'
  });
  const simplerRaw = product('advanced-simple', 'Smart TV Semp 43 4K', {
    category: 'TVs',
    brand: 'Semp',
    pixPrice: 1700,
    cardPrice: 2050,
    stock: 2,
    description: 'Smart TV 4K.'
  });
  const fridgeRaw = product('advanced-wrong-category', 'Geladeira Frost Free 400L', {
    category: 'Geladeiras',
    pixPrice: 3000,
    cardPrice: 3600,
    stock: 2,
    description: 'Geladeira Frost Free Inverter com Wi-Fi.'
  });

  catalogRows = [baselineRaw, richerRaw, simplerRaw, fridgeRaw];
  const baseline = bot.compactProduct(baselineRaw);
  bot.patchTestConversation(phone, {
    selectedProduct: baseline,
    lastProducts: [baseline],
    lastProductQuery: 'tv',
    lastIntent: 'produto'
  });

  assert.equal(bot.asksMoreAdvancedProduct('gostei dessa mais queria uma melhor'), true);

  await bot.handleMessage({
    phone,
    text: 'gostei dessa mais queria uma melhor com mais tecnologia',
    pushName: 'Cliente Upgrade'
  });

  const allText = sentTexts.map((item) => item.text).join('\n');
  const allMedia = sentMedia.map((item) => item.caption || '').join('\n');
  assert.match(allText, /mesmo tipo.*mais recursos cadastrados/i);
  assert.match(allText, /Samsung 43 QLED 4K/i);
  assert.match(allText, /QLED/i);
  assert.match(allText, /Dolby Audio/i);
  assert.match(allText, /Wi-Fi/i);
  assert.match(allMedia, /Samsung 43 QLED 4K/i);
  assert.doesNotMatch(allText + '\n' + allMedia, /Geladeira Frost Free 400L/i);
  assert.equal(backendEvents.at(-1).metadata.moreAdvancedRequested, true);
});

test('gostei da segunda usa o segundo produto comparado como referência para upgrade', async () => {
  const phone = '5533977777994';
  const firstRaw = product('upgrade-ordinal-1', 'Geladeira Continental 380L Frost Free', {
    category: 'Geladeiras & Refrigeradores',
    pixPrice: 3200,
    cardPrice: 3850,
    stock: 1,
    description: 'Geladeira Frost Free com Função Turbo e iluminação LED.'
  });
  const secondRaw = product('upgrade-ordinal-2', 'Geladeira Consul 451L Frost Free', {
    category: 'Geladeiras & Refrigeradores',
    pixPrice: 3974,
    cardPrice: 4787.95,
    stock: 1,
    description: 'Geladeira Frost Free com Função Turbo, Filtro Antiodor, Painel Eletrônico, Espaço Flex e Gelo Extra.'
  });
  const richerRaw = product('upgrade-ordinal-rich', 'Geladeira Premium 480L Inverter Wi-Fi', {
    category: 'Geladeiras & Refrigeradores',
    pixPrice: 4999,
    cardPrice: 6020,
    stock: 1,
    description: 'Geladeira Frost Free Inverter com Wi-Fi, Função Turbo, Filtro Antiodor, Painel Eletrônico, Espaço Flex, Gelo Extra e Prateleira Flex.'
  });

  catalogRows = [firstRaw, secondRaw, richerRaw];
  const first = bot.compactProduct(firstRaw);
  const second = bot.compactProduct(secondRaw);
  bot.patchTestConversation(phone, {
    selectedProduct: null,
    lastProducts: [first, second],
    lastComparedProducts: [first, second],
    lastComparisonAt: Date.now(),
    lastProductQuery: 'geladeira',
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'gostei da segunda mas queria uma melhor com mais tecnologia',
    pushName: 'Cliente Upgrade Ordinal'
  });

  const allText = sentTexts.map((item) => item.text).join('\n');
  const allMedia = sentMedia.map((item) => item.caption || '').join('\n');
  assert.doesNotMatch(allText, /Só me diga qual produto você quer usar como referência/i);
  assert.match(allText, /mais recursos cadastrados que \*Geladeira Consul 451L Frost Free\*/i);
  assert.match(allText, /Geladeira Premium 480L Inverter Wi-Fi/i);
  assert.match(allText, /Inverter/i);
  assert.match(allText, /Wi-Fi/i);
  assert.match(allMedia, /Geladeira Premium 480L Inverter Wi-Fi/i);
  assert.equal(backendEvents.at(-1).metadata.baselineProductId, 'upgrade-ordinal-2');
});

test('frase "qual a diferença desse produto por esse?" compara os dois produtos exibidos', async () => {
  const phone = '5533977777981';
  const first = bot.compactProduct(product('cmp-natural-1', 'Geladeira HQ 230 Litros', {
    category: 'Geladeiras',
    pixPrice: 2197.40,
    cardPrice: 2647
  }));
  const second = bot.compactProduct(product('cmp-natural-2', 'Geladeira Consul 451 Litros', {
    category: 'Geladeiras',
    pixPrice: 3974,
    cardPrice: 4787.95
  }));

  bot.patchTestConversation(phone, {
    lastProducts: [first, second],
    lastProductQuery: 'geladeira',
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'qual a diferença desse produto por esse?',
    pushName: 'Cliente Comparação'
  });

  const reply = sentTexts.at(-1).text;
  assert.match(reply, /Geladeira HQ 230 Litros/i);
  assert.match(reply, /Geladeira Consul 451 Litros/i);
  assert.match(reply, /R\$\s*2\.197,40/i);
  assert.match(reply, /R\$\s*3\.974,00/i);
  assert.doesNotMatch(reply, /melhor produto|qualidade superior|é muito melhor/i);
});

test('comparação por capacidade responde objetivamente quando os litros estão confirmados', async () => {
  const phone = '5533977777982';
  const first = bot.compactProduct(product('cmp-cap-1', 'Geladeira HQ 230 Litros', {
    category: 'Geladeiras',
    pixPrice: 2197.40,
    cardPrice: 2647
  }));
  const second = bot.compactProduct(product('cmp-cap-2', 'Geladeira Consul 451 Litros', {
    category: 'Geladeiras',
    pixPrice: 3974,
    cardPrice: 4787.95
  }));

  bot.patchTestConversation(phone, {
    lastProducts: [first, second],
    lastProductQuery: 'geladeira',
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'qual tem mais capacidade?',
    pushName: 'Cliente Comparação'
  });

  const reply = sentTexts.at(-1).text;
  assert.equal(bot.comparisonFocus('qual tem mais capacidade?'), 'capacity');
  assert.match(reply, /Consul 451 Litros.*451 L.*230 L/is);
});

test('comparação por tela e potência usa somente medidas presentes no nome do produto', () => {
  const tv1 = bot.compactProduct(product('cmp-tv-1', 'Smart TV LG 43 4K', {
    category: 'TVs',
    pixPrice: 1800,
    cardPrice: 2160
  }));
  const tv2 = bot.compactProduct(product('cmp-tv-2', 'Smart TV Samsung 50 4K', {
    category: 'TVs',
    pixPrice: 2200,
    cardPrice: 2640
  }));
  const sound1 = bot.compactProduct(product('cmp-w-1', 'Caixa de Som 500W', {
    category: 'Caixa de som',
    pixPrice: 800,
    cardPrice: 960
  }));
  const sound2 = bot.compactProduct(product('cmp-w-2', 'Caixa de Som 1200W', {
    category: 'Caixa de som',
    pixPrice: 1300,
    cardPrice: 1560
  }));

  const tvReply = bot.productComparisonReply(tv1, tv2, 'qual tem a tela maior?');
  assert.match(tvReply, /Samsung 50 4K.*50 polegadas.*43 polegadas/is);

  const powerReply = bot.productComparisonReply(sound1, sound2, 'qual é mais potente?');
  assert.match(powerReply, /1200W.*1200 W.*500 W/is);
});

test('pergunta sobre motivo de preço não faz Gustavo inventar justificativa técnica', () => {
  const first = bot.compactProduct(product('cmp-reason-1', 'Geladeira A 300 Litros', {
    category: 'Geladeiras',
    pixPrice: 2500,
    cardPrice: 3000
  }));
  const second = bot.compactProduct(product('cmp-reason-2', 'Geladeira B 400 Litros', {
    category: 'Geladeiras',
    pixPrice: 3200,
    cardPrice: 3850
  }));

  const reply = bot.productComparisonReply(first, second, 'por que esse é mais caro?');

  assert.equal(bot.comparisonFocus('por que esse é mais caro?'), 'price_reason');
  assert.match(reply, /diferença de preço está confirmada/i);
  assert.match(reply, /não comprovam o motivo técnico/i);
  assert.doesNotMatch(reply, /porque.*qualidade|porque.*melhor|porque.*premium/i);
});

test('comparação de dois produtos usa dados objetivos e não inventa vencedor de qualidade', async () => {
  const phone = '5533977777912';
  const first = bot.compactProduct(product('cmp-1', 'Geladeira HQ 230 Litros', {
    category: 'Geladeiras',
    pixPrice: 2197.40,
    cardPrice: 2647
  }));
  const second = bot.compactProduct(product('cmp-2', 'Geladeira Consul 451 Litros', {
    category: 'Geladeiras',
    pixPrice: 3974,
    cardPrice: 4787.95
  }));
  bot.patchTestConversation(phone, {
    lastProducts: [first, second],
    lastProductQuery: 'geladeira',
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'qual dessas duas é melhor?',
    pushName: 'Cliente Comparação'
  });

  const reply = sentTexts.at(-1).text;
  assert.match(reply, /Geladeira HQ 230 Litros/i);
  assert.match(reply, /Geladeira Consul 451 Litros/i);
  assert.match(reply, /230 L/i);
  assert.match(reply, /451 L/i);
  assert.match(reply, /mais barato entre esses dois/i);
  assert.match(reply, /sem inventar especificação/i);
  assert.equal(backendEvents.at(-1).metadata.productComparison, true);
});

test('"vou pensar" encerra leve e mantém produto na memória comercial', async () => {
  const phone = '5533977777913';
  const chosen = bot.compactProduct(product('think-1', 'Smart TV LG 50 4K', {
    category: 'TVs',
    pixPrice: 2199,
    cardPrice: 2649
  }));
  bot.patchTestConversation(phone, {
    selectedProduct: chosen,
    lastProducts: [chosen],
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'vou pensar um pouco',
    pushName: 'Cliente Pensando'
  });

  assert.match(sentTexts.at(-1).text, /Fica à vontade/i);
  assert.match(sentTexts.at(-1).text, /Smart TV LG 50 4K/i);
  assert.equal(bot.commercialProfileSnapshot(phone).lastProduct.id, chosen.id);
  assert.equal(bot.commercialProfileSnapshot(phone).salesStage, 'considering');
});

test('sinal de fechamento escolhe produto e pergunta forma de pagamento', async () => {
  const phone = '5533977777914';
  const chosen = bot.compactProduct(product('close-1', 'CAIXA AMP PHILIPS PARTY X4000 1500W', {
    category: 'Caixa de som',
    pixPrice: 1155.85,
    cardPrice: 1392.59
  }));
  bot.patchTestConversation(phone, {
    selectedProduct: chosen,
    lastProducts: [chosen],
    lastIntent: 'produto'
  });

  await bot.handleMessage({
    phone,
    text: 'gostei desse, quero comprar ele',
    pushName: 'Cliente Fechamento'
  });

  assert.equal(bot.conversation(phone).pendingAction, 'purchase_payment_method');
  assert.match(sentTexts.at(-1).text, /PIX.*cartão.*crediário\/carnê/i);
  assert.equal(backendEvents.at(-1).metadata.purchaseIntent, true);
  assert.equal(bot.commercialProfileSnapshot(phone).salesStage, 'purchase_intent');
});

test('fechamento no cartão usa preço oficial, manda link e mantém intenção de compra', async () => {
  const phone = '5533977777915';
  const chosen = bot.compactProduct(product('close-card-1', 'CAIXA AMP PHILIPS PARTY X4000 1500W', {
    category: 'Caixa de som',
    pixPrice: 1155.85,
    cardPrice: 1392.59,
    installmentCount: 12
  }));
  bot.patchTestConversation(phone, {
    selectedProduct: chosen,
    lastProducts: [chosen],
    lastIntent: 'produto',
    pendingAction: 'purchase_payment_method'
  });

  await bot.handleMessage({
    phone,
    text: 'no cartão',
    pushName: 'Cliente Fechamento'
  });

  const reply = sentTexts.at(-1).text;
  assert.match(reply, /12x de R\$\s*116,05/i);
  assert.match(reply, /total de \*?R\$\s*1\.392,59\*?/i);
  assert.match(reply, /arianamoveis\.com\.br\/produto\.html\?id=close-card-1/i);
  assert.equal(bot.conversation(phone).pendingAction, '');
  assert.equal(backendEvents.at(-1).metadata.purchaseIntent, true);
  assert.equal(backendEvents.at(-1).metadata.paymentMode, 'cartao');
});

test('fechamento no carnê entra no fluxo seguro de análise de crédito', async () => {
  const phone = '5533977777916';
  const chosen = bot.compactProduct(product('close-credit-1', 'Sofá Retrátil 3 Lugares', {
    category: 'Sofás',
    pixPrice: 1899,
    cardPrice: 2287.95
  }));
  bot.patchTestConversation(phone, {
    selectedProduct: chosen,
    lastProducts: [chosen],
    lastIntent: 'produto',
    pendingAction: 'purchase_payment_method'
  });

  await bot.handleMessage({
    phone,
    text: 'quero no carnê',
    pushName: 'Cliente Carnê'
  });

  assert.equal(bot.conversation(phone).pendingAction, 'crediario_name');
  assert.match(sentTexts.at(-1).text, /nome completo/i);
  assert.ok(backendEvents.some((event) => /Crediário \/ análise/i.test(event.status || '')));
});

test('lembrete automático de vencimento é apenas registro e não abre memória de cobrança no Gustavo', async () => {
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
  assert.equal(outbound.stateless, true);
  assert.equal(outbound.contextHours, 0);
  assert.equal(bot.conversation(phone).manualHumanUntil, 0);
  assert.equal(bot.hasDailyDueCollectionContext(bot.conversation(phone)), false);

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

  assert.equal(bot.hasDailyDueCollectionContext(bot.conversation(phone)), false);
  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /Bom dia/i);
  assert.doesNotMatch(sentTexts[0].text, /parcela que vence hoje|cobrança|comprovante/i);
});


test('foto de móvel depois de lembrete antigo vai para visão de produto e não para comprovante', async () => {
  const phone = '5533977777789';

  // Simula estado legado deixado por uma versão antiga/um lembrete anterior.
  bot.patchTestConversation(phone, {
    dailyDueContextUntil: Date.now() + (24 * 60 * 60 * 1000),
    dailyDueReminderAt: Date.now() - (24 * 60 * 60 * 1000),
    dailyDueLookupActive: true
  });

  visionClassification = {
    kind: 'product',
    confidence: 0.95,
    product_name: 'Rack buffet para TV',
    brand: '',
    model: '',
    category_hint: 'rack',
    payment_method: 'unknown',
    payment_recipient_name: '',
    summary: 'Móvel para TV com portas'
  };

  catalogRows = [
    product('rack-bel-1', 'Rack Buffet para TV 4 Portas Cinza Madeira', {
      category: 'Rack',
      stock: 2
    })
  ];

  const result = await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: {
        remoteJid: phone + '@s.whatsapp.net',
        fromMe: false,
        id: 'PRODUCT-AFTER-OLD-DUE-REMINDER-1'
      },
      pushName: 'Cliente Produto',
      message: {
        imageMessage: {
          mimetype: 'image/jpeg'
        }
      }
    }
  });

  assert.equal(result.vision, 'product');
  assert.equal(bot.hasDailyDueCollectionContext(bot.conversation(phone)), false);
  assert.ok(
    sentTexts.some((item) => /Pela imagem, identifiquei/i.test(item.text)) ||
    sentMedia.some((item) => /Rack Buffet/i.test(item.caption || ''))
  );
  const all = [
    ...sentTexts.map((item) => item.text),
    ...sentMedia.map((item) => item.caption || '')
  ].join('\n');
  assert.doesNotMatch(all, /parcela que vence hoje|se isso for o comprovante|PIX ou boleto/i);
});

test('comprovante continua sendo reconhecido pelo conteúdo da imagem sem memória do lembrete', async () => {
  const phone = '5533977777788';

  visionClassification = {
    kind: 'payment_receipt_pix',
    confidence: 0.97,
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
        id: 'RECEIPT-WITHOUT-DUE-MEMORY-1'
      },
      pushName: 'Cliente Financeiro',
      message: {
        imageMessage: {
          mimetype: 'image/jpeg'
        }
      }
    }
  });

  assert.equal(result.vision, 'payment_receipt_pix');
  assert.equal(bot.hasDailyDueCollectionContext(bot.conversation(phone)), false);
  assert.match(sentTexts.at(-1).text, /pagamento está sendo analisado/i);
});


test('resposta financeira depois de lembrete é entendida pelo texto atual sem criar memória de cobrança', async () => {
  const phone = '5533977777787';

  await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: {
        remoteJid: phone + '@s.whatsapp.net',
        fromMe: true,
        id: 'STATELESS-DUE-REMINDER-FINANCE-1'
      },
      pushName: 'Cliente Financeiro',
      message: {
        conversation: [
          'Bom dia, Cliente! Tudo bem?',
          'Passando para lembrar que hoje vence uma parcela referente à sua compra realizada aqui na Ariana Móveis.',
          'Se o pagamento já tiver sido realizado, por favor desconsidere esta mensagem.'
        ].join('\n')
      }
    }
  });

  sentTexts = [];
  backendEvents = [];

  await bot.handleWebhook({
    event: 'MESSAGES_UPSERT',
    data: {
      key: {
        remoteJid: phone + '@s.whatsapp.net',
        fromMe: false,
        id: 'STATELESS-DUE-FINANCE-REPLY-1'
      },
      pushName: 'Cliente Financeiro',
      message: { conversation: 'Hoje não consigo, posso pagar amanhã?' }
    }
  });

  assert.equal(bot.hasDailyDueCollectionContext(bot.conversation(phone)), false);
  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /Marcelo|pagamento/i);
  assert.doesNotMatch(sentTexts[0].text, /Estou acompanhando o lembrete|parcela que vence hoje/i);
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


test('Gustavo não recupera nem reativa memória de cobrança do dia pelo backend', async () => {
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

  assert.equal(bot.hasDailyDueCollectionContext(bot.conversation(phone)), false);

  const lookup = requestLog.find((item) =>
    item.href === 'https://backend.test/api/bot/financeiro/vencimento-hoje/contexto'
  );
  assert.equal(lookup, undefined, 'mensagem atual não deve consultar lembrete antigo para decidir o assunto');
  assert.doesNotMatch(sentTexts.map((item) => item.text).join('\n'), /parcela que vence hoje/i);
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

test('conversa LID também não reativa lembrete financeiro antigo pelo telefone real', async () => {
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

  assert.equal(bot.hasDailyDueCollectionContext(bot.conversation(phone)), false);
  const lookup = requestLog.find((item) =>
    item.href === 'https://backend.test/api/bot/financeiro/vencimento-hoje/contexto'
  );
  assert.equal(lookup, undefined);
  assert.doesNotMatch(sentTexts.map((item) => item.text).join('\n'), /parcela que vence hoje/i);
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


test('estado legado de cobrança é descartado no webhook e não força skipLegacy', async () => {
  const phone = '5533988905282';
  const alias = '553388905282';
  const contextPatch = {
    dailyDueContextUntil: Date.now() + (6 * 60 * 60 * 1000),
    dailyDueReminderAt: Date.now()
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
  assert.equal(result.collectionContext, false);
  assert.equal(result.skipLegacy, false);
  assert.equal(bot.hasDailyDueCollectionContext(bot.conversation(alias)), false);
  assert.doesNotMatch(sentTexts.map((item) => item.text).join('\n'), /parcela que vence hoje/i);
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


test('saudação depois de lembrete antigo é saudação normal e não permanece no financeiro', async () => {
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
  assert.equal(result.collectionContext, false);
  assert.equal(result.skipLegacy, false);
  assert.equal(bot.hasDailyDueCollectionContext(bot.conversation(phone)), false);
  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /Boa tarde/i);
  assert.doesNotMatch(sentTexts[0].text, /parcela que vence hoje|chave PIX|comprovante/i);
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


test('print Angela: resposta de bem-estar continua a conversa sem repetir boas-vindas', async () => {
  const phone = '5533977000101';

  await bot.handleMessage({
    phone,
    text: 'Oi boa tarde',
    pushName: 'Angela 2 Cliente'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /^Boa tarde, Angela! 😊 Tudo bem\?/i);

  sentTexts = [];

  await bot.handleMessage({
    phone,
    text: 'Tudo bem sim',
    pushName: 'Angela 2 Cliente'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /^Ah, que bom 😊/i);
  assert.match(sentTexts[0].text, /O que você tá precisando pra hoje\?/i);
  assert.doesNotMatch(sentTexts[0].text, /Seja bem-vind[oa]|Tudo bem\?/i);
});

test('print Angela: ok depois de pedir Marcelo não dispara resposta genérica', async () => {
  const phone = '5533977000102';

  bot.patchTestIntentClassification({
    intent: 'FALAR_COM_MARCELO',
    confidence: 0.99,
    category: '',
    product_reference: '',
    product_ordinal: 0,
    installments: 0,
    payment_method: 'unknown',
    location_hint: ''
  });

  await bot.handleMessage({
    phone,
    text: 'Nesse número eu consigo falar direto com o Marcelo',
    pushName: 'Angela 2 Cliente'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /Marcelo está em outro atendimento/i);

  sentTexts = [];

  await bot.handleMessage({
    phone,
    text: 'Ok',
    pushName: 'Angela 2 Cliente'
  });

  assert.equal(sentTexts.length, 0);
  assert.equal(bot.conversation(phone).marceloCallbackRequested, true);
});

test('print Leiliane: obgd após encaminhamento financeiro recebe só cortesia curta', async () => {
  const phone = '5533977000103';

  bot.patchTestConversation(phone, {
    marceloCallbackRequested: true,
    marceloCallbackRequestedAt: Date.now()
  });

  await bot.handleMessage({
    phone,
    text: 'Obgd',
    pushName: 'Leiliane Cliente'
  });

  assert.equal(sentTexts.length, 1);
  assert.equal(sentTexts[0].text, 'Por nada 😊');
  assert.doesNotMatch(sentTexts[0].text, /Não consigo te ajudar|Marcelo chegar|fotos de produtos/i);
});

test('print Nadia: segunda saudação rápida após comprovante não duplica cumprimento', async () => {
  const phone = '5533977000104';

  await bot.acknowledgePaymentProof(phone, bot.conversation(phone), {
    text: 'Cliente enviou comprovante',
    pushName: 'Nadia Oliveira',
    paymentMethod: 'pix'
  });

  sentTexts = [];

  await bot.handleMessage({
    phone,
    text: 'Oi',
    pushName: 'Nadia Oliveira'
  });

  await bot.handleMessage({
    phone,
    text: 'Bom dia',
    pushName: 'Nadia Oliveira'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /^(?:Bom dia|Boa tarde|Boa noite), Nadia! 😊 Tudo bem\?/i);
});

test('print Nadia: primeira parcela após comprovante é vinculada ao comprovante sem confirmar baixa', async () => {
  const phone = '5533977000105';

  await bot.acknowledgePaymentProof(phone, bot.conversation(phone), {
    text: 'Comprovante PIX recebido',
    pushName: 'Nadia Oliveira',
    paymentMethod: 'pix'
  });

  sentTexts = [];
  backendEvents = [];

  await bot.handleMessage({
    phone,
    text: 'E a primeira parcela tá bom',
    pushName: 'Nadia Oliveira'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /primeira parcela/i);
  assert.match(sentTexts[0].text, /continua em análise/i);
  assert.match(sentTexts[0].text, /baixa só fica confirmada depois da conferência/i);
  assert.doesNotMatch(sentTexts[0].text, /Me conta um pouco mais do produto/i);

  assert.equal(backendEvents.length, 1);
  assert.equal(backendEvents[0].metadata.referenciaParcela, 'primeira');
  assert.equal(backendEvents[0].metadata.naoConfirmarBaixaAutomaticamente, true);
});

test('print Lorrane: indecisão no produto durante crediário recebe ajuda para escolher', async () => {
  const phone = '5533977000106';

  bot.patchTestConversation(phone, {
    pendingAction: 'crediario_product',
    creditContextUntil: Date.now() + 30 * 60 * 1000
  });

  await bot.handleMessage({
    phone,
    text: 'Ainda estou em dúvida',
    pushName: 'Lorrane'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /pode escolher o produto primeiro/i);
  assert.match(sentTexts[0].text, /faixa de valor/i);
  assert.match(sentTexts[0].text, /eu te ajudo a encontrar opções/i);
  assert.doesNotMatch(sentTexts[0].text, /Me conta um pouco mais do produto ou da condição/i);
  assert.equal(bot.conversation(phone).pendingAction, 'crediario_product');
});

test('print Lorrane: como assim explica por que precisa do produto no crediário', async () => {
  const phone = '5533977000107';

  bot.patchTestConversation(phone, {
    pendingAction: 'crediario_product',
    creditContextUntil: Date.now() + 30 * 60 * 1000
  });

  await bot.handleMessage({
    phone,
    text: 'Como assim?',
    pushName: 'Lorrane'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /abrir a solicitação do crediário com o valor correto/i);
  assert.match(sentTexts[0].text, /preciso saber qual produto/i);
  assert.match(sentTexts[0].text, /posso te ajudar a escolher primeiro/i);
});

test('apoio de segundo nível encaminha dúvida sem dado real em vez de inventar', async () => {
  const phone = '5533977000108';
  const tv = bot.compactProduct(product('support-tv-1', 'Smart TV Exemplo 50', {
    category: 'TV',
    stock: 2,
    pixPrice: 1999,
    price: 2399
  }));

  bot.patchTestConversation(phone, {
    selectedProduct: tv,
    lastProducts: [tv],
    lastIntent: 'produto'
  });

  bot.patchTestSupportAdvisory({
    action: 'HUMAN',
    confidence: 0.96,
    reply: 'Quero confirmar essa informação certinho para não te passar algo errado 😊 Vou deixar para o Marcelo verificar e te responder por aqui.',
    reason: 'A especificação perguntada não está presente nos dados confiáveis do produto.'
  });

  await bot.handleMessage({
    phone,
    text: 'Esse modelo tem uma proteção especial que não aparece na descrição?',
    pushName: 'Cliente Apoio'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /confirmar essa informação certinho/i);
  assert.doesNotMatch(sentTexts[0].text, /tem sim|não tem/i);
  assert.equal(bot.conversation(phone).marceloCallbackRequested, true);

  const learning = backendEvents.find((event) => event.status === 'Aprendizado do Gustavo');
  assert.ok(learning, 'deve registrar caso para aprendizado');
  assert.equal(learning.metadata.apoioSegundoNivel, true);
  assert.equal(learning.metadata.supportAction, 'HUMAN');
  assert.equal(learning.metadata.revisarParaRegraFutura, true);
});

test('apoio de segundo nível pode responder com segurança quando há contexto suficiente', async () => {
  const phone = '5533977000109';

  bot.patchTestSupportAdvisory({
    action: 'REPLY',
    confidence: 0.94,
    reply: 'Consigo te ajudar com isso 😊 Me diga qual modelo você está olhando para eu conferir certinho.',
    reason: 'Pergunta comercial segura para pedir identificação do produto.'
  });

  await bot.handleMessage({
    phone,
    text: 'Quero saber uma informação mais específica de um produto',
    pushName: 'Cliente Apoio'
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0].text, /qual modelo você está olhando/i);

  const learning = backendEvents.find((event) => event.status === 'Aprendizado do Gustavo');
  assert.ok(learning);
  assert.equal(learning.metadata.supportAction, 'REPLY');
});
