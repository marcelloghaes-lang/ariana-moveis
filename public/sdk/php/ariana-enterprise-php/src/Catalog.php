<?php
namespace ArianaEnterprise;
class Catalog { public function __construct(private Client $client) {} public function push(array $products, string $manufacturer = 'ariana_moveis'): array { return $this->client->request('POST','/catalog/push',['manufacturer'=>$manufacturer,'products'=>$products]); } }
