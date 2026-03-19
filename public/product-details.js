/**
 * detalhes_produto.js
 * Lógica para carregar os detalhes de um produto específico do Firebase e renderizar na página.
 */

// =================================================================================
// 1. CONFIGURAÇÃO DO FIREBASE (VOCÊ DEVE INSERIR AS SUAS CHAVES AQUI!)
// =================================================================================

// ⚠️ INSERIR AQUI OS SEUS SCRIPTS DE IMPORTAÇÃO DO SDK DO FIREBASE NO SEU HTML 
// Exemplo no seu HTML:
/*
  <script src="https://www.gstatic.com/firebasejs/9.6.1/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/9.6.0/firebase-functions.js"></script>
*/

const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_AUTH_DOMAIN",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_STORAGE_BUCKET",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// Inicializa o Firebase
// firebase.initializeApp(firebaseConfig);
// const db = firebase.firestore(); 

// --- DADOS MOCK PARA TESTE (APAGAR DEPOIS DE CONECTAR AO FIREBASE REAL) ---
// Substitua esta simulação pelos dados reais do Firebase.
const mockProduct = {
    id: 'prod123',
    nome: 'Sofá Modular Confort Max 3 Lugares em Veludo Cinza',
    categoria: 'Moveis',
    preco: 2899.90,
    descricao: "O Sofá Modular Confort Max é a peça ideal para quem busca luxo, conforto e versatilidade. Revestido em veludo de alta qualidade, ele proporciona um toque macio e elegante. Seu design modular permite diversas configurações para se adaptar a qualquer espaço da sua sala de estar. Ideal para relaxar após um longo dia.",
    detalhes: [
        "Material: Veludo Suede Premium",
        "Cor: Cinza Chumbo",
        "Dimensões (LxPxA): 220cm x 100cm x 85cm",
        "Peso Suportado: 350kg",
        "Garantia: 12 meses contra defeitos de fabricação"
    ],
    imagens: [
        "https://firebasestorage.googleapis.com/v0/b/mock-images/o/sofa_cinza_principal.jpg?alt=media",
        "https://firebasestorage.googleapis.com/v0/b/mock-images/o/sofa_cinza_lateral.jpg?alt=media",
        "https://firebasestorage.googleapis.com/v0/b/mock-images/o/sofa_cinza_detalhe.jpg?alt=media",
        "https://firebasestorage.googleapis.com/v0/b/mock-images/o/sofa_cinza_ambiente.jpg?alt=media"
    ]
};
// --------------------------------------------------------------------------

let currentProduct = null;
let currentImageIndex = 0;
let productImages = [];
let isFavorite = false; // Estado do botão de favorito

// =================================================================================
// 2. FUNÇÕES PRINCIPAIS DE BUSCA E RENDERIZAÇÃO
// =================================================================================

/**
 * Busca os dados do produto no Firestore.
 * @param {string} id - ID do produto.
 * @returns {Promise<Object|null>} Os dados do produto ou null.
 */
async function fetchProductData(id) {
    console.log(`Buscando produto com ID: ${id}`);
    
    // --- LÓGICA DE FETCH REAL DO FIREBASE ---
    /*
    try {
        const docRef = db.collection('produtos').doc(id);
        const doc = await docRef.get();
        if (doc.exists) {
            return { id: doc.id, ...doc.data() };
        } else {
            console.error("Produto não encontrado!");
            return null;
        }
    } catch (error) {
        console.error("Erro ao buscar produto:", error);
        return null;
    }
    */
    
    // --- RETORNANDO MOCK PARA DEMONSTRAÇÃO ---
    if (id === 'prod123') {
        return mockProduct;
    } else {
        return null;
    }
}

/**
 * Renderiza a galeria de miniaturas e define a imagem principal.
 * @param {string[]} urls - Array de URLs das imagens do produto.
 */
function renderImageGallery(urls) {
    productImages = urls;
    const galleryContainer = document.getElementById('thumbnail-gallery');
    galleryContainer.innerHTML = ''; // Limpa a galeria existente

    urls.forEach((url, index) => {
        const img = document.createElement('img');
        img.src = url;
        img.alt = `Miniatura ${index + 1}`;
        img.className = 'thumbnail-image bg-white shadow-sm border border-gray-200';
        img.setAttribute('data-index', index);
        img.onclick = () => selectImage(index);

        galleryContainer.appendChild(img);
    });
    
    // Seleciona a primeira imagem por padrão
    selectImage(0);
}

/**
 * Altera a imagem principal e a miniatura ativa.
 * @param {number} index - Índice da imagem a ser exibida.
 */
window.selectImage = function(index) {
    if (index < 0 || index >= productImages.length) return;

    currentImageIndex = index;
    const mainImage = document.getElementById('main-product-image');
    mainImage.src = productImages[index];
    
    // Atualiza a classe 'active' nas miniaturas
    document.querySelectorAll('.thumbnail-image').forEach((img, i) => {
        img.classList.remove('active');
        if (i === index) {
            img.classList.add('active');
        }
    });
}

/**
 * Preenche todos os campos do HTML com os dados do produto.
 * @param {Object} data - Os dados do produto.
 */
function displayProduct(data) {
    currentProduct = data;
    
    // Esconde mensagem de carregamento e mostra o conteúdo
    document.getElementById('loading-message').style.display = 'none';
    document.getElementById('product-content-grid').style.display = 'grid';
    document.getElementById('product-description-accordion-container').style.display = 'block';

    // 1. Informações de Título e Preço
    document.title = `${data.nome} | ARIANA MOVEIS`;
    document.getElementById('product-name-display').textContent = data.nome;
    document.getElementById('breadcrumb-product-name').textContent = data.nome;
    document.getElementById('product-id-display').textContent = data.id;
    
    const formattedPrice = data.preco.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    document.getElementById('product-price-display').textContent = formattedPrice;

    // 2. Parcelamento (Exemplo: 10x sem juros)
    const installmentPrice = data.preco / 10;
    const formattedInstallment = installmentPrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    document.getElementById('product-installments-display').textContent = `Em até 10x de ${formattedInstallment} sem juros`;
    
    // 3. Imagens e Galeria (CRUCIAL PARA O SEU PROBLEMA)
    if (data.imagens && data.imagens.length > 0) {
        renderImageGallery(data.imagens);
    }

    // 4. Descrição
    const descriptionContent = document.getElementById('product-description-content');
    descriptionContent.innerHTML = data.descricao.replace(/\n/g, '<p>'); // Transforma quebras de linha em parágrafos
    
    // 5. Detalhes Técnicos (Ficha Técnica)
    const detailsList = document.getElementById('product-details-list');
    detailsList.innerHTML = '';
    if (data.detalhes && data.detalhes.length > 0) {
        data.detalhes.forEach(detail => {
            const li = document.createElement('li');
            li.textContent = detail;
            detailsList.appendChild(li);
        });
    }

    // 6. Breadcrumb Categoria
    const categoryLink = document.createElement('a');
    categoryLink.href = `categoria.html?category=${data.categoria}`;
    categoryLink.className = 'text-primary-blue hover:text-secondary-light-blue';
    categoryLink.textContent = data.categoria;
    
    const breadcrumbCategory = document.getElementById('breadcrumb-category');
    breadcrumbCategory.innerHTML = ''; 
    breadcrumbCategory.appendChild(categoryLink);
    document.getElementById('category-separator').classList.remove('hidden');
}

/**
 * Função principal que inicia o carregamento.
 */
async function initProductPage() {
    const params = new URLSearchParams(window.location.search);
    const productId = params.get('id');

    if (!productId) {
        document.getElementById('loading-message').textContent = 'Erro: ID do produto não fornecido na URL.';
        return;
    }

    const productData = await fetchProductData(productId);

    if (productData) {
        displayProduct(productData);
    } else {
        document.getElementById('loading-message').textContent = 'Produto não encontrado ou ocorreu um erro na busca.';
    }
}

// =================================================================================
// 3. FUNÇÕES DE INTERAÇÃO (Adicionais)
// =================================================================================

// --- Acordeão / Sanfona ---
window.toggleAccordion = function(element) {
    const content = element.nextElementSibling;
    const isExpanded = element.getAttribute('aria-expanded') === 'true';

    // Fecha o que estiver aberto
    if (isExpanded) {
        content.classList.remove('open');
        content.style.maxHeight = 0;
        element.setAttribute('aria-expanded', 'false');
    } else {
        // Abre o item clicado
        content.classList.add('open');
        // Define o max-height para a altura real do conteúdo
        content.style.maxHeight = content.scrollHeight + 'px'; 
        element.setAttribute('aria-expanded', 'true');
    }
}

// --- Lightbox ---
const lightbox = document.getElementById('product-lightbox');
const lightboxImage = document.createElement('img');
lightboxImage.id = 'lightbox-image-viewer';
lightboxImage.alt = 'Imagem do produto em tela cheia';
document.querySelector('.lightbox-content').prepend(lightboxImage);

window.openLightbox = function(index) {
    if (!productImages || productImages.length === 0) return;
    currentImageIndex = index;
    lightboxImage.src = productImages[currentImageIndex];
    lightbox.classList.add('active');
}

window.closeLightbox = function() {
    lightbox.classList.remove('active');
}

window.prevImage = function() {
    currentImageIndex = (currentImageIndex - 1 + productImages.length) % productImages.length;
    lightboxImage.src = productImages[currentImageIndex];
    selectImage(currentImageIndex);
}

window.nextImage = function() {
    currentImageIndex = (currentImageIndex + 1) % productImages.length;
    lightboxImage.src = productImages[currentImageIndex];
    selectImage(currentImageIndex);
}

// --- Favoritos ---
window.toggleFavorite = function(event) {
    event.stopPropagation(); // Impede que o clique abra o lightbox
    const heartIcon = document.querySelector('#favorite-button i');
    isFavorite = !isFavorite;

    if (isFavorite) {
        heartIcon.classList.remove('far');
        heartIcon.classList.add('fas', 'text-red-500');
        console.log(`Produto ${currentProduct.id} adicionado aos favoritos!`);
    } else {
        heartIcon.classList.remove('fas', 'text-red-500');
        heartIcon.classList.add('far');
        console.log(`Produto ${currentProduct.id} removido dos favoritos.`);
    }
}

// --- Quantidade ---
const quantityInput = document.getElementById('quantity-input');
document.getElementById('quantity-plus').onclick = () => {
    quantityInput.value = Math.min(99, parseInt(quantityInput.value) + 1);
};
document.getElementById('quantity-minus').onclick = () => {
    quantityInput.value = Math.max(1, parseInt(quantityInput.value) - 1);
};

// =================================================================================
// 4. INICIALIZAÇÃO
// =================================================================================

document.addEventListener('DOMContentLoaded', initProductPage);
