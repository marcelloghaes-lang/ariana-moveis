import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  buildProductRebuildPrompt,
  isDifficultCreativeProduct,
  shouldRebuildCreativeProduct,
  rebuildCreativeProductFromReference
} from '../services/creativeProductRebuildService.js';

async function referencePng() {
  return sharp(Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900">' +
      '<rect width="900" height="900" fill="#ffffff"/>' +
      '<circle cx="450" cy="300" r="220" fill="#ffffff" stroke="#222222" stroke-width="20"/>' +
      '<line x1="450" y1="80" x2="450" y2="520" stroke="#222222" stroke-width="14"/>' +
      '<line x1="230" y1="300" x2="670" y2="300" stroke="#222222" stroke-width="14"/>' +
      '<path d="M450 300 C520 190 625 245 590 330 Z" fill="#475569"/>' +
      '<path d="M450 300 C350 245 300 345 390 390 Z" fill="#64748b"/>' +
      '<rect x="430" y="520" width="40" height="210" rx="18" fill="#222222"/>' +
      '<ellipse cx="450" cy="765" rx="190" ry="55" fill="#222222"/>' +
    '</svg>'
  )).png().toBuffer();
}

async function rebuiltPng() {
  return sharp(Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">' +
      '<circle cx="512" cy="340" r="250" fill="#64748b" fill-opacity=".18" stroke="#111827" stroke-width="26"/>' +
      '<line x1="512" y1="95" x2="512" y2="585" stroke="#111827" stroke-width="17"/>' +
      '<line x1="267" y1="340" x2="757" y2="340" stroke="#111827" stroke-width="17"/>' +
      '<path d="M512 340 C590 218 704 275 660 372 Z" fill="#475569"/>' +
      '<path d="M512 340 C400 278 342 390 445 440 Z" fill="#64748b"/>' +
      '<rect x="488" y="585" width="48" height="238" rx="20" fill="#111827"/>' +
      '<ellipse cx="512" cy="864" rx="220" ry="72" fill="#111827"/>' +
    '</svg>'
  ), { density: 144 }).png().toBuffer();
}

function baseAsset() {
  return {
    buffer: Buffer.from('base'),
    sourceWidth: 900,
    sourceHeight: 900,
    width: 640,
    height: 820,
    backgroundRemoved: true,
    cutoutSafe: true,
    cutoutReason: 'ok',
    removalMode: 'connected_light_background+internal_repair',
    removedRatio: 0.44,
    confidence: 0.86,
    repairMetrics: {
      attempted: true,
      difficultProduct: true,
      autoDetectedPorousStructure: true,
      internalCandidateCount: 9,
      internalRemovedPixels: 22000,
      internalBackgroundOk: true,
      whiteHaloOk: true,
      safe: true
    }
  };
}

function fakeFetchFactory({ validationSafe = true } = {}) {
  let imageCalls = 0;
  let validationCalls = 0;
  return {
    stats: () => ({ imageCalls, validationCalls }),
    fetch: async (url, init = {}) => {
      if (String(url).endsWith('/v1/images/edits')) {
        imageCalls += 1;
        assert.equal(init.method, 'POST');
        assert.ok(init.body instanceof FormData);
        assert.equal(init.body.get('model'), 'gpt-image-2');
        assert.equal(init.body.get('background'), 'transparent');
        assert.equal(init.body.get('output_format'), 'png');
        assert.equal(init.body.get('quality'), 'high');
        assert.match(String(init.body.get('prompt')), /mesmo produto/i);
        assert.match(String(init.body.get('prompt')), /fundo realmente transparente/i);
        const generated = await rebuiltPng();
        return new Response(JSON.stringify({
          data: [{ b64_json: generated.toString('base64') }]
        }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-request-id': 'req_rebuild_test'
          }
        });
      }

      if (String(url).endsWith('/v1/responses')) {
        validationCalls += 1;
        const request = JSON.parse(String(init.body || '{}'));
        assert.equal(request.model, 'gpt-5.6-luna');
        assert.equal(request.input?.[0]?.content?.filter(item => item.type === 'input_image').length, 2);
        const payload = validationSafe
          ? {
              sameProduct: true,
              silhouetteFaithful: true,
              structureFaithful: true,
              brandingFaithful: true,
              voidsClean: true,
              noExtraObjects: true,
              confidence: 0.93,
              reason: 'Produto fiel e vazados limpos.'
            }
          : {
              sameProduct: false,
              silhouetteFaithful: false,
              structureFaithful: false,
              brandingFaithful: true,
              voidsClean: true,
              noExtraObjects: true,
              confidence: 0.51,
              reason: 'A base e a grade mudaram.'
            };

        return new Response(JSON.stringify({
          model: 'gpt-5.6-luna',
          output_text: JSON.stringify(payload)
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }

      throw new Error('unexpected_url:' + url);
    }
  };
}

test('detecta automaticamente ventiladores e estruturas vazadas como difíceis', () => {
  assert.equal(isDifficultCreativeProduct('Ventilador de coluna com grade'), true);
  assert.equal(isDifficultCreativeProduct('Fruteira aramada 3 cestos'), true);
  assert.equal(isDifficultCreativeProduct('Geladeira Frost Free 400L'), false);
});

test('não reconstrói PNG já transparente e limpo', () => {
  const decision = shouldRebuildCreativeProduct({
    ...baseAsset(),
    removalMode: 'existing_alpha',
    repairMetrics: {
      internalBackgroundOk: true,
      whiteHaloOk: true
    }
  }, 'Ventilador Arno');
  assert.equal(decision.required, false);
  assert.equal(decision.reason, 'clean_existing_alpha');
});

test('prompt obriga fidelidade e transparência nos vazados', () => {
  const prompt = buildProductRebuildPrompt('Ventilador Arno com grade e base');
  assert.match(prompt, /extremamente fiel/i);
  assert.match(prompt, /não redesenhe/i);
  assert.match(prompt, /espaços entre grades/i);
  assert.match(prompt, /fundo realmente transparente/i);
});

test('reconstrução IA aceita produto somente depois de validação visual', async () => {
  const fake = fakeFetchFactory({ validationSafe: true });
  const result = await rebuildCreativeProductFromReference({
    referenceBuffer: await referencePng(),
    asset: baseAsset(),
    productText: 'Ventilador de coluna com grade e pé',
    enabled: true,
    fetchImpl: fake.fetch,
    apiKey: 'test-key',
    imageModel: 'gpt-image-2',
    validationModel: 'gpt-5.6-luna'
  });

  assert.equal(result.backgroundRemoved, true);
  assert.equal(result.cutoutSafe, true);
  assert.equal(result.removalMode, 'ai_reference_rebuild');
  assert.equal(result.rebuildMetrics?.safe, true);
  assert.equal(result.rebuildMetrics?.validation?.sameProduct, true);
  assert.equal(result.rebuildMetrics?.validation?.voidsClean, true);
  assert.ok(result.rebuildMetrics?.transparentRatio > 0.08);
  assert.deepEqual(fake.stats(), { imageCalls: 1, validationCalls: 1 });

  const meta = await sharp(result.buffer).metadata();
  assert.equal(meta.format, 'png');
  assert.ok(meta.hasAlpha);
});

test('reconstrução diferente da referência é bloqueada pelo quality gate de fidelidade', async () => {
  const fake = fakeFetchFactory({ validationSafe: false });
  const result = await rebuildCreativeProductFromReference({
    referenceBuffer: await referencePng(),
    asset: baseAsset(),
    productText: 'Ventilador de mesa com grade',
    enabled: true,
    fetchImpl: fake.fetch,
    apiKey: 'test-key',
    imageModel: 'gpt-image-2',
    validationModel: 'gpt-5.6-luna'
  });

  assert.equal(result.backgroundRemoved, false);
  assert.equal(result.cutoutSafe, false);
  assert.equal(result.removalMode, 'ai_rebuild_blocked');
  assert.equal(result.cutoutReason, 'ai_rebuild_visual_fidelity_failed');
  assert.equal(result.rebuildMetrics?.safe, false);
  assert.equal(result.rebuildMetrics?.validation?.sameProduct, false);
});

test('falha de API bloqueia reconstrução em vez de aceitar recorte ruim', async () => {
  const result = await rebuildCreativeProductFromReference({
    referenceBuffer: await referencePng(),
    asset: baseAsset(),
    productText: 'Ventilador com grade',
    enabled: true,
    fetchImpl: async () => new Response('quota', { status: 429 }),
    apiKey: 'test-key'
  });

  assert.equal(result.backgroundRemoved, false);
  assert.equal(result.cutoutSafe, false);
  assert.equal(result.cutoutReason, 'ai_rebuild_failed');
  assert.equal(result.rebuildMetrics?.attempted, true);
});
