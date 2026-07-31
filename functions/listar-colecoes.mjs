import mongoose from "mongoose";
import "dotenv/config";

const mongoUri =
  process.env.MONGODB_URI ||
  process.env.MONGO_URI;

await mongoose.connect(mongoUri);

const cols = await mongoose.connection.db.listCollections().toArray();

console.log(cols.map(c => c.name));

await mongoose.disconnect();
