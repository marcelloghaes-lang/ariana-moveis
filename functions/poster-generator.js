import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const BRAND_BLUE = '#0047AB';
const BRAND_BLUE_DARK = '#073B7A';
const BRAND_YELLOW = '#F7C600';
const BRAND_GREEN = '#16A34A';
const BRAND_ORANGE = '#FF7A00';
const SITE_URL = 'https://arianamoveis.com.br/';
const SITE_LABEL = 'arianamoveis.com.br';
const CTA_TEXT = 'COMPRE DIRETO DO SITE';
// Caminho padrão: coloque o arquivo da mascote em /assets/mascote.png na raiz do backend.
// Também aceita variável POSTER_MASCOT_PATH ou POSTER_MASCOT_URL no Render.
const DEFAULT_MASCOT_RELATIVE_PATH = './assets/mascote.png';
const TEXT_DARK = '#172033';
const TEXT_MUTED = '#64748B';
const CARD_STROKE = '#CFE4FF';

function escapeXml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function removeAccents(value = '') {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function toNumber(value, fallback = 0) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  const clean = String(value ?? '')
    .replace(/R\$/gi, '')
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const n = Number(clean);
  return Number.isFinite(n) ? n : fallback;
}

function brl(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(toNumber(value, 0));
}

export function buildSiteUrl(_product = {}) {
  return SITE_URL;
}

// Mantido por compatibilidade com qualquer trecho antigo do backend/painel que ainda importe este nome.
// Agora ele direciona para o site, não para WhatsApp.
export function buildWhatsappUrl(product = {}) {
  return buildSiteUrl(product);
}

function wrapText(text = '', maxChars = 34, maxLines = 2) {
  const words = String(text || 'Produto Ariana Móveis').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
    if (lines.length >= maxLines) break;
  }

  if (current && lines.length < maxLines) lines.push(current);
  return lines.length ? lines.slice(0, maxLines) : ['Produto Ariana Móveis'];
}

function getMainImageUrl(product = {}) {
  const imgs = Array.isArray(product.images) ? product.images : [];
  const main = imgs.find((img) => img && img.isMain && (img.url || img.imageUrl)) || imgs.find((img) => img && (img.url || img.imageUrl));
  return String(product.mainImageUrl || product.imageUrl || product.image || product.imagem || main?.url || main?.imageUrl || '').trim();
}

async function loadImageBuffer(url) {
  if (!url) return null;
  const dataMatch = String(url).match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/i);
  if (dataMatch) return Buffer.from(dataMatch[1], 'base64');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Falha ao carregar imagem (${response.status})`);
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

async function loadLocalImageBuffer(filePath = '') {
  const rawPath = String(filePath || '').trim();
  if (!rawPath) return null;

  const candidates = [
    rawPath,
    path.resolve(__dirname, rawPath),
    path.resolve(process.cwd(), rawPath),
    path.resolve(__dirname, 'assets', path.basename(rawPath)),
    path.resolve(process.cwd(), 'assets', path.basename(rawPath))
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return fs.readFileSync(candidate);
    } catch (_error) {}
  }

  return null;
}

async function loadMascotBuffer(options = {}) {
  const mascotUrl = String(
    options.mascotUrl ||
    options.mascoteUrl ||
    process.env.POSTER_MASCOT_URL ||
    ''
  ).trim();

  if (mascotUrl) {
    const remote = await loadImageBuffer(mascotUrl).catch(() => null);
    if (remote) return remote;
  }

  const mascotPath = String(
    options.mascotPath ||
    options.mascotePath ||
    process.env.POSTER_MASCOT_PATH ||
    DEFAULT_MASCOT_RELATIVE_PATH
  ).trim();

  return loadLocalImageBuffer(mascotPath);
}

function mascotLayoutForVariant(variant) {
  if (variant === 'story') {
    return { w: 260, h: 360, left: 758, top: 1390 };
  }
  return { w: 168, h: 232, left: 828, top: 734 };
}

function calculatePricing(product = {}, pixPercent = 17) {
  const fullPrice = toNumber(product.oldPrice || product.precoAntigo || product.precoDe || product.price || product.preco || 0, 0);
  const explicitPix = toNumber(product.pixPrice || product.precoPix || product.cashPrice || 0, 0);
  const pixPrice = explicitPix > 0 ? explicitPix : +(fullPrice * (1 - pixPercent / 100)).toFixed(2);
  const installmentCount = Number(product.installmentCount || 12) || 12;
  const installmentPrice = fullPrice > 0 ? fullPrice / installmentCount : 0;
  return { fullPrice, pixPrice, pixPercent, installmentCount, installmentPrice };
}

function detectProductType(product = {}) {
  const text = removeAccents(`${product.name || product.title || ''} ${product.categoryName || product.category || ''} ${product.brand || ''}`);
  if (/smart\s*tv|televis|tv\b|roku|monitor/.test(text)) return 'tv';
  if (/cooktop|fogao|forno|micro-ondas|microondas/.test(text)) return 'wide';
  if (/geladeira|refrigerador|freezer|guarda[- ]?roupa|roupeiro|armario|cozinha|comoda|painel|rack|mesa|escrivaninha/.test(text)) return 'large';
  if (/smartphone|celular|iphone|moto\s*g|telefone/.test(text)) return 'phone';
  if (/maquina|lavadora|tanquinho|ar condicionado|ventilador|air fryer|fritadeira|secador|caixa de som/.test(text)) return 'medium';
  return 'default';
}

function layoutForVariant(variant) {
  const isStory = variant === 'story';

  if (isStory) {
    return {
      width: 1080,
      height: 1920,
      headerH: 112,
      shell: { x: 42, y: 128, w: 996, h: 1648, rx: 42 },

      // V31: título mais compacto para liberar área nobre ao produto
      title: { x: 70, y: 174, size: 37, gap: 41, maxChars: 34, maxLines: 3, catOffset: 18 },

      // V31: área do produto maior, principalmente para guarda-roupa/lavadora/TV
      imageBox: { x: 58, y: 372, w: 964, h: 780, rx: 34 },

      // V31: preço mais para baixo, sem encostar na imagem
      priceCard: { x: 70, y: 1178, w: 940, h: 366, rx: 34 },
      badge: { x: 94, y: 1212, w: 252, h: 66, fs: 28 },
      offerBadge: { w: 245, fs: 25 },
      oldPrice: { x: 94, y: 1320, fs: 30 },
      pixPrice: { x: 94, y: 1410, fs: 72 },
      pixText: { x: 560, y: 1410, fs: 31 },
      installment: { x: 94, y: 1474, fs: 28 },
      total: { x: 94, y: 1522, fs: 24 },

      // V31: botão mais destacado e WhatsApp maior
      cta: { x: 70, y: 1614, w: 940, h: 112, fs: 42, textY: 1686, phoneY: 1786, phoneFs: 38 }
    };
  }

  return {
    width: 1080,
    height: 1080,
    headerH: 92,
    shell: { x: 42, y: 108, w: 996, h: 930, rx: 42 },

    // V31: título menor/mais eficiente para não tomar espaço do produto
    title: { x: 70, y: 145, size: 32, gap: 36, maxChars: 44, maxLines: 2, catOffset: 21 },

    // V31: área de produto aumentada
    imageBox: { x: 58, y: 248, w: 964, h: 462, rx: 30 },

    // V31: bloco de preço mais compacto, sem sobreposição com botão
    priceCard: { x: 70, y: 730, w: 940, h: 214, rx: 30 },
    badge: { x: 92, y: 754, w: 225, h: 54, fs: 23 },
    offerBadge: { w: 214, fs: 22 },
    oldPrice: { x: 92, y: 836, fs: 25 },
    pixPrice: { x: 92, y: 899, fs: 56 },
    pixText: { x: 505, y: 899, fs: 26 },
    installment: { x: 92, y: 943, fs: 23 },
    total: { x: 92, y: 976, fs: 19 },

    // V31: botão com mais respiro e telefone legível
    cta: { x: 70, y: 966, w: 940, h: 74, fs: 31, textY: 1015, phoneY: 1064, phoneFs: 24 }
  };
}

function productImagePreset(product = {}, variant = 'square') {
  const type = detectProductType(product);
  const isStory = variant === 'story';

  /*
    V31:
    Em vez de um tamanho genérico, cada família recebe um enquadramento próprio.
    A imagem é recortada/trimada antes e ampliada dentro desses limites.
    Isso evita TV/fogão bons e guarda-roupa/lavadora pequenos demais.
  */
  const presets = isStory ? {
    tv:      { w: 1010, h: 760, top: 378, zoom: 1.08 },
    wide:    { w: 1010, h: 765, top: 380, zoom: 1.08 },
    large:   { w: 990,  h: 790, top: 376, zoom: 1.12 }, // guarda-roupa, armário, painel, cozinha
    phone:   { w: 700,  h: 790, top: 370, zoom: 1.06 },
    medium:  { w: 920,  h: 785, top: 376, zoom: 1.14 }, // lavadora, ar, ventilador, air fryer
    default: { w: 900,  h: 770, top: 384, zoom: 1.10 }
  } : {
    tv:      { w: 1010, h: 455, top: 252, zoom: 1.05 },
    wide:    { w: 1000, h: 460, top: 250, zoom: 1.08 },
    large:   { w: 990,  h: 468, top: 246, zoom: 1.12 }, // guarda-roupa/móveis largos
    phone:   { w: 650,  h: 468, top: 245, zoom: 1.06 },
    medium:  { w: 900,  h: 468, top: 246, zoom: 1.14 }, // lavadora e pequenos
    default: { w: 880,  h: 458, top: 252, zoom: 1.10 }
  };

  return presets[type] || presets.default;
}

function backgroundSvg({ width, height, variant }) {
  const L = layoutForVariant(variant);
  return `
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#ffffff"/>
        <stop offset="42%" stop-color="#edf6ff"/>
        <stop offset="100%" stop-color="#dbeafe"/>
      </linearGradient>
      <linearGradient id="hero" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#0047AB"/>
        <stop offset="100%" stop-color="#0A63D8"/>
      </linearGradient>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="16" stdDeviation="18" flood-color="#002b60" flood-opacity="0.20"/>
      </filter>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#bg)"/>
    <rect x="0" y="0" width="${width}" height="${L.headerH}" fill="url(#hero)"/>
    <circle cx="${width - (variant === 'story' ? 78 : 70)}" cy="${L.headerH / 2}" r="${variant === 'story' ? 31 : 27}" fill="${BRAND_YELLOW}"/>

    <rect x="${L.shell.x}" y="${L.shell.y}" width="${L.shell.w}" height="${L.shell.h}" rx="${L.shell.rx}" fill="#ffffff" filter="url(#shadow)"/>
    <rect x="${L.imageBox.x}" y="${L.imageBox.y}" width="${L.imageBox.w}" height="${L.imageBox.h}" rx="${L.imageBox.rx}" fill="#f8fbff" stroke="${CARD_STROKE}" stroke-width="2"/>
    <rect x="${L.priceCard.x}" y="${L.priceCard.y}" width="${L.priceCard.w}" height="${L.priceCard.h}" rx="${L.priceCard.rx}" fill="#ffffff" stroke="${CARD_STROKE}" stroke-width="2"/>
    <path d="M${L.imageBox.x + 28} ${L.imageBox.y + L.imageBox.h - 18} H${L.imageBox.x + L.imageBox.w - 28}" stroke="#e2e8f0" stroke-width="2"/>
  </svg>`;
}

function foregroundSvg({ width, height, product, pricing, variant, options = {} }) {
  const L = layoutForVariant(variant);
  const isStory = variant === 'story';
  const titleLines = wrapText(product.name || product.title || 'Produto Ariana Móveis', L.title.maxChars, L.title.maxLines);
  const category = String(product.categoryName || product.category || '').trim();
  const titleText = titleLines.map((line, idx) => `
    <text x="${L.title.x}" y="${L.title.y + idx * L.title.gap}" font-size="${L.title.size}" font-weight="900" fill="${TEXT_DARK}" font-family="Arial, Helvetica, sans-serif">${escapeXml(line)}</text>`).join('');

  const siteLabel = String(options.siteLabel || SITE_LABEL).trim() || SITE_LABEL;
  const ctaText = String(options.ctaText || CTA_TEXT).trim() || CTA_TEXT;
  const offerX = L.badge.x + L.badge.w + 20;

  return `
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <text x="70" y="${isStory ? 70 : 58}" font-size="${isStory ? 36 : 32}" font-weight="900" fill="#ffffff" font-family="Arial, Helvetica, sans-serif">ARIANA MÓVEIS</text>
    <text x="${isStory ? 560 : 620}" y="${isStory ? 70 : 58}" font-size="${isStory ? 22 : 20}" font-weight="800" fill="#ffffff" font-family="Arial, Helvetica, sans-serif">ONLINE • PARA TODO BRASIL</text>
    <text x="${width - (isStory ? 78 : 70)}" y="${L.headerH / 2 + 8}" text-anchor="middle" font-size="${isStory ? 20 : 18}" font-weight="900" fill="${BRAND_BLUE_DARK}" font-family="Arial, Helvetica, sans-serif">PIX</text>

    ${titleText}
    ${category ? `<text x="70" y="${L.title.y + titleLines.length * L.title.gap + L.title.catOffset}" font-size="${isStory ? 25 : 22}" font-weight="800" fill="${TEXT_MUTED}" font-family="Arial, Helvetica, sans-serif">${escapeXml(category)}</text>` : ''}

    <rect x="${L.badge.x}" y="${L.badge.y}" width="${L.badge.w}" height="${L.badge.h}" rx="17" fill="${BRAND_GREEN}"/>
    <text x="${L.badge.x + L.badge.w / 2}" y="${L.badge.y + (isStory ? 43 : 36)}" text-anchor="middle" font-size="${L.badge.fs}" font-weight="900" fill="#ffffff" font-family="Arial, Helvetica, sans-serif">${pricing.pixPercent}% OFF</text>
    <rect x="${offerX}" y="${L.badge.y}" width="${L.offerBadge.w}" height="${L.badge.h}" rx="17" fill="${BRAND_ORANGE}"/>
    <text x="${offerX + L.offerBadge.w / 2}" y="${L.badge.y + (isStory ? 43 : 36)}" text-anchor="middle" font-size="${L.offerBadge.fs}" font-weight="900" fill="#ffffff" font-family="Arial, Helvetica, sans-serif">OFERTA PIX</text>

    <text x="${L.oldPrice.x}" y="${L.oldPrice.y}" font-size="${L.oldPrice.fs}" fill="#94a3b8" text-decoration="line-through" font-family="Arial, Helvetica, sans-serif">de ${brl(pricing.fullPrice)}</text>
    <text x="${L.pixPrice.x}" y="${L.pixPrice.y}" font-size="${L.pixPrice.fs}" font-weight="900" fill="${TEXT_DARK}" font-family="Arial, Helvetica, sans-serif">${brl(pricing.pixPrice)}</text>
    <text x="${L.pixText.x}" y="${L.pixText.y}" font-size="${L.pixText.fs}" font-weight="900" fill="${BRAND_GREEN}" font-family="Arial, Helvetica, sans-serif">no PIX à vista</text>
    <text x="${L.installment.x}" y="${L.installment.y}" font-size="${L.installment.fs}" font-weight="800" fill="#334155" font-family="Arial, Helvetica, sans-serif">ou ${pricing.installmentCount}x de ${brl(pricing.installmentPrice)} s/ juros no cartão</text>
    <text x="${L.total.x}" y="${L.total.y}" font-size="${L.total.fs}" fill="${TEXT_MUTED}" font-family="Arial, Helvetica, sans-serif">Total parcelado: ${brl(pricing.fullPrice)}</text>

    <rect x="${L.cta.x}" y="${L.cta.y}" width="${L.cta.w}" height="${L.cta.h}" rx="22" fill="${BRAND_BLUE}"/>
    <text x="${width / 2}" y="${L.cta.textY}" text-anchor="middle" font-size="${L.cta.fs}" font-weight="900" fill="#ffffff" font-family="Arial, Helvetica, sans-serif">${escapeXml(ctaText)}</text>
    <text x="${width / 2}" y="${L.cta.phoneY}" text-anchor="middle" font-size="${L.cta.phoneFs}" font-weight="900" fill="${BRAND_BLUE}" font-family="Arial, Helvetica, sans-serif">${escapeXml(siteLabel)}</text>
  </svg>`;
}

function professionalPricing(product = {}, options = {}) {
  const pixPercent = Math.min(50, Math.max(0, Number(options.pixPercent ?? product.pixPercent ?? 17) || 17));
  const installmentCount = Math.min(24, Math.max(1, Number(options.installmentCount ?? product.installmentCount ?? 12) || 12));
  let fullPrice = toNumber(
    options.fullPrice ?? options.cardPrice ?? product.fullPrice ?? product.cardPrice ?? product.oldPrice ?? product.precoAntigo ?? product.price ?? product.preco,
    0
  );
  let cashPrice = toNumber(
    options.cashPrice ?? options.pixPrice ?? product.cashPrice ?? product.pixPrice ?? product.precoPix,
    0
  );

  if (cashPrice <= 0 && fullPrice > 0) cashPrice = +(fullPrice * (1 - pixPercent / 100)).toFixed(2);
  if (fullPrice <= 0 && cashPrice > 0) fullPrice = +(cashPrice / 0.8272).toFixed(2);

  const discountPercent = fullPrice > 0 && cashPrice > 0
    ? Math.max(0, Math.round((1 - cashPrice / fullPrice) * 100))
    : pixPercent;

  return {
    fullPrice,
    cashPrice,
    discountPercent,
    installmentCount,
    installmentPrice: installmentCount > 0 ? fullPrice / installmentCount : fullPrice
  };
}

function professionalPalette(template = 'oferta') {
  const key = String(template || 'oferta').toLowerCase();
  if (key === 'queima') {
    return { start: '#061B46', middle: '#063E8C', end: '#C9182B', glow: '#FF4A4A', accent: '#FFD21A', footer: '#041B47' };
  }
  if (key === 'campanha') {
    return { start: '#0047AB', middle: '#087ED1', end: '#00B6F0', glow: '#A9EDFF', accent: '#FFE600', footer: '#00398D' };
  }
  return { start: '#0047AB', middle: '#0797DE', end: '#07C3F4', glow: '#BCEEFF', accent: '#FFE600', footer: '#00398D' };
}

function professionalTextSize(text = '', large = 52, medium = 44, small = 36) {
  const length = String(text || '').trim().length;
  if (length <= 28) return large;
  if (length <= 42) return medium;
  return small;
}

function professionalProductPreset(product = {}) {
  const type = detectProductType(product);
  const presets = {
    tv: { w: 850, h: 440 },
    wide: { w: 790, h: 465 },
    large: { w: 760, h: 470 },
    phone: { w: 480, h: 470 },
    medium: { w: 650, h: 470 },
    default: { w: 690, h: 465 }
  };
  return presets[type] || presets.default;
}

async function removeEdgeConnectedLightBackground(rawImage, enabled = true) {
  const { default: sharp } = await import('sharp');
  let pipeline = sharp(rawImage).rotate().ensureAlpha().resize({
    width: 1600,
    height: 1600,
    fit: 'inside',
    withoutEnlargement: true
  });

  if (!enabled) {
    return pipeline
      .trim({ background: { r: 255, g: 255, b: 255, alpha: 0 }, threshold: 8 })
      .png()
      .toBuffer();
  }

  const decoded = await pipeline.raw().toBuffer({ resolveWithObject: true });
  const { data, info } = decoded;
  const width = Number(info.width || 0);
  const height = Number(info.height || 0);
  const channels = Number(info.channels || 4);
  const total = width * height;
  if (!width || !height || channels < 4 || total > 3_000_000) return pipeline.png().toBuffer();

  const marked = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const isBackground = (pixelIndex) => {
    const offset = pixelIndex * channels;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const a = data[offset + 3];
    const min = Math.min(r, g, b);
    const max = Math.max(r, g, b);
    return a < 18 || (min >= 242 && max - min <= 24);
  };

  const enqueue = (pixelIndex) => {
    if (pixelIndex < 0 || pixelIndex >= total || marked[pixelIndex] || !isBackground(pixelIndex)) return;
    marked[pixelIndex] = 1;
    queue[tail++] = pixelIndex;
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
    const pixelIndex = queue[head++];
    const x = pixelIndex % width;
    if (x > 0) enqueue(pixelIndex - 1);
    if (x < width - 1) enqueue(pixelIndex + 1);
    if (pixelIndex >= width) enqueue(pixelIndex - width);
    if (pixelIndex < total - width) enqueue(pixelIndex + width);
  }

  // Fotos ambientadas podem ter pequenos objetos brancos ligados às bordas
  // (cortinas, janelas, tapetes). Nesses casos é mais profissional preservar
  // a fotografia completa do que abrir buracos no cenário.
  if (tail / total < 0.12) return pipeline.png().toBuffer();

  for (let pixelIndex = 0; pixelIndex < total; pixelIndex += 1) {
    if (!marked[pixelIndex]) continue;
    data[pixelIndex * channels + 3] = 0;
  }

  return sharp(data, { raw: info })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
    .png()
    .toBuffer();
}

async function loadProfessionalLogoBuffer(options = {}) {
  const logoUrl = String(options.logoUrl || '').trim();
  if (logoUrl) {
    const remote = await loadImageBuffer(logoUrl).catch(() => null);
    if (remote) return remote;
  }
  return loadLocalImageBuffer(path.resolve(__dirname, '../public/imagens/logo.png'));
}

async function loadProfessionalMascotBuffer(options = {}) {
  const mascotUrl = String(options.mascotUrl || options.mascoteUrl || options.mascotImageUrl || '').trim();
  if (mascotUrl) {
    const remote = await loadImageBuffer(mascotUrl).catch(() => null);
    if (remote) return remote;
  }
  return loadLocalImageBuffer(path.resolve(__dirname, '../public/assets/avatar-ariana2.png'));
}

function professionalBackgroundSvg({ template = 'oferta' }) {
  const palette = professionalPalette(template);
  return `
  <svg width="1080" height="1350" viewBox="0 0 1080 1350" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="posterBg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${palette.start}"/>
        <stop offset="52%" stop-color="${palette.middle}"/>
        <stop offset="100%" stop-color="${palette.end}"/>
      </linearGradient>
      <radialGradient id="posterGlow" cx="50%" cy="42%" r="62%">
        <stop offset="0%" stop-color="${palette.glow}" stop-opacity=".62"/>
        <stop offset="58%" stop-color="${palette.glow}" stop-opacity=".10"/>
        <stop offset="100%" stop-color="${palette.glow}" stop-opacity="0"/>
      </radialGradient>
      <filter id="softShadow" x="-40%" y="-100%" width="180%" height="300%">
        <feGaussianBlur stdDeviation="17"/>
      </filter>
    </defs>
    <rect width="1080" height="1350" fill="url(#posterBg)"/>
    <rect width="1080" height="1350" fill="url(#posterGlow)"/>
    <circle cx="930" cy="165" r="220" fill="#ffffff" opacity=".035"/>
    <circle cx="85" cy="560" r="210" fill="#ffffff" opacity=".025"/>
    <path d="M0 745 C230 690 390 770 600 720 C790 675 915 605 1080 650 L1080 1080 C880 1040 720 1110 525 1080 C315 1045 180 980 0 1035 Z" fill="#ffffff" opacity=".055"/>
    <ellipse cx="555" cy="756" rx="315" ry="34" fill="#00163F" opacity=".32" filter="url(#softShadow)"/>
    <rect x="0" y="1190" width="1080" height="160" fill="${palette.footer}"/>
    <rect x="0" y="1190" width="1080" height="6" fill="${palette.accent}" opacity=".95"/>
  </svg>`;
}

function professionalForegroundSvg({ product = {}, pricing, options = {} }) {
  const template = String(options.template || 'oferta').toLowerCase();
  const palette = professionalPalette(template);
  const headline = String(options.headline || (template === 'queima' ? 'QUEIMA DE ESTOQUE' : template === 'campanha' ? 'O MÊS COMEÇOU COM TUDO' : 'OFERTA IMPERDÍVEL')).trim();
  const subtitle = String(options.subtitle || (template === 'queima' ? 'Últimas unidades com preço especial' : 'Economize de verdade na Ariana Móveis')).trim();
  const productName = String(options.productName || product.name || product.title || 'PRODUTO ARIANA MÓVEIS').trim().toUpperCase();
  const productLines = wrapText(productName, 34, 2);
  const headlineSize = professionalTextSize(headline, 54, 46, 38);
  const productNameSize = professionalTextSize(productName, 36, 32, 27);
  const fullValue = brl(pricing.fullPrice).replace(/^R\$\s*/, '');
  const cashValue = brl(pricing.cashPrice).replace(/^R\$\s*/, '');
  const installmentValue = brl(pricing.installmentPrice);
  const whatsapp = String(options.whatsapp || '(31) 98514-7119').trim();
  const email = String(options.email || 'contato@arianamoveis.com.br').trim();
  const site = String(options.siteLabel || options.siteText || 'arianamoveis.com.br').replace(/^https?:\/\//i, '').replace(/\/$/, '').trim();
  const showMascot = options.showMascot !== false && options.useMascot !== false && options.mascote !== false;
  const priceX = showMascot ? 350 : 120;
  const priceWidth = showMascot ? 675 : 840;
  const productNameSvg = productLines.map((line, index) => `<text x="540" y="${290 + index * 39}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${productNameSize}" font-weight="800" fill="#062B63">${escapeXml(line)}</text>`).join('');

  return `
  <svg width="1080" height="1350" viewBox="0 0 1080 1350" xmlns="http://www.w3.org/2000/svg">
    <text x="540" y="205" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${headlineSize}" font-weight="950" fill="${palette.accent}" stroke="#745C00" stroke-width="1" paint-order="stroke fill">${escapeXml(headline)}</text>
    <text x="540" y="247" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="27" font-weight="500" fill="#ffffff">${escapeXml(subtitle)}</text>
    ${productNameSvg}

    <g>
      <text x="${priceX}" y="852" font-family="Arial, Helvetica, sans-serif" font-size="31" font-weight="950" fill="#063B86">POR R$</text>
      <text x="${priceX + 112}" y="875" font-family="Arial, Helvetica, sans-serif" font-size="91" font-weight="950" letter-spacing="-4" fill="#00398D">${escapeXml(fullValue)}</text>
      <text x="${priceX}" y="920" font-family="Arial, Helvetica, sans-serif" font-size="27" font-weight="500" fill="#063B86">EM ATÉ <tspan font-weight="950">${pricing.installmentCount}X SEM JUROS</tspan> NO CARTÃO</text>
      <line x1="${priceX}" y1="960" x2="${priceX + Math.round(priceWidth * .38)}" y2="960" stroke="#064B9A" stroke-width="2"/>
      <text x="${priceX + Math.round(priceWidth * .5)}" y="970" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="950" fill="#063B86">OU</text>
      <line x1="${priceX + Math.round(priceWidth * .62)}" y1="960" x2="${priceX + priceWidth}" y2="960" stroke="#064B9A" stroke-width="2"/>
      <text x="${priceX + Math.round(priceWidth * .5)}" y="1040" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="58" font-weight="950" fill="#00398D">R$ ${escapeXml(cashValue)}</text>
      <text x="${priceX + Math.round(priceWidth * .5)}" y="1082" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="25" font-weight="950" fill="#063B86">À VISTA COM ${pricing.discountPercent}% DE DESCONTO</text>
      <text x="${priceX + Math.round(priceWidth * .5)}" y="1116" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="23" font-weight="900" fill="#063B86">NO PIX OU BOLETO • ${pricing.installmentCount}X DE ${escapeXml(installmentValue)}</text>
    </g>

    <g transform="translate(360 1132)">
      <rect x="0" y="0" width="680" height="43" rx="22" fill="#0577C7" opacity=".34" stroke="#ffffff" stroke-width="1.5"/>
      <circle cx="31" cy="21.5" r="14" fill="none" stroke="${palette.accent}" stroke-width="2.5"/>
      <path d="M17 21.5h28M31 7.5c-6 5-9 9-9 14s3 10 9 14M31 7.5c6 5 9 9 9 14s-3 10-9 14M31 7.5v28" fill="none" stroke="${palette.accent}" stroke-width="1.5"/>
      <text x="56" y="29" font-family="Arial, Helvetica, sans-serif" font-size="21" font-weight="700" fill="#ffffff">Compre também pelo site:</text>
      <text x="327" y="29" font-family="Arial, Helvetica, sans-serif" font-size="21" font-weight="950" fill="${palette.accent}">${escapeXml(site)}</text>
    </g>

    <g transform="translate(44 1215)">
      <circle cx="43" cy="43" r="38" fill="#19B64B" stroke="#ffffff" stroke-width="5"/>
      <text x="43" y="57" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="42" font-weight="900" fill="#ffffff">☎</text>
      <text x="98" y="33" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="500" fill="#ffffff">Atendimento pelo WhatsApp</text>
      <text x="98" y="69" font-family="Arial, Helvetica, sans-serif" font-size="31" font-weight="950" fill="${palette.accent}">${escapeXml(whatsapp)}</text>
    </g>
    <line x1="515" y1="1219" x2="515" y2="1325" stroke="#ffffff" stroke-width="2" opacity=".75"/>
    <g transform="translate(548 1215)">
      <circle cx="43" cy="43" r="38" fill="none" stroke="${palette.accent}" stroke-width="4"/>
      <rect x="22" y="29" width="42" height="29" rx="3" fill="none" stroke="${palette.accent}" stroke-width="4"/>
      <path d="M23 31l20 16 20-16" fill="none" stroke="${palette.accent}" stroke-width="4"/>
      <text x="98" y="33" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="500" fill="#ffffff">E-mail</text>
      <text x="98" y="69" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="950" fill="${palette.accent}">${escapeXml(email)}</text>
    </g>
  </svg>`;
}

async function generateProfessionalPosterBuffer(product = {}, options = {}) {
  const { default: sharp } = await import('sharp');
  const width = 1080;
  const height = 1350;
  const pricing = professionalPricing(product, options);
  const background = Buffer.from(professionalBackgroundSvg({ template: options.template }));
  const foreground = Buffer.from(professionalForegroundSvg({ product, pricing, options }));
  const composites = [{ input: background, top: 0, left: 0 }];

  const logoBuffer = await loadProfessionalLogoBuffer(options).catch(() => null);
  if (logoBuffer) {
    const logoPng = await sharp(logoBuffer)
      .rotate()
      .ensureAlpha()
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
      .resize(700, 150, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    composites.push({ input: logoPng, top: 20, left: 190 });
  }

  const imageUrl = String(options.imageUrl || options.productImageUrl || getMainImageUrl(product) || '').trim();
  const rawImage = await loadImageBuffer(imageUrl).catch(() => null);
  if (rawImage) {
    const cutout = await removeEdgeConnectedLightBackground(rawImage, options.removeLightBackground !== false).catch(() => rawImage);
    const preset = professionalProductPreset(product);
    const resizedProduct = await sharp(cutout)
      .rotate()
      .ensureAlpha()
      .resize(preset.w, preset.h, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        withoutEnlargement: false
      })
      .png()
      .toBuffer();
    const roundedMask = Buffer.from(`<svg width="${preset.w}" height="${preset.h}" xmlns="http://www.w3.org/2000/svg"><rect width="${preset.w}" height="${preset.h}" rx="18" fill="#fff"/></svg>`);
    const productPng = await sharp(resizedProduct)
      .composite([{ input: roundedMask, blend: 'dest-in' }])
      .png()
      .toBuffer();
    const meta = await sharp(productPng).metadata();
    const productW = Number(meta.width || preset.w);
    const productH = Number(meta.height || preset.h);
    const left = Math.max(20, Math.round((width - productW) / 2 + Number(options.productOffsetX || 0)));
    const desiredTop = Math.round(320 + (470 - productH) / 2 + Number(options.productOffsetY || 0));
    const top = Math.max(310, Math.min(790 - productH, desiredTop));
    composites.push({ input: productPng, left: Math.min(width - productW - 20, left), top });
  }

  if (options.showMascot !== false && options.useMascot !== false && options.mascote !== false) {
    const mascotBuffer = await loadProfessionalMascotBuffer(options).catch(() => null);
    if (mascotBuffer) {
      const mascotPng = await sharp(mascotBuffer)
        .rotate()
        .ensureAlpha()
        .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
        .resize(315, 430, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
      composites.push({ input: mascotPng, top: 748, left: 5 });
    }
  }

  composites.push({ input: foreground, top: 0, left: 0 });
  return sharp({ create: { width, height, channels: 4, background: '#ffffff' } })
    .composite(composites)
    .png({ quality: 100, compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

export async function generateProductPosterBuffer(product = {}, options = {}) {
  const { default: sharp } = await import('sharp');
  const requestedVariant = String(options.variant || '').toLowerCase();
  if (['whatsapp', 'portrait', 'professional'].includes(requestedVariant)) {
    return generateProfessionalPosterBuffer(product, options);
  }
  const variant = options.variant === 'story' ? 'story' : 'square';
  const L = layoutForVariant(variant);
  const width = L.width;
  const height = L.height;
  const pricing = calculatePricing(product, Number(options.pixPercent || 17));
  const imageUrl = getMainImageUrl(product);
  const preset = productImagePreset(product, variant);

  const bg = Buffer.from(backgroundSvg({ width, height, variant }));
  const fg = Buffer.from(foregroundSvg({ width, height, product, pricing, variant, options }));
  const composites = [{ input: bg, top: 0, left: 0 }];

  const rawImage = await loadImageBuffer(imageUrl).catch(() => null);
  if (rawImage) {
    let pipeline = sharp(rawImage).rotate().ensureAlpha();
    try {
      pipeline = pipeline.trim({ background: '#ffffff', threshold: 50 });
    } catch (_error) {
      pipeline = sharp(rawImage).rotate().ensureAlpha();
    }

    /*
      V32 - correção para produtos grandes:
      O erro "Image to composite must have same dimensions or smaller" acontecia
      quando preset.w * zoom passava de 1080px. Agora o produto sempre fica
      dentro da caixa de imagem do layout, tanto no poster quadrado quanto no story.
    */
    const maxBoxW = Math.max(120, Math.round((L.imageBox?.w || width) - 28));
    const maxBoxH = Math.max(120, Math.round((L.imageBox?.h || height) - 28));
    const requestedW = Math.round(preset.w * preset.zoom);
    const requestedH = Math.round(preset.h * preset.zoom);
    const scale = Math.min(1, maxBoxW / requestedW, maxBoxH / requestedH);
    const finalW = Math.max(80, Math.round(requestedW * scale));
    const finalH = Math.max(80, Math.round(requestedH * scale));

    const productPng = await pipeline
      .resize(finalW, finalH, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 0 },
        withoutEnlargement: false
      })
      .png()
      .toBuffer();

    const productMeta = await sharp(productPng).metadata();
    const realW = Math.min(Number(productMeta.width || finalW), width);
    const realH = Math.min(Number(productMeta.height || finalH), height);

    const boxX = Number(L.imageBox?.x || 0);
    const boxY = Number(L.imageBox?.y || 0);
    const boxW = Number(L.imageBox?.w || width);
    const boxH = Number(L.imageBox?.h || height);

    const desiredTop = Number.isFinite(Number(preset.top))
      ? Number(preset.top)
      : boxY + (boxH - realH) / 2;

    const left = Math.max(0, Math.min(width - realW, Math.round(boxX + (boxW - realW) / 2)));
    const top = Math.max(0, Math.min(height - realH, Math.round(Math.max(boxY + 8, Math.min(desiredTop, boxY + boxH - realH - 8)))));

    composites.push({
      input: productPng,
      top,
      left
    });
  }

  if (options.showMascot !== false && options.mascote !== false) {
    const mascotBuffer = await loadMascotBuffer(options).catch(() => null);
    if (mascotBuffer) {
      const mascotBox = mascotLayoutForVariant(variant);
      const mascotPng = await sharp(mascotBuffer)
        .rotate()
        .ensureAlpha()
        .resize(mascotBox.w, mascotBox.h, {
          fit: 'contain',
          background: { r: 255, g: 255, b: 255, alpha: 0 },
          withoutEnlargement: false
        })
        .png()
        .toBuffer();

      composites.push({
        input: mascotPng,
        top: mascotBox.top,
        left: mascotBox.left
      });
    }
  }

  composites.push({ input: fg, top: 0, left: 0 });

  return sharp({ create: { width, height, channels: 4, background: '#ffffff' } })
    .composite(composites)
    .png()
    .toBuffer();
}
