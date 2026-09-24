import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { createErpPeopleService } from './erpPeopleService.js';
import { createErpSefazTransport } from './erpSefazTransport.js';
import { createErpStockMovementService } from './erpStockMovementService.js';

const clean=(v='',m=1000)=>String(v??'').trim().slice(0,m);
const digits=(v='')=>String(v??'').replace(/\D/g,'');
const money=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
const fail=(message,statusCode=400,code='ERP_NFE_RETURN_ERROR',details={})=>Object.assign(new Error(message),{statusCode,code,details});
const SIMPLE_CSOSN_NO_DETAIL=new Set(['102','103','300','400']);
const VALID_UFS=new Set(['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']);

const returnOperationSchema=new mongoose.Schema({
  fingerprint:{type:String,index:true},
  status:{type:String,default:'draft',index:true},
  direction:{type:String,enum:['entrada','saida'],required:true},
  referenceKey:{type:String,required:true,index:true},
  environment:String,serie:Number,number:Number,
  preparedKey:String,unsignedXml:{type:String,default:''},signedXml:{type:String,default:''},
  key:String,protocol:String,xml:{type:String,default:''},fiscalDocumentId:String,
  lastCStat:String,lastError:String,
  stockApplied:{type:Boolean,default:false},stockAppliedItems:{type:[Number],default:[]},stockAppliedAt:Date,
  actor:String,draft:{type:mongoose.Schema.Types.Mixed,default:{}}
},{timestamps:true,versionKey:false,minimize:false});
const ReturnOperation=mongoose.models.ErpNfeReturnOperation||mongoose.model('ErpNfeReturnOperation',returnOperationSchema);

function first(obj,...keys){for(const k of keys){const v=obj?.[k];if(v!==undefined&&v!==null&&String(v).trim()!=='')return v}return''}
function parseOrigin(value){const m=String(value??'').match(/[0-8]/);return m?Number(m[0]):null}
function productFiscal(specs={},tax={}){
  const origin=first(specs,'productOrigin','origin','origem');
  return{
    csosn:clean(first(specs,'csosn','icmsCsosn')||tax.csosn,3),
    pisCst:clean(first(specs,'pisCst','cstPis')||tax.pisCst,2),
    cofinsCst:clean(first(specs,'cofinsCst','cstCofins')||tax.cofinsCst,2),
    unit:clean(first(specs,'unit','unidade')||tax.defaultUnit,10).toUpperCase(),
    origin:parseOrigin(origin!==''?origin:tax.productOrigin)
  };
}
function customerFiscalProfile(customer={}){
  const doc=digits(customer.document),ie=clean(customer.ie,20);
  if(doc.length!==14)return{status:'nao_contribuinte',indicatorIE:9,ie:''};
  let status=clean(customer.icmsTaxpayerStatus||'auto',40).toLowerCase();
  if(!['auto','contribuinte','isento','nao_contribuinte'].includes(status))status='auto';
  if(status==='auto'&&ie)status='contribuinte';
  if(status==='auto'&&customer.ieExempt)status='isento';
  if(status==='contribuinte')return{status,indicatorIE:1,ie};
  if(status==='isento')return{status,indicatorIE:2,ie:''};
  if(status==='nao_contribuinte')return{status,indicatorIE:9,ie:''};
  return{status:'auto',indicatorIE:9,ie:''};
}
function publicProblem(code,message,field=''){return{code,message,field}}
function accessKeyFrom(value=''){const matches=String(value||'').match(/\d{44}/g)||[];return matches.find(k=>k.length===44)||''}
function extractXmlElement(xml='',tag=''){const source=String(xml||'');const re=new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${tag}\\b[^>]*>[\\s\\S]*?<\\/(?:[A-Za-z_][\\w.-]*:)?${tag}>`,'i');return source.match(re)?.[0]||''}
function buildNfeProc(signedXml='',protNFe=''){if(!signedXml||!protNFe)return'';const nfeContent=String(signedXml).replace(/<\?xml[^?]*\?>\s*/g,'');return`<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">${nfeContent}${protNFe}</nfeProc>`}
function fingerprint(value){return createHash('sha256').update(JSON.stringify(value??null)).digest('hex')}
function xmlEscape(v=''){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]))}
function injectItemReferences(xml='',products=[],referenceKey=''){
  const byItem=new Map(products.map((p,i)=>[i+1,`<DFeReferenciado><chaveAcesso>${xmlEscape(referenceKey)}</chaveAcesso><nItem>${Number(p.originalItemNumber)}</nItem></DFeReferenciado>`]));
  return String(xml).replace(/<det nItem="(\d+)">([\s\S]*?)<\/det>/g,(all,n,body)=>{
    const ref=byItem.get(Number(n));
    return ref?`<det nItem="${n}">${body}${ref}</det>`:all;
  });
}
function simplesXmlBuilder(DefaultXmlBuilder){
  const base=new DefaultXmlBuilder();
  return{build(nfe){return base.build(nfe).replace(/<(\/?)ICMSSN(?:103|300|400)>/g,'<$1ICMSSN102>')}};
}
function keyMatchesReservation(key,pre,number){
  const k=digits(key);
  if(k.length!==44)return false;
  return k.slice(6,20)===digits(pre?.issuer?.cnpj)&&k.slice(20,22)==='55'&&Number(k.slice(22,25))===Number(pre?.serie)&&Number(k.slice(25,34))===Number(number);
}

export function createErpNfeReturnService(context={},settings){
  const Product=context.Product;
  if(!Product)throw new Error('[erp-nfe-return] Product não informado');
  const people=createErpPeopleService(context);
  const stock=createErpStockMovementService(context);

  async function resolvedCustomer(draft={}){
    const input=draft.customer||{};
    if(input.id){
      try{const saved=await people.get(input.id);return{...input,...saved,addressData:saved.address||input.addressData||{}}}catch{}
    }
    return{...input,addressData:input.addressData||{}};
  }

  async function resolvedProducts(draft={}){
    const rows=Array.isArray(draft.items)?draft.items:[];
    const ids=rows.map(x=>String(x.productId||'')).filter(mongoose.isValidObjectId);
    const docs=ids.length?await Product.find({_id:{$in:ids}}).select('_id name sku specs active stock').lean():[];
    const map=new Map(docs.map(x=>[String(x._id),x]));
    return rows.map((x,index)=>({draft:x,index:index+1,product:map.get(String(x.productId||''))||null}));
  }

  async function preflight(draft={}){
    const cfg=(await settings.get()).emission||{},problems=[];
    if(!cfg.encryptionReady)problems.push(publicProblem('ENCRYPTION_KEY_MISSING','O servidor não possui chave permanente para proteger o certificado.','certificate'));
    if(!cfg.a1?.configured)problems.push(publicProblem('A1_MISSING','Cadastre o certificado digital A1 antes de emitir devolução.','certificate'));
    const issuer=cfg.issuer||{},tax=cfg.taxation||{},crt=Number(issuer.crt);
    for(const [k,label] of [['cnpj','CNPJ do emitente'],['ie','Inscrição Estadual'],['razaoSocial','Razão social'],['logradouro','Logradouro'],['numero','Número'],['bairro','Bairro'],['codigoMunicipio','Código IBGE do município'],['municipio','Município'],['uf','UF'],['cep','CEP']]){
      if(!clean(issuer[k]))problems.push(publicProblem('ISSUER_FIELD_MISSING',`${label} não informado nas Configurações Fiscais.`,k));
    }
    if(digits(issuer.cnpj).length!==14)problems.push(publicProblem('ISSUER_CNPJ_INVALID','CNPJ do emitente deve ter 14 dígitos.','cnpj'));
    if(!VALID_UFS.has(clean(issuer.uf,2).toUpperCase()))problems.push(publicProblem('ISSUER_UF_INVALID','UF do emitente inválida.','uf'));
    if(![1,4].includes(crt))problems.push(publicProblem('REGIME_NOT_SUPPORTED','A devolução automática está liberada nesta etapa para CRT 1 (Simples Nacional) ou CRT 4 (MEI).','crt'));

    const operation=draft.fiscal||draft.fiscalOperation||{};
    const direction=clean(operation.direction||'saida',20).toLowerCase()==='entrada'?'entrada':'saida';
    const referenceKey=digits(operation.referenceKey||operation.originalKey);
    if(referenceKey.length!==44)problems.push(publicProblem('RETURN_REFERENCE_KEY_INVALID','Informe a chave de acesso de 44 dígitos da NF-e original.','fiscal.referenceKey'));

    const customer=await resolvedCustomer(draft),doc=digits(customer.document),a=customer.addressData||{},recipientFiscal=customerFiscalProfile(customer);
    if(!clean(customer.name))problems.push(publicProblem('CUSTOMER_NAME_MISSING','Informe o nome/razão social do destinatário.','customer.name'));
    if(![11,14].includes(doc.length))problems.push(publicProblem('CUSTOMER_DOCUMENT_INVALID','O destinatário precisa ter CPF ou CNPJ.','customer.document'));
    if(doc.length===14&&recipientFiscal.status==='auto')problems.push(publicProblem('CUSTOMER_ICMS_STATUS_REQUIRED','Defina se o CNPJ é contribuinte, isento ou não contribuinte do ICMS.','customer.icmsTaxpayerStatus'));
    if(doc.length===14&&recipientFiscal.status==='contribuinte'&&!recipientFiscal.ie)problems.push(publicProblem('CUSTOMER_IE_REQUIRED','Informe a Inscrição Estadual do destinatário contribuinte.','customer.ie'));
    const ca={
      logradouro:first(a,'street','logradouro'),numero:first(a,'number','numero'),complemento:first(a,'complement','complemento'),
      bairro:first(a,'neighborhood','bairro'),municipio:first(a,'city','municipio'),codigoMunicipio:first(a,'cityCode','codigoMunicipio'),
      uf:clean(first(a,'stateCode','uf','state'),2).toUpperCase(),cep:digits(first(a,'zipCode','cep'))
    };
    for(const [k,label] of [['logradouro','logradouro'],['numero','número'],['bairro','bairro'],['municipio','município'],['codigoMunicipio','código IBGE'],['uf','UF'],['cep','CEP']]){
      if(!clean(ca[k]))problems.push(publicProblem('CUSTOMER_ADDRESS_MISSING',`O cadastro do destinatário precisa ter ${label}.`,`customer.${k}`));
    }
    if(ca.uf&&!VALID_UFS.has(ca.uf))problems.push(publicProblem('CUSTOMER_UF_INVALID','UF do destinatário inválida.','customer.uf'));
    if(ca.cep&&ca.cep.length!==8)problems.push(publicProblem('CUSTOMER_CEP_INVALID','CEP do destinatário deve ter 8 dígitos.','customer.cep'));

    const rows=await resolvedProducts(draft);
    if(!rows.length)problems.push(publicProblem('ITEMS_MISSING','Adicione pelo menos um produto à devolução.','items'));
    const expectedPrefixes=direction==='entrada'?new Set(['1','2','3']):new Set(['5','6','7']);
    for(const row of rows){
      const p=row.product,s=p?.specs||{},name=clean(row.draft?.name||p?.name||`Item ${row.index}`,180),fiscal=productFiscal(s,tax);
      const returnCfop=digits(row.draft?.returnCfop||row.draft?.cfop).slice(0,4);
      const originalItemNumber=Number(row.draft?.originalItemNumber||0);
      if(!p){problems.push(publicProblem('PRODUCT_NOT_FOUND',`Produto ${name} não foi localizado no catálogo.`,`items.${row.index}`));continue}
      if(p.active===false)problems.push(publicProblem('PRODUCT_INACTIVE',`Produto ${name} está inativo.`,`items.${row.index}`));
      if(Number(row.draft.qty||0)<=0)problems.push(publicProblem('QTY_INVALID',`Quantidade inválida para ${name}.`,`items.${row.index}.qty`));
      if(direction==='saida'&&Number(row.draft.qty||0)>Number(p.stock||0))problems.push(publicProblem('STOCK_INSUFFICIENT',`Estoque insuficiente para devolver ${name}.`,`items.${row.index}.qty`));
      if(digits(s.ncm).length!==8)problems.push(publicProblem('NCM_MISSING',`Informe o NCM de 8 dígitos do produto ${name}.`,`items.${row.index}.ncm`));
      if(returnCfop.length!==4||!expectedPrefixes.has(returnCfop[0]))problems.push(publicProblem('RETURN_CFOP_INVALID',`Informe um CFOP de devolução compatível com operação de ${direction} para ${name}.`,`items.${row.index}.returnCfop`));
      if(!Number.isInteger(originalItemNumber)||originalItemNumber<1||originalItemNumber>990)problems.push(publicProblem('RETURN_ORIGINAL_ITEM_INVALID',`Informe o número do item na NF-e original para ${name}.`,`items.${row.index}.originalItemNumber`));
      if(!fiscal.unit)problems.push(publicProblem('UNIT_MISSING',`Informe a unidade comercial do produto ${name}.`,`items.${row.index}.unit`));
      if(fiscal.origin===null)problems.push(publicProblem('ORIGIN_MISSING',`Informe a origem fiscal do produto ${name}.`,`items.${row.index}.origin`));
      if(!SIMPLE_CSOSN_NO_DETAIL.has(fiscal.csosn))problems.push(publicProblem('CSOSN_NOT_SUPPORTED',`O produto ${name} precisa usar CSOSN 102, 103, 300 ou 400 nesta etapa.`,`items.${row.index}.csosn`));
      if(digits(fiscal.pisCst).length!==2)problems.push(publicProblem('PIS_CST_MISSING',`Informe o CST de PIS do produto ${name}.`,`items.${row.index}.pisCst`));
      if(digits(fiscal.cofinsCst).length!==2)problems.push(publicProblem('COFINS_CST_MISSING',`Informe o CST de COFINS do produto ${name}.`,`items.${row.index}.cofinsCst`));
    }

    const products=rows.map(x=>({
      id:String(x.product?._id||''),name:x.draft?.name||x.product?.name||'',sku:x.draft?.sku||x.product?.sku||'',
      qty:Number(x.draft?.qty||0),unitPrice:money(x.draft?.unitPrice),stock:Number(x.product?.stock||0),
      specs:x.product?.specs||{},fiscal:productFiscal(x.product?.specs||{},tax),
      returnCfop:digits(x.draft?.returnCfop||x.draft?.cfop).slice(0,4),originalItemNumber:Number(x.draft?.originalItemNumber||0)
    }));
    const total=money(draft?.totals?.total||products.reduce((sum,p)=>sum+p.qty*p.unitPrice,0));
    if(total<=0)problems.push(publicProblem('TOTAL_INVALID','O total da devolução precisa ser maior que zero.','totals.total'));

    return{
      ready:problems.length===0,problems,environment:cfg.environment||'homologacao',a1:cfg.a1||{},issuer,
      customer:{...customer,addressData:ca,icmsTaxpayerStatus:recipientFiscal.status,indicatorIE:recipientFiscal.indicatorIE,ie:recipientFiscal.ie||clean(customer.ie,20)},
      products,taxation:tax,serie:Number(cfg.serie||1),nextNumber:Number(cfg.nextNumber||1),
      operation:{direction,referenceKey,natureOperation:clean(operation.natureOperation||'Devolução de mercadoria',60)}
    };
  }

  async function buildData(draft,pre,number){
    const issuer=pre.issuer,customer=pre.customer,recipientFiscal=customerFiscalProfile(customer);
    const issuerUf=clean(issuer.uf,2).toUpperCase(),custUf=clean(customer.addressData.uf,2).toUpperCase(),doc=digits(customer.document);
    const produtos=pre.products.map((p,i)=>{
      const s=p.specs||{},fiscal=p.fiscal;
      const item={numero:i+1,codigo:clean(p.sku||p.id,60),descricao:clean(p.name,120),ncm:digits(s.ncm),cfop:p.returnCfop,unidade:fiscal.unit,quantidade:p.qty,valorUnitario:p.unitPrice,valorTotal:money(p.qty*p.unitPrice),icms:{origem:fiscal.origin,csosn:fiscal.csosn},pis:{cst:fiscal.pisCst},cofins:{cst:fiscal.cofinsCst}};
      const cest=digits(s.cest);if(cest)item.cest=cest;return item;
    });
    const direction=pre.operation.direction;
    return{
      identificacao:{
        naturezaOperacao:pre.operation.natureOperation,tipoOperacao:direction==='entrada'?0:1,
        destinoOperacao:issuerUf===custUf?1:2,finalidade:4,consumidorFinal:0,presencaComprador:0,
        ambiente:pre.environment==='producao'?1:2,uf:issuerUf,municipio:digits(issuer.codigoMunicipio),serie:pre.serie,numero:number
      },
      emitente:{
        cnpj:digits(issuer.cnpj),razaoSocial:clean(issuer.razaoSocial,60),nomeFantasia:clean(issuer.nomeFantasia,60)||undefined,
        inscricaoEstadual:clean(issuer.ie,20),regimeTributario:Number(issuer.crt),
        endereco:{logradouro:clean(issuer.logradouro,60),numero:clean(issuer.numero,60),complemento:clean(issuer.complemento,60)||undefined,bairro:clean(issuer.bairro,60),codigoMunicipio:digits(issuer.codigoMunicipio),municipio:clean(issuer.municipio,60),uf:issuerUf,cep:digits(issuer.cep),telefone:digits(issuer.phone)||undefined}
      },
      destinatario:{
        ...(doc.length===14?{cnpj:doc}:{cpf:doc}),nome:clean(customer.name,60),indicadorIE:recipientFiscal.indicatorIE,
        ...(recipientFiscal.indicatorIE===1&&recipientFiscal.ie?{inscricaoEstadual:recipientFiscal.ie}:{}),
        email:clean(customer.email,60)||undefined,
        endereco:{logradouro:clean(customer.addressData.logradouro,60),numero:clean(customer.addressData.numero,60),complemento:clean(customer.addressData.complemento,60)||undefined,bairro:clean(customer.addressData.bairro,60),codigoMunicipio:digits(customer.addressData.codigoMunicipio),municipio:clean(customer.addressData.municipio,60),uf:custUf,cep:digits(customer.addressData.cep),telefone:digits(customer.phone)||undefined}
      },
      produtos,transporte:{modalidadeFrete:9},pagamento:{pagamentos:[{formaPagamento:'90',valor:0}]},
      informacoesComplementares:clean(`NF-e de devolução. Documento original: ${pre.operation.referenceKey}. ${draft.notes||''}`,5000)
    };
  }

  async function persistFiscal({op,pre,draft,key,protocol,xml,authorizedAt=new Date()}){
    const Fiscal=mongoose.models.ErpFiscalHistoricalDocument;if(!Fiscal)return'';
    const doc=await Fiscal.findOneAndUpdate(
      {sourceSystem:'ariana',key},
      {$set:{
        sourceId:`nfe:${key}`,saleSourceId:'',key,number:String(op.number),series:String(op.serie),total:money(draft?.totals?.total||pre.products.reduce((s,p)=>s+p.qty*p.unitPrice,0)),
        date:authorizedAt,status:'approved',recipientName:clean(pre.customer.name,240),recipientDocument:digits(pre.customer.document),recipientEmail:clean(pre.customer.email,320),
        protocol,environment:pre.environment,issuerName:clean(pre.issuer.razaoSocial,240),issuerDocument:digits(pre.issuer.cnpj),natureOperation:pre.operation.natureOperation,
        operationType:pre.operation.direction,documentModel:'55',purpose:'devolucao',xml,
        items:pre.products.map(p=>({productId:p.id,productCode:p.sku,description:p.name,ncm:digits(p.specs?.ncm),cest:digits(p.specs?.cest),cfop:p.returnCfop,unit:p.fiscal?.unit,quantity:p.qty,unitValue:p.unitPrice,total:money(p.qty*p.unitPrice)})),
        metadata:{origin:'ariana_erp',returnOperationId:String(op._id),originalAccessKey:pre.operation.referenceKey,originalItems:pre.products.map(p=>({productId:p.id,originalItemNumber:p.originalItemNumber})),xmlAvailable:Boolean(xml)}
      }},
      {upsert:true,new:true,setDefaultsOnInsert:true}
    );
    return String(doc?._id||'');
  }

  async function applyStock(op,pre,draft,actor={}){
    if(pre.environment!=='producao')return{completed:false,skipped:true};
    const applied=new Set((op.stockAppliedItems||[]).map(Number));
    for(let i=0;i<pre.products.length;i++){
      const itemNo=i+1;if(applied.has(itemNo))continue;
      const p=pre.products[i];
      await stock.move(p.id,{type:pre.operation.direction==='entrada'?'entrada':'saida',quantity:p.qty,reason:`NF-e de devolução ${op.key||''}`,reference:op.key||pre.operation.referenceKey},actor);
      await ReturnOperation.updateOne({_id:op._id},{$addToSet:{stockAppliedItems:itemNo}});
      applied.add(itemNo);
    }
    await ReturnOperation.updateOne({_id:op._id},{$set:{stockApplied:true,stockAppliedAt:new Date()}});
    op.stockApplied=true;op.stockAppliedItems=[...applied];return{completed:true,skipped:false};
  }

  async function finalizeAuthorized({op,pre,draft,result,recovered=false,actor={}}){
    const key=digits(result.chaveAcesso),protocol=clean(result.protocolo,100),xml=String(result.xmlProtocolado||result.xmlAutorizado||result.xml||''),authorizedAt=result.dataAutorizacao instanceof Date?result.dataAutorizacao:new Date();
    const fiscalDocumentId=await persistFiscal({op,pre,draft,key,protocol,xml,authorizedAt});
    op.status=pre.environment==='producao'?'authorized':'authorized_homologation';op.key=key;op.protocol=protocol;op.xml=xml;op.fiscalDocumentId=fiscalDocumentId;op.lastCStat='100';op.lastError='';await op.save();
    let stockResult={completed:false,skipped:pre.environment!=='producao'},stockError='';
    if(pre.environment==='producao'){
      try{stockResult=await applyStock(op,pre,draft,actor)}catch(error){stockError=clean(error?.message||error,800);await ReturnOperation.updateOne({_id:op._id},{$set:{lastError:`NF-e autorizada; estoque pendente: ${stockError}`}})}
    }
    return{authorized:true,homologation:pre.environment!=='producao',operationId:String(op._id),key,protocol,number:op.number,series:op.serie,environment:pre.environment,fiscalDocumentId,recovered:Boolean(recovered),xmlAvailable:Boolean(xml),stockCompleted:Boolean(stockResult.completed),stockSkipped:Boolean(stockResult.skipped),stockPending:Boolean(stockError),stockError};
  }

  async function recoverDuplicate({op,pre,draft,cert,lib,key,actor}){
    const duplicateKey=digits(key);
    if(!keyMatchesReservation(duplicateKey,pre,op.number))throw fail('A chave duplicada retornada pela SEFAZ não corresponde à numeração reservada desta devolução.',409,'NFE_RETURN_DUPLICATE_KEY_MISMATCH',{operationId:String(op._id),key:duplicateKey});
    const transport=createErpSefazTransport();
    const core=lib.NFeCore.create({pfx:cert.pfx,senha:cert.password,ambiente:pre.environment,uf:String(pre.issuer.uf||'MG').toUpperCase(),transport});
    const consult=await core.consultarProtocolo(duplicateKey);
    if(String(consult?.codigoStatus)!=='100')throw fail(`A NF-e duplicada foi localizada com status ${clean(consult?.codigoStatus,20)}.`,409,'NFE_RETURN_DUPLICATE_NOT_AUTHORIZED',{operationId:String(op._id),key:duplicateKey});
    const protNFe=extractXmlElement(transport.getLastRawResponse?.()||'','protNFe'),signedXml=String(op.signedXml||''),signedKey=accessKeyFrom(signedXml.match(/Id="NFe(\d{44})"/)?.[1]||'');
    const xmlProtocolado=signedXml&&signedKey===duplicateKey&&protNFe?buildNfeProc(signedXml,protNFe):'';
    if(pre.environment==='producao'&&!xmlProtocolado){
      op.status='authorized_recovery_pending';op.key=duplicateKey;op.protocol=clean(consult.protocolo,100);op.lastCStat='100';op.lastError='NF-e autorizada, mas XML protocolado ainda não foi recuperado; estoque não movimentado.';await op.save();
      return{authorized:true,recoveryPending:true,stockCompleted:false,operationId:String(op._id),key:duplicateKey,protocol:op.protocol,number:op.number,series:op.serie,environment:pre.environment,xmlAvailable:false};
    }
    return finalizeAuthorized({op,pre,draft,result:{chaveAcesso:duplicateKey,protocolo:consult.protocolo,dataAutorizacao:consult.dataAutorizacao,xmlProtocolado},recovered:true,actor});
  }

  async function transmit(draft={},actor={},existingOperationId=''){
    const pre=await preflight(draft);
    if(!pre.ready)throw fail('A devolução possui pendências fiscais. Corrija antes de emitir.',409,'NFE_RETURN_PREFLIGHT_BLOCKED',{problems:pre.problems});
    const requestFingerprint=fingerprint({environment:pre.environment,direction:pre.operation.direction,referenceKey:pre.operation.referenceKey,customer:digits(pre.customer.document),items:pre.products.map(p=>({id:p.id,qty:p.qty,price:p.unitPrice,cfop:p.returnCfop,originalItemNumber:p.originalItemNumber}))});
    let op=null;
    if(existingOperationId&&mongoose.isValidObjectId(existingOperationId))op=await ReturnOperation.findById(existingOperationId);
    if(!op){
      const since=new Date(Date.now()-6*60*60*1000);
      op=await ReturnOperation.findOne({fingerprint:requestFingerprint,createdAt:{$gte:since},status:{$in:['draft','reserved','error','authorized','authorized_homologation','authorized_recovery_pending']}}).sort({createdAt:-1});
    }
    if(!op)op=await ReturnOperation.create({fingerprint:requestFingerprint,status:'draft',direction:pre.operation.direction,referenceKey:pre.operation.referenceKey,environment:pre.environment,serie:pre.serie,actor:clean(actor.name||actor.email||'Operador',180),draft});

    if(['authorized','authorized_homologation'].includes(op.status)&&op.key){
      if(op.status==='authorized'&&!op.stockApplied){
        try{await applyStock(op,pre,draft,actor)}catch(error){return{authorized:true,homologation:false,operationId:String(op._id),key:op.key,protocol:op.protocol,number:op.number,series:op.serie,environment:op.environment,fiscalDocumentId:op.fiscalDocumentId||'',xmlAvailable:Boolean(op.xml),stockCompleted:false,stockPending:true,stockError:clean(error?.message||error,800)}}
      }
      return{authorized:true,homologation:op.status==='authorized_homologation',operationId:String(op._id),key:op.key,protocol:op.protocol,number:op.number,series:op.serie,environment:op.environment,fiscalDocumentId:op.fiscalDocumentId||'',xmlAvailable:Boolean(op.xml),stockCompleted:Boolean(op.stockApplied),stockSkipped:op.status==='authorized_homologation',alreadyAuthorized:true};
    }
    if(op.status==='authorized_recovery_pending'&&op.key)return{authorized:true,recoveryPending:true,operationId:String(op._id),key:op.key,protocol:op.protocol,number:op.number,series:op.serie,environment:op.environment,xmlAvailable:false,stockCompleted:false};

    if(!op.number){op.number=await settings.reserveNfeNumber(actor);op.serie=pre.serie;op.environment=pre.environment;op.status='reserved';await op.save()}
    if(op.environment!==pre.environment)throw fail('A tentativa de devolução foi iniciada em outro ambiente fiscal.',409,'NFE_RETURN_ENVIRONMENT_CHANGED',{operationId:String(op._id)});

    const cert=await settings.certificateCredentials(),lib=await import('@brasil-fiscal/nfe'),data=await buildData(draft,pre,op.number);
    let unsignedXml=String(op.unsignedXml||''),preparedKey=digits(op.preparedKey);
    if(!unsignedXml){
      unsignedXml=simplesXmlBuilder(lib.DefaultXmlBuilder).build(data);
      unsignedXml=injectItemReferences(unsignedXml,pre.products,pre.operation.referenceKey);
      preparedKey=accessKeyFrom(unsignedXml.match(/Id="NFe(\d{44})"/)?.[1]||'');
      if(preparedKey.length!==44)throw fail('Não foi possível obter a chave da NF-e de devolução preparada.',500,'NFE_RETURN_KEY_MISSING',{operationId:String(op._id)});
      op.unsignedXml=unsignedXml;op.preparedKey=preparedKey;await op.save();
    }
    let signedXml=String(op.signedXml||'');
    const provider=new lib.A1CertificateProvider(cert.pfx,cert.password);
    if(!signedXml){const certificateData=await provider.load();signedXml=new lib.DefaultXmlSigner().sign(unsignedXml,certificateData);op.signedXml=signedXml;await op.save()}

    const frozenBuilder={build:()=>unsignedXml},frozenSigner={sign:()=>signedXml},transport=createErpSefazTransport();
    const core=lib.NFeCore.create({pfx:cert.pfx,senha:cert.password,ambiente:pre.environment,uf:String(pre.issuer.uf||'MG').toUpperCase(),certificate:provider,xmlBuilder:frozenBuilder,xmlSigner:frozenSigner,transport});
    try{
      const result=await core.transmitir(data);
      return finalizeAuthorized({op,pre,draft,result,actor});
    }catch(error){
      const cStat=clean(error?.cStat,20),xMotivo=clean(error?.xMotivo||error?.message||error,1000);
      op.status='error';op.lastCStat=cStat;op.lastError=xMotivo;await op.save().catch(()=>{});
      const duplicateKey=accessKeyFrom(xMotivo)||(cStat==='204'?preparedKey:'');
      if(['204','539'].includes(cStat)&&duplicateKey)return recoverDuplicate({op,pre,draft,cert,lib,key:duplicateKey,actor});
      throw fail(error?.xMotivo?`SEFAZ: ${error.xMotivo}`:`Falha na emissão da NF-e de devolução: ${clean(error?.message||error,600)}`,502,'NFE_RETURN_TRANSMISSION_ERROR',{operationId:String(op._id),number:op.number,cStat,xMotivo});
    }
  }

  return{preflight,transmit};
}
export default createErpNfeReturnService;
