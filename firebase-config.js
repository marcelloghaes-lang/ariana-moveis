// =======================================================
// API CONFIG - SUBSTITUTO DO FIREBASE
// =======================================================

// 👉 URL do seu backend (ajuste depois)
const API_BASE = "http://localhost:3000/api";

// =======================================================
// 🔒 RATE LIMIT (mantido igual ao seu)
// =======================================================
let lastCall = 0;
const MIN_INTERVAL = 300; // mais leve que 1s

function rateLimit() {
  const now = Date.now();
  if (now - lastCall < MIN_INTERVAL) {
    throw new Error("Muitas requisições seguidas. Aguarde.");
  }
  lastCall = now;
}

// =======================================================
// 🔥 FUNÇÕES PADRÃO (equivalente ao Firebase)
// =======================================================

async function safeFetch(url, options = {}) {
  rateLimit();

  try {
    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json"
      },
      ...options
    });

    if (!response.ok) {
      throw new Error("Erro na API");
    }

    return await response.json();
  } catch (error) {
    console.error("Erro API:", error);
    throw error;
  }
}

// =======================================================
// 📦 PRODUTOS
// =======================================================

window.getDocs = async (path) => {
  return safeFetch(`${API_BASE}/${path}`);
};

window.getDoc = async (path, id) => {
  return safeFetch(`${API_BASE}/${path}/${id}`);
};

// =======================================================
// 🔎 QUERY SIMPLES (simulando Firestore)
// =======================================================

window.query = (path, params = {}) => {
  const queryString = new URLSearchParams(params).toString();
  return `${path}?${queryString}`;
};

window.collection = (name) => name;

// =======================================================
// 🧾 COMPATIBILIDADE COM SEU SISTEMA
// =======================================================

window.db = {};        // dummy
window.auth = {};      // dummy
window.storage = {};   // dummy

window.storageRef = () => {};
window.getDownloadURL = (url) => url;

// =======================================================
// EVENTO (mantido igual)
// =======================================================

console.log("✅ API (Mongo) inicializada!");
window.dispatchEvent(new Event("firebase:ready"));