import mongoose from "mongoose";
import "dotenv/config";

await mongoose.connect(process.env.MONGODB_URI, {
  dbName: process.env.MONGODB_DB || "ariana_moveis_db"
});

const collection = mongoose.connection.db.collection("crediario_conversations");

const docs = await collection.find({
  phone: "5533988905282"
}).sort({
  updatedAt: -1
}).toArray();

console.log(
  JSON.stringify(
    docs.map(doc => ({
      _id: doc._id,
      conversationId: doc.conversationId,
      phone: doc.phone,
      instanceName: doc.instanceName,
      step: doc.step,
      status: doc.status,
      updatedAt: doc.updatedAt,
      lastInteractionAt: doc.lastInteractionAt,
      processedEventHashes: doc.processedEventHashes?.slice(-3)
    })),
    null,
    2
  )
);

await mongoose.disconnect();
