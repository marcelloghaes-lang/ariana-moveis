import express from 'express';
import { fetchDsliteBetoCatalog, DSLITE_BETO_APPROVED_SKUS, DSLITE_BETO_SUPPLIER_ID } from '../services/dsliteIntegrationService.js';

const app = express();
const port = Number(process.env.PORT || 10000);

app.disable('x-powered-by');

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'Ariana DSLite Beto Shadow',
    mode: 'read_only',
    supplier: 'Beto Móveis',
    supplierId: DSLITE_BETO_SUPPLIER_ID,
    approvedSkuCount: DSLITE_BETO_APPROVED_SKUS.length,
    tokenConfigured: Boolean(String(process.env.DSLITE_API_TOKEN || process.env.DSLITE_TOKEN || '').trim()),
    writesEnabled: false,
    storefrontPublishEnabled: false
  });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, mode: 'read_only', writesEnabled: false, storefrontPublishEnabled: false });
});

app.get('/preview', async (_req, res) => {
  try {
    const catalog = await fetchDsliteBetoCatalog({ timeoutMs: 30000 });
    const products = catalog.products.map((item) => ({
      sku: item.sku,
      name: item.name,
      brand: item.brand,
      category: item.category,
      rawCategory: item.rawCategory,
      supplierCost: item.supplierCost,
      supplierStock: item.supplierStock,
      ean: item.ean,
      image: item.imageUrls?.[0] || '',
      imageCount: item.imageUrls?.length || 0,
      parentSku: item.parentSku || '',
      variationGroup: item.variationGroup || item.sku,
      status: item.status
    }));

    res.json({
      ok: true,
      mode: 'read_only',
      writesEnabled: false,
      storefrontPublishEnabled: false,
      supplier: catalog.supplier,
      supplierId: catalog.supplierId,
      fetchedAt: catalog.fetchedAt,
      totalParsed: catalog.totalParsed,
      approvedCount: catalog.approvedCount,
      expectedApprovedCount: catalog.expectedApprovedCount,
      diagnostics: catalog.diagnostics,
      products
    });
  } catch (error) {
    res.status(error?.code === 'DSLITE_TOKEN_MISSING' ? 503 : 502).json({
      ok: false,
      mode: 'read_only',
      writesEnabled: false,
      storefrontPublishEnabled: false,
      code: error?.code || 'DSLITE_PREVIEW_ERROR',
      error: error?.message || 'Falha ao consultar catálogo DSLite.'
    });
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`[dslite-beto-shadow] online na porta ${port} | read-only | sem escrita em produção`);
});
