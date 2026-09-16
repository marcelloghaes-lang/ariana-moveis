import { parseDanfe } from './erpDanfeService.js';
import { Canvas,buildPdf,jpegSize } from './erpDanfeOriginalPdf.js';
import { drawReceipt,drawHeader,drawFiscalIdentification,drawRecipient,drawBilling } from './erpDanfeOriginalTop.js';
import { drawTaxes,drawTransport,drawProducts,drawBottom } from './erpDanfeOriginalBottom.js';

function withSku(parsed,doc){
  const stored=Array.isArray(doc?.items)?doc.items:[];
  if(!stored.length)return parsed;
  const byCode=new Map(stored.map(item=>[String(item?.productCode||'').trim(),String(item?.productCode||'').trim()]));
  parsed.items=(parsed.items||[]).map((item,index)=>{
    const persisted=stored[index]||{};
    const sku=String(persisted?.productCode||byCode.get(String(item?.cProd||'').trim())||'').trim();
    return {...item,sku};
  });
  return parsed;
}

function draw(doc,logoJpeg){
  const d=withSku(parseDanfe(doc),doc),hasLogo=Boolean(jpegSize(logoJpeg)),c=new Canvas();
  drawReceipt(c,d);drawHeader(c,d,hasLogo);drawFiscalIdentification(c,d);drawRecipient(c,d);
  let y=drawBilling(c,d);y=drawTaxes(c,d,y);y=drawTransport(c,d,y);const productsEnd=drawProducts(c,d,y);drawBottom(c,d,productsEnd);
  if(String(d.status||'').toLowerCase()==='canceled')c.text(120,410,'NF-e CANCELADA',32,true,'center',355);
  return buildPdf(c.stream(),hasLogo?logoJpeg:null);
}

export function createErpDanfeBrandedService(){return{generate(document,{mascotJpeg=null}={}){if(!document?.xml)throw Object.assign(new Error('XML não disponível para gerar o DANFE.'),{statusCode:404});return draw(document,mascotJpeg)}}}
export default createErpDanfeBrandedService;
