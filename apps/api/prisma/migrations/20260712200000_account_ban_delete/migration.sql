-- Banir/excluir empresa: estado na conta + pagamentos sobrevivem à exclusão.

-- estado da conta
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'BANNED');
ALTER TABLE "Account" ADD COLUMN "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "Account" ADD COLUMN "bannedAt" TIMESTAMP(3);

-- snapshot do nome da empresa nos pagamentos + backfill dos existentes
ALTER TABLE "SubscriptionPayment" ADD COLUMN "accountName" TEXT;
UPDATE "SubscriptionPayment" sp
SET "accountName" = a."name"
FROM "Account" a
WHERE a."id" = sp."accountId";

-- accountId passa a opcional; ao apagar a conta o pagamento fica (SET NULL)
ALTER TABLE "SubscriptionPayment" ALTER COLUMN "accountId" DROP NOT NULL;
ALTER TABLE "SubscriptionPayment" DROP CONSTRAINT "SubscriptionPayment_accountId_fkey";
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
