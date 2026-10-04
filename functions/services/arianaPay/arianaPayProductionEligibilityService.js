// Ariana Pay — elegibilidade e integridade de repasse para auditoria real em shadow mode.
// Este módulo NÃO grava banco, NÃO libera payout e NÃO altera checkout.
// Objetivo: impedir que preço atual de produto distorça pedido histórico e separar vendas internas.

function clean(value=''){
  return String(value||'').trim();
}

function fold(value=''){
  return clean(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}

function money(value){
  if(value===null||value===undefined||String(value).trim()==='') return null;
  const n=Number(value);
  if(!Number.isFinite(n)) return null;
  return Math.round((n+Number.EPSILON)*100)/100;
}

function qty(item={}){
  return Math.max(1,Number(item.qty||item.quantity||1)||1);
}

export function getItemChargedTotal(item={}){
  const explicit=money(item.totalPrice);
  if(explicit!==null&&explicit>=0) return explicit;
  const unit=money(item.unitPrice??item.price);
  return unit===null?0:money(unit*qty(item))||0;
}

export function getHistoricalSellerBaseSnapshot(item={}){
  const quantity=qty(item);
  const chargedTotal=getItemChargedTotal(item);

  const explicitTotal=money(item.sellerBaseTotal);
  if(explicitTotal!==null&&explicitTotal>0){
    return {
      present:true,
      source:'seller_base_total',
      confidence:'high',
      total:explicitTotal,
      unit:money(explicitTotal/quantity)
    };
  }

  const explicitUnit=money(item.sellerBaseUnitPrice);
  if(explicitUnit!==null&&explicitUnit>0){
    return {
      present:true,
      source:'seller_base_unit_price',
      confidence:'high',
      total:money(explicitUnit*quantity),
      unit:explicitUnit
    };
  }

  const markupTotal=money(item.cardMarkupTotal);
  if(markupTotal!==null&&markupTotal>0&&chargedTotal>markupTotal){
    const total=money(chargedTotal-markupTotal);
    return {
      present:true,
      source:'card_markup_total_derived',
      confidence:'medium',
      total,
      unit:money(total/quantity)
    };
  }

  const markupUnit=money(item.cardMarkupUnit);
  const chargedUnit=money(item.unitPrice??item.price);
  if(markupUnit!==null&&markupUnit>0&&chargedUnit!==null&&chargedUnit>markupUnit){
    const unit=money(chargedUnit-markupUnit);
    return {
      present:true,
      source:'card_markup_unit_derived',
      confidence:'medium',
      total:money(unit*quantity),
      unit
    };
  }

  return {
    present:false,
    source:'missing_sale_time_snapshot',
    confidence:'none',
    total:null,
    unit:null
  };
}

const PLATFORM_SELLER_ALIASES=new Set([
  'arianamoveis',
  'ariana_moveis',
  'ariana-moveis',
  'ariana moveis',
  'ariana'
]);

export function isPlatformSellerId(value=''){
  const id=fold(value).replace(/\s+/g,' ');
  if(!id) return false;
  if(PLATFORM_SELLER_ALIASES.has(id)) return true;
  return id.replace(/[^a-z0-9]/g,'')==='arianamoveis';
}

export function collectSellerIds(order={}){
  const ids=new Set();
  for(const value of Array.isArray(order.sellerIds)?order.sellerIds:[]){
    const id=clean(value);
    if(id) ids.add(id);
  }
  for(const item of Array.isArray(order.items)?order.items:[]){
    const id=clean(item?.sellerId||item?.seller_id);
    if(id) ids.add(id);
  }
  return [...ids];
}

function paymentMethod(order={}){
  return fold(order?.payment?.method||order?.payment?.type||order?.paymentMethod||'');
}

function paymentStatus(order={}){
  return fold(order?.payment?.status||order?.paymentStatus||'');
}

function isInternalCreditMethod(method=''){
  const value=fold(method);
  return value.includes('crediario')||value.includes('crediario_ariana');
}

function approvedPaymentStatus(status=''){
  return new Set(['approved','paid','processed','accredited','settled','succeeded','success']).has(fold(status));
}

export function assessArianaPayOrderEligibility(order={}){
  const sellerIds=collectSellerIds(order);
  const internalSellerIds=sellerIds.filter(isPlatformSellerId);
  const externalSellerIds=sellerIds.filter(id=>!isPlatformSellerId(id));
  const method=paymentMethod(order);
  const status=paymentStatus(order);
  const internalCredit=isInternalCreditMethod(method);
  const approved=approvedPaymentStatus(status);
  const reasons=[];

  if(!externalSellerIds.length) reasons.push('no_external_marketplace_seller');
  if(internalCredit) reasons.push('internal_credit_method');
  if(!approved) reasons.push('payment_not_approved');

  const marketplaceCandidate=externalSellerIds.length>0&&!internalCredit;
  const financiallyEligible=marketplaceCandidate&&approved;

  return {
    marketplaceCandidate,
    financiallyEligible,
    externalSellerIds,
    internalSellerIds,
    paymentMethod:method,
    paymentStatus:status,
    reasons
  };
}

function itemProductId(item={}){
  return clean(item.productId||item._id||item.id);
}

export function buildHistoricalSnapshotProductMap(order={},currentProductMap=new Map()){
  const out=new Map();
  const items=Array.isArray(order.items)?order.items:[];

  for(const item of items){
    const productId=itemProductId(item);
    if(!productId) continue;
    const snapshot=getHistoricalSellerBaseSnapshot(item);
    if(!snapshot.present||!snapshot.unit) continue;

    const current=currentProductMap instanceof Map?(currentProductMap.get(productId)||{}):{};
    const chargedUnit=money(item.unitPrice??item.price);
    const markupUnit=money(item.cardMarkupUnit);
    const retailCashUnit=(chargedUnit!==null&&markupUnit!==null&&markupUnit>0&&chargedUnit>markupUnit)
      ? money(chargedUnit-markupUnit)
      : (chargedUnit!==null?chargedUnit:money(current.retailCashPrice));

    out.set(productId,{
      ...current,
      price:snapshot.unit,
      settlementBase:snapshot.unit,
      retailCashPrice:retailCashUnit||snapshot.unit,
      auditSnapshotSource:snapshot.source,
      auditSnapshotConfidence:snapshot.confidence
    });
  }

  return out;
}

export function assessSellerSettlementIntegrity({order={},sellerId='',settlement={}}={}){
  const sid=clean(sellerId);
  const items=(Array.isArray(order.items)?order.items:[])
    .filter(item=>clean(item?.sellerId||item?.seller_id)===sid);

  let chargedGross=0;
  let snapshotGross=0;
  let snapshotItems=0;
  const sources={};
  const anomalies=[];

  for(const item of items){
    const charged=getItemChargedTotal(item);
    const snapshot=getHistoricalSellerBaseSnapshot(item);
    chargedGross+=charged;

    if(snapshot.present){
      snapshotItems+=1;
      snapshotGross+=Number(snapshot.total||0);
      sources[snapshot.source]=Number(sources[snapshot.source]||0)+1;
      if(Number(snapshot.total||0)>charged+0.01){
        anomalies.push('snapshot_base_exceeds_charged_item');
      }
    }
  }

  chargedGross=money(chargedGross)||0;
  snapshotGross=money(snapshotGross)||0;
  const computedGross=money(settlement?.gross)||0;
  const externalSeller=!isPlatformSellerId(sid);
  const missingSnapshotItems=Math.max(0,items.length-snapshotItems);

  if(externalSeller&&missingSnapshotItems>0){
    anomalies.push('missing_sale_time_settlement_snapshot');
  }
  if(computedGross>chargedGross+0.01){
    anomalies.push('computed_seller_gross_exceeds_charged_gross');
  }
  if(snapshotItems===items.length&&items.length>0&&Math.abs(computedGross-snapshotGross)>0.01){
    anomalies.push('computed_gross_differs_from_sale_snapshot');
  }
  if(externalSeller&&items.length===0){
    anomalies.push('seller_has_no_order_items');
  }

  return {
    sellerId:sid,
    externalSeller,
    itemCount:items.length,
    snapshotItems,
    missingSnapshotItems,
    snapshotCoverage:items.length?Math.round((snapshotItems/items.length)*10000)/100:0,
    snapshotSources:sources,
    chargedGross,
    snapshotGross,
    computedGross,
    anomalies:[...new Set(anomalies)],
    blocked:anomalies.length>0
  };
}

function blockRelease(base={},reason='ariana_pay_safety_gate'){
  return {
    ...base,
    state:'blocked',
    reason,
    availableAt:null
  };
}

export function applyArianaPayProductionSafetyGate({
  release={},
  eligibility={},
  integrity={},
  reconciliation={}
}={}){
  if(!eligibility.marketplaceCandidate){
    return blockRelease(release,'not_ariana_pay_marketplace_candidate');
  }
  if(!eligibility.financiallyEligible){
    return blockRelease(release,'payment_not_approved');
  }
  if(integrity.blocked){
    return blockRelease(release,`settlement_integrity_${integrity.anomalies?.[0]||'blocked'}`);
  }
  if(reconciliation.status!=='matched'){
    return blockRelease(release,`payment_reconciliation_${reconciliation.reason||reconciliation.status||'insufficient_evidence'}`);
  }
  return release;
}

export default {
  getItemChargedTotal,
  getHistoricalSellerBaseSnapshot,
  isPlatformSellerId,
  collectSellerIds,
  assessArianaPayOrderEligibility,
  buildHistoricalSnapshotProductMap,
  assessSellerSettlementIntegrity,
  applyArianaPayProductionSafetyGate
};
