import axios from 'axios';

const BRAND_BLUE = '#0047AB';
const BRAND_BLUE_DARK = '#073B7A';
const BRAND_YELLOW = '#F7C600';
const BRAND_GREEN = '#16A34A';
const BRAND_ORANGE = '#FF7A00';
const TEXT_DARK = '#172033';
const TEXT_MUTED = '#64748B';

function escapeXml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
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
  const original = words.join(' ');
  const rendered = lines.join(' ');
  if (original.length > rendered.length && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/\.{3}$/,'').slice(0, Math.max(8, maxChars - 3))}...`;
  }
  return lines.length ? lines : ['Produto Ariana Móveis'];
}

function getMainImageUrl(product = {}) {
  const imgs = Array.isArray(product.images) ? product.images : [];
  const main = imgs.find((img) => img && img.isMain && (img.url || img.imageUrl)) || imgs.find((img) => img && (img.url || img.imageUrl));
  return String(product.mainImageUrl || product.imageUrl || product.image || product.imagem || main?.url || main?.imageUrl || '').trim();
}

async function loadImageBuffer(url) {
  if (!url) return null;
  const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 25000 });
  return Buffer.from(response.data);
}

function calculatePricing(product = {}, pixPercent = 17) {
  // Regra visual da Ariana: preço do Mongo é o preço cheio/parcelado; PIX recebe desconto.
  const fullPrice = toNumber(
    product.oldPrice || product.precoAntigo || product.precoDe || product.price || product.preco || 0,
    0
  );
  const explicitPix = toNumber(product.pixPrice || product.precoPix || product.cashPrice || 0, 0);
  const pixPrice = explicitPix > 0 ? explicitPix : +(fullPrice * (1 - pixPercent / 100)).toFixed(2);
  const installmentCount = Number(product.installmentCount || 12) || 12;
  const installmentPrice = fullPrice > 0 ? fullPrice / installmentCount : 0;
  return { fullPrice, pixPrice, pixPercent, installmentCount, installmentPrice };
}

function backgroundSvg({ width, height, variant }) {
  const isStory = variant === 'story';
  const headerH = isStory ? 112 : 92;
  const imageBox = isStory
    ? { x: 78, y: 410, w: 924, h: 780, rx: 36 }
    : { x: 72, y: 270, w: 936, h: 430, rx: 32 };
  const priceCard = isStory
    ? { x: 70, y: 1218, w: 940, h: 350, rx: 34 }
    : { x: 70, y: 710, w: 940, h: 220, rx: 30 };

  return `
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#ffffff"/>
        <stop offset="45%" stop-color="#eef6ff"/>
        <stop offset="100%" stop-color="#dbeafe"/>
      </linearGradient>
      <linearGradient id="hero" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#0047AB"/>
        <stop offset="100%" stop-color="#0A63D8"/>
      </linearGradient>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#002b60" flood-opacity="0.18"/>
      </filter>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#bg)"/>
    <rect x="0" y="0" width="${width}" height="${headerH}" fill="url(#hero)"/>
    <circle cx="${width - (isStory ? 78 : 70)}" cy="${headerH / 2}" r="${isStory ? 31 : 27}" fill="${BRAND_YELLOW}"/>

    <rect x="45" y="${isStory ? 135 : 115}" width="${width - 90}" height="${isStory ? 1660 : 850}" rx="42" fill="#ffffff" filter="url(#shadow)"/>
    <rect x="${imageBox.x}" y="${imageBox.y}" width="${imageBox.w}" height="${imageBox.h}" rx="${imageBox.rx}" fill="#f8fbff" stroke="#dbeafe" stroke-width="2"/>
    <rect x="${priceCard.x}" y="${priceCard.y}" width="${priceCard.w}" height="${priceCard.h}" rx="${priceCard.rx}" fill="#ffffff" stroke="#dbeafe" stroke-width="2"/>
    <path d="M${imageBox.x + 28} ${imageBox.y + imageBox.h - 18} H${imageBox.x + imageBox.w - 28}" stroke="#e2e8f0" stroke-width="2"/>
  </svg>`;
}

function foregroundSvg({ width, height, product, pricing, variant }) {
  const isStory = variant === 'story';
  const headerH = isStory ? 112 : 92;
  const titleLines = wrapText(product.name || product.title || 'Produto Ariana Móveis', isStory ? 28 : 34, isStory ? 3 : 2);
  const titleY = isStory ? 190 : 158;
  const titleSize = isStory ? 50 : 44;
  const lineGap = isStory ? 58 : 52;
  const category = String(product.categoryName || product.category || '').trim();
  const priceY = isStory ? 1296 : 775;
  const badge = isStory
    ? { x: 92, y: 1238, w: 275, h: 74, fs: 33 }
    : { x: 92, y: 728, w: 235, h: 58, fs: 27 };
  const cta = isStory
    ? { x: 70, y: 1635, w: 940, h: 110, fs: 42, urlY: 1810 }
    : { x: 70, y: 955, w: 940, h: 78, fs: 31, urlY: 1056 };

  const titleText = titleLines.map((line, idx) => `
    <text x="70" y="${titleY + idx * lineGap}" font-size="${titleSize}" font-weight="900" fill="${TEXT_DARK}" font-family="Arial, Helvetica, sans-serif">${escapeXml(line)}</text>`).join('');

  return `
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <text x="70" y="${isStory ? 70 : 58}" font-size="${isStory ? 36 : 32}" font-weight="900" fill="#ffffff" font-family="Arial, Helvetica, sans-serif">ARIANA MÓVEIS</text>
    <text x="${isStory ? 560 : 620}" y="${isStory ? 70 : 58}" font-size="${isStory ? 22 : 20}" font-weight="800" fill="#ffffff" font-family="Arial, Helvetica, sans-serif">ONLINE • PARA TODO BRASIL</text>
    <text x="${width - (isStory ? 78 : 70)}" y="${headerH / 2 + 8}" text-anchor="middle" font-size="${isStory ? 20 : 18}" font-weight="900" fill="${BRAND_BLUE_DARK}" font-family="Arial, Helvetica, sans-serif">PIX</text>

    ${titleText}
    ${category ? `<text x="70" y="${titleY + titleLines.length * lineGap + 18}" font-size="${isStory ? 27 : 23}" font-weight="800" fill="${TEXT_MUTED}" font-family="Arial, Helvetica, sans-serif">${escapeXml(category)}</text>` : ''}

    <rect x="${badge.x}" y="${badge.y}" width="${badge.w}" height="${badge.h}" rx="18" fill="${BRAND_GREEN}"/>
    <text x="${badge.x + badge.w / 2}" y="${badge.y + (isStory ? 49 : 39)}" text-anchor="middle" font-size="${badge.fs}" font-weight="900" fill="#ffffff" font-family="Arial, Helvetica, sans-serif">${pricing.pixPercent}% OFF</text>
    <rect x="${badge.x + badge.w + 20}" y="${badge.y}" width="${isStory ? 245 : 210}" height="${badge.h}" rx="18" fill="${BRAND_ORANGE}"/>
    <text x="${badge.x + badge.w + 20 + (isStory ? 122 : 105)}" y="${badge.y + (isStory ? 49 : 39)}" text-anchor="middle" font-size="${isStory ? 28 : 23}" font-weight="900" fill="#ffffff" font-family="Arial, Helvetica, sans-serif">OFERTA PIX</text>

    <text x="92" y="${priceY}" font-size="${isStory ? 35 : 27}" fill="#94a3b8" text-decoration="line-through" font-family="Arial, Helvetica, sans-serif">de ${brl(pricing.fullPrice)}</text>
    <text x="92" y="${priceY + (isStory ? 100 : 74)}" font-size="${isStory ? 76 : 58}" font-weight="900" fill="${TEXT_DARK}" font-family="Arial, Helvetica, sans-serif">${brl(pricing.pixPrice)}</text>
    <text x="${isStory ? 555 : 500}" y="${priceY + (isStory ? 100 : 74)}" font-size="${isStory ? 33 : 25}" font-weight="900" fill="${BRAND_GREEN}" font-family="Arial, Helvetica, sans-serif">no PIX à vista</text>
    <text x="92" y="${priceY + (isStory ? 162 : 121)}" font-size="${isStory ? 32 : 25}" font-weight="800" fill="#334155" font-family="Arial, Helvetica, sans-serif">ou ${pricing.installmentCount}x de ${brl(pricing.installmentPrice)} s/ juros no cartão</text>
    <text x="92" y="${priceY + (isStory ? 210 : 158)}" font-size="${isStory ? 26 : 20}" fill="${TEXT_MUTED}" font-family="Arial, Helvetica, sans-serif">Total parcelado: ${brl(pricing.fullPrice)}</text>

    <rect x="${cta.x}" y="${cta.y}" width="${cta.w}" height="${cta.h}" rx="22" fill="${BRAND_BLUE}"/>
    <text x="${width / 2}" y="${cta.y + (isStory ? 68 : 50)}" text-anchor="middle" font-size="${cta.fs}" font-weight="900" fill="#ffffff" font-family="Arial, Helvetica, sans-serif">COMPRE AGORA</text>
    <text x="${width / 2}" y="${cta.urlY}" text-anchor="middle" font-size="${isStory ? 26 : 18}" font-weight="800" fill="#7aa7e8" font-family="Arial, Helvetica, sans-serif">arianamoveis.com.br</text>
  </svg>`;
}

export async function generateProductPosterBuffer(product = {}, options = {}) {
  const { default: sharp } = await import('sharp');
  const variant = options.variant === 'story' ? 'story' : 'square';
  const width = 1080;
  const height = variant === 'story' ? 1920 : 1080;
  const pricing = calculatePricing(product, Number(options.pixPercent || 17));
  const imageUrl = getMainImageUrl(product);

  const bg = Buffer.from(backgroundSvg({ width, height, variant }));
  const fg = Buffer.from(foregroundSvg({ width, height, product, pricing, variant }));
  const composites = [{ input: bg, top: 0, left: 0 }];

  const rawImage = await loadImageBuffer(imageUrl).catch(() => null);
  if (rawImage) {
    const imgBox = variant === 'story'
      ? { w: 860, h: 700, top: 465 }
      : { w: 820, h: 350, top: 330 };
    const productPng = await sharp(rawImage)
      .rotate()
      .resize(imgBox.w, imgBox.h, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 }, withoutEnlargement: false })
      .png()
      .toBuffer();
    composites.push({ input: productPng, top: imgBox.top, left: Math.round((width - imgBox.w) / 2) });
  }

  composites.push({ input: fg, top: 0, left: 0 });

  return sharp({ create: { width, height, channels: 4, background: '#ffffff' } })
    .composite(composites)
    .png()
    .toBuffer();
}
