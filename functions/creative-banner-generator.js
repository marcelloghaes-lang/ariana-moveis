import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const CREATIVE_BANNER_FORMATS = Object.freeze({
  site_hero_desktop: Object.freeze({ width: 1920, height: 480, label: 'Banner principal • Desktop', device: 'desktop' }),
  site_hero_mobile: Object.freeze({ width: 1080, height: 1080, label: 'Banner principal • Celular', device: 'mobile' }),
  site_secondary_desktop: Object.freeze({ width: 1600, height: 400, label: 'Banner secundário • Desktop', device: 'desktop' }),
  site_secondary_mobile: Object.freeze({ width: 1080, height: 720, label: 'Banner secundário • Celular', device: 'mobile' }),
  site_card_square: Object.freeze({ width: 1080, height: 1080, label: 'Card quadrado • Site', device: 'all' })
});

const PALETTES = Object.freeze({
  azul: { bg1: '#0047AB', bg2: '#062B63', accent: '#FFD51B', soft: '#EAF4FF', ink: '#FFFFFF', price: '#FFD51B' },
  celeste: { bg1: '#087CCB', bg2: '#0056A7', accent: '#FFD51B', soft: '#E8F7FF', ink: '#FFFFFF', price: '#FFD51B' },
  champagne: { bg1: '#705126', bg2: '#3F2C17', accent: '#F5D796', soft: '#FFF7E7', ink: '#FFFFFF', price: '#F5D796' },
  salvia: { bg1: '#426758', bg2: '#203B31', accent: '#E7D77D', soft: '#EDF6F0', ink: '#FFFFFF', price: '#F5E79C' },
  areia: { bg1: '#8A5135', bg2: '#4E2E20', accent: '#FFD49C', soft: '#FFF0E7', ink: '#FFFFFF', price: '#FFD49C' },
  prata: { bg1: '#455668', bg2: '#1D2935', accent: '#DDE7F0', soft: '#F4F7FA', ink: '#FFFFFF', price: '#FFFFFF' },
  lilas: { bg1: '#694E92', bg2: '#352650', accent: '#F3D977', soft: '#F4EDFF', ink: '#FFFFFF', price: '#F3D977' },
  amarelo: { bg1: '#E6A900', bg2: '#A56B00', accent: '#062B63', soft: '#FFF8CC', ink: '#062B63', price: '#062B63' },
  dourado: { bg1: '#7A4D12', bg2: '#362006', accent: '#FFD56B', soft: '#FFF3D5', ink: '#FFFFFF', price: '#FFD56B' },
  esmeralda: { bg1: '#087A60', bg2: '#03483A', accent: '#FFD86B', soft: '#E9FFF9', ink: '#FFFFFF', price: '#FFD86B' },
  violeta: { bg1: '#5D31A0', bg2: '#28154A', accent: '#FFD86B', soft: '#F4ECFF', ink: '#FFFFFF', price: '#FFD86B' }
});

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function money(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Math.max(0, toNumber(value, 0)));
}

function escapeXml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function cleanText(value = '', max = 120) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function wrapText(value = '', maxChars = 28, maxLines = 2) {
  const words = cleanText(value, 180).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? current + ' ' + word : word;
    if (candidate.length <= maxChars || !current) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length >= maxLines - 1) break;
  }
  if (current && lines.length < maxLines) lines.push(current);

  const consumed = lines.join(' ').length;
  const source = words.join(' ');
  if (lines.length && consumed < source.length - 2) {
    lines[lines.length - 1] = lines[lines.length - 1].replace(/[.…]*$/, '') + '…';
  }
  return lines;
}

export function resolveCreativeBannerFormat(format = '') {
  const key = String(format || '').trim().toLowerCase();
  const selected = CREATIVE_BANNER_FORMATS[key] || CREATIVE_BANNER_FORMATS.site_hero_desktop;
  const id = CREATIVE_BANNER_FORMATS[key] ? key : 'site_hero_desktop';
  return { id, ...selected };
}

function decodeDataUrl(url = '') {
  const match = String(url).match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) return null;
  return match[2]
    ? Buffer.from(match[3], 'base64')
    : Buffer.from(decodeURIComponent(match[3]), 'utf8');
}

async function loadImageBuffer(url = '') {
  const value = String(url || '').trim();
  if (!value) return null;
  if (value.startsWith('data:')) return decodeDataUrl(value);

  if (/^https?:\/\//i.test(value)) {
    const response = await fetch(value, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('product_image_http_' + response.status);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 20 * 1024 * 1024) throw new Error('product_image_too_large');
    return Buffer.from(bytes);
  }

  if (fs.existsSync(value)) return fs.readFileSync(value);
  return null;
}

function mainImage(product = {}, options = {}) {
  const images = Array.isArray(product.images) ? product.images : [];
  const fromList = images.find(item => item?.isMain && (item.url || item.imageUrl))
    || images.find(item => item?.url || item?.imageUrl);
  return String(
    options.imageUrl ||
    product.mainImageUrl ||
    product.imageUrl ||
    product.image ||
    product.imagem ||
    fromList?.url ||
    fromList?.imageUrl ||
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

function templateTag(template = '') {
  const key = String(template || '').toLowerCase();
  if (key === 'queima') return 'QUEIMA DE ESTOQUE';
  if (key === 'campanha') return 'CAMPANHA ESPECIAL';
  return 'OFERTA ARIANA';
}

function bannerLayout(format) {
  const split = format.width / format.height >= 1.4;
  if (split) {
    const pad = Math.round(format.height * 0.085);
    const productW = Math.round(format.width * 0.40);
    const productX = format.width - productW - pad;
    return {
      split: true,
      pad,
      logoW: Math.round(format.height * 0.46),
      logoH: Math.round(format.height * 0.16),
      productBox: {
        x: productX,
        y: pad,
        w: productW,
        h: format.height - pad * 2
      },
      textW: productX - pad * 1.7
    };
  }

  const pad = Math.round(format.width * 0.065);
  return {
    split: false,
    pad,
    logoW: Math.round(format.width * 0.27),
    logoH: Math.round(format.width * 0.078),
    productBox: {
      x: Math.round(format.width * 0.12),
      y: Math.round(format.height * 0.30),
      w: Math.round(format.width * 0.76),
      h: Math.round(format.height * 0.36)
    },
    textW: format.width - pad * 2
  };
}

function backgroundSvg(format, palette, layout) {
  const { width, height } = format;
  const product = layout.productBox;
  const radius = Math.max(24, Math.round(Math.min(width, height) * 0.045));
  return Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${palette.bg1}"/>
          <stop offset="1" stop-color="${palette.bg2}"/>
        </linearGradient>
        <radialGradient id="glow" cx="82%" cy="38%" r="70%">
          <stop offset="0" stop-color="#ffffff" stop-opacity=".22"/>
          <stop offset=".55" stop-color="#ffffff" stop-opacity=".04"/>
          <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
        </radialGradient>
        <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="${Math.round(height * 0.018)}" stdDeviation="${Math.round(height * 0.025)}" flood-color="#001638" flood-opacity=".34"/>
        </filter>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#bg)"/>
      <rect width="${width}" height="${height}" fill="url(#glow)"/>
      <circle cx="${Math.round(width * .92)}" cy="${Math.round(height * .08)}" r="${Math.round(height * .30)}" fill="${palette.accent}" opacity=".08"/>
      <circle cx="${Math.round(width * .08)}" cy="${Math.round(height * .94)}" r="${Math.round(height * .42)}" fill="#ffffff" opacity=".05"/>
      <rect x="${product.x}" y="${product.y}" width="${product.w}" height="${product.h}" rx="${radius}" fill="#ffffff" opacity=".98" filter="url(#shadow)"/>
      <rect x="${product.x + 2}" y="${product.y + 2}" width="${product.w - 4}" height="${product.h - 4}" rx="${Math.max(20,radius-2)}" fill="none" stroke="#ffffff" stroke-opacity=".72" stroke-width="3"/>
    </svg>
  `);
}

function lineSvg(lines, x, y, size, lineHeight, color, weight = 900, anchor = 'start') {
  return lines.map((line, index) =>
    `<text x="${x}" y="${y + index * lineHeight}" text-anchor="${anchor}" font-family="Arial,Helvetica,sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}">${escapeXml(line)}</text>`
  ).join('');
}

function overlaySvg(format, palette, layout, product = {}, options = {}) {
  const { width, height } = format;
  const split = layout.split;
  const headline = cleanText(options.headline || templateTag(options.template), 70).toUpperCase();
  const subtitle = cleanText(options.subtitle || 'Porque sua casa merece o melhor', 90);
  const productName = cleanText(options.productName || product.name || product.title || 'Produto Ariana Móveis', 100);
  const cash = toNumber(options.cashPrice ?? product.cashPrice ?? product.pixPrice ?? product.price, 0);
  const full = toNumber(options.fullPrice ?? product.fullPrice ?? product.price, cash);
  const installments = Math.max(1, Math.round(toNumber(options.installmentCount ?? product.installmentCount, 12)));
  const installmentPrice = toNumber(options.installmentPrice ?? product.installmentPrice, full / installments);
  const tag = templateTag(options.template);
  const domain = cleanText(options.siteLabel || 'arianamoveis.com.br', 50);
  const pad = layout.pad;

  if (split) {
    const tagFs = Math.round(height * .042);
    const headlineFs = Math.round(height * (headline.length > 30 ? .078 : .095));
    const subtitleFs = Math.round(height * .038);
    const nameFs = Math.round(height * .046);
    const priceFs = Math.round(height * .118);
    const installmentFs = Math.round(height * .038);
    const headlineLines = wrapText(headline, Math.max(16, Math.floor(layout.textW / (headlineFs * .55))), 2);
    const nameLines = wrapText(productName, Math.max(25, Math.floor(layout.textW / (nameFs * .52))), 2);
    const x = pad;
    const logoBottom = pad + layout.logoH;
    const tagY = logoBottom + tagFs * .98;
    const headlineY = tagY + headlineFs * 1.18;
    const headlineH = headlineLines.length * headlineFs * 1.00;
    const subtitleY = headlineY + headlineH + subtitleFs * .28;
    const nameY = subtitleY + subtitleFs * 1.42;
    const ctaH = Math.round(height * .068);
    const ctaY = height - pad - ctaH;
    const installmentY = ctaY - Math.round(height * .020);
    const priceY = installmentY - installmentFs * 1.22;

    return Buffer.from(`
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect x="${x}" y="${tagY - tagFs}" width="${Math.round(tag.length * tagFs * .62 + tagFs * 1.15)}" height="${Math.round(tagFs * 1.45)}" rx="${Math.round(tagFs * .7)}" fill="${palette.accent}"/>
        <text x="${x + Math.round(tagFs * .58)}" y="${tagY}" font-family="Arial,Helvetica,sans-serif" font-size="${tagFs}" font-weight="900" fill="${palette.bg2}">${escapeXml(tag)}</text>
        ${lineSvg(headlineLines, x, headlineY, headlineFs, headlineFs * 1.02, palette.ink, 950)}
        <text x="${x}" y="${subtitleY}" font-family="Arial,Helvetica,sans-serif" font-size="${subtitleFs}" font-weight="700" fill="${palette.ink}" opacity=".92">${escapeXml(subtitle)}</text>
        ${lineSvg(nameLines, x, nameY, nameFs, nameFs * 1.05, palette.ink, 800)}
        <text x="${x}" y="${priceY - priceFs * .63}" font-family="Arial,Helvetica,sans-serif" font-size="${Math.round(priceFs * .30)}" font-weight="800" fill="${palette.ink}" opacity=".88">À VISTA NO PIX</text>
        <text x="${x}" y="${priceY}" font-family="Arial,Helvetica,sans-serif" font-size="${priceFs}" font-weight="950" fill="${palette.price}">${escapeXml(money(cash))}</text>
        <text x="${x}" y="${installmentY}" font-family="Arial,Helvetica,sans-serif" font-size="${installmentFs}" font-weight="850" fill="${palette.ink}">ou ${installments}x de ${escapeXml(money(installmentPrice))} no cartão</text>
        <rect x="${x}" y="${ctaY}" width="${Math.round(layout.textW * .48)}" height="${ctaH}" rx="${Math.round(ctaH*.50)}" fill="#ffffff"/>
        <text x="${x + Math.round(layout.textW*.24)}" y="${ctaY + Math.round(ctaH*.68)}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="${Math.round(height*.032)}" font-weight="900" fill="${palette.bg1}">COMPRE NO SITE</text>
        <text x="${x + Math.round(layout.textW*.51)}" y="${ctaY + Math.round(ctaH*.68)}" font-family="Arial,Helvetica,sans-serif" font-size="${Math.round(height*.031)}" font-weight="800" fill="${palette.ink}">${escapeXml(domain)}</text>
      </svg>
    `);
  }

  const center = width / 2;
  const tagFs = Math.round(width * .030);
  const headlineFs = Math.round(width * (headline.length > 28 ? .055 : .062));
  const nameFs = Math.round(width * .036);
  const priceFs = Math.round(width * .071);
  const installmentFs = Math.round(width * .030);
  const headlineLines = wrapText(headline, 26, 2);
  const nameLines = wrapText(productName, 36, 2);
  const logoBottom = pad + layout.logoH;
  const tagY = logoBottom + Math.round(height * .030);
  const headlineY = tagY + Math.round(height * .065);
  const productBottom = layout.productBox.y + layout.productBox.h;
  const nameY = productBottom + Math.round(height*.052);
  const ctaH = Math.round(height * .060);
  const ctaY = height - pad - ctaH;
  const installmentY = ctaY - Math.round(height * .026);
  const priceY = installmentY - Math.round(height * .050);

  return Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${Math.round(width*.34)}" y="${tagY - tagFs}" width="${Math.round(width*.32)}" height="${Math.round(tagFs*1.55)}" rx="${Math.round(tagFs*.78)}" fill="${palette.accent}"/>
      <text x="${center}" y="${tagY}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="${tagFs}" font-weight="900" fill="${palette.bg2}">${escapeXml(tag)}</text>
      ${lineSvg(headlineLines, center, headlineY, headlineFs, headlineFs * 1.04, palette.ink, 950, 'middle')}
      ${lineSvg(nameLines, center, nameY, nameFs, nameFs * 1.08, palette.ink, 850, 'middle')}
      <text x="${center}" y="${priceY - Math.round(priceFs*.58)}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="${Math.round(priceFs*.30)}" font-weight="800" fill="${palette.ink}" opacity=".9">À VISTA NO PIX</text>
      <text x="${center}" y="${priceY}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="${priceFs}" font-weight="950" fill="${palette.price}">${escapeXml(money(cash))}</text>
      <text x="${center}" y="${installmentY}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="${installmentFs}" font-weight="850" fill="${palette.ink}">ou ${installments}x de ${escapeXml(money(installmentPrice))} no cartão</text>
      <rect x="${Math.round(width*.17)}" y="${ctaY}" width="${Math.round(width*.66)}" height="${ctaH}" rx="${Math.round(ctaH*.50)}" fill="#ffffff"/>
      <text x="${center}" y="${ctaY + Math.round(ctaH*.66)}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="${Math.round(width*.026)}" font-weight="900" fill="${palette.bg1}">COMPRE NO SITE • ${escapeXml(domain)}</text>
    </svg>
  `);
}

export async function generateCreativeBannerBuffer(product = {}, options = {}) {
  const { default: sharp } = await import('sharp');
  const format = resolveCreativeBannerFormat(options.outputFormat || options.format || options.variant);
  const palette = PALETTES[String(options.colorTheme || 'azul').toLowerCase()] || PALETTES.azul;
  const layout = bannerLayout(format);
  const base = backgroundSvg(format, palette, layout);
  const overlay = overlaySvg(format, palette, layout, product, options);
  const composites = [{ input: base, top: 0, left: 0 }];

  const logo = logoPath();
  if (!logo) throw new Error('official_ariana_logo_missing');
  const logoBuffer = await sharp(logo)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 5 })
    .resize(layout.logoW, layout.logoH, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toBuffer();
  composites.push({
    input: logoBuffer,
    top: layout.pad,
    left: layout.split ? layout.pad : Math.round((format.width - layout.logoW) / 2)
  });

  const source = mainImage(product, options);
  const rawProduct = await loadImageBuffer(source).catch(() => null);
  if (rawProduct) {
    let pipeline = sharp(rawProduct).rotate().ensureAlpha();
    try {
      pipeline = pipeline.trim({ background: '#ffffff', threshold: 22 });
    } catch (_) {}

    const box = layout.productBox;
    const marginX = Math.round(box.w * .07);
    const marginY = Math.round(box.h * .07);
    const productPng = await pipeline
      .resize(Math.max(60, box.w - marginX * 2), Math.max(60, box.h - marginY * 2), {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 0 },
        withoutEnlargement: false
      })
      .png()
      .toBuffer();
    const meta = await sharp(productPng).metadata();
    const w = Number(meta.width || 1);
    const h = Number(meta.height || 1);
    composites.push({
      input: productPng,
      left: Math.round(box.x + (box.w - w) / 2),
      top: Math.round(box.y + (box.h - h) / 2)
    });
  }

  composites.push({ input: overlay, top: 0, left: 0 });

  return sharp({
    create: {
      width: format.width,
      height: format.height,
      channels: 4,
      background: { r: 0, g: 71, b: 171, alpha: 1 }
    }
  })
    .composite(composites)
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}
