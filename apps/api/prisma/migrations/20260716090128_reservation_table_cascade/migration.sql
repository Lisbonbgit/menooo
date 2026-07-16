-- DropForeignKey
ALTER TABLE "ReservationTable" DROP CONSTRAINT "ReservationTable_tableId_fkey";

-- AddForeignKey
ALTER TABLE "ReservationTable" ADD CONSTRAINT "ReservationTable_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE CASCADE ON UPDATE CASCADE;
