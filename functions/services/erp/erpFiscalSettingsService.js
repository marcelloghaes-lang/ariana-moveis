import { readFile } from 'node:fs/promises';
import mongoose from 'mongoose';
import sharp from 'sharp';

const base={timestamps:true,versionKey:false,minimize:false};
const schema=new mongoose.Schema({key:{type:String,default:'default',unique:true,index:true},mascotJpeg:{type:String,default:''},mascotUpdatedAt:Date,updatedBy:String},base);
const Settings=mongoose.models.ErpFiscalSettings||mongoose.model('ErpFiscalSettings',schema);
const clean=(v='',m=200)=>String(v??'').trim().slice(0,m);
function fail(message,statusCode=400,code='ERP_FISCAL_SETTINGS_ERROR'){const e=new Error(message);e.statusCode=statusCode;e.code=code;return e}

let officialLogoPromise=null;

async function validateImage(buffer){
  if(!Buffer.isBuffer(buffer)||!buffer.length)throw fail('Selecione uma imagem para a mascote.');
  try{
    const metadata=await sharp(buffer,{failOn:'error'}).metadata();
    if(!['jpeg','png','webp'].includes(String(metadata.format||'').toLowerCase()))throw fail('Envie a mascote em PNG, JPG/JPEG ou WebP.');
    return metadata;
  }catch(error){
    if(error?.code==='ERP_FISCAL_SETTINGS_ERROR')throw error;
    throw fail('Não foi possível processar a mascote. Envie um arquivo PNG, JPG/JPEG ou WebP válido.');
  }
}

async function normalizeMascot(buffer){
  await validateImage(buffer);
  try{
    const jpeg=await sharp(buffer,{failOn:'error'})
      .rotate()
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

async function composeDanfeLogo(mascotBuffer){
  await validateImage(mascotBuffer);
  const mascot=await sharp(mascotBuffer,{failOn:'error'})
    .rotate()
    .resize({width:176,height:190,fit:'contain',background:{r:255,g:255,b:255,alpha:0}})
    .png()
    .toBuffer();

  const brandSvg=Buffer.from(`
    <svg width="570" height="190" viewBox="0 0 570 190" xmlns="http://www.w3.org/2000/svg">
      <rect width="570" height="190" fill="#ffffff"/>
      <text x="8" y="83" font-family="Arial, Helvetica, sans-serif" font-size="78" font-style="italic" font-weight="900" letter-spacing="-3" fill="#2E6DA4">ARIANA</text>
      <text x="340" y="83" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="900" letter-spacing="1" fill="#56B5FF">MÓVEIS</text>
      <text x="12" y="126" font-family="Arial, Helvetica, sans-serif" font-size="23" font-weight="700" letter-spacing="1.2" fill="#2E6DA4">Sua casa merece o melhor.</text>
    </svg>
  `);

  const jpeg=await sharp({create:{width:760,height:210,channels:3,background:{r:255,g:255,b:255}}})
    .composite([
      {input:mascot,left:0,top:10},
      {input:brandSvg,left:178,top:10}
    ])
    .jpeg({quality:95,chromaSubsampling:'4:4:4'})
    .toBuffer();

  if(jpeg.length>900*1024)throw fail('A identidade visual otimizada do DANFE excedeu o limite de 900 KB.',413,'ERP_MASCOT_TOO_LARGE');
  return jpeg;
}

async function officialLogo(){
  if(!officialLogoPromise){
    officialLogoPromise=(async()=>{
      try{
        let mascot;
        try{
          // Usa primeiro exatamente o avatar referenciado pelo cabeçalho da loja.
          mascot=await readFile(new URL('../../../public/assets/imagens/avatar-ariana.png',import.meta.url));
        }catch{
          // Fallback mantido dentro de functions para ambientes que empacotam somente o backend.
          mascot=await readFile(new URL('../../assets/mascote.png',import.meta.url));
        }
        return await composeDanfeLogo(mascot);
      }catch(error){
        console.warn('[erp-fiscal-settings/official-logo]',error?.message||error);
        return null;
      }
    })();
  }
  return officialLogoPromise;
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
        if(custom.length)return await composeDanfeLogo(custom);
      }catch(error){
        console.warn('[erp-fiscal-settings/custom-logo]',error?.message||error);
      }
    }
    return officialLogo();
  }
  async function setMascot(buffer,actor={}){
    const jpeg=await normalizeMascot(buffer);
    const who=clean(actor.name||actor.nome||actor.email||'Operador',180);
    const now=new Date();
    await Settings.updateOne({key:'default'},{$set:{mascotJpeg:jpeg.toString('base64'),mascotUpdatedAt:now,updatedBy:who},$setOnInsert:{key:'default'}},{upsert:true});
    await audit('erp.fiscal.mascot.updated',{message:'Mascote do DANFE atualizada',by:who,size:jpeg.length});
    return get();
  }
  async function clearMascot(actor={}){const who=clean(actor.name||actor.nome||actor.email||'Operador',180);await Settings.updateOne({key:'default'},{$set:{mascotJpeg:'',mascotUpdatedAt:new Date(),updatedBy:who},$setOnInsert:{key:'default'}},{upsert:true});await audit('erp.fiscal.mascot.cleared',{message:'Mascote personalizada removida; identidade visual oficial do DANFE restaurada',by:who});return get()}
  return{get,mascot,setMascot,clearMascot};
}
export default createErpFiscalSettingsService;
