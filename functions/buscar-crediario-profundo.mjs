import mongoose from "mongoose";
import "dotenv/config";

const phoneParts = [
  "33988905282",
  "5533988905282",
  "988905282"
];

const mongoUri =
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  "mongodb://127.0.0.1:27017/ariana_moveis_db";

await mongoose.connect(mongoUri);

const db = mongoose.connection.db;
const collections = await db.listCollections().toArray();

const crediarioCollections = collections
  .map(item => item.name)
  .filter(name =>
    name.toLowerCase().includes("credi") ||
    name.toLowerCase().includes("analysis") ||
    name.toLowerCase().includes("conversation")
  );

console.log("Coleções encontradas:", crediarioCollections);

for (const name of crediarioCollections) {
  const docs = await db.collection(name)
    .find({})
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(200)
    .toArray();

  for (const doc of docs) {
    const text = JSON.stringify(doc);

    if (phoneParts.some(part => text.includes(part))) {
      console.log(`\n===== ENCONTRADO EM ${name} =====`);
      console.log(JSON.stringify(doc, null, 2));
    }
  }
}

await mongoose.disconnect();
