// Ariana Pay — readiness seguro da Fase 1.
// Expõe apenas booleanos/contagens; nunca retorna secrets ou credenciais.

function on(value=''){
  return String(value||'').trim().toLowerCase()==='true';
}
function present(value=''){
  return Boolean(String(value||'').trim());
}

export function buildArianaPayPhase1Readiness({audit=null,env=process.env}={}){
  const recon=audit?.paymentReconciliation?.stats||{};
  const gates={
    shadowFeatureEnabled:on(env.ARIANA_PAY_SHADOW_ENABLED),
    fixedReleasePolicy15Days:true,
    ledgerReconciliationClean:audit?Number(audit.divergenceCount||0)===0:null,
    storedPaymentReconciliationClean:audit?Number(recon.divergent||0)===0:null,
    storedPaymentEvidenceComplete:audit?Number(recon.insufficientEvidence||0)===0:null,
    sellerReadOnlyView:true,
    chargebackResponsibilityClassification:true,
    cardSecurityShadow:true,
    payoutExecutionDisabled:true,
    mpWebhookSecretConfigured:present(env.MP_WEBHOOK_SECRET),
    mpWebhookSignatureEnforced:on(env.MP_WEBHOOK_SIGNATURE_ENFORCE),
    mp3dsSandboxConfigured:
      on(env.MP_3DS_SANDBOX_ENABLED)&&
      present(env.MP_3DS_SANDBOX_ACCESS_TOKEN)&&
      present(env.MP_3DS_SANDBOX_NOTIFICATION_URL),
    mpReconciliationSandboxConfigured:
      on(env.ARIANA_PAY_RECON_SANDBOX_ENABLED)&&
      present(env.MP_RECON_SANDBOX_ACCESS_TOKEN)
  };

  const externalPending=[];
  if(!gates.mp3dsSandboxConfigured) externalPending.push('mercado_pago_3ds_sandbox_credentials_or_callback');
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
    gates.payoutExecutionDisabled;

  return {
    phase:'1',
    mode:'shadow',
    codeReady,
    readyForRealMoney:false,
    gates,
    externalPending,
    dataPending,
    nextStage:externalPending.length||dataPending.length
      ? 'finish_sandbox_and_data_validation'
      : 'controlled_homologation_review'
  };
}

export default {buildArianaPayPhase1Readiness};
