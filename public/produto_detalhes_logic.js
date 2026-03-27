// NOVO PADRÃO - SEM FIREBASE

let allImages = [];
let productData = null;

const API_BASE = localStorage.getItem("API_BASE") || window.API_BASE || "https://ariana-move-mongo.onrender.com/api";

// fallback imagem
const getSafeImage = (img) => {
  if (!img) return "/images/sem-imagem.png";
  if (typeof img === "string") return img;
  return img.url || img.imageUrl || "/images/sem-imagem.png";
};

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

    const product = await res.json();

    productData = product;

    // ===== DADOS =====
    document.getElementById("product-name").textContent =
      product.name || "";

    document.getElementById("product-price-full").textContent =
      formatCurrency(product.price || 0);

    document.getElementById("product-description").innerHTML =
      product.description || "";

    // ===== IMAGENS =====
    let images = product.images || [];

    if (!Array.isArray(images)) {
      images = Object.values(images);
    }

    allImages = images.map(getSafeImage);

    renderGallery(allImages);

    document.getElementById("loading-message").style.display = "none";
    document.getElementById("product-details-container").style.display =
      "grid";
  } catch (error) {
    console.error("Erro ao carregar produto:", error);
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
      img.className = `thumbnail-image ${
        idx === 0 ? "active" : ""
      }`;

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
  }).format(Number(v || 0));
}

// ==============================
// BOTÃO COMPRAR (OPCIONAL)
// ==============================
window.addToCart = function () {
  if (!productData) return;

  let cart = JSON.parse(localStorage.getItem("cart") || "[]");

  cart.push({
    id: productData._id || productData.id,
    name: productData.name,
    price: productData.price,
    image: getSafeImage(productData.images?.[0]),
    qty: 1,
  });

  localStorage.setItem("cart", JSON.stringify(cart));

  alert("Produto adicionado ao carrinho!");
};

// ==============================
// INIT
// ==============================
document.addEventListener("DOMContentLoaded", loadProductDetails);