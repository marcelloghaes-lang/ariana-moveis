import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCreativeCampaignCopy,
  sanitizeCampaignCopy
} from '../services/creativeCampaignResearchService.js';

function allCopyValues(result) {
  return Object.values(result.copy || {});
}

test('copy de campanha usa sinais pesquisados sem copiar frase do concorrente', () => {
  const products = [
    { name: 'Geladeira Frost Free', brand: 'Consul', category: 'Eletrodomésticos' },
    { name: 'Freezer Vertical', brand: 'Consul', category: 'Eletrodomésticos' },
    { name: 'Micro-ondas 32L', brand: 'Consul', category: 'Eletrodomésticos' }
  ];
  const references = [
    { title: 'Especial pra você', snippet: 'Tecnologia e inovação para renovar sua casa.' },
    { title: 'Semana da tecnologia', snippet: 'Novidades para deixar o dia a dia mais prático.' }
  ];
  const result = buildCreativeCampaignCopy(products, references);

  assert.equal(result.context.sameBrand, true);
  assert.equal(result.context.brand, 'Consul');
  assert.ok(['technology','renew','practical','special'].includes(result.theme));
  assert.ok(allCopyValues(result).every(Boolean));
  assert.notEqual(result.copy.headline.toLowerCase(), 'especial pra você');
  assert.notEqual(result.copy.headline.toLowerCase(), 'especial pra voce');
});

test('copy automática nunca injeta preço, PIX ou parcelamento', () => {
  const result = buildCreativeCampaignCopy(
    [
      { name: 'Caixa de Som', brand: 'Mondial', category: 'Eletroportáteis' },
      { name: 'Air Fryer', brand: 'Mondial', category: 'Eletroportáteis' }
    ],
    [
      { title: '12x sem juros e 5% no PIX', snippet: 'Oferta R$ 999 com entrega grátis e desconto.' }
    ]
  );

  const copy = allCopyValues(result).join(' ');
  assert.doesNotMatch(copy, /(?:\b12x\b|pix|\d+%|r\$|sem juros|frete|entrega grátis)/i);
});

test('sanitizador elimina typo conhecido e palavra repetida', () => {
  const clean = sanitizeCampaignCopy('Melhorws fabricas fabricas para sua casa', 80);
  assert.equal(clean, 'melhores fabricas para sua casa');
});


test('categoria genérica campanha não vira texto do banner e caixas de som viram ÁUDIO & SOM', () => {
  const result = buildCreativeCampaignCopy(
    [
      { name: 'Caixa de Som Amplificada Bluetooth', category: 'Campanha' },
      { name: 'Caixa de Som Torre com LED', category: 'Campanha' },
      { name: 'Speaker Amplificada Portátil', category: 'Campanha' }
    ],
    [
      { title: 'Especial da semana', snippet: 'Seleção especial para sua casa.' }
    ]
  );

  assert.equal(result.context.sameCategory, true);
  assert.equal(result.context.category, 'ÁUDIO & SOM');
  assert.equal(result.copy.badge, 'ÁUDIO & SOM');
  assert.equal(result.copy.headline, 'SOM PARA TODOS OS MOMENTOS');
  assert.doesNotMatch(
    Object.values(result.copy).join(' '),
    /campanha escolhidos|campanha para sua casa/i
  );
});

test('categoria em objeto também é interpretada corretamente', () => {
  const result = buildCreativeCampaignCopy(
    [
      { name: 'Smart TV 50', category: { name: 'Televisores' } },
      { name: 'Smart TV 55', category: { name: 'Televisores' } }
    ],
    []
  );

  assert.equal(result.context.sameCategory, true);
  assert.equal(result.context.category, 'Televisores');
  assert.doesNotMatch(result.copy.headline, /^TELEVISORES ESCOLHIDOS/i);
});
