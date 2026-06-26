package br.com.arianamoveis.enterprise;
import java.util.*;
public class Orders {
  private final ArianaEnterpriseClient client;
  Orders(ArianaEnterpriseClient client){ this.client = client; }
  public Map<String,Object> create(Map<String,Object> order) throws Exception {
    return client.request("POST", "/orders", Json.of(order));
  }
}
