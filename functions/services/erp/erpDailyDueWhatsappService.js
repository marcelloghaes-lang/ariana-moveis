import { createErpFinanceService } from './erpFinanceService.js';

const text = (value = '', max = 500) => String(value ?? '').trim().slice(0, max);

export function normalizeWhatsappPhone(value = '') {
  let digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  if (!digits.startsWith('55')) return '';
  if (digits.length < 12 || digits.length > 13) return '';
  return digits;
}

export function localDateKey(date = new Date(), timeZone = 'America/Sao_Paulo') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

function dueDateKey(value, timeZone = 'America/Sao_Paulo') {
  const raw = String(value || '').trim();
  const isoDate = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDate) return isoDate[1];

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return localDateKey(date, timeZone);
}

function localMinutes(date = new Date(), timeZone = 'America/Sao_Paulo') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const pick = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  return pick('hour') * 60 + pick('minute');
}

function scheduleMinutes(value = '09:00') {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 9 * 60;
  const hour = Math.min(23, Math.max(0, Number(match[1] || 0)));
  const minute = Math.min(59, Math.max(0, Number(match[2] || 0)));
  return hour * 60 + minute;
}

function titleFirstName(name = '') {
  const first = text(name || 'Cliente', 160).split(/\s+/).filter(Boolean)[0] || 'Cliente';
  return first.charAt(0).toUpperCase() + first.slice(1).toLocaleLowerCase('pt-BR');
}

export function buildDailyDueReminderMessage(customerName = 'Cliente', installmentCount = 1) {
  const name = titleFirstName(customerName);
  const plural = Number(installmentCount || 1) > 1;

  return [
    `Bom dia, ${name}! Tudo bem?`,
    '',
    plural
      ? 'Passando para lembrar que hoje vencem parcelas referentes às suas compras realizadas aqui na Ariana Móveis.'
      : 'Passando para lembrar que hoje vence uma parcela referente à sua compra realizada aqui na Ariana Móveis.',
    '',
    'Se o pagamento já tiver sido realizado, por favor desconsidere esta mensagem.',
    '',
    'Qualquer dúvida, estamos à disposição. 💙',
    '',
    'Marcelo'
  ].join('\n');
}

function isOpenDueRow(row = {}) {
  const status = String(row.status || '').trim().toLowerCase();
  return ['pendente', 'parcial'].includes(status) && Number(row.remaining ?? row.value ?? 0) > 0.009;
}

function localInstallmentRemaining(installment = {}) {
  const value = Number(
    installment.saldoParcela ??
    installment.saldo ??
    installment.atualizacaoFinanceira?.valorAtualizado ??
    installment.valorParcela ??
    installment.valor ??
    0
  );
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function isLocalInstallmentOpen(installment = {}) {
  if (installment.quitado === true) return false;
  const status = String(installment.status || '').trim().toLowerCase();
  if (['paga', 'pago', 'recebido', 'quitada', 'quitado', 'cancelada', 'cancelado', 'estornada', 'estornado'].includes(status)) {
    return false;
  }
  return localInstallmentRemaining(installment) > 0.009;
}

function ledgerOutstanding(entry = {}) {
  const status = String(entry.status || '').trim().toLowerCase();
  if (['paid', 'pago', 'recebido', 'quitado', 'cancelled', 'cancelado', 'estornado'].includes(status)) return 0;

  const direct = Number(entry.outstanding);
  if (Number.isFinite(direct)) return Math.max(0, direct);

  const payments = Array.isArray(entry.payments) ? entry.payments : [];
  const principalPaid = payments.length
    ? payments.reduce((sum, payment) => sum + Number(payment?.principalApplied ?? payment?.amount ?? 0), 0)
    : Number(entry.principalPaid ?? 0);

  return Math.max(0, Number(entry.value || 0) - principalPaid);
}

async function resolveLedgerPhone(mongoose, entry = {}) {
  if (entry.personPhone) return entry.personPhone;

  const Person = mongoose?.models?.ErpPerson;
  if (!Person) return '';

  const sourcePersonId = String(entry?.migration?.sourcePersonId || '').trim();
  const document = String(entry.personDocument || '').replace(/\D/g, '');
  const or = [];
  if (sourcePersonId) or.push({ sourceId: sourcePersonId });
  if (document) or.push({ document });

  if (!or.length) return '';

  const person = await Person.findOne({
    $or: or,
    active: { $ne: false }
  }).select('phone').lean();

  return person?.phone || '';
}

async function listArianaLedgerDueRows({ mongoose, today, timeZone }) {
  const Entry = mongoose?.models?.ErpFinancialEntry;
  if (!Entry) return [];

  const rawRows = await Entry.collection.find({
    direction: 'receivable',
    dueAt: { $exists: true, $ne: null }
  }).project({
    _id: 1,
    origin: 1,
    status: 1,
    dueAt: 1,
    value: 1,
    outstanding: 1,
    principalPaid: 1,
    payments: 1,
    personName: 1,
    personDocument: 1,
    personPhone: 1,
    documentNumber: 1,
    boletoNumber: 1,
    orderId: 1,
    installmentNumber: 1,
    migration: 1
  }).sort({ dueAt: 1 }).limit(30000).toArray();

  const rows = [];

  for (const entry of rawRows) {
    if (dueDateKey(entry.dueAt, timeZone) !== today) continue;

    // Mantém a mesma proteção de qualidade usada nos relatórios do ERP.
    if (entry.origin === 'sige_import' && Math.abs(Number(entry.value || 0)) >= 10_000_000) continue;

    const remaining = ledgerOutstanding(entry);
    if (remaining <= 0.009) continue;

    const phone = await resolveLedgerPhone(mongoose, entry);

    rows.push({
      source: 'ariana_erp_ledger',
      orderId: String(entry.orderId || ''),
      ledgerEntryId: String(entry._id || ''),
      customerName: entry.personName || 'Cliente',
      customerPhone: phone,
      dueAt: entry.dueAt,
      status: 'pendente',
      remaining,
      value: Number(entry.value || remaining),
      installmentKey: String(
        entry.documentNumber ||
        entry.boletoNumber ||
        entry.installmentNumber ||
        entry._id ||
        ''
      )
    });
  }

  return rows;
}

async function listArianaStoredDueRows({ mongoose, today, timeZone }) {
  const db = mongoose?.connection?.db;
  if (!db) return [];

  const rows = [];
  const cursor = db.collection('financeiro_carnes_digitais').find(
    { status: 'ATIVO' },
    {
      projection: {
        codigo: 1,
        cliente: 1,
        parcelas: 1
      }
    }
  ).limit(5000);

  for await (const carne of cursor) {
    const installments = Array.isArray(carne?.parcelas) ? carne.parcelas : [];
    for (const installment of installments) {
      const dueAt = installment?.dataVencimento ?? installment?.vencimento ?? null;
      if (!isLocalInstallmentOpen(installment)) continue;
      if (dueDateKey(dueAt, timeZone) !== today) continue;

      rows.push({
        source: 'ariana_financeiro_local',
        orderId: '',
        localCarneId: String(carne?._id || ''),
        localCarneCode: String(carne?.codigo || ''),
        customerName: carne?.cliente?.nome || 'Cliente',
        customerPhone: carne?.cliente?.telefone || '',
        dueAt,
        status: 'pendente',
        remaining: localInstallmentRemaining(installment),
        value: localInstallmentRemaining(installment),
        installmentKey: String(
          installment?.codigo ||
          installment?.id ||
          installment?.codigoLancamento ||
          installment?.parcelaLabel ||
          installment?.parcelaNumero ||
          ''
        )
      });
    }
  }

  return rows;
}

function maskedPhone(phone = '') {
  const value = String(phone || '');
  return value.length > 6 ? `${value.slice(0, 4)}******${value.slice(-3)}` : '***';
}

async function audit(IntegrationAuditLog, payload = {}) {
  if (!IntegrationAuditLog) return;
  try {
    await IntegrationAuditLog.create({
      scope: 'erp_ariana',
      eventType: payload.eventType || 'daily_due_whatsapp',
      orderId: payload.orderId || null,
      status: payload.status || '',
      message: payload.message || '',
      metadata: payload.metadata || {}
    });
  } catch (error) {
    console.warn('[erp-daily-due-whatsapp/audit]', error?.message || error);
  }
}

export async function runErpDailyDueWhatsappSweep(context = {}) {
  const {
    Order,
    Setting,
    IntegrationAuditLog,
    mongoose,
    waSendTextMessage,
    toJSON,
    redact,
    force = false,
    now = new Date()
  } = context;

  if (!Order || !Setting || typeof waSendTextMessage !== 'function') {
    return { ok: false, skipped: true, reason: 'dependencies_missing' };
  }

  const enabled = String(process.env.ERP_DAILY_DUE_WHATSAPP_ENABLED || 'false').toLowerCase() === 'true';
  if (!enabled && !force) return { ok: true, skipped: true, reason: 'disabled' };

  if (mongoose && mongoose.connection?.readyState !== 1) {
    return { ok: false, skipped: true, reason: 'database_not_ready' };
  }

  const timeZone = String(process.env.ERP_DAILY_DUE_WHATSAPP_TIMEZONE || process.env.FINANCEIRO_AUTOMACAO_TIMEZONE || 'America/Sao_Paulo').trim();
  const today = localDateKey(now, timeZone);
  const finance = createErpFinanceService({ Order, IntegrationAuditLog, toJSON, redact });
  const data = await finance.list({});

  const nativeDueRows = (data.receivables || []).filter((row) => {
    if (!isOpenDueRow(row)) return false;
    return dueDateKey(row.dueAt, timeZone) === today;
  });

  // Fonte adicional 100% local da Ariana. Não consulta o SIGE nem qualquer serviço externo:
  // lê apenas os carnês/parcelas já persistidos no próprio banco financeiro da Ariana.
  const [ledgerDueRows, storedDueRows] = await Promise.all([
    listArianaLedgerDueRows({ mongoose, today, timeZone }),
    listArianaStoredDueRows({ mongoose, today, timeZone })
  ]);
  const dueRows = [...ledgerDueRows, ...nativeDueRows, ...storedDueRows];

  const groups = new Map();
  let skippedMissingPhone = 0;

  for (const row of dueRows) {
    const phone = normalizeWhatsappPhone(row.customerPhone);
    if (!phone) {
      skippedMissingPhone += 1;
      continue;
    }

    if (!groups.has(phone)) {
      groups.set(phone, {
        phone,
        customerName: row.customerName || 'Cliente',
        rows: [],
        fingerprints: new Set()
      });
    }

    const remaining = Number(row.remaining ?? row.value ?? 0);
    const fingerprint = [
      phone,
      dueDateKey(row.dueAt, timeZone),
      Number.isFinite(remaining) ? remaining.toFixed(2) : '0.00'
    ].join('|');

    const group = groups.get(phone);
    if (group.fingerprints.has(fingerprint)) continue;
    group.fingerprints.add(fingerprint);
    group.rows.push(row);
  }

  let sent = 0;
  let skippedAlreadySent = 0;
  const errors = [];

  for (const group of groups.values()) {
    const claimKey = `erp_daily_due_whatsapp:${today}:${group.phone}`;
    const staleBefore = new Date(Date.now() - 30 * 60 * 1000);

    await Setting.deleteMany({
      key: claimKey,
      'value.status': 'sending',
      'value.attemptedAt': { $lt: staleBefore }
    }).catch(() => null);

    try {
      await Setting.create({
        key: claimKey,
        value: {
          status: 'sending',
          date: today,
          customerName: group.customerName,
          phone: group.phone,
          installmentCount: group.rows.length,
          attemptedAt: new Date()
        },
        updatedBy: 'erp-daily-due-worker'
      });
    } catch (error) {
      if (Number(error?.code) === 11000) {
        skippedAlreadySent += 1;
        continue;
      }
      throw error;
    }

    const message = buildDailyDueReminderMessage(group.customerName, group.rows.length);

    try {
      const result = await waSendTextMessage({
        number: group.phone,
        text: message,
        delay: Math.max(0, Number(process.env.ERP_DAILY_DUE_WHATSAPP_DELAY_MS || 900) || 900),
        instanceName: String(process.env.ERP_DAILY_DUE_WHATSAPP_INSTANCE || 'ariana loja').trim()
      });

      const sentAt = new Date();
      await Setting.updateOne(
        { key: claimKey },
        {
          $set: {
            value: {
              status: 'sent',
              date: today,
              customerName: group.customerName,
              phone: group.phone,
              installmentCount: group.rows.length,
              orderIds: Array.from(new Set(group.rows.map((row) => String(row.orderId || '')).filter(Boolean))),
              sentAt,
              provider: result?.provider || 'evolution',
              instanceName: result?.instanceName || ''
            },
            updatedBy: 'erp-daily-due-worker'
          }
        }
      );

      await audit(IntegrationAuditLog, {
        eventType: 'erp_daily_due_whatsapp_sent',
        orderId: String(group.rows[0]?.orderId || ''),
        status: 'success',
        message: 'Lembrete de vencimento do dia enviado ao cliente.',
        metadata: {
          date: today,
          customerName: group.customerName,
          phone: maskedPhone(group.phone),
          installmentCount: group.rows.length,
          instanceName: result?.instanceName || ''
        }
      });

      sent += 1;
    } catch (error) {
      await Setting.deleteOne({ key: claimKey, 'value.status': 'sending' }).catch(() => null);

      errors.push({
        customerName: group.customerName,
        phone: maskedPhone(group.phone),
        error: text(error?.message || error, 500)
      });

      await audit(IntegrationAuditLog, {
        eventType: 'erp_daily_due_whatsapp_failed',
        orderId: String(group.rows[0]?.orderId || ''),
        status: 'error',
        message: text(error?.message || error, 1000),
        metadata: {
          date: today,
          customerName: group.customerName,
          phone: maskedPhone(group.phone),
          installmentCount: group.rows.length
        }
      });
    }
  }

  return {
    ok: errors.length === 0,
    date: today,
    source: 'ariana_erp_ledger_and_local_finance',
    ledgerDueInstallments: ledgerDueRows.length,
    nativeDueInstallments: nativeDueRows.length,
    storedDueInstallments: storedDueRows.length,
    dueInstallments: dueRows.length,
    eligibleCustomers: groups.size,
    sent,
    skippedAlreadySent,
    skippedMissingPhone,
    errors
  };
}

export function startErpDailyDueWhatsappWorker(context = {}) {
  const enabled = String(process.env.ERP_DAILY_DUE_WHATSAPP_ENABLED || 'false').toLowerCase() === 'true';
  const timeZone = String(process.env.ERP_DAILY_DUE_WHATSAPP_TIMEZONE || process.env.FINANCEIRO_AUTOMACAO_TIMEZONE || 'America/Sao_Paulo').trim();
  const schedule = String(process.env.ERP_DAILY_DUE_WHATSAPP_HORA || '09:00').trim();
  const sweepMinutes = Math.max(5, Number(process.env.ERP_DAILY_DUE_WHATSAPP_SWEEP_MINUTES || 10) || 10);
  const instanceName = String(process.env.ERP_DAILY_DUE_WHATSAPP_INSTANCE || 'ariana loja').trim();

  if (!enabled) {
    console.log('📵 Lembrete ERP de vencimentos do dia: desativado.');
    return { enabled: false };
  }

  let running = false;
  const run = async () => {
    if (running) return;
    const current = new Date();
    if (localMinutes(current, timeZone) < scheduleMinutes(schedule)) return;

    running = true;
    try {
      const result = await runErpDailyDueWhatsappSweep({
        ...context,
        force: true,
        now: current
      });

      console.log('[erp-daily-due-whatsapp]', {
        date: result.date,
        source: result.source,
        ledgerDueInstallments: result.ledgerDueInstallments,
        nativeDueInstallments: result.nativeDueInstallments,
        storedDueInstallments: result.storedDueInstallments,
        dueInstallments: result.dueInstallments,
        eligibleCustomers: result.eligibleCustomers,
        sent: result.sent,
        skippedAlreadySent: result.skippedAlreadySent,
        skippedMissingPhone: result.skippedMissingPhone,
        errors: result.errors?.length || 0
      });
    } catch (error) {
      console.error('[erp-daily-due-whatsapp]', error?.message || error);
    } finally {
      running = false;
    }
  };

  const initialTimer = setTimeout(run, 60 * 1000);
  initialTimer.unref?.();

  const interval = setInterval(run, sweepMinutes * 60 * 1000);
  interval.unref?.();

  console.log(`📲 Lembrete ERP de vencimentos do dia: ativo a partir de ${schedule} (${timeZone}); instância ${instanceName}; varredura a cada ${sweepMinutes} min.`);

  return { enabled: true, initialTimer, interval, schedule, timeZone, sweepMinutes };
}
