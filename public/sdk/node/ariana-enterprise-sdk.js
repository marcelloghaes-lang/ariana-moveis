class ArianaEnterpriseClient {
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
        err.status = res.status;
        err.response = data;
        throw err;
      }
      return data;
    } finally { clearTimeout(timer); }
  }
  health() { return this.request('GET', '/health'); }
  authCheck() { return this.request('GET', '/auth/check'); }
  catalogPush(products, manufacturer = 'ariana_moveis') { return this.request('POST', '/catalog/push', { manufacturer, products: Array.isArray(products) ? products : [products] }); }
  productSync(sku, payload) { return this.request('POST', `/products/${encodeURIComponent(sku)}/sync`, payload); }
  updateStock(sku, payload) { return this.request('PUT', `/products/${encodeURIComponent(sku)}/stock`, payload); }
  updatePrice(sku, payload) { return this.request('PUT', `/products/${encodeURIComponent(sku)}/price`, payload); }
  createOrder(payload) { return this.request('POST', '/orders', payload); }
  sendInvoice(orderId, payload) { return this.request('POST', `/orders/${encodeURIComponent(orderId)}/invoice`, payload); }
  sendTracking(orderId, payload) { return this.request('POST', `/orders/${encodeURIComponent(orderId)}/tracking`, payload); }
  webhookTest(payload) { return this.request('POST', '/webhooks/test', payload); }
  get catalog() { return { push: this.catalogPush.bind(this) }; }
  get products() { return { sync: this.productSync.bind(this), updateStock: this.updateStock.bind(this), updatePrice: this.updatePrice.bind(this) }; }
  get orders() { return { create: this.createOrder.bind(this), invoice: this.sendInvoice.bind(this), tracking: this.sendTracking.bind(this) }; }
  get webhooks() { return { test: this.webhookTest.bind(this) }; }
}
module.exports = { ArianaEnterpriseClient };
