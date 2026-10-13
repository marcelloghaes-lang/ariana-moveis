import crypto from 'node:crypto';
import { createErpFinanceCustomerContactService } from './erpFinanceCustomerContactService.js';
import { historicalSaleProduct, historicalInstallmentTotal, historicalInstallmentLabel } from './erpPaymentReceiptUtils.js';

const clean=(v='',m=500)=>String(v??'').trim().slice(0,m);
const digits=(v='')=>String(v??'').replace(/\D/g,'');
const money=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
let requestedRetryWorkerStarted=false;

function methodLabel(value=''){
  const raw=clean(value,80).toLowerCase();
  const labels={
    pix:'Pix',
    dinheiro:'Dinheiro',
    transferencia:'Transferência',
    boleto:'Boleto',
    cartao_debito:'Cartão de débito',
    cartao_credito:'Cartão de crédito',
    cartao:'Cartão',
    crediario:'Crediário próprio',
    credito_loja:'Crédito Loja',
    outro:'Outro'
  };
  return labels[raw]||clean(value,80)||'Não informada';
}

function receiptRow(doc={}){
  const r=typeof doc?.toObject==='function'?doc.toObject():doc;
  return{
    id:String(r?._id||r?.id||''),
    recibo:clean(r?.recibo,80),
    clienteNome:clean(r?.clienteNome,220),
    clienteCpf:clean(r?.clienteCpf,40),
    telefone:clean(r?.telefone,40),
    produto:clean(r?.produto,500),
    parcela:clean(r?.parcela,80),
    valorPago:money(r?.valorPago),
    formaPagamento:clean(r?.formaPagamento,80),
    dataPagamento:r?.dataPagamento||r?.createdAt||null,
    enviadoWhatsapp:r?.enviadoWhatsapp===true
  };
}

function itemName(item={}){
  return clean(
    item.name||
    item.productName||
    item.title||
    item.descricao||
    item.description||
    item.product?.name||
    item.product?.title||
    '',
    220
  );
}

function orderProduct(order={}){
  const names=(Array.isArray(order?.items)?order.items:[])
    .map(itemName)
    .filter(Boolean);
  if(names.length)return [...new Set(names)].slice(0,4).join(' + ');
  return clean(order?.televendas?.erp?.description||order?.description||'Compra na loja',500);
}

export function createErpPaymentReceiptService(context={}){
  const {
    CrediarioRecibo,
    normalizePhone,
    makeReciboNumber,
    sendCrediarioReceiptWhatsapp,
    getWhatsappSettings,
    axios,
    redact,
    now,
    createAdminNotification
  }=context;

  let contact=null;
  try{
    if(context.Order)contact=createErpFinanceCustomerContactService(context);
  }catch(error){
    console.warn('[erp-payment-receipt] contato do cliente indisponível:',error?.message||error);
  }

  const directSenderAvailable=Boolean(axios?.post&&typeof getWhatsappSettings==='function');
  const enabled=Boolean(CrediarioRecibo&&(typeof sendCrediarioReceiptWhatsapp==='function'||directSenderAvailable));
  const db=context.mongoose||null;
  const phoneOf=value=>{
    const raw=clean(value,80);
    if(typeof normalizePhone==='function'){
      const normalized=normalizePhone(raw,'55');
      if(!normalized)return'';
      return raw.startsWith('+')?`+${digits(normalized)}`:digits(normalized);
    }
    let n=digits(raw);
    if(!n)return'';
    if(raw.startsWith('+'))return `+${n}`;
    if(n.startsWith('00'))return `+${n.slice(2)}`;
    if((n.length===10||n.length===11)&&!n.startsWith('55'))n='55'+n;
    return n;
  };

  function receiptMessage(receipt={}){
    const r=receiptRow(receipt);
    const date=r.dataPagamento?new Date(r.dataPagamento):new Date();
    const dateText=Number.isNaN(date.getTime())?'Não informada':date.toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'});
    return `✅ Pagamento registrado com sucesso\n\nOlá, ${r.clienteNome||'cliente'}! 👋\n\nRecebemos o pagamento da sua parcela na Ariana Móveis.\n\n🧾 Recibo: ${r.recibo||'—'}\n📦 Produto: ${r.produto||'Compra na loja'}\n💰 Valor pago: ${money(r.valorPago).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}\n💳 Forma de pagamento: ${r.formaPagamento||'Não informada'}\n📅 Data: ${dateText}\n📌 Parcela: ${r.parcela||'Não informada'}\n\nObrigado pela preferência! 😊\nAriana Móveis`;
  }

  async function sendViaFinanceInstance(receipt={}){
    if(!directSenderAvailable)throw new Error('Canal de notificações direto indisponível.');
    const settings=await getWhatsappSettings();
    if(settings?.enabled===false)throw new Error('WhatsApp desativado nas configurações.');
    const apiUrl=String(settings?.apiUrl||'').trim().replace(/\/+$/,'');
    const apiKey=String(settings?.apiKey||'').trim();
    const instanceName=String(process.env.EVOLUTION_INSTANCE_NOTIFICACOES||'Ariana_Notificacoes').trim();
    const number=phoneOf(receipt?.telefone||'');
    if(!apiUrl)throw new Error('URL da Evolution API não configurada.');
    if(!apiKey)throw new Error('Chave da Evolution API não configurada.');
    if(!instanceName)throw new Error('Instância de notificações do WhatsApp não configurada.');
    if(!number)throw new Error('Telefone do cliente inválido para envio do recibo.');
    const response=await axios.post(`${apiUrl}/message/sendText/${encodeURIComponent(instanceName)}`,{number,text:receiptMessage(receipt),delay:0},{headers:{'Content-Type':'application/json',apikey:apiKey},timeout:10000,validateStatus:()=>true});
    if(response.status<200||response.status>=300){
      const providerMessage=clean(response?.data?.message||response?.data?.error||response?.statusText||'',300);
      throw new Error(`Evolution ${instanceName} recusou o envio (HTTP ${response.status})${providerMessage?`: ${providerMessage}`:''}`);
    }
    return{ok:true,provider:'evolution',instanceName,status:response.status,data:response.data};
  }

  async function sendReceiptWhatsapp(receipt={}){
    if(directSenderAvailable){
      return sendViaFinanceInstance(receipt);
    }
    if(typeof sendCrediarioReceiptWhatsapp==='function'){
      const fallback=await sendCrediarioReceiptWhatsapp(receipt);
      if(fallback&&fallback.ok!==false)return fallback;
      throw new Error(fallback?.error||fallback?.message||'Evolution API não confirmou o envio do comprovante.');
    }
    throw new Error('Nenhum canal de WhatsApp disponível para o comprovante.');
  }

  async function retryRequestedReceipts(){
    if(!enabled||!CrediarioRecibo)return;
    const rows=await CrediarioRecibo.find({enviadoWhatsapp:{$ne:true},origem:'ariana_erp_baixa','whatsappResultado.retryRequested':true}).sort({createdAt:1}).limit(20);
    for(const receipt of rows){
      try{
        receipt.whatsappResultado={...(receipt.whatsappResultado||{}),retryRequested:false,retrying:true};
        await receipt.save();
        const whatsapp=await sendReceiptWhatsapp(receipt);
        if(!whatsapp||whatsapp.ok===false)throw new Error(whatsapp?.error||whatsapp?.message||'Evolution API não confirmou o reenvio.');
        receipt.enviadoWhatsapp=true;
        receipt.enviadoWhatsappEm=typeof now==='function'?now():new Date();
        receipt.whatsappResultado=typeof redact==='function'?redact({...whatsapp,retrying:false,retried:true}):{...whatsapp,retrying:false,retried:true};
        await receipt.save();
        console.log('[erp-payment-receipt/retry] comprovante reenviado',{recibo:receipt.recibo});
      }catch(error){
        const failed={ok:false,error:error?.message||String(error),retryRequested:false,retrying:false,retried:true};
        receipt.enviadoWhatsapp=false;
        receipt.whatsappResultado=typeof redact==='function'?redact(failed):failed;
        await receipt.save().catch(()=>null);
        console.warn('[erp-payment-receipt/retry] falha no reenvio',{recibo:receipt.recibo,error:failed.error});
      }
    }
  }

  if(enabled&&!requestedRetryWorkerStarted){
    requestedRetryWorkerStarted=true;
    const timer=setTimeout(()=>retryRequestedReceipts().catch(error=>console.warn('[erp-payment-receipt/retry]',error?.message||error)),7000);
    timer.unref?.();
  }

  function fallbackReceiptNumber(){
    const d=new Date(),y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');
    return `REC-${y}${m}${day}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  }

  async function nextReceiptNumber(){
    let value=typeof makeReciboNumber==='function'?makeReciboNumber():fallbackReceiptNumber();
    while(await CrediarioRecibo.exists({recibo:value})){
      value=typeof makeReciboNumber==='function'?makeReciboNumber():fallbackReceiptNumber();
    }
    return value;
  }

  function importHash(referenceRaw='',payment={}){
    const document=clean(payment?.document||payment?.documentNumber,180);
    const paymentId=clean(payment?.id||payment?._id,180);
    const key=document
      ? `ariana-erp-baixa|${referenceRaw}|${document}`
      : `ariana-erp-pagamento|${referenceRaw}|${paymentId||clean(payment?.at,80)||Date.now()}`;
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  async function resolveHistoricalLedgerSale(entry={}){
    if(!db)return null;
    const Entry=db.models?.ErpFinancialEntry;
    const HistoricalSale=db.models?.ErpSigeHistoricalSale;
    if(!Entry||!HistoricalSale)return null;

    const id=String(entry?._id||entry?.id||'');
    if(!id)return null;

    let objectId=null;
    try{
      objectId=db.Types?.ObjectId?.isValid(id)?new db.Types.ObjectId(id):null;
    }catch{}
    if(!objectId)return null;

    const raw=await Entry.collection.findOne({_id:objectId});
    const sourceSaleId=clean(raw?.migration?.sourceSaleId||entry?.migration?.sourceSaleId||'',120);
    if(!sourceSaleId)return null;

    const [sale,siblings]=await Promise.all([
      HistoricalSale.findOne({sourceSystem:'sige',sourceId:sourceSaleId}).lean(),
      Entry.collection.find({
        direction:'receivable',
        'migration.sourceSaleId':sourceSaleId,
        status:{$ne:'cancelled'}
      }).project({_id:1,direction:1,dueAt:1,competenceAt:1,createdAt:1}).toArray()
    ]);

    const product=historicalSaleProduct(sale||{});
    const originalInstallments=historicalInstallmentTotal(sale||{});
    const installment=historicalInstallmentLabel(id,siblings,originalInstallments);
    return{
      sourceSaleId,
      saleCode:clean(sale?.code,100),
      product,
      installment,
      installments:originalInstallments||siblings.length
    };
  }

  async function resolvePhone({customerName='',customerCpf='',referenceRaw='',fallbackPhone='',receipt=null,actor={}}={}){
    let phone=phoneOf(fallbackPhone||'');
    let saved=null;
    if(contact){
      try{
        const resolved=await contact.resolveContact({cpf:customerCpf,name:customerName,referenceRaw});
        phone=phone||phoneOf(resolved?.customerPhone||'');
        if(phone){
          saved=await contact.savePhone({
            phone,
            cpf:customerCpf||resolved?.customerCpf||'',
            name:customerName||resolved?.customerName||'',
            referenceRaw,
            receipt,
            actor
          });
          phone=saved?.phone||phone;
        }
      }catch(error){
        console.warn('[erp-payment-receipt] não foi possível sincronizar telefone:',error?.message||error);
      }
    }
    return{phone,saved};
  }

  async function deliver({
    referenceRaw='',
    customerName='',
    customerCpf='',
    customerPhone='',
    product='',
    installment='',
    payment={},
    actor={}
  }={}){
    if(!enabled)return{skipped:true,reason:'receipt_service_unavailable'};

    const ref=clean(referenceRaw,180);
    const name=clean(customerName,220)||'Cliente';
    const cpf=digits(customerCpf);
    const hash=importHash(ref,payment);
    let receipt=await CrediarioRecibo.findOne({importHash:hash});
    let created=false;

    if(!receipt){
      const initialContact=await resolvePhone({
        customerName:name,
        customerCpf:cpf,
        referenceRaw:ref,
        fallbackPhone:customerPhone,
        actor
      });
      receipt=await CrediarioRecibo.create({
        recibo:await nextReceiptNumber(),
        clienteId:initialContact.saved?.clientId||null,
        clienteNome:name,
        clienteCpf:cpf,
        telefone:initialContact.phone||'',
        contrato:'',
        produto:clean(product,500)||'Compra na loja',
        parcela:clean(installment,80),
        valorPago:money(payment?.totalPaid??payment?.principalApplied??payment?.amount??0),
        formaPagamento:methodLabel(payment?.method||payment?.paymentMethod),
        dataPagamento:payment?.at||payment?.paidAt||new Date(),
        observacao:'',
        criadoPor:clean(actor?.email||actor?.name||actor?.nome||'Ariana ERP',180),
        status:'confirmado_ariana_erp',
        origem:'ariana_erp_baixa',
        documento:clean(payment?.document||payment?.documentNumber,180),
        importHash:hash
      });
      created=true;
    }

    if(!created&&!receipt.enviadoWhatsapp){
      let changed=false;
      const betterProduct=clean(product,500);
      const betterInstallment=clean(installment,80);
      if(betterProduct&&betterProduct!==receipt.produto){
        receipt.produto=betterProduct;
        changed=true;
      }
      if(betterInstallment&&betterInstallment!==receipt.parcela){
        receipt.parcela=betterInstallment;
        changed=true;
      }
      if(changed)await receipt.save();
    }

    if(receipt.enviadoWhatsapp){
      return{
        receiptCreated:true,
        receiptNew:created,
        receipt:receiptRow(receipt),
        whatsappEnviado:true,
        requiresPhone:false,
        whatsapp:{ok:true,alreadySent:true}
      };
    }

    const contactResult=await resolvePhone({
      customerName:receipt.clienteNome||name,
      customerCpf:receipt.clienteCpf||cpf,
      referenceRaw:ref,
      fallbackPhone:receipt.telefone||customerPhone,
      receipt,
      actor
    });

    if(contactResult.phone&&!receipt.telefone){
      receipt.telefone=contactResult.phone;
      await receipt.save();
    }

    if(!receipt.telefone){
      const whatsapp={ok:false,skipped:true,reason:'cliente_sem_whatsapp',requiresPhone:true};
      receipt.whatsappResultado=whatsapp;
      await receipt.save();
      return{
        receiptCreated:true,
        receiptNew:created,
        receipt:receiptRow(receipt),
        whatsappEnviado:false,
        requiresPhone:true,
        phonePrompt:{
          reference:ref,
          receiptId:String(receipt._id),
          receiptCode:receipt.recibo||'',
          customerName:receipt.clienteNome||name,
          customerDocument:receipt.clienteCpf||cpf
        },
        whatsapp
      };
    }

    let whatsapp=null;
    try{
      whatsapp=await sendReceiptWhatsapp(receipt);
      if(!whatsapp||whatsapp.ok===false)throw new Error(whatsapp?.error||whatsapp?.message||'Evolution API não confirmou o envio do comprovante.');
      receipt.enviadoWhatsapp=true;
      receipt.enviadoWhatsappEm=typeof now==='function'?now():new Date();
      receipt.whatsappResultado=typeof redact==='function'?redact(whatsapp):whatsapp;
      await receipt.save();

      if(typeof createAdminNotification==='function'){
        await createAdminNotification({
          type:'erp_recibo_whatsapp',
          title:'📲 Comprovante enviado pelo WhatsApp',
          message:`${receipt.recibo} - ${receipt.clienteNome}`,
          relatedId:String(receipt._id),
          severity:'info',
          metadata:{reference:ref,recibo:receipt.recibo,clienteNome:receipt.clienteNome}
        }).catch(()=>null);
      }

      return{
        receiptCreated:true,
        receiptNew:created,
        receipt:receiptRow(receipt),
        whatsappEnviado:true,
        requiresPhone:false,
        whatsapp
      };
    }catch(error){
      const failed={ok:false,error:error?.message||String(error)};
      receipt.enviadoWhatsapp=false;
      receipt.whatsappResultado=typeof redact==='function'?redact(failed):failed;
      await receipt.save().catch(()=>null);
      return{
        receiptCreated:true,
        receiptNew:created,
        receipt:receiptRow(receipt),
        whatsappEnviado:false,
        requiresPhone:false,
        whatsapp:failed
      };
    }
  }

  async function afterSaleReceive({order={},number=1,receivable={},payment={},actor={}}={}){
    const n=Math.max(1,Number(number||receivable?.number||1));
    const installments=Math.max(1,Number(receivable?.installments||order?.payment?.installments||1));
    return deliver({
      referenceRaw:`ERP_${String(order?._id||order?.id||'')}_${n}`,
      customerName:order?.customerName||'Cliente',
      customerCpf:order?.customerCpf||'',
      customerPhone:order?.customerPhone||'',
      product:orderProduct(order),
      installment:`${n}/${installments}`,
      payment,
      actor
    });
  }

  async function afterLedgerReceive({entry={},payment={},actor={}}={}){
    const id=String(entry?._id||entry?.id||'');
    if(!id||String(entry?.direction||'')!=='receivable')return{skipped:true,reason:'not_receivable'};

    let purchase=null;
    try{
      purchase=await resolveHistoricalLedgerSale(entry);
    }catch(error){
      console.warn('[erp-payment-receipt] não foi possível localizar a compra histórica do recebimento:',error?.message||error);
    }

    const technicalDescription=clean(entry?.description,500);
    const genericHistorical=/^SIGE\s+/i.test(technicalDescription);
    const product=purchase?.product||
      (!genericHistorical?technicalDescription:'')||
      'Pagamento de parcela';
    const ledgerNumber=Math.max(0,Number(entry?.historicalInstallmentNumber||0));
    const ledgerTotal=Math.max(0,Number(entry?.historicalInstallments||0));
    const ledgerInstallment=ledgerNumber&&ledgerTotal?`${String(ledgerNumber).padStart(2,'0')}/${String(ledgerTotal).padStart(2,'0')}`:'';
    const installment=ledgerInstallment||
      purchase?.installment||
      clean(entry?.installmentNumber||entry?.parcelNumber||entry?.parcela,80)||
      clean(entry?.documentNumber||entry?.boletoNumber,80)||
      '';

    return deliver({
      referenceRaw:`LEDGER_${id}`,
      customerName:entry?.personName||'Cliente',
      customerCpf:entry?.personDocument||'',
      customerPhone:entry?.personPhone||'',
      product,
      installment,
      payment,
      actor
    });
  }

  async function savePhoneAndSend({receiptId='',phone='',referenceRaw='',actor={}}={}){
    if(!enabled){
      const error=new Error('Serviço de comprovante do Ariana ERP indisponível.');
      error.statusCode=503;
      throw error;
    }
    const receipt=await CrediarioRecibo.findById(clean(receiptId,80));
    if(!receipt){
      const error=new Error('Comprovante não encontrado.');
      error.statusCode=404;
      throw error;
    }
    const rawPhone=clean(phone,80);
    const normalized=phoneOf(rawPhone);
    if(!normalized){
      const error=new Error('Informe um telefone/WhatsApp válido com DDD.');
      error.statusCode=400;
      throw error;
    }

    if(contact){
      const saved=await contact.savePhone({
        phone:rawPhone||normalized,
        cpf:receipt.clienteCpf||'',
        name:receipt.clienteNome||'',
        referenceRaw:clean(referenceRaw,180),
        receipt,
        actor
      });
      if(saved?.phone&&receipt.telefone!==saved.phone){
        receipt.telefone=saved.phone;
        await receipt.save();
      }
    }else{
      receipt.telefone=normalized;
      await receipt.save();
    }

    if(receipt.enviadoWhatsapp){
      return{receipt:receiptRow(receipt),whatsappEnviado:true,whatsapp:{ok:true,alreadySent:true}};
    }

    const whatsapp=await sendReceiptWhatsapp(receipt);
    if(!whatsapp||whatsapp.ok===false){
      receipt.enviadoWhatsapp=false;
      receipt.whatsappResultado=typeof redact==='function'?redact(whatsapp||{}):(whatsapp||{});
      await receipt.save().catch(()=>null);
      const error=new Error(whatsapp?.error||whatsapp?.message||'Evolution API não confirmou o envio do comprovante.');
      error.statusCode=502;
      throw error;
    }

    receipt.enviadoWhatsapp=true;
    receipt.enviadoWhatsappEm=typeof now==='function'?now():new Date();
    receipt.whatsappResultado=typeof redact==='function'?redact(whatsapp):whatsapp;
    await receipt.save();

    return{receipt:receiptRow(receipt),whatsappEnviado:true,whatsapp};
  }

  return{enabled,deliver,afterSaleReceive,afterLedgerReceive,savePhoneAndSend,methodLabel,resolveHistoricalLedgerSale};
}

export default createErpPaymentReceiptService;