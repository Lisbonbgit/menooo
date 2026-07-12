-- Grupos de complementos reutilizáveis: o grupo passa a pertencer ao tenant
-- e liga-se a produtos por junção. Cada grupo existente fica anexado 1:1 ao
-- seu produto de origem — comportamento das lojas inalterado no dia da migração.

-- 1) nova coluna (temporariamente NULL) e tabela de junção
ALTER TABLE "ModifierGroup" ADD COLUMN "tenantId" TEXT;

CREATE TABLE "ProductModifierGroup" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ProductModifierGroup_pkey" PRIMARY KEY ("id")
);

-- 2) backfill a partir do produto dono
UPDATE "ModifierGroup" g SET "tenantId" = p."tenantId"
FROM "Product" p WHERE p."id" = g."productId";

INSERT INTO "ProductModifierGroup" ("id", "productId", "groupId", "sortOrder")
SELECT 'pmg_' || g."id", g."productId", g."id", g."sortOrder" FROM "ModifierGroup" g;

-- 3) apertar constraints e remover as colunas antigas
ALTER TABLE "ModifierGroup" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "ModifierGroup" DROP CONSTRAINT "ModifierGroup_productId_fkey";
ALTER TABLE "ModifierGroup" DROP COLUMN "productId";
ALTER TABLE "ModifierGroup" DROP COLUMN "sortOrder";

CREATE INDEX "ModifierGroup_tenantId_idx" ON "ModifierGroup"("tenantId");
CREATE UNIQUE INDEX "ProductModifierGroup_productId_groupId_key"
  ON "ProductModifierGroup"("productId", "groupId");
CREATE INDEX "ProductModifierGroup_productId_idx" ON "ProductModifierGroup"("productId");
CREATE INDEX "ProductModifierGroup_groupId_idx" ON "ProductModifierGroup"("groupId");

ALTER TABLE "ModifierGroup" ADD CONSTRAINT "ModifierGroup_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductModifierGroup" ADD CONSTRAINT "ProductModifierGroup_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductModifierGroup" ADD CONSTRAINT "ProductModifierGroup_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "ModifierGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
