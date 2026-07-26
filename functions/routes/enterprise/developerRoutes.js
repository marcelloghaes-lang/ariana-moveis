// ============================================================
// ROTAS ENTERPRISE - DEVELOPER PORTAL
// Extraído de routes/enterpriseRoutes.js sem alterar endpoints, regras ou respostas.
// ============================================================

export default function registerEnterpriseDeveloperRoutes(app, context = {}) {
  const {
    enterpriseVersionHeaders
  } = context;

  // ============================================================
  // PASSO 36 - PORTAL DEVELOPER PREMIUM ARIANA ENTERPRISE
  // Central profissional para desenvolvedores: guias, SDKs, Postman, status, console e downloads
  // ============================================================
  const ARIANA_ENTERPRISE_DEVELOPER_PREMIUM = {
    ok: true,
    portal: {
      name: 'Ariana Enterprise Developer Premium',
      version: '1.0.0',
      status: 'active',
      publicUrl: 'https://arianamoveis.com.br/developer_portal.html',
      description: 'Central unificada para fabricantes, ERPs e distribuidores integrarem com a Ariana Enterprise.'
    },
    environments: {
      sandbox: {
        baseUrl: 'https://ariana-backend.onrender.com/api/v1/enterprise',
        purpose: 'Homologação, testes de catálogo, pedido, NF-e, rastreio e webhooks.'
      },
      production: {
        baseUrl: 'https://ariana-backend.onrender.com/api/v1/enterprise',
        purpose: 'Operação real após homologação 100% aprovada e liberação de produção.'
      }
    },
    resources: [
      { name: 'Documentação Interativa', type: 'docs', url: '/ariana_enterprise_docs.html' },
      { name: 'Swagger / OpenAPI', type: 'openapi', url: '/enterprise_swagger.html' },
      { name: 'API Explorer', type: 'tester', url: '/enterprise_api_explorer.html' },
      { name: 'SDK Oficial', type: 'sdk', url: '/ariana_enterprise_sdk.html' },
      { name: 'Console Enterprise', type: 'monitoring', url: '/enterprise_console.html' },
      { name: 'Portal do Fabricante', type: 'portal', url: '/portal_fabricante.html' }
    ],
    sdks: [
      { language: 'JavaScript', status: 'available', download: '/sdk/js/ariana-enterprise-sdk.js', manifest: '/api/enterprise/sdk/manifest' },
      { language: 'Node.js', status: 'available', download: '/sdk/node/ariana-enterprise-node-sdk.zip', manifest: '/api/enterprise/sdk/manifest' },
      { language: 'PHP', status: 'available', download: '/sdk/php/ariana-enterprise-php-sdk.zip', manifest: '/api/enterprise/sdk/php/manifest' },
      { language: 'Python', status: 'available', download: '/sdk/python/ariana-enterprise-python-sdk.zip', manifest: '/api/enterprise/sdk/python/manifest' },
      { language: 'Java', status: 'available', download: '/sdk/java/ariana-enterprise-java-sdk.zip', manifest: '/api/enterprise/sdk/java/manifest' },
      { language: '.NET', status: 'available', download: '/sdk/dotnet/ariana-enterprise-dotnet-sdk.zip', manifest: '/api/enterprise/sdk/dotnet/manifest' }
    ],
    onboardingChecklist: [
      'Criar solicitação de homologação',
      'Receber API Key Sandbox',
      'Testar Health, Catálogo, Estoque e Preço',
      'Criar Pedido Sandbox',
      'Vincular NF-e, XML e DANFE',
      'Enviar Rastreio',
      'Configurar Webhook com HMAC',
      'Executar homologação automática',
      'Receber API Key Live',
      'Monitorar consumo no Console Enterprise'
    ]
  };

  function buildArianaPostmanCollection() {
    const base = '{{baseUrl}}';
    const authHeader = [{ key: 'x-ariana-key', value: '{{apiKey}}', type: 'text' }];
    const jsonHeader = [{ key: 'Content-Type', value: 'application/json', type: 'text' }, ...authHeader];
    return {
      info: {
        name: 'Ariana Enterprise API',
        description: 'Coleção oficial para fabricantes, ERPs e distribuidores integrarem catálogo, estoque, preço, pedidos, NF-e, rastreio e webhooks.',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
        version: '1.0.0'
      },
      variable: [
        { key: 'baseUrl', value: 'https://ariana-backend.onrender.com/api/v1/enterprise' },
        { key: 'apiKey', value: 'ari_sbx_xxxxx' },
        { key: 'sku', value: 'ARI-0001' },
        { key: 'orderId', value: 'PED-0001' }
      ],
      item: [
        { name: 'Health', request: { method: 'GET', header: [], url: `${base}/health` } },
        { name: 'Auth Check', request: { method: 'GET', header: authHeader, url: `${base}/auth/check` } },
        { name: 'Catálogo - Push', request: { method: 'POST', header: jsonHeader, url: `${base}/catalog/push`, body: { mode: 'raw', raw: JSON.stringify({ manufacturer: 'ariana_moveis', products: [{ sku: 'ARI-0001', name: 'Produto Teste', price: 2299, stock: 10 }] }, null, 2) } } },
        { name: 'Estoque - Atualizar', request: { method: 'PUT', header: jsonHeader, url: `${base}/products/{{sku}}/stock`, body: { mode: 'raw', raw: JSON.stringify({ manufacturer: 'ariana_moveis', stock: 8, availability: 'available' }, null, 2) } } },
        { name: 'Preço - Atualizar', request: { method: 'PUT', header: jsonHeader, url: `${base}/products/{{sku}}/price`, body: { mode: 'raw', raw: JSON.stringify({ manufacturer: 'ariana_moveis', price: 2199.9 }, null, 2) } } },
        { name: 'Pedido - Criar', request: { method: 'POST', header: jsonHeader, url: `${base}/orders`, body: { mode: 'raw', raw: JSON.stringify({ manufacturer: 'ariana_moveis', externalOrderId: 'PED-0001', customerName: 'Cliente Teste', items: [{ sku: 'ARI-0001', qty: 1, unitPrice: 2299 }] }, null, 2) } } },
        { name: 'NF-e - Vincular', request: { method: 'POST', header: jsonHeader, url: `${base}/orders/{{orderId}}/invoice`, body: { mode: 'raw', raw: JSON.stringify({ manufacturer: 'ariana_moveis', invoice: { number: '12345', xmlUrl: 'https://exemplo.com/nfe.xml', danfeUrl: 'https://exemplo.com/danfe.pdf' } }, null, 2) } } },
        { name: 'Rastreio - Atualizar', request: { method: 'POST', header: jsonHeader, url: `${base}/orders/{{orderId}}/tracking`, body: { mode: 'raw', raw: JSON.stringify({ manufacturer: 'ariana_moveis', carrier: 'Transportadora Ariana', trackingCode: 'TESTE123456789BR', trackingUrl: 'https://rastreamento.exemplo.com' }, null, 2) } } },
        { name: 'Webhook - Teste', request: { method: 'POST', header: jsonHeader, url: `${base}/webhooks/test`, body: { mode: 'raw', raw: JSON.stringify({ event: 'order_ack', message: 'Webhook de teste recebido' }, null, 2) } } }
      ]
    };
  }

  app.get('/api/enterprise/developer/premium/overview', async (_req, res) => {
    return res.json(ARIANA_ENTERPRISE_DEVELOPER_PREMIUM);
  });

  app.get('/api/v1/enterprise/developer/premium/overview', enterpriseVersionHeaders('v1'), async (_req, res) => {
    return res.json({ ...ARIANA_ENTERPRISE_DEVELOPER_PREMIUM, requestedVersion: 'v1' });
  });

  app.get('/api/v2/enterprise/developer/premium/overview', enterpriseVersionHeaders('v2', true), async (_req, res) => {
    return res.json({ ...ARIANA_ENTERPRISE_DEVELOPER_PREMIUM, requestedVersion: 'v2', warning: 'v2 ainda está em preview.' });
  });

  app.get('/api/enterprise/developer/downloads', async (_req, res) => {
    return res.json({ ok: true, downloads: ARIANA_ENTERPRISE_DEVELOPER_PREMIUM.sdks, resources: ARIANA_ENTERPRISE_DEVELOPER_PREMIUM.resources });
  });

  app.get('/api/enterprise/developer/postman', async (_req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="ariana-enterprise-postman-collection.json"');
    return res.json(buildArianaPostmanCollection());
  });

  app.get('/api/v1/enterprise/developer/postman', enterpriseVersionHeaders('v1'), async (_req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="ariana-enterprise-v1-postman-collection.json"');
    return res.json(buildArianaPostmanCollection());
  });
}
