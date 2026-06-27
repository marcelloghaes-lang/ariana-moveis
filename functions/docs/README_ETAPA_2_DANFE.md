# Ariana Enterprise API — Etapa 2 DANFE

Esta etapa mantém o mesmo padrão aprovado na Etapa 1 XML.

## Arquivos alterados

Substituir somente:

```txt
functions/routes/manufacturerIntegrationRoutes.js
functions/services/manufacturerService.js
```

Não altera `server.js`.
Não cria `enterpriseXmlRoutes.js`.
Não cria novas pastas obrigatórias.

## Endpoints adicionados

### Gerar DANFE

```http
POST /api/enterprise/orders/:orderId/danfe/generate
```

### Consultar DANFE

```http
GET /api/enterprise/orders/:orderId/danfe
```

### Baixar DANFE PDF

```http
GET /api/enterprise/orders/:orderId/danfe/download
```

### Regerar DANFE

```http
POST /api/enterprise/orders/:orderId/danfe/regenerate
```

## Headers

Usar os mesmos headers da Etapa 1:

```txt
Content-Type: application/json
Authorization: Bearer SEU_TOKEN_OAUTH
x-ariana-key: SUA_API_KEY_SANDBOX
```

## Body de teste

```json
{
  "invoice": {
    "number": "1001",
    "serie": "1",
    "key": "31260600000000000000550010000000011000000010",
    "issuedAt": "2026-06-27T12:00:00.000Z",
    "total": 2379
  }
}
```

## Resultado esperado

- `POST /danfe/generate`: HTTP 201 com `ok: true` e objeto `danfe`.
- `GET /danfe`: HTTP 200 com metadados do DANFE.
- `GET /danfe/download`: HTTP 200 retornando `application/pdf`.

## Observação

O PDF gerado é um DANFE sandbox simples para homologação da API Enterprise, criado sem dependências externas para evitar quebrar o deploy no Render.
