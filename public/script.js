// scripts.js — Ariana Móveis Marketplace Navigation
// ================================================

// Função principal para navegação entre páginas
function handleNavigation(page) {
    const routes = {
        'Home': 'index.html',
        'Categoria': 'categoria.html',
        'Cadastro': 'cadastro.html',
        'Carrinho': 'carrinho.html',
        'Checkout': 'checkout.html',
        'Contato': 'contato.html',
        // ROTAS CORRIGIDAS (sem espaços)
        'Login': 'login-cadastro.html', 
        'Meus Endereços': 'meus-enderecos.html',
        'Meus Pedidos': 'meus-pedidos.html',
        'Minha Conta': 'minha-conta.html',
        'Ofertas': 'ofertas.html',
        'Pedido Confirmação': 'pedido-confirmacao.html',
        'Política de Entrega': 'politica-de-entrega.html',
        'Política de Reclamação': 'politica-reclamacao.html',
        'Política de Troca': 'politica-de-troca.html',
        'Produto Detalhes': 'produto-detalhes.html',
        'Rastrear Pedido': 'rastrear-pedido.html',
        'Sobre Nós': 'sobre-nos.html'
    };

    const target = routes[page];
    if (target) {
        // Redirecionamento forçado para o arquivo HTML local
        window.location.href = target;
    } else {
        console.warn(`Página "${page}" não encontrada nas rotas configuradas.`);
    }
}

// =====================
// Menu Mobile
// =====================
const mobileMenuButton = document.getElementById('mobile-menu-button');
const mobileMenu = document.getElementById('mobile-menu');

if (mobileMenuButton && mobileMenu) {
    mobileMenuButton.addEventListener('click', () => {
        const isClosed = mobileMenu.classList.contains('mobile-menu-closed');
        if (isClosed) {
            mobileMenu.classList.remove('mobile-menu-closed');
        } else {
            mobileMenu.classList.add('mobile-menu-closed');
        }
    });
}

// =====================
// Carrinho (botão do topo)
// =====================
const cartButton = document.getElementById('cart-button');
if (cartButton) {
    cartButton.addEventListener('click', () => handleNavigation('Carrinho'));
}

// =====================
// Simulação de adicionar ao carrinho
// =====================
function addToCart(id) {
    const messageBox = document.getElementById('message-box');
    const messageText = document.getElementById('message-text');

    if (!messageBox || !messageText) return;

    messageText.textContent = `Produto ${id} adicionado ao carrinho!`;
    messageBox.classList.remove('modal-hidden');
    messageBox.classList.add('border-green-500');

    setTimeout(() => {
        messageBox.classList.add('modal-hidden');
        messageBox.classList.remove('border-green-500');
    }, 2000);
}

// =====================
// Simulação de checkout
// =====================
function simulateCheckout(event) {
    event.preventDefault();
    handleNavigation('Pedido Confirmação');
}

// =====================
// Fechar modal de checkout
// =====================
function closeCheckoutModal() {
    const modal = document.getElementById('checkout-modal');
    if (modal) modal.classList.add('modal-hidden');
}
