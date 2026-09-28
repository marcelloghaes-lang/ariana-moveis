import sharp from 'sharp';

const DIFFICULT_PRODUCT_PATTERN =
  /(ventilador|fan\b|cadeira|banqueta|cesto|fruteira|grade|grelha|ripa|ripado|aramad|treli[cç]a|tela\b|estrutura\s+vazada|vazad[oa])/i;
const FAN_PRODUCT_PATTERN = /(ventilador|fan\b)/i;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isDifficultProduct(productText = '') {
  return DIFFICULT_PRODUCT_PATTERN.test(String(productText || '').toLowerCase());
}

function isFanProduct(productText = '') {
  return FAN_PRODUCT_PATTERN.test(String(productText || '').toLowerCase());
}

function rgbDistance(data, pixelOffset, background) {
  const dr = data[pixelOffset] - background.r;
  const dg = data[pixelOffset + 1] - background.g;
  const db = data[pixelOffset + 2] - background.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function pixelBrightness(data, pixelOffset) {
  return (data[pixelOffset] + data[pixelOffset + 1] + data[pixelOffset + 2]) / 3;
}

function pixelSpread(data, pixelOffset) {
  return Math.max(data[pixelOffset], data[pixelOffset + 1], data[pixelOffset + 2])
    - Math.min(data[pixelOffset], data[pixelOffset + 1], data[pixelOffset + 2]);
}

function estimateLightBackground(data, info) {
  const { width, height, channels } = info;
  const samples = [];
  const push = (index) => {
    const p = index * channels;
    const brightness = pixelBrightness(data, p);
    const alpha = data[p + 3];
    if (brightness >= 185 || alpha >= 40) {
      samples.push({
        r: data[p],
        g: data[p + 1],
        b: data[p + 2],
        brightness
      });
    }
  };

  const stepX = Math.max(1, Math.floor(width / 80));
  const stepY = Math.max(1, Math.floor(height / 80));
  for (let x = 0; x < width; x += stepX) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += stepY) {
    push(y * width);
    push(y * width + width - 1);
  }

  const light = samples.filter(item => item.brightness >= 205);
  const usable = light.length >= 8 ? light : samples;
  if (!usable.length) {
    return { r: 255, g: 255, b: 255, brightness: 255, variance: 9999 };
  }

  const mean = usable.reduce((acc, item) => {
    acc.r += item.r;
    acc.g += item.g;
    acc.b += item.b;
    acc.brightness += item.brightness;
    return acc;
  }, { r: 0, g: 0, b: 0, brightness: 0 });

  mean.r /= usable.length;
  mean.g /= usable.length;
  mean.b /= usable.length;
  mean.brightness /= usable.length;

  let variance = 0;
  for (const item of usable) {
    const delta = item.brightness - mean.brightness;
    variance += delta * delta;
  }
  variance /= usable.length;

  return {
    r: mean.r,
    g: mean.g,
    b: mean.b,
    brightness: mean.brightness,
    variance,
    spread: Math.max(mean.r, mean.g, mean.b) - Math.min(mean.r, mean.g, mean.b)
  };
}

function backgroundLike(data, index, info, background, {
  maxDistance = 26,
  minBrightness = 230,
  maxSpread = 34,
  minAlpha = 48
} = {}) {
  const p = index * info.channels;
  const alpha = data[p + 3];
  if (alpha < minAlpha) return false;
  const brightness = pixelBrightness(data, p);
  if (brightness < minBrightness) return false;
  if (pixelSpread(data, p) > maxSpread) return false;
  return rgbDistance(data, p, background) <= maxDistance;
}

function opaqueCount(data, info, threshold = 40) {
  let count = 0;
  const total = info.width * info.height;
  for (let i = 0; i < total; i += 1) {
    if (data[i * info.channels + 3] >= threshold) count += 1;
  }
  return count;
}

function transparentRatio(data, info, threshold = 40) {
  const total = info.width * info.height;
  let transparent = 0;
  for (let i = 0; i < total; i += 1) {
    if (data[i * info.channels + 3] < threshold) transparent += 1;
  }
  return transparent / Math.max(1, total);
}

function alphaStructureStats(data, info, threshold = 48) {
  const { width, height, channels } = info;
  const total = width * height;
  const opaque = new Uint8Array(total);
  let opaquePixels = 0;

  for (let i = 0; i < total; i += 1) {
    if (data[i * channels + 3] >= threshold) {
      opaque[i] = 1;
      opaquePixels += 1;
    }
  }

  if (!opaquePixels) {
    return {
      opaqueRatio: 0,
      majorComponents: 0,
      largestShare: 0
    };
  }

  const seen = new Uint8Array(total);
  const queue = new Int32Array(total);
  const components = [];

  for (let start = 0; start < total; start += 1) {
    if (!opaque[start] || seen[start]) continue;
    let head = 0;
    let tail = 0;
    let count = 0;
    queue[tail++] = start;
    seen[start] = 1;

    while (head < tail) {
      const index = queue[head++];
      count += 1;
      const x = index % width;
      const y = Math.floor(index / width);
      const neighbors = [];
      if (x > 0) neighbors.push(index - 1);
      if (x + 1 < width) neighbors.push(index + 1);
      if (y > 0) neighbors.push(index - width);
      if (y + 1 < height) neighbors.push(index + width);

      for (const next of neighbors) {
        if (opaque[next] && !seen[next]) {
          seen[next] = 1;
          queue[tail++] = next;
        }
      }
    }

    components.push(count);
  }

  components.sort((a, b) => b - a);
  const largest = components[0] || 0;
  const majorThreshold = Math.max(18, Math.round(opaquePixels * 0.006));
  const majorComponents = components.filter(value => value >= majorThreshold).length;

  return {
    opaqueRatio: opaquePixels / Math.max(1, total),
    majorComponents,
    largestShare: largest / Math.max(1, opaquePixels)
  };
}

function adaptiveBackgroundThresholds(background = {}) {
  const brightness = Number(background.brightness || 0);
  const variance = Math.max(0, Number(background.variance || 0));
  const spread = Math.max(0, Number(background.spread || 0));
  return {
    eligible: brightness >= 178 && variance <= 2200,
    maxDistance: clamp(28 + Math.sqrt(variance) * 0.32, 28, 50),
    minBrightness: clamp(brightness - 38, 158, 232),
    maxSpread: clamp(spread + 30, 34, 92)
  };
}

function foregroundSignalCount(data, info, background) {
  const limits = adaptiveBackgroundThresholds(background);
  const total = info.width * info.height;
  let signal = 0;
  for (let i = 0; i < total; i += 1) {
    const p = i * info.channels;
    if (data[p + 3] < 40) continue;
    const looksLikeBackground = backgroundLike(data, i, info, background, {
      maxDistance: limits.maxDistance + 10,
      minBrightness: Math.max(145, limits.minBrightness - 18),
      maxSpread: Math.min(110, limits.maxSpread + 18),
      minAlpha: 0
    });
    if (!looksLikeBackground) signal += 1;
  }
  return signal;
}

function residualBackgroundRatio(data, info, background) {
  const limits = adaptiveBackgroundThresholds(background);
  if (!limits.eligible) return 0;
  const total = info.width * info.height;
  let opaque = 0;
  let residual = 0;
  for (let i = 0; i < total; i += 1) {
    const p = i * info.channels;
    if (data[p + 3] < 48) continue;
    opaque += 1;
    if (backgroundLike(data, i, info, background, {
      maxDistance: Math.max(22, limits.maxDistance - 4),
      minBrightness: limits.minBrightness,
      maxSpread: limits.maxSpread,
      minAlpha: 48
    })) {
      residual += 1;
    }
  }
  return residual / Math.max(1, opaque);
}

function semiTransparentBackgroundRatio(data, info, background) {
  const limits = adaptiveBackgroundThresholds(background);
  if (!limits.eligible) return 0;
  const total = info.width * info.height;
  let visible = 0;
  let contaminated = 0;

  for (let i = 0; i < total; i += 1) {
    const p = i * info.channels;
    const alpha = data[p + 3];
    if (alpha < 40) continue;
    visible += 1;
    if (alpha >= 224) continue;

    if (backgroundLike(data, i, info, background, {
      maxDistance: limits.maxDistance + 3,
      minBrightness: Math.max(150, limits.minBrightness - 8),
      maxSpread: Math.min(110, limits.maxSpread + 8),
      minAlpha: 40
    })) {
      contaminated += 1;
    }
  }

  return contaminated / Math.max(1, visible);
}


function fanCutoutThresholds(background = {}) {
  const brightness = Number(background.brightness || 0);
  const variance = Math.max(0, Number(background.variance || 0));
  const spread = Math.max(0, Number(background.spread || 0));
  const sigma = Math.sqrt(variance);

  return {
    eligible: brightness >= 196 && variance <= 1800,
    strictDistance: clamp(15 + sigma * 0.18, 15, 28),
    softDistance: clamp(34 + sigma * 0.20, 34, 50),
    strictBrightness: clamp(brightness - 22, 202, 248),
    softBrightness: clamp(brightness - 42, 178, 236),
    strictSpread: clamp(spread + 18, 22, 58),
    softSpread: clamp(spread + 34, 34, 88)
  };
}

function fanStrongForegroundCount(data, info, background, limits) {
  const total = info.width * info.height;
  let count = 0;
  for (let i = 0; i < total; i += 1) {
    const p = i * info.channels;
    if (data[p + 3] < 40) continue;
    const distance = rgbDistance(data, p, background);
    const brightness = pixelBrightness(data, p);
    const spread = pixelSpread(data, p);
    if (
      distance > limits.softDistance + 12 ||
      brightness < limits.softBrightness - 14 ||
      spread > limits.softSpread + 16
    ) {
      count += 1;
    }
  }
  return count;
}

function fanResidualBackgroundRatio(data, info, background, limits) {
  const total = info.width * info.height;
  let visible = 0;
  let residual = 0;
  for (let i = 0; i < total; i += 1) {
    const p = i * info.channels;
    const alpha = data[p + 3];
    if (alpha < 48) continue;
    visible += 1;

    const distance = rgbDistance(data, p, background);
    const brightness = pixelBrightness(data, p);
    const spread = pixelSpread(data, p);
    if (
      distance <= limits.strictDistance + 5 &&
      brightness >= limits.strictBrightness - 5 &&
      spread <= limits.strictSpread + 8
    ) {
      residual += 1;
    }
  }
  return residual / Math.max(1, visible);
}

function fanPartialBackgroundRatio(data, info, background, limits) {
  const total = info.width * info.height;
  let visible = 0;
  let partial = 0;
  for (let i = 0; i < total; i += 1) {
    const p = i * info.channels;
    const alpha = data[p + 3];
    if (alpha < 40) continue;
    visible += 1;
    if (alpha >= 224) continue;

    const distance = rgbDistance(data, p, background);
    const brightness = pixelBrightness(data, p);
    const spread = pixelSpread(data, p);
    if (
      distance <= limits.softDistance &&
      brightness >= limits.softBrightness &&
      spread <= limits.softSpread
    ) {
      partial += 1;
    }
  }
  return partial / Math.max(1, visible);
}

function nearestFanForegroundColor(data, info, index, background, limits) {
  const { width, height, channels } = info;
  const x = index % width;
  const y = Math.floor(index / width);
  let best = null;
  let bestDistance = -1;

  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      if (!dx && !dy) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      const p = next * channels;
      if (data[p + 3] < 80) continue;
      const distance = rgbDistance(data, p, background);
      if (distance <= limits.softDistance + 8) continue;
      if (distance > bestDistance) {
        bestDistance = distance;
        best = [data[p], data[p + 1], data[p + 2]];
      }
    }
  }
  return best;
}

function fanMatteScore(data, pixelOffset, background) {
  const dr = Math.abs(data[pixelOffset] - background.r);
  const dg = Math.abs(data[pixelOffset + 1] - background.g);
  const db = Math.abs(data[pixelOffset + 2] - background.b);
  const distanceNorm = Math.sqrt(dr * dr + dg * dg + db * db) / 441.673;
  const brightnessGap = Math.max(
    0,
    Number(background.brightness || 255) - pixelBrightness(data, pixelOffset)
  ) / 255;
  const chroma = pixelSpread(data, pixelOffset) / 255;
  return clamp(Math.max(
    distanceNorm * 1.48,
    brightnessGap * 1.32,
    chroma * 0.72
  ), 0, 1);
}

function fanLocalContrast(data, info, index) {
  const { width, height, channels } = info;
  const x = index % width;
  const y = Math.floor(index / width);
  const p = index * channels;
  let maxDelta = 0;

  const compare = (next) => {
    const np = next * channels;
    const delta = (
      Math.abs(data[p] - data[np]) +
      Math.abs(data[p + 1] - data[np + 1]) +
      Math.abs(data[p + 2] - data[np + 2])
    ) / (3 * 255);
    if (delta > maxDelta) maxDelta = delta;
  };

  if (x > 0) compare(index - 1);
  if (x + 1 < width) compare(index + 1);
  if (y > 0) compare(index - width);
  if (y + 1 < height) compare(index + width);
  return maxDelta;
}

function fanComputedAlpha(score, contrast, originalAlpha) {
  if (originalAlpha < 24) return 0;

  // Fundo puro ou quase uniforme deve desaparecer por completo, inclusive
  // dentro de células fechadas pela grade.
  if (score <= 0.050 && contrast <= 0.10) return 0;
  if (score <= 0.085 && contrast <= 0.055) return 0;

  // A faixa intermediária vira alpha matemático em vez de um "cinza lavado".
  // Contraste local preserva fios, aros e detalhes finos.
  const low = contrast >= 0.12 ? 0.040 : 0.055;
  const high = contrast >= 0.16 ? 0.180 : 0.245;
  const normalized = clamp((score - low) / Math.max(0.001, high - low), 0, 1);
  let alpha = Math.round(255 * Math.pow(normalized, contrast >= 0.12 ? 0.58 : 0.92));

  if (contrast >= 0.18 && score >= 0.085) alpha = Math.max(alpha, 188);
  if (score >= 0.285) alpha = 255;

  return Math.min(originalAlpha, alpha);
}

function unmatteFanPixel(data, pixelOffset, background, alpha) {
  if (alpha <= 20 || alpha >= 248) return;
  const a = alpha / 255;
  const recover = (observed, bg) =>
    clamp(Math.round((observed - bg * (1 - a)) / Math.max(0.08, a)), 0, 255);

  data[pixelOffset] = recover(data[pixelOffset], background.r);
  data[pixelOffset + 1] = recover(data[pixelOffset + 1], background.g);
  data[pixelOffset + 2] = recover(data[pixelOffset + 2], background.b);
}

function fanResidualMatteRatio(original, repaired, info, background) {
  const total = info.width * info.height;
  let visible = 0;
  let residual = 0;

  for (let i = 0; i < total; i += 1) {
    const p = i * info.channels;
    const alpha = repaired[p + 3];
    if (alpha < 48) continue;
    visible += 1;

    const score = fanMatteScore(original, p, background);
    const contrast = fanLocalContrast(original, info, i);
    if (score <= 0.105 && contrast <= 0.075) residual += 1;
  }

  return residual / Math.max(1, visible);
}

async function repairFanProductFromReference(asset, referenceBuffer) {
  if (!referenceBuffer) return null;

  let source;
  try {
    // Sem upscale, sem IA e sem blur: trabalhamos exatamente nos pixels da foto.
    source = sharp(referenceBuffer, { failOn: 'none' })
      .rotate()
      .ensureAlpha();
  } catch {
    return null;
  }

  const { data: raw, info } = await source.raw().toBuffer({ resolveWithObject: true });
  const background = estimateLightBackground(raw, info);
  const limits = fanCutoutThresholds(background);
  if (!limits.eligible) return null;

  const { width, height, channels } = info;
  const total = width * height;
  const data = Buffer.from(raw);
  const foregroundSignalBefore = fanStrongForegroundCount(raw, info, background, limits);

  let removedPixels = 0;
  let partialPixels = 0;

  // Passo 1 — color-to-alpha global. Diferente do flood-fill, alcança fundo branco
  // preso entre cada célula da grade e entre a haste e a base.
  const alphaMap = new Uint8Array(total);
  for (let i = 0; i < total; i += 1) {
    const p = i * channels;
    const score = fanMatteScore(raw, p, background);
    const contrast = fanLocalContrast(raw, info, i);
    const originalAlpha = raw[p + 3];
    const nextAlpha = fanComputedAlpha(score, contrast, originalAlpha);
    alphaMap[i] = nextAlpha;

    if (nextAlpha < 24 && originalAlpha >= 24) removedPixels += 1;
    else if (nextAlpha < 224 && originalAlpha >= 224) partialPixels += 1;
  }

  // Passo 2 — elimina ilhas internas uniformes que ainda ficaram parcialmente opacas.
  // O critério exige vizinhança clara/baixa textura para não mastigar fios ou pás.
  for (let pass = 0; pass < 2; pass += 1) {
    const snapshot = Uint8Array.from(alphaMap);
    for (let i = 0; i < total; i += 1) {
      if (snapshot[i] < 24 || snapshot[i] >= 210) continue;

      const p = i * channels;
      const score = fanMatteScore(raw, p, background);
      const contrast = fanLocalContrast(raw, info, i);
      if (score > 0.16 || contrast > 0.095) continue;

      const x = i % width;
      const y = Math.floor(i / width);
      let transparentNeighbors = 0;
      let lowAlphaNeighbors = 0;
      const check = (next) => {
        if (snapshot[next] < 32) transparentNeighbors += 1;
        if (snapshot[next] < 128) lowAlphaNeighbors += 1;
      };
      if (x > 0) check(i - 1);
      if (x + 1 < width) check(i + 1);
      if (y > 0) check(i - width);
      if (y + 1 < height) check(i + width);

      if (transparentNeighbors >= 1 || lowAlphaNeighbors >= 3) {
        if (alphaMap[i] >= 24) removedPixels += 1;
        alphaMap[i] = 0;
      }
    }
  }

  // Passo 3 — grava o alpha e remove a contaminação branca somente nos pixels
  // anti-aliased. Isso aumenta a definição visual sem aplicar sharpen/blur.
  for (let i = 0; i < total; i += 1) {
    const p = i * channels;
    const nextAlpha = alphaMap[i];
    data[p + 3] = nextAlpha;
    if (nextAlpha >= 24 && nextAlpha < 248) {
      unmatteFanPixel(data, p, background, nextAlpha);
    }
  }

  const afterOpaque = opaqueCount(data, info);
  const foregroundOpaqueRatioAfter = afterOpaque / Math.max(1, total);
  const foregroundSignalAfter = fanStrongForegroundCount(data, info, background, limits);
  const foregroundSignalRetention =
    foregroundSignalBefore > 0
      ? foregroundSignalAfter / foregroundSignalBefore
      : 1;

  const internalBackgroundContaminationRatio =
    fanResidualMatteRatio(raw, data, info, background);
  const semiTransparentContaminationRatio =
    fanPartialBackgroundRatio(data, info, background, limits);
  const whiteHaloResidualRatio = haloResidualRatio(data, info, background);
  const removedRatio = transparentRatio(data, info);
  const afterStructure = alphaStructureStats(data, info);

  const internalBackgroundOk =
    internalBackgroundContaminationRatio <= 0.0015 &&
    semiTransparentContaminationRatio <= 0.008;
  const whiteHaloOk = whiteHaloResidualRatio <= 0.028;
  const thinStructureDamageOk =
    foregroundSignalRetention >= 0.990 &&
    foregroundOpaqueRatioAfter >= 0.030 &&
    afterStructure.largestShare >= 0.28;

  const safe =
    removedRatio >= 0.025 &&
    removedRatio <= 0.96 &&
    internalBackgroundOk &&
    whiteHaloOk &&
    thinStructureDamageOk;

  let reason = 'ok';
  if (!thinStructureDamageOk) reason = 'thin_structure_damage';
  else if (!internalBackgroundOk) reason = 'internal_background_contamination';
  else if (!whiteHaloOk) reason = 'white_halo_residual';
  else if (removedRatio < 0.025 || removedRatio > 0.96) reason = 'fan_cutout_ratio_unsafe';

  const png = await sharp(data, { raw: info })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  const trimmed = await sharp(png)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 5 })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  const meta = await sharp(trimmed).metadata();

  return {
    ...asset,
    buffer: trimmed,
    width: Number(meta.width || info.width),
    height: Number(meta.height || info.height),
    backgroundRemoved: safe,
    removalMode: safe ? 'fan_original_color_to_alpha' : 'unsafe_fan_original_color_to_alpha',
    removedRatio,
    confidence: safe ? 0.97 : 0,
    cutoutSafe: safe,
    cutoutReason: safe ? 'ok' : reason,
    repairMetrics: {
      attempted: true,
      difficultProduct: true,
      fanOriginalPixelRepair: true,
      colorToAlphaRepair: true,
      autoDetectedPorousStructure: true,
      recoveredOuterCutout: true,
      internalCandidateCount: 0,
      internalRemovedPixels: removedPixels,
      partialPixels,
      internalRemovedRatio: removedPixels / Math.max(1, total),
      internalBackgroundContaminationRatio,
      outerBackgroundResidualRatio: internalBackgroundContaminationRatio,
      semiTransparentContaminationRatio,
      whiteHaloResidualRatio,
      structuralLossRatio: 0,
      thinStructureDamageRatio: Math.max(0, 1 - foregroundSignalRetention),
      foregroundSignalBefore,
      foregroundSignalAfter,
      foregroundSignalRetention,
      foregroundOpaqueRatioAfter,
      reconstructionApplied: false,
      reconstructionRemovedPixels: 0,
      afterStructure,
      internalBackgroundOk,
      whiteHaloOk,
      thinStructureDamageOk,
      safe,
      reason
    }
  };
}

function reconstructNeutralBackground(data, info, background) {
  const limits = adaptiveBackgroundThresholds(background);
  if (!limits.eligible) return null;

  const { width, height, channels } = info;
  const total = width * height;
  const output = Buffer.from(data);
  let removed = 0;
  let softened = 0;

  for (let i = 0; i < total; i += 1) {
    const p = i * channels;
    const alpha = output[p + 3];
    if (alpha < 32) continue;

    const distance = rgbDistance(output, p, background);
    const brightness = pixelBrightness(output, p);
    const spread = pixelSpread(output, p);
    const strictBackground =
      distance <= Math.max(18, limits.maxDistance - 8) &&
      brightness >= limits.minBrightness + 6 &&
      spread <= Math.max(28, limits.maxSpread - 8);
    const probableBackground =
      distance <= limits.maxDistance &&
      brightness >= limits.minBrightness &&
      spread <= limits.maxSpread;

    if (strictBackground) {
      output[p + 3] = 0;
      removed += 1;
      continue;
    }

    if (!probableBackground) continue;

    const x = i % width;
    const y = Math.floor(i / width);
    let foregroundNeighbors = 0;
    const neighbors = [];
    if (x > 0) neighbors.push(i - 1);
    if (x + 1 < width) neighbors.push(i + 1);
    if (y > 0) neighbors.push(i - width);
    if (y + 1 < height) neighbors.push(i + width);

    for (const next of neighbors) {
      const np = next * channels;
      if (output[np + 3] < 40) continue;
      const neighborDistance = rgbDistance(output, np, background);
      if (neighborDistance > limits.maxDistance + 10) foregroundNeighbors += 1;
    }

    // Em grades, telas e estruturas vazadas, deixar o fundo "meio transparente"
    // cria exatamente a névoa cinza que aparece dentro do ventilador no banner.
    // Todo pixel que ainda se parece com o fundo deve sair da máscara visível.
    if (foregroundNeighbors <= 2) {
      output[p + 3] = 0;
      removed += 1;
    } else {
      const nextAlpha = Math.min(alpha, 32);
      if (nextAlpha !== alpha) {
        output[p + 3] = nextAlpha;
        softened += 1;
      }
    }
  }

  return {
    data: output,
    removed,
    softened,
    removedRatio: removed / Math.max(1, total)
  };
}

function strictOuterCutout(data, info, background) {
  const limits = adaptiveBackgroundThresholds(background);
  if (!limits.eligible) return null;

  const { width, height, channels } = info;
  const total = width * height;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const matches = (index) => {
    const p = index * channels;
    if (data[p + 3] < 28) return true;
    return backgroundLike(data, index, info, background, {
      maxDistance: limits.maxDistance,
      minBrightness: limits.minBrightness,
      maxSpread: limits.maxSpread,
      minAlpha: 0
    });
  };

  const enqueue = (index) => {
    if (visited[index] || !matches(index)) return;
    visited[index] = 1;
    queue[tail++] = index;
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y + 1 < height) enqueue(index + width);
  }

  const removedRatio = tail / Math.max(1, total);
  if (removedRatio < 0.025 || removedRatio > 0.93) return null;

  const output = Buffer.from(data);
  for (let i = 0; i < total; i += 1) {
    if (visited[i]) output[i * channels + 3] = 0;
  }

  for (let i = 0; i < total; i += 1) {
    if (visited[i]) continue;
    const p = i * channels;
    const alpha = output[p + 3];
    if (alpha < 32 || alpha >= 250) continue;
    const x = i % width;
    const y = Math.floor(i / width);
    const touchesRemoved =
      (x > 0 && visited[i - 1]) ||
      (x + 1 < width && visited[i + 1]) ||
      (y > 0 && visited[i - width]) ||
      (y + 1 < height && visited[i + width]);
    if (!touchesRemoved) continue;
    if (backgroundLike(output, i, info, background, {
      maxDistance: limits.maxDistance + 4,
      minBrightness: Math.max(145, limits.minBrightness - 8),
      maxSpread: Math.min(110, limits.maxSpread + 10),
      minAlpha: 0
    })) {
      output[p + 3] = Math.min(alpha, 176);
    }
  }

  return { data: output, removedRatio };
}

function findInternalBackgroundComponents(data, info, background) {
  const { width, height, channels } = info;
  const total = width * height;
  const mask = new Uint8Array(total);
  const labels = new Int32Array(total);
  const limits = adaptiveBackgroundThresholds(background);

  for (let i = 0; i < total; i += 1) {
    if (limits.eligible && backgroundLike(data, i, info, background, {
      maxDistance: Math.max(22, limits.maxDistance - 3),
      minBrightness: limits.minBrightness,
      maxSpread: limits.maxSpread,
      minAlpha: 64
    })) {
      mask[i] = 1;
    }
  }

  const queue = new Int32Array(total);
  const components = [];
  let label = 0;

  for (let start = 0; start < total; start += 1) {
    if (!mask[start] || labels[start]) continue;
    label += 1;
    let head = 0;
    let tail = 0;
    let count = 0;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    let sumBrightness = 0;
    let sumBrightness2 = 0;
    let sumDistance = 0;
    let touchesEdge = false;

    queue[tail++] = start;
    labels[start] = label;

    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      const p = index * channels;
      const brightness = pixelBrightness(data, p);

      count += 1;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      sumBrightness += brightness;
      sumBrightness2 += brightness * brightness;
      sumDistance += rgbDistance(data, p, background);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesEdge = true;

      const neighbors = [];
      if (x > 0) neighbors.push(index - 1);
      if (x + 1 < width) neighbors.push(index + 1);
      if (y > 0) neighbors.push(index - width);
      if (y + 1 < height) neighbors.push(index + width);

      for (const next of neighbors) {
        if (mask[next] && !labels[next]) {
          labels[next] = label;
          queue[tail++] = next;
        }
      }
    }

    const meanBrightness = sumBrightness / Math.max(1, count);
    const variance = Math.max(0, sumBrightness2 / Math.max(1, count) - meanBrightness * meanBrightness);
    components.push({
      label,
      count,
      minX,
      maxX,
      minY,
      maxY,
      touchesEdge,
      meanBrightness,
      brightnessStd: Math.sqrt(variance),
      meanDistance: sumDistance / Math.max(1, count),
      solidBoundary: 0,
      transparentBoundary: 0
    });
  }

  const byLabel = new Map(components.map(item => [item.label, item]));
  for (let index = 0; index < total; index += 1) {
    const currentLabel = labels[index];
    if (!currentLabel) continue;
    const component = byLabel.get(currentLabel);
    const x = index % width;
    const y = Math.floor(index / width);
    const neighbors = [];
    if (x > 0) neighbors.push(index - 1);
    if (x + 1 < width) neighbors.push(index + 1);
    if (y > 0) neighbors.push(index - width);
    if (y + 1 < height) neighbors.push(index + width);

    for (const next of neighbors) {
      if (labels[next] === currentLabel) continue;
      const alpha = data[next * channels + 3];
      if (alpha < 48) component.transparentBoundary += 1;
      else component.solidBoundary += 1;
    }
  }

  const minArea = Math.max(14, Math.round(total * 0.000025));
  const maxArea = Math.max(minArea + 1, Math.round(total * 0.22));
  const candidates = components.filter(component => {
    const boxArea = Math.max(1, (component.maxX - component.minX + 1) * (component.maxY - component.minY + 1));
    const fillRatio = component.count / boxArea;
    const boundaryTotal = component.solidBoundary + component.transparentBoundary;
    const enclosure = boundaryTotal > 0 ? component.solidBoundary / boundaryTotal : 0;
    return !component.touchesEdge &&
      component.count >= minArea &&
      component.count <= maxArea &&
      component.meanBrightness >= Math.max(160, limits.minBrightness) &&
      component.meanDistance <= Math.max(20, limits.maxDistance - 2) &&
      component.brightnessStd <= 18 &&
      fillRatio >= 0.10 &&
      enclosure >= 0.68 &&
      component.transparentBoundary <= Math.max(4, Math.round(component.solidBoundary * 0.22));
  });

  return { labels, components, candidates };
}

function removeInternalCandidates(data, info, labels, candidates) {
  if (!candidates.length) return 0;
  const accepted = new Set(candidates.map(item => item.label));
  const total = info.width * info.height;
  let removed = 0;

  for (let i = 0; i < total; i += 1) {
    if (!accepted.has(labels[i])) continue;
    const alphaIndex = i * info.channels + 3;
    if (data[alphaIndex] >= 40) removed += 1;
    data[alphaIndex] = 0;
  }
  return removed;
}

function cleanWhiteHalo(data, info, background) {
  const { width, height, channels } = info;
  const limits = adaptiveBackgroundThresholds(background);
  const total = width * height;
  const originalAlpha = new Uint8Array(total);
  for (let i = 0; i < total; i += 1) originalAlpha[i] = data[i * channels + 3];

  let changed = 0;
  for (let i = 0; i < total; i += 1) {
    const p = i * channels;
    const alpha = originalAlpha[i];
    if (alpha < 32 || alpha >= 250) continue;
    const x = i % width;
    const y = Math.floor(i / width);
    let transparentNeighbors = 0;
    if (x > 0 && originalAlpha[i - 1] < 40) transparentNeighbors += 1;
    if (x + 1 < width && originalAlpha[i + 1] < 40) transparentNeighbors += 1;
    if (y > 0 && originalAlpha[i - width] < 40) transparentNeighbors += 1;
    if (y + 1 < height && originalAlpha[i + width] < 40) transparentNeighbors += 1;
    if (transparentNeighbors < 1) continue;

    const distance = rgbDistance(data, p, background);
    const brightness = pixelBrightness(data, p);
    const spread = pixelSpread(data, p);

    if (
      transparentNeighbors >= 2 &&
      distance <= Math.max(12, limits.maxDistance - 14) &&
      brightness >= Math.max(170, limits.minBrightness + 8) &&
      spread <= Math.max(22, limits.maxSpread - 10)
    ) {
      data[p + 3] = 0;
      changed += 1;
    } else if (
      distance <= Math.max(20, limits.maxDistance - 5) &&
      brightness >= Math.max(160, limits.minBrightness) &&
      spread <= limits.maxSpread
    ) {
      const nextAlpha = Math.min(alpha, 128);
      if (nextAlpha !== alpha) {
        data[p + 3] = nextAlpha;
        changed += 1;
      }
    }
  }

  return changed;
}

function haloResidualRatio(data, info, background) {
  const { width, height, channels } = info;
  const limits = adaptiveBackgroundThresholds(background);
  const total = width * height;
  let boundary = 0;
  let halo = 0;

  for (let i = 0; i < total; i += 1) {
    const p = i * channels;
    const alpha = data[p + 3];
    if (alpha < 40) continue;
    const x = i % width;
    const y = Math.floor(i / width);
    const touchesTransparent =
      (x > 0 && data[(i - 1) * channels + 3] < 40) ||
      (x + 1 < width && data[(i + 1) * channels + 3] < 40) ||
      (y > 0 && data[(i - width) * channels + 3] < 40) ||
      (y + 1 < height && data[(i + width) * channels + 3] < 40);

    if (!touchesTransparent) continue;
    boundary += 1;
    if (
      alpha < 250 &&
      rgbDistance(data, p, background) <= Math.max(24, limits.maxDistance - 2) &&
      pixelBrightness(data, p) >= Math.max(158, limits.minBrightness) &&
      pixelSpread(data, p) <= limits.maxSpread
    ) {
      halo += 1;
    }
  }

  return halo / Math.max(1, boundary);
}

function resultWithoutRepair(asset, difficultProduct, reason = 'not_required') {
  return {
    ...asset,
    repairMetrics: {
      attempted: false,
      difficultProduct,
      autoDetectedPorousStructure: false,
      recoveredOuterCutout: false,
      internalCandidateCount: 0,
      internalRemovedPixels: 0,
      internalRemovedRatio: 0,
      internalBackgroundContaminationRatio: 0,
      whiteHaloResidualRatio: 0,
      structuralLossRatio: 0,
      thinStructureDamageRatio: 0,
      internalBackgroundOk: true,
      whiteHaloOk: true,
      thinStructureDamageOk: !['foreground_fragmented', 'opaque_area_too_small'].includes(String(asset.cutoutReason || '')),
      safe: asset.cutoutSafe !== false,
      reason
    }
  };
}

export async function repairCreativeProductCutout(asset = {}, productText = '', referenceBuffer = null) {
  if (!asset?.buffer) return asset;

  const difficultProduct = isDifficultProduct(productText);

  // Ventiladores usam sempre os pixels da foto original. Nada de reconstrução
  // generativa: isso preserva nitidez, marca, pás, grade, haste e base reais.
  if (isFanProduct(productText) && referenceBuffer) {
    const fanRepair = await repairFanProductFromReference(asset, referenceBuffer);
    if (fanRepair) return fanRepair;
  }

  if (!asset.backgroundRemoved && !difficultProduct) {
    return resultWithoutRepair(asset, false, 'base_cutout_not_eligible');
  }

  const source = sharp(asset.buffer).ensureAlpha();
  const { data: raw, info } = await source.raw().toBuffer({ resolveWithObject: true });
  let data = Buffer.from(raw);
  const total = info.width * info.height;

  let background = estimateLightBackground(data, info);
  if (referenceBuffer) {
    try {
      const reference = sharp(referenceBuffer)
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .ensureAlpha();
      const { data: referenceData, info: referenceInfo } =
        await reference.raw().toBuffer({ resolveWithObject: true });
      const referenceBackground = estimateLightBackground(referenceData, referenceInfo);
      if (adaptiveBackgroundThresholds(referenceBackground).eligible) {
        background = referenceBackground;
      }
    } catch {
      // O reparo continua com a estimativa do asset; nunca afeta outras etapas do Studio.
    }
  }

  const foregroundSignalBefore = foregroundSignalCount(data, info, background);
  let recoveredOuterCutout = false;
  let outerRecoveredRatio = 0;
  let reconstructionApplied = false;
  let reconstructionRemovedPixels = 0;

  if (!asset.backgroundRemoved) {
    const recovered = strictOuterCutout(data, info, background);
    if (recovered) {
      data = recovered.data;
      recoveredOuterCutout = true;
      outerRecoveredRatio = recovered.removedRatio;
    } else if (difficultProduct) {
      const reconstructed = reconstructNeutralBackground(data, info, background);
      if (reconstructed && reconstructed.removedRatio >= 0.02 && reconstructed.removedRatio <= 0.94) {
        data = reconstructed.data;
        recoveredOuterCutout = true;
        reconstructionApplied = true;
        reconstructionRemovedPixels += reconstructed.removed;
        outerRecoveredRatio = reconstructed.removedRatio;
      } else {
        return {
          ...resultWithoutRepair(asset, difficultProduct, 'strict_outer_recovery_failed'),
          repairMetrics: {
            ...resultWithoutRepair(asset, difficultProduct, 'strict_outer_recovery_failed').repairMetrics,
            attempted: true,
            safe: false,
            internalBackgroundOk: false,
            whiteHaloOk: false,
            thinStructureDamageOk: false,
            thinStructureDamageRatio: 1
          }
        };
      }
    } else {
      return {
        ...resultWithoutRepair(asset, difficultProduct, 'strict_outer_recovery_failed'),
        repairMetrics: {
          ...resultWithoutRepair(asset, difficultProduct, 'strict_outer_recovery_failed').repairMetrics,
          attempted: true,
          safe: false,
          internalBackgroundOk: false,
          whiteHaloOk: false,
          thinStructureDamageOk: false,
          thinStructureDamageRatio: 1
        }
      };
    }
  }

  const beforeOpaque = opaqueCount(data, info);
  const beforeStructure = alphaStructureStats(data, info);
  const before = findInternalBackgroundComponents(data, info, background);
  const candidatePixels = before.candidates.reduce((sum, item) => sum + item.count, 0);
  const candidateRatio = candidatePixels / Math.max(1, beforeOpaque);
  const autoDetectedPorousStructure =
    before.candidates.length >= 3 &&
    candidateRatio >= 0.004 &&
    candidateRatio <= 0.30;
  const shouldRepair = difficultProduct || autoDetectedPorousStructure || recoveredOuterCutout;

  if (!shouldRepair) {
    return {
      ...asset,
      repairMetrics: {
        attempted: false,
        difficultProduct,
        autoDetectedPorousStructure,
        recoveredOuterCutout: false,
        internalCandidateCount: before.candidates.length,
        internalRemovedPixels: 0,
        internalRemovedRatio: 0,
        internalBackgroundContaminationRatio: 0,
        whiteHaloResidualRatio: 0,
        structuralLossRatio: 0,
        thinStructureDamageRatio: 0,
        internalBackgroundOk: true,
        whiteHaloOk: true,
        thinStructureDamageOk: !['foreground_fragmented', 'opaque_area_too_small'].includes(String(asset.cutoutReason || '')),
        safe: asset.cutoutSafe !== false,
        reason: 'not_required'
      }
    };
  }

  let internalRemovedPixels = removeInternalCandidates(data, info, before.labels, before.candidates);
  let haloChangedPixels = cleanWhiteHalo(data, info, background);

  const firstResidualRatio = residualBackgroundRatio(data, info, background);
  if (
    difficultProduct &&
    firstResidualRatio > 0.018 &&
    adaptiveBackgroundThresholds(background).eligible
  ) {
    const reconstructed = reconstructNeutralBackground(data, info, background);
    if (reconstructed) {
      data = reconstructed.data;
      reconstructionApplied = true;
      reconstructionRemovedPixels += reconstructed.removed;
      internalRemovedPixels += reconstructed.removed;
      haloChangedPixels += reconstructed.softened;
      haloChangedPixels += cleanWhiteHalo(data, info, background);
    }
  }

  const afterOpaque = opaqueCount(data, info);
  const structuralLossRatio = Math.max(0, beforeOpaque - afterOpaque) / Math.max(1, beforeOpaque);

  const after = findInternalBackgroundComponents(data, info, background);
  const residualCandidatePixels = after.candidates.reduce((sum, item) => sum + item.count, 0);
  const internalBackgroundContaminationRatio =
    residualCandidatePixels / Math.max(1, afterOpaque);
  const whiteHaloResidualRatio = haloResidualRatio(data, info, background);
  const outerBackgroundResidualRatio = residualBackgroundRatio(data, info, background);
  const semiTransparentContaminationRatio = semiTransparentBackgroundRatio(data, info, background);

  const internalBackgroundOk =
    internalBackgroundContaminationRatio <= 0.004 &&
    outerBackgroundResidualRatio <= (difficultProduct ? 0.012 : 0.035) &&
    semiTransparentContaminationRatio <= (difficultProduct ? 0.006 : 0.018);
  const whiteHaloOk = whiteHaloResidualRatio <= 0.040;
  const foregroundOpaqueRatioAfter = afterOpaque / Math.max(1, total);
  const afterStructure = alphaStructureStats(data, info);
  // Em estruturas vazadas, grande parte do que parecia "área opaca" antes do reparo
  // pode ser apenas fundo branco preso entre grades. Por isso a segurança não usa
  // uma perda percentual rígida: preservamos uma área mínima real de produto e
  // mantemos um teto amplo apenas para impedir remoções catastróficas.
  const structuralLossLimit = (difficultProduct || autoDetectedPorousStructure) ? 0.86 : 0.30;
  const structureOk = structuralLossRatio <= structuralLossLimit && foregroundOpaqueRatioAfter >= 0.035;
  const componentExplosion =
    afterStructure.majorComponents > Math.max(beforeStructure.majorComponents + 2, Math.ceil(beforeStructure.majorComponents * 1.8));
  const largestShareDrop =
    beforeStructure.largestShare >= 0.45 &&
    afterStructure.largestShare < Math.max(0.18, beforeStructure.largestShare - 0.22);
  const recoveredFromFragmentation =
    recoveredOuterCutout &&
    ['foreground_fragmented', 'opaque_area_too_small'].includes(String(asset.cutoutReason || ''));
  const baseThinDamageSuspected =
    ['foreground_fragmented', 'opaque_area_too_small'].includes(String(asset.cutoutReason || '')) &&
    !recoveredFromFragmentation;
  const foregroundSignalAfter = foregroundSignalCount(data, info, background);
  const foregroundSignalRetention =
    foregroundSignalBefore > 0
      ? foregroundSignalAfter / foregroundSignalBefore
      : 1;
  const foregroundSignalOk =
    foregroundSignalBefore < 120 ||
    foregroundSignalRetention >= (difficultProduct ? 0.94 : 0.90);

  const thinStructureDamageOk =
    structureOk &&
    !componentExplosion &&
    !largestShareDrop &&
    !baseThinDamageSuspected &&
    foregroundSignalOk;
  const thinStructureDamageRatio = Math.max(
    componentExplosion ? 1 : 0,
    largestShareDrop
      ? Math.max(0, beforeStructure.largestShare - afterStructure.largestShare)
      : 0,
    baseThinDamageSuspected ? 1 : 0,
    foregroundSignalOk ? 0 : Math.max(0, 1 - foregroundSignalRetention)
  );
  const baseWasUsable = asset.backgroundRemoved && asset.cutoutSafe !== false;
  const recoveredWasUsable = recoveredOuterCutout && outerRecoveredRatio >= 0.025 && outerRecoveredRatio <= 0.93;
  const safe = (baseWasUsable || recoveredWasUsable) &&
    internalBackgroundOk &&
    whiteHaloOk &&
    thinStructureDamageOk;

  let reason = 'ok';
  if (!thinStructureDamageOk) reason = 'thin_structure_damage';
  else if (!internalBackgroundOk) reason = 'internal_background_contamination';
  else if (!whiteHaloOk) reason = 'white_halo_residual';
  else if (!(baseWasUsable || recoveredWasUsable)) reason = 'base_cutout_unsafe';

  const png = await sharp(data, { raw: info }).png().toBuffer();
  const trimmed = await sharp(png)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
    .png()
    .toBuffer();
  const meta = await sharp(trimmed).metadata();

  const extraRemovedRatio = (internalRemovedPixels + haloChangedPixels) / Math.max(1, total);
  const baseRemovedRatio = recoveredOuterCutout
    ? outerRecoveredRatio
    : Number(asset.removedRatio || transparentRatio(raw, info));

  return {
    ...asset,
    buffer: trimmed,
    width: meta.width || asset.width || info.width,
    height: meta.height || asset.height || info.height,
    backgroundRemoved: safe,
    removalMode: safe
      ? (reconstructionApplied
          ? 'cutout_repair_reconstructed_neutral_background'
          : recoveredOuterCutout
            ? 'cutout_repair_strict_outer_and_internal'
            : internalRemovedPixels > 0 || haloChangedPixels > 0
              ? String(asset.removalMode || 'cutout') + '+internal_repair'
              : String(asset.removalMode || 'cutout') + '+repair_verified')
      : 'unsafe_cutout_repair_blocked',
    removedRatio: clamp(baseRemovedRatio + extraRemovedRatio, 0, 0.99),
    confidence: safe ? Math.max(Number(asset.confidence || 0), recoveredOuterCutout ? 0.80 : 0.86) : 0,
    cutoutSafe: safe,
    cutoutReason: safe ? 'ok' : reason,
    repairMetrics: {
      attempted: true,
      difficultProduct,
      autoDetectedPorousStructure,
      recoveredOuterCutout,
      internalCandidateCount: before.candidates.length,
      internalRemovedPixels,
      internalRemovedRatio: internalRemovedPixels / Math.max(1, beforeOpaque),
      internalBackgroundContaminationRatio,
      outerBackgroundResidualRatio,
      semiTransparentContaminationRatio,
      whiteHaloResidualRatio,
      structuralLossRatio,
      thinStructureDamageRatio,
      foregroundSignalBefore,
      foregroundSignalAfter,
      foregroundSignalRetention,
      foregroundOpaqueRatioAfter,
      reconstructionApplied,
      reconstructionRemovedPixels,
      beforeStructure,
      afterStructure,
      internalBackgroundOk,
      whiteHaloOk,
      thinStructureDamageOk,
      safe,
      reason
    }
  };
}
