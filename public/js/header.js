(function () {
  'use strict';

  // Este arquivo já era referenciado pela Home, mas não existia no repositório.
  // Mantemos o slot original e usamos somente para SEO técnico/resource hints,
  // sem alterar o cabeçalho visual existente.
  try { document.documentElement.lang = 'pt-BR'; } catch (_) {}

  function ensureMeta(selector, attrs) {
    let node = document.head.querySelector(selector);
    if (!node) {
      node = document.createElement('meta');
      document.head.appendChild(node);
    }
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    return node;
  }

  function ensureLink(rel, href, extra) {
    let node = document.head.querySelector(`link[rel="${rel}"][href="${href}"]`);
    if (!node) {
      node = document.createElement('link');
      node.rel = rel;
      node.href = href;
      if (extra) Object.entries(extra).forEach(([key, value]) => node.setAttribute(key, value));
      document.head.appendChild(node);
    }
    return node;
  }

  ensureMeta('meta[name="robots"]', {
    name: 'robots',
    content: 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1'
  });
  ensureMeta('meta[property="og:type"]', { property: 'og:type', content: 'website' });
  ensureMeta('meta[property="og:site_name"]', { property: 'og:site_name', content: 'Ariana Móveis' });
  ensureMeta('meta[property="og:locale"]', { property: 'og:locale', content: 'pt_BR' });
  ensureMeta('meta[name="twitter:card"]', { name: 'twitter:card', content: 'summary' });
  ensureMeta('meta[name="twitter:title"]', {
    name: 'twitter:title',
    content: 'Ariana Móveis | Sua casa merece o melhor'
  });
  ensureMeta('meta[name="twitter:description"]', {
    name: 'twitter:description',
    content: 'Móveis, eletrodomésticos, eletrônicos e utilidades com entrega para todo o Brasil.'
  });

  // Antecipamos DNS/TLS do backend usado pela Home, reduzindo o tempo da primeira API.
  ensureLink('preconnect', 'https://ariana-backend.onrender.com', { crossorigin: 'anonymous' });
  ensureLink('dns-prefetch', 'https://ariana-backend.onrender.com');

  if (!document.getElementById('ariana-home-structured-data')) {
    const structured = document.createElement('script');
    structured.id = 'ariana-home-structured-data';
    structured.type = 'application/ld+json';
    structured.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization',
          '@id': 'https://arianamoveis.com.br/#organization',
          name: 'Ariana Móveis',
          url: 'https://arianamoveis.com.br/',
          logo: 'https://arianamoveis.com.br/favicon.png'
        },
        {
          '@type': 'WebSite',
          '@id': 'https://arianamoveis.com.br/#website',
          url: 'https://arianamoveis.com.br/',
          name: 'Ariana Móveis',
          publisher: { '@id': 'https://arianamoveis.com.br/#organization' },
          inLanguage: 'pt-BR'
        }
      ]
    });
    document.head.appendChild(structured);
  }

  function tuneProductImages(root) {
    const scope = root && root.querySelectorAll ? root : document;
    const images = Array.from(scope.querySelectorAll('.product-card img'));
    images.forEach((img, index) => {
      img.decoding = 'async';
      // Primeiros cards permanecem imediatos; os demais só carregam perto da viewport.
      if (index < 4 && document.querySelectorAll('.product-card img').length <= images.length) {
        img.loading = 'eager';
      } else if (!img.hasAttribute('loading')) {
        img.loading = 'lazy';
      }
    });
  }

  function tuneAllImages() {
    document.querySelectorAll('img').forEach((img) => {
      if (!img.hasAttribute('decoding')) img.decoding = 'async';
    });
    tuneProductImages(document);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tuneAllImages, { once: true });
  } else {
    tuneAllImages();
  }

  // Os cards da Home chegam depois da API; ajusta apenas os novos nós.
  if (typeof MutationObserver === 'function') {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes || []) {
          if (!(node instanceof Element)) continue;
          if (node.matches?.('.product-card') || node.querySelector?.('.product-card')) {
            requestAnimationFrame(tuneAllImages);
            return;
          }
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
