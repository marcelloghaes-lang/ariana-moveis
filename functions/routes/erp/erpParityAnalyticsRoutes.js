import express from 'express';
import { createErpParityAnalyticsService } from '../../services/erp/erpParityAnalyticsService.js';
import { createErpLateChargeReportService } from '../../services/erp/erpLateChargeReportService.js';

const clean=(v='',m=80)=>String(v??'').trim().slice(0,m);
const identity=req=>req.adminUser||req.admin||req.auth||req.user||{};
const isFullAdmin=req=>{const u=identity(req),role=clean(u.role,40).toLowerCase();return role==='admin'||u.admin===true||u.isSuperAdmin===true};
const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();

export default function createErpParityAnalyticsRoutes(context={}){
 const router=express.Router();
 if(!context.adminRequired)throw new Error('[erp-parity] adminRequired não informado');
 const service=createErpParityAnalyticsService(context),late=createErpLateChargeReportService(context);

 router.get('/erp/financeiro/completo',context.adminRequired,async(req,res)=>{
  try{
   const data=await service.finance(req.query||{}),lateData=await late.summary();
   data.entries=late.decorateEntries(data.entries||[]);
   data.lateChargePolicy=lateData.policy;
   data.lateCharges={open:lateData.open,overdue:lateData.overdue};
   data.delinquents=lateData.delinquents;
   data.summary=data.summary||{};data.summary.receivables=data.summary.receivables||{};
   data.summary.receivables.overdue={...(data.summary.receivables.overdue||{}),updatedValue:lateData.overdue.updated,fine:lateData.overdue.fine,interest:lateData.overdue.interest};
   data.summary.receivables.pending={...(data.summary.receivables.pending||{}),updatedValue:lateData.open.updated,fine:lateData.open.fine,interest:lateData.open.interest};
   if(isFullAdmin(req))return res.json({ok:true,...data});
   return res.json({ok:true,entries:Array.isArray(data.entries)?data.entries:[],lateChargePolicy:data.lateChargePolicy,restrictedSummary:true});
  }catch(e){return res.status(Number(e?.statusCode||500)).json({ok:false,error:e?.message||'Erro ao consultar financeiro completo.',code:e?.code||'ERP_PARITY_ERROR'})}
 });

 router.get('/erp/relatorios/vendas-completo',context.adminRequired,async(req,res)=>{
  try{
   const data=await service.sales(req.query||{});
   if(isFullAdmin(req)){
    const fin=await service.finance({direction:'receivable',from:req.query?.from,to:req.query?.to});
    const rows=Array.isArray(data.sales)?data.sales:[];
    const names=new Set(rows.map(x=>norm(x.customerName)).filter(Boolean));
    const extra=(fin.entries||[])
      .filter(x=>x.origin==='sige_import'&&x.personName&&!names.has(norm(x.personName)))
      .map(x=>({
        id:String(x.id||x._id||''),source:'historico',code:x.documentNumber||x.boletoNumber||x.migration?.sourceSaleId||'Financeiro SIGE',
        date:x.competenceAt||x.dueAt,customerName:x.personName||'Consumidor',sellerName:'',total:Number(x.value||0),
        paymentMethod:x.paymentMethod||'',items:[],financeOnly:true,dueAt:x.dueAt,status:x.status,outstanding:x.outstanding
      }));
    data.sales=[...rows,...extra].sort((a,b)=>new Date(b.date||0)-new Date(a.date||0));
   }
   return res.json({ok:true,...data});
  }catch(e){return res.status(Number(e?.statusCode||500)).json({ok:false,error:e?.message||'Erro ao gerar relatórios de vendas.',code:e?.code||'ERP_PARITY_ERROR'})}
 });
 return router;
}