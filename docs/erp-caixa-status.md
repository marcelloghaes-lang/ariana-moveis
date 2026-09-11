# Ariana ERP Lite — Caixa/PDV

## Escopo implementado

- Caixa separado por operador.
- Abertura com saldo inicial.
- Reforço e sangria.
- Registro automático da venda faturada quando houver caixa aberto.
- Opção `requireCash=true` para exigir caixa aberto no faturamento do PDV.
- Estorno sincronizado com reversão idempotente no caixa.
- Fechamento com valor esperado, valor declarado e diferença.
- Histórico de sessões e movimentações.
- Tela responsiva `public/erp_caixa.html`.

## Regras de segurança operacional

- Uma venda não é registrada duas vezes no mesmo caixa.
- Um estorno não cria duas reversões.
- Venda faturada deve ser estornada pelo fluxo do ERP; cancelamento direto não é permitido.
- Se o estorno atingir uma sessão já fechada, o valor esperado e a diferença são recalculados para preservar o histórico.
- O Caixa não altera checkout, pedidos do cliente ou gateways de pagamento do site.
