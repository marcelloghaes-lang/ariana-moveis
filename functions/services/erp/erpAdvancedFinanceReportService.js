import mongoose from 'mongoose';
import { buildReceivables } from './erpService.js';

const clean=(v='',m=500)=>String(v??'').trim().slice(0,m);
const money=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
const arr=v=>Array.isArray(v)?v:[];
const anomalyLimit=10_000_000;
const sum=(rows,fn)=>money(rows.reduce((s,r)=>s+Number(fn(r)||0),0));

function period(q={}){
  const now=new Date();
  const from=q.from?new Date(q.from):new Date(now.getFullYear(),0,1);
  const to=q.to?new Date(q.to):new Date(now.getFullYear(),11,31,23,59,59,999);
  if(Number.isNaN(from.getTime())||Number.isNaN(to.getTime()))throw Object.assign(new Error('Período inválido.'),{statusCode:400});
  from.setHours(0,0,0,0);to.setHours(23,59,59,999);
  return{from,to};
}
function monthKey(v){const d=new Date(v);return Number.isNaN(d.getTime())?'':`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`}
function paymentDate(p,r){return p?.at||p?.paidAt||r?.paidAt||r?.receivedAt||null}
function principalPaid(r={}){const ps=arr(r.payments);if(ps.length)return money(ps.reduce((s,p)=>s+Number(p.principalApplied??p.amount??0),0));return money(r.principalPaid??(r.status==='paid'?r.value:0))}
function cashPaid(r={}){const ps=arr(r.payments);if(ps.length)return money(ps.reduce((s,p)=>s+Number(p.totalPaid??p.principalApplied??p.amount??0),0));return money(r.paidValue??(r.status==='paid'?r.value:0))}
function openValue(r={}){if(r.status==='paid')return 0;return Math.max(0,money(Number(r.value||0)-principalPaid(r)))}
function safeRow(r={}){return{...r,id:String(r._id||r.id||''),value:money(r.value),principalPaid:principalPaid(r),paidValue:cashPaid(r),outstanding:openValue(r)}}

export function createErpAdvancedFinanceReportService(context={}){
  const {Order}=context;
  if(!Order)throw new Error('[erp-advanced-finance] Order não informado');

  async function currentSaleReceivables(){
    const orders=await Order.find({origin:'erp_ariana',status:{$in:['pedido','venda','faturado']}}).select('_id customerName customerCpf payment total televendas updatedAt').lean();
    const out=[];
    for(const o of orders){
      const stored=arr(o.televendas?.erp?.receivables),receivables=stored.length?stored:buildReceivables(o.total,o.payment||{});
      for(const r of receivables){
        if(['cancelado','estornado'].includes(String(r.status||'').toLowerCase()))continue;
        const payments=arr(r.payments),paid=String(r.status||'').toLowerCase()==='recebido'||Number(r.receivedAmount||0)>=Number(r.value||0)-0.009;
        out.push(safeRow({id:`order:${o._id}:${r.number||out.length}`,origin:'ariana_sale',direction:'receivable',personName:o.customerName||'Consumidor',personDocument:o.customerCpf||'',description:o.televendas?.erp?.code||'Venda Ariana',categoryName:r.categoryName||'Vendas',centerCostName:r.centerCostName||'Vendas',bankAccountName:r.bankAccountName||'',paymentMethod:r.receivedMethod||r.method||o.payment?.method||'',value:Number(r.value||0),status:paid?'paid':'pending',dueAt:r.dueAt,competenceAt:r.competenceAt||o.updatedAt,paidAt:r.receivedAt||payments.at(-1)?.at||null,payments,orderId:String(o._id),installmentNumber:Number(r.number||1),installments:Number(r.installments||1)}));
      }
    }
    return out;
  }

  async function rows(){
    const Entry=mongoose.models.ErpFinancialEntry;
    const manual=Entry?await Entry.collection.find({status:{$ne:'cancelled'}}).sort({dueAt:1}).limit(50000).toArray():[];
    const normalized=manual.map(safeRow);
    return[...normalized,...await currentSaleReceivables()];
  }

  async function dashboardSnapshot(q={}){
    const Entry=mongoose.models.ErpFinancialEntry;
    const now=new Date(),year=Number(q.year||now.getFullYear());
    if(!Number.isInteger(year)||year<2000||year>2100)throw Object.assign(new Error('Ano inválido.'),{statusCode:400});
    const yearStart=new Date(year,0,1,0,0,0,0),yearEnd=new Date(year,11,31,23,59,59,999),today=new Date();today.setHours(0,0,0,0);
    const currentMonthStart=new Date(now.getFullYear(),now.getMonth(),1),currentMonthEnd=new Date(now.getFullYear(),now.getMonth()+1,0,23,59,59,999);
    const monthMap=new Map();
    const monthRow=k=>{let x=monthMap.get(k);if(!x){x={month:k,revenue:0,expense:0,expectedRevenue:0,expectedExpense:0};monthMap.set(k,x)}return x};
    const validValue={value:{$gte:-anomalyLimit,$lte:anomalyLimit}};
    const activeStatus={status:{$nin:['cancelled','cancelado','estornado']}};

    if(Entry){
      const [expected,paidWithPayments,paidWithoutPayments,overdueAgg,activities]=await Promise.all([
        Entry.collection.aggregate([
          {$match:{...activeStatus,...validValue,dueAt:{$gte:yearStart,$lte:yearEnd}}},
          {$group:{_id:{month:{$dateToString:{format:'%Y-%m',date:'$dueAt',timezone:'America/Sao_Paulo'}},direction:'$direction'},value:{$sum:'$value'}}}
        ],{allowDiskUse:true}).toArray(),
        Entry.collection.aggregate([
          {$match:{...activeStatus,...validValue,'payments.0':{$exists:true}}},
          {$unwind:'$payments'},
          {$set:{_at:{$ifNull:['$payments.at','$payments.paidAt','$paidAt','$receivedAt']},_amount:{$ifNull:['$payments.totalPaid','$payments.principalApplied','$payments.amount',0]}}},
          {$match:{_at:{$gte:yearStart,$lte:yearEnd}}},
          {$group:{_id:{month:{$dateToString:{format:'%Y-%m',date:'$_at',timezone:'America/Sao_Paulo'}},direction:'$direction'},value:{$sum:'$_amount'}}}
        ],{allowDiskUse:true}).toArray(),
        Entry.collection.aggregate([
          {$match:{...activeStatus,...validValue,status:'paid',$or:[{payments:{$exists:false}},{payments:{$size:0}}]}},
          {$set:{_at:{$ifNull:['$paidAt','$receivedAt']},_amount:{$ifNull:['$paidValue','$value',0]}}},
          {$match:{_at:{$gte:yearStart,$lte:yearEnd}}},
          {$group:{_id:{month:{$dateToString:{format:'%Y-%m',date:'$_at',timezone:'America/Sao_Paulo'}},direction:'$direction'},value:{$sum:'$_amount'}}}
        ],{allowDiskUse:true}).toArray(),
        Entry.collection.aggregate([
          {$match:{direction:'receivable',status:{$nin:['paid','cancelled','cancelado','estornado']},...validValue,dueAt:{$lt:today}}},
          {$set:{_paid:{$cond:[{$gt:[{$size:{$ifNull:['$payments',[]]}},0]},{$sum:{$map:{input:{$ifNull:['$payments',[]]},as:'p',in:{$ifNull:['$$p.principalApplied','$$p.amount',0]}}}},{$ifNull:['$principalPaid',0]}]}}},
          {$project:{open:{$cond:[{$gt:[{$subtract:['$value','$_paid']},0]},{$subtract:['$value','$_paid']},0]}}},
          {$group:{_id:null,value:{$sum:'$open'},count:{$sum:1}}}
        ],{allowDiskUse:true}).toArray(),
        Entry.collection.find({direction:'receivable',...activeStatus,...validValue,dueAt:{$gte:currentMonthStart,$lte:currentMonthEnd}},{projection:{personName:1,personDocument:1,description:1,paymentMethod:1,value:1,principalPaid:1,status:1,dueAt:1}}).sort({dueAt:1}).limit(24).toArray()
      ]);
      for(const r of expected){const x=monthRow(r._id?.month||'');if(r._id?.direction==='receivable')x.expectedRevenue+=Number(r.value||0);else if(r._id?.direction==='payable')x.expectedExpense+=Number(r.value||0)}
      for(const r of [...paidWithPayments,...paidWithoutPayments]){const x=monthRow(r._id?.month||'');if(r._id?.direction==='receivable')x.revenue+=Number(r.value||0);else if(r._id?.direction==='payable')x.expense+=Number(r.value||0)}
      var overdueValue=Number(overdueAgg[0]?.value||0),overdueCount=Number(overdueAgg[0]?.count||0);
      var activityRows=activities.map(r=>safeRow(r));
    }else{
      var overdueValue=0,overdueCount=0,activityRows=[];
    }

    const saleRows=await currentSaleReceivables();
    for(const r of saleRows){
      const dueDate=new Date(r.dueAt||0),dueKey=monthKey(dueDate);
      if(dueDate>=yearStart&&dueDate<=yearEnd&&dueKey){const x=monthRow(dueKey);x.expectedRevenue+=Number(r.value||0)}
      const ps=arr(r.payments);
      if(ps.length){for(const p of ps){const at=new Date(paymentDate(p,r)||0);if(at>=yearStart&&at<=yearEnd){const x=monthRow(monthKey(at));x.revenue+=Number(p.totalPaid??p.principalApplied??p.amount??0)}}}
      else if(r.status==='paid'){const at=new Date(r.paidAt||0);if(at>=yearStart&&at<=yearEnd){const x=monthRow(monthKey(at));x.revenue+=Number(r.paidValue||r.value||0)}}
      if(r.status!=='paid'&&dueDate<today&&openValue(r)>0){overdueValue+=openValue(r);overdueCount++}
      if(dueDate>=currentMonthStart&&dueDate<=currentMonthEnd)activityRows.push(r);
    }

    const monthly=[];
    for(let i=0;i<12;i++){
      const k=`${year}-${String(i+1).padStart(2,'0')}`,x=monthRow(k);
      monthly.push({month:k,revenue:money(x.revenue),expense:money(x.expense),result:money(x.revenue-x.expense),expectedRevenue:money(x.expectedRevenue),expectedExpense:money(x.expectedExpense),expectedResult:money(x.expectedRevenue-x.expectedExpense)});
    }
    const expectedRevenue=sum(monthly,x=>x.expectedRevenue),expectedExpense=sum(monthly,x=>x.expectedExpense),revenue=sum(monthly,x=>x.revenue),expense=sum(monthly,x=>x.expense);
    activityRows=activityRows.filter(r=>r.direction==='receivable'||!r.direction).sort((a,b)=>new Date(a.dueAt)-new Date(b.dueAt)).slice(0,12).map(r=>({direction:'receivable',personName:r.personName||'Cliente',personDocument:r.personDocument||'',description:r.description||'Recebimento',paymentMethod:r.paymentMethod||'',value:money(r.value),outstanding:openValue(r),dueAt:r.dueAt,installmentNumber:r.installmentNumber||null,installments:r.installments||null}));
    return{year,summary:{revenue,expense,result:money(revenue-expense),expectedRevenue,expectedExpense,expectedResult:money(expectedRevenue-expectedExpense),overdueReceivables:money(overdueValue),overdueCount},monthly,activities:activityRows};
  }

  async function report(q={}){
    const {from,to}=period(q),all=await rows(),now=new Date();now.setHours(0,0,0,0);
    const inPeriod=v=>{const d=new Date(v||0);return!Number.isNaN(d.getTime())&&d>=from&&d<=to};
    // Descarta importações claramente corrompidas (ex.: R$ 999 milhões) para não contaminar previsão, DRE e fluxo.
    const valid=all.filter(r=>Math.abs(Number(r.value||0))<=anomalyLimit);
    const ignoredAnomalies=all.length-valid.length;
    const competence=valid.filter(r=>inPeriod(r.competenceAt||r.dueAt));
    const due=valid.filter(r=>inPeriod(r.dueAt));

    const movements=[];
    for(const r of valid){
      const ps=arr(r.payments);
      if(ps.length){
        for(const p of ps){const at=paymentDate(p,r);if(!inPeriod(at))continue;movements.push({date:at,direction:r.direction,personName:r.personName||'',description:r.description||'',categoryName:r.categoryName||'Sem categoria',centerCostName:r.centerCostName||'Sem centro de custo',bankAccountName:p.bankAccountName||r.bankAccountName||'Sem conta',paymentMethod:p.method||r.paymentMethod||'',principal:money(p.principalApplied??p.amount??0),fine:money(p.fine||0),interest:money(p.interest||0),discount:money(p.discount||0),value:money(p.totalPaid??p.principalApplied??p.amount??0),origin:r.origin||''});}
      }else if(r.status==='paid'&&inPeriod(r.paidAt)){
        movements.push({date:r.paidAt,direction:r.direction,personName:r.personName||'',description:r.description||'',categoryName:r.categoryName||'Sem categoria',centerCostName:r.centerCostName||'Sem centro de custo',bankAccountName:r.bankAccountName||'Sem conta',paymentMethod:r.paymentMethod||'',principal:money(r.value),fine:0,interest:0,discount:0,value:money(r.paidValue||r.value),origin:r.origin||''});
      }
    }
    movements.sort((a,b)=>new Date(b.date)-new Date(a.date));

    const revenueMov=movements.filter(x=>x.direction==='receivable'),expenseMov=movements.filter(x=>x.direction==='payable');
    const revenue=sum(revenueMov,x=>x.value),expense=sum(expenseMov,x=>x.value),result=money(revenue-expense);
    const expectedRevenue=sum(competence.filter(x=>x.direction==='receivable'),x=>x.value),expectedExpense=sum(competence.filter(x=>x.direction==='payable'),x=>x.value);
    // Fluxo previsto deve seguir a data de vencimento. A competência continua separada para DRE.
    const dueRevenue=sum(due.filter(x=>x.direction==='receivable'),x=>x.value),dueExpense=sum(due.filter(x=>x.direction==='payable'),x=>x.value);

    const categoriesMap=new Map();
    for(const m of movements){const k=`${m.direction}|${m.categoryName}`,x=categoriesMap.get(k)||{direction:m.direction,category:m.categoryName,value:0};x.value+=Number(m.value||0);categoriesMap.set(k,x)}
    const dre={revenue:money(revenue),expense:money(expense),result,margin:revenue?money(result/revenue*100):0,expectedRevenue:money(expectedRevenue),expectedExpense:money(expectedExpense),categories:[...categoriesMap.values()].map(x=>({...x,value:money(x.value)})).sort((a,b)=>b.value-a.value)};

    const centerMap=new Map();
    for(const r of competence){const k=r.centerCostName||'Sem centro de custo',x=centerMap.get(k)||{center:k,receivableExpected:0,payableExpected:0,receivableRealized:0,payableRealized:0};if(r.direction==='receivable')x.receivableExpected+=Number(r.value||0);else x.payableExpected+=Number(r.value||0);centerMap.set(k,x)}
    for(const m of movements){const k=m.centerCostName||'Sem centro de custo',x=centerMap.get(k)||{center:k,receivableExpected:0,payableExpected:0,receivableRealized:0,payableRealized:0};if(m.direction==='receivable')x.receivableRealized+=Number(m.value||0);else x.payableRealized+=Number(m.value||0);centerMap.set(k,x)}
    const centers=[...centerMap.values()].map(x=>({...x,receivableExpected:money(x.receivableExpected),payableExpected:money(x.payableExpected),receivableRealized:money(x.receivableRealized),payableRealized:money(x.payableRealized),resultExpected:money(x.receivableExpected-x.payableExpected),resultRealized:money(x.receivableRealized-x.payableRealized)})).sort((a,b)=>b.payableRealized-a.payableRealized);

    const overdue=valid.filter(r=>r.direction==='receivable'&&r.status!=='paid'&&new Date(r.dueAt)<now&&openValue(r)>0);
    const overdueBuckets=[['Até 30 dias',0,30],['31 a 60 dias',31,60],['61 a 90 dias',61,90],['Acima de 90 dias',91,999999]].map(([label,min,max])=>{const rs=overdue.filter(r=>{const d=Math.floor((now-new Date(r.dueAt))/86400000);return d>=min&&d<=max});return{label,count:rs.length,value:sum(rs,x=>openValue(x))}});
    const debtorsMap=new Map();
    for(const r of overdue){const k=(r.personDocument||r.personName||'sem-identificacao').toLowerCase(),x=debtorsMap.get(k)||{personName:r.personName||'Sem identificação',document:r.personDocument||'',count:0,value:0,oldestDue:r.dueAt};x.count++;x.value+=openValue(r);if(new Date(r.dueAt)<new Date(x.oldestDue))x.oldestDue=r.dueAt;debtorsMap.set(k,x)}
    const debtors=[...debtorsMap.values()].map(x=>({...x,value:money(x.value),daysOverdue:Math.max(0,Math.floor((now-new Date(x.oldestDue))/86400000))})).sort((a,b)=>b.value-a.value).slice(0,100);

    const forecast=[];for(let i=0;i<13;i++){const s=new Date(now);s.setDate(s.getDate()+i*7);const e=new Date(s);e.setDate(e.getDate()+6);e.setHours(23,59,59,999);const rs=valid.filter(r=>r.status!=='paid'&&openValue(r)>0&&new Date(r.dueAt)>=s&&new Date(r.dueAt)<=e);forecast.push({from:s,to:e,receivable:sum(rs.filter(x=>x.direction==='receivable'),x=>openValue(x)),payable:sum(rs.filter(x=>x.direction==='payable'),x=>openValue(x))});}forecast.forEach(x=>x.net=money(x.receivable-x.payable));

    // Série mensal: realizado pela data do pagamento; previsto pela data REAL de vencimento.
    const monthlyMap=new Map();
    const monthRow=k=>{let x=monthlyMap.get(k);if(!x){x={month:k,revenue:0,expense:0,expectedRevenue:0,expectedExpense:0,openReceivable:0,openPayable:0};monthlyMap.set(k,x)}return x};
    for(const m of movements){const k=monthKey(m.date);if(!k)continue;const x=monthRow(k);if(m.direction==='receivable')x.revenue+=Number(m.value||0);else x.expense+=Number(m.value||0)}
    for(const r of due){const k=monthKey(r.dueAt);if(!k)continue;const x=monthRow(k),value=Number(r.value||0),open=openValue(r);if(r.direction==='receivable'){x.expectedRevenue+=value;x.openReceivable+=open}else{x.expectedExpense+=value;x.openPayable+=open}}
    const monthly=[...monthlyMap.values()].sort((a,b)=>a.month.localeCompare(b.month)).map(x=>({...x,revenue:money(x.revenue),expense:money(x.expense),result:money(x.revenue-x.expense),expectedRevenue:money(x.expectedRevenue),expectedExpense:money(x.expectedExpense),expectedResult:money(x.expectedRevenue-x.expectedExpense),openReceivable:money(x.openReceivable),openPayable:money(x.openPayable)}));

    const bankMap=new Map();
    for(const m of movements){const k=m.bankAccountName||'Sem conta',x=bankMap.get(k)||{account:k,inflow:0,outflow:0,count:0};x.count++;if(m.direction==='receivable')x.inflow+=Number(m.value||0);else x.outflow+=Number(m.value||0);bankMap.set(k,x)}
    const banks=[...bankMap.values()].map(x=>({...x,inflow:money(x.inflow),outflow:money(x.outflow),net:money(x.inflow-x.outflow)})).sort((a,b)=>Math.abs(b.net)-Math.abs(a.net));

    return{period:{from,to},summary:{revenue,expense,result,expectedRevenue,expectedExpense,expectedResult:money(expectedRevenue-expectedExpense),dueRevenue,dueExpense,dueResult:money(dueRevenue-dueExpense),overdueReceivables:sum(overdue,x=>openValue(x)),overdueCount:overdue.length,ignoredAnomalies},dre,centers,overdueBuckets,debtors,forecast,monthly,banks,bankStatement:movements.slice(0,5000)};
  }

  return{report,dashboardSnapshot};
}
export default createErpAdvancedFinanceReportService;
