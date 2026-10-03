import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getMercadoPago3dsSandboxConfig,
  assertMercadoPago3dsSandboxReady,
  buildMercadoPago3dsOrderPayload,
  redactMercadoPago3dsPayload,
  normalizeMercadoPago3dsOrderResponse,
  createMercadoPago3dsSandboxClient
} from '../services/arianaPay/mercadoPagoOrders3dsSandboxService.js';

test('sandbox nunca cai automaticamente no token padrão de produção',()=>{
  const cfg=getMercadoPago3dsSandboxConfig({
    MP_ACCESS_TOKEN:'PRODUCTION_TOKEN_SHOULD_NOT_BE_USED',
    MP_3DS_SANDBOX_ENABLED:'true'
  });
  assert.equal(cfg.accessToken,'');
  assert.throws(()=>assertMercadoPago3dsSandboxReady(cfg),/MP_3DS_SANDBOX_ACCESS_TOKEN/);
});

test('payload usa Orders + 3DS on_fraud_risk + liability_shift required',()=>{
  const payload=buildMercadoPago3dsOrderPayload({
    orderId:'order-1',
    amount:50,
    email:'teste@example.com',
    paymentMethodId:'master',
    cardToken:'test-token',
    installmentCount:3
  });

  assert.equal(payload.type,'online');
  assert.equal(payload.total_amount,'50.00');
  assert.equal(payload.config.online.transaction_security.validation,'on_fraud_risk');
  assert.equal(payload.config.online.transaction_security.liability_shift,'required');
  assert.equal(payload.transactions.payments[0].payment_method.type,'credit_card');
  assert.equal(payload.transactions.payments[0].payment_method.installments,3);
});

test('redação nunca devolve token de cartão',()=>{
  const payload=buildMercadoPago3dsOrderPayload({
    orderId:'order-1',
    amount:50,
    email:'teste@example.com',
    paymentMethodId:'master',
    cardToken:'SECRET_CARD_TOKEN'
  });
  const redacted=redactMercadoPago3dsPayload(payload);
  assert.equal(JSON.stringify(redacted).includes('SECRET_CARD_TOKEN'),false);
  assert.equal(redacted.transactions.payments[0].payment_method.token,'[REDACTED_CARD_TOKEN]');
});

test('normaliza challenge 3DS',()=>{
  const result=normalizeMercadoPago3dsOrderResponse({
    id:'ORD1',
    external_reference:'order-1',
    transactions:{
      payments:[{
        id:'PAY1',
        status:'action_required',
        status_detail:'pending_challenge',
        payment_method:{
          transaction_security:{
            id:'3ds1',
            type:'three_ds',
            status:'PENDING',
            validation:'on_fraud_risk',
            liability_shift:'required',
            url:'https://example.com/challenge'
          }
        }
      }]
    }
  });

  assert.equal(result.actionRequired,true);
  assert.equal(result.pendingChallenge,true);
  assert.equal(result.challengeUrl,'https://example.com/challenge');
  assert.equal(result.liabilityShiftRequired,true);
});

test('cliente só chama /v1/orders quando sandbox explicitamente habilitado',async()=>{
  const calls=[];
  const axios={
    async post(url,payload,options){
      calls.push({url,payload,options});
      return {
        status:201,
        data:{
          id:'ORD1',
          external_reference:'order-1',
          transactions:{payments:[{id:'PAY1',status:'processed',status_detail:'accredited'}]}
        }
      };
    }
  };

  const client=createMercadoPago3dsSandboxClient({
    axios,
    env:{
      MP_3DS_SANDBOX_ENABLED:'true',
      MP_3DS_SANDBOX_ACCESS_TOKEN:'TEST_TOKEN',
      MP_3DS_SANDBOX_BASE_URL:'https://api.mercadopago.com'
    }
  });

  const result=await client.createOrder({
    orderId:'order-1',
    amount:50,
    email:'teste@example.com',
    paymentMethodId:'master',
    cardToken:'sandbox-card-token'
  });

  assert.equal(result.ok,true);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://api.mercadopago.com/v1/orders');
  assert.equal(calls[0].options.headers.Authorization,'Bearer TEST_TOKEN');
  assert.equal(JSON.stringify(result.request).includes('sandbox-card-token'),false);
});

test('cliente recusa chamada quando sandbox está desligado',async()=>{
  const axios={post:async()=>{throw new Error('não deveria chamar')}};
  const client=createMercadoPago3dsSandboxClient({
    axios,
    env:{
      MP_3DS_SANDBOX_ENABLED:'false',
      MP_3DS_SANDBOX_ACCESS_TOKEN:'TEST_TOKEN'
    }
  });

  await assert.rejects(
    ()=>client.createOrder({
      orderId:'order-1',
      amount:50,
      email:'teste@example.com',
      paymentMethodId:'master',
      cardToken:'sandbox-card-token'
    }),
    /desabilitado/
  );
});
