// vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
  root: './', // Define a raiz do seu projeto
  build: {
    // Isso é importante para projetos que não são Single Page Applications (SPA)
    // Força o Vite a procurar o index.html na raiz e a colocar os arquivos finais na pasta 'dist'
    outDir: 'dist', 
    rollupOptions: {
      input: {
        // Liste aqui seus arquivos HTML que são pontos de entrada
        main: 'index.html',
        admin: 'admin_entrega.html',
        // adicione outros, se necessário
      },
    },
  },
});
