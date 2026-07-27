const SALES_KEY="ariana_televendas_fase1";
const $=id=>document.getElementById(id);
const labels={
  em_analise:"Cartão em análise",
  aguardando_pagamento:"PIX aguardando",
  aprovado:"Aprovado",
  recusado:"Recusado"
};
let sales=[];

function money(v){
  return Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
}
function load(){
  try{sales=JSON.parse(localStorage.getItem(SALES_KEY))||[]}catch(_){sales=[]}
}
function save(){
  localStorage.setItem(SALES_KEY,JSON.stringify(sales));
}
function toast(msg){
  const el=$("toast");
  el.textContent=msg;
  el.classList.remove("hidden");
  clearTimeout(window.__toast);
  window.__toast=setTimeout(()=>el.classList.add("hidden"),2400);
}
function paymentName(sale){
  if(sale.payment?.method==="pix")return "PIX à vista";
  if(sale.payment?.method==="card")return `Cartão • ${sale.installments}x`;
  return "Não informado";
}
function filtered(){
  const term=$("search").value.trim().toLowerCase();
  const status=$("status-filter").value;
  return sales.filter(s=>{
    const allowed=["em_analise","aguardando_pagamento","aprovado","recusado"].includes(s.status);
    const matchesStatus=status==="all"||s.status===status;
    const hay=`${s.id} ${s.client} ${s.phone}`.toLowerCase();
    return allowed&&matchesStatus&&(!term||hay.includes(term));
  });
}
function renderCounts(){
  $("count-card").textContent=sales.filter(s=>s.status==="em_analise"&&s.payment?.method==="card").length;
  $("count-pix").textContent=sales.filter(s=>s.status==="aguardando_pagamento"&&s.payment?.method==="pix").length;
  $("count-approved").textContent=sales.filter(s=>s.status==="aprovado").length;
  $("count-refused").textContent=sales.filter(s=>s.status==="recusado").length;
}
function render(){
  const rows=filtered();
  $("payments-body").innerHTML=rows.map(s=>{
    let actions=`<span>—</span>`;
    if(s.status==="em_analise"&&s.payment?.method==="card"){
      actions=`<div class="actions">
        <button class="approve" data-action="approve-card" data-id="${s.id}">Aprovar cartão</button>
        <button class="reject" data-action="reject-card" data-id="${s.id}">Recusar cartão</button>
      </div>`;
    }
    if(s.status==="aguardando_pagamento"&&s.payment?.method==="pix"){
      actions=`<div class="actions">
        <button class="confirm-pix" data-action="confirm-pix" data-id="${s.id}">Simular webhook PIX pago</button>
      </div>`;
    }

    return `<tr>
      <td><span class="order">${s.id}</span></td>
      <td class="client"><strong>${s.client}</strong><small>${s.phone||""}</small></td>
      <td>${paymentName(s)}</td>
      <td><strong>${money(s.total)}</strong></td>
      <td><span class="badge badge-${s.status}">${labels[s.status]||s.status}</span></td>
      <td>${s.updatedAt||"—"}</td>
      <td>${actions}</td>
    </tr>`;
  }).join("");

  $("empty").classList.toggle("hidden",rows.length>0);
  renderCounts();
}
function updateStatus(id,status,message,paymentPatch={}){
  const index=sales.findIndex(s=>s.id===id);
  if(index<0)return;

  const current=sales[index];
  sales[index]={
    ...current,
    status,
    updatedAt:"Agora",
    payment:{...(current.payment||{}),...paymentPatch},
    timeline:[...(current.timeline||[]),[message,"Agora"]]
  };
  save();
  render();
}
$("payments-body").addEventListener("click",e=>{
  const button=e.target.closest("[data-action]");
  if(!button)return;
  const id=button.dataset.id;
  const action=button.dataset.action;

  if(action==="approve-card"){
    updateStatus(id,"aprovado","Cartão aprovado após análise de segurança",{
      securityStatus:"approved",
      approvedAt:new Date().toISOString(),
      duplicateBlocked:true
    });
    toast("Pagamento com cartão aprovado.");
  }
  if(action==="reject-card"){
    updateStatus(id,"recusado","Cartão recusado após análise de segurança",{
      securityStatus:"rejected",
      rejectedAt:new Date().toISOString(),
      duplicateBlocked:false
    });
    toast("Pagamento com cartão recusado.");
  }
  if(action==="confirm-pix"){
    updateStatus(id,"aprovado","PIX confirmado pelo webhook do gateway",{
      pixStatus:"paid",
      approvedAt:new Date().toISOString(),
      duplicateBlocked:true
    });
    toast("PIX confirmado e pedido liberado.");
  }
});
$("search").addEventListener("input",render);
$("status-filter").addEventListener("change",render);
$("refresh").addEventListener("click",()=>{load();render();toast("Pagamentos atualizados.")});

load();
render();
