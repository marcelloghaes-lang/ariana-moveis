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


## Responsabilidade financeira da contestação

Ariana Pay não transforma toda contestação em dívida do seller.

Classificação inicial:

- **Compra não reconhecida / fraude + 3DS autenticado com liability shift:** responsabilidade classificada como `provider_network`; não debitar seller automaticamente.
- **Chargeback sem motivo suficiente:** `pending_review`; bloquear novo payout, mas não criar dívida do seller.
- **Produto não recebido / diferente / defeituoso:** revisar a operação e a responsabilidade de entrega antes de qualquer débito.
- **Cobrança duplicada / erro de processamento:** revisão Ariana/provedor; nunca jogar automaticamente no seller.
- **Responsabilidade expressamente confirmada como seller:** somente então o shadow ledger pode criar `chargeback_debit` no saldo dele.

A documentação atual do Mercado Pago informa que uma contestação normalmente pode retirar fundos do vendedor, mas no fluxo 3DS da API Orders com `liability_shift: required` a responsabilidade financeira da contestação é da bandeira do cartão. Por isso a classificação precisa olhar a causa e a proteção aplicada na transação.


## Sandbox 3DS isolado

Foi preparado um adapter separado para a API Orders do Mercado Pago:
`functions/services/arianaPay/mercadoPagoOrders3dsSandboxService.js`

Proteções:
- não usa `MP_ACCESS_TOKEN` como fallback;
- exige `MP_3DS_SANDBOX_ENABLED=true`;
- exige `MP_3DS_SANDBOX_ACCESS_TOKEN` próprio;
- usa `POST /v1/orders`;
- força `validation: on_fraud_risk`;
- força `liability_shift: required`;
- token do cartão é removido do objeto de auditoria/log;
- nenhuma rota de produção chama este adapter nesta fase.

Variáveis previstas:
- `MP_3DS_SANDBOX_ENABLED=false`
- `MP_3DS_SANDBOX_ACCESS_TOKEN`
- `MP_3DS_SANDBOX_BASE_URL=https://api.mercadopago.com`
- `MP_3DS_SANDBOX_NOTIFICATION_URL`

Não habilitar até existir credencial de teste separada e plano de teste com cartões de sandbox.
