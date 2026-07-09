-- Checkout rico: consentimento de marketing, agendamento e "troco para".
ALTER TABLE "Order" ADD COLUMN "marketingConsent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD COLUMN "scheduledFor" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "changeFor" DECIMAL(10,2);
