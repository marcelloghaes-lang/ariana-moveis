import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCreativeBannerBuffer, resolveCreativeBannerFormat, CREATIVE_BANNER_FORMATS } from '../creative-banner-generator.js';

const PRODUCT_SVG = 'data:image/svg+xml;base64,' + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="white"/><rect x="75" y="30" width="150" height="340" rx="16" fill="#dbeafe" stroke="#1d4ed8" stroke-width="8"/></svg>'
).toString('base64');

const product = {
  name: 'Geladeira Teste',
  imageUrl: PRODUCT_SVG,
  pixPrice: 999.90,
  price: 1200
};

const options = {
  headline: 'OFERTA ESPECIAL',
  subtitle: 'Porque sua casa merece o melhor',
  cashPrice: 999.90,
  fullPrice: 1200,
  installmentCount: 12,
  installmentPrice: 100,
  colorTheme: 'azul',
  template: 'oferta'
};

test('formatos oficiais possuem dimensões fixas', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(CREATIVE_BANNER_FORMATS).map(([key, value]) => [key, [value.width, value.height]])),
    {
      site_hero_desktop: [1920, 480],
      site_hero_mobile: [1080, 1080],
      site_secondary_desktop: [1600, 400],
      site_secondary_mobile: [1080, 720],
      site_card_square: [1080, 1080]
    }
  );
});

test('formato desconhecido cai com segurança no hero desktop', () => {
  const format = resolveCreativeBannerFormat('nao-existe');
  assert.equal(format.id, 'site_hero_desktop');
  assert.equal(format.width, 1920);
  assert.equal(format.height, 480);
});

for (const id of Object.keys(CREATIVE_BANNER_FORMATS)) {
  test('gera PNG com dimensão correta: ' + id, async () => {
    const { default: sharp } = await import('sharp');
    const buffer = await generateCreativeBannerBuffer(product, { ...options, outputFormat: id });
    assert.ok(Buffer.isBuffer(buffer));
    assert.ok(buffer.length > 1000);
    const meta = await sharp(buffer).metadata();
    const expected = CREATIVE_BANNER_FORMATS[id];
    assert.equal(meta.format, 'png');
    assert.equal(meta.width, expected.width);
    assert.equal(meta.height, expected.height);
  });
}
