import express from 'express';
import multer from 'multer';
import { createErpSigeMasterDataImportService } from '../../services/erp/erpSigeMasterDataImportService.js';

const upload=multer({storage:multer.memoryStorage(),limits:{files:1,fileSize:16*1024*1024}});
function actor(req={}){const u=req.adminUser||req.user||{};return{name:u.name||u.nome||'',email:u.email||'',id:String(u._id||u.id||'')}}

export default function createErpSigeMasterDataRoutes(context={}){
  const router=express.Router();
  if(!context.adminRequired)throw new Error('[erp-sige-master-data] adminRequired não informado');
  const service=createErpSigeMasterDataImportService(context);
  router.get('/erp/migracao/sige/import/status',context.adminRequired,async(_req,res)=>{try{return res.json({ok:true,import:await service.status()})}catch(error){console.error('[erp-sige-master-data/status]',error?.message||error);return res.status(Number(error?.statusCode||500)).json({ok:false,error:error?.message||'Erro ao consultar migração.',code:error?.code||'ERP_SIGE_IMPORT_ERROR'})}});
  router.post('/erp/migracao/sige/import/master-data',context.adminRequired,upload.single('package'),async(req,res)=>{try{const result=await service.importMasterData(req.file||null,String(req.body?.confirmation||''),actor(req));return res.json({ok:true,result})}catch(error){console.error('[erp-sige-master-data/import]',error?.code||'',error?.message||error);return res.status(Number(error?.statusCode||500)).json({ok:false,error:error?.message||'Erro ao importar cadastros mestres.',code:error?.code||'ERP_SIGE_IMPORT_ERROR'})}});
  router.use((error,_req,res,next)=>{if(!(error instanceof multer.MulterError))return next(error);return res.status(error.code==='LIMIT_FILE_SIZE'?413:400).json({ok:false,error:error.code==='LIMIT_FILE_SIZE'?'O ZIP excede o limite seguro de 16 MB.':'Falha ao receber o pacote do SIGE.',code:`SIGE_IMPORT_UPLOAD_${error.code||'ERROR'}`})});
  return router;
}
