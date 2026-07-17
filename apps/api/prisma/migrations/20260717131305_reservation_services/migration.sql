-- AlterTable
ALTER TABLE "Table" ADD COLUMN     "shape" TEXT NOT NULL DEFAULT 'square',
ADD COLUMN     "x" INTEGER,
ADD COLUMN     "y" INTEGER;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "reservationGraceMin" INTEGER NOT NULL DEFAULT 15;

-- CreateTable
CREATE TABLE "ReservationService" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weekdays" INTEGER[],
    "openMinute" INTEGER NOT NULL,
    "closeMinute" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ReservationService_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReservationService_tenantId_idx" ON "ReservationService"("tenantId");

-- AddForeignKey
ALTER TABLE "ReservationService" ADD CONSTRAINT "ReservationService_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: ReservationWindow -> ReservationService.
-- A promessa: a disponibilidade de ninguém muda. O scripts/test-migration-services.mjs extrai o
-- SQL entre os marcadores abaixo e prova-o sobre janelas a sério (>=1 janela, >=2 tenants,
-- incluindo um par SOBREPOSTO) — a BD de dev tem 0 janelas e passaria sem tocar no problema.
-- 1) `uniao`: funde janelas SOBREPOSTAS do mesmo weekday. Hoje o setWindows não valida
--    sobreposição (só close>open e o teto de 2/dia), logo `seg 12:00-15:00 + seg 14:00-18:00`
--    é um estado legal e alcançável pela UI — e agrupá-lo cru daria dois serviços sobrepostos,
--    que a validação NOVA recusa com 400, deixando o dono sem poder gravar nada.
--    O slotMinutes acumula num Set, logo a união gera exatamente os mesmos slots.
-- 2) `grupos`: agrupa por (open, close) e junta os weekdays.
-- 3) `id`: sintetizado — o @default(cuid()) do Prisma NÃO cria default na base de dados (ver o
--    CREATE TABLE acima: "id" TEXT NOT NULL, sem DEFAULT). Padrão do repo: 'pmg_' || g."id" em
--    20260712120000_shared_modifier_groups.
-- >>> BACKFILL
WITH ordenadas AS (
  SELECT "tenantId", "weekday", "openMinute", "closeMinute",
         SUM(novo) OVER (PARTITION BY "tenantId", "weekday" ORDER BY "openMinute", "closeMinute") AS bloco
  FROM (
    SELECT w.*,
           CASE WHEN w."openMinute" <= MAX(w."closeMinute") OVER (
                  PARTITION BY w."tenantId", w."weekday"
                  ORDER BY w."openMinute", w."closeMinute"
                  ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)
                THEN 0 ELSE 1 END AS novo
    FROM "ReservationWindow" w
  ) s
),
uniao AS (
  SELECT "tenantId", "weekday", MIN("openMinute") AS "openMinute", MAX("closeMinute") AS "closeMinute"
  FROM ordenadas GROUP BY "tenantId", "weekday", bloco
),
grupos AS (
  SELECT "tenantId", "openMinute", "closeMinute",
         array_agg(DISTINCT "weekday" ORDER BY "weekday") AS weekdays
  FROM uniao GROUP BY "tenantId", "openMinute", "closeMinute"
)
INSERT INTO "ReservationService" ("id", "tenantId", "name", "weekdays", "openMinute", "closeMinute", "sortOrder")
SELECT
  'rs_' || md5(g."tenantId" || '_' || g."openMinute" || '_' || g."closeMinute"),
  g."tenantId",
  -- nome com a hora SEMPRE que houver mais do que um grupo do mesmo lado das 17:00:
  -- o teto real é 2 janelas x 7 weekdays = até 14 grupos, e não há @@unique no name.
  CASE WHEN (SELECT count(*) FROM grupos g2
             WHERE g2."tenantId" = g."tenantId"
               AND (g2."openMinute" < 1020) = (g."openMinute" < 1020)) > 1
       THEN (CASE WHEN g."openMinute" < 1020 THEN 'Almoço ' ELSE 'Jantar ' END)
            || lpad((g."openMinute" / 60)::text, 2, '0') || ':' || lpad((g."openMinute" % 60)::text, 2, '0')
       ELSE (CASE WHEN g."openMinute" < 1020 THEN 'Almoço' ELSE 'Jantar' END)
  END,
  g.weekdays,
  g."openMinute",
  g."closeMinute",
  -- sortOrder preenchido: @default(0) em todos deixaria a ordem dos chips ao critério do Postgres.
  (row_number() OVER (PARTITION BY g."tenantId" ORDER BY g."openMinute"))::int
FROM grupos g
ON CONFLICT ("id") DO NOTHING;
-- <<< BACKFILL
