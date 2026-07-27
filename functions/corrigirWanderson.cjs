const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

async function main() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || 'ariana_moveis_db';
  const email = 'wandersonnunes581@gmail.com';
  const senha = 'Ab581@';

  if (!uri) {
    throw new Error('MONGODB_URI não informada');
  }

  await mongoose.connect(uri, { dbName });

  const passwordHash = await bcrypt.hash(senha, 12);

  const result = await mongoose.connection.db.collection('users').findOneAndUpdate(
    { email: email.toLowerCase() },
    {
      $set: {
        email: email.toLowerCase(),
        name: 'Wanderson Nunes',
        role: 'admin',
        isActive: true,
        passwordHash,
        updatedAt: new Date()
      },
      $setOnInsert: {
        createdAt: new Date()
      }
    },
    {
      upsert: true,
      returnDocument: 'after'
    }
  );

  const user = await mongoose.connection.db.collection('users').findOne({
    email: email.toLowerCase()
  });

  console.log({
    encontrado: Boolean(user),
    email: user?.email,
    role: user?.role,
    isActive: user?.isActive,
    possuiPasswordHash: Boolean(user?.passwordHash),
    banco: mongoose.connection.name
  });

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});