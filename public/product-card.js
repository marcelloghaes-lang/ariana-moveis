(function () {
  const formatCurrency = (v) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(Number(v || 0));

  const toNumber = (value, fallback = 0) => {
    try {
      if (value === null || value === undefined) return fallback;
      if (typeof value === "number") return Number.isFinite(value) ? value : fallback;

      let s = String(value).trim();
      if (!s) return fallback;

      s = s.replace(/[R$\s]/g, "").replace(/[^0-9.,-]/g, "");

      const hasComma = s.includes(",");
      const hasDot = s.includes(".");

      if (hasComma && hasDot) {
        s = s.replace(/\./g, "").replace(",", ".");
      } else if (hasComma && !hasDot) {
        s = s.replace(",", ".");
      }

      const n = parseFloat(s);
      return Number.isFinite(n) ? n : fallback;
    } catch (_) {
      return fallback;
    }
  };

  const escapeHtml = (v) =>
    String(v || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  function ensureCardStyles() {
    if (document.getElementById("ariana-pro-market-styles")) return;

    const style = document.createElement("style");
    style.id = "ariana-pro-market-styles";
    style.textContent = `
      .am-pro-card {
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        background: #fff;
        border-radius: 12px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.08);
        transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
        display: flex;
        flex-direction: column;
        padding: 16px;
        cursor: pointer;
        border: 1px solid #f0f0f0;
        position: relative;
        height: 100%;
        text-decoration: none;
      }

      .am-pro-card:hover {
        box-shadow: 0 12px 24px rgba(0,0,0,0.12);
        border-color: #0056b3;
        transform: translateY(-4px);
      }

      .am-pro-card__image-container {
        width: 100%;
        height: 200px;
        margin-bottom: 16px;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .am-pro-card__image {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
        transition: transform 0.5s ease;
      }

      .am-pro-card:hover .am-pro-card__image {
        transform: scale(1.08);
      }

      .am-pro-card__title {
        font-size: 14px;
        color: #333;
        font-weight: 500;
        line-height: 1.4;
        margin-bottom: 12px;
        min-height: 40px;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .am-pro-card__price-container {
        display: flex;
        flex-direction: column;
        gap: 1px;
        margin-top: auto;
      }

      .am-pro-card__old-price {
        font-size: 12px;
        color: #999;
        text-decoration: line-through;
        margin-bottom: 2px;
        min-height: 18px;
      }

      .am-pro-card__main-price {
        font-size: 26px;
        font-weight: 700;
        color: #333;
        display: flex;
        align-items: center;
        gap: 8px;
        letter-spacing: -0.5px;
        flex-wrap: wrap;
      }

      .am-pro-card__discount-tag {
        font-size: 13px;
        color: #00a650;
        font-weight: 600;
      }

      .am-pro-card__pix-info {
        font-size: 12px;
        color: #666;
        font-weight: 600;
        margin-bottom: 6px;
      }

      .am-pro-card__installments {
        font-size: 14px;
        color: #333;
        font-weight: 500;
      }

      .am-pro-card__total-prazo {
        font-size: 11px;
        color: #888;
        margin-top: 2px;
      }

      .am-pro-card__shipping {
        font-size: 12px;
        color: #00a650;
        font-weight: 700;
        margin-top: 12px;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: #e6f7ee;
        width: fit-content;
        padding: 2px 8px;
        border-radius: 4px;
      }
    `;
    document.head.appendChild(style);
  }

  function getImageUrl(product) {
    const candidate =
      product?.imageUrl ||
      product?.mainImageUrl ||
      product?.image ||
      product?.imagem ||
      product?.image_url ||
      product?.imagemUrl ||
      (Array.isArray(product?.images)
        ? (typeof product.images[0] === "string"
            ? product.images[0]
            : (product.images[0]?.url || product.images[0]?.imageUrl || ""))
        : "") ||
      (Array.isArray(product?.imageUrls) ? product.imageUrls[0] : "") ||
      (Array.isArray(product?.imagePaths) ? product.imagePaths[0] : "");

    if (typeof window.resolveApiImageUrl === "function") {
      return window.resolveApiImageUrl(candidate);
    }

    return String(candidate || "").trim();
  }

  function getProductId(product) {
    return product?.id || product?._id || product?.productId || "";
  }

  function getProductName(product) {
    return product?.name || product?.nome || product?.title || product?.titulo || "Produto";
  }

  window.createProductCard = function (product) {
    ensureCardStyles();

    const id = getProductId(product);
    const name = getProductName(product);
    const imageUrl =
      getImageUrl(product) ||
      `https://placehold.co/600x400/ffffff/333333?text=${encodeURIComponent(name)}`;

    const fullPrice = toNumber(
      product?.price ??
      product?.preco ??
      product?.valor ??
      product?.salePrice ??
      product?.sale_price,
      0
    );

    const pixPrice = fullPrice > 0 ? +(fullPrice * 0.83).toFixed(2) : 0;
    const installmentValue = fullPrice > 0 ? +(fullPrice / 12).toFixed(2) : 0;
    const oldPrice = fullPrice > 0 ? +(fullPrice * 1.15).toFixed(2) : 0;

    const shippingText =
      product?.shippingText ||
      product?.shippingLabel ||
      product?.freteLabel ||
      product?.freteTexto ||
      product?.shipping ||
      product?.frete ||
      "";

    const shippingHtml = shippingText
      ? `<div class="am-pro-card__shipping">${escapeHtml(shippingText)}</div>`
      : "";

    const href = `produto.html?id=${encodeURIComponent(id)}`;

    return `
      <a class="am-pro-card" href="${href}">
        <div class="am-pro-card__image-container">
          <img class="am-pro-card__image" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(name)}" loading="lazy">
        </div>
        <div class="am-pro-card__title">${escapeHtml(name)}</div>
        <div class="am-pro-card__price-container">
          <span class="am-pro-card__old-price">${oldPrice > 0 ? formatCurrency(oldPrice) : "&nbsp;"}</span>
          <div class="am-pro-card__main-price">
            ${formatCurrency(pixPrice)}
            <span class="am-pro-card__discount-tag">17% OFF</span>
          </div>
          <div class="am-pro-card__pix-info">no PIX à vista</div>
          <div class="am-pro-card__installments">
            ou 12x de ${formatCurrency(installmentValue)} s/ juros
          </div>
          <div class="am-pro-card__total-prazo">
            Total parcelado: ${formatCurrency(fullPrice)}
          </div>
          ${shippingHtml}
        </div>
      </a>
    `;
  };
})();