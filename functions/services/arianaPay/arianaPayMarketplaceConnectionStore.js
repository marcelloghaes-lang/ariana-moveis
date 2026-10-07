import mongoose from 'mongoose';

function clean(value=''){
  return String(value ?? '').trim();
}

function bool(value){
  return clean(value).toLowerCase()==='true';
}

const memoryConnections=new Map();
let connectionPromise=null;
let connection=null;
let model=null;

function config(env=process.env){
  return {
    mongoUri:clean(env.ARIANA_PAY_MARKETPLACE_MONGO_URI),
    collection:clean(env.ARIANA_PAY_MARKETPLACE_CONNECTION_COLLECTION)||'ariana_pay_marketplace_connections',
    requirePersistence:bool(env.ARIANA_PAY_MARKETPLACE_REQUIRE_PERSISTENCE)
  };
}

async function persistentModel(env=process.env){
  const cfg=config(env);
  if(!cfg.mongoUri) return null;
  if(model) return model;
  if(!connectionPromise){
    connectionPromise=mongoose.createConnection(cfg.mongoUri,{
      serverSelectionTimeoutMS:5000,
      maxPoolSize:4,
      minPoolSize:0
    }).asPromise().then((conn)=>{
      connection=conn;
      const schema=new mongoose.Schema({
        manufacturerId:{type:String,required:true,index:true,unique:true},
        userId:{type:String,default:''},
        credentialCapsule:{type:String,required:true},
        testToken:{type:Boolean,default:false},
        connectedAt:{type:Date,default:Date.now},
        tokenExpiresAt:{type:Date,default:null},
        updatedAt:{type:Date,default:Date.now}
      },{versionKey:false,collection:cfg.collection});
      model=conn.model('ArianaPayMarketplaceConnection',schema);
      return model;
    }).catch((error)=>{
      connectionPromise=null;
      connection=null;
      model=null;
      throw error;
    });
  }
  return connectionPromise;
}

function normalize(record={}){
  if(!record) return null;
  const value=typeof record.toObject==='function'?record.toObject():record;
  return {
    manufacturerId:clean(value.manufacturerId),
    userId:clean(value.userId),
    credentialCapsule:clean(value.credentialCapsule),
    testToken:value.testToken===true,
    connectedAt:value.connectedAt?new Date(value.connectedAt).toISOString():null,
    expiresAt:value.tokenExpiresAt?new Date(value.tokenExpiresAt).toISOString():null,
    storage:value.storage||'persistent'
  };
}

export function marketplaceConnectionStoreCapabilities(env=process.env){
  const cfg=config(env);
  return {
    persistentConfigured:Boolean(cfg.mongoUri),
    persistenceRequired:cfg.requirePersistence,
    collection:cfg.collection,
    fallback:'memory',
    productionReady:Boolean(cfg.mongoUri)
  };
}

export async function saveMarketplaceConnection(result={}, {env=process.env}={}){
  const manufacturerId=clean(result.manufacturerId);
  const credentialCapsule=clean(result.credentialCapsule);
  if(!manufacturerId||!credentialCapsule){
    const error=new Error('Vínculo Mercado Pago incompleto para persistência.');
    error.code='ARIANA_PAY_MP_CONNECTION_INVALID';
    error.statusCode=400;
    throw error;
  }
  const payload={
    manufacturerId,
    userId:clean(result.userId),
    credentialCapsule,
    testToken:result.testToken===true,
    connectedAt:result.connectedAt||new Date().toISOString(),
    tokenExpiresAt:result.expiresAt||null,
    updatedAt:new Date()
  };
  const cfg=config(env);
  try{
    const Store=await persistentModel(env);
    if(Store){
      const saved=await Store.findOneAndUpdate(
        {manufacturerId},
        {$set:payload},
        {upsert:true,new:true,setDefaultsOnInsert:true}
      );
      return {...normalize(saved),storage:'persistent'};
    }
  }catch(error){
    if(cfg.requirePersistence){
      error.code=error.code||'ARIANA_PAY_MP_PERSISTENCE_FAILED';
      error.statusCode=503;
      throw error;
    }
    console.error('[ariana-pay-marketplace] connection_persistence_fallback',error?.message||error);
  }
  const memory={...payload,storage:'memory'};
  memoryConnections.set(manufacturerId,memory);
  return normalize(memory);
}

export async function getMarketplaceConnection(manufacturerId,{env=process.env}={}){
  const id=clean(manufacturerId);
  if(!id) return null;
  const cfg=config(env);
  try{
    const Store=await persistentModel(env);
    if(Store){
      const found=await Store.findOne({manufacturerId:id}).lean();
      if(found) return {...normalize(found),storage:'persistent'};
    }
  }catch(error){
    if(cfg.requirePersistence){
      error.code=error.code||'ARIANA_PAY_MP_PERSISTENCE_FAILED';
      error.statusCode=503;
      throw error;
    }
    console.error('[ariana-pay-marketplace] connection_read_fallback',error?.message||error);
  }
  const found=memoryConnections.get(id);
  return found?{...normalize(found),storage:'memory'}:null;
}

export async function deleteMarketplaceConnection(manufacturerId,{env=process.env}={}){
  const id=clean(manufacturerId);
  if(!id) return false;
  memoryConnections.delete(id);
  try{
    const Store=await persistentModel(env);
    if(Store) await Store.deleteOne({manufacturerId:id});
  }catch(error){
    if(config(env).requirePersistence) throw error;
  }
  return true;
}

export async function closeMarketplaceConnectionStore(){
  if(connection){
    await connection.close().catch(()=>null);
  }
  connection=null;
  connectionPromise=null;
  model=null;
}

export default {
  marketplaceConnectionStoreCapabilities,
  saveMarketplaceConnection,
  getMarketplaceConnection,
  deleteMarketplaceConnection,
  closeMarketplaceConnectionStore
};