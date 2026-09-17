import express from 'express';
import { createErpFinancePanelBridgeService } from '../../services/erp/erpFinancePanelBridgeService.js';
import { createErpCollectionWorkflowService } from '../../services/erp/erpCollectionWorkflowService.js';
import { createErpCarneService } from '../../services/erp/erpCarneService.js';

const actor=req=>req.adminUser||req.admin||req.auth||req.user||{};

export default function createErpFinancePanelBridgeRoutes(context={}){
  const router=express.Router();
  if(!context.adminRequired)throw new Error('[erp-finance-panel] adminRequired não informado');
  const bridge=createErpFinancePanelBridgeService(context);
  const collections=createErpCollectionWorkflowService(context);
  const carne=createErpCarneService(context);
  const handle=(action,status=200)=>async(req,res)=>{
    try{
      const result=await action(req);
      return res.status(status).json({ok:true,...(result||{})});
    }catch(error){
      console.error('[erp-finance-panel]',error?.message||error);
      return res.status(Number(error?.statusCode||500)).json({
        ok:false,
        error:error?.message||'Erro ao consultar o Financeiro Ariana no ERP.',
        code:error?.code||'ERP_FINANCE_PANEL_ERROR'
      });
    }
  };

  router.get('/erp/finance-panel/clientes',context.adminRequired,handle(req=>bridge.clientes(req.query||{})));
  router.get('/erp/finance-panel/lancamentos',context.adminRequired,handle(req=>bridge.lancamentos(req.query||{})));
  router.get('/erp/finance-panel/inadimplentes',context.adminRequired,handle(req=>{
    const view=String(req.query?.view||'').trim().toLowerCase();
    if(view==='fila'||view==='fila-do-dia')return collections.fila(req.query||{});
    if(view==='promessas')return collections.promessas(req.query||{});
    if(view==='recuperacao')return collections.recuperacao(req.query||{});
    return bridge.inadimplentes(req.query||{});
  }));
  router.get('/erp/finance-panel/dashboard',context.adminRequired,handle(req=>bridge.dashboard(req.query||{})));
  router.post('/erp/finance-panel/lancamentos/:orderId/:number/pagamentos',context.adminRequired,handle(req=>{
    const action=String(req.body?.action||'').trim().toLowerCase();
    if(action)return collections.registrarAcao(req.body?.targetId||req.params.orderId,req.body||{},actor(req));
    return bridge.receber(req.params.orderId,req.params.number,req.body||{},actor(req));
  }));

  router.get('/erp/finance-panel/carne/preview',context.adminRequired,handle(req=>carne.preview(req.query?.targetId||'',req.query?.via||'')));
  router.get('/erp/finance-panel/carne/pdf',context.adminRequired,async(req,res)=>{
    try{
      const result=await carne.pdf(req.query?.targetId||'',req.query?.via||'',actor(req));
      res.setHeader('Content-Type','application/pdf');
      res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`);
      res.setHeader('Cache-Control','private, no-store, max-age=0');
      return res.status(200).send(result.buffer);
    }catch(error){
      console.error('[erp-finance-panel][carne-pdf]',error?.message||error);
      return res.status(Number(error?.statusCode||500)).json({ok:false,error:error?.message||'Não foi possível gerar o carnê.',code:error?.code||'ERP_CARNE_PDF_ERROR'});
    }
  });
  router.post('/erp/finance-panel/carne/enviar',context.adminRequired,handle(req=>carne.send(req.body?.targetId||'',req.body||{},actor(req)),201));

  return router;
}
