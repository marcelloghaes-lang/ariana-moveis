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
- Integridade de seller agora bloqueia também quando o total cobrado dos itens do seller supera o total do próprio pedido (`seller_charged_gross_exceeds_order_total`).

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
10. ⚠️ auditoria real executada em shadow mode com credencial MongoDB dedicada `read` e sem PII: 100 pedidos lidos com `writesEnabled=false`, `payoutsEnabled=false` e `checkoutChanged=false`. A infraestrutura read-only foi validada. A amostra revelou anomalias históricas de mapeamento; uma trava adicional de integridade foi adicionada e a auditoria precisa ser repetida com essa trava antes da aprovação final.

Validação adicional: compra não reconhecida com 3DS autenticado foi atribuída a `provider_network` por `3ds_liability_shift`, sem débito do seller e sem bloqueio de payout.

## Achados da auditoria real

Execução de 2026-10-04, somente leitura, amostra de 100 pedidos dentre 218 existentes:

- credencial confirmada pelo MongoDB como papel `read` em `ariana_moveis_db`;
- `piiReturned=false`, sem nome, CPF, telefone, e-mail ou endereço no retorno;
- 100 pedidos amostrados;
- 6 pedidos classificados como candidatos de marketplace;
- 7 pedidos continham seller externo;
- 77 pedidos eram somente da própria Ariana;
- 42 pedidos foram excluídos por crediário interno;
- 84 pedidos continham identificação de seller;
- 83 projeções tinham snapshot histórico completo e 1 tinha snapshot ausente;
- 2 projeções já foram bloqueadas pela checagem de integridade existente na primeira execução;
- 84/84 projeções permaneceram bloqueadas para liberação;
- 17 pedidos tinham risco financeiro ativo;
- 17 pedidos de cartão exigiam revisão/bloqueio de segurança por ausência de evidência 3DS/dados suficientes nos registros históricos;
- 13 pagamentos possuíam evidência armazenada suficiente para conciliação `matched`;
- 0 pagamentos apresentaram divergência de valor;
- 87 pagamentos ficaram como `insufficient_evidence`, em sua maioria por ausência de referência/valor do provedor no registro histórico;
- 0 projeções foram consideradas financeiramente elegíveis para payout;
- os totais projetados de seller ficaram em R$ 0,00, portanto nenhum valor seria liberado pelo shadow.

A amostra também expôs pedidos históricos em que o total cobrado nos itens atribuídos ao seller supera o `total` do próprio pedido. Exemplos observados na amostra incluem pedido de R$ 58,32 com item atribuído ao seller em R$ 2.198,00 e pedido de R$ 10,00 com item atribuído ao seller em R$ 1.099,00. A checagem anterior comparava snapshot e valor calculado com o valor dos próprios itens, por isso esses casos podiam aparecer sem anomalia de integridade apesar de já estarem bloqueados por pagamento não aprovado.

Como correção fail-closed, foi adicionada a anomalia `seller_charged_gross_exceeds_order_total`. A partir dela, qualquer seller cujo total cobrado pelos itens supere o total do pedido fica bloqueado por integridade, independentemente do status do pagamento. A auditoria de 100 pedidos deve ser repetida após o deploy dessa trava para registrar os números finais.

Consequência: a conexão read-only e as travas de não movimentação estão aprovadas, mas a Fase 1 ainda não deve ser declarada pronta para dinheiro real nem para payout. O próximo marco é repetir a auditoria com a nova trava e confirmar que os pedidos históricos inconsistentes ficam explicitamente bloqueados por integridade.

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
- auditoria real shadow não deixar nenhuma projeção financeiramente elegível com anomalia de integridade;
- não houver nenhuma movimentação real de dinheiro.

Mesmo com a Fase 1 aprovada, `readyForRealMoney` permanece **false**. Dinheiro real só entra em fase posterior, após autorização explícita.
