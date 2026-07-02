-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "activatedAt" TIMESTAMP(3);

-- backfill: lojas já ativas contam desde o registo
UPDATE "Tenant" SET "activatedAt" = "createdAt" WHERE "status" = 'ACTIVE' AND "activatedAt" IS NULL;
