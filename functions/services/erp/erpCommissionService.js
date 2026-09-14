import mongoose from 'mongoose';

const clean=(v='',m=180)=>String(v??'').trim().slice(0,m);
const norm=v=>clean(v,180).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const money=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
const base={timestamps:true,versionKey:false,minimize:false};

const ruleSchema=new mongoose.Schema({
 sellerKey:{type:String,required:true,unique:true,index:true},
 sellerName:{type:String,required:true},
 mode:{type:String,enum:['percent','fixed_per_sale'],default:'percent'},
 value:{type:Number,default:0,min:0,max:1000000},
 active:{type:Boolean,default:true},
 updatedBy:{type:String,default:''}
},base);
const CommissionRule=mongoose.models.ErpCommissionRule||mongoose.model('ErpCommissionRule',ruleSchema);

function period(q={}){const now=new Date(),from=q.from?new Date(q.from):new Date(now.getFullYear(),now.getMonth(),1),to=q.to?new Date(q.to):new Date(now.getFullYear(),now.getMonth()+1,0,23,59,59,999);if(Number.isNaN(from.getTime())||Number.isNaN(to.getTime()))throw Object.assign(new Error('Período inválido.'),{statusCode:400});from.setHours(0,0,0,0);to.setHours(23,59,59,999);return{from,to}}
function calc(total,rule){if(!rule||rule.active===false)return 0;if(rule.mode==='fixed_per_sale')return money(rule.value);return money(Number(total||0)*Number(rule.value||0)/100)}

export function createErpCommissionService(context={}){
 const Order=context.Order||mongoose.models.Order;
 async function listRules(){return CommissionRule.find({}).sort({sellerName:1}).lean()}
 async function upsertRule(payload={},actor={}){const sellerName=clean(payload.sellerName,180);if(!sellerName)throw Object.assign(new Error('Informe o vendedor.'),{statusCode:400});const mode=['percent','fixed_per_sale'].includes(payload.mode)?payload.mode:'percent',value=Math.max(0,Number(payload.value||0));const sellerKey=norm(sellerName),updatedBy=clean(actor?.name||actor?.email||'Administrador',180);const row=await CommissionRule.findOneAndUpdate({sellerKey},{$set:{sellerName,mode,value,active:payload.active!==false,updatedBy},$setOnInsert:{sellerKey}},{upsert:true,new:true,setDefaultsOnInsert:true}).lean();return row}
 async function removeRule(sellerKey=''){const key=norm(sellerKey);if(!key)return false;const r=await CommissionRule.deleteOne({sellerKey:key});return r.deletedCount>0}
 async function report(q={}){const {from,to}=period(q),rules=await listRules(),ruleMap=new Map(rules.map(r=>[r.sellerKey,r]));const rows=[];
  const current=Order?await Order.find({origin:'erp_ariana',status:'faturado',updatedAt:{$gte:from,$lte:to}}).select('_id total updatedAt sellerName televendas.erp.sellerName televendas.erp.code').lean().limit(20000):[];
  for(const o of current){const sellerName=clean(o?.televendas?.erp?.sellerName||o?.sellerName||'Sem vendedor',180),sellerKey=norm(sellerName),total=money(o.total),rule=ruleMap.get(sellerKey);rows.push({source:'ariana',id:String(o._id),code:o?.televendas?.erp?.code||'',date:o.updatedAt,sellerName,sellerKey,total,commission:calc(total,rule),rule:rule?{mode:rule.mode,value:rule.value,active:rule.active}:null})}
  const Historical=mongoose.models.ErpSigeHistoricalSale;if(q.includeHistorical==='true'&&Historical){const hist=await Historical.find({date:{$gte:from,$lte:to}}).select('_id total date sellerName code status').lean().limit(30000);for(const s of hist){if(String(s.status||'').toLowerCase()==='canceled')continue;const sellerName=clean(s.sellerName||'Sem vendedor',180),sellerKey=norm(sellerName),total=money(s.total),rule=ruleMap.get(sellerKey);rows.push({source:'historico',id:String(s._id),code:s.code||'',date:s.date,sellerName,sellerKey,total,commission:calc(total,rule),rule:rule?{mode:rule.mode,value:rule.value,active:rule.active}:null})}}
  const map=new Map();for(const r of rows){const x=map.get(r.sellerKey)||{sellerName:r.sellerName,sellerKey:r.sellerKey,sales:0,total:0,commission:0,rule:r.rule};x.sales++;x.total+=r.total;x.commission+=r.commission;if(r.rule)x.rule=r.rule;map.set(r.sellerKey,x)}
  const sellers=[...map.values()].map(x=>({...x,total:money(x.total),commission:money(x.commission)})).sort((a,b)=>b.total-a.total);return{period:{from,to},summary:{sales:rows.length,total:money(rows.reduce((s,r)=>s+r.total,0)),commission:money(rows.reduce((s,r)=>s+r.commission,0)),sellers:sellers.length},rules,sellers,rows:rows.sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,5000)}}
 return{listRules,upsertRule,removeRule,report};
}

export default createErpCommissionService;
