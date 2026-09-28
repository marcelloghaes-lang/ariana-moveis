# Ariana Enterprise Python SDK

SDK oficial em Python para integrar catálogo, estoque, preço, pedidos, NF-e, rastreio e webhooks com a Ariana Enterprise.

## Instalação

```bash
pip install ./ariana_enterprise_python
```

O SDK ainda não está publicado no PyPI. Baixe e extraia o pacote oficial antes de executar o comando acima.

## Uso rápido

```python
from ariana_enterprise import ArianaEnterpriseClient

api = ArianaEnterpriseClient(
    api_key="ari_sbx_xxxxx",
    environment="sandbox"
)

api.catalog.push([
    {"sku": "ARI-0001", "name": "Produto Teste", "price": 2299, "stock": 10}
])

api.products.update_stock("ARI-0001", 8)
api.products.update_price("ARI-0001", 2199)
```

## OAuth 2.0

```python
api = ArianaEnterpriseClient(
    client_id="ari_client_xxxxx",
    client_secret="ari_secret_xxxxx",
    environment="sandbox"
)

api.health()
```

## Recursos

- API Key
- OAuth 2.0 Client Credentials
- Retry simples
- Timeout configurável
- Tratamento de erro
- Versionamento v1/v2
- Catálogo, estoque, preço, pedido, NF-e, rastreio e webhooks
