const clean=(v='',m=1000)=>String(v??'').trim().slice(0,m);
const array=v=>Array.isArray(v)?v:[];
const money=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
function fail(message,statusCode=400,code='ERP_SIGE_SALE_ERROR'){const e=new Error(message);e.statusCode=statusCode;e.code=code;return e}
function actorName(a={}){return clean(a.name||a.nome||a.email||'Operador',180)}
function validDate(value,label){const d=new Date(value);if(Number.isNaN(d.getTime()))throw fail(`${label} inválida.`,400,'INVALID_DATE');return d}

export function createErpSigeSaleParityService(context={}){
 const {Order,IntegrationAuditLog,toJSON,redact}=context;
 if(!Order)throw new Error('[erp-sige-sale] Order não informado');
 const serial=d=>typeof toJSON==='function'?toJSON(d):(d?.toObject?d.toObject():d);
 async function findOrder(id){let order=null;try{order=await Order.findById(id)}catch{}if(!order)order=await Order.findOne({origin:'erp_ariana','televendas.erp.code':clean(id,120)});if(!order||order.origin!=='erp_ariana')throw fail('Venda do Ariana ERP não encontrada.',404,'ERP_ORDER_NOT_FOUND');return order}
 async function audit(type,order,metadata={}){if(!IntegrationAuditLog)return;try{await IntegrationAuditLog.create({scope:'erp_ariana',eventType:type,orderId:String(order?._id||''),status:order?.status||'',message:clean(metadata.message||'',1000),metadata:redact?redact(metadata):metadata})}catch(e){console.warn('[erp-sige-sale/audit]',e.message)}}
 function recalc(order,erp,receivables){const open=receivables.filter(r=>!['cancelado','estornado'].includes(r.status));const received=open.filter(r=>r.status==='recebido');const all=open.length>0&&received.length===open.length;const some=received.length>0;order.paymentStatus=all?'approved':some?'partial':'pending';order.payment={...(order.payment||{}),status:all?'approved':some?'partial':'pending',received:all,receivedAt:all?(order.payment?.receivedAt||new Date()):null};return{...erp,receivables,financialStatus:all?'settled':some?'partial':'generated',financialSettledAt:all?(erp.financialSettledAt||new Date()):null}}
 async function updateReceivable(orderId,number,payload={},actor={}){
  const order=await findOrder(orderId);if(!['pedido','venda','faturado'].includes(String(order.status||'').toLowerCase()))throw fail('O financeiro só pode ser editado em pedido ou venda ativa.',409,'ORDER_NOT_FINANCIAL');
  const erp=order.televendas?.erp||{},rows=array(erp.receivables).map(r=>({...r})),n=Math.max(1,Number(number||0)),idx=rows.findIndex(r=>Number(r.number)===n);if(idx<0)throw fail('Parcela não encontrada.',404,'RECEIVABLE_NOT_FOUND');
  const current=rows[idx];if(['cancelado','estornado'].includes(current.status))throw fail('Parcela cancelada/estornada não pode ser alterada.',409,'RECEIVABLE_CLOSED');
  const next={...current};
  if(payload.dueAt!==undefined||payload.dueDate!==undefined)next.dueAt=validDate(payload.dueAt??payload.dueDate,'Data de vencimento');
  if(payload.competenceAt!==undefined||payload.competenceDate!==undefined)next.competenceAt=validDate(payload.competenceAt??payload.competenceDate,'Data de competência');
  else if(!next.competenceAt)next.competenceAt=order.updatedAt||order.createdAt||new Date();
  if(payload.method!==undefined||payload.paymentMethod!==undefined)next.method=clean(payload.method??payload.paymentMethod,80);
  if(payload.categoryName!==undefined)next.categoryName=clean(payload.categoryName,160);
  if(payload.bankAccountName!==undefined)next.bankAccountName=clean(payload.bankAccountName,180);
  if(payload.description!==undefined)next.description=clean(payload.description,500);
  if(payload.notes!==undefined||payload.note!==undefined)next.notes=clean(payload.notes??payload.note,2000);
  if(payload.receivedAmount!==undefined){const amount=money(payload.receivedAmount);if(amount<=0)throw fail('Valor recebido deve ser maior que zero.',400,'INVALID_RECEIVED_AMOUNT');next.receivedAmount=amount}
  let paid=null;if(payload.paid!==undefined)paid=Boolean(payload.paid);else if(payload.status==='recebido'||payload.status==='paid')paid=true;else if(payload.status==='pendente'||payload.status==='pending')paid=false;
  if(paid===true){next.status='recebido';next.receivedAt=payload.receivedAt?validDate(payload.receivedAt,'Data de recebimento'):(next.receivedAt||new Date());next.receivedAmount=money(payload.receivedAmount??next.receivedAmount??next.value);next.receivedMethod=clean(payload.receivedMethod||payload.method||payload.paymentMethod||next.method||order.payment?.method||'',80);next.receivedBy=actorName(actor)}
  if(paid===false){next.status='pendente';next.receivedAt=null;next.receivedAmount=0;next.receivedMethod='';next.receivedBy=''}
  rows[idx]=next;
  const nextErp=recalc(order,erp,rows);nextErp.timeline=[...array(erp.timeline),{status:'financeiro',label:`Parcela ${n}/${next.installments||rows.length} atualizada`,at:new Date(),by:actorName(actor)}];order.televendas={...(order.televendas||{}),erp:nextErp};await order.save();await audit('erp.receivable.updated',order,{message:`Parcela ${n} atualizada`,number:n,dueAt:next.dueAt,status:next.status,method:next.method});return{order:serial(order),receivable:next}
 }
 async function updateSigeFields(orderId,payload={},actor={}){const order=await findOrder(orderId);const erp=order.televendas?.erp||{},next={...erp};if(payload.sellerName!==undefined)next.sellerName=clean(payload.sellerName,180);if(payload.priceTable!==undefined)next.priceTable=clean(payload.priceTable,160)||'Preço Padrão';if(payload.saleDate!==undefined)next.saleDate=validDate(payload.saleDate,'Data da venda');if(payload.details!==undefined)next.details=clean(payload.details,3000);next.timeline=[...array(erp.timeline),{status:'detalhes',label:'Dados comerciais da venda atualizados',at:new Date(),by:actorName(actor)}];order.televendas={...(order.televendas||{}),erp:next};await order.save();await audit('erp.order.sige_fields.updated',order,{message:'Dados comerciais da venda atualizados'});return{order:serial(order)}}
 return{updateReceivable,updateSigeFields};
}
export default createErpSigeSaleParityService;
