import mongoose from 'mongoose';

const clean=(v='',m=500)=>String(v??'').trim().slice(0,m);
const digits=(v='')=>String(v??'').replace(/\D/g,'');
const stripAccents=(v='')=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const nameKey=(v='')=>stripAccents(clean(v,220)).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();

function monthRange(dateKey=''){
  const m=String(dateKey||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m)return null;
  const year=Number(m[1]),month=Number(m[2]);
  const start=new Date(m[1]+'-'+m[2]+'-01T00:00:00-03:00');
  const nextMonth=month===12?1:month+1;
  const nextYear=month===12?year+1:year;
  const end=new Date(String(nextYear).padStart(4,'0')+'-'+String(nextMonth).padStart(2,'0')+'-01T00:00:00-03:00');
  return{monthKey:m[1]+'-'+m[2],start,end};
}

function firstDocument(rows=[]){
  for(const row of Array.isArray(rows)?rows:[]){
    const value=digits(row?.customerDocument||row?.personDocument||row?.document||row?.clientDocument||'');
    if(value)return value;
  }
  return'';
}

export function monthlyContactIdentity(input={}){
  const document=digits(input.document||input.customerDocument||input.clientDocument||'')||firstDocument(input.rows);
  const name=nameKey(input.customerName||input.clientName||input.name||input.personName||'');
  const phone=digits(input.phone||input.customerPhone||input.clientPhone||'');
  const sourceKey=clean(input.customerKey||input.key||'',220);
  const canonical=document?'doc:'+document:(name?'name:'+name:(phone?'phone:'+phone:sourceKey));
  const aliases=new Set();
  if(canonical)aliases.add(canonical);
  if(sourceKey)aliases.add(sourceKey);
  if(document)aliases.add('doc:'+document);
  if(name)aliases.add('name:'+name);
  if(phone)aliases.add('phone:'+phone);
  return{canonical,aliases:[...aliases],document,name,phone,sourceKey};
}

function sameIdentity(record={},identity={}){
  const aliases=new Set(identity.aliases||[]);
  const doc=digits(record.customerDocument||record.clientDocument||record.document||'');
  const nm=nameKey(record.customerName||record.clientName||record.name||record.matchedName||'');
  const ph=digits(record.phone||record.customerPhone||record.clientPhone||'');
  const candidateKeys=[
    clean(record.customerKey||record.key||'',220),
    doc?'doc:'+doc:'',
    nm?'name:'+nm:'',
    ph?'phone:'+ph:''
  ].filter(Boolean);
  return candidateKeys.some(key=>aliases.has(key));
}

async function settingHistory(Setting,range,identity){
  if(!Setting)return null;
  const prefixes=[
    'erp_daily_due_whatsapp:'+range.monthKey+'-',
    'erp_15_day_collection_whatsapp:'+range.monthKey+'-'
  ];
  const query={$or:prefixes.map(prefix=>({key:{$gte:prefix,$lt:prefix+'\uffff'}}))};
  const rows=await Setting.find(query).lean().catch(()=>[]);
  for(const row of rows){
    const value=row?.value||{};
    if(String(value.status||'').toLowerCase()!=='sent')continue;
    if(sameIdentity(value,identity))return{source:String(row.key||'').startsWith('erp_daily_due_whatsapp:')?'vencimento_do_dia':'cobranca_15_dias',at:value.sentAt||row.updatedAt||row.createdAt||null,key:row.key||''};
  }
  return null;
}

async function manualChargeHistory(range,identity){
  const db=mongoose.connection?.db;
  if(!db)return null;
  const rows=await db.collection('erp_delinquency_charge_logs').find({
    status:'SENT',
    sentAt:{$gte:range.start,$lt:range.end}
  }).project({clientName:1,clientDocument:1,clientPhone:1,sentAt:1,targetId:1}).limit(5000).toArray().catch(()=>[]);
  for(const row of rows){
    if(sameIdentity(row,identity))return{source:'cobranca_manual_atrasados',at:row.sentAt||null,key:String(row.targetId||'')};
  }
  return null;
}

async function markedCampaignHistory(range,identity){
  const db=mongoose.connection?.db;
  if(!db)return null;
  const rows=await db.collection('erp_marked_collection_tasks').find({
    initialSentAt:{$gte:range.start,$lt:range.end}
  }).project({name:1,matchedName:1,document:1,phone:1,initialSentAt:1,campaignKey:1}).limit(5000).toArray().catch(()=>[]);
  for(const row of rows){
    if(sameIdentity({
      customerName:row.matchedName||row.name,
      customerDocument:row.document,
      phone:row.phone
    },identity))return{source:'campanha_cobranca',at:row.initialSentAt||null,key:String(row.campaignKey||'')};
  }
  return null;
}

export async function findMonthlyFinancialContact(context={},input={}){
  const Setting=context.Setting||mongoose.models.Setting||null;
  const dateKey=clean(input.dateKey,10);
  const range=monthRange(dateKey);
  const identity=monthlyContactIdentity(input);
  if(!range||!identity.canonical)return null;

  const monthlyKey='erp_monthly_financial_contact:'+range.monthKey+':'+identity.canonical.replace(/[^a-z0-9:_-]+/gi,'_').slice(0,180);
  if(Setting){
    const existing=await Setting.findOne({key:monthlyKey}).lean().catch(()=>null);
    if(existing&&['sending','sent'].includes(String(existing?.value?.status||'').toLowerCase())){
      return{source:existing?.value?.source||'monthly_guard',at:existing?.value?.sentAt||existing?.value?.attemptedAt||existing?.updatedAt||null,key:monthlyKey,monthlyKey,identity};
    }
  }

  const priorSetting=await settingHistory(Setting,range,identity);
  if(priorSetting)return{...priorSetting,monthlyKey,identity};
  const priorManual=await manualChargeHistory(range,identity);
  if(priorManual)return{...priorManual,monthlyKey,identity};
  const priorCampaign=await markedCampaignHistory(range,identity);
  if(priorCampaign)return{...priorCampaign,monthlyKey,identity};
  return null;
}

export async function claimMonthlyFinancialContact(context={},input={}){
  const Setting=context.Setting||mongoose.models.Setting||null;
  if(!Setting)return{claimed:true,guardUnavailable:true,key:'',identity:monthlyContactIdentity(input)};
  const prior=await findMonthlyFinancialContact({...context,Setting},input);
  if(prior)return{claimed:false,prior,identity:prior.identity,key:prior.monthlyKey||''};

  const range=monthRange(clean(input.dateKey,10));
  const identity=monthlyContactIdentity(input);
  if(!range||!identity.canonical)return{claimed:true,guardUnavailable:true,key:'',identity};
  const key='erp_monthly_financial_contact:'+range.monthKey+':'+identity.canonical.replace(/[^a-z0-9:_-]+/gi,'_').slice(0,180);
  try{
    await Setting.create({
      key,
      value:{
        status:'sending',
        month:range.monthKey,
        source:clean(input.source,80)||'financeiro',
        customerKey:identity.sourceKey||identity.canonical,
        customerName:clean(input.customerName||input.clientName||input.name,220),
        customerDocument:identity.document,
        phone:identity.phone,
        attemptedAt:new Date()
      },
      updatedBy:clean(input.updatedBy,120)||'erp-monthly-financial-guard'
    });
    return{claimed:true,key,identity};
  }catch(error){
    if(Number(error?.code)===11000){
      const existing=await Setting.findOne({key}).lean().catch(()=>null);
      return{claimed:false,key,identity,prior:{source:existing?.value?.source||'monthly_guard',at:existing?.value?.sentAt||existing?.value?.attemptedAt||null,key}};
    }
    throw error;
  }
}

export async function confirmMonthlyFinancialContact(context={},claim={},extra={}){
  const Setting=context.Setting||mongoose.models.Setting||null;
  if(!Setting||!claim?.key)return;
  const set={
    'value.status':'sent',
    'value.sentAt':extra.sentAt||new Date(),
    'value.messageId':clean(extra.messageId,220),
    updatedBy:clean(extra.updatedBy,120)||'erp-monthly-financial-guard'
  };
  if(clean(extra.source,80))set['value.source']=clean(extra.source,80);
  await Setting.updateOne({key:claim.key},{$set:set}).catch(()=>null);
}

export async function releaseMonthlyFinancialContact(context={},claim={}){
  const Setting=context.Setting||mongoose.models.Setting||null;
  if(!Setting||!claim?.key)return;
  await Setting.deleteOne({key:claim.key,'value.status':'sending'}).catch(()=>null);
}

export default {
  monthlyContactIdentity,
  findMonthlyFinancialContact,
  claimMonthlyFinancialContact,
  confirmMonthlyFinancialContact,
  releaseMonthlyFinancialContact
};
