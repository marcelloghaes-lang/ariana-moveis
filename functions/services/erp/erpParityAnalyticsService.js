import mongoose from 'mongoose';

const clean=(v='',m=500)=>String(v??'').trim().slice(0,m);
const money=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
const array=v=>Array.isArray(v)?v:[];
const regexEscape=v=>String(v||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const sum=(a,f='value')=>money(a.reduce((s,x)=>s+Number(x[f]||0),0));
const HISTORICAL_ANOMALY_MIN_VALUE=10_000_000;
function dayStart(){const d=new Date();d.setHours(0,0,0,0);return d}
function dueView(r){if(r.status==='paid')return'paid';if(r.status==='cancelled')return'cancelled';return new Date(r.dueAt)<dayStart()?'overdue':'upcoming'}
function monthKey(v){const d=new Date(v);return Number.isNaN(d.getTime())?'':`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`}
function dayKey(v){const d=new Date(v);return Number.isNaN(d.getTime())?'':`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function outstanding(r={}){if(r.status==='paid')return 0;if(Number.isFinite(Number(r.outstanding)))return Math.max(0,money(r.outstanding));const principal=Number(r.principalPaid??0);return Math.max(0,money(Number(r.value||0)-principal))}
function realized(r={}){return Math.max(0,money(r.paidValue||0))}
function isHistoricalAnomaly(r={}){return r.origin==='sige_import'&&Math.abs(Number(r.value||0))>=HISTORICAL_ANOMALY_MIN_VALUE}
function normalizeLedgerRow(r={}){const ps=array(r.payments),principal=money(ps.length?ps.reduce((s,p)=>s+Number(p.principalApplied??0),0):Number(r.principalPaid??(r.status==='paid'?r.value:0))),cash=money(ps.length?ps.reduce((s,p)=>s+Number(p.totalPaid??p.principalApplied??0),0):Number(r.paidValue||0));return{...r,id:String(r._id),source:r.origin==='sige_import'?'historico':'financeiro',principalPaid:principal,paidValue:cash,outstanding:r.status==='paid'?0:Math.max(0,money(Number(r.value||0)-principal)),partial:r.status!=='paid'&&principal>0}}
function reportPeriod(q={}){const now=new Date(),from=q.from?new Date(q.from):new Date(now.getFullYear(),0,1),to=q.to?new Date(q.to):new Date(now.getFullYear(),11,31,23,59,59,999);if(Number.isNaN(from.getTime())||Number.isNaN(to.getTime()))throw Object.assign(new Error('Período inválido.'),{statusCode:400});from.setHours(0,0,0,0);to.setHours(23,59,59,999);return{from,to}}
function normalizeText(v=''){return clean(v,300).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()}

export function createErpParityAnalyticsService(context={}){
 const {Order}=context;
 if(!Order)throw new Error('[erp-parity] Order não informado');

 async function currentReceivables(){
  const orders=await Order.find({origin:'erp_ariana',status:{$in:['pedido','venda','faturado']},'televendas.erp.receivables.0':{$exists:true}}).select('_id customerName customerCpf customerPhone customerEmail payment televendas updatedAt').lean(),out=[];
  for(const o of orders){
   for(const r of o.televendas?.erp?.receivables||[]){
    if(['cancelado','estornado'].includes(r.status))continue;
    const payments=array(r.payments),principalPaid=money(payments.length?payments.reduce((s,p)=>s+Number(p.principalApplied??p.amount??0),0):Number(r.receivedAmount??(r.status==='recebido'?r.value:0))),cashPaid=money(payments.length?payments.reduce((s,p)=>s+Number(p.totalPaid??p.principalApplied??p.amount??0),0):principalPaid),open=Math.max(0,money(Number(r.value||0)-principalPaid)),paid=r.status==='recebido'||open<=0.009;
    out.push({id:`order:${o._id}:${r.number||out.length}`,source:'ariana_sale',origin:'ariana_sale',direction:'receivable',personName:o.customerName||'Consumidor',personDocument:o.customerCpf||'',personPhone:o.customerPhone||'',personEmail:o.customerEmail||'',description:o.televendas?.erp?.code||'Venda Ariana',categoryName:r.categoryName||'Vendas',bankAccountName:r.bankAccountName||'',paymentMethod:r.receivedMethod||r.method||o.payment?.method||'',value:Number(r.value||0),principalPaid,paidValue:cashPaid,outstanding:open,status:paid?'paid':'pending',partial:!paid&&principalPaid>0,dueAt:r.dueAt,competenceAt:r.competenceAt||o.updatedAt,paidAt:r.receivedAt||payments.at(-1)?.at||null,orderId:String(o._id),installmentNumber:Number(r.number||1),installments:Number(r.installments||1),payments})
   }
  }
  return out
 }

 async function finance(q={}){
  const Entry=mongoose.models.ErpFinancialEntry;
  if(!Entry)throw Object.assign(new Error('Financeiro ainda não inicializado.'),{statusCode:503});
  const filter={};
  if(['receivable','payable'].includes(q.direction))filter.direction=q.direction;
  if(q.origin)filter.origin=clean(q.origin,80);
  if(q.categoryId)filter.categoryId=clean(q.categoryId,120);
  if(q.bankAccountId)filter.bankAccountId=clean(q.bankAccountId,120);
  if(q.paymentMethod)filter.paymentMethod=clean(q.paymentMethod,100);
  const personSourceId=clean(q.personSourceId||q.sourcePersonId,120);
  if(personSourceId)filter['migration.sourcePersonId']=personSourceId;
  if(q.from||q.to){filter.dueAt={};if(q.from)filter.dueAt.$gte=new Date(q.from);if(q.to){const d=new Date(q.to);d.setHours(23,59,59,999);filter.dueAt.$lte=d}}
  const text=clean(q.q||q.search,160);if(text){const rx=new RegExp(regexEscape(text),'i');filter.$or=[{personName:rx},{personDocument:rx},{personPhone:rx},{personEmail:rx},{description:rx},{categoryName:rx},{documentNumber:rx},{boletoNumber:rx}]}
  let base=(await Entry.collection.find(filter).sort({dueAt:1}).limit(30000).toArray()).map(normalizeLedgerRow);
  if(!q.direction||q.direction==='receivable')base.push(...await currentReceivables());
  if(['receivable','payable'].includes(q.direction))base=base.filter(r=>r.direction===q.direction);
  if(personSourceId)base=base.filter(r=>String(r?.migration?.sourcePersonId||'')===personSourceId);
  if(text){const needle=text.toLowerCase();base=base.filter(r=>[r.personName,r.personDocument,r.personPhone,r.personEmail,r.description,r.categoryName,r.documentNumber,r.boletoNumber].join(' ').toLowerCase().includes(needle))}
  if(q.paymentMethod){const method=clean(q.paymentMethod,100).toLowerCase();base=base.filter(r=>String(r.paymentMethod||'').toLowerCase()===method)}
  if(q.from||q.to){const from=q.from?new Date(q.from):null,to=q.to?new Date(q.to):null;if(to)to.setHours(23,59,59,999);base=base.filter(r=>{const d=new Date(r.dueAt);return(!from||d>=from)&&(!to||d<=to)})}

  const anomalyFilter={origin:'sige_import',$or:[{value:{$gte:HISTORICAL_ANOMALY_MIN_VALUE}},{value:{$lte:-HISTORICAL_ANOMALY_MIN_VALUE}}]};
  const qualityAnomalies=(await Entry.collection.find(anomalyFilter).toArray()).map(normalizeLedgerRow);
  const operational=base,active=operational.filter(r=>r.status!=='cancelled'),rec=active.filter(r=>r.direction==='receivable'),pay=active.filter(r=>r.direction==='payable'),recPending=rec.filter(r=>r.status==='pending'),payPending=pay.filter(r=>r.status==='pending'),recOver=recPending.filter(r=>dueView(r)==='overdue'),payOver=payPending.filter(r=>dueView(r)==='overdue'),recUpcoming=recPending.filter(r=>dueView(r)==='upcoming'),payUpcoming=payPending.filter(r=>dueView(r)==='upcoming'),recPaid=rec.filter(r=>r.status==='paid'),payPaid=pay.filter(r=>r.status==='paid');
  const bucketOpen=a=>({count:a.length,value:money(a.reduce((s,r)=>s+outstanding(r),0))});
  const bucketTotal=a=>({count:a.length,value:sum(a)});

  const dm=new Map();
  for(const r of recOver){const k=(r.personDocument||r.personName||'sem-identificacao').toLowerCase(),x=dm.get(k)||{personName:r.personName||'Sem identificação',personDocument:r.personDocument||'',personPhone:r.personPhone||'',personEmail:r.personEmail||'',count:0,total:0,oldestDue:r.dueAt};x.count++;x.total+=outstanding(r);if(new Date(r.dueAt)<new Date(x.oldestDue))x.oldestDue=r.dueAt;dm.set(k,x)}
  const now=Date.now(),delinquents=[...dm.values()].map(x=>({...x,total:money(x.total),daysOverdue:Math.max(0,Math.floor((now-new Date(x.oldestDue).getTime())/86400000))})).sort((a,b)=>b.total-a.total);

  const agingDefs=[['Até 30 dias',0,30],['31 a 60 dias',31,60],['61 a 90 dias',61,90],['Acima de 90 dias',91,Number.POSITIVE_INFINITY]];
  const agingReceivables=agingDefs.map(([label,min,max])=>{const rows=recOver.filter(r=>{const days=Math.max(0,Math.floor((now-new Date(r.dueAt).getTime())/86400000));return days>=min&&days<=max});return{label,minDays:min,maxDays:Number.isFinite(max)?max:null,count:rows.length,value:money(rows.reduce((s,r)=>s+outstanding(r),0))}});
  const futureBucket=days=>{const end=dayStart();end.setDate(end.getDate()+days);const rows=recUpcoming.filter(r=>new Date(r.dueAt)<=end);return{days,count:rows.length,value:money(rows.reduce((s,r)=>s+outstanding(r),0))}};
  const receivableForecast={next7:futureBucket(7),next15:futureBucket(15),next30:futureBucket(30)};

  const fm=new Map();
  for(const r of active){const k=monthKey(r.dueAt);if(!k)continue;const x=fm.get(k)||{month:k,receitaPrevista:0,receitaRealizada:0,despesaPrevista:0,despesaRealizada:0};if(r.direction==='receivable'){x.receitaPrevista+=Number(r.value||0);x.receitaRealizada+=realized(r)}else{x.despesaPrevista+=Number(r.value||0);x.despesaRealizada+=realized(r)}fm.set(k,x)}
  const cashFlow=[...fm.values()].sort((a,b)=>a.month.localeCompare(b.month)).map(x=>({...x,receitaPrevista:money(x.receitaPrevista),receitaRealizada:money(x.receitaRealizada),despesaPrevista:money(x.despesaPrevista),despesaRealizada:money(x.despesaRealizada),saldoPrevisto:money(x.receitaPrevista-x.despesaPrevista),saldoRealizado:money(x.receitaRealizada-x.despesaRealizada)}));

  const cm=new Map();
  for(const r of active){const k=r.categoryName||'Sem categoria',x=cm.get(k)||{category:k,direction:r.direction,expected:0,realized:0};x.expected+=Number(r.value||0);x.realized+=realized(r);cm.set(k,x)}
  const categories=[...cm.values()].map(x=>({...x,expected:money(x.expected),realized:money(x.realized)})).sort((a,b)=>b.expected-a.expected);

  const view=clean(q.view,30);let entries=q.includeAnomalies==='true'?base:operational;
  if(view==='overdue')entries=entries.filter(r=>r.status==='pending'&&dueView(r)==='overdue');else if(view==='upcoming')entries=entries.filter(r=>r.status==='pending'&&dueView(r)==='upcoming');else if(view==='paid')entries=entries.filter(r=>r.status==='paid');else if(view==='pending')entries=entries.filter(r=>r.status==='pending');else if(view==='partial')entries=entries.filter(r=>r.status==='pending'&&r.partial===true);else if(view==='cancelled')entries=entries.filter(r=>r.status==='cancelled');
  entries=entries.sort((a,b)=>new Date(a.dueAt)-new Date(b.dueAt));
  const anomalyOpen=money(qualityAnomalies.reduce((s,r)=>s+outstanding(r),0)),anomalyRealized=money(qualityAnomalies.reduce((s,r)=>s+realized(r),0));
  return{summary:{receivables:{total:bucketTotal(rec),pending:bucketOpen(recPending),upcoming:bucketOpen(recUpcoming),overdue:bucketOpen(recOver),paid:{count:recPaid.length,value:money(recPaid.reduce((s,r)=>s+realized(r),0))},realized:money(rec.reduce((s,r)=>s+realized(r),0))},payables:{total:bucketTotal(pay),pending:bucketOpen(payPending),upcoming:bucketOpen(payUpcoming),overdue:bucketOpen(payOver),paid:{count:payPaid.length,value:money(payPaid.reduce((s,r)=>s+realized(r),0))},realized:money(pay.reduce((s,r)=>s+realized(r),0))},delinquentCustomers:delinquents.length},dataQuality:{excludedHistoricalAnomalies:{count:qualityAnomalies.length,threshold:HISTORICAL_ANOMALY_MIN_VALUE,totalValue:sum(qualityAnomalies),openValue:anomalyOpen,realizedValue:anomalyRealized,preserved:true,excluded:false,includedInOperationalTotals:true}},delinquents:delinquents.slice(0,500),agingReceivables,receivableForecast,cashFlow,categories,entries:entries.slice(0,2000).map(r=>({...r,outstanding:outstanding(r),view:dueView(r)}))}
 }

 async function sales(q={}){
  const{from,to}=reportPeriod(q),Historical=mongoose.models.ErpSigeHistoricalSale;
  const hist=Historical?await Historical.find({date:{$gte:from,$lte:to}}).sort({date:-1}).limit(20000).lean():[],current=await Order.find({origin:'erp_ariana',status:{$in:['pedido','venda','faturado']},updatedAt:{$gte:from,$lte:to}}).sort({updatedAt:-1}).limit(10000).lean();let rows=[];
  for(const s of hist){if(String(s.status||'').toLowerCase()==='canceled')continue;rows.push({id:String(s._id),source:'historico',code:s.code||'',date:s.date,customerName:s.customerName||'Consumidor',sellerName:s.sellerName||'',total:Number(s.total||0),paymentMethod:s.paymentCondition||'',items:(s.items||[]).map(i=>({name:i.description||'',productId:i.productId||'',qty:Number(i.quantity||0),value:Number(i.subtotal||0)}))})}
  for(const o of current)rows.push({id:String(o._id),source:'ariana',code:o.televendas?.erp?.code||'',date:o.updatedAt,customerName:o.customerName||'Consumidor',sellerName:o.televendas?.erp?.sellerName||o.sellerName||'',total:Number(o.total||0),paymentMethod:o.payment?.method||'',items:(o.items||[]).map(i=>({name:i.name||'',productId:String(i.productId||''),qty:Number(i.qty||0),value:Number(i.totalPrice||0)}))});

  const customer=normalizeText(q.customer||q.cliente),seller=normalizeText(q.seller||q.vendedor),payment=normalizeText(q.paymentMethod||q.pagamento),product=normalizeText(q.product||q.produto),source=clean(q.source||q.origem,30).toLowerCase(),minValue=Number(q.minValue??q.valorMin??''),maxValue=Number(q.maxValue??q.valorMax??'');
  rows=rows.filter(s=>{
    if(customer&&!normalizeText(s.customerName).includes(customer))return false;
    if(seller&&!normalizeText(s.sellerName).includes(seller))return false;
    if(payment&&!normalizeText(s.paymentMethod).includes(payment))return false;
    if(source&&source!=='all'&&String(s.source)!==source)return false;
    if(Number.isFinite(minValue)&&String(q.minValue??q.valorMin??'').trim()!==''&&Number(s.total||0)<minValue)return false;
    if(Number.isFinite(maxValue)&&String(q.maxValue??q.valorMax??'').trim()!==''&&Number(s.total||0)>maxValue)return false;
    if(product&&!s.items.some(i=>normalizeText(i.name).includes(product)))return false;
    return true
  });

  const customers=new Map(),products=new Map(),sellers=new Map(),payments=new Map(),daily=new Map(),monthly=new Map(),sellerProducts=new Map();let total=0,itemCount=0;
  for(const s of rows){
    total+=s.total;
    const dk=dayKey(s.date);if(dk){const x=daily.get(dk)||{date:dk,sales:0,value:0};x.sales++;x.value+=s.total;daily.set(dk,x)}
    const mk=monthKey(s.date);if(mk){const x=monthly.get(mk)||{month:mk,sales:0,value:0};x.sales++;x.value+=s.total;monthly.set(mk,x)}
    const ck=(s.customerName||'Consumidor').trim().toLowerCase(),c=customers.get(ck)||{name:s.customerName||'Consumidor',orders:0,value:0,firstPurchase:s.date,lastPurchase:s.date};c.orders++;c.value+=s.total;if(new Date(s.date)<new Date(c.firstPurchase))c.firstPurchase=s.date;if(new Date(s.date)>new Date(c.lastPurchase))c.lastPurchase=s.date;customers.set(ck,c);
    const sk=(s.sellerName||'Sem vendedor').trim().toLowerCase(),sv=sellers.get(sk)||{name:s.sellerName||'Sem vendedor',orders:0,value:0,items:0};sv.orders++;sv.value+=s.total;sellers.set(sk,sv);
    const pk=s.paymentMethod||'Não informado';payments.set(pk,(payments.get(pk)||0)+s.total);
    for(const i of s.items){itemCount+=i.qty;sv.items+=i.qty;const key=i.productId||String(i.name||'produto').toLowerCase(),p=products.get(key)||{name:i.name||'Produto',qty:0,value:0};p.qty+=i.qty;p.value+=i.value;products.set(key,p);const spKey=`${sk}::${key}`,sp=sellerProducts.get(spKey)||{seller:s.sellerName||'Sem vendedor',product:i.name||'Produto',qty:0,value:0};sp.qty+=i.qty;sp.value+=i.value;sellerProducts.set(spKey,sp)}
  }
  const ranking=[...customers.values()].sort((a,b)=>b.value-a.value).map(x=>({...x,value:money(x.value),averageTicket:x.orders?money(x.value/x.orders):0}));let acc=0;const abc=ranking.map(x=>{acc+=x.value;const cumulative=total?acc/total:0;return{...x,share:total?money(x.value/total*100):0,curve:cumulative<=.8?'A':cumulative<=.95?'B':'C'}});
  const productRanking=[...products.values()].sort((a,b)=>b.value-a.value).map(x=>({...x,value:money(x.value)}));let productAcc=0;const productABC=productRanking.map(x=>{productAcc+=x.value;const cumulative=total?productAcc/total:0;return{...x,share:total?money(x.value/total*100):0,curve:cumulative<=.8?'A':cumulative<=.95?'B':'C'}});
  return{period:{from,to},filters:{customer:clean(q.customer||q.cliente,160),seller:clean(q.seller||q.vendedor,160),paymentMethod:clean(q.paymentMethod||q.pagamento,100),product:clean(q.product||q.produto,160),source:source||'all',minValue:Number.isFinite(minValue)?minValue:null,maxValue:Number.isFinite(maxValue)?maxValue:null},summary:{sales:rows.length,items:itemCount,total:money(total),averageTicket:rows.length?money(total/rows.length):0,historical:rows.filter(x=>x.source==='historico').length,current:rows.filter(x=>x.source==='ariana').length,customers:customers.size,sellers:sellers.size},customerRanking:ranking.slice(0,500),customerABC:abc.slice(0,1000),productRanking:productRanking.slice(0,500),productABC:productABC.slice(0,1000),sellerRanking:[...sellers.values()].sort((a,b)=>b.value-a.value).slice(0,200).map(x=>({...x,value:money(x.value),averageTicket:x.orders?money(x.value/x.orders):0})),sellerProductRanking:[...sellerProducts.values()].sort((a,b)=>b.value-a.value).slice(0,1000).map(x=>({...x,value:money(x.value)})),paymentMethods:Object.fromEntries([...payments].map(([k,v])=>[k,money(v)])),dailySales:[...daily.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(x=>({...x,value:money(x.value),averageTicket:x.sales?money(x.value/x.sales):0})),monthlySales:[...monthly.values()].sort((a,b)=>a.month.localeCompare(b.month)).map(x=>({...x,value:money(x.value),averageTicket:x.sales?money(x.value/x.sales):0})),sales:rows.slice(0,5000).map(x=>({...x,total:money(x.total)}))}
 }
 return{finance,sales};
}
export default createErpParityAnalyticsService;
