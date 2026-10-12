(() => {
  if (window.__ARIANA_SELLER_LOGOUT_V1__) return;
  window.__ARIANA_SELLER_LOGOUT_V1__ = true;

  const API_BASE = (
    window.API_BASE ||
    (location.hostname === 'localhost' || location.hostname === '127.0.0.1'
      ? 'http://localhost:3000/api'
      : 'https://ariana-backend.onrender.com/api')
  ).replace(/\/+$/, '');

  function sellerToken() {
    return localStorage.getItem('seller_token') || '';
  }

  function clearSellerSession() {
    [
      'seller_token',
      'seller_profile',
      'seller_status',
      'seller_active',
      'seller_id',
      'partner_request_id'
    ].forEach((key) => localStorage.removeItem(key));
  }

  async function revokeSellerSession(token) {
    if (!token) return;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), 3500) : null;
    try {
      await fetch(`${API_BASE}/seller/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
        keepalive: true,
        signal: controller?.signal
      });
    } catch (error) {
      console.warn('[Seller] Não foi possível revogar a sessão no servidor.', error);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async function logoutSeller() {
    if (window.__ARIANA_SELLER_LOGOUT_RUNNING__) return;
    window.__ARIANA_SELLER_LOGOUT_RUNNING__ = true;
    const token = sellerToken();
    try {
      await revokeSellerSession(token);
    } finally {
      clearSellerSession();
      location.replace('seller_login.html');
    }
  }

  document.addEventListener('click', (event) => {
    const trigger = event.target?.closest?.('#btn-sair, #logout-btn, [data-seller-logout]');
    if (!trigger) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    logoutSeller();
  }, true);

  window.logoutSeller = logoutSeller;
})();
