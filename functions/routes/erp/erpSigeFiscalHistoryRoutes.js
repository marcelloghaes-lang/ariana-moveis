import express from 'express';
import multer from 'multer';
import { createErpSigeFiscalHistoryService } from '../../services/erp/erpSigeFiscalHistoryService.js';

const upload=multer({storage:multer.memoryStorage(),limits:{files:1,fileSize:4*1024*1024}});
const actor=req=>{const u=req.adminUser||req.user||{};return{name:u.name||u.nome||'',email:u.email||'',id:String(u._id||u.id||'')}};
const safeFilePart=(value='')=>String(value||'').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,100)||'documento';

export default function createErpSigeFiscalHistoryRoutes(context={}){
  const router=express.Router();
  if(!context.adminRequired)throw new Error('[erp-sige-fiscal] adminRequired não informado');
  const service=createErpSigeFiscalHistoryService();
  router.get('/erp/migracao/sige/fiscal/status',context.adminRequired,async(_req,res)=>{try{return res.json({ok:true,fiscal:await service.status()})}catch(e){return res.status(Number(e?.statusCode||500)).json({ok:false,error:e?.message||'Erro ao consultar migração fiscal.',code:e?.code||'ERP_SIGE_FISCAL_ERROR'})}});
  router.post('/erp/migracao/sige/fiscal/dry-run',context.adminRequired,upload.single('package'),async(req,res)=>{try{return res.json({ok:true,preview:await service.preview(req.file||null)})}catch(e){return res.status(Number(e?.statusCode||500)).json({ok:false,error:e?.message||'Erro ao analisar pacote fiscal.',code:e?.code||'ERP_SIGE_FISCAL_ERROR'})}});
  router.post('/erp/migracao/sige/fiscal/import',context.adminRequired,upload.single('package'),async(req,res)=>{try{const result=await service.startImport(req.file||null,String(req.body?.confirmation||''),actor(req));return res.status(result.status==='completed'?200:202).json({ok:true,result})}catch(e){return res.status(Number(e?.statusCode||500)).json({ok:false,error:e?.message||'Erro ao iniciar importação fiscal.',code:e?.code||'ERP_SIGE_FISCAL_ERROR'})}});
  router.get('/erp/fiscal/historico/nfe',context.adminRequired,async(req,res)=>{try{return res.json({ok:true,history:await service.list(req.query||{})})}catch(e){return res.status(Number(e?.statusCode||500)).json({ok:false,error:e?.message||'Erro ao listar NF-e históricas.',code:e?.code||'ERP_FISCAL_HISTORY_ERROR'})}});
  router.get('/erp/fiscal/historico/nfe/:id/xml',context.adminRequired,async(req,res)=>{try{const doc=await service.detail(req.params.id);const xml=String(doc?.xml||'').trim();if(!xml)return res.status(404).json({ok:false,error:'XML original não está disponível para esta NF-e.',code:'ERP_FISCAL_XML_NOT_FOUND'});const number=safeFilePart(doc?.number||'sem-numero');const key=safeFilePart(doc?.key||doc?.sourceId||'sem-chave');const filename=`NFe-${number}-${key}.xml`;res.setHeader('Content-Type','application/xml; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);res.setHeader('Cache-Control','private, no-store');return res.status(200).send(xml)}catch(e){return res.status(Number(e?.statusCode||500)).json({ok:false,error:e?.message||'Erro ao baixar XML da NF-e histórica.',code:e?.code||'ERP_FISCAL_HISTORY_ERROR'})}});
  router.get('/erp/fiscal/historico/nfe/:id',context.adminRequired,async(req,res)=>{try{return res.json({ok:true,document:await service.detail(req.params.id)})}catch(e){return res.status(Number(e?.statusCode||500)).json({ok:false,error:e?.message||'Erro ao consultar NF-e histórica.',code:e?.code||'ERP_FISCAL_HISTORY_ERROR'})}});
  router.use((error,_req,res,next)=>{if(!(error instanceof multer.MulterError))return next(error);return res.status(error.code==='LIMIT_FILE_SIZE'?413:400).json({ok:false,error:error.code==='LIMIT_FILE_SIZE'?'O ZIP fiscal excede 4 MB.':'Falha ao receber o pacote fiscal.',code:`SIGE_FISCAL_UPLOAD_${error.code||'ERROR'}`})});
  return router;
}
