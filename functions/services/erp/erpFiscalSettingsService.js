import { readFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import tls from 'node:tls';
import mongoose from 'mongoose';
import sharp from 'sharp';

const base={timestamps:true,versionKey:false,minimize:false};
const schema=new mongoose.Schema({
  key:{type:String,default:'default',unique:true,index:true},
  mascotJpeg:{type:String,default:''},mascotUpdatedAt:Date,
  emissionProvider:{type:String,default:''},emissionEnvironment:{type:String,default:'homologacao'},emissionBaseUrl:{type:String,default:''},
  emissionTokenEnc:{type:String,default:''},emissionClientIdEnc:{type:String,default:''},emissionClientSecretEnc:{type:String,default:''},emissionUsernameEnc:{type:String,default:''},emissionPasswordEnc:{type:String,default:''},
  a1PfxEnc:{type:String,default:''},a1PasswordEnc:{type:String,default:''},a1Filename:{type:String,default:''},a1UploadedAt:Date,a1Size:{type:Number,default:0},
  fiscalCnpj:{type:String,default:''},fiscalIe:{type:String,default:''},fiscalRazaoSocial:{type:String,default:''},fiscalNomeFantasia:{type:String,default:''},fiscalCrt:{type:Number,default:0},
  fiscalSerie:{type:Number,default:1},fiscalNextNumber:{type:Number,default:1},fiscalNaturezaOperacao:{type:String,default:'Venda de mercadoria'},
  fiscalLogradouro:{type:String,default:''},fiscalNumero:{type:String,default:''},fiscalComplemento:{type:String,default:''},fiscalBairro:{type:String,default:''},fiscalCodigoMunicipio:{type:String,default:''},fiscalMunicipio:{type:String,default:''},fiscalUf:{type:String,default:'MG'},fiscalCep:{type:String,default:''},fiscalPhone:{type:String,default:''},
  fiscalCsosn:{type:String,default:''},fiscalIcmsCst:{type:String,default:''},fiscalPisCst:{type:String,default:''},fiscalCofinsCst:{type:String,default:''},fiscalDefaultCfop:{type:String,default:''},fiscalDefaultUnit:{type:String,default:'UN'},fiscalProductOrigin:{type:String,default:''},
  emissionUpdatedAt:Date,emissionUpdatedBy:String,updatedBy:String
},base);
const Settings=mongoose.models.ErpFiscalSettings||mongoose.model('ErpFiscalSettings',schema);
const clean=(v='',m=200)=>String(v??'').trim().slice(0,m);
const digits=(v='')=>String(v??'').replace(/\D/g,'');
function fail(message,statusCode=400,code='ERP_FISCAL_SETTINGS_ERROR'){const e=new Error(message);e.statusCode=statusCode;e.code=code;return e}
let officialLogoPromise=null;
function encryptionSecret(){return String(process.env.ERP_FISCAL_CREDENTIALS_KEY||process.env.JWT_SECRET||'').trim()}
function encryptionKey(){const secret=encryptionSecret();if(!secret)throw fail('Configure ERP_FISCAL_CREDENTIALS_KEY ou JWT_SECRET no servidor antes de salvar o certificado A1.',503,'ERP_FISCAL_ENCRYPTION_KEY_MISSING');return crypto.createHash('sha256').update(secret).digest()}
function encryptSecret(value=''){const plain=String(value??'');if(!plain)return'';const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',encryptionKey(),iv),body=Buffer.concat([cipher.update(plain,'utf8'),cipher.final()]),tag=cipher.getAuthTag();return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${body.toString('base64')}`}
function decryptSecret(value=''){const raw=String(value||'');if(!raw)return'';const [version,iv64,tag64,body64]=raw.split(':');if(version!=='v1'||!iv64||!tag64||!body64)throw fail('Credencial fiscal armazenada em formato inválido.',500,'ERP_FISCAL_CREDENTIAL_INVALID');const decipher=crypto.createDecipheriv('aes-256-gcm',encryptionKey(),Buffer.from(iv64,'base64'));decipher.setAuthTag(Buffer.from(tag64,'base64'));return Buffer.concat([decipher.update(Buffer.from(body64,'base64')),decipher.final()]).toString('utf8')}
function emissionPublic(x){
  const a1Configured=Boolean(x.a1PfxEnc&&x.a1PasswordEnc);return{
    type:'sefaz_a1',environment:x.emissionEnvironment==='producao'?'producao':'homologacao',encryptionReady:Boolean(encryptionSecret()),serie:Number(x.fiscalSerie||1),nextNumber:Number(x.fiscalNextNumber||1),
    a1:{configured:a1Configured,filename:clean(x.a1Filename,255),uploadedAt:x.a1UploadedAt||null,size:Number(x.a1Size||0)},
    issuer:{cnpj:digits(x.fiscalCnpj),ie:clean(x.fiscalIe,40),razaoSocial:clean(x.fiscalRazaoSocial,180),nomeFantasia:clean(x.fiscalNomeFantasia,180),crt:Number(x.fiscalCrt||0),naturezaOperacao:clean(x.fiscalNaturezaOperacao,120),logradouro:clean(x.fiscalLogradouro,180),numero:clean(x.fiscalNumero,60),complemento:clean(x.fiscalComplemento,120),bairro:clean(x.fiscalBairro,120),codigoMunicipio:digits(x.fiscalCodigoMunicipio),municipio:clean(x.fiscalMunicipio,120),uf:clean(x.fiscalUf||'MG',2).toUpperCase(),cep:digits(x.fiscalCep),phone:digits(x.fiscalPhone)},
    taxation:{csosn:clean(x.fiscalCsosn,3),icmsCst:clean(x.fiscalIcmsCst,3),pisCst:clean(x.fiscalPisCst,2),cofinsCst:clean(x.fiscalCofinsCst,2),defaultCfop:digits(x.fiscalDefaultCfop),defaultUnit:clean(x.fiscalDefaultUnit||'UN',10).toUpperCase(),productOrigin:clean(x.fiscalProductOrigin,10)},
    configured:a1Configured&&Boolean(digits(x.fiscalCnpj)&&clean(x.fiscalIe)&&Number(x.fiscalCrt||0)&&Number(x.fiscalSerie||0)&&Number(x.fiscalNextNumber||0)),updatedAt:x.emissionUpdatedAt||null,updatedBy:clean(x.emissionUpdatedBy,180)
  }
}

async function validateImage(buffer){
  if(!Buffer.isBuffer(buffer)||!buffer.length)throw fail('Selecione uma imagem para a mascote.');
  try{const metadata=await sharp(buffer,{failOn:'error'}).metadata();if(!['jpeg','png','webp'].includes(String(metadata.format||'').toLowerCase()))throw fail('Envie a mascote em PNG, JPG/JPEG ou WebP.');return metadata;}catch(error){if(error?.code==='ERP_FISCAL_SETTINGS_ERROR')throw error;throw fail('Não foi possível processar a mascote. Envie um arquivo PNG, JPG/JPEG ou WebP válido.');}
}
async function normalizeMascot(buffer){
  await validateImage(buffer);try{const jpeg=await sharp(buffer,{failOn:'error'}).rotate().resize({width:480,height:500,fit:'contain',background:{r:255,g:255,b:255,alpha:1}}).flatten({background:{r:255,g:255,b:255}}).jpeg({quality:90,chromaSubsampling:'4:4:4'}).toBuffer();if(jpeg.length>900*1024)throw fail('A imagem otimizada da mascote deve ter no máximo 900 KB.',413,'ERP_MASCOT_TOO_LARGE');return jpeg;}catch(error){if(error?.code==='ERP_FISCAL_SETTINGS_ERROR'||error?.code==='ERP_MASCOT_TOO_LARGE')throw error;throw fail('Não foi possível processar a mascote. Envie um arquivo PNG, JPG/JPEG ou WebP válido.');}
}
async function composeDanfeLogo(mascotBuffer){
  await validateImage(mascotBuffer);const mascot=await sharp(mascotBuffer,{failOn:'error'}).rotate().resize({width:176,height:190,fit:'contain',background:{r:255,g:255,b:255,alpha:0}}).png().toBuffer();
  const brandSvg=Buffer.from(`
    <svg width="570" height="190" viewBox="0 0 570 190" xmlns="http://www.w3.org/2000/svg">
      <rect width="570" height="190" fill="#ffffff"/>
      <text x="8" y="83" font-family="Arial, Helvetica, sans-serif" font-size="78" font-style="italic" font-weight="900" letter-spacing="-3" fill="#2E6DA4">ARIANA</text>
      <text x="340" y="83" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="900" letter-spacing="1" fill="#56B5FF">MÓVEIS</text>
      <text x="12" y="126" font-family="Arial, Helvetica, sans-serif" font-size="23" font-weight="700" letter-spacing="1.2" fill="#2E6DA4">Sua casa merece o melhor.</text>
    </svg>
  `);
  const jpeg=await sharp({create:{width:760,height:210,channels:3,background:{r:255,g:255,b:255}}}).composite([{input:mascot,left:0,top:10},{input:brandSvg,left:178,top:10}]).jpeg({quality:95,chromaSubsampling:'4:4:4'}).toBuffer();if(jpeg.length>900*1024)throw fail('A identidade visual otimizada do DANFE excedeu o limite de 900 KB.',413,'ERP_MASCOT_TOO_LARGE');return jpeg;
}
async function officialLogo(){if(!officialLogoPromise){officialLogoPromise=(async()=>{try{let mascot;try{mascot=await readFile(new URL('../../../public/assets/imagens/avatar-ariana.png',import.meta.url));}catch{mascot=await readFile(new URL('../../assets/mascote.png',import.meta.url));}return await composeDanfeLogo(mascot);}catch(error){console.warn('[erp-fiscal-settings/official-logo]',error?.message||error);return null;}})();}return officialLogoPromise}

export function createErpFiscalSettingsService(context={}){
  const {IntegrationAuditLog,redact}=context;
  async function audit(eventType,metadata={}){if(!IntegrationAuditLog)return;try{await IntegrationAuditLog.create({scope:'erp_ariana',eventType,status:'ok',message:clean(metadata.message,500),metadata:redact?redact(metadata):metadata})}catch(e){console.warn('[erp-fiscal-settings/audit]',e.message)}}
  async function row(){return Settings.findOneAndUpdate({key:'default'},{$setOnInsert:{key:'default'}},{upsert:true,new:true,setDefaultsOnInsert:true})}
  async function get(){const x=await row();return{hasMascot:Boolean(x.mascotJpeg),mascotUpdatedAt:x.mascotUpdatedAt||null,emission:emissionPublic(x)}}
  async function mascot(){const x=await row();if(x.mascotJpeg){try{const custom=Buffer.from(x.mascotJpeg,'base64');if(custom.length)return await composeDanfeLogo(custom)}catch(error){console.warn('[erp-fiscal-settings/custom-logo]',error?.message||error)}}return officialLogo()}
  async function setMascot(buffer,actor={}){const jpeg=await normalizeMascot(buffer),who=clean(actor.name||actor.nome||actor.email||'Operador',180),now=new Date();await Settings.updateOne({key:'default'},{$set:{mascotJpeg:jpeg.toString('base64'),mascotUpdatedAt:now,updatedBy:who},$setOnInsert:{key:'default'}},{upsert:true});await audit('erp.fiscal.mascot.updated',{message:'Mascote do DANFE atualizada',by:who,size:jpeg.length});return get()}
  async function clearMascot(actor={}){const who=clean(actor.name||actor.nome||actor.email||'Operador',180);await Settings.updateOne({key:'default'},{$set:{mascotJpeg:'',mascotUpdatedAt:new Date(),updatedBy:who},$setOnInsert:{key:'default'}},{upsert:true});await audit('erp.fiscal.mascot.cleared',{message:'Mascote personalizada removida; identidade visual oficial do DANFE restaurada',by:who});return get()}

  async function setFiscalConfig(payload={},actor={}){
    const x=await row(),who=clean(actor.name||actor.nome||actor.email||'Operador',180),environment=String((payload.environment??x.emissionEnvironment)||'homologacao').toLowerCase()==='producao'?'producao':'homologacao';
    const serie=Number(payload.serie??x.fiscalSerie??1),nextNumber=Number(payload.nextNumber??x.fiscalNextNumber??1),crt=Number(payload.crt??x.fiscalCrt??0);
    if(!Number.isInteger(serie)||serie<1||serie>999)throw fail('A série da NF-e deve ser um número inteiro entre 1 e 999.');if(!Number.isInteger(nextNumber)||nextNumber<1||nextNumber>999999999)throw fail('O próximo número da NF-e deve ser um inteiro válido.');if(crt&&![1,2,3,4].includes(crt))throw fail('CRT inválido. Use 1, 2, 3 ou 4.');
    const cnpj=digits(payload.cnpj??x.fiscalCnpj);if(cnpj&&cnpj.length!==14)throw fail('O CNPJ do emitente deve ter 14 dígitos.');const cep=digits(payload.cep??x.fiscalCep);if(cep&&cep.length!==8)throw fail('O CEP do emitente deve ter 8 dígitos.');const uf=clean(payload.uf??x.fiscalUf??'MG',2).toUpperCase();if(uf&&uf!=='MG')throw fail('Esta integração foi preparada para a SEFAZ de Minas Gerais (MG).');
    const set={emissionEnvironment:environment,fiscalCnpj:cnpj,fiscalIe:clean(payload.ie??x.fiscalIe,40),fiscalRazaoSocial:clean(payload.razaoSocial??x.fiscalRazaoSocial,180),fiscalNomeFantasia:clean(payload.nomeFantasia??x.fiscalNomeFantasia,180),fiscalCrt:crt,fiscalSerie:serie,fiscalNextNumber:nextNumber,fiscalNaturezaOperacao:clean(payload.naturezaOperacao??x.fiscalNaturezaOperacao??'Venda de mercadoria',120),fiscalLogradouro:clean(payload.logradouro??x.fiscalLogradouro,180),fiscalNumero:clean(payload.numero??x.fiscalNumero,60),fiscalComplemento:clean(payload.complemento??x.fiscalComplemento,120),fiscalBairro:clean(payload.bairro??x.fiscalBairro,120),fiscalCodigoMunicipio:digits(payload.codigoMunicipio??x.fiscalCodigoMunicipio),fiscalMunicipio:clean(payload.municipio??x.fiscalMunicipio,120),fiscalUf:uf||'MG',fiscalCep:cep,fiscalPhone:digits(payload.phone??x.fiscalPhone),fiscalCsosn:clean(payload.csosn??x.fiscalCsosn,3),fiscalIcmsCst:clean(payload.icmsCst??x.fiscalIcmsCst,3),fiscalPisCst:clean(payload.pisCst??x.fiscalPisCst,2),fiscalCofinsCst:clean(payload.cofinsCst??x.fiscalCofinsCst,2),fiscalDefaultCfop:digits(payload.defaultCfop??x.fiscalDefaultCfop).slice(0,4),fiscalDefaultUnit:clean(payload.defaultUnit??x.fiscalDefaultUnit??'UN',10).toUpperCase(),fiscalProductOrigin:clean(payload.productOrigin??x.fiscalProductOrigin,10),emissionUpdatedAt:new Date(),emissionUpdatedBy:who};
    await Settings.updateOne({key:'default'},{$set:set,$setOnInsert:{key:'default'}},{upsert:true});await audit('erp.fiscal.sefaz.config.updated',{message:'Configuração fiscal SEFAZ atualizada',by:who,environment,serie,nextNumber,crt});return get();
  }
  async function setA1(buffer,password,filename='',actor={}){
    if(!Buffer.isBuffer(buffer)||!buffer.length)throw fail('Selecione o certificado A1 (.pfx ou .p12).');if(buffer.length>5*1024*1024)throw fail('O certificado A1 deve ter no máximo 5 MB.',413,'ERP_A1_TOO_LARGE');const name=clean(filename,255),ext=name.toLowerCase().split('.').pop();if(name&&!['pfx','p12'].includes(ext))throw fail('Envie um certificado A1 no formato .pfx ou .p12.');if(!String(password||''))throw fail('Informe a senha do certificado A1.');
    try{tls.createSecureContext({pfx:buffer,passphrase:String(password),minVersion:'TLSv1.2'});}catch(error){throw fail('Não foi possível abrir o certificado A1. Confira o arquivo e a senha.',400,'ERP_A1_INVALID')}
    const who=clean(actor.name||actor.nome||actor.email||'Operador',180),now=new Date();await Settings.updateOne({key:'default'},{$set:{a1PfxEnc:encryptSecret(buffer.toString('base64')),a1PasswordEnc:encryptSecret(String(password)),a1Filename:name||'certificado-a1.pfx',a1UploadedAt:now,a1Size:buffer.length,emissionUpdatedAt:now,emissionUpdatedBy:who},$setOnInsert:{key:'default'}},{upsert:true});await audit('erp.fiscal.a1.updated',{message:'Certificado digital A1 atualizado',by:who,filename:name,size:buffer.length});return get();
  }
  async function clearA1(actor={}){const who=clean(actor.name||actor.nome||actor.email||'Operador',180),now=new Date();await Settings.updateOne({key:'default'},{$set:{a1PfxEnc:'',a1PasswordEnc:'',a1Filename:'',a1UploadedAt:null,a1Size:0,emissionUpdatedAt:now,emissionUpdatedBy:who}},{upsert:true});await audit('erp.fiscal.a1.cleared',{message:'Certificado A1 removido',by:who});return get()}
  async function certificateCredentials(){const x=await row();if(!x.a1PfxEnc||!x.a1PasswordEnc)throw fail('Certificado digital A1 não cadastrado.',409,'ERP_A1_MISSING');return{pfx:Buffer.from(decryptSecret(x.a1PfxEnc),'base64'),password:decryptSecret(x.a1PasswordEnc),filename:clean(x.a1Filename,255),environment:x.emissionEnvironment==='producao'?'producao':'homologacao'}}
  async function reserveNfeNumber(actor={}){const who=clean(actor.name||actor.nome||actor.email||'Operador',180);const before=await Settings.findOneAndUpdate({key:'default'},{$inc:{fiscalNextNumber:1},$set:{emissionUpdatedAt:new Date(),emissionUpdatedBy:who},$setOnInsert:{key:'default',fiscalSerie:1}},{upsert:true,new:false,setDefaultsOnInsert:true});const reserved=Math.max(1,Number(before?.fiscalNextNumber||1));await audit('erp.fiscal.nfe.number.reserved',{message:`Número de NF-e ${reserved} reservado`,by:who,number:reserved});return reserved}
  return{get,mascot,setMascot,clearMascot,setFiscalConfig,setA1,clearA1,certificateCredentials,reserveNfeNumber};
}
export default createErpFiscalSettingsService;
