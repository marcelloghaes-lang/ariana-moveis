(() => {
  'use strict';

  const API = String(window.API_BASE || 'https://ariana-backend.onrender.com/api').replace(/\/+$/, '');
  const els = {};
  let products = [];
  let productsLoading = true;
  let selectedProduct = null;
  let contentMode = 'with_price';
  let previewBlob = null;
  let previewUrl = '';

  const FORMATS = Object.freeze({
    hero_desktop: { label: 'PRÉVIA • HERO DESKTOP', size: '1920 × 480 pixels' },
    hero_mobile: { label: 'PRÉVIA • HERO MOBILE', size: '1080 × 1080 pixels' },
    secondary_desktop: { label: 'PRÉVIA • SECUNDÁRIO DESKTOP', size: '1600 × 400 pixels' },
    secondary_mobile: { label: 'PRÉVIA • SECUNDÁRIO MOBILE', size: '1080 × 720 pixels' },
    square: { label: 'PRÉVIA • CARD QUADRADO', size: '1080 × 1080 pixels' }
  });

  function byId(id) { return document.getElementById(id); }

  function token() {
    for (const key of ['adminToken','admin_token','authToken','token']) {
      const value = localStorage.getItem(key) || sessionStorage.getItem(key);
      if (value) return value;
    }
    try {
      return JSON.parse(localStorage.getItem('banner_admin_session') || 'null')?.token || '';
    } catch {
      return '';
    }
  }

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, char => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[char]));
  }

  function normalize(value = '') {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g,'')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g,' ')
      .trim();
  }

  function parseMoney(value) {
    const raw = String(value ?? '').trim().replace(/R\$/gi,'').replace(/\s/g,'');
    if (!raw) return 0;
    if (raw.includes(',')) return Number(raw.replace(/\./g,'').replace(',','.')) || 0;
    return Number(raw) || 0;
  }

  function moneyInput(value) {
    return Number(value || 0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  }

  function money(value) {
    return Number(value || 0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  }

  function imageOf(product = {}) {
    const images = Array.isArray(product.images) ? product.images : [];
    const main = images.find(item => item?.isMain && (item.url || item.imageUrl))
      || images.find(item => item?.url || item?.imageUrl);
    const raw = product.mainImageUrl || product.imageUrl || product.image || product.imagem || main?.url || main?.imageUrl || '';
    if (/^https?:\/\//i.test(raw) || /^data:/i.test(raw)) return String(raw);
    if (String(raw).startsWith('/uploads/')) return API.replace(/\/api$/,'') + raw;
    return String(raw || '');
  }

  async function api(path, options = {}, responseType = 'json') {
    const auth = token();
    if (!auth) throw new Error('Faça login novamente no painel administrativo.');
    const isForm = options.body instanceof FormData;
    const response = await fetch(API + path, {
      ...options,
      headers: {
        Authorization: 'Bearer ' + auth,
        ...(isForm ? {} : {'Content-Type':'application/json'}),
        ...(options.headers || {})
      }
    });

    if (response.status === 401) throw new Error('Sua sessão expirou. Faça login novamente.');
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || payload.message || 'Falha na operação (' + response.status + ').');
    }
    return responseType === 'blob' ? response.blob() : response.json();
  }

  function status(message = '', type = '') {
    els.globalStatus.textContent = message;
    els.globalStatus.className = 'global-status ' + type;
  }

  function selectedFormat() {
    return document.querySelector('input[name="format"]:checked')?.value || 'hero_desktop';
  }

  function selectedTemplate() {
    return document.querySelector('input[name="template-pro"]:checked')?.value || 'marketplace';
  }

  function updateChoiceCards() {
    document.querySelectorAll('.choice').forEach(card => card.classList.toggle('selected', !!card.querySelector('input:checked')));
    document.querySelectorAll('.template-card').forEach(card => card.classList.toggle('selected', !!card.querySelector('input:checked')));
    const format = FORMATS[selectedFormat()] || FORMATS.hero_desktop;
    els.previewLabel.textContent = format.label;
    els.previewSize.textContent = format.size;
    els.previewStage.dataset.format = selectedFormat();
  }

  function applyMode(mode) {
    contentMode = ['with_price','no_price','institutional'].includes(mode) ? mode : 'with_price';
    document.querySelectorAll('#content-mode button').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === contentMode));

    const showPricing = contentMode === 'with_price';
    els.pricingStep.classList.toggle('disabled', !showPricing);
    els.pricingStep.querySelectorAll('input,select').forEach(input => {
      input.disabled = !showPricing;
    });

    if (contentMode === 'no_price') {
      els.badge.value = 'DESTAQUE ARIANA';
      els.headline.value = 'TECNOLOGIA PARA SUA CASA';
      els.cta.value = 'CONFIRA NO SITE';
      status('Modo sem preço ativado. O banner será reorganizado sem reservar espaço para valor.', 'ok');
    } else if (contentMode === 'institutional') {
      els.badge.value = 'CAMPANHA ARIANA';
      els.headline.value = 'PORQUE SUA CASA MERECE O MELHOR';
      els.cta.value = 'CONHEÇA A ARIANA';
      status('Modo institucional ativado. Preço e parcelamento não serão usados.', 'ok');
    } else {
      els.badge.value = 'OFERTA ARIANA';
      els.headline.value = 'OFERTA IMPERDÍVEL';
      els.cta.value = 'APROVEITE AGORA';
      status('Modo com preço ativado. Se o valor ficar vazio, o Pro ainda gera uma composição sem preço.', 'ok');
    }
  }

  function renderProductResults(query = '') {
    const normalized = normalize(query);
    if (normalized.length < 2) {
      els.productResults.classList.add('hidden');
      els.productResults.innerHTML = '';
      return;
    }

    if (productsLoading) {
      els.productResults.innerHTML = '<div style="padding:12px;font-size:11px;color:#718095">Carregando catálogo...</div>';
      els.productResults.classList.remove('hidden');
      return;
    }

    const terms = normalized.split(/\s+/).filter(Boolean);
    const rows = products.filter(product => {
      const haystack = normalize([
        product.name,product.title,product.brand,product.sku,product.code,
        product.categoryName,product.category,product.description
      ].filter(Boolean).join(' '));
      return terms.every(term => haystack.includes(term));
    }).slice(0,12);

    els.productResults.innerHTML = rows.length
      ? rows.map(product => {
          const id = String(product.id || product._id || '');
          return '<button type="button" class="product-result" data-product-id="' + escapeHtml(id) + '">' +
            '<img src="' + escapeHtml(imageOf(product)) + '" alt="">' +
            '<span><b>' + escapeHtml(product.name || 'Produto') + '</b><small>' + escapeHtml(product.brand || product.categoryName || product.sku || '') + '</small></span>' +
            '<em>' + money(product.pixPrice || product.cashPrice || product.price || 0) + '</em>' +
            '</button>';
        }).join('')
      : '<div style="padding:12px;font-size:11px;color:#718095">Nenhum produto encontrado. Você pode preencher manualmente.</div>';

    els.productResults.classList.remove('hidden');
    els.productResults.querySelectorAll('[data-product-id]').forEach(button => {
      button.addEventListener('click', () => {
        const product = products.find(item => String(item.id || item._id || '') === button.dataset.productId);
        if (product) selectProduct(product);
      });
    });
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
    const count = Number(els.installments.value || 12);

    els.productName.value = selectedProduct.name || '';
    els.imageUrl.value = imageOf(selectedProduct);
    if (cash) els.cashPrice.value = moneyInput(cash);
    if (full) els.fullPrice.value = moneyInput(full);
    if (full) els.installmentPrice.value = moneyInput(full / count);
    els.productSearch.value = selectedProduct.name || '';
    els.productResults.classList.add('hidden');

    els.selectedProduct.innerHTML =
      '<img src="' + escapeHtml(imageOf(selectedProduct)) + '" alt="">' +
      '<div><b>' + escapeHtml(selectedProduct.name || 'Produto selecionado') + '</b>' +
      '<span>' + escapeHtml(selectedProduct.brand || selectedProduct.categoryName || selectedProduct.sku || 'Produto do catálogo') + '</span></div>' +
      '<button type="button" id="clear-product">Trocar produto</button>';
    els.selectedProduct.classList.remove('hidden');
    byId('clear-product')?.addEventListener('click', () => {
      selectedProduct = null;
      els.productSearch.value = '';
      els.selectedProduct.classList.add('hidden');
      els.productSearch.focus();
    });

    status('Produto carregado. O Pro vai analisar a imagem antes de montar a campanha.', 'ok');
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
      status('Catálogo carregado: ' + products.length + ' produto(s).', products.length ? 'ok' : '');
    } catch (error) {
      products = [];
      status('Não consegui carregar o catálogo: ' + error.message + '. Você ainda pode preencher manualmente.', 'error');
    } finally {
      productsLoading = false;
    }
  }

  async function uploadImage(file) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      els.uploadStatus.textContent = 'A imagem ultrapassa 20 MB.';
      els.uploadStatus.className = 'inline-status full error';
      return;
    }

    els.uploadStatus.textContent = 'Enviando imagem...';
    els.uploadStatus.className = 'inline-status full';
    try {
      const form = new FormData();
      form.append('file',file);
      form.append('folder','marketing/creative-studio-pro/produtos');
      const data = await api('/admin/uploads',{method:'POST',body:form});
      const uploaded = Array.isArray(data?.files) ? data.files[0] : (data?.file || data);
      const url = uploaded?.url || uploaded?.secure_url || uploaded?.imageUrl || data?.url;
      if (!url) throw new Error('O servidor não devolveu a URL da imagem.');
      els.imageUrl.value = url;
      els.uploadStatus.textContent = 'Imagem enviada. O recorte será analisado na prévia.';
      els.uploadStatus.className = 'inline-status full ok';
    } catch (error) {
      els.uploadStatus.textContent = error.message;
      els.uploadStatus.className = 'inline-status full error';
    }
  }

  function buildPayload() {
    const name = els.productName.value.trim();
    const imageUrl = els.imageUrl.value.trim();
    if (!name) throw new Error('Informe o nome do produto.');
    if (!imageUrl) throw new Error('Selecione ou envie a imagem do produto.');

    const cashPrice = parseMoney(els.cashPrice.value);
    const fullPrice = parseMoney(els.fullPrice.value);
    const count = Number(els.installments.value || 12);
    const installmentPrice = parseMoney(els.installmentPrice.value) || (fullPrice > 0 ? fullPrice / count : 0);
    const showPrice = contentMode === 'with_price' && cashPrice > 0;

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
        installmentCount: count,
        installmentPrice
      },
      options: {
        outputFormat: selectedFormat(),
        templatePro: selectedTemplate(),
        contentMode,
        showPrice,
        headline: els.headline.value.trim(),
        subtitle: els.subtitle.value.trim(),
        benefit: els.benefit.value.trim(),
        badge: els.badge.value.trim(),
        cta: els.cta.value.trim(),
        productName: name,
        imageUrl,
        cashPrice,
        fullPrice,
        installmentCount: count,
        installmentPrice,
        removeBackground: els.removeBackground.checked,
        siteLabel: 'arianamoveis.com.br'
      }
    };
  }

  function renderQuality(analysis) {
    const quality = analysis?.quality || {};
    els.qualityScore.textContent = Number.isFinite(Number(quality.score)) ? quality.score + '%' : '—';
    const checks = Array.isArray(quality.checks) ? quality.checks : [];
    els.qualityList.innerHTML = checks.length
      ? checks.map(item =>
          '<div class="quality-item ' + (item.ok ? 'ok' : 'warn') + '">' +
          '<span class="quality-icon">' + (item.ok ? '✓' : '!') + '</span>' +
          '<div><b>' + escapeHtml(item.label || '') + '</b><small>' + escapeHtml(item.detail || '') + '</small></div>' +
          '</div>'
        ).join('')
      : '<div class="quality-placeholder">Nenhuma análise disponível.</div>';
  }

  function showPreview(blob) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewBlob = blob;
    previewUrl = URL.createObjectURL(blob);
    els.previewImage.src = previewUrl;
    els.previewImage.classList.remove('hidden');
    els.previewEmpty.classList.add('hidden');
    els.saveButton.disabled = false;
  }

  function setBusy(busy) {
    els.previewButton.disabled = busy;
    els.previewLoading.classList.toggle('hidden',!busy);
  }

  async function generatePreview() {
    let payload;
    try {
      payload = buildPayload();
    } catch (error) {
      status(error.message,'error');
      return;
    }

    setBusy(true);
    status('Analisando recorte, resolução e composição...', '');
    try {
      const analysis = await api('/admin/creative-studio/pro/analyze',{
        method:'POST',
        body:JSON.stringify(payload)
      });
      renderQuality(analysis);

      if (contentMode === 'with_price' && !payload.options.showPrice) {
        status('Nenhum preço válido foi preenchido. O Pro mudou automaticamente para uma composição sem preço.', 'ok');
      } else if (analysis?.product?.backgroundRemoved) {
        status('Fundo tratado com segurança. Gerando composição Pro...', 'ok');
      } else {
        status('A foto tem fundo complexo. O Pro preservará a imagem em um painel e marcará o aviso de qualidade.', '');
      }

      const blob = await api('/admin/creative-studio/pro/preview',{
        method:'POST',
        body:JSON.stringify(payload)
      },'blob');
      showPreview(blob);
      status('Prévia Pro concluída. Confira a arte e o controle de qualidade.', 'ok');
    } catch (error) {
      status('Falha ao gerar a prévia Pro: ' + error.message,'error');
    } finally {
      setBusy(false);
    }
  }

  async function saveHighResolution() {
    let payload;
    try {
      payload = buildPayload();
    } catch (error) {
      status(error.message,'error');
      return;
    }

    els.saveButton.disabled = true;
    status('Gerando arquivo final Pro...', '');
    try {
      const blob = await api('/admin/creative-studio/pro/render',{
        method:'POST',
        body:JSON.stringify(payload)
      },'blob');
      const fileName = normalize(els.productName.value || 'banner-ariana-pro').replace(/\s+/g,'-') + '-' + selectedFormat() + '-pro.png';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url),1000);
      status('PNG Pro salvo no dispositivo.', 'ok');
    } catch (error) {
      status('Falha ao salvar: ' + error.message,'error');
    } finally {
      els.saveButton.disabled = !previewBlob;
    }
  }

  function bind() {
    els.productSearch.addEventListener('input',event => renderProductResults(event.target.value));
    els.imageFile.addEventListener('change',event => uploadImage(event.target.files?.[0]));

    document.querySelectorAll('input[name="format"]').forEach(input => input.addEventListener('change',updateChoiceCards));
    document.querySelectorAll('input[name="template-pro"]').forEach(input => input.addEventListener('change',updateChoiceCards));
    document.querySelectorAll('#content-mode button').forEach(button => button.addEventListener('click',() => applyMode(button.dataset.mode)));

    els.fullPrice.addEventListener('input',() => {
      const full = parseMoney(els.fullPrice.value);
      const count = Number(els.installments.value || 12);
      if (full > 0 && count > 0) els.installmentPrice.value = moneyInput(full/count);
    });
    els.installments.addEventListener('change',() => {
      const full = parseMoney(els.fullPrice.value);
      const count = Number(els.installments.value || 12);
      if (full > 0 && count > 0) els.installmentPrice.value = moneyInput(full/count);
    });

    els.previewButton.addEventListener('click',generatePreview);
    els.saveButton.addEventListener('click',saveHighResolution);
  }

  function start() {
    Object.assign(els,{
      productSearch:byId('product-search'),
      productResults:byId('product-results'),
      selectedProduct:byId('selected-product'),
      productName:byId('product-name'),
      imageUrl:byId('image-url'),
      imageFile:byId('image-file'),
      uploadStatus:byId('upload-status'),
      badge:byId('badge'),
      cta:byId('cta'),
      headline:byId('headline'),
      subtitle:byId('subtitle'),
      benefit:byId('benefit'),
      pricingStep:byId('pricing-step'),
      cashPrice:byId('cash-price'),
      fullPrice:byId('full-price'),
      installments:byId('installments'),
      installmentPrice:byId('installment-price'),
      removeBackground:byId('remove-background'),
      previewButton:byId('preview-button'),
      saveButton:byId('save-button'),
      globalStatus:byId('global-status'),
      previewLabel:byId('preview-label'),
      previewSize:byId('preview-size'),
      previewStage:byId('preview-stage'),
      previewEmpty:byId('preview-empty'),
      previewLoading:byId('preview-loading'),
      previewImage:byId('preview-image'),
      qualityScore:byId('quality-score'),
      qualityList:byId('quality-list')
    });

    bind();
    updateChoiceCards();
    applyMode('with_price');
    loadProducts();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start);
  else start();
})();