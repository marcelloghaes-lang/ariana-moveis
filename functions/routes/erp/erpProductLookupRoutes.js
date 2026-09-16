import express from 'express';
import { createErpProductService } from '../../services/erp/erpProductService.js';

const clean=(v='',m=500)=>String(v??'').trim().slice(0,m);
const digits=(v='')=>String(v??'').replace(/\D/g,'');
const money=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
const normalize=v=>clean(v,500).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();

const ACCENT={
  a:'[aáàâãäå]',e:'[eéèêë]',i:'[iíìîï]',o:'[oóòôõö]',u:'[uúùûü]',c:'[cç]',n:'[nñ]'
};
function searchPattern(value=''){
  const base=normalize(value);
  let out='';
  for(const ch of base){
    if(ACCENT[ch])out+=ACCENT[ch];
    else if(/[a-z0-9]/.test(ch))out+=ch;
    else if(/\s|[-_.\/]/.test(ch))out+='[\\s\\-_.\\/]*';
    else out+='\\'+ch;
  }
  return out;
}
function fiscalFrom(specs={}){
  return{
    ncm:digits(specs.ncm).slice(0,8),cest:digits(specs.cest).slice(0,7),cfop:digits(specs.cfop).slice(0,4),
    unit:clean(specs.unit||specs.unidade||'UN',10).toUpperCase(),origin:clean(specs.productOrigin??specs.origin??'',2),
    csosn:digits(specs.csosn||specs.icmsCsosn).slice(0,3),icmsCst:digits(specs.icmsCst||specs.cstIcms).slice(0,3),
    pisCst:digits(specs.pisCst||specs.cstPis).slice(0,2),cofinsCst:digits(specs.cofinsCst||specs.cstCofins).slice(0,2),
    ean:digits(specs.ean||specs.barcode||specs.gtin).slice(0,14)
  };
}
function present(p={}){
  const specs=p.specs||{},cost=p.costPrice===null||p.costPrice===undefined?null:money(p.costPrice),price=money(p.price),profit=cost===null?null:money(price-cost),margin=cost===null||price<=0?null:money((profit/price)*100);
  return{
    id:String(p._id||p.id||''),name:p.name||'',sku:p.sku||p.code||p.codigo||'',description:p.description||'',brand:p.brand||'',
    category:p.categoryName||p.category||'',price,pixPrice:Number(p.pixPrice??p.price??0),costPrice:cost,
    costStatus:p.costStatus||((cost===null)?'missing':'final'),costSource:p.costSource||'',costNotes:p.costNotes||'',costUpdatedAt:p.costUpdatedAt||null,
    grossProfitUnit:profit,grossMarginPct:margin,stock:Number(p.stock||0),active:p.active!==false,
    image:p.imageUrl||p.mainImageUrl||p.image||p.imagem||'',sellerId:p.sellerId||'',sellerName:p.sellerName||'',specs,fiscal:fiscalFrom(specs)
  };
}
function rank(p,q){
  const needle=normalize(q),ean=digits(p?.specs?.ean||p?.specs?.barcode||p?.specs?.gtin||p?.barcode||''),sku=normalize(p?.sku||p?.code||p?.codigo||''),name=normalize(p?.name||'');
  if(!needle)return 99;
  if(name===needle||sku===needle||ean===digits(q))return 0;
  if(name.startsWith(needle)||sku.startsWith(needle)||ean.startsWith(digits(q)))return 1;
  if(name.includes(needle)||sku.includes(needle)||ean.includes(digits(q)))return 2;
  return 3;
}

export default function createErpProductLookupRoutes(context={}){
  const router=express.Router();
  if(!context.Product)throw new Error('[erp-product-lookup] Product não informado');
  if(!context.adminRequired)throw new Error('[erp-product-lookup] adminRequired não informado');
  const productService=createErpProductService(context);

  router.get('/erp/products',context.adminRequired,async(req,res)=>{
    try{
      const q=clean(req.query?.q||req.query?.search||'',140);
      const limit=Math.min(100,Math.max(1,Number(req.query?.limit||40)));
      const filter={};
      if(req.query?.includeInactive!=='1')filter.active={$ne:false};
      if(q){
        const rx=new RegExp(searchPattern(q),'i');
        filter.$or=[
          {name:rx},{sku:rx},{code:rx},{codigo:rx},{brand:rx},{category:rx},{categoryName:rx},{description:rx},{barcode:rx},
          {'specs.ean':rx},{'specs.barcode':rx},{'specs.gtin':rx}
        ];
      }
      const scanLimit=Math.min(800,Math.max(limit*10,120));
      const docs=await context.Product.collection.find(filter).sort({name:1}).limit(scanLimit).toArray();
      const own=docs.filter(p=>productService.isOwnProduct(p));
      const ordered=q?own.sort((a,b)=>rank(a,q)-rank(b,q)||String(a.name||'').localeCompare(String(b.name||''),'pt-BR')):own;
      return res.json({ok:true,products:ordered.slice(0,limit).map(present)});
    }catch(error){
      console.error('[erp-product-lookup]',error);
      return res.status(Number(error?.statusCode||500)).json({ok:false,error:error?.message||'Erro ao localizar produtos.',code:error?.code||'ERP_PRODUCT_LOOKUP_ERROR'});
    }
  });

  return router;
}
