(() => {
  'use strict';

  const API = String(window.API_BASE || localStorage.getItem('API_BASE') || 'https://ariana-backend.onrender.com/api').replace(/\/+$/, '');
  const state = {};
  const originalFetch = window.fetch.bind(window);

  function token() {
    try {
      const session = JSON.parse(localStorage.getItem('banner_admin_session') || 'null');
      return localStorage.getItem('admin_token') || session?.token || '';
    } catch (_) {
      return localStorage.getItem('admin_token') || '';
    }
  }

  function bannerIds() {
    return Array.from(document.querySelectorAll('[data-field="imageUrl"][data-banner]'))
      .map(el => String(el.getAttribute('data-banner') || '').trim())
      .filter(Boolean);
  }

  function recommendation(id) {
    if (id === 'index_main') return '1080 × 1080 • destaque principal no celular';
    if (id === 'index_sidebar_vertical') return '1080 × 1350 • peça vertical 4:5';
    if (id === 'footer_banner') return '1080 × 420 • rodapé mobile';
    if (id === 'header_category_banner') return '1080 × 1350 • menu de categorias';
    if (id.startsWith('home_card_') || id.startsWith('index_mini_')) return '1080 × 1080 • formato quadrado';
    if (id.startsWith('index_duo_') || id.startsWith('index_secondary_') || id.startsWith('produto_detail_')) return '1080 × 720 • formato 3:2';
    return '1080 × 1080';
  }

  function injectStyles() {
    if (document.getElementById('ariana-mobile-banner-style')) return;
    const style = document.createElement('style');
    style.id = 'ariana-mobile-banner-style';
    style.textContent = `
      .ariana-device-editor{margin:14px 0;padding:14px;border:1px solid #bfdbfe;border-radius:16px;background:linear-gradient(180deg,#eff6ff 0,#fff 100%)}
      .ariana-device-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px}
      .ariana-device-pill{display:inline-flex;align-items:center;gap:6px;padding:5px 9px;border-radius:999px;background:#dbeafe;color:#0b4aa2;font-size:11px;font-weight:900}
      .ariana-device-note{font-size:11px;color:#64748b;margin-top:5px;line-height:1.4}
      .ariana-mobile-preview{width:100%;min-height:170px;aspect-ratio:1/1;border:1px dashed #93c5fd;border-radius:14px;background:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden;margin-bottom:10px}
      .ariana-mobile-preview img{display:block;width:100%;height:100%;object-fit:contain;background:#fff}
      .ariana-mobile-upload{display:flex;align-items:center;gap:8px;margin-top:8px}
      .ariana-mobile-actions{display:flex;gap:8px;margin-top:8px}
      .ariana-mobile-actions button{flex:1}
      @media(max-width:700px){
        header>div.max-w-6xl{align-items:stretch!important;flex-direction:column!important}
        header>div.max-w-6xl>div:last-child{width:100%;display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px!important}
        header .btn{width:100%;padding:10px 8px;font-size:12px}
        main.max-w-6xl{padding-left:10px!important;padding-right:10px!important}
        .card-h{flex-direction:column!important;align-items:flex-start!important}
        .ariana-mobile-upload{flex-direction:column;align-items:stretch}
        .ariana-mobile-upload .btn{width:100%}
        .ariana-mobile-preview{min-height:220px}
      }
    `;
    document.head.appendChild(style);
  }

  function preview(id, url) {
    const host = document.getElementById('prev-mobile-' + id);
    if (!host) return;
    host.innerHTML = '';
    const value = String(url || '').trim();
    if (!value) {
      host.innerHTML = '<div style="text-align:center;color:#94a3b8;font-size:12px;font-weight:800;padding:20px"><i class="fa-regular fa-image" style="font-size:24px"></i><br><br>Sem arte mobile<br><span style="font-weight:600">O site usará a versão desktop.</span></div>';
      return;
    }
    const img = document.createElement('img');
    img.src = value + (value.includes('?') ? '&' : '?') + 'v=' + Date.now();
    img.alt = 'Prévia mobile ' + id;
    img.loading = 'lazy';
    img.onerror = () => {
      host.innerHTML = '<div style="text-align:center;color:#991b1b;font-size:12px;font-weight:800;padding:20px">Imagem mobile indisponível</div>';
    };
    host.appendChild(img);
  }

  function injectEditor(id) {
    if (!id || document.querySelector('[data-mobile-editor="' + id + '"]')) return;
    const desktopField = document.querySelector('[data-field="imageUrl"][data-banner="' + id + '"]');
    if (!desktopField) return;
    const container = desktopField.closest('.space-y-3') || desktopField.parentElement;
    if (!container) return;

    const block = document.createElement('div');
    block.className = 'ariana-device-editor';
    block.dataset.mobileEditor = id;
    block.innerHTML = `
      <div class="ariana-device-head">
        <div>
          <span class="ariana-device-pill"><i class="fa-solid fa-mobile-screen-button"></i> Arte para celular</span>
          <div class="ariana-device-note">${recommendation(id)}. Se ficar vazio, usa a arte desktop.</div>
        </div>
        <span style="font-size:10px;font-weight:900;color:#94a3b8;text-transform:uppercase">Opcional</span>
      </div>
      <div class="ariana-mobile-preview" id="prev-mobile-${id}"></div>
      <label class="text-xs font-black text-slate-500 uppercase">Image URL • Mobile</label>
      <input class="field ariana-mobile-url" data-field="mobileImageUrl" data-banner="${id}" placeholder="https://..." />
      <div class="ariana-mobile-upload">
        <input type="file" accept="image/png,image/jpeg,image/webp" class="ariana-mobile-file w-full text-sm" data-banner="${id}" />
        <button type="button" class="btn btn-secondary ariana-mobile-upload-btn" data-banner="${id}">
          <i class="fa-solid fa-upload"></i> Carregar mobile
        </button>
      </div>
      <label class="text-xs font-black text-slate-500 uppercase" style="display:block;margin-top:10px">ALT • Mobile</label>
      <input class="field ariana-mobile-alt" data-field="mobileAlt" data-banner="${id}" placeholder="Se vazio, usa o ALT principal" />
      <div class="ariana-mobile-actions">
        <button type="button" class="btn btn-ghost ariana-mobile-clear" data-banner="${id}">
          <i class="fa-solid fa-trash-can"></i> Remover mobile
        </button>
      </div>
    `;

    const linkInput = container.querySelector('[data-field="linkUrl"][data-banner="' + id + '"]');
    let anchor = linkInput;
    if (linkInput && linkInput.previousElementSibling?.tagName === 'LABEL') anchor = linkInput.previousElementSibling;
    if (anchor) container.insertBefore(block, anchor);
    else container.appendChild(block);
    preview(id, '');
  }

  function injectAll() {
    injectStyles();
    bannerIds().forEach(injectEditor);
    bindEditors();
  }

  function markDirty(id) {
    state[id] = state[id] || {};
    state[id].dirty = true;
  }

  function bindEditors() {
    document.querySelectorAll('.ariana-mobile-url').forEach(input => {
      if (input.dataset.mobileBound) return;
      input.dataset.mobileBound = '1';
      input.addEventListener('input', () => {
        const id = input.dataset.banner;
        markDirty(id);
        preview(id, input.value);
      });
    });

    document.querySelectorAll('.ariana-mobile-alt').forEach(input => {
      if (input.dataset.mobileBound) return;
      input.dataset.mobileBound = '1';
      input.addEventListener('input', () => markDirty(input.dataset.banner));
    });

    document.querySelectorAll('.ariana-mobile-clear').forEach(btn => {
      if (btn.dataset.mobileBound) return;
      btn.dataset.mobileBound = '1';
      btn.addEventListener('click', () => {
        const id = btn.dataset.banner;
        const url = document.querySelector('[data-field="mobileImageUrl"][data-banner="' + id + '"]');
        const alt = document.querySelector('[data-field="mobileAlt"][data-banner="' + id + '"]');
        if (url) url.value = '';
        if (alt) alt.value = '';
        markDirty(id);
        preview(id, '');
      });
    });

    document.querySelectorAll('.ariana-mobile-upload-btn').forEach(btn => {
      if (btn.dataset.mobileBound) return;
      btn.dataset.mobileBound = '1';
      btn.addEventListener('click', async () => {
        const id = btn.dataset.banner;
        const fileInput = document.querySelector('.ariana-mobile-file[data-banner="' + id + '"]');
        const file = fileInput?.files?.[0];
        if (!file) {
          alert('Selecione a imagem para celular primeiro.');
          return;
        }
        if (file.size > 20 * 1024 * 1024) {
          alert('A imagem ultrapassa 20 MB.');
          return;
        }

        const auth = token();
        if (!auth) {
          alert('Faça login para carregar a imagem.');
          return;
        }

        btn.disabled = true;
        const old = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando...';
        try {
          const form = new FormData();
          form.append('file', file);
          form.append('path', 'banners');
          form.append('name', id + '-mobile');

          const res = await originalFetch(API + '/admin/uploads', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + auth, 'X-Requested-With': 'ArianaBannerAdmin' },
            body: form
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || data.message || 'Falha no upload mobile.');
          const urlValue = String(data.url || data.downloadURL || data.imageUrl || data.secure_url || '').trim();
          if (!urlValue) throw new Error('O upload terminou sem URL pública.');

          const urlField = document.querySelector('[data-field="mobileImageUrl"][data-banner="' + id + '"]');
          if (urlField) urlField.value = urlValue;
          state[id] = { ...(state[id] || {}), dirty: true, mobileImageUrl: urlValue };
          preview(id, urlValue);

          if (typeof window.saveSingleBannerById === 'function') {
            await window.saveSingleBannerById(id);
          } else {
            document.getElementById('btn-save-all')?.click();
          }
          fileInput.value = '';
        } catch (error) {
          console.error('[banner-mobile] upload:', error);
          alert(error.message || 'Falha ao carregar a arte mobile.');
        } finally {
          btn.disabled = false;
          btn.innerHTML = old;
        }
      });
    });
  }

  function normalizeList(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.banners)) return data.banners;
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(data?.data)) return data.data;
    return [];
  }

  async function loadMobileValues() {
    const auth = token();
    const path = auth ? '/admin/banners' : '/banners';
    try {
      const res = await originalFetch(API + path, {
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          ...(auth ? { Authorization: 'Bearer ' + auth } : {})
        }
      });
      if (!res.ok) return;
      const rows = normalizeList(await res.json());
      for (const raw of rows) {
        const id = String(raw?.slot || raw?.id || raw?.key || '').trim();
        if (!id) continue;
        const mobile = String(raw.mobileImageUrl || raw.mobileImage || raw.imageMobile || raw.mobileUrl || '').trim();
        const mobileAlt = String(raw.mobileAlt || raw.altMobile || raw.alt || '').trim();
        state[id] = { ...(state[id] || {}), mobileImageUrl: mobile, mobileAlt, dirty: false };

        const urlField = document.querySelector('[data-field="mobileImageUrl"][data-banner="' + id + '"]');
        const altField = document.querySelector('[data-field="mobileAlt"][data-banner="' + id + '"]');
        if (urlField && !urlField.dataset.userTouched) urlField.value = mobile;
        if (altField && !altField.dataset.userTouched) altField.value = mobileAlt;
        preview(id, mobile);
      }
    } catch (error) {
      console.warn('[banner-mobile] não foi possível carregar campos mobile:', error);
    }
  }

  function mobileValue(id, field) {
    const selector = '[data-field="' + field + '"][data-banner="' + id + '"]';
    const input = document.querySelector(selector);
    const saved = state[id] || {};
    if (saved.dirty) return String(input?.value || '').trim();
    if (field === 'mobileAlt') return String(input?.value || saved.mobileAlt || '').trim();
    return String(input?.value || saved.mobileImageUrl || '').trim();
  }

  function enrichBanner(item) {
    if (!item || typeof item !== 'object') return item;
    const id = String(item.slot || item.id || item.key || '').trim();
    if (!id) return item;
    const mobileImageUrl = mobileValue(id, 'mobileImageUrl');
    const mobileAlt = mobileValue(id, 'mobileAlt') || String(item.alt || '').trim();
    return {
      ...item,
      mobileImageUrl,
      mobileImage: mobileImageUrl,
      mobileAlt
    };
  }

  function maybeEnrichRequest(url, init = {}) {
    const address = typeof url === 'string' ? url : String(url?.url || '');
    const method = String(init.method || 'GET').toUpperCase();
    if (method !== 'POST' || !/\/admin\/banners(?:\/bulk)?(?:\?|$)/.test(address)) return init;
    if (typeof init.body !== 'string') return init;

    try {
      const parsed = JSON.parse(init.body);
      if (Array.isArray(parsed?.banners)) {
        parsed.banners = parsed.banners.map(enrichBanner);
      } else if (parsed && typeof parsed === 'object') {
        Object.assign(parsed, enrichBanner(parsed));
      }
      return { ...init, body: JSON.stringify(parsed) };
    } catch (_) {
      return init;
    }
  }

  window.fetch = function arianaResponsiveBannerFetch(url, init) {
    return originalFetch(url, maybeEnrichRequest(url, init || {}));
  };

  function boot() {
    injectAll();
    window.setTimeout(() => {
      injectAll();
      loadMobileValues();
    }, 450);
    window.setTimeout(injectAll, 1200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
