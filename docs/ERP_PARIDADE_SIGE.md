# Ariana ERP — Matriz de Paridade Funcional com SIGE Cloud

Objetivo: implementar no Ariana ERP, com código e banco próprios, funções equivalentes às rotinas de gestão usadas no SIGE Cloud, sem dependência operacional do SIGE.

## Ordem de implementação

1. Fiscal — consulta, segunda via, XML, DANFE/espelho, emissão NF-e, devolução, cancelamento, CC-e, inutilização, nota avulsa e configuração fiscal.
2. Cadastros — produtos completos, pessoas, fornecedores, empresas, depósitos, marcas, categorias, tabelas de preços, formas de pagamento, operações fiscais, grupos tributários, equipamentos e serviços.
3. Vendas — orçamentos, pedidos, faturamento, PDV, devoluções, comissões, vendedores e categorias de venda.
4. Financeiro — contas a pagar, contas a receber, lançamentos, baixas, vencidos, a vencer, inadimplentes, bancos, categorias/plano de contas, fluxo de caixa, cobrança e comissões.
5. Relatórios de vendas — pedidos, pedidos-itens, vendas PDV, lucratividade por pedido, lucro estimado por venda, rentabilidade, ABC clientes, ABC produtos, itens x vendedor, formas de pagamento e comissões.
6. Compras — ordens de compra, cotações, notas de entrada, faturamento da entrada, financeiro e estoque de entrada.
7. Estoque — depósitos, entradas, saídas, movimentações, inventário, ajustes, mínimo, relatórios e custo.
8. Serviços — ordens de serviço, OS avulsa, técnicos, equipamentos, checklists, laudos e NFS-e.
9. CRM — oportunidades, funil, atividades, histórico e categorias vinculadas.
10. Expedição — separação, conferência, romaneio, despacho e acompanhamento.
11. Contratos — contratos, recorrência, faturamento e NFS-e quando aplicável.
12. Configurações e usuários — operadores ERP, perfis, permissões, auditoria, empresa, parâmetros do PDV e fiscais.
13. Integrações — APIs e webhooks necessários, sem criar dependência do SIGE.
14. Exportações — Excel/PDF/CSV dos relatórios e documentos.
15. Backup/offline — backup, restauração e estratégia segura de operação offline quando aplicável.

## Relatórios financeiros confirmados
- Inadimplentes
- Fluxo de Caixa
- Lucro Estimado por Venda
- Lançamentos financeiros
- Comissões lançadas
- Lançamentos do vendedor
- Contas a pagar/receber por situação, vencimento e pagamento

## Relatórios de vendas confirmados
- Pedidos
- Pedidos Itens
- Vendas PDV
- Pedidos Lucratividade
- Rentabilidade Vendas
- ABC Vendas Clientes
- ABC Vendas Produtos
- Itens x Vendedor
- Comissões Pedidos

## Regras de segurança de implementação
- Um módulo/PR por vez.
- Não apagar ou substituir módulos existentes do site.
- Histórico migrado nunca movimenta novamente estoque, caixa ou banco.
- Emissão/cancelamento fiscal só pode ser marcado como autorizado após retorno real da SEFAZ/provedor fiscal homologado.
- Chave de acesso é a principal proteção contra duplicidade de NF-e.
