import mongoose from 'mongoose';

const base={timestamps:true,versionKey:false,minimize:false};
const clean=(v='',m=500)=>String(v??'').trim().slice(0,m);
const money=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
const num=v=>Number(String(v??'').replace(',','.'));
function fail(message,statusCode=400,code='ERP_MG_ST_ERROR'){const e=new Error(message);e.statusCode=statusCode;e.code=code;return e}

const schema=new mongoose.Schema({
  key:{type:String,default:'default',unique:true,index:true},
  quantitativeMode:{type:String,enum:['unknown','non_definitive','definitive'],default:'unknown',index:true},
  specialRegimeStatus:{type:String,enum:['not_requested','preparing','requested','provisional','granted','denied','expired'],default:'not_requested',index:true},
  specialRegimeType:{type:String,default:'ecommerce_st_responsibility'},
  ptaNumber:{type:String,default:''},
  effectiveFrom:{type:Date,default:null},
  effectiveTo:{type:Date,default:null},
  specialMethodNotes:{type:String,default:''},
  checklist:{
    stateRegistrationActive:{type:Boolean,default:false},
    efdUpToDate:{type:Boolean,default:false},
    destdaOrDapiUpToDate:{type:Boolean,default:false},
    stateDebtCertificateOk:{type:Boolean,default:false},
    cadinCafimpOk:{type:Boolean,default:false},
    criminalDeclarationsReady:{type:Boolean,default:false}
  },
  notes:{type:String,default:''},
  updatedBy:{type:String,default:''},
  verifiedAt:{type:Date,default:null},
  verifiedBy:{type:String,default:''}
},base);
const Model=mongoose.models.ErpMgStControl||mongoose.model('ErpMgStControl',schema);

const OFFICIAL={
  jurisdiction:'MG',
  reviewedAt:'2026-10-02',
  ricmsAnnexVII:'https://www.fazenda.mg.gov.br/empresas/legislacao_tributaria/ricms_2023_seco/anexovii2023_2.html',
  restitution:'https://www.fazenda.mg.gov.br/empresas/restituicao/icms_st.html',
  specialRegime:'https://www.fazenda.mg.gov.br/empresas/legislacao_tributaria/regime_especial/',
  ecommerceList:'https://www.fazenda.mg.gov.br/empresas/legislacao_tributaria/regime_especial/e_commerce_atribuicao_de_responsabilidade.html',
  siareManual:'https://www.fazenda.mg.gov.br/empresas/legislacao_tributaria/regime_especial/manual_regime_especial_contribuinte.pdf'
};

function publicRow(x){
  const raw=x?.toObject?x.toObject():x||{};
  return{
    quantitativeMode:raw.quantitativeMode||'unknown',
    specialRegimeStatus:raw.specialRegimeStatus||'not_requested',
    specialRegimeType:raw.specialRegimeType||'ecommerce_st_responsibility',
    ptaNumber:raw.ptaNumber||'',
    effectiveFrom:raw.effectiveFrom||null,
    effectiveTo:raw.effectiveTo||null,
    specialMethodNotes:raw.specialMethodNotes||'',
    checklist:raw.checklist||{},
    notes:raw.notes||'',
    updatedAt:raw.updatedAt||null,
    updatedBy:raw.updatedBy||'',
    verifiedAt:raw.verifiedAt||null,
    verifiedBy:raw.verifiedBy||'',
    officialSources:OFFICIAL
  };
}

function readiness(row){
  const c=row.checklist||{};
  const required=[
    ['stateRegistrationActive','IE ativa'],
    ['efdUpToDate','EFD em dia'],
    ['destdaOrDapiUpToDate','DeSTDA/DAPI em dia, conforme regime'],
    ['stateDebtCertificateOk','Certidão estadual regular'],
    ['cadinCafimpOk','CADIN/CAFIMP regular'],
    ['criminalDeclarationsReady','Declarações exigidas pelo RPTA prontas']
  ];
  const missing=required.filter(([k])=>c[k]!==true).map(([,label])=>label);
  return{readyForDraft:missing.length===0,missing};
}

export function createErpMgStControlService(){
  async function row(){
    return Model.findOneAndUpdate({key:'default'},{$setOnInsert:{key:'default'}},{upsert:true,new:true,setDefaultsOnInsert:true});
  }
  async function get(){
    const x=publicRow(await row());
    return{...x,readiness:readiness(x)};
  }
  async function update(payload={},actor={}){
    const allowedMode=['unknown','non_definitive','definitive'];
    const allowedStatus=['not_requested','preparing','requested','provisional','granted','denied','expired'];
    const current=await row();
    const quantitativeMode=allowedMode.includes(clean(payload.quantitativeMode,40))?clean(payload.quantitativeMode,40):current.quantitativeMode;
    const specialRegimeStatus=allowedStatus.includes(clean(payload.specialRegimeStatus,40))?clean(payload.specialRegimeStatus,40):current.specialRegimeStatus;
    const ptaNumber=clean(payload.ptaNumber??current.ptaNumber,80);
    if(['requested','provisional','granted'].includes(specialRegimeStatus)&&!ptaNumber)throw fail('Informe o número do PTA/e-PTA para registrar regime solicitado, provisório ou concedido.');
    const checklist={...(current.checklist?.toObject?current.checklist.toObject():current.checklist||{})};
    for(const k of ['stateRegistrationActive','efdUpToDate','destdaOrDapiUpToDate','stateDebtCertificateOk','cadinCafimpOk','criminalDeclarationsReady']){
      if(payload.checklist&&payload.checklist[k]!==undefined)checklist[k]=payload.checklist[k]===true;
    }
    const who=clean(actor.name||actor.nome||actor.email||'Administrador',180);
    const set={
      quantitativeMode,
      specialRegimeStatus,
      specialRegimeType:'ecommerce_st_responsibility',
      ptaNumber,
      effectiveFrom:payload.effectiveFrom?new Date(payload.effectiveFrom):null,
      effectiveTo:payload.effectiveTo?new Date(payload.effectiveTo):null,
      specialMethodNotes:clean(payload.specialMethodNotes??current.specialMethodNotes,3000),
      checklist,
      notes:clean(payload.notes??current.notes,3000),
      updatedBy:who
    };
    if(payload.markVerified===true){set.verifiedAt=new Date();set.verifiedBy=who}
    const saved=await Model.findOneAndUpdate({key:'default'},{$set:set,$setOnInsert:{key:'default'}},{upsert:true,new:true});
    return get();
  }
  async function simulate(payload={}){
    const cfg=await get();
    const presumedBase=Math.max(0,num(payload.presumedBase)||0);
    const saleValue=Math.max(0,num(payload.saleValue)||0);
    const icmsStPaid=Math.max(0,num(payload.icmsStPaid)||0);
    const internalRate=Math.max(0,num(payload.internalRate)||0);
    const femRate=Math.max(0,num(payload.femRate)||0);
    if(!presumedBase||!saleValue||!internalRate)throw fail('Informe base presumida de ST, valor efetivo da venda e alíquota interna.');
    if(cfg.quantitativeMode==='unknown'){
      return{status:'blocked',reason:'A situação de definitividade da base de cálculo ainda não foi confirmada no SIARE. Não use esta simulação para lançamento fiscal.',config:cfg};
    }
    if(cfg.quantitativeMode==='definitive'){
      return{status:'definitive',reason:'Com opção pela definitividade do art. 52, não há restituição nem complementação pelo aspecto quantitativo enquanto a opção produzir efeitos.',refund:0,complement:0,config:cfg};
    }
    if(['granted','provisional'].includes(cfg.specialRegimeStatus)){
      return{status:'special_regime_review',reason:'Há regime especial/provisório registrado. O cálculo final deve seguir exatamente o método e as condições do PTA; esta tela não sobrepõe o regime especial.',refund:null,complement:null,config:cfg};
    }
    const diff=money(presumedBase-saleValue);
    if(diff>0){
      const gross=money(diff*(internalRate/100));
      const refund=money(icmsStPaid>0?Math.min(gross,icmsStPaid):gross);
      const fem=money(diff*(femRate/100));
      return{status:'potential_refund',basisDifference:diff,refund,fem,limitApplied:icmsStPaid>0&&gross>icmsStPaid,legalReference:'RICMS/MG Anexo VII, arts. 46 a 49',config:cfg};
    }
    if(diff<0){
      const base=money(Math.abs(diff)),complement=money(base*(internalRate/100)),fem=money(base*(femRate/100));
      return{status:'potential_complement',basisDifference:money(-base),complement,fem,legalReference:'RICMS/MG Anexo VII, arts. 44, 45 e 49',config:cfg};
    }
    return{status:'balanced',basisDifference:0,refund:0,complement:0,fem:0,config:cfg};
  }
  return{get,update,simulate};
}

export default createErpMgStControlService;
