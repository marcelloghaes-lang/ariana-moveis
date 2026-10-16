const clean=(value='',max=1000)=>String(value??'').trim().slice(0,max);
const digits=(value='')=>String(value??'').replace(/\D/g,'');

function bool(value,fallback=true){
  if(value===undefined||value===null||value==='')return fallback;
  return ['1','true','yes','on','sim'].includes(String(value).trim().toLowerCase());
}

function normalizePhone(value='',normalizer=null){
  const raw=clean(value,80);
  if(typeof normalizer==='function'){
    try{
      const normalized=normalizer(raw,'55');
      const phone=digits(normalized);
      if(phone)return phone;
    }catch{}
  }
  let phone=digits(raw).replace(/^0+/,'');
  if((phone.length===10||phone.length===11)&&!phone.startsWith('55'))phone=`55${phone}`;
  return phone;
}

function firstName(value=''){
  return clean(value,180).split(/\s+/).filter(Boolean)[0]||'cliente';
}

function messageFor(order={},fiscal={}){
  const orderCode=clean(order?.televendas?.erp?.code||order?.code||order?._id||'',100);
  const nfeNumber=clean(fiscal?.number||'',40);
  const customer=firstName(order?.customerName);
  const orderText=orderCode?` *${orderCode}*`:'';
  const nfeText=nfeNumber?`\n🧾 NF-e: *${nfeNumber}*`:'';
  return `📦 *Pedido faturado — Ariana Móveis*\n\nOlá, ${customer}! 😊\n\nSeu pedido${orderText} foi faturado com sucesso e a NF-e foi emitida.\n\nSeu pedido está liberado para envio/entrega conforme combinado.${nfeText}\n\nObrigado pela preferência!\n*Ariana Móveis*`;
}

export function createErpNfeCustomerNotificationService(context={}){
  const {Order,axios,getWhatsappSettings,normalizePhone:contextNormalizePhone,redact}=context;
  const enabled=bool(process.env.ERP_NFE_CUSTOMER_NOTIFICATION_ENABLED,true);

  async function mark(orderId,key,data={}){
    if(!Order?.collection||!orderId)return;
    try{
      await Order.collection.updateOne(
        {_id:orderId},
        {$set:{'televendas.erp.nfeCustomerNotification':{
          key:clean(key,80),
          ...data,
          updatedAt:new Date()
        }}}
      );
    }catch(error){
      console.warn('[erp-nfe/customer-notification/mark]',error?.message||error);
    }
  }

  async function send({order:orderInput={},fiscal={}}={}){
    if(!enabled)return{ok:true,skipped:true,reason:'disabled'};
    if(String(fiscal?.environment||'').toLowerCase()==='homologacao'||fiscal?.homologation){
      return{ok:true,skipped:true,reason:'homologation'};
    }
    if(!fiscal?.authorized)return{ok:true,skipped:true,reason:'not_authorized'};

    const key=clean(fiscal?.key||fiscal?.fiscalDocumentId||'',80);
    const idValue=orderInput?._id||fiscal?.orderId||'';
    if(!idValue||!Order)return{ok:false,skipped:true,reason:'order_unavailable'};

    let order=null;
    try{order=await Order.findById(idValue).lean();}catch{}
    if(!order)return{ok:false,skipped:true,reason:'order_not_found'};

    const existing=order?.televendas?.erp?.nfeCustomerNotification||{};
    if(key&&existing?.key===key&&existing?.status==='sent'){
      return{ok:true,skipped:true,alreadySent:true,instanceName:existing?.instanceName||''};
    }
    if(key&&existing?.key===key&&existing?.status==='sending'){
      return{ok:true,skipped:true,reason:'already_sending'};
    }

    const phone=normalizePhone(order?.customerPhone||'',contextNormalizePhone);
    if(!phone){
      await mark(order._id,key,{status:'skipped',reason:'customer_phone_missing',phone:''});
      return{ok:false,skipped:true,reason:'customer_phone_missing'};
    }

    const claimFilter={_id:order._id};
    if(key){
      claimFilter.$or=[
        {'televendas.erp.nfeCustomerNotification.key':{$ne:key}},
        {'televendas.erp.nfeCustomerNotification.status':{$in:['failed','skipped']}},
        {'televendas.erp.nfeCustomerNotification.status':{$exists:false}}
      ];
    }
    const claim=await Order.collection.updateOne(claimFilter,{$set:{'televendas.erp.nfeCustomerNotification':{
      key,
      status:'sending',
      phone,
      startedAt:new Date(),
      updatedAt:new Date()
    }}});
    if(key&&!claim?.modifiedCount){
      return{ok:true,skipped:true,reason:'already_claimed'};
    }

    try{
      if(!axios?.post||typeof getWhatsappSettings!=='function')throw new Error('Canal Evolution de notificações indisponível.');
      const settings=await getWhatsappSettings();
      if(settings?.enabled===false)throw new Error('WhatsApp desativado nas configurações.');
      const apiUrl=clean(settings?.apiUrl,500).replace(/\/+$/,'');
      const apiKey=clean(settings?.apiKey,500);
      const instanceName=clean(
        process.env.ERP_NFE_NOTIFICATION_EVOLUTION_INSTANCE||
        process.env.EVOLUTION_INSTANCE_NOTIFICACOES||
        'Ariana_Notificacoes',
        120
      );
      if(!apiUrl)throw new Error('URL da Evolution API não configurada.');
      if(!apiKey)throw new Error('Chave da Evolution API não configurada.');
      if(!instanceName)throw new Error('Instância de notificações não configurada.');

      const response=await axios.post(
        `${apiUrl}/message/sendText/${encodeURIComponent(instanceName)}`,
        {number:phone,text:messageFor(order,fiscal),delay:0},
        {headers:{'Content-Type':'application/json',apikey:apiKey},timeout:10000,validateStatus:()=>true}
      );
      if(response.status<200||response.status>=300){
        const providerMessage=clean(response?.data?.message||response?.data?.error||response?.statusText||'',300);
        throw new Error(`Evolution ${instanceName} recusou o envio (HTTP ${response.status})${providerMessage?`: ${providerMessage}`:''}`);
      }

      const messageId=clean(response?.data?.key?.id||response?.data?.messageId||response?.data?.id||'',180);
      await mark(order._id,key,{
        status:'sent',
        phone,
        instanceName,
        messageId,
        sentAt:new Date(),
        nfeNumber:clean(fiscal?.number||'',40),
        protocol:clean(fiscal?.protocol||'',80)
      });
      console.log('[erp-nfe/customer-notification] enviado',{orderId:String(order._id),nfeNumber:clean(fiscal?.number||'',40),instanceName});
      return{ok:true,status:'sent',instanceName,messageId,phone};
    }catch(error){
      const failure={status:'failed',phone,error:clean(error?.message||error,500),failedAt:new Date()};
      await mark(order._id,key,failure);
      console.warn('[erp-nfe/customer-notification] falha',{orderId:String(order._id),error:failure.error});
      return{ok:false,...failure};
    }
  }

  return{send,messageFor};
}
