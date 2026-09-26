import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PRO_BANNER_FORMATS = Object.freeze({
  hero_desktop: Object.freeze({ width: 1920, height: 480, label: 'Hero Desktop', device: 'desktop' }),
  hero_mobile: Object.freeze({ width: 1080, height: 875, label: 'Hero Mobile Varejo', device: 'mobile' }),
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
  const configured = String(process.env.ARIANA_LOGO_PATH || process.env.POSTER_LOGO_PATH || '').trim();
  const candidates = [
    configured,
    path.resolve(__dirname, '../public/imagens/logo.png'),
    path.resolve(__dirname, '../public/imagens/logo-original-3d.png')
  ].filter(Boolean);
  return candidates.find(file => fs.existsSync(file)) || '';
}

async function logoLayer(format, options = {}) {
  const file = logoPath();
  if (!file) return null;
  const mobile = format.device === 'mobile';
  const campaign = Boolean(options.brandCampaign);
  const width = mobile
    ? Math.round(format.width * .22)
    : Math.round(format.height * (campaign ? .34 : .40));
  const height = mobile
    ? Math.round(format.height * .062)
    : Math.round(format.height * (campaign ? .085 : .105));
  const buffer = await sharp(file)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 5 })
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
      : campaign
        ? Math.round(format.width * .82)
        : Math.round(format.width * .055),
    top: mobile
      ? Math.round(format.height * .022)
      : Math.round(format.height * (campaign ? .035 : .025))
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
    if (data[i * channels + 3] < 40) transparentPixels += 1;
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

  function flood(tolerance, pureWhiteGuard = false) {
    const tolerance2 = tolerance * tolerance;
    const visited = new Uint8Array(total);
    const queue = new Int32Array(total);
    let head = 0;
    let tail = 0;

    function matches(index) {
      const p = index * channels;
      const alpha = data[p + 3];
      if (alpha < 24) return true;

      const r = data[p];
      const g = data[p + 1];
      const b = data[p + 2];
      const dr = r - bg.r;
      const dg = g - bg.g;
      const db = b - bg.b;
      const dist2 = dr * dr + dg * dg + db * db;
      const brightness = (r + g + b) / 3;
      const chroma = Math.max(r,g,b) - Math.min(r,g,b);

      if (pureWhiteGuard && lightEdge) {
        return brightness >= 242 && chroma <= 18 && dist2 < tolerance2 * 1.15;
      }

      if (lightEdge && brightness >= 232 && chroma <= 30 && dist2 < tolerance2 * 1.22) return true;
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

    return { visited, removedRatio: tail / Math.max(1, total) };
  }

  const baseTolerance = lightEdge
    ? 58
    : clamp(40 + Math.sqrt(Math.max(0, bg.variance)) * 0.40, 38, 62);

  const attempts = lightEdge
    ? [
        { tolerance: baseTolerance, pureWhiteGuard: false, label: 'connected_light_background' },
        { tolerance: 42, pureWhiteGuard: false, label: 'connected_light_background_gentle' },
        { tolerance: 30, pureWhiteGuard: true, label: 'connected_white_background_precise' },
        { tolerance: 22, pureWhiteGuard: true, label: 'connected_white_background_precise' },
        { tolerance: 15, pureWhiteGuard: true, label: 'connected_white_background_precise' }
      ]
    : [
        { tolerance: baseTolerance, pureWhiteGuard: false, label: 'connected_uniform_background' },
        { tolerance: Math.max(24, baseTolerance * .70), pureWhiteGuard: false, label: 'connected_uniform_background_gentle' }
      ];

  let chosen = null;
  let lastAttempt = null;
  for (const attempt of attempts) {
    const result = flood(attempt.tolerance, attempt.pureWhiteGuard);
    lastAttempt = { ...attempt, ...result };
    if (result.removedRatio >= 0.015 && result.removedRatio <= 0.92) {
      chosen = { ...attempt, ...result };
      break;
    }
  }

  if (!chosen) {
    const original = await source.png().toBuffer();
    const meta = await sharp(original).metadata();
    const ratio = Number(lastAttempt?.removedRatio || 0);
    return {
      buffer: original,
      sourceWidth: sourceMeta.width || width,
      sourceHeight: sourceMeta.height || height,
      width: meta.width || width,
      height: meta.height || height,
      backgroundRemoved: false,
      removalMode: ratio > 0.92 ? 'unsafe_overremove_blocked' : 'no_background_detected',
      removedRatio: ratio,
      confidence: ratio > 0.92 ? 0 : 0.30
    };
  }

  // Produto branco sobre fundo branco pode ter grandes áreas internas com
  // praticamente a mesma cor do fundo. Antes de zerar o alpha, verificamos se
  // o foreground remanescente é predominantemente claro. Nesse caso,
  // recuperamos somente pixels removidos que estejam cercados pela silhueta
  // tanto na horizontal quanto na vertical. Isso preserva a frente de
  // geladeiras/freezers sem transformar a foto inteira em um retângulo.
  const restore = new Uint8Array(total);
  if (lightEdge && chosen.removedRatio > 0.48) {
    let retained = 0;
    let retainedLight = 0;

    for (let i = 0; i < total; i += 1) {
      if (chosen.visited[i]) continue;
      const p = i * channels;
      if (data[p + 3] < 30) continue;
      retained += 1;
      const brightness = (data[p] + data[p + 1] + data[p + 2]) / 3;
      const chroma = Math.max(data[p], data[p + 1], data[p + 2]) - Math.min(data[p], data[p + 1], data[p + 2]);
      if (brightness >= 205 && chroma <= 55) retainedLight += 1;
    }

    const lightForegroundRatio = retainedLight / Math.max(1, retained);
    if (lightForegroundRatio >= 0.34) {
      const rowMin = new Int32Array(height);
      const rowMax = new Int32Array(height);
      const colMin = new Int32Array(width);
      const colMax = new Int32Array(width);
      rowMin.fill(width);
      rowMax.fill(-1);
      colMin.fill(height);
      colMax.fill(-1);

      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const i = y * width + x;
          if (chosen.visited[i]) continue;
          const p = i * channels;
          if (data[p + 3] < 30) continue;
          rowMin[y] = Math.min(rowMin[y], x);
          rowMax[y] = Math.max(rowMax[y], x);
          colMin[x] = Math.min(colMin[x], y);
          colMax[x] = Math.max(colMax[x], y);
        }
      }

      const rowPad = Math.max(2, Math.round(width * .004));
      const colPad = Math.max(2, Math.round(height * .004));
      for (let y = 0; y < height; y += 1) {
        if (rowMax[y] - rowMin[y] < Math.round(width * .12)) continue;
        for (let x = rowMin[y] + rowPad; x <= rowMax[y] - rowPad; x += 1) {
          const i = y * width + x;
          if (!chosen.visited[i]) continue;
          if (colMax[x] - colMin[x] < Math.round(height * .12)) continue;
          if (y > colMin[x] + colPad && y < colMax[x] - colPad) {
            restore[i] = 1;
          }
        }
      }
    }
  }

  const out = Buffer.from(data);
  for (let i = 0; i < total; i += 1) {
    if (chosen.visited[i] && !restore[i]) out[i * channels + 3] = 0;
  }

  for (let i = 0; i < total; i += 1) {
    if ((chosen.visited[i] && !restore[i])) continue;
    const x = i % width;
    const y = Math.floor(i / width);
    const removed = (idx) => idx >= 0 && idx < total && chosen.visited[idx] && !restore[idx];
    const touchesRemoved =
      (x > 0 && removed(i - 1)) ||
      (x + 1 < width && removed(i + 1)) ||
      (y > 0 && removed(i - width)) ||
      (y + 1 < height && removed(i + width));

    if (touchesRemoved) {
      const alphaIndex = i * channels + 3;
      out[alphaIndex] = Math.min(out[alphaIndex], 220);
    }
  }

  const png = await sharp(out, { raw: info }).png().toBuffer();
  const trimmed = await sharp(png)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
    .png()
    .toBuffer();
  const meta = await sharp(trimmed).metadata();

  const confidence = clamp(
    (uniformEdge ? 0.40 : 0.18) +
    (lightEdge ? 0.25 : 0.12) +
    Math.min(0.25, chosen.removedRatio * .35) +
    (chosen.pureWhiteGuard ? 0.06 : 0),
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
    removalMode: chosen.label,
    removedRatio: chosen.removedRatio,
    confidence
  };
}

function campaignProducts(product = {}, options = {}) {
  const requested = Array.isArray(options.products) ? options.products : [];
  const rows = [product, ...requested]
    .filter(item => item && typeof item === 'object')
    .filter(item => productImage(item, item).trim());

  const seen = new Set();
  const unique = [];
  for (const item of rows) {
    const key = String(
      item.id ||
      item._id ||
      productImage(item, item) ||
      item.name ||
      item.title ||
      unique.length
    ).trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
    if (unique.length >= 4) break;
  }
  return unique.length ? unique : [product];
}

function normalizedOptions(product = {}, options = {}) {
  const products = campaignProducts(product, options);
  const primary = products[0] || product;
  const cashPrice = number(options.cashPrice ?? primary.cashPrice ?? primary.pixPrice ?? primary.price);
  const fullPrice = number(options.fullPrice ?? primary.fullPrice ?? primary.price, cashPrice);
  const installmentCount = Math.max(1, Math.round(number(options.installmentCount ?? primary.installmentCount, 12)));
  const installmentPrice = number(options.installmentPrice ?? primary.installmentPrice, fullPrice > 0 ? fullPrice / installmentCount : 0);
  const contentMode = clean(options.contentMode || 'with_price', 30).toLowerCase();
  const priceBlocked = ['no_price', 'institutional'].includes(contentMode);
  const requestedPrice = options.showPrice !== false && !priceBlocked;
  const showPrice = requestedPrice && cashPrice > 0;
  const template = resolveProTemplate(options.templatePro || options.template);
  const format = resolveProFormat(options.outputFormat || options.format);
  const productName = clean(options.productName || primary.name || primary.title || 'Produto Ariana Móveis', 110);
  const brandName = clean(
    options.brandName ||
    primary.brand ||
    products.find(item => item?.brand)?.brand ||
    '',
    64
  ).toUpperCase();
  const brandLogoUrl = clean(options.brandLogoUrl || '', 500);
  const brandCampaign = contentMode === 'brand_campaign' || products.length > 1;
  const headline = clean(
    options.headline ||
    (brandCampaign
      ? (brandName ? 'ESPECIAL ' + brandName : 'CAMPANHA ESPECIAL')
      : (showPrice ? 'OFERTA IMPERDÍVEL' : 'DESTAQUE ARIANA')),
    76
  ).toUpperCase();
  const subtitle = clean(options.subtitle || defaultBenefit(primary), 120);
  const benefit = clean(options.benefit || defaultBenefit(primary), 150);
  const cta = clean(options.cta || (showPrice ? 'APROVEITE AGORA' : 'CONFIRA NO SITE'), 42).toUpperCase();
  const badge = clean(options.badge || (
    template === 'premium' ? 'SELEÇÃO ARIANA' :
    brandCampaign ? 'ESPECIAL DE MARCA' :
    template === 'campaign' ? 'CAMPANHA ESPECIAL' :
    'OFERTA ARIANA'
  ), 42).toUpperCase();
  const promoCode = clean(options.promoCode || '', 32).toUpperCase();
  const benefitOne = clean(
    options.benefitOne ||
    (showPrice
      ? installmentCount + 'X NO CARTÃO'
      : 'CONDIÇÕES ESPECIAIS'),
    44
  ).toUpperCase();
  const benefitTwo = clean(options.benefitTwo || 'OFERTA POR TEMPO LIMITADO', 44).toUpperCase();

  return {
    products,
    format,
    template,
    contentMode,
    brandCampaign,
    brandName,
    brandLogoUrl,
    promoCode,
    benefitOne,
    benefitTwo,
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
    siteLabel: clean(options.siteLabel || 'arianamoveis.com.br', 45),
    removeBackground: options.removeBackground !== false && options.removeLightBackground !== false
  };
}

function assetOrientation(asset = {}) {
  const aspect = Number(asset.width || 1) / Math.max(1, Number(asset.height || 1));
  return aspect < 0.72 ? 'vertical' : aspect > 1.35 ? 'horizontal' : 'balanced';
}

function singleComposition(format, asset, opts) {
  const mobile = format.device === 'mobile';
  const orientation = assetOrientation(asset);

  if (!mobile) {
    const productW = orientation === 'horizontal' ? 0.44 : orientation === 'vertical' ? 0.31 : 0.37;
    return {
      mobile,
      orientation,
      product: {
        x: 1 - productW - 0.045,
        y: orientation === 'vertical' ? 0.035 : 0.09,
        w: productW,
        h: orientation === 'vertical' ? 0.92 : 0.80
      }
    };
  }

  const productHeight = opts.showPrice
    ? (orientation === 'vertical' ? 0.37 : 0.30)
    : (orientation === 'vertical' ? 0.41 : 0.34);
  return {
    mobile,
    orientation,
    product: {
      x: orientation === 'horizontal' ? 0.08 : 0.15,
      y: opts.showPrice ? 0.36 : 0.34,
      w: orientation === 'horizontal' ? 0.84 : 0.70,
      h: productHeight
    }
  };
}

function clusterSlots(format, count = 1) {
  const mobile = format.device === 'mobile';
  const n = clamp(Math.round(count), 1, 4);

  if (!mobile) {
    if (n === 1) return [{ x: .49, y: .06, w: .25, h: .86 }];
    if (n === 2) return [
      { x: .42, y: .12, w: .19, h: .75 },
      { x: .56, y: .06, w: .22, h: .85 }
    ];
    if (n === 3) return [
      { x: .39, y: .17, w: .17, h: .68 },
      { x: .51, y: .06, w: .21, h: .86 },
      { x: .65, y: .17, w: .15, h: .67 }
    ];
    return [
      { x: .36, y: .19, w: .15, h: .64 },
      { x: .46, y: .10, w: .17, h: .76 },
      { x: .57, y: .06, w: .18, h: .82 },
      { x: .69, y: .20, w: .12, h: .62 }
    ];
  }

  if (n === 1) return [{ x: .27, y: .46, w: .46, h: .31 }];
  if (n === 2) return [
    { x: .16, y: .49, w: .36, h: .27 },
    { x: .49, y: .45, w: .37, h: .32 }
  ];
  if (n === 3) return [
    { x: .11, y: .50, w: .30, h: .25 },
    { x: .35, y: .45, w: .35, h: .31 },
    { x: .65, y: .50, w: .27, h: .25 }
  ];
  return [
    { x: .07, y: .51, w: .27, h: .24 },
    { x: .27, y: .46, w: .30, h: .29 },
    { x: .51, y: .44, w: .31, h: .31 },
    { x: .73, y: .51, w: .23, h: .23 }
  ];
}

function backgroundSvg(format, opts) {
  const w = format.width;
  const h = format.height;
  const template = opts.template;

  if (template === 'premium') {
    return Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' +
      '<defs>' +
      '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#06162F"/><stop offset=".52" stop-color="#0A2F68"/><stop offset="1" stop-color="#020814"/></linearGradient>' +
      '<radialGradient id="halo" cx="68%" cy="44%" r="48%"><stop offset="0" stop-color="#F6D477" stop-opacity=".28"/><stop offset=".55" stop-color="#D2A93D" stop-opacity=".07"/><stop offset="1" stop-color="#D2A93D" stop-opacity="0"/></radialGradient>' +
      '</defs>' +
      '<rect width="100%" height="100%" fill="url(#bg)"/><rect width="100%" height="100%" fill="url(#halo)"/>' +
      '<path d="M-' + Math.round(w*.05) + ' ' + Math.round(h*.80) + ' C' + Math.round(w*.17) + ' ' + Math.round(h*.45) + ',' + Math.round(w*.27) + ' ' + Math.round(h*1.05) + ',' + Math.round(w*.49) + ' ' + Math.round(h*.74) + ' S' + Math.round(w*.78) + ' ' + Math.round(h*.55) + ',' + Math.round(w*1.05) + ' ' + Math.round(h*.78) + '" fill="none" stroke="#EFC75E" stroke-opacity=".13" stroke-width="' + Math.max(14,Math.round(h*.08)) + '"/>' +
      '<circle cx="' + Math.round(w*.72) + '" cy="' + Math.round(h*.43) + '" r="' + Math.round(h*.34) + '" fill="none" stroke="#F0CA6A" stroke-opacity=".15" stroke-width="' + Math.max(2,Math.round(h*.007)) + '"/>' +
      '<circle cx="' + Math.round(w*.72) + '" cy="' + Math.round(h*.43) + '" r="' + Math.round(h*.25) + '" fill="none" stroke="#F0CA6A" stroke-opacity=".08" stroke-width="' + Math.max(2,Math.round(h*.005)) + '"/>' +
      '</svg>'
    );
  }

  if (template === 'campaign') {
    return Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' +
      '<defs>' +
      '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#075DD8"/><stop offset=".52" stop-color="#0046AE"/><stop offset="1" stop-color="#061B4B"/></linearGradient>' +
      '<radialGradient id="shine" cx="63%" cy="43%" r="42%"><stop offset="0" stop-color="#ffffff" stop-opacity=".24"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>' +
      '</defs>' +
      '<rect width="100%" height="100%" fill="url(#bg)"/><rect width="100%" height="100%" fill="url(#shine)"/>' +
      '<ellipse cx="' + Math.round(w*.70) + '" cy="' + Math.round(h*.48) + '" rx="' + Math.round(w*.22) + '" ry="' + Math.round(h*.45) + '" fill="#FFD51B" opacity=".96"/>' +
      '<ellipse cx="' + Math.round(w*.67) + '" cy="' + Math.round(h*.48) + '" rx="' + Math.round(w*.19) + '" ry="' + Math.round(h*.39) + '" fill="#0D58C4" opacity=".80"/>' +
      '<path d="M-' + Math.round(w*.08) + ' ' + Math.round(h*.68) + ' C' + Math.round(w*.14) + ' ' + Math.round(h*.18) + ',' + Math.round(w*.26) + ' ' + Math.round(h*.22) + ',' + Math.round(w*.35) + ' ' + Math.round(h*.02) + ' L' + Math.round(w*.43) + ' 0 C' + Math.round(w*.34) + ' ' + Math.round(h*.39) + ',' + Math.round(w*.22) + ' ' + Math.round(h*.55) + ',' + Math.round(w*.02) + ' ' + h + ' Z" fill="#02194F" opacity=".92"/>' +
      '<g fill="#ffffff" opacity=".13">' +
      Array.from({length:12},(_,i)=>'<circle cx="' + Math.round(w*(.035+i*.033)) + '" cy="' + Math.round(h*.11) + '" r="' + Math.max(2,Math.round(h*.009)) + '"/>').join('') +
      '</g></svg>'
    );
  }

  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' +
    '<defs>' +
    '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0A65EE"/><stop offset=".50" stop-color="#0047AB"/><stop offset="1" stop-color="#061E52"/></linearGradient>' +
    '<radialGradient id="glow" cx="69%" cy="46%" r="48%"><stop offset="0" stop-color="#ffffff" stop-opacity=".26"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>' +
    '</defs>' +
    '<rect width="100%" height="100%" fill="url(#bg)"/><rect width="100%" height="100%" fill="url(#glow)"/>' +
    '<path d="M-' + Math.round(w*.06) + ' 0 H' + Math.round(w*.29) + ' C' + Math.round(w*.19) + ' ' + Math.round(h*.28) + ',' + Math.round(w*.24) + ' ' + Math.round(h*.58) + ',' + Math.round(w*.08) + ' ' + h + ' H0 Z" fill="#031A55" opacity=".78"/>' +
    '<ellipse cx="' + Math.round(w*.70) + '" cy="' + Math.round(h*.47) + '" rx="' + Math.round(w*.20) + '" ry="' + Math.round(h*.39) + '" fill="#FFD51B" opacity=".95"/>' +
    '<ellipse cx="' + Math.round(w*.67) + '" cy="' + Math.round(h*.47) + '" rx="' + Math.round(w*.17) + '" ry="' + Math.round(h*.34) + '" fill="#0A53C1" opacity=".88"/>' +
    '<circle cx="' + Math.round(w*.94) + '" cy="' + Math.round(h*.06) + '" r="' + Math.round(h*.20) + '" fill="#ffffff" opacity=".06"/>' +
    '</svg>'
  );
}

function pillIconSvg(icon, x, y, size, color) {
  const sw = Math.max(2, Math.round(size * .10));
  const cx = x + size/2;
  const cy = y + size/2;

  if (icon === 'card') {
    return (
      '<g fill="none" stroke="' + color + '" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="' + x + '" y="' + (y+size*.12) + '" width="' + size + '" height="' + (size*.76) + '" rx="' + (size*.14) + '"/>' +
      '<path d="M' + (x+size*.12) + ' ' + (y+size*.38) + ' H' + (x+size*.88) + '"/>' +
      '<path d="M' + (x+size*.18) + ' ' + (y+size*.62) + ' H' + (x+size*.42) + '"/>' +
      '</g>'
    );
  }

  if (icon === 'clock') {
    return (
      '<g fill="none" stroke="' + color + '" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round">' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + (size*.40) + '"/>' +
      '<path d="M' + cx + ' ' + (cy-size*.23) + ' V' + cy + ' L' + (cx+size*.20) + ' ' + (cy+size*.10) + '"/>' +
      '<path d="M' + (cx-size*.16) + ' ' + (y+size*.04) + ' H' + (cx+size*.16) + '"/>' +
      '</g>'
    );
  }

  if (icon === 'arrow') {
    return (
      '<g fill="none" stroke="' + color + '" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M' + (x+size*.22) + ' ' + cy + ' H' + (x+size*.78) + '"/>' +
      '<path d="M' + (x+size*.58) + ' ' + (cy-size*.20) + ' L' + (x+size*.80) + ' ' + cy + ' L' + (x+size*.58) + ' ' + (cy+size*.20) + '"/>' +
      '</g>'
    );
  }

  return '';
}

function pillSvg({ x, y, w, h, fill, text, textFill, fontSize, subtext = '', icon = '' }) {
  const safeText = escapeXml(text);
  const safeSub = escapeXml(subtext);
  const cx = x + w/2;
  const mainY = subtext ? y + h*.48 : y + h*.62;
  const subY = y + h*.72;
  const iconSize = Math.round(h*.34);
  const iconX = x + h*.25;
  const iconY = y + (h-iconSize)/2;
  const iconMarkup = icon ? pillIconSvg(icon,iconX,iconY,iconSize,textFill) : '';
  const textX = icon ? cx + h*.08 : cx;
  return (
    '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + Math.round(h*.50) + '" fill="' + fill + '"/>' +
    iconMarkup +
    '<text x="' + textX + '" y="' + mainY + '" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="' + fontSize + '" font-weight="900" fill="' + textFill + '">' + safeText + '</text>' +
    (subtext
      ? '<text x="' + textX + '" y="' + subY + '" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="' + Math.round(fontSize*.52) + '" font-weight="700" fill="' + textFill + '" opacity=".90">' + safeSub + '</text>'
      : '')
  );
}

function brandFallbackSvg(format, opts) {
  if (!opts.brandName || opts.brandLogoUrl) return '';
  const mobile = format.device === 'mobile';
  const x = mobile ? format.width/2 : Math.round(format.width*.055);
  const y = mobile ? Math.round(format.height*.145) : Math.round(format.height*.29);
  const anchor = mobile ? 'middle' : 'start';
  const fs = mobile ? Math.round(format.width*.047) : Math.round(format.height*.115);
  return '<text x="' + x + '" y="' + y + '" text-anchor="' + anchor + '" font-family="Arial Black,Arial,sans-serif" font-size="' + fs + '" font-weight="950" fill="#ffffff">' + escapeXml(opts.brandName) + '</text>';
}

function overlayDesktopCampaign(format, opts) {
  const w = format.width;
  const h = format.height;
  const x = Math.round(w*.055);
  const textW = Math.round(w*.31);
  const accent = opts.template === 'premium' ? '#F0CA6A' : '#FFD51B';
  const dark = opts.template === 'premium' ? '#071B3B' : '#003B8F';
  const badgeFs = Math.round(h*.035);
  const headlineFs = Math.round(h*(opts.headline.length > 31 ? .083 : .100));
  const subtitleFs = Math.round(h*.040);
  const headlineTop = opts.brandName || opts.brandLogoUrl ? .42 : .27;
  const headlineLines = wrap(opts.headline, 21, 2);

  const railX = Math.round(w*.80);
  const railW = Math.round(w*.165);
  const pillH = Math.round(h*.115);
  const pillFs = Math.round(h*.033);

  let price = '';
  if (opts.showPrice) {
    price =
      '<text x="' + x + '" y="' + Math.round(h*.69) + '" font-family="Arial,Helvetica,sans-serif" font-size="' + Math.round(h*.030) + '" font-weight="850" fill="#ffffff" opacity=".88">À VISTA NO PIX</text>' +
      '<text x="' + x + '" y="' + Math.round(h*.82) + '" font-family="Arial,Helvetica,sans-serif" font-size="' + Math.round(h*.125) + '" font-weight="950" fill="' + accent + '">' + escapeXml(money(opts.cashPrice)) + '</text>';
  } else if (opts.promoCode) {
    price =
      '<text x="' + x + '" y="' + Math.round(h*.69) + '" font-family="Arial,Helvetica,sans-serif" font-size="' + Math.round(h*.041) + '" font-weight="900" fill="#ffffff">USE O CÓDIGO</text>' +
      '<rect x="' + x + '" y="' + Math.round(h*.72) + '" width="' + Math.round(textW*.78) + '" height="' + Math.round(h*.13) + '" rx="' + Math.round(h*.03) + '" fill="' + accent + '"/>' +
      '<text x="' + Math.round(x+textW*.39) + '" y="' + Math.round(h*.812) + '" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-size="' + Math.round(h*.063) + '" font-weight="950" fill="' + dark + '">' + escapeXml(opts.promoCode) + '</text>';
  }

  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' +
    brandFallbackSvg(format, opts) +
    '<rect x="' + x + '" y="' + Math.round(h*.095) + '" width="' + Math.round(Math.max(h*.30,opts.badge.length*badgeFs*.64)) + '" height="' + Math.round(h*.073) + '" rx="' + Math.round(h*.036) + '" fill="' + accent + '"/>' +
    '<text x="' + (x+Math.round(h*.035)) + '" y="' + Math.round(h*.145) + '" font-family="Arial,Helvetica,sans-serif" font-size="' + badgeFs + '" font-weight="950" fill="' + dark + '">' + escapeXml(opts.badge) + '</text>' +
    linesSvg(headlineLines,{x,y:Math.round(h*headlineTop),size:headlineFs,lineHeight:headlineFs*1.02,fill:'#ffffff',weight:950}) +
    '<text x="' + x + '" y="' + Math.round(h*(headlineTop + .20)) + '" font-family="Arial,Helvetica,sans-serif" font-size="' + subtitleFs + '" font-weight="650" fill="#ffffff" opacity=".94">' + escapeXml(opts.subtitle) + '</text>' +
    price +
    pillSvg({x:railX,y:Math.round(h*.22),w:railW,h:pillH,fill:'#07143F',text:opts.benefitOne,textFill:'#ffffff',fontSize:pillFs,icon:'card'}) +
    pillSvg({x:railX,y:Math.round(h*.43),w:railW,h:pillH,fill:accent,text:opts.benefitTwo,textFill:dark,fontSize:Math.round(pillFs*.82),icon:'clock'}) +
    pillSvg({x:railX,y:Math.round(h*.66),w:railW,h:pillH,fill:'#ffffff',text:opts.cta,textFill:'#0A3A82',fontSize:Math.round(pillFs*.90),icon:'arrow'}) +
    '<text x="' + Math.round(railX+railW/2) + '" y="' + Math.round(h*.92) + '" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="' + Math.round(h*.026) + '" font-weight="800" fill="#ffffff" opacity=".90">' + escapeXml(opts.siteLabel) + '</text>' +
    '</svg>'
  );
}

function overlayDesktopStandard(format, opts) {
  const w = format.width;
  const h = format.height;
  const x = Math.round(w*.055);
  const textW = Math.round(w*.44);
  const accent = opts.template === 'premium' ? '#F0CA6A' : '#FFD51B';
  const dark = opts.template === 'premium' ? '#071B3B' : '#003B8F';
  const headlineFs = Math.round(h*(opts.headline.length > 32 ? .090 : .108));
  const headlineLines = wrap(opts.headline, 30, 2);
  const subtitleFs = Math.round(h*.043);
  const nameFs = Math.round(h*.040);

  let commercial = '';
  if (opts.showPrice) {
    commercial =
      '<text x="' + x + '" y="' + Math.round(h*.66) + '" font-family="Arial,Helvetica,sans-serif" font-size="' + Math.round(h*.028) + '" font-weight="850" fill="#ffffff" opacity=".88">À VISTA NO PIX</text>' +
      '<text x="' + x + '" y="' + Math.round(h*.80) + '" font-family="Arial,Helvetica,sans-serif" font-size="' + Math.round(h*.130) + '" font-weight="950" fill="' + accent + '">' + escapeXml(money(opts.cashPrice)) + '</text>' +
      '<text x="' + x + '" y="' + Math.round(h*.88) + '" font-family="Arial,Helvetica,sans-serif" font-size="' + Math.round(h*.036) + '" font-weight="850" fill="#ffffff">ou ' + opts.installmentCount + 'x de ' + escapeXml(money(opts.installmentPrice)) + ' no cartão</text>';
  } else {
    commercial =
      '<rect x="' + x + '" y="' + Math.round(h*.66) + '" width="' + Math.round(textW*.90) + '" height="' + Math.round(h*.15) + '" rx="' + Math.round(h*.035) + '" fill="#ffffff" opacity=".10"/>' +
      linesSvg(wrap(opts.benefit,48,2),{x:x+Math.round(h*.035),y:Math.round(h*.72),size:Math.round(h*.037),lineHeight:Math.round(h*.048),fill:'#ffffff',weight:750});
  }

  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' +
    '<rect x="' + x + '" y="' + Math.round(h*.11) + '" width="' + Math.round(Math.max(h*.30,opts.badge.length*h*.026)) + '" height="' + Math.round(h*.075) + '" rx="' + Math.round(h*.038) + '" fill="' + accent + '"/>' +
    '<text x="' + (x+Math.round(h*.034)) + '" y="' + Math.round(h*.162) + '" font-family="Arial,Helvetica,sans-serif" font-size="' + Math.round(h*.034) + '" font-weight="950" fill="' + dark + '">' + escapeXml(opts.badge) + '</text>' +
    linesSvg(headlineLines,{x,y:Math.round(h*.29),size:headlineFs,lineHeight:headlineFs*1.02,fill:'#ffffff',weight:950}) +
    '<text x="' + x + '" y="' + Math.round(h*.47) + '" font-family="Arial,Helvetica,sans-serif" font-size="' + subtitleFs + '" font-weight="650" fill="#ffffff" opacity=".94">' + escapeXml(opts.subtitle) + '</text>' +
    linesSvg(wrap(opts.productName,34,2),{x,y:Math.round(h*.56),size:nameFs,lineHeight:nameFs*1.08,fill:'#ffffff',weight:800}) +
    commercial +
    '<rect x="' + Math.round(w*.77) + '" y="' + Math.round(h*.82) + '" width="' + Math.round(w*.17) + '" height="' + Math.round(h*.105) + '" rx="' + Math.round(h*.052) + '" fill="#ffffff"/>' +
    '<text x="' + Math.round(w*.855) + '" y="' + Math.round(h*.888) + '" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="' + Math.round(h*.032) + '" font-weight="950" fill="#0047AB">' + escapeXml(opts.cta) + '</text>' +
    '</svg>'
  );
}

function overlayMobileCampaign(format, opts) {
  const w = format.width;
  const h = format.height;
  const center = Math.round(w/2);
  const accent = opts.template === 'premium' ? '#F0CA6A' : '#FFD51B';
  const dark = opts.template === 'premium' ? '#071B3B' : '#003B8F';
  const headlineFs = Math.round(w*(opts.headline.length > 30 ? .050 : .058));
  const headlineLines = wrap(opts.headline, 24, 2);
  const pillY = Math.round(h*.855);
  const gap = Math.round(w*.018);
  const pillW = Math.round((w - Math.round(w*.10) - gap*2)/3);
  const pillH = Math.round(h*.083);

  let promo = '';
  if (opts.promoCode) {
    promo =
      '<text x="' + center + '" y="' + Math.round(h*.420) + '" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="' + Math.round(w*.023) + '" font-weight="850" fill="#ffffff">USE O CÓDIGO</text>' +
      '<rect x="' + Math.round(w*.33) + '" y="' + Math.round(h*.432) + '" width="' + Math.round(w*.34) + '" height="' + Math.round(h*.060) + '" rx="' + Math.round(h*.020) + '" fill="' + accent + '"/>' +
      '<text x="' + center + '" y="' + Math.round(h*.474) + '" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-size="' + Math.round(w*.031) + '" font-weight="950" fill="' + dark + '">' + escapeXml(opts.promoCode) + '</text>';
  } else {
    promo =
      '<text x="' + center + '" y="' + Math.round(h*.405) + '" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="' + Math.round(w*.026) + '" font-weight="650" fill="#ffffff" opacity=".94">' + escapeXml(opts.subtitle) + '</text>';
  }

  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' +
    brandFallbackSvg(format, opts) +
    '<rect x="' + Math.round(w*.32) + '" y="' + Math.round(h*.185) + '" width="' + Math.round(w*.36) + '" height="' + Math.round(h*.055) + '" rx="' + Math.round(h*.028) + '" fill="' + accent + '"/>' +
    '<text x="' + center + '" y="' + Math.round(h*.223) + '" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="' + Math.round(w*.024) + '" font-weight="950" fill="' + dark + '">' + escapeXml(opts.badge) + '</text>' +
    linesSvg(headlineLines,{x:center,y:Math.round(h*.295),size:headlineFs,lineHeight:headlineFs*1.02,fill:'#ffffff',weight:950,anchor:'middle'}) +
    promo +
    (opts.showPrice
      ? '<text x="' + center + '" y="' + Math.round(h*.745) + '" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="' + Math.round(w*.023) + '" font-weight="850" fill="#ffffff">À VISTA NO PIX</text>' +
        '<text x="' + center + '" y="' + Math.round(h*.805) + '" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="' + Math.round(w*.065) + '" font-weight="950" fill="' + accent + '">' + escapeXml(money(opts.cashPrice)) + '</text>'
      : '') +
    pillSvg({x:Math.round(w*.05),y:pillY,w:pillW,h:pillH,fill:'#07143F',text:opts.benefitOne,textFill:'#ffffff',fontSize:Math.round(w*.020),icon:'card'}) +
    pillSvg({x:Math.round(w*.05)+pillW+gap,y:pillY,w:pillW,h:pillH,fill:accent,text:opts.benefitTwo,textFill:dark,fontSize:Math.round(w*.018),icon:'clock'}) +
    pillSvg({x:Math.round(w*.05)+(pillW+gap)*2,y:pillY,w:pillW,h:pillH,fill:'#ffffff',text:opts.cta,textFill:'#0A3A82',fontSize:Math.round(w*.020),icon:'arrow'}) +
    '</svg>'
  );
}

function overlayMobileStandard(format, opts) {
  const w = format.width;
  const h = format.height;
  const center = Math.round(w/2);
  const accent = opts.template === 'premium' ? '#F0CA6A' : '#FFD51B';
  const dark = opts.template === 'premium' ? '#071B3B' : '#003B8F';
  const headlineFs = Math.round(w*(opts.headline.length>26?.048:.055));
  const headlineLines = wrap(opts.headline,21,2);
  const priceY = Math.round(h*.785);

  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' +
    '<rect x="' + Math.round(w*.33) + '" y="' + Math.round(h*.095) + '" width="' + Math.round(w*.34) + '" height="' + Math.round(h*.056) + '" rx="' + Math.round(h*.028) + '" fill="' + accent + '"/>' +
    '<text x="' + center + '" y="' + Math.round(h*.134) + '" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="' + Math.round(w*.024) + '" font-weight="950" fill="' + dark + '">' + escapeXml(opts.badge) + '</text>' +
    linesSvg(headlineLines,{x:center,y:Math.round(h*.205),size:headlineFs,lineHeight:headlineFs*1.02,fill:'#ffffff',weight:950,anchor:'middle'}) +
    '<text x="' + center + '" y="' + Math.round(h*.31) + '" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="' + Math.round(w*.027) + '" font-weight="650" fill="#ffffff" opacity=".94">' + escapeXml(opts.subtitle) + '</text>' +
    (opts.showPrice
      ? '<text x="' + center + '" y="' + (priceY-Math.round(w*.045)) + '" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="' + Math.round(w*.021) + '" font-weight="850" fill="#ffffff">À VISTA NO PIX</text>' +
        '<text x="' + center + '" y="' + priceY + '" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="' + Math.round(w*.064) + '" font-weight="950" fill="' + accent + '">' + escapeXml(money(opts.cashPrice)) + '</text>' +
        '<text x="' + center + '" y="' + Math.round(h*.833) + '" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="' + Math.round(w*.025) + '" font-weight="850" fill="#ffffff">ou ' + opts.installmentCount + 'x de ' + escapeXml(money(opts.installmentPrice)) + '</text>'
      : linesSvg(wrap(opts.benefit,38,2),{x:center,y:Math.round(h*.765),size:Math.round(w*.025),lineHeight:Math.round(w*.032),fill:'#ffffff',weight:750,anchor:'middle'})) +
    '<rect x="' + Math.round(w*.22) + '" y="' + Math.round(h*.887) + '" width="' + Math.round(w*.56) + '" height="' + Math.round(h*.072) + '" rx="' + Math.round(h*.036) + '" fill="#ffffff"/>' +
    '<text x="' + center + '" y="' + Math.round(h*.935) + '" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="' + Math.round(w*.024) + '" font-weight="950" fill="#0047AB">' + escapeXml(opts.cta) + ' • ' + escapeXml(opts.siteLabel) + '</text>' +
    '</svg>'
  );
}

async function productCompositeForBox(asset, format, box) {
  const px = Math.round(format.width*box.x);
  const py = Math.round(format.height*box.y);
  const pw = Math.max(70,Math.round(format.width*box.w));
  const ph = Math.max(70,Math.round(format.height*box.h));
  const product = await sharp(asset.buffer)
    .resize(pw,ph,{
      fit:'contain',
      background:{r:255,g:255,b:255,alpha:0},
      withoutEnlargement:false
    })
    .png()
    .toBuffer();
  const meta = await sharp(product).metadata();
  const w = Number(meta.width || pw);
  const h = Number(meta.height || ph);
  const left = Math.round(px+(pw-w)/2);
  const top = Math.round(py+(ph-h)/2);
  const shadow = await sharp(product)
    .blur(Math.max(4,Math.round(Math.min(format.width,format.height)*.012)))
    .tint('#00142F')
    .modulate({brightness:.35,saturation:.30})
    .png()
    .toBuffer();
  return {
    product,shadow,
    productLeft:left,productTop:top,
    shadowLeft:left+Math.round(format.width*.006),
    shadowTop:top+Math.round(format.height*.016)
  };
}

function fallbackPanelSvgForBox(format, box, template) {
  const x=Math.round(format.width*box.x);
  const y=Math.round(format.height*box.y);
  const w=Math.round(format.width*box.w);
  const h=Math.round(format.height*box.h);
  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + format.width + '" height="' + format.height + '">' +
    '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + Math.round(Math.min(w,h)*.06) + '" fill="#ffffff" opacity=".94"/>' +
    '<rect x="' + (x+2) + '" y="' + (y+2) + '" width="' + Math.max(1,w-4) + '" height="' + Math.max(1,h-4) + '" rx="' + Math.max(8,Math.round(Math.min(w,h)*.06)-2) + '" fill="none" stroke="#ffffff" stroke-opacity=".65" stroke-width="3"/>' +
    '</svg>'
  );
}

async function brandLogoLayer(format, opts) {
  if (!opts.brandLogoUrl) return null;
  try {
    const raw = await loadImage(opts.brandLogoUrl);
    if (!raw) return null;
    const mobile = format.device === 'mobile';
    const width = mobile ? Math.round(format.width*.28) : Math.round(format.width*.21);
    const height = mobile ? Math.round(format.height*.075) : Math.round(format.height*.15);
    const buffer = await sharp(raw)
      .rotate()
      .ensureAlpha()
      .trim({ background:{r:255,g:255,b:255,alpha:0},threshold:10 })
      .resize(width,height,{fit:'contain',background:{r:255,g:255,b:255,alpha:0}})
      .png()
      .toBuffer();
    const meta=await sharp(buffer).metadata();
    return {
      input:buffer,
      left:mobile
        ? Math.round((format.width-Number(meta.width||width))/2)
        : Math.round(format.width*.055),
      top:mobile ? Math.round(format.height*.095) : Math.round(format.height*.17)
    };
  } catch {
    return null;
  }
}

function quality(assets, opts, format) {
  const rows = Array.isArray(assets) ? assets : [assets];
  const allBackground = rows.every(asset => asset?.backgroundRemoved);
  const allResolution = rows.every(asset => Math.max(Number(asset?.sourceWidth||0),Number(asset?.sourceHeight||0))>=700);
  const checks = [
    {
      id:'background',
      ok:allBackground,
      label:allBackground ? 'Fundos dos produtos tratados' : 'Algum produto precisa de atenção no fundo',
      detail:allBackground
        ? rows.map(asset=>asset.removalMode).join(' • ')
        : 'O Studio preserva fundos complexos em vez de apagar partes do produto.'
    },
    {
      id:'resolution',
      ok:allResolution,
      label:allResolution ? 'Resolução adequada' : 'Alguma imagem de origem é pequena',
      detail:rows.map(asset=>asset.sourceWidth+'×'+asset.sourceHeight).join(' • ')
    },
    {
      id:'products',
      ok:rows.length>=1 && rows.length<=4,
      label:rows.length>1 ? rows.length+' produtos na campanha' : 'Produto principal definido',
      detail:rows.length>1 ? 'Composição multi-produto ativada.' : 'Você pode adicionar até 4 produtos.'
    },
    {
      id:'brand',
      ok:!opts.brandCampaign || Boolean(opts.brandName || opts.brandLogoUrl),
      label:!opts.brandCampaign || opts.brandName || opts.brandLogoUrl ? 'Identidade da campanha definida' : 'Informe a marca da campanha',
      detail:opts.brandCampaign ? 'Campanhas de marca ganham mais hierarquia com nome ou logo do fabricante.' : 'Campanha de produto.'
    },
    {
      id:'pricing',
      ok:!opts.showPrice || opts.cashPrice>0,
      label:opts.showPrice ? 'Preço preenchido' : 'Layout sem preço ativado',
      detail:opts.showPrice ? money(opts.cashPrice) : 'Preço não é obrigatório neste modo.'
    },
    {
      id:'format',
      ok:true,
      label:'Composição própria para '+(format.device==='mobile'?'celular':'desktop'),
      detail:format.width+'×'+format.height
    }
  ];
  const score=Math.round(checks.filter(item=>item.ok).length/checks.length*100);
  return {score,checks};
}

export async function prepareProProductAsset(product = {}, options = {}) {
  const source=productImage(product,options);
  if(!source) throw new Error('product_image_required');
  const raw=await loadImage(source);
  if(!raw) throw new Error('product_image_unavailable');
  return removeConnectedBackground(raw,options.removeBackground!==false && options.removeLightBackground!==false);
}

async function prepareCampaignAssets(opts) {
  const assets=[];
  for(const product of opts.products){
    const asset=await prepareProProductAsset(product,{
      ...opts,
      imageUrl:productImage(product,product)
    });
    assets.push(asset);
  }
  return assets;
}

export async function analyzeCreativeBannerPro(product = {}, options = {}) {
  const opts=normalizedOptions(product,options);
  const assets=await prepareCampaignAssets(opts);
  return {
    ok:true,
    format:opts.format,
    template:opts.template,
    contentMode:opts.contentMode,
    brandCampaign:opts.brandCampaign,
    showPrice:opts.showPrice,
    productCount:assets.length,
    products:assets.map((asset,index)=>({
      name:clean(opts.products[index]?.name || opts.products[index]?.title || 'Produto',90),
      sourceWidth:asset.sourceWidth,
      sourceHeight:asset.sourceHeight,
      width:asset.width,
      height:asset.height,
      orientation:assetOrientation(asset),
      backgroundRemoved:asset.backgroundRemoved,
      removalMode:asset.removalMode,
      removedRatio:Number(asset.removedRatio.toFixed(4)),
      backgroundConfidence:Number(asset.confidence.toFixed(3))
    })),
    quality:quality(assets,opts,opts.format)
  };
}

export async function generateCreativeBannerPro(product = {}, options = {}) {
  const opts=normalizedOptions(product,options);
  const format=opts.format;
  const assets=await prepareCampaignAssets(opts);
  const campaignMode=opts.brandCampaign || assets.length>1;
  const slots=campaignMode
    ? clusterSlots(format,assets.length)
    : [singleComposition(format,assets[0],opts).product];

  const layers=[{input:backgroundSvg(format,opts),left:0,top:0}];

  const arianaLogo=await logoLayer(format,opts);
  if(arianaLogo) layers.push(arianaLogo);

  const brandLogo=await brandLogoLayer(format,opts);
  if(brandLogo) layers.push(brandLogo);

  for(let index=0;index<assets.length;index+=1){
    const asset=assets[index];
    const box=slots[index] || slots[slots.length-1];
    const layer=await productCompositeForBox(asset,format,box);
    if(!asset.backgroundRemoved){
      layers.push({input:fallbackPanelSvgForBox(format,box,opts.template),left:0,top:0});
    }else{
      layers.push({input:layer.shadow,left:layer.shadowLeft,top:layer.shadowTop,blend:'over'});
    }
    layers.push({input:layer.product,left:layer.productLeft,top:layer.productTop,blend:'over'});
  }

  const overlay = format.device==='mobile'
    ? (campaignMode ? overlayMobileCampaign(format,opts) : overlayMobileStandard(format,opts))
    : (campaignMode ? overlayDesktopCampaign(format,opts) : overlayDesktopStandard(format,opts));
  layers.push({input:overlay,left:0,top:0});

  const buffer=await sharp({
    create:{
      width:format.width,
      height:format.height,
      channels:4,
      background:{r:0,g:71,b:171,alpha:1}
    }
  })
    .composite(layers)
    .png({compressionLevel:9,adaptiveFiltering:true})
    .toBuffer();

  return {
    buffer,
    meta:{
      format,
      template:opts.template,
      contentMode:opts.contentMode,
      brandCampaign:campaignMode,
      showPrice:opts.showPrice,
      productCount:assets.length,
      products:assets.map((asset,index)=>({
        name:clean(opts.products[index]?.name || opts.products[index]?.title || 'Produto',90),
        sourceWidth:asset.sourceWidth,
        sourceHeight:asset.sourceHeight,
        width:asset.width,
        height:asset.height,
        orientation:assetOrientation(asset),
        backgroundRemoved:asset.backgroundRemoved,
        removalMode:asset.removalMode,
        removedRatio:Number(asset.removedRatio.toFixed(4)),
        backgroundConfidence:Number(asset.confidence.toFixed(3))
      })),
      quality:quality(assets,opts,format)
    }
  };
}

