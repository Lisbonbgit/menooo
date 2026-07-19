-- CreateEnum
CREATE TYPE "MenuType" AS ENUM ('DELIVERY', 'DINE_IN');

-- CreateTable
CREATE TABLE "Menu" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "MenuType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Menu_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Menu_tenantId_idx" ON "Menu"("tenantId");
CREATE UNIQUE INDEX "Menu_tenantId_type_key" ON "Menu"("tenantId", "type");

-- AddForeignKey
ALTER TABLE "Menu" ADD CONSTRAINT "Menu_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: um menu de cada tipo por tenant (ids determinísticos → re-executável)
INSERT INTO "Menu" ("id", "tenantId", "type", "createdAt", "updatedAt")
SELECT 'mnu_dlv_' || t."id", t."id", 'DELIVERY', now(), now() FROM "Tenant" t
ON CONFLICT ("tenantId", "type") DO NOTHING;
INSERT INTO "Menu" ("id", "tenantId", "type", "createdAt", "updatedAt")
SELECT 'mnu_din_' || t."id", t."id", 'DINE_IN', now(), now() FROM "Tenant" t
ON CONFLICT ("tenantId", "type") DO NOTHING;

-- Category.menuId: nullable → backfill (menu Delivery da loja) → NOT NULL + FK + índice
ALTER TABLE "Category" ADD COLUMN "menuId" TEXT;
UPDATE "Category" SET "menuId" = 'mnu_dlv_' || "tenantId";
ALTER TABLE "Category" ALTER COLUMN "menuId" SET NOT NULL;
CREATE INDEX "Category_menuId_idx" ON "Category"("menuId");
ALTER TABLE "Category" ADD CONSTRAINT "Category_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ModifierGroup.menuId: idem
ALTER TABLE "ModifierGroup" ADD COLUMN "menuId" TEXT;
UPDATE "ModifierGroup" SET "menuId" = 'mnu_dlv_' || "tenantId";
ALTER TABLE "ModifierGroup" ALTER COLUMN "menuId" SET NOT NULL;
CREATE INDEX "ModifierGroup_menuId_idx" ON "ModifierGroup"("menuId");
ALTER TABLE "ModifierGroup" ADD CONSTRAINT "ModifierGroup_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;
