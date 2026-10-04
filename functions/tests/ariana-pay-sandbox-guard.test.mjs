import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateArianaPaySandboxGuard,
  assertArianaPaySandboxSafe
} from '../services/arianaPay/arianaPaySandboxGuardService.js';

test('guard aceita somente flags de dinheiro real desligadas',()=>{
  const result=evaluateArianaPaySandboxGuard({
    ARIANA_PAY_SHADOW_ENABLED:'true',
    ARIANA_PAY_ENABLED:'false',
    ARIANA_PAY_CHECKOUT_ENABLED:'false',
    ARIANA_PAY_PAYOUT_ENABLED:'false',
    ARIANA_PAY_SANDBOX_MAX_AMOUNT:'100'
  });

  assert.equal(result.ok,true);
  assert.equal(result.shadowEnabled,true);
  assert.equal(result.readyForRealMoney,false);
  assert.deepEqual(result.violations,[]);
});

test('guard bloqueia qualquer ativação real',()=>{
  const result=evaluateArianaPaySandboxGuard({
    ARIANA_PAY_ENABLED:'true',
    ARIANA_PAY_CHECKOUT_ENABLED:'true',
    ARIANA_PAY_PAYOUT_ENABLED:'true',
    ARIANA_PAY_SANDBOX_MAX_AMOUNT:'100'
  });

  assert.equal(result.ok,false);
  assert.deepEqual(result.violations,[
    'ARIANA_PAY_ENABLED_must_be_false',
    'ARIANA_PAY_CHECKOUT_ENABLED_must_be_false',
    'ARIANA_PAY_PAYOUT_ENABLED_must_be_false'
  ]);
  assert.throws(
    ()=>assertArianaPaySandboxSafe({
      ARIANA_PAY_ENABLED:'true',
      ARIANA_PAY_SANDBOX_MAX_AMOUNT:'100'
    }),
    error=>error?.code==='ARIANA_PAY_SANDBOX_UNSAFE_CONFIGURATION'
  );
});

test('guard rejeita limite de sandbox fora da faixa segura',()=>{
  const tooHigh=evaluateArianaPaySandboxGuard({
    ARIANA_PAY_SANDBOX_MAX_AMOUNT:'5000'
  });
  assert.equal(tooHigh.ok,false);
  assert.equal(tooHigh.violations.includes('ARIANA_PAY_SANDBOX_MAX_AMOUNT_invalid'),true);

  const invalid=evaluateArianaPaySandboxGuard({
    ARIANA_PAY_SANDBOX_MAX_AMOUNT:'abc'
  });
  assert.equal(invalid.ok,false);
});

test('guard informa configuração administrativa sem expor token',()=>{
  const result=evaluateArianaPaySandboxGuard({
    ARIANA_PAY_SANDBOX_ADMIN_TOKEN:'DUMMY-SECRET',
    ARIANA_PAY_SANDBOX_MAX_AMOUNT:'100'
  });
  assert.equal(result.adminTokenConfigured,true);
  assert.equal(JSON.stringify(result).includes('DUMMY-SECRET'),false);
});
