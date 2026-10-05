import mongoose from 'mongoose';
import { createErpCollectionWorkflowService } from './erpCollectionWorkflowService.js';
import { claimMonthlyFinancialContact, confirmMonthlyFinancialContact, releaseMonthlyFinancialContact } from './erpMonthlyCollectionGuardService.js';

const CAMPAIGN_KEY='etapa4_x_2026_10_05';
const NAME='Maria Eloisa dos Santos Chaves';
const NAME_KEY='maria eloisa dos santos chaves';
const DOCUMENT='11026285658';
const TZ='America/Sao_Paulo';
const clean=(v='',m=1000)=>String(v??'').trim().replace(/\s+/g,' ').slice(0,m);
const digits=v=>String(v??'').replace(/\D/g,'');
const money=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
const moneyText=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const firstName=v=>clean(v||'cliente',220).split(/\s+/).filter(Boolean)[0]||'cliente';
function localDateKey(date=new Date()){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);const x=Object.fromEntries(parts.filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));return `${x.year}-${x.month}-${x.day}`}
function normalizePhone(value=''){let n=digits(value).replace(/^0+/,'');if(!n)return'';if(n.startsWith('55')&&n.length>=12&&n.length<=13)return n;if(n.length===10||n.length===11)return`55${n}`;return n.length>=12&&n.length<=15?n:''}
function extractMessageId(data={}){return clean(data?.key?.id||data?.messageId||data?.id||data?.data?.key?.id||data?.data?.messageId||data?.response?.key?.id,220)}
async function readEvolutionResponse(response){const raw=await response.text();let data={};try{data=raw?JSON.parse(raw):{}}catch{data={message:raw}}if(!response.ok)throw new Error(clean(data?.message||data?.error||raw||`HTTP ${response.status}`,600));return data}

export function createErpStage4MariaEloisaRecoveryService(context={}){
  const collections=createErpCollectionWorkflowService(context);

  async function whatsappConfig(){
    let base=clean(process.env.ERP_COLLECTION_EVOLUTION_API_URL||process.env.ARIANA_EVOLUTION_API_URL||process.env.EVOLUTION_API_URL||process.env.EVOLUTION_URL,500).replace(/\/+$/,'');
    let apiKey=clean(process.env.ERP_COLLECTION_EVOLUTION_API_KEY||process.env.ARIANA_EVOLUTION_API_KEY||process.env.EVOLUTION_API_KEY||process.env.EVOLUTION_GLOBAL_API_KEY,500);
    if(typeof context.getWhatsappSettings==='function'){
      try{const s=await context.getWhatsappSettings();base=base||clean(s?.apiUrl||'',500).replace(/\/+$/,'');apiKey=apiKey||clean(s?.apiKey||'',500)}catch{}
    }
    const instance=clean(process.env.ERP_COLLECTION_MAIN_STORE_EVOLUTION_INSTANCE||process.env.ERP_DAILY_DUE_WHATSAPP_INSTANCE||process.env.LOJA_EVOLUTION_INSTANCE||'ariana loja',180);
    return{base,apiKey,instance};
  }

  async function resolvePhone(client={}){
    const direct=normalizePhone(client.phone);if(direct)return{phone:direct,source:'receivable'};
    const Person=mongoose.models.ErpPerson;
    if(Person){const p=await Person.findOne({document:DOCUMENT,active:{$ne:false}}).sort({updatedAt:-1}).select('phone').lean().catch(()=>null);const phone=normalizePhone(p?.phone);if(phone)return{phone,source:'erp_person_document'}}
    if(context.User){const rows=await context.User.find({cpf:DOCUMENT,isActive:{$ne:false}}).select('phone updatedAt').sort({updatedAt:-1}).limit(20).lean().catch(()=>[]);const phones=[...new Set(rows.map(r=>normalizePhone(r?.phone)).filter(Boolean))];if(phones.length===1)return{phone:phones[0],source:'site_user_document'}}
    if(context.CrediarioCliente){const rows=await context.CrediarioCliente.find({cpf:DOCUMENT}).select('telefone phone updatedAt').sort({updatedAt:-1}).limit(20).lean().catch(()=>[]);const phones=[...new Set(rows.map(r=>normalizePhone(r?.telefone||r?.phone)).filter(Boolean))];if(phones.length===1)return{phone:phones[0],source:'crediario_document'}}
    if(context.Order){const rows=await context.Order.find({customerCpf:DOCUMENT,customerPhone:{$exists:true,$ne:''}}).select('customerPhone updatedAt').sort({updatedAt:-1}).limit(30).lean().catch(()=>[]);const phones=[...new Set(rows.map(r=>normalizePhone(r?.customerPhone)).filter(Boolean))];if(phones.length===1)return{phone:phones[0],source:'order_document'};const latest=normalizePhone(rows[0]?.customerPhone);if(latest)return{phone:latest,source:'order_document_latest'}}
    return{phone:'',source:''};
  }

  async function run(){
    if(mongoose.connection.readyState!==1)return{skipped:true,reason:'mongo_not_ready'};
    const db=mongoose.connection.db;
    const Task=db.collection('erp_marked_collection_tasks');
    const task=await Task.findOne({campaignKey:CAMPAIGN_KEY,nameKey:NAME_KEY});
    if(!task)return{skipped:true,reason:'task_not_seeded'};
    if(task.initialSentAt)return{ok:true,alreadySent:true,status:'SENT'};

    const queue=await collections.fila({from:'2000-01-01',to:localDateKey(),filter:'all'});
    const matches=(queue.clients||[]).filter(c=>digits(c.document)===DOCUMENT);
    if(matches.length!==1){await Task.updateOne({_id:task._id},{$set:{status:'AMBIGUOUS',lastError:`Documento ${DOCUMENT} encontrou ${matches.length} cadastro(s) em aberto; envio bloqueado.`}});return{ok:false,status:'AMBIGUOUS',matches:matches.length}}
    const client=matches[0];
    const contact=await resolvePhone(client);
    const phone=contact.phone;
    const targetId=clean(client.entries?.[0]?.id||'',260);
    const details={matchedName:clean(client.name,220),resolution:'document_override',document:DOCUMENT,phone,phoneSource:contact.source||'',targetId,overduePrincipal:money(client.totalOverdue),overdueUpdated:money(client.totalUpdated),overdueInstallments:Number(client.entries?.length||0),maxDaysLate:Number(client.maxDaysLate||0),lastError:''};
    await Task.updateOne({_id:task._id},{$set:details});
    if(!phone){await Task.updateOne({_id:task._id},{$set:{status:'NO_PHONE',lastError:'Cliente sem WhatsApp válido no cadastro atual do ERP.'}});return{ok:false,status:'NO_PHONE',document:DOCUMENT}}
    if(!targetId||Number(client.totalUpdated||0)<=0){await Task.updateOne({_id:task._id},{$set:{status:'NO_DEBT',lastError:'Nenhum saldo vencido disponível para cobrança.'}});return{ok:false,status:'NO_DEBT'}}

    const monthlyClaim=await claimMonthlyFinancialContact(context,{dateKey:localDateKey(),source:'campanha_'+CAMPAIGN_KEY,customerName:client.name,customerDocument:DOCUMENT,phone,customerKey:client.key||NAME_KEY,rows:client.entries||[],updatedBy:'erp-stage4-maria-recovery'});
    if(!monthlyClaim.claimed){const source=clean(monthlyClaim?.prior?.source||'contato financeiro anterior',120);await Task.updateOne({_id:task._id},{$set:{status:'SKIPPED_MONTHLY_CONTACT',lastError:'Cliente já recebeu lembrete/cobrança neste mês: '+source}});return{ok:true,status:'SKIPPED_MONTHLY_CONTACT',priorSource:source}}

    const message=[`Olá, ${firstName(client.name)}! Tudo bem?`,'',`Consta no financeiro da Ariana Móveis um saldo vencido atualizado de *${moneyText(client.totalUpdated)}*.`,'Você consegue me informar uma previsão de pagamento, por favor?','','Se já tiver regularizado, desconsidere esta mensagem.','Marcelo – Ariana Móveis.'].join('\n');
    try{
      const cfg=await whatsappConfig();
      if(!cfg.base||!cfg.apiKey||!cfg.instance)throw new Error('WhatsApp da cobrança não está configurado corretamente.');
      const response=await fetch(`${cfg.base}/message/sendText/${encodeURIComponent(cfg.instance)}`,{method:'POST',headers:{'Content-Type':'application/json',apikey:cfg.apiKey},body:JSON.stringify({number:phone,text:message,delay:0,linkPreview:false}),signal:AbortSignal.timeout(30000)});
      const data=await readEvolutionResponse(response);const messageId=extractMessageId(data);const sentAt=new Date();
      await Task.updateOne({_id:task._id},{$set:{...details,status:'AWAITING_REPLY',initialMessage:message,initialMessageId:messageId,initialSentAt:sentAt,lockUntil:null,lastError:''},$inc:{attempts:1}});
      await confirmMonthlyFinancialContact(context,monthlyClaim,{sentAt,source:'campanha_'+CAMPAIGN_KEY,messageId,updatedBy:'erp-stage4-maria-recovery'});
      console.log('[erp-stage4-maria-recovery] envio aceito',{name:NAME,document:DOCUMENT,instance:cfg.instance,messageId});
      return{ok:true,status:'SENT',messageId};
    }catch(error){await releaseMonthlyFinancialContact(context,monthlyClaim);await Task.updateOne({_id:task._id},{$set:{status:'FAILED',lastError:clean(error?.message||error,1000)},$inc:{attempts:1}}).catch(()=>null);console.error('[erp-stage4-maria-recovery]',error?.message||error);return{ok:false,status:'FAILED',error:clean(error?.message||error,300)}}
  }

  function start(){
    if(globalThis.__erpStage4MariaEloisaRecoveryStarted)return;
    globalThis.__erpStage4MariaEloisaRecoveryStarted=true;
    let attempts=0;
    const tick=async()=>{
      attempts+=1;
      try{
        const result=await run();
        if(!result?.skipped){console.log('[erp-stage4-maria-recovery][result]',result);return}
        if(attempts>=20){console.warn('[erp-stage4-maria-recovery] não executado',result);return}
      }catch(error){
        console.error('[erp-stage4-maria-recovery][tick]',error?.message||error);
        if(attempts>=20)return;
      }
      const timer=setTimeout(tick,3000);timer.unref?.();
    };
    const timer=setTimeout(tick,2500);timer.unref?.();
  }
  return{run,start};
}

export default createErpStage4MariaEloisaRecoveryService;
