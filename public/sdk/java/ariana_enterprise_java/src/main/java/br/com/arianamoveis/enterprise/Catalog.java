package br.com.arianamoveis.enterprise;
import java.util.*;
public class Catalog {
  private final ArianaEnterpriseClient client;
  Catalog(ArianaEnterpriseClient client){ this.client = client; }
  public Map<String,Object> push(List<Map<String,Object>> products) throws Exception {
    return client.request("POST", "/catalog/push", Json.of(Map.of("manufacturer","ariana_moveis","products",products)));
  }
}
