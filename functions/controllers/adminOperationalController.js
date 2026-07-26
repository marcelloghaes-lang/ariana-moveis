// ============================================================
// CONTROLLER OPERACIONAL ADMIN - ETAPA 20
// Extraído de routes/legacyRuntimeRoutes.js.
// Objetivo: começar a retirar lógica operacional do arquivo de rotas,
// preservando as mesmas funções usadas pelos módulos já separados.
// ============================================================

export default function createAdminOperationalController(context = {}) {
  const {
    IntegrationAuditLog,
    OperationalAlert,
    ManufacturerDispatchQueue,
    Order,
    sanitizeIdPart,
    redact,
    now
  } = context;

  const BUILD_ID = 'enterprise-mongo-2026-04-02';

  async function writeAuditLog(entry = {}) {
    return IntegrationAuditLog.create({
      scope: entry.scope || 'integration',
      eventType: entry.eventType || 'unspecified',
      orderId: entry.orderId ? String(entry.orderId) : null,
      manufacturer: entry.manufacturer ? String(entry.manufacturer) : null,
      integrationId: entry.integrationId ? String(entry.integrationId) : null,
      queueId: entry.queueId ? String(entry.queueId) : null,
      status: entry.status || null,
      statusCode: Number.isFinite(Number(entry.statusCode)) ? Number(entry.statusCode) : null,
      message: entry.message || null,
      changedKeys: Array.isArray(entry.changedKeys) ? entry.changedKeys.slice(0, 200) : [],
      request: redact(entry.request || null),
      response: redact(entry.response || null),
      metadata: redact(entry.metadata || null),
      buildId: BUILD_ID
    });
  }

  async function upsertOperationalAlert(data = {}) {
    const manufacturer = data.manufacturer ? String(data.manufacturer) : 'global';
    const type = data.type ? String(data.type) : 'generic';
    const entityKey = data.entityKey ? String(data.entityKey) : `${manufacturer}_${type}`;
    const alertId = `${sanitizeIdPart(type)}__${sanitizeIdPart(entityKey)}`;
    const existing = await OperationalAlert.findOne({ alertId });

    if (!existing) {
      return OperationalAlert.create({
        alertId,
        type,
        severity: data.severity || 'medium',
        status: data.status || 'open',
        title: data.title || 'Alerta operacional',
        message: data.message || null,
        manufacturer: data.manufacturer || null,
        orderId: data.orderId || null,
        queueId: data.queueId || null,
        entityKey,
        count: 1,
        metadata: redact(data.metadata || null),
        buildId: BUILD_ID,
        firstSeenAt: now(),
        lastSeenAt: now(),
        resolvedAt: data.status === 'resolved' ? now() : null
      });
    }

    existing.count = Number(existing.count || 1) + 1;
    existing.severity = data.severity || existing.severity;
    existing.status = data.status || 'open';
    existing.title = data.title || existing.title;
    existing.message = data.message || existing.message;
    existing.manufacturer = data.manufacturer || existing.manufacturer;
    existing.orderId = data.orderId || existing.orderId;
    existing.queueId = data.queueId || existing.queueId;
    existing.metadata = redact(data.metadata || existing.metadata || null);
    existing.lastSeenAt = now();
    existing.buildId = BUILD_ID;
    if (existing.status === 'resolved') existing.resolvedAt = now();
    await existing.save();
    return existing;
  }

  async function resolveOperationalAlert(type, entityKey) {
    const alertId = `${sanitizeIdPart(type)}__${sanitizeIdPart(entityKey)}`;
    await OperationalAlert.findOneAndUpdate(
      { alertId },
      { $set: { status: 'resolved', resolvedAt: now(), lastSeenAt: now(), buildId: BUILD_ID } }
    );
  }

  async function scanOperationalAlerts() {
    const findings = [];

    const queueRows = await ManufacturerDispatchQueue.find().sort({ updatedAt: -1 }).limit(200);
    for (const row of queueRows) {
      const status = String(row.status || '').toLowerCase();
      const attempts = Number(row.attempts || 0);

      if (status === 'dead_letter') {
        findings.push(await upsertOperationalAlert({
          type: 'dispatch_dead_letter',
          severity: 'critical',
          manufacturer: row.manufacturer,
          orderId: row.orderId,
          queueId: row.queueId,
          entityKey: row.queueId,
          title: 'Pedido caiu em dead letter',
          message: `O pedido ${row.orderId || row.queueId} esgotou as tentativas de envio ao fabricante.`,
          metadata: row.toObject()
        }));
        continue;
      }

      if (['pending', 'retrying', 'retry_processing'].includes(status) && attempts >= 3) {
        findings.push(await upsertOperationalAlert({
          type: 'dispatch_retry_pressure',
          severity: attempts >= 5 ? 'high' : 'medium',
          manufacturer: row.manufacturer,
          orderId: row.orderId,
          queueId: row.queueId,
          entityKey: row.queueId,
          title: 'Fila de reenvio com muitas tentativas',
          message: `O pedido ${row.orderId || row.queueId} já acumula ${attempts} tentativas de envio ao fabricante.`,
          metadata: row.toObject()
        }));
      }
    }

    const orders = await Order.find().sort({ updatedAt: -1 }).limit(200);
    for (const row of orders) {
      const integ = String(row.status_integracao || '').toLowerCase();
      const dispatchStatus = String(row.manufacturerDispatch?.status || '').toLowerCase();
      const manufacturer = row.manufacturer || row.sellerIds?.[0] || null;

      if (['erro_envio_fabricante', 'fila_erro_fabricante'].includes(integ) || dispatchStatus === 'error') {
        findings.push(await upsertOperationalAlert({
          type: 'order_dispatch_error',
          severity: 'high',
          manufacturer,
          orderId: String(row._id),
          queueId: row.manufacturerDispatch?.queueId || null,
          entityKey: String(row._id),
          title: 'Pedido com erro de integração',
          message: `O pedido ${row._id} está com falha no envio ao fabricante.`,
          metadata: {
            status_integracao: row.status_integracao || null,
            manufacturerDispatch: row.manufacturerDispatch || null
          }
        }));
      }
    }

    const since = new Date(Date.now() - (6 * 60 * 60 * 1000));
    const recentLogs = await IntegrationAuditLog.find({ createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(300);
    const stats = {};

    for (const log of recentLogs) {
      const manufacturer = String(log.manufacturer || 'global');
      if (!stats[manufacturer]) stats[manufacturer] = { errors: 0, success: 0 };
      if (log.eventType === 'manufacturer_dispatch_http') {
        if (String(log.status || '').toLowerCase() === 'success' || (Number(log.statusCode) >= 200 && Number(log.statusCode) < 300)) {
          stats[manufacturer].success += 1;
        } else {
          stats[manufacturer].errors += 1;
        }
      }
    }

    for (const [manufacturer, stat] of Object.entries(stats)) {
      if (stat.errors >= 3 && stat.success === 0) {
        findings.push(await upsertOperationalAlert({
          type: 'manufacturer_outage',
          severity: stat.errors >= 5 ? 'critical' : 'high',
          manufacturer,
          entityKey: manufacturer,
          title: 'Possível indisponibilidade do fabricante',
          message: `Foram detectadas ${stat.errors} falhas recentes sem sucesso para ${manufacturer}.`,
          metadata: stat
        }));
      }
    }

    return findings;
  }

  return {
    BUILD_ID,
    writeAuditLog,
    upsertOperationalAlert,
    resolveOperationalAlert,
    scanOperationalAlerts
  };
}
