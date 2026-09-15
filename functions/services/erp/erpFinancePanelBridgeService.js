import { createErpFinanceService } from './erpFinanceService.js';
import { createErpPeopleService } from './erpPeopleService.js';

const clean=(v='',m=500)=>String(v??'').trim().slice(0,m);
const money=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
const cents=v=>Math.round(Number(v||0)*100);
const digits=v=>String(v||'').replace(/\D/g,'');
const openStatus=status=>['pendente','parcial'].includes(String(status||'').toLowerCase());

function startOfDay(value=new Date()){
  const d=value instanceof Date?new Date(value):new Date(value);
  if(Number.isNaN(d.getTime()))return null;
  d.setHours(0,0,0,0);
  return d;
}
function addDays(date,days){const d=new Date(date);d.setDate(d.getDate()+Number(days||0));return d}
function sameDay(a,b){const x=startOfDay(a),y=startOfDay(b);return Boolean(x&&y&&x.getTime()===y.getTime())}
function inRange(value,from,to){const d=startOfDay(value);return Boolean(d&&d>=from&&d<=to)}
function overdue(row,reference=new Date()){
  const due=startOfDay(row?.dueAt),today=startOfDay(reference);
  return Boolean(openStatus(row?.status)&&due&&today&&due<today);
}
function daysLate(row,reference=new Date()){
  if(!overdue(row,reference))return 0;
  const due=startOfDay(row.dueAt),today=startOfDay(reference);
  return Math.max(0,Math.floor((today-due)/86400000));
}
function customerKey(row={}){
  const document=digits(row.customerCpf);
  return document?`doc:${document}`:`name:${clean(row.customerName,180).toLowerCase()}`;
}
function panelCustomer(person={}){
  const address=person.address||{};
  return{
    id:String(person.id||''),
    nome:person.name||person.companyName||'',
    cpf:person.document||'',
    telefone:person.phone||'',
    email:person.email||'',
    contrato:'',
    endereco:person.addressText||'',
    cidade:address.city||'',
    uf:address.stateCode||address.state||'',
    fonte:'ariana_erp',
    source:person.source||'',
    sourceId:person.sourceId||'',
    ativo:person.active!==false
  };
}
function panelReceivable(row={},reference=new Date()){
  const isOverdue=overdue(row,reference),isPaid=String(row.status||'')==='recebido';
  const documentLabel=`${row.code||'VENDA'} • ${Number(row.number||1)}/${Number(row.installments||1)}`;
  return{
    fonte:'ariana_erp',
    source:'ariana_erp',
    orderId:String(row.orderId||''),
    receivableNumber:Number(row.number||1),
    codigoVenda:row.code||'',
    codigo:'',
    documento:documentLabel,
    cliente:row.customerName||'Consumidor',
    nome:row.customerName||'Consumidor',
    cpf:row.customerCpf||'',
    telefone:row.customerPhone||'',
    email:row.customerEmail||'',
    descricao:`Venda ${row.code||''} • Parcela ${Number(row.number||1)}/${Number(row.installments||1)}`.trim(),
    parcela:`${Number(row.number||1)}/${Number(row.installments||1)}`,
    dataVencimento:row.dueAt||null,
    dataRecebimento:row.receivedAt||null,
    valor:money(row.value),
    saldo:money(row.remaining),
    totalRecebido:money(row.receivedAmount),
    quitado:isPaid,
    atrasado:isOverdue,
    diasAtraso:daysLate(row,reference),
    status:row.status||'pendente',
    formaPagamento:row.method||'',
    erp:{orderId:String(row.orderId||''),number:Number(row.number||1)}
  };
}
function normalizeStatus(status=''){
  const value=clean(status,40).toLowerCase();
  if(['quitado','recebido','pago'].includes(value))return'recebido';
  if(['aberto','pendente','em_aberto'].includes(value))return'pendente';
  return value;
}
function parseReferenceDate(value){
  if(!value)return startOfDay(new Date());
  const iso=String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(iso)return startOfDay(new Date(Number(iso[1]),Number(iso[2])-1,Number(iso[3]),12));
  return startOfDay(value)||startOfDay(new Date());
}

export function createErpFinancePanelBridgeService(context={}){
  const finance=createErpFinanceService(context);
  const people=createErpPeopleService(context);

  async function clientes(query={}){
    const limit=Math.min(200,Math.max(1,Number(query.limit||100)));
    const data=await people.list({q:query.q||query.search||query.nome||'',limit});
    const rows=(data.people||[]).map(panelCustomer);
    return{clientes:rows,total:rows.length,source:'ariana_erp',historicalDataPreserved:true};
  }

  async function lancamentos(query={}){
    const requested=clean(query.status||'todos',40).toLowerCase();
    const financeQuery={q:query.q||query.search||''};
    if(requested==='atrasado')financeQuery.overdue='true';
    else if(requested&&!['todos','all'].includes(requested))financeQuery.status=normalizeStatus(requested);
    if(query.from)financeQuery.from=query.from;
    if(query.to)financeQuery.to=query.to;
    const data=await finance.list(financeQuery);
    const reference=parseReferenceDate(query.dataReferencia);
    let rows=(data.receivables||[]).map(row=>panelReceivable(row,reference));
    const limit=Math.min(5000,Math.max(1,Number(query.limit||1000)));
    rows=rows.slice(0,limit);
    return{lancamentos:rows,total:rows.length,summary:data.summary||{},source:'ariana_erp',historicalDataPreserved:true};
  }

  async function inadimplentes(query={}){
    const data=await finance.list({q:query.q||query.search||'',overdue:'true'});
    const reference=parseReferenceDate(query.dataReferencia);
    const limit=Math.min(5000,Math.max(1,Number(query.limit||1000)));
    const rows=(data.receivables||[]).map(row=>panelReceivable(row,reference)).filter(row=>row.atrasado).slice(0,limit);
    return{inadimplentes:rows,total:rows.length,summary:data.summary||{},source:'ariana_erp',historicalDataPreserved:true};
  }

  async function dashboard(query={}){
    const reference=parseReferenceDate(query.dataReferencia),tomorrow=addDays(reference,1),weekEnd=addDays(reference,6);
    const monthStart=new Date(reference.getFullYear(),reference.getMonth(),1),monthEnd=new Date(reference.getFullYear(),reference.getMonth()+1,0);
    monthStart.setHours(0,0,0,0);monthEnd.setHours(23,59,59,999);
    const data=await finance.list({});
    const rows=data.receivables||[],open=rows.filter(row=>openStatus(row.status));
    const overdueRows=open.filter(row=>overdue(row,reference));
    const sumRemaining=list=>money(list.reduce((s,row)=>s+Number(row.remaining||0),0));
    const uniqueCustomers=new Set(rows.map(customerKey).filter(Boolean));
    const originalTotal=money(rows.reduce((s,row)=>s+Number(row.value||0),0));
    const receivedTotal=money(rows.reduce((s,row)=>s+Number(row.receivedAmount||0),0));
    const openPortfolio=sumRemaining(open),overdueTotal=sumRemaining(overdueRows);
    const monthRows=open.filter(row=>row.dueAt&&inRange(row.dueAt,monthStart,monthEnd));
    const defaultRate=openPortfolio>0?money((overdueTotal/openPortfolio)*100):0;
    const kpis={
      receivableTodayCents:cents(sumRemaining(open.filter(row=>sameDay(row.dueAt,reference)))),
      receivableTomorrowCents:cents(sumRemaining(open.filter(row=>sameDay(row.dueAt,tomorrow)))),
      receivableWeekCents:cents(sumRemaining(open.filter(row=>row.dueAt&&inRange(row.dueAt,reference,weekEnd)))),
      receivableMonthCents:cents(sumRemaining(monthRows)),
      openPortfolioCents:cents(openPortfolio),
      overdueUpdatedCents:cents(overdueTotal),
      accumulatedFineCents:0,
      accumulatedInterestCents:0,
      totalReceivedCents:cents(receivedTotal),
      defaultRatePercent:defaultRate,
      averageTicketCents:cents(uniqueCustomers.size?originalTotal/uniqueCustomers.size:0),
      customers:uniqueCustomers.size,
      openInstallments:open.length,
      overdueInstallments:overdueRows.length
    };
    const byStatus={
      aberto:open.filter(row=>String(row.status)==='pendente').length,
      parcial:open.filter(row=>String(row.status)==='parcial').length,
      quitado:rows.filter(row=>String(row.status)==='recebido').length,
      vencido:overdueRows.length
    };
    return{
      kpis,
      source:'ariana_erp',
      historicalDataPreserved:true,
      referenceDate:reference.toISOString(),
      summary:{...(data.summary||{}),originalTotal,receivedTotal,openPortfolio,overdueTotal},
      byStatus,
      note:'Multa e juros permanecem zerados neste resumo até serem registrados de forma oficial no recebimento do Ariana ERP.'
    };
  }

  async function receber(orderId,number,payload={},actor={}){
    const result=await finance.receive(orderId,number,{
      amount:payload.amount??payload.valor,
      value:payload.value??payload.valor,
      settle:payload.settle===true||payload.quitar===true,
      fine:payload.fine??payload.multa,
      interest:payload.interest??payload.juros,
      discount:payload.discount??payload.desconto,
      paidAt:payload.paidAt||payload.dataPagamento,
      method:payload.method||payload.formaPagamento,
      bankAccountName:payload.bankAccountName||payload.contaBancaria||payload.banco,
      document:payload.document||payload.documento,
      note:payload.note||payload.observacao||payload.notes
    },actor);
    return{...result,source:'ariana_erp'};
  }

  return{clientes,lancamentos,inadimplentes,dashboard,receber};
}

export { panelCustomer, panelReceivable };
export default createErpFinancePanelBridgeService;
