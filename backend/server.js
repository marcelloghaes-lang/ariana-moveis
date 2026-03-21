import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
console.log("Conteúdo lido do .env:", process.env.MONGODB_URI);
// 1. CARREGAR VARIÁVEIS DE AMBIENTE
dotenv.config();

const app = express();

// 2. MIDDLEWARES
app.use(cors());
app.use(express.json());

// ============================
// CONEXÃO COM MONGODB ATLAS
// ============================
const mongoURI = process.env.MONGODB_URI;

// TESTE DE SEGURANÇA: Se o .env falhar, ele te avisa aqui
if (!mongoURI) {
    console.error("❌ ERRO CRÍTICO: A variável MONGODB_URI não foi encontrada no arquivo .env");
    console.log("Verifique se o seu arquivo se chama exatamente .env e está na pasta backend.");
} else {
    mongoose.connect(mongoURI)
        .then(() => console.log("✅ Conexão com MongoDB Atlas estabelecida!"))
        .catch(err => console.error("❌ Erro ao conectar no MongoDB:", err));
}

// ============================
// MODELO (ESQUEMA) DO SELLER
// ============================
const SellerSchema = new mongoose.Schema({
    name: String,
    factoryName: String,
    email: { type: String, unique: true },
    phone: String,
    whatsapp: String,
    cnpj: String,
    password: String, 
    status: { type: String, default: 'pending_onboarding' },
    active: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
});

const Seller = mongoose.model('Seller', SellerSchema);

// ============================
// ROTA: RECEBER CADASTRO DO SELLER
// ============================
app.post('/api/seller/partner-request', async (req, res) => {
    try {
        const data = req.body;
        
        const novoSeller = new Seller({
            name: data.name,
            factoryName: data.factoryName,
            email: data.email,
            phone: data.phone,
            whatsapp: data.whatsapp,
            cnpj: data.cnpj,
            password: data.requestedTempPass,
            status: 'pending_onboarding'
        });

        await novoSeller.save();
        console.log(`🚀 Novo Seller Cadastrado: ${data.factoryName}`);

        res.status(201).json({ 
            ok: true, 
            id: novoSeller._id, 
            message: "Solicitação criada com sucesso!" 
        });

    } catch (error) {
        console.error("Erro ao salvar Seller:", error);
        res.status(400).json({ 
            ok: false, 
            error: "E-mail ou CNPJ já cadastrado ou erro no servidor." 
        });
    }
});

// Iniciar Servidor
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`📡 Servidor Ariana Móveis rodando em http://localhost:${PORT}`);
});