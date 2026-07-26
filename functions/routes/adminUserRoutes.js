// ============================================================
// USUÁRIOS ADMINISTRATIVOS E PERMISSÕES
// Ariana Móveis — módulo isolado de administração de acessos.
// ============================================================


const SUPER_ADMIN_EMAILS = new Set(
  String(process.env.SUPER_ADMIN_EMAILS || process.env.SUPER_ADMIN_EMAIL || process.env.ADMIN_EMAIL || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);
function defaultIsSuperAdminEmail(email) {
  return SUPER_ADMIN_EMAILS.has(String(email || '').trim().toLowerCase());
}

const AVAILABLE_PERMISSIONS = [
  'dashboard:read',
  'atendimentos:read', 'atendimentos:update',
  'products:read', 'products:create', 'products:update', 'products:delete',
  'products:import', 'products:export', 'products:bulk',
  'categories:read', 'categories:create', 'categories:update', 'categories:delete',
  'banners:read', 'banners:create', 'banners:update', 'banners:delete',
  'marketing:read', 'marketing:create', 'marketing:update', 'marketing:delete',
  'coupons:read', 'coupons:create', 'coupons:update', 'coupons:delete',
  'uploads:create', 'posters:generate', 'posters:generate:bulk',
  'orders:read', 'orders:update', 'orders:cancel',
  'customers:read', 'customers:update',
  'sellers:read', 'sellers:approve', 'sellers:update',
  'payments:read', 'payments:receive', 'payments:cancel', 'payments:refund',
  'finance:read', 'finance:export', 'finance:reports',
  'crediario:read', 'crediario:create', 'crediario:update',
  'crediario:receive', 'crediario:renegotiate', 'crediario:cancel', 'crediario:documents',
  'shipping:read', 'shipping:quote', 'shipping:label', 'shipping:dispatch',
  'shipping:cancel', 'shipping:tracking', 'shipping:rodocap',
  'correios:read', 'correios:create', 'carriers:manage',
  'sige:read', 'sige:create', 'sige:update',
  'enterprise:read', 'enterprise:update', 'enterprise:sandbox',
  'enterprise:homologation', 'enterprise:production', 'enterprise:logs',
  'enterprise:credentials', 'enterprise:apikeys', 'enterprise:webhooks',
  'reports:read', 'reports:export',
  'settings:read', 'settings:update'
];

const PERMISSION_PRESETS = {
  admin: ['*'],
  readonly: [
    'dashboard:read', 'atendimentos:read', 'products:read', 'categories:read',
    'banners:read', 'marketing:read', 'coupons:read', 'orders:read',
    'customers:read', 'sellers:read', 'payments:read', 'finance:read',
    'crediario:read', 'shipping:read', 'correios:read', 'sige:read',
    'enterprise:read', 'reports:read', 'settings:read'
  ],
  catalogo: [
    'dashboard:read', 'products:read', 'products:create', 'products:update',
    'products:import', 'products:export', 'products:bulk',
    'categories:read', 'categories:create', 'categories:update',
    'banners:read', 'uploads:create', 'posters:generate', 'posters:generate:bulk'
  ],
  marketing: [
    'dashboard:read', 'products:read', 'banners:read', 'banners:create',
    'banners:update', 'banners:delete', 'marketing:read', 'marketing:create',
    'marketing:update', 'marketing:delete', 'coupons:read', 'coupons:create',
    'coupons:update', 'coupons:delete', 'uploads:create',
    'posters:generate', 'posters:generate:bulk', 'reports:read', 'reports:export'
  ],
  atendimento: [
    'dashboard:read', 'atendimentos:read', 'atendimentos:update',
    'orders:read', 'customers:read', 'customers:update'
  ],
  financeiro: [
    'dashboard:read', 'orders:read', 'payments:read', 'payments:receive',
    'payments:cancel', 'payments:refund', 'finance:read', 'finance:export',
    'finance:reports', 'crediario:read', 'crediario:create', 'crediario:update',
    'crediario:receive', 'crediario:renegotiate', 'crediario:documents',
    'sige:read', 'reports:read', 'reports:export'
  ],
  logistica: [
    'dashboard:read', 'orders:read', 'orders:update', 'shipping:read',
    'shipping:quote', 'shipping:label', 'shipping:dispatch', 'shipping:cancel',
    'shipping:tracking', 'shipping:rodocap', 'correios:read', 'correios:create',
    'carriers:manage'
  ],
  enterprise: [
    'dashboard:read', 'enterprise:read', 'enterprise:update', 'enterprise:sandbox',
    'enterprise:homologation', 'enterprise:production', 'enterprise:logs',
    'enterprise:credentials', 'enterprise:apikeys', 'enterprise:webhooks',
    'sellers:read', 'sellers:approve', 'reports:read', 'reports:export'
  ]
};


const PERMISSION_DEPENDENCIES = {
  'atendimentos:update': ['atendimentos:read'],
  'products:create': ['products:read'], 'products:update': ['products:read'], 'products:delete': ['products:update','products:read'],
  'products:import': ['products:read'], 'products:export': ['products:read'], 'products:bulk': ['products:update','products:read'],
  'categories:create': ['categories:read'], 'categories:update': ['categories:read'], 'categories:delete': ['categories:update','categories:read'],
  'banners:create': ['banners:read'], 'banners:update': ['banners:read'], 'banners:delete': ['banners:update','banners:read'],
  'marketing:create': ['marketing:read'], 'marketing:update': ['marketing:read'], 'marketing:delete': ['marketing:update','marketing:read'],
  'coupons:create': ['coupons:read'], 'coupons:update': ['coupons:read'], 'coupons:delete': ['coupons:update','coupons:read'],
  'posters:generate': ['uploads:create'], 'posters:generate:bulk': ['posters:generate','uploads:create'],
  'orders:update': ['orders:read'], 'orders:cancel': ['orders:update','orders:read'],
  'customers:update': ['customers:read'], 'sellers:approve': ['sellers:read'], 'sellers:update': ['sellers:read'],
  'payments:receive': ['payments:read'], 'payments:cancel': ['payments:read'], 'payments:refund': ['payments:read'],
  'finance:export': ['finance:read'], 'finance:reports': ['finance:read'],
  'crediario:create': ['crediario:read'], 'crediario:update': ['crediario:read'], 'crediario:receive': ['crediario:read'],
  'crediario:renegotiate': ['crediario:update','crediario:read'], 'crediario:cancel': ['crediario:update','crediario:read'], 'crediario:documents': ['crediario:read'],
  'shipping:quote': ['shipping:read'], 'shipping:label': ['shipping:read'], 'shipping:dispatch': ['shipping:read'],
  'shipping:cancel': ['shipping:read'], 'shipping:tracking': ['shipping:read'], 'shipping:rodocap': ['shipping:read'],
  'correios:create': ['correios:read'], 'sige:create': ['sige:read'], 'sige:update': ['sige:read'],
  'enterprise:update': ['enterprise:read'], 'enterprise:sandbox': ['enterprise:read'], 'enterprise:homologation': ['enterprise:read'],
  'enterprise:production': ['enterprise:homologation','enterprise:read'], 'enterprise:logs': ['enterprise:read'],
  'enterprise:credentials': ['enterprise:read'], 'enterprise:apikeys': ['enterprise:read'], 'enterprise:webhooks': ['enterprise:read'],
  'reports:export': ['reports:read'], 'settings:update': ['settings:read']
};

function applyPermissionDependencies(items = []) {
  const result = new Set(items);
  let changed = true;
  while (changed) {
    changed = false;
    for (const permission of [...result]) {
      for (const dependency of PERMISSION_DEPENDENCIES[permission] || []) {
        if (!result.has(dependency)) { result.add(dependency); changed = true; }
      }
    }
  }
  return [...result];
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase() === 'admin' ? 'admin' : 'staff';
}

function normalizePermissions(value, role = 'staff') {
  if (role === 'admin') return ['*'];
  const input = Array.isArray(value) ? value : [];
  const valid = [...new Set(input.map((item) => String(item || '').trim()).filter((item) => AVAILABLE_PERMISSIONS.includes(item)))];
  return applyPermissionDependencies(valid);
}

function publicUser(user, isSuperAdminEmail = defaultIsSuperAdminEmail) {
  const obj = user?.toObject ? user.toObject() : (user || {});
  return {
    id: String(obj._id || obj.id || ''),
    name: obj.name || '',
    email: obj.email || '',
    role: obj.role || 'staff',
    permissions: Array.isArray(obj.permissions) ? obj.permissions : [],
    isActive: obj.isActive !== false,
    mustChangePassword: obj.mustChangePassword === true,
    lastLoginAt: obj.lastLoginAt || null,
    lastLoginIp: obj.lastLoginIp || '',
    lastLoginBrowser: obj.lastLoginBrowser || '',
    lastLoginOs: obj.lastLoginOs || '',
    lastLoginDevice: obj.lastLoginDevice || '',
    lockedUntil: obj.lockedUntil || null,
    allowMultipleSessions: obj.allowMultipleSessions !== false,
    createdAt: obj.createdAt || null,
    updatedAt: obj.updatedAt || null,
    createdBy: obj.createdBy || '',
    updatedBy: obj.updatedBy || '',
    isSuperAdmin: isSuperAdminEmail(obj.email)
  };
}

function currentAdminId(req) {
  return String(req.admin?.id || req.admin?.uid || req.user?._id || req.user?.id || req.auth?.id || '').trim();
}

function currentAdminLabel(req) {
  return String(req.admin?.email || req.user?.email || req.auth?.email || currentAdminId(req) || 'admin');
}

function onlyFullAdmin(req, res, next) {
  const role = String(req.admin?.role || req.auth?.role || '').toLowerCase();
  const isAdmin = role === 'admin' || req.admin?.admin === true || req.auth?.admin === true;
  if (!isAdmin) return res.status(403).json({ ok: false, error: 'Somente administradores podem gerenciar usuários.' });
  next();
}

export default function registerAdminUserRoutes(app, context = {}) {
  const { User, AdminSession, AdminLoginEvent, adminRequired, bcrypt, mongoose } = context;
  const isSuperAdminEmail = context.isSuperAdminEmail || defaultIsSuperAdminEmail;
  if (!app || !User || !adminRequired || !bcrypt) {
    throw new Error('adminUserRoutes: dependências obrigatórias ausentes');
  }

  // Compatibilidade defensiva: em instalações antigas o servidor pode registrar
  // esta rota antes de receber AdminAuditLog pelo contexto. Nesse caso criamos
  // (ou reutilizamos) o model localmente, evitando o erro "undefined.find".
  let AdminAuditLog = context.AdminAuditLog || mongoose?.models?.AdminAuditLog || null;
  if (!AdminAuditLog && mongoose?.Schema && mongoose?.model) {
    const auditSchema = new mongoose.Schema({
      actorId: { type: String, default: '', index: true },
      actorEmail: { type: String, default: '', index: true },
      module: { type: String, default: 'users', index: true },
      action: { type: String, default: 'update', index: true },
      targetUserId: { type: String, default: '', index: true },
      targetUserName: { type: String, default: '', index: true },
      targetUserEmail: { type: String, default: '', index: true },
      summary: { type: String, default: '' },
      addedPermissions: [{ type: String }],
      removedPermissions: [{ type: String }],
      metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
      ip: { type: String, default: '' },
      userAgent: { type: String, default: '' }
    }, { timestamps: true, collection: 'admin_audit_logs' });
    AdminAuditLog = mongoose.models.AdminAuditLog || mongoose.model('AdminAuditLog', auditSchema);
  }

  async function writeAudit(req, data = {}) {
    if (!AdminAuditLog || typeof AdminAuditLog.create !== 'function') return;
    try {
      await AdminAuditLog.create({
        actorId: currentAdminId(req), actorEmail: currentAdminLabel(req), module: 'users',
        action: data.action || 'update', targetUserId: String(data.user?._id || data.user?.id || ''),
        targetUserName: data.user?.name || '', targetUserEmail: data.user?.email || '',
        summary: data.summary || '', addedPermissions: data.addedPermissions || [], removedPermissions: data.removedPermissions || [],
        metadata: data.metadata || {}, ip: String(req.ip || req.headers?.['x-forwarded-for'] || ''),
        userAgent: String(req.headers?.['user-agent'] || '')
      });
    } catch (error) { console.error('[admin-users-audit]', error.message || error); }
  }


  async function resolveSecurityUser(id) {
    if (!mongoose?.isValidObjectId(id)) return null;
    return User.findById(id).select('_id name email role').lean();
  }

  function buildSessionIdentityFilter(user) {
    const userId = String(user?._id || '').trim();
    const email = normalizeEmail(user?.email);
    const identities = [];

    if (userId) identities.push({ userId });
    if (email) identities.push({ email });

    return identities.length > 1 ? { $or: identities } : (identities[0] || { userId: '__invalid__' });
  }

  function withExtraFilter(identityFilter, extra = {}) {
    return identityFilter?.$or
      ? { $and: [identityFilter, extra] }
      : { ...identityFilter, ...extra };
  }

  app.get('/api/admin/users/audit', adminRequired, onlyFullAdmin, async (req, res) => {
    try {
      if (!AdminAuditLog || typeof AdminAuditLog.find !== 'function') {
        return res.json({ ok: true, logs: [], total: 0, warning: 'audit_model_unavailable' });
      }
      const filter = {};
      if (req.query?.action) filter.action = String(req.query.action);
      if (req.query?.user) {
        const escaped = String(req.query.user).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.$or = [{ targetUserName: new RegExp(escaped, 'i') }, { targetUserEmail: new RegExp(escaped, 'i') }, { actorEmail: new RegExp(escaped, 'i') }];
      }
      const limit = Math.min(Math.max(Number(req.query?.limit || 100), 1), 500);
      const logs = await AdminAuditLog.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
      return res.json({ ok: true, logs: Array.isArray(logs) ? logs : [], total: Array.isArray(logs) ? logs.length : 0 });
    } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'admin_audit_list_failed' }); }
  });


  app.get('/api/admin/users/security/summary', adminRequired, onlyFullAdmin, async (_req, res) => {
    try {
      const onlineSince = new Date(Date.now() - 5 * 60 * 1000);
      const [activeSessions, onlineUsers, blockedUsers, lastLogin] = await Promise.all([
        AdminSession ? AdminSession.countDocuments({ active: true, expiresAt: { $gt: new Date() } }) : 0,
        AdminSession ? AdminSession.distinct('userId', { active: true, lastSeenAt: { $gte: onlineSince }, expiresAt: { $gt: new Date() } }) : [],
        User.countDocuments({ role: { $in: ['admin','staff'] }, $or: [{ isActive: false }, { lockedUntil: { $gt: new Date() } }] }),
        AdminLoginEvent ? AdminLoginEvent.findOne({ event: 'login_success', success: true }).sort({ createdAt: -1 }).lean() : null
      ]);
      return res.json({ ok: true, summary: { activeSessions, onlineUsers: Array.isArray(onlineUsers) ? onlineUsers.length : 0, blockedUsers, lastLogin: lastLogin?.createdAt || null } });
    } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'security_summary_failed' }); }
  });

  app.get('/api/admin/users/:id/sessions', adminRequired, onlyFullAdmin, async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      const user = await resolveSecurityUser(id);
      if (!user || !['admin', 'staff'].includes(String(user.role || '').toLowerCase())) {
        return res.status(404).json({ ok: false, error: 'Usuário não encontrado.' });
      }

      const identityFilter = buildSessionIdentityFilter(user);
      const sessions = AdminSession
        ? await AdminSession.find(identityFilter).sort({ active: -1, lastSeenAt: -1, createdAt: -1 }).limit(100).lean()
        : [];
      const events = AdminLoginEvent
        ? await AdminLoginEvent.find(identityFilter).sort({ createdAt: -1 }).limit(100).lean()
        : [];

      return res.json({
        ok: true,
        user: { id: String(user._id), name: user.name || '', email: user.email || '' },
        sessions,
        events
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'admin_sessions_list_failed' });
    }
  });

  app.post('/api/admin/users/:id/sessions/revoke', adminRequired, onlyFullAdmin, async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      const user = await resolveSecurityUser(id);
      if (!user || !['admin', 'staff'].includes(String(user.role || '').toLowerCase())) {
        return res.status(404).json({ ok: false, error: 'Usuário não encontrado.' });
      }

      const keepCurrent = req.body?.keepCurrent === true;
      const currentSessionId = String(req.admin?.sessionId || req.auth?.sessionId || '');
      const extra = { active: true };
      if (keepCurrent && currentSessionId) extra.sessionId = { $ne: currentSessionId };

      const filter = withExtraFilter(buildSessionIdentityFilter(user), extra);
      const result = AdminSession
        ? await AdminSession.updateMany(filter, {
            $set: {
              active: false,
              revokedAt: new Date(),
              revokedBy: currentAdminLabel(req),
              revokeReason: 'admin_revoke_all'
            }
          })
        : { modifiedCount: 0 };

      if (AdminLoginEvent) {
        await AdminLoginEvent.create({
          userId: String(user._id),
          email: user.email || '',
          event: 'sessions_revoked',
          success: true,
          actorEmail: currentAdminLabel(req),
          reason: keepCurrent ? 'keep_current' : 'all'
        }).catch(() => null);
      }

      return res.json({ ok: true, revoked: Number(result.modifiedCount || 0) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'admin_sessions_revoke_failed' });
    }
  });

  app.post('/api/admin/users/:id/sessions/:sessionId/revoke', adminRequired, onlyFullAdmin, async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      const sessionId = String(req.params.sessionId || '').trim();
      const user = await resolveSecurityUser(id);
      if (!user || !['admin', 'staff'].includes(String(user.role || '').toLowerCase())) {
        return res.status(404).json({ ok: false, error: 'Usuário não encontrado.' });
      }
      if (!sessionId) return res.status(400).json({ ok: false, error: 'Sessão inválida.' });

      const filter = withExtraFilter(buildSessionIdentityFilter(user), { sessionId, active: true });
      const result = AdminSession
        ? await AdminSession.updateOne(filter, {
            $set: {
              active: false,
              revokedAt: new Date(),
              revokedBy: currentAdminLabel(req),
              revokeReason: 'admin_revoke'
            }
          })
        : { modifiedCount: 0 };

      if (AdminLoginEvent) {
        await AdminLoginEvent.create({
          userId: String(user._id),
          email: user.email || '',
          event: 'session_revoked',
          success: true,
          sessionId,
          actorEmail: currentAdminLabel(req)
        }).catch(() => null);
      }

      return res.json({ ok: true, revoked: Number(result.modifiedCount || 0) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'admin_session_revoke_failed' });
    }
  });

  app.patch('/api/admin/users/:id/security', adminRequired, onlyFullAdmin, async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      const user = await resolveSecurityUser(id);
      if (!user || !['admin', 'staff'].includes(String(user.role || '').toLowerCase())) {
        return res.status(404).json({ ok: false, error: 'Usuário não encontrado.' });
      }

      const multipleSessionsWasChanged =
        typeof req.body?.allowMultipleSessions === 'boolean' &&
        user.allowMultipleSessions !== req.body.allowMultipleSessions;

      if (typeof req.body?.allowMultipleSessions === 'boolean') {
        user.allowMultipleSessions = req.body.allowMultipleSessions;
      }

      if (req.body?.unlock === true) {
        user.lockedUntil = null;
        user.failedLoginAttempts = 0;
      }

      user.updatedBy = currentAdminLabel(req);
      await user.save();

      let revokedSessions = 0;
      let keptSessionId = '';

      // Ao desativar logins simultâneos, aplica a regra imediatamente:
      // mantém somente a sessão ativa mais recente e encerra as demais.
      if (
        multipleSessionsWasChanged &&
        user.allowMultipleSessions === false &&
        AdminSession
      ) {
        const identityFilter = buildSessionIdentityFilter(user);
        const activeSessions = await AdminSession.find(
          withExtraFilter(identityFilter, { active: true })
        )
          .sort({ lastSeenAt: -1, createdAt: -1 })
          .lean();

        if (activeSessions.length > 0) {
          keptSessionId = String(activeSessions[0].sessionId || '');
          const revokeFilter = withExtraFilter(identityFilter, {
            active: true,
            ...(keptSessionId ? { sessionId: { $ne: keptSessionId } } : {})
          });

          const result = await AdminSession.updateMany(revokeFilter, {
            $set: {
              active: false,
              revokedAt: new Date(),
              revokedBy: currentAdminLabel(req),
              revokeReason: 'simultaneous_login_disabled'
            }
          });

          revokedSessions = Number(result.modifiedCount || 0);

          if (revokedSessions > 0 && AdminLoginEvent) {
            await AdminLoginEvent.create({
              userId: String(user._id),
              email: user.email || '',
              event: 'sessions_revoked',
              success: true,
              sessionId: keptSessionId,
              actorEmail: currentAdminLabel(req),
              reason: 'simultaneous_login_disabled',
              metadata: { revokedSessions, keptSessionId }
            }).catch(() => null);
          }
        }
      }

      await writeAudit(req, {
        action: 'security_updated',
        user,
        summary: `Segurança de ${user.name} atualizada`,
        metadata: {
          allowMultipleSessions: user.allowMultipleSessions,
          unlocked: req.body?.unlock === true,
          revokedSessions,
          keptSessionId
        }
      });

      return res.json({
        ok: true,
        user: publicUser(user, isSuperAdminEmail),
        revokedSessions,
        keptSessionId
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error.message || 'admin_user_security_failed'
      });
    }
  });

  app.get('/api/admin/users/permissions', adminRequired, onlyFullAdmin, (_req, res) => {
    return res.json({ ok: true, permissions: AVAILABLE_PERMISSIONS, presets: PERMISSION_PRESETS });
  });

  app.get('/api/admin/users', adminRequired, onlyFullAdmin, async (req, res) => {
    try {
      const query = String(req.query?.q || '').trim();
      const filter = { role: { $in: ['admin', 'staff'] } };
      if (query) {
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.$or = [{ name: new RegExp(escaped, 'i') }, { email: new RegExp(escaped, 'i') }];
      }
      const users = await User.find(filter).sort({ role: 1, name: 1, createdAt: -1 });
      return res.json({ ok: true, users: users.map((user) => publicUser(user, isSuperAdminEmail)), currentUserId: currentAdminId(req) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'admin_users_list_failed' });
    }
  });

  app.post('/api/admin/users', adminRequired, onlyFullAdmin, async (req, res) => {
    try {
      const name = String(req.body?.name || '').trim();
      const email = normalizeEmail(req.body?.email);
      const password = String(req.body?.password || '');
      const role = normalizeRole(req.body?.role);
      const isActive = req.body?.isActive !== false;
      const mustChangePassword = req.body?.mustChangePassword !== false;
      const permissions = normalizePermissions(req.body?.permissions, role);

      if (name.length < 2) return res.status(400).json({ ok: false, error: 'Informe o nome do usuário.' });
      if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ ok: false, error: 'Informe um e-mail válido.' });
      if (password.length < 8) return res.status(400).json({ ok: false, error: 'A senha precisa ter pelo menos 8 caracteres.' });

      const exists = await User.findOne({ email });
      if (exists) return res.status(409).json({ ok: false, error: 'Já existe um usuário com este e-mail.' });

      const actor = currentAdminLabel(req);
      const passwordHash = await bcrypt.hash(password, 12);
      const user = await User.create({
        name, email, passwordHash, role, permissions, isActive,
        mustChangePassword, createdBy: actor, updatedBy: actor,
        authProvider: 'password', emailVerified: true
      });
      await writeAudit(req, { action: 'user_created', user, summary: `Usuário ${user.name} criado`, addedPermissions: user.permissions || [], metadata: { role: user.role, isActive: user.isActive } });
      return res.status(201).json({ ok: true, user: publicUser(user, isSuperAdminEmail) });
    } catch (error) {
      if (error?.code === 11000) return res.status(409).json({ ok: false, error: 'E-mail já cadastrado.' });
      return res.status(500).json({ ok: false, error: error.message || 'admin_user_create_failed' });
    }
  });

  app.put('/api/admin/users/:id', adminRequired, onlyFullAdmin, async (req, res) => {
    try {
      const id = String(req.params.id || '');
      if (!mongoose?.isValidObjectId(id)) return res.status(400).json({ ok: false, error: 'Usuário inválido.' });
      const user = await User.findById(id);
      if (!user || !['admin', 'staff'].includes(String(user.role))) return res.status(404).json({ ok: false, error: 'Usuário não encontrado.' });

      const previousPermissions = Array.isArray(user.permissions) ? [...user.permissions] : [];
      const previousRole = user.role;
      const name = String(req.body?.name ?? user.name ?? '').trim();
      const email = normalizeEmail(req.body?.email ?? user.email);
      const role = normalizeRole(req.body?.role ?? user.role);
      if (name.length < 2) return res.status(400).json({ ok: false, error: 'Informe o nome do usuário.' });
      if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ ok: false, error: 'Informe um e-mail válido.' });

      const emailOwner = await User.findOne({ email, _id: { $ne: user._id } });
      if (emailOwner) return res.status(409).json({ ok: false, error: 'Este e-mail já está em uso.' });

      if (String(user._id) === currentAdminId(req) && role !== 'admin') {
        return res.status(409).json({ ok: false, error: 'Você não pode remover seu próprio perfil de administrador.' });
      }
      const targetIsSuperAdmin = isSuperAdminEmail(user.email);
      const actorIsSuperAdmin = req.admin?.isSuperAdmin === true || isSuperAdminEmail(currentAdminLabel(req));
      if (targetIsSuperAdmin && !actorIsSuperAdmin) {
        return res.status(403).json({ ok: false, error: 'Somente o superadministrador pode alterar a conta mestre.' });
      }
      if (targetIsSuperAdmin && (role !== 'admin' || email !== normalizeEmail(user.email))) {
        return res.status(409).json({ ok: false, error: 'A conta mestre não pode perder o perfil de administrador nem ter o e-mail alterado por este painel.' });
      }

      user.name = name;
      user.email = email;
      user.role = role;
      user.permissions = normalizePermissions(req.body?.permissions ?? user.permissions, role);
      user.updatedBy = currentAdminLabel(req);
      await user.save();
      const addedPermissions = (user.permissions || []).filter((item) => !previousPermissions.includes(item));
      const removedPermissions = previousPermissions.filter((item) => !(user.permissions || []).includes(item));
      await writeAudit(req, { action: 'user_updated', user, summary: `Usuário ${user.name} atualizado`, addedPermissions, removedPermissions, metadata: { previousRole, role: user.role } });
      return res.json({ ok: true, user: publicUser(user, isSuperAdminEmail) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'admin_user_update_failed' });
    }
  });

  app.patch('/api/admin/users/:id/status', adminRequired, onlyFullAdmin, async (req, res) => {
    try {
      const id = String(req.params.id || '');
      if (!mongoose?.isValidObjectId(id)) return res.status(400).json({ ok: false, error: 'Usuário inválido.' });
      const user = await User.findById(id);
      if (!user || !['admin', 'staff'].includes(String(user.role))) return res.status(404).json({ ok: false, error: 'Usuário não encontrado.' });
      const isActive = req.body?.isActive === true;
      if (isSuperAdminEmail(user.email) && !isActive) {
        return res.status(409).json({ ok: false, error: 'A conta mestre não pode ser bloqueada.' });
      }
      if (String(user._id) === currentAdminId(req) && !isActive) {
        return res.status(409).json({ ok: false, error: 'Você não pode bloquear sua própria conta.' });
      }
      if (user.role === 'admin' && !isActive) {
        const activeAdmins = await User.countDocuments({ role: 'admin', isActive: { $ne: false } });
        if (activeAdmins <= 1) return res.status(409).json({ ok: false, error: 'Não é possível bloquear o último administrador ativo.' });
      }
      user.isActive = isActive;
      user.updatedBy = currentAdminLabel(req);
      await user.save();
      await writeAudit(req, { action: isActive ? 'user_activated' : 'user_blocked', user, summary: `Usuário ${user.name} ${isActive ? 'ativado' : 'bloqueado'}`, metadata: { isActive } });
      return res.json({ ok: true, user: publicUser(user, isSuperAdminEmail) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'admin_user_status_failed' });
    }
  });

  app.patch('/api/admin/users/:id/password', adminRequired, onlyFullAdmin, async (req, res) => {
    try {
      const id = String(req.params.id || '');
      const password = String(req.body?.password || '');
      if (!mongoose?.isValidObjectId(id)) return res.status(400).json({ ok: false, error: 'Usuário inválido.' });
      if (password.length < 8) return res.status(400).json({ ok: false, error: 'A senha precisa ter pelo menos 8 caracteres.' });
      const user = await User.findById(id);
      if (!user || !['admin', 'staff'].includes(String(user.role))) return res.status(404).json({ ok: false, error: 'Usuário não encontrado.' });
      user.passwordHash = await bcrypt.hash(password, 12);
      user.password = undefined;
      user.senha = undefined;
      user.mustChangePassword = req.body?.mustChangePassword !== false;
      const revokeSessions = req.body?.revokeSessions !== false;
      if (revokeSessions) user.tokenVersion = Number(user.tokenVersion || 0) + 1;
      user.updatedBy = currentAdminLabel(req);
      await user.save();
      if (revokeSessions && AdminSession) await AdminSession.updateMany({ userId: String(user._id), active: true }, { $set: { active: false, revokedAt: new Date(), revokedBy: currentAdminLabel(req), revokeReason: 'password_reset' } });
      if (AdminLoginEvent) await AdminLoginEvent.create({ userId: String(user._id), email: user.email || '', event: 'password_reset', success: true, actorEmail: currentAdminLabel(req), reason: revokeSessions ? 'sessions_revoked' : 'sessions_kept' }).catch(() => null);
      await writeAudit(req, { action: 'password_reset', user, summary: `Senha provisória redefinida para ${user.name}`, metadata: { mustChangePassword: user.mustChangePassword, revokeSessions } });
      return res.json({ ok: true, message: 'Senha redefinida com sucesso.', user: publicUser(user, isSuperAdminEmail) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'admin_user_password_failed' });
    }
  });

  app.delete('/api/admin/users/:id', adminRequired, onlyFullAdmin, async (req, res) => {
    try {
      const id = String(req.params.id || '');
      if (!mongoose?.isValidObjectId(id)) return res.status(400).json({ ok: false, error: 'Usuário inválido.' });
      if (id === currentAdminId(req)) return res.status(409).json({ ok: false, error: 'Você não pode excluir sua própria conta.' });
      const user = await User.findById(id);
      if (!user || !['admin', 'staff'].includes(String(user.role))) return res.status(404).json({ ok: false, error: 'Usuário não encontrado.' });
      if (isSuperAdminEmail(user.email)) return res.status(409).json({ ok: false, error: 'A conta mestre não pode ser excluída.' });
      if (user.role === 'admin') {
        const activeAdmins = await User.countDocuments({ role: 'admin', isActive: { $ne: false } });
        if (user.isActive !== false && activeAdmins <= 1) return res.status(409).json({ ok: false, error: 'Não é possível excluir o último administrador ativo.' });
      }
      await writeAudit(req, { action: 'user_deleted', user, summary: `Usuário ${user.name} excluído`, removedPermissions: user.permissions || [], metadata: { role: user.role } });
      if (AdminSession) await AdminSession.updateMany({ userId: String(user._id), active: true }, { $set: { active: false, revokedAt: new Date(), revokedBy: currentAdminLabel(req), revokeReason: 'user_deleted' } });
      await User.deleteOne({ _id: user._id });
      return res.json({ ok: true, message: 'Usuário excluído.' });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'admin_user_delete_failed' });
    }
  });
}

export { AVAILABLE_PERMISSIONS, PERMISSION_PRESETS, PERMISSION_DEPENDENCIES };
