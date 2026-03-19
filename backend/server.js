import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import { fileURLToPath } from 'url';
import path from 'path';
import 'dotenv/config'; // Carrega as variáveis do arquivo .env

// --- Importação de Rotas e Modelos ---
import productRoutes from './routes/productRoutes.js'; 

// --- Variáveis de Configuração ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8080;

// ====================================================================
// SEGURANÇA MÁXIMA: A senha NÃO está mais escrita aqui.
// O sistema agora lê a chave MONGODB_URI de um arquivo oculto (.env)
// ====================================================================
const MONGODB_ATLAS_URI = process.env.MONGODB_URI;

// --- Configuração do Aplicativo Express ---
const app = express();

// Middlewares
app.use(cors()); 
app.use(express.json()); 

// --- Conexão com o Banco de Dados (MongoDB via Mongoose) ---
async function connectDB() {
    if (!MONGODB_ATLAS_URI) {
        console.error("❌ ERRO CRÍTICO: MONGODB_URI não encontrada no arquivo .env");
        return;
    }

    try {
        await mongoose.connect(MONGODB_ATLAS_URI);
        console.log("✅ Conexão com MongoDB Atlas estabelecida com sucesso.");
    } catch (error) {
        console.error(`❌ Erro ao conectar ao MongoDB Atlas: ${error.message}`);
    }
}

// Inicia a conexão com o banco
connectDB();

// --- Rotas API ---

// Rota de teste simples
app.get('/api/status', (req, res) => {
    res.json({
        message: "Backend em funcionamento!",
        databaseStatus: mongoose.connection.readyState === 1 ? 'Conectado' : 'Desconectado',
        timestamp: new Date().toISOString()
    });
});

// Rotas de Produtos: Mapeadas para /api/products
app.use('/api/products', productRoutes);

// --- Inicialização do Servidor ---
app.listen(PORT, () => {
    console.log(`✅ Servidor rodando com sucesso em http://localhost:${PORT}`);
});
console.log("Link lido do .env:", process.env.MONGODB_URI);