# Ariana Pay — Fase 1: arquitetura e proteção

Status: **arquitetura/auditoria somente**  
Branch: `feature/ariana-pay-phase1`  
Produção: **nenhuma alteração**

## Objetivo

Criar uma camada financeira própria da Ariana para marketplace, sem transformar a Ariana em instituição financeira e sem substituir os gateways já existentes. A Ariana controla regras, ledger, saldos, agenda, conciliação e experiência do seller; dinheiro real, custódia, liquidação, split e antecipação ficam em instituição regulada.

## O que já existe e deve ser reaproveitado

### Seller
- Seller possui `sellerId`, status, metadata e dados bancários.
- Rotas de seller já isolam pedidos por seller.
- Seller já possui Extrato, Vendas, Pedidos e dados de recebimento.
- A comissão é definida administrativamente e o seller não pode alterá-la.
- A operação atual registra repasse como manual.

### Pedidos e preço
- `Order.items` já guarda `sellerId`, preço cobrado, base do seller e markup de cartão.
- `marketplacePricingService.js` já separa:
  - marketplace puro;
  - venda à ordem;
  - dropshipping;
  - cross docking.
- Comissão de marketplace é calculada somente sobre marketplace puro.
- Operação própria usa o valor devido ao fornecedor e mantém a margem Ariana separada.

### Extrato/repasse
- `/api/seller/extrato` já calcula bruto, comissão, líquido e status de liquidação.
- `order.sellerSettlements[sellerId]` já é consultado para status, referência, valor pago e data.
- `/api/seller/payment-split` hoje informa `manual_settlement`, sem split automático.
- Dados bancários/Pix do seller já existem e são sanitizados.

### Pagamentos
- Efí já possui integração própria e deve permanecer em homologação até autorização explícita.
- Mercado Pago/Cielo existentes não devem ser substituídos nesta fase.
- Ariana Pay será uma camada acima dos provedores, não um gateway novo.

## Lacunas que a Ariana Pay precisa preencher

1. **Ledger imutável**: cada crédito/débito financeiro precisa virar lançamento, não apenas cálculo dinâmico.
2. **Conta de recebível do seller**: disponível, a liberar, reservado, pago.
3. **Reserva**: devolução, chargeback, cancelamento e risco operacional.
4. **Agenda de liquidação**: regra por seller/pedido/evento de entrega.
5. **Conciliação**: saldo interno nunca pode ser considerado verdade absoluta sem conferir com o provedor.
6. **Payout**: entidade própria para repasses, com idempotência e auditoria.
7. **Antecipação**: somente como oferta/proposta retornada por parceiro financeiro; Ariana não financia com capital próprio nesta fase.
8. **Provider abstraction**: Efí, Mercado Pago ou BaaS devem ficar atrás de adaptadores substituíveis.

## Modelos novos propostos

### FinancialLedgerEntry
Campos mínimos:
- idempotencyKey (unique)
- sellerId
- orderId
- paymentId/providerReference
- type: sale_credit, commission_debit, fee_debit, reserve_hold, reserve_release, refund_debit, chargeback_debit, payout_debit, adjustment
- amount
- currency
- direction: credit/debit
- status
- availableAt
- provider
- metadata
- createdAt

**Regra:** lançamento financeiro nunca é editado para “corrigir”; cria-se lançamento compensatório.

### SellerBalanceSnapshot
Somente cache/visão derivada:
- sellerId
- pending
- available
- reserved
- paid
- updatedAt

Não é fonte de verdade. A fonte de verdade é o ledger.

### SellerPayout
- payoutId
- sellerId
- amount
- status: scheduled, processing, paid, failed, cancelled
- provider
- providerReference
- scheduledAt
- paidAt
- idempotencyKey
- failureReason
- metadata

### ProviderReconciliation
- provider
- referenceDate
- expectedAmount
- providerAmount
- difference
- status
- evidence/audit metadata

## Eventos que devem gerar lançamentos

- pagamento aprovado;
- entrega/condição de liberação atingida;
- comissão Ariana;
- taxa financeira atribuída ao seller, quando contratualmente aplicável;
- reserva;
- liberação da reserva;
- cancelamento;
- reembolso;
- chargeback;
- payout;
- ajuste administrativo auditado.

## Arquitetura

```
Pedido Ariana
   |
Pagamento aprovado
   |
Settlement Engine
   |
Financial Ledger  <----> Provider Reconciliation
   |
Balance Engine
   |
+-------------------+
| Seller Ariana Pay |
| pendente          |
| disponível        |
| reservado         |
| pago              |
+-------------------+
   |
Payout Orchestrator
   |
Provider regulado (Efí / MP / BaaS)
```

## Regras de segurança

- `ARIANA_PAY_ENABLED=false` por padrão.
- Nenhum payout real na Fase 1.
- Nenhuma mudança de checkout.
- Nenhuma mudança de gateway.
- Nenhuma alteração no Gustavo.
- Nenhuma escrita financeira direta sem idempotência.
- Nunca armazenar PAN/CVV.
- Secrets somente por variáveis de ambiente.
- Toda integração de provider precisa de modo sandbox/homologação.
- Produção somente após testes, reconciliação e autorização explícita.

## Plano de implementação

### Fase 1A
Modelos, ledger e testes unitários, sem rotas de movimentação real.

### Fase 1B
Gerar lançamentos em shadow mode a partir de pedidos existentes e comparar com o Extrato atual.

### Fase 1C
Painel admin e seller lendo somente o ledger shadow.

### Fase 1D
Conciliação com sandbox de provider.

### Fase 2
Payout em homologação.

### Fase 3
Produção gradual por feature flag e sellers selecionados.

## Critério de avanço

Não avançar para movimentação real enquanto:
- ledger não fechar centavo a centavo;
- pedidos multisseller não estiverem testados;
- cancelamento/reembolso/chargeback não estiverem cobertos;
- conciliação não detectar divergência;
- rollback não estiver documentado.


## Política de liberação definida

- Prazo padrão de segurança: **15 dias após a entrega confirmada**.
- O prazo só começa com evidência de entrega de alta confiança.
- Configuração ausente ou inferior a 15 dias não reduz o piso de segurança.
- Um seller pode ter prazo maior que 15 dias se configurado administrativamente.
- Sem entrega confirmada com data confiável, o recebível permanece em **A liberar**.
