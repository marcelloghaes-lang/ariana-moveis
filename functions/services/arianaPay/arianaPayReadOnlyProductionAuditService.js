// Ariana Pay — auditoria de amostra real com credencial Mongo dedicada e SOMENTE LEITURA.
// A conexão é separada do backend de produção e falha fechada se detectar privilégio de escrita.
// Nenhuma informação pessoal do cliente sai do banco: a consulta projeta apenas sinais financeiros/operacionais.

import createMarketplacePricingService from '../marketplacePricingService.js';
import { hadApprovedPayment, detectFinancialRisk, applyRiskToRelease } from './arianaPayRiskService.js';
import { assessCardSecurity, applyCardSecurityToRelease } from './arianaPayCardSecurityService.js';
import { classifyDisputeResponsibility } from './arianaPayDisputeResponsibilityService.js';
import { reconcileOrderPayment } from './arianaPayReconciliationService.js';
import { buildReleaseSchedule } from './arianaPayReleaseScheduleService.js';

function clean(value=''){
  return String(value||'').trim();
}

function money(value=0){
  const n=Number(value||0);
  return Number.isFinite(n)?Math.round((n+Number.EPSILON)*100)/100:0;
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
    throw errorWith('ARIANA_PAY_PRODUCTION_AUDIT_DISABLED','Auditoria de amostra real está desabilitada.');
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
  }catch(error){
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

function sellerIdsFromOrder(order={}){
  const ids=new Set();
  for(const value of Array.isArray(order.sellerIds)?order.sellerIds:[]){
    const id=clean(value);
    if(id) ids.add(id);
  }
  for(const item of Array.isArray(order.items)?order.items:[]){
    const id=clean(item?.sellerId||item?.seller_id);
    if(id) ids.add(id);
  }
  if(order.manufacturer) ids.add(clean(order.manufacturer));
  return [...ids].filter(Boolean);
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
      manufacturer:1,
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

async function loadProductBaseMap(db,orders=[],pricing,mongoose){
  const rawIds=[...new Set(
    orders.flatMap(order=>(Array.isArray(order.items)?order.items:[]))
      .map(item=>clean(item?.productId))
      .filter(id=>mongoose.Types.ObjectId.isValid(id))
  )];

  if(!rawIds.length) return new Map();

  const docs=await db.collection('products').find(
    {_id:{$in:rawIds.map(id=>new mongoose.Types.ObjectId(id))}},
    {projection:{
      _id:1,price:1,preco:1,pixPrice:1,sellerBasePrice:1,sellerBaseUnitPrice:1,
      basePrice:1,precoBaseSeller:1,precoSeller:1,sellerId:1,dropshipping:1
    }}
  ).toArray();

  return new Map(docs.map(product=>{
    const profile=pricing.getProductSettlementProfile(product);
    return [String(product._id),{
      price:profile.settlementBase,
      settlementBase:profile.settlementBase,
      retailCashPrice:profile.retailCashPrice,
      managed:profile.managed,
      operationMode:profile.operationMode,
      sellerId:clean(product.sellerId)
    }];
  }));
}

export async function auditRealProductionSample({
  env=process.env,
  limit=25,
  now=new Date()
}={}){
  const config=assertReadOnlyProductionAuditConfigured(getReadOnlyProductionAuditConfig(env));
  const safeLimit=Math.max(5,Math.min(Number(limit||25),100));
  const {default:mongoose}=await import('mongoose');
  const connection=mongoose.createConnection(config.uri,{
    dbName:config.databaseName||undefined,
    serverSelectionTimeoutMS:12000,
    connectTimeoutMS:12000,
    socketTimeoutMS:20000,
    maxPoolSize:2,
    minPoolSize:0,
    retryWrites:false
  });

  try{
    await connection.asPromise();
    const db=connection.db;
    const credential=await assertMongoCredentialIsReadOnly(db);

    const orders=await db.collection('orders').aggregate([
      {$sort:{createdAt:-1}},
      {$limit:safeLimit},
      orderProjectionStage()
    ],{allowDiskUse:false,maxTimeMS:12000}).toArray();

    const pricing=createMarketplacePricingService({
      Product:null,
      mongoose,
      ensureArray:value=>Array.isArray(value)?value:[],
      toJSON:value=>value
    });
    const productBaseMap=await loadProductBaseMap(db,orders,pricing,mongoose);

    const rows=[];
    const summary={
      sampledOrders:orders.length,
      financiallyEligible:0,
      ordersWithSeller:0,
      sellerProjections:0,
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
      const eligible=hadApprovedPayment(order);
      if(eligible) summary.financiallyEligible+=1;

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

      const sellerIds=sellerIdsFromOrder(order);
      if(sellerIds.length) summary.ordersWithSeller+=1;

      const sellers=[];
      for(const sellerId of sellerIds){
        const settlement=pricing.getSellerSettlementForOrder(order,sellerId,productBaseMap);
        const baseRelease=buildReleaseSchedule({order,seller:{},sellerId});
        const riskRelease=applyRiskToRelease(baseRelease,risk);
        const release=applyCardSecurityToRelease(riskRelease,cardSecurity);
        const responsibility=classifyDisputeResponsibility({
          order,
          settlement,
          risk,
          cardSecurity
        });

        summary.sellerProjections+=1;
        if(release.state==='scheduled') summary.releaseScheduled+=1;
        else summary.releaseBlocked+=1;
        if(responsibility.requiresManualReview) summary.responsibilityReview+=1;
        summary.projectedSellerGross+=Number(settlement.gross||0);
        summary.projectedSellerCommission+=Number(settlement.commission||0);
        summary.projectedSellerNet+=Number(settlement.net||0);

        sellers.push({
          sellerId,
          settlement:{
            chargedGross:settlement.chargedGross,
            gross:settlement.gross,
            commission:settlement.commission,
            commissionPercent:settlement.commissionPercent,
            net:settlement.net,
            settlementMode:settlement.settlementMode,
            cardMarkup:settlement.cardMarkup,
            label:settlement.label,
            labelDeductedFromSeller:settlement.labelDeductedFromSeller
          },
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

      rows.push({
        orderId:String(order._id||''),
        createdAt:order.createdAt||null,
        status:clean(order.status),
        statusLabel:clean(order.statusLabel),
        total:money(order.total),
        currency:clean(order.currency||'BRL'),
        financiallyEligible:eligible,
        sellerCount:sellerIds.length,
        payment:{
          provider:clean(order.payment?.provider),
          status:clean(order.payment?.status||order.paymentStatus),
          method:clean(order.payment?.method||order.payment?.type)
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

    return {
      ok:true,
      mode:'production_sample_shadow_read_only',
      source:'dedicated_readonly_mongodb',
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
      rows
    };
  }finally{
    await connection.close().catch(()=>{});
  }
}

export default {
  getReadOnlyProductionAuditConfig,
  assertReadOnlyProductionAuditConfigured,
  inspectReadOnlyPrivileges,
  auditRealProductionSample
};
