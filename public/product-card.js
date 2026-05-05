(function () {
  const CARD_STYLE_ID = "ariana-card-padrao-unico-v10";

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

  function formatCurrency(value) {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(toNumberBR(value, 0));
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function getProductId(p) {
    return p?._id || p?.id || p?.productId || p?.produtoId || p?.sku || "";
  }

  function getProductName(p) {
    return p?.name || p?.nome || p?.title || p?.titulo || "Produto";
  }

  function resolveImage(raw) {
    const value = String(raw || "").trim();
    if (!value || value.includes("${")) return "";
    if (typeof window.resolveApiImageUrl === "function") return window.resolveApiImageUrl(value);
    if (/^(https?:|data:|blob:)/i.test(value)) return value;
    const origin = window.API_ORIGIN || String(window.API_BASE || "https://ariana-backend.onrender.com/api").replace(/\/api\/?$/i, "");
    if (value.startsWith("/")) return origin + value;
    return origin + "/" + value.replace(/^\.?\//, "");
  }

  function getImageUrl(p) {
    const candidates = [
      p?.mainImageUrl,
      p?.imageUrl,
      p?.image,
      p?.imagem,
      p?.image_url,
      p?.imagemUrl,
      Array.isArray(p?.images) ? p.images[0] : null,
      Array.isArray(p?.imageUrls) ? p.imageUrls[0] : null,
      Array.isArray(p?.imagePaths) ? p.imagePaths[0] : null,
    ];

    for (const item of candidates) {
      const raw = typeof item === "string" ? item : (item?.url || item?.imageUrl || item?.src || item?.path || "");
      const img = resolveImage(raw);
      if (img) return img;
    }
    return "https://placehold.co/500x500/ffffff/333333?text=SEM+IMAGEM";
  }

  function pickNumber(p, keys, fallback = 0) {
    for (const k of keys) {
      const v = p?.[k];
      if (v !== undefined && v !== null && String(v).trim?.() !== "") {
        const n = toNumberBR(v, NaN);
        if (Number.isFinite(n)) return n;
      }
    }
    return fallback;
  }

  function getBasePrice(p) {
    return pickNumber(p, ["price", "preco", "valor", "totalPrice", "salePrice", "sale_price"], 0);
  }

  function getOldPrice(p, basePrice) {
    const old = pickNumber(p, [
      "oldPrice",
      "precoAntigo",
      "precoDe",
      "originalPrice",
      "listPrice",
      "old_price",
      "regularPrice",
      "regular_price",
      "precoOriginal",
      "preco_original",
      "precoCheio",
      "preco_cheio",
      "precoCortado",
      "preco_cortado",
      "compareAtPrice",
      "compare_at_price",
      "priceFrom",
      "price_from",
      "valorDe",
      "valor_de",
      "valorAntigo",
      "valor_antigo"
    ], 0);

    if (old > basePrice) return old;

    // Fallback: alguns produtos antigos gravaram o preço cheio/parcelado em campos separados.
    const full = pickNumber(p, [
      "fullPrice",
      "full_price",
      "precoPrazo",
      "preco_prazo",
      "cardPrice",
      "cartaoPrice",
      "precoCartao",
      "totalParcelado",
      "total_parcelado"
    ], 0);

    return full > basePrice ? full : 0;
  }

  function getPixPercent(p) {
    const direct = pickNumber(p, ["pixDiscountPercent", "descontoPixPercent", "discountPercent", "descontoPercentual"], 0);
    if (direct > 0) return clamp(Math.round(direct), 0, 90);
    const settings = window.__PAYMENT_SETTINGS;
    const fromSettings = toNumberBR(settings?.pix?.discountPercent, 0);
    if (settings?.pix?.enabled !== false && fromSettings > 0) return clamp(Math.round(fromSettings), 0, 90);
    return 17;
  }

  function getPixPrice(p, basePrice, pixPercent) {
    const explicit = pickNumber(p, ["pixPrice", "precoPix", "cashPrice", "precoVista", "pricePix"], 0);
    if (explicit > 0 && explicit <= basePrice) return explicit;
    return +(basePrice * (1 - pixPercent / 100)).toFixed(2);
  }

  function ensureCardStyles() {
    if (document.getElementById(CARD_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = CARD_STYLE_ID;
    style.textContent = `
      .am-pro-card, .product-card {
        background:#fff !important;
        border-radius:4px !important;
        border:1px solid #e7e7e7 !important;
        box-shadow:0 1px 5px rgba(0,0,0,.08) !important;
        transition:transform .25s ease, box-shadow .25s ease, border-color .25s ease !important;
        overflow:hidden !important;
        display:flex !important;
        flex-direction:column !important;
        cursor:pointer !important;
        padding:10px !important;
        height:100% !important;
        text-decoration:none !important;
        color:#333 !important;
        position:relative !important;
        font-family:'Inter', Arial, sans-serif !important;
      }
      .am-pro-card:hover, .product-card:hover {
        transform:translateY(-2px) !important;
        box-shadow:0 4px 8px rgba(0,0,0,.10) !important;
        border-color:#d5d5d5 !important;
      }
      .product-image-container, .am-pro-card__image-container {
        width:100% !important;
        height:180px !important;
        position:relative !important;
        overflow:hidden !important;
        margin-bottom:10px !important;
        display:flex !important;
        justify-content:center !important;
        align-items:center !important;
        background:#fff !important;
      }
      .product-image-container img, .am-pro-card__image {
        max-width:100% !important;
        max-height:100% !important;
        width:auto !important;
        height:auto !important;
        object-fit:contain !important;
        transition:none !important;
        transform:none !important;
      }
      .product-card-body, .am-pro-card__price-container {
        padding:0 !important;
        flex-grow:1 !important;
        display:flex !important;
        flex-direction:column !important;
        justify-content:flex-start !important;
      }
      .product-name, .am-pro-card__title {
        font-size:.85rem !important;
        font-weight:400 !important;
        color:#444 !important;
        min-height:3em !important;
        max-height:3em !important;
        overflow:hidden !important;
        text-overflow:ellipsis !important;
        display:-webkit-box !important;
        -webkit-line-clamp:2 !important;
        -webkit-box-orient:vertical !important;
        margin:0 0 10px 0 !important;
        line-height:1.45 !important;
      }
      .product-old-price, .am-pro-card__old-price {
        font-size:.8rem !important;
        color:#999 !important;
        text-decoration:line-through !important;
        font-weight:400 !important;
        line-height:1.2 !important;
        min-height:auto !important;
        margin:0 0 4px 0 !important;
      }
      .product-price-row { display:flex !important; align-items:center !important; gap:6px !important; flex-wrap:wrap !important; }
      .product-price, .am-pro-card__main-price {
        font-size:1.25rem !important;
        font-weight:800 !important;
        color:#333 !important;
        margin-top:2px !important;
        display:flex !important;
        align-items:baseline !important;
        line-height:1.05 !important;
        letter-spacing:-.3px !important;
      }
      .product-discount-inline, .am-pro-card__discount-tag {
        font-size:.72rem !important;
        color:#00a650 !important;
        font-weight:800 !important;
        line-height:1 !important;
        white-space:nowrap !important;
      }
      .product-pix-text, .am-pro-card__pix-info {
        font-size:.75rem !important;
        color:#555 !important;
        font-weight:600 !important;
        margin-top:4px !important;
        margin-bottom:0 !important;
      }
      .product-installments, .am-pro-card__installments {
        font-size:.78rem !important;
        color:#333 !important;
        margin-top:8px !important;
        line-height:1.35 !important;
        font-weight:500 !important;
      }
      .product-total-prazo, .am-pro-card__total-prazo {
        font-size:.72rem !important;
        color:#888 !important;
        margin-top:5px !important;
        line-height:1.25 !important;
        font-weight:400 !important;
      }
      .product-tag-container{position:absolute !important;top:5px !important;left:5px !important;z-index:10 !important;display:flex !important;flex-direction:column !important;gap:5px !important;}
      .product-tag{color:#fff !important;font-size:.72rem !important;font-weight:800 !important;padding:2px 5px !important;border-radius:2px !important;display:block !important;width:fit-content !important;line-height:1 !important;}
      .tag-orange{background:#ff931e !important;}
    `;
    document.head.appendChild(style);
  }

  window.createProductCard = function createProductCard(product) {
    ensureCardStyles();

    const id = getProductId(product);
    const name = getProductName(product);
    const href = `produto.html?id=${encodeURIComponent(id)}`;
    const imageUrl = getImageUrl(product);
    const basePrice = getBasePrice(product);
    const oldPrice = getOldPrice(product, basePrice);
    const pixPercent = getPixPercent(product);
    const pixPrice = basePrice > 0 ? getPixPrice(product, basePrice, pixPercent) : 0;
    const installmentCount = clamp(Math.round(pickNumber(product, ["installmentCount", "installmentsCount", "parcelas", "cardInstallments"], 12) || 12), 1, 24);
    const installmentValue = basePrice > 0 ? +(basePrice / installmentCount).toFixed(2) : 0;
    const showDiscount = pixPercent > 0 && basePrice > 0;

    return `
      <a class="product-card" href="${escapeHtml(href)}">
        ${showDiscount ? `<div class="product-tag-container"><span class="product-tag tag-orange">-${pixPercent}% OFF</span></div>` : ""}
        <div class="product-image-container">
          <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(name)}" loading="lazy" decoding="async">
        </div>
        <div class="product-card-body">
          <div class="product-name">${escapeHtml(name)}</div>
          ${oldPrice > 0 ? `<div class="product-old-price">${formatCurrency(oldPrice)}</div>` : `<div class="product-old-price" style="visibility:hidden">.</div>`}
          <div class="product-price-row">
            <div class="product-price">${formatCurrency(pixPrice || basePrice)}</div>
            ${showDiscount ? `<span class="product-discount-inline">${pixPercent}% OFF</span>` : ""}
          </div>
          <div class="product-pix-text">no PIX à vista</div>
          <div class="product-installments">ou ${installmentCount}x de ${formatCurrency(installmentValue)} s/ juros</div>
          <div class="product-total-prazo">Total parcelado: ${formatCurrency(basePrice)}</div>
        </div>
      </a>
    `;
  };

  window.__ARIANA_PRODUCT_CARD_STANDARD__ = true;
})();
