import express from 'express';
import { createErpParityAnalyticsService } from '../../services/erp/erpParityAnalyticsService.js';

export default function createErpParityAnalyticsRoutes(context={}){
 const router=express.Router();if(!context.adminRequired)throw new Error('[erp-parity] adminRequired não informado');const service=createErpParityAnalyticsService(context);
 router.get('/erp/financeiro/completo',context.adminRequired,async(req,res)=>{try{return res.json({ok:true,...await service.finance(req.query||{})})}catch(e){return res.status(Number(e?.statusCode||500)).json({ok:false,error:e?.message||'Erro ao consultar financeiro completo.',code:e?.code||'ERP_PARITY_ERROR'})}});
 router.get('/erp/relatorios/vendas-completo',context.adminRequired,async(req,res)=>{try{return res.json({ok:true,...await service.sales(req.query||{})})}catch(e){return res.status(Number(e?.statusCode||500)).json({ok:false,error:e?.message||'Erro ao gerar relatórios de vendas.',code:e?.code||'ERP_PARITY_ERROR'})}});
 return router;
}
