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
  const aa=Buffer.from(clean(a).toLowerCase(),'hex');
  const bb=Buffer.from(clean(b).toLowerCase(),'hex');
  if(!aa.length||aa.length!==bb.length) return false;
  return crypto.timingSafeEqual(aa,bb);
}

export function verifyMercadoPagoWebhookSignature({
  signatureHeader='',
  requestId='',
  dataId='',
  secret=''
}={}){
  const key=clean(secret);
  if(!key) return {ok:false,reason:'secret_not_configured'};

  const parsed=parseMercadoPagoSignature(signatureHeader);
  if(!parsed.ts||!parsed.v1) return {ok:false,reason:'signature_header_invalid'};

  const manifest=buildMercadoPagoWebhookManifest({
    dataId,
    requestId,
    timestamp:parsed.ts
  });

  const expected=crypto
    .createHmac('sha256',key)
    .update(manifest)
    .digest('hex');

  return {
    ok:safeHexEqual(expected,parsed.v1),
    reason:safeHexEqual(expected,parsed.v1)?'':'signature_mismatch',
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
  verifyMercadoPagoWebhookSignature,
  getMercadoPagoWebhookDataId
};
