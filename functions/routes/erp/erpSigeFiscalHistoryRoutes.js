import express from 'express';
import multer from 'multer';
import { createErpSigeFiscalHistoryService } from '../../services/erp/erpSigeFiscalHistoryService.js';
import { createErpDanfeBrandedService } from '../../services/erp/erpDanfeBrandedService.js';
import { createErpFiscalSettingsService } from '../../services/erp/erpFiscalSettingsService.js';
import { createErpNfeSefazService } from '../../services/erp/erpNfeSefazService.js';
import { createErpService } from '../../services/erp/erpService.js';
import { createErpCashService } from '../../services/erp/erpCashService.js';
import { createErpSettingsService } from '../../services/erp/erpSettingsService.js';

const upload=multer({storage:multer.memoryStorage(),limits:{files:1,fileSize:5*1024*1024}});
const actor=req=>{
  const u=req.adminUser||req.user||req.admin||req.auth||{};
  return{name:u.name||u.nome||'',email:u.email||'',id:String(u._id||u.id||'')};
};
const safeFilePart=(value='')=>String(value||'').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,100)||'documento';

export default function createErpSigeFiscalHistoryRoutes(context={}){
  const router=express.Router();
  if(!context.adminRequired)throw new Error('[erp-sige-fiscal] adminRequired não informado');
  const service=createErpSigeFiscalHistoryService();
  const danfe=createErpDanfeBrandedService();
  const settings=createErpFiscalSettingsService(context);
  const operationalSettings=createErpSettingsService(context);
  const erp=createErpService(context);
  const cash=createErpCashService(context);
  const nfe=createErpNfeSefazService({...context,erp},settings);
  const sendError=(res,e,fallback='Erro fiscal.')=>res.status(Number(e?.statusCode||500)).json({
    ok:false,
    error:e?.message||fallback,
    code:e?.code||'ERP_FISCAL_ERROR',
    details:e?.details||undefined
  });

  router.get('/erp/migracao/sige/fiscal/status',context.adminRequired,async(_req,res)=>{
    try{return res.json({ok:true,fiscal:await service.status()})}
    catch(e){return sendError(res,e,'Erro ao consultar migração fiscal.')}
  });
  router.post('/erp/migracao/sige/fiscal/dry-run',context.adminRequired,upload.single('package'),async(req,res)=>{
    try{return res.json({ok:true,preview:await service.preview(req.file||null)})}
    catch(e){return sendError(res,e,'Erro ao analisar pacote fiscal.')}
  });
  router.post('/erp/migracao/sige/fiscal/import',context.adminRequired,upload.single('package'),async(req,res)=>{
    try{
      const result=await service.startImport(req.file||null,String(req.body?.confirmation||''),actor(req));
      return res.status(result.status==='completed'?200:202).json({ok:true,result});
    }catch(e){return sendError(res,e,'Erro ao iniciar importação fiscal.')}
  });

  router.get('/erp/fiscal/configuracao',context.adminRequired,async(_req,res)=>{
    try{return res.json({ok:true,settings:await settings.get()})}
    catch(e){return sendError(res,e,'Erro ao consultar configuração fiscal.')}
  });
  router.put('/erp/fiscal/configuracao/sefaz',context.adminRequired,async(req,res)=>{
    try{return res.json({ok:true,settings:await settings.setFiscalConfig(req.body||{},actor(req))})}
    catch(e){return sendError(res,e,'Erro ao salvar configuração da SEFAZ.')}
  });
  router.post('/erp/fiscal/configuracao/certificado-a1',context.adminRequired,upload.single('certificate'),async(req,res)=>{
    try{return res.json({ok:true,settings:await settings.setA1(req.file?.buffer,String(req.body?.password||''),req.file?.originalname||'',actor(req))})}
    catch(e){return sendError(res,e,'Erro ao salvar certificado A1.')}
  });
  router.delete('/erp/fiscal/configuracao/certificado-a1',context.adminRequired,async(req,res)=>{
    try{return res.json({ok:true,settings:await settings.clearA1(actor(req))})}
    catch(e){return sendError(res,e,'Erro ao remover certificado A1.')}
  });
  router.post('/erp/fiscal/configuracao/sefaz/testar',context.adminRequired,async(_req,res)=>{
    try{return res.json({ok:true,result:await nfe.testConnection()})}
    catch(e){return sendError(res,e,'Erro ao testar comunicação com a SEFAZ/MG.')}
  });
  router.post('/erp/fiscal/nfe/preflight',context.adminRequired,async(req,res)=>{
    try{
      const draft=await operationalSettings.applySaleDefaults(req.body?.draft||req.body||{});
      const review=await nfe.preflight(draft);
      return res.status(review.ready?200:409).json({ok:review.ready,review});
    }catch(e){return sendError(res,e,'Erro ao validar a NF-e.')}
  });

  router.post('/erp/fiscal/nfe/emitir-e-faturar',context.adminRequired,async(req,res)=>{
    const who=actor(req),existingOrderId=String(req.body?.orderId||'').trim();
    let draft=req.body?.draft||{};
    try{
      draft=await operationalSettings.applySaleDefaults(draft);
      const review=await nfe.preflight(draft);
      if(!review.ready){
        return res.status(409).json({
          ok:false,
          authorized:false,
          error:'A revisão fiscal possui pendências. Corrija antes de emitir.',
          code:'NFE_PREFLIGHT_BLOCKED',
          details:{problems:review.problems}
        });
      }

      // As regras operacionais são verificadas antes de qualquer transmissão real.
      // Homologação continua livre para testes e jamais movimenta caixa/estoque/financeiro.
      if(review.environment==='producao'){
        await operationalSettings.assertSaleAllowed(draft);
        if(await operationalSettings.requireOpenCashForBilling())await cash.requireOpen(who);
      }

      const fiscal=await nfe.transmit(draft,who,existingOrderId);

      if(fiscal.recoveryPending){
        return res.status(409).json({
          ok:false,
          authorized:true,
          billingCompleted:false,
          recoveryPending:true,
          orderId:fiscal.orderId,
          key:fiscal.key,
          protocol:fiscal.protocol,
          number:fiscal.number,
          series:fiscal.series,
          environment:fiscal.environment,
          error:'A SEFAZ confirma a NF-e, mas o XML autorizado original não está disponível no ERP. O faturamento foi bloqueado para evitar inconsistência fiscal.',
          code:'NFE_AUTHORIZED_XML_RECOVERY_PENDING'
        });
      }

      if(!fiscal.authorized)return res.status(422).json({ok:false,authorized:false,...fiscal});

      if(fiscal.homologation){
        return res.json({
          ok:true,
          authorized:true,
          homologation:true,
          billingCompleted:false,
          billingSkipped:true,
          orderId:fiscal.orderId,
          key:fiscal.key,
          protocol:fiscal.protocol,
          number:fiscal.number,
          series:fiscal.series,
          environment:fiscal.environment,
          fiscalDocumentId:fiscal.fiscalDocumentId||'',
          recovered:Boolean(fiscal.recovered),
          xmlAvailable:fiscal.xmlAvailable!==false,
          message:'NF-e autorizada em homologação. Venda, estoque, caixa e financeiro não foram alterados.'
        });
      }

      let order=fiscal.order;
      const currentStatus=String(order?.status||'').toLowerCase();
      if(currentStatus!=='faturado'){
        try{
          order=await erp.faturar(
            fiscal.orderId,
            {
              paymentMethod:draft.payment?.method,
              installments:Number(draft.payment?.installments||1),
              firstDueDate:draft.payment?.firstDueDate||null
            },
            who
          );
          await cash.registerSale(order,who);
        }catch(billingError){
          console.error('[erp-nfe/post-authorization-billing]',billingError);
          return res.status(500).json({
            ok:false,
            authorized:true,
            billingCompleted:false,
            orderId:fiscal.orderId,
            key:fiscal.key,
            protocol:fiscal.protocol,
            number:fiscal.number,
            series:fiscal.series,
            environment:fiscal.environment,
            error:'NF-e autorizada pela SEFAZ, mas o faturamento interno não foi concluído. Não emita outra nota: use este mesmo pedido para concluir o faturamento.',
            code:'NFE_AUTHORIZED_BILLING_PENDING',
            details:{billingError:String(billingError?.message||billingError)}
          });
        }
      }
      return res.json({
        ok:true,
        authorized:true,
        billingCompleted:true,
        orderId:String(order?._id||fiscal.orderId),
        order,
        key:fiscal.key,
        protocol:fiscal.protocol,
        number:fiscal.number,
        series:fiscal.series,
        environment:fiscal.environment,
        fiscalDocumentId:fiscal.fiscalDocumentId||''
      });
    }catch(e){
      return sendError(res,e,'Erro ao emitir NF-e e faturar a venda.');
    }
  });

  // Mantido exatamente o fluxo aprovado de identidade visual/DANFE histórico.
  router.get('/erp/fiscal/configuracao/mascote.jpg',context.adminRequired,async(_req,res)=>{
    try{
      const img=await settings.mascot();
      if(!img)return res.status(404).end();
      res.setHeader('Content-Type','image/jpeg');
      res.setHeader('Cache-Control','private, no-store');
      return res.status(200).send(img);
    }catch{return res.status(500).end()}
  });
  router.post('/erp/fiscal/configuracao/mascote',context.adminRequired,upload.single('mascot'),async(req,res)=>{
    try{return res.json({ok:true,settings:await settings.setMascot(req.file?.buffer,actor(req))})}
    catch(e){return sendError(res,e,'Erro ao salvar mascote.')}
  });
  router.delete('/erp/fiscal/configuracao/mascote',context.adminRequired,async(req,res)=>{
    try{return res.json({ok:true,settings:await settings.clearMascot(actor(req))})}
    catch(e){return sendError(res,e,'Erro ao remover mascote.')}
  });

  router.get('/erp/fiscal/historico/nfe',context.adminRequired,async(req,res)=>{
    try{return res.json({ok:true,history:await service.list(req.query||{})})}
    catch(e){return sendError(res,e,'Erro ao listar NF-e históricas.')}
  });
  router.get('/erp/fiscal/historico/nfe/:id/xml',context.adminRequired,async(req,res)=>{
    try{
      const doc=await service.detail(req.params.id);
      const xml=String(doc?.xml||'').trim();
      if(!xml)return res.status(404).json({ok:false,error:'XML original não está disponível para esta NF-e.',code:'ERP_FISCAL_XML_NOT_FOUND'});
      const number=safeFilePart(doc?.number||'sem-numero');
      const key=safeFilePart(doc?.key||doc?.sourceId||'sem-chave');
      const filename=`NFe-${number}-${key}.xml`;
      res.setHeader('Content-Type','application/xml; charset=utf-8');
      res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);
      res.setHeader('Cache-Control','private, no-store');
      return res.status(200).send(xml);
    }catch(e){return sendError(res,e,'Erro ao baixar XML da NF-e histórica.')}
  });
  router.get('/erp/fiscal/historico/nfe/:id/danfe.pdf',context.adminRequired,async(req,res)=>{
    try{
      const doc=await service.detail(req.params.id);
      const mascotJpeg=await settings.mascot();
      const pdf=danfe.generate(doc,{mascotJpeg});
      const number=safeFilePart(doc?.number||'sem-numero');
      const key=safeFilePart(doc?.key||doc?.sourceId||'sem-chave');
      const filename=`DANFE-${number}-${key}.pdf`;
      res.setHeader('Content-Type','application/pdf');
      res.setHeader('Content-Disposition',`inline; filename="${filename}"`);
      res.setHeader('Content-Length',String(pdf.length));
      res.setHeader('Cache-Control','private, no-store');
      return res.status(200).send(pdf);
    }catch(e){return sendError(res,e,'Erro ao gerar DANFE da NF-e histórica.')}
  });
  router.get('/erp/fiscal/historico/nfe/:id',context.adminRequired,async(req,res)=>{
    try{return res.json({ok:true,document:await service.detail(req.params.id)})}
    catch(e){return sendError(res,e,'Erro ao consultar NF-e histórica.')}
  });

  router.use((error,_req,res,next)=>{
    if(!(error instanceof multer.MulterError))return next(error);
    return res.status(error.code==='LIMIT_FILE_SIZE'?413:400).json({
      ok:false,
      error:error.code==='LIMIT_FILE_SIZE'?'O arquivo excede 5 MB.':'Falha ao receber o arquivo.',
      code:`ERP_FISCAL_UPLOAD_${error.code||'ERROR'}`
    });
  });
  return router;
}