import crypto from 'crypto';
import sharp from 'sharp';

const OPENAI_IMAGES_EDIT_URL = 'https://api.openai.com/v1/images/edits';
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_IMAGE_MODEL = String(process.env.CREATIVE_REBUILD_IMAGE_MODEL || 'gpt-image-2').trim();
const DEFAULT_VALIDATION_MODEL = String(
  process.env.CREATIVE_REBUILD_VALIDATION_MODEL ||
  process.env.CREATIVE_AI_MODEL ||
  'gpt-5.6-luna'
).trim();
const CACHE_TTL_MS = Number(process.env.CREATIVE_REBUILD_CACHE_TTL_MS || 6 * 60 * 60 * 1000);
const CACHE_LIMIT = Number(process.env.CREATIVE_REBUILD_CACHE_LIMIT || 40);
const PROMPT_VERSION = 'ariana-product-rebuild/v1';

export const DIFFICULT_PRODUCT_PATTERN =
  /(ventilador|fan\b|cadeira|banqueta|cesto|fruteira|grade|grelha|ripa|ripado|aramad|treli[cç]a|tela\b|estrutura\s+vazada|vazad[oa])/i;

const cache = new Map();
const inflight = new Map();

function enabledFromEnv() {
  return ['1', 'true', 'yes', 'on'].includes(
    String(process.env.CREATIVE_PRODUCT_REBUILD_ENABLED || '').trim().toLowerCase()
  );
}

function clean(value = '', max = 220) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function isDifficultCreativeProduct(productText = '') {
  return DIFFICULT_PRODUCT_PATTERN.test(String(productText || '').toLowerCase());
}

export function shouldRebuildCreativeProduct(asset = {}, productText = '') {
  const difficult = isDifficultCreativeProduct(productText);
  const repair = asset.repairMetrics || {};
  const alreadyCleanAlpha =
    String(asset.removalMode || '').startsWith('existing_alpha') &&
    asset.backgroundRemoved &&
    asset.cutoutSafe !== false &&
    repair.internalBackgroundOk !== false &&
    repair.whiteHaloOk !== false;

  if (alreadyCleanAlpha) {
    return { required: false, difficult, reason: 'clean_existing_alpha' };
  }

  if (difficult) {
    return { required: true, difficult: true, reason: 'difficult_product_structure' };
  }

  if (asset.cutoutSafe === false || !asset.backgroundRemoved) {
    return { required: true, difficult: false, reason: asset.cutoutReason || 'cutout_failed' };
  }

  if (repair.autoDetectedPorousStructure) {
    return { required: true, difficult: false, reason: 'porous_structure_detected' };
  }

  if (repair.internalBackgroundOk === false) {
    return { required: true, difficult: false, reason: 'internal_background_contamination' };
  }

  if (repair.whiteHaloOk === false) {
    return { required: true, difficult: false, reason: 'white_halo_residual' };
  }

  return { required: false, difficult: false, reason: 'not_required' };
}

function cacheGet(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() - item.createdAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, item);
  return item.value;
}

function cacheSet(key, value) {
  cache.delete(key);
  cache.set(key, { createdAt: Date.now(), value });
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

async function prepareReferencePng(buffer) {
  const source = sharp(buffer, { failOn: 'none' }).rotate();
  const meta = await source.metadata();
  const width = Number(meta.width || 0);
  const height = Number(meta.height || 0);
  const outputSize =
    height > width * 1.22
      ? '1024x1536'
      : width > height * 1.22
        ? '1536x1024'
        : '1024x1024';

  const png = await source
    .resize({
      width: 1536,
      height: 1536,
      fit: 'inside',
      withoutEnlargement: true
    })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();

  return {
    buffer: png,
    sourceWidth: width,
    sourceHeight: height,
    outputSize
  };
}

export function buildProductRebuildPrompt(productText = '') {
  const label = clean(productText, 180) || 'produto';
  return [
    'Use a imagem enviada como referência visual obrigatória do mesmo produto: ' + label + '.',
    'Reconstrua uma fotografia de catálogo extremamente fiel ao produto real da referência.',
    'Mantenha exatamente a silhueta, proporções, cor, quantidade e posição das partes, formato da base, pés, hastes, grades, ripas, pás, cestos, braços e demais elementos visíveis.',
    'Não redesenhe, não modernize, não troque peças, não acrescente acessórios e não altere o modelo.',
    'Preserve a marca e os elementos gráficos existentes. Se um texto minúsculo não puder ser lido com segurança, não invente palavras diferentes.',
    'O produto inteiro deve aparecer centralizado, sem corte, no mesmo ângulo frontal ou quase frontal da referência.',
    'Remova totalmente o cenário e gere fundo realmente transparente.',
    'Toda área fisicamente vazada deve ficar transparente: espaços entre grades, arames, ripas, pernas, pés, base e haste.',
    'Não deixe branco, cinza ou qualquer preenchimento preso dentro dos vazados.',
    'Bordas limpas e naturais, sem halo branco, sem serrilhado e sem aparência de recorte.',
    'Não adicione chão, sombra projetada, pedestal extra, texto publicitário, moldura ou cenário.',
    'Resultado final: packshot fotográfico realista do MESMO produto em PNG transparente.'
  ].join('\n');
}

async function callImageEdit(reference, productText, {
  fetchImpl = fetch,
  apiKey = String(process.env.OPENAI_API_KEY || '').trim(),
  imageModel = DEFAULT_IMAGE_MODEL,
  timeoutMs = Number(process.env.CREATIVE_REBUILD_TIMEOUT_MS || 115000)
} = {}) {
  if (!apiKey) throw new Error('creative_rebuild_openai_key_missing');

  const form = new FormData();
  form.append('model', imageModel);
  form.append('prompt', buildProductRebuildPrompt(productText));
  form.append('background', 'transparent');
  form.append('output_format', 'png');
  form.append('quality', 'high');
  form.append('size', reference.outputSize);
  form.append(
    'image[]',
    new Blob([reference.buffer], { type: 'image/png' }),
    'ariana-product-reference.png'
  );

  const response = await fetchImpl(OPENAI_IMAGES_EDIT_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + apiKey
    },
    body: form,
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error('creative_rebuild_http_' + response.status + ':' + body.slice(0, 180));
  }

  const data = await response.json();
  const encoded = data?.data?.[0]?.b64_json;
  if (!encoded) throw new Error('creative_rebuild_empty_image');
  return {
    buffer: Buffer.from(encoded, 'base64'),
    model: imageModel,
    requestId: response.headers?.get?.('x-request-id') || ''
  };
}

function responseText(data = {}) {
  if (typeof data.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }
  for (const item of Array.isArray(data.output) ? data.output : []) {
    if (item?.type !== 'message') continue;
    for (const part of Array.isArray(item.content) ? item.content : []) {
      if (part?.type === 'output_text' && typeof part.text === 'string' && part.text.trim()) {
        return part.text.trim();
      }
    }
  }
  return '';
}

const VALIDATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'sameProduct',
    'silhouetteFaithful',
    'structureFaithful',
    'brandingFaithful',
    'voidsClean',
    'noExtraObjects',
    'confidence',
    'reason'
  ],
  properties: {
    sameProduct: { type: 'boolean' },
    silhouetteFaithful: { type: 'boolean' },
    structureFaithful: { type: 'boolean' },
    brandingFaithful: { type: 'boolean' },
    voidsClean: { type: 'boolean' },
    noExtraObjects: { type: 'boolean' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    reason: { type: 'string' }
  }
};

async function callVisionValidation(referenceBuffer, rebuiltBuffer, productText, {
  fetchImpl = fetch,
  apiKey = String(process.env.OPENAI_API_KEY || '').trim(),
  validationModel = DEFAULT_VALIDATION_MODEL,
  timeoutMs = Number(process.env.CREATIVE_REBUILD_VALIDATION_TIMEOUT_MS || 30000)
} = {}) {
  if (!apiKey) throw new Error('creative_rebuild_validation_key_missing');

  const prompt = [
    'Você é o controle de qualidade visual da Ariana Móveis.',
    'Compare a PRIMEIRA imagem (referência original) com a SEGUNDA imagem (produto reconstruído).',
    'O reconstruído só pode ser aprovado se representar o mesmo produto real, sem redesign.',
    'Verifique silhueta, proporções, quantidade e posição das partes, base/pés/hastes/grades/pás/ripas, cores e marca.',
    'Para estruturas vazadas, confirme que os espaços que deveriam ser abertos estão transparentes/limpos e que nenhuma grade ou peça real foi apagada.',
    'Reprove se houver peças inventadas, produto diferente, base diferente, número de pás/partes diferente, marca trocada, vazados preenchidos ou estrutura deformada.',
    'Produto informado: ' + clean(productText, 180)
  ].join('\n');

  const body = {
    model: validationModel,
    store: false,
    reasoning: { effort: 'low' },
    input: [{
      role: 'user',
      content: [
        { type: 'input_text', text: prompt },
        {
          type: 'input_image',
          image_url: 'data:image/png;base64,' + referenceBuffer.toString('base64'),
          detail: 'high'
        },
        {
          type: 'input_image',
          image_url: 'data:image/png;base64,' + rebuiltBuffer.toString('base64'),
          detail: 'high'
        }
      ]
    }],
    text: {
      verbosity: 'low',
      format: {
        type: 'json_schema',
        name: 'ariana_product_rebuild_quality',
        strict: true,
        schema: VALIDATION_SCHEMA
      }
    }
  };

  const response = await fetchImpl(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    const responseBody = await response.text().catch(() => '');
    throw new Error('creative_rebuild_validation_http_' + response.status + ':' + responseBody.slice(0, 180));
  }

  const data = await response.json();
  const text = responseText(data);
  if (!text) throw new Error('creative_rebuild_validation_empty');
  const parsed = JSON.parse(text);

  const safe = Boolean(
    parsed.sameProduct &&
    parsed.silhouetteFaithful &&
    parsed.structureFaithful &&
    parsed.brandingFaithful &&
    parsed.voidsClean &&
    parsed.noExtraObjects &&
    Number(parsed.confidence || 0) >= 0.78
  );

  return {
    safe,
    model: data.model || validationModel,
    sameProduct: Boolean(parsed.sameProduct),
    silhouetteFaithful: Boolean(parsed.silhouetteFaithful),
    structureFaithful: Boolean(parsed.structureFaithful),
    brandingFaithful: Boolean(parsed.brandingFaithful),
    voidsClean: Boolean(parsed.voidsClean),
    noExtraObjects: Boolean(parsed.noExtraObjects),
    confidence: clamp(Number(parsed.confidence || 0), 0, 1),
    reason: clean(parsed.reason || (safe ? 'ok' : 'visual_fidelity_failed'), 220)
  };
}

async function inspectTransparentOutput(buffer) {
  const image = sharp(buffer, { failOn: 'none' }).rotate().ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const total = info.width * info.height;
  let transparent = 0;
  let opaque = 0;
  let partial = 0;

  for (let i = 0; i < total; i += 1) {
    const alpha = data[i * info.channels + 3];
    if (alpha < 24) transparent += 1;
    else if (alpha >= 224) opaque += 1;
    else partial += 1;
  }

  const transparentRatio = transparent / Math.max(1, total);
  const opaqueRatio = opaque / Math.max(1, total);
  const partialRatio = partial / Math.max(1, total);
  const safe =
    info.width >= 700 &&
    info.height >= 700 &&
    transparentRatio >= 0.08 &&
    transparentRatio <= 0.96 &&
    opaqueRatio >= 0.025 &&
    partialRatio <= 0.28;

  const normalized = await sharp(data, { raw: info })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  const trimmed = await sharp(normalized)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  const meta = await sharp(trimmed).metadata();

  return {
    safe,
    buffer: trimmed,
    width: Number(meta.width || info.width),
    height: Number(meta.height || info.height),
    transparentRatio,
    opaqueRatio,
    partialRatio
  };
}

function failedAsset(asset, eligibility, enabled, reason, details = {}) {
  return {
    ...asset,
    backgroundRemoved: false,
    cutoutSafe: false,
    cutoutReason: reason,
    removalMode: 'ai_rebuild_blocked',
    confidence: 0,
    rebuildMetrics: {
      enabled,
      required: eligibility.required,
      difficultProduct: eligibility.difficult,
      eligibilityReason: eligibility.reason,
      attempted: Boolean(details.attempted),
      safe: false,
      reason,
      ...details
    }
  };
}

export async function rebuildCreativeProductFromReference({
  referenceBuffer,
  asset,
  productText = '',
  enabled = enabledFromEnv(),
  fetchImpl = fetch,
  apiKey = String(process.env.OPENAI_API_KEY || '').trim(),
  imageModel = DEFAULT_IMAGE_MODEL,
  validationModel = DEFAULT_VALIDATION_MODEL
} = {}) {
  const eligibility = shouldRebuildCreativeProduct(asset, productText);

  if (!eligibility.required) {
    return {
      ...asset,
      rebuildMetrics: {
        enabled,
        required: false,
        difficultProduct: eligibility.difficult,
        eligibilityReason: eligibility.reason,
        attempted: false,
        safe: true,
        reason: eligibility.reason
      }
    };
  }

  if (!enabled) {
    return {
      ...asset,
      rebuildMetrics: {
        enabled: false,
        required: true,
        difficultProduct: eligibility.difficult,
        eligibilityReason: eligibility.reason,
        attempted: false,
        safe: asset.cutoutSafe !== false && Boolean(asset.backgroundRemoved),
        reason: 'ai_rebuild_disabled'
      }
    };
  }

  if (!apiKey) {
    return failedAsset(asset, eligibility, true, 'ai_rebuild_not_configured');
  }

  if (!referenceBuffer) {
    return failedAsset(asset, eligibility, true, 'ai_rebuild_reference_missing');
  }

  const reference = await prepareReferencePng(referenceBuffer);
  const key = crypto
    .createHash('sha256')
    .update(PROMPT_VERSION)
    .update(imageModel)
    .update(validationModel)
    .update(productText)
    .update(reference.buffer)
    .digest('hex');

  const cached = cacheGet(key);
  if (cached) {
    return {
      ...cached,
      rebuildMetrics: {
        ...cached.rebuildMetrics,
        cacheHit: true
      }
    };
  }

  if (inflight.has(key)) return inflight.get(key);

  const job = (async () => {
    try {
      const generated = await callImageEdit(reference, productText, {
        fetchImpl,
        apiKey,
        imageModel
      });
      const output = await inspectTransparentOutput(generated.buffer);
      if (!output.safe) {
        return failedAsset(asset, eligibility, true, 'ai_rebuild_transparency_quality_failed', {
          attempted: true,
          model: generated.model,
          transparentRatio: output.transparentRatio,
          opaqueRatio: output.opaqueRatio,
          partialRatio: output.partialRatio
        });
      }

      const validation = await callVisionValidation(
        reference.buffer,
        output.buffer,
        productText,
        {
          fetchImpl,
          apiKey,
          validationModel
        }
      );

      if (!validation.safe) {
        return failedAsset(asset, eligibility, true, 'ai_rebuild_visual_fidelity_failed', {
          attempted: true,
          model: generated.model,
          validation,
          transparentRatio: output.transparentRatio,
          opaqueRatio: output.opaqueRatio,
          partialRatio: output.partialRatio
        });
      }

      const result = {
        ...asset,
        buffer: output.buffer,
        width: output.width,
        height: output.height,
        backgroundRemoved: true,
        cutoutSafe: true,
        cutoutReason: 'ok',
        removalMode: 'ai_reference_rebuild',
        removedRatio: output.transparentRatio,
        confidence: Math.max(Number(asset.confidence || 0), validation.confidence),
        rebuildMetrics: {
          enabled: true,
          required: true,
          difficultProduct: eligibility.difficult,
          eligibilityReason: eligibility.reason,
          attempted: true,
          safe: true,
          reason: 'ok',
          model: generated.model,
          validationModel: validation.model,
          validation,
          transparentRatio: output.transparentRatio,
          opaqueRatio: output.opaqueRatio,
          partialRatio: output.partialRatio,
          cacheHit: false
        }
      };

      cacheSet(key, result);
      return result;
    } catch (error) {
      console.warn('[creative-product-rebuild] reconstrução bloqueada:', error?.message || error);
      return failedAsset(asset, eligibility, true, 'ai_rebuild_failed', {
        attempted: true,
        error: clean(error?.message || 'creative_rebuild_failed', 180)
      });
    }
  })();

  inflight.set(key, job);
  try {
    return await job;
  } finally {
    inflight.delete(key);
  }
}

export function getCreativeProductRebuildStatus() {
  return {
    enabled: enabledFromEnv(),
    imageModel: DEFAULT_IMAGE_MODEL,
    validationModel: DEFAULT_VALIDATION_MODEL,
    configured: Boolean(String(process.env.OPENAI_API_KEY || '').trim()),
    cacheSize: cache.size,
    promptVersion: PROMPT_VERSION
  };
}
