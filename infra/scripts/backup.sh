#!/usr/bin/env bash
# pg_dump diario — se ejecuta vía cron en el VPS.
# Cron recomendado: 0 3 * * * /opt/atepsa-reportes/infra/scripts/backup.sh >> /var/log/atepsa-backup.log 2>&1

set -euo pipefail

BACKUP_DIR="/opt/atepsa-reportes/backups"
CONTAINER="atepsa-postgres"
DB="${POSTGRES_DB:-atepsa}"
USER="${POSTGRES_USER:-app_user}"
RETENTION_DAYS=30
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILE="${BACKUP_DIR}/atepsa_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[$(date -Iseconds)] Iniciando backup de ${DB}..."
docker exec "$CONTAINER" pg_dump -U "$USER" "$DB" | gzip > "$FILE"
echo "[$(date -Iseconds)] Backup guardado: ${FILE} ($(du -sh "$FILE" | cut -f1))"

# Eliminar backups más viejos que RETENTION_DAYS
find "$BACKUP_DIR" -name "atepsa_*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete
echo "[$(date -Iseconds)] Limpieza: backups de más de ${RETENTION_DAYS} días eliminados."
