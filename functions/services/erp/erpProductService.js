const clean=(v='',m=500)=>String(v??'').trim().slice(0,m);
function normalize(v=''){return clean(v,180).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'')}
function fail(message,statusCode=400,code='ERP_PRODUCT_ERROR'){const e=new Error(message);e.statusCode=statusCode;e.code=code;return e}
export function createErpProductService(context={}){
 const {Product,toJSON}=context;if(!Product)throw new Error('[erp-products] Product não informado');
 const allowed=new Set(['ariana','ariana_moveis','arianamoveis','ariana_moveis_oficial','loja_ariana','marcelo_nunes_silva','sn','sn_digital','sndigital',...String(process.env.SIGE_ARIANA_SELLER_KEYS||process.env.ARIANA_SELLER_KEYS||'').split(',').map(normalize).filter(Boolean)]);
 function own(product={}){const values=[product.sellerId,product.sellerName].map(v=>clean(v,180)).filter(Boolean);if(!values.length)return true;return values.every(v=>{const key=normalize(v);return allowed.has(key)||(key.includes('ariana')&&key.includes('move'))})}
 const serial=d=>typeof toJSON==='function'?toJSON(d):(d?.toObject?d.toObject():d);
 async function assertItems(items=[]){if(!Array.isArray(items)||!items.length)return true;const ids=[...new Set(items.map(i=>clean(i?.productId||i?.id||i?._id||'',120)).filter(Boolean))];for(const id of ids){let p=null;try{p=await Product.findById(id)}catch{}if(!p||p.active===false)throw fail('Produto não encontrado ou inativo.',409,'PRODUCT_UNAVAILABLE');if(!own(p))throw fail(`O produto ${p.name||id} pertence a seller/fabricante externo e não pode movimentar o estoque físico da Ariana pelo ERP.`,409,'EXTERNAL_SELLER_PRODUCT')}return true}
 async function list(query={}){const limit=Math.min(100,Math.max(1,Number(query.limit||40))),q=clean(query.q||query.search||'',140),filter={active:{$ne:false}};if(q){const rx=new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i');filter.$or=[{name:rx},{sku:rx},{brand:rx},{category:rx},{categoryName:rx}]}const docs=await Product.find(filter).sort({name:1}).limit(Math.max(limit*4,120));return docs.filter(own).slice(0,limit).map(doc=>{const p=serial(doc);return{id:String(p._id||p.id),name:p.name||'',sku:p.sku||'',brand:p.brand||'',category:p.categoryName||p.category||'',price:Number(p.price||0),pixPrice:Number(p.pixPrice??p.price??0),stock:Number(p.stock||0),image:p.imageUrl||p.mainImageUrl||p.image||p.imagem||'',sellerId:p.sellerId||'',sellerName:p.sellerName||''}})}
 return{assertItems,list,isOwnProduct:own}
}
export default createErpProductService;
