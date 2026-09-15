import express from 'express';
import { createErpFinancePanelBridgeService } from '../../services/erp/erpFinancePanelBridgeService.js';

const actor=req=>req.adminUser||req.admin||req.auth||req.user||{};

export default function createErpFinancePanelBridgeRoutes(context={}){
  const router=express.Router();
  if(!context.adminRequired)throw new Error('[erp-finance-panel] adminRequired não informado');
  const bridge=createErpFinancePanelBridgeService(context);
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
  router.get('/erp/finance-panel/inadimplentes',context.adminRequired,handle(req=>bridge.inadimplentes(req.query||{})));
  router.get('/erp/finance-panel/dashboard',context.adminRequired,handle(req=>bridge.dashboard(req.query||{})));
  router.post('/erp/finance-panel/lancamentos/:orderId/:number/pagamentos',context.adminRequired,handle(req=>bridge.receber(req.params.orderId,req.params.number,req.body||{},actor(req))));

  return router;
}
