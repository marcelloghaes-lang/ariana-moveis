const clean=(v='',m=500)=>String(v??'').trim().slice(0,m);
const money=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
const arr=v=>Array.isArray(v)?v:[];
function fail(message,statusCode=400,code='ERP_PROFITABILITY_ERROR'){const e=new Error(message);e.statusCode=statusCode;e.code=code;return e}
function period(q={}){const now=new Date(),from=q.from?new Date(q.from):new Date(now.getFullYear(),0,1),to=q.to?new Date(q.to):new Date();if(Number.isNaN(from.getTime())||Number.isNaN(to.getTime()))throw fail('Período inválido.',400,'INVALID_PERIOD');from.setHours(0,0,0,0);to.setHours(23,59,59,999);return{from,to}}
function actorName(a={}){return clean(a.name||a.email||'Administrador',160)}

export function createErpProfitabilityService(context={}){
  const {Order,Product}=context;
  if(!Order||!Product)throw new Error('[erp-profitability] Order/Product não informados');

  async function listCosts(q={}){
    const text=clean(q.q||q.search,160),filter={};
    if(text){const rx=new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i');filter.$or=[{name:rx},{sku:rx},{brand:rx},{category:rx},{categoryName:rx}]}
    const docs=await Product.find(filter).sort({name:1}).limit(10000).lean();
    const products=docs.map(p=>({id:String(p._id),name:p.name||'',sku:p.sku||'',brand:p.brand||'',category:p.categoryName||p.category||'',salePrice:money(p.price),stock:Number(p.stock||0),costPrice:p.costPrice===null||p.costPrice===undefined?null:money(p.costPrice),costSource:p.costSource||'',costUpdatedAt:p.costUpdatedAt||null,costUpdatedBy:p.costUpdatedBy||'',costNotes:p.costNotes||'',hasCost:p.costPrice!==null&&p.costPrice!==undefined&&Number(p.costPrice)>=0}));
    return{summary:{products:products.length,withCost:products.filter(p=>p.hasCost).length,withoutCost:products.filter(p=>!p.hasCost).length},products};
  }

  async function setCost(productId,payload={},actor={}){
    const p=await Product.findById(productId);if(!p)throw fail('Produto não encontrado.',404,'PRODUCT_NOT_FOUND');
    if(payload.costPrice===null||payload.costPrice===''){
      p.costPrice=null;p.costSource='';p.costNotes='';p.costUpdatedAt=new Date();p.costUpdatedBy=actorName(actor);
    }else{
      const cost=Number(payload.costPrice);if(!Number.isFinite(cost)||cost<0)throw fail('Informe um custo válido maior ou igual a zero.',400,'INVALID_COST');
      p.costPrice=money(cost);p.costSource=clean(payload.costSource||'manual',40);p.costNotes=clean(payload.costNotes||'',500);p.costUpdatedAt=new Date();p.costUpdatedBy=actorName(actor);
    }
    await p.save();
    return{id:String(p._id),name:p.name||'',costPrice:p.costPrice===null||p.costPrice===undefined?null:money(p.costPrice),costSource:p.costSource||'',costNotes:p.costNotes||'',costUpdatedAt:p.costUpdatedAt||null,costUpdatedBy:p.costUpdatedBy||''};
  }

  async function report(q={}){
    const {from,to}=period(q);
    const orders=await Order.find({origin:'erp_ariana',status:'faturado',updatedAt:{$gte:from,$lte:to}}).sort({updatedAt:-1}).limit(20000).lean();
    const ids=[...new Set(orders.flatMap(o=>arr(o.items).map(i=>String(i.productId||'')).filter(Boolean)))];
    const products=ids.length?await Product.find({_id:{$in:ids}}).select('_id name sku costPrice costUpdatedAt').lean():[];
    const pmap=new Map(products.map(p=>[String(p._id),p]));
    const productMap=new Map(),sellerMap=new Map();
    const sales=[];let totalRevenue=0,knownRevenue=0,knownCost=0,knownProfit=0,items=0,itemsWithCost=0,ordersComplete=0;
    for(const o of orders){
      const seller=o.televendas?.erp?.sellerName||o.sellerName||'Sem vendedor';let orderRevenue=0,orderCost=0,orderKnownRevenue=0,orderItems=0,knownItems=0;
      for(const i of arr(o.items)){
        const qty=Math.max(0,Number(i.qty||i.quantity||0)),revenue=money(Number(i.totalPrice??i.subtotal??(Number(i.unitPrice||i.price||0)*qty)||0));
        const p=pmap.get(String(i.productId||'')),hasCost=!!p&&p.costPrice!==null&&p.costPrice!==undefined&&Number.isFinite(Number(p.costPrice)),cost=hasCost?money(Number(p.costPrice)*qty):null,profit=hasCost?money(revenue-cost):null;
        items+=qty;orderItems+=qty;totalRevenue+=revenue;orderRevenue+=revenue;
        if(hasCost){itemsWithCost+=qty;knownItems+=qty;knownRevenue+=revenue;orderKnownRevenue+=revenue;knownCost+=cost;orderCost+=cost;knownProfit+=profit}
        const key=String(i.productId||i.sku||i.name||'produto'),x=productMap.get(key)||{productId:String(i.productId||''),name:i.name||p?.name||'Produto',sku:i.sku||p?.sku||'',qty:0,revenue:0,cost:0,profit:0,knownQty:0,missingQty:0};x.qty+=qty;x.revenue+=revenue;if(hasCost){x.cost+=cost;x.profit+=profit;x.knownQty+=qty}else x.missingQty+=qty;productMap.set(key,x);
      }
      const complete=orderItems>0&&knownItems>=orderItems-0.0001;if(complete)ordersComplete++;
      const margin=orderKnownRevenue?money((orderKnownRevenue-orderCost)/orderKnownRevenue*100):null;
      sales.push({id:String(o._id),code:o.televendas?.erp?.code||'',date:o.updatedAt,customerName:o.customerName||'Consumidor',sellerName:seller,revenue:money(orderRevenue),knownRevenue:money(orderKnownRevenue),cost:money(orderCost),profit:money(orderKnownRevenue-orderCost),margin,completeCost:complete,items:orderItems,knownItems});
      const s=sellerMap.get(seller)||{sellerName:seller,orders:0,revenue:0,knownRevenue:0,cost:0,profit:0,completeOrders:0};s.orders++;s.revenue+=orderRevenue;s.knownRevenue+=orderKnownRevenue;s.cost+=orderCost;s.profit+=orderKnownRevenue-orderCost;if(complete)s.completeOrders++;sellerMap.set(seller,s);
    }
    const productRanking=[...productMap.values()].map(x=>({...x,revenue:money(x.revenue),cost:money(x.cost),profit:money(x.profit),margin:x.knownQty>0&&x.revenue?money(x.profit/x.revenue*100):null,costCoverage:x.qty?money(x.knownQty/x.qty*100):0})).sort((a,b)=>b.profit-a.profit);
    const sellerRanking=[...sellerMap.values()].map(x=>({...x,revenue:money(x.revenue),knownRevenue:money(x.knownRevenue),cost:money(x.cost),profit:money(x.profit),margin:x.knownRevenue?money(x.profit/x.knownRevenue*100):null,costCoverage:x.orders?money(x.completeOrders/x.orders*100):0})).sort((a,b)=>b.profit-a.profit);
    return{period:{from,to},summary:{orders:orders.length,ordersComplete,totalRevenue:money(totalRevenue),knownRevenue:money(knownRevenue),knownCost:money(knownCost),knownProfit:money(knownProfit),knownMargin:knownRevenue?money(knownProfit/knownRevenue*100):null,items:money(items),itemsWithCost:money(itemsWithCost),coverage:items?money(itemsWithCost/items*100):0,method:'current_product_cost'},productRanking,sellerRanking,sales:sales.slice(0,5000),notes:['A rentabilidade considera somente itens cujo produto possui custo de aquisição cadastrado.','Para vendas históricas, o cálculo usa o custo atual cadastrado do produto; não é apresentado como custo histórico da venda.','Vendas do SIGE sem vínculo confiável entre item e custo não entram no cálculo de margem.']};
  }
  return{listCosts,setCost,report};
}
export default createErpProfitabilityService;
