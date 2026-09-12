import { readFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import sharp from 'sharp';

const base={timestamps:true,versionKey:false,minimize:false};
const schema=new mongoose.Schema({
  key:{type:String,default:'default',unique:true,index:true},
  mascotJpeg:{type:String,default:''},mascotUpdatedAt:Date,
  emissionProvider:{type:String,default:''},
  emissionEnvironment:{type:String,default:'homologacao'},
  emissionBaseUrl:{type:String,default:''},
  emissionTokenEnc:{type:String,default:''},
  emissionClientIdEnc:{type:String,default:''},
  emissionClientSecretEnc:{type:String,default:''},
  emissionUsernameEnc:{type:String,default:''},
  emissionPasswordEnc:{type:String,default:''},
  emissionUpdatedAt:Date,emissionUpdatedBy:String,
  updatedBy:String
},base);
const Settings=mongoose.models.ErpFiscalSettings||mongoose.model('ErpFiscalSettings',schema);
const clean=(v='',m=200)=>String(v??'').trim().slice(0,m);
function fail(message,statusCode=400,code='ERP_FISCAL_SETTINGS_ERROR'){const e=new Error(message);e.statusCode=statusCode;e.code=code;return e}

let officialLogoPromise=null;

function encryptionSecret(){return String(process.env.ERP_FISCAL_CREDENTIALS_KEY||process.env.JWT_SECRET||'').trim()}
function encryptionKey(){const secret=encryptionSecret();if(!secret)throw fail('Configure ERP_FISCAL_CREDENTIALS_KEY ou JWT_SECRET no servidor antes de salvar credenciais fiscais.',503,'ERP_FISCAL_ENCRYPTION_KEY_MISSING');return crypto.createHash('sha256').update(secret).digest()}
function encryptSecret(value=''){
  const plain=String(value??'');if(!plain)return'';
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',encryptionKey(),iv),body=Buffer.concat([cipher.update(plain,'utf8'),cipher.final()]),tag=cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${body.toString('base64')}`;
}
function decryptSecret(value=''){
  const raw=String(value||'');if(!raw)return'';
  const [version,iv64,tag64,body64]=raw.split(':');if(version!=='v1'||!iv64||!tag64||!body64)throw fail('Credencial fiscal armazenada em formato inválido.',500,'ERP_FISCAL_CREDENTIAL_INVALID');
  const decipher=crypto.createDecipheriv('aes-256-gcm',encryptionKey(),Buffer.from(iv64,'base64'));decipher.setAuthTag(Buffer.from(tag64,'base64'));
  return Buffer.concat([decipher.update(Buffer.from(body64,'base64')),decipher.final()]).toString('utf8');
}
function emissionPublic(x){
  const hasToken=Boolean(x.emissionTokenEnc),hasClientId=Boolean(x.emissionClientIdEnc),hasClientSecret=Boolean(x.emissionClientSecretEnc),hasUsername=Boolean(x.emissionUsernameEnc),hasPassword=Boolean(x.emissionPasswordEnc);
  const hasCredentials=hasToken||hasClientId||hasClientSecret||hasUsername||hasPassword;
  const configured=Boolean(clean(x.emissionProvider,120)&&hasCredentials);
  return{provider:clean(x.emissionProvider,120),environment:x.emissionEnvironment==='producao'?'producao':'homologacao',baseUrl:clean(x.emissionBaseUrl,500),configured,status:configured?'credentials_saved':'pending',encryptionReady:Boolean(encryptionSecret()),hasToken,hasClientId,hasClientSecret,hasUsername,hasPassword,updatedAt:x.emissionUpdatedAt||null,updatedBy:clean(x.emissionUpdatedBy,180)};
}

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
    const jpeg=await sharp(buffer,{failOn:'error'}).rotate().resize({width:480,height:500,fit:'contain',background:{r:255,g:255,b:255,alpha:1}}).flatten({background:{r:255,g:255,b:255}}).jpeg({quality:90,chromaSubsampling:'4:4:4'}).toBuffer();
    if(jpeg.length>900*1024)throw fail('A imagem otimizada da mascote deve ter no máximo 900 KB.',413,'ERP_MASCOT_TOO_LARGE');
    return jpeg;
  }catch(error){
    if(error?.code==='ERP_FISCAL_SETTINGS_ERROR'||error?.code==='ERP_MASCOT_TOO_LARGE')throw error;
    throw fail('Não foi possível processar a mascote. Envie um arquivo PNG, JPG/JPEG ou WebP válido.');
  }
}

async function composeDanfeLogo(mascotBuffer){
  await validateImage(mascotBuffer);
  const mascot=await sharp(mascotBuffer,{failOn:'error'}).rotate().resize({width:176,height:190,fit:'contain',background:{r:255,g:255,b:255,alpha:0}}).png().toBuffer();
  const brandSvg=Buffer.from(`
    <svg width="570" height="190" viewBox="0 0 570 190" xmlns="http://www.w3.org/2000/svg">
      <rect width="570" height="190" fill="#ffffff"/>
      <text x="8" y="83" font-family="Arial, Helvetica, sans-serif" font-size="78" font-style="italic" font-weight="900" letter-spacing="-3" fill="#2E6DA4">ARIANA</text>
      <text x="340" y="83" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="900" letter-spacing="1" fill="#56B5FF">MÓVEIS</text>
      <text x="12" y="126" font-family="Arial, Helvetica, sans-serif" font-size="23" font-weight="700" letter-spacing="1.2" fill="#2E6DA4">Sua casa merece o melhor.</text>
    </svg>
  `);
  const jpeg=await sharp({create:{width:760,height:210,channels:3,background:{r:255,g:255,b:255}}}).composite([{input:mascot,left:0,top:10},{input:brandSvg,left:178,top:10}]).jpeg({quality:95,chromaSubsampling:'4:4:4'}).toBuffer();
  if(jpeg.length>900*1024)throw fail('A identidade visual otimizada do DANFE excedeu o limite de 900 KB.',413,'ERP_MASCOT_TOO_LARGE');
  return jpeg;
}

async function officialLogo(){
  if(!officialLogoPromise){
    officialLogoPromise=(async()=>{
      try{
        let mascot;
        try{mascot=await readFile(new URL('../../../public/assets/imagens/avatar-ariana.png',import.meta.url));}
        catch{mascot=await readFile(new URL('../../assets/mascote.png',import.meta.url));}
        return await composeDanfeLogo(mascot);
      }catch(error){console.warn('[erp-fiscal-settings/official-logo]',error?.message||error);return null;}
    })();
  }
  return officialLogoPromise;
}

export function createErpFiscalSettingsService(context={}){
  const {IntegrationAuditLog,redact}=context;
  async function audit(eventType,metadata={}){if(!IntegrationAuditLog)return;try{await IntegrationAuditLog.create({scope:'erp_ariana',eventType,status:'ok',message:clean(metadata.message,500),metadata:redact?redact(metadata):metadata})}catch(e){console.warn('[erp-fiscal-settings/audit]',e.message)}}
  async function row(){return Settings.findOneAndUpdate({key:'default'},{$setOnInsert:{key:'default'}},{upsert:true,new:true})}
  async function get(){const x=await row();return{hasMascot:Boolean(x.mascotJpeg),mascotUpdatedAt:x.mascotUpdatedAt||null,emission:emissionPublic(x)}}
  async function mascot(){
    const x=await row();
    if(x.mascotJpeg){try{const custom=Buffer.from(x.mascotJpeg,'base64');if(custom.length)return await composeDanfeLogo(custom)}catch(error){console.warn('[erp-fiscal-settings/custom-logo]',error?.message||error)}}
    return officialLogo();
  }
  async function setMascot(buffer,actor={}){
    const jpeg=await normalizeMascot(buffer),who=clean(actor.name||actor.nome||actor.email||'Operador',180),now=new Date();
    await Settings.updateOne({key:'default'},{$set:{mascotJpeg:jpeg.toString('base64'),mascotUpdatedAt:now,updatedBy:who},$setOnInsert:{key:'default'}},{upsert:true});
    await audit('erp.fiscal.mascot.updated',{message:'Mascote do DANFE atualizada',by:who,size:jpeg.length});return get();
  }
  async function clearMascot(actor={}){const who=clean(actor.name||actor.nome||actor.email||'Operador',180);await Settings.updateOne({key:'default'},{$set:{mascotJpeg:'',mascotUpdatedAt:new Date(),updatedBy:who},$setOnInsert:{key:'default'}},{upsert:true});await audit('erp.fiscal.mascot.cleared',{message:'Mascote personalizada removida; identidade visual oficial do DANFE restaurada',by:who});return get()}
  async function setEmission(payload={},actor={}){
    const x=await row(),provider=clean(payload.provider??x.emissionProvider,120),environment=String(payload.environment||x.emissionEnvironment||'homologacao').toLowerCase()==='producao'?'producao':'homologacao',baseUrl=clean(payload.baseUrl??x.emissionBaseUrl,500);
    if(baseUrl&&!/^https?:\/\//i.test(baseUrl))throw fail('A URL da API fiscal deve começar com http:// ou https://.');
    const set={emissionProvider:provider,emissionEnvironment:environment,emissionBaseUrl:baseUrl,emissionUpdatedAt:new Date(),emissionUpdatedBy:clean(actor.name||actor.nome||actor.email||'Operador',180)};
    const secretMap={token:'emissionTokenEnc',clientId:'emissionClientIdEnc',clientSecret:'emissionClientSecretEnc',username:'emissionUsernameEnc',password:'emissionPasswordEnc'};
    for(const [field,target] of Object.entries(secretMap)){if(payload[field]!==undefined&&String(payload[field]??'').trim())set[target]=encryptSecret(String(payload[field]));}
    await Settings.updateOne({key:'default'},{$set:set,$setOnInsert:{key:'default'}},{upsert:true});
    await audit('erp.fiscal.emission.credentials.updated',{message:'Credenciais de emissão fiscal atualizadas',by:set.emissionUpdatedBy,provider,environment,baseUrl,changedSecrets:Object.keys(secretMap).filter(k=>payload[k]!==undefined&&String(payload[k]??'').trim())});
    return get();
  }
  async function clearEmission(actor={}){
    const who=clean(actor.name||actor.nome||actor.email||'Operador',180);
    await Settings.updateOne({key:'default'},{$set:{emissionProvider:'',emissionEnvironment:'homologacao',emissionBaseUrl:'',emissionTokenEnc:'',emissionClientIdEnc:'',emissionClientSecretEnc:'',emissionUsernameEnc:'',emissionPasswordEnc:'',emissionUpdatedAt:new Date(),emissionUpdatedBy:who},$setOnInsert:{key:'default'}},{upsert:true});
    await audit('erp.fiscal.emission.credentials.cleared',{message:'Credenciais de emissão fiscal removidas',by:who});return get();
  }
  async function emissionCredentials(){
    const x=await row();return{provider:clean(x.emissionProvider,120),environment:x.emissionEnvironment==='producao'?'producao':'homologacao',baseUrl:clean(x.emissionBaseUrl,500),token:decryptSecret(x.emissionTokenEnc),clientId:decryptSecret(x.emissionClientIdEnc),clientSecret:decryptSecret(x.emissionClientSecretEnc),username:decryptSecret(x.emissionUsernameEnc),password:decryptSecret(x.emissionPasswordEnc)};
  }
  return{get,mascot,setMascot,clearMascot,setEmission,clearEmission,emissionCredentials};
}
export default createErpFiscalSettingsService;
