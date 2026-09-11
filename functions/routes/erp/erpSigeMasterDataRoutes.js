import express from 'express';
import multer from 'multer';
import { createErpSigeMasterDataImportService } from '../../services/erp/erpSigeMasterDataImportService.js';

const upload=multer({storage:multer.memoryStorage(),limits:{files:1,fileSize:16*1024*1024}});
function actor(req={}){const u=req.adminUser||req.user||{};return{name:u.name||u.nome||'',email:u.email||'',id:String(u._id||u.id||'')}}

export default function createErpSigeMasterDataRoutes(context={}){
  const router=express.Router();
  if(!context.adminRequired)throw new Error('[erp-sige-master-data] adminRequired não informado');
  const service=createErpSigeMasterDataImportService(context);
  let activeJob=null;

  router.get('/erp/migracao/sige/import/status',context.adminRequired,async(_req,res)=>{
    try{
      const snapshot=await service.status();
      return res.json({
        ok:true,
        import:{
          ...snapshot,
          serverJob:activeJob?{active:true,startedAt:activeJob.startedAt,packageName:activeJob.packageName}:{active:false}
        }
      });
    }catch(error){
      console.error('[erp-sige-master-data/status]',error?.message||error);
      return res.status(Number(error?.statusCode||500)).json({ok:false,error:error?.message||'Erro ao consultar migração.',code:error?.code||'ERP_SIGE_IMPORT_ERROR'});
    }
  });

  router.post('/erp/migracao/sige/import/master-data',context.adminRequired,upload.single('package'),async(req,res)=>{
    try{
      const confirmation=String(req.body?.confirmation||'');
      if(confirmation!=='IMPORTAR_CADASTROS_SIGE')return res.status(409).json({ok:false,error:'Confirmação de importação inválida.',code:'SIGE_IMPORT_CONFIRMATION_REQUIRED'});
      if(!req.file?.buffer)return res.status(400).json({ok:false,error:'Selecione o pacote ZIP de recuperação do SIGE.',code:'SIGE_PACKAGE_REQUIRED'});
      if(activeJob){
        return res.status(202).json({ok:true,accepted:true,alreadyRunning:true,startedAt:activeJob.startedAt,message:'Já existe uma importação de cadastros em andamento. Acompanhe o status sem reenviar o arquivo.'});
      }

      const file={...req.file,buffer:Buffer.from(req.file.buffer)};
      const actorInfo=actor(req);
      activeJob={startedAt:new Date().toISOString(),packageName:String(file.originalname||'pacote_sige.zip').slice(0,255)};
      res.status(202).json({ok:true,accepted:true,startedAt:activeJob.startedAt,message:'Importação aceita. O Ariana ERP continuará processando em segundo plano.'});

      setImmediate(async()=>{
        try{
          await service.importMasterData(file,confirmation,actorInfo);
        }catch(error){
          console.error('[erp-sige-master-data/background]',error?.code||'',error?.message||error);
        }finally{
          activeJob=null;
        }
      });
      return;
    }catch(error){
      console.error('[erp-sige-master-data/import]',error?.code||'',error?.message||error);
      if(res.headersSent)return;
      return res.status(Number(error?.statusCode||500)).json({ok:false,error:error?.message||'Erro ao iniciar importação dos cadastros mestres.',code:error?.code||'ERP_SIGE_IMPORT_ERROR'});
    }
  });

  router.use((error,_req,res,next)=>{
    if(!(error instanceof multer.MulterError))return next(error);
    return res.status(error.code==='LIMIT_FILE_SIZE'?413:400).json({ok:false,error:error.code==='LIMIT_FILE_SIZE'?'O ZIP excede o limite seguro de 16 MB.':'Falha ao receber o pacote do SIGE.',code:`SIGE_IMPORT_UPLOAD_${error.code||'ERROR'}`});
  });
  return router;
}
