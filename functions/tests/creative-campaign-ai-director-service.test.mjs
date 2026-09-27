import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAiDirectorRequest,
  sanitizeAiCreativeDirection,
  fixCopyByVisualCategory
} from '../services/creativeCampaignAiDirectorService.js';

const PRODUCTS = [
  {
    id: 'a',
    name: 'Caixa de Som Torre Bluetooth',
    brand: 'Mondial',
    category: 'Campanha',
    imageUrl: 'https://example.com/a.png'
  },
  {
    id: 'b',
    name: 'Caixa de Som Amplificada LED',
    brand: 'Mondial',
    category: 'Campanha',
    imageUrl: 'https://example.com/b.png'
  },
  {
    id: 'c',
    name: 'Speaker Portátil',
    brand: 'Mondial',
    category: 'Campanha',
    imageUrl: 'https://example.com/c.png'
  }
];

test('request do diretor IA inclui web search e imagens dos produtos', () => {
  const request = buildAiDirectorRequest(PRODUCTS, new Date('2026-09-27T12:00:00Z'));

  assert.equal(request.tools[0].type, 'web_search');
  assert.equal(request.store, false);
  assert.equal(request.text.format.type, 'json_schema');

  const user = request.input.find(item => item.role === 'user');
  const images = user.content.filter(item => item.type === 'input_image');

  assert.equal(images.length, 3);
  assert.equal(images[0].image_url, 'https://example.com/a.png');
});

test('direção IA sanitiza comércio inventado e preserva briefing criativo', () => {
  const result = sanitizeAiCreativeDirection({
    category: 'Áudio & Som',
    campaignAngle: 'Som para todos os momentos',
    trendSummary: 'Banners atuais usam um produto herói maior e dois apoios.',
    trendSignals: ['Produto principal dominante', 'Título curto'],
    recognizedProducts: [
      { index: 1, label: 'Caixa de som amplificada', confidence: 0.95 }
    ],
    copy: {
      badge: 'ÁUDIO & SOM',
      headline: 'SOM PARA TODOS OS MOMENTOS',
      subtitle: '12x sem juros e 10% no PIX',
      cta: 'CONHEÇA A SELEÇÃO'
    },
    direction: {
      preset: 'category',
      mood: 'energy',
      productHierarchy: 'one_plus_two',
      heroProductIndex: 1
    }
  }, PRODUCTS, {
    subtitle: 'Potência e tecnologia para curtir do seu jeito.'
  });

  assert.equal(result.category, 'ÁUDIO & SOM');
  assert.equal(result.direction.heroProductIndex, 1);
  assert.equal(result.direction.productHierarchy, 'one_plus_two');
  assert.equal(result.copy.subtitle, 'Potência e tecnologia para curtir do seu jeito.');
  assert.doesNotMatch(Object.values(result.copy).join(' '), /pix|12x|10%/i);
});

test('índice inválido de produto herói cai para o primeiro produto', () => {
  const result = sanitizeAiCreativeDirection({
    copy: {
      badge: 'SELEÇÃO ARIANA',
      headline: 'ESCOLHAS PARA SUA CASA',
      subtitle: 'Uma seleção pensada para você.',
      cta: 'CONHEÇA'
    },
    direction: {
      preset: 'festival',
      mood: 'institutional',
      productHierarchy: 'cluster',
      heroProductIndex: 99
    }
  }, PRODUCTS, {});

  assert.equal(result.direction.heroProductIndex, 0);
});


test('caixas de som não podem manter copy genérica de casa', () => {
  const result = sanitizeAiCreativeDirection({
    category: 'Eletrônicos',
    campaignAngle: 'Tecnologia para o dia a dia',
    trendSummary: 'Produto herói maior com dois apoios.',
    trendSignals: ['Título curto'],
    recognizedProducts: [
      { index: 0, label: 'Caixa de som torre Bluetooth', confidence: 0.98 },
      { index: 1, label: 'Caixa de som amplificada', confidence: 0.97 },
      { index: 2, label: 'Speaker portátil', confidence: 0.93 }
    ],
    copy: {
      badge: 'SELEÇÃO ARIANA',
      headline: 'TECNOLOGIA E BOAS ESCOLHAS PARA SUA CASA',
      subtitle: 'Tecnologia, design e praticidade para deixar sua rotina mais simples.',
      cta: 'VEJA AS NOVIDADES'
    },
    direction: {
      preset: 'category',
      mood: 'energy',
      productHierarchy: 'one_plus_two',
      heroProductIndex: 1
    }
  }, PRODUCTS, {});

  assert.equal(result.category, 'ÁUDIO & SOM');
  assert.equal(result.copy.badge, 'ÁUDIO & SOM');
  assert.equal(result.copy.headline, 'SOM PARA TODOS OS MOMENTOS');
  assert.equal(
    result.copy.subtitle,
    'Potência, conectividade e música para curtir cada momento do seu jeito.'
  );
  assert.doesNotMatch(
    [result.copy.badge, result.copy.headline, result.copy.subtitle].join(' '),
    /boas escolhas para sua casa|seleção ariana/i
  );
});

test('copy específica de áudio aprovada pela IA é preservada', () => {
  const fixed = fixCopyByVisualCategory({
    badge: 'SOM E ENTRETENIMENTO',
    headline: 'MAIS POTÊNCIA PARA CURTIR DO SEU JEITO',
    subtitle: 'Caixas de som com conectividade e potência para diferentes momentos.',
    cta: 'CONHEÇA A SELEÇÃO'
  }, 'Áudio e Som', [
    { index: 0, label: 'Caixa de som', confidence: 0.99 }
  ], PRODUCTS);

  assert.equal(fixed.category, 'ÁUDIO & SOM');
  assert.equal(fixed.copy.badge, 'SOM E ENTRETENIMENTO');
  assert.equal(fixed.copy.headline, 'MAIS POTÊNCIA PARA CURTIR DO SEU JEITO');
  assert.equal(
    fixed.copy.subtitle,
    'Caixas de som com conectividade e potência para diferentes momentos.'
  );
});

test('prompt exige copy específica quando a visão reconhece áudio', () => {
  const request = buildAiDirectorRequest(PRODUCTS, new Date('2026-09-27T12:00:00Z'));
  const developer = request.input.find(item => item.role === 'developer');
  const textBody = developer.content.map(item => item.text || '').join(' ');

  assert.match(textBody, /categoria visual reconhecida/i);
  assert.match(textBody, /áudio\/som\/caixas de som/i);
  assert.match(textBody, /não use "SELEÇÃO ARIANA"/i);
});
