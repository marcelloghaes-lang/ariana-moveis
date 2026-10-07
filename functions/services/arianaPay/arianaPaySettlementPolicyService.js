// Ariana Pay — política central de liquidação.
// Dois modos são suportados por fabricante:
// 1) Mercado Pago Split 1:1: vendedor recebe na própria conta MP conforme o prazo fixo da conta.
// 2) Repasse diferido: Ariana controla entrega + 15 dias e então executa payout.
// O Split 1:1 NÃO garante entrega + 15 dias; essa diferença é sempre explicitada e validada.

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
  if(['direct_supplier','supplier','fornecedor','atacado','wholesale','reseller_supplier','fabricante_direto'].includes(v)) return 'direct_supplier';
  if(['marketplace','seller','third_party_seller','fabricante_marketplace','marketplace_seller'].includes(v)) return 'marketplace_seller';
  return v||'unknown';
}

function normalizeRequestedMode(value=''){
  const v=clean(value).toLowerCase();
  if(['mercadopago_native_split','mercadopago_split','mp_split','split','split_1_1','marketplace_split'].includes(v)) return 'mercadopago_native_split';
  if(['deferred_supplier_payout','deferred','delivery_plus_15','delivery+15','repasse_diferido','efi','money_out'].includes(v)) return 'deferred_supplier_payout';
  return 'auto';
}

function mercadoPagoReadiness(manufacturer={}){
  const mp=manufacturer.mercadoPago&&typeof manufacturer.mercadoPago==='object'?manufacturer.mercadoPago:{};
  const settlement=manufacturer.settlement&&typeof manufacturer.settlement==='object'?manufacturer.settlement:{};
  const userId=clean(mp.userId||mp.user_id||manufacturer.mercadoPagoUserId||settlement.mercadoPagoUserId);
  const oauthConnected=mp.oauthConnected===true||mp.connected===true||Boolean(userId);
  const kycLevel=Number(mp.kycLevel||mp.kyc_level||settlement.mercadoPagoKycLevel||0);
  const kyc6Verified=mp.kyc6Verified===true||settlement.mercadoPagoKyc6Verified===true||(Number.isFinite(kycLevel)&&kycLevel>=6);
  const acceptsFixedRelease=
    settlement.acceptsMercadoPagoFixedRelease===true||
    settlement.acceptsMercadoPagoReleaseTerms===true||
    mp.acceptsFixedRelease===true;

  const blockers=[];
  if(!oauthConnected) blockers.push('mercadopago_oauth_required');
  if(!kyc6Verified) blockers.push('mercadopago_kyc6_required');
  if(!acceptsFixedRelease) blockers.push('mercadopago_fixed_release_terms_not_accepted');

  return {
    userId:userId||null,
    oauthConnected,
    kycLevel:Number.isFinite(kycLevel)&&kycLevel>0?kycLevel:null,
    kyc6Verified,
    acceptsFixedRelease,
    ready:blockers.length===0,
    blockers
  };
}

export function getSettlementPolicyCapabilities(env=process.env){
  const directSupplierMpSplitAllowed=flag(env.ARIANA_PAY_DIRECT_SUPPLIER_MP_SPLIT_ALLOWED);
  const marketplaceMpSplitAllowed=clean(env.ARIANA_PAY_MARKETPLACE_MP_SPLIT_ALLOWED)===''
    ? true
    : flag(env.ARIANA_PAY_MARKETPLACE_MP_SPLIT_ALLOWED);
  const mpSplitExecutionEnabled=flag(env.ARIANA_PAY_MP_SPLIT_EXECUTION_ENABLED);
  const moneyOutAuthorized=flag(env.ARIANA_PAY_MP_MONEY_OUT_AUTHORIZED);

  return {
    modes:{
      mercadoPagoNativeSplit:{
        provider:'mercadopago',
        model:'split_1_1',
        parameter:'application_fee',
        sellerAuthorization:'oauth',
        requiredSellerKycLevel:6,
        releasePolicy:'seller_account_fixed_terms',
        marketplaceControlsReleaseFromDelivery:false,
        deliveryPlus15Guaranteed:false,
        directSupplierAllowed:directSupplierMpSplitAllowed,
        marketplaceSellerAllowed:marketplaceMpSplitAllowed,
        executionEnabled:mpSplitExecutionEnabled
      },
      deferredSupplierPayout:{
        mode:'direct_sale_deferred_payout',
        releaseEngine:'ariana_pay',
        trigger:ARIANA_PAY_SETTLEMENT_TRIGGER,
        holdDays:ARIANA_PAY_SETTLEMENT_HOLD_DAYS,
        deliveryPlus15Guaranteed:true,
        preferredPayoutRail:moneyOutAuthorized?'mercadopago_money_out':'efi_pix',
        moneyOutCommercialAuthorizationRequired:true,
        moneyOutAuthorized,
        productionExecutionEnabled:flag(env.ARIANA_PAY_PAYOUT_EXECUTION_ENABLED)
      }
    },
    requiredControls:{
      chargebackGuardRequired:true,
      disputeGuardRequired:true,
      oauthCredentialPersistenceRequiredForProduction:true,
      explicitReleasePolicyAcceptanceRequiredForNativeSplit:true
    },
    safety:{
      failClosed:true,
      checkoutChanged:false,
      erpChanged:false,
      gustavoChanged:false
    }
  };
}

function nativeSplitDecision({relationship,manufacturer,env}){
  const capabilities=getSettlementPolicyCapabilities(env);
  const mp=mercadoPagoReadiness(manufacturer);
  const allowedByRelationship=relationship==='direct_supplier'
    ? capabilities.modes.mercadoPagoNativeSplit.directSupplierAllowed
    : capabilities.modes.mercadoPagoNativeSplit.marketplaceSellerAllowed;
  const blockers=[...mp.blockers];
  if(!allowedByRelationship) blockers.push('mercadopago_split_not_enabled_for_relationship');

  const routeReady=blockers.length===0;
  return {
    ok:routeReady,
    relationship,
    mode:routeReady?'mercadopago_native_split':'blocked',
    provider:'mercadopago',
    model:'split_1_1',
    routeReady,
    productionAllowed:routeReady&&capabilities.modes.mercadoPagoNativeSplit.executionEnabled,
    executionEnabled:capabilities.modes.mercadoPagoNativeSplit.executionEnabled,
    holdDays:null,
    trigger:'mercadopago_account_release',
    releasePolicy:'seller_account_fixed_terms',
    deliveryPlus15Guaranteed:false,
    requiresMerchantOfRecordModel:false,
    marketplaceCommissionPercent:12,
    mercadoPago:mp,
    blockers:[...new Set(blockers)],
    reason:routeReady?'mercadopago_native_split_ready':'mercadopago_native_split_not_ready',
    warning:'No Split 1:1, o prazo de liberação pertence à conta do vendedor e não é controlado por entrega + 15 dias.'
  };
}

function deferredDecision({relationship,env}){
  const capabilities=getSettlementPolicyCapabilities(env);
  return {
    ok:true,
    relationship,
    mode:'deferred_supplier_payout',
    provider:capabilities.modes.deferredSupplierPayout.preferredPayoutRail,
    routeReady:true,
    productionAllowed:capabilities.modes.deferredSupplierPayout.productionExecutionEnabled,
    executionEnabled:capabilities.modes.deferredSupplierPayout.productionExecutionEnabled,
    holdDays:ARIANA_PAY_SETTLEMENT_HOLD_DAYS,
    trigger:ARIANA_PAY_SETTLEMENT_TRIGGER,
    releasePolicy:'delivery_plus_15_days',
    deliveryPlus15Guaranteed:true,
    requiresMerchantOfRecordModel:true,
    marketplaceCommissionPercent:12,
    reason:'ariana_controlled_delivery_plus_15_release'
  };
}

export function chooseSettlementMode({relationshipType='',manufacturer={},env=process.env}={}){
  const relationship=normalizeRelationship(
    relationshipType||
    manufacturer.relationshipType||
    manufacturer.commercialModel||
    manufacturer.settlement?.relationshipType
  );
  const requested=normalizeRequestedMode(
    manufacturer.settlement?.mode||
    manufacturer.settlementMode||
    manufacturer.payment?.settlementMode
  );

  if(!['direct_supplier','marketplace_seller'].includes(relationship)){
    return {
      ok:false,
      relationship,
      mode:'blocked',
      provider:null,
      productionAllowed:false,
      reason:'manufacturer_relationship_type_required'
    };
  }

  if(requested==='deferred_supplier_payout'){
    return deferredDecision({relationship,env});
  }

  if(requested==='mercadopago_native_split'){
    return nativeSplitDecision({relationship,manufacturer,env});
  }

  // AUTO: fornecedor direto usa Split MP quando está completamente apto e aceitou
  // o prazo fixo da conta. Caso contrário, mantém entrega + 15 dias no repasse diferido.
  if(relationship==='direct_supplier'){
    const mpDecision=nativeSplitDecision({relationship,manufacturer,env});
    return mpDecision.ok?mpDecision:deferredDecision({relationship,env});
  }

  // Seller marketplace é naturalmente 1:1; se não estiver apto, falha fechado.
  return nativeSplitDecision({relationship,manufacturer,env});
}

export function assertMarketplaceNativeSplitReleaseSafe({manufacturer={},relationshipType='marketplace_seller',env=process.env}={}){
  const decision=nativeSplitDecision({
    relationship:normalizeRelationship(relationshipType),
    manufacturer,
    env
  });
  if(!decision.ok){
    const error=new Error('Split Mercado Pago não está pronto para este vendedor/fabricante.');
    error.code='ARIANA_PAY_MP_NATIVE_SPLIT_NOT_READY';
    error.statusCode=409;
    error.decision=decision;
    throw error;
  }
  return decision;
}

export { mercadoPagoReadiness };

export default {
  ARIANA_PAY_SETTLEMENT_HOLD_DAYS,
  ARIANA_PAY_SETTLEMENT_TRIGGER,
  getSettlementPolicyCapabilities,
  chooseSettlementMode,
  assertMarketplaceNativeSplitReleaseSafe,
  mercadoPagoReadiness
};
