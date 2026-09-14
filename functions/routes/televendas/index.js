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
import { createErpPdvRulesMiddleware } from '../../services/erp/erpPdvRulesMiddleware.js';

const clean=(v='',m=180)=>String(v??'').trim().slice(0,m);
const identity=req=>req.adminUser||req.admin||req.auth||req.user||{};

export default function createTelevendasRoutes(context={}){
  const router=express.Router();
  if(!context.adminRequired)throw new Error('[televendas] adminRequired não informado');

  const operationalRequired=createErpOperationalRequired(context.adminRequired);
  const operationalContext={...context,adminRequired:operationalRequired};

  // Endpoint usado pelo front para esconder/mostrar ações conforme a permissão do colaborador.
  // Também devolve apenas a identidade básica do usuário autenticado para personalizar o ERP.
  router.get('/erp/acesso',operationalRequired,(req,res)=>{
    const user=identity(req);
    return res.json({
      ok:true,
      access:erpAccessSummary(req),
      user:{
        id:String(user.id||user._id||user.userId||''),
        name:clean(user.name||user.fullName||user.displayName||user.email||'Usuário',160),
        email:clean(user.email||'',180),
        role:clean(user.role||'',40)
      }
    });
  });

  // Regras de PDV são avaliadas no servidor antes das rotas operacionais.
  // Isso impede que uma tela antiga contorne revisão fiscal, inadimplência ou caixa obrigatório.
  router.use(createErpPdvRulesMiddleware(context,operationalRequired));

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