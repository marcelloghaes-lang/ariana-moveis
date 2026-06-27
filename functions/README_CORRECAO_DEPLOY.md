# Correção do deploy - remover enterpriseXmlRoutes

O erro do Render ocorreu porque o `server.js` ainda tinha:

```js
import enterpriseXmlRoutesFactory from './routes/enterpriseXmlRoutes.js';
```

e também o bloco:

```js
app.use('/api/enterprise', enterpriseXmlRoutesFactory(...));
```

Esse arquivo `enterpriseXmlRoutes.js` não existe mais porque a etapa XML foi corrigida para usar os arquivos existentes:
- `functions/routes/manufacturerIntegrationRoutes.js`
- `functions/services/manufacturerService.js`

## O que fazer

Substitua apenas:

```txt
functions/server.js
```

por este `server.js` corrigido.

Depois rode:

```powershell
git add functions/server.js
git commit -m "remove import antigo enterpriseXmlRoutes"
git push
```

