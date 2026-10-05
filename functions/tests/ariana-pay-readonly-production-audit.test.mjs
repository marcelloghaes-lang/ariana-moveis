import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getReadOnlyProductionAuditConfig,
  assertReadOnlyProductionAuditConfigured,
  inspectReadOnlyPrivileges,
  normalizeAuditLimit,
  isFinancialProjectionEligible,
  buildSafeSellerAuditSettlement,
  orderProjectionStage
} from '../services/arianaPay/arianaPayReadOnlyProductionAuditService.js';
import { assessSellerSettlementIntegrity } from '../services/arianaPay/arianaPayProductionEligibilityService.js';

test('auditoria real exige URI Mongo dedicada',()=>{
  const cfg=getReadOnlyProductionAuditConfig({
    ARIANA_PAY_SHADOW_PRODUCTION_AUDIT_ENABLED:'true'
  });
  assert.equal(cfg.uri,'');
  assert.throws(
    ()=>assertReadOnlyProductionAuditConfigured(cfg),
    error=>error?.code==='ARIANA_PAY_READONLY_MONGO_URI_MISSING'
  );
});

test('auditoria real rejeita reutilização da URI operacional',()=>{
  const cfg=getReadOnlyProductionAuditConfig({
    ARIANA_PAY_SHADOW_PRODUCTION_AUDIT_ENABLED:'true',
    ARIANA_PAY_SHADOW_READONLY_MONGODB_URI:'mongodb://same/db',
    MONGODB_URI:'mongodb://same/db'
  });
  assert.equal(cfg.reusesProductionUri,true);
  assert.throws(
    ()=>assertReadOnlyProductionAuditConfigured(cfg),
    error=>error?.code==='ARIANA_PAY_READONLY_MONGO_REUSE_BLOCKED'
  );
});

test('papel read é aceito como somente leitura',()=>{
  const inspection=inspectReadOnlyPrivileges({
    authInfo:{
      authenticatedUserRoles:[{role:'read',db:'ariana_moveis_db'}]
    }
  });
  assert.equal(inspection.verifiedReadOnly,true);
  assert.deepEqual(inspection.detectedWriteActions,[]);
});

test('privilégio insert bloqueia auditoria real',()=>{
  const inspection=inspectReadOnlyPrivileges({
    authInfo:{
      authenticatedUserRoles:[{role:'customAudit',db:'ariana_moveis_db'}],
      authenticatedUserPrivileges:[{
        resource:{db:'ariana_moveis_db',collection:'orders'},
        actions:['find','insert']
      }]
    }
  });
  assert.equal(inspection.verifiedReadOnly,false);
  assert.ok(inspection.detectedWriteActions.includes('insert'));
});

test('papel readWrite é rejeitado mesmo sem lista de privilégios',()=>{
  const inspection=inspectReadOnlyPrivileges({
    authInfo:{
      authenticatedUserRoles:[{role:'readWrite',db:'ariana_moveis_db'}]
    }
  });
  assert.equal(inspection.verifiedReadOnly,false);
  assert.ok(inspection.suspiciousRoles.includes('readWrite'));
});

test('limite da auditoria permite varrer a coleção inteira sem ultrapassar 500 pedidos',()=>{
  assert.equal(normalizeAuditLimit('100'),100);
  assert.equal(normalizeAuditLimit(218),218);
  assert.equal(normalizeAuditLimit(999),500);
  assert.equal(normalizeAuditLimit(1),5);
  assert.equal(normalizeAuditLimit('invalido'),25);
});

test('projeção Mongo preserva todos os sinais não-PII usados pelo gate Ariana Pay',()=>{
  const projection=orderProjectionStage().$project;
  assert.equal(projection.channel,1);
  assert.equal(projection.arianaPay,1);
  assert.equal(projection.paymentProvider,1);
  assert.equal(projection.paymentMethod,1);
  assert.equal(projection.payment.origin,'$payment.origin');
  assert.equal(projection.payment.channel,'$payment.channel');
  assert.equal(projection.payment.arianaPay,'$payment.arianaPay');
  assert.equal(projection.payment.gateway,'$payment.gateway');
  assert.equal(projection.payment.processor,'$payment.processor');
  assert.equal(projection.payment.metadata.origin,'$payment.metadata.origin');
  assert.equal(projection.payment.metadata.channel,'$payment.metadata.channel');
  assert.equal(projection.payment.metadata.arianaPay,'$payment.metadata.arianaPay');
});

test('projeção Mongo não adiciona PII bruto à auditoria',()=>{
  const projection=JSON.stringify(orderProjectionStage().$project);
  for(const forbidden of [
    'customerName','customerCpf:', 'customerEmail:', 'customerPhone:',
    'shippingAddress.cep:', 'shippingAddress.logradouro:', 'shippingAddress.numero:'
  ]){
    assert.equal(projection.includes(forbidden),false,`PII bruto não pode ser projetado: ${forbidden}`);
  }
  assert.ok(projection.includes('contactPresence'));
});

test('crediário interno de seller externo não entra nos totais projetados de payout',()=>{
  const eligible=isFinancialProjectionEligible({
    externalSeller:true,
    eligibility:{marketplaceCandidate:false,financiallyEligible:false},
    integrity:{blocked:false},
    reconciliation:{status:'matched'},
    risk:{blocksRelease:false},
    cardSecurity:{blocksPayout:false}
  });
  assert.equal(eligible,false);
});

test('seller externo só entra na projeção após elegibilidade e conciliação matched',()=>{
  const base={
    externalSeller:true,
    eligibility:{marketplaceCandidate:true,financiallyEligible:true},
    integrity:{blocked:false},
    risk:{blocksRelease:false},
    cardSecurity:{blocksPayout:false}
  };
  assert.equal(isFinancialProjectionEligible({...base,reconciliation:{status:'matched'}}),true);
  assert.equal(isFinancialProjectionEligible({...base,reconciliation:{status:'insufficient_evidence'}}),false);
  assert.equal(isFinancialProjectionEligible({...base,reconciliation:{status:'divergent'}}),false);
});

test('risco financeiro ou bloqueio de segurança exclui payout projetado',()=>{
  const base={
    externalSeller:true,
    eligibility:{marketplaceCandidate:true,financiallyEligible:true},
    integrity:{blocked:false},
    reconciliation:{status:'matched'}
  };
  assert.equal(isFinancialProjectionEligible({...base,risk:{blocksRelease:true},cardSecurity:{blocksPayout:false}}),false);
  assert.equal(isFinancialProjectionEligible({...base,risk:{blocksRelease:false},cardSecurity:{blocksPayout:true}}),false);
});

test('integridade bloqueia seller quando itens cobrados superam o total do pedido',()=>{
  const integrity=assessSellerSettlementIntegrity({
    order:{
      total:58.32,
      items:[{
        sellerId:'seller_externo',
        quantity:1,
        totalPrice:2198,
        sellerBaseTotal:2198
      }]
    },
    sellerId:'seller_externo',
    settlement:{gross:2198}
  });
  assert.equal(integrity.orderTotal,58.32);
  assert.equal(integrity.blocked,true);
  assert.ok(integrity.anomalies.includes('seller_charged_gross_exceeds_order_total'));
});

test('anomalia histórica R$ 58,32 x R$ 2.198 jamais aparece como valor a receber do seller',()=>{
  const order={
    total:58.32,
    items:[{
      sellerId:'seller_externo',
      quantity:1,
      totalPrice:58.32,
      sellerBaseTotal:2198
    }]
  };
  const rawSettlement={
    chargedGross:58.32,
    gross:58.32,
    commission:7,
    net:51.32,
    commissionPercent:12,
    settlementMode:'manual_marketplace',
    orderTotal:58.32
  };
  const integrity=assessSellerSettlementIntegrity({
    order,
    sellerId:'seller_externo',
    settlement:rawSettlement
  });
  assert.equal(integrity.blocked,true);
  assert.ok(integrity.anomalies.includes('snapshot_base_exceeds_charged_item'));
  assert.equal(integrity.snapshotGross,2198);

  const safe=buildSafeSellerAuditSettlement({
    settlement:rawSettlement,
    integrity,
    financialProjectionEligible:false,
    orderTotal:58.32
  });
  assert.equal(safe.gross,0);
  assert.equal(safe.net,0);
  assert.equal(safe.payableGross,0);
  assert.equal(safe.payableNet,0);
  assert.equal(safe.payable,false);
  assert.equal(safe.diagnosticSnapshotGross,2198);
  assert.equal(safe.integrityBlocked,true);
});

test('settlement válido mantém valor projetado somente quando financeiramente elegível',()=>{
  const safe=buildSafeSellerAuditSettlement({
    settlement:{chargedGross:100,gross:88,commission:10.56,net:77.44,commissionPercent:12},
    integrity:{blocked:false,anomalies:[],snapshotGross:88},
    financialProjectionEligible:true,
    orderTotal:100
  });
  assert.equal(safe.gross,88);
  assert.equal(safe.net,77.44);
  assert.equal(safe.payableGross,88);
  assert.equal(safe.payableNet,77.44);
  assert.equal(safe.integrityBlocked,false);
});

test('integridade mantém seller válido quando base cobrada cabe no total do pedido',()=>{
  const integrity=assessSellerSettlementIntegrity({
    order:{
      total:2379,
      items:[{
        sellerId:'seller_externo',
        quantity:1,
        totalPrice:2299,
        sellerBaseTotal:2299
      }]
    },
    sellerId:'seller_externo',
    settlement:{gross:2299}
  });
  assert.equal(integrity.orderTotal,2379);
  assert.equal(integrity.blocked,false);
  assert.deepEqual(integrity.anomalies,[]);
});
