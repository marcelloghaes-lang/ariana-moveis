// src/screens/DataListenerScreen.js
import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';

// Importa as funções de Firebase
import { db, collection, onSnapshot } from '../config/firebase'; 

// --- Função startUsersListener ---
const startUsersListener = (setUsers) => {
  const usersCollectionRef = collection(db, "users");
  
  // onSnapshot é o listener em tempo real
  const unsubscribe = onSnapshot(usersCollectionRef, (querySnapshot) => {
    const usersData = [];
    querySnapshot.forEach((doc) => {
      usersData.push({ id: doc.id, ...doc.data() });
    });
    
    // 1. ATUALIZA O ESTADO DO COMPONENTE
    setUsers(usersData);
    console.log("Users atualizados (Total:", usersData.length, ")");
    
  }, (error) => {
    console.error("Erro em startUsersListener:", error);
  });
  
  return unsubscribe; // Retorna a função de cancelamento
};

// --- Função startOrdersListener ---
const startOrdersListener = (setOrders) => {
  const ordersCollectionRef = collection(db, "orders"); 

  const unsubscribe = onSnapshot(ordersCollectionRef, (querySnapshot) => {
    const ordersData = [];
    querySnapshot.forEach((doc) => {
      ordersData.push({ id: doc.id, ...doc.data() });
    });

    // 2. ATUALIZA O ESTADO DO COMPONENTE
    setOrders(ordersData);
    console.log("Orders atualizados (Total:", ordersData.length, ")");
    
  }, (error) => {
    console.error("Erro em startOrdersListener:", error);
  });

  return unsubscribe; // Retorna a função de cancelamento
};

// --- Componente Principal ---
export default function DataListenerScreen() {
  const [users, setUsers] = useState([]);
  const [orders, setOrders] = useState([]);

  // useEffect para o listener de Usuários
  useEffect(() => {
    // A função startUsersListener retorna a função de 'unsubscribe' (parar de escutar)
    const unsubscribeUsers = startUsersListener(setUsers);
    
    // O return do useEffect é chamado quando o componente é desmontado
    return () => {
      console.log("Parando listener de users...");
      unsubscribeUsers(); // <-- ESSENCIAL para evitar vazamento de memória!
    };
  }, []); // Array de dependências vazio: roda apenas na montagem

  // useEffect para o listener de Pedidos
  useEffect(() => {
    const unsubscribeOrders = startOrdersListener(setOrders);
    
    return () => {
      console.log("Parando listener de orders...");
      unsubscribeOrders(); // <-- ESSENCIAL para evitar vazamento de memória!
    };
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.header}>👥 Usuários ({users.length})</Text>
      <FlatList
        data={users}
        keyExtractor={item => item.id}
        renderItem={({ item }) => <Text style={styles.item}>ID: {item.id}, Nome: {item.nome}</Text>}
      />
      
      <Text style={[styles.header, { marginTop: 20 }]}>🛒 Pedidos ({orders.length})</Text>
      <FlatList
        data={orders}
        keyExtractor={item => item.id}
        renderItem={({ item }) => <Text style={styles.item}>ID: {item.id}, Total: R$ {item.total || 'N/A'}</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 50, paddingHorizontal: 15, backgroundColor: '#fff' },
  header: { fontSize: 18, fontWeight: 'bold', marginBottom: 5 },
  item: { fontSize: 14, paddingVertical: 2, borderBottomWidth: 1, borderBottomColor: '#eee' },
});
