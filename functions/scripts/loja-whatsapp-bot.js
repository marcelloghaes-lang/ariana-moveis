import http from 'http';
import fs from 'fs';

const PORT = Math.max(1, Number(process.env.LOJA_BOT_PORT || 8093));
const EVOLUTION_API_URL = String(process.env.EVOLUTION_API_URL || 'http://127.0.0.1:8082').replace(/\/$/, '');
const EVOLUTION_API_KEY = String(process.env.EVOLUTION_API_KEY || '').trim();
const EVOLUTION_INSTANCE = String(process.env.LOJA_EVOLUTION_INSTANCE || 'ariana loja').trim();
const BACKEND_URL = String(process.env.ARIANA_BACKEND_URL || 'https://ariana-backend.onrender.com').replace(/\/$/, '');
const LOJA_BOT_API_TOKEN = String(process.env.LOJA_BOT_API_TOKEN || '').trim();
const VISION_API_KEY = String(
  process.env.LOJA_VISION_OPENAI_API_KEY ||
  process.env.OPENAI_API_KEY ||
  ''
).trim();
const VISION_MODEL = String(process.env.LOJA_VISION_MODEL || 'gpt-5.6-luna').trim();
const VISION_DETAIL = ['low', 'high', 'auto'].includes(
  String(process.env.LOJA_VISION_DETAIL || 'high').trim().toLowerCase()
)
  ? String(process.env.LOJA_VISION_DETAIL || 'high').trim().toLowerCase()
  : 'high';
const VISION_MIN_CONFIDENCE = Math.min(
  0.99,
  Math.max(0.5, Number(process.env.LOJA_VISION_MIN_CONFIDENCE || 0.72))
);
const VISION_TIMEOUT_MS = Math.max(3000, Number(process.env.LOJA_VISION_TIMEOUT_MS || 20000));
const VISION_MONTHLY_BUDGET_BRL = Math.max(1, Number(process.env.LOJA_VISION_MONTHLY_BUDGET_BRL || 30));
const VISION_BUDGET_GUARD_BRL = Math.max(0, Number(process.env.LOJA_VISION_BUDGET_GUARD_BRL || 0.50));
const VISION_USD_BRL = Math.max(1, Number(process.env.LOJA_VISION_USD_BRL || 6.00));
const VISION_INPUT_USD_PER_1M = Math.max(0, Number(process.env.LOJA_VISION_INPUT_USD_PER_1M || 0.20));
const VISION_OUTPUT_USD_PER_1M = Math.max(0, Number(process.env.LOJA_VISION_OUTPUT_USD_PER_1M || 1.20));
const VISION_FALLBACK_CHARGE_BRL = Math.max(0.01, Number(process.env.LOJA_VISION_FALLBACK_CHARGE_BRL || 0.05));
const AUDIO_TRANSCRIBE_MODEL = String(process.env.LOJA_AUDIO_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe').trim();
const AUDIO_MAX_SECONDS = Math.max(30, Number(process.env.LOJA_AUDIO_MAX_SECONDS || 600));
const AUDIO_USD_PER_MINUTE = Math.max(0, Number(process.env.LOJA_AUDIO_USD_PER_MINUTE || 0.003));
const AUDIO_UNKNOWN_DURATION_SECONDS = Math.max(30, Number(process.env.LOJA_AUDIO_UNKNOWN_DURATION_SECONDS || 600));
const AUDIO_TRANSCRIBE_TIMEOUT_MS = Math.max(5000, Number(process.env.LOJA_AUDIO_TRANSCRIBE_TIMEOUT_MS || 30000));

const SITE_URL = 'https://arianamoveis.com.br';
const PIX_KEY = '31985147119';
const PIX_BANK = 'BTG';
const PIX_HOLDER = 'Marcelo Nunes Silva';
const STATE_FILE = String(process.env.LOJA_BOT_STATE_FILE || '/root/loja-bot-state.json');
const HUMAN_TTL_MS = Math.max(1, Number(process.env.LOJA_HUMAN_TTL_HOURS || 12)) * 60 * 60 * 1000;
const MANUAL_HUMAN_PAUSE_MS = Math.max(1, Number(process.env.LOJA_MANUAL_HUMAN_PAUSE_MINUTES || 60)) * 60 * 1000;
const LEGACY_WEBHOOK_URL = String(process.env.LOJA_LEGACY_WEBHOOK_URL || '').trim();
const LEGACY_WEBHOOK_BY_EVENTS = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.LOJA_LEGACY_WEBHOOK_BY_EVENTS || '').trim().toLowerCase()
);
const LEGACY_WEBHOOK_HEADERS_B64 = String(process.env.LOJA_LEGACY_WEBHOOK_HEADERS_B64 || '').trim();

const CATEGORY_TERMS = [
  ['sofá', ['sofa', 'sofas']],
  ['geladeira', ['geladeira', 'geladeiras', 'refrigerador', 'refrigeradores']],
  ['freezer', ['freezer', 'freezers']],
  ['frigobar', ['frigobar', 'frigobares']],
  ['fogão', ['fogao', 'fogoes']],
  ['cama', ['cama', 'camas', 'colchao', 'colchoes', 'box', 'cama box', 'colchao box', 'colchoes box']],
  ['celular', ['celular', 'celulares', 'smartphone', 'smartphones', 'iphone']],
  ['tv', ['tv', 'tvs', 'televisao', 'televisoes', 'televisor', 'televisores', 'smart tv', 'smart tvs']],
  ['caixa de som', ['som', 'caixa de som', 'caixas de som', 'caixa torre', 'caixas torre', 'caix torre', 'torre', 'torres', 'torre de som', 'torres de som']],
  ['guarda-roupa', ['guarda roupa', 'guarda-roupa', 'guarda roupas', 'roupeiro', 'roupeiros']],
  ['armário', ['armario', 'armarios']],
  ['cozinha completa', ['cozinha completa', 'cozinhas completas']],
  ['máquina de lavar', ['maquina de lavar', 'maquinas de lavar', 'lavadora', 'lavadoras', 'lava roupas', 'lava-roupas', 'lavadora automatica', 'lavadoras automaticas']],
  ['tanquinho', ['tanquinho', 'tanquinhos', 'lavadora semiautomatica', 'lavadoras semiautomaticas', 'lavadora semi automatica', 'lavadoras semi automaticas', 'semiautomatica', 'semi automatica']],
  ['air fryer', ['air fryer', 'fritadeira eletrica', 'fritadeira']],
  ['micro-ondas', ['microondas', 'micro-ondas', 'forno microondas', 'forno micro-ondas']],
  ['forno elétrico', ['forno eletrico', 'fornos eletricos', 'forninho', 'forninhos']],
  ['ventilador', ['ventilador', 'ventiladores']],
  ['ar-condicionado', ['ar condicionado', 'ar-condicionado']],
  ['mesa', ['mesa', 'mesas']],
  ['cadeira', ['cadeira', 'cadeiras']],
  ['rack/painel', ['rack', 'racks', 'painel', 'paineis', 'estante home', 'estantes home', 'home theater', 'home para tv']],
  ['multiuso', ['multiuso', 'multiusos', 'sapateira', 'sapateiras']],
  ['penteadeira', ['penteadeira', 'penteadeiras', 'camarim', 'camarins']],
  ['cômoda', ['comoda', 'comodas']],
  ['notebook', ['notebook', 'notebooks']],
  ['computador', ['computador', 'computadores', 'pc']],
  ['tablet', ['tablet', 'tablets']],
  ['liquidificador', ['liquidificador', 'liquidificadores']],
  ['batedeira', ['batedeira', 'batedeiras']],
  ['cafeteira', ['cafeteira', 'cafeteiras']]
];

function categoryAliases(query = '') {
  const wanted = normalize(query);
  const entry = CATEGORY_TERMS.find(([canonical]) => normalize(canonical) === wanted);
  if (!entry) return [String(query || '').trim()].filter(Boolean);
  const values = [entry[0], ...(entry[1] || [])]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return [...new Set(values)];
}

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
      processed: parsed?.processed || {},
      botOutbound: parsed?.botOutbound || {},
      botOutboundFingerprints: parsed?.botOutboundFingerprints || {},
      visionBudget: parsed?.visionBudget || {}
    };
  } catch {
    return {
      conversations: {},
      processed: {},
      botOutbound: {},
      botOutboundFingerprints: {},
      visionBudget: {}
    };
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

function visionBudgetMonth() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function ensureVisionBudgetState() {
  state.visionBudget = state.visionBudget || {};
  const month = visionBudgetMonth();

  if (state.visionBudget.month !== month) {
    state.visionBudget = {
      month,
      estimatedBrl: 0,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      lastAt: 0
    };
    saveStateSoon();
  }

  return state.visionBudget;
}

function visionBudgetStatus() {
  const budget = ensureVisionBudgetState();
  const used = Math.max(0, Number(budget.estimatedBrl || 0));
  const stopAt = Math.max(0, VISION_MONTHLY_BUDGET_BRL - VISION_BUDGET_GUARD_BRL);

  return {
    month: budget.month,
    limitBrl: Number(VISION_MONTHLY_BUDGET_BRL.toFixed(2)),
    guardBrl: Number(VISION_BUDGET_GUARD_BRL.toFixed(2)),
    stopAtBrl: Number(stopAt.toFixed(2)),
    usedBrl: Number(used.toFixed(4)),
    remainingBrl: Number(Math.max(0, VISION_MONTHLY_BUDGET_BRL - used).toFixed(4)),
    requests: Math.max(0, Number(budget.requests || 0)),
    inputTokens: Math.max(0, Number(budget.inputTokens || 0)),
    outputTokens: Math.max(0, Number(budget.outputTokens || 0)),
    audioRequests: Math.max(0, Number(budget.audioRequests || 0)),
    audioSeconds: Math.max(0, Number(budget.audioSeconds || 0)),
    blocked: used >= stopAt
  };
}

function recordVisionUsage(usage = {}) {
  const budget = ensureVisionBudgetState();
  const inputTokens = Math.max(0, Number(usage?.input_tokens || usage?.inputTokens || 0));
  const outputTokens = Math.max(0, Number(usage?.output_tokens || usage?.outputTokens || 0));

  const usd =
    (inputTokens / 1_000_000) * VISION_INPUT_USD_PER_1M +
    (outputTokens / 1_000_000) * VISION_OUTPUT_USD_PER_1M;

  const estimatedBrl = inputTokens || outputTokens
    ? usd * VISION_USD_BRL
    : VISION_FALLBACK_CHARGE_BRL;

  budget.estimatedBrl = Number((Number(budget.estimatedBrl || 0) + estimatedBrl).toFixed(6));
  budget.requests = Math.max(0, Number(budget.requests || 0)) + 1;
  budget.inputTokens = Math.max(0, Number(budget.inputTokens || 0)) + inputTokens;
  budget.outputTokens = Math.max(0, Number(budget.outputTokens || 0)) + outputTokens;
  budget.lastAt = Date.now();
  saveStateSoon();

  return visionBudgetStatus();
}

function estimatedAudioCostBrl(seconds = 0) {
  const safeSeconds = Math.max(
    1,
    Number(seconds || 0) || AUDIO_UNKNOWN_DURATION_SECONDS
  );
  const usd = (safeSeconds / 60) * AUDIO_USD_PER_MINUTE;
  return usd * VISION_USD_BRL;
}

function canUseAudioTranscription(seconds = 0) {
  const status = visionBudgetStatus();
  const estimatedBrl = estimatedAudioCostBrl(seconds);
  return {
    ...status,
    estimatedAudioBrl: Number(estimatedBrl.toFixed(4)),
    allowed: !status.blocked && (status.usedBrl + estimatedBrl) < status.stopAtBrl
  };
}

function recordAudioUsage(seconds = 0) {
  const budget = ensureVisionBudgetState();
  const safeSeconds = Math.max(
    1,
    Number(seconds || 0) || AUDIO_UNKNOWN_DURATION_SECONDS
  );
  const estimatedBrl = estimatedAudioCostBrl(safeSeconds);

  budget.estimatedBrl = Number((Number(budget.estimatedBrl || 0) + estimatedBrl).toFixed(6));
  budget.requests = Math.max(0, Number(budget.requests || 0)) + 1;
  budget.audioRequests = Math.max(0, Number(budget.audioRequests || 0)) + 1;
  budget.audioSeconds = Math.max(0, Number(budget.audioSeconds || 0)) + safeSeconds;
  budget.lastAt = Date.now();
  saveStateSoon();

  return visionBudgetStatus();
}

function cleanupState() {
  const now = Date.now();
  for (const [id, at] of Object.entries(state.processed)) {
    if (now - Number(at || 0) > 24 * 60 * 60 * 1000) delete state.processed[id];
  }
  for (const [id, at] of Object.entries(state.botOutbound || {})) {
    if (now - Number(at || 0) > 24 * 60 * 60 * 1000) delete state.botOutbound[id];
  }
  for (const [key, at] of Object.entries(state.botOutboundFingerprints || {})) {
    if (now - Number(at || 0) > 10 * 60 * 1000) delete state.botOutboundFingerprints[key];
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
      manualHumanUntil: 0,
      customerName: '',
      creditContextUntil: 0,
      pixContextUntil: 0,
      pendingImageIntent: '',
      pendingImageIntentUntil: 0,
      lastImageClassification: null,
      lastImageAt: 0,
      lastVisualCategory: '',
      lastVisualCategoryAt: 0,
      awaitingSimilarOptions: false,
      pendingAlternativeCategory: '',
      pendingAlternativeUntil: 0,
      pendingCreditProductId: '',
      pendingCreditUntil: 0,
      creditOrderWaitingMarcelo: false,
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

async function fetchIncomingMedia(incoming = {}) {
  if (!incoming?.rawMessageInfo) throw new Error('Mensagem original da mídia não disponível.');

  const data = await evolution(
    `/chat/getBase64FromMediaMessage/${encodeURIComponent(EVOLUTION_INSTANCE)}`,
    {
      message: incoming.rawMessageInfo,
      convertToMp4: false
    }
  );

  const base64 = String(data?.base64 || data?.data?.base64 || '').trim();
  const mimetype = String(
    data?.mimetype ||
    data?.mimeType ||
    data?.data?.mimetype ||
    incoming?.mimeType ||
    (incoming?.mediaType === 'audio' ? 'audio/ogg' : 'image/jpeg')
  ).trim();

  if (!base64) throw new Error('Evolution não retornou a mídia em base64.');
  return { base64, mimetype };
}

function audioExtensionFromMime(mimetype = '') {
  const mime = String(mimetype || '').toLowerCase();
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('m4a') || mime.includes('mp4')) return 'm4a';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  if (mime.includes('flac')) return 'flac';
  return 'ogg';
}

async function transcribeIncomingAudio(incoming = {}) {
  if (!VISION_API_KEY) throw new Error('API de IA não configurada para transcrição.');

  const durationSeconds = Math.max(
    0,
    Number(incoming?.mediaDurationSeconds || 0)
  );

  if (durationSeconds > AUDIO_MAX_SECONDS) {
    const error = new Error('audio_too_long');
    error.code = 'audio_too_long';
    error.durationSeconds = durationSeconds;
    throw error;
  }

  const budget = canUseAudioTranscription(durationSeconds);
  if (!budget.allowed) {
    const error = new Error('ai_budget_blocked');
    error.code = 'ai_budget_blocked';
    throw error;
  }

  const media = await fetchIncomingMedia(incoming);
  const buffer = Buffer.from(String(media.base64 || ''), 'base64');

  if (!buffer.length) throw new Error('Áudio recebido sem conteúdo.');
  if (buffer.length > 24 * 1024 * 1024) {
    const error = new Error('audio_file_too_large');
    error.code = 'audio_file_too_large';
    throw error;
  }

  const mime = String(media.mimetype || incoming.mimeType || 'audio/ogg')
    .split(';')[0]
    .trim()
    .toLowerCase();
  const extension = audioExtensionFromMime(mime);
  const form = new FormData();

  form.append(
    'file',
    new Blob([buffer], { type: mime || 'audio/ogg' }),
    `audio-whatsapp.${extension}`
  );
  form.append('model', AUDIO_TRANSCRIBE_MODEL);
  form.append('response_format', 'json');
  form.append('language', 'pt');
  form.append(
    'prompt',
    'Português do Brasil. Atendimento da Ariana Móveis em Guanhães/MG. Preserve nomes de marcas, modelos de produtos, Marcelo, Ariana Móveis, crediário, carnê, PIX e nomes próprios.'
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUDIO_TRANSCRIBE_TIMEOUT_MS);

  try {
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${VISION_API_KEY}`
      },
      body: form
    });

    const data = await readJson(response);
    const text = String(data?.text || '').trim();

    recordAudioUsage(durationSeconds);

    return {
      text,
      durationSeconds: durationSeconds || AUDIO_UNKNOWN_DURATION_SECONDS,
      model: AUDIO_TRANSCRIBE_MODEL
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function handleIncomingAudio(incoming = {}, conv = {}) {
  if (incoming.mediaType !== 'audio') return { handled: false };

  const durationSeconds = Math.max(0, Number(incoming.mediaDurationSeconds || 0));

  if (durationSeconds > AUDIO_MAX_SECONDS) {
    await sendText(
      incoming.phone,
      `Recebi seu áudio 😊 Para conseguir processar com segurança, envie áudios de até ${Math.round(AUDIO_MAX_SECONDS / 60)} minutos, ou divida em duas partes.`
    );
    return { handled: true, kind: 'audio_too_long' };
  }

  const budget = canUseAudioTranscription(durationSeconds);
  if (!budget.allowed) {
    await sendText(
      incoming.phone,
      'Recebi seu áudio 😊 No momento a transcrição automática está temporariamente indisponível. Se puder, me mande a informação por escrito que eu continuo seu atendimento.'
    );
    return { handled: true, kind: 'ai_budget_blocked' };
  }

  let transcription;
  try {
    transcription = await transcribeIncomingAudio(incoming);
  } catch (error) {
    if (error?.code === 'audio_too_long') {
      await sendText(
        incoming.phone,
        `Recebi seu áudio 😊 Para conseguir processar com segurança, envie áudios de até ${Math.round(AUDIO_MAX_SECONDS / 60)} minutos, ou divida em duas partes.`
      );
      return { handled: true, kind: 'audio_too_long' };
    }

    if (error?.code === 'ai_budget_blocked') {
      await sendText(
        incoming.phone,
        'Recebi seu áudio 😊 No momento a transcrição automática está temporariamente indisponível. Se puder, me mande a informação por escrito que eu continuo seu atendimento.'
      );
      return { handled: true, kind: 'ai_budget_blocked' };
    }

    console.warn('[loja-bot] transcrição de áudio falhou:', error.message || error);
    await sendText(
      incoming.phone,
      'Recebi seu áudio 😊 Não consegui entender com segurança agora. Você pode repetir em outro áudio ou me mandar a informação por escrito?'
    );
    return { handled: true, kind: 'audio_transcription_error' };
  }

  if (!transcription.text) {
    await sendText(
      incoming.phone,
      'Recebi seu áudio 😊 Não consegui identificar fala suficiente para continuar. Você pode repetir ou me mandar a informação por escrito?'
    );
    return { handled: true, kind: 'audio_empty' };
  }

  await handleMessage({
    phone: incoming.phone,
    text: transcription.text,
    pushName: incoming.pushName
  });

  return {
    handled: true,
    kind: 'audio_transcribed',
    durationSeconds: transcription.durationSeconds
  };
}

function responseOutputText(data = {}) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }

  for (const item of Array.isArray(data?.output) ? data.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (typeof content?.text === 'string' && content.text.trim()) {
        return content.text.trim();
      }
    }
  }
  return '';
}

async function classifyImageWithVision(media = {}, contextText = '') {
  const budgetStatus = visionBudgetStatus();
  if (budgetStatus.blocked) {
    return {
      kind: 'unknown',
      confidence: 0,
      product_name: '',
      brand: '',
      model: '',
      category_hint: '',
      payment_method: 'unknown',
      payment_recipient_name: '',
      summary: 'vision_budget_blocked'
    };
  }

  if (!VISION_API_KEY) {
    return {
      kind: 'unknown',
      confidence: 0,
      product_name: '',
      brand: '',
      model: '',
      category_hint: '',
      payment_method: 'unknown',
      payment_recipient_name: '',
      summary: 'vision_not_configured'
    };
  }

  const mime = String(media?.mimetype || 'image/jpeg').toLowerCase();
  const isImage = mime.startsWith('image/');
  const isPdf = mime === 'application/pdf';

  if (!isImage && !isPdf) {
    return {
      kind: 'unknown',
      confidence: 0,
      product_name: '',
      brand: '',
      model: '',
      category_hint: '',
      payment_method: 'unknown',
      payment_recipient_name: '',
      summary: 'unsupported_media_type'
    };
  }

  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      kind: {
        type: 'string',
        enum: [
          'payment_receipt_pix',
          'payment_receipt_boleto',
          'product',
          'personal_document',
          'other',
          'unknown'
        ]
      },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      product_name: { type: 'string' },
      brand: { type: 'string' },
      model: { type: 'string' },
      category_hint: { type: 'string' },
      payment_method: {
        type: 'string',
        enum: ['pix', 'boleto', 'other', 'unknown']
      },
      payment_recipient_name: { type: 'string' },
      summary: { type: 'string' }
    },
    required: [
      'kind',
      'confidence',
      'product_name',
      'brand',
      'model',
      'category_hint',
      'payment_method',
      'payment_recipient_name',
      'summary'
    ]
  };

  const prompt = [
    'Classifique esta imagem recebida no WhatsApp de uma loja brasileira.',
    'As classes permitidas são:',
    '- payment_receipt_pix: comprovante/recibo de pagamento por PIX;',
    '- payment_receipt_boleto: comprovante/recibo de pagamento de boleto;',
    '- product: foto ou print de um produto comercial;',
    '- personal_document: RG, CNH, CPF, comprovante de residência ou documento pessoal;',
    '- other: outra imagem reconhecível;',
    '- unknown: não é possível determinar com segurança.',
    '',
    'Nunca conclua que um pagamento foi realmente liquidado ou que o comprovante é autêntico.',
    'Para produto, extraia somente o que estiver visível/razoavelmente identificável: nome, marca, modelo e categoria.',
    'Para comprovante, payment_recipient_name deve ser apenas o nome do favorecido visível, se houver.',
    `Texto enviado pelo cliente junto/próximo da imagem: ${String(contextText || '').slice(0, 500)}`
  ].join('\n');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${VISION_API_KEY}`
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        store: false,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: prompt },
              isPdf
                ? {
                    type: 'input_file',
                    filename: 'arquivo-whatsapp.pdf',
                    file_data: `data:application/pdf;base64,${media.base64}`,
                    detail: VISION_DETAIL
                  }
                : {
                    type: 'input_image',
                    image_url: `data:${mime};base64,${media.base64}`,
                    detail: VISION_DETAIL
                  }
            ]
          }
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'ariana_whatsapp_image_classification',
            strict: true,
            schema
          }
        },
        max_output_tokens: 500
      })
    });

    const data = await readJson(response);
    recordVisionUsage(data?.usage || {});
    const output = responseOutputText(data);
    const parsed = JSON.parse(output || '{}');

    return {
      kind: String(parsed.kind || 'unknown'),
      confidence: Number(parsed.confidence || 0),
      product_name: String(parsed.product_name || '').trim(),
      brand: String(parsed.brand || '').trim(),
      model: String(parsed.model || '').trim(),
      category_hint: String(parsed.category_hint || '').trim(),
      payment_method: String(parsed.payment_method || 'unknown'),
      payment_recipient_name: String(parsed.payment_recipient_name || '').trim(),
      summary: String(parsed.summary || '').trim()
    };
  } finally {
    clearTimeout(timeout);
  }
}

function imageClassificationLabel(classification = {}) {
  return [
    classification.product_name,
    classification.brand,
    classification.model
  ].map((v) => String(v || '').trim()).filter(Boolean).join(' ').trim();
}

function asksAboutImageProduct(text) {
  const n = normalize(text);

  // Referência explícita a mídia/imagem.
  if (
    /(vende|vendem|tem|teria|consegue|conseguem|trabalha|trabalham|quanto|preco|valor).{0,45}(foto|imagem|print|produto da foto|produto do print)/.test(n) ||
    /(esse|essa|desse|dessa).{0,35}(produto da foto|produto do print|da foto|na foto|da imagem|na imagem|do print|no print)/.test(n) ||
    /(produto).{0,25}(foto|imagem|print)/.test(n)
  ) {
    return true;
  }

  // "Vocês vendem esse?" pode ser preparação para o cliente enviar uma foto.
  // Não usamos "valor desse..." aqui, pois essa frase normalmente referencia
  // um produto já mostrado na própria conversa.
  return /(vende|vendem|tem|teria|trabalha|trabalham).{0,35}\b(esse|essa|desse|dessa)\b(?:\s+produto)?(?:\s+aqui)?\s*[!?.,;:]*$/.test(n);
}

function emojiOnlyIntent(text) {
  const raw = String(text || '')
    .replace(/\s+/g, '')
    .replace(/\uFE0F/g, '')
    .replace(/[\u{1F3FB}-\u{1F3FF}]/gu, '');

  if (!raw) return '';

  if (/^(?:👍|🙏|😊|🙂|😁|😄|❤|👏|✅|👌|🤝|🙌|🥰|😍|💙|💛|😂|🤣)+$/u.test(raw)) {
    return 'positive';
  }
  if (/^(?:🤔|❓|❔|⁉)+$/u.test(raw)) return 'question';
  if (/^(?:😕|😟|😞|😡|😠|👎|😤|😭)+$/u.test(raw)) return 'negative';

  return '';
}

function outboundMessageId(result = {}) {
  return String(
    result?.key?.id ||
    result?.messageId ||
    result?.id ||
    result?.data?.key?.id ||
    result?.data?.messageId ||
    ''
  ).trim();
}

function outboundFingerprint(phone, text) {
  return `${digits(phone)}|${normalize(text).slice(0, 300)}`;
}

function rememberBotOutbound(phone, text, result = null) {
  state.botOutbound = state.botOutbound || {};
  state.botOutboundFingerprints = state.botOutboundFingerprints || {};

  const id = outboundMessageId(result || {});
  if (id) state.botOutbound[id] = Date.now();

  const fingerprint = outboundFingerprint(phone, text);
  if (fingerprint) state.botOutboundFingerprints[fingerprint] = Date.now();
  saveStateSoon();
}

function isKnownBotOutbound(incoming = {}) {
  state.botOutbound = state.botOutbound || {};
  state.botOutboundFingerprints = state.botOutboundFingerprints || {};

  if (incoming.id && state.botOutbound[incoming.id]) return true;

  const fingerprint = outboundFingerprint(incoming.phone, incoming.text || '');
  const at = Number(state.botOutboundFingerprints[fingerprint] || 0);
  return Boolean(at && Date.now() - at < 2 * 60 * 1000);
}

async function sendText(phone, text, { linkPreview = true } = {}) {
  const bodyText = String(text || '').trim();
  rememberBotOutbound(phone, bodyText);
  const result = await evolution(`/message/sendText/${encodeURIComponent(EVOLUTION_INSTANCE)}`, {
    number: digits(phone),
    text: bodyText,
    linkPreview
  });
  rememberBotOutbound(phone, bodyText, result);
  return result;
}

function isPlaceholderProductImage(imageUrl = '') {
  const url = String(imageUrl || '').trim().toLowerCase();
  if (!url) return true;

  return (
    /placehold\.co|placeholder\.com|via\.placeholder\.com/.test(url) ||
    /imagem(?:\+|%20|[-_ ])do(?:\+|%20|[-_ ])produto/.test(url)
  );
}

async function sendImage(phone, imageUrl, caption) {
  const url = String(imageUrl || '').trim();
  const captionText = String(caption || '').trim();

  if (!/^https?:\/\//i.test(url) || isPlaceholderProductImage(url)) {
    return sendText(
      phone,
      `📷 *Foto indisponível no momento.*\n\n${captionText}`,
      { linkPreview: false }
    );
  }

  try {
    rememberBotOutbound(phone, captionText);
    const result = await evolution(`/message/sendMedia/${encodeURIComponent(EVOLUTION_INSTANCE)}`, {
      number: digits(phone),
      mediatype: 'image',
      media: url,
      caption: captionText
    });
    rememberBotOutbound(phone, captionText, result);
    return result;
  } catch (error) {
    console.warn('[loja-bot] imagem falhou, enviando texto:', error.message || error);
    return sendText(
      phone,
      `📷 *Não consegui carregar a foto deste produto agora.*\n\n${captionText}`,
      { linkPreview: false }
    );
  }
}

function detectCategory(text) {
  const n = normalize(text);
  const candidates = CATEGORY_TERMS.flatMap(([query, aliases]) =>
    (aliases || []).map((alias) => ({ query, alias: normalize(alias) }))
  ).sort((a, b) => b.alias.length - a.alias.length);

  for (const { query, alias } of candidates) {
    if (!alias) continue;
    if (alias.length <= 4) {
      const escaped = alias.replace(/[.*+?^\$\{\}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(n)) return query;
    } else if (n.includes(alias)) {
      return query;
    }
  }
  return '';
}

function greetingFromText(text) {
  const n = normalize(text)
    .replace(/[!?.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!n) return '';

  if (/^(?:(?:oi+|oie+|ola+)\s+)?bom dia\b/.test(n)) return 'Bom dia';
  if (/^(?:(?:oi+|oie+|ola+)\s+)?boa tarde\b/.test(n)) return 'Boa tarde';
  if (/^(?:(?:oi+|oie+|ola+)\s+)?boa noite\b/.test(n)) return 'Boa noite';
  if (/^(?:oi+|oie+|ola+)\b/.test(n)) return 'Olá';

  return '';
}

function isGreeting(text) {
  const n = normalize(text)
    .replace(/[!?.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!n) return false;

  const greetingPattern = /^(?:(?:oi+|oie+|ola+)\s*)?(?:(?:bom dia|boa tarde|boa noite)\s*)?(?:(?:tudo bem|td bem|como vai)\s*)?$/;
  const hasGreetingTerm = /(?:oi+|oie+|ola+|bom dia|boa tarde|boa noite|tudo bem|td bem|como vai)/;

  return greetingPattern.test(n) && hasGreetingTerm.test(n);
}

function asksPresencePing(text) {
  const raw = String(text || '').trim();
  const n = normalize(text)
    .replace(/[!?.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (/^\?+$/.test(raw)) return true;

  return (
    /^(ta|esta|tá) ai$/.test(n) ||
    /^ainda (ta|esta) ai$/.test(n) ||
    /^(oi|ola|oie)\s+(ta|esta) ai$/.test(n) ||
    /^(voce )?(ta|esta) ai$/.test(n) ||
    /^ainda por ai$/.test(n)
  );
}

function asksMarceloOrCallback(text) {
  const n = normalize(text);
  const marcelo = '(?:marcelo|macelo|marcello)';

  return (
    new RegExp('(falar|conversar).{0,20}(com )?(o )?' + marcelo).test(n) ||
    new RegExp(marcelo + '.{0,50}(esta ai|ta ai|pode falar|preciso falar|quero falar|precisando falar|me liga|me ligue)').test(n) ||
    new RegExp('(preciso|precisando|precisava|queria|quero|gostaria|to precisando|estou precisando).{0,30}falar.{0,20}(com )?(voce|' + marcelo + ')').test(n) ||
    /(pode|poderia|teria|teria como|consegue|conseguiria).{0,30}(me|mim)?\s*(ligar|retornar|telefonar)/.test(n) ||
    /(me|mim)\s+(liga|ligue|retorna|retorne)|liga(r)?\s+(aqui|pra mim|para mim)|retorna(r)?\s+(aqui|pra mim|para mim)/.test(n)
  );
}

function isReferralOrPraise(text) {
  const n = normalize(text);

  const referral = (
    /\b(indicou|indicacao|indicaram|recomendou|recomendaram)\b/.test(n) ||
    /(peguei|passaram|me deram).{0,25}(seu numero|seu contato|contato de voces|numero de voces)/.test(n) ||
    /(amiga|amigo|vizinha|vizinho|parente|cliente).{0,35}(compra|comprou|indicou|recomendou).{0,35}(voces|ai|ariana)/.test(n)
  );

  const praise = (
    /(falou|disse|contou|falaram|disseram|me falou|me disse|me contou|me falaram|me disseram).{0,70}(muito bem|otimos precos|precos bons|otimos produtos|produtos bons|muito bons|bons de mexer|vende no carne|vendem no carne|compra com voces|comprou com voces)/.test(n) ||
    /(falou|disse|contou|falaram|disseram).{0,40}(que )?(voces|a loja|ariana).{0,50}(vende|vendem|tem|sao|e|compra|comprou).{0,35}(carne|otimos precos|precos bons|otimos produtos|produtos bons|muito bons|bons de mexer)/.test(n) ||
    /(voces|a loja|ariana).{0,30}(tem|tem uns|sao|e).{0,20}(otimos precos|precos bons|otimos produtos|produtos bons|muito bons|bons de mexer)/.test(n)
  );

  return referral || praise;
}

function wantsHuman(text) {
  const n = normalize(text);
  return [
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

  // Pedido explícito contendo PIX.
  if (/(manda|me passa|passa|envia|qual|chave).{0,20}pix|pix.{0,20}(chave|numero|qual)/.test(n)) {
    return true;
  }

  // No WhatsApp da loja, "sua chave" em contexto de pagamento/parcela normalmente
  // significa a chave PIX, mesmo quando o cliente não escreve a palavra "pix".
  const asksForKey =
    /\b(manda|mande|envia|envie|me passa|passa|passa ai|qual|me fala|me informe)\b.{0,35}\b(sua )?chave\b/.test(n) ||
    /\bqual (e |eh )?(a )?(sua )?chave\b/.test(n);

  if (!asksForKey) return false;

  const paymentContext =
    /\b(pagar|pagamento|pago|parcela|prestacao|mensalidade|notinha|nota|carne|boleto|vencimento|mes)\b/.test(n);

  // "Manda/envia/me passa sua chave" já é uma forma corrente de pedir PIX.
  const directStoreKeyRequest =
    /\b(manda|mande|envia|envie|me passa|passa|passa ai)\b.{0,25}\b(sua )?chave\b/.test(n);

  return paymentContext || directStoreKeyRequest;
}

function asksPixProof(text) {
  const n = normalize(text);
  return (
    /(segue|enviei|mandei|to mandando|estou mandando).{0,30}(comprovante|pix)/.test(n) ||
    /(comprovante).{0,30}(pix|pagamento|pago|paguei)/.test(n) ||
    /(paguei|pago|fiz|feito).{0,25}(no |por |via )?pix/.test(n) ||
    /(pix).{0,25}(pago|feito|realizado|comprovante)/.test(n)
  );
}

function markPixContext(conv) {
  conv.pixContextUntil = Date.now() + 30 * 60 * 1000;
  saveStateSoon();
}

function isPixContext(conv) {
  return Number(conv?.pixContextUntil || 0) > Date.now();
}

async function acknowledgePaymentProof(phone, conv, {
  text = '',
  pushName = '',
  paymentMethod = 'unknown'
} = {}) {
  conv.pixContextUntil = 0;
  conv.lastIntent = 'comprovante_pagamento';
  saveStateSoon();

  await sendText(
    phone,
    'Recebemos seu comprovante 😊 O pagamento está sendo analisado e, em breve, enviaremos o comprovante da baixa do pagamento.'
  );

  const methodLabel = paymentMethod === 'pix'
    ? 'PIX'
    : paymentMethod === 'boleto'
      ? 'boleto'
      : 'pagamento';

  await syncTicket(phone, {
    status: 'Comprovante de pagamento recebido - analisar baixa',
    message: text || `Cliente enviou comprovante de ${methodLabel}.`,
    name: pushName
  });
}

async function acknowledgePixProof(phone, conv, text = '', pushName = '') {
  return acknowledgePaymentProof(phone, conv, {
    text,
    pushName,
    paymentMethod: 'pix'
  });
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
    /(como|queria|gostaria|quero|pode|posso|da pra|tem como).{0,45}(comprar|fazer|faz|faco|pegar).{0,45}(carne|crediario|boleto)/.test(n) ||
    /(comprar|fazer|faz|faco|pegar).{0,35}(ele|ela|esse|essa|este|esta|produto)?.{0,25}(no|na|pelo|pela)?.{0,10}(carne|crediario|boleto)/.test(n) ||
    /(ele|ela|esse|essa|este|esta|produto).{0,25}(no|na|pelo|pela).{0,10}(carne|crediario|boleto)/.test(n)
  );
}

function markCreditContext(conv) {
  conv.creditContextUntil = Date.now() + 30 * 60 * 1000;
  saveStateSoon();
}

function isCreditContext(conv, text = '') {
  const n = normalize(text);
  if (/(carne|crediario|boleto)/.test(n)) return true;
  if (String(conv?.pendingAction || '').startsWith('crediario_')) return true;
  if (conv?.lastCreditPlan) return true;
  return Number(conv?.creditContextUntil || 0) > Date.now();
}

function asksToWriteOnCredit(text) {
  const n = normalize(text);
  return (
    /\b(anota|anote|anotar)\b/.test(n) &&
    /\b(ele|ela|esse|essa|este|esta|produto|pedido|pra mim|para mim)\b/.test(n)
  ) || /\bcoloca.{0,20}(no|na).{0,10}(carne|crediario)\b/.test(n);
}

function asksMoreProducts(text) {
  const n = normalize(text)
    .replace(/([a-z])\1{2,}/g, '$1$1')
    .replace(/\s+/g, ' ')
    .trim();

  return (
    /most+r+a?r? mais/.test(n) ||
    /mostra mais|mostar mais|mostrar mais/.test(n) ||
    /ver mais|quero ver mais|quero mais/.test(n) ||
    /tem mais|tem outras|tem outros/.test(n) ||
    /manda mais|envia mais/.test(n) ||
    /mais opcoes|outras opcoes|outros modelos|outras alternativas/.test(n) ||
    /tem outro|tem outros/.test(n)
  );
}

function asksCreditQuote(text) {
  const n = normalize(text);
  const creditWord = '(?:boleto|carne|crediario)';
  const boletoTypoInInstallmentContext =
    /\b(parcela|parcelado|parcelar|prestacao|vezes)\b.{0,30}\b(beto|bolto|boleo)\b/.test(n);

  return (
    new RegExp(`quanto fica.{0,30}${creditWord}`).test(n) ||
    /quanto (da|fica) em \d{1,2}\s*(x|vezes|parcelas)?/.test(n) ||
    new RegExp(`\\d{1,2}\\s*(?:x|vezes|parcelas).{0,25}${creditWord}`).test(n) ||
    new RegExp(`parcel(?:ar|ado|ada)?[^\\n]{0,35}${creditWord}`).test(n) ||
    new RegExp(`(?:qual\\s+)?(?:o\\s+)?valor[^\\n]{0,55}${creditWord}`).test(n) ||
    new RegExp(`(?:valor|quanto)[^\\n]{0,25}(?:parcela|prestacao)[^\\n]{0,25}${creditWord}`).test(n) ||
    new RegExp(`(?:parcela|prestacao)[^\\n]{0,25}${creditWord}`).test(n) ||
    boletoTypoInInstallmentContext
  );
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

function parsePendingInstallments(text) {
  const n = normalize(text)
    .replace(/[!?.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const match = n.match(/^(?:em\s+)?(\d{1,2})\s*(?:x|vezes|parcelas)?$/);
  return match ? Number(match[1]) : 0;
}

function findConversationProduct(conv, id = '') {
  const wanted = String(id || '').trim();
  if (!wanted) return null;

  const candidates = [
    conv?.selectedProduct,
    ...(Array.isArray(conv?.lastProducts) ? conv.lastProducts : []),
    ...(Array.isArray(conv?.allProductResults) ? conv.allProductResults : [])
  ].filter(Boolean);

  return candidates.find((product) => productId(product) === wanted) || null;
}

function setPendingCreditInstallments(conv, product) {
  conv.pendingAction = 'credit_installments';
  conv.pendingCreditProductId = productId(product);
  conv.pendingCreditUntil = Date.now() + 30 * 60 * 1000;
  saveStateSoon();
}

function clearPendingCreditInstallments(conv) {
  if (conv.pendingAction === 'credit_installments') conv.pendingAction = '';
  conv.pendingCreditProductId = '';
  conv.pendingCreditUntil = 0;
  saveStateSoon();
}

function asksGenericInstallmentQuote(text) {
  const n = normalize(text);
  const mentionsInstallment = /\b(parcelado|parcelada|parcelar|parcelamento|parcelas|prestacoes)\b/.test(n);
  const explicitMethod = /\b(cartao|boleto|carne|crediario|pix)\b/.test(n);
  return mentionsInstallment && !explicitMethod;
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
  if (requested === 'freezer') return /\bfreezer\b/.test(haystack);
  if (requested === 'frigobar') return /\bfrigobar\b/.test(haystack);

  if (requested === 'guarda-roupa' || requested === 'roupeiro') {
    return /guarda[ -]?roupa|roupeiro/.test(haystack);
  }

  if (requested === 'armario') {
    return !/cozinha completa/.test(haystack) &&
      !/guarda[ -]?roupa|roupeiro/.test(haystack);
  }
  if (requested === 'cozinha completa') return /cozinha completa/.test(haystack);

  if (requested === 'maquina de lavar') {
    return !/tanquinho|semi ?automatica/.test(haystack);
  }
  if (requested === 'tanquinho') {
    return /tanquinho|semi ?automatica/.test(haystack);
  }

  if (requested === 'micro-ondas') {
    return /micro ?-? ?ondas/.test(haystack);
  }
  if (requested === 'forno eletrico') {
    return /forno eletrico|forninho/.test(haystack) && !/micro ?-? ?ondas/.test(haystack);
  }

  if (requested === 'tv') {
    const isTv = /\btv\b|televisao|televisor|smart tv|google tv/.test(haystack);
    const isTvAccessoryOrFurniture =
      /rack|painel|home theater|home para tv|estante|suporte|base para tv|antena|controle|conversor|tv box|box tv|receptor|cabide|aparador/.test(haystack);
    return isTv && !isTvAccessoryOrFurniture;
  }

  if (requested === 'celular') {
    const category = normalize(product.category || '');
    const name = normalize(product.name || '');
    const isPhoneCategory = /celular|celulares|smartphone|smartphones|telefonia/.test(category);
    const looksLikePhone =
      /\biphone\b|\bsmartphone\b|\bcelular\b|\bgalaxy\b|\bmoto\s*[ge]\b|\bredmi\b|\bpoco\b|\brealme\b|\bxiaomi\b/.test(name);
    const isAccessory =
      /capa|pelicula|carregador|cabo|fone|headset|caixa de som|speaker|suporte|power bank|relogio|smartwatch/.test(haystack);

    return (isPhoneCategory || looksLikePhone) && !isAccessory;
  }

  if (requested === 'cama') {
    const isBedFamily = /\bcama\b|colchao|\bbox\b/.test(haystack);
    const isOtherBox = /tv box|box tv|android box|receptor box|caixa de som/.test(haystack);
    return isBedFamily && !isOtherBox;
  }

  if (requested === 'caixa de som') {
    return /caixa.{0,12}som|torre.{0,12}som|som.{0,12}torre|\bsom\b/.test(haystack);
  }

  if (requested === 'multiuso') return /multiuso|sapateira/.test(haystack);
  if (requested === 'penteadeira') return /penteadeira|camarim/.test(haystack);
  if (requested === 'rack\/painel') {
    return /\brack\b|painel|estante home|home.{0,12}(tv|theater)/.test(haystack);
  }

  return true;
}

function plausibleTvInches(value) {
  const n = Number(value || 0);
  return Number.isInteger(n) && n >= 20 && n <= 100 ? n : 0;
}

function requestedTvInches(text = '') {
  const n = normalize(text);
  const patterns = [
    /\b(\d{2,3})\s*(?:polegada|polegadas|pol\.?|["”])/,
    /(?:\btv\b|televisao|televisor).{0,18}?\b(?:de\s+)?(\d{2,3})\b/
  ];

  for (const pattern of patterns) {
    const match = n.match(pattern);
    const size = plausibleTvInches(match?.[1]);
    if (size) return size;
  }

  return 0;
}

function productTvInches(product = {}) {
  const name = normalize(product.name || '');
  const patterns = [
    /\b(\d{2,3})\s*(?:polegada|polegadas|pol\.?|["”])/,
    /(?:\btv\b|televisao|televisor).{0,28}?\b(\d{2,3})\b/,
    /\bs(\d{2,3})\b/,
    /\b(\d{2,3})(?=[a-z])/
  ];

  for (const pattern of patterns) {
    const match = name.match(pattern);
    const size = plausibleTvInches(match?.[1]);
    if (size) return size;
  }

  return 0;
}

function matchesRequestedProductConstraints(product = {}, query = '', originalText = '') {
  const requested = normalize(query);
  const original = normalize(originalText);
  const haystack = normalize([
    product.name,
    product.category,
    product.brand
  ].filter(Boolean).join(' '));

  if (requested === 'tv') {
    const wantedInches = requestedTvInches(original);
    if (wantedInches) {
      return productTvInches(product) === wantedInches;
    }
  }

  if (requested === 'celular' && /\biphone\b/.test(original)) {
    const isIphone = /\biphone\b/.test(haystack);
    const isApplePhone =
      /\bapple\b/.test(normalize(product.brand || '')) &&
      /celular|smartphone|telefonia/.test(normalize(product.category || ''));

    return isIphone || isApplePhone;
  }

  return true;
}

async function searchProducts(query, originalText = '') {
  const terms = categoryAliases(query);
  const resultSets = await Promise.all(
    terms.map(async (term) => {
      let lastError = null;

      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          const q = encodeURIComponent(term);
          const data = await backend(`/api/products?q=${q}&limit=100`);
          return Array.isArray(data) ? data : Array.isArray(data?.products) ? data.products : [];
        } catch (error) {
          lastError = error;
          if (attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        }
      }

      console.warn('[loja-bot] busca por termo falhou após nova tentativa:', term, lastError?.message || lastError);
      return [];
    })
  );

  const rows = resultSets.flat();
  let products = rows
    .map(compactProduct)
    .filter((p) => p.id && Number(p.stock || 0) > 0 && productCashPrice(p) > 0)
    .filter((p) => matchesRequestedProductType(p, query))
    .filter((p) => matchesRequestedProductConstraints(p, query, originalText));

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
  clearAlternativeOffer(conv);
  const products = await searchProducts(query, originalText);
  if (!products.length) {
    const tvInches = normalize(query) === 'tv' ? requestedTvInches(originalText) : 0;
    const askedIphone = normalize(query) === 'celular' && /\biphone\b/.test(normalize(originalText));

    if (tvInches) {
      setAlternativeOffer(conv, 'tv');
      await sendText(
        phone,
        `No momento não encontrei *TV de ${tvInches} polegadas* disponível em estoque no catálogo da Ariana Móveis. Se quiser, posso te mostrar outros tamanhos disponíveis 😊`
      );
      return;
    }

    if (askedIphone) {
      setAlternativeOffer(conv, 'celular');
      await sendText(
        phone,
        'No momento não encontrei *iPhone* disponível em estoque no catálogo da Ariana Móveis. Se quiser, posso te mostrar outros celulares disponíveis 😊'
      );
      return;
    }

    await sendText(phone, `No momento não encontrei *${query}* disponível no catálogo da Ariana Móveis. Se quiser, me diga outro produto que você está procurando 😊`);
    return;
  }

  clearAlternativeOffer(conv);
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


function recentProductImageClassification(conv) {
  if (!conv?.lastImageClassification || conv.lastImageClassification.kind !== 'product') return null;
  if (Date.now() - Number(conv.lastImageAt || 0) > 30 * 60 * 1000) return null;
  return conv.lastImageClassification;
}

function visualCategoryFromClassification(classification = {}) {
  const combined = [
    classification.category_hint,
    classification.product_name,
    classification.summary,
    classification.brand,
    classification.model
  ].filter(Boolean).join(' ');

  return detectCategory(combined);
}

function recentVisualCategory(conv) {
  const direct = String(conv?.lastVisualCategory || '').trim();
  const directAt = Number(conv?.lastVisualCategoryAt || 0);

  if (direct && directAt && Date.now() - directAt <= 30 * 60 * 1000) {
    return direct;
  }

  const recent = recentProductImageClassification(conv);
  return recent ? visualCategoryFromClassification(recent) : '';
}

function asksSimilarVisualProducts(text) {
  const n = normalize(text);

  return (
    /(parecido|parecida|parecidos|parecidas|semelhante|semelhantes|similar|similares)/.test(n) ||
    /(me manda|manda|mostra|mostrar|quero ver|tem).{0,35}(foto|fotos|opcao|opcoes|produto|produtos).{0,35}(desse|dessa|assim|tipo)/.test(n) ||
    /(me manda|manda|mostra|mostrar).{0,40}(o que|oque).{0,25}(tem|voce tem|voces tem)/.test(n)
  );
}

function asksContextualSend(text) {
  const n = normalize(text)
    .replace(/[!?.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return /^(manda( ai)?|pode mandar|manda pra mim|manda para mim|mostra( ai)?|pode mostrar|quero ver|quero sim|sim pode mandar|sim manda)$/.test(n);
}

function setAlternativeOffer(conv, category = '') {
  conv.pendingAlternativeCategory = String(category || '').trim();
  conv.pendingAlternativeUntil = conv.pendingAlternativeCategory
    ? Date.now() + 30 * 60 * 1000
    : 0;
  saveStateSoon();
}

function clearAlternativeOffer(conv) {
  conv.pendingAlternativeCategory = '';
  conv.pendingAlternativeUntil = 0;
  saveStateSoon();
}

function asksAcceptedAlternative(text) {
  const n = normalize(text)
    .replace(/[!?.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const withoutCourtesy = n
    .replace(/\s+(por favor|fazendo favor|pfv|por gentileza)$/g, '')
    .trim();

  return (
    /^(quero sim|sim|sim quero|pode|pode sim|pode mandar|pode mostrar|quero ver|manda|manda ai|me mostra|mostra ai)$/.test(withoutCourtesy) ||
    /^(pode )?(me )?(enviar|mandar|mostrar) (as )?(fotos|opcoes|produtos|modelos)( pra mim)?$/.test(withoutCourtesy) ||
    /^(manda|mansa|mandq|mnda|envia|enviar) (a )?(foto|fotos|imagem|imagens)$/.test(withoutCourtesy)
  );
}

function asksLastShownProduct(text) {
  const n = normalize(text)
    .replace(/[!?.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (/\bultima parcela\b|\bultimo pagamento\b|\bultimo boleto\b/.test(n)) return false;

  return (
    /\b(esse|essa)\s+(ultimo|ultima)\b/.test(n) ||
    /\b(ultimo|ultima)\s+(ai|produto|modelo|aparelho)\b/.test(n) ||
    /\b(o|a)\s+(ultimo|ultima)\s+(produto|modelo|aparelho|ai)\b/.test(n)
  );
}

async function showSimilarProductsFromVisual(phone, conv, category) {
  const query = String(category || recentVisualCategory(conv) || '').trim();

  if (!query) {
    await sendText(
      phone,
      'Consigo te mostrar opções parecidas 😊 Só me diga qual tipo de produto você quer que eu procure.'
    );
    return false;
  }

  const products = await searchProducts(query, query);

  if (!products.length) {
    conv.awaitingSimilarOptions = true;
    saveStateSoon();
    await sendText(
      phone,
      `No momento não encontrei *${query}* disponível no catálogo. Se quiser, posso tentar outra categoria ou você pode me mandar o nome/modelo do produto.`
    );
    return false;
  }

  conv.allProductResults = products;
  conv.productResultOffset = 0;
  conv.lastProductQuery = query;
  conv.selectedProduct = null;
  conv.lastIntent = 'produto';
  conv.awaitingSimilarOptions = false;
  saveStateSoon();

  await sendText(
    phone,
    `Claro 😊 Vou te mostrar algumas opções de *${query}* que temos disponíveis e que podem ser parecidas com o produto da foto:`
  );
  await sendProductPage(phone, conv, { announce: false });
  return true;
}

async function showProductsFromVision(phone, conv, classification = {}) {
  const label = imageClassificationLabel(classification) ||
    String(classification.summary || classification.category_hint || 'produto').trim();
  const visualCategory = visualCategoryFromClassification(classification);

  if (visualCategory) {
    conv.lastVisualCategory = visualCategory;
    conv.lastVisualCategoryAt = Date.now();
  }

  const queries = [
    [classification.brand, classification.model].filter(Boolean).join(' ').trim(),
    classification.product_name,
    [classification.brand, classification.product_name].filter(Boolean).join(' ').trim(),
    classification.category_hint
  ].map((value) => String(value || '').trim()).filter(Boolean);

  let products = [];
  let usedQuery = '';

  for (const query of [...new Set(queries)]) {
    products = await searchProducts(query, query);
    if (products.length) {
      usedQuery = query;
      break;
    }
  }

  if (!products.length) {
    conv.awaitingSimilarOptions = Boolean(visualCategory);
    saveStateSoon();

    await sendText(
      phone,
      label
        ? `Pela imagem, parece ser *${label}* 😊 Não encontrei esse modelo com segurança no catálogo agora.${visualCategory ? ` Se quiser, posso te mostrar os *${visualCategory}* que temos disponíveis e que podem ser parecidos com ele.` : ' Se você me mandar o nome/modelo ou o link, eu confiro novamente.'}`
        : 'Recebi a foto 😊 Não consegui identificar o modelo com segurança. Se você me mandar o nome/modelo ou o link do produto, eu confiro no catálogo para você.'
    );
    return false;
  }

  conv.allProductResults = products;
  conv.productResultOffset = 0;
  conv.lastProductQuery = visualCategory || classification.category_hint || usedQuery;
  conv.selectedProduct = null;
  conv.lastIntent = 'produto';
  conv.awaitingSimilarOptions = false;
  saveStateSoon();

  await sendText(
    phone,
    label
      ? `Pela imagem, identifiquei algo como *${label}* 😊 Encontrei estas opções relacionadas disponíveis na Ariana Móveis:`
      : 'Encontrei estas opções relacionadas disponíveis na Ariana Móveis 😊'
  );
  await sendProductPage(phone, conv, { announce: false });
  return true;
}

function asksPaymentProofText(text) {
  const n = normalize(text);
  return (
    asksPixProof(text) ||
    /(comprovante).{0,35}(boleto|pagamento|paguei|pago)/.test(n) ||
    /(paguei|pago|quitei|fiz o pagamento).{0,30}(boleto|conta|parcela)/.test(n)
  );
}

async function handleVisionMedia(incoming, conv) {
  if (!incoming?.hasMedia || !['image', 'document'].includes(incoming.mediaType)) {
    return { handled: false };
  }

  const currentBudget = visionBudgetStatus();
  if (currentBudget.blocked) {
    await sendText(
      incoming.phone,
      'Recebi a imagem 😊 No momento a análise automática de imagens está temporariamente indisponível. Se for um produto, me diga o nome/modelo; se for um comprovante, me confirme se é PIX ou boleto.'
    );
    return { handled: true, kind: 'vision_budget_blocked' };
  }

  if (!VISION_API_KEY) {
    if (asksPaymentProofText(incoming.text)) {
      await acknowledgePaymentProof(incoming.phone, conv, {
        text: incoming.text || 'Cliente informou que a mídia é um comprovante.',
        pushName: incoming.pushName,
        paymentMethod: normalize(incoming.text).includes('boleto') ? 'boleto' : 'pix'
      });
      return { handled: true, kind: 'payment_by_text_fallback' };
    }

    if (asksAboutImageProduct(incoming.text) || conv.pendingImageIntent === 'product_lookup') {
      conv.pendingImageIntent = '';
      conv.pendingImageIntentUntil = 0;
      saveStateSoon();
      await sendText(
        incoming.phone,
        'Recebi a foto/print 😊 Para eu conferir com segurança, me diga o nome ou modelo do produto que aparece nela, ou me mande o link.'
      );
      return { handled: true, kind: 'product_without_vision' };
    }

    await sendText(
      incoming.phone,
      'Recebi a imagem 😊 Ela é um *comprovante de pagamento*, uma *foto de produto* ou outra coisa?'
    );
    return { handled: true, kind: 'vision_not_configured' };
  }

  let classification;
  try {
    const media = await fetchIncomingMedia(incoming);
    classification = await classifyImageWithVision(media, incoming.text);
  } catch (error) {
    console.warn('[loja-bot] visão da imagem falhou:', error.message || error);
    await sendText(
      incoming.phone,
      'Recebi a imagem 😊 Não consegui analisá-la com segurança agora. É um comprovante de pagamento, uma foto de produto ou outra coisa?'
    );
    return { handled: true, kind: 'vision_error' };
  }

  const confidence = Number(classification.confidence || 0);
  const confident = confidence >= VISION_MIN_CONFIDENCE;

  if (confident && ['payment_receipt_pix', 'payment_receipt_boleto'].includes(classification.kind)) {
    const method = classification.kind === 'payment_receipt_boleto' ? 'boleto' : 'pix';
    await acknowledgePaymentProof(incoming.phone, conv, {
      text: `Imagem classificada como comprovante de ${method}. Conferência humana obrigatória antes da baixa.`,
      pushName: incoming.pushName,
      paymentMethod: method
    });
    return { handled: true, kind: classification.kind, confidence };
  }

  if (confident && classification.kind === 'product') {
    conv.lastImageClassification = classification;
    conv.lastImageAt = Date.now();
    conv.pendingImageIntent = '';
    conv.pendingImageIntentUntil = 0;
    saveStateSoon();

    await showProductsFromVision(incoming.phone, conv, classification);
    return { handled: true, kind: 'product', confidence };
  }

  if (confident && classification.kind === 'personal_document') {
    await sendText(
      incoming.phone,
      'Recebi um documento. Para proteger seus dados, se ele for para análise de crédito, utilize o fluxo do *Ariana Crediário* para o envio seguro dos documentos.'
    );
    return { handled: true, kind: 'personal_document', confidence };
  }

  if (isPixContext(conv) || asksPaymentProofText(incoming.text)) {
    await sendText(
      incoming.phone,
      'Recebi a imagem, mas não consegui confirmar com segurança que ela é um comprovante de pagamento. Você pode confirmar se é o comprovante do PIX/boleto?'
    );
    return { handled: true, kind: 'unconfirmed_payment', confidence };
  }

  if (asksAboutImageProduct(incoming.text) || conv.pendingImageIntent === 'product_lookup') {
    conv.pendingImageIntent = '';
    conv.pendingImageIntentUntil = 0;
    saveStateSoon();
    await sendText(
      incoming.phone,
      'Recebi a imagem, mas não consegui identificar o produto com segurança. Se você me disser o nome/modelo ou mandar o link, eu consulto no catálogo para você.'
    );
    return { handled: true, kind: 'unconfirmed_product', confidence };
  }

  await sendText(
    incoming.phone,
    'Recebi a imagem 😊 Não consegui identificar com segurança se é produto, comprovante ou outra coisa. Me diga em uma frase o que você gostaria de consultar.'
  );
  return { handled: true, kind: classification.kind || 'unknown', confidence };
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
        nome: name
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
  markCreditContext(conv);
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
  if (conv.pendingAction === 'credit_installments') {
    if (conv.pendingCreditUntil && Date.now() >= Number(conv.pendingCreditUntil)) {
      clearPendingCreditInstallments(conv);
      return false;
    }

    const count = parsePendingInstallments(text);
    if (!count) return false;

    const product = findConversationProduct(conv, conv.pendingCreditProductId);
    if (!product) {
      clearPendingCreditInstallments(conv);
      await sendText(phone, 'Não consegui recuperar o produto desse cálculo. Me diga qual produto você está olhando que eu calculo novamente para você.');
      return true;
    }

    const plan = creditPlan(product, count);
    if (plan.invalid) {
      await sendText(
        phone,
        `Para *${product.name}*, o máximo no crediário é *${plan.max}x*. Me diga uma quantidade de 1 a ${plan.max} parcelas.`
      );
      return true;
    }

    conv.selectedProduct = product;
    conv.lastCreditPlan = {
      productId: productId(product),
      count,
      divisor: plan.divisor,
      total: plan.total,
      installment: plan.installment
    };
    clearPendingCreditInstallments(conv);
    markCreditContext(conv);
    saveStateSoon();

    await sendText(
      phone,
      `No crediário próprio, para *${product.name}*, em *${count}x* fica aproximadamente *${count}x de ${money(plan.installment)}*, total de *${money(plan.total)}*. A compra no carnê é sujeita à análise de crédito.\n\nSe quiser seguir com o carnê, eu já posso iniciar a solicitação para você.`
    );
    return true;
  }

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

  if (conv.manualHumanUntil && Date.now() < Number(conv.manualHumanUntil)) {
    return;
  }
  if (conv.manualHumanUntil && Date.now() >= Number(conv.manualHumanUntil)) {
    conv.manualHumanUntil = 0;
    saveStateSoon();
  }

  if (conv.pendingImageIntentUntil && Date.now() >= Number(conv.pendingImageIntentUntil)) {
    conv.pendingImageIntent = '';
    conv.pendingImageIntentUntil = 0;
    saveStateSoon();
  }

  if (conv.pendingAlternativeUntil && Date.now() >= Number(conv.pendingAlternativeUntil)) {
    clearAlternativeOffer(conv);
  }

  if (
    conv.pendingAlternativeCategory &&
    Number(conv.pendingAlternativeUntil || 0) > Date.now() &&
    asksAcceptedAlternative(text)
  ) {
    const alternativeCategory = String(conv.pendingAlternativeCategory || '').trim();
    clearAlternativeOffer(conv);
    await showProducts(phone, conv, alternativeCategory, alternativeCategory);
    return;
  }

  const emojiIntent = emojiOnlyIntent(text);
  if (emojiIntent === 'positive') {
    return;
  }
  if (emojiIntent === 'question') {
    await sendText(phone, 'Sim, estou aqui 😊 Pode falar.');
    return;
  }
  if (emojiIntent === 'negative') {
    await sendText(phone, 'Posso te ajudar. O que aconteceu?');
    return;
  }

  {
    const product = conv.selectedProduct || (conv.lastProducts.length === 1 ? conv.lastProducts[0] : null);
    const implicitCreditByProduct = Boolean(
      product &&
      conv.lastIntent === 'produto' &&
      asksToWriteOnCredit(text)
    );

    if (asksToWriteOnCredit(text) && (isCreditContext(conv, text) || implicitCreditByProduct)) {
      conv.pendingAction = '';
      conv.creditOrderWaitingMarcelo = true;
      markCreditContext(conv);
      saveStateSoon();

      await sendText(
        phone,
        'Sim, claro 😊 Assim que o Marcelo retornar de outro atendimento, ele vai terminar seu pedido.'
      );

      await syncTicket(phone, {
        status: 'Aguardando Marcelo - finalizar pedido no carnê',
        message: product
          ? `Cliente pediu para anotar no carnê: ${product.name}`
          : 'Cliente pediu para anotar a compra no carnê.',
        name: pushName
      });
      return;
    }
  }

  if (await handlePending(phone, text, conv)) return;

  if (asksMarceloOrCallback(text)) {
    conv.pendingAction = '';
    conv.marceloCallbackRequested = true;
    conv.marceloCallbackRequestedAt = Date.now();
    saveStateSoon();

    await sendText(
      phone,
      'O Marcelo está em outro atendimento no momento. Assim que ele terminar, ele retorna seu contato 😊\n\nEnquanto você aguarda, gostaria de dar uma olhada em alguma coisa? Posso te mostrar fotos de produtos, preços e condições de pagamento.'
    );

    await syncTicket(phone, {
      status: 'Aguardando retorno do Marcelo',
      message: text,
      name: pushName
    });
    return;
  }

  if (isReferralOrPraise(text)) {
    await sendText(
      phone,
      'Que bom 😊 Ficamos muito felizes pela indicação! Aqui na Ariana Móveis trabalhamos com móveis, eletrodomésticos, eletrônicos e vários outros produtos. Também temos crediário próprio no carnê, sujeito à análise de crédito.\n\nSe quiser, posso te mostrar fotos, preços e condições de pagamento. O que você está procurando?'
    );
    return;
  }

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

  if (asksPaymentProofText(text)) {
    markPixContext(conv);
    await sendText(
      phone,
      'Perfeito 😊 Pode enviar o comprovante aqui na conversa. Assim que a imagem chegar, vamos identificar o tipo de comprovante e encaminhar para análise da baixa.'
    );
    return;
  }

  if (asksPixKey(text)) {
    markPixContext(conv);
    await sendText(
      phone,
      [
        'Claro 😊',
        '',
        `*PIX:* ${PIX_KEY}`,
        `*Banco:* ${PIX_BANK}`,
        `*Titular:* ${PIX_HOLDER}`,
        '',
        '⚠️ *ATENÇÃO:* antes de confirmar o pagamento, confira o nome do favorecido.',
        '*Efetue o PIX somente se aparecer MARCELO NUNES SILVA.*',
        'Se aparecer qualquer outro nome, não realize o pagamento e nos avise imediatamente.'
      ].join('\n')
    );
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

  {
    const visualCategory = recentVisualCategory(conv);
    const wantsSimilar = asksSimilarVisualProducts(text);
    const confirmsSimilar = Boolean(
      visualCategory &&
      conv.awaitingSimilarOptions &&
      asksContextualSend(text)
    );

    if (visualCategory && (wantsSimilar || confirmsSimilar)) {
      await showSimilarProductsFromVisual(phone, conv, visualCategory);
      return;
    }
  }

  if (asksAboutImageProduct(text)) {
    const recentImage = recentProductImageClassification(conv);
    if (recentImage) {
      await showProductsFromVision(phone, conv, recentImage);
      return;
    }

    conv.pendingImageIntent = 'product_lookup';
    conv.pendingImageIntentUntil = Date.now() + 10 * 60 * 1000;
    saveStateSoon();

    await sendText(
      phone,
      'Sim 😊 Pode me mandar a foto ou o print do produto. Eu vou analisar a imagem e conferir no catálogo da Ariana Móveis se temos esse modelo ou opções relacionadas.'
    );
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
    markPixContext(conv);
    await sendText(phone, `No PIX, *${product.name}* fica por *${money(productCashPrice(product))}*.`);
    return;
  }

  const ord = ordinalIndex(text);

  if (asksCreditQuote(text)) {
    markCreditContext(conv);

    let product = null;

    // Quando o cliente diz "o primeiro em 10 vezes no boleto", o ordinal faz
    // parte do próprio pedido de cálculo. Selecionamos e calculamos na mesma resposta.
    if (ord >= 0 && Array.isArray(conv.lastProducts) && conv.lastProducts[ord]) {
      product = conv.lastProducts[ord];
      conv.selectedProduct = product;
      saveStateSoon();
    } else if (
      asksLastShownProduct(text) &&
      Array.isArray(conv.lastProducts) &&
      conv.lastProducts.length
    ) {
      product = conv.lastProducts[conv.lastProducts.length - 1];
      conv.selectedProduct = product;
      saveStateSoon();
    } else {
      product = conv.selectedProduct || (conv.lastProducts.length === 1 ? conv.lastProducts[0] : null);
    }

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

    const parsedCount = parseInstallments(text);
    const previousCount = (
      /\b(parcela|prestacao)\b/.test(n) &&
      String(conv.lastCreditPlan?.productId || '') === productId(product)
    )
      ? Number(conv.lastCreditPlan?.count || 0)
      : 0;
    const count = parsedCount || previousCount;
    const plan = creditPlan(product, count);

    if (!count) {
      setPendingCreditInstallments(conv, product);
      await sendText(phone, `Para *${product.name}*, consigo fazer no crediário próprio em até *${plan.max}x*. Em quantas vezes você gostaria que eu calculasse?`);
      return;
    }

    if (plan.invalid) {
      await sendText(phone, `Para esse produto, o máximo no crediário é *${plan.max}x*. Se quiser, posso calcular em qualquer quantidade até ${plan.max} parcelas.`);
      return;
    }

    conv.lastCreditPlan = {
      productId: productId(product),
      count,
      divisor: plan.divisor,
      total: plan.total,
      installment: plan.installment
    };
    clearPendingCreditInstallments(conv);
    saveStateSoon();
    await sendText(
      phone,
      `No crediário próprio, para *${product.name}*, em *${count}x* fica aproximadamente *${count}x de ${money(plan.installment)}*, total de *${money(plan.total)}*. A compra no carnê é sujeita à análise de crédito.\n\nSe quiser seguir com o carnê, eu já posso iniciar a solicitação para você.`
    );
    return;
  }

  if (
    asksGenericInstallmentQuote(text) &&
    (
      (ord >= 0 && Array.isArray(conv.lastProducts) && conv.lastProducts[ord]) ||
      (asksLastShownProduct(text) && Array.isArray(conv.lastProducts) && conv.lastProducts.length) ||
      conv.selectedProduct
    )
  ) {
    const product = ord >= 0 && conv.lastProducts[ord]
      ? conv.lastProducts[ord]
      : asksLastShownProduct(text) && conv.lastProducts.length
        ? conv.lastProducts[conv.lastProducts.length - 1]
        : conv.selectedProduct;

    conv.selectedProduct = product;
    saveStateSoon();
    await sendText(
      phone,
      `Claro 😊 Você quer que eu calcule *${product.name}* parcelado no *cartão* ou no *crediário/carnê*?`
    );
    return;
  }

  if (ord >= 0 && Array.isArray(conv.lastProducts) && conv.lastProducts[ord]) {
    conv.selectedProduct = conv.lastProducts[ord];
    saveStateSoon();
    await sendText(phone, `Perfeito 😊 Você escolheu *${conv.selectedProduct.name}*. O que você gostaria de saber dele: cartão, PIX, carnê, entrega ou quer comprar?`);
    return;
  }

  if (asksLastShownProduct(text) && Array.isArray(conv.lastProducts) && conv.lastProducts.length) {
    conv.selectedProduct = conv.lastProducts[conv.lastProducts.length - 1];
    saveStateSoon();
    await sendText(phone, `Perfeito 😊 Você escolheu *${conv.selectedProduct.name}*. O que você gostaria de saber dele: cartão, PIX, carnê, entrega ou quer comprar?`);
    return;
  }

  if (asksHowToBuyCredit(text) || (conv.lastCreditPlan && /quero|pode fazer|vamos fazer|pode iniciar|pode abrir/.test(n) && /carne|crediario|boleto/.test(n))) {
    markCreditContext(conv);
    await startCreditApplication(phone, conv);
    return;
  }

  const category = detectCategory(text);
  if (category) {
    const greeting = greetingFromText(text);
    if (greeting) {
      await sendText(
        phone,
        `${greeting}! 😊 Tudo bem? Seja bem-vindo à Ariana Móveis. Vou verificar as opções disponíveis para você.`
      );
    }

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

  if (asksPresencePing(text)) {
    await sendText(phone, 'Sim, estou aqui 😊 Pode falar. Se quiser, continuamos de onde paramos.');
    return;
  }

  if (isGreeting(text)) {
    const saudacao = greetingFromText(text) || 'Olá';
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

  const mediaType = message?.imageMessage
    ? 'image'
    : message?.documentMessage
      ? 'document'
      : message?.videoMessage
        ? 'video'
        : message?.audioMessage
          ? 'audio'
          : '';

  const mimeType = String(
    message?.imageMessage?.mimetype ||
    message?.documentMessage?.mimetype ||
    message?.videoMessage?.mimetype ||
    message?.audioMessage?.mimetype ||
    ''
  ).trim();

  const mediaDurationSeconds = Math.max(
    0,
    Number(
      message?.audioMessage?.seconds ||
      message?.audioMessage?.duration ||
      message?.videoMessage?.seconds ||
      0
    )
  );

  return {
    remoteJid,
    phone: digits(remoteJid.split('@')[0]),
    fromMe,
    id,
    pushName,
    text,
    mediaType,
    mimeType,
    mediaDurationSeconds,
    hasMedia: Boolean(mediaType),
    rawMessageInfo: data,
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
  if (!incoming.phone || incoming.isGroup || incoming.isStatus) {
    return { ignored: 'source' };
  }

  if (incoming.fromMe) {
    if (isKnownBotOutbound(incoming)) {
      return { ignored: 'bot_outbound' };
    }

    const conv = conversation(incoming.phone);
    conv.humanUntil = 0;
    conv.manualHumanUntil = Date.now() + MANUAL_HUMAN_PAUSE_MS;
    conv.lastAt = Date.now();
    saveStateSoon();

    return {
      ok: true,
      humanPause: true,
      pauseMinutes: Math.round(MANUAL_HUMAN_PAUSE_MS / 60000)
    };
  }

  if (incoming.id && state.processed[incoming.id]) return { ignored: 'duplicate' };
  if (incoming.id) {
    state.processed[incoming.id] = Date.now();
    saveStateSoon();
  }

  const conv = conversation(incoming.phone);

  if (conv.humanUntil && Date.now() < Number(conv.humanUntil)) {
    return { ignored: 'human_mode' };
  }

  if (conv.manualHumanUntil && Date.now() < Number(conv.manualHumanUntil)) {
    return { ignored: 'manual_human_mode' };
  }

  if (incoming.mediaType === 'audio') {
    const audio = await handleIncomingAudio(incoming, conv);
    if (audio?.handled) {
      return {
        ok: true,
        media: true,
        audio: audio.kind || 'handled',
        durationSeconds: Number(audio.durationSeconds || incoming.mediaDurationSeconds || 0)
      };
    }
  }

  if (incoming.hasMedia && ['image', 'document'].includes(incoming.mediaType)) {
    const vision = await handleVisionMedia(incoming, conv);
    if (vision?.handled) {
      return {
        ok: true,
        media: true,
        vision: vision.kind || 'handled',
        confidence: Number(vision.confidence || 0)
      };
    }
  }

  if (!incoming.text) {
    await sendText(
      incoming.phone,
      'Recebi seu arquivo/foto 😊 Me diga em uma frase o que você gostaria de saber sobre ele. Se precisar, eu encaminho para o atendimento humano.'
    );
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
      visionConfigured: Boolean(VISION_API_KEY),
      visionModel: VISION_MODEL,
      visionDetail: VISION_DETAIL,
      audioTranscriptionConfigured: Boolean(VISION_API_KEY),
      audioTranscriptionModel: AUDIO_TRANSCRIBE_MODEL,
      audioMaxMinutes: Number((AUDIO_MAX_SECONDS / 60).toFixed(1)),
      aiBudget: visionBudgetStatus(),
      visionBudget: visionBudgetStatus(),
      legacyWebhookForwarding: Boolean(LEGACY_WEBHOOK_URL),
      manualHumanPauseMinutes: Math.round(MANUAL_HUMAN_PAUSE_MS / 60000)
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

function resetTestState() {
  state.conversations = {};
  state.processed = {};
  state.botOutbound = {};
  state.botOutboundFingerprints = {};
  state.visionBudget = {};
}

function patchTestVisionBudget(patch = {}) {
  const budget = ensureVisionBudgetState();
  Object.assign(budget, patch || {});
  return budget;
}

function patchTestConversation(phone, patch = {}) {
  const conv = conversation(phone);
  Object.assign(conv, patch || {});
  return conv;
}

export const __test = {
  CATEGORY_TERMS,
  normalize,
  digits,
  categoryAliases,
  detectCategory,
  greetingFromText,
  isGreeting,
  asksPresencePing,
  asksMarceloOrCallback,
  isReferralOrPraise,
  wantsHuman,
  asksPaymentMethods,
  asksPixKey,
  asksPixProof,
  asksPaymentProofText,
  markPixContext,
  isPixContext,
  asksAboutImageProduct,
  emojiOnlyIntent,
  classifyImageWithVision,
  handleVisionMedia,
  showProductsFromVision,
  acknowledgePaymentProof,
  visionBudgetStatus,
  recordVisionUsage,
  estimatedAudioCostBrl,
  canUseAudioTranscription,
  recordAudioUsage,
  transcribeIncomingAudio,
  handleIncomingAudio,
  patchTestVisionBudget,
  asksCardQuote,
  asksPixPrice,
  asksProductLink,
  asksDelivery,
  asksFinance,
  asksHowToBuyCredit,
  asksToWriteOnCredit,
  asksMoreProducts,
  asksCreditQuote,
  asksGenericInstallmentQuote,
  parsePendingInstallments,
  asksAcceptedAlternative,
  asksLastShownProduct,
  setAlternativeOffer,
  clearAlternativeOffer,
  parseInstallments,
  creditDivisor,
  creditPlan,
  ordinalIndex,
  productCashPrice,
  productFullPrice,
  productLink,
  compactProduct,
  isPlaceholderProductImage,
  matchesRequestedProductType,
  requestedTvInches,
  productTvInches,
  matchesRequestedProductConstraints,
  searchProducts,
  showProducts,
  showMoreProducts,
  deliveryReply,
  paymentMethodsReply,
  financialReply,
  handleMessage,
  handleWebhook,
  conversation,
  resetTestState,
  patchTestConversation,
  manualHumanPauseMs: MANUAL_HUMAN_PAUSE_MS,
  humanTtlMs: HUMAN_TTL_MS
};

if (process.env.LOJA_BOT_TEST_MODE !== '1') {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[loja-bot] Ariana Loja ouvindo em 127.0.0.1:${PORT}`);
    console.log(`[loja-bot] Instância Evolution: ${EVOLUTION_INSTANCE}`);
  });
}
