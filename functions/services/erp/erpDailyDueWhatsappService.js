import { createErpFinanceService } from './erpFinanceService.js';
import { createErpParityAnalyticsService } from './erpParityAnalyticsService.js';

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

  if (or.length) {
    const person = await Person.findOne({
      $or: or,
      active: { $ne: false }
    }).select('phone').lean();

    if (person?.phone) return person.phone;
  }

  const name = String(entry.personName || '').trim();
  if (!name) return '';

  const escaped = name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const exactName = new RegExp('^' + escaped + '$', 'i');

  const matches = await Person.find({
    active: { $ne: false },
    $or: [
      { name: exactName },
      { companyName: exactName }
    ]
  }).select('phone').limit(3).lean();

  const phones = Array.from(new Set(
    matches
      .map((person) => normalizeWhatsappPhone(person?.phone || ''))
      .filter(Boolean)
  ));

  return phones.length === 1 ? phones[0] : '';
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

function evolutionMessageId(result = {}) {
  const data = result?.data || {};
  return String(
    result?.messageId ||
    data?.messageId ||
    data?.id ||
    data?.key?.id ||
    data?.message?.key?.id ||
    ''
  ).trim();
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

  const timeZone = String(
    process.env.ERP_DAILY_DUE_WHATSAPP_TIMEZONE ||
    process.env.FINANCEIRO_AUTOMACAO_TIMEZONE ||
    'America/Sao_Paulo'
  ).trim();
  const today = localDateKey(now, timeZone);

  // Usa exatamente a mesma fonte do modal "Vencimentos de hoje" do Ariana ERP:
  // /erp/financeiro/completo?direction=receivable&from=HOJE&to=HOJE
  const parity = createErpParityAnalyticsService({ ...context, Order });
  const screenData = await parity.finance({
    direction: 'receivable',
    from: today,
    to: today
  });

  const dueRows = (screenData.entries || [])
    .filter((row) => {
      const status = String(row.status || '').trim().toLowerCase();
      const open = status !== 'paid' && status !== 'cancelled';
      const remaining = Number(row.outstanding ?? row.value ?? 0);
      return open && remaining > 0.009 && dueDateKey(row.dueAt, timeZone) === today;
    })
    .map((row) => ({
      ...row,
      customerName: row.personName || 'Cliente',
      customerDocument: row.personDocument || '',
      customerPhone: row.personPhone || '',
      remaining: Number(row.outstanding ?? row.value ?? 0),
      installmentKey: String(
        row.id ||
        row.documentNumber ||
        row.boletoNumber ||
        row.installmentNumber ||
        ''
      )
    }));

  // A identidade do agrupamento é o CLIENTE, não o telefone.
  // Assim dois clientes que usam o mesmo telefone continuam recebendo seus lembretes separadamente.
  const customerKey = (row = {}) => {
    const personId = String(row.personId || '').trim();
    if (personId) return `person:${personId}`;

    const sourcePersonId = String(row?.migration?.sourcePersonId || '').trim();
    if (sourcePersonId) return `source:${sourcePersonId}`;

    const document = String(row.customerDocument || row.personDocument || row.document || '').replace(/\D/g, '');
    if (document) return `doc:${document}`;

    const name = String(row.customerName || row.personName || 'Cliente')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

    return `name:${name || 'cliente'}`;
  };

  const groups = new Map();

  for (const row of dueRows) {
    const key = customerKey(row);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        customerName: row.customerName || 'Cliente',
        phone: '',
        rows: []
      });
    }

    const group = groups.get(key);
    const directPhone = normalizeWhatsappPhone(row.customerPhone);
    if (!group.phone && directPhone) group.phone = directPhone;
    group.rows.push(row);
  }

  let skippedMissingPhone = 0;
  for (const group of groups.values()) {
    if (group.phone) continue;

    for (const row of group.rows) {
      const resolved = normalizeWhatsappPhone(await resolveLedgerPhone(mongoose, {
        ...row,
        personName: row.customerName || row.personName,
        personDocument: row.customerDocument || row.personDocument,
        personPhone: row.customerPhone || row.personPhone
      }));
      if (resolved) {
        group.phone = resolved;
        break;
      }
    }

    if (!group.phone) skippedMissingPhone += 1;
  }

  let sent = 0;
  let skippedAlreadySent = 0;
  const errors = [];

  for (const group of groups.values()) {
    if (!group.phone) continue;

    const safeIdentity = String(group.key || '')
      .replace(/[^a-z0-9:_-]+/gi, '_')
      .slice(0, 180);

    const claimKey = `erp_daily_due_whatsapp:${today}:${safeIdentity}`;
    const legacyClaimKey = `erp_daily_due_whatsapp:${today}:${group.phone}`;
    const staleBefore = new Date(Date.now() - 30 * 60 * 1000);

    // Compatibilidade com os registros gerados pela versão antiga.
    // Em 23/09/2026, o operador confirmou que apenas Isabel recebeu de fato.
    // Assim, preservamos Isabel e liberamos somente claims antigos não confirmados
    // dos demais clientes para um reenvio único pelo fluxo corrigido.
    const previousLegacyClaim = await Setting.findOne({ key: legacyClaimKey }).lean().catch(() => null);
    if (previousLegacyClaim) {
      const legacyMessageId = String(previousLegacyClaim?.value?.messageId || '').trim();
      const legacyName = String(previousLegacyClaim?.value?.customerName || group.customerName || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
      const legacyFirstName = legacyName.split(/\s+/).filter(Boolean)[0] || '';
      const confirmedIsabelToday =
        today === '2026-09-23' &&
        (legacyFirstName === 'isabel' || legacyFirstName === 'izabel');

      if (confirmedIsabelToday || legacyMessageId) {
        skippedAlreadySent += 1;
        continue;
      }

      if (today === '2026-09-23') {
        await Setting.deleteOne({ key: legacyClaimKey }).catch(() => null);
      } else {
        skippedAlreadySent += 1;
        continue;
      }
    }

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
          customerKey: group.key,
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

      const messageId = evolutionMessageId(result);
      if (!messageId) {
        const confirmationError = new Error(
          'Evolution aceitou a requisição, mas não retornou identificador da mensagem.'
        );
        confirmationError.code = 'WHATSAPP_SEND_UNCONFIRMED';
        throw confirmationError;
      }

      const sentAt = new Date();
      await Setting.updateOne(
        { key: claimKey },
        {
          $set: {
            value: {
              status: 'sent',
              date: today,
              customerKey: group.key,
              customerName: group.customerName,
              phone: group.phone,
              installmentCount: group.rows.length,
              entryIds: Array.from(new Set(group.rows.map((row) => String(row.id || '')).filter(Boolean))),
              orderIds: Array.from(new Set(group.rows.map((row) => String(row.orderId || '')).filter(Boolean))),
              sentAt,
              provider: result?.provider || 'evolution',
              instanceName: result?.instanceName || '',
              messageId
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
          customerKey: group.key,
          customerName: group.customerName,
          phone: maskedPhone(group.phone),
          installmentCount: group.rows.length,
          instanceName: result?.instanceName || '',
          messageId
        }
      });

      sent += 1;
    } catch (error) {
      const unconfirmed = String(error?.code || '') === 'WHATSAPP_SEND_UNCONFIRMED';

      if (unconfirmed) {
        await Setting.updateOne(
          { key: claimKey },
          {
            $set: {
              'value.status': 'unconfirmed',
              'value.unconfirmedAt': new Date(),
              'value.error': text(error?.message || error, 500),
              updatedBy: 'erp-daily-due-worker'
            }
          }
        ).catch(() => null);
      } else {
        await Setting.deleteOne({ key: claimKey, 'value.status': 'sending' }).catch(() => null);
      }

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
          customerKey: group.key,
          customerName: group.customerName,
          phone: maskedPhone(group.phone),
          installmentCount: group.rows.length
        }
      });
    }
  }

  const localLedgerRows = dueRows.filter((row) => row.source === 'financeiro' || row.origin !== 'ariana_sale');
  const currentSaleRows = dueRows.filter((row) => row.source === 'ariana_sale' || row.origin === 'ariana_sale');

  return {
    ok: errors.length === 0,
    date: today,
    source: 'ariana_erp_vencimentos_hoje',
    moduleDueInstallments: dueRows.length,
    ledgerDueInstallments: localLedgerRows.length,
    nativeDueInstallments: currentSaleRows.length,
    storedDueInstallments: 0,
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


export function buildFifteenDayOverdueMessage(customerName='Cliente'){
  const name=titleFirstName(customerName);
  return [
    `Olá, ${name}!`,
    '',
    'Consta em aberto aqui na loja uma notinha com quinze dias de atraso.',
    '',
    'Teria como você me retornar aqui o mais rápido possível, por favor?',
    '',
    'Obrigado.'
  ].join('\n');
}

function shiftLocalDateKey(dateKey='',days=0){
  const m=String(dateKey).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m)return'';
  const d=new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3])+Number(days||0),12,0,0));
  return d.toISOString().slice(0,10);
}

export async function runErpFifteenDayOverdueWhatsappSweep(context={}){
  const {Order,Setting,IntegrationAuditLog,mongoose,waSendTextMessage,force=false,now=new Date()}=context;
  if(!Order||!Setting||typeof waSendTextMessage!=='function')return{ok:false,skipped:true,reason:'dependencies_missing'};
  const enabled=String(process.env.ERP_15_DAY_COLLECTION_WHATSAPP_ENABLED||'false').toLowerCase()==='true';
  if(!enabled&&!force)return{ok:true,skipped:true,reason:'disabled'};
  if(mongoose&&mongoose.connection?.readyState!==1)return{ok:false,skipped:true,reason:'database_not_ready'};

  const timeZone=String(process.env.ERP_15_DAY_COLLECTION_WHATSAPP_TIMEZONE||process.env.FINANCEIRO_AUTOMACAO_TIMEZONE||'America/Sao_Paulo').trim();
  const today=localDateKey(now,timeZone);
  const dueDate=shiftLocalDateKey(today,-15);
  const parity=createErpParityAnalyticsService({...context,Order});
  const screenData=await parity.finance({direction:'receivable',from:dueDate,to:dueDate});
  const rows=(screenData.entries||[]).filter(row=>{
    const status=String(row.status||'').trim().toLowerCase();
    const remaining=Number(row.outstanding??row.value??0);
    return status!=='paid'&&status!=='cancelled'&&remaining>0.009&&dueDateKey(row.dueAt,timeZone)===dueDate;
  });

  const keyOf=row=>{
    const pid=String(row.personId||'').trim();if(pid)return'person:'+pid;
    const sid=String(row?.migration?.sourcePersonId||'').trim();if(sid)return'source:'+sid;
    const doc=String(row.personDocument||'').replace(/\D/g,'');if(doc)return'doc:'+doc;
    const name=String(row.personName||'Cliente').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
    return'name:'+(name||'cliente');
  };
  const groups=new Map();
  for(const row of rows){
    const key=keyOf(row);
    if(!groups.has(key))groups.set(key,{key,customerName:row.personName||'Cliente',phone:normalizeWhatsappPhone(row.personPhone||''),rows:[]});
    const g=groups.get(key);if(!g.phone)g.phone=normalizeWhatsappPhone(row.personPhone||'');g.rows.push(row);
  }
  for(const g of groups.values()){
    if(g.phone)continue;
    for(const row of g.rows){
      const phone=normalizeWhatsappPhone(await resolveLedgerPhone(mongoose,row));
      if(phone){g.phone=phone;break}
    }
  }

  let sent=0,skippedAlreadySent=0,skippedMissingPhone=0;const errors=[];
  for(const g of groups.values()){
    if(!g.phone){skippedMissingPhone++;continue}
    const safe=String(g.key).replace(/[^a-z0-9:_-]+/gi,'_').slice(0,180);
    const claimKey=`erp_15_day_collection_whatsapp:${today}:${safe}`;
    try{
      await Setting.create({key:claimKey,value:{status:'sending',date:today,dueDate,customerKey:g.key,customerName:g.customerName,phone:g.phone,entryIds:[...new Set(g.rows.map(r=>String(r.id||'')).filter(Boolean))],attemptedAt:new Date()},updatedBy:'erp-15-day-collection-worker'});
    }catch(error){if(Number(error?.code)===11000){skippedAlreadySent++;continue}throw error}
    try{
      const result=await waSendTextMessage({number:g.phone,text:buildFifteenDayOverdueMessage(g.customerName),delay:Math.max(0,Number(process.env.ERP_15_DAY_COLLECTION_WHATSAPP_DELAY_MS||900)||900),instanceName:String(process.env.ERP_15_DAY_COLLECTION_WHATSAPP_INSTANCE||'ariana loja').trim()});
      const messageId=evolutionMessageId(result);if(!messageId)throw Object.assign(new Error('Envio sem confirmação do provedor.'),{code:'WHATSAPP_SEND_UNCONFIRMED'});
      await Setting.updateOne({key:claimKey},{$set:{value:{status:'sent',date:today,dueDate,customerKey:g.key,customerName:g.customerName,phone:g.phone,entryIds:[...new Set(g.rows.map(r=>String(r.id||'')).filter(Boolean))],sentAt:new Date(),instanceName:result?.instanceName||'',messageId},updatedBy:'erp-15-day-collection-worker'}});
      await audit(IntegrationAuditLog,{eventType:'erp_15_day_collection_whatsapp_sent',orderId:String(g.rows[0]?.orderId||''),status:'success',message:'Cobrança automática de exatamente 15 dias enviada.',metadata:{date:today,dueDate,customerKey:g.key,customerName:g.customerName,phone:maskedPhone(g.phone),entryCount:g.rows.length,instanceName:result?.instanceName||'',messageId}});
      sent++;
    }catch(error){
      await Setting.deleteOne({key:claimKey,'value.status':'sending'}).catch(()=>null);
      const errorMessage=text(error?.message||error,500);
      errors.push({customerName:g.customerName,phone:maskedPhone(g.phone),error:errorMessage});
      await audit(IntegrationAuditLog,{eventType:'erp_15_day_collection_whatsapp_failed',orderId:String(g.rows[0]?.orderId||''),status:'error',message:errorMessage,metadata:{date:today,dueDate,customerKey:g.key,customerName:g.customerName,phone:maskedPhone(g.phone),entryCount:g.rows.length}});
    }
  }
  return{ok:errors.length===0,date:today,dueDate,eligibleInstallments:rows.length,eligibleCustomers:groups.size,sent,skippedAlreadySent,skippedMissingPhone,errors};
}

export async function listErpFifteenDayOverdueAudit(context={}){
  const {Order,Setting,IntegrationAuditLog,mongoose,now=new Date()}=context;
  if(!Order||!Setting)return{ok:false,date:'',dueDate:'',customers:[],reason:'dependencies_missing'};
  if(mongoose&&mongoose.connection?.readyState!==1)return{ok:false,date:'',dueDate:'',customers:[],reason:'database_not_ready'};

  const timeZone=String(process.env.ERP_15_DAY_COLLECTION_WHATSAPP_TIMEZONE||process.env.FINANCEIRO_AUTOMACAO_TIMEZONE||'America/Sao_Paulo').trim();
  const today=localDateKey(now,timeZone);
  const dueDate=shiftLocalDateKey(today,-15);
  const parity=createErpParityAnalyticsService({...context,Order});
  const screenData=await parity.finance({direction:'receivable',from:dueDate,to:dueDate});
  const rows=(screenData.entries||[]).filter(row=>{
    const status=String(row.status||'').trim().toLowerCase();
    const remaining=Number(row.outstanding??row.value??0);
    return status!=='paid'&&status!=='cancelled'&&remaining>0.009&&dueDateKey(row.dueAt,timeZone)===dueDate;
  });

  const keyOf=row=>{
    const pid=String(row.personId||'').trim();if(pid)return'person:'+pid;
    const sid=String(row?.migration?.sourcePersonId||'').trim();if(sid)return'source:'+sid;
    const doc=String(row.personDocument||'').replace(/\D/g,'');if(doc)return'doc:'+doc;
    const name=String(row.personName||'Cliente').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
    return'name:'+(name||'cliente');
  };

  const groups=new Map();
  for(const row of rows){
    const key=keyOf(row);
    if(!groups.has(key))groups.set(key,{key,customerName:row.personName||'Cliente',phone:normalizeWhatsappPhone(row.personPhone||''),rows:[]});
    const g=groups.get(key);
    if(!g.phone)g.phone=normalizeWhatsappPhone(row.personPhone||'');
    g.rows.push(row);
  }

  for(const g of groups.values()){
    if(g.phone)continue;
    for(const row of g.rows){
      const phone=normalizeWhatsappPhone(await resolveLedgerPhone(mongoose,row));
      if(phone){g.phone=phone;break}
    }
  }

  const prefix=`erp_15_day_collection_whatsapp:${today}:`;
  const claims=await Setting.find({key:{$regex:'^'+prefix.replace(/[-/\\^$*+?.()|[\]{}]/g,'\\    }catch(error){
      await Setting.deleteOne({key:claimKey,'value.status':'sending'}).catch(()=>null);
      errors.push({customerName:g.customerName,phone:maskedPhone(g.phone),error:text(error?.message||error,500)});
    }
  }
  return{ok:errors.length===0,date:today,dueDate,eligibleInstallments:rows.length,eligibleCustomers:groups.size,sent,skippedAlreadySent,skippedMissingPhone,errors};
}')}}).lean().catch(()=>[]);
  const claimMap=new Map(claims.map(item=>[String(item?.value?.customerKey||''),item?.value||{}]));

  const failures=IntegrationAuditLog
    ? await IntegrationAuditLog.find({eventType:'erp_15_day_collection_whatsapp_failed','metadata.date':today}).sort({createdAt:-1}).lean().catch(()=>[])
    : [];
  const failureMap=new Map();
  for(const item of failures){
    const key=String(item?.metadata?.customerKey||'');
    if(key&&!failureMap.has(key))failureMap.set(key,item);
  }

  const customers=[];
  for(const g of groups.values()){
    const claim=claimMap.get(g.key)||null;
    const failure=failureMap.get(g.key)||null;
    let status='nao_enviado',reason='Ainda não houve envio confirmado.';
    if(!g.phone){status='telefone_invalido_ou_ausente';reason='Telefone ausente ou inválido no cadastro do cliente.'}
    else if(String(claim?.status||'')==='sent'){status='enviado';reason='Mensagem enviada e confirmada pelo provedor.'}
    else if(failure){status='falha_no_envio';reason=String(failure?.message||'Falha ao enviar a mensagem.')}
    else if(String(claim?.status||'')==='sending'){status='processando';reason='Envio em processamento.'}

    const totalOutstanding=g.rows.reduce((sum,row)=>sum+Number(row.outstanding??row.value??0),0);
    customers.push({
      customerKey:g.key,
      customerName:g.customerName,
      phone:g.phone||'',
      status,
      reason,
      installmentCount:g.rows.length,
      totalOutstanding,
      dueDate,
      sentAt:claim?.sentAt||null,
      messageId:claim?.messageId||''
    });
  }

  const order={telefone_invalido_ou_ausente:0,falha_no_envio:1,nao_enviado:2,processando:3,enviado:4};
  customers.sort((a,b)=>(order[a.status]??9)-(order[b.status]??9)||String(a.customerName).localeCompare(String(b.customerName),'pt-BR'));

  return{ok:true,date:today,dueDate,eligibleCustomers:customers.length,customers};
}

export function startErpFifteenDayOverdueWhatsappWorker(context={}){
  const enabled=String(process.env.ERP_15_DAY_COLLECTION_WHATSAPP_ENABLED||'false').toLowerCase()==='true';
  const timeZone=String(process.env.ERP_15_DAY_COLLECTION_WHATSAPP_TIMEZONE||process.env.FINANCEIRO_AUTOMACAO_TIMEZONE||'America/Sao_Paulo').trim();
  const schedule=String(process.env.ERP_15_DAY_COLLECTION_WHATSAPP_HORA||'10:00').trim();
  const sweepMinutes=Math.max(10,Number(process.env.ERP_15_DAY_COLLECTION_WHATSAPP_SWEEP_MINUTES||30)||30);
  if(!enabled){console.log('📵 Cobrança ERP de 15 dias: desativada.');return{enabled:false}}
  let running=false;
  const run=async()=>{if(running)return;const current=new Date();if(localMinutes(current,timeZone)<scheduleMinutes(schedule))return;running=true;try{const result=await runErpFifteenDayOverdueWhatsappSweep({...context,force:true,now:current});console.log('[erp-15-day-collection-whatsapp]',{date:result.date,dueDate:result.dueDate,eligibleCustomers:result.eligibleCustomers,sent:result.sent,skippedAlreadySent:result.skippedAlreadySent,skippedMissingPhone:result.skippedMissingPhone,errors:result.errors?.length||0})}catch(error){console.error('[erp-15-day-collection-whatsapp]',error?.message||error)}finally{running=false}};
  const current=new Date();
  const currentMinutes=localMinutes(current,timeZone);
  const targetMinutes=scheduleMinutes(schedule);
  const firstDelayMs=currentMinutes<targetMinutes
    ? Math.max(1000,(targetMinutes-currentMinutes)*60*1000)
    : 60*1000;
  let interval=null;
  const initialTimer=setTimeout(()=>{
    run();
    interval=setInterval(run,sweepMinutes*60*1000);
    interval.unref?.();
  },firstDelayMs);
  initialTimer.unref?.();
  console.log(`📲 Cobrança ERP de exatamente 15 dias: primeira varredura em ${Math.round(firstDelayMs/60000)} min; horário-base ${schedule} (${timeZone}); depois a cada ${sweepMinutes} min.`);
  return{enabled:true,initialTimer,interval,schedule,timeZone,sweepMinutes};
}
