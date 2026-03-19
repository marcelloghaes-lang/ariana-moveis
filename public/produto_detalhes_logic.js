import { doc, getDoc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

let allImages = [];
let productData = null; 
let userId = null;
let isFavorite = false;

// Função para garantir que a imagem seja carregada corretamente
const _getSafeUrl = (img) => {
    if (!img) return 'https://placehold.co/400x400?text=Sem+Imagem';
    if (typeof img === 'string') return img;
    return img.url || img.imageUrl || '';
};

async function loadProductDetails() {
    const urlParams = new URLSearchParams(window.location.search);
    const productId = urlParams.get('id');
    const db = window.db; // Pega o DB do seu HTML

    if (!productId || !db) return;

    try {
        const productRef = doc(db, "products", productId);
        const productSnap = await getDoc(productRef);
        
        if (productSnap.exists()) {
            productData = { id: productSnap.id, ...productSnap.data() };
            
            // Preenchimento dos dados (Igual ao seu original)
            document.getElementById('product-name').textContent = productData.name || '';
            document.getElementById('product-price-full').textContent = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(productData.price || 0);
            document.getElementById('product-description').innerHTML = productData.description || '';

            // Lógica das Imagens
            let rawImages = productData.images || productData.imagens || [];
            allImages = (Array.isArray(rawImages) ? rawImages : Object.values(rawImages)).map(img => _getSafeUrl(img));

            renderGallery(allImages);
            
            document.getElementById('loading-message').style.display = 'none';
            document.getElementById('product-details-container').style.display = 'grid';

            if (userId) checkIfFavorite(productId);
        }
    } catch (error) {
        console.error("Erro ao carregar detalhes:", error);
    }
}

function renderGallery(images) {
    const mainImg = document.getElementById('main-product-image');
    const thumbContainer = document.getElementById('thumbnail-gallery');
    if (images.length > 0 && mainImg) mainImg.src = images[0];
    if (thumbContainer) {
        thumbContainer.innerHTML = '';
        images.forEach((url, idx) => {
            const img = document.createElement('img');
            img.src = url;
            img.className = `thumbnail-image ${idx === 0 ? 'active' : ''}`;
            img.onclick = () => {
                if (mainImg) mainImg.src = url;
                document.querySelectorAll('.thumbnail-image').forEach(t => t.classList.remove('active'));
                img.classList.add('active');
            };
            thumbContainer.appendChild(img);
        });
    }
}

// LÓGICA DE FAVORITOS
async function checkIfFavorite(productId) {
    if (!userId || !window.db) return;
    const favRef = doc(window.db, "users", userId, "favorites", productId);
    const favSnap = await getDoc(favRef);
    if (favSnap.exists()) {
        isFavorite = true;
        const btn = document.getElementById('btn-toggle-favorite');
        if (btn) btn.style.color = "#ef4444";
    }
}

// Inicialização
(function initAuth(){
  const start = (a) => {
    onAuthStateChanged(a, (user) => {
      if (user) userId = user.uid;
      loadProductDetails();
    });
  };

  if (window.auth) return start(window.auth);

  // Aguarda firebase-config.js (ou init do Firebase da página) disparar o evento
  window.addEventListener("firebase:ready", () => {
    if (window.auth) start(window.auth);
  }, { once: true });

  // Fallback: tenta por alguns segundos caso o evento não dispare
  let tries = 0;
  const t = setInterval(() => {
    tries += 1;
    if (window.auth) { clearInterval(t); start(window.auth); }
    if (tries > 50) clearInterval(t);
  }, 200);
})();
