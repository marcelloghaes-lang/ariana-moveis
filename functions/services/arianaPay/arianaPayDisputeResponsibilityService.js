// Ariana Pay — classificação do motivo e responsabilidade de contestação.
// Shadow only. Não transforma uma contestação em dívida do seller sem base suficiente.

function clean(value=''){
  return String(value||'').trim();
}

function fold(value=''){
  return clean(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}

function valuesFromOrder(order={}){
  return [
    order.chargeback?.reason,
    order.chargeback?.reasonCode,
    order.chargeback?.reason_id,
    order.dispute?.reason,
    order.dispute?.reasonCode,
    order.dispute?.reason_id,
    order.claim?.reason,
    order.claim?.reasonCode,
    order.claim?.reason_id,
    order.payment?.statusDetail,
    order.payment?.raw?.status_detail,
    order.payment?.raw?.chargeback_reason,
    order.payment?.raw?.dispute_reason,
    order.statusLabel,
    order.notes
  ].map(fold).filter(Boolean);
}

function has(values,tokens){
  return values.some(value=>tokens.some(token=>value.includes(token)));
}

export function classifyDisputeReason(order={}){
  const values=valuesFromOrder(order);

  if(has(values,[
    'fraud','fraude','not recognized','not_recognized','nao reconhec',
    'unrecognized','unauthorized','nao autorizado','cardholder did not'
  ])){
    return {code:'fraud_not_recognized',label:'Compra não reconhecida / fraude',confidence:'high'};
  }

  if(has(values,[
    'pnr','produto nao recebido','nao recebido','not received','non delivery',
    'non_delivery','undelivered','delivery issue','nao entregue'
  ])){
    return {code:'non_delivery',label:'Produto não recebido',confidence:'high'};
  }

  if(has(values,[
    'pdd','produto diferente','defeituoso','defective','different product',
    'not as described','produto divergente'
  ])){
    return {code:'product_issue',label:'Produto diferente/defeituoso',confidence:'high'};
  }

  if(has(values,[
    'duplicat','cobranca duplicada','duplicate charge','duplicate payment',
    'cc_rejected_duplicated_payment'
  ])){
    return {code:'duplicate_billing',label:'Cobrança duplicada',confidence:'high'};
  }

  if(has(values,[
    'cs','cancelamento de compra','purchase cancelled','purchase canceled',
    'cancelled purchase','canceled purchase'
  ])){
    return {code:'cancelled_purchase',label:'Compra cancelada',confidence:'high'};
  }

  if(has(values,[
    'processing error','erro de processamento','billing error','erro de cobranca',
    'incorrect amount','valor incorreto'
  ])){
    return {code:'processing_error',label:'Erro de cobrança/processamento',confidence:'medium'};
  }

  return {code:'unknown',label:'Motivo ainda não classificado',confidence:'none'};
}

function explicitResponsibility(order={}){
  const raw=fold(
    order.chargeback?.responsibility ||
    order.dispute?.responsibility ||
    order.payment?.chargebackResponsibility ||
    ''
  );

  const allowed={
    seller:'seller',
    fabricante:'seller',
    merchant:'seller',
    ariana:'ariana',
    marketplace:'ariana',
    platform:'ariana',
    provider:'provider_network',
    bandeira:'provider_network',
    card_network:'provider_network',
    network:'provider_network',
    pending_review:'pending_review',
    review:'pending_review'
  };
  return allowed[raw]||'';
}

function hasLiabilityShift(cardSecurity={}){
  return Boolean(
    cardSecurity?.transactionSecurity?.authenticated === true &&
    cardSecurity?.transactionSecurity?.liabilityShiftRequired === true
  );
}

export function classifyDisputeResponsibility({
  order={},
  settlement={},
  risk={},
  cardSecurity={}
}={}){
  const reason=classifyDisputeReason(order);
  const explicit=explicitResponsibility(order);
  const mode=fold(settlement.settlementMode||'');
  const pureMarketplace=mode==='manual_marketplace';
  const managed=mode==='manual_supplier_payable';
  const mixed=mode==='manual_mixed';

  if(explicit){
    return {
      reason,
      owner:explicit,
      source:'explicit_order_or_provider',
      sellerReversalAllowed:explicit==='seller',
      blocksPayout:explicit!=='provider_network',
      requiresManualReview:explicit==='pending_review'
    };
  }

  if(reason.code==='fraud_not_recognized' && hasLiabilityShift(cardSecurity)){
    return {
      reason,
      owner:'provider_network',
      source:'3ds_liability_shift',
      sellerReversalAllowed:false,
      blocksPayout:false,
      requiresManualReview:false
    };
  }

  if(reason.code==='duplicate_billing' || reason.code==='processing_error'){
    return {
      reason,
      owner:'ariana_or_provider_review',
      source:'billing_or_processing_error',
      sellerReversalAllowed:false,
      blocksPayout:true,
      requiresManualReview:true
    };
  }

  if(reason.code==='non_delivery' || reason.code==='product_issue'){
    return {
      reason,
      owner:pureMarketplace?'seller_review':managed?'ariana_review':'shared_review',
      source:pureMarketplace?'marketplace_fulfillment_review':managed?'managed_operation_review':'mixed_operation_review',
      sellerReversalAllowed:false,
      blocksPayout:true,
      requiresManualReview:true
    };
  }

  if(reason.code==='cancelled_purchase'){
    return {
      reason,
      owner:'commercial_reversal_review',
      source:'cancelled_purchase',
      sellerReversalAllowed:false,
      blocksPayout:true,
      requiresManualReview:true
    };
  }

  // Chargeback sem motivo conclusivo nunca vira dívida automática do seller.
  if(risk?.kind==='chargeback' || risk?.kind==='dispute'){
    return {
      reason,
      owner:'pending_review',
      source:'insufficient_dispute_evidence',
      sellerReversalAllowed:false,
      blocksPayout:true,
      requiresManualReview:true
    };
  }

  return {
    reason,
    owner:'',
    source:'not_applicable',
    sellerReversalAllowed:false,
    blocksPayout:false,
    requiresManualReview:false
  };
}

export function attachDisputeResponsibilityToRisk(risk={},responsibility={}){
  if(!risk?.active) return risk;
  return {
    ...risk,
    disputeReason:responsibility?.reason||null,
    lossOwner:String(responsibility?.owner||''),
    responsibilitySource:String(responsibility?.source||''),
    sellerReversalAllowed:responsibility?.sellerReversalAllowed===true,
    responsibilityRequiresReview:responsibility?.requiresManualReview===true
  };
}

export default {
  classifyDisputeReason,
  classifyDisputeResponsibility,
  attachDisputeResponsibilityToRisk
};
