import {money,qty,fmtDoc} from './erpDanfeOriginalPdf.js';

export function drawTaxes(c,d,y){
  const headingY=y+2.1;c.text(34.58,headingY,'CÁLCULO DO IMPOSTO',6.38,false);const row1=headingY+6.82;
  const a1=[['BASE DE CÁLCULO DO ICMS',d.total.vBC],['VALOR DO ICMS',d.total.vICMS],['BASE DE CÁLCULO DO ICMS ST',d.total.vBCST],['VALOR DO ICMS ST',d.total.vST],['VALOR TOTAL DOS PRODUTOS',d.total.vProd]];
  const xs1=[36.29,140.98,246.95,352.93,458.90,564.02];
  a1.forEach((a,i)=>c.labelValue(xs1[i],row1,xs1[i+1]-xs1[i]-.42,19.15,a[0],money(a[1]),{valueSize:9.79,align:'left'}));
  const row2=row1+20.0;const a2=[['VALOR DO FRETE',d.total.vFrete],['VALOR DO SEGURO',d.total.vSeg],['DESCONTO',d.total.vDesc],['OUTRAS DESPESAS',d.total.vOutro],['VALOR DO IPI',d.total.vIPI],['VALOR TOTAL DA NOTA',d.total.vNF]];
  const xs2=[37.14,124.81,212.48,300.15,388.25,476.35,564.02];
  a2.forEach((a,i)=>c.labelValue(xs2[i],row2,xs2[i+1]-xs2[i]-.42,19.15,a[0],money(a[1]),{valueSize:9.79,align:'left'}));
  return row2+19.15;
}

export function drawTransport(c,d,y){
  const headingY=y+2.1;c.text(34.58,headingY,'TRANSPORTADOR/VOLUMES TRANSPORTADOS',6.38,false);const r1=headingY+6.82;
  const mod=d.transport.modFrete==='9'?'9 - Sem Frete':d.transport.modFrete;
  c.labelValue(36.29,r1,256.21,19.15,'RAZÃO SOCIAL',d.transport.name||'',{valueSize:8.6});
  c.labelValue(292.92,r1,59.16,19.15,'FRETE POR CONTA',mod,{valueSize:7.2});
  c.labelValue(352.50,r1,69.80,19.15,'CÓDIGO ANTT','',{valueSize:8});
  c.labelValue(422.72,r1,48.52,19.15,'PLACA DO VEÍCULO',d.transport.plate,{valueSize:7.4});
  c.labelValue(471.67,r1,22.13,19.15,'UF',d.transport.plateUf,{valueSize:7.5});
  c.labelValue(494.22,r1,69.80,19.15,'CNPJ/CPF',fmtDoc(d.transport.doc),{valueSize:6.8});
  const r2=r1+20.0;
  c.labelValue(35.86,r2,256.21,19.15,'ENDEREÇO',d.transport.addr,{valueSize:8.2});
  c.labelValue(292.49,r2,163.00,19.15,'MUNICÍPIO',d.transport.city,{valueSize:8.2});
  c.labelValue(455.92,r2,27.24,19.15,'UF',d.transport.uf,{valueSize:8.2});
  c.labelValue(483.58,r2,80.44,19.15,'INSCRIÇÃO ESTADUAL',d.transport.ie,{valueSize:7.4});
  const r3=r2+20.0;
  c.labelValue(35.86,r3,102.99,19.15,'QUANTIDADE',d.transport.qVol,{valueSize:8.2});
  c.labelValue(139.28,r3,107.25,19.15,'ESPÉCIE',d.transport.esp,{valueSize:8.2});
  c.labelValue(246.95,r3,107.25,19.15,'MARCA',d.transport.marca,{valueSize:8.2});
  c.labelValue(354.63,r3,107.25,19.15,'PESO BRUTO',d.transport.pesoB,{valueSize:8.2});
  c.labelValue(462.30,r3,101.72,19.15,'PESO LÍQUIDO',d.transport.pesoL,{valueSize:8.2});
  return r3+19.15;
}

export function drawProducts(c,d,y){
  const headingY=y+2.1;c.text(34.58,headingY,'DADOS DOS PRODUTOS/SERVIÇOS',6.38,false);
  const tableY=headingY+6.82,xs=[32.46,63.95,284.83,310.79,326.97,343.14,358.46,384.85,413.79,442.73,469.11,495.50,521.89,543.17,564.45];
  const heads=['COD\nPROD','DESCRIÇÃO DOS PRODUTOS','NCM/SH','CST','CFOP','UNID','QTD','VLR UNIT','VLR\nTOTAL','BC ICMS','VLR\nICMS','VLR IPI','ALIQ\nICMS','ALIQ\nIPI'];
  const headerH=16.17;c.rect(xs[0],tableY,xs.at(-1)-xs[0],headerH,.42);
  for(let i=1;i<xs.length-1;i++)c.line(xs[i],tableY,xs[i],tableY+headerH,.35);
  heads.forEach((h,i)=>{const ww=xs[i+1]-xs[i]-1.2,parts=h.split('\n'),size=c.fit(parts.join(' '),7.0,ww,4.0,true);parts.forEach((p,j)=>c.text(xs[i]+.6,tableY+1+j*6.1,p,size,true,'center',ww))});
  let rowY=tableY+headerH,rowH=9.36;
  const issqnAnchor=689.57,available=Math.max(1,Math.floor((issqnAnchor-rowY-20)/rowH)),maxRows=Math.min(d.items.length,available);
  for(let r=0;r<maxRows;r++){
    const it=d.items[r],vals=[it.cProd,it.xProd,it.ncm,'',it.cfop,it.u,qty(it.q),money(it.vu),money(it.vt),money(it.vbc),money(it.vicms),money(it.vipi),it.picms||'',it.pipi||''];
    c.rect(xs[0],rowY,xs.at(-1)-xs[0],rowH,.35);for(let i=1;i<xs.length-1;i++)c.line(xs[i],rowY,xs[i],rowY+rowH,.28);
    vals.forEach((val,i)=>{const ww=xs[i+1]-xs[i]-1.2,align=i===1?'left':(i>=6?'right':'center'),sz=c.fit(String(val??''),6.2,ww,3.2,false);c.text(xs[i]+.6,rowY+1.1,val,sz,false,align,ww)});rowY+=rowH;
  }
  return rowY;
}

export function drawBottom(c,d,productsEnd){
  const y=Math.max(689.57,productsEnd+18);
  c.text(34.58,y-6.8,'CÁLCULO DO ISSQN',6.38,false);
  const xs=[36.71,168.65,300.58,432.51,564.02];
  const vals=[['INSCRIÇÃO MUNICIPAL',d.issuer.im||''],['VALOR TOTAL DOS SERVIÇOS',money(d.issqn.vServ)],['BASE DE CÁLCULO DO ISSQN',money(d.issqn.vBC)],['VALOR DO ISSQN',money(d.issqn.vISS)]];
  vals.forEach((a,i)=>c.labelValue(xs[i],y,xs[i+1]-xs[i]-.42,19.15,a[0],a[1],{valueSize:9.2}));
  const addHeading=y+21.9;c.text(34.58,addHeading,'DADOS ADICIONAIS',6.38,false);const boxY=addHeading+6.85;
  c.roundRect(35.44,boxY,373.24,54.05,2.55);c.roundRect(409.11,boxY,154.92,54.05,2.55);
  c.text(38.41,boxY+1.5,'INFORMAÇÕES COMPLEMENTARES',6.38,false,'left',367);
  c.wrap(d.additional,6.0,365,5).forEach((ln,i)=>c.text(38.41,boxY+12+i*8,ln,6.0,false,'left',365));
  c.text(412.0,boxY+1.5,'RESERVADO AO FISCO',6.38,false,'left',149);
  c.wrap(d.reserved,6.0,147,5).forEach((ln,i)=>c.text(412.0,boxY+12+i*8,ln,6.0,false,'left',147));
}

