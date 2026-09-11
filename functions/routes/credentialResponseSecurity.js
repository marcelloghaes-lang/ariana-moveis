// ============================================================
// CREDENCIAIS - MIGRAÇÃO LEGADA E RESPOSTAS SEGURAS
// Senhas antigas em texto puro são migradas somente após autenticação válida.
// Respostas seller/admin nunca devolvem hash, senha temporária ou segredo salvo.
// ============================================================

export default function registerCredentialResponseSecurity(app, context = {}) {
  const { User, Seller, bcrypt } = context;
  if (!app || !User || !bcrypt) throw new Error('[CREDENTIAL SECURITY] app, User e bcrypt são obrigatórios.');

  const forbiddenKeys = new Set([
    'password',
    'senha',
    'passwordhash',
    'password_hash',
    'requestedtemppass',
    'temppassword',
    'temporarypassword',
    'resetpasswordtokenhash',
    'reset_token_hash',
    'privatekey',
    'private_key',
    'clientsecret',
    'client_secret',
    'apisecret',
    'api_secret',
    'apikey',
    'api_key',
    'accesstoken',
    'access_token'
  ]);

  function pathOnly(req = {}) {
    return String(req.path || req.originalUrl || '').split('?')[0].replace(/\/+$/, '');
  }

  function sanitize(value, depth = 0) {
    if (depth > 12 || value === null || value === undefined) return value;
    if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1));
    if (typeof value !== 'object') return value;

    const source = typeof value.toObject === 'function'
      ? value.toObject({ virtuals: true })
      : value;
    const out = {};
    for (const [key, item] of Object.entries(source || {})) {
      if (forbiddenKeys.has(String(key || '').toLowerCase())) continue;
      out[key] = sanitize(item, depth + 1);
    }
    return out;
  }

  function shouldSanitize(path = '') {
    return (
      /^\/api\/seller(?:\/|$)/i.test(path) ||
      /^\/api\/admin\/(?:users|sellers|partners|partner-requests)(?:\/|$)/i.test(path) ||
      path === '/api/admin/login' ||
      path === '/api/admin/me'
    );
  }

  async function migrateUserLegacyPassword(email, password, forceMustChange = false) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const plain = String(password || '');
    if (!normalizedEmail || !plain || !User?.collection) return { migrated: false };

    const raw = await User.collection.findOne({ email: normalizedEmail }).catch(() => null);
    if (!raw) return { migrated: false };

    const legacyPassword = String(raw.password || raw.senha || '');
    const hashLooksPlain = raw.passwordHash && !/^\$2[aby]\$/i.test(String(raw.passwordHash || ''))
      ? String(raw.passwordHash || '')
      : '';
    const matchesLegacy = legacyPassword === plain || hashLooksPlain === plain;
    if (!matchesLegacy) return { migrated: false };

    const passwordHash = await bcrypt.hash(plain, 12);
    const set = { passwordHash, updatedAt: new Date() };
    if (forceMustChange) set.mustChangePassword = true;
    await User.collection.updateOne(
      { _id: raw._id },
      {
        $set: set,
        $unset: { password: '', senha: '' }
      }
    );
    return { migrated: true, userId: String(raw._id) };
  }

  async function migrateSellerTemporaryPassword(email, password) {
    if (!Seller?.collection) return { migrated: false };
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const plain = String(password || '');
    if (!normalizedEmail || !plain) return { migrated: false };

    const seller = await Seller.collection.findOne({
      $or: [
        { email: normalizedEmail },
        { 'metadata.email': normalizedEmail }
      ]
    }).catch(() => null);
    if (!seller) return { migrated: false };

    const metadata = seller.metadata && typeof seller.metadata === 'object' ? seller.metadata : {};
    const temporary = String(metadata.requestedTempPass || metadata.password || metadata.senha || '');
    if (!temporary || temporary !== plain) return { migrated: false };

    let user = null;
    if (seller.userId) user = await User.collection.findOne({ _id: seller.userId }).catch(() => null);
    if (!user) user = await User.collection.findOne({ email: normalizedEmail }).catch(() => null);
    if (!user) return { migrated: false };

    const passwordHash = await bcrypt.hash(plain, 12);
    await User.collection.updateOne(
      { _id: user._id },
      {
        $set: {
          passwordHash,
          mustChangePassword: true,
          updatedAt: new Date()
        },
        $unset: { password: '', senha: '' }
      }
    );
    await Seller.collection.updateOne(
      { _id: seller._id },
      {
        $unset: {
          'metadata.requestedTempPass': '',
          'metadata.password': '',
          'metadata.senha': ''
        },
        $set: { updatedAt: new Date() }
      }
    );
    return { migrated: true, userId: String(user._id), sellerId: String(seller.sellerId || seller._id) };
  }

  app.use((req, res, next) => {
    const path = pathOnly(req);
    const sanitizeResponse = shouldSanitize(path);
    const isSellerLogin = path === '/api/seller/auth/login' && req.method === 'POST';
    const isAdminLogin = path === '/api/admin/login' && req.method === 'POST';

    if (!sanitizeResponse && !isSellerLogin && !isAdminLogin) return next();

    const originalJson = res.json.bind(res);
    let handled = false;
    res.json = function credentialSafeJson(payload) {
      if (handled) return originalJson(sanitizeResponse ? sanitize(payload) : payload);
      handled = true;

      const successful = Number(res.statusCode || 200) >= 200 && Number(res.statusCode || 200) < 300 && payload?.ok !== false;
      if (!successful || (!isSellerLogin && !isAdminLogin)) {
        return originalJson(sanitizeResponse ? sanitize(payload) : payload);
      }

      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || req.body?.senha || '');
      const migration = isSellerLogin
        ? Promise.all([
            migrateUserLegacyPassword(email, password, false),
            migrateSellerTemporaryPassword(email, password)
          ])
        : migrateUserLegacyPassword(email, password, false);

      Promise.resolve(migration)
        .catch((error) => console.error('[CREDENTIAL SECURITY] migração:', error?.message || error))
        .finally(() => originalJson(sanitizeResponse ? sanitize(payload) : payload));
      return res;
    };

    return next();
  });
}
