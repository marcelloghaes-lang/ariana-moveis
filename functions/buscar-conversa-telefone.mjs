import mongoose from "mongoose";
import "dotenv/config";
import { getCrediarioConversationModel } from "./services/crediarioConversationService.js";
import { normalizeBrazilPhone } from "./services/crediarioWhatsAppService.js";

const mongoUri = process.env.MONGODB_URI;
const mongoDb = process.env.MONGODB_DB || "ariana_moveis_db";
const phone = normalizeBrazilPhone("33988905282");

if (!mongoUri) {
  throw new Error("MONGODB_URI não configurada no arquivo .env");
}

await mongoose.connect(mongoUri, {
  dbName: mongoDb
});

console.log("Banco conectado:", mongoose.connection.db.databaseName);
console.log("Telefone normalizado:", phone);

const collections = await mongoose.connection.db
  .listCollections()
  .toArray();

console.log(
  "Coleções:",
  collections.map(collection => collection.name)
);

const Model = getCrediarioConversationModel(mongoose);

const docs = await Model.find({
  phone
})
  .sort({ updatedAt: -1 })
  .lean();

console.log("\nConversas encontradas:", docs.length);
console.log(JSON.stringify(docs, null, 2));

await mongoose.disconnect();
