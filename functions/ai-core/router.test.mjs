import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCurrentMessage, extractEnvelope } from './router.mjs';

test('comprovante no WhatsApp da loja vai para financeiro', () => {
  const result = classifyCurrentMessage({
    channel: 'loja',
    text: 'Bom dia, segue o comprovante. Paguei a prestação da geladeira.'
  });
  assert.equal(result.route, 'FINANCEIRO');
  assert.equal(result.currentMessageWins, true);
  assert.equal(result.outboundAllowed, false);
});

test('produto novo vence contexto financeiro anterior', () => {
  const result = classifyCurrentMessage({
    channel: 'loja',
    previousIntent: 'financeiro',
    text: 'Tem essa geladeira frost free? Qual o preço?'
  });
  assert.equal(result.route, 'COMERCIAL');
  assert.equal(result.reason, 'current_product_signal');
});

test('pagamento novo vence contexto comercial anterior', () => {
  const result = classifyCurrentMessage({
    channel: 'loja',
    previousIntent: 'produto',
    text: 'Acabei de pagar a parcela, vou mandar o comprovante.'
  });
  assert.equal(result.route, 'FINANCEIRO');
});

test('áudio transcrito sobre pagamento vai para financeiro', () => {
  const result = classifyCurrentMessage({
    channel: 'loja',
    mediaType: 'audio',
    transcription: 'Esse áudio é sobre a parcela que eu paguei hoje.'
  });
  assert.equal(result.route, 'FINANCEIRO');
});

test('foto com contexto de produto continua comercial', () => {
  const result = classifyCurrentMessage({
    channel: 'loja',
    mediaType: 'image',
    caption: 'Tem esse modelo?'
  });
  assert.equal(result.route, 'COMERCIAL');
});

test('imagem sem texto não é presumida como produto', () => {
  const result = classifyCurrentMessage({
    channel: 'loja',
    mediaType: 'image'
  });
  assert.equal(result.route, 'MULTIMIDIA_PENDENTE');
});

test('áudio sem transcrição fica pendente', () => {
  const result = classifyCurrentMessage({
    channel: 'loja',
    mediaType: 'audio'
  });
  assert.equal(result.route, 'MULTIMIDIA_PENDENTE');
});

test('financeiro continua especializado quando mensagem é neutra', () => {
  const result = classifyCurrentMessage({
    channel: 'financeiro',
    text: 'Bom dia, queria falar com vocês.'
  });
  assert.equal(result.route, 'FINANCEIRO');
});

test('site usa comercial como padrão', () => {
  const result = classifyCurrentMessage({
    channel: 'site',
    text: 'Olá'
  });
  assert.equal(result.route, 'COMERCIAL');
});

test('SAC reconhece problema de garantia', () => {
  const result = classifyCurrentMessage({
    channel: 'loja',
    text: 'Meu produto apresentou defeito e preciso da garantia.'
  });
  assert.equal(result.route, 'SAC');
});

test('ouvidoria explícita tem rota própria', () => {
  const result = classifyCurrentMessage({
    channel: 'loja',
    text: 'Quero registrar uma reclamação formal na ouvidoria.'
  });
  assert.equal(result.route, 'OUVIDORIA');
});

test('extrai mensagem de imagem do formato Evolution', () => {
  const envelope = extractEnvelope({
    channel: 'loja',
    data: {
      message: {
        imageMessage: { caption: 'Qual o valor dessa TV?' }
      }
    }
  });
  assert.equal(envelope.mediaType, 'image');
  assert.equal(envelope.text, 'Qual o valor dessa TV?');
  assert.equal(classifyCurrentMessage(envelope).route, 'COMERCIAL');
});

test('núcleo sombra nunca autoriza saída', () => {
  for (const channel of ['loja', 'site', 'televendas', 'sac', 'financeiro', 'crediario', 'ouvidoria']) {
    const result = classifyCurrentMessage({ channel, text: 'Olá' });
    assert.equal(result.outboundAllowed, false);
    assert.equal(result.mode, 'shadow');
  }
});

test('parcela atrasada é crediário', () => {
  const result = classifyCurrentMessage({
    channel: 'loja',
    text: 'Quero negociar uma parcela atrasada do carnê.'
  });
  assert.equal(result.route, 'CREDIARIO');
});

test('pagamento realizado tem prioridade sobre contexto de atraso', () => {
  const result = classifyCurrentMessage({
    channel: 'loja',
    text: 'Paguei a parcela atrasada e vou mandar o comprovante.'
  });
  assert.equal(result.route, 'FINANCEIRO');
});
