const STORAGE_KEY="ariana_televendas_fase1";
const seedSales=[];
const statusLabels={
  rascunho:"Rascunho",
  link_gerado:"Link gerado",
  cliente_acessou:"Cliente acessou",
  aguardando_pagamento:"PIX aguardando",
  em_analise:"Cartão em análise",
  aprovado:"Aprovado",
  recusado:"Recusado",
  cancelado:"Cancelado"
};
let sales=loadSales(),selectedSale=null;
function loadSales(){try{const stored=JSON.parse(localStorage.getItem(STORAGE_KEY));if(Array.isArray(stored))return stored}catch(_){}return [...seedSales]}
function money(v){return Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}
function renderCounts(){
  document.getElementById("count-link").textContent=sales.filter(s=>["link_gerado","cliente_acessou"].includes(s.status)).length;
  document.getElementById("count-analysis").textContent=sales.filter(s=>["em_analise","aguardando_pagamento"].includes(s.status)).length;
  document.getElementById("count-approved").textContent=sales.filter(s=>s.status==="aprovado").length;
  document.getElementById("count-refused").textContent=sales.filter(s=>s.status==="recusado").length
}
function getFilteredSales(){
  const term=document.getElementById("search-input").value.trim().toLowerCase();
  const status=document.getElementById("status-filter").value;
  return sales.filter(s=>{
    const okStatus=status==="all"||s.status===status;
    const hay=`${s.id} ${s.client} ${s.phone} ${s.operator}`.toLowerCase();
    return okStatus&&(!term||hay.includes(term))
  })
}
function renderTable(){
  const tbody=document.getElementById("sales-table-body"),empty=document.getElementById("empty-state"),rows=getFilteredSales();
  tbody.innerHTML=rows.map(s=>`<tr>
    <td><span class="order-code">${s.id}</span></td>
    <td class="client-cell"><strong>${s.client}</strong><span>${s.phone||""}</span></td>
    <td>${s.operator||"—"}</td>
    <td><strong>${money(s.total)}</strong></td>
    <td>${s.payment?.method==="pix"?"PIX à vista":`${s.installments||1}x de ${money(s.installmentValue||s.total)}`}</td>
    <td><span class="status-badge status-${s.status}">${statusLabels[s.status]||s.status}</span></td>
    <td>${s.updatedAt||"—"}</td>
    <td><button class="action-button" data-open-sale="${s.id}">Ver detalhes</button></td>
  </tr>`).join("");
  empty.classList.toggle("hidden",rows.length>0)
}
function openSale(id){
  selectedSale=sales.find(s=>s.id===id);if(!selectedSale)return;
  document.getElementById("modal-order").textContent=selectedSale.id;
  document.getElementById("modal-client").textContent=selectedSale.client;
  document.getElementById("modal-phone").textContent=selectedSale.phone||"";
  document.getElementById("modal-operator").textContent=selectedSale.operator||"—";
  document.getElementById("modal-created").textContent=`Criada em ${selectedSale.createdAt||"—"}`;
  document.getElementById("modal-total").textContent=money(selectedSale.total);
  document.getElementById("modal-installments").textContent=selectedSale.payment?.method==="pix"?"PIX à vista":`${selectedSale.installments||1}x de ${money(selectedSale.installmentValue||selectedSale.total)}`;
  document.getElementById("modal-link").textContent=selectedSale.paymentLink||"";
  const badge=document.getElementById("modal-status");
  badge.className=`status-badge status-${selectedSale.status}`;
  badge.textContent=statusLabels[selectedSale.status]||selectedSale.status;
  document.getElementById("modal-timeline").innerHTML=(selectedSale.timeline||[]).map(i=>`<div class="timeline-item"><strong>${i[0]}</strong><small>${i[1]}</small></div>`).join("");
  document.getElementById("sale-modal").classList.remove("hidden")
}
function closeModal(){document.getElementById("sale-modal").classList.add("hidden")}
function toast(msg){const el=document.getElementById("toast");el.textContent=msg;el.classList.remove("hidden");clearTimeout(window.__toastTimer);window.__toastTimer=setTimeout(()=>el.classList.add("hidden"),2400)}
document.getElementById("sales-table-body").addEventListener("click",e=>{const b=e.target.closest("[data-open-sale]");if(b)openSale(b.dataset.openSale)});
document.getElementById("search-input").addEventListener("input",renderTable);
document.getElementById("status-filter").addEventListener("change",renderTable);
document.querySelectorAll(".nav-item[data-status]").forEach(b=>b.addEventListener("click",()=>{document.querySelectorAll(".nav-item").forEach(i=>i.classList.remove("active"));b.classList.add("active");document.getElementById("status-filter").value=b.dataset.status;renderTable()}));
document.getElementById("modal-close").addEventListener("click",closeModal);
document.getElementById("sale-modal").addEventListener("click",e=>{if(e.target.id==="sale-modal")closeModal()});
document.getElementById("btn-copy-link").addEventListener("click",async()=>{if(!selectedSale)return;try{await navigator.clipboard.writeText(selectedSale.paymentLink);toast("Link copiado com sucesso.")}catch(_){toast("Não foi possível copiar automaticamente.")}});
document.getElementById("btn-whatsapp").addEventListener("click",()=>{if(!selectedSale)return;const phone=(selectedSale.phone||"").replace(/\D/g,"");const text=encodeURIComponent(`Olá, ${selectedSale.client}! Segue o link de pagamento da sua compra na Ariana Móveis:\n${selectedSale.paymentLink}`);window.open(`https://wa.me/55${phone}?text=${text}`,"_blank","noopener")});
document.getElementById("btn-refresh").addEventListener("click",()=>{sales=loadSales();renderCounts();renderTable();toast("Painel atualizado.")});
document.getElementById("btn-new-sale").addEventListener("click",()=>{window.location.href="televendas_nova_venda.html"});
renderCounts();renderTable();
