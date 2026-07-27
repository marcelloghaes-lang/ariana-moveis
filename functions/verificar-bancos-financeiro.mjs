import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const uri = process.env.MONGODB_URI;

await mongoose.connect(uri);

for (const nome of ["ariana_moveis", "ariana_moveis_db"]) {
  const db = mongoose.connection.client.db(nome);
  const colecoes = await db.listCollections().toArray();

  const relevantes = colecoes
    .map(c => c.name)
    .filter(n => /cora|charge|boleto|carne|financeiro/i.test(n));

  console.log("\nBanco:", nome);
  console.log("Coleções:", relevantes);

  for (const colecao of relevantes) {
    const total = await db.collection(colecao).countDocuments();
    console.log(`  ${colecao}: ${total}`);
  }
}

await mongoose.disconnect();
