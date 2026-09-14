const FISCAL_PERMISSION = 'fiscal:nfe:emit';

function currentIdentity(req = {}) {
  return req.adminUser || req.admin || req.auth || req.user || {};
}

function isFullAdmin(req = {}) {
  const user = currentIdentity(req);
  const role = String(user.role || '').trim().toLowerCase();
  return role === 'admin' || user.admin === true || user.isSuperAdmin === true;
}

export default function registerAdminFiscalPermissionRoutes(app, context = {}) {
  const { User, adminRequired, mongoose } = context;
  if (!app || !User || !adminRequired) {
    throw new Error('adminFiscalPermissionRoutes: dependencias obrigatorias ausentes');
  }

  app.patch('/api/admin/users/:id/fiscal-permission', adminRequired, async (req, res) => {
    try {
      if (!isFullAdmin(req)) {
        return res.status(403).json({ ok: false, error: 'Somente administradores podem alterar permissoes fiscais.' });
      }

      const id = String(req.params.id || '').trim();
      if (mongoose?.isValidObjectId && !mongoose.isValidObjectId(id)) {
        return res.status(400).json({ ok: false, error: 'Usuario invalido.' });
      }

      const user = await User.findById(id);
      if (!user || !['admin', 'staff'].includes(String(user.role || '').toLowerCase())) {
        return res.status(404).json({ ok: false, error: 'Usuario nao encontrado.' });
      }

      const enabled = req.body?.enabled === true;
      const permissions = new Set(Array.isArray(user.permissions) ? user.permissions : []);
      if (enabled) permissions.add(FISCAL_PERMISSION);
      else permissions.delete(FISCAL_PERMISSION);

      user.permissions = [...permissions];
      user.updatedBy = String(currentIdentity(req).email || currentIdentity(req).id || 'admin');
      await user.save();

      return res.json({
        ok: true,
        enabled,
        permission: FISCAL_PERMISSION,
        userId: String(user._id || user.id || '')
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error?.message || 'Falha ao atualizar permissao fiscal.'
      });
    }
  });
}

export { FISCAL_PERMISSION };
