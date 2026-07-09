-- Verificação de email no registo (código de 6 dígitos).
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "verificationCodeHash" TEXT;
ALTER TABLE "User" ADD COLUMN "verificationCodeExpiresAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "verificationAttempts" INTEGER NOT NULL DEFAULT 0;

-- Contas já existentes ficam verificadas (não bloquear ninguém que já usa o painel).
UPDATE "User" SET "emailVerifiedAt" = CURRENT_TIMESTAMP;
