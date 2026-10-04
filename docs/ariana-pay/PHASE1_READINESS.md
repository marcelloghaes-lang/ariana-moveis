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
- Repasse histórico lido de snapshot do pedido; preço atual do produto não substitui snapshot histórico confiável.
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
- Integridade de seller bloqueia quando o total cobrado dos itens do seller supera o total do próprio pedido (`seller_charged_gross_exceeds_order_total`).
- Settlement/extrato em caso estruturalmente inconsistente retorna `blocked_integrity`, sem comissão, líquido ou valor de payout calculado sobre dado contaminado.
- Guarda pré-persistência preparada na branch da Ariana Pay para `/api/orders`: o backend recalcula os itens usando o cadastro do produto, compara com o total recebido e rejeita divergência com `ORDER_FINANCIAL_INTEGRITY_MISMATCH` antes de `Order.create()`.
- A guarda pré-persistência sobrescreve o `body.total` válido pelo total calculado no servidor, eliminando dependência financeira do total enviado pelo navegador.

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
10. ✅ auditoria real completa executada em shadow mode com credencial MongoDB dedicada `read`, sem PII e sem escrita: **218/218 pedidos** da coleção foram lidos. `sampleExhaustedCollection=true`, `writesEnabled=false`, `payoutsEnabled=false` e `checkoutChanged=false`.

Validação adicional: compra não reconhecida com 3DS autenticado foi atribuída a `provider_network` por `3ds_liability_shift`, sem débito do seller e sem bloqueio de payout.

## Achados da varredura completa

Execução de 2026-10-04, somente leitura, **218 pedidos dentre 218 existentes**:

- credencial confirmada pelo MongoDB como papel `read` em `ariana_moveis_db`;
- `piiReturned=false`, sem nome, CPF, telefone, e-mail ou endereço no retorno;
- `sampleExhaustedCollection=true`;
- 46 pedidos classificados como candidatos de marketplace;
- 2 pedidos financeiramente elegíveis em nível de pedido, antes das demais travas;
- 47 pedidos continham seller externo;
- 155 pedidos eram somente seller interno/plataforma;
- 42 pedidos foram excluídos por crediário interno;
- 202 pedidos continham identificação de seller;
- 202 projeções de seller foram avaliadas;
- 116 projeções tinham snapshot histórico completo;
- 86 projeções não tinham snapshot histórico suficiente;
- **33 projeções/pedidos apresentaram anomalia de integridade e foram bloqueados**;
- 202/202 projeções ficaram bloqueadas para liberação;
- 82 pedidos tinham risco financeiro ativo;
- 53 pedidos de cartão exigiam revisão/bloqueio de segurança pelos dados históricos disponíveis;
- 36 pagamentos possuíam evidência armazenada suficiente para conciliação `matched`;
- 0 pagamentos apresentaram divergência de valor na evidência disponível;
- 182 pagamentos ficaram como `insufficient_evidence`;
- **0 projeções de seller ficaram financeiramente elegíveis para payout**;
- **0 liberações foram agendadas**;
- `projectedSellerGross=0`, `projectedSellerCommission=0` e `projectedSellerNet=0`.

### Reprodução do erro do extrato

A varredura confirmou o caso que motivou a auditoria:

- pedido `6a41588c8f4cfa680fb2a0a1`;
- criado em `2026-06-28T17:23:24.635Z`;
- total do pedido: **R$ 58,32**;
- seller externo: `seller_addf534c29eea3c8`;
- valor histórico dos itens/snapshot atribuído ao seller: **R$ 2.198,00**;
- anomalia: `seller_charged_gross_exceeds_order_total`;
- com a correção fail-closed, `computedGross=0` e nenhum valor é projetado para comissão, líquido ou payout.

Outros registros históricos confirmam o mesmo padrão, inclusive pedido de R$ 10,00 com seller em R$ 1.099,00, pedido de R$ 39,89 com seller em R$ 1.099,00 e pedidos de aproximadamente R$ 12–13 com item cobrado em mais de R$ 1.300,00.

## Causa técnica confirmada

O fluxo antigo permitia duas fontes financeiras incompatíveis no mesmo pedido:

1. os itens eram recalculados a partir do produto no banco e recebiam `sellerBaseUnitPrice`, `sellerBaseTotal`, `unitPrice` e `totalPrice`;
2. depois disso, o total do pedido ainda podia vir diretamente de `body.total` enviado pelo frontend;
3. assim era possível persistir um pedido com `total` pequeno e itens/seller muito maiores;
4. posteriormente o extrato calculava o seller usando a base dos itens, expondo valores incompatíveis com o pedido.

A correção na branch isolada fecha as duas pontas: o settlement não transforma dado inconsistente em saldo e a guarda de criação de pedido rejeita a divergência antes da persistência.

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
- Não corrigir automaticamente pedidos históricos no MongoDB; os 33 casos precisam preservar trilha de auditoria e só podem ser saneados com regra de negócio/evidência suficiente.
- Não tocar no Gustavo, ERP ou outros fluxos fora do escopo.

## Critério para encerrar Fase 1

A Fase 1 pode ser considerada pronta para revisão de homologação quando:

- suíte Ariana Pay estiver verde;
- ledger não apresentar divergência liberável;
- conciliação sandbox fechar centavo a centavo;
- 3DS sandbox estiver validado;
- webhook assinado estiver validado;
- casos de fraude/contestação estiverem cobertos;
- seller view estiver isolada e sem dados internos;
- rollback e flags estiverem documentados;
- auditoria real shadow não deixar nenhuma projeção financeiramente elegível com anomalia de integridade;
- guarda pré-persistência estiver testada antes de qualquer merge para o backend operacional;
- não houver nenhuma movimentação real de dinheiro.

A varredura completa cumpriu o requisito de auditoria read-only e confirmou que nenhuma anomalia ficou liberável. Ainda assim, `readyForRealMoney` permanece **false**. A correção do checkout/extrato permanece apenas na branch `feature/ariana-pay-phase1`; qualquer merge/deploy no backend operacional exige autorização explícita e validação de regressão do checkout atual.
