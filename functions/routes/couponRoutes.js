// ============================================================
// ROTAS DE CUPONS - ARIANA MÓVEIS
// Extraído de legacyRoutes.js na Etapa 15.
// Objetivo: reduzir legacyRoutes.js sem alterar endpoints, regras ou respostas.
// ============================================================

export default function registerCouponRoutes(app, context = {}) {
  const {
    mongoose,
    baseOptions,
    adminRequired,
    ensureArray,
    toJSON,
    escapeRegex,
    DEFAULT_CURRENCY
  } = context;

  const formatCurrency = context.formatCurrency || ((value = 0) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: DEFAULT_CURRENCY || 'BRL' }).format(Number(value || 0))
  );

// ============================================================
// CUPONS DE DESCONTO - ARIANA MÓVEIS
// Módulo incremental adicionado sem remover rotas existentes.
// Permite ao Admin criar, listar, editar, ativar/desativar e
// validar cupons no checkout.
// ============================================================
const couponSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, index: true },
  title: { type: String, default: '' },
  description: { type: String, default: '' },
  type: { type: String, default: 'percent', enum: ['percent', 'fixed'], index: true },
  value: { type: Number, default: 0 },
  minSubtotal: { type: Number, default: 0 },
  maxDiscount: { type: Number, default: 0 },
  active: { type: Boolean, default: true, index: true },
  startsAt: { type: Date, default: null },
  endsAt: { type: Date, default: null },
  usageLimit: { type: Number, default: 0 },
  usedCount: { type: Number, default: 0 },
  perCustomerLimit: { type: Number, default: 0 },
  allowedSellerIds: { type: [String], default: [] },
  excludedSellerIds: { type: [String], default: [] },
  metadata: mongoose.Schema.Types.Mixed,
  createdBy: { type: String, default: '' },
  updatedBy: { type: String, default: '' }
}, baseOptions);
couponSchema.index({ code: 1, active: 1 });
couponSchema.index({ active: 1, endsAt: 1 });

const Coupon = mongoose.models.Coupon || mongoose.model('Coupon', couponSchema);

function normalizeCouponCode(value = '') {
  return String(value || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9_-]+/g, '')
    .slice(0, 40);
}

function parseCouponMoney(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return Number(fallback || 0);
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) / 100 : Number(fallback || 0);
  let raw = String(value || '').trim().replace(/R\$/gi, '').replace(/\s+/g, '');
  if (!raw) return Number(fallback || 0);
  if (raw.includes(',')) raw = raw.replace(/\./g, '').replace(',', '.');
  const n = Number(raw.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : Number(fallback || 0);
}

function parseCouponDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function couponPayloadFromBody(body = {}, adminId = '') {
  const code = normalizeCouponCode(body.code || body.codigo || body.cupom);
  const typeRaw = String(body.type || body.tipo || 'percent').toLowerCase().trim();
  const type = ['fixed', 'valor', 'amount', 'money'].includes(typeRaw) ? 'fixed' : 'percent';

  return {
    code,
    title: String(body.title || body.titulo || '').trim(),
    description: String(body.description || body.descricao || '').trim(),
    type,
    value: parseCouponMoney(body.value ?? body.valor ?? 0),
    minSubtotal: parseCouponMoney(body.minSubtotal ?? body.valorMinimo ?? body.minimo ?? 0),
    maxDiscount: parseCouponMoney(body.maxDiscount ?? body.descontoMaximo ?? 0),
    active: body.active !== undefined ? body.active !== false && String(body.active).toLowerCase() !== 'false' : true,
    startsAt: parseCouponDate(body.startsAt || body.inicio || body.dataInicio),
    endsAt: parseCouponDate(body.endsAt || body.fim || body.validade || body.dataFim),
    usageLimit: Math.max(0, Number(body.usageLimit ?? body.limiteUso ?? 0) || 0),
    perCustomerLimit: Math.max(0, Number(body.perCustomerLimit ?? body.limitePorCliente ?? 0) || 0),
    allowedSellerIds: ensureArray(body.allowedSellerIds || body.sellersPermitidos).map((v) => String(v || '').trim()).filter(Boolean),
    excludedSellerIds: ensureArray(body.excludedSellerIds || body.sellersBloqueados).map((v) => String(v || '').trim()).filter(Boolean),
    metadata: body.metadata || body.extra || null,
    updatedBy: String(adminId || '')
  };
}

function normalizeCouponForResponse(doc) {
  const obj = toJSON(doc) || {};
  return {
    ...obj,
    id: String(obj.id || obj._id || ''),
    code: normalizeCouponCode(obj.code),
    value: parseCouponMoney(obj.value),
    minSubtotal: parseCouponMoney(obj.minSubtotal),
    maxDiscount: parseCouponMoney(obj.maxDiscount),
    usedCount: Number(obj.usedCount || 0),
    usageLimit: Number(obj.usageLimit || 0),
    active: obj.active !== false
  };
}

function calculateCouponDiscount(coupon, subtotal = 0, items = []) {
  const c = normalizeCouponForResponse(coupon);
  const baseSubtotal = parseCouponMoney(subtotal);
  const nowDate = new Date();

  if (!c.code) return { ok: false, error: 'Cupom inválido' };
  if (c.active === false) return { ok: false, error: 'Cupom inativo' };
  if (c.startsAt && new Date(c.startsAt) > nowDate) return { ok: false, error: 'Cupom ainda não está disponível' };
  if (c.endsAt && new Date(c.endsAt) < nowDate) return { ok: false, error: 'Cupom expirado' };
  if (c.usageLimit > 0 && c.usedCount >= c.usageLimit) return { ok: false, error: 'Limite de uso do cupom atingido' };
  if (baseSubtotal <= 0) return { ok: false, error: 'Subtotal inválido para aplicar cupom' };
  if (c.minSubtotal > 0 && baseSubtotal < c.minSubtotal) {
    return { ok: false, error: `Valor mínimo para este cupom é ${formatCurrency(c.minSubtotal)}` };
  }

  const sellerIds = ensureArray(items).map((item) => String(item?.sellerId || item?.seller_id || '').trim()).filter(Boolean);
  if (c.allowedSellerIds?.length && sellerIds.length && !sellerIds.some((id) => c.allowedSellerIds.includes(id))) {
    return { ok: false, error: 'Cupom não disponível para os sellers deste carrinho' };
  }
  if (c.excludedSellerIds?.length && sellerIds.some((id) => c.excludedSellerIds.includes(id))) {
    return { ok: false, error: 'Cupom não disponível para um dos sellers deste carrinho' };
  }

  let discount = 0;
  if (c.type === 'fixed') discount = c.value;
  else discount = baseSubtotal * (c.value / 100);

  if (c.maxDiscount > 0) discount = Math.min(discount, c.maxDiscount);
  discount = Math.max(0, Math.min(baseSubtotal, Math.round(discount * 100) / 100));

  if (discount <= 0) return { ok: false, error: 'Cupom sem desconto aplicável' };

  return {
    ok: true,
    coupon: c,
    subtotal: baseSubtotal,
    discount,
    totalAfterDiscount: Math.max(0, Math.round((baseSubtotal - discount) * 100) / 100)
  };
}



// Lista pública de cupons ativos para exibir na Home.
app.get('/api/coupons/public', async (req, res) => {
  try {
    const nowDate = new Date();
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20) || 20));
    const rows = await Coupon.find({
      active: true,
      $and: [
        { $or: [{ startsAt: null }, { startsAt: { $lte: nowDate } }] },
        { $or: [{ endsAt: null }, { endsAt: { $gte: nowDate } }] },
        { $or: [{ usageLimit: 0 }, { usageLimit: { $exists: false } }, { $expr: { $gt: ['$usageLimit', '$usedCount'] } }] }
      ]
    }).sort({ createdAt: -1 }).limit(limit);

    return res.json({ ok: true, coupons: rows.map(normalizeCouponForResponse) });
  } catch (error) {
    console.error('Erro ao listar cupons públicos:', error);
    return res.status(500).json({ ok: false, error: 'Erro ao listar cupons públicos' });
  }
});

// Rotas públicas para o checkout validar cupom antes de finalizar o pedido.
app.post('/api/coupons/validate', async (req, res) => {
  try {
    const code = normalizeCouponCode(req.body?.code || req.body?.coupon || req.body?.cupom);
    if (!code) return res.status(400).json({ ok: false, error: 'Informe o código do cupom' });

    const coupon = await Coupon.findOne({ code });
    if (!coupon) return res.status(404).json({ ok: false, error: 'Cupom não encontrado' });

    const result = calculateCouponDiscount(coupon, req.body?.subtotal ?? req.body?.total ?? 0, req.body?.items || []);
    if (!result.ok) return res.status(400).json(result);

    return res.json({
      ok: true,
      code: result.coupon.code,
      type: result.coupon.type,
      value: result.coupon.value,
      discount: result.discount,
      subtotal: result.subtotal,
      totalAfterDiscount: result.totalAfterDiscount,
      message: 'Cupom aplicado com sucesso'
    });
  } catch (error) {
    console.error('Erro ao validar cupom:', error);
    return res.status(500).json({ ok: false, error: 'Erro ao validar cupom' });
  }
});

// Atalho compatível com frontends que chamam /api/coupons/apply.
app.post('/api/coupons/apply', async (req, res) => {
  try {
    const code = normalizeCouponCode(req.body?.code || req.body?.coupon || req.body?.cupom);
    if (!code) return res.status(400).json({ ok: false, error: 'Informe o código do cupom' });

    const coupon = await Coupon.findOne({ code });
    if (!coupon) return res.status(404).json({ ok: false, error: 'Cupom não encontrado' });

    const result = calculateCouponDiscount(coupon, req.body?.subtotal ?? req.body?.total ?? 0, req.body?.items || []);
    if (!result.ok) return res.status(400).json(result);

    return res.json({
      ok: true,
      code: result.coupon.code,
      type: result.coupon.type,
      value: result.coupon.value,
      discount: result.discount,
      subtotal: result.subtotal,
      totalAfterDiscount: result.totalAfterDiscount,
      message: 'Cupom aplicado com sucesso'
    });
  } catch (error) {
    console.error('Erro ao aplicar cupom:', error);
    return res.status(500).json({ ok: false, error: 'Erro ao aplicar cupom' });
  }
});

// Rotas administrativas de cupons.
app.get('/api/admin/coupons', adminRequired, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const active = String(req.query.active || '').trim().toLowerCase();
    const filter = {};
    if (q) {
      const regex = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ code: regex }, { title: regex }, { description: regex }];
    }
    if (active === 'true') filter.active = true;
    if (active === 'false') filter.active = false;

    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100) || 100));
    const rows = await Coupon.find(filter).sort({ createdAt: -1 }).limit(limit);
    return res.json({ ok: true, coupons: rows.map(normalizeCouponForResponse) });
  } catch (error) {
    console.error('Erro ao listar cupons:', error);
    return res.status(500).json({ ok: false, error: 'Erro ao listar cupons' });
  }
});

app.post('/api/admin/coupons', adminRequired, async (req, res) => {
  try {
    const payload = couponPayloadFromBody(req.body || {}, req.admin?.email || req.admin?.id || '');
    if (!payload.code) return res.status(400).json({ ok: false, error: 'Informe o código do cupom' });
    if (payload.value <= 0) return res.status(400).json({ ok: false, error: 'Informe um valor de desconto maior que zero' });
    if (payload.type === 'percent' && payload.value > 100) return res.status(400).json({ ok: false, error: 'Cupom percentual não pode passar de 100%' });

    payload.createdBy = payload.updatedBy;
    const coupon = await Coupon.create(payload);
    return res.status(201).json({ ok: true, coupon: normalizeCouponForResponse(coupon) });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ ok: false, error: 'Já existe um cupom com este código' });
    console.error('Erro ao criar cupom:', error);
    return res.status(500).json({ ok: false, error: 'Erro ao criar cupom' });
  }
});

app.get('/api/admin/coupons/:id', adminRequired, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const filter = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { code: normalizeCouponCode(id) };
    const coupon = await Coupon.findOne(filter);
    if (!coupon) return res.status(404).json({ ok: false, error: 'Cupom não encontrado' });
    return res.json({ ok: true, coupon: normalizeCouponForResponse(coupon) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'Erro ao carregar cupom' });
  }
});

app.patch('/api/admin/coupons/:id', adminRequired, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const filter = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { code: normalizeCouponCode(id) };
    const payload = couponPayloadFromBody(req.body || {}, req.admin?.email || req.admin?.id || '');

    if (!payload.code) delete payload.code;
    if (payload.value !== undefined && payload.value <= 0) return res.status(400).json({ ok: false, error: 'Informe um valor de desconto maior que zero' });
    if (payload.type === 'percent' && payload.value > 100) return res.status(400).json({ ok: false, error: 'Cupom percentual não pode passar de 100%' });

    const coupon = await Coupon.findOneAndUpdate(filter, { $set: payload }, { new: true });
    if (!coupon) return res.status(404).json({ ok: false, error: 'Cupom não encontrado' });
    return res.json({ ok: true, coupon: normalizeCouponForResponse(coupon) });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ ok: false, error: 'Já existe um cupom com este código' });
    console.error('Erro ao atualizar cupom:', error);
    return res.status(500).json({ ok: false, error: 'Erro ao atualizar cupom' });
  }
});

app.delete('/api/admin/coupons/:id', adminRequired, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const filter = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { code: normalizeCouponCode(id) };
    const coupon = await Coupon.findOneAndDelete(filter);
    if (!coupon) return res.status(404).json({ ok: false, error: 'Cupom não encontrado' });
    return res.json({ ok: true, deleted: true });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'Erro ao excluir cupom' });
  }
});

app.post('/api/admin/coupons/:id/toggle', adminRequired, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const filter = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { code: normalizeCouponCode(id) };
    const current = await Coupon.findOne(filter);
    if (!current) return res.status(404).json({ ok: false, error: 'Cupom não encontrado' });
    current.active = req.body?.active !== undefined ? req.body.active !== false && String(req.body.active).toLowerCase() !== 'false' : !current.active;
    current.updatedBy = String(req.admin?.email || req.admin?.id || '');
    await current.save();
    return res.json({ ok: true, coupon: normalizeCouponForResponse(current) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'Erro ao alterar status do cupom' });
  }
});

}
