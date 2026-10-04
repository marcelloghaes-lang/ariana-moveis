import test from 'node:test';
import assert from 'node:assert/strict';
import {buildArianaPayPhase1Readiness} from '../services/arianaPay/arianaPayPhase1ReadinessService.js';

test('readiness nunca considera Fase 1 pronta para dinheiro real',()=>{
  const result=buildArianaPayPhase1Readiness({
    audit:{
      divergenceCount:0,
      paymentReconciliation:{stats:{divergent:0,insufficientEvidence:0}}
    },
    env:{
      ARIANA_PAY_SHADOW_ENABLED:'true',
      MP_WEBHOOK_SECRET:'secret',
      MP_WEBHOOK_SIGNATURE_ENFORCE:'true',
      MP_3DS_SANDBOX_ENABLED:'true',
      MP_3DS_SANDBOX_ACCESS_TOKEN:'test',
      MP_3DS_SANDBOX_NOTIFICATION_URL:'https://example.com/webhook',
      ARIANA_PAY_RECON_SANDBOX_ENABLED:'true',
      MP_RECON_SANDBOX_ACCESS_TOKEN:'test'
    }
  });

  assert.equal(result.codeReady,true);
  assert.equal(result.readyForRealMoney,false);
  assert.deepEqual(result.externalPending,[]);
  assert.deepEqual(result.dataPending,[]);
  assert.equal(JSON.stringify(result).includes('secret'),false);
});

test('readiness aponta exatamente dependências externas ausentes',()=>{
  const result=buildArianaPayPhase1Readiness({env:{}});
  assert.equal(result.externalPending.includes('mercado_pago_3ds_sandbox_credentials_or_callback'),true);
  assert.equal(result.externalPending.includes('mercado_pago_reconciliation_sandbox_credentials'),true);
  assert.equal(result.externalPending.includes('mercado_pago_webhook_secret'),true);
  assert.equal(result.gates.mp3dsSandboxConfigured,false);
});

test('divergências e evidências incompletas permanecem bloqueadores de dados',()=>{
  const result=buildArianaPayPhase1Readiness({
    audit:{
      divergenceCount:2,
      paymentReconciliation:{stats:{divergent:3,insufficientEvidence:4}}
    },
    env:{}
  });
  assert.deepEqual(result.dataPending,[
    'ledger_divergences',
    'payment_amount_divergences',
    'missing_stored_provider_evidence'
  ]);
});
