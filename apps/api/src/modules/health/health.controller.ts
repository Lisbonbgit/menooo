import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../prisma/prisma.service';
import { TurnstileService } from '../reservations/turnstile.service';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly turnstile: TurnstileService,
  ) {}

  @Public()
  @Get()
  async check() {
    let db = 'down';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = 'up';
    } catch {
      db = 'down';
    }
    // `turnstile` é o sinal que o painel lê para pôr a prontidão a vermelho antes de o dono
    // abrir as reservas ao público (plano, Task 11).
    return { status: 'ok', db, turnstile: this.turnstile.stats(), timestamp: new Date().toISOString() };
  }
}
