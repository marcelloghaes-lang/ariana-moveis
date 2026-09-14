import express from 'express';
import { createErpParityAnalyticsService } from '../../services/erp/erpParityAnalyticsService.js';

const clean=(v='',m=80)=>String(v??'').trim().slice(0,m);
const identity=req=>req.adminUser||req.admin||req.auth||req.user||{};
const isFullAdmin=req=>{const u=identity(req),role=clean(u.role,40).toLowerCase();return role==='admin'||u.admin===true||u.isSuperAdmin===true};

export default function createErpParityAnalyticsRoutes(context={}){
 const router=express.Router();
 if(!context.adminRequired)throw new Error('[erp-parity] adminRequired não informado');
 const service=createErpParityAnalyticsService(context);

 router.get('/erp/financeiro/completo',context.adminRequired,async(req,res)=>{
  try{
   const data=await service.finance(req.query||{});
   if(isFullAdmin(req))return res.json({ok:true,...data});
   // Colaboradores podem consultar e operar cobranças individuais, mas não recebem
   // totais consolidados, inadimplência geral, fluxo de caixa ou análises da empresa.
   return res.json({ok:true,entries:Array.isArray(data.entries)?data.entries:[],restrictedSummary:true});
  }catch(e){return res.status(Number(e?.statusCode||500)).json({ok:false,error:e?.message||'Erro ao consultar financeiro completo.',code:e?.code||'ERP_PARITY_ERROR'})}
 });

 router.get('/erp/relatorios/vendas-completo',context.adminRequired,async(req,res)=>{
  try{return res.json({ok:true,...await service.sales(req.query||{})})}
  catch(e){return res.status(Number(e?.statusCode||500)).json({ok:false,error:e?.message||'Erro ao gerar relatórios de vendas.',code:e?.code||'ERP_PARITY_ERROR'})}
 });
 return router;
}