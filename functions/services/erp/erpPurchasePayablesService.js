import mongoose from 'mongoose';
import { createErpLedgerService } from './erpLedgerService.js';
import { createErpSettingsService } from './erpSettingsService.js';

const clean=(v='',m=500)=>String(v??'').trim().slice(0,m);
const money=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
function fail(message,statusCode=400,code='ERP_PURCHASE_PAYABLE_ERROR'){const e=new Error(message);e.statusCode=statusCode;e.code=code;return e}
function actorName(a={}){return clean(a.name||a.email||'Administrador',180)}
function parseDate(v,label){const d=new Date(v);if(Number.isNaN(d.getTime()))throw fail(`${label} inválida.`,400,'INVALID_DATE');d.setHours(12,0,0,0);return d}
function addDays(d,days){const x=new Date(d);x.setDate(x.getDate()+days);return x}

export function createErpPurchasePayablesService(context={}){
  const Purchase=mongoose.models.ErpPurchase;
  if(!Purchase)throw new Error('[erp-purchase-payables] ErpPurchase não disponível');
  const ledger=createErpLedgerService(context),settings=createErpSettingsService(context);

  async function rawPurchase(id){let oid;try{oid=new mongoose.Types.ObjectId(id)}catch{return null}return Purchase.collection.findOne({_id:oid})}

  async function preview(id,payload={}){
    const p=await rawPurchase(id);if(!p)throw fail('Compra não encontrada.',404);
    if(p.status==='cancelled')throw fail('Compra cancelada não pode gerar contas a pagar.',409,'PURCHASE_CANCELLED');
    const total=money(payload.total??p.supplierPayableTotal??p.total);if(total<=0)throw fail('Informe o valor total a pagar ao fornecedor.');
    const count=Math.min(120,Math.max(1,Math.floor(Number(payload.installments||p.payableInstallments||1))));
    const interval=Math.min(365,Math.max(1,Math.floor(Number(payload.intervalDays||30))));
    const first=parseDate(payload.firstDueAt||p.expectedAt||new Date(),'Primeiro vencimento');
    const base=Math.floor((total/count)*100)/100;let assigned=0;const installments=[];
    for(let i=1;i<=count;i++){const value=i===count?money(total-assigned):money(base);assigned=money(assigned+value);installments.push({number:i,total:count,value,dueAt:addDays(first,(i-1)*interval),documentNumber:`${p.number}/${i}-${count}`})}
    return{purchase:{id:String(p._id),number:p.number,supplierName:p.supplierName,supplierDocument:p.supplierDocument||'',invoiceNumber:p.invoiceNumber||'',status:p.status,total:p.total,costStatus:p.costStatus},total,count,intervalDays:interval,installments};
  }

  async function generate(id,payload={},actor={}){
    const p=await rawPurchase(id);if(!p)throw fail('Compra não encontrada.',404);
    if(p.status==='cancelled')throw fail('Compra cancelada não pode gerar contas a pagar.',409,'PURCHASE_CANCELLED');
    const plan=await preview(id,payload),Entry=mongoose.models.ErpFinancialEntry;
    const existing=Entry?await Entry.find({direction:'payable',origin:'purchase',orderId:String(p._id)}).lean():[];
    const byDoc=new Map(existing.map(e=>[String(e.documentNumber||''),e])),created=[],reused=[];
    for(const inst of plan.installments){const old=byDoc.get(inst.documentNumber);if(old){reused.push(old);continue}
      const entryPayload={personName:p.supplierName,personDocument:p.supplierDocument||'',description:`Compra ${p.number}${p.invoiceNumber?` • NF ${p.invoiceNumber}`:''} • parcela ${inst.number}/${inst.total}`,documentNumber:inst.documentNumber,categoryId:clean(payload.categoryId,120),categoryName:clean(payload.categoryName||'Compras de mercadorias',160),centerCostName:clean(payload.centerCostName||'Compras / Estoque',160),bankAccountId:clean(payload.bankAccountId,120),paymentMethod:clean(payload.paymentMethod||'',80),value:inst.value,competenceAt:p.issuedAt||new Date(),dueAt:inst.dueAt,notes:clean(payload.notes||`Gerado automaticamente pela compra ${p.number}.`,1200),origin:'purchase',orderId:String(p._id)};
      await settings.assertFinanceCreate(entryPayload,'payable');const row=await ledger.createPayable(entryPayload,actor);created.push(row)}
    const allIds=[...reused,...created].map(x=>String(x._id||x.id||'')).filter(Boolean),stamp=new Date(),by=actorName(actor);
    await Purchase.collection.updateOne({_id:p._id},{$set:{supplierPayableTotal:plan.total,payableInstallments:plan.count,payablesGeneratedAt:stamp,payablesGeneratedBy:by,financeEntryIds:allIds,updatedBy:by,updatedAt:stamp}});
    return{purchaseId:String(p._id),purchaseNumber:p.number,total:plan.total,installments:plan.count,created:created.length,reused:reused.length,entries:[...reused,...created]};
  }

  async function status(id){const p=await rawPurchase(id);if(!p)throw fail('Compra não encontrada.',404);const Entry=mongoose.models.ErpFinancialEntry;const entries=Entry?await Entry.find({direction:'payable',origin:'purchase',orderId:String(p._id)}).sort({dueAt:1}).lean():[];return{purchase:{id:String(p._id),number:p.number,supplierName:p.supplierName,total:p.total,supplierPayableTotal:p.supplierPayableTotal??null,payableInstallments:p.payableInstallments||0,payablesGeneratedAt:p.payablesGeneratedAt||null},entries};}
  return{preview,generate,status};
}

export default createErpPurchasePayablesService;
