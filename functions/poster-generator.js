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
const CARD_STROKE = '#D6E8FF';

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

function layoutForVariant(variant) {
  const isStory = variant === 'story';
  if (isStory) {
    return {
      width: 1080,
      height: 1920,
      headerH: 112,
      shell: { x: 45, y: 132, w: 990, h: 1628, rx: 42 },
      title: { x: 70, y: 186, size: 42, gap: 49, maxChars: 28, maxLines: 3, catOffset: 17 },
      imageBox: { x: 70, y: 405, w: 940, h: 650, rx: 34 },
      img: { w: 900, h: 610, top: 425 },
      priceCard: { x: 70, y: 1090, w: 940, h: 395, rx: 34 },
      badge: { x: 92, y: 1120, w: 245, h: 66, fs: 28 },
      offerBadge: { w: 238, fs: 25 },
      oldPrice: { x: 92, y: 1232, fs: 30 },
      pixPrice: { x: 92, y: 1325, fs: 72 },
      pixText: { x: 555, y: 1325, fs: 31 },
      installment: { x: 92, y: 1386, fs: 29 },
      total: { x: 92, y: 1435, fs: 24 },
      cta: { x: 70, y: 1585, w: 940, h: 108, fs: 40, textY: 1653, phoneY: 1755, phoneFs: 28 }
    };
  }
  return {
    width: 1080,
    height: 1080,
    headerH: 92,
    shell: { x: 45, y: 112, w: 990, h: 920, rx: 42 },
    title: { x: 70, y: 158, size: 41, gap: 48, maxChars: 34, maxLines: 2, catOffset: 18 },
    imageBox: { x: 70, y: 265, w: 940, h: 405, rx: 30 },
    img: { w: 890, h: 385, top: 275 },
    priceCard: { x: 70, y: 695, w: 940, h: 255, rx: 30 },
    badge: { x: 92, y: 720, w: 225, h: 52, fs: 23 },
    offerBadge: { w: 210, fs: 22 },
    oldPrice: { x: 92, y: 812, fs: 25 },
    pixPrice: { x: 92, y: 875, fs: 55 },
    pixText: { x: 505, y: 875, fs: 25 },
    installment: { x: 92, y: 918, fs: 23 },
    total: { x: 92, y: 948, fs: 18 },
    cta: { x: 70, y: 972, w: 940, h: 74, fs: 30, textY: 1021, phoneY: 1063, phoneFs: 18 }
  };
}

function backgroundSvg({ width, height, variant }) {
  const L = layoutForVariant(variant);
  return `
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#ffffff"/>
        <stop offset="44%" stop-color="#eef6ff"/>
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
    <rect x="0" y="0" width="${width}" height="${L.headerH}" fill="url(#hero)"/>
    <circle cx="${width - (variant === 'story' ? 78 : 70)}" cy="${L.headerH / 2}" r="${variant === 'story' ? 31 : 27}" fill="${BRAND_YELLOW}"/>

    <rect x="${L.shell.x}" y="${L.shell.y}" width="${L.shell.w}" height="${L.shell.h}" rx="${L.shell.rx}" fill="#ffffff" filter="url(#shadow)"/>
    <rect x="${L.imageBox.x}" y="${L.imageBox.y}" width="${L.imageBox.w}" height="${L.imageBox.h}" rx="${L.imageBox.rx}" fill="#f8fbff" stroke="${CARD_STROKE}" stroke-width="2"/>
    <rect x="${L.priceCard.x}" y="${L.priceCard.y}" width="${L.priceCard.w}" height="${L.priceCard.h}" rx="${L.priceCard.rx}" fill="#ffffff" stroke="${CARD_STROKE}" stroke-width="2"/>
    <path d="M${L.imageBox.x + 28} ${L.imageBox.y + L.imageBox.h - 18} H${L.imageBox.x + L.imageBox.w - 28}" stroke="#e2e8f0" stroke-width="2"/>
  </svg>`;
}

function foregroundSvg({ width, height, product, pricing, variant }) {
  const L = layoutForVariant(variant);
  const isStory = variant === 'story';
  const titleLines = wrapText(product.name || product.title || 'Produto Ariana Móveis', L.title.maxChars, L.title.maxLines);
  const category = String(product.categoryName || product.category || '').trim();
  const titleText = titleLines.map((line, idx) => `
    <text x="${L.title.x}" y="${L.title.y + idx * L.title.gap}" font-size="${L.title.size}" font-weight="900" fill="${TEXT_DARK}" font-family="Arial, Helvetica, sans-serif">${escapeXml(line)}</text>`).join('');

  const whatsappLabel = isStory ? 'WHATSAPP (31) 98514-7119' : 'WhatsApp (31) 98514-7119';
  const offerX = L.badge.x + L.badge.w + 20;

  return `
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <text x="70" y="${isStory ? 70 : 58}" font-size="${isStory ? 36 : 32}" font-weight="900" fill="#ffffff" font-family="Arial, Helvetica, sans-serif">ARIANA MÓVEIS</text>
    <text x="${isStory ? 560 : 620}" y="${isStory ? 70 : 58}" font-size="${isStory ? 22 : 20}" font-weight="800" fill="#ffffff" font-family="Arial, Helvetica, sans-serif">ONLINE • PARA TODO BRASIL</text>
    <text x="${width - (isStory ? 78 : 70)}" y="${L.headerH / 2 + 8}" text-anchor="middle" font-size="${isStory ? 20 : 18}" font-weight="900" fill="${BRAND_BLUE_DARK}" font-family="Arial, Helvetica, sans-serif">PIX</text>

    ${titleText}
    ${category ? `<text x="70" y="${L.title.y + titleLines.length * L.title.gap + L.title.catOffset}" font-size="${isStory ? 25 : 22}" font-weight="800" fill="${TEXT_MUTED}" font-family="Arial, Helvetica, sans-serif">${escapeXml(category)}</text>` : ''}

    <rect x="${L.badge.x}" y="${L.badge.y}" width="${L.badge.w}" height="${L.badge.h}" rx="17" fill="${BRAND_GREEN}"/>
    <text x="${L.badge.x + L.badge.w / 2}" y="${L.badge.y + (isStory ? 43 : 34)}" text-anchor="middle" font-size="${L.badge.fs}" font-weight="900" fill="#ffffff" font-family="Arial, Helvetica, sans-serif">${pricing.pixPercent}% OFF</text>
    <rect x="${offerX}" y="${L.badge.y}" width="${L.offerBadge.w}" height="${L.badge.h}" rx="17" fill="${BRAND_ORANGE}"/>
    <text x="${offerX + L.offerBadge.w / 2}" y="${L.badge.y + (isStory ? 43 : 34)}" text-anchor="middle" font-size="${L.offerBadge.fs}" font-weight="900" fill="#ffffff" font-family="Arial, Helvetica, sans-serif">OFERTA PIX</text>

    <text x="${L.oldPrice.x}" y="${L.oldPrice.y}" font-size="${L.oldPrice.fs}" fill="#94a3b8" text-decoration="line-through" font-family="Arial, Helvetica, sans-serif">de ${brl(pricing.fullPrice)}</text>
    <text x="${L.pixPrice.x}" y="${L.pixPrice.y}" font-size="${L.pixPrice.fs}" font-weight="900" fill="${TEXT_DARK}" font-family="Arial, Helvetica, sans-serif">${brl(pricing.pixPrice)}</text>
    <text x="${L.pixText.x}" y="${L.pixText.y}" font-size="${L.pixText.fs}" font-weight="900" fill="${BRAND_GREEN}" font-family="Arial, Helvetica, sans-serif">no PIX à vista</text>
    <text x="${L.installment.x}" y="${L.installment.y}" font-size="${L.installment.fs}" font-weight="800" fill="#334155" font-family="Arial, Helvetica, sans-serif">ou ${pricing.installmentCount}x de ${brl(pricing.installmentPrice)} s/ juros no cartão</text>
    <text x="${L.total.x}" y="${L.total.y}" font-size="${L.total.fs}" fill="${TEXT_MUTED}" font-family="Arial, Helvetica, sans-serif">Total parcelado: ${brl(pricing.fullPrice)}</text>

    <rect x="${L.cta.x}" y="${L.cta.y}" width="${L.cta.w}" height="${L.cta.h}" rx="22" fill="${BRAND_BLUE}"/>
    <text x="${width / 2}" y="${L.cta.textY}" text-anchor="middle" font-size="${L.cta.fs}" font-weight="900" fill="#ffffff" font-family="Arial, Helvetica, sans-serif">COMPRE AGORA</text>
    <text x="${width / 2}" y="${L.cta.phoneY}" text-anchor="middle" font-size="${L.cta.phoneFs}" font-weight="900" fill="${BRAND_BLUE}" font-family="Arial, Helvetica, sans-serif">${whatsappLabel}</text>
  </svg>`;
}

export async function generateProductPosterBuffer(product = {}, options = {}) {
  const { default: sharp } = await import('sharp');
  const variant = options.variant === 'story' ? 'story' : 'square';
  const L = layoutForVariant(variant);
  const width = L.width;
  const height = L.height;
  const pricing = calculatePricing(product, Number(options.pixPercent || 17));
  const imageUrl = getMainImageUrl(product);

  const bg = Buffer.from(backgroundSvg({ width, height, variant }));
  const fg = Buffer.from(foregroundSvg({ width, height, product, pricing, variant }));
  const composites = [{ input: bg, top: 0, left: 0 }];

  const rawImage = await loadImageBuffer(imageUrl).catch(() => null);
  if (rawImage) {
    let pipeline = sharp(rawImage).rotate();
    try {
      pipeline = pipeline.flatten({ background: '#ffffff' }).trim({ background: '#ffffff', threshold: 18 });
    } catch (_error) {
      pipeline = sharp(rawImage).rotate();
    }

    const productPng = await pipeline
      .resize(L.img.w, L.img.h, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 0 },
        withoutEnlargement: false
      })
      .png()
      .toBuffer();
    composites.push({ input: productPng, top: L.img.top, left: Math.round((width - L.img.w) / 2) });
  }

  composites.push({ input: fg, top: 0, left: 0 });

  return sharp({ create: { width, height, channels: 4, background: '#ffffff' } })
    .composite(composites)
    .png()
    .toBuffer();
}
