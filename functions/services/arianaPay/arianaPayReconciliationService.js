// Ariana Pay — conciliação financeira em shadow mode.
// Compara o valor cobrado no pedido com a evidência financeira já armazenada.
// Não consulta gateway, não grava banco e não movimenta dinheiro.

function clean(value=''){
  return String(value||'').trim();
}

function fold(value=''){
  return clean(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}

function money(value){
  const n=Number(value);
  if(!Number.isFinite(n)) return null;
  return Math.round((n+Number.EPSILON)*100)/100;
}

function firstMoney(values=[]){
  for(const value of values){
    const n=money(value);
    if(n!==null) return n;
  }
  return null;
}

export function extractStoredProviderPayment(order={}){
  const payment=order.payment&&typeof order.payment==='object'?order.payment:{};
  const raw=payment.raw&&typeof payment.raw==='object'?payment.raw:{};

  const provider=fold(payment.provider||order.paymentProvider||'');
  const paymentId=clean(
    payment.paymentId||
    payment.id||
    raw.id||
    order.paymentId||
    ''
  );

  const providerAmount=firstMoney([
    payment.transactionAmount,
    payment.transaction_amount,
    payment.amount,
    raw.transaction_amount,
    raw.amount,
    raw.total_amount,
    raw.amount_received,
    raw.transaction_details?.net_received_amount
  ]);

  const status=fold(payment.status||raw.status||order.paymentStatus||'');
  const currency=clean(payment.currency||raw.currency_id||raw.currency||order.currency||'BRL').toUpperCase();

  return {
    provider,
    paymentId,
    providerAmount,
    status,
    currency,
    source:'stored_order_payment'
  };
}

export function expectedOrderCharge(order={}){
  return firstMoney([
    order.total,
    order.totals?.total,
    order.payment?.expectedAmount,
    order.payment?.amount
  ]);
}

export function reconcileOrderPayment({order={},providerRecord=null,tolerance=0.01}={}){
  const expectedAmount=expectedOrderCharge(order);
  const provider=providerRecord||extractStoredProviderPayment(order);
  const providerAmount=money(provider?.providerAmount);
  const paymentId=clean(provider?.paymentId);
  const orderId=clean(order._id||order.id||order.orderId);
  const currency=clean(provider?.currency||order.currency||'BRL').toUpperCase();

  if(expectedAmount===null){
    return {
      orderId,
      paymentId,
      provider:clean(provider?.provider),
      currency,
      status:'insufficient_evidence',
      reason:'missing_expected_order_amount',
      expectedAmount:null,
      providerAmount,
      difference:null,
      matched:false
    };
  }

  if(!paymentId){
    return {
      orderId,
      paymentId:'',
      provider:clean(provider?.provider),
      currency,
      status:'insufficient_evidence',
      reason:'missing_provider_reference',
      expectedAmount,
      providerAmount,
      difference:null,
      matched:false
    };
  }

  if(providerAmount===null){
    return {
      orderId,
      paymentId,
      provider:clean(provider?.provider),
      currency,
      status:'insufficient_evidence',
      reason:'missing_provider_amount',
      expectedAmount,
      providerAmount:null,
      difference:null,
      matched:false
    };
  }

  const difference=Math.round(((providerAmount-expectedAmount)+Number.EPSILON)*100)/100;
  const matched=Math.abs(difference)<=Math.abs(Number(tolerance||0.01));

  return {
    orderId,
    paymentId,
    provider:clean(provider?.provider),
    currency,
    providerStatus:clean(provider?.status),
    status:matched?'matched':'divergent',
    reason:matched?'':'amount_mismatch',
    expectedAmount,
    providerAmount,
    difference,
    matched
  };
}

export function reconcileOrders(orders=[],options={}){
  const rows=(Array.isArray(orders)?orders:[]).map(order=>reconcileOrderPayment({
    order,
    tolerance:options.tolerance
  }));

  const stats={
    total:rows.length,
    matched:0,
    divergent:0,
    insufficientEvidence:0,
    totalExpected:0,
    totalProvider:0,
    totalDifference:0,
    byReason:{}
  };

  for(const row of rows){
    if(row.status==='matched') stats.matched+=1;
    else if(row.status==='divergent') stats.divergent+=1;
    else stats.insufficientEvidence+=1;

    if(row.expectedAmount!==null) stats.totalExpected+=Number(row.expectedAmount||0);
    if(row.providerAmount!==null) stats.totalProvider+=Number(row.providerAmount||0);
    if(row.difference!==null) stats.totalDifference+=Number(row.difference||0);

    if(row.reason){
      stats.byReason[row.reason]=Number(stats.byReason[row.reason]||0)+1;
    }
  }

  for(const key of ['totalExpected','totalProvider','totalDifference']){
    stats[key]=Math.round((stats[key]+Number.EPSILON)*100)/100;
  }

  return {
    mode:'shadow_read_only',
    providerQueryPerformed:false,
    stats,
    rows
  };
}

export function createProviderReconciliationAdapter({
  provider='',
  fetchPayments=null,
  normalizeRecord=null
}={}){
  const name=clean(provider).toLowerCase();
  if(!name) throw new Error('provider é obrigatório.');
  if(fetchPayments!==null&&typeof fetchPayments!=='function') throw new TypeError('fetchPayments inválido.');
  if(normalizeRecord!==null&&typeof normalizeRecord!=='function') throw new TypeError('normalizeRecord inválido.');

  return {
    provider:name,
    async fetch(input={}){
      if(typeof fetchPayments!=='function'){
        return {
          provider:name,
          liveQuery:false,
          records:[],
          reason:'provider_fetch_not_configured'
        };
      }
      const raw=await fetchPayments(input);
      const records=(Array.isArray(raw)?raw:[])
        .map(item=>typeof normalizeRecord==='function'?normalizeRecord(item):item)
        .filter(Boolean);
      return {provider:name,liveQuery:true,records};
    }
  };
}

export const __test={money,firstMoney,fold};

export default {
  extractStoredProviderPayment,
  expectedOrderCharge,
  reconcileOrderPayment,
  reconcileOrders,
  createProviderReconciliationAdapter
};
