(() => {
  'use strict';

  const originalFetch = window.fetch.bind(window);
  const ROUTES = [
    ['/api/admin/financeiro/clientes', '/api/erp/finance-panel/clientes'],
    ['/api/admin/financeiro/dashboard', '/api/erp/finance-panel/dashboard'],
    ['/api/admin/sige/lancamentos', '/api/erp/finance-panel/lancamentos'],
    ['/api/admin/sige/inadimplentes', '/api/erp/finance-panel/inadimplentes']
  ];

  function remapUrl(value) {
    try {
      const raw = String(value || '');
      if (!raw) return raw;
      const url = new URL(raw, window.location.href);
      const rule = ROUTES.find(([from]) => url.pathname === from);
      if (!rule) return raw;
      url.pathname = rule[1];
      url.searchParams.delete('maxRecords');
      return url.toString();
    } catch (_error) {
      return value;
    }
  }

  window.fetch = function arianaFinanceFetch(input, init) {
    if (typeof input === 'string' || input instanceof URL) {
      return originalFetch(remapUrl(input), init);
    }

    if (input instanceof Request) {
      const nextUrl = remapUrl(input.url);
      if (nextUrl !== input.url) {
        return originalFetch(new Request(nextUrl, input), init);
      }
    }

    return originalFetch(input, init);
  };

  window.__ARIANA_FINANCE_SOURCE__ = 'ariana_erp';
  console.info('[Financeiro Ariana] consultas operacionais conectadas ao Ariana ERP');
})();
