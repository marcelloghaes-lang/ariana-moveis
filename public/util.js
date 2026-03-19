// =======================================================
// ARQUIVO: util.js
// FUNÇÃO: Lógica do frontend para carregar e exibir dados
// =======================================================

import api from "./api-service.js";

/**
 * Obtém o ID do produto da URL (ex: produto_detalhes.html?id=SEU_ID)
 * @returns {string | null} O ID do produto ou null.
 */
function getProductIdFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('id');
}

/**
 * Renderiza os detalhes do produto na página.
 * @param {object} product - O objeto produto retornado pela API.
 */
function renderProductDetails(product) {
    // 🚨 Este é o ponto onde você insere os dados no seu HTML
    console.log("Produto pronto para renderização:", product);

    // Exemplo de renderização (AJUSTE OS IDS CONFORME SEU HTML):
    document.getElementById('product-title').textContent = product.name || 'Produto Sem Nome';
    document.getElementById('product-category').textContent = product.category || 'Não Classificada';
    document.getElementById('product-price').textContent = `R$ ${product.price ? product.price.toFixed(2) : '0.00'}`;
    document.getElementById('product-description').textContent = product.description || 'Nenhuma descrição fornecida.';

    // Exemplo de renderização de imagem principal
    const mainImageElement = document.getElementById('main-product-image');
    if (mainImageElement && product.images && product.images.length > 0) {
        mainImageElement.src = product.images[0];
        mainImageElement.alt = product.name;
    }
}

/**
 * Função principal para carregar os dados e iniciar o processo.
 */
async function loadProductData() {
    const id = getProductIdFromUrl();
    const statusElement = document.getElementById('loading-status');

    if (!id) {
        console.error("ID do produto não encontrado na URL.");
        if (statusElement) statusElement.textContent = "Erro: ID do produto faltando na URL.";
        return;
    }

    try {
        if (statusElement) statusElement.textContent = "Carregando detalhes do produto...";
        
        const product = await api.getProduct(id);

        if (statusElement) statusElement.style.display = 'none';

        if (product) {
            renderProductDetails(product);
        } else {
            console.warn(`Produto com ID ${id} não encontrado.`);
            // Exibir mensagem de produto não encontrado
            if (statusElement) {
                statusElement.style.display = 'block';
                statusElement.textContent = "Produto não encontrado.";
            }
        }
    } catch (error) {
        console.error("Falha fatal ao carregar o produto:", error);
        if (statusElement) {
            statusElement.style.display = 'block';
            statusElement.textContent = `Erro ao carregar: ${error.message}`;
        }
    }
}

// Inicializa o carregamento dos dados quando a página é carregada
document.addEventListener('DOMContentLoaded', loadProductData);
