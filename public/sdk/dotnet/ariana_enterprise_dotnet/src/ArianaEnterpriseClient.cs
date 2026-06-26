using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace ArianaEnterprise;

public sealed class ArianaEnterpriseOptions
{
    public string ApiKey { get; set; } = "";
    public string Environment { get; set; } = "sandbox";
    public string BaseUrl { get; set; } = "https://ariana-backend.onrender.com/api/v1/enterprise";
    public TimeSpan Timeout { get; set; } = TimeSpan.FromSeconds(30);
}

public sealed class ArianaProduct
{
    public string Sku { get; set; } = "";
    public string Name { get; set; } = "";
    public decimal Price { get; set; }
    public int Stock { get; set; }
}

public sealed class ArianaEnterpriseClient
{
    private readonly HttpClient _http;
    private readonly ArianaEnterpriseOptions _options;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public CatalogClient Catalog { get; }
    public ProductsClient Products { get; }
    public OrdersClient Orders { get; }

    public ArianaEnterpriseClient(ArianaEnterpriseOptions options, HttpClient? httpClient = null)
    {
        _options = options;
        _http = httpClient ?? new HttpClient();
        _http.Timeout = options.Timeout;
        _http.DefaultRequestHeaders.Add("x-ariana-key", options.ApiKey);
        Catalog = new CatalogClient(this);
        Products = new ProductsClient(this);
        Orders = new OrdersClient(this);
    }

    public Task<JsonDocument> HealthAsync() => SendAsync(HttpMethod.Get, "/health");

    internal async Task<JsonDocument> SendAsync(HttpMethod method, string path, object? body = null)
    {
        var request = new HttpRequestMessage(method, _options.BaseUrl.TrimEnd('/') + path);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        if (body is not null)
        {
            request.Content = new StringContent(JsonSerializer.Serialize(body, JsonOptions), Encoding.UTF8, "application/json");
        }

        var response = await _http.SendAsync(request);
        var text = await response.Content.ReadAsStringAsync();
        if (!response.IsSuccessStatusCode)
        {
            throw new ArianaEnterpriseException((int)response.StatusCode, text);
        }
        return JsonDocument.Parse(string.IsNullOrWhiteSpace(text) ? "{}" : text);
    }
}

public sealed class CatalogClient
{
    private readonly ArianaEnterpriseClient _client;
    internal CatalogClient(ArianaEnterpriseClient client) => _client = client;
    public Task<JsonDocument> PushAsync(IEnumerable<ArianaProduct> products, string manufacturer = "ariana_moveis") =>
        _client.SendAsync(HttpMethod.Post, "/catalog/push", new { manufacturer, products });
}

public sealed class ProductsClient
{
    private readonly ArianaEnterpriseClient _client;
    internal ProductsClient(ArianaEnterpriseClient client) => _client = client;
    public Task<JsonDocument> UpdateStockAsync(string sku, int stock) =>
        _client.SendAsync(HttpMethod.Put, $"/products/{sku}/stock", new { stock });
    public Task<JsonDocument> UpdatePriceAsync(string sku, decimal price) =>
        _client.SendAsync(HttpMethod.Put, $"/products/{sku}/price", new { price });
}

public sealed class OrdersClient
{
    private readonly ArianaEnterpriseClient _client;
    internal OrdersClient(ArianaEnterpriseClient client) => _client = client;
    public Task<JsonDocument> CreateAsync(object order) => _client.SendAsync(HttpMethod.Post, "/orders", order);
}

public sealed class ArianaEnterpriseException : Exception
{
    public int StatusCode { get; }
    public string ResponseBody { get; }
    public ArianaEnterpriseException(int statusCode, string responseBody) : base($"Ariana Enterprise HTTP {statusCode}")
    {
        StatusCode = statusCode;
        ResponseBody = responseBody;
    }
}
