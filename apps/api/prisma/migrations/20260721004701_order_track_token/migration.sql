ALTER TABLE "Order" ADD COLUMN "trackToken" TEXT;
UPDATE "Order" SET "trackToken" = 'trk_' || md5("id") WHERE "trackToken" IS NULL;
ALTER TABLE "Order" ALTER COLUMN "trackToken" SET NOT NULL;
CREATE UNIQUE INDEX "Order_trackToken_key" ON "Order"("trackToken");
