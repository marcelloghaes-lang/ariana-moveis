import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseInboxMap, extractConversationList, extractMessages,
  isIncomingMessage, toShadowEnvelope
} from './chatwoot-observer.mjs';

test('mapeia inbox para canal sem inventar caixas', () => {
  assert.deepEqual(parseInboxMap('5:sac,6:financeiro,7:televendas'), {
    5: 'sac', 6: 'financeiro', 7: 'televendas'
  });
});

test('aceita formato payload de conversas', () => {
  assert.deepEqual(extractConversationList({ payload: [{ id: 10 }] }), [{ id: 10 }]);
});

test('aceita formato payload de mensagens', () => {
  assert.deepEqual(extractMessages({ payload: [{ id: 20 }] }), [{ id: 20 }]);
});

test('somente mensagem incoming é observada', () => {
  assert.equal(isIncomingMessage({ message_type: 0 }), true);
  assert.equal(isIncomingMessage({ message_type: 'incoming' }), true);
  assert.equal(isIncomingMessage({ message_type: 1 }), false);
  assert.equal(isIncomingMessage({ message_type: 'outgoing' }), false);
});

test('imagem de cliente vira envelope sombra', () => {
  const env = toShadowEnvelope({
    id: 99,
    conversation_id: 40,
    content: 'Tem esse modelo?',
    attachments: [{ file_type: 'image' }]
  }, 'televendas');
  assert.equal(env.channel, 'televendas');
  assert.equal(env.mediaType, 'image');
  assert.equal(env.text, 'Tem esse modelo?');
  assert.equal(env.observer.messageId, 99);
});

test('áudio permanece áudio mesmo sem transcrição', () => {
  const env = toShadowEnvelope({
    id: 100,
    content: '',
    attachments: [{ file_type: 'audio' }]
  }, 'loja');
  assert.equal(env.mediaType, 'audio');
  assert.equal(env.transcription, '');
});
