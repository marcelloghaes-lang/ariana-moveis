import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findDeliveryConfirmation,
  normalizeTransferDeadlineDays,
  buildReleaseSchedule
} from '../services/arianaPay/arianaPayReleaseScheduleService.js';

test('usa timestamp explícito de entrega com maior confiança',()=>{
  const result=findDeliveryConfirmation({
    shipping:{deliveredAt:'2026-10-01T12:00:00Z'},
    status:'entregue',
    updatedAt:'2026-10-03T12:00:00Z'
  });
  assert.equal(result.confirmed,true);
  assert.equal(result.source,'explicit_delivery_timestamp');
  assert.equal(result.date.toISOString(),'2026-10-01T12:00:00.000Z');
});

test('encontra entrega no histórico de rastreio',()=>{
  const result=findDeliveryConfirmation({
    status:'enviado',
    trackingHistory:[
      {status:'Em trânsito',date:'2026-09-30T10:00:00Z'},
      {status:'Entregue ao destinatário',date:'2026-10-02T15:30:00Z'}
    ]
  });
  assert.equal(result.confirmed,true);
  assert.equal(result.source,'tracking_history');
  assert.equal(result.date.toISOString(),'2026-10-02T15:30:00.000Z');
});

test('status entregue sem timestamp usa updatedAt apenas como fallback de baixa confiança',()=>{
  const result=findDeliveryConfirmation({
    statusLabel:'Entregue',
    updatedAt:'2026-10-03T18:00:00Z'
  });
  assert.equal(result.confirmed,true);
  assert.equal(result.source,'delivered_status_updated_at_fallback');
  assert.equal(result.confidence,'low');
});

test('prazo de repasse vem da configuração administrativa do seller',()=>{
  assert.equal(normalizeTransferDeadlineDays({metadata:{transferDeadlineDays:7}}),15);
  assert.equal(normalizeTransferDeadlineDays({metadata:{transferDeadlineDays:'15'}}),15);
  assert.equal(normalizeTransferDeadlineDays({metadata:{transferDeadlineDays:30}}),15);
  assert.equal(normalizeTransferDeadlineDays({metadata:{}}),15);
  assert.equal(normalizeTransferDeadlineDays({metadata:{transferDeadlineDays:91}}),15);
});

test('sem prazo configurado aplica o padrão seguro de 15 dias',()=>{
  const schedule=buildReleaseSchedule({
    order:{shipping:{deliveredAt:'2026-10-01T10:00:00Z'}},
    seller:{sellerId:'s1',metadata:{}}
  });
  assert.equal(schedule.state,'scheduled');
  assert.equal(schedule.transferDeadlineDays,15);
  assert.equal(schedule.availableAt,'2026-10-16T10:00:00.000Z');
});

test('sem entrega confirmada mantém recebível bloqueado',()=>{
  const schedule=buildReleaseSchedule({
    order:{status:'enviado'},
    seller:{sellerId:'s1',metadata:{transferDeadlineDays:5}}
  });
  assert.equal(schedule.state,'blocked');
  assert.equal(schedule.reason,'delivery_not_confirmed');
});

test('entrega mais prazo produz data prevista de liberação',()=>{
  const schedule=buildReleaseSchedule({
    order:{shipping:{deliveredAt:'2026-10-01T12:00:00Z'}},
    seller:{sellerId:'s1',metadata:{transferDeadlineDays:7}}
  });
  assert.equal(schedule.state,'scheduled');
  assert.equal(schedule.transferDeadlineDays,15);
  assert.equal(schedule.availableAt,'2026-10-16T12:00:00.000Z');
});


test('fallback de baixa confiança não libera recebível automaticamente',()=>{
  const schedule=buildReleaseSchedule({
    order:{status:'entregue',updatedAt:'2026-10-01T10:00:00Z'},
    seller:{sellerId:'s1',metadata:{transferDeadlineDays:0}}
  });
  assert.equal(schedule.state,'blocked');
  assert.equal(schedule.reason,'delivery_timestamp_low_confidence');
  assert.equal(schedule.availableAt,null);
});


test('configuração legada diferente não altera o prazo global de 15 dias',()=>{
  const schedule=buildReleaseSchedule({
    order:{shipping:{deliveredAt:'2026-10-01T12:00:00Z'}},
    seller:{sellerId:'s1',metadata:{transferDeadlineDays:30}}
  });
  assert.equal(schedule.state,'scheduled');
  assert.equal(schedule.transferDeadlineDays,15);
  assert.equal(schedule.availableAt,'2026-10-16T12:00:00.000Z');
});
