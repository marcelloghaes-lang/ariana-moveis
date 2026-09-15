from pathlib import Path

# Esta alteração é deliberadamente aditiva: só acrescenta um novo layout e
# não substitui os layouts, preços, recorte de produto ou demais regras atuais.

html_path = Path('public/gerador_cartazes.html')
css_path = Path('public/css/gerador_cartazes.css')
poster_path = Path('functions/poster-generator.js')

html = html_path.read_text(encoding='utf-8')
css = css_path.read_text(encoding='utf-8')
poster = poster_path.read_text(encoding='utf-8')

layout_id = 'mascote_lateral_clean'

# 1) Nova opção no painel, sem remover as existentes.
if f'value="{layout_id}"' not in html:
    anchor = '          <label class="template-card layout-card layout-card-featured"><input type="radio" name="layout-variant" value="azul_lateral_exato"><span class="layout-swatch layout-azul-lateral-exato"></span><b>Azul lateral exato</b><small>Modelo fiel ao cartaz enviado</small></label>\n'
    card = '          <label class="template-card layout-card"><input type="radio" name="layout-variant" value="mascote_lateral_clean"><span class="layout-swatch layout-mascote-clean"></span><b>Mascote lateral clean</b><small>Mascote à direita e área livre à esquerda</small></label>\n'
    if anchor not in html:
        raise SystemExit('Card de referência do layout não encontrado')
    html = html.replace(anchor, anchor + card, 1)

html = html.replace('./css/gerador_cartazes.css?v=20260908-5', './css/gerador_cartazes.css?v=20260915-1')

# 2) Miniatura visual do novo layout no painel.
if '.layout-mascote-clean' not in css:
    anchor = '.layout-azul-lateral-exato:after{width:58px;height:7px;left:6px;bottom:4px;background:#ffd400}'
    swatch = anchor + '.layout-mascote-clean{background:linear-gradient(180deg,#95ddff 0 72%,#0a95e8 72% 83%,#06366f 83% 100%);box-shadow:inset 0 0 0 1px #ffffff88}.layout-mascote-clean:before{width:22px;height:31px;right:8px;top:8px;background:#fff;border-radius:10px 10px 4px 4px;box-shadow:-35px 8px 0 -5px #e8f7ff}.layout-mascote-clean:after{width:58px;height:6px;left:6px;bottom:4px;background:#ffd400}'
    if anchor not in css:
        raise SystemExit('Âncora CSS do layout lateral não encontrada')
    css = css.replace(anchor, swatch, 1)

# 3) Fundo próprio do novo layout, inspirado no modelo enviado.
if "layout === 'mascote_lateral_clean'" not in poster:
    anchor = "  const palette = professionalPalette(template, colorTheme);\n  const layout = String(layoutVariant || 'classic').toLowerCase();\n\n  if (layout === 'azul_lateral_exato') {"
    background = """  const palette = professionalPalette(template, colorTheme);\n  const layout = String(layoutVariant || 'classic').toLowerCase();\n\n  if (layout === 'mascote_lateral_clean') {\n    return `\n    <svg width=\"1080\" height=\"1350\" viewBox=\"0 0 1080 1350\" xmlns=\"http://www.w3.org/2000/svg\">\n      <defs>\n        <linearGradient id=\"cleanBg\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\">\n          <stop offset=\"0%\" stop-color=\"#9BE1FF\"/>\n          <stop offset=\"38%\" stop-color=\"#27B3F1\"/>\n          <stop offset=\"100%\" stop-color=\"#078FE4\"/>\n        </linearGradient>\n        <radialGradient id=\"cleanGlow\" cx=\"50%\" cy=\"8%\" r=\"68%\">\n          <stop offset=\"0%\" stop-color=\"#FFFFFF\" stop-opacity=\".72\"/>\n          <stop offset=\"100%\" stop-color=\"#FFFFFF\" stop-opacity=\"0\"/>\n        </radialGradient>\n        <filter id=\"cleanShadow\" x=\"-40%\" y=\"-100%\" width=\"180%\" height=\"300%\">\n          <feGaussianBlur stdDeviation=\"16\"/>\n        </filter>\n      </defs>\n      <rect width=\"1080\" height=\"1350\" fill=\"url(#cleanBg)\"/>\n      <rect width=\"1080\" height=\"1190\" fill=\"url(#cleanGlow)\"/>\n      <path d=\"M0 655 C210 770 430 825 650 790 C845 760 970 690 1080 625 L1080 1040 C845 1010 650 1080 455 1050 C260 1022 125 930 0 865 Z\" fill=\"#006FCB\" opacity=\".24\"/>\n      <path d=\"M0 800 C230 905 460 955 680 920 C865 890 995 835 1080 785 L1080 1110 C855 1085 660 1130 450 1110 C245 1088 105 1020 0 955 Z\" fill=\"#0B83D9\" opacity=\".26\"/>\n      <ellipse cx=\"830\" cy=\"1100\" rx=\"180\" ry=\"27\" fill=\"#062B63\" opacity=\".20\" filter=\"url(#cleanShadow)\"/>\n      <rect x=\"0\" y=\"1190\" width=\"1080\" height=\"160\" fill=\"#062F68\"/>\n      <rect x=\"0\" y=\"1190\" width=\"1080\" height=\"6\" fill=\"#FFD400\"/>\n      <path d=\"M0 1190 H60 L20 1248 H0 Z\" fill=\"#FFD400\"/>\n      <path d=\"M1080 1190 H1020 L1060 1248 H1080 Z\" fill=\"#FFD400\"/>\n      <path d=\"M0 1344 H72 L44 1312 H0 Z\" fill=\"#FFD400\" opacity=\".94\"/>\n      <path d=\"M1080 1344 H1008 L1036 1312 H1080 Z\" fill=\"#FFD400\" opacity=\".94\"/>\n    </svg>`;\n  }\n\n  if (layout === 'azul_lateral_exato') {"""
    if anchor not in poster:
        raise SystemExit('Âncora do fundo profissional não encontrada')
    poster = poster.replace(anchor, background, 1)

# 4) Este fundo é claro: textos escuros de alto contraste.
poster = poster.replace(
    "const lateralLight = ['azul_lateral_exato', 'varejo'].includes(layout) && ['azul', 'celeste'].includes(key);",
    "const lateralLight = ['azul_lateral_exato', 'varejo', 'mascote_lateral_clean'].includes(layout) && ['azul', 'celeste'].includes(key);"
)

# 5) Composição textual dedicada: preserva a área da mascote à direita.
if "const mascotClean = layout === 'mascote_lateral_clean';" not in poster:
    poster = poster.replace(
        "  const sideLeftProduct = ['showcase', 'split', 'azul_lateral_exato', 'varejo'].includes(layout);\n  const sideRightProduct = ['catalog', 'diagonal'].includes(layout);\n  const centered = !sideLeftProduct && !sideRightProduct;\n\n  let productX = sideLeftProduct ? 785 : (sideRightProduct ? 285 : 540);\n  let productY = sideLeftProduct ? 455 : (sideRightProduct ? 360 : 246);\n  let productMaxChars = sideLeftProduct || sideRightProduct ? 28 : 36;\n\n  if (hints && Number.isFinite(Number(hints.left)) && Number.isFinite(Number(hints.right))) {",
        "  const mascotClean = layout === 'mascote_lateral_clean';\n  const sideLeftProduct = ['showcase', 'split', 'azul_lateral_exato', 'varejo'].includes(layout);\n  const sideRightProduct = ['catalog', 'diagonal'].includes(layout);\n  const centered = !sideLeftProduct && !sideRightProduct && !mascotClean;\n\n  let productX = mascotClean ? 335 : (sideLeftProduct ? 785 : (sideRightProduct ? 285 : 540));\n  let productY = mascotClean ? 360 : (sideLeftProduct ? 455 : (sideRightProduct ? 360 : 246));\n  let productMaxChars = mascotClean ? 31 : (sideLeftProduct || sideRightProduct ? 28 : 36);\n\n  if (!mascotClean && hints && Number.isFinite(Number(hints.left)) && Number.isFinite(Number(hints.right))) {",
        1
    )

    collision_anchor = "    const leftSpace = Math.max(0, image.left - 30);\n    const rightSpace = Math.max(0, 1080 - image.right - 30);\n    const needed = rect.width + 34;"
    collision_replace = "    if (mascotClean) {\n      const lastLineOffset = (block.lines.length - 1) * block.gap;\n      const safeBaseline = Math.floor(image.top - 28 - lastLineOffset);\n      block.x = Math.min(400, Math.max(285, block.x));\n      if (safeBaseline >= 205) block.y = Math.min(block.y, safeBaseline);\n      return block;\n    }\n\n    const leftSpace = Math.max(0, image.left - 30);\n    const rightSpace = Math.max(0, 1080 - image.right - 30);\n    const needed = rect.width + 34;"
    if collision_anchor not in poster:
        raise SystemExit('Âncora da proteção contra colisão não encontrada')
    poster = poster.replace(collision_anchor, collision_replace, 1)

    branch_anchor = "  if (['azul_lateral_exato', 'varejo'].includes(layout)) {"
    branch = """  if (mascotClean) {\n    headlineBlock = { x: 335, y: 226, lines: headlineLines, size: Math.min(headlineSize, 40), gap: Math.min(headlineGap, 47), color: headlineColor, weight: 950 };\n    const headlineLast = headlineBlock.y + (headlineLines.length - 1) * headlineBlock.gap;\n    subtitleBlock = { x: 335, y: headlineLast + headlineBlock.size + 20, lines: subtitleLines, size: Math.min(subtitleSize, 25), gap: Math.min(subtitleGap, 31), color: subtitleColor, weight: 800 };\n    const subtitleLast = subtitleBlock.y + (subtitleLines.length - 1) * subtitleBlock.gap;\n    productBlock = { x: 335, y: subtitleLast + subtitleBlock.size + 28, lines: productLines, size: Math.min(productSize, 34), gap: Math.min(productGap, 39), color: productColor, weight: 950 };\n  } else if (['azul_lateral_exato', 'varejo'].includes(layout)) {"""
    if branch_anchor not in poster:
        raise SystemExit('Âncora da composição de texto não encontrada')
    poster = poster.replace(branch_anchor, branch, 1)

# 6) Foreground próprio: mantém o esquema de pagamento atual e rodapé em 3 blocos.
if "const isMascotClean = layout === 'mascote_lateral_clean';" not in poster:
    poster = poster.replace(
        "  const isSplit = layout === 'split';\n  const isVarejo = layout === 'varejo';\n  const isExactLateral = layout === 'azul_lateral_exato';",
        "  const isSplit = layout === 'split';\n  const isVarejo = layout === 'varejo';\n  const isExactLateral = layout === 'azul_lateral_exato';\n  const isMascotClean = layout === 'mascote_lateral_clean';",
        1
    )

    foreground_anchor = "  if (isExactLateral) {"
    foreground = r'''  if (isMascotClean) {
    const cleanPrimary = '#052B60';
    const cleanSecondary = '#0B3F7E';
    const cleanAccent = '#FFF200';
    const emailParts = email.includes('@') ? [email.slice(0, email.indexOf('@') + 1), email.slice(email.indexOf('@') + 1)] : [email];
    return `
    <svg width="1080" height="1350" viewBox="0 0 1080 1350" xmlns="http://www.w3.org/2000/svg">
      ${brandSvg}
      ${headlineSvg}
      ${subtitleSvg}
      ${productNameSvg}

      <g font-family="Arial, Helvetica, sans-serif">
        <text x="355" y="800" text-anchor="middle" font-size="29" font-weight="950" fill="${cleanPrimary}">POR</text>
        <text x="210" y="880" font-size="40" font-weight="950" fill="${cleanPrimary}">R$</text>
        <text x="280" y="880" font-size="82" font-weight="950" letter-spacing="-3" fill="${cleanPrimary}">${escapeXml(cashValue)}</text>
        <text x="355" y="918" text-anchor="middle" font-size="23" font-weight="900" fill="${cleanSecondary}">À VISTA NO DINHEIRO OU PIX</text>
        <text x="355" y="960" text-anchor="middle" font-size="31" font-weight="950" fill="${cleanAccent}">OU</text>
        <text x="355" y="1005" text-anchor="middle" font-size="30" font-weight="950" fill="${cleanPrimary}">${pricing.installmentCount}X DE ${escapeXml(installmentValue)}</text>
        <text x="355" y="1042" text-anchor="middle" font-size="24" font-weight="900" fill="${cleanPrimary}">NO CARTÃO DE CRÉDITO</text>
        <text x="355" y="1080" text-anchor="middle" font-size="21" font-weight="850" fill="${cleanSecondary}">VALOR PARCELADO: R$ ${escapeXml(fullValue)}</text>
        <text x="355" y="1118" text-anchor="middle" font-size="17" font-weight="850" fill="${cleanSecondary}">CONSULTE CONDIÇÕES NO CREDIÁRIO PRÓPRIO</text>
      </g>

      <g transform="translate(24 1204)" font-family="Arial, Helvetica, sans-serif">
        <circle cx="44" cy="43" r="36" fill="#1DB954" stroke="#FFFFFF" stroke-width="4"/>
        <path d="M35 29c-3 3-2 10 4 17 6 7 13 10 17 7l4-5-8-5-3 4c-4-2-8-6-10-10l4-3-5-8-3 3Z" fill="#FFFFFF"/>
        <text x="94" y="30" font-size="17" fill="#FFFFFF">Atendimento pelo</text>
        <text x="94" y="52" font-size="17" fill="#FFFFFF">WhatsApp</text>
        <text x="94" y="86" font-size="26" font-weight="950" fill="#FFD400">${escapeXml(whatsapp.replace(/[()]/g, ''))}</text>
      </g>

      <line x1="350" y1="1198" x2="350" y2="1330" stroke="#FFD400" stroke-width="2"/>

      <g transform="translate(374 1204)" font-family="Arial, Helvetica, sans-serif">
        <circle cx="42" cy="43" r="34" fill="none" stroke="#FFD400" stroke-width="4"/>
        <ellipse cx="42" cy="43" rx="14" ry="33" fill="none" stroke="#FFD400" stroke-width="2.2"/>
        <path d="M10 43h64M15 29h54M15 57h54" fill="none" stroke="#FFD400" stroke-width="2.1"/>
        <text x="92" y="30" font-size="17" fill="#FFFFFF">Compre também pelo</text>
        <text x="92" y="52" font-size="17" fill="#FFFFFF">nosso site</text>
        <text x="174" y="86" text-anchor="middle" font-size="20" font-weight="950" fill="#FFD400">${escapeXml(site)}</text>
      </g>

      <line x1="710" y1="1198" x2="710" y2="1330" stroke="#FFD400" stroke-width="2"/>

      <g transform="translate(732 1204)" font-family="Arial, Helvetica, sans-serif">
        <circle cx="43" cy="43" r="34" fill="none" stroke="#FFD400" stroke-width="4"/>
        <rect x="24" y="30" width="38" height="27" rx="3" fill="none" stroke="#FFD400" stroke-width="3"/>
        <path d="M25 32l18 14 18-14" fill="none" stroke="#FFD400" stroke-width="3"/>
        <text x="96" y="29" font-size="17" fill="#FFFFFF">E-mail</text>
        <text x="96" y="57" font-size="19" font-weight="950" fill="#FFD400">${escapeXml(emailParts[0] || '')}</text>
        <text x="96" y="82" font-size="19" font-weight="950" fill="#FFD400">${escapeXml(emailParts[1] || '')}</text>
      </g>
    </svg>`;
  }

  if (isExactLateral) {'''
    if foreground_anchor not in poster:
        raise SystemExit('Âncora do foreground lateral não encontrada')
    poster = poster.replace(foreground_anchor, foreground, 1)

# 7) Produto e mascote do novo layout ficam em áreas separadas.
poster = poster.replace(
    "  const headerMascotBuffer = ['varejo', 'azul_lateral_exato'].includes(currentLayout)",
    "  const headerMascotBuffer = ['varejo', 'azul_lateral_exato', 'mascote_lateral_clean'].includes(currentLayout)"
)

if "const cleanMascotBuffer = await loadProfessionalMascotBuffer(options)" not in poster:
    anchor = "  // A mascote entra depois do produto e permanece totalmente visível.\n  if (headerMascotComposite) composites.push(headerMascotComposite);\n\n  if (options.showMascot === true || options.useMascot === true || options.mascote === true) {"
    replacement = """  // A mascote entra depois do produto e permanece totalmente visível.\n  if (headerMascotComposite) composites.push(headerMascotComposite);\n\n  if (currentLayout === 'mascote_lateral_clean') {\n    const cleanMascotBuffer = await loadProfessionalMascotBuffer(options).catch(() => null);\n    if (cleanMascotBuffer) {\n      const cleanMascot = await sharp(cleanMascotBuffer)\n        .rotate()\n        .ensureAlpha()\n        .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })\n        .resize(360, 760, { fit: 'contain', position: 'bottom', background: { r: 0, g: 0, b: 0, alpha: 0 } })\n        .png()\n        .toBuffer();\n      composites.push({ input: cleanMascot, top: 350, left: 700 });\n    }\n  }\n\n  if (currentLayout !== 'mascote_lateral_clean' && (options.showMascot === true || options.useMascot === true || options.mascote === true)) {"""
    if anchor not in poster:
        raise SystemExit('Âncora da mascote não encontrada')
    poster = poster.replace(anchor, replacement, 1)

if "const mascotCleanProduct = layout === 'mascote_lateral_clean';" not in poster:
    poster = poster.replace(
        "    const exactLateral = layout === 'azul_lateral_exato';\n    const productBottomLimit = exactLateral ? 1110 : (layout === 'varejo' ? 1090 : 790);\n    const productMaxWidth = exactLateral ? Math.min(preset.w, 490) : (layout === 'varejo' ? Math.min(preset.w, 520) : preset.w);\n    const productMaxHeight = exactLateral ? Math.min(650, productBottomLimit - 425) : (layout === 'varejo' ? Math.min(650, productBottomLimit - 420) : Math.max(180, Math.min(preset.h, productBottomLimit - minProductTop)));",
        "    const exactLateral = layout === 'azul_lateral_exato';\n    const mascotCleanProduct = layout === 'mascote_lateral_clean';\n    const productBottomLimit = mascotCleanProduct ? 790 : (exactLateral ? 1110 : (layout === 'varejo' ? 1090 : 790));\n    const productMaxWidth = mascotCleanProduct ? Math.min(preset.w, 570) : (exactLateral ? Math.min(preset.w, 490) : (layout === 'varejo' ? Math.min(preset.w, 520) : preset.w));\n    const productMaxHeight = mascotCleanProduct ? Math.min(390, productBottomLimit - 380) : (exactLateral ? Math.min(650, productBottomLimit - 425) : (layout === 'varejo' ? Math.min(650, productBottomLimit - 420) : Math.max(180, Math.min(preset.h, productBottomLimit - minProductTop))));",
        1
    )
    poster = poster.replace(
        "    const layoutCenterX = ['showcase', 'split'].includes(layout)\n      ? 315\n      : (['catalog', 'diagonal'].includes(layout) ? 755 : width / 2);",
        "    const layoutCenterX = mascotCleanProduct\n      ? 335\n      : (['showcase', 'split'].includes(layout)\n        ? 315\n        : (['catalog', 'diagonal'].includes(layout) ? 755 : width / 2));",
        1
    )
    poster = poster.replace(
        "    const textColumnSafeLeft = exactLateral\n      ? 520 - visibleMaxX\n      : (layout === 'varejo' ? 525 - visibleMaxX : canvasMaxSafeLeft);",
        "    const textColumnSafeLeft = mascotCleanProduct\n      ? 640 - visibleMaxX\n      : (exactLateral\n        ? 520 - visibleMaxX\n        : (layout === 'varejo' ? 525 - visibleMaxX : canvasMaxSafeLeft));",
        1
    )
    poster = poster.replace(
        "    const desiredTop = Math.round((exactLateral ? 430 : (layout === 'varejo' ? 430 : minProductTop)) + automaticOffsetY + Number(options.productOffsetY || 0));\n    const top = Math.max(exactLateral ? 405 : (layout === 'varejo' ? 390 : minProductTop), Math.min(productBottomLimit - productH, desiredTop));",
        "    const desiredTop = Math.round((mascotCleanProduct ? 385 : (exactLateral ? 430 : (layout === 'varejo' ? 430 : minProductTop))) + automaticOffsetY + Number(options.productOffsetY || 0));\n    const top = Math.max(mascotCleanProduct ? 350 : (exactLateral ? 405 : (layout === 'varejo' ? 390 : minProductTop)), Math.min(productBottomLimit - productH, desiredTop));",
        1
    )

# Regras existentes protegidas.
required = [
    'À VISTA NO DINHEIRO OU PIX',
    'NO CARTÃO DE CRÉDITO',
    'VALOR PARCELADO: R$',
    'CREDIÁRIO PRÓPRIO',
    "fit: 'inside'",
    'const rawImage = await loadImageBuffer(imageUrl)',
    'Atendimento pelo WhatsApp',
    'arianamoveis.com.br',
    "layout === 'azul_lateral_exato'",
    "layout === 'varejo'",
    "layout === 'split'",
    "layout === 'mascote_lateral_clean'"
]
for item in required:
    if item not in poster:
        raise SystemExit(f'Regra protegida ausente após patch: {item}')

html_path.write_text(html, encoding='utf-8')
css_path.write_text(css, encoding='utf-8')
poster_path.write_text(poster, encoding='utf-8')
