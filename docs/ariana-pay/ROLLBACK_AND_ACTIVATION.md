# Ariana Pay — ativação segura e rollback

Este documento define como ativar a Ariana Pay sem afetar checkout, ERP, Gustavo ou pagamentos existentes.

## Estado padrão seguro

Todas as funcionalidades novas permanecem fail-closed:

- `ARIANA_PAY_ENABLED=false`
- `ARIANA_PAY_SHADOW_ENABLED=false`
- `MP_3DS_SANDBOX_ENABLED=false`
- `ARIANA_PAY_RECON_SANDBOX_ENABLED=false`
- `MP_WEBHOOK_SIGNATURE_ENFORCE=false`

Sem essas flags, nenhuma movimentação financeira nova é executada.

## Ordem de ativação

1. Merge da branch somente após revisão e CI verde.
2. Manter `ARIANA_PAY_ENABLED=false`.
3. Ativar apenas `ARIANA_PAY_SHADOW_ENABLED=true`.
4. Executar auditoria admin em amostra pequena.
5. Conferir ledger x extrato atual.
6. Conferir conciliação armazenada.
7. Ativar sandbox 3DS somente com credencial própria de teste.
8. Ativar sandbox de conciliação somente com credencial própria de teste.
9. Validar webhook assinado em ambiente controlado.
10. Só discutir payout real em fase posterior.

## Rollback imediato

Se qualquer comportamento inesperado ocorrer:

1. definir `ARIANA_PAY_SHADOW_ENABLED=false`;
2. definir `MP_3DS_SANDBOX_ENABLED=false`;
3. definir `ARIANA_PAY_RECON_SANDBOX_ENABLED=false`;
4. manter `ARIANA_PAY_ENABLED=false`;
5. se necessário, reverter o commit/merge da Ariana Pay;
6. não alterar pedidos, settlements históricos ou extrato para “corrigir” dados shadow.

Como a Fase 1 não grava ledger real nem executa payout, desligar as flags interrompe a nova camada sem exigir reversão financeira.

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

O adapter `mercadoPagoOrders3dsSandboxService.js` é isolado e exige credencial sandbox própria. O caminho correto é:
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
