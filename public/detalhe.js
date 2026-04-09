// Arquivo: detalhes.js (corrigido para API Mongo/Render)

const API_BASE =
  window.API_BASE ||
  localStorage.getItem("API_BASE") ||
  "https://ariana-backend.onrender.com/api";

const API_ORIGIN =
  window.API_ORIGIN ||
  String(API_BASE).replace(/\/api\/?$/i, "");

function resolveApiImageUrl(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.includes("${")) return "";
  if (/^https?:\/\//i.test(raw) || /^data:/i.test(raw) || /^blob:/i.test(raw)) return raw;
  if (raw.startsWith("/")) return API_ORIGIN + raw;
  return API_ORIGIN + "/" + raw.replace(/^\.?\//, "");
}

function normalizeImages(data) {
  let imagens = [];

  if (Array.isArray(data?.images)) {
    imagens = data.images.map((img) => {
      if (typeof img === "string") return resolveApiImageUrl(img);
      return resolveApiImageUrl(img?.url || img?.imageUrl || img?.path || "");
    }).filter(Boolean);
  } else if (Array.isArray(data?.imagens)) {
    imagens = data.imagens.map((img) => resolveApiImageUrl(img)).filter(Boolean);
  } else if (data?.mainImageUrl) {
    imagens = [resolveApiImageUrl(data.mainImageUrl)];
  } else if (data?.imageUrl) {
    imagens = [resolveApiImageUrl(data.imageUrl)];
  } else if (data?.imagem) {
    imagens = [resolveApiImageUrl(data.imagem)];
  } else if (data?.image) {
    imagens = [resolveApiImageUrl(data.image)];
  }

  return imagens.filter(Boolean);
}

async function loadProductDetails() {
  const urlParams = new URLSearchParams(window.location.search);
  const productId = urlParams.get("id");

  if (!productId) return;

  try {
    const response = await fetch(`${API_BASE}/products/${encodeURIComponent(productId)}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" }
    });

    const text = await response.text();
    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = null;
    }

    if (!response.ok) {
      throw new Error(
        (data && (data.message || data.error)) ||
        `Erro HTTP ${response.status}`
      );
    }

    const product = data?.product || data?.item || data?.data || data || {};

    const nameEl = document.getElementById("product-name");
    const skuEl = document.getElementById("product-sku");
    const priceEl = document.getElementById("product-price-full");
    const descEl = document.getElementById("product-description");
    const mainImg = document.getElementById("main-product-image");
    const thumbGallery = document.getElementById("thumbnail-gallery");

    if (nameEl) {
      nameEl.textContent = product.name || product.nome || "Produto";
    }

    if (skuEl) {
      skuEl.textContent = `SKU: ${product.sku || product.id || product._id || productId}`;
    }

    if (priceEl) {
      const preco = Number(product.price ?? product.preco ?? 0) || 0;
      priceEl.textContent = new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL"
      }).format(preco);
    }

    const imagens = normalizeImages(product);

    if (mainImg && imagens.length > 0) {
      mainImg.src = imagens[0];
    }

    if (thumbGallery) {
      thumbGallery.innerHTML = "";

      imagens.forEach((url, index) => {
        const img = document.createElement("img");
        img.src = url;
        img.className = `thumbnail-image ${index === 0 ? "active" : ""}`;
        img.onclick = () => {
          if (mainImg) mainImg.src = url;
          document.querySelectorAll(".thumbnail-image").forEach((t) => t.classList.remove("active"));
          img.classList.add("active");
        };
        thumbGallery.appendChild(img);
      });
    }

    if (descEl) {
      descEl.innerHTML = product.description || product.descricao || "Sem descrição.";
    }
  } catch (error) {
    console.error("Erro detalhes:", error);
  }
}

document.addEventListener("DOMContentLoaded", loadProductDetails);
