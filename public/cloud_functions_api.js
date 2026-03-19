// Firebase Admin SDK para interagir com o Firestore e o Firebase Auth
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const express = require('express');
const cors = require('cors');

// Inicializa o Firebase Admin SDK (necessário para o Firestore)
// Em um ambiente de Cloud Function, a inicialização geralmente não requer argumentos.
admin.initializeApp();
const db = admin.firestore();

// O ID da coleção que armazenará os produtos (sem o prefixo /artifacts/... pois está no Admin SDK)
// Se você quiser que esta função escreva na coleção pública, o caminho COMPLETO deve ser usado.
// ASSUMIMOS que esta função é para gerenciar a coleção de PRODUTOS.
const COLLECTION_NAME = 'produtos';

// Configuração do Express App
const app = express();

// Configura CORS para permitir requisições de qualquer origem (necessário para o frontend)
app.use(cors({ origin: true }));
// Middleware para parsear o corpo das requisições JSON
app.use(express.json());

// ====================================================================
// ROTAS CRUD DE PRODUTOS
// ====================================================================

/**
 * [POST] Cria um novo produto com suporte a Marketplace
 */
app.post('/', async (req, res) => {
    try {
        const data = req.body;

        if (!data.nome || !data.preco || !data.categoria) {
            return res.status(400).send({ message: "Campos 'nome', 'preco' e 'categoria' são obrigatórios." });
        }

        const preco = parseFloat(data.preco);
        
        const newProduto = {
            nome: data.nome,
            preco: preco,
            descricao: data.descricao || '',
            categoria: data.categoria,
            imagemUrl: data.imagemUrl || 'https://placehold.co/400x300/F0F4C3/333?text=Sem+Imagem', 
            
            // --- ADICIONADO PARA O MARKETPLACE ---
            sellerId: data.sellerId || 'admin', 
            sellerName: data.sellerName || 'Ariana Móveis',
            // -------------------------------------
            
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        const docRef = await db.collection(COLLECTION_NAME).add(newProduto);
        res.status(201).send({ message: 'Produto criado com sucesso!', id: docRef.id, data: newProduto });
    } catch (error) {
        console.error("Erro ao criar produto:", error);
        res.status(500).send({ message: "Erro interno do servidor." });
    }
});

/**
 * [GET] Lista todos os produtos
 * Endpoint: /produtos
 */
app.get('/', async (req, res) => {
    try {
        // Tenta obter os produtos
        const snapshot = await db.collection(COLLECTION_NAME).get();
        const produtos = [];
        snapshot.forEach(doc => {
            // Garante que o ID do documento está incluído junto com os dados
            produtos.push({ id: doc.id, ...doc.data() });
        });

        res.status(200).send({ message: 'Produtos listados com sucesso.', data: produtos });
    } catch (error) {
        console.error("Erro ao listar produtos:", error);
        res.status(500).send({ message: "Erro interno do servidor ao listar produtos." });
    }
});

/**
 * [PUT] Atualiza um produto existente
 * Endpoint: /produtos/:id
 * Body: { nome, preco, descricao, categoria, imagemUrl } (apenas campos a serem alterados)
 */
app.put('/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const updates = req.body;

        if (Object.keys(updates).length === 0) {
            return res.status(400).send({ message: "Nenhum dado de atualização fornecido." });
        }

        const productRef = db.collection(COLLECTION_NAME).doc(id);
        
        // Converte o preço para float e faz validação, se o campo estiver presente
        if (updates.preco) {
            const preco = parseFloat(updates.preco);
            if (isNaN(preco) || preco <= 0) {
                return res.status(400).send({ message: "Preço inválido na atualização." });
            }
            updates.preco = preco;
        }

        // Adiciona timestamp de atualização
        updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        
        await productRef.update(updates); 

        res.status(200).send({ message: `Produto ID ${id} atualizado com sucesso.` });

    } catch (error) {
        // Verifica se o erro é de documento não encontrado
        if (error.code === 'not-found') {
            return res.status(404).send({ message: `Produto com ID ${req.params.id} não encontrado.` });
        }
        console.error("Erro ao atualizar produto:", error);
        res.status(500).send({ message: "Erro interno do servidor ao atualizar produto." });
    }
});

/**
 * [DELETE] Exclui um produto
 * Endpoint: /produtos/:id
 */
app.delete('/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const productRef = db.collection(COLLECTION_NAME).doc(id);

        const doc = await productRef.get();
        if (!doc.exists) {
            return res.status(404).send({ message: `Produto com ID ${id} não encontrado.` });
        }

        await productRef.delete();

        res.status(200).send({ message: `Produto ID ${id} excluído com sucesso.` });
    } catch (error) {
        console.error("Erro ao excluir produto:", error);
        res.status(500).send({ message: "Erro interno do servidor ao excluir produto." });
    }
});


// Exporta a API como uma Cloud Function (Função de Nuvem)
// A rota base será algo como: https://[REGION]-[PROJECT_ID].cloudfunctions.net/api/produtos
// Você pode implantá-lo com um nome simples, como 'api'.
exports.api = functions
    .region('southamerica-east1') // Usando a região que você configurou
    .https.onRequest(app);

