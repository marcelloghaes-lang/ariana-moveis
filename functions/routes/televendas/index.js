import express from 'express';
import createTelevendasRouter from './televendasRoutes.js';
import createErpManagementRoutes from '../erp/erpManagementRoutes.js';
import createErpSigeMigrationRoutes from '../erp/erpSigeMigrationRoutes.js';
import createErpSigeMasterDataRoutes from '../erp/erpSigeMasterDataRoutes.js';
import createErpPeopleRoutes from '../erp/erpPeopleRoutes.js';
import createErpSigeHistoryRoutes from '../erp/erpSigeHistoryRoutes.js';
import createErpParityAnalyticsRoutes from '../erp/erpParityAnalyticsRoutes.js';
import createErpSigeFiscalHistoryRoutes from '../erp/erpSigeFiscalHistoryRoutes.js';
import createErpSigeSaleParityRoutes from '../erp/erpSigeSaleParityRoutes.js';
import { createErpOperationalRequired, erpAccessSummary } from '../../services/erp/erpAccessControl.js';

export default function createTelevendasRoutes(context={}){
  const router=express.Router();
  if(!context.adminRequired)throw new Error('[televendas] adminRequired não informado');

  const operationalRequired=createErpOperationalRequired(context.adminRequired);
  const operationalContext={...context,adminRequired:operationalRequired};

  // Endpoint usado pelo front para esconder/mostrar ações conforme a permissão do colaborador.
  router.get('/erp/acesso',operationalRequired,(req,res)=>res.json({ok:true,access:erpAccessSummary(req)}));

  // Rotas operacionais do Ariana ERP usam a matriz granular de permissões.
  // Rotas administrativas do Televendas continuam negadas por padrão para colaboradores.
  router.use(createTelevendasRouter(operationalContext));
  router.use(createErpManagementRoutes(operationalContext));
  router.use(createErpPeopleRoutes(operationalContext));
  router.use(createErpParityAnalyticsRoutes(operationalContext));
  router.use(createErpSigeSaleParityRoutes(operationalContext));

  // Migrações SIGE e Fiscal/NF-e permanecem no adminRequired original.
  // Isso impede que uma permissão operacional abra rotas sensíveis.
  router.use(createErpSigeMigrationRoutes(context));
  router.use(createErpSigeMasterDataRoutes(context));
  router.use(createErpSigeHistoryRoutes(context));
  router.use(createErpSigeFiscalHistoryRoutes(context));

  return router;
}
