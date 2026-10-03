import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChargebackEvidencePacket,
  evidenceCompleteness
} from '../services/arianaPay/arianaPayEvidenceService.js';

test('pacote reúne pedido pagamento entrega e fiscal sem PAN CVV/token',()=>{
  const packet=buildChargebackEvidencePacket({
    id:'o1',
    createdAt:'2026-10-01T10:00:00Z',
    total:1000,
    customerName:'Cliente',
    customerEmail:'c@example.com',
    customerPhone:'31999999999',
    customerCpf:'12345678901',
    shippingAddress:{cep:'39700000',cidade:'Guanhães',uf:'MG',logradouro:'Rua A',numero:'10'},
    items:[{productId:'p1',sku:'SKU1',name:'Produto',qty:1,unitPrice:1000,totalPrice:1000,sellerId:'s1'}],
    payment:{
      provider:'mercadopago',
      method:'card',
      paymentId:'pay1',
      status:'approved',
      token:'NAO_PODE_SAIR',
      raw:{card:{first_six_digits:'123456'},transaction_security:{status:'AUTHENTICATED',liability_shift:'required'}}
    },
    trackingCode:'AB123BR',
    shipping:{deliveredAt:'2026-10-02T12:00:00Z',carrier:'Correios'},
    nfe:{accessKey:'3526...',number:'100'}
  });

  assert.equal(packet.payment.paymentId,'pay1');
  assert.equal(packet.privacy.panStored,false);
  assert.equal(packet.privacy.cvvStored,false);
  assert.equal(packet.privacy.cardTokenIncluded,false);
  assert.equal(JSON.stringify(packet).includes('NAO_PODE_SAIR'),false);
  assert.equal(packet.customer.documentMasked.endsWith('8901'),true);

  const quality=evidenceCompleteness(packet);
  assert.equal(quality.complete,true);
  assert.equal(quality.missing.length,0);
});

test('pacote incompleto aponta exatamente provas ausentes',()=>{
  const packet=buildChargebackEvidencePacket({id:'o2',payment:{method:'card'}});
  const quality=evidenceCompleteness(packet);
  assert.equal(quality.complete,false);
  assert.equal(quality.missing.includes('payment_id'),true);
  assert.equal(quality.missing.includes('delivery_proof'),true);
  assert.equal(quality.missing.includes('fiscal_document'),true);
});
