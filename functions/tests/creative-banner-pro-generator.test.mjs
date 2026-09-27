import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  analyzeCreativeBannerPro,
  generateCreativeBannerPro,
  prepareOfficialLogoAsset,
  resolveProFormat,
  resolveProTemplate
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
  assert.equal(analysis.product.removalMode, 'unsafe_cutout_blocked');
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
