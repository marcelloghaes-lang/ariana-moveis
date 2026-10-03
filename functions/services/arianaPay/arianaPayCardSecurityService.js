// Ariana Pay — camada de segurança de cartão em shadow mode.
// Objetivo: impedir liberação/repasse automático quando faltam sinais mínimos de segurança.
// Não consulta bureaus, não armazena PAN/CVV e não executa bloqueio em produção nesta fase.

function clean(value=''){
  return String(value||'').trim();
}

function fold(value=''){
  return clean(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}

function money(value=0){
  const n=Number(value||0);
  return Number.isFinite(n)?Math.round((n+Number.EPSILON)*100)/100:0;
}

function digits(value=''){
  return clean(value).replace(/\D/g,'');
}

function isCard(order={}){
  const values=[
    order.payment?.method,
    order.payment?.type,
    order.payment?.paymentMethodId,
    order.paymentMethod,
    order.paymentType
  ].map(fold);

  return values.some(v=>v.includes('card')||v.includes('credit')||v.includes('credito')||v.includes('master')||v.includes('visa')||v.includes('elo'));
}

function provider(order={}){
  return fold(order.payment?.provider||order.paymentProvider||'');
}

function transactionSecurity(order={}){
  const raw=
    order.payment?.transactionSecurity ||
    order.payment?.transaction_security ||
    order.payment?.raw?.transaction_security ||
    order.payment?.raw?.payment_method?.transaction_security ||
    {};
  const validation=fold(raw.validation||'');
  const liabilityShift=fold(raw.liability_shift||raw.liabilityShift||'');
  const status=fold(raw.status||'');
  return {
    present:Boolean(validation||liabilityShift||status||raw.id||raw.type),
    validation,
    liabilityShift,
    status,
    authenticated:['authenticated','approved','success','successful'].some(t=>status.includes(t)),
    liabilityShiftRequired:liabilityShift==='required'
  };
}

function hasFraudAlert(order={}){
  const values=[
    order.payment?.statusDetail,
    order.payment?.fraudAlert,
    order.payment?.fraud_alert,
    order.payment?.raw?.status_detail,
    order.payment?.raw?.action,
    order.payment?.raw?.type,
    order.fraudAlert?.status,
    order.security?.fraudAlert
  ].map(fold).filter(Boolean);

  return values.some(v=>
    v.includes('delivery_cancellation')||
    v.includes('stop_delivery')||
    v.includes('fraud_alert')||
    v.includes('fraud alert')||
    v.includes('alerta de fraude')
  );
}

function contactCompleteness(order={}){
  const address=order.shippingAddress&&typeof order.shippingAddress==='object'?order.shippingAddress:{};
  const cpf=digits(order.customerCpf||order.customer?.cpf||order.payment?.payer?.identification?.number);
  const email=clean(order.customerEmail||order.customer?.email||order.payment?.payer?.email);
  const phone=digits(order.customerPhone||order.customer?.phone||address.phone);
  const cep=digits(address.cep||address.zipCode||address.zip_code);
  const street=clean(address.logradouro||address.street||address.street_name);
  const number=clean(address.numero||address.number||address.street_number);

  return {
    cpf:Boolean(cpf.length===11||cpf.length===14),
    email:Boolean(email&&email.includes('@')),
    phone:Boolean(phone.length>=10),
    address:Boolean(cep.length===8&&street&&number)
  };
}

export function assessCardSecurity(order={}, options={}){
  const card=isCard(order);
  const total=money(order.total||order.totals?.total||0);
  const installments=Math.max(1,Number(order.payment?.installments||order.installments||1)||1);
  const p=provider(order);
  const tx=transactionSecurity(order);
  const contact=contactCompleteness(order);
  const reasons=[];
  let score=0;

  if(!card){
    return {
      mode:'shadow',
      applies:false,
      level:'not_applicable',
      score:0,
      blocksDispatch:false,
      blocksPayout:false,
      reasons:[],
      transactionSecurity:tx
    };
  }

  if(hasFraudAlert(order)){
    return {
      mode:'shadow',
      applies:true,
      level:'blocked',
      score:100,
      blocksDispatch:true,
      blocksPayout:true,
      reasons:['provider_fraud_alert_stop_delivery'],
      transactionSecurity:tx
    };
  }

  // Segurança estrutural: cartão sem evidência de 3DS/liability shift nunca ganha nível baixo.
  if(!tx.present){
    score+=35;
    reasons.push('no_3ds_evidence');
  }else{
    if(!tx.authenticated){
      score+=30;
      reasons.push('3ds_not_authenticated');
    }
    if(!tx.liabilityShiftRequired){
      score+=25;
      reasons.push('liability_shift_not_confirmed');
    }
  }

  // Dados incompletos reduzem a capacidade de provar legitimidade e contestar fraude.
  if(!contact.cpf){ score+=12; reasons.push('customer_document_missing'); }
  if(!contact.email){ score+=8; reasons.push('customer_email_missing'); }
  if(!contact.phone){ score+=8; reasons.push('customer_phone_missing'); }
  if(!contact.address){ score+=12; reasons.push('shipping_address_incomplete'); }

  // Pedidos parcelados longos ou de maior valor exigem mais cautela, sem rejeição automática isolada.
  const highValue=Number(options.highValueThreshold||2000);
  const veryHighValue=Number(options.veryHighValueThreshold||5000);
  if(total>=veryHighValue){ score+=20; reasons.push('very_high_value'); }
  else if(total>=highValue){ score+=10; reasons.push('high_value'); }

  if(installments>=10){ score+=10; reasons.push('long_installment_plan'); }
  else if(installments>=7){ score+=5; reasons.push('medium_installment_plan'); }

  // Integração Mercado Pago atual da Ariana usa /v1/payments; até migrar/testar Orders+3DS,
  // ausência de transaction_security é tratada de forma conservadora.
  if(p.includes('mercadopago')&&!tx.present){
    score+=10;
    reasons.push('legacy_mp_payments_without_3ds_proof');
  }

  score=Math.min(100,score);

  const level=score>=70?'blocked':score>=45?'high_review':score>=25?'review':'low';
  return {
    mode:'shadow',
    applies:true,
    level,
    score,
    blocksDispatch:level==='blocked'||level==='high_review',
    blocksPayout:level!=='low',
    reasons:[...new Set(reasons)],
    provider:p,
    total,
    installments,
    contact,
    transactionSecurity:tx
  };
}

export function applyCardSecurityToRelease(release={},assessment={}){
  if(!assessment?.applies) return release;
  if(!assessment?.blocksPayout) {
    return {
      ...(release||{}),
      cardSecurity:assessment
    };
  }
  return {
    ...(release||{}),
    state:'blocked',
    reason:`card_security_${assessment.level||'review'}`,
    cardSecurity:assessment
  };
}

export function buildDispatchSecurityDecision(order={},options={}){
  const assessment=assessCardSecurity(order,options);
  return {
    mode:'shadow',
    allowDispatch:!assessment.blocksDispatch,
    requiresManualReview:Boolean(assessment.applies&&assessment.level!=='low'&&assessment.level!=='not_applicable'),
    assessment
  };
}

export const __test={isCard,provider,transactionSecurity,hasFraudAlert,contactCompleteness};

export default {
  assessCardSecurity,
  applyCardSecurityToRelease,
  buildDispatchSecurityDecision
};
