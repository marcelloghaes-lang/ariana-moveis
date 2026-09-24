import crypto from 'node:crypto';
import { createErpFinanceCustomerContactService } from './erpFinanceCustomerContactService.js';

const clean=(v='',m=500)=>String(v??'').trim().slice(0,m);
const digits=(v='')=>String(v??'').replace(/\D/g,'');
const money=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;

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

  const enabled=Boolean(CrediarioRecibo&&typeof sendCrediarioReceiptWhatsapp==='function');
  const phoneOf=value=>{
    if(typeof normalizePhone==='function')return normalizePhone(value,'55');
    let n=digits(value);
    if((n.length===10||n.length===11)&&!n.startsWith('55'))n='55'+n;
    return n;
  };

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
      whatsapp=await sendCrediarioReceiptWhatsapp(receipt);
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
    return deliver({
      referenceRaw:`LEDGER_${id}`,
      customerName:entry?.personName||'Cliente',
      customerCpf:entry?.personDocument||'',
      customerPhone:entry?.personPhone||'',
      product:entry?.description||'Pagamento de parcela',
      installment:entry?.documentNumber||entry?.boletoNumber||'01/01',
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
    const normalized=phoneOf(phone);
    if(!normalized){
      const error=new Error('Informe um telefone/WhatsApp válido com DDD.');
      error.statusCode=400;
      throw error;
    }

    if(contact){
      await contact.savePhone({
        phone:normalized,
        cpf:receipt.clienteCpf||'',
        name:receipt.clienteNome||'',
        referenceRaw:clean(referenceRaw,180),
        receipt,
        actor
      });
    }else{
      receipt.telefone=normalized;
      await receipt.save();
    }

    if(receipt.enviadoWhatsapp){
      return{receipt:receiptRow(receipt),whatsappEnviado:true,whatsapp:{ok:true,alreadySent:true}};
    }

    const whatsapp=await sendCrediarioReceiptWhatsapp(receipt);
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

  return{enabled,deliver,afterSaleReceive,afterLedgerReceive,savePhoneAndSend,methodLabel};
}

export default createErpPaymentReceiptService;
