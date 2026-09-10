from pathlib import Path
import re

path = Path('functions/poster-generator.js')
text = path.read_text(encoding='utf-8')

helper = r'''function professionalTextComposition({ product = {}, options = {}, layout = 'classic', headline = '', subtitle = '', productName = '', adaptive = {} }) {
  const hints = options.compositionHints && typeof options.compositionHints === 'object'
    ? options.compositionHints
    : null;
  const lightSurface = adaptive.primary !== '#FFFFFF';

  const productColor = lightSurface ? '#0A4A86' : '#FFF200';
  const headlineColor = lightSurface ? '#052B60' : '#FFFFFF';
  const subtitleColor = lightSurface ? '#2B5F88' : '#DDF4FF';

  const sideLeftProduct = ['showcase', 'split', 'azul_lateral_exato', 'varejo'].includes(layout);
  const sideRightProduct = ['catalog', 'diagonal'].includes(layout);
  const centered = !sideLeftProduct && !sideRightProduct;

  let productX = sideLeftProduct ? 785 : (sideRightProduct ? 285 : 540);
  let productY = sideLeftProduct ? 455 : (sideRightProduct ? 360 : 246);
  let productMaxChars = sideLeftProduct || sideRightProduct ? 28 : 36;

  if (hints && Number.isFinite(Number(hints.left)) && Number.isFinite(Number(hints.right))) {
    const left = Number(hints.left);
    const right = Number(hints.right);
    const top = Number(hints.top || 420);
    const leftSpace = Math.max(0, left - 38);
    const rightSpace = Math.max(0, 1080 - right - 38);

    if (rightSpace >= 315 && rightSpace >= leftSpace) {
      productX = Math.round(right + rightSpace / 2);
      productY = Math.max(390, Math.min(575, top + 58));
      productMaxChars = rightSpace >= 430 ? 30 : 24;
    } else if (leftSpace >= 315) {
      productX = Math.round(38 + leftSpace / 2);
      productY = Math.max(390, Math.min(575, top + 58));
      productMaxChars = leftSpace >= 430 ? 30 : 24;
    } else if (centered) {
      productX = 540;
      productY = Math.max(238, Math.min(350, top - 62));
      productMaxChars = 36;
    }
  }

  const productLines = wrapText(productName, productMaxChars, 2);
  const productSize = professionalTextSize(productName, 38, 33, 27);
  const productGap = productSize >= 36 ? 42 : 36;

  let subtitleY;
  let headlineY;
  let headlineMaxChars;
  let subtitleMaxChars;

  if (['azul_lateral_exato', 'varejo'].includes(layout)) {
    subtitleY = 238;
    headlineY = 292;
    headlineMaxChars = 38;
    subtitleMaxChars = 52;
    if (!hints) productY = 470;
  } else if (['showcase', 'split', 'catalog', 'diagonal'].includes(layout)) {
    headlineY = 235;
    subtitleY = 292;
    headlineMaxChars = 38;
    subtitleMaxChars = 48;
  } else {
    productY = Math.min(productY, 252);
    subtitleY = productY + (productLines.length - 1) * productGap + 54;
    headlineY = subtitleY + 48;
    headlineMaxChars = 40;
    subtitleMaxChars = 50;
  }

  const headlineLines = wrapText(headline, headlineMaxChars, 2);
  const subtitleLines = wrapText(subtitle, subtitleMaxChars, 2);
  const headlineSize = professionalTextSize(headline, 46, 40, 34);
  const subtitleSize = professionalTextSize(subtitle, 28, 25, 22);

  return {
    product: { x: productX, y: productY, lines: productLines, size: productSize, gap: productGap, color: productColor, weight: 950 },
    headline: { x: 540, y: headlineY, lines: headlineLines, size: headlineSize, gap: headlineSize + 7, color: headlineColor, weight: 950 },
    subtitle: { x: 540, y: subtitleY, lines: subtitleLines, size: subtitleSize, gap: subtitleSize + 6, color: subtitleColor, weight: 800 }
  };
}

function professionalTextBlockSvg(block = {}) {
  const lines = Array.isArray(block.lines) ? block.lines : [];
  return lines.map((line, index) => `<text x="${block.x}" y="${block.y + index * block.gap}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${block.size}" font-weight="${block.weight || 900}" fill="${block.color}">${escapeXml(line)}</text>`).join('');
}

'''

marker = 'function professionalForegroundSvg({ product = {}, pricing, options = {} }) {'
if 'function professionalTextComposition(' not in text:
    if marker not in text:
        raise SystemExit('professionalForegroundSvg não encontrada')
    text = text.replace(marker, helper + marker, 1)

old_vars = """  const productName = productNameRaw.toUpperCase();
  const productLines = wrapText(productName, 34, 2);
  const headlineSize = professionalTextSize(headline, 54, 46, 38);
  const productNameSize = professionalTextSize(productName, 36, 32, 27);"""
new_vars = """  const productName = productNameRaw;
  const textPlan = professionalTextComposition({ product, options, layout, headline, subtitle, productName: productNameRaw, adaptive });
  const productLines = textPlan.product.lines;
  const headlineSize = textPlan.headline.size;
  const productNameSize = textPlan.product.size;
  const headlineSvg = professionalTextBlockSvg(textPlan.headline);
  const subtitleSvg = professionalTextBlockSvg(textPlan.subtitle);
  const productNameSvg = professionalTextBlockSvg(textPlan.product);"""
if old_vars not in text:
    raise SystemExit('Bloco inicial das legendas não encontrado')
text = text.replace(old_vars, new_vars, 1)

text, n = re.subn(
    r"  const productNameTop = isVarejo \? 480 : \(isSplit \? 304 : 350\);\n  const standardProductNameX = .*?\n  const productNameSvg = .*?;\n",
    '', text, count=1, flags=re.S,
)
if n != 1:
    raise SystemExit(f'Posição fixa antiga não encontrada: {n}')

text = re.sub(
    r"\s*const exactProductLines = wrapText\(productNameRaw, 30, 2\);\n\s*const exactProductSize = professionalTextSize\(productNameRaw, 34, 30, 27\);",
    '', text, count=1,
)

exact_old = '''        <text x="540" y="248" text-anchor="middle" font-size="28" font-weight="800" fill="${lightText}">${escapeXml(subtitle)}</text>
        <text x="540" y="315" text-anchor="middle" font-size="${headlineSize}" font-weight="950" fill="${strongBlue}">${escapeXml(headline)}</text>

        ${exactProductLines.map((line, index) => `<text x="775" y="${495 + index * 42}" text-anchor="middle" font-size="${exactProductSize}" font-weight="900" fill="${richYellow}">${escapeXml(line)}</text>`).join('')}'''
if exact_old not in text:
    raise SystemExit('Legendas do Azul lateral exato não encontradas')
text = text.replace(exact_old, '''        ${subtitleSvg}
        ${headlineSvg}
        ${productNameSvg}''', 1)

varejo_old = '''      <text x="540" y="250" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="29" font-weight="800" fill="${varejoText.primary}">${escapeXml(subtitle)}</text>
      <text x="540" y="315" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${headlineSize}" font-weight="950" fill="${strongBlue}">${escapeXml(headline)}</text>
      ${productLines.map((line, index) => `<text x="770" y="${470 + index * 42}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${productNameSize}" font-weight="900" fill="${richYellow}">${escapeXml(line)}</text>`).join('')}'''
if varejo_old not in text:
    raise SystemExit('Legendas do Modelo lateral não encontradas')
text = text.replace(varejo_old, '''      ${subtitleSvg}
      ${headlineSvg}
      ${productNameSvg}''', 1)

standard_old = '''    <text x="540" y="${isSplit ? 222 : 274}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${headlineSize}" font-weight="950" fill="${adaptive.primary}">${escapeXml(headline)}</text>
    <text x="540" y="${isSplit ? 260 : 314}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="27" font-weight="750" fill="${adaptive.secondary}">${escapeXml(subtitle)}</text>
    ${productNameSvg}'''
if standard_old not in text:
    raise SystemExit('Legendas dos layouts padrão não encontradas')
text = text.replace(standard_old, '''    ${productNameSvg}
    ${subtitleSvg}
    ${headlineSvg}''', 1)

early = '  const foreground = Buffer.from(professionalForegroundSvg({ product, pricing, options }));\n'
if early not in text:
    raise SystemExit('Foreground antecipado não encontrado')
text = text.replace(early, '', 1)

push = '    composites.push({ input: productPng, left, top });'
if push not in text:
    raise SystemExit('Inserção do produto não encontrada')
text = text.replace(push, '''    options.compositionHints = {
      left,
      top,
      right: left + productW,
      bottom: top + productH,
      width: productW,
      height: productH
    };
    composites.push({ input: productPng, left, top });''', 1)

final_push = '  composites.push({ input: foreground, top: 0, left: 0 });'
if final_push not in text:
    raise SystemExit('Foreground final não encontrado')
text = text.replace(final_push, '''  const foreground = Buffer.from(professionalForegroundSvg({ product, pricing, options }));
  composites.push({ input: foreground, top: 0, left: 0 });''', 1)

required = [
    'À VISTA NO DINHEIRO OU PIX',
    'NO CARTÃO DE CRÉDITO',
    'VALOR PARCELADO: R$',
    'CREDIÁRIO PRÓPRIO',
    "fit: 'inside'",
    'const rawImage = await loadImageBuffer(imageUrl)',
    'Atendimento pelo WhatsApp',
    'arianamoveis.com.br'
]
for item in required:
    if item not in text:
        raise SystemExit(f'Regra protegida ausente: {item}')

path.write_text(text, encoding='utf-8')
