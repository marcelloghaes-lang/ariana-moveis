import express from 'express';
import { createErpLedgerService } from '../../services/erp/erpLedgerService.js';
import { createErpStockMovementService } from '../../services/erp/erpStockMovementService.js';
import { createErpReportService } from '../../services/erp/erpReportService.js';
import { createErpSettingsService } from '../../services/erp/erpSettingsService.js';
import { requireErpPermission, erpAccessSummary } from '../../services/erp/erpAccessControl.js';

export default function createErpManagementRoutes(context={}){
 const router=express.Router();if(!context.adminRequired)throw new Error('[erp-management] adminRequired não informado');
 const ledger=createErpLedgerService(context),stock=createErpStockMovementService(context),reports=createErpReportService(context),settings=createErpSettingsService(context);const actor=req=>req.admin||req.auth||req.user||{};
 const handle=(fn,status=200)=>async(req,res)=>{try{const result=await fn(req);return res.status(status).json({ok:true,...(result&&typeof result==='object'&&!Array.isArray(result)?result:{data:result})})}catch(e){console.error('[erp-management]',e);return res.status(Number(e?.statusCode||500)).json({ok:false,error:e?.message||'Erro no módulo de gestão do ERP.',code:e?.code||'ERP_MANAGEMENT_ERROR'})}};
 const guard=(permissions,label)=>requireErpPermission(permissions,label);

 router.get('/erp/acesso',context.adminRequired,handle(async req=>({access:erpAccessSummary(req)})));
 router.get('/erp/configuracoes',context.adminRequired,guard(['settings:read','settings:update'],'visualizar as configurações do ERP'),handle(async()=>({settings:await settings.get()})));
 router.put('/erp/configuracoes',context.adminRequired,guard(['settings:update'],'alterar as configurações do ERP'),handle(async req=>({settings:await settings.update(req.body||{},actor(req))})));

 router.get('/erp/financeiro/categorias',context.adminRequired,guard(['finance:read','settings:read','settings:update'],'visualizar o plano de contas'),handle(async req=>({categories:await ledger.categories(req.query||{})})));
 router.post('/erp/financeiro/categorias',context.adminRequired,guard(['settings:update'],'cadastrar categorias financeiras'),handle(async req=>({category:await ledger.createCategory(req.body||{},actor(req))}),201));
 router.patch('/erp/financeiro/categorias/:id',context.adminRequired,guard(['settings:update'],'editar categorias financeiras'),handle(async req=>({category:await ledger.updateCategory(req.params.id,req.body||{},actor(req))})));
 router.get('/erp/financeiro/contas-bancarias',context.adminRequired,guard(['finance:read','payments:read','settings:read','settings:update'],'visualizar contas bancárias'),handle(async req=>({accounts:await ledger.banks(req.query||{})})));
 router.post('/erp/financeiro/contas-bancarias',context.adminRequired,guard(['settings:update'],'cadastrar contas bancárias'),handle(async req=>({account:await ledger.createBank(req.body||{},actor(req))}),201));
 router.patch('/erp/financeiro/contas-bancarias/:id',context.adminRequired,guard(['settings:update'],'editar contas bancárias'),handle(async req=>({account:await ledger.updateBank(req.params.id,req.body||{},actor(req))})));
 router.get('/erp/financeiro/lancamentos',context.adminRequired,guard(['finance:read','payments:read'],'visualizar lançamentos financeiros'),handle(async req=>({entries:await ledger.listEntries(req.query||{}),summary:await ledger.report(req.query||{})})));
 router.get('/erp/financeiro/pagamentos',context.adminRequired,guard(['payments:read','finance:read'],'visualizar pagamentos'),handle(async req=>({payments:await ledger.listPayments(req.query||{})})));
 router.post('/erp/financeiro/contas-receber',context.adminRequired,guard(['payments:receive'],'criar contas a receber'),handle(async req=>{await settings.assertFinanceCreate(req.body||{},'receivable');return{entry:await ledger.createReceivable(req.body||{},actor(req))}},201));
 router.post('/erp/financeiro/contas-pagar',context.adminRequired,guard(['payments:receive'],'criar contas a pagar'),handle(async req=>{await settings.assertFinanceCreate(req.body||{},'payable');return{entry:await ledger.createPayable(req.body||{},actor(req))}},201));
 router.patch('/erp/financeiro/lancamentos/:id',context.adminRequired,guard(['payments:receive'],'editar lançamentos financeiros'),handle(async req=>{await settings.assertFinanceMutation(req.params.id,req.body||{});return{entry:await ledger.updateEntry(req.params.id,req.body||{},actor(req))}}));
 router.post('/erp/financeiro/lancamentos/:id/quitar',context.adminRequired,guard(['payments:receive'],'registrar baixas financeiras'),handle(async req=>{const body={...(req.body||{}),__operation:'pay'};await settings.assertFinanceMutation(req.params.id,body);delete body.__operation;return{entry:await ledger.pay(req.params.id,body,actor(req))}}));
 router.post('/erp/financeiro/lancamentos/:id/reabrir',context.adminRequired,guard(['payments:cancel'],'reabrir lançamentos financeiros'),handle(async req=>{await settings.assertFinanceMutation(req.params.id,{__operation:'reopen'});return{entry:await ledger.unpay(req.params.id,actor(req))}}));
 router.post('/erp/financeiro/lancamentos/:id/cancelar',context.adminRequired,guard(['payments:cancel'],'cancelar lançamentos financeiros'),handle(async req=>{await settings.assertFinanceMutation(req.params.id,{__operation:'cancel'});return{entry:await ledger.cancel(req.params.id,actor(req))}}));

 router.get('/erp/relatorios/financeiro',context.adminRequired,guard(['reports:read','finance:reports'],'visualizar relatórios financeiros'),handle(async req=>({report:await reports.financial(req.query||{})})));
 router.get('/erp/estoque/movimentacoes',context.adminRequired,guard(['products:read'],'visualizar movimentações de estoque'),handle(async req=>({movements:await stock.list(req.query||{})})));
 router.post('/erp/estoque/:productId/movimentacoes',context.adminRequired,guard(['products:update'],'movimentar o estoque'),handle(async req=>await stock.move(req.params.productId,req.body||{},actor(req)),201));
 router.get('/erp/relatorios/vendas',context.adminRequired,guard(['reports:read','orders:read'],'visualizar relatórios de vendas'),handle(async req=>({report:await reports.sales(req.query||{})})));
 router.get('/erp/relatorios/estoque',context.adminRequired,guard(['reports:read','products:read'],'visualizar relatórios de estoque'),handle(async req=>({report:await reports.stock(req.query||{})})));
 return router;
}
