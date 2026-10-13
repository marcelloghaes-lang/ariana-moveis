const DEFAULT_DELIVERY_FEE_BRL = 80;
const DEFAULT_ASSEMBLY_RATE = 0.15;
const DEFAULT_FISCAL_SERVICE_RATE = 0.07;

function numberOr(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roundMoney(value) {
  return Math.round((numberOr(value) + Number.EPSILON) * 100) / 100;
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
  return numberOr(
    product.stock ?? product.estoque ?? product.quantity ?? product.quantidade ?? 0,
    0
  );
}

/**
 * Conservative ownership check.
 *
 * Explicit external/seller/dropshipping products are excluded. Products without
 * external ownership markers are treated as Ariana-owned because the historical
 * Ariana catalog predates marketplace metadata.
 */
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

export function calculateGustavoCatalogPrice(basePrice, options = {}) {
  const base = roundMoney(basePrice);
  const deliveryFee = roundMoney(options.deliveryFee ?? DEFAULT_DELIVERY_FEE_BRL);
  const assemblyRate = numberOr(options.assemblyRate, DEFAULT_ASSEMBLY_RATE);
  const fiscalServiceRate = numberOr(options.fiscalServiceRate, DEFAULT_FISCAL_SERVICE_RATE);

  const assemblyFee = roundMoney(base * assemblyRate);
  const fiscalServiceFee = roundMoney(base * fiscalServiceRate);
  const finalPrice = roundMoney(base + deliveryFee + assemblyFee + fiscalServiceFee);

  return {
    basePrice: base,
    deliveryFee,
    assemblyRate,
    assemblyFee,
    fiscalServiceRate,
    fiscalServiceFee,
    finalPrice
  };
}

export function toGustavoCatalogProduct(product = {}, options = {}) {
  const basePrice = productBasePrice(product);
  if (!(basePrice > 0)) return null;
  if (!isArianaOwnedProduct(product)) return null;

  const pricing = calculateGustavoCatalogPrice(basePrice, options);
  return {
    ...product,
    sitePrice: pricing.basePrice,
    price: pricing.finalPrice,
    preco: pricing.finalPrice,
    gustavoCatalog: true,
    gustavoPricing: pricing,
    stock: productStock(product)
  };
}

export function buildGustavoCatalog(products = [], options = {}) {
  if (!Array.isArray(products)) return [];
  return products
    .map((product) => toGustavoCatalogProduct(product, options))
    .filter(Boolean);
}

export const GUSTAVO_CATALOG_PRICING = Object.freeze({
  deliveryFeeBrl: DEFAULT_DELIVERY_FEE_BRL,
  assemblyRate: DEFAULT_ASSEMBLY_RATE,
  fiscalServiceRate: DEFAULT_FISCAL_SERVICE_RATE
});
