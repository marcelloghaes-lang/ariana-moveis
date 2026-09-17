const FINE_RATE=0.02;
const MONTHLY_INTEREST_RATE=0.01;
const DAYS_PER_MONTH=30;
const TZ='America/Sao_Paulo';
const dayFmt=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'});
const money=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;

function daySerial(value){
  if(!value)return null;
  if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)){
    const [y,m,d]=value.split('-').map(Number);return Date.UTC(y,m-1,d);
  }
  const date=value instanceof Date?value:new Date(value);
  if(Number.isNaN(date.getTime()))return null;
  const parts=Object.fromEntries(dayFmt.formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
  return Date.UTC(parts.year,parts.month-1,parts.day);
}

export function daysLate(dueAt,asOf=new Date()){
  const due=daySerial(dueAt),ref=daySerial(asOf);
  if(due===null||ref===null||ref<=due)return 0;
  return Math.max(0,Math.floor((ref-due)/86400000));
}

export function calculateLateCharge({principal=0,dueAt,asOf=new Date(),direction='receivable'}={}){
  const base=Math.max(0,money(principal));
  const days=direction==='receivable'?daysLate(dueAt,asOf):0;
  if(base<=0||days<=0)return{overdue:false,daysLate:0,principal:base,fine:0,interest:0,charges:0,updatedTotal:base,fineRate:FINE_RATE,monthlyInterestRate:MONTHLY_INTEREST_RATE,dailyInterestRate:MONTHLY_INTEREST_RATE/DAYS_PER_MONTH};
  const fine=money(base*FINE_RATE);
  const interest=money(base*MONTHLY_INTEREST_RATE*(days/DAYS_PER_MONTH));
  return{overdue:true,daysLate:days,principal:base,fine,interest,charges:money(fine+interest),updatedTotal:money(base+fine+interest),fineRate:FINE_RATE,monthlyInterestRate:MONTHLY_INTEREST_RATE,dailyInterestRate:MONTHLY_INTEREST_RATE/DAYS_PER_MONTH};
}

export function lateChargeFactor({dueAt,asOf=new Date(),direction='receivable'}={}){
  const days=direction==='receivable'?daysLate(dueAt,asOf):0;
  return days>0?1+FINE_RATE+MONTHLY_INTEREST_RATE*(days/DAYS_PER_MONTH):1;
}

export const ERP_LATE_CHARGE_POLICY=Object.freeze({fineRate:FINE_RATE,monthlyInterestRate:MONTHLY_INTEREST_RATE,daysPerMonth:DAYS_PER_MONTH,timeZone:TZ,interestType:'simple_prorata_daily'});
export default calculateLateCharge;
