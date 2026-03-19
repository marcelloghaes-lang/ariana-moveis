import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import { getFirestore, collection, getDocs, query, where, orderBy, limit } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-storage.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-functions.js";

const firebaseConfig = {
  apiKey: "AIzaSyDhwqDaCVUNLQ0cg863fw251ZAjBWZ8WCo",
  authDomain: "ariana-moveis-final.firebaseapp.com",
  projectId: "ariana-moveis-final",
  storageBucket: "ariana-moveis-final.firebasestorage.app",
  messagingSenderId: "695257365498",
  appId: "1:695257365498:web:ef7698ea5d33d701338243",
  measurementId: "G-WNMWLYMW43"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

// Isso aqui é o que faz o Header e o Resto do site funcionar:
window.db = db;
window.auth = auth;
window.storage = storage;
window.collection = collection;
window.getDocs = getDocs;
window.query = query;
window.where = where;
window.orderBy = orderBy;
window.limit = limit;

console.log("✅ Firebase configurado e liberado!");
window.dispatchEvent(new Event("firebase:ready"));

export { app, db, storage, auth };