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
  const source=(Array.isArray(rows)?rows:[])
    .filter(row=>row&&String(row.direction||'receivable')==='receivable');
  if(!source.length)return'';
  const id=String(currentId||'');
  const current=source.find(row=>String(row?._id||row?.id||'')===id);
  if(!current)return'';
  const dueKey=row=>{
    const d=new Date(row?.dueAt||row?.competenceAt||row?.createdAt||0);
    return Number.isNaN(d.getTime())?'':d.toISOString().slice(0,10);
  };
  const groups=new Map();
  for(const row of source){
    const key=dueKey(row)||String(row?._id||row?.id||'');
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(row);
  }
  const ordered=[...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0]));
  const currentKey=dueKey(current)||id;
  const index=ordered.findIndex(([key,list])=>key===currentKey||list.some(row=>String(row?._id||row?.id||'')===id));
  if(index<0)return'';
  const deduplicatedTotal=ordered.length;
  const declared=Math.max(0,Number(originalTotal||0));
  const total=declared||deduplicatedTotal;
  const number=Math.min(index+1,total);
  return `${String(number).padStart(2,'0')}/${String(total).padStart(2,'0')}`;
}

export default {historicalSaleProduct,historicalInstallmentTotal,historicalInstallmentLabel};
