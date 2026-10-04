import test from 'node:test';
import assert from 'node:assert/strict';
import {buildArianaPayPhase1Readiness} from '../services/arianaPay/arianaPayPhase1ReadinessService.js';

const SAFE_ENV={
  ARIANA_PAY_SHADOW_ENABLED:'true',
  ARIANA_PAY_ENABLED:'false',
  ARIANA_PAY_CHECKOUT_ENABLED:'false',
  ARIANA_PAY_PAYOUT_ENABLED:'false',
  MP_WEBHOOK_SECRET:'secret',
  MP_WEBHOOK_SIGNATURE_ENFORCE:'true',
  MP_3DS_SANDBOX_ENABLED:'true',
  MP_3DS_SANDBOX_ACCESS_TOKEN:'TEST-3DS',
  MP_3DS_SANDBOX_NOTIFICATION_URL:'https://sandbox.example.com/webhook',
  ARIANA_PAY_RECON_SANDBOX_ENABLED:'true',
  MP_RECON_SANDBOX_ACCESS_TOKEN:'TEST-RECON'
};

test('readiness nunca considera Fase 1 pronta para dinheiro real',()=>{
  const result=buildArianaPayPhase1Readiness({
    audit:{
      divergenceCount:0,
      paymentReconciliation:{stats:{divergent:0,insufficientEvidence:0}}
    },
    env:SAFE_ENV
  });

  assert.equal(result.codeReady,true);
  assert.equal(result.readyForRealMoney,false);
  assert.deepEqual(result.safetyViolations,[]);
  assert.deepEqual(result.externalPending,[]);
  assert.deepEqual(result.dataPending,[]);
  assert.equal(result.nextStage,'controlled_homologation_review');
  assert.equal(JSON.stringify(result).includes('secret'),false);
  assert.equal(JSON.stringify(result).includes('TEST-3DS'),false);
});

test('readiness aponta exatamente dependências externas ausentes',()=>{
  const result=buildArianaPayPhase1Readiness({env:{}});
  assert.equal(result.externalPending.includes('mercado_pago_3ds_sandbox_credentials_or_callback'),true);
  assert.equal(result.externalPending.includes('mercado_pago_reconciliation_sandbox_credentials'),true);
  assert.equal(result.externalPending.includes('mercado_pago_webhook_secret'),true);
  assert.equal(result.gates.mp3dsSandboxConfigured,false);
});

test('readiness rejeita token de produção disfarçado como configuração sandbox',()=>{
  const result=buildArianaPayPhase1Readiness({
    env:{
      ...SAFE_ENV,
      MP_3DS_SANDBOX_ACCESS_TOKEN:'APP_USR-PROD',
      MP_RECON_SANDBOX_ACCESS_TOKEN:'APP_USR-PROD'
    }
  });

  assert.equal(result.gates.mp3dsSandboxConfigured,false);
  assert.equal(result.gates.mpReconciliationSandboxConfigured,false);
  assert.equal(result.externalPending.includes('mercado_pago_3ds_sandbox_credentials_or_callback'),true);
  assert.equal(result.externalPending.includes('mercado_pago_reconciliation_sandbox_credentials'),true);
});

test('qualquer tentativa de ativação real derruba codeReady e vira violação de segurança',()=>{
  const result=buildArianaPayPhase1Readiness({
    env:{
      ...SAFE_ENV,
      ARIANA_PAY_ENABLED:'true',
      ARIANA_PAY_CHECKOUT_ENABLED:'true',
      ARIANA_PAY_PAYOUT_ENABLED:'true'
    }
  });

  assert.equal(result.codeReady,false);
  assert.deepEqual(result.safetyViolations,[
    'real_money_feature_enabled',
    'checkout_takeover_enabled',
    'payout_execution_enabled'
  ]);
  assert.equal(result.nextStage,'stop_and_restore_fail_closed');
  assert.equal(result.readyForRealMoney,false);
});

test('divergências e evidências incompletas permanecem bloqueadores de dados',()=>{
  const result=buildArianaPayPhase1Readiness({
    audit:{
      divergenceCount:2,
      paymentReconciliation:{stats:{divergent:3,insufficientEvidence:4}}
    },
    env:SAFE_ENV
  });
  assert.deepEqual(result.dataPending,[
    'ledger_divergences',
    'payment_amount_divergences',
    'missing_stored_provider_evidence'
  ]);
  assert.equal(result.nextStage,'finish_sandbox_and_data_validation');
});
