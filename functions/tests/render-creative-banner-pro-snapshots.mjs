import fs from 'fs';
import path from 'path';
import { generateCreativeBannerPro, generateCreativeBannerProMulti } from '../creative-banner-pro-generator.js';

function svgData(svg) {
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

const manufacturerLogo = svgData(
  '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="360">' +
  '<rect width="900" height="360" fill="#ffffff"/>' +
  '<circle cx="180" cy="180" r="112" fill="none" stroke="#e11d48" stroke-width="30"/>' +
  '<path d="M140 180 C175 120 215 120 250 180" fill="none" stroke="#e11d48" stroke-width="25" stroke-linecap="round"/>' +
  '<text x="335" y="225" font-family="Arial" font-size="150" font-weight="900" fill="#0b3b87">MIDEA</text>' +
  '</svg>'
);

const outDir = path.resolve('../artifacts/creative-studio-pro');
fs.mkdirSync(outDir, { recursive: true });

const tv = {
  name: 'Smart TV 55 4K',
  brand: 'Samsung',
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

const fridge = {
  name: 'Geladeira Frost Free 400L',
  brand: 'Electrolux',
  category: 'Geladeira',
  pixPrice: 3199,
  price: 3854,
  imageUrl: svgData(
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200">' +
    '<rect width="800" height="1200" fill="#ffffff"/>' +
    '<rect x="230" y="90" width="340" height="980" rx="35" fill="#d1d5db"/>' +
    '<rect x="245" y="105" width="310" height="365" rx="24" fill="#e5e7eb"/>' +
    '<rect x="245" y="485" width="310" height="570" rx="24" fill="#cbd5e1"/>' +
    '<rect x="510" y="210" width="12" height="180" rx="6" fill="#374151"/>' +
    '<rect x="510" y="610" width="12" height="250" rx="6" fill="#374151"/>' +
    '</svg>'
  )
};

const speaker = {
  name: 'Caixa Amplificada 180W Bluetooth',
  brand: 'Amvox',
  category: 'Som e Áudio',
  pixPrice: 289,
  price: 349,
  imageUrl: svgData(
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000">' +
    '<rect width="800" height="1000" fill="#ffffff"/>' +
    '<rect x="220" y="100" width="360" height="760" rx="60" fill="#111827"/>' +
    '<circle cx="400" cy="350" r="120" fill="#0f172a" stroke="#06b6d4" stroke-width="22"/>' +
    '<circle cx="400" cy="650" r="150" fill="#0f172a" stroke="#2563eb" stroke-width="24"/>' +
    '<rect x="320" y="875" width="160" height="34" rx="17" fill="#111827"/>' +
    '</svg>'
  )
};

const microwave = {
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

const cases = [
  ['marketplace-desktop', tv, {
    outputFormat:'hero_desktop', templatePro:'marketplace', showPrice:true,
    headline:'TV 4K PARA SUA SALA', subtitle:'Imagem grande, streaming e diversão em casa',
    badge:'OFERTA ARIANA', promoText:'OFERTA POR TEMPO LIMITADO',
    installmentCount:12, installmentPrice:233.25, cashPrice:2299, fullPrice:2799,
    cta:'APROVEITE'
  }],
  ['marketplace-mobile', tv, {
    outputFormat:'hero_mobile', templatePro:'marketplace', showPrice:true,
    headline:'TV 4K PARA SUA SALA', subtitle:'Imagem grande, streaming e diversão em casa',
    badge:'OFERTA ARIANA', promoText:'OFERTA POR TEMPO LIMITADO',
    installmentCount:12, installmentPrice:233.25, cashPrice:2299, fullPrice:2799,
    cta:'APROVEITE'
  }],
  ['premium-desktop', fridge, {
    outputFormat:'hero_desktop', templatePro:'premium', showPrice:false,
    headline:'DESIGN E ESPAÇO PARA SUA COZINHA', subtitle:'Tecnologia e conservação para a rotina da sua casa',
    benefit:'Mais capacidade, organização e praticidade para sua cozinha.',
    brandLabel:'ELECTROLUX', cta:'CONFIRA NO SITE'
  }],
  ['premium-mobile', fridge, {
    outputFormat:'hero_mobile', templatePro:'premium', showPrice:false,
    headline:'DESIGN E ESPAÇO PARA SUA COZINHA', subtitle:'Tecnologia e conservação para a rotina da sua casa',
    benefit:'Mais capacidade, organização e praticidade para sua cozinha.',
    brandLabel:'ELECTROLUX', cta:'CONFIRA'
  }],
  ['campaign-desktop', speaker, {
    outputFormat:'hero_desktop', templatePro:'campaign', showPrice:true,
    headline:'SOM PARA TODO MOMENTO', subtitle:'Potência e diversão com condição especial',
    brandLabel:'AMVOX', brandLogoUrl:manufacturerLogo, couponText:'SOM10', promoText:'OFERTA POR TEMPO LIMITADO',
    installmentCount:12, installmentPrice:29.08, cashPrice:289, fullPrice:349,
    cta:'APROVEITE'
  }],
  ['campaign-mobile', speaker, {
    outputFormat:'hero_mobile', templatePro:'campaign', showPrice:true,
    headline:'SOM PARA TODO MOMENTO', subtitle:'Potência e diversão com condição especial',
    brandLabel:'AMVOX', couponText:'SOM10', promoText:'OFERTA POR TEMPO LIMITADO',
    installmentCount:12, installmentPrice:29.08, cashPrice:289, fullPrice:349,
    cta:'APROVEITE'
  }]
];

for (const [name, product, options] of cases) {
  const result = await generateCreativeBannerPro(product, options);
  if (result.meta?.quality?.blockSave) {
    throw new Error(name + ': quality blocked ' + JSON.stringify(result.meta.quality));
  }
  fs.writeFileSync(path.join(outDir, name + '.png'), result.buffer);
  console.log(name, result.buffer.length, result.meta.quality.score);
}


const multiProducts = [
  { ...fridge, brand: 'Midea' },
  { ...microwave, brand: 'Midea' },
  { ...speaker, brand: 'Midea', name: 'Climatizador Portátil' },
  { ...tv, brand: 'Midea', name: 'Lava e Seca Smart' }
];

for (const format of ['hero_desktop','hero_mobile']) {
  const result = await generateCreativeBannerProMulti(multiProducts, {
    outputFormat: format,
    brandLabel: 'MIDEA',
    brandLogoUrl: manufacturerLogo,
    couponText: 'PROMOMIDEA',
    headline: 'ESPECIAL MIDEA',
    subtitle: 'Tecnologia para sua casa com condições especiais',
    promoText: 'OFERTA POR TEMPO LIMITADO',
    installmentCount: 12,
    cta: 'APROVEITE'
  });
  if (result.meta?.quality?.blockSave) {
    throw new Error('multi-' + format + ': quality blocked ' + JSON.stringify(result.meta.quality));
  }
  const name = format === 'hero_desktop' ? 'multi-campaign-desktop' : 'multi-campaign-mobile';
  fs.writeFileSync(path.join(outDir, name + '.png'), result.buffer);
  console.log(name, result.buffer.length, result.meta.quality.score);
}
