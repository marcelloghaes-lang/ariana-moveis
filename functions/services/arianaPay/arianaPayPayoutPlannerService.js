// Ariana Pay — planejamento de payout em modo preview.
// Não cria payout, não chama banco/gateway e não altera saldo.

function clean(value=''){
  return String(value||'').trim();
}

function digits(value=''){
  return clean(value).replace(/\D/g,'');
}

function money(value=0){
  const n=Number(value||0);
  if(!Number.isFinite(n)) return 0;
  return Math.round((n+Number.EPSILON)*100)/100;
}

function sellerStatusApproved(seller={}){
  const status=clean(seller.status||seller.metadata?.status).toLowerCase();
  return ['approved','aprovado','active','ativo'].includes(status);
}

export function getSellerPayoutDestinationReadiness(seller={}){
  const meta=seller.metadata&&typeof seller.metadata==='object'?seller.metadata:{};
  const root=seller.bankAccount&&typeof seller.bankAccount==='object'?seller.bankAccount:{};
  const bank=meta.bankAccount&&typeof meta.bankAccount==='object'?meta.bankAccount:{};

  const pixKey=clean(root.pixKey||bank.pixKey||meta.pixKey||meta.chavePix);
  const bankCode=digits(root.bankCode||bank.bankCode||meta.bankCode||meta.codigoBanco);
  const agency=digits(root.agency||root.branchNumber||bank.agency||bank.branchNumber||meta.agency||meta.bankAgency||meta.branchNumber);
  const account=digits(root.account||root.accountNumber||root.number||bank.account||bank.accountNumber||bank.number||meta.accountNumber||meta.bankAccountNumber||meta.conta);
  const holderName=clean(root.holderName||bank.holderName||meta.holderName||meta.bankHolderName);
  const holderDocument=digits(root.holderDocument||bank.holderDocument||meta.holderDocument||meta.bankHolderDocument||meta.documentTitular||meta.cpfCnpjTitular);

  const hasPix=Boolean(pixKey);
  const hasBank=Boolean(bankCode&&agency&&account);
  const holderReady=Boolean(holderName&&[11,14].includes(holderDocument.length));
  const routeReady=hasPix||hasBank;

  return {
    ready: routeReady&&holderReady,
    routeReady,
    holderReady,
    method: hasPix?'pix':hasBank?'bank_account':'',
    hasPix,
    hasBank,
    missing: [
      !routeReady?'transfer_route':null,
      !holderName?'holder_name':null,
      ![11,14].includes(holderDocument.length)?'holder_document':null
    ].filter(Boolean)
  };
}

export function buildSellerPayoutPlan({seller={},balance={}}={}){
  const sellerId=clean(seller.sellerId||seller.id||seller._id);
  const available=money(balance.available||0);
  const debt=money(balance.debt||0);
  const destination=getSellerPayoutDestinationReadiness(seller);
  const approved=sellerStatusApproved(seller);
  const blockers=[];

  if(!sellerId) blockers.push('missing_seller_id');
  if(!approved) blockers.push('seller_not_approved');
  if(available<=0) blockers.push('no_available_balance');
  if(debt>0) blockers.push('outstanding_seller_debt');
  if(!destination.ready) blockers.push(...destination.missing);

  return {
    mode:'preview_only',
    sellerId,
    ready:blockers.length===0,
    amount:available,
    debt,
    currency:'BRL',
    provider:'unassigned',
    destination:{
      ready:destination.ready,
      method:destination.method
    },
    blockers:[...new Set(blockers)]
  };
}

export function buildPayoutBatchPreview({sellers=[],balances=[]}={}){
  const sellerMap=new Map((Array.isArray(sellers)?sellers:[]).map(row=>[clean(row?.sellerId),row]));
  const plans=(Array.isArray(balances)?balances:[]).map(row=>{
    const sellerId=clean(row?.sellerId);
    return buildSellerPayoutPlan({
      seller:sellerMap.get(sellerId)||{sellerId},
      balance:row?.balance||{}
    });
  });

  const ready=plans.filter(row=>row.ready);
  const blocked=plans.filter(row=>!row.ready);
  return {
    mode:'preview_only',
    payoutExecutionEnabled:false,
    totalSellers:plans.length,
    readySellers:ready.length,
    blockedSellers:blocked.length,
    readyAmount:money(ready.reduce((sum,row)=>sum+Number(row.amount||0),0)),
    plans
  };
}

export const __test={sellerStatusApproved,money};

export default {
  getSellerPayoutDestinationReadiness,
  buildSellerPayoutPlan,
  buildPayoutBatchPreview
};
