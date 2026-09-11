import express from 'express';
import multer from 'multer';
import { createErpSigeHistoryImportService } from '../../services/erp/erpSigeHistoryImportService.js';

const upload=multer({storage:multer.memoryStorage(),limits:{files:1,fileSize:8*1024*1024}});
const actor=req=>{const u=req.adminUser||req.user||{};return{name:u.name||u.nome||'',email:u.email||'',id:String(u._id||u.id||'')}};

export default function createErpSigeHistoryRoutes(context={}){
 const router=express.Router();if(!context.adminRequired)throw new Error('[erp-sige-history] adminRequired não informado');const service=createErpSigeHistoryImportService();
 router.get('/erp/migracao/sige/historico/status',context.adminRequired,async(_req,res)=>{try{return res.json({ok:true,history:await service.status()})}catch(e){return res.status(Number(e?.statusCode||500)).json({ok:false,error:e?.message||'Erro ao consultar histórico.',code:e?.code||'ERP_SIGE_HISTORY_ERROR'})}});
 router.post('/erp/migracao/sige/historico/dry-run',context.adminRequired,upload.single('package'),async(req,res)=>{try{return res.json({ok:true,preview:await service.preview(req.file||null)})}catch(e){return res.status(Number(e?.statusCode||500)).json({ok:false,error:e?.message||'Erro ao analisar histórico.',code:e?.code||'ERP_SIGE_HISTORY_ERROR'})}});
 router.post('/erp/migracao/sige/historico/import',context.adminRequired,upload.single('package'),async(req,res)=>{try{const result=await service.startImport(req.file||null,String(req.body?.confirmation||''),actor(req));return res.status(202).json({ok:true,result})}catch(e){return res.status(Number(e?.statusCode||500)).json({ok:false,error:e?.message||'Erro ao iniciar importação histórica.',code:e?.code||'ERP_SIGE_HISTORY_ERROR'})}});
 router.use((error,_req,res,next)=>{if(!(error instanceof multer.MulterError))return next(error);return res.status(error.code==='LIMIT_FILE_SIZE'?413:400).json({ok:false,error:error.code==='LIMIT_FILE_SIZE'?'O ZIP histórico excede 8 MB.':'Falha ao receber o pacote histórico.',code:`SIGE_HISTORY_UPLOAD_${error.code||'ERROR'}`})});
 return router;
}
