const TELEVENDAS_API_BASE =
  (window.ARIANA_API_BASE_URL || 'http://localhost:3000/api').replace(/\/+$/, '');

function getAdminToken() {
  return (
    localStorage.getItem('adminToken') ||
    localStorage.getItem('tokenAdmin') ||
    localStorage.getItem('token') ||
    ''
  );
}

async function apiRequest(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  const token = getAdminToken();
  if (token && options.public !== true) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${TELEVENDAS_API_BASE}${path}`, {
    ...options,
    headers
  });

  let data = null;
  try {
    data = await response.json();
  } catch (_error) {
    data = { ok: false, error: 'Resposta inválida do servidor.' };
  }

  if (!response.ok || data?.ok === false) {
    const error = new Error(data?.error || `Erro HTTP ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

export const televendasApi = {
  createOrder(payload) {
    return apiRequest('/televendas/orders', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  listOrders(params = {}) {
    const query = new URLSearchParams(params).toString();
    return apiRequest(`/televendas/orders${query ? `?${query}` : ''}`);
  },

  getOrder(orderId) {
    return apiRequest(`/televendas/orders/${encodeURIComponent(orderId)}`);
  },

  updateOrder(orderId, payload) {
    return apiRequest(`/televendas/orders/${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
  },

  generatePaymentLink(orderId, payload = {}) {
    return apiRequest(
      `/televendas/orders/${encodeURIComponent(orderId)}/payment-link`,
      {
        method: 'POST',
        body: JSON.stringify(payload)
      }
    );
  },

  cancelOrder(orderId, reason = '') {
    return apiRequest(
      `/televendas/orders/${encodeURIComponent(orderId)}/cancel`,
      {
        method: 'POST',
        body: JSON.stringify({ reason })
      }
    );
  },

  reconcilePayment(orderId) {
    return apiRequest(
      `/televendas/orders/${encodeURIComponent(orderId)}/reconcile-payment`,
      { method: 'POST', body: '{}' }
    );
  },

  getPublicOrder(token) {
    return apiRequest(
      `/televendas/payment-links/${encodeURIComponent(token)}`,
      { public: true }
    );
  },

  registerPublicAccess(token) {
    return apiRequest(
      `/televendas/payment-links/${encodeURIComponent(token)}/access`,
      { method: 'POST', public: true, body: '{}' }
    );
  },

  createPix(token, payload) {
    return apiRequest(
      `/televendas/payment-links/${encodeURIComponent(token)}/pix`,
      {
        method: 'POST',
        public: true,
        body: JSON.stringify(payload)
      }
    );
  },

  createCard(token, payload) {
    return apiRequest(
      `/televendas/payment-links/${encodeURIComponent(token)}/card`,
      {
        method: 'POST',
        public: true,
        body: JSON.stringify(payload)
      }
    );
  }
};

window.televendasApi = televendasApi;
