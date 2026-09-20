#!/usr/bin/env bash
set -Eeuo pipefail

INSTALLER_VERSION="2026-09-20.5"

INSTANCE_NAME="ariana loja"
INSTANCE_PATH="ariana%20loja"
EVOLUTION_API_URL="${EVOLUTION_API_URL:-http://127.0.0.1:8082}"
PUBLIC_WEBHOOK_URL="https://atendimento.arianamoveis.com.br/loja-bot"
BOT_SOURCE_URL="https://raw.githubusercontent.com/marcelloghaes-lang/ariana-moveis/main/functions/scripts/loja-whatsapp-bot.js"
BOT_FILE="/root/loja-bot.mjs"
BOT_ENV_FILE="/root/loja-bot.env"
PORT="8093"
STAMP="$(date +%Y%m%d-%H%M%S)"

log() { printf '\n[ARIANA LOJA] %s\n' "$*"; }
fail() { printf '\n[ERRO] %s\n' "$*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || fail "Execute como root."

if [[ -f /root/ariana-secrets.env ]]; then
  set +u
  set -a
  # shellcheck disable=SC1091
  source /root/ariana-secrets.env
  set +a
  set -u
fi

pm2_env_value() {
  command -v pm2 >/dev/null 2>&1 || return 0
  pm2 jlist 2>/dev/null | node -e '
    let raw="";
    process.stdin.on("data", c => raw += c);
    process.stdin.on("end", () => {
      let apps=[];
      try { apps=JSON.parse(raw); } catch { process.exit(0); }
      const keys=process.argv.slice(1);
      const preferred=["sac-bot","financeiro-bot","chatwoot-human-webhook","human-monitor","ariana-backend"];
      const ordered=[
        ...preferred.flatMap(n => apps.filter(a => a?.name === n)),
        ...apps.filter(a => !preferred.includes(a?.name))
      ];
      for (const app of ordered) {
        const env=app?.pm2_env || {};
        for (const key of keys) {
          const value=env[key];
          if (value !== undefined && value !== null && String(value).trim()) {
            process.stdout.write(String(value).trim());
            return;
          }
        }
      }
    });
  ' "$@" 2>/dev/null || true
}

EVOLUTION_API_KEY="${EVOLUTION_API_KEY:-}"
BOT_API_TOKEN="${LOJA_BOT_API_TOKEN:-${BOT_API_TOKEN:-${FINANCEIRO_BOT_SECRET:-${SAC_BOT_SECRET:-}}}}"

if [[ -z "$EVOLUTION_API_KEY" ]]; then
  EVOLUTION_API_KEY="$(pm2_env_value EVOLUTION_API_KEY AUTHENTICATION_API_KEY)"
fi
if [[ -z "$BOT_API_TOKEN" ]]; then
  BOT_API_TOKEN="$(pm2_env_value BOT_API_TOKEN FINANCEIRO_BOT_SECRET SAC_BOT_SECRET)"
fi

discover_bot_token_from_files() {
  python3 - <<'PY'
import glob, os, re

candidates = [
    "/root/ariana-secrets.env",
    "/root/sac-bot.js",
    "/root/financeiro-bot.js",
    "/root/chatwoot-human-webhook.js",
]
candidates += sorted(glob.glob("/root/*.env"))
candidates += sorted(glob.glob("/root/*bot*.js"))

seen=set()
files=[]
for p in candidates:
    if p in seen or not os.path.isfile(p):
        continue
    seen.add(p)
    files.append(p)

patterns = [
    re.compile(r'^(?:export\s+)?(?:BOT_API_TOKEN|FINANCEIRO_BOT_SECRET|SAC_BOT_SECRET)\s*=\s*["\']?([^"\'\s#;]+)', re.M),
    re.compile(r'const\s+(?:BOT_API_TOKEN|FINANCEIRO_BOT_SECRET|SAC_BOT_SECRET)\s*=\s*["\']([^"\']{12,})["\']'),
    re.compile(r'["\']x-bot-token["\']\s*:\s*["\']([^"\']{12,})["\']'),
    re.compile(r'process\.env\.(?:BOT_API_TOKEN|FINANCEIRO_BOT_SECRET|SAC_BOT_SECRET)\s*\|\|\s*["\']([^"\']{12,})["\']'),
]

for path in files:
    try:
        text=open(path, encoding="utf-8", errors="ignore").read()
    except Exception:
        continue
    for pattern in patterns:
        m=pattern.search(text)
        if m:
            value=m.group(1).strip()
            if value and value.lower() not in {"changeme","secret","token","undefined","null"}:
                print(value, end="")
                raise SystemExit(0)
PY
}

if [[ -z "$BOT_API_TOKEN" ]]; then
  BOT_API_TOKEN="$(discover_bot_token_from_files)"
fi

[[ -n "$EVOLUTION_API_KEY" ]] || fail "Não encontrei EVOLUTION_API_KEY no ariana-secrets.env nem nos processos PM2."

if [[ -z "$BOT_API_TOKEN" ]]; then
  log "Token de bot não localizado localmente; verificando se o backend exige autenticação"
  PROBE_CODE="$(curl -sS -o /tmp/ariana-loja-bot-auth-probe.json -w '%{http_code}'     "https://ariana-backend.onrender.com/api/bot/sac/consulta?identifier=__loja_bot_probe__" || true)"

  if [[ "$PROBE_CODE" == "401" || "$PROBE_CODE" == "403" ]]; then
    fail "O backend exige BOT_API_TOKEN, mas o token não foi localizado na VPS. Nada foi alterado."
  fi

  log "Backend não exige BOT_API_TOKEN para as rotas de bot atuais; seguindo sem token local"
fi

command -v curl >/dev/null 2>&1 || fail "curl não encontrado."
command -v node >/dev/null 2>&1 || fail "node não encontrado."
command -v python3 >/dev/null 2>&1 || fail "python3 não encontrado."
command -v pm2 >/dev/null 2>&1 || fail "pm2 não encontrado."
command -v nginx >/dev/null 2>&1 || fail "nginx não encontrado."

log "Instalador versão ${INSTALLER_VERSION}"
log "Verificando instância principal da Evolution"
INSTANCES_JSON="/tmp/ariana-loja-instances-${STAMP}.json"
curl -fsS "${EVOLUTION_API_URL}/instance/fetchInstances" \
  -H "apikey: ${EVOLUTION_API_KEY}" > "$INSTANCES_JSON"

python3 - "$INSTANCES_JSON" "$INSTANCE_NAME" <<'PY' || fail "A instância ariana loja não foi localizada."
import json, sys
rows=json.load(open(sys.argv[1], encoding="utf-8"))
name=sys.argv[2]
if isinstance(rows, dict):
    rows=rows.get("instances") or rows.get("data") or [rows]
found=False
for row in rows if isinstance(rows, list) else []:
    candidate=(row.get("name") or row.get("instance",{}).get("instanceName") or row.get("instanceName") or "")
    if candidate.strip().lower()==name.lower():
        found=True
        break
raise SystemExit(0 if found else 1)
PY

log "Salvando configuração atual do webhook"
CURRENT_WEBHOOK="/root/backup-ariana-loja-webhook-${STAMP}.json"
curl -fsS "${EVOLUTION_API_URL}/webhook/find/${INSTANCE_PATH}" \
  -H "apikey: ${EVOLUTION_API_KEY}" > "$CURRENT_WEBHOOK" || fail "Não consegui consultar o webhook atual. Nada foi alterado."
chmod 600 "$CURRENT_WEBHOOK"

log "Baixando o atendimento comercial e validando sintaxe"
if [[ -f "$BOT_FILE" ]]; then
  cp -a "$BOT_FILE" "${BOT_FILE}.bak-${STAMP}"
fi
TMP_BOT="/root/loja-bot-${STAMP}.mjs"
curl -fsSL "${BOT_SOURCE_URL}?v=${STAMP}" -o "$TMP_BOT"
node --check "$TMP_BOT" >/dev/null
mv "$TMP_BOT" "$BOT_FILE"
chmod 700 "$BOT_FILE"

log "Preparando preservação do webhook anterior"
python3 - "$CURRENT_WEBHOOK" "$BOT_ENV_FILE" "$PUBLIC_WEBHOOK_URL" "$EVOLUTION_API_URL" "$EVOLUTION_API_KEY" "$BOT_API_TOKEN" <<'PY'
import base64, json, shlex, sys

src, env_path, new_url, evo_url, evo_key, bot_token = sys.argv[1:]
obj=json.load(open(src, encoding="utf-8"))
w=obj
for _ in range(4):
    nested=w.get("webhook") if isinstance(w, dict) else None
    if isinstance(nested, dict):
        w=nested
    else:
        break

old_url=str((w or {}).get("url") or "").strip()
by=bool((w or {}).get("webhookByEvents", (w or {}).get("byEvents", False)))
headers=(w or {}).get("headers") or {}
if not isinstance(headers, dict):
    headers={}
legacy="" if old_url.rstrip("/")==new_url.rstrip("/") else old_url
headers_b64=base64.b64encode(json.dumps(headers, ensure_ascii=False).encode()).decode()

values={
    "EVOLUTION_API_URL": evo_url,
    "EVOLUTION_API_KEY": evo_key,
    "LOJA_EVOLUTION_INSTANCE": "ariana loja",
    "ARIANA_BACKEND_URL": "https://ariana-backend.onrender.com",
    "LOJA_BOT_API_TOKEN": bot_token,
    "LOJA_BOT_PORT": "8093",
    "LOJA_HUMAN_TTL_HOURS": "12",
    "LOJA_LEGACY_WEBHOOK_URL": legacy,
    "LOJA_LEGACY_WEBHOOK_BY_EVENTS": "true" if by else "false",
    "LOJA_LEGACY_WEBHOOK_HEADERS_B64": headers_b64,
}
with open(env_path, "w", encoding="utf-8") as f:
    for k,v in values.items():
        f.write(f"{k}={shlex.quote(str(v))}\n")
PY
chmod 600 "$BOT_ENV_FILE"

log "Preparando JSON do novo webhook sem perder eventos atuais"
SET_WEBHOOK_JSON="/tmp/ariana-loja-webhook-set-${STAMP}.json"
python3 - "$CURRENT_WEBHOOK" "$SET_WEBHOOK_JSON" "$PUBLIC_WEBHOOK_URL" <<'PY'
import json, sys
src, dst, url=sys.argv[1:]
obj=json.load(open(src, encoding="utf-8"))
w=obj
for _ in range(4):
    nested=w.get("webhook") if isinstance(w, dict) else None
    if isinstance(nested, dict):
        w=nested
    else:
        break
if not isinstance(w, dict):
    w={}
events=w.get("events") or []
if not isinstance(events, list):
    events=[]
events=[str(e).upper() for e in events if str(e).strip()]
if "MESSAGES_UPSERT" not in events:
    events.append("MESSAGES_UPSERT")
payload={
    "enabled": True,
    "url": url,
    "webhookByEvents": bool(w.get("webhookByEvents", w.get("byEvents", False))),
    "webhookBase64": bool(w.get("webhookBase64", w.get("base64", False))),
    "events": events,
}
headers=w.get("headers")
if isinstance(headers, dict) and headers:
    payload["headers"]=headers
json.dump(payload, open(dst, "w", encoding="utf-8"), ensure_ascii=False)
PY
chmod 600 "$SET_WEBHOOK_JSON"

if ss -lntp 2>/dev/null | grep -qE ":${PORT}\\b"; then
  HEALTH_CURRENT="$(curl -sS --max-time 3 "http://127.0.0.1:${PORT}/health" 2>/dev/null || true)"
  if printf '%s' "$HEALTH_CURRENT" | grep -q '"service":"ariana-loja-whatsapp-bot"'; then
    log "Porta ${PORT} já está sendo usada pelo próprio loja-bot; ele será reiniciado com a versão atual."
  else
    fail "A porta ${PORT} está ocupada por outro serviço. Nada foi alterado no webhook."
  fi
fi

log "Iniciando loja-bot no PM2"
set +u
set -a
# shellcheck disable=SC1090
source "$BOT_ENV_FILE"
set +a
set -u
pm2 delete loja-bot >/dev/null 2>&1 || true
pm2 start "$BOT_FILE" --name loja-bot --time
pm2 save >/dev/null

for _ in 1 2 3 4 5; do
  if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null; then
    break
  fi
  sleep 1
done
curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null || fail "loja-bot não respondeu localmente. Webhook não foi alterado."

log "Adicionando proxy HTTPS no Nginx"
NGINX_CONF="$(grep -RIlE 'server_name[^;]*atendimento\.arianamoveis\.com\.br' /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null | head -n1 || true)"
[[ -n "$NGINX_CONF" ]] || fail "Não encontrei o server_name atendimento.arianamoveis.com.br. Webhook não foi alterado."
NGINX_REAL="$(readlink -f "$NGINX_CONF")"
cp -a "$NGINX_REAL" "${NGINX_REAL}.bak-loja-bot-${STAMP}"

python3 - "$NGINX_REAL" <<'PY'
import re, sys
path=sys.argv[1]
text=open(path, encoding="utf-8").read()

def matching_brace(source, open_pos):
    depth=0
    for i in range(open_pos, len(source)):
        ch=source[i]
        if ch=="{":
            depth+=1
        elif ch=="}":
            depth-=1
            if depth==0:
                return i
    return None

# Remove any previous /loja-bot location from this file so a failed
# earlier attempt cannot leave it in the HTTP redirect server.
while True:
    m=re.search(r"\n\s*# Ariana Loja - atendimento comercial automatizado\s*\n\s*location\s+\/loja-bot\s*\{", text, re.I)
    if not m:
        m=re.search(r"\n\s*location\s+\/loja-bot\s*\{", text, re.I)
    if not m:
        break
    brace=text.find("{", m.start())
    close=matching_brace(text, brace)
    if close is None:
        raise SystemExit("bloco /loja-bot existente está incompleto")
    text=text[:m.start()]+"\n"+text[close+1:]

# Find all server blocks and choose the HTTPS one for atendimento.
servers=[]
for m in re.finditer(r"\bserver\s*\{", text):
    brace=text.find("{", m.start())
    close=matching_brace(text, brace)
    if close is None:
        continue
    block=text[m.start():close+1]
    if re.search(r"server_name\s+[^;]*atendimento\.arianamoveis\.com\.br[^;]*;", block, re.I):
        https=bool(
            re.search(r"listen\s+[^;]*\b443\b[^;]*;", block, re.I) or
            re.search(r"\bssl_certificate\b", block, re.I)
        )
        servers.append((m.start(), brace, close, https))

https_servers=[item for item in servers if item[3]]
if not https_servers:
    raise SystemExit("bloco HTTPS (443) de atendimento.arianamoveis.com.br não localizado")

start, brace, close, _ = https_servers[0]
block="""
    # Ariana Loja - atendimento comercial automatizado
    location /loja-bot {
        proxy_pass http://127.0.0.1:8093;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 10s;
        proxy_read_timeout 30s;
    }

"""
text=text[:close]+block+text[close:]
open(path, "w", encoding="utf-8").write(text)
PY


if ! nginx -t; then
  cp -a "${NGINX_REAL}.bak-loja-bot-${STAMP}" "$NGINX_REAL"
  nginx -t || true
  fail "Nginx recusou a configuração. O arquivo anterior foi restaurado e o webhook não foi alterado."
fi
systemctl reload nginx

curl -fsS "https://atendimento.arianamoveis.com.br/loja-bot/health" >/dev/null || fail "O endpoint HTTPS do loja-bot não respondeu. Webhook não foi alterado."

log "Ativando webhook da Ariana Loja"
SET_RESPONSE="/tmp/ariana-loja-webhook-response-${STAMP}.json"
HTTP_CODE="$(curl -sS -o "$SET_RESPONSE" -w '%{http_code}' \
  -X POST "${EVOLUTION_API_URL}/webhook/set/${INSTANCE_PATH}" \
  -H "apikey: ${EVOLUTION_API_KEY}" \
  -H "Content-Type: application/json" \
  --data-binary "@${SET_WEBHOOK_JSON}")"

if [[ ! "$HTTP_CODE" =~ ^2 ]]; then
  WRAPPED="/tmp/ariana-loja-webhook-set-wrapped-${STAMP}.json"
  python3 - "$SET_WEBHOOK_JSON" "$WRAPPED" <<'PY'
import json, sys
data=json.load(open(sys.argv[1], encoding="utf-8"))
json.dump({"webhook": data}, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False)
PY
  HTTP_CODE="$(curl -sS -o "$SET_RESPONSE" -w '%{http_code}' \
    -X POST "${EVOLUTION_API_URL}/webhook/set/${INSTANCE_PATH}" \
    -H "apikey: ${EVOLUTION_API_KEY}" \
    -H "Content-Type: application/json" \
    --data-binary "@${WRAPPED}")"
fi

[[ "$HTTP_CODE" =~ ^2 ]] || {
  cat "$SET_RESPONSE" >&2 || true
  fail "Evolution recusou a alteração do webhook (HTTP ${HTTP_CODE}). O backup está em ${CURRENT_WEBHOOK}."
}

FINAL_WEBHOOK="/tmp/ariana-loja-webhook-final-${STAMP}.json"
curl -fsS "${EVOLUTION_API_URL}/webhook/find/${INSTANCE_PATH}" \
  -H "apikey: ${EVOLUTION_API_KEY}" > "$FINAL_WEBHOOK"

python3 - "$FINAL_WEBHOOK" "$PUBLIC_WEBHOOK_URL" <<'PY' || fail "Evolution não confirmou o novo webhook."
import json, sys
obj=json.load(open(sys.argv[1], encoding="utf-8"))
w=obj
for _ in range(4):
    nested=w.get("webhook") if isinstance(w, dict) else None
    if isinstance(nested, dict): w=nested
    else: break
url=str((w or {}).get("url") or "").rstrip("/")
expected=sys.argv[2].rstrip("/")
if url != expected:
    print("URL retornada:", url)
    raise SystemExit(1)
print("Webhook ativo:", url)
print("Eventos:", ", ".join((w or {}).get("events") or []))
print("Webhook por eventos:", bool((w or {}).get("webhookByEvents", (w or {}).get("byEvents", False))))
PY

log "Instalação concluída"
pm2 describe loja-bot | sed -n '1,35p'
printf '\nBackup do webhook anterior: %s\n' "$CURRENT_WEBHOOK"
printf 'Backup do Nginx: %s\n' "${NGINX_REAL}.bak-loja-bot-${STAMP}"
printf 'Health: https://atendimento.arianamoveis.com.br/loja-bot/health\n'
