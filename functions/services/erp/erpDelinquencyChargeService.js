import mongoose from 'mongoose';

const TZ='America/Sao_Paulo';
const clean=(v='',m=2000)=>String(v??'').trim().replace(/\s+/g,' ').slice(0,m);
const digits=v=>String(v??'').replace(/\D/g,'');
const money=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
const arr=v=>Array.isArray(v)?v:[];
const escRx=s=>String(s??'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const TEMPLATES=new Set(['visita','retorno']);

function fail(message,statusCode=400,code='ERP_DELINQUENCY_CHARGE_ERROR'){const e=new Error(message);e.statusCode=statusCode;e.code=code;return e}
function actorName(a={}){return clean(a.name||a.nome||a.fullName||a.displayName||a.email||'Operador',180)}
function brl(v){return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}
function startToday(){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const x=Object.fromEntries(parts.filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));return new Date(`${x.year}-${x.month}-${x.day}T00:00:00-03:00`)}
function principalPaid(r={}){const payments=arr(r.payments);if(payments.length)return money(payments.reduce((s,p)=>s+Number(p.principalApplied??p.principal??p.amount??0),0));if(Number(r.principalPaid||0)>0)return money(r.principalPaid);if(['paid','recebido'].includes(String(r.status||'').toLowerCase()))return money(r.value);return Math.min(money(r.value),Math.max(0,money(r.paidValue??r.receivedAmount??0)))}
function outstanding(r={}){return Math.max(0,money(Number(r.value||0)-principalPaid(r)))}
function chargeValues(r={}){const principal=outstanding(r),fine=Math.max(0,money(r.fineAmount??r.fineDefault??r.fine??r.multa??0)),interest=Math.max(0,money(r.interestAmount??r.interestDefault??r.interest??r.juros??0)),correction=Math.max(0,money(r.correctionAmount??r.monetaryCorrection??r.correction??r.correcao??0));return{principal,fine,interest,correction,updated:money(principal+fine+interest+correction)}}
function normalizeRecipientPhone(value=''){const raw=clean(value,80);let number=digits(raw).replace(/^0+/,'');if(!number)return'';if(raw.startsWith('+'))return number;if(raw.startsWith('00'))return digits(raw.slice(2));if(number.startsWith('55')&&number.length>=12)return number;if(number.length===10||number.length===11)return`55${number}`;return number}
function validRecipientPhone(raw=''){const normalized=normalizeRecipientPhone(raw),explicit=clean(raw,80).startsWith('+')||clean(raw,80).startsWith('00');return{normalized,valid:explicit?(normalized.length>=8&&normalized.length<=15):(normalized.length>=12&&normalized.length<=15)}}
function storedCustomerPhone(value=''){const raw=clean(value,80),number=digits(raw);if(!number)return'';if(raw.startsWith('+'))return'+'+number;if(raw.startsWith('00'))return'+'+digits(raw.slice(2));return number}
function displayReference(value='',fallback='Compra histórica'){const s=clean(value,180);if(!s)return fallback;if(/hist[oó]rico\s+sige|venda\s+ref\.?\s*[a-z0-9-]{8,}|^sige\b/i.test(s))return fallback;if(/^[a-f0-9]{24}$/i.test(s))return fallback;return s}
function extractMessageId(data={}){return clean(data?.key?.id||data?.messageId||data?.id||data?.data?.key?.id||data?.data?.messageId||data?.response?.key?.id,200)}
function evolutionConfig(){return{base:clean(process.env.ERP_COLLECTION_EVOLUTION_API_URL||process.env.ARIANA_EVOLUTION_API_URL||process.env.EVOLUTION_API_URL||process.env.EVOLUTION_URL,500).replace(/\/+$/,''),apiKey:clean(process.env.ERP_COLLECTION_EVOLUTION_API_KEY||process.env.ARIANA_EVOLUTION_API_KEY||process.env.EVOLUTION_API_KEY||process.env.EVOLUTION_GLOBAL_API_KEY,500),instance:clean(process.env.ERP_COLLECTION_MAIN_STORE_EVOLUTION_INSTANCE||process.env.ARIANA_LOJA_EVOLUTION_INSTANCE||process.env.EVOLUTION_LOJA_INSTANCE||'ariana loja',180),senderPhone:'5531985147119'}}
async function readEvolutionResponse(response){const raw=await response.text();let data={};try{data=raw?JSON.parse(raw):{}}catch{data={message:raw}}if(!response.ok){const detail=clean(data?.message||data?.error||raw||`HTTP ${response.status}`,600);throw fail(`WhatsApp respondeu ${response.status}: ${detail}`,502,'ERP_COLLECTION_WHATSAPP_FAILED')}return data}
async function sendEvolution(phone,message){const cfg=evolutionConfig();if(!cfg.base||!cfg.apiKey||!cfg.instance)throw fail('WhatsApp principal da loja não está configurado no backend.',503,'ERP_COLLECTION_WHATSAPP_NOT_CONFIGURED');const response=await fetch(`${cfg.base}/message/sendText/${encodeURIComponent(cfg.instance)}`,{method:'POST',headers:{'Content-Type':'application/json',apikey:cfg.apiKey},body:JSON.stringify({number:phone,text:message}),signal:AbortSignal.timeout(15000)});const data=await readEvolutionResponse(response);return{provider:'evolution',instance:cfg.instance,senderPhone:cfg.senderPhone,messageId:extractMessageId(data),response:data}}
function chargeLogModel(){if(mongoose.models.ErpDelinquencyChargeLog)return mongoose.models.ErpDelinquencyChargeLog;const schema=new mongoose.Schema({targetId:{type:String,required:true,index:true},purchaseKey:{type:String,default:'',index:true},orderId:{type:String,default:'',index:true},reference:{type:String,default:'',index:true},clientName:{type:String,default:'',index:true},clientDocument:{type:String,default:'',index:true},clientPhone:{type:String,default:'',index:true},template:{type:String,default:''},installments:{type:Number,default:0},principalAmount:{type:Number,default:0},fineAmount:{type:Number,default:0},interestAmount:{type:Number,default:0},correctionAmount:{type:Number,default:0},totalUpdated:{type:Number,default:0},message:{type:String,default:''},senderPhone:{type:String,default:''},evolutionInstance:{type:String,default:''},providerMessageId:{type:String,default:'',index:true},status:{type:String,default:'PENDING',index:true},error:{type:String,default:''},sentAt:{type:Date,default:null},sentBy:{type:String,default:''}},{timestamps:true,collection:'erp_delinquency_charge_logs'});schema.index({clientDocument:1,createdAt:-1});schema.index({orderId:1,createdAt:-1});return mongoose.model('ErpDelinquencyChargeLog',schema)}
function messageFor(template,name,total,charges){const client=clean(name,220)||'cliente';const hasCharges=Number(charges.fine||0)+Number(charges.interest||0)+Number(charges.correction||0)>0;const amountText=brl(total);const base=hasCharges?`Olá, ${client}, tudo bem? Consta aqui no meu sistema umas parcelas atrasadas com o valor total de ${amountText}, já com a correção, os juros e a multa registrados no sistema.`:`Olá, ${client}, tudo bem? Consta aqui no meu sistema umas parcelas atrasadas com o valor total atualizado de ${amountText}.`;if(template==='retorno')return`${base} Você poderia me retornar aqui o mais rápido possível, fazendo favor? Obrigado.`;return`${base} Eu posso estar passando aí hoje para pegar o dinheiro com você?`}

export function createErpDelinquencyChargeService(context={}){
  const {Order,User}=context;if(!Order)throw new Error('[erp-delinquency-charge] Order não informado');
  const Log=chargeLogModel();

  async function findCurrentPerson(base={}){
    const Person=mongoose.models.ErpPerson;if(!Person)return null;let person=null;const doc=digits(base.document),email=clean(base.email,320).toLowerCase(),name=clean(base.name,220);
    if(doc)person=await Person.findOne({document:doc,active:{$ne:false}}).sort({updatedAt:-1}).lean();
    if(!person&&email)person=await Person.findOne({email,active:{$ne:false}}).sort({updatedAt:-1}).lean();
    if(!person&&name){const rx=new RegExp('^'+escRx(name)+'

  function rowSummary(raw={},extra={}){const values=chargeValues(raw);return{installment:clean(extra.installment||raw.installmentNumber||raw.parcelNumber||raw.number||'',50),dueAt:raw.dueAt||null,reference:clean(extra.reference||raw.documentNumber||raw.description||raw.sourceId||'',180),...values}}

  async function financialEntryContext(entryId){
    const Entry=mongoose.models.ErpFinancialEntry;if(!Entry)throw fail('Livro financeiro do ERP não está disponível.',503,'ERP_LEDGER_UNAVAILABLE');if(!mongoose.isValidObjectId(entryId))throw fail('Parcela financeira inválida.',404,'DELINQUENCY_TARGET_NOT_FOUND');
    const selected=await Entry.collection.findOne({_id:new mongoose.Types.ObjectId(entryId)});if(!selected||selected.direction!=='receivable')throw fail('Parcela financeira não encontrada.',404,'DELINQUENCY_TARGET_NOT_FOUND');
    const today=startToday(),base={direction:'receivable',status:{$nin:['paid','cancelled']},dueAt:{$lt:today}},sourceSaleId=clean(selected?.migration?.sourceSaleId,180);let purchaseKey='';
    if(clean(selected.orderId,120)){base.orderId=clean(selected.orderId,120);purchaseKey=`order:${base.orderId}`}
    else if(sourceSaleId){base['migration.sourceSaleId']=sourceSaleId;purchaseKey=`sige:${sourceSaleId}`}
    else if(clean(selected.documentNumber,120)){base.documentNumber=clean(selected.documentNumber,120);if(clean(selected.personDocument,60))base.personDocument=clean(selected.personDocument,60);purchaseKey=`document:${base.documentNumber}`}
    else{base._id=selected._id;purchaseKey=`entry:${String(selected._id)}`}
    const rows=(await Entry.collection.find(base).sort({dueAt:1}).toArray()).filter(r=>outstanding(r)>0.009),effective=rows.length?rows:[selected],reference=sourceSaleId?displayReference(selected.description||selected.documentNumber,'Compra histórica'):displayReference(selected.documentNumber||selected.description||String(selected._id),'Compra histórica');
    const items=effective.map((r,index)=>rowSummary(r,{installment:`${Number(r.installmentNumber||r.parcelNumber||index+1)}/${effective.length}`,reference}));
    const contact=await currentCustomer({name:selected.personName,document:selected.personDocument,email:selected.email||selected.personEmail,phone:selected.phone||selected.personPhone});
    return{targetId:`entry:${entryId}`,purchaseKey,orderId:clean(selected.orderId,120),reference,contact,items};
  }

  async function orderContext(orderId,number){if(!mongoose.isValidObjectId(orderId))throw fail('Venda do ERP inválida.',404,'DELINQUENCY_TARGET_NOT_FOUND');const order=await Order.findById(orderId).lean();if(!order||order.origin!=='erp_ariana')throw fail('Venda do Ariana ERP não encontrada.',404,'DELINQUENCY_TARGET_NOT_FOUND');const today=startToday(),erp=order.televendas?.erp||{},all=arr(erp.receivables),selected=all.find(r=>Number(r.number||1)===Number(number||1));if(!selected)throw fail('Parcela da venda não encontrada.',404,'DELINQUENCY_TARGET_NOT_FOUND');const rows=all.filter(r=>{const st=String(r.status||'').toLowerCase(),due=new Date(r.dueAt||0);return!['recebido','cancelado','estornado','paid'].includes(st)&&!Number.isNaN(due.getTime())&&due<today&&outstanding(r)>0.009});const items=rows.map(r=>rowSummary(r,{installment:`${Number(r.number||1)}/${Number(r.installments||1)}`,reference:clean(erp.code||String(order._id).slice(-8).toUpperCase(),180)}));const contact=await currentCustomer({name:order.customerName,document:order.customerCpf,email:order.customerEmail,phone:order.customerPhone});return{targetId:`order:${orderId}:${Number(number||1)}`,purchaseKey:`order:${orderId}`,orderId:String(order._id),reference:clean(erp.code||String(order._id).slice(-8).toUpperCase(),180),contact,items};
  }

  async function contextFor(targetId){const id=clean(targetId,260);if(id.startsWith('entry:'))return financialEntryContext(id.slice(6));if(id.startsWith('order:')){const parts=id.split(':');return orderContext(parts[1],parts[2])}throw fail('Parcela/título de cobrança inválido.',404,'DELINQUENCY_TARGET_NOT_FOUND')}

  async function build(targetId,template='visita'){
    const selected=TEMPLATES.has(clean(template,30))?clean(template,30):'visita',ctx=await contextFor(targetId);if(!ctx.items.length)throw fail('Esta compra não possui parcelas vencidas em aberto.',409,'NO_OVERDUE_INSTALLMENTS');const totals={principal:money(ctx.items.reduce((s,x)=>s+x.principal,0)),fine:money(ctx.items.reduce((s,x)=>s+x.fine,0)),interest:money(ctx.items.reduce((s,x)=>s+x.interest,0)),correction:money(ctx.items.reduce((s,x)=>s+x.correction,0)),updated:money(ctx.items.reduce((s,x)=>s+x.updated,0))};const phoneInfo=validRecipientPhone(ctx.contact.phone);if(!phoneInfo.valid)throw fail('O cliente não possui um WhatsApp válido no cadastro atual do Ariana ERP.',409,'CUSTOMER_WHATSAPP_INVALID');const message=messageFor(selected,ctx.contact.name,totals.updated,totals);return{...ctx,template:selected,phone:phoneInfo.normalized,totals,message,chargesNote:'O valor atualizado usa somente multa, juros e correção que estejam registrados nos dados financeiros da compra; nenhuma taxa é criada automaticamente.'};
  }

  async function preview(targetId,template='visita'){const data=await build(targetId,template);const cfg=evolutionConfig();return{...data,sender:{phone:cfg.senderPhone,instance:cfg.instance},templates:{visita:messageFor('visita',data.contact.name,data.totals.updated,data.totals),retorno:messageFor('retorno',data.contact.name,data.totals.updated,data.totals)}}}

  async function saveContact(targetId,payload={},actor={}){
    const rawPhone=payload.phone??payload.telefone??payload.whatsapp??'',phoneInfo=validRecipientPhone(rawPhone);
    if(!phoneInfo.valid)throw fail('Informe um número de WhatsApp válido com DDD (ex.: 33 99999-9999).',400,'CUSTOMER_WHATSAPP_INVALID');
    const storedPhone=storedCustomerPhone(rawPhone),ctx=await contextFor(targetId),now=new Date(),who=actorName(actor);let personUpdated=false,userUpdated=false,orderUpdated=false,entriesUpdated=0;
    const person=await findCurrentPerson(ctx.contact);
    if(person){const Person=mongoose.models.ErpPerson;await Person.updateOne({_id:person._id},{$set:{phone:storedPhone,'metadata.updatedBy':who,'metadata.updatedIn':'erp_financeiro_cobranca',updatedAt:now}});personUpdated=true}
    const doc=digits(ctx.contact.document),email=clean(ctx.contact.email,320).toLowerCase();
    if(User&&!person){const query=doc?{cpf:doc,isActive:{$ne:false}}:(email?{email,isActive:{$ne:false}}:null);if(query){const result=await User.updateOne(query,{$set:{phone:storedPhone,updatedAt:now}});userUpdated=Number(result?.modifiedCount||0)>0}}
    const id=clean(targetId,260);
    if(id.startsWith('order:')){
      const orderId=id.split(':')[1];if(!mongoose.isValidObjectId(orderId))throw fail('Venda do ERP inválida para atualização de contato.',404,'DELINQUENCY_TARGET_NOT_FOUND');
      const result=await Order.updateOne({_id:orderId,origin:'erp_ariana'},{$set:{customerPhone:storedPhone,updatedAt:now}});orderUpdated=Number(result?.modifiedCount||0)>0;
    }else if(id.startsWith('entry:')){
      const entryId=id.slice(6),Entry=mongoose.models.ErpFinancialEntry;if(!Entry||!mongoose.isValidObjectId(entryId))throw fail('Parcela financeira inválida para atualização de contato.',404,'DELINQUENCY_TARGET_NOT_FOUND');
      const selected=await Entry.collection.findOne({_id:new mongoose.Types.ObjectId(entryId)});if(!selected)throw fail('Parcela financeira não encontrada.',404,'DELINQUENCY_TARGET_NOT_FOUND');
      const sourceSaleId=clean(selected?.migration?.sourceSaleId,180),filter={direction:'receivable'};
      if(digits(selected.personDocument))filter.personDocument=selected.personDocument;
      else if(clean(selected.personEmail||selected.email,320))filter.$or=[{personEmail:clean(selected.personEmail||selected.email,320)},{email:clean(selected.personEmail||selected.email,320)}];
      else if(sourceSaleId)filter['migration.sourceSaleId']=sourceSaleId;
      else filter._id=selected._id;
      const result=await Entry.collection.updateMany(filter,{$set:{personPhone:storedPhone,phone:storedPhone,updatedAt:now}});entriesUpdated=Number(result?.modifiedCount||0);
    }
    const Case=mongoose.models.ErpCollectionCase;if(Case)await Case.updateMany({targetId:id},{$set:{clientPhone:storedPhone,updatedAt:now}}).catch(()=>{});
    const refreshed=await preview(targetId,payload.template||'visita');
    return{saved:true,phone:refreshed.phone,contact:refreshed.contact,preview:refreshed,updatedBy:who,updated:{person:personUpdated,user:userUpdated,order:orderUpdated,financialEntries:entriesUpdated}};
  }

  async function send(targetId,payload={},actor={}){
    const template=TEMPLATES.has(clean(payload.template,30))?clean(payload.template,30):'visita';const data=await build(targetId,template),who=actorName(actor),cfg=evolutionConfig();const baseLog={targetId:data.targetId,purchaseKey:data.purchaseKey,orderId:data.orderId,reference:data.reference,clientName:data.contact.name,clientDocument:data.contact.document,clientPhone:data.phone,template,installments:data.items.length,principalAmount:data.totals.principal,fineAmount:data.totals.fine,interestAmount:data.totals.interest,correctionAmount:data.totals.correction,totalUpdated:data.totals.updated,message:data.message,senderPhone:cfg.senderPhone,evolutionInstance:cfg.instance,sentBy:who};
    try{const sent=await sendEvolution(data.phone,data.message);const now=new Date();const log=await Log.create({...baseLog,status:'SENT',providerMessageId:sent.messageId||'',sentAt:now});return{status:'SENT',sentAt:now,messageId:sent.messageId||'',provider:sent.provider,sender:{phone:sent.senderPhone,instance:sent.instance},charge:{targetId:data.targetId,purchaseKey:data.purchaseKey,orderId:data.orderId,reference:data.reference,contact:data.contact,phone:data.phone,items:data.items,totals:data.totals,message:data.message},logId:String(log._id)}}catch(error){await Log.create({...baseLog,status:'FAILED',error:clean(error?.message||error,1000)}).catch(()=>{});throw error}
  }

  return{preview,saveContact,send};
}

export default createErpDelinquencyChargeService;
,'i');person=await Person.findOne({$or:[{name:rx},{companyName:rx}],active:{$ne:false}}).sort({updatedAt:-1}).lean()}
    return person;
  }

  async function currentCustomer(base={}){
    const person=await findCurrentPerson(base),doc=digits(base.document),email=clean(base.email,320).toLowerCase();
    let user=null;if(!person&&User){const query=doc?{cpf:doc,isActive:{$ne:false}}:(email?{email,isActive:{$ne:false}}:null);if(query)user=await User.findOne(query).select('name email phone cpf city uf').lean()}
    return{name:clean(person?.name||person?.companyName||user?.name||base.name,220),document:clean(person?.document||user?.cpf||base.document,60),email:clean(person?.email||user?.email||base.email,320),phone:clean(person?.phone||user?.phone||base.phone,80)};
  }

  function rowSummary(raw={},extra={}){const values=chargeValues(raw);return{installment:clean(extra.installment||raw.installmentNumber||raw.parcelNumber||raw.number||'',50),dueAt:raw.dueAt||null,reference:clean(extra.reference||raw.documentNumber||raw.description||raw.sourceId||'',180),...values}}

  async function financialEntryContext(entryId){
    const Entry=mongoose.models.ErpFinancialEntry;if(!Entry)throw fail('Livro financeiro do ERP não está disponível.',503,'ERP_LEDGER_UNAVAILABLE');if(!mongoose.isValidObjectId(entryId))throw fail('Parcela financeira inválida.',404,'DELINQUENCY_TARGET_NOT_FOUND');
    const selected=await Entry.collection.findOne({_id:new mongoose.Types.ObjectId(entryId)});if(!selected||selected.direction!=='receivable')throw fail('Parcela financeira não encontrada.',404,'DELINQUENCY_TARGET_NOT_FOUND');
    const today=startToday(),base={direction:'receivable',status:{$nin:['paid','cancelled']},dueAt:{$lt:today}},sourceSaleId=clean(selected?.migration?.sourceSaleId,180);let purchaseKey='';
    if(clean(selected.orderId,120)){base.orderId=clean(selected.orderId,120);purchaseKey=`order:${base.orderId}`}
    else if(sourceSaleId){base['migration.sourceSaleId']=sourceSaleId;purchaseKey=`sige:${sourceSaleId}`}
    else if(clean(selected.documentNumber,120)){base.documentNumber=clean(selected.documentNumber,120);if(clean(selected.personDocument,60))base.personDocument=clean(selected.personDocument,60);purchaseKey=`document:${base.documentNumber}`}
    else{base._id=selected._id;purchaseKey=`entry:${String(selected._id)}`}
    const rows=(await Entry.collection.find(base).sort({dueAt:1}).toArray()).filter(r=>outstanding(r)>0.009),effective=rows.length?rows:[selected],reference=sourceSaleId?`Histórico SIGE • venda ref. ${sourceSaleId}`:clean(selected.documentNumber||selected.description||String(selected._id),180);
    const items=effective.map((r,index)=>rowSummary(r,{installment:`${Number(r.installmentNumber||r.parcelNumber||index+1)}/${effective.length}`,reference}));
    const contact=await currentCustomer({name:selected.personName,document:selected.personDocument,email:selected.email||selected.personEmail,phone:selected.phone||selected.personPhone});
    return{targetId:`entry:${entryId}`,purchaseKey,orderId:clean(selected.orderId,120),reference,contact,items};
  }

  async function orderContext(orderId,number){if(!mongoose.isValidObjectId(orderId))throw fail('Venda do ERP inválida.',404,'DELINQUENCY_TARGET_NOT_FOUND');const order=await Order.findById(orderId).lean();if(!order||order.origin!=='erp_ariana')throw fail('Venda do Ariana ERP não encontrada.',404,'DELINQUENCY_TARGET_NOT_FOUND');const today=startToday(),erp=order.televendas?.erp||{},all=arr(erp.receivables),selected=all.find(r=>Number(r.number||1)===Number(number||1));if(!selected)throw fail('Parcela da venda não encontrada.',404,'DELINQUENCY_TARGET_NOT_FOUND');const rows=all.filter(r=>{const st=String(r.status||'').toLowerCase(),due=new Date(r.dueAt||0);return!['recebido','cancelado','estornado','paid'].includes(st)&&!Number.isNaN(due.getTime())&&due<today&&outstanding(r)>0.009});const items=rows.map(r=>rowSummary(r,{installment:`${Number(r.number||1)}/${Number(r.installments||1)}`,reference:clean(erp.code||String(order._id).slice(-8).toUpperCase(),180)}));const contact=await currentCustomer({name:order.customerName,document:order.customerCpf,email:order.customerEmail,phone:order.customerPhone});return{targetId:`order:${orderId}:${Number(number||1)}`,purchaseKey:`order:${orderId}`,orderId:String(order._id),reference:clean(erp.code||String(order._id).slice(-8).toUpperCase(),180),contact,items};
  }

  async function contextFor(targetId){const id=clean(targetId,260);if(id.startsWith('entry:'))return financialEntryContext(id.slice(6));if(id.startsWith('order:')){const parts=id.split(':');return orderContext(parts[1],parts[2])}throw fail('Parcela/título de cobrança inválido.',404,'DELINQUENCY_TARGET_NOT_FOUND')}

  async function build(targetId,template='visita'){
    const selected=TEMPLATES.has(clean(template,30))?clean(template,30):'visita',ctx=await contextFor(targetId);if(!ctx.items.length)throw fail('Esta compra não possui parcelas vencidas em aberto.',409,'NO_OVERDUE_INSTALLMENTS');const totals={principal:money(ctx.items.reduce((s,x)=>s+x.principal,0)),fine:money(ctx.items.reduce((s,x)=>s+x.fine,0)),interest:money(ctx.items.reduce((s,x)=>s+x.interest,0)),correction:money(ctx.items.reduce((s,x)=>s+x.correction,0)),updated:money(ctx.items.reduce((s,x)=>s+x.updated,0))};const phoneInfo=validRecipientPhone(ctx.contact.phone);if(!phoneInfo.valid)throw fail('O cliente não possui um WhatsApp válido no cadastro atual do Ariana ERP.',409,'CUSTOMER_WHATSAPP_INVALID');const message=messageFor(selected,ctx.contact.name,totals.updated,totals);return{...ctx,template:selected,phone:phoneInfo.normalized,totals,message,chargesNote:'O valor atualizado usa somente multa, juros e correção que estejam registrados nos dados financeiros da compra; nenhuma taxa é criada automaticamente.'};
  }

  async function preview(targetId,template='visita'){const data=await build(targetId,template);const cfg=evolutionConfig();return{...data,sender:{phone:cfg.senderPhone,instance:cfg.instance},templates:{visita:messageFor('visita',data.contact.name,data.totals.updated,data.totals),retorno:messageFor('retorno',data.contact.name,data.totals.updated,data.totals)}}}

  async function send(targetId,payload={},actor={}){
    const template=TEMPLATES.has(clean(payload.template,30))?clean(payload.template,30):'visita';const data=await build(targetId,template),who=actorName(actor),cfg=evolutionConfig();const baseLog={targetId:data.targetId,purchaseKey:data.purchaseKey,orderId:data.orderId,reference:data.reference,clientName:data.contact.name,clientDocument:data.contact.document,clientPhone:data.phone,template,installments:data.items.length,principalAmount:data.totals.principal,fineAmount:data.totals.fine,interestAmount:data.totals.interest,correctionAmount:data.totals.correction,totalUpdated:data.totals.updated,message:data.message,senderPhone:cfg.senderPhone,evolutionInstance:cfg.instance,sentBy:who};
    try{const sent=await sendEvolution(data.phone,data.message);const now=new Date();const log=await Log.create({...baseLog,status:'SENT',providerMessageId:sent.messageId||'',sentAt:now});return{status:'SENT',sentAt:now,messageId:sent.messageId||'',provider:sent.provider,sender:{phone:sent.senderPhone,instance:sent.instance},charge:{targetId:data.targetId,purchaseKey:data.purchaseKey,orderId:data.orderId,reference:data.reference,contact:data.contact,phone:data.phone,items:data.items,totals:data.totals,message:data.message},logId:String(log._id)}}catch(error){await Log.create({...baseLog,status:'FAILED',error:clean(error?.message||error,1000)}).catch(()=>{});throw error}
  }

  return{preview,send};
}

export default createErpDelinquencyChargeService;
