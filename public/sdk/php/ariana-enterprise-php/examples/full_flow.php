<?php
require __DIR__ . '/../vendor/autoload.php';

use ArianaEnterprise\Client;

$api = new Client(['apiKey' => getenv('ARIANA_API_KEY') ?: 'ari_sbx_xxxxx']);
$sku = 'ARI-PHP-' . date('YmdHis');
$orderId = 'PED-PHP-' . date('YmdHis');

$api->health();
$api->catalog()->push([['sku' => $sku, 'name' => 'Produto PHP', 'price' => 2299, 'stock' => 10]]);
$api->products()->updateStock($sku, 8);
$api->products()->updatePrice($sku, 2199);
$api->orders()->create([
    'manufacturer' => 'ariana_moveis',
    'externalOrderId' => $orderId,
    'customerName' => 'Cliente Teste PHP',
    'items' => [['sku' => $sku, 'qty' => 1, 'unitPrice' => 2199]]
]);
$api->invoice()->attach($orderId, ['number'=>'12345','series'=>'1','danfeUrl'=>'https://teste.com/danfe.pdf','xmlUrl'=>'https://teste.com/nfe.xml','total'=>2199]);
$api->tracking()->update($orderId, ['trackingCode'=>'TESTEPHP123','carrier'=>'Transportadora Ariana','trackingUrl'=>'https://rastreamento.teste/TESTEPHP123']);
$api->webhooks()->test('order_ack', ['externalOrderId' => $orderId]);

echo "Fluxo PHP concluído\n";
