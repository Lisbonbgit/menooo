import { Module } from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { TurnstileService } from './turnstile.service';
import { PublicReservationsController } from './public-reservations.controller';
import { ReservationsController } from './reservations.controller';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [OrdersModule],
  controllers: [PublicReservationsController, ReservationsController],
  providers: [ReservationsService, TurnstileService],
  // TurnstileService exportado (e não re-provido no HealthModule): tem estado — o
  // `consecutiveFailures` do fail-open — e uma 2ª instância reportava 0 para sempre.
  exports: [ReservationsService, TurnstileService],
})
export class ReservationsModule {}
