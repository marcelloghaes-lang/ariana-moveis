// Ariana Pay — agenda de liberação em shadow mode.
// Calcula quando um recebível pode deixar "a liberar" e virar "disponível".
// Não grava nada e não executa payout.

export const ARIANA_PAY_MIN_RELEASE_DAYS = 15;

function cleanText(value=''){
  return String(value||'').trim().toLowerCase();
}

function asDate(value){
  if(!value) return null;
  const d=value instanceof Date?value:new Date(value);
  return Number.isNaN(d.getTime())?null:d;
}

function addDays(date,days){
  const d=asDate(date);
  if(!d) return null;
  const out=new Date(d.getTime());
  out.setUTCDate(out.getUTCDate()+Number(days||0));
  return out;
}

function deliveredToken(value=''){
  const s=cleanText(value);
  return s.includes('entregue')||s.includes('delivered');
}

function trackingEventDate(event={}){
  return asDate(
    event.deliveredAt||
    event.occurredAt||
    event.eventAt||
    event.dateTime||
    event.datetime||
    event.dataHora||
    event.date||
    event.createdAt||
    event.updatedAt
  );
}

export function findDeliveryConfirmation(order={}){
  const explicit=[
    order.deliveredAt,
    order.delivery?.deliveredAt,
    order.shipping?.deliveredAt,
    order.fulfillment?.deliveredAt,
    order.shipping?.delivery?.deliveredAt
  ];

  for(const value of explicit){
    const date=asDate(value);
    if(date) return {confirmed:true,date,source:'explicit_delivery_timestamp',confidence:'high'};
  }

  const history=Array.isArray(order.trackingHistory)?order.trackingHistory:[];
  const deliveredEvents=history
    .filter(event=>deliveredToken(event?.status)||deliveredToken(event?.statusLabel)||deliveredToken(event?.description)||deliveredToken(event?.message)||deliveredToken(event?.title))
    .map(event=>({event,date:trackingEventDate(event)}))
    .filter(row=>row.date)
    .sort((a,b)=>a.date-b.date);

  if(deliveredEvents.length){
    return {confirmed:true,date:deliveredEvents[0].date,source:'tracking_history',confidence:'high'};
  }

  const currentDelivered=deliveredToken(order.status)||deliveredToken(order.statusLabel)||deliveredToken(order.shipping?.status)||deliveredToken(order.shipping?.statusLabel);
  if(currentDelivered){
    const fallback=asDate(order.updatedAt||order.shipping?.updatedAt);
    if(fallback){
      return {confirmed:true,date:fallback,source:'delivered_status_updated_at_fallback',confidence:'low'};
    }
    return {confirmed:true,date:null,source:'delivered_status_without_timestamp',confidence:'low'};
  }

  return {confirmed:false,date:null,source:'not_delivered',confidence:'none'};
}

export function normalizeTransferDeadlineDays(seller={}){
  const raw=
    seller?.metadata?.transferDeadlineDays ??
    seller?.transferDeadlineDays ??
    seller?.metadata?.payoutDeadlineDays ??
    null;

  // Regra Ariana Pay: 15 dias após a entrega é o piso de segurança.
  // Sem configuração específica, usa 15. Configurações maiores continuam válidas;
  // configurações menores nunca reduzem o prazo abaixo de 15 dias.
  if(raw===null||raw===undefined||String(raw).trim()==='') return ARIANA_PAY_MIN_RELEASE_DAYS;
  const days=Number(String(raw).replace(',','.'));
  if(!Number.isFinite(days)||days<0||days>90) return ARIANA_PAY_MIN_RELEASE_DAYS;
  return Math.max(ARIANA_PAY_MIN_RELEASE_DAYS, days);
}

export function buildReleaseSchedule({order={},seller={},sellerId=''}={}){
  const sid=String(sellerId||seller?.sellerId||'').trim();
  const deadlineDays=normalizeTransferDeadlineDays(seller);
  const delivery=findDeliveryConfirmation(order);

  if(!delivery.confirmed){
    return {
      state:'blocked',
      reason:'delivery_not_confirmed',
      sellerId:sid,
      transferDeadlineDays:deadlineDays,
      delivery,
      availableAt:null
    };
  }

  if(!delivery.date){
    return {
      state:'blocked',
      reason:'delivery_timestamp_missing',
      sellerId:sid,
      transferDeadlineDays:deadlineDays,
      delivery,
      availableAt:null
    };
  }

  if(delivery.confidence!=='high'){
    return {
      state:'blocked',
      reason:'delivery_timestamp_low_confidence',
      sellerId:sid,
      transferDeadlineDays:deadlineDays,
      delivery,
      availableAt:null
    };
  }

  const availableAt=addDays(delivery.date,deadlineDays);
  return {
    state:'scheduled',
    reason:'',
    sellerId:sid,
    transferDeadlineDays:deadlineDays,
    delivery,
    availableAt:availableAt?.toISOString()||null
  };
}

export default {
  findDeliveryConfirmation,
  normalizeTransferDeadlineDays,
  buildReleaseSchedule
};
