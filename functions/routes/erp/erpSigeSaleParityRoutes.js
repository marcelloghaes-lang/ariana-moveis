import express from 'express';
import { createErpSigeSaleParityService } from '../../services/erp/erpSigeSaleParityService.js';
import { createErpFinanceService } from '../../services/erp/erpFinanceService.js';

export default function createErpSigeSaleParityRoutes(context={}){
 const router=express.Router();
 if(!context.adminRequired)throw new Error('[erp-sige-sale] adminRequired não informado');
 const service=createErpSigeSaleParityService(context),finance=createErpFinanceService(context),actor=req=>req.admin||req.auth||req.user||{};
 const handle=fn=>async(req,res)=>{try{return res.json({ok:true,...await fn(req)})}catch(e){console.error('[erp-sige-sale]',e);return res.status(Number(e?.statusCode||500)).json({ok:false,error:e?.message||'Erro ao atualizar a venda.',code:e?.code||'ERP_SIGE_SALE_ERROR'})}};
 router.patch('/erp/orders/:orderId/receivables/:number',context.adminRequired,handle(req=>service.updateReceivable(req.params.orderId,req.params.number,req.body||{},actor(req))));
 router.patch('/erp/orders/:orderId/sige-fields',context.adminRequired,handle(req=>service.updateSigeFields(req.params.orderId,req.body||{},actor(req))));
 router.post('/erp/financeiro/recebimentos/quitar-selecionados',context.adminRequired,handle(req=>finance.settleSelected(req.body?.items||[],req.body||{},actor(req))));
 router.post('/erp/financeiro/recebimentos/distribuir-cliente',context.adminRequired,handle(req=>finance.allocateByCustomer(req.body?.items||[],req.body||{},actor(req))));
 return router;
}
