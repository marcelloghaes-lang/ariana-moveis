export function ok(res, data = {}, status = 200) {
  return res.status(status).json({ ok: true, ...data });
}

export function fail(res, status = 500, error = 'Erro interno', extra = {}) {
  return res.status(status).json({ ok: false, error, ...extra });
}

export function cleanString(value = '') {
  return String(value ?? '').trim();
}

export function toNumber(value, fallback = 0) {
  const n = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}
