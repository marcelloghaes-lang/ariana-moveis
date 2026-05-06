/**
 * detalhes_produto.js
 * Ariana Móveis - detalhe do produto sem Firebase.
 * Corrige preço antigo, PIX, parcelamento e ordem visual.
 */

const API_BASE = window.API_BASE || localStorage.getItem("API_BASE") || "https://ariana-backend.onrender.com/api";
const API_ORIGIN = window.API_ORIGIN || String(API_BASE).replace(/\/api\/?$/i, "");

let currentProduct = null;
let currentImageIndex = 0;
let productImages = [];
let isFavorite = false;

function toNumber(value, fallback = 0) {
  try {
    if (value === null || value === undefined) return fallback;
    if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
    let s = String(value).trim();
    if (!s || s === "-" || s.toLowerCase() === "null" || s.toLowerCase() === "undefined") return fallback;
    s = s.replace(/[R$\s]/g, "").replace(/[^0-9.,-]/g, "");
    if (!s || s === "-") return fallback;
    const hasComma = s.includes(",");
    const hasDot = s.includes(".");
    if (hasComma && hasDot) s = s.replace(/\./g, "").replace(",", ".");
    else if (hasComma && !hasDot) s = s.replace(",", ".");
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : fallback;
  } catch (_) { return fallback; }
}
window.__toNumberBR = window.__toNumberBR || toNumber;

function formatCurrency(v) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(toNumber(v, 0));
}

function safeArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function resolveImage(img) {
  const raw = typeof img === "string" ? img : (img?.url || img?.imageUrl || img?.downloadURL || img?.src || img?.path || "");
  if (!raw) return "https://placehold.co/600x400?text=Sem+Imagem";
  if (typeof window.resolveApiImageUrl === "function") return window.resolveApiImageUrl(raw);
  if (/^(https?:|data:|blob:)/i.test(raw)) return raw;
  if (raw.startsWith("/")) return API_ORIGIN + raw;
  return API_ORIGIN + "/" + raw.replace(/^\.?\//, "");
}

function getImages(product) {
  const images = [];
  const push = (v) => {
    if (!v) return;
    const url = resolveImage(v);
    if (url && !images.includes(url)) images.push(url);
  };
  push(product.mainImageUrl); push(product.imageUrl); push(product.image); push(product.imagem);
  safeArray(product.images || product.imagens || product.gallery || product.galeria).forEach(push);
  safeArray(product.imageUrls).forEach(push);
  safeArray(product.imagePaths).forEach(push);
  if (!images.length) images.push("https://placehold.co/600x400?text=Sem+Imagem");
  return images;
}

function pick(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "" && String(v).trim() !== "-") return v;
  }
  return null;
}

function computePricing(product) {
  const pixPercentRaw = toNumber(product.pixDiscountPercent ?? product.descontoPixPercent ?? product.pixDiscount ?? product.descontoPix ?? window.__PAYMENT_SETTINGS?.pix?.discountPercent, NaN);
  const pixPercent = Number.isFinite(pixPercentRaw) && pixPercentRaw > 0 ? Math.min(90, Math.max(0, pixPercentRaw)) : 17;
  const fullPrice = toNumber(product.price ?? product.preco ?? product.valor ?? product.precoPrazo ?? product.preco_prazo, 0);
  const explicitPix = toNumber(product.pixPrice ?? product.precoPix ?? product.pix_price ?? product.cashPrice ?? product.preco_avista ?? product.precoVista, NaN);
  const pixPrice = Number.isFinite(explicitPix) && explicitPix > 0 ? explicitPix : +(fullPrice * (1 - pixPercent / 100)).toFixed(2);
  const oldRaw = pick(product, ["oldPrice","old_price","precoAntigo","preco_antigo","precoDe","preco_de","originalPrice","original_price","priceOriginal","price_original","listPrice","list_price","regularPrice","regular_price","precoOriginal","preco_original","precoCheio","preco_cheio","precoCortado","preco_cortado","valorAntigo","valor_antigo","valorDe","valor_de","compareAtPrice","compare_at_price","priceBefore","beforePrice","de"]);
  const oldPriceCandidate = toNumber(oldRaw, 0);
  const oldPrice = oldPriceCandidate > pixPrice ? oldPriceCandidate : 0;
  const installments = 12;
  const installmentValue = fullPrice > 0 ? +(fullPrice / installments).toFixed(2) : 0;
  return { fullPrice, pixPrice, oldPrice, pixPercent, installments, installmentValue };
}

async function fetchProductData(id) {
  const response = await fetch(`${String(API_BASE).replace(/\/+$/, "")}/products/${encodeURIComponent(id)}`, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!response.ok) throw new Error(`Produto não encontrado (${response.status})`);
  const data = await response.json();
  return data?.item || data?.product || data?.data || data;
}

function renderImageGallery(urls) {
  productImages = Array.isArray(urls) ? urls : [];
  const mainImage = document.getElementById("main-product-image");
  const gallery = document.getElementById("thumbnail-gallery");
  if (mainImage && productImages[0]) mainImage.src = productImages[0];
  if (!gallery) return;
  gallery.innerHTML = "";
  productImages.forEach((url, index) => {
    const img = document.createElement("img");
    img.src = url;
    img.alt = `Miniatura ${index + 1}`;
    img.className = `thumbnail-image bg-white shadow-sm border border-gray-200 ${index === 0 ? "active" : ""}`;
    img.onclick = () => window.selectImage(index);
    gallery.appendChild(img);
  });
}

window.selectImage = function(index) {
  if (index < 0 || index >= productImages.length) return;
  currentImageIndex = index;
  const mainImage = document.getElementById("main-product-image");
  if (mainImage) mainImage.src = productImages[index];
  document.querySelectorAll(".thumbnail-image").forEach((img, i) => img.classList.toggle("active", i === index));
};

function setText(ids, value) {
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = value; });
}
function setHTML(ids, value) {
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = value; });
}

function displayProduct(product) {
  currentProduct = product;
  const pricing = computePricing(product);
  const name = product.name || product.nome || product.title || "Produto";
  const sku = product.sku || product.codigo || product.id || product._id || "";
  document.title = `${name} | ARIANA MÓVEIS`;

  setText(["product-name", "product-name-display", "breadcrumb-product-name"], name);
  setText(["product-sku", "product-id-display"], sku ? `SKU: ${sku}` : "");

  const oldEl = document.getElementById("product-old-price");
  if (oldEl) {
    if (pricing.oldPrice > pricing.pixPrice) {
      oldEl.textContent = formatCurrency(pricing.oldPrice);
      oldEl.style.display = "block";
      oldEl.style.color = "#999";
      oldEl.style.textDecoration = "line-through";
    } else oldEl.style.display = "none";
  }

  setHTML(["product-price-full", "product-price-display"], `
    <span class="text-2xl font-normal mr-1">R$</span>
    ${formatCurrency(pricing.pixPrice).replace("R$", "").trim()}
    <span class="text-green-500 text-lg ml-2 font-semibold">${Math.round(pricing.pixPercent)}% OFF</span>
  `);

  setHTML(["product-price-cash"], `<i class="fas fa-bolt mr-1"></i> ${formatCurrency(pricing.pixPrice)} no PIX à vista`);
  setHTML(["product-price-installments", "product-installments-display"], `ou ${pricing.installments}x de ${formatCurrency(pricing.installmentValue)} s/ juros no cartão<br><span class="text-xs text-gray-500 font-medium">Total parcelado: ${formatCurrency(pricing.fullPrice)}</span>`);

  const desc = product.description || product.descricao || "";
  setHTML(["product-description", "product-description-content"], String(desc).replace(/\n/g, "<br>"));

  const detailsList = document.getElementById("product-details-list");
  if (detailsList) {
    detailsList.innerHTML = "";
    safeArray(product.details || product.detalhes || product.fichaTecnica || product.ficha_tecnica).forEach(detail => {
      const li = document.createElement("li");
      li.textContent = typeof detail === "string" ? detail : String(detail || "");
      detailsList.appendChild(li);
    });
  }

  renderImageGallery(getImages(product));
  const loading = document.getElementById("loading-message");
  const details = document.getElementById("product-details-container") || document.getElementById("product-content-grid");
  if (loading) loading.style.display = "none";
  if (details) details.style.display = details.id === "product-details-container" ? "grid" : "grid";
}

async function initProductPage() {
  const productId = new URLSearchParams(window.location.search).get("id");
  const loading = document.getElementById("loading-message");
  if (!productId) { if (loading) loading.textContent = "Erro: ID do produto não fornecido na URL."; return; }
  try { displayProduct(await fetchProductData(productId)); }
  catch (e) { console.error(e); if (loading) loading.textContent = "Produto não encontrado ou ocorreu um erro na busca."; }
}

window.toggleAccordion = window.toggleAccordion || function(element) {
  const content = element?.nextElementSibling;
  if (!content) return;
  const isExpanded = element.getAttribute("aria-expanded") === "true";
  content.classList.toggle("open", !isExpanded);
  content.style.maxHeight = isExpanded ? 0 : content.scrollHeight + "px";
  element.setAttribute("aria-expanded", String(!isExpanded));
};

window.openLightbox = window.openLightbox || function(index) { window.selectImage(index || 0); };
window.closeLightbox = window.closeLightbox || function() {};
window.prevImage = window.prevImage || function() { window.selectImage((currentImageIndex - 1 + productImages.length) % productImages.length); };
window.nextImage = window.nextImage || function() { window.selectImage((currentImageIndex + 1) % productImages.length); };

window.toggleFavorite = window.toggleFavorite || function() {};

document.addEventListener("DOMContentLoaded", initProductPage);
