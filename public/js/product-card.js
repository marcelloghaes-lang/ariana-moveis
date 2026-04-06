window.API_BASE =
  (location.hostname === "127.0.0.1" || location.hostname === "localhost")
    ? "http://localhost:3000/api"
    : "https://ariana-move-mongo.onrender.com/api";
window.API_ORIGIN = String(window.API_BASE).replace(/\/api\/?$/i, "");
try {
  localStorage.setItem("API_BASE", window.API_BASE);
  localStorage.setItem("API_BASE_URL", window.API_BASE);
} catch(_e) {}

(function () {
  const FALLBACK_IMAGE = "img/placeholder.jpg";

  function toNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const normalized = value.replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
      const n = Number(normalized);
      if (Number.isFinite(n)) return n;
    }
    return 0;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getId(p) {
    return String((p && (p._id || p.id)) || "").trim();
  }

  function getImageUrl(p) {
    const candidates = [
      p && p.imageUrl,
      p && p.mainImageUrl,
      p && p.image,
      p && p.imagem,
    ];

    if (p && Array.isArray(p.images)) {
      for (const item of p.images) {
        if (typeof item === "string" && item.trim()) candidates.push(item.trim());
        if (item && item.url) candidates.push(item.url);
      }
    }

    for (const candidate of candidates) {
      const value = String(candidate || "").trim();
      if (!value || value.includes("${")) continue;
      return value;
    }
    return FALLBACK_IMAGE;
  }

  function getName(p) {
    return String((p && (p.name || p.nome)) || "Produto").trim();
  }

  function getPrice(p) {
    return toNumber(p && (p.price ?? p.preco ?? 0));
  }

  window.createProductCard = function (p) {
    const id = getId(p);
    const imageUrl = getImageUrl(p);
    const price = getPrice(p);
    const montagem = price * 0.12;
    const name = getName(p);

    return `
      <div class="product-card" onclick="window.location.href='produto.html?id=${encodeURIComponent(id)}'">
        <div class="product-image-container">
          <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(name)}" onerror="this.onerror=null;this.src='${FALLBACK_IMAGE}'">
        </div>
        <div class="product-card-body">
          <h3 class="product-name">${escapeHtml(name)}</h3>
          <p class="product-price">R$ ${price.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          <p class="tax-info">Montagem: R$ ${montagem.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          <button type="button" class="btn-buy">Ver Detalhes</button>
        </div>
      </div>
    `;
  };
})();
