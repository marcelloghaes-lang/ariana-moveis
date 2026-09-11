import mongoose from 'mongoose';

const clean = (v = '', m = 1000) => String(v ?? '').trim().slice(0, m);
const money = (v = 0) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;

function fail(message, statusCode = 400, code = 'ERP_CASH_ERROR') {
  const e = new Error(message);
  e.statusCode = statusCode;
  e.code = code;
  return e;
}

function actor(a = {}) {
  const id = clean(a.id || a._id || a.userId || '', 120);
  const email = clean(a.email || '', 180).toLowerCase();
  const name = clean(a.name || a.nome || email || 'Administrador', 180);
  return { id, email, name, key: email || id || clean(name, 180).toLowerCase() || 'admin' };
}

const movementSchema = new mongoose.Schema({
  type: { type: String, enum: ['opening', 'sale', 'reinforcement', 'withdrawal', 'adjustment'], required: true },
  method: { type: String, default: 'dinheiro' },
  value: { type: Number, default: 0 },
  orderId: { type: String, default: '' },
  orderCode: { type: String, default: '' },
  note: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

const cashSchema = new mongoose.Schema({
  operatorKey: { type: String, index: true, required: true },
  operatorId: { type: String, default: '' },
  operatorEmail: { type: String, default: '' },
  operatorName: { type: String, default: '' },
  status: { type: String, enum: ['open', 'closed'], default: 'open', index: true },
  openedAt: { type: Date, default: Date.now },
  closedAt: { type: Date, default: null },
  openingBalance: { type: Number, default: 0 },
  closingDeclared: { type: Number, default: null },
  closingExpected: { type: Number, default: null },
  difference: { type: Number, default: null },
  movements: { type: [movementSchema], default: [] }
}, { timestamps: true, minimize: false });

cashSchema.index({ operatorKey: 1, status: 1, openedAt: -1 });
const ErpCashSession = mongoose.models.ErpCashSession || mongoose.model('ErpCashSession', cashSchema);

function summarize(session) {
  if (!session) return null;
  const rows = Array.isArray(session.movements) ? session.movements : [];
  const totals = { dinheiro: 0, pix: 0, cartao_debito: 0, cartao_credito: 0, crediario: 0, boleto: 0, outro: 0 };
  let cash = money(session.openingBalance || 0);
  for (const m of rows) {
    const value = money(m.value || 0);
    const method = clean(m.method || 'outro', 80);
    if (m.type === 'sale') totals[method] = money((totals[method] || 0) + value);
    if (method === 'dinheiro') {
      if (m.type === 'sale' || m.type === 'reinforcement') cash = money(cash + value);
      if (m.type === 'withdrawal') cash = money(cash - value);
    }
  }
  return {
    id: String(session._id),
    operatorKey: session.operatorKey,
    operatorName: session.operatorName,
    status: session.status,
    openedAt: session.openedAt,
    closedAt: session.closedAt,
    openingBalance: money(session.openingBalance),
    expectedCash: cash,
    closingDeclared: session.closingDeclared == null ? null : money(session.closingDeclared),
    difference: session.difference == null ? null : money(session.difference),
    salesByMethod: totals,
    movements: rows.map(m => ({
      type: m.type,
      method: m.method,
      value: money(m.value),
      orderId: m.orderId,
      orderCode: m.orderCode,
      note: m.note,
      createdAt: m.createdAt
    }))
  };
}

export function createErpCashService(context = {}) {
  const { IntegrationAuditLog, redact } = context;

  async function audit(eventType, session, metadata = {}) {
    if (!IntegrationAuditLog) return;
    try {
      await IntegrationAuditLog.create({
        scope: 'erp_ariana', eventType,
        orderId: clean(metadata.orderId || '', 120),
        status: session?.status || '',
        message: clean(metadata.message || '', 1000),
        metadata: redact ? redact({ cashSessionId: String(session?._id || ''), ...metadata }) : { cashSessionId: String(session?._id || ''), ...metadata }
      });
    } catch (e) { console.warn('[erp-cash/audit]', e.message); }
  }

  async function current(a = {}) {
    const op = actor(a);
    const session = await ErpCashSession.findOne({ operatorKey: op.key, status: 'open' }).sort({ openedAt: -1 });
    return summarize(session);
  }

  async function requireOpen(a = {}) {
    const op = actor(a);
    const session = await ErpCashSession.findOne({ operatorKey: op.key, status: 'open' }).sort({ openedAt: -1 });
    if (!session) throw fail('Abra o caixa antes de faturar pelo PDV.', 409, 'CASH_CLOSED');
    return session;
  }

  async function open(payload = {}, a = {}) {
    const op = actor(a);
    const already = await ErpCashSession.findOne({ operatorKey: op.key, status: 'open' });
    if (already) throw fail('Já existe um caixa aberto para este operador.', 409, 'CASH_ALREADY_OPEN');
    const openingBalance = Math.max(0, money(payload.openingBalance ?? payload.saldoInicial ?? 0));
    const session = await ErpCashSession.create({
      operatorKey: op.key, operatorId: op.id, operatorEmail: op.email, operatorName: op.name,
      status: 'open', openingBalance,
      movements: openingBalance > 0 ? [{ type: 'opening', method: 'dinheiro', value: openingBalance, note: clean(payload.note || 'Saldo inicial', 500) }] : []
    });
    await audit('erp.cash.opened', session, { message: 'Caixa aberto', openingBalance });
    return summarize(session);
  }

  async function addMovement(type, payload = {}, a = {}) {
    const session = await requireOpen(a);
    const value = money(payload.value ?? payload.amount ?? 0);
    if (value <= 0) throw fail('Informe um valor maior que zero.', 400, 'INVALID_CASH_VALUE');
    const method = clean(payload.method || 'dinheiro', 80);
    session.movements.push({ type, method, value, note: clean(payload.note || payload.reason || '', 500), createdAt: new Date() });
    await session.save();
    await audit(`erp.cash.${type}`, session, { message: type === 'withdrawal' ? 'Sangria registrada' : 'Reforço registrado', value, method });
    return summarize(session);
  }

  async function registerSale(order, a = {}) {
    if (!order) return null;
    const op = actor(a);
    const session = await ErpCashSession.findOne({ operatorKey: op.key, status: 'open' }).sort({ openedAt: -1 });
    if (!session) return null;
    const method = clean(order.payment?.method || 'outro', 80);
    const code = clean(order.televendas?.erp?.code || String(order._id || ''), 120);
    const exists = session.movements.some(m => m.type === 'sale' && m.orderId === String(order._id || ''));
    if (exists) return summarize(session);
    session.movements.push({
      type: 'sale', method, value: money(order.total), orderId: String(order._id || ''), orderCode: code,
      note: clean(`Venda ${code}`, 500), createdAt: new Date()
    });
    await session.save();
    await audit('erp.cash.sale', session, { message: `Venda ${code} registrada no caixa`, orderId: String(order._id || ''), value: money(order.total), method });
    return summarize(session);
  }

  async function close(payload = {}, a = {}) {
    const session = await requireOpen(a);
    const summary = summarize(session);
    const declared = money(payload.declaredCash ?? payload.closingDeclared ?? summary.expectedCash);
    if (declared < 0) throw fail('Valor de fechamento inválido.', 400, 'INVALID_CLOSING_VALUE');
    session.status = 'closed';
    session.closedAt = new Date();
    session.closingExpected = summary.expectedCash;
    session.closingDeclared = declared;
    session.difference = money(declared - summary.expectedCash);
    await session.save();
    await audit('erp.cash.closed', session, { message: 'Caixa fechado', expected: summary.expectedCash, declared, difference: session.difference });
    return summarize(session);
  }

  async function history(a = {}, query = {}) {
    const op = actor(a);
    const limit = Math.min(100, Math.max(1, Number(query.limit || 30)));
    const sessions = await ErpCashSession.find({ operatorKey: op.key }).sort({ openedAt: -1 }).limit(limit);
    return sessions.map(summarize);
  }

  return {
    current,
    requireOpen,
    open,
    reinforcement: (payload, a) => addMovement('reinforcement', payload, a),
    withdrawal: (payload, a) => addMovement('withdrawal', payload, a),
    registerSale,
    close,
    history
  };
}

export default createErpCashService;
