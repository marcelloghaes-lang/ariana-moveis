<!DOCTYPE html>
<html lang="pt-br">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">
  <meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval'; img-src * data: blob: http: https:;">
  <title>Painel Administrativo | ARIANA MÓVEIS</title>
  
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
  <link rel="stylesheet" href="css/tailwind.min.css">

  <script>
    // CORREÇÃO 2: Configuração de API para o Render e Localhost
    const API_BASE_CANDIDATES = [
        'http://localhost:3000/api',
        'https://ariana-moveis.onrender.com/api' // Ajuste para sua URL real do Render
    ];

    let API_BASE = API_BASE_CANDIDATES[0];

    // CORREÇÃO 3: apiRequest com suporte a Bearer Token (Enterprise)
    async function apiRequest(path, opts = {}) {
        const token = localStorage.getItem('admin_token');
        
        const headers = {
            'Authorization': token ? `Bearer ${token}` : '',
            ...(opts.headers || {})
        };

        const isFormData = typeof FormData !== 'undefined' && opts.body instanceof FormData;
        if (!isFormData && !headers['Content-Type']) {
            headers['Content-Type'] = 'application/json';
        }

        // Tenta os candidatos a servidor
        for (const base of API_BASE_CANDIDATES) {
            try {
                const url = `${base.replace(/\/+$/, '')}${path.startsWith('/') ? '' : '/'}${path}`;
                const res = await fetch(url, { ...opts, headers });

                if (res.status === 401) {
                    console.error("Não autorizado. Limpando sessão...");
                    localStorage.removeItem('admin_token');
                    window.location.href = 'admin_login.html';
                    throw new Error("Sessão expirada");
                }

                if (!res.ok) {
                    const errorData = await res.json().catch(() => ({}));
                    throw new Error(errorData.error || `Erro ${res.status}`);
                }

                return await res.json();
            } catch (e) {
                if (e.message === "Sessão expirada") throw e;
                console.warn(`Falha no host ${base}, tentando próximo...`);
            }
        }
        throw new Error("Nenhum servidor respondeu.");
    }

    // Função para salvar produto integrada ao MongoDB
    async function saveProductFromForm(formData) {
        try {
            // CORREÇÃO 4: Rota correta do Server Enterprise
            const result = await apiRequest('/products', {
                method: 'POST',
                body: JSON.stringify(formData)
            });
            alert("Produto salvo na nuvem com sucesso!");
            location.reload();
        } catch (err) {
            alert("Erro ao salvar: " + err.message);
        }
    }
  </script>
</head>
<body class="bg-gray-100 font-inter">

  <div id="app">
    <header class="bg-white shadow p-4 flex justify-between items-center">
        <h1 class="text-xl font-bold text-primary-blue">Painel Ariana Móveis</h1>
        <div id="admin-info" class="flex items-center gap-2">
            <span id="admin-name" class="font-bold text-gray-700">Carregando...</span>
            <button onclick="logout()" class="text-error-red"><i class="fas fa-sign-out-alt"></i></button>
        </div>
    </header>

    <main class="p-6">
        <p class="text-gray-600">O sistema está conectado ao MongoDB Atlas via Render.</p>
    </main>
  </div>

  <script>
    // Inicialização
    function init() {
        const user = JSON.parse(localStorage.getItem('admin_user') || '{}');
        if (!localStorage.getItem('admin_token')) {
            window.location.href = 'admin_login.html';
            return;
        }
        document.getElementById('admin-name').textContent = user.name || 'Administrador';
        console.log("🚀 Painel Conectado ao MongoDB");
    }

    function logout() {
        localStorage.clear();
        window.location.href = 'admin_login.html';
    }

    // CORREÇÃO 5: REMOVIDO SERVICE WORKER PARA EVITAR CACHE DE ADMIN ANTIGO
    // (O sw.js foi desativado para garantir dados em tempo real)

    document.addEventListener('DOMContentLoaded', init);
  </script>
</body>
</html>