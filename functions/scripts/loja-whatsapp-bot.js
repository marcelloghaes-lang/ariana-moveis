import http from 'http';
import fs from 'fs';

const PORT = Math.max(1, Number(process.env.LOJA_BOT_PORT || 8093));
const EVOLUTION_API_URL = String(process.env.EVOLUTION_API_URL || 'http://127.0.0.1:8082').replace(/\/$/, '');
const EVOLUTION_API_KEY = String(process.env.EVOLUTION_API_KEY || '').trim();
const EVOLUTION_INSTANCE = String(process.env.LOJA_EVOLUTION_INSTANCE || 'ariana loja').trim();
const BACKEND_URL = String(process.env.ARIANA_BACKEND_URL || 'https://ariana-backend.onrender.com').replace(/\/$/, '');
const LOJA_BOT_API_TOKEN = String(process.env.LOJA_BOT_API_TOKEN || '').trim();

const SITE_URL = 'https://arianamoveis.com.br';
const PIX_KEY = '31985147119';
const PIX_BANK = 'BTG';
const PIX_HOLDER = 'Marcelo Nunes Silva';
const STATE_FILE = String(process.env.LOJA_BOT_STATE_FILE || '/root/loja-bot-state.json');
const HUMAN_TTL_MS = Math.max(1, Number(process.env.LOJA_HUMAN_TTL_HOURS || 12)) * 60 * 60 * 1000;
const LEGACY_WEBHOOK_URL = String(process.env.LOJA_LEGACY_WEBHOOK_URL || '').trim();
const LEGACY_WEBHOOK_BY_EVENTS = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.LOJA_LEGACY_WEBHOOK_BY_EVENTS || '').trim().toLowerCase()
);
const LEGACY_WEBHOOK_HEADERS_B64 = String(process.env.LOJA_LEGACY_WEBHOOK_HEADERS_B64 || '').trim();

const CATEGORY_TERMS = [
  ['sofá', ['sofa', 'sofas']],
  ['geladeira', ['geladeira', 'geladeiras', 'refrigerador', 'refrigeradores']],
  ['fogão', ['fogao', 'fogoes']],
  ['cama', ['cama', 'camas', 'box', 'colchao', 'colchoes']],
  ['celular', ['celular', 'celulares', 'smartphone', 'smartphones', 'iphone']],
  ['tv', ['tv', 'televisao', 'televisor', 'smart tv']],
  ['guarda-roupa', ['guarda roupa', 'guarda-roupa', 'roupeiro']],
  ['máquina de lavar', ['maquina de lavar', 'lavadora', 'lava roupas']],
  ['air fryer', ['air fryer', 'fritadeira eletrica', 'fritadeira']],
  ['micro-ondas', ['microondas', 'micro-ondas']],
  ['ventilador', ['ventilador', 'ventiladores']],
  ['ar-condicionado', ['ar condicionado', 'ar-condicionado']],
  ['freezer', ['freezer', 'freezers']],
  ['frigobar', ['frigobar', 'frigobares']],
  ['mesa', ['mesa', 'mesas']],
  ['cadeira', ['cadeira', 'cadeiras']],
  ['rack', ['rack', 'racks']],
  ['painel', ['painel', 'paineis']],
  ['armário', ['armario', 'armarios']],
  ['cômoda', ['comoda', 'comodas']],
  ['notebook', ['notebook', 'notebooks']],
  ['computador', ['computador', 'computadores', 'pc']],
  ['tablet', ['tablet', 'tablets']],
  ['forno', ['forno', 'fornos']],
  ['liquidificador', ['liquidificador', 'liquidificadores']],
  ['batedeira', ['batedeira', 'batedeiras']],
  ['cafeteira', ['cafeteira', 'cafeteiras']]
];

function normalize(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function digits(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function money(value = 0) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function dateBR(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(d);
}

function yearMonth(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value || '';
  const m = parts.find((p) => p.type === 'month')?.value || '';
  return y && m ? `${y}-${m}` : '';
}

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return {
      conversations: parsed?.conversations || {},
      processed: parsed?.processed || {}
    };
  } catch {
    return { conversations: {}, processed: {} };
  }
}

const state = loadState();
let saveTimer = null;

function saveStateSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const tmp = `${STATE_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
      fs.renameSync(tmp, STATE_FILE);
    } catch (error) {
      console.error('[loja-bot] falha ao salvar estado:', error.message || error);
    }
  }, 150);
  if (typeof saveTimer.unref === 'function') saveTimer.unref();
}

function cleanupState() {
  const now = Date.now();
  for (const [id, at] of Object.entries(state.processed)) {
    if (now - Number(at || 0) > 24 * 60 * 60 * 1000) delete state.processed[id];
  }
  for (const [phone, conv] of Object.entries(state.conversations)) {
    const lastAt = Number(conv?.lastAt || 0);
    if (lastAt && now - lastAt > 7 * 24 * 60 * 60 * 1000) delete state.conversations[phone];
  }
  saveStateSoon();
}
setInterval(cleanupState, 60 * 60 * 1000).unref?.();

function conversation(phone) {
  const key = digits(phone);
  if (!state.conversations[key]) {
    state.conversations[key] = {
      lastAt: Date.now(),
      lastProducts: [],
      allProductResults: [],
      productResultOffset: 0,
      lastProductQuery: '',
      selectedProduct: null,
      pendingAction: '',
      humanUntil: 0,
      customerName: '',
      lastIntent: ''
    };
  }
  state.conversations[key].lastAt = Date.now();
  return state.conversations[key];
}

function productId(product = {}) {
  return String(product.id || product._id || '').trim();
}

function productCashPrice(product = {}) {
  const pix = Number(product.pixPrice || 0);
  const price = Number(product.price || 0);
  return pix > 0 ? pix : price;
}

function productFullPrice(product = {}) {
  return Number(product.price || productCashPrice(product) || 0);
}

function productLink(product = {}) {
  const id = productId(product);
  return id ? `${SITE_URL}/produto.html?id=${encodeURIComponent(id)}` : SITE_URL;
}

function compactProduct(product = {}) {
  return {
    id: productId(product),
    name: String(product.name || 'Produto').trim(),
    brand: String(product.brand || '').trim(),
    category: String(product.category || product.categoryName || '').trim(),
    price: Number(product.price || 0),
    pixPrice: Number(product.pixPrice || 0),
    oldPrice: Number(product.oldPrice || 0),
    installmentCount: Number(product.installmentCount || 12),
    stock: Number(product.stock || 0),
    imageUrl: String(product.imageUrl || '').trim()
  };
}

async function readJson(response) {
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) {
    const error = new Error(data?.error || data?.message || `HTTP ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function backend(path, { method = 'GET', body = null, botAuth = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (botAuth && LOJA_BOT_API_TOKEN) headers['x-loja-bot-token'] = LOJA_BOT_API_TOKEN;
  const response = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers,
    body: body === null ? undefined : JSON.stringify(body)
  });
  return readJson(response);
}

async function evolution(path, body) {
  if (!EVOLUTION_API_KEY) throw new Error('EVOLUTION_API_KEY não configurada.');
  const response = await fetch(`${EVOLUTION_API_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: EVOLUTION_API_KEY
    },
    body: JSON.stringify(body)
  });
  return readJson(response);
}

async function sendText(phone, text) {
  return evolution(`/message/sendText/${encodeURIComponent(EVOLUTION_INSTANCE)}`, {
    number: digits(phone),
    text: String(text || '').trim()
  });
}

async function sendImage(phone, imageUrl, caption) {
  if (!/^https?:\/\//i.test(String(imageUrl || ''))) {
    return sendText(phone, caption);
  }
  try {
    return await evolution(`/message/sendMedia/${encodeURIComponent(EVOLUTION_INSTANCE)}`, {
      number: digits(phone),
      mediatype: 'image',
      media: imageUrl,
      caption: String(caption || '').trim()
    });
  } catch (error) {
    console.warn('[loja-bot] imagem falhou, enviando texto:', error.message || error);
    return sendText(phone, caption);
  }
}

function detectCategory(text) {
  const n = normalize(text);
  for (const [query, aliases] of CATEGORY_TERMS) {
    if (aliases.some((alias) => n.includes(normalize(alias)))) return query;
  }
  return '';
}

function isGreeting(text) {
  const n = normalize(text)
    .replace(/[!?.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (/^(oi|ola|oie|bom dia|boa tarde|boa noite|tudo bem)$/.test(n)) return true;

  return /^(oi|ola|oie)?\s*(bom dia|boa tarde|boa noite)?\s*(tudo bem|td bem|como vai)?\s*$/.test(n);
}

function wantsHuman(text) {
  const n = normalize(text);
  return [
    'falar com o marcelo', 'falar com marcelo', 'quero falar com o marcelo',
    'quero falar com marcelo', 'marcelo esta ai', 'marcelo ta ai',
    'falar com atendente', 'falar com uma pessoa', 'atendimento humano',
    'quero um atendente'
  ].some((v) => n.includes(v));
}

function asksPaymentMethods(text) {
  const n = normalize(text);
  return /forma(s)? de pagamento|como (eu )?posso pagar|aceita cartao|aceitam cartao|aceita pix|aceita boleto|pagamento.{0,15}boleto|faz no carne|trabalha com carne|tem crediario/.test(n);
}

function asksPixKey(text) {
  const n = normalize(text);
  return /(manda|me passa|passa|envia|qual|chave).{0,20}pix|pix.{0,20}(chave|numero|qual)/.test(n);
}

function asksCardQuote(text) {
  const n = normalize(text);
  return /(quanto|valor|fica|parcel).{0,30}(cartao|credito)|(cartao|credito).{0,30}(quanto|valor|fica|parcel)/.test(n);
}

function asksPixPrice(text) {
  const n = normalize(text);
  return /(quanto|valor|fica|preco).{0,25}(no pix|pix)|(no pix|pix).{0,25}(quanto|valor|fica|preco)/.test(n);
}

function asksProductLink(text) {
  const n = normalize(text);
  return /manda.{0,20}link|me passa.{0,20}link|envia.{0,20}link|link do produto|link desse|link dessa/.test(n);
}

function asksDelivery(text) {
  const n = normalize(text);
  return /entrega|entregam|quando chega|chega que dia|manda pra|manda para/.test(n);
}

function asksFinance(text) {
  const n = normalize(text);
  return /minha notinha|minha nota ai|quanto tenho que (te )?passar|quanto (eu )?tenho que pagar|quanto vence|minha prestacao|meu carnezinho|minha conta ai|quanto que eu te devo|valor da minha nota/.test(n);
}

function asksHowToBuyCredit(text) {
  const n = normalize(text);

  if (/fazer crediario|abrir crediario|quero no carne|quero fazer no carne/.test(n)) return true;

  const mentionsCredit = /(carne|crediario|boleto)/.test(n);
  if (!mentionsCredit) return false;

  return (
    /(como|queria|gostaria|quero|pode|posso|da pra|tem como).{0,45}(comprar|fazer|pegar).{0,45}(carne|crediario|boleto)/.test(n) ||
    /(comprar|fazer|pegar).{0,35}(ele|esse|essa|este|esta|produto)?.{0,20}(carne|crediario|boleto)/.test(n) ||
    /(ele|esse|essa|este|esta|produto).{0,25}(no|na|pelo|pela).{0,10}(carne|crediario|boleto)/.test(n)
  );
}

function asksMoreProducts(text) {
  const n = normalize(text);
  return /mostrar mais|mostra mais|ver mais|tem mais|mais opcoes|outras opcoes|outros modelos|outras alternativas|tem outro|tem outros|quero ver mais/.test(n);
}

function asksCreditQuote(text) {
  const n = normalize(text);
  return /quanto fica.{0,30}(boleto|carne|crediario)|quanto (da|fica) em \d{1,2}x|\d{1,2}x.{0,20}(boleto|carne|crediario)|parcelar.{0,20}(boleto|carne|crediario)/.test(n);
}

function parseInstallments(text) {
  const n = normalize(text);
  const patterns = [
    /(?:em\s*)?(\d{1,2})\s*x\b/,
    /(?:em\s*)?(\d{1,2})\s*(?:vezes|parcelas)\b/
  ];
  for (const pattern of patterns) {
    const match = n.match(pattern);
    if (match) return Number(match[1]);
  }
  return 0;
}

function creditDivisor(count) {
  if (count >= 1 && count <= 4) return 0.80;
  if (count <= 6) return 0.75;
  if (count <= 12) return 0.70;
  if (count <= 15) return 0.67;
  return 0;
}

function creditPlan(product, count) {
  const base = productCashPrice(product);
  const max = base > 2500 ? 15 : 12;
  if (!count) return { base, max, divisor: 0, total: 0, installment: 0 };
  if (count < 1 || count > max) return { base, max, invalid: true, divisor: 0, total: 0, installment: 0 };
  const divisor = creditDivisor(count);
  if (!divisor) return { base, max, invalid: true, divisor: 0, total: 0, installment: 0 };
  const total = Math.round((base / divisor) * 100) / 100;
  const installment = Math.round((total / count) * 100) / 100;
  return { base, max, divisor, total, installment, invalid: false };
}

function ordinalIndex(text) {
  const n = normalize(text);
  const entries = [
    [0, ['primeiro', 'primeira', '1º', '1o']],
    [1, ['segundo', 'segunda', '2º', '2o']],
    [2, ['terceiro', 'terceira', '3º', '3o']],
    [3, ['quarto', 'quarta', '4º', '4o']]
  ];
  for (const [idx, words] of entries) {
    if (words.some((w) => n.includes(w))) return idx;
  }
  return -1;
}

function productCaption(product, index = null) {
  const cash = productCashPrice(product);
  const full = productFullPrice(product);
  const count = Math.max(1, Number(product.installmentCount || 12));
  const installment = full > 0 ? full / count : 0;
  const lines = [];
  if (index !== null) lines.push(`*${index + 1}. ${product.name}*`);
  else lines.push(`*${product.name}*`);
  if (cash > 0) lines.push(`À vista no PIX: *${money(cash)}*`);
  if (full > 0 && count > 1) lines.push(`Cartão: até ${count}x de ${money(installment)}`);
  lines.push(`Veja no site: ${productLink(product)}`);
  return lines.join('\n');
}

function matchesRequestedProductType(product = {}, query = '') {
  const requested = normalize(query);
  const haystack = normalize([
    product.name,
    product.category,
    product.brand
  ].filter(Boolean).join(' '));

  if (requested === 'geladeira' || requested === 'refrigerador') {
    return !/\bfreezer\b|\bfrigobar\b/.test(haystack);
  }

  if (requested === 'freezer') {
    return /\bfreezer\b/.test(haystack);
  }

  if (requested === 'frigobar') {
    return /\bfrigobar\b/.test(haystack);
  }

  return true;
}

async function searchProducts(query, originalText = '') {
  const q = encodeURIComponent(query);
  const data = await backend(`/api/products?q=${q}&limit=100`);
  const rows = Array.isArray(data) ? data : Array.isArray(data?.products) ? data.products : [];
  let products = rows
    .map(compactProduct)
    .filter((p) => p.id && Number(p.stock || 0) > 0 && productCashPrice(p) > 0)
    .filter((p) => matchesRequestedProductType(p, query));

  const seen = new Set();
  products = products.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  const n = normalize(originalText);
  if (/mais barato|baratinho|menor preco|mais em conta/.test(n)) {
    products = products.sort((a, b) => productCashPrice(a) - productCashPrice(b));
  }
  return products;
}

async function sendProductPage(phone, conv, { announce = true } = {}) {
  const all = Array.isArray(conv.allProductResults) ? conv.allProductResults : [];
  const offset = Math.max(0, Number(conv.productResultOffset || 0));
  const page = all.slice(offset, offset + 4);

  if (!page.length) {
    await sendText(phone, 'Essas são todas as opções disponíveis que encontrei no catálogo no momento 😊');
    return;
  }

  conv.lastProducts = page;
  conv.selectedProduct = page.length === 1 ? page[0] : null;
  conv.productResultOffset = offset + page.length;
  conv.lastIntent = 'produto';
  saveStateSoon();

  if (announce) {
    if (all.length === 1) {
      await sendText(phone, 'Encontrei este produto disponível no momento 😊');
    } else if (offset === 0) {
      await sendText(
        phone,
        all.length > 4
          ? `Encontrei *${all.length} opções disponíveis* no catálogo. Vou te mostrar as primeiras 4:`
          : `Encontrei *${all.length} opções disponíveis* no momento. Vou te mostrar:`
      );
    } else {
      await sendText(phone, `Claro 😊 Aqui vão mais ${page.length} opções:`);
    }
  }

  for (let i = 0; i < page.length; i += 1) {
    await sendImage(phone, page[i].imageUrl, productCaption(page[i], page.length > 1 ? i : null));
  }

  const remaining = Math.max(0, all.length - conv.productResultOffset);
  if (page.length > 1) {
    let message = 'Se gostar de algum, pode me falar “o primeiro”, “o segundo” etc. que eu continuo por ele.';
    if (remaining > 0) {
      message += `\n\nAinda tenho *${remaining} opção(ões)*. Se quiser ver, é só dizer *“mostrar mais”*.`;
    }
    await sendText(phone, message);
  }
}

async function showProducts(phone, conv, query, originalText) {
  const products = await searchProducts(query, originalText);
  if (!products.length) {
    await sendText(phone, `No momento não encontrei *${query}* disponível no catálogo da Ariana Móveis. Se quiser, me diga outro produto que você está procurando 😊`);
    return;
  }

  conv.allProductResults = products;
  conv.productResultOffset = 0;
  conv.lastProductQuery = query;
  conv.selectedProduct = null;
  saveStateSoon();

  await sendProductPage(phone, conv, { announce: true });
}

async function showMoreProducts(phone, conv) {
  const all = Array.isArray(conv.allProductResults) ? conv.allProductResults : [];
  if (!all.length) {
    await sendText(phone, 'Me diga qual produto você quer procurar que eu consulto o catálogo para você 😊');
    return;
  }

  if (Number(conv.productResultOffset || 0) >= all.length) {
    await sendText(phone, 'Essas são todas as opções disponíveis que encontrei no catálogo no momento 😊');
    return;
  }

  await sendProductPage(phone, conv, { announce: true });
}

async function syncTicket(phone, { status, message, name = '' } = {}) {
  try {
    await backend('/api/bot/atendimento/evento', {
      method: 'POST',
      botAuth: true,
      body: {
        protocolo: `LOJA-${digits(phone)}`,
        telefone: digits(phone),
        setor: 'loja',
        status: status || 'Aguardando atendimento',
        mensagem: message || '',
        nome
      }
    });
  } catch (error) {
    console.warn('[loja-bot] falha ao sincronizar atendimento:', error.message || error);
  }
}

function paymentMethodsReply() {
  return [
    'Trabalhamos com *PIX, dinheiro, cartão de crédito* e também com o *crediário próprio da Ariana Móveis no carnê* 😊',
    '',
    'O crediário é sujeito à análise de crédito. Se quiser, posso calcular uma condição para o produto que você está olhando.'
  ].join('\n');
}

function deliveryReply(text) {
  const n = normalize(text);
  if (n.includes('zona rural') || /outra cidade|outra cidade|fora de guanhaes|outra regiao/.test(n)) {
    return {
      text: 'Para zona rural ou outra cidade, preciso consultar nosso setor logístico para te passar o dia certinho da entrega. Vou deixar a consulta registrada para você.',
      needsLogistics: true
    };
  }
  if (n.includes('guanhaes') || /dentro da cidade|aqui na cidade|na cidade/.test(n)) {
    return {
      text: 'Para entregas dentro da cidade de Guanhães, normalmente conseguimos entregar em até *24 horas após a confirmação do pedido* 😊',
      needsLogistics: false
    };
  }
  return {
    text: 'Entregamos sim 😊 Se for dentro da cidade de Guanhães, normalmente é em até *24 horas após a confirmação do pedido*. Para zona rural ou outra cidade, eu preciso consultar o setor logístico para te passar o dia certo. Sua entrega seria em Guanhães, zona rural ou outra cidade?',
    needsLogistics: false
  };
}

function financialReply(data = {}) {
  const parcelas = Array.isArray(data.parcelas) ? data.parcelas : [];
  const open = parcelas.filter((p) => {
    const status = normalize(p.status);
    return p.quitado !== true && !['paga', 'pago', 'quitada', 'quitado', 'paid'].includes(status);
  });

  const currentYm = yearMonth();
  const current = open.filter((p) => yearMonth(p.dataVencimento) === currentYm);
  const overdue = open.filter((p) => Number(p?.atualizacaoFinanceira?.diasAtraso || 0) > 0);
  const future = open
    .filter((p) => Number(p?.atualizacaoFinanceira?.diasAtraso || 0) <= 0)
    .sort((a, b) => new Date(a.dataVencimento || 0) - new Date(b.dataVencimento || 0));

  const amountOf = (p) => Number(
    p?.atualizacaoFinanceira?.valorAtualizado ??
    p?.saldoParcela ??
    p?.valorParcela ??
    0
  );

  const name = String(data?.cliente?.nome || '').trim().split(/\s+/)[0];
  const lines = [`Claro${name ? `, ${name}` : ''} 😊 Consultei seu carnê.`];

  if (current.length) {
    const total = current.reduce((sum, p) => sum + amountOf(p), 0);
    lines.push(`Neste mês você tem *${money(total)}* para pagar.`);
    for (const p of current.slice(0, 5)) {
      lines.push(`• ${p.parcelaLabel || 'Parcela'} — vence em ${dateBR(p.dataVencimento)} — ${money(amountOf(p))}`);
    }
  } else {
    lines.push('Não encontrei parcela com vencimento neste mês.');
  }

  const overdueOutsideCurrent = overdue.filter((p) => yearMonth(p.dataVencimento) !== currentYm);
  if (overdueOutsideCurrent.length) {
    const totalLate = overdueOutsideCurrent.reduce((sum, p) => sum + amountOf(p), 0);
    lines.push(`Há também ${overdueOutsideCurrent.length} parcela(s) vencida(s), totalizando *${money(totalLate)}* com a atualização registrada no sistema.`);
  }

  if (!current.length && !overdue.length && future.length) {
    const next = future[0];
    lines.push(`A próxima é ${next.parcelaLabel || 'uma parcela'}, com vencimento em ${dateBR(next.dataVencimento)}, no valor de *${money(amountOf(next))}*.`);
  }

  if (!open.length) lines.push('Não há parcelas em aberto no carnê consultado.');
  return lines.join('\n');
}

async function consultFinance(phone, cpf = '') {
  const body = cpf
    ? { phone: digits(phone), cpf: digits(cpf) }
    : { phone: digits(phone) };
  return backend('/api/bot/financeiro/carne', {
    method: 'POST',
    botAuth: true,
    body
  });
}

async function startCreditApplication(phone, conv) {
  const product = conv.selectedProduct || (conv.lastProducts.length === 1 ? conv.lastProducts[0] : null);
  if (!product) {
    conv.pendingAction = 'crediario_product';
    saveStateSoon();
    await sendText(phone, 'Claro 😊 Primeiro me diga qual produto você quer comprar no carnê, para eu abrir a solicitação com o valor correto.');
    return;
  }

  if (!conv.customerName || conv.customerName.split(/\s+/).filter(Boolean).length < 2) {
    conv.pendingAction = 'crediario_name';
    saveStateSoon();
    await sendText(phone, `Certo 😊 Vou abrir a solicitação para *${product.name}*. Me informe seu *nome completo*, por favor.`);
    return;
  }

  const plan = conv.lastCreditPlan || null;
  const result = await backend('/api/bot/crediario/analises/loja', {
    method: 'POST',
    botAuth: true,
    body: {
      customerName: conv.customerName,
      phone: digits(phone),
      baseAmountCents: Math.round(productCashPrice(product) * 100),
      purchaseDescription: product.name,
      parcelas: plan?.count || 0,
      divisor: plan?.divisor || 0,
      storeReference: 'whatsapp_principal'
    }
  });

  conv.pendingAction = '';
  saveStateSoon();

  await sendText(
    phone,
    result?.existing
      ? 'Sua solicitação de crediário já está aberta 😊 Confira o WhatsApp do Crediário Ariana Móveis e siga a solicitação de documentos por lá.'
      : 'Pronto 😊 Vou te enviar a solicitação de documentos pelo número do *Crediário Ariana Móveis*. Quando a mensagem chegar, responda *ACEITO* e siga as orientações para enviar os dados e documentos.'
  );
}

function parseFullName(text) {
  const raw = String(text || '').trim().replace(/^(meu nome (e|é)|sou)\s+/i, '').trim();
  const words = raw.split(/\s+/).filter(Boolean);
  return words.length >= 2 && raw.length <= 160 ? raw : '';
}

async function handlePending(phone, text, conv) {
  if (conv.pendingAction === 'finance_cpf') {
    const cpf = digits(text);
    if (cpf.length !== 11) {
      await sendText(phone, 'Para proteger seus dados, me envie o *CPF do titular com 11 números*, por favor.');
      return true;
    }
    try {
      const data = await consultFinance(phone, cpf);
      conv.pendingAction = '';
      saveStateSoon();
      await sendText(phone, financialReply(data));
    } catch (error) {
      await sendText(phone, 'Não consegui confirmar os dados desse carnê. Vou deixar para o Financeiro verificar com você.');
      conv.pendingAction = '';
      conv.humanUntil = Date.now() + HUMAN_TTL_MS;
      saveStateSoon();
      await syncTicket(phone, {
        status: 'Financeiro - conferir carnê',
        message: 'Cliente solicitou valor da notinha/carnê e a consulta automática não confirmou a identidade.'
      });
    }
    return true;
  }

  if (conv.pendingAction === 'crediario_name') {
    const name = parseFullName(text);
    if (!name) {
      await sendText(phone, 'Me informe seu *nome completo* para eu abrir a solicitação do crediário.');
      return true;
    }
    conv.customerName = name;
    saveStateSoon();
    await startCreditApplication(phone, conv);
    return true;
  }

  if (conv.pendingAction === 'crediario_product') {
    const category = detectCategory(text);
    if (category) {
      conv.pendingAction = '';
      saveStateSoon();
      await showProducts(phone, conv, category, text);
      await sendText(phone, 'Quando escolher um deles, me diga qual é e eu continuo a solicitação do carnê.');
      return true;
    }
  }

  return false;
}

async function handleMessage({ phone, text, pushName = '' }) {
  const conv = conversation(phone);
  const n = normalize(text);

  if (conv.humanUntil && Date.now() < Number(conv.humanUntil)) {
    return;
  }

  if (await handlePending(phone, text, conv)) return;

  if (wantsHuman(text)) {
    conv.humanUntil = Date.now() + HUMAN_TTL_MS;
    conv.pendingAction = '';
    saveStateSoon();
    await sendText(phone, 'Claro 😊 Vou deixar sua conversa para o Marcelo. Pode me adiantar o assunto por aqui que ele consegue acompanhar a conversa.');
    await syncTicket(phone, {
      status: 'Aguardando Marcelo',
      message: text,
      name: pushName
    });
    return;
  }

  if (asksPixKey(text)) {
    await sendText(phone, `Claro 😊\n\n*PIX:* ${PIX_KEY}\n*Banco:* ${PIX_BANK}\n*Titular:* ${PIX_HOLDER}`);
    return;
  }

  if (asksFinance(text)) {
    try {
      const data = await consultFinance(phone);
      await sendText(phone, financialReply(data));
    } catch (error) {
      if (error?.status === 409 || error?.data?.identityRequired) {
        conv.pendingAction = 'finance_cpf';
        saveStateSoon();
        await sendText(phone, 'Claro 😊 Para proteger seus dados, me confirme o *CPF do titular com 11 números* para eu consultar o valor certinho.');
      } else {
        await sendText(phone, 'Não consegui consultar sua notinha automaticamente agora. Vou deixar a solicitação registrada para o Financeiro conferir.');
        conv.humanUntil = Date.now() + HUMAN_TTL_MS;
        saveStateSoon();
        await syncTicket(phone, {
          status: 'Financeiro - conferir carnê',
          message: text,
          name: pushName
        });
      }
    }
    return;
  }

  if (asksDelivery(text)) {
    const delivery = deliveryReply(text);
    await sendText(phone, delivery.text);
    if (delivery.needsLogistics) {
      await syncTicket(phone, {
        status: 'Consultar logística',
        message: text,
        name: pushName
      });
    }
    return;
  }

  if (asksPaymentMethods(text) && !asksHowToBuyCredit(text) && !asksCreditQuote(text) && !asksCardQuote(text) && !asksPixPrice(text)) {
    await sendText(phone, paymentMethodsReply());
    return;
  }

  if (asksProductLink(text)) {
    const product = conv.selectedProduct || (conv.lastProducts.length === 1 ? conv.lastProducts[0] : null);
    if (!product) {
      await sendText(phone, 'Claro 😊 Me diga qual produto você quer que eu te mande o link.');
    } else {
      await sendText(phone, `Aqui está o link de *${product.name}*: ${productLink(product)}`);
    }
    return;
  }

  if (asksCardQuote(text)) {
    const product = conv.selectedProduct || (conv.lastProducts.length === 1 ? conv.lastProducts[0] : null);
    if (!product) {
      await sendText(phone, 'Consigo calcular sim 😊 Me diga qual produto você está olhando.');
      return;
    }
    const full = productFullPrice(product);
    const count = Math.max(1, Number(product.installmentCount || 12));
    await sendText(phone, `No cartão, *${product.name}* fica em até *${count}x de ${money(full / count)}*, total de *${money(full)}*.`);
    return;
  }

  if (asksPixPrice(text)) {
    const product = conv.selectedProduct || (conv.lastProducts.length === 1 ? conv.lastProducts[0] : null);
    if (!product) {
      await sendText(phone, 'Claro 😊 Me diga qual produto você está olhando para eu te passar o valor no PIX.');
      return;
    }
    await sendText(phone, `No PIX, *${product.name}* fica por *${money(productCashPrice(product))}*.`);
    return;
  }

  const ord = ordinalIndex(text);
  if (ord >= 0 && Array.isArray(conv.lastProducts) && conv.lastProducts[ord]) {
    conv.selectedProduct = conv.lastProducts[ord];
    saveStateSoon();
    await sendText(phone, `Perfeito 😊 Você escolheu *${conv.selectedProduct.name}*. O que você gostaria de saber dele: cartão, PIX, carnê, entrega ou quer comprar?`);
    return;
  }

  if (asksCreditQuote(text)) {
    let product = conv.selectedProduct || (conv.lastProducts.length === 1 ? conv.lastProducts[0] : null);
    if (!product) {
      const quoteCategory = detectCategory(text);
      if (quoteCategory) {
        await showProducts(phone, conv, quoteCategory, text);
        await sendText(phone, 'Escolha uma dessas opções e eu calculo o carnê certinho para você.');
        return;
      }
      await sendText(phone, 'Consigo calcular sim 😊 Me diga qual produto você está olhando para eu usar o valor correto do catálogo.');
      return;
    }

    const count = parseInstallments(text);
    const plan = creditPlan(product, count);

    if (!count) {
      await sendText(phone, `Para *${product.name}*, consigo fazer no crediário próprio em até *${plan.max}x*. Em quantas vezes você gostaria que eu calculasse?`);
      return;
    }

    if (plan.invalid) {
      await sendText(phone, `Para esse produto, o máximo no crediário é *${plan.max}x*. Se quiser, posso calcular em qualquer quantidade até ${plan.max} parcelas.`);
      return;
    }

    conv.lastCreditPlan = { count, divisor: plan.divisor, total: plan.total, installment: plan.installment };
    saveStateSoon();
    await sendText(
      phone,
      `No crediário próprio, para *${product.name}*, em *${count}x* fica aproximadamente *${count}x de ${money(plan.installment)}*, total de *${money(plan.total)}*. A compra no carnê é sujeita à análise de crédito.\n\nSe quiser seguir com o carnê, eu já posso iniciar a solicitação para você.`
    );
    return;
  }

  if (asksHowToBuyCredit(text) || (conv.lastCreditPlan && /quero|pode fazer|vamos fazer|pode iniciar|pode abrir/.test(n) && /carne|crediario|boleto/.test(n))) {
    await startCreditApplication(phone, conv);
    return;
  }

  const category = detectCategory(text);
  if (category) {
    await showProducts(phone, conv, category, text);
    return;
  }

  if (asksMoreProducts(text) && conv.lastIntent === 'produto') {
    await showMoreProducts(phone, conv);
    return;
  }

  if (/mais barato|mais em conta|baratinho|menor preco/.test(n) && conv.lastIntent === 'produto') {
    const categoryFromLast = conv.lastProductQuery || conv.lastProducts?.[0]?.category || conv.lastProducts?.[0]?.name || '';
    if (categoryFromLast) {
      await showProducts(phone, conv, categoryFromLast, text);
      return;
    }
  }

  if (isGreeting(text)) {
    const nGreeting = normalize(text);
    let saudacao = 'Olá';
    if (nGreeting.includes('bom dia')) saudacao = 'Bom dia';
    else if (nGreeting.includes('boa tarde')) saudacao = 'Boa tarde';
    else if (nGreeting.includes('boa noite')) saudacao = 'Boa noite';

    await sendText(phone, `${saudacao}! 😊 Tudo bem? Seja bem-vindo à Ariana Móveis. Como posso te ajudar hoje?`);
    return;
  }

  if (/trabalha com|voces vendem|vocês vendem|o que voces vendem|o que vocês vendem/.test(n)) {
    await sendText(phone, 'Trabalhamos com móveis, eletrodomésticos, eletrônicos, celulares e eletroportáteis 😊 Me diga o que você está procurando que eu consulto o que temos disponível no site agora.');
    return;
  }

  if (/quero comprar|gostei desse|gostei desta|vou ficar com esse|vou querer esse/.test(n)) {
    const product = conv.selectedProduct || (conv.lastProducts.length === 1 ? conv.lastProducts[0] : null);
    if (product) {
      await sendText(phone, `Ótimo 😊 Você pode ver e comprar *${product.name}* por aqui: ${productLink(product)}\n\nSe preferir, me diga a forma de pagamento que você quer usar e eu te ajudo.`);
      return;
    }
  }

  await sendText(phone, 'Claro 😊 Me conta o que você está procurando. Posso consultar produtos e preços, formas de pagamento, carnê, PIX, entrega ou sua notinha.');
}

function extractIncoming(payload = {}) {
  const data = payload?.data || payload;
  const key = data?.key || payload?.key || {};
  const message = data?.message || payload?.message || {};
  const remoteJid = String(
    key?.remoteJid ||
    data?.remoteJid ||
    data?.sender ||
    payload?.sender ||
    ''
  );
  const fromMe = key?.fromMe === true || data?.fromMe === true || payload?.fromMe === true;
  const id = String(key?.id || data?.id || payload?.id || data?.messageId || '');
  const pushName = String(data?.pushName || payload?.pushName || '');
  const text = String(
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption ||
    message?.documentMessage?.caption ||
    data?.body ||
    data?.text ||
    payload?.body ||
    ''
  ).trim();

  return {
    remoteJid,
    phone: digits(remoteJid.split('@')[0]),
    fromMe,
    id,
    pushName,
    text,
    isGroup: remoteJid.endsWith('@g.us'),
    isStatus: remoteJid.includes('status@broadcast')
  };
}

function legacyHeaders() {
  if (!LEGACY_WEBHOOK_HEADERS_B64) return {};
  try {
    const parsed = JSON.parse(Buffer.from(LEGACY_WEBHOOK_HEADERS_B64, 'base64').toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function eventPath(payload = {}) {
  return normalize(payload?.event || payload?.type || '')
    .replace(/\./g, '-')
    .replace(/_/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

async function forwardLegacyWebhook(payload = {}) {
  if (!LEGACY_WEBHOOK_URL) return { skipped: true };
  if (/\/loja-bot(?:\/|$)/i.test(LEGACY_WEBHOOK_URL)) return { skipped: true, reason: 'self' };

  let target = LEGACY_WEBHOOK_URL;
  if (LEGACY_WEBHOOK_BY_EVENTS) {
    const suffix = eventPath(payload);
    if (suffix) target = `${target.replace(/\/$/, '')}/${suffix}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...legacyHeaders()
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!response.ok) {
      console.warn('[loja-bot] webhook anterior respondeu', response.status, target);
    }
    return { ok: response.ok, status: response.status };
  } catch (error) {
    console.warn('[loja-bot] falha ao encaminhar webhook anterior:', error.message || error);
    return { ok: false, error: error.message || String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

async function handleWebhook(payload) {
  const event = normalize(payload?.event || payload?.type || '');
  if (event && !event.includes('messages') && !event.includes('message')) return { ignored: 'event' };

  const incoming = extractIncoming(payload);
  if (!incoming.phone || incoming.fromMe || incoming.isGroup || incoming.isStatus) {
    return { ignored: 'source' };
  }

  if (incoming.id && state.processed[incoming.id]) return { ignored: 'duplicate' };
  if (incoming.id) {
    state.processed[incoming.id] = Date.now();
    saveStateSoon();
  }

  if (!incoming.text) {
    const conv = conversation(incoming.phone);
    if (conv.humanUntil && Date.now() < Number(conv.humanUntil)) return { ignored: 'human_mode' };
    await sendText(incoming.phone, 'Recebi seu arquivo/foto 😊 Me diga em uma frase o que você gostaria de saber sobre ele. Se precisar, eu encaminho para o atendimento humano.');
    return { ok: true, media: true };
  }

  await handleMessage(incoming);
  return { ok: true };
}

function sendJson(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json)
  });
  res.end(json);
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/loja-bot/health')) {
    return sendJson(res, 200, {
      ok: true,
      service: 'ariana-loja-whatsapp-bot',
      instance: EVOLUTION_INSTANCE,
      port: PORT,
      backend: BACKEND_URL,
      evolutionConfigured: Boolean(EVOLUTION_API_KEY),
      botTokenConfigured: Boolean(LOJA_BOT_API_TOKEN),
      legacyWebhookForwarding: Boolean(LEGACY_WEBHOOK_URL)
    });
  }

  if (req.method !== 'POST') return sendJson(res, 404, { ok: false, error: 'not_found' });

  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 2 * 1024 * 1024) req.destroy();
  });
  req.on('end', async () => {
    let payload = {};
    try { payload = raw ? JSON.parse(raw) : {}; }
    catch { return sendJson(res, 400, { ok: false, error: 'invalid_json' }); }

    sendJson(res, 200, { ok: true, received: true });
    Promise.allSettled([
      handleWebhook(payload),
      forwardLegacyWebhook(payload)
    ]).then((results) => {
      const botResult = results[0];
      if (botResult?.status === 'rejected') {
        console.error('[loja-bot] webhook:', botResult.reason?.stack || botResult.reason?.message || botResult.reason);
      }
    });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[loja-bot] Ariana Loja ouvindo em 127.0.0.1:${PORT}`);
  console.log(`[loja-bot] Instância Evolution: ${EVOLUTION_INSTANCE}`);
});
