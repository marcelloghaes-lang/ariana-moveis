from pathlib import Path
import re

path = Path('functions/poster-generator.js')
text = path.read_text(encoding='utf-8')

new_function = r'''function professionalTextComposition({ product = {}, options = {}, layout = 'classic', headline = '', subtitle = '', productName = '', adaptive = {} }) {
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
  const headlineLines = wrapText(headline, 40, 2);
  const subtitleLines = wrapText(subtitle, 50, 2);
  const headlineSize = professionalTextSize(headline, 46, 40, 34);
  const subtitleSize = professionalTextSize(subtitle, 28, 25, 22);
  const headlineGap = headlineSize + 7;
  const subtitleGap = subtitleSize + 6;

  // Calcula a caixa visual aproximada de cada bloco para impedir que uma
  // legenda invada outra legenda ou a fotografia/recorte do produto.
  const blockRect = (block) => {
    const lines = Array.isArray(block.lines) && block.lines.length ? block.lines : [''];
    const longest = lines.reduce((max, line) => Math.max(max, String(line).length), 0);
    const width = Math.min(980, Math.max(90, longest * block.size * 0.56));
    return {
      left: block.x - width / 2,
      right: block.x + width / 2,
      top: block.y - block.size,
      bottom: block.y + (lines.length - 1) * block.gap + block.size * 0.32,
      width
    };
  };

  const placeAwayFromImage = (block) => {
    if (!hints || !Number.isFinite(Number(hints.left)) || !Number.isFinite(Number(hints.right)) || !Number.isFinite(Number(hints.top)) || !Number.isFinite(Number(hints.bottom))) {
      return block;
    }

    const image = {
      left: Number(hints.left) - 18,
      right: Number(hints.right) + 18,
      top: Number(hints.top) - 18,
      bottom: Number(hints.bottom) + 18
    };
    const rect = blockRect(block);
    const collides = rect.right > image.left && rect.left < image.right && rect.bottom > image.top && rect.top < image.bottom;
    if (!collides) return block;

    const leftSpace = Math.max(0, image.left - 30);
    const rightSpace = Math.max(0, 1080 - image.right - 30);
    const needed = rect.width + 34;

    if (rightSpace >= needed || leftSpace >= needed) {
      if (rightSpace >= leftSpace) {
        block.x = Math.round(image.right + rightSpace / 2 + 15);
      } else {
        block.x = Math.round(15 + leftSpace / 2);
      }
      return block;
    }

    // Se não houver coluna lateral suficiente, mantém o texto acima da imagem
    // com uma folga real, sem reduzir nem deslocar a própria imagem do produto.
    const lastLineOffset = (block.lines.length - 1) * block.gap;
    const safeBaseline = Math.floor(image.top - 24 - lastLineOffset);
    if (safeBaseline >= 205) block.y = Math.min(block.y, safeBaseline);
    return block;
  };

  let productBlock;
  let headlineBlock;
  let subtitleBlock;

  if (['azul_lateral_exato', 'varejo'].includes(layout)) {
    subtitleBlock = { x: 540, y: 225, lines: subtitleLines, size: subtitleSize, gap: subtitleGap, color: subtitleColor, weight: 800 };
    const subtitleLast = subtitleBlock.y + (subtitleLines.length - 1) * subtitleGap;
    headlineBlock = { x: 540, y: subtitleLast + subtitleSize + 24, lines: headlineLines, size: headlineSize, gap: headlineGap, color: headlineColor, weight: 950 };
    if (!hints) productY = 470;
    productBlock = { x: productX, y: productY, lines: productLines, size: productSize, gap: productGap, color: productColor, weight: 950 };
  } else if (['showcase', 'split', 'catalog', 'diagonal'].includes(layout)) {
    headlineBlock = { x: 540, y: 225, lines: headlineLines, size: headlineSize, gap: headlineGap, color: headlineColor, weight: 950 };
    const headlineLast = headlineBlock.y + (headlineLines.length - 1) * headlineGap;
    subtitleBlock = { x: 540, y: headlineLast + headlineSize + 22, lines: subtitleLines, size: subtitleSize, gap: subtitleGap, color: subtitleColor, weight: 800 };
    productBlock = { x: productX, y: productY, lines: productLines, size: productSize, gap: productGap, color: productColor, weight: 950 };
  } else {
    productY = Math.min(productY, 252);
    productBlock = { x: productX, y: productY, lines: productLines, size: productSize, gap: productGap, color: productColor, weight: 950 };
    const productLast = productBlock.y + (productLines.length - 1) * productGap;
    subtitleBlock = { x: 540, y: productLast + productSize + 26, lines: subtitleLines, size: subtitleSize, gap: subtitleGap, color: subtitleColor, weight: 800 };
    const subtitleLast = subtitleBlock.y + (subtitleLines.length - 1) * subtitleGap;
    headlineBlock = { x: 540, y: subtitleLast + subtitleSize + 26, lines: headlineLines, size: headlineSize, gap: headlineGap, color: headlineColor, weight: 950 };
  }

  productBlock = placeAwayFromImage(productBlock);
  headlineBlock = placeAwayFromImage(headlineBlock);
  subtitleBlock = placeAwayFromImage(subtitleBlock);

  return {
    product: productBlock,
    headline: headlineBlock,
    subtitle: subtitleBlock
  };
}
'''

pattern = r"function professionalTextComposition\(\{ product = \{\}, options = \{\}, layout = 'classic', headline = '', subtitle = '', productName = '', adaptive = \{\} \}\) \{.*?\n\}\n\nfunction professionalTextBlockSvg"
replacement = new_function + "\nfunction professionalTextBlockSvg"
text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
if count != 1:
    raise SystemExit(f'professionalTextComposition não encontrada de forma única: {count}')

old_pricing = '''      <text x="540" y="1017" text-anchor="middle" font-size="31" font-weight="950" fill="${adaptive.primary}">${pricing.installmentCount}X DE ${escapeXml(installmentValue)} NO CARTÃO DE CRÉDITO</text>
      <text x="540" y="1055" text-anchor="middle" font-size="23" font-weight="850" fill="${adaptive.secondary}">VALOR PARCELADO: R$ ${escapeXml(fullValue)}</text>
      <text x="540" y="1092" text-anchor="middle" font-size="19" font-weight="850" fill="${adaptive.secondary}">CONSULTE CONDIÇÕES DE PAGAMENTO NO CREDIÁRIO PRÓPRIO</text>'''
new_pricing = '''      <text x="650" y="1017" text-anchor="middle" font-size="29" font-weight="950" fill="${adaptive.primary}">${pricing.installmentCount}X DE ${escapeXml(installmentValue)} NO CARTÃO DE CRÉDITO</text>
      <text x="650" y="1055" text-anchor="middle" font-size="23" font-weight="850" fill="${adaptive.secondary}">VALOR PARCELADO: R$ ${escapeXml(fullValue)}</text>
      <text x="650" y="1092" text-anchor="middle" font-size="19" font-weight="850" fill="${adaptive.secondary}">CONSULTE CONDIÇÕES DE PAGAMENTO NO CREDIÁRIO PRÓPRIO</text>'''
if old_pricing not in text:
    raise SystemExit('Bloco longo de pagamento padrão não encontrado')
text = text.replace(old_pricing, new_pricing, 1)

protected = [
    'À VISTA NO DINHEIRO OU PIX',
    'NO CARTÃO DE CRÉDITO',
    'VALOR PARCELADO: R$',
    'CREDIÁRIO PRÓPRIO',
    'Atendimento pelo WhatsApp',
    'arianamoveis.com.br',
    "fit: 'inside'",
    'removeEdgeConnectedLightBackground'
]
for item in protected:
    if item not in text:
        raise SystemExit(f'Regra protegida ausente após o patch: {item}')

path.write_text(text, encoding='utf-8')
