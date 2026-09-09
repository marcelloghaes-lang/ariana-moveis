const SALES_KEY="ariana_televendas_fase1";
const API_BASE_LOCAL="http://localhost:3000/api";
const API_BASE_RENDER="https://ariana-backend.onrender.com/api";
const IS_LOCAL_HOST=window.location.hostname==="127.0.0.1"||window.location.hostname==="localhost";
const API_BASE=window.TELEVENDAS_API_BASE||localStorage.getItem("API_BASE")||(IS_LOCAL_HOST?API_BASE_LOCAL:API_BASE_RENDER);

let catalogProducts=[];
let selectedItems=[];
let generatedSale=null;
let chatwootContext=null;
let productSearchTimer=null;
const $=id=>document.getElementById(id);

function money(v){return Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}
function toast(msg){const el=$("toast");if(!el)return;el.textContent=msg;el.classList.remove("hidden");clearTimeout(window.__toast);window.__toast=setTimeout(()=>el.classList.add("hidden"),3200)}
function onlyDigits(v){return String(v||"").replace(/\D/g,"")}
function normalizeText(v){return String(v||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim()}
function escapeHtml(v){return String(v??"").replace(/[&<>'"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[ch]))}
function getAdminToken(){
  const direct=localStorage.getItem("admin_token")||localStorage.getItem("auth_token")||localStorage.getItem("token")||"";
  if(direct)return direct;
  try{return JSON.parse(localStorage.getItem("banner_admin_session")||"null")?.token||""}catch(_){return ""}
}
function authHeaders(extra={}){const token=getAdminToken();return token?{...extra,Authorization:`Bearer ${token}`}:{...extra}}
async function api(path,options={}){
  const response=await fetch(`${String(API_BASE).replace(/\/$/,"")}${path}`,{
    ...options,
    headers:authHeaders(options.headers||{}),
    cache:"no-store"
  });
  let data={};
  try{data=await response.json()}catch(_){data={}}
  if(!response.ok){
    const err=new Error(data?.error||data?.message||`Erro HTTP ${response.status}`);
    err.status=response.status;
    err.data=data;
    throw err;
  }
  return data;
}

function normalizeListResponse(data){
  if(Array.isArray(data))return data;
  if(data&&Array.isArray(data.items))return data.items;
  if(data&&Array.isArray(data.products))return data.products;
  if(data&&Array.isArray(data.results))return data.results;
  if(data&&Array.isArray(data.docs))return data.docs;
  if(data&&Array.isArray(data.data))return data.data;
  return [];
}
function firstImage(product={}){
  const images=Array.isArray(product.images)?product.images:[];
  const imageUrls=Array.isArray(product.imageUrls)?product.imageUrls:[];
  const imagePaths=Array.isArray(product.imagePaths)?product.imagePaths:[];
  const value=product.imageUrl||product.mainImageUrl||product.image||product.imagem||(typeof images[0]==="string"?images[0]:images[0]?.url)||imageUrls[0]||imagePaths[0]||"";
  if(!value)return "";
  if(/^https?:\/\//i.test(value)||/^data:/i.test(value))return value;
  const origin=String(API_BASE).replace(/\/api\/?$/i,"");
  return value.startsWith("/")?`${origin}${value}`:`${origin}/${String(value).replace(/^\.?\//,"")}`;
}
function normalizeCatalogProduct(item={}){
  const rawPrice=item.price??item.preco??item.valor??item.salePrice??0;
  const price=Number(rawPrice||0);
  return {
    id:String(item.id||item._id||item.productId||""),
    sellerId:String(item.sellerId||item.seller_id||""),
    sku:String(item.sku||item.codigo||item.code||""),
    name:String(item.name||item.nome||item.title||item.titulo||"Produto sem nome"),
    price:Number.isFinite(price)?price:0,
    category:String(item.category||item.categoria||item.categoryName||item.department||"Geral"),
    brand:String(item.brand||item.marca||""),
    description:String(item.description||item.descricao||""),
    stock:Number(item.stock??item.estoque??0),
    active:item.active!==false&&item.ativo!==false,
    image:firstImage(item),
    sellerBaseUnitPrice:Number(item.sellerBaseUnitPrice??item.sellerBasePrice??item.basePrice??rawPrice??0)||0,
    cardMarkupUnit:Number(item.cardMarkupUnit||0)||0,
    source:item
  };
}
function productHaystack(p){return normalizeText([p.name,p.sku,p.category,p.brand,p.description].filter(Boolean).join(" "))}

async function loadCatalogProducts(){
  const result=$("product-results");
  if(result)result.innerHTML='<div class="empty-products">Carregando catálogo real da Ariana Móveis...</div>';
  const endpoints=["/products","/seller/products","/home/index-data"];
  let lastError=null;
  for(const endpoint of endpoints){
    try{
      const data=await api(endpoint);
      const raw=endpoint==="/home/index-data"&&data?.products?normalizeListResponse(data.products):normalizeListResponse(data);
      const normalized=raw.map(normalizeCatalogProduct).filter(p=>p.id&&p.name&&p.price>0&&p.active!==false);
      if(normalized.length){
        const seen=new Set();
        catalogProducts=normalized.filter(p=>{if(seen.has(p.id))return false;seen.add(p.id);return true});
        renderProducts();
        return catalogProducts;
      }
    }catch(error){lastError=error;console.warn(`[televendas] catálogo ${endpoint}:`,error)}
  }
  catalogProducts=[];
  if(result)result.innerHTML=`<div class="empty-products">Não foi possível carregar o catálogo real${lastError?.message?`: ${escapeHtml(lastError.message)}`:"."}</div>`;
  return [];
}

function renderProducts(){
  const container=$("product-results");
  if(!container)return;
  if(!catalogProducts.length){
    if(!container.innerHTML.trim())container.innerHTML='<div class="empty-products">Carregando catálogo...</div>';
    return;
  }
  const term=normalizeText($("product-search")?.value||"");
  const words=term.split(" ").filter(Boolean);
  let rows=catalogProducts;
  if(words.length){rows=catalogProducts.filter(p=>{const hay=productHaystack(p);return words.every(w=>hay.includes(w))})}
  rows=rows.slice(0,30);
  if(!rows.length){
    container.innerHTML='<div class="empty-products">Nenhum produto encontrado no catálogo da Ariana Móveis.</div>';
    return;
  }
  container.innerHTML=rows.map(p=>`<article class="product-card">
    <small>${escapeHtml([p.sku,p.category].filter(Boolean).join(" • "))}</small>
    <strong>${escapeHtml(p.name)}</strong>
    <span>${money(p.price)}</span>
    <button type="button" data-add-product="${escapeHtml(p.id)}">Adicionar</button>
  </article>`).join("")
}
function renderSelected(){
  const wrap=$("selected-products-list");
  wrap.innerHTML=selectedItems.map(i=>`<div class="selected-item"><div><strong>${escapeHtml(i.name)}</strong><small>${money(i.price)} cada</small></div><div class="qty-control"><button data-dec="${escapeHtml(i.id)}">−</button><span>${i.qty}</span><button data-inc="${escapeHtml(i.id)}">+</button></div><button class="remove-item" data-remove="${escapeHtml(i.id)}">×</button></div>`).join("");
  $("empty-products").classList.toggle("hidden",selectedItems.length>0);
  recalculate()
}
function productsTotal(){return selectedItems.reduce((sum,i)=>sum+i.price*i.qty,0)}
function shippingValue(){return Number($("shipping-price").value||0)}
function warrantyValue(){return $("extended-warranty").checked?Number($("warranty-price").value||0):0}
function discountValue(){return Math.max(0,Number($("discount-value").value||0))}
function total(){return Math.max(0,productsTotal()+shippingValue()+warrantyValue()-discountValue())}
function renderInstallments(){
  const select=$("installments"),current=Number(select.value||12);
  select.innerHTML=Array.from({length:12},(_,i)=>{const n=i+1;return `<option value="${n}">${n}x de ${money(total()/n)}</option>`}).join("");
  select.value=String(Math.min(12,Math.max(1,current)));
  updateInstallmentPreview()
}
function updateInstallmentPreview(){const n=Number($("installments").value||1);$("installment-preview").textContent=total()>0?`${n}x de ${money(total()/n)} — condição bloqueada no link`:"Selecione os produtos para calcular as parcelas."}
function recalculate(){$("summary-products").textContent=money(productsTotal());$("summary-shipping").textContent=money(shippingValue());$("summary-warranty").textContent=money(warrantyValue());$("summary-discount").textContent=`- ${money(discountValue())}`;$("summary-total").textContent=money(total());renderInstallments()}
function addProduct(id){const p=catalogProducts.find(x=>x.id===id);if(!p)return;const found=selectedItems.find(x=>x.id===id);if(found)found.qty++;else selectedItems.push({...p,qty:1});renderSelected()}
function validate(){if(!$("customer-name").value.trim())return "Informe o nome do cliente.";if(!$("customer-phone").value.trim())return "Informe o telefone do cliente.";if(!selectedItems.length)return "Adicione pelo menos um produto.";if(!$("shipping-method").value)return "Selecione o tipo de entrega.";if(total()<=0)return "O total da venda precisa ser maior que zero.";return ""}
function makeLocalOrderCode(){const sales=loadLocalSales();const now=new Date();return `TV-${now.getFullYear()}-${String(sales.length+49).padStart(4,"0")}`}
function loadLocalSales(){try{const rows=JSON.parse(localStorage.getItem(SALES_KEY));return Array.isArray(rows)?rows:[]}catch(_){return[]}}
function persistLocalSale(sale){const sales=loadLocalSales();sales.unshift(sale);localStorage.setItem(SALES_KEY,JSON.stringify(sales));return sale}

function getFormPayload(){
  const installments=Number($("installments").value||1);
  const customerAddress=$("customer-address").value.trim();
  return {
    customerName:$("customer-name").value.trim(),
    customerEmail:$("customer-email").value.trim(),
    customerPhone:$("customer-phone").value.trim(),
    customer:{
      name:$("customer-name").value.trim(),
      email:$("customer-email").value.trim(),
      phone:$("customer-phone").value.trim(),
      cpf:$("customer-cpf").value.trim(),
      cep:$("customer-cep").value.trim(),
      address:customerAddress
    },
    shippingAddress:customerAddress||null,
    items:selectedItems.map(i=>({
      productId:i.id,
      sellerId:i.sellerId||"",
      name:i.name,
      sku:i.sku,
      qty:i.qty,
      unitPrice:i.price,
      price:i.price,
      sellerBaseUnitPrice:i.sellerBaseUnitPrice||i.price,
      cardMarkupUnit:i.cardMarkupUnit||0,
      image:i.image||""
    })),
    shippingCost:shippingValue(),
    shipping:{
      method:$("shipping-method").value,
      price:shippingValue(),
      deadline:$("shipping-deadline").value.trim()
    },
    montagemCost:warrantyValue(),
    warranty:{enabled:$("extended-warranty").checked,price:warrantyValue()},
    discount:discountValue(),
    installments,
    paymentMethod:"card",
    payment:{method:"card",installments},
    notes:$("internal-note").value.trim()
  }
}

function localSaleFromBackend(order,paymentLink){
  const installments=Number(order?.payment?.installments||$("installments").value||1);
  const sale={
    id:makeLocalOrderCode(),
    backendId:String(order?._id||order?.id||""),
    client:order?.customerName||$("customer-name").value.trim(),
    phone:order?.customerPhone||$("customer-phone").value.trim(),
    operator:chatwootContext?.agentName||"Marcelo Nunes",
    total:Number(order?.total||total()),
    installments,
    installmentValue:Number(order?.payment?.installmentValue||((Number(order?.total||total()))/installments).toFixed(2)),
    status:"link_gerado",
    updatedAt:"Agora",
    createdAt:"Agora",
    paymentLink,
    timeline:[["Venda criada","Agora"],["Link de pagamento gerado","Agora"]],
    customer:{cpf:$("customer-cpf").value.trim(),email:$("customer-email").value.trim(),cep:$("customer-cep").value.trim(),address:$("customer-address").value.trim()},
    items:selectedItems.map(i=>({...i})),
    shipping:{method:$("shipping-method").value,price:shippingValue(),deadline:$("shipping-deadline").value.trim()},
    warranty:{enabled:$("extended-warranty").checked,price:warrantyValue()},
    discount:discountValue(),
    note:$("internal-note").value.trim(),
    payment:{method:"card",installments,locked:true,securityStatus:"awaiting_customer"},
    chatwoot:chatwootContext?{...chatwootContext}:null
  };
  return persistLocalSale(sale)
}

function saveDraftLocal(){
  const installments=Number($("installments").value||1);
  const sale={id:makeLocalOrderCode(),client:$("customer-name").value.trim()||"Cliente não informado",phone:$("customer-phone").value.trim(),operator:chatwootContext?.agentName||"Marcelo Nunes",total:total(),installments,installmentValue:Number((total()/installments||0).toFixed(2)),status:"rascunho",updatedAt:"Agora",createdAt:"Agora",paymentLink:"",timeline:[["Rascunho salvo","Agora"]],customer:{cpf:$("customer-cpf").value.trim(),email:$("customer-email").value.trim(),cep:$("customer-cep").value.trim(),address:$("customer-address").value.trim()},items:selectedItems.map(i=>({...i})),shipping:{method:$("shipping-method").value,price:shippingValue(),deadline:$("shipping-deadline").value.trim()},warranty:{enabled:$("extended-warranty").checked,price:warrantyValue()},discount:discountValue(),note:$("internal-note").value.trim(),payment:{method:"card",installments,locked:false},chatwoot:chatwootContext?{...chatwootContext}:null};
  return persistLocalSale(sale)
}

function applyChatwootContext(payload){
  if(!payload||payload.event!=="appContext"||!payload.data)return;
  const conversation=payload.data.conversation||{};
  const contact=payload.data.contact||conversation?.meta?.sender||{};
  const agent=payload.data.currentAgent||conversation?.meta?.assignee||{};
  const next={conversationId:String(conversation.id||""),accountId:String(conversation.account_id||""),inboxId:String(conversation.inbox_id||""),contactId:String(contact.id||""),contactName:String(contact.name||""),contactPhone:String(contact.phone_number||""),contactEmail:String(contact.email||""),agentId:String(agent.id||""),agentName:String(agent.name||agent.available_name||"")};
  if(!next.conversationId)return;
  chatwootContext=next;
  if(next.contactName&&!$("customer-name").value.trim())$("customer-name").value=next.contactName;
  if(next.contactPhone&&!$("customer-phone").value.trim())$("customer-phone").value=next.contactPhone;
  if(next.contactEmail&&!$("customer-email").value.trim())$("customer-email").value=next.contactEmail;
  const sendBtn=$("btn-send-generated-whatsapp");
  if(sendBtn)sendBtn.textContent="Enviar no Chatwoot";
  toast("Conversa do Chatwoot vinculada ao atendimento.")
}

window.addEventListener("message",event=>{
  if(window.parent!==window&&event.source!==window.parent)return;
  let payload=event.data;
  if(typeof payload==="string"){try{payload=JSON.parse(payload)}catch(_){return}}
  applyChatwootContext(payload)
});
if(window.parent!==window){try{window.parent.postMessage("chatwoot-dashboard-app:fetch-info","*")}catch(_){}}

$("product-results").addEventListener("click",e=>{const b=e.target.closest("[data-add-product]");if(b)addProduct(b.dataset.addProduct)});
$("selected-products-list").addEventListener("click",e=>{const inc=e.target.closest("[data-inc]"),dec=e.target.closest("[data-dec]"),rem=e.target.closest("[data-remove]");if(inc){const i=selectedItems.find(x=>x.id===inc.dataset.inc);if(i)i.qty++;renderSelected()}if(dec){const i=selectedItems.find(x=>x.id===dec.dataset.dec);if(i)i.qty=Math.max(1,i.qty-1);renderSelected()}if(rem){selectedItems=selectedItems.filter(x=>x.id!==rem.dataset.remove);renderSelected()}});
$("product-search").addEventListener("input",()=>{clearTimeout(productSearchTimer);productSearchTimer=setTimeout(renderProducts,180)});
["shipping-price","warranty-price","discount-value"].forEach(id=>$(id).addEventListener("input",recalculate));
$("installments").addEventListener("change",updateInstallmentPreview);
$("extended-warranty").addEventListener("change",()=>{$("warranty-price-wrap").classList.toggle("hidden",!$("extended-warranty").checked);if(!$("extended-warranty").checked)$("warranty-price").value="";recalculate()});
$("btn-clear-customer").addEventListener("click",()=>["customer-name","customer-cpf","customer-phone","customer-email","customer-cep","customer-address"].forEach(id=>$(id).value=""));
$("btn-save-draft").addEventListener("click",()=>{const sale=saveDraftLocal();toast(`Rascunho ${sale.id} salvo.`)});

$("btn-generate-link").addEventListener("click",async()=>{
  const error=validate();
  if(error){toast(error);return}
  if(!getAdminToken()){toast("Faça login no painel administrativo da Ariana para gerar o link real.");return}
  const btn=$("btn-generate-link");
  btn.disabled=true;
  try{
    toast("Criando a venda no servidor...");
    const created=await api("/televendas/orders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(getFormPayload())});
    const backendOrder=created.order;
    const backendId=String(backendOrder?._id||backendOrder?.id||"");
    if(!backendId)throw new Error("O servidor não retornou o ID da venda.");
    const generated=await api(`/televendas/orders/${encodeURIComponent(backendId)}/payment-link`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({installments:Number($("installments").value||1),method:"card",frontendUrl:"https://arianamoveis.com.br"})});
    if(chatwootContext?.conversationId){
      try{await api(`/televendas/orders/${encodeURIComponent(backendId)}/chatwoot`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(chatwootContext)})}catch(linkError){console.warn("Falha ao vincular Chatwoot:",linkError)}
    }
    generatedSale=localSaleFromBackend(generated.order||backendOrder,generated.paymentLink);
    generatedSale.backendId=backendId;
    $("generated-link").textContent=generatedSale.paymentLink;
    $("generated-order").textContent=generatedSale.id;
    $("generated-installments").textContent=`${generatedSale.installments}x de ${money(generatedSale.installmentValue)}`;
    $("link-modal").classList.remove("hidden");
    toast("Link real de pagamento gerado.")
  }catch(err){
    console.error(err);
    if(err.status===401||err.status===403)toast("Sua sessão administrativa expirou. Entre novamente no painel.");
    else toast(err.message||"Não foi possível gerar o link de pagamento.")
  }finally{btn.disabled=false}
});

$("link-modal-close").addEventListener("click",()=>$("link-modal").classList.add("hidden"));
$("link-modal").addEventListener("click",e=>{if(e.target.id==="link-modal")$("link-modal").classList.add("hidden")});
$("btn-copy-generated-link").addEventListener("click",async()=>{if(!generatedSale)return;try{await navigator.clipboard.writeText(generatedSale.paymentLink);toast("Link copiado.")}catch(_){toast("Não foi possível copiar automaticamente.")}});
$("btn-send-generated-whatsapp").addEventListener("click",async()=>{
  if(!generatedSale)return;
  if(chatwootContext?.conversationId&&generatedSale.backendId){
    const btn=$("btn-send-generated-whatsapp");btn.disabled=true;
    try{
      const result=await api(`/televendas/orders/${encodeURIComponent(generatedSale.backendId)}/chatwoot/send-payment-link`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({conversationId:chatwootContext.conversationId,accountId:chatwootContext.accountId,frontendUrl:"https://arianamoveis.com.br"})});
      toast(result?.ok?"Link enviado na conversa do Chatwoot.":"Não foi possível enviar pelo Chatwoot.")
    }catch(err){console.error(err);toast(err.message||"Falha ao enviar pelo Chatwoot.")}finally{btn.disabled=false}
    return
  }
  const phone=onlyDigits(generatedSale.phone);
  const national=phone.startsWith("55")?phone:`55${phone}`;
  const text=encodeURIComponent(`Olá, ${generatedSale.client}! Segue o link de pagamento da sua compra na Ariana Móveis:\n${generatedSale.paymentLink}\n\nCondição definida: ${generatedSale.installments}x de ${money(generatedSale.installmentValue)}. Após o envio do pagamento, ele ficará em análise de segurança.`);
  window.open(`https://wa.me/${national}?text=${text}`,"_blank","noopener")
});

renderSelected();
loadCatalogProducts();