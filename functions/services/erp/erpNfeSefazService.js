import https from 'node:https';
import axios from 'axios';
import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { createErpPeopleService } from './erpPeopleService.js';
import { createErpSefazTransport } from './erpSefazTransport.js';

const clean=(v='',m=1000)=>String(v??'').trim().slice(0,m);
const digits=(v='')=>String(v??'').replace(/\D/g,'');
const money=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
const fail=(message,statusCode=400,code='ERP_NFE_ERROR',details={})=>Object.assign(new Error(message),{statusCode,code,details});
const MG_STATUS={
  homologacao:'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeStatusServico4',
  producao:'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeStatusServico4'
};
const paymentCode={dinheiro:'01',cartao_credito:'03',cartao_debito:'04',crediario:'05',boleto:'15',pix:'17',outro:'99'};
const SIMPLE_CSOSN_NO_DETAIL=new Set(['102','103','300','400']);
const UF_CODES={AC:'12',AL:'27',AP:'16',AM:'13',BA:'29',CE:'23',DF:'53',ES:'32',GO:'52',MA:'21',MT:'51',MS:'50',MG:'31',PA:'15',PB:'25',PR:'41',PE:'26',PI:'22',RJ:'33',RN:'24',RS:'43',RO:'11',RR:'14',SC:'42',SP:'35',SE:'28',TO:'17'};
const VALID_UFS=new Set(Object.keys(UF_CODES));

function readTag(xml,name){
  const m=String(xml||'').match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'i'));
  return clean(m?.[1]||'',1000).replace(/<!\[CDATA\[|\]\]>/g,'');
}
function first(obj,...keys){
  for(const k of keys){
    const v=obj?.[k];
    if(v!==undefined&&v!==null&&String(v).trim()!=='')return v;
  }
  return '';
}
function parseOrigin(value){
  const m=String(value??'').match(/[0-8]/);
  return m?Number(m[0]):null;
}
function productFiscal(specs={},tax={}){
  const origin=first(specs,'productOrigin','origin','origem');
  return{
    csosn:clean(first(specs,'csosn','icmsCsosn')||tax.csosn,3),
    pisCst:clean(first(specs,'pisCst','cstPis')||tax.pisCst,2),
    cofinsCst:clean(first(specs,'cofinsCst','cstCofins')||tax.cofinsCst,2),
    cfop:digits(first(specs,'cfop')||tax.defaultCfop).slice(0,4),
    unit:clean(first(specs,'unit','unidade')||tax.defaultUnit,10).toUpperCase(),
    origin:parseOrigin(origin!==''?origin:tax.productOrigin)
  };
}
function simplesXmlBuilder(DefaultXmlBuilder){
  const base=new DefaultXmlBuilder();
  return{
    build(nfe){
      return base.build(nfe).replace(/<(\/?)ICMSSN(?:103|300|400)>/g,'<$1ICMSSN102>');
    }
  };
}
function ufCode(uf=''){return UF_CODES[String(uf).toUpperCase()]||''}
function destinationType(issuerUf,customerUf){return String(issuerUf).toUpperCase()===String(customerUf).toUpperCase()?1:2}
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
function paymentParts(total,installments){
  const n=Math.max(1,Number(installments||1));
  const base=Math.floor((money(total)*100)/n);
  const rem=Math.round(money(total)*100)-base*n;
  return Array.from({length:n},(_,i)=>(base+(i<rem?1:0))/100);
}
function parseIsoDate(value=''){
  const m=clean(value,10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m)return null;
  const year=Number(m[1]),month=Number(m[2]),day=Number(m[3]);
  const date=new Date(Date.UTC(year,month-1,day));
  if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return null;
  return{year,month,day};
}
function addMonthsIso(value='',offset=0){
  const parsed=parseIsoDate(value);
  if(!parsed)return '';
  const monthIndex=parsed.year*12+(parsed.month-1)+Math.max(0,Number(offset||0));
  const year=Math.floor(monthIndex/12),month=monthIndex%12;
  const lastDay=new Date(Date.UTC(year,month+1,0)).getUTCDate();
  const day=Math.min(parsed.day,lastDay);
  return `${String(year).padStart(4,'0')}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}
function buildCobranca(draft={},number,parts=[]){
  const method=clean(draft?.payment?.method);
  const firstDueDate=clean(draft?.payment?.firstDueDate,10);
  if(!['crediario','boleto'].includes(method)||!parseIsoDate(firstDueDate))return undefined;
  const total=money(draft?.totals?.total);
  return{
    fatura:{nFat:String(number),vOrig:total,vLiq:total},
    duplicatas:parts.map((value,index)=>({
      nDup:String(index+1).padStart(3,'0'),
      dVenc:addMonthsIso(firstDueDate,index),
      vDup:money(value)
    }))
  };
}
function publicProblem(code,message,field=''){return{code,message,field}}
function orderMatchesDraft(order,draft={}){
  const expected=(Array.isArray(draft.items)?draft.items:[])
    .map(i=>`${String(i?.productId||'')}|${Number(i?.qty||0)}|${money(i?.unitPrice)}`).sort();
  const actual=(Array.isArray(order?.items)?order.items:[])
    .map(i=>`${String(i?.productId||'')}|${Number(i?.qty||0)}|${money(i?.unitPrice)}`).sort();
  return digits(order?.customerCpf)===digits(draft?.customer?.document)
    && money(order?.total)===money(draft?.totals?.total)
    && expected.length===actual.length
    && expected.every((v,i)=>v===actual[i]);
}
function accessKeyFrom(value=''){
  const matches=String(value||'').match(/\d{44}/g)||[];
  return matches.find(k=>k.length===44)||'';
}
function keyMatchesReservation(key,pre,number){
  const k=digits(key);
  if(k.length!==44)return false;
  return k.slice(6,20)===digits(pre?.issuer?.cnpj)
    && k.slice(20,22)==='55'
    && Number(k.slice(22,25))===Number(pre?.serie)
    && Number(k.slice(25,34))===Number(number);
}
function extractXmlElement(xml='',tag=''){
  const source=String(xml||'');
  const re=new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${tag}\\b[^>]*>[\\s\\S]*?<\\/(?:[A-Za-z_][\\w.-]*:)?${tag}>`,'i');
  return source.match(re)?.[0]||'';
}
function buildNfeProc(signedXml='',protNFe=''){
  if(!signedXml||!protNFe)return '';
  const nfeContent=String(signedXml).replace(/<\?xml[^?]*\?>\s*/g,'');
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">${nfeContent}${protNFe}</nfeProc>`;
}
function fingerprint(value){
  return createHash('sha256').update(JSON.stringify(value??null)).digest('hex');
}

export function createErpNfeSefazService(context={},settings){
  const Product=context.Product,Order=context.Order;
  if(!Product||!Order)throw new Error('[erp-nfe] Product/Order não informados');
  const people=createErpPeopleService(context);

  async function resolvedCustomer(draft={}){
    const input=draft.customer||{};
    if(input.id){
      try{
        const saved=await people.get(input.id);
        return{...input,...saved,addressData:saved.address||input.addressData||{}};
      }catch{}
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
    if(!cfg.a1?.configured)problems.push(publicProblem('A1_MISSING','Cadastre o certificado digital A1 (.pfx/.p12) e a senha em Configurações.','certificate'));

    const issuer=cfg.issuer||{},tax=cfg.taxation||{},crt=Number(issuer.crt);
    const requiredIssuer=[
      ['cnpj','CNPJ do emitente'],['ie','Inscrição Estadual'],['razaoSocial','Razão social'],
      ['logradouro','Logradouro'],['numero','Número'],['bairro','Bairro'],
      ['codigoMunicipio','Código IBGE do município'],['municipio','Município'],['uf','UF'],['cep','CEP']
    ];
    for(const [k,label] of requiredIssuer){
      if(!clean(issuer[k]))problems.push(publicProblem('ISSUER_FIELD_MISSING',`${label} não informado nas Configurações Fiscais.`,k));
    }
    if(digits(issuer.cnpj).length!==14)problems.push(publicProblem('ISSUER_CNPJ_INVALID','CNPJ do emitente deve ter 14 dígitos.','cnpj'));
    if(!VALID_UFS.has(clean(issuer.uf,2).toUpperCase()))problems.push(publicProblem('ISSUER_UF_INVALID','UF do emitente deve ser uma sigla brasileira válida.','uf'));
    if(![1,2,3,4].includes(crt))problems.push(publicProblem('CRT_MISSING','Selecione o regime tributário (CRT) nas Configurações Fiscais.','crt'));
    if([2,3].includes(crt))problems.push(publicProblem('REGIME_NOT_SUPPORTED','A emissão direta automática desta etapa está liberada somente para CRT 1 (Simples Nacional) ou CRT 4 (MEI). CRT 2/3 exige CST e tratamento tributário próprio antes de emitir.','crt'));
    if(!Number.isInteger(Number(cfg.serie))||Number(cfg.serie)<1)problems.push(publicProblem('SERIE_INVALID','Informe uma série de NF-e válida.','serie'));
    if(!Number.isInteger(Number(cfg.nextNumber))||Number(cfg.nextNumber)<1)problems.push(publicProblem('NFE_NUMBER_INVALID','Informe o próximo número da NF-e.','nextNumber'));

    const customer=await resolvedCustomer(draft),doc=digits(customer.document),a=customer.addressData||{},recipientFiscal=customerFiscalProfile(customer);
    if(!clean(customer.name))problems.push(publicProblem('CUSTOMER_NAME_MISSING','Informe o nome/razão social do cliente.','customer.name'));
    if(![11,14].includes(doc.length))problems.push(publicProblem('CUSTOMER_DOCUMENT_INVALID','O destinatário precisa ter CPF ou CNPJ para a NF-e.','customer.document'));
    if(doc.length===14&&recipientFiscal.status==='auto')problems.push(publicProblem('CUSTOMER_ICMS_STATUS_REQUIRED','Defina no cadastro do CNPJ se o destinatário é contribuinte, isento ou não contribuinte do ICMS.','customer.icmsTaxpayerStatus'));
    if(doc.length===14&&recipientFiscal.status==='contribuinte'&&!recipientFiscal.ie)problems.push(publicProblem('CUSTOMER_IE_REQUIRED','Informe a Inscrição Estadual do destinatário contribuinte do ICMS.','customer.ie'));
    const ca={
      logradouro:first(a,'street','logradouro'),
      numero:first(a,'number','numero'),
      complemento:first(a,'complement','complemento'),
      bairro:first(a,'neighborhood','bairro'),
      municipio:first(a,'city','municipio'),
      codigoMunicipio:first(a,'cityCode','codigoMunicipio'),
      uf:clean(first(a,'stateCode','uf','state'),2).toUpperCase(),
      cep:digits(first(a,'zipCode','cep'))
    };
    for(const [k,label] of [['logradouro','logradouro'],['numero','número'],['bairro','bairro'],['municipio','município'],['codigoMunicipio','código IBGE'],['uf','UF'],['cep','CEP']]){
      if(!clean(ca[k]))problems.push(publicProblem('CUSTOMER_ADDRESS_MISSING',`O cadastro do cliente precisa ter ${label} para emitir a NF-e.`,`customer.${k}`));
    }
    if(ca.uf&&!VALID_UFS.has(ca.uf))problems.push(publicProblem('CUSTOMER_UF_INVALID','A UF do destinatário deve ser uma sigla brasileira válida, como MG.','customer.uf'));
    if(ca.cep&&ca.cep.length!==8)problems.push(publicProblem('CUSTOMER_CEP_INVALID','CEP do destinatário deve ter 8 dígitos.','customer.cep'));

    const products=await resolvedProducts(draft);
    if(!products.length)problems.push(publicProblem('ITEMS_MISSING','Adicione pelo menos um produto à venda.','items'));
    for(const row of products){
      const p=row.product,s=p?.specs||{},name=clean(row.draft?.name||p?.name||`Item ${row.index}`,180),fiscal=productFiscal(s,tax);
      if(!p){problems.push(publicProblem('PRODUCT_NOT_FOUND',`Produto ${name} não foi localizado no catálogo.`,`items.${row.index}`));continue}
      if(p.active===false)problems.push(publicProblem('PRODUCT_INACTIVE',`Produto ${name} está inativo.`,`items.${row.index}`));
      if(Number(row.draft.qty||0)<=0)problems.push(publicProblem('QTY_INVALID',`Quantidade inválida para ${name}.`,`items.${row.index}.qty`));
      if(Number(row.draft.qty||0)>Number(p.stock||0))problems.push(publicProblem('STOCK_INSUFFICIENT',`Estoque insuficiente para ${name}.`,`items.${row.index}.qty`));
      if(digits(s.ncm).length!==8)problems.push(publicProblem('NCM_MISSING',`Informe o NCM de 8 dígitos do produto ${name}.`,`items.${row.index}.ncm`));
      if(fiscal.cfop.length!==4)problems.push(publicProblem('CFOP_MISSING',`Informe o CFOP do produto ${name} ou um CFOP padrão nas configurações.`,`items.${row.index}.cfop`));
      if(!fiscal.unit)problems.push(publicProblem('UNIT_MISSING',`Informe a unidade comercial do produto ${name}.`,`items.${row.index}.unit`));
      if(fiscal.origin===null)problems.push(publicProblem('ORIGIN_MISSING',`Informe a origem fiscal do produto ${name}.`,`items.${row.index}.origin`));
      if([1,4].includes(crt)&&!SIMPLE_CSOSN_NO_DETAIL.has(fiscal.csosn))problems.push(publicProblem('CSOSN_NOT_SUPPORTED',`O produto ${name} precisa usar um CSOSN suportado nesta etapa (102, 103, 300 ou 400). O valor cadastrado no produto prevalece sobre o padrão.`,`items.${row.index}.csosn`));
      if([1,4].includes(crt)&&digits(fiscal.pisCst).length!==2)problems.push(publicProblem('PIS_CST_MISSING',`Informe o CST de PIS do produto ${name} ou um CST padrão nas configurações.`,`items.${row.index}.pisCst`));
      if([1,4].includes(crt)&&digits(fiscal.cofinsCst).length!==2)problems.push(publicProblem('COFINS_CST_MISSING',`Informe o CST de COFINS do produto ${name} ou um CST padrão nas configurações.`,`items.${row.index}.cofinsCst`));
    }

    const total=money(draft?.totals?.total);
    if(total<=0)problems.push(publicProblem('TOTAL_INVALID','O total da venda precisa ser maior que zero.','totals.total'));
    const method=clean(draft?.payment?.method);
    if(!paymentCode[method])problems.push(publicProblem('PAYMENT_UNSUPPORTED','Forma de pagamento não reconhecida para NF-e.','payment.method'));
    const installments=Math.max(1,Number(draft?.payment?.installments||1));
    if((method==='crediario'||method==='boleto')&&installments>1&&!draft?.payment?.firstDueDate)problems.push(publicProblem('DUE_DATE_MISSING','Informe o primeiro vencimento da venda parcelada.','payment.firstDueDate'));

    return{
      ready:problems.length===0,
      problems,
      environment:cfg.environment||'homologacao',
      a1:cfg.a1||{},
      issuer,
      customer:{...customer,addressData:ca,icmsTaxpayerStatus:recipientFiscal.status,indicatorIE:recipientFiscal.indicatorIE,ie:recipientFiscal.ie||clean(customer.ie,20)},
      products:products.map(x=>({
        id:String(x.product?._id||''),
        name:x.draft?.name||x.product?.name||'',
        sku:x.draft?.sku||x.product?.sku||'',
        qty:Number(x.draft?.qty||0),
        unitPrice:money(x.draft?.unitPrice),
        stock:Number(x.product?.stock||0),
        specs:x.product?.specs||{},
        fiscal:productFiscal(x.product?.specs||{},tax)
      })),
      taxation:tax,
      serie:Number(cfg.serie||1),
      nextNumber:Number(cfg.nextNumber||1)
    };
  }

  async function testConnection(){
    const cfg=(await settings.get()).emission||{};
    if(!cfg.a1?.configured)throw fail('Cadastre o certificado A1 antes de testar a SEFAZ.',409,'A1_MISSING');
    const cert=await settings.certificateCredentials();
    const environment=cfg.environment==='producao'?'producao':'homologacao';
    const issuer=cfg.issuer||{},uf=clean(issuer.uf||'MG',2).toUpperCase();
    if(uf!=='MG')throw fail('Esta integração está configurada para SEFAZ/MG.',400,'UF_NOT_SUPPORTED');
    const endpoint=MG_STATUS[environment],tpAmb=environment==='producao'?'1':'2',cUF=ufCode(uf);
    const body=`<?xml version="1.0" encoding="UTF-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4"><consStatServ versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>${tpAmb}</tpAmb><cUF>${cUF}</cUF><xServ>STATUS</xServ></consStatServ></nfeDadosMsg></soap12:Body></soap12:Envelope>`;
    try{
      const agent=new https.Agent({pfx:cert.pfx,passphrase:cert.password,minVersion:'TLSv1.2',rejectUnauthorized:true});
      const response=await axios.post(endpoint,body,{httpsAgent:agent,headers:{'Content-Type':'application/soap+xml; charset=utf-8'},timeout:20000,maxRedirects:0,validateStatus:()=>true});
      const xml=String(response.data||''),cStat=readTag(xml,'cStat'),xMotivo=readTag(xml,'xMotivo');
      if(response.status<200||response.status>=300)throw fail(`SEFAZ/MG respondeu HTTP ${response.status}.`,502,'SEFAZ_HTTP_ERROR',{httpStatus:response.status});
      return{ok:['107','108','109'].includes(cStat),operational:cStat==='107',cStat,xMotivo,httpStatus:response.status,environment,endpoint:'SEFAZ/MG NFeStatusServico4'};
    }catch(error){
      if(error?.code==='ERP_NFE_ERROR')throw error;
      throw fail(`Não foi possível conectar à SEFAZ/MG: ${clean(error?.message||error,500)}`,502,'SEFAZ_CONNECTION_ERROR');
    }
  }

  async function buildNfeData(draft,pre,number){
    const issuer=pre.issuer,customer=pre.customer,tax=pre.taxation||{};
    const issuerUf=clean(issuer.uf,2).toUpperCase(),custUf=clean(customer.addressData.uf,2).toUpperCase();
    const products=pre.products.map((p,i)=>{
      const s=p.specs||{},fiscal=p.fiscal||productFiscal(s,tax);
      const item={
        numero:i+1,
        codigo:clean(p.sku||p.id,60),
        descricao:clean(p.name,120),
        ncm:digits(s.ncm),
        cfop:fiscal.cfop,
        unidade:fiscal.unit,
        quantidade:p.qty,
        valorUnitario:p.unitPrice,
        valorTotal:money(p.qty*p.unitPrice),
        icms:{origem:fiscal.origin,csosn:fiscal.csosn},
        pis:{cst:fiscal.pisCst},
        cofins:{cst:fiscal.cofinsCst}
      };
      const cest=digits(s.cest);
      if(cest)item.cest=cest;
      return item;
    });
    const doc=digits(customer.document),recipientFiscal=customerFiscalProfile(customer);
    const parts=paymentParts(draft.totals.total,draft.payment?.installments);
    const code=paymentCode[draft.payment?.method]||'99';
    const cobranca=buildCobranca(draft,number,parts);
    return{
      identificacao:{
        naturezaOperacao:clean(issuer.naturezaOperacao||'Venda de mercadoria',60),
        tipoOperacao:1,
        destinoOperacao:destinationType(issuerUf,custUf),
        finalidade:1,
        consumidorFinal:Number(draft?.fiscal?.consumerFinal??1)===0?0:1,
        presencaComprador:1,
        ambiente:pre.environment==='producao'?1:2,
        uf:issuerUf,
        municipio:digits(issuer.codigoMunicipio),
        serie:pre.serie,
        numero:number
      },
      emitente:{
        cnpj:digits(issuer.cnpj),
        razaoSocial:clean(issuer.razaoSocial,60),
        nomeFantasia:clean(issuer.nomeFantasia,60)||undefined,
        inscricaoEstadual:clean(issuer.ie,20),
        regimeTributario:Number(issuer.crt),
        endereco:{
          logradouro:clean(issuer.logradouro,60),
          numero:clean(issuer.numero,60),
          complemento:clean(issuer.complemento,60)||undefined,
          bairro:clean(issuer.bairro,60),
          codigoMunicipio:digits(issuer.codigoMunicipio),
          municipio:clean(issuer.municipio,60),
          uf:issuerUf,
          cep:digits(issuer.cep),
          telefone:digits(issuer.phone)||undefined
        }
      },
      destinatario:{
        ...(doc.length===14?{cnpj:doc}:{cpf:doc}),
        nome:clean(customer.name,60),
        indicadorIE:recipientFiscal.indicatorIE,
        ...(recipientFiscal.indicatorIE===1&&recipientFiscal.ie?{inscricaoEstadual:recipientFiscal.ie}:{}),
        email:clean(customer.email,60)||undefined,
        endereco:{
          logradouro:clean(customer.addressData.logradouro,60),
          numero:clean(customer.addressData.numero,60),
          complemento:clean(customer.addressData.complemento,60)||undefined,
          bairro:clean(customer.addressData.bairro,60),
          codigoMunicipio:digits(customer.addressData.codigoMunicipio),
          municipio:clean(customer.addressData.municipio,60),
          uf:custUf,
          cep:digits(customer.addressData.cep),
          telefone:digits(customer.phone)||undefined
        }
      },
      produtos:products,
      transporte:{modalidadeFrete:9},
      ...(cobranca?{cobranca}:{}),
      pagamento:{pagamentos:parts.map(v=>({formaPagamento:code,valor:v}))}
    };
  }

  async function upsertFiscalDocument({order,number,pre,draft,key,protocol,xml,recovered=false,authorizedAt=new Date()}){
    let fiscalDocumentId='';
    const Fiscal=mongoose.models.ErpFiscalHistoricalDocument;
    if(Fiscal&&key){
      const fiscalDoc=await Fiscal.findOneAndUpdate(
        {sourceSystem:'ariana',key},
        {$set:{
          sourceId:`nfe:${key}`,
          saleSourceId:String(order._id),
          key,
          number:String(number),
          series:String(pre.serie),
          total:money(draft.totals.total),
          date:authorizedAt,
          status:'approved',
          recipientName:clean(pre.customer.name,240),
          recipientDocument:digits(pre.customer.document),
          recipientEmail:clean(pre.customer.email,320),
          protocol,
          environment:pre.environment,
          issuerName:clean(pre.issuer.razaoSocial,240),
          issuerDocument:digits(pre.issuer.cnpj),
          natureOperation:clean(pre.issuer.naturezaOperacao,240),
          operationType:'saida',
          documentModel:'55',
          purpose:'normal',
          xml,
          items:pre.products.map(p=>({
            productId:p.id,
            productCode:p.sku,
            description:p.name,
            ncm:digits(p.specs?.ncm),
            cest:digits(p.specs?.cest),
            cfop:p.fiscal?.cfop||digits(p.specs?.cfop||pre.taxation?.defaultCfop),
            unit:p.fiscal?.unit||clean(p.specs?.unit||pre.taxation?.defaultUnit,40),
            quantity:p.qty,
            unitValue:p.unitPrice,
            total:money(p.qty*p.unitPrice)
          })),
          metadata:{
            origin:'ariana_erp',
            orderId:String(order._id),
            recoveredAuthorization:recovered,
            xmlAvailable:Boolean(xml)
          }
        }},
        {upsert:true,new:true,setDefaultsOnInsert:true}
      );
      fiscalDocumentId=String(fiscalDoc?._id||'');
    }
    return fiscalDocumentId;
  }

  async function persistAuthorized({result,order,number,pre,draft,recovered=false}){
    const key=digits(result.chaveAcesso),protocol=clean(result.protocolo,100);
    const xml=String(result.xmlProtocolado||result.xmlAutorizado||result.xml||'');
    const homologation=pre.environment!=='producao';
    const authorizedAt=result.dataAutorizacao instanceof Date?result.dataAutorizacao:new Date();
    const nfeStatus=homologation?'authorized_homologation':'authorized';
    order.fiscalStatus=nfeStatus;
    order.nfe={
      ...(order.nfe||{}),
      status:nfeStatus,
      number:String(number),
      series:String(pre.serie),
      key,
      protocol,
      environment:pre.environment,
      authorizedAt,
      xml,
      recovered:Boolean(recovered),
      xmlUnavailable:!xml,
      lastCStat:'100',
      lastError:''
    };
    await order.save();
    const fiscalDocumentId=await upsertFiscalDocument({order,number,pre,draft,key,protocol,xml,recovered,authorizedAt});
    order.nfe={...(order.nfe||{}),fiscalDocumentId};
    await order.save();
    return{key,protocol,xml,fiscalDocumentId,homologation,recovered:Boolean(recovered),xmlAvailable:Boolean(xml)};
  }

  async function persistRecoveryPending({order,number,pre,key,protocol,authorizedAt}){
    order.fiscalStatus='authorized_recovery_pending';
    order.nfe={
      ...(order.nfe||{}),
      status:'authorized_recovery_pending',
      number:String(number),
      series:String(pre.serie),
      key,
      protocol,
      environment:pre.environment,
      authorizedAt:authorizedAt instanceof Date?authorizedAt:new Date(),
      recovered:true,
      xml:'',
      xmlUnavailable:true,
      lastCStat:'100',
      lastError:''
    };
    await order.save();
    return{
      authorized:true,
      recoveryPending:true,
      billingAllowed:false,
      orderId:String(order._id),
      order,
      key,
      protocol,
      number,
      series:pre.serie,
      environment:pre.environment,
      homologation:false,
      xmlAvailable:false,
      recovered:true
    };
  }

  async function recoverDuplicate({order,number,pre,draft,cert,lib,key}){
    const duplicateKey=digits(key);
    if(!keyMatchesReservation(duplicateKey,pre,number)){
      throw fail(
        'A SEFAZ informou duplicidade, mas a chave retornada não corresponde ao CNPJ, série e número reservados. A emissão foi bloqueada para conferência manual.',
        409,
        'NFE_DUPLICATE_KEY_MISMATCH',
        {orderId:String(order._id),number,key:duplicateKey}
      );
    }
    const transport=createErpSefazTransport();
    const core=lib.NFeCore.create({
      pfx:cert.pfx,
      senha:cert.password,
      ambiente:pre.environment,
      uf:String(pre.issuer.uf||'MG').toUpperCase(),
      transport
    });
    let consult;
    try{
      consult=await core.consultarProtocolo(duplicateKey);
    }catch(error){
      throw fail(
        `A SEFAZ informou que a NF-e já existe, mas não foi possível recuperar o protocolo agora: ${clean(error?.xMotivo||error?.message||error,500)}. Não reenvie a nota.`,
        502,
        'NFE_DUPLICATE_RECOVERY_PENDING',
        {orderId:String(order._id),number,key:duplicateKey}
      );
    }
    if(String(consult?.codigoStatus)!=='100'){
      throw fail(
        `A NF-e duplicada foi localizada com status ${clean(consult?.codigoStatus,20)}. A venda não será faturada automaticamente.`,
        409,
        'NFE_DUPLICATE_NOT_AUTHORIZED',
        {orderId:String(order._id),number,key:duplicateKey,protocol:clean(consult?.protocolo,100)}
      );
    }

    const raw=transport.getLastRawResponse?.()||'';
    const protNFe=extractXmlElement(raw,'protNFe');
    const signedXml=String(order?.nfe?.signedXml||'');
    const signedKey=accessKeyFrom(signedXml.match(/Id="NFe(\d{44})"/)?.[1]||'');
    const canRebuildProc=signedXml&&signedKey===duplicateKey&&protNFe;
    const xmlProtocolado=canRebuildProc?buildNfeProc(signedXml,protNFe):'';

    if(pre.environment==='producao'&&!xmlProtocolado){
      return persistRecoveryPending({
        order,
        number,
        pre,
        key:duplicateKey,
        protocol:clean(consult.protocolo,100),
        authorizedAt:consult.dataAutorizacao
      });
    }

    const fiscal=await persistAuthorized({
      result:{
        chaveAcesso:duplicateKey,
        protocolo:consult.protocolo,
        dataAutorizacao:consult.dataAutorizacao,
        xmlProtocolado
      },
      order,number,pre,draft,recovered:true
    });
    return{
      authorized:true,
      orderId:String(order._id),
      order,
      fiscal,
      number,
      series:pre.serie,
      key:fiscal.key,
      protocol:fiscal.protocol,
      fiscalDocumentId:fiscal.fiscalDocumentId,
      environment:pre.environment,
      homologation:fiscal.homologation,
      billingAllowed:!fiscal.homologation,
      recovered:true,
      xmlAvailable:fiscal.xmlAvailable
    };
  }

  async function transmit(draft={},actor={},existingOrderId=''){
    const pre=await preflight(draft);
    if(!pre.ready)throw fail('A revisão fiscal possui pendências. Corrija antes de emitir.',409,'NFE_PREFLIGHT_BLOCKED',{problems:pre.problems});

    let order=null;
    if(existingOrderId){
      try{order=await Order.findById(existingOrderId)}catch{}
      if(!order)throw fail('Venda pendente não encontrada para nova tentativa.',404,'ORDER_NOT_FOUND');
      if(order?.nfe?.environment&&order.nfe.environment!==pre.environment){
        throw fail('Esta tentativa de NF-e foi iniciada em outro ambiente. Volte para a venda e gere uma nova revisão antes de emitir.',409,'NFE_ENVIRONMENT_CHANGED',{orderId:String(order._id),from:order.nfe.environment,to:pre.environment});
      }
    }
    if(!order&&!existingOrderId){
      const since=new Date(Date.now()-6*60*60*1000);
      const candidates=await Order.find({
        origin:'erp_ariana',
        status:'venda',
        'nfe.environment':pre.environment,
        'nfe.status':{$in:['reserved','error','authorized_homologation','authorized_recovery_pending']},
        createdAt:{$gte:since}
      }).sort({createdAt:-1}).limit(10);
      order=candidates.find(candidate=>orderMatchesDraft(candidate,draft))||null;
    }

    if(order?.nfe?.status==='authorized_homologation'&&order?.nfe?.key){
      return{
        authorized:true,
        homologation:true,
        billingAllowed:false,
        alreadyAuthorized:true,
        recovered:Boolean(order.nfe.recovered),
        xmlAvailable:!order.nfe.xmlUnavailable,
        orderId:String(order._id),
        order,
        key:order.nfe.key,
        protocol:order.nfe.protocol,
        number:order.nfe.number,
        series:order.nfe.series,
        environment:order.nfe.environment,
        fiscalDocumentId:order.nfe.fiscalDocumentId||''
      };
    }
    if(order?.nfe?.status==='authorized_recovery_pending'&&order?.nfe?.key){
      return{
        authorized:true,
        recoveryPending:true,
        billingAllowed:false,
        alreadyAuthorized:true,
        recovered:true,
        xmlAvailable:false,
        orderId:String(order._id),
        order,
        key:order.nfe.key,
        protocol:order.nfe.protocol,
        number:order.nfe.number,
        series:order.nfe.series,
        environment:order.nfe.environment,
        fiscalDocumentId:''
      };
    }
    if(order?.nfe?.status==='authorized'&&order?.nfe?.key){
      return{
        authorized:true,
        homologation:false,
        billingAllowed:true,
        alreadyAuthorized:true,
        orderId:String(order._id),
        order,
        key:order.nfe.key,
        protocol:order.nfe.protocol,
        number:order.nfe.number,
        series:order.nfe.series,
        environment:order.nfe.environment,
        fiscalDocumentId:order.nfe.fiscalDocumentId||''
      };
    }

    if(!order){
      const erpPayload={
        stage:'venda',
        customerName:draft.customer?.name||'Consumidor',
        customerCpf:draft.customer?.document||'',
        customerPhone:draft.customer?.phone||'',
        customerEmail:draft.customer?.email||'',
        shippingAddress:draft.customer?.address||draft.customer?.addressData||null,
        items:(draft.items||[]).map(i=>({
          productId:i.productId,qty:i.qty,unitPrice:i.unitPrice,
          sellerBaseUnitPrice:i.sellerBaseUnitPrice,image:i.image
        })),
        shippingCost:money(draft.totals?.shipping),
        montagemCost:money(draft.totals?.assembly),
        discount:money(draft.totals?.discount),
        notes:clean(draft.notes,5000),
        paymentMethod:draft.payment?.method||'outro',
        installments:Math.max(1,Number(draft.payment?.installments||1)),
        payment:{
          method:draft.payment?.method||'outro',
          installments:Math.max(1,Number(draft.payment?.installments||1)),
          firstDueDate:draft.payment?.firstDueDate||null
        }
      };
      const created=await context.erp.createOrder(erpPayload,actor);
      const createdId=String(created?._id||created?.id||'');
      if(!createdId)throw fail('Não foi possível recuperar a venda pendente criada antes da emissão.',500,'ORDER_CREATE_RELOAD_FAILED');
      order=await Order.findById(createdId);
      if(!order)throw fail('Venda pendente criada não foi localizada para a emissão.',500,'ORDER_CREATE_RELOAD_FAILED');
    }

    let number=Number(order?.nfe?.reservedNumber||0);
    if(!number){
      number=await settings.reserveNfeNumber(actor);
      order.nfe={
        ...(order.nfe||{}),
        status:'reserved',
        reservedNumber:number,
        series:pre.serie,
        environment:pre.environment,
        reservedAt:new Date()
      };
      await order.save();
    }

    const cert=await settings.certificateCredentials();
    const lib=await import('@brasil-fiscal/nfe');

    const previousCStat=clean(order?.nfe?.lastCStat,20);
    const previousError=clean(order?.nfe?.lastError,1000);
    const previousKey=accessKeyFrom(previousError)||digits(order?.nfe?.preparedKey);
    if(['204','539'].includes(previousCStat)&&previousKey){
      return recoverDuplicate({order,number,pre,draft,cert,lib,key:previousKey});
    }

    const environmentMismatch=previousCStat==='252'||/Ambiente informado diverge do Ambiente de recebimento/i.test(previousError);
    if(environmentMismatch){
      order.nfe={
        ...(order.nfe||{}),
        status:'reserved',
        environment:pre.environment,
        lastError:'',
        lastCStat:'',
        unsignedXml:'',
        signedXml:'',
        preparedKey:'',
        draftFingerprint:'',
        preparedAt:null,
        signedAt:null
      };
      await order.save();
    }

    const data=await buildNfeData(draft,pre,number);
    const currentFingerprint=fingerprint(data);
    if(order?.nfe?.draftFingerprint&&order.nfe.draftFingerprint!==currentFingerprint){
      throw fail(
        'Os dados da venda mudaram depois que a NF-e foi preparada. A emissão foi bloqueada para não reutilizar uma chave antiga com dados diferentes.',
        409,
        'NFE_RESERVED_DRAFT_CHANGED',
        {orderId:String(order._id),number}
      );
    }

    let unsignedXml=String(order?.nfe?.unsignedXml||'');
    let preparedKey=digits(order?.nfe?.preparedKey);
    if(!unsignedXml){
      unsignedXml=simplesXmlBuilder(lib.DefaultXmlBuilder).build(data);
      preparedKey=accessKeyFrom(unsignedXml.match(/Id="NFe(\d{44})"/)?.[1]||'');
      if(preparedKey.length!==44)throw fail('Não foi possível obter a chave da NF-e preparada.',500,'NFE_PREPARED_KEY_MISSING',{orderId:String(order._id),number});
      order.nfe={
        ...(order.nfe||{}),
        unsignedXml,
        preparedKey,
        draftFingerprint:currentFingerprint,
        preparedAt:new Date()
      };
      await order.save();
    }else if(!preparedKey){
      preparedKey=accessKeyFrom(unsignedXml.match(/Id="NFe(\d{44})"/)?.[1]||'');
      order.nfe={...(order.nfe||{}),preparedKey,draftFingerprint:currentFingerprint};
      await order.save();
    }

    let signedXml=String(order?.nfe?.signedXml||'');
    const provider=new lib.A1CertificateProvider(cert.pfx,cert.password);
    if(!signedXml){
      const certificateData=await provider.load();
      const signer=new lib.DefaultXmlSigner();
      signedXml=signer.sign(unsignedXml,certificateData);
      order.nfe={...(order.nfe||{}),signedXml,signedAt:new Date()};
      await order.save();
    }

    const frozenBuilder={build:()=>unsignedXml};
    const frozenSigner={sign:()=>signedXml};
    const transport=createErpSefazTransport();
    const core=lib.NFeCore.create({
      pfx:cert.pfx,
      senha:cert.password,
      ambiente:pre.environment,
      uf:String(pre.issuer.uf||'MG').toUpperCase(),
      certificate:provider,
      xmlBuilder:frozenBuilder,
      xmlSigner:frozenSigner,
      transport
    });

    try{
      const result=await core.transmitir(data);
      const fiscal=await persistAuthorized({result,order,number,pre,draft});
      return{
        authorized:true,
        orderId:String(order._id),
        order,
        fiscal,
        number,
        series:pre.serie,
        key:fiscal.key,
        protocol:fiscal.protocol,
        fiscalDocumentId:fiscal.fiscalDocumentId,
        environment:pre.environment,
        homologation:fiscal.homologation,
        billingAllowed:!fiscal.homologation,
        recovered:false,
        xmlAvailable:fiscal.xmlAvailable
      };
    }catch(error){
      const cStat=clean(error?.cStat,20);
      const xMotivo=clean(error?.xMotivo||error?.message||error,1000);
      order.nfe={
        ...(order.nfe||{}),
        status:'error',
        lastError:xMotivo,
        lastCStat:cStat,
        lastAttemptAt:new Date()
      };
      await order.save().catch(()=>{});

      const duplicateKey=accessKeyFrom(xMotivo)||(cStat==='204'?preparedKey:'');
      if(['204','539'].includes(cStat)&&duplicateKey){
        return recoverDuplicate({order,number,pre,draft,cert,lib,key:duplicateKey});
      }

      throw fail(
        error?.xMotivo?`SEFAZ: ${error.xMotivo}`:`Falha na emissão da NF-e: ${clean(error?.message||error,600)}`,
        502,
        'NFE_TRANSMISSION_ERROR',
        {orderId:String(order._id),number,cStat,xMotivo:clean(error?.xMotivo,500),preparedKey}
      );
    }
  }

  return{preflight,testConnection,transmit};
}

export default createErpNfeSefazService;