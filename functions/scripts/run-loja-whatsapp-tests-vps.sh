#!/usr/bin/env bash
set -Eeuo pipefail

log() { printf '\n[TESTES ARIANA LOJA] %s\n' "$*"; }
fail() { printf '\n[ERRO] %s\n' "$*" >&2; exit 1; }

REPO="marcelloghaes-lang/ariana-moveis"
STAMP="$(date +%Y%m%d-%H%M%S)"
RAW_REF="$(curl -fsSL -H 'Accept: application/vnd.github+json' "https://api.github.com/repos/$REPO/commits/main?ts=$STAMP" | python3 -c 'import json,sys; print(json.load(sys.stdin)["sha"])')"
[[ -n "$RAW_REF" ]] || fail "Não foi possível resolver o commit atual do GitHub."
RAW_BASE="https://raw.githubusercontent.com/$REPO/$RAW_REF"
TMP_DIR="/tmp/ariana-loja-tests-$STAMP"

command -v curl >/dev/null || fail "curl não encontrado."
command -v node >/dev/null || fail "node não encontrado."

mkdir -p "$TMP_DIR/functions/scripts" "$TMP_DIR/functions/tests"
trap 'rm -rf "$TMP_DIR"' EXIT

set +u
set -a
[[ -f /root/ariana-secrets.env ]] && source /root/ariana-secrets.env
[[ -f /root/loja-bot.env ]] && source /root/loja-bot.env
set +a
set -u

log "Baixando candidato e suíte de testes"
echo "Commit testado: $RAW_REF"
curl -fsSL "$RAW_BASE/functions/scripts/loja-whatsapp-bot.js?v=$STAMP" \
  -o "$TMP_DIR/functions/scripts/loja-whatsapp-bot.js"
curl -fsSL "$RAW_BASE/functions/tests/loja-whatsapp-bot.test.mjs?v=$STAMP" \
  -o "$TMP_DIR/functions/tests/loja-whatsapp-bot.test.mjs"
curl -fsSL "$RAW_BASE/functions/tests/loja-whatsapp-live-check.mjs?v=$STAMP" \
  -o "$TMP_DIR/functions/tests/loja-whatsapp-live-check.mjs"

if [[ -f /root/loja-bot.mjs ]]; then
  CURRENT_SHA="$(sha256sum /root/loja-bot.mjs | awk '{print $1}')"
  CANDIDATE_SHA="$(sha256sum "$TMP_DIR/functions/scripts/loja-whatsapp-bot.js" | awk '{print $1}')"
  if [[ "$CURRENT_SHA" == "$CANDIDATE_SHA" ]]; then
    echo "✅ Código em produção é igual ao candidato testado."
  else
    echo "⚠️  Código em produção é diferente do candidato atual do GitHub."
    echo "    Os testes unitários abaixo validam o candidato; o smoke test valida o ambiente atual."
  fi
fi

log "Executando testes automáticos de regras e conversação"
(
  cd "$TMP_DIR"
  node --test functions/tests/loja-whatsapp-bot.test.mjs
)

log "Executando smoke test do ambiente real"
(
  cd "$TMP_DIR"
  node functions/tests/loja-whatsapp-live-check.mjs
)

log "TESTES AUTOMÁTICOS CONCLUÍDOS"
cat <<'EOF'

Ainda permanecem manuais somente os testes que exigem o WhatsApp real:
  1. conferir visualmente foto/formatação de alguns produtos;
  2. confirmar a conversa aparecendo no Chatwoot;
  3. responder manualmente pelo aparelho e verificar silêncio do bot;
  4. confirmar a retomada após 1 hora;
  5. confirmar que não há segunda resposta automática do Chatwoot.

Nenhuma mensagem real foi enviada por este script.
EOF
