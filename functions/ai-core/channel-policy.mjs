const BASE_DENY = Object.freeze([
  'payment.confirm',
  'receivable.write',
  'credit.approve',
  'refund.execute',
  'external-commerce.recommend'
]);

const POLICIES = Object.freeze({
  loja: Object.freeze({
    allow: Object.freeze([
      'catalog.read','stock.read','price.read','freight.quote',
      'order.read','payment-proof.route','credit.route','support.route',
      'human.handoff','conversation.context-switch'
    ]),
    deny: BASE_DENY
  }),
  site: Object.freeze({
    allow: Object.freeze([
      'catalog.read','stock.read','price.read','freight.quote',
      'order.read.authenticated','cart.assist','checkout.assist',
      'human.handoff'
    ]),
    deny: Object.freeze([
      ...BASE_DENY,
      'finance.customer-details',
      'credit.negotiate',
      'payment-proof.process'
    ])
  }),
  televendas: Object.freeze({
    allow: Object.freeze([
      'catalog.read','stock.read','price.read','freight.quote',
      'sale.assist','order.create.prepare','human.handoff'
    ]),
    deny: Object.freeze([
      ...BASE_DENY,
      'finance.customer-details',
      'credit.approve'
    ])
  }),
  sac: Object.freeze({
    allow: Object.freeze([
      'order.read','delivery.read','occurrence.create.prepare',
      'return.route','warranty.route','human.handoff'
    ]),
    deny: Object.freeze([
      ...BASE_DENY,
      'catalog.proactive-push',
      'credit.negotiate'
    ])
  }),
  financeiro: Object.freeze({
    allow: Object.freeze([
      'receivable.read','payment-proof.read','payment-proof.route',
      'receipt.prepare','human.handoff'
    ]),
    deny: Object.freeze([
      ...BASE_DENY,
      'catalog.proactive-push',
      'sale.assist',
      'credit.approve'
    ])
  }),
  crediario: Object.freeze({
    allow: Object.freeze([
      'receivable.read','credit.read','credit.negotiate.prepare',
      'promise-payment.prepare','payment-proof.route','human.handoff'
    ]),
    deny: Object.freeze([
      ...BASE_DENY,
      'catalog.proactive-push',
      'credit.approve'
    ])
  }),
  ouvidoria: Object.freeze({
    allow: Object.freeze([
      'case.read','case.prepare','history.read','human.handoff'
    ]),
    deny: Object.freeze([
      ...BASE_DENY,
      'catalog.proactive-push',
      'sale.assist',
      'credit.negotiate'
    ])
  })
});

export function normalizeChannel(channel = '') {
  const value = String(channel || '').trim().toLowerCase();
  return POLICIES[value] ? value : 'loja';
}

export function policyForChannel(channel = '') {
  const normalized = normalizeChannel(channel);
  const policy = POLICIES[normalized];
  return {
    channel: normalized,
    allow: [...policy.allow],
    deny: [...policy.deny],
    productionWritesEnabled: false,
    mode: 'shadow'
  };
}

export function canChannel(channel = '', capability = '') {
  const policy = POLICIES[normalizeChannel(channel)];
  const cap = String(capability || '').trim();
  if (!cap) return false;
  if (policy.deny.includes(cap)) return false;
  return policy.allow.includes(cap);
}

export function assertChannelCapability(channel = '', capability = '') {
  if (!canChannel(channel, capability)) {
    const error = new Error('channel_capability_denied');
    error.code = 'channel_capability_denied';
    error.channel = normalizeChannel(channel);
    error.capability = String(capability || '');
    throw error;
  }
  return true;
}
