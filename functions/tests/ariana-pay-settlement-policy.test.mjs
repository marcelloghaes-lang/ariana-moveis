import assert from 'node:assert/strict';

import {
  getSettlementPolicyCapabilities,
  chooseSettlementMode,
  assertMarketplaceNativeSplitReleaseSafe
} from '../services/arianaPay/arianaPaySettlementPolicyService.js';

const blocked=chooseSettlementMode({relationshipType:'marketplace',env:{}});
assert.equal(blocked.ok,false);
assert.equal(blocked.mode,'blocked');
assert.equal(blocked.productionAllowed,false);
assert.equal(blocked.holdDays,15);
assert.equal(blocked.trigger,'delivery_confirmed');

const direct=chooseSettlementMode({relationshipType:'direct_supplier',env:{}});
assert.equal(direct.ok,true);
assert.equal(direct.mode,'deferred_supplier_payout');
assert.equal(direct.productionAllowed,true);
assert.equal(direct.holdDays,15);
assert.equal(direct.trigger,'delivery_confirmed');

const incompleteVerification=getSettlementPolicyCapabilities({
  ARIANA_PAY_MP_SELLER_RELEASE_POLICY_VERIFIED:'true',
  ARIANA_PAY_MP_SELLER_RELEASE_POLICY_DAYS:'15',
  ARIANA_PAY_MP_SELLER_RELEASE_POLICY_TRIGGER:'delivery_confirmed'
});
assert.equal(incompleteVerification.mercadoPagoNativeSplit.productionAllowed,false);

const verifiedEnv={
  ARIANA_PAY_MP_SELLER_RELEASE_POLICY_VERIFIED:'true',
  ARIANA_PAY_MP_SELLER_RELEASE_POLICY_REFERENCE:'MP-COMMERCIAL-CASE-123',
  ARIANA_PAY_MP_SELLER_RELEASE_POLICY_DAYS:'15',
  ARIANA_PAY_MP_SELLER_RELEASE_POLICY_TRIGGER:'delivery_confirmed'
};
const verified=chooseSettlementMode({relationshipType:'marketplace',env:verifiedEnv});
assert.equal(verified.ok,true);
assert.equal(verified.mode,'mercadopago_native_split');
assert.equal(verified.productionAllowed,true);
assert.equal(verified.holdDays,15);
assert.doesNotThrow(()=>assertMarketplaceNativeSplitReleaseSafe({env:verifiedEnv}));

assert.throws(
  ()=>assertMarketplaceNativeSplitReleaseSafe({env:{}}),
  error=>error?.code==='ARIANA_PAY_MP_15D_RELEASE_POLICY_UNVERIFIED'
);

console.log('ariana-pay-settlement-policy.test.mjs: ok');
