import axios from 'axios';

const BRAND_BLUE = '#0047AB';
const BRAND_BLUE_DARK = '#073B7A';
const BRAND_YELLOW = '#F7C600';
const BRAND_GREEN = '#16A34A';
const TEXT_DARK = '#172033';

function escapeXml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toNumber(value, fallback = 0) {
  const n = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

function brl(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(toNumber(value, 0));
}

function wrapText(text = '', maxChars = 28, maxLines = 3) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
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
  if (words.length && lines.join(' ').length < words.join(' ').length && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/\.{3}$/,'')}...`;
  }
  return lines;
}

function getMainImageUrl(product = {}) {
  const imgs = Array.isArray(product.images) ? product.images : [];
  const main = imgs.find((img) => img && img.isMain && (img.url || img.imageUrl)) || imgs.find((img) => img && (img.url || img.imageUrl));
  return String(product.mainImageUrl || product.imageUrl || product.image || product.imagem || main?.url || main?.imageUrl || '').trim();
}

async function loadImageBuffer(url) {
  if (!url) return null;
  const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 20000 });
  return Buffer.from(response.data);
}

function calculatePricing(product = {}, pixPercent = 17) {
  const fullPrice = toNumber(product.oldPrice || product.precoAntigo || product.precoDe || product.price || product.preco || 0, 0);
  const pixPrice = toNumber(product.pixPrice || product.precoPix || product.cashPrice || 0, 0) || +(fullPrice * (1 - pixPercent / 100)).toFixed(2);
  const installmentCount = Number(product.installmentCount || 12) || 12;
  const installmentPrice = fullPrice / installmentCount;
  return { fullPrice, pixPrice, pixPercent, installmentCount, installmentPrice };
}

function baseSvg({ width, height, product, pricing, variant }) {
  const isStory = variant === 'story';
  const titleLines = wrapText(product.name || product.title || 'Produto Ariana Móveis', isStory ? 24 : 30, isStory ? 4 : 3);
  const category = String(product.categoryName || product.category || '').trim();
  const titleY = isStory ? 128 : 116;
  const titleSize = isStory ? 54 : 46;
  const priceY = isStory ? 1370 : 830;
  const badgeX = isStory ? 700 : 750;
  const badgeY = priceY - 110;
  const topText = titleLines.map((line, idx) => `<text x="70" y="${titleY + idx * (titleSize + 12)}" font-size="${titleSize}" font-weight="900" fill="${TEXT_DARK}" font-family="Arial, Helvetica, sans-serif">${escapeXml(line)}</text>`).join('');

  return `
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#ffffff"/>
        <stop offset="48%" stop-color="#eef6ff"/>
        <stop offset="100%" stop-color="#dbeafe"/>
      </linearGradient>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#002b60" flood-opacity="0.20"/>
      </filter>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#bg)"/>
    <rect x="0" y="0" width="${width}" height="${isStory ? 88 : 72}" fill="${BRAND_BLUE}"/>
    <text x="70" y="${isStory ? 60 : 50}" font-size="${isStory ? 34 : 30}" font-weight="900" fill="#ffffff" font-family="Arial, Helvetica, sans-serif">ARIANA MÓVEIS</text>
    <text x="${isStory ? 560 : 620}" y="${isStory ? 60 : 50}" font-size="${isStory ? 22 : 20}" font-weight="800" fill="#ffffff" font-family="Arial, Helvetica, sans-serif">ONLINE • PARA TODO BRASIL</text>
    <circle cx="${width - 92}" cy="${isStory ? 44 : 36}" r="${isStory ? 28 : 24}" fill="${BRAND_YELLOW}"/>
    <text x="${width - 92}" y="${isStory ? 52 : 44}" text-anchor="middle" font-size="${isStory ? 20 : 18}" font-weight="900" fill="${BRAND_BLUE_DARK}" font-family="Arial, Helvetica, sans-serif">PIX</text>

    <rect x="45" y="${isStory ? 112 : 95}" width="${width - 90}" height="${isStory ? 1540 : 860}" rx="38" fill="#ffffff" filter="url(#shadow)"/>
    <rect x="70" y="${isStory ? 735 : 465}" width="${width - 140}" height="${isStory ? 560 : 275}" rx="34" fill="#f8fbff" stroke="#dbeafe"/>

    ${topText}
    ${category ? `<text x="70" y="${titleY + titleLines.length * (titleSize + 12) + 20}" font-size="${isStory ? 26 : 22}" font-weight="700" fill="#64748b" font-family="Arial, Helvetica, sans-serif">${escapeXml(category)}</text>` : ''}

    <rect x="70" y="${badgeY}" width="${isStory ? 310 : 250}" height="${isStory ? 82 : 64}" rx="18" fill="${BRAND_GREEN}"/>
    <text x="${isStory ? 225 : 195}" y="${badgeY + (isStory ? 55 : 43)}" text-anchor="middle" font-size="${isStory ? 36 : 28}" font-weight="900" fill="#ffffff" font-family="Arial, Helvetica, sans-serif">${pricing.pixPercent}% OFF</text>

    <text x="70" y="${priceY}" font-size="${isStory ? 34 : 28}" fill="#94a3b8" text-decoration="line-through" font-family="Arial, Helvetica, sans-serif">de ${brl(pricing.fullPrice)}</text>
    <text x="70" y="${priceY + (isStory ? 92 : 76)}" font-size="${isStory ? 72 : 62}" font-weight="900" fill="${TEXT_DARK}" font-family="Arial, Helvetica, sans-serif">${brl(pricing.pixPrice)}</text>
    <text x="${isStory ? 510 : 450}" y="${priceY + (isStory ? 92 : 76)}" font-size="${isStory ? 32 : 26}" font-weight="900" fill="${BRAND_GREEN}" font-family="Arial, Helvetica, sans-serif">no PIX à vista</text>
    <text x="70" y="${priceY + (isStory ? 150 : 126)}" font-size="${isStory ? 31 : 26}" font-weight="800" fill="#334155" font-family="Arial, Helvetica, sans-serif">ou ${pricing.installmentCount}x de ${brl(pricing.installmentPrice)} s/ juros</text>
    <text x="70" y="${priceY + (isStory ? 198 : 164)}" font-size="${isStory ? 25 : 21}" fill="#64748b" font-family="Arial, Helvetica, sans-serif">Total parcelado: ${brl(pricing.fullPrice)}</text>

    <rect x="70" y="${height - (isStory ? 210 : 120)}" width="${width - 140}" height="${isStory ? 105 : 72}" rx="22" fill="${BRAND_BLUE}"/>
    <text x="${width / 2}" y="${height - (isStory ? 145 : 75)}" text-anchor="middle" font-size="${isStory ? 42 : 31}" font-weight="900" fill="#ffffff" font-family="Arial, Helvetica, sans-serif">COMPRE AGORA</text>
    <text x="${width / 2}" y="${height - (isStory ? 78 : 31)}" text-anchor="middle" font-size="${isStory ? 26 : 18}" font-weight="700" fill="#dbeafe" font-family="Arial, Helvetica, sans-serif">arianamoveis.com.br</text>
  </svg>`;
}

export async function generateProductPosterBuffer(product = {}, options = {}) {
  const { default: sharp } = await import('sharp');
  const variant = options.variant === 'story' ? 'story' : 'square';
  const width = variant === 'story' ? 1080 : 1080;
  const height = variant === 'story' ? 1920 : 1080;
  const pricing = calculatePricing(product, Number(options.pixPercent || 17));
  const imageUrl = getMainImageUrl(product);
  const overlay = Buffer.from(baseSvg({ width, height, product, pricing, variant }));

  const composites = [{ input: overlay, top: 0, left: 0 }];
  const rawImage = await loadImageBuffer(imageUrl).catch(() => null);
  if (rawImage) {
    const imgWidth = variant === 'story' ? 840 : 620;
    const imgHeight = variant === 'story' ? 720 : 560;
    const imgLeft = Math.round((width - imgWidth) / 2);
    const imgTop = variant === 'story' ? 590 : 300;
    const productPng = await sharp(rawImage)
      .rotate()
      .resize(imgWidth, imgHeight, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png()
      .toBuffer();
    composites.push({ input: productPng, top: imgTop, left: imgLeft });
  }

  return sharp({ create: { width, height, channels: 4, background: '#ffffff' } })
    .composite(composites)
    .png()
    .toBuffer();
}
