import express from 'express';
import createTelevendasRouter from './televendasRoutes.js';
import createErpManagementRoutes from '../erp/erpManagementRoutes.js';
import createErpSigeMigrationRoutes from '../erp/erpSigeMigrationRoutes.js';
import createErpSigeMasterDataRoutes from '../erp/erpSigeMasterDataRoutes.js';
import createErpSigeHistoryRoutes from '../erp/erpSigeHistoryRoutes.js';

export default function createTelevendasRoutes(context={}){
  const router=express.Router();
  router.use(createTelevendasRouter(context));
  router.use(createErpManagementRoutes(context));
  router.use(createErpSigeMigrationRoutes(context));
  router.use(createErpSigeMasterDataRoutes(context));
  router.use(createErpSigeHistoryRoutes(context));
  return router;
}
