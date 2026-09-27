import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAiDirectorRequest,
  sanitizeAiCreativeDirection
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

  assert.equal(result.category, 'Áudio & Som');
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
