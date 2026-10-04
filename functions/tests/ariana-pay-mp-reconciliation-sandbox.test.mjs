import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getMpReconciliationSandboxConfig,
  assertMpReconciliationSandboxReady,
  normalizeMpPaymentForReconciliation,
  createMpReconciliationSandboxClient
} from '../services/arianaPay/mercadoPagoReconciliationSandboxService.js';

test('sandbox de conciliação nunca usa MP_ACCESS_TOKEN de produção',()=>{
  const cfg=getMpReconciliationSandboxConfig({
    MP_ACCESS_TOKEN:'PROD_TOKEN',
    ARIANA_PAY_RECON_SANDBOX_ENABLED:'true'
  });
  assert.equal(cfg.accessToken,'');
  assert.throws(()=>assertMpReconciliationSandboxReady(cfg),/MP_RECON_SANDBOX_ACCESS_TOKEN/);
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
    env:{
      ARIANA_PAY_RECON_SANDBOX_ENABLED:'true',
      MP_RECON_SANDBOX_ACCESS_TOKEN:'TEST_ONLY'
    }
  });

  const result=await client.fetchPayment('p123');
  assert.equal(result.providerRecord.paymentId,'p123');
  assert.equal(result.providerRecord.providerAmount,99.9);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://api.mercadopago.com/v1/payments/p123');
  assert.equal(calls[0].options.headers.Authorization,'Bearer TEST_ONLY');
});

test('cliente recusa consulta quando flag está desligada',async()=>{
  const client=createMpReconciliationSandboxClient({
    axios:{get:async()=>{throw new Error('não deveria chamar')}},
    env:{
      ARIANA_PAY_RECON_SANDBOX_ENABLED:'false',
      MP_RECON_SANDBOX_ACCESS_TOKEN:'TEST_ONLY'
    }
  });
  await assert.rejects(()=>client.fetchPayment('p1'),/desabilitada/);
});
