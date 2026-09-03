(() => {
  'use strict';

  const API = String(window.API_BASE || 'https://ariana-backend.onrender.com/api').replace(/\/+$/, '');
  const HISTORY_KEY = 'ariana_professional_poster_history_v1';
  const els = {};
  let products = [];
  let productsLoading = true;
  let selectedProduct = null;
  let previewBlob = null;
  let previewObjectUrl = '';
  let savedPosterUrl = '';
  let deferredInstallPrompt = null;

  function byId(id) { return document.getElementById(id); }
  function token() {
    for (const key of ['adminToken', 'admin_token', 'authToken', 'token']) {
      const value = localStorage.getItem(key) || sessionStorage.getItem(key);
      if (value) return value;
    }
    return '';
  }

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function normalizeSearch(value = '') {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function parseMoney(value) {
    const raw = String(value ?? '').trim().replace(/R\$/gi, '').replace(/\s/g, '');
    if (!raw) return 0;
    if (raw.includes(',')) return Number(raw.replace(/\./g, '').replace(',', '.')) || 0;
    return Number(raw) || 0;
  }

  function money(value) {
    return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function moneyInput(value) {
    return Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function imageOf(product = {}) {
    const images = Array.isArray(product.images) ? product.images : [];
    const main = images.find(item => item && item.isMain && (item.url || item.imageUrl)) || images.find(item => item && (item.url || item.imageUrl));
    const raw = product.mainImageUrl || product.imageUrl || product.image || product.imagem || main?.url || main?.imageUrl || '';
    return window.resolveApiImageUrl ? window.resolveApiImageUrl(raw) : String(raw || '');
  }

  async function api(path, options = {}, responseType = 'json') {
    const authToken = token();
    if (!authToken) throw new Error('Faça login novamente no painel administrativo.');
    const isForm = options.body instanceof FormData;
    const response = await fetch(API + path, {
      ...options,
      headers: {
        Authorization: `Bearer ${authToken}`,
        ...(isForm ? {} : { 'Content-Type': 'application/json' }),
        ...(options.headers || {})
      }
    });
    if (response.status === 401) {
      localStorage.removeItem('adminToken');
      sessionStorage.removeItem('adminToken');
      throw new Error('Sua sessão expirou. Faça login novamente.');
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || payload.message || `Falha na operação (${response.status}).`);
    }
    if (responseType === 'blob') return response.blob();
    return response.json();
  }

  function status(message = '', type = '') {
    els.globalStatus.textContent = message;
    els.globalStatus.className = `global-status ${type}`.trim();
  }

  function setBusy(busy) {
    els.previewButton.disabled = busy;
    els.previewLoading.classList.toggle('hidden', !busy);
    if (busy) status('Ajustando produto, marca, preços e acabamento...', '');
  }

  function templateValue() {
    return document.querySelector('input[name="template"]:checked')?.value || 'oferta';
  }

  function colorThemeValue() {
    return document.querySelector('input[name="color-theme"]:checked')?.value || 'azul';
  }

  function layoutVariantValue() {
    return document.querySelector('input[name="layout-variant"]:checked')?.value || '';
  }

  function sceneThemeValue() {
    return document.querySelector('input[name="scene-theme"]:checked')?.value || '';
  }

  function updateColorSelection() {
    document.querySelectorAll('.palette-card').forEach(card => card.classList.toggle('selected', card.querySelector('input')?.checked));
  }

  function updateLayoutSelection() {
    document.querySelectorAll('.layout-card').forEach(card => card.classList.toggle('selected', card.querySelector('input')?.checked));
  }

  function updateSceneSelection() {
    document.querySelectorAll('.scene-card').forEach(card => card.classList.toggle('selected', card.querySelector('input')?.checked));

    // Os cenários fotográficos pertencem ao layout temático (preços lado a lado).
    // Ao escolher um ambiente manualmente, ativa esse layout para que a escolha
    // nunca seja ignorada pela rotação automática de cartazes.
    const selectedScene = sceneThemeValue();
    if (selectedScene) {
      const thematicLayout = document.querySelector('input[name="layout-variant"][value="split"]');
      if (thematicLayout && !thematicLayout.checked) {
        thematicLayout.checked = true;
        updateLayoutSelection();
      }
    }
  }

  function updateTemplateSelection(changeText = false) {
    document.querySelectorAll('.template-card').forEach(card => card.classList.toggle('selected', card.querySelector('input')?.checked));
    if (!changeText) return;
    const presets = {
      oferta: ['OFERTA IMPERDÍVEL', 'Economize de verdade na Ariana Móveis'],
      campanha: ['SETEMBRO COMEÇOU COM TUDO', 'Comece o mês economizando de verdade'],
      queima: ['QUEIMA DE ESTOQUE', 'Últimas unidades com preço especial']
    };
    const preset = presets[templateValue()] || presets.oferta;
    els.headline.value = preset[0];
    els.subtitle.value = preset[1];
  }

  function updatePricingSummary() {
    const cash = parseMoney(els.cashPrice.value);
    const full = parseMoney(els.fullPrice.value);
    const installments = Number(els.installments.value || 12);
    const installmentPrice = parseMoney(els.installmentPrice.value) || (full / installments);
    if (!cash || !full) {
      els.pricingSummary.textContent = 'Informe o preço à vista para calcular o parcelamento.';
      els.pricingSummary.classList.remove('ready');
      return;
    }
    els.pricingSummary.innerHTML = `De <b>${money(full)}</b> por <b>${money(cash)}</b> à vista no dinheiro ou Pix • ou <b>${installments}x de ${money(installmentPrice)}</b> sem juros no cartão.`;
    els.pricingSummary.classList.add('ready');
  }

  function calculateCardPrice() {
    const cash = parseMoney(els.cashPrice.value);
    if (!cash) {
      status('Informe primeiro o preço à vista.', 'error');
      els.cashPrice.focus();
      return;
    }
    const installments = Number(els.installments.value || 12);
    const full = cash / 0.8272;
    els.fullPrice.value = moneyInput(full);
    els.installmentPrice.value = moneyInput(full / installments);
    updatePricingSummary();
    status('Regra ÷ 0,8272 aplicada ao preço a prazo e às parcelas.', 'ok');
  }

  function renderProductResults(query = '') {
    const normalized = normalizeSearch(query);
    if (normalized.length < 2) {
      els.productResults.classList.add('hidden');
      els.productResults.innerHTML = '';
      return;
    }
    if (productsLoading) {
      els.productResults.innerHTML = '<div class="history-empty">Carregando o catálogo da Ariana Móveis...</div>';
      els.productResults.classList.remove('hidden');
      return;
    }
    const terms = normalized.split(/\s+/).filter(Boolean);
    const rows = products.filter(product => {
      const haystack = normalizeSearch(`${product.name || ''} ${product.title || ''} ${product.brand || ''} ${product.sku || ''} ${product.code || ''} ${product.categoryName || product.category || ''} ${product.description || ''}`);
      return terms.every(term => haystack.includes(term));
    }).slice(0, 10);
    els.productResults.innerHTML = rows.length ? rows.map(product => {
      const id = String(product.id || product._id || '');
      return `<button type="button" class="product-result" data-product-id="${escapeHtml(id)}"><img src="${escapeHtml(imageOf(product))}" alt=""><span><b>${escapeHtml(product.name || 'Produto')}</b><small>${escapeHtml(product.brand || product.categoryName || product.sku || '')}</small></span><em>${money(product.pixPrice || product.price || 0)}</em></button>`;
    }).join('') : '<div class="history-empty">Nenhum produto encontrado. Você pode preencher manualmente.</div>';
    els.productResults.classList.remove('hidden');
  }

  function selectProduct(product) {
    selectedProduct = product || null;
    if (!selectedProduct) {
      els.selectedProduct.classList.add('hidden');
      els.selectedProduct.innerHTML = '';
      return;
    }
    const full = Number(selectedProduct.price || selectedProduct.fullPrice || 0);
    const cash = Number(selectedProduct.pixPrice || selectedProduct.cashPrice || (full ? full * .83 : 0));
    els.productName.value = selectedProduct.name || '';
    els.imageUrl.value = imageOf(selectedProduct);
    if (cash) els.cashPrice.value = moneyInput(cash);
    if (full) els.fullPrice.value = moneyInput(full);
    if (full) els.installmentPrice.value = moneyInput(full / Number(els.installments.value || 12));
    els.productSearch.value = selectedProduct.name || '';
    els.productResults.classList.add('hidden');
    els.selectedProduct.innerHTML = `<img src="${escapeHtml(imageOf(selectedProduct))}" alt=""><div><b>${escapeHtml(selectedProduct.name || 'Produto selecionado')}</b><span>${escapeHtml(selectedProduct.sku || selectedProduct.brand || 'Produto do catálogo')}</span></div><button id="clear-product" type="button">Trocar</button>`;
    els.selectedProduct.classList.remove('hidden');
    byId('clear-product')?.addEventListener('click', () => {
      selectedProduct = null;
      els.productSearch.value = '';
      els.selectedProduct.classList.add('hidden');
      els.productSearch.focus();
    });
    updatePricingSummary();
    status('Produto carregado do catálogo. Confira a imagem e os preços.', 'ok');
  }

  async function loadProducts() {
    productsLoading = true;
    try {
      const data = await api('/admin/products?sortBy=updatedAt&sortDir=desc&limit=1000');
      products = Array.isArray(data) ? data : (data.products || data.items || data.docs || data.results || data.data || []);
      if (!products.length) {
        const fallback = await api('/products?limit=1000&sortBy=updatedAt&sortDir=desc');
        products = Array.isArray(fallback) ? fallback : (fallback.products || fallback.items || fallback.docs || fallback.results || fallback.data || []);
      }
      productsLoading = false;
      if (els.productSearch.value.trim().length >= 2) renderProductResults(els.productSearch.value);
      status(`Catálogo carregado: ${products.length} produto(s) disponível(is).`, products.length ? 'ok' : 'error');
    } catch (error) {
      products = [];
      productsLoading = false;
      if (els.productSearch.value.trim().length >= 2) renderProductResults(els.productSearch.value);
      status(`O catálogo não pôde ser carregado: ${error.message}. Ainda é possível preencher o cartaz manualmente.`, 'error');
    }
  }

  async function uploadImage(file) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      els.uploadStatus.textContent = 'A imagem ultrapassa 20 MB.';
      els.uploadStatus.className = 'status-line field-full error';
      return;
    }
    els.uploadStatus.textContent = 'Enviando imagem em alta qualidade...';
    els.uploadStatus.className = 'status-line field-full';
    const form = new FormData();
    form.append('file', file);
    form.append('folder', 'marketing/cartazes/produtos');
    try {
      const data = await api('/admin/uploads', { method: 'POST', body: form });
      const uploaded = Array.isArray(data?.files) ? data.files[0] : (data?.file || data);
      const url = uploaded?.url || uploaded?.secure_url || uploaded?.imageUrl || data?.url;
      if (!url) throw new Error('O servidor não devolveu o endereço da imagem.');
      els.imageUrl.value = url;
      els.uploadStatus.textContent = 'Imagem enviada e pronta para o cartaz.';
      els.uploadStatus.className = 'status-line field-full ok';
      status('Foto do produto atualizada.', 'ok');
    } catch (error) {
      els.uploadStatus.textContent = `Erro no envio: ${error.message}`;
      els.uploadStatus.className = 'status-line field-full error';
    }
  }

  function buildPayload() {
    const name = els.productName.value.trim();
    const imageUrl = els.imageUrl.value.trim();
    const cashPrice = parseMoney(els.cashPrice.value);
    const fullPrice = parseMoney(els.fullPrice.value);
    const installmentPrice = parseMoney(els.installmentPrice.value);
    if (!name) throw new Error('Informe o nome do produto.');
    if (!imageUrl) throw new Error('Selecione ou envie a imagem real do produto.');
    if (!cashPrice || !fullPrice) throw new Error('Informe o preço anterior e o preço à vista.');
    if (!installmentPrice) throw new Error('Informe o valor de cada parcela.');
    if (fullPrice < cashPrice) throw new Error('O preço anterior não pode ser menor que o preço à vista.');
    return {
      productId: String(selectedProduct?.id || selectedProduct?._id || ''),
      product: {
        id: String(selectedProduct?.id || selectedProduct?._id || ''),
        name,
        imageUrl,
        brand: selectedProduct?.brand || '',
        category: selectedProduct?.category || selectedProduct?.categoryName || '',
        cashPrice,
        fullPrice,
        installmentCount: Number(els.installments.value || 12),
        installmentPrice
      },
      options: {
        template: templateValue(),
        colorTheme: colorThemeValue(),
        layoutVariant: layoutVariantValue() || undefined,
        sceneTheme: sceneThemeValue() || undefined,
        headline: els.headline.value.trim(),
        subtitle: els.subtitle.value.trim(),
        productName: name,
        imageUrl,
        cashPrice,
        fullPrice,
        installmentCount: Number(els.installments.value || 12),
        installmentPrice,
        removeLightBackground: els.removeBackground.checked,
        showMascot: els.showMascot.checked,
        productOffsetX: Number(els.offsetX.value || 0),
        productOffsetY: Number(els.offsetY.value || 0),
        whatsapp: '(31) 98514-7119',
        email: 'contato@arianamoveis.com.br',
        siteLabel: 'arianamoveis.com.br'
      }
    };
  }

  function showPreview(blob) {
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewBlob = blob;
    previewObjectUrl = URL.createObjectURL(blob);
    els.posterPreview.src = previewObjectUrl;
    els.posterPreview.classList.remove('hidden');
    els.previewEmpty.classList.add('hidden');
    els.saveButton.disabled = false;
    els.downloadButton.disabled = false;
    els.shareButton.disabled = false;
  }

  async function generatePreview() {
    let payload;
    try { payload = buildPayload(); } catch (error) { status(error.message, 'error'); return; }
    setBusy(true);
    try {
      const blob = await api('/admin/posters/preview', { method: 'POST', body: JSON.stringify(payload) }, 'blob');
      showPreview(blob);
      savedPosterUrl = '';
      status('Prévia concluída. Confira todos os dados antes de salvar.', 'ok');
    } catch (error) {
      status(`Não foi possível gerar a prévia: ${error.message}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  function readHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') || []; } catch (_) { return []; }
  }

  function saveHistory(item) {
    const rows = [item, ...readHistory().filter(row => row.url !== item.url)].slice(0, 12);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(rows));
    renderHistory();
  }

  function renderHistory() {
    const rows = readHistory();
    els.historyList.innerHTML = rows.length ? rows.map(row => `<article class="history-card"><img src="${escapeHtml(row.url)}" alt=""><div><b>${escapeHtml(row.name || 'Cartaz Ariana')}</b><small>${new Date(row.createdAt).toLocaleString('pt-BR')}</small><a href="${escapeHtml(row.url)}" target="_blank" rel="noopener">Abrir cartaz</a></div></article>`).join('') : '<div class="history-empty">Nenhum cartaz salvo neste navegador.</div>';
  }

  async function savePoster() {
    let payload;
    try { payload = buildPayload(); } catch (error) { status(error.message, 'error'); return; }
    els.saveButton.disabled = true;
    els.saveButton.textContent = 'Salvando...';
    status('Salvando a arte em alta resolução...', '');
    try {
      const data = await api('/admin/posters/professional', { method: 'POST', body: JSON.stringify(payload) });
      if (!data.url) throw new Error('O endereço final não retornou.');
      savedPosterUrl = data.url;
      saveHistory({ url: data.url, name: payload.product.name, createdAt: new Date().toISOString(), template: payload.options.template });
      status('Cartaz salvo em alta resolução. Agora você pode baixar ou compartilhar.', 'ok');
      window.open(data.url, '_blank', 'noopener');
    } catch (error) {
      status(`Erro ao salvar: ${error.message}`, 'error');
    } finally {
      els.saveButton.disabled = false;
      els.saveButton.textContent = 'Salvar em alta resolução';
    }
  }

  function posterFile() {
    if (!previewBlob) return null;
    const safeName = String(els.productName.value || 'cartaz-ariana').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
    return new File([previewBlob], `${safeName || 'cartaz-ariana'}.png`, { type: 'image/png' });
  }

  function downloadPoster() {
    const file = posterFile();
    if (!file) return;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(file);
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1500);
  }

  async function sharePoster() {
    const file = posterFile();
    if (!file) return;
    try {
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({ title: 'Oferta Ariana Móveis', text: els.headline.value.trim(), files: [file] });
        return;
      }
      if (savedPosterUrl) {
        window.open(`https://wa.me/?text=${encodeURIComponent(`${els.headline.value.trim()}\n${savedPosterUrl}`)}`, '_blank', 'noopener');
        return;
      }
      downloadPoster();
      status('O cartaz foi baixado. Anexe o PNG no WhatsApp.', 'ok');
    } catch (error) {
      if (error?.name !== 'AbortError') status(`Não foi possível compartilhar: ${error.message}`, 'error');
    }
  }

  function bind() {
    Object.assign(els, {
      headline: byId('headline'), subtitle: byId('subtitle'), productSearch: byId('product-search'), productResults: byId('product-results'), selectedProduct: byId('selected-product'),
      productName: byId('product-name'), imageUrl: byId('image-url'), imageFile: byId('image-file'), uploadStatus: byId('upload-status'), cashPrice: byId('cash-price'), fullPrice: byId('full-price'), installmentPrice: byId('installment-price'),
      installments: byId('installments'), calculateCard: byId('calculate-card'), pricingSummary: byId('pricing-summary'), removeBackground: byId('remove-background'), showMascot: byId('show-mascot'),
      offsetX: byId('offset-x'), offsetY: byId('offset-y'), offsetXValue: byId('offset-x-value'), offsetYValue: byId('offset-y-value'), previewButton: byId('preview-button'), saveButton: byId('save-button'),
      downloadButton: byId('download-button'), shareButton: byId('share-button'), globalStatus: byId('global-status'), previewEmpty: byId('preview-empty'), previewLoading: byId('preview-loading'),
      posterPreview: byId('poster-preview'), historyList: byId('history-list'), clearHistory: byId('clear-history'), installApp: byId('install-app')
    });

    document.querySelectorAll('input[name="template"]').forEach(input => input.addEventListener('change', () => updateTemplateSelection(true)));
    document.querySelectorAll('input[name="color-theme"]').forEach(input => input.addEventListener('change', updateColorSelection));
    document.querySelectorAll('input[name="layout-variant"]').forEach(input => input.addEventListener('change', updateLayoutSelection));
    document.querySelectorAll('input[name="scene-theme"]').forEach(input => input.addEventListener('change', updateSceneSelection));
    els.productSearch.addEventListener('input', () => renderProductResults(els.productSearch.value));
    els.productResults.addEventListener('click', event => {
      const button = event.target.closest('[data-product-id]');
      if (!button) return;
      const product = products.find(row => String(row.id || row._id) === String(button.dataset.productId));
      if (product) selectProduct(product);
    });
    document.addEventListener('click', event => { if (!event.target.closest('.catalog-search')) els.productResults.classList.add('hidden'); });
    els.imageFile.addEventListener('change', () => uploadImage(els.imageFile.files?.[0]));
    els.calculateCard.addEventListener('click', calculateCardPrice);
    els.cashPrice.addEventListener('input', updatePricingSummary);
    els.fullPrice.addEventListener('input', updatePricingSummary);
    els.installmentPrice.addEventListener('input', updatePricingSummary);
    els.installments.addEventListener('change', updatePricingSummary);
    els.offsetX.addEventListener('input', () => { els.offsetXValue.textContent = `${els.offsetX.value} px`; });
    els.offsetY.addEventListener('input', () => { els.offsetYValue.textContent = `${els.offsetY.value} px`; });
    els.previewButton.addEventListener('click', generatePreview);
    els.saveButton.addEventListener('click', savePoster);
    els.downloadButton.addEventListener('click', downloadPoster);
    els.shareButton.addEventListener('click', sharePoster);
    els.clearHistory.addEventListener('click', () => { localStorage.removeItem(HISTORY_KEY); renderHistory(); });

    window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstallPrompt = event; });
    els.installApp.addEventListener('click', async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        return;
      }
      const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
      alert(isiOS ? 'No Safari, toque em Compartilhar e depois em “Adicionar à Tela de Início”.' : 'Abra o menu do navegador e escolha “Instalar aplicativo” ou “Adicionar à tela inicial”.');
    });
    window.addEventListener('appinstalled', () => els.installApp.classList.add('hidden'));
  }

  async function start() {
    bind();
    updateTemplateSelection(false);
    updateColorSelection();
    updateLayoutSelection();
    updateSceneSelection();
    updatePricingSummary();
    renderHistory();
    if (!token()) {
      location.href = 'admin_login.html?return=gerador_cartazes.html';
      return;
    }
    try {
      const session = await api('/admin/me');
      const user = session?.user || session?.admin || session || {};
      const role = String(user.role || '').toLowerCase();
      const permissions = Array.isArray(user.permissions) ? user.permissions : [];
      const allowed = role === 'admin' || user.admin === true || permissions.includes('*') || permissions.includes('posters:generate');
      if (!allowed) throw new Error('Seu usuário não possui a permissão de gerar cartazes.');
    } catch (error) {
      status(error.message, 'error');
      if (/sessão|login/i.test(error.message)) {
        setTimeout(() => { location.href = 'admin_login.html?return=gerador_cartazes.html'; }, 1200);
      }
      return;
    }
    await loadProducts();
    if (!products.length && !els.globalStatus.textContent) status('Preencha os dados manualmente para começar.', '');
  }

  document.addEventListener('DOMContentLoaded', start);
})();
