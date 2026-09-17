import { createErpCollectionWorkflowService } from './erpCollectionWorkflowService.js';
import { createErpAdvancedFinanceReportService } from './erpAdvancedFinanceReportService.js';

const W=595.28,H=841.89,M=32,CW=W-M*2,TZ='America/Sao_Paulo';
const clean=(v='',m=1000)=>String(v??'').trim().replace(/\s+/g,' ').slice(0,m);
const money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const date=v=>{if(!v)return'—';const d=new Date(v);return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat('pt-BR',{timeZone:TZ}).format(d)};
const nowLabel=()=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:TZ}).format(new Date());

class Page{
  constructor(){this.ops=[]}
  text(x,y,value,size=8,bold=false,maxW=0,align='left'){
    let s=clean(value,1500);if(!s)return;const width=t=>t.length*size*(bold?.53:.49);const original=s;
    if(maxW){while(s.length>1&&width(s)>maxW)s=s.slice(0,-1);if(s!==original&&s.length>4)s=s.slice(0,-3)+'...'}
    let xx=x;if(maxW&&align==='right')xx=x+maxW-width(s);if(maxW&&align==='center')xx=x+(maxW-width(s))/2;
    const esc=s.replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');this.ops.push(`BT /${bold?'F2':'F1'} ${size} Tf 1 0 0 1 ${xx.toFixed(2)} ${(H-y).toFixed(2)} Tm (${esc}) Tj ET`)
  }
  line(x1,y1,x2,y2,w=.4){this.ops.push(`${w} w ${x1.toFixed(2)} ${(H-y1).toFixed(2)} m ${x2.toFixed(2)} ${(H-y2).toFixed(2)} l S`)}
  rect(x,y,w,h,lw=.5){this.ops.push(`${lw} w ${x.toFixed(2)} ${(H-y-h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`)}
  stream(){return this.ops.join('\n')}
}
function pdf(streams){
  const pages=streams.map(x=>Buffer.from(x,'latin1')),objects=[],add=x=>objects.push(Buffer.isBuffer(x)?x:Buffer.from(x,'latin1')),pageNums=[],contentNums=[];let next=3;
  for(let i=0;i<pages.length;i++){pageNums.push(next++);contentNums.push(next++)}const f1=next++,f2=next++;
  add('<< /Type /Catalog /Pages 2 0 R >>');add(`<< /Type /Pages /Kids [${pageNums.map(n=>`${n} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  for(let i=0;i<pages.length;i++){add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${contentNums[i]} 0 R >>`);add(Buffer.concat([Buffer.from(`<< /Length ${pages[i].length} >>\nstream\n`,'latin1'),pages[i],Buffer.from('\nendstream','latin1')]))}
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const parts=[Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n','binary')],offsets=[0];let offset=parts[0].length;
  objects.forEach((o,i)=>{offsets[i+1]=offset;const h=Buffer.from(`${i+1} 0 obj\n`,'latin1'),f=Buffer.from('\nendobj\n','latin1');parts.push(h,o,f);offset+=h.length+o.length+f.length});
  const xref=offset;let xr=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;for(let i=1;i<=objects.length;i++)xr+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';xr+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;parts.push(Buffer.from(xr,'latin1'));return Buffer.concat(parts)
}
function writer(title,subtitle=''){
  const streams=[];let p=null,y=0,no=0;
  const push=()=>{if(!p)return;p.text(M,H-19,`Página ${no}`,7,false,CW,'right');streams.push(p.stream())};
  const page=()=>{if(p)push();p=new Page();no++;y=M;p.text(M,y,'ARIANA MÓVEIS',13,true);p.text(M+250,y,title,12,true,CW-250,'right');y+=17;if(subtitle){p.text(M,y,subtitle,8,false,CW-190);p.text(M+360,y,`Gerado em ${nowLabel()}`,7,false,CW-360,'right');y+=12}p.line(M,y,M+CW,y,.7);y+=14};
  const need=h=>{if(!p||y+h>H-42)page()};
  const text=(value,size=8,bold=false,indent=0)=>{need(size+7);p.text(M+indent,y,value,size,bold,CW-indent);y+=size+6};
  const row=(cols,widths,bold=false)=>{need(17);let x=M;cols.forEach((v,i)=>{const w=widths[i];p.text(x+2,y+10,v,7,bold,w-4,i===cols.length-1?'right':'left');x+=w});p.line(M,y+14,M+CW,y+14,.2);y+=15};
  const box=(label,value)=>{need(26);p.rect(M,y,CW,22,.5);p.text(M+6,y+14,label,8,true,CW*.55);p.text(M+CW*.58,y+14,value,9,true,CW*.40,'right');y+=28};
  page();return{get y(){return y},set y(v){y=v},get p(){return p},need,text,row,box,page,finish(){push();return pdf(streams)}};
}
function clientHeader(w,c){w.need(36);w.p.rect(M,w.y,CW,27,.6);w.p.text(M+6,w.y+10,c.name||c.clientName||'Sem identificação',9,true,270);w.p.text(M+280,w.y+10,c.document||c.clientDocument||'',7,false,115);w.p.text(M+400,w.y+10,money(c.totalUpdated??c.totalOverdue??c.openBalance??0),8.5,true,CW-406,'right');w.y+=33}

export function createErpCollectionPdfService(context={}){
  const workflow=createErpCollectionWorkflowService(context),advanced=createErpAdvancedFinanceReportService(context);

  async function queuePdf(q={}){
    const data=await workflow.fila(q),w=writer('FILA DO DIA — COBRANÇAS',`Data operacional: ${date(`${data.date}T12:00:00-03:00`)}`);
    w.box('Clientes na fila',String(data.summary.clients));w.box('Parcelas/títulos',String(data.summary.installments));w.box('Saldo vencido',money(data.summary.totalOverdue));w.box('Valor atualizado registrado',money(data.summary.totalUpdated));w.box('Promessas para hoje',String(data.summary.promisesToday));w.box('Promessas atrasadas',String(data.summary.promisesLate));
    w.text('A fila agrupa uma cobrança por cliente; as parcelas permanecem detalhadas abaixo.',8,false);w.text('Multa e juros somente aparecem quando estiverem oficialmente registrados no financeiro. Nenhuma taxa é criada automaticamente neste relatório.',7,false);
    for(const c of data.clients){clientHeader(w,c);w.row(['Venc.','Parcela','Dias','Original','Multa','Juros','Atualizado'],[58,45,38,96,76,76,142],true);for(const r of c.entries){w.row([date(r.dueAt),r.installment||'—',String(r.daysLate||0),money(r.originalValue),money(r.fineAmount),money(r.interestAmount),money(r.updatedAmount)],[58,45,38,96,76,76,142])}w.y+=7}
    return{buffer:w.finish(),filename:`fila-do-dia-${data.date}.pdf`,data};
  }
  async function promisesPdf(q={}){
    const data=await workflow.promessas(q),w=writer('PROMESSAS DE PAGAMENTO','Promessas registradas no Ariana ERP');w.box('Promessas listadas',String(data.summary.total));w.box('Vencem hoje',String(data.summary.today));w.box('Atrasadas',String(data.summary.late));w.box('Valor prometido',money(data.summary.amount));w.text('A promessa é acompanhada exatamente na data combinada.',8,false);w.row(['Data','Cliente','Parcela','Valor','Situação'],[72,205,70,95,89],true);for(const r of data.promises)w.row([date(r.promiseDate),r.clientName||'—',r.installment||'—',money(r.promiseAmount),r.status||'—'],[72,205,70,95,89]);return{buffer:w.finish(),filename:'promessas-de-pagamento.pdf',data};
  }
  async function recoveryPdf(q={}){
    const data=await workflow.recuperacao(q),w=writer('RECUPERAÇÃO DE CRÉDITO','Indicadores operacionais de cobrança');w.box('Clientes inadimplentes',String(data.summary.overdueClients));w.box('Parcelas vencidas',String(data.summary.overdueInstallments));w.box('Saldo vencido',money(data.summary.overdueAmount));w.box('Valor atualizado registrado',money(data.summary.updatedOverdueAmount));w.box('Promessas ativas',String(data.summary.activePromises));w.box('Promessas hoje',String(data.summary.promisesToday));w.box('Promessas atrasadas',String(data.summary.promisesLate));w.box('Tratativas concluídas no mês',String(data.summary.concludedThisMonth));w.text('Faixas de atraso',10,true);w.row(['Faixa','Clientes','Valor atualizado'],[250,90,191],true);for(const b of data.bands)w.row([b.label,String(b.clients),money(b.value)],[250,90,191]);return{buffer:w.finish(),filename:'recuperacao-de-credito.pdf',data};
  }
  async function financePdf(q={}){
    const r=await advanced.report(q),w=writer('RELATÓRIO FINANCEIRO GERENCIAL',`${date(r.period.from)} a ${date(r.period.to)}`);w.box('Receitas realizadas',money(r.summary.revenue));w.box('Despesas realizadas',money(r.summary.expense));w.box('Resultado realizado',money(r.summary.result));w.box('Receitas previstas',money(r.summary.expectedRevenue));w.box('Despesas previstas',money(r.summary.expectedExpense));w.box('Contas a receber vencidas',money(r.summary.overdueReceivables));w.text('Faixas de atraso',10,true);w.row(['Faixa','Títulos','Valor'],[245,95,191],true);for(const b of r.overdueBuckets)w.row([b.label,String(b.count),money(b.value)],[245,95,191]);w.text('Maiores devedores',10,true);w.row(['Cliente','Documento','Dias','Saldo'],[235,125,55,116],true);for(const d of r.debtors.slice(0,40))w.row([d.personName,d.document||'—',String(d.daysOverdue||0),money(d.value)],[235,125,55,116]);w.text('Previsão de caixa — 13 semanas',10,true);w.row(['Semana','A receber','A pagar','Líquido'],[155,125,125,126],true);for(const x of r.forecast)w.row([`${date(x.from)} a ${date(x.to)}`,money(x.receivable),money(x.payable),money(x.net)],[155,125,125,126]);w.text('Movimentação por conta bancária',10,true);w.row(['Conta','Entradas','Saídas','Saldo'],[195,112,112,112],true);for(const b of r.banks)w.row([b.account,money(b.inflow),money(b.outflow),money(b.net)],[195,112,112,112]);return{buffer:w.finish(),filename:'relatorio-financeiro-gerencial.pdf',data:r};
  }
  async function generate(type='fila',q={}){const t=clean(type,40).toLowerCase();if(t==='fila'||t==='fila-do-dia')return queuePdf(q);if(t==='promessas')return promisesPdf(q);if(t==='recuperacao')return recoveryPdf(q);if(t==='financeiro'||t==='gerencial')return financePdf(q);throw Object.assign(new Error('Tipo de relatório PDF inválido.'),{statusCode:400,code:'INVALID_PDF_REPORT_TYPE'})}
  return{generate};
}
export default createErpCollectionPdfService;
