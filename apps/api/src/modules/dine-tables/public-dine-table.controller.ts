import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { DineTablesService } from './dine-tables.service';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('public')
@Controller('public/stores')
export class PublicDineTableController {
  constructor(private readonly tables: DineTablesService) {}

  /** Resolve a mesa a partir do QR — só serve o restaurante do `slug`. */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':slug/mesa/:qrToken')
  resolve(@Param('slug') slug: string, @Param('qrToken') qrToken: string) {
    return this.tables.resolvePublic(slug, qrToken);
  }
}
