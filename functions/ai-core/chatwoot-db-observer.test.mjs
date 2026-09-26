import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attachmentMedia, buildEnvelope, compareReply,
  findGustavoConversation, humanModeActive, likelyGustavoReply
} from './chatwoot-db-observer.mjs';

test('mapeia anexos do Chatwoot', () => {
  assert.equal(attachmentMedia([{ file_type: 0 }]), 'image');
  assert.equal(attachmentMedia([{ file_type: 1 }]), 'audio');
  assert.equal(attachmentMedia([{ file_type: 3 }]), 'document');
});

test('inbox 7 é loja mista', () => {
  assert.equal(buildEnvelope({ inbox_id: 7, content: 'Oi' }).channel, 'loja');
});

test('encontra estado do Gustavo pelo telefone', () => {
  const state = { conversations: { '5531999999999': { lastIntent: 'produto' } } };
  assert.equal(findGustavoConversation(state, '+55 31 99999-9999').lastIntent, 'produto');
});

test('modo humano impede atribuir resposta ao Gustavo', () => {
  assert.equal(humanModeActive({ manualHumanUntil: Date.now() + 60000 }), true);
});

test('identifica resposta do Gustavo por texto e horario', () => {
  const at = Date.now();
  assert.equal(likelyGustavoReply(
    { content: 'Olá! Como posso ajudar?', created_at_ms: at },
    { lastBotReplyText: 'Olá! Como posso ajudar?', lastBotReplyAt: at, humanUntil: 0, manualHumanUntil: 0 }
  ), true);
});

test('financeiro não pode virar oferta comercial', () => {
  assert.deepEqual(
    compareReply('FINANCEIRO', 'Tenho uma geladeira nova e posso te mandar fotos dos modelos.'),
    { mismatch: true, reason: 'financeiro_recebeu_resposta_comercial' }
  );
});

test('produto novo não pode ficar preso em cobrança', () => {
  assert.deepEqual(
    compareReply('COMERCIAL', 'Sua parcela está vencida. Pode enviar o comprovante do pagamento?'),
    { mismatch: true, reason: 'comercial_recebeu_resposta_financeira' }
  );
});

test('resposta financeira compatível não gera divergência', () => {
  assert.equal(compareReply('FINANCEIRO', 'Recebi seu comprovante de pagamento.').mismatch, false);
});
