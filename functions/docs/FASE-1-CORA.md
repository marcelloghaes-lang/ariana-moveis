# Fase 1 — Integração Cora

## Entregue

- Configuração isolada para Stage e Produção.
- Autenticação OAuth2 Client Credentials usando mTLS.
- Cache seguro do token com renovação automática.
- Cliente HTTP base com nova tentativa após HTTP 401.
- Rota administrativa de diagnóstico.
- Nenhum token, Client ID completo, certificado ou chave privada é devolvido pela API.

## Arquivos novos

- `functions/integrations/cora/coraConfig.js`
- `functions/integrations/cora/coraAuth.js`
- `functions/integrations/cora/coraClient.js`
- `functions/routes/coraRoutes.js`
- `functions/.env.cora.example`

## Arquivo alterado

- `functions/server.js`

Alterações no `server.js`:

```js
import registerCoraRoutes from './routes/coraRoutes.js';
```

E antes do registro das rotas legadas:

```js
registerCoraRoutes(app, { adminRequired });
```

## Preparar credenciais na VPS

```bash
mkdir -p /root/cora-secrets/stage
chmod 700 /root/cora-secrets /root/cora-secrets/stage
```

Coloque os arquivos fornecidos pela Cora nos caminhos:

```text
/root/cora-secrets/stage/certificate.pem
/root/cora-secrets/stage/private-key.key
```

Proteja os arquivos:

```bash
chmod 600 /root/cora-secrets/stage/certificate.pem
chmod 600 /root/cora-secrets/stage/private-key.key
```

Adicione ao `.env` real do backend:

```env
CORA_ENABLED=true
CORA_ENV=stage
CORA_CLIENT_ID=SEU_CLIENT_ID_DE_TESTE
CORA_CERT_PATH=/root/cora-secrets/stage/certificate.pem
CORA_KEY_PATH=/root/cora-secrets/stage/private-key.key
CORA_AUTH_URL=https://matls-clients.api.stage.cora.com.br/token
CORA_API_BASE_URL=https://matls-clients.api.stage.cora.com.br
CORA_TIMEOUT_MS=60000
CORA_TOKEN_SAFETY_SECONDS=60
```

## Testar

Reinicie o backend e autentique-se como administrador. Depois:

```http
GET /api/admin/cora/status
Authorization: Bearer SEU_TOKEN_ADMIN
```

Resposta esperada:

```json
{
  "ok": true,
  "authenticated": true,
  "config": {
    "enabled": true,
    "environment": "stage",
    "clientIdConfigured": true,
    "certificateConfigured": true,
    "privateKeyConfigured": true
  }
}
```

## Segurança

- Nunca coloque certificado ou chave privada no frontend.
- Nunca envie esses arquivos ao GitHub.
- O CPF e a senha das contas de teste não autenticam a API; eles servem para simular pagamentos no ambiente Cora.
- A emissão de carnê será adicionada na Fase 2 após a autenticação desta fase ser validada.
