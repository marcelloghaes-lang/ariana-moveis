import express from 'express';
import { createErpFinancePanelBridgeService } from '../../services/erp/erpFinancePanelBridgeService.js';
import { createErpCollectionWorkflowService } from '../../services/erp/erpCollectionWorkflowService.js';
import { createErpCarneCoraService } from '../../services/erp/erpCarneCoraService.js';
import { createErpMarkedCollectionCampaignService } from '../../services/erp/erpMarkedCollectionCampaignService.js';
import { createErpAriadnaReceiptRecoveryService } from '../../services/erp/erpAriadnaReceiptRecoveryService.js';

const actor=req=>req.adminUser||req.admin||req.auth||req.user||{};
const webhookAuthorized=req=>{
  const configured=String(process.env.FINANCEIRO_WHATSAPP_WEBHOOK_TOKEN||'').trim();
  if(!configured)return true;
  const informed=String(req.headers?.['x-financeiro-webhook-token']||req.headers?.['x-webhook-token']||req.query?.token||'').trim();
  return Boolean(informed&&informed===configured);
};

export default function createErpFinancePanelBridgeRoutes(context={}){
  const router=express.Router();
  if(!context.adminRequired)throw new Error('[erp-finance-panel] adminRequired não informado');
  const bridge=createErpFinancePanelBridgeService(context);
  const collections=createErpCollectionWorkflowService(context);
  const carne=createErpCarneCoraService(context);
  const markedCampaign=createErpMarkedCollectionCampaignService(context);
  markedCampaign.start();
  const stage3Campaign=createErpMarkedCollectionCampaignService(context,{
    campaignKey:'etapa3_x_2026_10_02',
    label:'Etapa 3',
    names:[
      'Rayane Aparecida do Nascimento',
      'Carlos Augusto de Oliveira',
      'Marco Antonio Ferreira dos Santos',
      'Angelica Vanderleia Marçal',
      'Raissa Paula da Silva',
      'Gleiciane Cristina da Silva Ferreira',
      'Luciana Vieira Nunes',
      'Silvana Freitas da Costa'
    ],
    referenceBalances:{
      'Rayane Aparecida do Nascimento':2989.53,
      'Carlos Augusto de Oliveira':2739.00,
      'Marco Antonio Ferreira dos Santos':2679.00,
      'Angelica Vanderleia Marçal':2626.00,
      'Raissa Paula da Silva':2573.00,
      'Gleiciane Cristina da Silva Ferreira':2544.00,
      'Luciana Vieira Nunes':2392.00,
      'Silvana Freitas da Costa':2363.30
    },
    strictNameKeys:[],
    manualPhoneOverrides:{},
    userSkippedKeys:['Marco Antonio Ferreira dos Santos'],
    enableLucianoRecovery:false
  });
  stage3Campaign.start();
  const ariadnaReceiptRecovery=createErpAriadnaReceiptRecoveryService(context);
  ariadnaReceiptRecovery.start();
  const handle=(action,status=200)=>async(req,res)=>{
    try{
      const result=await action(req);
      return res.status(status).json({ok:true,...(result||{})});
    }catch(error){
      console.error('[erp-finance-panel]',error?.message||error);
      return res.status(Number(error?.statusCode||500)).json({
        ok:false,
        error:error?.message||'Erro ao consultar o Financeiro Ariana no ERP.',
        code:error?.code||'ERP_FINANCE_PANEL_ERROR'
      });
    }
  };

  // Intercepta somente respostas da campanha Etapa 2 e deixa o webhook financeiro existente continuar o processamento normal.
  router.post('/webhooks/financeiro/whatsapp/status',async(req,res,next)=>{
    const event=String(req.body?.event||req.body?.type||req.body?.data?.event||req.body?.data?.type||'').trim().toUpperCase().replace(/[.\-\s]+/g,'_');
    if(event!=='MESSAGES_UPSERT'||!webhookAuthorized(req))return next();
    try{
      const result=await markedCampaign.handleIncomingWebhook(req.body||{});
      if(result?.handled)console.log('[erp-marked-collection][webhook]',result.action||'handled',result.taskId||'');
      const stage3Result=await stage3Campaign.handleIncomingWebhook(req.body||{});
      if(stage3Result?.handled)console.log('[erp-marked-collection][webhook][etapa3]',stage3Result.action||'handled',stage3Result.taskId||'');
    }catch(error){
      console.error('[erp-marked-collection][webhook]',error?.message||error);
    }
    return next();
  });

  router.get('/erp/finance-panel/campanha-etapa-2',context.adminRequired,handle(req=>markedCampaign.list(req.query||{})));
  router.post('/erp/finance-panel/campanha-etapa-2/executar',context.adminRequired,handle(()=>markedCampaign.run()));
  router.get('/erp/finance-panel/campanha-etapa-3',context.adminRequired,handle(req=>stage3Campaign.list(req.query||{})));
  router.post('/erp/finance-panel/campanha-etapa-3/executar',context.adminRequired,handle(()=>stage3Campaign.run()));

  router.get('/erp/finance-panel/clientes',context.adminRequired,handle(req=>bridge.clientes(req.query||{})));
  router.get('/erp/finance-panel/lancamentos',context.adminRequired,handle(req=>bridge.lancamentos(req.query||{})));
  router.get('/erp/finance-panel/inadimplentes',context.adminRequired,handle(req=>{
    const view=String(req.query?.view||'').trim().toLowerCase();
    if(view==='fila'||view==='fila-do-dia')return collections.fila(req.query||{});
    if(view==='promessas')return collections.promessas(req.query||{});
    if(view==='recuperacao')return collections.recuperacao(req.query||{});
    return bridge.inadimplentes(req.query||{});
  }));
  router.get('/erp/finance-panel/dashboard',context.adminRequired,handle(req=>bridge.dashboard(req.query||{})));
  router.post('/erp/finance-panel/lancamentos/:orderId/:number/pagamentos',context.adminRequired,handle(req=>{
    const action=String(req.body?.action||'').trim().toLowerCase();
    if(action)return collections.registrarAcao(req.body?.targetId||req.params.orderId,req.body||{},actor(req));
    return bridge.receber(req.params.orderId,req.params.number,req.body||{},actor(req));
  }));

  router.get('/erp/finance-panel/carne/compras',context.adminRequired,handle(req=>carne.purchases(req.query||{})));
  router.get('/erp/finance-panel/carne/preview',context.adminRequired,handle(req=>carne.preview(req.query?.targetId||'',req.query?.via||'')));
  router.get('/erp/finance-panel/carne/pdf',context.adminRequired,async(req,res)=>{
    try{
      const result=await carne.pdf(req.query?.targetId||'',req.query?.via||'',actor(req));
      res.setHeader('Content-Type','application/pdf');
      res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`);
      res.setHeader('Cache-Control','private, no-store, max-age=0');
      return res.status(200).send(result.buffer);
    }catch(error){
      console.error('[erp-finance-panel][carne-pdf]',error?.message||error);
      return res.status(Number(error?.statusCode||500)).json({ok:false,error:error?.message||'Não foi possível gerar o carnê.',code:error?.code||'ERP_CARNE_PDF_ERROR'});
    }
  });
  router.post('/erp/finance-panel/carne/enviar',context.adminRequired,handle(req=>carne.send(req.body?.targetId||'',req.body||{},actor(req)),201));
  router.post('/erp/finance-panel/carne/contato',context.adminRequired,handle(req=>carne.saveContact(req.body?.targetId||'',req.body||{},actor(req))));
  router.post('/erp/finance-panel/carne/cora/emitir',context.adminRequired,handle(req=>carne.emit(req.body?.targetId||'',req.body||{},actor(req)),201));
  router.post('/erp/finance-panel/carne/cora/reconciliar',context.adminRequired,handle(req=>carne.reconcile(req.body?.targetId||'',req.body||{},actor(req))));

  return router;
}