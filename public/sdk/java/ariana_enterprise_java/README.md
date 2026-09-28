# Ariana Enterprise Java SDK

SDK oficial Java para integração com a Ariana Enterprise.

Compatível com Java 17+, Maven, Gradle, Spring Boot, Jakarta EE e Java puro.

## Instalação Maven

O SDK ainda não está publicado no Maven Central. Depois de baixar e extrair o pacote oficial, instale-o no repositório Maven local:

```bash
mvn -f ./ariana_enterprise_java/pom.xml install
```

Depois disso, use normalmente a dependência no seu projeto:

```xml
<dependency>
  <groupId>br.com.arianamoveis</groupId>
  <artifactId>ariana-enterprise-java</artifactId>
  <version>1.0.0</version>
</dependency>
```

## Uso rápido

```java
import br.com.arianamoveis.enterprise.ArianaEnterpriseClient;
import java.util.List;
import java.util.Map;

ArianaEnterpriseClient ariana = ArianaEnterpriseClient.builder()
    .apiKey("ari_sbx_xxxxx")
    .environment("sandbox")
    .build();

ariana.catalog().push(List.of(
    Map.of("sku", "ARI-0001", "name", "Produto Teste", "price", 2299, "stock", 10)
));
```

## Recursos

- API Key
- OAuth 2.0 Client Credentials
- Bearer Token
- Retry
- Timeout
- Versionamento v1/v2
- Catálogo
- Estoque
- Preço
- Pedido
- NF-e
- Rastreio
- Webhooks
