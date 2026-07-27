import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

await mongoose.connect(process.env.MONGODB_URI);

const db = mongoose.connection.client.db(
  process.env.MONGODB_DB || "ariana_moveis_db"
);

const row = await db.collection("cora_charges").findOne(
  {},
  {
    sort: { createdAt: -1 },
    projection: {
      _id: 1,
      orderId: 1,
      internalReference: 1,
      code: 1,
      environment: 1,
      status: 1,
      documentUrl: 1,
      customer: 1,
      invoices: 1,
      createdAt: 1
    }
  }
);

console.dir(row, { depth: 10 });

await mongoose.disconnect();
