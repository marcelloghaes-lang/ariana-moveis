import mongoose from 'mongoose';

const clean=(v='',m=500)=>String(v??'').trim().slice(0,m);
const digits=(v='')=>String(v??'').replace(/\D/g,'');
const money=(v=0)=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
const actorName=a=>clean(a?.name||a?.nome||a?.email||'Operador',180);
const base={timestamps:true,versionKey:false,minimize:false};

const schema=new mongoose.Schema({
 key:{type:String,default:'default',unique:true,index:true},
 general:{
  documentOptional:{type:Boolean,default:true},
  requireCustomerPhone:{type:Boolean,default:false},
  generateDocumentsAsPdf:{type:Boolean,default:true},
  showProductImagesInSearch:{type:Boolean,default:true}
 },
 sales:{
  blockDelinquentSales:{type:Boolean,default:false},
  installmentsBasedOnCurrentDate:{type:Boolean,default:true},
  requireReviewBeforeBilling:{type:Boolean,default:true},
  showCostInformation:{type:Boolean,default:false},
  orderValidityDays:{type:Number,default:0,min:0,max:3650}
 },
 finance:{
  requireBankAccount:{type:Boolean,default:false},
  autoReconcileOnPayment:{type:Boolean,default:false},
  lockDate:{type:Date,default:null},
  defaultPaymentMethod:{type:String,default:''},
  defaultBankAccountId:{type:String,default:''},
  defaultReceivableCategoryId:{type:String,default:''},
  defaultPayableCategoryId:{type:String,default:''},
  delinquencyFinePercent:{type:Number,default:2,min:0,max:100},
  delinquencyMonthlyInterestPercent:{type:Number,default:1,min:0,max:100}
 },
 pdv:{
  defaultPaymentMethod:{type:String,default:'pix'},
  defaultBankAccountId:{type:String,default:''},
  requireOpenCashForBilling:{type:Boolean,default:true}
 },
 updatedBy:String
},base);

const Settings=mongoose.models.ErpOperationalSettings||mongoose.model('ErpOperationalSettings',schema);

function fail(message,statusCode=400,code='ERP_SETTINGS_ERROR',details=undefined){const e=new Error(message);e.statusCode=statusCode;e.code=code;if(details)e.details=details;return e}
function bool(v,fallback=false){return v===undefined?fallback:Boolean(v)}
function number(v,fallback=0){const n=Number(v);return Number.isFinite(n)?n:fallback}
function asDate(v){if(v===undefined)return undefined;if(v===null||v==='')return null;const d=new Date(v);if(Number.isNaN(d.getTime()))throw fail('Data de travamento financeiro inválida.');d.setHours(23,59,59,999);return d}
function normalizedStatus(v=''){return clean(v,30).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')}
function paymentPrincipal(row={}){const ps=Array.isArray(row.payments)?row.payments:[];if(ps.length)return money(ps.reduce((s,p)=>s+Number(p?.principalApplied??p?.principal??0),0));return money(row.principalPaid??(row.status==='paid'?row.value:0))}
function receivableOpen(row={}){return Math.max(0,money(Number(row.value||0)-paymentPrincipal(row)))}

async function row(){return Settings.findOneAndUpdate({key:'default'},{$setOnInsert:{key:'default'}},{upsert:true,new:true,setDefaultsOnInsert:true})}
function publicRow(x){const o=x?.toObject?x.toObject():x||{};return{general:o.general||{},sales:o.sales||{},finance:o.finance||{},pdv:o.pdv||{},updatedAt:o.updatedAt||null,updatedBy:o.updatedBy||''}}

export async function getErpSettingsSnapshot(){return publicRow(await row())}

export function createErpSettingsService(context={}){
 const {IntegrationAuditLog,redact,Order}=context;
 async function audit(metadata={}){if(!IntegrationAuditLog)return;try{await IntegrationAuditLog.create({scope:'erp_ariana',eventType:'erp.settings.updated',status:'ok',message:'Configurações operacionais do ERP atualizadas',metadata:redact?redact(metadata):metadata})}catch(e){console.warn('[erp-settings/audit]',e.message)}}
 async function get(){return getErpSettingsSnapshot()}
 async function update(payload={},actor={}){
  const current=await row(),set={},g=payload.general||{},s=payload.sales||{},f=payload.finance||{},p=payload.pdv||{};
  if(payload.general){set.general={...current.general?.toObject?.()||current.general||{},documentOptional:bool(g.documentOptional,current.general?.documentOptional??true),requireCustomerPhone:bool(g.requireCustomerPhone,current.general?.requireCustomerPhone??false),generateDocumentsAsPdf:bool(g.generateDocumentsAsPdf,current.general?.generateDocumentsAsPdf??true),showProductImagesInSearch:bool(g.showProductImagesInSearch,current.general?.showProductImagesInSearch??true)}}
  if(payload.sales){const days=Math.max(0,Math.min(3650,Math.floor(number(s.orderValidityDays,current.sales?.orderValidityDays||0))));set.sales={...current.sales?.toObject?.()||current.sales||{},blockDelinquentSales:bool(s.blockDelinquentSales,current.sales?.blockDelinquentSales??false),installmentsBasedOnCurrentDate:bool(s.installmentsBasedOnCurrentDate,current.sales?.installmentsBasedOnCurrentDate??true),requireReviewBeforeBilling:bool(s.requireReviewBeforeBilling,current.sales?.requireReviewBeforeBilling??true),showCostInformation:bool(s.showCostInformation,current.sales?.showCostInformation??false),orderValidityDays:days}}
  if(payload.finance){const lockDate=asDate(f.lockDate),finePercent=Math.max(0,Math.min(100,number(f.delinquencyFinePercent,current.finance?.delinquencyFinePercent??2))),monthlyInterestPercent=Math.max(0,Math.min(100,number(f.delinquencyMonthlyInterestPercent,current.finance?.delinquencyMonthlyInterestPercent??1)));set.finance={...current.finance?.toObject?.()||current.finance||{},requireBankAccount:bool(f.requireBankAccount,current.finance?.requireBankAccount??false),autoReconcileOnPayment:bool(f.autoReconcileOnPayment,current.finance?.autoReconcileOnPayment??false),defaultPaymentMethod:clean(f.defaultPaymentMethod??current.finance?.defaultPaymentMethod,80),defaultBankAccountId:clean(f.defaultBankAccountId??current.finance?.defaultBankAccountId,120),defaultReceivableCategoryId:clean(f.defaultReceivableCategoryId??current.finance?.defaultReceivableCategoryId,120),defaultPayableCategoryId:clean(f.defaultPayableCategoryId??current.finance?.defaultPayableCategoryId,120),delinquencyFinePercent:finePercent,delinquencyMonthlyInterestPercent:monthlyInterestPercent};if(lockDate!==undefined)set.finance.lockDate=lockDate}
  if(payload.pdv){set.pdv={...current.pdv?.toObject?.()||current.pdv||{},defaultPaymentMethod:clean(p.defaultPaymentMethod??current.pdv?.defaultPaymentMethod??'pix',80),defaultBankAccountId:clean(p.defaultBankAccountId??current.pdv?.defaultBankAccountId,120),requireOpenCashForBilling:bool(p.requireOpenCashForBilling,current.pdv?.requireOpenCashForBilling??true)}}
  set.updatedBy=actorName(actor);
  const x=await Settings.findOneAndUpdate({key:'default'},{$set:set,$setOnInsert:{key:'default'}},{upsert:true,new:true,setDefaultsOnInsert:true});
  await audit({by:set.updatedBy,sections:Object.keys(payload).filter(k=>['general','sales','finance','pdv'].includes(k))});
  return publicRow(x)
 }
 async function assertFinanceCreate(payload={},direction=''){
  const cfg=(await getErpSettingsSnapshot()).finance||{};
  if(!clean(payload.paymentMethod,80)&&cfg.defaultPaymentMethod)payload.paymentMethod=cfg.defaultPaymentMethod;
  if(!clean(payload.bankAccountId,120)&&cfg.defaultBankAccountId)payload.bankAccountId=cfg.defaultBankAccountId;
  if(!clean(payload.categoryId,120)){if(direction==='receivable'&&cfg.defaultReceivableCategoryId)payload.categoryId=cfg.defaultReceivableCategoryId;if(direction==='payable'&&cfg.defaultPayableCategoryId)payload.categoryId=cfg.defaultPayableCategoryId}
  if(cfg.requireBankAccount&&!clean(payload.bankAccountId,120))throw fail('A configuração do ERP exige uma conta bancária neste lançamento.',409,'BANK_ACCOUNT_REQUIRED');
  if(cfg.lockDate){const d=new Date(payload.competenceAt||payload.competenceDate||payload.dueAt||payload.dueDate||new Date());if(!Number.isNaN(d.getTime())&&d<=new Date(cfg.lockDate))throw fail('O Financeiro está travado para esta data. Altere a data ou a configuração de travamento.',409,'FINANCE_LOCKED')}
 }
 async function assertFinanceMutation(id,payload={}){
  const cfg=(await getErpSettingsSnapshot()).finance||{},Entry=mongoose.models.ErpFinancialEntry;
  if(!Entry)return;
  const entry=await Entry.findById(id).lean();if(!entry)return;
  if(payload.__operation==='pay'){
   if(!clean(payload.paymentMethod,80)&&cfg.defaultPaymentMethod)payload.paymentMethod=cfg.defaultPaymentMethod;
   if(!clean(payload.bankAccountId,120)&&cfg.defaultBankAccountId)payload.bankAccountId=cfg.defaultBankAccountId;
  }
  if(cfg.lockDate){const d=new Date(entry.competenceAt||entry.dueAt||entry.createdAt);if(!Number.isNaN(d.getTime())&&d<=new Date(cfg.lockDate))throw fail('Este lançamento está protegido pela data de travamento do Financeiro.',409,'FINANCE_LOCKED')}
  if(cfg.requireBankAccount&&!clean(payload.bankAccountId||entry.bankAccountId,120)&&payload.__operation==='pay')throw fail('A configuração do ERP exige uma conta bancária para realizar a baixa.',409,'BANK_ACCOUNT_REQUIRED')
 }
 async function applySaleDefaults(draft={}){
  const cfg=await getErpSettingsSnapshot(),out={...draft,payment:{...(draft.payment||{})}};
  if(!clean(out.payment.method,80)&&clean(cfg.pdv?.defaultPaymentMethod,80))out.payment.method=clean(cfg.pdv.defaultPaymentMethod,80);
  return out
 }
 async function delinquencyForDraft(draft={}){
  const doc=digits(draft?.customer?.document||draft?.customerDocument||draft?.customerCpf||draft?.cpf||'');
  if(!doc)return{document:'',count:0,total:0,items:[]};
  const cutoff=new Date();cutoff.setHours(0,0,0,0);const items=[];
  const OrderModel=Order||mongoose.models.Order;
  if(OrderModel){
   const orders=await OrderModel.find({origin:'erp_ariana',customerCpf:doc,'televendas.erp.receivables':{$exists:true}}).select('_id televendas.erp.code televendas.erp.receivables').lean().limit(500).catch(()=>[]);
   for(const order of orders){for(const rec of (Array.isArray(order?.televendas?.erp?.receivables)?order.televendas.erp.receivables:[])){const st=normalizedStatus(rec?.status),due=new Date(rec?.dueAt||rec?.dueDate||0);if(!['pendente','pending','parcial','partial'].includes(st)||Number.isNaN(due.getTime())||due>=cutoff)continue;const value=Math.max(0,money(Number(rec?.value||0)-Number(rec?.receivedValue||rec?.paidValue||0)));if(value>0.009)items.push({source:'sale',orderId:String(order._id||''),code:clean(order?.televendas?.erp?.code,100),dueAt:due,value})}}
  }
  const Entry=mongoose.models.ErpFinancialEntry;
  if(Entry){const rows=await Entry.find({direction:'receivable',personDocument:doc,status:'pending',dueAt:{$lt:cutoff}}).lean().limit(1000).catch(()=>[]);for(const entry of rows){const value=receivableOpen(entry);if(value>0.009)items.push({source:'ledger',entryId:String(entry._id||''),dueAt:entry.dueAt,value})}}
  return{document:doc,count:items.length,total:money(items.reduce((s,x)=>s+Number(x.value||0),0)),items}
 }
 async function assertSaleAllowed(draft={}){
  const cfg=await getErpSettingsSnapshot();if(cfg.sales?.blockDelinquentSales!==true)return{blocked:false};
  const debt=await delinquencyForDraft(draft);if(!debt.count)return{blocked:false,debt};
  throw fail(`Venda bloqueada: cliente possui ${debt.count} parcela(s) vencida(s), totalizando ${debt.total.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}.`,409,'DELINQUENT_CUSTOMER_BLOCKED',{count:debt.count,total:debt.total,document:debt.document})
 }
 async function requireOpenCashForBilling(){const cfg=await getErpSettingsSnapshot();return cfg.pdv?.requireOpenCashForBilling!==false}
 return{get,update,assertFinanceCreate,assertFinanceMutation,applySaleDefaults,delinquencyForDraft,assertSaleAllowed,requireOpenCashForBilling}
}

export default createErpSettingsService;
