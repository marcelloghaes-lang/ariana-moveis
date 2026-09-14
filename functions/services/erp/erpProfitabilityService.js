const clean=(v='',m=500)=>String(v??'').trim().slice(0,m);
const money=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
const arr=v=>Array.isArray(v)?v:[];
function fail(message,statusCode=400,code='ERP_PROFITABILITY_ERROR'){const e=new Error(message);e.statusCode=statusCode;e.code=code;return e}
function period(q={}){const now=new Date(),from=q.from?new Date(q.from):new Date(now.getFullYear(),0,1),to=q.to?new Date(q.to):new Date();if(Number.isNaN(from.getTime())||Number.isNaN(to.getTime()))throw fail('Período inválido.',400,'INVALID_PERIOD');from.setHours(0,0,0,0);to.setHours(23,59,59,999);return{from,to}}
function actorName(a={}){return clean(a.name||a.email||'Administrador',160)}
function objectId(Product,id){try{return new Product.db.base.Types.ObjectId(id)}catch{return null}}

export function createErpProfitabilityService(context={}){
  const {Order,Product}=context;
  if(!Order||!Product)throw new Error('[erp-profitability] Order/Product não informados');

  async function listCosts(q={}){
    const text=clean(q.q||q.search,160),filter={};
    if(text){const rx=new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i');filter.$or=[{name:rx},{sku:rx},{brand:rx},{category:rx},{categoryName:rx}]}
    const docs=await Product.collection.find(filter).sort({name:1}).limit(10000).toArray();
    const products=docs.map(p=>({id:String(p._id),name:p.name||'',sku:p.sku||'',brand:p.brand||'',category:p.categoryName||p.category||'',salePrice:money(p.price),stock:Number(p.stock||0),costPrice:p.costPrice===null||p.costPrice===undefined?null:money(p.costPrice),costStatus:p.costStatus||((p.costPrice===null||p.costPrice===undefined)?'missing':'final'),costSource:p.costSource||'',costPurchaseNumber:p.costPurchaseNumber||'',costUpdatedAt:p.costUpdatedAt||null,costUpdatedBy:p.costUpdatedBy||'',costNotes:p.costNotes||'',hasCost:p.costPrice!==null&&p.costPrice!==undefined&&Number(p.costPrice)>=0}));
    return{summary:{products:products.length,withCost:products.filter(p=>p.hasCost).length,withoutCost:products.filter(p=>!p.hasCost).length,provisional:products.filter(p=>p.costStatus==='provisional').length,final:products.filter(p=>p.hasCost&&p.costStatus!=='provisional').length},products};
  }

  async function setCost(productId,payload={},actor={}){
    const oid=objectId(Product,productId);if(!oid)throw fail('Produto inválido.',400,'INVALID_PRODUCT_ID');
    const current=await Product.collection.findOne({_id:oid});if(!current)throw fail('Produto não encontrado.',404,'PRODUCT_NOT_FOUND');
    const stamp=new Date(),by=actorName(actor);let set;
    if(payload.costPrice===null||payload.costPrice==='')set={costPrice:null,costStatus:'missing',costSource:'',costNotes:'',costUpdatedAt:stamp,costUpdatedBy:by};
    else{const cost=Number(payload.costPrice);if(!Number.isFinite(cost)||cost<0)throw fail('Informe um custo válido maior ou igual a zero.',400,'INVALID_COST');set={costPrice:money(cost),costStatus:'final',costSource:clean(payload.costSource||'manual',40),costNotes:clean(payload.costNotes||'',500),costUpdatedAt:stamp,costUpdatedBy:by};}
    await Product.collection.updateOne({_id:oid},{$set:set});
    return{id:String(current._id),name:current.name||'',...set};
  }

  async function report(q={}){
    const {from,to}=period(q);
    const orders=await Order.find({origin:'erp_ariana',status:'faturado',updatedAt:{$gte:from,$lte:to}}).sort({updatedAt:-1}).limit(20000).lean();
    const ids=[...new Set(orders.flatMap(o=>arr(o.items).map(i=>String(i.productId||'')).filter(Boolean)))],oids=ids.map(id=>objectId(Product,id)).filter(Boolean);
    const products=oids.length?await Product.collection.find({_id:{$in:oids}},{projection:{name:1,sku:1,costPrice:1,costStatus:1,costPurchaseNumber:1,costUpdatedAt:1}}).toArray():[];
    const pmap=new Map(products.map(p=>[String(p._id),p]));
    const productMap=new Map(),sellerMap=new Map();
    const sales=[];let totalRevenue=0,knownRevenue=0,knownCost=0,knownProfit=0,items=0,itemsWithCost=0,provisionalItems=0,ordersComplete=0,ordersWithProvisionalCost=0;
    for(const o of orders){
      const seller=o.televendas?.erp?.sellerName||o.sellerName||'Sem vendedor';let orderRevenue=0,orderCost=0,orderKnownRevenue=0,orderItems=0,knownItems=0,orderProvisional=0;
      for(const i of arr(o.items)){
        const qty=Math.max(0,Number(i.qty||i.quantity||0)),revenue=money(Number(i.totalPrice??i.subtotal??(Number(i.unitPrice||i.price||0)*qty)||0));
        const p=pmap.get(String(i.productId||'')),hasCost=!!p&&p.costPrice!==null&&p.costPrice!==undefined&&Number.isFinite(Number(p.costPrice)),provisional=hasCost&&p.costStatus==='provisional',cost=hasCost?money(Number(p.costPrice)*qty):null,profit=hasCost?money(revenue-cost):null;
        items+=qty;orderItems+=qty;totalRevenue+=revenue;orderRevenue+=revenue;
        if(hasCost){itemsWithCost+=qty;knownItems+=qty;knownRevenue+=revenue;orderKnownRevenue+=revenue;knownCost+=cost;orderCost+=cost;knownProfit+=profit;if(provisional){provisionalItems+=qty;orderProvisional+=qty}}
        const key=String(i.productId||i.sku||i.name||'produto'),x=productMap.get(key)||{productId:String(i.productId||''),name:i.name||p?.name||'Produto',sku:i.sku||p?.sku||'',qty:0,revenue:0,cost:0,profit:0,knownQty:0,knownRevenue:0,provisionalQty:0,missingQty:0};x.qty+=qty;x.revenue+=revenue;if(hasCost){x.cost+=cost;x.profit+=profit;x.knownQty+=qty;x.knownRevenue+=revenue;if(provisional)x.provisionalQty+=qty}else x.missingQty+=qty;productMap.set(key,x);
      }
      const complete=orderItems>0&&knownItems>=orderItems-0.0001;if(complete)ordersComplete++;if(orderProvisional>0)ordersWithProvisionalCost++;
      const margin=orderKnownRevenue?money((orderKnownRevenue-orderCost)/orderKnownRevenue*100):null;
      sales.push({id:String(o._id),code:o.televendas?.erp?.code||'',date:o.updatedAt,customerName:o.customerName||'Consumidor',sellerName:seller,revenue:money(orderRevenue),knownRevenue:money(orderKnownRevenue),cost:money(orderCost),profit:money(orderKnownRevenue-orderCost),margin,completeCost:complete,provisionalCost:orderProvisional>0,items:orderItems,knownItems});
      const s=sellerMap.get(seller)||{sellerName:seller,orders:0,revenue:0,knownRevenue:0,cost:0,profit:0,completeOrders:0,provisionalOrders:0};s.orders++;s.revenue+=orderRevenue;s.knownRevenue+=orderKnownRevenue;s.cost+=orderCost;s.profit+=orderKnownRevenue-orderCost;if(complete)s.completeOrders++;if(orderProvisional>0)s.provisionalOrders++;sellerMap.set(seller,s);
    }
    const productRanking=[...productMap.values()].map(x=>({...x,revenue:money(x.revenue),knownRevenue:money(x.knownRevenue),cost:money(x.cost),profit:money(x.profit),margin:x.knownRevenue?money(x.profit/x.knownRevenue*100):null,costCoverage:x.qty?money(x.knownQty/x.qty*100):0,hasProvisionalCost:x.provisionalQty>0})).sort((a,b)=>b.profit-a.profit);
    const sellerRanking=[...sellerMap.values()].map(x=>({...x,revenue:money(x.revenue),knownRevenue:money(x.knownRevenue),cost:money(x.cost),profit:money(x.profit),margin:x.knownRevenue?money(x.profit/x.knownRevenue*100):null,costCoverage:x.orders?money(x.completeOrders/x.orders*100):0})).sort((a,b)=>b.profit-a.profit);
    return{period:{from,to},summary:{orders:orders.length,ordersComplete,ordersWithProvisionalCost,totalRevenue:money(totalRevenue),knownRevenue:money(knownRevenue),knownCost:money(knownCost),knownProfit:money(knownProfit),knownMargin:knownRevenue?money(knownProfit/knownRevenue*100):null,items:money(items),itemsWithCost:money(itemsWithCost),provisionalItems:money(provisionalItems),coverage:items?money(itemsWithCost/items*100):0,method:'current_product_cost'},productRanking,sellerRanking,sales:sales.slice(0,5000),notes:['A rentabilidade considera somente itens cujo produto possui custo de aquisição cadastrado.','Custos marcados como provisórios entram no cálculo, mas o relatório sinaliza que ainda aguardam conferência contábil.','Para vendas já faturadas, o cálculo usa o custo atual cadastrado do produto e identifica a cobertura do custo; não inventa custo histórico.','Vendas importadas do SIGE sem vínculo confiável entre item e custo não entram no cálculo de margem.']};
  }
  return{listCosts,setCost,report};
}
export default createErpProfitabilityService;
