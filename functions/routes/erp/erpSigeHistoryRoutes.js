import express from 'express';
import multer from 'multer';
import { createErpSigeHistoryImportService } from '../../services/erp/erpSigeHistoryImportService.js';

const upload=multer({storage:multer.memoryStorage(),limits:{files:1,fileSize:8*1024*1024}});
const actor=req=>{const u=req.adminUser||req.user||{};return{name:u.name||u.nome||'',email:u.email||'',id:String(u._id||u.id||'')}};

export default function createErpSigeHistoryRoutes(context={}){
  const router=express.Router();
  if(!context.adminRequired)throw new Error('[erp-sige-history] adminRequired não informado');
  const service=createErpSigeHistoryImportService(context);
  let activeJob=null;
  router.get('/erp/migracao/sige/history/status',context.adminRequired,async(_req,res)=>{try{return res.json({ok:true,history:{...(await service.status()),serverJob:activeJob?{active:true,...activeJob}:{active:false}}})}catch(error){console.error('[erp-sige-history/status]',error?.message||error);return res.status(500).json({ok:false,error:error?.message||'Erro ao consultar Etapa 2.'})}});
  router.post('/erp/migracao/sige/history/preview',context.adminRequired,upload.single('package'),async(req,res)=>{try{return res.json({ok:true,preview:await service.preview(req.file||null)})}catch(error){return res.status(Number(error?.statusCode||500)).json({ok:false,error:error?.message||'Erro ao analisar Etapa 2.',code:error?.code||'ERP_SIGE_HISTORY_ERROR'})}});
  router.post('/erp/migracao/sige/history/import',context.adminRequired,upload.single('package'),async(req,res)=>{try{const confirmation=String(req.body?.confirmation||'');if(confirmation!=='IMPORTAR_HISTORICO_SIGE')return res.status(409).json({ok:false,error:'Confirmação da Etapa 2 inválida.'});if(!req.file?.buffer)return res.status(400).json({ok:false,error:'Selecione o ZIP da Etapa 2.'});if(activeJob)return res.status(202).json({ok:true,accepted:true,alreadyRunning:true,message:'A Etapa 2 já está sendo processada.'});const file={...req.file,buffer:Buffer.from(req.file.buffer)},who=actor(req);activeJob={startedAt:new Date().toISOString(),packageName:String(file.originalname||'sige_historico.zip').slice(0,255)};res.status(202).json({ok:true,accepted:true,message:'Etapa 2 aceita e iniciada em segundo plano.',startedAt:activeJob.startedAt});setImmediate(async()=>{try{await service.importHistory(file,confirmation,who)}catch(error){console.error('[erp-sige-history/background]',error?.code||'',error?.message||error)}finally{activeJob=null}});return}catch(error){if(res.headersSent)return;return res.status(Number(error?.statusCode||500)).json({ok:false,error:error?.message||'Erro ao iniciar Etapa 2.'})}});
  router.use((error,_req,res,next)=>{if(!(error instanceof multer.MulterError))return next(error);return res.status(error.code==='LIMIT_FILE_SIZE'?413:400).json({ok:false,error:error.code==='LIMIT_FILE_SIZE'?'O ZIP da Etapa 2 excede 8 MB.':'Falha ao receber o ZIP da Etapa 2.'})});
  return router;
}
