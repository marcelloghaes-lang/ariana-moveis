// ============================================================
// MERCADO PAGO - IDEMPOTÊNCIA DE TRANSPORTE
// O legado gerava uma chave aleatória a cada repetição. Esta camada preserva
// o restante do axios, mas substitui apenas o header das criações /v1/payments
// por uma chave determinística por pedido + meio de pagamento.
// ============================================================

function stablePaymentKey(crypto, orderId, method) {
  const hash = crypto
    .createHash('sha256')
    .update(`ariana-mp-v1|${String(orderId)}|${String(method)}`)
    .digest('hex');

  // UUID determinístico para manter um formato aceito amplamente por gateways.
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function paymentIdentity(payload = {}) {
  const orderId = String(
    payload?.metadata?.orderId ||
    payload?.metadata?.order_id ||
    payload?.external_reference ||
    payload?.additional_info?.items?.[0]?.orderId ||
    ''
  ).trim();

  const method = String(
    payload?.payment_method_id ||
    payload?.payment_method?.id ||
    payload?.metadata?.paymentMethod ||
    'payment'
  ).trim().toLowerCase();

  return { orderId, method };
}

export function createMercadoPagoIdempotentAxios(axios, crypto) {
  if (!axios || !crypto) return axios;
  if (axios.__arianaMercadoPagoIdempotencyProxy) return axios;

  const wrappedPost = async (url, data, config = {}) => {
    const target = String(url || '');
    if (/^https:\/\/api\.mercadopago\.com\/v1\/payments(?:\?|$)/i.test(target)) {
      const identity = paymentIdentity(data || {});
      if (identity.orderId) {
        const key = stablePaymentKey(crypto, identity.orderId, identity.method);
        config = {
          ...(config || {}),
          headers: {
            ...((config && config.headers) || {}),
            'X-Idempotency-Key': key
          }
        };
      }
    }
    return axios.post(url, data, config);
  };

  const proxy = new Proxy(axios, {
    apply(target, thisArg, args) {
      return Reflect.apply(target, thisArg, args);
    },
    get(target, prop, receiver) {
      if (prop === 'post') return wrappedPost;
      if (prop === '__arianaMercadoPagoIdempotencyProxy') return true;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });

  return proxy;
}
