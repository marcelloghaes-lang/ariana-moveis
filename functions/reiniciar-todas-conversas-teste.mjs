import mongoose from "mongoose";
import "dotenv/config";

await mongoose.connect(process.env.MONGODB_URI, {
  dbName: process.env.MONGODB_DB || "ariana_moveis_db"
});

const collection = mongoose.connection.db.collection("crediario_conversations");

const result = await collection.updateMany(
  {
    phone: "5533988905282"
  },
  {
    $set: {
      step: "AGUARDANDO_CONSENTIMENTO",
      status: "ATIVO",
      consent: {
        accepted: false,
        acceptedAt: null
      },
      data: {
        name: "",
        cpf: "",
        birthDate: "",
        maritalStatus: "",
        profession: "",
        phone: "",
        email: "",
        reference1: "",
        reference2: ""
      },
      documents: {
        identityFront: { received: false },
        identityBack: { received: false },
        selfie: { received: false },
        addressProof: { received: false },
        incomeProof: { received: false }
      },
      processedEventHashes: [],
      lastInteractionAt: new Date(),
      updatedAt: new Date()
    }
  }
);

console.log("Conversas reiniciadas:", result.modifiedCount);

await mongoose.disconnect();
