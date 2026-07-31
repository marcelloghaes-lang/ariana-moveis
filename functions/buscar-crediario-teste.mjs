import mongoose from "mongoose";
import "dotenv/config";

const phone = "33988905282";
const variants = [
  phone,
  `55${phone}`,
  `${phone}@s.whatsapp.net`,
  `55${phone}@s.whatsapp.net`
];

const mongoUri =
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  "mongodb://127.0.0.1:27017/ariana_moveis_db";

await mongoose.connect(mongoUri);

const db = mongoose.connection.db;
const collections = await db.listCollections().toArray();

console.log("Mongo:", mongoUri.replace(/\/\/.*@/, "//***@"));
console.log("Procurando:", variants);

for (const item of collections) {
  const collection = db.collection(item.name);

  const query = {
    $or: [
      { phone: { $in: variants } },
      { telefone: { $in: variants } },
      { whatsapp: { $in: variants } },
      { remoteJid: { $in: variants } },
      { customerPhone: { $in: variants } },
      { clienteTelefone: { $in: variants } },
      { telefoneCliente: { $in: variants } },
      { contactPhone: { $in: variants } }
    ]
  };

  const matches = await collection.find(query).limit(20).toArray();

  if (matches.length) {
    console.log(`\n===== ${item.name} (${matches.length}) =====`);

    for (const doc of matches) {
      console.log(JSON.stringify({
        _id: doc._id,
        phone: doc.phone,
        telefone: doc.telefone,
        whatsapp: doc.whatsapp,
        remoteJid: doc.remoteJid,
        status: doc.status,
        stage: doc.stage,
        etapa: doc.etapa,
        conversationStatus: doc.conversationStatus,
        documents: doc.documents,
        documentos: doc.documentos,
        analysisId: doc.analysisId,
        analiseId: doc.analiseId,
        updatedAt: doc.updatedAt
      }, null, 2));
    }
  }
}

await mongoose.disconnect();
