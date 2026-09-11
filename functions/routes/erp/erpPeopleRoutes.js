import express from 'express';
import { createErpPeopleService } from '../../services/erp/erpPeopleService.js';

export default function createErpPeopleRoutes(context={}){
  const router=express.Router();
  if(!context.adminRequired)throw new Error('[erp-people] adminRequired não informado');
  const service=createErpPeopleService(context);
  router.get('/erp/people',context.adminRequired,async(req,res)=>{try{return res.json({ok:true,...await service.list(req.query||{})})}catch(error){console.error('[erp-people/list]',error?.message||error);return res.status(Number(error?.statusCode||500)).json({ok:false,error:error?.message||'Erro ao consultar clientes.',code:error?.code||'ERP_PEOPLE_ERROR'})}});
  router.get('/erp/people/:id',context.adminRequired,async(req,res)=>{try{return res.json({ok:true,person:await service.get(req.params.id)})}catch(error){return res.status(Number(error?.statusCode||500)).json({ok:false,error:error?.message||'Erro ao consultar cliente.',code:error?.code||'ERP_PEOPLE_ERROR'})}});
  return router;
}
