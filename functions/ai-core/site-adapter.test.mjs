import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSitePage, normalizeSiteRequest, routeSiteShadow } from './site-adapter.mjs';

test('reconhece página de produto', () => {
  const page = normalizeSitePage({ path: '/produto.html?id=123', productId: '123' });
  assert.equal(page.pageType, 'product');
  assert.equal(page.productId, '123');
});

test('site não pode ser falsificado como financeiro', () => {
  const result = normalizeSiteRequest({ channel: 'financeiro', message: 'oi' });
  assert.equal(result.channel, 'site');
});

test('pergunta de produto no site vai para comercial', () => {
  const result = routeSiteShadow({
    message: 'Tem geladeira frost free?',
    page: { path: '/index.html' }
  });
  assert.equal(result.decision.route, 'COMERCIAL');
  assert.equal(result.policy.channel, 'site');
  assert.equal(result.productionWritesEnabled, false);
});

test('site nunca habilita resposta nessa fase', () => {
  const result = routeSiteShadow({ message: 'Oi' });
  assert.equal(result.responseEnabled, false);
  assert.equal(result.policy.productionWritesEnabled, false);
});

test('sessão é armazenada apenas como hash', () => {
  const result = normalizeSiteRequest({ sessionId: 'sessao-secreta', message: 'Oi' });
  assert.notEqual(result.sessionHash, 'sessao-secreta');
  assert.equal(result.sessionHash.length, 20);
});
