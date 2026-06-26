package br.com.arianamoveis.enterprise;
import java.util.*;
public class Webhooks {
  private final ArianaEnterpriseClient client;
  Webhooks(ArianaEnterpriseClient client){ this.client = client; }
  public Map<String,Object> test(String event, String message) throws Exception {
    return client.request("POST", "/webhooks/test", Json.of(Map.of("event",event,"message",message)));
  }
}
