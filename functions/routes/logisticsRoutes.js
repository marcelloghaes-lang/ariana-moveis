// ============================================================
// ROTAS DE LOGÍSTICA / ETIQUETAS - ADMIN E SELLER
// Extraído de legacyRoutes.js na Etapa 7.
// Objetivo: reduzir legacyRoutes.js sem alterar endpoints, regras ou respostas.
// ============================================================

export default function registerLogisticsRoutes(app, context = {}) {
  const {
    Order,
    LogisticsLabel,
    adminRequired,
    authRequired,
    sellerAuthRequired: contextSellerAuthRequired,
    mongoose,
    getShippingSettings,
    escapeRegex,
    toJSON,
    ensureArray,
    changedKeys,
    redact,
    createAdminNotification,
    waMaybeNotifyOrderStatusChange,
    writeAuditLog,
    quoteCorreios: contextQuoteCorreios,
    quoteFrenet: contextQuoteFrenet,
    getCorreiosToken: contextGetCorreiosToken,
    correiosCfg: contextCorreiosCfg,
    normalizeCepValue: contextNormalizeCepValue,
    axios,
    formatMoneyBRL
  } = context;

  const sellerAuthRequired = contextSellerAuthRequired || async function sellerAuthRequiredFallback(req, res, next) {
    if (typeof authRequired !== 'function') {
      return res.status(500).json({ ok: false, error: 'Middleware sellerAuthRequired não configurado.' });
    }

    return authRequired(req, res, () => {
      const role = String(req.user?.role || '').toLowerCase();
      if (!['seller', 'admin'].includes(role)) {
        return res.status(403).json({ ok: false, error: 'Acesso restrito ao seller.' });
      }
      req.sellerId = String(req.user?.sellerId || req.auth?.sellerId || '').trim();
      req.seller = req.user;
      return next();
    });
  };

  function cleanCep(value = '') {
    return String(value || '').replace(/\D/g, '').slice(0, 8);
  }

  const normalizeCepValue = typeof contextNormalizeCepValue === 'function'
    ? contextNormalizeCepValue
    : cleanCep;

  const correiosCfg = typeof contextCorreiosCfg === 'function'
    ? contextCorreiosCfg
    : function fallbackCorreiosCfg(settings = {}) {
        const cfg = settings && settings.correios ? settings.correios : {};
        const envFirst = (...keys) => {
          for (const key of keys) {
            const value = process.env[key];
            if (value !== undefined && value !== null && String(value).trim() !== '') {
              return String(value).trim();
            }
          }
          return '';
        };
        return {
          user: envFirst('CORREIOS_USER'),
          pass: envFirst('CORREIOS_PASS'),
          cartao: envFirst('CORREIOS_CARTAO'),
          contrato: envFirst('CORREIOS_CONTRATO'),
          dr: envFirst('CORREIOS_DR') || '0',
          originCep: cleanCep(cfg.origemCep || envFirst('LOJA_ORIGEM_CEP')),
          services: Array.isArray(cfg.servicos) && cfg.servicos.length ? cfg.servicos : parseServices(envFirst('CORREIOS_SERVICOS') || '03298,03328'),
          tokenUrl: envFirst('CORREIOS_TOKEN_URL') || 'https://api.correios.com.br/token/v1/autentica/cartaopostagem',
          precoUrl: envFirst('CORREIOS_PRECO_URL') || 'https://api.correios.com.br/preco/v1/nacional'
        };
      };

  function parseServices(value = '') {
    return String(value || '03298,03328')
      .split(',')
      .map((service) => String(service || '').trim())
      .filter(Boolean);
  }

  function normalizeShippingText(value = '') {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .trim()
      .toUpperCase();
  }

  function uid(prefix = 'id') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  const quoteCorreios = typeof contextQuoteCorreios === 'function'
    ? contextQuoteCorreios
    : async function quoteCorreiosFallback() {
        return { ok: false, quotes: [], bestQuote: null, error: 'quoteCorreios não configurado no contexto.' };
      };

  const quoteFrenet = typeof contextQuoteFrenet === 'function'
    ? contextQuoteFrenet
    : async function quoteFrenetFallback() {
        return { ok: false, quotes: [], bestQuote: null, error: 'quoteFrenet não configurado no contexto.' };
      };

  let correiosTokenCache = { token: null, exp: 0 };

  const getCorreiosToken = typeof contextGetCorreiosToken === 'function'
    ? contextGetCorreiosToken
    : async function getCorreiosTokenFallback(settings = {}) {
        const cfg = correiosCfg(settings || {});
        const nowTs = Date.now();

        if (correiosTokenCache.token && correiosTokenCache.exp > nowTs) {
          return correiosTokenCache.token;
        }

        if (!axios || typeof axios.post !== 'function') {
          throw new Error('Correios: axios não configurado no contexto.');
        }
        if (!cfg.user || !cfg.pass) {
          throw new Error('Correios: CORREIOS_USER/CORREIOS_PASS ausentes.');
        }
        if (!cfg.cartao) {
          throw new Error('Correios: CORREIOS_CARTAO ausente.');
        }

        const tokenUrl = String(cfg.tokenUrl || process.env.CORREIOS_TOKEN_URL || 'https://api.correios.com.br/token/v1/autentica/cartaopostagem').trim();
        const auth = Buffer.from(`${cfg.user}:${cfg.pass}`).toString('base64');
        const body = { numero: cfg.cartao };
        if (cfg.contrato) body.contrato = cfg.contrato;
        if (cfg.dr && Number(cfg.dr) > 0) body.dr = Number(cfg.dr);

        const response = await axios.post(tokenUrl, body, {
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          timeout: Number(process.env.CORREIOS_TOKEN_TIMEOUT_MS || 20000),
          validateStatus: () => true
        });

        const data = response.data || {};
        if (response.status < 200 || response.status >= 300) {
          const message = data?.message || data?.mensagem || data?.erro || data?.error || `Correios token HTTP ${response.status}`;
          throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
        }

        const token = data.token || data.access_token;
        const expiresIn = Number(data.expires_in || data.expiraEm || 3000);
        if (!token) throw new Error('Correios: token não retornou.');

        correiosTokenCache.token = token;
        correiosTokenCache.exp = nowTs + Math.max(60, expiresIn - 60) * 1000;
        return token;
      };
  // ============================================================
  // Helpers restaurados após refatoração
  // Essas funções são usadas pelas rotas de logística/seller e pela
  // pré-postagem dos Correios. Sem elas o backend quebra com:
  // extractSellerIdsFromOrder is not defined / toGrams is not defined.
  // ============================================================
  function toGrams(value, fallback = 1000) {
    const n = Number(String(value ?? '').replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) return fallback;
    // Se já vier em gramas, mantém. Se vier em kg, converte.
    return Math.round(n > 100 ? n : n * 1000);
  }

  function extractSellerIdsFromOrder(order = {}) {
    const ids = new Set();

    const add = (value) => {
      if (value === undefined || value === null || value === '') return;
      if (typeof value === 'object') {
        if (value._id) ids.add(String(value._id));
        if (value.id) ids.add(String(value.id));
        if (value.sellerId) add(value.sellerId);
        if (value.seller) add(value.seller);
        if (value.vendorId) add(value.vendorId);
        if (value.partnerId) add(value.partnerId);
        return;
      }
      ids.add(String(value));
    };

    add(order.sellerId);
    add(order.seller);
    add(order.vendorId);
    add(order.partnerId);
    add(order.partner);
    add(order.storeId);
    add(order.factoryId);

    const items = Array.isArray(order.items) ? order.items : [];
    for (const item of items) {
      add(item.sellerId);
      add(item.seller);
      add(item.vendorId);
      add(item.partnerId);
      add(item.partner);
      add(item.storeId);
      add(item.factoryId);
      add(item.product?.sellerId);
      add(item.product?.seller);
      add(item.product?.vendorId);
      add(item.product?.partnerId);
      add(item.productSnapshot?.sellerId);
      add(item.productSnapshot?.seller);
    }

    return [...ids].map((id) => String(id).trim()).filter(Boolean);
  }


// ============================================================
// PAINEL DE LOGÍSTICA / GERAÇÃO DE ETIQUETAS
// Fase 1: painel manual inteligente, pronto para integrações.
// ============================================================
function normalizeLogisticsLabel(doc) {
  const obj = toJSON(doc) || {};
  return {
    ...obj,
    id: String(obj.id || obj._id || ''),
    orderId: String(obj.orderId || ''),
    provider: String(obj.provider || 'manual'),
    service: String(obj.service || ''),
    status: String(obj.status || 'gerada'),
    trackingCode: String(obj.trackingCode || ''),
    shippingCost: Number(obj.shippingCost || 0),
    volumes: Number(obj.volumes || 1),
    weightKg: Number(obj.weightKg || 0),
    heightCm: Number(obj.heightCm || 0),
    widthCm: Number(obj.widthCm || 0),
    lengthCm: Number(obj.lengthCm || 0),
    notes: String(obj.notes || ''),
    labelUrl: String(obj.labelUrl || '')
  };
}

function getOrderAddress(order = {}) {
  const a = order.shippingAddress || order.address || order.endereco || {};
  return {
    name: a.name || a.nome || order.customerName || '',
    phone: a.phone || a.telefone || order.customerPhone || '',
    cep: normalizeCepValue(a.cep || a.zip || ''),
    logradouro: a.logradouro || a.street || a.rua || '',
    numero: a.numero || a.number || '',
    bairro: a.bairro || a.district || '',
    cidade: a.cidade || a.city || '',
    uf: a.uf || a.state || '',
    complemento: a.complemento || a.complement || '',
    reference: a.reference || a.referencia || ''
  };
}

function orderItemsSummary(order = {}) {
  return ensureArray(order.items).map((item) => {
    const qty = Number(item.qty || item.quantity || 1);
    const name = String(item.name || item.nome || item.title || 'Produto').trim();
    return `${qty}x ${name}`;
  }).join(' | ');
}

function escapeHtmlBasic(value = '') {
  return String(value || '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function buildManualLogisticsLabelHtml(orderDoc = {}, labelDoc = {}) {
  const order = toJSON(orderDoc) || orderDoc || {};
  const label = normalizeLogisticsLabel(labelDoc);
  const address = getOrderAddress(order);
  const orderId = String(order.id || order._id || label.orderId || '');
  const shortId = orderId ? orderId.slice(-8).toUpperCase() : 'SEM-ID';
  const sellerNames = ensureArray(order.items).map((i) => String(i.sellerName || i.sellerId || '').trim()).filter(Boolean);
  const seller = sellerNames[0] || order.manufacturer || 'Ariana Móveis';
  const items = orderItemsSummary(order);
  const dims = [label.lengthCm, label.widthCm, label.heightCm].filter(v => Number(v) > 0).join(' x ');
  const generatedAt = new Date().toLocaleString('pt-BR');

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Etiqueta ${shortId}</title>
  <style>
    *{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;margin:0;background:#f3f4f6;color:#111827}.page{max-width:760px;margin:20px auto;background:white;border:1px solid #111;padding:18px}.top{display:flex;justify-content:space-between;gap:12px;border-bottom:2px solid #111;padding-bottom:12px}.brand{font-size:24px;font-weight:900;color:#0047AB}.tag{border:2px solid #111;padding:10px 14px;text-align:center;font-weight:900;font-size:18px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}.box{border:1px solid #111;padding:12px;min-height:110px}.box h3{margin:0 0 8px;font-size:13px;text-transform:uppercase}.line{margin:5px 0;font-size:14px}.big{font-size:22px;font-weight:900}.barcode{font-family:monospace;text-align:center;border:1px dashed #111;padding:12px;margin-top:12px;font-size:24px;letter-spacing:2px}.footer{margin-top:12px;font-size:12px;color:#374151}.actions{margin:16px auto;max-width:760px;text-align:right}.actions button{padding:10px 16px;border:0;border-radius:10px;background:#0047AB;color:white;font-weight:800;cursor:pointer}@media print{body{background:white}.page{margin:0;border:1px solid #111}.actions{display:none}}
  </style></head><body><div class="actions"><button onclick="window.print()">Imprimir etiqueta</button></div><main class="page">
    <div class="top"><div><div class="brand">Ariana Móveis</div><div>Etiqueta / Romaneio de logística</div></div><div class="tag">${escapeHtmlBasic(label.provider).toUpperCase()}<br><small>${escapeHtmlBasic(label.service || 'Manual')}</small></div></div>
    <div class="grid">
      <section class="box"><h3>Destinatário</h3><div class="big">${escapeHtmlBasic(address.name || order.customerName || 'Cliente')}</div><div class="line">${escapeHtmlBasic(address.phone || order.customerPhone || '')}</div><div class="line">${escapeHtmlBasic(address.logradouro)} ${escapeHtmlBasic(address.numero)}</div><div class="line">${escapeHtmlBasic(address.bairro)} ${address.complemento ? ' - ' + escapeHtmlBasic(address.complemento) : ''}</div><div class="line">${escapeHtmlBasic(address.cidade)} / ${escapeHtmlBasic(address.uf)} - CEP ${escapeHtmlBasic(address.cep)}</div>${address.reference ? `<div class="line">Ref.: ${escapeHtmlBasic(address.reference)}</div>` : ''}</section>
      <section class="box"><h3>Pedido / Envio</h3><div class="line"><b>Pedido:</b> #${escapeHtmlBasic(shortId)}</div><div class="line"><b>Rastreio:</b> ${escapeHtmlBasic(label.trackingCode || 'A preencher')}</div><div class="line"><b>Status:</b> ${escapeHtmlBasic(label.status)}</div><div class="line"><b>Vendedor:</b> ${escapeHtmlBasic(seller)}</div><div class="line"><b>Valor frete:</b> ${formatMoneyBRL(label.shippingCost || order.shippingCost || 0)}</div></section>
    </div>
    <section class="box" style="margin-top:12px"><h3>Produtos</h3><div class="line">${escapeHtmlBasic(items || 'Produtos do pedido')}</div></section>
    <div class="grid"><section class="box"><h3>Volumes</h3><div class="line"><b>Volumes:</b> ${label.volumes || 1}</div><div class="line"><b>Peso:</b> ${label.weightKg || 0} kg</div><div class="line"><b>Dimensões:</b> ${escapeHtmlBasic(dims || 'não informado')} cm</div></section><section class="box"><h3>Observações</h3><div class="line">${escapeHtmlBasic(label.notes || 'Sem observações.')}</div></section></div>
    <div class="barcode">*${escapeHtmlBasic(label.trackingCode || shortId)}*</div>
    <div class="footer">Gerado em ${escapeHtmlBasic(generatedAt)}. ${label.labelType === 'correios_rotulo_oficial' ? 'Etiqueta oficial dos Correios carregada.' : (label.labelType === 'correios_rotulo_pendente' ? 'Rótulo oficial solicitado aos Correios. Este é apenas o romaneio interno enquanto o PDF oficial não é retornado pela API.' : 'Esta etiqueta manual deixa o painel pronto para integração com Correios, Frenet e transportadoras parceiras.')}</div>
  </main></body></html>`;
}

function inferLogisticsProvider(order = {}) {
  const shipping = order.shipping || order.payment?.shipping || {};
  const provider = String(shipping.provider || shipping.carrier || shipping.transportadora || '').trim();
  const service = String(shipping.service || shipping.label || shipping.name || '').trim();
  const text = `${provider} ${service}`.toLowerCase();
  if (text.includes('correio') || text.includes('sedex') || text.includes('pac')) return 'correios';
  if (text.includes('frenet')) return 'frenet';
  if (text.includes('rodocap')) return 'rodocap';
  if (text.includes('ariana')) return 'ariana_local';
  return provider || 'manual';
}

function hasCorreiosPrepostagemConfig(settings = {}) {
  const cfg = correiosCfg(settings || {});
  return Boolean(cfg.user && cfg.pass && cfg.cartao && (process.env.CORREIOS_PREPOSTAGEM_URL || process.env.CORREIOS_PRE_POSTAGEM_URL));
}

function hasFrenetOrderConfig(settings = {}) {
  const frenet = settings?.carriers?.frenet || {};
  return Boolean(String(frenet.token || process.env.FRENET_TOKEN || process.env.FRENET_API_TOKEN || '').trim() && (process.env.FRENET_ORDER_URL || process.env.FRENET_ORDERS_URL));
}

function extractProviderTrackingCode(data = {}) {
  const candidates = [
    data.codigoObjeto,
    data.codigoRastreamento,
    data.trackingCode,
    data.tracking_code,
    data.TrackingCode,
    data.objectCode,
    data?.prepostagem?.codigoObjeto,
    data?.prepostagem?.codigoRastreamento,
    data?.data?.codigoObjeto,
    data?.data?.codigoRastreamento,
    data?.data?.trackingCode,
    data?.order?.trackingCode,
    data?.Order?.TrackingCode,
    data?.Shipping?.TrackingCode
  ];
  for (const item of candidates) {
    const value = String(item || '').trim();
    if (value) return value;
  }
  return '';
}

function extractProviderLabelUrl(data = {}) {
  const candidates = [
    data.labelUrl,
    data.label_url,
    data.urlRotulo,
    data.rotuloUrl,
    data.urlEtiqueta,
    data.etiquetaUrl,
    data?.prepostagem?.urlRotulo,
    data?.data?.urlRotulo,
    data?.data?.labelUrl,
    data?.order?.labelUrl,
    data?.Order?.LabelUrl,
    data?.Shipping?.LabelUrl
  ];
  for (const item of candidates) {
    const value = String(item || '').trim();
    if (value) return value;
  }
  return '';
}


function extractPrePostagemIds(data = {}) {
  const ids = new Set();
  const add = (value = '') => {
    const str = String(value || '').trim();
    if (!str) return;
    // IDs de pré-postagem normalmente começam com PR. Evita usar o rastreio AP...BR como id.
    if (/^PR[A-Za-z0-9_-]{8,}$/i.test(str) || /^[A-Za-z0-9_-]{16,}$/.test(str)) ids.add(str);
  };

  const visit = (value, key = '') => {
    if (value === null || value === undefined) return;
    if (typeof value === 'string' || typeof value === 'number') {
      const normalizedKey = String(key || '').toLowerCase();
      if (
        normalizedKey.includes('idpre') ||
        normalizedKey.includes('id_pre') ||
        normalizedKey.includes('idprepostagem') ||
        normalizedKey === 'id' ||
        normalizedKey === 'idprepostagem'
      ) add(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, key));
      return;
    }
    if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) visit(v, k);
    }
  };

  [
    data.id,
    data.idPrePostagem,
    data.idPrepostagem,
    data.id_pre_postagem,
    data?.prepostagem?.id,
    data?.prepostagem?.idPrePostagem,
    data?.prePostagem?.id,
    data?.prePostagem?.idPrePostagem,
    data?.data?.id,
    data?.data?.idPrePostagem
  ].forEach(add);

  visit(data);
  return Array.from(ids).filter((id) => !/^[A-Z]{2}\d{9}[A-Z]{2}$/i.test(id));
}

function buildCorreiosRotuloEndpoint(prepostagemEndpoint = '') {
  const explicit = String(process.env.CORREIOS_ROTULO_URL || process.env.CORREIOS_PREPOSTAGEM_ROTULO_URL || '').trim();
  if (explicit) return explicit;
  const endpoint = String(prepostagemEndpoint || process.env.CORREIOS_PREPOSTAGEM_URL || process.env.CORREIOS_PRE_POSTAGEM_URL || '').trim();
  if (!endpoint) return '';

  // Manual Correios API 04/2025: o rótulo oficial PDF é solicitado em
  // /prepostagem/v1/prepostagens/rotulo/assincrono/pdf.
  // O endpoint antigo /rotulo sozinho pode existir, mas em produção costuma devolver 405 para POST.
  return endpoint.replace(/\/prepostagem\/v1\/prepostagens(?:\/.*)?$/i, '/prepostagem/v1/prepostagens/rotulo/assincrono/pdf');
}

function normalizeCorreiosRotuloHtml(data = '') {
  if (typeof data === 'string') return data;
  const candidates = [
    data?.html,
    data?.rotulo,
    data?.labelHtml,
    data?.data,
    data?.conteudo,
    data?.retorno
  ];
  for (const item of candidates) {
    if (typeof item === 'string' && item.trim()) return item;
  }
  return '';
}

async function callCorreiosRotulo({
  token,
  endpoint,
  idsPrePostagem = [],
  codigoRastreamento = '',
  tipoRotulo = 'P'
} = {}) {
  const rotuloEndpoint = buildCorreiosRotuloEndpoint(endpoint);
  const ids = ensureArray(idsPrePostagem)
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  const tipo = String(tipoRotulo || 'P').toUpperCase() === 'R' ? 'R' : 'P';

  if (!rotuloEndpoint || !ids.length) {
    return {
      ok: false,
      skipped: true,
      reason: !rotuloEndpoint
        ? 'CORREIOS_ROTULO_URL ausente'
        : 'idsPrePostagem ausentes'
    };
  }

  if (!axios || typeof axios.post !== 'function' || typeof axios.get !== 'function') {
    return {
      ok: false,
      skipped: true,
      reason: 'Axios não configurado no contexto.'
    };
  }

  const timeout = Number(process.env.CORREIOS_ROTULO_TIMEOUT_MS || 30000);
  const maxPolls = Math.max(
    1,
    Number(process.env.CORREIOS_ROTULO_POLL_ATTEMPTS || 30)
  );
  const pollDelayMs = Math.max(
    1000,
    Number(process.env.CORREIOS_ROTULO_POLL_DELAY_MS || 10000)
  );
  const initialPollDelayMs = Math.max(
    0,
    Number(process.env.CORREIOS_ROTULO_INITIAL_DELAY_MS || 15000)
  );

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const asText = (rawData = '') => {
    if (Buffer.isBuffer(rawData)) return rawData.toString('utf8');
    if (typeof rawData === 'string') return rawData;
    try {
      return JSON.stringify(rawData);
    } catch (_error) {
      return String(rawData || '');
    }
  };

  const parseJsonLoose = (rawData = '') => {
    if (rawData && typeof rawData === 'object' && !Buffer.isBuffer(rawData)) {
      return rawData;
    }

    const textData = asText(rawData).trim();
    if (!textData) return null;

    try {
      return JSON.parse(textData);
    } catch (_error) {
      return null;
    }
  };

  const extractIdRecibo = (data = {}) => {
    const candidates = [
      data?.idRecibo,
      data?.id_recibo,
      data?.recibo,
      data?.protocolo,
      data?.data?.idRecibo,
      data?.data?.id_recibo,
      data?.retorno?.idRecibo,
      data?.resultado?.idRecibo
    ];

    for (const item of candidates) {
      const value = String(item || '').trim();
      if (value) return value;
    }

    return '';
  };

  const extractPdfDataUrl = (response) => {
    const contentType = String(
      response?.headers?.['content-type'] || ''
    ).toLowerCase();

    const buffer = Buffer.isBuffer(response?.data)
      ? response.data
      : Buffer.from(response?.data || '');

    const isPdf =
      contentType.includes('application/pdf') ||
      buffer.slice(0, 4).toString() === '%PDF';

    if (
      response?.status >= 200 &&
      response?.status < 300 &&
      isPdf
    ) {
      return `data:application/pdf;base64,${buffer.toString('base64')}`;
    }

    const parsed = parseJsonLoose(response?.data);
    const candidates = [
      parsed?.dados,
      parsed?.data?.dados,
      parsed?.resultado?.dados,
      parsed?.retorno?.dados,
      parsed?.pdf,
      parsed?.arquivo,
      parsed?.arquivoPdf,
      parsed?.conteudo,
      parsed?.conteudoPdf,
      parsed?.base64
    ];

    for (const item of candidates) {
      const value = String(item || '').replace(/\s+/g, '');
      if (!value) continue;

      if (value.startsWith('data:application/pdf')) {
        return value;
      }

      if (/^JVBERi0/i.test(value)) {
        return `data:application/pdf;base64,${value}`;
      }
    }

    return '';
  };

  const officialPdfEndpoint = /\/assincrono\/pdf$/i.test(rotuloEndpoint)
    ? rotuloEndpoint
    : `${String(rotuloEndpoint).replace(/\/+$/, '')}/assincrono/pdf`;

  const rotuloEndpointBase = officialPdfEndpoint
    .replace(/\/assincrono\/pdf$/i, '')
    .replace(/\/+$/, '');

  const requestPayload = {
    idsPrePostagem: ids,
    tipoRotulo: tipo,
    formatoRotulo: 'ET'
  };

  let requestResponse;

  try {
    requestResponse = await axios.post(
      officialPdfEndpoint,
      requestPayload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        timeout,
        validateStatus: () => true
      }
    );
  } catch (error) {
    return {
      ok: false,
      pending: false,
      method: 'POST',
      endpoint: officialPdfEndpoint,
      requestPayload,
      idsPrePostagem: ids,
      error: error?.response?.data || error?.message || String(error),
      statusCode: error?.response?.status || null
    };
  }

  const requestData = requestResponse?.data || {};
  const idRecibo = extractIdRecibo(requestData);

  console.log('================ CORREIOS ROTULO ID RECIBO ================');
  console.dir({
    method: 'POST',
    endpoint: officialPdfEndpoint,
    statusCode: requestResponse.status,
    requestPayload,
    response: redact(requestData),
    idRecibo: idRecibo || null
  }, { depth: null });
  console.log('===========================================================');

  if (
    requestResponse.status < 200 ||
    requestResponse.status >= 300
  ) {
    return {
      ok: false,
      pending: false,
      method: 'POST',
      endpoint: officialPdfEndpoint,
      statusCode: requestResponse.status,
      idsPrePostagem: ids,
      requestPayload,
      data: requestData
    };
  }

  if (!idRecibo) {
    const directPdf = extractPdfDataUrl(requestResponse);
    if (directPdf) {
      return {
        ok: true,
        pending: false,
        method: 'POST',
        endpoint: officialPdfEndpoint,
        statusCode: requestResponse.status,
        idsPrePostagem: ids,
        requestPayload,
        idRecibo: '',
        html: '',
        labelUrl: directPdf
      };
    }

    return {
      ok: false,
      pending: false,
      method: 'POST',
      endpoint: officialPdfEndpoint,
      statusCode: requestResponse.status,
      idsPrePostagem: ids,
      requestPayload,
      data: requestData,
      message: 'Os Correios não retornaram o idRecibo do rótulo.'
    };
  }

  const downloadEndpoint =
    `${rotuloEndpointBase}/download/assincrono/${encodeURIComponent(idRecibo)}`;

  const pollAttempts = [];

  if (initialPollDelayMs > 0) {
    await sleep(initialPollDelayMs);
  }

  for (let attempt = 1; attempt <= maxPolls; attempt += 1) {
    if (attempt > 1) {
      await sleep(pollDelayMs);
    }

    let response;

    try {
      response = await axios.get(downloadEndpoint, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json,application/pdf,*/*'
        },
        timeout,
        responseType: 'arraybuffer',
        transformResponse: [(data) => data],
        validateStatus: () => true
      });
    } catch (error) {
      pollAttempts.push({
        attempt,
        method: 'GET',
        endpoint: downloadEndpoint,
        statusCode: error?.response?.status || null,
        error: error?.response?.data || error?.message || String(error)
      });
      continue;
    }

    const contentType = String(
      response.headers?.['content-type'] || ''
    ).toLowerCase();

    const pdfDataUrl = extractPdfDataUrl(response);
    const responseText = asText(response.data).trim();
    const parsed = parseJsonLoose(response.data);
    const providerMessage = String(
      parsed?.mensagem ||
      parsed?.message ||
      parsed?.erro ||
      parsed?.error ||
      responseText
    ).trim();

    const pollResult = {
      attempt,
      method: 'GET',
      endpoint: downloadEndpoint,
      statusCode: response.status,
      contentType,
      data: parsed || responseText.slice(0, 1500)
    };

    pollAttempts.push(pollResult);

    console.log('================ CORREIOS ROTULO POLL ================');
    console.dir({
      attempt,
      endpoint: downloadEndpoint,
      statusCode: response.status,
      contentType,
      pdfReady: Boolean(pdfDataUrl),
      message: providerMessage || null
    }, { depth: null });
    console.log('======================================================');

    if (pdfDataUrl) {
      return {
        ok: true,
        pending: false,
        asyncResolved: true,
        method: 'GET',
        endpoint: downloadEndpoint,
        statusCode: response.status,
        idsPrePostagem: ids,
        codigoRastreamento: String(codigoRastreamento || '').trim(),
        idRecibo,
        requestPayload,
        html: '',
        labelUrl: pdfDataUrl,
        attempts: pollAttempts
      };
    }

    const isPending =
      /PPN-288|PENDENTE|PROCESSAMENTO|AINDA.*PROCESSANDO/i.test(
        providerMessage
      );

    const isReceiptNotReady =
      /PPN-293|RECIBO.*NÃO.*ENCONTRADO|RECIBO.*NAO.*ENCONTRADO/i.test(
        providerMessage
      );

    if (!isPending && !isReceiptNotReady && response.status >= 400) {
      return {
        ok: false,
        pending: false,
        method: 'GET',
        endpoint: downloadEndpoint,
        statusCode: response.status,
        idsPrePostagem: ids,
        idRecibo,
        requestPayload,
        data: parsed || responseText.slice(0, 3000),
        attempts: pollAttempts
      };
    }
  }

  const lastAttempt = pollAttempts[pollAttempts.length - 1] || null;
  const lastText = JSON.stringify(lastAttempt?.data || '');

  return {
    ok: false,
    pending: true,
    providerRejectedByStatus: /PPN-288/i.test(lastText),
    method: 'GET',
    endpoint: downloadEndpoint,
    statusCode: lastAttempt?.statusCode || null,
    idsPrePostagem: ids,
    codigoRastreamento: String(codigoRastreamento || '').trim(),
    idRecibo,
    requestPayload,
    data: lastAttempt?.data || 'Rótulo oficial ainda em processamento pelos Correios.',
    attempts: pollAttempts,
    message: /PPN-288/i.test(lastText)
      ? 'A pré-postagem ainda está Pendente nos Correios (PPN-288). O recibo foi criado e o sistema continuará tratando o rótulo como aguardando geração do PDF oficial.'
      : 'Rótulo solicitado aos Correios e ainda aguardando a geração do PDF oficial.'
  };
}

function buildLogisticsShipmentPayload(orderDoc = {}, body = {}, provider = '') {
  const order = toJSON(orderDoc) || orderDoc || {};
  const address = getOrderAddress(order);
  const items = ensureArray(order.items).map((item) => ({
    productId: String(item.productId || item.id || ''),
    sku: String(item.sku || ''),
    name: String(item.name || item.nome || item.title || 'Produto'),
    quantity: Number(item.qty || item.quantity || 1),
    unitPrice: Number(item.unitPrice || item.price || 0),
    totalPrice: Number(item.totalPrice || 0)
  }));

  return {
    provider,
    orderId: String(order._id || order.id || ''),
    orderCode: String(order._id || order.id || '').slice(-8).toUpperCase(),
    service: String(body.service || body.servico || order.shipping?.service || order.shipping?.label || ''),
    invoiceValue: Number(body.invoiceValue || body.valorNota || order.total || order.subtotal || 0),
    shippingCost: Number(body.shippingCost || order.shippingCost || 0),
    volumes: Math.max(1, Number(body.volumes || 1)),
    weightKg: Number(body.weightKg || body.pesoKg || order.weightKg || 0),
    dimensions: {
      lengthCm: Number(body.lengthCm || body.comprimentoCm || order.lengthCm || 0),
      widthCm: Number(body.widthCm || body.larguraCm || order.widthCm || 0),
      heightCm: Number(body.heightCm || body.alturaCm || order.heightCm || 0)
    },
    sender: {
      name: process.env.LOJA_REMETENTE_NOME || 'Ariana Móveis',
      phone: process.env.LOJA_REMETENTE_TELEFONE || '',
      document: process.env.LOJA_REMETENTE_DOCUMENTO || process.env.CORREIOS_CNPJ || '',
      cep: normalizeCepValue(process.env.LOJA_ORIGEM_CEP || ''),
      address: process.env.LOJA_REMETENTE_ENDERECO || '',
      number: process.env.LOJA_REMETENTE_NUMERO || '',
      district: process.env.LOJA_REMETENTE_BAIRRO || '',
      city: process.env.LOJA_REMETENTE_CIDADE || 'Guanhães',
      state: process.env.LOJA_REMETENTE_UF || 'MG'
    },
    recipient: {
  name: address.name || order.customerName || 'Cliente',
  phone: address.phone || order.customerPhone || '',
  email: order.customerEmail || '',
  document: order.customerCpf || order.cpf || '',
  cep: normalizeCepValue(address.cep || ''),
  address: address.logradouro || '',
  number: address.numero || 'S/N',
  complement: address.complemento || '',
  district: String(
    address.bairro ||
    address.district ||
    address.neighborhood ||
    order.shippingAddress?.bairro ||
    order.shippingAddress?.district ||
    order.shippingAddress?.neighborhood ||
    order.shipping?.address?.bairro ||
    order.shipping?.address?.district ||
    ''
  ).trim(),
  city: address.cidade || '',
  state: address.uf || ''
},
    items,
    notes: String(body.notes || body.observacoes || '').trim()
  };
}

function isProviderBaseUrlOnly(endpoint = '', provider = '') {
  const value = String(endpoint || '').trim().replace(/\/+$/, '');
  if (!value) return true;

  try {
    const url = new URL(value);
    const host = String(url.hostname || '').toLowerCase();
    const pathname = String(url.pathname || '').replace(/\/+$/, '');

    if (provider === 'correios') {
      return host === 'api.correios.com.br' && (!pathname || pathname === '');
    }

    if (provider === 'frenet') {
      return host === 'api.frenet.com.br' && (!pathname || pathname === '');
    }
  } catch (_error) {
    return false;
  }

  return false;
}

function stringifyProviderError(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return String(value);
  }
}

function buildProviderPreparedFallback({
  provider = 'correios',
  shipment = {},
  quote = {},
  trackingCode = '',
  payload = {},
  reason = '',
  providerError = null,
  statusCode = null,
  providerData = null
} = {}) {
  const isCorreios = provider === 'correios';
  const providerName = isCorreios ? 'Correios' : 'Frenet';
  const providerErrorText = stringifyProviderError(providerError).slice(0, 4000);

  return {
    ok: true,
    preparedOnly: true,
    providerFallback: true,
    message: `${providerName} indisponível ou endpoint oficial não configurado corretamente. Romaneio/etiqueta interna preparada para impressão manual.`,
    trackingCode: String(trackingCode || '').trim(),
    labelUrl: '',
    payload: payload || shipment,
    quote,
    raw: {
      skippedProviderCall: true,
      reason,
      statusCode,
      providerError: providerErrorText,
      providerData: providerData || null
    }
  };
}

function pickCorreiosServiceCode(body = {}, shipment = {}) {
  const raw = String(body.shippingServiceCode || body.serviceCode || body.codigoServico || body.coProduto || body.service || shipment.service || '').trim();
  if (/^\d{5}$/.test(raw)) return raw;
  const normalized = normalizeShippingText(raw);
  if (normalized.includes('SEDEX')) return '03328';
  if (normalized.includes('PAC')) return '03298';
  const cfgServices = parseServices(process.env.CORREIOS_SERVICOS || '03298,03328');
  return cfgServices[0] || '03298';
}

function splitAddressNumber(address = '', fallbackNumber = '') {
  const text = String(address || '').trim();
  const fallback = String(fallbackNumber || '').trim() || 'S/N';
  if (!text) return { logradouro: '', numero: fallback };
  const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const numero = String(parts[1] || fallback).replace(/[^0-9A-Za-z\-\/]/g, '').trim() || fallback;
    return { logradouro: parts[0], numero };
  }
  return { logradouro: text, numero: fallback };
}

function normalizeDigits(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function normalizeCep(value = '') {
  const digits = normalizeDigits(value);
  return digits.length === 8 ? digits : '';
}

function normalizePhone(value = '') {
  return normalizeDigits(value);
}


function splitCorreiosPhoneParts(value = '') {
  let digits = normalizeDigits(value || '');
  if (digits.startsWith('55') && digits.length > 11) digits = digits.slice(2);
  if (digits.length < 10) return {};
  const ddd = digits.slice(0, 2);
  const rest = digits.slice(2);
  const out = {};
  if (ddd) {
    out.dddTelefone = ddd;
    out.dddCelular = ddd;
  }
  if (rest.length >= 9) {
    out.telefone = rest.slice(-8);
    out.celular = rest.slice(-9);
  } else if (rest.length >= 8) {
    out.telefone = rest.slice(-8);
  }
  return out;
}

function buildCorreiosPrepostagemPayload(orderDoc = {}, body = {}, shipment = {}, quote = {}) {
  const settings = body.settings || {};
  const cfg = correiosCfg(settings);
  const serviceCode = pickCorreiosServiceCode(body, shipment);
  const bestQuote = quote?.bestQuote || (Array.isArray(quote?.quotes)
    ? quote.quotes.find((q) => String(q.service) === serviceCode) || quote.quotes[0]
    : null) || {};

  const declaredValue = Number(body.valorDeclarado || body.invoiceValue || body.productPrice || shipment.invoiceValue || 0) || 0;
  const shippingPrice = Number(bestQuote.price || body.shippingCost || shipment.shippingCost || 0) || 0;
  const weightKg = Number(shipment.weightKg || body.weightKg || body.pesoKg || 1) || 1;
  const pesoGramas = Number(toGrams(weightKg) || 1000);

  const lengthCm = Number(shipment.dimensions?.lengthCm || body.lengthCm || body.comprimentoCm || 20) || 20;
  const widthCm = Number(shipment.dimensions?.widthCm || body.widthCm || body.larguraCm || 20) || 20;
  const heightCm = Number(shipment.dimensions?.heightCm || body.heightCm || body.alturaCm || 20) || 20;

  const senderAddress = splitAddressNumber(shipment.sender?.address, shipment.sender?.number);
  const recipientAddress = splitAddressNumber(shipment.recipient?.address, shipment.recipient?.number);
  const orderCode = String(shipment.orderCode || shipment.orderId || uid('ord')).slice(-20);

  const itensDeclaracaoConteudo = ensureArray(shipment.items).length
    ? ensureArray(shipment.items).map((item) => ({
      conteudo: String(item.name || item.sku || 'Produto').slice(0, 120),
      quantidade: String(Math.max(1, Number(item.quantity || 1))),
      valor: Number(item.totalPrice || item.unitPrice || declaredValue || 1).toFixed(2)
    }))
    : [{ conteudo: 'Produto Ariana Móveis', quantidade: '1', valor: Number(declaredValue || 1).toFixed(2) }];

  const remetenteEndereco = {
    cep: normalizeCepValue(shipment.sender?.cep || process.env.LOJA_ORIGEM_CEP || ''),
    logradouro: senderAddress.logradouro || String(process.env.LOJA_REMETENTE_ENDERECO || '').slice(0, 80),
    numero: senderAddress.numero || String(process.env.LOJA_REMETENTE_NUMERO || 'S/N'),
    complemento: String(process.env.LOJA_REMETENTE_COMPLEMENTO || '').slice(0, 60),
    bairro: String(shipment.sender?.district || process.env.LOJA_REMETENTE_BAIRRO || '').slice(0, 60),
    cidade: String(shipment.sender?.city || process.env.LOJA_REMETENTE_CIDADE || 'Guanhães').slice(0, 60),
    uf: String(shipment.sender?.state || process.env.LOJA_REMETENTE_UF || 'MG').slice(0, 2).toUpperCase()
  };

  const destinatarioEndereco = {
    cep: normalizeCepValue(shipment.recipient?.cep || ''),
    logradouro: recipientAddress.logradouro.slice(0, 80),
    numero: recipientAddress.numero || 'S/N',
    complemento: String(shipment.recipient?.complement || '').slice(0, 60),
    bairro: String(shipment.recipient?.district || '').slice(0, 60),
    cidade: String(shipment.recipient?.city || '').slice(0, 60),
    uf: String(shipment.recipient?.state || '').slice(0, 2).toUpperCase()
  };

  const payload = {
    numeroCartaoPostagem: String(cfg.cartao || process.env.CORREIOS_CARTAO || '').trim(),
    codigoServico: serviceCode,
    precoServico: Number(shippingPrice || 0).toFixed(2),
    pesoInformado: String(pesoGramas),
    codigoFormatoObjetoInformado: '2',
    alturaInformada: String(Math.round(heightCm)),
    larguraInformada: String(Math.round(widthCm)),
    comprimentoInformado: String(Math.round(lengthCm)),
    diametroInformado: '0',
    modalidadePagamento: 2,
    logisticaReversa: 'N',
    cienteObjetoNaoProibido: 1,
    emiteDCe: 'S',
    remetente: {
      nome: String(shipment.sender?.name || 'Ariana Móveis').slice(0, 60),
      cpfCnpj: normalizeDigits(shipment.sender?.document || process.env.LOJA_REMETENTE_DOCUMENTO || process.env.CORREIOS_CNPJ || ''),
      ...splitCorreiosPhoneParts(shipment.sender?.phone || process.env.LOJA_REMETENTE_TELEFONE || ''),
      ...remetenteEndereco,
      endereco: { ...remetenteEndereco }
    },
    destinatario: {
      nome: String(shipment.recipient?.name || 'Cliente').slice(0, 60),
      cpfCnpj: normalizeDigits(shipment.recipient?.document || ''),
      ...splitCorreiosPhoneParts(shipment.recipient?.phone || ''),
      email: String(shipment.recipient?.email || '').slice(0, 80),
      ...destinatarioEndereco,
      endereco: { ...destinatarioEndereco }
    },
    itensDeclaracaoConteudo,
    observacao: `Pedido ${orderCode}`.slice(0, 50)
  };

  // idAtendimento é exclusivo de credenciais internas dos Correios.
  // Não deve ser enviado por integrações externas como a Ariana Móveis.

  // Não enviar listaServicoAdicional vazia.
  // O campo só deve ser incluído quando houver serviço adicional realmente contratado.

  const removeEmpty = (obj = {}) => {
    Object.keys(obj).forEach((key) => {
      if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) removeEmpty(obj[key]);
      if (obj[key] === '') delete obj[key];
    });
    return obj;
  };

  removeEmpty(payload.remetente);
  removeEmpty(payload.destinatario);

  return payload;
}


function listCorreiosPrepostagemItems(data = {}) {
  const items = [];
  const visited = new Set();

  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (visited.has(value)) return;
    visited.add(value);

    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    const looksLikePrepostagem =
      value.statusAtual !== undefined ||
      value.descStatusAtual !== undefined ||
      value.codigoObjeto !== undefined ||
      value.idPrePostagem !== undefined ||
      (/^PR/i.test(String(value.id || '')) && String(value.id || '').length >= 10);

    if (looksLikePrepostagem) items.push(value);

    [
      value.itens,
      value.objetos,
      value.prepostagens,
      value.prePostagens,
      value.data,
      value.resultado,
      value.content
    ].forEach(visit);
  };

  visit(data);
  return items;
}

function extractCorreiosPrepostagemStatus(data = {}) {
  const directCandidates = [
    data?.statusAtual,
    data?.status,
    data?.codigoStatus,
    data?.codStatus,
    data?.prepostagem?.statusAtual,
    data?.prepostagem?.status,
    data?.data?.statusAtual,
    data?.data?.status,
    data?.resultado?.statusAtual,
    data?.resultado?.status
  ];

  for (const candidate of directCandidates) {
    if (candidate === undefined || candidate === null || candidate === '') continue;
    const value = Number(candidate);
    if (Number.isFinite(value)) return value;
  }

  for (const item of listCorreiosPrepostagemItems(data)) {
    const value = Number(item?.statusAtual ?? item?.status ?? item?.codigoStatus ?? item?.codStatus);
    if (Number.isFinite(value)) return value;
  }

  return null;
}

function extractCorreiosPrepostagemDescription(data = {}) {
  const directCandidates = [
    data?.descStatusAtual,
    data?.descricaoStatus,
    data?.statusDescricao,
    data?.prepostagem?.descStatusAtual,
    data?.prepostagem?.descricaoStatus,
    data?.data?.descStatusAtual,
    data?.data?.descricaoStatus,
    data?.resultado?.descStatusAtual,
    data?.resultado?.descricaoStatus
  ];

  for (const candidate of directCandidates) {
    const value = String(candidate || '').trim();
    if (value) return value;
  }

  for (const item of listCorreiosPrepostagemItems(data)) {
    const value = String(
      item?.descStatusAtual ||
      item?.descricaoStatus ||
      item?.statusDescricao ||
      ''
    ).trim();
    if (value) return value;
  }

  return '';
}

function buildCorreiosPrepostagemConsultaEndpoint(prepostagemEndpoint = '') {
  const explicit = String(
    process.env.CORREIOS_PREPOSTAGEM_CONSULTA_URL ||
    process.env.CORREIOS_PRE_POSTAGEM_CONSULTA_URL ||
    ''
  ).trim();
  if (explicit) return explicit;

  const endpoint = String(prepostagemEndpoint || '').trim().replace(/\/+$/, '');
  if (!endpoint) return 'https://api.correios.com.br/prepostagem/v2/prepostagens';

  if (/\/prepostagem\/v1\/prepostagens(?:\/.*)?$/i.test(endpoint)) {
    return endpoint.replace(
      /\/prepostagem\/v1\/prepostagens(?:\/.*)?$/i,
      '/prepostagem/v2/prepostagens'
    );
  }

  try {
    const url = new URL(endpoint);
    return `${url.origin}/prepostagem/v2/prepostagens`;
  } catch (_error) {
    return 'https://api.correios.com.br/prepostagem/v2/prepostagens';
  }
}

function selectCorreiosPrepostagemResult(data = {}, { codigoObjeto = '', idPrePostagem = '' } = {}) {
  const targetCode = String(codigoObjeto || '').trim().toUpperCase();
  const targetId = String(idPrePostagem || '').trim();
  const items = listCorreiosPrepostagemItems(data);

  const matched = items.find((item) => {
    const itemCode = String(
      item?.codigoObjeto ||
      item?.codigoRastreamento ||
      extractProviderTrackingCode(item) ||
      ''
    ).trim().toUpperCase();

    const itemId = String(
      item?.idPrePostagem ||
      item?.idPrepostagem ||
      item?.id_pre_postagem ||
      item?.id ||
      ''
    ).trim();

    return (targetCode && itemCode === targetCode) ||
      (targetId && itemId === targetId) ||
      (targetId && extractPrePostagemIds(item).includes(targetId));
  });

  if (matched) return matched;

  // O GET /v2/prepostagens normalmente devolve { itens: [...] }.
  // Nunca prefira o objeto raiz quando existe um item de pré-postagem real.
  return items[0] || data || {};
}

async function consultarCorreiosPrepostagem({
  token,
  endpoint,
  codigoObjeto = '',
  idPrePostagem = ''
} = {}) {
  const consultaEndpoint = buildCorreiosPrepostagemConsultaEndpoint(endpoint);
  const params = {};
  const trackingCode = String(codigoObjeto || '').trim();
  const prepostagemId = String(idPrePostagem || '').trim();

  // Conforme orientação técnica dos Correios, a consulta deve ser feita no GET /v2/prepostagens.
  // O código do objeto é usado como filtro principal; o ID é usado quando o rastreio não estiver disponível.
  if (trackingCode) params.codigoObjeto = trackingCode;
  else if (prepostagemId) params.idPrePostagem = prepostagemId;

  const response = await axios.get(consultaEndpoint, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    },
    params,
    timeout: Number(process.env.CORREIOS_PREPOSTAGEM_CONSULTA_TIMEOUT_MS || 30000),
    validateStatus: () => true
  });

  const data = response.data || {};
  const selected = selectCorreiosPrepostagemResult(data, {
    codigoObjeto: trackingCode,
    idPrePostagem: prepostagemId
  });
  const status = extractCorreiosPrepostagemStatus(selected);
  const descricao = extractCorreiosPrepostagemDescription(selected);

  const result = {
    ok: response.status >= 200 && response.status < 300,
    endpoint: consultaEndpoint,
    method: 'GET',
    statusCode: response.status,
    params,
    status,
    descricao,
    data: selected,
    raw: data
  };

  console.log('============= CORREIOS CONSULTA PRE-POSTAGEM =============');
  console.dir(redact({
    method: 'GET',
    endpoint: consultaEndpoint,
    params,
    statusCode: response.status,
    statusAtual: status,
    descStatusAtual: descricao,
    response: data
  }), { depth: null });
  console.log('==========================================================');

  return result;
}

async function aguardarCorreiosPrepostagemLiberada({
  token,
  endpoint,
  codigoObjeto = '',
  idPrePostagem = '',
  statusInicial = null
} = {}) {
  const maxAttempts = Math.max(
    1,
    Number(process.env.CORREIOS_PREPOSTAGEM_POLL_ATTEMPTS || 30)
  );
  const delayMs = Math.max(
    1000,
    Number(process.env.CORREIOS_PREPOSTAGEM_POLL_DELAY_MS || 10000)
  );
  const initialDelayMs = Math.max(
    0,
    Number(process.env.CORREIOS_PREPOSTAGEM_INITIAL_DELAY_MS || 10000)
  );
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const attempts = [];

  if (Number(statusInicial) === 2) {
    return {
      ok: true,
      ready: true,
      pending: false,
      cancelled: false,
      status: 2,
      descricao: 'Pré-postado',
      attempts
    };
  }

  if (Number(statusInicial) === 5) {
    return {
      ok: false,
      ready: false,
      pending: false,
      cancelled: true,
      status: 5,
      descricao: 'Cancelada',
      attempts,
      message: 'A pré-postagem foi cancelada pelos Correios durante a emissão da DC-e.'
    };
  }

  if (initialDelayMs > 0) await sleep(initialDelayMs);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) await sleep(delayMs);

    let result;
    try {
      result = await consultarCorreiosPrepostagem({
        token,
        endpoint,
        codigoObjeto,
        idPrePostagem
      });
    } catch (error) {
      attempts.push({
        attempt,
        ok: false,
        error: error?.response?.data || error?.message || String(error),
        statusCode: error?.response?.status || null
      });
      continue;
    }

    attempts.push({ attempt, ...redact(result) });

    if (!result.ok) {
      if (result.statusCode >= 400 && result.statusCode < 500) {
        return {
          ok: false,
          ready: false,
          pending: false,
          cancelled: false,
          status: result.status,
          descricao: result.descricao,
          attempts,
          lastResult: result,
          message: `Falha ao consultar a pré-postagem nos Correios (HTTP ${result.statusCode}).`
        };
      }
      continue;
    }

    if (Number(result.status) === 2) {
      return {
        ok: true,
        ready: true,
        pending: false,
        cancelled: false,
        status: 2,
        descricao: result.descricao || 'Pré-postado',
        data: result.data,
        attempts,
        lastResult: result
      };
    }

    if (Number(result.status) === 5) {
      return {
        ok: false,
        ready: false,
        pending: false,
        cancelled: true,
        status: 5,
        descricao: result.descricao || 'Cancelada',
        data: result.data,
        attempts,
        lastResult: result,
        message: 'A pré-postagem foi cancelada pelos Correios durante a emissão da DC-e.'
      };
    }
  }

  const lastResult = attempts[attempts.length - 1] || null;
  return {
    ok: true,
    ready: false,
    pending: true,
    cancelled: false,
    status: Number(lastResult?.status ?? 7),
    descricao: String(lastResult?.descricao || 'Pendente'),
    attempts,
    lastResult,
    message: 'A pré-postagem continua aguardando a SEFAZ gerar a DC-e. O rótulo será solicitado somente quando o status mudar para 2 (Pré-postada).'
  };
}

async function callCorreiosPrepostagem(orderDoc = {}, body = {}) {
  const settings = await getShippingSettings();
  const endpoint = String(process.env.CORREIOS_PREPOSTAGEM_URL || process.env.CORREIOS_PRE_POSTAGEM_URL || '').trim();
  const shipment = buildLogisticsShipmentPayload(orderDoc, body, 'correios');

  const quotePayload = {
    cepDestino: shipment.recipient.cep,
    weightKg: shipment.weightKg || undefined,
    lengthCm: shipment.dimensions.lengthCm || undefined,
    widthCm: shipment.dimensions.widthCm || undefined,
    heightCm: shipment.dimensions.heightCm || undefined,
    productPrice: shipment.invoiceValue,
    shippingServiceCode: body.shippingServiceCode || body.serviceCode || body.service || undefined
  };

  const quote = await quoteCorreios(quotePayload, settings).catch((error) => ({ ok: false, error: error.message || String(error) }));

  if (!endpoint) {
    return {
      ok: true,
      preparedOnly: true,
      message: 'Pré-postagem Correios preparada no pedido. Para enviar oficialmente aos Correios, configure CORREIOS_PREPOSTAGEM_URL no Render.',
      trackingCode: String(body.trackingCode || '').trim(),
      labelUrl: '',
      payload: shipment,
      quote,
      raw: { skippedProviderCall: true, reason: 'CORREIOS_PREPOSTAGEM_URL ausente' }
    };
  }

  if (isProviderBaseUrlOnly(endpoint, 'correios')) {
    return buildProviderPreparedFallback({
      provider: 'correios',
      shipment,
      quote,
      trackingCode: body.trackingCode,
      reason: 'CORREIOS_PREPOSTAGEM_URL aponta apenas para a URL base da API. Informe o endpoint específico de pré-postagem ou deixe vazio para usar romaneio interno.'
    });
  }

  const providerPayload = body.providerPayload && typeof body.providerPayload === 'object'
    ? body.providerPayload
    : buildCorreiosPrepostagemPayload(orderDoc, body, shipment, quote);

  const remetenteDocumento = normalizeDigits(providerPayload?.remetente?.cpfCnpj || '');
  if (!remetenteDocumento) {
    return buildProviderPreparedFallback({
      provider: 'correios',
      shipment,
      quote,
      trackingCode: body.trackingCode,
      payload: providerPayload,
      reason: 'Documento do remetente ausente. Configure LOJA_REMETENTE_DOCUMENTO ou CORREIOS_CNPJ no Render.',
      providerError: 'Remetente sem CPF/CNPJ no payload da pré-postagem.',
      statusCode: 400,
      providerData: { missingField: 'remetente.cpfCnpj' }
    });
  }

  try {
    const token = await getCorreiosToken(settings);
    const response = await axios.post(endpoint, providerPayload, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      timeout: Number(process.env.CORREIOS_PREPOSTAGEM_TIMEOUT_MS || 30000),
      validateStatus: () => true
    });

    const data = response.data || {};

    console.log('================ CORREIOS PRE-POSTAGEM ================');
    console.dir({
      method: 'POST',
      endpoint,
      statusCode: response.status,
      payload: redact(providerPayload),
      response: redact(data)
    }, { depth: null });
    console.log('========================================================');

    if (response.status < 200 || response.status >= 300) {
      const message = data?.message || data?.mensagem || data?.erro || data?.error || data?.errors || data?.msgs || data || `Correios pré-postagem HTTP ${response.status}`;
      console.error('[Correios pré-postagem HTTP erro]', {
        status: response.status,
        data,
        payload: providerPayload
      });
      return buildProviderPreparedFallback({
        provider: 'correios',
        shipment,
        quote,
        trackingCode: body.trackingCode,
        payload: providerPayload,
        reason: 'Correios retornou erro na pré-postagem. O pedido foi salvo como preparado internamente.',
        providerError: message,
        statusCode: response.status,
        providerData: data
      });
    }

    const idsPrePostagem = extractPrePostagemIds(data);
    const idPrePostagem = String(idsPrePostagem[0] || '').trim();
    const trackingCodeFromPrepostagem = extractProviderTrackingCode(data) || String(body.trackingCode || '').trim();
    const statusInicial = extractCorreiosPrepostagemStatus(data);

    const consultaPrepostagem = await aguardarCorreiosPrepostagemLiberada({
      token,
      endpoint,
      codigoObjeto: trackingCodeFromPrepostagem,
      idPrePostagem,
      statusInicial
    });

    let rotulo = {
      ok: false,
      skipped: true,
      pending: Boolean(consultaPrepostagem.pending),
      cancelled: Boolean(consultaPrepostagem.cancelled),
      reason: consultaPrepostagem.cancelled
        ? 'Pré-postagem cancelada pelos Correios (status 5).'
        : 'Aguardando a pré-postagem chegar ao status 2 (Pré-postada).',
      message: consultaPrepostagem.message || ''
    };
    let labelHtml = '';

    if (consultaPrepostagem.ready) {
      try {
        rotulo = await callCorreiosRotulo({
          token,
          endpoint,
          idsPrePostagem,
          codigoRastreamento: trackingCodeFromPrepostagem,
          tipoRotulo: body.tipoRotulo || body.labelSize || 'P'
        });
        if (rotulo.ok && rotulo.html) labelHtml = rotulo.html;
      } catch (rotuloError) {
        rotulo = {
          ok: false,
          pending: false,
          error: rotuloError?.response?.data || rotuloError?.message || String(rotuloError),
          statusCode: rotuloError?.response?.status || null
        };
      }
    }

    console.log('================ CORREIOS ROTULO FINAL ================');
    console.dir(redact({ consultaPrepostagem, rotulo }), { depth: null });
    console.log('=======================================================');

    const officialLabelUrl = String(rotulo?.labelUrl || extractProviderLabelUrl(data) || '');
    const hasOfficialLabel = Boolean(labelHtml || officialLabelUrl);
    const rotuloIdRecibo = String(rotulo?.idRecibo || rotulo?.firstAsyncRequest?.idRecibo || '').trim();
    const rotuloPending = !hasOfficialLabel && Boolean(
      consultaPrepostagem.pending || rotulo?.pending || rotuloIdRecibo
    );
    const prepostagemCancelled = Boolean(consultaPrepostagem.cancelled);

    return {
      ok: !prepostagemCancelled,
      preparedOnly: false,
      message: hasOfficialLabel
        ? 'Pré-postagem Correios liberada e rótulo oficial gerado.'
        : (prepostagemCancelled
          ? 'A pré-postagem foi cancelada pelos Correios durante a geração da DC-e.'
          : (rotuloPending
            ? 'Pré-postagem criada e aguardando a SEFAZ gerar a DC-e. O sistema consultará o status até ficar 2 (Pré-postada) antes de solicitar o rótulo.'
            : 'Pré-postagem Correios liberada, mas o rótulo oficial não foi retornado.')),
      trackingCode: trackingCodeFromPrepostagem,
      labelUrl: officialLabelUrl,
      labelHtml,
      idsPrePostagem,
      prepostagemStatus: consultaPrepostagem.status,
      prepostagemStatusDescricao: consultaPrepostagem.descricao,
      prepostagemPending: Boolean(consultaPrepostagem.pending),
      prepostagemCancelled,
      consultaPrepostagem,
      rotulo,
      rotuloPending,
      rotuloIdRecibo,
      hasOfficialLabel,
      payload: providerPayload,
      quote,
      raw: {
        prepostagem: data,
        consultaPrepostagem: redact(consultaPrepostagem),
        rotulo: redact(rotulo)
      }
    };
  } catch (error) {
    return buildProviderPreparedFallback({
      provider: 'correios',
      shipment,
      quote,
      trackingCode: body.trackingCode,
      payload: providerPayload,
      reason: 'Falha ao comunicar com a API de pré-postagem dos Correios. O pedido foi salvo como preparado internamente.',
      providerError: error?.response?.data || error?.message || String(error),
      statusCode: error?.response?.status || null,
      providerData: error?.response?.data || null
    });
  }
}

async function callFrenetOrder(orderDoc = {}, body = {}) {
  const settings = await getShippingSettings();
  const frenet = settings?.carriers?.frenet || {};
  const token = String(frenet.token || process.env.FRENET_TOKEN || process.env.FRENET_API_TOKEN || '').trim();
  const endpoint = String(process.env.FRENET_ORDER_URL || process.env.FRENET_ORDERS_URL || '').trim();
  const shipment = buildLogisticsShipmentPayload(orderDoc, body, 'frenet');

  const quote = await quoteFrenet({
    cepDestino: shipment.recipient.cep,
    weightKg: shipment.weightKg || undefined,
    lengthCm: shipment.dimensions.lengthCm || undefined,
    widthCm: shipment.dimensions.widthCm || undefined,
    heightCm: shipment.dimensions.heightCm || undefined,
    productPrice: shipment.invoiceValue,
    shippingServiceCode: body.shippingServiceCode || body.serviceCode || body.service || undefined
  }, settings).catch((error) => ({ ok: false, error: error.message || String(error) }));

  if (!token) {
    return buildProviderPreparedFallback({
      provider: 'frenet',
      shipment,
      quote,
      trackingCode: body.trackingCode,
      reason: 'FRENET_TOKEN ausente. Pedido preparado internamente.'
    });
  }

  if (!endpoint) {
    return {
      ok: true,
      preparedOnly: true,
      message: 'Pedido Frenet preparado localmente. Para comprar/emitir etiqueta pela Frenet, configure FRENET_ORDER_URL no Render.',
      trackingCode: String(body.trackingCode || '').trim(),
      labelUrl: '',
      payload: shipment,
      quote,
      raw: { skippedProviderCall: true, reason: 'FRENET_ORDER_URL ausente' }
    };
  }

  if (isProviderBaseUrlOnly(endpoint, 'frenet')) {
    return buildProviderPreparedFallback({
      provider: 'frenet',
      shipment,
      quote,
      trackingCode: body.trackingCode,
      reason: 'FRENET_ORDER_URL aponta apenas para a URL base da API. Informe o endpoint específico de emissão/compra de frete ou deixe vazio para usar romaneio interno.'
    });
  }

  const providerPayload = body.providerPayload && typeof body.providerPayload === 'object'
    ? body.providerPayload
    : buildCorreiosPrepostagemPayload(orderDoc, body, shipment, quote);

  try {
    const response = await axios.post(endpoint, providerPayload, {
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', token },
      timeout: Number(process.env.FRENET_ORDER_TIMEOUT_MS || 30000),
      validateStatus: () => true
    });

    const data = response.data || {};
    if (response.status < 200 || response.status >= 300) {
      const message = data?.Message || data?.message || data?.error || `Frenet order HTTP ${response.status}`;
      return buildProviderPreparedFallback({
        provider: 'frenet',
        shipment,
        quote,
        trackingCode: body.trackingCode,
        payload: providerPayload,
        reason: 'Frenet retornou erro na emissão. O pedido foi salvo como preparado internamente.',
        providerError: message,
        statusCode: response.status
      });
    }

    return {
      ok: true,
      preparedOnly: false,
      message: 'Pedido/etiqueta Frenet enviado ao provedor.',
      trackingCode: extractProviderTrackingCode(data) || String(body.trackingCode || '').trim(),
      labelUrl: extractProviderLabelUrl(data),
      payload: providerPayload,
      quote,
      raw: data
    };
  } catch (error) {
    return buildProviderPreparedFallback({
      provider: 'frenet',
      shipment,
      quote,
      trackingCode: body.trackingCode,
      payload: providerPayload,
      reason: 'Falha ao comunicar com a API da Frenet. O pedido foi salvo como preparado internamente.',
      providerError: error?.response?.data?.Message || error?.response?.data?.message || error?.message || String(error),
      statusCode: error?.response?.status || null
    });
  }
}


async function resolvePendingCorreiosLabel({ order, label, actor = 'system' } = {}) {
  const orderObj = toJSON(order) || order || {};
  const labelObj = toJSON(label) || label || {};
  const orderId = String(orderObj._id || orderObj.id || labelObj.orderId || '').trim();

  if (!orderId) {
    return { ok: false, ready: false, pending: false, error: 'Pedido da etiqueta não encontrado.' };
  }

  const settings = await getShippingSettings().catch(() => ({}));
  const token = await getCorreiosToken(settings);
  const prepostagemEndpoint = String(
    process.env.CORREIOS_PREPOSTAGEM_URL ||
    process.env.CORREIOS_PRE_POSTAGEM_URL ||
    ''
  ).trim().replace(/\/+$/, '');

  if (!prepostagemEndpoint) {
    return { ok: false, ready: false, pending: false, error: 'CORREIOS_PREPOSTAGEM_URL ausente.' };
  }

  const rawProvider = labelObj?.rawProviderResponse || {};
  const prepostagemData =
    rawProvider?.prepostagem ||
    rawProvider?.raw?.prepostagem ||
    orderObj?.shipping?.prepostagem ||
    {};
  const idsPrePostagem = [
    ...extractPrePostagemIds(prepostagemData),
    ...ensureArray(rawProvider?.idsPrePostagem),
    ...ensureArray(rawProvider?.raw?.idsPrePostagem)
  ].map((id) => String(id || '').trim()).filter(Boolean);
  const uniqueIdsPrePostagem = [...new Set(idsPrePostagem)];
  const idPrePostagem = String(uniqueIdsPrePostagem[0] || '').trim();
  const trackingCode = String(
    orderObj?.trackingCode ||
    orderObj?.shipping?.trackingCode ||
    labelObj?.trackingCode ||
    extractProviderTrackingCode(prepostagemData) ||
    ''
  ).trim();

  if (!trackingCode && !idPrePostagem) {
    return {
      ok: false,
      ready: false,
      pending: false,
      error: 'Código de rastreamento ou ID da pré-postagem não encontrado.'
    };
  }

  const consultaPrepostagem = await aguardarCorreiosPrepostagemLiberada({
    token,
    endpoint: prepostagemEndpoint,
    codigoObjeto: trackingCode,
    idPrePostagem,
    statusInicial: extractCorreiosPrepostagemStatus(prepostagemData)
  });

  if (consultaPrepostagem.cancelled) {
    const updatedLabel = await LogisticsLabel.findOneAndUpdate(
      { orderId },
      { $set: {
        status: 'cancelada',
        labelType: 'correios_prepostagem_cancelada',
        notes: 'Pré-postagem cancelada pelos Correios durante a emissão da DC-e.',
        updatedBy: actor,
        'rawProviderResponse.consultaPrepostagem': redact(consultaPrepostagem)
      } },
      { new: true }
    );

    const updatedOrder = await Order.findByIdAndUpdate(orderId, {
      $set: {
        'shipping.labelStatus': 'cancelada',
        'shipping.rotuloPending': false,
        'shipping.prepostagemStatus': 5,
        'shipping.prepostagemStatusDescricao': consultaPrepostagem.descricao || 'Cancelada',
        'shipping.updatedAt': new Date().toISOString()
      }
    }, { new: true });

    return {
      ok: false,
      ready: false,
      pending: false,
      cancelled: true,
      message: consultaPrepostagem.message,
      etiqueta: normalizeLogisticsLabel(updatedLabel),
      order: toJSON(updatedOrder)
    };
  }

  if (!consultaPrepostagem.ready) {
    await LogisticsLabel.findOneAndUpdate(
      { orderId },
      { $set: {
        status: 'prepostagem_pendente',
        labelType: 'correios_prepostagem_pendente',
        notes: 'Aguardando a SEFAZ gerar a DC-e e liberar a pré-postagem.',
        updatedBy: actor,
        'rawProviderResponse.consultaPrepostagem': redact(consultaPrepostagem)
      } },
      { new: true }
    );

    await Order.findByIdAndUpdate(orderId, {
      $set: {
        'shipping.labelStatus': 'prepostagem_pendente',
        'shipping.rotuloPending': true,
        'shipping.prepostagemStatus': consultaPrepostagem.status || 7,
        'shipping.prepostagemStatusDescricao': consultaPrepostagem.descricao || 'Pendente',
        'shipping.updatedAt': new Date().toISOString()
      }
    }, { new: true });

    return {
      ok: true,
      ready: false,
      pending: true,
      status: consultaPrepostagem.status || 7,
      message: consultaPrepostagem.message,
      consultaPrepostagem: redact(consultaPrepostagem)
    };
  }

  const rotulo = await callCorreiosRotulo({
    token,
    endpoint: prepostagemEndpoint,
    idsPrePostagem: uniqueIdsPrePostagem,
    codigoRastreamento: trackingCode,
    tipoRotulo: 'P'
  });

  if (!rotulo.ok || !rotulo.labelUrl) {
    return {
      ok: Boolean(rotulo.pending),
      ready: false,
      pending: Boolean(rotulo.pending),
      status: 2,
      message: rotulo.message || 'A pré-postagem está liberada, mas o PDF oficial ainda não foi retornado.',
      consultaPrepostagem: redact(consultaPrepostagem),
      rotulo: redact(rotulo)
    };
  }

  const pdfDataUrl = String(rotulo.labelUrl || '').trim();
  const officialPdfHtml = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Etiqueta oficial Correios</title><style>html,body{margin:0;height:100%;background:#f3f4f6}.bar{padding:12px;text-align:right;background:#fff;border-bottom:1px solid #ddd}.bar button{padding:10px 16px;border:0;border-radius:8px;background:#0047AB;color:#fff;font-weight:700;cursor:pointer}iframe{width:100%;height:calc(100% - 58px);border:0}</style></head><body><div class="bar"><button onclick="window.print()">Imprimir etiqueta oficial</button></div><iframe src="${pdfDataUrl}"></iframe></body></html>`;

  const updatedLabel = await LogisticsLabel.findOneAndUpdate(
    { orderId },
    { $set: {
      status: 'emitida',
      labelType: 'correios_rotulo_oficial',
      labelUrl: pdfDataUrl,
      labelHtml: officialPdfHtml,
      notes: 'Etiqueta oficial dos Correios emitida com sucesso.',
      updatedBy: actor,
      'rawProviderResponse.consultaPrepostagem': redact(consultaPrepostagem),
      'rawProviderResponse.rotulo': redact(rotulo)
    } },
    { new: true }
  );

  const updatedOrder = await Order.findByIdAndUpdate(orderId, {
    $set: {
      'shipping.labelStatus': 'emitida',
      'shipping.labelType': 'correios_rotulo_oficial',
      'shipping.labelUrl': pdfDataUrl,
      'shipping.rotuloPending': false,
      'shipping.rotuloIdRecibo': String(rotulo.idRecibo || ''),
      'shipping.hasOfficialLabel': true,
      'shipping.prepostagemStatus': 2,
      'shipping.prepostagemStatusDescricao': consultaPrepostagem.descricao || 'Pré-postada',
      'shipping.updatedAt': new Date().toISOString()
    }
  }, { new: true });

  return {
    ok: true,
    ready: true,
    pending: false,
    idRecibo: String(rotulo.idRecibo || ''),
    etiqueta: normalizeLogisticsLabel(updatedLabel),
    order: toJSON(updatedOrder)
  };
}

async function saveProviderLogisticsResult({ order, body = {}, provider = 'manual', providerResult = {}, actor = 'admin', labelType = 'provider_prepared', origin = 'logistica_provider' } = {}) {
  const before = toJSON(order);
  const orderId = String(order._id || order.id || body.orderId || '');
  const service = String(body.service || body.servico || providerResult?.payload?.service || provider || '').trim();
  const trackingCode = String(providerResult.trackingCode || body.trackingCode || before.trackingCode || '').trim();
  const shippingCost = Number(body.shippingCost || providerResult?.quote?.quotes?.[0]?.price || before.shippingCost || 0);
  const hasOfficialLabel = Boolean(providerResult.labelHtml || providerResult.labelUrl);
  const rotuloIdRecibo = String(providerResult.rotuloIdRecibo || providerResult?.rotulo?.idRecibo || providerResult?.rotulo?.firstAsyncRequest?.idRecibo || '').trim();
  const rotuloPending = !hasOfficialLabel && Boolean(providerResult.rotuloPending || providerResult?.rotulo?.pending || rotuloIdRecibo);
  const providerMessage = String(providerResult.message || '').trim();
  const patch = {
    orderId,
    orderObjectId: order._id,
    provider,
    service,
    status: providerResult.preparedOnly
      ? 'preparada'
      : (hasOfficialLabel
        ? 'emitida'
        : (rotuloPending ? 'rotulo_pendente' : (provider === 'correios' ? 'rotulo_indisponivel' : 'emitida'))),
    trackingCode,
    shippingCost,
    volumes: Math.max(1, Number(body.volumes || 1)),
    weightKg: Number(body.weightKg || body.pesoKg || 0),
    heightCm: Number(body.heightCm || body.alturaCm || 0),
    widthCm: Number(body.widthCm || body.larguraCm || 0),
    lengthCm: Number(body.lengthCm || body.comprimentoCm || 0),
    notes: String(
      (hasOfficialLabel
        ? 'Etiqueta oficial dos Correios emitida com sucesso.'
        : (rotuloPending
          ? `Pré-postagem oficial dos Correios emitida com sucesso.${trackingCode ? ` Rastreio: ${trackingCode}.` : ''} Rótulo oficial solicitado e ainda pendente.${rotuloIdRecibo ? ` Recibo: ${rotuloIdRecibo}.` : ''}`
          : (provider === 'correios' && providerResult.preparedOnly === false
            ? `Pré-postagem dos Correios criada.${trackingCode ? ` Rastreio: ${trackingCode}.` : ''} O PDF oficial não foi disponibilizado pela API.`
            : ''))) ||
      body.notes ||
      body.observacoes ||
      providerMessage ||
      ''
    ).trim(),
    labelType: hasOfficialLabel
      ? 'correios_rotulo_oficial'
      : (rotuloPending
        ? 'correios_rotulo_pendente'
        : (provider === 'correios'
          ? (providerResult.preparedOnly === true ? labelType : 'correios_rotulo_indisponivel')
          : labelType)),
    labelUrl: String(providerResult.labelUrl || ''),
    rawProviderResponse: redact(providerResult.raw || providerResult),
    updatedBy: actor
  };

  let label = await LogisticsLabel.findOneAndUpdate(
    { orderId },
    { $set: patch, $setOnInsert: { createdBy: actor } },
    { upsert: true, new: true }
  );
  const officialPdfUrl = String(providerResult.labelUrl || '').trim();
  const officialPdfHtml = officialPdfUrl && officialPdfUrl.startsWith('data:application/pdf')
    ? `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Etiqueta oficial Correios</title><style>html,body{margin:0;height:100%;background:#f3f4f6}.bar{padding:12px;text-align:right;background:#fff;border-bottom:1px solid #ddd}.bar button{padding:10px 16px;border:0;border-radius:8px;background:#0047AB;color:#fff;font-weight:700;cursor:pointer}iframe{width:100%;height:calc(100% - 58px);border:0}</style></head><body><div class="bar"><button onclick="window.print()">Imprimir etiqueta oficial</button></div><iframe src="${officialPdfUrl}"></iframe></body></html>`
    : '';
  const html = String(providerResult.labelHtml || '').trim()
    || officialPdfHtml
    || (provider === 'correios' ? '' : buildManualLogisticsLabelHtml(order, label));
  label = await LogisticsLabel.findByIdAndUpdate(label._id, { $set: { labelHtml: html } }, { new: true });

  const orderPatch = {
    trackingCode,
    shippingCost: shippingCost || before.shippingCost || 0,
    shipping: {
      ...(before.shipping || {}),
      provider,
      service,
      labelId: String(label._id),
      labelStatus: patch.status,
      labelType: patch.labelType,
      labelUrl: patch.labelUrl,
      providerPreparedOnly: providerResult.preparedOnly === true,
      rotuloPending,
      rotuloIdRecibo,
      hasOfficialLabel,
      updatedAt: new Date().toISOString()
    }
  };
  if (String(body.markStatus || '').trim()) {
    orderPatch.status = String(body.markStatus).trim();
    orderPatch.statusLabel = String(body.markStatusLabel || body.markStatus).trim();
  } else if (providerResult.preparedOnly !== true) {
    orderPatch.status = before.status === 'entregue' ? before.status : 'preparando_envio';
    orderPatch.statusLabel = before.status === 'entregue' ? before.statusLabel : 'Preparando envio';
  }

  const after = await Order.findByIdAndUpdate(orderId, { $set: orderPatch }, { new: true });

  await writeAuditLog({
    scope: 'logistics',
    eventType: `${provider}_label_prepared`,
    orderId,
    status: 'success',
    request: { provider, body: redact(body), payload: redact(providerResult.payload || null) },
    response: redact(providerResult.raw || providerResult),
    metadata: { origin, labelId: String(label._id), preparedOnly: providerResult.preparedOnly === true }
  }).catch(() => null);

  let whatsapp = { skipped: true, reason: 'notifyCustomer_false' };
  if (body.notifyCustomer === true && (trackingCode || orderPatch.status)) {
    whatsapp = await waMaybeNotifyOrderStatusChange(orderId, before, toJSON(after), origin).catch((error) => ({ ok: false, error: error.message || String(error) }));
  }

  return { ok: true, etiqueta: normalizeLogisticsLabel(label), order: toJSON(after), providerResult: redact(providerResult), whatsapp };
}

app.get('/api/admin/logistica/provedores', adminRequired, async (_req, res) => {
  const settings = await getShippingSettings().catch(() => ({}));
  const correiosIntegrated = hasCorreiosPrepostagemConfig(settings);
  const frenetIntegrated = hasFrenetOrderConfig(settings);
  return res.json({
    ok: true,
    provedores: [
      { id: 'manual', nome: 'Transportadora manual', integrado: false, enabled: true },
      { id: 'ariana_local', nome: 'Entrega Ariana / parceiro local', integrado: false, enabled: true },
      { id: 'correios', nome: 'Correios', integrado: correiosIntegrated, enabled: !!settings?.carriers?.correios?.enabled, proximaFase: correiosIntegrated ? 'Pré-postagem configurada no backend' : 'Configurar CORREIOS_PREPOSTAGEM_URL no Render' },
      { id: 'frenet', nome: 'Frenet / transportadoras', integrado: frenetIntegrated, enabled: settings?.carriers?.frenet?.enabled !== false, proximaFase: frenetIntegrated ? 'Orders Frenet configurado no backend' : 'Configurar FRENET_ORDER_URL no Render' },
      { id: 'rodocap', nome: 'Rodocap', integrado: false, enabled: settings?.businessRules?.rodocap?.enabled !== false }
    ]
  });
});

app.get('/api/admin/logistica/pedidos', adminRequired, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const status = String(req.query.status || '').trim();
    const limit = Math.max(1, Math.min(Number(req.query.limit || 100), 500));
    const filter = {};
    if (status) filter.status = status;
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      filter.$or = [
        { customerName: rx },
        { customerEmail: rx },
        { customerPhone: rx },
        { trackingCode: rx },
        { status: rx },
        { statusLabel: rx }
      ];
      if (mongoose.Types.ObjectId.isValid(q)) filter.$or.push({ _id: new mongoose.Types.ObjectId(q) });
    }
    const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    const orderIds = orders.map(o => String(o._id));
    const labels = await LogisticsLabel.find({ orderId: { $in: orderIds } }).sort({ updatedAt: -1 }).lean();
    const byOrder = new Map();
    for (const label of labels) if (!byOrder.has(String(label.orderId))) byOrder.set(String(label.orderId), normalizeLogisticsLabel(label));
    return res.json({
      ok: true,
      pedidos: orders.map((order) => {
        const obj = toJSON(order);
        const address = getOrderAddress(obj);
        return {
          ...obj,
          id: String(obj._id || obj.id || ''),
          shortId: String(obj._id || obj.id || '').slice(-8).toUpperCase(),
          logisticsProvider: inferLogisticsProvider(obj),
          address,
          itemsSummary: orderItemsSummary(obj),
          etiqueta: byOrder.get(String(obj._id || obj.id || '')) || null
        };
      })
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar pedidos para logística' });
  }
});

app.post('/api/admin/logistica/etiquetas/manual', adminRequired, async (req, res) => {
  try {
    const orderId = String(req.body?.orderId || '').trim();
    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) return res.status(400).json({ ok: false, error: 'Pedido inválido para gerar etiqueta.' });
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado.' });

    const before = toJSON(order);
    const provider = String(req.body?.provider || inferLogisticsProvider(before) || 'manual').trim();
    const service = String(req.body?.service || req.body?.servico || '').trim();
    const trackingCode = String(req.body?.trackingCode || req.body?.rastreio || before.trackingCode || '').trim();
    const patch = {
      orderId,
      orderObjectId: order._id,
      provider,
      service,
      status: String(req.body?.status || 'gerada').trim(),
      trackingCode,
      shippingCost: Number(req.body?.shippingCost || before.shippingCost || 0),
      volumes: Math.max(1, Number(req.body?.volumes || 1)),
      weightKg: Number(req.body?.weightKg || req.body?.pesoKg || 0),
      heightCm: Number(req.body?.heightCm || req.body?.alturaCm || 0),
      widthCm: Number(req.body?.widthCm || req.body?.larguraCm || 0),
      lengthCm: Number(req.body?.lengthCm || req.body?.comprimentoCm || 0),
      notes: String(req.body?.notes || req.body?.observacoes || '').trim(),
      labelType: 'manual_print',
      updatedBy: req.admin?.email || req.admin?.id || 'admin'
    };
    delete patch.createdBy;

    let label = await LogisticsLabel.findOneAndUpdate(
      { orderId },
      { $set: patch, $setOnInsert: { createdBy: req.admin?.email || req.admin?.id || 'admin' } },
      { upsert: true, new: true }
    );
    const html = buildManualLogisticsLabelHtml(order, label);
    label = await LogisticsLabel.findByIdAndUpdate(label._id, { $set: { labelHtml: html } }, { new: true });

    const updateOrder = {
      trackingCode,
      shipping: {
        ...(before.shipping || {}),
        provider,
        service,
        labelId: String(label._id),
        labelStatus: patch.status,
        labelType: patch.labelType,
        updatedAt: new Date().toISOString()
      }
    };
    if (String(req.body?.markStatus || '').trim()) {
      updateOrder.status = String(req.body.markStatus).trim();
      updateOrder.statusLabel = String(req.body.markStatusLabel || req.body.markStatus).trim();
    }
    const after = await Order.findByIdAndUpdate(orderId, { $set: updateOrder }, { new: true });

    await writeAuditLog({
      scope: 'logistica',
      eventType: 'manual_label_generated',
      orderId,
      status: 'success',
      changedKeys: changedKeys(before, toJSON(after)),
      metadata: { provider, service, trackingCode, labelId: String(label._id), actor: req.admin?.email || req.admin?.id || 'admin' }
    }).catch(() => null);

    const shouldNotify = req.body?.notifyCustomer === true;
    let whatsapp = { skipped: true, reason: 'notifyCustomer_false' };
    if (shouldNotify && (trackingCode || updateOrder.status)) {
      whatsapp = await waMaybeNotifyOrderStatusChange(orderId, before, toJSON(after), 'logistica_label_manual').catch((error) => ({ ok: false, error: error.message || String(error) }));
    }

    return res.json({ ok: true, etiqueta: normalizeLogisticsLabel(label), order: toJSON(after), whatsapp });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao gerar etiqueta manual.' });
  }
});


function sendStoredLogisticsLabel(res, label = {}, fallbackHtml = '') {
  const labelUrl = String(label?.labelUrl || '').trim();
  const provider = String(label?.provider || '').toLowerCase();
  const labelType = String(label?.labelType || '');
  const isCorreios = provider === 'correios' || labelType.startsWith('correios_');
  const hasOfficialPdf = labelUrl.startsWith('data:application/pdf;base64,') || labelType === 'correios_rotulo_oficial';

  if (String(label?.status || '') === 'rotulo_pendente' || labelType === 'correios_rotulo_pendente') {
    return res.status(409).json({ ok: false, pending: true, error: 'Rótulo oficial dos Correios ainda em processamento.' });
  }

  if (isCorreios && !hasOfficialPdf) {
    return res.status(409).json({
      ok: false,
      pending: false,
      error: 'O PDF oficial dos Correios ainda não foi disponibilizado. O romaneio interno não será exibido como etiqueta oficial.'
    });
  }

  if (labelUrl.startsWith('data:application/pdf;base64,')) {
    const base64 = labelUrl.split(',')[1] || '';
    const buffer = Buffer.from(base64, 'base64');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="etiqueta-${String(label?.trackingCode || label?.orderId || 'correios')}.pdf"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Ariana-Label-Reused', 'true');
    return res.send(buffer);
  }

  if (/^https?:\/\//i.test(labelUrl)) {
    return res.redirect(labelUrl);
  }

  if (label?.labelHtml) return res.type('html').send(label.labelHtml);
  return res.type('html').send(fallbackHtml);
}

app.get('/api/admin/logistica/etiquetas/:orderId/html', adminRequired, async (req, res) => {
  try {
    const orderId = String(req.params.orderId || '').trim();
    const label = await LogisticsLabel.findOne({ orderId }).sort({ updatedAt: -1 });
    if (!label) return res.status(404).send('Etiqueta não encontrada para este pedido.');
    const order = mongoose.Types.ObjectId.isValid(orderId) ? await Order.findById(orderId) : null;
    return sendStoredLogisticsLabel(res, label, buildManualLogisticsLabelHtml(order || {}, label));
  } catch (error) {
    return res.status(500).send(error.message || 'Erro ao abrir etiqueta.');
  }
});

app.patch('/api/admin/logistica/rastreio/:orderId', adminRequired, async (req, res) => {
  try {
    const orderId = String(req.params.orderId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(orderId)) return res.status(400).json({ ok: false, error: 'Pedido inválido.' });
    const before = await Order.findById(orderId);
    if (!before) return res.status(404).json({ ok: false, error: 'Pedido não encontrado.' });
    const patch = {
      trackingCode: String(req.body?.trackingCode || '').trim(),
      status: String(req.body?.status || before.status || '').trim(),
      statusLabel: String(req.body?.statusLabel || req.body?.status || before.statusLabel || '').trim()
    };
    const after = await Order.findByIdAndUpdate(orderId, { $set: patch }, { new: true });
    await LogisticsLabel.findOneAndUpdate({ orderId }, { $set: { trackingCode: patch.trackingCode, status: patch.status || 'atualizada', updatedBy: req.admin?.email || req.admin?.id || 'admin' } }, { new: true }).catch(() => null);
    const whatsapp = req.body?.notifyCustomer === true
      ? await waMaybeNotifyOrderStatusChange(orderId, toJSON(before), toJSON(after), 'logistica_tracking_patch').catch((error) => ({ ok: false, error: error.message || String(error) }))
      : { skipped: true, reason: 'notifyCustomer_false' };
    return res.json({ ok: true, order: toJSON(after), whatsapp });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao atualizar rastreio.' });
  }
});


async function reuseExistingCorreiosLabel({ order, actor = 'system' } = {}) {
  const orderId = String(order?._id || order?.id || '').trim();
  if (!orderId) return null;

  const existingLabel = await LogisticsLabel.findOne({ orderId }).sort({ updatedAt: -1 });
  if (!existingLabel) return null;

  const labelObj = normalizeLogisticsLabel(existingLabel);
  const labelUrl = String(labelObj.labelUrl || '').trim();
  const labelType = String(labelObj.labelType || '').trim();
  const hasOfficialPdf =
    labelUrl.startsWith('data:application/pdf;base64,') ||
    /^https?:\/\//i.test(labelUrl) ||
    labelType === 'correios_rotulo_oficial';

  if (hasOfficialPdf) {
    return {
      ok: true,
      reused: true,
      ready: true,
      pending: false,
      message: 'A etiqueta oficial deste pedido já estava salva e foi reutilizada. Nenhuma nova pré-postagem foi criada.',
      etiqueta: labelObj,
      order: toJSON(order),
      providerResult: {
        ok: true,
        reused: true,
        hasOfficialLabel: true,
        labelUrl,
        trackingCode: String(labelObj.trackingCode || order?.trackingCode || '').trim()
      }
    };
  }

  const hasExistingPrepostagem = Boolean(
    String(labelObj.trackingCode || order?.trackingCode || '').trim() ||
    String(order?.shipping?.rotuloIdRecibo || '').trim() ||
    ['rotulo_pendente', 'prepostagem_pendente', 'correios_rotulo_pendente', 'correios_prepostagem_pendente', 'correios_rotulo_indisponivel'].includes(labelType) ||
    ['rotulo_pendente', 'prepostagem_pendente', 'rotulo_indisponivel'].includes(String(labelObj.status || '').trim())
  );

  if (!hasExistingPrepostagem) return null;

  const resolved = await resolvePendingCorreiosLabel({ order, label: existingLabel, actor });
  return {
    ...resolved,
    reused: true,
    message: resolved?.ready
      ? 'A pré-postagem existente foi reutilizada e o PDF oficial foi salvo. Nenhuma nova pré-postagem foi criada.'
      : (resolved?.message || 'A pré-postagem existente foi reutilizada. Nenhuma nova pré-postagem foi criada.'),
    providerResult: {
      ok: resolved?.ok !== false,
      reused: true,
      hasOfficialLabel: Boolean(resolved?.ready || resolved?.etiqueta?.labelUrl),
      labelUrl: String(resolved?.etiqueta?.labelUrl || ''),
      trackingCode: String(resolved?.etiqueta?.trackingCode || order?.trackingCode || '').trim(),
      rotuloPending: Boolean(resolved?.pending)
    }
  };
}

app.post('/api/admin/logistica/etiquetas/correios/preparar', adminRequired, async (req, res) => {
  try {
    const orderId = String(req.body?.orderId || '').trim();
    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) return res.status(400).json({ ok: false, error: 'Pedido inválido para pré-postagem Correios.' });
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado.' });

    const reused = await reuseExistingCorreiosLabel({
      order,
      actor: req.admin?.email || req.auth?.email || 'admin'
    });
    if (reused) return res.json(reused);

    const providerResult = await callCorreiosPrepostagem(order, req.body || {});
    const result = await saveProviderLogisticsResult({
      order,
      body: req.body || {},
      provider: 'correios',
      providerResult,
      actor: req.admin?.email || req.auth?.email || 'admin',
      labelType: providerResult.preparedOnly ? 'correios_prepostagem_preparada' : 'correios_prepostagem_api',
      origin: 'admin_logistica_correios_preparar'
    });
    return res.json(result);
  } catch (error) {
    console.error('[logistica correios preparar]', error);
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao preparar pré-postagem Correios.' });
  }
});



app.post('/api/admin/logistica/etiquetas/correios/:orderId/rotulo', adminRequired, async (req, res) => {
  try {
    const orderId = String(req.params.orderId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(orderId)) return res.status(400).json({ ok: false, error: 'Pedido inválido.' });
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado.' });
    const label = await LogisticsLabel.findOne({ orderId }).sort({ updatedAt: -1 });
    if (!label) return res.status(404).json({ ok: false, error: 'Etiqueta pendente não encontrada.' });
    const result = await resolvePendingCorreiosLabel({ order, label, actor: req.admin?.email || req.auth?.email || 'admin' });
    return res.json(result);
  } catch (error) {
    console.error('[logistica correios consultar rotulo]', error);
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao consultar rótulo oficial dos Correios.' });
  }
});

app.post('/api/admin/logistica/etiquetas/correios/teste', adminRequired, async (req, res) => {
  try {
    const settings = await getShippingSettings().catch(() => ({}));
    const testPayload = {
      cepOrigem: cleanCep(req.body?.cepOrigem || settings?.correios?.origemCep || settings?.carriers?.correios?.origemCep || process.env.LOJA_ORIGEM_CEP || '39740000'),
      cepDestino: cleanCep(req.body?.cepDestino || '01001000'),
      weightKg: Number(req.body?.weightKg || 1),
      lengthCm: Number(req.body?.lengthCm || 20),
      widthCm: Number(req.body?.widthCm || 20),
      heightCm: Number(req.body?.heightCm || 20),
      productPrice: Number(req.body?.productPrice || 10),
      shippingServiceCode: req.body?.shippingServiceCode || req.body?.serviceCode || undefined
    };

    const quote = await quoteCorreios(testPayload, settings).catch((error) => ({
      ok: false,
      error: error.message || String(error)
    }));

    return res.json({
      ok: true,
      teste: true,
      provider: 'correios',
      message: 'Teste executado sem gerar pedido, sem comprar frete e sem criar pré-postagem real.',
      auth: 'admin_ok',
      correios: {
        enabled: settings?.carriers?.correios?.enabled !== false,
        prepostagemEndpointConfigured: Boolean(String(process.env.CORREIOS_PREPOSTAGEM_URL || process.env.CORREIOS_PRE_POSTAGEM_URL || '').trim()),
        tokenConfigured: Boolean(String(process.env.CORREIOS_TOKEN || process.env.CORREIOS_ACCESS_TOKEN || process.env.CORREIOS_BASIC_TOKEN || process.env.CORREIOS_USUARIO || '').trim()),
        originCep: testPayload.cepOrigem
      },
      request: testPayload,
      quote
    });
  } catch (error) {
    console.error('[logistica correios teste]', error);
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao testar Correios.' });
  }
});

app.post('/api/admin/logistica/etiquetas/frenet/preparar', adminRequired, async (req, res) => {
  try {
    const orderId = String(req.body?.orderId || '').trim();
    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) return res.status(400).json({ ok: false, error: 'Pedido inválido para emissão Frenet.' });
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado.' });
    const providerResult = await callFrenetOrder(order, req.body || {});
    const result = await saveProviderLogisticsResult({
      order,
      body: req.body || {},
      provider: 'frenet',
      providerResult,
      actor: req.admin?.email || req.auth?.email || 'admin',
      labelType: providerResult.preparedOnly ? 'frenet_order_preparado' : 'frenet_order_api',
      origin: 'admin_logistica_frenet_preparar'
    });
    return res.json(result);
  } catch (error) {
    console.error('[logistica frenet preparar]', error);
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao preparar pedido Frenet.' });
  }
});

// ============================================================
// LOGÍSTICA / ETIQUETAS - SELLER FILTRADO
// Seller só enxerga e altera pedidos que possuem seu sellerId.
// ============================================================
function sellerCanAccessOrder(orderDoc = {}, sellerId = '') {
  const sid = String(sellerId || '').trim();
  if (!sid) return false;
  return extractSellerIdsFromOrder(orderDoc).includes(sid);
}

app.get('/api/seller/logistica/provedores', sellerAuthRequired, async (_req, res) => {
  const settings = await getShippingSettings().catch(() => ({}));
  return res.json({
    ok: true,
    sellerMode: true,
    provedores: [
      { id: 'manual', nome: 'Transportadora manual', integrado: false, enabled: true },
      { id: 'ariana_local', nome: 'Entrega local / parceiro', integrado: false, enabled: true },
      { id: 'correios', nome: 'Correios', integrado: hasCorreiosPrepostagemConfig(settings), enabled: !!settings?.carriers?.correios?.enabled, proximaFase: hasCorreiosPrepostagemConfig(settings) ? 'Pré-postagem configurada no backend' : 'Configurar CORREIOS_PREPOSTAGEM_URL no Render' },
      { id: 'frenet', nome: 'Frenet / transportadoras', integrado: hasFrenetOrderConfig(settings), enabled: settings?.carriers?.frenet?.enabled !== false, proximaFase: hasFrenetOrderConfig(settings) ? 'Orders Frenet configurado no backend' : 'Configurar FRENET_ORDER_URL no Render' }
    ]
  });
});

app.get('/api/seller/logistica/pedidos', sellerAuthRequired, async (req, res) => {
  try {
    const sid = String(req.sellerId || '').trim();
    if (!sid) return res.status(403).json({ ok: false, error: 'Seller não identificado.' });

    const q = String(req.query.q || '').trim();
    const status = String(req.query.status || '').trim();
    const limit = Math.max(1, Math.min(Number(req.query.limit || 100), 300));
    const sellerFilter = { $or: [{ sellerIds: sid }, { 'items.sellerId': sid }, { manufacturer: sid }] };
    const filter = { $and: [sellerFilter] };

    if (status) filter.$and.push({ status });
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      const qFilter = {
        $or: [
          { customerName: rx },
          { customerEmail: rx },
          { customerPhone: rx },
          { trackingCode: rx },
          { status: rx },
          { statusLabel: rx }
        ]
      };
      if (mongoose.Types.ObjectId.isValid(q)) qFilter.$or.push({ _id: new mongoose.Types.ObjectId(q) });
      filter.$and.push(qFilter);
    }

    const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    const orderIds = orders.map(o => String(o._id));
    const labels = await LogisticsLabel.find({ orderId: { $in: orderIds } }).sort({ updatedAt: -1 }).lean();
    const byOrder = new Map();
    for (const label of labels) if (!byOrder.has(String(label.orderId))) byOrder.set(String(label.orderId), normalizeLogisticsLabel(label));

    return res.json({
      ok: true,
      sellerMode: true,
      pedidos: orders.map((order) => {
        const obj = toJSON(order);
        const address = getOrderAddress(obj);
        return {
          ...obj,
          id: String(obj._id || obj.id || ''),
          shortId: String(obj._id || obj.id || '').slice(-8).toUpperCase(),
          logisticsProvider: inferLogisticsProvider(obj),
          address,
          itemsSummary: orderItemsSummary(obj),
          etiqueta: byOrder.get(String(obj._id || obj.id || '')) || null
        };
      })
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar pedidos do seller para logística' });
  }
});

app.post('/api/seller/logistica/etiquetas/manual', sellerAuthRequired, async (req, res) => {
  try {
    const sid = String(req.sellerId || '').trim();
    const orderId = String(req.body?.orderId || '').trim();
    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) return res.status(400).json({ ok: false, error: 'Pedido inválido para gerar etiqueta.' });

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado.' });
    if (!sellerCanAccessOrder(order, sid)) return res.status(403).json({ ok: false, error: 'Este pedido não pertence ao seller logado.' });

    const before = toJSON(order);
    const provider = String(req.body?.provider || inferLogisticsProvider(before) || 'manual').trim();
    const service = String(req.body?.service || req.body?.servico || '').trim();
    const trackingCode = String(req.body?.trackingCode || req.body?.rastreio || before.trackingCode || '').trim();
    const patch = {
      orderId,
      orderObjectId: order._id,
      provider,
      service,
      status: String(req.body?.status || 'gerada').trim(),
      trackingCode,
      shippingCost: Number(req.body?.shippingCost || before.shippingCost || 0),
      volumes: Math.max(1, Number(req.body?.volumes || 1)),
      weightKg: Number(req.body?.weightKg || req.body?.pesoKg || 0),
      heightCm: Number(req.body?.heightCm || req.body?.alturaCm || 0),
      widthCm: Number(req.body?.widthCm || req.body?.larguraCm || 0),
      lengthCm: Number(req.body?.lengthCm || req.body?.comprimentoCm || 0),
      notes: String(req.body?.notes || req.body?.observacoes || '').trim(),
      labelType: 'seller_manual_print',
      updatedBy: req.seller?.email || req.sellerId || 'seller'
    };

    let label = await LogisticsLabel.findOneAndUpdate(
      { orderId },
      { $set: patch, $setOnInsert: { createdBy: req.seller?.email || req.sellerId || 'seller' } },
      { upsert: true, new: true }
    );
    const html = buildManualLogisticsLabelHtml(order, label);
    label = await LogisticsLabel.findByIdAndUpdate(label._id, { $set: { labelHtml: html } }, { new: true });

    const updateOrder = {
      trackingCode,
      shipping: {
        ...(before.shipping || {}),
        provider,
        service,
        labelId: String(label._id),
        labelStatus: patch.status,
        labelType: patch.labelType,
        updatedAt: new Date().toISOString()
      }
    };
    if (String(req.body?.markStatus || '').trim()) {
      updateOrder.status = String(req.body.markStatus).trim();
      updateOrder.statusLabel = String(req.body.markStatusLabel || req.body.markStatus).trim();
    }

    const after = await Order.findByIdAndUpdate(orderId, { $set: updateOrder }, { new: true });

    await createAdminNotification({
      type: 'seller_logistica_etiqueta',
      title: '🏷️ Seller gerou etiqueta',
      message: `Seller ${req.seller?.storeName || req.seller?.displayName || sid} gerou etiqueta para o pedido #${String(orderId).slice(-8).toUpperCase()}`,
      relatedId: orderId,
      severity: 'info',
      metadata: { sellerId: sid, provider, service, trackingCode, labelId: String(label._id), origin: 'seller_logistica_label' }
    }).catch(() => null);

    const shouldNotify = req.body?.notifyCustomer === true;
    let whatsapp = { skipped: true, reason: 'notifyCustomer_false' };
    if (shouldNotify && (trackingCode || updateOrder.status)) {
      whatsapp = await waMaybeNotifyOrderStatusChange(orderId, before, toJSON(after), 'seller_logistica_label_manual').catch((error) => ({ ok: false, error: error.message || String(error) }));
    }

    return res.json({ ok: true, etiqueta: normalizeLogisticsLabel(label), order: toJSON(after), whatsapp });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao gerar etiqueta do seller.' });
  }
});


app.post('/api/seller/logistica/etiquetas/correios/preparar', sellerAuthRequired, async (req, res) => {
  try {
    const sid = String(req.sellerId || '').trim();
    const orderId = String(req.body?.orderId || '').trim();
    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) return res.status(400).json({ ok: false, error: 'Pedido inválido para pré-postagem Correios.' });
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado.' });
    if (!sellerCanAccessOrder(order, sid)) return res.status(403).json({ ok: false, error: 'Este pedido não pertence ao seller logado.' });

    const reused = await reuseExistingCorreiosLabel({
      order,
      actor: req.seller?.email || req.sellerId || 'seller'
    });
    if (reused) return res.json(reused);

    const providerResult = await callCorreiosPrepostagem(order, req.body || {});
    const result = await saveProviderLogisticsResult({
      order,
      body: req.body || {},
      provider: 'correios',
      providerResult,
      actor: req.seller?.email || req.sellerId || 'seller',
      labelType: providerResult.preparedOnly ? 'seller_correios_prepostagem_preparada' : 'seller_correios_prepostagem_api',
      origin: 'seller_logistica_correios_preparar'
    });
    await createAdminNotification({
      type: 'seller_logistica_correios',
      title: '📮 Seller preparou Correios',
      message: `Seller ${req.seller?.storeName || req.seller?.displayName || sid} preparou Correios para o pedido #${orderId.slice(-8).toUpperCase()}`,
      relatedId: orderId,
      severity: 'info',
      metadata: { sellerId: sid, preparedOnly: providerResult.preparedOnly === true }
    }).catch(() => null);
    return res.json(result);
  } catch (error) {
    console.error('[seller logistica correios preparar]', error);
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao preparar Correios do seller.' });
  }
});



app.post('/api/seller/logistica/etiquetas/correios/:orderId/rotulo', sellerAuthRequired, async (req, res) => {
  try {
    const sid = String(req.sellerId || '').trim();
    const orderId = String(req.params.orderId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(orderId)) return res.status(400).json({ ok: false, error: 'Pedido inválido.' });
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado.' });
    if (!sellerCanAccessOrder(order, sid)) return res.status(403).json({ ok: false, error: 'Este pedido não pertence ao seller logado.' });
    const label = await LogisticsLabel.findOne({ orderId }).sort({ updatedAt: -1 });
    if (!label) return res.status(404).json({ ok: false, error: 'Etiqueta pendente não encontrada.' });
    const result = await resolvePendingCorreiosLabel({ order, label, actor: req.seller?.email || req.sellerId || 'seller' });
    return res.json(result);
  } catch (error) {
    console.error('[seller logistica correios consultar rotulo]', error);
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao consultar rótulo oficial dos Correios.' });
  }
});

app.post('/api/seller/logistica/etiquetas/correios/teste', sellerAuthRequired, async (req, res) => {
  try {
    const settings = await getShippingSettings().catch(() => ({}));
    const testPayload = {
      cepOrigem: cleanCep(req.body?.cepOrigem || settings?.correios?.origemCep || settings?.carriers?.correios?.origemCep || process.env.LOJA_ORIGEM_CEP || '39740000'),
      cepDestino: cleanCep(req.body?.cepDestino || '01001000'),
      weightKg: Number(req.body?.weightKg || 1),
      lengthCm: Number(req.body?.lengthCm || 20),
      widthCm: Number(req.body?.widthCm || 20),
      heightCm: Number(req.body?.heightCm || 20),
      productPrice: Number(req.body?.productPrice || 10),
      shippingServiceCode: req.body?.shippingServiceCode || req.body?.serviceCode || undefined
    };

    const quote = await quoteCorreios(testPayload, settings).catch((error) => ({
      ok: false,
      error: error.message || String(error)
    }));

    return res.json({
      ok: true,
      teste: true,
      provider: 'correios',
      message: 'Teste executado pelo seller sem gerar pedido, sem comprar frete e sem criar pré-postagem real.',
      auth: 'seller_ok',
      sellerId: req.sellerId || '',
      correios: {
        enabled: settings?.carriers?.correios?.enabled !== false,
        prepostagemEndpointConfigured: Boolean(String(process.env.CORREIOS_PREPOSTAGEM_URL || process.env.CORREIOS_PRE_POSTAGEM_URL || '').trim()),
        tokenConfigured: Boolean(String(process.env.CORREIOS_TOKEN || process.env.CORREIOS_ACCESS_TOKEN || process.env.CORREIOS_BASIC_TOKEN || process.env.CORREIOS_USUARIO || '').trim()),
        originCep: testPayload.cepOrigem
      },
      request: testPayload,
      quote
    });
  } catch (error) {
    console.error('[seller logistica correios teste]', error);
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao testar Correios do seller.' });
  }
});

app.post('/api/seller/logistica/etiquetas/frenet/preparar', sellerAuthRequired, async (req, res) => {
  try {
    const sid = String(req.sellerId || '').trim();
    const orderId = String(req.body?.orderId || '').trim();
    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) return res.status(400).json({ ok: false, error: 'Pedido inválido para emissão Frenet.' });
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado.' });
    if (!sellerCanAccessOrder(order, sid)) return res.status(403).json({ ok: false, error: 'Este pedido não pertence ao seller logado.' });
    const providerResult = await callFrenetOrder(order, req.body || {});
    const result = await saveProviderLogisticsResult({
      order,
      body: req.body || {},
      provider: 'frenet',
      providerResult,
      actor: req.seller?.email || req.sellerId || 'seller',
      labelType: providerResult.preparedOnly ? 'seller_frenet_order_preparado' : 'seller_frenet_order_api',
      origin: 'seller_logistica_frenet_preparar'
    });
    await createAdminNotification({
      type: 'seller_logistica_frenet',
      title: '🚚 Seller preparou Frenet',
      message: `Seller ${req.seller?.storeName || req.seller?.displayName || sid} preparou Frenet para o pedido #${orderId.slice(-8).toUpperCase()}`,
      relatedId: orderId,
      severity: 'info',
      metadata: { sellerId: sid, preparedOnly: providerResult.preparedOnly === true }
    }).catch(() => null);
    return res.json(result);
  } catch (error) {
    console.error('[seller logistica frenet preparar]', error);
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao preparar Frenet do seller.' });
  }
});

app.get('/api/seller/logistica/etiquetas/:orderId/html', sellerAuthRequired, async (req, res) => {
  try {
    const sid = String(req.sellerId || '').trim();
    const orderId = String(req.params.orderId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(orderId)) return res.status(400).send('Pedido inválido.');
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).send('Pedido não encontrado.');
    if (!sellerCanAccessOrder(order, sid)) return res.status(403).send('Este pedido não pertence ao seller logado.');

    const label = await LogisticsLabel.findOne({ orderId }).sort({ updatedAt: -1 });
    if (!label) return res.status(404).send('Etiqueta não encontrada para este pedido.');
    return sendStoredLogisticsLabel(res, label, buildManualLogisticsLabelHtml(order, label));
  } catch (error) {
    return res.status(500).send(error.message || 'Erro ao abrir etiqueta do seller.');
  }
});

app.patch('/api/seller/logistica/rastreio/:orderId', sellerAuthRequired, async (req, res) => {
  try {
    const sid = String(req.sellerId || '').trim();
    const orderId = String(req.params.orderId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(orderId)) return res.status(400).json({ ok: false, error: 'Pedido inválido.' });
    const before = await Order.findById(orderId);
    if (!before) return res.status(404).json({ ok: false, error: 'Pedido não encontrado.' });
    if (!sellerCanAccessOrder(before, sid)) return res.status(403).json({ ok: false, error: 'Este pedido não pertence ao seller logado.' });

    const patch = {
      trackingCode: String(req.body?.trackingCode || '').trim(),
      status: String(req.body?.status || before.status || '').trim(),
      statusLabel: String(req.body?.statusLabel || req.body?.status || before.statusLabel || '').trim()
    };
    const after = await Order.findByIdAndUpdate(orderId, { $set: patch }, { new: true });
    await LogisticsLabel.findOneAndUpdate({ orderId }, { $set: { trackingCode: patch.trackingCode, status: patch.status || 'atualizada', updatedBy: req.seller?.email || req.sellerId || 'seller' } }, { new: true }).catch(() => null);

    await createAdminNotification({
      type: 'seller_logistica_rastreio',
      title: '🚚 Seller atualizou rastreio',
      message: `Seller ${req.seller?.storeName || req.seller?.displayName || sid} atualizou rastreio do pedido #${String(orderId).slice(-8).toUpperCase()}`,
      relatedId: orderId,
      severity: 'success',
      metadata: { sellerId: sid, trackingCode: patch.trackingCode, origin: 'seller_logistica_tracking' }
    }).catch(() => null);

    const whatsapp = req.body?.notifyCustomer === true
      ? await waMaybeNotifyOrderStatusChange(orderId, toJSON(before), toJSON(after), 'seller_logistica_tracking_patch').catch((error) => ({ ok: false, error: error.message || String(error) }))
      : { skipped: true, reason: 'notifyCustomer_false' };
    return res.json({ ok: true, order: toJSON(after), whatsapp });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao atualizar rastreio do seller.' });
  }
});



}
