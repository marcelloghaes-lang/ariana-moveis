package br.com.arianamoveis.enterprise;
import java.util.*;
public class Invoice {
  private final ArianaEnterpriseClient client;
  Invoice(ArianaEnterpriseClient client){ this.client = client; }
  public Map<String,Object> send(String orderId, Map<String,Object> invoice) throws Exception {
    return client.request("POST", "/orders/" + orderId + "/invoice", Json.of(invoice));
  }
}
