// Ariana Pay — política central de liquidação do marketplace.
// Regra vigente: seller e fabricante direto recebem exclusivamente por Mercado Pago Split 1:1.
// Não há fallback operacional por Pix, Efí, Money Out ou repasse manual.
// O prazo de liberação segue as condições fixas da própria conta Mercado Pago do recebedor.

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
  if(['deferred_supplier_payout','deferred','delivery_plus_15','delivery+15','repasse_diferido','efi','money_out','pix','manual_payout'].includes(v)) return 'unsupported_deferred_payout';
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
  const directSupplierMpSplitAllowed=clean(env.ARIANA_PAY_DIRECT_SUPPLIER_MP_SPLIT_ALLOWED)===''
    ? true
    : flag(env.ARIANA_PAY_DIRECT_SUPPLIER_MP_SPLIT_ALLOWED);
  const marketplaceMpSplitAllowed=clean(env.ARIANA_PAY_MARKETPLACE_MP_SPLIT_ALLOWED)===''
    ? true
    : flag(env.ARIANA_PAY_MARKETPLACE_MP_SPLIT_ALLOWED);
  const mpSplitExecutionEnabled=flag(env.ARIANA_PAY_MP_SPLIT_EXECUTION_ENABLED);

  return {
    policy:'mercadopago_split_only',
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
        enabled:false,
        productionExecutionEnabled:false,
        disabledReason:'mercadopago_split_only_policy',
        pixFallback:false,
        efiFallback:false,
        moneyOutFallback:false,
        manualPayoutFallback:false
      }
    },
    requiredControls:{
      oauthRequired:true,
      kyc6Required:true,
      oauthCredentialPersistenceRequiredForProduction:true,
      explicitReleasePolicyAcceptanceRequired:true
    },
    safety:{
      failClosed:true,
      noMercadoPagoConnectionMeansNoSales:true,
      pixFallback:false,
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
    releasePolicy:'seller_account_fixed_terms',
    deliveryPlus15Guaranteed:false,
    requiresMerchantOfRecordModel:false,
    marketplaceCommissionPercent:12,
    mercadoPago:mp,
    pixFallback:false,
    blockers:[...new Set(blockers)],
    reason:routeReady?'mercadopago_native_split_ready':'mercadopago_native_split_not_ready',
    warning:'No Split 1:1, o prazo de liberação pertence à conta do vendedor/fabricante e não é controlado por entrega + 15 dias.'
  };
}

function unsupportedPayoutDecision(relationship){
  return {
    ok:false,
    relationship,
    mode:'blocked',
    provider:null,
    routeReady:false,
    productionAllowed:false,
    executionEnabled:false,
    marketplaceCommissionPercent:12,
    pixFallback:false,
    blockers:['deferred_payout_disabled_by_split_only_policy'],
    reason:'mercadopago_split_only_policy'
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
      pixFallback:false,
      reason:'manufacturer_relationship_type_required'
    };
  }

  if(requested==='unsupported_deferred_payout'){
    return unsupportedPayoutDecision(relationship);
  }

  // AUTO e modo explícito usam exclusivamente o Split Mercado Pago.
  // Se OAuth/KYC/aceite não estiverem prontos, o fabricante fica bloqueado em vez de cair em Pix.
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
  getSettlementPolicyCapabilities,
  chooseSettlementMode,
  assertMarketplaceNativeSplitReleaseSafe,
  mercadoPagoReadiness
};