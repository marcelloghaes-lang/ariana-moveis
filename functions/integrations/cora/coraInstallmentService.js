import crypto from 'crypto';
import { coraRequest } from './coraClient.js';

function digits(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function clean(value = '', max = 200) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function toCents(value) {
  if (Number.isInteger(value) && value > 1000) return value;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.round((number + Number.EPSILON) * 100);
}

function isoDate(value) {
  const raw = clean(value, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  const date = new Date(`${raw}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? '' : raw;
}

function futureOrToday(value) {
  const date = isoDate(value);
  if (!date) return false;
  const today = new Date();
  const todayIso = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())).toISOString().slice(0, 10);
  return date >= todayIso;
}

function normalizeDocument(document = '') {
  const identity = digits(document);
  if (![11, 14].includes(identity.length)) {
    const error = new Error('CPF/CNPJ do cliente inválido. Informe 11 ou 14 números.');
    error.code = 'CORA_INVALID_CUSTOMER_DOCUMENT';
    error.statusCode = 400;
    throw error;
  }
  return { identity, type: identity.length === 11 ? 'CPF' : 'CNPJ' };
}

function normalizeAddress(input = {}) {
  const address = {
    street: clean(input.street || input.logradouro, 120),
    number: clean(input.number || input.numero || 'S/N', 20),
    district: clean(input.district || input.bairro, 80),
    city: clean(input.city || input.cidade, 80),
    state: clean(input.state || input.uf, 2).toUpperCase(),
    complement: clean(input.complement || input.complemento || '', 80),
    country: clean(input.country || input.pais || 'BR', 2).toUpperCase(),
    zip_code: digits(input.zip_code || input.zipCode || input.cep).slice(0, 8)
  };

  const missing = Object.entries(address)
    .filter(([key, value]) => !value && !['complement'].includes(key))
    .map(([key]) => key);

  if (missing.length || !/^[A-Z]{2}$/.test(address.state) || address.zip_code.length !== 8) {
    const error = new Error('Endereço do cliente incompleto ou inválido para emissão do carnê.');
    error.code = 'CORA_INVALID_CUSTOMER_ADDRESS';
    error.statusCode = 400;
    error.details = { missing, state: address.state, zipCodeLength: address.zip_code.length };
    throw error;
  }
  return address;
}

function normalizePaymentTerms(input = {}) {
  const out = {};
  const interest = Number(input.interest_monthly_percent ?? input.interestMonthlyPercent ?? process.env.CORA_INTEREST_MONTHLY_PERCENT ?? 0);
  const finePercent = Number(input.fine_percent ?? input.finePercent ?? process.env.CORA_FINE_PERCENT ?? 0);
  const fineValue = toCents(input.fine_value ?? input.fineValue ?? 0);
  const discountPercent = Number(input.discount_percent ?? input.discountPercent ?? 0);
  const discountValue = toCents(input.discount_value ?? input.discountValue ?? 0);

  if (Number.isFinite(interest) && interest > 0) out.interest_monthly_percent = Math.min(100, interest);
  if (fineValue > 0) out.fine_value = fineValue;
  else if (Number.isFinite(finePercent) && finePercent > 0) out.fine_percent = Math.min(100, finePercent);
  if (discountValue > 0) out.discount_value = discountValue;
  else if (Number.isFinite(discountPercent) && discountPercent > 0) out.discount_percent = Math.min(100, discountPercent);

  return Object.keys(out).length ? out : undefined;
}

function normalizeDueDate({ dueDates, firstDueDate, dayOfMonth, installments }) {
  const dates = Array.isArray(dueDates) ? dueDates.map(isoDate).filter(Boolean) : [];
  if (dates.length) {
    if (dates.length !== installments || !dates.every(futureOrToday)) {
      const error = new Error('A lista de vencimentos deve conter uma data válida para cada parcela.');
      error.code = 'CORA_INVALID_DUE_DATES';
      error.statusCode = 400;
      error.details = { expected: installments, received: dates.length };
      throw error;
    }
    return { dates };
  }

  const first = isoDate(firstDueDate);
  if (first) {
    if (!futureOrToday(first)) {
      const error = new Error('O primeiro vencimento não pode ser anterior à data atual.');
      error.code = 'CORA_INVALID_FIRST_DUE_DATE';
      error.statusCode = 400;
      throw error;
    }
    const base = new Date(`${first}T12:00:00Z`);
    const generated = [];
    for (let index = 0; index < installments; index += 1) {
      const target = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + index, 1, 12));
      const desiredDay = base.getUTCDate();
      const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12)).getUTCDate();
      target.setUTCDate(Math.min(desiredDay, lastDay));
      generated.push(target.toISOString().slice(0, 10));
    }
    return { dates: generated };
  }

  const day = Number(dayOfMonth);
  if (Number.isInteger(day) && day >= 1 && day <= 31) return { day_of_month: day };

  const error = new Error('Informe firstDueDate, dueDates ou dayOfMonth para o carnê.');
  error.code = 'CORA_DUE_DATE_REQUIRED';
  error.statusCode = 400;
  throw error;
}

export function buildCoraInstallmentPayload(input = {}) {
  const installments = Number(input.installments || input.numberOf || input.number_of || 0);
  if (!Number.isInteger(installments) || installments < 2 || installments > 24) {
    const error = new Error('O carnê deve ter entre 2 e 24 parcelas.');
    error.code = 'CORA_INVALID_INSTALLMENTS';
    error.statusCode = 400;
    throw error;
  }

  const totalAmount = toCents(input.totalAmount ?? input.amount ?? input.total);
  if (totalAmount < 500 * installments) {
    const error = new Error('O valor total é inválido ou resulta em parcela inferior a R$ 5,00.');
    error.code = 'CORA_INVALID_AMOUNT';
    error.statusCode = 400;
    throw error;
  }

  const customerInput = input.customer || {};
  const customerName = clean(customerInput.name || input.customerName, 60);
  const customerEmail = clean(customerInput.email || input.customerEmail, 60).toLowerCase();
  if (!customerName || !customerEmail || !/^\S+@\S+\.\S+$/.test(customerEmail)) {
    const error = new Error('Nome e e-mail válidos do cliente são obrigatórios para o carnê.');
    error.code = 'CORA_INVALID_CUSTOMER';
    error.statusCode = 400;
    throw error;
  }

  const document = normalizeDocument(customerInput.document?.identity || customerInput.document || input.customerDocument);
  const address = normalizeAddress(customerInput.address || input.customerAddress || {});
  const serviceName = clean(input.service?.name || input.serviceName || 'Compra Ariana Móveis', 60);
  const serviceDescription = clean(input.service?.description || input.description || 'Carnê de pagamentos da venda', 100);

  const payload = {
    code: clean(input.code || input.orderId || `ariana_${crypto.randomUUID()}`, 120),
    customer: {
      name: customerName,
      email: customerEmail,
      document,
      address
    },
    service: {
      name: serviceName,
      description: serviceDescription,
      amount: totalAmount
    },
    installment: {
      number_of: installments,
      due_date: normalizeDueDate({
        dueDates: input.dueDates,
        firstDueDate: input.firstDueDate,
        dayOfMonth: input.dayOfMonth,
        installments
      })
    },
    payment_forms: ['BANK_SLIP']
  };

  const paymentTerms = normalizePaymentTerms(input.paymentTerms || {});
  if (paymentTerms) payload.payment_terms = paymentTerms;

  const notification = input.notification;
  if (notification && notification.name && Array.isArray(notification.channels) && notification.channels.length) {
    payload.notification = notification;
  }

  return payload;
}

export async function issueCoraInstallmentBook(input = {}, { idempotencyKey, onTrace } = {}) {
  const payload = buildCoraInstallmentPayload(input);
  const key = String(idempotencyKey || crypto.randomUUID());
  const response = await coraRequest({
    method: 'POST',
    path: '/v2/invoices/installments',
    data: payload,
    idempotencyKey: key,
    timeoutMs: Math.max(60000, Number(process.env.CORA_INSTALLMENTS_TIMEOUT_MS || 90000)),
    onTrace
  });
  return { idempotencyKey: key, payload, response: response.data };
}
