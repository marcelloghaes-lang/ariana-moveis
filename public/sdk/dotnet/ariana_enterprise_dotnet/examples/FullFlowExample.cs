using ArianaEnterprise;

var ariana = new ArianaEnterpriseClient(new ArianaEnterpriseOptions
{
    ApiKey = Environment.GetEnvironmentVariable("ARIANA_API_KEY") ?? "ari_sbx_xxxxx",
    Environment = "sandbox"
});

await ariana.HealthAsync();
await ariana.Catalog.PushAsync(new []
{
    new ArianaProduct { Sku = "ARI-0001", Name = "Produto Teste", Price = 2299, Stock = 10 }
});
await ariana.Products.UpdateStockAsync("ARI-0001", 8);
await ariana.Products.UpdatePriceAsync("ARI-0001", 2199);

Console.WriteLine("Fluxo Ariana Enterprise .NET executado com sucesso.");
