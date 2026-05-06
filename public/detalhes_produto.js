// NOVO PADRÃO - SEM FIREBASE

let allImages = [];
let productData = null;

const API_BASE =
  window.API_BASE ||
  localStorage.getItem("API_BASE") ||
  "https://ariana-backend.onrender.com/api";

const API_ORIGIN =
  window.API_ORIGIN ||
  String(API_BASE).replace(/\/api\/?$/i, "");

// fallback imagem
const getSafeImage = (img) => {
  const raw =
    typeof img === "string"
      ? img
      : (img?.url || img?.imageUrl || img?.path || img?.src || "");

  if (!raw) return "/images/sem-imagem.png";

  if (typeof window.resolveApiImageUrl === "function") {
    return window.resolveApiImageUrl(raw);
  }

  if (/^https?:\/\//i.test(raw) || /^data:/i.test(raw) || /^blob:/i.test(raw)) {
    return raw;
  }

  if (raw.startsWith("/")) return API_ORIGIN + raw;
  return API_ORIGIN + "/" + raw.replace(/^\.?\//, "");
};

function toNumber(value, fallback = 0) {
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
}

function extractImages(product) {
  const images = [];

  const pushImage = (value) => {
    if (!value) return;
    const resolved = getSafeImage(value);
    if (!resolved) return;
    if (!images.includes(resolved)) images.push(resolved);
  };

  pushImage(product?.mainImageUrl);
  pushImage(product?.imageUrl);
  pushImage(product?.image);
  pushImage(product?.imagem);

  if (Array.isArray(product?.images)) {
    product.images.forEach(pushImage);
  } else if (product?.images && typeof product.images === "object") {
    Object.values(product.images).forEach(pushImage);
  }

  if (Array.isArray(product?.imageUrls)) {
    product.imageUrls.forEach(pushImage);
  }

  if (Array.isArray(product?.imagePaths)) {
    product.imagePaths.forEach(pushImage);
  }

  if (!images.length) {
    images.push("/images/sem-imagem.png");
  }

  return images;
}

// ==============================
// CARREGAR PRODUTO
// ==============================
async function loadProductDetails() {
  const urlParams = new URLSearchParams(window.location.search);
  const productId = urlParams.get("id");

  if (!productId) return;

  try {
    const res = await fetch(`${API_BASE}/products/${encodeURIComponent(productId)}`);

    if (!res.ok) throw new Error("Erro ao buscar produto");

    const payload = await res.json();
    const product = payload?.item || payload?.product || payload?.data || payload || {};

    productData = product;

    const productNameEl = document.getElementById("product-name");
    const productPriceEl = document.getElementById("product-price-full");
    const productDescriptionEl = document.getElementById("product-description");
    const loadingMessageEl = document.getElementById("loading-message");
    const detailsContainerEl = document.getElementById("product-details-container");

    if (productNameEl) {
      productNameEl.textContent = product.name || product.nome || product.title || "";
    }

    if (productPriceEl) {
      productPriceEl.textContent = formatCurrency(
        product.price ?? product.preco ?? product.valor ?? 0
      );
    }

    if (productDescriptionEl) {
      productDescriptionEl.innerHTML =
        product.description || product.descricao || "";
    }

    allImages = extractImages(product);
    renderGallery(allImages);

    if (loadingMessageEl) loadingMessageEl.style.display = "none";
    if (detailsContainerEl) detailsContainerEl.style.display = "grid";
  } catch (error) {
    console.error("Erro ao carregar produto:", error);

    const loadingMessageEl = document.getElementById("loading-message");
    if (loadingMessageEl) {
      loadingMessageEl.innerHTML =
        '<p style="color:#dc2626;font-weight:700;">Erro ao carregar produto.</p>';
    }
  }
}

// ==============================
// GALERIA
// ==============================
function renderGallery(images) {
  const mainImg = document.getElementById("main-product-image");
  const thumbContainer = document.getElementById("thumbnail-gallery");

  if (images.length > 0 && mainImg) {
    mainImg.src = images[0];
  }

  if (thumbContainer) {
    thumbContainer.innerHTML = "";

    images.forEach((url, idx) => {
      const img = document.createElement("img");
      img.src = url;
      img.className = `thumbnail-image ${idx === 0 ? "active" : ""}`;
      img.alt = `Imagem ${idx + 1} do produto`;

      img.onclick = () => {
        if (mainImg) mainImg.src = url;

        document
          .querySelectorAll(".thumbnail-image")
          .forEach((t) => t.classList.remove("active"));

        img.classList.add("active");
      };

      thumbContainer.appendChild(img);
    });
  }
}

// ==============================
// FORMATAR PREÇO
// ==============================
function formatCurrency(v) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(toNumber(v, 0));
}

// ==============================
// BOTÃO COMPRAR
// ==============================
window.addToCart = function () {
  if (!productData) return;

  let cart = [];
  try {
    cart = JSON.parse(
      localStorage.getItem("arianaMoveisCart") ||
      localStorage.getItem("cart") ||
      "[]"
    );
  } catch (_) {
    cart = [];
  }

  const productId = productData._id || productData.id;
  const existingIndex = cart.findIndex(
    (item) => String(item.id || item.productId || item._id) === String(productId)
  );

  const cartItem = {
    id: productId,
    productId: productId,
    _id: productId,
    name: productData.name || productData.nome || productData.title || "Produto",
    price: toNumber(productData.price ?? productData.preco ?? productData.valor, 0),
    image: allImages[0] || getSafeImage(productData.mainImageUrl || productData.imageUrl),
    imageUrl: allImages[0] || getSafeImage(productData.mainImageUrl || productData.imageUrl),
    quantity: 1,
    qty: 1,
    sellerId:
      productData.sellerId ||
      productData.sellerUid ||
      productData.seller_id ||
      productData.vendorId ||
      ""
  };

  if (existingIndex >= 0) {
    const currentQty = Number(
      cart[existingIndex].quantity || cart[existingIndex].qty || 1
    );
    cart[existingIndex].quantity = currentQty + 1;
    cart[existingIndex].qty = currentQty + 1;
  } else {
    cart.push(cartItem);
  }

  localStorage.setItem("arianaMoveisCart", JSON.stringify(cart));
  localStorage.setItem("cart", JSON.stringify(cart));

  alert("Produto adicionado ao carrinho!");
};

// ==============================
// INIT
// ==============================
document.addEventListener("DOMContentLoaded", loadProductDetails);


// ===== FIX V13: ordem do preço no detalhe do produto =====
(function(){
  function enforceProductPriceOrder(){
    const oldEl = document.getElementById('product-old-price');
    const priceEl = document.getElementById('product-price-full');
    const pixEl = document.getElementById('product-price-cash');
    const instEl = document.getElementById('product-price-installments');
    const box = priceEl && priceEl.parentElement;
    if (!box) return;
    box.style.display = 'flex';
    box.style.flexDirection = 'column';
    box.style.gap = '8px';
    [oldEl, priceEl, pixEl, instEl].forEach(el => { if (el) box.appendChild(el); });
    if (oldEl) oldEl.style.order = '1';
    if (priceEl) priceEl.style.order = '2';
    if (pixEl) pixEl.style.order = '3';
    if (instEl) instEl.style.order = '4';
  }
  window.enforceProductPriceOrder = enforceProductPriceOrder;
  document.addEventListener('DOMContentLoaded', function(){
    enforceProductPriceOrder();
    setTimeout(enforceProductPriceOrder, 400);
    setTimeout(enforceProductPriceOrder, 1200);
  });
})();


// FIX V14: preço de detalhe no padrão correto
(function(){
  function toNum(v, fallback = 0){
    if (window.__toNumberBR) return window.__toNumberBR(v, fallback);
    const n = Number(v); return Number.isFinite(n) ? n : fallback;
  }
  function fmt(v){ return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(toNum(v,0)); }
  function enforceProductPriceOrderV14(){
    const oldEl = document.getElementById('product-old-price');
    const priceEl = document.getElementById('product-price-full');
    const pixEl = document.getElementById('product-price-cash');
    const instEl = document.getElementById('product-price-installments');
    if (!priceEl) return;
    const box = priceEl.parentElement;
    if (!box) return;
    box.style.setProperty('display','flex','important');
    box.style.setProperty('flex-direction','column','important');
    box.style.setProperty('gap','8px','important');
    [[oldEl,1],[priceEl,2],[pixEl,3],[instEl,4]].forEach(([el,n])=>{ if(el){ box.appendChild(el); el.style.setProperty('order',String(n),'important'); } });
  }
  window.enforceProductPriceOrder = enforceProductPriceOrderV14;
  document.addEventListener('DOMContentLoaded', function(){
    enforceProductPriceOrderV14();
    setTimeout(enforceProductPriceOrderV14, 300);
    setTimeout(enforceProductPriceOrderV14, 1200);
  });
})();
