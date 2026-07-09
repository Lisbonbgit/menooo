-- IVA (incluído no preço): taxa por produto, snapshot no item, total no pedido.
ALTER TABLE "Product" ADD COLUMN "vatRate" INTEGER NOT NULL DEFAULT 23;
ALTER TABLE "OrderItem" ADD COLUMN "vatRate" INTEGER NOT NULL DEFAULT 23;
ALTER TABLE "Order" ADD COLUMN "vatTotal" DECIMAL(10,2) NOT NULL DEFAULT 0;
