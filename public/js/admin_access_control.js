(function () {
  'use strict';

  const state = {
    ready: false,
    user: null,
    role: '',
    permissions: new Set(),
    originalChangeView: null
  };

  const VIEW_PERMISSIONS = {
    dashboard: ['dashboard:read'],
    atendimentos: ['atendimentos:read'],
    products: ['products:read'],
    marketing: ['banners:read', 'marketing:read', 'coupons:read', 'posters:generate', 'posters:generate:bulk'],
    orders: ['orders:read'],
    categories: ['categories:read'],
    payments: ['payments:read', 'finance:read'],
    finance: ['finance:read', 'finance:reports'],
    crediario: ['crediario:read'],
    logistics: ['shipping:read', 'shipping:tracking', 'correios:read'],
    sellers: ['sellers:read'],
    reports: ['reports:read'],
    settings: ['settings:read'],
    coupons: ['coupons:read'],
    enterprise: ['enterprise:read']
  };

  function apiBase() {
    const configured = String(window.API_BASE_URL || window.__API_BASE_URL__ || '').replace(/\/+$/, '');
    if (configured) return configured.endsWith('/api') ? configured : configured + '/api';
    return ['localhost', '127.0.0.1'].includes(location.hostname) ? 'http://localhost:3000/api' : '/api';
  }

  function token() {
    for (const key of ['adminToken', 'admin_token', 'token', 'authToken']) {
      const value = localStorage.getItem(key) || sessionStorage.getItem(key);
      if (value) return value;
    }
    return '';
  }

  function isAdmin() {
    return state.role === 'admin' || state.permissions.has('*');
  }

  function has(permission) {
    return isAdmin() || state.permissions.has(permission);
  }

  function hasAny(list) {
    return isAdmin() || list.some(has);
  }

  function notify(message) {
    if (typeof window.showToast === 'function') {
      window.showToast(message, 'error');
      return;
    }
    const box = document.createElement('div');
    box.textContent = message;
    box.style.cssText = 'position:fixed;right:20px;top:20px;z-index:999999;background:#b91c1c;color:#fff;padding:12px 16px;border-radius:10px;font:700 14px Arial;box-shadow:0 12px 30px rgba(0,0,0,.25)';
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 3500);
  }

  function applyElementRules(root) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('[data-permission]').forEach((element) => {
      const required = String(element.dataset.permission || '').split(',').map((x) => x.trim()).filter(Boolean);
      const mode = element.dataset.permissionMode === 'all' ? 'all' : 'any';
      const allowed = mode === 'all' ? required.every(has) : hasAny(required);
      element.hidden = !allowed;
      element.setAttribute('aria-hidden', allowed ? 'false' : 'true');
    });

    scope.querySelectorAll('[data-admin-only]').forEach((element) => {
      element.hidden = !isAdmin();
      element.setAttribute('aria-hidden', isAdmin() ? 'false' : 'true');
    });
  }

  function firstAllowedView() {
    for (const [view, required] of Object.entries(VIEW_PERMISSIONS)) {
      if (hasAny(required)) return view;
    }
    return null;
  }

  function guardChangeView() {
    const current = window.changeView;
    if (typeof current !== 'function' || current.__permissionWrapped) return;
    state.originalChangeView = current;
    const wrapped = function (view, ...args) {
      const required = VIEW_PERMISSIONS[view] || [];
      if (!isAdmin() && required.length && !hasAny(required)) {
        notify('Seu usuário não possui permissão para acessar este módulo.');
        return false;
      }
      return current.call(this, view, ...args);
    };
    wrapped.__permissionWrapped = true;
    window.changeView = wrapped;
  }

  function interceptForbiddenResponses() {
    if (window.fetch.__adminPermissionWrapped) return;
    const originalFetch = window.fetch.bind(window);
    const wrappedFetch = async (...args) => {
      const response = await originalFetch(...args);
      if (response.status === 403) {
        try {
          const clone = response.clone();
          const payload = await clone.json();
          if (/permiss|acesso negado/i.test(String(payload.error || payload.message || ''))) {
            notify(payload.error || payload.message || 'Acesso não autorizado.');
          }
        } catch (_) {}
      }
      return response;
    };
    wrappedFetch.__adminPermissionWrapped = true;
    window.fetch = wrappedFetch;
  }

  async function loadIdentity() {
    const authToken = token();
    if (!authToken) return null;
    const response = await fetch(apiBase() + '/admin/me', {
      headers: { Authorization: 'Bearer ' + authToken }
    });
    if (!response.ok) return null;
    return response.json();
  }

  async function initialize() {
    interceptForbiddenResponses();
    const identity = await loadIdentity().catch(() => null);
    if (!identity) return;

    state.user = identity;
    state.role = String(identity.role || '').toLowerCase();
    state.permissions = new Set(Array.isArray(identity.permissions) ? identity.permissions : []);
    state.ready = true;

    applyElementRules(document);
    guardChangeView();

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
        if (node.nodeType === 1) applyElementRules(node);
      }));
      guardChangeView();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    if (!isAdmin()) {
      const active = document.querySelector('.view-link.active')?.dataset.view;
      const activeRequired = VIEW_PERMISSIONS[active] || [];
      if (activeRequired.length && !hasAny(activeRequired)) {
        const fallback = firstAllowedView();
        if (fallback && typeof window.changeView === 'function') window.changeView(fallback);
      }
    }

    window.dispatchEvent(new CustomEvent('admin-access-ready', { detail: identity }));
  }

  window.AdminAccess = {
    state,
    has,
    hasAny,
    isAdmin,
    require(permission, message) {
      if (has(permission)) return true;
      notify(message || 'Você não possui permissão para realizar esta ação.');
      return false;
    },
    apply: applyElementRules
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(initialize, 0));
  } else {
    setTimeout(initialize, 0);
  }
})();
