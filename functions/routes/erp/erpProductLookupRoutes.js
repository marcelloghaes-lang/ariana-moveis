import express from 'express';
import { createErpProductService } from '../../services/erp/erpProductService.js';

const clean=(v='',m=500)=>String(v??'').trim().slice(0,m);
const digits=(v='')=>String(v??'').replace(/\D/g,'');
const money=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
const normalize=v=>clean(v,500).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();

const MG_ST_SOURCE={
  jurisdiction:'MG',
  chapter:'RICMS/MG 2023 - Anexo VII, Parte 2, Capítulo 21',
  reviewedAt:'2026-10-02',
  url:'https://www.fazenda.mg.gov.br/empresas/legislacao_tributaria/ricms_2023_seco/anexovii2023_6.html'
};

// Referências oficiais usadas somente para auditoria/validação.
// Nunca definimos "sem ST" só porque um NCM não aparece neste recorte.
const MG_ST_RULES=[
  {match:['73211100','73218100','73219000'],cests:['2100100'],mva:50,scope:'21.1',label:'Fogões de cozinha de uso doméstico e suas partes'},
  {match:['84181000'],cests:['2100200'],mva:40,scope:'21.1',label:'Combinações de refrigeradores e congeladores'},
  {match:['84182100'],cests:['2100300'],mva:40,scope:'21.1',label:'Refrigeradores domésticos de compressão'},
  {match:['84182900'],cests:['2100400'],mva:40,scope:'21.1',label:'Outros refrigeradores domésticos'},
  {match:['84183000'],cests:['2100500'],mva:40,scope:'21.1',label:'Freezers horizontais'},
  {match:['84184000'],cests:['2100600'],mva:45,scope:'21.1',label:'Freezers verticais'},
  {prefix:['845020'],cests:['2102200'],mva:45,scope:'21.1',label:'Máquinas de lavar roupa domésticas acima de 10 kg'},
  {match:['84501100'],cests:['2101900'],mva:45,scope:'21.1',label:'Máquinas de lavar roupa domésticas automáticas até 10 kg'},
  {match:['84501200'],cests:['2102000'],mva:45,scope:'21.1',label:'Máquinas de lavar roupa com secador centrífugo'},
  {match:['84501900'],cests:['2102100'],mva:45,scope:'21.1',label:'Outras máquinas de lavar roupa domésticas'},
  {prefix:['85287'],cests:['2106900','2107000','2107100','2107200','2107300'],mva:null,scope:'21.1/21.6',label:'Aparelhos receptores de televisão',ambiguous:true},
  {match:['85171300'],cests:['2105300','2105301'],mva:18.34,scope:'21.4',label:'Smartphones',ambiguous:true},
  {prefix:['8517143'],cests:['2105300','2105301'],mva:18.34,scope:'21.4',label:'Telefones para redes celulares / smartphones',ambiguous:true}
];
function matchMgStRule(ncm=''){
  const code=digits(ncm).slice(0,8);
  if(code.length!==8)return null;
  for(const rule of MG_ST_RULES){
    if((rule.match||[]).includes(code))return rule;
    if((rule.prefix||[]).some(p=>code.startsWith(p)))return rule;
  }
  return null;
}
function auditMgTax({ncm='',cest='',name='',category=''}={}){
  const code=digits(ncm).slice(0,8),currentCest=digits(cest).slice(0,7),rule=matchMgStRule(code);
  if(code.length!==8)return{status:'REVISAR',reason:'NCM ausente ou inválido; não é possível validar ST em MG.',rule:null,source:MG_ST_SOURCE};
  if(!rule)return{status:'REVISAR',reason:'NCM ainda não coberto pela matriz automática. Não interpretar como “sem ST”.',rule:null,source:MG_ST_SOURCE};
  const cestOk=currentCest&&rule.cests.includes(currentCest);
  if(!currentCest)return{status:'REVISAR',reason:'NCM consta no Capítulo 21 do Anexo VII/MG, mas o CEST não está preenchido.',rule,source:MG_ST_SOURCE};
  if(!cestOk)return{status:'DIVERGÊNCIA',reason:'CEST cadastrado não corresponde às opções oficiais mapeadas para este NCM.',rule,source:MG_ST_SOURCE};
  if(rule.ambiguous)return{status:'CONFERIR DESCRIÇÃO',reason:'NCM/CEST é compatível, mas há mais de um enquadramento possível; conferir descrição técnica do produto antes de emitir NF-e.',rule,source:MG_ST_SOURCE};
  return{status:'COMPATÍVEL',reason:'NCM e CEST são compatíveis com a referência oficial mapeada do RICMS/MG.',rule,source:MG_ST_SOURCE};
}

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


  router.get('/erp/fiscal-matrix',context.adminRequired,async(req,res)=>{
    try{
      const includeInactive=req.query?.includeInactive==='1';
      const docs=await context.Product.collection.find(includeInactive?{}:{active:{$ne:false}}).sort({name:1}).limit(5000).toArray();
      const products=docs.filter(p=>productService.isOwnProduct(p)).map(present);
      const rows=products.map((p)=>{
        const f=p.fiscal||{};
        const ncm=digits(f.ncm).slice(0,8);
        const cest=digits(f.cest).slice(0,7);
        const cfop=digits(f.cfop).slice(0,4);
        const csosn=digits(f.csosn).slice(0,3);
        const icmsCst=digits(f.icmsCst).slice(0,3);
        const stByTaxCode=csosn==='500'||icmsCst==='060'||icmsCst==='60'||['5403','5405','6403','6404'].includes(cfop);
        const mgTax=auditMgTax({ncm,cest,name:p.name,category:p.category});
        const stIndicated=Boolean(cest||stByTaxCode||mgTax.rule);
        const issues=[];
        if(ncm.length!==8)issues.push('NCM ausente/inválido');
        if(!f.unit)issues.push('Unidade ausente');
        if(f.origin===''||f.origin===null||f.origin===undefined)issues.push('Origem fiscal ausente');
        if(stIndicated&&!cest)issues.push('ST indicada sem CEST');
        if(['REVISAR','DIVERGÊNCIA','CONFERIR DESCRIÇÃO'].includes(mgTax.status))issues.push('MG: '+mgTax.reason);
        if(!cfop)issues.push('CFOP não definido no produto');
        if(!csosn&&!icmsCst)issues.push('ICMS/CSOSN não definido');
        return{
          id:p.id,name:p.name,sku:p.sku,brand:p.brand,category:p.category,active:p.active,stock:p.stock,
          price:p.price,costPrice:p.costPrice,sellerName:p.sellerName||'Ariana Móveis',
          ncm,cest,cfop,unit:f.unit||'',origin:f.origin||'',csosn,icmsCst,pisCst:f.pisCst||'',cofinsCst:f.cofinsCst||'',ean:f.ean||'',
          stStatus:mgTax.rule?'ENQUADRAMENTO ST ENCONTRADO EM MG':(stIndicated?'ST indicada no cadastro':'NÃO CLASSIFICADO AUTOMATICAMENTE'),
          stIndicated,
          mgTax:{
            status:mgTax.status,
            reason:mgTax.reason,
            officialCests:mgTax.rule?.cests||[],
            mva:mgTax.rule?.mva??null,
            scope:mgTax.rule?.scope||'',
            officialDescription:mgTax.rule?.label||'',
            source:mgTax.source
          },
          saleOrderStatus:issues.length?'REVISAR':'CADASTRO COMPLETO — VALIDAR OPERAÇÃO/UF ANTES DA NF-e',
          issues
        };
      });
      const summary={
        total:rows.length,
        active:rows.filter(r=>r.active).length,
        withNcm:rows.filter(r=>r.ncm.length===8).length,
        withoutNcm:rows.filter(r=>r.ncm.length!==8).length,
        stIndicated:rows.filter(r=>r.stIndicated).length,
        mgCompatible:rows.filter(r=>r.mgTax?.status==='COMPATÍVEL').length,
        mgDivergence:rows.filter(r=>r.mgTax?.status==='DIVERGÊNCIA').length,
        withIssues:rows.filter(r=>r.issues.length).length
      };
      return res.json({ok:true,source:'Ariana ERP - cadastro real de produtos',taxReference:MG_ST_SOURCE,generatedAt:new Date().toISOString(),summary,rows});
    }catch(error){
      console.error('[erp-fiscal-matrix]',error);
      return res.status(Number(error?.statusCode||500)).json({ok:false,error:error?.message||'Erro ao montar matriz fiscal.',code:error?.code||'ERP_FISCAL_MATRIX_ERROR'});
    }
  });

  return router;
}
