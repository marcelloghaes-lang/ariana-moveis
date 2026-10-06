# Ariana Enterprise .NET SDK

SDK oficial em C#/.NET para integrar fabricantes, distribuidores e ERPs com a Ariana Enterprise.

## Instalação

```bash
dotnet add package ArianaEnterprise.Sdk --version 1.0.0
```

## Uso rápido

```csharp
using ArianaEnterprise;

var ariana = new ArianaEnterpriseClient(new ArianaEnterpriseOptions
{
    ApiKey = "ari_live_xxxxx",
    Environment = "production"
});

await ariana.HealthAsync();
await ariana.Catalog.PushAsync(new []
{
    new ArianaProduct { Sku = "ARI-0001", Name = "Produto Teste", Price = 2299, Stock = 10 }
});
```

## Recursos

- API Key
- OAuth 2.0 Client Credentials
- Bearer Token
- Retry
- Timeout
- Catálogo
- Estoque
- Preço
- Pedido
- NF-e
- Rastreio
- Webhooks
- Versionamento v1/v2
