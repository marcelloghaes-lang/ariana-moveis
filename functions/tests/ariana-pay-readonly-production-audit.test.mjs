import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getReadOnlyProductionAuditConfig,
  assertReadOnlyProductionAuditConfigured,
  inspectReadOnlyPrivileges
} from '../services/arianaPay/arianaPayReadOnlyProductionAuditService.js';

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
