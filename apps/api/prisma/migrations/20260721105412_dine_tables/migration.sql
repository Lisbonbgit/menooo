CREATE TABLE "DineTable" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "qrToken" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DineTable_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DineTable_qrToken_key" ON "DineTable"("qrToken");
CREATE INDEX "DineTable_tenantId_idx" ON "DineTable"("tenantId");
ALTER TABLE "DineTable" ADD CONSTRAINT "DineTable_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
