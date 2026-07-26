// ============================================================
// ROTAS DE STATUS DE PEDIDOS
// Extraído de legacyRoutes.js na Etapa 17.
// Objetivo: reduzir legacyRoutes.js sem alterar endpoint, regra ou resposta.
// ============================================================

export default function registerOrderStatusRoutes(app, context = {}) {
  const {
    Order,
    authRequired,
    normalizeObjectId,
    toJSON,
    changedKeys,
    writeAuditLog,
    createAdminNotification,
    createSellerOrderNotifications,
    waMaybeNotifyOrderStatusChange,
    waNotifyAdminOrderStatusChange
  } = context;

app.patch('/api/orders/:id/status', authRequired, async (req, res) => {
  try {
    const oid = normalizeObjectId(req.params.id);
    if (!oid) return res.status(400).json({ ok: false, error: 'ID inválido' });

    const before = await Order.findById(oid);
    if (!before) return res.status(404).json({ ok: false, error: 'Pedido não encontrado' });

    const previousStatus = String(before.status || '');
    const patch = {
      status: req.body?.status || before.status,
      statusLabel: req.body?.statusLabel || req.body?.status || before.statusLabel,
      trackingCode: req.body?.trackingCode !== undefined ? req.body.trackingCode : before.trackingCode
    };

    const after = await Order.findByIdAndUpdate(oid, { $set: patch }, { new: true });

    await writeAuditLog({
      scope: 'orders',
      eventType: 'order_status_updated',
      orderId: String(after._id),
      status: 'success',
      changedKeys: changedKeys(toJSON(before), toJSON(after)),
      metadata: { actorUserId: String(req.user._id) }
    });

    if (String(after.status || '') !== previousStatus || String(after.trackingCode || '') !== String(before.trackingCode || '')) {
      await createAdminNotification({
        type: 'order_updated',
        title: '📦 Pedido atualizado',
        message: `Pedido ${after._id} mudou para ${after.statusLabel || after.status || 'Atualizado'}${after.trackingCode ? ` - Rastreio: ${after.trackingCode}` : ''}`,
        relatedId: String(after._id),
        severity: 'info'
      });
      await createSellerOrderNotifications(after, {
        type: 'seller_order_updated',
        title: '📦 Pedido atualizado',
        message: `Pedido #${String(after._id).slice(-8).toUpperCase()} mudou para ${after.statusLabel || after.status || 'Atualizado'}${after.trackingCode ? ` - Rastreio: ${after.trackingCode}` : ''}`,
        severity: 'info',
        origin: 'status_route'
      });
    }

    const notifyResult = await waMaybeNotifyOrderStatusChange(String(after._id), toJSON(before), toJSON(after), 'status_route');
    const adminWhatsapp = await waNotifyAdminOrderStatusChange(String(after._id), toJSON(before), toJSON(after), 'status_route_admin');
    return res.json({ ok: true, order: toJSON(after), whatsapp: notifyResult, adminWhatsapp });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao atualizar status do pedido' });
  }
});
}
