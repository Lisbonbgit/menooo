import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../prisma/prisma.service';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

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
    // O estado do Turnstile NÃO vive aqui: o /health é @Public() e publicar `enforced` (ou o
    // `consecutiveFailures` a subir) seria um oráculo em tempo real a dizer a um atacante quando
    // o endpoint que auto-confirma mesas está sem proteção. O painel lê-o autenticado, em
    // GET /reservations/turnstile-status.
    return { status: 'ok', db, timestamp: new Date().toISOString() };
  }
}
