# Ariana AI Core — Shadow

Primeira camada do núcleo central de IA da Ariana Móveis.

## Segurança desta fase

- Não envia mensagens para clientes.
- Não substitui o Gustavo da loja.
- Não altera webhooks do WhatsApp.
- Executa em processo e porta separados.
- A mensagem atual sempre tem prioridade sobre contexto antigo.
- Serve para validar roteamento entre Comercial, Financeiro, Crediário, SAC e Ouvidoria.

## Execução

```bash
node --test functions/ai-core/router.test.mjs
ARIANA_AI_CORE_PORT=8098 node functions/ai-core/server.mjs
```

O endpoint `/v1/route` apenas classifica.
O endpoint `/v1/shadow/webhook` registra a decisão para auditoria e nunca responde ao cliente.

Esta branch deve permanecer separada da produção até a validação do modo sombra.
