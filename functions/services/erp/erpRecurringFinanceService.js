import mongoose from 'mongoose';
import { createErpLedgerService } from './erpLedgerService.js';
import { createErpSettingsService } from './erpSettingsService.js';

const clean=(v='',m=500)=>String(v??'').trim().slice(0,m);
const money=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
const base={timestamps:true,versionKey:false,minimize:false};
function fail(message,statusCode=400,code='ERP_RECURRING_FINANCE_ERROR'){const e=new Error(message);e.statusCode=statusCode;e.code=code;return e}
function actorName(a={}){return clean(a.name||a.email||'Administrador',180)}
function validDate(v,label){const d=new Date(v);if(Number.isNaN(d.getTime()))throw fail(`${label} inválida.`);d.setHours(12,0,0,0);return d}
function addPeriod(date,frequency,interval,index){const d=new Date(date),step=Math.max(1,Number(interval||1))*index;if(frequency==='weekly')d.setDate(d.getDate()+7*step);else if(frequency==='yearly')d.setFullYear(d.getFullYear()+step);else d.setMonth(d.getMonth()+step);return d}

const recurrenceSchema=new mongoose.Schema({
 code:{type:String,required:true,unique:true,index:true},active:{type:Boolean,default:true,index:true},direction:{type:String,enum:['receivable','payable'],required:true,index:true},
 personName:{type:String,required:true,index:true},personDocument:{type:String,default:''},description:{type:String,default:''},value:{type:Number,required:true},
 categoryId:{type:String,default:''},categoryName:{type:String,default:''},centerCostName:{type:String,default:''},bankAccountId:{type:String,default:''},paymentMethod:{type:String,default:''},notes:{type:String,default:''},
 startAt:{type:Date,required:true,index:true},frequency:{type:String,enum:['monthly','weekly','yearly'],default:'monthly'},interval:{type:Number,default:1},occurrences:{type:Number,default:12},generatedCount:{type:Number,default:0},generatedThrough:{type:Date,default:null},
 createdBy:{type:String,default:''},updatedBy:{type:String,default:''}
},base);
const Recurrence=mongoose.models.ErpFinancialRecurrence||mongoose.model('ErpFinancialRecurrence',recurrenceSchema);

export function createErpRecurringFinanceService(context={}){
 const ledger=createErpLedgerService(context),settings=createErpSettingsService(context);
 async function nextCode(){const y=new Date().getFullYear(),n=await Recurrence.countDocuments({createdAt:{$gte:new Date(y,0,1),$lt:new Date(y+1,0,1)}});return`REC-${y}-${String(n+1).padStart(5,'0')}`}
 async function list(q={}){const f={};if(q.active==='true')f.active=true;if(q.active==='false')f.active=false;if(['receivable','payable'].includes(q.direction))f.direction=q.direction;const text=clean(q.q||q.search,160);if(text){const rx=new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i');f.$or=[{code:rx},{personName:rx},{description:rx},{categoryName:rx}]};return Recurrence.find(f).sort({active:-1,startAt:1,createdAt:-1}).limit(3000).lean()}
 async function create(payload={},actor={}){
  const direction=clean(payload.direction,20);if(!['receivable','payable'].includes(direction))throw fail('Escolha contas a receber ou contas a pagar.');
  const personName=clean(payload.personName,200);if(!personName)throw fail(direction==='payable'?'Informe o favorecido.':'Informe o pagador.');
  const value=money(payload.value);if(value<=0)throw fail('Informe um valor maior que zero.');
  const startAt=validDate(payload.startAt||payload.dueAt||new Date(),'Primeiro vencimento'),frequency=['monthly','weekly','yearly'].includes(payload.frequency)?payload.frequency:'monthly',interval=Math.min(24,Math.max(1,Math.floor(Number(payload.interval||1)))),occurrences=Math.min(120,Math.max(1,Math.floor(Number(payload.occurrences||12)))),code=clean(payload.code,50)||await nextCode();
  const row=await Recurrence.create({code,direction,personName,personDocument:clean(payload.personDocument,60),description:clean(payload.description,500),value,categoryId:clean(payload.categoryId,120),categoryName:clean(payload.categoryName,160),centerCostName:clean(payload.centerCostName,160),bankAccountId:clean(payload.bankAccountId,120),paymentMethod:clean(payload.paymentMethod,80),notes:clean(payload.notes,1500),startAt,frequency,interval,occurrences,createdBy:actorName(actor),updatedBy:actorName(actor)});
  return generate(String(row._id),{},actor);
 }
 async function generate(id,payload={},actor={}){
  const r=await Recurrence.findById(id);if(!r)throw fail('Recorrência não encontrada.',404);if(r.active===false)throw fail('Recorrência inativa não pode gerar novos lançamentos.',409,'RECURRENCE_INACTIVE');
  const Entry=mongoose.models.ErpFinancialEntry,target=Math.min(120,Math.max(r.generatedCount||0,Math.floor(Number(payload.occurrences||r.occurrences||12)))),created=[],reused=[];
  for(let i=0;i<target;i++){
   const n=i+1,documentNumber=`${r.code}/${n}-${r.occurrences}`,dueAt=addPeriod(r.startAt,r.frequency,r.interval,i),orderId=`recurrence:${String(r._id)}`;
   const existing=Entry?await Entry.findOne({origin:'recurring',orderId,documentNumber}).lean():null;if(existing){reused.push(existing);continue}
   const entryPayload={personName:r.personName,personDocument:r.personDocument||'',description:`${r.description||r.personName} • recorrência ${n}/${r.occurrences}`,documentNumber,categoryId:r.categoryId||'',categoryName:r.categoryName||'',centerCostName:r.centerCostName||'',bankAccountId:r.bankAccountId||'',paymentMethod:r.paymentMethod||'',value:r.value,competenceAt:dueAt,dueAt,notes:r.notes||`Gerado pela recorrência ${r.code}.`,origin:'recurring',orderId};
   await settings.assertFinanceCreate(entryPayload,r.direction);const row=r.direction==='payable'?await ledger.createPayable(entryPayload,actor):await ledger.createReceivable(entryPayload,actor);created.push(row);
  }
  r.generatedCount=Math.max(r.generatedCount||0,target);r.generatedThrough=target?addPeriod(r.startAt,r.frequency,r.interval,target-1):r.generatedThrough;r.updatedBy=actorName(actor);await r.save();
  return{recurrence:r.toObject(),created:created.length,reused:reused.length,entries:[...reused,...created]};
 }
 async function setActive(id,active,actor={}){const r=await Recurrence.findById(id);if(!r)throw fail('Recorrência não encontrada.',404);r.active=active!==false;r.updatedBy=actorName(actor);await r.save();return r.toObject()}
 async function status(id){const r=await Recurrence.findById(id).lean().catch(()=>null);if(!r)throw fail('Recorrência não encontrada.',404);const Entry=mongoose.models.ErpFinancialEntry,entries=Entry?await Entry.find({origin:'recurring',orderId:`recurrence:${id}`}).sort({dueAt:1}).lean():[];return{recurrence:r,entries}}
 return{list,create,generate,setActive,status};
}

export default createErpRecurringFinanceService;
