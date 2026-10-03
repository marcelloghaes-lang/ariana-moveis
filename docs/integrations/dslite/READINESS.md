# Integração DSlite — preparação Ariana

Status: **preparação isolada**  
Branch: `feature/dslite-integration`  
Produção: **nenhuma alteração**

## Objetivo

Integrar a DSlite diretamente ao Ariana Marketplace/ERP, sem depender de importação manual recorrente e sem expor regras internas de formação de preço ao fornecedor/seller.

## Recursos confirmados publicamente pela DSlite

Após a adesão, a DSlite informa que disponibiliza:
- URL para catálogo completo/atualizado;
- arquivos XML e XLSX;
- chave de acesso para APIs;
- consultas de produtos e estoques;
- inclusão de pedidos de dropshipping;
- consulta de remessas;
- consulta de frete.

Para pedido dropshipping, o XML da NF-e da Ariana destinado ao consumidor final é pré-requisito.

## Arquitetura

```
DSlite
  |
catálogo / API
  v
DSlite Adapter
  |
Canonical Catalog Mapper
  |
Admin Ariana -> revisão fiscal/comercial -> publicação
  |
Pedido pago
  |
NF-e Ariana -> XML
  |
DSlite -> fornecedor
  |
remessa/rastreio -> Ariana -> cliente
```

## Regras Ariana

- Integração DSlite é interna/admin, não painel de seller.
- Produtos novos nunca publicam automaticamente.
- Sem estoque confirmado: produto indisponível.
- Sem dados fiscais suficientes: revisão antes da publicação.
- Formação interna em operação própria: `(custo do fornecedor + ST extra confirmado) / 0,70`.
- Essa regra não aparece para fornecedor/seller.
- MVA não é percentual efetivo de ST.
- Variações anormais de preço precisam de bloqueio/revisão.
- Produto ausente do feed não é apagado automaticamente; deve ir para revisão/sem estoque.

## Preparação já criada

Existe um scaffold em:
`functions/integrations/dslite/dsliteClient.js`

Ele está isolado nesta branch, não é registrado no servidor e não faz chamadas reais por conta própria.

## Configuração prevista

As credenciais deverão ser mantidas apenas no ambiente autorizado, nunca no repositório.

Parâmetros previstos:
- ativação da integração: desligada por padrão;
- URL base da API;
- credencial de acesso;
- URL privada do catálogo;
- sincronização automática: desligada por padrão.

## Sequência de teste para segunda-feira

1. Confirmar aprovação DSlite e dos fornecedores.
2. Obter URL de catálogo e credencial de API no portal.
3. Salvar a credencial como secret no ambiente de homologação.
4. Fazer primeiro uma consulta somente leitura de produto/estoque.
5. Baixar catálogo em ambiente de teste.
6. Mapear os campos ao formato canônico Ariana.
7. Rodar preview sem gravar no catálogo público.
8. Conferir manualmente 5–10 SKUs: nome, custo, estoque, fotos, dimensões e fornecedor.
9. Conferir variantes.
10. Importar somente como revisão/staging.
11. Depois validar frete e remessa.
12. Somente após isso testar criação de pedido com XML da NF-e, se a conta liberada permitir.

## Bloqueios atuais

- Ainda não temos a credencial privada da conta Ariana.
- Ainda não temos a URL privada de catálogo liberada.
- Não assumir formato de autenticação ou endpoints privados até validar contra o acesso real.
- Não ativar sincronização automática em produção antes de validar preço, estoque e fiscal.
