import { createHash } from 'crypto';
import { classifyCurrentMessage } from './router.mjs';
import { policyForChannel } from './channel-policy.mjs';

function clean(value = '', max = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function normalizeSitePage(page = {}) {
  const path = clean(page.path || page.pathname || '/', 180);
  const productId = clean(page.productId || page.id || '', 120);
  const query = clean(page.query || page.searchQuery || '', 180);
  const title = clean(page.title || '', 180);

  const pageType =
    /produto\.html/i.test(path) ? 'product'
    : /checkout\.html/i.test(path) ? 'checkout'
    : /carrinho\.html/i.test(path) ? 'cart'
    : /meus_pedidos\.html|detalhes_pedido\.html/i.test(path) ? 'orders'
    : /busca\.html|todos_produtos\.html|categoria\.html|ofertas\.html/i.test(path) ? 'catalog'
    : 'general';

  return { path, productId, query, title, pageType };
}

export function normalizeSiteRequest(payload = {}) {
  const message = clean(payload.message || payload.text || '', 1500);
  const page = normalizeSitePage(payload.page || {});
  const sessionSource = clean(payload.sessionId || payload.session || '', 180);
  const sessionHash = sessionSource
    ? createHash('sha256').update(sessionSource).digest('hex').slice(0, 20)
    : '';

  return {
    channel: 'site',
    message,
    page,
    sessionHash
  };
}

export function routeSiteShadow(payload = {}) {
  const request = normalizeSiteRequest(payload);
  const decision = classifyCurrentMessage({
    channel: 'site',
    text: request.message,
    previousIntent: clean(payload.previousIntent || '', 80)
  });
  const policy = policyForChannel('site');

  return {
    request,
    decision,
    policy,
    responseEnabled: false,
    productionWritesEnabled: false,
    mode: 'shadow'
  };
}
