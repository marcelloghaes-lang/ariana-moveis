import {brl,clean,fmtCep,fmtDoc,fmtPhone,keyGroups,dateOnlyBr,timeBr,dateTimeCompact,money,digits} from './erpDanfeOriginalPdf.js';

export function drawReceipt(c,d){
  const y=29.05;
  c.roundRect(34.16,y,290.68,24.68);c.roundRect(325.26,y,126.83,24.68);c.roundRect(453.79,y,109.80,50.22);
  c.roundRect(35.01,54.16,130.66,24.68);c.roundRect(166.09,54.16,200.88,24.68);c.roundRect(367.40,54.16,84.69,24.68);
  c.text(37.14,30.2,`RECEBEMOS DE ${d.issuer.name} OS PRODUTOS/SERVIÇOS CONSTANTES DA NOTA FISCAL INDICADA AO LADO`,4.7,false,'left',285);
  c.text(328.2,30.2,'DATA DE RECEBIMENTO',4.7,false,'left',120);
  c.text(37.99,55.3,'IDENTIFICAÇÃO E ASSINATURA DO RECEBEDOR',4.7,false,'left',124);
  c.text(169.07,55.3,'DESTINATÁRIO',4.7,false,'left',194);c.text(174.18,62.0,d.dest.name,9.1,true,'left',188);
  c.text(370.38,55.3,'VLR TOTAL NOTA',4.7,false,'left',78);c.text(370.4,62.0,brl(d.total.vNF),9.7,true,'center',78);
  c.text(457.0,29.2,'NF-e',10.2,true,'center',103);c.text(457.0,47.0,`Nº ${d.number}`,9.8,true,'center',103);c.text(457.0,64.8,`SÉRIE ${d.series}`,9.8,true,'center',103);
  c.line(32.88,86.9,563.60,86.9,.42,[1.28,1.28]);
}

export function drawHeader(c,d,hasLogo){
  const y=95.87;
  c.roundRect(35.44,y,218.75,85.97);c.roundRect(345.27,y,218.75,85.97);
  if(hasLogo)c.image(42.0,y+4.0,198,55);
  else{c.text(43,y+10,'ARIANA MÓVEIS',12,true,'left',190);c.text(43,y+26,'Sua casa merece o melhor.',6.5,true,'left',190)}
  const infoX=40.0;
  c.text(infoX,y+61,d.issuer.name,c.fit(d.issuer.name,5.3,208,4.2,true),true,'left',208);
  const addr=`${d.issuer.street} - ${d.issuer.city}/${d.issuer.uf} - CEP ${fmtCep(d.issuer.cep)}`;
  c.text(infoX,y+69.5,addr,c.fit(addr,4.15,208,3.2),false,'left',208);
  c.text(infoX,y+77.0,`CNPJ/CPF: ${fmtDoc(d.issuer.doc)}   IE: ${d.issuer.ie||''}`,c.fit(`CNPJ/CPF: ${fmtDoc(d.issuer.doc)}   IE: ${d.issuer.ie||''}`,3.95,208,3.1),false,'left',208);
  c.text(infoX,y+84.0,`Fone: ${fmtPhone(d.issuer.phone)}`,3.95,false,'left',208);

  const mx=254.19,mw=91.08;
  c.text(mx,y+1,'DANFE',10.2,true,'center',mw);
  c.text(mx,y+11,'Documento Auxiliar da Nota',4.75,true,'center',mw);
  c.text(mx,y+17.5,'Fiscal Eletrônica',4.75,true,'center',mw);
  c.text(mx+8,y+29,'0 - Entrada',5.6,false,'left',42);c.text(mx+8,y+38,'1 - Saída',5.6,false,'left',42);
  c.roundRect(mx+52,y+28,18,17,1.8);c.text(mx+52,y+31,d.tpNF==='0'?'0':'1',8.0,true,'center',18);
  c.text(mx,y+50,`Nº. ${d.number}`,7.6,true,'center',mw);c.text(mx,y+60,`SÉRIE: ${d.series}`,7.6,true,'center',mw);c.text(mx,y+70,'FOLHA 1/1',7.6,true,'center',mw);

  const rx=345.27,rw=218.75;
  c.barcode(rx+4,y+4,rw-8,21,d.key);
  c.roundRect(rx+1.7,y+27.24,rw-3.4,19.15,2.3);
  c.text(rx+5,y+28.3,'CHAVE DE ACESSO',5.8,false,'left',rw-10);c.text(rx+5,y+35.7,keyGroups(d.key),6.2,true,'center',rw-10);
  c.text(rx+7,y+49.0,'Consulta de autenticidade no portal nacional da NF-e',6.2,true,'center',rw-14);
  c.text(rx+7,y+58.2,'www.nfe.fazenda.gov.br/portal, ou no site da Sefaz Autorizadora',5.45,true,'center',rw-14);
}

export function drawFiscalIdentification(c,d){
  c.labelValue(35.44,182.69,309.40,19.15,'NATUREZA DA OPERAÇÃO',d.nature,{valueSize:9.79});
  c.labelValue(345.27,182.69,218.75,19.15,'PROTOCOLO DE AUTORIZAÇÃO DE USO',`${d.protocol}${d.authDate?' '+dateTimeCompact(d.authDate):''}`,{valueSize:8.4});
  c.labelValue(36.29,202.27,131.51,19.15,'INSCRIÇÃO ESTADUAL',d.issuer.ie,{valueSize:8.9});
  c.labelValue(168.22,202.27,160.45,19.15,'INSCRIÇÃO ESTADUAL DO SUBST. TRIB.','',{valueSize:8.5});
  c.labelValue(329.09,202.27,234.93,19.15,'CNPJ',fmtDoc(d.issuer.doc),{valueSize:9.6});
}

export function drawRecipient(c,d){
  c.text(34.58,223.2,'DESTINATÁRIO/REMETENTE',6.38,false);
  c.labelValue(35.01,230.36,346.43,19.15,'NOME/RAZÃO SOCIAL',d.dest.name,{valueSize:9.79});
  c.labelValue(381.87,230.36,101.29,19.15,'CPF/CNPJ',fmtDoc(d.dest.doc),{valueSize:8.8});
  c.labelValue(483.58,230.36,80.44,19.15,'DATA DA EMISSÃO',dateOnlyBr(d.issueDate),{valueSize:8.8});
  c.labelValue(35.86,250.36,266.85,19.15,'ENDEREÇO',d.dest.street,{valueSize:8.7});
  c.labelValue(303.13,250.36,139.17,19.15,'BAIRRO/DISTRITO',d.dest.district,{valueSize:8.3});
  c.labelValue(442.73,250.36,40.43,19.15,'CEP',digits(d.dest.cep)||fmtCep(d.dest.cep),{valueSize:7.4});
  c.labelValue(483.58,250.36,80.44,19.15,'DATA DA ENTRADA/SAÍDA',dateOnlyBr(d.exitDate),{valueSize:8.0});
  c.labelValue(36.29,270.36,177.47,19.15,'MUNICÍPIO',d.dest.city,{valueSize:9.0});
  c.labelValue(214.18,270.36,107.25,19.15,'FONE/FAX',digits(d.dest.phone)||fmtPhone(d.dest.phone),{valueSize:8.1});
  c.labelValue(321.86,270.36,27.24,19.15,'UF',d.dest.uf,{valueSize:9.0});
  c.labelValue(349.52,270.36,133.64,19.15,'INSCRIÇÃO ESTADUAL',d.dest.ie,{valueSize:8.7});
  c.labelValue(483.58,270.36,80.44,19.15,'HORA DA ENTRADA/SAÍDA',timeBr(d.exitDate),{valueSize:8.1});
}

export function drawBilling(c,d){
  const list=d.dups||[],count=list.length,lineH=count>15?Math.max(5.9,127.5/count):8.51;
  const boxY=298.45,boxH=count?Math.max(19.15,1+count*lineH):19.15;
  c.text(34.58,291.4,'FATURA/DUPLICATA',6.38,false);
  c.roundRect(35.86,boxY,528.16,boxH,2.55);
  if(!count){c.text(38.84,boxY+4,'Sem duplicatas informadas no XML.',7.2,false,'left',520);return boxY+boxH}
  const fatNo=d.fat.n||d.number||'',orig=d.fat.orig||d.total.vNF||'',liq=d.fat.liq||d.total.vNF||'';
  const fontSize=count>15?Math.max(5.2,7.5-(count-15)*.18):7.25;
  list.forEach((p,i)=>{
    const n=clean(p.n||String(i+1).padStart(3,'0')).padStart(3,'0');
    const seg=[];
    if(fatNo)seg.push({text:`Fat nº : ${fatNo} / `});
    if(orig)seg.push({text:`Valor Orig. : ${money(orig)} / `});
    if(liq)seg.push({text:`Valor Liq. : ${money(liq)} `});
    seg.push({text:'Dup. nº',bold:true},{text:`: ${n} ,`},{text:'Venc.',bold:true},{text:`: ${dateOnlyBr(p.venc)} , `},{text:'Valor',bold:true},{text:`:${money(p.valor)}`});
    c.richText(38.84,boxY+1.1+i*lineH,seg,fontSize,520);
  });
  return boxY+boxH;
}
