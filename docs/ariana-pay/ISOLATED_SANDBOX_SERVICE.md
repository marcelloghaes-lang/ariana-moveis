# Ariana Pay — serviço sandbox isolado

## Objetivo

Executar a homologação da Ariana Pay sem modificar ou acoplar código ao backend principal da Ariana Móveis.

Serviço Render separado:

- nome: `ariana-pay-shadow`
- branch: `feature/ariana-pay-phase1`
- URL: `https://ariana-pay-shadow.onrender.com`
- entrypoint: `functions/arianaPaySandboxServer.js`
- checkout principal: não utilizado
- payout real: inexistente
- ERP/Gustavo/Efí/outros módulos: não utilizados

## Estado seguro obrigatório

O serviço recusa inicialização se qualquer uma destas flags estiver ativa:

- `ARIANA_PAY_ENABLED=true`
- `ARIANA_PAY_CHECKOUT_ENABLED=true`
- `ARIANA_PAY_PAYOUT_ENABLED=true`

No ambiente isolado:

- `ARIANA_PAY_SHADOW_ENABLED=true`
- `ARIANA_PAY_ENABLED=false`
- `ARIANA_PAY_CHECKOUT_ENABLED=false`
- `ARIANA_PAY_PAYOUT_ENABLED=false`
- limite de teste: `ARIANA_PAY_SANDBOX_MAX_AMOUNT=100`
- janela máxima da assinatura webhook: 300 segundos

## Proteções já aplicadas

- token administrativo separado para as rotas de teste;
- resposta com `Cache-Control: no-store`;
- headers básicos de hardening;
- token de cartão nunca é devolvido;
- nenhuma resposta raw do provider é exposta pela rota 3DS;
- credenciais sandbox não usam fallback de `MP_ACCESS_TOKEN`;
- se a credencial dedicada repetir `MP_ACCESS_TOKEN`, a configuração é rejeitada;
- qualquer resposta Mercado Pago com `live_mode=true` é bloqueada;
- base URL limitada ao host oficial `https://api.mercadopago.com`;
- callback 3DS exige HTTPS;
- assinatura de webhook usa HMAC e pode exigir timestamp recente;
- nenhum endpoint do serviço executa payout ou altera o checkout existente.

## Variáveis já preparadas

Não-secretas:

- `MP_3DS_SANDBOX_BASE_URL=https://api.mercadopago.com`
- `MP_RECON_SANDBOX_BASE_URL=https://api.mercadopago.com`
- `MP_3DS_SANDBOX_NOTIFICATION_URL=https://ariana-pay-shadow.onrender.com/api/webhooks/ariana-pay/mercadopago-sandbox`
- `MP_WEBHOOK_SIGNATURE_TOLERANCE_SECONDS=300`

## Dependências externas ainda pendentes

Precisam vir do ambiente de testes do Mercado Pago e não devem ser colocadas no Git:

- `MP_3DS_SANDBOX_ACCESS_TOKEN`
- `MP_RECON_SANDBOX_ACCESS_TOKEN`
- `MP_WEBHOOK_SECRET`

Somente depois de credenciais válidas:

- ativar `MP_3DS_SANDBOX_ENABLED=true`;
- ativar `ARIANA_PAY_RECON_SANDBOX_ENABLED=true`;
- validar webhook e só então ativar `MP_WEBHOOK_SIGNATURE_ENFORCE=true`.

## Critério de homologação

A homologação externa só avança se:

1. CI Ariana Pay estiver verde;
2. serviço isolado estiver live;
3. nenhuma flag de dinheiro real estiver ativa;
4. 3DS sem challenge passar;
5. 3DS com challenge passar;
6. `liability_shift` for confirmado;
7. webhook assinado e recente passar;
8. conciliação sandbox retornar `live_mode=false`;
9. valores fecharem centavo a centavo;
10. nenhum fluxo protegido da Ariana Móveis for alterado.
