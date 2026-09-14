const clean=(value='',max=500)=>String(value??'').trim().slice(0,max);

export function normalizeCommercialFields(payload={},actor={}){
 const sellerName=clean(payload.sellerName||actor.name||actor.email||'Operador',180);
 const priceTable=clean(payload.priceTable||'Preço Padrão',160)||'Preço Padrão';
 const shippingType=clean(payload.shippingType||'',80);
 const freightResponsibility=clean(payload.freightResponsibility||'',80);
 return{sellerName,priceTable,shippingType,freightResponsibility};
}

export default normalizeCommercialFields;
