import assert from 'node:assert/strict';
import {
  buildMarketplaceSplit,
  createMarketplaceOAuthAuthorization,
  parseMarketplaceOAuthState,
  getMercadoPagoMarketplaceConfig
} from '../services/arianaPay/mercadoPagoMarketplaceSplitService.js';

const env={
  ARIANA_PAY_MP_CLIENT_ID:'1234567890',
  ARIANA_PAY_MP_CLIENT_SECRET:'secret',
  ARIANA_PAY_MP_OAUTH_REDIRECT_URI:'https://example.com/api/v1/marketplace/mp/oauth/callback',
  ARIANA_PAY_MP_OAUTH_STATE_SECRET:'state-secret',
  ARIANA_PAY_MP_CREDENTIALS_SECRET:'credential-secret',
  ARIANA_PAY_MP_COMMISSION_BPS:'1200',
  ARIANA_PAY_MP_SPLIT_EXECUTION_ENABLED:'false',
  ARIANA_PAY_MP_TEST_TOKEN:'true'
};

const split=buildMarketplaceSplit({grossAmount:1000,merchandiseAmount:900,shippingAmount:100,commissionBps:1200});
assert.equal(split.applicationFee,108);
assert.equal(split.sellerGrossBeforeMercadoPagoFee,892);

const auth=createMarketplaceOAuthAuthorization({manufacturerId:'fabricante-teste',env,now:new Date('2026-10-07T13:00:00Z')});
assert.equal(auth.pkce,true);
assert.ok(auth.authorizationUrl.includes('code_challenge='));
assert.ok(auth.authorizationUrl.includes('code_challenge_method=S256'));
const state=parseMarketplaceOAuthState(auth.state,{env,now:new Date('2026-10-07T13:05:00Z')});
assert.equal(state.manufacturerId,'fabricante-teste');
assert.ok(state.codeVerifier.length>=43);

const config=getMercadoPagoMarketplaceConfig(env);
assert.equal(config.testToken,true);
assert.equal(config.executionEnabled,false);
assert.equal(config.oauthConfigured,true);

console.log('ariana-pay-marketplace-oauth: ok');
