// Arquivo: detalhes.js (Ajustado para o seu produto.html)
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const db = getFirestore();

async function loadProductDetails() {
    const urlParams = new URLSearchParams(window.location.search);
    const productId = urlParams.get('id');

    if (!productId) return;

    try {
        const productRef = doc(db, "products", productId); // No seu HTML você usa "products"
        const productSnap = await getDoc(productRef);

        if (productSnap.exists()) {
            const data = productSnap.data();

            // 1. ATUALIZA TEXTOS (IDs exatos do seu produto.html)
            document.getElementById('product-name').textContent = data.name || data.nome;
            document.getElementById('product-sku').textContent = `SKU: ${data.sku || productSnap.id}`;
            
            // Preço (Formatando para Real)
            const preco = data.price || data.preco || 0;
            document.getElementById('product-price-full').textContent = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(preco);

            // 2. TRATAMENTO DE IMAGENS (Onde estava o erro dos Sellers)
            let imagens = [];
            // Verifica se é array de objetos (seu padrão), array de strings, ou campo único
            if (Array.isArray(data.images)) {
                imagens = data.images.map(img => typeof img === 'string' ? img : img.url);
            } else if (Array.isArray(data.imagens)) {
                imagens = data.imagens;
            } else if (data.imagem) {
                imagens = [data.imagem];
            }
            // Renderiza Galeria
            const mainImg = document.getElementById('main-product-image');
            const thumbGallery = document.getElementById('thumbnail-gallery');
            
            if (imagens.length > 0) {
                mainImg.src = imagens[0];
                thumbGallery.innerHTML = '';
                imagens.forEach((url, index) => {
                    const img = document.createElement('img');
                    img.src = url;
                    img.className = `thumbnail-image ${index === 0 ? 'active' : ''}`;
                    img.onclick = () => {
                        mainImg.src = url;
                        document.querySelectorAll('.thumbnail-image').forEach(t => t.classList.remove('active'));
                        img.classList.add('active');
                    };
                    thumbGallery.appendChild(img);
                });
            }

            // 3. DESCRIÇÃO
            document.getElementById('product-description').innerHTML = data.description || data.descricao || "Sem descrição.";

        }
    } catch (error) {
        console.error("Erro detalhes:", error);
    }
}

document.addEventListener('DOMContentLoaded', loadProductDetails);
