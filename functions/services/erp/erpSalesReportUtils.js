const clean=(v='')=>String(v??'').trim();
const norm=v=>clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const digits=v=>clean(v).replace(/\D/g,'');
const cents=v=>Math.round(Number(v||0)*100);
const rank={orcamento:0,pedido:1,venda:2,faturado:3};

export function orderSaleDate(order={}){
  return order?.televendas?.erp?.saleDate || order?.saleDate || order?.createdAt || order?.updatedAt || null;
}

function dayKey(value){
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return'';
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function itemFingerprint(items=[]){
  return (Array.isArray(items)?items:[])
    .map(i=>[
      clean(i.productId||i.sku||norm(i.name||i.description||'')),
      Number(i.qty??i.quantity??0),
      cents(i.totalPrice??i.subtotal??0)
    ].join(':'))
    .sort()
    .join('|');
}

function orderSignature(order={}){
  const identity=digits(order.customerCpf)||norm(order.customerName||'Consumidor');
  const date=dayKey(orderSaleDate(order));
  const total=cents(order.total);
  const items=itemFingerprint(order.items);
  const payment=norm(order.payment?.method||'');
  const seller=norm(order?.televendas?.erp?.sellerName||order.sellerName||order.operatorName||'');
  if(!identity||!date||!Number.isFinite(total)||!items)return'';
  return [date,identity,total,items,payment,seller].join('::');
}

/**
 * Alguns registros antigos do fluxo de vendas ficaram gravados em mais de um estágio
 * (ex.: pedido + faturado) para a mesma compra. O relatório deve exibir a compra uma vez,
 * sem apagar nenhum registro do banco.
 *
 * A deduplicação só ocorre quando a assinatura comercial é idêntica E os estágios são
 * diferentes. Duas vendas independentes no mesmo estágio continuam sendo preservadas.
 */
export function dedupeCurrentOrders(input=[]){
  const orders=Array.isArray(input)?input:[];
  const groups=new Map();
  const passthrough=[];

  for(const order of orders){
    const sig=orderSignature(order);
    if(!sig){passthrough.push(order);continue}
    if(!groups.has(sig))groups.set(sig,[]);
    groups.get(sig).push(order);
  }

  const kept=[...passthrough];
  let suppressed=0;

  for(const group of groups.values()){
    if(group.length<=1){kept.push(...group);continue}
    const statuses=new Set(group.map(o=>clean(o.status).toLowerCase()));
    if(statuses.size<=1){
      kept.push(...group);
      continue;
    }

    const highest=Math.max(...group.map(o=>rank[clean(o.status).toLowerCase()]??0));
    const winners=group.filter(o=>(rank[clean(o.status).toLowerCase()]??0)===highest);
    kept.push(...winners);
    suppressed+=group.length-winners.length;
  }

  kept.sort((a,b)=>new Date(orderSaleDate(b)||0)-new Date(orderSaleDate(a)||0));
  return{orders:kept,suppressed};
}

export default{orderSaleDate,dedupeCurrentOrders};
