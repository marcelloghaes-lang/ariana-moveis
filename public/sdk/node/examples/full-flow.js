const { ArianaEnterpriseClient } = require('../ariana-enterprise-sdk');

const api = new ArianaEnterpriseClient({ apiKey: process.env.ARIANA_API_KEY, environment: 'sandbox' });

async function main() {
  const sku = `ARI-SDK-${Date.now()}`;
  const orderId = `ARI-PED-SDK-${Date.now()}`;
  console.log(await api.health());
  console.log(await api.catalog.push([{ sku, name: 'Produto SDK Teste', price: 2299, stock: 10 }]));
  console.log(await api.products.updateStock(sku, { stock: 8 }));
  console.log(await api.products.updatePrice(sku, { price: 2199 }));
  console.log(await api.orders.create({ externalOrderId: orderId, customerName: 'Cliente SDK', customerEmail: 'cliente@teste.com', customerPhone: '31999999999', items: [{ sku, name: 'Produto SDK Teste', qty: 1, unitPrice: 2199, sellerId: 'ariana_moveis' }] }));
  console.log(await api.orders.invoice(orderId, { manufacturer: 'ariana_moveis', invoice: { number: '12345', series: '1', accessKey: '31260600000000000000550010000123451000012345', danfeUrl: 'https://teste.com/danfe.pdf', xmlUrl: 'https://teste.com/nfe.xml', total: 2199 } }));
  console.log(await api.orders.tracking(orderId, { manufacturer: 'ariana_moveis', trackingCode: 'TESTE123456789BR', carrier: 'Transportadora Ariana', trackingUrl: 'https://rastreamento.teste.com/TESTE123456789BR' }));
}
main().catch(err => { console.error(err); process.exit(1); });
