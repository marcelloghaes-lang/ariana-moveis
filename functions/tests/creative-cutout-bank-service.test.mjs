import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  cutoutUniformDarkBackgroundOriginal
} from '../services/creativeCutoutBankService.js';

test('preserva pixels reais ao remover fundo preto uniforme de ventilador', async () => {
  const source = await sharp({
    create: {
      width: 900,
      height: 1400,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 }
    }
  })
    .composite([
      {
        input: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1400">' +
          '<circle cx="450" cy="360" r="300" fill="#252525" stroke="#888888" stroke-width="16"/>' +
          '<circle cx="450" cy="360" r="90" fill="#d0d0d0"/>' +
          '<path d="M450 660 L450 1120" stroke="#303030" stroke-width="38"/>' +
          '<ellipse cx="450" cy="1220" rx="300" ry="105" fill="#232323" stroke="#606060" stroke-width="12"/>' +
          '</svg>'
        ),
        left: 0,
        top: 0
      }
    ])
    .png()
    .toBuffer();

  const result = await cutoutUniformDarkBackgroundOriginal(
    source,
    'Ventilador de coluna teste'
  );

  assert.ok(result);
  assert.equal(result.backgroundRemoved, true);
  assert.equal(result.cutoutSafe, true);
  assert.equal(result.removalMode, 'original_dark_background_preserved_hq');
  assert.equal(result.repairMetrics.originalPixelsPreserved, true);
  assert.equal(result.repairMetrics.darkBackgroundDirectCutout, true);
  assert.ok(Math.max(result.width, result.height) >= 1200);

  const { data, info } = await sharp(result.buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let transparent = 0;
  let visible = 0;
  for (let i = 0; i < info.width * info.height; i += 1) {
    const alpha = data[i * info.channels + 3];
    if (alpha < 40) transparent += 1;
    if (alpha >= 224) visible += 1;
  }

  assert.ok(transparent > 0);
  assert.ok(visible > 0);
});

test('nao aplica corte especial de fundo preto a produto fora da lista dificil', async () => {
  const source = await sharp({
    create: {
      width: 900,
      height: 1400,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 }
    }
  }).png().toBuffer();

  const result = await cutoutUniformDarkBackgroundOriginal(
    source,
    'Geladeira duplex'
  );

  assert.equal(result, null);
});
