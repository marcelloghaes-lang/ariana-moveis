import crypto from 'crypto';
import mongoose from 'mongoose';
import { extractCsvFilesFromZip, parseCsvBuffer } from './erpSigeMigrationService.js';

const clean=(v='',m=2000)=>String(v??'').trim().slice(0,m);
const digits=(v='')=>String(v??'').replace(/\D/g,'');
const norm=(v='')=>clean(v,500).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const num=(v=0)=>{if(typeof v==='number')return Number.isFinite(v)?v:0;const s=String(v??'').trim();if(!s)return 0;const n=Number(s.includes(',')?s.replace(/\./g,'').replace(',','.'):s);return Number.isFinite(n)?n:0};
const money=(v=0)=>Math.round((num(v)+Number.EPSILON)*100)/100;
const yes=(v)=>['1','true','sim','yes'].includes(String(v??'').trim().toLowerCase());
const date=(v)=>{const s=clean(v,100);if(!s)return null;const d=new Date(s);return Number.isNaN(d.getTime())?null:d};
const actorName=(a={})=>clean(a.name||a.nome||a.email||'Administrador',180);
function fail(message,statusCode=400,code='ERP_SIGE_HISTORY_ERROR'){const e=new Error(message);e.statusCode=statusCode;e.code=code;return e}
function chunks(arr,size=500){const out=[];for(let i=0;i<arr.length;i+=size)out.push(arr.slice(i,i+size));return out}
function rows(files,names=[]){const out=[];for(const n of names){const b=files.get(n.toLowerCase());if(b)out.push(...parseCsvBuffer(b))}return out}
function dataFrom(file){const files=extractCsvFilesFromZip(file.buffer);return{sales:rows(files,['vendas_pedidos.csv','vendas.csv']),items:rows(files,['itens_vendas.csv','itens_venda.csv']),entries:rows(files,['contas_pagar_receber.csv','contas_receber.csv','contas_pagar.csv']),payments:rows(files,['pagamentos_baixas.csv','pagamentos.csv'])}}
function groupBy(rows,key){const m=new Map();for(const r of rows){const k=clean(r[key],120);if(!k)continue;if(!m.has(k))m.set(k,[]);m.get(k).push(r)}return m}
function duplicateCount(rows,key='Id'){const s=new Set(),d=new Set();for(const r of rows){const id=clean(r[key],120);if(!id)continue;if(s.has(id))d.add(id);else s.add(id)}return d.size}

const mapSchema=new mongoose.Schema({source:String,entityType:String,sourceId:String,targetModel:String,targetId:String,matchType:String,details:mongoose.Schema.Types.Mixed,importedAt:Date},{timestamps:true,versionKey:false,minimize:false});
const runSchema=new mongoose.Schema({source:String,packageName:String,packageSha256:String,scope:String,status:String,stats:mongoose.Schema.Types.Mixed,warnings:[String],actor:String,startedAt:Date,finishedAt:Date},{timestamps:true,versionKey:false,minimize:false});
const paymentSchema=new mongoose.Schema({sourceSystem:{type:String,default:'sige',index:true},sourceId:{type:String,required:true,index:true},entrySourceId:{type:String,index:true},targetEntryId:String,paymentDate:Date,paymentMethod:String,bankSourceId:String,bankAccountId:String,bankAccountName:String,value:Number,discounts:Number,increases:Number,paidValue:Number,metadata:mongoose.Schema.Types.Mixed},{timestamps:true,versionKey:false,minimize:false});
paymentSchema.index({sourceSystem:1,sourceId:1},{unique:true});
const MigrationMap=mongoose.models.ErpMigrationMap||mongoose.model('ErpMigrationMap',mapSchema);
const MigrationRun=mongoose.models.ErpMigrationRun||mongoose.model('ErpMigrationRun',runSchema);
const PaymentHistory=mongoose.models.ErpSigePaymentHistory||mongoose.model('ErpSigePaymentHistory',paymentSchema);

async function mapFor(type){const rows=await MigrationMap.find({source:'sige',entityType:type}).select('sourceId targetId').lean();return new Map(rows.map(r=>[String(r.sourceId),String(r.targetId)]))}
async function bulk(model,ops,size=500){let matched=0,upserted=0,modified=0;for(const part of chunks(ops,size)){if(!part.length)continue;const r=await model.bulkWrite(part,{ordered:false});matched+=Number(r.matchedCount||0);upserted+=Number(r.upsertedCount||0);modified+=Number(r.modifiedCount||0)}return{matched,upserted,modified}}
function saleStatus(r={}){if(clean(r.TrashTitle))return'cancelado';if(yes(r.Billed))return'faturado';const n=norm(r.NegociationStatus);if(n.includes('cancel'))return'cancelado';if(n.includes('orc'))return'orcamento';return'pedido'}

export function createErpSigeHistoryImportService(context={}){
  const {Order,IntegrationAuditLog,redact}=context;
  if(!Order)throw new Error('[erp-sige-history] Order não disponível');
  const Entry=mongoose.models.ErpFinancialEntry;
  if(!Entry)throw new Error('[erp-sige-history] ErpFinancialEntry não inicializado');
  const Person=mongoose.models.ErpPerson;
  if(!Person)throw new Error('[erp-sige-history] ErpPerson não inicializado');
  async function audit(eventType,metadata={}){if(!IntegrationAuditLog)return;try{await IntegrationAuditLog.create({scope:'erp_sige_migration',eventType,status:clean(metadata.status||'',80),message:clean(metadata.message||'',1000),metadata:redact?redact(metadata):metadata})}catch(e){console.warn('[erp-sige-history/audit]',e.message)}}

  async function preview(file){
    if(!file?.buffer)throw fail('Selecione o ZIP da Etapa 2.');
    const d=dataFrom(file);const [personMap,productMap,categoryMap,bankMap]=await Promise.all([mapFor('person'),mapFor('product'),mapFor('account_category'),mapFor('bank_account')]);
    const saleIds=new Set(d.sales.map(r=>clean(r.Id,120)).filter(Boolean));
    const entryIds=new Set(d.entries.map(r=>clean(r.Id,120)).filter(Boolean));
    let salesWithoutCustomerMap=0,itemWithoutProductMap=0,entryWithoutPersonMap=0,entryWithoutCategoryMap=0,entryWithoutBankMap=0,entrySaleMissing=0,paymentEntryMissing=0;
    for(const r of d.sales){const id=clean(r.CustomerId,120);if(id&&!personMap.has(id))salesWithoutCustomerMap++}
    for(const r of d.items){const id=clean(r.ProductId,120);if(id&&!productMap.has(id))itemWithoutProductMap++}
    for(const r of d.entries){const p=clean(r.PersonId,120),c=clean(r.AccountCategoryId,120),b=clean(r.BankAccountId,120),s=clean(r.SaleID,120);if(p&&!personMap.has(p))entryWithoutPersonMap++;if(c&&!categoryMap.has(c))entryWithoutCategoryMap++;if(b&&!bankMap.has(b))entryWithoutBankMap++;if(s&&!saleIds.has(s))entrySaleMissing++}
    for(const r of d.payments){const e=clean(r.EntryId,120);if(e&&!entryIds.has(e))paymentEntryMissing++}
    const duplicates={sales:duplicateCount(d.sales),items:duplicateCount(d.items),entries:duplicateCount(d.entries),payments:duplicateCount(d.payments)};
    return{counts:{sales:d.sales.length,saleItems:d.items.length,financialEntries:d.entries.length,payments:d.payments.length,receivables:d.entries.filter(r=>norm(r.Type)==='income').length,payables:d.entries.filter(r=>norm(r.Type)==='expense').length},links:{salesWithoutCustomerMap,itemWithoutProductMap,entryWithoutPersonMap,entryWithoutCategoryMap,entryWithoutBankMap,entrySaleMissing,paymentEntryMissing},availableMaps:{people:personMap.size,products:productMap.size,categories:categoryMap.size,banks:bankMap.size},duplicates,safeForImport:duplicates.sales===0&&duplicates.entries===0&&duplicates.payments===0,warnings:[itemWithoutProductMap?`${itemWithoutProductMap} item(ns) de vendas usam produto ainda não vinculado; o histórico textual será preservado.`:'',entrySaleMissing?`${entrySaleMissing} lançamento(s) financeiro(s) apontam para venda ausente no pacote; serão mantidos sem forçar pedido inexistente.`:''].filter(Boolean)}
  }

  async function importHistory(file,confirmation,actor={}){
    if(confirmation!=='IMPORTAR_HISTORICO_SIGE')throw fail('Confirmação da Etapa 2 inválida.',409,'SIGE_HISTORY_CONFIRMATION_REQUIRED');
    if(!file?.buffer)throw fail('Selecione o ZIP da Etapa 2.');
    const packageName=clean(file.originalname||'sige_historico.zip',255),packageSha256=crypto.createHash('sha256').update(file.buffer).digest('hex'),d=dataFrom(file);
    const run=await MigrationRun.create({source:'sige',packageName,packageSha256,scope:'history-sales-finance',status:'running',stats:{phase:'starting'},warnings:[],actor:actorName(actor),startedAt:new Date()});
    try{
      const [productMap,categoryMap,bankMap]=await Promise.all([mapFor('product'),mapFor('account_category'),mapFor('bank_account')]);
      const persons=await Person.find({source:'sige'}).select('sourceId linkedUserId').lean();const linkedUser=new Map(persons.filter(p=>p.linkedUserId).map(p=>[String(p.sourceId),p.linkedUserId]));
      const itemGroups=groupBy(d.items,'SaleId');
      const existingOrders=await Order.find({origin:'sige_import','sige.sourceId':{$in:d.sales.map(r=>clean(r.Id,120)).filter(Boolean)}}).select('_id sige.sourceId').lean();const saleTarget=new Map(existingOrders.map(o=>[String(o.sige?.sourceId||''),String(o._id)]));
      const saleOps=[];
      for(const s of d.sales){const sourceId=clean(s.Id,120);if(!sourceId)continue;const srcItems=itemGroups.get(sourceId)||[];const standardItems=srcItems.map(i=>({productId:productMap.get(clean(i.ProductId,120))||`sige:${clean(i.ProductId,120)}`,sellerId:'',name:clean(i.Description,300)||'Item histórico SIGE',sku:'',qty:num(i.Quantity),unitPrice:money(i.SalePrice),totalPrice:money(i.SubTotalWithDiscount||i.SubTotal),sellerBaseUnitPrice:money(i.ValueCostUni),sellerBaseTotal:money(i.ValueCostTotal),cardMarkupUnit:0,cardMarkupTotal:0,image:''}));const when=date(s.Date)||date(s.CreatedAt)||new Date();
        saleOps.push({updateOne:{filter:{origin:'sige_import','sige.sourceId':sourceId},update:{$set:{userId:linkedUser.get(clean(s.CustomerId,120))||null,customerName:clean(s.CustomerName,220),customerCpf:digits(s.CustomerCpfCnpj),status:saleStatus(s),statusLabel:'Histórico importado do SIGE',items:standardItems,subtotal:money(s.SubTotal),shippingCost:money(s.ShippingValue),total:money(s.Total),payment:{method:clean(s.PaymentCondition,120),source:'sige_history'},notes:clean(s.AdditionalInformation,3000),origin:'sige_import',salesChannel:'sige_history',operatorName:clean(s.SellerName,180),paymentStatus:'historical',sige:{sourceId,code:clean(s.Code,100),internalCode:clean(s.InternalCode,100),customerSourceId:clean(s.CustomerId,120),sellerSourceId:clean(s.SellerId||s.SellerPersonId,120),negociationStatus:clean(s.NegociationStatus,120),billed:yes(s.Billed),movesStock:yes(s.MovesStock),generateEntries:yes(s.GenerateEntries),invoiceNumber:clean(s.InvoiceNumber,80),invoiceSerie:clean(s.InvoiceSerie,40),invoiceStatus:clean(s.InvoiceStatus,120),invoiceType:clean(s.InvoiceType,80),categorySourceId:clean(s.CategoryId,120),categoryName:clean(s.CategoryName,180),saleOrigin:clean(s.SaleOrigin,120),billingDate:date(s.BillingDate),originalCreatedAt:date(s.CreatedAt),originalUpdatedAt:date(s.LastUpdate),sourceItems:srcItems.map(i=>({sourceId:clean(i.Id,120),productSourceId:clean(i.ProductId,120),description:clean(i.Description,300),quantity:num(i.Quantity),salePrice:money(i.SalePrice),subtotal:money(i.SubTotal),cost:money(i.ValueCostTotal)}))},updatedAt:date(s.LastUpdate)||new Date()},$setOnInsert:{createdAt:when}},upsert:true}})
      }
      const saleBulk=await bulk(Order,saleOps,300);
      const refreshed=await Order.find({origin:'sige_import','sige.sourceId':{$in:d.sales.map(r=>clean(r.Id,120)).filter(Boolean)}}).select('_id sige.sourceId').lean();saleTarget.clear();for(const o of refreshed)saleTarget.set(String(o.sige?.sourceId||''),String(o._id));
      const saleMapOps=[];for(const [sourceId,targetId] of saleTarget)saleMapOps.push({updateOne:{filter:{source:'sige',entityType:'sale',sourceId},update:{$set:{targetModel:'Order',targetId,matchType:'history_import',importedAt:new Date()},$setOnInsert:{source:'sige',entityType:'sale',sourceId}},upsert:true}});await bulk(MigrationMap,saleMapOps,500);
      run.stats={phase:'sales_completed',sales:{source:d.sales.length,...saleBulk,mapped:saleTarget.size},saleItems:d.items.length};await run.save();

      const payGroups=groupBy(d.payments,'EntryId');const entryOps=[];
      for(const e of d.entries){const sourceId=clean(e.Id,120);if(!sourceId)continue;const direction=norm(e.Type)==='expense'?'payable':'receivable';const payments=payGroups.get(sourceId)||[];const paidSum=money(payments.reduce((s,p)=>s+num(p.PaidValue||p.Value),0));const lastPayment=[...payments].map(p=>date(p.PaymentDate)).filter(Boolean).sort((a,b)=>b-a)[0]||null;const bankSource=clean(e.BankAccountId,120)||clean(payments.find(p=>p.BankAccountId)?.BankAccountId,120);const catSource=clean(e.AccountCategoryId,120),saleSource=clean(e.SaleID,120);const isCancelled=Boolean(clean(e.TrashTitle));const isPaid=yes(e.Paid);const status=isCancelled?'cancelled':(isPaid?'paid':'pending');
        entryOps.push({updateOne:{filter:{sourceSystem:'sige',sourceId},update:{$set:{direction,personName:clean(e.PersonName,220)||'Cadastro histórico SIGE',personDocument:digits(e.PersonCpfCnpj),description:`SIGE ${clean(e.Code,80)||sourceId}`,categoryId:categoryMap.get(catSource)||'',categoryName:clean(e.AccountCategoryName,180),bankAccountId:bankMap.get(bankSource)||'',bankAccountName:clean(e.BankAccountName,180)||clean(payments.find(p=>p.BankAccountName)?.BankAccountName,180),paymentMethod:clean(e.PaymentMethod,100)||clean(payments[0]?.PaymentMethod,100),value:money(e.Value),advance:Math.max(0,money(e.EntranceValue)),competenceAt:date(e.Date)||date(e.CreatedAt)||new Date(),dueAt:date(e.MaturityDate)||date(e.Date)||new Date(),status,paidAt:isPaid?(lastPayment||date(e.LastUpdate)||date(e.Date)):null,paidValue:isPaid?(paidSum||money(e.Value)):paidSum,notes:'Importado do histórico financeiro do SIGE. Não altera retroativamente o saldo bancário atual.',origin:'sige_import',orderId:saleTarget.get(saleSource)||'',sourceSystem:'sige',sourceId,migration:{sourcePersonId:clean(e.PersonId,120),sourceCategoryId:catSource,sourceBankAccountId:bankSource,sourceSaleId:saleSource,relationshipType:clean(e.RelationshipType,120),ticketNumber:clean(e.TicketNumber,120),originalPaid:isPaid,originalCreatedAt:date(e.CreatedAt),originalUpdatedAt:date(e.LastUpdate),payments:payments.map(p=>({sourceId:clean(p.Id,120),paymentDate:date(p.PaymentDate),paymentMethod:clean(p.PaymentMethod,100),bankSourceId:clean(p.BankAccountId,120),value:money(p.Value),discounts:money(p.Discounts),increases:money(p.Increases),paidValue:money(p.PaidValue)}))}},$setOnInsert:{createdBy:'Migração SIGE'}},upsert:true}})
      }
      const entryBulk=await bulk(Entry.collection,entryOps,400);
      const importedEntries=await Entry.collection.find({sourceSystem:'sige',sourceId:{$in:d.entries.map(r=>clean(r.Id,120)).filter(Boolean)}},{projection:{_id:1,sourceId:1}}).toArray();const entryTarget=new Map(importedEntries.map(e=>[String(e.sourceId),String(e._id)]));
      const paymentOps=d.payments.filter(p=>clean(p.Id,120)).map(p=>({updateOne:{filter:{sourceSystem:'sige',sourceId:clean(p.Id,120)},update:{$set:{entrySourceId:clean(p.EntryId,120),targetEntryId:entryTarget.get(clean(p.EntryId,120))||'',paymentDate:date(p.PaymentDate),paymentMethod:clean(p.PaymentMethod,100),bankSourceId:clean(p.BankAccountId,120),bankAccountId:bankMap.get(clean(p.BankAccountId,120))||'',bankAccountName:clean(p.BankAccountName,180),value:money(p.Value),discounts:money(p.Discounts),increases:money(p.Increases),paidValue:money(p.PaidValue),metadata:{originalCreatedAt:date(p.CreatedAt),originalUpdatedAt:date(p.LastUpdate)}}},$setOnInsert:{sourceSystem:'sige',sourceId:clean(p.Id,120)}},upsert:true}}));const paymentBulk=await bulk(PaymentHistory,paymentOps,500);
      const entryMapOps=[];for(const [sourceId,targetId] of entryTarget)entryMapOps.push({updateOne:{filter:{source:'sige',entityType:'financial_entry',sourceId},update:{$set:{targetModel:'ErpFinancialEntry',targetId,matchType:'history_import',importedAt:new Date()},$setOnInsert:{source:'sige',entityType:'financial_entry',sourceId}},upsert:true}});await bulk(MigrationMap,entryMapOps,500);
      const warnings=[];const unmappedItems=d.items.filter(i=>clean(i.ProductId,120)&&!productMap.has(clean(i.ProductId,120))).length;const missingSales=d.entries.filter(e=>clean(e.SaleID,120)&&!saleTarget.has(clean(e.SaleID,120))).length;if(unmappedItems)warnings.push(`${unmappedItems} item(ns) de venda ficaram com referência histórica do SIGE porque o produto ainda não foi vinculado.`);if(missingSales)warnings.push(`${missingSales} lançamento(s) financeiro(s) foram importados sem vínculo forçado a pedido, pois a venda de origem não existe no pacote local.`);
      const stats={phase:'completed',sales:{source:d.sales.length,...saleBulk,mapped:saleTarget.size},saleItems:d.items.length,financial:{source:d.entries.length,...entryBulk,mapped:entryTarget.size,receivables:d.entries.filter(r=>norm(r.Type)==='income').length,payables:d.entries.filter(r=>norm(r.Type)==='expense').length},payments:{source:d.payments.length,...paymentBulk},unmappedSaleItems:unmappedItems,financialWithoutSale:missingSales};run.status='completed';run.stats=stats;run.warnings=warnings;run.finishedAt=new Date();await run.save();await audit('erp.sige.history.completed',{status:'completed',message:'Histórico de vendas e financeiro do SIGE importado',runId:String(run._id),stats,warnings,by:actorName(actor)});return{runId:String(run._id),status:'completed',stats,warnings,safety:{stockMoved:false,bankBalanceReplayed:false,fiscalDocumentsImported:false}}
    }catch(error){run.status='failed';run.finishedAt=new Date();run.warnings=[clean(error.message,1000)];await run.save().catch(()=>{});await audit('erp.sige.history.failed',{status:'failed',message:clean(error.message,1000),runId:String(run._id),by:actorName(actor)});throw error}
  }

  async function status(){const run=await MigrationRun.findOne({source:'sige',scope:'history-sales-finance'}).sort({createdAt:-1}).lean();const [orders,entries,payments]=await Promise.all([Order.countDocuments({origin:'sige_import'}),Entry.collection.countDocuments({sourceSystem:'sige'}),PaymentHistory.countDocuments({sourceSystem:'sige'})]);return{latestRun:run,counts:{sales:orders,financialEntries:entries,payments}}}
  return{preview,importHistory,status};
}
export default createErpSigeHistoryImportService;
