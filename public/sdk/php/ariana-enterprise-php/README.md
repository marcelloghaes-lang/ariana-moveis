# Ariana Enterprise SDK PHP

SDK PHP oficial para integrar ERPs, fabricantes e distribuidores com a Ariana Enterprise API.

## Instalação

```bash
composer require ariana/enterprise-sdk
```

Enquanto o pacote não estiver publicado no Packagist, use este diretório local no Composer do seu projeto.

## Uso rápido

```php
<?php
require 'vendor/autoload.php';

use ArianaEnterprise\Client;

$api = new Client([
    'apiKey' => 'ari_live_xxxxx',
    'environment' => 'production'
]);

$api->catalog()->push([
    ['sku' => 'ARI-0001', 'name' => 'Produto Teste', 'price' => 2299, 'stock' => 10]
]);

$api->products()->updateStock('ARI-0001', 8);
$api->products()->updatePrice('ARI-0001', 2199);
```

## OAuth 2.0

```php
$api = new Client([
    'clientId' => 'ari_client_xxxxx',
    'clientSecret' => 'ari_secret_xxxxx'
]);

$token = $api->authenticate();
```

## Recursos

- API Key e Bearer Token
- OAuth 2.0 Client Credentials
- Retry automático
- Timeout configurável
- Tratamento de erros
- Catálogo, estoque, preço, pedidos, NF-e, rastreio e webhooks
