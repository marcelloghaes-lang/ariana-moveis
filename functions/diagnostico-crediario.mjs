import mongoose from "mongoose";
import "dotenv/config";

const uri =
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  process.env.MONGODB_URL;

if (!uri) {
  console.error("ERRO: variável de conexão Mongo não encontrada.");
  process.exit(1);
}

await mongoose.connect(uri);

const db = mongoose.connection.db;

const collections = await db
  .listCollections()
  .toArray();

const candidates = collections
  .map(item => item.name)
  .filter(name =>
    /crediario|conversation|conversa/i.test(name)
  );

console.log("Coleções encontradas:", candidates);

for (const collectionName of candidates) {
  const rows = await db
    .collection(collectionName)
    .find({})
    .sort({
      updatedAt: -1,
      createdAt: -1,
      _id: -1
    })
    .limit(3)
    .toArray();

  console.log(`\n===== ${collectionName} =====`);

  for (const row of rows) {
    console.dir({
      _id: row._id,
      conversationId: row.conversationId,
      analysisId: row.analysisId,
      phone: row.phone || row.telefone,
      status: row.status,
      step: row.step || row.etapa,
      consent: row.consent || row.consentimento,
      lastMessage: row.lastMessage || row.ultimaMensagem,
      lastInboundMessage:
        row.lastInboundMessage ||
        row.ultimaMensagemRecebida,
      updatedAt: row.updatedAt
    }, {
      depth: 8
    });
  }
}

await mongoose.disconnect();
