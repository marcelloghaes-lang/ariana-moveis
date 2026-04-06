(function () {
  const toNumber = (v) => {
    const n = parseFloat(String(v || "").replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  };

  const formatCurrency = (v) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(v || 0);

  const escapeHtml = (v) => String(v || "").replace(/"/g, "&quot;");

 window.createProductCard = function (p) {
    // 1. Definição de Preços (Garante que sejam números)
    const price = Number(p.price || p.preco || 0);
    const oldPrice = Number(p.oldPrice || p.precoDe || 0);
    
    // 2. Cálculo do PIX (17% fixo sobre o preço de venda)
    const pixDiscount = 0.17; 
    const pixPrice = price * (1 - pixDiscount);

    // 3. Cálculo de Parcelas (Sobre o preço cheio)
    const installmentsCount = 12;
    const installmentsValue = price / installmentsCount;

    const format = (v) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
    const name = p.name || p.nome || "Produto Ariana Móveis";
    const imageUrl = p.imageUrl || p.mainImageUrl || p.image || "img/placeholder.jpg";

    // Badge de Desconto (Só aparece se o preço antigo for maior)
    let badgeHtml = "";
    if (oldPrice > price) {
      const offPercent = Math.round(((oldPrice - price) / oldPrice) * 100);
      badgeHtml = `<div style="position: absolute; top: 10px; left: 10px; background: #cc0000; color: white; font-size: 10px; font-weight: bold; padding: 4px 8px; border-radius: 20px; z-index: 10;">-${offPercent}% OFF</div>`;
    }

    return `
      <div class="product-card" style="position: relative; cursor: pointer;" onclick="window.location.href='produto.html?id=${p._id || p.id}'">
        ${badgeHtml}
        <div class="product-image-container">
          <img src="${imageUrl}" alt="${name.replace(/"/g, '&quot;')}" onerror="this.src='img/placeholder.jpg'">
        </div>
        <div class="product-card-body">
          <h3 class="product-name" style="font-size: 14px; margin-bottom: 10px; height: 40px; overflow: hidden;">${name}</h3>
          <div class="price-container">
            ${oldPrice > price ? `<span style="text-decoration: line-through; color: #9ca3af; font-size: 12px; display: block;">${format(oldPrice)}</span>` : ""}
            <div style="margin-top: 2px;">
              <span style="font-size: 20px; font-weight: 800; color: #1e3a8a;">${format(price)}</span>
            </div>
            <p style="color: #059669; font-weight: bold; font-size: 12px; margin-top: 5px;">
              <i class="fas fa-bolt"></i> ${format(pixPrice)} à vista no PIX <span style="background: #d1fae5; padding: 0 4px; border-radius: 4px;">(17% OFF)</span>
            </p>
            <p style="color: #4b5563; font-size: 11px; margin-top: 3px;">
              ou ${installmentsCount}x de <strong>${format(installmentsValue)}</strong> sem juros
            </p>
          </div>
        </div>
      </div>
    `;
};

// ESSA LINHA É O SEGREDO: Faz com que quem procurar a função antiga, use a nova!
window.createProductCardHTML = window.createProductCard;
})();