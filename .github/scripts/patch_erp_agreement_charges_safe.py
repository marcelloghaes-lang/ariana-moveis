from pathlib import Path

path = Path('public/erp_financeiro_completo.html')
text = path.read_text(encoding='utf-8')

old_modal = '<div class="field"><label>Saldo original em aberto</label><input id="ag-source" disabled></div><div class="field"><label>Valor negociado</label><input id="ag-total" type="number" min="0.01" step="0.01"></div>'
new_modal = '<div class="field"><label>Principal em aberto</label><input id="ag-source" disabled></div><div class="field"><label>Multa calculada</label><input id="ag-fine" disabled></div><div class="field"><label>Juros calculados</label><input id="ag-interest" disabled></div><div class="field"><label>Total atualizado</label><input id="ag-updated" disabled></div><div class="field"><label>Valor negociado</label><input id="ag-total" type="number" min="0.01" step="0.01"></div>'
if text.count(old_modal) != 1:
    raise SystemExit(f'modal anchor count={text.count(old_modal)}')
text = text.replace(old_modal, new_modal, 1)

old_notes = '<div class="field span4"><label>Observação</label><textarea id="ag-notes" placeholder="Opcional"></textarea></div>'
new_notes = '<div class="field span4"><label style="display:flex;align-items:center;gap:8px;text-transform:none;font-size:13px"><input id="ag-apply-charges" type="checkbox" checked style="width:auto"> Aplicar multa de 2% e juros de 1% ao mês no acordo</label></div><div class="field span4"><div class="notice" id="ag-charge-summary">Os encargos vencidos serão incluídos no acordo.</div></div>'+old_notes
if text.count(old_notes) != 1:
    raise SystemExit(f'notes anchor count={text.count(old_notes)}')
text = text.replace(old_notes, new_notes, 1)

old_open = "agreementTarget={purchase,rows};try{const d=await api('/erp/financeiro/acordos/preview',{method:'POST',body:JSON.stringify({entryIds:rows.map(r=>r.entryId)})}),x=d.preview||{};$('agreement-info').textContent=(purchase.rows[0]?.customerName||'Cliente')+' • '+purchase.ref;$('ag-source').value=money(x.sourceBalance);$('ag-total').value=Number(x.sourceBalance||0).toFixed(2);"
new_open = "agreementTarget={purchase,rows,preview:null};try{const d=await api('/erp/financeiro/acordos/preview',{method:'POST',body:JSON.stringify({entryIds:rows.map(r=>r.entryId)})}),x=d.preview||{};agreementTarget.preview=x;$('agreement-info').textContent=(purchase.rows[0]?.customerName||'Cliente')+' • '+purchase.ref;applyAgreementChargeChoice(true);"
if text.count(old_open) != 1:
    raise SystemExit(f'openAgreement anchor count={text.count(old_open)}')
text = text.replace(old_open, new_open, 1)

anchor = 'function updateAgreementPreview(){if(!agreementTarget)return;'
helper = "function applyAgreementChargeChoice(forceChecked=false){if(!agreementTarget)return;const x=agreementTarget.preview||{},principal=Number(x.sourcePrincipalBalance??x.sourceBalanceBeforeCharges??x.sourceBalance??0),fine=Number(x.sourceFineTotal||0),interest=Number(x.sourceInterestTotal||0),updated=Number(x.sourceUpdatedTotal??x.sourceBalance??(principal+fine+interest));if(forceChecked)$('ag-apply-charges').checked=true;const apply=$('ag-apply-charges').checked!==false,total=apply?updated:principal;$('ag-source').value=money(principal);$('ag-fine').value=money(fine);$('ag-interest').value=money(interest);$('ag-updated').value=money(updated);$('ag-total').value=Number(total||0).toFixed(2);$('ag-charge-summary').innerHTML=apply?'<b>Encargos aplicados.</b> Principal '+money(principal)+' + multa '+money(fine)+' + juros '+money(interest)+' = <b>'+money(updated)+'</b>.':'<b>Encargos dispensados.</b> O acordo será feito pelo principal de <b>'+money(principal)+'</b>, sem multa e juros.';updateAgreementPreview()}\n"
if text.count(anchor) != 1:
    raise SystemExit(f'preview anchor count={text.count(anchor)}')
text = text.replace(anchor, helper + anchor, 1)

old_preview = "$('agreement-preview').innerHTML='<b>Prévia:</b> valor do acordo '+money(total)+' • entrada '+money(down)+' • saldo parcelado '+money(financed)+' • '+n+' parcela(s) de aproximadamente '+money(financed/n)+'. A dívida original ficará marcada como renegociada e não será somada novamente.'"
new_preview = "$('agreement-preview').innerHTML='<b>Prévia:</b> '+($('ag-apply-charges')?.checked!==false?'com multa e juros':'sem multa e juros')+' • valor do acordo '+money(total)+' • entrada '+money(down)+' • saldo parcelado '+money(financed)+' • '+n+' parcela(s) de aproximadamente '+money(financed/n)+'. A dívida original ficará marcada como renegociada e não será somada novamente.'"
if text.count(old_preview) != 1:
    raise SystemExit(f'preview body count={text.count(old_preview)}')
text = text.replace(old_preview, new_preview, 1)

old_body = "notes:$('ag-notes').value.trim()}"
new_body = "notes:$('ag-notes').value.trim(),waiveCharges:$('ag-apply-charges')?.checked===false,chargePolicy:'2pct_fine_1pct_monthly_prorata'}"
if text.count(old_body) != 1:
    raise SystemExit(f'save body count={text.count(old_body)}')
text = text.replace(old_body, new_body, 1)

old_events = "$('save-agreement').onclick=saveAgreement;['ag-total','ag-down','ag-installments'].forEach(id=>$(id).oninput=updateAgreementPreview);"
new_events = old_events + "$('ag-apply-charges').onchange=()=>applyAgreementChargeChoice(false);"
if text.count(old_events) != 1:
    raise SystemExit(f'event anchor count={text.count(old_events)}')
text = text.replace(old_events, new_events, 1)

for marker in ['id="ag-fine"','id="ag-interest"','id="ag-updated"','id="ag-apply-charges"','applyAgreementChargeChoice','sourceFineTotal','sourceInterestTotal','waiveCharges']:
    if marker not in text:
        raise SystemExit(f'missing marker: {marker}')

path.write_text(text, encoding='utf-8')
print('safe agreement UI patch applied')
