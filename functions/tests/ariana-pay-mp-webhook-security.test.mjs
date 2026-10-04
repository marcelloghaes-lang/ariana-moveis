import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import {
  parseMercadoPagoSignature,
  buildMercadoPagoWebhookManifest,
  verifyMercadoPagoWebhookTimestamp,
  verifyMercadoPagoWebhookSignature,
  getMercadoPagoWebhookDataId
} from '../services/arianaPay/mercadoPagoWebhookSecurityService.js';

test('monta manifest conforme regra oficial id request-id ts',()=>{
  assert.equal(
    buildMercadoPagoWebhookManifest({dataId:'ABC123',requestId:'req-1',timestamp:'1704908010'}),
    'id:abc123;request-id:req-1;ts:1704908010;'
  );
});

test('valida HMAC SHA256 com comparação segura',()=>{
  const secret='segredo-teste';
  const manifest='id:999;request-id:req-123;ts:1704908010;';
  const v1=crypto.createHmac('sha256',secret).update(manifest).digest('hex');

  const result=verifyMercadoPagoWebhookSignature({
    signatureHeader:`ts=1704908010,v1=${v1}`,
    requestId:'req-123',
    dataId:'999',
    secret
  });

  assert.equal(result.ok,true);
  assert.equal(result.reason,'');
});

test('timestamp recente é aceito e timestamp antigo é rejeitado',()=>{
  const nowMs=1_800_000_000_000;
  const nowSeconds=Math.floor(nowMs/1000);

  assert.equal(
    verifyMercadoPagoWebhookTimestamp({
      timestamp:String(nowSeconds-60),
      nowMs,
      toleranceSeconds:300
    }).ok,
    true
  );

  const old=verifyMercadoPagoWebhookTimestamp({
    timestamp:String(nowSeconds-301),
    nowMs,
    toleranceSeconds:300
  });
  assert.equal(old.ok,false);
  assert.equal(old.reason,'signature_too_old');

  const future=verifyMercadoPagoWebhookTimestamp({
    timestamp:String(nowSeconds+301),
    nowMs,
    toleranceSeconds:300
  });
  assert.equal(future.ok,false);
  assert.equal(future.reason,'signature_from_future');
});

test('assinatura válida mas antiga falha quando freshness é obrigatória',()=>{
  const secret='segredo-teste';
  const nowMs=1_800_000_000_000;
  const ts=Math.floor(nowMs/1000)-600;
  const manifest=`id:999;request-id:req-123;ts:${ts};`;
  const v1=crypto.createHmac('sha256',secret).update(manifest).digest('hex');

  const result=verifyMercadoPagoWebhookSignature({
    signatureHeader:`ts=${ts},v1=${v1}`,
    requestId:'req-123',
    dataId:'999',
    secret,
    requireFreshTimestamp:true,
    nowMs,
    toleranceSeconds:300
  });

  assert.equal(result.ok,false);
  assert.equal(result.reason,'signature_too_old');
});

test('assinatura recente e correta passa com freshness obrigatória',()=>{
  const secret='segredo-teste';
  const nowMs=1_800_000_000_000;
  const ts=Math.floor(nowMs/1000)-15;
  const manifest=`id:999;request-id:req-123;ts:${ts};`;
  const v1=crypto.createHmac('sha256',secret).update(manifest).digest('hex');

  const result=verifyMercadoPagoWebhookSignature({
    signatureHeader:`ts=${ts},v1=${v1}`,
    requestId:'req-123',
    dataId:'999',
    secret,
    requireFreshTimestamp:true,
    nowMs,
    toleranceSeconds:300
  });

  assert.equal(result.ok,true);
});

test('assinatura alterada é rejeitada',()=>{
  const result=verifyMercadoPagoWebhookSignature({
    signatureHeader:'ts=1704908010,v1=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    requestId:'req',
    dataId:'999',
    secret:'segredo'
  });
  assert.equal(result.ok,false);
  assert.equal(result.reason,'signature_mismatch');
});

test('hex inválido é rejeitado sem lançar exceção',()=>{
  const result=verifyMercadoPagoWebhookSignature({
    signatureHeader:'ts=1704908010,v1=zzzz',
    requestId:'req',
    dataId:'999',
    secret:'segredo'
  });
  assert.equal(result.ok,false);
  assert.equal(result.reason,'signature_mismatch');
});

test('sem secret nunca considera webhook autenticado',()=>{
  const result=verifyMercadoPagoWebhookSignature({
    signatureHeader:'ts=1,v1=aa',
    requestId:'x',
    dataId:'y',
    secret:''
  });
  assert.equal(result.ok,false);
  assert.equal(result.reason,'secret_not_configured');
});

test('extrai data id de query ou payload',()=>{
  assert.equal(getMercadoPagoWebhookDataId({query:{'data.id':'Q1'}}),'Q1');
  assert.equal(getMercadoPagoWebhookDataId({query:{},body:{data:{id:'B1'}}}),'B1');
});

test('parser ignora componentes desconhecidos',()=>{
  assert.deepEqual(
    parseMercadoPagoSignature('ts=123,v1=ABCDEF,foo=bar'),
    {ts:'123',v1:'abcdef'}
  );
});
