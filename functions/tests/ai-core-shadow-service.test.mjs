import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'crypto';
import {
  buildSiteShadowPayload,
  buildSignedSiteShadowRequest,
  mirrorSiteShadow
} from '../services/aiCoreShadowService.js';

test('payload do Site envia somente contexto necessario', () => {
  const payload = buildSiteShadowPayload({
    message: '  Tem   geladeira frost free?  ',
    page: { path: '/produto.html?id=123', productId: '123' },
    sessionId: 'sessao-1'
  });
  assert.equal(payload.message, 'Tem geladeira frost free?');
  assert.equal(payload.page.productId, '123');
  assert.equal(payload.sessionId, 'sessao-1');
});

test('assinatura HMAC corresponde exatamente ao corpo enviado', () => {
  const secret = 'segredo-teste';
  const timestamp = 1800000000000;
  const signed = buildSignedSiteShadowRequest({
    secret,
    timestamp,
    payload: { message: 'Oi', page: { path: '/contato.html' } }
  });
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${signed.rawBody}`)
    .digest('hex');
  assert.equal(signed.headers['x-ariana-signature'], `v1=${expected}`);
  assert.equal(signed.headers['x-ariana-timestamp'], String(timestamp));
});

test('espelhamento fica inativo sem URL ou segredo e nao quebra o fluxo', async () => {
  const result = await mirrorSiteShadow(
    { message: 'Teste' },
    { url: '', secret: '' }
  );
  assert.deepEqual(result, { sent: false, reason: 'disabled' });
});
