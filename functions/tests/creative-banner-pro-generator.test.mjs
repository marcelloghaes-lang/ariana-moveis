import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  analyzeCreativeBannerPro,
  generateCreativeBannerPro,
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

  assert.equal(analysis.products[0].backgroundRemoved, true);
  assert.match(analysis.products[0].removalMode, /connected_light_background|connected_uniform_background/);
  assert.ok(analysis.products[0].removedRatio > 0.25);
  assert.ok(analysis.products[0].removedRatio < 0.90);
  assert.ok(analysis.products[0].backgroundConfidence >= 0.5);
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

  assert.equal(analysis.products[0].backgroundRemoved, false);
  assert.equal(analysis.products[0].removalMode, 'complex_background');
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
  assert.equal(meta.height, 875);
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

test('campanha de marca aceita até quatro produtos e ativa composição varejo', async () => {
  const products = [1,2,3,4].map(index => ({
    id: 'p' + index,
    name: 'Geladeira Teste ' + index,
    brand: 'Midea',
    category: 'Geladeira',
    imageUrl: WHITE_BG_PRODUCT,
    pixPrice: 2499 + index,
    price: 2998.80 + index
  }));

  const result = await generateCreativeBannerPro(products[0], {
    products,
    outputFormat: 'hero_desktop',
    templatePro: 'campaign',
    contentMode: 'brand_campaign',
    showPrice: false,
    brandName: 'Midea',
    promoCode: 'ARIANA10',
    headline: 'ESPECIAL MIDEA',
    subtitle: 'Tecnologia e praticidade para sua casa',
    benefitOne: '12X NO CARTÃO',
    benefitTwo: 'OFERTA LIMITADA'
  });

  assert.equal(result.meta.productCount, 4);
  assert.equal(result.meta.brandCampaign, true);
  const meta = await sharp(result.buffer).metadata();
  assert.equal(meta.width, 1920);
  assert.equal(meta.height, 480);
});

test('análise de campanha de marca valida identidade e quantidade de produtos', async () => {
  const analysis = await analyzeCreativeBannerPro(product, {
    products: [product, { ...product, id: 'p2', name: 'Geladeira Teste 2' }],
    outputFormat: 'hero_mobile',
    templatePro: 'campaign',
    contentMode: 'brand_campaign',
    brandName: 'Midea',
    showPrice: false
  });

  assert.equal(analysis.productCount, 2);
  assert.equal(analysis.brandCampaign, true);
  const brandCheck = analysis.quality.checks.find(item => item.id === 'brand');
  const productsCheck = analysis.quality.checks.find(item => item.id === 'products');
  assert.equal(brandCheck.ok, true);
  assert.equal(productsCheck.ok, true);
});

