import { Module } from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { PublicReservationsController } from './public-reservations.controller';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [OrdersModule],
  controllers: [PublicReservationsController],
  providers: [ReservationsService],
  exports: [ReservationsService],
})
export class ReservationsModule {}
