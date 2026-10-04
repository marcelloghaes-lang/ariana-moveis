import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isMpReconciliationTestAccessToken,
  getMpReconciliationSandboxConfig,
  assertMpReconciliationSandboxReady,
  normalizeMpPaymentForReconciliation,
  createMpReconciliationSandboxClient
} from '../services/arianaPay/mercadoPagoReconciliationSandboxService.js';

const SAFE_ENV={
  ARIANA_PAY_RECON_SANDBOX_ENABLED:'true',
  MP_RECON_SANDBOX_ACCESS_TOKEN:'TEST-ONLY'
};

test('sandbox de conciliação nunca usa MP_ACCESS_TOKEN de produção',()=>{
  const cfg=getMpReconciliationSandboxConfig({
    MP_ACCESS_TOKEN:'APP_USR-PROD',
    ARIANA_PAY_RECON_SANDBOX_ENABLED:'true'
  });
  assert.equal(cfg.accessToken,'');
  assert.throws(()=>assertMpReconciliationSandboxReady(cfg),/MP_RECON_SANDBOX_ACCESS_TOKEN/);
});

test('sandbox de conciliação recusa token de produção e base URL não oficial',()=>{
  assert.equal(isMpReconciliationTestAccessToken('TEST-abc'),true);
  assert.equal(isMpReconciliationTestAccessToken('APP_USR-prod'),false);

  assert.throws(
    ()=>assertMpReconciliationSandboxReady({
      enabled:true,
      accessToken:'APP_USR-prod',
      baseUrl:'https://api.mercadopago.com'
    }),
    /credencial de teste/
  );

  assert.throws(
    ()=>assertMpReconciliationSandboxReady({
      enabled:true,
      accessToken:'TEST-abc',
      baseUrl:'https://evil.example.com'
    }),
    /api\.mercadopago\.com/
  );
});

test('normaliza pagamento do provider sem confundir valor ausente com zero',()=>{
  const a=normalizeMpPaymentForReconciliation({id:'p1',status:'approved',currency_id:'BRL'});
  assert.equal(a.providerAmount,null);
  const b=normalizeMpPaymentForReconciliation({id:'p2',transaction_amount:0,status:'refunded'});
  assert.equal(b.providerAmount,0);
});

test('cliente faz somente GET read-only no pagamento solicitado',async()=>{
  const calls=[];
  const axios={
    async get(url,options){
      calls.push({url,options});
      return {
        status:200,
        data:{
          id:'p123',
          transaction_amount:99.9,
          status:'approved',
          currency_id:'BRL',
          external_reference:'order1',
          live_mode:false
        }
      };
    }
  };

  const client=createMpReconciliationSandboxClient({
    axios,
    env:SAFE_ENV
  });

  const result=await client.fetchPayment('p123');
  assert.equal(result.providerRecord.paymentId,'p123');
  assert.equal(result.providerRecord.providerAmount,99.9);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://api.mercadopago.com/v1/payments/p123');
  assert.equal(calls[0].options.headers.Authorization,'Bearer TEST-ONLY');
});

test('sandbox de conciliação rejeita qualquer registro live_mode=true',async()=>{
  const client=createMpReconciliationSandboxClient({
    axios:{
      async get(){
        return {
          status:200,
          data:{
            id:'live1',
            transaction_amount:10,
            status:'approved',
            currency_id:'BRL',
            live_mode:true
          }
        };
      }
    },
    env:SAFE_ENV
  });

  await assert.rejects(
    ()=>client.fetchPayment('live1'),
    error=>error?.code==='MP_RECON_LIVE_MODE_REJECTED'
  );
});

test('cliente recusa consulta quando flag está desligada',async()=>{
  const client=createMpReconciliationSandboxClient({
    axios:{get:async()=>{throw new Error('não deveria chamar')}},
    env:{
      ...SAFE_ENV,
      ARIANA_PAY_RECON_SANDBOX_ENABLED:'false'
    }
  });
  await assert.rejects(()=>client.fetchPayment('p1'),/desabilitada/);
});
