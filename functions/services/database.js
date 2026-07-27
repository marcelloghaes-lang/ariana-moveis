export default function connectDatabase(mongoose, { uri = '', dbName = '' } = {}) {
  if (!uri) {
    console.error('❌ MONGODB_URI não configurada.');
    process.exit(1);
  }

  mongoose.set('strictQuery', true);

  return mongoose.connect(uri, { dbName })
    .then(() => console.log(`✅ Mongo conectado em ${dbName}`))
    .catch((err) => {
      console.error('❌ Erro ao conectar no Mongo:', err);
      process.exit(1);
    });
}
