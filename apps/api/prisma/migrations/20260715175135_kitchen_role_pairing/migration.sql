/*
  Warnings:

  - A unique constraint covering the columns `[kitchenPairId]` on the table `Tenant` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'KITCHEN';

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "kitchenPairAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "kitchenPairExpiresAt" TIMESTAMP(3),
ADD COLUMN     "kitchenPairHash" TEXT,
ADD COLUMN     "kitchenPairId" TEXT,
ADD COLUMN     "kitchenPairedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "kitchenTenantId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_kitchenPairId_key" ON "Tenant"("kitchenPairId");

-- CreateIndex
CREATE INDEX "User_kitchenTenantId_idx" ON "User"("kitchenTenantId");
