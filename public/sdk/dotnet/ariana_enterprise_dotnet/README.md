# Ariana Enterprise .NET SDK

SDK oficial em C#/.NET para integrar fabricantes, distribuidores e ERPs com a Ariana Enterprise.

## Instalação

```bash
dotnet add reference ./ariana_enterprise_dotnet/ArianaEnterprise.Sdk.csproj
```

O SDK ainda não está publicado no NuGet. Baixe e extraia o pacote oficial e adicione a referência local acima.

## Uso rápido

```csharp
using ArianaEnterprise;

var ariana = new ArianaEnterpriseClient(new ArianaEnterpriseOptions
{
    ApiKey = "ari_sbx_xxxxx",
    Environment = "sandbox"
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
