-- "Esqueci-me da password": código de 6 dígitos por email (mesmo padrão da
-- verificação de email do registo).
ALTER TABLE "User" ADD COLUMN "passwordResetCodeHash" TEXT;
ALTER TABLE "User" ADD COLUMN "passwordResetExpiresAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "passwordResetAttempts" INTEGER NOT NULL DEFAULT 0;
