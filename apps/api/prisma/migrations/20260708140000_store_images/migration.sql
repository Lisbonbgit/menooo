-- Identidade visual da loja: logótipo e foto de capa mostrados na montra.
-- (Product.imageUrl já existe desde a migração inicial.)
ALTER TABLE "Tenant" ADD COLUMN "logoUrl" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "coverUrl" TEXT;
