import mongoose from "mongoose";
import "dotenv/config";
import { getCrediarioConversationModel } from "./services/crediarioConversationService.js";

await mongoose.connect(process.env.MONGODB_URI);

const Model = getCrediarioConversationModel(mongoose);

const docs = await Model.find().sort({updatedAt:-1}).limit(10).lean();

console.log(JSON.stringify(docs,null,2));

await mongoose.disconnect();
