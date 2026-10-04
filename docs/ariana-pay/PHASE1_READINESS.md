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
- Adapter de conciliação Mercado Pago sandbox isolado.
- Readiness da Fase 1 com fail-closed.
- CI dedicado com testes e syntax check das rotas afetadas.

## Ainda depende de configuração externa

### Mercado Pago
Necessário obter/configurar de forma segura:

- `MP_WEBHOOK_SECRET`
- `MP_3DS_SANDBOX_ACCESS_TOKEN`
- `MP_3DS_SANDBOX_NOTIFICATION_URL`
- `MP_RECON_SANDBOX_ACCESS_TOKEN`

Flags continuam desligadas até existir credencial correta:

- `MP_WEBHOOK_SIGNATURE_ENFORCE=false`
- `MP_3DS_SANDBOX_ENABLED=false`
- `ARIANA_PAY_RECON_SANDBOX_ENABLED=false`

### Testes externos obrigatórios

Antes de qualquer merge/produção:

1. pagamento de cartão sandbox sem challenge;
2. pagamento de cartão sandbox com challenge 3DS;
3. validar `liability_shift`;
4. validar webhook assinado;
5. validar alerta de fraude/stop delivery;
6. consultar pagamento do sandbox para conciliação;
7. simular valor divergente;
8. simular chargeback com responsabilidade conhecida;
9. simular chargeback sem motivo e confirmar que não cria dívida automática do seller;
10. revisar uma amostra de pedidos reais somente em shadow mode.

## O que NÃO fazer ainda

- Não ativar payout real.
- Não ativar `ARIANA_PAY_ENABLED`.
- Não migrar checkout atual.
- Não trocar gateway de produção.
- Não habilitar enforcement do webhook sem o secret correto.
- Não usar credencial de produção nos adapters sandbox.
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
