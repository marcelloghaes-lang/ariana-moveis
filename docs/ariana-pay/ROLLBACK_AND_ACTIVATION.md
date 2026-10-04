# Ariana Pay — ativação segura e rollback

Este documento define como ativar a Ariana Pay sem afetar checkout, ERP, Gustavo ou pagamentos existentes.

## Estado padrão seguro

Todas as funcionalidades novas permanecem fail-closed:

- `ARIANA_PAY_ENABLED=false`
- `ARIANA_PAY_SHADOW_ENABLED=false`
- `ARIANA_PAY_CHECKOUT_ENABLED=false`
- `ARIANA_PAY_PAYOUT_ENABLED=false`
- `MP_3DS_SANDBOX_ENABLED=false`
- `ARIANA_PAY_RECON_SANDBOX_ENABLED=false`
- `MP_WEBHOOK_SIGNATURE_ENFORCE=false`

Sem ativação explícita, nenhuma movimentação financeira nova é executada.

## Proteções dos adapters sandbox

- `MP_3DS_SANDBOX_ACCESS_TOKEN` e `MP_RECON_SANDBOX_ACCESS_TOKEN` são credenciais dedicadas; não existe fallback para `MP_ACCESS_TOKEN`.
- Se uma credencial sandbox repetir explicitamente `MP_ACCESS_TOKEN`, o adapter recusa a configuração.
- A API base precisa usar o host oficial HTTPS `api.mercadopago.com`.
- O callback 3DS precisa usar HTTPS.
- Resposta ou pagamento que informe `live_mode=true` é rejeitado pelo caminho sandbox.
- Nenhum token de cartão é devolvido pelas rotas administrativas da Ariana Pay.
- As rotas 3DS são administrativas e não substituem `/api/payments/mp/card` ou `/api/payments/mp/credit`.

## Ordem de ativação

1. Merge da branch somente após revisão e CI verde.
2. Manter `ARIANA_PAY_ENABLED=false`.
3. Manter `ARIANA_PAY_CHECKOUT_ENABLED=false`.
4. Manter `ARIANA_PAY_PAYOUT_ENABLED=false`.
5. Ativar apenas `ARIANA_PAY_SHADOW_ENABLED=true` em ambiente controlado.
6. Executar auditoria admin em amostra pequena.
7. Conferir ledger x extrato atual.
8. Conferir conciliação armazenada.
9. Ativar sandbox 3DS somente com credencial dedicada de teste.
10. Ativar sandbox de conciliação somente com credencial dedicada de teste.
11. Validar webhook assinado em ambiente controlado.
12. Só discutir payout real em fase posterior.

## Rollback imediato

Se qualquer comportamento inesperado ocorrer:

1. definir `ARIANA_PAY_SHADOW_ENABLED=false`;
2. definir `MP_3DS_SANDBOX_ENABLED=false`;
3. definir `ARIANA_PAY_RECON_SANDBOX_ENABLED=false`;
4. definir `MP_WEBHOOK_SIGNATURE_ENFORCE=false` se a falha estiver na validação do webhook;
5. manter `ARIANA_PAY_ENABLED=false`;
6. manter `ARIANA_PAY_CHECKOUT_ENABLED=false`;
7. manter `ARIANA_PAY_PAYOUT_ENABLED=false`;
8. se necessário, reverter o commit/merge da Ariana Pay;
9. não alterar pedidos, settlements históricos ou extrato para “corrigir” dados shadow.

Como a Fase 1 não executa payout real, desligar as flags interrompe a nova camada sem exigir reversão financeira.

## Webhook Mercado Pago

Não ativar `MP_WEBHOOK_SIGNATURE_ENFORCE=true` antes de:

- confirmar `MP_WEBHOOK_SECRET`;
- validar assinatura com evento de teste;
- confirmar que `x-signature`, `x-request-id` e `data.id` chegam corretamente.

Se houver rejeição inesperada de webhooks após ativação:

1. voltar `MP_WEBHOOK_SIGNATURE_ENFORCE=false`;
2. investigar secret, headers e manifest;
3. não remover o verificador do código;
4. reativar enforcement somente após teste.

## 3DS

O fluxo atual de produção não deve ser substituído diretamente.

O adapter `mercadoPagoOrders3dsSandboxService.js` é isolado e exige credencial própria em `MP_3DS_SANDBOX_ACCESS_TOKEN`. O caminho correto é:

- sandbox;
- challenge;
- liability shift;
- webhook;
- reconciliação;
- revisão;
- rollout gradual.

## Payout

Fase 1 nunca realiza payout real.

Qualquer futura ativação deve exigir:

- idempotência;
- saldo disponível;
- seller aprovado;
- destino de recebimento válido;
- sem dívida;
- sem bloqueio de segurança;
- conciliação do provider;
- trilha de auditoria;
- feature flag por seller;
- limite financeiro inicial.

## Componentes fora do escopo

Rollback da Ariana Pay não deve alterar:

- Gustavo;
- ERP;
- Efí homologação;
- checkout atual;
- logística;
- cobranças;
- catálogo;
- DSlite.
