import { createErpSettingsService } from './erpSettingsService.js';

const clean=(value='',max=180)=>String(value??'').trim().slice(0,max);

function isCreateOrder(req={}){
  return String(req.method||'').toUpperCase()==='POST' && String(req.path||'').replace(/\/+$/,'')==='/erp/orders';
}

function billingOrderId(req={}){
  if(String(req.method||'').toUpperCase()!=='POST')return'';
  const match=String(req.path||'').match(/^\/erp\/orders\/([^/]+)\/faturar\/?$/);
  return match?decodeURIComponent(match[1]):'';
}

export function createErpPdvRulesMiddleware(context={},authRequired){
  const settings=createErpSettingsService(context);
  const Order=context.Order;

  return function erpPdvRules(req,res,next){
    const create=isCreateOrder(req),orderId=billingOrderId(req);
    if(!create&&!orderId)return next();

    const run=async()=>{
      try{
        if(create){
          req.body=await settings.applySaleDefaults(req.body||{});
          return next();
        }

        const cfg=await settings.get();
        if(cfg.sales?.requireReviewBeforeBilling!==false){
          return res.status(409).json({
            ok:false,
            error:'Esta venda precisa passar pela revisão da NF-e antes do faturamento.',
            code:'ERP_REVIEW_REQUIRED',
            orderId,
            reviewUrl:`/erp_preparar_nfe.html?id=${encodeURIComponent(orderId)}`
          });
        }

        if(Order){
          let order=null;
          try{order=await Order.findById(orderId)}catch{}
          if(!order)order=await Order.findOne({origin:'erp_ariana','televendas.erp.code':clean(orderId,120)});
          if(order)await settings.assertSaleAllowed({customerCpf:order.customerCpf,customer:{document:order.customerCpf}});
        }

        req.body={...(req.body||{}),requireCash:await settings.requireOpenCashForBilling()};
        return next();
      }catch(error){
        return res.status(Number(error?.statusCode||500)).json({
          ok:false,
          error:error?.message||'Não foi possível validar as regras do PDV.',
          code:error?.code||'ERP_PDV_RULE_ERROR',
          details:error?.details||undefined
        });
      }
    };

    if(typeof authRequired!=='function')return run();
    return authRequired(req,res,(error)=>error?next(error):run());
  };
}

export default createErpPdvRulesMiddleware;
