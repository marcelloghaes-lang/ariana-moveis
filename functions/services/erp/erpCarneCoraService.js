import mongoose from 'mongoose';
import { createErpCarneService } from './erpCarneService.js';
import { getCoraChargeModel } from '../../integrations/cora/coraChargeModel.js';

const clean = (value = '', max = 2000) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const arr = value => Array.isArray(value) ? value : [];
const money = value => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

function fail(message, statusCode = 500, code = 'ERP_CARNE_CORA_ERROR') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function actorName(actor = {}) {
  return clean(actor.name || actor.nome || actor.fullName || actor.displayName || actor.email || 'Operador', 180);
}

function safeFile(value = '') {
  return clean(value, 120)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'compra';
}

function brl(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function normalizePhone(value = '') {
  const raw = clean(value, 80);
  let number = raw.replace(/\D/g, '').replace(/^0+/, '');
  if (!number) return '';
  if (raw.startsWith('+')) return number;
  if (raw.startsWith('00')) return raw.slice(2).replace(/\D/g, '');
  if (number.startsWith('55') && number.length >= 12) return number;
  if (number.length === 10 || number.length === 11) return `55${number}`;
  return number;
}

function phoneIsValid(value = '') {
  const raw = clean(value, 80);
  const normalized = normalizePhone(raw);
  const explicit = raw.startsWith('+') || raw.startsWith('00');
  return {
    normalized,
    valid: explicit
      ? normalized.length >= 8 && normalized.length <= 15
      : normalized.length >= 12 && normalized.length <= 15
  };
}

function evolutionConfig() {
  return {
    baseUrl: clean(
      process.env.ERP_CARNE_EVOLUTION_API_URL ||
      process.env.ERP_COLLECTION_EVOLUTION_API_URL ||
      process.env.ARIANA_EVOLUTION_API_URL ||
      process.env.EVOLUTION_API_URL ||
      process.env.EVOLUTION_URL,
      500
    ).replace(/\/+$/, ''),
    apiKey: clean(
      process.env.ERP_CARNE_EVOLUTION_API_KEY ||
      process.env.ERP_COLLECTION_EVOLUTION_API_KEY ||
      process.env.ARIANA_EVOLUTION_API_KEY ||
      process.env.EVOLUTION_API_KEY ||
      process.env.EVOLUTION_GLOBAL_API_KEY,
      500
    ),
    instance: clean(
      process.env.ERP_CARNE_EVOLUTION_INSTANCE ||
      process.env.ERP_COLLECTION_MAIN_STORE_EVOLUTION_INSTANCE ||
      process.env.ARIANA_LOJA_EVOLUTION_INSTANCE ||
      process.env.EVOLUTION_LOJA_INSTANCE ||
      'ariana loja',
      180
    ),
    senderPhone: '5531985147119'
  };
}

async function parseJsonResponse(response) {
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw }; }
  if (!response.ok) {
    const detail = clean(data?.message || data?.error || raw || `HTTP ${response.status}`, 800);
    throw fail(`WhatsApp respondeu ${response.status}: ${detail}`, 502, 'ERP_CARNE_WHATSAPP_FAILED');
  }
  return data;
}

function providerMessageId(data = {}) {
  return clean(
    data?.key?.id ||
    data?.messageId ||
    data?.id ||
    data?.data?.key?.id ||
    data?.data?.messageId ||
    data?.response?.key?.id,
    220
  );
}

async function sendPdfWhatsApp({ phone, buffer, fileName, caption }) {
  const cfg = evolutionConfig();
  if (!cfg.baseUrl || !cfg.apiKey || !cfg.instance) {
    throw fail('WhatsApp principal da loja não está configurado para envio do carnê.', 503, 'ERP_CARNE_WHATSAPP_NOT_CONFIGURED');
  }
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
  const data = await parseJsonResponse(response);
  return {
    messageId: providerMessageId(data),
    instance: cfg.instance,
    senderPhone: cfg.senderPhone
  };
}

function normalizeInvoice(invoice = {}, index = 0) {
  const pixEmv = clean(invoice?.pix?.emv || invoice?.pix?.copy_paste || invoice?.pix?.copyPaste || '', 6000);
  const bankSlip = invoice?.bank_slip || invoice?.bankSlip || invoice?.payment_options?.bank_slip || {};
  const status = clean(invoice?.status || '', 40).toUpperCase();
  return {
    number: index + 1,
    id: clean(invoice?.id || invoice?.invoice_id || invoice?.invoiceId || '', 220),
    status,
    amountCents: Number(invoice?.amount_total ?? invoice?.total_amount ?? invoice?.amount ?? 0),
    documentUrl: clean(invoice?.document_url || invoice?.documentUrl || bankSlip?.url || '', 1200),
    pix: {
      available: Boolean(pixEmv),
      emv: pixEmv
    },
    bankSlip: {
      barcode: clean(bankSlip?.barcode || '', 220),
      digitable: clean(bankSlip?.digitable || bankSlip?.digitable_line || '', 260),
      ourNumber: clean(bankSlip?.our_number || bankSlip?.ourNumber || '', 120),
      url: clean(bankSlip?.url || '', 1200)
    },
    payments: arr(invoice?.payments).map(payment => ({
      id: clean(payment?.id || '', 220),
      status: clean(payment?.status || '', 50),
      method: clean(payment?.method || '', 50),
      totalPaidCents: Number(payment?.total_paid ?? payment?.totalPaid ?? 0),
      finalizedAt: payment?.finalized_at || payment?.finalizedAt || null
    }))
  };
}

function isChargeUsable(charge = {}) {
  const status = clean(charge?.status || '', 40).toUpperCase();
  return !['FAILED', 'CANCELLED', 'CANCELED'].includes(status);
}

async function fetchCoraPdf(url) {
  const target = clean(url, 1600);
  if (!/^https:\/\//i.test(target)) throw fail('A cobrança Cora não possui um PDF seguro disponível.', 409, 'ERP_CARNE_CORA_DOCUMENT_UNAVAILABLE');
  const response = await fetch(target, { signal: AbortSignal.timeout(30000), redirect: 'follow' });
  if (!response.ok) throw fail(`A Cora respondeu ${response.status} ao baixar o carnê.`, 502, 'ERP_CARNE_CORA_DOCUMENT_FAILED');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw fail('A Cora retornou um documento vazio.', 502, 'ERP_CARNE_CORA_DOCUMENT_EMPTY');
  if (buffer.length > 20 * 1024 * 1024) throw fail('O PDF da Cora excede o limite de 20 MB.', 502, 'ERP_CARNE_CORA_DOCUMENT_TOO_LARGE');
  return buffer;
}

export function createErpCarneCoraService(context = {}) {
  const base = createErpCarneService(context);
  const CoraCharge = getCoraChargeModel(mongoose);
  const Log = mongoose.models.ErpCarneLog;

  async function findLinkedCharge(data = {}) {
    const clauses = [];
    if (clean(data.orderId, 160)) clauses.push({ orderId: clean(data.orderId, 160) });
    if (clean(data.reference, 180)) {
      const reference = clean(data.reference, 180);
      clauses.push({ internalReference: reference }, { code: reference });
    }
    if (!clauses.length) return null;
    const charge = await CoraCharge.findOne({
      kind: 'INSTALLMENT_BOOK',
      $or: clauses
    }).sort({ createdAt: -1 }).lean();
    return charge && isChargeUsable(charge) ? charge : null;
  }

  function providerView(charge = null) {
    if (!charge) {
      return {
        provider: 'cora',
        linked: false,
        status: 'NOT_LINKED',
        chargeId: '',
        code: '',
        documentUrl: '',
        invoices: [],
        pixAvailable: false
      };
    }
    const invoices = arr(charge.invoices).map(normalizeInvoice);
    return {
      provider: 'cora',
      linked: true,
      status: clean(charge.status || 'OPEN', 40).toUpperCase(),
      chargeId: String(charge._id || ''),
      code: clean(charge.code || '', 180),
      internalReference: clean(charge.internalReference || '', 180),
      documentUrl: clean(charge.documentUrl || '', 1200),
      environment: clean(charge.environment || '', 40),
      invoices,
      pixAvailable: invoices.some(item => item.pix.available),
      updatedAt: charge.updatedAt || null
    };
  }

  function mergeProvider(baseData, provider) {
    const byNumber = new Map(provider.invoices.map(item => [item.number, item]));
    const items = arr(baseData.items).map(item => ({
      ...item,
      cora: byNumber.get(Number(item.number)) || null
    }));
    return {
      ...baseData,
      items,
      paymentProvider: provider,
      cora: provider,
      pix: {
        enabled: Boolean(provider.linked && provider.pixAvailable),
        mode: provider.linked ? 'cora_invoice' : 'sem_cobranca_cora_vinculada',
        provider: 'cora',
        chargeId: provider.chargeId || ''
      }
    };
  }

  async function preview(targetId, via = '') {
    const baseData = await base.preview(targetId, via);
    const charge = await findLinkedCharge(baseData);
    return mergeProvider(baseData, providerView(charge));
  }

  async function logProviderDocument(data, action, extra = {}) {
    if (!Log) return null;
    const now = new Date();
    return Log.create({
      targetId: data.targetId,
      purchaseKey: data.purchaseKey,
      orderId: data.orderId,
      reference: data.reference,
      clientName: data.contact?.name,
      clientDocument: data.contact?.document,
      clientPhone: extra.clientPhone || data.contact?.phone,
      via: data.via,
      action,
      installments: arr(data.items).length,
      overdueCount: Number(data.totals?.overdueCount || 0),
      openOriginal: money(data.totals?.openOriginal),
      fine: money(data.totals?.fine),
      interest: money(data.totals?.interest),
      updatedOpen: money(data.totals?.updatedOpen),
      pixEnabled: Boolean(data.pix?.enabled),
      senderPhone: extra.senderPhone || '',
      evolutionInstance: extra.evolutionInstance || '',
      providerMessageId: extra.providerMessageId || '',
      operator: actorName(extra.actor || {}),
      generatedAt: now,
      sentAt: action === 'SENT' ? now : null
    });
  }

  async function pdf(targetId, via = '', actor = {}) {
    const data = await preview(targetId, via || 'atualizada');
    const provider = data.paymentProvider || {};
    if (provider.linked && provider.documentUrl) {
      const buffer = await fetchCoraPdf(provider.documentUrl);
      const fileName = `Carne_Cora_Ariana_${safeFile(data.reference)}_${data.via}.pdf`;
      await logProviderDocument(data, 'GENERATED', { actor });
      return { buffer, fileName, data, provider: 'cora', chargeId: provider.chargeId };
    }
    return base.pdf(targetId, via, actor);
  }

  async function send(targetId, payload = {}, actor = {}) {
    const data = await preview(targetId, payload.via || 'atualizada');
    const provider = data.paymentProvider || {};
    if (!(provider.linked && provider.documentUrl)) return base.send(targetId, payload, actor);

    const phoneInfo = phoneIsValid(data.contact?.phone || '');
    if (!phoneInfo.valid) {
      throw fail('O cliente não possui um WhatsApp válido no cadastro atual do Ariana ERP.', 409, 'ERP_CARNE_CUSTOMER_PHONE_INVALID');
    }

    const buffer = await fetchCoraPdf(provider.documentUrl);
    const fileName = `Carne_Cora_Ariana_${safeFile(data.reference)}_${data.via}.pdf`;
    const caption = `Olá, ${data.contact?.name || 'cliente'}. Segue o carnê ${String(data.viaLabel || '').toLowerCase()} da compra ${data.reference} na Ariana Móveis. A cobrança está vinculada à Cora. Valor total em aberto atualizado no Ariana ERP: ${brl(data.totals?.updatedOpen)}.`;
    const sent = await sendPdfWhatsApp({
      phone: phoneInfo.normalized,
      buffer,
      fileName,
      caption
    });
    const log = await logProviderDocument(data, 'SENT', {
      actor,
      clientPhone: phoneInfo.normalized,
      senderPhone: sent.senderPhone,
      evolutionInstance: sent.instance,
      providerMessageId: sent.messageId
    });
    return {
      status: 'SENT',
      sentAt: new Date(),
      messageId: sent.messageId,
      fileName,
      sender: { phone: sent.senderPhone, instance: sent.instance },
      contact: data.contact,
      totals: data.totals,
      via: data.via,
      provider: 'cora',
      chargeId: provider.chargeId,
      logId: log ? String(log._id) : ''
    };
  }

  return { preview, pdf, send };
}

export default createErpCarneCoraService;
