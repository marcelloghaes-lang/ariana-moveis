<?php
namespace ArianaEnterprise;
class Orders { public function __construct(private Client $client) {} public function create(array $order): array { return $this->client->request('POST','/orders',$order); } }
