package br.com.arianamoveis.enterprise;
import java.util.*;
public class Tracking {
  private final ArianaEnterpriseClient client;
  Tracking(ArianaEnterpriseClient client){ this.client = client; }
  public Map<String,Object> update(String orderId, Map<String,Object> tracking) throws Exception {
    return client.request("POST", "/orders/" + orderId + "/tracking", Json.of(tracking));
  }
}
