#!/usr/bin/env bash
# Watchdog de la sesión WhatsApp (WAHA).
# Polea cada N minutos vía cron. Si la sesión "default" no está WORKING/STARTING,
# intenta arrancarla. Si pasa a SCAN_QR_CODE o FAILED, deja log alto para revisión manual.
#
# Cron recomendado: */2 * * * * /opt/atepsa-reportes/repo/infra/scripts/waha-watchdog.sh >> /var/log/atepsa-waha-watchdog.log 2>&1

set -euo pipefail

ENV_FILE="/opt/atepsa-reportes/repo/infra/.env"
CONTAINER="atepsa-rep-wppconnect"
SESSION="default"
WAHA_INTERNAL_URL="http://localhost:3000"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[$(date -Iseconds)] [FATAL] no existe $ENV_FILE"
  exit 1
fi

# Solo necesitamos la clave; evitamos sourcear todo el .env
WPPCONNECT_SECRET_KEY="$(grep -E '^WPPCONNECT_SECRET_KEY=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
if [[ -z "${WPPCONNECT_SECRET_KEY:-}" ]]; then
  echo "[$(date -Iseconds)] [FATAL] WPPCONNECT_SECRET_KEY vacía en $ENV_FILE"
  exit 1
fi

waha_get() {
  docker exec "$CONTAINER" sh -c \
    "wget -qO- --header=\"X-Api-Key: $WPPCONNECT_SECRET_KEY\" $WAHA_INTERNAL_URL$1" 2>/dev/null || true
}

waha_post() {
  docker exec "$CONTAINER" sh -c \
    "wget -qO- --post-data='{}' --header=\"Content-Type: application/json\" --header=\"X-Api-Key: $WPPCONNECT_SECRET_KEY\" $WAHA_INTERNAL_URL$1" 2>/dev/null || true
}

# El container puede no estar arriba todavía
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  echo "[$(date -Iseconds)] [WARN] container $CONTAINER no está corriendo, salgo"
  exit 0
fi

SESSIONS_JSON="$(waha_get /api/sessions)"

# Si la API ni responde, log y salir (puede estar arrancando)
if [[ -z "$SESSIONS_JSON" ]]; then
  echo "[$(date -Iseconds)] [WARN] WAHA no responde /api/sessions"
  exit 0
fi

# Extraer status del session "default" sin jq (usa grep/sed)
STATUS="$(echo "$SESSIONS_JSON" | grep -oE "\"name\":\"$SESSION\"[^}]*\"status\":\"[A-Z_]+\"" | grep -oE '"status":"[A-Z_]+"' | head -1 | sed -E 's/.*"status":"([A-Z_]+)".*/\1/')"

if [[ -z "$STATUS" ]]; then
  # Sesión no existe en absoluto (array vacío). Arrancarla.
  echo "[$(date -Iseconds)] [INFO] sesión '$SESSION' no existe, arrancando..."
  RESP="$(waha_post /api/sessions/$SESSION/start)"
  echo "[$(date -Iseconds)] [INFO] start response: $RESP"
  exit 0
fi

case "$STATUS" in
  WORKING)
    # Todo bien — no loguear para no inflar el archivo
    exit 0
    ;;
  STARTING)
    echo "[$(date -Iseconds)] [INFO] sesión '$SESSION' en STARTING, espero próximo tick"
    exit 0
    ;;
  STOPPED)
    echo "[$(date -Iseconds)] [WARN] sesión '$SESSION' en STOPPED — arrancando"
    RESP="$(waha_post /api/sessions/$SESSION/start)"
    echo "[$(date -Iseconds)] [INFO] start response: $RESP"
    ;;
  SCAN_QR_CODE)
    echo "[$(date -Iseconds)] [ALERT] sesión '$SESSION' pide QR — se desautenticó. Reescanear desde el panel WAHA."
    ;;
  FAILED)
    echo "[$(date -Iseconds)] [ALERT] sesión '$SESSION' en FAILED — intento stop+start"
    waha_post /api/sessions/$SESSION/stop >/dev/null
    sleep 3
    RESP="$(waha_post /api/sessions/$SESSION/start)"
    echo "[$(date -Iseconds)] [INFO] restart response: $RESP"
    ;;
  *)
    echo "[$(date -Iseconds)] [WARN] sesión '$SESSION' en estado inesperado: $STATUS"
    ;;
esac
