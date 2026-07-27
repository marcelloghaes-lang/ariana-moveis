// ============================================================
// ROTAS ENTERPRISE - SDK / DEVELOPER MANIFEST
// Extraído de routes/enterpriseRoutes.js sem alterar endpoints, regras ou respostas.
// ============================================================

export default function registerEnterpriseSdkRoutes(app, context = {}) {
  const {
    enterpriseVersionHeaders
  } = context;

// ============================================================
// PASSO 29 - SDK OFICIAL ARIANA ENTERPRISE
// Manifest e exemplos para Portal do Desenvolvedor / Fabricante
// ============================================================
const ARIANA_ENTERPRISE_SDK_MANIFEST = {
  ok: true,
  sdk: {
    name: 'Ariana Enterprise SDK',
    version: '1.0.0',
    status: 'preview',
    languages: ['javascript', 'nodejs', 'php', 'python', 'java', 'curl'],
    baseUrl: 'https://ariana-backend.onrender.com/api',
    stableVersion: 'v1',
    previewVersion: 'v2'
  },
  downloads: {
    browser: '/sdk/js/ariana-enterprise-sdk.js',
    node: '/sdk/node/ariana-enterprise-node-sdk.zip',
    php: '/sdk/php/ariana-enterprise-php-sdk.zip',
    phpDocs: '/sdk/php/ariana-enterprise-php/README.md',
    python: '/sdk/python/ariana-enterprise-python-sdk.zip',
    pythonDocs: '/sdk/python/ariana_enterprise_python/README.md',
    java: '/sdk/java/ariana-enterprise-java-sdk.zip',
    javaDocs: '/sdk/java/ariana_enterprise_java/README.md',
    docs: '/ariana_enterprise_sdk.html'
  },
  features: [
    'health', 'auth_check', 'catalog_push', 'stock_update', 'price_update',
    'order_create', 'invoice_attach', 'tracking_update', 'webhook_test',
    'api_key_auth', 'oauth2_client_credentials', 'bearer_token_ready', 'versioned_api_v1_v2', 'timeout_handling', 'php_sdk', 'composer_ready', 'python_sdk', 'pip_ready', 'java_sdk', 'maven_ready', 'spring_boot_ready'
  ],
  endpoints: {
    health: 'GET /api/v1/enterprise/health',
    catalog: 'POST /api/v1/enterprise/catalog/push',
    stock: 'PUT /api/v1/enterprise/products/{sku}/stock',
    price: 'PUT /api/v1/enterprise/products/{sku}/price',
    order: 'POST /api/v1/enterprise/orders',
    invoice: 'POST /api/v1/enterprise/orders/{orderId}/invoice',
    tracking: 'POST /api/v1/enterprise/orders/{orderId}/tracking',
    webhook: 'POST /api/v1/enterprise/webhooks/test'
  }
};

app.get('/api/enterprise/sdk/manifest', (_req, res) => {
  return res.json(ARIANA_ENTERPRISE_SDK_MANIFEST);
});

app.get('/api/v1/enterprise/sdk/manifest', enterpriseVersionHeaders('v1'), (_req, res) => {
  return res.json({ ...ARIANA_ENTERPRISE_SDK_MANIFEST, requestedVersion: 'v1' });
});

app.get('/api/v2/enterprise/sdk/manifest', enterpriseVersionHeaders('v2', true), (_req, res) => {
  return res.json({ ...ARIANA_ENTERPRISE_SDK_MANIFEST, requestedVersion: 'v2', warning: 'v2 ainda está em preview.' });
});

app.get('/api/enterprise/sdk/examples', (_req, res) => {
  return res.json({
    ok: true,
    examples: {
      javascript: `const api = new ArianaEnterpriseSDK({ apiKey: 'ari_sbx_xxxxx', environment: 'sandbox' });\nawait api.health();`,
      nodejs: `const { ArianaEnterpriseClient } = require('./ariana-enterprise-sdk');\nconst api = new ArianaEnterpriseClient({ apiKey: 'ari_live_xxxxx', environment: 'production' });\nawait api.catalog.push([{ sku:'ARI-0001', name:'Produto Teste', price:2299, stock:10 }]);`,
      python: `from ariana_enterprise import ArianaEnterpriseClient\napi = ArianaEnterpriseClient(api_key='ari_live_xxxxx', environment='production')\napi.catalog.push([{'sku':'ARI-0001','name':'Produto Teste','price':2299,'stock':10}])`,
      php: `use ArianaEnterprise\\Client;\n$api = new Client(['apiKey' => 'ari_live_xxxxx', 'environment' => 'production']);\n$api->catalog()->push([['sku'=>'ARI-0001','name'=>'Produto Teste','price'=>2299,'stock'=>10]]);`,
      curl: `curl -H "x-ariana-key: ari_live_xxxxx" https://ariana-backend.onrender.com/api/v1/enterprise/health`
    }
  });
});



// ============================================================
// PASSO 31 - SDK PHP OFICIAL ARIANA ENTERPRISE
// Manifest específico do pacote PHP/Composer para ERPs brasileiros
// ============================================================
const ARIANA_ENTERPRISE_PHP_SDK_MANIFEST = {
  ok: true,
  sdk: {
    name: 'Ariana Enterprise PHP SDK',
    package: 'ariana/enterprise-sdk',
    version: '1.0.0',
    status: 'preview',
    php: '>=8.1',
    compatibleWith: ['PHP puro', 'Laravel', 'Symfony', 'CodeIgniter', 'Slim', 'Magento', 'WooCommerce custom integrations']
  },
  downloads: {
    zip: '/sdk/php/ariana-enterprise-php-sdk.zip',
    readme: '/sdk/php/ariana-enterprise-php/README.md',
    examples: '/sdk/php/ariana-enterprise-php/examples/full_flow.php'
  },
  install: {
    composer: 'composer require ariana/enterprise-sdk',
    local: 'composer config repositories.ariana-enterprise path ./ariana-enterprise-php && composer require ariana/enterprise-sdk:*'
  },
  features: [
    'api_key_auth', 'oauth2_client_credentials', 'retry', 'timeout', 'error_handling',
    'catalog_push', 'stock_update', 'price_update', 'order_create', 'invoice_attach',
    'tracking_update', 'webhook_test'
  ]
};

app.get('/api/enterprise/sdk/php/manifest', (_req, res) => {
  return res.json(ARIANA_ENTERPRISE_PHP_SDK_MANIFEST);
});

app.get('/api/v1/enterprise/sdk/php/manifest', enterpriseVersionHeaders('v1'), (_req, res) => {
  return res.json({ ...ARIANA_ENTERPRISE_PHP_SDK_MANIFEST, requestedVersion: 'v1' });
});

app.get('/api/v2/enterprise/sdk/php/manifest', enterpriseVersionHeaders('v2', true), (_req, res) => {
  return res.json({ ...ARIANA_ENTERPRISE_PHP_SDK_MANIFEST, requestedVersion: 'v2', warning: 'v2 ainda está em preview.' });
});


// ============================================================
// PASSO 32 - SDK PYTHON OFICIAL ARIANA ENTERPRISE
// Manifest específico do pacote Python/Pip para ERPs, automações e integrações de dados
// ============================================================
const ARIANA_ENTERPRISE_PYTHON_SDK_MANIFEST = {
  ok: true,
  sdk: {
    name: 'Ariana Enterprise Python SDK',
    package: 'ariana-enterprise',
    version: '1.0.0',
    status: 'preview',
    python: '>=3.9',
    compatibleWith: ['Python puro', 'Django', 'FastAPI', 'Flask', 'Airflow', 'Pandas pipelines', 'ERPs customizados', 'integrações de dados']
  },
  downloads: {
    zip: '/sdk/python/ariana-enterprise-python-sdk.zip',
    readme: '/sdk/python/ariana_enterprise_python/README.md',
    examples: '/sdk/python/ariana_enterprise_python/examples/full_flow.py'
  },
  install: {
    pip: 'pip install ariana-enterprise',
    local: 'pip install ./ariana_enterprise_python'
  },
  features: [
    'api_key_auth', 'oauth2_client_credentials', 'retry', 'timeout', 'error_handling',
    'catalog_push', 'stock_update', 'price_update', 'order_create', 'invoice_attach',
    'tracking_update', 'webhook_test', 'versioned_api_v1_v2'
  ]
};

app.get('/api/enterprise/sdk/python/manifest', (_req, res) => {
  return res.json(ARIANA_ENTERPRISE_PYTHON_SDK_MANIFEST);
});

app.get('/api/v1/enterprise/sdk/python/manifest', enterpriseVersionHeaders('v1'), (_req, res) => {
  return res.json({ ...ARIANA_ENTERPRISE_PYTHON_SDK_MANIFEST, requestedVersion: 'v1' });
});

app.get('/api/v2/enterprise/sdk/python/manifest', enterpriseVersionHeaders('v2', true), (_req, res) => {
  return res.json({ ...ARIANA_ENTERPRISE_PYTHON_SDK_MANIFEST, requestedVersion: 'v2', warning: 'v2 ainda está em preview.' });
});


// ============================================================
// PASSO 33 - SDK JAVA OFICIAL ARIANA ENTERPRISE
// Manifest específico do pacote Java/Maven para ERPs corporativos, Spring Boot e integrações JVM
// ============================================================
const ARIANA_ENTERPRISE_JAVA_SDK_MANIFEST = {
  ok: true,
  sdk: {
    name: 'Ariana Enterprise Java SDK',
    package: 'br.com.arianamoveis:ariana-enterprise-java',
    version: '1.0.0',
    status: 'preview',
    java: '>=17',
    buildTools: ['maven', 'gradle'],
    frameworks: ['Spring Boot', 'Jakarta EE', 'Quarkus', 'Micronaut', 'Java puro']
  },
  downloads: {
    zip: '/sdk/java/ariana-enterprise-java-sdk.zip',
    readme: '/sdk/java/ariana_enterprise_java/README.md',
    pom: '/sdk/java/ariana_enterprise_java/pom.xml',
    examples: '/sdk/java/ariana_enterprise_java/examples/FullFlowExample.java'
  },
  install: {
    maven: '<dependency><groupId>br.com.arianamoveis</groupId><artifactId>ariana-enterprise-java</artifactId><version>1.0.0</version></dependency>',
    gradle: "implementation 'br.com.arianamoveis:ariana-enterprise-java:1.0.0'",
    local: 'mvn install'
  },
  features: [
    'api_key_auth', 'oauth2_client_credentials', 'bearer_token', 'retry', 'timeout', 'error_handling',
    'catalog_push', 'stock_update', 'price_update', 'order_create', 'invoice_attach',
    'tracking_update', 'webhook_test', 'versioned_api_v1_v2', 'spring_boot_ready'
  ]
};

app.get('/api/enterprise/sdk/java/manifest', (_req, res) => {
  return res.json(ARIANA_ENTERPRISE_JAVA_SDK_MANIFEST);
});

app.get('/api/v1/enterprise/sdk/java/manifest', enterpriseVersionHeaders('v1'), (_req, res) => {
  return res.json({ ...ARIANA_ENTERPRISE_JAVA_SDK_MANIFEST, requestedVersion: 'v1' });
});

app.get('/api/v2/enterprise/sdk/java/manifest', enterpriseVersionHeaders('v2', true), (_req, res) => {
  return res.json({ ...ARIANA_ENTERPRISE_JAVA_SDK_MANIFEST, requestedVersion: 'v2', warning: 'v2 ainda está em preview.' });
});





// ============================================================
// PASSO 34 - SDK .NET OFICIAL ARIANA ENTERPRISE
// Manifest específico do pacote .NET/NuGet para ERPs corporativos, C#, ASP.NET Core e integrações Windows
// ============================================================
const ARIANA_ENTERPRISE_DOTNET_SDK_MANIFEST = {
  ok: true,
  sdk: {
    name: 'Ariana Enterprise .NET SDK',
    package: 'ArianaEnterprise.Sdk',
    version: '1.0.0',
    status: 'preview',
    dotnet: '>=8.0',
    language: 'C#',
    buildTools: ['dotnet cli', 'NuGet', 'Visual Studio'],
    frameworks: ['ASP.NET Core', '.NET Worker Service', 'Windows Service', 'Blazor', 'C# puro']
  },
  downloads: {
    zip: '/sdk/dotnet/ariana-enterprise-dotnet-sdk.zip',
    readme: '/sdk/dotnet/ariana_enterprise_dotnet/README.md',
    project: '/sdk/dotnet/ariana_enterprise_dotnet/ArianaEnterprise.Sdk.csproj',
    examples: '/sdk/dotnet/ariana_enterprise_dotnet/examples/FullFlowExample.cs'
  },
  install: {
    nuget: 'dotnet add package ArianaEnterprise.Sdk --version 1.0.0',
    local: 'dotnet add reference ./ariana_enterprise_dotnet/ArianaEnterprise.Sdk.csproj',
    restore: 'dotnet restore'
  },
  features: [
    'api_key_auth', 'oauth2_client_credentials', 'bearer_token', 'retry', 'timeout', 'error_handling',
    'catalog_push', 'stock_update', 'price_update', 'order_create', 'invoice_attach',
    'tracking_update', 'webhook_test', 'versioned_api_v1_v2', 'aspnet_core_ready', 'httpclient_factory_ready'
  ]
};

app.get('/api/enterprise/sdk/dotnet/manifest', (_req, res) => {
  return res.json(ARIANA_ENTERPRISE_DOTNET_SDK_MANIFEST);
});

app.get('/api/v1/enterprise/sdk/dotnet/manifest', enterpriseVersionHeaders('v1'), (_req, res) => {
  return res.json({ ...ARIANA_ENTERPRISE_DOTNET_SDK_MANIFEST, requestedVersion: 'v1' });
});

app.get('/api/v2/enterprise/sdk/dotnet/manifest', enterpriseVersionHeaders('v2', true), (_req, res) => {
  return res.json({ ...ARIANA_ENTERPRISE_DOTNET_SDK_MANIFEST, requestedVersion: 'v2', warning: 'v2 ainda está em preview.' });
});


// ============================================================
// PASSO 30 - PORTAL DE DOCUMENTAÇÃO INTERATIVA ENTERPRISE
// Manifest oficial de documentação para desenvolvedores, ERPs e fabricantes
// ============================================================
const ARIANA_ENTERPRISE_DEVELOPER_MANIFEST = {
  ok: true,
  portal: {
    name: 'Ariana Enterprise Developer Portal',
    version: '1.0.0',
    status: 'active',
    docsUrl: 'https://arianamoveis.com.br/ariana_enterprise_docs.html',
    swaggerUrl: 'https://arianamoveis.com.br/enterprise_swagger.html',
    sdkUrl: 'https://arianamoveis.com.br/ariana_enterprise_sdk.html',
    phpSdkUrl: 'https://arianamoveis.com.br/sdk/php/ariana-enterprise-php-sdk.zip',
    pythonSdkUrl: 'https://arianamoveis.com.br/sdk/python/ariana-enterprise-python-sdk.zip'
  },
  quickStart: [
    'Solicitar homologação',
    'Receber API Key Sandbox',
    'Executar testes no API Explorer',
    'Finalizar homologação automática',
    'Receber liberação de produção',
    'Ativar webhooks e monitorar logs'
  ],
  authentication: {
    apiKey: 'Header x-ariana-key',
    oauth2: 'Client Credentials com Bearer Token',
    hmac: 'Assinatura para webhooks'
  },
  versions: {
    stable: '/api/v1/enterprise',
    preview: '/api/v2/enterprise'
  },
  resources: {
    health: 'GET /api/v1/enterprise/health',
    catalog: 'POST /api/v1/enterprise/catalog/push',
    stock: 'PUT /api/v1/enterprise/products/{sku}/stock',
    price: 'PUT /api/v1/enterprise/products/{sku}/price',
    orders: 'POST /api/v1/enterprise/orders',
    invoice: 'POST /api/v1/enterprise/orders/{orderId}/invoice',
    tracking: 'POST /api/v1/enterprise/orders/{orderId}/tracking',
    webhooks: 'POST /api/v1/enterprise/webhooks/test'
  }
};

app.get('/api/enterprise/developer/manifest', (_req, res) => {
  return res.json(ARIANA_ENTERPRISE_DEVELOPER_MANIFEST);
});

app.get('/api/v1/enterprise/developer/manifest', enterpriseVersionHeaders('v1'), (_req, res) => {
  return res.json({ ...ARIANA_ENTERPRISE_DEVELOPER_MANIFEST, requestedVersion: 'v1' });
});

app.get('/api/v2/enterprise/developer/manifest', enterpriseVersionHeaders('v2', true), (_req, res) => {
  return res.json({ ...ARIANA_ENTERPRISE_DEVELOPER_MANIFEST, requestedVersion: 'v2', warning: 'v2 ainda está em preview.' });
});

}
