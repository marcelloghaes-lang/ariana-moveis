import axios from 'axios';

const BRAND_BLUE = '#0047AB';
const BRAND_BLUE_DARK = '#073B7A';
const BRAND_YELLOW = '#F7C600';
const BRAND_GREEN = '#16A34A';
const BRAND_ORANGE = '#FF7A00';
const WHATSAPP_NUMBER = '5531985147119';
const WHATSAPP_TEXT = 'Olá! Vim pelo cartaz da Ariana Móveis e quero comprar este produto.';
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

export function buildWhatsappUrl(product = {}) {
  const name = String(product.name || product.title || 'produto').trim();
  const msg = `${WHATSAPP_TEXT} Produto: ${name}`;
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}`;
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
    ? { x: 70, y: 430, w: 940, h: 650, rx: 34 }
    : { x: 72, y: 270, w: 936, h: 410, rx: 30 };
  const priceCard = isStory
    ? { x: 70, y: 1115, w: 940, h: 400, rx: 34 }
    : { x: 70, y: 700, w: 940, h: 245, rx: 30 };

  return `
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#ffffff"/>
        <stop offset="48%" stop-color="#eef6ff"/>
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

    <rect x="45" y="${isStory ? 135 : 115}" width="${width - 90}" height="${isStory ? 1660 : 900}" rx="42" fill="#ffffff" filter="url(#shadow)"/>
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
  const titleSize = isStory ? 46 : 42;
  const lineGap = isStory ? 54 : 50;
  const category = String(product.categoryName || product.category || '').trim();

  const priceY = isStory ? 1248 : 790;
  const badge = isStory
    ? { x: 92, y: 1145, w: 270, h: 68, fs: 31 }
    : { x: 92, y: 724, w: 230, h: 52, fs: 25 };
  const cta = isStory
    ? { x: 70, y: 1605, w: 940, h: 108, fs: 40, urlY: 1810 }
    : { x: 70, y: 960, w: 940, h: 76, fs: 30, urlY: 1057 };

  const titleText = titleLines.map((line, idx) => `
    <text x="70" y="${titleY + idx * lineGap}" font-size="${titleSize}" font-weight="900" fill="${TEXT_DARK}" font-family="Arial, Helvetica, sans-serif">${escapeXml(line)}</text>`).join('');

  const whatsappLabel = isStory ? 'WHATSAPP (31) 98514-7119' : 'WhatsApp (31) 98514-7119';

  return `
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <text x="70" y="${isStory ? 70 : 58}" font-size="${isStory ? 36 : 32}" font-weight="900" fill="#ffffff" font-family="Arial, Helvetica, sans-serif">ARIANA MÓVEIS</text>
    <text x="${isStory ? 560 : 620}" y="${isStory ? 70 : 58}" font-size="${isStory ? 22 : 20}" font-weight="800" fill="#ffffff" font-family="Arial, Helvetica, sans-serif">ONLINE • PARA TODO BRASIL</text>
    <text x="${width - (isStory ? 78 : 70)}" y="${headerH / 2 + 8}" text-anchor="middle" font-size="${isStory ? 20 : 18}" font-weight="900" fill="${BRAND_BLUE_DARK}" font-family="Arial, Helvetica, sans-serif">PIX</text>

    ${titleText}
    ${category ? `<text x="70" y="${titleY + titleLines.length * lineGap + 18}" font-size="${isStory ? 26 : 22}" font-weight="800" fill="${TEXT_MUTED}" font-family="Arial, Helvetica, sans-serif">${escapeXml(category)}</text>` : ''}

    <rect x="${badge.x}" y="${badge.y}" width="${badge.w}" height="${badge.h}" rx="17" fill="${BRAND_GREEN}"/>
    <text x="${badge.x + badge.w / 2}" y="${badge.y + (isStory ? 45 : 35)}" text-anchor="middle" font-size="${badge.fs}" font-weight="900" fill="#ffffff" font-family="Arial, Helvetica, sans-serif">${pricing.pixPercent}% OFF</text>
    <rect x="${badge.x + badge.w + 20}" y="${badge.y}" width="${isStory ? 245 : 210}" height="${badge.h}" rx="17" fill="${BRAND_ORANGE}"/>
    <text x="${badge.x + badge.w + 20 + (isStory ? 122 : 105)}" y="${badge.y + (isStory ? 45 : 35)}" text-anchor="middle" font-size="${isStory ? 27 : 23}" font-weight="900" fill="#ffffff" font-family="Arial, Helvetica, sans-serif">OFERTA PIX</text>

    <text x="92" y="${priceY}" font-size="${isStory ? 34 : 27}" fill="#94a3b8" text-decoration="line-through" font-family="Arial, Helvetica, sans-serif">de ${brl(pricing.fullPrice)}</text>
    <text x="92" y="${priceY + (isStory ? 100 : 70)}" font-size="${isStory ? 74 : 56}" font-weight="900" fill="${TEXT_DARK}" font-family="Arial, Helvetica, sans-serif">${brl(pricing.pixPrice)}</text>
    <text x="${isStory ? 555 : 505}" y="${priceY + (isStory ? 100 : 70)}" font-size="${isStory ? 33 : 25}" font-weight="900" fill="${BRAND_GREEN}" font-family="Arial, Helvetica, sans-serif">no PIX à vista</text>
    <text x="92" y="${priceY + (isStory ? 162 : 118)}" font-size="${isStory ? 31 : 24}" font-weight="800" fill="#334155" font-family="Arial, Helvetica, sans-serif">ou ${pricing.installmentCount}x de ${brl(pricing.installmentPrice)} s/ juros no cartão</text>
    <text x="92" y="${priceY + (isStory ? 210 : 153)}" font-size="${isStory ? 25 : 19}" fill="${TEXT_MUTED}" font-family="Arial, Helvetica, sans-serif">Total parcelado: ${brl(pricing.fullPrice)}</text>

    <rect x="${cta.x}" y="${cta.y}" width="${cta.w}" height="${cta.h}" rx="22" fill="${BRAND_BLUE}"/>
    <text x="${width / 2}" y="${cta.y + (isStory ? 67 : 49)}" text-anchor="middle" font-size="${cta.fs}" font-weight="900" fill="#ffffff" font-family="Arial, Helvetica, sans-serif">COMPRE AGORA</text>
    <text x="${width / 2}" y="${cta.urlY}" text-anchor="middle" font-size="${isStory ? 25 : 18}" font-weight="800" fill="#5d8fd8" font-family="Arial, Helvetica, sans-serif">${whatsappLabel}</text>
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
      ? { w: 880, h: 590, top: 465 }
      : { w: 850, h: 365, top: 300 };

    let pipeline = sharp(rawImage).rotate();
    try {
      // Remove margens brancas grandes das fotos de produto sem cortar o objeto.
      pipeline = pipeline.flatten({ background: '#ffffff' }).trim({ background: '#ffffff', threshold: 18 });
    } catch (_error) {
      pipeline = sharp(rawImage).rotate();
    }

    const productPng = await pipeline
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
