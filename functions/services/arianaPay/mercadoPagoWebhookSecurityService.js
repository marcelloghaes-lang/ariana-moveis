import crypto from 'crypto';

// Mercado Pago webhook signature verifier.
// No secret is logged or returned.

function clean(value=''){
  return String(value||'').trim();
}

export function parseMercadoPagoSignature(header=''){
  const parts=clean(header).split(',').map(x=>x.trim()).filter(Boolean);
  const out={ts:'',v1:''};
  for(const part of parts){
    const [k,...rest]=part.split('=');
    const key=clean(k).toLowerCase();
    const value=clean(rest.join('='));
    if(key==='ts') out.ts=value;
    if(key==='v1') out.v1=value.toLowerCase();
  }
  return out;
}

export function buildMercadoPagoWebhookManifest({dataId='',requestId='',timestamp=''}={}){
  const id=clean(dataId).toLowerCase();
  const rid=clean(requestId);
  const ts=clean(timestamp);
  if(!ts) throw new Error('Webhook Mercado Pago sem timestamp da assinatura.');

  let manifest='';
  if(id) manifest+=`id:${id};`;
  if(rid) manifest+=`request-id:${rid};`;
  manifest+=`ts:${ts};`;
  return manifest;
}

function safeHexEqual(a='',b=''){
  const left=clean(a).toLowerCase();
  const right=clean(b).toLowerCase();
  if(!/^[a-f0-9]+$/i.test(left)||!/^[a-f0-9]+$/i.test(right)) return false;
  const aa=Buffer.from(left,'hex');
  const bb=Buffer.from(right,'hex');
  if(!aa.length||aa.length!==bb.length) return false;
  return crypto.timingSafeEqual(aa,bb);
}

export function verifyMercadoPagoWebhookTimestamp({
  timestamp='',
  nowMs=Date.now(),
  toleranceSeconds=300
}={}){
  const ts=Number(clean(timestamp));
  const tolerance=Math.max(1,Math.min(Number(toleranceSeconds||300),3600));
  if(!Number.isFinite(ts)||ts<=0){
    return {ok:false,reason:'timestamp_invalid',ageSeconds:null};
  }

  const timestampMs=ts>1e12?ts:ts*1000;
  const ageSeconds=(Number(nowMs)-timestampMs)/1000;
  if(!Number.isFinite(ageSeconds)){
    return {ok:false,reason:'timestamp_invalid',ageSeconds:null};
  }
  if(ageSeconds>tolerance){
    return {ok:false,reason:'signature_too_old',ageSeconds:Math.round(ageSeconds)};
  }
  if(ageSeconds<(-1*tolerance)){
    return {ok:false,reason:'signature_from_future',ageSeconds:Math.round(ageSeconds)};
  }
  return {ok:true,reason:'',ageSeconds:Math.round(ageSeconds)};
}

export function verifyMercadoPagoWebhookSignature({
  signatureHeader='',
  requestId='',
  dataId='',
  secret='',
  requireFreshTimestamp=false,
  nowMs=Date.now(),
  toleranceSeconds=300
}={}){
  const key=clean(secret);
  if(!key) return {ok:false,reason:'secret_not_configured'};

  const parsed=parseMercadoPagoSignature(signatureHeader);
  if(!parsed.ts||!parsed.v1) return {ok:false,reason:'signature_header_invalid'};

  if(requireFreshTimestamp){
    const freshness=verifyMercadoPagoWebhookTimestamp({
      timestamp:parsed.ts,
      nowMs,
      toleranceSeconds
    });
    if(!freshness.ok){
      return {
        ok:false,
        reason:freshness.reason,
        timestamp:parsed.ts,
        ageSeconds:freshness.ageSeconds
      };
    }
  }

  const manifest=buildMercadoPagoWebhookManifest({
    dataId,
    requestId,
    timestamp:parsed.ts
  });

  const expected=crypto
    .createHmac('sha256',key)
    .update(manifest)
    .digest('hex');

  const ok=safeHexEqual(expected,parsed.v1);
  return {
    ok,
    reason:ok?'':'signature_mismatch',
    timestamp:parsed.ts
  };
}

export function getMercadoPagoWebhookDataId(req={}){
  return clean(
    req.query?.['data.id'] ||
    req.query?.data_id ||
    req.body?.data?.id ||
    req.body?.id ||
    ''
  );
}

export default {
  parseMercadoPagoSignature,
  buildMercadoPagoWebhookManifest,
  verifyMercadoPagoWebhookTimestamp,
  verifyMercadoPagoWebhookSignature,
  getMercadoPagoWebhookDataId
};
