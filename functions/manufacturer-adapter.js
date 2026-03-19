// Exemplo de como formatar os dados para cada fabricante
const ManufacturerAdapter = {
    
    // Traduz para o padrão Samsung/Motorola (exemplo via Allied)
    formatSamsung: (pedido) => {
        return {
            customer_cpf: pedido.cpf,
            product_code: pedido.sku_fabricante,
            delivery_address: pedido.endereco,
            external_id: pedido.id_firebase // Seu ID para rastreio
        };
    },

    // Traduz para o padrão Whirlpool
    formatWhirlpool: (pedido) => {
        return {
            orderData: {
                sku: pedido.sku_fabricante,
                quantity: 1,
                shipping: {
                    zip: pedido.cep_cliente,
                    number: pedido.numero_casa
                }
            }
        };
    }
};

// Função que dispara o pedido para o fabricante
async function enviarPedidoParaFabricante(pedido) {
    let dadosFormatados;
    
    // Escolhe o tradutor certo baseado no fornecedor
    switch(pedido.vendedor_id) {
        case 'samsung_oficial':
            dadosFormatados = ManufacturerAdapter.formatSamsung(pedido);
            break;
        case 'whirlpool_oficial':
            dadosFormatados = ManufacturerAdapter.formatWhirlpool(pedido);
            break;
    }

    // Faz o POST para a API do fabricante
    const response = await fetch(pedido.api_endpoint, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer TOKEN_DO_FABRICANTE' },
        body: JSON.stringify(dadosFormatados)
    });

    return response.json();
}