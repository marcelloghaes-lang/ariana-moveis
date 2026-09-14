# Ariana ERP — permissões por módulo

Esta etapa reaproveita o cadastro administrativo já existente da Ariana Móveis e passa a aplicar as permissões também nas rotas do ERP.

## Mapeamento

- Vendas: `orders:read`, `orders:update`, `orders:cancel`
- Clientes: `customers:read`, `customers:update`
- Produtos/estoque: `products:read`, `products:create`, `products:update`
- Financeiro: `finance:read`, `payments:read`, `payments:receive`, `payments:cancel`
- Relatórios: `reports:read`, `finance:reports`
- Configurações: `settings:read`, `settings:update`

Administradores e usuários com `*` mantêm acesso integral.

A implementação não cria uma segunda base de usuários nem altera credenciais existentes.
