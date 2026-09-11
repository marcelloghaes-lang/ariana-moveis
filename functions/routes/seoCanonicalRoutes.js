// ============================================================
// SEO PÚBLICO - SITEMAP CANÔNICO / ROBOTS
// Camada incremental registrada antes das rotas legadas.
// Evita publicar / e /index.html como duas URLs da mesma Home.
// ============================================================

export default function registerSeoCanonicalRoutes(app, context = {}) {
  const { Product, Category, sanitizeIdPart } = context;
  if (!app || !Product || !Category) return;

  function siteUrl() {
    const raw = String(
      process.env.SITE_URL ||
      process.env.FRONTEND_URL ||
      'https://arianamoveis.com.br'
    ).trim();
    return raw.replace(/\/+$/, '') || 'https://arianamoveis.com.br';
  }

  function xmlEscape(value = '') {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function dateOnly(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
    return date.toISOString().slice(0, 10);
  }

  function productUrl(base, product = {}) {
    const identifier = String(
      product._id ||
      product.id ||
      product.slug ||
      (typeof sanitizeIdPart === 'function'
        ? sanitizeIdPart(product.name || product.sku || 'produto')
        : product.sku || 'produto')
    ).trim();
    return `${base}/produto.html?id=${encodeURIComponent(identifier)}`;
  }

  function categoryUrl(base, category = {}) {
    const identifier = String(
      category._id || category.id || category.slug || category.name || ''
    ).trim();
    if (!identifier) return '';
    return `${base}/categoria.html?id=${encodeURIComponent(identifier)}`;
  }

  app.get('/sitemap.xml', async (_req, res, next) => {
    try {
      const base = siteUrl();
      const [products, categories] = await Promise.all([
        Product.find({ active: { $ne: false } })
          .select('_id id slug name sku updatedAt createdAt')
          .sort({ updatedAt: -1, createdAt: -1 })
          .limit(10000)
          .lean(),
        Category.find({ active: { $ne: false } })
          .select('_id id slug name updatedAt createdAt')
          .sort({ sortOrder: 1, name: 1 })
          .limit(1000)
          .lean()
      ]);

      const rows = [];
      const seen = new Set();
      const add = (loc, lastmod, priority = '0.8', changefreq = 'weekly') => {
        if (!loc || seen.has(loc)) return;
        seen.add(loc);
        rows.push(
          `  <url>\n` +
          `    <loc>${xmlEscape(loc)}</loc>\n` +
          `    <lastmod>${xmlEscape(dateOnly(lastmod))}</lastmod>\n` +
          `    <changefreq>${xmlEscape(changefreq)}</changefreq>\n` +
          `    <priority>${xmlEscape(priority)}</priority>\n` +
          `  </url>`
        );
      };

      // A Home possui canonical em /. Não publicamos /index.html como segunda URL.
      add(`${base}/`, new Date(), '1.0', 'daily');
      add(`${base}/todos_produtos.html`, new Date(), '0.9', 'daily');
      add(`${base}/ofertas.html`, new Date(), '0.9', 'daily');
      add(`${base}/nossas_lojas.html`, new Date(), '0.6', 'monthly');
      add(`${base}/contato.html`, new Date(), '0.5', 'monthly');

      for (const category of categories || []) {
        add(categoryUrl(base, category), category.updatedAt || category.createdAt, '0.7', 'weekly');
      }
      for (const product of products || []) {
        add(productUrl(base, product), product.updatedAt || product.createdAt, '0.8', 'weekly');
      }

      const xml =
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        rows.join('\n') +
        '\n</urlset>\n';

      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
      return res.status(200).send(xml);
    } catch (error) {
      console.warn('[SEO] sitemap canônico falhou; usando implementação legada:', error?.message || error);
      return next();
    }
  });

  app.get('/robots.txt', (_req, res) => {
    const base = siteUrl();
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    return res.status(200).send(
      `User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`
    );
  });
}
