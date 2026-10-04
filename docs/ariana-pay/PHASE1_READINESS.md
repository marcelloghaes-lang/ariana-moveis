# Ariana Pay — Fase 1 Readiness

Status atual: **shadow mode / sem dinheiro real / sem deploy na main**

## Concluído em código

- Ledger shadow por seller e pedido.
- Separação marketplace puro x operação própria.
- Comissão apenas onde aplicável.
- Saldo derivado: a liberar, disponível, reservado, pago e dívida.
- Liberação fixa em 15 dias após entrega confirmada.
- Bloqueio por entrega ausente ou data de baixa confiança.
- Cancelamento, reembolso, devolução, contestação e chargeback.
- Classificação da responsabilidade da contestação antes de criar dívida do seller.
- Proteção de cartão em shadow mode.
- Tratamento de evidência 3DS / liability shift.
- Pacote sanitizado de evidências para disputa.
- Verificação HMAC de webhook Mercado Pago preparada.
- Planejador de payout somente em preview.
- Repasse histórico lido de sellerSettlements.
- Conciliação com evidência financeira armazenada no pedido.
- Tratamento correto de valor do provedor ausente (não confundir com zero).
- Painel Admin shadow.
- Fila de revisão manual de segurança/contestação.
- Visão read-only do seller.
- Adapter Mercado Pago Orders + 3DS sandbox isolado.
- Rotas 3DS sandbox apenas de Admin, fora do checkout atual.
- Consulta read-only da Order 3DS para conferir challenge e liability shift.
- Adapter de conciliação Mercado Pago sandbox isolado.
- Credenciais sandbox dedicadas: nunca há fallback para `MP_ACCESS_TOKEN`.
- Bloqueio se uma credencial sandbox repetir explicitamente `MP_ACCESS_TOKEN`.
- Bloqueio de qualquer resposta/registro sandbox que informe `live_mode=true`.
- API base do Mercado Pago fixada no host oficial HTTPS.
- Callback 3DS exige HTTPS.
- Readiness da Fase 1 com fail-closed.
- Readiness bloqueia ativação acidental de dinheiro real, checkout ou payout.
- CI dedicado com testes e syntax check das rotas afetadas.

## Travas de ativação

Na Fase 1, o estado seguro é:

- `ARIANA_PAY_ENABLED=false`
- `ARIANA_PAY_CHECKOUT_ENABLED=false`
- `ARIANA_PAY_PAYOUT_ENABLED=false`
- produção sem movimentação nova da Ariana Pay

O readiness retorna `readyForRealMoney=false` independentemente do restante da configuração.

## Configuração externa da homologação

### Mercado Pago

Configurado no serviço isolado `ariana-pay-shadow`:

- credencial dedicada para Orders/3DS;
- credencial dedicada para conciliação;
- Webhook com assinatura secreta;
- `MP_WEBHOOK_SIGNATURE_ENFORCE=true`;
- `MP_3DS_SANDBOX_ENABLED=true`;
- `ARIANA_PAY_RECON_SANDBOX_ENABLED=true`;
- identificação da conta de teste validada antes de criar Orders;
- nenhum fallback para `MP_ACCESS_TOKEN` do checkout atual.

As flags de dinheiro real continuam desligadas.

### Testes externos obrigatórios

Antes de qualquer merge/produção:

1. ✅ pagamento de cartão sandbox sem challenge — validado (`processed/accredited`);
2. ✅ pagamento de cartão sandbox com challenge 3DS — cenário aprovado validado (`action_required/pending_challenge` → `processed/accredited`) e cenário negado validado (`failed/3ds_challenge_failed`, `not_authenticated`);
3. ✅ validar `liability_shift` — `required` confirmado e autenticação 3DS concluída (`authenticated=true`);
4. ✅ validar webhook assinado — simulador Mercado Pago retornou HTTP 200 com HMAC ativo;
5. ✅ validar alerta de fraude/stop delivery — Webhook assinado HTTP 200 e classificação preventiva confirmada em sandbox;
6. ✅ consultar pagamento/order do sandbox para conciliação — Orders API retornou `processed/accredited`, `liveMode=false`, valor do provedor R$ 50,00, diferença R$ 0,00 e `matchesExpected=true`;
7. ✅ simular valor divergente — valor esperado R$ 49,99 x provedor R$ 50,00 resultou em diferença R$ 0,01 e `matchesExpected=false`;
8. ✅ simular chargeback com responsabilidade conhecida — seller identificado como responsável, payout bloqueado e reversão permitida, mas `sellerDebtCreated=false` no sandbox;
9. ✅ simular chargeback sem motivo conclusivo — caso ficou em `pending_review`, payout bloqueado, reversão do seller não autorizada e `sellerDebtCreated=false`;
10. ⏳ revisar uma amostra de pedidos reais somente em shadow mode.

Validação adicional: compra não reconhecida com 3DS autenticado foi atribuída a `provider_network` por `3ds_liability_shift`, sem débito do seller e sem bloqueio de payout.

## O que NÃO fazer ainda

- Não ativar payout real.
- Não ativar `ARIANA_PAY_ENABLED`.
- Não ativar `ARIANA_PAY_CHECKOUT_ENABLED`.
- Não ativar `ARIANA_PAY_PAYOUT_ENABLED`.
- Não migrar checkout atual.
- Não trocar gateway de produção.
- Não habilitar enforcement do webhook sem o secret correto.
- Não usar credencial do checkout/produção nos adapters sandbox.
- Não criar débito de seller sem responsabilidade confirmada.
- Não tocar no Gustavo, ERP ou outros fluxos fora do escopo.

## Critério para encerrar Fase 1

A Fase 1 pode ser considerada pronta para revisão de homologação quando:

- suíte Ariana Pay estiver verde;
- ledger não apresentar divergência;
- conciliação sandbox fechar centavo a centavo;
- 3DS sandbox estiver validado;
- webhook assinado estiver validado;
- casos de fraude/contestação estiverem cobertos;
- seller view estiver isolada e sem dados internos;
- rollback e flags estiverem documentados;
- não houver nenhuma movimentação real de dinheiro.

Mesmo com a Fase 1 aprovada, `readyForRealMoney` permanece **false**. Dinheiro real só entra em fase posterior, após autorização explícita.
