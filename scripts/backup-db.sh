#!/usr/bin/env bash
#
# Backup diário da base de dados de produção do Menooo.
# Chamado pelo cron do VPS (ver crontab: 0 4 * * *).
#
#   - pg_dump do container `db` (Postgres), comprimido com gzip
#   - guardado em /root/backups (FORA do repo, para o rsync do deploy não mexer)
#   - rotação: apaga backups com mais de KEEP_DAYS dias
#   - aborta se o dump vier vazio (não rotaciona por cima de um backup mau)
#
set -euo pipefail

# o cron corre com PATH mínimo — garantir que o docker é encontrado
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

COMPOSE_DIR="/root/comanda"
COMPOSE_FILE="docker-compose.prod.yml"
BACKUP_DIR="/root/backups"
KEEP_DAYS=14
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/comanda-$STAMP.sql.gz"

mkdir -p "$BACKUP_DIR"
cd "$COMPOSE_DIR"

# dump comprimido (pg_dump vai por stdin do gzip)
docker compose -f "$COMPOSE_FILE" exec -T db pg_dump -U comanda comanda | gzip > "$OUT"

# um dump válido tem sempre milhares de bytes; se vier ~vazio, algo falhou
if [ ! -s "$OUT" ] || [ "$(stat -c%s "$OUT")" -lt 1024 ]; then
  echo "[$(date '+%F %T')] backup FALHOU: dump vazio/curto ($OUT)" >&2
  rm -f "$OUT"
  exit 1
fi

# rotação
find "$BACKUP_DIR" -maxdepth 1 -name 'comanda-*.sql.gz' -mtime +"$KEEP_DAYS" -delete

echo "[$(date '+%F %T')] backup ok: $OUT ($(du -h "$OUT" | cut -f1))"
