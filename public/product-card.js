(function () {
  "use strict";

  const FALLBACK_IMG = "https://placehold.co/600x400/ffffff/333333?text=Sem+Imagem";
  const OLD_PRICE_KEYS = [
    "oldPrice", "old_price", "oldprice", "precoAntigo", "preco_antigo", "precoDe", "preco_de",
    "originalPrice", "original_price", "priceOriginal", "price_original", "listPrice", "list_price",
    "regularPrice", "regular_price", "precoOriginal", "preco_original", "precoCheio", "preco_cheio",
    "precoCortado", "preco_cortado", "valorAntigo", "valor_antigo", "valorDe", "valor_de",
    "compareAtPrice", "compare_at_price", "de", "priceBefore", "beforePrice"
  ];

  function toNumberBR(value, fallback = 0) {
    try {
      if (value === null || value === undefined) return fallback;
      if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
      let s = String(value).trim();
      if (!s || s === "-" || s.toLowerCase() === "null") return fallback;
      s = s.replace(/[R$\s]/g, "").replace(/[^0-9.,-]/g, "");
      const hasComma = s.includes(",");
      const hasDot = s.includes(".");
      if (hasComma && hasDot) s = s.replace(/\./g, "").replace(",", ".");
      else if (hasComma && !hasDot) s = s.replace(",", ".");
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : fallback;
    } catch (_) { return fallback; }
  }

  window.__toNumberBR = window.__toNumberBR || toNumberBR;

  function formatCurrency(value) {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(toNumberBR(value, 0));
  }

  function escapeHtml(v) {
    return String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function pick(obj, keys) {
    for (const key of keys) {
      const v = obj?.[key];
      if (v !== undefined && v !== null && String(v).trim() !== "") return v;
    }
    return null;
  }

  function getProductId(p) {
    return p?.id || p?._id || p?.productId || p?.produtoId || p?.sku || "";
  }

  function getProductName(p) {
    return p?.name || p?.nome || p?.title || p?.titulo || "Produto";
  }

  function getImageUrl(p) {
    const candidate =
      p?.mainImageUrl || p?.imageUrl || p?.image || p?.imagem || p?.image_url || p?.imagemUrl ||
      (Array.isArray(p?.images) ? (typeof p.images[0] === "string" ? p.images[0] : (p.images[0]?.url || p.images[0]?.imageUrl || p.images[0]?.src || "")) : "") ||
      (Array.isArray(p?.imageUrls) ? p.imageUrls[0] : "") ||
      (Array.isArray(p?.imagePaths) ? p.imagePaths[0] : "");
    if (typeof window.resolveApiImageUrl === "function") return window.resolveApiImageUrl(candidate) || FALLBACK_IMG;
    const raw = String(candidate || "").trim();
    if (!raw || raw.includes("${")) return FALLBACK_IMG;
    if (/^(https?:|data:|blob:)/i.test(raw)) return raw;
    const origin = window.API_ORIGIN || String(window.API_BASE || "https://ariana-backend.onrender.com/api").replace(/\/api\/?$/i, "");
    if (raw.startsWith("/")) return origin + raw;
    return origin + "/" + raw.replace(/^\.?\//, "");
  }

  function getBasePrice(p) {
    return toNumberBR(p?.price ?? p?.preco ?? p?.valor ?? p?.salePrice ?? p?.sale_price ?? p?.precoPrazo ?? p?.preco_prazo ?? 0, 0);
  }

  function getOldPrice(p, basePrice) {
    const raw = pick(p, OLD_PRICE_KEYS);
    const old = toNumberBR(raw, 0);
    return old > basePrice ? old : 0;
  }

  function getPixPercent(p) {
    const direct = toNumberBR(p?.pixDiscountPercent ?? p?.descontoPixPercent ?? p?.pixDiscount ?? p?.descontoPix, NaN);
    if (Number.isFinite(direct) && direct > 0) return Math.min(90, Math.max(0, direct));
    const global = toNumberBR(window.__PAYMENT_SETTINGS?.pix?.discountPercent, NaN);
    if (Number.isFinite(global) && global > 0) return Math.min(90, Math.max(0, global));
    return 17;
  }

  function ensureCardStyles() {
    if (document.getElementById("ariana-card-unificado-v14")) return;
    const style = document.createElement("style");
    style.id = "ariana-card-unificado-v14";
    style.textContent = `
      .product-card,.am-pro-card{background:#fff;border-radius:4px;border:1px solid #e7e7e7;box-shadow:none;transition:transform .25s,box-shadow .25s;overflow:hidden;display:flex;flex-direction:column;cursor:pointer;padding:10px;height:100%;text-decoration:none;color:inherit;position:relative;font-family:Inter,Arial,sans-serif;}
      .product-card:hover,.am-pro-card:hover{transform:translateY(-2px);box-shadow:0 4px 8px rgba(0,0,0,.10);border-color:#2E6DA4;}
      .product-image-container,.am-pro-card__image-container{width:100%;height:180px;position:relative;overflow:hidden;margin-bottom:10px;display:flex;align-items:center;justify-content:center;background:#fff;}
      .product-image-container img,.am-pro-card__image{max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;display:block;}
      .product-card-body,.am-pro-card__body{padding:0;flex-grow:1;display:flex;flex-direction:column;justify-content:flex-start;}
      .product-name,.am-pro-card__title{font-size:.85rem;font-weight:400;color:#444;min-height:3em;max-height:3em;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;margin-bottom:10px;line-height:1.45;}
      .product-old-price,.am-pro-card__old-price{font-size:.80rem;color:#999;text-decoration:line-through;font-weight:400;line-height:1.2;margin-bottom:5px;min-height:15px;}
      .product-price,.am-pro-card__main-price{font-size:1.30rem;font-weight:800;color:#333;margin-top:0;display:flex;align-items:center;gap:6px;line-height:1.08;flex-wrap:wrap;}
      .am-card-discount,.am-pro-card__discount-tag{font-size:.72rem;color:#00a650;font-weight:800;white-space:nowrap;}
      .am-card-pix,.am-pro-card__pix-info{font-size:.75rem;color:#555;font-weight:600;margin-top:5px;line-height:1.25;}
      .product-installments,.am-pro-card__installments{font-size:.78rem;color:#333;margin-top:8px;line-height:1.35;font-weight:500;}
      .am-card-total,.am-pro-card__total-prazo{font-size:.72rem;color:#888;margin-top:4px;line-height:1.25;}
      .product-tag-container,.am-card-tag-container{position:absolute;top:5px;left:5px;z-index:10;display:flex;flex-direction:column;gap:5px;}
      .product-tag,.am-card-tag{color:#fff;background:#ff7a00;font-size:.72rem;font-weight:800;padding:2px 6px;border-radius:2px;display:block;width:fit-content;line-height:1.1;}
    `;
    document.head.appendChild(style);
  }

  window.createProductCard = function createProductCard(product) {
    ensureCardStyles();
    const id = getProductId(product);
    const name = getProductName(product);
    const fullPrice = getBasePrice(product);                 // preço cheio parcelado
    const oldPrice = getOldPrice(product, fullPrice);        // preço antigo riscado, se existir
    const pixPercent = getPixPercent(product);
    const pixPrice = fullPrice > 0 ? +(fullPrice * (1 - pixPercent / 100)).toFixed(2) : 0;
    const installmentCount = 12;
    const installmentValue = fullPrice > 0 ? +(fullPrice / installmentCount).toFixed(2) : 0;
    const imageUrl = getImageUrl(product);
    const href = `produto.html?id=${encodeURIComponent(id)}`;
    const oldHtml = oldPrice > 0
      ? `<div class="product-old-price am-pro-card__old-price">${formatCurrency(oldPrice)}</div>`
      : `<div class="product-old-price am-pro-card__old-price" style="visibility:hidden">${formatCurrency(fullPrice || 0)}</div>`;

    return `
      <a class="product-card am-pro-card" href="${escapeHtml(href)}">
        <div class="product-tag-container am-card-tag-container"><span class="product-tag am-card-tag">-${Math.round(pixPercent)}% OFF</span></div>
        <div class="product-image-container am-pro-card__image-container">
          <img class="am-pro-card__image" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(name)}" loading="lazy">
        </div>
        <div class="product-card-body am-pro-card__body">
          <div class="product-name am-pro-card__title">${escapeHtml(name)}</div>
          ${oldHtml}
          <div class="product-price am-pro-card__main-price">
            <span>${formatCurrency(pixPrice)}</span>
            <span class="am-card-discount am-pro-card__discount-tag">${Math.round(pixPercent)}% OFF</span>
          </div>
          <div class="am-card-pix am-pro-card__pix-info">no PIX à vista</div>
          <div class="product-installments am-pro-card__installments">ou ${installmentCount}x de ${formatCurrency(installmentValue)} s/ juros</div>
          <div class="am-card-total am-pro-card__total-prazo">Total parcelado: ${formatCurrency(fullPrice)}</div>
        </div>
      </a>`;
  };
})();
