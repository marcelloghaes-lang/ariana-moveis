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


## Fase 2 — observação real sem resposta

O observador `chatwoot-observer.mjs` lê apenas mensagens recebidas no Chatwoot usando chamadas GET e encaminha uma cópia para o Ariana AI Core em modo sombra.

Travas desta fase:
- nenhum endpoint de envio de mensagem do Chatwoot é usado;
- somente mensagens `incoming` são observadas;
- o estado guarda o último ID visto por conversa para evitar duplicação;
- inboxes são mapeados explicitamente por variável de ambiente;
- o Ariana AI Core continua com `outboundAllowed=false`.

Variáveis:
```
CHATWOOT_BASE_URL=
CHATWOOT_ACCOUNT_ID=2
CHATWOOT_ACCESS_TOKEN=
ARIANA_AI_CORE_URL=http://127.0.0.1:8098
ARIANA_AI_OBSERVER_INBOX_MAP=5:sac,6:financeiro,7:televendas
ARIANA_AI_OBSERVER_POLL_MS=30000
```

Antes de ativar na VPS, validar os IDs reais das caixas e incluir a caixa da Loja sem alterar o webhook do Gustavo.


## Fase 2 ativa na VPS — observador direto do Chatwoot

A implementação ativa usa `chatwoot-db-observer-runner.mjs` + `chatwoot-db-observer.mjs` e executa somente consultas SELECT no banco local do Chatwoot.

Mapeamento confirmado da conta 2:
- Inbox 5: SAC
- Inbox 6: Financeiro
- Inbox 7: Ariana Loja / Televendas (tratada como canal misto `loja`)
- Inbox 9: Crediário

Proteções:
- primeira inicialização começa no maior ID atual e não reprocessa histórico;
- nenhuma escrita é feita no banco Chatwoot;
- nenhuma API de envio de mensagem é usada;
- respostas humanas não são usadas como erro do Gustavo quando o estado indica modo humano;
- comparações persistem somente IDs, rotas e hashes, sem guardar o texto integral;
- imagem ou áudio sem interpretação suficiente recebe `MULTIMIDIA_PENDENTE`, evitando presumir produto ou pagamento;
- pagamento realizado/comprovante tem prioridade sobre contexto antigo;
- parcela atrasada/renegociação segue para Crediário quando não há sinal de pagamento realizado.

Processos:
- `loja-bot`: Gustavo de produção, preservado;
- `ariana-ai-core-shadow`: roteador sombra em 127.0.0.1:8098;
- `ariana-ai-db-observer-shadow`: observador passivo das conversas novas.
