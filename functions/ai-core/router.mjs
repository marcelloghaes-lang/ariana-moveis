export const CHANNELS = Object.freeze({
  loja: 'LOJA',
  site: 'SITE',
  televendas: 'TELEVENDAS',
  sac: 'SAC',
  financeiro: 'FINANCEIRO',
  crediario: 'CREDIARIO',
  ouvidoria: 'OUVIDORIA'
});

function norm(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function hasAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

const FINANCE_TERMS = [
  'comprovante', 'paguei', 'pagamento', 'pagar', 'prestacao',
  'parcela', 'pix', 'boleto', 'transferi', 'transferencia',
  'recibo', 'quitacao', 'quitei', 'valor pago'
];

const CREDIT_TERMS = [
  'crediario', 'carne', 'carnê', 'promessa de pagamento',
  'renegociar', 'negociar parcela', 'parcela atrasada',
  'vencida', 'vencimento'
];

const SAC_TERMS = [
  'reclamacao', 'problema', 'defeito', 'garantia', 'troca',
  'devolucao', 'atraso na entrega', 'nao chegou', 'não chegou',
  'produto quebrado', 'assistencia'
];

const PRODUCT_TERMS = [
  'produto', 'geladeira', 'refrigerador', 'tv', 'televisao',
  'sofa', 'sofá', 'guarda roupa', 'guarda-roupa', 'celular',
  'fogao', 'fogão', 'maquina de lavar', 'lavadora', 'freezer',
  'preco', 'preço', 'valor', 'tem dessa', 'tem esse', 'tem essa',
  'quero comprar', 'comprar', 'modelo', 'marca', 'estoque',
  'entrega', 'medida', 'tamanho', 'cor'
];

const OUVIDORIA_TERMS = [
  'ouvidoria', 'reclamacao formal', 'reclamação formal',
  'protocolo', 'quero reclamar da loja'
];

export function classifyCurrentMessage(input = {}) {
  const channel = norm(input.channel || 'loja');
  const text = norm([
    input.text,
    input.transcription,
    input.caption
  ].filter(Boolean).join(' '));
  const mediaType = norm(input.mediaType);
  const previousIntent = norm(input.previousIntent);

  if (hasAny(text, OUVIDORIA_TERMS)) {
    return decision('OUVIDORIA', 'explicit_ouvidoria', channel, previousIntent);
  }

  if (hasAny(text, FINANCE_TERMS)) {
    return decision('FINANCEIRO', 'current_payment_signal', channel, previousIntent);
  }

  if (hasAny(text, CREDIT_TERMS)) {
    return decision('CREDIARIO', 'current_credit_signal', channel, previousIntent);
  }

  if (hasAny(text, SAC_TERMS)) {
    return decision('SAC', 'current_support_signal', channel, previousIntent);
  }

  if (hasAny(text, PRODUCT_TERMS)) {
    return decision('COMERCIAL', 'current_product_signal', channel, previousIntent);
  }

  if (mediaType === 'image' && ['loja', 'site', 'televendas'].includes(channel)) {
    return decision('COMERCIAL', 'image_on_commercial_channel', channel, previousIntent);
  }

  if (channel === 'financeiro') {
    return decision('FINANCEIRO', 'specialized_channel_default', channel, previousIntent);
  }

  if (channel === 'crediario') {
    return decision('CREDIARIO', 'specialized_channel_default', channel, previousIntent);
  }

  if (channel === 'sac') {
    return decision('SAC', 'specialized_channel_default', channel, previousIntent);
  }

  if (channel === 'ouvidoria') {
    return decision('OUVIDORIA', 'specialized_channel_default', channel, previousIntent);
  }

  if (channel === 'televendas' || channel === 'site') {
    return decision('COMERCIAL', 'commercial_channel_default', channel, previousIntent);
  }

  return decision('LOJA_GERAL', 'mixed_store_default', channel, previousIntent);
}

function decision(route, reason, channel, previousIntent) {
  return Object.freeze({
    route,
    reason,
    channel: channel || 'loja',
    previousIntent: previousIntent || '',
    currentMessageWins: true,
    outboundAllowed: false,
    mode: 'shadow'
  });
}

export function extractEnvelope(payload = {}) {
  const data = payload?.data || {};
  const message = data?.message || payload?.message || {};
  const mediaType = payload.mediaType
    || (message.imageMessage ? 'image' : '')
    || (message.audioMessage ? 'audio' : '')
    || (message.documentMessage ? 'document' : '');

  const text = payload.text
    || message.conversation
    || message.extendedTextMessage?.text
    || message.imageMessage?.caption
    || '';

  return {
    channel: payload.channel || payload.source || 'loja',
    text,
    transcription: payload.transcription || '',
    caption: payload.caption || message.imageMessage?.caption || '',
    mediaType,
    previousIntent: payload.previousIntent || ''
  };
}
