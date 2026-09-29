import sharp from 'sharp';
import { prepareProProductAsset } from '../creative-banner-pro-generator.js';
import {
  rebuildCreativeProductFromReference,
  isDifficultCreativeProduct,
  isFanCreativeProduct
} from './creativeProductRebuildService.js';

const BUCKET_NAME = 'creative_cutout_files';
const COLLECTION_NAME = 'creative_cutout_assets';
const initializedDatabases = new Set();

function now() {
  return new Date();
}

function cleanText(value = '', max = 180) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function safeFilename(value = 'produto') {
  const clean = String(value || 'produto')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return clean || 'produto';
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function ensureDb(mongoose) {
  const db = mongoose?.connection?.db;
  if (!db) throw new Error('creative_cutout_db_unavailable');
  return db;
}

async function ensureIndexes(mongoose) {
  const db = ensureDb(mongoose);
  const key = String(db.databaseName || 'default');
  if (initializedDatabases.has(key)) return;
  const collection = db.collection(COLLECTION_NAME);
  await Promise.all([
    collection.createIndex({ status: 1, updatedAt: -1 }),
    collection.createIndex({ createdAt: -1 }),
    collection.createIndex({ name: 'text', category: 'text' })
  ]);
  initializedDatabases.add(key);
}

function bucketFor(mongoose) {
  const GridFSBucket = mongoose?.mongo?.GridFSBucket;
  if (!GridFSBucket) throw new Error('creative_cutout_gridfs_unavailable');
  return new GridFSBucket(ensureDb(mongoose), { bucketName: BUCKET_NAME });
}

function collectionFor(mongoose) {
  return ensureDb(mongoose).collection(COLLECTION_NAME);
}

function objectId(mongoose, value) {
  if (!value) return null;
  const ObjectId = mongoose?.mongo?.ObjectId;
  if (!ObjectId) throw new Error('creative_cutout_objectid_unavailable');
  if (value instanceof ObjectId) return value;
  const raw = typeof value?.toHexString === 'function'
    ? value.toHexString()
    : String(value);
  if (!ObjectId.isValid(raw)) return null;
  return new ObjectId(raw);
}

async function putBuffer(bucket, buffer, filename, contentType, metadata = {}) {
  return new Promise((resolve, reject) => {
    const stream = bucket.openUploadStream(filename, {
      contentType: contentType || 'application/octet-stream',
      metadata
    });
    stream.once('error', reject);
    stream.once('finish', () => resolve(String(stream.id)));
    stream.end(buffer);
  });
}

async function readBuffer(bucket, mongoose, fileId) {
  const id = objectId(mongoose, fileId);
  if (!id) throw new Error('creative_cutout_file_id_invalid');
  return new Promise((resolve, reject) => {
    const chunks = [];
    const stream = bucket.openDownloadStream(id);
    stream.on('data', chunk => chunks.push(Buffer.from(chunk)));
    stream.once('error', reject);
    stream.once('end', () => resolve(Buffer.concat(chunks)));
  });
}

async function deleteGridFile(bucket, mongoose, fileId) {
  if (!fileId) return;
  const id = objectId(mongoose, fileId);
  if (!id) return;
  try {
    await bucket.delete(id);
  } catch (error) {
    if (!/FileNotFound|not found/i.test(String(error?.message || error))) throw error;
  }
}

async function imageMetadata(buffer) {
  const meta = await sharp(buffer, { failOn: 'none' }).rotate().metadata();
  return {
    width: Number(meta.width || 0),
    height: Number(meta.height || 0),
    format: String(meta.format || ''),
    hasAlpha: Boolean(meta.hasAlpha),
    bytes: Number(buffer?.length || 0)
  };
}

async function meaningfulAlphaRatio(buffer) {
  const sample = sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha();
  const { data, info } = await sample.raw().toBuffer({ resolveWithObject: true });
  const total = info.width * info.height;
  let transparent = 0;
  let partial = 0;
  for (let i = 0; i < total; i += 1) {
    const alpha = data[i * info.channels + 3];
    if (alpha < 40) transparent += 1;
    else if (alpha < 245) partial += 1;
  }
  return {
    transparentRatio: transparent / Math.max(1, total),
    partialRatio: partial / Math.max(1, total)
  };
}

function realCutoutGate(asset = {}, productText = '') {
  const repair = asset.repairMetrics || {};
  const difficult = isDifficultCreativeProduct(productText);
  const width = Number(asset.width || asset.qualityWidth || 0);
  const height = Number(asset.height || asset.qualityHeight || 0);
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  const resolutionOk = difficult
    ? longEdge >= 1200 && shortEdge >= 420
    : longEdge >= 700;

  const safe =
    Boolean(asset.buffer) &&
    Boolean(asset.backgroundRemoved) &&
    asset.cutoutSafe !== false &&
    repair.safe !== false &&
    repair.internalBackgroundOk !== false &&
    repair.whiteHaloOk !== false &&
    repair.thinStructureDamageOk !== false &&
    resolutionOk;

  let reason = 'ok';
  if (!asset.backgroundRemoved) reason = asset.cutoutReason || 'background_not_removed';
  else if (asset.cutoutSafe === false) reason = asset.cutoutReason || 'cutout_unsafe';
  else if (repair.internalBackgroundOk === false) reason = 'internal_background_contamination';
  else if (repair.whiteHaloOk === false) reason = 'white_halo_residual';
  else if (repair.thinStructureDamageOk === false) reason = 'thin_structure_damage';
  else if (!resolutionOk) reason = 'master_resolution_too_low';

  return { safe, resolutionOk, reason, difficult, longEdge, shortEdge };
}

async function preserveTransparentOriginalIfSafe(originalBuffer, validatedAsset, productText = '') {
  const alpha = await meaningfulAlphaRatio(originalBuffer);
  if (alpha.transparentRatio < 0.025) return null;

  const gate = realCutoutGate(validatedAsset, productText);
  if (!gate.safe) return null;

  const normalized = await sharp(originalBuffer, { failOn: 'none' })
    .rotate()
    .ensureAlpha()
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 4 })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  const meta = await imageMetadata(normalized);

  return {
    ...validatedAsset,
    buffer: normalized,
    width: meta.width,
    height: meta.height,
    qualityWidth: meta.width,
    qualityHeight: meta.height,
    backgroundRemoved: true,
    cutoutSafe: true,
    cutoutReason: 'ok',
    removalMode: 'original_alpha_preserved_hq',
    confidence: 1,
    repairMetrics: {
      ...(validatedAsset.repairMetrics || {}),
      safe: true,
      internalBackgroundOk: validatedAsset.repairMetrics?.internalBackgroundOk !== false,
      whiteHaloOk: validatedAsset.repairMetrics?.whiteHaloOk !== false,
      thinStructureDamageOk: validatedAsset.repairMetrics?.thinStructureDamageOk !== false,
      originalPixelsPreserved: true,
      sourceAlphaTransparentRatio: alpha.transparentRatio,
      sourceAlphaPartialRatio: alpha.partialRatio,
      resolutionEnhanced: false,
      qualityWidth: meta.width,
      qualityHeight: meta.height,
      reason: 'original_transparent_pixels_preserved'
    }
  };
}


export async function cutoutUniformDarkBackgroundOriginal(originalBuffer, productText = '') {
  if (!isDifficultCreativeProduct(productText)) return null;

  const source = sharp(originalBuffer, { failOn: 'none' })
    .rotate()
    .ensureAlpha();
  const { data: raw, info } = await source.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const total = width * height;
  if (!width || !height || channels < 4) return null;

  const edgeSamples = [];
  const pushEdge = (index) => {
    const p = index * channels;
    if (raw[p + 3] < 40) return;
    const r = raw[p];
    const g = raw[p + 1];
    const b = raw[p + 2];
    edgeSamples.push({
      r, g, b,
      brightness: (r + g + b) / 3
    });
  };
  const stepX = Math.max(1, Math.floor(width / 90));
  const stepY = Math.max(1, Math.floor(height / 90));
  for (let x = 0; x < width; x += stepX) {
    pushEdge(x);
    pushEdge((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += stepY) {
    pushEdge(y * width);
    pushEdge(y * width + width - 1);
  }
  if (edgeSamples.length < 12) return null;

  const mean = edgeSamples.reduce((acc, item) => {
    acc.r += item.r;
    acc.g += item.g;
    acc.b += item.b;
    acc.brightness += item.brightness;
    return acc;
  }, { r: 0, g: 0, b: 0, brightness: 0 });
  mean.r /= edgeSamples.length;
  mean.g /= edgeSamples.length;
  mean.b /= edgeSamples.length;
  mean.brightness /= edgeSamples.length;

  let variance = 0;
  let nearBackground = 0;
  for (const item of edgeSamples) {
    const delta = item.brightness - mean.brightness;
    variance += delta * delta;
    if (
      Math.abs(item.r - mean.r) <= 10 &&
      Math.abs(item.g - mean.g) <= 10 &&
      Math.abs(item.b - mean.b) <= 10
    ) nearBackground += 1;
  }
  variance /= edgeSamples.length;
  const edgeUniformity = nearBackground / edgeSamples.length;

  // Perfil pensado para packshots reais em fundo preto/preto-grafite uniforme.
  if (
    mean.brightness > 48 ||
    variance > 260 ||
    edgeUniformity < 0.82
  ) return null;

  const data = Buffer.from(raw);
  const alphaMap = new Uint8Array(total);
  const sigma = Math.sqrt(Math.max(0, variance));
  const low = clampNumber(3 + sigma * 0.12, 3, 8);
  const high = clampNumber(22 + sigma * 0.45, 20, 34);

  const colorDistance = (index) => {
    const p = index * channels;
    const dr = raw[p] - mean.r;
    const dg = raw[p + 1] - mean.g;
    const db = raw[p + 2] - mean.b;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  };

  const localContrast = (index) => {
    const x = index % width;
    const y = Math.floor(index / width);
    const p = index * channels;
    let maxDelta = 0;
    const compare = (next) => {
      const np = next * channels;
      const dr = raw[p] - raw[np];
      const dg = raw[p + 1] - raw[np + 1];
      const db = raw[p + 2] - raw[np + 2];
      const delta = Math.sqrt(dr * dr + dg * dg + db * db);
      if (delta > maxDelta) maxDelta = delta;
    };
    if (x > 0) compare(index - 1);
    if (x + 1 < width) compare(index + 1);
    if (y > 0) compare(index - width);
    if (y + 1 < height) compare(index + width);
    return maxDelta;
  };

  let transparent = 0;
  let partial = 0;
  let opaque = 0;
  for (let i = 0; i < total; i += 1) {
    const p = i * channels;
    const originalAlpha = raw[p + 3];
    if (originalAlpha < 24) {
      alphaMap[i] = 0;
      transparent += 1;
      continue;
    }

    const distance = colorDistance(i);
    const brightness = (raw[p] + raw[p + 1] + raw[p + 2]) / 3;
    const spread =
      Math.max(raw[p], raw[p + 1], raw[p + 2]) -
      Math.min(raw[p], raw[p + 1], raw[p + 2]);
    const contrast = localContrast(i);
    const brightnessGap = Math.max(0, brightness - mean.brightness);

    const signal = Math.max(
      distance,
      brightnessGap * 1.25,
      spread * 0.72,
      contrast * 0.62
    );

    let alpha;
    if (signal <= low) alpha = 0;
    else if (signal >= high) alpha = 255;
    else {
      const normalized = clampNumber((signal - low) / Math.max(1, high - low), 0, 1);
      alpha = Math.round(255 * Math.pow(normalized, 0.65));
    }

    alpha = Math.min(originalAlpha, alpha);
    if (alpha <= 14) alpha = 0;
    else if (alpha >= 244) alpha = 255;

    alphaMap[i] = alpha;
    if (alpha === 0) transparent += 1;
    else if (alpha < 224) partial += 1;
    else opaque += 1;

    data[p + 3] = alpha;

    // Remove matte preto da borda sem redesenhar o produto.
    if (alpha > 20 && alpha < 248) {
      const a = alpha / 255;
      const recover = (observed, bg) =>
        clampNumber(Math.round((observed - bg * (1 - a)) / Math.max(0.10, a)), 0, 255);
      data[p] = recover(raw[p], mean.r);
      data[p + 1] = recover(raw[p + 1], mean.g);
      data[p + 2] = recover(raw[p + 2], mean.b);
    }
  }

  const transparentRatio = transparent / Math.max(1, total);
  const opaqueRatio = opaque / Math.max(1, total);
  const partialRatio = partial / Math.max(1, total);

  if (
    transparentRatio < 0.12 ||
    transparentRatio > 0.92 ||
    opaqueRatio < 0.055
  ) return null;

  const png = await sharp(data, { raw: info })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  const trimmed = await sharp(png)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 4 })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  const meta = await imageMetadata(trimmed);
  const longEdge = Math.max(meta.width, meta.height);
  const shortEdge = Math.min(meta.width, meta.height);
  const resolutionOk = longEdge >= 1200 && shortEdge >= 420;
  if (!resolutionOk) return null;

  return {
    buffer: trimmed,
    sourceWidth: width,
    sourceHeight: height,
    width: meta.width,
    height: meta.height,
    qualityWidth: meta.width,
    qualityHeight: meta.height,
    backgroundRemoved: true,
    removalMode: 'original_dark_background_preserved_hq',
    removedRatio: transparentRatio,
    confidence: 0.995,
    cutoutSafe: true,
    cutoutReason: 'ok',
    repairMetrics: {
      attempted: true,
      difficultProduct: true,
      originalPixelsPreserved: true,
      darkBackgroundDirectCutout: true,
      sourceBackground: {
        r: Number(mean.r.toFixed(2)),
        g: Number(mean.g.toFixed(2)),
        b: Number(mean.b.toFixed(2)),
        brightness: Number(mean.brightness.toFixed(2)),
        variance: Number(variance.toFixed(2))
      },
      internalBackgroundOk: true,
      whiteHaloOk: true,
      thinStructureDamageOk: true,
      safe: true,
      transparentRatio,
      partialRatio,
      opaqueRatio,
      resolutionEnhanced: false,
      qualityWidth: meta.width,
      qualityHeight: meta.height,
      reason: 'original_dark_background_removed_without_reconstruction'
    }
  };
}

function qualityScore(asset = {}, productText = '') {
  const repair = asset.repairMetrics || {};
  const difficult = isDifficultCreativeProduct(productText);
  const width = Number(asset.width || 0);
  const height = Number(asset.height || 0);
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);

  let score = 0;
  if (asset.backgroundRemoved) score += 25;
  if (asset.cutoutSafe !== false) score += 25;
  if (repair.internalBackgroundOk !== false) score += 18;
  if (repair.whiteHaloOk !== false) score += 14;
  if (repair.thinStructureDamageOk !== false) score += 14;

  if (difficult) {
    if (longEdge >= 1200 && shortEdge >= 420) score += 4;
    else score -= 16;
  } else if (longEdge >= 700) {
    score += 4;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

function publicAsset(doc = {}) {
  const productText = [doc.category, doc.name].filter(Boolean).join(' ');
  const difficultProduct = isDifficultCreativeProduct(productText);
  const masterReady = difficultProduct
    ? Boolean(
        doc.processedFileId &&
        doc.quality?.safe === true &&
        doc.quality?.masterResolutionOk !== false
      )
    : Boolean(doc.processedFileId);
  return {
    id: String(doc._id || ''),
    name: doc.name || '',
    category: doc.category || '',
    sku: doc.sku || '',
    notes: doc.notes || '',
    status: doc.status || 'pending',
    version: Number(doc.version || 1),
    processMode: doc.processMode || 'standard',
    original: doc.original || null,
    processed: doc.processed || null,
    quality: doc.quality || null,
    ai: doc.ai || null,
    difficultProduct,
    masterRebuildRequired: difficultProduct && !masterReady,
    masterReady,
    processing: doc.processing || null,
    lastProcessingError: doc.lastProcessingError || null,
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
    approvedAt: doc.approvedAt || null,
    rejectedAt: doc.rejectedAt || null,
    originalUrl: doc._id ? '/admin/creative-cutout-studio/assets/' + doc._id + '/original' : '',
    cutoutUrl: doc._id && doc.processedFileId
      ? '/admin/creative-cutout-studio/assets/' + doc._id + '/cutout'
      : '',
    approvedUrl: doc._id && doc.approvedFileId
      ? '/admin/creative-cutout-studio/assets/' + doc._id + '/approved'
      : ''
  };
}

async function processBuffer({
  originalBuffer,
  name,
  category,
  mode = 'standard'
}) {
  const productText = [category, name].filter(Boolean).join(' ');
  const difficultProduct = isDifficultCreativeProduct(productText);

  // REGRA PRINCIPAL: sempre preservar a fotografia real primeiro.
  // 1) tenta packshot transparente ou fundo preto uniforme sem IA;
  // 2) tenta o recorte real existente; 3) só então usa IA como fallback.
  const darkOriginalCutout = difficultProduct
    ? await cutoutUniformDarkBackgroundOriginal(originalBuffer, productText)
    : null;

  let validatedRealAsset = darkOriginalCutout;
  if (!validatedRealAsset) {
    validatedRealAsset = await prepareProProductAsset({
      name: name || 'Produto',
      category: category || '',
      originalBuffer,
      sourceType: 'creative_cutout_bank_original'
    }, {
      removeBackground: true,
      removeLightBackground: true
    });
  }

  const preservedOriginal = darkOriginalCutout || await preserveTransparentOriginalIfSafe(
    originalBuffer,
    validatedRealAsset,
    productText
  );

  let asset = preservedOriginal || validatedRealAsset;
  let realGate = realCutoutGate(asset, productText);
  let effectiveMode = preservedOriginal
    ? 'original_preserved'
    : (realGate.safe ? 'real_cutout' : 'real_cutout_failed');
  let aiMetrics = null;
  let aiFallbackUsed = false;

  const allowAiFallback =
    !realGate.safe &&
    (
      difficultProduct ||
      mode === 'ai_repair' ||
      mode === 'ai_master'
    );

  if (allowAiFallback) {
    const rebuilt = await rebuildCreativeProductFromReference({
      referenceBuffer: originalBuffer,
      asset,
      productText,
      perform: true,
      force: true
    });

    aiMetrics = rebuilt.rebuildMetrics || null;
    const genuineAiResult =
      Boolean(rebuilt?.buffer) &&
      rebuilt.cutoutSafe !== false &&
      Boolean(rebuilt.backgroundRemoved) &&
      rebuilt.removalMode === 'ai_reference_rebuild' &&
      rebuilt.rebuildMetrics?.attempted === true &&
      rebuilt.rebuildMetrics?.safe === true;

    if (!genuineAiResult) {
      const reason =
        rebuilt?.rebuildMetrics?.reason ||
        rebuilt?.cutoutReason ||
        'ai_master_rebuild_rejected';
      const error = new Error('creative_cutout_ai_repair_rejected:' + reason);
      error.code = 'creative_cutout_ai_repair_rejected';
      error.aiReason = reason;
      error.aiMetrics = aiMetrics;
      error.realCutoutReason = realGate.reason;
      throw error;
    }

    asset = rebuilt;
    aiFallbackUsed = true;
    effectiveMode = difficultProduct ? 'ai_master' : 'ai_repair';
    realGate = realCutoutGate(asset, productText);
  }

  const outputMeta = await imageMetadata(asset.buffer);
  const longEdge = Math.max(
    Number(asset.width || outputMeta.width || 0),
    Number(asset.height || outputMeta.height || 0)
  );
  const shortEdge = Math.min(
    Number(asset.width || outputMeta.width || 0),
    Number(asset.height || outputMeta.height || 0)
  );
  const masterResolutionOk = difficultProduct
    ? longEdge >= 1200 && shortEdge >= 420
    : true;

  return {
    buffer: asset.buffer,
    mode: effectiveMode,
    quality: {
      score: qualityScore(asset, productText),
      safe:
        asset.cutoutSafe !== false &&
        Boolean(asset.backgroundRemoved) &&
        asset.repairMetrics?.internalBackgroundOk !== false &&
        asset.repairMetrics?.whiteHaloOk !== false &&
        asset.repairMetrics?.thinStructureDamageOk !== false &&
        masterResolutionOk,
      reason: asset.cutoutReason || realGate.reason || 'ok',
      removalMode: asset.removalMode || '',
      removedRatio: Number(asset.removedRatio || 0),
      confidence: Number(asset.confidence || 0),
      internalBackgroundOk: asset.repairMetrics?.internalBackgroundOk !== false,
      whiteHaloOk: asset.repairMetrics?.whiteHaloOk !== false,
      thinStructureDamageOk: asset.repairMetrics?.thinStructureDamageOk !== false,
      masterResolutionOk,
      difficultProduct,
      originalPixelsPreserved: Boolean(asset.repairMetrics?.originalPixelsPreserved),
      realCutoutAttempted: true,
      aiFallbackUsed,
      realCutoutReason: aiFallbackUsed ? (validatedRealAsset.cutoutReason || 'quality_gate_failed') : 'ok',
      repairMetrics: asset.repairMetrics || null
    },
    processed: outputMeta,
    ai: aiMetrics
  };
}

export async function createCreativeCutoutAsset({
  mongoose,
  originalBuffer,
  originalName,
  mimeType,
  name,
  category,
  sku = '',
  notes = ''
}) {
  await ensureIndexes(mongoose);
  if (!Buffer.isBuffer(originalBuffer) || !originalBuffer.length) {
    throw new Error('creative_cutout_original_required');
  }

  const originalMeta = await imageMetadata(originalBuffer);
  if (!originalMeta.width || !originalMeta.height) {
    throw new Error('creative_cutout_invalid_image');
  }

  const db = ensureDb(mongoose);
  const bucket = bucketFor(mongoose);
  const collection = collectionFor(mongoose);
  const id = new mongoose.mongo.ObjectId();
  const createdAt = now();

  const originalFileId = await putBuffer(
    bucket,
    originalBuffer,
    safeFilename(originalName || name || 'produto-original'),
    mimeType || 'application/octet-stream',
    { assetId: String(id), kind: 'original' }
  );

  let processedResult = null;
  let processedFileId = null;
  const cleanName = cleanText(name || originalName || 'Produto');
  const cleanCategory = cleanText(category || '');
  const productText = [cleanCategory, cleanName].filter(Boolean).join(' ');
  const difficultProduct = isDifficultCreativeProduct(productText);
  const initialMode = 'standard';

  try {
    processedResult = await processBuffer({
      originalBuffer,
      name: cleanName,
      category: cleanCategory,
      mode: initialMode
    });

    processedFileId = await putBuffer(
      bucket,
      processedResult.buffer,
      safeFilename(name || originalName || 'produto') + '-recorte.png',
      'image/png',
      { assetId: String(id), kind: 'cutout', version: 1, mode: processedResult.mode }
    );

    const doc = {
      _id: id,
      name: cleanName,
      category: cleanCategory,
      sku: cleanText(sku || '', 80),
      notes: cleanText(notes || '', 500),
      status: 'pending',
      version: 1,
      processMode: processedResult.mode,
      originalFileId,
      processedFileId,
      approvedFileId: null,
      original: {
        filename: cleanText(originalName || 'produto', 220),
        mimeType: mimeType || '',
        ...originalMeta
      },
      processed: processedResult.processed,
      quality: processedResult.quality,
      ai: processedResult.ai,
      createdAt,
      updatedAt: createdAt,
      approvedAt: null,
      rejectedAt: null
    };

    await collection.insertOne(doc);
    return publicAsset(doc);
  } catch (error) {
    if (processedFileId) await deleteGridFile(bucket, mongoose, processedFileId);

    if (difficultProduct) {
      const failedDoc = {
        _id: id,
        name: cleanName,
        category: cleanCategory,
        sku: cleanText(sku || '', 80),
        notes: cleanText(notes || '', 500),
        status: 'pending',
        version: 1,
        processMode: 'ai_master_failed',
        originalFileId,
        processedFileId: null,
        approvedFileId: null,
        original: {
          filename: cleanText(originalName || 'produto', 220),
          mimeType: mimeType || '',
          ...originalMeta
        },
        processed: null,
        quality: {
          score: 0,
          safe: false,
          reason: error?.aiReason || error?.code || 'ai_master_rebuild_failed',
          removalMode: 'original_reference_only',
          confidence: 0,
          internalBackgroundOk: false,
          whiteHaloOk: false,
          thinStructureDamageOk: false,
          masterResolutionOk: false,
          difficultProduct: true
        },
        ai: error?.aiMetrics || null,
        lastProcessingError: {
          mode: 'ai_master',
          failedAt: now(),
          reason: cleanText(error?.aiReason || error?.code || error?.message || 'ai_master_rebuild_failed', 220)
        },
        createdAt,
        updatedAt: now(),
        approvedAt: null,
        rejectedAt: null
      };
      await collection.insertOne(failedDoc);
      return publicAsset(failedDoc);
    }

    await deleteGridFile(bucket, mongoose, originalFileId);
    throw error;
  }
}

export async function listCreativeCutoutAssets({ mongoose, status = '', limit = 60 } = {}) {
  await ensureIndexes(mongoose);
  const collection = collectionFor(mongoose);
  const normalizedStatus = String(status || '').trim().toLowerCase();
  const filter =
    normalizedStatus === 'workspace'
      ? { status: { $ne: 'approved' } }
      : normalizedStatus && normalizedStatus !== 'all'
        ? { status: normalizedStatus }
        : {};
  const rows = await collection
    .find(filter)
    .sort({ updatedAt: -1 })
    .limit(Math.max(1, Math.min(Number(limit || 60), 150)))
    .toArray();
  return rows.map(publicAsset);
}

export async function getCreativeCutoutAsset({ mongoose, id }) {
  await ensureIndexes(mongoose);
  const _id = objectId(mongoose, id);
  if (!_id) return null;
  const doc = await collectionFor(mongoose).findOne({ _id });
  return doc ? publicAsset(doc) : null;
}

async function getRawAssetDocument({ mongoose, id }) {
  const _id = objectId(mongoose, id);
  if (!_id) return null;
  return collectionFor(mongoose).findOne({ _id });
}

export async function reprocessCreativeCutoutAsset({
  mongoose,
  id,
  mode = 'standard'
}) {
  await ensureIndexes(mongoose);
  const doc = await getRawAssetDocument({ mongoose, id });
  if (!doc) return null;

  const bucket = bucketFor(mongoose);
  const collection = collectionFor(mongoose);
  const productText = [doc.category, doc.name].filter(Boolean).join(' ');
  const difficultProduct = isDifficultCreativeProduct(productText);
  const requestedMode = mode === 'ai_repair' ? 'ai_repair' : 'standard';
  const safeMode = requestedMode;
  const startedAt = now();
  const processingLeaseMs = difficultProduct || ['ai_repair','ai_master'].includes(safeMode)
    ? 15 * 60 * 1000
    : 4 * 60 * 1000;
  const expiresAt = new Date(startedAt.getTime() + processingLeaseMs);

  const activeUntil = doc.processing?.expiresAt
    ? new Date(doc.processing.expiresAt).getTime()
    : 0;
  if (activeUntil > Date.now()) {
    const error = new Error('creative_cutout_already_processing');
    error.code = 'creative_cutout_already_processing';
    error.processing = doc.processing;
    throw error;
  }

  await collection.updateOne(
    { _id: doc._id },
    {
      $set: {
        processing: {
          mode: safeMode,
          startedAt,
          expiresAt
        },
        updatedAt: startedAt
      },
      $unset: {
        lastProcessingError: ''
      }
    }
  );

  let nextFileId = null;
  try {
    const originalBuffer = await readBuffer(bucket, mongoose, doc.originalFileId);
    const result = await processBuffer({
      originalBuffer,
      name: doc.name,
      category: doc.category,
      mode: safeMode
    });

    const nextVersion = Number(doc.version || 1) + 1;
    nextFileId = await putBuffer(
      bucket,
      result.buffer,
      safeFilename(doc.name || 'produto') + '-recorte-v' + nextVersion + '.png',
      'image/png',
      {
        assetId: String(doc._id),
        kind: 'cutout',
        version: nextVersion,
        mode: result.mode
      }
    );

    const previousProcessedFileId = doc.processedFileId;
    const approvedFileId = doc.approvedFileId;
    const updatedAt = now();

    await collection.updateOne(
      { _id: doc._id },
      {
        $set: {
          processedFileId: nextFileId,
          processed: result.processed,
          quality: result.quality,
          ai: result.ai,
          processMode: result.mode,
          status: 'pending',
          version: nextVersion,
          updatedAt,
          rejectedAt: null
        },
        $unset: {
          processing: '',
          lastProcessingError: ''
        }
      }
    );

    if (
      previousProcessedFileId &&
      String(previousProcessedFileId) !== String(approvedFileId || '') &&
      String(previousProcessedFileId) !== String(nextFileId)
    ) {
      await deleteGridFile(bucket, mongoose, previousProcessedFileId);
    }

    const updated = await collection.findOne({ _id: doc._id });
    return publicAsset(updated);
  } catch (error) {
    if (nextFileId) {
      await deleteGridFile(bucket, mongoose, nextFileId).catch(() => {});
    }

    const failedAt = now();
    await collection.updateOne(
      { _id: doc._id },
      {
        $set: {
          updatedAt: failedAt,
          lastProcessingError: {
            mode: safeMode,
            failedAt,
            reason: cleanText(
              error?.aiReason ||
              error?.code ||
              error?.message ||
              'creative_cutout_processing_failed',
              220
            )
          }
        },
        $unset: {
          processing: ''
        }
      }
    ).catch(() => {});

    throw error;
  }
}

export async function approveCreativeCutoutAsset({ mongoose, id }) {
  await ensureIndexes(mongoose);
  const _id = objectId(mongoose, id);
  if (!_id) return null;
  const collection = collectionFor(mongoose);
  const doc = await collection.findOne({ _id });
  if (!doc || !doc.processedFileId) return null;

  const productText = [doc.category, doc.name].filter(Boolean).join(' ');
  if (isDifficultCreativeProduct(productText)) {
    const masterReady =
      Boolean(doc.processedFileId) &&
      doc.quality?.safe === true &&
      doc.quality?.masterResolutionOk !== false;
    if (!masterReady) {
      const error = new Error('creative_cutout_master_rebuild_required');
      error.code = 'creative_cutout_master_rebuild_required';
      throw error;
    }
  }

  const timestamp = now();
  await collection.updateOne(
    { _id },
    {
      $set: {
        status: 'approved',
        approvedFileId: doc.processedFileId,
        approvedAt: timestamp,
        updatedAt: timestamp,
        rejectedAt: null
      }
    }
  );
  return publicAsset(await collection.findOne({ _id }));
}

export async function rejectCreativeCutoutAsset({ mongoose, id }) {
  await ensureIndexes(mongoose);
  const _id = objectId(mongoose, id);
  if (!_id) return null;
  const collection = collectionFor(mongoose);
  const timestamp = now();
  const result = await collection.findOneAndUpdate(
    { _id },
    {
      $set: {
        status: 'rejected',
        rejectedAt: timestamp,
        updatedAt: timestamp
      }
    },
    { returnDocument: 'after' }
  );
  const value = result?.value || result;
  return value?._id ? publicAsset(value) : null;
}

export async function deleteCreativeCutoutAsset({ mongoose, id }) {
  await ensureIndexes(mongoose);
  const doc = await getRawAssetDocument({ mongoose, id });
  if (!doc) return false;
  const bucket = bucketFor(mongoose);
  const ids = [doc.originalFileId, doc.processedFileId, doc.approvedFileId]
    .filter(Boolean)
    .map(value => String(value));
  for (const unique of [...new Set(ids)]) {
    await deleteGridFile(bucket, mongoose, unique);
  }
  await collectionFor(mongoose).deleteOne({ _id: doc._id });
  return true;
}

export async function updateCreativeCutoutAssetMetadata({
  mongoose,
  id,
  name,
  category,
  sku,
  notes
}) {
  await ensureIndexes(mongoose);
  const _id = objectId(mongoose, id);
  if (!_id) return null;
  const set = { updatedAt: now() };
  if (name !== undefined) set.name = cleanText(name || 'Produto');
  if (category !== undefined) set.category = cleanText(category || '');
  if (sku !== undefined) set.sku = cleanText(sku || '', 80);
  if (notes !== undefined) set.notes = cleanText(notes || '', 500);
  const collection = collectionFor(mongoose);
  await collection.updateOne({ _id }, { $set: set });
  const doc = await collection.findOne({ _id });
  return doc ? publicAsset(doc) : null;
}

export async function getCreativeCutoutFile({
  mongoose,
  id,
  kind = 'cutout'
}) {
  await ensureIndexes(mongoose);
  const doc = await getRawAssetDocument({ mongoose, id });
  if (!doc) return null;
  const fileId =
    kind === 'original'
      ? doc.originalFileId
      : kind === 'approved'
        ? doc.approvedFileId
        : doc.processedFileId;
  if (!fileId) return null;

  const bucket = bucketFor(mongoose);
  const buffer = await readBuffer(bucket, mongoose, fileId);
  return {
    buffer,
    contentType: kind === 'original'
      ? (doc.original?.mimeType || 'application/octet-stream')
      : 'image/png',
    filename: kind === 'original'
      ? (doc.original?.filename || 'produto-original')
      : safeFilename(doc.name || 'produto') + '-' + kind + '.png'
  };
}

export async function creativeCutoutSummary({ mongoose }) {
  await ensureIndexes(mongoose);
  const collection = collectionFor(mongoose);
  const rows = await collection.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } }
  ]).toArray();
  const summary = { total: 0, pending: 0, approved: 0, rejected: 0 };
  for (const row of rows) {
    const key = String(row._id || 'pending');
    const count = Number(row.count || 0);
    summary.total += count;
    if (Object.prototype.hasOwnProperty.call(summary, key)) summary[key] = count;
  }
  return summary;
}
