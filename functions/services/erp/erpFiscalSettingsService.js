import { readFile } from 'node:fs/promises';
import mongoose from 'mongoose';
import sharp from 'sharp';

const base={timestamps:true,versionKey:false,minimize:false};
const schema=new mongoose.Schema({key:{type:String,default:'default',unique:true,index:true},mascotJpeg:{type:String,default:''},mascotUpdatedAt:Date,updatedBy:String},base);
const Settings=mongoose.models.ErpFiscalSettings||mongoose.model('ErpFiscalSettings',schema);
const clean=(v='',m=200)=>String(v??'').trim().slice(0,m);
function fail(message,statusCode=400,code='ERP_FISCAL_SETTINGS_ERROR'){const e=new Error(message);e.statusCode=statusCode;e.code=code;return e}

let officialMascotPromise=null;

async function normalizeMascot(buffer){
  if(!Buffer.isBuffer(buffer)||!buffer.length)throw fail('Selecione uma imagem para a mascote.');
  try{
    const image=sharp(buffer,{failOn:'error'}).rotate();
    const metadata=await image.metadata();
    if(!['jpeg','png','webp'].includes(String(metadata.format||'').toLowerCase())){
      throw fail('Envie a mascote em PNG, JPG/JPEG ou WebP.');
    }
    const jpeg=await image
      .resize({width:480,height:500,fit:'contain',background:{r:255,g:255,b:255,alpha:1}})
      .flatten({background:{r:255,g:255,b:255}})
      .jpeg({quality:90,chromaSubsampling:'4:4:4'})
      .toBuffer();
    if(jpeg.length>900*1024)throw fail('A imagem otimizada da mascote deve ter no máximo 900 KB.',413,'ERP_MASCOT_TOO_LARGE');
    return jpeg;
  }catch(error){
    if(error?.code==='ERP_FISCAL_SETTINGS_ERROR'||error?.code==='ERP_MASCOT_TOO_LARGE')throw error;
    throw fail('Não foi possível processar a mascote. Envie um arquivo PNG, JPG/JPEG ou WebP válido.');
  }
}

async function officialMascot(){
  if(!officialMascotPromise){
    officialMascotPromise=(async()=>{
      try{
        const base64=clean(await readFile(new URL('../../assets/mascote-oficial-cabecalho.base64.txt',import.meta.url),'utf8'),8_000_000);
        if(!base64)return null;
        return await normalizeMascot(Buffer.from(base64,'base64'));
      }catch(error){
        console.warn('[erp-fiscal-settings/official-mascot]',error?.message||error);
        return null;
      }
    })();
  }
  return officialMascotPromise;
}

export function createErpFiscalSettingsService(context={}){
  const {IntegrationAuditLog,redact}=context;
  async function audit(eventType,metadata={}){if(!IntegrationAuditLog)return;try{await IntegrationAuditLog.create({scope:'erp_ariana',eventType,status:'ok',message:clean(metadata.message,500),metadata:redact?redact(metadata):metadata})}catch(e){console.warn('[erp-fiscal-settings/audit]',e.message)}}
  async function row(){return Settings.findOneAndUpdate({key:'default'},{$setOnInsert:{key:'default'}},{upsert:true,new:true})}
  async function get(){const x=await row();return{hasMascot:Boolean(x.mascotJpeg),mascotUpdatedAt:x.mascotUpdatedAt||null,emission:{status:'pending',configured:false}}}
  async function mascot(){
    const x=await row();
    if(x.mascotJpeg){
      try{
        const custom=Buffer.from(x.mascotJpeg,'base64');
        if(custom.length)return custom;
      }catch{}
    }
    return officialMascot();
  }
  async function setMascot(buffer,actor={}){
    const jpeg=await normalizeMascot(buffer);
    const who=clean(actor.name||actor.nome||actor.email||'Operador',180);
    const now=new Date();
    await Settings.updateOne({key:'default'},{$set:{mascotJpeg:jpeg.toString('base64'),mascotUpdatedAt:now,updatedBy:who},$setOnInsert:{key:'default'}},{upsert:true});
    await audit('erp.fiscal.mascot.updated',{message:'Mascote do DANFE atualizada',by:who,size:jpeg.length});
    return get();
  }
  async function clearMascot(actor={}){const who=clean(actor.name||actor.nome||actor.email||'Operador',180);await Settings.updateOne({key:'default'},{$set:{mascotJpeg:'',mascotUpdatedAt:new Date(),updatedBy:who},$setOnInsert:{key:'default'}},{upsert:true});await audit('erp.fiscal.mascot.cleared',{message:'Mascote personalizada do DANFE removida; identidade oficial restaurada',by:who});return get()}
  return{get,mascot,setMascot,clearMascot};
}
export default createErpFiscalSettingsService;
