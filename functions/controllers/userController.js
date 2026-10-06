export function createUserController({ User, toJSON, changedKeys, writeAuditLog }) {
  function me(req, res) {
    return res.json({ ok: true, user: toJSON(req.user) });
  }

  async function updateMe(req, res) {
    try {
      const allowed = ['name', 'cpf', 'phone', 'city', 'uf'];
      const patch = {};
      for (const key of allowed) if (req.body[key] !== undefined) patch[key] = req.body[key];
      const before = toJSON(req.user);
      const after = await User.findByIdAndUpdate(req.user._id, { $set: patch }, { new: true });
      await writeAuditLog({
        scope: 'user_profile',
        eventType: 'user_profile_updated',
        status: 'success',
        changedKeys: changedKeys(before, toJSON(after)),
        metadata: { userId: String(req.user._id) }
      });
      return res.json({ ok: true, user: toJSON(after) });
    } catch (_error) {
      return res.status(500).json({ ok: false, error: 'Erro ao atualizar perfil' });
    }
  }

  return { me, updateMe };
}
