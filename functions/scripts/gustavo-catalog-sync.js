import fs from 'fs';
import { buildGustavoCatalog } from '../lib/gustavoCatalog.js';

const BACKEND_URL = String(process.env.ARIANA_BACKEND_URL || 'https://ariana-backend.onrender.com').replace(/\/$/, '');
const OUTPUT_FILE = String(process.env.GUSTAVO_CATALOG_FILE || '/root/gustavo-catalog.json');
const API_TOKEN = String(process.env.LOJA_BOT_API_TOKEN || '').trim();

function headers() {
  const out = { accept: 'application/json' };
  if (API_TOKEN) out.authorization = `Bearer ${API_TOKEN}`;
  return out;
}

function extractProducts(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ['products', 'produtos', 'data', 'items']) {
    if (Array.isArray(payload?.[key])) return payload[key];
    if (Array.isArray(payload?.data?.[key])) return payload.data[key];
  }
  return [];
}

async function fetchSiteProducts() {
  const candidates = ['/api/products', '/api/produtos'];
  let lastError = null;
  for (const path of candidates) {
    try {
      const response = await fetch(`${BACKEND_URL}${path}`, { headers: headers() });
      if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
      const payload = await response.json();
      const products = extractProducts(payload);
      if (products.length || Array.isArray(payload)) return products;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Não foi possível carregar o catálogo do site.');
}

function writeAtomically(file, payload) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
  fs.renameSync(tmp, file);
}

async function main() {
  const siteProducts = await fetchSiteProducts();
  const products = buildGustavoCatalog(siteProducts);
  const payload = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    source: 'Ariana Móveis',
    readOnlySource: true,
    siteProductsRead: siteProducts.length,
    arianaProductsSaved: products.length,
    products
  };

  writeAtomically(OUTPUT_FILE, payload);
  console.log(JSON.stringify({
    ok: true,
    output: OUTPUT_FILE,
    siteProductsRead: siteProducts.length,
    arianaProductsSaved: products.length
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }));
  process.exitCode = 1;
});
