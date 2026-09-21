#!/usr/bin/env bash
set -Eeuo pipefail

BOT_FILE="/root/loja-bot.mjs"
BOT_ENV_FILE="/root/loja-bot.env"
SECRETS_FILE="/root/ariana-secrets.env"
PORT="8093"
REPO="marcelloghaes-lang/ariana-moveis"
REF="${1:-}"
STAMP="$(date +%Y%m%d-%H%M%S)"
TMP_BOT="/tmp/loja-bot-candidato-${STAMP}.mjs"
BACKUP="${BOT_FILE}.bak-deploy-${STAMP}"

log() { printf '\n[DEPLOY ARIANA LOJA] %s\n' "$*"; }
fail() { printf '\n[ERRO] %s\n' "$*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || fail "Execute como root."
[[ -n "$REF" ]] || fail "Informe o commit/ref validado. Ex.: bash deploy-loja-whatsapp-bot-vps.sh <commit>"

command -v curl >/dev/null 2>&1 || fail "curl não encontrado."
command -v node >/dev/null 2>&1 || fail "node não encontrado."
command -v pm2 >/dev/null 2>&1 || fail "pm2 não encontrado."
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum não encontrado."

[[ -f "$BOT_FILE" ]] || fail "Arquivo atual $BOT_FILE não encontrado."
[[ -f "$BOT_ENV_FILE" ]] || fail "Arquivo de ambiente $BOT_ENV_FILE não encontrado. Nada foi alterado."

cleanup() {
  rm -f "$TMP_BOT"
}
trap cleanup EXIT

log "Baixando somente o código do bot do ref ${REF}"
curl -fsSL "https://raw.githubusercontent.com/${REPO}/${REF}/functions/scripts/loja-whatsapp-bot.js?v=${STAMP}" -o "$TMP_BOT"
node --check "$TMP_BOT" >/dev/null || fail "O candidato falhou na validação de sintaxe. Nada foi alterado."

CURRENT_SHA="$(sha256sum "$BOT_FILE" | awk '{print $1}')"
CANDIDATE_SHA="$(sha256sum "$TMP_BOT" | awk '{print $1}')"
printf 'SHA atual:     %s\n' "$CURRENT_SHA"
printf 'SHA candidato: %s\n' "$CANDIDATE_SHA"

if [[ "$CURRENT_SHA" == "$CANDIDATE_SHA" ]]; then
  log "O código em produção já é idêntico ao candidato. Nenhuma troca de arquivo é necessária."
  exit 0
fi

log "Criando backup do código atual"
cp -a "$BOT_FILE" "$BACKUP"
chmod 700 "$BACKUP" || true

rollback() {
  printf '\n[ROLLBACK] Restaurando versão anterior do loja-bot...\n' >&2
  cp -a "$BACKUP" "$BOT_FILE"
  chmod 700 "$BOT_FILE" || true
  set +u
  set -a
  [[ -f "$SECRETS_FILE" ]] && source "$SECRETS_FILE"
  source "$BOT_ENV_FILE"
  set +a
  set -u
  pm2 restart loja-bot --update-env >/dev/null 2>&1 || true
  sleep 2
  printf '[ROLLBACK] Backup restaurado: %s\n' "$BACKUP" >&2
}

log "Publicando candidato sem alterar arquivos de ambiente"
cp -a "$TMP_BOT" "$BOT_FILE"
chmod 700 "$BOT_FILE"

set +u
set -a
[[ -f "$SECRETS_FILE" ]] && source "$SECRETS_FILE"
source "$BOT_ENV_FILE"
set +a
set -u

log "Reiniciando somente o processo PM2 loja-bot"
if ! pm2 restart loja-bot --update-env >/dev/null; then
  rollback
  fail "Falha ao reiniciar o loja-bot. A versão anterior foi restaurada."
fi

HEALTH=""
for _ in 1 2 3 4 5 6; do
  HEALTH="$(curl -fsS --max-time 4 "http://127.0.0.1:${PORT}/health" 2>/dev/null || true)"
  if printf '%s' "$HEALTH" | grep -q '"service":"ariana-loja-whatsapp-bot"'; then
    break
  fi
  sleep 1
done

if ! printf '%s' "$HEALTH" | grep -q '"service":"ariana-loja-whatsapp-bot"'; then
  rollback
  fail "Health local não confirmou o serviço. A versão anterior foi restaurada."
fi

if ! curl -fsS --max-time 8 "https://atendimento.arianamoveis.com.br/loja-bot/health" >/dev/null; then
  rollback
  fail "Health HTTPS falhou. A versão anterior foi restaurada."
fi

FINAL_SHA="$(sha256sum "$BOT_FILE" | awk '{print $1}')"
if [[ "$FINAL_SHA" != "$CANDIDATE_SHA" ]]; then
  rollback
  fail "O arquivo publicado não corresponde ao candidato. A versão anterior foi restaurada."
fi

pm2 save >/dev/null

log "Publicação concluída com sucesso"
printf 'Ref publicado: %s\n' "$REF"
printf 'SHA publicado: %s\n' "$FINAL_SHA"
printf 'Backup anterior: %s\n' "$BACKUP"
printf 'Health local: OK\n'
printf 'Health HTTPS: OK\n'
printf '\nConfiguração preservada: %s e %s não foram recriados nem sobrescritos.\n' "$BOT_ENV_FILE" "$SECRETS_FILE"
