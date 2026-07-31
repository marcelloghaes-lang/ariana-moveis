import mongoose from "mongoose";
import "dotenv/config";
import { getCrediarioConversationModel } from "./services/crediarioConversationService.js";
import { normalizeBrazilPhone } from "./services/crediarioWhatsAppService.js";

const mongoUri = process.env.MONGODB_URI;
const mongoDb = process.env.MONGODB_DB || "ariana_moveis_db";
const phone = normalizeBrazilPhone("33988905282");

await mongoose.connect(mongoUri, {
  dbName: mongoDb
});

const Model = getCrediarioConversationModel(mongoose);

const docs = await Model.find({
  phone
}).lean();

console.log("Banco:", mongoose.connection.db.databaseName);
console.log("Telefone normalizado:", phone);
console.log(JSON.stringify(docs, null, 2));

await mongoose.disconnect();
