import express from 'express';
import createTelevendasRouter from './televendasRoutes.js';
import createErpManagementRoutes from '../erp/erpManagementRoutes.js';

export default function createTelevendasRoutes(context={}){
  const router=express.Router();
  router.use(createTelevendasRouter(context));
  router.use(createErpManagementRoutes(context));
  return router;
}
