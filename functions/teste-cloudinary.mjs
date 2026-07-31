import mongoose from "mongoose";
import "dotenv/config";

await mongoose.connect(process.env.MONGODB_URI,{
  dbName:process.env.MONGODB_DB || "ariana_moveis_db"
});

const doc = await mongoose.connection.db
.collection("crediario_conversations")
.findOne(
  { conversationId: "credconv_a1fedfc0f3dd04676240" },
  {
    projection:{
      "documents.identityFront":1
    }
  }
);

console.log(JSON.stringify(doc.documents.identityFront,null,2));

await mongoose.disconnect();
