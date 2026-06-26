<?php
namespace ArianaEnterprise;
class Invoice { public function __construct(private Client $client) {} public function attach(string $orderId, array $invoice): array { return $this->client->request('POST',"/orders/$orderId/invoice",['invoice'=>$invoice]); } }
