const SALES_KEY="ariana_televendas_fase1";
const PRODUCTS=[
{id:"p1",sku:"FG11",name:"Fogão Mueller MFI5BF de 5 Bocas",price:2034.94,category:"Eletrodomésticos"},
{id:"p2",sku:"SOM24",name:"Caixa de Som Bluetooth Portátil RGB",price:119.28,category:"Áudio"},
{id:"p3",sku:"FREEZ198",name:"Freezer Hisense 198L Branco 110V",price:1388.10,category:"Refrigeração"},
{id:"p4",sku:"SOFA4",name:"Sofá 4 Lugares Retrátil e Reclinável",price:2899.00,category:"Móveis"},
{id:"p5",sku:"TV50",name:"Smart TV 50 polegadas 4K",price:2499.90,category:"TV e Vídeo"},
{id:"p6",sku:"GUARDA6",name:"Guarda-Roupa Casal 6 Portas",price:2199.00,category:"Móveis"}
];
let selectedItems=[];
let generatedSale=null;
const $=id=>document.getElementById(id);
function money(v){return Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}
function toast(msg){const el=$("toast");el.textContent=msg;el.classList.remove("hidden");clearTimeout(window.__toast);window.__toast=setTimeout(()=>el.classList.add("hidden"),2400)}
function renderProducts(){const term=$("product-search").value.trim().toLowerCase();const rows=PRODUCTS.filter(p=>`${p.name} ${p.sku} ${p.category}`.toLowerCase().includes(term));$("product-results").innerHTML=rows.map(p=>`<article class="product-card"><small>${p.sku} • ${p.category}</small><strong>${p.name}</strong><span>${money(p.price)}</span><button data-add-product="${p.id}">Adicionar</button></article>`).join("")}
function renderSelected(){const wrap=$("selected-products-list");wrap.innerHTML=selectedItems.map(i=>`<div class="selected-item"><div><strong>${i.name}</strong><small>${money(i.price)} cada</small></div><div class="qty-control"><button data-dec="${i.id}">−</button><span>${i.qty}</span><button data-inc="${i.id}">+</button></div><button class="remove-item" data-remove="${i.id}">×</button></div>`).join("");$("empty-products").classList.toggle("hidden",selectedItems.length>0);recalculate()}
function productsTotal(){return selectedItems.reduce((sum,i)=>sum+i.price*i.qty,0)}
function shippingValue(){return Number($("shipping-price").value||0)}
function warrantyValue(){return $("extended-warranty").checked?Number($("warranty-price").value||0):0}
function discountValue(){return Math.max(0,Number($("discount-value").value||0))}
function total(){return Math.max(0,productsTotal()+shippingValue()+warrantyValue()-discountValue())}
function renderInstallments(){const select=$("installments");const current=Number(select.value||12);select.innerHTML=Array.from({length:12},(_,i)=>{const n=i+1;return `<option value="${n}">${n}x de ${money(total()/n)}</option>`}).join("");select.value=String(Math.min(12,Math.max(1,current)));updateInstallmentPreview()}
function updateInstallmentPreview(){const n=Number($("installments").value||1);$("installment-preview").textContent=total()>0?`${n}x de ${money(total()/n)} — condição bloqueada no link`:"Selecione os produtos para calcular as parcelas."}
function recalculate(){$("summary-products").textContent=money(productsTotal());$("summary-shipping").textContent=money(shippingValue());$("summary-warranty").textContent=money(warrantyValue());$("summary-discount").textContent=`- ${money(discountValue())}`;$("summary-total").textContent=money(total());renderInstallments()}
function addProduct(id){const p=PRODUCTS.find(x=>x.id===id);if(!p)return;const found=selectedItems.find(x=>x.id===id);if(found)found.qty++;else selectedItems.push({...p,qty:1});renderSelected()}
function validate(){if(!$("customer-name").value.trim())return "Informe o nome do cliente.";if(!$("customer-phone").value.trim())return "Informe o telefone do cliente.";if(!selectedItems.length)return "Adicione pelo menos um produto.";if(!$("shipping-method").value)return "Selecione o tipo de entrega.";if(total()<=0)return "O total da venda precisa ser maior que zero.";return ""}
function makeToken(){return Array.from(crypto.getRandomValues(new Uint8Array(12))).map(b=>b.toString(16).padStart(2,"0")).join("")}
function saveSale(status){const sales=(()=>{try{return JSON.parse(localStorage.getItem(SALES_KEY))||[]}catch(_){return[]}})();const now=new Date();const order=`TV-${now.getFullYear()}-${String(sales.length+49).padStart(4,"0")}`;const installments=Number($("installments").value||1);const sale={id:order,client:$("customer-name").value.trim(),phone:$("customer-phone").value.trim(),operator:"Marcelo Nunes",total:total(),installments,installmentValue:Number((total()/installments).toFixed(2)),status,updatedAt:"Agora",createdAt:"Agora",paymentLink:`https://arianamoveis.com.br/pagamento_link.html?token=${makeToken()}`,timeline:[["Venda criada","Agora"],[status==="rascunho"?"Rascunho salvo":"Link de pagamento gerado","Agora"]],customer:{cpf:$("customer-cpf").value.trim(),email:$("customer-email").value.trim(),cep:$("customer-cep").value.trim(),address:$("customer-address").value.trim()},items:selectedItems.map(i=>({...i})),shipping:{method:$("shipping-method").value,price:shippingValue(),deadline:$("shipping-deadline").value.trim()},warranty:{enabled:$("extended-warranty").checked,price:warrantyValue()},discount:discountValue(),note:$("internal-note").value.trim(),payment:{method:"card",installments,locked:true,securityStatus:"awaiting_customer"}};sales.unshift(sale);localStorage.setItem(SALES_KEY,JSON.stringify(sales));return sale}
$("product-results").addEventListener("click",e=>{const b=e.target.closest("[data-add-product]");if(b)addProduct(b.dataset.addProduct)});
$("selected-products-list").addEventListener("click",e=>{const inc=e.target.closest("[data-inc]"),dec=e.target.closest("[data-dec]"),rem=e.target.closest("[data-remove]");if(inc){selectedItems.find(i=>i.id===inc.dataset.inc).qty++;renderSelected()}if(dec){const i=selectedItems.find(x=>x.id===dec.dataset.dec);i.qty=Math.max(1,i.qty-1);renderSelected()}if(rem){selectedItems=selectedItems.filter(x=>x.id!==rem.dataset.remove);renderSelected()}});
$("product-search").addEventListener("input",renderProducts);
["shipping-price","warranty-price","discount-value"].forEach(id=>$(id).addEventListener("input",recalculate));
$("installments").addEventListener("change",updateInstallmentPreview);
$("extended-warranty").addEventListener("change",()=>{$("warranty-price-wrap").classList.toggle("hidden",!$("extended-warranty").checked);if(!$("extended-warranty").checked)$("warranty-price").value="";recalculate()});
$("btn-clear-customer").addEventListener("click",()=>["customer-name","customer-cpf","customer-phone","customer-email","customer-cep","customer-address"].forEach(id=>$(id).value=""));
$("btn-save-draft").addEventListener("click",()=>{const sale=saveSale("rascunho");toast(`Rascunho ${sale.id} salvo.`)});
$("btn-generate-link").addEventListener("click",()=>{const error=validate();if(error){toast(error);return}generatedSale=saveSale("link_gerado");$("generated-link").textContent=generatedSale.paymentLink;$("generated-order").textContent=generatedSale.id;$("generated-installments").textContent=`${generatedSale.installments}x de ${money(generatedSale.installmentValue)}`;$("link-modal").classList.remove("hidden")});
$("link-modal-close").addEventListener("click",()=>$("link-modal").classList.add("hidden"));
$("link-modal").addEventListener("click",e=>{if(e.target.id==="link-modal")$("link-modal").classList.add("hidden")});
$("btn-copy-generated-link").addEventListener("click",async()=>{if(!generatedSale)return;try{await navigator.clipboard.writeText(generatedSale.paymentLink);toast("Link copiado.")}catch(_){toast("Não foi possível copiar automaticamente.")}});
$("btn-send-generated-whatsapp").addEventListener("click",()=>{if(!generatedSale)return;const phone=generatedSale.phone.replace(/\D/g,"");const text=encodeURIComponent(`Olá, ${generatedSale.client}! Segue o link de pagamento da sua compra na Ariana Móveis:\n${generatedSale.paymentLink}\n\nCondição definida: ${generatedSale.installments}x de ${money(generatedSale.installmentValue)}. Após o envio do pagamento, ele ficará em análise de segurança.`);window.open(`https://wa.me/55${phone}?text=${text}`,"_blank","noopener")});
renderProducts();renderSelected();
