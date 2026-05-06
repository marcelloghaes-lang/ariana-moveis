(function () {
  "use strict";

  const API_BASE_SAFE = window.API_BASE || localStorage.getItem("API_BASE") || "https://ariana-backend.onrender.com/api";
  window.API_BASE = API_BASE_SAFE;
  window.API_ORIGIN = window.API_ORIGIN || String(API_BASE_SAFE).replace(/\/api\/?$/i, "");

  function toNumberBR(value, fallback = 0) {
    try {
      if (value === null || value === undefined) return fallback;
      if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
      let s = String(value).trim();
      if (!s || s === "-" || s.toLowerCase() === "null" || s.toLowerCase() === "undefined") return fallback;
      s = s.replace(/[R$\s]/g, "").replace(/[^0-9.,-]/g, "");
      if (!s || s === "-") return fallback;
      const hasComma = s.includes(",");
      const hasDot = s.includes(".");
      if (hasComma && hasDot) s = s.replace(/\./g, "").replace(",", ".");
      else if (hasComma && !hasDot) s = s.replace(",", ".");
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : fallback;
    } catch (_) { return fallback; }
  }

  window.__toNumberBR = window.__toNumberBR || toNumberBR;

  const DEFAULT_PAYMENT_SETTINGS = {
    pix: { enabled: true, discountPercent: 17, label: "PIX" },
    boleto: { enabled: false, discountPercent: 0, label: "Boleto" },
    card: { enabled: true, maxInstallments: 12, interestFree: true }
  };

  function normalizePaymentSettings(raw) {
    const s = raw && typeof raw === "object" ? raw : {};
    const pix = s.pix || {};
    const boleto = s.boleto || {};
    const card = s.card || {};
    return {
      pix: {
        enabled: pix.enabled ?? DEFAULT_PAYMENT_SETTINGS.pix.enabled,
        discountPercent: toNumberBR(pix.discountPercent, DEFAULT_PAYMENT_SETTINGS.pix.discountPercent),
        label: pix.label || DEFAULT_PAYMENT_SETTINGS.pix.label
      },
      boleto: {
        enabled: boleto.enabled ?? DEFAULT_PAYMENT_SETTINGS.boleto.enabled,
        discountPercent: toNumberBR(boleto.discountPercent, DEFAULT_PAYMENT_SETTINGS.boleto.discountPercent),
        label: boleto.label || DEFAULT_PAYMENT_SETTINGS.boleto.label
      },
      card: {
        enabled: card.enabled ?? DEFAULT_PAYMENT_SETTINGS.card.enabled,
        maxInstallments: Math.max(1, Math.min(24, Math.floor(toNumberBR(card.maxInstallments, 12)))),
        interestFree: card.interestFree ?? true
      }
    };
  }

  window.__PAYMENT_SETTINGS = window.__PAYMENT_SETTINGS || normalizePaymentSettings(null);

  window.getPaymentSettings = window.getPaymentSettings || async function () {
    try {
      const res = await fetch(`${window.API_BASE.replace(/\/+$/, "")}/settings/payments`, { headers: { Accept: "application/json" }, cache: "no-store" });
      const data = await res.json().catch(() => null);
      window.__PAYMENT_SETTINGS = normalizePaymentSettings(data || null);
    } catch (_) {
      window.__PAYMENT_SETTINGS = normalizePaymentSettings(null);
    }
    return window.__PAYMENT_SETTINGS;
  };

  window.loadGlobalPaymentsConfig = window.loadGlobalPaymentsConfig || window.getPaymentSettings;

  window.decorateProductWithPayments = window.decorateProductWithPayments || function (product) {
    return product || {};
  };

  // Importante: não sobrescreve createProductCard se product-card.js já carregou.
  // Se esta biblioteca carregar primeiro, cria o mesmo padrão visual para não quebrar as páginas.
  if (typeof window.createProductCard !== "function") {
    const s = document.createElement("script");
    s.src = "./product-card.js";
    s.async = false;
    document.head.appendChild(s);
  }

  try { window.getPaymentSettings(); } catch (_) {}
})();
