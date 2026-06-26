/* Ariana Enterprise SDK - Browser/UMD v1.0.0 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ArianaEnterpriseSDK = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  class ArianaEnterpriseSDK {
    constructor(options = {}) {
      this.apiKey = options.apiKey || '';
      this.baseUrl = (options.baseUrl || 'https://ariana-backend.onrender.com/api').replace(/\/+$/, '');
      this.version = options.version || 'v1';
      this.environment = options.environment || 'sandbox';
      this.timeoutMs = Number(options.timeoutMs || 30000);
      this.bearerToken = options.bearerToken || '';
    }
    headers(extra = {}) {
      const headers = { 'Content-Type': 'application/json', ...extra };
      if (this.bearerToken) headers.Authorization = `Bearer ${this.bearerToken}`;
      else if (this.apiKey) headers['x-ariana-key'] = this.apiKey;
      return headers;
    }
    async request(method, path, body, options = {}) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs || this.timeoutMs);
      const url = `${this.baseUrl}/${this.version}/enterprise${path.startsWith('/') ? path : `/${path}`}`;
      try {
        const res = await fetch(url, { method, headers: this.headers(options.headers || {}), body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
        const text = await res.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch (_) { data = { raw: text }; }
        if (!res.ok) {
          const err = new Error(data?.error || data?.message || `HTTP ${res.status}`);
          err.status = res.status; err.response = data; err.headers = res.headers;
          throw err;
        }
        return data;
      } finally { clearTimeout(timer); }
    }
    health() { return this.request('GET', '/health'); }
    authCheck() { return this.request('GET', '/auth/check'); }
    getVersions() { return fetch(`${this.baseUrl}/enterprise/versions`).then(r => r.json()); }
    catalog = { push: (products, manufacturer = 'ariana_moveis') => this.request('POST', '/catalog/push', { manufacturer, products: Array.isArray(products) ? products : [products] }) };
    products = {
      sync: (sku, payload) => this.request('POST', `/products/${encodeURIComponent(sku)}/sync`, payload),
      updateStock: (sku, payload) => this.request('PUT', `/products/${encodeURIComponent(sku)}/stock`, payload),
      updatePrice: (sku, payload) => this.request('PUT', `/products/${encodeURIComponent(sku)}/price`, payload),
    };
    orders = {
      create: (payload) => this.request('POST', '/orders', payload),
      invoice: (orderId, payload) => this.request('POST', `/orders/${encodeURIComponent(orderId)}/invoice`, payload),
      tracking: (orderId, payload) => this.request('POST', `/orders/${encodeURIComponent(orderId)}/tracking`, payload),
    };
    webhooks = { test: (payload) => this.request('POST', '/webhooks/test', payload) };
  }
  return ArianaEnterpriseSDK;
});
