const PAGE_W=595.28;
const PAGE_H=841.89;
const M=24;

const escPdf=s=>String(s??'').replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)').replace(/[\r\n]+/g,' ');
const clean=s=>String(s??'').replace(/\s+/g,' ').trim();
const num=v=>{const n=Number(String(v??'').replace(',','.'));return Number.isFinite(n)?n:0};
const brl=v=>num(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const digits=s=>String(s??'').replace(/\D/g,'');
const fmtDoc=s=>{const d=digits(s);if(d.length===14)return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5');if(d.length===11)return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/,'$1.$2.$3-$4');return s||''};
const fmtCep=s=>{const d=digits(s);return d.length===8?d.replace(/^(\d{5})(\d{3})$/,'$1-$2'):s||''};
const fmtPhone=s=>{const d=digits(s);if(d.length===11)return d.replace(/^(\d{2})(\d{5})(\d{4})$/,'($1) $2-$3');if(d.length===10)return d.replace(/^(\d{2})(\d{4})(\d{4})$/,'($1) $2-$3');return s||''};
const keyGroups=s=>digits(s).replace(/(.{4})/g,'$1 ').trim();

function decodeXml(v=''){
  return String(v).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&apos;/g,"'");
}
function tag(xml,name){
  const re=new RegExp(`<(?:(?:\\w+):)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:(?:\\w+):)?${name}>`,'i');
  const m=String(xml||'').match(re);return m?clean(decodeXml(m[1]).replace(/<[^>]+>/g,' ')):'';
}
function block(xml,name){
  const re=new RegExp(`<(?:(?:\\w+):)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:(?:\\w+):)?${name}>`,'i');
  return String(xml||'').match(re)?.[1]||'';
}
function blocks(xml,name){
  const re=new RegExp(`<(?:(?:\\w+):)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:(?:\\w+):)?${name}>`,'ig');
  const out=[];let m;while((m=re.exec(String(xml||''))))out.push(m[1]);return out;
}
function attrBlock(xml,name){
  const re=new RegExp(`<(?:(?:\\w+):)?${name}([^>]*)>([\\s\\S]*?)<\\/(?:(?:\\w+):)?${name}>`,'ig');
  const out=[];let m;while((m=re.exec(String(xml||''))))out.push({attrs:m[1],body:m[2]});return out;
}
function dateBr(v){
  if(!v)return'';const d=new Date(v);if(Number.isNaN(d.getTime()))return v;return d.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
}
function dateOnlyBr(v){if(!v)return'';const d=new Date(v);if(Number.isNaN(d.getTime()))return v;return d.toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'});}
function address(b){return [tag(b,'xLgr'),tag(b,'nro'),tag(b,'xCpl'),tag(b,'xBairro')].filter(Boolean).join(', ')}

const CODE128=[
'212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212','112232','122132','122231','113222','123122','123221','223211','221132','221231','213212','223112','312131','311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321','112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121','313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111','314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114','122411','142112','142211','241211','221114','413111','241112','134111','111242','121142','121241','114212','124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113','114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112'];
function code128Values(key){
  const d=digits(key);if(!/^\d{2,}$/.test(d)||d.length%2)return[];const vals=[105];for(let i=0;i<d.length;i+=2)vals.push(Number(d.slice(i,i+2)));let sum=105;for(let i=1;i<vals.length;i++)sum+=vals[i]*i;vals.push(sum%103,106);return vals;
}

class Canvas{
  constructor(){this.ops=[];}
  line(x1,y1,x2,y2,w=.5,dash=null){if(dash)this.ops.push(`[${dash.join(' ')}] 0 d`);else this.ops.push('[] 0 d');this.ops.push(`${w} w ${x1.toFixed(2)} ${(PAGE_H-y1).toFixed(2)} m ${x2.toFixed(2)} ${(PAGE_H-y2).toFixed(2)} l S`);}
  rect(x,y,w,h,lw=.5,fill=null){this.ops.push('[] 0 d');if(fill){this.ops.push(`${fill} rg ${x.toFixed(2)} ${(PAGE_H-y-h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);}this.ops.push(`0 G ${lw} w ${x.toFixed(2)} ${(PAGE_H-y-h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`);}
  text(x,y,s,size=6,bold=false,align='left',maxW=null){s=clean(s);if(!s)return;let xx=x;if(maxW){const est=this.width(s,size,bold);if(align==='center')xx=x+(maxW-est)/2;else if(align==='right')xx=x+maxW-est;}this.ops.push(`BT /${bold?'F2':'F1'} ${size.toFixed(2)} Tf 1 0 0 1 ${Math.max(0,xx).toFixed(2)} ${(PAGE_H-y-size).toFixed(2)} Tm (${escPdf(s)}) Tj ET`);}
  width(s,size,bold=false){return clean(s).length*size*(bold?.54:.50);}
  fit(s,size,maxW,min=4){let z=size;while(z>min&&this.width(s,z)>maxW)z-=.25;return z;}
  wrap(s,size,maxW,maxLines=2){const words=clean(s).split(' ');const lines=[];let cur='';for(const word of words){const test=cur?cur+' '+word:word;if(this.width(test,size)<=maxW){cur=test;}else{if(cur)lines.push(cur);cur=word;if(lines.length>=maxLines-1)break;}}if(cur&&lines.length<maxLines)lines.push(cur);return lines;}
  labelValue(x,y,w,h,label,value,{valueSize=6,bold=true,align='left',pad=2}={}){this.rect(x,y,w,h);this.text(x+pad,y+1,label.toUpperCase(),4.1,false,'left',w-pad*2);const max=w-pad*2;const sz=this.fit(value,valueSize,max,4.3);this.text(x+pad,y+8,value,sz,bold,align,max);}
  barcode(x,y,w,h,key){const vals=code128Values(key);if(!vals.length)return;let units=20;for(const v of vals)units+=CODE128[v].split('').reduce((a,b)=>a+Number(b),0);const scale=w/units;let cx=x+10*scale;for(const v of vals){const p=CODE128[v];let black=true;for(const ch of p){const ww=Number(ch)*scale;if(black)this.ops.push(`0 g ${cx.toFixed(2)} ${(PAGE_H-y-h).toFixed(2)} ${ww.toFixed(2)} ${h.toFixed(2)} re f`);cx+=ww;black=!black;}}}
  stream(){return this.ops.join('\n');}
}

function parseDanfe(doc){
  const xml=String(doc?.xml||'');
  const ide=block(xml,'ide'),emit=block(xml,'emit'),enderEmit=block(emit,'enderEmit'),dest=block(xml,'dest'),enderDest=block(dest,'enderDest'),tot=block(xml,'ICMSTot'),transp=block(xml,'transp'),transporta=block(transp,'transporta'),veic=block(transp,'veicTransp'),vol=block(transp,'vol'),infProt=block(xml,'infProt'),infAdic=block(xml,'infAdic'),issqn=block(xml,'ISSQNtot'),cobr=block(xml,'cobr'),fat=block(cobr,'fat');
  const dets=attrBlock(xml,'det').map((d,i)=>{const p=block(d.body,'prod'),imp=block(d.body,'imposto'),icms=block(imp,'ICMS'),ipi=block(imp,'IPI');return{n:i+1,cProd:tag(p,'cProd'),xProd:tag(p,'xProd'),ncm:tag(p,'NCM'),cest:tag(p,'CEST'),cfop:tag(p,'CFOP'),u:tag(p,'uCom')||tag(p,'uTrib'),q:tag(p,'qCom')||tag(p,'qTrib'),vu:tag(p,'vUnCom')||tag(p,'vUnTrib'),vt:tag(p,'vProd'),vbc:tag(icms,'vBC'),vicms:tag(icms,'vICMS'),vipi:tag(ipi,'vIPI'),picms:tag(icms,'pICMS'),pipi:tag(ipi,'pIPI')};});
  const dups=blocks(cobr,'dup').map(d=>({n:tag(d,'nDup'),venc:tag(d,'dVenc'),valor:tag(d,'vDup')}));
  const pays=blocks(block(xml,'pag'),'detPag').map((p,i)=>({n:String(i+1),venc:'',valor:tag(p,'vPag'),tipo:tag(p,'tPag')}));
  const issuerDoc=tag(emit,'CNPJ')||tag(emit,'CPF')||doc.issuerDocument||'';
  const destDoc=tag(dest,'CNPJ')||tag(dest,'CPF')||doc.recipientDocument||'';
  const key=tag(infProt,'chNFe')||doc.key||'';
  return{
    key,number:tag(ide,'nNF')||doc.number||'',series:tag(ide,'serie')||doc.series||'',model:tag(ide,'mod')||'55',status:doc.status||'',protocol:tag(infProt,'nProt')||doc.protocol||'',authDate:tag(infProt,'dhRecbto'),
    nature:tag(ide,'natOp')||doc.natureOperation||'',issueDate:tag(ide,'dhEmi')||tag(ide,'dEmi')||doc.date||'',exitDate:tag(ide,'dhSaiEnt')||tag(ide,'dSaiEnt')||'',tpNF:tag(ide,'tpNF'),
    issuer:{name:tag(emit,'xNome')||doc.issuerName||'',fantasy:tag(emit,'xFant'),doc:issuerDoc,ie:tag(emit,'IE'),im:tag(emit,'IM'),crt:tag(emit,'CRT'),street:address(enderEmit),city:tag(enderEmit,'xMun'),uf:tag(enderEmit,'UF'),cep:tag(enderEmit,'CEP'),phone:tag(enderEmit,'fone')},
    dest:{name:tag(dest,'xNome')||doc.recipientName||'',doc:destDoc,ie:tag(dest,'IE')||'ISENTO',street:address(enderDest),district:tag(enderDest,'xBairro'),city:tag(enderDest,'xMun'),uf:tag(enderDest,'UF'),cep:tag(enderDest,'CEP'),phone:tag(enderDest,'fone'),email:tag(dest,'email')||doc.recipientEmail||'',indIE:tag(dest,'indIEDest')},
    fat:{n:tag(fat,'nFat'),orig:tag(fat,'vOrig'),desc:tag(fat,'vDesc'),liq:tag(fat,'vLiq')},dups:dups.length?dups:pays,
    total:{vBC:tag(tot,'vBC'),vICMS:tag(tot,'vICMS'),vICMSDeson:tag(tot,'vICMSDeson'),vFCPUFDest:tag(tot,'vFCPUFDest'),vBCST:tag(tot,'vBCST'),vST:tag(tot,'vST'),vProd:tag(tot,'vProd'),vFrete:tag(tot,'vFrete'),vSeg:tag(tot,'vSeg'),vDesc:tag(tot,'vDesc'),vII:tag(tot,'vII'),vIPI:tag(tot,'vIPI'),vPIS:tag(tot,'vPIS'),vCOFINS:tag(tot,'vCOFINS'),vOutro:tag(tot,'vOutro'),vNF:tag(tot,'vNF')||doc.total||0},
    transport:{modFrete:tag(transp,'modFrete'),name:tag(transporta,'xNome'),doc:tag(transporta,'CNPJ')||tag(transporta,'CPF'),ie:tag(transporta,'IE'),addr:tag(transporta,'xEnder'),city:tag(transporta,'xMun'),uf:tag(transporta,'UF'),plate:tag(veic,'placa'),plateUf:tag(veic,'UF'),qVol:tag(vol,'qVol'),esp:tag(vol,'esp'),marca:tag(vol,'marca'),nVol:tag(vol,'nVol'),pesoL:tag(vol,'pesoL'),pesoB:tag(vol,'pesoB')},
    items:dets,issqn:{vServ:tag(issqn,'vServ'),vBC:tag(issqn,'vBC'),vISS:tag(issqn,'vISS')},additional:tag(infAdic,'infCpl')||doc.metadata?.additionalInfo||'',reserved:tag(infAdic,'infAdFisco')||''
  };
}

function buildPdf(content){
  const stream=Buffer.from(content,'latin1');
  const objs=[];
  const add=b=>objs.push(Buffer.isBuffer(b)?b:Buffer.from(b,'latin1'));
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`);
  add(Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`,'latin1'),stream,Buffer.from('\nendstream','latin1')]));
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const parts=[Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n','binary')];
  const offsets=[0];let offset=parts[0].length;
  objs.forEach((o,i)=>{offsets[i+1]=offset;const h=Buffer.from(`${i+1} 0 obj\n`,'latin1'),f=Buffer.from('\nendobj\n','latin1');parts.push(h,o,f);offset+=h.length+o.length+f.length;});
  const xref=offset;let xr=`xref\n0 ${objs.length+1}\n0000000000 65535 f \n`;for(let i=1;i<=objs.length;i++)xr+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';xr+=`trailer\n<< /Size ${objs.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;parts.push(Buffer.from(xr,'latin1'));return Buffer.concat(parts);
}

function headerSection(c,d,y){
  const W=PAGE_W-M*2;
  const stubH=39;
  c.rect(M,y,W,stubH);c.line(M,y+18,M+W,y+18,.35);
  c.text(M+4,y+3,`RECEBEMOS DE ${d.issuer.name} OS PRODUTOS/SERVIÇOS CONSTANTES DA NOTA FISCAL INDICADA AO LADO`,4.4,false,'left',W-110);
  c.line(M+405,y,M+405,y+18,.35);c.text(M+408,y+3,'DATA DE RECEBIMENTO',4);
  c.line(M+154,y+18,M+154,y+stubH,.35);c.line(M+356,y+18,M+356,y+stubH,.35);c.line(M+452,y,M+452,y+stubH,.35);
  c.text(M+4,y+20,'IDENTIFICAÇÃO E ASSINATURA DO RECEBEDOR',4);
  c.text(M+158,y+20,'DESTINATÁRIO',4);c.text(M+158,y+28,d.dest.name,5.2,true,'left',194);
  c.text(M+360,y+20,'VALOR TOTAL NOTA',4);c.text(M+360,y+28,brl(d.total.vNF),6.4,true,'center',88);
  c.text(M+466,y+3,'NF-e',8,true,'center',70);c.text(M+466,y+15,`Nº ${d.number}`,8,true,'center',70);c.text(M+466,y+27,`SÉRIE ${d.series}`,7,true,'center',70);
  y+=stubH+7;c.line(M,y-3,M+W,y-3,.35,[2,2]);
  const hh=82,left=282,right=W-left;
  c.rect(M,y,left,hh);c.rect(M+left,y,right,hh);
  c.text(M+10,y+8,'ARIANA',14,true);
  c.text(M+61,y+16,'MÓVEIS',5.6,true);
  const issuerNameSize=c.fit(d.issuer.name,5.8,left-20,4.8);
  c.text(M+10,y+29,d.issuer.name,issuerNameSize,true);
  c.wrap(`${d.issuer.street} - ${d.issuer.city}/${d.issuer.uf} - CEP ${fmtCep(d.issuer.cep)}`,5.2,left-20,2).forEach((ln,i)=>c.text(M+10,y+40+i*7,ln,5.2));
  c.text(M+10,y+57,`CNPJ/CPF: ${fmtDoc(d.issuer.doc)}   IE: ${d.issuer.ie||''}`,5.1);
  c.text(M+10,y+66,`Fone: ${fmtPhone(d.issuer.phone)}`,5.1);
  const rx=M+left;
  c.text(rx+4,y+5,'DANFE',11,true,'center',right-8);
  c.text(rx+4,y+18,'Documento Auxiliar da Nota Fiscal Eletrônica',5.3,false,'center',right-8);
  c.text(rx+8,y+31,'0 - Entrada',5);c.text(rx+8,y+39,'1 - Saída',5);c.rect(rx+64,y+29,17,18,.5);c.text(rx+70,y+33,d.tpNF==='0'?'0':'1',8,true,'center',6);
  c.text(rx+92,y+31,`Nº ${d.number}`,7,true);c.text(rx+92,y+40,`SÉRIE ${d.series}`,6,true);c.text(rx+92,y+49,'FOLHA 1/1',5);
  c.barcode(rx+8,y+57,right-16,17,d.key);
  c.text(rx+8,y+75,keyGroups(d.key),5.1,true,'center',right-16);
  return y+hh;
}

function drawDanfe(doc){
  const d=parseDanfe(doc);const c=new Canvas();let y=M;const W=PAGE_W-M*2;
  y=headerSection(c,d,y);
  c.rect(M,y,W,24);c.text(M+4,y+2,'CHAVE DE ACESSO',4);c.text(M+4,y+10,keyGroups(d.key),6.1,true);c.text(M+288,y+2,'CONSULTA DE AUTENTICIDADE',4);c.text(M+288,y+10,'Consulta de autenticidade no portal nacional da NF-e',4.7);c.text(M+288,y+16,'www.nfe.fazenda.gov.br/portal ou no site da Sefaz Autorizadora',4.3);y+=24;
  c.labelValue(M,y,330,24,'Natureza da operação',d.nature,{valueSize:5.8});c.labelValue(M+330,y,W-330,24,'Protocolo de autorização de uso',`${d.protocol}${d.authDate?' - '+dateBr(d.authDate):''}`,{valueSize:5.2});y+=24;
  const w3=W/3;c.labelValue(M,y,w3,22,'Inscrição estadual',d.issuer.ie,{valueSize:5.5});c.labelValue(M+w3,y,w3,22,'Inscrição estadual do subst. trib.', '',{valueSize:5.5});c.labelValue(M+w3*2,y,w3,22,'CNPJ / CPF',fmtDoc(d.issuer.doc),{valueSize:5.5});y+=22;
  c.text(M,y+2,'DESTINATÁRIO / REMETENTE',5,true);y+=9;
  c.labelValue(M,y,W-190,24,'Nome / Razão social',d.dest.name,{valueSize:6});c.labelValue(M+W-190,y,190,24,'CNPJ / CPF',fmtDoc(d.dest.doc),{valueSize:6});y+=24;
  c.labelValue(M,y,310,24,'Endereço',d.dest.street,{valueSize:5.6});c.labelValue(M+310,y,115,24,'Bairro / Distrito',d.dest.district,{valueSize:5.6});c.labelValue(M+425,y,W-425,24,'CEP',fmtCep(d.dest.cep),{valueSize:5.6});y+=24;
  c.labelValue(M,y,185,24,'Município',d.dest.city,{valueSize:5.8});c.labelValue(M+185,y,55,24,'UF',d.dest.uf,{valueSize:5.8});c.labelValue(M+240,y,120,24,'Fone / Fax',fmtPhone(d.dest.phone),{valueSize:5.2});c.labelValue(M+360,y,115,24,'Inscrição estadual',d.dest.ie,{valueSize:5.2});c.labelValue(M+475,y,W-475,24,'Data da emissão',dateOnlyBr(d.issueDate),{valueSize:5.2});y+=24;
  c.text(M,y+2,'FATURA / DUPLICATAS',5,true);y+=9;
  const dup=d.dups.slice(0,8);const cols=Math.max(1,dup.length||1);const cw=W/cols;if(dup.length){dup.forEach((p,i)=>{c.rect(M+i*cw,y,cw,27);c.text(M+i*cw+2,y+2,`Nº ${p.n||i+1}`,4.2);if(p.venc)c.text(M+i*cw+2,y+9,`Venc.: ${dateOnlyBr(p.venc)}`,4.2);c.text(M+i*cw+2,y+17,`Valor: ${brl(p.valor)}`,4.8,true);});}else{c.rect(M,y,W,27);c.text(M+3,y+9,'Sem duplicatas informadas no XML.',5.2);}y+=27;
  c.text(M,y+2,'CÁLCULO DO IMPOSTO',5,true);y+=9;
  const taxes1=[['Base de cálculo do ICMS',d.total.vBC],['Valor do ICMS',d.total.vICMS],['Base cálculo ICMS ST',d.total.vBCST],['Valor do ICMS ST',d.total.vST],['Valor total dos produtos',d.total.vProd]];
  const cw5=W/5;taxes1.forEach((a,i)=>c.labelValue(M+i*cw5,y,cw5,25,a[0],brl(a[1]),{valueSize:5.7,align:'right'}));y+=25;
  const taxes2=[['Valor do frete',d.total.vFrete],['Valor do seguro',d.total.vSeg],['Desconto',d.total.vDesc],['Outras despesas',d.total.vOutro],['Valor do IPI',d.total.vIPI],['Valor total da nota',d.total.vNF]];const cw6=W/6;taxes2.forEach((a,i)=>c.labelValue(M+i*cw6,y,cw6,25,a[0],brl(a[1]),{valueSize:5.5,align:'right'}));y+=25;
  c.text(M,y+2,'TRANSPORTADOR / VOLUMES TRANSPORTADOS',5,true);y+=9;
  c.labelValue(M,y,235,23,'Razão social',d.transport.name||'',{valueSize:5.2});c.labelValue(M+235,y,70,23,'Frete por conta',d.transport.modFrete==='9'?'9 - Sem frete':d.transport.modFrete,{valueSize:4.7});c.labelValue(M+305,y,80,23,'Código ANTT','',{valueSize:5});c.labelValue(M+385,y,75,23,'Placa do veículo',d.transport.plate,{valueSize:5});c.labelValue(M+460,y,35,23,'UF',d.transport.plateUf,{valueSize:5});c.labelValue(M+495,y,W-495,23,'CNPJ / CPF',fmtDoc(d.transport.doc),{valueSize:4.8});y+=23;
  c.labelValue(M,y,260,23,'Endereço',d.transport.addr,{valueSize:5});c.labelValue(M+260,y,130,23,'Município',d.transport.city,{valueSize:5});c.labelValue(M+390,y,40,23,'UF',d.transport.uf,{valueSize:5});c.labelValue(M+430,y,W-430,23,'Inscrição estadual',d.transport.ie,{valueSize:5});y+=23;
  const v=[['Quantidade',d.transport.qVol],['Espécie',d.transport.esp],['Marca',d.transport.marca],['Numeração',d.transport.nVol],['Peso bruto',d.transport.pesoB],['Peso líquido',d.transport.pesoL]];v.forEach((a,i)=>c.labelValue(M+i*cw6,y,cw6,23,a[0],a[1],{valueSize:5}));y+=23;
  c.text(M,y+2,'DADOS DOS PRODUTOS / SERVIÇOS',5,true);y+=9;
  const colsI=[28,160,38,24,25,20,34,47,47,35,35,27,27.28];
  const heads=['CÓD. PROD.','DESCRIÇÃO DOS PRODUTOS','NCM/SH','CST','CFOP','UN','QTD.','V. UNIT.','V. TOTAL','BC ICMS','V. ICMS','ALÍQ. ICMS','ALÍQ. IPI'];
  let x=M;c.rect(M,y,W,15);heads.forEach((h,i)=>{if(i)c.line(x,y,x,y+15,.3);const hs=c.fit(h,3.7,colsI[i]-2,2.8);c.text(x+1,y+4,h,hs,true,'center',colsI[i]-2);x+=colsI[i];});y+=15;
  const rowH=17;const maxRows=Math.min(d.items.length,11);for(let r=0;r<maxRows;r++){const it=d.items[r];x=M;c.rect(M,y,W,rowH);const vals=[it.cProd,it.xProd,it.ncm,'',it.cfop,it.u,it.q,brl(it.vu),brl(it.vt),it.vbc?brl(it.vbc):'0,00',it.vicms?brl(it.vicms):'0,00',it.picms||'',it.pipi||''];vals.forEach((val,i)=>{if(i)c.line(x,y,x,y+rowH,.25);const align=i>=6?'right':(i===1?'left':'center');const baseSize=i===1?4.3:3.8;const sz=c.fit(String(val??''),baseSize,colsI[i]-2,2.8);c.text(x+1,y+4,val,sz,false,align,colsI[i]-2);x+=colsI[i];});y+=rowH;}
  if(d.items.length>maxRows){c.rect(M,y,W,14);c.text(M+3,y+4,`+ ${d.items.length-maxRows} item(ns) não exibido(s) nesta primeira versão do DANFE. Consulte o XML original para a relação completa.`,4.4,true);y+=14;}
  const bottomTarget=PAGE_H-155;if(y<bottomTarget)y=bottomTarget;
  c.text(M,y+2,'CÁLCULO DO ISSQN',5,true);y+=9;
  c.labelValue(M,y,W/3,24,'Inscrição municipal',d.issuer.im||'',{valueSize:5});c.labelValue(M+W/3,y,W/3,24,'Valor total dos serviços',brl(d.issqn.vServ),{valueSize:5,align:'right'});c.labelValue(M+2*W/3,y,W/3,24,'Base de cálculo do ISSQN',brl(d.issqn.vBC),{valueSize:5,align:'right'});y+=24;
  c.text(M,y+2,'DADOS ADICIONAIS',5,true);y+=9;
  const left=W*0.72;c.rect(M,y,left,60);c.rect(M+left,y,W-left,60);c.text(M+3,y+2,'INFORMAÇÕES COMPLEMENTARES',4);const info=c.wrap(d.additional,4.5,left-8,7);info.forEach((ln,i)=>c.text(M+3,y+10+i*6,ln,4.5));c.text(M+left+3,y+2,'RESERVADO AO FISCO',4);const rf=c.wrap(d.reserved,4.5,W-left-8,7);rf.forEach((ln,i)=>c.text(M+left+3,y+10+i*6,ln,4.5));
  c.text(M,y+66,'Ariana ERP - DANFE reconstruído a partir do XML autorizado. O XML é o documento fiscal eletrônico original.',4.2,false,'center',W);
  if(d.status==='canceled')c.text(M+120,420,'NF-e CANCELADA',32,true,'center',W-240);
  return buildPdf(c.stream());
}

export function createErpDanfeService(){return{generate(document){if(!document?.xml)throw Object.assign(new Error('XML não disponível para gerar o DANFE.'),{statusCode:404,code:'ERP_DANFE_XML_NOT_FOUND'});return drawDanfe(document)}}}
export {parseDanfe,drawDanfe};
export default createErpDanfeService;
