import sharp from 'sharp';

const DIFFICULT_PRODUCT_PATTERN =
  /(ventilador|fan\b|cadeira|banqueta|cesto|fruteira|grade|grelha|ripa|ripado|aramad|treli[cç]a|tela\b|estrutura\s+vazada|vazad[oa])/i;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isDifficultProduct(productText = '') {
  return DIFFICULT_PRODUCT_PATTERN.test(String(productText || '').toLowerCase());
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
    variance
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

function strictOuterCutout(data, info, background) {
  if (background.brightness < 220 || background.variance > 900) return null;

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
      maxDistance: 24,
      minBrightness: 235,
      maxSpread: 28,
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
      maxDistance: 28,
      minBrightness: 228,
      maxSpread: 34,
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

  for (let i = 0; i < total; i += 1) {
    if (backgroundLike(data, i, info, background, {
      maxDistance: 22,
      minBrightness: 238,
      maxSpread: 28,
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

  const minArea = Math.max(18, Math.round(total * 0.000035));
  const maxArea = Math.max(minArea + 1, Math.round(total * 0.10));
  const candidates = components.filter(component => {
    const boxArea = Math.max(1, (component.maxX - component.minX + 1) * (component.maxY - component.minY + 1));
    const fillRatio = component.count / boxArea;
    const boundaryTotal = component.solidBoundary + component.transparentBoundary;
    const enclosure = boundaryTotal > 0 ? component.solidBoundary / boundaryTotal : 0;
    return !component.touchesEdge &&
      component.count >= minArea &&
      component.count <= maxArea &&
      component.meanBrightness >= 240 &&
      component.meanDistance <= 20 &&
      component.brightnessStd <= 10 &&
      fillRatio >= 0.16 &&
      enclosure >= 0.82 &&
      component.transparentBoundary <= Math.max(2, Math.round(component.solidBoundary * 0.08));
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

    if (transparentNeighbors >= 2 && distance <= 12 && brightness >= 246 && spread <= 18) {
      data[p + 3] = 0;
      changed += 1;
    } else if (distance <= 20 && brightness >= 236 && spread <= 26) {
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
      rgbDistance(data, p, background) <= 24 &&
      pixelBrightness(data, p) >= 232 &&
      pixelSpread(data, p) <= 30
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

export async function repairCreativeProductCutout(asset = {}, productText = '') {
  if (!asset?.buffer) return asset;

  const difficultProduct = isDifficultProduct(productText);
  if (!asset.backgroundRemoved && !difficultProduct) {
    return resultWithoutRepair(asset, false, 'base_cutout_not_eligible');
  }

  const source = sharp(asset.buffer).ensureAlpha();
  const { data: raw, info } = await source.raw().toBuffer({ resolveWithObject: true });
  let data = Buffer.from(raw);
  const total = info.width * info.height;
  const background = estimateLightBackground(data, info);
  let recoveredOuterCutout = false;
  let outerRecoveredRatio = 0;

  if (!asset.backgroundRemoved) {
    const recovered = strictOuterCutout(data, info, background);
    if (!recovered) {
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
    data = recovered.data;
    recoveredOuterCutout = true;
    outerRecoveredRatio = recovered.removedRatio;
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

  const internalRemovedPixels = removeInternalCandidates(data, info, before.labels, before.candidates);
  const haloChangedPixels = cleanWhiteHalo(data, info, background);
  const afterOpaque = opaqueCount(data, info);
  const structuralLossRatio = Math.max(0, beforeOpaque - afterOpaque) / Math.max(1, beforeOpaque);

  const after = findInternalBackgroundComponents(data, info, background);
  const residualCandidatePixels = after.candidates.reduce((sum, item) => sum + item.count, 0);
  const internalBackgroundContaminationRatio =
    residualCandidatePixels / Math.max(1, afterOpaque);
  const whiteHaloResidualRatio = haloResidualRatio(data, info, background);

  const internalBackgroundOk = internalBackgroundContaminationRatio <= 0.004;
  const whiteHaloOk = whiteHaloResidualRatio <= 0.055;
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
  const thinStructureDamageOk =
    structureOk &&
    !componentExplosion &&
    !largestShareDrop &&
    !baseThinDamageSuspected;
  const thinStructureDamageRatio = Math.max(
    componentExplosion ? 1 : 0,
    largestShareDrop
      ? Math.max(0, beforeStructure.largestShare - afterStructure.largestShare)
      : 0,
    baseThinDamageSuspected ? 1 : 0
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
      ? (recoveredOuterCutout
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
      whiteHaloResidualRatio,
      structuralLossRatio,
      thinStructureDamageRatio,
      foregroundOpaqueRatioAfter,
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
