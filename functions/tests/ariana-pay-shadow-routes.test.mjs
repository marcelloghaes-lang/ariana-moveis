import test from 'node:test';
import assert from 'node:assert/strict';
import registerArianaPayShadowRoutes from '../routes/arianaPayShadowRoutes.js';

function createApp(){
  const routes={get:new Map(),post:new Map()};
  return {
    routes,
    get(path,...handlers){ routes.get.set(path,handlers); },
    post(path,...handlers){ routes.post.set(path,handlers); }
  };
}

function createResponse(){
  return {
    statusCode:200,
    body:null,
    status(code){ this.statusCode=Number(code); return this; },
    json(body){ this.body=body; return this; },
    send(body){ this.body=body; return this; }
  };
}

function register({axios={}}={}){
  const app=createApp();
  const adminRequired=(_req,_res,next)=>next?.();
  const Order={find(){ throw new Error('Order não deve ser consultado neste teste'); }};
  const Seller={find(){ throw new Error('Seller não deve ser consultado neste teste'); }};

  registerArianaPayShadowRoutes(app,{
    adminRequired,
    Order,
    Seller,
    axios,
    buildProductBasePriceMapForOrders:async()=>new Map(),
    getSellerSettlementForOrder:()=>null
  });

  return {app,adminRequired};
}

function saveEnv(keys){
  const previous={};
  for(const key of keys) previous[key]=process.env[key];
  return ()=>{
    for(const [key,value] of Object.entries(previous)){
      if(value===undefined) delete process.env[key];
      else process.env[key]=value;
    }
  };
}

const ENV_KEYS=[
  'ARIANA_PAY_SHADOW_ENABLED',
  'MP_3DS_SANDBOX_ENABLED',
  'MP_3DS_SANDBOX_ACCESS_TOKEN',
  'MP_3DS_SANDBOX_NOTIFICATION_URL',
  'MP_3DS_SANDBOX_BASE_URL'
];

test('rotas 3DS sandbox são admin-only e separadas do checkout',()=>{
  const {app,adminRequired}=register();
  const createHandlers=app.routes.post.get('/api/admin/ariana-pay/3ds-sandbox/orders');
  const lookupHandlers=app.routes.get.get('/api/admin/ariana-pay/3ds-sandbox/orders/:providerOrderId');

  assert.ok(createHandlers);
  assert.ok(lookupHandlers);
  assert.equal(createHandlers[0],adminRequired);
  assert.equal(lookupHandlers[0],adminRequired);
  assert.equal(app.routes.post.has('/api/payments/mp/card'),false);
  assert.equal(app.routes.post.has('/api/payments/mp/credit'),false);
});

test('shadow desligado bloqueia 3DS antes de qualquer chamada ao provider',async()=>{
  const restore=saveEnv(ENV_KEYS);
  try{
    process.env.ARIANA_PAY_SHADOW_ENABLED='false';
    let calls=0;
    const {app}=register({axios:{post:async()=>{calls+=1;}}});
    const handler=app.routes.post.get('/api/admin/ariana-pay/3ds-sandbox/orders')[1];
    const res=createResponse();

    await handler({body:{}},res);

    assert.equal(res.statusCode,404);
    assert.equal(res.body.code,'ARIANA_PAY_SHADOW_DISABLED');
    assert.equal(calls,0);
  }finally{
    restore();
  }
});

test('sandbox 3DS rejeita credencial que não é de teste sem chamar provider',async()=>{
  const restore=saveEnv(ENV_KEYS);
  try{
    process.env.ARIANA_PAY_SHADOW_ENABLED='true';
    process.env.MP_3DS_SANDBOX_ENABLED='true';
    process.env.MP_3DS_SANDBOX_ACCESS_TOKEN='LIVE-NOT-TEST';
    process.env.MP_3DS_SANDBOX_NOTIFICATION_URL='https://sandbox.example.com/webhook';

    let calls=0;
    const {app}=register({axios:{post:async()=>{calls+=1;}}});
    const handler=app.routes.post.get('/api/admin/ariana-pay/3ds-sandbox/orders')[1];
    const res=createResponse();

    await handler({
      body:{
        orderId:'sandbox-order-1',
        amount:10,
        email:'teste@example.com',
        paymentMethodId:'visa',
        cardToken:'DUMMY-CARD-TOKEN'
      }
    },res);

    assert.equal(res.body.ok,false);
    assert.match(res.body.error,/credencial de teste/i);
    assert.equal(calls,0);
  }finally{
    restore();
  }
});

test('resposta da rota 3DS nunca devolve token de cartão nem raw do provider',async()=>{
  const restore=saveEnv(ENV_KEYS);
  try{
    process.env.ARIANA_PAY_SHADOW_ENABLED='true';
    process.env.MP_3DS_SANDBOX_ENABLED='true';
    process.env.MP_3DS_SANDBOX_ACCESS_TOKEN='TEST-SAFE-DUMMY';
    process.env.MP_3DS_SANDBOX_NOTIFICATION_URL='https://sandbox.example.com/webhook';

    const axios={
      async post(){
        return {
          status:201,
          data:{
            id:'ORD-SANDBOX-1',
            external_reference:'sandbox-order-1',
            internal_provider_field:'DO_NOT_EXPOSE',
            transactions:{payments:[{id:'PAY-1',status:'processed',status_detail:'accredited'}]}
          }
        };
      }
    };

    const {app}=register({axios});
    const handler=app.routes.post.get('/api/admin/ariana-pay/3ds-sandbox/orders')[1];
    const res=createResponse();

    await handler({
      body:{
        orderId:'sandbox-order-1',
        amount:10,
        email:'teste@example.com',
        paymentMethodId:'visa',
        cardToken:'DUMMY-CARD-TOKEN'
      }
    },res);

    assert.equal(res.statusCode,201);
    assert.equal(res.body.ok,true);
    assert.equal(res.body.writesEnabled,false);
    assert.equal(res.body.checkoutChanged,false);
    assert.equal(res.body.payoutsEnabled,false);
    assert.equal('raw' in res.body,false);
    const serialized=JSON.stringify(res.body);
    assert.equal(serialized.includes('DUMMY-CARD-TOKEN'),false);
    assert.equal(serialized.includes('DO_NOT_EXPOSE'),false);
    assert.equal(serialized.includes('TEST-SAFE-DUMMY'),false);
  }finally{
    restore();
  }
});
