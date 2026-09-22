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
    'Ariana Móveis'
  ].join('\n');
}

function isOpenDueRow(row = {}) {
  const status = String(row.status || '').trim().toLowerCase();
  return ['pendente', 'parcial'].includes(status) && Number(row.remaining ?? row.value ?? 0) > 0.009;
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

  const enabled = String(process.env.FINANCEIRO_REGUA_WHATSAPP_ENABLED || 'false').toLowerCase() === 'true';
  if (!enabled && !force) return { ok: true, skipped: true, reason: 'disabled' };

  if (mongoose && mongoose.connection?.readyState !== 1) {
    return { ok: false, skipped: true, reason: 'database_not_ready' };
  }

  const timeZone = String(process.env.FINANCEIRO_AUTOMACAO_TIMEZONE || 'America/Sao_Paulo').trim();
  const today = localDateKey(now, timeZone);
  const finance = createErpFinanceService({ Order, IntegrationAuditLog, toJSON, redact });
  const data = await finance.list({});

  const dueRows = (data.receivables || []).filter((row) => {
    if (!isOpenDueRow(row)) return false;
    const due = row.dueAt ? new Date(row.dueAt) : null;
    return due && !Number.isNaN(due.getTime()) && localDateKey(due, timeZone) === today;
  });

  const groups = new Map();

  for (const row of dueRows) {
    const phone = normalizeWhatsappPhone(row.customerPhone);
    if (!phone) continue;

    if (!groups.has(phone)) {
      groups.set(phone, {
        phone,
        customerName: row.customerName || 'Cliente',
        rows: []
      });
    }
    groups.get(phone).rows.push(row);
  }

  let sent = 0;
  let skippedAlreadySent = 0;
  let skippedMissingPhone = dueRows.length - Array.from(groups.values()).reduce((sum, group) => sum + group.rows.length, 0);
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
        delay: Math.max(0, Number(process.env.FINANCEIRO_REGUA_WHATSAPP_DELAY_MS || 900) || 900)
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
    dueInstallments: dueRows.length,
    eligibleCustomers: groups.size,
    sent,
    skippedAlreadySent,
    skippedMissingPhone,
    errors
  };
}

export function startErpDailyDueWhatsappWorker(context = {}) {
  const enabled = String(process.env.FINANCEIRO_REGUA_WHATSAPP_ENABLED || 'false').toLowerCase() === 'true';
  const timeZone = String(process.env.FINANCEIRO_AUTOMACAO_TIMEZONE || 'America/Sao_Paulo').trim();
  const schedule = String(process.env.FINANCEIRO_REGUA_WHATSAPP_HORA || '09:00').trim();
  const sweepMinutes = Math.max(5, Number(process.env.FINANCEIRO_REGUA_WHATSAPP_SWEEP_MINUTES || 10) || 10);

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

      if (result?.sent || result?.errors?.length) {
        console.log('[erp-daily-due-whatsapp]', {
          date: result.date,
          dueInstallments: result.dueInstallments,
          eligibleCustomers: result.eligibleCustomers,
          sent: result.sent,
          skippedAlreadySent: result.skippedAlreadySent,
          skippedMissingPhone: result.skippedMissingPhone,
          errors: result.errors?.length || 0
        });
      }
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

  console.log(`📲 Lembrete ERP de vencimentos do dia: ativo a partir de ${schedule} (${timeZone}); varredura a cada ${sweepMinutes} min.`);

  return { enabled: true, initialTimer, interval, schedule, timeZone, sweepMinutes };
}
