import mongoose from 'mongoose';
import { calculateLateCharge, ERP_LATE_CHARGE_POLICY } from './erpLateChargeService.js';

const money=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
const array=v=>Array.isArray(v)?v:[];
const ANOMALY_MIN=10_000_000;
function principalPaid(r={}){const ps=array(r.payments);if(ps.length)return money(ps.reduce((s,p)=>s+Number(p.principalApplied??p.principal??0),0));return money(r.principalPaid??(r.status==='paid'?r.value:0))}
function outstanding(r={}){if(r.status==='paid'||r.status==='cancelled')return 0;return Math.max(0,money(Number(r.value||0)-principalPaid(r)))}
function keyFor(name='',doc=''){const d=String(doc||'').replace(/\D/g,'');return d?`doc:${d}`:`name:${String(name||'Sem identificação').trim().toLowerCase()}`}
function enrich(row,asOf=new Date()){
 const principal=Math.max(0,money(row.outstanding??outstanding(row)));
 const lc=calculateLateCharge({principal,dueAt:row.dueAt,asOf,direction:row.direction||'receivable'});
 return{...row,outstanding:principal,daysLate:lc.daysLate,lateFine:lc.fine,lateInterest:lc.interest,lateCharges:lc.charges,updatedOutstanding:lc.updatedTotal,overdue:lc.overdue};
}

export function createErpLateChargeReportService(context={}){
 const {Order}=context;if(!Order)throw new Error('[erp-late-charge-report] Order não informado');
 async function allOpenReceivables(asOf=new Date()){
  const Entry=mongoose.models.ErpFinancialEntry;
  const rows=[];
  if(Entry){
   const hist=await Entry.collection.find({direction:'receivable',status:{$ne:'cancelled'}}).project({personName:1,personDocument:1,dueAt:1,value:1,status:1,payments:1,principalPaid:1,origin:1}).limit(40000).toArray();
   for(const r of hist){if(r.origin==='sige_import'&&Math.abs(Number(r.value||0))>=ANOMALY_MIN)continue;const principal=outstanding(r);if(principal<=0.009)continue;rows.push(enrich({source:'ledger',id:String(r._id),personName:r.personName||'Sem identificação',personDocument:r.personDocument||'',direction:'receivable',dueAt:r.dueAt,outstanding:principal},asOf))}
  }
  const orders=await Order.find({origin:'erp_ariana',status:'faturado','televendas.erp.receivables.0':{$exists:true}}).select('_id customerName customerCpf customerPhone customerEmail televendas').lean();
  for(const o of orders)for(const r of array(o.televendas?.erp?.receivables)){
   if(['recebido','cancelado','estornado'].includes(r.status))continue;
   const ps=array(r.payments),paid=money(ps.length?ps.reduce((s,p)=>s+Number(p.principalApplied??p.amount??0),0):Number(r.receivedAmount||0)),principal=Math.max(0,money(Number(r.value||0)-paid));if(principal<=0.009)continue;
   rows.push(enrich({source:'sale',id:`${o._id}:${r.number||1}`,personName:o.customerName||'Consumidor',personDocument:o.customerCpf||'',personPhone:o.customerPhone||'',personEmail:o.customerEmail||'',direction:'receivable',dueAt:r.dueAt,outstanding:principal},asOf));
  }
  return rows
 }
 async function summary(asOf=new Date()){
  const rows=await allOpenReceivables(asOf),overdue=rows.filter(r=>r.overdue),map=new Map();
  for(const r of overdue){const k=keyFor(r.personName,r.personDocument),x=map.get(k)||{personName:r.personName,personDocument:r.personDocument||'',personPhone:r.personPhone||'',personEmail:r.personEmail||'',count:0,principal:0,fine:0,interest:0,total:0,oldestDue:r.dueAt,daysOverdue:0};x.count++;x.principal+=r.outstanding;x.fine+=r.lateFine;x.interest+=r.lateInterest;x.total+=r.updatedOutstanding;x.daysOverdue=Math.max(x.daysOverdue,r.daysLate);if(new Date(r.dueAt)<new Date(x.oldestDue))x.oldestDue=r.dueAt;map.set(k,x)}
  const delinquents=[...map.values()].map(x=>({...x,principal:money(x.principal),fine:money(x.fine),interest:money(x.interest),charges:money(x.fine+x.interest),total:money(x.total)})).sort((a,b)=>b.total-a.total);
  return{policy:ERP_LATE_CHARGE_POLICY,open:{count:rows.length,principal:money(rows.reduce((s,r)=>s+r.outstanding,0)),fine:money(rows.reduce((s,r)=>s+r.lateFine,0)),interest:money(rows.reduce((s,r)=>s+r.lateInterest,0)),updated:money(rows.reduce((s,r)=>s+r.updatedOutstanding,0))},overdue:{count:overdue.length,principal:money(overdue.reduce((s,r)=>s+r.outstanding,0)),fine:money(overdue.reduce((s,r)=>s+r.lateFine,0)),interest:money(overdue.reduce((s,r)=>s+r.lateInterest,0)),updated:money(overdue.reduce((s,r)=>s+r.updatedOutstanding,0))},delinquents:delinquents.slice(0,1000)}
 }
 function decorateEntries(entries=[],asOf=new Date()){return array(entries).map(r=>enrich({...r,direction:r.direction||'receivable',outstanding:Number(r.outstanding??0)},asOf))}
 return{allOpenReceivables,summary,decorateEntries}
}
export default createErpLateChargeReportService;
