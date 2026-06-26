<?php
namespace ArianaEnterprise;
class Tracking { public function __construct(private Client $client) {} public function update(string $orderId, array $tracking): array { return $this->client->request('POST',"/orders/$orderId/tracking",$tracking); } }
