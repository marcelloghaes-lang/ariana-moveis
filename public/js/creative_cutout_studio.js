(() => {
  'use strict';

  const API = String(window.API_BASE || 'https://ariana-backend.onrender.com/api').replace(/\/+$/,'');
  const blobUrls = new Set();
  const assetBlobUrls = new Set();
  let currentStatus = 'workspace';
  let selectedFile = null;
  let deferredInstallPrompt = null;
  let processingPollTimer = null;
  let workspaceRefreshPromise = null;
  let lastResumeRefreshAt = 0;

  const $ = id => document.getElementById(id);
  const els = {
    file: $('file-input'),
    localPreview: $('local-preview'),
    dropCopy: $('drop-copy'),
    name: $('product-name'),
    category: $('product-category'),
    sku: $('product-sku'),
    notes: $('product-notes'),
    create: $('create-button'),
    uploadStatus: $('upload-status'),
    bankStatus: $('bank-status'),
    grid: $('asset-grid'),
    filters: $('filters'),
    panelEyebrow: $('panel-eyebrow'),
    panelTitle: $('panel-title'),
    panelHelp: $('panel-help'),
    template: $('asset-card-template'),
    total: $('summary-total'),
    pending: $('summary-pending'),
    approved: $('summary-approved'),
    rejected: $('summary-rejected'),
    installApp: $('install-app-button')
  };

  function authToken() {
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

  async function api(path, options = {}, responseType = 'json') {
    const token = authToken();
    if (!token) {
      throw new Error('Faça login novamente no painel administrativo.');
    }
    const isForm = options.body instanceof FormData;
    const response = await fetch(API + path, {
      ...options,
      headers: {
        Authorization: 'Bearer ' + token,
        ...(isForm ? {} : { 'Content-Type': 'application/json' }),
        ...(options.headers || {})
      }
    });

    if (response.status === 401) {
      throw new Error('Sua sessão expirou. Faça login novamente.');
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || payload.message || ('Falha na operação (' + response.status + ').'));
    }
    return responseType === 'blob' ? response.blob() : response.json();
  }

  function normalize(value = '') {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g,'')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g,' ')
      .trim();
  }

  function inferCategory(value = '') {
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
      ['smart tv','TVs'],
      ['televisor','TVs'],
      ['guarda roupa','Móveis'],
      ['roupeiro','Móveis'],
      ['sofa','Móveis'],
      ['colchao','Móveis']
    ];
    for (const [needle, category] of rules) {
      if (text.includes(needle)) return category;
    }
    return '';
  }

  function cleanFilename(name = '') {
    return String(name || '')
      .replace(/\.[a-z0-9]+$/i,'')
      .replace(/[_-]+/g,' ')
      .replace(/\s+/g,' ')
      .trim();
  }

  function setStatus(el, message = '', type = '') {
    el.textContent = message;
    el.className = 'status' + (type ? ' ' + type : '');
  }


  const CUTOUT_PWA_SOURCE = 'pwa-cutout-studio';

  function isStandaloneDisplay() {
    return window.matchMedia?.('(display-mode: standalone)')?.matches ||
      window.navigator.standalone === true;
  }

  function isInstalledApp() {
    const source = new URLSearchParams(window.location.search).get('source') || '';
    return isStandaloneDisplay() && source === CUTOUT_PWA_SOURCE;
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

  function syncInstallButton() {
    if (!els.installApp) return;
    if (isInstalledApp()) {
      els.installApp.classList.add('hidden');
      return;
    }
    els.installApp.classList.remove('hidden');
    els.installApp.disabled = false;
    els.installApp.textContent = 'Instalar app';
  }

  async function promptInstall() {
    if (!els.installApp) return;

    if (isInstalledApp()) {
      els.installApp.classList.add('hidden');
      return;
    }

    if (isForeignStandaloneHost()) {
      const target = new URL(window.location.href);
      target.searchParams.delete('source');
      target.searchParams.set('install', 'cutout-studio');
      setStatus(
        els.bankStatus,
        'Abrindo o Cutout Studio no Edge normal para instalar como aplicativo separado do Ariana ERP...',
        'ok'
      );
      openInstallerInBrowser(target);
      return;
    }

    els.installApp.disabled = true;
    const originalText = els.installApp.textContent;
    els.installApp.textContent = 'Preparando...';

    try {
      if (!deferredInstallPrompt && 'serviceWorker' in navigator) {
        await Promise.race([
          navigator.serviceWorker.ready.catch(() => null),
          new Promise(resolve => setTimeout(resolve, 1600))
        ]);
      }

      const started = Date.now();
      while (!deferredInstallPrompt && Date.now() - started < 2200) {
        await new Promise(resolve => setTimeout(resolve, 120));
      }

      if (deferredInstallPrompt) {
        const prompt = deferredInstallPrompt;
        deferredInstallPrompt = null;
        await prompt.prompt();
        const choice = await prompt.userChoice.catch(() => null);
        if (choice?.outcome === 'accepted') {
          setStatus(els.bankStatus, 'Instalação iniciada. O Cutout Studio ficará disponível como aplicativo.', 'ok');
        } else {
          setStatus(els.bankStatus, 'A instalação não foi concluída. Você pode tentar novamente.', '');
        }
      } else {
        setStatus(
          els.bankStatus,
          'O navegador ainda não liberou a instalação. No Edge/Chrome, abra o menu do navegador e escolha Instalar aplicativo ou Adicionar à tela inicial.',
          ''
        );
      }
    } catch (error) {
      setStatus(els.bankStatus, error.message || 'Não foi possível iniciar a instalação.', 'error');
    } finally {
      els.installApp.disabled = false;
      els.installApp.textContent = originalText;
      syncInstallButton();
    }
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    syncInstallButton();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    syncInstallButton();
    setStatus(els.bankStatus, 'Ariana Cutout Studio instalado como aplicativo independente.', 'ok');
  });

  function revokeAllBlobUrls() {
    for (const url of blobUrls) {
      try { URL.revokeObjectURL(url); } catch {}
    }
    blobUrls.clear();
  }

  function setLocalPreview(file) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    blobUrls.add(url);
    els.localPreview.src = url;
    els.localPreview.classList.remove('hidden');
    els.dropCopy.classList.add('hidden');
  }

  function revokeAssetBlobUrls() {
    for (const url of assetBlobUrls) {
      try { URL.revokeObjectURL(url); } catch {}
      blobUrls.delete(url);
    }
    assetBlobUrls.clear();
  }

  async function secureBlobUrl(path) {
    const blob = await api(path, {}, 'blob');
    const url = URL.createObjectURL(blob);
    blobUrls.add(url);
    assetBlobUrls.add(url);
    return url;
  }

  function processingActive(asset = {}) {
    if (!asset?.processing) return false;
    const expiresAt = Date.parse(asset.processing.expiresAt || '');
    return !Number.isFinite(expiresAt) || expiresAt > Date.now();
  }

  function processingMessage(asset = {}) {
    const mode = asset?.processing?.mode === 'ai_repair' ? 'A IA está reconstruindo' : 'O recorte está sendo reprocessado';
    return mode + '. Você pode sair desta tela; ao voltar, o resultado será atualizado automaticamente.';
  }

  function restoreCardButtons(card, asset = {}) {
    if (!card) return;
    const busy = processingActive(asset);
    card.querySelectorAll('button[data-action]').forEach(button => {
      if (busy) {
        button.disabled = button.dataset.action !== 'download';
        return;
      }
      button.disabled = button.dataset.action === 'approve' && !asset.cutoutUrl;
    });
  }

  function scheduleProcessingPoll(hasProcessing) {
    if (processingPollTimer) {
      clearTimeout(processingPollTimer);
      processingPollTimer = null;
    }
    if (!hasProcessing) return;

    processingPollTimer = setTimeout(() => {
      processingPollTimer = null;
      if (document.visibilityState === 'visible') {
        refreshWorkspace('processing-poll');
      } else {
        scheduleProcessingPoll(true);
      }
    }, 2800);
  }

  async function refreshWorkspace() {
    if (!authToken()) return;
    if (workspaceRefreshPromise) return workspaceRefreshPromise;
    workspaceRefreshPromise = Promise.all([loadSummary(), loadAssets()])
      .finally(() => { workspaceRefreshPromise = null; });
    return workspaceRefreshPromise;
  }

  function refreshWhenVisible() {
    if (document.visibilityState && document.visibilityState !== 'visible') return;
    const timestamp = Date.now();
    if (timestamp - lastResumeRefreshAt < 700) return;
    lastResumeRefreshAt = timestamp;
    refreshWorkspace('resume');
  }

  function humanStatus(status) {
    if (status === 'approved') return 'Aprovado';
    if (status === 'rejected') return 'Rejeitado';
    return 'Pendente';
  }

  function isFanAsset(asset = {}) {
    return /(?:ventilador|\bfan\b)/i.test(
      [asset.category, asset.name].filter(Boolean).join(' ')
    );
  }

  function syncPanelMode() {
    const master = currentStatus === 'approved';
    if (els.panelEyebrow) els.panelEyebrow.textContent = master ? '📁 BANCO MESTRE' : 'ÁREA DE TRABALHO';
    if (els.panelTitle) els.panelTitle.textContent = master ? 'Imagens aprovadas' : 'Itens para revisar';
    if (els.panelHelp) {
      els.panelHelp.textContent = master
        ? 'Aqui ficam somente os PNGs Mestres já aprovados. Eles não aparecem mais na área de trabalho.'
        : 'Aqui ficam somente itens pendentes, em processamento ou rejeitados. Ao aprovar, o produto sai desta área e vai para o Banco Mestre.';
    }
  }

  function shortMode(mode = '') {
    if (mode === 'ai_repair') return 'IA';
    if (/superres/i.test(mode)) return 'Super-res';
    if (/cloudinary/i.test(mode)) return 'Segmentação';
    return 'Recorte Pro';
  }

  function formatBytes(bytes = 0) {
    const value = Number(bytes || 0);
    if (value < 1024) return value + ' B';
    if (value < 1024 * 1024) return (value / 1024).toFixed(0) + ' KB';
    return (value / 1024 / 1024).toFixed(1) + ' MB';
  }

  function qualityFlags(asset) {
    const q = asset.quality || {};
    const flags = [
      ['Fundo interno', q.internalBackgroundOk !== false],
      ['Halo', q.whiteHaloOk !== false],
      ['Peças finas', q.thinStructureDamageOk !== false],
      ['Seguro', q.safe !== false]
    ];
    if (q.masterResolutionOk !== undefined) {
      flags.splice(3, 0, ['Alta resolução', q.masterResolutionOk !== false]);
    }
    return flags;
  }

  async function loadSummary() {
    try {
      const data = await api('/admin/creative-cutout-studio/summary');
      const s = data.summary || {};
      els.total.textContent = Number(s.total || 0);
      els.pending.textContent = Number(s.pending || 0);
      els.approved.textContent = Number(s.approved || 0);
      els.rejected.textContent = Number(s.rejected || 0);
    } catch (error) {
      console.warn('[Cutout Studio] resumo:', error);
    }
  }

  function buildCard(asset) {
    const node = els.template.content.firstElementChild.cloneNode(true);
    node.dataset.id = asset.id;
    node.querySelector('.asset-category').textContent = asset.category || 'Sem categoria';
    node.querySelector('.asset-name').textContent = asset.name || 'Produto';
    node.querySelector('.asset-meta').textContent = [
      asset.sku ? 'SKU ' + asset.sku : '',
      'v' + Number(asset.version || 1)
    ].filter(Boolean).join(' • ');

    const badge = node.querySelector('.asset-status-badge');
    badge.textContent = humanStatus(asset.status);
    badge.className = 'asset-status-badge ' + (asset.status || 'pending');

    const q = asset.quality || {};
    node.querySelector('.quality-score').textContent = Number(q.score || 0) + '%';
    node.querySelector('.quality-resolution').textContent = asset.processed
      ? Number(asset.processed.width || 0) + '×' + Number(asset.processed.height || 0)
      : '—';
    node.querySelector('.quality-mode').textContent = asset.processMode === 'ai_repair'
      ? 'IA'
      : shortMode(q.removalMode || asset.processMode);

    const flags = node.querySelector('.quality-flags');
    for (const [label, ok] of qualityFlags(asset)) {
      const span = document.createElement('span');
      span.className = 'flag ' + (ok ? 'ok' : 'bad');
      span.textContent = (ok ? '✓ ' : '× ') + label;
      flags.appendChild(span);
    }

    const message = node.querySelector('.asset-message');
    if (processingActive(asset)) {
      badge.textContent = 'Processando';
      badge.className = 'asset-status-badge pending';
      message.textContent = processingMessage(asset);
      message.className = 'asset-message';
    } else if (asset.lastProcessingError?.reason) {
      message.textContent = 'Último processamento não concluiu: ' + asset.lastProcessingError.reason;
      message.className = 'asset-message error';
    } else if (q.reason && q.reason !== 'ok') {
      message.textContent = 'Quality gate: ' + q.reason;
      message.className = 'asset-message error';
    } else if (asset.status === 'approved') {
      message.textContent = 'PNG mestre aprovado e salvo.';
      message.className = 'asset-message ok';
    }


    const aiButton = node.querySelector('[data-action="ai"]');
    if (aiButton && isFanAsset(asset)) {
      aiButton.textContent = 'Reconstruir ventilador HQ';
    }

    if (asset.status === 'approved') {
      node.classList.add('master-card');
      node.querySelectorAll('[data-action="reprocess"], [data-action="ai"], [data-action="approve"], [data-action="reject"]')
        .forEach(button => button.classList.add('hidden'));
    }

    restoreCardButtons(node, asset);

    node.addEventListener('click', event => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      handleAction(node, asset, button.dataset.action, button);
    });

    hydrateCardImages(node, asset).catch(error => {
      const message = node.querySelector('.asset-message');
      message.textContent = error.message || 'Falha ao carregar imagens.';
      message.className = 'asset-message error';
    });

    return node;
  }

  async function hydrateCardImages(node, asset) {
    const originalStage = node.querySelector('.original-stage');
    const cutoutStage = node.querySelector('.cutout-stage');

    const [originalUrl, cutoutUrl] = await Promise.all([
      secureBlobUrl(asset.originalUrl),
      asset.cutoutUrl ? secureBlobUrl(asset.cutoutUrl) : Promise.resolve('')
    ]);

    originalStage.innerHTML = '';
    const original = document.createElement('img');
    original.src = originalUrl;
    original.alt = 'Imagem original de ' + (asset.name || 'produto');
    originalStage.appendChild(original);

    cutoutStage.innerHTML = '';
    if (cutoutUrl) {
      const cutout = document.createElement('img');
      cutout.src = cutoutUrl;
      cutout.alt = 'Recorte de ' + (asset.name || 'produto');
      cutoutStage.appendChild(cutout);
    } else {
      cutoutStage.textContent = 'Sem recorte';
    }
  }

  async function handleAction(card, asset, action, button) {
    const message = card.querySelector('.asset-message');
    const buttons = card.querySelectorAll('button[data-action]');

    if (processingActive(asset) && action !== 'download') {
      message.textContent = processingMessage(asset);
      message.className = 'asset-message';
      return;
    }

    buttons.forEach(item => item.disabled = true);
    message.className = 'asset-message';

    try {
      if (action === 'reprocess' || action === 'ai') {
        message.textContent = action === 'ai'
          ? 'A IA está reconstruindo e validando o mesmo produto. Isso pode levar alguns segundos...'
          : 'Reprocessando o arquivo original...';
        const result = await api('/admin/creative-cutout-studio/assets/' + asset.id + '/reprocess', {
          method:'POST',
          body:JSON.stringify({ mode: action === 'ai' ? 'ai_repair' : 'standard' })
        });
        if (action === 'ai') {
          const rebuilt = result?.asset;
          if (
            rebuilt?.processMode !== 'ai_repair' ||
            rebuilt?.ai?.safe !== true
          ) {
            throw new Error('A IA não confirmou uma reconstrução segura. O recorte anterior foi mantido.');
          }
          message.textContent = 'Nova imagem reconstruída pela IA e validada. Compare antes de aprovar.';
        } else {
          message.textContent = 'Novo recorte criado a partir do original.';
        }
        message.className = 'asset-message ok';
      } else if (action === 'approve') {
        await api('/admin/creative-cutout-studio/assets/' + asset.id + '/approve', {
          method:'POST',
          body:'{}'
        });
        message.textContent = 'PNG aprovado e movido para o Banco Mestre.';
        message.className = 'asset-message ok';
      } else if (action === 'reject') {
        await api('/admin/creative-cutout-studio/assets/' + asset.id + '/reject', {
          method:'POST',
          body:'{}'
        });
        message.textContent = 'Recorte marcado como rejeitado.';
      } else if (action === 'delete') {
        if (!window.confirm('Excluir esta imagem e seus arquivos do Banco Mestre?')) return;
        await api('/admin/creative-cutout-studio/assets/' + asset.id, { method:'DELETE' });
      } else if (action === 'download') {
        const kind = asset.status === 'approved' && asset.approvedUrl ? 'approved' : 'cutout';
        const blob = await api(
          '/admin/creative-cutout-studio/assets/' + asset.id + '/' + kind + '?download=1',
          {},
          'blob'
        );
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = (asset.name || 'produto').replace(/[^a-z0-9]+/gi,'-') + '-recorte.png';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return;
      }

      await refreshWorkspace('action-complete');
    } catch (error) {
      message.textContent = error.message || 'Falha na operação.';
      message.className = 'asset-message error';
      await refreshWorkspace('action-error').catch(() => {});
    } finally {
      restoreCardButtons(card, asset);
    }
  }

  async function loadAssets() {
    syncPanelMode();
    setStatus(
      els.bankStatus,
      currentStatus === 'approved' ? 'Carregando Banco Mestre...' : 'Carregando área de trabalho...'
    );
    const suffix = '?status=' + encodeURIComponent(currentStatus);
    try {
      const data = await api('/admin/creative-cutout-studio/assets' + suffix);
      const assets = Array.isArray(data.assets) ? data.assets : [];
      const processingCount = assets.filter(processingActive).length;
      revokeAssetBlobUrls();
      els.grid.innerHTML = '';
      if (!assets.length) {
        els.grid.innerHTML = currentStatus === 'approved'
          ? '<div class="empty-state"><strong>Banco Mestre vazio</strong><span>Quando você aprovar um PNG, ele será movido para esta pasta.</span></div>'
          : '<div class="empty-state"><strong>Nenhum item para revisar</strong><span>Adicione uma imagem ou escolha outro status.</span></div>';
      } else {
        for (const asset of assets) els.grid.appendChild(buildCard(asset));
      }
      if (processingCount > 0) {
        setStatus(
          els.bankStatus,
          assets.length + ' imagem(ns) • ' + processingCount + ' em processamento. A tela atualiza sozinha.',
          ''
        );
      } else {
        setStatus(els.bankStatus, assets.length + ' imagem(ns) encontrada(s).', 'ok');
      }
      scheduleProcessingPoll(processingCount > 0);
    } catch (error) {
      setStatus(els.bankStatus, error.message || 'Falha ao carregar o Banco Mestre.', 'error');
    }
  }

  async function createAsset() {
    if (!selectedFile) return;
    els.create.disabled = true;
    setStatus(els.uploadStatus, 'Enviando o original e preparando o primeiro recorte...');

    try {
      const form = new FormData();
      form.append('file', selectedFile);
      form.append('name', els.name.value.trim() || cleanFilename(selectedFile.name) || 'Produto');
      form.append('category', els.category.value.trim());
      form.append('sku', els.sku.value.trim());
      form.append('notes', els.notes.value.trim());

      const data = await api('/admin/creative-cutout-studio/assets', {
        method:'POST',
        body:form
      });

      setStatus(
        els.uploadStatus,
        'Imagem adicionada. Compare o original com o recorte e aprove somente quando estiver correto.',
        'ok'
      );

      selectedFile = null;
      els.file.value = '';
      els.localPreview.classList.add('hidden');
      els.dropCopy.classList.remove('hidden');
      els.name.value = '';
      els.category.value = '';
      els.sku.value = '';
      els.notes.value = '';
      await Promise.all([loadAssets(), loadSummary()]);

      if (data.asset?.id) {
        const card = els.grid.querySelector('[data-id="' + data.asset.id + '"]');
        card?.scrollIntoView({ behavior:'smooth', block:'center' });
      }
    } catch (error) {
      setStatus(els.uploadStatus, error.message || 'Falha ao criar o recorte.', 'error');
    } finally {
      els.create.disabled = !selectedFile;
    }
  }

  els.file.addEventListener('change', () => {
    const file = els.file.files?.[0] || null;
    selectedFile = file;
    els.create.disabled = !file;
    if (!file) return;

    if (file.size > 20 * 1024 * 1024) {
      selectedFile = null;
      els.create.disabled = true;
      setStatus(els.uploadStatus, 'A imagem ultrapassa 20 MB.', 'error');
      return;
    }

    setLocalPreview(file);
    const cleanName = cleanFilename(file.name);
    if (!els.name.value.trim()) els.name.value = cleanName;
    if (!els.category.value.trim()) els.category.value = inferCategory(cleanName);
    setStatus(els.uploadStatus, formatBytes(file.size) + ' • arquivo original pronto para envio.');
  });

  els.create.addEventListener('click', createAsset);
  els.installApp?.addEventListener('click', promptInstall);
  syncInstallButton();

  els.filters.addEventListener('click', event => {
    const button = event.target.closest('button[data-status]');
    if (!button) return;
    currentStatus = button.dataset.status || 'workspace';
    els.filters.querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button));
    loadAssets();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshWhenVisible();
  });
  window.addEventListener('focus', refreshWhenVisible);
  window.addEventListener('pageshow', refreshWhenVisible);
  window.addEventListener('online', refreshWhenVisible);
  window.addEventListener('beforeunload', () => {
    if (processingPollTimer) clearTimeout(processingPollTimer);
    revokeAssetBlobUrls();
    revokeAllBlobUrls();
  });

  if (!authToken()) {
    setStatus(els.bankStatus, 'Faça login no painel administrativo para usar o Cutout Studio.', 'error');
  } else {
    refreshWorkspace('initial');
  }
})();
