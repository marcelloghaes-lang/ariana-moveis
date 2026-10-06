const RUN_ID='2026-10-06-stock-incident-v1';
const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
const clean=(v='')=>String(v??'').trim();
const normalize=(v='')=>clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');

function isExternalProduct(product={}){
  const sku=clean(product.sku).toUpperCase();
  const source=normalize(product.storefrontSource||product?.logistics?.source||product?.dropshipping?.provider||'');
  if(sku.startsWith('DSLITE-')||source==='dslite')return true;
  const seller=normalize(`${product.sellerId||''} ${product.sellerName||''}`);
  if(!seller)return false;
  return !(seller.includes('ariana')||seller.includes('marcelo_nunes'));
}

export function scheduleEmergencyStockRecovery(context={}){
  const Product=context.Product;
  if(!Product)return;
  setTimeout(async()=>{
    const db=Product.db;
    const recovery=db.collection('erp_stock_emergency_recovery');
    try{
      const already=await recovery.findOne({_id:`run:${RUN_ID}`});
      if(already?.status==='done'){
        console.log('[stock-recovery] already-done',JSON.stringify({runId:RUN_ID,restored:already.restored||0,unresolved:already.unresolved||0}));
        return;
      }
      await recovery.updateOne({_id:`run:${RUN_ID}`},{$set:{status:'running',startedAt:new Date(),runId:RUN_ID}},{upsert:true});

      const maps=db.collection('erpmigrationmaps');
      const movements=db.collection('erpstockmovements');
      const candidates=await maps.find({source:'sige',entityType:'product','details.stock':{$gt:0}}).project({targetId:1,sourceId:1,details:1,importedAt:1}).toArray();
      let restored=0,skippedPositive=0,skippedExternal=0,missingProduct=0,unresolved=0;
      const samples=[];

      for(const map of candidates){
        const targetId=clean(map.targetId);
        if(!targetId)continue;
        let product=null;
        try{product=await Product.findById(targetId).lean();}catch{}
        if(!product){missingProduct++;continue;}
        const current=Math.max(0,Number(product.stock||0));
        if(current>0){skippedPositive++;continue;}
        if(isExternalProduct(product)){skippedExternal++;continue;}

        const snapshotStock=Math.max(0,Math.floor(Number(map?.details?.stock||0)));
        const latestMovement=await movements.find({productId:targetId,after:{$gt:0}}).sort({createdAt:-1}).limit(1).next().catch(()=>null);
        const movementStock=Math.max(0,Math.floor(Number(latestMovement?.after||0)));
        const restoreTo=movementStock>0?movementStock:snapshotStock;
        if(restoreTo<=0){unresolved++;continue;}

        const backup={
          runId:RUN_ID,productId:targetId,name:clean(product.name),sku:clean(product.sku),before:current,after:restoreTo,
          source:movementStock>0?'latest_erp_stock_movement':'sige_migration_snapshot',sourceId:clean(map.sourceId),
          sourceMovementId:latestMovement?String(latestMovement._id):'',createdAt:new Date()
        };
        await recovery.updateOne({_id:`item:${RUN_ID}:${targetId}`},{$setOnInsert:backup},{upsert:true});
        const result=await Product.updateOne({_id:product._id,stock:{$lte:0}},{$set:{stock:restoreTo}});
        if(result.modifiedCount===1){
          restored++;
          if(samples.length<20)samples.push({id:targetId,name:clean(product.name),sku:clean(product.sku),stock:restoreTo,source:backup.source});
        }
      }

      const totals={total:await Product.countDocuments({}),zero:await Product.countDocuments({stock:{$lte:0}}),positive:await Product.countDocuments({stock:{$gt:0}})};
      await recovery.updateOne({_id:`run:${RUN_ID}`},{$set:{status:'done',finishedAt:new Date(),restored,skippedPositive,skippedExternal,missingProduct,unresolved,candidates:candidates.length,totals,samples}});
      console.log('[stock-recovery] done',JSON.stringify({runId:RUN_ID,restored,skippedPositive,skippedExternal,missingProduct,unresolved,candidates:candidates.length,totals,samples}));
    }catch(error){
      try{await recovery.updateOne({_id:`run:${RUN_ID}`},{$set:{status:'failed',failedAt:new Date(),error:clean(error?.message||error)}} ,{upsert:true});}catch{}
      console.error('[stock-recovery] failed',error?.stack||error?.message||error);
    }
  },12000);
}

export default scheduleEmergencyStockRecovery;
