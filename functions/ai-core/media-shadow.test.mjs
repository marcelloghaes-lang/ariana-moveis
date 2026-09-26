import test from 'node:test';
import assert from 'node:assert/strict';
import { blobPath, mediaKindRoute } from './media-shadow.mjs';

test('monta caminho ActiveStorage local sem escapar do storage', () => {
  assert.equal(
    blobPath('tw2ihutfsy2d2sao91w5kflx13pd'),
    '/app/storage/tw/2i/tw2ihutfsy2d2sao91w5kflx13pd'
  );
  assert.equal(blobPath('../../etc/passwd'), '');
});

test('comprovante vai para financeiro', () => {
  assert.equal(mediaKindRoute('payment_receipt_pix'), 'FINANCEIRO');
  assert.equal(mediaKindRoute('payment_receipt_boleto'), 'FINANCEIRO');
});

test('produto vai para comercial', () => {
  assert.equal(mediaKindRoute('product'), 'COMERCIAL');
});

test('documento pessoal fica separado', () => {
  assert.equal(mediaKindRoute('personal_document'), 'DOCUMENTO_PESSOAL');
});

test('mídia incerta continua pendente', () => {
  assert.equal(mediaKindRoute('unknown'), 'MULTIMIDIA_PENDENTE');
  assert.equal(mediaKindRoute('other'), 'MULTIMIDIA_PENDENTE');
});
