/**
 * detalhes_produto.js
 * Lógica para carregar os detalhes de um produto específico via API
 * e renderizar na página, preservando a estrutura original do arquivo.
 */

const API_BASE = localStorage.getItem("API_BASE") || window.API_BASE || "https://ariana-move-mongo.onrender.com/api";

let currentProduct = null;
let currentImageIndex = 0;
let productImages = [];
let isFavorite = false;

// =================================================================================
// 1. FUNÇÕES AUXILIARES
// =================================================================================

function toNumber(value, fallback = 0) {
    if (value === null || value === undefined) return fallback;
    if (typeof value === "number") return Number.isFinite(value) ? value : fallback;

    let s = String(value).trim();
    if (!s) return fallback;

    s = s.replace(/[R$\s]/g, "").replace(/[^0-9.,-]/g, "");

    const hasComma = s.includes(",");
    const hasDot = s.includes(".");

    if (hasComma && hasDot) {
        s = s.replace(/\./g, "").replace(",", ".");
    } else if (hasComma) {
        s = s.replace(",", ".");
    }

    const n = parseFloat(s);
    return Number.isFinite(n) ? n : fallback;
}

function safeArray(value) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") return Object.values(value);
    return [];
}

function getSafeUrl(img) {
    if (!img) return "https://placehold.co/600x400?text=Sem+Imagem";
    if (typeof img === "string") return img;
    return img.url || img.imageUrl || img.downloadURL || img.src || "https://placehold.co/600x400?text=Sem+Imagem";
}

function normalizeProductData(data) {
    const imagensBrutas = safeArray(
        data.images ||
        data.imagens ||
        data.gallery ||
        data.galeria
    ).map(getSafeUrl).filter(Boolean);

    const detalhesBrutos = safeArray(
        data.details ||
        data.detalhes ||
        data.fichaTecnica ||
        data.ficha_tecnica
    ).map(item => typeof item === "string" ? item : String(item || "")).filter(Boolean);

    const nome = data.nome || data.name || data.title || "Produto";
    const categoria = data.categoria || data.category || data.categoryName || "";
    const preco = toNumber(data.preco ?? data.price ?? data.valor ?? 0, 0);
    const descricao = data.descricao || data.description || "";
    const id = data._id || data.id || "";

    let imagens = imagensBrutas;

    if (!imagens.length) {
        const fallbackImage = getSafeUrl(
            data.imageUrl ||
            data.mainImageUrl ||
            data.image ||
            data.imagem
        );
        imagens = [fallbackImage];
    }

    return {
        id,
        nome,
        categoria,
        preco,
        descricao,
        detalhes: detalhesBrutos,
        imagens
    };
}

function getFavorites() {
    try {
        return JSON.parse(localStorage.getItem("favorites") || "[]");
    } catch (_) {
        return [];
    }
}

function setFavorites(items) {
    localStorage.setItem("favorites", JSON.stringify(items));
}

function syncFavoriteUI() {
    const heartIcon = document.querySelector("#favorite-button i");
    if (!heartIcon) return;

    heartIcon.classList.remove("far", "fas", "text-red-500");

    if (isFavorite) {
        heartIcon.classList.add("fas", "text-red-500");
    } else {
        heartIcon.classList.add("far");
    }
}

// =================================================================================
// 2. FUNÇÕES PRINCIPAIS DE BUSCA E RENDERIZAÇÃO
// =================================================================================

/**
 * Busca os dados do produto via API.
 * @param {string} id - ID do produto.
 * @returns {Promise<Object|null>} Os dados do produto ou null.
 */
async function fetchProductData(id) {
    console.log(`Buscando produto com ID: ${id}`);

    try {
        const response = await fetch(`${API_BASE}/products/${encodeURIComponent(id)}`, {
            headers: {
                "Content-Type": "application/json"
            }
        });

        if (!response.ok) {
            throw new Error(`Produto não encontrado (${response.status})`);
        }

        const data = await response.json();
        return normalizeProductData(data);
    } catch (error) {
        console.error("Erro ao buscar produto:", error);
        return null;
    }
}

/**
 * Renderiza a galeria de miniaturas e define a imagem principal.
 * @param {string[]} urls - Array de URLs das imagens do produto.
 */
function renderImageGallery(urls) {
    productImages = Array.isArray(urls) ? urls : [];

    const galleryContainer = document.getElementById("thumbnail-gallery");
    if (!galleryContainer) return;

    galleryContainer.innerHTML = "";

    productImages.forEach((url, index) => {
        const img = document.createElement("img");
        img.src = url;
        img.alt = `Miniatura ${index + 1}`;
        img.className = "thumbnail-image bg-white shadow-sm border border-gray-200";
        img.setAttribute("data-index", index);
        img.onclick = () => selectImage(index);

        galleryContainer.appendChild(img);
    });

    if (productImages.length > 0) {
        selectImage(0);
    }
}

/**
 * Altera a imagem principal e a miniatura ativa.
 * @param {number} index - Índice da imagem a ser exibida.
 */
window.selectImage = function(index) {
    if (index < 0 || index >= productImages.length) return;

    currentImageIndex = index;

    const mainImage = document.getElementById("main-product-image");
    if (mainImage) {
        mainImage.src = productImages[index];
    }

    document.querySelectorAll(".thumbnail-image").forEach((img, i) => {
        img.classList.remove("active");
        if (i === index) {
            img.classList.add("active");
        }
    });
};

/**
 * Preenche todos os campos do HTML com os dados do produto.
 * @param {Object} data - Os dados do produto.
 */
function displayProduct(data) {
    currentProduct = data;

    const loadingMessage = document.getElementById("loading-message");
    const productContentGrid = document.getElementById("product-content-grid");
    const accordionContainer = document.getElementById("product-description-accordion-container");

    if (loadingMessage) loadingMessage.style.display = "none";
    if (productContentGrid) productContentGrid.style.display = "grid";
    if (accordionContainer) accordionContainer.style.display = "block";

    document.title = `${data.nome} | ARIANA MOVEIS`;

    const productNameDisplay = document.getElementById("product-name-display");
    const breadcrumbProductName = document.getElementById("breadcrumb-product-name");
    const productIdDisplay = document.getElementById("product-id-display");
    const productPriceDisplay = document.getElementById("product-price-display");
    const installmentsDisplay = document.getElementById("product-installments-display");

    if (productNameDisplay) productNameDisplay.textContent = data.nome;
    if (breadcrumbProductName) breadcrumbProductName.textContent = data.nome;
    if (productIdDisplay) productIdDisplay.textContent = data.id;

    const formattedPrice = data.preco.toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL"
    });

    if (productPriceDisplay) {
        productPriceDisplay.textContent = formattedPrice;
    }

    const installmentPrice = data.preco / 10;
    const formattedInstallment = installmentPrice.toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL"
    });

    if (installmentsDisplay) {
        installmentsDisplay.textContent = `Em até 10x de ${formattedInstallment} sem juros`;
    }

    if (data.imagens && data.imagens.length > 0) {
        renderImageGallery(data.imagens);
    }

    const descriptionContent = document.getElementById("product-description-content");
    if (descriptionContent) {
        descriptionContent.innerHTML = String(data.descricao || "").replace(/\n/g, "<p>");
    }

    const detailsList = document.getElementById("product-details-list");
    if (detailsList) {
        detailsList.innerHTML = "";

        if (data.detalhes && data.detalhes.length > 0) {
            data.detalhes.forEach(detail => {
                const li = document.createElement("li");
                li.textContent = detail;
                detailsList.appendChild(li);
            });
        }
    }

    const breadcrumbCategory = document.getElementById("breadcrumb-category");
    const categorySeparator = document.getElementById("category-separator");

    if (breadcrumbCategory && data.categoria) {
        const categoryLink = document.createElement("a");
        categoryLink.href = `categoria.html?category=${encodeURIComponent(data.categoria)}`;
        categoryLink.className = "text-primary-blue hover:text-secondary-light-blue";
        categoryLink.textContent = data.categoria;

        breadcrumbCategory.innerHTML = "";
        breadcrumbCategory.appendChild(categoryLink);

        if (categorySeparator) {
            categorySeparator.classList.remove("hidden");
        }
    }

    const favorites = getFavorites();
    isFavorite = favorites.includes(data.id);
    syncFavoriteUI();
}

/**
 * Função principal que inicia o carregamento.
 */
async function initProductPage() {
    const params = new URLSearchParams(window.location.search);
    const productId = params.get("id");

    const loadingMessage = document.getElementById("loading-message");

    if (!productId) {
        if (loadingMessage) {
            loadingMessage.textContent = "Erro: ID do produto não fornecido na URL.";
        }
        return;
    }

    const productData = await fetchProductData(productId);

    if (productData) {
        displayProduct(productData);
    } else {
        if (loadingMessage) {
            loadingMessage.textContent = "Produto não encontrado ou ocorreu um erro na busca.";
        }
    }
}

// =================================================================================
// 3. FUNÇÕES DE INTERAÇÃO (Adicionais)
// =================================================================================

// --- Acordeão / Sanfona ---
window.toggleAccordion = function(element) {
    const content = element?.nextElementSibling;
    if (!content) return;

    const isExpanded = element.getAttribute("aria-expanded") === "true";

    if (isExpanded) {
        content.classList.remove("open");
        content.style.maxHeight = 0;
        element.setAttribute("aria-expanded", "false");
    } else {
        content.classList.add("open");
        content.style.maxHeight = content.scrollHeight + "px";
        element.setAttribute("aria-expanded", "true");
    }
};

// =================================================================================
// 4. LIGHTBOX
// =================================================================================

let lightbox = null;
let lightboxImage = null;

function setupLightbox() {
    lightbox = document.getElementById("product-lightbox");

    const content = document.querySelector(".lightbox-content");
    if (!lightbox || !content) return;

    lightboxImage = document.getElementById("lightbox-image-viewer");

    if (!lightboxImage) {
        lightboxImage = document.createElement("img");
        lightboxImage.id = "lightbox-image-viewer";
        lightboxImage.alt = "Imagem do produto em tela cheia";
        content.prepend(lightboxImage);
    }
}

window.openLightbox = function(index) {
    if (!productImages || productImages.length === 0) return;
    if (!lightbox || !lightboxImage) return;

    currentImageIndex = index;
    lightboxImage.src = productImages[currentImageIndex];
    lightbox.classList.add("active");
};

window.closeLightbox = function() {
    if (!lightbox) return;
    lightbox.classList.remove("active");
};

window.prevImage = function() {
    if (!productImages.length || !lightboxImage) return;

    currentImageIndex = (currentImageIndex - 1 + productImages.length) % productImages.length;
    lightboxImage.src = productImages[currentImageIndex];
    selectImage(currentImageIndex);
};

window.nextImage = function() {
    if (!productImages.length || !lightboxImage) return;

    currentImageIndex = (currentImageIndex + 1) % productImages.length;
    lightboxImage.src = productImages[currentImageIndex];
    selectImage(currentImageIndex);
};

// =================================================================================
// 5. FAVORITOS
// =================================================================================

window.toggleFavorite = function(event) {
    if (event) event.stopPropagation();
    if (!currentProduct || !currentProduct.id) return;

    let favorites = getFavorites();

    if (favorites.includes(currentProduct.id)) {
        favorites = favorites.filter(id => id !== currentProduct.id);
        isFavorite = false;
        console.log(`Produto ${currentProduct.id} removido dos favoritos.`);
    } else {
        favorites.push(currentProduct.id);
        isFavorite = true;
        console.log(`Produto ${currentProduct.id} adicionado aos favoritos!`);
    }

    setFavorites(favorites);
    syncFavoriteUI();
};

// =================================================================================
// 6. QUANTIDADE
// =================================================================================

function setupQuantityControls() {
    const quantityInput = document.getElementById("quantity-input");
    const plusBtn = document.getElementById("quantity-plus");
    const minusBtn = document.getElementById("quantity-minus");

    if (!quantityInput || !plusBtn || !minusBtn) return;

    plusBtn.onclick = () => {
        quantityInput.value = Math.min(99, parseInt(quantityInput.value || "1", 10) + 1);
    };

    minusBtn.onclick = () => {
        quantityInput.value = Math.max(1, parseInt(quantityInput.value || "1", 10) - 1);
    };
}

// =================================================================================
// 7. INICIALIZAÇÃO
// =================================================================================

document.addEventListener("DOMContentLoaded", () => {
    setupLightbox();
    setupQuantityControls();
    initProductPage();
});