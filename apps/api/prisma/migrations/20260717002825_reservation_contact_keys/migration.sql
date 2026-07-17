-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "contactEmailKey" TEXT,
ADD COLUMN     "contactPhoneKey" TEXT;

-- CreateIndex
CREATE INDEX "Reservation_tenantId_contactEmailKey_idx" ON "Reservation"("tenantId", "contactEmailKey");

-- CreateIndex
CREATE INDEX "Reservation_tenantId_contactPhoneKey_idx" ON "Reservation"("tenantId", "contactPhoneKey");

-- Backfill: as reservas existentes TÊM de contar para o cap por contacto, senão quem já
-- reservou antes desta migração recomeça do zero. Espelha contact.util.ts (emailKey/phoneKey).
UPDATE "Reservation"
SET "contactEmailKey" = NULLIF(lower(trim("customerEmail")), ''),
    "contactPhoneKey" = NULLIF(right(regexp_replace("customerPhone", '\D', '', 'g'), 9), '');
