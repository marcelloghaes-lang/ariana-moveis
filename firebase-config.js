// =======================================================
// FIREBASE CONFIG - VERSÃO SEGURA
// =======================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import { 
  getFirestore, collection, getDocs, getDoc, doc, query, where, orderBy, limit 
} from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { getStorage, ref as storageRef, getDownloadURL } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-storage.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";

// =======================================================
// 🔒 CONFIG (PODE FICAR NO FRONT, MAS PROTEGIDO NO CONSOLE)
// =======================================================
const firebaseConfig = {
  apiKey: "AIzaSyDhwqDaCVUNLQ0cg863fw251ZAjBWZ8WCo",
  authDomain: "ariana-moveis-final.firebaseapp.com",
  projectId: "ariana-moveis-final",
  storageBucket: "ariana-moveis-final.firebasestorage.app",
  messagingSenderId: "695257365498",
  appId: "1:695257365498:web:ef7698ea5d33d701338243"
};

// =======================================================
// INICIALIZAÇÃO
// =======================================================
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

// =======================================================
// 🔥 PROTEÇÃO EXTRA (ANTI-SPAM / CONTROLE BÁSICO)
// =======================================================

// Limita chamadas repetidas no frontend
let lastCall = 0;
const MIN_INTERVAL = 1000; // 1 segundo

function rateLimit() {
  const now = Date.now();
  if (now - lastCall < MIN_INTERVAL) {
    throw new Error("Muitas requisições seguidas. Aguarde um instante.");
  }
  lastCall = now;
}

// Wrapper seguro para chamadas
window.safeGetDocs = async (...args) => {
  rateLimit();
  try {
    return await getDocs(...args);
  } catch (error) {
    if (
      error?.code === "resource-exhausted" ||
      error?.message?.includes("quota") ||
      error?.message?.includes("429")
    ) {
      console.error("🚫 Limite de uso do Firebase atingido.");
      throw new Error("Sistema temporariamente indisponível.");
    }
    throw error;
  }
};

// =======================================================
// EXPORT GLOBAL (mantido para seu sistema)
// =======================================================
window.db = db;
window.auth = auth;
window.storage = storage;
window.storageRef = storageRef;
window.getDownloadURL = getDownloadURL;
window.collection = collection;
window.getDocs = window.safeGetDocs; // 👈 substitui pelo seguro
window.query = query;
window.where = where;
window.orderBy = orderBy;
window.limit = limit;
window.doc = doc;
window.getDoc = getDoc;

console.log("✅ Firebase seguro inicializado!");
window.dispatchEvent(new Event("firebase:ready"));

export { app, db, storage, auth };