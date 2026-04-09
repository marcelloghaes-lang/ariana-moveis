(function () {
  const formatCurrency = (v) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(Number(v || 0));

  const escapeHtml = (v) => String(v || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  function ensureCardStyles() {
    if (document.getElementById("ariana-pro-market-styles")) return;

    const style = document.createElement("style");
    style.id = "ariana-pro-market-styles";
    style.textContent = `
      .am-pro-card {
        font-family: 'Inter', -apple-system, sans-serif;
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
      }

      .am-pro-card:hover {
        box-shadow: 0 12px 24px rgba(0,0,0,0.12);
        border-color: #0056b3; /* Azul Ariana */
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
        height: 40px;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .am-pro-card__price-container {
        display: flex;
        flex-direction: column;
        gap: 1px;
      }

      .am-pro-card__old-price {
        font-size: 12px;
        color: #999;
        text-decoration: line-through;
        margin-bottom: 2px;
      }

      .am-pro-card__main-price {
        font-size: 26px;
        font-weight: 700;
        color: #333;
        display: flex;
        align-items: center;
        gap: 8px;
        letter-spacing: -0.5px;
      }

      .am-pro-card__discount-tag {
        font-size: 13px;
        color: #00a650; /* Verde de Conversão */
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
        display: flex;
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

  window.createProductCard = function (p) {
    ensureCardStyles();
    
    // Pegando o preço cheio do produto
    const fullPrice = Number(p?.price || p?.preco || 0);
    
    // Calculando o Pix com 17% de desconto
    const pixPrice = fullPrice * 0.83; 
    
    // Parcelamento em 12x
    const installmentValue = fullPrice / 12;

    return `
      <div class="am-pro-card" onclick="location.href='produto.html?id=${escapeHtml(p.id)}'">
        <div class="am-pro-card__image-container">
          <img class="am-pro-card__image" src="${escapeHtml(p.imageUrl)}" alt="${escapeHtml(p.name)}">
        </div>
        <div class="am-pro-card__title">${escapeHtml(p.name)}</div>
        <div class="am-pro-card__price-container">
          <span class="am-pro-card__old-price">${formatCurrency(fullPrice * 1.15)}</span>
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
        </div>
        <div class="am-pro-card__shipping"></div>
      </div>
    `;
  };
})();