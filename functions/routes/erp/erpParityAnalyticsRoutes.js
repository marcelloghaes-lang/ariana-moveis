import express from 'express';
import { createErpParityAnalyticsService } from '../../services/erp/erpParityAnalyticsService.js';
import { requireErpPermission } from '../../services/erp/erpAccessControl.js';

export default function createErpParityAnalyticsRoutes(context={}){
 const router=express.Router();if(!context.adminRequired)throw new Error('[erp-parity] adminRequired não informado');const service=createErpParityAnalyticsService(context);
 const financeRead=requireErpPermission(['finance:read','finance:reports','reports:read'],'visualizar análises financeiras');
 const salesRead=requireErpPermission(['orders:read','reports:read'],'visualizar análises de vendas');
 router.get('/erp/financeiro/completo',context.adminRequired,financeRead,async(req,res)=>{try{return res.json({ok:true,...await service.finance(req.query||{})})}catch(e){return res.status(Number(e?.statusCode||500)).json({ok:false,error:e?.message||'Erro ao consultar financeiro completo.',code:e?.code||'ERP_PARITY_ERROR'})}});
 router.get('/erp/relatorios/vendas-completo',context.adminRequired,salesRead,async(req,res)=>{try{return res.json({ok:true,...await service.sales(req.query||{})})}catch(e){return res.status(Number(e?.statusCode||500)).json({ok:false,error:e?.message||'Erro ao gerar relatórios de vendas.',code:e?.code||'ERP_PARITY_ERROR'})}});
 return router;
}
