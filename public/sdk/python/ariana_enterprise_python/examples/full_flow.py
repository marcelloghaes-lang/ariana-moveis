from ariana_enterprise import ArianaEnterpriseClient

api = ArianaEnterpriseClient(api_key="ari_sbx_xxxxx", environment="sandbox")

sku = "ARI-PY-0001"

print(api.health())
print(api.catalog.push([{"sku": sku, "name": "Produto Python", "price": 2299, "stock": 10}]))
print(api.products.update_stock(sku, 8))
print(api.products.update_price(sku, 2199))

order = api.orders.create({
    "manufacturer": "ariana_moveis",
    "externalOrderId": "PED-PY-0001",
    "customerName": "Cliente Python",
    "customerEmail": "cliente@teste.com",
    "customerPhone": "31999999999",
    "items": [{"sku": sku, "qty": 1, "unitPrice": 2199}]
})
print(order)

order_id = order.get("externalOrderId", "PED-PY-0001")
print(api.invoice.send(order_id, {"manufacturer": "ariana_moveis", "invoice": {"number": "12345", "series": "1", "danfeUrl": "https://teste.com/danfe.pdf", "xmlUrl": "https://teste.com/nfe.xml"}}))
print(api.tracking.update(order_id, {"manufacturer": "ariana_moveis", "trackingCode": "TESTE123BR", "carrier": "Transportadora Teste", "trackingUrl": "https://rastreamento.teste/TESTE123BR"}))
print(api.webhooks.test())
