import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAgreementLateCharges } from '../services/erp/erpDebtAgreementService.js';

test('acordo aplica multa de 2% e juros de 1% ao mes proporcionalmente',()=>{
  const result=calculateAgreementLateCharges({dueAt:'2026-09-07'},100,'2026-10-07');
  assert.equal(result.days,30);
  assert.equal(result.fine,2);
  assert.equal(result.interest,1);
  assert.equal(result.total,103);
});

test('acordo nao aplica encargos antes ou no vencimento',()=>{
  assert.deepEqual(calculateAgreementLateCharges({dueAt:'2026-10-07'},100,'2026-10-07'),{days:0,fine:0,interest:0,total:100});
  assert.deepEqual(calculateAgreementLateCharges({dueAt:'2026-10-08'},100,'2026-10-07'),{days:0,fine:0,interest:0,total:100});
});

test('acordo calcula encargos apenas sobre o saldo principal informado',()=>{
  const result=calculateAgreementLateCharges({dueAt:'2026-08-08'},342,'2026-10-07');
  assert.equal(result.days,60);
  assert.equal(result.fine,6.84);
  assert.equal(result.interest,6.84);
  assert.equal(result.total,355.68);
});
