package br.com.arianamoveis.enterprise;
import java.util.*;
public class Products {
  private final ArianaEnterpriseClient client;
  Products(ArianaEnterpriseClient client){ this.client = client; }
  public Map<String,Object> updateStock(String sku, int stock) throws Exception {
    return client.request("PUT", "/products/" + sku + "/stock", Json.of(Map.of("stock",stock,"availability","available")));
  }
  public Map<String,Object> updatePrice(String sku, double price) throws Exception {
    return client.request("PUT", "/products/" + sku + "/price", Json.of(Map.of("price",price,"status","updated_by_erp")));
  }
}
