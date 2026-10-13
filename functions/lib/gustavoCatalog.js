const DEFAULT_DELIVERY_FEE_BRL = 80;
const DEFAULT_ASSEMBLY_RATE = 0.15;
const DEFAULT_FISCAL_SERVICE_RATE = 0.07;

const FURNITURE_TERMS = [
  'armario', 'balcao', 'beliche', 'buffet', 'cabeceira', 'cadeira', 'cama',
  'comoda', 'cozinha', 'criado', 'escrivaninha', 'estante', 'gabinete',
  'guarda roupa', 'guarda-roupa', 'mesa', 'multiuso', 'painel', 'penteadeira',
  'poltrona', 'rack', 'roupeiro', 'sapateira', 'sofa'
];

function numberOr(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roundMoney(value) {
  return Math.round((numberOr(value) + Number.EPSILON) * 100) / 100;
}

function normalize(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstPositiveNumber(...values) {
  for (const value of values) {
    const n = numberOr(value, NaN);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function productBasePrice(product = {}) {
  return firstPositiveNumber(
    product.price,
    product.preco,
    product.salePrice,
    product.precoVenda,
    product.preco_venda,
    product.valor
  );
}

function productStock(product = {}) {
  return numberOr(product.stock ?? product.estoque ?? product.quantity ?? product.quantidade ?? 0, 0);
}

export function isFurnitureProduct(product = {}) {
  if (typeof product.requiresAssembly === 'boolean') return product.requiresAssembly;
  if (typeof product.montagem === 'boolean') return product.montagem;

  const haystack = normalize([
    product.category,
    product.categoria,
    product.subcategory,
    product.subcategoria,
    product.name,
    product.nome
  ].filter(Boolean).join(' '));

  return FURNITURE_TERMS.some((term) => haystack.includes(normalize(term)));
}

export function isArianaOwnedProduct(product = {}) {
  const sellerId = String(product.sellerId ?? product.seller_id ?? product.seller?._id ?? '').trim();
  const supplierId = String(product.supplierId ?? product.supplier_id ?? '').trim();
  const source = String(product.source ?? product.origem ?? product.origin ?? '').trim().toLowerCase();
  const fulfillment = String(product.fulfillment ?? product.fulfillmentType ?? '').trim().toLowerCase();
  const externalSku = String(product.externalSku ?? product.external_sku ?? '').trim();

  if (sellerId || supplierId || externalSku) return false;
  if (['seller', 'marketplace', 'dslite', 'dropshipping', 'drop', 'crossdocking', 'cross-docking'].includes(source)) return false;
  if (['dropshipping', 'drop', 'crossdocking', 'cross-docking', 'seller', 'marketplace'].includes(fulfillment)) return false;
  if (product.isMarketplace === true || product.marketplace === true || product.isDropshipping === true) return false;
  return true;
}

export function calculateGustavoCatalogPrice(basePrice, { furniture = false, deliveryFee, assemblyRate, fiscalServiceRate } = {}) {
  const base = roundMoney(basePrice);
  const delivery = roundMoney(deliveryFee ?? DEFAULT_DELIVERY_FEE_BRL);
  const assembly = furniture ? numberOr(assemblyRate, DEFAULT_ASSEMBLY_RATE) : 0;
  const fiscal = numberOr(fiscalServiceRate, DEFAULT_FISCAL_SERVICE_RATE);
  return roundMoney(base + delivery + (base * assembly) + (base * fiscal));
}

export function toGustavoCatalogProduct(product = {}, options = {}) {
  const basePrice = productBasePrice(product);
  if (!(basePrice > 0) || !isArianaOwnedProduct(product)) return null;

  const furniture = isFurnitureProduct(product);
  const finalPrice = calculateGustavoCatalogPrice(basePrice, { ...options, furniture });

  // REGRA DE SIGILO: o objeto operacional consumido pelo Gustavo recebe somente
  // o preço final. Não expõe preço-base, frete embutido, percentuais, montagem,
  // serviço fiscal ou memória de cálculo. Essas informações nunca devem compor
  // prompts, respostas, mensagens, links ou metadados enviados ao cliente.
  return {
    ...product,
    price: finalPrice,
    preco: finalPrice,
    gustavoCatalog: true,
    stock: productStock(product)
  };
}

export function buildGustavoCatalog(products = [], options = {}) {
  if (!Array.isArray(products)) return [];
  return products.map((product) => toGustavoCatalogProduct(product, options)).filter(Boolean);
}

// Configuração interna do servidor. Nunca serializar esta constante para o
// catálogo consumido pelo bot nem apresentar seus valores ao cliente.
export const GUSTAVO_CATALOG_PRICING = Object.freeze({
  deliveryFeeBrl: DEFAULT_DELIVERY_FEE_BRL,
  furnitureAssemblyRate: DEFAULT_ASSEMBLY_RATE,
  fiscalServiceRate: DEFAULT_FISCAL_SERVICE_RATE
});
