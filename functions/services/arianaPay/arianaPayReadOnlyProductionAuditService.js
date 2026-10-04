// Ariana Pay — auditoria real com credencial Mongo dedicada e SOMENTE LEITURA.
// A conexão é separada do backend de produção e falha fechada se detectar privilégio de escrita.
// Nenhuma informação pessoal do cliente sai do banco: a consulta projeta apenas sinais financeiros/operacionais.
// IMPORTANTE: valores históricos de seller são reconstruídos somente com snapshot gravado no pedido.
// O preço ATUAL do produto nunca é usado como base monetária nesta auditoria.

import createMarketplacePricingService from '../marketplacePricingService.js';
import { detectFinancialRisk, applyRiskToRelease } from './arianaPayRiskService.js';
import { assessCardSecurity, applyCardSecurityToRelease } from './arianaPayCardSecurityService.js';
import { classifyDisputeResponsibility } from './arianaPayDisputeResponsibilityService.js';
import { reconcileOrderPayment } from './arianaPayReconciliationService.js';
import { buildReleaseSchedule } from './arianaPayReleaseScheduleService.js';
import {
  collectSellerIds,
  assessArianaPayOrderEligibility,
  buildHistoricalSnapshotProductMap,
  assessSellerSettlementIntegrity,
  applyArianaPayProductionSafetyGate,
  isPlatformSellerId
} from './arianaPayProductionEligibilityService.js';

function clean(value=''){
  return String(value||'').trim();
}

function money(value=0){
  const n=Number(value||0);
  return Number.isFinite(n)?Math.round((n+Number.EPSILON)*100)/100:0;
}

export function normalizeAuditLimit(value=25){
  const parsed=Number(value);
  if(!Number.isFinite(parsed)) return 25;
  return Math.max(5,Math.min(Math.trunc(parsed),500));
}

export function isFinancialProjectionEligible({
  externalSeller=false,
  eligibility={},
  integrity={},
  reconciliation={},
  risk={},
  cardSecurity={}
}={}){
  return Boolean(
    externalSeller&&
    eligibility.marketplaceCandidate&&
    eligibility.financiallyEligible&&
    !integrity.blocked&&
    reconciliation.status==='matched'&&
    !risk.blocksRelease&&
    !cardSecurity.blocksPayout
  );
}

function errorWith(code,message,statusCode=503){
  const error=new Error(message);
  error.code=code;
  error.statusCode=statusCode;
  return error;
}

export function getReadOnlyProductionAuditConfig(env=process.env){
  const uri=clean(env.ARIANA_PAY_SHADOW_READONLY_MONGODB_URI);
  const productionUri=clean(env.MONGODB_URI||env.MONGO_URI||env.MONGO_URL);
  return {
    enabled:clean(env.ARIANA_PAY_SHADOW_PRODUCTION_AUDIT_ENABLED).toLowerCase()==='true',
    uri,
    databaseName:clean(env.ARIANA_PAY_SHADOW_READONLY_DB||'ariana_moveis_db'),
    reusesProductionUri:Boolean(uri&&productionUri&&uri===productionUri)
  };
}

export function assertReadOnlyProductionAuditConfigured(config=getReadOnlyProductionAuditConfig()){
  if(!config.enabled){
    throw errorWith('ARIANA_PAY_PRODUCTION_AUDIT_DISABLED','Auditoria real está desabilitada.');
  }
  if(!config.uri){
    throw errorWith('ARIANA_PAY_READONLY_MONGO_URI_MISSING','ARIANA_PAY_SHADOW_READONLY_MONGODB_URI ainda não foi configurada.');
  }
  if(config.reusesProductionUri){
    throw errorWith('ARIANA_PAY_READONLY_MONGO_REUSE_BLOCKED','A auditoria não pode reutilizar a credencial Mongo operacional do backend.');
  }
  if(!/^mongodb(?:\+srv)?:\/\//i.test(config.uri)){
    throw errorWith('ARIANA_PAY_READONLY_MONGO_URI_INVALID','URI MongoDB de auditoria inválida.');
  }
  return config;
}

const WRITE_ACTIONS=new Set([
  'anyAction','insert','update','remove','createCollection','dropCollection',
  'renameCollectionSameDB','renameCollection','createIndex','dropIndex','collMod',
  'convertToCapped','createUser','dropUser','grantRole','revokeRole','grantRolesToUser',
  'revokeRolesFromUser','createRole','dropRole','setAuthenticationRestriction',
  'enableSharding','moveChunk','moveCollection','reshardCollection','unshardCollection'
]);

const SAFE_BUILTIN_ROLES=new Set(['read','readAnyDatabase']);

export function inspectReadOnlyPrivileges(connectionStatus={}){
  const auth=connectionStatus?.authInfo||{};
  const roles=Array.isArray(auth.authenticatedUserRoles)?auth.authenticatedUserRoles:[];
  const privileges=Array.isArray(auth.authenticatedUserPrivileges)?auth.authenticatedUserPrivileges:[];

  const detectedWriteActions=[];
  for(const privilege of privileges){
    for(const action of Array.isArray(privilege?.actions)?privilege.actions:[]){
      if(WRITE_ACTIONS.has(String(action))) detectedWriteActions.push(String(action));
    }
  }

  const suspiciousRoles=roles
    .map(row=>clean(row?.role))
    .filter(Boolean)
    .filter(role=>{
      if(SAFE_BUILTIN_ROLES.has(role)) return false;
      const lower=role.toLowerCase();
      return (
        lower.includes('readwrite')||
        lower.includes('dbowner')||
        lower.includes('dbadmin')||
        lower.includes('useradmin')||
        lower.includes('clusteradmin')||
        lower==='root'||
        lower.includes('atlasadmin')
      );
    });

  const allRolesExplicitlyReadOnly=roles.length>0&&roles.every(row=>SAFE_BUILTIN_ROLES.has(clean(row?.role)));
  const privilegeEvidence=privileges.length>0;

  return {
    roles:roles.map(row=>({role:clean(row?.role),db:clean(row?.db)})),
    privilegeEvidence,
    detectedWriteActions:[...new Set(detectedWriteActions)],
    suspiciousRoles:[...new Set(suspiciousRoles)],
    verifiedReadOnly:
      detectedWriteActions.length===0&&
      suspiciousRoles.length===0&&
      (privilegeEvidence||allRolesExplicitlyReadOnly)
  };
}

async function assertMongoCredentialIsReadOnly(db){
  let status;
  try{
    status=await db.command({connectionStatus:1,showPrivileges:true});
  }catch(_error){
    throw errorWith(
      'ARIANA_PAY_READONLY_PRIVILEGE_CHECK_FAILED',
      'Não foi possível comprovar os privilégios somente leitura da credencial Mongo. A auditoria foi bloqueada.',
      503
    );
  }

  const inspection=inspectReadOnlyPrivileges(status);
  if(!inspection.verifiedReadOnly){
    const detail=inspection.detectedWriteActions.length
      ? `ações de escrita detectadas: ${inspection.detectedWriteActions.join(', ')}`
      : inspection.suspiciousRoles.length
        ? `papéis com escrita detectados: ${inspection.suspiciousRoles.join(', ')}`
        : 'não houve evidência suficiente de que a credencial é somente leitura';
    throw errorWith(
      'ARIANA_PAY_READONLY_PRIVILEGE_REJECTED',
      `Credencial Mongo rejeitada: ${detail}.`,
      409
    );
  }
  return inspection;
}

function safeOrderForSecurity(order={}){
  const presence=order.contactPresence||{};
  return {
    ...order,
    customerCpf:presence.cpf?'12345678909':'',
    customerEmail:presence.email?'audit@example.invalid':'',
    customerPhone:presence.phone?'31999999999':'',
    shippingAddress:presence.address
      ? {cep:'39705000',logradouro:'AUDIT_ONLY',numero:'1'}
      : {}
  };
}

function orderProjectionStage(){
  return {
    $project:{
      _id:1,
      sellerIds:1,
      status:1,
      statusLabel:1,
      paymentStatus:1,
      subtotal:1,
      shippingCost:1,
      total:1,
      currency:1,
      totals:1,
      createdAt:1,
      updatedAt:1,
      deliveredAt:1,
      origin:1,
      salesChannel:1,
      items:{
        $map:{
          input:{$ifNull:['$items',[]]},
          as:'it',
          in:{
            productId:'$$it.productId',
            sellerId:'$$it.sellerId',
            seller_id:'$$it.seller_id',
            qty:'$$it.qty',
            quantity:'$$it.quantity',
            unitPrice:'$$it.unitPrice',
            price:'$$it.price',
            totalPrice:'$$it.totalPrice',
            sellerBaseUnitPrice:'$$it.sellerBaseUnitPrice',
            sellerBaseTotal:'$$it.sellerBaseTotal',
            cardMarkupUnit:'$$it.cardMarkupUnit',
            cardMarkupTotal:'$$it.cardMarkupTotal'
          }
        }
      },
      payment:{
        provider:'$payment.provider',
        status:'$payment.status',
        statusDetail:'$payment.statusDetail',
        method:'$payment.method',
        type:'$payment.type',
        paymentMethodId:'$payment.paymentMethodId',
        installments:'$payment.installments',
        transactionAmount:'$payment.transactionAmount',
        transaction_amount:'$payment.transaction_amount',
        amount:'$payment.amount',
        expectedAmount:'$payment.expectedAmount',
        currency:'$payment.currency',
        paymentId:'$payment.paymentId',
        id:'$payment.id',
        externalId:'$payment.externalId',
        externalReference:'$payment.externalReference',
        transactionSecurity:'$payment.transactionSecurity',
        transaction_security:'$payment.transaction_security',
        raw:{
          id:'$payment.raw.id',
          status:'$payment.raw.status',
          status_detail:'$payment.raw.status_detail',
          transaction_amount:'$payment.raw.transaction_amount',
          amount:'$payment.raw.amount',
          total_amount:'$payment.raw.total_amount',
          amount_received:'$payment.raw.amount_received',
          currency_id:'$payment.raw.currency_id',
          external_reference:'$payment.raw.external_reference',
          transaction_details:{
            net_received_amount:'$payment.raw.transaction_details.net_received_amount'
          },
          transaction_security:'$payment.raw.transaction_security',
          payment_method:{
            transaction_security:'$payment.raw.payment_method.transaction_security'
          },
          chargeback_reason:'$payment.raw.chargeback_reason',
          dispute_reason:'$payment.raw.dispute_reason'
        }
      },
      chargeback:{
        status:'$chargeback.status',
        reason:'$chargeback.reason',
        reasonCode:'$chargeback.reasonCode',
        reason_id:'$chargeback.reason_id',
        responsibility:'$chargeback.responsibility'
      },
      dispute:{
        status:'$dispute.status',
        reason:'$dispute.reason',
        reasonCode:'$dispute.reasonCode',
        reason_id:'$dispute.reason_id',
        responsibility:'$dispute.responsibility'
      },
      refund:{status:'$refund.status'},
      rma:{status:'$rma.status'},
      return:{status:'$return.status'},
      shipping:{
        deliveredAt:'$shipping.deliveredAt',
        status:'$shipping.status',
        statusLabel:'$shipping.statusLabel',
        updatedAt:'$shipping.updatedAt'
      },
      delivery:{deliveredAt:'$delivery.deliveredAt'},
      fulfillment:{deliveredAt:'$fulfillment.deliveredAt'},
      trackingHistory:{
        $map:{
          input:{$ifNull:['$trackingHistory',[]]},
          as:'ev',
          in:{
            status:'$$ev.status',
            statusLabel:'$$ev.statusLabel',
            description:'$$ev.description',
            message:'$$ev.message',
            title:'$$ev.title',
            occurredAt:'$$ev.occurredAt',
            eventAt:'$$ev.eventAt',
            dateTime:'$$ev.dateTime',
            datetime:'$$ev.datetime',
            dataHora:'$$ev.dataHora',
            date:'$$ev.date',
            createdAt:'$$ev.createdAt',
            updatedAt:'$$ev.updatedAt'
          }
        }
      },
      contactPresence:{
        cpf:{$ne:[{$ifNull:['$customerCpf','']},'']},
        email:{$ne:[{$ifNull:['$customerEmail','']},'']},
        phone:{$ne:[{$ifNull:['$customerPhone','']},'']},
        address:{
          $and:[
            {$ne:[{$ifNull:['$shippingAddress.cep','']},'']},
            {$ne:[{$ifNull:['$shippingAddress.logradouro','']},'']},
            {$ne:[{$ifNull:['$shippingAddress.numero','']},'']}
          ]
        }
      }
    }
  };
}

function summarizeAnomalyRows(rows=[]){
  const out=[];
  for(const row of rows){
    const sellers=Array.isArray(row?.sellers)?row.sellers:[];
    for(const seller of sellers){
      const anomalies=Array.isArray(seller?.integrity?.anomalies)?seller.integrity.anomalies:[];
      if(!anomalies.length) continue;
      out.push({
        orderId:String(row?.orderId||''),
        createdAt:row?.createdAt||null,
        orderTotal:money(row?.total),
        sellerId:String(seller?.sellerId||''),
        externalSeller:seller?.externalSeller===true,
        anomalies,
        chargedGross:money(seller?.integrity?.chargedGross),
        snapshotGross:money(seller?.integrity?.snapshotGross),
        computedGross:money(seller?.integrity?.computedGross),
        observedChargedGross:money(seller?.settlement?.observedChargedGross),
        observedGross:money(seller?.settlement?.observedGross)
      });
    }
  }
  return out;
}

export async function auditRealProductionSample({
  env=process.env,
  limit=25,
  now=new Date()
}={}){
  const config=assertReadOnlyProductionAuditConfigured(getReadOnlyProductionAuditConfig(env));
  const safeLimit=normalizeAuditLimit(limit);
  const {default:mongoose}=await import('mongoose');
  const connection=mongoose.createConnection(config.uri,{
    dbName:config.databaseName||undefined,
    serverSelectionTimeoutMS:12000,
    connectTimeoutMS:12000,
    socketTimeoutMS:30000,
    maxPoolSize:2,
    minPoolSize:0,
    retryWrites:false
  });

  try{
    await connection.asPromise();
    const db=connection.db;
    const credential=await assertMongoCredentialIsReadOnly(db);
    const totalOrdersInCollection=await db.collection('orders')
      .estimatedDocumentCount({maxTimeMS:5000})
      .catch(()=>null);

    const orders=await db.collection('orders').aggregate([
      {$sort:{createdAt:-1}},
      {$limit:safeLimit},
      orderProjectionStage()
    ],{allowDiskUse:false,maxTimeMS:20000}).toArray();

    const pricing=createMarketplacePricingService({
      Product:null,
      mongoose,
      ensureArray:value=>Array.isArray(value)?value:[],
      toJSON:value=>value
    });

    const rows=[];
    const summary={
      requestedOrders:safeLimit,
      totalOrdersInCollection:Number.isFinite(totalOrdersInCollection)?totalOrdersInCollection:null,
      sampledOrders:orders.length,
      sampleExhaustedCollection:Number.isFinite(totalOrdersInCollection)
        ? orders.length>=totalOrdersInCollection
        : null,
      marketplaceCandidates:0,
      financiallyEligible:0,
      externalSellerOrders:0,
      internalOnlyOrders:0,
      excludedInternalCreditOrders:0,
      ordersWithSeller:0,
      sellerProjections:0,
      externalSellerProjections:0,
      internalSellerProjections:0,
      financialProjectionEligibleProjections:0,
      trustedSnapshotProjections:0,
      missingSnapshotProjections:0,
      settlementIntegrityBlocked:0,
      ordersWithSettlementAnomaly:0,
      releaseScheduled:0,
      releaseBlocked:0,
      activeFinancialRisk:0,
      cardSecurityReviewOrBlock:0,
      paymentMatched:0,
      paymentDivergent:0,
      paymentInsufficientEvidence:0,
      responsibilityReview:0,
      projectedSellerGross:0,
      projectedSellerCommission:0,
      projectedSellerNet:0
    };

    for(const rawOrder of orders){
      const order={...rawOrder,_id:String(rawOrder._id||'')};
      const eligibility=assessArianaPayOrderEligibility(order);
      if(eligibility.marketplaceCandidate) summary.marketplaceCandidates+=1;
      if(eligibility.financiallyEligible) summary.financiallyEligible+=1;
      if(eligibility.externalSellerIds.length) summary.externalSellerOrders+=1;
      if(eligibility.internalSellerIds.length&&!eligibility.externalSellerIds.length) summary.internalOnlyOrders+=1;
      if(eligibility.reasons.includes('internal_credit_method')) summary.excludedInternalCreditOrders+=1;

      const risk=detectFinancialRisk(order);
      if(risk.active) summary.activeFinancialRisk+=1;

      const securityOrder=safeOrderForSecurity(order);
      const cardSecurity=assessCardSecurity(securityOrder);
      if(cardSecurity.applies&&['review','high_review','blocked'].includes(cardSecurity.level)){
        summary.cardSecurityReviewOrBlock+=1;
      }

      const reconciliation=reconcileOrderPayment({order});
      if(reconciliation.status==='matched') summary.paymentMatched+=1;
      else if(reconciliation.status==='divergent') summary.paymentDivergent+=1;
      else summary.paymentInsufficientEvidence+=1;

      const sellerIds=collectSellerIds(order);
      if(sellerIds.length) summary.ordersWithSeller+=1;

      // Mapa deliberadamente construído SEM consultar a coleção products.
      // Somente snapshots salvos no próprio pedido podem definir a base histórica.
      const historicalProductMap=buildHistoricalSnapshotProductMap(order,new Map());

      const sellers=[];
      let orderHasSettlementAnomaly=false;
      for(const sellerId of sellerIds){
        const settlement=pricing.getSellerSettlementForOrder(order,sellerId,historicalProductMap);
        const integrity=assessSellerSettlementIntegrity({order,sellerId,settlement});
        const baseRelease=buildReleaseSchedule({order,seller:{},sellerId});
        const riskRelease=applyRiskToRelease(baseRelease,risk);
        const cardRelease=applyCardSecurityToRelease(riskRelease,cardSecurity);
        const release=applyArianaPayProductionSafetyGate({
          release:cardRelease,
          eligibility,
          integrity,
          reconciliation
        });
        const responsibility=classifyDisputeResponsibility({
          order,
          settlement,
          risk,
          cardSecurity
        });

        const externalSeller=!isPlatformSellerId(sellerId);
        const financialProjectionEligible=isFinancialProjectionEligible({
          externalSeller,
          eligibility,
          integrity,
          reconciliation,
          risk,
          cardSecurity
        });

        summary.sellerProjections+=1;
        if(externalSeller) summary.externalSellerProjections+=1;
        else summary.internalSellerProjections+=1;
        if(financialProjectionEligible) summary.financialProjectionEligibleProjections+=1;
        if(integrity.snapshotItems===integrity.itemCount&&integrity.itemCount>0) summary.trustedSnapshotProjections+=1;
        if(integrity.missingSnapshotItems>0) summary.missingSnapshotProjections+=1;
        if(integrity.blocked){
          summary.settlementIntegrityBlocked+=1;
          orderHasSettlementAnomaly=true;
        }
        if(release.state==='scheduled') summary.releaseScheduled+=1;
        else summary.releaseBlocked+=1;
        if(responsibility.requiresManualReview) summary.responsibilityReview+=1;

        if(financialProjectionEligible){
          summary.projectedSellerGross+=Number(settlement.gross||0);
          summary.projectedSellerCommission+=Number(settlement.commission||0);
          summary.projectedSellerNet+=Number(settlement.net||0);
        }

        sellers.push({
          sellerId,
          externalSeller,
          financialProjectionEligible,
          settlement:{
            chargedGross:settlement.chargedGross,
            gross:settlement.gross,
            commission:settlement.commission,
            commissionPercent:settlement.commissionPercent,
            net:settlement.net,
            settlementMode:settlement.settlementMode,
            integrityBlocked:settlement.integrityBlocked===true,
            integrityReasons:Array.isArray(settlement.integrityReasons)?settlement.integrityReasons:[],
            orderTotal:settlement.orderTotal??money(order.total),
            observedChargedGross:settlement.observedChargedGross??null,
            observedGross:settlement.observedGross??null,
            cardMarkup:settlement.cardMarkup,
            label:settlement.label,
            labelDeductedFromSeller:settlement.labelDeductedFromSeller
          },
          integrity,
          release:{
            state:release.state,
            reason:release.reason,
            transferDeadlineDays:release.transferDeadlineDays,
            availableAt:release.availableAt||null,
            delivery:release.delivery?{
              confirmed:release.delivery.confirmed,
              date:release.delivery.date||null,
              source:release.delivery.source,
              confidence:release.delivery.confidence
            }:null
          },
          responsibility
        });
      }
      if(orderHasSettlementAnomaly) summary.ordersWithSettlementAnomaly+=1;

      rows.push({
        orderId:String(order._id||''),
        createdAt:order.createdAt||null,
        origin:clean(order.origin),
        salesChannel:clean(order.salesChannel),
        status:clean(order.status),
        statusLabel:clean(order.statusLabel),
        total:money(order.total),
        currency:clean(order.currency||'BRL'),
        eligibility,
        sellerCount:sellerIds.length,
        payment:{
          provider:clean(order.payment?.provider),
          status:clean(order.payment?.status||order.paymentStatus),
          method:clean(order.payment?.method||order.payment?.type),
          hasProviderReference:Boolean(
            clean(order.payment?.paymentId||order.payment?.id||order.payment?.externalId||order.payment?.raw?.id)
          )
        },
        reconciliation,
        risk,
        cardSecurity:{
          applies:cardSecurity.applies,
          level:cardSecurity.level,
          score:cardSecurity.score,
          blocksDispatch:cardSecurity.blocksDispatch,
          blocksPayout:cardSecurity.blocksPayout,
          reasons:cardSecurity.reasons,
          transactionSecurity:cardSecurity.transactionSecurity
        },
        sellers
      });
    }

    for(const key of ['projectedSellerGross','projectedSellerCommission','projectedSellerNet']){
      summary[key]=money(summary[key]);
    }

    const anomalyRows=summarizeAnomalyRows(rows);

    return {
      ok:true,
      mode:'production_sample_shadow_read_only',
      source:'dedicated_readonly_mongodb',
      historicalSettlementSource:'order_snapshot_only',
      currentProductPriceUsedForSettlement:false,
      writesEnabled:false,
      payoutsEnabled:false,
      checkoutChanged:false,
      piiReturned:false,
      database:db.databaseName,
      credentialVerification:{
        verifiedReadOnly:true,
        roles:credential.roles
      },
      generatedAt:now.toISOString(),
      summary,
      anomalyRows,
      rows
    };
  }finally{
    await connection.close().catch(()=>{});
  }
}

let autoSweepStarted=false;
function maybeRunAutoFullSweep(){
  if(autoSweepStarted) return;
  if(clean(process.env.ARIANA_PAY_SHADOW_AUTO_FULL_AUDIT).toLowerCase()!=='true') return;
  autoSweepStarted=true;
  const limit=normalizeAuditLimit(process.env.ARIANA_PAY_SHADOW_AUTO_FULL_AUDIT_LIMIT||500);
  setTimeout(async()=>{
    try{
      const result=await auditRealProductionSample({limit,now:new Date()});
      console.log('[ariana-pay][full-readonly-audit][summary]',JSON.stringify({
        generatedAt:result.generatedAt,
        writesEnabled:result.writesEnabled,
        payoutsEnabled:result.payoutsEnabled,
        checkoutChanged:result.checkoutChanged,
        piiReturned:result.piiReturned,
        credentialVerification:result.credentialVerification,
        summary:result.summary
      }));
      console.log('[ariana-pay][full-readonly-audit][anomalies]',JSON.stringify(result.anomalyRows||[]));
    }catch(error){
      console.error('[ariana-pay][full-readonly-audit][error]',JSON.stringify({
        code:error?.code||'ARIANA_PAY_FULL_AUDIT_ERROR',
        message:error?.message||String(error)
      }));
    }
  },1500);
}

maybeRunAutoFullSweep();

export default {
  getReadOnlyProductionAuditConfig,
  assertReadOnlyProductionAuditConfigured,
  inspectReadOnlyPrivileges,
  normalizeAuditLimit,
  isFinancialProjectionEligible,
  auditRealProductionSample
};
