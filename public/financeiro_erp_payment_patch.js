(() => {
  'use strict';

  const originalOpen = window.abrirPagamentoSige;
  if (typeof originalOpen !== 'function') return;

  window.abrirPagamentoSige = function abrirPagamentoErpComSaldoOficial(item) {
    originalOpen(item);

    const source = String(item?.fonte || item?.source || '').toLowerCase();
    const isErp = source === 'ariana_erp' || Boolean(item?.orderId || item?.erp?.orderId);
    if (!isErp || !sigePagamentoAlvo) return;

    const principal = Math.max(0, Number(sigePagamentoAlvo.saldo || 0));
    const valueField = document.getElementById('sigePayValor');
    const balanceField = document.getElementById('sigePaySaldo');
    const summary = document.getElementById('sigePagamentoResumo');
    const alert = document.querySelector('#sigePagamentoOverlay .sige-pay-alert');

    if (valueField) valueField.value = moneyInput(principal);
    if (balanceField) balanceField.value = money(principal);
    if (summary) {
      summary.innerHTML = `<b>${esc(sigePagamentoAlvo.cliente || 'Cliente')}</b><br>${esc(sigePagamentoAlvo.documento || sigePagamentoAlvo.parcela || 'Parcela')} • Vencimento ${formatDateBR(sigePagamentoAlvo.vencimento)}<br>Saldo principal no Ariana ERP: <b>${money(principal)}</b>`;
    }
    if (alert) {
      alert.textContent = 'Esta baixa usa o saldo principal oficial salvo no Ariana ERP. Multa, juros e desconto só devem ser registrados quando forem informados de forma separada e auditável.';
    }
  };
})();
