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
  const copyTouchedFields = new Set();
  let lastCopyResearchSignature = '';
  let lastCreativeDirection = null;
  let deferredInstallPrompt = null;
  let directProductSource = null;
  let cutoutBankAssets = [];
  let cutoutBankTargetSlot = null;
  const cutoutBankBlobUrls = new Map();

  const FORMATS = Object.freeze({
    hero_desktop: { label: 'PRÉVIA • HERO DESKTOP', size: '1920 × 480 pixels' },
    hero_mobile: { label: 'PRÉVIA • HERO MOBILE', size: '1080 × 1080 pixels' },
    secondary_desktop: { label: 'PRÉVIA • SECUNDÁRIO DESKTOP', size: '1600 × 400 pixels' },
    secondary_mobile: { label: 'PRÉVIA • SECUNDÁRIO MOBILE', size: '1080 × 720 pixels' },
    square: { label: 'PRÉVIA • CARD QUADRADO', size: '1080 × 1080 pixels' }
  });

  const TEMPLATE_STORAGE_KEY = 'ariana_creative_imported_templates_v1';
  const HIDDEN_TEMPLATE_STORAGE_KEY = 'ariana_creative_hidden_templates_v1';
  const BUILTIN_TEMPLATE_PROFILES = Object.freeze({
    marketplace: { renderer:'marketplace', generationStyle:'marketplace', preset:'impact', grammar:'A', objective:'commercial' },
    premium: { renderer:'premium', generationStyle:'premium', preset:'manufacturer', grammar:'D', objective:'manufacturer' },
    campaign: { renderer:'campaign', generationStyle:'marketplace', preset:'opportunity', grammar:'C', objective:'commercial_campaign' },
    retail_stock: { renderer:'retail_stock', generationStyle:'marketplace', preset:'opportunity', grammar:'F', objective:'commercial_campaign' },
    category_selection: { renderer:'category_selection', generationStyle:'marketplace', preset:'selection', grammar:'G', objective:'category' },
    stock_movement: { renderer:'stock_movement', generationStyle:'marketplace', preset:'opportunity', grammar:'H', objective:'commercial_campaign' },
    tech_store: { renderer:'tech_store', generationStyle:'marketplace', preset:'selection', grammar:'I', objective:'category' },
    premium_line: { renderer:'premium_line', generationStyle:'marketplace', preset:'manufacturer', grammar:'D', objective:'manufacturer' }
  });
  let importedTemplates = [];

  function loadImportedTemplates() {
    try {
      const rows = JSON.parse(localStorage.getItem(TEMPLATE_STORAGE_KEY) || '[]');
      importedTemplates = Array.isArray(rows) ? rows.filter(Boolean).slice(0,30) : [];
    } catch {
      importedTemplates = [];
    }
  }

  function saveImportedTemplates() {
    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(importedTemplates.slice(0,30)));
  }

  function hiddenTemplateIds() {
    try {
      const rows = JSON.parse(localStorage.getItem(HIDDEN_TEMPLATE_STORAGE_KEY) || '[]');
      return new Set(Array.isArray(rows) ? rows.filter(Boolean) : []);
    } catch {
      return new Set();
    }
  }

  function setHiddenTemplateIds(set) {
    localStorage.setItem(HIDDEN_TEMPLATE_STORAGE_KEY, JSON.stringify([...set]));
  }

  function hasProductsForPreview() {
    if (contentMode === 'multi_product') return selectedProducts.length >= 2;
    return Boolean(els.productName?.value?.trim() && els.imageUrl?.value?.trim());
  }

  let templatePreviewTimer = null;
  function scheduleTemplatePreview() {
    if (!hasProductsForPreview()) return;
    clearTimeout(templatePreviewTimer);
    templatePreviewTimer = setTimeout(() => {
      status('Template aplicado. Gerando nova prévia com os produtos já escolhidos...', 'ok');
      generatePreview().catch(error => status('Falha ao gerar a prévia do template: ' + (error?.message || error), 'error'));
    }, 160);
  }

  function importedTemplateById(id = '') {
    return importedTemplates.find(item => (item?.libraryId || item?.id) === id) || null;
  }

  function rendererAlias(renderer = '') {
    const value = String(renderer || '').trim().toLowerCase();
    const aliases = {
      marketplace:'marketplace',
      retail_promo:'retail_stock',
      promo_virada:'stock_movement',
      retail_stock:'retail_stock',
      category_selection:'category_selection',
      stock_movement:'stock_movement',
      tech_store:'tech_store',
      premium_line:'premium_line',
      premium:'premium',
      campaign:'campaign'
    };
    return aliases[value] || 'marketplace';
  }

  function templateProfile(id = selectedTemplate()) {
    if (BUILTIN_TEMPLATE_PROFILES[id]) return BUILTIN_TEMPLATE_PROFILES[id];
    const imported = importedTemplateById(id);
    if (!imported) return BUILTIN_TEMPLATE_PROFILES.marketplace;
    const selected = imported.selectedConfiguration || {};
    const renderer = rendererAlias(imported.renderer);
    const fallback = BUILTIN_TEMPLATE_PROFILES[renderer] || BUILTIN_TEMPLATE_PROFILES.marketplace;
    return {
      renderer,
      generationStyle: selected.generationStyle || fallback.generationStyle || 'marketplace',
      preset: selected.marketplacePreset || fallback.preset || 'impact',
      grammar: selected.layoutGrammar || fallback.grammar || 'A',
      objective: selected.objective || fallback.objective || 'commercial',
      manifest: imported
    };
  }

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


  function inferCategoryFromText(value = '') {
    const text = normalize(value);
    const rules = [
      ['ventilador','Ventiladores'],
      ['climatizador','Climatização'],
      ['ar condicionado','Climatização'],
      ['geladeira','Geladeiras'],
      ['refrigerador','Geladeiras'],
      ['lavadora','Lavadoras'],
      ['lava e seca','Lavadoras'],
      ['maquina de lavar','Lavadoras'],
      ['fogao','Fogões'],
      ['cooktop','Fogões e Cooktops'],
      ['micro ondas','Micro-ondas'],
      ['microondas','Micro-ondas'],
      ['air fryer','Air Fryer'],
      ['fritadeira','Air Fryer'],
      ['tv','TVs'],
      ['televisor','TVs'],
      ['smart tv','TVs'],
      ['guarda roupa','Móveis'],
      ['roupeiro','Móveis'],
      ['sofa','Móveis'],
      ['mesa','Móveis'],
      ['colchao','Móveis']
    ];
    for (const [needle, category] of rules) {
      if (text.includes(needle)) return category;
    }
    return '';
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

  async function apiWithRetry(path, options = {}, responseType = 'json', retries = 1) {
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await api(path, options, responseType);
      } catch (error) {
        lastError = error;
        const message = String(error?.message || error || '');
        const transient = /failed to fetch|networkerror|load failed|network request failed/i.test(message);
        if (!transient || attempt >= retries) throw error;
        await new Promise(resolve => setTimeout(resolve, 850 + attempt * 650));
      }
    }
    throw lastError || new Error('Falha de rede ao gerar a prévia.');
  }

  function status(message = '', type = '') {
    els.globalStatus.textContent = message;
    els.globalStatus.className = 'global-status ' + type;
  }


  function revokeObjectUrl(url = '') {
    if (!String(url).startsWith('blob:')) return;
    try { URL.revokeObjectURL(url); } catch {}
  }

  async function cutoutBankBlobUrl(asset) {
    const id = String(asset?.id || '');
    if (!id) return '';
    if (cutoutBankBlobUrls.has(id)) return cutoutBankBlobUrls.get(id);

    const auth = token();
    const response = await fetch(API + '/admin/creative-cutout-studio/assets/' + encodeURIComponent(id) + '/approved', {
      headers: { Authorization: 'Bearer ' + auth }
    });
    if (!response.ok) throw new Error('Não consegui carregar o PNG Mestre aprovado.');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    cutoutBankBlobUrls.set(id, url);
    return url;
  }

  function cutoutBankDestinationLabel() {
    if (Number.isInteger(cutoutBankTargetSlot)) {
      return cutoutBankTargetSlot === 0 ? 'Produto principal'
        : 'Produto de apoio ' + cutoutBankTargetSlot;
    }
    return 'Produto do banner';
  }

  async function renderCutoutBankGallery(query = '') {
    if (!els.cutoutBankGrid) return;
    const normalized = normalize(query);
    const rows = cutoutBankAssets.filter(asset => {
      if (!normalized) return true;
      return normalize([asset.name, asset.category, asset.sku].filter(Boolean).join(' ')).includes(normalized);
    });

    els.cutoutBankGrid.innerHTML = rows.length
      ? rows.map(asset =>
          '<article class="cutout-bank-card" data-cutout-bank-id="' + escapeHtml(asset.id) + '">' +
          '<div class="cutout-bank-thumb"><span>Carregando...</span></div>' +
          '<b>' + escapeHtml(asset.name || 'Produto') + '</b>' +
          '<small>' + escapeHtml([asset.category, asset.sku ? 'SKU ' + asset.sku : ''].filter(Boolean).join(' • ')) + '</small>' +
          '<button type="button" data-use-cutout-bank="' + escapeHtml(asset.id) + '">Usar este PNG</button>' +
          '</article>'
        ).join('')
      : '<div class="cutout-bank-empty">Nenhum PNG Mestre aprovado encontrado.</div>';

    for (const asset of rows.slice(0, 40)) {
      const card = els.cutoutBankGrid.querySelector('[data-cutout-bank-id="' + CSS.escape(asset.id) + '"]');
      const thumb = card?.querySelector('.cutout-bank-thumb');
      if (!thumb) continue;
      cutoutBankBlobUrl(asset).then(url => {
        thumb.innerHTML = '<img src="' + escapeHtml(url) + '" alt="">';
      }).catch(() => {
        thumb.innerHTML = '<span>Falha ao carregar</span>';
      });
    }
  }

  async function loadCutoutBank() {
    els.cutoutBankStatus.textContent = 'Carregando PNGs aprovados...';
    els.cutoutBankStatus.className = 'inline-status';
    const data = await api('/admin/creative-cutout-studio/assets?status=approved&limit=80');
    cutoutBankAssets = Array.isArray(data?.assets) ? data.assets : [];
    els.cutoutBankStatus.textContent = cutoutBankAssets.length
      ? cutoutBankAssets.length + ' PNG(s) Mestre disponíveis.'
      : 'Ainda não há PNGs aprovados no Banco Mestre.';
    els.cutoutBankStatus.className = 'inline-status ' + (cutoutBankAssets.length ? 'ok' : '');
    await renderCutoutBankGallery(els.cutoutBankSearch?.value || '');
  }

  async function openCutoutBank(slot = null) {
    cutoutBankTargetSlot = Number.isInteger(Number(slot)) && slot !== null ? Number(slot) : null;
    if (contentMode === 'multi_product' && cutoutBankTargetSlot === null) {
      const empty = heroSlots.findIndex(item => !item);
      cutoutBankTargetSlot = empty >= 0 ? empty : 0;
    }
    if (els.cutoutBankTarget) els.cutoutBankTarget.textContent = 'Destino: ' + cutoutBankDestinationLabel();
    if (typeof els.cutoutBankDialog?.showModal === 'function') els.cutoutBankDialog.showModal();
    else els.cutoutBankDialog?.setAttribute('open','');
    try {
      await loadCutoutBank();
    } catch (error) {
      els.cutoutBankStatus.textContent = error.message;
      els.cutoutBankStatus.className = 'inline-status error';
    }
  }

  async function useCutoutBankAsset(assetId) {
    const asset = cutoutBankAssets.find(item => String(item.id) === String(assetId));
    if (!asset) throw new Error('PNG Mestre não encontrado.');
    const imageUrl = await cutoutBankBlobUrl(asset);
    const product = {
      id: 'cutout-bank-' + asset.id,
      name: asset.name || 'Produto',
      imageUrl,
      cutoutAssetId: asset.id,
      sourceType: 'approved_cutout_bank',
      category: asset.category || '',
      categoryName: asset.category || '',
      sku: asset.sku || '',
      __cutoutBank: true,
      __heroUploaded: false
    };

    if (Number.isInteger(cutoutBankTargetSlot)) {
      setHeroSlot(cutoutBankTargetSlot, product);
      status('PNG Mestre adicionado ao espaço ' + (cutoutBankTargetSlot + 1) + '.', 'ok');
    } else {
      clearDirectProductSource();
      selectedProduct = product;
      els.productName.value = product.name;
      els.imageUrl.value = imageUrl;
      renderSelectedProducts();
      qualityAllowsSave = false;
      els.saveButton.disabled = true;
      previewBlob = null;
      status('PNG Mestre carregado diretamente do Banco Mestre.', 'ok');
    }

    els.cutoutBankDialog?.close();
  }

  function clearDirectProductSource() {
    if (directProductSource?.previewUrl) revokeObjectUrl(directProductSource.previewUrl);
    directProductSource = null;
  }

  async function uploadOriginalSource(file, nameOverride = '') {
    const blob = file instanceof Blob ? file : null;
    if (!blob) throw new Error('Arquivo de imagem inválido.');
    const filename = String(nameOverride || file.name || 'produto.png');
    const form = new FormData();
    form.append('file', blob, filename);
    const data = await api('/admin/creative-studio/pro/source-image', {
      method:'POST',
      body:form
    });
    if (!data?.sourceToken) {
      throw new Error('O gerador não confirmou o recebimento da imagem original.');
    }
    const persistentUrl = String(data.persistentUrl || '').trim();
    return {
      sourceToken: String(data.sourceToken),
      originalName: String(data.originalName || filename || 'produto'),
      mimeType: String(data.mimeType || blob.type || ''),
      bytes: Number(data.bytes || blob.size || 0),
      previewUrl: persistentUrl || URL.createObjectURL(blob),
      persistentUrl,
      persistentPublicId: String(data.persistentPublicId || ''),
      sourceType: String(data.sourceType || (persistentUrl ? 'persistent_original_upload' : 'direct_original_upload')),
      originalFile: file
    };
  }

  function isExpiredCreativeSourceError(error) {
    const message = String(error?.message || error || '').toLowerCase();
    return message.includes('imagem original temporária expirou')
      || message.includes('creative_source_expired')
      || message.includes('original temporaria expirou');
  }

  async function recoverDirectUploadBlob(entry = {}) {
    if (entry?.originalFile instanceof Blob) return entry.originalFile;
    const url = String(entry?.previewUrl || entry?.imageUrl || '').trim();
    if (!url.startsWith('blob:')) return null;
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      return await response.blob();
    } catch {
      return null;
    }
  }

  async function refreshExpiredDirectSources() {
    let refreshed = 0;

    for (let index = 0; index < heroSlots.length; index += 1) {
      const item = heroSlots[index];
      if (!item || item.sourceType !== 'direct_original_upload') continue;
      const blob = await recoverDirectUploadBlob(item);
      if (!blob) continue;
      const source = await uploadOriginalSource(blob, item.sourceOriginalName || item.name || ('produto-' + (index + 1) + '.png'));
      const oldPreview = String(item.imageUrl || '');
      heroSlots[index] = {
        ...item,
        imageUrl: source.persistentUrl || source.previewUrl,
        persistentSourceUrl: source.persistentUrl || '',
        sourceToken: source.sourceToken,
        sourceOriginalName: source.originalName,
        sourceOriginalMimeType: source.mimeType,
        sourceOriginalBytes: source.bytes,
        sourceType: source.sourceType,
        originalFile: item.originalFile || blob
      };
      if (oldPreview.startsWith('blob:') && oldPreview !== source.previewUrl) revokeObjectUrl(oldPreview);
      refreshed += 1;
    }

    if (directProductSource?.sourceType === 'direct_original_upload') {
      const blob = await recoverDirectUploadBlob(directProductSource);
      if (blob) {
        const oldPreview = String(directProductSource.previewUrl || '');
        const source = await uploadOriginalSource(blob, directProductSource.originalName || 'produto.png');
        directProductSource = {
          ...source,
          originalFile: directProductSource.originalFile || blob
        };
        if (selectedProduct?.__directOriginal) {
          selectedProduct = {
            ...selectedProduct,
            imageUrl: source.persistentUrl || source.previewUrl,
            persistentSourceUrl: source.persistentUrl || '',
            sourceToken: source.sourceToken,
            sourceOriginalName: source.originalName,
            sourceOriginalMimeType: source.mimeType,
            sourceOriginalBytes: source.bytes,
            sourceType: source.sourceType,
            originalFile: selectedProduct.originalFile || blob
          };
          els.imageUrl.value = source.persistentUrl || source.previewUrl;
        }
        if (oldPreview.startsWith('blob:') && oldPreview !== source.previewUrl) revokeObjectUrl(oldPreview);
        refreshed += 1;
      }
    }

    if (refreshed) {
      renderHeroSlots();
      renderSelectedProducts();
      lastCopyResearchSignature = '';
    }
    return refreshed;
  }

  function selectedFormat() {
    return document.querySelector('input[name="format"]:checked')?.value || 'hero_desktop';
  }

  function selectedTemplate() {
    return document.querySelector('input[name="template-pro"]:checked')?.value || 'marketplace';
  }

  function selectedRenderTemplate() {
    return templateProfile(selectedTemplate()).renderer || 'marketplace';
  }

  function selectedGenerationStyle() {
    return document.querySelector('input[name="generation-style"]:checked')?.value || 'marketplace';
  }

  function selectedMarketplacePreset() {
    return els.marketplacePreset?.value || 'impact';
  }

  function selectedLayoutGrammar() {
    return els.layoutGrammar?.value || 'auto';
  }

  function campaignObjective() {
    if (contentMode === 'institutional') return 'institutional';
    const profile = templateProfile();
    if (profile?.objective) return profile.objective;
    if (selectedMarketplacePreset() === 'manufacturer') return 'manufacturer';
    if (selectedMarketplacePreset() === 'opportunity') return 'commercial_campaign';
    if (contentMode === 'multi_product' || selectedMarketplacePreset() === 'selection') return 'category';
    return 'product';
  }

  function setRadioValue(name, value) {
    const input = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
    if (!input) return false;
    input.checked = true;
    return true;
  }

  function applyTemplateProfile(id = selectedTemplate(), { announce = true } = {}) {
    const profile = templateProfile(id);
    if (profile.generationStyle) {
      setRadioValue('generation-style', profile.generationStyle);
      applyGenerationStyle(profile.generationStyle);
    }
    if (els.marketplacePreset && profile.preset) els.marketplacePreset.value = profile.preset;
    if (els.layoutGrammar && profile.grammar) {
      const exists = Array.from(els.layoutGrammar.options).some(option => option.value === profile.grammar);
      if (exists) els.layoutGrammar.value = profile.grammar;
      else els.layoutGrammar.value = 'auto';
    }
    const manifest = profile.manifest;
    const commerce = manifest?.rules?.commerce || {};
    if (manifest) {
      const supportsPrice = commerce.autoPrice === true || commerce.autoPix === true || commerce.autoInstallments === true;
      if (supportsPrice && contentMode === 'no_price') applyMode('with_price');
      const cfg = manifest.selectedConfiguration || {};
      if (cfg.contentMode && ['with_price','no_price','institutional','multi_product'].includes(cfg.contentMode)) {
        applyMode(cfg.contentMode);
      }
      if (cfg.format && document.querySelector('input[name="format"][value="' + cfg.format + '"]')) {
        setRadioValue('format', cfg.format);
      }
    }
    updateChoiceCards();
    lastCopyResearchSignature = '';
    qualityAllowsSave = false;
    if (els.saveButton) els.saveButton.disabled = true;
    updateSelectedTemplateSummary();
    if (els.templateLibraryDialog?.open) {
      els.templateLibraryDialog.close();
    }
    if (announce) {
      status('Template "' + (manifest?.label || document.querySelector('input[name="template-pro"]:checked')?.closest('.template-card')?.querySelector('b')?.textContent || id) + '" ativado.', 'ok');
      scheduleTemplatePreview();
    }
  }

  function applyGenerationStyle(style = selectedGenerationStyle()) {
    const normalizedStyle = ['classic','premium','marketplace','institutional'].includes(style) ? style : 'marketplace';
    document.querySelectorAll('input[name="generation-style"]').forEach(input => {
      input.closest('.choice')?.classList.toggle('selected', input.checked);
    });
    els.marketplaceControls?.classList.toggle('hidden', normalizedStyle !== 'marketplace');
    lastCopyResearchSignature = '';
    qualityAllowsSave = false;
    if (els.saveButton) els.saveButton.disabled = true;
  }

  function updateChoiceCards() {
    document.querySelectorAll('.choice').forEach(card => card.classList.toggle('selected', !!card.querySelector('input:checked')));
    document.querySelectorAll('.template-card').forEach(card => card.classList.toggle('selected', !!card.querySelector('input:checked')));
    const format = FORMATS[selectedFormat()] || FORMATS.hero_desktop;
    els.previewLabel.textContent = format.label;
    els.previewSize.textContent = format.size;
    els.previewStage.dataset.format = selectedFormat();
  }

  function copyFieldIsLocked(key) {
    const input = els[key];
    return copyTouchedFields.has(key) && Boolean(input?.value?.trim());
  }

  function setCopyValues(values = {}, { force = false } = {}) {
    for (const key of ['badge','headline','subtitle','cta']) {
      if (values[key] === undefined) continue;
      if (!force && copyFieldIsLocked(key)) continue;
      els[key].value = values[key];
    }
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
        source.textContent = product.__cutoutBank
          ? 'PNG Mestre aprovado'
          : product.__heroUploaded
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
    status('Enviando a imagem original direto para o gerador...', '');

    try {
      const source = await uploadOriginalSource(file);

      const cleanName = String(file.name || 'Produto')
        .replace(/\.[a-z0-9]+$/i,'')
        .replace(/[_-]+/g,' ')
        .trim() || 'Produto';

      const previous = heroSlots[slot] || {};
      const inferredCategory =
        previous.category ||
        previous.categoryName ||
        inferCategoryFromText(cleanName);

      setHeroSlot(slot, {
        ...previous,
        id: String(previous.id || previous._id || ('hero-upload-' + Date.now() + '-' + slot)),
        name: previous.name || previous.title || cleanName,
        imageUrl: source.persistentUrl || source.previewUrl,
        persistentSourceUrl: source.persistentUrl || '',
        sourceToken: source.sourceToken,
        sourceOriginalName: source.originalName,
        sourceOriginalMimeType: source.mimeType,
        sourceOriginalBytes: source.bytes,
        sourceType: source.sourceType,
        originalFile: source.originalFile || file,
        category: inferredCategory,
        categoryName: previous.categoryName || inferredCategory,
        __heroUploaded: true,
        __directOriginal: true
      });
      status('Imagem original recebida diretamente pelo gerador. ' + heroSlotProducts().length + ' de 3 produtos preenchidos.', 'ok');
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

  function campaignResearchProducts() {
    const rows = contentMode === 'multi_product'
      ? (selectedProducts.length ? selectedProducts : heroSlotProducts())
      : (selectedProduct ? [selectedProduct] : []);

    if (rows.length) {
      return rows.slice(0,5).map(item => ({
        id: String(item.id || item._id || ''),
        name: item.name || item.title || '',
        brand: item.brand || item.brandName || '',
        category: item.category || item.categoryName || inferCategoryFromText(item.name || item.title || ''),
        imageUrl: imageOf(item),
        sourceToken: String(item.sourceToken || ''),
        sourceType: String(item.sourceType || ''),
        sourceOriginalName: String(item.sourceOriginalName || '')
      }));
    }

    const manualName = els.productName?.value?.trim();
    if (!manualName) return [];

    return [{
      id: '',
      name: manualName,
      brand: els.brandLabel?.value?.trim() || '',
      category: inferCategoryFromText(manualName),
      imageUrl: els.imageUrl?.value?.trim() || '',
      sourceToken: String(directProductSource?.sourceToken || ''),
      sourceType: String(directProductSource?.sourceType || ''),
      sourceOriginalName: String(directProductSource?.originalName || '')
    }];
  }

  function copyResearchSignature(rows = []) {
    const productSignature = rows
      .map(item => [item.id,item.name,item.brand,item.category,item.imageUrl].map(normalize).join(':'))
      .join('|');
    const creativeContext = [
      selectedFormat(),
      selectedTemplate(),
      contentMode,
      selectedGenerationStyle(),
      selectedMarketplacePreset(),
      selectedLayoutGrammar(),
      campaignObjective()
    ].map(normalize).join(':');
    return creativeContext + '::' + productSignature;
  }

  async function applyInternetCampaignCopy() {
    const locked = ['badge','headline','subtitle','cta'].filter(copyFieldIsLocked);
    if (locked.length === 4) return { applied:false, reason:'manual_copy_locked' };

    const rows = campaignResearchProducts();
    if (!rows.length) return { applied:false, reason:'no_products' };

    const signature = copyResearchSignature(rows);
    if (signature && signature === lastCopyResearchSignature) {
      return { applied:false, reason:'same_context' };
    }

    status('Pesquisando campanhas atuais para criar uma legenda original da Ariana...', '');

    try {
      const result = await api('/admin/creative-studio/pro/research-copy', {
        method:'POST',
        body:JSON.stringify({
          products: rows,
          context: {
            format: selectedFormat(),
            template: selectedRenderTemplate(),
            templateLibraryId: selectedTemplate(),
            contentMode,
            generationStyle: selectedGenerationStyle(),
            marketplacePreset: selectedMarketplacePreset(),
            layoutGrammar: selectedLayoutGrammar(),
            objective: campaignObjective()
          }
        })
      });
      if (!result?.copy) return { applied:false, reason:'no_copy' };

      setCopyValues(result.copy);
      lastCreativeDirection = result.direction || null;

      if (
        result.engine === 'ai_vision_web' &&
        autoHeroActive &&
        contentMode === 'multi_product' &&
        selectedProducts.length >= 2
      ) {
        const heroIndex = Number(result.direction?.heroProductIndex);
        if (Number.isInteger(heroIndex) && heroIndex > 0 && heroIndex < selectedProducts.length) {
          const hero = selectedProducts[heroIndex];
          const reordered = [
            hero,
            ...selectedProducts.filter((_, index) => index !== heroIndex)
          ];
          selectedProducts = reordered;
          selectedProduct = reordered[0];
          heroSlots = reordered.slice(0,3);
          renderHeroSlots();
        }
      }

      lastCopyResearchSignature = copyResearchSignature(campaignResearchProducts());

      const count = Number(result.sourceCount || 0);
      console.info('[Creative Studio] direção criativa', {
        engine:result.engine,
        aiConfigured:Boolean(result.aiConfigured),
        category:result.category || '',
        campaignAngle:result.campaignAngle || '',
        direction:result.direction || null,
        trendSignals:result.trendSignals || [],
        references:result.referenceDomains || result.sources || []
      });

      if (result.engine === 'ai_vision_web') {
        const recognized = Array.isArray(result.recognizedProducts) ? result.recognizedProducts.length : 0;
        status(
          'Diretor Criativo IA analisou ' + recognized + ' produto(s), pesquisou tendências atuais e aplicou uma direção original da Ariana.',
          'ok'
        );
      } else if (result.aiConfigured === false) {
        status(
          'O Diretor Criativo IA ainda não está configurado no servidor. Usei a pesquisa por regras como fallback.',
          ''
        );
      } else {
        status(
          count > 0
            ? 'A IA ficou indisponível nesta tentativa; usei ' + count + ' referência(s) no fallback seguro.'
            : 'A IA ficou indisponível nesta tentativa; usei a direção segura da Ariana.',
          ''
        );
      }

      return { applied:true, result };
    } catch (error) {
      console.warn('[Creative Studio] pesquisa de campanha indisponível:', error);
      return { applied:false, reason:'research_failed' };
    }
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
      persistentSourceUrl: String(product.persistentSourceUrl || product.persistentUrl || ''),
      sourceToken: String(product.sourceToken || ''),
      sourceOriginalName: String(product.sourceOriginalName || ''),
      sourceOriginalMimeType: String(product.sourceOriginalMimeType || ''),
      sourceOriginalBytes: Number(product.sourceOriginalBytes || 0),
      sourceType: String(product.sourceType || ''),
      cutoutAssetId: String(product.cutoutAssetId || ''),
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

    clearDirectProductSource();
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

    els.uploadStatus.textContent = 'Enviando a imagem original direto para o gerador...';
    els.uploadStatus.className = 'inline-status full';
    try {
      const source = await uploadOriginalSource(file);
      clearDirectProductSource();
      directProductSource = source;
      els.imageUrl.value = source.previewUrl;
      const cleanName = String(
        selectedProduct?.name ||
        selectedProduct?.title ||
        els.productName?.value ||
        source.originalName ||
        'Produto'
      )
        .replace(/\.[a-z0-9]+$/i,'')
        .replace(/[_-]+/g,' ')
        .trim() || 'Produto';
      const inferredCategory =
        selectedProduct?.category ||
        selectedProduct?.categoryName ||
        inferCategoryFromText(cleanName);

      selectedProduct = {
        ...(selectedProduct || {}),
        name: selectedProduct?.name || selectedProduct?.title || cleanName,
        imageUrl: source.persistentUrl || source.previewUrl,
        persistentSourceUrl: source.persistentUrl || '',
        sourceToken: source.sourceToken,
        sourceOriginalName: source.originalName,
        sourceOriginalMimeType: source.mimeType,
        sourceOriginalBytes: source.bytes,
        sourceType: source.sourceType,
        originalFile: source.originalFile || file,
        category: inferredCategory,
        categoryName: selectedProduct?.categoryName || inferredCategory,
        __directOriginal: true
      };
      if (!els.productName.value.trim()) els.productName.value = selectedProduct.name;
      renderSelectedProducts();
      qualityAllowsSave = false;
      els.saveButton.disabled = true;
      els.uploadStatus.textContent = 'Imagem original pronta. O recorte será feito sem passar pelo Cloudinary.';
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
          templatePro: selectedRenderTemplate(),
          templateLibraryId: selectedTemplate(),
          importedTemplate: importedTemplateById(selectedTemplate()),
          generationStyle: selectedGenerationStyle(),
          marketplacePreset: selectedMarketplacePreset(),
          layoutGrammar: selectedLayoutGrammar(),
          campaignObjective: campaignObjective(),
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
        persistentSourceUrl: String(directProductSource?.persistentUrl || selectedProduct?.persistentSourceUrl || ''),
        sourceToken: String(directProductSource?.sourceToken || selectedProduct?.sourceToken || ''),
        sourceOriginalName: String(directProductSource?.originalName || selectedProduct?.sourceOriginalName || ''),
        sourceOriginalMimeType: String(directProductSource?.mimeType || selectedProduct?.sourceOriginalMimeType || ''),
        sourceOriginalBytes: Number(directProductSource?.bytes || selectedProduct?.sourceOriginalBytes || 0),
        sourceType: String(directProductSource?.sourceType || selectedProduct?.sourceType || ''),
        cutoutAssetId: String(selectedProduct?.cutoutAssetId || ''),
        brand: selectedProduct?.brand || '',
        category: selectedProduct?.category || selectedProduct?.categoryName || '',
        cashPrice,
        fullPrice,
        installmentCount: count,
        installmentPrice
      },
      options: {
        outputFormat: selectedFormat(),
        templatePro: selectedRenderTemplate(),
        templateLibraryId: selectedTemplate(),
        importedTemplate: importedTemplateById(selectedTemplate()),
        generationStyle: selectedGenerationStyle(),
        marketplacePreset: selectedMarketplacePreset(),
        layoutGrammar: selectedLayoutGrammar(),
        campaignObjective: campaignObjective(),
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

  function clearPreview() {
    if (previewUrl) {
      try { URL.revokeObjectURL(previewUrl); } catch {}
    }
    previewBlob = null;
    previewUrl = '';
    els.previewImage.removeAttribute('src');
    els.previewImage.classList.add('hidden');
    els.previewEmpty.classList.remove('hidden');
    els.saveButton.disabled = true;
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

  async function generatePreview(options = {}) {
    const retryExpiredSource = options?.retryExpiredSource !== false;
    setBusy(true);

    await applyInternetCampaignCopy();

    let payload;
    try {
      payload = buildPayload();
    } catch (error) {
      status(error.message,'error');
      setBusy(false);
      return;
    }

    status('Analisando recorte, resolução e composição...', '');
    try {
      let analysis = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        analysis = await apiWithRetry('/admin/creative-studio/pro/analyze',{
          method:'POST',
          body:JSON.stringify(payload)
        },'json',1);
        if (!analysis?.quality?.blockSave) break;
        const failures = Array.isArray(analysis?.quality?.criticalFailures) ? analysis.quality.criticalFailures : [];
        const productFailure = failures.some(item => item === 'multi_cutout' || item === 'multi_resolution');
        if (!productFailure || !repairAutoHeroSelection(analysis)) break;
        payload = buildPayload();
        status('Uma imagem não passou na qualidade. O Studio trocou o produto automaticamente e está testando novamente...', '');
      }
      renderQuality(analysis);

      if (analysis?.quality?.blockSave) {
        clearPreview();
        status('A prévia foi bloqueada porque existe produto reprovado. Troque ou aprove o PNG Mestre antes de gerar o banner.', 'error');
        return;
      } else if (contentMode === 'multi_product') {
        status('Todos os produtos passaram no recorte. Gerando a vitrine multi-produto...', 'ok');
      } else if (contentMode === 'with_price' && !payload.options.showPrice) {
        status('Nenhum preço válido foi preenchido. O Pro mudou automaticamente para uma composição sem preço.', 'ok');
      } else if (analysis?.product?.backgroundRemoved) {
        status('Fundo tratado com segurança. Gerando composição Pro...', 'ok');
      } else {
        status('A foto tem fundo complexo. O Pro preservará a imagem em um painel e marcará o aviso de qualidade.', '');
      }

      const blob = await apiWithRetry('/admin/creative-studio/pro/preview',{
        method:'POST',
        body:JSON.stringify(payload)
      },'blob',1);
      showPreview(blob);
      if (!analysis?.quality?.blockSave) {
        status('Prévia Pro aprovada na qualidade mínima. Confira a arte antes de salvar.', 'ok');
      }
    } catch (error) {
      if (retryExpiredSource && isExpiredCreativeSourceError(error)) {
        try {
          status('A imagem temporária perdeu o vínculo após reinício do servidor. Reconectando os produtos automaticamente...', '');
          const refreshed = await refreshExpiredDirectSources();
          if (refreshed > 0) {
            setBusy(false);
            return generatePreview({ retryExpiredSource:false });
          }
        } catch (refreshError) {
          status('Não consegui reconectar a imagem temporária: ' + refreshError.message, 'error');
          return;
        }
      }
      clearPreview();
      status('Falha ao gerar a prévia Pro: ' + error.message,'error');
    } finally {
      setBusy(false);
    }
  }

  function downloadPreviewBlob(blob) {
    if (!(blob instanceof Blob) || blob.size <= 0) {
      throw new Error('A prévia aprovada não está disponível para salvar.');
    }
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
    setTimeout(() => URL.revokeObjectURL(url),1500);
  }

  async function saveHighResolution() {
    if (!qualityAllowsSave) {
      status('O PNG em alta só é liberado quando o controle de qualidade está aprovado.', 'error');
      return;
    }

    // A prévia é leve para evitar falhas de rede no celular.
    // O botão Salvar sempre pede ao backend a renderização final supersampled 2x.
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
      previewBlob = blob;
      downloadPreviewBlob(blob);
      status('PNG Pro em alta salvo no dispositivo.', 'ok');
    } catch (error) {
      status('Falha ao salvar: ' + error.message,'error');
    } finally {
      els.saveButton.disabled = !previewBlob || !qualityAllowsSave;
    }
  }

  function validateTemplateManifest(manifest) {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('O arquivo JSON não contém um template válido.');
    if (manifest.schemaVersion !== 'ariana-creative-template/v1') throw new Error('Schema incompatível. Use ariana-creative-template/v1.');
    if (!String(manifest.id || '').trim()) throw new Error('O template precisa ter um campo id.');
    if (!String(manifest.label || '').trim()) throw new Error('O template precisa ter um campo label.');
    if (!manifest.renderer) throw new Error('O template precisa informar renderer.');
    if (manifest.rules && typeof manifest.rules !== 'object') throw new Error('O campo rules precisa ser um objeto.');
    const sourceId = String(manifest.id).trim().slice(0,80);
    const libraryId = BUILTIN_TEMPLATE_PROFILES[sourceId] ? 'json__' + sourceId : sourceId;
    return {
      ...manifest,
      id: sourceId,
      libraryId,
      label: String(manifest.label).trim().slice(0,120),
      description: String(manifest.description || '').trim().slice(0,400),
      renderer: String(manifest.renderer).trim().slice(0,80),
      importedAt: new Date().toISOString()
    };
  }

  function importedPreviewClass(manifest) {
    const renderer = rendererAlias(manifest?.renderer);
    return renderer === 'retail_stock' ? 'retail-stock'
      : renderer === 'category_selection' ? 'category-selection'
      : renderer === 'stock_movement' ? 'stock-movement'
      : renderer === 'tech_store' ? 'tech-store'
      : renderer === 'premium_line' || renderer === 'premium' ? 'premium-line'
      : renderer === 'campaign' ? 'campaign'
      : 'marketplace';
  }

  function renderImportedTemplates() {
    const grid = byId('template-grid');
    if (!grid) return;
    grid.querySelectorAll('.template-card.imported-template').forEach(node => node.remove());
    for (const manifest of importedTemplates) {
      const label = document.createElement('label');
      label.className = 'template-card imported-template';
      const libraryId = manifest.libraryId || manifest.id;
      label.dataset.templateProfile = libraryId;
      label.innerHTML =
        '<input type="radio" name="template-pro" value="' + escapeHtml(libraryId) + '">' +
        '<span class="template-preview ' + importedPreviewClass(manifest) + '"><i></i><i></i><i></i></span>' +
        '<b>' + escapeHtml(manifest.label) + '</b>' +
        '<small>' + escapeHtml(manifest.description || ('JSON • renderer ' + manifest.renderer)) + '</small>';
      grid.appendChild(label);
    }

    if (els.importedTemplateList) {
      els.importedTemplateList.classList.toggle('hidden', importedTemplates.length === 0);
      els.importedTemplateList.innerHTML = importedTemplates.map(item =>
        '<span class="imported-template-chip"><b>' + escapeHtml(item.label) + '</b><span>' + escapeHtml(item.renderer) + '</span><button type="button" data-remove-imported-template="' + escapeHtml(item.libraryId || item.id) + '">×</button></span>'
      ).join('');
    }
    els.clearImportedTemplates?.classList.toggle('hidden', importedTemplates.length === 0);
    bindTemplateRadios();
    renderTemplateManagementControls();
    applyHiddenTemplates();
    updateSelectedTemplateSummary();
  }

  function updateSelectedTemplateSummary() {
    const input = document.querySelector('input[name="template-pro"]:checked');
    const card = input?.closest('.template-card');
    if (!card || !els.selectedTemplateSummary) return;
    const preview = card.querySelector('.template-preview');
    const title = card.querySelector('b')?.textContent || 'Template';
    const description = card.querySelector('small')?.textContent || 'Template selecionado';
    els.selectedTemplateSummary.innerHTML =
      '<span class="' + escapeHtml(preview?.className || 'template-preview marketplace') + '"><i></i><i></i><i></i></span>' +
      '<div><b>' + escapeHtml(title) + '</b><small>' + escapeHtml(description) + '</small></div>';
  }

  function applyHiddenTemplates() {
    const hidden = hiddenTemplateIds();
    document.querySelectorAll('.template-card').forEach(card => {
      const id = card.querySelector('input[name="template-pro"]')?.value || '';
      const imported = card.classList.contains('imported-template');
      card.classList.toggle('hidden-template-card', !imported && hidden.has(id));
    });
  }

  function renderTemplateManagementControls() {
    const hidden = hiddenTemplateIds();
    document.querySelectorAll('.template-card').forEach(card => {
      card.querySelector('.template-card-actions')?.remove();
      const input = card.querySelector('input[name="template-pro"]');
      if (!input) return;
      const id = input.value;
      const imported = card.classList.contains('imported-template');
      const actions = document.createElement('div');
      actions.className = 'template-card-actions';
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'template-card-action ' + (imported ? 'danger' : '');
      action.dataset.templateManageId = id;
      action.dataset.templateManageAction = imported ? 'delete' : 'hide';
      action.textContent = imported ? 'Excluir template' : (hidden.has(id) ? 'Oculto' : 'Ocultar da pasta');
      actions.appendChild(action);
      card.appendChild(actions);
    });
  }

  function hideNativeTemplate(id) {
    const hidden = hiddenTemplateIds();
    hidden.add(id);
    setHiddenTemplateIds(hidden);
    if (selectedTemplate() === id) {
      setRadioValue('template-pro','marketplace');
      applyTemplateProfile('marketplace',{announce:false});
    }
    renderTemplateManagementControls();
    applyHiddenTemplates();
    updateSelectedTemplateSummary();
    status('Modelo ocultado da pasta. Você pode restaurar os modelos nativos quando quiser.', 'ok');
  }

  function restoreNativeTemplates() {
    localStorage.removeItem(HIDDEN_TEMPLATE_STORAGE_KEY);
    renderTemplateManagementControls();
    applyHiddenTemplates();
    status('Todos os modelos nativos voltaram para a pasta.', 'ok');
  }

  function bindTemplateRadios() {
    document.querySelectorAll('input[name="template-pro"]').forEach(input => {
      if (input.dataset.boundTemplate === '1') return;
      input.dataset.boundTemplate = '1';
      input.addEventListener('change',() => applyTemplateProfile(input.value));
    });
  }

  async function importTemplateJson(file) {
    if (!file) return;
    if (file.size > 512 * 1024) throw new Error('Template JSON muito grande. Limite: 512 KB.');
    const raw = await file.text();
    let parsed;
    try { parsed = JSON.parse(raw); } catch { throw new Error('O arquivo não contém JSON válido.'); }
    const manifest = validateTemplateManifest(parsed);
    const existing = importedTemplates.findIndex(item => (item.libraryId || item.id) === manifest.libraryId);
    if (existing >= 0) importedTemplates.splice(existing,1,manifest);
    else importedTemplates.unshift(manifest);
    importedTemplates = importedTemplates.slice(0,30);
    saveImportedTemplates();
    renderImportedTemplates();
    const input = document.querySelector('input[name="template-pro"][value="' + CSS.escape(manifest.libraryId) + '"]');
    if (input) {
      input.checked = true;
      applyTemplateProfile(manifest.libraryId, { announce:false });
    }
    status('Template JSON "' + manifest.label + '" importado e adicionado à biblioteca.', 'ok');
  }

  function removeImportedTemplate(id) {
    importedTemplates = importedTemplates.filter(item => (item.libraryId || item.id) !== id);
    saveImportedTemplates();
    if (selectedTemplate() === id) {
      setRadioValue('template-pro','marketplace');
      applyTemplateProfile('marketplace',{announce:false});
    }
    renderImportedTemplates();
    status('Template importado removido da biblioteca local.', 'ok');
  }

  async function downloadSelectedTemplate() {
    const button = els.downloadTemplateButton;
    const templateId = selectedTemplate();
    const importedManifest = importedTemplateById(templateId);
    if (button) {
      button.disabled = true;
      button.textContent = 'Preparando template...';
    }

    try {
      const manifest = importedManifest || await api('/admin/creative-studio/pro/templates/' + encodeURIComponent(selectedRenderTemplate()));
      const exported = {
        ...manifest,
        selectedConfiguration: {
          generationStyle: selectedGenerationStyle(),
          marketplacePreset: selectedMarketplacePreset(),
          layoutGrammar: selectedLayoutGrammar(),
          objective: campaignObjective(),
          contentMode,
          format: selectedFormat()
        },
        exportedAt: new Date().toISOString(),
        source: 'Ariana Creative Studio Pro'
      };
      const blob = new Blob([JSON.stringify(exported, null, 2)], { type:'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ariana-template-' + templateId + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status('Template "' + (manifest.label || templateId) + '" baixado com as regras do Creative Studio.', 'ok');
    } catch (error) {
      status('Falha ao baixar o template: ' + error.message, 'error');
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = 'Baixar template selecionado';
      }
    }
  }

  const CREATIVE_PWA_SOURCE = 'pwa-creative-studio-pro';

  function isStandaloneDisplay() {
    return window.matchMedia?.('(display-mode: standalone)')?.matches === true
      || window.navigator.standalone === true;
  }

  function isInstalledApp() {
    const source = new URLSearchParams(window.location.search).get('source') || '';
    return isStandaloneDisplay() && source === CREATIVE_PWA_SOURCE;
  }

  function isForeignStandaloneHost() {
    return isStandaloneDisplay() && !isInstalledApp();
  }

  function openInstallerInBrowser(target) {
    const url = target instanceof URL ? target.toString() : String(target || '');
    const isWindowsEdge = /windows/i.test(navigator.userAgent) && /edg\//i.test(navigator.userAgent);
    if (isWindowsEdge) {
      window.location.href = 'microsoft-edge:' + url;
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function bindInstallApp() {
    const button = els.installAppButton;
    if (!button) return;

    const syncButton = () => {
      if (isInstalledApp()) {
        button.classList.add('hidden');
        return;
      }
      button.classList.remove('hidden');
    };

    const waitForInstallPrompt = async (timeoutMs = 2400) => {
      const startedAt = Date.now();
      while (!deferredInstallPrompt && Date.now() - startedAt < timeoutMs) {
        await new Promise(resolve => setTimeout(resolve, 120));
      }
      return deferredInstallPrompt;
    };

    const promptInstallIfReady = async () => {
      if (!deferredInstallPrompt) return false;
      const prompt = deferredInstallPrompt;
      deferredInstallPrompt = null;
      await prompt.prompt();
      const choice = await prompt.userChoice.catch(() => null);
      if (choice?.outcome === 'accepted') {
        status('Instalação iniciada. O Creative Studio ficará disponível como aplicativo.', 'ok');
      } else {
        status('A instalação não foi concluída. O botão continua disponível para tentar novamente.', '');
      }
      syncButton();
      return true;
    };

    syncButton();

    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault();
      deferredInstallPrompt = event;
      syncButton();
    });

    window.addEventListener('appinstalled', () => {
      deferredInstallPrompt = null;
      button.classList.add('hidden');
      status('Creative Studio instalado como aplicativo independente.', 'ok');
    });

    button.addEventListener('click', async () => {
      if (isInstalledApp()) {
        button.classList.add('hidden');
        return;
      }

      if (isForeignStandaloneHost()) {
        const target = new URL(window.location.href);
        target.searchParams.delete('source');
        target.searchParams.set('install', 'creative-studio-pro');
        status('Abrindo o Creative Studio no Edge normal para instalar como aplicativo separado do Ariana ERP...', 'ok');
        openInstallerInBrowser(target);
        return;
      }

      button.disabled = true;
      const originalText = button.textContent;
      button.textContent = 'Preparando...';

      try {
        if (await promptInstallIfReady()) return;

        if ('serviceWorker' in navigator) {
          await Promise.race([
            navigator.serviceWorker.ready.catch(() => null),
            new Promise(resolve => setTimeout(resolve, 1800))
          ]);
        }

        await waitForInstallPrompt(1800);
        if (await promptInstallIfReady()) return;

        const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
        const android = /android/i.test(navigator.userAgent);

        if (android) {
          const target = new URL(window.location.href);
          target.searchParams.set('source', 'pwa-install');
          const fallback = target.toString();
          const intent =
            'intent://' + target.host + target.pathname + target.search +
            '#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=' +
            encodeURIComponent(fallback) + ';end';
          status('Abrindo no Chrome para concluir a instalação do aplicativo...', 'ok');
          window.location.href = intent;
          return;
        }

        const message = ios
          ? 'No iPhone/iPad, toque em Compartilhar e depois em Adicionar à Tela de Início.'
          : 'O navegador ainda não liberou a janela automática. No Edge/Chrome, abra o menu do navegador e escolha Aplicativos > Instalar Ariana Creative Studio Pro.';

        status(message, '');
        window.alert(message);
      } finally {
        if (!isInstalledApp()) {
          button.disabled = false;
          button.textContent = originalText;
          syncButton();
        }
      }
    });
  }

  function bind() {
    els.productSearch.addEventListener('input',event => renderProductResults(event.target.value));
    els.autoHeroButton.addEventListener('click',buildProfessionalHero);

    document.querySelectorAll('[data-hero-catalog-slot]').forEach(button => {
      button.addEventListener('click', () => chooseCatalogForHeroSlot(button.dataset.heroCatalogSlot));
    });
    document.querySelectorAll('[data-hero-bank-slot]').forEach(button => {
      button.addEventListener('click', () => openCutoutBank(Number(button.dataset.heroBankSlot)));
    });
    els.openCutoutBank?.addEventListener('click', () => openCutoutBank(null));
    els.singleCutoutBank?.addEventListener('click', () => openCutoutBank(null));
    els.closeCutoutBank?.addEventListener('click', () => els.cutoutBankDialog?.close());
    els.cutoutBankDialog?.addEventListener('click', event => {
      if (event.target === els.cutoutBankDialog) els.cutoutBankDialog.close();
    });
    els.cutoutBankSearch?.addEventListener('input', event => renderCutoutBankGallery(event.target.value));
    els.cutoutBankGrid?.addEventListener('click', event => {
      const button = event.target.closest('[data-use-cutout-bank]');
      if (!button) return;
      button.disabled = true;
      useCutoutBankAsset(button.dataset.useCutoutBank)
        .catch(error => {
          els.cutoutBankStatus.textContent = error.message;
          els.cutoutBankStatus.className = 'inline-status error';
          button.disabled = false;
        });
    });
    document.querySelectorAll('[data-hero-upload-slot]').forEach(input => {
      input.addEventListener('change', event => uploadHeroSlot(event.target.files?.[0], input.dataset.heroUploadSlot));
    });
    document.querySelectorAll('[data-hero-clear-slot]').forEach(button => {
      button.addEventListener('click', () => clearHeroSlot(button.dataset.heroClearSlot));
    });
    els.imageFile.addEventListener('change',event => uploadImage(event.target.files?.[0]));
    els.brandLogoFile.addEventListener('change',event => uploadBrandLogo(event.target.files?.[0]));

    [
      ['badge', els.badge],
      ['headline', els.headline],
      ['subtitle', els.subtitle],
      ['cta', els.cta]
    ].forEach(([key,input]) => {
      input.addEventListener('input', () => {
        copyTouchedFields.add(key);
        qualityAllowsSave = false;
        els.saveButton.disabled = true;
      });
    });

    document.querySelectorAll('input[name="format"]').forEach(input => input.addEventListener('change',() => {
      updateChoiceCards();
      lastCopyResearchSignature = '';
      qualityAllowsSave = false;
      els.saveButton.disabled = true;
      status('Formato alterado. A IA vai recalcular a direção e os textos na próxima prévia.', 'ok');
    }));
    bindTemplateRadios();
    els.openTemplateLibrary?.addEventListener('click', () => {
      renderImportedTemplates();
      if (typeof els.templateLibraryDialog?.showModal === 'function') els.templateLibraryDialog.showModal();
      else els.templateLibraryDialog?.setAttribute('open','');
    });
    els.closeTemplateLibrary?.addEventListener('click', () => els.templateLibraryDialog?.close());
    els.templateLibraryDialog?.addEventListener('click', event => {
      if (event.target === els.templateLibraryDialog) els.templateLibraryDialog.close();
    });
    byId('template-grid')?.addEventListener('click', event => {
      const button = event.target.closest('[data-template-manage-action]');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      const id = button.dataset.templateManageId || '';
      if (button.dataset.templateManageAction === 'delete') {
        if (window.confirm('Excluir este template JSON da pasta?')) removeImportedTemplate(id);
      } else if (button.dataset.templateManageAction === 'hide') {
        hideNativeTemplate(id);
      }
    });
    els.restoreNativeTemplates?.addEventListener('click', restoreNativeTemplates);
    els.uploadTemplateInput?.addEventListener('change', async event => {
      const file = event.target.files?.[0];
      event.target.value = '';
      try { await importTemplateJson(file); }
      catch (error) { status('Falha ao importar template: ' + error.message, 'error'); }
    });
    els.importedTemplateList?.addEventListener('click', event => {
      const button = event.target.closest('[data-remove-imported-template]');
      if (button) removeImportedTemplate(button.dataset.removeImportedTemplate);
    });
    els.clearImportedTemplates?.addEventListener('click', () => {
      if (!window.confirm('Remover todos os templates JSON importados deste navegador?')) return;
      importedTemplates = [];
      saveImportedTemplates();
      setRadioValue('template-pro','marketplace');
      renderImportedTemplates();
      applyTemplateProfile('marketplace',{announce:false});
      status('Templates JSON importados foram limpos.', 'ok');
    });
    document.querySelectorAll('input[name="generation-style"]').forEach(input => input.addEventListener('change',() => {
      applyGenerationStyle(input.value);
      status(
        input.value === 'marketplace'
          ? 'Marketplace Ariana ativado. Preset, hierarquia e gramática visual serão considerados na próxima prévia.'
          : 'Estilo de geração alterado. A próxima prévia será recalculada sem alterar seus templates existentes.',
        'ok'
      );
    }));
    [els.marketplacePreset, els.layoutGrammar].filter(Boolean).forEach(input => input.addEventListener('change',() => {
      lastCopyResearchSignature = '';
      qualityAllowsSave = false;
      els.saveButton.disabled = true;
      status('Direção Marketplace Ariana alterada. A próxima prévia usará a nova composição.', 'ok');
    }));
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
    els.downloadTemplateButton?.addEventListener('click',downloadSelectedTemplate);
  }

  function start() {
    Object.assign(els,{
      installAppButton:byId('install-app-button'),
      downloadTemplateButton:byId('download-template-button'),
      openTemplateLibrary:byId('open-template-library'),
      closeTemplateLibrary:byId('close-template-library'),
      templateLibraryDialog:byId('template-library-dialog'),
      selectedTemplateSummary:byId('selected-template-summary'),
      restoreNativeTemplates:byId('restore-native-templates'),
      uploadTemplateInput:byId('upload-template-input'),
      importedTemplateList:byId('imported-template-list'),
      clearImportedTemplates:byId('clear-imported-templates'),
      marketplaceControls:byId('marketplace-controls'),
      marketplacePreset:byId('marketplace-preset'),
      layoutGrammar:byId('layout-grammar'),
      autoHeroButton:byId('auto-hero-button'),
      openCutoutBank:byId('open-cutout-bank'),
      singleCutoutBank:byId('single-cutout-bank'),
      cutoutBankDialog:byId('cutout-bank-dialog'),
      closeCutoutBank:byId('close-cutout-bank'),
      cutoutBankSearch:byId('cutout-bank-search'),
      cutoutBankTarget:byId('cutout-bank-target'),
      cutoutBankStatus:byId('cutout-bank-status'),
      cutoutBankGrid:byId('cutout-bank-grid'),
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

    loadImportedTemplates();
    renderImportedTemplates();
    bind();
    bindInstallApp();
    updateChoiceCards();
    applyGenerationStyle();
    applyMode('with_price');
    renderTemplateManagementControls();
    applyHiddenTemplates();
    updateSelectedTemplateSummary();
    renderHeroSlots();
    catalogReadyPromise = loadProducts();
  }

  window.addEventListener('beforeunload', () => {
    for (const url of cutoutBankBlobUrls.values()) revokeObjectUrl(url);
    cutoutBankBlobUrls.clear();
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start);
  else start();
})();