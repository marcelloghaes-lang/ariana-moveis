import express from 'express';
import { createErpPeopleService } from '../../services/erp/erpPeopleService.js';
import { createErpProductService } from '../../services/erp/erpProductService.js';
import { requireErpPermission } from '../../services/erp/erpAccessControl.js';

export default function createErpPeopleRoutes(context={}){
  const router=express.Router();
  if(!context.adminRequired)throw new Error('[erp-people] adminRequired não informado');
  const people=createErpPeopleService(context);
  const products=context.Product?createErpProductService(context):null;
  const actor=req=>req.adminUser||req.user||req.admin||req.auth||{};
  const send=(res,error,fallback)=>{console.error('[erp-master-data]',error?.message||error);return res.status(Number(error?.statusCode||500)).json({ok:false,error:error?.message||fallback,code:error?.code||'ERP_MASTER_DATA_ERROR'})};
  const guard=(permissions,label)=>requireErpPermission(permissions,label);

  router.get('/erp/people',context.adminRequired,guard(['customers:read','customers:update'],'visualizar clientes'),async(req,res)=>{try{return res.json({ok:true,...await people.list(req.query||{})})}catch(e){return send(res,e,'Erro ao consultar clientes.')}});
  router.post('/erp/people',context.adminRequired,guard(['customers:update'],'cadastrar clientes'),async(req,res)=>{try{return res.status(201).json({ok:true,person:await people.create(req.body||{},actor(req))})}catch(e){return send(res,e,'Erro ao cadastrar cliente.')}});
  router.get('/erp/people/:id',context.adminRequired,guard(['customers:read','customers:update'],'visualizar clientes'),async(req,res)=>{try{return res.json({ok:true,person:await people.get(req.params.id)})}catch(e){return send(res,e,'Erro ao consultar cliente.')}});
  router.put('/erp/people/:id',context.adminRequired,guard(['customers:update'],'editar clientes'),async(req,res)=>{try{return res.json({ok:true,person:await people.update(req.params.id,req.body||{},actor(req))})}catch(e){return send(res,e,'Erro ao atualizar cliente.')}});

  router.get('/erp/catalog/products',context.adminRequired,guard(['products:read','products:update'],'visualizar produtos'),async(req,res)=>{try{if(!products)throw Object.assign(new Error('Catálogo de produtos não disponível.'),{statusCode:503});return res.json({ok:true,products:await products.list({...req.query,includeInactive:'1'})})}catch(e){return send(res,e,'Erro ao consultar produtos.')}});
  router.post('/erp/catalog/products',context.adminRequired,guard(['products:create'],'cadastrar produtos'),async(req,res)=>{try{if(!products)throw Object.assign(new Error('Catálogo de produtos não disponível.'),{statusCode:503});return res.status(201).json({ok:true,product:await products.create(req.body||{})})}catch(e){return send(res,e,'Erro ao cadastrar produto.')}});
  router.get('/erp/catalog/products/:id',context.adminRequired,guard(['products:read','products:update'],'visualizar produtos'),async(req,res)=>{try{if(!products)throw Object.assign(new Error('Catálogo de produtos não disponível.'),{statusCode:503});return res.json({ok:true,product:await products.get(req.params.id)})}catch(e){return send(res,e,'Erro ao consultar produto.')}});
  router.put('/erp/catalog/products/:id',context.adminRequired,guard(['products:update'],'editar produtos'),async(req,res)=>{try{if(!products)throw Object.assign(new Error('Catálogo de produtos não disponível.'),{statusCode:503});return res.json({ok:true,product:await products.update(req.params.id,req.body||{})})}catch(e){return send(res,e,'Erro ao atualizar produto.')}});
  return router;
}
