import express from 'express';
import { createErpLedgerService } from '../../services/erp/erpLedgerService.js';
import { createErpStockMovementService } from '../../services/erp/erpStockMovementService.js';
import { createErpReportService } from '../../services/erp/erpReportService.js';

export default function createErpManagementRoutes(context={}){
 const router=express.Router();if(!context.adminRequired)throw new Error('[erp-management] adminRequired não informado');
 const ledger=createErpLedgerService(context),stock=createErpStockMovementService(context),reports=createErpReportService(context);const actor=req=>req.admin||req.auth||req.user||{};
 const handle=(fn,status=200)=>async(req,res)=>{try{const result=await fn(req);return res.status(status).json({ok:true,...(result&&typeof result==='object'&&!Array.isArray(result)?result:{data:result})})}catch(e){console.error('[erp-management]',e);return res.status(Number(e?.statusCode||500)).json({ok:false,error:e?.message||'Erro no módulo de gestão do ERP.',code:e?.code||'ERP_MANAGEMENT_ERROR'})}};
 router.get('/erp/financeiro/categorias',context.adminRequired,handle(async req=>({categories:await ledger.categories(req.query||{})})));
 router.post('/erp/financeiro/categorias',context.adminRequired,handle(async req=>({category:await ledger.createCategory(req.body||{},actor(req))}),201));
 router.patch('/erp/financeiro/categorias/:id',context.adminRequired,handle(async req=>({category:await ledger.updateCategory(req.params.id,req.body||{},actor(req))})));
 router.get('/erp/financeiro/contas-bancarias',context.adminRequired,handle(async req=>({accounts:await ledger.banks(req.query||{})})));
 router.post('/erp/financeiro/contas-bancarias',context.adminRequired,handle(async req=>({account:await ledger.createBank(req.body||{},actor(req))}),201));
 router.patch('/erp/financeiro/contas-bancarias/:id',context.adminRequired,handle(async req=>({account:await ledger.updateBank(req.params.id,req.body||{},actor(req))})));
 router.get('/erp/financeiro/lancamentos',context.adminRequired,handle(async req=>({entries:await ledger.listEntries(req.query||{}),summary:await ledger.report(req.query||{})})));
 router.post('/erp/financeiro/contas-receber',context.adminRequired,handle(async req=>({entry:await ledger.createReceivable(req.body||{},actor(req))}),201));
 router.post('/erp/financeiro/contas-pagar',context.adminRequired,handle(async req=>({entry:await ledger.createPayable(req.body||{},actor(req))}),201));
 router.post('/erp/financeiro/lancamentos/:id/quitar',context.adminRequired,handle(async req=>({entry:await ledger.pay(req.params.id,req.body||{},actor(req))})));
 router.post('/erp/financeiro/lancamentos/:id/reabrir',context.adminRequired,handle(async req=>({entry:await ledger.unpay(req.params.id,actor(req))})));
 router.post('/erp/financeiro/lancamentos/:id/cancelar',context.adminRequired,handle(async req=>({entry:await ledger.cancel(req.params.id,actor(req))})));
 router.get('/erp/relatorios/financeiro',context.adminRequired,handle(async req=>({report:await ledger.report(req.query||{})})));
 router.get('/erp/estoque/movimentacoes',context.adminRequired,handle(async req=>({movements:await stock.list(req.query||{})})));
 router.post('/erp/estoque/:productId/movimentacoes',context.adminRequired,handle(async req=>await stock.move(req.params.productId,req.body||{},actor(req)),201));
 router.get('/erp/relatorios/vendas',context.adminRequired,handle(async req=>({report:await reports.sales(req.query||{})})));
 router.get('/erp/relatorios/estoque',context.adminRequired,handle(async req=>({report:await reports.stock(req.query||{})})));
 return router;
}
