import {
  getMercadoPago3dsSandboxConfig,
  assertMercadoPago3dsSandboxReady
} from './mercadoPagoOrders3dsSandboxService.js';
import {
  getMpReconciliationSandboxConfig,
  assertMpReconciliationSandboxReady
} from './mercadoPagoReconciliationSandboxService.js';

// Ariana Pay — readiness seguro da Fase 1.
// Expõe apenas booleanos/contagens; nunca retorna secrets ou credenciais.

function on(value=''){
  return String(value||'').trim().toLowerCase()==='true';
}
function present(value=''){
  return Boolean(String(value||'').trim());
}
function canRun3dsSandbox(env){
  try{
    assertMercadoPago3dsSandboxReady(getMercadoPago3dsSandboxConfig(env));
    return true;
  }catch(_error){
    return false;
  }
}
function canRunReconciliationSandbox(env){
  try{
    assertMpReconciliationSandboxReady(getMpReconciliationSandboxConfig(env));
    return true;
  }catch(_error){
    return false;
  }
}

export function buildArianaPayPhase1Readiness({audit=null,env=process.env}={}){
  const recon=audit?.paymentReconciliation?.stats||{};
  const gates={
    shadowFeatureEnabled:on(env.ARIANA_PAY_SHADOW_ENABLED),
    realMoneyFeatureDisabled:!on(env.ARIANA_PAY_ENABLED),
    checkoutTakeoverDisabled:!on(env.ARIANA_PAY_CHECKOUT_ENABLED),
    fixedReleasePolicy15Days:true,
    ledgerReconciliationClean:audit?Number(audit.divergenceCount||0)===0:null,
    storedPaymentReconciliationClean:audit?Number(recon.divergent||0)===0:null,
    storedPaymentEvidenceComplete:audit?Number(recon.insufficientEvidence||0)===0:null,
    sellerReadOnlyView:true,
    chargebackResponsibilityClassification:true,
    cardSecurityShadow:true,
    payoutExecutionDisabled:!on(env.ARIANA_PAY_PAYOUT_ENABLED),
    mpWebhookSecretConfigured:present(env.MP_WEBHOOK_SECRET),
    mpWebhookSignatureEnforced:on(env.MP_WEBHOOK_SIGNATURE_ENFORCE),
    mp3dsSandboxConfigured:canRun3dsSandbox(env),
    mpReconciliationSandboxConfigured:canRunReconciliationSandbox(env)
  };

  const safetyViolations=[];
  if(!gates.realMoneyFeatureDisabled) safetyViolations.push('real_money_feature_enabled');
  if(!gates.checkoutTakeoverDisabled) safetyViolations.push('checkout_takeover_enabled');
  if(!gates.payoutExecutionDisabled) safetyViolations.push('payout_execution_enabled');

  const externalPending=[];
  if(!gates.mp3dsSandboxConfigured) externalPending.push('mercado_pago_3ds_sandbox_credentials');
  if(!gates.mpReconciliationSandboxConfigured) externalPending.push('mercado_pago_reconciliation_sandbox_credentials');
  if(!gates.mpWebhookSecretConfigured) externalPending.push('mercado_pago_webhook_secret');
  if(gates.mpWebhookSecretConfigured&&!gates.mpWebhookSignatureEnforced) externalPending.push('webhook_signature_enforcement_not_enabled');

  const dataPending=[];
  if(gates.ledgerReconciliationClean===false) dataPending.push('ledger_divergences');
  if(gates.storedPaymentReconciliationClean===false) dataPending.push('payment_amount_divergences');
  if(gates.storedPaymentEvidenceComplete===false) dataPending.push('missing_stored_provider_evidence');

  const codeReady=
    gates.fixedReleasePolicy15Days &&
    gates.sellerReadOnlyView &&
    gates.chargebackResponsibilityClassification &&
    gates.cardSecurityShadow &&
    gates.realMoneyFeatureDisabled &&
    gates.checkoutTakeoverDisabled &&
    gates.payoutExecutionDisabled;

  let nextStage='controlled_homologation_review';
  if(safetyViolations.length) nextStage='stop_and_restore_fail_closed';
  else if(externalPending.length||dataPending.length) nextStage='finish_sandbox_and_data_validation';

  return {
    phase:'1',
    mode:'shadow',
    codeReady,
    readyForRealMoney:false,
    gates,
    safetyViolations,
    externalPending,
    dataPending,
    nextStage
  };
}

export default {buildArianaPayPhase1Readiness};
