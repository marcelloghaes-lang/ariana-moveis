# Ariana Enterprise SDK

SDK oficial para integração com a API Ariana Enterprise.

## Uso

```js
const { ArianaEnterpriseClient } = require('./ariana-enterprise-sdk');

const api = new ArianaEnterpriseClient({
  apiKey: 'ari_live_xxxxx',
  environment: 'production',
  version: 'v1'
});

await api.catalog.push([{ sku: 'ARI-0001', name: 'Produto Teste', price: 2299, stock: 10 }]);
```
