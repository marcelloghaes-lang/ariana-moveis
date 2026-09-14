import express from 'express';
import { createErpLedgerService } from '../../services/erp/erpLedgerService.js';
import { createErpStockMovementService } from '../../services/erp/erpStockMovementService.js';
import { createErpReportService } from '../../services/erp/erpReportService.js';
import { createErpSettingsService } from '../../services/erp/erpSettingsService.js';
import { createErpReconciliationService } from '../../services/erp/erpReconciliationService.js';
import { createErpCommissionService } from '../../services/erp/erpCommissionService.js';

const identity=req=>req.adminUser||req.admin||req.auth||req.user||{};
const isFullAdmin=req=>{const u=identity(req),role=String(u.role||'').trim().toLowerCase();return role==='admin'||u.admin===true||u.isSuperAdmin===true};
const adminOnly=req=>{if(isFullAdmin(req))return;const error=new Error('Esta informação financeira é exclusiva do administrador.');error.statusCode=403;error.code='ERP_ADMIN_FINANCE_REQUIRED';throw error};

export default function createErpManagementRoutes(context={}){
 const router=express.Router();if(!context.adminRequired)throw new Error('[erp-management] adminRequired não informado');
 const ledger=createErpLedgerService(context),stock=createErpStockMovementService(context),reports=createErpReportService(context),settings=createErpSettingsService(context),reconciliation=createErpReconciliationService(context),commissions=createErpCommissionService(context);const actor=req=>req.admin||req.auth||req.user||{};
 const handle=(fn,status=200)=>async(req,res)=>{try{const result=await fn(req);return res.status(status).json({ok:true,...(result&&typeof result==='object'&&!Array.isArray(result)?result:{data:result})})}catch(e){console.error('[erp-management]',e);return res.status(Number(e?.statusCode||500)).json({ok:false,error:e?.message||'Erro no módulo de gestão do ERP.',code:e?.code||'ERP_MANAGEMENT_ERROR'})}};
 router.get('/erp/configuracoes',context.adminRequired,handle(async()=>({settings:await settings.get()})));
 router.put('/erp/configuracoes',context.adminRequired,handle(async req=>({settings:await settings.update(req.body||{},actor(req))})));
 router.get('/erp/comissoes/regras',context.adminRequired,handle(async req=>{adminOnly(req);return{rules:await commissions.listRules()}}));
 router.put('/erp/comissoes/regras',context.adminRequired,handle(async req=>{adminOnly(req);return{rule:await commissions.upsertRule(req.body||{},identity(req))}}));
 router.get('/erp/comissoes/relatorio',context.adminRequired,handle(async req=>{adminOnly(req);return await commissions.report(req.query||{})}));
 router.get('/erp/financeiro/categorias',context.adminRequired,handle(async req=>({categories:await ledger.categories(req.query||{})})));
 router.post('/erp/financeiro/categorias',context.adminRequired,handle(async req=>({category:await ledger.createCategory(req.body||{},actor(req))}),201));
 router.patch('/erp/financeiro/categorias/:id',context.adminRequired,handle(async req=>({category:await ledger.updateCategory(req.params.id,req.body||{},actor(req))})));
 router.get('/erp/financeiro/contas-bancarias',context.adminRequired,handle(async req=>({accounts:await ledger.banks(req.query||{})})));
 router.post('/erp/financeiro/contas-bancarias',context.adminRequired,handle(async req=>({account:await ledger.createBank(req.body||{},actor(req))}),201));
 router.patch('/erp/financeiro/contas-bancarias/:id',context.adminRequired,handle(async req=>({account:await ledger.updateBank(req.params.id,req.body||{},actor(req))})));
 router.get('/erp/financeiro/lancamentos',context.adminRequired,handle(async req=>{const entries=await ledger.listEntries(req.query||{});if(!isFullAdmin(req))return{entries,restrictedSummary:true};return{entries,summary:await ledger.report(req.query||{})}}));
 router.get('/erp/financeiro/pagamentos',context.adminRequired,handle(async req=>{let payments=await ledger.listPayments(req.query||{});if(req.query?.reconciled==='true')payments=payments.filter(p=>p.reconciled===true);if(req.query?.reconciled==='false')payments=payments.filter(p=>p.reconciled!==true);return{payments}}));
 router.post('/erp/financeiro/contas-receber',context.adminRequired,handle(async req=>{await settings.assertFinanceCreate(req.body||{},'receivable');return{entry:await ledger.createReceivable(req.body||{},actor(req))}},201));
 router.post('/erp/financeiro/contas-pagar',context.adminRequired,handle(async req=>{await settings.assertFinanceCreate(req.body||{},'payable');return{entry:await ledger.createPayable(req.body||{},actor(req))}},201));
 router.patch('/erp/financeiro/lancamentos/:id',context.adminRequired,handle(async req=>{await settings.assertFinanceMutation(req.params.id,req.body||{});return{entry:await ledger.updateEntry(req.params.id,req.body||{},actor(req))}}));
 router.post('/erp/financeiro/lancamentos/:id/quitar',context.adminRequired,handle(async req=>{const body={...(req.body||{}),__operation:'pay'};await settings.assertFinanceMutation(req.params.id,body);delete body.__operation;let entry=await ledger.pay(req.params.id,body,actor(req));entry=await reconciliation.auto(entry,actor(req));return{entry}}));
 router.patch('/erp/financeiro/lancamentos/:id/pagamentos/:paymentId/conciliacao',context.adminRequired,handle(async req=>({entry:await reconciliation.setPayment(req.params.id,req.params.paymentId,req.body?.reconciled!==false,actor(req))})));
 router.post('/erp/financeiro/lancamentos/:id/reabrir',context.adminRequired,handle(async req=>{await settings.assertFinanceMutation(req.params.id,{__operation:'reopen'});return{entry:await ledger.unpay(req.params.id,actor(req))}}));
 router.post('/erp/financeiro/lancamentos/:id/cancelar',context.adminRequired,handle(async req=>{await settings.assertFinanceMutation(req.params.id,{__operation:'cancel'});return{entry:await ledger.cancel(req.params.id,actor(req))}}));
 router.get('/erp/relatorios/financeiro',context.adminRequired,handle(async req=>{adminOnly(req);return{report:await reports.financial(req.query||{})}}));
 router.get('/erp/estoque/movimentacoes',context.adminRequired,handle(async req=>({movements:await stock.list(req.query||{})})));
 router.post('/erp/estoque/:productId/movimentacoes',context.adminRequired,handle(async req=>await stock.move(req.params.productId,req.body||{},actor(req)),201));
 router.get('/erp/relatorios/vendas',context.adminRequired,handle(async req=>({report:await reports.sales(req.query||{})})));
 router.get('/erp/relatorios/estoque',context.adminRequired,handle(async req=>({report:await reports.stock(req.query||{})})));
 return router;
}