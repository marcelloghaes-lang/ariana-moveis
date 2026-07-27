
document.addEventListener('DOMContentLoaded',()=>{
  const busca=document.getElementById('sigeCarneBusca');
  const lista=document.getElementById('sigeCarneListaBusca');
  if(busca)busca.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();criarOuAtualizarSigeCarne();}});
  if(lista)lista.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();buscarCarnesDigitais();}});
});



let API_BASE = window.API_BASE || localStorage.getItem('API_BASE') || 'https://ariana-backend.onrender.com/api';
const FINANCEIRO_STATUS_ROUTE='/admin/financeiro/status';
const FINANCEIRO_CLIENTES_ROUTE='/admin/financeiro/clientes';
const FINANCEIRO_CARNE_ROUTE='/admin/financeiro/carne';
const CREDIARIO_CLIENTES_FALLBACK_ROUTE='/admin/crediario/clientes';

async function buscarClientesFinanceiro(q='', limit=100){
  const params='?q='+encodeURIComponent(String(q||'').trim())+'&limit='+encodeURIComponent(limit);
  try{
    const data=await apiJson(FINANCEIRO_CLIENTES_ROUTE+params);
    return Array.isArray(data.clientes)?data.clientes:[];
  }catch(error){
    if(error?.status!==404) throw error;
    const data=await apiJson(CREDIARIO_CLIENTES_FALLBACK_ROUTE+params);
    return Array.isArray(data.clientes)?data.clientes:[];
  }
}
let recibos=[]; let clientes=[]; let lastRecibo=null; let selectedCliente=null; let autocompleteTimer=null; let clienteSugestoesCache=[]; let cobrancaAlvo=null; let sigeCarneAtual=null; let sigeInadimplentesCache=[];
function token(){return localStorage.getItem('admin_token')||''}
function headers(extra={}){return {...extra, Authorization:'Bearer '+token()}}
async function apiJson(url, options = {}) {
  const finalUrl = String(url || '').startsWith('http') ? url : API_BASE + url;
  const opts = { ...options };
  opts.headers = { ...(opts.headers || {}) };
  if (!opts.headers.Authorization) opts.headers.Authorization = 'Bearer ' + token();

  const response = await fetch(finalUrl, opts);
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_e) {
    data = { ok: false, error: text || ('HTTP ' + response.status) };
  }

  if (!response.ok || data.ok === false) {
    const message = data.error || data.message || ('Erro HTTP ' + response.status);
    if(response.status===401 || data.code==='admin_session_invalid' || data.code==='admin_token_missing'){
      handleExpiredSession(message);
    }
    const err = new Error(message);
    err.status = response.status;
    err.data = data;
    err.url = finalUrl;
    throw err;
  }

  return data;
}

function money(v){return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v||0))}
function localDateInputValue(value=new Date()){
  const d=value instanceof Date?new Date(value.getTime()):new Date(value);
  if(Number.isNaN(d.getTime()))return '';
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
}
let sessionExpiredHandled=false;
function handleExpiredSession(message='Sua sessÃ£o expirou. FaÃ§a login novamente.'){
  if(sessionExpiredHandled)return;
  sessionExpiredHandled=true;
  localStorage.removeItem('admin_token');
  if(typeof appView!=='undefined')appView.style.display='none';
  if(typeof loginView!=='undefined')loginView.style.display='flex';
  toast(message);
  setTimeout(()=>{sessionExpiredHandled=false;},1500);
}

function formatParcelaCliente(v){const raw=String(v||'').trim();if(!raw)return '';const digits=raw.replace(/\D/g,'');if(/^\d{4}$/.test(digits))return digits.slice(0,2)+'/'+digits.slice(2);if(/^\d{3}$/.test(digits))return digits.slice(0,1).padStart(2,'0')+'/'+digits.slice(1);const m=raw.match(/^(\d{1,2})\s*[\/\-\s]\s*(\d{1,2})$/);if(m)return String(m[1]).padStart(2,'0')+'/'+String(m[2]).padStart(2,'0');return raw}
function esc(s){return String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function toast(msg){const t=document.createElement('div');t.textContent=msg;document.getElementById('toast').appendChild(t);setTimeout(()=>t.remove(),3500)}
function onlyDigits(v){return String(v||'').replace(/\D/g,'')}
function shortPhone(v){const d=onlyDigits(v);return d.startsWith('55')&&d.length>11?d.slice(2):d}
function init(){document.getElementById('data').value=localDateInputValue();['telefone','cpf','contrato','produto','valor','parcela','forma','data','obs'].forEach(id=>document.getElementById(id).addEventListener('input',preview));document.getElementById('nome').addEventListener('input',onClienteInput);document.getElementById('nome').addEventListener('keydown',onClienteKeydown);document.getElementById('nome').addEventListener('blur',()=>setTimeout(autoSelecionarClientePorTexto,220));parcela.addEventListener('blur',()=>{parcela.value=formatParcelaCliente(parcela.value);preview()});document.addEventListener('click',e=>{if(!e.target.closest('.autocomplete-wrap')) clienteSugestoes.classList.add('hidden')});if(token()){loginView.style.display='none';appView.style.display='block';loadAll()}preview()}init();
async function login(){
  const email=loginEmail.value.trim(),password=loginPass.value;
  if(!email||!password){toast('Informe e-mail e senha.');return}
  try{
    const r=await fetch(API_BASE+'/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
    const text=await r.text();
    let j={};try{j=text?JSON.parse(text):{}}catch(_e){j={ok:false,error:text||'Resposta invÃ¡lida do servidor'}}
    if(!r.ok||!j.ok||!j.token){toast(j.error||'Login nÃ£o autorizado');return}
    localStorage.setItem('admin_token',j.token);
    loginPass.value='';
    loginView.style.display='none';
    appView.style.display='block';
    await loadAll();
  }catch(e){toast('NÃ£o foi possÃ­vel conectar ao backend: '+(e.message||e))}
}
function logout(){localStorage.removeItem('admin_token');location.reload()}
function showTab(name,btn){document.querySelectorAll('[id^="tab-"]').forEach(e=>e.classList.add('hidden'));document.getElementById('tab-'+name).classList.remove('hidden');document.querySelectorAll('.nav button').forEach(b=>b.classList.remove('active'));btn.classList.add('active');if(name==='clientes')loadClientes();if(name==='historico')loadRecibos();if(name==='cobrancas')loadCobrancas();if(name==='monitorWhatsapp')carregarMonitorWhatsapp();if(name==='homologacao')carregarChecklistRelease(false);if(name==='sige'){testarSigeStatus();buscarCarnesDigitais();}if(name==='inadimplentes')loadSigeInadimplentesCentral();if(name==='filaCobranca'){inicializarFilaCobranca();carregarFilaCobranca();}if(name==='promessasPagamento')carregarPromessasPagamento(1);if(name==='recuperacaoCredito')inicializarRecuperacaoCredito();if(name==='tratativasFinanceiras')carregarTratativas(1);if(name==='prevencaoRisco')carregarRiscosClientes(1);if(name==='autoCobranca')loadAutoCobrancaConfig();if(name==='dashboardCrediario')loadDashboardCrediario();if(name==='perfisCredito')loadPerfisCredito();if(name==='analises')loadAnalisesCredito();if(name==='gestaoCarnes')pesquisarGestaoCarnes(1);if(name==='sincronizacao'){carregarStatusSincronizacao();carregarHistoricoSincronizacao();}if(name==='segurancaFinanceira'){carregarConfiguracaoFinanceira();carregarAuditoriaFinanceira();}if(name==='operacaoFinanceira'){}if(name==='cora')iniciarCora();if(name==='whatsappCrediario'){carregarConfigCrediarioWhatsApp();carregarHistoricoCrediarioWhatsApp();}if(name==='novo')setTimeout(()=>nome.focus(),120)}
function getForm(){return{clienteId:clienteId.value.trim(),clienteNome:nome.value.trim(),nome:nome.value.trim(),telefone:telefone.value.trim(),cpf:cpf.value.trim(),contrato:contrato.value.trim(),produto:produto.value.trim()||'Compra na loja',valorPago:valor.value.trim(),parcela:formatParcelaCliente(parcela.value.trim()),formaPagamento:forma.value,dataPagamento:data.value,observacao:obs.value.trim()}}
function preview(){const f=getForm();previewBox.innerHTML=`<div class="brand">Ariana MÃ³veis</div><p>Comprovante de pagamento de parcela</p><div class="row"><strong>Cliente</strong><span>${esc(f.nome)||'â€”'}</span></div><div class="row"><strong>CPF</strong><span>${esc(f.cpf)||'â€”'}</span></div><div class="row"><strong>Produto</strong><span>${esc(f.produto)||'â€”'}</span></div><div class="row"><strong>Parcela</strong><span>${esc(formatParcelaCliente(f.parcela))||'â€”'}</span></div><div class="row"><strong>Forma</strong><span>${esc(f.formaPagamento)}</span></div><div class="row"><strong>Data</strong><span>${f.dataPagamento?new Date(f.dataPagamento+'T00:00:00').toLocaleDateString('pt-BR'):'â€”'}</span></div><div class="row"><strong>Valor pago</strong><span class="money">${money(String(f.valorPago).replace(/\./g,'').replace(',','.'))}</span></div>`}
function clearSelectedCliente(){selectedCliente=null;clienteId.value='';clienteSelecionado.classList.add('hidden');clienteHistorico.classList.add('hidden');clienteAviso.classList.add('hidden')}
function onClienteInput(){clearTimeout(autocompleteTimer);clearSelectedCliente();preview();const q=nome.value.trim();if(q.length<2){clienteSugestoes.classList.add('hidden');return}autocompleteTimer=setTimeout(()=>buscarSugestoesCliente(q),250)}
async function buscarSugestoesCliente(q){try{const rows=await buscarClientesFinanceiro(q,12);clienteSugestoesCache=rows;if(!rows.length){clienteSugestoes.innerHTML='<div class="suggestion"><b>Nenhum cliente encontrado</b><small>VocÃª pode continuar digitando manualmente.</small></div>';clienteSugestoes.classList.remove('hidden');return}clienteSugestoes.innerHTML=rows.map((c,i)=>`<div class="suggestion" onclick="selecionarClientePorIndice(${i})"><b>${esc(c.nome)}</b><small>CPF: ${esc(c.cpf)||'â€”'} â€¢ WhatsApp: ${esc(shortPhone(c.telefone))||'â€”'} â€¢ Contrato: ${esc(c.contrato)||'â€”'}</small></div>`).join('');clienteSugestoes.classList.remove('hidden')}catch(e){console.error(e)}}
function selecionarClientePorIndice(i){const c=clienteSugestoesCache[Number(i)];if(c)selecionarCliente(c)}
function normalizarBuscaCliente(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'').trim()}
function onClienteKeydown(e){if(e.key==='Enter'){e.preventDefault();if(clienteSugestoesCache.length)selecionarCliente(clienteSugestoesCache[0]);else buscarEPreencherCliente()}}
async function buscarEPreencherCliente(){const q=nome.value.trim();if(q.length<2){toast('Digite pelo menos 2 letras do nome, CPF ou telefone.');return}try{const rows=await buscarClientesFinanceiro(q,5);clienteSugestoesCache=rows;if(!rows.length){toast('Cliente nÃ£o encontrado.');return}const nq=normalizarBuscaCliente(q);const digits=String(q).replace(/\D/g,'');const match=rows.find(c=>normalizarBuscaCliente(c.nome)===nq)||(digits?rows.find(c=>String(c.cpf||'').includes(digits)||String(c.telefone||'').includes(digits)):null)||rows[0];selecionarCliente(match)}catch(e){toast('Erro ao buscar cliente: '+(e.message||e))}}
function autoSelecionarClientePorTexto(){if(selectedCliente&&selectedCliente.id)return;const q=nome.value.trim();if(q.length<2||!clienteSugestoesCache.length)return;const nq=normalizarBuscaCliente(q);const digits=String(q).replace(/\D/g,'');const match=clienteSugestoesCache.find(c=>normalizarBuscaCliente(c.nome)===nq)||(digits?clienteSugestoesCache.find(c=>String(c.cpf||'').includes(digits)||String(c.telefone||'').includes(digits)):null)||(clienteSugestoesCache.length===1?clienteSugestoesCache[0]:null);if(match)selecionarCliente(match)}
async function selecionarCliente(c){selectedCliente=c||{};clienteId.value=selectedCliente.id||'';nome.value=selectedCliente.nome||'';cpf.value=selectedCliente.cpf||'';telefone.value=shortPhone(selectedCliente.telefone||'');contrato.value=selectedCliente.contrato||'';clienteSugestoes.classList.add('hidden');clienteSelecionado.innerHTML=`âœ… Cliente selecionado: ${esc(selectedCliente.nome)}${selectedCliente.cpf?' â€¢ CPF: '+esc(selectedCliente.cpf):''}${selectedCliente.telefone?' â€¢ WhatsApp: '+esc(shortPhone(selectedCliente.telefone)):''}`;clienteSelecionado.classList.remove('hidden');if(!telefone.value){clienteAviso.innerHTML='âš ï¸ Este cliente foi importado sem telefone/celular. Preencha o WhatsApp antes de enviar o recibo.';clienteAviso.classList.remove('hidden')}else{clienteAviso.classList.add('hidden')}preview();await carregarHistoricoCliente(selectedCliente.id)}
async function salvarClienteDoFormulario(){const payload={nome:nome.value.trim(),telefone:telefone.value.trim(),cpf:cpf.value.trim(),contrato:contrato.value.trim()};if(!payload.nome){toast('Informe o nome do cliente.');return}if(!payload.telefone){toast('Informe o celular/WhatsApp do cliente.');return}try{const r=await fetch(API_BASE+'/admin/crediario/clientes',{method:'POST',headers:headers({'Content-Type':'application/json'}),body:JSON.stringify(payload)});const j=await r.json();if(!j.ok){toast(j.error||'Erro ao salvar cliente');return}toast('Dados do cliente salvos com sucesso');await selecionarCliente(j.cliente);await loadClientes()}catch(e){toast('Erro ao salvar cliente: '+(e.message||e))}}
async function carregarHistoricoCliente(id){if(!id){clienteHistorico.classList.add('hidden');return}try{const r=await fetch(API_BASE+'/admin/crediario/recibos?clienteId='+encodeURIComponent(id)+'&limit=5',{headers:headers()});const j=await r.json();const rows=j.recibos||[];clienteHistorico.innerHTML='<h3>HistÃ³rico deste cliente</h3>'+(rows.length?rows.map(r=>`<div class="row"><strong>${esc(r.recibo)}</strong><span>${money(r.valorPago)} â€¢ ${new Date(r.dataPagamento||r.createdAt).toLocaleDateString('pt-BR')}</span></div>`).join(''):'<div class="muted">Nenhum recibo registrado para este cliente.</div>');clienteHistorico.classList.remove('hidden')}catch(e){console.error(e)}}
async function criarRecibo(enviarWhatsapp){const f=getForm();if(!f.nome||!f.telefone||!f.valorPago){toast('Preencha cliente, telefone e valor.');return}const r=await fetch(API_BASE+'/admin/crediario/recibos',{method:'POST',headers:headers({'Content-Type':'application/json'}),body:JSON.stringify({...f,enviarWhatsapp})});const j=await r.json();if(!j.ok){toast(j.error||'Erro ao criar recibo');return}lastRecibo=j.recibo;toast(enviarWhatsapp?(j.whatsapp?.ok===false?'Recibo salvo, mas WhatsApp falhou':'Recibo enviado com sucesso'):'Recibo salvo com sucesso');await printRecibo(j.recibo.id);limparForm(false);loadAll()}
function limparForm(reset=true){['nome','telefone','cpf','contrato','produto','valor','parcela','obs'].forEach(id=>document.getElementById(id).value='');document.getElementById('clienteId').value='';document.getElementById('data').value=localDateInputValue();clearSelectedCliente();preview()}
async function loadClientes(){try{const q=buscaCliente?.value||'';clientes=await buscarClientesFinanceiro(q,200);clientesBody.innerHTML=clientes.map((c,i)=>`<tr><td><b>${esc(c.nome)}</b><br><small>${esc(c.endereco||'')}</small></td><td>${esc(shortPhone(c.telefone))||'<span class="muted">Sem telefone</span>'}</td><td>${esc(c.cpf)}</td><td>${esc(c.contrato)}</td><td><button class="light small" onclick="usarClienteDaLista(${i})">Usar no recibo</button> <button class="yellow small" onclick="selecionarCobrancaCliente(${i})">ðŸ”” CobranÃ§a</button></td></tr>`).join('')||'<tr><td colspan="5">Nenhum cliente.</td></tr>'}catch(e){console.error(e);clientes=[];clientesBody.innerHTML='<tr><td colspan="5">Erro ao buscar clientes: '+esc(e.message||e)+'</td></tr>'}}
function usarClienteDaLista(i){const c=clientes[i];if(!c)return;document.querySelectorAll('.nav button')[0].click();setTimeout(()=>selecionarCliente(c),120)}
async function loadRecibos(){const q=encodeURIComponent(buscaRecibo?.value||'');const r=await fetch(API_BASE+'/admin/crediario/recibos?q='+q, {headers:headers()});const j=await r.json();recibos=j.recibos||[];recibosBody.innerHTML=recibos.map(r=>{const statusClass=r.enviadoWhatsapp?'ok':'pending';const statusText=r.enviadoWhatsapp?'Enviado':'Pendente';return `<tr><td><span class="receipt-code">${esc(r.recibo)}</span><span class="receipt-date">${new Date(r.dataPagamento||r.createdAt).toLocaleDateString('pt-BR')}</span></td><td><span class="client-name">${esc(r.clienteNome)}</span><span class="client-phone">${esc(shortPhone(r.telefone))||'Sem telefone'}</span></td><td>${esc(r.produto)}<span class="product-parcel">${esc(formatParcelaCliente(r.parcela))}</span></td><td><span class="money-cell">${money(r.valorPago)}</span></td><td><span class="pill ${statusClass}">${statusText}</span></td><td class="compact-actions"><div class="row-actions"><button class="icon-btn print" title="Imprimir recibo" onclick="printRecibo('${r.id}')">ðŸ–¨ï¸</button><button class="btn-text send" title="Enviar pelo WhatsApp" onclick="reenviar('${r.id}')">ðŸ“² Enviar</button><button class="icon-btn charge" title="Enviar cobranÃ§a" onclick="selecionarCobrancaRecibo('${r.id}')">ðŸ””</button></div></td></tr>`}).join('')||'<tr><td colspan="6">Nenhum recibo.</td></tr>';calcStats()}
async function printRecibo(id){
  try{
    const win = window.open('', '_blank');
    const r = await fetch(API_BASE+'/admin/crediario/recibos/'+encodeURIComponent(id)+'/html', { headers: headers() });
    const html = await r.text();
    if(!r.ok){
      if(win) win.close();
      let msg = html;
      try{ msg = JSON.parse(html).error || msg; }catch(_e){}
      toast('Erro ao abrir recibo: '+msg);
      return;
    }
    if(win){
      win.document.open();
      win.document.write(html);
      win.document.close();
      setTimeout(()=>{ try{ win.focus(); win.print(); }catch(_e){} }, 500);
    }else{
      const blob = new Blob([html], {type:'text/html;charset=utf-8'});
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(()=>URL.revokeObjectURL(url), 60000);
    }
  }catch(e){
    console.error(e);
    toast('Erro ao imprimir recibo: '+(e.message||e));
  }
}

function cobrancaTextoPreview(d){
  const nome=d.nome||d.clienteNome||'cliente';
  const tipo=tipoCobranca?.value||'normal';
  const urgente=tipo==='urgente';
  const produto=(cobrancaProduto?.value||d.produto||'').trim();
  const parc=formatParcelaCliente((cobrancaParcela?.value||d.parcela||'').trim());
  const val=(cobrancaValor?.value||d.valorPago||d.valor||'').toString().trim();
  return `${urgente?'ðŸš¨ Aviso urgente de pendÃªncia financeira':'ðŸ”” Aviso de pendÃªncia financeira'}

OlÃ¡, ${nome}.

${urgente?'Constam nota(s)/parcela(s) em atraso em nosso sistema. Solicitamos contato com urgÃªncia para regularizaÃ§Ã£o ou esclarecimentos.':'Informamos que existe nota/parcela em atraso em nosso sistema.'}

${produto?'ðŸ“¦ ReferÃªncia: '+produto+'\n':''}${parc?'ðŸ“Œ Parcela: '+parc+'\n':''}${val?'ðŸ’° Valor: R$ '+val+'\n':''}${d.documento||d.recibo?'ðŸ§¾ Documento: '+(d.documento||d.recibo)+'\n':''}
${urgente?'Para evitar bloqueio interno de crÃ©dito e novos transtornos, pedimos que entre em contato com a loja o quanto antes.':'Por favor, entre em contato com a loja para mais informaÃ§Ãµes ou regularizaÃ§Ã£o.'}

ðŸ“² WhatsApp financeiro:
(31) 98514-7119

Ariana MÃ³veis`;
}
function atualizarBoxTelefoneCobranca(){
  const tel=shortPhone(cobrancaAlvo?.telefone||'');
  if(!cobrancaAlvo){cobrancaSemTelefoneBox.classList.add('hidden');return}
  if(!tel){
    cobrancaSemTelefoneBox.classList.remove('hidden');
    cobrancaNovoTelefone.value='';
  }else{
    cobrancaSemTelefoneBox.classList.add('hidden');
    cobrancaNovoTelefone.value=tel;
  }
}
function atualizarTelefoneCobrancaTemp(){
  if(!cobrancaAlvo)return;
  cobrancaAlvo.telefone=cobrancaNovoTelefone.value;
  preencherResumoCobranca();
}
function preencherResumoCobranca(){
  if(!cobrancaAlvo){cobrancaSelecionada.innerHTML='Nenhum cliente ou recibo selecionado.';return}
  const d=cobrancaAlvo;
  const tipoLabel=d.kind==='recibo'?'Recibo':'Cliente';
  cobrancaSelecionada.innerHTML=`<b>${esc(d.nome||d.clienteNome)}</b> <span class="type-badge">${tipoLabel}</span><br><small>WhatsApp: ${esc(shortPhone(d.telefone))||'sem telefone'}${d.recibo?' â€¢ Recibo: '+esc(d.recibo):''}${d.contrato?' â€¢ Contrato: '+esc(d.contrato):''}</small>`;
}
function preencherCobranca(d){
  cobrancaAlvo=d||{};
  cobrancaProduto.value=d.produto||'';
  cobrancaParcela.value=formatParcelaCliente(d.parcela||'');
  cobrancaValor.value=d.valorPago?String(Number(d.valorPago).toFixed(2)).replace('.',','):'';
  preencherResumoCobranca();
  atualizarBoxTelefoneCobranca();
  previewCobranca();
}
function previewCobranca(){
  if(!cobrancaAlvo){cobrancaPreview.innerHTML='Selecione um cliente ou recibo para visualizar a mensagem.';return}
  cobrancaPreview.innerHTML='<pre style="white-space:pre-wrap;margin:0;font-family:Inter,Arial,sans-serif">'+esc(cobrancaTextoPreview(cobrancaAlvo))+'</pre>';
}
function limparCobranca(){cobrancaAlvo=null;cobrancaProduto.value='';cobrancaParcela.value='';cobrancaValor.value='';cobrancaNovoTelefone.value='';cobrancaSemTelefoneBox.classList.add('hidden');cobrancaSelecionada.innerHTML='Nenhum cliente ou recibo selecionado.';previewCobranca()}
async function salvarTelefoneCobranca(){
  if(!cobrancaAlvo){toast('Selecione um cliente primeiro.');return}
  const telefoneNovo=shortPhone(cobrancaNovoTelefone.value||'');
  if(!telefoneNovo){toast('Informe o celular/WhatsApp.');return}
  try{
    let clienteId=cobrancaAlvo.kind==='cliente'?cobrancaAlvo.id:(cobrancaAlvo.clienteId||'');
    const payload={nome:cobrancaAlvo.nome||cobrancaAlvo.clienteNome||'',telefone:telefoneNovo,cpf:cobrancaAlvo.cpf||cobrancaAlvo.clienteCpf||'',contrato:cobrancaAlvo.contrato||''};
    if(!payload.nome){toast('Nome do cliente nÃ£o localizado.');return}
    const r=await fetch(API_BASE+'/admin/crediario/clientes',{method:'POST',headers:headers({'Content-Type':'application/json'}),body:JSON.stringify(payload)});
    const j=await r.json();
    if(!j.ok){toast(j.error||'Erro ao salvar celular');return}
    cobrancaAlvo.telefone=j.cliente?.telefone||telefoneNovo;
    cobrancaAlvo.id=cobrancaAlvo.kind==='cliente'?(j.cliente?.id||cobrancaAlvo.id):cobrancaAlvo.id;
    cobrancaAlvo.clienteId=j.cliente?.id||clienteId;
    preencherResumoCobranca();
    atualizarBoxTelefoneCobranca();
    toast('Celular salvo no cadastro do cliente.');
    await loadClientes();
  }catch(e){toast('Erro ao salvar celular: '+(e.message||e))}
}
function selecionarCobrancaCliente(i){const c=clientes[i];if(!c)return;document.querySelector(".nav button[onclick*=\"cobrancas\"]").click();setTimeout(()=>preencherCobranca({...c,kind:'cliente',tipo:'cliente',nome:c.nome,produto:'PendÃªncia financeira'}),120)}
function selecionarCobrancaRecibo(id){const r=recibos.find(x=>String(x.id)===String(id));if(!r)return;document.querySelector(".nav button[onclick*=\"cobrancas\"]").click();setTimeout(()=>preencherCobranca({...r,kind:'recibo',tipo:'recibo',nome:r.clienteNome}),120)}
async function loadCobrancas(){
  const qRaw=buscaCobranca?.value||'';
  const q=encodeURIComponent(qRaw);
  const [rc, rr]=await Promise.all([
    fetch(API_BASE+'/admin/crediario/clientes?q='+q+'&limit=20',{headers:headers()}).then(r=>r.json()).catch(()=>({clientes:[]})),
    fetch(API_BASE+'/admin/crediario/recibos?q='+q+'&limit=20',{headers:headers()}).then(r=>r.json()).catch(()=>({recibos:[]}))
  ]);
  const rows=[];
  const seenClient=new Set();
  (rc.clientes||[]).forEach(c=>{
    const key=String(c.id||c.nome||'');
    seenClient.add(key);
    rows.push({kind:'cliente',id:c.id,nome:c.nome,telefone:c.telefone,cpf:c.cpf,produto:'PendÃªncia financeira',parcela:'',valorPago:0,contrato:c.contrato,documento:c.contrato||''});
  });
  (rr.recibos||[]).forEach(r=>rows.push({kind:'recibo',id:r.id,clienteId:r.clienteId,nome:r.clienteNome,clienteNome:r.clienteNome,telefone:r.telefone,produto:r.produto,parcela:r.parcela,valorPago:r.valorPago,recibo:r.recibo,contrato:r.contrato,documento:r.documento||r.recibo}));
  cobrancasBody.innerHTML=rows.map((r,i)=>{
    const badge=r.kind==='cliente'?'<span class="type-badge">Cliente</span>':'<span class="type-badge">Recibo</span>';
    const tel=shortPhone(r.telefone);
    const telHtml=tel?esc(tel):'<span class="muted">Sem telefone</span>';
    const ref=r.kind==='cliente'?(r.contrato||'PendÃªncia financeira'):(r.recibo||r.produto||'Recibo');
    return `<tr><td><b>${esc(r.nome)}</b> ${badge}<br><small>${telHtml}</small></td><td>${esc(ref)}<br><small>${esc(formatParcelaCliente(r.parcela))}</small></td><td><b>${r.valorPago?money(r.valorPago):'â€”'}</b></td><td><button class="yellow small" onclick='preencherCobranca(${JSON.stringify(r).replace(/'/g,"&#39;")})'>Selecionar</button></td></tr>`
  }).join('')||'<tr><td colspan="4">Nenhum cliente ou recibo encontrado.</td></tr>';
}
async function enviarCobrancaSelecionada(){
  if(!cobrancaAlvo){toast('Selecione um cliente ou recibo para cobrar.');return}
  let telefoneAtual=shortPhone(cobrancaAlvo.telefone||'');
  if(!telefoneAtual){
    cobrancaSemTelefoneBox.classList.remove('hidden');
    cobrancaNovoTelefone.focus();
    toast('Informe e salve o celular do cliente antes de enviar.');
    return;
  }
  const payload={tipo:tipoCobranca.value,produto:cobrancaProduto.value,parcela:cobrancaParcela.value,valor:String(cobrancaValor.value).replace(/\./g,'').replace(',','.'),telefone:telefoneAtual};
  const endpoint=cobrancaAlvo.kind==='sige'
    ? '/admin/sige/cobranca'
    : (cobrancaAlvo.kind==='cliente'
      ? '/admin/crediario/clientes/'+encodeURIComponent(cobrancaAlvo.id)+'/cobranca'
      : '/admin/crediario/recibos/'+encodeURIComponent(cobrancaAlvo.id)+'/cobranca');
  if(cobrancaAlvo.kind==='sige'){payload.clienteNome=cobrancaAlvo.nome||cobrancaAlvo.clienteNome||'';payload.documento=cobrancaAlvo.documento||cobrancaAlvo.codigo||'';payload.codigo=cobrancaAlvo.codigo||'';}
  if(!confirm(`Enviar ${tipoCobranca.value==='urgente'?'cobranÃ§a urgente':'cobranÃ§a normal'} para ${cobrancaAlvo.nome||cobrancaAlvo.clienteNome}?`))return;
  try{
    const j=await apiJson(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    toast('CobranÃ§a enviada pelo WhatsApp');
    await loadClientes();
    await loadRecibos();
  }catch(e){
    console.error('Erro ao enviar cobranÃ§a:', e.data || e);
    toast('Erro ao enviar cobranÃ§a: '+(e.message||e));
  }
}



function formatDateBR(v){try{if(!v)return 'â€”';const d=new Date(v);return isNaN(d)?'â€”':d.toLocaleDateString('pt-BR')}catch(_e){return 'â€”'}}
function openCobrancasTab(){const b=document.querySelector(".nav button[onclick*=\"cobrancas\"]");if(b)b.click()}
async function testarSigeStatus(){
  try{
    const [sige, financeiro]=await Promise.all([
      apiJson('/admin/sige/status'),
      apiJson(FINANCEIRO_STATUS_ROUTE)
    ]);
    const sigeHtml=sige.configured
      ? `<b>âœ… SIGE configurado</b><br>API: ${esc(sige.apiUrl)}<br>User: ${esc(sige.user)}<br>App: ${esc(sige.app)}<br>Token: ${sige.tokenConfigured?'configurado':'ausente'}`
      : `<b>âš ï¸ SIGE ainda nÃ£o configurado</b><br>Cadastre no Render: SIGE_API_URL, SIGE_USER, SIGE_APP e SIGE_TOKEN.`;
    const fonteOk=String(financeiro.fonteOficial||'').toLowerCase()==='sige';
    sigeStatusBox.innerHTML=sigeHtml+`<hr style="border:0;border-top:1px solid #e5e7eb;margin:14px 0"><b>${fonteOk?'âœ…':'âš ï¸'} Fonte financeira oficial: ${esc(financeiro.fonteOficial||'nÃ£o informada')}</b><br>Parcelas: ${esc(financeiro.parcelas||'â€”')} â€¢ Saldo: ${esc(financeiro.saldo||'â€”')} â€¢ Pagamentos: ${esc(financeiro.pagamentos||'â€”')}<br><span class="muted">MongoDB: ${esc(financeiro.mongoDb||'histÃ³rico e auditoria')}</span><br><b>${financeiro.baixaSigeBackend?'âœ…':'âš ï¸'} Baixa no SIGE pelo painel: ${financeiro.baixaSigeBackend?'disponÃ­vel':'indisponÃ­vel'}</b><br><span class="muted">Fase: ${esc(financeiro.fase||'â€”')} â€¢ Recibo automÃ¡tico: ${financeiro.reciboAutomatico?'sim':'nÃ£o'} â€¢ WhatsApp automÃ¡tico: ${financeiro.whatsappAutomatico?'sim':'nÃ£o'}</span>`;
  }catch(e){sigeStatusBox.innerHTML='Erro ao testar a integraÃ§Ã£o financeira: '+esc(e.message||e)}
}
async function buscarSigeClientes(){
  const q=(sigeBuscaCliente.value||'').trim();
  if(q.length<2){toast('Digite pelo menos 2 letras para buscar no SIGE.');return}
  sigeClientesBody.innerHTML='<tr><td colspan="4">Consultando SIGE...</td></tr>';
  try{
    const rows=await buscarClientesFinanceiro(q,30);
    window.sigeClientesCache=rows;
    sigeClientesBody.innerHTML=rows.map((c,i)=>`<tr><td><b>${esc(c.nome)}</b><br><small>${esc(c.endereco||'')}</small></td><td>CPF: ${esc(c.cpf)||'â€”'}<br><small>WhatsApp: ${esc(shortPhone(c.telefone))||'â€”'}</small></td><td>${c.inadimplente?'âš ï¸ Inadimplente':'âœ… Sem alerta'}<br><small>${esc(c.cidade||'')} ${esc(c.uf||'')}</small></td><td><button type="button" class="light small" onclick="usarClienteSige(${i})">Usar no recibo</button> <button type="button" class="blue small" onclick="verCarneClienteSige(${i})">ðŸ“‹ CarnÃª</button> <button type="button" class="yellow small" onclick="cobrarClienteSige(${i})">ðŸ”” Cobrar</button></td></tr>`).join('')||'<tr><td colspan="4">Nenhum cliente encontrado no SIGE.</td></tr>';
  }catch(e){sigeClientesBody.innerHTML='<tr><td colspan="4">Erro ao consultar SIGE: '+esc(e.message||e)+'</td></tr>'}
}
function usarClienteSige(i){
  const c=(window.sigeClientesCache||[])[Number(i)]; if(!c)return;
  showTab('novo', document.querySelector(".nav button[onclick*=\"novo\"]"));
  selectedCliente={id:'',nome:c.nome,cpf:c.cpf,telefone:c.telefone,contrato:c.id,endereco:c.endereco,origem:'sige'};
  clienteId.value=''; nome.value=c.nome||''; cpf.value=c.cpf||''; telefone.value=shortPhone(c.telefone||''); contrato.value=c.id||'';
  clienteSelecionado.innerHTML=`âœ… Cliente carregado do SIGE: ${esc(c.nome)}${c.cpf?' â€¢ CPF: '+esc(c.cpf):''}${c.telefone?' â€¢ WhatsApp: '+esc(shortPhone(c.telefone)):''}`;
  clienteSelecionado.classList.remove('hidden');
  if(!telefone.value){clienteAviso.innerHTML='âš ï¸ Este cliente veio do SIGE sem telefone/celular. Preencha e salve o WhatsApp antes de enviar.';clienteAviso.classList.remove('hidden')}else clienteAviso.classList.add('hidden');
  preview(); toast('Cliente do SIGE preenchido no recibo.');
}
function cobrarClienteSige(i){
  const c=(window.sigeClientesCache||[])[Number(i)]; if(!c)return;
  openCobrancasTab();
  setTimeout(()=>preencherCobranca({kind:'sige',nome:c.nome,clienteNome:c.nome,telefone:c.telefone,cpf:c.cpf,produto:'PendÃªncia financeira SIGE',parcela:'',valorPago:0,documento:c.id,codigo:c.id}),120);
}
async function buscarSigeLancamentos(){
  const q=encodeURIComponent(sigeLancBusca.value||''); const st=encodeURIComponent(sigeLancStatus.value||'atrasado');
  sigeLancBody.innerHTML='<tr><td colspan="6">Consultando lanÃ§amentos no SIGE...</td></tr>';
  try{
    const r=await fetch(API_BASE+'/admin/sige/lancamentos?q='+q+'&status='+st+'&limit=1000&maxRecords=4000',{headers:headers()});
    const j=await r.json();
    if(!j.ok){sigeLancBody.innerHTML='<tr><td colspan="6">Erro: '+esc(j.error||'Falha ao consultar SIGE')+'</td></tr>';return}
    renderSigeLancamentos(j.lancamentos||[]);
  }catch(e){sigeLancBody.innerHTML='<tr><td colspan="6">Erro ao consultar SIGE: '+esc(e.message||e)+'</td></tr>'}
}
async function buscarSigeInadimplentes(){
  const q=encodeURIComponent(sigeLancBusca.value||'');
  sigeLancBody.innerHTML='<tr><td colspan="6">Consultando inadimplentes no SIGE...</td></tr>';
  try{
    const r=await fetch(API_BASE+'/admin/sige/inadimplentes?q='+q+'&limit=1000&maxRecords=4000',{headers:headers()});
    const j=await r.json();
    if(!j.ok){sigeLancBody.innerHTML='<tr><td colspan="6">Erro: '+esc(j.error||'Falha ao consultar inadimplentes')+'</td></tr>';return}
    renderSigeLancamentos(j.inadimplentes||[]);
  }catch(e){sigeLancBody.innerHTML='<tr><td colspan="6">Erro ao consultar inadimplentes: '+esc(e.message||e)+'</td></tr>'}
}
function renderSigeLancamentos(rows){
  rows=rows||[];
  window.sigeLancamentosCache=rows;
  const resumo=rows.length?`<tr><td colspan="6"><b>${rows.length}</b> lanÃ§amento(s) encontrado(s) no SIGE.</td></tr>`:'';
  sigeLancBody.innerHTML=resumo+rows.map((l,i)=>{
    const status=l.quitado?'âœ… Quitado':(l.atrasado?'âš ï¸ Atrasado':'ðŸŸ¡ Em aberto');
    const doc=l.documento||l.codigoVenda||l.codigo||'â€”';
    const valor=l.saldo&&l.saldo>0?l.saldo:l.valor;
    return `<tr><td><b>${esc(l.cliente||l.nome)}</b><br><small>${esc(l.telefone?shortPhone(l.telefone):'')}</small></td><td>${esc(doc)}<br><small>${esc(l.descricao||'')}</small></td><td>${formatDateBR(l.dataVencimento)}</td><td><b>${money(valor)}</b><br><small>Recebido: ${money(l.totalRecebido||0)}</small></td><td>${status}</td><td>${(!l.quitado&&Number(l.codigo||0)>0)?`<button type="button" class="green small pay-btn" onclick="abrirPagamentoLancamentoSige(${i})">ðŸ’° Pagar</button> `:''}<button type="button" class="blue small" onclick="verCarneLancamentoSige(${i})">ðŸ“‹ CarnÃª</button> <button type="button" class="yellow small" onclick="cobrarLancamentoSige(${i})">ðŸ”” Cobrar</button></td></tr>`
  }).join('')||(resumo||'<tr><td colspan="6">Nenhum lanÃ§amento encontrado.</td></tr>');
}
function cobrarLancamentoSige(i){
  const l=(window.sigeLancamentosCache||[])[Number(i)]; if(!l)return;
  openCobrancasTab();
  setTimeout(()=>preencherCobranca({kind:'sige',nome:l.cliente||l.nome,clienteNome:l.cliente||l.nome,telefone:l.telefone||'',produto:l.descricao||'PendÃªncia financeira SIGE',parcela:l.documento||'',valorPago:l.saldo&&l.saldo>0?l.saldo:l.valor,documento:l.documento||l.codigo,codigo:l.codigo}),120);
}


function abrirAbaSigeSeguro(){
  const tab=document.getElementById('tab-sige');
  if(tab){document.querySelectorAll('[id^="tab-"]').forEach(e=>e.classList.add('hidden'));tab.classList.remove('hidden')}
  document.querySelectorAll('.nav button').forEach(b=>b.classList.remove('active'));
  const btn=[...document.querySelectorAll('.nav button')].find(b=>(b.textContent||'').toLowerCase().includes('sige'));
  if(btn)btn.classList.add('active');
  try{testarSigeStatus()}catch(_e){}
  setTimeout(()=>{const box=document.getElementById('sigeCarneBusca'); if(box){box.scrollIntoView({behavior:'smooth',block:'center'}); box.focus();}},80);
}
function verCarnePorNome(nomeCliente){
  const nomeLimpo=String(nomeCliente||'').trim();
  if(!nomeLimpo){toast('Cliente nÃ£o informado para gerar carnÃª.');return}
  abrirAbaSigeSeguro();
  const input=document.getElementById('sigeCarneBusca');
  if(input)input.value=nomeLimpo;
  setTimeout(()=>buscarSigeCarne(),180);
}
function verCarneClienteSige(i){
  const c=(window.sigeClientesCache||[])[Number(i)];
  if(!c){toast('NÃ£o consegui carregar este cliente. Pesquise novamente no SIGE.');return}
  verCarnePorNome(c.nome||c.NomeFantasia||c.cliente||'');
}
function verCarneLancamentoSige(i){
  const l=(window.sigeLancamentosCache||[])[Number(i)];
  if(!l){toast('NÃ£o consegui carregar este lanÃ§amento. Pesquise novamente no SIGE.');return}
  verCarnePorNome(l.cliente||l.nome||l.Cliente||'');
}
async function criarOuAtualizarSigeCarne(){
  const input=document.getElementById('sigeCarneBusca');
  const box=document.getElementById('sigeCarneBox');
  const q=(input?.value||'').trim();
  if(q.length<2){toast('Digite pelo menos 2 letras, CPF ou telefone do cliente.');return}
  if(box)box.innerHTML='Consultando o SIGE e sincronizando o carnÃª permanente...';
  try{
    const data=await apiJson('/admin/financeiro/carnes/sincronizar',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({cliente:q,limit:5000,maxRecords:20000})
    });
    const carne=data.carne||{};
    renderSigeCarne({...carne,...(carne.snapshot||{}),cliente:carne.cliente?.nome||'',cpf:carne.cliente?.cpf||'',telefone:carne.cliente?.telefone||'',cidade:carne.cliente?.cidade||'',uf:carne.cliente?.uf||''});
    toast(data.criadoAgora?'CarnÃª criado e salvo com sucesso.':'O mesmo carnÃª foi atualizado com os valores atuais.');
    await buscarCarnesDigitais();
  }catch(e){
    if(box)box.innerHTML='Erro ao sincronizar carnÃª: '+esc(e.message||e);
  }
}

async function buscarSigeCarne(){
  return criarOuAtualizarSigeCarne();
}

async function buscarCarnesDigitais(){
  const tbody=document.getElementById('sigeCarnesDigitaisBody');
  const q=(document.getElementById('sigeCarneListaBusca')?.value||document.getElementById('sigeCarneBusca')?.value||'').trim();
  if(tbody)tbody.innerHTML='<tr><td colspan="6">Carregando carnÃªs...</td></tr>';
  try{
    const data=await apiJson('/admin/financeiro/carnes?q='+encodeURIComponent(q)+'&page=1&limit=50');
    const rows=Array.isArray(data.carnes)?data.carnes:[];
    if(!rows.length){
      if(tbody)tbody.innerHTML='<tr><td colspan="6">Nenhum carnÃª digital salvo foi encontrado.</td></tr>';
      return;
    }
    if(tbody)tbody.innerHTML=rows.map(c=>{
      const r=c.resumo||{};
      const nome=c.cliente?.nome||'Cliente';
      return `<tr>
        <td><b>${esc(c.codigo||'')}</b></td>
        <td><span class="client-name">${esc(nome)}</span><span class="client-phone">${esc(c.cliente?.cpf||c.cliente?.telefone||'')}</span></td>
        <td>${Number(r.parcelas||0)}<br><small>${Number(r.pagas||0)} pagas â€¢ ${Number(r.atrasadas||0)} atrasadas</small></td>
        <td class="money-cell">${money(r.saldo||0)}</td>
        <td>${c.ultimaSincronizacaoEm?new Date(c.ultimaSincronizacaoEm).toLocaleString('pt-BR'):'â€”'}</td>
        <td><div class="row-actions">
          <button class="light small" onclick="abrirCarneDigital('${esc(c.id)}')">Abrir</button>
          <button class="blue small" onclick="atualizarCarneDigital('${esc(c.id)}')">Atualizar</button>
        </div></td>
      </tr>`;
    }).join('');
  }catch(e){
    if(tbody)tbody.innerHTML='<tr><td colspan="6">Erro: '+esc(e.message||e)+'</td></tr>';
  }
}

async function abrirCarneDigital(id){
  const box=document.getElementById('sigeCarneBox');
  if(box)box.innerHTML='Abrindo carnÃª salvo...';
  try{
    const data=await apiJson('/admin/financeiro/carnes/'+encodeURIComponent(id));
    const c=data.carne||{};
    document.getElementById('sigeCarneBusca').value=c.cliente?.nome||c.cliente?.cpf||'';
    renderSigeCarne({...c,...(c.snapshot||{}),cliente:c.cliente?.nome||'',cpf:c.cliente?.cpf||'',telefone:c.cliente?.telefone||'',cidade:c.cliente?.cidade||'',uf:c.cliente?.uf||''});
  }catch(e){
    if(box)box.innerHTML='Erro ao abrir carnÃª: '+esc(e.message||e);
  }
}

async function atualizarCarneDigital(id){
  const box=document.getElementById('sigeCarneBox');
  if(box)box.innerHTML='Atualizando o mesmo carnÃª com os dados atuais do SIGE...';
  try{
    const data=await apiJson('/admin/financeiro/carnes/'+encodeURIComponent(id)+'/sincronizar',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({limit:5000,maxRecords:20000})
    });
    const c=data.carne||{};
    renderSigeCarne({...c,...(c.snapshot||{}),cliente:c.cliente?.nome||'',cpf:c.cliente?.cpf||'',telefone:c.cliente?.telefone||'',cidade:c.cliente?.cidade||'',uf:c.cliente?.uf||''});
    toast('CarnÃª atualizado sem criar outro registro.');
    await buscarCarnesDigitais();
  }catch(e){
    if(box)box.innerHTML='Erro ao atualizar carnÃª: '+esc(e.message||e);
  }
}

function calcularAtualizacaoParcela(valorOriginal, vencimento, status=''){
  const original=Math.max(0,Number(valorOriginal||0));
  const pago=String(status||'').toLowerCase()==='paga'||String(status||'').toLowerCase()==='quitado';
  const due=vencimento?new Date(String(vencimento).slice(0,10)+'T00:00:00'):null;
  const hoje=new Date(); hoje.setHours(0,0,0,0);
  if(pago||!due||Number.isNaN(due.getTime())||hoje<=due){return{original,diasAtraso:0,multa:0,juros:0,atualizado:original};}
  const diasAtraso=Math.max(0,Math.floor((hoje-due)/86400000));
  const multa=Math.round(original*0.02*100)/100;
  const juros=Math.round(original*0.01*diasAtraso/30*100)/100;
  return{original,diasAtraso,multa,juros,atualizado:Math.round((original+multa+juros)*100)/100};
}
function resumoAtualizadoCarne(grupos=[]){
  const parcelas=grupos.flatMap(g=>g.parcelas||[]);
  return parcelas.reduce((a,p)=>{
    const status=String(p.status||'').toLowerCase();
    const pago=status==='paga'||status==='quitado';
    const base=Number(p.saldoParcela??p.valorParcela??p.saldo??p.valor??0);
    const c=calcularAtualizacaoParcela(base,p.dataVencimento,status);
    if(pago){a.pagas++;a.totalPago+=Number(p.valorParcela||p.valor||0);return a;}
    a.saldoOriginal+=c.original;a.multas+=c.multa;a.juros+=c.juros;a.saldoAtualizado+=c.atualizado;
    if(c.diasAtraso>0)a.vencidas++;else a.aVencer++;
    return a;
  },{saldoOriginal:0,multas:0,juros:0,saldoAtualizado:0,pagas:0,vencidas:0,aVencer:0,totalPago:0});
}
function renderSigeCarne(carne){
  const box=document.getElementById('sigeCarneBox');
  const resumo=carne.resumo||{};
  const grupos=carne.grupos||[];
  const atualizado=resumoAtualizadoCarne(grupos);
  if(!grupos.length){
    if(box)box.innerHTML='Nenhuma parcela encontrada para este cliente. Tente pesquisar o nome completo exatamente como estÃ¡ no SIGE ou clique primeiro em Buscar cliente e depois no botÃ£o CarnÃª.';
    return;
  }
  window.sigeCarneParcelasCache=[];
  window.sigeCarneAtual=carne;
  let html=`<div class="brand">Ariana MÃ³veis</div><p><b>CarnÃª Digital SIGE</b></p>
    ${carne.codigo?`<div class="row"><span>CÃ³digo permanente</span><span><b>${esc(carne.codigo)}</b></span></div>`:''}
    ${carne.ultimaSincronizacaoEm?`<div class="row"><span>Ãšltima sincronizaÃ§Ã£o</span><span>${new Date(carne.ultimaSincronizacaoEm).toLocaleString('pt-BR')}</span></div>`:''}
    <div class="row"><span>Cliente</span><span>${esc(carne.cliente||'')}</span></div>
    <div class="row"><span>CPF</span><span>${esc(carne.cpf||'â€”')}</span></div>
    <div class="row"><span>WhatsApp</span><span>${esc(shortPhone(carne.telefone)||'â€”')}</span></div>
    <div class="row"><span>Total lanÃ§ado</span><span>${money(resumo.total||0)}</span></div>
    <div class="row"><span>Total pago</span><span>${money(resumo.pago||0)}</span></div>
    <div class="row"><span>Saldo original em aberto</span><span>${money(atualizado.saldoOriginal)}</span></div>
    <div class="row"><span>Multas acumuladas</span><span>${money(atualizado.multas)}</span></div>
    <div class="row"><span>Juros acumulados</span><span>${money(atualizado.juros)}</span></div>
    <div class="row"><span>Saldo atualizado</span><span class="money">${money(atualizado.saldoAtualizado)}</span></div>
    <div class="row"><span>Parcelas</span><span>${resumo.parcelas||0} total â€¢ ${atualizado.pagas} pagas â€¢ ${atualizado.vencidas} vencidas â€¢ ${atualizado.aVencer} a vencer</span></div>
    <div class="actions" style="margin-top:12px">
      ${carne.id?`<button type="button" class="blue" onclick="atualizarCarneDigital('${esc(carne.id)}')">ðŸ”„ Atualizar valores</button>`:''}
      <button type="button" class="green" onclick="enviarCarneWhatsapp()">ðŸ“² Enviar carnÃª pelo WhatsApp</button>
    </div>`;
  grupos.forEach((g)=>{
    html+=`<div style="margin-top:16px;padding-top:12px;border-top:1px solid #e5e7eb"><b>${esc(g.documento||'Sem documento')}</b><br><small>${esc(g.descricao||'')}</small>
      <div class="muted">Total: ${money(g.total||0)} â€¢ Pago: ${money(g.pago||0)} â€¢ Saldo: ${money(g.saldo||0)} â€¢ Atrasadas: ${g.atrasadas||0}</div>
      <table style="margin-top:8px"><thead><tr><th>Parcela</th><th>Vencimento</th><th>Original</th><th>Multa</th><th>Juros</th><th>Atualizado</th><th>Status</th><th>AÃ§Ã£o</th></tr></thead><tbody>`;
    (g.parcelas||[]).forEach((p)=>{
      const st=p.status==='paga'?'âœ… Paga':(p.status==='atrasada'?'âš ï¸ Atrasada':'â³ Aberta');
      const canCobrar=p.status!=='paga';
      const idx=window.sigeCarneParcelasCache.push({...p,telefone:carne.telefone,cpf:carne.cpf})-1;
      const canPagar=canCobrar&&Number(p.codigo||0)>0&&Number(p.saldoParcela||p.saldo||0)>0;
      const calc=calcularAtualizacaoParcela(Number(p.saldoParcela??p.valorParcela??0),p.dataVencimento,p.status);
      window.sigeCarneParcelasCache[idx]={...window.sigeCarneParcelasCache[idx],calculoAtualizacao:calc};
      const atraso=calc.diasAtraso>0?`<br><small style="color:#b91c1c">${calc.diasAtraso} dia(s) em atraso</small>`:'';
      html+=`<tr><td>${esc(p.parcelaLabel||'')}</td><td>${formatDateBR(p.dataVencimento)}${atraso}</td><td>${money(calc.original)}</td><td>${money(calc.multa)}</td><td>${money(calc.juros)}</td><td><b>${money(calc.atualizado)}</b></td><td>${st}</td><td>${canPagar?`<button type="button" class="green small pay-btn" onclick="abrirPagamentoParcelaCarne(${idx})">ðŸ’° Registrar pagamento</button> `:''}${canCobrar?`<button type="button" class="yellow small" onclick="cobrarParcelaCarne(${idx})">ðŸ”” Cobrar</button>`:'â€”'}</td></tr>`;
    });
    html+='</tbody></table></div>';
  });
  if(box)box.innerHTML=html;
}

async function enviarCarneWhatsapp(){
  const carne=window.sigeCarneAtual||null;
  if(!carne||!carne.cliente){toast('Gere o carnÃª antes de enviar.');return}
  let tel=shortPhone(carne.telefone||'');
  if(!tel){
    tel=prompt('Este cliente nÃ£o tem WhatsApp salvo. Digite o celular para enviar o carnÃª:','');
    if(!tel){toast('Envio cancelado.');return}
  }
  try{
    toast('Enviando carnÃª pelo WhatsApp...');
    await apiJson('/admin/sige/carne/enviar-whatsapp',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({cliente:carne.cliente,telefone:tel,limit:5000,maxRecords:20000})
    });
    toast('CarnÃª enviado pelo WhatsApp com sucesso.');
  }catch(e){
    console.error('Erro ao enviar carnÃª:', e.data || e);
    toast('Erro ao enviar carnÃª: '+(e.message||e));
  }
}


let sigePagamentoAlvo=null;
let sigePagamentoEnviando=false;

function parseMoneyInput(v){
  const raw=String(v??'').trim();
  if(!raw)return 0;
  const normalized=raw.includes(',')
    ? raw.replace(/\./g,'').replace(',','.')
    : raw;
  const n=Number(normalized);
  return Number.isFinite(n)?n:0;
}
function moneyInput(v){
  return Number(v||0).toFixed(2).replace('.',',');
}
function gerarDocumentoPagamentoSige(codigo){
  const d=new Date();
  const stamp=[
    d.getFullYear(),
    String(d.getMonth()+1).padStart(2,'0'),
    String(d.getDate()).padStart(2,'0'),
    String(d.getHours()).padStart(2,'0'),
    String(d.getMinutes()).padStart(2,'0'),
    String(d.getSeconds()).padStart(2,'0')
  ].join('');
  return `ARIANA-${codigo}-${stamp}`;
}
function normalizarAlvoPagamentoSige(item={}){
  const saldo=Number(item.saldoParcela??item.saldo??0);
  return {
    codigo:Number(item.codigo||item.Codigo||item.codigoLancamento||0),
    cliente:String(item.cliente||item.nome||item.Cliente||'').trim(),
    documento:String(item.documento||item.NumeroDocumento||item.parcelaLabel||'').trim(),
    descricao:String(item.descricao||item.Descricao||'').trim(),
    vencimento:item.dataVencimento||item.DataVencimento||null,
    saldo:Math.max(0,Number.isFinite(saldo)?saldo:0),
    quitado:item.quitado===true||item.Quitado===true,
    telefone:shortPhone(item.telefone||item.Telefone||''),
    cpf:String(item.cpf||item.CPF||item.CpfCnpj||'').trim(),
    contrato:String(item.contrato||item.codigoContrato||item.CodigoContrato||item.codigoVenda||item.CodigoVenda||'').trim(),
    parcela:String(item.parcelaLabel||item.documento||item.NumeroDocumento||'').trim(),
    calculoAtualizacao:item.calculoAtualizacao||calcularAtualizacaoParcela(Math.max(0,Number.isFinite(saldo)?saldo:0),item.dataVencimento||item.DataVencimento,item.status||'')
  };
}
function abrirPagamentoSige(item){
  const alvo=normalizarAlvoPagamentoSige(item);
  if(!Number.isInteger(alvo.codigo)||alvo.codigo<=0){toast('Este lanÃ§amento nÃ£o possui cÃ³digo vÃ¡lido do SIGE.');return}
  if(alvo.quitado||alvo.saldo<=0){toast('Esta parcela jÃ¡ estÃ¡ quitada no SIGE.');return}
  sigePagamentoAlvo=alvo;
  sigePayCodigo.value=String(alvo.codigo);
  const calc=alvo.calculoAtualizacao||calcularAtualizacaoParcela(alvo.saldo,alvo.vencimento,'');
  alvo.valorAtualizado=calc.atualizado;
  sigePaySaldo.value=money(calc.atualizado);
  sigePayValor.value=moneyInput(calc.atualizado);
  sigePayData.value=localDateInputValue();
  sigePayForma.value='PIX';
  sigePayConta.value='ariana moveis';
  sigePayDocumento.value=gerarDocumentoPagamentoSige(alvo.codigo);
  sigePagamentoResumo.innerHTML=`<div class="row"><strong>Cliente</strong><span>${esc(alvo.cliente||'â€”')}</span></div><div class="row"><strong>Documento/parcela</strong><span>${esc(alvo.documento||'â€”')}</span></div><div class="row"><strong>DescriÃ§Ã£o</strong><span>${esc(alvo.descricao||'â€”')}</span></div><div class="row"><strong>Vencimento</strong><span>${formatDateBR(alvo.vencimento)}</span></div><div class="row"><strong>Valor original</strong><span>${money(calc.original)}</span></div><div class="row"><strong>Multa (2%)</strong><span>${money(calc.multa)}</span></div><div class="row"><strong>Juros (1% a.m. proporcional)</strong><span>${money(calc.juros)}</span></div><div class="row"><strong>Dias em atraso</strong><span>${calc.diasAtraso}</span></div><div class="row"><strong>Valor atualizado</strong><span class="money">${money(calc.atualizado)}</span></div>`;
  sigePagamentoOverlay.classList.remove('hidden');
  setTimeout(()=>sigePayValor.focus(),80);
}
function abrirPagamentoParcelaCarne(idx){
  const p=(window.sigeCarneParcelasCache||[])[Number(idx)];
  if(!p){toast('Parcela nÃ£o encontrada.');return}
  abrirPagamentoSige(p);
}
function abrirPagamentoLancamentoSige(idx){
  const l=(window.sigeLancamentosCache||[])[Number(idx)];
  if(!l){toast('LanÃ§amento nÃ£o encontrado.');return}
  abrirPagamentoSige(l);
}
function fecharPagamentoSige(){
  if(sigePagamentoEnviando)return;
  sigePagamentoOverlay.classList.add('hidden');
  sigePagamentoAlvo=null;
}
async function confirmarPagamentoSige(){
  if(sigePagamentoEnviando)return;
  const alvo=sigePagamentoAlvo;
  if(!alvo){toast('Selecione uma parcela do SIGE.');return}
  const valorPagamento=parseMoneyInput(sigePayValor.value);
  const formaPagamento=String(sigePayForma.value||'').trim();
  const contaBancaria=String(sigePayConta.value||'').trim();
  const numeroDocumento=String(sigePayDocumento.value||'').trim();
  const dataPagamento=String(sigePayData.value||'').trim();

  if(!Number.isFinite(valorPagamento)||valorPagamento<=0){toast('Informe um valor de pagamento vÃ¡lido.');sigePayValor.focus();return}
  if(valorPagamento>Number(alvo.valorAtualizado||alvo.saldo)+0.009){toast('O pagamento nÃ£o pode ultrapassar o valor atualizado de '+money(alvo.valorAtualizado||alvo.saldo)+'.');sigePayValor.focus();return}
  if(!formaPagamento){toast('Selecione a forma de pagamento.');return}
  if(!contaBancaria){toast('Selecione a conta bancÃ¡ria.');return}
  if(!numeroDocumento){toast('Informe o nÃºmero do documento.');sigePayDocumento.focus();return}
  if(!dataPagamento){toast('Informe a data do pagamento.');return}

  if(!confirm(`Confirmar pagamento de ${money(valorPagamento)} no lanÃ§amento ${alvo.codigo} do SIGE?\n\nCliente: ${alvo.cliente||'â€”'}\nDocumento: ${numeroDocumento}`))return;

  sigePagamentoEnviando=true;
  sigePayConfirmar.disabled=true;
  const textoOriginal=sigePayConfirmar.textContent;
  sigePayConfirmar.textContent='â³ Registrando no SIGE...';

  try{
    const resultado=await apiJson('/admin/financeiro/lancamentos/'+encodeURIComponent(alvo.codigo)+'/pagamentos',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        valor:valorPagamento,
        formaPagamento,
        contaBancaria,
        numeroDocumento,
        dataPagamento,
        conciliado:true,
        enviarWhatsapp:true,
        clienteNome:alvo.cliente,
        telefone:alvo.telefone,
        cpf:alvo.cpf,
        contrato:alvo.contrato,
        produto:alvo.descricao||'Pagamento de parcela SIGE',
        parcela:alvo.parcela||alvo.documento
      })
    });

    if(resultado.reciboCriado){
      lastRecibo=resultado.recibo||null;
      if(resultado.whatsappEnviado){
        toast(resultado.message||'Pagamento, recibo e WhatsApp concluÃ­dos com sucesso.');
      }else{
        const motivo=resultado.whatsapp?.reason==='cliente_sem_whatsapp'
          ? ' Cliente sem WhatsApp cadastrado.'
          : '';
        toast((resultado.message||'Pagamento e recibo concluÃ­dos, mas o WhatsApp nÃ£o foi enviado.')+motivo);
      }
    }else{
      toast(resultado.message||'Pagamento confirmado no SIGE, mas o recibo nÃ£o foi criado.');
    }

    sigePagamentoOverlay.classList.add('hidden');
    sigePagamentoAlvo=null;

    await Promise.allSettled([loadRecibos(),loadClientes()]);

    const buscaCarne=(document.getElementById('sigeCarneBusca')?.value||'').trim();
    if(buscaCarne){
      await buscarSigeCarne();
    }
    const buscaLanc=(document.getElementById('sigeLancBusca')?.value||'').trim();
    if(document.getElementById('tab-sige')&&!document.getElementById('tab-sige').classList.contains('hidden')&&buscaLanc){
      await buscarSigeLancamentos();
    }
  }catch(e){
    console.error('Erro ao registrar pagamento no SIGE:',e.data||e);
    toast('Pagamento nÃ£o registrado: '+(e.message||e));
  }finally{
    sigePagamentoEnviando=false;
    sigePayConfirmar.disabled=false;
    sigePayConfirmar.textContent=textoOriginal;
  }
}
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&!sigePagamentoOverlay.classList.contains('hidden'))fecharPagamentoSige();
});
sigePagamentoOverlay.addEventListener('click',e=>{
  if(e.target===sigePagamentoOverlay)fecharPagamentoSige();
});


function cobrarParcelaCarne(idx){
  const p=(window.sigeCarneParcelasCache||[])[Number(idx)]; if(!p){toast('Parcela nÃ£o encontrada.');return}
  openCobrancasTab();
  setTimeout(()=>preencherCobranca({kind:'sige',nome:p.cliente,clienteNome:p.cliente,telefone:p.telefone||'',produto:p.descricao||'PendÃªncia financeira SIGE',parcela:p.parcelaLabel||p.documento||'',valorPago:p.saldoParcela||p.valorParcela||0,documento:p.documento||p.codigo,codigo:p.codigo}),120);
}


async function loadSigeInadimplentesCentral(){
  const body=document.getElementById('inadBody');
  const q=(document.getElementById('inadBusca')?.value||'').trim();
  if(body)body.innerHTML='<tr><td colspan="6">Consultando inadimplentes no SIGE...</td></tr>';
  try{
    const url=API_BASE+'/admin/sige/inadimplentes?q='+encodeURIComponent(q)+'&limit=1000&maxRecords=20000';
    const r=await fetch(url,{headers:headers()});
    const j=await r.json();
    if(!j.ok){
      if(body)body.innerHTML='<tr><td colspan="6">Erro: '+esc(j.error||'Falha ao consultar inadimplentes')+'</td></tr>';
      return;
    }
    renderSigeInadimplentesCentral(j);
  }catch(e){
    if(body)body.innerHTML='<tr><td colspan="6">Erro ao consultar inadimplentes: '+esc(e.message||e)+'</td></tr>';
  }
}
function limparBuscaInadimplentes(){
  const input=document.getElementById('inadBusca');
  if(input)input.value='';
  loadSigeInadimplentesCentral();
}
function renderSigeInadimplentesCentral(j){
  const rows=Array.isArray(j.inadimplentes)?j.inadimplentes:[];
  window.sigeInadimplentesCache=rows;
  const resumo=j.resumo||{};
  const clientes=resumo.clientes||new Set(rows.map(r=>String(r.nome||r.cliente||'').toLowerCase()).filter(Boolean)).size;
  const parcelas=resumo.parcelas||rows.length;
  const valor=resumo.valorTotal!==undefined?resumo.valorTotal:rows.reduce((s,r)=>s+Number((r.saldo&&r.saldo>0)?r.saldo:(r.valor||0)),0);
  if(document.getElementById('inadClientes'))inadClientes.textContent=clientes;
  if(document.getElementById('inadParcelas'))inadParcelas.textContent=parcelas;
  if(document.getElementById('inadValor'))inadValor.textContent=money(valor);
  const antiga=resumo.parcelaMaisAntiga||null;
  if(document.getElementById('inadResumoExtra')){
    inadResumoExtra.innerHTML=antiga
      ? `<b>Parcela mais antiga:</b> ${esc(antiga.cliente||'')} â€¢ ${formatDateBR(antiga.dataVencimento)} â€¢ ${Number(antiga.diasAtraso||0)} dia(s) â€¢ ${money(antiga.valor||0)}`
      : 'Nenhuma parcela vencida encontrada.';
  }
  const body=document.getElementById('inadBody');
  if(!body)return;
  body.innerHTML=rows.map((r,i)=>{
    const nome=r.nome||r.cliente||'';
    const tel=shortPhone(r.telefone||'');
    const valorItem=(r.saldo&&r.saldo>0)?r.saldo:r.valor;
    const dias=Number(r.diasAtraso||0);
    const descricao=String(r.descricao||'');
    const doc=esc(r.documento||r.codigoVenda||r.codigo||'â€”');
    const descHtml=esc(descricao).replace(/(valor de R\$\s*[0-9.,]+)/i,'<span class="pedido-total">$1</span>');
    return `<tr>
      <td><div class="inad-client-name">${esc(nome)}</div><small>${tel?'<span class="inad-phone">WhatsApp: '+esc(tel)+'</span>':'<span class="inad-no-phone">Sem WhatsApp</span>'}${r.cpf?' â€¢ CPF '+esc(r.cpf):''}</small></td>
      <td class="inad-doc"><b>${doc}</b><small>${descHtml}</small></td>
      <td>${formatDateBR(r.dataVencimento)}</td>
      <td><span class="inad-days">${dias}</span><br><small>dia(s)</small></td>
      <td><span class="inad-value">${money(valorItem||0)}</span></td>
      <td>
        <div class="inad-actions">
          <button type="button" class="blue small" onclick="verCarneInadimplente(${i})">ðŸ“‹ CarnÃª</button>
          <button type="button" class="green small" onclick="enviarCarneInadimplente(${i})">ðŸ“² Enviar</button>
          <button type="button" class="yellow small" onclick="cobrarInadimplente(${i},'normal')">ðŸ”” Normal</button>
          <button type="button" class="red small" onclick="cobrarInadimplente(${i},'urgente')">ðŸš¨ Urgente</button>
        </div>
      </td>
    </tr>`;
  }).join('')||'<tr><td colspan="6">Nenhum inadimplente encontrado.</td></tr>';
}
function verCarneInadimplente(i){
  const r=(window.sigeInadimplentesCache||[])[Number(i)];
  if(!r){toast('Registro nÃ£o encontrado.');return}
  verCarnePorNome(r.nome||r.cliente||'');
}
function cobrarInadimplente(i,tipo='normal'){
  const r=(window.sigeInadimplentesCache||[])[Number(i)];
  if(!r){toast('Registro nÃ£o encontrado.');return}
  openCobrancasTab();
  setTimeout(()=>{
    preencherCobranca({kind:'sige',nome:r.nome||r.cliente,clienteNome:r.nome||r.cliente,telefone:r.telefone||'',produto:r.descricao||'Parcela vencida SIGE',parcela:r.documento||r.codigo||'',valorPago:(r.saldo&&r.saldo>0)?r.saldo:r.valor,documento:r.documento||r.codigo,codigo:r.codigo});
    const tipoBox=document.getElementById('tipoCobranca');
    if(tipoBox){tipoBox.value=tipo;previewCobranca();}
  },120);
}
async function enviarCarneInadimplente(i){
  const r=(window.sigeInadimplentesCache||[])[Number(i)];
  if(!r){toast('Registro nÃ£o encontrado.');return}
  let tel=shortPhone(r.telefone||'');
  if(!tel){
    tel=prompt('Este cliente nÃ£o tem WhatsApp salvo no SIGE. Digite o celular para enviar o carnÃª:','');
    if(!tel){toast('Envio cancelado.');return}
  }
  try{
    toast('Enviando carnÃª pelo WhatsApp...');
    await apiJson('/admin/sige/carne/enviar-whatsapp',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({cliente:r.nome||r.cliente,telefone:tel,limit:5000,maxRecords:20000})
    });
    toast('CarnÃª enviado pelo WhatsApp.');
  }catch(e){
    console.error('Erro ao enviar carnÃª inadimplente:', e.data || e);
    toast('Erro ao enviar carnÃª: '+(e.message||e));
  }
}



async function loadAutoCobrancaConfig(){
  const box=document.getElementById('autoCobrancaConfig');
  if(box)box.innerHTML='Carregando configuraÃ§Ã£o...';
  try{
    const j=await apiJson('/admin/sige/cobranca-automatica/config');
    if(box)box.innerHTML=`<b>Status automÃ¡tico no servidor:</b> ${j.enabled?'ATIVADO':'DESATIVADO'}<br><b>HorÃ¡rio:</b> ${String(j.hour).padStart(2,'0')}:00<br><b>Regras:</b><br>${(j.rules||[]).map(r=>'â€¢ '+esc(r.label)).join('<br>')}<br><br><small>${esc(j.antiRepeticao||'')}</small>`;
  }catch(e){if(box)box.innerHTML='Erro: '+esc(e.message||e)}
}
function renderAutoCobrancaRows(rows=[]){
  const body=document.getElementById('autoCobBody'); if(!body)return;
  body.innerHTML=rows.map(r=>`<tr><td><b>${esc(r.nome||r.cliente||'')}</b></td><td>${esc(r.documento||r.codigo||'')}</td><td>${Number(r.diasAtraso||0)}</td><td><b>${esc(r.tipo||'')}</b></td><td>${r.telefone?esc(shortPhone(r.telefone)):'<span class="muted">Sem telefone</span>'}</td><td>${r.podeEnviar?'âœ… Pode enviar':esc(r.motivoBloqueio||'â€”')}</td></tr>`).join('')||'<tr><td colspan="6">Nenhum candidato encontrado.</td></tr>';
}
async function simularAutoCobranca(){
  const q=(document.getElementById('autoCobBusca')?.value||'').trim();
  const limit=Number(document.getElementById('autoCobLimit')?.value||100);
  const resumo=document.getElementById('autoCobResumo');
  if(resumo)resumo.innerHTML='Simulando cobranÃ§as...';
  try{
    const j=await apiJson('/admin/sige/cobranca-automatica/simular',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({q,limit})});
    const s=j.resumo||{};
    if(resumo)resumo.innerHTML=`<b>Total candidatos:</b> ${j.total||0}<br><b>Podem enviar:</b> ${s.podeEnviar||0}<br><b>Sem telefone:</b> ${s.semTelefone||0}<br><b>JÃ¡ enviados hoje:</b> ${s.jaEnviadoHoje||0}`;
    renderAutoCobrancaRows(j.candidatos||[]);
  }catch(e){if(resumo)resumo.innerHTML='Erro: '+esc(e.message||e)}
}
async function executarAutoCobranca(){
  if(!confirm('Enviar cobranÃ§as automÃ¡ticas agora para os clientes elegÃ­veis?'))return;
  const q=(document.getElementById('autoCobBusca')?.value||'').trim();
  const limit=Number(document.getElementById('autoCobLimit')?.value||100);
  const resumo=document.getElementById('autoCobResumo');
  if(resumo)resumo.innerHTML='Enviando cobranÃ§as, aguarde...';
  try{
    const j=await apiJson('/admin/sige/cobranca-automatica/executar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({q,limit,dryRun:false})});
    const s=j.resumo||{};
    if(resumo)resumo.innerHTML=`<b>ConcluÃ­do.</b><br>Enviados: ${s.enviados||0}<br>Ignorados: ${s.ignorados||0}<br>Erros: ${s.erros||0}`;
    renderAutoCobrancaRows(j.resultados||[]);
    toast('CobranÃ§a automÃ¡tica concluÃ­da. Enviados: '+(s.enviados||0));
  }catch(e){if(resumo)resumo.innerHTML='Erro: '+esc(e.message||e)}
}

function credCobMoney(cents){return (Number(cents||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}
function credCobStatus(v=''){return ({SIMULATED:'Simulado',SENT:'Enviado',QUEUED:'Na fila',SKIPPED:'Ignorado',ERROR:'Erro'})[String(v).toUpperCase()]||v||'â€”'}
function renderCrediarioCobrancaRows(rows=[]){
  const body=document.getElementById('credCobBody');if(!body)return;
  body.innerHTML=rows.map(r=>`<tr><td><b>${esc(r.customerName||'â€”')}</b><br><small>${esc(r.customerDocument||r.orderId||'')}</small></td><td>${String(r.installmentNumber||0).padStart(2,'0')}/${String(r.installmentCount||0).padStart(2,'0')}</td><td>${esc((r.dueDate||'').split('-').reverse().join('/'))}</td><td>${esc(r.ruleLabel||r.ruleKey||'')}</td><td>${credCobMoney(r.originalCents)}</td><td><b>${credCobMoney(r.updatedCents)}</b></td><td>${r.phone?esc(shortPhone(r.phone)):'<span class="muted">Sem telefone</span>'}</td><td>${r.canSend===false?esc(r.blockReason||credCobStatus(r.status)):credCobStatus(r.status||'SIMULATED')}</td></tr>`).join('')||'<tr><td colspan="8">Nenhuma cobranÃ§a elegÃ­vel para a data informada.</td></tr>';
}
async function loadCrediarioCobrancaConfig(){
  const box=document.getElementById('credCobConfig');if(box)box.innerHTML='Carregando...';
  try{const j=await apiJson('/admin/crediario/cobranca-automatica/config');if(box)box.innerHTML=`<b>AutomaÃ§Ã£o:</b> ${j.enabled?'ATIVADA':'DESATIVADA'} &nbsp; <b>HorÃ¡rio:</b> ${String(j.hour).padStart(2,'0')}:00 &nbsp; <b>Fuso:</b> ${esc(j.timezone||'')}<br><b>WhatsApp:</b> ${j.providerConfigured?'Configurado':'Aguardando CREDIARIO_NOTIFICATION_URL'}<br><b>Regras:</b> ${(j.rules||[]).map(r=>esc(r.label)).join(' â€¢ ')}<br><small>${esc(j.antiDuplication||'')}</small>`}catch(e){if(box)box.innerHTML='Erro: '+esc(e.message||e)}
}
async function simularCrediarioCobranca(){
  const resumo=document.getElementById('credCobResumo');if(resumo)resumo.innerHTML='Simulando...';
  try{const body={q:(document.getElementById('credCobBusca')?.value||'').trim(),limit:Number(document.getElementById('credCobLimit')?.value||200),referenceDate:document.getElementById('credCobData')?.value||undefined};const j=await apiJson('/admin/crediario/cobranca-automatica/simular',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const x=j.summary||{};if(resumo)resumo.innerHTML=`<b>ElegÃ­veis:</b> ${x.total||0} &nbsp; <b>Podem enviar:</b> ${x.canSend||0} &nbsp; <b>Sem telefone:</b> ${x.withoutPhone||0} &nbsp; <b>JÃ¡ enviados:</b> ${x.duplicate||0}<br><b>Valor atualizado da seleÃ§Ã£o:</b> ${credCobMoney(x.totalUpdatedCents)}`;renderCrediarioCobrancaRows(j.candidates||[])}catch(e){if(resumo)resumo.innerHTML='Erro: '+esc(e.message||e)}
}
async function executarCrediarioCobranca(){
  if(!confirm('Processar agora as cobranÃ§as elegÃ­veis do CrediÃ¡rio Ariana?'))return;
  const resumo=document.getElementById('credCobResumo');if(resumo)resumo.innerHTML='Processando cobranÃ§as...';
  try{const body={q:(document.getElementById('credCobBusca')?.value||'').trim(),limit:Number(document.getElementById('credCobLimit')?.value||200),referenceDate:document.getElementById('credCobData')?.value||undefined,dryRun:false};const j=await apiJson('/admin/crediario/cobranca-automatica/executar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const x=j.summary||{};if(resumo)resumo.innerHTML=`<b>ConcluÃ­do:</b> enviados ${x.sent||0}, na fila ${x.queued||0}, ignorados ${x.skipped||0}, erros ${x.errors||0}.`;renderCrediarioCobrancaRows(j.results||[]);toast('CobranÃ§a do CrediÃ¡rio processada.')}catch(e){if(resumo)resumo.innerHTML='Erro: '+esc(e.message||e)}
}
async function loadCrediarioCobrancaHistorico(){
  const resumo=document.getElementById('credCobResumo');if(resumo)resumo.innerHTML='Carregando histÃ³rico...';
  try{const q=(document.getElementById('credCobBusca')?.value||'').trim();const j=await apiJson('/admin/crediario/cobranca-automatica/historico?limit=200'+(q?'&q='+encodeURIComponent(q):''));const rows=(j.logs||[]).map(r=>({...r,canSend:true,ruleLabel:r.ruleKey}));if(resumo)resumo.innerHTML=`<b>HistÃ³rico:</b> ${rows.length} registro(s) mais recente(s).`;renderCrediarioCobrancaRows(rows)}catch(e){if(resumo)resumo.innerHTML='Erro: '+esc(e.message||e)}
}

async function reenviar(id){
  try{
    await apiJson('/admin/crediario/recibos/'+encodeURIComponent(id)+'/enviar-whatsapp',{
      method:'POST',
      headers:{'Content-Type':'application/json'}
    });
    toast('Enviado pelo WhatsApp');
    await loadRecibos();
  }catch(e){
    console.error('Erro ao reenviar recibo pelo WhatsApp:', e.data || e);
    toast('Erro ao enviar WhatsApp: '+(e.message||e));
  }
}

function setHealth(id,state,detail){
  const el=document.getElementById(id);if(!el)return;
  el.classList.remove('ok','warn','error');el.classList.add(state);
  const small=el.querySelector('small');if(small)small.textContent=detail||'';
}
async function loadSystemHealth(){
  setHealth('healthBackend','warn','Consultando...');
  setHealth('healthMongo','warn','Consultando...');
  setHealth('healthSige','warn','Consultando...');
  setHealth('healthWhatsapp','warn','Consultando...');
  setHealth('healthFinanceiro','warn','Consultando...');
  try{
    const d=await apiJson('/admin/financeiro/diagnostico');
    setHealth('healthBackend','ok','Online');
    setHealth('healthMongo',d.mongo?.connected?'ok':'error',d.mongo?.connected?'Conectado':'Desconectado');
    setHealth('healthSige',d.sige?.configured?'ok':'warn',d.sige?.configured?'Configurado':'NÃ£o configurado');
    setHealth('healthWhatsapp',d.whatsapp?.configured?'ok':'warn',d.whatsapp?.configured?'Configurado':'NÃ£o configurado');
    setHealth('healthFinanceiro',d.financeiro?.carnes>=0?'ok':'warn',`${Number(d.financeiro?.carnes||0)} carnÃª(s) â€¢ ${Number(d.financeiro?.filaPendente||0)} pendÃªncia(s)`);
  }catch(e){
    setHealth('healthBackend','error','IndisponÃ­vel');
    ['healthMongo','healthSige','healthWhatsapp','healthFinanceiro'].forEach(id=>setHealth(id,'warn','Sem diagnÃ³stico'));
  }
}
async function loadAll(){
  await Promise.allSettled([loadClientes(),loadRecibos(),loadSystemHealth()]);
}

function calcStats(){const today=localDateInputValue();stHoje.textContent=recibos.filter(r=>String(r.dataPagamento||r.createdAt).slice(0,10)===today).length;stTotal.textContent=recibos.length;stWa.textContent=recibos.filter(r=>r.enviadoWhatsapp).length}
async function readSigeRows(){const file=sigeArquivo.files&&sigeArquivo.files[0];if(!file){toast('Selecione uma planilha do SIGE.');return []}if(!window.XLSX){toast('Biblioteca de Excel nÃ£o carregou. Verifique a internet e tente novamente.');return []}const buffer=await file.arrayBuffer();const wb=XLSX.read(buffer,{type:'array',cellDates:true});const sheet=wb.Sheets[wb.SheetNames[0]];const rows=XLSX.utils.sheet_to_json(sheet,{defval:'',raw:false});return rows.filter(r=>Object.values(r).some(v=>String(v||'').trim()))}
async function preverSige(){const rows=await readSigeRows();if(!rows.length){sigeResultado.innerHTML='Nenhuma linha encontrada.';return}const keys=Object.keys(rows[0]||{});sigeResultado.innerHTML=`<b>${rows.length}</b> linha(s) lida(s). Colunas: ${keys.map(esc).join(', ')}`;sigePreviewHead.innerHTML='<tr>'+keys.slice(0,10).map(k=>`<th>${esc(k)}</th>`).join('')+'</tr>';sigePreviewBody.innerHTML=rows.slice(0,8).map(r=>'<tr>'+keys.slice(0,10).map(k=>`<td>${esc(r[k])}</td>`).join('')+'</tr>').join('')}
async function importarSige(){
  const rows=await readSigeRows();
  if(!rows.length){sigeResultado.innerHTML='Nenhuma linha para importar.';return}
  const tipo=sigeTipo.value;
  const endpoint=tipo==='pagamentos'?'/admin/crediario/importar-sige/pagamentos':'/admin/crediario/importar-sige/clientes';
  sigeResultado.innerHTML='Importando, aguarde...';
  try{
    const j=await apiJson(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rows})});
    sigeResultado.innerHTML=`<b>ImportaÃ§Ã£o concluÃ­da.</b><br>Total: ${j.total||0}<br>Processados: ${j.processados||0}<br>Criados: ${j.criados||0}<br>Atualizados: ${j.atualizados||0}<br>Ignorados: ${j.ignorados||0}${j.semTelefone!==undefined?'<br>Sem telefone: '+j.semTelefone:''}`;
    toast('Planilha SIGE importada com sucesso');
    await loadAll();
  }catch(e){
    console.error('Erro na importaÃ§Ã£o SIGE:', e.data || e);
    sigeResultado.innerHTML='Erro: '+esc(e.message||'Falha na importaÃ§Ã£o');
    toast('Erro na importaÃ§Ã£o');
  }
}

// ============================================================
// FASE 5 - EMISSÃƒO DE CARNÃŠ / BOLETOS CORA NO PAINEL FINANCEIRO
// ============================================================
let coraClientesCache=[];
let coraComprasCache=[];
let coraClienteAtual=null;
let coraCompraAtual=null;
let coraInicializado=false;

function centsFromBR(value){
  const raw=String(value??'').trim();
  if(!raw)return 0;
  const normalized=raw.includes(',')?raw.replace(/\./g,'').replace(',','.'):raw;
  const n=Number(normalized);
  return Number.isFinite(n)?Math.round(n*100):0;
}
function brFromCents(value){return money(Number(value||0)/100)}
function coraDateBR(value){if(!value)return 'â€”';const d=new Date(String(value).slice(0,10)+'T00:00:00');return Number.isNaN(d.getTime())?'â€”':d.toLocaleDateString('pt-BR')}
function coraFirst(obj,keys,fallback=''){for(const k of keys){const v=obj?.[k];if(v!==undefined&&v!==null&&String(v).trim()!=='')return v}return fallback}
function coraStatusLabel(status=''){const s=String(status||'').toUpperCase();if(['PAID','SETTLED'].includes(s))return 'Pago';if(['OPEN','CREATED'].includes(s))return 'Aberto';if(s.includes('PENDING'))return 'Em processamento';if(s==='CANCELED'||s==='CANCELLED')return 'Cancelado';return s||'â€”'}
function coraStatusClass(status=''){const s=String(status||'').toUpperCase();if(['PAID','SETTLED'].includes(s))return 'cora-status-paid';if(['OPEN','CREATED'].includes(s))return 'cora-status-open';return 'cora-status-pending'}
function abrirLinkCora(url){const safe=String(url||'').trim();if(!/^https:\/\//i.test(safe)){toast('Link do boleto indisponÃ­vel.');return}window.open(safe,'_blank','noopener,noreferrer')}

async function iniciarCora(){
  if(!coraInicializado){
    const parcelas=document.getElementById('coraParcelas');
    parcelas.innerHTML=Array.from({length:15},(_,i)=>`<option value="${i+1}" ${i===14?'selected':''}>${i+1}x</option>`).join('');
    const due=new Date();due.setMonth(due.getMonth()+1);due.setDate(20);
    document.getElementById('coraPrimeiroVencimento').value=localDateInputValue(due);
    coraInicializado=true;
  }
  await Promise.all([loadCoraClientes(),loadCoraCarnes(),loadCoraStatus()]);
}
async function loadCoraStatus(){
  try{const j=await apiJson('/admin/cora/status');const env=j.config?.environment||'stage';const badge=document.getElementById('coraEnvironmentBadge');badge.textContent=env==='production'?'PRODUÃ‡ÃƒO':'AMBIENTE DE TESTE';badge.style.background=env==='production'?'#dcfce7':'#fef3c7';badge.style.color=env==='production'?'#166534':'#92400e'}catch(e){console.warn('Status Cora:',e.message)}
}
async function loadCoraClientes(){
  const select=document.getElementById('coraClienteSelect');
  select.innerHTML='<option value="">Carregando clientes...</option>';
  try{
    const j=await apiJson('/admin/crediario/clientes?limit=500');
    coraClientesCache=(j.clientes||[]).slice().sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''),'pt-BR'));
    select.innerHTML='<option value="">Selecione o cliente</option>'+coraClientesCache.map((c,i)=>`<option value="${i}">${esc(c.nome||'Sem nome')} â€” ${esc(c.cpf||c.documento||'sem CPF')}</option>`).join('');
  }catch(e){select.innerHTML='<option value="">Erro ao carregar clientes</option>';toast('Erro ao carregar clientes para a Cora: '+e.message)}
}
function parseEnderecoCora(cliente={}){
  const endereco=cliente.address||cliente.enderecoObj||{};
  const enderecoTexto=String(cliente.endereco||'');
  const parts=enderecoTexto.split(',').map(x=>x.trim()).filter(Boolean);
  return {
    street:coraFirst(endereco,['street','logradouro','rua'],parts[0]||''),
    number:coraFirst(endereco,['number','numero'],parts[1]||''),
    district:coraFirst(endereco,['district','bairro'],parts[2]||''),
    city:coraFirst(endereco,['city','cidade'],cliente.cidade||'GuanhÃ£es'),
    state:coraFirst(endereco,['state','uf'],cliente.uf||'MG'),
    zip_code:onlyDigits(coraFirst(endereco,['zip_code','zipCode','cep'],cliente.cep||'')),
    complement:coraFirst(endereco,['complement','complemento'],'')
  };
}
async function selecionarClienteCora(){
  const idx=document.getElementById('coraClienteSelect').value;
  coraClienteAtual=idx===''?null:coraClientesCache[Number(idx)];
  const box=document.getElementById('coraClienteResumo');
  if(!coraClienteAtual){box.classList.add('hidden');return}
  const end=parseEnderecoCora(coraClienteAtual);
  document.getElementById('coraDocumento').value=onlyDigits(coraClienteAtual.cpf||coraClienteAtual.documento||'');
  document.getElementById('coraEmail').value=coraClienteAtual.email||'';
  document.getElementById('coraRua').value=end.street||'';document.getElementById('coraNumero').value=end.number||'';document.getElementById('coraBairro').value=end.district||'';document.getElementById('coraCidade').value=end.city||'';document.getElementById('coraUf').value=end.state||'';document.getElementById('coraCep').value=end.zip_code||'';document.getElementById('coraComplemento').value=end.complement||'';
  box.innerHTML=`âœ… <b>${esc(coraClienteAtual.nome)}</b><br><small>CPF/CNPJ: ${esc(coraClienteAtual.cpf||'nÃ£o informado')} â€¢ Telefone: ${esc(shortPhone(coraClienteAtual.telefone)||'nÃ£o informado')}</small>`;box.classList.remove('hidden');
  await carregarComprasCora();
}
async function carregarComprasCora(){
  const select=document.getElementById('coraCompraSelect');
  coraComprasCache=[];coraCompraAtual=null;
  if(!coraClienteAtual){select.innerHTML='<option value="">Selecione primeiro o cliente</option>';return}
  select.innerHTML='<option value="">Buscando compras no SIGE...</option>';
  try{
    const q=encodeURIComponent(coraClienteAtual.nome||coraClienteAtual.cpf||'');
    const j=await apiJson('/admin/sige/lancamentos?q='+q+'&status=todos&limit=500&maxRecords=2000');
    const rows=j.lancamentos||[];
    coraComprasCache=rows.filter(r=>{
      const nome=String(coraFirst(r,['clienteNome','cliente','nome','pessoaNome'],'')).toLowerCase();
      return !nome||nome.includes(String(coraClienteAtual.nome||'').toLowerCase().split(' ')[0]);
    });
    select.innerHTML='<option value="manual">Compra informada manualmente</option>'+coraComprasCache.map((r,i)=>{
      const desc=coraFirst(r,['descricao','description','produto','documento','codigo'],'Compra / lanÃ§amento');
      const val=Number(coraFirst(r,['saldo','valorAberto','valor','total','amount'],0)||0);
      const venc=coraFirst(r,['dataVencimento','vencimento','dueDate'],'');
      return `<option value="${i}">${esc(desc)} â€” ${money(val)}${venc?' â€” '+coraDateBR(venc):''}</option>`;
    }).join('');
    if(!coraComprasCache.length)select.value='manual';
    selecionarCompraCora();
  }catch(e){select.innerHTML='<option value="manual">Compra informada manualmente</option>';select.value='manual';selecionarCompraCora();toast('NÃ£o foi possÃ­vel carregar compras do SIGE. VocÃª pode preencher manualmente.')}
}
function selecionarCompraCora(){
  const value=document.getElementById('coraCompraSelect').value;
  const box=document.getElementById('coraCompraResumo');
  coraCompraAtual=(value===''||value==='manual')?null:coraComprasCache[Number(value)];
  if(!coraCompraAtual){box.innerHTML='âœï¸ Compra manual selecionada. Informe a descriÃ§Ã£o e o valor total.';box.classList.remove('hidden');return}
  const desc=String(coraFirst(coraCompraAtual,['descricao','description','produto','documento','codigo'],'Compra Ariana MÃ³veis'));
  let val=Number(coraFirst(coraCompraAtual,['saldo','valorAberto','valor','total','amount'],0)||0);
  if(val<0)val=Math.abs(val);
  document.getElementById('coraDescricao').value=desc;
  document.getElementById('coraValorTotal').value=val?val.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}):'';
  const due=coraFirst(coraCompraAtual,['dataVencimento','vencimento','dueDate'],'');if(due){const iso=String(due).slice(0,10);if(/^\d{4}-\d{2}-\d{2}$/.test(iso))document.getElementById('coraPrimeiroVencimento').value=iso}
  box.innerHTML=`âœ… <b>${esc(desc)}</b><br><small>Valor selecionado: ${money(val)}${due?' â€¢ Vencimento: '+coraDateBR(due):''}</small>`;box.classList.remove('hidden');
}
function buildCoraPayload(){
  if(!coraClienteAtual)throw new Error('Selecione o cliente.');
  const totalAmount=centsFromBR(document.getElementById('coraValorTotal').value);
  const installments=Number(document.getElementById('coraParcelas').value||0);
  const customerDocument=onlyDigits(document.getElementById('coraDocumento').value);
  const firstDueDate=document.getElementById('coraPrimeiroVencimento').value;
  const description=document.getElementById('coraDescricao').value.trim();
  if(!description)throw new Error('Informe a descriÃ§Ã£o da compra.');
  if(totalAmount<500)throw new Error('Informe um valor total vÃ¡lido.');
  if(!installments||installments<1||installments>15)throw new Error('Escolha entre 1 e 15 parcelas.');
  if(Math.floor(totalAmount/installments)<500)throw new Error('Cada parcela precisa ser de pelo menos R$ 5,00.');
  if(!firstDueDate)throw new Error('Informe o primeiro vencimento.');
  if(customerDocument.length!==11&&customerDocument.length!==14)throw new Error('Informe um CPF ou CNPJ vÃ¡lido.');
  const email=document.getElementById('coraEmail').value.trim();if(!email)throw new Error('Informe o e-mail do cliente.');
  const address={street:document.getElementById('coraRua').value.trim(),number:document.getElementById('coraNumero').value.trim(),district:document.getElementById('coraBairro').value.trim(),city:document.getElementById('coraCidade').value.trim(),state:document.getElementById('coraUf').value.trim().toUpperCase(),zip_code:onlyDigits(document.getElementById('coraCep').value),complement:document.getElementById('coraComplemento').value.trim()};
  if(!address.street||!address.number||!address.district||!address.city||address.state.length!==2||address.zip_code.length!==8)throw new Error('Preencha o endereÃ§o completo do cliente.');
  return {customerName:coraClienteAtual.nome,customerEmail:email,customerDocument,customerAddress:address,totalAmount,installments,firstDueDate,serviceName:description.slice(0,80),description:'CarnÃª crediÃ¡rio Ariana MÃ³veis'};
}
async function preverCarneCora(){
  try{const payload=buildCoraPayload();const j=await apiJson('/admin/cora/carnes/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});document.getElementById('coraResultado').innerHTML=`<div class="receipt"><b>âœ… PrÃ©via validada</b><div class="row"><strong>Cliente</strong><span>${esc(payload.customerName)}</span></div><div class="row"><strong>Compra</strong><span>${esc(payload.serviceName)}</span></div><div class="row"><strong>Total</strong><span>${brFromCents(payload.totalAmount)}</span></div><div class="row"><strong>Parcelamento</strong><span>${payload.installments}x de aproximadamente ${brFromCents(Math.floor(payload.totalAmount/payload.installments))}</span></div><div class="row"><strong>Primeiro vencimento</strong><span>${coraDateBR(payload.firstDueDate)}</span></div><div class="cora-stage-note">PrÃ©via aprovada. Clique em â€œGerar boletos Coraâ€ para emitir.</div></div>`;toast('PrÃ©via do carnÃª validada.') }catch(e){toast(e.message||String(e))}
}
async function emitirCarneCora(){
  let payload;try{payload=buildCoraPayload()}catch(e){toast(e.message);return}
  if(!confirm(`Confirmar emissÃ£o de ${payload.installments} boleto(s) para ${payload.customerName}, no total de ${brFromCents(payload.totalAmount)}?`))return;
  const btn=document.getElementById('coraEmitirBtn');btn.disabled=true;btn.textContent='â³ Gerando boletos...';document.getElementById('coraResultado').innerHTML='<div class="receipt">A Cora estÃ¡ gerando os boletos. CarnÃªs com muitas parcelas podem levar alguns segundos...</div>';
  try{
    const j=await apiJson('/admin/cora/carnes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const charge=j.charge||j.carnet||j.data||j;
    renderCoraCharge(charge);toast('CarnÃª Cora emitido com sucesso.');await loadCoraCarnes();
  }catch(e){
    const data=e.data||{};
    if(e.status===202||data.pending){document.getElementById('coraResultado').innerHTML='<div class="receipt"><b>â³ EmissÃ£o em processamento</b><p>A Cora ainda estÃ¡ processando os boletos. NÃ£o gere outro carnÃª. Use Atualizar para consultar novamente.</p></div>';toast('EmissÃ£o aguardando confirmaÃ§Ã£o da Cora.')}else{document.getElementById('coraResultado').innerHTML=`<div class="receipt"><b>âŒ NÃ£o foi possÃ­vel emitir</b><p>${esc(e.message||e)}</p></div>`;toast('Erro ao gerar boletos: '+(e.message||e))}
  }finally{btn.disabled=false;btn.textContent='ðŸ¦ Gerar boletos Cora'}
}
function renderCoraCharge(charge={}){
  const invoices=(charge.invoices||charge.providerResponse?.result||[]).slice().sort((a,b)=>String(a.payment_terms?.due_date||'').localeCompare(String(b.payment_terms?.due_date||'')));
  const docUrl=charge.documentUrl||charge.document_url||charge.providerResponse?.document_url||'';
  const total=charge.totalAmountCents||charge.requestPayload?.service?.amount||invoices.reduce((s,x)=>s+Number(x.total_amount||0),0);
  const html=`<div class="receipt"><div class="cora-result-head"><div><b style="font-size:18px">âœ… CarnÃª emitido</b><div class="muted">${esc(charge.customer?.name||charge.requestPayload?.customer?.name||'Cliente')}</div></div><span class="pill ${coraStatusClass(charge.status)}">${esc(coraStatusLabel(charge.status))}</span></div><div class="row"><strong>Total</strong><span class="cora-total">${brFromCents(total)}</span></div><div class="row"><strong>Parcelas</strong><span>${invoices.length||charge.installments||'â€”'}</span></div><div class="cora-links">${docUrl?`<button class="blue btn-text" onclick='abrirLinkCora(${JSON.stringify(docUrl)})'>ðŸ“„ Abrir carnÃª completo</button>`:''}</div><div class="cora-installments">${invoices.map((inv,i)=>{const slip=inv.payment_options?.bank_slip||{};const due=inv.payment_terms?.due_date;return `<div class="cora-installment"><div class="cora-num">${String(i+1).padStart(2,'0')}/${String(invoices.length).padStart(2,'0')}</div><div><b>${brFromCents(inv.total_amount)}</b><small>Vencimento: ${coraDateBR(due)} â€¢ ${esc(coraStatusLabel(inv.status))}</small>${slip.digitable?`<small style="display:block;word-break:break-all">Linha: ${esc(slip.digitable)}</small>`:''}</div>${slip.url?`<button class="light btn-text" onclick='abrirLinkCora(${JSON.stringify(slip.url)})'>Abrir boleto</button>`:''}</div>`}).join('')||'<div class="muted">Boletos ainda nÃ£o disponÃ­veis.</div>'}</div></div>`;
  document.getElementById('coraResultado').innerHTML=html;
}
async function loadCoraCarnes(){
  const body=document.getElementById('coraCarnesBody');if(!body)return;body.innerHTML='<tr><td colspan="7">Carregando carnÃªs...</td></tr>';
  try{
    const j=await apiJson('/admin/cora/carnes');let rows=j.charges||j.carnes||[];const q=String(document.getElementById('coraBusca')?.value||'').toLowerCase().trim();if(q)rows=rows.filter(r=>JSON.stringify([r.customer?.name,r.customer?.document?.identity,r.requestPayload?.service?.name,r.requestPayload?.service?.description]).toLowerCase().includes(q));
    body.innerHTML=rows.map(r=>{const name=r.customer?.name||r.requestPayload?.customer?.name||'â€”';const desc=r.requestPayload?.service?.name||r.requestPayload?.service?.description||'Compra Ariana MÃ³veis';const total=r.totalAmountCents||r.requestPayload?.service?.amount||0;const doc=r.documentUrl||r.providerResponse?.document_url||'';return `<tr><td><b>${esc(name)}</b><br><small>${esc(r.customer?.document?.identity||'')}</small></td><td>${esc(desc)}</td><td><b>${brFromCents(total)}</b></td><td>${Number(r.installments||r.requestPayload?.installment?.number_of||0)}x</td><td><span class="pill ${coraStatusClass(r.status)}">${esc(coraStatusLabel(r.status))}</span></td><td>${r.createdAt?new Date(r.createdAt).toLocaleString('pt-BR'):'â€”'}</td><td><div class="row-actions">${doc?`<button class="icon-btn print" title="Abrir carnÃª" onclick='abrirLinkCora(${JSON.stringify(doc)})'>ðŸ“„</button>`:''}<button class="light small" onclick="consultarCoraCharge('${esc(r._id||r.id)}')">Ver detalhes</button></div></td></tr>`}).join('')||'<tr><td colspan="7">Nenhum carnÃª encontrado.</td></tr>';
  }catch(e){body.innerHTML=`<tr><td colspan="7">Erro ao carregar carnÃªs: ${esc(e.message||e)}</td></tr>`}
}
async function consultarCoraCharge(id) {
  const resultado = document.getElementById('coraResultado');

  try {
    if (resultado) {
      resultado.innerHTML =
        '<div class="receipt">Consultando detalhes do carnÃª...</div>';

      resultado.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }

    const [detalhe, auditoria] = await Promise.all([
      apiJson('/admin/cora/carnes/' + encodeURIComponent(id)),
      apiJson('/admin/cora/carnes/' + encodeURIComponent(id) + '/logs')
        .catch(() => ({ logs: [] }))
    ]);

    const charge =
      detalhe.charge ||
      detalhe.data ||
      detalhe;

    renderCoraCharge(charge);

    const logs = auditoria.logs || [];
    const customer =
      charge.customer ||
      charge.requestPayload?.customer ||
      {};

    const service =
      charge.requestPayload?.service ||
      {};

    const error =
      charge.error ||
      charge.lastError ||
      {};

    const detailsHtml = `
      <div class="receipt" style="margin-top:16px">
        <h3 style="margin-top:0">Detalhes tÃ©cnicos da emissÃ£o</h3>

        <div class="row">
          <strong>Cliente</strong>
          <span>${esc(customer.name || 'NÃ£o informado')}</span>
        </div>

        <div class="row">
          <strong>CPF/CNPJ</strong>
          <span>${esc(customer.document?.identity || 'NÃ£o informado')}</span>
        </div>

        <div class="row">
          <strong>Compra</strong>
          <span>${esc(service.name || service.description || 'NÃ£o informada')}</span>
        </div>

        <div class="row">
          <strong>Status interno</strong>
          <span>${esc(charge.status || 'NÃ£o informado')}</span>
        </div>

        <div class="row">
          <strong>Ambiente</strong>
          <span>${esc(charge.environment || 'NÃ£o informado')}</span>
        </div>

        <div class="row">
          <strong>Tentativas</strong>
          <span>${Number(charge.attempts || 0)}</span>
        </div>

        <div class="row">
          <strong>Ãšltima tentativa</strong>
          <span>${
            charge.lastAttemptAt
              ? new Date(charge.lastAttemptAt).toLocaleString('pt-BR')
              : 'NÃ£o informada'
          }</span>
        </div>

        <div class="row">
          <strong>ReferÃªncia</strong>
          <span>${esc(charge.internalReference || charge.code || 'NÃ£o informada')}</span>
        </div>

        <div class="row">
          <strong>Request ID Cora</strong>
          <span>${esc(charge.providerRequestId || 'NÃ£o retornado')}</span>
        </div>

        <div class="row">
          <strong>Trace ID Cora</strong>
          <span>${esc(charge.providerTraceId || 'NÃ£o retornado')}</span>
        </div>

        ${
          error.message
            ? `
              <div class="cora-stage-note" style="margin-top:14px">
                <b>Erro da emissÃ£o</b><br>
                ${esc(error.message)}
                ${
                  error.code
                    ? `<br><small>CÃ³digo: ${esc(error.code)}</small>`
                    : ''
                }
                ${
                  error.providerStatus
                    ? `<br><small>HTTP Cora: ${esc(error.providerStatus)}</small>`
                    : ''
                }
              </div>
            `
            : ''
        }

        <div style="margin-top:16px">
          <b>Auditoria da comunicaÃ§Ã£o com a Cora</b>

          ${
            logs.length
              ? logs.map(log => `
                  <div class="cora-installment" style="margin-top:8px">
                    <div>
                      <b>${esc(log.action || 'RequisiÃ§Ã£o')}</b>
                      <small style="display:block">
                        ${esc(log.method || '')}
                        ${esc(log.url || '')}
                      </small>
                      <small style="display:block">
                        HTTP: ${log.status ?? 'sem resposta'}
                        â€¢ DuraÃ§Ã£o: ${Number(log.durationMs || 0)} ms
                      </small>
                      ${
                        log.createdAt
                          ? `<small style="display:block">${new Date(log.createdAt).toLocaleString('pt-BR')}</small>`
                          : ''
                      }
                    </div>
                  </div>
                `).join('')
              : '<div class="muted" style="margin-top:8px">Nenhum log de comunicaÃ§Ã£o foi encontrado para esta emissÃ£o.</div>'
          }
        </div>
      </div>
    `;

    if (resultado) {
      resultado.insertAdjacentHTML('beforeend', detailsHtml);

      resultado.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }
  } catch (e) {
    if (resultado) {
      resultado.innerHTML = `
        <div class="receipt">
          <b>Erro ao consultar o carnÃª</b>
          <p>${esc(e.message || String(e))}</p>
        </div>
      `;

      resultado.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }

    toast('Erro ao consultar carnÃª: ' + (e.message || e));
  }
}
function chavePerfilCliente(item={}){
  const doc=onlyDigits(item.document||item.cpf||'');
  if(doc)return 'doc:'+doc;
  const phone=onlyDigits(item.whatsapp||item.phone||item.telefone||'');
  const name=normalizarBuscaCliente(item.customerName||item.nome||'');
  return phone?'phone:'+phone:(name?'name:'+name:'id:'+String(item.sourceId||item._id||Math.random()));
}
function mesclarClientesFinanceiroEPerfis(clientesFinanceiro=[],perfis=[]){
  const map=new Map();
  for(const c of clientesFinanceiro){
    const base=normalizarClienteFinanceiroParaPerfil(c);
    map.set(chavePerfilCliente(base),base);
  }
  for(const p of perfis){
    const key=chavePerfilCliente(p);
    const current=map.get(key)||{};
    map.set(key,{
      ...current,
      ...p,
      document:onlyDigits(p.document||current.document||''),
      customerName:p.customerName||current.customerName||'',
      phone:p.phone||current.phone||'',
      whatsapp:p.whatsapp||current.whatsapp||p.phone||current.phone||'',
      availableLimitCents:Math.max(0,Number(p.availableLimitCents??((p.creditLimitCents||0)-(p.usedLimitCents||0)))),
      source:current.source?'CREDIARIO_E_FINANCEIRO':'CREDIARIO'
    });
  }
  return [...map.values()].sort((a,b)=>String(a.customerName||'').localeCompare(String(b.customerName||''),'pt-BR'));
}
async function loadPerfisCredito(){
  const body=document.getElementById('perfisCreditoBody');if(!body)return;
  body.innerHTML='<tr><td colspan="6">Carregando clientes e fichas financeiras...</td></tr>';
  try{
    const q=document.getElementById('perfilBusca')?.value?.trim()||'';
    const risk=document.getElementById('perfilRiscoFiltro')?.value||'';
    const status=document.getElementById('perfilStatusFiltro')?.value||'';
    const params=new URLSearchParams();
    if(q)params.set('search',q);
    params.set('limit','100');
    const [profileList,dash,financeClients]=await Promise.all([
      apiJson('/admin/crediario/perfis?'+params.toString()),
      apiJson('/admin/crediario/perfis/dashboard'),
      buscarClientesFinanceiro(q,500)
    ]);
    let merged=mesclarClientesFinanceiroEPerfis(financeClients,profileList.profiles||[]);
    if(risk)merged=merged.filter(p=>String(p.riskLevel||'MEDIO').toUpperCase()===risk);
    if(status)merged=merged.filter(p=>String(p.profileStatus||'ATIVO').toUpperCase()===status);
    perfisCreditoCache=merged;
    const t=dash.totals||{};
    document.getElementById('pfClientes').textContent=merged.length;
    document.getElementById('pfLimite').textContent=money((t.totalLimitCents||0)/100);
    document.getElementById('pfUtilizado').textContent=money((t.usedLimitCents||0)/100);
    document.getElementById('pfDisponivel').textContent=money((t.availableLimitCents||0)/100);
    body.innerHTML=merged.map((p,i)=>{
      const hasProfile=p.source==='CREDIARIO'||p.source==='CREDIARIO_E_FINANCEIRO';
      const sourceLabel=hasProfile?'Ficha ativa':'Cliente do Financeiro/SIGE';
      const canOpen=Boolean(onlyDigits(p.document));
      return `<tr>
        <td><b>${esc(p.customerName||'Cliente sem nome')}</b><br><small>${esc(p.document||'Sem CPF')} â€¢ ${esc(p.whatsapp||p.phone||'Sem telefone')}</small><br><small class="muted">${sourceLabel}</small></td>
        <td><b>${p.internalScore??500}</b><br><small>${esc(p.riskLevel||'MEDIO')}</small></td>
        <td><b>${money((p.creditLimitCents||0)/100)}</b><br><small>DisponÃ­vel ${money((p.availableLimitCents||0)/100)}</small></td>
        <td><b>${p.openPurchasesCount||0} abertas</b><br><small>${p.openOverdueInstallments||0} parcelas vencidas</small></td>
        <td><span class="pill ${p.profileStatus==='BLOQUEADO'?'pending':'ok'}">${esc(perfilStatusLabel(p.profileStatus))}</span></td>
        <td>${canOpen?`<button class="light small" onclick="abrirPerfilCredito(${i})">${hasProfile?'Abrir ficha':'Criar ficha'}</button>`:'<span class="muted">CPF necessÃ¡rio</span>'}</td>
      </tr>`;
    }).join('')||'<tr><td colspan="6">Nenhum cliente encontrado no Financeiro/SIGE ou no CrediÃ¡rio.</td></tr>';
  }catch(e){body.innerHTML='<tr><td colspan="6">Erro: '+esc(e.message||e)+'</td></tr>'}
}
async function abrirPerfilCredito(index){
  const resumo=perfisCreditoCache[index];if(!resumo)return;const d=document.getElementById('perfilCreditoDetalhe');d.classList.remove('hidden');d.innerHTML='<div class="receipt">Carregando ficha...</div>';d.scrollIntoView({behavior:'smooth',block:'start'});
  try{
    const document=onlyDigits(resumo.document);
    let j=await apiJson('/admin/crediario/perfis/'+encodeURIComponent(document));
    let p=j.profile||{};
    if(!p.customerName&&resumo.customerName){
      await apiJson('/admin/crediario/perfis/'+encodeURIComponent(document),{
        method:'PATCH',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          customerName:resumo.customerName||'',
          phone:resumo.phone||'',
          whatsapp:resumo.whatsapp||resumo.phone||'',
          email:resumo.email||'',
          auditNote:'Ficha criada automaticamente a partir do Financeiro/SIGE'
        })
      });
      j=await apiJson('/admin/crediario/perfis/'+encodeURIComponent(document));
      p=j.profile||resumo;
    }else{
      p={...resumo,...p,customerName:p.customerName||resumo.customerName||'',phone:p.phone||resumo.phone||'',whatsapp:p.whatsapp||resumo.whatsapp||resumo.phone||'',email:p.email||resumo.email||''};
    }
    const analyses=j.analyses||[];const refs=Array.isArray(p.references)?p.references:[];const timeline=(p.auditHistory||[]).slice().reverse().map(h=>`<div class="row"><strong>${esc(h.action||'AtualizaÃ§Ã£o')}</strong><span>${h.at?new Date(h.at).toLocaleString('pt-BR'):''}${h.note?' â€¢ '+esc(h.note):''}</span></div>`).join('');
  d.innerHTML=`<div class="history-header"><div><h2>${esc(p.customerName||'Cliente')}</h2><p class="help">CPF ${esc(p.document||'â€”')} â€¢ cadastro financeiro permanente</p></div><span class="pill ${p.profileStatus==='BLOQUEADO'?'pending':'ok'}">${esc(perfilStatusLabel(p.profileStatus))}</span></div>
  <div class="stats"><div class="stat"><small>Score Ariana</small><br><b>${p.internalScore??500}</b></div><div class="stat"><small>Limite total</small><br><b>${money((p.creditLimitCents||0)/100)}</b></div><div class="stat"><small>Utilizado</small><br><b>${money((p.usedLimitCents||0)/100)}</b></div><div class="stat"><small>DisponÃ­vel</small><br><b>${money((j.availableLimitCents??Math.max(0,(p.creditLimitCents||0)-(p.usedLimitCents||0)))/100)}</b></div></div>
  <div class="formgrid" style="margin-top:14px"><div><label>Nome</label><input id="pfNome" value="${esc(p.customerName||'')}"></div><div><label>RG</label><input id="pfRg" value="${esc(p.rg||'')}"></div><div><label>Nascimento</label><input id="pfNascimento" type="date" value="${esc(p.birthDate||'')}"></div><div><label>Estado civil</label><input id="pfEstadoCivil" value="${esc(p.maritalStatus||'')}"></div><div><label>ProfissÃ£o</label><input id="pfProfissao" value="${esc(p.profession||'')}"></div><div><label>Empresa</label><input id="pfEmpresa" value="${esc(p.employer||'')}"></div><div><label>Renda mensal</label><input id="pfRenda" value="${((p.monthlyIncomeCents||0)/100).toLocaleString('pt-BR',{minimumFractionDigits:2})}"></div><div><label>Tempo no emprego (meses)</label><input id="pfEmpregoMeses" type="number" value="${p.employmentMonths||0}"></div><div><label>Telefone</label><input id="pfTelefone" value="${esc(p.phone||'')}"></div><div><label>WhatsApp</label><input id="pfWhatsapp" value="${esc(p.whatsapp||'')}"></div><div><label>E-mail</label><input id="pfEmail" value="${esc(p.email||'')}"></div><div><label>Limite</label><input id="pfLimiteEdit" value="${((p.creditLimitCents||0)/100).toLocaleString('pt-BR',{minimumFractionDigits:2})}"></div><div><label>Status</label><select id="pfStatus"><option ${p.profileStatus==='ATIVO'?'selected':''}>ATIVO</option><option ${p.profileStatus==='EM_REVISAO'?'selected':''}>EM_REVISAO</option><option ${p.profileStatus==='BLOQUEADO'?'selected':''}>BLOQUEADO</option></select></div><div><label>Motivo do bloqueio/revisÃ£o</label><input id="pfMotivo" value="${esc(p.blockedReason||'')}"></div><div class="full"><label>ReferÃªncias (uma por linha: nome | vÃ­nculo | telefone)</label><textarea id="pfReferencias" rows="3">${esc(refs.map(r=>[r.name,r.relationship,r.phone].filter(Boolean).join(' | ')).join('\n'))}</textarea></div><div class="full"><label>ObservaÃ§Ãµes</label><textarea id="pfNotasEdit" rows="3">${esc(p.notes||'')}</textarea></div></div>
  <div class="actions"><button class="blue" onclick="salvarFichaFinanceira('${esc(p.document||'')}')">Salvar ficha</button><button class="light" onclick="recalcularPerfilCredito('${esc(p.document||'')}')">Recalcular score</button></div>
  <h3>HistÃ³rico consolidado</h3><div class="stats"><div class="stat"><small>Compras</small><br><b>${p.purchasesCount||0}</b></div><div class="stat"><small>Quitadas</small><br><b>${p.settledPurchasesCount||0}</b></div><div class="stat"><small>Em aberto</small><br><b>${p.openPurchasesCount||0}</b></div><div class="stat"><small>Maior atraso</small><br><b>${p.maximumDaysLate||0} dias</b></div></div>
  <div class="receipt" style="margin-top:14px"><h3>AnÃ¡lises do cliente</h3>${analyses.slice(0,10).map(a=>`<div class="row"><strong>${esc(a.orderId||'Pedido')}</strong><span>${esc(analiseStatusLabel(a.status))} â€¢ ${money((a.financedAmountCents||0)/100)}</span></div>`).join('')||'<div class="muted">Nenhuma anÃ¡lise registrada.</div>'}</div>
  <div class="receipt" style="margin-top:14px">
    <div class="history-header"><div><h3>Parcelas atualizadas</h3><p class="help">Parcelas vencidas sÃ£o exibidas com multa de 2% e juros de 1% ao mÃªs, proporcionais aos dias de atraso.</p></div><button class="light small" onclick="carregarParcelasAtualizadas('${esc(p.document||'')}')">Atualizar valores</button></div>
    <div id="pfParcelasAtualizadas"><div class="muted">Carregando parcelas...</div></div>
  </div>
  <div class="reneg-base">
    <h3>Base para renegociaÃ§Ã£o â€” fase 6.4.8</h3>
    <p class="help">Prepara uma minuta com o saldo atualizado, novo cronograma e espaÃ§o reservado para novos boletos, sem alterar o contrato original.</p>
    <div class="formgrid">
      <div><label>Entrada</label><input id="renegEntrada" value="0,00"></div>
      <div><label>Novas parcelas</label><input id="renegParcelas" type="number" min="1" max="48" value="12"></div>
      <div><label>Primeiro vencimento</label><input id="renegPrimeiroVencimento" type="date"></div>
      <div><label>Data-base dos cÃ¡lculos</label><input id="renegDataBase" type="date"></div>
      <div class="full"><label>ObservaÃ§Ãµes da minuta</label><textarea id="renegNotas" rows="2" placeholder="Opcional"></textarea></div>
    </div>
    <div class="reneg-warning">Nesta fase o sistema apenas prepara e salva a estrutura. Nenhum boleto novo Ã© emitido e o contrato original permanece preservado.</div>
    <div class="actions"><button class="yellow" onclick="prepararRenegociacao('${esc(p.document||'')}')">Preparar minuta de renegociaÃ§Ã£o</button><button class="light" onclick="carregarRenegociacoes('${esc(p.document||'')}')">Ver histÃ³rico</button></div>
    <div id="renegResultado" style="margin-top:12px"></div>
  </div>
  <div class="receipt" style="margin-top:14px"><h3>Auditoria da ficha</h3>${timeline||'<div class="muted">Nenhuma alteraÃ§Ã£o registrada.</div>'}</div>`;
  setTimeout(()=>{const hoje=localDateInputValue();const base=document.getElementById('renegDataBase');if(base&&!base.value)base.value=hoje;const first=document.getElementById('renegPrimeiroVencimento');if(first&&!first.value){const d=new Date();d.setMonth(d.getMonth()+1);first.value=localDateInputValue(d)}carregarParcelasAtualizadas(p.document)},0);
  }catch(e){d.innerHTML='<div class="receipt">Erro: '+esc(e.message||e)+'</div>'}
}
async function salvarFichaFinanceira(documento){try{const references=(document.getElementById('pfReferencias')?.value||'').split(/\n+/).map(line=>{const [name,relationship,phone]=line.split('|').map(v=>v.trim());return{name,relationship,phone}}).filter(r=>r.name||r.phone);const body={customerName:document.getElementById('pfNome')?.value||'',rg:document.getElementById('pfRg')?.value||'',birthDate:document.getElementById('pfNascimento')?.value||'',maritalStatus:document.getElementById('pfEstadoCivil')?.value||'',profession:document.getElementById('pfProfissao')?.value||'',employer:document.getElementById('pfEmpresa')?.value||'',monthlyIncomeCents:centsFromBR(document.getElementById('pfRenda')?.value||'0'),employmentMonths:Number(document.getElementById('pfEmpregoMeses')?.value||0),phone:document.getElementById('pfTelefone')?.value||'',whatsapp:document.getElementById('pfWhatsapp')?.value||'',email:document.getElementById('pfEmail')?.value||'',creditLimitCents:centsFromBR(document.getElementById('pfLimiteEdit')?.value||'0'),profileStatus:document.getElementById('pfStatus')?.value||'ATIVO',blockedReason:document.getElementById('pfMotivo')?.value||'',references,notes:document.getElementById('pfNotasEdit')?.value||'',auditNote:'Ficha atualizada pelo Financeiro'};await apiJson('/admin/crediario/perfis/'+encodeURIComponent(documento),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});toast('Ficha financeira salva');await loadPerfisCredito()}catch(e){toast(e.message||'Erro ao salvar ficha')}}
async function recalcularPerfilCredito(documento){try{await apiJson('/admin/crediario/perfis/'+encodeURIComponent(documento)+'/recalcular-score',{method:'POST'});toast('Score recalculado');await loadPerfisCredito()}catch(e){toast(e.message||'Erro ao recalcular score')}}


function parcelaAtualizadaCard(item){
  const late=Number(item.daysLate||0)>0;
  const cls=late?'cred-installment-overdue':'cred-installment-open';
  const status=late?`${item.daysLate} dia(s) em atraso`:'Em aberto';
  return `<div class="${cls}">
    <div class="row"><strong>Parcela ${String(item.installmentNumber||0).padStart(2,'0')}/${String(item.installmentCount||0).padStart(2,'0')} â€¢ Pedido ${esc(item.orderId||'â€”')}</strong><span>${esc(item.dueDate?item.dueDate.split('-').reverse().join('/'):'â€”')} â€¢ ${status}</span></div>
    <div class="cred-values-grid">
      <div class="cred-value-box"><small>Original</small><b>${money((item.originalCents||0)/100)}</b></div>
      <div class="cred-value-box"><small>Multa</small><b>${money((item.fineCents||0)/100)}</b></div>
      <div class="cred-value-box"><small>Juros</small><b>${money((item.interestCents||0)/100)}</b></div>
      <div class="cred-value-box"><small>Atualizado hoje</small><b>${money((item.updatedCents||0)/100)}</b></div>
    </div>
  </div>`;
}
async function carregarParcelasAtualizadas(documento){
  const box=document.getElementById('pfParcelasAtualizadas');if(!box)return;
  box.innerHTML='<div class="muted">Calculando multa e juros...</div>';
  try{
    const date=document.getElementById('renegDataBase')?.value||'';
    const j=await apiJson('/admin/crediario/perfis/'+encodeURIComponent(documento)+'/parcelas-atualizadas'+(date?'?date='+encodeURIComponent(date):''));
    const s=j.summary||{};
    box.innerHTML=`<div class="stats" style="margin-bottom:12px">
      <div class="stat"><small>Saldo original</small><br><b>${money((s.originalCents||0)/100)}</b></div>
      <div class="stat"><small>Multas</small><br><b>${money((s.fineCents||0)/100)}</b></div>
      <div class="stat"><small>Juros</small><br><b>${money((s.interestCents||0)/100)}</b></div>
      <div class="stat"><small>Saldo atualizado</small><br><b>${money((s.updatedCents||0)/100)}</b></div>
    </div>${(j.installments||[]).map(parcelaAtualizadaCard).join('')||'<div class="muted">Nenhuma parcela aberta encontrada.</div>'}`;
  }catch(e){box.innerHTML='<div class="cred-dash-error">'+esc(e.message||e)+'</div>'}
}
async function prepararRenegociacao(documento){
  const result=document.getElementById('renegResultado');if(result)result.innerHTML='<div class="muted">Preparando minuta...</div>';
  try{
    const body={
      downPaymentCents:centsFromBR(document.getElementById('renegEntrada')?.value||'0'),
      newInstallmentCount:Number(document.getElementById('renegParcelas')?.value||1),
      firstDueDate:document.getElementById('renegPrimeiroVencimento')?.value||'',
      referenceDate:document.getElementById('renegDataBase')?.value||'',
      notes:document.getElementById('renegNotas')?.value||''
    };
    const j=await apiJson('/admin/crediario/perfis/'+encodeURIComponent(documento)+'/renegociacoes/preparar',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body)
    });
    const r=j.renegotiation||{};
    if(result)result.innerHTML=`<div class="receipt">
      <b>Minuta preparada: ${esc(r.renegotiationId||'')}</b>
      <div class="row"><strong>Saldo original</strong><span>${money((r.originalBalanceCents||0)/100)}</span></div>
      <div class="row"><strong>Multas</strong><span>${money((r.accumulatedFineCents||0)/100)}</span></div>
      <div class="row"><strong>Juros</strong><span>${money((r.accumulatedInterestCents||0)/100)}</span></div>
      <div class="row"><strong>Saldo renegociado</strong><span>${money((r.negotiatedBalanceCents||0)/100)}</span></div>
      <div class="row"><strong>Novo cronograma</strong><span>${r.newInstallmentCount||0} parcelas</span></div>
      <div class="muted" style="margin-top:8px">Contrato original preservado. EmissÃ£o de novos boletos ainda nÃ£o executada.</div>
    </div>`;
    toast('Minuta de renegociaÃ§Ã£o preparada');
    await carregarRenegociacoes(documento);
  }catch(e){if(result)result.innerHTML='<div class="cred-dash-error">'+esc(e.message||e)+'</div>'}
}
async function carregarRenegociacoes(documento){
  const result=document.getElementById('renegResultado');if(!result)return;
  try{
    const j=await apiJson('/admin/crediario/perfis/'+encodeURIComponent(documento)+'/renegociacoes');
    const rows=j.renegotiations||[];
    result.innerHTML=`<div class="receipt"><h3>HistÃ³rico de renegociaÃ§Ãµes</h3>${rows.map(r=>`<div class="row"><strong>${esc(r.renegotiationId||'Minuta')}</strong><span>${esc(r.status||'DRAFT')} â€¢ ${r.newInstallmentCount||0}x â€¢ ${money((r.negotiatedBalanceCents||0)/100)}</span></div>`).join('')||'<div class="muted">Nenhuma minuta preparada.</div>'}</div>`;
  }catch(e){result.innerHTML='<div class="cred-dash-error">'+esc(e.message||e)+'</div>'}
}

async function prepararAssinatura(id){
  try{
    const documents=[];
    const contrato=document.getElementById('assinaturaContratoUrl')?.value?.trim();
    const promissoria=document.getElementById('assinaturaPromissoriaUrl')?.value?.trim();
    if(contrato)documents.push({type:'CONTRATO',title:'Contrato de CrediÃ¡rio Ariana',url:contrato});
    if(promissoria)documents.push({type:'NOTA_PROMISSORIA',title:'Nota PromissÃ³ria',url:promissoria});
    if(!documents.length){toast('Informe ao menos a URL do contrato.');return}
    const expiresHours=Number(document.getElementById('assinaturaExpiraHoras')?.value||72);
    const j=await apiJson('/admin/crediario/analises/'+encodeURIComponent(id)+'/assinatura/preparar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({documents,expiresHours})});
    const url=j.signature?.signingUrl||'';
    const out=document.getElementById('assinaturaResultado');
    if(out)out.innerHTML=url?`Link criado: <b>${esc(url)}</b>`:'SolicitaÃ§Ã£o criada.';
    if(url&&navigator.clipboard)await navigator.clipboard.writeText(url).catch(()=>{});
    toast(url?'Link criado e copiado':'SolicitaÃ§Ã£o de assinatura criada');
    await loadAnalisesCredito();
  }catch(e){toast(e.message||'Erro ao preparar assinatura')}
}
async function copiarLinkAssinatura(url){try{await navigator.clipboard.writeText(url);toast('Link copiado')}catch{prompt('Copie o link:',url)}}
async function cancelarAssinatura(id){
  const reason=prompt('Motivo do cancelamento da assinatura:','Link substituÃ­do ou documentos corrigidos')||'';
  if(!reason)return;
  try{await apiJson('/admin/crediario/analises/'+encodeURIComponent(id)+'/assinatura/cancelar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason})});toast('SolicitaÃ§Ã£o cancelada');await loadAnalisesCredito()}catch(e){toast(e.message||'Erro ao cancelar assinatura')}
}


async function carregarConfigCrediarioWhatsApp(){
  const box=document.getElementById('credWhatsAppConfig'); if(!box)return;
  try{const j=await apiJson('/admin/crediario/whatsapp/config');box.innerHTML=`<b>IntegraÃ§Ã£o:</b> ${j.configured?'CONFIGURADA':'NÃƒO CONFIGURADA'} &nbsp; <b>Modo:</b> ${esc(j.mode||'')} &nbsp; <b>InstÃ¢ncia:</b> ${esc(j.evolutionInstance||'â€”')}<br><b>Chatwoot:</b> ${j.chatwootMirrorConfigured?'espelhamento configurado':'espelhamento opcional nÃ£o configurado'}`;}catch(e){
    const status=Number(e?.status||0);
    box.innerHTML=status===404
      ? '<b>IntegraÃ§Ã£o indisponÃ­vel:</b> a rota do WhatsApp do crediÃ¡rio ainda nÃ£o foi carregada no backend.'
      : '<b>Erro ao consultar configuraÃ§Ã£o:</b> '+esc(e.message||e);
  }
}
async function enviarCrediarioWhatsApp(){
  const result=document.getElementById('credWhatsAppResult');
  const body={phone:document.getElementById('credWhatsAppPhone').value,message:document.getElementById('credWhatsAppMessage').value,eventType:document.getElementById('credWhatsAppType').value,orderId:document.getElementById('credWhatsAppOrder').value,customerName:document.getElementById('credWhatsAppCustomer').value};
  const mediaUrl=document.getElementById('credWhatsAppMediaUrl').value.trim();
  if(mediaUrl){body.mediaUrl=mediaUrl;body.fileName=document.getElementById('credWhatsAppFileName').value;body.caption=body.message;}
  try{const path=mediaUrl?'/admin/crediario/whatsapp/enviar-documento':'/admin/crediario/whatsapp/enviar';const j=await apiJson(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});result.classList.remove('hidden');result.innerHTML=`<b>${j.status==='SENT'?'Enviado com sucesso':'Registrado na fila'}</b><br>Provedor: ${esc(j.provider||'')} ${j.messageId?'<br>ID: '+esc(j.messageId):''}`;toast('WhatsApp processado.');carregarHistoricoCrediarioWhatsApp();}catch(e){result.classList.remove('hidden');result.innerHTML='Erro: '+esc(e.message||e)}
}
async function carregarHistoricoCrediarioWhatsApp(){
  const body=document.getElementById('credWhatsAppHistory');if(!body)return;
  try{const j=await apiJson('/admin/crediario/whatsapp/historico?limit=100');const rows=j.logs||[];body.innerHTML=rows.map(r=>`<tr><td>${r.createdAt?new Date(r.createdAt).toLocaleString('pt-BR'):'â€”'}</td><td>${esc(r.customerName||'â€”')}</td><td>${esc(r.phone||'â€”')}</td><td>${esc(r.eventType||r.ruleKey||'â€”')}</td><td><span class="pill ${r.status==='SENT'?'ok':r.status==='ERROR'?'danger':'pending'}">${esc(r.status||'â€”')}</span></td><td>${esc(r.provider||'â€”')}</td></tr>`).join('')||'<tr><td colspan="6">Nenhum envio registrado.</td></tr>';}catch(e){body.innerHTML='<tr><td colspan="6">Erro: '+esc(e.message||e)+'</td></tr>'}
}


function credDashMoney(c){return money((Number(c||0))/100)}
function credDashSet(id,value){const el=document.getElementById(id);if(el)el.textContent=value}
function credDashProgress(target,data,labels){const box=document.getElementById(target);if(!box)return;const entries=Object.entries(data||{});const total=entries.reduce((s,[,v])=>s+Number(v||0),0)||1;box.innerHTML=entries.map(([k,v])=>{const n=Number(v||0),pct=Math.round((n/total)*100);return `<div class="cred-donut-row"><b>${esc(labels[k]||k)}</b><div class="cred-progress"><span style="width:${pct}%"></span></div><strong>${n}</strong></div>`}).join('')||'<div class="muted">Sem dados.</div>'}
function renderCredDashBars(months){const box=document.getElementById('credDashBarras');if(!box)return;const rows=months||[];const max=Math.max(1,...rows.flatMap(x=>[x.expectedCents||0,x.receivedCents||0,x.overdueCents||0]));box.innerHTML=rows.map(x=>{const h=v=>Math.max(v?4:0,Math.round((Number(v||0)/max)*180));const label=String(x.month||'').split('-').reverse().join('/');return `<div class="cred-bar-group" title="${esc(label)} â€” Previsto ${credDashMoney(x.expectedCents)}, recebido ${credDashMoney(x.receivedCents)}, vencido ${credDashMoney(x.overdueCents)}"><span class="cred-bar" style="height:${h(x.expectedCents)}px"></span><span class="cred-bar received" style="height:${h(x.receivedCents)}px"></span><span class="cred-bar overdue" style="height:${h(x.overdueCents)}px"></span><span class="cred-bar-label">${esc(label)}</span></div>`}).join('')||'<div class="muted">Ainda nÃ£o hÃ¡ parcelas para montar o grÃ¡fico.</div>'}
async function loadDashboardCrediario(){
  const errorBox=document.getElementById('credDashErro');
  if(errorBox)errorBox.classList.add('hidden');

  const input=document.getElementById('credDashData');
  if(input&&!input.value)input.value=localDateInputValue();

  try{
    const date=input?.value||localDateInputValue();
    const j=await apiJson('/admin/financeiro/dashboard?dataReferencia='+encodeURIComponent(date));
    const k=j.kpis||{};

    credDashSet('cdHoje',credDashMoney(k.receivableTodayCents));
    credDashSet('cdAmanha',credDashMoney(k.receivableTomorrowCents));
    credDashSet('cdSemana',credDashMoney(k.receivableWeekCents));
    credDashSet('cdMes',credDashMoney(k.receivableMonthCents));
    credDashSet('cdAberto',credDashMoney(k.openPortfolioCents));
    credDashSet('cdVencido',credDashMoney(k.overdueUpdatedCents));
    credDashSet('cdMultas',credDashMoney(k.accumulatedFineCents));
    credDashSet('cdJuros',credDashMoney(k.accumulatedInterestCents));
    credDashSet('cdRecebido',credDashMoney(k.totalReceivedCents));
    credDashSet('cdInadimplencia',Number(k.defaultRatePercent||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})+'%');
    credDashSet('cdTicket',credDashMoney(k.averageTicketCents));
    credDashSet('cdClientes',String(k.customers||0));
    credDashSet('cdParcelasAbertas',`${k.openInstallments||0} parcelas abertas`);
    credDashSet('cdVencidas',`${k.overdueInstallments||0} parcelas vencidas`);
    credDashSet('cdContratos',`${k.contracts||0} carnÃª(s) ativo(s)`);
    credDashSet('cdClientesStatus',`${j.charts?.customerState?.INADIMPLENTE||0} inadimplentes`);

    renderCredDashBars(j.charts?.months||[]);
    credDashProgress('credDashClientes',j.charts?.customerState||{},{
      ADIMPLENTE:'Adimplentes',
      INADIMPLENTE:'Inadimplentes',
      BLOQUEADO:'Bloqueados',
      EM_REVISAO:'Em revisÃ£o'
    });
    credDashProgress('credDashRisco',j.charts?.risk||{},{
      ALTO:'Risco alto',
      MEDIO:'Risco mÃ©dio',
      BOM:'Bom',
      EXCELENTE:'Excelente'
    });

    const body=document.getElementById('credDashComunicacoes');
    if(body){
      body.innerHTML=(j.recentCollections||[]).map(x=>`
        <tr>
          <td>${esc(x.createdAt?new Date(x.createdAt).toLocaleString('pt-BR'):'â€”')}</td>
          <td><b>${esc(x.customerName||'Cliente')}</b><br><small>${esc(x.phone||'')}</small></td>
          <td>${esc(x.orderId||'â€”')}</td>
          <td>${esc(x.eventType||'FINANCEIRO')}</td>
          <td><span class="pill ${x.status==='SENT'?'ok':'pending'}">${esc(x.status||'')}</span></td>
        </tr>`).join('')||'<tr><td colspan="5">Nenhuma comunicaÃ§Ã£o financeira registrada.</td></tr>';
    }
  }catch(e){
    if(errorBox){
      errorBox.textContent=e.message||'Erro ao carregar dashboard.';
      errorBox.classList.remove('hidden');
    }
  }
}




let gestaoCarnesPagina=1;
let gestaoCarnesPaginas=1;

function situacaoCarne(c={}){
  const r=c.resumo||{};
  if(Number(r.saldo||0)<=0.009)return{label:'Quitado',cls:'paid'};
  if(Number(r.atrasadas||0)>0)return{label:'Com atraso',cls:'late'};
  return{label:'Em aberto',cls:'open'};
}

async function pesquisarGestaoCarnes(page=1){
  const tbody=document.getElementById('gcCarnesBody');
  if(!tbody)return;
  gestaoCarnesPagina=Math.max(1,Number(page||1));
  tbody.innerHTML='<tr><td colspan="7">Pesquisando carnÃªs...</td></tr>';

  const params=new URLSearchParams({
    page:String(gestaoCarnesPagina),
    limit:String(document.getElementById('gcLimite')?.value||30),
    q:String(document.getElementById('gcBusca')?.value||'').trim(),
    situacao:String(document.getElementById('gcSituacao')?.value||''),
    dataInicio:String(document.getElementById('gcDataInicio')?.value||''),
    dataFim:String(document.getElementById('gcDataFim')?.value||''),
    sort:String(document.getElementById('gcOrdenacao')?.value||'ultimaSincronizacaoEm'),
    direction:String(document.getElementById('gcDirecao')?.value||'desc')
  });

  try{
    const data=await apiJson('/admin/financeiro/carnes?'+params.toString());
    const rows=Array.isArray(data.carnes)?data.carnes:[];
    gestaoCarnesPaginas=Math.max(1,Number(data.pages||1));
    gestaoCarnesPagina=Math.min(gestaoCarnesPagina,gestaoCarnesPaginas);

    const resumo=data.resumo||{};
    document.getElementById('gcKpiCarnes').textContent=Number(resumo.totalCarnes||0);
    document.getElementById('gcKpiSaldo').textContent=money(resumo.saldoTotal||0);
    document.getElementById('gcKpiAtraso').textContent=Number(resumo.comAtraso||0);
    document.getElementById('gcKpiQuitados').textContent=Number(resumo.quitados||0);
    document.getElementById('gcPaginaInfo').textContent=`PÃ¡gina ${gestaoCarnesPagina} de ${gestaoCarnesPaginas} â€¢ ${Number(data.total||0)} registro(s)`;
    document.getElementById('gcAnterior').disabled=gestaoCarnesPagina<=1;
    document.getElementById('gcProxima').disabled=gestaoCarnesPagina>=gestaoCarnesPaginas;

    if(!rows.length){
      tbody.innerHTML='<tr><td colspan="7">Nenhum carnÃª encontrado com estes filtros.</td></tr>';
      return;
    }

    tbody.innerHTML=rows.map(c=>{
      const r=c.resumo||{};
      const s=situacaoCarne(c);
      return `<tr>
        <td><span class="carne-code">${esc(c.codigo||'')}</span></td>
        <td><span class="client-name">${esc(c.cliente?.nome||'Cliente')}</span><span class="client-phone">${esc(c.cliente?.cpf||c.cliente?.telefone||'')}</span></td>
        <td>${Number(r.parcelas||0)}<br><small>${Number(r.pagas||0)} pagas â€¢ ${Number(r.abertas||0)} abertas â€¢ ${Number(r.atrasadas||0)} atrasadas</small></td>
        <td class="money-cell">${money(r.saldo||0)}</td>
        <td><span class="carne-situation ${s.cls}">${s.label}</span></td>
        <td>${c.ultimaSincronizacaoEm?new Date(c.ultimaSincronizacaoEm).toLocaleString('pt-BR'):'â€”'}</td>
        <td>
          <div class="row-actions">
            <button class="light small" onclick="abrirCarneGestao('${esc(c.id)}')">Abrir</button>
            <button class="blue small" onclick="atualizarCarneGestao('${esc(c.id)}')">Atualizar</button>
            <button class="green small" onclick="enviarCarneGestaoWhatsapp('${esc(c.id)}')">WhatsApp</button>
            <button class="yellow small" onclick="abrirRenegociacao('${esc(c.id)}')">Renegociar</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  }catch(e){
    tbody.innerHTML='<tr><td colspan="7">Erro: '+esc(e.message||e)+'</td></tr>';
  }
}

function mudarPaginaGestaoCarnes(delta){
  const next=gestaoCarnesPagina+Number(delta||0);
  if(next<1||next>gestaoCarnesPaginas)return;
  pesquisarGestaoCarnes(next);
}

function limparFiltrosGestaoCarnes(){
  ['gcBusca','gcDataInicio','gcDataFim'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  ['gcSituacao'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('gcOrdenacao').value='ultimaSincronizacaoEm';
  document.getElementById('gcDirecao').value='desc';
  document.getElementById('gcLimite').value='30';
  pesquisarGestaoCarnes(1);
}

function abrirCriacaoCarneGestao(){
  const btn=[...document.querySelectorAll('.nav button')].find(b=>b.textContent.includes('SIGE Online'));
  if(btn)showTab('sige',btn);
  setTimeout(()=>document.getElementById('sigeCarneBusca')?.focus(),150);
}

async function carregarHistoricoWhatsappCarne(carne={}){
  const box=document.getElementById('gcWhatsappHistorico');
  if(!box)return;

  box.innerHTML='<div class="muted">Carregando histÃ³rico do WhatsApp...</div>';

  try{
    const params=new URLSearchParams({
      limit:'50',
      carneId:String(carne.id||''),
      carneCodigo:String(carne.codigo||''),
      telefone:String(carne.cliente?.telefone||'')
    });

    const data=await apiJson('/admin/financeiro/regua-whatsapp/monitor?'+params.toString());
    const rows=Array.isArray(data.monitor?.recentes)?data.monitor.recentes:[];

    box.innerHTML=`<div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Data e hora</th>
            <th>Tipo</th>
            <th>Telefone</th>
            <th>Status</th>
            <th>Tentativas</th>
            <th>ObservaÃ§Ã£o</th>
          </tr>
        </thead>
        <tbody>
          ${rows.length?rows.map(row=>{
            const status=String(row.deliveryStatus||'UNKNOWN').toUpperCase();
            const cls=status==='READ'||status==='DELIVERED'
              ? 'ok'
              : (status==='FAILED'?'danger':'pending');
            const dataEvento=row.enviadoEm||row.deliveryStatusUpdatedAt||row.createdAt;
            return `<tr>
              <td>${dataEvento?new Date(dataEvento).toLocaleString('pt-BR'):'â€”'}</td>
              <td>${esc(row.tipoEvento||'â€”')}</td>
              <td>${esc(row.telefone||'â€”')}</td>
              <td><span class="pill ${cls}">${esc(status)}</span></td>
              <td>${Number(row.retryCount||0)}</td>
              <td>${row.erro?'<span style="color:#991b1b">Erro registrado</span>':'â€”'}</td>
            </tr>`;
          }).join(''):'<tr><td colspan="6">Nenhuma mensagem de WhatsApp registrada para este carnÃª.</td></tr>'}
        </tbody>
      </table>
    </div>`;
  }catch(e){
    box.innerHTML='<div class="cred-dash-error">Erro ao carregar o histÃ³rico do WhatsApp: '+esc(e.message||e)+'</div>';
  }
}

async function abrirCarneGestao(id){
  const box=document.getElementById('gcDetalhe');
  box.classList.remove('hidden');
  box.innerHTML='Carregando detalhes do carnÃª...';
  try{
    const data=await apiJson('/admin/financeiro/carnes/'+encodeURIComponent(id));
    const c=data.carne||{},r=c.resumo||{},s=situacaoCarne(c);
    const grupos=Array.isArray(c.grupos)?c.grupos:[];
    box.innerHTML=`<div class="history-header">
      <div><h2>${esc(c.codigo||'CarnÃª digital')}</h2><p class="help">${esc(c.cliente?.nome||'Cliente')} â€¢ ${esc(c.cliente?.cpf||c.cliente?.telefone||'')}</p></div>
      <div class="actions" style="margin-top:0">
        <button class="blue" onclick="atualizarCarneGestao('${esc(c.id)}')">ðŸ”„ Atualizar no SIGE</button>
        <button class="yellow" onclick="recalcularCarneBackend('${esc(c.id)}')">ðŸ§® Recalcular valores</button>
        <button class="green" onclick="enviarCarneGestaoWhatsapp('${esc(c.id)}')">ðŸ“² WhatsApp</button>
        <button class="light" onclick="abrirSegundaViaCarne('${esc(c.id)}')">ðŸ§¾ Segunda via</button>
        <button class="yellow" onclick="abrirRenegociacao('${esc(c.id)}')">ðŸ¤ Renegociar</button>
        <button class="red" onclick="arquivarCarne('${esc(c.id)}')">ðŸ“¦ Arquivar</button>
      </div>
    </div>
    <div class="stats">
      <div class="stat"><small>Saldo original</small><br><b>${money(r.saldo||0)}</b></div>
      <div class="stat"><small>Valor atualizado</small><br><b>${money(r.valorAtualizado||r.saldo||0)}</b></div>
      <div class="stat"><small>Parcelas</small><br><b>${Number(r.parcelas||0)}</b></div>
      <div class="stat"><small>SituaÃ§Ã£o</small><br><span class="carne-situation ${s.cls}">${s.label}</span></div>
    </div>
    <div class="receipt">
      <div class="row"><span>Criado em</span><span>${c.createdAt?new Date(c.createdAt).toLocaleString('pt-BR'):'â€”'}</span></div>
      <div class="row"><span>Ãšltima sincronizaÃ§Ã£o</span><span>${c.ultimaSincronizacaoEm?new Date(c.ultimaSincronizacaoEm).toLocaleString('pt-BR'):'â€”'}</span></div>
      <div class="row"><span>Atualizado por</span><span>${esc(c.ultimaSincronizacaoPor||'â€”')}</span></div>
    </div>
    <h3 style="margin-top:18px">Compras e contratos</h3>
    ${grupos.length?grupos.map(g=>{
      const parcelas=Array.isArray(g.parcelas)?g.parcelas:[];
      return `<div class="receipt" style="margin-top:10px">
        <b>${esc(g.documento||'Compra')}</b>
        <div class="muted">${esc(g.descricao||'')}</div>
        <div class="row"><span>Total</span><span>${money(g.total||0)}</span></div>
        <div class="row"><span>Pago</span><span>${money(g.pago||0)}</span></div>
        <div class="row"><span>Saldo original</span><span>${money(g.saldo||0)}</span></div>
        <div class="row"><span>Multa</span><span>${money(g.multa||0)}</span></div>
        <div class="row"><span>Juros</span><span>${money(g.juros||0)}</span></div>
        <div class="row"><span>Valor atualizado</span><span><b>${money(g.valorAtualizado||g.saldo||0)}</b></span></div>

        <h4 style="margin:16px 0 8px">Parcelas do contrato</h4>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Parcela</th>
                <th>Vencimento</th>
                <th>Valor original</th>
                <th>Multa</th>
                <th>Juros</th>
                <th>Valor atualizado</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${parcelas.length?parcelas.map(p=>{
                const calc=p.atualizacaoFinanceira||calcularAtualizacaoParcela(
                  Number(p.saldoParcela??p.saldo??p.valorParcela??p.valor??0),
                  p.dataVencimento,
                  p.status
                );
                const status=p.status==='paga'
                  ? '<span class="pill ok">Paga</span>'
                  : (p.status==='atrasada'
                    ? '<span class="pill" style="background:#fee2e2;color:#991b1b">Atrasada</span>'
                    : '<span class="pill pending">Em aberto</span>');
                const dias=Number(calc.diasAtraso||0);
                return `<tr>
                  <td><b>${esc(p.parcelaLabel||p.parcelaNumero||'â€”')}</b></td>
                  <td>${p.dataVencimento?formatDateBR(p.dataVencimento):'â€”'}${dias>0?`<br><small style="color:#b91c1c">${dias} dia(s) em atraso</small>`:''}</td>
                  <td>${money(calc.original??calc.saldoOriginal??p.valorParcela??p.valor??0)}</td>
                  <td>${money(calc.multa??0)}</td>
                  <td>${money(calc.juros??0)}</td>
                  <td><b>${money(calc.atualizado??calc.valorAtualizado??p.saldoParcela??p.valorParcela??0)}</b></td>
                  <td>${status}</td>
                </tr>`;
              }).join(''):'<tr><td colspan="7">Nenhuma parcela salva neste contrato.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>`;
    }).join(''):'<div class="notice">Nenhum grupo financeiro salvo.</div>'}
    <h3 style="margin-top:18px">HistÃ³rico do WhatsApp</h3>
    <div id="gcWhatsappHistorico" class="receipt">
      <div class="muted">Carregando histÃ³rico do WhatsApp...</div>
    </div>`;
    await carregarHistoricoWhatsappCarne(c);
    box.scrollIntoView({behavior:'smooth',block:'start'});
  }catch(e){
    box.innerHTML='Erro ao abrir carnÃª: '+esc(e.message||e);
  }
}

async function atualizarCarneGestao(id){
  const box=document.getElementById('gcDetalhe');
  if(box){box.classList.remove('hidden');box.innerHTML='Sincronizando o mesmo carnÃª com o SIGE...';}
  try{
    await apiJson('/admin/financeiro/carnes/'+encodeURIComponent(id)+'/sincronizar',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({limit:5000,maxRecords:20000})
    });
    toast('CarnÃª atualizado sem criar duplicidade.');
    await pesquisarGestaoCarnes(gestaoCarnesPagina);
    await abrirCarneGestao(id);
  }catch(e){
    if(box)box.innerHTML='Erro ao atualizar carnÃª: '+esc(e.message||e);
  }
}

document.addEventListener('DOMContentLoaded',()=>{
  const busca=document.getElementById('gcBusca');
  if(busca)busca.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();pesquisarGestaoCarnes(1);}});
});




async function carregarStatusSincronizacao(){
  const box=document.getElementById('syncSigeStatus');
  if(!box)return;
  box.innerHTML='Consultando status...';
  try{
    const data=await apiJson('/admin/financeiro/sincronizacao/status');
    const ultima=data.ultimaSincronizacao;
    box.innerHTML=`<strong>${Number(data.desatualizadosMaisDe60Min||0)} carnÃª(s) desatualizado(s)</strong>
      <div>${Number(data.totalCarnesAtivos||0)} carnÃª(s) ativo(s) no total.</div>
      <div class="muted">AutomÃ¡tico: ${data.automaticoConfigurado?'configurado':'nÃ£o configurado'} â€¢ intervalo ${Number(data.intervaloMinutos||60)} min</div>
      <div class="muted">Ãšltima execuÃ§Ã£o: ${ultima?.iniciadoEm?new Date(ultima.iniciadoEm).toLocaleString('pt-BR'):'nenhuma'}</div>`;
  }catch(e){
    box.innerHTML='<span class="sync-error">'+esc(e.message||e)+'</span>';
  }
}

async function executarSyncSige(somenteDesatualizados=true){
  const result=document.getElementById('syncResultado');
  result.innerHTML='Sincronizando carnÃªs com o SIGE. Aguarde...';
  try{
    const data=await apiJson('/admin/financeiro/sincronizacao/executar',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        somenteDesatualizados,
        minutosDesatualizado:Number(document.getElementById('syncSigeMinutos')?.value||60),
        limite:Number(document.getElementById('syncSigeLimite')?.value||100)
      })
    });
    result.innerHTML=`<div class="sync-ok">SincronizaÃ§Ã£o concluÃ­da</div>
      <div class="row"><span>Selecionados</span><span>${Number(data.totalSelecionado||0)}</span></div>
      <div class="row"><span>Atualizados</span><span>${Number(data.atualizados||0)}</span></div>
      <div class="row"><span>Ignorados</span><span>${Number(data.ignorados||0)}</span></div>
      <div class="row"><span>Erros</span><span>${Number(data.erros||0)}</span></div>
      ${(data.resultados||[]).slice(0,30).map(r=>`<div class="row"><span>${esc(r.codigo||r.cliente||'CarnÃª')}</span><span class="${r.ok?'sync-ok':'sync-error'}">${r.ok?'Atualizado':esc(r.error||r.motivo||'Falha')}</span></div>`).join('')}`;
    toast('SincronizaÃ§Ã£o SIGE concluÃ­da.');
    await carregarStatusSincronizacao();
    await carregarHistoricoSincronizacao();
  }catch(e){
    result.innerHTML='<span class="sync-error">Erro: '+esc(e.message||e)+'</span>';
  }
}

async function carregarHistoricoSincronizacao(){
  const tbody=document.getElementById('syncHistoricoBody');
  if(!tbody)return;
  tbody.innerHTML='<tr><td colspan="7">Carregando...</td></tr>';
  try{
    const data=await apiJson('/admin/financeiro/sincronizacao/historico?limit=30');
    const rows=Array.isArray(data.sincronizacoes)?data.sincronizacoes:[];
    tbody.innerHTML=rows.length?rows.map(r=>`<tr>
      <td>${r.iniciadoEm?new Date(r.iniciadoEm).toLocaleString('pt-BR'):'â€”'}</td>
      <td>${esc(r.tipo||'')}</td>
      <td><span class="pill ${String(r.status||'').includes('ERRO')||r.status==='FALHOU'?'pending':'ok'}">${esc(r.status||'')}</span></td>
      <td>${Number(r.totalSelecionado||0)}</td>
      <td>${Number(r.atualizados||0)}</td>
      <td>${Number(r.erros||0)}</td>
      <td>${esc(r.solicitadoPor||'')}</td>
    </tr>`).join(''):'<tr><td colspan="7">Nenhuma sincronizaÃ§Ã£o registrada.</td></tr>';
  }catch(e){
    tbody.innerHTML='<tr><td colspan="7">Erro: '+esc(e.message||e)+'</td></tr>';
  }
}

async function executarReconciliacaoCora(){
  const box=document.getElementById('syncResultado');
  const status=document.getElementById('syncCoraStatus');
  box.innerHTML='Reconciliando registros Cora...';
  try{
    const data=await apiJson('/admin/cora/carnes/reconciliar-local',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({limit:200})
    });
    status.innerHTML=`<strong>${Number(data.alterados||0)} status alterado(s)</strong><div>${Number(data.total||0)} carnÃª(s) conferido(s).</div>`;
    box.innerHTML=`<div class="sync-ok">ReconciliaÃ§Ã£o Cora concluÃ­da</div>
      <div class="notice">${esc(data.note||'')}</div>
      ${(data.resultados||[]).slice(0,50).map(r=>`<div class="row"><span>${esc(r.code||r.id||'CarnÃª')}</span><span>${esc(r.statusAnterior||'')} â†’ ${esc(r.statusAtual||'')}</span></div>`).join('')}`;
    toast('ReconciliaÃ§Ã£o Cora concluÃ­da.');
  }catch(e){
    status.innerHTML='<span class="sync-error">'+esc(e.message||e)+'</span>';
    box.innerHTML='<span class="sync-error">Erro: '+esc(e.message||e)+'</span>';
  }
}




async function carregarConfiguracaoFinanceira(){
  const box=document.getElementById('sfConfiguracao');
  if(!box)return;
  box.innerHTML='Consultando regras do backend...';
  try{
    const data=await apiJson('/admin/financeiro/configuracao-calculo');
    const c=data.configuracao||{};
    box.innerHTML=`<div class="row"><span>Multa por atraso</span><span><b>${Number(c.finePercent||0).toLocaleString('pt-BR')}%</b></span></div>
      <div class="row"><span>Juros mensais</span><span><b>${Number(c.interestMonthlyPercent||0).toLocaleString('pt-BR')}%</b></span></div>
      <div class="row"><span>FÃ³rmula</span><span>${esc(c.formula||'')}</span></div>
      <div class="row"><span>Fonte do saldo original</span><span>${esc(c.fonteSaldoOriginal||'SIGE')}</span></div>
      <div class="row"><span>CÃ¡lculo no servidor</span><span class="audit-ok">${c.calculadoNoBackend?'ATIVO':'INATIVO'}</span></div>`;
  }catch(e){
    box.innerHTML='<span class="audit-error">'+esc(e.message||e)+'</span>';
  }
}

async function carregarAuditoriaFinanceira(){
  const tbody=document.getElementById('sfAuditBody');
  if(!tbody)return;
  tbody.innerHTML='<tr><td colspan="6">Carregando auditoria...</td></tr>';
  try{
    const q=String(document.getElementById('sfAuditBusca')?.value||'').trim();
    const sucesso=String(document.getElementById('sfAuditSucesso')?.value||'');
    const params=new URLSearchParams({q,sucesso,page:'1',limit:'50'});
    const data=await apiJson('/admin/financeiro/auditoria?'+params.toString());
    const rows=Array.isArray(data.auditoria)?data.auditoria:[];
    tbody.innerHTML=rows.length?rows.map(r=>`<tr>
      <td>${r.createdAt?new Date(r.createdAt).toLocaleString('pt-BR'):'â€”'}</td>
      <td><b>${esc(r.acao||'')}</b></td>
      <td>${esc(r.codigo||'â€”')}</td>
      <td>${esc(r.usuario||'â€”')}</td>
      <td><span class="${r.sucesso?'audit-ok':'audit-error'}">${r.sucesso?'Sucesso':'Falha'}</span></td>
      <td>${esc(r.entidade||'â€”')}</td>
    </tr>`).join(''):'<tr><td colspan="6">Nenhum registro de auditoria encontrado.</td></tr>';
  }catch(e){
    tbody.innerHTML='<tr><td colspan="6">Erro: '+esc(e.message||e)+'</td></tr>';
  }
}

async function recalcularCarneBackend(id){
  const box=document.getElementById('gcDetalhe');
  if(box){box.classList.remove('hidden');box.innerHTML='Recalculando multa, juros e valor atualizado no backend...';}
  try{
    const data=await apiJson('/admin/financeiro/carnes/'+encodeURIComponent(id)+'/recalcular',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({dataReferencia:new Date().toISOString()})
    });
    toast(data.message||'Valores recalculados.');
    await pesquisarGestaoCarnes(gestaoCarnesPagina);
    await abrirCarneGestao(id);
  }catch(e){
    if(box)box.innerHTML='<span class="audit-error">Erro: '+esc(e.message||e)+'</span>';
  }
}




function abrirGestaoParaOperacao(){
  const btn=[...document.querySelectorAll('.nav button')].find(b=>b.textContent.includes('GestÃ£o de CarnÃªs'));
  if(btn)showTab('gestaoCarnes',btn);
}

function abrirSigeParaPagamento(){
  const btn=[...document.querySelectorAll('.nav button')].find(b=>b.textContent.includes('SIGE Online'));
  if(btn)showTab('sige',btn);
}

async function enviarCarneGestaoWhatsapp(id){
  try{
    const data=await apiJson('/admin/financeiro/carnes/'+encodeURIComponent(id)+'/enviar-whatsapp',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({})
    });
    toast(data.message||'CarnÃª enviado pelo WhatsApp.');
  }catch(e){
    toast('Erro: '+(e.message||e));
  }
}

async function abrirSegundaViaCarne(id){
  const box=document.getElementById('gcDetalhe');
  if(box){box.classList.remove('hidden');box.innerHTML='Carregando segunda via...';}
  try{
    const data=await apiJson('/admin/financeiro/carnes/'+encodeURIComponent(id)+'/segunda-via');
    await abrirCarneGestao(id);
    toast(data.message||'Segunda via carregada.');
  }catch(e){
    if(box)box.innerHTML='Erro: '+esc(e.message||e);
  }
}

async function arquivarCarne(id){
  if(!confirm('Arquivar este carnÃª? Ele nÃ£o serÃ¡ apagado e poderÃ¡ ser reativado depois.'))return;
  try{
    const data=await apiJson('/admin/financeiro/carnes/'+encodeURIComponent(id)+'/status',{
      method:'PATCH',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({status:'ARQUIVADO',motivo:'Arquivado manualmente no painel'})
    });
    toast(data.message||'CarnÃª arquivado.');
    document.getElementById('gcDetalhe')?.classList.add('hidden');
    await pesquisarGestaoCarnes(1);
  }catch(e){
    toast('Erro: '+(e.message||e));
  }
}

async function abrirRenegociacao(id){
  const overlay=document.getElementById('renegOverlay');
  const resumoBox=document.getElementById('renegResumo');
  document.getElementById('renegCarneId').value=id;
  document.getElementById('renegResultado').innerHTML='Preencha os dados e confira a proposta.';
  overlay.classList.remove('hidden');
  resumoBox.innerHTML='Carregando carnÃª...';
  try{
    const data=await apiJson('/admin/financeiro/carnes/'+encodeURIComponent(id));
    const c=data.carne||{},r=c.resumo||{};
    document.getElementById('renegValorBase').value=Number(r.valorAtualizado||r.saldo||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
    const d=new Date();d.setDate(d.getDate()+30);
    document.getElementById('renegPrimeiroVencimento').value=localDateInputValue(d);
    resumoBox.innerHTML=`<div class="row"><span>CarnÃª</span><span>${esc(c.codigo||'')}</span></div>
      <div class="row"><span>Cliente</span><span>${esc(c.cliente?.nome||'')}</span></div>
      <div class="row"><span>Saldo original</span><span>${money(r.saldo||0)}</span></div>
      <div class="row"><span>Multa</span><span>${money(r.multa||0)}</span></div>
      <div class="row"><span>Juros</span><span>${money(r.juros||0)}</span></div>
      <div class="row"><span>Valor atualizado</span><span><b>${money(r.valorAtualizado||r.saldo||0)}</b></span></div>`;
  }catch(e){
    resumoBox.innerHTML='Erro: '+esc(e.message||e);
  }
}

function fecharRenegociacao(){
  document.getElementById('renegOverlay')?.classList.add('hidden');
}

function parseMoneyInput(v){
  const raw=String(v||'').trim();
  if(!raw)return 0;
  return Number(raw.replace(/\./g,'').replace(',','.'))||0;
}

async function preverRenegociacao(){
  const id=document.getElementById('renegCarneId').value;
  const box=document.getElementById('renegResultado');
  box.innerHTML='Calculando proposta...';
  try{
    const payload={
      valorBase:parseMoneyInput(document.getElementById('renegValorBase').value),
      entrada:parseMoneyInput(document.getElementById('renegEntrada').value),
      quantidadeParcelas:Number(document.getElementById('renegParcelas').value||1),
      primeiroVencimento:document.getElementById('renegPrimeiroVencimento').value
    };
    const data=await apiJson('/admin/financeiro/carnes/'+encodeURIComponent(id)+'/renegociacoes/preview',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    });
    const p=data.proposta||{};
    box.innerHTML=`<div class="row"><span>Valor base</span><span>${money(p.valorBase||0)}</span></div>
      <div class="row"><span>Entrada</span><span>${money(p.entrada||0)}</span></div>
      <div class="row"><span>Saldo renegociado</span><span>${money(p.saldoRenegociado||0)}</span></div>
      <div class="row"><span>Plano</span><span><b>${Number(p.quantidadeParcelas||0)}x de ${money(p.valorParcela||0)}</b></span></div>
      <div class="notice" style="margin-top:10px">${esc(data.note||'')}</div>`;
  }catch(e){
    box.innerHTML='Erro: '+esc(e.message||e);
  }
}

async function salvarRenegociacao(){
  if(!confirm('Salvar esta proposta de renegociaÃ§Ã£o? O carnÃª original continuarÃ¡ preservado.'))return;
  const id=document.getElementById('renegCarneId').value;
  const box=document.getElementById('renegResultado');
  box.innerHTML='Salvando proposta...';
  try{
    const payload={
      valorBase:parseMoneyInput(document.getElementById('renegValorBase').value),
      entrada:parseMoneyInput(document.getElementById('renegEntrada').value),
      quantidadeParcelas:Number(document.getElementById('renegParcelas').value||1),
      primeiroVencimento:document.getElementById('renegPrimeiroVencimento').value,
      observacao:document.getElementById('renegObservacao').value
    };
    const data=await apiJson('/admin/financeiro/carnes/'+encodeURIComponent(id)+'/renegociacoes',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    });
    box.innerHTML='<span class="audit-ok">'+esc(data.message||'Proposta salva.')+'</span>';
    toast(data.message||'Proposta salva.');
  }catch(e){
    box.innerHTML='Erro: '+esc(e.message||e);
  }
}




let filaPagina=1;
let filaPaginas=1;

function hojeLocalISO(){
  const d=new Date();
  const local=new Date(d.getTime()-d.getTimezoneOffset()*60000);
  return local.toISOString().slice(0,10);
}

function labelFaixaFila(v=''){
  return ({
    VENCE_AMANHA:'Vence amanhÃ£',
    VENCE_HOJE:'Vence hoje',
    '1_3':'1 a 3 dias',
    '4_7':'4 a 7 dias',
    '8_15':'8 a 15 dias',
    '16_30':'16 a 30 dias',
    '31_60':'31 a 60 dias',
    MAIS_60:'Mais de 60 dias',
    SEM_FAIXA:'Sem faixa'
  })[v]||v;
}

function inicializarFilaCobranca(){
  const data=document.getElementById('filaData');
  if(data&&!data.value)data.value=hojeLocalISO();
}

async function gerarFilaCobranca(){
  inicializarFilaCobranca();
  const tbody=document.getElementById('filaBody');
  if(tbody)tbody.innerHTML='<tr><td colspan="8">Analisando carnÃªs e gerando tarefas...</td></tr>';
  try{
    const data=await apiJson('/admin/financeiro/fila-cobranca/gerar',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        dataReferencia:document.getElementById('filaData')?.value||hojeLocalISO(),
        limiteCarnes:2000
      })
    });
    toast(`Fila atualizada: ${Number(data.criados||0)} nova(s), ${Number(data.atualizados||0)} atualizada(s).`);
    await carregarFilaCobranca(1);
  }catch(e){
    if(tbody)tbody.innerHTML='<tr><td colspan="8">Erro: '+esc(e.message||e)+'</td></tr>';
  }
}

async function carregarFilaCobranca(page=1){
  inicializarFilaCobranca();
  filaPagina=Math.max(1,Number(page||1));
  const tbody=document.getElementById('filaBody');
  if(!tbody)return;
  tbody.innerHTML='<tr><td colspan="8">Carregando fila...</td></tr>';

  const params=new URLSearchParams({
    dataReferencia:document.getElementById('filaData')?.value||hojeLocalISO(),
    q:String(document.getElementById('filaBusca')?.value||'').trim(),
    faixa:String(document.getElementById('filaFaixa')?.value||''),
    prioridade:String(document.getElementById('filaPrioridade')?.value||''),
    status:String(document.getElementById('filaStatus')?.value||''),
    page:String(filaPagina),
    limit:'50'
  });
  if(document.getElementById('filaSomenteSemContato')?.checked)params.set('semContato','true');

  try{
    const data=await apiJson('/admin/financeiro/fila-cobranca?'+params.toString());
    const rows=Array.isArray(data.fila)?data.fila:[];
    filaPaginas=Math.max(1,Number(data.pages||1));
    filaPagina=Math.min(filaPagina,filaPaginas);
    const r=data.resumo||{};

    document.getElementById('filaKpiTotal').textContent=Number(r.total||0);
    document.getElementById('filaKpiValor').textContent=money(r.valorAtualizado||0);
    document.getElementById('filaKpiPendentes').textContent=Number(r.pendentes||0);
    document.getElementById('filaKpiCriticas').textContent=Number(r.criticos||0);
    document.getElementById('filaKpiAltas').textContent=Number(r.altas||0);
    document.getElementById('filaKpiSemContato').textContent=Number(r.semContato||0);

    document.getElementById('filaPaginaInfo').textContent=`PÃ¡gina ${filaPagina} de ${filaPaginas} â€¢ ${Number(data.total||0)} tarefa(s)`;
    document.getElementById('filaAnterior').disabled=filaPagina<=1;
    document.getElementById('filaProxima').disabled=filaPagina>=filaPaginas;

    const faixas=document.getElementById('filaFaixas');
    const fx=Array.isArray(data.faixas)?data.faixas:[];
    faixas.innerHTML=fx.length?fx.map(f=>`<div class="faixa-card">
      <b>${esc(labelFaixaFila(f.faixa))}</b>
      <small>${Number(f.quantidade||0)} parcela(s)</small>
      <div style="margin-top:6px;font-weight:900">${money(f.valorAtualizado||0)}</div>
    </div>`).join(''):'<div class="faixa-card">Nenhuma faixa encontrada.</div>';

    if(!rows.length){
      tbody.innerHTML='<tr><td colspan="8">Nenhuma tarefa encontrada para estes filtros.</td></tr>';
      return;
    }

    tbody.innerHTML=rows.map(item=>`<tr>
      <td><span class="priority-badge ${esc(item.prioridade)}">${esc(item.prioridade)}</span><br><small>Score ${Number(item.prioridadeScore||0)}</small></td>
      <td><span class="client-name">${esc(item.clienteNome||'Cliente')}</span>
        <span class="client-phone">${item.telefone?esc(item.telefone):'<span class="inad-no-phone">Sem contato</span>'}</span>
        <small>${esc(item.carneCodigo||'')}</small></td>
      <td><b>${esc(item.parcelaLabel||item.documento||'Parcela')}</b><br><small>${esc(item.documento||'')}</small>
        ${item.primeiraParcelaAtrasada?'<br><span class="pill pending">1Âª parcela atrasada</span>':''}</td>
      <td>${item.vencimento?new Date(item.vencimento).toLocaleDateString('pt-BR'):'â€”'}<br><small>${esc(labelFaixaFila(item.faixa))}</small></td>
      <td><span class="inad-days">${Number(item.diasAtraso||0)} dia(s)</span><br><small>${Number(item.totalParcelasAtrasadasCliente||0)} atrasada(s) no cliente</small></td>
      <td class="money-cell">${money(item.valorAtualizado||0)}<br><small>Multa ${money(item.multa||0)} â€¢ Juros ${money(item.juros||0)}</small></td>
      <td><span class="status-fila ${esc(item.status)}">${esc(item.status)}</span><br><small>${esc(item.responsavel||'')}</small></td>
      <td><div class="fila-actions">
        <button class="light" onclick="abrirCarneGestao('${esc(item.carneId)}')">Abrir</button>
        ${item.telefone?`<button class="green" onclick="enviarCarneGestaoWhatsapp('${esc(item.carneId)}')">WhatsApp</button>`:''}
        <button class="blue" onclick="abrirTratativa('${esc(item.id)}','${esc(item.carneId)}','${esc(item.clienteNome||'')}','${esc(item.parcelaLabel||'')}','${esc(item.documento||'')}')">Tratativa</button>
        <button class="blue" onclick="atualizarItemFila('${esc(item.id)}','CONTATADO')">Contatado</button>
        <button class="yellow" onclick="abrirPromessaPagamento('${esc(item.id)}','${esc(item.carneId)}','${esc(item.clienteNome||'')}','${esc(item.parcelaLabel||'')}','${esc(item.documento||'')}',${Number(item.valorAtualizado||0)})">Promessa</button>
        <button class="yellow" onclick="adiarItemFila('${esc(item.id)}')">Adiar</button>
        <button class="red" onclick="atualizarItemFila('${esc(item.id)}','SEM_CONTATO')">Sem contato</button>
        <button class="green" onclick="atualizarItemFila('${esc(item.id)}','CONCLUIDO')">Concluir</button>
      </div></td>
    </tr>`).join('');
  }catch(e){
    tbody.innerHTML='<tr><td colspan="8">Erro: '+esc(e.message||e)+'</td></tr>';
  }
}

function mudarPaginaFila(delta){
  const next=filaPagina+Number(delta||0);
  if(next<1||next>filaPaginas)return;
  carregarFilaCobranca(next);
}

function limparFiltrosFila(){
  ['filaBusca','filaFaixa','filaPrioridade','filaStatus'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.value='';
  });
  const sem=document.getElementById('filaSomenteSemContato');if(sem)sem.checked=false;
  carregarFilaCobranca(1);
}

async function atualizarItemFila(id,status,extra={}){
  try{
    const data=await apiJson('/admin/financeiro/fila-cobranca/'+encodeURIComponent(id),{
      method:'PATCH',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({status,...extra})
    });
    toast(data.message||'Tarefa atualizada.');
    await carregarFilaCobranca(filaPagina);
  }catch(e){
    toast('Erro: '+(e.message||e));
  }
}

async function adiarItemFila(id){
  const data=prompt('Informe a prÃ³xima data e hora no formato AAAA-MM-DD HH:MM');
  if(!data)return;
  const normalized=data.includes('T')?data:data.replace(' ','T');
  const d=new Date(normalized);
  if(Number.isNaN(d.getTime())){toast('Data invÃ¡lida.');return;}
  const obs=prompt('ObservaÃ§Ã£o do adiamento:')||'';
  await atualizarItemFila(id,'ADIADO',{proximaAcaoEm:d.toISOString(),observacao:obs,ultimaAcao:'COBRANCA_ADIADA'});
}

document.addEventListener('DOMContentLoaded',()=>{
  const busca=document.getElementById('filaBusca');
  if(busca)busca.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();carregarFilaCobranca(1);}});
});




let promessaPagina=1;
let promessaPaginas=1;

function abrirPromessaPagamento(filaItemId,carneId,cliente,parcela,documento,valor){
  document.getElementById('promiseFilaItemId').value=filaItemId||'';
  document.getElementById('promiseCarneId').value=carneId||'';
  document.getElementById('promiseDocumento').value=documento||'';
  document.getElementById('promiseParcelaLabel').value=parcela||'';
  document.getElementById('promiseValor').value=Number(valor||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  const d=new Date();d.setDate(d.getDate()+3);
  document.getElementById('promiseData').value=localDateInputValue(d);
  document.getElementById('promiseObservacao').value='';
  document.getElementById('promiseResultado').innerHTML='Preencha os dados da promessa.';
  document.getElementById('promiseResumo').innerHTML=`<div class="row"><span>Cliente</span><span>${esc(cliente||'')}</span></div>
    <div class="row"><span>Parcela</span><span>${esc(parcela||documento||'')}</span></div>
    <div class="row"><span>Valor atual</span><span>${money(valor||0)}</span></div>`;
  document.getElementById('promiseOverlay').classList.remove('hidden');
}

function fecharPromessaPagamento(){
  document.getElementById('promiseOverlay')?.classList.add('hidden');
}

async function salvarPromessaPagamento(){
  const box=document.getElementById('promiseResultado');
  box.innerHTML='Registrando promessa...';
  try{
    const payload={
      filaItemId:document.getElementById('promiseFilaItemId').value,
      carneId:document.getElementById('promiseCarneId').value,
      documento:document.getElementById('promiseDocumento').value,
      parcelaLabel:document.getElementById('promiseParcelaLabel').value,
      valorPrometido:parseMoneyInput(document.getElementById('promiseValor').value),
      dataPrometida:document.getElementById('promiseData').value,
      formaPagamento:document.getElementById('promiseForma').value,
      observacao:document.getElementById('promiseObservacao').value,
      enviarWhatsapp:document.getElementById('promiseEnviarWhatsapp').value==='true'
    };
    const data=await apiJson('/admin/financeiro/promessas',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    });
    box.innerHTML='<span class="audit-ok">'+esc(data.message||'Promessa registrada.')+'</span>';
    toast(data.message||'Promessa registrada.');
    await carregarFilaCobranca(filaPagina);
    setTimeout(fecharPromessaPagamento,900);
  }catch(e){
    box.innerHTML='Erro: '+esc(e.message||e);
  }
}

async function carregarPromessasPagamento(page=1){
  promessaPagina=Math.max(1,Number(page||1));
  const tbody=document.getElementById('promessasBody');
  if(!tbody)return;
  tbody.innerHTML='<tr><td colspan="7">Carregando promessas...</td></tr>';

  const params=new URLSearchParams({
    q:String(document.getElementById('promessaBusca')?.value||'').trim(),
    status:String(document.getElementById('promessaStatus')?.value||''),
    dataInicio:String(document.getElementById('promessaDataInicio')?.value||''),
    dataFim:String(document.getElementById('promessaDataFim')?.value||''),
    page:String(promessaPagina),
    limit:'50'
  });

  try{
    const data=await apiJson('/admin/financeiro/promessas?'+params.toString());
    const rows=Array.isArray(data.promessas)?data.promessas:[];
    promessaPaginas=Math.max(1,Number(data.pages||1));
    const r=data.resumo||{};

    document.getElementById('ppKpiTotal').textContent=Number(r.total||0);
    document.getElementById('ppKpiValor').textContent=money(r.valorTotal||0);
    document.getElementById('ppKpiPendentes').textContent=Number(r.pendentes||0);
    document.getElementById('ppKpiCumpridas').textContent=Number(r.cumpridas||0);
    document.getElementById('ppKpiQuebradas').textContent=Number(r.quebradas||0);
    document.getElementById('promessaPaginaInfo').textContent=`PÃ¡gina ${promessaPagina} de ${promessaPaginas} â€¢ ${Number(data.total||0)} promessa(s)`;
    document.getElementById('promessaAnterior').disabled=promessaPagina<=1;
    document.getElementById('promessaProxima').disabled=promessaPagina>=promessaPaginas;

    tbody.innerHTML=rows.length?rows.map(p=>`<tr>
      <td><span class="client-name">${esc(p.clienteNome||'Cliente')}</span><span class="client-phone">${esc(p.telefone||p.clienteCpf||'')}</span></td>
      <td><b>${esc(p.carneCodigo||'')}</b><br><small>${esc(p.parcelaLabel||p.documento||'')}</small></td>
      <td class="money-cell">${money(p.valorPrometido||0)}</td>
      <td>${p.dataPrometida?new Date(p.dataPrometida).toLocaleDateString('pt-BR'):'â€”'}</td>
      <td>${esc(p.formaPagamento||'')}</td>
      <td><span class="promise-status ${esc(p.status)}">${esc(p.status)}</span></td>
      <td><div class="fila-actions">
        ${p.status==='PENDENTE'?`<button class="green" onclick="atualizarStatusPromessa('${esc(p.id)}','CUMPRIDA')">Cumprida</button>
        <button class="red" onclick="atualizarStatusPromessa('${esc(p.id)}','QUEBRADA')">Quebrada</button>
        <button class="light" onclick="atualizarStatusPromessa('${esc(p.id)}','CANCELADA')">Cancelar</button>`:''}
      </div></td>
    </tr>`).join(''):'<tr><td colspan="7">Nenhuma promessa encontrada.</td></tr>';
  }catch(e){
    tbody.innerHTML='<tr><td colspan="7">Erro: '+esc(e.message||e)+'</td></tr>';
  }
}

function mudarPaginaPromessas(delta){
  const next=promessaPagina+Number(delta||0);
  if(next<1||next>promessaPaginas)return;
  carregarPromessasPagamento(next);
}

function limparFiltrosPromessas(){
  ['promessaBusca','promessaStatus','promessaDataInicio','promessaDataFim'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.value='';
  });
  carregarPromessasPagamento(1);
}

async function atualizarStatusPromessa(id,status){
  if(!confirm(`Alterar esta promessa para ${status}?`))return;
  try{
    const data=await apiJson('/admin/financeiro/promessas/'+encodeURIComponent(id)+'/status',{
      method:'PATCH',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({status})
    });
    toast(data.message||'Promessa atualizada.');
    await carregarPromessasPagamento(promessaPagina);
  }catch(e){
    toast('Erro: '+(e.message||e));
  }
}

async function processarPromessasVencidas(){
  try{
    const data=await apiJson('/admin/financeiro/promessas/processar-vencidas',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:'{}'
    });
    toast(`${Number(data.quebradas||0)} promessa(s) vencida(s) marcada(s) como quebrada(s).`);
    await carregarPromessasPagamento(1);
  }catch(e){
    toast('Erro: '+(e.message||e));
  }
}




function primeiroDiaMesISO(){const d=new Date();return localDateInputValue(new Date(d.getFullYear(),d.getMonth(),1));}
function ultimoDiaMesISO(){const d=new Date();return localDateInputValue(new Date(d.getFullYear(),d.getMonth()+1,0));}
function pct(v){return `${Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}%`;}

async function inicializarRecuperacaoCredito(){
  const ini=document.getElementById('recDataInicio');
  const fim=document.getElementById('recDataFim');

  try{
    const periodo=await apiJson('/admin/financeiro/recuperacao/periodo-disponivel');
    if(ini&&!ini.value)ini.value=periodo.dataInicio||primeiroDiaMesISO();
    if(fim&&!fim.value)fim.value=periodo.dataFim||ultimoDiaMesISO();
  }catch(_e){
    if(ini&&!ini.value)ini.value=primeiroDiaMesISO();
    if(fim&&!fim.value)fim.value=ultimoDiaMesISO();
  }

  carregarRecuperacaoCredito();
}

async function carregarRecuperacaoCredito(){
  const erro=document.getElementById('recErro');
  erro?.classList.add('hidden');
  const params=new URLSearchParams({
    dataInicio:document.getElementById('recDataInicio')?.value||primeiroDiaMesISO(),
    dataFim:document.getElementById('recDataFim')?.value||ultimoDiaMesISO()
  });

  try{
    const data=await apiJson('/admin/financeiro/recuperacao/dashboard?'+params.toString());
    const i=data.indicadores||{};

    document.getElementById('recValorPrometido').textContent=money(i.valorPrometido||0);
    document.getElementById('recValorCumprido').textContent=money(i.valorCumprido||0);
    document.getElementById('recTaxaFinanceira').textContent=pct(i.taxaRecuperacaoFinanceira||0);
    document.getElementById('recTaxaPromessas').textContent=pct(i.taxaCumprimentoPromessas||0);
    document.getElementById('recPromessasPendentes').textContent=Number(i.promessasPendentes||0);
    document.getElementById('recPromessasQuebradas').textContent=Number(i.promessasQuebradas||0);
    document.getElementById('recTempoMedio').textContent=`${Number(i.tempoMedioCumprimentoDias||0).toLocaleString('pt-BR',{maximumFractionDigits:2})} dias`;
    document.getElementById('recPagamentosSige').textContent=Number(i.pagamentosConfirmadosSige||0);
    document.getElementById('recTarefas').textContent=Number(i.tarefasFila||0);
    document.getElementById('recConcluidas').textContent=Number(i.tarefasConcluidas||0);
    document.getElementById('recTaxaFila').textContent=pct(i.taxaConclusaoFila||0);
    document.getElementById('recSemContato').textContent=Number(i.tarefasSemContato||0);

    renderRecuperacaoBarras(Array.isArray(data.serieDiaria)?data.serieDiaria:[]);
    renderRecuperacaoEficiencia(i);

    document.getElementById('recResumo').innerHTML=`
      <div class="row"><span>Valor da carteira em cobranÃ§a</span><span>${money(i.valorCarteiraCobranca||0)}</span></div>
      <div class="row"><span>Valor de promessas quebradas</span><span>${money(i.valorQuebrado||0)}</span></div>
      <div class="row"><span>Tarefas crÃ­ticas</span><span>${Number(i.tarefasCriticas||0)}</span></div>
      <div class="row"><span>Tarefas de alta prioridade</span><span>${Number(i.tarefasAltaPrioridade||0)}</span></div>
      <div class="row"><span>CobranÃ§as por WhatsApp registradas</span><span>${Number(i.cobrancasWhatsappRegistradas||0)}</span></div>
      <div class="row"><span>Eventos de recuperaÃ§Ã£o</span><span>${Number(i.eventosRecuperacao||0)}</span></div>
      <div class="row"><span>Atraso mÃ©dio apÃ³s promessa quebrada</span><span>${Number(i.atrasoMedioPromessaQuebradaDias||0).toLocaleString('pt-BR',{maximumFractionDigits:2})} dias</span></div>`;
  }catch(e){
    if(erro){
      erro.textContent=e.message||e;
      erro.classList.remove('hidden');
    }
  }
}

function renderRecuperacaoBarras(rows=[]){
  const box=document.getElementById('recBarras');
  if(!box)return;
  if(!rows.length){
    box.innerHTML='<div class="muted">NÃ£o hÃ¡ promessas ou eventos de recuperaÃ§Ã£o neste perÃ­odo. Ajuste as datas ou registre movimentaÃ§Ãµes na Fila do Dia.</div>';
    return;
  }

  const max=Math.max(1,...rows.flatMap(r=>[
    Number(r.promessas||0),
    Number(r.promessasCumpridas||0),
    Number(r.promessasQuebradas||0)
  ]));

  box.innerHTML=rows.map(r=>{
    const p=Math.max(2,Math.round((Number(r.promessas||0)/max)*180));
    const c=Math.max(2,Math.round((Number(r.promessasCumpridas||0)/max)*180));
    const q=Math.max(2,Math.round((Number(r.promessasQuebradas||0)/max)*180));
    const label=r.data?new Date(r.data+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'}):'';
    return `<div class="recovery-day" title="${esc(r.data||'')}">
      <div class="recovery-bar" style="height:${p}px"></div>
      <div class="recovery-bar success" style="height:${c}px"></div>
      <div class="recovery-bar broken" style="height:${q}px"></div>
      <span class="recovery-label">${esc(label)}</span>
    </div>`;
  }).join('');
}

function renderRecuperacaoEficiencia(i={}){
  const box=document.getElementById('recEficiencia');
  if(!box)return;
  const rows=[
    {label:'RecuperaÃ§Ã£o financeira',value:Number(i.taxaRecuperacaoFinanceira||0),cls:'success'},
    {label:'Promessas cumpridas',value:Number(i.taxaCumprimentoPromessas||0),cls:'success'},
    {label:'ConclusÃ£o da fila',value:Number(i.taxaConclusaoFila||0),cls:''},
    {label:'Sem contato',value:i.tarefasFila?Number((Number(i.tarefasSemContato||0)/Number(i.tarefasFila||1))*100):0,cls:'danger'}
  ];
  box.innerHTML=rows.map(r=>`<div class="recovery-row">
    <span>${esc(r.label)}</span>
    <div class="recovery-progress ${r.cls}"><span style="width:${Math.max(0,Math.min(100,r.value))}%"></span></div>
    <b>${pct(r.value)}</b>
  </div>`).join('');
}




let tratPagina=1;
let tratPaginas=1;

function labelMotivoTratativa(v=''){
  return ({
    ESQUECEU:'Esqueceu',
    NAO_RECEBEU_COBRANCA:'NÃ£o recebeu cobranÃ§a',
    PROBLEMA_FINANCEIRO_TEMPORARIO:'Problema financeiro temporÃ¡rio',
    PERDA_DE_RENDA:'Perda de renda',
    PRODUTO_COM_PROBLEMA:'Produto com problema',
    DISCORDANCIA_DE_VALOR:'DiscordÃ¢ncia de valor',
    PAGAMENTO_JA_REALIZADO:'Pagamento jÃ¡ realizado',
    TELEFONE_INCORRETO:'Telefone incorreto',
    SEM_RETORNO:'Sem retorno',
    SOLICITOU_RENEGOCIACAO:'Solicitou renegociaÃ§Ã£o',
    OUTRO:'Outro'
  })[v]||v;
}

function labelResultadoTratativa(v=''){
  return ({
    SEM_RETORNO:'Sem retorno',
    CLIENTE_CIENTE:'Cliente ciente',
    PAGAMENTO_PROMETIDO:'Pagamento prometido',
    COMPROVANTE_ENVIADO:'Comprovante enviado',
    NEGOCIACAO_SOLICITADA:'NegociaÃ§Ã£o solicitada',
    CONTESTACAO_ABERTA:'ContestaÃ§Ã£o aberta',
    CONTATO_INVALIDO:'Contato invÃ¡lido',
    RESOLVIDO:'Resolvido'
  })[v]||v;
}

function labelProximaAcao(v=''){
  return ({
    ACOMPANHAR:'Acompanhar',
    ENVIAR_WHATSAPP:'Enviar WhatsApp',
    LIGAR:'Ligar',
    AGUARDAR_COMPROVANTE:'Aguardar comprovante',
    AGUARDAR_PAGAMENTO:'Aguardar pagamento',
    RENEGOCIAR:'Renegociar',
    CORRIGIR_CADASTRO:'Corrigir cadastro',
    ENCAMINHAR_ASSISTENCIA:'Encaminhar assistÃªncia',
    ENCAMINHAR_FINANCEIRO:'Encaminhar financeiro',
    ENCERRAR:'Encerrar'
  })[v]||v;
}

function abrirTratativa(filaItemId,carneId,cliente,parcela,documento){
  document.getElementById('treatFilaItemId').value=filaItemId||'';
  document.getElementById('treatCarneId').value=carneId||'';
  document.getElementById('treatDocumento').value=documento||'';
  document.getElementById('treatParcelaLabel').value=parcela||'';
  document.getElementById('treatObservacao').value='';
  document.getElementById('treatMotivoDetalhe').value='';
  document.getElementById('treatResultadoBox').innerHTML='Preencha os dados da tratativa.';
  const d=new Date();d.setDate(d.getDate()+1);d.setHours(9,0,0,0);
  const local=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
  document.getElementById('treatProximaAcaoEm').value=local;
  document.getElementById('treatResumo').innerHTML=`<div class="row"><span>Cliente</span><span>${esc(cliente||'')}</span></div>
    <div class="row"><span>Parcela</span><span>${esc(parcela||documento||'')}</span></div>
    <div class="row"><span>Documento</span><span>${esc(documento||'')}</span></div>`;
  document.getElementById('treatOverlay').classList.remove('hidden');
}

function fecharTratativa(){
  document.getElementById('treatOverlay')?.classList.add('hidden');
}

async function salvarTratativa(){
  const box=document.getElementById('treatResultadoBox');
  box.innerHTML='Registrando tratativa...';
  try{
    const dt=document.getElementById('treatProximaAcaoEm').value;
    const payload={
      filaItemId:document.getElementById('treatFilaItemId').value,
      carneId:document.getElementById('treatCarneId').value,
      documento:document.getElementById('treatDocumento').value,
      parcelaLabel:document.getElementById('treatParcelaLabel').value,
      motivo:document.getElementById('treatMotivo').value,
      motivoDetalhe:document.getElementById('treatMotivoDetalhe').value,
      canal:document.getElementById('treatCanal').value,
      resultado:document.getElementById('treatResultado').value,
      proximaAcao:document.getElementById('treatProximaAcao').value,
      proximaAcaoEm:dt?new Date(dt).toISOString():null,
      observacao:document.getElementById('treatObservacao').value
    };
    const data=await apiJson('/admin/financeiro/tratativas',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    });
    box.innerHTML='<span class="audit-ok">'+esc(data.message||'Tratativa registrada.')+'</span>';
    toast(data.message||'Tratativa registrada.');
    await carregarFilaCobranca(filaPagina);
    setTimeout(fecharTratativa,900);
  }catch(e){
    box.innerHTML='Erro: '+esc(e.message||e);
  }
}

async function carregarTratativas(page=1){
  tratPagina=Math.max(1,Number(page||1));
  const tbody=document.getElementById('tratBody');
  if(!tbody)return;
  tbody.innerHTML='<tr><td colspan="8">Carregando tratativas...</td></tr>';

  const params=new URLSearchParams({
    q:String(document.getElementById('tratBusca')?.value||'').trim(),
    motivo:String(document.getElementById('tratMotivo')?.value||''),
    resultado:String(document.getElementById('tratResultado')?.value||''),
    concluida:String(document.getElementById('tratConcluida')?.value||''),
    page:String(tratPagina),
    limit:'50'
  });

  try{
    const data=await apiJson('/admin/financeiro/tratativas?'+params.toString());
    const rows=Array.isArray(data.tratativas)?data.tratativas:[];
    tratPaginas=Math.max(1,Number(data.pages||1));
    const r=data.resumo||{};

    document.getElementById('tratKpiTotal').textContent=Number(r.total||0);
    document.getElementById('tratKpiAbertas').textContent=Number(r.abertas||0);
    document.getElementById('tratKpiConcluidas').textContent=Number(r.concluidas||0);
    document.getElementById('tratKpiSemRetorno').textContent=Number(r.semRetorno||0);
    document.getElementById('tratKpiRenegociacoes').textContent=Number(r.renegociacoes||0);

    document.getElementById('tratPaginaInfo').textContent=`PÃ¡gina ${tratPagina} de ${tratPaginas} â€¢ ${Number(data.total||0)} tratativa(s)`;
    document.getElementById('tratAnterior').disabled=tratPagina<=1;
    document.getElementById('tratProxima').disabled=tratPagina>=tratPaginas;

    const motivos=document.getElementById('tratMotivosResumo');
    const motivoRows=Array.isArray(data.motivos)?data.motivos:[];
    motivos.innerHTML=motivoRows.length?motivoRows.slice(0,8).map(m=>`<div class="motivo-card">
      <b>${esc(labelMotivoTratativa(m.motivo))}</b>
      <small>${Number(m.quantidade||0)} ocorrÃªncia(s)</small>
    </div>`).join(''):'<div class="motivo-card">Nenhum motivo encontrado.</div>';

    tbody.innerHTML=rows.length?rows.map(t=>`<tr>
      <td>${t.createdAt?new Date(t.createdAt).toLocaleString('pt-BR'):'â€”'}</td>
      <td><span class="client-name">${esc(t.clienteNome||'Cliente')}</span><span class="client-phone">${esc(t.telefone||t.clienteCpf||'')}</span><small>${esc(t.carneCodigo||'')}</small></td>
      <td><b>${esc(labelMotivoTratativa(t.motivo))}</b><br><small>${esc(t.motivoDetalhe||'')}</small></td>
      <td>${esc(labelResultadoTratativa(t.resultado))}</td>
      <td>${esc(labelProximaAcao(t.proximaAcao))}<br><small>${t.proximaAcaoEm?new Date(t.proximaAcaoEm).toLocaleString('pt-BR'):'Sem data'}</small></td>
      <td>${esc(t.responsavel||'')}</td>
      <td><span class="treat-status ${t.concluida?'closed':'open'}">${t.concluida?'ConcluÃ­da':'Em aberto'}</span></td>
      <td><div class="fila-actions">
        ${!t.concluida?`<button class="green" onclick="concluirTratativa('${esc(t.id)}')">Concluir</button>`:''}
      </div></td>
    </tr>`).join(''):'<tr><td colspan="8">Nenhuma tratativa encontrada.</td></tr>';
  }catch(e){
    tbody.innerHTML='<tr><td colspan="8">Erro: '+esc(e.message||e)+'</td></tr>';
  }
}

function mudarPaginaTratativas(delta){
  const next=tratPagina+Number(delta||0);
  if(next<1||next>tratPaginas)return;
  carregarTratativas(next);
}

function limparFiltrosTratativas(){
  ['tratBusca','tratMotivo','tratResultado','tratConcluida'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.value='';
  });
  carregarTratativas(1);
}

async function concluirTratativa(id){
  if(!confirm('Marcar esta tratativa como concluÃ­da?'))return;
  try{
    const data=await apiJson('/admin/financeiro/tratativas/'+encodeURIComponent(id),{
      method:'PATCH',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({concluida:true,resultado:'RESOLVIDO',proximaAcao:'ENCERRAR'})
    });
    toast(data.message||'Tratativa concluÃ­da.');
    await carregarTratativas(tratPagina);
  }catch(e){
    toast('Erro: '+(e.message||e));
  }
}




let riskPagina=1;
let riskPaginas=1;

async function avaliarNovaVenda(){
  const box=document.getElementById('riskAvaliacaoResultado');
  box.innerHTML='Analisando histÃ³rico financeiro...';
  try{
    const payload={
      nome:String(document.getElementById('riskNome')?.value||'').trim(),
      cpf:String(document.getElementById('riskCpf')?.value||'').trim(),
      telefone:String(document.getElementById('riskTelefone')?.value||'').trim(),
      valorVenda:parseMoneyInput(document.getElementById('riskValorVenda')?.value||'0')
    };
    const data=await apiJson('/admin/financeiro/risco/avaliar-venda',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    });
    const r=data.risco||{};
    const motivos=Array.isArray(data.motivos)?data.motivos:[];
    box.innerHTML=`<div class="row"><span>Resultado</span><span><span class="decision-badge ${esc(data.resultado||'REVISAR')}">${esc(data.resultado||'REVISAR')}</span></span></div>
      <div class="row"><span>Cliente</span><span>${esc(data.cliente?.nome||'')}</span></div>
      <div class="row"><span>Score de risco</span><span><b>${Number(r.scoreRisco||0)}/100</b></span></div>
      <div class="row"><span>NÃ­vel</span><span><span class="risk-badge ${esc(r.nivelRisco||'BAIXO')}">${esc(r.nivelRisco||'BAIXO')}</span></span></div>
      <div class="row"><span>Limite sugerido disponÃ­vel</span><span>${money(r.limiteSugerido||0)}</span></div>
      <div class="row"><span>Valor da nova venda</span><span>${money(data.valorVenda||0)}</span></div>
      <div class="row"><span>Bloqueio automÃ¡tico</span><span>${data.enforcementEnabled?'ATIVO':'DESATIVADO'}</span></div>
      <div class="notice" style="margin-top:10px">${esc(data.message||'')}</div>
      <div style="margin-top:12px">${motivos.slice(0,12).map(f=>`<div class="risk-factor"><b>${esc(f.label||f.code||'Fator')}</b><small>${Number(f.points||0)>=0?'+':''}${Number(f.points||0)} ponto(s)</small></div>`).join('')}</div>`;
    await carregarRiscosClientes(1);
  }catch(e){
    box.innerHTML='<span class="audit-error">Erro: '+esc(e.message||e)+'</span>';
  }
}

async function recalcularRiscosTodos(){
  const box=document.getElementById('riskAvaliacaoResultado');
  box.innerHTML='Recalculando a carteira. Aguarde...';
  try{
    const data=await apiJson('/admin/financeiro/risco/recalcular-todos',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({limit:3000})
    });
    box.innerHTML=`<span class="audit-ok">Carteira recalculada.</span>
      <div class="row"><span>Clientes analisados</span><span>${Number(data.clientesAnalisados||0)}</span></div>
      <div class="row"><span>Atualizados</span><span>${Number(data.atualizados||0)}</span></div>
      <div class="row"><span>Erros</span><span>${Number(data.erros||0)}</span></div>`;
    toast('ClassificaÃ§Ã£o de risco atualizada.');
    await carregarRiscosClientes(1);
  }catch(e){
    box.innerHTML='<span class="audit-error">Erro: '+esc(e.message||e)+'</span>';
  }
}

async function carregarRiscosClientes(page=1){
  riskPagina=Math.max(1,Number(page||1));
  const tbody=document.getElementById('riskBody');
  if(!tbody)return;
  tbody.innerHTML='<tr><td colspan="9">Carregando riscos...</td></tr>';

  const params=new URLSearchParams({
    q:String(document.getElementById('riskBusca')?.value||'').trim(),
    nivel:String(document.getElementById('riskNivel')?.value||''),
    decisao:String(document.getElementById('riskDecisao')?.value||''),
    statusManual:String(document.getElementById('riskManual')?.value||''),
    page:String(riskPagina),
    limit:'50'
  });

  try{
    const data=await apiJson('/admin/financeiro/risco/clientes?'+params.toString());
    const rows=Array.isArray(data.clientes)?data.clientes:[];
    riskPaginas=Math.max(1,Number(data.pages||1));
    const r=data.resumo||{};

    document.getElementById('riskKpiTotal').textContent=Number(r.total||0);
    document.getElementById('riskKpiExposicao').textContent=money(r.exposicaoAtual||0);
    document.getElementById('riskKpiVencido').textContent=money(r.valorVencido||0);
    document.getElementById('riskKpiMedios').textContent=Number(r.medios||0);
    document.getElementById('riskKpiAltos').textContent=Number(r.altos||0);
    document.getElementById('riskKpiCriticos').textContent=Number(r.criticos||0);

    document.getElementById('riskEnforcementStatus').innerHTML=data.enforcementEnabled
      ? '<b>Bloqueio automÃ¡tico ativo.</b> Clientes bloqueados pela polÃ­tica podem impedir o fluxo da venda.'
      : '<b>Modo consultivo ativo.</b> O painel alerta, mas ainda nÃ£o bloqueia automaticamente o fluxo da venda.';

    document.getElementById('riskPaginaInfo').textContent=`PÃ¡gina ${riskPagina} de ${riskPaginas} â€¢ ${Number(data.total||0)} cliente(s)`;
    document.getElementById('riskAnterior').disabled=riskPagina<=1;
    document.getElementById('riskProxima').disabled=riskPagina>=riskPaginas;

    tbody.innerHTML=rows.length?rows.map(c=>`<tr>
      <td><span class="client-name">${esc(c.clienteNome||'Cliente')}</span><span class="client-phone">${esc(c.telefone||c.clienteCpf||'')}</span></td>
      <td><b>${Number(c.scoreRisco||0)}</b>/100</td>
      <td><span class="risk-badge ${esc(c.nivelRisco)}">${esc(c.nivelRisco)}</span></td>
      <td class="money-cell">${money(c.exposicaoAtual||0)}</td>
      <td class="money-cell">${money(c.valorVencido||0)}</td>
      <td>${Number(c.maxDiasAtraso||0)} dia(s)<br><small>${Number(c.parcelasAtrasadas||0)} parcela(s)</small></td>
      <td><span class="decision-badge ${esc(c.decisaoEfetiva||c.decisaoAutomatica)}">${esc(c.decisaoEfetiva||c.decisaoAutomatica)}</span><br><small>Limite ${money(c.limiteSugerido||0)}</small></td>
      <td>${esc(c.statusManual||'AUTOMATICO')}</td>
      <td><div class="fila-actions">
        <button class="green" onclick="alterarDecisaoRisco('${esc(c.id)}','ATIVO')">Liberar</button>
        <button class="yellow" onclick="alterarDecisaoRisco('${esc(c.id)}','EM_REVISAO')">Revisar</button>
        <button class="red" onclick="alterarDecisaoRisco('${esc(c.id)}','BLOQUEADO')">Bloquear</button>
        <button class="light" onclick="alterarDecisaoRisco('${esc(c.id)}','AUTOMATICO')">AutomÃ¡tico</button>
      </div></td>
    </tr>`).join(''):'<tr><td colspan="9">Nenhum cliente classificado. Clique em â€œRecalcular carteiraâ€.</td></tr>';
  }catch(e){
    tbody.innerHTML='<tr><td colspan="9">Erro: '+esc(e.message||e)+'</td></tr>';
  }
}

async function alterarDecisaoRisco(id,statusManual){
  const obs=prompt(`ObservaÃ§Ã£o para a decisÃ£o ${statusManual}:`)||'';
  try{
    const data=await apiJson('/admin/financeiro/risco/clientes/'+encodeURIComponent(id)+'/decisao',{
      method:'PATCH',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({statusManual,observacao:obs})
    });
    toast(data.message||'DecisÃ£o atualizada.');
    await carregarRiscosClientes(riskPagina);
  }catch(e){
    toast('Erro: '+(e.message||e));
  }
}

function mudarPaginaRisco(delta){
  const next=riskPagina+Number(delta||0);
  if(next<1||next>riskPaginas)return;
  carregarRiscosClientes(next);
}

function limparFiltrosRisco(){
  ['riskBusca','riskNivel','riskDecisao','riskManual'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.value='';
  });
  carregarRiscosClientes(1);
}



window.addEventListener('unhandledrejection',event=>{
  console.error('[financeiro] Promise rejeitada:',event.reason);
  const msg=event.reason?.message||String(event.reason||'Erro inesperado');
  if(!/sessÃ£o|token|login/i.test(msg))toast('Erro inesperado: '+msg);
});
window.addEventListener('error',event=>{
  console.error('[financeiro] Erro global:',event.error||event.message);
});

async function carregarMonitorWhatsapp(){
  const minutos=document.getElementById('mwMinutos')?.value||15;
  const limit=document.getElementById('mwLimit')?.value||50;
  try{
    const j=await apiJson(`/admin/financeiro/regua-whatsapp/monitor?minutosPendente=${encodeURIComponent(minutos)}&limit=${encodeURIComponent(limit)}`);
    const m=j.monitor||{};
    const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=String(v||0)};
    set('mwPendentes',m.pendentes);
    set('mwAtrasados',m.pendentesAtrasados);
    set('mwEnviados',m.enviados);
    set('mwEntregues',m.entregues);
    set('mwLidos',m.lidos);
    set('mwFalhas',m.falhas);

    const body=document.getElementById('mwBody');
    if(!body)return;
    body.innerHTML=(m.recentes||[]).map(row=>{
      const status=String(row.deliveryStatus||'PENDING');
      const cls=status==='READ'||status==='DELIVERED'?'ok':status==='FAILED'?'danger':'pending';
      const podeReenviar=!['READ','DELIVERED'].includes(status);
      return `<tr>
        <td>${esc(row.createdAt?new Date(row.createdAt).toLocaleString('pt-BR'):'â€”')}</td>
        <td><b>${esc(row.clienteNome||'Cliente')}</b><br><small>${esc(row.carneCodigo||row.documento||'')}</small></td>
        <td>${esc(row.tipoEvento||'')}</td>
        <td>${esc(row.telefone||'')}</td>
        <td><span class="pill ${cls}">${esc(status)}</span>${row.erro?`<br><small>${esc(row.erro)}</small>`:''}</td>
        <td>${Number(row.retryCount||0)}</td>
        <td>${podeReenviar?`<button class="yellow small" onclick="reenviarMonitorWhatsapp('${row._id}')">Reenviar</button>`:'â€”'}</td>
      </tr>`;
    }).join('')||'<tr><td colspan="7">Nenhuma mensagem registrada.</td></tr>';
  }catch(e){
    const body=document.getElementById('mwBody');
    if(body)body.innerHTML=`<tr><td colspan="7">Erro: ${esc(e.message||e)}</td></tr>`;
  }
}




async function carregarChecklistRelease(auditar=false){
  const body=document.getElementById('releaseBody');
  const resumo=document.getElementById('releaseResumo');
  if(body)body.innerHTML='<tr><td colspan="4">Executando validaÃ§Ãµes...</td></tr>';
  try{
    const endpoint=auditar?'/admin/financeiro/release/validar':'/admin/financeiro/release/status';
    const j=await apiJson(endpoint,auditar?{method:'POST',body:'{}'}:{});
    const s=j.resumo||{};
    const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=String(v||0)};
    set('releaseTotal',s.total);
    set('releaseOk',s.ok);
    set('releaseBloqueios',s.bloqueios);
    set('releaseAvisos',s.avisos);

    if(resumo){
      resumo.innerHTML=j.prontoParaProducao
        ? '<b>âœ… Pronto para produÃ§Ã£o.</b> Todas as verificaÃ§Ãµes e liberaÃ§Ãµes foram aprovadas.'
        : j.homologacaoLocalOk
          ? '<b>ðŸŸ¡ HomologaÃ§Ã£o local aprovada.</b> O deploy continua bloqueado pela flag de seguranÃ§a.'
          : '<b>â›” Existem bloqueios.</b> Corrija os itens abaixo antes de pensar em publicar.';
    }

    if(body){
      body.innerHTML=(j.items||[]).map(item=>{
        const cls=item.ok?'ok':item.bloqueante?'danger':'pending';
        return `<tr>
          <td><b>${esc(item.titulo||item.id)}</b></td>
          <td><span class="pill ${cls}">${esc(item.status||'')}</span></td>
          <td>${esc(item.detalhe||'â€”')}</td>
          <td>${esc(item.acao||'â€”')}</td>
        </tr>`;
      }).join('')||'<tr><td colspan="4">Checklist sem itens.</td></tr>';
    }
  }catch(e){
    if(resumo)resumo.textContent=`Erro: ${e.message||e}`;
    if(body)body.innerHTML=`<tr><td colspan="4">Erro: ${esc(e.message||e)}</td></tr>`;
  }
}

async function consultarWebhookEvolution(){
  const box=document.getElementById('mwWebhookStatus');
  try{
    const j=await apiJson('/admin/financeiro/regua-whatsapp/webhook/configuracao');
    const p=j.provider?.data||{};
    const expected=j.expected||{};
    if(box){
      box.innerHTML=`<b>${j.compatible?'âœ… Webhook compatÃ­vel':'âš ï¸ Webhook precisa de ajuste'}</b><br>
        InstÃ¢ncia: ${esc(j.provider?.instanceName||'â€”')}<br>
        URL configurada: ${esc(p.url||'â€”')}<br>
        URL esperada: ${esc(expected.url||'â€”')}<br>
        Eventos: ${esc((p.events||[]).join(', ')||'â€”')}`;
    }
    return j;
  }catch(e){
    if(box)box.textContent=`Erro ao consultar webhook: ${e.message||e}`;
    throw e;
  }
}

async function configurarWebhookEvolution(){
  if(!confirm('Configurar na Evolution API o webhook de entrega do financeiro?'))return;
  try{
    const j=await apiJson('/admin/financeiro/regua-whatsapp/webhook/configurar',{
      method:'POST',
      body:JSON.stringify({enabled:true,dryRun:false})
    });
    toast('Webhook configurado na Evolution API.');
    await consultarWebhookEvolution();
  }catch(e){
    toast(e.message||'Erro ao configurar o webhook.');
  }
}

async function migrarLogsWhatsappAntigos(){
  if(!confirm('Migrar os registros antigos do WhatsApp para o novo monitor?'))return;
  try{
    const j=await apiJson('/admin/financeiro/regua-whatsapp/migrar-logs-antigos',{
      method:'POST',
      body:JSON.stringify({limite:1000,somentePendentes:false})
    });
    toast(`MigraÃ§Ã£o concluÃ­da: ${j.migrados||0} migrado(s), ${j.ignorados||0} ignorado(s), ${j.erros||0} erro(s).`);
    await carregarMonitorWhatsapp();
  }catch(e){
    toast(e.message||'Erro ao migrar histÃ³rico do WhatsApp.');
  }
}

async function reenviarMonitorWhatsapp(id){
  if(!confirm('Reenviar esta mensagem? O sistema bloquearÃ¡ mensagens jÃ¡ entregues ou lidas.'))return;
  try{
    const j=await apiJson(`/admin/financeiro/regua-whatsapp/${encodeURIComponent(id)}/reenviar`,{
      method:'POST',
      body:JSON.stringify({ignorarHorario:false})
    });
    toast(j.message||'Mensagem reenviada.');
    await carregarMonitorWhatsapp();
  }catch(e){toast(e.message||'Erro ao reenviar mensagem.')}
}



(() => {
  let deferredInstallPrompt = null;
  const installButton = document.getElementById('installAppBtn');

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    if (installButton) installButton.style.display = 'inline-flex';
  });

  if (installButton) {
    installButton.addEventListener('click', async () => {
      if (!deferredInstallPrompt) {
        alert('Use o menu do navegador e escolha "Instalar Financeiro Ariana MÃ³veis".');
        return;
      }
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      installButton.style.display = 'none';
    });
  }

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    if (installButton) installButton.style.display = 'none';
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./service-worker.js', { scope: './' })
        .catch((error) => console.error('Falha ao registrar o aplicativo:', error));
    });
  }
})();

