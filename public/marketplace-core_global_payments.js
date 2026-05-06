(function () {
  "use strict";

  const API_BASE_LOCAL =
    window.API_BASE ||
    localStorage.getItem("API_BASE") ||
    localStorage.getItem("API_BASE_URL") ||
    "https://ariana-backend.onrender.com/api";

  window.API_BASE = window.API_BASE || API_BASE_LOCAL;
  window.API_ORIGIN = window.API_ORIGIN || String(window.API_BASE).replace(/\/api\/?$/i, "");

  function toNumberBR(value, fallback = 0) {
    try {
      if (value === null || value === undefined) return fallback;
      if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
      let s = String(value).trim();
      if (!s) return fallback;
      s = s.replace(/[R$\s]/g, "").replace(/[^0-9.,-]/g, "");
      const hasComma = s.includes(",");
      const hasDot = s.includes(".");
      if (hasComma && hasDot) s = s.replace(/\./g, "").replace(",", ".");
      else if (hasComma && !hasDot) s = s.replace(",", ".");
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : fallback;
    } catch (_) {
      return fallback;
    }
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
        maxInstallments: Math.max(1, Math.min(24, Math.floor(toNumberBR(card.maxInstallments, 12)))) || 12,
        interestFree: card.interestFree ?? true
      }
    };
  }

  window.__PAYMENT_SETTINGS = window.__PAYMENT_SETTINGS || normalizePaymentSettings(null);

  window.getPaymentSettings = async function getPaymentSettings() {
    try {
      const res = await fetch(String(window.API_BASE).replace(/\/+$/, "") + "/settings/payments", {
        headers: { Accept: "application/json" },
        cache: "no-store"
      });
      if (!res.ok) throw new Error("settings/payments HTTP " + res.status);
      const data = await res.json().catch(() => null);
      window.__PAYMENT_SETTINGS = normalizePaymentSettings(data || null);
    } catch (e) {
      console.warn("[payments] Usando configuração padrão de pagamentos:", e?.message || e);
      window.__PAYMENT_SETTINGS = normalizePaymentSettings(null);
    }
    return window.__PAYMENT_SETTINGS;
  };

  window.loadGlobalPaymentsConfig = window.getPaymentSettings;

  function formatCurrency(value) {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(toNumberBR(value, 0));
  }

  function pick(obj, keys) {
    for (const key of keys) {
      const v = obj?.[key];
      if (v !== undefined && v !== null && String(v).trim() !== "") return v;
    }
    return null;
  }

  window.decorateProductWithPayments = function decorateProductWithPayments(product) {
    const p = product && typeof product === "object" ? { ...product } : {};
    const fullPrice = toNumberBR(p.price ?? p.preco ?? p.valor ?? 0, 0);
    const pixPercent = toNumberBR(p.pixDiscountPercent ?? p.descontoPixPercent, window.__PAYMENT_SETTINGS?.pix?.discountPercent ?? 17);
    const pixPrice = fullPrice > 0 ? +(fullPrice * (1 - pixPercent / 100)).toFixed(2) : 0;
    const installments = Math.max(1, Math.min(24, Math.floor(toNumberBR(p.installmentCount ?? p.installmentsCount ?? p.parcelas, window.__PAYMENT_SETTINGS?.card?.maxInstallments ?? 12)))) || 12;
    const old = toNumberBR(pick(p, ["oldPrice", "old_price", "precoAntigo", "precoDe", "originalPrice", "priceOriginal", "listPrice", "regularPrice", "precoOriginal", "preco_cheio", "precoCortado"]), 0);
    return {
      ...p,
      __priceFull: fullPrice,
      __pricePix: pixPrice,
      __pixPercent: pixPercent,
      __installmentsCount: installments,
      __installmentValue: fullPrice / installments,
      __oldPrice: old > fullPrice ? old : 0,
      __priceFullFormatted: formatCurrency(fullPrice),
      __pricePixFormatted: formatCurrency(pixPrice),
      __installmentFormatted: formatCurrency(fullPrice / installments),
      __oldPriceFormatted: old > fullPrice ? formatCurrency(old) : ""
    };
  };

  // Só cria card se product-card.js ainda não tiver carregado. Assim evita sobrescrever o padrão visual.
  if (typeof window.createProductCard !== "function") {
    window.createProductCard = function createProductCard(product) {
      const p = window.decorateProductWithPayments(product);
      const id = p.id || p._id || p.productId || "";
      const name = p.name || p.nome || p.title || "Produto";
      const image = p.mainImageUrl || p.imageUrl || p.image || p.imagem || "https://placehold.co/600x400/ffffff/333333?text=Sem+Imagem";
      const oldHtml = p.__oldPrice ? `<div class="product-old-price">${p.__oldPriceFormatted}</div>` : `<div class="product-old-price">&nbsp;</div>`;
      return `
        <a class="product-card" href="produto.html?id=${encodeURIComponent(id)}">
          <div class="product-tag-container"><span class="product-tag tag-orange">-${Math.round(p.__pixPercent)}% OFF</span></div>
          <div class="product-image-container"><img src="${image}" alt="${name}" loading="lazy"></div>
          <div class="product-card-body">
            <div class="product-name">${name}</div>
            ${oldHtml}
            <div class="product-price">${p.__pricePixFormatted} <span style="font-size:.72rem;color:#00a650;font-weight:800;">${Math.round(p.__pixPercent)}% OFF</span></div>
            <div style="font-size:.75rem;color:#555;font-weight:600;margin-top:5px;">no PIX à vista</div>
            <div class="product-installments">ou ${p.__installmentsCount}x de ${p.__installmentFormatted} s/ juros</div>
            <div style="font-size:.72rem;color:#888;margin-top:4px;">Total parcelado: ${p.__priceFullFormatted}</div>
          </div>
        </a>`;
    };
  }

  try { window.getPaymentSettings(); } catch (_) {}
})();
