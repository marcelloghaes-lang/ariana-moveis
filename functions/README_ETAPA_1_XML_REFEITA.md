# Ariana Enterprise API — Etapa 1 XML refeita

Data: 27/06/2026

Esta versão foi refeita com base nos arquivos atuais enviados, preservando o padrão já existente:

- `routes/manufacturerIntegrationRoutes.js`
- `services/manufacturerService.js`
- `utils/http.js`
- `models/Product.js`

## O que foi alterado

### 1. `routes/manufacturerIntegrationRoutes.js`

Foram adicionadas apenas novas rotas Enterprise de XML, logo depois da rota já existente:

```js
POST /orders/:orderId/invoice
```

Novas rotas:

```http
POST /api/enterprise/orders/:orderId/xml/generate
POST /api/enterprise/orders/:orderId/xml/regenerate
GET  /api/enterprise/orders/:orderId/xml
GET  /api/enterprise/orders/:orderId/xml/download
```

Todas usam `partnerKeyRequired`, seguindo o mesmo padrão das rotas de pedido/status/rastreamento/NF-e.

### 2. `services/manufacturerService.js`

Foram adicionadas as funções:

```js
generateEnterpriseOrderXml()
getEnterpriseOrderXml()
```

E helpers internos para:

- localizar pedido por ObjectId, pedido externo, rastreio, número da nota ou chave;
- gerar XML seguro com escape de caracteres;
- calcular hash SHA-256;
- montar nome do arquivo;
- salvar XML dentro de `manufacturerDispatch.invoice`.

## O que NÃO foi alterado

- Nenhuma rota existente foi removida.
- Nenhuma rota existente teve URL trocada.
- Nenhum middleware existente foi alterado.
- O `server.js` não precisa ser alterado se ele já importa `manufacturerIntegrationRoutes.js`.
- O model `Product.js` foi incluído apenas como referência/arquivo existente, sem alteração.
- `utils/http.js` foi mantido sem alteração.

## Onde o XML fica salvo

No próprio pedido, dentro de:

```js
manufacturerDispatch.invoice.xmlContent
manufacturerDispatch.invoice.xmlHash
manufacturerDispatch.invoice.xmlFilename
manufacturerDispatch.invoice.xmlGeneratedAt
manufacturerDispatch.invoice.xmlGeneratedBy
manufacturerDispatch.invoice.xmlStatus
```

Isso evita criar model novo agora e reduz o risco de quebrar o sistema.

## Teste rápido no Postman

### Gerar XML

```http
POST https://ariana-backend.onrender.com/api/enterprise/orders/{{orderId}}/xml/generate
Authorization: Bearer {{TOKEN_OU_API_KEY}}
x-ariana-key: {{API_KEY_SANDBOX}}
Content-Type: application/json
```

Body:

```json
{
  "manufacturer": "ariana_demo",
  "environment": "sandbox"
}
```

### Consultar XML

```http
GET https://ariana-backend.onrender.com/api/enterprise/orders/{{orderId}}/xml
x-ariana-key: {{API_KEY_SANDBOX}}
```

### Baixar XML

```http
GET https://ariana-backend.onrender.com/api/enterprise/orders/{{orderId}}/xml/download
x-ariana-key: {{API_KEY_SANDBOX}}
```

### Regerar XML

```http
POST https://ariana-backend.onrender.com/api/enterprise/orders/{{orderId}}/xml/regenerate
x-ariana-key: {{API_KEY_SANDBOX}}
Content-Type: application/json
```

Body:

```json
{
  "manufacturer": "ariana_demo",
  "environment": "sandbox",
  "force": true
}
```

## Validação feita

Foi executada validação de sintaxe com:

```bash
node --check routes/manufacturerIntegrationRoutes.js
node --check services/manufacturerService.js
```

Resultado: sem erro de sintaxe.
