// Ariana Pay — política central de liquidação.
// Regra fixa: fabricante só pode receber 15 dias após entrega confirmada.
// Para Split 1:1 nativo do Mercado Pago, produção permanece bloqueada até existir
// comprovação comercial de que a política de liberação atende essa regra.

export const ARIANA_PAY_SETTLEMENT_HOLD_DAYS = 15;
export const ARIANA_PAY_SETTLEMENT_TRIGGER = 'delivery_confirmed';

function clean(value=''){
  return String(value ?? '').trim();
}

function flag(value){
  return clean(value).toLowerCase()==='true';
}

function normalizeRelationship(value=''){
  const v=clean(value).toLowerCase();
  if(['direct_supplier','supplier','fornecedor','atacado','wholesale','reseller_supplier'].includes(v)) return 'direct_supplier';
  if(['marketplace','seller','third_party_seller','fabricante_marketplace','marketplace_seller'].includes(v)) return 'marketplace_seller';
  return v||'unknown';
}

export function getSettlementPolicyCapabilities(env=process.env){
  const verified=flag(env.ARIANA_PAY_MP_SELLER_RELEASE_POLICY_VERIFIED);
  const reference=clean(env.ARIANA_PAY_MP_SELLER_RELEASE_POLICY_REFERENCE);
  const trigger=clean(env.ARIANA_PAY_MP_SELLER_RELEASE_POLICY_TRIGGER||'').toLowerCase();
  const days=Number(env.ARIANA_PAY_MP_SELLER_RELEASE_POLICY_DAYS||0);
  const nativeSplit15dVerified=Boolean(
    verified&&
    reference&&
    trigger===ARIANA_PAY_SETTLEMENT_TRIGGER&&
    Number.isFinite(days)&&days>=ARIANA_PAY_SETTLEMENT_HOLD_DAYS
  );

  return {
    requiredPolicy:{
      trigger:ARIANA_PAY_SETTLEMENT_TRIGGER,
      holdDays:ARIANA_PAY_SETTLEMENT_HOLD_DAYS,
      chargebackGuardRequired:true,
      disputeGuardRequired:true
    },
    mercadoPagoNativeSplit:{
      provider:'mercadopago',
      model:'split_1_1',
      publicApiControlsSellerReleaseFromDelivery:false,
      providerReleasePolicyVerified:nativeSplit15dVerified,
      configuredTrigger:trigger||null,
      configuredDays:Number.isFinite(days)&&days>0?days:null,
      verificationReferencePresent:Boolean(reference),
      productionAllowed:nativeSplit15dVerified
    },
    deferredSupplierPayout:{
      mode:'direct_sale_deferred_payout',
      releaseEngine:'ariana_pay',
      trigger:ARIANA_PAY_SETTLEMENT_TRIGGER,
      holdDays:ARIANA_PAY_SETTLEMENT_HOLD_DAYS,
      payoutRail:'efi_pix',
      productionExecutionEnabled:flag(env.ARIANA_PAY_PAYOUT_EXECUTION_ENABLED)
    },
    safety:{
      failClosed:true,
      checkoutChanged:false,
      erpChanged:false,
      gustavoChanged:false
    }
  };
}

export function chooseSettlementMode({relationshipType='',manufacturer={},env=process.env}={}){
  const capabilities=getSettlementPolicyCapabilities(env);
  const relationship=normalizeRelationship(
    relationshipType||
    manufacturer.relationshipType||
    manufacturer.commercialModel||
    manufacturer.settlement?.relationshipType
  );

  if(relationship==='direct_supplier'){
    return {
      ok:true,
      relationship,
      mode:'deferred_supplier_payout',
      provider:'efi',
      holdDays:ARIANA_PAY_SETTLEMENT_HOLD_DAYS,
      trigger:ARIANA_PAY_SETTLEMENT_TRIGGER,
      productionAllowed:true,
      requiresMerchantOfRecordModel:true,
      reason:'direct_supplier_uses_ariana_controlled_15d_release'
    };
  }

  if(relationship==='marketplace_seller'){
    if(capabilities.mercadoPagoNativeSplit.productionAllowed){
      return {
        ok:true,
        relationship,
        mode:'mercadopago_native_split',
        provider:'mercadopago',
        holdDays:ARIANA_PAY_SETTLEMENT_HOLD_DAYS,
        trigger:ARIANA_PAY_SETTLEMENT_TRIGGER,
        productionAllowed:true,
        requiresMerchantOfRecordModel:false,
        reason:'provider_release_policy_verified'
      };
    }
    return {
      ok:false,
      relationship,
      mode:'blocked',
      provider:'mercadopago',
      holdDays:ARIANA_PAY_SETTLEMENT_HOLD_DAYS,
      trigger:ARIANA_PAY_SETTLEMENT_TRIGGER,
      productionAllowed:false,
      requiresMerchantOfRecordModel:false,
      reason:'mercadopago_seller_release_policy_not_verified',
      actionRequired:'Obter confirmação comercial do Mercado Pago de liberação compatível com entrega + 15 dias e registrar a referência no Ariana Pay.'
    };
  }

  return {
    ok:false,
    relationship,
    mode:'blocked',
    provider:null,
    holdDays:ARIANA_PAY_SETTLEMENT_HOLD_DAYS,
    trigger:ARIANA_PAY_SETTLEMENT_TRIGGER,
    productionAllowed:false,
    reason:'manufacturer_relationship_type_required'
  };
}

export function assertMarketplaceNativeSplitReleaseSafe({env=process.env}={}){
  const capabilities=getSettlementPolicyCapabilities(env);
  if(!capabilities.mercadoPagoNativeSplit.productionAllowed){
    const error=new Error('Split Mercado Pago real bloqueado: política de liberação do vendedor em entrega + 15 dias ainda não foi comprovada.');
    error.code='ARIANA_PAY_MP_15D_RELEASE_POLICY_UNVERIFIED';
    error.statusCode=409;
    error.capabilities=capabilities;
    throw error;
  }
  return capabilities.mercadoPagoNativeSplit;
}

export default {
  ARIANA_PAY_SETTLEMENT_HOLD_DAYS,
  ARIANA_PAY_SETTLEMENT_TRIGGER,
  getSettlementPolicyCapabilities,
  chooseSettlementMode,
  assertMarketplaceNativeSplitReleaseSafe
};
