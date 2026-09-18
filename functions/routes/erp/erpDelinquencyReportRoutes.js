import express from 'express';
import { createErpDelinquencyReportService } from '../../services/erp/erpDelinquencyReportService.js';
import { createErpCollectionPdfService } from '../../services/erp/erpCollectionPdfService.js';
import { createErpDelinquencyChargeService } from '../../services/erp/erpDelinquencyChargeService.js';

const identity=req=>req.adminUser||req.admin||req.auth||req.user||{};
const isFullAdmin=req=>{const u=identity(req),role=String(u.role||'').trim().toLowerCase();return role==='admin'||u.admin===true||u.isSuperAdmin===true};

export default function createErpDelinquencyReportRoutes(context={}){
  const router=express.Router();
  if(!context.adminRequired)throw new Error('[erp-delinquency-routes] adminRequired não informado');
  const service=createErpDelinquencyReportService(context);
  const collectionPdf=createErpCollectionPdfService(context);
  const charge=createErpDelinquencyChargeService(context);
  const handle=fn=>async(req,res)=>{try{return await fn(req,res)}catch(e){console.error('[erp-delinquency]',e);return res.status(Number(e?.statusCode||500)).json({ok:false,error:e?.message||'Erro ao gerar relatório financeiro.',code:e?.code||'ERP_DELINQUENCY_ERROR'})}};

  router.get('/erp/relatorios/inadimplentes',context.adminRequired,handle(async(req,res)=>{
    const report=await service.report(req.query||{});
    return res.json({ok:true,report});
  }));

  router.get('/erp/relatorios/inadimplentes/cobranca/:targetId/preview',context.adminRequired,handle(async(req,res)=>{
    const preview=await charge.preview(req.params.targetId,req.query?.template||'visita');
    return res.json({ok:true,preview});
  }));

  router.post('/erp/relatorios/inadimplentes/cobranca/:targetId/contato',context.adminRequired,handle(async(req,res)=>{
    const result=await charge.saveContact(req.params.targetId,req.body||{},identity(req));
    return res.json({ok:true,...result});
  }));

  router.post('/erp/relatorios/inadimplentes/cobranca/:targetId/enviar',context.adminRequired,handle(async(req,res)=>{
    const result=await charge.send(req.params.targetId,req.body||{},identity(req));
    return res.status(201).json({ok:true,...result});
  }));

  router.get('/erp/relatorios/inadimplentes/pdf',context.adminRequired,handle(async(req,res)=>{
    const type=String(req.query?.type||'inadimplentes').trim().toLowerCase();
    if((type==='financeiro'||type==='gerencial')&&!isFullAdmin(req))return res.status(403).json({ok:false,error:'O relatório financeiro gerencial consolidado é exclusivo do administrador.',code:'ERP_ADMIN_FINANCE_REQUIRED'});
    const result=type==='inadimplentes'?await service.pdf(req.query||{}):await collectionPdf.generate(type,req.query||{});
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition',`attachment; filename="${result.filename}"`);
    res.setHeader('Cache-Control','private, no-store');
    return res.status(200).send(result.buffer);
  }));

  return router;
}
