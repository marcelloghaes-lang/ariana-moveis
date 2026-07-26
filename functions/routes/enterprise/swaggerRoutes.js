// ============================================================
// ROTAS ENTERPRISE - SWAGGER / OPENAPI
// Extraído de routes/enterpriseRoutes.js sem alterar endpoints, regras ou respostas.
// ============================================================

export default function registerEnterpriseSwaggerRoutes(app, context = {}) {
  const { FRONTEND_URL } = context;

// ============================================================
// PASSO 22 - OPENAPI / SWAGGER ARIANA ENTERPRISE
// Documentação automática da API Enterprise para fabricantes, distribuidores e ERPs.
// ============================================================
function buildEnterpriseOpenApiSpec(req = null) {
  const origin = req ? `${(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0]}://${(req.headers['x-forwarded-host'] || req.get('host') || 'ariana-backend.onrender.com').split(',')[0]}` : 'https://ariana-backend.onrender.com';
  const baseUrl = (process.env.ENTERPRISE_API_BASE_URL || `${origin}/api`).replace(/\/+$/, '');
  const version = process.env.ENTERPRISE_API_VERSION || '1.0.0';
  const commonError = {
    type: 'object',
    properties: {
      ok: { type: 'boolean', example: false },
      error: { type: 'string', example: 'Chave de integração inválida' }
    }
  };
  const okSchema = {
    type: 'object',
    properties: {
      ok: { type: 'boolean', example: true },
      message: { type: 'string', example: 'Operação realizada com sucesso' }
    }
  };
  const apiKeySecurity = [{ ArianaApiKey: [] }];
  return {
    openapi: '3.0.3',
    info: {
      title: 'Ariana Enterprise API',
      version,
      description: 'API oficial da Ariana Enterprise para integração de catálogo, estoque, preço, pedidos, NF-e, rastreio, webhooks, OAuth 2.0 e versionamento v1/v2.'
    },
    servers: [
      { url: baseUrl, description: 'Produção / Sandbox Ariana Backend' }
    ],
    tags: [
      { name: 'Health', description: 'Disponibilidade da API' },
      { name: 'Catálogo', description: 'Criação e atualização de produtos' },
      { name: 'Estoque e Preço', description: 'Atualização individual de estoque e preço por SKU' },
      { name: 'Pedidos', description: 'Recebimento de pedidos Enterprise' },
      { name: 'NF-e', description: 'Vínculo de XML, DANFE e dados fiscais' },
      { name: 'Rastreio', description: 'Atualização de transportadora, código e URL de rastreio' },
      { name: 'Webhooks', description: 'Eventos, teste, entrega e assinatura HMAC' },
      { name: 'Portal do Fabricante', description: 'Área autenticada do parceiro Enterprise' }
    ],
    components: {
      securitySchemes: {
        ArianaApiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'x-ariana-key',
          description: 'API Key Sandbox ou Produção liberada na homologação.'
        },
        EnterpriseOAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'OAuth 2.0 Client Credentials - Bearer Token Enterprise' },
        PartnerBearer: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Token JWT do Portal do Fabricante.'
        }
      },
      schemas: {
        Error: commonError,
        Ok: okSchema,
        ProductInput: {
          type: 'object',
          required: ['manufacturer', 'products'],
          properties: {
            manufacturer: { type: 'string', example: 'ariana_moveis' },
            products: {
              type: 'array',
              items: {
                type: 'object',
                required: ['sku', 'name', 'price'],
                properties: {
                  sku: { type: 'string', example: 'ARI-0001' },
                  name: { type: 'string', example: 'Geladeira Frost Free 451L' },
                  description: { type: 'string', example: 'Produto enviado via API Enterprise.' },
                  category: { type: 'string', example: 'Eletrodomésticos' },
                  brand: { type: 'string', example: 'Ariana Móveis' },
                  price: { type: 'number', example: 2500 },
                  stock: { type: 'integer', example: 12 },
                  weight: { type: 'number', example: 60 },
                  height: { type: 'number', example: 175 },
                  width: { type: 'number', example: 70 },
                  length: { type: 'number', example: 70 },
                  imageUrl: { type: 'string', example: 'https://exemplo.com/produto.jpg' }
                }
              }
            }
          }
        },
        StockUpdate: {
          type: 'object',
          properties: {
            manufacturer: { type: 'string', example: 'ariana_moveis' },
            stock: { type: 'integer', example: 8 },
            availability: { type: 'string', example: 'available' },
            active: { type: 'boolean', example: true }
          }
        },
        PriceUpdate: {
          type: 'object',
          properties: {
            manufacturer: { type: 'string', example: 'ariana_moveis' },
            price: { type: 'number', example: 2399.9 },
            status: { type: 'string', example: 'updated_by_erp' }
          }
        },
        EnterpriseOrder: {
          type: 'object',
          required: ['manufacturer', 'externalOrderId', 'items'],
          properties: {
            manufacturer: { type: 'string', example: 'ariana_moveis' },
            externalOrderId: { type: 'string', example: 'ARI-PED-0001' },
            customerName: { type: 'string', example: 'Cliente Teste' },
            customerEmail: { type: 'string', example: 'cliente@teste.com' },
            customerPhone: { type: 'string', example: '31999999999' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  sku: { type: 'string', example: 'ARI-0001' },
                  name: { type: 'string', example: 'Geladeira Teste' },
                  qty: { type: 'integer', example: 1 },
                  unitPrice: { type: 'number', example: 2500 },
                  sellerId: { type: 'string', example: 'ariana_moveis' }
                }
              }
            }
          }
        },
        InvoiceInput: {
          type: 'object',
          properties: {
            manufacturer: { type: 'string', example: 'ariana_moveis' },
            invoice: {
              type: 'object',
              properties: {
                number: { type: 'string', example: '12345' },
                series: { type: 'string', example: '1' },
                accessKey: { type: 'string', example: '31260600000000000000550010000123451000012345' },
                danfeUrl: { type: 'string', example: 'https://teste.com/danfe-12345.pdf' },
                xmlUrl: { type: 'string', example: 'https://teste.com/nfe-12345.xml' },
                total: { type: 'number', example: 2500 }
              }
            }
          }
        },
        TrackingInput: {
          type: 'object',
          properties: {
            manufacturer: { type: 'string', example: 'ariana_moveis' },
            trackingCode: { type: 'string', example: 'TESTE123456789BR' },
            carrier: { type: 'string', example: 'Transportadora Ariana' },
            trackingUrl: { type: 'string', example: 'https://rastreamento.teste.com/TESTE123456789BR' }
          }
        },
        WebhookConfig: {
          type: 'object',
          properties: {
            url: { type: 'string', example: 'https://seu-erp.com.br/webhooks/ariana' },
            secret: { type: 'string', example: 'whsec_xxxxxxxxx' },
            active: { type: 'boolean', example: true },
            events: { type: 'array', items: { type: 'string' }, example: ['order_created', 'payment_approved', 'invoice_received', 'tracking_updated'] }
          }
        }
      }
    },
    paths: {
      '/enterprise/health': {
        get: {
          tags: ['Health'],
          summary: 'Verifica se a API Enterprise está online',
          security: [],
          responses: {
            200: { description: 'API online', content: { 'application/json': { schema: okSchema, example: { ok: true, module: 'enterprise', status: 'online' } } } }
          }
        }
      },
      '/enterprise/auth/check': {
        get: {
          tags: ['Health'],
          summary: 'Valida a API Key enviada no header x-ariana-key',
          security: apiKeySecurity,
          responses: {
            200: { description: 'Chave válida', content: { 'application/json': { schema: okSchema } } },
            401: { description: 'Chave ausente ou inválida', content: { 'application/json': { schema: commonError } } }
          }
        }
      },
      '/enterprise/catalog/push': {
        post: {
          tags: ['Catálogo'],
          summary: 'Cria ou atualiza produtos em lote',
          security: apiKeySecurity,
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ProductInput' } } } },
          responses: {
            201: { description: 'Catálogo recebido', content: { 'application/json': { schema: okSchema } } },
            401: { description: 'Chave inválida', content: { 'application/json': { schema: commonError } } }
          }
        }
      },
      '/enterprise/products/{sku}/sync': {
        post: {
          tags: ['Estoque e Preço'],
          summary: 'Atualiza estoque, preço e status de um produto por SKU',
          security: apiKeySecurity,
          parameters: [{ name: 'sku', in: 'path', required: true, schema: { type: 'string' }, example: 'ARI-0001' }],
          requestBody: { required: true, content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/StockUpdate' }, { $ref: '#/components/schemas/PriceUpdate' }] } } } },
          responses: { 200: { description: 'Produto atualizado', content: { 'application/json': { schema: okSchema } } } }
        }
      },
      '/enterprise/products/{sku}/stock': {
        put: {
          tags: ['Estoque e Preço'],
          summary: 'Atualiza somente o estoque de um SKU',
          security: apiKeySecurity,
          parameters: [{ name: 'sku', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/StockUpdate' } } } },
          responses: { 200: { description: 'Estoque atualizado', content: { 'application/json': { schema: okSchema } } } }
        }
      },
      '/enterprise/products/{sku}/price': {
        put: {
          tags: ['Estoque e Preço'],
          summary: 'Atualiza somente o preço de um SKU',
          security: apiKeySecurity,
          parameters: [{ name: 'sku', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/PriceUpdate' } } } },
          responses: { 200: { description: 'Preço atualizado', content: { 'application/json': { schema: okSchema } } } }
        }
      },
      '/enterprise/orders': {
        post: {
          tags: ['Pedidos'],
          summary: 'Cria pedido Enterprise recebido de ERP, fabricante ou distribuidor',
          security: apiKeySecurity,
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/EnterpriseOrder' } } } },
          responses: { 201: { description: 'Pedido criado', content: { 'application/json': { schema: okSchema } } } }
        }
      },
      '/enterprise/orders/{orderId}/invoice': {
        post: {
          tags: ['NF-e'],
          summary: 'Anexa NF-e, XML e DANFE a um pedido',
          security: apiKeySecurity,
          parameters: [{ name: 'orderId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/InvoiceInput' } } } },
          responses: { 200: { description: 'NF-e vinculada', content: { 'application/json': { schema: okSchema } } } }
        }
      },
      '/enterprise/orders/{orderId}/tracking': {
        post: {
          tags: ['Rastreio'],
          summary: 'Atualiza rastreio do pedido',
          security: apiKeySecurity,
          parameters: [{ name: 'orderId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/TrackingInput' } } } },
          responses: { 200: { description: 'Rastreio atualizado', content: { 'application/json': { schema: okSchema } } } }
        }
      },
      '/enterprise/webhooks/test': {
        post: {
          tags: ['Webhooks'],
          summary: 'Registra evento de webhook de teste',
          security: apiKeySecurity,
          requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', properties: { event: { type: 'string', example: 'order_ack' }, message: { type: 'string', example: 'Webhook de teste recebido' } } } } } },
          responses: { 200: { description: 'Webhook de teste registrado', content: { 'application/json': { schema: okSchema } } } }
        }
      },
      '/enterprise/oauth/token': { post: { tags: ['OAuth 2.0'], summary: 'Emite Bearer Token usando Client Credentials', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { grant_type: { type: 'string', example: 'client_credentials' }, client_id: { type: 'string' }, client_secret: { type: 'string' } } } } } }, responses: { '200': { description: 'Token emitido' }, '401': { description: 'Credenciais inválidas' } } } },
      '/enterprise/versions': { get: { tags: ['Versionamento'], summary: 'Lista versões suportadas da API Enterprise', responses: { '200': { description: 'Versões retornadas' } } } },
      '/v1/enterprise/versions': { get: { tags: ['Versionamento'], summary: 'Versões via v1', responses: { '200': { description: 'Versões retornadas' } } } },
      '/v2/enterprise/versions': { get: { tags: ['Versionamento'], summary: 'Versões via v2 preview', responses: { '200': { description: 'Versões retornadas' } } } },
      '/enterprise/oauth/check': { get: { tags: ['OAuth 2.0'], summary: 'Valida Bearer Token OAuth Enterprise', security: [{ EnterpriseOAuth: [] }], responses: { '200': { description: 'Token válido' }, '401': { description: 'Token inválido' } } } },
      '/enterprise/partner/login': {
        post: {
          tags: ['Portal do Fabricante'],
          summary: 'Login do fabricante usando API Key Sandbox',
          security: [],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { apiKey: { type: 'string', example: 'ari_sbx_xxxxxxxxx' } } } } } },
          responses: { 200: { description: 'Login realizado', content: { 'application/json': { schema: okSchema } } } }
        }
      },
      '/enterprise/partner/me': {
        get: {
          tags: ['Portal do Fabricante'],
          summary: 'Dados do fabricante autenticado',
          security: [{ PartnerBearer: [] }],
          responses: { 200: { description: 'Dados do parceiro', content: { 'application/json': { schema: okSchema } } } }
        }
      },
      '/enterprise/partner/usage': {
        get: {
          tags: ['Portal do Fabricante'],
          summary: 'Métricas de consumo da API',
          security: [{ PartnerBearer: [] }],
          parameters: [
            { name: 'days', in: 'query', schema: { type: 'integer', default: 7 } },
            { name: 'status', in: 'query', schema: { type: 'string', example: '2xx' } },
            { name: 'q', in: 'query', schema: { type: 'string', example: 'catalog' } }
          ],
          responses: { 200: { description: 'Métricas retornadas', content: { 'application/json': { schema: okSchema } } } }
        }
      },
      '/enterprise/partner/logs': {
        get: {
          tags: ['Portal do Fabricante'],
          summary: 'Logs profissionais com filtros e paginação',
          security: [{ PartnerBearer: [] }],
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'q', in: 'query', schema: { type: 'string' } },
            { name: 'status', in: 'query', schema: { type: 'string' } }
          ],
          responses: { 200: { description: 'Logs retornados', content: { 'application/json': { schema: okSchema } } } }
        }
      },
      '/enterprise/partner/webhooks/config': {
        post: {
          tags: ['Webhooks'],
          summary: 'Salva URL, secret e eventos de webhook do fabricante',
          security: [{ PartnerBearer: [] }],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/WebhookConfig' } } } },
          responses: { 200: { description: 'Configuração salva', content: { 'application/json': { schema: okSchema } } } }
        }
      }
    }
  };
}

function enterpriseSwaggerHtml() {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Swagger | Ariana Enterprise</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    body{margin:0;background:#f3f7fb;font-family:Inter,Arial,sans-serif}.top{background:linear-gradient(135deg,#0047AB,#0ea5e9);color:#fff;padding:24px 34px;display:flex;justify-content:space-between;gap:14px;align-items:center}.top h1{margin:0;font-size:30px}.top p{margin:5px 0 0;opacity:.95}.top a{background:#fff;color:#0047AB;text-decoration:none;font-weight:900;border-radius:12px;padding:12px 15px}#swagger-ui{max-width:1280px;margin:0 auto;padding:22px}.swagger-ui .topbar{display:none}
  </style>
</head>
<body>
  <div class="top"><div><h1>Ariana Enterprise API</h1><p>Swagger/OpenAPI automático para fabricantes, distribuidores e ERPs.</p></div><div><a href="/api/enterprise/openapi.json" target="_blank">Baixar OpenAPI JSON</a> <a href="${FRONTEND_URL || 'https://arianamoveis.com.br'}/portal_fabricante.html">Portal</a></div></div>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: '/api/enterprise/openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      persistAuthorization: true,
      displayRequestDuration: true,
      tryItOutEnabled: true
    });
  </script>
</body>
</html>`;
}

app.get('/api/enterprise/openapi.json', (req, res) => {
  return res.json(buildEnterpriseOpenApiSpec(req));
});

app.get('/api/enterprise/swagger', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(enterpriseSwaggerHtml());
});

app.get('/api/enterprise/docs', (_req, res) => {
  return res.redirect('/api/enterprise/swagger');
});
}
