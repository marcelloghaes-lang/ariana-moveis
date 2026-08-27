/*
 * Ariana Móveis - Cards + Pagamentos
 * Versão GLOBAL / CLASSIC SCRIPT
 * Compatível com: <script src="marketplace-core_global_payments.js"></script>
 */
"use strict";

(function (global) {
  function toNumberBR(v, fallback = 0) {
    if (v === null || v === undefined) return fallback;
    if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
    if (typeof v === "boolean") return v ? 1 : 0;

    let s = String(v).trim();
    if (!s) return fallback;

    s = s.replace(/[R$\s]/g, "");
    s = s.replace(/[^\d,.\-]/g, "");

    const hasDot = s.includes(".");
    const hasComma = s.includes(",");

    if (hasDot && hasComma) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else if (hasComma && !hasDot) {
      s = s.replace(",", ".");
    } else {
      const dots = (s.match(/\./g) || []).length;
      if (dots > 1) s = s.replace(/\./g, "");
    }

    const n = Number(s);
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function formatCurrencyBRL(value) {
    const v = toNumberBR(value, 0);
    try {
      return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL"
      }).format(v);
    } catch (_e) {
      return "R$ " + v.toFixed(2).replace(".", ",");
    }
  }

  function formatPricePartsBRL(value) {
    const v = toNumberBR(value, 0);
    const [intPart, decPart] = v.toFixed(2).split(".");
    return {
      symbol: "R$",
      integer: String(intPart).replace(/\B(?=(\d{3})+(?!\d))/g, "."),
      decimal: decPart || "00"
    };
  }

  function getProductImageUrl(p) {
    if (!p) return null;

    const direct =
      p.imageUrl || p.mainImageUrl || p.imagemUrl || p.imagem ||
      p.foto || p.thumbnailUrl || p.thumbnail;

    if (direct) return direct;

    const arr =
      Array.isArray(p.images) && p.images.length ? p.images :
      Array.isArray(p.imagens) && p.imagens.length ? p.imagens :
      Array.isArray(p.gallery) && p.gallery.length ? p.gallery : null;

    if (arr) {
      const mainObj = arr.find(
        x => x && typeof x === "object" &&
        (x.isMain === true || x.main === true || x.principal === true)
      );
      if (mainObj && (mainObj.url || mainObj.src)) return mainObj.url || mainObj.src;

      const firstObj = arr.find(
        x => x && typeof x === "object" && (x.url || x.src)
      );
      if (firstObj) return firstObj.url || firstObj.src;

      const firstStr = arr.find(
        x => typeof x === "string" && x.startsWith("http")
      );
      if (firstStr) return firstStr;
    }

    if (p.url && String(p.url).startsWith("http")) return p.url;
    return null;
  }

  function normalizeProduct(p) {
    const raw = p || {};

    const price = toNumberBR(
      raw.price ?? raw.valor ?? raw.preco ?? raw.priceValue ?? raw.precoVista,
      0
    );

    const oldPrice = toNumberBR(
      raw.oldPrice ?? raw.precoDe ?? raw.preco_antigo ?? raw.old_price ??
      raw.listPrice ?? raw.compareAtPrice ?? raw.priceFrom ?? 0,
      0
    );

    const pixDiscountPercent = toNumberBR(
      raw.pixDiscountPercent ?? raw.descontoPixPercent ??
      raw.pix_discount_percent ?? 0,
      0
    );

    const maxInstallments = Math.max(
      1,
      Math.min(
        24,
        Math.floor(
          toNumberBR(
            raw.maxInstallments ?? raw.installmentsCount ??
            raw.parcelasMax ?? raw.parcelas ?? 12,
            12
          )
        )
      )
    );

    return {
      raw,
      id: raw.id || raw.docId || raw.productId || raw.sku || "",
      name: raw.name || raw.title || raw.nome || "Produto",
      price,
      oldPrice,
      pixDiscountPercent,
      maxInstallments,
      imageUrl: getProductImageUrl(raw) || ""
    };
  }

  function computeDiscountPercent(oldPrice, price) {
    oldPrice = toNumberBR(oldPrice, 0);
    price = toNumberBR(price, 0);
    if (!(oldPrice > 0) || !(price > 0) || oldPrice <= price) return 0;
    return Math.round(((oldPrice - price) / oldPrice) * 100);
  }

  function computePixPrice(price, pixDiscountPercent) {
    const p = toNumberBR(price, 0);
    const d = clamp(toNumberBR(pixDiscountPercent, 0), 0, 90);
    if (p <= 0 || d <= 0) return null;
    return p * (1 - d / 100);
  }

  function computeInstallments(price, maxInstallments) {
    const v = toNumberBR(price, 0);
    const count = Math.max(
      1,
      Math.min(24, Math.floor(toNumberBR(maxInstallments, 12)))
    );
    return { count, value: v > 0 ? v / count : 0 };
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function createProductCard(product, options = {}) {
    const p = normalizeProduct(product);
    const parts = formatPricePartsBRL(p.price);

    const discountPercent = computeDiscountPercent(p.oldPrice, p.price);
    const hasDiscount = discountPercent > 0;

    const discountBadge = hasDiscount
      ? `<div class="product-tag-container"><span class="product-tag tag-orange">-${discountPercent}% OFF</span></div>`
      : "";

    const oldPriceHtml = hasDiscount
      ? `<p class="product-old-price">${formatCurrencyBRL(p.oldPrice)}</p>`
      : `<p class="product-old-price opacity-0 text-transparent">.</p>`;

    const pixPrice = computePixPrice(p.price, p.pixDiscountPercent);
    const pixLine = pixPrice
      ? `<p class="product-pix-price"><i class="fa-solid fa-bolt"></i> ${formatCurrencyBRL(pixPrice)} no PIX</p>`
      : "";

    const inst = computeInstallments(p.price, p.maxInstallments);
    const installmentsLine =
      p.price > 0 && inst.value > 0
        ? `ou em até ${inst.count}x de ${formatCurrencyBRL(inst.value)} sem juros`
        : `em até ${inst.count}x`;

    const hrefBase = options.hrefBase || options.detailsPage || "produto.html";
    const queryParam = options.queryParam || "id";
    const href = p.id
      ? `${hrefBase}?${encodeURIComponent(queryParam)}=${encodeURIComponent(p.id)}`
      : hrefBase;

    const img = p.imageUrl
      ? `<img src="${escapeHtml(p.imageUrl)}" alt="${escapeHtml(p.name)}" class="product-image">`
      : `<div class="product-image placeholder"></div>`;

    return (
      `<a class="product-card" href="${href}">` +
        `<div class="product-image-container">${discountBadge}${img}</div>` +
        `<div class="product-info">` +
          `<p class="product-name">${escapeHtml(p.name)}</p>` +
          oldPriceHtml +
          `<div class="product-price">` +
            `<span class="currency">${parts.symbol}</span>` +
            `<span class="price-integer">${parts.integer}</span>` +
            `<span class="decimal-part">,${parts.decimal}</span>` +
            `<span class="cash-text">à vista</span>` +
          `</div>` +
          pixLine +
          `<p class="product-installments">${installmentsLine}</p>` +
        `</div>` +
      `</a>`
    );
  }

  // Não sobrescreve implementações já carregadas pelo marketplace-core.js.
  if (typeof global.createProductCard !== "function") {
    global.createProductCard = createProductCard;
  }
  if (typeof global.getProductImageUrl !== "function") {
    global.getProductImageUrl = getProductImageUrl;
  }
  if (typeof global.toNumberBR !== "function") {
    global.toNumberBR = toNumberBR;
  }
  if (typeof global.formatCurrencyBRL !== "function") {
    global.formatCurrencyBRL = formatCurrencyBRL;
  }
  if (typeof global.formatPricePartsBRL !== "function") {
    global.formatPricePartsBRL = formatPricePartsBRL;
  }
  if (typeof global.normalizeProduct !== "function") {
    global.normalizeProduct = normalizeProduct;
  }

  global.__am_cards_debug = {
    toNumberBR,
    formatCurrencyBRL,
    formatPricePartsBRL,
    getProductImageUrl,
    normalizeProduct,
    computeDiscountPercent,
    computePixPrice,
    computeInstallments
  };
})(window);
