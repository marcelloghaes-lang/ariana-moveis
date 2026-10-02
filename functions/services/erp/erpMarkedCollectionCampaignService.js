import mongoose from 'mongoose';
import { createErpCollectionWorkflowService } from './erpCollectionWorkflowService.js';
import { claimMonthlyFinancialContact, confirmMonthlyFinancialContact, releaseMonthlyFinancialContact } from './erpMonthlyCollectionGuardService.js';

const TZ = 'America/Sao_Paulo';
const CAMPAIGN_KEY = 'etapa2_x_2026_10_01';
export const MARKED_COLLECTION_NAMES = Object.freeze([
  'Raice Gabrielle Campos da Silva',
  'Carlos Daniel Gomes da Silva',
  'Geise Nogueira dos Santos',
  'Luciano Nunes Vieira Silva',
  'Ariadna Santos Sardinha',
  'Marcio Alvez da Paixao',
  'Maria Aparecida da Silva',
  'Debora Aparecida do Nascimento',
  'Samara Aparecida da Silva',
  'Kelly Cristina Ferreira',
  'Roseli Virgem de Nazare Ferreira',
  'Leiliane da Silva Santos',
  'Daniele Karolyne Pereira Silva',
  'Luana Dias Camargo',
  'Lucia Dias da Silva'
]);
const MARKED_REFERENCE_BALANCES = Object.freeze({
  'Raice Gabrielle Campos da Silva': 4862.16,
  'Carlos Daniel Gomes da Silva': 4445.58,
  'Geise Nogueira dos Santos': 4441.00,
  'Luciano Nunes Vieira Silva': 4429.26,
  'Ariadna Santos Sardinha': 4329.33,
  'Marcio Alvez da Paixao': 4113.10,
  'Maria Aparecida da Silva': 3956.00,
  'Debora Aparecida do Nascimento': 3743.00,
  'Samara Aparecida da Silva': 3519.10,
  'Kelly Cristina Ferreira': 3457.00,
  'Roseli Virgem de Nazare Ferreira': 3442.50,
  'Leiliane da Silva Santos': 3391.02,
  'Daniele Karolyne Pereira Silva': 3143.20,
  'Luana Dias Camargo': 3077.80,
  'Lucia Dias da Silva': 3057.00
});
const STRICT_NAME_KEYS = new Set(['maria aparecida da silva']);
const MANUAL_PHONE_OVERRIDES = Object.freeze({
  'ariadna santos sardinha': '+17746022981'
});
const USER_SKIPPED_KEYS = new Set(['roseli virgem de nazare ferreira']);
const ARIADNA_KEY = 'ariadna santos sardinha';

const clean = (value = '', max = 2000) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const digits = (value = '') => String(value ?? '').replace(/\D/g, '');
const money = (value = 0) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const moneyText = (value = 0) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const stripAccents = (value = '') => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
export const normalizeCollectionName = (value = '') => stripAccents(clean(value, 260)).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const firstName = (value = '') => clean(value, 220).split(/\s+/).filter(Boolean)[0] || 'cliente';
function editDistance(a = '', b = '') {
  const left = String(a || ''), right = String(b || '');
  if (!left) return right.length;
  if (!right) return left.length;
  const row = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const old = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (left[i - 1] === right[j - 1] ? 0 : 1));
      prev = old;
    }
  }
  return row[right.length];
}
function closeName(target = '', candidate = '') {
  const a = normalizeCollectionName(target), b = normalizeCollectionName(candidate);
  if (!a || !b) return false;
  const at = a.split(' '), bt = b.split(' ');
  if (at[0] !== bt[0] || at[at.length - 1] !== bt[bt.length - 1]) return false;
  const distance = editDistance(a, b);
  return distance <= 2 || distance / Math.max(a.length, b.length, 1) <= 0.06;
}
function candidateByReferenceBalance(candidates = [], referenceBalance = 0) {
  if (!Array.isArray(candidates) || !candidates.length || !(Number(referenceBalance) > 0)) return null;
  const scored = candidates
    .map((client) => ({ client, diff: Math.abs(Number(client?.totalOverdue || 0) - Number(referenceBalance || 0)) }))
    .sort((a, b) => a.diff - b.diff);
  const best = scored[0];
  const tolerance = Math.max(75, Number(referenceBalance) * 0.12);
  if (!best || best.diff > tolerance) return null;
  if (scored[1] && scored[1].diff - best.diff < Math.max(50, Number(referenceBalance) * 0.03)) return null;
  return best.client;
}
function resolveMarkedClient(task = {}, allClients = [], byName = new Map(), strictNameKeys = STRICT_NAME_KEYS) {
  const exact = byName.get(task.nameKey) || [];
  if (exact.length === 1) return { client: exact[0], resolution: 'exact' };
  if (exact.length > 1) {
    const byBalance = candidateByReferenceBalance(exact, task.referenceBalance);
    return byBalance
      ? { client: byBalance, resolution: 'exact_balance' }
      : { client: null, resolution: 'ambiguous', matches: exact.length };
  }
  if (strictNameKeys.has(task.nameKey)) return { client: null, resolution: 'not_found', matches: 0 };
  const fuzzy = allClients.filter((client) => closeName(task.name, client?.name));
  if (fuzzy.length === 1) {
    const ref = Number(task.referenceBalance || 0);
    const diff = Math.abs(Number(fuzzy[0]?.totalOverdue || 0) - ref);
    if (!ref || diff <= Math.max(75, ref * 0.12)) return { client: fuzzy[0], resolution: 'fuzzy' };
  }
  if (fuzzy.length > 1) {
    const byBalance = candidateByReferenceBalance(fuzzy, task.referenceBalance);
    if (byBalance) return { client: byBalance, resolution: 'fuzzy_balance' };
    return { client: null, resolution: 'ambiguous', matches: fuzzy.length };
  }
  return { client: null, resolution: 'not_found', matches: 0 };
}

function localDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}
function dateFromKey(key = '') {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(key || '')) ? new Date(`${key}T12:00:00-03:00`) : null;
}
function shiftDateKey(key = '', days = 0) {
  const date = dateFromKey(key);
  if (!date || Number.isNaN(date.getTime())) return '';
  date.setDate(date.getDate() + Number(days || 0));
  return localDateKey(date);
}
function formatDatePtBr(key = '') {
  const match = String(key || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(key || '');
}
function validDateKey(year, month, day) {
  const key = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const date = dateFromKey(key);
  if (!date || Number.isNaN(date.getTime())) return '';
  return localDateKey(date) === key ? key : '';
}
function easterSundayDateKey(year) {
  const y = Number(year);
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return validDateKey(y, month, day);
}
function holidayName(key = '') {
  const match = String(key || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const year = Number(match[1]);
  const mmdd = `${match[2]}-${match[3]}`;
  const fixed = {
    '01-01': 'Confraternização Universal',
    '04-21': 'Tiradentes',
    '05-01': 'Dia do Trabalho',
    '09-07': 'Independência do Brasil',
    '09-29': 'São Miguel Arcanjo — Guanhães',
    '10-12': 'Nossa Senhora Aparecida',
    '10-25': 'Aniversário de Guanhães',
    '11-02': 'Finados',
    '11-15': 'Proclamação da República',
    '11-20': 'Consciência Negra',
    '12-25': 'Natal'
  };
  if (fixed[mmdd]) return fixed[mmdd];
  const easter = easterSundayDateKey(year);
  if (key === shiftDateKey(easter, -2)) return 'Paixão de Cristo';
  if (key === shiftDateKey(easter, 60)) return 'Corpus Christi';
  const extras = String(process.env.ERP_BUSINESS_HOLIDAY_DATES || '').split(',').map((item) => item.trim()).filter(Boolean);
  return extras.includes(key) ? 'Feriado configurado no ERP' : '';
}
function weekday(key = '') {
  const match = String(key || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return -1;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)).getUTCDay();
}
function nonWorkingReason(key = '') {
  if (weekday(key) === 0) return 'domingo';
  return holidayName(key) ? 'feriado' : '';
}
function nextBusinessDateKey(key = '') {
  let cursor = key;
  for (let i = 0; i < 20; i += 1) {
    if (!nonWorkingReason(cursor)) return cursor;
    cursor = shiftDateKey(cursor, 1);
  }
  return cursor;
}

export function parseCollectionPromiseDate(text = '', now = new Date()) {
  const raw = clean(text, 800);
  if (!raw) return '';
  const normalized = stripAccents(raw).toLowerCase().replace(/[,.!?;:]+/g, ' ').replace(/\s+/g, ' ').trim();
  const today = localDateKey(now);
  const todayDate = dateFromKey(today);
  const currentYear = Number(today.slice(0, 4));
  const currentMonth = Number(today.slice(5, 7));
  const currentDay = Number(today.slice(8, 10));

  const iso = raw.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return validDateKey(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const br = raw.match(/\b(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?\b/);
  if (br) {
    let year = br[3] ? Number(br[3]) : currentYear;
    if (year < 100) year += 2000;
    let key = validDateKey(year, Number(br[2]), Number(br[1]));
    if (key && !br[3] && key < today) key = validDateKey(year + 1, Number(br[2]), Number(br[1]));
    return key;
  }

  if (/\bhoje\b/.test(normalized)) return today;
  if (/\bdepois de amanha\b/.test(normalized)) return shiftDateKey(today, 2);
  if (/\bamanha\b/.test(normalized)) return shiftDateKey(today, 1);

  const dayOnly = normalized.match(/\bdia\s+(\d{1,2})\b/);
  if (dayOnly) {
    const day = Number(dayOnly[1]);
    let year = currentYear;
    let month = currentMonth;
    if (day < currentDay) {
      month += 1;
      if (month > 12) { month = 1; year += 1; }
    }
    return validDateKey(year, month, day);
  }

  const weekdays = [
    ['domingo', 0], ['segunda', 1], ['terca', 2], ['quarta', 3], ['quinta', 4], ['sexta', 5], ['sabado', 6]
  ];
  for (const [name, target] of weekdays) {
    if (!new RegExp(`\\b${name}(?: feira)?\\b`).test(normalized)) continue;
    const current = todayDate ? todayDate.getDay() : weekday(today);
    let delta = (target - current + 7) % 7;
    if (delta === 0 && !/\bhoje\b/.test(normalized)) delta = 7;
    return shiftDateKey(today, delta);
  }

  return '';
}

function extractPromiseAmount(text = '') {
  const raw = clean(text, 800);
  let match = raw.match(/R\$\s*([\d.]+(?:,\d{1,2})?)/i);
  if (!match) match = raw.match(/\b([\d.]+(?:,\d{1,2})?)\s*reais\b/i);
  if (!match) return 0;
  const number = Number(String(match[1]).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(number) && number > 0 ? money(number) : 0;
}
function reportedPaid(text = '') {
  const n = stripAccents(clean(text, 700)).toLowerCase();
  return /\b(ja paguei|paguei|ja fiz o pix|fiz o pix|ja foi pago|fiz o pagamento|quitei)\b/.test(n);
}
function looksLikePromise(text = '', awaitingDate = false) {
  const n = stripAccents(clean(text, 700)).toLowerCase();
  if (awaitingDate && parseCollectionPromiseDate(text)) return true;
  const payment = /\b(pagar|pagando|pagarei|pago|pagamento|pix|parcela|parcelas|prestacao|prestacoes|notinha|notinhas|dinheiro|acertar|quitar|mandar|passar|enviar)\b/.test(n);
  const intent = /\b(vou|consigo|posso|pretendo|mando|pago|passo|envio|acerto|quito|sem falta|estou|to)\b/.test(n);
  const partialMonth = /\b(esse|este) mes\b/.test(n) && /\b(consigo|vou|posso|pagando|pagar|pago)\b/.test(n);
  return (payment && intent) || partialMonth;
}
function vaguePromisePeriod(text = '') {
  const n = stripAccents(clean(text, 700)).toLowerCase().replace(/[,.!?;:]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (/\b(esse|este) mes\b/.test(n)) return 'este mês';
  if (/\b(proximo|outro) mes\b|\bmes que vem\b/.test(n)) return 'próximo mês';
  if (/\bessa|esta|proxima semana\b|\bsemana que vem\b/.test(n)) return 'próxima semana';
  return '';
}
function normalizePhone(value = '') {
  let number = digits(value).replace(/^0+/, '');
  if (!number) return '';
  // Exceção internacional confirmada pelo operador: +1 (774) 602-2981.
  // Sem isso, o normalizador brasileiro prefixaria 55 novamente.
  if (number === '17746022981') return number;
  if (number.startsWith('55') && number.length >= 12 && number.length <= 13) return number;
  if (number.length === 10 || number.length === 11) return `55${number}`;
  return number.length >= 12 && number.length <= 15 ? number : '';
}
function collectionPhoneAliases(value = '') {
  const phone = normalizePhone(value);
  if (!phone) return [];
  const aliases = new Set([phone]);
  if (phone.startsWith('55')) {
    // WhatsApp/Evolution pode devolver o JID brasileiro com ou sem o 9º dígito.
    if (phone.length === 13 && phone[4] === '9') aliases.add(phone.slice(0, 4) + phone.slice(5));
    if (phone.length === 12 && /[6-9]/.test(phone[4] || '')) aliases.add(phone.slice(0, 4) + '9' + phone.slice(4));
  }
  return [...aliases];
}
function extractEvolutionMessage(body = {}) {
  const event = clean(body?.event || body?.type || body?.data?.event || body?.data?.type, 80).toUpperCase().replace(/[.\-\s]+/g, '_');
  const root = body?.data?.data || body?.data || body || {};
  const key = root?.key || body?.data?.key || body?.key || {};
  const fromMe = Boolean(key?.fromMe ?? root?.fromMe ?? body?.fromMe);
  const remoteJid = clean(key?.remoteJid || root?.remoteJid || root?.sender || body?.sender, 180);
  const phone = normalizePhone(remoteJid.split('@')[0] || root?.number || body?.number || '');
  const message = root?.message || body?.message || {};
  const text = clean(
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption ||
    message?.videoMessage?.caption ||
    root?.text ||
    root?.body ||
    body?.text ||
    '',
    1600
  );
  const messageId = clean(key?.id || root?.messageId || root?.id || body?.messageId || '', 220);
  return { event, fromMe, remoteJid, phone, text, messageId };
}
function taskModel() {
  if (mongoose.models.ErpMarkedCollectionTask) return mongoose.models.ErpMarkedCollectionTask;
  const schema = new mongoose.Schema({
    campaignKey: { type: String, required: true, index: true },
    name: { type: String, required: true },
    nameKey: { type: String, required: true, index: true },
    priority: { type: Number, default: 0, index: true },
    referenceBalance: { type: Number, default: 0 },
    resolution: { type: String, default: '' },
    status: { type: String, default: 'PENDING', index: true },
    matchedName: { type: String, default: '' },
    document: { type: String, default: '' },
    phone: { type: String, default: '', index: true },
    phoneSource: { type: String, default: '' },
    targetId: { type: String, default: '', index: true },
    overduePrincipal: { type: Number, default: 0 },
    overdueUpdated: { type: Number, default: 0 },
    overdueInstallments: { type: Number, default: 0 },
    maxDaysLate: { type: Number, default: 0 },
    initialMessage: { type: String, default: '' },
    initialMessageId: { type: String, default: '' },
    initialSentAt: { type: Date, default: null, index: true },
    awaitingPromiseDate: { type: Boolean, default: false },
    promiseDate: { type: Date, default: null, index: true },
    promiseAmount: { type: Number, default: 0 },
    promiseAmountExplicit: { type: Boolean, default: false },
    promiseRaw: { type: String, default: '' },
    promiseRegisteredAt: { type: Date, default: null },
    reminderSentAt: { type: Date, default: null },
    reminderForDate: { type: String, default: '' },
    reminderMessageId: { type: String, default: '' },
    lastInboundMessageId: { type: String, default: '' },
    lastInboundText: { type: String, default: '' },
    lastInboundAt: { type: Date, default: null },
    attempts: { type: Number, default: 0 },
    lockUntil: { type: Date, default: null },
    lastError: { type: String, default: '' }
  }, { timestamps: true, collection: 'erp_marked_collection_tasks' });
  schema.index({ campaignKey: 1, nameKey: 1 }, { unique: true });
  schema.index({ campaignKey: 1, phone: 1, initialSentAt: -1 });
  return mongoose.model('ErpMarkedCollectionTask', schema);
}

async function readEvolutionResponse(response) {
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw }; }
  if (!response.ok) throw new Error(clean(data?.message || data?.error || raw || `HTTP ${response.status}`, 700));
  return data;
}
function extractMessageId(data = {}) {
  return clean(data?.key?.id || data?.messageId || data?.id || data?.data?.key?.id || data?.data?.messageId || data?.response?.key?.id, 220);
}

export function createErpMarkedCollectionCampaignService(context = {}, options = {}) {
  const Task = taskModel();
  const collections = createErpCollectionWorkflowService(context);
  const campaignKey = clean(options.campaignKey || CAMPAIGN_KEY, 120);
  const campaignLabel = clean(options.label || 'Etapa 2', 80);
  const markedCollectionNames = Object.freeze(Array.isArray(options.names) && options.names.length ? options.names : MARKED_COLLECTION_NAMES);
  const markedReferenceBalances = Object.freeze(options.referenceBalances || MARKED_REFERENCE_BALANCES);
  const strictNameKeys = new Set(Array.isArray(options.strictNameKeys) ? options.strictNameKeys.map(normalizeCollectionName) : [...STRICT_NAME_KEYS]);
  const manualPhoneOverrides = Object.freeze(options.manualPhoneOverrides || MANUAL_PHONE_OVERRIDES);
  const userSkippedKeys = new Set(Array.isArray(options.userSkippedKeys) ? options.userSkippedKeys.map(normalizeCollectionName) : [...USER_SKIPPED_KEYS]);
  const ariadnaKey = normalizeCollectionName(options.specialRetryName || 'Ariadna Santos Sardinha');
  const enableLucianoRecovery = options.enableLucianoRecovery !== false;
  const operatorRecoveries = Array.isArray(options.operatorRecoveries) ? options.operatorRecoveries : [];

  async function whatsappConfig() {
    let base = clean(process.env.ERP_COLLECTION_EVOLUTION_API_URL || process.env.ARIANA_EVOLUTION_API_URL || process.env.EVOLUTION_API_URL || process.env.EVOLUTION_URL, 500).replace(/\/+$/, '');
    let apiKey = clean(process.env.ERP_COLLECTION_EVOLUTION_API_KEY || process.env.ARIANA_EVOLUTION_API_KEY || process.env.EVOLUTION_API_KEY || process.env.EVOLUTION_GLOBAL_API_KEY, 500);
    let enabled = true;
    if (typeof context.getWhatsappSettings === 'function') {
      try {
        const settings = await context.getWhatsappSettings();
        enabled = settings?.enabled !== false;
        base = base || clean(settings?.apiUrl || '', 500).replace(/\/+$/, '');
        apiKey = apiKey || clean(settings?.apiKey || '', 500);
      } catch (error) {
        console.warn('[erp-marked-collection][whatsapp-settings]', error?.message || error);
      }
    }
    const instance = clean(
      process.env.ERP_COLLECTION_MAIN_STORE_EVOLUTION_INSTANCE ||
      process.env.ERP_DAILY_DUE_WHATSAPP_INSTANCE ||
      process.env.LOJA_EVOLUTION_INSTANCE ||
      'ariana loja',
      180
    );
    return { base, apiKey, instance, enabled };
  }
  async function sendWhatsapp(phone, text) {
    const cfg = await whatsappConfig();
    const number = normalizePhone(phone);
    if (!cfg.base || !cfg.apiKey || !cfg.instance || !number) throw new Error('WhatsApp da cobrança não está configurado corretamente.');
    const response = await fetch(`${cfg.base}/message/sendText/${encodeURIComponent(cfg.instance)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.apiKey },
      body: JSON.stringify({ number, text, delay: 0, linkPreview: false }),
      signal: AbortSignal.timeout(30000)
    });
    const data = await readEvolutionResponse(response);
    return { messageId: extractMessageId(data), instance: cfg.instance };
  }
  async function seed() {
    await Promise.all(markedCollectionNames.map((name, index) => Task.updateOne(
      { campaignKey: campaignKey, nameKey: normalizeCollectionName(name) },
      { $setOnInsert: { campaignKey: campaignKey, name, nameKey: normalizeCollectionName(name), status: 'PENDING', attempts: 0, createdAt: new Date() }, $set: { priority: index + 1, referenceBalance: money(markedReferenceBalances[name] || 0) } },
      { upsert: true }
    )));
  }
  async function resolveClientPhone(client = {}) {
    const direct = normalizePhone(client.phone);
    if (direct) return { phone: direct, source: 'receivable' };

    const document = digits(client.document);
    const nameKey = normalizeCollectionName(client.name);

    const Person = mongoose.models.ErpPerson;
    if (Person) {
      try {
        if (document) {
          const person = await Person.findOne({ document, active: { $ne: false } })
            .sort({ updatedAt: -1 })
            .select('name companyName document phone updatedAt')
            .lean();
          const phone = normalizePhone(person?.phone);
          if (phone) return { phone, source: 'erp_person_document' };
        }

        if (nameKey) {
          const rows = await Person.find({ active: { $ne: false }, phone: { $exists: true, $ne: '' } })
            .select('name companyName document phone updatedAt')
            .limit(5000)
            .lean();
          const exact = rows.filter((person) => normalizeCollectionName(person?.name || person?.companyName) === nameKey);
          const phones = [...new Set(exact.map((person) => normalizePhone(person?.phone)).filter(Boolean))];
          if (phones.length === 1) return { phone: phones[0], source: 'erp_person_name' };
        }
      } catch (error) {
        console.warn('[erp-marked-collection][phone][person]', error?.message || error);
      }
    }

    const User = context.User;
    if (User) {
      try {
        let users = [];
        if (document) {
          users = await User.find({ cpf: document, isActive: { $ne: false } })
            .select('name cpf phone updatedAt')
            .sort({ updatedAt: -1 })
            .limit(20)
            .lean();
        } else if (nameKey) {
          const possible = await User.find({ isActive: { $ne: false }, phone: { $exists: true, $ne: '' } })
            .select('name cpf phone updatedAt')
            .limit(5000)
            .lean();
          users = possible.filter((user) => normalizeCollectionName(user?.name) === nameKey);
        }
        const phones = [...new Set(users.map((user) => normalizePhone(user?.phone)).filter(Boolean))];
        if (phones.length === 1) return { phone: phones[0], source: document ? 'site_user_document' : 'site_user_name' };
      } catch (error) {
        console.warn('[erp-marked-collection][phone][user]', error?.message || error);
      }
    }

    const CrediarioCliente = context.CrediarioCliente;
    if (CrediarioCliente) {
      try {
        let rows = [];
        if (document) {
          rows = await CrediarioCliente.find({ cpf: document })
            .select('nome name cpf telefone phone updatedAt')
            .sort({ updatedAt: -1 })
            .limit(20)
            .lean();
        } else if (nameKey) {
          const possible = await CrediarioCliente.find({})
            .select('nome name cpf telefone phone updatedAt')
            .limit(5000)
            .lean();
          rows = possible.filter((row) => normalizeCollectionName(row?.nome || row?.name) === nameKey);
        }
        const phones = [...new Set(rows.map((row) => normalizePhone(row?.telefone || row?.phone)).filter(Boolean))];
        if (phones.length === 1) return { phone: phones[0], source: document ? 'crediario_document' : 'crediario_name' };
      } catch (error) {
        console.warn('[erp-marked-collection][phone][crediario]', error?.message || error);
      }
    }

    const Order = context.Order;
    if (Order) {
      try {
        let orders = [];
        if (document) {
          orders = await Order.find({ customerCpf: document, customerPhone: { $exists: true, $ne: '' } })
            .select('customerName customerCpf customerPhone updatedAt')
            .sort({ updatedAt: -1 })
            .limit(30)
            .lean();
        } else if (nameKey) {
          const possible = await Order.find({ customerPhone: { $exists: true, $ne: '' } })
            .select('customerName customerCpf customerPhone updatedAt')
            .sort({ updatedAt: -1 })
            .limit(5000)
            .lean();
          orders = possible.filter((order) => normalizeCollectionName(order?.customerName) === nameKey);
        }
        const phones = [...new Set(orders.map((order) => normalizePhone(order?.customerPhone)).filter(Boolean))];
        if (phones.length === 1) return { phone: phones[0], source: document ? 'order_document' : 'order_name' };
        if (document && orders.length) {
          const latest = normalizePhone(orders[0]?.customerPhone);
          if (latest) return { phone: latest, source: 'order_document_latest' };
        }
      } catch (error) {
        console.warn('[erp-marked-collection][phone][order]', error?.message || error);
      }
    }

    return { phone: '', source: '' };
  }
  function initialMessage(client = {}) {
    return [
      `Olá, ${firstName(client.name)}! Tudo bem?`,
      '',
      `Consta no financeiro da Ariana Móveis um saldo vencido atualizado de *${moneyText(client.totalUpdated)}*.`,
      'Você consegue me informar uma previsão de pagamento, por favor?',
      '',
      'Se já tiver regularizado, desconsidere esta mensagem.',
      'Marcelo – Ariana Móveis.'
    ].join('\n');
  }
  function promiseReminderMessage(task = {}, carried = false) {
    const amount = task.promiseAmountExplicit === true ? Number(task.promiseAmount || 0) : 0;
    const line = carried
      ? 'Passando para lembrar do pagamento que ficou combinado com a Ariana Móveis.'
      : 'Passando para lembrar do pagamento que ficou combinado para hoje com a Ariana Móveis.';
    return [
      `Bom dia, ${firstName(task.matchedName || task.name)}! Tudo bem?`,
      '',
      line,
      amount > 0 ? `Valor combinado: *${moneyText(amount)}*.` : '',
      'Se já pagou, desconsidere. Qualquer dúvida, estou à disposição.',
      'Marcelo – Ariana Móveis.'
    ].filter(Boolean).join('\n');
  }
  async function queueSnapshot() {
    return collections.fila({ from: '2000-01-01', to: localDateKey(), filter: 'all' });
  }
  async function resolveAndSendInitial() {
    if (mongoose.connection.readyState !== 1) return { skipped: true, reason: 'mongo_not_ready' };
    await seed();
    const today = localDateKey();
    if (nonWorkingReason(today)) return { skipped: true, reason: 'non_working_day', date: today };
    const queue = await queueSnapshot();
    const byName = new Map();
    for (const client of queue.clients || []) {
      const key = normalizeCollectionName(client.name);
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(client);
    }
    const allClients = queue.clients || [];
    const tasks = await Task.find({ campaignKey: campaignKey }).sort({ priority: 1, createdAt: 1 }).lean();
    const results = [];
    for (const task of tasks) {
      if (userSkippedKeys.has(task.nameKey)) {
        await Task.updateOne({ _id: task._id }, { $set: { status: 'SKIPPED_USER_REQUEST', lockUntil: null, lastError: 'Cobrança dispensada pelo operador em 01/10/2026.' } });
        results.push({ name: task.name, status: 'SKIPPED_USER_REQUEST' });
        continue;
      }
      const resolved = resolveMarkedClient(task, allClients, byName, strictNameKeys);
      if (!resolved.client) {
        const ambiguous = resolved.resolution === 'ambiguous';
        const status = ambiguous ? 'AMBIGUOUS' : 'NOT_FOUND';
        const lastError = ambiguous
          ? 'Há mais de um cadastro compatível no ERP e o saldo de referência não identifica um único registro com segurança; envio bloqueado.'
          : 'Cliente não localizado com saldo vencido no ERP.';
        await Task.updateOne({ _id: task._id }, { $set: { status: task.initialSentAt ? task.status : status, resolution: resolved.resolution || '', lastError } });
        results.push({ name: task.name, status, matches: Number(resolved.matches || 0) });
        continue;
      }
      const client = resolved.client;
      const manualPhone = manualPhoneOverrides[task.nameKey] || '';
      const contact = manualPhone
        ? { phone: manualPhone, source: 'manual_international_confirmed' }
        : await resolveClientPhone(client);
      const phone = contact.phone;
      const targetId = clean(client.entries?.[0]?.id || '', 260);
      const details = {
        matchedName: clean(client.name, 220),
        resolution: resolved.resolution || 'exact',
        document: clean(client.document, 80),
        phone,
        phoneSource: contact.source || '',
        targetId,
        overduePrincipal: money(client.totalOverdue),
        overdueUpdated: money(client.totalUpdated),
        overdueInstallments: Number(client.entries?.length || 0),
        maxDaysLate: Number(client.maxDaysLate || 0),
        lastError: ''
      };
      await Task.updateOne({ _id: task._id }, { $set: details });
      if (task.initialSentAt) {
        results.push({ name: task.name, status: task.status || 'SENT', alreadySent: true });
        continue;
      }
      // Não repete automaticamente um envio que já falhou: evita mensagem duplicada
      // caso a Evolution tenha aceitado a mensagem e a confirmação tenha se perdido.
      // Retransmissão extraordinária autorizada em 01/10/2026:
      // permite uma segunda tentativa somente para os envios que falharam.
      // Depois da 2ª tentativa, volta a bloquear automaticamente para evitar duplicidade.
      const retryLimit = task.nameKey === ariadnaKey ? 4 : 2;
      if (task.status === 'FAILED' && Number(task.attempts || 0) >= retryLimit) {
        results.push({ name: task.name, status: 'FAILED', error: clean(task.lastError || `Falha após ${retryLimit} tentativa(s); aguardando revisão.`, 300) });
        continue;
      }
      if (!phone) {
        await Task.updateOne({ _id: task._id }, { $set: { status: 'NO_PHONE', lastError: 'Cliente sem WhatsApp válido no cadastro atual do ERP.' } });
        results.push({ name: task.name, status: 'NO_PHONE' });
        continue;
      }
      if (!targetId || Number(client.totalUpdated || 0) <= 0) {
        await Task.updateOne({ _id: task._id }, { $set: { status: 'NO_DEBT', lastError: 'Nenhum saldo vencido disponível para cobrança.' } });
        results.push({ name: task.name, status: 'NO_DEBT' });
        continue;
      }
      const monthlyClaim = await claimMonthlyFinancialContact(context, {
        dateKey: today,
        source: 'campanha_' + campaignKey,
        customerName: client.name,
        customerDocument: client.document,
        phone,
        customerKey: client.key || task.nameKey,
        rows: client.entries || [],
        updatedBy: 'erp-marked-collection'
      });
      if (!monthlyClaim.claimed) {
        const priorSource = clean(monthlyClaim?.prior?.source || 'contato financeiro anterior', 120);
        await Task.updateOne({ _id: task._id }, { $set: { status: 'SKIPPED_MONTHLY_CONTACT', lockUntil: null, lastError: 'Cliente já recebeu lembrete/cobrança neste mês: ' + priorSource } });
        results.push({ name: task.name, status: 'SKIPPED_MONTHLY_CONTACT', priorSource });
        continue;
      }
      const now = new Date();
      const claimed = await Task.findOneAndUpdate(
        { _id: task._id, initialSentAt: null, $or: [{ lockUntil: null }, { lockUntil: { $lt: now } }] },
        { $set: { status: 'SENDING', lockUntil: new Date(now.getTime() + 120000), ...details }, $inc: { attempts: 1 } },
        { new: true }
      ).lean();
      if (!claimed) {
        await releaseMonthlyFinancialContact(context, monthlyClaim);
        results.push({ name: task.name, status: 'LOCKED' });
        continue;
      }
      const message = initialMessage(client);
      try {
        const sent = await sendWhatsapp(phone, message);
        const sentAt = new Date();
        await Task.updateOne({ _id: task._id }, { $set: { status: 'AWAITING_REPLY', initialMessage: message, initialMessageId: sent.messageId || '', initialSentAt: sentAt, lockUntil: null, lastError: '' } });
        await confirmMonthlyFinancialContact(context, monthlyClaim, { sentAt, source: 'campanha_' + campaignKey, messageId: sent.messageId || '', updatedBy: 'erp-marked-collection' });
        results.push({ name: task.name, status: 'SENT', balance: money(client.totalUpdated), phoneSource: contact.source || '' });
      } catch (error) {
        await releaseMonthlyFinancialContact(context, monthlyClaim);
        await Task.updateOne({ _id: task._id }, { $set: { status: 'FAILED', lockUntil: null, lastError: clean(error?.message || error, 1000) } });
        results.push({ name: task.name, status: 'FAILED', error: clean(error?.message || error, 300) });
      }
    }
    return { ok: true, date: today, results };
  }
  async function recoverOperatorConfirmedLucianoPromise() {
    if (!enableLucianoRecovery) return { skipped: true, reason: 'disabled_for_campaign' };
    const lucianoKey = normalizeCollectionName('Luciano Nunes Vieira Silva');
    const task = await Task.findOne({ campaignKey: campaignKey, nameKey: lucianoKey }).lean();
    if (!task || !task.targetId || task.promiseRegisteredAt) return { skipped: true };
    const promiseDateKey = '2026-10-10';
    const raw = 'Sim no próximo final de semana dia dez consigo te pagar mais 2 prestação';
    try {
      await collections.registrarAcao(task.targetId, {
        action: 'promessa',
        promiseDate: promiseDateKey,
        promiseAmount: 0,
        note: 'Promessa confirmada pelo operador a partir da conversa do WhatsApp da loja. Cliente informou pagamento de mais 2 prestações no dia 10/10/2026. Mensagem: ' + raw
      }, { name: `Automação Cobrança ${campaignLabel}` });
      await Task.updateOne({ _id: task._id }, { $set: {
        status: 'PROMISE',
        promiseDate: dateFromKey(promiseDateKey),
        promiseAmount: 0,
        promiseAmountExplicit: false,
        promiseRaw: raw,
        promiseRegisteredAt: new Date(),
        awaitingPromiseDate: false,
        reminderSentAt: null,
        reminderForDate: '',
        reminderMessageId: '',
        lastInboundMessageId: task.lastInboundMessageId || 'operator-evidence-luciano-2026-10-01-1312',
        lastInboundText: raw,
        lastInboundAt: new Date('2026-10-01T13:12:00-03:00'),
        lastError: ''
      } });
      console.log('[erp-marked-collection-recovery] promessa do Luciano registrada para 2026-10-10.');
      return { recovered: true, name: task.name, promiseDate: promiseDateKey };
    } catch (error) {
      console.error('[erp-marked-collection-recovery] falha ao registrar promessa do Luciano:', error?.message || error);
      return { recovered: false, error: clean(error?.message || error, 300) };
    }
  }

  async function recoverOperatorConfirmedPromises() {
    if (!operatorRecoveries.length) return { skipped: true, reason: 'none' };
    const results = [];
    for (const item of operatorRecoveries) {
      const key = normalizeCollectionName(item?.name || '');
      if (!key) continue;
      const task = await Task.findOne({ campaignKey, nameKey: key }).lean();
      if (!task || !task.targetId) {
        results.push({ name: item?.name || '', status: 'not_found' });
        continue;
      }
      const raw = clean(item?.text || '', 700);
      const promiseDateKey = clean(item?.promiseDate || '', 10);
      if (promiseDateKey) {
        if (task.promiseRegisteredAt && localDateKey(new Date(task.promiseDate || 0)) === promiseDateKey && task.promiseAmount === 0) {
          results.push({ name: task.name, status: 'already_registered', promiseDate: promiseDateKey });
          continue;
        }
        try {
          await collections.registrarAcao(task.targetId, {
            action: 'promessa',
            promiseDate: promiseDateKey,
            promiseAmount: 0,
            note: `Promessa confirmada pelo operador a partir da conversa do WhatsApp da loja. Mensagem do cliente: ${raw}. Cliente não informou valor exato; nenhum valor foi presumido.`
          }, { name: `Automação Cobrança ${campaignLabel}` });
          await Task.updateOne({ _id: task._id }, { $set: {
            status: 'PROMISE',
            promiseDate: dateFromKey(promiseDateKey),
            promiseAmount: 0,
            promiseAmountExplicit: false,
            promiseRaw: raw,
            promiseRegisteredAt: new Date(),
            awaitingPromiseDate: false,
            reminderSentAt: null,
            reminderForDate: '',
            reminderMessageId: '',
            lastInboundText: raw,
            lastInboundAt: new Date(),
            lastError: ''
          } });
          results.push({ name: task.name, status: 'registered', promiseDate: promiseDateKey });
        } catch (error) {
          results.push({ name: task.name, status: 'error', error: clean(error?.message || error, 300) });
        }
        continue;
      }
      if (item?.awaitDate === true) {
        if (task.awaitingPromiseDate === true && clean(task.promiseRaw,700) === raw) {
          results.push({ name: task.name, status: 'already_waiting_date' });
          continue;
        }
        await Task.updateOne({ _id: task._id }, { $set: {
          status: 'AWAITING_PROMISE_DATE',
          awaitingPromiseDate: true,
          promiseRaw: raw,
          promiseAmount: 0,
          promiseAmountExplicit: false,
          lastInboundText: raw,
          lastInboundAt: new Date(),
          lastError: ''
        } });
        if (item?.sendQuestion !== false && task.phone) {
          const period = vaguePromisePeriod(raw) || 'desse período';
          await sendWhatsapp(task.phone, `Entendi, ${firstName(task.matchedName || task.name)}. Qual dia ${period} você consegue fazer esse pagamento? Se souber, pode me informar também o valor ou quantas parcelas pretende pagar.`).catch(() => null);
        }
        results.push({ name: task.name, status: 'waiting_date' });
      }
    }
    if (results.length) console.log('[erp-marked-collection-operator-recovery]', campaignLabel, results);
    return { ok: true, results };
  }

  async function currentClientForTask(task = {}) {
    const queue = await collections.fila({ q: task.matchedName || task.name, from: '2000-01-01', to: localDateKey(), filter: 'all' });
    const matches = (queue.clients || []).filter((client) => normalizeCollectionName(client.name) === task.nameKey);
    if (task.document) {
      const byDoc = matches.find((client) => digits(client.document) && digits(client.document) === digits(task.document));
      if (byDoc) return byDoc;
    }
    return matches.length === 1 ? matches[0] : null;
  }
  async function sendPromiseReminders() {
    if (mongoose.connection.readyState !== 1) return { skipped: true, reason: 'mongo_not_ready' };
    const today = localDateKey();
    if (nonWorkingReason(today)) return { skipped: true, reason: 'non_working_day', date: today };
    const tasks = await Task.find({ campaignKey: campaignKey, status: 'PROMISE', promiseDate: { $ne: null }, reminderSentAt: null }).sort({ promiseDate: 1 }).lean();
    const sent = [];
    for (const task of tasks) {
      const promiseKey = localDateKey(new Date(task.promiseDate));
      const effective = nextBusinessDateKey(promiseKey);
      if (!effective || effective > today) continue;
      const client = await currentClientForTask(task).catch(() => null);
      if (!client || Number(client.totalUpdated || 0) <= 0) {
        await Task.updateOne({ _id: task._id }, { $set: { status: 'CLOSED_NO_DEBT', lastError: 'Saldo vencido não está mais em aberto; lembrete da promessa não foi enviado.' } });
        continue;
      }
      const now = new Date();
      const claimed = await Task.findOneAndUpdate(
        { _id: task._id, reminderSentAt: null, $or: [{ lockUntil: null }, { lockUntil: { $lt: now } }] },
        { $set: { lockUntil: new Date(now.getTime() + 120000) } },
        { new: true }
      ).lean();
      if (!claimed) continue;
      try {
        const carried = effective !== promiseKey;
        const message = promiseReminderMessage(task, carried);
        const result = await sendWhatsapp(task.phone, message);
        await Task.updateOne({ _id: task._id }, { $set: { reminderSentAt: new Date(), reminderForDate: promiseKey, reminderMessageId: result.messageId || '', lockUntil: null, status: 'PROMISE_REMINDER_SENT', lastError: '' } });
        sent.push({ name: task.name, promiseDate: promiseKey, carried });
      } catch (error) {
        await Task.updateOne({ _id: task._id }, { $set: { lockUntil: null, lastError: clean(error?.message || error, 1000) } });
      }
    }
    return { ok: true, date: today, sent };
  }
  async function handleIncomingWebhook(body = {}) {
    const suppressAck = body?.internal?.suppressAck === true;
    const incoming = extractEvolutionMessage(body);
    if (incoming.event && incoming.event !== 'MESSAGES_UPSERT') return { handled: false, reason: 'event' };
    if (incoming.fromMe || !incoming.phone || !incoming.text) return { handled: false, reason: 'not_customer_text' };
    const phoneAliases = collectionPhoneAliases(incoming.phone);
    const candidates = await Task.find({ campaignKey: campaignKey, phone: { $in: phoneAliases }, initialSentAt: { $ne: null } }).sort({ initialSentAt: -1 }).limit(3).lean();
    if (!candidates.length) return { handled: false, reason: 'not_campaign_customer' };
    const active = candidates.filter((item) => !['CLOSED_NO_DEBT'].includes(item.status));
    if (active.length > 1 && new Set(active.map((item) => item.document || item.nameKey)).size > 1) {
      return { handled: false, reason: 'ambiguous_phone' };
    }
    const task = active[0] || candidates[0];
    if (incoming.messageId && task.lastInboundMessageId === incoming.messageId) return { handled: true, duplicate: true };
    await Task.updateOne({ _id: task._id }, { $set: { lastInboundMessageId: incoming.messageId || '', lastInboundText: incoming.text, lastInboundAt: new Date() } });

    if (reportedPaid(incoming.text)) {
      await Task.updateOne({ _id: task._id }, { $set: { status: 'PAID_REPORTED', awaitingPromiseDate: false, lastError: '' } });
      if (!suppressAck) await sendWhatsapp(task.phone, `Obrigado, ${firstName(task.matchedName || task.name)}! 😊 Se puder, envie o comprovante por aqui para a gente conferir a baixa no financeiro.`).catch(() => null);
      return { handled: true, action: 'paid_reported', taskId: String(task._id) };
    }

    const promiseDateKey = parseCollectionPromiseDate(incoming.text);
    const promiseLike = looksLikePromise(incoming.text, task.awaitingPromiseDate === true);
    if (!promiseLike && !promiseDateKey) return { handled: false, reason: 'not_promise' };
    if (!promiseDateKey) {
      const period = vaguePromisePeriod(incoming.text);
      await Task.updateOne({ _id: task._id }, { $set: { status: 'AWAITING_PROMISE_DATE', awaitingPromiseDate: true, promiseRaw: incoming.text, promiseAmount: 0, promiseAmountExplicit: false, lastError: '' } });
      if (!suppressAck) {
        const question = period
          ? `Entendi, ${firstName(task.matchedName || task.name)}. Qual dia ${period} você consegue fazer esse pagamento? Se souber, pode me informar também o valor ou quantas parcelas pretende pagar.`
          : `Certo, ${firstName(task.matchedName || task.name)}. Qual dia você consegue fazer esse pagamento? Se souber, pode me informar também o valor ou quantas parcelas pretende pagar.`;
        await sendWhatsapp(task.phone, question).catch(() => null);
      }
      return { handled: true, action: 'ask_promise_date', taskId: String(task._id) };
    }

    const explicitAmount = extractPromiseAmount(incoming.text);
    const promiseAmount = explicitAmount || 0;
    const note = `Promessa capturada automaticamente da resposta à cobrança ${campaignLabel}. Mensagem do cliente: ${clean(incoming.text, 700)}${explicitAmount ? '' : ' | Cliente não informou valor exato; nenhum valor foi presumido.'}`;
    try {
      await collections.registrarAcao(task.targetId, {
        action: 'promessa',
        promiseDate: promiseDateKey,
        promiseAmount,
        note
      }, { name: `Automação Cobrança ${campaignLabel}` });
    } catch (error) {
      await Task.updateOne({ _id: task._id }, { $set: { status: 'PROMISE_REVIEW', promiseRaw: incoming.text, awaitingPromiseDate: false, lastError: clean(error?.message || error, 1000) } });
      return { handled: true, action: 'promise_review', error: clean(error?.message || error, 300), taskId: String(task._id) };
    }

    await Task.updateOne({ _id: task._id }, { $set: { status: 'PROMISE', promiseDate: dateFromKey(promiseDateKey), promiseAmount, promiseAmountExplicit: Boolean(explicitAmount), promiseRaw: incoming.text, promiseRegisteredAt: new Date(), awaitingPromiseDate: false, reminderSentAt: null, reminderForDate: '', reminderMessageId: '', lastError: '' } });
    const ack = explicitAmount
      ? `Certo, ${firstName(task.matchedName || task.name)}. Anotei a previsão para *${formatDatePtBr(promiseDateKey)}*, no valor de *${moneyText(explicitAmount)}*. Obrigado pelo retorno.`
      : `Certo, ${firstName(task.matchedName || task.name)}. Anotei a previsão de pagamento para *${formatDatePtBr(promiseDateKey)}*. Obrigado pelo retorno.`;
    if (!suppressAck) await sendWhatsapp(task.phone, ack).catch(() => null);
    return { handled: true, action: 'promise_registered', promiseDate: promiseDateKey, promiseAmount, taskId: String(task._id) };
  }
  function evolutionRecordTimestamp(record = {}) {
    const raw = record?.messageTimestamp ?? record?.timestamp ?? record?.createdAt ?? record?.updatedAt ?? 0;
    if (typeof raw === 'number') return raw > 1e12 ? raw : raw * 1000;
    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric > 0) return numeric > 1e12 ? numeric : numeric * 1000;
    const parsed = new Date(raw).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  function evolutionMessageRecords(data = {}) {
    const candidates = [
      data?.messages?.records,
      data?.data?.messages?.records,
      data?.response?.messages?.records,
      data?.records,
      data?.messages,
      data?.data?.records
    ];
    for (const value of candidates) if (Array.isArray(value)) return value;
    return [];
  }
  async function pollStoreReplies() {
    if (mongoose.connection.readyState !== 1) return { skipped: true, reason: 'mongo_not_ready' };
    const cfg = await whatsappConfig();
    if (!cfg.enabled || !cfg.base || !cfg.apiKey || !cfg.instance) return { skipped: true, reason: 'whatsapp_not_configured' };
    const tasks = await Task.find({
      campaignKey: campaignKey,
      initialSentAt: { $ne: null },
      phone: { $ne: '' },
      status: { $nin: ['CLOSED_NO_DEBT', 'SKIPPED_USER_REQUEST'] }
    }).sort({ initialSentAt: 1 }).lean();
    const results = [];
    const taskByPhone = new Map();
    for (const task of tasks) {
      for (const alias of collectionPhoneAliases(task.phone)) taskByPhone.set(alias, task);
    }
    try {
      const bulkResponse = await fetch(`${cfg.base}/chat/findMessages/${encodeURIComponent(cfg.instance)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: cfg.apiKey },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(30000)
      });
      const bulkData = await readEvolutionResponse(bulkResponse);
      const bulkRecords = evolutionMessageRecords(bulkData)
        .filter(record => record?.key?.fromMe === false)
        .sort((a,b) => evolutionRecordTimestamp(a) - evolutionRecordTimestamp(b));
      for (const record of bulkRecords) {
        const jidCandidates = [
          record?.key?.remoteJid,
          record?.key?.remoteJidAlt,
          record?.remoteJid,
          record?.remoteJidAlt,
          record?.sender,
          record?.participant
        ].filter(Boolean);
        let task = null;
        for (const jid of jidCandidates) {
          const phone = normalizePhone(String(jid).split('@')[0]);
          for (const alias of collectionPhoneAliases(phone)) {
            if (taskByPhone.has(alias)) { task = taskByPhone.get(alias); break; }
          }
          if (task) break;
        }
        if (!task) continue;
        const ts = evolutionRecordTimestamp(record);
        if (ts && ts < new Date(task.initialSentAt).getTime() - 60000) continue;
        const id = clean(record?.key?.id || record?.id || record?.messageId || '', 220);
        if (id && id === task.lastInboundMessageId) continue;
        const ageMs = ts ? Date.now() - ts : 0;
        const handled = await handleIncomingWebhook({
          event: 'MESSAGES_UPSERT',
          data: record,
          internal: { suppressAck: ageMs > 15 * 60 * 1000 }
        });
        if (handled?.handled) results.push({ name: task.name, action: handled.action || 'handled', messageId: id || '' });
      }
    } catch (error) {
      results.push({ name: 'store_bulk', action: 'poll_error', error: clean(error?.message || error, 220) });
    }
    for (const task of tasks) {
      try {
        const number = normalizePhone(task.phone);
        if (!number) continue;
        const remoteJid = number + '@s.whatsapp.net';
        const response = await fetch(`${cfg.base}/chat/findMessages/${encodeURIComponent(cfg.instance)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: cfg.apiKey },
          body: JSON.stringify({ where: { key: { remoteJid } } }),
          signal: AbortSignal.timeout(30000)
        });
        const data = await readEvolutionResponse(response);
        const records = evolutionMessageRecords(data)
          .filter((record) => record?.key?.fromMe === false)
          .map((record) => ({ record, ts: evolutionRecordTimestamp(record) }))
          .filter((item) => !item.ts || item.ts >= new Date(task.initialSentAt).getTime() - 60000)
          .sort((a,b) => a.ts - b.ts);
        for (const item of records) {
          const record = item.record || {};
          const id = clean(record?.key?.id || record?.id || record?.messageId || '', 220);
          if (id && id === task.lastInboundMessageId) continue;
          const ageMs = item.ts ? Date.now() - item.ts : 0;
          const payload = {
            event: 'MESSAGES_UPSERT',
            data: record,
            internal: { suppressAck: ageMs > 15 * 60 * 1000 }
          };
          const handled = await handleIncomingWebhook(payload);
          if (handled?.handled) {
            results.push({ name: task.name, action: handled.action || (handled.duplicate ? 'duplicate' : 'handled'), messageId: id || '' });
          }
        }
      } catch (error) {
        results.push({ name: task.name, action: 'poll_error', error: clean(error?.message || error, 220) });
      }
    }
    if (results.length) console.log('[erp-marked-collection-store-poll]', results);
    return { ok: true, results };
  }

  async function list() {
    await seed();
    const rows = await Task.find({ campaignKey: campaignKey }).sort({ priority: 1, createdAt: 1 }).lean();
    const tasks = rows.map((row) => ({
      id: String(row._id),
      name: row.name,
      matchedName: row.matchedName,
      document: row.document,
      phone: row.phone,
      phoneSource: row.phoneSource,
      targetId: row.targetId,
      referenceBalance: money(row.referenceBalance),
      resolution: row.resolution,
      status: row.status,
      overduePrincipal: money(row.overduePrincipal),
      overdueUpdated: money(row.overdueUpdated),
      overdueInstallments: Number(row.overdueInstallments || 0),
      maxDaysLate: Number(row.maxDaysLate || 0),
      initialSentAt: row.initialSentAt,
      promiseDate: row.promiseDate,
      promiseAmount: money(row.promiseAmount),
      promiseAmountExplicit: row.promiseAmountExplicit === true,
      promiseRegisteredAt: row.promiseRegisteredAt,
      reminderSentAt: row.reminderSentAt,
      lastInboundText: row.lastInboundText,
      lastInboundAt: row.lastInboundAt,
      lastError: row.lastError
    }));
    return {
      campaignKey,
      label: campaignLabel,
      date: localDateKey(),
      summary: {
        total: tasks.length,
        sent: tasks.filter((item) => item.initialSentAt).length,
        promises: tasks.filter((item) => ['PROMISE', 'PROMISE_REMINDER_SENT'].includes(item.status)).length,
        reminders: tasks.filter((item) => item.reminderSentAt).length,
        ambiguous: tasks.filter((item) => item.status === 'AMBIGUOUS').length,
        missing: tasks.filter((item) => ['NOT_FOUND', 'NO_PHONE'].includes(item.status)).length,
        monthlySkipped: tasks.filter((item) => item.status === 'SKIPPED_MONTHLY_CONTACT').length,
        totalUpdated: money(tasks.reduce((sum, item) => sum + Number(item.overdueUpdated || 0), 0))
      },
      tasks
    };
  }
  async function run() {
    const initial = await resolveAndSendInitial();
    const recovery = await recoverOperatorConfirmedLucianoPromise();
    const operatorRecovery = await recoverOperatorConfirmedPromises();
    const replies = await pollStoreReplies();
    const reminders = await sendPromiseReminders();
    return { initial, recovery, operatorRecovery, replies, reminders, ...(await list()) };
  }
  function start() {
    if (!globalThis.__erpMarkedCollectionCampaignWorkers) globalThis.__erpMarkedCollectionCampaignWorkers = new Set();
    if (globalThis.__erpMarkedCollectionCampaignWorkers.has(campaignKey)) return;
    globalThis.__erpMarkedCollectionCampaignWorkers.add(campaignKey);
    const tick = async () => {
      try {
        const result = await run();
        console.log('[erp-marked-collection-worker] ciclo concluído', {
          total: result?.summary?.total || 0,
          sent: result?.summary?.sent || 0,
          promises: result?.summary?.promises || 0,
          reminders: result?.summary?.reminders || 0,
          ambiguous: result?.summary?.ambiguous || 0,
          missing: result?.summary?.missing || 0
        });
        if (Array.isArray(result?.initial?.results)) {
          console.log('[erp-marked-collection-worker] itens', result.initial.results.map((item) => ({
            name: item.name,
            status: item.status,
            matches: item.matches || 0,
            ...(item.error ? { error: clean(item.error, 220) } : {})
          })));
        }
      } catch (error) {
        console.error('[erp-marked-collection-worker]', error?.message || error);
      }
    };
    // Executa no boot e repete após o Mongo estar pronto; o primeiro tick
    // pode ocorrer alguns segundos antes da conexão do banco no Render.
    void tick();
    const startupRetry = setTimeout(tick, 7000);
    startupRetry.unref?.();
    const interval = setInterval(tick, Math.max(5 * 60 * 1000, Number(process.env.ERP_MARKED_COLLECTION_INTERVAL_MS || 15 * 60 * 1000)));
    interval.unref?.();
    console.log(`[erp-marked-collection-worker] ${campaignLabel} ativo para ${markedCollectionNames.length} clientes.`);
  }

  return { list, run, start, handleIncomingWebhook, pollStoreReplies, parsePromiseDate: parseCollectionPromiseDate };
}

export default createErpMarkedCollectionCampaignService;
