import { SigeClient } from '../sige/client.js';
import './erpSigeHistoryImportService.js';

const VERSION='2026-09-24-v1';
const clean=(v='',m=2000)=>String(v??'').trim().slice(0,m);
const digits=v=>String(v??'').replace(/\D/g,'');
const num=v=>{
  if(typeof v==='number')return Number.isFinite(v)?v:0;
  const s=String(v??'').trim();
  if(!s)return 0;
  const n=Number(s.includes(',')?s.replace(/\./g,'').replace(',','.'):s);
  return Number.isFinite(n)?n:0;
};
const money=v=>Math.round((num(v)+Number.EPSILON)*100)/100;
const arr=v=>Array.isArray(v)?v:(v===undefined||v===null?[]:[v]);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function first(...values){
  for(const value of values){
    if(value!==undefined&&value!==null&&String(value).trim()!=='')return value;
  }
  return '';
}
function dateOrNull(value){
  if(!value)return null;
  const d=value instanceof Date?value:new Date(value);
  return Number.isNaN(d.getTime())?null:d;
}
function unwrapOrders(raw){
  if(Array.isArray(raw))return raw;
  if(!raw||typeof raw!=='object')return [];
  for(const key of ['data','Data','dados','Dados','pedidos','Pedidos','items','Items','result','Result']){
    if(Array.isArray(raw[key]))return raw[key];
  }
  return [raw];
}
function codeOf(order={}){
  return clean(first(order.Codigo,order.codigo,order.CodigoPedido,order.codigoPedido,order.NumeroPedido,order.numeroPedido,order.Numero,order.numero),120);
}
function idOf(order={}){
  return clean(first(order.ID,order.Id,order.id,order.PedidoID,order.PedidoId),120);
}
function financialCodeOf(entry={}){
  const direct=clean(first(entry.documentNumber,entry.codigo,entry.Codigo),80);
  if(/^\d+$/.test(direct))return direct;
  const match=clean(entry.description,200).match(/\bSIGE\s+(\d+)\b/i);
  return match?.[1]||'';
}
function saleCodeOfFinancialEntry(data={}){
  return clean(first(data.CodigoVenda,data.codigoVenda,data.VendaCodigo,data.vendaCodigo),80);
}
function itemRows(order={}){
  return arr(first(order.Items,order.items,order.Itens,order.itens,order.Produtos,order.produtos));
}
function paymentRows(order={}){
  return arr(first(order.Pagamentos,order.pagamentos,order.Payments,order.payments));
}
function normalizeItems(order={}){
  return itemRows(order).map((item,index)=>({
    sourceId:clean(first(item.ID,item.Id,item.id,item.ItemID,item.ItemId),120),
    productSourceId:clean(first(item.ProdutoID,item.ProdutoId,item.ProductID,item.ProductId,item.productId),120),
    code:clean(first(item.Codigo,item.codigo,item.SKU,item.Sku,item.sku),120),
    description:clean(first(item.Descricao,item.descricao,item.Nome,item.nome,item.Produto,item.produto,`Item ${index+1}`),300),
    quantity:num(first(item.Quantidade,item.quantidade,item.Qtd,item.qtd,1)),
    unitPrice:money(first(item.ValorUnitario,item.valorUnitario,item.PrecoUnitario,item.precoUnitario,item.PrecoVenda,item.precoVenda)),
    subtotal:money(first(item.ValorTotal,item.valorTotal,item.SubTotal,item.subTotal,item.Total,item.total)),
    ncm:clean(first(item.NCM,item.Ncm,item.ncm),40),
    cfop:clean(first(item.CFOP,item.Cfop,item.cfop),40),
    unit:clean(first(item.Unidade,item.unidade,item.Unit,item.unit),40)
  })).filter(item=>item.description||item.code);
}
function normalizePayments(order={}){
  return paymentRows(order).map((p,index)=>({
    index:index+1,
    method:clean(first(p.FormaPagamento,p.formaPagamento,p.Metodo,p.metodo,p.Method,p.method),120),
    condition:clean(first(p.CondicaoPagamento,p.condicaoPagamento,p.Condicao,p.condicao),160),
    installments:Number(first(p.Parcelas,p.parcelas,p.NumeroParcelas,p.numeroParcelas,0))||0,
    period:Number(first(p.PeriodoParcelas,p.periodoParcelas,0))||0,
    value:money(first(p.ValorPagamento,p.valorPagamento,p.Valor,p.valor,p.Total,p.total)),
    transactionAt:dateOrNull(first(p.DataTransacao,p.dataTransacao,p.Data,p.data))
  }));
}
export function normalizeSigeHistoricalPurchase(order={},fallback={}){
  const items=normalizeItems(order);
  const payments=normalizePayments(order);
  const invoice={
    number:clean(first(order.NumeroNFe,order.numeroNFe,order.NFe,order.NF,order.NotaFiscal,order.notaFiscal),80),
    serie:clean(first(order.SerieNFe,order.serieNFe,order.Serie,order.serie),40),
    accessKey:clean(first(order.ChaveAcessoNFe,order.chaveAcessoNFe,order.ChaveAcesso,order.chaveAcesso),80),
    protocol:clean(first(order.ProtocoloNFe,order.protocoloNFe,order.Protocolo,order.protocolo),100),
    status:clean(first(order.StatusNFe,order.statusNFe,order.SituacaoNFe,order.situacaoNFe),120)
  };
  const total=money(first(order.ValorFinal,order.valorFinal,order.Total,order.total,fallback.total));
  const shipping=money(first(order.ValorFrete,order.valorFrete,order.Frete,order.frete,fallback.shipping));
  const subtotal=money(first(order.SubTotal,order.subTotal,order.Subtotal,order.subtotal,total-shipping,fallback.subtotal));
  return{
    code:codeOf(order)||clean(fallback.code,120),
    origin:clean(first(order.OrigemVenda,order.origemVenda,order.Origem,order.origem),120),
    status:clean(first(order.Status,order.status,order.StatusSistema,order.statusSistema,fallback.status),120),
    systemStatus:clean(first(order.StatusSistema,order.statusSistema),120),
    category:clean(first(order.Categoria,order.categoria),160),
    company:clean(first(order.Empresa,order.empresa),180),
    sellerName:clean(first(order.Vendedor,order.vendedor,fallback.sellerName),180),
    customer:{
      sourceId:clean(first(order.ClienteID,order.ClienteId,order.clienteId,fallback.customerSourceId),120),
      name:clean(first(order.Cliente,order.cliente,order.NomeCliente,order.nomeCliente,fallback.customerName),220),
      document:digits(first(order.ClienteCNPJ,order.ClienteCPF,order.CpfCnpj,order.cpfCnpj,fallback.customerDocument)),
      email:clean(first(order.ClienteEmail,order.clienteEmail),220),
      phone:digits(first(order.ClienteTelefone,order.clienteTelefone,order.Telefone,order.telefone))
    },
    dates:{
      saleAt:dateOrNull(first(order.Data,order.data,order.DataVenda,order.dataVenda,fallback.date)),
      createdAt:dateOrNull(first(order.DataCadastro,order.dataCadastro)),
      approvedAt:dateOrNull(first(order.DataAprovacaoPedido,order.dataAprovacaoPedido)),
      billedAt:dateOrNull(first(order.DataFaturamento,order.dataFaturamento))
    },
    totals:{subtotal,shipping,total},
    paymentCondition:clean(first(order.CondicaoPagamento,order.condicaoPagamento,order.FormaPagamento,order.formaPagamento,fallback.paymentCondition),160),
    numberOfInstallments:Number(first(order.NumeroParcelas,order.numeroParcelas,payments[0]?.installments,0))||0,
    items,
    payments,
    invoice,
    rawKeys:Object.keys(order||{}).slice(0,200)
  };
}
function updateKnownFields(purchase={},sale={}){
  const set={};
  if(purchase.code)set.code=purchase.code;
  if(purchase.customer?.sourceId)set.customerSourceId=purchase.customer.sourceId;
  if(purchase.customer?.name)set.customerName=purchase.customer.name;
  if(purchase.customer?.document)set.customerDocument=purchase.customer.document;
  if(purchase.dates?.saleAt)set.date=purchase.dates.saleAt;
  if(purchase.status)set.status=purchase.status;
  if(purchase.sellerName)set.sellerName=purchase.sellerName;
  if(purchase.totals?.subtotal>0)set.subtotal=purchase.totals.subtotal;
  if(purchase.totals?.shipping>=0)set.shipping=purchase.totals.shipping;
  if(purchase.totals?.total>0)set.total=purchase.totals.total;
  if(purchase.paymentCondition)set.paymentCondition=purchase.paymentCondition;
  if(purchase.invoice?.number)set.invoiceNumber=purchase.invoice.number;
  if(purchase.invoice?.serie)set.invoiceSerie=purchase.invoice.serie;
  if(purchase.invoice?.status)set.invoiceStatus=purchase.invoice.status;
  if(purchase.items?.length)set.items=purchase.items.map(item=>({
    sourceId:item.sourceId||'',
    productSourceId:item.productSourceId||'',
    productId:'',
    description:item.description||item.code||'',
    quantity:item.quantity||1,
    unitPrice:item.unitPrice||0,
    subtotal:item.subtotal||0,
    code:item.code||'',
    ncm:item.ncm||'',
    cfop:item.cfop||'',
    unit:item.unit||''
  }));
  return set;
}
function chooseOrder(responseData,code){
  const rows=unwrapOrders(responseData);
  if(!rows.length)return null;
  const wanted=String(code||'').trim();
  return rows.find(row=>codeOf(row)===wanted)||rows[0]||null;
}
export function createErpSigeHistoricalPurchaseEnrichmentService(context={}){
  const mongoose=context.mongoose;
  if(!mongoose)throw new Error('[erp-sige-enrichment] mongoose não informado');
  const client=new SigeClient();
  const state=globalThis.__arianaSigeHistoricalPurchaseEnrichment||(globalThis.__arianaSigeHistoricalPurchaseEnrichment={running:false,last:null});

  function models(){
    return{
      Sale:mongoose.models.ErpSigeHistoricalSale||null,
      Run:mongoose.models.ErpMigrationRun||null,
      Entry:mongoose.models.ErpFinancialEntry||null
    };
  }
  async function waitForModels(timeoutMs=45000){
    const started=Date.now();
    while(Date.now()-started<timeoutMs){
      const m=models();
      if(m.Sale)return m;
      await wait(500);
    }
    return models();
  }
  async function status(){
    const {Sale,Run}=await waitForModels(1000);
    if(!Sale)return{available:false,running:state.running,last:state.last,reason:'historical_sale_model_unavailable'};
    const [total,enriched,pending,latestRun]=await Promise.all([
      Sale.countDocuments({sourceSystem:'sige'}),
      Sale.countDocuments({sourceSystem:'sige','metadata.sigeEnrichment.version':VERSION,'metadata.sigeEnrichment.status':'success'}),
      Sale.countDocuments({sourceSystem:'sige',$or:[
        {'metadata.sigeEnrichment.version':{$ne:VERSION}},
        {'metadata.sigeEnrichment.status':{$ne:'success'}}
      ]}),
      Run?Run.findOne({source:'sige',scope:'historical-purchase-enrichment'}).sort({createdAt:-1}).lean():null
    ]);
    return{available:true,running:state.running,last:state.last,total,enriched,pending,latestRun};
  }
  async function sigeCall(fn,label='consulta'){
    let result=null;
    for(let attempt=1;attempt<=3;attempt++){
      try{
        result=await fn();
        return result;
      }catch(error){
        const message=clean(error?.message||error,1000);
        const limited=Number(error?.statusCode||0)===429||/limite de requisições|rate limit|too many requests/i.test(message);
        if(!limited||attempt>=3)throw error;
        const pauseMs=65000*attempt;
        console.warn(`[erp-sige-enrichment] limite do SIGE em ${label}; nova tentativa em ${Math.round(pauseMs/1000)}s.`);
        await wait(pauseMs);
      }
    }
    return result;
  }
  async function sigeRequest(params={},label='consulta'){
    return sigeCall(()=>client.pesquisarPedidos(params),label);
  }
  async function sigeFinancialEntry(codigo){
    return sigeCall(
      ()=>client.get('/request/Lancamentos/Get',{codigo:Number(codigo)}),
      `consulta do lançamento ${codigo}`
    );
  }

  async function buildOrderIndex(targetIds=[]){
    const wanted=new Set((Array.isArray(targetIds)?targetIds:[]).map(v=>clean(v,120)).filter(Boolean));
    const found=new Map();
    if(!wanted.size)return found;

    let previousSignature='';
    for(let page=1;page<=500&&found.size<wanted.size;page++){
      let result=null;
      try{
        result=await sigeCall(()=>client.getTodosPedidos(page),`índice de pedidos página ${page}`);
      }catch(error){
        console.warn('[erp-sige-enrichment] falha ao listar pedidos para índice',{
          page,
          statusCode:Number(error?.statusCode||0),
          response:error?.responseData||null
        });
        break;
      }
      const rows=unwrapOrders(result?.data);
      if(!rows.length)break;

      const signature=rows.slice(0,5).map(row=>idOf(row)||codeOf(row)).join('|');
      if(page>1&&signature&&signature===previousSignature){
        console.warn('[erp-sige-enrichment] paginação de pedidos repetiu a mesma página; índice interrompido',{page});
        break;
      }
      previousSignature=signature;

      for(const row of rows){
        const id=idOf(row);
        if(id&&wanted.has(id)&&!found.has(id))found.set(id,row);
      }

      console.log('[erp-sige-enrichment] índice de pedidos',{
        page,
        rows:rows.length,
        matched:found.size,
        target:wanted.size
      });

      if(rows.length<2)break;
      if(found.size>=wanted.size)break;
      await wait(4000);
    }
    return found;
  }

  function orphanFallback(entries=[]){
    const rows=Array.isArray(entries)?entries:[];
    const firstRow=rows[0]||{};
    const dates=rows.map(r=>dateOrNull(r.competenceAt||r.createdAt||r.dueAt)).filter(Boolean).sort((a,b)=>a-b);
    return{
      customerName:clean(firstRow.personName,220),
      customerDocument:digits(firstRow.personDocument),
      customerSourceId:clean(firstRow?.migration?.sourcePersonId,120),
      date:dates[0]||null,
      total:money(rows.reduce((sum,row)=>sum+Number(row.value||0),0)),
      paymentCondition:clean(firstRow.paymentMethod,160),
      status:'Histórico recuperado do SIGE'
    };
  }

  async function recoverMissingSale(sourceSaleId,{force=false,orderIndex=null}={}){
    const sid=clean(sourceSaleId,120);
    if(!sid)return null;
    const {Sale,Entry}=await waitForModels(1500);
    if(!Sale||!Entry)return null;

    const existing=await Sale.findOne({sourceSystem:'sige',sourceId:sid});
    if(existing)return existing;

    const entries=await Entry.collection.find({
      direction:'receivable',
      'migration.sourceSaleId':sid
    }).sort({dueAt:1,createdAt:1}).toArray();
    if(!entries.length)return null;

    const fallback=orphanFallback(entries);
    const personName=clean(fallback.customerName,220);
    const personDocument=digits(fallback.customerDocument);

    // Caminho determinístico preferencial:
    // índice completo de pedidos do SIGE -> ID interno exatamente igual ao sourceSaleId.
    let raw=orderIndex instanceof Map?(orderIndex.get(sid)||null):null,result=null,matchedBy=raw?'get_all_orders_exact_sale_id':'';
    const financialCodes=[...new Set(entries.map(financialCodeOf).filter(Boolean))].slice(0,4);

    // Fallback adicional: código do lançamento -> CodigoVenda -> pedido.
    // Só é usado quando CodigoVenda é válido (> 0) e o ID interno também confere.
    if(!raw)
    for(const financialCode of financialCodes){
      try{
        const launch=await sigeFinancialEntry(financialCode);
        const saleCode=saleCodeOfFinancialEntry(launch?.data||{});
        if(!saleCode||Number(saleCode)<=0)continue;
        await wait(4000);
        result=await sigeRequest({codigo:Number(saleCode)},`venda ${saleCode} vinculada ao lançamento ${financialCode}`);
        const rows=unwrapOrders(result?.data);
        const exact=rows.find(row=>idOf(row)===sid)||null;
        if(exact){
          raw=exact;
          matchedBy='financial_entry_code_to_sale_code_and_sale_id';
          break;
        }
        console.warn('[erp-sige-enrichment] CodigoVenda retornado, mas ID interno não conferiu',{
          sourceSaleId:sid,
          financialCode,
          saleCode,
          returnedIds:rows.slice(0,5).map(idOf).filter(Boolean)
        });
      }catch(error){
        console.warn('[erp-sige-enrichment] ponte lançamento->venda falhou',{
          sourceSaleId:sid,
          financialCode,
          statusCode:Number(error?.statusCode||0),
          response:error?.responseData||null
        });
      }
      await wait(4000);
    }

    const queries=[];
    const referenceDate=dateOrNull(fallback.date);
    if(referenceDate){
      const from=new Date(referenceDate);from.setUTCDate(from.getUTCDate()-2);from.setUTCHours(0,0,0,0);
      const to=new Date(referenceDate);to.setUTCDate(to.getUTCDate()+2);to.setUTCHours(23,59,59,999);
      const dateParams={dataInicial:from.toISOString(),dataFinal:to.toISOString()};
      // O SIGE permite escolher qual data da venda será filtrada.
      // Testamos os quatro marcos possíveis, sempre mantendo cliente/documento
      // e só aceitando ID interno exatamente igual ao sourceSaleId.
      for(const filtrarPor of [0,1,2,3]){
        if(personDocument)queries.push({
          label:`customer_document_date_${filtrarPor}_and_sale_id`,
          params:{cpf_cnpj:personDocument,...dateParams,filtrarPor}
        });
        if(personName)queries.push({
          label:`customer_name_date_${filtrarPor}_and_sale_id`,
          params:{cliente:personName,...dateParams,filtrarPor}
        });
      }
    }
    if(personDocument)queries.push({label:'customer_document_and_sale_id',params:{cpf_cnpj:personDocument}});
    if(personName)queries.push({label:'customer_name_and_sale_id',params:{cliente:personName}});

    if(!raw)for(const query of queries){
      // O SIGE é mais estável quando a primeira consulta não força paginação.
      // Só pagina em blocos pequenos quando a resposta atingir o limite.
      let firstRows=[];
      try{
        result=await sigeRequest(query.params,`recuperação da venda ${sid}`);
        firstRows=unwrapOrders(result?.data);
      }catch(error){
        console.warn('[erp-sige-enrichment] filtro simples rejeitado pelo SIGE',{
          sourceSaleId:sid,
          filter:Object.keys(query.params),
          statusCode:Number(error?.statusCode||0),
          response:error?.responseData||null
        });
        continue;
      }

      raw=firstRows.find(row=>idOf(row)===sid)||null;
      if(raw){matchedBy=query.label;break}

      // O SIGE retorna 5 pedidos por padrão nessa busca. Mesmo quando vierem
      // apenas 5 linhas, isso pode ser só a primeira página e não o fim.
      const defaultPageSize=Math.max(1,firstRows.length||5);
      if(firstRows.length){
        let previousSignature=firstRows.map(row=>idOf(row)||codeOf(row)).join('|');
        for(let page=1;page<100&&!raw;page++){
          const params={...query.params,skip:page*defaultPageSize};
          try{
            result=await sigeRequest(params,`paginação da venda ${sid}`);
          }catch(error){
            console.warn('[erp-sige-enrichment] paginação rejeitada pelo SIGE',{
              sourceSaleId:sid,
              page,
              skip:page*defaultPageSize,
              statusCode:Number(error?.statusCode||0),
              response:error?.responseData||null
            });
            break;
          }
          const rows=unwrapOrders(result?.data);
          if(!rows.length)break;
          const signature=rows.map(row=>idOf(row)||codeOf(row)).join('|');
          if(signature&&signature===previousSignature)break;
          previousSignature=signature;

          raw=rows.find(row=>idOf(row)===sid)||null;
          if(raw){matchedBy=query.label+'_paginated';break}
          if(rows.length<defaultPageSize)break;
          await wait(4000);
        }
      }
      if(raw)break;
    }

    if(!raw){
      console.warn('[erp-sige-enrichment] compra histórica órfã não localizada no SIGE',{
        sourceSaleId:sid,
        customerName:personName||'',
        customerDocument:personDocument?'informado':'ausente',
        referenceDate:referenceDate?referenceDate.toISOString():''
      });
      return null;
    }

    const purchase=normalizeSigeHistoricalPurchase(raw,fallback);
    const known=updateKnownFields(purchase,fallback);
    const metadata={
      recovery:{
        source:'financial_entry_sourceSaleId',
        matchedBy,
        sourceSaleId:sid,
        financialCodes,
        referenceDate:referenceDate||null,
        recoveredAt:new Date(),
        entryCount:entries.length,
        financeUntouched:true
      },
      sigeLive:purchase,
      sigeEnrichment:{
        version:VERSION,
        status:'success',
        at:new Date(),
        code:purchase.code||'',
        endpoint:'/request/Pedidos/Pesquisar',
        elapsedMs:result?.elapsedMs||0,
        financeUntouched:true,
        recoveredOrphan:true
      }
    };
    try{
      return await Sale.create({
        sourceSystem:'sige',
        sourceId:sid,
        ...known,
        metadata
      });
    }catch(error){
      if(Number(error?.code)===11000)return Sale.findOne({sourceSystem:'sige',sourceId:sid});
      throw error;
    }
  }

  async function one(sale,{force=false}={}){
    if(!sale)return{ok:false,reason:'sale_missing'};
    const current=sale.toObject?sale.toObject():sale;
    if(!force&&current?.metadata?.sigeEnrichment?.version===VERSION&&current?.metadata?.sigeEnrichment?.status==='success'){
      return{ok:true,skipped:true,reason:'already_enriched',sourceId:current.sourceId,code:current.code};
    }
    const code=clean(current.code,120);
    if(!code){
      await sale.updateOne({$set:{
        'metadata.sigeEnrichment':{version:VERSION,status:'skipped',reason:'missing_sale_code',at:new Date()}
      }});
      return{ok:false,skipped:true,reason:'missing_sale_code',sourceId:current.sourceId};
    }
    const result=await sigeRequest({codigo:code},`consulta da venda ${code}`);
    const raw=chooseOrder(result?.data,code);
    if(!raw){
      await sale.updateOne({$set:{
        'metadata.sigeEnrichment':{version:VERSION,status:'not_found',code,at:new Date()}
      }});
      return{ok:false,reason:'not_found',sourceId:current.sourceId,code};
    }
    const purchase=normalizeSigeHistoricalPurchase(raw,current);
    const known=updateKnownFields(purchase,current);
    const metadata={...(current.metadata||{})};
    metadata.sigeLive=purchase;
    metadata.sigeEnrichment={
      version:VERSION,
      status:'success',
      at:new Date(),
      code,
      endpoint:'/request/Pedidos/Pesquisar',
      elapsedMs:result.elapsedMs||0,
      financeUntouched:true
    };
    await sale.updateOne({$set:{...known,metadata}});
    return{
      ok:true,
      sourceId:current.sourceId,
      code,
      items:purchase.items.length,
      payments:purchase.payments.length,
      total:purchase.totals.total,
      installments:purchase.numberOfInstallments
    };
  }
  async function syncAll({force=false,actor='Sistema',delayMs=4000}={}){
    if(state.running)return{started:false,reason:'already_running',status:await status()};
    state.running=true;
    state.last={startedAt:new Date(),status:'running'};
    let run=null;
    try{
      client.ensureConfigured();
      const {Sale,Run}=await waitForModels();
      if(!Sale)throw new Error('Modelo ErpSigeHistoricalSale indisponível.');
      const filter={sourceSystem:'sige'};
      if(!force)filter.$or=[
        {'metadata.sigeEnrichment.version':{$ne:VERSION}},
        {'metadata.sigeEnrichment.status':{$ne:'success'}}
      ];

      const Entry=mongoose.models.ErpFinancialEntry||null;
      let orphanIds=[];
      if(Entry){
        const linkedIds=(await Entry.collection.distinct('migration.sourceSaleId',{
          direction:'receivable',
          'migration.sourceSaleId':{$nin:['',null]}
        })).map(v=>clean(v,120)).filter(Boolean);
        if(linkedIds.length){
          const existingIds=await Sale.distinct('sourceId',{sourceSystem:'sige',sourceId:{$in:linkedIds}});
          const existingSet=new Set(existingIds.map(v=>String(v)));
          orphanIds=linkedIds.filter(id=>!existingSet.has(String(id)));
        }
      }

      const total=await Sale.countDocuments(filter);
      console.log('[erp-sige-enrichment] iniciando', {version:VERSION,total,orphanPurchases:orphanIds.length,force,delayMs,financeUntouched:true});
      if(Run)run=await Run.create({
        source:'sige',
        scope:'historical-purchase-enrichment',
        status:'running',
        actor:clean(actor,180)||'Sistema',
        startedAt:new Date(),
        stats:{version:VERSION,total,processed:0,updated:0,skipped:0,failed:0,financeUntouched:true}
      });
      const stats={version:VERSION,total,processed:0,updated:0,skipped:0,failed:0,notFound:0,items:0,payments:0,orphanTotal:orphanIds.length,orphanRecovered:0,orphanNotFound:0,financeUntouched:true};

      // Não percorre GetTodosPedidos automaticamente: em produção a listagem atual
      // não contém os IDs das compras órfãs antigas. A recuperação usa primeiro
      // cliente/documento + período e confirma o sourceSaleId exato.
      const orphanOrderIndex=new Map();
      if(orphanIds.length)console.log('[erp-sige-enrichment] recuperação direta de compras órfãs',{
        orphanTargets:orphanIds.length,
        strategy:'customer_period_exact_sourceSaleId',
        financeUntouched:true
      });

      for(const sid of orphanIds){
        try{
          const recovered=await recoverMissingSale(sid,{force,orderIndex:orphanOrderIndex});
          if(recovered)stats.orphanRecovered++;
          else stats.orphanNotFound++;
        }catch(error){
          stats.failed++;
          console.error('[erp-sige-enrichment] falha ao recuperar compra órfã',sid,error?.message||error);
        }
        if(delayMs>0)await wait(delayMs);
      }

      const cursor=Sale.find(filter).sort({date:1,_id:1}).cursor();
      for await(const sale of cursor){
        try{
          const result=await one(sale,{force});
          stats.processed++;
          if(result.ok&&!result.skipped){stats.updated++;stats.items+=Number(result.items||0);stats.payments+=Number(result.payments||0)}
          else if(result.reason==='not_found'){stats.notFound++;stats.skipped++}
          else stats.skipped++;
        }catch(error){
          stats.processed++;stats.failed++;
          await sale.updateOne({$set:{
            'metadata.sigeEnrichment':{
              version:VERSION,
              status:'error',
              error:clean(error?.message||error,1000),
              at:new Date()
            }
          }}).catch(()=>null);
        }
        if(stats.processed%10===0||stats.processed===stats.total){
          console.log('[erp-sige-enrichment] progresso', {
            processed:stats.processed,
            total:stats.total,
            updated:stats.updated,
            skipped:stats.skipped,
            failed:stats.failed,
            notFound:stats.notFound,
            financeUntouched:true
          });
        }
        if(run&&stats.processed%10===0){
          run.stats={...stats,heartbeatAt:new Date()};
          await run.save().catch(()=>null);
        }
        if(delayMs>0)await wait(delayMs);
      }
      if(run){
        run.status=stats.failed?'completed_with_warnings':'completed';
        run.stats={...stats,heartbeatAt:new Date()};
        run.finishedAt=new Date();
        run.warnings=stats.failed?[clean(`${stats.failed} compra(s) não puderam ser consultadas no SIGE nesta execução.`,500)]:[];
        await run.save();
      }
      state.last={startedAt:state.last.startedAt,finishedAt:new Date(),status:stats.failed?'completed_with_warnings':'completed',stats};
      return{started:true,completed:true,stats,runId:run?String(run._id):''};
    }catch(error){
      if(run){
        run.status='failed';
        run.finishedAt=new Date();
        run.warnings=[clean(error?.message||error,1000)];
        await run.save().catch(()=>null);
      }
      state.last={startedAt:state.last?.startedAt||new Date(),finishedAt:new Date(),status:'failed',error:clean(error?.message||error,1000)};
      throw error;
    }finally{
      state.running=false;
    }
  }
  async function startInBackground(options={}){
    if(state.running)return{started:false,reason:'already_running'};
    setImmediate(()=>syncAll(options).then(result=>{
      console.log('[erp-sige-enrichment] concluído',result?.stats||result);
    }).catch(error=>{
      console.error('[erp-sige-enrichment] falha:',error?.message||error);
    }));
    return{started:true,background:true};
  }
  async function financialSnapshot(sourceSaleId){
    const sid=clean(sourceSaleId,120);
    const {Entry}=await waitForModels(1000);
    if(!Entry||!sid)return null;
    const entries=await Entry.collection.find({
      direction:'receivable',
      'migration.sourceSaleId':sid
    }).sort({dueAt:1,createdAt:1}).toArray();
    if(!entries.length)return null;

    const fallback=orphanFallback(entries);
    const codes=[...new Set(entries.map(financialCodeOf).filter(Boolean))];
    const paymentMethods=[...new Set(entries.map(r=>clean(r.paymentMethod,120)).filter(Boolean))];
    const statuses={
      paid:entries.filter(r=>String(r.status||'')==='paid').length,
      pending:entries.filter(r=>String(r.status||'')==='pending').length,
      partial:entries.filter(r=>Number(r.paidValue||0)>0&&String(r.status||'')!=='paid').length
    };
    const rows=entries.map((r,index)=>({
      number:index+1,
      code:financialCodeOf(r),
      value:money(r.value),
      paidValue:money(r.paidValue),
      dueAt:r.dueAt||null,
      competenceAt:r.competenceAt||null,
      status:clean(r.status,40),
      paymentMethod:clean(r.paymentMethod,120)
    }));
    return{
      sourceSystem:'sige',
      sourceId:sid,
      code:'',
      customerSourceId:clean(entries[0]?.migration?.sourcePersonId,120),
      customerName:fallback.customerName||'Cadastro histórico',
      customerDocument:fallback.customerDocument||'',
      date:fallback.date||null,
      status:'Ficha comercial original pendente de recuperação',
      billed:false,
      sellerName:'',
      subtotal:money(entries.reduce((sum,row)=>sum+Number(row.value||0),0)),
      shipping:0,
      total:money(entries.reduce((sum,row)=>sum+Number(row.value||0),0)),
      paymentCondition:paymentMethods.join(' / '),
      invoiceNumber:'',
      invoiceSerie:'',
      invoiceStatus:'',
      items:[],
      metadata:{
        recovery:{
          partial:true,
          source:'financial_snapshot',
          sourceSaleId:sid,
          financeUntouched:true,
          generatedAt:new Date()
        },
        financialSnapshot:{
          installments:entries.length,
          codes,
          paymentMethods,
          statuses,
          rows
        }
      }
    };
  }

  async function purchase(sourceSaleId){
    const {Sale}=await waitForModels(1000);
    if(!Sale)throw new Error('Histórico de vendas do Ariana ERP indisponível.');
    const sid=clean(sourceSaleId,120);
    let sale=await Sale.findOne({sourceSystem:'sige',sourceId:sid}).lean();
    if(!sale){
      const recovered=await recoverMissingSale(sid);
      sale=recovered?(recovered.toObject?recovered.toObject():recovered):null;
    }
    if(!sale) sale=await financialSnapshot(sid);
    if(!sale){
      const e=new Error('Não foi possível localizar dados históricos desta compra. O financeiro permanece preservado.');e.statusCode=404;throw e;
    }
    return sale;
  }
  return{VERSION,status,one,syncAll,startInBackground,purchase,recoverMissingSale,buildOrderIndex,financialSnapshot};
}
export default createErpSigeHistoricalPurchaseEnrichmentService;
