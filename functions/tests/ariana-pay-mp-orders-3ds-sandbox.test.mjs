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

const SAFE_ENV={
  MP_3DS_SANDBOX_ENABLED:'true',
  MP_3DS_SANDBOX_ACCESS_TOKEN:'DEDICATED-SANDBOX-TOKEN',
  MP_3DS_SANDBOX_NOTIFICATION_URL:'https://sandbox.example.com/webhooks/mercadopago'
};

test('sandbox nunca cai automaticamente no token padrão do checkout',()=>{
  const cfg=getMercadoPago3dsSandboxConfig({
    MP_ACCESS_TOKEN:'DEFAULT-CHECKOUT-TOKEN',
    MP_3DS_SANDBOX_ENABLED:'true'
  });
  assert.equal(cfg.accessToken,'');
  assert.equal(cfg.reusesDefaultAccessToken,false);
  assert.throws(()=>assertMercadoPago3dsSandboxReady(cfg),/MP_3DS_SANDBOX_ACCESS_TOKEN/);
});

test('sandbox bloqueia reutilização explícita do MP_ACCESS_TOKEN',()=>{
  const cfg=getMercadoPago3dsSandboxConfig({
    MP_ACCESS_TOKEN:'SAME-TOKEN',
    MP_3DS_SANDBOX_ACCESS_TOKEN:'SAME-TOKEN',
    MP_3DS_SANDBOX_ENABLED:'true',
    MP_3DS_SANDBOX_NOTIFICATION_URL:'https://sandbox.example.com/webhook'
  });
  assert.equal(cfg.reusesDefaultAccessToken,true);
  assert.throws(()=>assertMercadoPago3dsSandboxReady(cfg),/não pode reutilizar MP_ACCESS_TOKEN/);
});

test('sandbox aceita credencial dedicada sem depender de prefixo',()=>{
  const cfg=getMercadoPago3dsSandboxConfig(SAFE_ENV);
  assert.doesNotThrow(()=>assertMercadoPago3dsSandboxReady(cfg));
});

test('sandbox aceita ausência de callback porque Orders usa Webhooks configurados no painel',()=>{
  assert.doesNotThrow(
    ()=>assertMercadoPago3dsSandboxReady({
      enabled:true,
      baseUrl:'https://api.mercadopago.com',
      accessToken:'DEDICATED',
      reusesDefaultAccessToken:false,
      notificationUrl:''
    })
  );

  assert.throws(
    ()=>assertMercadoPago3dsSandboxReady({
      enabled:true,
      baseUrl:'https://api.mercadopago.com',
      accessToken:'DEDICATED',
      reusesDefaultAccessToken:false,
      notificationUrl:'http://localhost/webhook'
    }),
    /HTTPS/
  );
});

test('sandbox bloqueia base URL diferente da API oficial Mercado Pago',()=>{
  assert.throws(
    ()=>assertMercadoPago3dsSandboxReady({
      enabled:true,
      baseUrl:'https://example.invalid',
      accessToken:'DEDICATED',
      reusesDefaultAccessToken:false,
      notificationUrl:'https://sandbox.example.com/webhooks/mercadopago'
    }),
    /api\.mercadopago\.com/
  );
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

test('normaliza challenge 3DS e live_mode',()=>{
  const result=normalizeMercadoPago3dsOrderResponse({
    id:'ORD1',
    external_reference:'order-1',
    live_mode:false,
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

  assert.equal(result.liveMode,false);
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
          live_mode:false,
          external_reference:'order-1',
          transactions:{payments:[{id:'PAY1',status:'processed',status_detail:'accredited'}]}
        }
      };
    }
  };

  const client=createMercadoPago3dsSandboxClient({
    axios,
    env:SAFE_ENV
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
  assert.equal(calls[0].options.headers.Authorization,'Bearer DEDICATED-SANDBOX-TOKEN');
  assert.equal('notification_url' in calls[0].payload,false);
  assert.equal(JSON.stringify(result.request).includes('sandbox-card-token'),false);
});

test('cliente rejeita resposta live_mode=true na criação',async()=>{
  const client=createMercadoPago3dsSandboxClient({
    axios:{
      async post(){
        return {
          status:201,
          data:{id:'LIVE1',live_mode:true,transactions:{payments:[{id:'PAY1',status:'processed'}]}}
        };
      }
    },
    env:SAFE_ENV
  });

  await assert.rejects(
    ()=>client.createOrder({
      orderId:'order-1',
      amount:50,
      email:'teste@example.com',
      paymentMethodId:'master',
      cardToken:'sandbox-card-token'
    }),
    error=>error?.code==='MP_3DS_LIVE_MODE_REJECTED'&&error?.statusCode===409
  );
});

test('cliente consulta order 3DS em modo somente leitura',async()=>{
  const calls=[];
  const axios={
    async get(url,options){
      calls.push({url,options});
      return {
        status:200,
        data:{
          id:'ORD1',
          live_mode:false,
          external_reference:'order-1',
          transactions:{
            payments:[{
              id:'PAY1',
              status:'action_required',
              status_detail:'pending_challenge',
              transaction_security:{
                status:'pending',
                liability_shift:'required',
                url:'https://example.com/challenge'
              }
            }]
          }
        }
      };
    }
  };

  const client=createMercadoPago3dsSandboxClient({axios,env:SAFE_ENV});
  const result=await client.getOrder('ORD1');

  assert.equal(result.ok,true);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://api.mercadopago.com/v1/orders/ORD1');
  assert.equal(calls[0].options.headers.Authorization,'Bearer DEDICATED-SANDBOX-TOKEN');
  assert.equal(result.result.pendingChallenge,true);
  assert.equal(result.result.liabilityShiftRequired,true);
});

test('consulta também rejeita order live_mode=true',async()=>{
  const client=createMercadoPago3dsSandboxClient({
    axios:{
      async get(){
        return {status:200,data:{id:'LIVE1',live_mode:true}};
      }
    },
    env:SAFE_ENV
  });

  await assert.rejects(
    ()=>client.getOrder('LIVE1'),
    error=>error?.code==='MP_3DS_LIVE_MODE_REJECTED'
  );
});

test('cliente recusa chamada quando sandbox está desligado',async()=>{
  const axios={post:async()=>{throw new Error('não deveria chamar')}};
  const client=createMercadoPago3dsSandboxClient({
    axios,
    env:{
      ...SAFE_ENV,
      MP_3DS_SANDBOX_ENABLED:'false'
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
