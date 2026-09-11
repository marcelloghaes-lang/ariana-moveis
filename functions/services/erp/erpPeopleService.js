import mongoose from 'mongoose';

const clean=(v='',m=500)=>String(v??'').trim().slice(0,m);
const digits=(v='')=>String(v??'').replace(/\D/g,'');
const esc=(v='')=>String(v).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const normalize=(v='')=>clean(v,500).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');

function personModel(){
  const Person=mongoose.models.ErpPerson;
  if(!Person)throw Object.assign(new Error('Cadastro comercial do ERP ainda não foi inicializado.'),{statusCode:503,code:'ERP_PEOPLE_UNAVAILABLE'});
  return Person;
}
function addressText(a={}){
  return [a.street,a.number,a.neighborhood,a.city,a.state||a.stateCode].map(x=>clean(x,180)).filter(Boolean).join(', ');
}
function personRow(p={}){
  return {id:String(p._id||''),source:p.source||'',sourceId:p.sourceId||'',name:p.name||p.companyName||'',companyName:p.companyName||'',document:p.document||'',email:p.email||'',phone:p.phone||'',personType:p.personType||'',roles:Array.isArray(p.roles)?p.roles:[],address:p.address||{},addressText:addressText(p.address||{}),linkedUserId:p.linkedUserId?String(p.linkedUserId):'',active:p.active!==false};
}
function userRow(u={}){
  return {id:`user:${String(u._id||'')}`,source:'site',sourceId:String(u._id||''),name:u.name||u.email||'Cliente',companyName:'',document:digits(u.cpf),email:u.email||'',phone:digits(u.phone),personType:'Cliente do site',roles:['Cliente'],address:{city:u.city||'',stateCode:u.uf||''},addressText:[u.city,u.uf].filter(Boolean).join('/'),linkedUserId:String(u._id||''),active:u.isActive!==false};
}
function keyOf(row={}){return row.document?`doc:${digits(row.document)}`:(row.email?`mail:${String(row.email).toLowerCase()}`:(row.phone?`tel:${digits(row.phone)}`:`id:${row.id}`));}

export function createErpPeopleService(context={}){
  const {User}=context;if(!User)throw new Error('[erp-people] User não informado');
  async function list(query={}){
    const Person=personModel();const q=clean(query.q||query.search,160),limit=Math.min(200,Math.max(1,Number(query.limit||50)));
    const filter={active:{$ne:false}};
    if(q){const rx=new RegExp(esc(q),'i'),qd=digits(q);filter.$or=[{name:rx},{companyName:rx},{email:rx},{phone:rx},{document:rx}];if(qd)filter.$or.push({document:new RegExp(esc(qd),'i')},{phone:new RegExp(esc(qd),'i')});}
    const commercial=(await Person.find(filter).sort({name:1}).limit(limit).lean()).map(personRow);
    const seen=new Set(commercial.map(keyOf));const users=[];
    if(commercial.length<limit){const uf={role:'customer',isActive:{$ne:false}};if(q){const rx=new RegExp(esc(q),'i'),qd=digits(q);uf.$or=[{name:rx},{email:rx},{phone:rx},{cpf:rx}];if(qd)uf.$or.push({phone:new RegExp(esc(qd),'i')},{cpf:new RegExp(esc(qd),'i')});}const site=await User.find(uf).select('_id name email phone cpf city uf isActive').sort({name:1}).limit(limit).lean();for(const u of site){const row=userRow(u),k=keyOf(row);if(seen.has(k))continue;seen.add(k);users.push(row);if(commercial.length+users.length>=limit)break;}}
    return {people:[...commercial,...users],count:commercial.length+users.length,commercialCount:commercial.length,siteOnlyCount:users.length};
  }
  async function get(id){const Person=personModel();if(String(id).startsWith('user:')){const u=await User.findById(String(id).slice(5)).select('_id name email phone cpf city uf isActive').lean();if(!u)throw Object.assign(new Error('Cliente não encontrado.'),{statusCode:404});return userRow(u);}const p=await Person.findById(id).lean();if(!p)throw Object.assign(new Error('Cliente não encontrado.'),{statusCode:404});return personRow(p);}
  return {list,get};
}
export default createErpPeopleService;
