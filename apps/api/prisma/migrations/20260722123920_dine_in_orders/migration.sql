ALTER TYPE "OrderType" ADD VALUE 'DINE_IN';
ALTER TABLE "Tenant" ADD COLUMN "dineInOrderingEnabled" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "TableSession" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "dineTableId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3),
  CONSTRAINT "TableSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TableSession_tenantId_status_idx" ON "TableSession"("tenantId","status");
CREATE INDEX "TableSession_dineTableId_idx" ON "TableSession"("dineTableId");
CREATE UNIQUE INDEX "TableSession_one_open_per_table" ON "TableSession"("dineTableId") WHERE "status" = 'OPEN';
ALTER TABLE "TableSession" ADD CONSTRAINT "TableSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TableSession" ADD CONSTRAINT "TableSession_dineTableId_fkey" FOREIGN KEY ("dineTableId") REFERENCES "DineTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Order" ADD COLUMN "dineTableId" TEXT;
ALTER TABLE "Order" ADD COLUMN "tableSessionId" TEXT;
ALTER TABLE "Order" ADD CONSTRAINT "Order_dineTableId_fkey" FOREIGN KEY ("dineTableId") REFERENCES "DineTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_tableSessionId_fkey" FOREIGN KEY ("tableSessionId") REFERENCES "TableSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
