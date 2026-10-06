// ============================================================
// ENTERPRISE SHARED - RATE LIMIT
// Controle de consumo por fabricante, ambiente e API Key
// extraído de routes/enterpriseRoutes.js sem alterar regras ou respostas.
// ============================================================

export function createEnterpriseRateLimit(deps = {}) {
  const {
    mongoose,
    crypto,
    IntegrationAuditLog,
    redact
  } = deps;

  // ============================================================
  // PASSO 26 - RATE LIMIT ENTERPRISE / API GATEWAY
  // Controle de consumo por fabricante, ambiente e API Key.
  // Usa MongoDB para funcionar mesmo com múltiplas instâncias do Render.
  // ============================================================
  const enterpriseRateLimitBucketSchema = new mongoose.Schema({
    bucketKey: { type: String, unique: true, index: true },
    partnerId: { type: String, index: true },
    manufacturer: { type: String, index: true },
    environment: { type: String, index: true },
    apiKeyHash: { type: String, index: true },
    windowType: { type: String, enum: ['minute', 'day'], index: true },
    windowStart: { type: Date, index: true },
    count: { type: Number, default: 0 },
    limit: { type: Number, default: 0 },
    expiresAt: { type: Date, index: { expires: 0 } }
  }, { timestamps: true, versionKey: false });
  const EnterpriseRateLimitBucket = mongoose.models.EnterpriseRateLimitBucket || mongoose.model('EnterpriseRateLimitBucket', enterpriseRateLimitBucketSchema);

  function enterpriseCompatKeyHash(key = '') {
    return crypto.createHash('sha256').update(String(key || '')).digest('hex');
  }
  function enterpriseCompatMinuteStart(date = new Date()) {
    const d = new Date(date);
    d.setSeconds(0, 0);
    return d;
  }
  function enterpriseCompatDayStart(date = new Date()) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  function enterpriseCompatRateLimitConfig(partner = {}, credential = {}, environment = 'sandbox') {
    const env = String(environment || 'sandbox').toLowerCase() === 'production' ? 'production' : 'sandbox';
    const source = credential?.rateLimit || partner?.rateLimit?.[env] || partner?.rateLimit || {};
    const defaults = env === 'production'
      ? { requestsPerMinute: 1000, requestsPerHour: 30000, requestsPerDay: 100000 }
      : { requestsPerMinute: 300, requestsPerHour: 9000, requestsPerDay: 20000 };
    return {
      requestsPerMinute: Math.max(1, Number(source.requestsPerMinute || source.perMinute || defaults.requestsPerMinute)),
      requestsPerHour: Math.max(1, Number(source.requestsPerHour || source.perHour || defaults.requestsPerHour)),
      requestsPerDay: Math.max(1, Number(source.requestsPerDay || source.perDay || defaults.requestsPerDay)),
      burst: Math.max(1, Number(source.burst || source.requestsPerMinute || defaults.requestsPerMinute))
    };
  }
  async function enterpriseCompatIncrementBucket({ partnerId, manufacturer, environment, apiKeyHash, windowType, windowStart, expiresAt, limit }) {
    const bucketKey = [partnerId || manufacturer || 'enterprise', environment, apiKeyHash, windowType, windowStart.toISOString()].join(':');
    const doc = await EnterpriseRateLimitBucket.findOneAndUpdate(
      { bucketKey },
      {
        $setOnInsert: { bucketKey, partnerId, manufacturer, environment, apiKeyHash, windowType, windowStart, expiresAt },
        $set: { limit },
        $inc: { count: 1 }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
    return doc;
  }
  async function enterpriseCompatApplyRateLimit(req, res, partner = {}, credential = {}, environment = 'sandbox', key = '') {
    const disabled = String(process.env.ENTERPRISE_RATE_LIMIT_ENABLED || 'true').toLowerCase() === 'false';
    const internalBypass = String(req.headers['x-ariana-internal'] || '').trim() && String(process.env.ENTERPRISE_INTERNAL_BYPASS_SECRET || '').trim() === String(req.headers['x-ariana-internal'] || '').trim();
    if (disabled || internalBypass) return true;

    const config = enterpriseCompatRateLimitConfig(partner, credential, environment);
    const nowDate = new Date();
    const apiKeyHash = enterpriseCompatKeyHash(key);
    const partnerId = String(partner?._id || partner?.id || partner?.requestId || 'enterprise');
    const manufacturer = String(partner?.requestId || partner?.tradeName || partner?.companyName || 'enterprise');
    const minuteStart = enterpriseCompatMinuteStart(nowDate);
    const dayStart = enterpriseCompatDayStart(nowDate);

    const [minute, day] = await Promise.all([
      enterpriseCompatIncrementBucket({ partnerId, manufacturer, environment, apiKeyHash, windowType: 'minute', windowStart: minuteStart, expiresAt: new Date(minuteStart.getTime() + 10 * 60 * 1000), limit: config.requestsPerMinute }),
      enterpriseCompatIncrementBucket({ partnerId, manufacturer, environment, apiKeyHash, windowType: 'day', windowStart: dayStart, expiresAt: new Date(dayStart.getTime() + 3 * 24 * 60 * 60 * 1000), limit: config.requestsPerDay })
    ]);

    const remainingMinute = Math.max(0, config.requestsPerMinute - Number(minute?.count || 0));
    const remainingDay = Math.max(0, config.requestsPerDay - Number(day?.count || 0));
    const resetMinute = Math.ceil((minuteStart.getTime() + 60 * 1000) / 1000);
    const resetDay = Math.ceil((dayStart.getTime() + 24 * 60 * 60 * 1000) / 1000);

    res.setHeader('X-RateLimit-Limit', String(config.requestsPerMinute));
    res.setHeader('X-RateLimit-Remaining', String(remainingMinute));
    res.setHeader('X-RateLimit-Reset', String(resetMinute));
    res.setHeader('X-RateLimit-Day-Limit', String(config.requestsPerDay));
    res.setHeader('X-RateLimit-Day-Remaining', String(remainingDay));

    if (Number(minute?.count || 0) > config.requestsPerMinute || Number(day?.count || 0) > config.requestsPerDay) {
      const retryAfter = Number(minute?.count || 0) > config.requestsPerMinute ? Math.max(1, resetMinute - Math.floor(Date.now() / 1000)) : Math.max(1, resetDay - Math.floor(Date.now() / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      await IntegrationAuditLog.create({
        scope: 'enterprise',
        eventType: 'rate_limit_exceeded',
        manufacturer,
        integrationId: partnerId,
        status: 'error',
        statusCode: 429,
        message: 'Rate limit Enterprise excedido',
        request: redact({ method: req.method, url: req.originalUrl || req.url, headers: { 'x-ariana-key': '[redacted]' } }),
        metadata: { environment, requestsPerMinute: config.requestsPerMinute, requestsPerDay: config.requestsPerDay, minuteCount: minute?.count || 0, dayCount: day?.count || 0, retryAfter }
      }).catch(() => null);
      res.status(429).json({
        ok: false,
        error: 'Rate limit excedido',
        message: 'O limite de requisições da API Enterprise foi atingido. Aguarde e tente novamente.',
        retryAfter,
        limit: config.requestsPerMinute,
        remaining: remainingMinute,
        reset: resetMinute
      });
      return false;
    }
    req.enterpriseRateLimit = { ...config, remainingMinute, remainingDay, resetMinute, resetDay };
    return true;
  }


  return {
    EnterpriseRateLimitBucket,
    enterpriseCompatKeyHash,
    enterpriseCompatMinuteStart,
    enterpriseCompatDayStart,
    enterpriseCompatRateLimitConfig,
    enterpriseCompatIncrementBucket,
    enterpriseCompatApplyRateLimit
  };
}
