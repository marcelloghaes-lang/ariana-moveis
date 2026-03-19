import { initializeApp } from "firebase/app";
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  onSnapshot, 
  query,
  where 
} from "firebase/firestore";

// IMPORTAÇÕES PARA AUTENTICAÇÃO
import { 
  getAuth, 
  signInWithEmailAndPassword,
  onAuthStateChanged 
} from "firebase/auth";

// 
// ATENÇÃO: Substitua pelas suas próprias credenciais do Firebase
// Você as encontra no Console do Firebase > Configurações do Projeto
//
const firebaseConfig = {
  apiKey: "AIzaSyCiMvsSVWIT1DoefdM2dmXFxbVWQVfSsYU", 
  authDomain: "ariana-moveis-final.firebaseapp.com", 
  projectId: "ariana-moveis-final", 
  storageBucket: "ariana-moveis-final.appspot.com", 
  messagingSenderId: "1055737187409", 
  appId: "1:1055737187409:web:8e68494de6c4c9ecf67c70", 
  measurementId: "G-G8NH3JXKQX" 
};

// 1. Inicializa o Firebase App
const firebaseApp = initializeApp(firebaseConfig);

// 2. Obtém a instância do Firestore
const db = getFirestore(firebaseApp);

// 3. Obtém a instância do Serviço de Autenticação (A CHAVE PARA CORRIGIR SEUS ERROS)
const auth = getAuth(firebaseApp);

// Exporta as instâncias e as funções necessárias do Firestore e Auth
export { 
  // Instâncias
  db, 
  auth, 
  
  // Funções do Firestore
  collection, 
  doc, 
  setDoc, 
  onSnapshot, 
  query, 
  where,
  
  // Funções do Auth (essenciais para suas chamadas)
  signInWithEmailAndPassword,
  onAuthStateChanged
};
