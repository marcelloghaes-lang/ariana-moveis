const INTERNAL_PRICING_TERMS = [
  /\br\$\s*80(?:[,.]00)?\b/i,
  /\b80\s*reais\b/i,
  /\b15\s*%/i,
  /\b7\s*%/i,
  /taxa\s+de\s+montagem/i,
  /montagem\s+(?:embutida|inclu[ií]da|adicionada)/i,
  /servi[cç]o(?:s)?\s+fisc(?:al|ais)/i,
  /taxa\s+fiscal/i,
  /composi[cç][aã]o\s+(?:do\s+)?pre[cç]o/i,
  /mem[oó]ria\s+de\s+c[aá]lculo/i,
  /pre[cç]o\s*[- ]?base/i
];

export const GUSTAVO_STORE_SALES_POLICY = Object.freeze({
  confidentiality: 'STRICT_INTERNAL_ONLY',
  sitePurpose: 'SHOWCASE_WHILE_WAITING_SELLER',
  sitePriceMeaning: 'EXCLUSIVE_ONLINE_PURCHASE_CONDITION',
  storePriceMeaning: 'PHYSICAL_STORE_OR_ASSISTED_SALE_CONDITION',
  offerWhileWaiting:
    'Enquanto você aguarda o vendedor responsável, posso te enviar fotos de alguns produtos pelo site da loja 😊 Se gostar de algum, é só me falar que o atendente te passa mais informações. Pode ser?',
  sitePriceExplanation:
    'Esse valor que aparece no site é uma condição exclusiva para compra pelo site. Para compra diretamente aqui na loja, esse produto fica por {STORE_PRICE}.',
  paymentContinuation:
    'No cartão, dá para fazer em até {CARD_INSTALLMENTS}x de {CARD_INSTALLMENT_VALUE}. No boleto/crediário, posso calcular a condição para você.',
  priceDifferenceExplanation:
    'O site trabalha com uma condição exclusiva para compra online. Para compra diretamente na loja, vale a condição que te passei por aqui 😊',
  forbiddenDisclosure: Object.freeze([
    'Nunca informar ao cliente valores ou percentuais usados para formar o preço da loja.',
    'Nunca mencionar taxa fixa interna, percentual de montagem, percentual fiscal, serviço fiscal ou memória de cálculo.',
    'Nunca explicar a diferença entre site e loja decompondo custos.',
    'Nunca enviar campos internos de precificação para modelos de IA, prompts, tickets, logs destinados ao cliente ou mensagens do WhatsApp.',
    'Se o cliente insistir em saber a composição, repetir apenas que site e loja possuem condições comerciais diferentes.'
  ])
});

export function containsInternalPricingDisclosure(text = '') {
  const value = String(text || '');
  return INTERNAL_PRICING_TERMS.some((pattern) => pattern.test(value));
}

export function safeStorePriceDifferenceReply() {
  return GUSTAVO_STORE_SALES_POLICY.priceDifferenceExplanation;
}

export function assertCustomerSafeCommercialReply(text = '') {
  if (containsInternalPricingDisclosure(text)) {
    const error = new Error('GUSTAVO_INTERNAL_PRICING_DISCLOSURE_BLOCKED');
    error.code = 'GUSTAVO_INTERNAL_PRICING_DISCLOSURE_BLOCKED';
    throw error;
  }
  return String(text || '');
}
