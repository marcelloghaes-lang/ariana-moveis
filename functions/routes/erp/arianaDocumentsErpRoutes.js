import express from 'express';
import { createErpPeopleService } from '../../services/erp/erpPeopleService.js';
import { createErpProductService } from '../../services/erp/erpProductService.js';
import { createErpService } from '../../services/erp/erpService.js';

const clean=(value='',max=500)=>String(value??'').trim().slice(0,max);
const digits=(value='')=>String(value??'').replace(/\D/g,'');
const money=(value=0)=>Math.round((Number(value||0)+Number.EPSILON)*100)/100;

function legacyClient(person={}){
  const address=person.address||{};
  const document=digits(person.document||'');
  return{
    id:String(person.id||person._id||''),
    nome:clean(person.name||person.companyName,220),
    razaoSocial:clean(person.companyName||person.name,220),
    documento:document,
    cpf:document.length===11?document:'',
    cnpj:document.length===14?document:'',
    email:clean(person.email,320),
    telefone:clean(person.phone,40),
    tipoPessoa:clean(person.personType,80),
    logradouro:clean(address.street,220),
    numero:clean(address.number,80),
    complemento:clean(address.complement,220),
    bairro:clean(address.neighborhood,160),
    cidade:clean(address.city,160),
    uf:clean(address.stateCode||address.state,20),
    cep:digits(address.zipCode).slice(0,8),
    endereco:clean(person.addressText||'',500),
    ativo:person.active!==false,
    fonte:'ariana_erp',
    origemOriginal:clean(person.source,80)
  };
}

function legacyProduct(product={}){
  const specs=product.specs||{};
  const fiscal=product.fiscal||{};
  return{
    id:String(product.id||product._id||''),
    codigo:clean(product.sku||product.code||product.codigo,120),
    ean:digits(fiscal.ean||specs.ean||specs.barcode||specs.gtin).slice(0,14),
    nome:clean(product.name,260),
    marca:clean(product.brand,160),
    modelo:clean(specs.modelo||specs.model,160),
    especificacao:clean(product.description||specs.especificacao||specs.description,3000),
    unidade:clean(fiscal.unit||specs.unit||specs.unidade||'UN',10).toUpperCase(),
    numeroSerie:clean(specs.numeroSerie||specs.serialNumber||specs.serial,160),
    precoVenda:money(product.price),
    precoMinimoVenda:product.pixPrice===null||product.pixPrice===undefined?null:money(product.pixPrice),
    estoqueSaldo:Number(product.stock||0),
    categoria:clean(product.category,180),
    ativo:product.active!==false,
    imagem:clean(product.image,1000),
    fonte:'ariana_erp'
  };
}

function saleForDocuments(order={}){
  const erp=order?.televendas?.erp||{};
  const address=order.shippingAddress||{};
  const receivables=Array.isArray(erp.receivables)?erp.receivables:[];
  return{
    id:String(order._id||order.id||''),
    codigo:clean(erp.code||order.code||'',120),
    status:clean(order.status,60),
    statusLabel:clean(order.statusLabel||order.status,120),
    cliente:{
      nome:clean(order.customerName,220),
      cpf:digits(order.customerCpf).slice(0,14),
      email:clean(order.customerEmail,320),
      telefone:clean(order.customerPhone,40),
      endereco:address
    },
    itens:(Array.isArray(order.items)?order.items:[]).map(item=>({
      productId:String(item.productId||''),
      nome:clean(item.name,260),
      codigo:clean(item.sku,120),
      quantidade:Number(item.qty||item.quantity||1),
      valorUnitario:money(item.unitPrice||item.price),
      valorTotal:money(item.totalPrice)
    })),
    subtotal:money(order.subtotal),
    desconto:money(erp.discount),
    frete:money(order.shippingCost),
    montagem:money(order.montagemCost),
    total:money(order.total),
    pagamento:order.payment||{},
    parcelas:receivables,
    criadoEm:order.createdAt||null,
    atualizadoEm:order.updatedAt||null,
    fonte:'ariana_erp'
  };
}

export default function createArianaDocumentsErpRoutes(context={}){
  const router=express.Router();
  if(!context.adminRequired)throw new Error('[ariana-documents-erp] adminRequired não informado');
  if(!context.User)throw new Error('[ariana-documents-erp] User não informado');
  if(!context.Product)throw new Error('[ariana-documents-erp] Product não informado');
  if(!context.Order)throw new Error('[ariana-documents-erp] Order não informado');

  const people=createErpPeopleService(context);
  const products=createErpProductService(context);
  const erp=createErpService(context);

  const sendError=(res,error,fallback)=>{
    console.error('[ariana-documents-erp]',error?.message||error);
    return res.status(Number(error?.statusCode||500)).json({
      ok:false,
      error:error?.message||fallback,
      code:error?.code||'ARIANA_DOCUMENTS_ERP_ERROR',
      fonte:'ariana_erp'
    });
  };

  async function getClients(req,res){
    try{
      const q=clean(req.query?.q||req.query?.nome||req.query?.search,160);
      const limit=Math.min(200,Math.max(1,Number(req.query?.limit||50)));
      const result=await people.list({q,limit});
      const clientes=(result.people||[]).map(legacyClient);
      return res.json({ok:true,clientes,total:clientes.length,fonte:'ariana_erp',directErp:true});
    }catch(error){return sendError(res,error,'Erro ao consultar clientes do Ariana ERP.');}
  }

  async function getProducts(req,res){
    try{
      const q=clean(req.query?.q||req.query?.nome||req.query?.codigo||req.query?.search,160);
      const limit=Math.min(100,Math.max(1,Number(req.query?.limit||30)));
      if(q.length<2)return res.status(400).json({ok:false,error:'Informe ao menos 2 caracteres para pesquisar o produto.',fonte:'ariana_erp'});
      const rows=await products.list({q,limit,includeInactive:req.query?.includeInactive==='1'?'1':'0'});
      const produtos=rows.map(legacyProduct);
      return res.json({ok:true,produtos,total:produtos.length,fonte:'ariana_erp',directErp:true});
    }catch(error){return sendError(res,error,'Erro ao consultar produtos do Ariana ERP.');}
  }

  router.get('/admin/ariana-sign/erp/status',context.adminRequired,async(_req,res)=>res.json({
    ok:true,
    fonte:'ariana_erp',
    directErp:true,
    sigeConsultado:false,
    recursos:['clientes','produtos','vendas']
  }));
  router.get('/admin/ariana-sign/erp/clientes',context.adminRequired,getClients);
  router.get('/admin/ariana-sign/erp/produtos',context.adminRequired,getProducts);
  router.get('/admin/ariana-sign/erp/vendas',context.adminRequired,async(req,res)=>{
    try{
      const result=await erp.listOrders({
        q:clean(req.query?.q||req.query?.search,160),
        status:clean(req.query?.status||'all',60),
        page:Math.max(1,Number(req.query?.page||1)),
        limit:Math.min(100,Math.max(1,Number(req.query?.limit||30)))
      });
      return res.json({
        ok:true,
        vendas:(result.orders||[]).map(saleForDocuments),
        pagination:result.pagination||{},
        fonte:'ariana_erp',
        directErp:true
      });
    }catch(error){return sendError(res,error,'Erro ao consultar vendas do Ariana ERP.');}
  });
  router.get('/admin/ariana-sign/erp/vendas/:id',context.adminRequired,async(req,res)=>{
    try{
      const order=await erp.getOrder(req.params.id);
      return res.json({ok:true,venda:saleForDocuments(order),fonte:'ariana_erp',directErp:true});
    }catch(error){return sendError(res,error,'Erro ao consultar a venda do Ariana ERP.');}
  });

  // Compatibilidade temporária com o Ariana Documentos atual.
  // Essas duas rotas foram criadas para o gerador quando ele ainda buscava no SIGE.
  // Como este router é registrado antes do bloco legado, o Documentos passa a receber
  // dados do Ariana ERP sem precisar manter chamadas externas ao SIGE.
  router.get('/admin/sige/clientes',context.adminRequired,getClients);
  router.get('/admin/sige/produtos',context.adminRequired,getProducts);

  return router;
}
