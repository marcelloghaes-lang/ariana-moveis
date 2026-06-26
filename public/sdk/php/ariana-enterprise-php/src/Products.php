<?php
namespace ArianaEnterprise;
class Products { public function __construct(private Client $client) {} public function sync(string $sku, array $data): array { return $this->client->request('POST',"/products/$sku/sync",$data); } public function updateStock(string $sku, int $stock): array { return $this->client->request('PUT',"/products/$sku/stock",['stock'=>$stock]); } public function updatePrice(string $sku, float $price): array { return $this->client->request('PUT',"/products/$sku/price",['price'=>$price]); } }
