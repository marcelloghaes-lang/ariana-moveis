const RETAIL_SOURCES = Object.freeze([
  { domain: 'zema.com', label: 'Zema' },
  { domain: 'magazineluiza.com.br', label: 'Magazine Luiza' },
  { domain: 'casasbahia.com.br', label: 'Casas Bahia' },
  { domain: 'mercadolivre.com.br', label: 'Mercado Livre' },
  { domain: 'fastshop.com.br', label: 'Fast Shop' }
]);

const CACHE_TTL_MS = 20 * 60 * 1000;
const researchCache = new Map();

function normalize(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function decodeHtml(value = '') {
  return String(value || '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code) || 32))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16) || 32))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function plainText(value = '') {
  return decodeHtml(String(value || '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function sameWord(a = '', b = '') {
  const strip = value => normalize(
    String(value || '').replace(/^[^a-z0-9áàâãéèêíìîóòôõúùûç]+|[^a-z0-9áàâãéèêíìîóòôõúùûç]+$/gi, '')
  );
  return strip(a) === strip(b);
}

export function sanitizeCampaignCopy(value = '', maxLength = 120) {
  const raw = String(value || '')
    .replace(/\bmelhorws\b/gi, 'melhores')
    .replace(/\s+/g, ' ')
    .trim();

  const words = raw.split(' ').filter(Boolean);
  const deduped = [];
  for (const word of words) {
    if (deduped.length && sameWord(deduped[deduped.length - 1], word)) continue;
    deduped.push(word);
  }

  let text = deduped.join(' ').replace(/\s+([,.;:!?])/g, '$1').trim();
  if (text.length > maxLength) {
    text = text.slice(0, maxLength + 1);
    const cut = text.lastIndexOf(' ');
    text = (cut > Math.floor(maxLength * .65) ? text.slice(0, cut) : text.slice(0, maxLength)).trim();
  }
  return text.replace(/[\s,;:\-–—]+$/g, '').trim();
}

function categoryOf(product = {}) {
  return String(
    product.categoryName ||
    product.category ||
    product.department ||
    product.group ||
    ''
  ).trim();
}

function brandOf(product = {}) {
  return String(product.brand || product.brandName || '').trim();
}

function campaignContext(products = []) {
  const rows = (Array.isArray(products) ? products : []).filter(Boolean).slice(0, 5);
  const brands = rows.map(brandOf).filter(Boolean);
  const categories = rows.map(categoryOf).filter(Boolean);
  const sameBrand = brands.length === rows.length && rows.length > 0 && new Set(brands.map(normalize)).size === 1;
  const sameCategory = categories.length === rows.length && rows.length > 0 && new Set(categories.map(normalize)).size === 1;

  return {
    rows,
    brand: sameBrand ? brands[0] : '',
    category: sameCategory ? categories[0] : '',
    sameBrand,
    sameCategory,
    productNames: rows.map(item => String(item.name || item.title || '').trim()).filter(Boolean)
  };
}

function sourceQuery(context = {}) {
  const subject = [
    context.brand,
    context.category,
    !context.brand && !context.category ? context.productNames.slice(0, 2).join(' ') : ''
  ].filter(Boolean).join(' ');
  return sanitizeCampaignCopy(subject || 'casa eletrodomésticos móveis', 90);
}

async function fetchText(url, timeoutMs = 4500) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Safari/537.36 ArianaCreativeStudio/1.0',
      'Accept': 'text/html,application/xhtml+xml'
    }
  });
  if (!response.ok) throw new Error('campaign_research_http_' + response.status);

  const type = String(response.headers.get('content-type') || '');
  if (!type.includes('text/html') && !type.includes('application/xhtml+xml')) {
    throw new Error('campaign_research_non_html');
  }

  const text = await response.text();
  return text.slice(0, 900000);
}

function decodeResultUrl(href = '', expectedDomain = '') {
  try {
    const absolute = href.startsWith('//') ? 'https:' + href : href;
    const parsed = new URL(absolute, 'https://html.duckduckgo.com');
    const redirected = parsed.searchParams.get('uddg');
    const target = redirected ? new URL(decodeURIComponent(redirected)) : parsed;
    if (!target.hostname.includes(expectedDomain)) return '';
    return target.toString();
  } catch {
    return '';
  }
}

function searchResultFromHtml(html = '', source = {}) {
  const anchorRe = /<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorRe.exec(html))) {
    const url = decodeResultUrl(match[1], source.domain);
    if (!url) continue;

    const title = plainText(match[2]);
    const tail = html.slice(anchorRe.lastIndex, anchorRe.lastIndex + 1800);
    const snippetMatch = tail.match(/class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div|span)>/i);
    const snippet = plainText(snippetMatch?.[1] || '');

    if (title || snippet) {
      return {
        domain: source.domain,
        label: source.label,
        url,
        title: sanitizeCampaignCopy(title, 140),
        snippet: sanitizeCampaignCopy(snippet, 220)
      };
    }
  }

  return null;
}

function homepageResult(html = '', source = {}) {
  const title = plainText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  const description =
    plainText(html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i)?.[1] || '') ||
    plainText(html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i)?.[1] || '');
  const heading = plainText(html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i)?.[1] || '');

  if (!title && !description && !heading) return null;

  return {
    domain: source.domain,
    label: source.label,
    url: 'https://' + source.domain + '/',
    title: sanitizeCampaignCopy(title || heading, 140),
    snippet: sanitizeCampaignCopy(description || heading, 220)
  };
}

async function researchSource(source, query) {
  const searchUrl = 'https://html.duckduckgo.com/html/?q=' +
    encodeURIComponent('site:' + source.domain + ' ' + query + ' campanha ofertas');

  try {
    const html = await fetchText(searchUrl);
    const result = searchResultFromHtml(html, source);
    if (result) return result;
  } catch {}

  try {
    const html = await fetchText('https://' + source.domain + '/', 4000);
    return homepageResult(html, source);
  } catch {
    return null;
  }
}

function researchTheme(references = []) {
  const corpus = normalize(references.map(item => item.title + ' ' + item.snippet).join(' '));
  const rules = [
    ['technology', /\b(tecnologia|tecnologico|inovacao|inovador|smart|conectado|conectividade)\b/g],
    ['renew', /\b(renove|renovar|renovacao|transforme|transformar|novo|novidade)\b/g],
    ['comfort', /\b(conforto|confortavel|aconchego|bem estar)\b/g],
    ['practical', /\b(praticidade|pratico|facil|facilidade|rotina|dia a dia)\b/g],
    ['special', /\b(especial|selecao|festival|semana|campanha|destaque)\b/g]
  ];

  let best = { key: 'special', score: 0 };
  for (const [key, regex] of rules) {
    const score = (corpus.match(regex) || []).length;
    if (score > best.score) best = { key, score };
  }
  return best.key;
}

function originalCopy(context = {}, theme = 'special') {
  const brand = sanitizeCampaignCopy(context.brand, 24);
  const category = sanitizeCampaignCopy(context.category, 28);
  const upperBrand = brand.toUpperCase();
  const upperCategory = category.toUpperCase();

  const badge = context.sameBrand && brand
    ? upperBrand + ' • SELEÇÃO ARIANA'
    : (context.sameCategory && category ? upperCategory : 'SELEÇÃO ARIANA');

  let headline = '';
  if (context.sameBrand && brand) {
    const byTheme = {
      technology: upperBrand + ': TECNOLOGIA QUE COMBINA COM SUA CASA',
      renew: 'RENOVE SUA CASA COM ' + upperBrand,
      comfort: upperBrand + ' PARA DEIXAR SUA CASA MAIS COMPLETA',
      practical: upperBrand + ' PARA FACILITAR O SEU DIA A DIA',
      special: 'UM ESPECIAL ' + upperBrand + ' PARA SUA CASA'
    };
    headline = byTheme[theme] || byTheme.special;
  } else if (context.sameCategory && category) {
    const byTheme = {
      technology: upperCategory + ' COM MAIS TECNOLOGIA PARA VOCÊ',
      renew: 'RENOVE SUA CASA COM NOSSA SELEÇÃO DE ' + upperCategory,
      comfort: upperCategory + ' PARA UMA CASA MAIS CONFORTÁVEL',
      practical: 'MAIS PRATICIDADE PARA O SEU DIA A DIA',
      special: upperCategory + ' ESCOLHIDOS PARA SUA CASA'
    };
    headline = byTheme[theme] || byTheme.special;
  } else {
    const byTheme = {
      technology: 'TECNOLOGIA E BOAS ESCOLHAS PARA SUA CASA',
      renew: 'RENOVE SUA CASA DO SEU JEITO',
      comfort: 'MAIS CONFORTO PARA TODOS OS AMBIENTES',
      practical: 'SOLUÇÕES QUE FACILITAM O SEU DIA A DIA',
      special: 'ESCOLHAS QUE COMBINAM COM A SUA CASA'
    };
    headline = byTheme[theme] || byTheme.special;
  }

  const supports = {
    technology: 'Tecnologia, design e praticidade para deixar sua rotina mais simples.',
    renew: 'Uma seleção pensada para renovar seus ambientes com estilo e praticidade.',
    comfort: 'Conforto, qualidade e boas escolhas para todos os ambientes.',
    practical: 'Soluções para facilitar a rotina e aproveitar melhor cada momento.',
    special: 'Grandes marcas e escolhas para deixar sua casa do seu jeito.'
  };

  const ctas = {
    technology: 'VEJA AS NOVIDADES',
    renew: 'DESCUBRA A SELEÇÃO',
    comfort: 'CONHEÇA A SELEÇÃO',
    practical: 'VEJA A SELEÇÃO',
    special: 'CONHEÇA A SELEÇÃO'
  };

  return {
    badge: sanitizeCampaignCopy(badge, 42),
    headline: sanitizeCampaignCopy(headline, 72),
    subtitle: sanitizeCampaignCopy(supports[theme] || supports.special, 120),
    cta: sanitizeCampaignCopy(ctas[theme] || ctas.special, 42)
  };
}

export function buildCreativeCampaignCopy(products = [], references = []) {
  const context = campaignContext(products);
  const theme = researchTheme(Array.isArray(references) ? references : []);

  return {
    copy: originalCopy(context, theme),
    context: {
      brand: context.brand,
      category: context.category,
      sameBrand: context.sameBrand,
      sameCategory: context.sameCategory,
      productCount: context.rows.length
    },
    theme
  };
}

export async function researchCreativeCampaignCopy(products = []) {
  const context = campaignContext(products);

  if (!context.rows.length) {
    return {
      ok: true,
      researched: false,
      sourceCount: 0,
      sources: [],
      ...buildCreativeCampaignCopy([], [])
    };
  }

  const query = sourceQuery(context);
  const cacheKey = normalize([context.brand, context.category, ...context.productNames].join('|'));
  const cached = researchCache.get(cacheKey);

  if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) {
    return { ...cached.value, cached: true };
  }

  const settled = await Promise.allSettled(
    RETAIL_SOURCES.map(source => researchSource(source, query))
  );

  const references = settled
    .filter(item => item.status === 'fulfilled' && item.value)
    .map(item => item.value)
    .slice(0, RETAIL_SOURCES.length);

  const generated = buildCreativeCampaignCopy(context.rows, references);
  const value = {
    ok: true,
    researched: references.length > 0,
    cached: false,
    sourceCount: references.length,
    sources: references.map(item => ({
      domain: item.domain,
      label: item.label,
      url: item.url,
      title: item.title
    })),
    ...generated
  };

  researchCache.set(cacheKey, { savedAt: Date.now(), value });
  if (researchCache.size > 100) {
    const oldestKey = researchCache.keys().next().value;
    researchCache.delete(oldestKey);
  }

  return value;
}
