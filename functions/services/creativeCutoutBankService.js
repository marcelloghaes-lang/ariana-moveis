import sharp from 'sharp';
import { prepareProProductAsset } from '../creative-banner-pro-generator.js';
import {
  rebuildCreativeProductFromReference,
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

function qualityScore(asset = {}, productText = '') {
  const repair = asset.repairMetrics || {};
  const fan = isFanCreativeProduct(productText);
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

  if (fan) {
    if (longEdge >= 1300 && shortEdge >= 480) score += 4;
    else score -= 16;
  } else if (longEdge >= 700) {
    score += 4;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

function publicAsset(doc = {}) {
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
  let asset = await prepareProProductAsset({
    name: name || 'Produto',
    category: category || '',
    originalBuffer,
    sourceType: 'creative_cutout_bank_original'
  }, {
    removeBackground: true,
    removeLightBackground: true
  });

  let aiMetrics = null;
  if (mode === 'ai_repair') {
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
        'ai_master_repair_rejected';
      const error = new Error('creative_cutout_ai_repair_rejected:' + reason);
      error.code = 'creative_cutout_ai_repair_rejected';
      error.aiReason = reason;
      error.aiMetrics = aiMetrics;
      throw error;
    }

    asset = rebuilt;
  }

  const outputMeta = await imageMetadata(asset.buffer);
  return {
    buffer: asset.buffer,
    mode,
    quality: {
      score: qualityScore(asset, productText),
      safe: asset.cutoutSafe !== false && Boolean(asset.backgroundRemoved),
      reason: asset.cutoutReason || 'ok',
      removalMode: asset.removalMode || '',
      removedRatio: Number(asset.removedRatio || 0),
      confidence: Number(asset.confidence || 0),
      internalBackgroundOk: asset.repairMetrics?.internalBackgroundOk !== false,
      whiteHaloOk: asset.repairMetrics?.whiteHaloOk !== false,
      thinStructureDamageOk: asset.repairMetrics?.thinStructureDamageOk !== false,
      masterResolutionOk: isFanCreativeProduct(productText)
        ? (
            Math.max(Number(asset.width || 0), Number(asset.height || 0)) >= 1300 &&
            Math.min(Number(asset.width || 0), Number(asset.height || 0)) >= 480
          )
        : true,
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
  try {
    processedResult = await processBuffer({
      originalBuffer,
      name: cleanText(name || originalName || 'Produto'),
      category: cleanText(category || ''),
      mode: 'standard'
    });

    processedFileId = await putBuffer(
      bucket,
      processedResult.buffer,
      safeFilename(name || originalName || 'produto') + '-recorte.png',
      'image/png',
      { assetId: String(id), kind: 'cutout', version: 1, mode: 'standard' }
    );

    const doc = {
      _id: id,
      name: cleanText(name || originalName || 'Produto'),
      category: cleanText(category || ''),
      sku: cleanText(sku || '', 80),
      notes: cleanText(notes || '', 500),
      status: 'pending',
      version: 1,
      processMode: 'standard',
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
  const safeMode = mode === 'ai_repair' ? 'ai_repair' : 'standard';
  const startedAt = now();
  const expiresAt = new Date(startedAt.getTime() + 4 * 60 * 1000);

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
        mode: safeMode
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
          processMode: safeMode,
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
