import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';

// 1. CARREGAR VARIÁVEIS DE AMBIENTE
dotenv.config();

const app = express();

// 2. MIDDLEWARES
app.use(cors());
app.use(express.json());

// ==========================================
// CONEXÃO SEGURA COM MONGODB ATLAS
// ==========================================
// Lendo a senha do "cofre" do Render (MONGODB_URI)
const mongoURI = process.env.MONGODB_URI;

if (!mongoURI) {
    console.error("❌ ERRO CRÍTICO: A variável MONGODB_URI não foi configurada no painel do Render.");
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

// ==========================================
// ROTA DE LOGIN (ADICIONADA PARA O MONGODB)
// ==========================================
app.post('/api/seller/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Procura o vendedor pelo e-mail no MongoDB Atlas
        const seller = await Seller.findOne({ email: email.toLowerCase() });

        if (!seller) {
            return res.status(404).json({ message: "E-mail não encontrado." });
        }

        // Verifica a senha (comparação direta como você está usando)
        if (seller.password !== password) {
            return res.status(401).json({ message: "Senha incorreta." });
        }

        // Retorna os dados para o seu HTML salvar no localStorage
        res.json({
            token: "sessao_ativa_mongodb_" + seller._id, // Token temporário para manter logado
            seller: {
                id: seller._id,
                name: seller.name,
                factoryName: seller.factoryName,
                email: seller.email,
                status: seller.status,
                active: seller.active
            }
        });

    } catch (error) {
        console.error("Erro no login:", error);
        res.status(500).json({ message: "Erro interno no servidor." });
    }
});

// ============================
// BOT CHATWOOT
// ============================
app.post('/chatwoot-bot', async (req, res) => {
    try {
        const message = (req.body?.content || "").toLowerCase();

        let resposta = `👋 Olá! Bem-vindo à Ariana Móveis!\n\nDigite:\n1️⃣ Vendas\n2️⃣ Suporte\n3️⃣ Acompanhar pedido`;

        if (message.includes("1")) {
            resposta = "🛒 Você escolheu Vendas! Um atendente vai te chamar agora.";
        } else if (message.includes("2")) {
            resposta = "🛠️ Suporte selecionado! Me diga seu problema.";
        } else if (message.includes("3")) {
            resposta = "📦 Informe o número do seu pedido:";
        }

        res.json({ content: resposta });

    } catch (err) {
        console.error(err);
        res.json({ content: "Erro no bot" });
    }
});

// LISTAR TODOS OS VENDEDORES PARA O ADMIN
app.get('/api/seller/partner-requests', async (req, res) => {
    const sellers = await Seller.find().sort({ createdAt: -1 });
    res.json(sellers);
});

// APROVAR OU REPROVAR VENDEDOR
app.patch('/api/seller/partner-requests/:id/status', async (req, res) => {
    const { status, active } = req.body;
    await Seller.findByIdAndUpdate(req.params.id, { status, active });
    res.json({ ok: true });
});

// Iniciar Servidor (A porta 10000 é a padrão do Render)
const PORT = process.env.PORT || 10000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Backend rodando na porta ${PORT}`);
});