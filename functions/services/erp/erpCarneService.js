import mongoose from 'mongoose';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { calculateLateAmount, moneyToCents, centsToMoney } from '../crediarioEngine.js';

const TZ = 'America/Sao_Paulo';
const clean = (value = '', max = 2000) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const digits = value => String(value ?? '').replace(/\D/g, '');
const arr = value => Array.isArray(value) ? value : [];
const money = value => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const emailIsValid = value => /^\S+@\S+\.\S+$/.test(clean(value, 320).toLowerCase());
const escRx = value => String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\const money = value => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const escRx = value => String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');');
const VALID_VIAS = new Set(['primeira', 'segunda', 'atualizada']);

function fail(message, statusCode = 400, code = 'ERP_CARNE_ERROR') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function actorName(actor = {}) {
  return clean(actor.name || actor.nome || actor.fullName || actor.displayName || actor.email || 'Operador', 180);
}

function dateOnly(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

function isoDay(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const item = Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  return `${item.year}-${item.month}-${item.day}`;
}

function brl(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function normalizePhone(value = '') {
  const raw = clean(value, 80);
  let number = digits(raw).replace(/^0+/, '');
  if (!number) return '';
  if (raw.startsWith('+')) return number;
  if (raw.startsWith('00')) return digits(raw.slice(2));
  if (number.startsWith('55') && number.length >= 12) return number;
  if (number.length === 10 || number.length === 11) return `55${number}`;
  return number;
}

function phoneIsValid(value = '') {
  const raw = clean(value, 80);
  const normalized = normalizePhone(raw);
  const explicit = raw.startsWith('+') || raw.startsWith('00');
  return { normalized, valid: explicit ? normalized.length >= 8 && normalized.length <= 15 : normalized.length >= 12 && normalized.length <= 15 };
}

function paymentPrincipal(row = {}) {
  const payments = arr(row.payments);
  if (payments.length) {
    return money(payments.reduce((sum, item) => sum + Number(item.principalApplied ?? item.principal ?? item.amount ?? 0), 0));
  }
  if (Number(row.principalPaid || 0) > 0) return money(row.principalPaid);
  if (Number(row.paidValue || 0) > 0) return money(row.paidValue);
  if (Number(row.receivedAmount || 0) > 0) return money(row.receivedAmount);
  if (['paid', 'recebido', 'settled', 'paga', 'quitado'].includes(String(row.status || '').toLowerCase())) return money(row.value ?? row.amount ?? 0);
  return 0;
}

function originalValue(row = {}) {
  return Math.max(0, money(row.value ?? row.amount ?? row.originalAmount ?? 0));
}

function outstanding(row = {}) {
  return Math.max(0, money(originalValue(row) - paymentPrincipal(row)));
}

function isPaid(row = {}) {
  const status = String(row.status || '').toLowerCase();
  return ['paid', 'recebido', 'settled', 'paga', 'quitado', 'cancelled', 'cancelado', 'estornado'].includes(status) || outstanding(row) <= 0.009;
}

function installmentCalc(row = {}, calculationDate = new Date()) {
  const original = originalValue(row);
  const paid = paymentPrincipal(row);
  const open = Math.max(0, money(original - paid));
  const settled = isPaid(row);
  const calc = calculateLateAmount({
    originalAmountCents: moneyToCents(open),
    dueDate: row.dueAt || row.dueDate || row.dataVencimento,
    calculationDate,
    paid: settled
  });
  return {
    original,
    paid,
    open,
    settled,
    daysLate: calc.daysLate,
    fine: centsToMoney(calc.fineCents),
    interest: centsToMoney(calc.interestCents),
    updated: settled ? 0 : centsToMoney(calc.updatedAmountCents)
  };
}

function ascii(value = '', max = 25) {
  return clean(value, max * 2).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9 .\-]/g, '').toUpperCase().slice(0, max);
}

function tlv(id, value = '') {
  const text = String(value);
  return `${id}${String(text.length).padStart(2, '0')}${text}`;
}

function crc16(payload) {
  let crc = 0xFFFF;
  for (let i = 0; i < payload.length; i += 1) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function pixConfig() {
  const key = clean(process.env.ERP_CARNE_PIX_KEY || '', 160);
  const receiverName = ascii(process.env.ERP_CARNE_PIX_RECEIVER_NAME || 'ARIANA MOVEIS', 25);
  const receiverCity = ascii(process.env.ERP_CARNE_PIX_RECEIVER_CITY || 'GUANHAES', 15);
  return { key, receiverName, receiverCity, enabled: Boolean(key && receiverName && receiverCity) };
}

function buildPixPayload({ amount, txid = 'ARIANA' } = {}) {
  const cfg = pixConfig();
  if (!cfg.enabled || Number(amount || 0) <= 0) return '';
  const gui = tlv('00', 'BR.GOV.BCB.PIX');
  const account = tlv('26', `${gui}${tlv('01', cfg.key)}`);
  const amountField = tlv('54', Number(amount).toFixed(2));
  const additional = tlv('62', tlv('05', ascii(txid, 25) || 'ARIANA'));
  const base = `${tlv('00', '01')}${account}${tlv('52', '0000')}${tlv('53', '986')}${amountField}${tlv('58', 'BR')}${tlv('59', cfg.receiverName)}${tlv('60', cfg.receiverCity)}${additional}6304`;
  return `${base}${crc16(base)}`;
}

function evolutionConfig() {
  return {
    baseUrl: clean(process.env.ERP_CARNE_EVOLUTION_API_URL || process.env.ERP_COLLECTION_EVOLUTION_API_URL || process.env.ARIANA_EVOLUTION_API_URL || process.env.EVOLUTION_API_URL || process.env.EVOLUTION_URL, 500).replace(/\/+$/, ''),
    apiKey: clean(process.env.ERP_CARNE_EVOLUTION_API_KEY || process.env.ERP_COLLECTION_EVOLUTION_API_KEY || process.env.ARIANA_EVOLUTION_API_KEY || process.env.EVOLUTION_API_KEY || process.env.EVOLUTION_GLOBAL_API_KEY, 500),
    instance: clean(process.env.ERP_CARNE_EVOLUTION_INSTANCE || process.env.ERP_COLLECTION_MAIN_STORE_EVOLUTION_INSTANCE || process.env.ARIANA_LOJA_EVOLUTION_INSTANCE || process.env.EVOLUTION_LOJA_INSTANCE || 'ariana loja', 180),
    senderPhone: '5531985147119'
  };
}

async function parseResponse(response) {
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw }; }
  if (!response.ok) {
    const detail = clean(data?.message || data?.error || raw || `HTTP ${response.status}`, 800);
    throw fail(`WhatsApp respondeu ${response.status}: ${detail}`, 502, 'ERP_CARNE_WHATSAPP_FAILED');
  }
  return data;
}

function messageId(data = {}) {
  return clean(data?.key?.id || data?.messageId || data?.id || data?.data?.key?.id || data?.data?.messageId || data?.response?.key?.id, 220);
}

async function sendPdfWhatsApp({ phone, buffer, fileName, caption }) {
  const cfg = evolutionConfig();
  if (!cfg.baseUrl || !cfg.apiKey || !cfg.instance) throw fail('WhatsApp principal da loja não está configurado para envio do carnê.', 503, 'ERP_CARNE_WHATSAPP_NOT_CONFIGURED');
  const response = await fetch(`${cfg.baseUrl}/message/sendMedia/${encodeURIComponent(cfg.instance)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: cfg.apiKey },
    body: JSON.stringify({
      number: phone,
      mediatype: 'document',
      mimetype: 'application/pdf',
      caption,
      media: buffer.toString('base64'),
      fileName
    }),
    signal: AbortSignal.timeout(30000)
  });
  const data = await parseResponse(response);
  return { data, messageId: messageId(data), instance: cfg.instance, senderPhone: cfg.senderPhone };
}

function carneLogModel() {
  if (mongoose.models.ErpCarneLog) return mongoose.models.ErpCarneLog;
  const schema = new mongoose.Schema({
    targetId: { type: String, required: true, index: true },
    purchaseKey: { type: String, default: '', index: true },
    orderId: { type: String, default: '', index: true },
    reference: { type: String, default: '', index: true },
    clientName: { type: String, default: '', index: true },
    clientDocument: { type: String, default: '', index: true },
    clientPhone: { type: String, default: '' },
    via: { type: String, default: 'atualizada', index: true },
    action: { type: String, enum: ['GENERATED', 'SENT'], required: true, index: true },
    installments: { type: Number, default: 0 },
    overdueCount: { type: Number, default: 0 },
    openOriginal: { type: Number, default: 0 },
    fine: { type: Number, default: 0 },
    interest: { type: Number, default: 0 },
    updatedOpen: { type: Number, default: 0 },
    pixEnabled: { type: Boolean, default: false },
    senderPhone: { type: String, default: '' },
    evolutionInstance: { type: String, default: '' },
    providerMessageId: { type: String, default: '' },
    operator: { type: String, default: '' },
    generatedAt: { type: Date, default: Date.now },
    sentAt: { type: Date, default: null }
  }, { timestamps: true, collection: 'erp_carne_logs' });
  schema.index({ purchaseKey: 1, createdAt: -1 });
  return mongoose.model('ErpCarneLog', schema);
}

function viaLabel(via) {
  if (via === 'primeira') return '1ª VIA';
  if (via === 'segunda') return '2ª VIA';
  return 'ATUALIZADO';
}

function normalizeVia(value = '') {
  const via = clean(value, 30).toLowerCase();
  return VALID_VIAS.has(via) ? via : 'atualizada';
}

function safeFile(value = '') {
  return clean(value, 120).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'compra';
}

function totalize(items = []) {
  return {
    original: money(items.reduce((sum, row) => sum + row.original, 0)),
    paid: money(items.reduce((sum, row) => sum + row.paid, 0)),
    openOriginal: money(items.reduce((sum, row) => sum + (row.settled ? 0 : row.open), 0)),
    fine: money(items.reduce((sum, row) => sum + row.fine, 0)),
    interest: money(items.reduce((sum, row) => sum + row.interest, 0)),
    updatedOpen: money(items.reduce((sum, row) => sum + row.updated, 0)),
    overdueCount: items.filter(row => !row.settled && row.daysLate > 0).length,
    paidCount: items.filter(row => row.settled).length,
    openCount: items.filter(row => !row.settled).length
  };
}

export function createErpCarneService(context = {}) {
  const { Order, User } = context;
  if (!Order) throw new Error('[erp-carne] Order não informado');
  const Log = carneLogModel();

  async function currentCustomer(base = {}) {
    const Person = mongoose.models.ErpPerson;
    let person = null;
    const doc = digits(base.document);
    const email = clean(base.email, 320).toLowerCase();
    const name = clean(base.name, 220);
    if (Person && doc) person = await Person.findOne({ document: doc, active: { $ne: false } }).sort({ updatedAt: -1 }).lean();
    if (Person && !person && email) person = await Person.findOne({ email, active: { $ne: false } }).sort({ updatedAt: -1 }).lean();
    if (Person && !person && name) {
      const rx = new RegExp(`^${escRx(name)}$`, 'i');
      person = await Person.findOne({ $or: [{ name: rx }, { companyName: rx }], active: { $ne: false } }).sort({ updatedAt: -1 }).lean();
    }
    let user = null;
    if (!person && User) {
      const query = doc ? { cpf: doc, isActive: { $ne: false } } : (email ? { email, isActive: { $ne: false } } : null);
      if (query) user = await User.findOne(query).select('name email phone cpf city uf address').lean();
    }
    const address = person?.address || user?.address || base.address || {};
    return {
      name: clean(person?.name || person?.companyName || user?.name || base.name, 220),
      document: clean(person?.document || user?.cpf || base.document, 60),
      email: [base.email, person?.email, user?.email].map(value => clean(value, 320).toLowerCase()).find(emailIsValid) || clean(base.email || person?.email || user?.email, 320).toLowerCase(),
      phone: clean(person?.phone || user?.phone || base.phone, 80),
      address
    };
  }

  function buildItems(rows = [], reference = '') {
    const calculationDate = new Date();
    return rows.map((row, index) => {
      const calc = installmentCalc(row, calculationDate);
      return {
        number: Number(row.installmentNumber || row.parcelNumber || row.number || index + 1),
        totalInstallments: Number(row.installments || rows.length || 1),
        dueAt: row.dueAt || row.dueDate || null,
        status: calc.settled ? 'PAGA' : (calc.daysLate > 0 ? 'VENCIDA' : (calc.paid > 0 ? 'PARCIAL' : 'ABERTA')),
        reference,
        ...calc
      };
    }).sort((a, b) => a.number - b.number || new Date(a.dueAt || 0) - new Date(b.dueAt || 0));
  }

  async function financialContext(entryId) {
    const Entry = mongoose.models.ErpFinancialEntry;
    if (!Entry) throw fail('Livro financeiro do Ariana ERP não está disponível.', 503, 'ERP_LEDGER_UNAVAILABLE');
    if (!mongoose.isValidObjectId(entryId)) throw fail('Parcela financeira inválida.', 404, 'ERP_CARNE_TARGET_NOT_FOUND');
    const selected = await Entry.collection.findOne({ _id: new mongoose.Types.ObjectId(entryId) });
    if (!selected || selected.direction !== 'receivable') throw fail('Parcela financeira não encontrada.', 404, 'ERP_CARNE_TARGET_NOT_FOUND');
    const query = { direction: 'receivable', status: { $ne: 'cancelled' } };
    const sourceSaleId = clean(selected?.migration?.sourceSaleId, 180);
    let purchaseKey = '';
    if (clean(selected.orderId, 120)) {
      query.orderId = clean(selected.orderId, 120);
      purchaseKey = `order:${query.orderId}`;
    } else if (sourceSaleId) {
      query['migration.sourceSaleId'] = sourceSaleId;
      purchaseKey = `sige:${sourceSaleId}`;
    } else if (clean(selected.documentNumber, 120)) {
      query.documentNumber = clean(selected.documentNumber, 120);
      if (clean(selected.personDocument, 60)) query.personDocument = clean(selected.personDocument, 60);
      purchaseKey = `document:${query.documentNumber}:${clean(selected.personDocument, 60)}`;
    } else {
      query._id = selected._id;
      purchaseKey = `entry:${String(selected._id)}`;
    }
    const rows = await Entry.collection.find(query).sort({ dueAt: 1, installmentNumber: 1, createdAt: 1 }).toArray();
    const reference = sourceSaleId ? `Histórico SIGE • venda ref. ${sourceSaleId}` : clean(selected.documentNumber || selected.description || String(selected._id), 180);
    const contact = await currentCustomer({ name: selected.personName, document: selected.personDocument, email: selected.email || selected.personEmail, phone: selected.phone || selected.personPhone });
    const items = buildItems(rows.length ? rows : [selected], reference);
    return {
      targetId: `entry:${entryId}`,
      purchaseKey,
      orderId: clean(selected.orderId, 120),
      reference,
      description: clean(selected.description || reference, 500),
      contact,
      items,
      source: sourceSaleId ? 'historico_sige' : 'financeiro_erp'
    };
  }

  async function orderContext(orderId) {
    if (!mongoose.isValidObjectId(orderId)) throw fail('Venda do Ariana ERP inválida.', 404, 'ERP_CARNE_TARGET_NOT_FOUND');
    const order = await Order.findById(orderId).lean();
    if (!order || order.origin !== 'erp_ariana') throw fail('Venda do Ariana ERP não encontrada.', 404, 'ERP_CARNE_TARGET_NOT_FOUND');
    const erp = order.televendas?.erp || {};
    const receivables = arr(erp.receivables);
    if (!receivables.length) throw fail('Esta compra não possui parcelas de crediário para gerar carnê.', 409, 'ERP_CARNE_NO_INSTALLMENTS');
    const reference = clean(erp.code || order.orderCode || order.code || String(order._id).slice(-8).toUpperCase(), 180);
    const contact = await currentCustomer({ name: order.customerName, document: order.customerCpf, email: order.customerEmail, phone: order.customerPhone, address: order.shippingAddress || order.address });
    const itemDescription = arr(order.items).map(item => `${Number(item.qty || 1)}x ${clean(item.name || item.title || 'Produto', 160)}`).join(' • ');
    const items = buildItems(receivables, reference);
    return {
      targetId: `order:${orderId}`,
      purchaseKey: `order:${orderId}`,
      orderId: String(order._id),
      reference,
      description: clean(itemDescription || `Venda Ariana ERP ${reference}`, 800),
      contact,
      items,
      source: 'ariana_erp'
    };
  }

  async function contextFor(targetId) {
    const id = clean(targetId, 300);
    if (id.startsWith('entry:')) return financialContext(id.slice(6));
    if (id.startsWith('order:')) return orderContext(id.split(':')[1]);
    throw fail('Compra inválida para geração de carnê.', 404, 'ERP_CARNE_TARGET_NOT_FOUND');
  }

  async function enriched(targetId, via = 'atualizada') {
    const ctx = await contextFor(targetId);
    const normalizedVia = normalizeVia(via);
    const totals = totalize(ctx.items);
    const previous = await Log.countDocuments({ purchaseKey: ctx.purchaseKey, action: { $in: ['GENERATED', 'SENT'] } });
    const suggestedVia = totals.overdueCount > 0 ? 'atualizada' : (previous > 0 ? 'segunda' : 'primeira');
    return {
      ...ctx,
      via: normalizedVia,
      viaLabel: viaLabel(normalizedVia),
      totals,
      generatedAt: new Date(),
      previousIssues: previous,
      suggestedVia,
      pix: { enabled: pixConfig().enabled, mode: pixConfig().enabled ? 'chave_empresa_estatica' : 'desativado_sem_chave_configurada' },
      latePolicy: { finePercent: 2, interestMonthlyPercent: 1, proRataDaily: true }
    };
  }

  async function qrFor(item, ctx) {
    if (item.settled || item.updated <= 0) return null;
    const txid = `AR${digits(ctx.reference).slice(-10)}P${item.number}`.slice(0, 25) || `ARIANAP${item.number}`;
    const payload = buildPixPayload({ amount: item.updated, txid });
    if (!payload) return null;
    const buffer = await QRCode.toBuffer(payload, { type: 'png', width: 116, margin: 0, errorCorrectionLevel: 'M' });
    return { payload, buffer };
  }

  async function renderPdf(data) {
    const doc = new PDFDocument({ size: 'A4', margin: 24, info: { Title: `Carnê Ariana Móveis - ${data.reference}`, Author: 'Ariana Móveis / Ariana ERP' } });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    const done = new Promise((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const margin = 24;
    const gap = 8;
    const stripsPerPage = 3;
    const stripX = margin;
    const stripW = pageW - margin * 2;
    const stripH = Math.floor((pageH - (margin * 2) - (gap * (stripsPerPage - 1))) / stripsPerPage);
    const stubW = 128;
    let y = margin;

    async function drawStrip(item) {
      if (y + stripH > doc.page.height - margin) { doc.addPage(); y = margin; }
      doc.save().lineWidth(0.8).strokeColor('#9aa7b8').rect(stripX, y, stripW, stripH).stroke().restore();
      doc.save().dash(4, { space: 3 }).strokeColor('#8b98a9').moveTo(stripX + stubW, y).lineTo(stripX + stubW, y + stripH).stroke().undash().restore();

      doc.fillColor('#0646a5').font('Helvetica-Bold').fontSize(11).text('ARIANA MÓVEIS', stripX + 8, y + 9, { width: stubW - 16 });
      doc.fillColor('#172033').font('Helvetica-Bold').fontSize(9).text(`PARCELA ${item.number}/${item.totalInstallments}`, stripX + 8, y + 31, { width: stubW - 16 });
      doc.font('Helvetica').fontSize(8).text(`Venc.: ${dateOnly(item.dueAt)}`, stripX + 8, y + 48, { width: stubW - 16 });
      doc.text(`Status: ${item.status}`, stripX + 8, y + 62, { width: stubW - 16 });
      doc.font('Helvetica-Bold').fontSize(10).text(item.settled ? 'QUITADA' : brl(item.updated), stripX + 8, y + 83, { width: stubW - 16 });
      if (!item.settled && item.daysLate > 0) {
        doc.fillColor('#a12531').font('Helvetica').fontSize(7.5).text(`${item.daysLate} dia(s) em atraso\nMulta: ${brl(item.fine)}\nJuros: ${brl(item.interest)}`, stripX + 8, y + 103, { width: stubW - 16, lineGap: 1 });
      }
      doc.fillColor('#69758a').fontSize(7).text('Rubrica / caixa', stripX + 8, y + stripH - 21, { width: stubW - 16, align: 'center' });
      doc.moveTo(stripX + 12, y + stripH - 26).lineTo(stripX + stubW - 12, y + stripH - 26).strokeColor('#c3ccd8').stroke();

      const rightX = stripX + stubW + 12;
      const rightW = stripW - stubW - 24;
      doc.fillColor('#0646a5').font('Helvetica-Bold').fontSize(14).text('ARIANA MÓVEIS', rightX, y + 10, { width: 210 });
      doc.fillColor('#69758a').font('Helvetica').fontSize(7.5).text('Guanhães - MG • WhatsApp (31) 98514-7119', rightX, y + 28, { width: 245 });
      doc.fillColor('#172033').font('Helvetica-Bold').fontSize(8.5).text(`${data.viaLabel} • Compra ${data.reference}`, rightX, y + 43, { width: rightW - 10 });
      doc.font('Helvetica').fontSize(8).text(`Cliente: ${data.contact.name || 'Consumidor'}`, rightX, y + 58, { width: rightW - 10 });
      if (data.contact.document) doc.text(`CPF/CNPJ: ${data.contact.document}`, rightX, y + 71, { width: 250 });
      doc.fillColor('#4f5f74').fontSize(7.5).text(`Compra: ${data.description || data.reference}`, rightX, y + 85, { width: Math.max(220, rightW - 145), height: 28, ellipsis: true });

      const valueX = stripX + stripW - 137;
      doc.fillColor('#172033').font('Helvetica-Bold').fontSize(7.5).text('VENCIMENTO', valueX, y + 11, { width: 125, align: 'center' });
      doc.fontSize(11).text(dateOnly(item.dueAt), valueX, y + 23, { width: 125, align: 'center' });
      doc.strokeColor('#d3dae4').rect(valueX, y + 8, 125, 36).stroke();
      doc.fontSize(7.5).text(item.settled ? 'PARCELA PAGA' : (item.daysLate > 0 ? 'VALOR ATUALIZADO' : 'VALOR A PAGAR'), valueX, y + 52, { width: 125, align: 'center' });
      doc.fontSize(14).text(item.settled ? 'QUITADA' : brl(item.updated), valueX, y + 65, { width: 125, align: 'center' });
      doc.strokeColor('#d3dae4').rect(valueX, y + 49, 125, 40).stroke();

      if (!item.settled && item.daysLate > 0) {
        doc.fillColor('#a12531').font('Helvetica').fontSize(7.2).text(`Original em aberto: ${brl(item.open)} • Multa 2%: ${brl(item.fine)} • Juros 1% a.m. pró-rata: ${brl(item.interest)}`, rightX, y + 119, { width: rightW - 10 });
      } else if (!item.settled) {
        doc.fillColor('#536176').font('Helvetica').fontSize(7.2).text(`Saldo desta parcela: ${brl(item.open)}.`, rightX, y + 119, { width: rightW - 10 });
      }

      const qr = await qrFor(item, data).catch(() => null);
      if (qr) {
        doc.image(qr.buffer, valueX + 37, y + 96, { width: 56, height: 56 });
        doc.fillColor('#172033').font('Helvetica-Bold').fontSize(6.8).text('PIX DA EMPRESA', valueX, y + 153, { width: 125, align: 'center' });
      } else if (!item.settled) {
        doc.fillColor('#69758a').font('Helvetica-Bold').fontSize(7).text('PAGAMENTO NA LOJA', valueX, y + 122, { width: 125, align: 'center' });
      }

      doc.fillColor('#69758a').font('Helvetica').fontSize(6.5).text('Após o vencimento: multa de 2% e juros de mora de 1% ao mês, calculados pró-rata por dia pelo Ariana ERP. O valor desta via é calculado na data da emissão.', rightX, y + 157, { width: rightW - 150, lineGap: 1 });
      y += stripH + gap;
    }

    for (const item of data.items) await drawStrip(item);
    doc.end();
    return done;
  }

  async function preview(targetId, via = '') {
    const data = await enriched(targetId, via || 'atualizada');
    return {
      targetId: data.targetId,
      purchaseKey: data.purchaseKey,
      orderId: data.orderId,
      reference: data.reference,
      description: data.description,
      source: data.source,
      contact: data.contact,
      via: data.via,
      viaLabel: data.viaLabel,
      suggestedVia: data.suggestedVia,
      previousIssues: data.previousIssues,
      items: data.items,
      totals: data.totals,
      pix: data.pix,
      latePolicy: data.latePolicy
    };
  }

  async function pdf(targetId, via = '', actor = {}) {
    const data = await enriched(targetId, via || 'atualizada');
    const buffer = await renderPdf(data);
    const fileName = `Carne_Ariana_${safeFile(data.reference)}_${data.via}.pdf`;
    await Log.create({
      targetId: data.targetId,
      purchaseKey: data.purchaseKey,
      orderId: data.orderId,
      reference: data.reference,
      clientName: data.contact.name,
      clientDocument: data.contact.document,
      clientPhone: data.contact.phone,
      via: data.via,
      action: 'GENERATED',
      installments: data.items.length,
      overdueCount: data.totals.overdueCount,
      openOriginal: data.totals.openOriginal,
      fine: data.totals.fine,
      interest: data.totals.interest,
      updatedOpen: data.totals.updatedOpen,
      pixEnabled: data.pix.enabled,
      operator: actorName(actor),
      generatedAt: new Date()
    });
    return { buffer, fileName, data };
  }

  async function send(targetId, payload = {}, actor = {}) {
    const data = await enriched(targetId, payload.via || 'atualizada');
    const phoneInfo = phoneIsValid(data.contact.phone);
    if (!phoneInfo.valid) throw fail('O cliente não possui um WhatsApp válido no cadastro atual do Ariana ERP.', 409, 'ERP_CARNE_CUSTOMER_PHONE_INVALID');
    const buffer = await renderPdf(data);
    const fileName = `Carne_Ariana_${safeFile(data.reference)}_${data.via}.pdf`;
    const caption = `Olá, ${data.contact.name || 'cliente'}. Segue o carnê ${data.viaLabel.toLowerCase()} da compra ${data.reference} na Ariana Móveis. Valor total em aberto atualizado nesta emissão: ${brl(data.totals.updatedOpen)}.`;
    const sent = await sendPdfWhatsApp({ phone: phoneInfo.normalized, buffer, fileName, caption });
    const now = new Date();
    const log = await Log.create({
      targetId: data.targetId,
      purchaseKey: data.purchaseKey,
      orderId: data.orderId,
      reference: data.reference,
      clientName: data.contact.name,
      clientDocument: data.contact.document,
      clientPhone: phoneInfo.normalized,
      via: data.via,
      action: 'SENT',
      installments: data.items.length,
      overdueCount: data.totals.overdueCount,
      openOriginal: data.totals.openOriginal,
      fine: data.totals.fine,
      interest: data.totals.interest,
      updatedOpen: data.totals.updatedOpen,
      pixEnabled: data.pix.enabled,
      senderPhone: sent.senderPhone,
      evolutionInstance: sent.instance,
      providerMessageId: sent.messageId,
      operator: actorName(actor),
      generatedAt: now,
      sentAt: now
    });
    return {
      status: 'SENT',
      sentAt: now,
      messageId: sent.messageId,
      fileName,
      sender: { phone: sent.senderPhone, instance: sent.instance },
      contact: data.contact,
      totals: data.totals,
      via: data.via,
      logId: String(log._id)
    };
  }

  return { preview, pdf, send };
}

export default createErpCarneService;
