const clean = (value = '', max = 4000) => String(value ?? '').trim().slice(0, max);

const STEP_LABELS = Object.freeze({
  AGUARDANDO_DOCUMENTO_FRENTE: 'frente de RG ou CNH',
  AGUARDANDO_DOCUMENTO_VERSO: 'verso de RG ou CNH',
  AGUARDANDO_SELFIE: 'selfie da pessoa segurando o documento ao lado do rosto',
  AGUARDANDO_COMPROVANTE_ENDERECO: 'comprovante de endereço',
  AGUARDANDO_COMPROVANTE_RENDA: 'comprovante de renda'
});

const RETRY_MESSAGES = Object.freeze({
  AGUARDANDO_DOCUMENTO_FRENTE: 'A foto não ficou adequada para a frente do documento. Envie novamente a *frente do RG ou CNH*, inteira, sem cortes, reflexos ou desfoque.',
  AGUARDANDO_DOCUMENTO_VERSO: 'A foto não ficou adequada para o verso do documento. Envie novamente o *verso do RG ou CNH*, inteiro, sem cortes, reflexos ou desfoque.',
  AGUARDANDO_SELFIE: 'A selfie não ficou no formato necessário. Envie novamente uma *selfie com seu rosto visível e segurando o RG ou CNH ao lado do rosto*, com boa iluminação e sem cobrir o documento.',
  AGUARDANDO_COMPROVANTE_ENDERECO: 'Não consegui confirmar um comprovante de endereço legível. Envie novamente uma foto ou PDF completo, com *nome, endereço e data* visíveis.',
  AGUARDANDO_COMPROVANTE_RENDA: 'Não consegui confirmar um comprovante de renda legível. Envie novamente uma foto ou PDF completo, com as informações principais visíveis.'
});

const DOCUMENT_KIND_TO_FIELD = Object.freeze({
  identity_front: 'identityFront',
  identity_back: 'identityBack',
  selfie_with_id: 'selfie',
  address_proof: 'addressProof',
  income_proof: 'incomeProof'
});

function parseJson(text = '') {
  const raw = clean(text, 12000);
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || raw;
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(fenced.slice(start, end + 1)); } catch { return null; }
}

function aiConfig() {
  return {
    enabled: !['0', 'false', 'off', 'nao', 'não'].includes(clean(process.env.CREDIARIO_AI_ENABLED || 'true').toLowerCase()),
    apiKey: clean(process.env.CREDIARIO_OPENAI_API_KEY || process.env.OPENAI_API_KEY, 1000),
    model: clean(process.env.CREDIARIO_AI_MODEL || 'gpt-4.1-mini', 120),
    timeoutMs: Math.max(5000, Number(process.env.CREDIARIO_AI_TIMEOUT_MS || 18000))
  };
}

const bootAiConfig = aiConfig();
console.log('[crediario-ai/config]', {
  enabled: bootAiConfig.enabled,
  configured: Boolean(bootAiConfig.apiKey),
  model: bootAiConfig.model
});

function imageInput(media = {}) {
  const mimeType = clean(media.mimeType || media.mimetype, 120).toLowerCase();
  const base64 = clean(media.base64, 75_000_000).replace(/^data:[^,]+,/, '').replace(/\s/g, '');
  const imageMime = /^image\/(jpeg|jpg|png|webp)$/.test(mimeType) ? mimeType.replace('image/jpg', 'image/jpeg') : 'image/jpeg';
  return { mimeType, base64, imageMime };
}

async function callVision(prompt, media = {}, maxTokens = 260) {
  const cfg = aiConfig();
  const { mimeType, base64, imageMime } = imageInput(media);
  if (!cfg.enabled || !cfg.apiKey) return { unavailable: true, reason: 'IA não configurada' };
  if (!base64) return { unavailable: true, reason: 'imagem sem base64' };
  if (mimeType === 'application/pdf') return { unavailable: true, pdf: true, reason: 'PDF requer revisão posterior' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${imageMime};base64,${base64}`, detail: 'low' } }
          ]
        }]
      }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}`);
    const data = await response.json();
    const parsed = parseJson(data?.choices?.[0]?.message?.content || '');
    if (!parsed) throw new Error('JSON inválido da visão');
    return { parsed };
  } catch (error) {
    return { error: clean(error?.message || error, 400) };
  } finally {
    clearTimeout(timer);
  }
}

export function offTopicReply() {
  return 'Este canal é destinado apenas para *abertura de crediário*. Para outros assuntos, entre em contato pelo número *31 98514-7119*.';
}

export function looksClearlyOffTopic(text = '') {
  const value = clean(text, 1000).toLowerCase();
  if (!value) return false;
  const creditTerms = /(credi[aá]rio|cr[eé]dito|cadastro|abrir conta|abrir credi[aá]rio|documento|rg|cnh|cpf|selfie|resid[eê]ncia|endere[cç]o|renda|holerite|contracheque|sal[aá]rio|refer[eê]ncia|an[aá]lise|parcela|financi)/i;
  const offTopicTerms = /(pre[cç]o|valor de produto|tem .*estoque|guarda.?roupa|sof[aá]|geladeira|fog[aã]o|televis[aã]o|tv\b|celular|entrega|frete|montagem|pedido|troca|garantia|assist[eê]ncia|boleto de compra|segunda via|pix|comprovante de pagamento|nota fiscal|vendedor|produto)/i;
  return offTopicTerms.test(value) && !creditTerms.test(value);
}

export async function classifyCrediarioText(text = '') {
  const cfg = aiConfig();
  const value = clean(text, 1200);
  if (!value) return { related: true, confidence: 1, source: 'empty' };
  if (looksClearlyOffTopic(value)) return { related: false, confidence: 0.98, source: 'rule' };
  if (!cfg.enabled || !cfg.apiKey) return { related: true, confidence: 0.5, source: 'fallback' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        max_tokens: 120,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'Classifique somente se a mensagem é relacionada à abertura/andamento de crediário da loja. Respostas a perguntas cadastrais como nome, CPF, data de nascimento, estado civil, profissão, telefone, email, referências, envio de documentos e dúvidas sobre crédito contam como relacionadas. Assuntos de produto, entrega, preço, assistência, pedido, pagamento de compra ou SAC são fora do crediário. Responda JSON: {"related":true|false,"confidence":0..1}.' },
          { role: 'user', content: value }
        ]
      }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}`);
    const data = await response.json();
    const parsed = parseJson(data?.choices?.[0]?.message?.content || '');
    if (!parsed || typeof parsed.related !== 'boolean') throw new Error('classificação inválida');
    return { related: parsed.related, confidence: Number(parsed.confidence || 0), source: 'ai' };
  } catch (error) {
    console.warn('[crediario-ai/text] fallback:', error?.message || error);
    return { related: true, confidence: 0, source: 'fallback_error' };
  } finally {
    clearTimeout(timer);
  }
}

export async function identifyCrediarioDocument(media = {}) {
  const vision = await callVision(
    'Classifique SOMENTE o tipo operacional do arquivo para coleta de crediário. Não autentique identidade, não detecte fraude e não faça decisão de crédito. Escolha exatamente um kind: identity_front (frente de RG/CNH), identity_back (verso de RG/CNH), selfie_with_id (pessoa segurando RG/CNH próximo ao rosto), address_proof (conta/fatura/comprovante com nome e endereço), income_proof (holerite/contracheque/extrato ou comprovante de renda) ou unknown. Informe também readable true/false e confidence 0..1. JSON: {"kind":"...","readable":true,"confidence":0.0,"reason":"curto"}.',
    media,
    220
  );
  if (vision.unavailable || vision.error) return { ok: false, source: vision.pdf ? 'pdf' : 'unavailable', reason: vision.reason || vision.error || 'IA indisponível' };
  const parsed = vision.parsed || {};
  const kind = clean(parsed.kind, 80).toLowerCase();
  const field = DOCUMENT_KIND_TO_FIELD[kind] || '';
  const confidence = Number(parsed.confidence || 0);
  const readable = parsed.readable === true;
  return {
    ok: Boolean(field && readable && confidence >= 0.55),
    source: 'ai', kind, field, readable, confidence,
    reason: clean(parsed.reason, 500)
  };
}

export async function validateCrediarioDocument({ step = '', media = {} } = {}) {
  const expected = STEP_LABELS[step];
  if (!expected) return { ok: true, source: 'not_document_step' };

  const { mimeType, base64 } = imageInput(media);
  if (!base64) return { ok: false, source: 'missing_media', reason: 'arquivo sem conteúdo para conferência', reply: RETRY_MESSAGES[step] };

  const cfg = aiConfig();
  if (!cfg.enabled || !cfg.apiKey) {
    return { ok: true, source: 'ai_unavailable', reviewRequired: true, reason: 'IA não configurada; manter revisão humana posterior' };
  }

  if (mimeType === 'application/pdf') {
    return { ok: true, source: 'pdf_manual_review', reviewRequired: true, reason: 'PDF armazenado para revisão; visão automática limitada a imagens' };
  }

  const vision = await callVision(
    `Faça SOMENTE conferência operacional da imagem enviada para a etapa de ${expected}. Não autentique identidade, não detecte fraude, não avalie crédito, renda suficiente, classe social, raça, idade, gênero ou qualquer atributo sensível. Verifique apenas: (1) se o tipo visual parece corresponder ao documento solicitado; (2) se está legível e suficientemente enquadrado. Para selfie, confirme apenas que há uma pessoa visível segurando um documento de identidade próximo ao rosto e que ambos estão visíveis. Para comprovante de endereço, confira se parece um comprovante e se nome/endereço/data estão visíveis, sem validar se os dados são verdadeiros. Para comprovante de renda, confira se parece documento de renda e está legível, sem avaliar o valor. Responda JSON estrito: {"matches":true|false,"readable":true|false,"confidence":0..1,"reason":"curto","guidance":"curto"}.`,
    media,
    260
  );
  if (vision.unavailable || vision.error) {
    console.warn('[crediario-ai/vision] revisão manual:', vision.reason || vision.error);
    return { ok: true, source: 'ai_error', reviewRequired: true, reason: vision.reason || vision.error || 'IA indisponível' };
  }

  const parsed = vision.parsed || {};
  const ok = parsed.matches === true && parsed.readable === true && Number(parsed.confidence || 0) >= 0.55;
  return {
    ok,
    source: 'ai',
    matches: parsed.matches === true,
    readable: parsed.readable === true,
    confidence: Number(parsed.confidence || 0),
    reason: clean(parsed.reason, 500),
    guidance: clean(parsed.guidance, 500),
    reply: ok ? '' : `${RETRY_MESSAGES[step]}${parsed.guidance ? `\n\n${clean(parsed.guidance, 350)}` : ''}`
  };
}
