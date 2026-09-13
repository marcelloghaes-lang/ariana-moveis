import mongoose from 'mongoose';

const clean=(v='',m=500)=>String(v??'').trim().slice(0,m);
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
  lockDate:{type:Date,default:null},
  defaultPaymentMethod:{type:String,default:''},
  defaultBankAccountId:{type:String,default:''},
  defaultReceivableCategoryId:{type:String,default:''},
  defaultPayableCategoryId:{type:String,default:''}
 },
 pdv:{
  defaultPaymentMethod:{type:String,default:'pix'},
  defaultBankAccountId:{type:String,default:''},
  requireOpenCashForBilling:{type:Boolean,default:true}
 },
 updatedBy:String
},base);

const Settings=mongoose.models.ErpOperationalSettings||mongoose.model('ErpOperationalSettings',schema);

function fail(message,statusCode=400,code='ERP_SETTINGS_ERROR'){const e=new Error(message);e.statusCode=statusCode;e.code=code;return e}
function bool(v,fallback=false){return v===undefined?fallback:Boolean(v)}
function number(v,fallback=0){const n=Number(v);return Number.isFinite(n)?n:fallback}
function asDate(v){if(v===undefined)return undefined;if(v===null||v==='')return null;const d=new Date(v);if(Number.isNaN(d.getTime()))throw fail('Data de travamento financeiro inválida.');d.setHours(23,59,59,999);return d}

async function row(){return Settings.findOneAndUpdate({key:'default'},{$setOnInsert:{key:'default'}},{upsert:true,new:true,setDefaultsOnInsert:true})}
function publicRow(x){const o=x?.toObject?x.toObject():x||{};return{general:o.general||{},sales:o.sales||{},finance:o.finance||{},pdv:o.pdv||{},updatedAt:o.updatedAt||null,updatedBy:o.updatedBy||''}}

export async function getErpSettingsSnapshot(){return publicRow(await row())}

export function createErpSettingsService(context={}){
 const {IntegrationAuditLog,redact}=context;
 async function audit(metadata={}){if(!IntegrationAuditLog)return;try{await IntegrationAuditLog.create({scope:'erp_ariana',eventType:'erp.settings.updated',status:'ok',message:'Configurações operacionais do ERP atualizadas',metadata:redact?redact(metadata):metadata})}catch(e){console.warn('[erp-settings/audit]',e.message)}}
 async function get(){return getErpSettingsSnapshot()}
 async function update(payload={},actor={}){
  const current=await row(),set={},g=payload.general||{},s=payload.sales||{},f=payload.finance||{},p=payload.pdv||{};
  if(payload.general){set.general={...current.general?.toObject?.()||current.general||{},documentOptional:bool(g.documentOptional,current.general?.documentOptional??true),requireCustomerPhone:bool(g.requireCustomerPhone,current.general?.requireCustomerPhone??false),generateDocumentsAsPdf:bool(g.generateDocumentsAsPdf,current.general?.generateDocumentsAsPdf??true),showProductImagesInSearch:bool(g.showProductImagesInSearch,current.general?.showProductImagesInSearch??true)}}
  if(payload.sales){const days=Math.max(0,Math.min(3650,Math.floor(number(s.orderValidityDays,current.sales?.orderValidityDays||0))));set.sales={...current.sales?.toObject?.()||current.sales||{},blockDelinquentSales:bool(s.blockDelinquentSales,current.sales?.blockDelinquentSales??false),installmentsBasedOnCurrentDate:bool(s.installmentsBasedOnCurrentDate,current.sales?.installmentsBasedOnCurrentDate??true),requireReviewBeforeBilling:bool(s.requireReviewBeforeBilling,current.sales?.requireReviewBeforeBilling??true),showCostInformation:bool(s.showCostInformation,current.sales?.showCostInformation??false),orderValidityDays:days}}
  if(payload.finance){const lockDate=asDate(f.lockDate);set.finance={...current.finance?.toObject?.()||current.finance||{},requireBankAccount:bool(f.requireBankAccount,current.finance?.requireBankAccount??false),defaultPaymentMethod:clean(f.defaultPaymentMethod??current.finance?.defaultPaymentMethod,80),defaultBankAccountId:clean(f.defaultBankAccountId??current.finance?.defaultBankAccountId,120),defaultReceivableCategoryId:clean(f.defaultReceivableCategoryId??current.finance?.defaultReceivableCategoryId,120),defaultPayableCategoryId:clean(f.defaultPayableCategoryId??current.finance?.defaultPayableCategoryId,120)};if(lockDate!==undefined)set.finance.lockDate=lockDate}
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
 return{get,update,assertFinanceCreate,assertFinanceMutation}
}

export default createErpSettingsService;
