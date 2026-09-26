import mongoose from 'mongoose';
import { createErpDelinquencyReportService } from './erpDelinquencyReportService.js';
import { getErpSettingsSnapshot } from './erpSettingsService.js';

const TZ='America/Sao_Paulo';
const clean=(v='',m=1000)=>String(v??'').trim().replace(/\s+/g,' ').slice(0,m);
const money=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
const arr=v=>Array.isArray(v)?v:[];
const digits=v=>String(v??'').replace(/\D/g,'');
const ACTIONS=new Set(['promessa','tratativa','concluir','adiar','sem_contato']);

function fail(message,statusCode=400,code='ERP_COLLECTION_ERROR'){const e=new Error(message);e.statusCode=statusCode;e.code=code;return e}
function actorName(a={}){return clean(a.name||a.fullName||a.displayName||a.email||'Operador',160)}
function dateOnly(value,label='Data'){
  if(value===null||value===undefined||value==='')return null;
  const s=clean(value,20);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw fail(`${label} inválida.`,400,'INVALID_COLLECTION_DATE');
  const d=new Date(`${s}T12:00:00-03:00`);
  if(Number.isNaN(d.getTime()))throw fail(`${label} inválida.`,400,'INVALID_COLLECTION_DATE');
  return d;
}
function localIso(value=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(value);
  const x=Object.fromEntries(parts.filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  return`${x.year}-${x.month}-${x.day}`;
}
function isoOf(value){if(!value)return'';return localIso(new Date(value))}
function compareIso(a,b){return String(a||'').localeCompare(String(b||''))}
function band(days=0){const d=Number(days||0);if(d<=30)return'ate30';if(d<=60)return'31-60';if(d<=90)return'61-90';return'90mais'}
function bandLabel(v){return({ate30:'Até 30 dias','31-60':'31 a 60 dias','61-90':'61 a 90 dias','90mais':'Acima de 90 dias'})[v]||'Sem faixa'}
function caseModel(){
  if(mongoose.models.ErpCollectionCase)return mongoose.models.ErpCollectionCase;
  const historySchema=new mongoose.Schema({action:{type:String,required:true},at:{type:Date,default:Date.now},by:{type:String,default:''},note:{type:String,default:''},promiseDate:{type:Date,default:null},promiseAmount:{type:Number,default:0},nextActionDate:{type:Date,default:null}},{_id:false});
  const schema=new mongoose.Schema({
    targetId:{type:String,required:true,unique:true,index:true},source:{type:String,default:''},orderId:{type:String,default:''},entryId:{type:String,default:''},installment:{type:String,default:''},clientName:{type:String,default:''},clientDocument:{type:String,default:''},clientPhone:{type:String,default:''},clientEmail:{type:String,default:''},dueAt:{type:Date,default:null},originalValue:{type:Number,default:0},openBalance:{type:Number,default:0},status:{type:String,default:'aberta',index:true},lastAction:{type:String,default:''},lastActionAt:{type:Date,default:null},promiseDate:{type:Date,default:null,index:true},promiseAmount:{type:Number,default:0},nextActionDate:{type:Date,default:null,index:true},note:{type:String,default:''},history:{type:[historySchema],default:[]}
  },{timestamps:true,collection:'erp_collection_cases'});
  schema.index({status:1,promiseDate:1});
  schema.index({clientDocument:1,clientName:1});
  return mongoose.model('ErpCollectionCase',schema);
}
function rowCaseSnapshot(row={}){
  const id=String(row.id||'');
  return{targetId:id,source:clean(row.source||'',40),orderId:clean(row.orderId||'',120),entryId:id.startsWith('entry:')?id.slice(6):'',installment:clean(row.installment||'',40),clientName:clean(row.name||'',220),clientDocument:clean(row.document||'',40),clientPhone:clean(row.phone||'',60),clientEmail:clean(row.email||'',180),dueAt:row.dueAt||null,originalValue:money(row.value),openBalance:money(row.outstanding)};
}
function caseState(c,todayIso=localIso()){
  if(!c)return{status:'sem_tratativa',promiseToday:false,promiseLate:false,returnToday:false,internalWhatsAppAlertDue:false};
  const promiseIso=isoOf(c.promiseDate),nextIso=isoOf(c.nextActionDate),base=clean(c.status,40)||'aberta';
  const activePromise=base==='prometido';
  const promiseToday=activePromise&&promiseIso===todayIso;
  const promiseLate=activePromise&&promiseIso&&compareIso(promiseIso,todayIso)<0;
  const returnToday=['adiada','em_tratativa','sem_contato'].includes(base)&&nextIso===todayIso;
  const status=promiseLate?'promessa_atrasada':promiseToday?'promessa_hoje':returnToday?'retorno_hoje':base;
  return{status,promiseToday,promiseLate,returnToday,internalWhatsAppAlertDue:promiseToday};
}
function priority(entry,cstate={}){
  if(cstate.promiseLate)return 120;
  if(cstate.promiseToday)return 115;
  if(cstate.returnToday)return 110;
  const d=Number(entry.daysLate||0);
  if(d>90)return 100;
  if(d>60)return 90;
  if(d>30)return 80;
  return 70;
}
function matchesFilter(entry,cstate,filter='all'){
  if(!filter||filter==='all')return true;
  if(filter==='promessas_hoje')return cstate.promiseToday;
  if(filter==='promessas_atrasadas')return cstate.promiseLate;
  if(filter==='retornos_hoje')return cstate.returnToday;
  if(filter==='sem_contato')return cstate.status==='sem_contato';
  return band(entry.daysLate)===filter;
}

export function createErpCollectionWorkflowService(context={}){
  const delinquency=createErpDelinquencyReportService(context);
  const Case=caseModel();

  async function openReport(query={}){
    const q={...query,from:query.from||'2000-01-01',to:query.to||localIso()};
    const report=await delinquency.report(q);
    const entries=arr(report.clients).flatMap(client=>arr(client.entries).map(row=>({...row,name:row.name||client.name,document:row.document||client.document,phone:row.phone||client.phone,email:row.email||client.email})));
    const ids=entries.map(x=>String(x.id||'')).filter(Boolean);
    const cases=ids.length?await Case.find({targetId:{$in:ids}}).lean():[];
    const caseById=new Map(cases.map(x=>[String(x.targetId),x]));
    return{report,entries,caseById};
  }

  async function fila(query={}){
    const {entries,caseById}=await openReport(query),todayIso=localIso(),filter=clean(query.faixa||query.filter||'all',40),q=clean(query.q||query.search||'',180).toLocaleLowerCase('pt-BR');
    const settings=await getErpSettingsSnapshot().catch(()=>({}));
    const finePercent=Math.max(0,Number(settings?.finance?.delinquencyFinePercent??2));
    const monthlyInterestPercent=Math.max(0,Number(settings?.finance?.delinquencyMonthlyInterestPercent??1));
    const clients=new Map();
    for(const row of entries){
      const c=caseById.get(String(row.id||'')),state=caseState(c,todayIso);
      if(state.status==='concluida')continue;
      if(!matchesFilter(row,state,filter))continue;
      const hay=[row.name,row.document,row.phone,row.email,row.reference].join(' ').toLocaleLowerCase('pt-BR');if(q&&!hay.includes(q))continue;
      const key=digits(row.document)?`doc:${digits(row.document)}`:`name:${clean(row.name,220).toLocaleLowerCase('pt-BR')}`;
      const principal=Math.max(0,money(row.outstanding||0));
      const storedFine=row.fineAmount??row.fine,storedInterest=row.interestAmount??row.interest;
      const fineAmount=storedFine!==undefined&&storedFine!==null
        ? Math.max(0,money(storedFine))
        : (Number(row.daysLate||0)>0?money(principal*finePercent/100):0);
      const interestAmount=storedInterest!==undefined&&storedInterest!==null
        ? Math.max(0,money(storedInterest))
        : (Number(row.daysLate||0)>0?money(principal*monthlyInterestPercent/100*(Number(row.daysLate||0)/30)):0);
      const updatedAmount=money(principal+fineAmount+interestAmount);
      const item={...row,originalValue:money(row.value),fineAmount,interestAmount,updatedAmount,chargesCalculated:true,chargePolicy:{finePercent,monthlyInterestPercent},faixa:band(row.daysLate),faixaLabel:bandLabel(band(row.daysLate)),case:c?{id:String(c._id),status:c.status,lastAction:c.lastAction,lastActionAt:c.lastActionAt,promiseDate:c.promiseDate,promiseAmount:money(c.promiseAmount),nextActionDate:c.nextActionDate,note:c.note,...state}:null,priority:priority(row,state)};
      const group=clients.get(key)||{key,name:row.name||'Sem identificação',document:row.document||'',phone:row.phone||'',email:row.email||'',totalOverdue:0,totalUpdated:0,maxDaysLate:0,priority:0,entries:[],alerts:{promiseToday:0,promiseLate:0,returnToday:0,whatsappInternalDue:0}};
      group.totalOverdue+=Number(row.outstanding||0);group.totalUpdated+=updatedAmount;group.maxDaysLate=Math.max(group.maxDaysLate,Number(row.daysLate||0));group.priority=Math.max(group.priority,item.priority);group.entries.push(item);if(state.promiseToday)group.alerts.promiseToday++;if(state.promiseLate)group.alerts.promiseLate++;if(state.returnToday)group.alerts.returnToday++;if(state.internalWhatsAppAlertDue)group.alerts.whatsappInternalDue++;clients.set(key,group);
    }
    const rows=[...clients.values()].map(c=>({...c,totalOverdue:money(c.totalOverdue),totalUpdated:money(c.totalUpdated),entries:c.entries.sort((a,b)=>b.priority-a.priority||new Date(a.dueAt)-new Date(b.dueAt))})).sort((a,b)=>b.priority-a.priority||b.maxDaysLate-a.maxDaysLate||a.name.localeCompare(b.name,'pt-BR'));
    const allEntries=rows.flatMap(c=>c.entries);
    return{date:todayIso,filter,chargesNote:`Encargos automáticos: multa de ${finePercent}% sobre o saldo vencido e juros de ${monthlyInterestPercent}% ao mês, proporcionais aos dias de atraso. No recebimento, o operador pode dispensar multa e juros.`,chargePolicy:{finePercent,monthlyInterestPercent},summary:{clients:rows.length,installments:allEntries.length,totalOverdue:money(rows.reduce((s,c)=>s+c.totalOverdue,0)),totalUpdated:money(rows.reduce((s,c)=>s+c.totalUpdated,0)),promisesToday:allEntries.filter(x=>x.case?.promiseToday).length,promisesLate:allEntries.filter(x=>x.case?.promiseLate).length,returnsToday:allEntries.filter(x=>x.case?.returnToday).length,whatsappInternalAlertsDue:allEntries.filter(x=>x.case?.internalWhatsAppAlertDue).length},clients:rows};
  }

  async function promessas(query={}){
    const todayIso=localIso(),from=clean(query.from||'',20),to=clean(query.to||'',20),status=clean(query.status||'ativas',40),q=clean(query.q||query.search||'',180).toLocaleLowerCase('pt-BR');
    const filter={promiseDate:{$ne:null}};if(from||to){filter.promiseDate={};if(from)filter.promiseDate.$gte=dateOnly(from,'Data inicial');if(to){const d=dateOnly(to,'Data final');d.setHours(23,59,59,999);filter.promiseDate.$lte=d}}
    if(status==='concluidas')filter.status='concluida';else if(status==='ativas')filter.status={$ne:'concluida'};
    let cases=await Case.find(filter).sort({promiseDate:1,clientName:1}).limit(5000).lean();
    if(q)cases=cases.filter(c=>[c.clientName,c.clientDocument,c.clientPhone,c.clientEmail,c.note].join(' ').toLocaleLowerCase('pt-BR').includes(q));
    const rows=cases.map(c=>({...c,id:String(c._id),promiseAmount:money(c.promiseAmount),originalValue:money(c.originalValue),openBalance:money(c.openBalance),...caseState(c,todayIso)}));
    return{date:todayIso,summary:{total:rows.length,today:rows.filter(x=>x.promiseToday).length,late:rows.filter(x=>x.promiseLate).length,amount:money(rows.reduce((s,x)=>s+Number(x.promiseAmount||0),0)),whatsappInternalAlertsDue:rows.filter(x=>x.internalWhatsAppAlertDue).length},promises:rows};
  }

  async function recuperacao(query={}){
    const queue=await fila({...query,filter:'all'}),monthStart=new Date();monthStart.setDate(1);monthStart.setHours(0,0,0,0);
    const concluded=await Case.find({status:'concluida',updatedAt:{$gte:monthStart}}).sort({updatedAt:-1}).limit(1000).lean();
    const promises=await promessas({status:'ativas'});
    const bands={ate30:{clients:0,value:0},'31-60':{clients:0,value:0},'61-90':{clients:0,value:0},'90mais':{clients:0,value:0}};
    for(const client of queue.clients){const b=band(client.maxDaysLate),x=bands[b];x.clients++;x.value=money(x.value+client.totalUpdated)}
    return{date:queue.date,summary:{overdueClients:queue.summary.clients,overdueInstallments:queue.summary.installments,overdueAmount:queue.summary.totalOverdue,updatedOverdueAmount:queue.summary.totalUpdated,activePromises:promises.summary.total,promisesToday:promises.summary.today,promisesLate:promises.summary.late,concludedThisMonth:concluded.length},bands:Object.entries(bands).map(([key,x])=>({key,label:bandLabel(key),...x,value:money(x.value)})),recentConcluded:concluded.slice(0,50).map(c=>({id:String(c._id),targetId:c.targetId,clientName:c.clientName,clientDocument:c.clientDocument,lastActionAt:c.lastActionAt,openBalance:money(c.openBalance),note:c.note}))};
  }

  async function registrarAcao(targetId,payload={},actor={}){
    const id=clean(targetId||payload.targetId,240);if(!id)throw fail('Parcela/título da cobrança não informado.',400,'COLLECTION_TARGET_REQUIRED');
    const action=clean(payload.action,40);if(!ACTIONS.has(action))throw fail('Ação de cobrança inválida.',400,'INVALID_COLLECTION_ACTION');
    const {entries}=await openReport({q:''});const row=entries.find(x=>String(x.id||'')===id);const existing=await Case.findOne({targetId:id});
    if(!row&&!existing)throw fail('Título da cobrança não encontrado entre os recebíveis em aberto.',404,'COLLECTION_TARGET_NOT_FOUND');
    const snap=row?rowCaseSnapshot(row):{};
    const note=clean(payload.note||payload.observacao||'',1200),now=new Date(),by=actorName(actor),set={...snap,lastAction:action,lastActionAt:now,note};
    let promiseDate=null,promiseAmount=0,nextActionDate=null;
    if(action==='promessa'){
      promiseDate=dateOnly(payload.promiseDate||payload.dataPromessa,'Data da promessa');if(!promiseDate)throw fail('Informe a data combinada da promessa.',400,'PROMISE_DATE_REQUIRED');
      promiseAmount=Math.max(0,money(payload.promiseAmount??payload.valorPromessa??snap.openBalance??existing?.openBalance??0));set.status='prometido';set.promiseDate=promiseDate;set.promiseAmount=promiseAmount;set.nextActionDate=null;
    }else if(action==='adiar'){
      nextActionDate=dateOnly(payload.nextActionDate||payload.dataRetorno,'Data do novo retorno');if(!nextActionDate)throw fail('Informe a nova data de retorno.',400,'NEXT_ACTION_DATE_REQUIRED');set.status='adiada';set.nextActionDate=nextActionDate;set.promiseDate=null;
    }else if(action==='sem_contato'){
      nextActionDate=dateOnly(payload.nextActionDate||payload.dataRetorno,'Data do retorno');set.status='sem_contato';set.nextActionDate=nextActionDate;set.promiseDate=null;
    }else if(action==='tratativa'){
      nextActionDate=dateOnly(payload.nextActionDate||payload.dataRetorno,'Data do retorno');set.status='em_tratativa';set.nextActionDate=nextActionDate;
    }else if(action==='concluir'){
      set.status='concluida';set.nextActionDate=null;set.promiseDate=null;
    }
    const history={action,at:now,by,note,promiseDate,promiseAmount,nextActionDate};
    const doc=await Case.findOneAndUpdate({targetId:id},{$set:set,$setOnInsert:{targetId:id},$push:{history}}, {new:true,upsert:true,setDefaultsOnInsert:true});
    const out=doc.toObject(),state=caseState(out);return{case:{...out,id:String(doc._id),promiseAmount:money(out.promiseAmount),originalValue:money(out.originalValue),openBalance:money(out.openBalance),...state},alert:{visual:state.promiseToday,whatsappInternalDue:state.internalWhatsAppAlertDue,message:state.promiseToday?`Promessa de pagamento de ${out.clientName||'cliente'} vence hoje.`:''}};
  }

  return{fila,promessas,recuperacao,registrarAcao};
}
export default createErpCollectionWorkflowService;
