const clean=(v='',m=500)=>String(v??'').trim().slice(0,m);

function itemName(item={}){
  return clean(
    item.name||
    item.productName||
    item.title||
    item.descricao||
    item.description||
    item.product?.name||
    item.product?.title||
    '',
    220
  );
}

export function historicalSaleProduct(sale={}){
  const live=sale?.metadata?.sigeLive||{};
  const sourceItems=(Array.isArray(live?.items)&&live.items.length)?live.items:(Array.isArray(sale?.items)?sale.items:[]);
  const names=sourceItems.map(itemName).filter(Boolean);
  if(names.length)return [...new Set(names)].slice(0,4).join(' + ');
  return clean(live?.description||sale?.description||sale?.metadata?.description||'',500);
}

export function historicalInstallmentTotal(sale={}){
  const live=sale?.metadata?.sigeLive||{};
  const payments=Array.isArray(live?.payments)?live.payments:[];
  const candidates=[
    live?.numberOfInstallments,
    payments[0]?.installments,
    sale?.numberOfInstallments
  ].map(Number).filter(n=>Number.isFinite(n)&&n>0);
  return candidates.length?Math.max(...candidates):0;
}

export function historicalInstallmentLabel(currentId='',rows=[],originalTotal=0){
  const ordered=(Array.isArray(rows)?rows:[])
    .filter(row=>row&&String(row.direction||'receivable')==='receivable')
    .slice()
    .sort((a,b)=>{
      const ad=new Date(a?.dueAt||a?.competenceAt||a?.createdAt||0).getTime()||0;
      const bd=new Date(b?.dueAt||b?.competenceAt||b?.createdAt||0).getTime()||0;
      if(ad!==bd)return ad-bd;
      return String(a?._id||a?.id||'').localeCompare(String(b?._id||b?.id||''));
    });
  if(!ordered.length)return'';
  const id=String(currentId||'');
  const index=ordered.findIndex(row=>String(row?._id||row?.id||'')===id);
  if(index<0)return'';
  const total=Math.max(0,Number(originalTotal||0))||ordered.length;
  const number=Math.min(index+1,total);
  return `${String(number).padStart(2,'0')}/${String(total).padStart(2,'0')}`;
}

export default {historicalSaleProduct,historicalInstallmentTotal,historicalInstallmentLabel};
