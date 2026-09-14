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

export function canAccess(req={},required=[]){
  const user=identity(req);
  if(isFullAdmin(user))return true;
  const perms=permissionSet(user);
  if(perms.has('*'))return true;
  const list=Array.isArray(required)?required:[required];
  if(!list.length)return true;
  return list.some(p=>perms.has(clean(p,120)));
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
    sales:{read:has('orders:read'),write:has('orders:update'),cancel:has('orders:cancel')},
    customers:{read:has('customers:read'),write:has('customers:update')},
    products:{read:has('products:read'),write:has('products:update')},
    finance:{read:has('finance:read','payments:read'),receive:has('payments:receive'),settings:has('settings:update')},
    reports:{read:has('reports:read','finance:reports')},
    settings:{read:has('settings:read'),write:has('settings:update')}
  };
}

export default requireErpPermission;
