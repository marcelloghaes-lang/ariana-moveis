import mongoose from 'mongoose';

const base={timestamps:true,versionKey:false,minimize:false};
const schema=new mongoose.Schema({key:{type:String,default:'default',unique:true,index:true},mascotJpeg:{type:String,default:''},mascotUpdatedAt:Date,updatedBy:String},base);
const Settings=mongoose.models.ErpFiscalSettings||mongoose.model('ErpFiscalSettings',schema);
const clean=(v='',m=200)=>String(v??'').trim().slice(0,m);
function fail(message,statusCode=400,code='ERP_FISCAL_SETTINGS_ERROR'){const e=new Error(message);e.statusCode=statusCode;e.code=code;return e}

export function createErpFiscalSettingsService(context={}){
  const {IntegrationAuditLog,redact}=context;
  async function audit(eventType,metadata={}){if(!IntegrationAuditLog)return;try{await IntegrationAuditLog.create({scope:'erp_ariana',eventType,status:'ok',message:clean(metadata.message,500),metadata:redact?redact(metadata):metadata})}catch(e){console.warn('[erp-fiscal-settings/audit]',e.message)}}
  async function row(){return Settings.findOneAndUpdate({key:'default'},{$setOnInsert:{key:'default'}},{upsert:true,new:true})}
  async function get(){const x=await row();return{hasMascot:Boolean(x.mascotJpeg),mascotUpdatedAt:x.mascotUpdatedAt||null,emission:{status:'pending',configured:false}}}
  async function mascot(){const x=await row();if(!x.mascotJpeg)return null;try{return Buffer.from(x.mascotJpeg,'base64')}catch{return null}}
  async function setMascot(buffer,actor={}){if(!Buffer.isBuffer(buffer)||!buffer.length)throw fail('Selecione uma imagem para a mascote.');if(buffer.length>900*1024)throw fail('A imagem otimizada da mascote deve ter no máximo 900 KB.',413,'ERP_MASCOT_TOO_LARGE');if(buffer[0]!==0xff||buffer[1]!==0xd8)throw fail('A mascote precisa ser enviada em JPEG. A tela converte PNG/JPG/WebP automaticamente.');const who=clean(actor.name||actor.nome||actor.email||'Operador',180);const now=new Date();await Settings.updateOne({key:'default'},{$set:{mascotJpeg:buffer.toString('base64'),mascotUpdatedAt:now,updatedBy:who},$setOnInsert:{key:'default'}},{upsert:true});await audit('erp.fiscal.mascot.updated',{message:'Mascote do DANFE atualizada',by:who,size:buffer.length});return get()}
  async function clearMascot(actor={}){const who=clean(actor.name||actor.nome||actor.email||'Operador',180);await Settings.updateOne({key:'default'},{$set:{mascotJpeg:'',mascotUpdatedAt:new Date(),updatedBy:who},$setOnInsert:{key:'default'}},{upsert:true});await audit('erp.fiscal.mascot.cleared',{message:'Mascote do DANFE removida',by:who});return get()}
  return{get,mascot,setMascot,clearMascot};
}
export default createErpFiscalSettingsService;
