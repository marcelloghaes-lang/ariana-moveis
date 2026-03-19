/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./public/**/*.html",
    "./public/**/*.js",
    "./admin/**/*.html",
    "./admin/**/*.js",
    "./src/**/*.html",
    "./src/**/*.js",
    "./dist/**/*.html",
    "./dist/**/*.js",
    "./*.html"
  ],
  safelist: [
    "container", "mx-auto", "flex", "grid", "items-center", "justify-between",
    "text-white", "bg-cover", "bg-center", "aspect-[15/3]", "aspect-[4/1]",
    "w-full", "h-full", "object-cover", "rounded-lg", "shadow-md",
    "bg-fundo-claro", "text-text-dark" // Adicionadas para garantir
  ],
  theme: {
    extend: {
      colors: {
        "primary-blue": "#2E6DA4",
        "dark-bg": "#1D2B3A",
        "secondary-light-blue": "#56B5FF",
        "text-dark": "#333333",      // Adicionado da busca.html
        "fundo-claro": "#F5F7FA",    // Adicionado da busca.html
        "warning-yellow": "#FFC107"  // Para o ícone de aviso
      },
      aspectRatio: {
        '15/3': '15 / 3',
        '4/1': '4 / 1',
      },
    },
  },
  plugins: [],
};