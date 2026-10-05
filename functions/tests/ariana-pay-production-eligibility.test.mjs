import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getHistoricalSellerBaseSnapshot,
  isPlatformSellerId,
  assessArianaPayPaymentApplicability,
  assessArianaPayOrderEligibility,
  buildHistoricalSnapshotProductMap,
  assessSellerSettlementIntegrity,
  applyArianaPayProductionSafetyGate
} from '../services/arianaPay/arianaPayProductionEligibilityService.js';

test('identifica seller interno Ariana sem confundir seller externo',()=>{
  assert.equal(isPlatformSellerId('ArianaMoveis'),true);
  assert.equal(isPlatformSellerId('ARIANA MOVEIS'),true);
  assert.equal(isPlatformSellerId('seller_addf534c29eea3c8'),false);
});

test('crediário interno nunca vira candidato Ariana Pay',()=>{
  const result=assessArianaPayOrderEligibility({
    sellerIds:['seller_123'],
    payment:{method:'crediario_ariana',status:'approved',provider:'ariana_pay',arianaPay:true}
  });
  assert.equal(result.marketplaceCandidate,false);
  assert.equal(result.financiallyEligible,false);
  assert.ok(result.reasons.includes('internal_credit_method'));
});

test('pedido da própria Ariana não vira payout de marketplace',()=>{
  const result=assessArianaPayOrderEligibility({
    sellerIds:['ArianaMoveis'],
    payment:{method:'pix',status:'approved',provider:'mercadopago',arianaPay:true}
  });
  assert.equal(result.marketplaceCandidate,false);
  assert.equal(result.externalSellerIds.length,0);
  assert.ok(result.reasons.includes('no_external_marketplace_seller'));
});

test('seller externo com pagamento Ariana Pay aprovado vira candidato financeiro',()=>{
  const result=assessArianaPayOrderEligibility({
    sellerIds:['seller_123'],
    origin:'ariana_pay',
    payment:{method:'pix',status:'approved',provider:'mercadopago'}
  });
  assert.equal(result.arianaPayApplicable,true);
  assert.equal(result.marketplaceCandidate,true);
  assert.equal(result.financiallyEligible,true);
});

test('Mercado Pago genérico sem origem Ariana Pay não entra no Ariana Pay',()=>{
  const applicability=assessArianaPayPaymentApplicability({
    sellerIds:['seller_123'],
    payment:{method:'pix',status:'approved',provider:'mercadopago'}
  });
  const result=assessArianaPayOrderEligibility({
    sellerIds:['seller_123'],
    payment:{method:'pix',status:'approved',provider:'mercadopago'}
  });
  assert.equal(applicability.providerSupported,true);
  assert.equal(applicability.originMarked,false);
  assert.equal(result.marketplaceCandidate,false);
  assert.ok(result.reasons.includes('not_ariana_pay_origin'));
});

test('Efí nunca entra no Ariana Pay mesmo se pedido estiver marcado incorretamente',()=>{
  const result=assessArianaPayOrderEligibility({
    sellerIds:['seller_123'],
    origin:'ariana_pay',
    payment:{method:'pix',status:'approved',provider:'efi'}
  });
  assert.equal(result.arianaPayOriginMarked,true);
  assert.equal(result.paymentProviderSupported,false);
  assert.equal(result.arianaPayApplicable,false);
  assert.equal(result.marketplaceCandidate,false);
  assert.ok(result.reasons.includes('unsupported_ariana_pay_provider'));
});

test('provider Ariana Pay explícito é suficiente como origem controlada',()=>{
  const result=assessArianaPayOrderEligibility({
    sellerIds:['seller_123'],
    payment:{method:'pix',status:'approved',provider:'ariana_pay'}
  });
  assert.equal(result.arianaPayApplicable,true);
  assert.equal(result.marketplaceCandidate,true);
  assert.equal(result.financiallyEligible,true);
});

test('snapshot do pedido tem prioridade e não usa preço atual do produto',()=>{
  const order={items:[{
    productId:'p1',sellerId:'seller_123',qty:2,
    unitPrice:150,totalPrice:300,
    sellerBaseUnitPrice:100,sellerBaseTotal:200
  }]};
  const current=new Map([['p1',{price:999,settlementBase:999,retailCashPrice:999,managed:false}]]);
  const map=buildHistoricalSnapshotProductMap(order,current);
  assert.equal(map.get('p1').price,100);
  assert.equal(map.get('p1').settlementBase,100);
  assert.equal(map.get('p1').auditSnapshotSource,'seller_base_total');
});

test('markup salvo no pedido permite reconstruir base histórica sem produto atual',()=>{
  const snapshot=getHistoricalSellerBaseSnapshot({
    qty:1,unitPrice:120,totalPrice:120,cardMarkupTotal:20
  });
  assert.equal(snapshot.present,true);
  assert.equal(snapshot.total,100);
  assert.equal(snapshot.source,'card_markup_total_derived');
});

test('seller externo sem snapshot de venda fica bloqueado',()=>{
  const order={items:[{sellerId:'seller_123',qty:1,unitPrice:100,totalPrice:100}]};
  const integrity=assessSellerSettlementIntegrity({
    order,
    sellerId:'seller_123',
    settlement:{gross:100}
  });
  assert.equal(integrity.blocked,true);
  assert.ok(integrity.anomalies.includes('missing_sale_time_settlement_snapshot'));
});

test('base do seller acima do valor cobrado é anomalia bloqueante',()=>{
  const order={items:[{
    sellerId:'seller_123',qty:1,unitPrice:100,totalPrice:100,
    sellerBaseTotal:120
  }]};
  const integrity=assessSellerSettlementIntegrity({
    order,
    sellerId:'seller_123',
    settlement:{gross:120}
  });
  assert.equal(integrity.blocked,true);
  assert.ok(integrity.anomalies.includes('snapshot_base_exceeds_charged_item'));
  assert.ok(integrity.anomalies.includes('computed_seller_gross_exceeds_charged_gross'));
});

test('total dos itens do seller acima do total do pedido é bloqueado fail-closed',()=>{
  const order={
    total:58.32,
    items:[{
      sellerId:'seller_123',qty:1,unitPrice:2198,totalPrice:2198,
      sellerBaseTotal:2198
    }]
  };
  const integrity=assessSellerSettlementIntegrity({
    order,
    sellerId:'seller_123',
    settlement:{gross:2198}
  });
  assert.equal(integrity.orderTotal,58.32);
  assert.equal(integrity.blocked,true);
  assert.ok(integrity.anomalies.includes('seller_charged_gross_exceeds_order_total'));
});

test('gate nunca libera sem conciliação financeira matched',()=>{
  const release={state:'scheduled',reason:'',availableAt:'2026-11-01T00:00:00.000Z',transferDeadlineDays:15};
  const result=applyArianaPayProductionSafetyGate({
    release,
    eligibility:{marketplaceCandidate:true,financiallyEligible:true},
    integrity:{externalSeller:true,blocked:false},
    reconciliation:{status:'insufficient_evidence',reason:'missing_provider_reference'}
  });
  assert.equal(result.state,'blocked');
  assert.equal(result.availableAt,null);
  assert.equal(result.reason,'payment_reconciliation_missing_provider_reference');
});

test('seller da própria Ariana continua bloqueado mesmo em pedido misto com seller externo',()=>{
  const release={state:'scheduled',reason:'',availableAt:'2026-11-01T00:00:00.000Z',transferDeadlineDays:15};
  const result=applyArianaPayProductionSafetyGate({
    release,
    eligibility:{marketplaceCandidate:true,financiallyEligible:true},
    integrity:{externalSeller:false,blocked:false},
    reconciliation:{status:'matched'}
  });
  assert.equal(result.state,'blocked');
  assert.equal(result.reason,'platform_seller_not_payable');
  assert.equal(result.availableAt,null);
});

test('gate preserva agenda de 15 dias quando tudo está validado',()=>{
  const release={state:'scheduled',reason:'',availableAt:'2026-11-01T00:00:00.000Z',transferDeadlineDays:15};
  const result=applyArianaPayProductionSafetyGate({
    release,
    eligibility:{marketplaceCandidate:true,financiallyEligible:true},
    integrity:{externalSeller:true,blocked:false},
    reconciliation:{status:'matched'}
  });
  assert.deepEqual(result,release);
  assert.equal(result.transferDeadlineDays,15);
});
