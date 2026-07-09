-- ============================================================================
-- Contas do dono (multi-unidade): a subscrição passa a ser por CONTA e cobre
-- todas as unidades. Cada restaurante existente vira a sua própria conta
-- (preservando exatamente a subscrição atual — comportamento inalterado).
-- ============================================================================

-- 1. Nova tabela Account -----------------------------------------------------
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "referralSource" TEXT,
    "activatedAt" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "trialReminderSentAt" TIMESTAMP(3),
    "paidUntil" TIMESTAMP(3),
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Account_stripeCustomerId_key" ON "Account"("stripeCustomerId");

-- 2. Uma conta por restaurante existente (copia a subscrição do Tenant) -------
INSERT INTO "Account" (
    "id", "name", "referralSource", "activatedAt", "trialEndsAt",
    "trialReminderSentAt", "paidUntil", "stripeCustomerId", "stripeSubscriptionId",
    "createdAt", "updatedAt"
)
SELECT
    'acc-' || "id", "name", "referralSource", "activatedAt", "trialEndsAt",
    "trialReminderSentAt", "paidUntil", "stripeCustomerId", "stripeSubscriptionId",
    "createdAt", CURRENT_TIMESTAMP
FROM "Tenant";

-- 3. Tenant.accountId --------------------------------------------------------
ALTER TABLE "Tenant" ADD COLUMN "accountId" TEXT;
UPDATE "Tenant" SET "accountId" = 'acc-' || "id";
ALTER TABLE "Tenant" ALTER COLUMN "accountId" SET NOT NULL;

-- 4. User.accountId (via o tenant a que o utilizador pertencia) ---------------
ALTER TABLE "User" ADD COLUMN "accountId" TEXT;
UPDATE "User" SET "accountId" = 'acc-' || "tenantId" WHERE "tenantId" IS NOT NULL;

-- 5. SubscriptionPayment.accountId -------------------------------------------
ALTER TABLE "SubscriptionPayment" ADD COLUMN "accountId" TEXT;
UPDATE "SubscriptionPayment" SET "accountId" = 'acc-' || "tenantId";
ALTER TABLE "SubscriptionPayment" ALTER COLUMN "accountId" SET NOT NULL;

-- 6. Chaves estrangeiras + índices para a conta ------------------------------
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Tenant_accountId_idx" ON "Tenant"("accountId");
CREATE INDEX "SubscriptionPayment_accountId_idx" ON "SubscriptionPayment"("accountId");

-- 7. Remover o antigo vínculo User -> Tenant ---------------------------------
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_tenantId_fkey";
DROP INDEX IF EXISTS "User_tenantId_email_key";
ALTER TABLE "User" DROP COLUMN "tenantId";
CREATE UNIQUE INDEX "User_accountId_email_key" ON "User"("accountId", "email");

-- 8. Remover o antigo vínculo SubscriptionPayment -> Tenant ------------------
ALTER TABLE "SubscriptionPayment" DROP CONSTRAINT IF EXISTS "SubscriptionPayment_tenantId_fkey";
DROP INDEX IF EXISTS "SubscriptionPayment_tenantId_idx";
ALTER TABLE "SubscriptionPayment" DROP COLUMN "tenantId";

-- 9. Remover os campos de subscrição do Tenant (agora vivem na conta) --------
DROP INDEX IF EXISTS "Tenant_stripeCustomerId_key";
ALTER TABLE "Tenant" DROP COLUMN "referralSource";
ALTER TABLE "Tenant" DROP COLUMN "activatedAt";
ALTER TABLE "Tenant" DROP COLUMN "trialEndsAt";
ALTER TABLE "Tenant" DROP COLUMN "trialReminderSentAt";
ALTER TABLE "Tenant" DROP COLUMN "paidUntil";
ALTER TABLE "Tenant" DROP COLUMN "stripeCustomerId";
ALTER TABLE "Tenant" DROP COLUMN "stripeSubscriptionId";
