import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDirectSaleSplit,
  buildDirectSalePayoutPlan,
  validateDirectSaleManufacturer,
  getEfiDirectSalePayoutConfig,
  maskPixKey
} from '../services/arianaPay/arianaPayDirectSalePayoutService.js';

const manufacturer={
  manufacturerId:'fab-001',
  status:'approved',
  legalName:'Fabricante Teste LTDA',
  cnpj:'12.345.678/0001-90',
  payout:{pixKey:'financeiro@fabricante.com.br'}
};

test('split direto usa 12% Ariana e 88% fabricante sem erro de centavos',()=>{
  const split=buildDirectSaleSplit({grossAmount:1000});
  assert.equal(split.platformCommission,120);
  assert.equal(split.manufacturerNet,880);
  assert.equal(split.commissionPercent,12);
  assert.equal(split.invariantOk,true);
});

test('fabricante aprovado com Pix e titular valido passa na validacao',()=>{
  const validation=validateDirectSaleManufacturer(manufacturer);
  assert.equal(validation.ok,true);
  assert.equal(validation.payout.provider,'efi');
  assert.equal(validation.payout.rail,'pix_send');
  assert.equal(validation.payout.pixKeyMasked.includes('financeiro@'),false);
});

test('repasse fica agendado por 15 dias apos entrega confirmada',()=>{
  const plan=buildDirectSalePayoutPlan({
    manufacturer,
    order:{orderId:'PED-1',deliveredAt:'2026-10-01T12:00:00.000Z',status:'delivered'},
    grossAmount:1000,
    now:new Date('2026-10-05T12:00:00.000Z')
  });
  assert.equal(plan.state,'scheduled');
  assert.equal(plan.ready,false);
  assert.equal(plan.release.transferDeadlineDays,15);
  assert.equal(plan.release.availableAt,'2026-10-16T12:00:00.000Z');
  assert.equal(plan.payout.amount,880);
});

test('repasse fica pronto somente depois da janela de seguranca',()=>{
  const plan=buildDirectSalePayoutPlan({
    manufacturer,
    order:{orderId:'PED-2',deliveredAt:'2026-09-01T12:00:00.000Z',status:'delivered'},
    grossAmount:500,
    now:new Date('2026-10-05T12:00:00.000Z')
  });
  assert.equal(plan.state,'ready');
  assert.equal(plan.ready,true);
  assert.equal(plan.split.platformCommission,60);
  assert.equal(plan.payout.amount,440);
});

test('chargeback ativo bloqueia repasse mesmo apos 15 dias',()=>{
  const plan=buildDirectSalePayoutPlan({
    manufacturer,
    order:{
      orderId:'PED-3',
      deliveredAt:'2026-09-01T12:00:00.000Z',
      status:'delivered',
      chargeback:{status:'opened',reason:'customer does not recognize the charge'}
    },
    grossAmount:1000,
    now:new Date('2026-10-05T12:00:00.000Z')
  });
  assert.equal(plan.ready,false);
  assert.equal(plan.state,'blocked');
  assert.equal(plan.risk.active,true);
});

test('execucao real nasce travada se a flag nao estiver habilitada',()=>{
  const config=getEfiDirectSalePayoutConfig({
    EFI_PIX_CLIENT_ID:'id',
    EFI_PIX_CLIENT_SECRET:'secret',
    EFI_PIX_CERT_P12_BASE64:'AAAA',
    EFI_PIX_PAYER_KEY:'pix-key',
    ARIANA_PAY_PAYOUT_EXECUTION_ENABLED:'false'
  });
  assert.equal(config.configured,true);
  assert.equal(config.executionEnabled,false);
});

test('mascara chave Pix antes de devolver plano pela API',()=>{
  const masked=maskPixKey('financeiro@fabricante.com.br');
  assert.notEqual(masked,'financeiro@fabricante.com.br');
  assert.equal(masked.endsWith('@fabricante.com.br'),true);
});
