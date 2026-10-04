// Ariana Pay — visão segura para o seller em shadow mode.
// Remove informações internas de fraude/provedor e expõe apenas o que o seller precisa acompanhar.

function clean(value=''){
  return String(value||'').trim();
}

function money(value=0){
  const n=Number(value||0);
  return Number.isFinite(n)?Math.round((n+Number.EPSILON)*100)/100:0;
}

export function buildSellerArianaPayShadowView(audit={},sellerId=''){
  const sid=clean(sellerId);
  if(!sid) throw new Error('sellerId é obrigatório.');

  const seller=(Array.isArray(audit.sellers)?audit.sellers:[])
    .find(row=>clean(row?.sellerId)===sid)||null;

  const balance=seller?.balance||{
    pending:0,
    available:0,
    reserved:0,
    paid:0,
    debt:0,
    totalEquity:0
  };

  const payout=seller?.payoutPreview||{
    ready:false,
    amount:0,
    destination:{ready:false,method:''},
    blockers:['no_available_balance']
  };

  const ownReviews=(Array.isArray(audit.reviewCases)?audit.reviewCases:[])
    .filter(row=>clean(row?.sellerId)===sid)
    .map(row=>({
      orderId:clean(row.orderId),
      status:'review',
      category:clean(row.riskKind||row.cardSecurity?.level||'security_review'),
      reason:clean(row.disputeReason?.label||'Venda em análise de segurança'),
      amount:money(row.expectedNet),
      action:'Aguardar análise da Ariana Móveis'
    }));

  return {
    ok:true,
    feature:'ariana_pay',
    mode:'shadow_read_only',
    sellerId:sid,
    policy:{
      releaseAfterDeliveryDays:15,
      description:'Os recebíveis são liberados 15 dias após a entrega confirmada, desde que não exista bloqueio de segurança, devolução ou contestação.'
    },
    balance:{
      pending:money(balance.pending),
      available:money(balance.available),
      reserved:money(balance.reserved),
      paid:money(balance.paid),
      debt:money(balance.debt),
      totalEquity:money(balance.totalEquity)
    },
    payout:{
      ready:payout.ready===true,
      amount:money(payout.amount),
      destinationReady:payout.destination?.ready===true,
      destinationMethod:clean(payout.destination?.method),
      blockers:Array.isArray(payout.blockers)?payout.blockers.map(clean).filter(Boolean):[],
      executionEnabled:false
    },
    review:{
      count:ownReviews.length,
      cases:ownReviews
    },
    generatedAt:audit.generatedAt||new Date().toISOString(),
    disclaimer:'Valores em conferência. Nenhum repasse é executado por esta tela.'
  };
}

export default { buildSellerArianaPayShadowView };
