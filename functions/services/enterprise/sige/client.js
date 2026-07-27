import axios from 'axios';

function cleanBaseUrl(value = '') {
  return String(value || 'https://api.sigecloud.com.br').replace(/\/+$/, '');
}

function pickEnv(name, fallback = '') {
  return String(process.env[name] || fallback || '').trim();
}

export function getSigeConfig(overrides = {}) {
  const apiUrl = cleanBaseUrl(overrides.apiUrl || pickEnv('SIGE_API_URL', 'https://api.sigecloud.com.br'));
  const token = String(overrides.token || pickEnv('SIGE_TOKEN')).trim();
  const user = String(overrides.user || pickEnv('SIGE_USER')).trim();
  const app = String(overrides.app || pickEnv('SIGE_APP')).trim();
  const timeoutMs = Number(overrides.timeoutMs || process.env.SIGE_TIMEOUT_MS || 30000);
  return { apiUrl, token, user, app, timeoutMs };
}

export class SigeClient {
  constructor(config = {}) {
    this.config = getSigeConfig(config);
    this.http = axios.create({
      baseURL: this.config.apiUrl,
      timeout: this.config.timeoutMs,
      headers: this.headers()
    });
  }

  headers(extra = {}) {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Authorization-Token': this.config.token,
      User: this.config.user,
      App: this.config.app,
      ...extra
    };
  }

  ensureConfigured() {
    const missing = [];
    if (!this.config.apiUrl) missing.push('SIGE_API_URL');
    if (!this.config.token) missing.push('SIGE_TOKEN');
    if (!this.config.user) missing.push('SIGE_USER');
    if (!this.config.app) missing.push('SIGE_APP');
    if (missing.length) {
      const error = new Error(`SIGE Cloud não configurado: ${missing.join(', ')}`);
      error.statusCode = 500;
      throw error;
    }
  }

  async request(method, endpoint, data = null, options = {}) {
    this.ensureConfigured();
    const startedAt = Date.now();
    const url = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    try {
      const response = await this.http.request({
        method,
        url,
        data,
        params: options.params || undefined,
        headers: this.headers(options.headers || {})
      });
      return {
        ok: true,
        status: response.status,
        data: response.data,
        elapsedMs: Date.now() - startedAt,
        endpoint: url,
        method: String(method).toUpperCase()
      };
    } catch (error) {
      const responseData = error.response?.data || null;
      const status = error.response?.status || 500;
      const wrapped = new Error(responseData?.Message || responseData?.message || error.message || 'Erro SIGE Cloud');
      wrapped.statusCode = status;
      wrapped.responseData = responseData;
      wrapped.elapsedMs = Date.now() - startedAt;
      wrapped.endpoint = url;
      wrapped.method = String(method).toUpperCase();
      throw wrapped;
    }
  }

  get(endpoint, params = {}) {
    return this.request('GET', endpoint, null, { params });
  }

  post(endpoint, data = {}, options = {}) {
    return this.request('POST', endpoint, data, options);
  }

  put(endpoint, data = {}, options = {}) {
    return this.request('PUT', endpoint, data, options);
  }

  async health() {
    return this.get('/request/status');
  }

  async salvarPedido(payload, { retornarPedido = true } = {}) {
    return this.post('/request/Pedidos/Salvar', payload, { params: { retornarPedido } });
  }

  async salvarEFaturar(payload, { retornarPedido = true } = {}) {
    return this.post('/request/Pedidos/SalvarEFaturar', payload, { params: { retornarPedido } });
  }

  async pesquisarPedidos(params = {}) {
    return this.get('/request/Pedidos/Pesquisar', params);
  }

  async getTodosPedidos(page = 1) {
    return this.get('/request/Pedidos/GetTodosPedidos', { page });
  }
}
