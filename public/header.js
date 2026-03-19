// header.js (Marketplace Ariana Móveis)
// - Layout profissional e espaçado (desktop + mobile)
// - Mega menu de categorias estilo marketplace
// - Compatível com uso global (window.carregarHeader)

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}


function __headerNormalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function updateQuickCategoryLinks(categories) {
  try {
    const list = Array.isArray(categories) ? categories : [];

    const norm = (s) => String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    const targets = [
      { elId: "quick-cat-informatica", aliases: ["informatica", "informática", "info", "computadores", "computador"] },
      { elId: "quick-cat-smartphones", aliases: ["smartphones", "celulares", "celular", "phone", "telefone"] },
      { elId: "quick-cat-moveis", aliases: ["moveis", "móveis", "mobilia", "mobiliario"] },
      { elId: "quick-cat-smarttv", aliases: ["smart tv", "smarttv", "tv", "televisores", "televisor"] },
    ];

    const findCategory = (aliases) => {
      const aliasSet = new Set(aliases.map(norm));

      for (const c of list) {
        const slug = norm(c.slug || c.key || c.code || "");
        if (slug && aliasSet.has(slug)) return c;
      }

      for (const c of list) {
        const name = norm(c.name || c.nome || "");
        if (name && aliasSet.has(name)) return c;
      }

      for (const c of list) {
        const name = norm(c.name || c.nome || "");
        const slug = norm(c.slug || c.key || c.code || "");
        for (const a of aliasSet) {
          if (a && (name.includes(a) || slug.includes(a) || a.includes(name))) return c;
        }
      }

      return null;
    };

    for (const t of targets) {
      const el = document.getElementById(t.elId);
      if (!el) continue;
      const cat = findCategory(t.aliases);
      if (cat && cat.id) {
        el.href = `categoria.html?id=${encodeURIComponent(cat.id)}`;
      }
    }
  } catch (e) {
    console.warn("[header] falha ao atualizar links rápidos:", e);
  }
}


function __headerIsRootCategory(cat) {
  const parentRaw = cat?.parentId ?? cat?.parent ?? cat?.parent_id ?? cat?.parentID ?? '';
  return String(parentRaw || '').trim() === '';
}

function __headerGetCategoryName(cat) {
  return String(cat?.name || cat?.nome || '').trim();
}

function __headerGetCategorySlug(cat) {
  return String(cat?.slug || cat?.key || cat?.code || __headerGetCategoryName(cat) || '').trim();
}

function __headerGetCategoryOrder(cat) {
  const n = Number(cat?.order ?? cat?.ordem ?? 999999);
  return Number.isFinite(n) ? n : 999999;
}



function __headerResolveCategoryHref(cat) {
  const id = String(cat?.id || '').trim();
  if (id) return `categoria.html?id=${encodeURIComponent(id)}`;
  const slug = String(cat?.slug || cat?.key || cat?.code || cat?.name || cat?.nome || '').trim();
  return `categoria.html?name=${encodeURIComponent(slug)}`;
}

function __headerFallbackParents() {
  return [
    { id: 'eletrodomesticos', name: 'Eletro Domésticos' },
    { id: 'smartphones', name: 'Smartphones' },
    { id: 'climatizacao', name: 'Climatização' },
    { id: 'utilidades-domesticas', name: 'Utilidades Domésticas' },
    { id: 'antenas-tv', name: 'Antenas e Receptores de TV' },
    { id: 'caixa-som', name: 'Caixa de Som' },
    { id: 'eletroportateis', name: 'Eletro Portáteis' },
    { id: 'geladeiras', name: 'Geladeiras & Refrigeradores' },
    { id: 'moveis', name: 'Móveis' },
    { id: 'informatica', name: 'Informática' },
    { id: 'tv', name: 'Smart TV' },
    { id: 'supermercado', name: 'Supermercado' }
  ];
}

async function __resolveHeaderBannerImageUrl(rawUrl) {
  const raw = String(rawUrl || '').trim();
  if (!raw) return '';

  try {
    if (/^(https?:|data:|blob:)/i.test(raw)) return raw;
    if (raw.startsWith('/')) return raw;

    if (raw.startsWith('gs://')) {
      try {
        if (
          typeof window.getStorage === 'function' &&
          typeof window.ref === 'function' &&
          typeof window.getDownloadURL === 'function'
        ) {
          const storage = window.getStorage();
          const storageRef = window.ref(storage, raw);
          return await window.getDownloadURL(storageRef);
        }
      } catch (_) {}

      try {
        if (window.firebase && typeof window.firebase.storage === 'function') {
          const ref = window.firebase.storage().refFromURL(raw);
          return await ref.getDownloadURL();
        }
      } catch (_) {}

      return '';
    }

    return new URL(raw, window.location.href).href;
  } catch (_) {
    return raw;
  }
}

async function __loadHeaderCategoryBanner() {
  const fallback = {
    active: true,
    imageUrl: 'data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%27http%3A//www.w3.org/2000/svg%27%20width%3D%27720%27%20height%3D%27960%27%20viewBox%3D%270%200%20720%20960%27%3E%0A%3Cdefs%3E%3ClinearGradient%20id%3D%27g%27%20x1%3D%270%27%20x2%3D%270%27%20y1%3D%270%27%20y2%3D%271%27%3E%3Cstop%20stop-color%3D%27%231d4ed8%27/%3E%3Cstop%20offset%3D%271%27%20stop-color%3D%27%230b4aa2%27/%3E%3C/linearGradient%3E%3C/defs%3E%0A%3Crect%20width%3D%27720%27%20height%3D%27960%27%20fill%3D%27url%28%23g%29%27/%3E%0A%3Ccircle%20cx%3D%27560%27%20cy%3D%27140%27%20r%3D%2754%27%20fill%3D%27%2322d3ee%27%20opacity%3D%27.35%27/%3E%0A%3Ccircle%20cx%3D%27280%27%20cy%3D%27260%27%20r%3D%27120%27%20fill%3D%27%2360a5fa%27%20opacity%3D%27.20%27/%3E%0A%3Ctext%20x%3D%2760%27%20y%3D%27145%27%20fill%3D%27white%27%20font-size%3D%2756%27%20font-family%3D%27Arial%27%20font-weight%3D%27700%27%3EOFERTAS%3C/text%3E%0A%3Ctext%20x%3D%2760%27%20y%3D%27210%27%20fill%3D%27white%27%20font-size%3D%2756%27%20font-family%3D%27Arial%27%20font-weight%3D%27700%27%3EESPECIAIS%3C/text%3E%0A%3Ctext%20x%3D%2760%27%20y%3D%27330%27%20fill%3D%27%23fde047%27%20font-size%3D%2740%27%20font-family%3D%27Arial%27%20font-weight%3D%27700%27%3EBanner%20carregando%3C/text%3E%0A%3Ctext%20x%3D%2760%27%20y%3D%27390%27%20fill%3D%27%23fde047%27%20font-size%3D%2740%27%20font-family%3D%27Arial%27%20font-weight%3D%27700%27%3Epelo%20Firestore%3C/text%3E%0A%3Crect%20x%3D%2760%27%20y%3D%27780%27%20rx%3D%2720%27%20ry%3D%2720%27%20width%3D%27320%27%20height%3D%2782%27%20fill%3D%27%2322c55e%27/%3E%0A%3Ctext%20x%3D%27105%27%20y%3D%27835%27%20fill%3D%27white%27%20font-size%3D%2738%27%20font-family%3D%27Arial%27%20font-weight%3D%27700%27%3EVER%20OFERTAS%3C/text%3E%0A%3C/svg%3E',
    linkUrl: 'ofertas.html',
    alt: 'Ofertas especiais Ariana Móveis',
    eyebrow: 'Ariana Móveis',
    title: 'Ofertas e departamentos',
    description: 'Navegue pelas categorias da loja e aproveite promoções especiais.',
    ctaText: 'Ver ofertas'
  };

  try {
    const cached = window.__HEADER_CATEGORY_BANNER__;
    if (cached && typeof cached === 'object' && cached.__resolved === true) {
      return { ...fallback, ...cached };
    }

    const hasFirestore =
      !!window.db &&
      typeof window.doc === 'function' &&
      typeof window.getDoc === 'function';

    if (!hasFirestore) {
      const fallbackUrl = await __resolveHeaderBannerImageUrl(fallback.imageUrl);
      return { ...fallback, imageUrl: fallbackUrl || fallback.imageUrl, __resolved: true };
    }

    const snap = await window.getDoc(window.doc(window.db, 'banners', 'header_category_banner'));

    if (!snap || typeof snap.exists !== 'function' || !snap.exists()) {
      const fallbackUrl = await __resolveHeaderBannerImageUrl(fallback.imageUrl);
      const mergedFallback = { ...fallback, imageUrl: fallbackUrl || fallback.imageUrl, __resolved: true };
      window.__HEADER_CATEGORY_BANNER__ = mergedFallback;
      return mergedFallback;
    }

    const data = snap.data() || {};
    const merged = { ...fallback, ...data };

    const rawUrl = String(merged.imageUrl || merged.image || merged.url || fallback.imageUrl || '').trim();
    const resolvedUrl = await __resolveHeaderBannerImageUrl(rawUrl);

    merged.imageUrl = resolvedUrl || (await __resolveHeaderBannerImageUrl(fallback.imageUrl)) || fallback.imageUrl;
    merged.__resolved = true;

    window.__HEADER_CATEGORY_BANNER__ = merged;
    return merged;
  } catch (e) {
    console.warn('[header] falha ao carregar banner da categoria:', e);
    const fallbackUrl = 'data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%27http%3A//www.w3.org/2000/svg%27%20width%3D%27720%27%20height%3D%27960%27%20viewBox%3D%270%200%20720%20960%27%3E%0A%3Cdefs%3E%3ClinearGradient%20id%3D%27g%27%20x1%3D%270%27%20x2%3D%270%27%20y1%3D%270%27%20y2%3D%271%27%3E%3Cstop%20stop-color%3D%27%231d4ed8%27/%3E%3Cstop%20offset%3D%271%27%20stop-color%3D%27%230b4aa2%27/%3E%3C/linearGradient%3E%3C/defs%3E%0A%3Crect%20width%3D%27720%27%20height%3D%27960%27%20fill%3D%27url%28%23g%29%27/%3E%0A%3Ccircle%20cx%3D%27560%27%20cy%3D%27140%27%20r%3D%2754%27%20fill%3D%27%2322d3ee%27%20opacity%3D%27.35%27/%3E%0A%3Ccircle%20cx%3D%27280%27%20cy%3D%27260%27%20r%3D%27120%27%20fill%3D%27%2360a5fa%27%20opacity%3D%27.20%27/%3E%0A%3Ctext%20x%3D%2760%27%20y%3D%27145%27%20fill%3D%27white%27%20font-size%3D%2756%27%20font-family%3D%27Arial%27%20font-weight%3D%27700%27%3EOFERTAS%3C/text%3E%0A%3Ctext%20x%3D%2760%27%20y%3D%27210%27%20fill%3D%27white%27%20font-size%3D%2756%27%20font-family%3D%27Arial%27%20font-weight%3D%27700%27%3EESPECIAIS%3C/text%3E%0A%3Ctext%20x%3D%2760%27%20y%3D%27330%27%20fill%3D%27%23fde047%27%20font-size%3D%2740%27%20font-family%3D%27Arial%27%20font-weight%3D%27700%27%3EBanner%20carregando%3C/text%3E%0A%3Ctext%20x%3D%2760%27%20y%3D%27390%27%20fill%3D%27%23fde047%27%20font-size%3D%2740%27%20font-family%3D%27Arial%27%20font-weight%3D%27700%27%3Epelo%20Firestore%3C/text%3E%0A%3Crect%20x%3D%2760%27%20y%3D%27780%27%20rx%3D%2720%27%20ry%3D%2720%27%20width%3D%27320%27%20height%3D%2782%27%20fill%3D%27%2322c55e%27/%3E%0A%3Ctext%20x%3D%27105%27%20y%3D%27835%27%20fill%3D%27white%27%20font-size%3D%2738%27%20font-family%3D%27Arial%27%20font-weight%3D%27700%27%3EVER%20OFERTAS%3C/text%3E%0A%3C/svg%3E';
    return { active: true, imageUrl: fallbackUrl || 'banner_header_categoria_teste.png', linkUrl: 'ofertas.html', alt: 'Ofertas especiais Ariana Móveis', __resolved: true };
  }
}

function __renderHeaderCategoryLinks(items) {
  const list = Array.isArray(items) ? items : [];
  return list.map((cat) => {
    const name = escapeHtml(String(cat?.displayName || cat?.__displayName || __headerGetCategoryName(cat) || 'Categoria'));
    const href = __headerResolveCategoryHref(cat);
    return `
      <a href="${href}"
         style="display:block;padding:0 0 16px 0;color:#334155;font-size:15px;line-height:1.25;font-weight:700;text-decoration:none;word-break:break-word;"
         onmouseover="this.style.color='#2563eb'"
         onmouseout="this.style.color='#334155'">
        ${name}
      </a>
    `;
  }).join('');
}

function __renderHeaderCategoryBannerCard(data) {
  const d = data && typeof data === 'object' ? data : {};
  const active = d.active !== false;
  const linkUrl = String(d.linkUrl || d.href || 'ofertas.html').trim() || 'ofertas.html';
  const imageUrl = String(d.imageUrl || '').trim();
  const alt = escapeHtml(String(d.alt || d.title || 'Banner Ariana Móveis').trim());
  const eyebrow = escapeHtml(String(d.eyebrow || 'Ariana Móveis').trim());
  const title = escapeHtml(String(d.title || 'Ofertas e departamentos').trim());
  const description = escapeHtml(String(d.description || 'Navegue pelas categorias da loja e aproveite promoções especiais.').trim());
  const ctaText = escapeHtml(String(d.ctaText || 'Ver ofertas').trim());

  if (!active) {
    return `
      <div style="height:100%;min-height:420px;border:1px solid #e5e7eb;border-radius:18px;background:#f8fafc;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;">
        <div>
          <p style="margin:0 0 10px 0;color:#2563eb;font-size:12px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;">Ariana Móveis</p>
          <p style="margin:0;color:#475569;font-size:14px;font-weight:700;">Banner da categoria desativado.</p>
        </div>
      </div>
    `;
  }

  if (imageUrl) {
    return `
      <a href="${linkUrl}" style="display:block;height:100%;min-height:420px;border:1px solid #e5e7eb;border-radius:18px;overflow:hidden;background:#ffffff;text-decoration:none;">
        <img
          src="${imageUrl}"
          alt="${alt}"
          loading="lazy"
          style="display:block;width:100%;height:100%;min-height:420px;object-fit:cover;background:#ffffff;"
          onerror="if(!this.dataset.fallbackApplied){this.dataset.fallbackApplied='1';this.src='data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%27http%3A//www.w3.org/2000/svg%27%20width%3D%27720%27%20height%3D%27960%27%20viewBox%3D%270%200%20720%20960%27%3E%0A%3Cdefs%3E%3ClinearGradient%20id%3D%27g%27%20x1%3D%270%27%20x2%3D%270%27%20y1%3D%270%27%20y2%3D%271%27%3E%3Cstop%20stop-color%3D%27%231d4ed8%27/%3E%3Cstop%20offset%3D%271%27%20stop-color%3D%27%230b4aa2%27/%3E%3C/linearGradient%3E%3C/defs%3E%0A%3Crect%20width%3D%27720%27%20height%3D%27960%27%20fill%3D%27url%28%23g%29%27/%3E%0A%3Ccircle%20cx%3D%27560%27%20cy%3D%27140%27%20r%3D%2754%27%20fill%3D%27%2322d3ee%27%20opacity%3D%27.35%27/%3E%0A%3Ccircle%20cx%3D%27280%27%20cy%3D%27260%27%20r%3D%27120%27%20fill%3D%27%2360a5fa%27%20opacity%3D%27.20%27/%3E%0A%3Ctext%20x%3D%2760%27%20y%3D%27145%27%20fill%3D%27white%27%20font-size%3D%2756%27%20font-family%3D%27Arial%27%20font-weight%3D%27700%27%3EOFERTAS%3C/text%3E%0A%3Ctext%20x%3D%2760%27%20y%3D%27210%27%20fill%3D%27white%27%20font-size%3D%2756%27%20font-family%3D%27Arial%27%20font-weight%3D%27700%27%3EESPECIAIS%3C/text%3E%0A%3Ctext%20x%3D%2760%27%20y%3D%27330%27%20fill%3D%27%23fde047%27%20font-size%3D%2740%27%20font-family%3D%27Arial%27%20font-weight%3D%27700%27%3EBanner%20carregando%3C/text%3E%0A%3Ctext%20x%3D%2760%27%20y%3D%27390%27%20fill%3D%27%23fde047%27%20font-size%3D%2740%27%20font-family%3D%27Arial%27%20font-weight%3D%27700%27%3Epelo%20Firestore%3C/text%3E%0A%3Crect%20x%3D%2760%27%20y%3D%27780%27%20rx%3D%2720%27%20ry%3D%2720%27%20width%3D%27320%27%20height%3D%2782%27%20fill%3D%27%2322c55e%27/%3E%0A%3Ctext%20x%3D%27105%27%20y%3D%27835%27%20fill%3D%27white%27%20font-size%3D%2738%27%20font-family%3D%27Arial%27%20font-weight%3D%27700%27%3EVER%20OFERTAS%3C/text%3E%0A%3C/svg%3E';}else{this.style.display='none';this.parentElement.innerHTML='<div style=&quot;height:100%;min-height:420px;display:flex;align-items:center;justify-content:center;padding:18px;text-align:center;color:#475569;font-weight:700;background:#f8fafc;&quot;>Banner indisponível no momento.</div>';}"
        >
      </a>
    `;
  }

  return `
    <a href="${linkUrl}" style="display:flex;flex-direction:column;justify-content:space-between;height:100%;min-height:420px;border:1px solid rgba(255,255,255,.15);border-radius:18px;overflow:hidden;background:linear-gradient(180deg,#10a5e5 0%,#149ee0 100%);color:#fff;text-decoration:none;">
      <div style="padding:28px 26px 18px;">
        <p style="margin:0 0 18px 0;font-size:11px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;opacity:.82;">${eyebrow}</p>
        <p style="margin:0 0 14px 0;font-size:31px;line-height:1.04;font-weight:900;">${title}</p>
        <p style="margin:0;font-size:14px;line-height:1.7;opacity:.96;">${description}</p>
      </div>
      <div style="padding:22px 26px;background:rgba(0,0,0,.10);font-size:14px;font-weight:900;">
        ${ctaText} <span style="font-size:15px;">→</span>
      </div>
    </a>
  `;
}

async function carregarCategoriasHeader() {
  const grid = document.getElementById('header-categories-grid');
  if (!grid) return;

  grid.innerHTML = `
    <div style="min-width:0;">${'<div style="height:18px"></div>'.repeat(8)}</div>
    <div style="min-width:0;"></div>
    <div style="min-width:0;"></div>
    <div style="min-width:0;">${__renderHeaderCategoryBannerCard(window.__HEADER_CATEGORY_BANNER__ || {})}</div>
  `;

  let categories = Array.isArray(window.__CATEGORIES_CACHE__) ? window.__CATEGORIES_CACHE__ : null;
  if (categories) updateQuickCategoryLinks(categories);

  if (!categories) {
    const hasFirestore =
      !!window.db &&
      typeof window.collection === 'function' &&
      typeof window.getDocs === 'function' &&
      typeof window.query === 'function' &&
      typeof window.orderBy === 'function' &&
      typeof window.limit === 'function';

    if (hasFirestore) {
      try {
        const { collection, getDocs, query, where, orderBy, limit } = window;
        const collectionsToTry = ['categories', 'categorias'];

        let snap = null;
        let lastErr = null;

        for (const cname of collectionsToTry) {
          try {
            const colRef = collection(window.db, cname);

            try {
              snap = await getDocs(
                query(
                  colRef,
                  where('active', '==', true),
                  orderBy('order'),
                  orderBy('name'),
                  limit(500)
                )
              );
            } catch (_) {
              try {
                snap = await getDocs(query(colRef, orderBy('order'), orderBy('name'), limit(500)));
              } catch (_) {
                snap = await getDocs(query(colRef, orderBy('name'), limit(500)));
              }
            }

            if (snap) break;
          } catch (e2) {
            lastErr = e2;
          }
        }

        if (!snap) throw lastErr || new Error('Não foi possível carregar categorias.');
        categories = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        window.__CATEGORIES_CACHE__ = categories;
        updateQuickCategoryLinks(categories);
      } catch (err) {
        console.error('[header] erro ao carregar categorias:', err);
      }
    }
  }

  const bannerData = await __loadHeaderCategoryBanner();

  const sourceList = (Array.isArray(categories) && categories.length ? categories : __headerFallbackParents())
    .filter(c => c && (c.id || c.name || c.nome))
    .filter(c => c.active !== false);

  const byId = new Map();
  for (const cat of sourceList) {
    if (cat && cat.id) byId.set(String(cat.id), cat);
  }

  const deduped = new Map();
  for (const cat of sourceList) {
    const name = __headerGetCategoryName(cat);
    const slug = __headerGetCategorySlug(cat);
    const key = __headerNormalizeText((slug || name || '') + '|' + String(cat.id || ''));
    if (!name || !key) continue;

    const parentRaw = String(cat?.parentId ?? cat?.parent ?? cat?.parent_id ?? cat?.parentID ?? '').trim();
    const parentCat = parentRaw ? byId.get(parentRaw) : null;
    const parentName = parentCat ? __headerGetCategoryName(parentCat) : '';

    const prev = deduped.get(key);
    const current = {
      ...cat,
      __parentName: parentName,
      __displayName: parentName ? `${parentName} • ${name}` : name,
      __isChild: !!parentName
    };

    if (!prev) {
      deduped.set(key, current);
      continue;
    }

    const prevOrder = Number(prev?.order ?? prev?.ordem ?? 999999);
    const currOrder = Number(current?.order ?? current?.ordem ?? 999999);
    if (currOrder < prevOrder) deduped.set(key, current);
  }

  const ordered = Array.from(deduped.values()).sort((a, b) => {
    const aParent = String(a.__parentName || '').trim();
    const bParent = String(b.__parentName || '').trim();

    if (!aParent && bParent) return -1;
    if (aParent && !bParent) return 1;

    const ao = __headerGetCategoryOrder(a);
    const bo = __headerGetCategoryOrder(b);
    if (ao !== bo) return ao - bo;

    const ad = String(a.__displayName || __headerGetCategoryName(a));
    const bd = String(b.__displayName || __headerGetCategoryName(b));
    return ad.localeCompare(bd, 'pt-BR');
  });

  const toRenderable = ordered.map(cat => ({
    ...cat,
    name: cat.__displayName || __headerGetCategoryName(cat)
  }));

  const columns = [[], [], []];
  toRenderable.forEach((cat, idx) => {
    columns[idx % 3].push(cat);
  });

  grid.innerHTML = `
    <div style="min-width:0;">${__renderHeaderCategoryLinks(columns[0])}</div>
    <div style="min-width:0;">${__renderHeaderCategoryLinks(columns[1])}</div>
    <div style="min-width:0;">${__renderHeaderCategoryLinks(columns[2])}</div>
    <div style="min-width:0;">${__renderHeaderCategoryBannerCard(bannerData)}</div>
  `;
}

function getFirebaseAuthUserFromStorage() {
  const stores = [localStorage, sessionStorage];
  for (const store of stores) {
    try {
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (!k || !k.startsWith('firebase:authUser:')) continue;
        const raw = store.getItem(k);
        if (!raw) continue;
        try {
          const obj = JSON.parse(raw);
          if (obj && typeof obj === 'object') return obj;
        } catch (_) {}
      }
    } catch (_) {}
  }
  return null;
}

function clearFirebaseAuthStorage() {
  const stores = [localStorage, sessionStorage];
  for (const store of stores) {
    try {
      const keysToRemove = [];
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (!k) continue;
        if (k.startsWith('firebase:authUser:')) keysToRemove.push(k);
      }
      keysToRemove.forEach(k => {
        try { store.removeItem(k); } catch (_) {}
      });
    } catch (_) {}
  }
}

function getLoggedUserName() {
  const stores = [localStorage, sessionStorage];
  const nameFields = [
    'nome', 'name', 'fullName', 'nomeCompleto', 'displayName', 'usuario', 'userName', 'username',
    'firstName', 'primeiroNome', 'nomeCliente', 'nome_cliente', 'clienteNome', 'cliente_nome',
    'nomeUsuario', 'nome_usuario'
  ];

  const extractNameFromObject = (obj) => {
    if (!obj || typeof obj !== 'object') return null;

    for (const f of nameFields) {
      const v = obj[f];
      if (v && String(v).trim()) return String(v).trim();
    }

    const nestedCandidates = [obj.user, obj.usuario, obj.cliente, obj.profile, obj.perfil, obj.data, obj.payload].filter(Boolean);
    for (const n of nestedCandidates) {
      if (!n || typeof n !== 'object') continue;
      for (const f of nameFields) {
        const v = n[f];
        if (v && String(v).trim()) return String(v).trim();
      }
    }
    return null;
  };

  const looksLikeJson = (t) => (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'));

  const commonKeys = [
    'clienteLogado',
    'usuarioLogado',
    'loggedUser',
    'authUser',
    'currentUser',
    'userData',
    'userProfile',
    'userInfo',
    'perfilUsuario',
  ];

  const readFromStore = (store) => {
    for (const key of commonKeys) {
      const raw = store.getItem(key);
      if (!raw) continue;
      const t = String(raw).trim();
      if (t && t.length <= 120 && !looksLikeJson(t)) return t;
      if (looksLikeJson(t)) {
        try {
          const obj = JSON.parse(t);
          const nm = extractNameFromObject(obj);
          if (nm) return nm;
        } catch (_) {}
      }
    }
    return null;
  };

  for (const s of stores) {
    const nm = readFromStore(s);
    if (nm) return nm;
  }

  const fb = getFirebaseAuthUserFromStorage();
  if (fb) {
    const nm = (fb.displayName || fb.email || '').toString().trim();
    if (nm) return nm.includes('@') ? nm.split('@')[0] : nm;
  }

  return null;
}

function isUserLoggedIn() {
  try {
    const nm = (typeof getLoggedUserName === 'function') ? getLoggedUserName() : null;
    const nmStr = String(nm ?? '').trim();
    const isPlaceholderName = /^(minha conta|cliente|ol[aá],?\s*cliente)$/i.test(nmStr);
    if (nmStr && !isPlaceholderName) return true;

    const fb = (typeof getFirebaseAuthUserFromStorage === 'function') ? getFirebaseAuthUserFromStorage() : null;
    if (fb) {
      if (fb.isAnonymous === true) return false;
      if (fb.email || fb.phoneNumber) return true;

      if (Array.isArray(fb.providerData) && fb.providerData.some(p => p && p.providerId && p.providerId !== 'anonymous')) {
        return true;
      }
    }

    if (window.auth && window.auth.currentUser && !window.auth.currentUser.isAnonymous) return true;
  } catch (_) {}

  return false;
}

function getLoggedUserCity() {
  const candidates = [
    'selectedAddress', 'enderecoSelecionado', 'userAddress', 'enderecoUsuario',
    'addresses', 'enderecos', 'userProfile', 'usuario', 'usuarioLogado',
    'currentUser', 'loggedUser', 'userData'
  ];

  const readJson = (k) => {
    try {
      const raw = localStorage.getItem(k) ?? sessionStorage.getItem(k);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  const pickCity = (obj) => {
    if (!obj) return '';
    if (typeof obj === 'string') return obj;
    const direct = obj.city || obj.cidade || obj.municipio;
    if (typeof direct === 'string' && direct.trim()) return direct.trim();

    const endereco = obj.address || obj.endereco;
    if (endereco && typeof endereco === 'object') {
      const c = endereco.city || endereco.cidade || endereco.municipio;
      if (typeof c === 'string' && c.trim()) return c.trim();
    }

    const arr = Array.isArray(obj) ? obj : (Array.isArray(obj.addresses) ? obj.addresses : (Array.isArray(obj.enderecos) ? obj.enderecos : null));
    if (Array.isArray(arr) && arr.length) {
      for (const item of arr) {
        const c = pickCity(item);
        if (c) return c;
      }
    }
    return '';
  };

  for (const key of candidates) {
    const data = readJson(key);
    const city = pickCity(data);
    if (city) return city;
  }

  return '';
}


function getLoggedUserCityUF() {
  const keys = [
    'selectedAddress',
    'enderecoSelecionado',
    'checkoutAddress',
    'enderecoEntrega',
    'userAddress',
    'address',
    'endereco',
    'clienteEndereco',
    'clienteLogado',
    'usuarioLogado',
    'loggedUser',
    'currentUser',
    'userData',
    'userProfile',
    'userInfo',
    'perfilUsuario',
    'headerCityUF'
  ];

  const pickFromObject = (obj) => {
    if (!obj) return '';

    if (typeof obj === 'string') {
      const txt = obj.trim();
      if (!txt || txt === 'Minha conta' || txt === 'Defina seu endereço') return '';
      return txt;
    }

    const city = String(
      obj.city ??
      obj.cidade ??
      obj.localidade ??
      obj.municipio ??
      obj.município ??
      obj.cityName ??
      obj.nomeCidade ??
      ''
    ).trim();

    const uf = String(
      obj.uf ??
      obj.UF ??
      obj.state ??
      obj.estado ??
      obj.federal_unit ??
      obj.ufSigla ??
      obj.siglaUf ??
      ''
    ).trim();

    if (city && uf) return `${city} - ${uf}`;
    if (city) return city;

    const nested = [
      obj.address,
      obj.endereco,
      obj.shippingAddress,
      obj.deliveryAddress,
      obj.defaultAddress,
      obj.primaryAddress,
      obj.clienteEndereco
    ].filter(Boolean);

    for (const item of nested) {
      const found = pickFromObject(item);
      if (found) return found;
    }

    const arrays = [obj.addresses, obj.enderecos, obj.listaEnderecos].filter(Array.isArray);
    for (const arr of arrays) {
      for (const item of arr) {
        const found = pickFromObject(item);
        if (found) return found;
      }
    }

    return '';
  };

  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key) || sessionStorage.getItem(key);
      if (!raw) continue;

      let data = null;
      try {
        data = JSON.parse(raw);
      } catch (_) {
        data = raw;
      }

      const found = pickFromObject(data);
      if (found) return found;
    } catch (_) {}
  }

  try {
    const cached = String(window.__HEADER_CITY_UF__ || '').trim();
    if (cached && cached !== 'Minha conta' && cached !== 'Defina seu endereço') return cached;
  } catch (_) {}

  return '';
}




function updateHeaderCityDisplay() {
  const legacyEl = document.getElementById('client-city-display');
  const sub = document.getElementById('auth-subtitle');
  const accountBtn = document.getElementById('account-btn');

  const cached = String(window.__HEADER_CITY_UF__ || '').trim();
  const stored = String(getLoggedUserCityUF() || '').trim();
  const cityUF = stored || cached || '';

  if (cityUF) {
    window.__HEADER_CITY_UF__ = cityUF;
  }

  const text = cityUF || 'Defina seu endereço';

  if (legacyEl) legacyEl.textContent = text;
  if (sub) sub.textContent = text;
  if (accountBtn) accountBtn.setAttribute('data-cityuf', text);
}

function atualizarUsuarioHeader() {
  const name = getLoggedUserName();
  const firebaseUser = window.auth?.currentUser || getFirebaseAuthUserFromStorage() || null;

  const logged =
    !!String(name || '').trim() ||
    !!(firebaseUser && firebaseUser.isAnonymous !== true && (firebaseUser.email || firebaseUser.phoneNumber || firebaseUser.uid));

  const elTop = document.getElementById('header-user-name') || document.getElementById('client-status-display-top');
  const elLegacy = document.getElementById('client-status-display');
  const legacyLink = document.getElementById('client-account-link');

  const displayName = String(name || firebaseUser?.displayName || firebaseUser?.email || '').trim();
  const firstName = displayName ? (displayName.includes('@') ? displayName.split('@')[0] : displayName.split(/\s+/)[0]) : '';

  const apply = (el) => {
    if (!el) return;

    if (logged && firstName) {
      el.textContent = `Olá, ${firstName}`;
      el.title = displayName;
    } else {
      el.textContent = 'Minha conta';
      el.title = '';
    }
  };

  if (legacyLink) {
    legacyLink.setAttribute('href', logged ? 'minha_conta.html' : `login_cadastro.html?redirect=${encodeURIComponent(getLocalRedirectTarget())}`);
  }

  apply(elTop);
  apply(elLegacy);

  if (typeof window.renderAccountPopover === 'function') window.renderAccountPopover();
  updateHeaderCityDisplay();
}


window.refreshHeaderUser = atualizarUsuarioHeader;

window.setLoggedUserName = function (userOrName) {
  try {
    if (userOrName && typeof userOrName === 'object') localStorage.setItem('clienteLogado', JSON.stringify(userOrName));
    else if (userOrName) localStorage.setItem('clienteLogado', String(userOrName));
  } catch (_) {}
  try { window.dispatchEvent(new Event('user:updated')); } catch (_) {}
  atualizarUsuarioHeader();
};

function getLocalRedirectTarget() {
  try {
    const path = (window.location.pathname || '');
    const file = path.split('/').filter(Boolean).pop() || 'index.html';
    const search = window.location.search || '';
    const hash = window.location.hash || '';
    return `${file}${search}${hash}`;
  } catch (_) {
    return 'index.html';
  }
}

function loadCartCounter() {
  const el = document.getElementById('cart-counter-nav');
  if (!el) return;

  const keys = ['ariana_moveis_cart', 'arianaMoveisCart', 'cart', 'carrinho', 'cartItems', 'shoppingCart'];
  let raw = null;

  for (const k of keys) {
    raw = localStorage.getItem(k);
    if (raw && String(raw).trim() && raw !== 'null') break;
    raw = null;
  }

  let total = 0;
  if (raw) {
    try {
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        total = data.reduce((sum, it) => {
          const q = Number(it?.quantity);
          return sum + (Number.isFinite(q) ? q : 1);
        }, 0);
      } else if (data && typeof data === 'object') {
        total = Object.values(data).reduce((sum, it) => {
          const q = Number(it?.quantity);
          return sum + (Number.isFinite(q) ? q : 1);
        }, 0);
      }
    } catch (_) {
      total = 0;
    }
  }

  if (!Number.isFinite(total) || total < 0) total = 0;
  total = Math.floor(total);
  el.textContent = String(total);
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getSearchQueryFromInputs() {
  const desktop = document.getElementById('search-input-desktop');
  const mobile = document.getElementById('search-input-mobile');
  return String(desktop?.value || mobile?.value || '').trim();
}

function redirectToSearch(query) {
  const q = String(query || '').trim();
  if (!q) {
    window.location.href = 'todos_produtos.html';
    return;
  }
  window.location.href = `busca.html?q=${encodeURIComponent(q)}`;
}

window.applySearchFilter = function(eventOrQuery = null) {
  if (eventOrQuery && typeof eventOrQuery.preventDefault === 'function') {
    eventOrQuery.preventDefault();
  }

  const queryText = typeof eventOrQuery === 'string'
    ? String(eventOrQuery || '').trim()
    : getSearchQueryFromInputs();

  redirectToSearch(queryText);
};

function setupSearchListeners() {
  const searchInputDesktop = document.getElementById('search-input-desktop');
  const searchInputMobile = document.getElementById('search-input-mobile');

  const syncInputs = (source, target) => {
    if (!source || !target) return;
    source.addEventListener('input', () => {
      target.value = source.value;
    });
  };

  syncInputs(searchInputDesktop, searchInputMobile);
  syncInputs(searchInputMobile, searchInputDesktop);

  const params = new URLSearchParams(window.location.search);
  const urlQuery = params.get('q') || params.get('query') || params.get('busca') || '';
  if (urlQuery) {
    if (searchInputDesktop) searchInputDesktop.value = urlQuery;
    if (searchInputMobile) searchInputMobile.value = urlQuery;
  }
}

function carregarHeader() {
  const headerHTML = `
  <header class="w-full z-50 bg-white shadow-xl font-sans">

    <style>
      @keyframes arianaFloat {
        0%, 100% { transform: translateY(0px); }
        50% { transform: translateY(-6px); }
      }
      @keyframes arianaPulse {
        0%, 100% { opacity: .82; }
        50% { opacity: 1; }
      }

      .ariana-logo-gradient{
        background: linear-gradient(90deg, #ffffff 0%, rgba(255,255,255,.92) 45%, rgba(147,197,253,1) 100%);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        text-shadow: 0 2px 10px rgba(255,255,255,.18);
        filter: drop-shadow(0 10px 18px rgba(0,0,0,.22));
      }
    </style>

    <div class="hidden md:block bg-gray-50 text-gray-500 text-[11px] border-b border-gray-200">
      <div class="max-w-[1440px] mx-auto px-3 sm:px-6 py-2 flex items-center justify-between">
        <div class="flex items-center gap-6 font-bold uppercase tracking-wider">
          <a href="rastreio.html" class="hover:text-primary-blue transition-colors">Rastrear Pedido</a>
          <a href="quem_somos.html" class="hover:text-primary-blue transition-colors">Nossas Lojas</a>
          <a href="contato.html" class="hover:text-primary-blue transition-colors">Atendimento</a>
        </div>
        <div class="flex items-center gap-6">
          <div class="flex items-center gap-2">
            <i class="fas fa-truck text-primary-blue"></i>
            <span>Frete fixo para diversas regiões</span>
          </div>
          <div class="w-px h-3 bg-gray-300"></div>
          <div class="flex items-center gap-2 font-black text-primary-blue">
            <i class="fab fa-whatsapp"></i>
            <span>Compre pelo Whats: (31) 98514-7119</span>
          </div>
        </div>
      </div>
    </div>

    <div class="bg-primary-blue text-white py-4 md:py-6">
      <div class="max-w-[1440px] mx-auto px-3 sm:px-6 flex items-center gap-3 sm:gap-6 md:gap-10">

        <div class="flex items-center flex-shrink-0 min-w-0 md:min-w-[260px] pr-2 gap-3">
          <a href="index.html" class="relative group flex items-center">
            <img 
              src="assets/imagens/avatar-ariana.png"
              alt="Ariana Móveis"
              class="w-12 h-12 md:w-14 md:h-14 object-contain rounded-full bg-white shadow-lg ring-2 ring-white/30 transition-transform duration-300 group-hover:scale-[1.10]"
              style="animation: arianaFloat 3s ease-in-out infinite;"
            >
            <span
              class="hidden md:flex items-center gap-2 ml-3 px-3 py-1.5 rounded-full bg-white/10 border border-white/15 text-[11px] font-black uppercase tracking-wider text-white backdrop-blur-sm transition-all duration-300 group-hover:bg-white/20 group-hover:border-white/25"
              style="animation: arianaPulse 3s ease-in-out infinite;"
            >
              <span class="inline-block w-2 h-2 rounded-full bg-green-400"></span>
              feita pra você
            </span>
          </a>

          <a href="index.html"
            class="flex items-baseline gap-2 text-2xl md:text-4xl font-black tracking-tighter hover:text-secondary-light-blue transition-all select-none whitespace-nowrap italic leading-none">
            <span class="ariana-logo-gradient">ARIANA</span>
            <span class="text-secondary-light-blue text-sm md:text-lg font-black tracking-wide leading-none">MÓVEIS</span>
          </a>
        </div>

        <form class="hidden lg:flex flex-1 max-w-[920px] mx-auto group" onsubmit="window.applySearchFilter(event)">
          <div class="relative flex w-full">
            <input type="search" id="search-input-desktop"
              placeholder="O que você está procurando hoje?"
              class="w-full h-14 pl-6 pr-14 text-black rounded-xl border-none focus:ring-4 focus:ring-secondary-light-blue/30 transition-all text-lg shadow-inner">
            <button type="submit"
              class="absolute right-0 top-0 h-14 px-6 bg-secondary-light-blue text-primary-blue rounded-r-xl hover:bg-white transition-colors">
              <i class="fas fa-search text-xl"></i>
            </button>
          </div>
        </form>

        <div class="flex items-center gap-4 md:gap-8">

          <div class="relative">
            <button type="button" id="account-btn"
              class="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-white/10 transition-all group"
              aria-haspopup="true" aria-expanded="false">
              <div class="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center group-hover:bg-secondary-light-blue transition-colors">
                <i class="fas fa-user text-xl text-white group-hover:text-primary-blue"></i>
              </div>
              <div class="hidden xl:block text-left leading-tight">
                <p class="text-[10px] uppercase font-black opacity-60">Entrar / Conta</p>
                <p id="header-user-name" class="text-sm font-bold truncate max-w-[130px]">Minha conta</p>
                <p id="auth-subtitle" class="text-[11px] opacity-80 -mt-0.5 truncate max-w-[180px]">Defina seu endereço</p>
              </div>
              <i id="account-caret" class="fas fa-chevron-down text-[10px] opacity-50"></i>
            </button>

            <div id="account-popover"
              class="hidden fixed md:absolute right-3 md:right-0 top-[88px] md:top-auto md:mt-4 w-[calc(100vw-24px)] md:w-[320px] max-w-[320px] bg-white text-gray-900 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.3)] border border-gray-100 overflow-hidden z-[120]">
              <div id="account-popover-inner"></div>
            </div>
          </div>

          <div class="relative">
            <a id="cart-link" href="carrinho.html" class="flex-shrink-0 flex items-center gap-3 p-2 hover:bg-white/10 rounded-xl transition-all group">
              <div class="relative">
                <i class="fas fa-shopping-basket text-3xl text-secondary-light-blue"></i>
                <span id="cart-counter-nav"
                    class="absolute -top-2 -right-2 bg-red-600 text-white text-[11px] font-black rounded-full w-6 h-6 flex items-center justify-center border-2 border-primary-blue shadow-lg">0</span>
              </div>
            </a>
          </div>

          <button id="menu-mobile-trigger" class="md:hidden text-3xl p-2 rounded-lg hover:bg-white/10">
            <i class="fas fa-bars"></i>
          </button>
        </div>
      </div>
    </div>

    <div class="lg:hidden px-6 pb-4 bg-primary-blue">
      <form class="relative flex w-full" onsubmit="window.applySearchFilter(event)">
        <input type="search" id="search-input-mobile" placeholder="O que você procura hoje?"
          class="w-full h-12 pl-5 pr-14 text-black rounded-xl border-none focus:outline-none text-base shadow-lg">
        <button type="submit" class="absolute right-0 top-0 h-full px-5 text-primary-blue">
          <i class="fas fa-search text-lg"></i>
        </button>
      </form>
    </div>

    <div class="hidden md:block bg-white border-b border-gray-200">
      <div class="max-w-[1440px] mx-auto px-3 sm:px-6 flex items-center justify-between">
        <nav class="flex items-center gap-2">

          <div class="relative group py-4">
            <button id="category-dropdown-btn" type="button"
              class="flex items-center gap-3 px-5 py-2.5 bg-primary-blue text-white rounded-xl hover:bg-blue-800 transition-all font-black uppercase text-xs tracking-widest shadow-md">
              <i class="fas fa-bars"></i>
              <span>Todas Categorias</span>
              <i class="fas fa-caret-down transition-transform duration-300" id="category-icon"></i>
            </button>

            <div id="category-dropdown"
              class="absolute left-0 mt-4 bg-white text-gray-800 rounded-2xl border border-gray-100 z-50 hidden overflow-hidden"
              style="width:min(1240px,96vw);box-shadow:0 25px 50px -12px rgba(0,0,0,.25);">
              <div class="p-8">
                <div class="flex items-center justify-between mb-6 border-b pb-4">
                  <div class="flex items-center gap-3">
                    <div class="w-1 bg-primary-blue h-6"></div>
                    <p class="font-black text-lg tracking-wide text-gray-900">Todas Categorias</p>
                  </div>
                  <a href="todos_produtos.html" class="text-sm font-bold text-primary-blue hover:underline decoration-2">
                    Ver catálogo completo <i class="fas fa-arrow-right ml-1"></i>
                  </a>
                </div>

                <div id="header-categories-grid" class="items-stretch"
                     style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) 320px;gap:32px;align-items:start;">
                  <div class="space-y-4">
                    <p class="text-xs font-black uppercase tracking-[0.2em] text-primary-blue/50">Carregando...</p>
                    <div class="flex flex-col gap-2">
                      <span class="text-[14px] font-medium text-gray-400">Aguarde</span>
                    </div>
                  </div>
                  <div></div><div></div>
                  <div class="bg-gray-50 p-6 rounded-2xl flex flex-col justify-center border border-gray-100">
                    <p class="font-black text-primary-blue text-sm mb-2 uppercase">Ofertas VIP</p>
                    <p class="text-xs text-gray-500 mb-4">Receba descontos exclusivos direto no seu WhatsApp.</p>
                    <a href="https://wa.me/5531985147119" class="bg-green-500 text-white text-center py-3 rounded-xl font-bold hover:bg-green-600 transition-colors">Participar agora</a>
                  </div>
                </div>

              </div>
            </div>
          </div>

          <ul class="flex items-center gap-8 ml-6 font-bold text-gray-600 text-sm uppercase tracking-tight">
            <li><a href="ofertas.html" class="hover:text-primary-blue transition-colors flex items-center gap-2"><i class="fas fa-bolt text-yellow-500"></i> Ofertas</a></li>
            <li><a id="quick-cat-informatica" href="categoria.html?name=informatica" class="hover:text-primary-blue transition-colors">Informática</a></li>
            <li><a id="quick-cat-smartphones" href="categoria.html?name=celulares" class="hover:text-primary-blue transition-colors">Smartphones</a></li>
            <li><a id="quick-cat-moveis" href="categoria.html?name=moveis" class="hover:text-primary-blue transition-colors">Móveis</a></li>
            <li><a id="quick-cat-smarttv" href="categoria.html?name=smart%20tv" class="hover:text-primary-blue transition-colors">Smart TV</a></li>
          </ul>
        </nav>

        <div class="hidden lg:flex items-center gap-6 text-[11px] font-black uppercase text-gray-400">
          <div class="flex items-center gap-2"><i class="fas fa-credit-card text-primary-blue"></i> 12x no Cartão</div>
          <div class="flex items-center gap-2"><i class="fas fa-barcode text-primary-blue"></i> 17% OFF no PIX</div>
        </div>
      </div>
    </div>

    <div id="mobile-sidebar" class="hidden fixed inset-0 z-[100] md:hidden">
      <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" id="mobile-overlay"></div>
      <div class="absolute left-0 top-0 h-full w-4/5 max-w-xs bg-white text-black shadow-2xl p-6 flex flex-col">
        <div class="flex justify-between items-center mb-8">
          <span class="font-black text-2xl text-primary-blue italic">ARIANA</span>
          <button id="close-mobile-menu" class="p-2 rounded-lg hover:bg-gray-100">
            <i class="fas fa-times text-2xl text-gray-400"></i>
          </button>
        </div>
        <p class="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4 border-b pb-2">Menu de Navegação</p>
        <ul class="flex flex-col space-y-2 font-bold text-gray-800">
          <li><a href="index.html" class="flex items-center gap-4 p-4 hover:bg-gray-50 rounded-2xl transition-all"><i class="fas fa-home text-primary-blue w-6"></i> Início</a></li>
          <li><a href="todos_produtos.html" class="flex items-center gap-4 p-4 hover:bg-gray-50 rounded-2xl transition-all"><i class="fas fa-shopping-bag text-primary-blue w-6"></i> Produtos</a></li>
          <li><a href="ofertas.html" class="flex items-center gap-4 p-4 hover:bg-gray-50 rounded-2xl transition-all"><i class="fas fa-fire text-red-500 w-6"></i> Ofertas</a></li>
          <li><a href="contato.html" class="flex items-center gap-4 p-4 hover:bg-gray-50 rounded-2xl transition-all"><i class="fas fa-headset text-primary-blue w-6"></i> Atendimento</a></li>
        </ul>
        <div class="mt-auto pt-6 border-t border-gray-100">
          <a href="https://wa.me/5531985147119" target="_blank"
            class="w-full flex items-center justify-center gap-3 bg-green-500 text-white font-black py-4 rounded-2xl hover:bg-green-600 transition-all shadow-lg shadow-green-200">
            <i class="fab fa-whatsapp text-xl"></i> WhatsApp Oficial
          </a>
        </div>
      </div>
    </div>
  </header>
  `;

  document.body.insertAdjacentHTML('afterbegin', headerHTML);
  configurarEventosHeader();
  setupSearchListeners();

  if (typeof window.bindHeaderAuthListener === "function") {
    window.bindHeaderAuthListener(window.auth || null);
  } else {
    console.warn("[header] bindHeaderAuthListener não carregou (header_auth_fix.js ausente/404).");
  }

  atualizarUsuarioHeader();
  updateHeaderCityDisplay();
  loadCartCounter();
  setTimeout(carregarCategoriasHeader, 150);

  if (!window.__HEADER_EVENTS_BOUND__) {
    window.__HEADER_EVENTS_BOUND__ = true;

    window.addEventListener('user:updated', () => {
      atualizarUsuarioHeader();
      updateHeaderCityDisplay();
    });

    window.addEventListener('storage', () => {
      atualizarUsuarioHeader();
      updateHeaderCityDisplay();
      loadCartCounter();
    });

    window.addEventListener('firebase:ready', () => {
      try { delete window.__HEADER_CATEGORY_BANNER__; } catch (_) {}
      atualizarUsuarioHeader();
      updateHeaderCityDisplay();
      setTimeout(() => {
        try { carregarCategoriasHeader(); } catch (_) {}
      }, 250);
    });
  }

  if (window.auth && typeof window.auth.onAuthStateChanged === 'function' && !window.__HEADER_AUTH_OBSERVER__) {
    window.__HEADER_AUTH_OBSERVER__ = true;

    window.auth.onAuthStateChanged((user) => {
      try {
        if (user && !user.isAnonymous) {
          localStorage.setItem('clienteLogado', JSON.stringify({
            nome: user.displayName || (user.email ? user.email.split('@')[0] : 'Cliente'),
            email: user.email || null,
            uid: user.uid || null
          }));
        }
      } catch (_) {}

      atualizarUsuarioHeader();
      updateHeaderCityDisplay();
    });
  }
}



function configurarEventosHeader() {
  const catBtn = document.getElementById('category-dropdown-btn');
  const catMenu = document.getElementById('category-dropdown');
  const catIcon = document.getElementById('category-icon');
  const cartLink = document.getElementById('cart-link');

  cartLink?.addEventListener('click', (e) => {
    const fb = getFirebaseAuthUserFromStorage();
    const nm = getLoggedUserName();
    const isLogged = !!nm || !!fb;
    if (fb && typeof window.setLoggedUserName === 'function') {
      const name = (fb.displayName || fb.email || 'Cliente').toString();
      const payload = {
        nome: name.includes('@') ? name.split('@')[0] : name,
        email: fb.email || null,
        uid: fb.uid || null,
        loggedAt: Date.now()
      };
      try { window.setLoggedUserName(payload); } catch (_) {}
    }
    if (!isLogged) {
      e.preventDefault();
      window.location.href = `login_cadastro.html?redirect=${encodeURIComponent(getLocalRedirectTarget())}`;
    }
  });

  const showMenu = () => {
    if (!catMenu) return;
    catMenu.classList.remove('hidden');
    if (catIcon) catIcon.classList.add('rotate-180');
    if (catBtn) catBtn.setAttribute('aria-expanded', 'true');
  };

  const hideMenu = () => {
    if (!catMenu) return;
    catMenu.classList.add('hidden');
    if (catIcon) catIcon.classList.remove('rotate-180');
    if (catBtn) catBtn.setAttribute('aria-expanded', 'false');
  };

  let hideTimer = null;
  const delayedHide = () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      const btnHover = !!catBtn?.matches(':hover');
      const menuHover = !!catMenu?.matches(':hover');
      if (!btnHover && !menuHover) hideMenu();
    }, 120);
  };

  if (catBtn && !catBtn.dataset.bound) {
    catBtn.dataset.bound = '1';
    catBtn.addEventListener('mouseenter', showMenu);
    catBtn.addEventListener('mouseleave', delayedHide);
    catBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const open = !!catMenu && !catMenu.classList.contains('hidden');
      if (open) hideMenu();
      else showMenu();
    });
  }

  if (catMenu && !catMenu.dataset.bound) {
    catMenu.dataset.bound = '1';
    catMenu.addEventListener('mouseenter', () => {
      clearTimeout(hideTimer);
      showMenu();
    });
    catMenu.addEventListener('mouseleave', delayedHide);
  }

  const accountBtn = document.getElementById('account-btn');
  const accountPopover = document.getElementById('account-popover');
  const caret = document.getElementById('account-caret');

  const accountTarget = () => isUserLoggedIn()
    ? 'minha_conta.html'
    : `login_cadastro.html?redirect=${encodeURIComponent(getLocalRedirectTarget())}`;

  const openAccount = () => {
    if (!accountPopover) return;
    accountPopover.classList.remove('hidden');
    if (caret) caret.classList.add('rotate-180');
    if (accountBtn) accountBtn.setAttribute('aria-expanded', 'true');
    if (typeof window.renderAccountPopover === 'function') window.renderAccountPopover();
  };

  const closeAccount = () => {
    if (!accountPopover) return;
    accountPopover.classList.add('hidden');
    if (caret) caret.classList.remove('rotate-180');
    if (accountBtn) accountBtn.setAttribute('aria-expanded', 'false');
  };

  const onAccountClick = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    if (!accountPopover) {
      window.location.href = accountTarget();
      return;
    }

    const isOpen = !accountPopover.classList.contains('hidden');
    if (isOpen) closeAccount();
    else openAccount();
  };

  if (accountBtn && !accountBtn.dataset.bound) {
    accountBtn.dataset.bound = '1';
    accountBtn.addEventListener('click', onAccountClick, { passive: false });
  }

  window.addEventListener('resize', () => {
    if (window.innerWidth >= 1024) return;
    if (accountPopover && !accountPopover.classList.contains('hidden')) {
      if (typeof window.renderAccountPopover === 'function') window.renderAccountPopover();
    }
  });

  document.addEventListener('click', (e) => {
    if (!accountPopover || !accountBtn) return;
    const t = e.target;
    if (accountPopover.contains(t) || accountBtn.contains(t)) return;
    closeAccount();
  });

  const mobileTrigger = document.getElementById('menu-mobile-trigger');
  const sidebar = document.getElementById('mobile-sidebar');
  const overlay = document.getElementById('mobile-overlay');
  const closeBtn = document.getElementById('close-mobile-menu');

  const openMobile = () => sidebar?.classList.remove('hidden');
  const closeMobile = () => sidebar?.classList.add('hidden');

  mobileTrigger?.addEventListener('click', openMobile);
  overlay?.addEventListener('click', closeMobile);
  closeBtn?.addEventListener('click', closeMobile);
}

function renderAccountPopover() {
  const wrap = document.getElementById('account-popover-inner');
  if (!wrap) return;

  const logged = isUserLoggedIn();
  const name = getLoggedUserName();
  const cityUF = String(window.__HEADER_CITY_UF__ || getLoggedUserCityUF() || '').trim();

  if (!logged) {
    wrap.innerHTML = `
      <div class="p-6">
        <p class="font-black text-lg text-gray-900 mb-1">Entre ou Cadastre-se</p>
        <p class="text-sm text-gray-500 mb-5">Acompanhe seus pedidos e aproveite ofertas.</p>
        <a href="login_cadastro.html?redirect=${encodeURIComponent(getLocalRedirectTarget())}"
           class="w-full inline-flex items-center justify-center gap-2 bg-primary-blue text-white font-black py-3 rounded-xl hover:bg-blue-800 transition-all">
           <i class="fas fa-user"></i> Entrar / Criar conta
        </a>
      </div>
    `;
    return;
  }

  const first = name ? String(name).trim().split(/\s+/)[0] : 'Cliente';
  const subtitle = cityUF ? escapeHtml(cityUF) : 'Defina seu endereço';

  wrap.innerHTML = `
    <div class="p-6 border-b border-gray-100">
      <p class="text-xs uppercase font-black tracking-widest text-gray-400">Minha conta</p>
      <p class="font-black text-lg text-gray-900">Olá, ${escapeHtml(first)}!</p>
      <p class="text-sm text-gray-500">${subtitle}</p>
    </div>

    <div class="p-2">
      <a href="minha_conta.html"
         class="flex items-center gap-3 p-4 rounded-xl hover:bg-gray-50 transition-all font-bold text-gray-800">
        <i class="fas fa-id-card text-primary-blue w-6"></i> Painel do Cliente
      </a>
      <a href="minha_conta.html#pedidos"
         class="flex items-center gap-3 p-4 rounded-xl hover:bg-gray-50 transition-all font-bold text-gray-800">
        <i class="fas fa-box text-primary-blue w-6"></i> Meus Pedidos
      </a>
      <a href="favoritos.html"
         class="flex items-center gap-3 p-4 rounded-xl hover:bg-gray-50 transition-all font-bold text-gray-800">
        <i class="fas fa-heart text-red-500 w-6"></i> Favoritos
      </a>
    </div>

    <div class="p-6 border-t border-gray-100">
      <button id="btn-logout-header"
        class="w-full inline-flex items-center justify-center gap-2 bg-gray-900 text-white font-black py-3 rounded-xl hover:bg-black transition-all">
        <i class="fas fa-sign-out-alt"></i> Sair da conta
      </button>
    </div>
  `;

  setTimeout(() => {
    const btn = document.getElementById('btn-logout-header');
    btn?.addEventListener('click', async () => {
      try {
        const keys = [
          'clienteLogado', 'usuarioLogado', 'currentUser', 'loggedUser',
          'authUser', 'userData', 'userProfile', 'userInfo'
        ];

        for (const k of keys) {
          try { localStorage.removeItem(k); } catch (_) {}
          try { sessionStorage.removeItem(k); } catch (_) {}
        }

        try { clearFirebaseAuthStorage(); } catch (_) {}

        try {
          if (window.auth && typeof window.signOut === 'function') {
            await window.signOut(window.auth);
          } else if (window.auth && typeof window.auth.signOut === 'function') {
            await window.auth.signOut();
          } else if (window.firebase && typeof window.firebase.auth === 'function') {
            const a = window.firebase.auth();
            if (a && typeof a.signOut === 'function') await a.signOut();
          }
        } catch (e) {
          console.warn('[header] erro ao deslogar do Firebase:', e);
        }

        try { window.dispatchEvent(new Event('user:updated')); } catch (_) {}
        atualizarUsuarioHeader();
        window.location.href = 'index.html';
      } catch (e) {
        console.error(e);
      }
    });
  }, 50);
}

window.renderAccountPopover = renderAccountPopover;
window.carregarHeader = carregarHeader;
window.loadCartCounter = loadCartCounter;

window.addEventListener('user:updated', atualizarUsuarioHeader);
window.addEventListener('storage', () => { atualizarUsuarioHeader(); loadCartCounter(); });
window.addEventListener('pageshow', () => { atualizarUsuarioHeader(); loadCartCounter(); });
window.addEventListener('focus', () => { atualizarUsuarioHeader(); loadCartCounter(); });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    atualizarUsuarioHeader();
    setTimeout(atualizarUsuarioHeader, 200);
  }
});

function __extractFirstAddress(userData) {
  if (!userData || typeof userData !== 'object') return null;
  const direct = userData.address || userData.endereco || userData.selectedAddress || null;
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct;
  const arr = userData.addresses || userData.enderecos || userData.address_list || null;
  if (Array.isArray(arr) && arr.length) return arr[0];
  if (Array.isArray(direct) && direct.length) return direct[0];
  return null;
}

function __persistSelectedAddressForHeader(addr) {
  if (!addr || typeof addr !== 'object') return;
  try { localStorage.setItem('selectedAddress', JSON.stringify(addr)); } catch (_) {}
  try { sessionStorage.setItem('selectedAddress', JSON.stringify(addr)); } catch (_) {}

  try {
    const city = String(addr.city || addr.cidade || addr.municipio || '').trim();
    const uf = String(addr.state || addr.uf || addr.estado || addr.UF || '').trim();
    const cityUF = city && uf ? `${city} - ${uf}` : city;

    if (cityUF) {
      localStorage.setItem('headerCityUF', cityUF);
      sessionStorage.setItem('headerCityUF', cityUF);
      window.__HEADER_CITY_UF__ = cityUF;
    }
  } catch (_) {}
}

async function __loadHeaderAddressFromFirestoreByUid(uid) {
  try {
    if (!uid || !window.db || typeof window.doc !== 'function' || typeof window.getDoc !== 'function') return '';
    const candidates = [
      ['users', uid],
      ['clientes', uid],
      ['customers', uid],
      ['users_public', uid]
    ];

    for (const [col, id] of candidates) {
      try {
        const ref = window.doc(window.db, col, id);
        const snap = await window.getDoc(ref);
        if (!snap || typeof snap.exists !== 'function' || !snap.exists()) continue;

        const data = snap.data() || {};
        const addr = __extractFirstAddress(data) || data.selectedAddress || data.endereco || data.address || null;
        const city = (addr?.city || addr?.cidade || data.city || data.cidade || '').toString().trim();
        const uf = (addr?.state || addr?.uf || data.state || data.uf || '').toString().trim();
        const cityUF = city && uf ? `${city} - ${uf}` : (city || '');

        if (addr) __persistSelectedAddressForHeader(addr);
        if (cityUF) return cityUF;
      } catch (_) {}
    }
  } catch (_) {}
  return '';
}


async function __syncHeaderAddressFromAuth(user) {
  try {
    const logged = !!(user && !user.isAnonymous);
    const sub = document.getElementById('auth-subtitle');
    const legacyEl = document.getElementById('client-city-display');

    if (!logged) {
      window.__HEADER_CITY_UF__ = '';
      if (sub) sub.textContent = 'Defina seu endereço';
      if (legacyEl) legacyEl.textContent = 'Defina seu endereço';
      if (typeof window.renderAccountPopover === 'function') {
        window.renderAccountPopover();
      }
      return;
    }

    let cityUF = '';
    try { cityUF = getLoggedUserCityUF(); } catch (_) {}
    if (!cityUF && user?.uid) {
      cityUF = await __loadHeaderAddressFromFirestoreByUid(user.uid);
    }

    if (cityUF) {
      window.__HEADER_CITY_UF__ = cityUF;
      try { localStorage.setItem('headerCityUF', cityUF); } catch (_) {}
      try { sessionStorage.setItem('headerCityUF', cityUF); } catch (_) {}
    } else {
      try {
        cityUF = String(
          window.__HEADER_CITY_UF__ ||
          localStorage.getItem('headerCityUF') ||
          sessionStorage.getItem('headerCityUF') ||
          ''
        ).trim();
      } catch (_) {
        cityUF = String(window.__HEADER_CITY_UF__ || '').trim();
      }
    }

    const text = cityUF || 'Defina seu endereço';
    if (sub) sub.textContent = text;
    if (legacyEl) legacyEl.textContent = text;

    try { updateHeaderCityDisplay(); } catch (_) {}

    if (typeof window.renderAccountPopover === 'function') {
      window.renderAccountPopover();
    }
  } catch (_) {}
}

window.bindHeaderAuthListener = window.bindHeaderAuthListener || function(authInstance) {
  try {
    const auth = authInstance || window.auth || null;
    if (!auth || typeof auth.onAuthStateChanged !== 'function') return;
    if (window.__HEADER_AUTH_LISTENER_BOUND__) return;
    window.__HEADER_AUTH_LISTENER_BOUND__ = true;

    auth.onAuthStateChanged(async function(user) {
      try {
        if (typeof window.updateClientHeaderUI === 'function') window.updateClientHeaderUI(user);
      } catch (_) {}

      try {
        if (typeof window.loadClientAddress === 'function') await window.loadClientAddress(user);
      } catch (_) {}

      try {
        if (user && !user.isAnonymous) {
          let existing = {};
          try {
            existing = JSON.parse(localStorage.getItem('clienteLogado') || '{}') || {};
          } catch (_) {
            existing = {};
          }

          const payload = {
            ...existing,
            nome: (user.displayName || existing.nome || existing.name || (user.email ? String(user.email).split('@')[0] : '') || 'Cliente'),
            email: user.email || existing.email || null,
            uid: user.uid || existing.uid || null,
            loggedAt: Date.now()
          };

          localStorage.setItem('clienteLogado', JSON.stringify(payload));
        }
      } catch (_) {}

      try { atualizarUsuarioHeader(); } catch (_) {}
      await __syncHeaderAddressFromAuth(user);
    });
  } catch (e) {
    console.error('[header] erro ao vincular auth:', e);
  }
};

async function carregarEnderecoHeaderFirestore() {
  try {
    const has = !!window.db && typeof window.doc === 'function' && typeof window.getDoc === 'function' && window.auth;
    if (!has) return;

    const u = window.auth.currentUser;
    if (!u || u.isAnonymous) return;

    await __syncHeaderAddressFromAuth(u);
  } catch (_) {}
}

window.addEventListener('firebase:ready', () => {
  setTimeout(() => {
    try { delete window.__HEADER_CATEGORY_BANNER__; } catch (_) {}
    try { window.bindHeaderAuthListener(window.auth || null); } catch (_) {}
    carregarEnderecoHeaderFirestore();
    try { carregarCategoriasHeader(); } catch (_) {}
  }, 400);
});