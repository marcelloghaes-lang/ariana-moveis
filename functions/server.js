import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';

// ==========================================
// 1. CARREGAR VARIÁVEIS DE AMBIENTE
// ==========================================
dotenv.config();

const app = express();

// ==========================================
// 2. MIDDLEWARES
// ==========================================
// CORS liberado para facilitar desenvolvimento local / Render / front separado
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// ==========================================
// 3. CONEXÃO COM MONGODB ATLAS
// ==========================================
const mongoURI = process.env.MONGODB_URI;

if (!mongoURI) {
  console.error('❌ ERRO CRÍTICO: MONGODB_URI não configurada.');
} else {
  mongoose.connect(mongoURI, {
    serverSelectionTimeoutMS: 5000
  })
    .then(() => console.log('✅ Conexão com MongoDB Atlas estabelecida!'))
    .catch(err => console.error('❌ Erro ao conectar no MongoDB:', err));
}

// ==========================================
// 4. MODELOS (ESQUEMAS)
// ==========================================
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

const ProductSchema = new mongoose.Schema({
  name: String,
  sku: String,
  price: Number,
  stock: Number,
  category: String,
  description: String,
  image: String,
  pesoKg: Number,
  comprimento: Number,
  largura: Number,
  altura: Number,
  sellerId: String,
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

const Seller = mongoose.models.Seller || mongoose.model('Seller', SellerSchema);
const Product = mongoose.models.Product || mongoose.model('Product', ProductSchema);

// ==========================================
// 5. ROTAS DE SAÚDE / TESTE
// ==========================================
app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'Ariana Móveis API',
    mode: 'mongo',
    message: 'Servidor rodando com sucesso'
  });
});

// ==========================================
// 6. ROTAS DO DASHBOARD
// ==========================================
app.get('/api/seller/dashboard', async (req, res) => {
  try {
    const totalProd = await Product.countDocuments();
    res.json({
      totalProdutos: totalProd,
      vendasHoje: 0,
      pedidosPendentes: 0,
      vendasTotal: 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 7. ROTA DE EXTRATO
// ==========================================
// Motorizada para ser rápida e evitar timeout
app.get('/api/seller/extrato', async (req, res) => {
  try {
    const orders = await mongoose.connection.collection('orders').find({}).toArray();

    const extrato = orders.map(o => {
      const bruto = Number(o.total || 0);
      const comissao = bruto * 0.12; // taxa de 12%
      const etiqueta = 0; // ajuste aqui se quiser custo fixo
      return {
        id: o._id,
        gross: bruto,
        fee: comissao,
        label: etiqueta,
        net: bruto - comissao - etiqueta
      };
    });

    res.json(extrato);
  } catch (err) {
    console.error('Erro no extrato:', err);
    res.status(500).json({ error: 'Erro ao processar extrato' });
  }
});

// ==========================================
// 8. PRODUTOS
// ==========================================
app.get('/api/seller/products', async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/seller/products', async (req, res) => {
  try {
    const novo = new Product(req.body);
    await novo.save();
    res.status(201).json({ ok: true, product: novo });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/seller/products/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/seller/products/:id', async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );

    if (!product) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }

    res.json({ ok: true, product });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ==========================================
// 9. PEDIDOS
// ==========================================
app.get('/api/seller/orders', async (req, res) => {
  try {
    const orders = await mongoose.connection
      .collection('orders')
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar pedidos' });
  }
});

app.get('/api/seller/orders/:id', async (req, res) => {
  try {
    const order = await mongoose.connection
      .collection('orders')
      .findOne({ _id: new mongoose.Types.ObjectId(req.params.id) });

    if (!order) {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }

    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/seller/orders/:id/ship', async (req, res) => {
  try {
    const { carrier, trackingCode } = req.body;

    await mongoose.connection.collection('orders').updateOne(
      { _id: new mongoose.Types.ObjectId(req.params.id) },
      {
        $set: {
          status: 'shipped',
          carrier,
          trackingCode,
          shippedAt: new Date()
        }
      }
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ==========================================
// 10. BOT DE ATENDIMENTO
// ==========================================
app.post('/api/chat', async (req, res) => {
  try {
    const { message = '' } = req.body;

    let resposta = 'Desculpe, não entendi.';
    if (message.includes('1')) {
      resposta = 'Nossos móveis têm 1 ano de garantia.';
    }

    res.json({ content: resposta });
  } catch (err) {
    res.json({ content: 'Erro no bot' });
  }
});

// ==========================================
// 11. ADMIN / PARTNER REQUESTS
// ==========================================
app.get('/api/seller/partner-requests', async (req, res) => {
  try {
    const sellers = await Seller.find().sort({ createdAt: -1 });
    res.json(sellers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/seller/partner-requests/:id/status', async (req, res) => {
  try {
    const { status, active } = req.body;

    const updated = await Seller.findByIdAndUpdate(
      req.params.id,
      { status, active },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ error: 'Seller não encontrado' });
    }

    res.json({ ok: true, seller: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ==========================================
// 12. AUTH / LOGIN
// ==========================================
app.post('/api/seller/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const seller = await Seller.findOne({
      email: String(email || '').toLowerCase(),
      password
    });

    if (!seller) {
      return res.status(401).json({ message: 'Credenciais inválidas' });
    }

    res.json({
      token: 'token_' + seller._id,
      seller
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 13. SELLER PROFILE
// ==========================================
app.get('/api/seller/me', async (req, res) => {
  try {
    const seller = await Seller.findOne().sort({ createdAt: 1 });
    res.json(seller || { factoryName: 'Seller Ariana' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/seller/update', async (req, res) => {
  try {
    const seller = await Seller.findOneAndUpdate({}, req.body, {
      new: true,
      upsert: false
    });

    res.json({ ok: true, seller });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ROTA PARA BUSCAR ATENDIMENTOS (SAC)
app.get('/api/seller/support', async (req, res) => {
    try {
        const tickets = await mongoose.connection.collection('support_tickets').find().sort({ createdAt: -1 }).toArray();
        res.json(tickets);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// MARCAR COMO RESPONDIDO
app.patch('/api/seller/support/:id/read', async (req, res) => {
    try {
        await mongoose.connection.collection('support_tickets').updateOne(
            { _id: new mongoose.Types.ObjectId(req.params.id) },
            { $set: { status: 'Respondido' } }
        );
        res.json({ ok: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// ==========================================
// 14. START DO SERVIDOR
// ==========================================
const PORT = process.env.PORT || 10000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Ariana Móveis na porta ${PORT}`);
});