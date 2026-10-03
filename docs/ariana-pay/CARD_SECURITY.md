# Ariana Pay — Card Security / Chargeback Defense

Status: **shadow / preparação de segurança**  
Produção: **desligada**

## Objetivo

Reduzir fraude e exposição a chargeback antes de qualquer payout real.

## Princípios

1. Pagamento aprovado não significa automaticamente pedido seguro.
2. Cartão sem evidência suficiente de autenticação permanece em revisão.
3. Alerta de fraude do provedor bloqueia despacho e payout.
4. Devolução/contestação em análise mantém o recebível bloqueado.
5. Refund/cancelamento/chargeback confirmado reverte o recebível.
6. Se o seller já recebeu, a reversão vira dívida do seller e bloqueia novos payouts.
7. O prazo fixo de 15 dias após a entrega continua existindo, mas não substitui antifraude.
8. Nenhum PAN/CVV/token de cartão entra no ledger ou pacote de evidências.

## Mercado Pago

A integração atual da Ariana usa `POST /v1/payments`.

A documentação atual do Mercado Pago descreve 3DS 2.0 com `liability_shift: required` no Checkout Transparente pela API Orders (`/v1/orders`). Portanto, a Ariana **não deve simplesmente adicionar campos de 3DS ao fluxo legado**.

Plano seguro:
- manter checkout atual intocado;
- construir fluxo Orders+3DS em sandbox separado;
- usar `validation: on_fraud_risk`;
- exigir `liability_shift: required`;
- tratar `action_required/pending_challenge`;
- validar webhook secreto;
- habilitar eventos de Contestações e Alertas de fraude;
- somente depois comparar aprovação/conversão e considerar migração gradual.

## Alertas de fraude

O Mercado Pago documenta alertas de fraude/stop delivery e orienta cancelar o pedido sem entregá-lo. A futura integração deve:
- verificar autenticidade do webhook;
- marcar o pedido como segurança bloqueada;
- impedir despacho;
- impedir payout;
- registrar evidência e auditoria.

## Evidências

A Ariana Pay já prepara um pacote sanitizado com:
- identificação do pedido;
- pagamento/provedor/reference;
- itens;
- cliente com documento mascarado;
- endereço de entrega;
- rastreio e prova de entrega;
- documentos fiscais disponíveis;
- status 3DS quando existir.

Nunca incluir:
- PAN;
- CVV;
- token de cartão;
- access tokens;
- secrets;
- documento completo do cliente no pacote padrão.

## Dispatch guard

O motor produz uma decisão shadow:
- `allowDispatch=true`: sem bloqueio automático encontrado;
- `requiresManualReview=true`: precisa revisão;
- `allowDispatch=false`: fraude/risco alto.

Nesta fase isso **não altera o fluxo real de despacho**. Primeiro será auditado em pedidos históricos.

## Critérios antes de ativar em produção

- testes automáticos 100% verdes;
- sandbox 3DS validado;
- assinatura de webhook validada;
- simulador de alerta de fraude validado;
- teste de chargeback/disputa;
- painel de revisão manual;
- trilha de auditoria;
- procedimento operacional para suporte;
- autorização explícita do Marcelo.
