// public/firebase-config.js
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import {
  getFirestore,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const USER_PROVIDED_CONFIG = {
      apiKey: "AIzaSyDhwqDaCVUNLQ0cg863fw251ZAjBWZ8WCo",
      authDomain: "ariana-moveis-final.firebaseapp.com",
      projectId: "ariana-moveis-final",
      storageBucket: "ariana-moveis-final.firebasestorage.app",
      messagingSenderId: "695257365498",
      appId: "1:695257365498:web:ef7698ea5d33d701338243",
      measurementId: "G-WNMWLYMW43"
    };

const app = getApps().length ? getApp() : initializeApp(USER_PROVIDED_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const functions = getFunctions(app);

// Bridge global para todas as telas
window.app = app;
window.auth = auth;
window.db = db;
window.storage = storage;
window.functions = functions;

window.collection = collection;
window.getDocs = getDocs;
window.query = query;
window.where = where;
window.orderBy = orderBy;
window.limit = limit;
window.doc = doc;
window.getDoc = getDoc;

// Evento para avisar que Firebase está pronto
try {
  window.dispatchEvent(new Event("firebase:ready"));
} catch (_) {}
