import express from 'express';
import createTelevendasRouter from './televendasRoutes.js';
import createErpManagementRoutes from '../erp/erpManagementRoutes.js';
import createErpSigeMigrationRoutes from '../erp/erpSigeMigrationRoutes.js';
import createErpSigeMasterDataRoutes from '../erp/erpSigeMasterDataRoutes.js';
import createErpPeopleRoutes from '../erp/erpPeopleRoutes.js';

export default function createTelevendasRoutes(context={}){
  const router=express.Router();
  router.use(createTelevendasRouter(context));
  router.use(createErpManagementRoutes(context));
  router.use(createErpSigeMigrationRoutes(context));
  router.use(createErpSigeMasterDataRoutes(context));
  router.use(createErpPeopleRoutes(context));
  return router;
}
