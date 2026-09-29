import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  analyzeCreativeBannerPro,
  generateCreativeBannerPro,
  analyzeCreativeBannerProMulti,
  generateCreativeBannerProMulti,
  prepareOfficialLogoAsset,
  prepareProProductAsset,
  resolveProFormat,
  resolveProTemplate,
  getProTemplateManifest
} from '../creative-banner-pro-generator.js';

function svgData(svg) {
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

const WHITE_BG_PRODUCT = svgData(
  '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900">' +
  '<rect width="900" height="900" fill="#ffffff"/>' +
  '<rect x="250" y="120" width="400" height="660" rx="35" fill="#1d4ed8"/>' +
  '<rect x="330" y="230" width="240" height="180" rx="18" fill="#ffffff"/>' +
  '<circle cx="570" cy="610" r="26" fill="#111827"/>' +
  '</svg>'
);

const COMPLEX_BG_PRODUCT = svgData(
  '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900">' +
  '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
  '<stop offset="0" stop-color="#ef4444"/><stop offset=".5" stop-color="#22c55e"/><stop offset="1" stop-color="#3b82f6"/>' +
  '</linearGradient></defs>' +
  '<rect width="900" height="900" fill="url(#g)"/>' +
  '<rect x="280" y="120" width="340" height="660" rx="30" fill="#111827"/>' +
  '</svg>'
);


const TEST_LOGO_PATH = '/tmp/ariana-official-logo-stage1-test.png';
await sharp(Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="620" height="220">' +
  '<rect width="620" height="220" fill="#000000"/>' +
  '<path d="M90 165 L145 45 L205 165 Z" fill="#FFD51B" stroke="#0B4FA8" stroke-width="16"/>' +
  '<rect x="230" y="65" width="300" height="70" rx="8" fill="#FFD51B"/>' +
  '</svg>'
)).png().toFile(TEST_LOGO_PATH);
process.env.ARIANA_OFFICIAL_LOGO_PATH = TEST_LOGO_PATH;

const FRAGMENTED_WHITE_PRODUCT = svgData(
  '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900">' +
  '<rect width="900" height="900" fill="#ffffff"/>' +
  '<rect x="250" y="100" width="400" height="680" fill="#ffffff"/>' +
  '<rect x="270" y="120" width="34" height="620" fill="#7c4a21"/>' +
  '<rect x="596" y="120" width="34" height="620" fill="#7c4a21"/>' +
  '<rect x="360" y="260" width="18" height="120" fill="#8b5e34"/>' +
  '<rect x="520" y="500" width="18" height="120" fill="#8b5e34"/>' +
  '</svg>'
);

const LIGHT_SHELL_SPEAKER = svgData(
  '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900">' +
  '<rect width="900" height="900" fill="#ffffff"/>' +
  '<rect x="245" y="90" width="410" height="720" rx="48" fill="#edf1f5"/>' +
  '<rect x="300" y="135" width="300" height="88" rx="24" fill="#1f2937"/>' +
  '<circle cx="450" cy="390" r="118" fill="#111827"/>' +
  '<circle cx="450" cy="390" r="72" fill="#2563eb"/>' +
  '<circle cx="450" cy="650" r="92" fill="#111827"/>' +
  '<circle cx="450" cy="650" r="52" fill="#ef4444"/>' +
  '</svg>'
);

const product = {
  id: 'p1',
  name: 'Geladeira Teste Frost Free 400L',
  category: 'Geladeira',
  imageUrl: WHITE_BG_PRODUCT,
  pixPrice: 2499,
  price: 2998.80
};

test('resolve formatos e templates com fallback seguro', () => {
  assert.equal(resolveProFormat('hero_mobile').width, 1080);
  assert.equal(resolveProFormat('inexistente').id, 'hero_desktop');
  assert.equal(resolveProTemplate('premium'), 'premium');
  assert.equal(resolveProTemplate('inexistente'), 'marketplace');
});

test('manifesto de template mantém regras obrigatórias para novos modelos', () => {
  const manifest = getProTemplateManifest('premium');
  assert.equal(manifest.schemaVersion, 'ariana-creative-template/v1');
  assert.equal(manifest.id, 'premium');
  assert.equal(manifest.renderer, 'premium');
  assert.equal(manifest.rules.manualCopyAuthority, 'editor_nonempty_wins');
  assert.equal(manifest.rules.aiCreativeDirection, true);
  assert.deepEqual(manifest.rules.copyFields, ['badge','headline','subtitle','cta']);
  assert.equal(manifest.rules.commerce.autoPrice, false);
  assert.equal(manifest.rules.qualityGate.blockFinalSaveOnCriticalFailure, true);
  assert.ok(manifest.supportedFormats.some(item => item.id === 'square'));
});

test('Cutout Studio consegue processar buffer original sem URL intermediária', async () => {
  const originalBuffer = await sharp(Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200">' +
    '<rect width="1200" height="1200" fill="#ffffff"/>' +
    '<rect x="330" y="180" width="540" height="820" rx="40" fill="#111827"/>' +
    '<circle cx="600" cy="430" r="150" fill="#2563eb"/>' +
    '</svg>'
  )).png().toBuffer();

  const asset = await prepareProProductAsset({
    name: 'Produto original do Cutout Studio',
    category: 'Teste',
    originalBuffer,
    sourceType: 'creative_cutout_bank_original'
  }, {
    removeBackground: true
  });

  assert.equal(asset.sourceType, 'creative_cutout_bank_original');
  assert.ok(Buffer.isBuffer(asset.buffer));
  assert.ok(asset.buffer.length > 1000);
  assert.equal(asset.sourceWidth, 1200);
  assert.equal(asset.sourceHeight, 1200);
});

test('remove fundo branco conectado sem apagar branco interno do produto', async () => {
  const analysis = await analyzeCreativeBannerPro(product, {
    outputFormat: 'hero_desktop',
    templatePro: 'marketplace',
    removeBackground: true
  });

  assert.equal(analysis.product.backgroundRemoved, true);
  assert.match(analysis.product.removalMode, /connected_light_background|connected_uniform_background/);
  assert.ok(analysis.product.removedRatio > 0.25);
  assert.ok(analysis.product.removedRatio < 0.90);
  assert.ok(analysis.product.backgroundConfidence >= 0.5);
});

test('imagem de fundo complexo não é destruída por remoção agressiva', async () => {
  const analysis = await analyzeCreativeBannerPro({
    ...product,
    imageUrl: COMPLEX_BG_PRODUCT
  }, {
    outputFormat: 'hero_desktop',
    templatePro: 'marketplace',
    removeBackground: true
  });

  assert.equal(analysis.product.backgroundRemoved, false);
  assert.equal(analysis.product.removalMode, 'complex_background');
});

test('banner Pro gera normalmente sem preço', async () => {
  const result = await generateCreativeBannerPro(product, {
    outputFormat: 'hero_desktop',
    templatePro: 'premium',
    showPrice: false,
    contentMode: 'no_price',
    headline: 'TECNOLOGIA PARA SUA CASA',
    subtitle: 'Mais praticidade para a sua rotina',
    benefit: 'Design moderno, eficiência e qualidade para transformar sua cozinha.'
  });

  assert.equal(result.meta.showPrice, false);
  const meta = await sharp(result.buffer).metadata();
  assert.equal(meta.width, 1920);
  assert.equal(meta.height, 480);
  assert.equal(meta.format, 'png');
  assert.ok(result.buffer.length > 5000);
});

test('banner Pro gera preço quando existe e está habilitado', async () => {
  const result = await generateCreativeBannerPro(product, {
    outputFormat: 'hero_mobile',
    templatePro: 'marketplace',
    showPrice: true,
    cashPrice: 2499,
    fullPrice: 2998.80,
    installmentCount: 12,
    installmentPrice: 249.90
  });

  assert.equal(result.meta.showPrice, true);
  const meta = await sharp(result.buffer).metadata();
  assert.equal(meta.width, 1080);
  assert.equal(meta.height, 1080);
});

test('templates Pro produzem composições realmente diferentes', async () => {
  const buffers = [];
  for (const template of ['marketplace','premium','campaign']) {
    const result = await generateCreativeBannerPro(product, {
      outputFormat: 'secondary_desktop',
      templatePro: template,
      showPrice: false,
      headline: 'DESTAQUE DA SEMANA'
    });
    buffers.push(result.buffer);
  }

  assert.notDeepEqual(buffers[0], buffers[1]);
  assert.notDeepEqual(buffers[1], buffers[2]);
  assert.notDeepEqual(buffers[0], buffers[2]);
});

test('qualidade informa explicitamente quando preço foi omitido por escolha', async () => {
  const analysis = await analyzeCreativeBannerPro(product, {
    outputFormat: 'hero_mobile',
    templatePro: 'campaign',
    showPrice: false
  });
  const priceCheck = analysis.quality.checks.find(item => item.id === 'pricing');
  assert.equal(priceCheck.ok, true);
  assert.match(priceCheck.label, /sem preço/i);
});


test('campanha de fabricante aceita marca, cupom e composição promocional', async () => {
  const result = await generateCreativeBannerPro({
    ...product,
    brand: 'Midea'
  }, {
    outputFormat: 'hero_desktop',
    templatePro: 'campaign',
    showPrice: true,
    cashPrice: 2499,
    fullPrice: 2998.80,
    installmentCount: 12,
    installmentPrice: 249.90,
    brandLabel: 'MIDEA',
    couponText: 'PROMOMIDEA',
    promoText: 'OFERTA POR TEMPO LIMITADO',
    headline: 'ESPECIAL MIDEA',
    subtitle: 'Condições especiais para renovar sua casa'
  });

  const meta = await sharp(result.buffer).metadata();
  assert.equal(meta.width, 1920);
  assert.equal(meta.height, 480);
  assert.equal(meta.format, 'png');
  assert.ok(result.buffer.length > 5000);
});


test('logo oficial com fundo preto vira transparente antes de entrar no banner', async () => {
  const logo = await prepareOfficialLogoAsset(TEST_LOGO_PATH);
  assert.equal(logo.backgroundRemoved, true);
  assert.ok(logo.transparentRatio > 0.20);
  assert.ok(logo.width < 620);
  assert.ok(logo.height < 220);

  const { data, info } = await sharp(logo.buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const cornerAlpha = data[3];
  assert.equal(info.channels, 4);
  assert.equal(cornerAlpha, 0);
});

test('segunda tentativa conservadora preserva produto claro em fundo branco', async () => {
  const analysis = await analyzeCreativeBannerPro({
    ...product,
    name: 'Caixa de Som Clara com LEDs',
    category: 'Áudio & Som',
    imageUrl: LIGHT_SHELL_SPEAKER
  }, {
    outputFormat: 'hero_desktop',
    templatePro: 'campaign',
    removeBackground: true
  });

  assert.equal(analysis.product.backgroundRemoved, true);
  assert.equal(analysis.product.cutoutSafe, true);
  assert.equal(analysis.product.removalMode, 'connected_light_background_conservative');
  assert.equal(analysis.quality.blockSave, false);
});

test('recorte fragmentado de produto branco é bloqueado em vez de gerar produto mastigado', async () => {
  const analysis = await analyzeCreativeBannerPro({
    ...product,
    name: 'Guarda Roupa Branco 6 Portas',
    category: 'Móveis',
    imageUrl: FRAGMENTED_WHITE_PRODUCT
  }, {
    outputFormat: 'hero_desktop',
    templatePro: 'marketplace',
    removeBackground: true
  });

  assert.equal(analysis.product.backgroundRemoved, false);
  assert.equal(analysis.product.cutoutSafe, false);
  assert.match(analysis.product.removalMode, /^unsafe_(?:cutout|overremove)_blocked$/);
  assert.equal(analysis.quality.blockSave, true);
  assert.ok(analysis.quality.criticalFailures.includes('cutout'));
});

test('peça aprovada libera salvar somente com logo, recorte e resolução válidos', async () => {
  const analysis = await analyzeCreativeBannerPro(product, {
    outputFormat: 'hero_desktop',
    templatePro: 'marketplace',
    removeBackground: true
  });

  assert.equal(analysis.brand.backgroundRemoved, true);
  assert.equal(analysis.product.cutoutSafe, true);
  assert.equal(analysis.quality.blockSave, false);
  assert.deepEqual(analysis.quality.criticalFailures, []);
});


const MANUFACTURER_LOGO_WHITE_BG = svgData(
  '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="360">' +
  '<rect width="900" height="360" fill="#ffffff"/>' +
  '<circle cx="180" cy="180" r="112" fill="none" stroke="#e11d48" stroke-width="30"/>' +
  '<path d="M140 180 C175 120 215 120 250 180" fill="none" stroke="#e11d48" stroke-width="25" stroke-linecap="round"/>' +
  '<text x="335" y="225" font-family="Arial" font-size="150" font-weight="900" fill="#0b3b87">MIDEA</text>' +
  '</svg>'
);

const MULTI_TV = {
  id: 'multi-tv',
  name: 'Smart TV 55 4K',
  brand: 'Midea',
  category: 'Smart TV',
  pixPrice: 2299,
  price: 2799,
  imageUrl: svgData(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">' +
    '<rect width="1200" height="800" fill="#ffffff"/>' +
    '<rect x="160" y="150" width="880" height="500" rx="18" fill="#111827"/>' +
    '<rect x="195" y="185" width="810" height="430" fill="#1d4ed8"/>' +
    '<rect x="555" y="650" width="90" height="60" fill="#111827"/>' +
    '<rect x="450" y="705" width="300" height="26" rx="12" fill="#111827"/>' +
    '</svg>'
  )
};

const MULTI_FRIDGE = {
  id: 'multi-fridge',
  name: 'Geladeira Frost Free 400L',
  brand: 'Midea',
  category: 'Geladeira',
  pixPrice: 3199,
  price: 3854,
  imageUrl: svgData(
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200">' +
    '<rect width="800" height="1200" fill="#ffffff"/>' +
    '<rect x="230" y="90" width="340" height="980" rx="35" fill="#94a3b8"/>' +
    '<rect x="510" y="210" width="12" height="180" rx="6" fill="#374151"/>' +
    '<rect x="510" y="610" width="12" height="250" rx="6" fill="#374151"/>' +
    '</svg>'
  )
};

const MULTI_WASHER = {
  id: 'multi-washer',
  name: 'Lavadora Automática 12kg',
  brand: 'Midea',
  category: 'Lavadora',
  pixPrice: 1899,
  price: 2288,
  imageUrl: svgData(
    '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900">' +
    '<rect width="900" height="900" fill="#ffffff"/>' +
    '<rect x="210" y="140" width="480" height="620" rx="42" fill="#64748b"/>' +
    '<circle cx="450" cy="470" r="180" fill="#0f172a" stroke="#94a3b8" stroke-width="28"/>' +
    '<rect x="270" y="190" width="360" height="70" rx="20" fill="#1e293b"/>' +
    '</svg>'
  )
};

const MULTI_MICROWAVE = {
  id: 'multi-micro',
  name: 'Micro-ondas 35L',
  brand: 'Midea',
  category: 'Micro-ondas',
  pixPrice: 699,
  price: 842,
  imageUrl: svgData(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="700">' +
    '<rect width="1100" height="700" fill="#ffffff"/>' +
    '<rect x="140" y="180" width="820" height="360" rx="32" fill="#334155"/>' +
    '<rect x="190" y="220" width="560" height="280" rx="18" fill="#111827"/>' +
    '<rect x="800" y="230" width="90" height="70" rx="10" fill="#94a3b8"/>' +
    '<circle cx="845" cy="390" r="45" fill="#cbd5e1"/>' +
    '</svg>'
  )
};

test('campanha multi-produto analisa 4 itens e libera quando todos estão íntegros', async () => {
  const analysis = await analyzeCreativeBannerProMulti(
    [MULTI_TV, MULTI_FRIDGE, MULTI_WASHER, MULTI_MICROWAVE],
    {
      outputFormat: 'hero_desktop',
      brandLabel: 'MIDEA',
      couponText: 'PROMOMIDEA',
      headline: 'ESPECIAL MIDEA',
      subtitle: 'Condições especiais para renovar sua casa',
      promoText: 'OFERTA POR TEMPO LIMITADO'
    }
  );

  assert.equal(analysis.multiProduct, true);
  assert.equal(analysis.productCount, 4);
  assert.equal(analysis.quality.blockSave, false);
  assert.equal(analysis.products.every(item => item.cutoutSafe), true);
});

test('multi-produto respeita os três templates e gera composições diferentes', async () => {
  const buffers = [];
  for (const template of ['marketplace','premium','campaign']) {
    const result = await generateCreativeBannerProMulti(
      [MULTI_TV, MULTI_FRIDGE, MULTI_WASHER],
      {
        outputFormat: 'hero_desktop',
        templatePro: template,
        headline: 'SELEÇÃO ESPECIAL',
        subtitle: 'Escolhas para diferentes momentos.',
        badge: 'ARIANA',
        cta: 'CONFIRA'
      }
    );
    assert.equal(result.meta.template, template);
    buffers.push(result.buffer);
  }

  assert.notDeepEqual(buffers[0], buffers[1]);
  assert.notDeepEqual(buffers[1], buffers[2]);
  assert.notDeepEqual(buffers[0], buffers[2]);
});

test('Hero Mobile e Card Quadrado usam composições multi-produto diferentes', async () => {
  const base = {
    templatePro: 'campaign',
    headline: 'SELEÇÃO ESPECIAL',
    subtitle: 'Escolhas para diferentes momentos.',
    badge: 'ARIANA',
    cta: 'CONFIRA'
  };
  const hero = await generateCreativeBannerProMulti(
    [MULTI_TV, MULTI_FRIDGE, MULTI_WASHER],
    { ...base, outputFormat:'hero_mobile' }
  );
  const square = await generateCreativeBannerProMulti(
    [MULTI_TV, MULTI_FRIDGE, MULTI_WASHER],
    { ...base, outputFormat:'square' }
  );

  assert.equal(hero.meta.format.id, 'hero_mobile');
  assert.equal(square.meta.format.id, 'square');
  assert.notDeepEqual(hero.buffer, square.buffer);
});

test('campanha multi-produto gera desktop e mobile nas dimensões oficiais', async () => {
  for (const format of ['hero_desktop','hero_mobile']) {
    const result = await generateCreativeBannerProMulti(
      [MULTI_TV, MULTI_FRIDGE, MULTI_WASHER, MULTI_MICROWAVE],
      {
        outputFormat: format,
        brandLabel: 'MIDEA',
        couponText: 'PROMOMIDEA',
        headline: 'ESPECIAL MIDEA',
        subtitle: 'Condições especiais para renovar sua casa',
        promoText: 'OFERTA POR TEMPO LIMITADO',
        cta: 'APROVEITE'
      }
    );
    const meta = await sharp(result.buffer).metadata();
    const expected = resolveProFormat(format);
    assert.equal(meta.width, expected.width);
    assert.equal(meta.height, expected.height);
    assert.equal(result.meta.productCount, 4);
    assert.equal(result.meta.quality.blockSave, false);
  }
});

test('os quatro campos manuais do editor têm autoridade sobre o PNG multi-produto', async () => {
  const copy = {
    badge: 'TESTE LINHA SUPERIOR 123',
    headline: 'TESTE TITULO 456',
    subtitle: 'TESTE APOIO 789',
    cta: 'TESTE FINAL 000'
  };
  const baseOptions = {
    outputFormat: 'hero_desktop',
    brandLabel: '',
    brandLogoUrl: '',
    couponText: '',
    promoText: '',
    showCommercialInfo: false,
    removeBackground: true,
    manualCopy: copy,
    ...copy
  };

  const result = await generateCreativeBannerProMulti(
    [MULTI_TV, MULTI_FRIDGE, MULTI_WASHER],
    baseOptions
  );

  assert.deepEqual(result.meta.copy, copy);

  for (const key of Object.keys(copy)) {
    const changedCopy = { ...copy, [key]: copy[key] + ' X' };
    const changed = await generateCreativeBannerProMulti(
      [MULTI_TV, MULTI_FRIDGE, MULTI_WASHER],
      {
        ...baseOptions,
        ...changedCopy,
        manualCopy: changedCopy
      }
    );
    assert.notDeepEqual(
      changed.buffer,
      result.buffer,
      key + ' precisa alterar os pixels do PNG'
    );
  }
});

test('campanha multi-produto exige no mínimo dois produtos', async () => {
  await assert.rejects(
    () => generateCreativeBannerProMulti([MULTI_TV], { outputFormat: 'hero_desktop' }),
    /at_least_two_products/
  );
});

test('campanha multi-produto bloqueia se qualquer produto falhar no recorte', async () => {
  const bad = {
    ...product,
    id: 'bad-multi',
    name: 'Guarda Roupa Branco 6 Portas',
    category: 'Móveis',
    imageUrl: FRAGMENTED_WHITE_PRODUCT
  };
  const analysis = await analyzeCreativeBannerProMulti(
    [MULTI_TV, bad],
    {
      outputFormat: 'hero_desktop',
      brandLabel: 'ARIANA',
      headline: 'OFERTAS PARA SUA CASA'
    }
  );
  assert.equal(analysis.quality.blockSave, true);
  assert.ok(analysis.quality.criticalFailures.includes('multi_cutout'));
});


test('logo do fabricante com fundo branco é tratada e liberada na campanha', async () => {
  const analysis = await analyzeCreativeBannerProMulti(
    [MULTI_TV, MULTI_FRIDGE, MULTI_WASHER],
    {
      outputFormat: 'hero_desktop',
      brandLabel: 'MIDEA',
      brandLogoUrl: MANUFACTURER_LOGO_WHITE_BG,
      couponText: 'PROMOMIDEA',
      headline: 'ESPECIAL MIDEA',
      subtitle: 'Condições especiais para sua casa',
      cta: 'APROVEITE'
    }
  );

  assert.equal(analysis.manufacturerBrand?.backgroundRemoved, true);
  const check = analysis.quality.checks.find(item => item.id === 'manufacturer_logo');
  assert.equal(check?.ok, true);
  assert.equal(analysis.quality.blockSave, false);
});

test('campanha com logo do fabricante renderiza sem caixa branca', async () => {
  const result = await generateCreativeBannerProMulti(
    [MULTI_TV, MULTI_FRIDGE, MULTI_WASHER, MULTI_MICROWAVE],
    {
      outputFormat: 'hero_mobile',
      brandLabel: 'MIDEA',
      brandLogoUrl: MANUFACTURER_LOGO_WHITE_BG,
      couponText: 'PROMOMIDEA',
      headline: 'ESPECIAL MIDEA',
      subtitle: 'Condições especiais para renovar sua casa',
      promoText: 'OFERTA POR TEMPO LIMITADO',
      cta: 'APROVEITE'
    }
  );
  assert.equal(result.meta.manufacturerBrand?.backgroundRemoved, true);
  assert.equal(result.meta.quality.blockSave, false);
  const meta = await sharp(result.buffer).metadata();
  assert.equal(meta.width, 1080);
  assert.equal(meta.height, 1080);
});


test('Marketplace Ariana exporta presets e gramáticas no manifesto', () => {
  const manifest = getProTemplateManifest('marketplace');
  assert.equal(Array.isArray(manifest.marketplaceAriana?.presets), true);
  assert.equal(manifest.marketplaceAriana.presets.length, 5);
  assert.equal(manifest.marketplaceAriana.presets.some(item => item.id === 'manufacturer'), true);
  assert.equal(manifest.marketplaceAriana.layoutGrammars.E, 'mini campanhas em cards quadrados/retangulares');
  assert.equal(manifest.rules.commerce.autoPrice, false);
  assert.equal(manifest.rules.branding.ownSiteUrlInsideOwnSiteBanner, false);
});

test('Marketplace Ariana Hero Desktop renderiza em 3x e exporta na dimensão oficial', async () => {
  const result = await generateCreativeBannerProMulti(
    [MULTI_TV, MULTI_FRIDGE, MULTI_WASHER],
    {
      outputFormat: 'hero_desktop',
      templatePro: 'marketplace',
      generationStyle: 'marketplace',
      marketplacePreset: 'impact',
      layoutGrammar: 'A',
      headline: 'MAIS VENTO. MAIS CONFORTO.',
      subtitle: 'Modelos para refrescar sua rotina em qualquer ambiente.',
      badge: 'VENTILADORES',
      cta: 'CONFIRA OS MODELOS'
    }
  );

  const meta = await sharp(result.buffer).metadata();
  assert.equal(meta.width, 1920);
  assert.equal(meta.height, 480);
  assert.equal(result.meta.renderScale, 3);
  assert.equal(result.meta.renderQuality, 'supersampled_3x_lanczos3_selective_sharpen');
  assert.equal(result.meta.quality.blockSave, false);
});

test('Marketplace Ariana mantém 2x nos demais formatos para controlar custo de render', async () => {
  const result = await generateCreativeBannerProMulti(
    [MULTI_TV, MULTI_FRIDGE, MULTI_WASHER],
    {
      outputFormat: 'secondary_desktop',
      templatePro: 'marketplace',
      generationStyle: 'marketplace',
      marketplacePreset: 'impact',
      layoutGrammar: 'A',
      headline: 'SELEÇÃO ARIANA',
      subtitle: 'Produtos em destaque.',
      badge: 'DESTAQUES',
      cta: 'CONFIRA'
    }
  );

  const meta = await sharp(result.buffer).metadata();
  assert.equal(meta.width, 1600);
  assert.equal(meta.height, 400);
  assert.equal(result.meta.renderScale, 2);
  assert.equal(result.meta.renderQuality, 'supersampled_2x_lanczos3_selective_sharpen');
  assert.equal(result.meta.quality.blockSave, false);
});

test('Marketplace Ariana refinado muda composição A sem alterar recorte ou quality gate', async () => {
  const base = {
    outputFormat: 'hero_desktop',
    templatePro: 'marketplace',
    headline: 'MAIS VENTO PARA APROVEITAR O SEU ESPAÇO',
    subtitle: 'Modelos de mesa, coluna e parede para refrescar sua rotina.',
    badge: 'VENTILADORES',
    cta: 'CONFIRA OS MODELOS',
    removeBackground: true
  };

  const classic = await generateCreativeBannerProMulti(
    [MULTI_TV, MULTI_FRIDGE, MULTI_WASHER],
    { ...base, generationStyle: 'classic' }
  );
  const marketplace = await generateCreativeBannerProMulti(
    [MULTI_TV, MULTI_FRIDGE, MULTI_WASHER],
    {
      ...base,
      generationStyle: 'marketplace',
      marketplacePreset: 'impact',
      layoutGrammar: 'A'
    }
  );

  assert.equal(classic.meta.quality.blockSave, false);
  assert.equal(marketplace.meta.quality.blockSave, false);
  assert.equal(marketplace.meta.layoutGrammar, 'A');
  assert.notDeepEqual(classic.buffer, marketplace.buffer);
});

test('Marketplace Ariana gera variações reais para as gramáticas A-E sem alterar o quality gate', async () => {
  const buffers = [];
  for (const grammar of ['A','B','C','D','E']) {
    const result = await generateCreativeBannerProMulti(
      [MULTI_TV, MULTI_FRIDGE, MULTI_WASHER],
      {
        outputFormat: 'hero_desktop',
        templatePro: grammar === 'D' ? 'premium' : 'marketplace',
        generationStyle: 'marketplace',
        marketplacePreset: grammar === 'D' ? 'manufacturer' : grammar === 'E' ? 'mini_cards' : 'impact',
        layoutGrammar: grammar,
        headline: 'TECNOLOGIA PARA SUA CASA',
        subtitle: 'Uma seleção Ariana com produtos em destaque.',
        badge: grammar === 'D' ? 'FABRICANTE EM DESTAQUE' : 'SELEÇÃO ARIANA',
        cta: 'CONFIRA'
      }
    );
    assert.equal(result.meta.generationStyle, 'marketplace');
    assert.equal(result.meta.layoutGrammar, grammar);
    assert.equal(result.meta.quality.blockSave, false);
    buffers.push(result.buffer);
  }
  for (let i = 1; i < buffers.length; i += 1) {
    assert.notDeepEqual(buffers[i - 1], buffers[i]);
  }
});
