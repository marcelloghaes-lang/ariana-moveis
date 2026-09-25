import mongoose from 'mongoose';
import { createErpPaymentReceiptService } from './erpPaymentReceiptService.js';

const clean=(v='',m=1000)=>String(v??'').trim().slice(0,m);
const money=(v=0)=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
const array=v=>Array.isArray(v)?v:[];
function fail(message,statusCode=400,code='ERP_LEDGER_ERROR'){const e=new Error(message);e.statusCode=statusCode;e.code=code;return e}
function actorName(a={}){return clean(a.name||a.nome||a.email||'Operador',180)}
function validDate(v,label='Data'){const d=new Date(v);if(Number.isNaN(d.getTime()))throw fail(`${label} inválida.`,400,'INVALID_DATE');return d}
const base={timestamps:true,versionKey:false,minimize:false};

const categorySchema=new mongoose.Schema({name:{type:String,required:true,index:true},type:{type:String,enum:['receita','despesa'],required:true,index:true},active:{type:Boolean,default:true},system:{type:Boolean,default:false}},base);
categorySchema.index({name:1,type:1},{unique:true});
const bankSchema=new mongoose.Schema({name:{type:String,required:true,index:true},bank:String,agency:String,account:String,type:{type:String,default:'corrente'},openingBalance:{type:Number,default:0},currentBalance:{type:Number,default:0},active:{type:Boolean,default:true},notes:String},base);
const entrySchema=new mongoose.Schema({
 direction:{type:String,enum:['receivable','payable'],required:true,index:true},personName:{type:String,required:true,index:true},personDocument:String,
 description:String,documentNumber:String,boletoNumber:String,categoryId:String,categoryName:String,centerCostName:String,
 bankAccountId:String,bankAccountName:String,paymentMethod:String,value:{type:Number,required:true},advance:{type:Number,default:0},
 competenceAt:{type:Date,required:true,index:true},dueAt:{type:Date,required:true,index:true},status:{type:String,enum:['pending','paid','cancelled'],default:'pending',index:true},
 paidAt:Date,paidValue:{type:Number,default:0},principalPaid:{type:Number,default:0},fineDefault:{type:Number,default:0},interestDefault:{type:Number,default:0},discountDefault:{type:Number,default:0},
 payments:{type:[mongoose.Schema.Types.Mixed],default:[]},reconciliationStatus:{type:String,default:'unreconciled',index:true},reconciledAt:Date,
 notes:String,origin:{type:String,default:'manual',index:true},orderId:String,createdBy:String,updatedBy:String,paidBy:String,cancelledAt:Date,cancelledBy:String
},base);
entrySchema.index({direction:1,status:1,dueAt:1});
const Category=mongoose.models.ErpAccountCategory||mongoose.model('ErpAccountCategory',categorySchema);
const Bank=mongoose.models.ErpBankAccount||mongoose.model('ErpBankAccount',bankSchema);
const Entry=mongoose.models.ErpFinancialEntry||mongoose.model('ErpFinancialEntry',entrySchema);

const defaults=[['Vendas','receita'],['Recebimentos diversos','receita'],['Compras de mercadorias','despesa'],['Despesas operacionais','despesa'],['Fretes','despesa'],['Impostos','despesa'],['Pessoal','despesa']];

export function createErpLedgerService(context={}){
 const {IntegrationAuditLog,redact}=context;
 const paymentReceipts=createErpPaymentReceiptService(context);
 async function audit(eventType,metadata={}){if(!IntegrationAuditLog)return;try{await IntegrationAuditLog.create({scope:'erp_ariana',eventType,status:clean(metadata.status||'',80),message:clean(metadata.message||'',1000),metadata:redact?redact(metadata):metadata})}catch(e){console.warn('[erp-ledger/audit]',e.message)}}
 async function ensureDefaults(){for(const [name,type] of defaults){await Category.updateOne({name,type},{$setOnInsert:{name,type,active:true,system:true}},{upsert:true})}}
 const serial=d=>d?.toObject?d.toObject():d;
 function principalPaid(row={}){const ps=array(row.payments);if(ps.length)return money(ps.reduce((s,p)=>s+Number(p.principalApplied??p.principal??0),0));return money(row.principalPaid??(row.status==='paid'?row.value:0))}
 function cashPaid(row={}){const ps=array(row.payments);if(ps.length)return money(ps.reduce((s,p)=>s+Number(p.totalPaid??p.amount??p.principalApplied??0),0));return money(row.paidValue??0)}
 function remaining(row={}){return Math.max(0,money(Number(row.value||0)-principalPaid(row)))}
 function viewStatus(row={}){if(row.status==='cancelled')return'cancelled';if(row.status==='paid'||remaining(row)<=0.009)return'paid';if(principalPaid(row)>0)return'partial';return'pending'}
 function decorate(row){const r=serial(row);return{...r,principalPaid:principalPaid(r),paidValue:cashPaid(r),remaining:remaining(r),viewStatus:viewStatus(r)}}
 async function categories(query={}){await ensureDefaults();const filter={};if(query.type&&['receita','despesa'].includes(query.type))filter.type=query.type;if(query.active!=='all')filter.active={$ne:false};return (await Category.find(filter).sort({type:1,name:1})).map(serial)}
 async function createCategory(payload={},actor={}){const name=clean(payload.name,160),type=clean(payload.type,20);if(!name||!['receita','despesa'].includes(type))throw fail('Nome e tipo da categoria são obrigatórios.');try{const row=await Category.create({name,type,active:true,system:false});await audit('erp.ledger.category.created',{message:`Categoria ${name} criada`,categoryId:String(row._id),by:actorName(actor)});return serial(row)}catch(e){if(e?.code===11000)throw fail('Já existe uma categoria com este nome e tipo.',409,'CATEGORY_EXISTS');throw e}}
 async function updateCategory(id,payload={},actor={}){const row=await Category.findById(id);if(!row)throw fail('Categoria não encontrada.',404);if(payload.name!==undefined)row.name=clean(payload.name,160)||row.name;if(payload.active!==undefined)row.active=Boolean(payload.active);if(payload.type!==undefined&&['receita','despesa'].includes(payload.type))row.type=payload.type;await row.save();await audit('erp.ledger.category.updated',{message:`Categoria ${row.name} atualizada`,categoryId:String(row._id),by:actorName(actor)});return serial(row)}
 async function banks(query={}){const filter={};if(query.active!=='all')filter.active={$ne:false};return (await Bank.find(filter).sort({name:1})).map(serial)}
 async function createBank(payload={},actor={}){const name=clean(payload.name,180);if(!name)throw fail('Informe o nome da conta bancária.');const opening=money(payload.openingBalance||0);const row=await Bank.create({name,bank:clean(payload.bank,120),agency:clean(payload.agency,80),account:clean(payload.account,100),type:clean(payload.type||'corrente',60),openingBalance:opening,currentBalance:opening,active:true,notes:clean(payload.notes,1000)});await audit('erp.ledger.bank.created',{message:`Conta ${name} criada`,bankAccountId:String(row._id),openingBalance:opening,by:actorName(actor)});return serial(row)}
 async function updateBank(id,payload={},actor={}){const row=await Bank.findById(id);if(!row)throw fail('Conta bancária não encontrada.',404);for(const k of ['name','bank','agency','account','type','notes'])if(payload[k]!==undefined)row[k]=clean(payload[k],k==='notes'?1000:180);if(payload.active!==undefined)row.active=Boolean(payload.active);await row.save();await audit('erp.ledger.bank.updated',{message:`Conta ${row.name} atualizada`,bankAccountId:String(row._id),by:actorName(actor)});return serial(row)}
 async function resolveCategory(id,direction){if(!id)return null;const row=await Category.findById(id);if(!row||row.active===false)throw fail('Categoria financeira inválida.',409);const expected=direction==='receivable'?'receita':'despesa';if(row.type!==expected)throw fail(`Use uma categoria do tipo ${expected}.`,409,'CATEGORY_TYPE_MISMATCH');return row}
 async function resolveBank(id){if(!id)return null;const row=await Bank.findById(id);if(!row||row.active===false)throw fail('Conta bancária inválida ou inativa.',409);return row}
 async function createEntry(direction,payload={},actor={}){
  if(!['receivable','payable'].includes(direction))throw fail('Tipo de lançamento inválido.');
  const personName=clean(payload.personName||payload.payer||payload.receiver,200);if(!personName)throw fail(direction==='payable'?'Informe o recebedor.':'Informe o pagador.');
  const value=money(payload.value);if(value<=0)throw fail('Informe um valor maior que zero.');
  const competenceAt=validDate(payload.competenceAt||payload.competenceDate||new Date(),'Data de competência'),dueAt=validDate(payload.dueAt||payload.dueDate||new Date(),'Data de vencimento');
  const category=await resolveCategory(payload.categoryId,direction),bank=await resolveBank(payload.bankAccountId);
  const row=await Entry.create({direction,personName,personDocument:clean(payload.personDocument,60),description:clean(payload.description,500),documentNumber:clean(payload.documentNumber||payload.document,120),boletoNumber:clean(payload.boletoNumber||payload.boleto,160),categoryId:category?String(category._id):'',categoryName:category?.name||clean(payload.categoryName,160),centerCostName:clean(payload.centerCostName,160),bankAccountId:bank?String(bank._id):'',bankAccountName:bank?.name||'',paymentMethod:clean(payload.paymentMethod,80),value,advance:Math.max(0,money(payload.advance||0)),competenceAt,dueAt,status:'pending',fineDefault:Math.max(0,money(payload.fineDefault||payload.fine||0)),interestDefault:Math.max(0,money(payload.interestDefault||payload.interest||0)),discountDefault:Math.max(0,money(payload.discountDefault||payload.discount||0)),notes:clean(payload.notes,2000),origin:clean(payload.origin||'manual',80),orderId:clean(payload.orderId,120),createdBy:actorName(actor)});
  await audit('erp.ledger.entry.created',{message:`${direction==='payable'?'Conta a pagar':'Conta a receber'} criada`,entryId:String(row._id),direction,value,by:actorName(actor)});
  if(payload.paid===true)return pay(String(row._id),{...payload,settle:true},actor);return decorate(row)
 }
 async function updateEntry(id,payload={},actor={}){
  const row=await Entry.findById(id);if(!row)throw fail('Lançamento não encontrado.',404);if(row.status==='cancelled')throw fail('Lançamento cancelado não pode ser editado.',409);
  const pp=principalPaid(row);if(payload.value!==undefined){const v=money(payload.value);if(v<=0||v+0.009<pp)throw fail('O valor do lançamento não pode ser menor que o principal já realizado.',409);row.value=v}
  if(payload.personName!==undefined)row.personName=clean(payload.personName,200)||row.personName;if(payload.personDocument!==undefined)row.personDocument=clean(payload.personDocument,60);if(payload.description!==undefined)row.description=clean(payload.description,500);if(payload.documentNumber!==undefined)row.documentNumber=clean(payload.documentNumber,120);if(payload.boletoNumber!==undefined)row.boletoNumber=clean(payload.boletoNumber,160);if(payload.centerCostName!==undefined)row.centerCostName=clean(payload.centerCostName,160);if(payload.paymentMethod!==undefined)row.paymentMethod=clean(payload.paymentMethod,80);if(payload.notes!==undefined)row.notes=clean(payload.notes,2000);
  if(payload.competenceAt!==undefined)row.competenceAt=validDate(payload.competenceAt,'Data de competência');if(payload.dueAt!==undefined)row.dueAt=validDate(payload.dueAt,'Data de vencimento');
  if(payload.categoryId!==undefined){const c=await resolveCategory(payload.categoryId,row.direction);row.categoryId=c?String(c._id):'';row.categoryName=c?.name||''}
  if(payload.bankAccountId!==undefined){const b=await resolveBank(payload.bankAccountId);row.bankAccountId=b?String(b._id):'';row.bankAccountName=b?.name||''}
  for(const [field,key] of [['fineDefault','fineDefault'],['interestDefault','interestDefault'],['discountDefault','discountDefault']])if(payload[key]!==undefined)row[field]=Math.max(0,money(payload[key]));
  row.status=remaining(row)<=0.009?'paid':'pending';row.updatedBy=actorName(actor);await row.save();await audit('erp.ledger.entry.updated',{message:'Lançamento financeiro atualizado',entryId:String(row._id),by:actorName(actor)});return decorate(row)
 }
 async function listEntries(query={}){
  const filter={};if(['receivable','payable'].includes(query.direction))filter.direction=query.direction;if(['pending','paid','cancelled'].includes(query.status))filter.status=query.status;
  if(query.from||query.to){filter.dueAt={};if(query.from)filter.dueAt.$gte=new Date(query.from);if(query.to){const d=new Date(query.to);d.setHours(23,59,59,999);filter.dueAt.$lte=d}}
  if(query.categoryId)filter.categoryId=clean(query.categoryId,120);if(query.bankAccountId)filter.bankAccountId=clean(query.bankAccountId,120);if(query.paymentMethod)filter.paymentMethod=clean(query.paymentMethod,80);
  const q=clean(query.q||query.search,160);if(q){const rx=new RegExp(q.replace(/[.*+?^\${}()|[\]\\]/g,'\\$&'),'i');filter.$or=[{personName:rx},{description:rx},{categoryName:rx},{personDocument:rx},{documentNumber:rx},{boletoNumber:rx}]}
  const limit=Math.min(3000,Math.max(1,Number(query.limit||1000)));
  const docs=await Entry.find(filter).sort({dueAt:1,createdAt:-1}).limit(limit);
  let rows=docs.map(decorate);

  // Histórico importado: a posição da parcela pertence à compra original e
  // não pode ser recalculada com base somente nos títulos ainda visíveis.
  // Considera também parcelas já pagas da mesma venda, sem alterar o financeiro.
  const ids=rows.map(r=>r?._id).filter(Boolean);
  if(ids.length){
    const rawRows=await Entry.collection.find({_id:{$in:ids}}).project({
      _id:1,migration:1,sourceSystem:1,sourceId:1,origin:1
    }).toArray();
    const rawById=new Map(rawRows.map(r=>[String(r._id),r]));
    const saleIds=[...new Set(rawRows.map(r=>clean(r?.migration?.sourceSaleId,120)).filter(Boolean))];
    const installmentByEntry=new Map();

    if(saleIds.length){
      const HistoricalSale=context.mongoose?.models?.ErpSigeHistoricalSale||mongoose.models?.ErpSigeHistoricalSale||null;
      const historicalSales=HistoricalSale?await HistoricalSale.find({sourceSystem:'sige',sourceId:{$in:saleIds}}).lean():[];
      const originalTotalBySale=new Map(historicalSales.map(s=>{
        const live=s?.metadata?.sigeLive||{};
        const payments=Array.isArray(live?.payments)?live.payments:[];
        const total=Math.max(0,Number(live?.numberOfInstallments||0),Number(payments[0]?.installments||0),Number(s?.numberOfInstallments||0));
        return[clean(s?.sourceId,120),total];
      }));
      const siblings=await Entry.collection.find({
        direction:'receivable',
        'migration.sourceSaleId':{$in:saleIds},
        status:{$ne:'cancelled'}
      }).project({
        _id:1,dueAt:1,competenceAt:1,createdAt:1,migration:1,sourceId:1
      }).toArray();

      const groups=new Map();
      for(const row of siblings){
        const sid=clean(row?.migration?.sourceSaleId,120);
        if(!sid)continue;
        if(!groups.has(sid))groups.set(sid,[]);
        groups.get(sid).push(row);
      }

      for(const [sid,list] of groups){
        list.sort((a,b)=>{
          const ad=new Date(a?.dueAt||a?.competenceAt||a?.createdAt||0).getTime()||0;
          const bd=new Date(b?.dueAt||b?.competenceAt||b?.createdAt||0).getTime()||0;
          if(ad!==bd)return ad-bd;
          const as=clean(a?.sourceId,120),bs=clean(b?.sourceId,120);
          if(as!==bs)return as.localeCompare(bs,'pt-BR',{numeric:true});
          return String(a?._id||'').localeCompare(String(b?._id||''));
        });
        // Uma mesma compra histórica pode ter sido importada mais de uma vez.
        // Duplicidade é definida pelo ID original do lançamento (sourceId),
        // nunca pela data: parcelas legítimas podem compartilhar vencimento.
        const installmentGroups=new Map();
        for(const row of list){
          const originalId=clean(row?.sourceId,120);
          const key=originalId?('source:'+originalId):('entry:'+String(row?._id||''));
          if(!installmentGroups.has(key))installmentGroups.set(key,[]);
          installmentGroups.get(key).push(row);
        }
        const orderedGroups=[...installmentGroups.values()].sort((a,b)=>{
          const ar=a[0]||{},br=b[0]||{};
          const ad=new Date(ar?.dueAt||ar?.competenceAt||ar?.createdAt||0).getTime()||0;
          const bd=new Date(br?.dueAt||br?.competenceAt||br?.createdAt||0).getTime()||0;
          if(ad!==bd)return ad-bd;
          return clean(ar?.sourceId,120).localeCompare(clean(br?.sourceId,120),'pt-BR',{numeric:true});
        });
        const declaredTotal=Math.max(0,Number(originalTotalBySale.get(sid)||0));
        // Nunca permita que um total declarado menor encolha uma série original
        // maior já comprovada pelos IDs financeiros da própria compra.
        const total=Math.max(declaredTotal,orderedGroups.length);
        orderedGroups.forEach((sameInstallment,index)=>{
          for(const row of sameInstallment){
            installmentByEntry.set(String(row._id),{
              number:index+1,
              installments:total,
              sourceSaleId:sid
            });
          }
        });
      }
    }

    rows=rows.map(row=>{
      const id=String(row?._id||'');
      const raw=rawById.get(id)||{};
      const installment=installmentByEntry.get(id)||null;
      return{
        ...row,
        migration:raw.migration||row.migration||null,
        sourceSystem:raw.sourceSystem||row.sourceSystem||'',
        sourceId:raw.sourceId||row.sourceId||'',
        origin:raw.origin||row.origin||'',
        historicalInstallmentNumber:installment?.number||0,
        historicalInstallments:installment?.installments||0,
        historicalSourceSaleId:installment?.sourceSaleId||clean(raw?.migration?.sourceSaleId,120)
      };
    });
  }

  if(query.viewStatus==='partial')rows=rows.filter(r=>r.viewStatus==='partial');if(query.viewStatus==='pending')rows=rows.filter(r=>r.viewStatus==='pending');if(query.viewStatus==='paid')rows=rows.filter(r=>r.viewStatus==='paid');
  return rows
 }
 async function pay(id,payload={},actor={}){
  const row=await Entry.findById(id);if(!row)throw fail('Lançamento não encontrado.',404);if(row.status==='cancelled')throw fail('Lançamento cancelado não pode ser quitado.',409);
  const left=remaining(row);if(left<=0.009)throw fail('Este lançamento já está pago/recebido.',409);
  const settle=payload.settle===true||payload.quitar===true,principal=money(settle?left:(payload.principal??payload.paidPrincipal??payload.paidValue??payload.value??left));if(principal<=0)throw fail('Valor realizado inválido.');if(principal-left>0.009)throw fail('O valor principal não pode ultrapassar o saldo do lançamento.',409,'AMOUNT_EXCEEDS_BALANCE');
  const bankId=clean(payload.bankAccountId||row.bankAccountId,120),bank=bankId?await resolveBank(bankId):null,paidAt=validDate(payload.paidAt||new Date(),'Data de pagamento');
  const fine=Math.max(0,money(payload.fine??row.fineDefault??0)),interest=Math.max(0,money(payload.interest??row.interestDefault??0)),discount=Math.max(0,money(payload.discount??row.discountDefault??0)),totalPaid=Math.max(0,money(principal+fine+interest-discount));if(totalPaid<=0)throw fail('O total realizado precisa ser maior que zero.');
  const payment={id:`PAY-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,at:paidAt,principalApplied:principal,fine,interest,discount,totalPaid,method:clean(payload.paymentMethod||row.paymentMethod,80),bankAccountId:bank?String(bank._id):row.bankAccountId||'',bankAccountName:bank?.name||row.bankAccountName||'',document:clean(payload.document||payload.documentNumber,180),note:clean(payload.note||payload.notes,1000),reconciled:false,by:actorName(actor)};
  const payments=[...array(row.payments),payment],newPrincipal=money(principalPaid({...row.toObject(),payments})),newCash=money(cashPaid({...row.toObject(),payments})),newRemaining=Math.max(0,money(row.value-newPrincipal)),paid=newRemaining<=0.009;
  row.payments=payments;row.principalPaid=newPrincipal;row.paidValue=newCash;row.status=paid?'paid':'pending';row.paidAt=paidAt;row.paidBy=actorName(actor);if(bank){row.bankAccountId=String(bank._id);row.bankAccountName=bank.name}if(payment.method)row.paymentMethod=payment.method;
  await row.save();if(bank){const delta=row.direction==='receivable'?totalPaid:-totalPaid;try{await Bank.updateOne({_id:bank._id},{$inc:{currentBalance:delta}})}catch(e){row.payments=array(row.payments).filter(p=>p.id!==payment.id);row.principalPaid=principalPaid(row);row.paidValue=cashPaid(row);row.status=remaining(row)<=0.009?'paid':'pending';await row.save();throw e}}
  await audit(paid?'erp.ledger.entry.paid':'erp.ledger.entry.partial',{message:paid?'Lançamento quitado':'Pagamento parcial registrado',entryId:String(row._id),direction:row.direction,principal,totalPaid,remaining:newRemaining,bankAccountId:bank?String(bank._id):'',by:actorName(actor)});
  const decorated=decorate(row);
  if(row.direction!=='receivable')return decorated;
  const receiptDelivery=await paymentReceipts.afterLedgerReceive({
    entry:decorated,
    payment,
    actor
  }).catch(error=>({whatsappEnviado:false,requiresPhone:false,whatsapp:{ok:false,error:error?.message||String(error)}}));
  return{...decorated,receiptDelivery}
 }
 async function unpay(id,actor={}){
  const row=await Entry.findById(id);if(!row)throw fail('Lançamento não encontrado.',404);const ps=array(row.payments);if(!ps.length&&principalPaid(row)<=0)throw fail('Este lançamento não possui pagamento para reabrir.',409);
  const byBank=new Map();for(const p of ps){const bid=clean(p.bankAccountId,120);if(!bid)continue;byBank.set(bid,money((byBank.get(bid)||0)+Number(p.totalPaid??p.principalApplied??0)))}for(const [bid,total] of byBank){const delta=row.direction==='receivable'?-total:total;await Bank.updateOne({_id:bid},{$inc:{currentBalance:delta}})}
  row.status='pending';row.paidAt=null;row.paidValue=0;row.principalPaid=0;row.paidBy='';row.payments=[];row.reconciliationStatus='unreconciled';row.reconciledAt=null;await row.save();await audit('erp.ledger.entry.reopened',{message:'Lançamento reaberto e pagamentos desfeitos',entryId:String(row._id),by:actorName(actor)});return decorate(row)
 }
 async function cancel(id,actor={}){const row=await Entry.findById(id);if(!row)throw fail('Lançamento não encontrado.',404);if(principalPaid(row)>0)throw fail('Desfaça os pagamentos antes de cancelar.',409);row.status='cancelled';row.cancelledAt=new Date();row.cancelledBy=actorName(actor);await row.save();await audit('erp.ledger.entry.cancelled',{message:'Lançamento cancelado',entryId:String(row._id),by:actorName(actor)});return decorate(row)}
 async function listPayments(query={}){
  const filter={status:{$ne:'cancelled'}};if(['receivable','payable'].includes(query.direction))filter.direction=query.direction;if(query.bankAccountId)filter.bankAccountId=clean(query.bankAccountId,120);const rows=await Entry.find(filter).sort({updatedAt:-1}).limit(5000).lean(),out=[];const q=clean(query.q||query.search,160).toLowerCase();
  for(const r of rows)for(const p of array(r.payments)){const item={id:p.id||`${r._id}-${out.length}`,entryId:String(r._id),direction:r.direction,personName:r.personName,personDocument:r.personDocument||'',description:r.description||'',categoryName:r.categoryName||'',dueAt:r.dueAt,expectedValue:money(r.value),paidAt:p.at,totalPaid:money(p.totalPaid??p.principalApplied),principalApplied:money(p.principalApplied),fine:money(p.fine),interest:money(p.interest),discount:money(p.discount),paymentMethod:p.method||r.paymentMethod||'',bankAccountName:p.bankAccountName||r.bankAccountName||'',bankAccountId:p.bankAccountId||r.bankAccountId||'',document:p.document||'',note:p.note||'',reconciled:Boolean(p.reconciled),operator:p.by||''};if(q&&![item.personName,item.personDocument,item.description,item.categoryName,item.document,item.paymentMethod,item.bankAccountName].join(' ').toLowerCase().includes(q))continue;if(query.from&&new Date(item.paidAt)<new Date(query.from))continue;if(query.to){const d=new Date(query.to);d.setHours(23,59,59,999);if(new Date(item.paidAt)>d)continue}out.push(item)}
  out.sort((a,b)=>new Date(b.paidAt)-new Date(a.paidAt));return out.slice(0,3000)
 }
 async function report(query={}){const rows=await listEntries({...query,limit:3000});const active=rows.filter(r=>r.status!=='cancelled');const rec=active.filter(r=>r.direction==='receivable'),payRows=active.filter(r=>r.direction==='payable'),sum=(arr,field)=>money(arr.reduce((s,r)=>s+Number(field?r[field]:r.value||0),0));const recCash=sum(rec,'paidValue'),payCash=sum(payRows,'paidValue');return{receitaPrevista:sum(rec),receitaRealizada:recCash,receitaAberta:money(rec.reduce((s,r)=>s+r.remaining,0)),despesaPrevista:sum(payRows),despesaRealizada:payCash,despesaAberta:money(payRows.reduce((s,r)=>s+r.remaining,0)),saldoPrevisto:money(sum(rec)-sum(payRows)),saldoRealizado:money(recCash-payCash),count:active.length}}
 return{categories,createCategory,updateCategory,banks,createBank,updateBank,createReceivable:(p,a)=>createEntry('receivable',p,a),createPayable:(p,a)=>createEntry('payable',p,a),updateEntry,listEntries,pay,unpay,cancel,listPayments,report};
}
export default createErpLedgerService;
