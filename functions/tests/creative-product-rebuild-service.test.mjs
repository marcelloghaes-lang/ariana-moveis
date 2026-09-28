import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  buildProductRebuildPrompt,
  isFanCreativeProduct,
  rebuildCreativeProductFromReference
} from '../services/creativeProductRebuildService.js';

test('Cutout Studio força reconstrução por IA mesmo quando o recorte anterior parece seguro', async () => {
  const referenceBuffer = await sharp({
    create: {
      width: 900,
      height: 900,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    }
  }).png().toBuffer();

  const asset = {
    buffer: referenceBuffer,
    width: 900,
    height: 900,
    backgroundRemoved: true,
    cutoutSafe: true,
    cutoutReason: 'ok',
    removalMode: 'connected_background',
    repairMetrics: {
      internalBackgroundOk: true,
      whiteHaloOk: true,
      thinStructureDamageOk: true
    }
  };

  const result = await rebuildCreativeProductFromReference({
    referenceBuffer,
    asset,
    productText: 'Lavadora de roupas branca',
    enabled: false,
    force: true,
    perform: true
  });

  assert.equal(result.rebuildMetrics.required, true);
  assert.equal(result.rebuildMetrics.eligibilityReason, 'forced_master_repair');
  assert.equal(result.rebuildMetrics.reason, 'ai_rebuild_disabled');
});

test('prompt mestre protege superfícies claras reais do produto', () => {
  const prompt = buildProductRebuildPrompt('Lavadora branca', { masterRepair: true });
  assert.match(prompt, /superfícies claras/i);
  assert.match(prompt, /permanecer totalmente sólidas e opacas/i);
  assert.match(prompt, /não abra buracos/i);
  assert.match(prompt, /IMAGEM MESTRE/i);
});


test('perfil de ventilador exige reconstrução mestre integral e alta nitidez', () => {
  assert.equal(isFanCreativeProduct('Ventilador Mondial de coluna 40cm'), true);
  assert.equal(isFanCreativeProduct('Geladeira duplex'), false);

  const prompt = buildProductRebuildPrompt(
    'Ventilador Mondial de coluna 40cm',
    { masterRepair: true, fanMaster: true }
  );

  assert.match(prompt, /MODO VENTILADOR MASTER/i);
  assert.match(prompt, /reconstrua o ventilador inteiro/i);
  assert.match(prompt, /88% a 94% da altura útil/i);
  assert.match(prompt, /nitidez de catálogo/i);
  assert.match(prompt, /arquivo mestre/i);
});
