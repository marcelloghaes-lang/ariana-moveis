import express from 'express';
import { createErpDelinquencyReportService } from '../../services/erp/erpDelinquencyReportService.js';

export default function createErpDelinquencyReportRoutes(context={}){
  const router=express.Router();
  if(!context.adminRequired)throw new Error('[erp-delinquency-routes] adminRequired não informado');
  const service=createErpDelinquencyReportService(context);
  const handle=fn=>async(req,res)=>{try{return await fn(req,res)}catch(e){console.error('[erp-delinquency]',e);return res.status(Number(e?.statusCode||500)).json({ok:false,error:e?.message||'Erro ao gerar relatório de inadimplentes.',code:e?.code||'ERP_DELINQUENCY_ERROR'})}};

  router.get('/erp/relatorios/inadimplentes',context.adminRequired,handle(async(req,res)=>{
    const report=await service.report(req.query||{});
    return res.json({ok:true,report});
  }));

  router.get('/erp/relatorios/inadimplentes/pdf',context.adminRequired,handle(async(req,res)=>{
    const result=await service.pdf(req.query||{});
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition',`attachment; filename="${result.filename}"`);
    res.setHeader('Cache-Control','private, no-store');
    return res.status(200).send(result.buffer);
  }));

  return router;
}
