import { calculateLateCharge, lateChargeFactor, ERP_LATE_CHARGE_POLICY } from './erpLateChargeService.js';

const clean=(v='',m=1000)=>String(v??'').trim().slice(0,m);
const array=v=>Array.isArray(v)?v:[];
const money=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
const digits=v=>String(v||'').replace(/\D/g,'');
function fail(message,statusCode=400,code='ERP_FINANCE_ERROR'){const e=new Error(message);e.statusCode=statusCode;e.code=code;return e}
function actorName(a={}){return clean(a.name||a.email||'Operador',160)}
function validDate(v,label='Data'){const d=new Date(v);if(Number.isNaN(d.getTime()))throw fail(`${label} inválida.`,400,'INVALID_DATE');return d}

export function createErpFinanceService(context={}){
 const {Order,IntegrationAuditLog,toJSON,redact}=context;
 if(!Order)throw new Error('[erp-finance] Order não informado');
 const serial=d=>typeof toJSON==='function'?toJSON(d):(d?.toObject?d.toObject():d);
 async function findOrder(id){let o=null;try{o=await Order.findById(id)}catch{}if(!o||o.origin!=='erp_ariana')throw fail('Venda do Ariana ERP não encontrada.',404,'ERP_ORDER_NOT_FOUND');return o}
 async function audit(type,o,metadata={}){if(!IntegrationAuditLog)return;try{await IntegrationAuditLog.create({scope:'erp_ariana',eventType:type,orderId:String(o?._id||''),status:o?.status||'',message:clean(metadata.message||'',1000),metadata:redact?redact(metadata):metadata})}catch(e){console.warn('[erp-finance/audit]',e.message)}}
 function receivedTotal(r={}){if(array(r.payments).length)return money(array(r.payments).reduce((s,p)=>s+Number(p.principalApplied??p.amount??0),0));return money(r.receivedAmount??(r.status==='recebido'?r.value:0))}
 function remaining(r={}){return Math.max(0,money(Number(r.value||0)-receivedTotal(r)))}
 function state(r={}){const got=receivedTotal(r);if(r.status==='recebido'||remaining(r)<=0.009)return'recebido';if(got>0)return'parcial';return r.status||'pendente'}
 function customerKey(order={}){const doc=digits(order.customerCpf);return doc?`doc:${doc}`:`name:${clean(order.customerName||'Consumidor',180).toLowerCase()}`}
 function late(r={},principal=remaining(r),asOf=new Date()){return calculateLateCharge({principal,dueAt:r.dueAt,asOf,direction:'receivable'})}
 function rowFrom(order,r){const got=receivedTotal(r),left=remaining(r),st=state(r),erp=order.televendas?.erp||{},lc=late(r,left);return{orderId:String(order._id),code:erp.code||String(order._id).slice(-8).toUpperCase(),customerName:order.customerName||'Consumidor',customerCpf:order.customerCpf||'',customerPhone:order.customerPhone||'',customerEmail:order.customerEmail||'',number:Number(r.number||1),installments:Number(r.installments||1),value:money(r.value),dueAt:r.dueAt,status:st,rawStatus:r.status||'pendente',method:r.method||order.payment?.method||'',receivedAt:r.receivedAt||null,receivedAmount:got,remaining:left,daysLate:lc.daysLate,lateFine:lc.fine,lateInterest:lc.interest,lateCharges:lc.charges,updatedRemaining:lc.updatedTotal,overdue:lc.overdue,payments:array(r.payments),orderTotal:money(order.total)}}
 async function list(query={}){
  const filter={origin:'erp_ariana','televendas.erp.financialStatus':{$in:['generated','partial','settled','reversed']}};
  const orders=await Order.find(filter).sort({updatedAt:-1}).limit(2000);
  let rows=[];
  for(const order of orders){for(const r of array(order.televendas?.erp?.receivables))rows.push(rowFrom(order,r))}
  const q=clean(query.q||query.search||'',180).toLowerCase();
  if(q)rows=rows.filter(r=>[r.code,r.customerName,r.customerCpf,r.customerPhone,r.customerEmail,r.method].join(' ').toLowerCase().includes(q));
  const customer=clean(query.customer||query.cliente||'',180).toLowerCase();if(customer)rows=rows.filter(r=>[r.customerName,r.customerCpf,r.customerPhone,r.customerEmail].join(' ').toLowerCase().includes(customer));
  const method=clean(query.method||query.paymentMethod||'',80).toLowerCase();if(method&&method!=='all')rows=rows.filter(r=>String(r.method||'').toLowerCase()===method);
  if(query.status&&query.status!=='all')rows=rows.filter(r=>r.status===query.status||(query.status==='pendente'&&['pendente','parcial'].includes(r.status)));
  if(query.from){const from=validDate(query.from,'Data inicial');from.setHours(0,0,0,0);rows=rows.filter(r=>r.dueAt&&new Date(r.dueAt)>=from)}
  if(query.to){const to=validDate(query.to,'Data final');to.setHours(23,59,59,999);rows=rows.filter(r=>r.dueAt&&new Date(r.dueAt)<=to)}
  if(query.overdue==='1'||query.overdue==='true')rows=rows.filter(r=>['pendente','parcial'].includes(r.status)&&r.overdue);
  rows.sort((a,b)=>new Date(a.dueAt||0)-new Date(b.dueAt||0));
  const open=rows.filter(r=>['pendente','parcial'].includes(r.status));
  const totalPending=money(open.reduce((s,r)=>s+r.remaining,0));
  const totalPendingUpdated=money(open.reduce((s,r)=>s+(r.updatedRemaining??r.remaining),0));
  const totalReceived=money(rows.reduce((s,r)=>s+r.receivedAmount,0));
  const overdueRows=open.filter(r=>r.overdue);
  return{receivables:rows,summary:{count:rows.length,totalOriginal:money(rows.reduce((s,r)=>s+r.value,0)),totalPending,totalPendingUpdated,totalReceived,overdue:overdueRows.length,totalOverdue:money(overdueRows.reduce((s,r)=>s+r.remaining,0)),totalOverdueUpdated:money(overdueRows.reduce((s,r)=>s+(r.updatedRemaining??r.remaining),0)),lateChargePolicy:ERP_LATE_CHARGE_POLICY}}
 }
 async function receive(orderId,number,payload={},actor={}){
  const order=await findOrder(orderId);
  if(order.status!=='faturado')throw fail('Somente venda faturada pode receber parcela.',409,'ORDER_NOT_BILLED');
  const erp=order.televendas?.erp||{},receivables=array(erp.receivables).map(r=>({...r,payments:array(r.payments).map(p=>({...p}))})),n=Math.max(1,Number(number||0)),idx=receivables.findIndex(r=>Number(r.number)===n);
  if(idx<0)throw fail('Parcela não encontrada.',404,'RECEIVABLE_NOT_FOUND');
  const current=receivables[idx];
  if(current.status==='recebido'||remaining(current)<=0.009)throw fail('Esta parcela já foi recebida.',409,'ALREADY_RECEIVED');
  if(['cancelado','estornado'].includes(current.status))throw fail('Esta parcela está cancelada/estornada.',409,'RECEIVABLE_CLOSED');
  const left=remaining(current),settle=payload.settle===true||payload.quitar===true;
  const principal=money(settle?left:(payload.amount??payload.principal??payload.value??left));
  if(principal<=0)throw fail('Valor recebido inválido.',400,'INVALID_AMOUNT');
  if(principal-left>0.009)throw fail(`O valor aplicado à parcela não pode ultrapassar ${left.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}.`,400,'AMOUNT_EXCEEDS_BALANCE');
  const paymentAt=payload.paidAt?validDate(payload.paidAt,'Data do pagamento'):new Date();
  const auto=late(current,principal,paymentAt),manualLate=payload.lateChargeMode==='manual'||payload.autoLateCharge===false||payload.waiveLateCharges===true;
  const fine=Math.max(0,money(manualLate?(payload.fine??payload.multa??0):auto.fine)),interest=Math.max(0,money(manualLate?(payload.interest??payload.juros??0):auto.interest)),discount=Math.max(0,money(payload.discount??payload.desconto??0));
  const cashTotal=Math.max(0,money(principal+fine+interest-discount));
  const payment={at:paymentAt,principalApplied:principal,fine,interest,discount,totalPaid:cashTotal,lateChargeMode:manualLate?'manual':'automatic',daysLate:auto.daysLate,fineRate:auto.fineRate,monthlyInterestRate:auto.monthlyInterestRate,method:clean(payload.method||payload.paymentMethod||current.method||order.payment?.method||'',80),bankAccountName:clean(payload.bankAccountName||payload.bank||'',180),document:clean(payload.document||payload.documento||'',180),note:clean(payload.note||payload.notes||'',1000),by:actorName(actor)};
  current.payments=[...array(current.payments),payment];
  const got=receivedTotal(current),newRemaining=remaining(current),paid=newRemaining<=0.009;
  receivables[idx]={...current,status:paid?'recebido':'pendente',receivedAt:paid?payment.at:null,receivedAmount:got,receivedMethod:payment.method,receiptNote:payment.note,receivedBy:actorName(actor)};
  const all=receivables.every(r=>state(r)==='recebido'),some=receivables.some(r=>receivedTotal(r)>0);
  order.paymentStatus=all?'approved':some?'partial':'pending';
  order.payment={...(order.payment||{}),status:all?'approved':some?'partial':'pending',received:all,receivedAt:all?new Date():order.payment?.receivedAt};
  order.televendas={...(order.televendas||{}),erp:{...erp,receivables,financialStatus:all?'settled':some?'partial':'generated',financialSettledAt:all?new Date():null,timeline:[...array(erp.timeline),{status:'recebimento',label:`Parcela ${n}/${receivables[idx].installments}: ${paid?'quitada':'pagamento parcial'} de ${cashTotal.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}`,at:new Date(),by:actorName(actor)}]}};
  await order.save();
  await audit(paid?'erp.receivable.received':'erp.receivable.partial',order,{message:paid?`Parcela ${n} quitada`:`Pagamento parcial na parcela ${n}`,number:n,principal,fine,interest,cashTotal,remaining:newRemaining,daysLate:auto.daysLate,lateChargeMode:payment.lateChargeMode});
  const remainingCharge=late(receivables[idx],newRemaining);
  return{order:serial(order),receivable:{...receivables[idx],status:state(receivables[idx]),remaining:newRemaining,receivedAmount:got,daysLate:remainingCharge.daysLate,lateFine:remainingCharge.fine,lateInterest:remainingCharge.interest,lateCharges:remainingCharge.charges,updatedRemaining:remainingCharge.updatedTotal,overdue:remainingCharge.overdue},payment}
 }
 async function resolveSelection(items=[]){
  const selected=array(items);if(!selected.length)throw fail('Selecione pelo menos um lançamento.',400,'NO_SELECTION');if(selected.length>300)throw fail('Selecione no máximo 300 lançamentos por operação.',400,'TOO_MANY_SELECTED');
  const rows=[];
  for(const item of selected){const order=await findOrder(item.orderId);if(order.status!=='faturado')throw fail(`A venda ${order.televendas?.erp?.code||order._id} não está faturada.`,409,'ORDER_NOT_BILLED');const n=Math.max(1,Number(item.number||0)),r=array(order.televendas?.erp?.receivables).find(x=>Number(x.number)===n);if(!r)throw fail(`Parcela ${n} não encontrada.`,404,'RECEIVABLE_NOT_FOUND');const left=remaining(r);if(['cancelado','estornado'].includes(r.status)||state(r)==='recebido'||left<=0.009)throw fail(`Parcela ${n} de ${order.customerName||'cliente'} não está disponível para recebimento.`,409,'RECEIVABLE_CLOSED');rows.push({order,number:n,receivable:r,remaining:left,key:customerKey(order),dueAt:r.dueAt})}
  return rows
 }
 async function settleSelected(items=[],payload={},actor={}){
  const rows=await resolveSelection(items),results=[];
  for(const row of rows){results.push(await receive(String(row.order._id),row.number,{...payload,settle:true},actor))}
  const totalPrincipal=money(results.reduce((s,x)=>s+Number(x.payment?.principalApplied||0),0)),totalFine=money(results.reduce((s,x)=>s+Number(x.payment?.fine||0),0)),totalInterest=money(results.reduce((s,x)=>s+Number(x.payment?.interest||0),0)),totalPaid=money(results.reduce((s,x)=>s+Number(x.payment?.totalPaid||0),0));
  return{processed:results.length,totalPrincipal,totalFine,totalInterest,totalPaid,results:results.map(x=>({orderId:String(x.order?._id||x.order?.id||''),receivable:x.receivable,payment:x.payment}))}
 }
 async function allocateByCustomer(items=[],payload={},actor={}){
  const rows=await resolveSelection(items);const keys=[...new Set(rows.map(r=>r.key))];if(keys.length!==1)throw fail('A distribuição por cliente aceita lançamentos de um único cliente por vez.',400,'MULTIPLE_CUSTOMERS');
  let available=money(payload.amount??payload.value??0);if(available<=0)throw fail('Informe o valor recebido do cliente.',400,'INVALID_AMOUNT');
  const paidAt=payload.paidAt?validDate(payload.paidAt,'Data do pagamento'):new Date();
  const totalUpdated=money(rows.reduce((s,r)=>s+calculateLateCharge({principal:r.remaining,dueAt:r.dueAt,asOf:paidAt,direction:'receivable'}).updatedTotal,0));if(available-totalUpdated>0.009)throw fail(`O valor recebido é maior que o saldo atualizado selecionado (${totalUpdated.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}).`,400,'AMOUNT_EXCEEDS_SELECTION');
  rows.sort((a,b)=>new Date(a.dueAt||0)-new Date(b.dueAt||0));const results=[];
  for(const row of rows){if(available<=0.009)break;const full=calculateLateCharge({principal:row.remaining,dueAt:row.dueAt,asOf:paidAt,direction:'receivable'});let principal;if(available+0.009>=full.updatedTotal)principal=row.remaining;else{const factor=lateChargeFactor({dueAt:row.dueAt,asOf:paidAt,direction:'receivable'});principal=Math.floor((available/factor)*100)/100}if(principal<=0)break;const result=await receive(String(row.order._id),row.number,{...payload,paidAt,amount:principal,settle:principal+0.009>=row.remaining,discount:0},actor);results.push(result);available=Math.max(0,money(available-Number(result.payment?.totalPaid||0)))}
  const applied=money(results.reduce((s,x)=>s+Number(x.payment?.principalApplied||0),0)),charges=money(results.reduce((s,x)=>s+Number(x.payment?.fine||0)+Number(x.payment?.interest||0),0)),paid=money(results.reduce((s,x)=>s+Number(x.payment?.totalPaid||0),0));return{processed:results.length,applied,charges,totalPaid:paid,unapplied:available,customerName:rows[0]?.order?.customerName||'',results:results.map(x=>({orderId:String(x.order?._id||x.order?.id||''),receivable:x.receivable,payment:x.payment}))}
 }
 return{list,receive,settleSelected,allocateByCustomer}
}
export default createErpFinanceService;
