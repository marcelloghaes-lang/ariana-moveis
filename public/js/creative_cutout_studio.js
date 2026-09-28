(() => {
  'use strict';

  const API = String(window.API_BASE || 'https://ariana-backend.onrender.com/api').replace(/\/+$/,'');
  const blobUrls = new Set();
  let currentStatus = 'all';
  let selectedFile = null;

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
    template: $('asset-card-template'),
    total: $('summary-total'),
    pending: $('summary-pending'),
    approved: $('summary-approved'),
    rejected: $('summary-rejected')
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

  async function secureBlobUrl(path) {
    const blob = await api(path, {}, 'blob');
    const url = URL.createObjectURL(blob);
    blobUrls.add(url);
    return url;
  }

  function humanStatus(status) {
    if (status === 'approved') return 'Aprovado';
    if (status === 'rejected') return 'Rejeitado';
    return 'Pendente';
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
    return [
      ['Fundo interno', q.internalBackgroundOk !== false],
      ['Halo', q.whiteHaloOk !== false],
      ['Peças finas', q.thinStructureDamageOk !== false],
      ['Seguro', q.safe !== false]
    ];
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
    if (q.reason && q.reason !== 'ok') {
      message.textContent = 'Quality gate: ' + q.reason;
      message.className = 'asset-message error';
    } else if (asset.status === 'approved') {
      message.textContent = 'PNG mestre aprovado e salvo.';
      message.className = 'asset-message ok';
    }

    node.querySelector('[data-action="approve"]').disabled = !asset.cutoutUrl;

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
    buttons.forEach(item => item.disabled = true);
    message.className = 'asset-message';

    try {
      if (action === 'reprocess' || action === 'ai') {
        message.textContent = action === 'ai'
          ? 'A IA está reconstruindo e validando o mesmo produto. Isso pode levar alguns segundos...'
          : 'Reprocessando o arquivo original...';
        await api('/admin/creative-cutout-studio/assets/' + asset.id + '/reprocess', {
          method:'POST',
          body:JSON.stringify({ mode: action === 'ai' ? 'ai_repair' : 'standard' })
        });
        message.textContent = 'Novo recorte criado.';
        message.className = 'asset-message ok';
      } else if (action === 'approve') {
        await api('/admin/creative-cutout-studio/assets/' + asset.id + '/approve', {
          method:'POST',
          body:'{}'
        });
        message.textContent = 'PNG aprovado no Banco Mestre.';
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

      await Promise.all([loadAssets(), loadSummary()]);
    } catch (error) {
      message.textContent = error.message || 'Falha na operação.';
      message.className = 'asset-message error';
      buttons.forEach(item => item.disabled = false);
    }
  }

  async function loadAssets() {
    setStatus(els.bankStatus, 'Carregando Banco Mestre...');
    const suffix = currentStatus === 'all' ? '' : ('?status=' + encodeURIComponent(currentStatus));
    try {
      const data = await api('/admin/creative-cutout-studio/assets' + suffix);
      const assets = Array.isArray(data.assets) ? data.assets : [];
      els.grid.innerHTML = '';
      if (!assets.length) {
        els.grid.innerHTML = '<div class="empty-state"><strong>Nenhuma imagem neste filtro</strong><span>Adicione uma imagem ou escolha outro status.</span></div>';
      } else {
        for (const asset of assets) els.grid.appendChild(buildCard(asset));
      }
      setStatus(els.bankStatus, assets.length + ' imagem(ns) encontrada(s).', 'ok');
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

  els.filters.addEventListener('click', event => {
    const button = event.target.closest('button[data-status]');
    if (!button) return;
    currentStatus = button.dataset.status || 'all';
    els.filters.querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button));
    loadAssets();
  });

  window.addEventListener('beforeunload', revokeAllBlobUrls);

  if (!authToken()) {
    setStatus(els.bankStatus, 'Faça login no painel administrativo para usar o Cutout Studio.', 'error');
  } else {
    Promise.all([loadSummary(), loadAssets()]);
  }
})();
