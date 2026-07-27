(() => {
"use strict";
const $=id=>document.getElementById(id);
const cfg=window.ARIANA_PAYMENT_CONFIG||{};
const API_BASE=String(cfg.API_BASE||"/api").replace(/\/+$/,"");
const PUBLIC_KEY=String(cfg.PAGARME_PUBLIC_KEY||"").trim();
const token=new URLSearchParams(location.search).get("token")||"";
let sale=null, paymentMethod="card", polling=null, busy=false;

const money=v=>Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const digits=v=>String(v||"").replace(/\D/g,"");
const esc=v=>String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");

function toast(message){
  const el=$("toast"); el.textContent=message; el.classList.remove("hidden");
  clearTimeout(window.__toast); window.__toast=setTimeout(()=>el.classList.add("hidden"),3500);
}
async function api(path,{method="GET",body}={}){
  const r=await fetch(`${API_BASE}${path}`,{
    method,headers:{"Content-Type":"application/json"},
    body:body===undefined?undefined:JSON.stringify(body),cache:"no-store"
  });
  const text=await r.text(); let data={};
  try{data=text?JSON.parse(text):{}}catch{data={error:text||`HTTP ${r.status}`}}
  if(!r.ok||data.ok===false) throw Object.assign(new Error(data.error||data.message||`HTTP ${r.status}`),{status:r.status,code:data.code,data});
  return data;
}
function pay(){return sale?.payment||{}}
function fixedMethod(){const m=String(pay().method||"").toLowerCase();return m==="pix"?"pix":"card"}

function render(){
  const p=pay(), installments=Math.max(1,Number(p.installments||1));
  const installmentValue=Number(p.installmentValue||sale.total/installments);
  $("order-code").textContent=`Pedido #${String(sale.id||"").slice(-8).toUpperCase()}`;
  $("order-items").innerHTML=(sale.items||[]).map(i=>{
    const q=Number(i.qty||1),u=Number(i.unitPrice??i.price??0);
    return `<div class="order-item"><div><strong>${esc(i.name)}</strong><small>${q} unidade(s) • ${money(u)} cada</small></div><strong>${money(i.totalPrice??u*q)}</strong></div>`;
  }).join("");
  $("subtotal-value").textContent=money(sale.subtotal);
  $("shipping-value").textContent=money(sale.shippingCost);
  $("warranty-value").textContent=money(sale.montagemCost);
  $("discount-value").textContent="- "+money(0);
  $("total-value").textContent=money(sale.total);
  $("pix-total-value").textContent=money(sale.total);
  $("sidebar-total-value").textContent=money(sale.total);
  $("customer-name").value=sale.customerName||"";
  $("customer-phone").value=sale.customerPhone||"";
  $("customer-email").value=sale.customerEmail||"";
  $("sidebar-customer-name").textContent=sale.customerName||"—";
  $("locked-installments").textContent=`${installments}x de ${money(installmentValue)}`;
  setMethod(fixedMethod(),true);
  document.querySelector('[data-payment="card"]').disabled=fixedMethod()==="pix";
  document.querySelector('[data-payment="pix"]').disabled=fixedMethod()==="card";
  renderPix();
  if(["aprovado","em_analise","pagamento_enviado","recusado"].includes(sale.status)) showStatus();
}
function setMethod(method,force=false){
  if(!force&&method!==fixedMethod()){toast("A forma de pagamento foi definida pelo atendente.");return}
  paymentMethod=method;
  document.querySelectorAll(".payment-tab").forEach(t=>t.classList.toggle("active",t.dataset.payment===method));
  $("card-payment").classList.toggle("hidden",method!=="card");
  $("pix-payment").classList.toggle("hidden",method!=="pix");
  const p=pay(),n=Math.max(1,Number(p.installments||1)),v=Number(p.installmentValue||sale.total/n);
  $("sidebar-condition-value").textContent=method==="card"?`Cartão — ${n}x de ${money(v)}`:`PIX à vista — ${money(sale.total)}`;
}
async function load(register=true){
  if(!token) throw new Error("Token não informado.");
  const data=await api(`/televendas/payment-links/${encodeURIComponent(token)}`);
  sale=data.order;
  if(register&&["link_gerado","rascunho"].includes(sale.status)){
    try{const a=await api(`/televendas/payment-links/${encodeURIComponent(token)}/access`,{method:"POST",body:{}});sale=a.order||sale}catch(e){console.warn(e)}
  }
  render();
}
function validateCustomer(){
  if(!$("customer-name").value.trim())return"Informe seu nome completo.";
  if(digits($("customer-cpf").value).length!==11)return"Informe um CPF com 11 dígitos.";
  if(digits($("customer-phone").value).length<10)return"Informe seu telefone.";
  if(!$("customer-email").value.includes("@"))return"Informe um e-mail válido.";
  return"";
}
function validateCard(){
  const c=validateCustomer(); if(c)return c;
  const n=digits($("card-number").value),[m,y]=$("card-expiry").value.trim().split("/");
  if(n.length<13||n.length>19)return"Informe um número de cartão válido.";
  if(!$("card-name").value.trim())return"Informe o nome impresso no cartão.";
  if(!m||!y||Number(m)<1||Number(m)>12)return"Informe uma validade válida.";
  if(digits($("card-cvv").value).length<3)return"Informe o CVV.";
  return"";
}
async function tokenize(){
  if(!PUBLIC_KEY||PUBLIC_KEY.includes("COLE_AQUI"))throw new Error("Configure a chave pública pk_... da Pagar.me no pagamento_link.html.");
  const [m,y0]=$("card-expiry").value.trim().split("/"),y=y0.length===2?`20${y0}`:y0;
  const r=await fetch(`https://api.pagar.me/core/v5/tokens?appId=${encodeURIComponent(PUBLIC_KEY)}`,{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({type:"card",card:{
      number:digits($("card-number").value),holder_name:$("card-name").value.trim(),
      exp_month:Number(m),exp_year:Number(y),cvv:digits($("card-cvv").value)
    }})
  });
  const data=await r.json().catch(()=>({}));
  if(!r.ok||!data.id)throw new Error(data.message||data.error||data.errors?.[0]?.message||"Falha ao tokenizar cartão.");
  $("card-number").value="";$("card-expiry").value="";$("card-cvv").value="";
  return data.id;
}
async function payCard(){
  const err=validateCard(); if(err)return toast(err); if(busy)return;
  busy=true; const b=$("btn-pay-card");b.disabled=true;b.textContent="Processando…";
  try{
    const cardToken=await tokenize(),p=pay();
    const data=await api(`/televendas/payment-links/${encodeURIComponent(token)}/card`,{method:"POST",body:{
      cardToken,card_token:cardToken,installments:Math.max(1,Number(p.installments||1)),
      document:digits($("customer-cpf").value),email:$("customer-email").value.trim(),
      customer:{name:$("customer-name").value.trim(),email:$("customer-email").value.trim(),phone:digits($("customer-phone").value),document:digits($("customer-cpf").value)}
    }});
    sale=data.order||sale;render();showStatus();startPolling();
  }catch(e){console.error(e);toast(e.message||"Erro ao processar cartão.")}
  finally{busy=false;b.disabled=false;b.textContent="Enviar pagamento para análise"}
}
async function generatePix(){
  const err=validateCustomer();if(err)return toast(err);if(busy)return;
  busy=true;const b=$("btn-generate-pix");b.disabled=true;b.textContent="Gerando PIX…";
  try{
    const data=await api(`/televendas/payment-links/${encodeURIComponent(token)}/pix`,{method:"POST",body:{
      document:digits($("customer-cpf").value),cpf:digits($("customer-cpf").value),email:$("customer-email").value.trim(),
      payer:{name:$("customer-name").value.trim(),email:$("customer-email").value.trim(),phone:digits($("customer-phone").value),document:digits($("customer-cpf").value)}
    }});
    sale=data.order||sale;render();renderPix();startPolling();
  }catch(e){console.error(e);toast(e.message||"Erro ao gerar PIX.")}
  finally{busy=false;b.disabled=false;b.textContent="Gerar código PIX"}
}
function renderPix(){
  const pix=pay().pix||{};if(!pix.qrCode&&!pix.qrCodeBase64&&!pix.ticketUrl)return;
  $("pix-code").value=pix.qrCode||"";
  if(pix.qrCodeBase64){$("pix-qr-image").src=pix.qrCodeBase64.startsWith("data:")?pix.qrCodeBase64:`data:image/png;base64,${pix.qrCodeBase64}`;$("pix-qr-image").classList.remove("hidden")}
  if(pix.ticketUrl){$("pix-ticket-link").href=pix.ticketUrl;$("pix-ticket-link").classList.remove("hidden")}
  $("pix-timer").textContent=pix.expiresAt?new Date(pix.expiresAt).toLocaleString("pt-BR"):"consulte o gateway";
  $("pix-generated").classList.remove("hidden");
}
function showStatus(){
  const p=pay(),s=sale.status;
  const map={aprovado:["Pagamento confirmado!","Seu pagamento foi aprovado.","Aprovado"],recusado:["Pagamento recusado","A operadora não aprovou a cobrança.","Recusado"],em_analise:["Pagamento em análise","A transação está sendo analisada.","Em análise"],pagamento_enviado:["Pagamento enviado","Aguarde a resposta da operadora.","Processando"],aguardando_pagamento:["Aguardando PIX","Pague o código PIX para concluir.","Aguardando pagamento"]};
  const a=map[s]||["Pagamento em processamento","Aguarde a confirmação do gateway.",sale.statusLabel||s];
  document.querySelector("#analysis-screen h1").textContent=a[0];
  document.querySelector("#analysis-screen > .status-card > p:not(.eyebrow)").textContent=a[1];
  document.querySelector(".analysis-label").textContent=a[2];
  $("status-order").textContent=`#${String(sale.id||"").slice(-8).toUpperCase()}`;
  $("status-total").textContent=money(sale.total);
  $("status-method").textContent=p.method==="pix"?"PIX":`Cartão — ${p.installments||1}x`;
  $("analysis-screen").classList.remove("hidden");
}
function startPolling(){
  clearInterval(polling);
  if(["aprovado","recusado","cancelado"].includes(sale?.status))return;
  polling=setInterval(async()=>{
    try{const d=await api(`/televendas/payment-links/${encodeURIComponent(token)}`),old=sale.status;sale=d.order;if(sale.status!==old){render();showStatus()}if(["aprovado","recusado","cancelado"].includes(sale.status))clearInterval(polling)}catch(e){console.warn(e)}
  },5000);
}
function masks(){
  $("customer-cpf").addEventListener("input",e=>{let v=digits(e.target.value).slice(0,11);v=v.replace(/(\d{3})(\d)/,"$1.$2").replace(/(\d{3})(\d)/,"$1.$2").replace(/(\d{3})(\d{1,2})$/,"$1-$2");e.target.value=v});
  $("card-number").addEventListener("input",e=>e.target.value=digits(e.target.value).slice(0,19).replace(/(.{4})/g,"$1 ").trim());
  $("card-expiry").addEventListener("input",e=>{let v=digits(e.target.value).slice(0,4);if(v.length>2)v=v.slice(0,2)+"/"+v.slice(2);e.target.value=v});
  $("card-cvv").addEventListener("input",e=>e.target.value=digits(e.target.value).slice(0,4));
}
document.querySelectorAll(".payment-tab").forEach(t=>t.addEventListener("click",()=>setMethod(t.dataset.payment)));
$("btn-pay-card").addEventListener("click",payCard);
$("btn-generate-pix").addEventListener("click",generatePix);
$("btn-copy-pix").addEventListener("click",async()=>{try{await navigator.clipboard.writeText($("pix-code").value);toast("Código PIX copiado.")}catch{$("pix-code").select();toast("Selecione e copie o código.")}});
$("btn-back-order").addEventListener("click",()=>history.back());
masks();
load(true).then(startPolling).catch(e=>{$("invalid-link").classList.remove("hidden");toast(e.message||"Link inválido.")});
})();