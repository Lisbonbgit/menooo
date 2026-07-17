import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { ReservationsModule } from '../reservations/reservations.module';

@Module({
  // Só para reutilizar a MESMA instância do TurnstileService (o estado do fail-open é dela).
  imports: [ReservationsModule],
  controllers: [HealthController],
})
export class HealthModule {}
