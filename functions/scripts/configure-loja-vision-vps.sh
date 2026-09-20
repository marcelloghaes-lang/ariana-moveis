#!/usr/bin/env bash
set -Eeuo pipefail

SECRETS_FILE="/root/ariana-secrets.env"
BOT_ENV_FILE="/root/loja-bot.env"
STAMP="$(date +%Y%m%d-%H%M%S)"

log() {
  printf '\n[VISÃO ARIANA LOJA] %s\n' "$*"
}

fail() {
  printf '\n[ERRO] %s\n' "$*" >&2
  exit 1
}

command -v pm2 >/dev/null || fail "PM2 não encontrado."
command -v python3 >/dev/null || fail "python3 não encontrado."
command -v curl >/dev/null || fail "curl não encontrado."

umask 077

printf "Cole a chave da API de visão/OpenAI (ela não será exibida): "
IFS= read -r -s VISION_KEY
printf '\n'

[[ -n "$VISION_KEY" ]] || fail "Chave vazia."
[[ ${#VISION_KEY} -ge 20 ]] || fail "A chave informada parece curta demais."

touch "$SECRETS_FILE" "$BOT_ENV_FILE"
chmod 600 "$SECRETS_FILE"

cp -a "$SECRETS_FILE" "${SECRETS_FILE}.bak-vision-${STAMP}"
cp -a "$BOT_ENV_FILE" "${BOT_ENV_FILE}.bak-vision-${STAMP}"

VISION_KEY="$VISION_KEY" python3 - <<'PY'
from pathlib import Path
import os

path = Path("/root/ariana-secrets.env")
key = os.environ["VISION_KEY"].strip()

lines = []
if path.exists():
    lines = path.read_text(encoding="utf-8").splitlines()

lines = [
    line for line in lines
    if not line.startswith("LOJA_VISION_OPENAI_API_KEY=")
]

lines.append(f"LOJA_VISION_OPENAI_API_KEY={key}")
path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
PY

python3 - <<'PY'
from pathlib import Path

path = Path("/root/loja-bot.env")
wanted = {
    "LOJA_VISION_MODEL": "gpt-5.6-luna",
    "LOJA_VISION_DETAIL": "high",
    "LOJA_VISION_MIN_CONFIDENCE": "0.72",
    "LOJA_VISION_TIMEOUT_MS": "20000",
}

lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
keys = set(wanted)

lines = [
    line for line in lines
    if not any(line.startswith(f"{key}=") for key in keys)
]

for key, value in wanted.items():
    lines.append(f"{key}={value}")

path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
PY

unset VISION_KEY

log "Recarregando somente o loja-bot"
set +u
set -a
source "$SECRETS_FILE"
source "$BOT_ENV_FILE"
set +a
set -u

pm2 restart loja-bot --update-env
sleep 3

log "Health"
HEALTH="$(curl -fsS http://127.0.0.1:8093/health)"
printf '%s\n' "$HEALTH"

if ! printf '%s' "$HEALTH" | grep -q '"visionConfigured":true'; then
  fail "O loja-bot reiniciou, mas visionConfigured ainda não está true."
fi

log "Configuração concluída"
printf '%s\n' \
  "A chave não foi impressa." \
  "Modelo: gpt-5.6-luna" \
  "Detalhe: high" \
  "Confiança mínima: 0.72" \
  "" \
  "Agora rode:" \
  "  bash /root/run-loja-whatsapp-tests-vps.sh"
