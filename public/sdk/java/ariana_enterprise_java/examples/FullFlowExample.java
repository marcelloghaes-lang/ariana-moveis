import br.com.arianamoveis.enterprise.ArianaEnterpriseClient;
import java.util.List;
import java.util.Map;

public class FullFlowExample {
    public static void main(String[] args) throws Exception {
        ArianaEnterpriseClient ariana = ArianaEnterpriseClient.builder()
            .apiKey("ari_sbx_xxxxx")
            .environment("sandbox")
            .build();

        System.out.println(ariana.health());

        ariana.catalog().push(List.of(
            Map.of("sku", "ARI-0001", "name", "Produto Teste", "price", 2299, "stock", 10)
        ));

        ariana.products().updateStock("ARI-0001", 8);
        ariana.products().updatePrice("ARI-0001", 2199);
    }
}
