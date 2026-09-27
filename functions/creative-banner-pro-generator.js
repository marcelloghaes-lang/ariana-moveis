import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PRO_BANNER_FORMATS = Object.freeze({
  hero_desktop: Object.freeze({ width: 1920, height: 480, label: 'Hero Desktop', device: 'desktop' }),
  hero_mobile: Object.freeze({ width: 1080, height: 1080, label: 'Hero Mobile', device: 'mobile' }),
  secondary_desktop: Object.freeze({ width: 1600, height: 400, label: 'Secundário Desktop', device: 'desktop' }),
  secondary_mobile: Object.freeze({ width: 1080, height: 720, label: 'Secundário Mobile', device: 'mobile' }),
  square: Object.freeze({ width: 1080, height: 1080, label: 'Card Quadrado', device: 'mobile' })
});

export const PRO_TEMPLATES = Object.freeze({
  marketplace: Object.freeze({ label: 'Marketplace Impacto' }),
  premium: Object.freeze({ label: 'Premium Ariana' }),
  campaign: Object.freeze({ label: 'Campanha Forte' })
});

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function money(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Math.max(0, number(value)));
}

function escapeXml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function clean(value = '', max = 160) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function wrap(value = '', maxChars = 26, maxLines = 2) {
  const words = clean(value, 240).split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const lines = [];
  let current = '';

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const candidate = current ? current + ' ' + word : word;

    if (!current || candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    if (lines.length < maxLines - 1) {
      lines.push(current);
      current = word;
      continue;
    }

    const remaining = [current, ...words.slice(index)].filter(Boolean).join(' ');
    const clipped = remaining.length > maxChars
      ? remaining.slice(0, Math.max(3, maxChars - 1)).replace(/\s+\S*$/, '').trim() + '…'
      : remaining;
    current = clipped;
    break;
  }

  if (current && lines.length < maxLines) lines.push(current);
  return lines.slice(0, maxLines);
}

function linesSvg(lines, { x, y, size, lineHeight, fill, weight = 900, anchor = 'start', letterSpacing = 0 }) {
  return lines.map((line, index) =>
    '<text x="' + x + '" y="' + (y + index * lineHeight) + '" text-anchor="' + anchor +
    '" font-family="Arial,Helvetica,sans-serif" font-size="' + size + '" font-weight="' + weight +
    '" letter-spacing="' + letterSpacing + '" fill="' + fill + '">' + escapeXml(line) + '</text>'
  ).join('');
}

export function resolveProFormat(value = '') {
  const key = String(value || '').trim().toLowerCase();
  const id = PRO_BANNER_FORMATS[key] ? key : 'hero_desktop';
  return { id, ...PRO_BANNER_FORMATS[id] };
}

export function resolveProTemplate(value = '') {
  const key = String(value || '').trim().toLowerCase();
  return PRO_TEMPLATES[key] ? key : 'marketplace';
}

function decodeDataUrl(url = '') {
  const match = String(url).match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) return null;
  return match[2]
    ? Buffer.from(match[3], 'base64')
    : Buffer.from(decodeURIComponent(match[3]), 'utf8');
}

async function loadImage(url = '') {
  const value = String(url || '').trim();
  if (!value) return null;
  if (value.startsWith('data:')) return decodeDataUrl(value);

  if (/^https?:\/\//i.test(value)) {
    const response = await fetch(value, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('product_image_http_' + response.status);
    const data = await response.arrayBuffer();
    if (data.byteLength > 20 * 1024 * 1024) throw new Error('product_image_too_large');
    return Buffer.from(data);
  }

  if (fs.existsSync(value)) return fs.readFileSync(value);
  return null;
}

function productImage(product = {}, options = {}) {
  const images = Array.isArray(product.images) ? product.images : [];
  const primary = images.find(item => item?.isMain && (item.url || item.imageUrl))
    || images.find(item => item?.url || item?.imageUrl);

  return String(
    options.imageUrl ||
    product.mainImageUrl ||
    product.imageUrl ||
    product.image ||
    product.imagem ||
    primary?.url ||
    primary?.imageUrl ||
    ''
  ).trim();
}

function logoPath() {
  const configured = String(process.env.ARIANA_OFFICIAL_LOGO_PATH || '').trim();
  const candidates = [
    configured,
    path.resolve(__dirname, '../public/imagens/logo-original-3d.png')
  ].filter(Boolean);
  return candidates.find(file => fs.existsSync(file)) || '';
}

let officialLogoAssetCache = null;

export async function prepareOfficialLogoAsset(input = '') {
  if (!input && officialLogoAssetCache) return officialLogoAssetCache;

  const file = input || logoPath();
  if (!file) throw new Error('official_ariana_logo_missing');

  const source = sharp(file).rotate().ensureAlpha();
  const { data, info } = await source.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const total = width * height;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  function isBlackBackground(index) {
    const p = index * channels;
    const alpha = data[p + 3];
    if (alpha < 20) return true;
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return max <= 42 && (max - min) <= 22;
  }

  function enqueue(index) {
    if (visited[index] || !isBlackBackground(index)) return;
    visited[index] = 1;
    queue[tail++] = index;
  }

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

  for (let i = 0; i < total; i += 1) {
    if (visited[i]) data[i * channels + 3] = 0;
  }

  const transparentRatio = tail / Math.max(1, total);
  const png = await sharp(data, { raw: info }).png().toBuffer();
  const trimmed = await sharp(png)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 5 })
    .png()
    .toBuffer();
  const meta = await sharp(trimmed).metadata();

  if (!meta.width || !meta.height || transparentRatio < 0.02) {
    throw new Error('official_ariana_logo_background_not_removed');
  }

  const result = {
    buffer: trimmed,
    width: meta.width,
    height: meta.height,
    transparentRatio,
    backgroundRemoved: true
  };

  if (!input) officialLogoAssetCache = result;
  return result;
}

async function logoLayer(format) {
  const asset = await prepareOfficialLogoAsset();
  const mobile = format.device === 'mobile';
  const width = mobile ? Math.round(format.width * .32) : Math.round(format.height * .60);
  const height = mobile ? Math.round(format.height * .090) : Math.round(format.height * .140);
  const buffer = await sharp(asset.buffer)
    .resize(width, height, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 0 }
    })
    .png()
    .toBuffer();
  const meta = await sharp(buffer).metadata();
  return {
    input: buffer,
    left: mobile
      ? Math.round((format.width - Number(meta.width || width)) / 2)
      : Math.round(format.width * .055),
    top: mobile ? Math.round(format.height * .018) : Math.round(format.height * .020)
  };
}

function productCategoryText(product = {}) {
  return clean([
    product.category,
    product.categoryName,
    product.name,
    product.title
  ].filter(Boolean).join(' '), 240).toLowerCase();
}

function defaultBenefit(product = {}) {
  const text = productCategoryText(product);
  if (/smart\s*tv|televis|\btv\b|roku|monitor/.test(text)) return 'Imagem, conectividade e entretenimento para transformar sua sala.';
  if (/geladeira|refrigerador|freezer/.test(text)) return 'Mais espaço, conservação e praticidade para a rotina da sua casa.';
  if (/fog[aã]o|cooktop|forno|micro/.test(text)) return 'Praticidade e desempenho para deixar sua cozinha completa.';
  if (/lavadora|m[aá]quina de lavar|tanquinho/.test(text)) return 'Mais eficiência e praticidade para cuidar das suas roupas.';
  if (/ventilador|climatizador|ar condicionado/.test(text)) return 'Mais conforto e bem-estar para os dias quentes.';
  if (/sof[aá]|rack|painel|guarda|arm[aá]rio|mesa|cadeira|m[oó]ve/.test(text)) return 'Design, conforto e funcionalidade para renovar sua casa.';
  if (/smartphone|celular|iphone|galaxy/.test(text)) return 'Tecnologia e desempenho para acompanhar sua rotina.';
  return 'Qualidade, praticidade e condições especiais para sua casa.';
}

function colorStats(raw, info) {
  const { width, height, channels } = info;
  const samples = [];
  const stepX = Math.max(1, Math.floor(width / 120));
  const stepY = Math.max(1, Math.floor(height / 120));

  function add(x, y) {
    const idx = (y * width + x) * channels;
    const a = channels >= 4 ? raw[idx + 3] : 255;
    if (a < 20) return;
    samples.push([raw[idx], raw[idx + 1], raw[idx + 2]]);
  }

  for (let x = 0; x < width; x += stepX) {
    add(x, 0);
    add(x, height - 1);
  }
  for (let y = 0; y < height; y += stepY) {
    add(0, y);
    add(width - 1, y);
  }

  if (!samples.length) return { r: 255, g: 255, b: 255, variance: 0, brightness: 255 };

  const mean = samples.reduce((acc, rgb) => {
    acc[0] += rgb[0];
    acc[1] += rgb[1];
    acc[2] += rgb[2];
    return acc;
  }, [0, 0, 0]).map(value => value / samples.length);

  const variance = samples.reduce((sum, rgb) => {
    const dr = rgb[0] - mean[0];
    const dg = rgb[1] - mean[1];
    const db = rgb[2] - mean[2];
    return sum + (dr * dr + dg * dg + db * db) / 3;
  }, 0) / samples.length;

  return {
    r: mean[0],
    g: mean[1],
    b: mean[2],
    variance,
    brightness: (mean[0] + mean[1] + mean[2]) / 3
  };
}

async function removeConnectedBackground(buffer, enabled = true) {
  const source = sharp(buffer)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha();

  const sourceMeta = await source.metadata();
  const { data, info } = await source.raw().toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;
  const channels = info.channels;
  const total = width * height;

  let transparentPixels = 0;
  for (let i = 0; i < total; i += 1) {
    const alpha = data[i * channels + 3];
    if (alpha < 40) transparentPixels += 1;
  }

  const initialTransparentRatio = transparentPixels / Math.max(1, total);
  if (!enabled || initialTransparentRatio > 0.03) {
    const png = await source.png().toBuffer();
    const trimmed = await sharp(png)
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
      .png()
      .toBuffer();
    const meta = await sharp(trimmed).metadata();
    return {
      buffer: trimmed,
      sourceWidth: sourceMeta.width || width,
      sourceHeight: sourceMeta.height || height,
      width: meta.width || width,
      height: meta.height || height,
      backgroundRemoved: initialTransparentRatio > 0.03,
      removalMode: initialTransparentRatio > 0.03 ? 'existing_alpha' : 'disabled',
      removedRatio: initialTransparentRatio,
      confidence: initialTransparentRatio > 0.03 ? 1 : 0
    };
  }

  const bg = colorStats(data, info);
  const uniformEdge = bg.variance < 1200;
  const lightEdge = bg.brightness >= 205;
  if (!uniformEdge && !lightEdge) {
    const original = await source.png().toBuffer();
    const meta = await sharp(original).metadata();
    return {
      buffer: original,
      sourceWidth: sourceMeta.width || width,
      sourceHeight: sourceMeta.height || height,
      width: meta.width || width,
      height: meta.height || height,
      backgroundRemoved: false,
      removalMode: 'complex_background',
      removedRatio: 0,
      confidence: 0.15
    };
  }

  const tolerance = lightEdge ? 72 : clamp(42 + Math.sqrt(Math.max(0, bg.variance)) * 0.45, 42, 68);
  const tolerance2 = tolerance * tolerance;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  function matches(index) {
    const p = index * channels;
    const alpha = data[p + 3];
    if (alpha < 24) return true;
    const dr = data[p] - bg.r;
    const dg = data[p + 1] - bg.g;
    const db = data[p + 2] - bg.b;
    const dist2 = dr * dr + dg * dg + db * db;
    const pixelBrightness = (data[p] + data[p + 1] + data[p + 2]) / 3;
    if (lightEdge && pixelBrightness >= 225 && dist2 < tolerance2 * 1.4) return true;
    return dist2 < tolerance2;
  }

  function enqueue(index) {
    if (visited[index] || !matches(index)) return;
    visited[index] = 1;
    queue[tail++] = index;
  }

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
  if (removedRatio < 0.015 || removedRatio > 0.94) {
    const original = await source.png().toBuffer();
    const meta = await sharp(original).metadata();
    return {
      buffer: original,
      sourceWidth: sourceMeta.width || width,
      sourceHeight: sourceMeta.height || height,
      width: meta.width || width,
      height: meta.height || height,
      backgroundRemoved: false,
      removalMode: removedRatio > 0.94 ? 'unsafe_overremove_blocked' : 'no_background_detected',
      removedRatio,
      confidence: removedRatio > 0.94 ? 0 : 0.3
    };
  }

  for (let i = 0; i < total; i += 1) {
    if (visited[i]) data[i * channels + 3] = 0;
  }

  // Feather one pixel along the cut edge.
  for (let i = 0; i < total; i += 1) {
    if (visited[i]) continue;
    const x = i % width;
    const y = Math.floor(i / width);
    const touchesRemoved =
      (x > 0 && visited[i - 1]) ||
      (x + 1 < width && visited[i + 1]) ||
      (y > 0 && visited[i - width]) ||
      (y + 1 < height && visited[i + width]);
    if (touchesRemoved) {
      const alphaIndex = i * channels + 3;
      data[alphaIndex] = Math.min(data[alphaIndex], 224);
    }
  }

  const png = await sharp(data, { raw: info }).png().toBuffer();
  const trimmed = await sharp(png)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
    .png()
    .toBuffer();
  const meta = await sharp(trimmed).metadata();

  const confidence = clamp(
    (uniformEdge ? 0.45 : 0.2) +
    (lightEdge ? 0.25 : 0.1) +
    Math.min(0.25, removedRatio * 0.35),
    0,
    0.98
  );

  return {
    buffer: trimmed,
    sourceWidth: sourceMeta.width || width,
    sourceHeight: sourceMeta.height || height,
    width: meta.width || width,
    height: meta.height || height,
    backgroundRemoved: true,
    removalMode: lightEdge ? 'connected_light_background' : 'connected_uniform_background',
    removedRatio,
    confidence
  };
}

function normalizedOptions(product = {}, options = {}) {
  const cashPrice = number(options.cashPrice ?? product.cashPrice ?? product.pixPrice ?? product.price);
  const fullPrice = number(options.fullPrice ?? product.fullPrice ?? product.price, cashPrice);
  const installmentCount = Math.max(1, Math.round(number(options.installmentCount ?? product.installmentCount, 12)));
  const installmentPrice = number(options.installmentPrice ?? product.installmentPrice, fullPrice > 0 ? fullPrice / installmentCount : 0);
  const requestedPrice = options.showPrice !== false && String(options.contentMode || '') !== 'no_price';
  const showPrice = requestedPrice && cashPrice > 0;
  const template = resolveProTemplate(options.templatePro || options.template);
  const format = resolveProFormat(options.outputFormat || options.format);
  const productName = clean(options.productName || product.name || product.title || 'Produto Ariana Móveis', 110);
  const headline = clean(options.headline || (showPrice ? 'OFERTA IMPERDÍVEL' : 'DESTAQUE ARIANA'), 72).toUpperCase();
  const subtitle = clean(options.subtitle || defaultBenefit(product), 120);
  const benefit = clean(options.benefit || defaultBenefit(product), 150);
  const cta = clean(options.cta || (showPrice ? 'APROVEITE AGORA' : 'CONFIRA NO SITE'), 42).toUpperCase();
  const badge = clean(options.badge || (
    template === 'premium' ? 'SELEÇÃO ARIANA' :
    template === 'campaign' ? 'CAMPANHA ESPECIAL' :
    'OFERTA ARIANA'
  ), 42).toUpperCase();
  const brandLabel = clean(options.brandLabel || options.brand || product.brand || product.brandName || '', 34).toUpperCase();
  const couponText = clean(options.couponText || options.coupon || '', 26).toUpperCase();
  const promoText = clean(options.promoText || (showPrice ? 'OFERTA POR TEMPO LIMITADO' : 'CONDIÇÕES ESPECIAIS'), 46).toUpperCase();

  return {
    format,
    template,
    showPrice,
    cashPrice,
    fullPrice,
    installmentCount,
    installmentPrice,
    productName,
    headline,
    subtitle,
    benefit,
    cta,
    badge,
    brandLabel,
    couponText,
    promoText,
    siteLabel: clean(options.siteLabel || 'arianamoveis.com.br', 45),
    removeBackground: options.removeBackground !== false && options.removeLightBackground !== false
  };
}

function composition(format, asset, opts) {
  const mobile = format.device === 'mobile';
  const aspect = asset.width / Math.max(1, asset.height);
  const orientation = aspect < 0.72 ? 'vertical' : aspect > 1.35 ? 'horizontal' : 'balanced';

  if (!mobile) {
    const productW = orientation === 'horizontal' ? 0.46 : orientation === 'vertical' ? 0.34 : 0.40;
    return {
      mobile,
      orientation,
      text: { x: 0.055, y: 0.10, w: 0.50, h: 0.80 },
      product: { x: 1 - productW - 0.035, y: orientation === 'vertical' ? 0.035 : 0.08, w: productW, h: orientation === 'vertical' ? 0.92 : 0.84 }
    };
  }

  const productHeight = opts.showPrice
    ? (orientation === 'vertical' ? 0.39 : 0.31)
    : (orientation === 'vertical' ? 0.40 : 0.33);
  return {
    mobile,
    orientation,
    text: { x: 0.06, y: 0.06, w: 0.88, h: 0.24 },
    product: {
      x: orientation === 'horizontal' ? 0.08 : 0.13,
      y: opts.showPrice ? 0.34 : 0.33,
      w: orientation === 'horizontal' ? 0.84 : 0.74,
      h: productHeight
    }
  };
}

function backgroundSvg(format, template) {
  const w = format.width;
  const h = format.height;

  if (template === 'premium') {
    return Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' +
      '<defs>' +
      '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#071B3B"/><stop offset=".56" stop-color="#0B2D61"/><stop offset="1" stop-color="#020B19"/></linearGradient>' +
      '<radialGradient id="g" cx="79%" cy="45%" r="52%"><stop offset="0" stop-color="#FFE19A" stop-opacity=".20"/><stop offset=".48" stop-color="#D5A634" stop-opacity=".07"/><stop offset="1" stop-color="#D5A634" stop-opacity="0"/></radialGradient>' +
      '</defs>' +
      '<rect width="100%" height="100%" fill="url(#bg)"/><rect width="100%" height="100%" fill="url(#g)"/>' +
      '<circle cx="' + Math.round(w*.88) + '" cy="' + Math.round(h*.30) + '" r="' + Math.round(h*.42) + '" fill="none" stroke="#EFC75E" stroke-opacity=".15" stroke-width="' + Math.max(2,Math.round(h*.008)) + '"/>' +
      '<circle cx="' + Math.round(w*.88) + '" cy="' + Math.round(h*.30) + '" r="' + Math.round(h*.30) + '" fill="none" stroke="#EFC75E" stroke-opacity=".10" stroke-width="' + Math.max(2,Math.round(h*.005)) + '"/>' +
      '<path d="M0 ' + Math.round(h*.89) + ' L' + Math.round(w*.57) + ' ' + Math.round(h*.89) + '" stroke="#EFC75E" stroke-opacity=".72" stroke-width="' + Math.max(3,Math.round(h*.012)) + '"/>' +
      '</svg>'
    );
  }

  if (template === 'campaign') {
    return Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' +
      '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0062D6"/><stop offset=".50" stop-color="#003E9A"/><stop offset="1" stop-color="#031F56"/></linearGradient></defs>' +
      '<rect width="100%" height="100%" fill="url(#bg)"/>' +
      '<path d="M' + Math.round(w*.58) + ' 0 H' + w + ' V' + h + ' H' + Math.round(w*.73) + ' Z" fill="#0EA5E9" opacity=".18"/>' +
      '<path d="M' + Math.round(w*.74) + ' 0 H' + w + ' V' + h + ' H' + Math.round(w*.87) + ' Z" fill="#FFD51B" opacity=".92"/>' +
      '<circle cx="' + Math.round(w*.10) + '" cy="' + Math.round(h*.92) + '" r="' + Math.round(h*.34) + '" fill="#ffffff" opacity=".06"/>' +
      '<g fill="#ffffff" opacity=".12">' +
      Array.from({length:14},(_,i)=>'<circle cx="' + Math.round(w*(.04+i*.035)) + '" cy="' + Math.round(h*.12) + '" r="' + Math.max(2,Math.round(h*.008)) + '"/>').join('') +
      '</g></svg>'
    );
  }

  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' +
    '<defs>' +
    '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#005EEB"/><stop offset=".48" stop-color="#0047AB"/><stop offset="1" stop-color="#08285A"/></linearGradient>' +
    '<radialGradient id="glow" cx="80%" cy="48%" r="58%"><stop offset="0" stop-color="#ffffff" stop-opacity=".22"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>' +
    '</defs>' +
    '<rect width="100%" height="100%" fill="url(#bg)"/><rect width="100%" height="100%" fill="url(#glow)"/>' +
    '<path d="M' + Math.round(w*.66) + ' -' + Math.round(h*.12) + ' L' + Math.round(w*.76) + ' -' + Math.round(h*.12) + ' L' + Math.round(w*.62) + ' ' + Math.round(h*1.10) + ' L' + Math.round(w*.50) + ' ' + Math.round(h*1.10) + ' Z" fill="#FFD51B" opacity=".95"/>' +
    '<path d="M' + Math.round(w*.71) + ' -' + Math.round(h*.12) + ' L' + Math.round(w*.82) + ' -' + Math.round(h*.12) + ' L' + Math.round(w*.68) + ' ' + Math.round(h*1.10) + ' L' + Math.round(w*.60) + ' ' + Math.round(h*1.10) + ' Z" fill="#ffffff" opacity=".07"/>' +
    '</svg>'
  );
}


function pillSvg({ x, y, w, h, fill = '#ffffff', text = '', textFill = '#0047AB', fs = 18, icon = '' }) {
  const radius = Math.round(h / 2);
  const iconPart = icon
    ? '<text x="' + (x + Math.round(h*.52)) + '" y="' + (y + Math.round(h*.67)) + '" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="' + Math.round(fs*1.05) + '" font-weight="900" fill="' + textFill + '">' + escapeXml(icon) + '</text>'
    : '';
  const textX = icon ? x + Math.round(h*.98) : x + Math.round(w/2);
  const anchor = icon ? 'start' : 'middle';
  return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + radius + '" fill="' + fill + '"/>' +
    iconPart +
    '<text x="' + textX + '" y="' + (y + Math.round(h*.66)) + '" text-anchor="' + anchor + '" font-family="Arial,Helvetica,sans-serif" font-size="' + fs + '" font-weight="900" fill="' + textFill + '">' + escapeXml(text) + '</text>';
}

function marketplaceDesktopOverlay(format, opts) {
  const w=format.width, h=format.height, x=Math.round(w*.055);
  const textW=Math.round(w*.47);
  const headlineFs=Math.round(h*(opts.headline.length>30?.095:.112));
  const headlineLines=wrap(opts.headline, Math.max(18,Math.floor(textW/(headlineFs*.56))),2);
  const badgeFs=Math.round(h*.036);
  const subtitleFs=Math.round(h*.041);
  const priceFs=Math.round(h*.125);
  const productNameFs=Math.round(h*.038);
  const bottomY=Math.round(h*.835), pillH=Math.round(h*.105);
  const gap=Math.round(w*.010);
  const pill1W=Math.round(w*.165), pill2W=Math.round(w*.175), pill3W=Math.round(w*.135);
  const pill1Text=opts.showPrice ? (opts.installmentCount+'x de '+money(opts.installmentPrice)) : 'CONDIÇÕES ESPECIAIS';
  const pill2Text=opts.promoText;
  const headlineY=Math.round(h*.235);
  const subtitleY=headlineY+headlineLines.length*headlineFs*1.00+Math.round(h*.025);
  let price='';
  if(opts.showPrice){
    price='<text x="'+x+'" y="'+Math.round(h*.585)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(h*.027)+'" font-weight="900" fill="#ffffff" opacity=".86">À VISTA NO PIX</text>'+
      '<text x="'+x+'" y="'+Math.round(h*.715)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+priceFs+'" font-weight="950" fill="#FFD51B">'+escapeXml(money(opts.cashPrice))+'</text>';
  } else {
    const b=wrap(opts.benefit,44,2);
    price=linesSvg(b,{x,y:Math.round(h*.615),size:Math.round(h*.040),lineHeight:Math.round(h*.050),fill:'#ffffff',weight:700});
  }
  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'">'+
    '<rect x="'+x+'" y="'+Math.round(h*.145)+'" width="'+Math.round(Math.max(h*.30,opts.badge.length*badgeFs*.65))+'" height="'+Math.round(h*.064)+'" rx="'+Math.round(h*.032)+'" fill="#FFD51B"/>'+
    '<text x="'+(x+Math.round(h*.035))+'" y="'+Math.round(h*.188)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+badgeFs+'" font-weight="950" fill="#06306A">'+escapeXml(opts.badge)+'</text>'+
    linesSvg(headlineLines,{x,y:headlineY,size:headlineFs,lineHeight:headlineFs*.98,fill:'#ffffff',weight:950})+
    '<text x="'+x+'" y="'+subtitleY+'" font-family="Arial,Helvetica,sans-serif" font-size="'+subtitleFs+'" font-weight="650" fill="#ffffff" opacity=".94">'+escapeXml(opts.subtitle)+'</text>'+
    '<text x="'+x+'" y="'+Math.round(h*.515)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+productNameFs+'" font-weight="800" fill="#ffffff" opacity=".95">'+escapeXml(opts.productName)+'</text>'+
    price+
    pillSvg({x,y:bottomY,w:pill1W,h:pillH,fill:'#071D49',text:pill1Text,textFill:'#ffffff',fs:Math.round(h*.031),icon:'▣'})+
    pillSvg({x:x+pill1W+gap,y:bottomY,w:pill2W,h:pillH,fill:'#FFD51B',text:pill2Text,textFill:'#08285A',fs:Math.round(h*.029),icon:'◷'})+
    pillSvg({x:x+pill1W+pill2W+gap*2,y:bottomY,w:pill3W,h:pillH,fill:'#ffffff',text:opts.cta,textFill:'#0047AB',fs:Math.round(h*.031)})+
    '</svg>'
  );
}

function premiumDesktopOverlay(format, opts) {
  const w=format.width,h=format.height,x=Math.round(w*.055), textW=Math.round(w*.43);
  const headlineFs=Math.round(h*(opts.headline.length>30?.085:.105));
  const headlineLines=wrap(opts.headline,Math.max(18,Math.floor(textW/(headlineFs*.56))),2);
  const brand=opts.brandLabel ? opts.brandLabel+' • ' : '';
  const kicker=brand+'SELEÇÃO ESPECIAL';
  const body=wrap(opts.benefit,46,2);
  const ctaY=Math.round(h*.78),ctaH=Math.round(h*.095);
  let pricing='';
  if(opts.showPrice){
    pricing='<text x="'+x+'" y="'+Math.round(h*.635)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(h*.030)+'" font-weight="800" fill="#F0CA6A">NO PIX</text>'+
      '<text x="'+x+'" y="'+Math.round(h*.750)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(h*.110)+'" font-weight="950" fill="#F0CA6A">'+escapeXml(money(opts.cashPrice))+'</text>';
  }
  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'">'+
    '<text x="'+x+'" y="'+Math.round(h*.22)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(h*.035)+'" font-weight="900" letter-spacing="2" fill="#F0CA6A">'+escapeXml(kicker)+'</text>'+
    linesSvg(headlineLines,{x,y:Math.round(h*.34),size:headlineFs,lineHeight:headlineFs*1.00,fill:'#ffffff',weight:900})+
    '<text x="'+x+'" y="'+Math.round(h*.55)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(h*.040)+'" font-weight="650" fill="#ffffff" opacity=".86">'+escapeXml(opts.productName)+'</text>'+
    (opts.showPrice?pricing:linesSvg(body,{x,y:Math.round(h*.66),size:Math.round(h*.038),lineHeight:Math.round(h*.050),fill:'#ffffff',weight:650}))+
    '<rect x="'+x+'" y="'+ctaY+'" width="'+Math.round(textW*.42)+'" height="'+ctaH+'" rx="'+Math.round(ctaH*.5)+'" fill="#F0CA6A"/>'+
    '<text x="'+(x+Math.round(textW*.21))+'" y="'+(ctaY+Math.round(ctaH*.66))+'" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(h*.033)+'" font-weight="950" fill="#071B3B">'+escapeXml(opts.cta)+'</text>'+
    '<text x="'+(x+Math.round(textW*.47))+'" y="'+(ctaY+Math.round(ctaH*.66))+'" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(h*.030)+'" font-weight="800" fill="#ffffff">'+escapeXml(opts.siteLabel)+'</text>'+
    '</svg>'
  );
}

function campaignDesktopOverlay(format, opts) {
  const w=format.width,h=format.height,x=Math.round(w*.055);
  const brand=opts.brandLabel || 'ARIANA';
  const special='ESPECIAL '+brand;
  const headline=opts.couponText ? 'USE O CUPOM' : opts.headline;
  const campaignMain=opts.couponText || opts.headline;
  const bottomY=Math.round(h*.82),pillH=Math.round(h*.11),gap=Math.round(w*.010);
  const pillW=Math.round(w*.17);
  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'">'+
    '<text x="'+x+'" y="'+Math.round(h*.205)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(h*.046)+'" font-weight="900" letter-spacing="3" fill="#ffffff">'+escapeXml(special)+'</text>'+
    '<text x="'+x+'" y="'+Math.round(h*.345)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(h*.105)+'" font-weight="950" fill="#ffffff">'+escapeXml(headline)+'</text>'+
    '<rect x="'+x+'" y="'+Math.round(h*.385)+'" width="'+Math.round(w*.26)+'" height="'+Math.round(h*.145)+'" rx="'+Math.round(h*.035)+'" fill="#FFD51B"/>'+
    '<text x="'+(x+Math.round(w*.13))+'" y="'+Math.round(h*.485)+'" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(h*(opts.couponText?.length>14?.065:.082))+'" font-weight="950" fill="#08285A">'+escapeXml(campaignMain)+'</text>'+
    '<text x="'+x+'" y="'+Math.round(h*.610)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(h*.039)+'" font-weight="700" fill="#ffffff">'+escapeXml(opts.subtitle)+'</text>'+
    (opts.showPrice?'<text x="'+x+'" y="'+Math.round(h*.725)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(h*.080)+'" font-weight="950" fill="#FFD51B">'+escapeXml(money(opts.cashPrice))+'</text>':'')+
    pillSvg({x,y:bottomY,w:pillW,h:pillH,fill:'#071D49',text:opts.installmentCount+'x no cartão',textFill:'#ffffff',fs:Math.round(h*.030),icon:'▣'})+
    pillSvg({x:x+pillW+gap,y:bottomY,w:pillW,h:pillH,fill:'#FFD51B',text:opts.promoText,textFill:'#08285A',fs:Math.round(h*.027),icon:'◷'})+
    pillSvg({x:x+pillW*2+gap*2,y:bottomY,w:Math.round(w*.135),h:pillH,fill:'#ffffff',text:opts.cta,textFill:'#0047AB',fs:Math.round(h*.030)})+
    '</svg>'
  );
}

function overlayDesktop(format, opts) {
  if (opts.template === 'premium') return premiumDesktopOverlay(format, opts);
  if (opts.template === 'campaign') return campaignDesktopOverlay(format, opts);
  return marketplaceDesktopOverlay(format, opts);
}

function marketplaceMobileOverlay(format, opts) {
  const w=format.width,h=format.height,c=Math.round(w/2);
  const headlineFs=Math.round(w*(opts.headline.length>27?.050:.058));
  const headlineLines=wrap(opts.headline,21,2);
  const bottomY=Math.round(h*.845),pillH=Math.round(h*.060),gap=Math.round(w*.012);
  const pillW=Math.round(w*.28);
  let middle='';
  if(opts.showPrice){
    middle='<text x="'+c+'" y="'+Math.round(h*.755)+'" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(w*.025)+'" font-weight="900" fill="#ffffff">À VISTA NO PIX</text>'+
      '<text x="'+c+'" y="'+Math.round(h*.815)+'" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(w*.070)+'" font-weight="950" fill="#FFD51B">'+escapeXml(money(opts.cashPrice))+'</text>';
  } else {
    middle=linesSvg(wrap(opts.benefit,34,2),{x:c,y:Math.round(h*.755),size:Math.round(w*.030),lineHeight:Math.round(w*.038),fill:'#ffffff',weight:700,anchor:'middle'});
  }
  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'">'+
    '<rect x="'+Math.round(w*.34)+'" y="'+Math.round(h*.100)+'" width="'+Math.round(w*.32)+'" height="'+Math.round(h*.045)+'" rx="'+Math.round(h*.022)+'" fill="#FFD51B"/>'+
    '<text x="'+c+'" y="'+Math.round(h*.131)+'" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(w*.025)+'" font-weight="950" fill="#06306A">'+escapeXml(opts.badge)+'</text>'+
    linesSvg(headlineLines,{x:c,y:Math.round(h*.190),size:headlineFs,lineHeight:headlineFs*1.03,fill:'#ffffff',weight:950,anchor:'middle'})+
    '<text x="'+c+'" y="'+Math.round(h*.295)+'" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(w*.029)+'" font-weight="650" fill="#ffffff" opacity=".92">'+escapeXml(opts.subtitle)+'</text>'+
    middle+
    pillSvg({x:Math.round(w*.06),y:bottomY,w:pillW,h:pillH,fill:'#071D49',text:opts.installmentCount+'x cartão',textFill:'#ffffff',fs:Math.round(w*.022),icon:'▣'})+
    pillSvg({x:Math.round(w*.06)+pillW+gap,y:bottomY,w:pillW,h:pillH,fill:'#FFD51B',text:'TEMPO LIMITADO',textFill:'#08285A',fs:Math.round(w*.020),icon:'◷'})+
    pillSvg({x:Math.round(w*.06)+(pillW+gap)*2,y:bottomY,w:Math.round(w*.26),h:pillH,fill:'#ffffff',text:opts.cta,textFill:'#0047AB',fs:Math.round(w*.021)})+
    '</svg>'
  );
}

function premiumMobileOverlay(format, opts) {
  const w=format.width,h=format.height,c=Math.round(w/2);
  const lines=wrap(opts.headline,22,2);
  const brand=opts.brandLabel ? opts.brandLabel+' • ' : '';
  let lower='';
  if(opts.showPrice){
    lower='<text x="'+c+'" y="'+Math.round(h*.790)+'" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(w*.026)+'" font-weight="800" fill="#F0CA6A">NO PIX</text>'+
      '<text x="'+c+'" y="'+Math.round(h*.850)+'" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(w*.066)+'" font-weight="950" fill="#F0CA6A">'+escapeXml(money(opts.cashPrice))+'</text>';
  } else {
    lower=linesSvg(wrap(opts.benefit,34,2),{x:c,y:Math.round(h*.785),size:Math.round(w*.030),lineHeight:Math.round(w*.038),fill:'#ffffff',weight:650,anchor:'middle'});
  }
  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'">'+
    '<text x="'+c+'" y="'+Math.round(h*.135)+'" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(w*.024)+'" font-weight="900" letter-spacing="2" fill="#F0CA6A">'+escapeXml(brand+'SELEÇÃO ESPECIAL')+'</text>'+
    linesSvg(lines,{x:c,y:Math.round(h*.205),size:Math.round(w*.052),lineHeight:Math.round(w*.057),fill:'#ffffff',weight:900,anchor:'middle'})+
    '<text x="'+c+'" y="'+Math.round(h*.315)+'" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(w*.028)+'" font-weight="650" fill="#ffffff" opacity=".88">'+escapeXml(opts.subtitle)+'</text>'+
    lower+
    '<rect x="'+Math.round(w*.22)+'" y="'+Math.round(h*.900)+'" width="'+Math.round(w*.56)+'" height="'+Math.round(h*.060)+'" rx="'+Math.round(h*.030)+'" fill="#F0CA6A"/>'+
    '<text x="'+c+'" y="'+Math.round(h*.940)+'" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(w*.025)+'" font-weight="950" fill="#071B3B">'+escapeXml(opts.cta)+'</text>'+
    '</svg>'
  );
}

function campaignMobileOverlay(format, opts) {
  const w=format.width,h=format.height,c=Math.round(w/2);
  const brand=opts.brandLabel || 'ARIANA';
  const special='ESPECIAL '+brand;
  const main=opts.couponText || opts.headline;
  const top=opts.couponText ? 'USE O CUPOM' : 'CAMPANHA ESPECIAL';
  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'">'+
    '<text x="'+c+'" y="'+Math.round(h*.135)+'" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(w*.030)+'" font-weight="900" letter-spacing="3" fill="#ffffff">'+escapeXml(special)+'</text>'+
    '<text x="'+c+'" y="'+Math.round(h*.195)+'" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(w*.044)+'" font-weight="950" fill="#ffffff">'+escapeXml(top)+'</text>'+
    '<rect x="'+Math.round(w*.22)+'" y="'+Math.round(h*.215)+'" width="'+Math.round(w*.56)+'" height="'+Math.round(h*.078)+'" rx="'+Math.round(h*.039)+'" fill="#FFD51B"/>'+
    '<text x="'+c+'" y="'+Math.round(h*.268)+'" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(w*(main.length>16?.037:.047))+'" font-weight="950" fill="#08285A">'+escapeXml(main)+'</text>'+
    '<text x="'+c+'" y="'+Math.round(h*.330)+'" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(w*.027)+'" font-weight="650" fill="#ffffff">'+escapeXml(opts.subtitle)+'</text>'+
    pillSvg({x:Math.round(w*.08),y:Math.round(h*.855),w:Math.round(w*.26),h:Math.round(h*.060),fill:'#071D49',text:opts.installmentCount+'x cartão',textFill:'#ffffff',fs:Math.round(w*.020),icon:'▣'})+
    pillSvg({x:Math.round(w*.37),y:Math.round(h*.855),w:Math.round(w*.26),h:Math.round(h*.060),fill:'#FFD51B',text:'TEMPO LIMITADO',textFill:'#08285A',fs:Math.round(w*.019),icon:'◷'})+
    pillSvg({x:Math.round(w*.66),y:Math.round(h*.855),w:Math.round(w*.26),h:Math.round(h*.060),fill:'#ffffff',text:opts.cta,textFill:'#0047AB',fs:Math.round(w*.020)})+
    '</svg>'
  );
}

function overlayMobile(format, opts) {
  if (opts.template === 'premium') return premiumMobileOverlay(format, opts);
  if (opts.template === 'campaign') return campaignMobileOverlay(format, opts);
  return marketplaceMobileOverlay(format, opts);
}

async function productComposite(asset, format, comp) {
  const box = {
    x: Math.round(format.width * comp.product.x),
    y: Math.round(format.height * comp.product.y),
    w: Math.round(format.width * comp.product.w),
    h: Math.round(format.height * comp.product.h)
  };

  const product = await sharp(asset.buffer)
    .resize(Math.max(80, box.w), Math.max(80, box.h), {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 0 },
      withoutEnlargement: false
    })
    .png()
    .toBuffer();

  const meta = await sharp(product).metadata();
  const pw = meta.width || box.w;
  const ph = meta.height || box.h;
  const left = Math.round(box.x + (box.w - pw)/2);
  const top = Math.round(box.y + (box.h - ph)/2);

  const shadow = await sharp(product)
    .blur(Math.max(5, Math.round(Math.min(format.width, format.height) * .014)))
    .tint('#00142F')
    .modulate({ brightness: .35, saturation: .3 })
    .png()
    .toBuffer();

  return {
    product,
    shadow,
    productLeft: left,
    productTop: top,
    shadowLeft: left + Math.round(format.width*.008),
    shadowTop: top + Math.round(format.height*.018)
  };
}

function fallbackPanelSvg(format, comp, template) {
  const x = Math.round(format.width * comp.product.x);
  const y = Math.round(format.height * comp.product.y);
  const w = Math.round(format.width * comp.product.w);
  const h = Math.round(format.height * comp.product.h);
  const fill = template === 'premium' ? '#FFFFFF' : '#F8FBFF';
  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + format.width + '" height="' + format.height + '">' +
    '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + Math.round(Math.min(w,h)*.06) + '" fill="' + fill + '" opacity=".96"/>' +
    '<rect x="' + (x+2) + '" y="' + (y+2) + '" width="' + (w-4) + '" height="' + (h-4) + '" rx="' + Math.max(8,Math.round(Math.min(w,h)*.06)-2) + '" fill="none" stroke="#ffffff" stroke-opacity=".55" stroke-width="3"/>' +
    '</svg>'
  );
}

function quality(asset, opts, format) {
  const checks = [
    {
      id: 'background',
      ok: asset.backgroundRemoved,
      label: asset.backgroundRemoved ? 'Fundo do produto tratado' : 'Fundo do produto precisa de atenção',
      detail: asset.backgroundRemoved ? asset.removalMode : 'A imagem será apresentada em um painel para evitar recorte ruim.'
    },
    {
      id: 'resolution',
      ok: Math.max(asset.sourceWidth, asset.sourceHeight) >= 700,
      label: Math.max(asset.sourceWidth, asset.sourceHeight) >= 700 ? 'Resolução adequada' : 'Imagem de origem pequena',
      detail: asset.sourceWidth + '×' + asset.sourceHeight + ' px'
    },
    {
      id: 'pricing',
      ok: !opts.showPrice || opts.cashPrice > 0,
      label: opts.showPrice ? 'Preço preenchido' : 'Layout sem preço ativado',
      detail: opts.showPrice ? money(opts.cashPrice) : 'Preço não é obrigatório neste modo.'
    },
    {
      id: 'format',
      ok: true,
      label: 'Composição própria para ' + (format.device === 'mobile' ? 'celular' : 'desktop'),
      detail: format.width + '×' + format.height
    }
  ];

  const score = Math.round(checks.filter(item => item.ok).length / checks.length * 100);
  return { score, checks };
}

export async function prepareProProductAsset(product = {}, options = {}) {
  const source = productImage(product, options);
  if (!source) throw new Error('product_image_required');
  const raw = await loadImage(source);
  if (!raw) throw new Error('product_image_unavailable');
  return removeConnectedBackground(raw, options.removeBackground !== false && options.removeLightBackground !== false);
}

export async function analyzeCreativeBannerPro(product = {}, options = {}) {
  const opts = normalizedOptions(product, options);
  const asset = await prepareProProductAsset(product, opts);
  const comp = composition(opts.format, asset, opts);
  return {
    ok: true,
    format: opts.format,
    template: opts.template,
    showPrice: opts.showPrice,
    product: {
      sourceWidth: asset.sourceWidth,
      sourceHeight: asset.sourceHeight,
      width: asset.width,
      height: asset.height,
      orientation: comp.orientation,
      backgroundRemoved: asset.backgroundRemoved,
      removalMode: asset.removalMode,
      removedRatio: Number(asset.removedRatio.toFixed(4)),
      backgroundConfidence: Number(asset.confidence.toFixed(3))
    },
    quality: quality(asset, opts, opts.format)
  };
}

export async function generateCreativeBannerPro(product = {}, options = {}) {
  const opts = normalizedOptions(product, options);
  const format = opts.format;
  const asset = await prepareProProductAsset(product, opts);
  const comp = composition(format, asset, opts);
  const productLayer = await productComposite(asset, format, comp);

  const layers = [
    { input: backgroundSvg(format, opts.template), left: 0, top: 0 }
  ];

  const logo = await logoLayer(format);
  if (logo) layers.push(logo);

  if (!asset.backgroundRemoved) {
    layers.push({ input: fallbackPanelSvg(format, comp, opts.template), left: 0, top: 0 });
  } else {
    layers.push({
      input: productLayer.shadow,
      left: productLayer.shadowLeft,
      top: productLayer.shadowTop,
      blend: 'over'
    });
  }

  layers.push({
    input: productLayer.product,
    left: productLayer.productLeft,
    top: productLayer.productTop,
    blend: 'over'
  });

  layers.push({
    input: format.device === 'mobile' ? overlayMobile(format, opts) : overlayDesktop(format, opts),
    left: 0,
    top: 0
  });

  const buffer = await sharp({
    create: {
      width: format.width,
      height: format.height,
      channels: 4,
      background: { r: 0, g: 71, b: 171, alpha: 1 }
    }
  })
    .composite(layers)
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();

  return {
    buffer,
    meta: {
      format,
      template: opts.template,
      showPrice: opts.showPrice,
      product: {
        sourceWidth: asset.sourceWidth,
        sourceHeight: asset.sourceHeight,
        width: asset.width,
        height: asset.height,
        orientation: comp.orientation,
        backgroundRemoved: asset.backgroundRemoved,
        removalMode: asset.removalMode,
        removedRatio: Number(asset.removedRatio.toFixed(4)),
        backgroundConfidence: Number(asset.confidence.toFixed(3))
      },
      quality: quality(asset, opts, format)
    }
  };
}
