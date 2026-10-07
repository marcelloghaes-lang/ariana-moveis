from pathlib import Path
import re

path = Path('public/erp_financeiro_completo.html')
text = path.read_text(encoding='utf-8')

modal = '''<div class="modalback" id="agreement-modal"><div class="modal"><div class="modalhead"><div><h3>Formalizar acordo</h3><div class="sub" id="agreement-info">Renegocie o saldo desta compra sem duplicar a dívida.</div></div><button class="x" data-close="agreement-modal">×</button></div><div class="notice"><b>Proteção financeira:</b> ao confirmar, as parcelas originais ficam preservadas como renegociadas e saem do saldo operacional. Somente as novas parcelas do acordo passam a compor o contas a receber.</div><div class="fields" style="margin-top:12px"><div class="field"><label>Principal em aberto</label><input id="ag-source" disabled></div><div class="field"><label>Multa calculada</label><input id="ag-fine" disabled></div><div class="field"><label>Juros calculados</label><input id="ag-interest" disabled></div><div class="field"><label>Total atualizado</label><input id="ag-updated" disabled></div><div class="field"><label>Valor negociado</label><input id="ag-total" type="number" min="0.01" step="0.01"></div><div class="field"><label>Entrada</label><input id="ag-down" type="number" min="0" step="0.01" value="0"></div><div class="field"><label>Parcelas após entrada</label><input id="ag-installments" type="number" min="1" max="120" value="1"></div><div class="field"><label>1º vencimento</label><input id="ag-first-due" type="date"></div><div class="field"><label>Forma</label><select id="ag-method"><option value="crediario">Crediário</option><option value="pix">PIX</option><option value="boleto">Boleto</option><option value="dinheiro">Dinheiro</option><option value="transferencia">Transferência</option></select></div><div class="field span4"><label style="display:flex;align-items:center;gap:8px;text-transform:none;font-size:13px"><input id="ag-apply-charges" type="checkbox" checked style="width:auto"> Aplicar multa de 2% e juros de 1% ao mês no acordo</label></div><div class="field span4"><div class="notice" id="ag-charge-summary">Os encargos vencidos serão incluídos no valor negociado.</div></div><div class="field span4"><label>Observação</label><textarea id="ag-notes" placeholder="Opcional"></textarea></div></div><div class="notice" id="agreement-preview" style="margin-top:12px"></div><div class="modalfoot"><button class="btn" data-close="agreement-modal">Cancelar</button><button class="btn green" id="save-agreement">Confirmar acordo</button></div></div></div>'''

text, n_modal = re.subn(
    r'<div class="modalback" id="agreement-modal">.*?</div>\n(?=<div class="modalback" id="receive-modal">)',
    modal + '\n', text, count=1, flags=re.S)
if n_modal != 1:
    raise SystemExit(f'agreement modal patch count={n_modal}')

logic = r'''let agreementTarget=null;
function agreementChargeValues(){
  const x=agreementTarget?.preview||{};
  const principal=Number(x.sourcePrincipalBalance??x.sourceBalanceBeforeCharges??x.sourceBalance??0);
  const fine=Number(x.sourceFineTotal||0),interest=Number(x.sourceInterestTotal||0);
  const updated=Number(x.sourceUpdatedTotal??(principal+fine+interest));
  return{principal,fine,interest,updated};
}
function refreshAgreementCharges(){
  if(!agreementTarget)return;
  const {principal,fine,interest,updated}=agreementChargeValues(),apply=$('ag-apply-charges')?.checked!==false,total=apply?updated:principal;
  $('ag-source').value=money(principal);$('ag-fine').value=money(fine);$('ag-interest').value=money(interest);$('ag-updated').value=money(updated);$('ag-total').value=Number(total||0).toFixed(2);
  $('ag-charge-summary').innerHTML=apply
    ? `<b>Encargos aplicados.</b> Principal ${money(principal)} + multa ${money(fine)} + juros ${money(interest)} = <b>${money(updated)}</b>.`
    : `<b>Encargos dispensados.</b> O acordo será feito pelo principal em aberto de <b>${money(principal)}</b>, sem multa e juros.`;
  updateAgreementPreview();
}
async function openAgreement(purchaseKey){const purchase=collectionGroups().flatMap(c=>c.purchases).find(p=>p.key===purchaseKey);if(!purchase)return toast('Compra não encontrada.');const rows=purchase.rows.filter(r=>r.sourceType==='ledger'&&['pendente','parcial'].includes(r.status)&&r.entryId);if(!rows.length)return toast('Esta compra não possui saldo elegível para acordo.');try{const d=await api('/erp/financeiro/acordos/preview',{method:'POST',body:JSON.stringify({entryIds:rows.map(r=>r.entryId)})}),x=d.preview||{};agreementTarget={purchase,rows,preview:x};$('agreement-info').textContent=(purchase.rows[0]?.customerName||'Cliente')+' • '+purchase.ref;$('ag-apply-charges').checked=true;$('ag-down').value='0.00';$('ag-installments').value='1';{const d=new Date();d.setDate(d.getDate()+1);$('ag-first-due').value=d.toISOString().slice(0,10);}$('ag-method').value='crediario';$('ag-notes').value='';refreshAgreementCharges();openModal('agreement-modal')}catch(e){toast(e.message)}}
function updateAgreementPreview(){if(!agreementTarget)return;const total=Number($('ag-total').value||0),down=Number($('ag-down').value||0),n=Math.max(1,Number($('ag-installments').value||1)),financed=Math.max(0,total-down),apply=$('ag-apply-charges')?.checked!==false;$('agreement-preview').innerHTML='<b>Prévia:</b> '+(apply?'com multa e juros':'sem multa e juros')+' • valor do acordo '+money(total)+' • entrada '+money(down)+' • saldo parcelado '+money(financed)+' • '+n+' parcela(s) de aproximadamente '+money(financed/n)+'. A dívida original ficará marcada como renegociada e não será somada novamente.'}
async function saveAgreement(){if(!agreementTarget)return;const applyCharges=$('ag-apply-charges')?.checked!==false,body={entryIds:agreementTarget.rows.map(r=>r.entryId),negotiatedTotal:Number($('ag-total').value||0),downPayment:Number($('ag-down').value||0),installments:Number($('ag-installments').value||0),firstDueAt:$('ag-first-due').value,paymentMethod:$('ag-method').value,notes:$('ag-notes').value.trim(),waiveCharges:!applyCharges,chargePolicy:'2pct_fine_1pct_monthly_prorata'};if(!body.negotiatedTotal||!body.installments||!body.firstDueAt)return toast('Preencha valor, parcelas e primeiro vencimento.');const chargeText=applyCharges?'COM multa e juros calculados':'SEM multa e juros (encargos dispensados)';if(!confirm('Confirmar este acordo '+chargeText+'?\n\nA dívida original será preservada como renegociada e somente as novas parcelas entrarão no saldo operacional.'))return;const btn=$('save-agreement');try{btn.disabled=true;const d=await api('/erp/financeiro/acordos',{method:'POST',body:JSON.stringify(body)});closeModal('agreement-modal');agreementTarget=null;toast('Acordo '+(d.agreement?.number||'')+' criado sem duplicação de saldo.');await Promise.all([loadCollections(),loadMetrics()])}catch(e){alert('O acordo não foi criado. Nenhuma alteração parcial deve ser mantida.\n\n'+e.message);toast(e.message)}finally{btn.disabled=false}}
'''

text, n_logic = re.subn(
    r'let agreementTarget=null;.*?(?=let exportLibPromise=null;)',
    logic, text, count=1, flags=re.S)
if n_logic != 1:
    raise SystemExit(f'agreement logic patch count={n_logic}')

old_events = "$('save-agreement').onclick=saveAgreement;['ag-total','ag-down','ag-installments'].forEach(id=>$(id).oninput=updateAgreementPreview);"
new_events = "$('save-agreement').onclick=saveAgreement;['ag-total','ag-down','ag-installments'].forEach(id=>$(id).oninput=updateAgreementPreview);$('ag-apply-charges').onchange=refreshAgreementCharges;"
if old_events not in text:
    raise SystemExit('agreement event binding not found')
text = text.replace(old_events, new_events, 1)

for marker in [
    'ag-apply-charges', 'ag-charge-summary', 'sourceFineTotal',
    'sourceInterestTotal', 'refreshAgreementCharges', 'waiveCharges:!applyCharges'
]:
    if marker not in text:
        raise SystemExit(f'missing marker after patch: {marker}')

path.write_text(text, encoding='utf-8')
print('ERP agreement charges UI patch applied successfully')
