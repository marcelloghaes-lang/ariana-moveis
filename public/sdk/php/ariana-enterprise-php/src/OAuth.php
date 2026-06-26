<?php
namespace ArianaEnterprise;
class OAuth { public function __construct(private Client $client) {} public function token(): string { return $this->client->authenticate(); } }
