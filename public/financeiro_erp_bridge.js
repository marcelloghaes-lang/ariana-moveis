(() => {
  'use strict';

  const ERP_SOURCE = 'ariana_erp';
  const route = (path) => path;
  const byId = (id) => document.getElementById(id);
  const isErpRow = (row = {}) =>
    String(row.fonte || row.source || '').toLowerCase() === ERP_SOURCE ||
    Boolean(row.orderId || row.erp?.orderId);
  const erpOrderId = (row = {}) => String(row.orderId || row.erp?.orderId || '').trim();
  const erpNumber = (row = {}) => Number(row.receivableNumber || row.erp?.number || row.number || 0);

  function setText(id, text) {
    const el = byId(id);
    if (el) el.textContent = text;
  }

  function replaceText(root, from, to) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      if (node.nodeValue?.includes(from)) node.nodeValue = node.nodeValue.split(from).join(to);
    });
  }

  async function erpClientes(q = '', limit = 100) {
    const params = new URLSearchParams({ q: String(q || '').trim(), limit: String(limit) });
    const data = await apiJson(route('/erp/finance-panel/clientes?' + params.toString()));
    return Array.isArray(data.clientes) ? data.clientes : [];
  }

  window.buscarClientesFinanceiro = erpClientes;

  window.testarSigeStatus = async function testarErpStatus() {
    const box = byId('sigeStatusBox');
    if (box) box.innerHTML = 'Verificando Ariana ERP...';
    try {
      const [dashboard, clientes] = await Promise.all([
        apiJson('/erp/finance-panel/dashboard'),
        apiJson('/erp/finance-panel/clientes?limit=1')
      ]);
      if (box) {
        box.innerHTML = `<b>✅ Ariana ERP conectado</b><br>Fonte operacional do Financeiro: <b>Ariana ERP</b><br>Parcelas abertas: ${Number(dashboard.kpis?.openInstallments || 0)}<br>Carteira em aberto: ${money((Number(dashboard.kpis?.openPortfolioCents || 0)) / 100)}<br><small>O histórico importado do SIGE continua preservado, mas não é a fonte das operações atuais.</small>`;
      }
      const health = byId('healthSige');
      if (health) {
        health.classList.remove('error');
        health.classList.add('ok');
        const div = health.querySelector('div');
        if (div) div.innerHTML = `Ariana ERP<small>Conectado • ${Number(clientes.total || clientes.clientes?.length || 0)} cliente(s) na amostra</small>`;
      }
    } catch (error) {
      if (box) box.innerHTML = `<b>❌ Ariana ERP indisponível</b><br>${esc(error.message || error)}`;
    }
  };

  window.buscarSigeClientes = async function buscarErpClientes() {
    const input = byId('sigeBuscaCliente');
    const body = byId('sigeClientesBody');
    const q = String(input?.value || '').trim();
    if (q.length < 2) { toast('Digite pelo menos 2 letras para buscar no Ariana ERP.'); return; }
    if (body) body.innerHTML = '<tr><td colspan="4">Consultando Ariana ERP...</td></tr>';
    try {
      const rows = await erpClientes(q, 30);
      window.sigeClientesCache = rows;
      if (body) {
        body.innerHTML = rows.map((c, i) => `<tr><td><b>${esc(c.nome)}</b><br><small>${esc(c.endereco || '')}</small></td><td>CPF: ${esc(c.cpf) || '—'}<br><small>WhatsApp: ${esc(shortPhone(c.telefone)) || '—'}</small></td><td>✅ Ariana ERP<br><small>${esc(c.cidade || '')} ${esc(c.uf || '')}</small></td><td><button type="button" class="light small" onclick="usarClienteSige(${i})">Usar no recibo</button> <button type="button" class="yellow small" onclick="cobrarClienteSige(${i})">🔔 Cobrar</button></td></tr>`).join('') || '<tr><td colspan="4">Nenhum cliente encontrado no Ariana ERP.</td></tr>';
      }
    } catch (error) {
      if (body) body.innerHTML = '<tr><td colspan="4">Erro ao consultar Ariana ERP: ' + esc(error.message || error) + '</td></tr>';
    }
  };

  window.buscarSigeLancamentos = async function buscarErpLancamentos() {
    const body = byId('sigeLancBody');
    const q = encodeURIComponent(byId('sigeLancBusca')?.value || '');
    const status = encodeURIComponent(byId('sigeLancStatus')?.value || 'atrasado');
    if (body) body.innerHTML = '<tr><td colspan="6">Consultando lançamentos no Ariana ERP...</td></tr>';
    try {
      const data = await apiJson(`/erp/finance-panel/lancamentos?q=${q}&status=${status}&limit=1000`);
      renderSigeLancamentos(data.lancamentos || []);
    } catch (error) {
      if (body) body.innerHTML = '<tr><td colspan="6">Erro ao consultar Ariana ERP: ' + esc(error.message || error) + '</td></tr>';
    }
  };

  window.buscarSigeInadimplentes = async function buscarErpInadimplentes() {
    const body = byId('sigeLancBody');
    const q = encodeURIComponent(byId('sigeLancBusca')?.value || '');
    if (body) body.innerHTML = '<tr><td colspan="6">Consultando inadimplência no Ariana ERP...</td></tr>';
    try {
      const data = await apiJson(`/erp/finance-panel/inadimplentes?q=${q}&limit=1000`);
      renderSigeLancamentos(data.inadimplentes || []);
    } catch (error) {
      if (body) body.innerHTML = '<tr><td colspan="6">Erro ao consultar Ariana ERP: ' + esc(error.message || error) + '</td></tr>';
    }
  };

  window.renderSigeLancamentos = function renderErpLancamentos(rows) {
    rows = Array.isArray(rows) ? rows : [];
    window.sigeLancamentosCache = rows;
    const body = byId('sigeLancBody');
    if (!body) return;
    const resumo = rows.length
      ? `<tr><td colspan="6"><b>${rows.length}</b> lançamento(s) encontrado(s) no Ariana ERP.</td></tr>`
      : '';
    body.innerHTML = resumo + rows.map((l, i) => {
      const status = l.quitado ? '✅ Quitado' : (l.atrasado ? '⚠️ Atrasado' : (l.status === 'parcial' ? '🟠 Parcial' : '🟡 Em aberto'));
      const doc = l.documento || l.codigoVenda || '—';
      const valor = Number(l.saldo || 0) > 0 ? l.saldo : l.valor;
      const canPay = !l.quitado && erpOrderId(l) && erpNumber(l) > 0 && Number(l.saldo || l.valor || 0) > 0;
      const orderId = erpOrderId(l);
      return `<tr><td><b>${esc(l.cliente || l.nome)}</b><br><small>${esc(l.telefone ? shortPhone(l.telefone) : '')}</small></td><td>${esc(doc)}<br><small>${esc(l.descricao || '')}</small></td><td>${formatDateBR(l.dataVencimento)}</td><td><b>${money(valor)}</b><br><small>Recebido: ${money(l.totalRecebido || 0)}</small></td><td>${status}</td><td>${canPay ? `<button type="button" class="green small pay-btn" onclick="abrirPagamentoLancamentoSige(${i})">💰 Receber</button> ` : ''}${orderId ? `<button type="button" class="blue small" onclick="window.open('/erp_venda_detalhe.html?id=${encodeURIComponent(orderId)}&tab=pagamentos','_blank')">🧾 Ver venda</button> ` : ''}<button type="button" class="yellow small" onclick="cobrarLancamentoSige(${i})">🔔 Cobrar</button></td></tr>`;
    }).join('') || (resumo || '<tr><td colspan="6">Nenhum lançamento encontrado.</td></tr>');
  };

  window.normalizarAlvoPagamentoSige = function normalizarAlvoPagamentoFinanceiro(item = {}) {
    const saldo = Number(item.saldoParcela ?? item.saldo ?? item.remaining ?? 0);
    const original = Number(item.valorParcela ?? item.valor ?? item.value ?? saldo ?? 0);
    const source = isErpRow(item) ? ERP_SOURCE : 'sige';
    return {
      fonte: source,
      orderId: erpOrderId(item),
      receivableNumber: erpNumber(item),
      codigo: Number(item.codigo || item.Codigo || item.codigoLancamento || 0),
      codigoVenda: String(item.codigoVenda || '').trim(),
      cliente: String(item.cliente || item.nome || item.Cliente || item.customerName || '').trim(),
      documento: String(item.documento || item.NumeroDocumento || item.parcelaLabel || '').trim(),
      descricao: String(item.descricao || item.Descricao || '').trim(),
      vencimento: item.dataVencimento || item.DataVencimento || item.dueAt || null,
      saldo: Number.isFinite(saldo) ? Math.max(0, saldo) : 0,
      valorOriginal: Number.isFinite(original) ? Math.max(0, original) : 0,
      quitado: item.quitado === true || String(item.status || '').toLowerCase() === 'recebido',
      telefone: String(item.telefone || item.customerPhone || '').trim(),
      cpf: String(item.cpf || item.customerCpf || '').trim(),
      contrato: String(item.contrato || item.codigoContrato || item.CodigoContrato || item.codigoVenda || item.CodigoVenda || '').trim(),
      parcela: String(item.parcela || item.parcelaLabel || item.documento || item.NumeroDocumento || '').trim(),
      calculoAtualizacao: item.calculoAtualizacao || calcularAtualizacaoParcela(Math.max(0, Number.isFinite(saldo) ? saldo : 0), item.dataVencimento || item.DataVencimento || item.dueAt, item.status || '')
    };
  };

  window.abrirPagamentoSige = function abrirPagamentoFinanceiro(item) {
    const alvo = normalizarAlvoPagamentoSige(item);
    if (alvo.fonte === ERP_SOURCE) {
      if (!alvo.orderId || !Number.isInteger(alvo.receivableNumber) || alvo.receivableNumber <= 0) {
        toast('Esta parcela não possui vínculo válido com a venda do Ariana ERP.');
        return;
      }
    } else if (!Number.isInteger(alvo.codigo) || alvo.codigo <= 0) {
      toast('Este lançamento histórico não possui código válido.');
      return;
    }
    if (alvo.quitado || alvo.saldo <= 0) { toast('Esta parcela já está quitada.'); return; }

    sigePagamentoAlvo = alvo;
    const calc = alvo.calculoAtualizacao || calcularAtualizacaoParcela(alvo.saldo, alvo.vencimento, '');
    alvo.valorAtualizado = calc.atualizado;

    const codeField = byId('sigePayCodigo');
    const saldoField = byId('sigePaySaldo');
    const valorField = byId('sigePayValor');
    const dataField = byId('sigePayData');
    const docField = byId('sigePayDocumento');
    if (codeField) codeField.value = alvo.fonte === ERP_SOURCE ? `${alvo.codigoVenda || 'ERP'} • ${alvo.receivableNumber}` : String(alvo.codigo);
    if (saldoField) saldoField.value = money(calc.atualizado);
    if (valorField) valorField.value = moneyInput(calc.atualizado);
    if (dataField) dataField.value = localDateInputValue();
    if (docField) docField.value = gerarDocumentoPagamentoSige(alvo.fonte === ERP_SOURCE ? `${alvo.codigoVenda || 'ERP'}-${alvo.receivableNumber}` : alvo.codigo);

    const title = byId('sigePagamentoTitulo');
    if (title) title.textContent = '💰 Registrar pagamento no Ariana ERP';
    const help = title?.parentElement?.querySelector('.help');
    if (help) help.textContent = 'O pagamento será gravado no financeiro oficial do Ariana ERP.';
    const alert = document.querySelector('#sigePagamentoOverlay .sige-pay-alert');
    if (alert) alert.textContent = 'Após a baixa no Ariana ERP, o Financeiro Ariana registra o recebimento e mantém a rastreabilidade da parcela.';
    const confirm = byId('sigePayConfirmar');
    if (confirm) confirm.textContent = '✅ Confirmar no Ariana ERP';

    const resumo = byId('sigePagamentoResumo');
    if (resumo) resumo.innerHTML = `<b>${esc(alvo.cliente || 'Cliente')}</b><br>${esc(alvo.documento || alvo.parcela || 'Parcela')} • Vencimento ${formatDateBR(alvo.vencimento)}<br>Saldo: <b>${money(calc.atualizado)}</b>`;
    byId('sigePagamentoOverlay')?.classList.remove('hidden');
  };

  async function criarReciboErp(alvo, valorPagamento, formaPagamento, dataPagamento) {
    if (!alvo?.cliente || !valorPagamento) return { ok: false, skipped: true };
    try {
      return await apiJson('/admin/crediario/recibos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clienteNome: alvo.cliente,
          nome: alvo.cliente,
          telefone: alvo.telefone || '',
          cpf: alvo.cpf || '',
          contrato: alvo.contrato || alvo.codigoVenda || '',
          produto: alvo.descricao || `Venda ${alvo.codigoVenda || 'Ariana ERP'}`,
          valorPago: valorPagamento,
          parcela: alvo.parcela || alvo.documento || `${alvo.receivableNumber}`,
          formaPagamento,
          dataPagamento,
          observacao: `Recebimento vinculado ao Ariana ERP • ${alvo.orderId} • parcela ${alvo.receivableNumber}`,
          enviarWhatsapp: Boolean(shortPhone(alvo.telefone || ''))
        })
      });
    } catch (error) {
      console.warn('[Financeiro Ariana] pagamento confirmado no ERP, recibo não criado:', error?.message || error);
      return { ok: false, error };
    }
  }

  window.confirmarPagamentoSige = async function confirmarPagamentoFinanceiro() {
    if (sigePagamentoEnviando) return;
    const alvo = sigePagamentoAlvo;
    if (!alvo) { toast('Selecione uma parcela.'); return; }

    const valorPagamento = parseMoneyInput(byId('sigePayValor')?.value || '');
    const formaPagamento = String(byId('sigePayForma')?.value || '').trim();
    const contaBancaria = String(byId('sigePayConta')?.value || '').trim();
    const numeroDocumento = String(byId('sigePayDocumento')?.value || '').trim();
    const dataPagamento = String(byId('sigePayData')?.value || '').trim();
    if (!valorPagamento || valorPagamento <= 0) { toast('Informe um valor de pagamento válido.'); return; }
    if (valorPagamento - Number(alvo.saldo || 0) > 0.009) { toast('O valor não pode ser maior que o saldo da parcela.'); return; }

    const confirm = byId('sigePayConfirmar');
    sigePagamentoEnviando = true;
    if (confirm) { confirm.disabled = true; confirm.textContent = '⏳ Registrando no Ariana ERP...'; }

    try {
      if (alvo.fonte === ERP_SOURCE) {
        const endpoint = `/erp/finance-panel/lancamentos/${encodeURIComponent(alvo.orderId)}/${encodeURIComponent(alvo.receivableNumber)}/pagamentos`;
        await apiJson(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            valor: valorPagamento,
            formaPagamento,
            contaBancaria,
            numeroDocumento,
            dataPagamento,
            documento: numeroDocumento,
            observacao: 'Recebimento registrado pelo Painel Financeiro Ariana'
          })
        });

        const recibo = await criarReciboErp(alvo, valorPagamento, formaPagamento, dataPagamento);
        toast(recibo?.ok === false
          ? 'Pagamento registrado no Ariana ERP. O recibo automático não foi concluído; o recebimento financeiro está salvo.'
          : 'Pagamento registrado no Ariana ERP e recibo processado com sucesso.');
      } else {
        await apiJson('/admin/financeiro/lancamentos/' + encodeURIComponent(alvo.codigo) + '/pagamentos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            valor: valorPagamento,
            formaPagamento,
            contaBancaria,
            numeroDocumento,
            dataPagamento,
            conciliado: true,
            enviarWhatsapp: true,
            clienteNome: alvo.cliente,
            telefone: alvo.telefone,
            cpf: alvo.cpf,
            contrato: alvo.contrato,
            produto: alvo.descricao || 'Pagamento histórico',
            parcela: alvo.parcela || alvo.documento
          })
        });
        toast('Pagamento histórico registrado.');
      }

      byId('sigePagamentoOverlay')?.classList.add('hidden');
      sigePagamentoAlvo = null;
      try { await buscarSigeLancamentos(); } catch (_error) {}
      try { if (typeof loadRecibos === 'function') await loadRecibos(); } catch (_error) {}
    } catch (error) {
      toast('Erro ao registrar pagamento: ' + (error.message || error));
    } finally {
      sigePagamentoEnviando = false;
      if (confirm) { confirm.disabled = false; confirm.textContent = '✅ Confirmar no Ariana ERP'; }
    }
  };

  function applyErpLabels() {
    const topHelp = document.querySelector('.top .help');
    if (topHelp) topHelp.textContent = 'Consulte clientes, parcelas, saldos e inadimplência diretamente do Ariana ERP. O histórico do SIGE permanece preservado.';

    const navSige = document.querySelector('.nav button[onclick*="showTab(\'sige\'"]');
    if (navSige) navSige.textContent = '🔌 Ariana ERP';

    const importButton = document.querySelector('.nav button[onclick*="showTab(\'importar\'"]');
    if (importButton) importButton.textContent = '📂 Importar SIGE (histórico)';

    const erpTab = byId('tab-sige');
    if (erpTab) {
      replaceText(erpTab, 'SIGE Online', 'Ariana ERP');
      replaceText(erpTab, 'no SIGE', 'no Ariana ERP');
      replaceText(erpTab, 'do SIGE', 'do Ariana ERP');
      replaceText(erpTab, 'SIGE.', 'Ariana ERP.');
      replaceText(erpTab, 'SIGE', 'Ariana ERP');
    }

    const inad = byId('tab-inadimplentes');
    if (inad) {
      replaceText(inad, 'SIGE', 'Ariana ERP');
      replaceText(inad, 'Clique em buscar para carregar a inadimplência do Ariana ERP.', 'Clique em buscar para carregar a inadimplência do Ariana ERP.');
    }

    const cobrancas = byId('tab-cobrancas');
    if (cobrancas) replaceText(cobrancas, 'SIGE', 'Ariana ERP');

    const dashboard = byId('tab-dashboardCrediario');
    if (dashboard) replaceText(dashboard, 'parcelas do SIGE', 'parcelas do Ariana ERP');

    const novo = byId('tab-novo');
    if (novo) replaceText(novo, 'cadastro financeiro oficial do SIGE', 'cadastro oficial do Ariana ERP');

    const health = byId('healthSige');
    if (health) {
      const firstText = [...health.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
      if (firstText) firstText.nodeValue = firstText.nodeValue.replace('SIGE', 'Ariana ERP');
      const div = health.querySelector('div');
      if (div && div.firstChild) div.firstChild.nodeValue = 'Ariana ERP';
    }

    if (!byId('erpSourceBanner')) {
      const top = document.querySelector('.top');
      const banner = document.createElement('div');
      banner.id = 'erpSourceBanner';
      banner.style.cssText = 'margin:-8px 0 20px;padding:12px 16px;border:1px solid #bfdbfe;border-radius:16px;background:#eff6ff;color:#1e3a8a;font-size:13px;font-weight:800';
      banner.innerHTML = '✅ Fonte operacional: <b>Ariana ERP</b> &nbsp;•&nbsp; Histórico SIGE preservado para consulta/importação.';
      top?.insertAdjacentElement('afterend', banner);
    }

    const modalTitle = byId('sigePagamentoTitulo');
    if (modalTitle) modalTitle.textContent = '💰 Registrar pagamento no Ariana ERP';
    const modalHelp = modalTitle?.parentElement?.querySelector('.help');
    if (modalHelp) modalHelp.textContent = 'O pagamento será gravado no financeiro oficial do Ariana ERP.';
    const modalAlert = document.querySelector('#sigePagamentoOverlay .sige-pay-alert');
    if (modalAlert) modalAlert.textContent = 'A baixa é registrada no Ariana ERP. O histórico importado do SIGE não é alterado.';
    const modalConfirm = byId('sigePayConfirmar');
    if (modalConfirm) modalConfirm.textContent = '✅ Confirmar no Ariana ERP';
  }

  function refreshOperationalData() {
    if (!token()) return;
    try { if (typeof loadClientes === 'function') loadClientes(); } catch (_error) {}
    const visible = document.querySelector('section:not(.hidden)[id^="tab-"]')?.id || '';
    if (visible === 'tab-sige') testarSigeStatus();
    if (visible === 'tab-inadimplentes' && typeof loadSigeInadimplentesCentral === 'function') loadSigeInadimplentesCentral();
    if (visible === 'tab-dashboardCrediario' && typeof loadDashboardCrediario === 'function') loadDashboardCrediario();
  }

  applyErpLabels();
  setTimeout(() => {
    applyErpLabels();
    refreshOperationalData();
  }, 0);

  console.info('[Financeiro Ariana] interface operacional conectada ao Ariana ERP');
})();
