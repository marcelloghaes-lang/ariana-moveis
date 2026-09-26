(() => {
  'use strict';

  const API = String(window.API_BASE || 'https://ariana-backend.onrender.com/api').replace(/\/+$/, '');
  const els = {};
  let products = [];
  let productsLoading = true;
  let campaignProducts = [];
  let selectedProduct = null;
  let contentMode = 'with_price';
  let previewBlob = null;
  let previewUrl = '';

  const FORMATS = Object.freeze({
    hero_desktop: { label: 'PRÉVIA • HERO DESKTOP', size: '1920 × 480 pixels' },
    hero_mobile: { label: 'PRÉVIA • HERO MOBILE', size: '1080 × 875 pixels' },
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

  function productKey(product = {}) {
    return String(product.id || product._id || imageOf(product) || product.name || product.title || '').trim();
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
    contentMode = ['with_price','no_price','brand_campaign','institutional'].includes(mode) ? mode : 'with_price';
    document.querySelectorAll('#content-mode button').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === contentMode));

    const showPricing = contentMode === 'with_price';
    els.pricingStep.classList.toggle('disabled', !showPricing);
    els.pricingStep.querySelectorAll('input,select').forEach(input => {
      input.disabled = !showPricing;
    });

    if (contentMode === 'brand_campaign') {
      const campaign = document.querySelector('input[name="template-pro"][value="campaign"]');
      if (campaign) campaign.checked = true;
      updateChoiceCards();
      els.badge.value = 'ESPECIAL DE MARCA';
      els.headline.value = els.brandName.value.trim()
        ? 'ESPECIAL ' + els.brandName.value.trim().toUpperCase()
        : 'CAMPANHA ESPECIAL';
      els.cta.value = 'APROVEITAR';
      els.benefitOne.value = '12X NO CARTÃO';
      els.benefitTwo.value = 'OFERTA POR TEMPO LIMITADO';
      status('Campanha de marca ativada. Você pode usar até 4 produtos e uma logo do fabricante.', 'ok');
      return;
    }

    if (contentMode === 'no_price') {
      els.badge.value = 'DESTAQUE ARIANA';
      els.headline.value = 'TECNOLOGIA PARA SUA CASA';
      els.cta.value = 'CONFIRA NO SITE';
      els.benefitOne.value = 'CONDIÇÕES ESPECIAIS';
      els.benefitTwo.value = 'OFERTA POR TEMPO LIMITADO';
      status('Modo sem preço ativado. O banner será reorganizado sem reservar espaço para valor.', 'ok');
      return;
    }

    if (contentMode === 'institutional') {
      els.badge.value = 'CAMPANHA ARIANA';
      els.headline.value = 'PORQUE SUA CASA MERECE O MELHOR';
      els.cta.value = 'CONHEÇA A ARIANA';
      els.benefitOne.value = 'QUALIDADE PARA SUA CASA';
      els.benefitTwo.value = 'COMPRE TAMBÉM PELO SITE';
      status('Modo institucional ativado. Preço e parcelamento não serão usados.', 'ok');
      return;
    }

    els.badge.value = 'OFERTA ARIANA';
    els.headline.value = 'OFERTA IMPERDÍVEL';
    els.cta.value = 'APROVEITE AGORA';
    els.benefitOne.value = '12X NO CARTÃO';
    els.benefitTwo.value = 'OFERTA POR TEMPO LIMITADO';
    status('Modo com preço ativado.', 'ok');
  }

  function renderProductResults(query = '') {
    const normalized = normalize(query);
    if (normalized.length < 2) {
      els.productResults.classList.add('hidden');
      els.productResults.innerHTML = '';
      return;
    }

    if (productsLoading) {
      els.productResults.innerHTML = '<div class="search-message">Carregando catálogo...</div>';
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
            '<em>Adicionar</em>' +
            '</button>';
        }).join('')
      : '<div class="search-message">Nenhum produto encontrado. Você pode preencher manualmente.</div>';

    els.productResults.classList.remove('hidden');
    els.productResults.querySelectorAll('[data-product-id]').forEach(button => {
      button.addEventListener('click', () => {
        const product = products.find(item => String(item.id || item._id || '') === button.dataset.productId);
        if (product) addCampaignProduct(product);
      });
    });
  }

  function syncPrimaryFields(product) {
    selectedProduct = product || null;
    if (!selectedProduct) {
      els.selectedProduct.classList.add('hidden');
      els.selectedProduct.innerHTML = '';
      els.productName.value = '';
      els.imageUrl.value = '';
      return;
    }

    const full = Number(selectedProduct.price || selectedProduct.fullPrice || 0);
    const cash = Number(selectedProduct.pixPrice || selectedProduct.cashPrice || (full ? full * .83 : 0));
    const count = Number(els.installments.value || 12);

    els.productName.value = selectedProduct.name || selectedProduct.title || '';
    els.imageUrl.value = imageOf(selectedProduct);
    if (cash) els.cashPrice.value = moneyInput(cash);
    if (full) els.fullPrice.value = moneyInput(full);
    if (full) els.installmentPrice.value = moneyInput(full / count);
    if (!els.brandName.value.trim() && selectedProduct.brand) els.brandName.value = selectedProduct.brand;

    els.selectedProduct.innerHTML =
      '<img src="' + escapeHtml(imageOf(selectedProduct)) + '" alt="">' +
      '<div><b>Produto principal</b><span>' + escapeHtml(selectedProduct.name || selectedProduct.title || 'Produto') + '</span></div>' +
      '<button type="button" id="clear-primary">Remover principal</button>';
    els.selectedProduct.classList.remove('hidden');

    byId('clear-primary')?.addEventListener('click', () => {
      if (campaignProducts.length) removeCampaignProduct(0);
    });
  }

  function renderCampaignProducts() {
    els.campaignCount.textContent = campaignProducts.length + '/4';

    if (!campaignProducts.length) {
      els.campaignProducts.innerHTML = '<div class="campaign-products-empty">Selecione um produto no catálogo para começar.</div>';
      syncPrimaryFields(null);
      return;
    }

    els.campaignProducts.innerHTML = campaignProducts.map((product,index) =>
      '<article class="campaign-product ' + (index === 0 ? 'primary' : '') + '">' +
      '<img src="' + escapeHtml(imageOf(product)) + '" alt="">' +
      '<div><b>' + escapeHtml(product.name || product.title || 'Produto') + '</b>' +
      '<small>' + (index === 0 ? 'Principal • preço e texto' : 'Produto adicional') + '</small></div>' +
      '<div class="campaign-product-actions">' +
      (index === 0 ? '<span class="primary-tag">Principal</span>' : '<button type="button" data-primary="' + index + '">Tornar principal</button>') +
      '<button type="button" class="remove-product" data-remove="' + index + '">×</button>' +
      '</div></article>'
    ).join('');

    els.campaignProducts.querySelectorAll('[data-primary]').forEach(button => {
      button.addEventListener('click', () => setPrimaryProduct(Number(button.dataset.primary)));
    });
    els.campaignProducts.querySelectorAll('[data-remove]').forEach(button => {
      button.addEventListener('click', () => removeCampaignProduct(Number(button.dataset.remove)));
    });

    syncPrimaryFields(campaignProducts[0]);
  }

  function addCampaignProduct(product) {
    const key = productKey(product);
    const existing = campaignProducts.findIndex(item => productKey(item) === key);

    if (existing >= 0) {
      setPrimaryProduct(existing);
      els.productResults.classList.add('hidden');
      status('Esse produto já estava na campanha e agora é o principal.', 'ok');
      return;
    }

    if (campaignProducts.length >= 4) {
      status('A campanha já tem 4 produtos. Remova um antes de adicionar outro.', 'error');
      return;
    }

    campaignProducts.push(product);
    renderCampaignProducts();
    els.productSearch.value = '';
    els.productResults.classList.add('hidden');

    if (campaignProducts.length > 1 && contentMode !== 'brand_campaign') {
      applyMode('brand_campaign');
    }

    status(
      campaignProducts.length === 1
        ? 'Produto principal carregado.'
        : 'Produto adicionado à campanha. Agora são ' + campaignProducts.length + ' produtos.',
      'ok'
    );
  }

  function setPrimaryProduct(index) {
    if (!Number.isInteger(index) || index < 0 || index >= campaignProducts.length) return;
    const [product] = campaignProducts.splice(index,1);
    campaignProducts.unshift(product);
    renderCampaignProducts();
    status('Produto principal atualizado.', 'ok');
  }

  function removeCampaignProduct(index) {
    if (!Number.isInteger(index) || index < 0 || index >= campaignProducts.length) return;
    campaignProducts.splice(index,1);
    renderCampaignProducts();
    status('Produto removido da campanha.', 'ok');
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

  async function uploadFile(file, folder) {
    if (!file) return '';
    if (file.size > 20 * 1024 * 1024) throw new Error('A imagem ultrapassa 20 MB.');
    const form = new FormData();
    form.append('file',file);
    form.append('folder',folder);
    const data = await api('/admin/uploads',{method:'POST',body:form});
    const uploaded = Array.isArray(data?.files) ? data.files[0] : (data?.file || data);
    const url = uploaded?.url || uploaded?.secure_url || uploaded?.imageUrl || data?.url;
    if (!url) throw new Error('O servidor não devolveu a URL da imagem.');
    return url;
  }

  async function uploadProductImage(file) {
    if (!file) return;
    els.uploadStatus.textContent = 'Enviando imagem...';
    els.uploadStatus.className = 'inline-status full';
    try {
      const url = await uploadFile(file,'marketing/creative-studio-pro/produtos');
      els.imageUrl.value = url;
      if (campaignProducts[0]) {
        campaignProducts[0] = { ...campaignProducts[0], imageUrl:url };
        renderCampaignProducts();
      }
      els.uploadStatus.textContent = 'Imagem enviada. O recorte será analisado na prévia.';
      els.uploadStatus.className = 'inline-status full ok';
    } catch (error) {
      els.uploadStatus.textContent = error.message;
      els.uploadStatus.className = 'inline-status full error';
    }
  }

  async function uploadBrandLogo(file) {
    if (!file) return;
    els.brandUploadStatus.textContent = 'Enviando logo...';
    els.brandUploadStatus.className = 'inline-status full';
    try {
      const url = await uploadFile(file,'marketing/creative-studio-pro/marcas');
      els.brandLogoUrl.value = url;
      els.brandUploadStatus.textContent = 'Logo da marca enviada e pronta para a campanha.';
      els.brandUploadStatus.className = 'inline-status full ok';
    } catch (error) {
      els.brandUploadStatus.textContent = error.message;
      els.brandUploadStatus.className = 'inline-status full error';
    }
  }

  function compactCampaignProduct(product = {}, index = 0) {
    if (index === 0) {
      return {
        ...(product || {}),
        id: String(product?.id || product?._id || ''),
        name: els.productName.value.trim() || product?.name || product?.title || 'Produto Ariana Móveis',
        imageUrl: els.imageUrl.value.trim() || imageOf(product),
        brand: els.brandName.value.trim() || product?.brand || '',
        category: product?.category || product?.categoryName || ''
      };
    }

    return {
      id: String(product?.id || product?._id || ''),
      name: product?.name || product?.title || 'Produto Ariana Móveis',
      imageUrl: imageOf(product),
      brand: product?.brand || '',
      category: product?.category || product?.categoryName || '',
      cashPrice: Number(product?.pixPrice || product?.cashPrice || product?.price || 0),
      fullPrice: Number(product?.price || product?.fullPrice || 0)
    };
  }

  function buildPayload() {
    const manualName = els.productName.value.trim();
    const manualImage = els.imageUrl.value.trim();

    if (!campaignProducts.length && (!manualName || !manualImage)) {
      throw new Error('Selecione pelo menos um produto ou preencha nome e imagem.');
    }

    const sourceProducts = campaignProducts.length
      ? campaignProducts
      : [{ name:manualName, imageUrl:manualImage, brand:els.brandName.value.trim() }];

    const prepared = sourceProducts.slice(0,4).map((product,index) => compactCampaignProduct(product,index));
    const primary = prepared[0];

    if (!primary.name) throw new Error('Informe o nome do produto principal.');
    if (!primary.imageUrl) throw new Error('Selecione ou envie a imagem do produto principal.');

    const cashPrice = parseMoney(els.cashPrice.value);
    const fullPrice = parseMoney(els.fullPrice.value);
    const count = Number(els.installments.value || 12);
    const installmentPrice = parseMoney(els.installmentPrice.value) || (fullPrice > 0 ? fullPrice / count : 0);
    const showPrice = contentMode === 'with_price' && cashPrice > 0;

    const product = {
      ...primary,
      cashPrice,
      fullPrice,
      pixPrice: cashPrice,
      price: fullPrice || cashPrice,
      installmentCount: count,
      installmentPrice
    };

    return {
      productId: String(product.id || ''),
      product,
      options: {
        products: prepared,
        outputFormat: selectedFormat(),
        templatePro: selectedTemplate(),
        contentMode,
        showPrice,
        headline: els.headline.value.trim(),
        subtitle: els.subtitle.value.trim(),
        benefit: els.benefit.value.trim(),
        badge: els.badge.value.trim(),
        cta: els.cta.value.trim(),
        brandName: els.brandName.value.trim(),
        brandLogoUrl: els.brandLogoUrl.value.trim(),
        promoCode: els.promoCode.value.trim(),
        benefitOne: els.benefitOne.value.trim(),
        benefitTwo: els.benefitTwo.value.trim(),
        productName: product.name,
        imageUrl: product.imageUrl,
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
    status('Analisando recortes, resolução e composição da campanha...', '');
    try {
      const analysis = await api('/admin/creative-studio/pro/analyze',{
        method:'POST',
        body:JSON.stringify(payload)
      });
      renderQuality(analysis);

      const blob = await api('/admin/creative-studio/pro/preview',{
        method:'POST',
        body:JSON.stringify(payload)
      },'blob');
      showPreview(blob);

      const productText = analysis.productCount > 1 ? analysis.productCount + ' produtos' : '1 produto';
      status('Prévia Pro V2 concluída com ' + productText + '. Confira a arte no tamanho correto.', 'ok');
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
    status('Gerando arquivo final Pro V2...', '');
    try {
      const blob = await api('/admin/creative-studio/pro/render',{
        method:'POST',
        body:JSON.stringify(payload)
      },'blob');
      const fileName = normalize(els.productName.value || 'banner-ariana-pro').replace(/\s+/g,'-') + '-' + selectedFormat() + '-pro-v2.png';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url),1000);
      status('PNG Pro V2 salvo no dispositivo.', 'ok');
    } catch (error) {
      status('Falha ao salvar: ' + error.message,'error');
    } finally {
      els.saveButton.disabled = !previewBlob;
    }
  }

  function bind() {
    els.productSearch.addEventListener('input',event => renderProductResults(event.target.value));
    els.imageFile.addEventListener('change',event => uploadProductImage(event.target.files?.[0]));
    els.brandLogoFile.addEventListener('change',event => uploadBrandLogo(event.target.files?.[0]));

    document.querySelectorAll('input[name="format"]').forEach(input => input.addEventListener('change',updateChoiceCards));
    document.querySelectorAll('input[name="template-pro"]').forEach(input => input.addEventListener('change',updateChoiceCards));
    document.querySelectorAll('#content-mode button').forEach(button => button.addEventListener('click',() => applyMode(button.dataset.mode)));

    els.brandName.addEventListener('input',() => {
      if (contentMode === 'brand_campaign' && els.brandName.value.trim()) {
        els.headline.value = 'ESPECIAL ' + els.brandName.value.trim().toUpperCase();
      }
    });

    els.fullPrice.addEventListener('input',() => {
      const full = parseMoney(els.fullPrice.value);
      const count = Number(els.installments.value || 12);
      if (full > 0 && count > 0) els.installmentPrice.value = moneyInput(full/count);
    });
    els.installments.addEventListener('change',() => {
      const full = parseMoney(els.fullPrice.value);
      const count = Number(els.installments.value || 12);
      if (full > 0 && count > 0) els.installmentPrice.value = moneyInput(full/count);
      if (!els.benefitOne.value.trim() || /^\d+X NO CARTÃO$/i.test(els.benefitOne.value.trim())) {
        els.benefitOne.value = count + 'X NO CARTÃO';
      }
    });

    els.previewButton.addEventListener('click',generatePreview);
    els.saveButton.addEventListener('click',saveHighResolution);
  }

  function start() {
    Object.assign(els,{
      productSearch:byId('product-search'),
      productResults:byId('product-results'),
      selectedProduct:byId('selected-product'),
      campaignProducts:byId('campaign-products'),
      campaignCount:byId('campaign-count'),
      productName:byId('product-name'),
      imageUrl:byId('image-url'),
      imageFile:byId('image-file'),
      uploadStatus:byId('upload-status'),
      badge:byId('badge'),
      cta:byId('cta'),
      brandName:byId('brand-name'),
      brandLogoUrl:byId('brand-logo-url'),
      brandLogoFile:byId('brand-logo-file'),
      brandUploadStatus:byId('brand-upload-status'),
      promoCode:byId('promo-code'),
      benefitOne:byId('benefit-one'),
      benefitTwo:byId('benefit-two'),
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
    renderCampaignProducts();
    loadProducts();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start);
  else start();
})();