<?php
require __DIR__ . '/../vendor/autoload.php';

use ArianaEnterprise\Client;

$api = new Client([
    'apiKey' => getenv('ARIANA_API_KEY') ?: 'ari_sbx_xxxxx',
    'environment' => 'sandbox'
]);

$response = $api->catalog()->push([
    [
        'sku' => 'ARI-PHP-0001',
        'name' => 'Produto Teste PHP',
        'description' => 'Produto enviado pelo SDK PHP Ariana Enterprise',
        'category' => 'Teste',
        'brand' => 'Ariana',
        'price' => 2299,
        'stock' => 10,
        'weight' => 30,
        'height' => 100,
        'width' => 70,
        'length' => 70
    ]
]);

print_r($response);
