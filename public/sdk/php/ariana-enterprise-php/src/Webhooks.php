<?php
namespace ArianaEnterprise;
class Webhooks { public function __construct(private Client $client) {} public function test(string $event = 'order_ack', array $data = []): array { return $this->client->request('POST','/webhooks/test',['event'=>$event,'data'=>$data]); } }
