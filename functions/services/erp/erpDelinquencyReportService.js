import mongoose from 'mongoose';
import { buildReceivables } from './erpService.js';

const PAGE_W=595.28;
const PAGE_H=841.89;
const M=32;
const CONTENT_W=PAGE_W-M*2;
const TZ='America/Sao_Paulo';
const clean=(v='',m=500)=>String(v??'').trim().replace(/\s+/g,' ').slice(0,m);
const digits=v=>String(v??'').replace(/\D/g,'');
const money=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
const arr=v=>Array.isArray(v)?v:[];
const sum=(rows,fn)=>money(rows.reduce((s,r)=>s+Number(fn(r)||0),0));
const safeName=v=>clean(v||'Sem identificação',220)||'Sem identificação';
const escRx=s=>String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

function fail(message,statusCode=400,code='ERP_DELINQUENCY_ERROR'){const e=new Error(message);e.statusCode=statusCode;e.code=code;return e}
function todayParts(){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const x=Object.fromEntries(parts.filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));return{year:Number(x.year),month:Number(x.month),day:Number(x.day)}}
function isoDate(y,m,d){return `${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`}
function dateAtStart(value){const s=clean(value,20);if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw fail('Data inicial inválida.',400,'INVALID_FROM_DATE');const d=new Date(`${s}T00:00:00-03:00`);if(Number.isNaN(d.getTime()))throw fail('Data inicial inválida.',400,'INVALID_FROM_DATE');return d}
function dateAtEnd(value){const s=clean(value,20);if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw fail('Data final inválida.',400,'INVALID_TO_DATE');const d=new Date(`${s}T23:59:59.999-03:00`);if(Number.isNaN(d.getTime()))throw fail('Data final inválida.',400,'INVALID_TO_DATE');return d}
function period(q={}){const p=todayParts(),todayIso=isoDate(p.year,p.month,p.day),fromIso=clean(q.from,20)||isoDate(p.year,p.month,1),toIso=clean(q.to,20)||todayIso,from=dateAtStart(fromIso),to=dateAtEnd(toIso),todayStart=dateAtStart(todayIso);if(from>to)throw fail('A data inicial não pode ser maior que a data final.',400,'INVALID_PERIOD');const effectiveTo=new Date(Math.min(to.getTime(),todayStart.getTime()-1));return{from,to,effectiveTo,todayStart,fromIso,toIso,todayIso}}
function principalPaid(r={}){const ps=arr(r.payments);if(ps.length)return money(ps.reduce((s,p)=>s+Number(p.principalApplied??p.principal??p.amount??0),0));if(Number(r.principalPaid||0)>0)return money(r.principalPaid);if(r.status==='paid'||r.status==='recebido')return money(r.value);return Math.min(money(r.value),Math.max(0,money(r.paidValue??r.receivedAmount??0)))}
function outstanding(r={}){return Math.max(0,money(Number(r.value||0)-principalPaid(r)))}
function clientKey(row={}){const doc=digits(row.document);return doc?`doc:${doc}`:`name:${safeName(row.name).toLocaleLowerCase('pt-BR')}`}
function daysLate(dueAt,todayStart){const d=new Date(dueAt);if(Number.isNaN(d.getTime()))return 0;return Math.max(1,Math.floor((todayStart-d)/86400000))}
function normalizeEntry(r,todayStart){const left=outstanding(r);return{id:`entry:${String(r._id||r.id||'')}`,source:'Ariana ERP',name:safeName(r.personName),document:clean(r.personDocument,40),phone:clean(r.phone||r.personPhone,40),email:clean(r.email||r.personEmail,160),reference:clean(r.documentNumber||r.description||r.sourceId||String(r._id||''),180),installment:clean(r.installmentNumber||r.parcelNumber||'',40),dueAt:r.dueAt,value:money(r.value),paid:principalPaid(r),outstanding:left,paymentMethod:clean(r.paymentMethod,80),daysLate:daysLate(r.dueAt,todayStart),origin:clean(r.origin,80),orderId:clean(r.orderId,120)}}
function normalizeOrder(order,r,todayStart){const left=outstanding(r),erp=order.televendas?.erp||{};return{id:`order:${String(order._id)}:${Number(r.number||1)}`,source:'Ariana',name:safeName(order.customerName),document:clean(order.customerCpf,40),phone:clean(order.customerPhone,40),email:clean(order.customerEmail,160),reference:clean(erp.code||String(order._id).slice(-8).toUpperCase(),180),installment:`${Number(r.number||1)}/${Number(r.installments||1)}`,dueAt:r.dueAt,value:money(r.value),paid:principalPaid(r),outstanding:left,paymentMethod:clean(r.method||order.payment?.method,80),daysLate:daysLate(r.dueAt,todayStart),origin:'ariana_sale',orderId:String(order._id)}}
function compareNames(a,b){return safeName(a).localeCompare(safeName(b),'pt-BR',{sensitivity:'base',numeric:true})}
function formatDoc(v){const d=digits(v);if(d.length===11)return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/,'$1.$2.$3-$4');if(d.length===14)return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5');return clean(v,40)}
function formatDate(v){const d=new Date(v);if(Number.isNaN(d.getTime()))return'';return new Intl.DateTimeFormat('pt-BR',{timeZone:TZ}).format(d)}
function brl(v){return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}

class PdfPage{
 constructor(){this.ops=[]}
 text(x,y,text,size=9,bold=false,maxW=0,align='left'){let s=clean(text,1000);if(!s)return;const w=t=>t.length*size*(bold?.53:.49);if(maxW){while(s.length>1&&w(s)>maxW)s=s.slice(0,-1);if(s!==clean(text,1000)&&s.length>3)s=s.slice(0,-3)+'...'}let xx=x;if(maxW&&align==='right')xx=x+maxW-w(s);if(maxW&&align==='center')xx=x+(maxW-w(s))/2;const esc=s.replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');this.ops.push(`BT /${bold?'F2':'F1'} ${size} Tf 1 0 0 1 ${xx.toFixed(2)} ${(PAGE_H-y).toFixed(2)} Tm (${esc}) Tj ET`)}
 line(x1,y1,x2,y2,w=.5){this.ops.push(`${w} w ${x1.toFixed(2)} ${(PAGE_H-y1).toFixed(2)} m ${x2.toFixed(2)} ${(PAGE_H-y2).toFixed(2)} l S`)}
 rect(x,y,w,h,lw=.5){this.ops.push(`${lw} w ${x.toFixed(2)} ${(PAGE_H-y-h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`)}
 stream(){return this.ops.join('\n')}
}
function buildPdf(pageStreams){
 const pages=pageStreams.map(s=>Buffer.from(s,'latin1'));const objs=[];const add=x=>objs.push(Buffer.isBuffer(x)?x:Buffer.from(x,'latin1'));
 const pageObjNums=[],contentObjNums=[];let next=3;for(let i=0;i<pages.length;i++){pageObjNums.push(next++);contentObjNums.push(next++)}const font1=next++,font2=next++;
 add('<< /Type /Catalog /Pages 2 0 R >>');add(`<< /Type /Pages /Kids [${pageObjNums.map(n=>`${n} 0 R`).join(' ')}] /Count ${pages.length} >>`);
 for(let i=0;i<pages.length;i++){add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >> >> /Contents ${contentObjNums[i]} 0 R >>`);add(Buffer.concat([Buffer.from(`<< /Length ${pages[i].length} >>\nstream\n`,'latin1'),pages[i],Buffer.from('\nendstream','latin1')]))}
 add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
 const parts=[Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n','binary')],offsets=[0];let offset=parts[0].length;objs.forEach((o,i)=>{offsets[i+1]=offset;const h=Buffer.from(`${i+1} 0 obj\n`,'latin1'),f=Buffer.from('\nendobj\n','latin1');parts.push(h,o,f);offset+=h.length+o.length+f.length});const xref=offset;let xr=`xref\n0 ${objs.length+1}\n0000000000 65535 f \n`;for(let i=1;i<=objs.length;i++)xr+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';xr+=`trailer\n<< /Size ${objs.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;parts.push(Buffer.from(xr,'latin1'));return Buffer.concat(parts)
}
function pdfFromReport(report){
 const pages=[];let p=null,y=0,pageNo=0;
 const pushPage=()=>{if(!p)return;p.text(M,PAGE_H-20,`Página ${pageNo}`,7,false,CONTENT_W,'right');pages.push(p.stream())};
 const newPage=()=>{if(p)pushPage();p=new PdfPage();pageNo++;y=M;p.text(M,y,'ARIANA MÓVEIS',13,true);p.text(M+300,y,'RELATÓRIO DE INADIMPLENTES',12,true,CONTENT_W-300,'right');y+=18;p.text(M,y,`Período de vencimento: ${formatDate(report.period.from)} a ${formatDate(report.period.to)}`,8);p.text(M+310,y,`Gerado em ${new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:TZ}).format(new Date())}`,8,false,CONTENT_W-310,'right');y+=12;p.line(M,y,M+CONTENT_W,y,.7);y+=15};
 const need=h=>{if(!p||y+h>PAGE_H-45)newPage()};newPage();
 p.text(M,y,`Clientes: ${report.summary.clients}`,9,true);p.text(M+130,y,`Títulos/parcelas: ${report.summary.entries}`,9,true);p.text(M+300,y,`Total vencido: ${brl(report.summary.totalOverdue)}`,10,true,CONTENT_W-300,'right');y+=18;
 for(const g of report.clients){need(42);p.rect(M,y,CONTENT_W,28,.7);p.text(M+6,y+10,g.name,10,true,238);p.text(M+250,y+10,formatDoc(g.document),8,false,110);p.text(M+365,y+10,`${g.count} parcela(s)`,8,true,68,'center');p.text(M+438,y+10,brl(g.totalOverdue),8.5,true,CONTENT_W-444,'right');y+=34;
   const headers=[['Venc.',55],['Referência',145],['Parcela',48],['Forma',75],['Dias',42],['Saldo',95]];let x=M;p.line(M,y,M+CONTENT_W,y,.4);for(const [h,w] of headers){p.text(x+2,y+10,h,7,true,w-4);x+=w}y+=14;
   for(const r of g.entries){need(18);x=M;const vals=[[formatDate(r.dueAt),55],[r.reference,145],[r.installment||'-',48],[r.paymentMethod||'-',75],[String(r.daysLate),42],[brl(r.outstanding),95]];for(let i=0;i<vals.length;i++){const [v,w]=vals[i];p.text(x+2,y+10,v,7,false,w-4,i===vals.length-1?'right':'left');x+=w}p.line(M,y+14,M+CONTENT_W,y+14,.2);y+=15}
   y+=8;
 }
 if(p)pushPage();
 return buildPdf(pages)
}

export function createErpDelinquencyReportService(context={}){
 const {Order}=context;if(!Order)throw new Error('[erp-delinquency] Order não informado');
 async function rawRows(q={}){
   const pr=period(q);if(pr.effectiveTo<pr.from)return{period:pr,rows:[]};
   const Entry=mongoose.models.ErpFinancialEntry;let legacy=[];
   if(Entry){legacy=await Entry.collection.find({direction:'receivable',status:{$nin:['paid','cancelled']},dueAt:{$gte:pr.from,$lte:pr.effectiveTo}}).sort({dueAt:1}).limit(50000).toArray()}
   const rows=legacy.map(r=>normalizeEntry(r,pr.todayStart)).filter(r=>r.outstanding>0.009);
   const orders=await Order.find({origin:'erp_ariana',status:{$in:['pedido','venda','faturado']}}).select('_id customerName customerCpf customerPhone customerEmail payment total televendas updatedAt').lean();
   for(const o of orders){const stored=arr(o.televendas?.erp?.receivables),receivables=stored.length?stored:buildReceivables(o.total,o.payment||{});for(const r of receivables){const st=String(r.status||'').toLowerCase();if(['recebido','cancelado','estornado'].includes(st))continue;const due=new Date(r.dueAt||0);if(Number.isNaN(due.getTime())||due<pr.from||due>pr.effectiveTo)continue;const row=normalizeOrder(o,r,pr.todayStart);if(row.outstanding>0.009)rows.push(row)}}
   const qtext=clean(q.q||q.search,180);let filtered=rows;if(qtext){const rx=new RegExp(escRx(qtext),'i');filtered=rows.filter(r=>rx.test([r.name,r.document,r.reference,r.phone,r.email].join(' ')))}
   filtered.sort((a,b)=>compareNames(a.name,b.name)||new Date(a.dueAt)-new Date(b.dueAt));return{period:pr,rows:filtered}
 }
 async function report(q={}){const {period:pr,rows}=await rawRows(q);const map=new Map();for(const r of rows){const k=clientKey(r),g=map.get(k)||{key:k,name:r.name,document:r.document,phone:r.phone,email:r.email,count:0,totalOverdue:0,oldestDue:r.dueAt,newestDue:r.dueAt,entries:[]};g.count++;g.totalOverdue+=Number(r.outstanding||0);if(new Date(r.dueAt)<new Date(g.oldestDue))g.oldestDue=r.dueAt;if(new Date(r.dueAt)>new Date(g.newestDue))g.newestDue=r.dueAt;if(!g.phone&&r.phone)g.phone=r.phone;if(!g.email&&r.email)g.email=r.email;g.entries.push(r);map.set(k,g)}const clients=[...map.values()].map(g=>({...g,totalOverdue:money(g.totalOverdue),entries:g.entries.sort((a,b)=>new Date(a.dueAt)-new Date(b.dueAt))})).sort((a,b)=>compareNames(a.name,b.name));return{period:{from:pr.from,to:pr.to,fromIso:pr.fromIso,toIso:pr.toIso,today:pr.todayIso},summary:{clients:clients.length,entries:rows.length,totalOverdue:sum(rows,r=>r.outstanding),oldestDue:rows.length?rows.reduce((a,r)=>!a||new Date(r.dueAt)<new Date(a)?r.dueAt:a,null):null},clients}}
 async function pdf(q={}){const data=await report(q);return{buffer:pdfFromReport(data),filename:`inadimplentes-${data.period.fromIso}-a-${data.period.toIso}.pdf`,report:data}}
 return{report,pdf};
}
export default createErpDelinquencyReportService;