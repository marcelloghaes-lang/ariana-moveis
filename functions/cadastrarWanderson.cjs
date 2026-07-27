require('dotenv').config(); // Carrega as variáveis do arquivo .env
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Pega a URL do MongoDB do .env ou usa uma variável alternativa do seu projeto
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

if (!MONGO_URI) {
  console.error('❌ ERRO: A variável MONGO_URI não foi encontrada no arquivo .env!');
  console.log('Cole a string do MongoDB diretamente no arquivo ou confira o .env.');
  process.exit(1);
}

const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: 'admin' }
});

const User = mongoose.models.User || mongoose.model('User', UserSchema);

async function criarUsuario() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Conectado ao MongoDB com sucesso!');

    const email = 'wandersonnunes581@gmail.com';
    const senhaPura = 'Ab581@';

    // Criptografa a senha
    const hashedPassword = await bcrypt.hash(senhaPura, 10);

    // Cadastra ou atualiza o usuário no banco
    const user = await User.findOneAndUpdate(
      { email: email.toLowerCase() },
      { email: email.toLowerCase(), password: hashedPassword, role: 'admin' },
      { upsert: true, new: true }
    );

    console.log(`🚀 Usuário ${user.email} cadastrado com sucesso!`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Erro ao cadastrar usuário:', error);
    process.exit(1);
  }
}

criarUsuario();