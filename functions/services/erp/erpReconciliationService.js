import mongoose from 'mongoose';
import { getErpSettingsSnapshot } from './erpSettingsService.js';

const clean=(v='',m=180)=>String(v??'').trim().slice(0,m);
function fail(message,statusCode=400,code='ERP_RECONCILIATION_ERROR'){const e=new Error(message);e.statusCode=statusCode;e.code=code;return e}
function entryModel(){const Entry=mongoose.models.ErpFinancialEntry;if(!Entry)throw fail('Financeiro ainda não foi inicializado.',503,'ERP_LEDGER_UNAVAILABLE');return Entry}
function recalc(row){const ps=Array.isArray(row.payments)?row.payments:[],all=ps.length>0&&ps.every(p=>p?.reconciled===true);row.reconciliationStatus=all?'reconciled':'unreconciled';row.reconciledAt=all?new Date():null}

export function createErpReconciliationService(context={}){
 const {IntegrationAuditLog,redact}=context;
 async function audit(eventType,metadata={}){if(!IntegrationAuditLog)return;try{await IntegrationAuditLog.create({scope:'erp_ariana',eventType,status:'ok',message:clean(metadata.message,500),metadata:redact?redact(metadata):metadata})}catch(e){console.warn('[erp-reconciliation/audit]',e.message)}}
 async function setPayment(entryId,paymentId,reconciled=true,actor={}){
  const Entry=entryModel(),row=await Entry.findById(entryId);if(!row)throw fail('Lançamento financeiro não encontrado.',404,'ENTRY_NOT_FOUND');
  const ps=Array.isArray(row.payments)?row.payments.map(p=>({...p})):[],idx=ps.findIndex(p=>String(p?.id||'')===String(paymentId||''));if(idx<0)throw fail('Pagamento não encontrado neste lançamento.',404,'PAYMENT_NOT_FOUND');
  ps[idx]={...ps[idx],reconciled:Boolean(reconciled),reconciledAt:reconciled?new Date():null,reconciledBy:clean(actor?.name||actor?.nome||actor?.email||'Operador',180)};
  row.payments=ps;recalc(row);row.markModified('payments');await row.save();
  await audit('erp.ledger.payment.reconciled',{message:reconciled?'Pagamento conciliado':'Conciliação do pagamento removida',entryId:String(row._id),paymentId:String(paymentId||''),reconciled:Boolean(reconciled)});
  return row.toObject()
 }
 async function auto(entry={},actor={}){
  const cfg=(await getErpSettingsSnapshot()).finance||{};if(cfg.autoReconcileOnPayment!==true)return entry;
  const id=String(entry?._id||entry?.id||''),ps=Array.isArray(entry?.payments)?entry.payments:[],last=ps[ps.length-1];if(!id||!last?.id)return entry;
  return setPayment(id,last.id,true,actor)
 }
 return{setPayment,auto}
}
export default createErpReconciliationService;
