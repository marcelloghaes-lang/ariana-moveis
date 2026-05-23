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
  return lines.length ? lines.slice(0, maxLines) : ['Produto Ariana Móveis'];
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

async function removeEdgeWhiteBackground(inputBuffer, sharp, options = {}) {
  const threshold = Number(options.threshold || 238);
  const tolerance = Number(options.tolerance || 34);

  const { data, info } = await sharp(inputBuffer)
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width;
  const height = info.height;
  const channels = info.channels;
  const visited = new Uint8Array(width * height);
  const queue = [];

  const isWhiteBackground = (pixelIndex) => {
    const offset = pixelIndex * channels;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const a = data[offset + 3];
    if (a <= 8) return true;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return r >= threshold && g >= threshold && b >= threshold && (max - min) <= tolerance;
  };

  const pushIfBackground = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const pixelIndex = y * width + x;
    if (visited[pixelIndex] || !isWhiteBackground(pixelIndex)) return;
    visited[pixelIndex] = 1;
    queue.push(pixelIndex);
  };

  for (let x = 0; x < width; x += 1) {
    pushIfBackground(x, 0);
    pushIfBackground(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    pushIfBackground(0, y);
    pushIfBackground(width - 1, y);
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const pixelIndex = queue[cursor];
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    pushIfBackground(x + 1, y);
    pushIfBackground(x - 1, y);
    pushIfBackground(x, y + 1);
    pushIfBackground(x, y - 1);
  }

  for (let i = 0; i < visited.length; i += 1) {
    if (visited[i]) data[i * channels + 3] = 0;
  }

  const transparentPng = await sharp(data, { raw: info }).png().toBuffer();
  try {
    return await sharp(transparentPng)
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 })
      .png()
      .toBuffer();
  } catch (_error) {
    return transparentPng;
  }
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

function foregroundSvg({ width, height, product, pricing, variant }) {
  const L = layoutForVariant(variant);
  const isStory = variant === 'story';
  const titleLines = wrapText(product.name || product.title || 'Produto Ariana Móveis', L.title.maxChars, L.title.maxLines);
  const category = String(product.categoryName || product.category || '').trim();
  const titleText = titleLines.map((line, idx) => `
    <text x="${L.title.x}" y="${L.title.y + idx * L.title.gap}" font-size="${L.title.size}" font-weight="900" fill="${TEXT_DARK}" font-family="Arial, Helvetica, sans-serif">${escapeXml(line)}</text>`).join('');

  const whatsappLabel = 'WHATSAPP (31) 98514-7119';
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
  const preset = productImagePreset(product, variant);

  const bg = Buffer.from(backgroundSvg({ width, height, variant }));
  const fg = Buffer.from(foregroundSvg({ width, height, product, pricing, variant }));
  const composites = [{ input: bg, top: 0, left: 0 }];

  const rawImage = await loadImageBuffer(imageUrl).catch(() => null);
  if (rawImage) {
    const transparentProduct = await removeEdgeWhiteBackground(rawImage, sharp).catch(() => rawImage);

    const finalW = Math.round(preset.w * preset.zoom);
    const finalH = Math.round(preset.h * preset.zoom);

    const productPng = await sharp(transparentProduct)
      .resize(finalW, finalH, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 0 },
        withoutEnlargement: false
      })
      .png()
      .toBuffer();

    /*
      V31:
      Centraliza a imagem final no eixo X, mas prende o topo por categoria.
      Isso evita que zoom alto empurre guarda-roupa/máquina para cima ou para baixo
      e melhora o aproveitamento da área branca.
    */
    composites.push({
      input: productPng,
      top: Math.round(preset.top),
      left: Math.round((width - finalW) / 2)
    });
  }

  composites.push({ input: fg, top: 0, left: 0 });

  return sharp({ create: { width, height, channels: 4, background: '#ffffff' } })
    .composite(composites)
    .png()
    .toBuffer();
}
