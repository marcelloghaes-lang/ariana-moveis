const PAGE_W=595.28,PAGE_H=841.89;
const L=35.44,R=564.02,W=R-L;
const clean=s=>String(s??'').replace(/\s+/g,' ').trim();
const escPdf=s=>clean(s).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
const num=v=>{const n=Number(String(v??'').replace(',','.'));return Number.isFinite(n)?n:0};
const money=v=>num(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const brl=v=>`R$ ${money(v)}`;
const qty=v=>num(v).toLocaleString('pt-BR',{minimumFractionDigits:3,maximumFractionDigits:4});
const digits=s=>String(s??'').replace(/\D/g,'');
const fmtDoc=s=>{const d=digits(s);if(d.length===14)return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5');if(d.length===11)return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/,'$1.$2.$3-$4');return clean(s)};
const fmtCep=s=>{const d=digits(s);return d.length===8?d.replace(/^(\d{5})(\d{3})$/,'$1-$2'):clean(s)};
const fmtPhone=s=>{const d=digits(s);if(d.length===11)return d.replace(/^(\d{2})(\d{5})(\d{4})$/,'($1) $2-$3');if(d.length===10)return d.replace(/^(\d{2})(\d{4})(\d{4})$/,'($1) $2-$3');return clean(s)};
const keyGroups=s=>digits(s).replace(/(.{4})/g,'$1 ').trim();
const dateOnlyBr=v=>{if(!v)return'';const d=new Date(v);return Number.isNaN(d.getTime())?clean(v):d.toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'})};
const timeBr=v=>{if(!v)return'';const d=new Date(v);return Number.isNaN(d.getTime())?'':d.toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',second:'2-digit'})};
const dateTimeCompact=v=>{if(!v)return'';const d=new Date(v);return Number.isNaN(d.getTime())?clean(v):`${d.toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'})} ${d.toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',second:'2-digit'})}`};

const CODE128=['212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212','112232','122132','122231','113222','123122','123221','223211','221132','221231','213212','223112','312131','311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321','112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121','313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111','314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114','122411','142112','142211','241211','221114','413111','241112','134111','111242','121142','121241','114212','124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113','114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112'];
function code128Values(key){const d=digits(key);if(!/^\d{2,}$/.test(d)||d.length%2)return[];const vals=[105];for(let i=0;i<d.length;i+=2)vals.push(Number(d.slice(i,i+2)));let sum=105;for(let i=1;i<vals.length;i++)sum+=vals[i]*i;vals.push(sum%103,106);return vals}
function jpegSize(buf){if(!Buffer.isBuffer(buf)||buf.length<4||buf[0]!==0xff||buf[1]!==0xd8)return null;let i=2;while(i<buf.length){if(buf[i]!==0xff){i++;continue}const marker=buf[i+1];if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker))return{height:buf.readUInt16BE(i+5),width:buf.readUInt16BE(i+7)};const len=buf.readUInt16BE(i+2);if(!len)break;i+=2+len}return null}

export class Canvas{
  constructor(){this.ops=[]}
  width(s,size,bold=false){return clean(s).length*size*(bold?.50:.47)}
  truncate(s,size,maxW,bold=false){let value=clean(s);if(!maxW||this.width(value,size,bold)<=maxW)return value;const suffix='...';while(value&&this.width(value+suffix,size,bold)>maxW)value=value.slice(0,-1);return value?value+suffix:''}
  line(x1,y1,x2,y2,w=.42,dash=null){this.ops.push(dash?`[${dash.join(' ')}] 0 d`:'[] 0 d');this.ops.push(`0 G ${w} w ${x1.toFixed(2)} ${(PAGE_H-y1).toFixed(2)} m ${x2.toFixed(2)} ${(PAGE_H-y2).toFixed(2)} l S`)}
  rect(x,y,w,h,lw=.42){this.ops.push(`[] 0 d 0 G ${lw} w ${x.toFixed(2)} ${(PAGE_H-y-h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`)}
  roundRect(x,y,w,h,r=2.55,lw=.42){
    const k=.5522847498,xb=x,yb=PAGE_H-y-h,rr=Math.min(r,w/2,h/2),x2=x+w,y2=yb+h;
    this.ops.push('[] 0 d');
    this.ops.push(`0 G ${lw} w ${(xb+rr).toFixed(2)} ${yb.toFixed(2)} m ${(x2-rr).toFixed(2)} ${yb.toFixed(2)} l ${(x2-rr+k*rr).toFixed(2)} ${yb.toFixed(2)} ${x2.toFixed(2)} ${(yb+rr-k*rr).toFixed(2)} ${x2.toFixed(2)} ${(yb+rr).toFixed(2)} c ${x2.toFixed(2)} ${(y2-rr).toFixed(2)} l ${x2.toFixed(2)} ${(y2-rr+k*rr).toFixed(2)} ${(x2-rr+k*rr).toFixed(2)} ${y2.toFixed(2)} ${(x2-rr).toFixed(2)} ${y2.toFixed(2)} c ${(xb+rr).toFixed(2)} ${y2.toFixed(2)} l ${(xb+rr-k*rr).toFixed(2)} ${y2.toFixed(2)} ${xb.toFixed(2)} ${(y2-rr+k*rr).toFixed(2)} ${xb.toFixed(2)} ${(y2-rr).toFixed(2)} c ${xb.toFixed(2)} ${(yb+rr).toFixed(2)} l ${xb.toFixed(2)} ${(yb+rr-k*rr).toFixed(2)} ${(xb+rr-k*rr).toFixed(2)} ${yb.toFixed(2)} ${(xb+rr).toFixed(2)} ${yb.toFixed(2)} c S`);
  }
  text(x,y,s,size=6.38,bold=false,align='left',maxW=null){s=clean(s);if(!s)return;if(maxW)s=this.truncate(s,size,maxW,bold);if(!s)return;let xx=x;if(maxW){const ww=this.width(s,size,bold);if(align==='center')xx=x+(maxW-ww)/2;else if(align==='right')xx=x+maxW-ww}const clip=maxW?`q ${x.toFixed(2)} 0 ${maxW.toFixed(2)} ${PAGE_H.toFixed(2)} re W n `:'';this.ops.push(`${clip}BT /${bold?'F2':'F1'} ${size.toFixed(2)} Tf 1 0 0 1 ${xx.toFixed(2)} ${(PAGE_H-y-size).toFixed(2)} Tm (${escPdf(s)}) Tj ET${maxW?' Q':''}`)}
  richText(x,y,segments,size=7.2,maxW=null){let xx=x;const limit=maxW?x+maxW:Infinity;for(const seg of segments){let s=clean(seg.text);if(!s)continue;const bold=!!seg.bold;const rem=limit-xx;if(rem<=0)break;s=this.truncate(s,size,rem,bold);if(!s)break;this.text(xx,y,s,size,bold,'left',rem);xx+=this.width(s,size,bold)}}
  fit(s,size,maxW,min=3.1,bold=false){let z=size;while(z>min&&this.width(s,z,bold)>maxW)z-=.2;return z}
  wrap(s,size,maxW,maxLines=2,bold=false){const words=clean(s).split(' ').filter(Boolean),lines=[];let cur='';for(const word of words){const test=cur?`${cur} ${word}`:word;if(this.width(test,size,bold)<=maxW)cur=test;else{if(cur)lines.push(cur);cur=word;if(lines.length>=maxLines-1)break}}if(cur&&lines.length<maxLines)lines.push(this.truncate(cur,size,maxW,bold));return lines}
  labelValue(x,y,w,h,label,value,{valueSize=9.6,bold=true,align='left',round=true}={}){(round?this.roundRect(x,y,w,h):this.rect(x,y,w,h));this.text(x+2,y+1.3,label,6.05,false,'left',w-4);const sz=this.fit(value,valueSize,w-4,4.6,bold);this.text(x+2,y+8.3,value,sz,bold,align,w-4)}
  barcode(x,y,w,h,key){const vals=code128Values(key);if(!vals.length)return;let units=20;for(const v of vals)units+=CODE128[v].split('').reduce((a,b)=>a+Number(b),0);const scale=w/units;let cx=x+10*scale;for(const v of vals){const p=CODE128[v];let black=true;for(const ch of p){const ww=Number(ch)*scale;if(black)this.ops.push(`0 g ${cx.toFixed(2)} ${(PAGE_H-y-h).toFixed(2)} ${ww.toFixed(2)} ${h.toFixed(2)} re f`);cx+=ww;black=!black}}}
  image(x,y,w,h){this.ops.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${(PAGE_H-y-h).toFixed(2)} cm /Im1 Do Q`)}
  stream(){return this.ops.join('\n')}
}

export function buildPdf(content,jpeg){
  const stream=Buffer.from(content,'latin1'),imageInfo=jpegSize(jpeg),hasImage=Boolean(jpeg&&imageInfo),objs=[];
  const add=b=>objs.push(Buffer.isBuffer(b)?b:Buffer.from(b,'latin1'));
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  const xobj=hasImage?' /XObject << /Im1 7 0 R >>':'';
  add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >>${xobj} >> /Contents 4 0 R >>`);
  add(Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`,'latin1'),stream,Buffer.from('\nendstream','latin1')]));
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>');
  if(hasImage)add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${imageInfo.width} /Height ${imageInfo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,'latin1'),jpeg,Buffer.from('\nendstream','latin1')]));
  const parts=[Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n','binary')],offsets=[0];let offset=parts[0].length;
  objs.forEach((o,i)=>{offsets[i+1]=offset;const h=Buffer.from(`${i+1} 0 obj\n`,'latin1'),f=Buffer.from('\nendobj\n','latin1');parts.push(h,o,f);offset+=h.length+o.length+f.length});
  const xref=offset;let xr=`xref\n0 ${objs.length+1}\n0000000000 65535 f \n`;for(let i=1;i<=objs.length;i++)xr+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';xr+=`trailer\n<< /Size ${objs.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;parts.push(Buffer.from(xr,'latin1'));return Buffer.concat(parts)
}


export {clean,money,brl,qty,digits,fmtDoc,fmtCep,fmtPhone,keyGroups,dateOnlyBr,timeBr,dateTimeCompact,jpegSize};
