const clean=(v='',m=1000)=>String(v??'').trim().slice(0,m);
const money=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
const array=v=>Array.isArray(v)?v:[];

function addMonthsSafe(date,months=1){
  const d=new Date(date);
  const day=d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth()+months);
  const last=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();
  d.setDate(Math.min(day,last));
  return d;
}
function normalizeName(v=''){
  return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toUpperCase();
}
function declaredInstallments(sale={}){
  const live=sale?.metadata?.sigeLive||{};
  const payments=array(live.payments);
  return Math.max(0,Number(live.numberOfInstallments||0),Number(payments[0]?.installments||0),Number(sale.numberOfInstallments||0));
}
function originalTotal(sale={}){
  const live=sale?.metadata?.sigeLive||{};
  return money(live?.totals?.total??sale.total??0);
}
function ymd(v){
  const d=new Date(v);
  return Number.isNaN(d.getTime())?'':d.toISOString().slice(0,10);
}
function uniqueEntries(rows=[]){
  const seen=new Set(),out=[];
  for(const row of rows){
    const source=clean(row?.sourceId,120);
    const key=source?('source:'+source):('entry:'+String(row?._id||''));
    if(seen.has(key))continue;
    seen.add(key);out.push(row);
  }
  return out;
}

export async function repairHistoricalInstallmentIntegrity({mongoose,logger=console}={}){
  if(!mongoose)throw new Error('mongoose não informado');
  const started=Date.now();
  const targetName='MARCIONILIO FRANCISCO DA PAIXAO';
  const targetTotal=2392;
  const targetInstallments=8;
  const targetValue=299;
  const targetDates=['2026-08-29','2026-09-28'];

  let Sale=null,Entry=null;
  for(let attempt=0;attempt<40;attempt++){
    Sale=mongoose.models?.ErpSigeHistoricalSale||null;
    Entry=mongoose.models?.ErpFinancialEntry||null;
    if(Sale&&Entry)break;
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  if(!Sale||!Entry){
    logger.warn('[erp-historical-integrity] modelos ainda indisponíveis; auditoria adiada');
    return{ok:false,reason:'models_unavailable'};
  }

  const sales=await Sale.find({sourceSystem:'sige'}).select('sourceId customerName customerDocument total date metadata paymentCondition').lean();
  const sourceIds=sales.map(s=>clean(s.sourceId,120)).filter(Boolean);
  const entries=sourceIds.length?await Entry.collection.find({
    direction:'receivable',
    'migration.sourceSaleId':{$in:sourceIds},
    status:{$ne:'cancelled'}
  }).project({
    _id:1,sourceId:1,sourceSystem:1,origin:1,migration:1,personName:1,personDocument:1,
    description:1,documentNumber:1,boletoNumber:1,categoryId:1,categoryName:1,centerCostName:1,
    bankAccountId:1,bankAccountName:1,paymentMethod:1,value:1,advance:1,competenceAt:1,dueAt:1,
    status:1,paidAt:1,paidValue:1,principalPaid:1,payments:1,reconciliationStatus:1,notes:1,
    installmentNumber:1,installments:1,createdAt:1,updatedAt:1
  }).toArray():[];

  const bySale=new Map();
  for(const row of entries){
    const sid=clean(row?.migration?.sourceSaleId,120);
    if(!sid)continue;
    if(!bySale.has(sid))bySale.set(sid,[]);
    bySale.get(sid).push(row);
  }

  const anomalies=[];
  for(const sale of sales){
    const sid=clean(sale.sourceId,120),n=declaredInstallments(sale),total=originalTotal(sale);
    if(!sid||n<=1||total<=0)continue;
    const rows=uniqueEntries(bySale.get(sid)||[]).sort((a,b)=>new Date(a.dueAt||0)-new Date(b.dueAt||0));
    if(!rows.length||rows.length>=n)continue;
    const sum=money(rows.reduce((s,r)=>s+Number(r.value||0),0));
    anomalies.push({
      sourceSaleId:sid,
      customerName:clean(sale.customerName,220),
      total,
      declaredInstallments:n,
      existingInstallments:rows.length,
      existingValue:sum,
      missingInstallments:n-rows.length
    });
  }

  const targetSales=sales.filter(s=>{
    const sid=clean(s.sourceId,120),rows=uniqueEntries(bySale.get(sid)||[]).sort((a,b)=>new Date(a.dueAt||0)-new Date(b.dueAt||0));
    return normalizeName(s.customerName)===targetName &&
      Math.abs(originalTotal(s)-targetTotal)<0.01 &&
      declaredInstallments(s)===targetInstallments &&
      rows.length===2 &&
      rows.every(r=>Math.abs(Number(r.value||0)-targetValue)<0.01) &&
      targetDates.every((d,i)=>ymd(rows[i]?.dueAt)===d);
  });

  let repaired=0,created=0,matched=targetSales.length;
  for(const sale of targetSales){
    const sid=clean(sale.sourceId,120);
    const rows=uniqueEntries(bySale.get(sid)||[]).sort((a,b)=>new Date(a.dueAt||0)-new Date(b.dueAt||0));
    if(rows.length!==2)continue;

    const now=new Date();
    for(let i=0;i<rows.length;i++){
      await Entry.collection.updateOne(
        {_id:rows[i]._id},
        {$set:{installmentNumber:i+1,installments:targetInstallments,updatedAt:now}}
      );
    }

    const template=rows[rows.length-1];
    const ops=[];
    for(let number=3;number<=targetInstallments;number++){
      const repairSourceId=`ariana-repair:${sid}:installment:${number}`;
      const dueAt=addMonthsSafe(new Date(rows[1].dueAt),number-2);
      const doc={
        direction:'receivable',
        personName:clean(template.personName||sale.customerName,220)||'Cadastro histórico',
        personDocument:clean(template.personDocument||sale.customerDocument,60),
        description:clean(template.description||'Compra histórica',500),
        documentNumber:clean(template.documentNumber,180),
        boletoNumber:clean(template.boletoNumber,180),
        categoryId:clean(template.categoryId,120),
        categoryName:clean(template.categoryName,180),
        centerCostName:clean(template.centerCostName,180),
        bankAccountId:'',
        bankAccountName:'',
        paymentMethod:clean(template.paymentMethod||sale.paymentCondition,100),
        value:targetValue,
        advance:0,
        competenceAt:template.competenceAt||sale.date||dueAt,
        dueAt,
        status:'pending',
        paidAt:null,
        paidValue:0,
        principalPaid:0,
        payments:[],
        reconciliationStatus:'unreconciled',
        reconciledAt:null,
        notes:'Parcela restaurada pelo Ariana ERP após conferência do parcelamento original 8x de R$ 299,00.',
        origin:'sige_import',
        orderId:'',
        sourceSystem:'ariana_erp_repair',
        sourceId:repairSourceId,
        migration:{...(template.migration||{}),sourceSaleId:sid,repairType:'missing_historical_installment',repairAt:now},
        installmentNumber:number,
        installments:targetInstallments,
        createdBy:'Correção de integridade Ariana ERP',
        updatedBy:'Correção de integridade Ariana ERP',
        createdAt:now,
        updatedAt:now
      };
      ops.push({
        updateOne:{
          filter:{sourceSystem:'ariana_erp_repair',sourceId:repairSourceId},
          update:{$setOnInsert:doc},
          upsert:true
        }
      });
    }
    if(ops.length){
      const result=await Entry.collection.bulkWrite(ops,{ordered:true});
      created+=Number(result.upsertedCount||0);
    }

    await Sale.updateOne(
      {_id:sale._id},
      {$set:{
        'metadata.arianaFinancialIntegrity.lastRepairAt':now,
        'metadata.arianaFinancialIntegrity.expectedInstallments':targetInstallments,
        'metadata.arianaFinancialIntegrity.expectedTotal':targetTotal,
        'metadata.arianaFinancialIntegrity.repairReason':'missing_historical_installments'
      }}
    );
    repaired++;
  }

  const report={
    ok:true,
    scannedSales:sales.length,
    anomalies:anomalies.length,
    anomalySample:anomalies.slice(0,25),
    targetMatched:matched,
    targetRepaired:repaired,
    installmentsCreated:created,
    elapsedMs:Date.now()-started
  };
  logger.log('[erp-historical-integrity]',JSON.stringify(report));
  return report;
}

export default repairHistoricalInstallmentIntegrity;
