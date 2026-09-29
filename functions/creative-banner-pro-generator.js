import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { repairCreativeProductCutout } from './services/creativeProductCutoutRepairService.js';
// Recorte Pro: máscara/qualidade permanecem isoladas no serviço de recorte.
// Recorte Pro: a implementação fica isolada no serviço; o renderer apenas consome o PNG validado.

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
  marketplace: Object.freeze({
    label: 'Marketplace Impacto',
    description: 'Azul Ariana, contraste forte, faixa amarela e leitura rápida de varejo.',
    mood: 'impacto',
    accent: '#FFD51B'
  }),
  premium: Object.freeze({
    label: 'Premium Ariana',
    description: 'Azul-marinho, dourado, respiro maior e acabamento elegante.',
    mood: 'premium',
    accent: '#F0CA6A'
  }),
  campaign: Object.freeze({
    label: 'Campanha Forte',
    description: 'Azul vivo, feixe amarelo, energia promocional e direção de campanha.',
    mood: 'campanha',
    accent: '#FFD51B'
  })
});

export const MARKETPLACE_ARIANA_PRESETS = Object.freeze({
  impact: Object.freeze({
    label: 'Varejo Impacto Ariana',
    objective: 'commercial',
    preferredGrammar: 'A',
    description: 'Headline forte, categoria clara e grupo de produtos com linguagem comercial.'
  }),
  selection: Object.freeze({
    label: 'Seleção Ariana',
    objective: 'category',
    preferredGrammar: 'B',
    description: 'Foco em categoria, visual limpo e composição de 2 a 4 produtos.'
  }),
  manufacturer: Object.freeze({
    label: 'Fabricante em Destaque',
    objective: 'manufacturer',
    preferredGrammar: 'D',
    description: 'Fabricante ou linha em destaque, texto curto e acabamento premium.'
  }),
  opportunity: Object.freeze({
    label: 'Campanha de Oportunidade',
    objective: 'commercial_campaign',
    preferredGrammar: 'C',
    description: 'Campanha de maior impacto. Informações comerciais só entram quando explicitamente fornecidas.'
  }),
  mini_cards: Object.freeze({
    label: 'Grade Comercial / Mini Cards',
    objective: 'category',
    preferredGrammar: 'E',
    description: 'Cards menores para homepage, vitrines e campanhas de apoio.'
  })
});

function resolveMarketplacePreset(value = '') {
  const key = String(value || '').trim().toLowerCase();
  return MARKETPLACE_ARIANA_PRESETS[key] ? key : 'impact';
}

function resolveMarketplaceGrammar(value = '', preset = 'impact') {
  const raw = String(value || '').trim().toUpperCase();
  if (['A','B','C','D','E'].includes(raw)) return raw;
  return MARKETPLACE_ARIANA_PRESETS[resolveMarketplacePreset(preset)]?.preferredGrammar || 'A';
}

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

export function getProTemplateManifest(value = '') {
  const id = resolveProTemplate(value);
  const template = PRO_TEMPLATES[id];
  return {
    schemaVersion: 'ariana-creative-template/v1',
    id,
    label: template.label,
    description: template.description,
    renderer: id,
    style: {
      mood: template.mood,
      accent: template.accent
    },
    marketplaceAriana: {
      generationStyles: ['classic','premium','marketplace','institutional'],
      presets: Object.entries(MARKETPLACE_ARIANA_PRESETS).map(([presetId, preset]) => ({
        id: presetId,
        label: preset.label,
        objective: preset.objective,
        preferredGrammar: preset.preferredGrammar,
        description: preset.description
      })),
      layoutGrammars: {
        A: 'texto à esquerda; produtos à direita',
        B: 'texto central/topo; produto principal central; apoios laterais',
        C: 'headline no topo; grupo de produtos abaixo; CTA discreto no rodapé',
        D: 'fabricante/linha em destaque; composição premium',
        E: 'mini campanhas em cards quadrados/retangulares'
      },
      palette: {
        primary: '#0047AB',
        highlight: '#FFD51B',
        premium: '#F0CA6A',
        deepBlue: '#071B3B',
        white: '#FFFFFF'
      }
    },
    supportedFormats: Object.entries(PRO_BANNER_FORMATS).map(([formatId, item]) => ({
      id: formatId,
      label: item.label,
      width: item.width,
      height: item.height,
      device: item.device
    })),
    rules: {
      manualCopyAuthority: 'editor_nonempty_wins',
      copyFields: ['badge', 'headline', 'subtitle', 'cta'],
      aiCreativeDirection: true,
      multiProduct: {
        minProducts: 2,
        maxProducts: 5,
        preferredHeroComposition: 'one_plus_two'
      },
      commerce: {
        autoPrice: false,
        autoDiscount: false,
        autoPix: false,
        autoInstallments: false,
        autoFreight: false
      },
      branding: {
        officialArianaLogoRequired: true,
        manufacturerLogoOptional: true,
        externalStorePromotionForbidden: true,
        ownSiteUrlInsideOwnSiteBanner: false
      },
      qualityGate: {
        cutoutRequired: true,
        internalBackgroundContaminationCheck: true,
        whiteHaloResidualCheck: true,
        thinStructureDamageCheck: true,
        minimumSourceLongEdge: 700,
        blockFinalSaveOnCriticalFailure: true
      }
    }
  };
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
    product.originalSourcePath ||
    product.sourcePath ||
    options.originalSourcePath ||
    options.sourcePath ||
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

async function logoLayer(format, preparedAsset = null) {
  const asset = preparedAsset || await prepareOfficialLogoAsset();
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


async function prepareCampaignBrandLogo(url = '') {
  const sourceUrl = String(url || '').trim();
  if (!sourceUrl) return null;
  const raw = await loadImage(sourceUrl);
  if (!raw) throw new Error('campaign_brand_logo_unavailable');

  const source = sharp(raw)
    .rotate()
    .resize({ width: 1400, height: 520, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha();
  const { data, info } = await source.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const total = width * height;

  let transparentPixels = 0;
  for (let i = 0; i < total; i += 1) {
    if (data[i * channels + 3] < 40) transparentPixels += 1;
  }
  const transparentRatio = transparentPixels / Math.max(1, total);

  if (transparentRatio > .025) {
    const png = await source.png().toBuffer();
    const trimmed = await sharp(png)
      .trim({ background: { r:0,g:0,b:0,alpha:0 }, threshold:5 })
      .png()
      .toBuffer();
    const meta = await sharp(trimmed).metadata();
    return {
      buffer: trimmed,
      width: meta.width || width,
      height: meta.height || height,
      backgroundRemoved: true,
      removalMode: 'existing_alpha',
      removedRatio: transparentRatio
    };
  }

  const bg = colorStats(data, info);
  const uniformEdge = bg.variance < 1800;
  if (!uniformEdge) {
    return {
      buffer: await source.png().toBuffer(),
      width,
      height,
      backgroundRemoved: false,
      removalMode: 'complex_brand_logo_background',
      removedRatio: 0
    };
  }

  const bright = bg.brightness >= 205;
  const dark = bg.brightness <= 65;
  const tolerance = bright ? 86 : dark ? 62 : 54;
  const tolerance2 = tolerance * tolerance;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  function matches(index) {
    const p = index * channels;
    if (data[p + 3] < 24) return true;
    const dr = data[p] - bg.r;
    const dg = data[p + 1] - bg.g;
    const db = data[p + 2] - bg.b;
    return dr*dr + dg*dg + db*db <= tolerance2;
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

  const removedRatio = tail / Math.max(1,total);
  if (removedRatio < .02 || removedRatio > .94) {
    return {
      buffer: await source.png().toBuffer(),
      width,
      height,
      backgroundRemoved: false,
      removalMode: 'brand_logo_background_not_safe',
      removedRatio
    };
  }

  for (let i = 0; i < total; i += 1) {
    if (visited[i]) data[i * channels + 3] = 0;
  }

  const png = await sharp(data,{raw:info}).png().toBuffer();
  const trimmed = await sharp(png)
    .trim({ background:{r:0,g:0,b:0,alpha:0}, threshold:5 })
    .png()
    .toBuffer();
  const meta = await sharp(trimmed).metadata();

  return {
    buffer: trimmed,
    width: meta.width || width,
    height: meta.height || height,
    backgroundRemoved: true,
    removalMode: bright ? 'connected_light_brand_logo' : dark ? 'connected_dark_brand_logo' : 'connected_uniform_brand_logo',
    removedRatio
  };
}

async function campaignBrandLogoLayer(format, asset = null) {
  if (!asset?.buffer || !asset.backgroundRemoved) return null;
  const mobile = format.device === 'mobile';
  const maxW = mobile ? Math.round(format.width * .34) : Math.round(format.width * .18);
  const maxH = mobile ? Math.round(format.height * .070) : Math.round(format.height * .120);
  const buffer = await sharp(asset.buffer)
    .resize(maxW,maxH,{
      fit:'inside',
      withoutEnlargement:false,
      background:{r:255,g:255,b:255,alpha:0}
    })
    .png()
    .toBuffer();
  const meta = await sharp(buffer).metadata();
  const bw = Number(meta.width || maxW);
  return {
    input: buffer,
    left: mobile
      ? Math.round((format.width - bw)/2)
      : Math.round(format.width * .055),
    top: mobile
      ? Math.round(format.height * .115)
      : Math.round(format.height * .155),
    blend:'over'
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


function alphaShapeStats(raw, info) {
  const { width, height, channels } = info;
  const total = width * height;
  const opaque = new Uint8Array(total);
  let opaquePixels = 0;

  for (let i = 0; i < total; i += 1) {
    if (raw[i * channels + 3] >= 48) {
      opaque[i] = 1;
      opaquePixels += 1;
    }
  }

  if (!opaquePixels) {
    return {
      opaqueRatio: 0,
      majorComponents: 0,
      largestShare: 0,
      components: []
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
  const majorThreshold = Math.max(120, Math.round(opaquePixels * .018));
  const majorComponents = components.filter(value => value >= majorThreshold).length;

  return {
    opaqueRatio: opaquePixels / Math.max(1, total),
    majorComponents,
    largestShare: largest / Math.max(1, opaquePixels),
    components: components.slice(0, 12)
  };
}

function cutoutSafety(stats = {}, removedRatio = 0, productText = '') {
  const text = String(productText || '').toLowerCase();
  const kitLike = /(kit|conjunto|combo|antena|parabol|receptor|acess[oó]rio|cabo|jogo)/i.test(text);
  const tooThin = Number(stats.opaqueRatio || 0) < .055;
  const tooFragmented = !kitLike && (
    Number(stats.majorComponents || 0) > 3 ||
    (Number(stats.majorComponents || 0) > 1 && Number(stats.largestShare || 0) < .78)
  );
  const suspiciousWhiteLeak =
    !kitLike &&
    removedRatio > .67 &&
    Number(stats.opaqueRatio || 0) < .19 &&
    Number(stats.largestShare || 0) < .90;

  const safe = !tooThin && !tooFragmented && !suspiciousWhiteLeak;
  let reason = 'ok';
  if (tooThin) reason = 'opaque_area_too_small';
  else if (tooFragmented) reason = 'foreground_fragmented';
  else if (suspiciousWhiteLeak) reason = 'possible_white_product_overcut';

  return { safe, reason, kitLike };
}

async function removeConnectedBackground(buffer, enabled = true, productText = '') {
  const source = sharp(buffer)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha();

  const sourceMeta = await source.metadata();
  const { data, info } = await source.raw().toBuffer({ resolveWithObject: true });
  const originalPixels = Buffer.from(data);
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
    const shape = alphaShapeStats(data, info);
    const safety = initialTransparentRatio > 0.03
      ? cutoutSafety(shape, initialTransparentRatio, productText)
      : { safe: false, reason: 'background_removal_disabled', kitLike: false };
    return {
      buffer: trimmed,
      sourceWidth: sourceMeta.width || width,
      sourceHeight: sourceMeta.height || height,
      width: meta.width || width,
      height: meta.height || height,
      backgroundRemoved: initialTransparentRatio > 0.03 && safety.safe,
      removalMode: initialTransparentRatio > 0.03
        ? (safety.safe ? 'existing_alpha' : 'unsafe_existing_alpha')
        : 'disabled',
      removedRatio: initialTransparentRatio,
      confidence: initialTransparentRatio > 0.03 && safety.safe ? 1 : 0,
      cutoutSafe: Boolean(safety.safe),
      cutoutReason: safety.reason,
      shape
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
      confidence: 0.15,
      cutoutSafe: false,
      cutoutReason: 'complex_background',
      shape: alphaShapeStats(data, info)
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
      confidence: removedRatio > 0.94 ? 0 : 0.3,
      cutoutSafe: false,
      cutoutReason: removedRatio > 0.94 ? 'overremove_ratio' : 'no_background_detected',
      shape: alphaShapeStats(data, info)
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

  const shape = alphaShapeStats(data, info);
  const safety = cutoutSafety(shape, removedRatio, productText);
  const confidence = safety.safe
    ? clamp(
        (uniformEdge ? 0.45 : 0.2) +
        (lightEdge ? 0.25 : 0.1) +
        Math.min(0.25, removedRatio * 0.35),
        0,
        0.98
      )
    : 0;

  if (!safety.safe) {
    // Segunda tentativa conservadora para fotos de catálogo em fundo branco.
    // A primeira passagem pode confundir partes claras do próprio produto com
    // o fundo. Aqui removemos somente pixels quase brancos conectados às bordas,
    // preservando carcaças cinza/brancas e detalhes claros.
    if (lightEdge && ['foreground_fragmented', 'possible_white_product_overcut'].includes(safety.reason)) {
      const conservative = Buffer.from(originalPixels);
      const conservativeVisited = new Uint8Array(total);
      const conservativeQueue = new Int32Array(total);
      let conservativeHead = 0;
      let conservativeTail = 0;
      const conservativeTolerance = 38;
      const conservativeTolerance2 = conservativeTolerance * conservativeTolerance;

      function conservativeMatches(index) {
        const p = index * channels;
        const alpha = conservative[p + 3];
        if (alpha < 24) return true;
        const dr = conservative[p] - bg.r;
        const dg = conservative[p + 1] - bg.g;
        const db = conservative[p + 2] - bg.b;
        const dist2 = dr * dr + dg * dg + db * db;
        const brightness = (conservative[p] + conservative[p + 1] + conservative[p + 2]) / 3;
        const spread = Math.max(conservative[p], conservative[p + 1], conservative[p + 2])
          - Math.min(conservative[p], conservative[p + 1], conservative[p + 2]);
        return brightness >= 242 && spread <= 28 && dist2 <= conservativeTolerance2 * 1.35;
      }

      function conservativeEnqueue(index) {
        if (conservativeVisited[index] || !conservativeMatches(index)) return;
        conservativeVisited[index] = 1;
        conservativeQueue[conservativeTail++] = index;
      }

      for (let x = 0; x < width; x += 1) {
        conservativeEnqueue(x);
        conservativeEnqueue((height - 1) * width + x);
      }
      for (let y = 0; y < height; y += 1) {
        conservativeEnqueue(y * width);
        conservativeEnqueue(y * width + width - 1);
      }

      while (conservativeHead < conservativeTail) {
        const index = conservativeQueue[conservativeHead++];
        const x = index % width;
        const y = Math.floor(index / width);
        if (x > 0) conservativeEnqueue(index - 1);
        if (x + 1 < width) conservativeEnqueue(index + 1);
        if (y > 0) conservativeEnqueue(index - width);
        if (y + 1 < height) conservativeEnqueue(index + width);
      }

      const conservativeRemovedRatio = conservativeTail / Math.max(1, total);
      if (conservativeRemovedRatio >= 0.015 && conservativeRemovedRatio <= 0.94) {
        for (let i = 0; i < total; i += 1) {
          if (conservativeVisited[i]) conservative[i * channels + 3] = 0;
        }

        for (let i = 0; i < total; i += 1) {
          if (conservativeVisited[i]) continue;
          const x = i % width;
          const y = Math.floor(i / width);
          const touchesRemoved =
            (x > 0 && conservativeVisited[i - 1]) ||
            (x + 1 < width && conservativeVisited[i + 1]) ||
            (y > 0 && conservativeVisited[i - width]) ||
            (y + 1 < height && conservativeVisited[i + width]);
          if (touchesRemoved) {
            const alphaIndex = i * channels + 3;
            conservative[alphaIndex] = Math.min(conservative[alphaIndex], 232);
          }
        }

        const conservativeShape = alphaShapeStats(conservative, info);
        const conservativeSafety = cutoutSafety(
          conservativeShape,
          conservativeRemovedRatio,
          productText
        );

        if (conservativeSafety.safe) {
          const conservativePng = await sharp(conservative, { raw: info }).png().toBuffer();
          const conservativeTrimmed = await sharp(conservativePng)
            .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
            .png()
            .toBuffer();
          const conservativeMeta = await sharp(conservativeTrimmed).metadata();

          return {
            buffer: conservativeTrimmed,
            sourceWidth: sourceMeta.width || width,
            sourceHeight: sourceMeta.height || height,
            width: conservativeMeta.width || width,
            height: conservativeMeta.height || height,
            backgroundRemoved: true,
            removalMode: 'connected_light_background_conservative',
            removedRatio: conservativeRemovedRatio,
            confidence: 0.78,
            cutoutSafe: true,
            cutoutReason: 'ok',
            shape: conservativeShape
          };
        }
      }
    }

    const original = await source.png().toBuffer();
    const originalMeta = await sharp(original).metadata();
    return {
      buffer: original,
      sourceWidth: sourceMeta.width || width,
      sourceHeight: sourceMeta.height || height,
      width: originalMeta.width || width,
      height: originalMeta.height || height,
      backgroundRemoved: false,
      removalMode: 'unsafe_cutout_blocked',
      removedRatio,
      confidence: 0,
      cutoutSafe: false,
      cutoutReason: safety.reason,
      shape
    };
  }

  return {
    buffer: trimmed,
    sourceWidth: sourceMeta.width || width,
    sourceHeight: sourceMeta.height || height,
    width: meta.width || width,
    height: meta.height || height,
    backgroundRemoved: true,
    removalMode: lightEdge ? 'connected_light_background' : 'connected_uniform_background',
    removedRatio,
    confidence,
    cutoutSafe: true,
    cutoutReason: 'ok',
    shape
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
  const generationStyle = ['classic','premium','marketplace','institutional'].includes(String(options.generationStyle || '').trim().toLowerCase())
    ? String(options.generationStyle).trim().toLowerCase()
    : 'classic';
  const marketplacePreset = resolveMarketplacePreset(options.marketplacePreset);
  const layoutGrammar = resolveMarketplaceGrammar(options.layoutGrammar, marketplacePreset);
  const campaignObjective = clean(options.campaignObjective || MARKETPLACE_ARIANA_PRESETS[marketplacePreset]?.objective || 'product', 32);
  const productName = clean(options.productName || product.name || product.title || 'Produto Ariana Móveis', 110);
  const manualCopy = options && typeof options.manualCopy === 'object' && options.manualCopy
    ? options.manualCopy
    : null;
  const hasOwn = (object, key) => Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
  const copyValue = (key, fallback, maxLength) => {
    const raw = hasOwn(manualCopy, key)
      ? manualCopy[key]
      : (hasOwn(options, key) ? options[key] : '');
    const value = clean(raw, maxLength);
    return value || clean(fallback, maxLength);
  };
  const headline = copyValue('headline', showPrice ? 'OFERTA IMPERDÍVEL' : 'DESTAQUE ARIANA', 72);
  const explicitBenefit = Object.prototype.hasOwnProperty.call(options, 'benefit');
  const subtitle = copyValue('subtitle', defaultBenefit(product), 120);
  const benefit = clean(explicitBenefit ? options.benefit : '', 150);
  const cta = copyValue('cta', showPrice ? 'APROVEITE AGORA' : 'CONFIRA NO SITE', 42);
  const badge = copyValue('badge', (
    template === 'premium' ? 'SELEÇÃO ARIANA' :
    template === 'campaign' ? 'CAMPANHA ESPECIAL' :
    'OFERTA ARIANA'
  ), 42);
  const explicitBrand = Object.prototype.hasOwnProperty.call(options, 'brandLabel');
  const explicitBrandLogo = Object.prototype.hasOwnProperty.call(options, 'brandLogoUrl');
  const brandLabel = clean(
    explicitBrand ? options.brandLabel : (options.brand || product.brand || product.brandName || ''),
    34
  ).toUpperCase();
  const couponText = clean(options.couponText || options.coupon || '', 26).toUpperCase();
  const showCommercialInfo = options.showCommercialInfo === true || String(options.promotionMode || '').toLowerCase() === 'commercial';
  const promoText = clean(
    options.promoText || (showCommercialInfo ? 'CONDIÇÕES ESPECIAIS' : ''),
    46
  ).toUpperCase();
  const brandLogoUrl = String(
    explicitBrandLogo ? options.brandLogoUrl : (options.manufacturerLogoUrl || product.brandLogoUrl || '')
  ).trim();

  return {
    format,
    template,
    generationStyle,
    marketplacePreset,
    layoutGrammar,
    campaignObjective,
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
    showCommercialInfo,
    brandLogoUrl,
    hasBrandLogo: false,
    siteLabel: clean(options.siteLabel || 'arianamoveis.com.br', 45),
    removeBackground: options.removeBackground !== false && options.removeLightBackground !== false
  };
}

function highQualityRenderFormat(format, opts = {}) {
  if (opts.generationStyle !== 'marketplace') return format;
  return {
    ...format,
    width: format.width * 2,
    height: format.height * 2,
    renderScale: 2
  };
}

async function finalizeBannerBuffer(layers, renderFormat, finalFormat, highQuality = false) {
  let pipeline = sharp({
    create: {
      width: renderFormat.width,
      height: renderFormat.height,
      channels: 4,
      background: { r: 0, g: 71, b: 171, alpha: 1 }
    }
  }).composite(layers);

  if (highQuality && (renderFormat.width !== finalFormat.width || renderFormat.height !== finalFormat.height)) {
    pipeline = pipeline
      .resize(finalFormat.width, finalFormat.height, {
        fit: 'fill',
        kernel: sharp.kernel.lanczos3
      })
      .sharpen({ sigma: 0.55 });
  }

  return pipeline
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
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
    const mobile = format.device === 'mobile';
    const dots = Array.from({length:18},(_,i)=>{
      const col=i%6, row=Math.floor(i/6);
      return '<circle cx="' + Math.round(w*(mobile ? .08+col*.035 : .54+col*.018)) + '" cy="' + Math.round(h*(mobile ? .18+row*.025 : .18+row*.045)) + '" r="' + Math.max(2,Math.round(h*.005)) + '"/>';
    }).join('');
    return Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' +
      '<defs>' +
      '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0874F2"/><stop offset=".42" stop-color="#0758C9"/><stop offset=".72" stop-color="#063B91"/><stop offset="1" stop-color="#031B4D"/></linearGradient>' +
      '<radialGradient id="heroGlow" cx="' + (mobile?'50%':'78%') + '" cy="' + (mobile?'60%':'48%') + '" r="58%"><stop offset="0" stop-color="#36A9FF" stop-opacity=".42"/><stop offset=".48" stop-color="#1168D8" stop-opacity=".14"/><stop offset="1" stop-color="#05285F" stop-opacity="0"/></radialGradient>' +
      '<linearGradient id="goldBeam" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFF15A"/><stop offset=".45" stop-color="#FFD51B"/><stop offset="1" stop-color="#F2A600"/></linearGradient>' +
      '<filter id="softGlow"><feGaussianBlur stdDeviation="' + Math.max(8,Math.round(h*.025)) + '"/></filter>' +
      '</defs>' +
      '<rect width="100%" height="100%" fill="url(#bg)"/>' +
      '<rect width="100%" height="100%" fill="url(#heroGlow)"/>' +
      '<path d="M' + Math.round(w*(mobile?.86:.69)) + ' -' + Math.round(h*.18) + ' L' + Math.round(w*(mobile?1.03:.80)) + ' -' + Math.round(h*.18) + ' L' + Math.round(w*(mobile?.78:.64)) + ' ' + Math.round(h*1.18) + ' L' + Math.round(w*(mobile?.66:.55)) + ' ' + Math.round(h*1.18) + ' Z" fill="url(#goldBeam)" opacity=".98"/>' +
      '<path d="M' + Math.round(w*(mobile?.91:.76)) + ' -' + Math.round(h*.18) + ' L' + Math.round(w*(mobile?1.10:.88)) + ' -' + Math.round(h*.18) + ' L' + Math.round(w*(mobile?.88:.73)) + ' ' + Math.round(h*1.18) + ' L' + Math.round(w*(mobile?.76:.66)) + ' ' + Math.round(h*1.18) + ' Z" fill="#ffffff" opacity=".08"/>' +
      '<path d="M0 ' + Math.round(h*.96) + ' C' + Math.round(w*.25) + ' ' + Math.round(h*.88) + ' ' + Math.round(w*.62) + ' ' + Math.round(h*1.04) + ' ' + w + ' ' + Math.round(h*.92) + ' V' + h + ' H0 Z" fill="#021638" opacity=".35"/>' +
      '<ellipse cx="' + Math.round(w*(mobile?.50:.79)) + '" cy="' + Math.round(h*(mobile?.66:.60)) + '" rx="' + Math.round(w*(mobile?.33:.24)) + '" ry="' + Math.round(h*(mobile?.22:.42)) + '" fill="#35A8FF" opacity=".16" filter="url(#softGlow)"/>' +
      '<g fill="#ffffff" opacity=".20">' + dots + '</g>' +
      '</svg>'
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
  const textW=Math.round(w*.45);
  const badgeY=Math.round(h*.205);
  const badgeH=Math.round(h*.060);
  const badgeFs=Math.round(h*.031);
  const headlineFs=Math.round(h*(opts.headline.length>30?.082:.096));
  const headlineLines=wrap(opts.headline, Math.max(18,Math.floor(textW/(headlineFs*.55))),2);
  const headlineY=Math.round(h*.335);
  const subtitleY=headlineY+headlineLines.length*headlineFs*.96+Math.round(h*.025);
  const subtitleFs=Math.round(h*.036);
  const bottomY=Math.round(h*.835), pillH=Math.round(h*.105);
  const gap=Math.round(w*.010);
  const pill1W=Math.round(w*.155), pill2W=Math.round(w*.175), pill3W=Math.round(w*.135);
  const pill1Text=opts.showPrice ? (opts.installmentCount+'x de '+money(opts.installmentPrice)) : 'CONDIÇÕES ESPECIAIS';

  let center='';
  if(opts.showPrice){
    center=
      '<text x="'+x+'" y="'+Math.round(h*.610)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(h*.026)+'" font-weight="900" fill="#ffffff" opacity=".86">À VISTA NO PIX</text>'+
      '<text x="'+x+'" y="'+Math.round(h*.745)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(h*.120)+'" font-weight="950" fill="#FFD51B">'+escapeXml(money(opts.cashPrice))+'</text>';
  } else {
    center=linesSvg(
      wrap(opts.benefit,42,2),
      {x,y:Math.round(h*.625),size:Math.round(h*.036),lineHeight:Math.round(h*.047),fill:'#ffffff',weight:700}
    );
  }

  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'">'+
    '<rect x="'+x+'" y="'+badgeY+'" width="'+Math.round(Math.max(h*.31,opts.badge.length*badgeFs*.68))+'" height="'+badgeH+'" rx="'+Math.round(badgeH*.5)+'" fill="#FFD51B"/>'+
    '<text x="'+(x+Math.round(badgeH*.55))+'" y="'+(badgeY+Math.round(badgeH*.68))+'" font-family="Arial,Helvetica,sans-serif" font-size="'+badgeFs+'" font-weight="950" fill="#06306A">'+escapeXml(opts.badge)+'</text>'+
    linesSvg(headlineLines,{x,y:headlineY,size:headlineFs,lineHeight:headlineFs*.98,fill:'#ffffff',weight:950})+
    '<text x="'+x+'" y="'+subtitleY+'" font-family="Arial,Helvetica,sans-serif" font-size="'+subtitleFs+'" font-weight="650" fill="#ffffff" opacity=".94">'+escapeXml(opts.subtitle)+'</text>'+
    center+
    pillSvg({x,y:bottomY,w:pill1W,h:pillH,fill:'#071D49',text:pill1Text,textFill:'#ffffff',fs:Math.round(h*.029)})+
    pillSvg({x:x+pill1W+gap,y:bottomY,w:pill2W,h:pillH,fill:'#FFD51B',text:opts.promoText,textFill:'#08285A',fs:Math.round(h*.026)})+
    pillSvg({x:x+pill1W+pill2W+gap*2,y:bottomY,w:pill3W,h:pillH,fill:'#ffffff',text:opts.cta,textFill:'#0047AB',fs:Math.round(h*.029)})+
    '</svg>'
  );
}

function premiumDesktopOverlay(format, opts) {
  const w=format.width,h=format.height,x=Math.round(w*.055), textW=Math.round(w*.41);
  const brand=opts.brandLabel ? opts.brandLabel+' • ' : '';
  const kicker=brand+'SELEÇÃO ESPECIAL';
  const headlineFs=Math.round(h*(opts.headline.length>30?.077:.091));
  const headlineLines=wrap(opts.headline,Math.max(18,Math.floor(textW/(headlineFs*.55))),2);
  const body=wrap(opts.benefit,43,2);
  const ctaY=Math.round(h*.805),ctaH=Math.round(h*.088);

  let pricing='';
  if(opts.showPrice){
    pricing=
      '<text x="'+x+'" y="'+Math.round(h*.635)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(h*.026)+'" font-weight="800" fill="#F0CA6A">NO PIX</text>'+
      '<text x="'+x+'" y="'+Math.round(h*.748)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(h*.104)+'" font-weight="950" fill="#F0CA6A">'+escapeXml(money(opts.cashPrice))+'</text>';
  } else {
    pricing=linesSvg(body,{x,y:Math.round(h*.650),size:Math.round(h*.034),lineHeight:Math.round(h*.044),fill:'#ffffff',weight:650});
  }

  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'">'+
    '<text x="'+x+'" y="'+Math.round(h*.225)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(h*.030)+'" font-weight="900" letter-spacing="2.5" fill="#F0CA6A">'+escapeXml(kicker)+'</text>'+
    linesSvg(headlineLines,{x,y:Math.round(h*.345),size:headlineFs,lineHeight:headlineFs*.98,fill:'#ffffff',weight:900})+
    '<text x="'+x+'" y="'+Math.round(h*.535)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(h*.034)+'" font-weight="650" fill="#ffffff" opacity=".86">'+escapeXml(opts.subtitle)+'</text>'+
    pricing+
    '<rect x="'+x+'" y="'+ctaY+'" width="'+Math.round(textW*.40)+'" height="'+ctaH+'" rx="'+Math.round(ctaH*.5)+'" fill="#F0CA6A"/>'+
    '<text x="'+(x+Math.round(textW*.20))+'" y="'+(ctaY+Math.round(ctaH*.66))+'" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(h*.030)+'" font-weight="950" fill="#071B3B">'+escapeXml(opts.cta)+'</text>'+
    '</svg>'
  );
}

function campaignDesktopOverlay(format, opts) {
  const w=format.width,h=format.height,x=Math.round(w*.055);
  const brand=opts.brandLabel || 'ARIANA';
  const special='ESPECIAL '+brand;
  const useCoupon=Boolean(opts.couponText);
  const topLine=useCoupon ? 'USE O CUPOM' : opts.headline;
  const main=useCoupon ? opts.couponText : opts.badge;
  const offerY=Math.round(h*.395),offerH=Math.round(h*.132);
  const bottomY=Math.round(h*.820),pillH=Math.round(h*.108),gap=Math.round(w*.010);
  const pillW=Math.round(w*.165);

  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'">'+
    (opts.hasBrandLogo ? '' : '<text x="'+x+'" y="'+Math.round(h*.220)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(h*.038)+'" font-weight="900" letter-spacing="3" fill="#ffffff">'+escapeXml(special)+'</text>')+
    '<text x="'+x+'" y="'+Math.round(h*.335)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(h*.075)+'" font-weight="950" fill="#ffffff">'+escapeXml(topLine)+'</text>'+
    '<rect x="'+x+'" y="'+offerY+'" width="'+Math.round(w*.255)+'" height="'+offerH+'" rx="'+Math.round(h*.030)+'" fill="#FFD51B"/>'+
    '<text x="'+(x+Math.round(w*.1275))+'" y="'+(offerY+Math.round(offerH*.68))+'" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(h*(main.length>15?.054:.067))+'" font-weight="950" fill="#08285A">'+escapeXml(main)+'</text>'+
    '<text x="'+x+'" y="'+Math.round(h*.615)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(h*.034)+'" font-weight="700" fill="#ffffff">'+escapeXml(opts.subtitle)+'</text>'+
    (opts.showPrice
      ? '<text x="'+x+'" y="'+Math.round(h*.735)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(h*.076)+'" font-weight="950" fill="#FFD51B">'+escapeXml(money(opts.cashPrice))+'</text>'
      : '')+
    pillSvg({x,y:bottomY,w:pillW,h:pillH,fill:'#071D49',text:opts.installmentCount+'x no cartão',textFill:'#ffffff',fs:Math.round(h*.028)})+
    pillSvg({x:x+pillW+gap,y:bottomY,w:pillW,h:pillH,fill:'#FFD51B',text:opts.promoText,textFill:'#08285A',fs:Math.round(h*.025)})+
    pillSvg({x:x+pillW*2+gap*2,y:bottomY,w:Math.round(w*.130),h:pillH,fill:'#ffffff',text:opts.cta,textFill:'#0047AB',fs:Math.round(h*.028)})+
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
  const badgeY=Math.round(h*.105),badgeH=Math.round(h*.046);
  const headlineFs=Math.round(w*(opts.headline.length>27?.044:.052));
  const headlineLines=wrap(opts.headline,20,2);
  const headlineY=Math.round(h*.205);
  const subtitleY=Math.round(h*.300);
  const bottomY=Math.round(h*.875),pillH=Math.round(h*.056),gap=Math.round(w*.010);
  const pillW=Math.round(w*.285);

  let lower='';
  if(opts.showPrice){
    lower=
      '<text x="'+c+'" y="'+Math.round(h*.785)+'" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(w*.022)+'" font-weight="900" fill="#ffffff">À VISTA NO PIX</text>'+
      '<text x="'+c+'" y="'+Math.round(h*.842)+'" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(w*.061)+'" font-weight="950" fill="#FFD51B">'+escapeXml(money(opts.cashPrice))+'</text>';
  } else {
    lower=linesSvg(wrap(opts.benefit,32,2),{x:c,y:Math.round(h*.790),size:Math.round(w*.027),lineHeight:Math.round(w*.035),fill:'#ffffff',weight:700,anchor:'middle'});
  }

  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'">'+
    '<rect x="'+Math.round(w*.34)+'" y="'+badgeY+'" width="'+Math.round(w*.32)+'" height="'+badgeH+'" rx="'+Math.round(badgeH*.5)+'" fill="#FFD51B"/>'+
    '<text x="'+c+'" y="'+(badgeY+Math.round(badgeH*.68))+'" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(w*.022)+'" font-weight="950" fill="#06306A">'+escapeXml(opts.badge)+'</text>'+
    linesSvg(headlineLines,{x:c,y:headlineY,size:headlineFs,lineHeight:headlineFs*1.03,fill:'#ffffff',weight:950,anchor:'middle'})+
    '<text x="'+c+'" y="'+subtitleY+'" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(w*.026)+'" font-weight="650" fill="#ffffff" opacity=".92">'+escapeXml(opts.subtitle)+'</text>'+
    lower+
    pillSvg({x:Math.round(w*.055),y:bottomY,w:pillW,h:pillH,fill:'#071D49',text:opts.installmentCount+'x cartão',textFill:'#ffffff',fs:Math.round(w*.019)})+
    pillSvg({x:Math.round(w*.055)+pillW+gap,y:bottomY,w:pillW,h:pillH,fill:'#FFD51B',text:'TEMPO LIMITADO',textFill:'#08285A',fs:Math.round(w*.018)})+
    pillSvg({x:Math.round(w*.055)+(pillW+gap)*2,y:bottomY,w:Math.round(w*.265),h:pillH,fill:'#ffffff',text:opts.cta,textFill:'#0047AB',fs:Math.round(w*.019)})+
    '</svg>'
  );
}

function premiumMobileOverlay(format, opts) {
  const w=format.width,h=format.height,c=Math.round(w/2);
  const lines=wrap(opts.headline,21,2);
  const brand=opts.brandLabel ? opts.brandLabel+' • ' : '';
  let lower='';
  if(opts.showPrice){
    lower=
      '<text x="'+c+'" y="'+Math.round(h*.800)+'" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(w*.023)+'" font-weight="800" fill="#F0CA6A">NO PIX</text>'+
      '<text x="'+c+'" y="'+Math.round(h*.855)+'" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(w*.060)+'" font-weight="950" fill="#F0CA6A">'+escapeXml(money(opts.cashPrice))+'</text>';
  } else {
    lower=linesSvg(wrap(opts.benefit,32,2),{x:c,y:Math.round(h*.800),size:Math.round(w*.027),lineHeight:Math.round(w*.035),fill:'#ffffff',weight:650,anchor:'middle'});
  }

  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'">'+
    '<text x="'+c+'" y="'+Math.round(h*.145)+'" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(w*.021)+'" font-weight="900" letter-spacing="2" fill="#F0CA6A">'+escapeXml(brand+'SELEÇÃO ESPECIAL')+'</text>'+
    linesSvg(lines,{x:c,y:Math.round(h*.215),size:Math.round(w*.047),lineHeight:Math.round(w*.052),fill:'#ffffff',weight:900,anchor:'middle'})+
    '<text x="'+c+'" y="'+Math.round(h*.310)+'" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(w*.025)+'" font-weight="650" fill="#ffffff" opacity=".88">'+escapeXml(opts.subtitle)+'</text>'+
    lower+
    '<rect x="'+Math.round(w*.23)+'" y="'+Math.round(h*.915)+'" width="'+Math.round(w*.54)+'" height="'+Math.round(h*.055)+'" rx="'+Math.round(h*.0275)+'" fill="#F0CA6A"/>'+
    '<text x="'+c+'" y="'+Math.round(h*.952)+'" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(w*.023)+'" font-weight="950" fill="#071B3B">'+escapeXml(opts.cta)+'</text>'+
    '</svg>'
  );
}

function campaignMobileOverlay(format, opts) {
  const w=format.width,h=format.height,c=Math.round(w/2);
  const brand=opts.brandLabel || 'ARIANA';
  const main=opts.couponText || opts.badge;
  const top=opts.couponText ? 'USE O CUPOM' : opts.headline;

  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'">'+
    (opts.hasBrandLogo ? '' : '<text x="'+c+'" y="'+Math.round(h*.142)+'" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(w*.026)+'" font-weight="900" letter-spacing="2.5" fill="#ffffff">'+escapeXml('ESPECIAL '+brand)+'</text>')+
    '<text x="'+c+'" y="'+Math.round(h*.200)+'" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(w*.038)+'" font-weight="950" fill="#ffffff">'+escapeXml(top)+'</text>'+
    '<rect x="'+Math.round(w*.22)+'" y="'+Math.round(h*.220)+'" width="'+Math.round(w*.56)+'" height="'+Math.round(h*.074)+'" rx="'+Math.round(h*.037)+'" fill="#FFD51B"/>'+
    '<text x="'+c+'" y="'+Math.round(h*.270)+'" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(w*(main.length>16?.033:.043))+'" font-weight="950" fill="#08285A">'+escapeXml(main)+'</text>'+
    '<text x="'+c+'" y="'+Math.round(h*.325)+'" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(w*.024)+'" font-weight="650" fill="#ffffff">'+escapeXml(opts.subtitle)+'</text>'+
    (opts.showPrice
      ? '<text x="'+c+'" y="'+Math.round(h*.820)+'" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(w*.058)+'" font-weight="950" fill="#FFD51B">'+escapeXml(money(opts.cashPrice))+'</text>'
      : '')+
    pillSvg({x:Math.round(w*.055),y:Math.round(h*.875),w:Math.round(w*.285),h:Math.round(h*.056),fill:'#071D49',text:opts.installmentCount+'x cartão',textFill:'#ffffff',fs:Math.round(w*.019)})+
    pillSvg({x:Math.round(w*.357),y:Math.round(h*.875),w:Math.round(w*.285),h:Math.round(h*.056),fill:'#FFD51B',text:'TEMPO LIMITADO',textFill:'#08285A',fs:Math.round(w*.018)})+
    pillSvg({x:Math.round(w*.660),y:Math.round(h*.875),w:Math.round(w*.285),h:Math.round(h*.056),fill:'#ffffff',text:opts.cta,textFill:'#0047AB',fs:Math.round(w*.019)})+
    '</svg>'
  );
}

function overlayMobile(format, opts) {
  if (opts.template === 'premium') return premiumMobileOverlay(format, opts);
  if (opts.template === 'campaign') return campaignMobileOverlay(format, opts);
  return marketplaceMobileOverlay(format, opts);
}

async function productComposite(asset, format, comp, renderOptions = {}) {
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

  const softMarketplaceShadow = renderOptions.softMarketplaceShadow === true;
  const shadow = await sharp(product)
    .blur(Math.max(4, Math.round(Math.min(format.width, format.height) * (softMarketplaceShadow ? .010 : .014))))
    .tint('#00142F')
    .modulate({
      brightness: softMarketplaceShadow ? .52 : .35,
      saturation: softMarketplaceShadow ? .18 : .3
    })
    .png()
    .toBuffer();

  return {
    product,
    shadow,
    productLeft: left,
    productTop: top,
    shadowLeft: left + Math.round(format.width*(softMarketplaceShadow ? .004 : .008)),
    shadowTop: top + Math.round(format.height*(softMarketplaceShadow ? .010 : .018))
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

function quality(asset, opts, format, brandAsset = null, campaignBrandAsset = null) {
  const cutoutOk = Boolean(asset.backgroundRemoved && asset.cutoutSafe !== false);
  const resolutionLongEdge = asset.repairMetrics?.resolutionEnhanced
    ? Math.max(
        Number(asset.qualityWidth || asset.width || 0),
        Number(asset.qualityHeight || asset.height || 0)
      )
    : Math.max(asset.sourceWidth, asset.sourceHeight);
  const resolutionOk = resolutionLongEdge >= 700;
  const brandOk = Boolean(brandAsset?.backgroundRemoved && brandAsset?.transparentRatio >= .02);
  const manufacturerLogoRequested = Boolean(opts.brandLogoUrl);
  const manufacturerLogoOk = !manufacturerLogoRequested || Boolean(campaignBrandAsset?.backgroundRemoved);
  const repair = asset.repairMetrics || {};
  const internalBackgroundOk = repair.internalBackgroundOk !== false;
  const whiteHaloOk = repair.whiteHaloOk !== false;
  const thinStructureDamageOk = repair.thinStructureDamageOk !== false;

  const checks = [
    {
      id: 'brand',
      critical: true,
      ok: brandOk,
      label: brandOk ? 'Logo oficial Ariana com fundo transparente' : 'Logo oficial precisa de correção',
      detail: brandOk
        ? 'A identidade oficial será usada sem caixa preta.'
        : 'O banner final fica bloqueado até a logo oficial estar transparente.'
    },
    {
      id: 'manufacturer_logo',
      critical: true,
      ok: manufacturerLogoOk,
      label: manufacturerLogoRequested
        ? (manufacturerLogoOk ? 'Logo do fabricante tratada' : 'Logo do fabricante reprovada')
        : 'Logo do fabricante opcional',
      detail: manufacturerLogoRequested
        ? (manufacturerLogoOk ? 'A marca do fabricante será usada sem caixa de fundo.' : 'Envie PNG transparente ou uma logo com fundo simples.')
        : 'Nenhuma logo de fabricante foi informada.'
    },
    {
      id: 'cutout',
      critical: true,
      ok: cutoutOk,
      label: cutoutOk ? 'Recorte do produto aprovado' : 'Recorte do produto reprovado',
      detail: cutoutOk
        ? asset.removalMode
        : (
            asset.cutoutReason === 'possible_white_product_overcut'
              ? 'O fundo branco está invadindo áreas claras do produto. Envie PNG transparente ou outra foto.'
              : asset.cutoutReason === 'foreground_fragmented'
                ? 'O produto ficou fragmentado após o recorte. A arte final foi bloqueada.'
                : asset.cutoutReason === 'complex_background'
                  ? 'A foto possui fundo complexo. Use PNG transparente ou uma imagem oficial limpa.'
                  : 'O recorte automático não atingiu qualidade suficiente.'
          )
    },
    {
      id: 'internal_background_contamination',
      critical: true,
      ok: internalBackgroundOk,
      label: internalBackgroundOk ? 'Áreas vazadas sem fundo preso' : 'Fundo interno residual detectado',
      detail: internalBackgroundOk
        ? (repair.attempted
            ? 'Limpeza interna validada pelo Recorte Inteligente Pro.'
            : 'Nenhuma contaminação interna crítica foi detectada.')
        : 'Ainda existe fundo preso entre grades, pés ou outras áreas vazadas. A arte final foi bloqueada.'
    },
    {
      id: 'white_halo_residual',
      critical: true,
      ok: whiteHaloOk,
      label: whiteHaloOk ? 'Bordas sem halo branco crítico' : 'Halo branco residual detectado',
      detail: whiteHaloOk
        ? 'As bordas do produto passaram pela verificação de halo.'
        : 'O contorno ainda apresenta branco residual acima do limite seguro. A arte final foi bloqueada.'
    },
    {
      id: 'thin_structure_damage',
      critical: true,
      ok: thinStructureDamageOk,
      label: thinStructureDamageOk ? 'Peças finas preservadas' : 'Dano em grade ou estrutura fina detectado',
      detail: thinStructureDamageOk
        ? 'A continuidade da grade, pés e peças finas foi preservada.'
        : 'O recorte perdeu continuidade estrutural. A arte final foi bloqueada para não usar produto mastigado.'
    },
    {
      id: 'resolution',
      critical: true,
      ok: resolutionOk,
      label: resolutionOk ? 'Resolução adequada' : 'Imagem de origem pequena',
      detail: asset.repairMetrics?.resolutionEnhanced
        ? asset.sourceWidth + '×' + asset.sourceHeight + ' px • recorte tratado em ' + asset.width + '×' + asset.height
        : asset.sourceWidth + '×' + asset.sourceHeight + ' px'
    },
    {
      id: 'pricing',
      critical: false,
      ok: !opts.showPrice || opts.cashPrice > 0,
      label: opts.showPrice ? 'Preço preenchido' : 'Layout sem preço ativado',
      detail: opts.showPrice ? money(opts.cashPrice) : 'Preço não é obrigatório neste modo.'
    },
    {
      id: 'format',
      critical: false,
      ok: true,
      label: 'Composição própria para ' + (format.device === 'mobile' ? 'celular' : 'desktop'),
      detail: format.width + '×' + format.height
    }
  ];

  const criticalFailed = checks.filter(item => item.critical && !item.ok);
  const score = Math.round(checks.filter(item => item.ok).length / checks.length * 100);
  return {
    score,
    checks,
    blockSave: criticalFailed.length > 0,
    criticalFailures: criticalFailed.map(item => item.id)
  };
}

export async function prepareProProductAsset(product = {}, options = {}) {
  const directBuffer =
    Buffer.isBuffer(product?.originalBuffer)
      ? product.originalBuffer
      : Buffer.isBuffer(options?.originalBuffer)
        ? options.originalBuffer
        : null;
  const source = productImage(product, options);
  if (!directBuffer && !source) throw new Error('product_image_required');
  const raw = directBuffer || await loadImage(source);
  if (!raw) throw new Error('product_image_unavailable');
  const productText = productCategoryText(product);
  const baseAsset = await removeConnectedBackground(
    raw,
    options.removeBackground !== false && options.removeLightBackground !== false,
    productText
  );
  const repaired = await repairCreativeProductCutout(baseAsset, productText, raw, source);
  return {
    ...repaired,
    sourceType: directBuffer
      ? String(product.sourceType || 'creative_cutout_bank_original')
      : product.originalSourcePath
        ? 'direct_original_upload'
        : String(product.sourceType || 'remote_or_catalog'),
    sourceOriginalName: String(product.originalSourceName || ''),
    sourceOriginalMimeType: String(product.originalSourceMimeType || ''),
    sourceOriginalBytes: Number(product.originalSourceBytes || raw.length || 0)
  };
}

export async function analyzeCreativeBannerPro(product = {}, options = {}) {
  const opts = normalizedOptions(product, options);
  const asset = await prepareProProductAsset(product, opts);
  const brandAsset = await prepareOfficialLogoAsset();
  const campaignBrandAsset = opts.brandLogoUrl ? await prepareCampaignBrandLogo(opts.brandLogoUrl) : null;
  opts.hasBrandLogo = Boolean(campaignBrandAsset?.backgroundRemoved);
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
      backgroundConfidence: Number(asset.confidence.toFixed(3)),
      cutoutSafe: Boolean(asset.cutoutSafe),
      cutoutReason: asset.cutoutReason || '',
      shape: asset.shape || null,
      repair: asset.repairMetrics || null,
      qualityWidth: Number(asset.qualityWidth || asset.width || 0),
      qualityHeight: Number(asset.qualityHeight || asset.height || 0)
    },
    brand: {
      backgroundRemoved: Boolean(brandAsset.backgroundRemoved),
      transparentRatio: Number(brandAsset.transparentRatio.toFixed(4))
    },
    manufacturerBrand: campaignBrandAsset ? {
      backgroundRemoved: Boolean(campaignBrandAsset.backgroundRemoved),
      removalMode: campaignBrandAsset.removalMode,
      removedRatio: Number(campaignBrandAsset.removedRatio || 0)
    } : null,
    quality: quality(asset, opts, opts.format, brandAsset, campaignBrandAsset)
  };
}

export async function generateCreativeBannerPro(product = {}, options = {}) {
  const opts = normalizedOptions(product, options);
  const format = opts.format;
  const renderFormat = highQualityRenderFormat(format, opts);
  const asset = await prepareProProductAsset(product, opts);
  const brandAsset = await prepareOfficialLogoAsset();
  const campaignBrandAsset = opts.brandLogoUrl ? await prepareCampaignBrandLogo(opts.brandLogoUrl) : null;
  opts.hasBrandLogo = Boolean(campaignBrandAsset?.backgroundRemoved);
  const comp = composition(renderFormat, asset, opts);
  const productLayer = await productComposite(
    asset,
    renderFormat,
    comp,
    { softMarketplaceShadow: opts.generationStyle === 'marketplace' }
  );

  const layers = [
    { input: backgroundSvg(renderFormat, opts.template), left: 0, top: 0 }
  ];

  const logo = await logoLayer(renderFormat, brandAsset);
  if (logo) layers.push(logo);
  if (opts.template === 'campaign' && campaignBrandAsset?.backgroundRemoved) {
    const manufacturerLogo = await campaignBrandLogoLayer(renderFormat, campaignBrandAsset);
    if (manufacturerLogo) layers.push(manufacturerLogo);
  }

  if (!asset.backgroundRemoved) {
    layers.push({ input: fallbackPanelSvg(renderFormat, comp, opts.template), left: 0, top: 0 });
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
    input: renderFormat.device === 'mobile' ? overlayMobile(renderFormat, opts) : overlayDesktop(renderFormat, opts),
    left: 0,
    top: 0
  });

  const buffer = await finalizeBannerBuffer(
    layers,
    renderFormat,
    format,
    opts.generationStyle === 'marketplace'
  );

  return {
    buffer,
    meta: {
      format,
      template: opts.template,
      showPrice: opts.showPrice,
      renderQuality: opts.generationStyle === 'marketplace' ? 'supersampled_2x_lanczos3_sharpen' : 'standard',
      renderScale: opts.generationStyle === 'marketplace' ? 2 : 1,
      product: {
        sourceWidth: asset.sourceWidth,
        sourceHeight: asset.sourceHeight,
        width: asset.width,
        height: asset.height,
        orientation: comp.orientation,
        backgroundRemoved: asset.backgroundRemoved,
        removalMode: asset.removalMode,
        removedRatio: Number(asset.removedRatio.toFixed(4)),
        backgroundConfidence: Number(asset.confidence.toFixed(3)),
        cutoutSafe: Boolean(asset.cutoutSafe),
        cutoutReason: asset.cutoutReason || '',
        shape: asset.shape || null,
        repair: asset.repairMetrics || null
      },
      brand: {
        backgroundRemoved: Boolean(brandAsset.backgroundRemoved),
        transparentRatio: Number(brandAsset.transparentRatio.toFixed(4))
      },
      manufacturerBrand: campaignBrandAsset ? {
        backgroundRemoved: Boolean(campaignBrandAsset.backgroundRemoved),
        removalMode: campaignBrandAsset.removalMode,
        removedRatio: Number(campaignBrandAsset.removedRatio || 0)
      } : null,
      quality: quality(asset, opts, format, brandAsset, campaignBrandAsset)
    }
  };
}


function multiProductSlots(format, count = 2, opts = {}) {
  const n = clamp(Math.round(Number(count) || 2), 2, 5);
  const mobile = format.device === 'mobile';
  const marketplaceMode = opts.generationStyle === 'marketplace';
  const grammar = marketplaceMode ? resolveMarketplaceGrammar(opts.layoutGrammar, opts.marketplacePreset) : 'A';

  if (marketplaceMode && !mobile && grammar === 'A') {
    // Marketplace Ariana refinado: 1 herói realmente dominante + 2 apoios
    // próximos, formando um conjunto comercial coeso sem invadir a área de texto.
    if (n === 2) return [{ x:.655,y:.105,w:.235,h:.745 },{ x:.815,y:.285,w:.145,h:.535 }];
    if (n === 3) return [{ x:.655,y:.055,w:.245,h:.815 },{ x:.555,y:.305,w:.145,h:.525 },{ x:.825,y:.315,w:.135,h:.505 }];
    if (n === 4) return [{ x:.650,y:.075,w:.225,h:.785 },{ x:.535,y:.330,w:.135,h:.485 },{ x:.825,y:.315,w:.125,h:.500 },{ x:.885,y:.395,w:.095,h:.405 }];
  }

  if (marketplaceMode && !mobile && grammar === 'B') {
    if (n === 2) return [{ x:.29,y:.43,w:.25,h:.45 },{ x:.52,y:.43,w:.25,h:.45 }];
    if (n === 3) return [{ x:.39,y:.32,w:.25,h:.56 },{ x:.20,y:.47,w:.20,h:.38 },{ x:.62,y:.48,w:.19,h:.37 }];
    if (n === 4) return [{ x:.16,y:.49,w:.18,h:.34 },{ x:.32,y:.38,w:.21,h:.46 },{ x:.51,y:.38,w:.21,h:.46 },{ x:.69,y:.49,w:.17,h:.34 }];
  }
  if (marketplaceMode && !mobile && grammar === 'C') {
    if (n === 2) return [{ x:.51,y:.35,w:.22,h:.49 },{ x:.72,y:.35,w:.22,h:.49 }];
    if (n === 3) return [{ x:.62,y:.27,w:.22,h:.60 },{ x:.48,y:.45,w:.17,h:.39 },{ x:.81,y:.46,w:.15,h:.37 }];
  }
  if (marketplaceMode && !mobile && grammar === 'D') {
    if (n === 2) return [{ x:.60,y:.18,w:.19,h:.68 },{ x:.78,y:.27,w:.16,h:.57 }];
    if (n === 3) return [{ x:.68,y:.13,w:.20,h:.73 },{ x:.56,y:.36,w:.15,h:.48 },{ x:.84,y:.39,w:.12,h:.44 }];
  }
  if (marketplaceMode && !mobile && grammar === 'E') {
    const start = n === 2 ? .48 : n === 3 ? .43 : .40;
    const cardW = n === 2 ? .22 : n === 3 ? .17 : .14;
    return Array.from({length:n},(_,i)=>({ x:start+i*(cardW+.025), y:.35, w:cardW, h:.45 }));
  }

  if (mobile) {
    if (format.id === 'square') {
      if (n === 2) return [
        { x:.22, y:.43, w:.32, h:.34 },
        { x:.52, y:.43, w:.32, h:.34 }
      ];
      if (n === 3) return [
        { x:.35, y:.39, w:.31, h:.39 },
        { x:.11, y:.49, w:.25, h:.28 },
        { x:.66, y:.50, w:.23, h:.27 }
      ];
      if (n === 4) return [
        { x:.07, y:.50, w:.22, h:.26 },
        { x:.26, y:.42, w:.25, h:.34 },
        { x:.49, y:.42, w:.25, h:.34 },
        { x:.71, y:.50, w:.22, h:.26 }
      ];
      return [
        { x:.05, y:.52, w:.19, h:.24 },
        { x:.20, y:.46, w:.22, h:.30 },
        { x:.39, y:.40, w:.25, h:.36 },
        { x:.61, y:.46, w:.22, h:.30 },
        { x:.77, y:.52, w:.18, h:.24 }
      ];
    }

    if (n === 2) return [
      { x:.16, y:.38, w:.34, h:.36 },
      { x:.50, y:.38, w:.34, h:.36 }
    ];
    if (n === 3) return [
      { x:.34, y:.35, w:.34, h:.40 },
      { x:.09, y:.45, w:.29, h:.30 },
      { x:.64, y:.46, w:.27, h:.29 }
    ];
    if (n === 4) return [
      { x:.06, y:.43, w:.26, h:.30 },
      { x:.27, y:.36, w:.28, h:.37 },
      { x:.50, y:.36, w:.28, h:.37 },
      { x:.71, y:.43, w:.24, h:.30 }
    ];
    return [
      { x:.06, y:.45, w:.22, h:.27 },
      { x:.22, y:.38, w:.25, h:.34 },
      { x:.39, y:.33, w:.29, h:.39 },
      { x:.61, y:.38, w:.25, h:.34 },
      { x:.76, y:.45, w:.20, h:.27 }
    ];
  }

  if (n === 2) return [
    { x:.57, y:.15, w:.20, h:.70 },
    { x:.76, y:.15, w:.20, h:.70 }
  ];
  if (n === 3) return [
    // 1 herói + 2 apoios: bloco mais compacto e visualmente centralizado.
    { x:.665, y:.085, w:.215, h:.765 },
    { x:.570, y:.310, w:.150, h:.520 },
    { x:.815, y:.340, w:.125, h:.480 }
  ];
  if (n === 4) return [
    { x:.53, y:.28, w:.14, h:.54 },
    { x:.64, y:.16, w:.16, h:.66 },
    { x:.76, y:.16, w:.16, h:.66 },
    { x:.87, y:.28, w:.11, h:.54 }
  ];
  return [
    { x:.52, y:.30, w:.13, h:.50 },
    { x:.61, y:.19, w:.15, h:.62 },
    { x:.70, y:.10, w:.18, h:.72 },
    { x:.82, y:.19, w:.14, h:.62 },
    { x:.90, y:.30, w:.09, h:.50 }
  ];
}


function multiShowcaseStageSvg(format, count = 3, opts = {}) {
  const w=format.width,h=format.height;
  const mobile=format.device==='mobile';
  const marketplaceMode = opts.generationStyle === 'marketplace';
  const grammar = marketplaceMode ? resolveMarketplaceGrammar(opts.layoutGrammar, opts.marketplacePreset) : 'A';

  if (marketplaceMode && grammar === 'E') {
    const n = clamp(Math.round(Number(count) || 3), 2, 5);
    const desktop = !mobile;
    const startX = desktop ? (n === 2 ? 0.46 : n === 3 ? 0.41 : 0.38) : 0.07;
    const cardW = desktop ? (n === 2 ? 0.245 : n === 3 ? 0.185 : 0.145) : ((0.86 - (n - 1) * 0.025) / n);
    const gap = 0.025;
    const top = desktop ? 0.30 : 0.43;
    const cardH = desktop ? 0.57 : 0.34;
    const cards = Array.from({ length: n }, (_, i) => {
      const x = Math.round(w * (startX + i * (cardW + gap)));
      return '<rect x="' + x + '" y="' + Math.round(h * top) + '" width="' + Math.round(w * cardW) + '" height="' + Math.round(h * cardH) + '" rx="' + Math.round(Math.min(w,h) * 0.018) + '" fill="#ffffff" fill-opacity=".075" stroke="#ffffff" stroke-opacity=".13" stroke-width="2"/>';
    }).join('');
    return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' + cards + '</svg>');
  }

  // Base propositalmente discreta: nada de aro, elipse ou palco amarelo.
  // Apenas uma sombra suave para assentar visualmente os produtos no fundo.
  if(mobile){
    return Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'">'+
      '<defs><filter id="sg" x="-30%" y="-200%" width="160%" height="500%"><feGaussianBlur stdDeviation="'+Math.max(8,Math.round(h*.020))+'"/></filter></defs>'+
      '<ellipse cx="'+Math.round(w*.50)+'" cy="'+Math.round(h*.690)+'" rx="'+Math.round(w*.34)+'" ry="'+Math.round(h*.025)+'" fill="#001B4D" opacity=".34" filter="url(#sg)"/>'+
      '<ellipse cx="'+Math.round(w*.50)+'" cy="'+Math.round(h*.682)+'" rx="'+Math.round(w*.28)+'" ry="'+Math.round(h*.012)+'" fill="#ffffff" opacity=".08"/>'+
      '</svg>'
    );
  }

  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'">'+
    '<defs><filter id="sg" x="-30%" y="-220%" width="160%" height="540%"><feGaussianBlur stdDeviation="'+Math.max(8,Math.round(h*.018))+'"/></filter></defs>'+
    '<ellipse cx="'+Math.round(w*.79)+'" cy="'+Math.round(h*.835)+'" rx="'+Math.round(w*.205)+'" ry="'+Math.round(h*.030)+'" fill="#00163D" opacity=".38" filter="url(#sg)"/>'+
    '<ellipse cx="'+Math.round(w*.79)+'" cy="'+Math.round(h*.826)+'" rx="'+Math.round(w*.165)+'" ry="'+Math.round(h*.012)+'" fill="#ffffff" opacity=".07"/>'+
    '</svg>'
  );
}

function marketplaceArianaPolishSvg(format, opts = {}) {
  if (opts.generationStyle !== 'marketplace') return null;

  const w = format.width;
  const h = format.height;
  const mobile = format.device === 'mobile';
  const grammar = resolveMarketplaceGrammar(opts.layoutGrammar, opts.marketplacePreset);

  // Camada exclusivamente visual do modo Marketplace Ariana.
  // Não toca em recorte, qualidade, preços ou regras comerciais.
  const heroCx = mobile ? .52 : (grammar === 'B' ? .50 : grammar === 'C' ? .72 : grammar === 'D' ? .76 : .78);
  const heroCy = mobile ? .61 : .52;
  const beamOpacity = grammar === 'D' ? .10 : .16;
  const sweepOpacity = grammar === 'D' ? .08 : .12;

  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'">'+
    '<defs>'+
      '<radialGradient id="mpHeroGlow" cx="'+Math.round(heroCx*100)+'%" cy="'+Math.round(heroCy*100)+'%" r="48%">'+
        '<stop offset="0" stop-color="#5DB8FF" stop-opacity=".24"/>'+
        '<stop offset=".52" stop-color="#1B73D8" stop-opacity=".10"/>'+
        '<stop offset="1" stop-color="#003A8E" stop-opacity="0"/>'+
      '</radialGradient>'+
      '<linearGradient id="mpBlueVeil" x1="0" y1="0" x2="1" y2="0">'+
        '<stop offset="0" stop-color="#0047AB" stop-opacity="0"/>'+
        '<stop offset=".45" stop-color="#0047AB" stop-opacity=".06"/>'+
        '<stop offset="1" stop-color="#00357F" stop-opacity=".22"/>'+
      '</linearGradient>'+
      '<filter id="mpSoft"><feGaussianBlur stdDeviation="'+Math.max(5,Math.round(h*.012))+'"/></filter>'+
    '</defs>'+
    '<rect width="100%" height="100%" fill="url(#mpHeroGlow)"/>'+
    // suaviza a dominância visual da faixa amarela no centro sem removê-la
    (!mobile
      ? '<path d="M'+Math.round(w*.615)+' 0 L'+Math.round(w*.715)+' 0 L'+Math.round(w*.640)+' '+h+' L'+Math.round(w*.535)+' '+h+' Z" fill="#0047AB" opacity="'+beamOpacity+'"/>'
      : '')+
    '<rect x="'+Math.round(w*.48)+'" y="0" width="'+Math.round(w*.52)+'" height="'+h+'" fill="url(#mpBlueVeil)"/>'+
    // linhas de movimento muito discretas: leitura de varejo, sem virar efeito chamativo
    '<path d="M'+Math.round(w*.18)+' '+Math.round(h*.56)+' C'+Math.round(w*.38)+' '+Math.round(h*.45)+' '+Math.round(w*.58)+' '+Math.round(h*.48)+' '+Math.round(w*.90)+' '+Math.round(h*.33)+'" fill="none" stroke="#ffffff" stroke-opacity="'+sweepOpacity+'" stroke-width="'+Math.max(2,Math.round(h*.006))+'" filter="url(#mpSoft)"/>'+
    '<path d="M'+Math.round(w*.24)+' '+Math.round(h*.64)+' C'+Math.round(w*.43)+' '+Math.round(h*.54)+' '+Math.round(w*.64)+' '+Math.round(h*.57)+' '+Math.round(w*.94)+' '+Math.round(h*.43)+'" fill="none" stroke="#ffffff" stroke-opacity="'+(sweepOpacity*.72).toFixed(3)+'" stroke-width="'+Math.max(1,Math.round(h*.004))+'" filter="url(#mpSoft)"/>'+
    '</svg>'
  );
}

function multiCampaignOverlay(format, opts, count = 2) {
  const mobile = format.device === 'mobile';
  const marketplaceMode = opts.generationStyle === 'marketplace';
  const grammar = marketplaceMode ? resolveMarketplaceGrammar(opts.layoutGrammar, opts.marketplacePreset) : 'A';
  if (marketplaceMode && ['B','C','D','E'].includes(grammar)) {
    const w=format.width,h=format.height;
    const accent = grammar === 'D' ? '#F0CA6A' : '#FFD51B';
    const headline=clean(opts.headline,72);
    const support=clean(opts.subtitle,120);
    const topLabel=clean(opts.badge,42);
    const cta=clean(opts.cta,42);
    const premium = grammar === 'D';

    if (mobile) {
      const cx=Math.round(w*.5);
      const titleY=Math.round(h*(grammar==='E'?.18:.20));
      return Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'">'+
        (topLabel?'<text x="'+cx+'" y="'+Math.round(h*.12)+'" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(w*.021)+'" font-weight="900" letter-spacing="2" fill="'+accent+'">'+escapeXml(topLabel)+'</text>':'')+
        linesSvg(wrap(headline,24,2),{x:cx,y:titleY,size:Math.round(w*.048),lineHeight:Math.round(w*.052),fill:'#ffffff',weight:950,anchor:'middle'})+
        '<text x="'+cx+'" y="'+Math.round(h*.31)+'" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(w*.020)+'" font-weight="650" fill="#ffffff" opacity=".88">'+escapeXml(support)+'</text>'+
        '<line x1="'+Math.round(w*.30)+'" y1="'+Math.round(h*.88)+'" x2="'+Math.round(w*.70)+'" y2="'+Math.round(h*.88)+'" stroke="'+accent+'" stroke-opacity=".75" stroke-width="2"/>'+
        '<text x="'+cx+'" y="'+Math.round(h*.925)+'" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(w*.018)+'" font-weight="900" fill="#ffffff">'+escapeXml(cta)+' →</text>'+
        '</svg>'
      );
    }

    if (grammar === 'B') {
      const cx=Math.round(w*.50);
      return Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'">'+
        (topLabel?'<text x="'+cx+'" y="'+Math.round(h*.15)+'" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(h*.030)+'" font-weight="900" letter-spacing="2.4" fill="'+accent+'">'+escapeXml(topLabel)+'</text>':'')+
        linesSvg(wrap(headline,38,2),{x:cx,y:Math.round(h*.29),size:Math.round(h*.090),lineHeight:Math.round(h*.092),fill:'#ffffff',weight:950,anchor:'middle'})+
        '<text x="'+cx+'" y="'+Math.round(h*.46)+'" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(h*.035)+'" font-weight="700" fill="#ffffff" opacity=".88">'+escapeXml(support)+'</text>'+
        '<text x="'+Math.round(w*.055)+'" y="'+Math.round(h*.91)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(h*.030)+'" font-weight="900" fill="#ffffff">'+escapeXml(cta)+' →</text>'+
        '</svg>'
      );
    }

    if (grammar === 'C') {
      const x=Math.round(w*.055);
      return Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'">'+
        (topLabel?'<text x="'+x+'" y="'+Math.round(h*.16)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(h*.030)+'" font-weight="900" letter-spacing="2.2" fill="'+accent+'">'+escapeXml(topLabel)+'</text>':'')+
        linesSvg(wrap(headline,46,2),{x,y:Math.round(h*.31),size:Math.round(h*.092),lineHeight:Math.round(h*.094),fill:'#ffffff',weight:950})+
        '<text x="'+x+'" y="'+Math.round(h*.52)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(h*.035)+'" font-weight="700" fill="#ffffff" opacity=".88">'+escapeXml(support)+'</text>'+
        '<line x1="'+x+'" y1="'+Math.round(h*.88)+'" x2="'+Math.round(w*.36)+'" y2="'+Math.round(h*.88)+'" stroke="'+accent+'" stroke-width="3" stroke-opacity=".78"/>'+
        '<text x="'+x+'" y="'+Math.round(h*.945)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(h*.030)+'" font-weight="900" fill="#ffffff">'+escapeXml(cta)+' →</text>'+
        '</svg>'
      );
    }

    if (grammar === 'D') {
      const x=Math.round(w*.055);
      return Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'">'+
        '<line x1="'+x+'" y1="'+Math.round(h*.19)+'" x2="'+Math.round(w*.20)+'" y2="'+Math.round(h*.19)+'" stroke="'+accent+'" stroke-width="3" stroke-opacity=".85"/>'+
        (topLabel?'<text x="'+x+'" y="'+Math.round(h*.29)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(h*.027)+'" font-weight="850" letter-spacing="3" fill="'+accent+'">'+escapeXml(topLabel)+'</text>':'')+
        linesSvg(wrap(headline,30,2),{x,y:Math.round(h*.43),size:Math.round(h*.084),lineHeight:Math.round(h*.088),fill:'#ffffff',weight:900})+
        '<text x="'+x+'" y="'+Math.round(h*.65)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(h*.033)+'" font-weight="600" fill="#ffffff" opacity=".82">'+escapeXml(support)+'</text>'+
        '<text x="'+x+'" y="'+Math.round(h*.88)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(h*.028)+'" font-weight="850" fill="'+accent+'">'+escapeXml(cta)+' →</text>'+
        '</svg>'
      );
    }

    const x=Math.round(w*.055);
    return Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'">'+
      (topLabel?'<text x="'+x+'" y="'+Math.round(h*.16)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(h*.029)+'" font-weight="900" letter-spacing="2.2" fill="'+accent+'">'+escapeXml(topLabel)+'</text>':'')+
      linesSvg(wrap(headline,34,2),{x,y:Math.round(h*.31),size:Math.round(h*.088),lineHeight:Math.round(h*.090),fill:'#ffffff',weight:950})+
      '<text x="'+x+'" y="'+Math.round(h*.53)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(h*.033)+'" font-weight="700" fill="#ffffff" opacity=".86">'+escapeXml(support)+'</text>'+
      '<text x="'+x+'" y="'+Math.round(h*.91)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(h*.028)+'" font-weight="900" fill="#ffffff">'+escapeXml(cta)+' →</text>'+
      '</svg>'
    );
  }
  const template = resolveProTemplate(opts.template);
  const accent = template === 'premium' ? '#F0CA6A' : '#FFD51B';
  const titleFill = '#ffffff';
  const supportOpacity = template === 'premium' ? '.84' : '.90';
  const brand = String(opts.brandLabel || '').trim();
  const brandCampaign = Boolean(opts.hasBrandLogo || brand);
  // A copy já foi resolvida em normalizedOptions. Não criar uma segunda camada
  // de fallback aqui: o que chegou do editor precisa ser a fonte final do PNG.
  const headline = clean(opts.headline, 72);
  const support = clean(opts.subtitle, 120);
  const topLabel = clean(opts.badge, 42);
  const promo = clean(opts.promoText || '', 46);
  const cta = clean(opts.cta, 42);
  const installment = clamp(Number(opts.installmentCount || 12), 1, 24);
  const coupon = clean(opts.couponText || '', 26);
  const showCommercialInfo = opts.showCommercialInfo === true;

  if (mobile && format.id === 'square') {
    const w = format.width;
    const h = format.height;
    const x = Math.round(w*.075);
    const textW = Math.round(w*.62);
    const titleFs = Math.round(w * (headline.length > 42 ? .044 : headline.length > 30 ? .049 : .054));
    const titleLines = wrap(headline, Math.max(19, Math.floor(textW / Math.max(1,titleFs*.54))), 2);
    const titleY = Math.round(h*.195);
    const titleLineHeight = Math.round(titleFs*1.03);
    const supportFs = Math.round(w*.022);
    const supportY = titleY + Math.max(0,titleLines.length-1)*titleLineHeight + Math.round(h*.068);
    const infoY = Math.round(h*.842);

    return Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'">'+
      (topLabel
        ? '<text x="'+x+'" y="'+Math.round(h*.135)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(w*.020)+'" font-weight="900" letter-spacing="2.2" fill="'+accent+'">'+escapeXml(topLabel)+'</text>'
        : '')+
      linesSvg(titleLines,{
        x,
        y:titleY,
        size:titleFs,
        lineHeight:titleLineHeight,
        fill:'#ffffff',
        weight:950,
        anchor:'start',
        letterSpacing:-0.4
      })+
      '<text x="'+x+'" y="'+supportY+'" font-family="Arial,Helvetica,sans-serif" font-size="'+supportFs+'" font-weight="700" fill="#ffffff" opacity="'+supportOpacity+'">'+escapeXml(support)+'</text>'+
      (coupon
        ? '<text x="'+x+'" y="'+Math.round(h*.335)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(w*.019)+'" font-weight="850" fill="#ffffff">USE O CUPOM</text>'+
          '<text x="'+x+'" y="'+Math.round(h*.380)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(w*.034)+'" font-weight="950" fill="'+accent+'">'+escapeXml(coupon)+'</text>'
        : '')+
      '<line x1="'+x+'" y1="'+Math.round(infoY-h*.020)+'" x2="'+Math.round(x+textW*.72)+'" y2="'+Math.round(infoY-h*.020)+'" stroke="'+accent+'" stroke-opacity=".72" stroke-width="2"/>'+
      '<text x="'+x+'" y="'+Math.round(infoY+h*.025)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(w*.020)+'" font-weight="900" letter-spacing="1.0" fill="#ffffff">'+escapeXml(cta)+' →</text>'+
      '</svg>'
    );
  }

  if (mobile) {
    const w = format.width;
    const h = format.height;
    const cx = Math.round(w / 2);
    const titleY = brandCampaign ? Math.round(h*.205) : Math.round(h*.195);
    const supportY = Math.round(h*.315);
    const infoY = Math.round(h*.815);

    let footer = '';
    if (showCommercialInfo) {
      footer =
        '<g font-family="Arial,Helvetica,sans-serif">'+
          '<text x="'+Math.round(w*.10)+'" y="'+infoY+'" font-size="'+Math.round(w*.030)+'" font-weight="950" fill="'+accent+'">'+installment+'x</text>'+
          '<text x="'+Math.round(w*.10)+'" y="'+Math.round(infoY+h*.026)+'" font-size="'+Math.round(w*.0145)+'" font-weight="800" fill="#ffffff">SEM JUROS NO CARTÃO</text>'+
          '<line x1="'+Math.round(w*.39)+'" y1="'+Math.round(infoY-h*.026)+'" x2="'+Math.round(w*.39)+'" y2="'+Math.round(infoY+h*.034)+'" stroke="#ffffff" stroke-opacity=".38" stroke-width="2"/>'+
          (promo ? '<text x="'+Math.round(w*.44)+'" y="'+Math.round(infoY-h*.002)+'" font-size="'+Math.round(w*.017)+'" font-weight="900" fill="'+accent+'">'+escapeXml(promo)+'</text>' : '')+
          '<line x1="'+Math.round(w*.70)+'" y1="'+Math.round(infoY-h*.026)+'" x2="'+Math.round(w*.70)+'" y2="'+Math.round(infoY+h*.034)+'" stroke="#ffffff" stroke-opacity=".38" stroke-width="2"/>'+
          '<text x="'+Math.round(w*.75)+'" y="'+Math.round(infoY-h*.002)+'" font-size="'+Math.round(w*.017)+'" font-weight="900" fill="#ffffff">'+escapeXml(cta)+' →</text>'+
        '</g>';
    } else {
      footer =
        '<g font-family="Arial,Helvetica,sans-serif">'+
          '<line x1="'+Math.round(w*.20)+'" y1="'+Math.round(infoY-h*.010)+'" x2="'+Math.round(w*.80)+'" y2="'+Math.round(infoY-h*.010)+'" stroke="'+accent+'" stroke-opacity=".70" stroke-width="2"/>'+
          '<text x="'+cx+'" y="'+Math.round(infoY+h*.030)+'" text-anchor="middle" font-size="'+Math.round(w*.017)+'" font-weight="900" letter-spacing="1.4" fill="#ffffff">'+escapeXml(cta)+' →</text>'+
        '</g>';
    }

    return Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'">'+
      (topLabel
        ? '<text x="'+cx+'" y="'+Math.round(h*.135)+'" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(w*.021)+'" font-weight="900" letter-spacing="2.4" fill="'+accent+'">'+escapeXml(topLabel)+'</text>'
        : '')+
      linesSvg(wrap(headline,22,2),{
        x:cx,
        y:titleY,
        size:Math.round(w*.049),
        lineHeight:Math.round(w*.054),
        fill:'#ffffff',
        weight:950,
        anchor:'middle'
      })+
      '<text x="'+cx+'" y="'+supportY+'" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(w*.021)+'" font-weight="650" fill="#ffffff" opacity="'+supportOpacity+'">'+escapeXml(support)+'</text>'+
      (coupon
        ? '<text x="'+cx+'" y="'+Math.round(h*.365)+'" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(w*.019)+'" font-weight="850" fill="#ffffff">USE O CUPOM</text>'+
          '<text x="'+cx+'" y="'+Math.round(h*.415)+'" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(w*.038)+'" font-weight="950" fill="'+accent+'">'+escapeXml(coupon)+'</text>'
        : '')+
      footer+
      '</svg>'
    );
  }

  const w = format.width;
  const h = format.height;

  // Hierarquia editorial de marketplace: título dominante, apoio legível
  // e CTA integrado ao grid, sem cápsulas ou botões desenhados.
  const x = Math.round(w*.055);
  const textW = Math.round(w*.385);
  const topY = Math.round(h*.205);
  const headlineFs = Math.round(h * (
    headline.length > 54 ? .082 :
    headline.length > 42 ? .092 :
    headline.length > 30 ? .104 :
    .116
  ));
  const headlineChars = clamp(
    Math.floor(textW / Math.max(1, headlineFs * .54)),
    22,
    31
  );
  const headlineLines = wrap(headline, headlineChars, 2);
  const headlineLineHeight = Math.round(headlineFs * 1.01);
  const titleY = topLabel ? Math.round(h*.340) : Math.round(h*.285);
  const supportFs = Math.round(h*.040);
  const supportChars = clamp(
    Math.floor(textW / Math.max(1, supportFs * .51)),
    40,
    64
  );
  const supportLines = wrap(support, supportChars, 2);
  const supportY = Math.round(
    titleY +
    Math.max(0, headlineLines.length - 1) * headlineLineHeight +
    h*.078
  );
  const supportLineHeight = Math.round(supportFs * 1.32);
  const infoY = Math.round(h*.845);

  let footer = '';
  if (showCommercialInfo) {
    footer =
      '<g font-family="Arial,Helvetica,sans-serif">'+
        '<text x="'+x+'" y="'+infoY+'" font-size="'+Math.round(h*.052)+'" font-weight="950" fill="'+accent+'">'+installment+'x</text>'+
        '<text x="'+x+'" y="'+Math.round(infoY+h*.050)+'" font-size="'+Math.round(h*.020)+'" font-weight="850" fill="#ffffff">SEM JUROS NO CARTÃO</text>'+
        '<line x1="'+Math.round(w*.178)+'" y1="'+Math.round(infoY-h*.045)+'" x2="'+Math.round(w*.178)+'" y2="'+Math.round(infoY+h*.058)+'" stroke="#ffffff" stroke-opacity=".35" stroke-width="'+Math.max(1,Math.round(h*.004))+'"/>'+
        (promo ? '<text x="'+Math.round(w*.200)+'" y="'+Math.round(infoY+h*.010)+'" font-size="'+Math.round(h*.025)+'" font-weight="900" fill="'+accent+'">'+escapeXml(promo)+'</text>' : '')+
        '<line x1="'+Math.round(w*.390)+'" y1="'+Math.round(infoY-h*.045)+'" x2="'+Math.round(w*.390)+'" y2="'+Math.round(infoY+h*.058)+'" stroke="#ffffff" stroke-opacity=".35" stroke-width="'+Math.max(1,Math.round(h*.004))+'"/>'+
        '<text x="'+Math.round(w*.412)+'" y="'+Math.round(infoY+h*.010)+'" font-size="'+Math.round(h*.025)+'" font-weight="900" fill="#ffffff">'+escapeXml(cta)+' →</text>'+
      '</g>';
  } else {
    const ruleEnd = Math.round(x + textW*.72);
    footer =
      '<g font-family="Arial,Helvetica,sans-serif">'+
        '<line x1="'+x+'" y1="'+Math.round(infoY-h*.038)+'" x2="'+ruleEnd+'" y2="'+Math.round(infoY-h*.038)+'" stroke="'+accent+'" stroke-opacity=".72" stroke-width="'+Math.max(2,Math.round(h*.005))+'"/>'+
        '<text x="'+x+'" y="'+Math.round(infoY+h*.025)+'" font-size="'+Math.round(h*.034)+'" font-weight="900" letter-spacing="1.1" fill="#ffffff">'+escapeXml(cta)+' →</text>'+
      '</g>';
  }

  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'">'+
    (topLabel
      ? '<text x="'+x+'" y="'+topY+'" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(h*.031)+'" font-weight="900" letter-spacing="2.6" fill="'+accent+'">'+escapeXml(topLabel)+'</text>'
      : '')+
    linesSvg(headlineLines,{
      x,
      y:titleY,
      size:headlineFs,
      lineHeight:headlineLineHeight,
      fill:'#ffffff',
      weight:950,
      letterSpacing:-0.8
    })+
    linesSvg(supportLines,{
      x,
      y:supportY,
      size:supportFs,
      lineHeight:supportLineHeight,
      fill:'#ffffff',
      weight:700,
      letterSpacing:0
    })+
    (coupon
      ? '<text x="'+x+'" y="'+Math.round(h*.675)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(h*.025)+'" font-weight="850" fill="#ffffff">USE O CUPOM</text>'+
        '<text x="'+x+'" y="'+Math.round(h*.748)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+Math.round(h*.062)+'" font-weight="950" fill="'+accent+'">'+escapeXml(coupon)+'</text>'
      : '')+
    footer+
    '</svg>'
  );
}

function multiQuality(assets = [], brandAsset = null, format = {}, opts = {}, campaignBrandAsset = null) {
  const brandOk = Boolean(brandAsset?.backgroundRemoved && brandAsset?.transparentRatio >= .02);
  const manufacturerLogoRequested = Boolean(opts.brandLogoUrl);
  const manufacturerLogoOk = !manufacturerLogoRequested || Boolean(campaignBrandAsset?.backgroundRemoved);
  const badCutouts = assets
    .map((asset,index)=>({asset,index}))
    .filter(({asset}) => !(asset.backgroundRemoved && asset.cutoutSafe !== false));
  const lowResolution = assets
    .map((asset,index)=>({asset,index}))
    .filter(({asset}) => {
      const longEdge = asset.repairMetrics?.resolutionEnhanced
        ? Math.max(
            Number(asset.qualityWidth || asset.width || 0),
            Number(asset.qualityHeight || asset.height || 0)
          )
        : Math.max(asset.sourceWidth, asset.sourceHeight);
      return longEdge < 700;
    });
  const internalBackgroundFailures = assets
    .map((asset,index)=>({asset,index}))
    .filter(({asset}) => asset.repairMetrics?.internalBackgroundOk === false);
  const whiteHaloFailures = assets
    .map((asset,index)=>({asset,index}))
    .filter(({asset}) => asset.repairMetrics?.whiteHaloOk === false);
  const thinStructureFailures = assets
    .map((asset,index)=>({asset,index}))
    .filter(({asset}) => asset.repairMetrics?.thinStructureDamageOk === false);

  const checks = [
    {
      id:'brand',
      critical:true,
      ok:brandOk,
      label:brandOk ? 'Logo oficial Ariana com fundo transparente' : 'Logo oficial precisa de correção',
      detail:brandOk ? 'Identidade oficial aprovada.' : 'A campanha final fica bloqueada.'
    },
    {
      id:'manufacturer_logo',
      critical:true,
      ok:manufacturerLogoOk,
      label:manufacturerLogoRequested
        ? (manufacturerLogoOk ? 'Logo do fabricante tratada' : 'Logo do fabricante reprovada')
        : 'Logo do fabricante opcional',
      detail:manufacturerLogoRequested
        ? (manufacturerLogoOk ? 'Marca pronta para a campanha.' : 'Use PNG transparente ou fundo simples.')
        : 'Nenhuma logo de fabricante informada.'
    },
    {
      id:'multi_cutout',
      critical:true,
      ok:badCutouts.length===0,
      label:badCutouts.length===0 ? 'Todos os produtos com recorte aprovado' : badCutouts.length+' produto(s) com recorte reprovado',
      detail:badCutouts.length===0
        ? assets.length+' produto(s) prontos para composição.'
        : 'Troque as imagens reprovadas por PNG transparente ou foto oficial limpa.'
    },
    {
      id:'multi_internal_background_contamination',
      critical:true,
      ok:internalBackgroundFailures.length===0,
      label:internalBackgroundFailures.length===0
        ? 'Áreas vazadas internas aprovadas'
        : internalBackgroundFailures.length+' produto(s) com fundo interno residual',
      detail:internalBackgroundFailures.length===0
        ? 'Nenhum fundo preso crítico foi detectado.'
        : 'A campanha final foi bloqueada até corrigir os recortes internos.'
    },
    {
      id:'multi_white_halo_residual',
      critical:true,
      ok:whiteHaloFailures.length===0,
      label:whiteHaloFailures.length===0
        ? 'Bordas sem halo branco crítico'
        : whiteHaloFailures.length+' produto(s) com halo branco residual',
      detail:whiteHaloFailures.length===0
        ? 'As bordas dos produtos foram validadas.'
        : 'A campanha final foi bloqueada até limpar os halos residuais.'
    },
    {
      id:'multi_thin_structure_damage',
      critical:true,
      ok:thinStructureFailures.length===0,
      label:thinStructureFailures.length===0
        ? 'Grades e peças finas preservadas'
        : thinStructureFailures.length+' produto(s) com dano em estrutura fina',
      detail:thinStructureFailures.length===0
        ? 'A continuidade estrutural dos produtos foi validada.'
        : 'A campanha final foi bloqueada para não usar recortes com peças finas mastigadas.'
    },
    {
      id:'multi_resolution',
      critical:true,
      ok:lowResolution.length===0,
      label:lowResolution.length===0 ? 'Resolução dos produtos aprovada' : lowResolution.length+' produto(s) com baixa resolução',
      detail:lowResolution.length===0 ? 'Todos acima da resolução mínima.' : 'Use imagens maiores antes de salvar.'
    },
    {
      id:'multi_count',
      critical:true,
      ok:assets.length>=2 && assets.length<=5,
      label:'Campanha com '+assets.length+' produto(s)',
      detail:'O modo multi-produto aceita de 2 a 5 itens.'
    },
    {
      id:'format',
      critical:false,
      ok:true,
      label:'Composição multi-produto própria para '+(format.device==='mobile'?'celular':'desktop'),
      detail:format.width+'×'+format.height
    }
  ];

  const criticalFailures=checks.filter(item=>item.critical&&!item.ok);
  return {
    score:Math.round(checks.filter(item=>item.ok).length/checks.length*100),
    checks,
    blockSave:criticalFailures.length>0,
    criticalFailures:criticalFailures.map(item=>item.id)
  };
}

export async function analyzeCreativeBannerProMulti(products = [], options = {}) {
  const rows=(Array.isArray(products)?products:[]).filter(Boolean).slice(0,5);
  if(rows.length<2) throw new Error('multi_product_requires_at_least_two_products');
  const opts=normalizedOptions(rows[0],{...options,showPrice:false,contentMode:'multi_product'});
  const brandAsset=await prepareOfficialLogoAsset();
  const campaignBrandAsset=opts.brandLogoUrl ? await prepareCampaignBrandLogo(opts.brandLogoUrl) : null;
  opts.hasBrandLogo=Boolean(campaignBrandAsset?.backgroundRemoved);
  const assets=[];
  for(const product of rows) {
    assets.push(await prepareProProductAsset(product,opts));
  }

  return {
    ok:true,
    multiProduct:true,
    format:opts.format,
    template:opts.template,
    productCount:rows.length,
    products:assets.map((asset,index)=>({
      index,
      name:clean(rows[index]?.name||rows[index]?.title||('Produto '+(index+1)),90),
      sourceWidth:asset.sourceWidth,
      sourceHeight:asset.sourceHeight,
      backgroundRemoved:Boolean(asset.backgroundRemoved),
      cutoutSafe:Boolean(asset.cutoutSafe),
      cutoutReason:asset.cutoutReason||'',
      removalMode:asset.removalMode,
      removedRatio:Number(asset.removedRatio.toFixed(4)),
      repair:asset.repairMetrics || null,
      qualityWidth:Number(asset.qualityWidth || asset.width || 0),
      qualityHeight:Number(asset.qualityHeight || asset.height || 0)
    })),
    brand:{
      backgroundRemoved:Boolean(brandAsset.backgroundRemoved),
      transparentRatio:Number(brandAsset.transparentRatio.toFixed(4))
    },
    manufacturerBrand:campaignBrandAsset ? {
      backgroundRemoved:Boolean(campaignBrandAsset.backgroundRemoved),
      removalMode:campaignBrandAsset.removalMode,
      removedRatio:Number(campaignBrandAsset.removedRatio || 0)
    } : null,
    quality:multiQuality(assets,brandAsset,opts.format,opts,campaignBrandAsset)
  };
}

export async function generateCreativeBannerProMulti(products = [], options = {}) {
  const rows=(Array.isArray(products)?products:[]).filter(Boolean).slice(0,5);
  if(rows.length<2) throw new Error('multi_product_requires_at_least_two_products');

  const opts=normalizedOptions(rows[0],{
    ...options,
    showPrice:false,
    contentMode:'multi_product'
  });
  const format=opts.format;
  const renderFormat=highQualityRenderFormat(format,opts);
  const brandAsset=await prepareOfficialLogoAsset();
  const campaignBrandAsset=opts.brandLogoUrl ? await prepareCampaignBrandLogo(opts.brandLogoUrl) : null;
  opts.hasBrandLogo=Boolean(campaignBrandAsset?.backgroundRemoved);
  const assets = await Promise.all(
    rows.map(product => prepareProProductAsset(product, opts))
  );
  const qualityResult=multiQuality(assets,brandAsset,format,opts,campaignBrandAsset);
  const slots=multiProductSlots(renderFormat,rows.length,opts);

  const layers=[
    {input:backgroundSvg(renderFormat,opts.template),left:0,top:0}
  ];
  const marketplacePolish = marketplaceArianaPolishSvg(renderFormat, opts);
  if (marketplacePolish) {
    layers.push({input:marketplacePolish,left:0,top:0});
  }
  layers.push({input:multiShowcaseStageSvg(renderFormat,rows.length,opts),left:0,top:0});
  layers.push(await logoLayer(renderFormat,brandAsset));
  if(campaignBrandAsset?.backgroundRemoved){
    const manufacturerLogo=await campaignBrandLogoLayer(renderFormat,campaignBrandAsset);
    if(manufacturerLogo) layers.push(manufacturerLogo);
  }

  for(let index=0;index<assets.length;index+=1){
    const asset=assets[index];
    const slot=slots[index];
    const layer=await productComposite(
      asset,
      renderFormat,
      {product:slot},
      {softMarketplaceShadow: opts.generationStyle === 'marketplace'}
    );
    if(asset.backgroundRemoved){
      layers.push({
        input:layer.shadow,
        left:layer.shadowLeft,
        top:layer.shadowTop,
        blend:'over'
      });
    }else{
      layers.push({
        input:fallbackPanelSvg(renderFormat,{product:slot},opts.template),
        left:0,
        top:0
      });
    }
    layers.push({
      input:layer.product,
      left:layer.productLeft,
      top:layer.productTop,
      blend:'over'
    });
  }

  layers.push({
    input:multiCampaignOverlay(renderFormat,opts,rows.length),
    left:0,
    top:0
  });

  const buffer=await finalizeBannerBuffer(
    layers,
    renderFormat,
    format,
    opts.generationStyle === 'marketplace'
  );

  return {
    buffer,
    meta:{
      multiProduct:true,
      format,
      template:opts.template,
      generationStyle:opts.generationStyle,
      marketplacePreset:opts.marketplacePreset,
      layoutGrammar:opts.layoutGrammar,
      campaignObjective:opts.campaignObjective,
      renderQuality:opts.generationStyle === 'marketplace' ? 'supersampled_2x_lanczos3_sharpen' : 'standard',
      renderScale:opts.generationStyle === 'marketplace' ? 2 : 1,
      productCount:rows.length,
      products:assets.map((asset,index)=>({
        index,
        name:clean(rows[index]?.name||rows[index]?.title||('Produto '+(index+1)),90),
        backgroundRemoved:Boolean(asset.backgroundRemoved),
        cutoutSafe:Boolean(asset.cutoutSafe),
        cutoutReason:asset.cutoutReason||'',
        removalMode:asset.removalMode,
        repair:asset.repairMetrics || null
      })),
      brand:{
        backgroundRemoved:Boolean(brandAsset.backgroundRemoved),
        transparentRatio:Number(brandAsset.transparentRatio.toFixed(4))
      },
      manufacturerBrand:campaignBrandAsset ? {
        backgroundRemoved:Boolean(campaignBrandAsset.backgroundRemoved),
        removalMode:campaignBrandAsset.removalMode,
        removedRatio:Number(campaignBrandAsset.removedRatio || 0)
      } : null,
      copy:{
        badge:opts.badge,
        headline:opts.headline,
        subtitle:opts.subtitle,
        cta:opts.cta
      },
      quality:qualityResult
    }
  };
}
