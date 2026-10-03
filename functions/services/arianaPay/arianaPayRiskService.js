// Ariana Pay — detecção conservadora de risco financeiro em shadow mode.
// Apenas interpreta o estado já salvo no pedido. Não consulta gateways e não grava dados.

function text(value=''){
  return String(value||'').trim().toLowerCase();
}

function fold(value=''){
  return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}

function sources(order={}){
  return [
    order.status,
    order.statusLabel,
    order.paymentStatus,
    order.payment?.status,
    order.payment?.statusDetail,
    order.payment?.raw?.status,
    order.payment?.raw?.status_detail,
    order.refund?.status,
    order.chargeback?.status,
    order.dispute?.status,
    order.rma?.status,
    order.return?.status
  ].map(fold).filter(Boolean);
}

function hasAny(values,tokens){
  return values.some(value=>tokens.some(token=>value.includes(token)));
}

const APPROVED_PAYMENT_TOKENS=[
  'approved','aprovado','paid','pago','pagamento confirmado','pagamento_confirmado'
];

const CHARGEBACK_TOKENS=[
  'chargeback','charged_back','charged back','contestacao financeira','contestacao de pagamento'
];

const REFUND_TOKENS=[
  'refunded','refund','reembolsado','reembolso concluido','estornado','estorno concluido'
];

const CANCEL_TOKENS=[
  'cancelado','cancelled','canceled','cancelamento concluido'
];

const DISPUTE_TOKENS=[
  'dispute','disputa','contestacao','em contestacao'
];

const RETURN_TOKENS=[
  'devolucao','devolucao solicitada','return requested','returned','rma'
];

export function hadApprovedPayment(order={}){
  const paymentValues=[
    order.paymentStatus,
    order.payment?.status,
    order.payment?.raw?.status
  ].map(fold).filter(Boolean);

  if(hasAny(paymentValues,APPROVED_PAYMENT_TOKENS)) return true;

  const operational=[order.status,order.statusLabel].map(fold).filter(Boolean);
  return hasAny(operational,[
    ...APPROVED_PAYMENT_TOKENS,
    'enviado','shipped','entregue','delivered'
  ]);
}

export function detectFinancialRisk(order={}){
  const values=sources(order);

  if(hasAny(values,CHARGEBACK_TOKENS)){
    return {active:true,kind:'chargeback',severity:'critical',terminal:true,blocksRelease:true,reversalType:'chargeback_debit'};
  }
  if(hasAny(values,REFUND_TOKENS)){
    return {active:true,kind:'refund',severity:'high',terminal:true,blocksRelease:true,reversalType:'refund_debit'};
  }
  if(hasAny(values,CANCEL_TOKENS)){
    return {active:true,kind:'cancellation',severity:'high',terminal:true,blocksRelease:true,reversalType:'refund_debit'};
  }
  if(hasAny(values,DISPUTE_TOKENS)){
    return {active:true,kind:'dispute',severity:'high',terminal:false,blocksRelease:true,reversalType:''};
  }
  if(hasAny(values,RETURN_TOKENS)){
    return {active:true,kind:'return_review',severity:'medium',terminal:false,blocksRelease:true,reversalType:''};
  }

  return {active:false,kind:'',severity:'none',terminal:false,blocksRelease:false,reversalType:''};
}

export function applyRiskToRelease(release={},risk={}){
  if(!risk?.blocksRelease) return release;
  return {
    ...(release||{}),
    state:'blocked',
    reason:`financial_risk_${risk.kind||'unknown'}`,
    risk
  };
}

export const __test={
  fold,
  sources,
  APPROVED_PAYMENT_TOKENS
};

export default {
  hadApprovedPayment,
  detectFinancialRisk,
  applyRiskToRelease
};
