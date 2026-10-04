// Ariana Pay — classificação segura de eventos Webhook do Mercado Pago em sandbox.
// Não grava pedidos, não reembolsa, não bloqueia produção e não cria dívida de seller.

function clean(value=''){
  return String(value||'').trim();
}

function fold(value=''){
  return clean(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}

export function classifyMercadoPagoSandboxWebhook({queryType='',body={}}={}){
  const topic=fold(queryType||body?.type||'');
  const action=fold(body?.action||'');
  const dataStatus=fold(body?.data?.status||'');
  const dataStatusDetail=fold(body?.data?.status_detail||'');

  const source=[topic,action,dataStatus,dataStatusDetail].filter(Boolean).join(' ');

  if(
    topic==='stop_delivery_op_wh' ||
    source.includes('stop_delivery') ||
    source.includes('delivery_cancellation') ||
    source.includes('fraud_alert') ||
    source.includes('fraud alert')
  ){
    return {
      kind:'fraud_alert_stop_delivery',
      severity:'critical',
      blocksDispatch:true,
      blocksPayout:true,
      sellerDebitAllowed:false,
      requiresManualReview:true,
      recommendedAction:'refund_order_and_do_not_ship',
      executeAction:false
    };
  }

  if(
    topic==='topic_chargebacks_wh' ||
    source.includes('chargeback') ||
    source.includes('contestacao')
  ){
    return {
      kind:'chargeback',
      severity:'critical',
      blocksDispatch:false,
      blocksPayout:true,
      sellerDebitAllowed:false,
      requiresManualReview:true,
      recommendedAction:'classify_responsibility_before_any_seller_debit',
      executeAction:false
    };
  }

  if(
    topic==='topic_claims_integration_wh' ||
    source.includes('claim') ||
    source.includes('reclamacao')
  ){
    return {
      kind:'claim',
      severity:'high',
      blocksDispatch:false,
      blocksPayout:true,
      sellerDebitAllowed:false,
      requiresManualReview:true,
      recommendedAction:'review_claim',
      executeAction:false
    };
  }

  if(topic==='order' || source.includes('order.')){
    return {
      kind:'order',
      severity:'informational',
      blocksDispatch:false,
      blocksPayout:false,
      sellerDebitAllowed:false,
      requiresManualReview:false,
      recommendedAction:'reconcile_order_state',
      executeAction:false
    };
  }

  return {
    kind:'unknown',
    severity:'review',
    blocksDispatch:false,
    blocksPayout:true,
    sellerDebitAllowed:false,
    requiresManualReview:true,
    recommendedAction:'manual_review_unknown_webhook',
    executeAction:false
  };
}

export default {classifyMercadoPagoSandboxWebhook};
