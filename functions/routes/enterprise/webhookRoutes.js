import dns from 'dns';
import net from 'net';

// ============================================================
// ENTERPRISE WEBHOOK ROUTES - ARIANA MÓVEIS
// Extraído de routes/enterpriseRoutes.js sem alterar endpoints, regras ou respostas.
// ============================================================

export default function registerEnterpriseWebhookRoutes(app, context = {}) {
  const {
    Setting,
    IntegrationAuditLog,
    EnterpriseHomologationRequestCompat,
    axios,
    crypto,
    mongoose,
    enterpriseCompatAuth,
    enterprisePartnerRequired,
    enterprisePartnerLogQuery,
    enterprisePartnerLogStatusCode,
    sanitizeIdPart,
    redact
  } = context;

const enterpriseWebhookDeliverySchema = new mongoose.Schema({
  deliveryId: { type: String, required: true, unique: true, index: true },
  partnerObjectId: { type: String, default: '', index: true },
  requestId: { type: String, default: '', index: true },
  manufacturer: { type: String, default: '', index: true },
  environment: { type: String, default: 'sandbox', index: true },
  event: { type: String, required: true, index: true },
  payload: mongoose.Schema.Types.Mixed,
  status: { type: String, default: 'retrying', index: true },
  attempts: { type: Number, default: 1 },
  maxAttempts: { type: Number, default: 6 },
  nextAttemptAt: { type: Date, default: null, index: true },
  lastAttemptAt: { type: Date, default: null },
  deliveredAt: { type: Date, default: null },
  lastStatusCode: { type: Number, default: 0 },
  lastError: { type: String, default: '' },
  lastResponse: mongoose.Schema.Types.Mixed,
  lockedAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });

const EnterpriseWebhookDelivery =
  mongoose.models.EnterpriseWebhookDelivery ||
  mongoose.model('EnterpriseWebhookDelivery', enterpriseWebhookDeliverySchema, 'enterprise_webhook_deliveries');

function enterpriseWebhookBackoffMs(attempt = 1) {
  const schedule = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 60 * 60_000, 6 * 60 * 60_000];
  return schedule[Math.min(Math.max(Number(attempt || 1) - 1, 0), schedule.length - 1)];
}

app.post('/api/enterprise/webhooks/test', enterpriseCompatAuth, async (req, res) => {
  try {
    const event = String(req.body?.event || req.body?.type || 'webhook_test').trim();
    const manufacturer = String(req.body?.manufacturer || req.enterprisePartner?.requestId || 'enterprise').trim();

    await IntegrationAuditLog.create({
      scope: 'enterprise',
      eventType: event,
      manufacturer,
      status: 'success',
      statusCode: 200,
      message: 'Webhook de teste recebido pelo API Explorer',
      request: redact(req.body),
      response: { ok: true, event, manufacturer },
      metadata: {
        source: 'api_explorer',
        environment: req.enterprisePartner?.environment || 'sandbox',
        companyName: req.enterprisePartner?.companyName || '',
        tradeName: req.enterprisePartner?.tradeName || ''
      }
    }).catch(() => null);

    return res.json({
      ok: true,
      event,
      manufacturer,
      status: 'received',
      message: 'Webhook de teste recebido com sucesso'
    });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message || 'Erro ao receber webhook de teste' });
  }
});




const ENTERPRISE_WEBHOOK_EVENTS = [
  'order_created',
  'payment_approved',
  'invoice_received',
  'tracking_updated',
  'order_cancelled'
];


function enterpriseWebhookPrivateAddress(address = '') {
  const value = String(address || '').toLowerCase().split('%')[0];
  const version = net.isIP(value);

  if (version === 4) {
    const [a, b] = value.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }

  if (version === 6) {
    if (value === '::' || value === '::1') return true;
    if (value.startsWith('fc') || value.startsWith('fd') || /^fe[89ab]/.test(value)) return true;
    if (value.startsWith('::ffff:')) return enterpriseWebhookPrivateAddress(value.slice(7));
  }

  return false;
}

async function enterpriseValidateWebhookUrl(rawUrl = '', partner = {}) {
  const value = String(rawUrl || '').trim();
  if (!value) return '';

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    const err = new Error('URL do webhook inválida');
    err.statusCode = 400;
    throw err;
  }

  const environment = String(partner.environment || 'sandbox').toLowerCase();
  const allowHttp = environment !== 'production' &&
    String(process.env.ENTERPRISE_ALLOW_HTTP_WEBHOOKS || 'false').toLowerCase() === 'true';

  if (parsed.protocol !== 'https:' && !(allowHttp && parsed.protocol === 'http:')) {
    const err = new Error('Webhook deve usar HTTPS');
    err.statusCode = 400;
    throw err;
  }

  if (parsed.username || parsed.password) {
    const err = new Error('URL de webhook não pode conter usuário ou senha');
    err.statusCode = 400;
    throw err;
  }

  const hostname = String(parsed.hostname || '').toLowerCase().replace(/\.$/, '');
  const blockedHost = (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname === 'host.docker.internal' ||
    hostname === 'kubernetes.default' ||
    hostname === 'metadata' ||
    hostname === 'metadata.google.internal'
  );

  if (!hostname || blockedHost || enterpriseWebhookPrivateAddress(hostname)) {
    const err = new Error('Destino de webhook não permitido');
    err.statusCode = 400;
    throw err;
  }

  try {
    const addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((entry) => enterpriseWebhookPrivateAddress(entry.address))) {
      const err = new Error('Destino de webhook resolve para rede privada ou reservada');
      err.statusCode = 400;
      throw err;
    }
  } catch (error) {
    if (error.statusCode) throw error;
    const err = new Error('Não foi possível validar o domínio do webhook');
    err.statusCode = 400;
    throw err;
  }

  return parsed.toString();
}

function enterprisePartnerWebhookSettingKey(partner = {}) {
  return `enterprise_webhooks_${sanitizeIdPart(partner.requestId || partner.partnerId || partner.companyName || 'partner')}`;
}

function enterprisePartnerWebhookMaskSecret(secret = '') {
  secret = String(secret || '');
  if (!secret) return '';
  if (secret.length <= 10) return `${secret.slice(0, 4)}••••`;
  return `${secret.slice(0, 8)}••••••${secret.slice(-6)}`;
}

async function enterprisePartnerGetWebhookConfig(partner = {}) {
  const key = enterprisePartnerWebhookSettingKey(partner);
  const doc = await Setting.findOne({ key }).lean().catch(() => null);
  const value = doc?.value || {};
  return {
    key,
    active: value.active === true,
    url: String(value.url || '').trim(),
    secret: String(value.secret || '').trim(),
    secretMasked: enterprisePartnerWebhookMaskSecret(value.secret || ''),
    events: Array.isArray(value.events) && value.events.length ? value.events : ENTERPRISE_WEBHOOK_EVENTS,
    lastTestAt: value.lastTestAt || null,
    lastStatusCode: value.lastStatusCode || null,
    updatedAt: doc?.updatedAt || null
  };
}

async function enterprisePartnerSaveWebhookConfig(partner = {}, payload = {}) {
  const current = await enterprisePartnerGetWebhookConfig(partner);
  const incomingSecret = String(payload.secret || '').trim();
  const events = Array.isArray(payload.events)
    ? payload.events.filter((event) => ENTERPRISE_WEBHOOK_EVENTS.includes(String(event)))
    : current.events;

  const value = {
    active: payload.active === true || String(payload.active).toLowerCase() === 'true',
    url: String(payload.url || '').trim(),
    secret: incomingSecret || current.secret || `whsec_${crypto.randomBytes(24).toString('hex')}`,
    events: events.length ? events : ENTERPRISE_WEBHOOK_EVENTS,
    updatedAt: new Date(),
    updatedBy: partner.requestId || partner.companyName || 'partner',
    lastTestAt: current.lastTestAt || null,
    lastStatusCode: current.lastStatusCode || null
  };

  if (value.url) {
    value.url = await enterpriseValidateWebhookUrl(value.url, partner);
  }

  await Setting.findOneAndUpdate(
    { key: current.key },
    { $set: { key: current.key, value, updatedBy: partner.requestId || partner.companyName || 'partner' } },
    { upsert: true, new: true }
  );

  return { ...value, secretMasked: enterprisePartnerWebhookMaskSecret(value.secret) };
}

function enterprisePartnerBuildWebhookPayload(partner = {}, event = 'order_created', extra = {}, forcedDeliveryId = '') {
  const nowIso = new Date().toISOString();
  return {
    id: forcedDeliveryId || `evt_${crypto.randomBytes(10).toString('hex')}`,
    event,
    createdAt: nowIso,
    environment: partner.environment || 'sandbox',
    manufacturer: partner.requestId || partner.tradeName || partner.companyName || 'enterprise',
    data: {
      externalOrderId: extra.externalOrderId || `ARI-WH-${Date.now()}`,
      orderId: extra.orderId || `ARI-WH-${Date.now()}`,
      status: extra.status || 'webhook_test',
      message: extra.message || 'Evento de teste enviado pela Ariana Enterprise',
      total: Number(extra.total || 1000)
    }
  };
}

function enterprisePartnerSignWebhook(secret = '', rawBody = '') {
  if (!secret) return '';
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

function enterprisePartnerSignWebhookV2(secret = '', timestamp = '', deliveryId = '', rawBody = '') {
  if (!secret) return '';
  const canonical = `${timestamp}.${deliveryId}.${rawBody}`;
  return crypto.createHmac('sha256', secret).update(canonical).digest('hex');
}

async function enterpriseQueueWebhookRetry(partner = {}, event = '', payload = {}, result = {}) {
  const deliveryId = String(payload?.id || result?.deliveryId || '').trim();
  if (!deliveryId) return null;
  const attempts = Math.max(1, Number(result?.attempt || 1));
  const maxAttempts = Math.max(2, Number(process.env.ENTERPRISE_WEBHOOK_MAX_ATTEMPTS || 6));
  const nextAttemptAt = attempts >= maxAttempts ? null : new Date(Date.now() + enterpriseWebhookBackoffMs(attempts));
  const status = attempts >= maxAttempts ? 'dead_letter' : 'retrying';

  return EnterpriseWebhookDelivery.findOneAndUpdate(
    { deliveryId },
    {
      $setOnInsert: {
        deliveryId,
        partnerObjectId: String(partner?.id || partner?._id || ''),
        requestId: String(partner?.requestId || ''),
        manufacturer: String(partner?.companyName || partner?.tradeName || partner?.requestId || 'enterprise'),
        environment: String(partner?.environment || 'sandbox'),
        event,
        payload
      },
      $set: {
        status,
        attempts,
        maxAttempts,
        nextAttemptAt,
        lastAttemptAt: new Date(),
        lastStatusCode: Number(result?.statusCode || 0),
        lastError: String(result?.message || 'Falha ao entregar webhook'),
        lastResponse: redact(result?.response || null),
        lockedAt: null
      }
    },
    { upsert: true, new: true }
  ).lean();
}

async function enterprisePartnerDeliverWebhook(partner = {}, config = {}, event = 'order_created', extraPayload = {}, options = {}) {
  if (!config.url) {
    const err = new Error('URL do webhook não configurada');
    err.statusCode = 400;
    throw err;
  }
  if (config.active !== true) {
    const err = new Error('Webhook está inativo');
    err.statusCode = 400;
    throw err;
  }
  if (Array.isArray(config.events) && config.events.length && !config.events.includes(event)) {
    const err = new Error(`Evento ${event} não está habilitado para este webhook`);
    err.statusCode = 400;
    throw err;
  }

  const safeWebhookUrl = await enterpriseValidateWebhookUrl(config.url, partner);
  const payload = options.payload || enterprisePartnerBuildWebhookPayload(partner, event, extraPayload, options.deliveryId || '');
  const rawBody = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = enterprisePartnerSignWebhook(config.secret, rawBody);
  const signatureV2 = enterprisePartnerSignWebhookV2(config.secret, timestamp, payload.id, rawBody);
  const attempt = Math.max(1, Number(options.attempt || 1));
  const started = Date.now();
  let statusCode = 0;
  let responseData = null;
  let ok = false;
  let message = '';

  try {
    const response = await axios.post(safeWebhookUrl, payload, {
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Ariana-Enterprise-Webhooks/1.0',
        'X-Ariana-Event': event,
        'X-Ariana-Delivery': payload.id,
        'X-Ariana-Timestamp': timestamp,
        'X-Ariana-Signature': signature,
        'X-Ariana-Signature-V2': `sha256=${signatureV2}`,
        'X-Webhook-Signature': signature
      },
      validateStatus: () => true,
      maxRedirects: 0
    });
    statusCode = Number(response.status || 0);
    responseData = redact(response.data || null);
    ok = statusCode >= 200 && statusCode < 300;
    message = ok ? 'Webhook entregue com sucesso' : `Webhook retornou HTTP ${statusCode}`;
  } catch (error) {
    statusCode = 0;
    ok = false;
    message = error.message || 'Falha ao entregar webhook';
    responseData = { error: message };
  }

  const durationMs = Date.now() - started;
  const log = await IntegrationAuditLog.create({
    scope: 'enterprise',
    eventType: ok ? 'webhook_sent' : 'webhook_failed',
    manufacturer: partner.requestId || partner.companyName || partner.tradeName || 'enterprise',
    status: ok ? 'success' : 'error',
    statusCode: statusCode || 500,
    message,
    request: { url: safeWebhookUrl, event, payload, headers: { 'X-Ariana-Signature': '[redacted]' } },
    response: responseData,
    metadata: {
      endpoint: safeWebhookUrl,
      event,
      deliveryId: payload.id,
      timestamp,
      signatureVersion: 'v2',
      attempt,
      durationMs,
      environment: partner.environment || 'sandbox',
      companyName: partner.companyName || '',
      tradeName: partner.tradeName || '',
      requestId: partner.requestId || ''
    }
  });

  await Setting.findOneAndUpdate(
    { key: enterprisePartnerWebhookSettingKey(partner) },
    { $set: { 'value.lastTestAt': new Date(), 'value.lastStatusCode': statusCode || 500 } }
  ).catch(() => null);

  const result = { ok, statusCode, durationMs, event, deliveryId: payload.id, logId: String(log._id), response: responseData, message, attempt, payload };
  if (!ok && options.queueOnFailure !== false) {
    const queued = await enterpriseQueueWebhookRetry(partner, event, payload, result).catch(() => null);
    result.retryQueued = Boolean(queued);
    result.retryStatus = queued?.status || '';
    result.nextAttemptAt = queued?.nextAttemptAt || null;
  }
  return result;
}

async function enterpriseFindWebhookPartnerForDelivery(job = {}) {
  if (!EnterpriseHomologationRequestCompat) return null;
  if (job.partnerObjectId && mongoose.Types.ObjectId.isValid(job.partnerObjectId)) {
    const byId = await EnterpriseHomologationRequestCompat.findById(job.partnerObjectId).lean().catch(() => null);
    if (byId) return byId;
  }
  if (job.requestId) {
    return EnterpriseHomologationRequestCompat.findOne({ requestId: job.requestId }).lean().catch(() => null);
  }
  return null;
}

async function processEnterpriseWebhookRetryQueue(limit = 10) {
  const nowDate = new Date();
  const staleBefore = new Date(Date.now() - 5 * 60 * 1000);
  const rows = await EnterpriseWebhookDelivery.find({
    $or: [
      { status: { $in: ['retrying', 'pending'] }, nextAttemptAt: { $lte: nowDate } },
      { status: 'processing', lockedAt: { $lte: staleBefore } }
    ]
  }).sort({ nextAttemptAt: 1, createdAt: 1 }).limit(Math.max(1, Number(limit || 10))).lean();

  const results = [];
  for (const row of rows) {
    const claimed = await EnterpriseWebhookDelivery.findOneAndUpdate(
      {
        _id: row._id,
        $or: [
          { status: { $in: ['retrying', 'pending'] } },
          { status: 'processing', lockedAt: { $lte: staleBefore } }
        ]
      },
      { $set: { status: 'processing', lockedAt: new Date() } },
      { new: true }
    ).lean();
    if (!claimed) continue;

    try {
      const partnerDoc = await enterpriseFindWebhookPartnerForDelivery(claimed);
      if (!partnerDoc) throw new Error('Parceiro do webhook não encontrado');
      const partner = {
        id: String(partnerDoc._id || ''),
        requestId: partnerDoc.requestId || '',
        companyName: partnerDoc.companyName || '',
        tradeName: partnerDoc.tradeName || '',
        environment: claimed.environment || partnerDoc.environment || 'sandbox'
      };
      const config = await enterprisePartnerGetWebhookConfig(partner);
      const nextAttempt = Number(claimed.attempts || 1) + 1;
      const result = await enterprisePartnerDeliverWebhook(
        partner,
        config,
        claimed.event,
        {},
        { payload: claimed.payload, deliveryId: claimed.deliveryId, attempt: nextAttempt, queueOnFailure: false }
      );

      if (result.ok) {
        await EnterpriseWebhookDelivery.updateOne(
          { _id: claimed._id },
          {
            $set: {
              status: 'delivered',
              attempts: nextAttempt,
              deliveredAt: new Date(),
              lastAttemptAt: new Date(),
              nextAttemptAt: null,
              lastStatusCode: result.statusCode,
              lastError: '',
              lastResponse: redact(result.response || null),
              lockedAt: null
            }
          }
        );
      } else {
        const maxAttempts = Number(claimed.maxAttempts || 6);
        const dead = nextAttempt >= maxAttempts;
        await EnterpriseWebhookDelivery.updateOne(
          { _id: claimed._id },
          {
            $set: {
              status: dead ? 'dead_letter' : 'retrying',
              attempts: nextAttempt,
              nextAttemptAt: dead ? null : new Date(Date.now() + enterpriseWebhookBackoffMs(nextAttempt)),
              lastAttemptAt: new Date(),
              lastStatusCode: result.statusCode || 0,
              lastError: result.message || 'Falha no retry do webhook',
              lastResponse: redact(result.response || null),
              lockedAt: null
            }
          }
        );
        if (dead) {
          await IntegrationAuditLog.create({
            scope: 'enterprise',
            eventType: 'webhook_dead_letter',
            manufacturer: partner.requestId || partner.companyName || '',
            status: 'error',
            statusCode: result.statusCode || 500,
            message: 'Webhook esgotou todas as tentativas automáticas',
            metadata: { deliveryId: claimed.deliveryId, event: claimed.event, attempts: nextAttempt, environment: partner.environment }
          }).catch(() => null);
        }
      }
      results.push({ deliveryId: claimed.deliveryId, ok: result.ok });
    } catch (error) {
      const nextAttempt = Number(claimed.attempts || 1) + 1;
      const maxAttempts = Number(claimed.maxAttempts || 6);
      const dead = nextAttempt >= maxAttempts;
      await EnterpriseWebhookDelivery.updateOne(
        { _id: claimed._id },
        {
          $set: {
            status: dead ? 'dead_letter' : 'retrying',
            attempts: nextAttempt,
            nextAttemptAt: dead ? null : new Date(Date.now() + enterpriseWebhookBackoffMs(nextAttempt)),
            lastAttemptAt: new Date(),
            lastError: String(error.message || error),
            lockedAt: null
          }
        }
      ).catch(() => null);
      results.push({ deliveryId: claimed.deliveryId, ok: false, error: String(error.message || error) });
    }
  }
  return results;
}

if (!globalThis.__ARIANA_ENTERPRISE_WEBHOOK_RETRY_WORKER__) {
  globalThis.__ARIANA_ENTERPRISE_WEBHOOK_RETRY_WORKER__ = true;
  const intervalMs = Math.max(30_000, Number(process.env.ENTERPRISE_WEBHOOK_RETRY_INTERVAL_MS || 60_000));
  const timer = setInterval(() => {
    processEnterpriseWebhookRetryQueue(Number(process.env.ENTERPRISE_WEBHOOK_RETRY_BATCH || 10))
      .catch((error) => console.error('[enterprise webhook retry worker]', error.message || error));
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  console.log(`🔁 Enterprise webhook retry worker ativo: ${intervalMs}ms`);
}

app.get('/api/enterprise/partner/webhooks', enterprisePartnerRequired, async (req, res) => {
  try {
    const config = await enterprisePartnerGetWebhookConfig(req.enterprisePortal || {});
    const logs = await IntegrationAuditLog.find({
      ...enterprisePartnerLogQuery(req.enterprisePortal || {}),
      eventType: { $in: ['webhook_test', 'webhook_received', 'webhook_sent', 'webhook_retry', 'webhook_failed', 'webhook_dead_letter'] }
    }).sort({ createdAt: -1 }).limit(80).lean().catch(() => []);

    const portal = req.enterprisePortal || {};
    const deliveryFilter = portal.partnerId && mongoose.Types.ObjectId.isValid(portal.partnerId)
      ? { partnerObjectId: String(portal.partnerId) }
      : { requestId: String(portal.requestId || '') };
    const retryDeliveries = await EnterpriseWebhookDelivery.find(deliveryFilter)
      .sort({ createdAt: -1 })
      .limit(50)
      .lean()
      .catch(() => []);

    return res.json({
      ok: true,
      events: ENTERPRISE_WEBHOOK_EVENTS,
      config: {
        active: config.active,
        url: config.url,
        secretMasked: config.secretMasked,
        events: config.events,
        lastTestAt: config.lastTestAt,
        lastStatusCode: config.lastStatusCode,
        updatedAt: config.updatedAt
      },
      retryQueue: retryDeliveries.map((item) => ({
        id: String(item._id),
        deliveryId: item.deliveryId,
        event: item.event,
        status: item.status,
        attempts: item.attempts,
        maxAttempts: item.maxAttempts,
        nextAttemptAt: item.nextAttemptAt,
        lastStatusCode: item.lastStatusCode,
        lastError: item.lastError,
        createdAt: item.createdAt,
        deliveredAt: item.deliveredAt
      })),
      webhooks: logs.map((log) => ({
        id: String(log._id),
        eventType: log.eventType || '',
        event: log.metadata?.event || log.eventType || '',
        deliveryId: log.metadata?.deliveryId || '',
        endpoint: log.metadata?.endpoint || log.request?.url || '',
        statusCode: enterprisePartnerLogStatusCode(log),
        status: log.status || '',
        message: log.message || '',
        durationMs: Number(log.metadata?.durationMs || 0),
        createdAt: log.createdAt || null,
        request: log.request || null,
        response: log.response || null,
        metadata: log.metadata || null
      }))
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar webhooks' });
  }
});

app.post('/api/enterprise/partner/webhooks/config', enterprisePartnerRequired, async (req, res) => {
  try {
    const config = await enterprisePartnerSaveWebhookConfig(req.enterprisePortal || {}, req.body || {});
    await IntegrationAuditLog.create({
      scope: 'enterprise',
      eventType: 'webhook_config_updated',
      manufacturer: req.enterprisePortal?.requestId || req.enterprisePortal?.companyName || 'enterprise',
      status: 'success',
      statusCode: 200,
      message: 'Configuração de webhook atualizada pelo portal do fabricante',
      request: redact({ ...req.body, secret: req.body?.secret ? '[redacted]' : '' }),
      response: { ok: true, url: config.url, active: config.active, events: config.events },
      metadata: {
        endpoint: '/api/enterprise/partner/webhooks/config',
        environment: req.enterprisePortal?.environment || 'sandbox',
        companyName: req.enterprisePortal?.companyName || '',
        tradeName: req.enterprisePortal?.tradeName || '',
        requestId: req.enterprisePortal?.requestId || ''
      }
    }).catch(() => null);
    return res.json({ ok: true, config: { ...config, secret: undefined } });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao salvar webhook' });
  }
});

app.post('/api/enterprise/partner/webhooks/test', enterprisePartnerRequired, async (req, res) => {
  try {
    const config = await enterprisePartnerGetWebhookConfig(req.enterprisePortal || {});
    const event = String(req.body?.event || 'order_created').trim();
    const result = await enterprisePartnerDeliverWebhook(req.enterprisePortal || {}, config, event, req.body?.payload || {});
    return res.status(result.ok ? 200 : 502).json({ ok: result.ok, ...result });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao testar webhook' });
  }
});

app.post('/api/enterprise/partner/webhooks/deliveries/:deliveryId/retry', enterprisePartnerRequired, async (req, res) => {
  try {
    const portal = req.enterprisePortal || {};
    const deliveryId = String(req.params.deliveryId || '').trim();
    if (!deliveryId) return res.status(400).json({ ok: false, error: 'deliveryId obrigatório' });

    const ownership = portal.partnerId && mongoose.Types.ObjectId.isValid(portal.partnerId)
      ? { partnerObjectId: String(portal.partnerId) }
      : { requestId: String(portal.requestId || '') };

    const job = await EnterpriseWebhookDelivery.findOneAndUpdate(
      { deliveryId, ...ownership },
      {
        $set: {
          status: 'retrying',
          attempts: 0,
          nextAttemptAt: new Date(),
          lastError: '',
          lockedAt: null,
          deliveredAt: null
        }
      },
      { new: true }
    ).lean();

    if (!job) return res.status(404).json({ ok: false, error: 'Entrega de webhook não encontrada para este parceiro' });

    processEnterpriseWebhookRetryQueue(1).catch((error) => console.error('[enterprise webhook manual retry]', error.message || error));
    return res.json({ ok: true, deliveryId, status: job.status, message: 'Webhook recolocado na fila de entrega' });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao recolocar webhook na fila' });
  }
});

app.post('/api/enterprise/partner/webhooks/:id/retry', enterprisePartnerRequired, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ ok: false, error: 'ID inválido' });
    const baseQuery = enterprisePartnerLogQuery(req.enterprisePortal || {});
    const previous = await IntegrationAuditLog.findOne({ _id: req.params.id, ...baseQuery }).lean();
    if (!previous) return res.status(404).json({ ok: false, error: 'Webhook não encontrado' });

    const config = await enterprisePartnerGetWebhookConfig(req.enterprisePortal || {});
    const event = String(previous.metadata?.event || previous.request?.event || 'order_created').trim();
    const payload = previous.request?.payload?.data || {};
    const result = await enterprisePartnerDeliverWebhook(req.enterprisePortal || {}, config, event, payload);

    await IntegrationAuditLog.create({
      scope: 'enterprise',
      eventType: 'webhook_retry',
      manufacturer: req.enterprisePortal?.requestId || req.enterprisePortal?.companyName || 'enterprise',
      status: result.ok ? 'success' : 'error',
      statusCode: result.statusCode || (result.ok ? 200 : 500),
      message: result.ok ? 'Webhook reenviado com sucesso' : 'Falha ao reenviar webhook',
      request: { previousLogId: String(previous._id), event, payload },
      response: result,
      metadata: {
        endpoint: config.url,
        event,
        deliveryId: result.deliveryId,
        previousLogId: String(previous._id),
        durationMs: result.durationMs,
        environment: req.enterprisePortal?.environment || 'sandbox',
        companyName: req.enterprisePortal?.companyName || '',
        tradeName: req.enterprisePortal?.tradeName || '',
        requestId: req.enterprisePortal?.requestId || ''
      }
    }).catch(() => null);

    return res.status(result.ok ? 200 : 502).json({ ok: result.ok, ...result });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao reenviar webhook' });
  }
});



return {
  EnterpriseWebhookDelivery,
  processEnterpriseWebhookRetryQueue,
  enterprisePartnerDeliverWebhook
};

}
