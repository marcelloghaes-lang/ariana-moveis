const mongoose = require('mongoose');

// Pega a URL do MongoDB que vamos esconder no painel da Render/Netlify
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("ERRO: A variável MONGODB_URI não foi configurada!");
}

let isConnected = false;

const connectDB = async () => {
  // Se já estiver conectado, não faz nada (isso economiza memória!)
  if (isConnected) {
    return;
  }

  try {
    const db = await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    isConnected = db.connections[0].readyState;
    console.log("✅ Ariana Móveis: Conectado ao MongoDB com sucesso!");
  } catch (error) {
    console.error("❌ Erro ao conectar ao MongoDB:", error.message);
    // Não encerra o processo para a Render não ficar reiniciando em loop
  }
};

module.exports = connectDB;