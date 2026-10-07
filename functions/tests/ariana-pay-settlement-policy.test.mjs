import assert from 'node:assert/strict';

import {
  getSettlementPolicyCapabilities,
  chooseSettlementMode,
  assertMarketplaceNativeSplitReleaseSafe,
  mercadoPagoReadiness
} from '../services/arianaPay/arianaPaySettlementPolicyService.js';

const env={
  ARIANA_PAY_DIRECT_SUPPLIER_MP_SPLIT_ALLOWED:'true',
  ARIANA_PAY_MP_SPLIT_EXECUTION_ENABLED:'false'
};

const capabilities=getSettlementPolicyCapabilities(env);
assert.equal(capabilities.modes.mercadoPagoNativeSplit.directSupplierAllowed,true);
assert.equal(capabilities.modes.mercadoPagoNativeSplit.deliveryPlus15Guaranteed,false);
assert.equal(capabilities.modes.mercadoPagoNativeSplit.executionEnabled,false);
assert.equal(capabilities.modes.deferredSupplierPayout.deliveryPlus15Guaranteed,true);
assert.equal(capabilities.modes.deferredSupplierPayout.holdDays,15);

const directAutoNoMp=chooseSettlementMode({
  relationshipType:'direct_supplier',
  manufacturer:{},
  env
});
assert.equal(directAutoNoMp.ok,true);
assert.equal(directAutoNoMp.mode,'deferred_supplier_payout');
assert.equal(directAutoNoMp.holdDays,15);
assert.equal(directAutoNoMp.deliveryPlus15Guaranteed,true);

const mpManufacturer={
  manufacturerId:'DIRECT-SUPPLIER-TEST',
  mercadoPago:{
    userId:'3170200825',
    oauthConnected:true,
    kyc6Verified:true
  },
  settlement:{
    mode:'mercadopago_native_split',
    acceptsMercadoPagoFixedRelease:true
  }
};

const readiness=mercadoPagoReadiness(mpManufacturer);
assert.equal(readiness.ready,true);
assert.equal(readiness.userId,'3170200825');

const directSplit=chooseSettlementMode({
  relationshipType:'direct_supplier',
  manufacturer:mpManufacturer,
  env
});
assert.equal(directSplit.ok,true);
assert.equal(directSplit.mode,'mercadopago_native_split');
assert.equal(directSplit.provider,'mercadopago');
assert.equal(directSplit.deliveryPlus15Guaranteed,false);
assert.equal(directSplit.releasePolicy,'seller_account_fixed_terms');
assert.equal(directSplit.routeReady,true);
assert.equal(directSplit.productionAllowed,false);
assert.doesNotThrow(()=>assertMarketplaceNativeSplitReleaseSafe({
  manufacturer:mpManufacturer,
  relationshipType:'direct_supplier',
  env
}));

const missingOAuth=chooseSettlementMode({
  relationshipType:'direct_supplier',
  manufacturer:{
    settlement:{mode:'mercadopago_native_split',acceptsMercadoPagoFixedRelease:true},
    mercadoPago:{kyc6Verified:true}
  },
  env
});
assert.equal(missingOAuth.ok,false);
assert.equal(missingOAuth.mode,'blocked');
assert.ok(missingOAuth.blockers.includes('mercadopago_oauth_required'));

const missingKyc=chooseSettlementMode({
  relationshipType:'direct_supplier',
  manufacturer:{
    settlement:{mode:'mercadopago_native_split',acceptsMercadoPagoFixedRelease:true},
    mercadoPago:{userId:'123',oauthConnected:true}
  },
  env
});
assert.ok(missingKyc.blockers.includes('mercadopago_kyc6_required'));

const missingAcceptance=chooseSettlementMode({
  relationshipType:'direct_supplier',
  manufacturer:{
    settlement:{mode:'mercadopago_native_split'},
    mercadoPago:{userId:'123',oauthConnected:true,kyc6Verified:true}
  },
  env
});
assert.ok(missingAcceptance.blockers.includes('mercadopago_fixed_release_terms_not_accepted'));

const forcedDeferred=chooseSettlementMode({
  relationshipType:'direct_supplier',
  manufacturer:{settlement:{mode:'deferred_supplier_payout'}},
  env
});
assert.equal(forcedDeferred.mode,'deferred_supplier_payout');
assert.equal(forcedDeferred.holdDays,15);
assert.equal(forcedDeferred.deliveryPlus15Guaranteed,true);

assert.throws(
  ()=>assertMarketplaceNativeSplitReleaseSafe({
    manufacturer:{settlement:{mode:'mercadopago_native_split'}},
    relationshipType:'direct_supplier',
    env
  }),
  error=>error?.code==='ARIANA_PAY_MP_NATIVE_SPLIT_NOT_READY'
);

console.log('ariana-pay-settlement-policy.test.mjs: ok');
