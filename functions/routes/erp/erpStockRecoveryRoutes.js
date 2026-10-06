import express from 'express';

const RUN_ID='2026-10-06-stock-incident-v1';
const clean=(v='')=>String(v??'').trim();
const normalize=(v='')=>clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
function external(p={}){const sku=clean(p.sku).toUpperCase(),src=normalize(p.storefrontSource||p?.logistics?.source||p?.dropshipping?.provider||'');if(sku.startsWith('DSLITE-')||src==='dslite')return true;const seller=normalize(`${p.sellerId||''} ${p.sellerName||''}`);return Boolean(seller&&!seller.includes('ariana')&&!seller.includes('marcelo_nunes'));}

async function buildPlan(Product){
  const db=Product.db;
  const maps=await db.collection('erpmigrationmaps').find({source:'sige',entityType:'product','details.stock':{$gt:0}}).project({targetId:1,sourceId:1,details:1}).toArray();
  const plan=[];
  for(const map of maps){
    const id=clean(map.targetId);if(!id)continue;
    let p=null;try{p=await Product.findById(id).lean();}catch{}
    if(!p||Number(p.stock||0)>0||external(p))continue;
    const restoreTo=Math.max(0,Math.floor(Number(map?.details?.stock||0)));
    if(!restoreTo)continue;
    plan.push({productId:id,name:clean(p.name),sku:clean(p.sku),before:Number(p.stock||0),after:restoreTo,sourceId:clean(map.sourceId)});
  }
  return plan;
}

async function auditSources(Product){
  try{
    const conn=Product.db;
    const nativeDb=conn.db;
    const collections=nativeDb?(await nativeDb.listCollections({}, {nameOnly:true}).toArray()).map(x=>x.name):[];
    const movementCollection=collections.find(n=>/erpstockmovement/i.test(n))||'erpstockmovements';
    const maps=await conn.collection('erpmigrationmaps').countDocuments({source:'sige',entityType:'product'});
    const mapsPositive=await conn.collection('erpmigrationmaps').countDocuments({source:'sige',entityType:'product','details.stock':{$gt:0}});
    const movements=collections.includes(movementCollection)?await conn.collection(movementCollection).countDocuments({}):0;
    const movementPositive=collections.includes(movementCollection)?await conn.collection(movementCollection).countDocuments({after:{$gt:0}}):0;
    const movementProductsPositive=collections.includes(movementCollection)?(await conn.collection(movementCollection).distinct('productId',{after:{$gt:0}})).length:0;
    const tanquinho=await Product.find({name:/tanquinho/i}).select('_id name sku stock sellerName sellerId storefrontSource updatedAt').limit(20).lean();
    const latestMovement=collections.includes(movementCollection)?await conn.collection(movementCollection).find({after:{$gt:0}}).sort({createdAt:-1}).limit(20).project({productId:1,productName:1,sku:1,before:1,after:1,quantity:1,createdAt:1}).toArray():[];
    console.log('[stock-recovery-audit]',JSON.stringify({total:await Product.countDocuments({}),zero:await Product.countDocuments({stock:{$lte:0}}),positive:await Product.countDocuments({stock:{$gt:0}}),maps,mapsPositive,movements,movementPositive,movementProductsPositive,movementCollection,tanquinho,latestMovement,collections:collections.filter(n=>/stock|product|migration/i.test(n))}));
  }catch(error){console.error('[stock-recovery-audit] failed',error?.message||error);}
}

export default function createErpStockRecoveryRoutes(context={}){
  const router=express.Router();
  const {Product,adminRequired}=context;
  if(!Product||!adminRequired)throw new Error('[erp-stock-recovery] Product/adminRequired não informado');
  setTimeout(()=>auditSources(Product),7000);
  router.get('/erp/estoque/recuperacao-20261006/preview',adminRequired,async(_req,res)=>{try{const plan=await buildPlan(Product);return res.json({ok:true,runId:RUN_ID,count:plan.length,sample:plan.slice(0,30)});}catch(error){return res.status(500).json({ok:false,error:error?.message||'Falha ao preparar recuperação.'});}});
  router.post('/erp/estoque/recuperacao-20261006/executar',adminRequired,async(req,res)=>{try{
    if(req.body?.confirm!=='RESTORE_ARIANA_STOCK_20261006')return res.status(400).json({ok:false,error:'Confirmação inválida.'});
    const db=Product.db,journal=db.collection('erp_stock_emergency_recovery');
    const prior=await journal.findOne({_id:`run:${RUN_ID}`});if(prior?.status==='done')return res.json({ok:true,alreadyDone:true,...prior});
    const plan=await buildPlan(Product);let restored=0;
    for(const row of plan){await journal.updateOne({_id:`item:${RUN_ID}:${row.productId}`},{$setOnInsert:{...row,runId:RUN_ID,createdAt:new Date()}},{upsert:true});const r=await Product.updateOne({_id:row.productId,stock:{$lte:0}},{$set:{stock:row.after}});if(r.modifiedCount===1)restored++;}
    const totals={total:await Product.countDocuments({}),zero:await Product.countDocuments({stock:{$lte:0}}),positive:await Product.countDocuments({stock:{$gt:0}})};
    await journal.updateOne({_id:`run:${RUN_ID}`},{$set:{status:'done',finishedAt:new Date(),restored,planned:plan.length,totals}},{upsert:true});
    return res.json({ok:true,restored,planned:plan.length,totals});
  }catch(error){return res.status(500).json({ok:false,error:error?.message||'Falha ao recuperar estoque.'});}});
  return router;
}
