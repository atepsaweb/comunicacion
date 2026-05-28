#!/usr/bin/env bash
# Restaura un backup de pg_dump.
# Uso: ./restore.sh /opt/atepsa-reportes/backups/atepsa_20260101_030000.sql.gz
#
# ADVERTENCIA: borra y recrea la base de datos. Sólo usar en emergencia.

set -euo pipefail

BACKUP_FILE="${1:-}"
CONTAINER="atepsa-postgres"
DB="${POSTGRES_DB:-atepsa}"
USER="${POSTGRES_USER:-app_user}"

if [[ -z "$BACKUP_FILE" ]]; then
  echo "Uso: $0 <archivo.sql.gz>"
  exit 1
fi

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "Error: no existe el archivo ${BACKUP_FILE}"
  exit 1
fi

read -r -p "¿Restaurar ${BACKUP_FILE} sobre la base ${DB}? Esto borra los datos actuales. [s/N] " confirm
[[ "$confirm" == "s" || "$confirm" == "S" ]] || { echo "Cancelado."; exit 0; }

echo "[$(date -Iseconds)] Restaurando ${BACKUP_FILE}..."
gunzip -c "$BACKUP_FILE" | docker exec -i "$CONTAINER" psql -U "$USER" -d "$DB"
echo "[$(date -Iseconds)] Restore completado."
