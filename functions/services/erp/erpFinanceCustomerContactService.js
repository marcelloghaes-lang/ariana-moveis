import mongoose from 'mongoose';

const digits=(v='')=>String(v??'').replace(/\D/g,'');
const clean=(v='',m=500)=>String(v??'').trim().slice(0,m);
const esc=v=>String(v||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

function parseReference(value=''){
  const raw=clean(value,180);
  let m=raw.match(/^ERP_([a-f0-9]{24})_(\d+)$/i);
  if(m)return{type:'order',orderId:m[1],number:Number(m[2])};
  m=raw.match(/^LEDGER_([a-f0-9]{24})$/i);
  if(m)return{type:'ledger',entryId:m[1]};
  return null;
}

export function createErpFinanceCustomerContactService(context={}){
  const {Order,User,CrediarioCliente,normalizePhone}=context;
  if(!Order)throw new Error('[erp-finance-contact] Order não informado');
  const phoneOf=value=>typeof normalizePhone==='function'?normalizePhone(value,'55'):(()=>{let n=digits(value);if(!n)return'';if((n.length===10||n.length===11)&&!n.startsWith('55'))n='55'+n;return n})();

  async function findPerson({cpf='',name=''}={}){
    const Person=mongoose.models.ErpPerson;
    if(!Person)return null;
    const doc=digits(cpf);
    if(doc){const byDoc=await Person.findOne({document:doc});if(byDoc)return byDoc;}
    const n=clean(name,220);
    if(n){
      const rx=new RegExp('^'+esc(n)+'$','i');
      return Person.findOne({active:{$ne:false},$or:[{name:rx},{companyName:rx}]});
    }
    return null;
  }

  async function resolveContact({cpf='',name='',referenceRaw=''}={}){
    let customerName=clean(name,220),customerCpf=digits(cpf),customerPhone='';
    const reference=parseReference(referenceRaw);
    if(reference?.type==='order'){
      const order=await Order.findOne({_id:reference.orderId,origin:'erp_ariana'}).lean();
      if(order){customerName=customerName||clean(order.customerName,220);customerCpf=customerCpf||digits(order.customerCpf);customerPhone=phoneOf(order.customerPhone||'');}
    }else if(reference?.type==='ledger'){
      const Entry=mongoose.models.ErpFinancialEntry;
      const entry=Entry?await Entry.findById(reference.entryId).lean():null;
      if(entry){customerName=customerName||clean(entry.personName,220);customerCpf=customerCpf||digits(entry.personDocument);customerPhone=phoneOf(entry.personPhone||'');}
    }
    const person=await findPerson({cpf:customerCpf,name:customerName});
    if(!customerPhone&&person?.phone)customerPhone=phoneOf(person.phone);
    let local=null;
    if(!customerPhone&&CrediarioCliente){
      if(customerCpf)local=await CrediarioCliente.findOne({cpf:customerCpf}).lean();
      if(!local&&customerName){const rx=new RegExp('^'+esc(customerName)+'$','i');local=await CrediarioCliente.findOne({nome:rx}).lean();}
      if(local?.telefone)customerPhone=phoneOf(local.telefone);
    }
    return{customerName,customerCpf,customerPhone,personId:person?String(person._id):'',reference};
  }

  async function savePhone({phone='',cpf='',name='',referenceRaw='',receipt=null,actor={}}={}){
    const normalized=phoneOf(phone);
    const localDigits=digits(normalized);
    if(!normalized||localDigits.length<12||localDigits.length>15){const e=new Error('Informe um telefone/WhatsApp válido com DDD.');e.statusCode=400;throw e;}
    const resolved=await resolveContact({cpf,name,referenceRaw});
    const customerName=resolved.customerName||clean(name,220)||'Cliente';
    const customerCpf=resolved.customerCpf||digits(cpf);
    const Person=mongoose.models.ErpPerson;
    let person=await findPerson({cpf:customerCpf,name:customerName});
    if(Person){
      if(person){
        person.phone=digits(normalized);person.active=true;
        person.metadata={...(person.metadata||{}),phoneUpdatedBy:clean(actor.email||actor.name||'Ariana Financeiro',180),phoneUpdatedIn:'ariana_financeiro',phoneUpdatedAt:new Date()};
        await person.save();
      }else{
        person=await Person.create({name:customerName,document:customerCpf,phone:digits(normalized),personType:customerCpf.length===14?'Pessoa Jurídica':'Pessoa Física',roles:['Cliente'],active:true,source:'manual',sourceId:'financeiro_'+new mongoose.Types.ObjectId(),metadata:{createdBy:clean(actor.email||actor.name||'Ariana Financeiro',180),createdIn:'ariana_financeiro',createdFromPaymentPhonePrompt:true}});
      }
      if(person?.linkedUserId&&User)await User.updateOne({_id:person.linkedUserId},{$set:{phone:digits(normalized)}}).catch(()=>null);
    }

    let local=null;
    if(CrediarioCliente){
      if(customerCpf)local=await CrediarioCliente.findOne({cpf:customerCpf});
      if(!local&&customerName){const rx=new RegExp('^'+esc(customerName)+'$','i');local=await CrediarioCliente.findOne({nome:rx});}
      if(local){local.nome=customerName;if(customerCpf)local.cpf=customerCpf;local.telefone=normalized;local.ativo=true;await local.save();}
      else local=await CrediarioCliente.create({nome:customerName,cpf:customerCpf,telefone:normalized,ativo:true});
    }

    const reference=parseReference(referenceRaw);
    if(reference?.type==='order')await Order.updateOne({_id:reference.orderId,origin:'erp_ariana'},{$set:{customerPhone:digits(normalized)}}).catch(()=>null);
    if(reference?.type==='ledger'){const Entry=mongoose.models.ErpFinancialEntry;if(Entry)await Entry.updateOne({_id:reference.entryId},{$set:{personPhone:digits(normalized)}}).catch(()=>null);}

    if(receipt){receipt.telefone=normalized;if(local?._id)receipt.clienteId=local._id;await receipt.save();}
    return{phone:normalized,personId:person?String(person._id):'',clientId:local?String(local._id):'',customerName,customerCpf};
  }

  return{resolveContact,savePhone,parseReference};
}

export default createErpFinanceCustomerContactService;