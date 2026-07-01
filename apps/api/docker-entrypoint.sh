#!/bin/sh
# Aplica migrações e seed (idempotente) antes de arrancar a API.
set -e
cd /app

echo "[entrypoint] prisma migrate deploy…"
pnpm --filter @comanda/api prisma:deploy

echo "[entrypoint] seed (idempotente)…"
pnpm --filter @comanda/api prisma:seed || echo "[entrypoint] aviso: seed falhou, a continuar"

echo "[entrypoint] a iniciar API…"
exec "$@"
