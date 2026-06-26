package br.com.arianamoveis.enterprise;

import java.io.IOException;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.*;

public class ArianaEnterpriseClient {
    private final String apiKey;
    private final String bearerToken;
    private final String baseUrl;
    private final HttpClient http;

    private ArianaEnterpriseClient(Builder builder) {
        this.apiKey = builder.apiKey;
        this.bearerToken = builder.bearerToken;
        String env = builder.environment == null ? "sandbox" : builder.environment;
        this.baseUrl = builder.baseUrl != null ? builder.baseUrl :
            ("production".equalsIgnoreCase(env) ? "https://ariana-backend.onrender.com/api/v1/enterprise" : "https://ariana-backend.onrender.com/api/v1/enterprise");
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofMillis(builder.timeoutMs)).build();
    }

    public static Builder builder() { return new Builder(); }

    public Map<String, Object> health() throws IOException, InterruptedException {
        return request("GET", "/health", null);
    }

    public Catalog catalog() { return new Catalog(this); }
    public Products products() { return new Products(this); }
    public Orders orders() { return new Orders(this); }
    public Invoice invoice() { return new Invoice(this); }
    public Tracking tracking() { return new Tracking(this); }
    public Webhooks webhooks() { return new Webhooks(this); }

    Map<String, Object> request(String method, String path, String jsonBody) throws IOException, InterruptedException {
        HttpRequest.Builder req = HttpRequest.newBuilder()
            .uri(URI.create(baseUrl + path))
            .timeout(Duration.ofSeconds(30))
            .header("Content-Type", "application/json")
            .header("Accept", "application/json");

        if (bearerToken != null && !bearerToken.isBlank()) req.header("Authorization", "Bearer " + bearerToken);
        else if (apiKey != null && !apiKey.isBlank()) req.header("x-ariana-key", apiKey);

        if ("GET".equalsIgnoreCase(method)) req.GET();
        else req.method(method, HttpRequest.BodyPublishers.ofString(jsonBody == null ? "{}" : jsonBody));

        HttpResponse<String> response = http.send(req.build(), HttpResponse.BodyHandlers.ofString());
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("status", response.statusCode());
        result.put("body", response.body());
        result.put("ok", response.statusCode() >= 200 && response.statusCode() < 300);
        if (response.statusCode() == 429) result.put("retryAfter", response.headers().firstValue("Retry-After").orElse(""));
        return result;
    }

    public static class Builder {
        private String apiKey;
        private String bearerToken;
        private String environment = "sandbox";
        private String baseUrl;
        private int timeoutMs = 30000;

        public Builder apiKey(String apiKey) { this.apiKey = apiKey; return this; }
        public Builder bearerToken(String bearerToken) { this.bearerToken = bearerToken; return this; }
        public Builder environment(String environment) { this.environment = environment; return this; }
        public Builder baseUrl(String baseUrl) { this.baseUrl = baseUrl; return this; }
        public Builder timeoutMs(int timeoutMs) { this.timeoutMs = timeoutMs; return this; }
        public ArianaEnterpriseClient build() { return new ArianaEnterpriseClient(this); }
    }
}
