(() => {
  'use strict';

  const API = String(window.API_BASE || 'https://ariana-backend.onrender.com/api').replace(/\/+$/, '');
  const els = {};
  let products = [];
  let productsLoading = true;
  let selectedProduct = null;
  let selectedProducts = [];
  let heroSlots = [null, null, null];
  let activeHeroSlot = -1;
  let contentMode = 'with_price';
  let previewBlob = null;
  let previewUrl = '';
  let qualityAllowsSave = false;
  let autoHeroActive = false;
  let catalogReadyPromise = null;
  let copyTouched = false;

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

  function setCopyValues(values = {}, { force = false } = {}) {
    if (copyTouched && !force) return;
    if (values.badge !== undefined) els.badge.value = values.badge;
    if (values.headline !== undefined) els.headline.value = values.headline;
    if (values.subtitle !== undefined) els.subtitle.value = values.subtitle;
    if (values.cta !== undefined) els.cta.value = values.cta;
    els.benefit.value = '';
  }

  function applyMode(mode) {
    contentMode = ['with_price','no_price','institutional','multi_product'].includes(mode) ? mode : 'with_price';
    document.querySelectorAll('#content-mode button').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === contentMode));

    const multi = contentMode === 'multi_product';
    const showPricing = contentMode === 'with_price';
    els.pricingStep.classList.toggle('disabled', !showPricing);
    els.pricingStep.querySelectorAll('input,select').forEach(input => {
      input.disabled = !showPricing;
    });
    els.multiProductHint?.classList.toggle('hidden', !multi);
    els.singleProductFields?.classList.toggle('hidden', multi);

    if (multi) {
      const campaign = document.querySelector('input[name="template-pro"][value="campaign"]');
      if (campaign) {
        campaign.checked = true;
        updateChoiceCards();
      }
      setCopyValues({
        badge:'SELEÇÃO ARIANA',
        headline:'GRANDES MARCAS PARA SUA CASA',
        subtitle:'Produtos e fabricantes que combinam com a sua casa.',
        cta:'CONHEÇA A SELEÇÃO'
      });
      els.promoText.value = '';
      renderSelectedProducts();
      status('Modo multi-produto ativado. Escolha os produtos e depois ajuste os textos na ordem em que aparecem no banner.', 'ok');
    } else if (contentMode === 'no_price') {
      setCopyValues({
        badge:'SELEÇÃO ARIANA',
        headline:'TECNOLOGIA PARA SUA CASA',
        subtitle:'Produtos para transformar o seu dia a dia.',
        cta:'CONHEÇA A SELEÇÃO'
      });
      els.promoText.value = '';
      renderSelectedProducts();
      status('Modo sem preço ativado. O banner prioriza apresentação de produto e fabricante.', 'ok');
    } else if (contentMode === 'institutional') {
      setCopyValues({
        badge:'ARIANA MÓVEIS',
        headline:'PORQUE SUA CASA MERECE O MELHOR',
        subtitle:'Móveis, eletro e tecnologia para o seu lar.',
        cta:'CONHEÇA A ARIANA'
      });
      els.promoText.value = '';
      renderSelectedProducts();
      status('Modo institucional ativado. Preço e parcelamento não serão usados.', 'ok');
    } else {
      setCopyValues({
        badge:'OFERTA ARIANA',
        headline:'OFERTA IMPERDÍVEL',
        subtitle:'',
        cta:'APROVEITE AGORA'
      });
      renderSelectedProducts();
      status('Modo com preço ativado. As informações promocionais continuam opcionais.', 'ok');
    }
  }



  function heroSlotProducts() {
    return heroSlots.filter(Boolean);
  }

  function syncHeroSlotsToSelectedProducts() {
    selectedProducts = heroSlotProducts();
    selectedProduct = selectedProducts[0] || null;
  }

  function updateHeroButtonState() {
    if (!els.autoHeroButton) return;
    const chosen = heroSlotProducts().length;
    const canUseChosen = chosen === 3;
    const canAutoCatalog = !productsLoading && products.filter(professionalCandidate).length >= 3;

    els.autoHeroButton.disabled = !(canUseChosen || canAutoCatalog) || (productsLoading && !canUseChosen);
    if (productsLoading && !canUseChosen) {
      els.autoHeroButton.textContent = 'Carregando catálogo...';
    } else if (canUseChosen) {
      els.autoHeroButton.textContent = 'Montar campanha com os 3 escolhidos';
    } else if (canAutoCatalog) {
      els.autoHeroButton.textContent = 'Preencher 3 produtos automaticamente';
    } else {
      els.autoHeroButton.textContent = 'Escolha ou envie 3 produtos';
    }
  }

  function renderHeroSlots() {
    heroSlots.forEach((product,index) => {
      const card = byId('hero-slot-' + index);
      const img = byId('hero-slot-image-' + index);
      const placeholder = byId('hero-slot-placeholder-' + index);
      const name = byId('hero-slot-name-' + index);
      const source = byId('hero-slot-source-' + index);
      if (!card || !img || !placeholder || !name || !source) return;

      const filled = Boolean(product && imageOf(product));
      card.classList.toggle('filled', filled);
      card.classList.toggle('active', activeHeroSlot === index);
      const clear = card.querySelector('[data-hero-clear-slot]');
      if (clear) clear.classList.toggle('hidden', !filled);

      if (filled) {
        img.src = imageOf(product);
        img.classList.remove('hidden');
        placeholder.classList.add('hidden');
        name.textContent = product.name || product.title || (index === 0 ? 'Produto principal' : 'Produto de apoio ' + index);
        source.textContent = product.__heroUploaded
          ? 'Imagem enviada'
          : (product.brand || product.categoryName || product.category || 'Produto do catálogo');
      } else {
        img.removeAttribute('src');
        img.classList.add('hidden');
        placeholder.classList.remove('hidden');
        placeholder.textContent = index === 0 ? 'PRINCIPAL' : 'APOIO ' + index;
        name.textContent = index === 0 ? 'Produto principal' : 'Produto de apoio ' + index;
        source.textContent = 'Nenhuma imagem selecionada';
      }
    });

    if (els.heroPickerCount) els.heroPickerCount.textContent = heroSlotProducts().length + '/3';
    syncHeroSlotsToSelectedProducts();
    updateHeroButtonState();
  }

  function setHeroSlot(index, product) {
    const slot = Number(index);
    if (!Number.isInteger(slot) || slot < 0 || slot > 2 || !product) return;
    heroSlots[slot] = product;
    activeHeroSlot = -1;
    renderHeroSlots();
    qualityAllowsSave = false;
    els.saveButton.disabled = true;
    previewBlob = null;
  }

  function clearHeroSlot(index) {
    const slot = Number(index);
    if (!Number.isInteger(slot) || slot < 0 || slot > 2) return;
    heroSlots[slot] = null;
    if (activeHeroSlot === slot) activeHeroSlot = -1;
    renderHeroSlots();
    qualityAllowsSave = false;
    els.saveButton.disabled = true;
  }

  function chooseCatalogForHeroSlot(index) {
    activeHeroSlot = Number(index);
    renderHeroSlots();
    els.productSearch.value = '';
    els.productSearch.placeholder = (activeHeroSlot === 0 ? 'Busque o produto principal...' : 'Busque o produto de apoio ' + activeHeroSlot + '...');
    if (els.productSearchLabel) {
      els.productSearchLabel.textContent = activeHeroSlot === 0
        ? 'Escolher produto principal no catálogo'
        : 'Escolher produto de apoio ' + activeHeroSlot + ' no catálogo';
    }
    status('Digite o nome do produto e toque no resultado para preencher este espaço.', 'ok');
    els.productSearch.focus();
    if (window.innerWidth < 800) {
      setTimeout(() => els.productSearch.scrollIntoView({ behavior:'smooth', block:'center' }), 80);
    }
  }

  async function uploadHeroSlot(file, index) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      status('A imagem ultrapassa 20 MB.', 'error');
      return;
    }

    const slot = Number(index);
    const card = byId('hero-slot-' + slot);
    card?.classList.add('active');
    status('Enviando imagem do ' + (slot === 0 ? 'produto principal' : 'produto de apoio ' + slot) + '...', '');

    try {
      const form = new FormData();
      form.append('file', file);
      form.append('folder', 'marketing/creative-studio-pro/hero-produtos');
      const data = await api('/admin/uploads', { method:'POST', body:form });
      const uploaded = Array.isArray(data?.files) ? data.files[0] : (data?.file || data);
      const url = uploaded?.url || uploaded?.secure_url || uploaded?.imageUrl || data?.url;
      if (!url) throw new Error('O servidor não devolveu a URL da imagem.');

      const cleanName = String(file.name || 'Produto')
        .replace(/\.[a-z0-9]+$/i,'')
        .replace(/[_-]+/g,' ')
        .trim() || 'Produto';

      setHeroSlot(slot, {
        id: 'hero-upload-' + Date.now() + '-' + slot,
        name: cleanName,
        imageUrl: url,
        category: 'Campanha',
        __heroUploaded: true
      });
      status('Imagem adicionada. ' + heroSlotProducts().length + ' de 3 produtos preenchidos.', 'ok');
    } catch (error) {
      status('Falha ao enviar imagem: ' + error.message, 'error');
    } finally {
      card?.classList.remove('active');
      const input = document.querySelector('[data-hero-upload-slot="' + slot + '"]');
      if (input) input.value = '';
    }
  }

  function productStock(product = {}) {
    const candidates = [
      product.stock,
      product.stockQuantity,
      product.quantity,
      product.estoque,
      product.inventory,
      product.availableQuantity
    ];
    for (const value of candidates) {
      if (value === null || value === undefined || value === '') continue;
      const number = Number(value);
      if (Number.isFinite(number)) return number;
    }
    return null;
  }

  function productGroup(product = {}) {
    const haystack = normalize([
      product.categoryName, product.category, product.name, product.title
    ].filter(Boolean).join(' '));

    const groups = [
      ['geladeira','geladeira'],
      ['refrigerador','geladeira'],
      ['lavadora','lavadora'],
      ['lava e seca','lavadora'],
      ['maquina de lavar','lavadora'],
      ['micro ondas','microondas'],
      ['microondas','microondas'],
      ['tv','tv'],
      ['televisor','tv'],
      ['smart tv','tv'],
      ['caixa de som','audio'],
      ['amplificada','audio'],
      ['ventilador','climatizacao'],
      ['climatizador','climatizacao'],
      ['ar condicionado','climatizacao'],
      ['guarda roupa','moveis'],
      ['roupeiro','moveis'],
      ['sofa','moveis'],
      ['mesa','moveis'],
      ['colchao','moveis']
    ];
    for (const [needle, group] of groups) {
      if (haystack.includes(needle)) return group;
    }
    return normalize(product.categoryName || product.category || '').split(' ')[0] || 'outros';
  }

  function professionalCandidate(product = {}) {
    const image = imageOf(product);
    if (!image) return false;
    const stock = productStock(product);
    if (stock !== null && stock <= 0) return false;
    const price = Number(product.pixPrice || product.cashPrice || product.price || product.fullPrice || 0);
    return price > 0 || Boolean(product.name || product.title);
  }

  function autoHeroProducts() {
    const pool = products.filter(professionalCandidate);
    if (pool.length < 3) throw new Error('O catálogo precisa ter pelo menos 3 produtos com imagem disponível para montar o Hero automático.');

    const already = activeHeroSlot < 0 && selectedProduct && professionalCandidate(selectedProduct) ? selectedProduct : null;
    const picks = [];
    const usedIds = new Set();
    const usedGroups = new Set();

    function add(product) {
      if (!product || picks.length >= 3) return false;
      const id = String(product.id || product._id || product.name || '');
      if (usedIds.has(id)) return false;
      picks.push(product);
      usedIds.add(id);
      usedGroups.add(productGroup(product));
      return true;
    }

    add(already);

    for (const product of pool) {
      if (picks.length >= 3) break;
      if (!usedGroups.has(productGroup(product))) add(product);
    }
    for (const product of pool) {
      if (picks.length >= 3) break;
      add(product);
    }

    if (picks.length < 3) throw new Error('Não encontrei 3 produtos diferentes com imagem para a campanha.');
    return picks;
  }

  function configureAutoHeroCopy(rows = []) {
    const brands = rows.map(item => String(item.brand || item.brandName || '').trim()).filter(Boolean);
    const sameBrand = brands.length === rows.length && new Set(brands.map(normalize)).size === 1;
    const groups = rows.map(productGroup);
    const sameGroup = new Set(groups).size === 1;

    els.couponText.value = '';
    els.promoText.value = '';

    if (sameBrand) {
      els.brandLabel.value = brands[0].toUpperCase();
      const logo = rows.find(item => item.brandLogoUrl)?.brandLogoUrl || '';
      if (logo && !els.brandLogoUrl.value.trim()) els.brandLogoUrl.value = logo;
      setCopyValues({
        badge: brands[0].toUpperCase(),
        headline: 'ESPECIAL ' + brands[0].toUpperCase(),
        subtitle: 'Tecnologia, design e praticidade para sua casa.',
        cta: 'CONHEÇA A SELEÇÃO'
      });
      return;
    }

    els.brandLabel.value = '';
    const groupTitles = {
      tv: 'SMART TVS & ENTRETENIMENTO',
      audio: 'SOM PARA TODOS OS MOMENTOS',
      climatizacao: 'CONFORTO PARA SUA CASA',
      geladeira: 'SOLUÇÕES PARA SUA COZINHA',
      lavadora: 'PRATICIDADE PARA SUA ROTINA',
      microondas: 'PRATICIDADE NA COZINHA',
      moveis: 'MÓVEIS PARA TRANSFORMAR SUA CASA'
    };

    setCopyValues({
      badge: 'SELEÇÃO ARIANA',
      headline: sameGroup
        ? (groupTitles[groups[0]] || 'SELEÇÃO ESPECIAL PARA SUA CASA')
        : 'GRANDES MARCAS PARA SUA CASA',
      subtitle: sameGroup
        ? 'Uma seleção pensada para o seu dia a dia.'
        : 'Produtos e fabricantes que combinam com a sua casa.',
      cta: 'CONHEÇA A SELEÇÃO'
    });
  }

  async function buildProfessionalHero() {
    const button = els.autoHeroButton;

    try {
      if (button) {
        button.disabled = true;
        button.textContent = 'Montando 3 produtos...';
      }

      let rows = heroSlotProducts();

      if (rows.length !== 3) {
        if (productsLoading && catalogReadyPromise) {
          status('Carregando o catálogo para completar os produtos...', '');
          await catalogReadyPromise;
        }

        rows = heroSlotProducts();
        if (rows.length !== 3) {
          const automatic = autoHeroProducts();
          heroSlots = automatic.slice(0,3);
          renderHeroSlots();
          rows = heroSlotProducts();
        }
      }

      if (rows.length !== 3) {
        throw new Error('Escolha ou envie exatamente 3 produtos para montar o Hero.');
      }

      autoHeroActive = true;
      selectedProducts = rows.slice(0,3);
      selectedProduct = selectedProducts[0];

      applyMode('multi_product');
      configureAutoHeroCopy(selectedProducts);

      const campaign = document.querySelector('input[name="template-pro"][value="campaign"]');
      if (campaign) campaign.checked = true;
      updateChoiceCards();
      renderHeroSlots();

      previewBlob = null;
      qualityAllowsSave = false;
      els.saveButton.disabled = true;
      els.previewImage.classList.add('hidden');
      els.previewEmpty.classList.remove('hidden');
      const previewText = els.previewEmpty.querySelector('strong');
      if (previewText) previewText.textContent = 'Montando campanha profissional com 3 produtos...';

      if (button) button.textContent = 'Gerando prévia...';
      status('Os 3 produtos estão definidos. Validando recortes e gerando a campanha...', 'ok');
      await generatePreview();

      if (els.previewStage) {
        setTimeout(() => els.previewStage.scrollIntoView({ behavior:'smooth', block:'center' }), 150);
      }
    } catch (error) {
      autoHeroActive = false;
      status(error.message || 'Não foi possível montar a campanha automática.', 'error');
    } finally {
      renderHeroSlots();
    }
  }

  function repairAutoHeroSelection(analysis) {
    if (!autoHeroActive || contentMode !== 'multi_product') return false;
    const rows = Array.isArray(analysis?.products) ? analysis.products : [];
    const badIndexes = rows
      .filter(item => !item.cutoutSafe || Math.max(Number(item.sourceWidth || 0), Number(item.sourceHeight || 0)) < 700)
      .map(item => Number(item.index))
      .filter(Number.isInteger);

    if (!badIndexes.length) return false;

    const usedIds = new Set(selectedProducts.map(item => String(item.id || item._id || item.name || '')));
    const usedGroups = new Set(selectedProducts.map(productGroup));
    let changed = false;

    for (const index of badIndexes) {
      let replacement = products.find(item => {
        if (!professionalCandidate(item)) return false;
        const id = String(item.id || item._id || item.name || '');
        return !usedIds.has(id) && !usedGroups.has(productGroup(item));
      });
      if (!replacement) {
        replacement = products.find(item => {
          if (!professionalCandidate(item)) return false;
          const id = String(item.id || item._id || item.name || '');
          return !usedIds.has(id);
        });
      }
      if (!replacement) continue;

      const old = selectedProducts[index];
      if (old) usedIds.delete(String(old.id || old._id || old.name || ''));
      selectedProducts[index] = replacement;
      usedIds.add(String(replacement.id || replacement._id || replacement.name || ''));
      usedGroups.add(productGroup(replacement));
      changed = true;
    }

    if (changed) {
      selectedProduct = selectedProducts[0] || null;
      heroSlots = [selectedProducts[0] || null, selectedProducts[1] || null, selectedProducts[2] || null];
      configureAutoHeroCopy(selectedProducts);
      renderHeroSlots();
      renderSelectedProducts();
    }
    return changed;
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

  function compactCatalogProduct(product = {}) {
    const full = Number(product.price || product.fullPrice || 0);
    const cash = Number(product.pixPrice || product.cashPrice || (full ? full * .83 : 0));
    const count = Number(els.installments?.value || 12);
    return {
      id: String(product.id || product._id || ''),
      name: product.name || product.title || 'Produto',
      imageUrl: imageOf(product),
      brand: product.brand || product.brandName || '',
      category: product.category || product.categoryName || '',
      cashPrice: cash,
      fullPrice: full,
      installmentCount: count,
      installmentPrice: full > 0 && count > 0 ? full / count : 0
    };
  }

  function renderSelectedProducts() {
    if (contentMode === 'multi_product') {
      if (heroSlotProducts().length) {
        els.selectedProduct.classList.add('hidden');
        els.selectedProduct.innerHTML = '';
        return;
      }
      if (!selectedProducts.length) {
        els.selectedProduct.classList.add('hidden');
        els.selectedProduct.innerHTML = '';
        return;
      }
      els.selectedProduct.classList.remove('hidden');
      els.selectedProduct.classList.add('multi-selected-products');
      els.selectedProduct.innerHTML =
        '<div class="multi-selected-head"><b>Produtos da campanha</b><span>' + selectedProducts.length + '/5 selecionados</span></div>' +
        '<div class="multi-selected-grid">' +
        selectedProducts.map((product,index) =>
          '<article class="multi-selected-item">' +
          '<img src="' + escapeHtml(imageOf(product)) + '" alt="">' +
          '<div><b>' + escapeHtml(product.name || 'Produto') + '</b><small>' + escapeHtml(product.brand || product.categoryName || product.category || '') + '</small></div>' +
          '<button type="button" data-remove-product="' + index + '" aria-label="Remover produto">×</button>' +
          '</article>'
        ).join('') +
        '</div>' +
        (selectedProducts.length < 2 ? '<small class="multi-warning">Selecione pelo menos mais ' + (2-selectedProducts.length) + ' produto.</small>' : '');

      els.selectedProduct.querySelectorAll('[data-remove-product]').forEach(button => {
        button.addEventListener('click', () => {
          selectedProducts.splice(Number(button.dataset.removeProduct),1);
          selectedProduct = selectedProducts[0] || null;
          renderSelectedProducts();
          qualityAllowsSave = false;
          els.saveButton.disabled = true;
        });
      });
      return;
    }

    els.selectedProduct.classList.remove('multi-selected-products');
    if (!selectedProduct) {
      els.selectedProduct.classList.add('hidden');
      els.selectedProduct.innerHTML = '';
      return;
    }

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
  }

  function selectProduct(product) {
    if (!product) return;
    autoHeroActive = false;

    if (activeHeroSlot >= 0) {
      const slot = activeHeroSlot;
      setHeroSlot(slot, product);
      els.productSearch.value = '';
      els.productResults.classList.add('hidden');
      els.productSearch.placeholder = 'Primeiro escolha um espaço acima, depois digite nome, marca ou código';
      if (els.productSearchLabel) els.productSearchLabel.textContent = 'Buscar produto cadastrado';
      status('Produto adicionado ao espaço ' + (slot + 1) + '. ' + heroSlotProducts().length + ' de 3 preenchidos.', 'ok');
      return;
    }

    if (contentMode === 'multi_product') {
      const id = String(product.id || product._id || '');
      const exists = selectedProducts.some(item => String(item.id || item._id || '') === id && id);
      if (exists) {
        status('Esse produto já está na campanha.', '');
        els.productResults.classList.add('hidden');
        els.productSearch.value = '';
        return;
      }
      if (selectedProducts.length >= 5) {
        status('A campanha multi-produto aceita no máximo 5 produtos.', 'error');
        return;
      }
      selectedProducts.push(product);
      selectedProduct = selectedProducts[0] || product;
      if (!els.brandLabel.value.trim() && product.brand) els.brandLabel.value = product.brand;
      els.productSearch.value = '';
      els.productResults.classList.add('hidden');
      renderSelectedProducts();
      qualityAllowsSave = false;
      els.saveButton.disabled = true;
      status(selectedProducts.length < 2
        ? 'Primeiro produto adicionado. Escolha pelo menos mais um.'
        : selectedProducts.length + ' produtos selecionados. Você já pode gerar a campanha.', 'ok');
      return;
    }

    selectedProduct = product;
    const compact = compactCatalogProduct(product);
    els.productName.value = compact.name;
    els.imageUrl.value = compact.imageUrl;
    if (compact.brand && !els.brandLabel.value.trim()) els.brandLabel.value = compact.brand;
    if (product.brandLogoUrl && !els.brandLogoUrl.value.trim()) els.brandLogoUrl.value = product.brandLogoUrl;
    if (compact.cashPrice) els.cashPrice.value = moneyInput(compact.cashPrice);
    if (compact.fullPrice) els.fullPrice.value = moneyInput(compact.fullPrice);
    if (compact.fullPrice) els.installmentPrice.value = moneyInput(compact.installmentPrice);
    els.productSearch.value = product.name || '';
    els.productResults.classList.add('hidden');
    renderSelectedProducts();
    status('Produto carregado. O Pro vai analisar a imagem antes de montar a campanha.', 'ok');
  }

  async function loadProducts() {
    productsLoading = true;
    if (els.autoHeroButton) {
      els.autoHeroButton.disabled = true;
      els.autoHeroButton.textContent = 'Carregando catálogo...';
    }

    const extractRows = data => Array.isArray(data)
      ? data
      : (data?.products || data?.items || data?.docs || data?.results || data?.data || data?.rows || []);

    const fetchWithTimeout = async (path, timeoutMs = 9000) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await api(path, { signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    };

    try {
      let data = null;
      try {
        data = await fetchWithTimeout('/admin/products?sortBy=updatedAt&sortDir=desc&limit=250');
      } catch {}

      products = extractRows(data);

      if (products.length < 3) {
        const fallback = await fetchWithTimeout('/products?limit=250&sortBy=updatedAt&sortDir=desc');
        products = extractRows(fallback);
      }

      products = products.filter(product => product && (product.name || product.title));
      status('Catálogo carregado: ' + products.length + ' produto(s).', products.length ? 'ok' : '');
      return products;
    } catch (error) {
      products = [];
      const message = error?.name === 'AbortError'
        ? 'O catálogo demorou demais para responder.'
        : ('Não consegui carregar o catálogo: ' + error.message + '.');
      status(message + ' Você ainda pode preencher manualmente.', 'error');
      return products;
    } finally {
      productsLoading = false;
      updateHeroButtonState();
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

  async function uploadBrandLogo(file) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      els.brandLogoStatus.textContent = 'A logo ultrapassa 10 MB.';
      els.brandLogoStatus.className = 'inline-status full error';
      return;
    }

    els.brandLogoStatus.textContent = 'Enviando logo do fabricante...';
    els.brandLogoStatus.className = 'inline-status full';
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('folder', 'marketing/creative-studio-pro/marcas');
      const data = await api('/admin/uploads', { method:'POST', body:form });
      const uploaded = Array.isArray(data?.files) ? data.files[0] : (data?.file || data);
      const url = uploaded?.url || uploaded?.secure_url || uploaded?.imageUrl || data?.url;
      if (!url) throw new Error('O servidor não devolveu a URL da logo.');
      els.brandLogoUrl.value = url;
      els.brandLogoStatus.textContent = 'Logo enviada. O Studio vai remover fundo simples e validar antes de salvar.';
      els.brandLogoStatus.className = 'inline-status full ok';
      qualityAllowsSave = false;
      els.saveButton.disabled = true;
    } catch (error) {
      els.brandLogoStatus.textContent = error.message;
      els.brandLogoStatus.className = 'inline-status full error';
    }
  }

  function editorCopyPayload() {
    return {
      badge: els.badge.value.trim(),
      headline: els.headline.value.trim(),
      subtitle: els.subtitle.value.trim(),
      cta: els.cta.value.trim()
    };
  }

  function buildPayload() {
    const multi = contentMode === 'multi_product';
    const manualCopy = editorCopyPayload();

    if (multi) {
      if (selectedProducts.length < 2) throw new Error('Selecione pelo menos 2 produtos para a campanha multi-produto.');
      const rows = selectedProducts.slice(0,5).map(compactCatalogProduct);
      const first = rows[0];
      return {
        products: rows,
        productId: first.id,
        product: first,
        options: {
          outputFormat: selectedFormat(),
          templatePro: 'campaign',
          contentMode: 'multi_product',
          showPrice: false,
          headline: manualCopy.headline,
          subtitle: manualCopy.subtitle,
          benefit: '',
          badge: manualCopy.badge,
          cta: manualCopy.cta,
          manualCopy,
          copyAuthority: 'editor',
          brandLabel: els.brandLabel.value.trim(),
          brandLogoUrl: els.brandLogoUrl.value.trim(),
          couponText: els.couponText.value.trim(),
          promoText: els.promoText.value.trim(),
          showCommercialInfo: false,
          installmentCount: Number(els.installments.value || 12),
          removeBackground: els.removeBackground.checked
        }
      };
    }

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
        headline: manualCopy.headline,
        subtitle: manualCopy.subtitle,
        benefit: '',
        badge: manualCopy.badge,
        cta: manualCopy.cta,
        manualCopy,
        copyAuthority: 'editor',
        brandLabel: els.brandLabel.value.trim() || selectedProduct?.brand || '',
        brandLogoUrl: els.brandLogoUrl.value.trim(),
        couponText: els.couponText.value.trim(),
        promoText: els.promoText.value.trim(),
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
    qualityAllowsSave = !quality.blockSave;
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

    if (quality.blockSave) {
      els.qualityList.insertAdjacentHTML(
        'afterbegin',
        '<div class="quality-item warn"><span class="quality-icon">×</span><div><b>Salvar em alta está bloqueado</b><small>Corrija os itens críticos abaixo. O Studio não vai liberar uma peça com logo, recorte ou resolução reprovados.</small></div></div>'
      );
    }
  }

  function showPreview(blob) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewBlob = blob;
    previewUrl = URL.createObjectURL(blob);
    els.previewImage.src = previewUrl;
    els.previewImage.classList.remove('hidden');
    els.previewEmpty.classList.add('hidden');
    els.saveButton.disabled = !qualityAllowsSave;
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
      let analysis = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        analysis = await api('/admin/creative-studio/pro/analyze',{
          method:'POST',
          body:JSON.stringify(payload)
        });
        if (!analysis?.quality?.blockSave) break;
        const failures = Array.isArray(analysis?.quality?.criticalFailures) ? analysis.quality.criticalFailures : [];
        const productFailure = failures.some(item => item === 'multi_cutout' || item === 'multi_resolution');
        if (!productFailure || !repairAutoHeroSelection(analysis)) break;
        payload = buildPayload();
        status('Uma imagem não passou na qualidade. O Studio trocou o produto automaticamente e está testando novamente...', '');
      }
      renderQuality(analysis);

      if (analysis?.quality?.blockSave) {
        status('Prévia gerada, mas a arte final está bloqueada: corrija logo, recorte ou resolução antes de salvar.', 'error');
      } else if (contentMode === 'multi_product') {
        status('Todos os produtos passaram no recorte. Gerando a vitrine multi-produto...', 'ok');
      } else if (contentMode === 'with_price' && !payload.options.showPrice) {
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
      if (!analysis?.quality?.blockSave) {
        status('Prévia Pro aprovada na qualidade mínima. Confira a arte antes de salvar.', 'ok');
      }
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
      const baseName = contentMode === 'multi_product'
        ? (els.brandLabel.value.trim() || 'campanha-ariana')
        : (els.productName.value || 'banner-ariana-pro');
      const fileName = normalize(baseName).replace(/\s+/g,'-') + '-' + selectedFormat() + '-pro.png';
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
      els.saveButton.disabled = !previewBlob || !qualityAllowsSave;
    }
  }

  function bind() {
    els.productSearch.addEventListener('input',event => renderProductResults(event.target.value));
    els.autoHeroButton.addEventListener('click',buildProfessionalHero);

    document.querySelectorAll('[data-hero-catalog-slot]').forEach(button => {
      button.addEventListener('click', () => chooseCatalogForHeroSlot(button.dataset.heroCatalogSlot));
    });
    document.querySelectorAll('[data-hero-upload-slot]').forEach(input => {
      input.addEventListener('change', event => uploadHeroSlot(event.target.files?.[0], input.dataset.heroUploadSlot));
    });
    document.querySelectorAll('[data-hero-clear-slot]').forEach(button => {
      button.addEventListener('click', () => clearHeroSlot(button.dataset.heroClearSlot));
    });
    els.imageFile.addEventListener('change',event => uploadImage(event.target.files?.[0]));
    els.brandLogoFile.addEventListener('change',event => uploadBrandLogo(event.target.files?.[0]));

    [els.badge, els.headline, els.subtitle, els.cta].forEach(input => {
      input.addEventListener('input', () => {
        copyTouched = true;
        qualityAllowsSave = false;
        els.saveButton.disabled = true;
      });
    });

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
      autoHeroButton:byId('auto-hero-button'),
      productSearch:byId('product-search'),
      productSearchLabel:byId('product-search-label'),
      heroPickerCount:byId('hero-picker-count'),
      productResults:byId('product-results'),
      selectedProduct:byId('selected-product'),
      multiProductHint:byId('multi-product-hint'),
      singleProductFields:byId('single-product-fields'),
      productName:byId('product-name'),
      imageUrl:byId('image-url'),
      imageFile:byId('image-file'),
      uploadStatus:byId('upload-status'),
      badge:byId('badge'),
      cta:byId('cta'),
      headline:byId('headline'),
      subtitle:byId('subtitle'),
      benefit:byId('benefit'),
      brandLabel:byId('brand-label'),
      brandLogoUrl:byId('brand-logo-url'),
      brandLogoFile:byId('brand-logo-file'),
      brandLogoStatus:byId('brand-logo-status'),
      couponText:byId('coupon-text'),
      promoText:byId('promo-text'),
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
    renderHeroSlots();
    catalogReadyPromise = loadProducts();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start);
  else start();
})();