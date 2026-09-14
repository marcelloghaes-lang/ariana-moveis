# Ariana ERP — permissões operacionais

## Objetivo

Esta camada permite que colaboradores usem os módulos operacionais do Ariana ERP conforme as permissões já existentes no cadastro administrativo, sem criar um segundo sistema de autenticação e sem enfraquecer o `adminRequired` atual.

A autenticação continua validando JWT, sessão administrativa ativa, usuário ativo e `tokenVersion`. Depois disso, uma matriz específica do ERP decide se a rota operacional pode ser usada.

## Regra de segurança

- Administrador (`role=admin`, `admin=true` ou superadmin) mantém o acesso atual.
- Colaborador (`role=staff`) precisa possuir pelo menos uma das permissões indicadas para a rota.
- Rota ERP operacional nova que não esteja explicitamente mapeada é negada por padrão para colaboradores (`ERP_PERMISSION_DENIED`).
- Fiscal/NF-e, migração SIGE, importações/históricos SIGE e rotas administrativas do Televendas continuam usando o `adminRequired` original e permanecem exclusivas do administrador.
- A camada não expõe credenciais, certificados, tokens nem configurações secretas.

## Permissões por área

| Área | Consulta | Alteração/operação |
| --- | --- | --- |
| Painel | `dashboard:read` | — |
| Vendas/pedidos | `orders:read` | `orders:update`; cancelamento/estorno exige `orders:cancel` |
| Clientes | `customers:read` | `customers:update` |
| Produtos | `products:read` | cadastro `products:create`; alteração/estoque `products:update` |
| Caixa | `finance:read` ou `payments:read` | movimentações exigem `payments:receive` |
| Financeiro | `finance:read` ou `payments:read` conforme a tela | recebimentos/quitações `payments:receive`; cancelamentos/reabertura `payments:cancel` |
| Relatórios financeiros | `finance:reports` ou `reports:read` | — |
| Relatórios de vendas | `reports:read` ou `orders:read` | — |
| Relatórios de estoque | `reports:read` ou `products:read` | — |
| Configurações | `settings:read` | `settings:update` |

### Observação sobre criação de vendas

O catálogo atual de permissões administrativas não possui `orders:create`; por compatibilidade, criar/faturar uma venda operacional usa `orders:update`, que já depende de `orders:read` no cadastro de permissões existente.

## Endpoint de acesso

`GET /api/erp/acesso`

Retorna somente o resumo das capacidades do usuário autenticado, para que o frontend possa esconder ou desabilitar ações que o colaborador não pode executar. Esse endpoint não devolve credenciais nem dados sensíveis.

## Áreas mantidas restritas

As seguintes áreas não passam pela matriz operacional e continuam protegidas pelo middleware administrativo original:

- emissão, pré-validação, cancelamento e histórico fiscal/NF-e;
- migração/importação SIGE;
- importação de cadastros mestres e histórico SIGE;
- funções administrativas internas do Televendas.

A decisão é proposital: permissões operacionais não devem, por efeito colateral, conceder poderes fiscais ou de migração de dados.
