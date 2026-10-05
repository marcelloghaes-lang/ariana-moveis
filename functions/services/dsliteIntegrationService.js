import axios from 'axios';

export const DSLITE_BETO_SUPPLIER_ID = 41;

export const DSLITE_BETO_APPROVED_SKUS = Object.freeze([
  'ADEGAV',
  'CABIDEIROVERSATILN',
  'CABIDEIROVERSATILV',
  'CABPARISB',
  'CABPARISP',
  'CABTOQUIOB',
  'CABTOQUIOP',
  'CABTOQUIOV',
  'FRUT1F',
  'FRUT1N',
  'FRUT1V',
  'GLAMB',
  'GLAMN',
  'GLAMP',
  'GLAMV',
  'MB130',
  'MB145',
  'MESAGOIASB',
  'MESAGOIASF',
  'MESAGOIASP',
  'MESAREDB',
  'MESAREDF',
  'MESAREDN',
  'MESAREDP',
  'MESAREDV',
  'MF130',
  'MF145',
  'MF155',
  'MM130V',
  'MM145V',
  'MM155V',
  'MP130',
  'MP145',
  'MP155',
  'MULTI2REPARCANTO30B',
  'MULTI2REPARCANTO30P',
  'PENTEADEIRAB',
  'PENTEADEIRAN',
  'PENTEADEIRAP',
  'PENTEADEIRAV',
  'SUPORTEPAPELN',
  'TABUADECARNE50CM',
  'TABUADECARNE60CM',
  'TABUADECARNE70CM',
  'SUPORTEPAPELV'
]);

const APPROVED_SKU_SET = new Set(DSLITE_BETO_APPROVED_SKUS);

function requiredToken() {
  const token = String(process.env.DSLITE_API_TOKEN || process.env.DSLITE_TOKEN || '').trim();
  if (!token) {
    const error = new Error('DSLITE_API_TOKEN não configurado no ambiente.');
    error.code = 'DSLITE_TOKEN_MISSING';
    throw error;
  }
  return token;
}

function feedUrl({ supplierId = DSLITE_BETO_SUPPLIER_ID, token = requiredToken() } = {}) {
  return `https://app.dslite.com.br/modules/admin/Empresa/getXMLCrossdocking/${Number(supplierId)}/${encodeURIComponent(token)}`;
}

function decodeXml(value = '') {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function plainText(value = '') {
  return decodeXml(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractTag(block = '', tag = '') {
  const safe = String(tag).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(block).match(new RegExp(`<${safe}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${safe}>`, 'i'));
  return match ? decodeXml(match[1]).trim() : '';
}

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const normalized = String(value).trim().replace(/\./g, '').replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : fallback;
}

function splitImages(value = '') {
  return decodeXml(value)
    .split(/[\n\r,;]+/)
    .map((item) => item.trim())
    .filter((item) => /^https?:\/\//i.test(item));
}

function detectRecordBlocks(xml = '') {
  const source = String(xml || '');
  const markers = [...source.matchAll(/<prod_id(?:\s[^>]*)?>[\s\S]*?<\/prod_id>/gi)];
  if (!markers.length) return [];

  const blocks = [];
  for (let i = 0; i < markers.length; i += 1) {
    const start = markers[i].index || 0;
    const end = i + 1 < markers.length ? (markers[i + 1].index || source.length) : source.length;
    blocks.push(source.slice(start, end));
  }
  return blocks;
}

function mapCategory(rawCategory = '') {
  const category = String(rawCategory || '').toLowerCase();
  if (category.includes('penteadeira') || category.includes('mesa cabeceira')) return 'Quarto';
  if (category.includes('cozinha') || category.includes('tábua') || category.includes('fruteira')) return 'Cozinha';
  if (category.includes('banheiro')) return 'Banheiro';
  if (category.includes('cabideiro') || category.includes('prateleira') || category.includes('expositor')) return 'Organização';
  if (category.includes('adega') || category.includes('mesinhas') || category.includes('móveis decorativos')) return 'Móveis e Decoração';
  return 'Móveis e Decoração';
}

export function parseDsliteBetoXml(xml = '') {
  const blocks = detectRecordBlocks(xml);
  const products = [];

  for (const block of blocks) {
    const sku = extractTag(block, 'prod_id').trim();
    if (!sku) continue;

    const imageFields = [
      extractTag(block, 'images'),
      extractTag(block, 'imagem01'),
      extractTag(block, 'imagem02'),
      extractTag(block, 'imagem03'),
      extractTag(block, 'imagem04'),
      extractTag(block, 'imagem05')
    ];
    const imageUrls = [...new Set(imageFields.flatMap(splitImages))];

    const rawCategory = extractTag(block, 'seg_name');
    const rawDescription = extractTag(block, 'description');

    products.push({
      sku,
      approved: APPROVED_SKU_SET.has(sku),
      name: extractTag(block, 'prod_name') || extractTag(block, 'shortname') || sku,
      brand: extractTag(block, 'brand') || 'Beto Móveis',
      rawCategory,
      category: mapCategory(rawCategory),
      description: plainText(rawDescription),
      ean: extractTag(block, 'EAN'),
      supplierCost: toNumber(extractTag(block, 'price_crossdocking') || extractTag(block, 'price'), 0),
      supplierStock: Math.max(0, Math.trunc(toNumber(extractTag(block, 'stock'), 0))),
      weight: toNumber(extractTag(block, 'weightValue'), 0),
      width: toNumber(extractTag(block, 'width'), 0),
      height: toNumber(extractTag(block, 'height'), 0),
      depth: toNumber(extractTag(block, 'depth'), 0),
      imageUrls,
      parentSku: extractTag(block, 'Produto_pai'),
      status: extractTag(block, 'Situacao') || 'Ativo'
    });
  }

  return products;
}

export async function fetchDsliteBetoCatalog({ timeoutMs = 30000 } = {}) {
  const url = feedUrl();
  const response = await axios.get(url, {
    responseType: 'text',
    timeout: timeoutMs,
    maxContentLength: 25 * 1024 * 1024,
    headers: { 'User-Agent': 'ArianaMoveis-DSLite/1.0' }
  });

  const parsed = parseDsliteBetoXml(response.data);
  const approved = parsed.filter((item) => item.approved);

  return {
    supplierId: DSLITE_BETO_SUPPLIER_ID,
    supplier: 'Beto Móveis',
    fetchedAt: new Date(),
    totalParsed: parsed.length,
    approvedCount: approved.length,
    expectedApprovedCount: DSLITE_BETO_APPROVED_SKUS.length,
    products: approved
  };
}

function normalizeImages(urls = []) {
  return urls.map((url, index) => ({
    url,
    path: url,
    name: `dslite-${index + 1}`,
    isMain: index === 0
  }));
}

export async function syncDsliteBetoShadow({ Product, actor = 'system' } = {}) {
  if (!Product) throw new Error('Model Product não informado para sincronização DSLite.');

  const catalog = await fetchDsliteBetoCatalog();
  const summary = {
    supplierId: catalog.supplierId,
    supplier: catalog.supplier,
    mode: 'shadow',
    fetched: catalog.totalParsed,
    approved: catalog.approvedCount,
    expectedApproved: catalog.expectedApprovedCount,
    created: 0,
    updated: 0,
    skipped: 0,
    missingApprovedSkus: [],
    syncedAt: new Date()
  };

  const seen = new Set(catalog.products.map((item) => item.sku));
  summary.missingApprovedSkus = DSLITE_BETO_APPROVED_SKUS.filter((sku) => !seen.has(sku));

  for (const item of catalog.products) {
    if (!item.sku || !item.name) {
      summary.skipped += 1;
      continue;
    }

    const externalSku = `DSLITE-BETO-${item.sku}`;
    const existing = await Product.findOne({ sku: externalSku }).lean();
    const images = normalizeImages(item.imageUrls);
    const mainImage = images[0]?.url || '';

    const set = {
      sellerId: 'ariana',
      sellerName: 'Ariana Móveis',
      name: item.name,
      description: item.description || item.name,
      category: item.category,
      categoryName: item.category,
      brand: item.brand || 'Beto Móveis',
      image: mainImage,
      imageUrl: mainImage,
      imagem: mainImage,
      mainImageUrl: mainImage,
      mainImagePath: mainImage,
      images,
      imageUrls: item.imageUrls,
      imagePaths: item.imageUrls,
      weight: item.weight || 0,
      width: item.width || 0,
      height: item.height || 0,
      length: item.depth || 0,
      dimensions: {
        width: item.width || 0,
        height: item.height || 0,
        depth: item.depth || 0,
        unit: 'cm'
      },
      logistics: {
        source: 'dslite',
        supplierId: DSLITE_BETO_SUPPLIER_ID,
        originCep: '16303-330'
      },
      storefrontSource: 'dslite',
      dropshipping: {
        provider: 'dslite',
        supplier: 'Beto Móveis',
        supplierId: DSLITE_BETO_SUPPLIER_ID,
        sourceSku: item.sku,
        sourceEan: item.ean || '',
        sourceCategory: item.rawCategory || '',
        sourceCost: item.supplierCost,
        sourceStock: item.supplierStock,
        sourceStatus: item.status,
        syncMode: 'shadow',
        publishApproved: false,
        pricingRequired: true,
        lastSyncAt: new Date(),
        lastSyncBy: actor
      },
      specs: {
        ...(existing?.specs || {}),
        dslite: {
          supplierId: DSLITE_BETO_SUPPLIER_ID,
          sourceSku: item.sku,
          sourceEan: item.ean || '',
          sourceCategory: item.rawCategory || '',
          supplierCost: item.supplierCost,
          supplierStock: item.supplierStock
        }
      }
    };

    const setOnInsert = {
      sku: externalSku,
      slug: `dslite-beto-${String(item.sku).toLowerCase()}`,
      price: 0,
      pixPrice: null,
      stock: 0,
      active: false,
      storefrontStatus: 'draft',
      storefrontSubmittedAt: null,
      storefrontReviewedAt: null,
      storefrontReviewedBy: '',
      storefrontReviewNote: 'Importado em modo shadow da DSLite. Definir preço/margem e aprovar antes de publicar.'
    };

    await Product.updateOne(
      { sku: externalSku },
      { $set: set, $setOnInsert: setOnInsert },
      { upsert: true, runValidators: true }
    );

    if (existing) summary.updated += 1;
    else summary.created += 1;
  }

  return summary;
}
