<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Gestão de Inventário de Produtos | ARIANA MOVEIS</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css">
    
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        // Configuração do Tailwind para usar o padrão Ariana Moveis
        tailwind.config = {
            theme: {
                extend: {
                    colors: {
                        // Cores da Marca (Padrão Ariana Moveis)
                        'primary-brown': '#8d4f1f',       /* Marrom Principal */
                        'secondary-gold': '#c08552',    /* Dourado/Caramelo de Destaque */
                        'dark-brown': '#6a360a',        /* Hover do Marrom */
                        'success-green': '#28a745',     /* Verde de Sucesso (Padrão) */
                        'danger-red': '#dc2626',        /* Vermelho para Perigo/Exclusão */
                    },
                    fontFamily: {
                        sans: ['Inter', 'sans-serif'],
                    },
                },
            }
        }
    </script>
    <style>
        /* Importa a fonte Inter */
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap');
        
        /* Classe de input customizada e corrigida para usar a cor da marca no foco */
        .form-input {
            /* Aplica estilos Tailwind e garante foco com a cor primária */
            /* ALTERADO: focus:ring-primary-brown focus:border-primary-brown */
            @apply w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-primary-brown focus:border-primary-brown;
        }

        /* Estilo para a caixa de notificação (Toast) */
        .toast {
            transition: opacity 0.3s ease-in-out, transform 0.3s ease-in-out;
            opacity: 0;
            transform: translateY(20px);
        }
        .toast.show {
            opacity: 1;
            transform: translateY(0);
        }
        body {
            font-family: 'Inter', sans-serif;
            background-color: #f7f7f7; /* Fundo mais claro */
            min-height: 100vh;
            display: flex;
            flex-direction: column;
        }
        main {
            flex-grow: 1;
        }
    </style>
    
    <script type="module">
        import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
        import { getFirestore, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, onSnapshot, query, orderBy } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
        import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
        
        // Simulação de credenciais (substitua pelas reais)
        const firebaseConfig = {
            apiKey: "YOUR_API_KEY",
            authDomain: "YOUR_AUTH_DOMAIN",
            projectId: "YOUR_PROJECT_ID",
            // ... outras configs
        };

        // Variáveis globais para Firebase
        let db;
        let auth;
        const COLLECTION_NAME = "produtos"; // Coleção de produtos

        /**
         * Inicializa o Firebase e o Firestore
         */
        window.initializeFirebase = function() {
            try {
                const app = initializeApp(firebaseConfig);
                db = getFirestore(app);
                auth = getAuth(app);
                console.log("Firebase e Firestore inicializados com sucesso.");
                
                // Inicia o listener de produtos
                startProductsListener();
            } catch (error) {
                console.error("Erro ao inicializar Firebase:", error);
                window.showMessage("Erro ao iniciar o sistema de banco de dados.", 'error');
            }
        };

        /**
         * Exibe uma mensagem de notificação (Toast)
         */
        window.showMessage = function(message, type = 'success') {
            const toast = document.getElementById('toast-notification');
            const toastMessage = document.getElementById('toast-message');
            
            toastMessage.textContent = message;
            
            // Remove classes antigas
            toast.classList.remove('bg-green-500', 'bg-red-500', 'bg-blue-500');

            if (type === 'success') {
                toast.classList.add('bg-success-green');
            } else if (type === 'error') {
                toast.classList.add('bg-danger-red');
            } else {
                 toast.classList.add('bg-secondary-gold');
            }

            toast.classList.add('show');
            
            // Esconde após 3 segundos
            setTimeout(() => {
                toast.classList.remove('show');
            }, 3000);
        };

        /**
         * Adiciona ou Atualiza um produto no Firestore
         */
        async function handleSaveProduct(event) {
            event.preventDefault();
            const form = event.target;
            const productId = form.dataset.productId;
            
            const name = document.getElementById('productName').value;
            const price = parseFloat(document.getElementById('productPrice').value) || 0;
            const quantity = parseInt(document.getElementById('productQuantity').value) || 0;

            if (!name) {
                window.showMessage('O nome do produto é obrigatório.', 'error');
                return;
            }

            const productData = {
                name: name,
                price: price,
                quantity: quantity,
                // Adicione outros campos se necessário (ex: description, imageUrl, category)
                updatedAt: new Date(),
            };
            
            try {
                if (productId) {
                    // Atualizar produto existente
                    const productRef = doc(db, COLLECTION_NAME, productId);
                    await updateDoc(productRef, productData);
                    window.showMessage(`Produto "${name}" atualizado com sucesso!`, 'success');
                } else {
                    // Adicionar novo produto
                    productData.createdAt = new Date();
                    await addDoc(collection(db, COLLECTION_NAME), productData);
                    window.showMessage(`Produto "${name}" adicionado com sucesso!`, 'success');
                }
                form.reset();
                form.dataset.productId = ''; // Limpa o ID de edição
                document.getElementById('submitButton').textContent = 'Adicionar Produto';
            } catch (e) {
                console.error("Erro ao salvar o produto:", e);
                window.showMessage(`Erro ao salvar: ${e.message}`, 'error');
            }
        }

        /**
         * Carrega os dados de um produto no formulário para edição
         */
        function loadProductForEdit(id, name, price, quantity) {
            document.getElementById('productForm').dataset.productId = id;
            document.getElementById('productName').value = name;
            document.getElementById('productPrice').value = price;
            document.getElementById('productQuantity').value = quantity;
            document.getElementById('submitButton').textContent = `Salvar Edição de ${name.substring(0, 15)}...`;
            window.showMessage(`Editando produto: ${name}`, 'info');
            // Scroll para o formulário
            document.getElementById('productForm').scrollIntoView({ behavior: 'smooth' });
        }

        /**
         * Confirmação e exclusão de produto
         */
        function handleDeleteProduct(id, name) {
            if (confirm(`Tem certeza que deseja DELETAR o produto: ${name}? Esta ação é irreversível.`)) {
                deleteProduct(id, name);
            }
        }

        async function deleteProduct(id, name) {
             try {
                await deleteDoc(doc(db, COLLECTION_NAME, id));
                window.showMessage(`Produto "${name}" deletado com sucesso.`, 'success');
            } catch (e) {
                console.error("Erro ao deletar produto:", e);
                window.showMessage(`Erro ao deletar: ${e.message}`, 'error');
            }
        }

        /**
         * Escuta as mudanças na coleção de produtos em tempo real (onSnapshot)
         */
        function startProductsListener() {
            const q = query(collection(db, COLLECTION_NAME), orderBy("name", "asc"));
            onSnapshot(q, (querySnapshot) => {
                const products = [];
                querySnapshot.forEach((doc) => {
                    products.push({ id: doc.id, ...doc.data() });
                });
                renderProductList(products);
            }, (error) => {
                console.error("Erro ao ouvir a coleção de produtos:", error);
                window.showMessage(`Erro ao carregar lista de produtos: ${error.message}`, 'error');
            });
        }


        /**
         * Renderiza a lista de produtos na tabela
         */
        function renderProductList(products) {
            const tableBody = document.getElementById('productList');
            tableBody.innerHTML = ''; // Limpa a tabela

            products.forEach(item => {
                const row = document.createElement('tr');
                // Alterna cores das linhas (bg-gray-50)
                row.className = 'border-b border-gray-200 ' + (products.indexOf(item) % 2 === 0 ? 'bg-white' : 'bg-gray-50');

                // Formatação de segurança para o nome
                const safeName = item.name ? item.name.replace(/'/g, "\\'") : 'Sem Nome';
                const formattedPrice = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.price ?? 0);

                row.innerHTML = `
                    <td class="px-4 py-3 whitespace-nowrap text-sm font-medium text-text-default">${item.name}</td>
                    <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${formattedPrice}</td>
                    <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${item.quantity ?? '0'}</td>
                    <td class="px-4 py-3 whitespace-nowrap text-right text-sm font-medium space-x-2">
                        <button 
                            onclick="window.productManager.loadProductForEdit('${item.id}', '${safeName}', ${item.price ?? 0}, ${item.quantity ?? 0})"
                            class="text-sky-600 hover:text-sky-800 font-semibold p-2 rounded-lg hover:bg-sky-100 transition duration-150"
                        >
                            Editar
                        </button>
                        <button
                            onclick="window.productManager.handleDeleteProduct('${item.id}', '${safeName}')"
                            class="text-danger-red hover:text-red-800 font-semibold p-2 rounded-lg hover:bg-red-100 transition duration-150"
                        >
                            Deletar
                        </button>
                    </td>
                `;
                tableBody.appendChild(row);
            });
        }

        // --- Inicialização e Event Listeners ---
        
        // Inicializa o Firebase quando a janela carregar
        document.addEventListener('DOMContentLoaded', initializeFirebase);

        // Expõe as funções para serem chamadas diretamente pelo HTML (via window.productManager)
        window.productManager = {
            handleSaveProduct,
            loadProductForEdit,
            handleDeleteProduct
        };
    </script>
</head>
<body>

    <div id="toast-notification" class="toast fixed bottom-5 right-5 z-50 p-4 rounded-lg text-white shadow-xl max-w-sm">
        <p id="toast-message" class="font-semibold"></p>
    </div>

    <header class="bg-primary-brown shadow-md">
        <div class="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
            <h1 class="text-2xl font-bold text-white">
                <i class="fas fa-tools mr-2 text-secondary-gold"></i> Gestão de Produtos
            </h1>
            <a href="index.html" class="text-sm font-medium text-white hover:text-secondary-gold transition duration-200">
                <i class="fas fa-sign-out-alt mr-1"></i> Sair / Ir para o Site
            </a>
        </div>
    </header>

    <main class="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">

        <section class="bg-white shadow-xl rounded-xl p-6 mb-8 border-t-4 border-secondary-gold">
            <h2 class="text-2xl font-bold text-gray-800 mb-6">Adicionar Novo Produto</h2>
            <form id="productForm" onsubmit="window.productManager.handleSaveProduct(event)" data-product-id="">
                <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div>
                        <label for="productName" class="block text-sm font-medium text-gray-700 mb-1">Nome do Produto</label>
                        <input type="text" id="productName" required class="form-input" placeholder="Ex: Sofá Modulare">
                    </div>
                    <div>
                        <label for="productPrice" class="block text-sm font-medium text-gray-700 mb-1">Preço (R$)</label>
                        <input type="number" id="productPrice" step="0.01" min="0" class="form-input" placeholder="Ex: 1999.90">
                    </div>
                    <div>
                        <label for="productQuantity" class="block text-sm font-medium text-gray-700 mb-1">Estoque</label>
                        <input type="number" id="productQuantity" min="0" class="form-input" placeholder="Ex: 15">
                    </div>
                </div>
                
                <div class="mt-6">
                    <button 
                        type="submit" 
                        id="submitButton" 
                        class="w-full py-3 px-4 border border-transparent rounded-lg shadow-sm text-lg font-semibold text-white 
                               bg-primary-brown hover:bg-dark-brown focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-brown transition duration-150"
                    >
                        Adicionar Produto
                    </button>
                </div>
            </form>
        </section>

        <section class="bg-white shadow-xl rounded-xl p-6 border-t-4 border-primary-brown">
            <h2 class="text-2xl font-bold text-gray-800 mb-6">Inventário Atual</h2>
            
            <div class="overflow-x-auto">
                <table class="min-w-full divide-y divide-gray-200">
                    <thead class="bg-gray-50">
                        <tr>
                            <th scope="col" class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                Produto
                            </th>
                            <th scope="col" class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                Preço
                            </th>
                            <th scope="col" class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                Estoque
                            </th>
                            <th scope="col" class="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                Ações
                            </th>
                        </tr>
                    </thead>
                    <tbody id="productList" class="bg-white divide-y divide-gray-200">
                        <tr>
                            <td colspan="4" class="px-4 py-4 text-center text-gray-500">
                                Carregando produtos... (Se demorar, verifique a conexão com o Firebase)
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

        </section>

    </main>

    <footer class="bg-[#2c3e50] text-gray-300 py-8 mt-auto">
        <div class="max-w-7xl mx-auto px-4">
            
            <div class="grid grid-cols-1 md:grid-cols-3 gap-8 border-b border-gray-700 pb-6 mb-6">
                
                <div class="footer-column">
                    <h3 class="text-xl font-bold text-secondary-gold border-b border-gray-600 pb-2 mb-3">Ariana Moveis</h3>
                    <p class="text-sm">Sua loja de móveis e decoração de alta qualidade.</p>
                    <p class="text-xs mt-2">CNPJ: **48.126.915/0001-74**</p>
                    
                    <h4 class="text-lg font-semibold text-gray-100 mt-4 mb-2">Contato e Localização</h4>
                    <p class="text-sm"><i class="fas fa-phone-alt w-4 mr-2"></i> **(31) 98514-7119**</p>
                    <p class="text-sm"><i class="fas fa-envelope w-4 mr-2"></i> **sndigital@outlook.com.br**</p>
                    <p class="text-sm"><i class="fas fa-map-marker-alt w-4 mr-2"></i> **R. Olegário de Andrade, 54A - Bairro Amazonas - Guanhães/MG, CEP 39740-000**</p>
                </div>

                <div class="footer-column">
                    <h3 class="text-xl font-bold text-secondary-gold border-b border-gray-600 pb-2 mb-3">Institucional e Ajuda</h3>
                    <ul class="list-none p-0 text-sm space-y-1">
                        <li><a href="politica_entrega.html" class="text-gray-400 hover:text-white transition">Política de Entrega e Frete</a></li>
                        <li><a href="politica_troca.html" class="text-gray-400 hover:text-white transition">Política de Troca e Devoluções</a></li>
                        <li><a href="politica_reclamacao.html" class="text-gray-400 hover:text-white transition">Reclamações e SAC</a></li>
                        <li><a href="sobre_nos.html" class="text-gray-400 hover:text-white transition">Quem Somos</a></li>
                        <li><a href="#" class="text-gray-400 hover:text-white transition">Trabalhe Conosco</a></li>
                        <li><a href="#" class="text-gray-400 hover:text-white transition">Nossas Lojas Físicas</a></li>
                    </ul>
                </div>

                <div class="footer-column">
                    <h3 class="text-xl font-bold text-secondary-gold border-b border-gray-600 pb-2 mb-3">Minha Conta</h3>
                    <ul class="list-none p-0 text-sm space-y-1">
                        <li><a href="minha_conta.html" class="text-gray-400 hover:text-white transition">Meus Dados Cadastrais</a></li>
                        <li><a href="meus_pedidos.html" class="text-gray-400 hover:text-white transition">Meus Pedidos e Rastreio</a></li>
                        <li><a href="favoritos.html" class="text-gray-400 hover:text-white transition">Meus Favoritos</a></li>
                        <li><a href="carrinho.html" class="text-gray-400 hover:text-white transition">Meu Carrinho</a></li>
                    </ul>
                    
                    <h4 class="text-lg font-semibold text-gray-100 mt-4 mb-2">Redes Sociais</h4>
                    <div class="social-icons text-2xl space-x-3">
                        <a href="#" class="text-gray-400 hover:text-white transition"><i class="fab fa-facebook-square"></i></a>
                        <a href="#" class="text-gray-400 hover:text-white transition"><i class="fab fa-instagram"></i></a>
                        <a href="#" class="text-gray-400 hover:text-white transition"><i class="fab fa-pinterest"></i></a>
                    </div>
                </div>

            </div>
            
            <div class="footer-bottom text-center text-xs text-gray-500">
                <p>&copy; <span id="current-year">2025</span> Ariana Moveis. Todos os direitos reservados.</p>
                <script>document.getElementById('current-year').textContent = new Date().getFullYear();</script>
            </div>
        </div>
    </footer>
</body>
</html>
