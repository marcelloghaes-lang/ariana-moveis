const clean=(v='',m=180)=>String(v??'').trim().slice(0,m);

function identity(req={}){
  return req.adminUser||req.admin||req.auth||req.user||{};
}

function isFullAdmin(user={}){
  const role=clean(user.role,40).toLowerCase();
  return role==='admin'||user.admin===true||user.isSuperAdmin===true;
}

function permissionSet(user={}){
  return new Set(Array.isArray(user.permissions)?user.permissions.map(x=>clean(x,120)).filter(Boolean):[]);
}

function normalizePath(req={}){
  let value=String(req.path||req.originalUrl||req.url||'').split('?')[0].replace(/\/+$/,'')||'/';
  if(value.startsWith('/api/'))value=value.slice(4);
  return value;
}

function requirement(any=[],label='esta área do ERP'){
  return {mapped:true,any:Array.isArray(any)?any:[any],label};
}

export function canAccess(req={},required=[]){
  const user=identity(req);
  if(isFullAdmin(user))return true;
  const perms=permissionSet(user);
  if(perms.has('*'))return true;
  const list=(Array.isArray(required)?required:[required]).map(p=>clean(p,120)).filter(Boolean);
  if(!list.length)return true;
  return list.some(p=>perms.has(p));
}

export function resolveErpRequirement(req={}){
  const method=String(req.method||'GET').toUpperCase();
  const path=normalizePath(req);
  const read=method==='GET'||method==='HEAD';

  if(path==='/erp/acesso'&&read)return requirement([],'consultar o próprio acesso ao ERP');
  if(path==='/erp/dashboard'&&read)return requirement(['dashboard:read'],'consultar o painel do ERP');

  if(path==='/erp/products'&&read)return requirement(['products:read'],'consultar produtos');
  if(path==='/erp/catalog/products'&&read)return requirement(['products:read'],'consultar o catálogo');
  if(path==='/erp/catalog/products'&&method==='POST')return requirement(['products:create'],'cadastrar produtos');
  if(/^\/erp\/catalog\/products\/[^/]+$/.test(path)&&read)return requirement(['products:read'],'consultar produtos');
  if(/^\/erp\/catalog\/products\/[^/]+$/.test(path)&&(method==='PUT'||method==='PATCH'))return requirement(['products:update'],'alterar produtos');

  if(path==='/erp/people'&&read)return requirement(['customers:read'],'consultar clientes');
  if(path==='/erp/people'&&method==='POST')return requirement(['customers:update'],'cadastrar clientes');
  if(/^\/erp\/people\/[^/]+$/.test(path)&&read)return requirement(['customers:read'],'consultar clientes');
  if(/^\/erp\/people\/[^/]+$/.test(path)&&(method==='PUT'||method==='PATCH'))return requirement(['customers:update'],'alterar clientes');

  if(path==='/erp/finance-panel/clientes'&&read)return requirement(['customers:read','finance:read','payments:read'],'consultar clientes no painel financeiro');
  if(/^\/erp\/finance-panel\/(lancamentos|inadimplentes|dashboard)$/.test(path)&&read)return requirement(['finance:read','payments:read'],'consultar o painel financeiro');
  if(/^\/erp\/finance-panel\/lancamentos\/[^/]+\/[^/]+\/pagamentos$/.test(path)&&method==='POST')return requirement(['payments:receive'],'registrar pagamentos pelo painel financeiro');

  if(/^\/erp\/orders\/[^/]+\/receivables\/[^/]+\/receive$/.test(path)&&method==='POST')return requirement(['payments:receive'],'receber parcelas');
  if(/^\/erp\/orders\/[^/]+\/receivables\/[^/]+$/.test(path)&&(method==='PUT'||method==='PATCH'))return requirement(['payments:receive'],'alterar recebíveis');
  if(/^\/erp\/orders\/[^/]+\/sige-fields$/.test(path)&&(method==='PUT'||method==='PATCH'))return requirement(['orders:update'],'alterar dados da venda');
  if(/^\/erp\/orders\/[^/]+\/faturar$/.test(path)&&method==='POST')return requirement(['orders:update'],'faturar vendas');
  if(/^\/erp\/orders\/[^/]+\/(estornar|cancelar)$/.test(path)&&method==='POST')return requirement(['orders:cancel'],'estornar ou cancelar vendas');
  if(path==='/erp/orders'&&read)return requirement(['orders:read'],'consultar vendas');
  if(path==='/erp/comprovante/emitente'&&read)return requirement(['orders:read'],'imprimir comprovantes de venda');
  if(path==='/erp/orders'&&method==='POST')return requirement(['orders:update'],'criar vendas');
  if(/^\/erp\/orders\/[^/]+$/.test(path)&&read)return requirement(['orders:read'],'consultar vendas');
  if(/^\/erp\/orders\/[^/]+$/.test(path)&&(method==='PUT'||method==='PATCH'))return requirement(['orders:update'],'alterar vendas');

  if(path==='/erp/fiscal/nfe/preflight'&&method==='POST')return requirement(['fiscal:nfe:emit'],'validar a NF-e');
  if(path==='/erp/fiscal/nfe/emitir-e-faturar'&&method==='POST')return requirement(['fiscal:nfe:emit'],'emitir nota fiscal');
  if(path==='/erp/fiscal/nfe/devolucao/preflight'&&method==='POST')return requirement(['fiscal:nfe:emit'],'validar NF-e de devolução');
  if(path==='/erp/fiscal/nfe/devolucao/emitir'&&method==='POST')return requirement(['fiscal:nfe:emit'],'emitir NF-e de devolução');

  if(path==='/erp/caixa'&&read)return requirement(['finance:read','payments:read'],'consultar o caixa');
  if(path==='/erp/caixa/historico'&&read)return requirement(['finance:read','payments:read'],'consultar o histórico do caixa');
  if(/^\/erp\/caixa\/(abrir|reforco|sangria|fechar)$/.test(path)&&method==='POST')return requirement(['payments:receive'],'movimentar o caixa');

  if(path==='/erp/configuracoes'&&read)return requirement(['settings:read','settings:update'],'consultar configurações');
  if(path==='/erp/configuracoes'&&(method==='PUT'||method==='PATCH'))return requirement(['settings:update'],'alterar configurações');

  if(/^\/erp\/migracao\/sige\/compras\/(status|[^/]+)$/.test(path)&&read)return requirement(['finance:read','reports:read','orders:read'],'consultar dados históricos de compras');
  if(path==='/erp/migracao/sige/compras/sincronizar'&&method==='POST')return requirement(['settings:update'],'sincronizar dados históricos do SIGE');

  if(path==='/erp/financeiro'&&read)return requirement(['finance:read','payments:read'],'consultar o financeiro');
  if(path==='/erp/financeiro/completo'&&read)return requirement(['finance:read','finance:reports','reports:read'],'consultar o financeiro completo');
  if(path==='/erp/financeiro/categorias'&&read)return requirement(['finance:read','payments:read','settings:read'],'consultar categorias financeiras');
  if(path==='/erp/financeiro/categorias'&&method==='POST')return requirement(['settings:update'],'cadastrar categorias financeiras');
  if(/^\/erp\/financeiro\/categorias\/[^/]+$/.test(path)&&(method==='PUT'||method==='PATCH'))return requirement(['settings:update'],'alterar categorias financeiras');
  if(path==='/erp/financeiro/contas-bancarias'&&read)return requirement(['finance:read','payments:read','settings:read'],'consultar contas bancárias');
  if(path==='/erp/financeiro/contas-bancarias'&&method==='POST')return requirement(['settings:update'],'cadastrar contas bancárias');
  if(/^\/erp\/financeiro\/contas-bancarias\/[^/]+$/.test(path)&&(method==='PUT'||method==='PATCH'))return requirement(['settings:update'],'alterar contas bancárias');
  if(path==='/erp/financeiro/lancamentos'&&read)return requirement(['finance:read','payments:read'],'consultar lançamentos financeiros');
  if(path==='/erp/financeiro/pagamentos'&&read)return requirement(['payments:read','finance:read'],'consultar pagamentos');
  if(/^\/erp\/financeiro\/(contas-receber|contas-pagar)$/.test(path)&&method==='POST')return requirement(['payments:receive'],'criar lançamentos financeiros');
  if(/^\/erp\/financeiro\/lancamentos\/[^/]+\/quitar$/.test(path)&&method==='POST')return requirement(['payments:receive'],'quitar lançamentos');
  if(/^\/erp\/financeiro\/comprovantes\/[^/]+\/telefone-enviar$/.test(path)&&method==='POST')return requirement(['payments:receive'],'salvar WhatsApp e enviar comprovante');
  if(/^\/erp\/financeiro\/lancamentos\/[^/]+\/pagamentos\/[^/]+\/conciliacao$/.test(path)&&(method==='PUT'||method==='PATCH'))return requirement(['payments:receive'],'conciliar pagamentos');
  if(/^\/erp\/financeiro\/lancamentos\/[^/]+\/(reabrir|cancelar)$/.test(path)&&method==='POST')return requirement(['payments:cancel'],'reabrir ou cancelar lançamentos');
  if(/^\/erp\/financeiro\/lancamentos\/[^/]+$/.test(path)&&(method==='PUT'||method==='PATCH'))return requirement(['payments:receive'],'alterar lançamentos financeiros');
  if(/^\/erp\/financeiro\/recebimentos\/(quitar-selecionados|distribuir-cliente)$/.test(path)&&method==='POST')return requirement(['payments:receive'],'processar recebimentos');

  if(path==='/erp/estoque/movimentacoes'&&read)return requirement(['products:read'],'consultar movimentações de estoque');
  if(/^\/erp\/estoque\/[^/]+\/movimentacoes$/.test(path)&&method==='POST')return requirement(['products:update'],'movimentar estoque');

  if(path==='/erp/relatorios/financeiro'&&read)return requirement(['finance:reports','reports:read'],'consultar relatórios financeiros');
  if(path==='/erp/relatorios/inadimplentes'&&read)return requirement(['finance:read','payments:read','finance:reports','reports:read'],'consultar inadimplentes');
  if(/^\/erp\/relatorios\/inadimplentes\/cobranca\/[^/]+\/preview$/.test(path)&&read)return requirement(['finance:read','payments:read'],'preparar cobrança de cliente inadimplente');
  if(/^\/erp\/relatorios\/inadimplentes\/cobranca\/[^/]+\/contato$/.test(path)&&method==='POST')return requirement(['customers:update','payments:receive'],'atualizar o WhatsApp do cliente durante a cobrança');
  if(/^\/erp\/relatorios\/inadimplentes\/cobranca\/[^/]+\/enviar$/.test(path)&&method==='POST')return requirement(['payments:receive','finance:read'],'enviar cobrança de cliente inadimplente');
  if(path==='/erp/relatorios/inadimplentes/pdf'&&read)return requirement(['finance:read','payments:read','finance:reports','reports:read'],'baixar relatório de inadimplentes');
  if(path==='/erp/relatorios/vendas'&&read)return requirement(['reports:read','orders:read'],'consultar relatórios de vendas');
  if(path==='/erp/relatorios/vendas-completo'&&read)return requirement(['reports:read','orders:read'],'consultar relatórios completos de vendas');
  if(path==='/erp/relatorios/estoque'&&read)return requirement(['reports:read','products:read'],'consultar relatórios de estoque');

  return {mapped:false,any:[],label:'esta rota do ERP'};
}

export function requireErpPermission(required=[],label='esta área do ERP'){
  return (req,res,next)=>{
    if(canAccess(req,required))return next();
    return res.status(403).json({
      ok:false,
      error:`Seu usuário não possui permissão para ${label}.`,
      code:'ERP_PERMISSION_DENIED',
      required:Array.isArray(required)?required:[required]
    });
  };
}

export function erpAccessSummary(req={}){
  const user=identity(req),admin=isFullAdmin(user),perms=permissionSet(user);
  const has=(...p)=>admin||perms.has('*')||p.some(x=>perms.has(x));
  return{
    admin,
    role:clean(user.role,40)||'staff',
    modules:{
      dashboard:{read:has('dashboard:read')},
      sales:{read:has('orders:read'),write:has('orders:update'),cancel:has('orders:cancel')},
      customers:{read:has('customers:read'),write:has('customers:update')},
      products:{read:has('products:read'),create:has('products:create'),write:has('products:update')},
      finance:{read:has('finance:read','payments:read'),receive:has('payments:receive'),cancel:has('payments:cancel')},
      fiscal:{emitNfe:has('fiscal:nfe:emit')},
      reports:{read:has('reports:read','finance:reports')},
      settings:{read:has('settings:read'),write:has('settings:update')}
    },
    restricted:{fiscal:!has('fiscal:nfe:emit'),sigeMigration:true,televendasAdmin:true}
  };
}

export function createErpOperationalRequired(adminRequired){
  if(typeof adminRequired!=='function')throw new Error('[erp-access] adminRequired não informado');

  return function erpOperationalRequired(req,res,next){
    const originalUrl=req.url;
    let restored=false;
    const restore=()=>{
      if(restored)return;
      restored=true;
      req.url=originalUrl;
      res.off?.('finish',restore);
      res.off?.('close',restore);
    };

    res.once?.('finish',restore);
    res.once?.('close',restore);

    // O adminRequired já valida assinatura JWT, sessão, tokenVersion,
    // usuário ativo e identidade. Usamos a rota administrativa de identidade
    // apenas durante essa validação para adiar a decisão de permissão ao mapa
    // específico do ERP abaixo. A URL real é restaurada antes do handler.
    req.url='/api/admin/me';

    try{
      const maybePromise=adminRequired(req,res,(error)=>{
        restore();
        if(error)return next(error);

        const user=identity(req);
        if(isFullAdmin(user))return next();

        const rule=resolveErpRequirement(req);
        if(rule.mapped&&canAccess(req,rule.any))return next();

        return res.status(403).json({
          ok:false,
          error:rule.mapped
            ?`Seu usuário não possui permissão para ${rule.label}.`
            :'Esta rota do ERP não está liberada para colaboradores.',
          code:'ERP_PERMISSION_DENIED',
          required:rule.any,
          path:normalizePath(req),
          method:String(req.method||'GET').toUpperCase()
        });
      });

      if(maybePromise&&typeof maybePromise.catch==='function'){
        maybePromise.catch((error)=>{
          restore();
          if(!res.headersSent)return next(error);
        });
      }
      return maybePromise;
    }catch(error){
      restore();
      return next(error);
    }
  };
}

export default requireErpPermission;
