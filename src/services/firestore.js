// src/services/firestore.js
import { db, doc, setDoc } from '../config/firebase'; // Importa a instância 'db'

/**
 * Cria a coleção 'users' e adiciona um documento.
 * @param {string} userId - O ID do documento do usuário.
 * @param {object} userData - Os dados do usuário.
 */
export const createInitialUser = async (userId, userData) => {
  try {
    const userRef = doc(db, "users", userId);
    // setDoc cria a coleção se ela não existir
    await setDoc(userRef, userData, { merge: true }); 
    console.log("Coleção 'users' configurada.");
  } catch (e) {
    console.error("Erro ao criar coleção 'users': ", e);
    throw e;
  }
};

/**
 * Cria a coleção 'orders' e adiciona um documento.
 * @param {string} orderId - O ID do documento do pedido.
 * @param {object} orderData - Os dados do pedido.
 */
export const createInitialOrder = async (orderId, orderData) => {
  try {
    const orderRef = doc(db, "orders", orderId);
    // setDoc cria a coleção se ela não existir
    await setDoc(orderRef, orderData); 
    console.log("Coleção 'orders' configurada.");
  } catch (e) {
    console.error("Erro ao criar coleção 'orders': ", e);
    throw e;
  }
};

// --- Exemplo de como usar estas funções uma única vez (ex: na inicialização do app) ---
/*
createInitialUser("u123", { nome: "Novo Usuário Expo", ativo: true });
createInitialOrder("o999", { userId: "u123", total: 150.00, data: new Date() });
*/
