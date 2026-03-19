// header_auth_fix.js - Ariana Móveis
// Este script garante que o header identifique o login do usuário

window.bindHeaderAuthListener = function(auth) {
    if (!auth) return;

    auth.onAuthStateChanged((user) => {
        const userArea = document.querySelector('#header-user-area'); // ID do container no seu header
        if (!userArea) return;

        if (user) {
            // Se estiver logado, mostra o nome ou e-mail e botão sair
            userArea.innerHTML = `
                <span class="text-sm mr-2 text-white">Olá, ${user.email.split('@')[0]}</span>
                <button onclick="window.auth.signOut()" class="text-xs bg-red-500 px-2 py-1 rounded text-white">Sair</button>
            `;
        } else {
            // Se estiver deslogado, mostra o botão de entrar
            userArea.innerHTML = `
                <a href="/login.html" class="text-white hover:text-blue-200">
                    <i class="fas fa-user mr-1"></i> Entrar
                </a>
            `;
        }
    });
};

console.log('✅ header_auth_fix.js carregado com sucesso!');